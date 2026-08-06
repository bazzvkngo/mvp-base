import { createRequire } from "node:module";

const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const { initializeApp, deleteApp } = requireFromFunctions("firebase-admin/app");
const {
  FieldValue,
  getFirestore,
} = requireFromFunctions("firebase-admin/firestore");
const {
  buildBusinessCatalogSeedEntries,
} = requireFromFunctions("./businessOnboarding");

const PROJECT_ID = "tesis-inventario-ia";
const useEmulator = process.argv.includes("--emulator");
const allowRemoteDevelopment = process.argv.includes(
  "--allow-remote-development"
);

if (useEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
}

if (!useEmulator && !allowRemoteDevelopment) {
  throw new Error(
    "Se rechazó la escritura remota. Usa --emulator o confirma el entorno de desarrollo con --allow-remote-development."
  );
}

const projectArgumentIndex = process.argv.indexOf("--project");
const requestedProject =
  projectArgumentIndex >= 0 ? process.argv[projectArgumentIndex + 1] : PROJECT_ID;
if (requestedProject !== PROJECT_ID) {
  throw new Error(`Proyecto no autorizado para este seed: ${requestedProject}`);
}

const app = initializeApp({ projectId: requestedProject }, "business-catalog-seed");
const db = getFirestore(app);

try {
  const entries = buildBusinessCatalogSeedEntries();
  if (entries.length > 500) {
    throw new Error(`El catálogo excede el límite de un batch: ${entries.length}`);
  }

  const batch = db.batch();
  const updatedAt = FieldValue.serverTimestamp();
  for (const entry of entries) {
    batch.set(db.collection(entry.collection).doc(entry.id), {
      ...entry.data,
      catalogVersion: 1,
      actualizadoEn: updatedAt,
    });
  }
  await batch.commit();

  const counts = entries.reduce((result, entry) => {
    result[entry.collection] = (result[entry.collection] || 0) + 1;
    return result;
  }, {});
  console.log(
    "BUSINESS_CATALOG_SEED_OK",
    JSON.stringify({
      projectId: requestedProject,
      target: useEmulator ? "emulator" : "remote-development",
      counts,
    })
  );
} finally {
  await deleteApp(app);
}