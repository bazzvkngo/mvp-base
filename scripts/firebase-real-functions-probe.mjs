import { randomBytes } from "node:crypto";
import { deleteApp, initializeApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyAGB0metkzNnJOtvI0zsft-NvIb5uoKBXA",
  authDomain: "tesis-inventario-ia.firebaseapp.com",
  projectId: "tesis-inventario-ia",
  storageBucket: "tesis-inventario-ia.firebasestorage.app",
  messagingSenderId: "1030324613425",
  appId: "1:1030324613425:web:27b82796bd1e955c2ac010",
};

const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const app = initializeApp(firebaseConfig, `function-probe-${runId}`);
const functions = getFunctions(app, "us-central1");
const probes = [
  ["initializeInventoryCatalog", null],
  ["saveInventoryArea", {}],
  ["saveInventoryCategory", {}],
  ["createInventoryItemWithCode", {}],
  ["confirmInventoryImportV2", {}],
  ["createQuoteWithNumber", {}],
  ["updateQuoteDraft", {}],
  ["sendQuoteEmail", {}],
];
const results = [];

try {
  for (const [name, payload] of probes) {
    try {
      const callable = httpsCallable(functions, name, { timeout: 60_000 });
      const response = await callable(payload ?? {});
      results.push({ name, status: "deployed-success", data: response.data ?? null });
    } catch (error) {
      const code = String(error?.code || "unknown");
      results.push({
        name,
        status: code === "functions/not-found" ? "not-deployed" : "deployed-rejected-input",
        code,
        message: String(error?.message || error).slice(0, 300),
      });
    }
  }
} finally {
  await deleteApp(app).catch(() => {});
}

console.log(JSON.stringify({ projectId: firebaseConfig.projectId, results }, null, 2));
