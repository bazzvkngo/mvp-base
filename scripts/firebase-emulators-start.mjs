import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectId = "tesis-inventario-ia";
const dataDirectoryName = ".firebase-emulator-data";
const dataDirectory = resolve(dataDirectoryName);
const workspaceDirectory = resolve(".");
const metadataFile = resolve(
  dataDirectory,
  "firebase-export-metadata.json"
);
const backupDirectories = readdirSync(workspaceDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("firebase-export-"))
  .map((entry) => entry.name)
  .sort();

if (!existsSync(metadataFile) && backupDirectories.length) {
  console.error(
    "No se iniciaron los emuladores porque falta .firebase-emulator-data y existen respaldos locales: " +
      `${backupDirectories.join(", ")}. Restaura explícitamente el respaldo correcto antes de iniciar.`
  );
  process.exit(1);
}

const args = [
  "emulators:start",
  "--only",
  "auth,firestore,functions,storage",
  "--project",
  projectId,
];

if (existsSync(metadataFile)) {
  // Firebase usa el directorio importado como destino al omitir el valor de
  // --export-on-exit. Así se evita que genere un firebase-export-* automático.
  args.push("--import", dataDirectory, "--export-on-exit");
} else {
  args.push("--export-on-exit", dataDirectory);
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
