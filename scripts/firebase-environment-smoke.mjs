import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { loadEnv } from "vite";
import {
  assertWriteAllowed,
  resolveFirebaseEnvironment,
} from "../src/config/firebaseEnvironment.mjs";

function parseEnvFile(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  );
}

const commonPorts = {
  VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: "8080",
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: "5001",
  VITE_FIREBASE_STORAGE_EMULATOR_PORT: "9199",
};

const emulator = resolveFirebaseEnvironment(
  {
    ...commonPorts,
    VITE_FIREBASE_MODE: "emulator",
    VITE_USE_FIREBASE_CORE_EMULATORS: "true",
    VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
    VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
  },
  { isDev: true }
);
assert.equal(emulator.isEmulator, true);
assert.equal(emulator.isReadOnly, false);
assert.equal(emulator.notice, "Entorno QA local");
assert.deepEqual(emulator.ports, {
  auth: 9099,
  firestore: 8080,
  functions: 5001,
  storage: 9199,
});

const existing = resolveFirebaseEnvironment(
  {
    ...commonPorts,
    VITE_FIREBASE_MODE: "existing",
    VITE_USE_FIREBASE_CORE_EMULATORS: "false",
    VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "false",
    VITE_USE_FIREBASE_STORAGE_EMULATOR: "false",
  },
  { isDev: true }
);
assert.equal(existing.isEmulator, false);
assert.equal(existing.isExistingData, true);
assert.equal(existing.isReadOnly, false);
assert.equal(existing.notice, "Datos reales");
assert.doesNotThrow(() => assertWriteAllowed(existing, "crear inventario"));

assert.throws(
  () =>
    resolveFirebaseEnvironment(
      {
        ...commonPorts,
        VITE_FIREBASE_MODE: "emulator",
        VITE_USE_FIREBASE_CORE_EMULATORS: "true",
        VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "false",
        VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
      },
      { isDev: true }
    ),
  /híbrida/
);
assert.throws(
  () =>
    resolveFirebaseEnvironment(
      {
        ...commonPorts,
        VITE_FIREBASE_MODE: "existing",
        VITE_USE_FIREBASE_CORE_EMULATORS: "false",
        VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "false",
        VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
      },
      { isDev: true }
    ),
  /híbrida/
);

const [
  firebaseConfigSource,
  authServiceSource,
  inventoryServiceSource,
  packageSource,
  emulatorStartSource,
  loginSource,
  inventoryPageSource,
  companyServiceSource,
  firestoreRulesSource,
  existingEnvSource,
  emulatorEnvSource,
] =
  await Promise.all([
    readFile(
      new URL("../src/firebase/firebaseConfig.js", import.meta.url),
      "utf8"
    ),
    readFile(new URL("../src/services/authService.js", import.meta.url), "utf8"),
    readFile(
      new URL("../src/services/inventoryService.js", import.meta.url),
      "utf8"
    ),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("./firebase-emulators-start.mjs", import.meta.url),
      "utf8"
    ),
    readFile(new URL("../src/features/auth/Login.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/InventoryPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/companyService.js", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    readFile(new URL("../.env.existing", import.meta.url), "utf8"),
    readFile(new URL("../.env.emulator", import.meta.url), "utf8"),
  ]);
assert.match(firebaseConfigSource, /connectAuthEmulator/);
assert.match(firebaseConfigSource, /connectFirestoreEmulator/);
assert.match(firebaseConfigSource, /connectFunctionsEmulator/);
assert.match(firebaseConfigSource, /connectStorageEmulator/);
assert.match(authServiceSource, /assertClientWriteAllowed\("crear cuentas"\)/);
assert.match(inventoryServiceSource, /assertCloudFunctionAllowed/);
assert.match(inventoryServiceSource, /assertClientWriteAllowed/);
const packageJson = JSON.parse(packageSource);
assert.equal(packageJson.scripts.dev, "vite --mode existing");
assert.equal(packageJson.scripts["dev:existing"], packageJson.scripts.dev);
assert.equal(packageJson.scripts["dev:emulator"], "vite --mode emulator");
assert.match(packageSource, /node scripts\/firebase-emulators-start\.mjs/);
assert.match(emulatorStartSource, /auth,firestore,functions,storage/);
assert.match(emulatorStartSource, /--export-on-exit=/);
assert.match(emulatorStartSource, /--import=/);
assert.doesNotMatch(loginSource, /firebaseEnvironment\.isReadOnly/);
assert.doesNotMatch(inventoryPageSource, /firebaseEnvironment\.isReadOnly/);
assert.doesNotMatch(companyServiceSource, /firebaseEnvironment\.isReadOnly/);
assert.match(firestoreRulesSource, /function isOwner\(uid\)/);
assert.match(firestoreRulesSource, /request\.auth\.uid == uid/);
assert.match(firestoreRulesSource, /hasValidDocumentOwner\(uid\)/);

const actualExisting = resolveFirebaseEnvironment(parseEnvFile(existingEnvSource), {
  isDev: true,
});
assert.equal(actualExisting.mode, "existing");
assert.equal(actualExisting.isEmulator, false);
assert.equal(actualExisting.isReadOnly, false);

const actualEmulator = resolveFirebaseEnvironment(parseEnvFile(emulatorEnvSource), {
  isDev: true,
});
assert.equal(actualEmulator.mode, "emulator");
assert.equal(actualEmulator.isEmulator, true);
assert.equal(actualEmulator.isReadOnly, false);

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const viteExisting = resolveFirebaseEnvironment(loadEnv("existing", projectRoot, ""), {
  isDev: true,
});
const viteEmulator = resolveFirebaseEnvironment(loadEnv("emulator", projectRoot, ""), {
  isDev: true,
});
assert.equal(viteExisting.mode, "existing");
assert.equal(viteExisting.isEmulator, false);
assert.equal(viteExisting.isReadOnly, false);
assert.equal(viteEmulator.mode, "emulator");
assert.equal(viteEmulator.isEmulator, true);
assert.deepEqual(viteEmulator.ports, actualEmulator.ports);

console.log("FIREBASE_ENVIRONMENT_SMOKE_OK");
