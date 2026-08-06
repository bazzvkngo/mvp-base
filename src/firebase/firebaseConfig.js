import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { firebaseEnvironment } from "../config/firebaseEnvironment.mjs";

const firebaseConfig = {
  apiKey: "AIzaSyAGB0metkzNnJOtvI0zsft-NvIb5uoKBXA",
  authDomain: "tesis-inventario-ia.firebaseapp.com",
  projectId: "tesis-inventario-ia",
  storageBucket: "tesis-inventario-ia.firebasestorage.app",
  messagingSenderId: "1030324613425",
  appId: "1:1030324613425:web:27b82796bd1e955c2ac010",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

if (firebaseEnvironment.isEmulator) {
  const registry = globalThis.__valoracloudFirebaseEmulators || {};
  globalThis.__valoracloudFirebaseEmulators = registry;

  if (!registry.auth) {
    connectAuthEmulator(
      auth,
      `http://${firebaseEnvironment.hosts.core}:${firebaseEnvironment.ports.auth}`,
      {
        disableWarnings: true,
      }
    );
    registry.auth = true;
  }
  if (!registry.firestore) {
    connectFirestoreEmulator(
      db,
      firebaseEnvironment.hosts.core,
      firebaseEnvironment.ports.firestore
    );
    registry.firestore = true;
  }
  if (!registry.storage) {
    connectStorageEmulator(
      storage,
      firebaseEnvironment.hosts.storage,
      firebaseEnvironment.ports.storage
    );
    registry.storage = true;
  }
}

export function getFirebaseFunctions(region = "us-central1") {
  const functions = getFunctions(app, region);
  if (!firebaseEnvironment.isEmulator) return functions;

  const registry = globalThis.__valoracloudFirebaseEmulators || {};
  globalThis.__valoracloudFirebaseEmulators = registry;
  const registryKey = `functions:${region}`;
  if (!registry[registryKey]) {
    connectFunctionsEmulator(
      functions,
      firebaseEnvironment.hosts.functions,
      firebaseEnvironment.ports.functions
    );
    registry[registryKey] = true;
  }
  return functions;
}
