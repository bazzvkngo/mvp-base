const DEVELOPMENT_MODES = new Set(["existing", "emulator"]);
const ALL_MODES = new Set([...DEVELOPMENT_MODES, "production"]);

function readBoolean(env, name) {
  const raw = String(env?.[name] ?? "").trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(
    `[Firebase] ${name} debe definirse explícitamente como true o false.`
  );
}

function readPort(env, name, fallback) {
  const value = Number(env?.[name] || fallback);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`[Firebase] ${name} contiene un puerto inválido.`);
  }
  return value;
}

export function resolveFirebaseEnvironment(
  env,
  { isDev = false, isProd = false } = {}
) {
  const mode = String(env?.VITE_FIREBASE_MODE || (isProd ? "production" : ""))
    .trim()
    .toLowerCase();

  if (!ALL_MODES.has(mode)) {
    throw new Error(
      "[Firebase] Inicia datos reales con npm run dev o QA con npm run dev:emulator."
    );
  }
  if (isDev && !DEVELOPMENT_MODES.has(mode)) {
    throw new Error("[Firebase] El modo production no puede ejecutarse con Vite dev.");
  }
  if (isProd && mode !== "production") {
    throw new Error("[Firebase] Un build solo puede usar el modo production.");
  }

  const useCoreEmulators = readBoolean(
    env,
    "VITE_USE_FIREBASE_CORE_EMULATORS"
  );
  const useFunctionsEmulator = readBoolean(
    env,
    "VITE_USE_FIREBASE_FUNCTIONS_EMULATOR"
  );
  const useStorageEmulator = readBoolean(
    env,
    "VITE_USE_FIREBASE_STORAGE_EMULATOR"
  );
  const emulatorFlags = [
    useCoreEmulators,
    useFunctionsEmulator,
    useStorageEmulator,
  ];
  const expectsEmulators = mode === "emulator";

  if (emulatorFlags.some((flag) => flag !== expectsEmulators)) {
    throw new Error(
      `[Firebase] Configuración híbrida rechazada para el modo ${mode}: Auth, Firestore, Functions y Storage deben pertenecer al mismo entorno.`
    );
  }

  const coreHost = String(
    env?.VITE_FIREBASE_CORE_EMULATOR_HOST || "127.0.0.1"
  ).trim();
  const functionsHost = String(
    env?.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || coreHost
  ).trim();
  const storageHost = String(
    env?.VITE_FIREBASE_STORAGE_EMULATOR_HOST || coreHost
  ).trim();

  if (expectsEmulators && (!coreHost || !functionsHost || !storageHost)) {
    throw new Error("[Firebase] Los hosts de emuladores no pueden estar vacíos.");
  }

  return Object.freeze({
    mode,
    isEmulator: expectsEmulators,
    isExistingData: mode === "existing",
    isReadOnly: false,
    showDevelopmentNotice: isDev,
    notice:
      mode === "emulator"
        ? "Entorno QA local"
        : mode === "existing"
          ? "Datos reales"
          : "",
    hosts: Object.freeze({
      core: coreHost,
      functions: functionsHost,
      storage: storageHost,
    }),
    ports: Object.freeze({
      auth: readPort(env, "VITE_FIREBASE_AUTH_EMULATOR_PORT", 9099),
      firestore: readPort(env, "VITE_FIREBASE_FIRESTORE_EMULATOR_PORT", 8080),
      functions: readPort(env, "VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT", 5001),
      storage: readPort(env, "VITE_FIREBASE_STORAGE_EMULATOR_PORT", 9199),
    }),
  });
}

export function createReadOnlyError(operation = "esta operación") {
  const error = new Error(
    `No se puede ejecutar ${operation} en un entorno configurado como solo lectura.`
  );
  error.code = "firebase/read-only-mode";
  return error;
}

export function assertWriteAllowed(
  environment,
  operation = "esta operación"
) {
  if (environment?.isReadOnly) throw createReadOnlyError(operation);
}

const viteEnvironment = import.meta.env;
const nonViteEnvironment = {
  VITE_FIREBASE_MODE: "production",
  VITE_USE_FIREBASE_CORE_EMULATORS: "false",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "false",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "false",
};

export const firebaseEnvironment = viteEnvironment
  ? resolveFirebaseEnvironment(viteEnvironment, {
      isDev: Boolean(viteEnvironment.DEV),
      isProd: Boolean(viteEnvironment.PROD),
    })
  : resolveFirebaseEnvironment(nonViteEnvironment, { isProd: true });

export function assertClientWriteAllowed(operation) {
  assertWriteAllowed(firebaseEnvironment, operation);
}

export function assertCloudFunctionAllowed(operation) {
  assertWriteAllowed(firebaseEnvironment, operation);
}
