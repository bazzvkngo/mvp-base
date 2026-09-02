import {randomBytes} from "node:crypto";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const PROJECT_ID = "tesis-inventario-ia";
const PLATFORM_ROLE = "PLATFORM_SUPERADMIN";
const DEFAULT_EMAIL = "platform-admin@valoracloud.local";
const DEFAULT_AUTH_ENDPOINT = "127.0.0.1:9099";
const DEFAULT_FIRESTORE_ENDPOINT = "127.0.0.1:8080";

function endpointError(label, value) {
  return new Error(
    `${label} debe apuntar exclusivamente a localhost, 127.0.0.1 o ::1. ` +
    `Se rechazó: ${String(value || "(vacío)")}`
  );
}

export function parseLoopbackEndpoint(value, label) {
  const raw = String(value || "").trim();
  const ipv4OrName = /^(localhost|127\.0\.0\.1):(\d{1,5})$/i.exec(raw);
  const ipv6 = /^(?:\[::1\]|::1):(\d{1,5})$/i.exec(raw);
  if (!ipv4OrName && !ipv6) {
    throw endpointError(label, raw);
  }

  const hostname = ipv6 ? "::1" : ipv4OrName[1].toLowerCase();
  const port = Number(ipv6 ? ipv6[1] : ipv4OrName[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw endpointError(label, raw);
  }

  return {
    hostname,
    port,
    hostPort: hostname === "::1" ? `[::1]:${port}` : `${hostname}:${port}`,
  };
}

export function resolveEmulatorEndpoints(env = process.env) {
  return {
    auth: parseLoopbackEndpoint(
      env.FIREBASE_AUTH_EMULATOR_HOST || DEFAULT_AUTH_ENDPOINT,
      "FIREBASE_AUTH_EMULATOR_HOST"
    ),
    firestore: parseLoopbackEndpoint(
      env.FIRESTORE_EMULATOR_HOST || DEFAULT_FIRESTORE_ENDPOINT,
      "FIRESTORE_EMULATOR_HOST"
    ),
  };
}

function localEmail(value) {
  const email = String(value || DEFAULT_EMAIL).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.local$/.test(email)) {
    throw new Error(
      "La cuenta de Platform Admin debe usar un correo reservado con dominio .local."
    );
  }
  return email;
}

function localPassword(value) {
  const configured = String(value || "");
  const password = configured || `Local-${randomBytes(18).toString("base64url")}!`;
  if (!/^[\x20-\x7e]{12,128}$/.test(password)) {
    throw new Error(
      "VALORACLOUD_LOCAL_PLATFORM_ADMIN_PASSWORD debe tener entre 12 y 128 caracteres imprimibles."
    );
  }
  return {password, generated: !configured};
}

async function defaultAdminSdkLoader() {
  const requireFromFunctions = createRequire(
    new URL("../functions/package.json", import.meta.url)
  );
  const {deleteApp, initializeApp} = requireFromFunctions("firebase-admin/app");
  const {getAuth} = requireFromFunctions("firebase-admin/auth");
  const {getFirestore} = requireFromFunctions("firebase-admin/firestore");
  return {deleteApp, getAuth, getFirestore, initializeApp};
}

function isUserNotFound(error) {
  return error?.code === "auth/user-not-found";
}

async function assertEmulatorsReachable(auth, db, endpoints) {
  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection("localBootstrapHealth").doc("platformAdmin").get(),
    ]);
  } catch (error) {
    throw new Error(
      "No fue posible contactar Auth y Firestore Emulator en " +
      `${endpoints.auth.hostPort} y ${endpoints.firestore.hostPort}. ` +
      "Inicia primero `npm run emulators:start`.",
      {cause: error}
    );
  }
}

export async function bootstrapPlatformAdmin({
  env = process.env,
  adminSdkLoader = defaultAdminSdkLoader,
} = {}) {
  // Esta validación ocurre antes de cargar Admin SDK o efectuar cualquier escritura.
  const endpoints = resolveEmulatorEndpoints(env);
  const email = localEmail(env.VALORACLOUD_LOCAL_PLATFORM_ADMIN_EMAIL);
  const {password, generated} = localPassword(
    env.VALORACLOUD_LOCAL_PLATFORM_ADMIN_PASSWORD
  );

  process.env.FIREBASE_AUTH_EMULATOR_HOST = endpoints.auth.hostPort;
  process.env.FIRESTORE_EMULATOR_HOST = endpoints.firestore.hostPort;

  const {deleteApp, getAuth, getFirestore, initializeApp} =
    await adminSdkLoader();
  const app = initializeApp(
    {projectId: PROJECT_ID},
    `platform-admin-emulator-bootstrap-${process.pid}-${Date.now()}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);

  try {
    // Ambos servicios deben responder antes de crear o actualizar la cuenta.
    await assertEmulatorsReachable(auth, db, endpoints);

    let user;
    let created = false;
    try {
      user = await auth.getUserByEmail(email);
    } catch (error) {
      if (!isUserNotFound(error)) throw error;
      try {
        user = await auth.createUser({
          email,
          password,
          emailVerified: true,
          displayName: "ValoraCloud Platform Admin local",
          disabled: false,
        });
        created = true;
      } catch (createError) {
        if (createError?.code !== "auth/email-already-exists") throw createError;
        user = await auth.getUserByEmail(email);
      }
    }

    if (!created) {
      user = await auth.updateUser(user.uid, {
        password,
        emailVerified: true,
        displayName: "ValoraCloud Platform Admin local",
        disabled: false,
      });
    }

    await auth.setCustomUserClaims(user.uid, {
      ...(user.customClaims || {}),
      platformRole: PLATFORM_ROLE,
    });
    const confirmed = await auth.getUser(user.uid);

    return {
      created,
      email,
      password,
      passwordGenerated: generated,
      uid: confirmed.uid,
      platformRole: confirmed.customClaims?.platformRole || null,
      endpoints,
    };
  } finally {
    await deleteApp(app);
  }
}

function printInstructions(result) {
  console.log("PLATFORM_ADMIN_EMULATOR_BOOTSTRAP_OK");
  console.log(`Cuenta: ${result.created ? "creada" : "actualizada"}`);
  console.log(`Email local: ${result.email}`);
  console.log(`Contraseña local: ${result.password}`);
  if (result.passwordGenerated) {
    console.log("La contraseña fue generada para esta ejecución; guárdala sólo para tu sesión local.");
  }
  console.log("");
  console.log("Flujo de verificación local:");
  console.log("1. Inicia Emulator Suite: npm run emulators:start");
  console.log("2. Ejecuta este bootstrap: npm run bootstrap:platform-admin:emulator");
  console.log("3. Inicia ValoraCloud: npm run dev:emulator");
  console.log("4. Ingresa como OWNER y envía la solicitud de verificación.");
  console.log("5. Abre una segunda sesión o ventana de incógnito.");
  console.log("6. Ingresa con la cuenta Platform Admin local mostrada arriba.");
  console.log("7. Abre /admin/verificaciones y aprueba la empresa.");
  console.log("8. Vuelve a la sesión OWNER; los módulos se habilitarán al revalidarse la sesión.");
}

const isMainModule = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    printInstructions(await bootstrapPlatformAdmin());
  } catch (error) {
    console.error(`PLATFORM_ADMIN_EMULATOR_BOOTSTRAP_ABORTED: ${error.message}`);
    process.exitCode = 1;
  }
}
