import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {
  deleteApp as deleteClientApp,
  initializeApp as initializeClientApp,
} from "firebase/app";
import {
  connectAuthEmulator,
  getAuth as getClientAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  bootstrapPlatformAdmin,
  resolveEmulatorEndpoints,
} from "./bootstrap-platform-admin-emulator.mjs";

const unsafeAuthEnv = {
  ...process.env,
  FIREBASE_AUTH_EMULATOR_HOST: "firebase.example.com:9099",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
};
let unsafeLoaderCalled = false;
await assert.rejects(
  bootstrapPlatformAdmin({
    env: unsafeAuthEnv,
    adminSdkLoader: async () => {
      unsafeLoaderCalled = true;
      throw new Error("Admin SDK no debe cargarse");
    },
  }),
  /FIREBASE_AUTH_EMULATOR_HOST debe apuntar exclusivamente/
);
assert.equal(unsafeLoaderCalled, false);
assert.throws(
  () => resolveEmulatorEndpoints({
    FIREBASE_AUTH_EMULATOR_HOST: "2130706433:9099",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  }),
  /FIREBASE_AUTH_EMULATOR_HOST debe apuntar exclusivamente/
);

const unsafeFirestoreEnv = {
  ...process.env,
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIRESTORE_EMULATOR_HOST: "10.0.0.20:8080",
};
await assert.rejects(
  bootstrapPlatformAdmin({env: unsafeFirestoreEnv}),
  /FIRESTORE_EMULATOR_HOST debe apuntar exclusivamente/
);

const testEmail = "platform-admin-bootstrap-smoke@valoracloud.local";
const testPassword = "Local-Smoke-Platform-Admin-2026!";
const localEnv = {
  ...process.env,
  VALORACLOUD_LOCAL_PLATFORM_ADMIN_EMAIL: testEmail,
  VALORACLOUD_LOCAL_PLATFORM_ADMIN_PASSWORD: testPassword,
};
resolveEmulatorEndpoints(localEnv);

const first = await bootstrapPlatformAdmin({env: localEnv});
const second = await bootstrapPlatformAdmin({env: localEnv});
assert.equal(first.created, true);
assert.equal(second.created, false);
assert.equal(first.uid, second.uid);
assert.equal(first.platformRole, "PLATFORM_SUPERADMIN");
assert.equal(second.platformRole, "PLATFORM_SUPERADMIN");

const clientApp = initializeClientApp({
  apiKey: "demo",
  authDomain: "tesis-inventario-ia.firebaseapp.com",
  projectId: "tesis-inventario-ia",
  appId: `platform-admin-bootstrap-smoke-${Date.now()}`,
});
try {
  const clientAuth = getClientAuth(clientApp);
  connectAuthEmulator(
    clientAuth,
    `http://${first.endpoints.auth.hostPort}`,
    {disableWarnings: true}
  );
  const credential = await signInWithEmailAndPassword(
    clientAuth,
    testEmail,
    testPassword
  );
  const token = await credential.user.getIdTokenResult(true);
  assert.equal(token.claims.platformRole, "PLATFORM_SUPERADMIN");
} finally {
  await deleteClientApp(clientApp);
}

const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const {deleteApp, initializeApp} = requireFromFunctions("firebase-admin/app");
const {getAuth} = requireFromFunctions("firebase-admin/auth");
const inspectorApp = initializeApp(
  {projectId: "tesis-inventario-ia"},
  `platform-admin-bootstrap-smoke-${Date.now()}`
);
try {
  const users = (await getAuth(inspectorApp).listUsers(1000)).users;
  const matching = users.filter((user) => user.email === testEmail);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].customClaims?.platformRole, "PLATFORM_SUPERADMIN");
} finally {
  await deleteApp(inspectorApp);
}

console.log("PLATFORM_ADMIN_EMULATOR_BOOTSTRAP_SMOKE_OK");
