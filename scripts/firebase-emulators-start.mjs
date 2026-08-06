import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const projectId = "tesis-inventario-ia";
const dataDirectoryName = ".firebase-emulator-data";
const dataDirectory = resolve(dataDirectoryName);
const metadataFile = resolve(
  dataDirectory,
  "firebase-export-metadata.json"
);
const args = [
  "emulators:start",
  "--only",
  "auth,firestore,functions,storage",
  "--project",
  projectId,
  `--export-on-exit=${dataDirectoryName}`,
];

if (existsSync(metadataFile)) {
  args.push(`--import=${dataDirectoryName}`);
}

const child = spawn("firebase", args, {
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error("No fue posible iniciar Firebase Emulator Suite:", error.message);
  process.exitCode = 1;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
