import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/services/inventoryService.js", import.meta.url),
  "utf8"
);

const importBlock = source.match(
  /import\s*\{([\s\S]*?)\}\s*from\s*["']firebase\/firestore["'];/
)?.[1] || "";
const importedFirestoreFunctions = new Set(
  importBlock
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
);
const requiredFirestoreFunctions = [
  "addDoc",
  "collection",
  "deleteField",
  "doc",
  "getDoc",
  "getDocs",
  "onSnapshot",
  "orderBy",
  "query",
  "serverTimestamp",
  "updateDoc",
  "where",
];

for (const functionName of requiredFirestoreFunctions) {
  assert.ok(
    importedFirestoreFunctions.has(functionName),
    `${functionName} debe importarse desde firebase/firestore.`
  );
}

const inventoryQueryBody = source.match(
  /function inventoryQuery\(uid\)\s*\{([\s\S]*?)\n\}/
)?.[1] || "";
const catalogQueryBody = source.match(
  /function catalogQuery\(collectionRef\)\s*\{([\s\S]*?)\n\}/
)?.[1] || "";

assert.match(inventoryQueryBody, /query\(inventoryCollectionRef\(uid\)\)/);
assert.doesNotMatch(inventoryQueryBody, /orderBy\s*\(/);
assert.match(catalogQueryBody, /orderBy\("nombreNormalizado",\s*"asc"\)/);
assert.match(source, /sortInventoryItems\s*\(/);
assert.match(source, /firebaseEnvironment\.isEmulator/);
assert.doesNotMatch(source, /import\.meta\.env\.DEV/);

console.log("INVENTORY_SERVICE_SMOKE_OK");
