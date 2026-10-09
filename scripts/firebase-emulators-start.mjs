import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
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
  .sort((left, right) =>
    statSync(resolve(workspaceDirectory, right)).mtimeMs -
    statSync(resolve(workspaceDirectory, left)).mtimeMs
  );

function restoreLatestBackup() {
  if (!backupDirectories.length) return false;
  if (existsSync(dataDirectory) && readdirSync(dataDirectory).length > 0) {
    console.error(
      "No se iniciaron los emuladores: .firebase-emulator-data está incompleta y no se sobrescribirá automáticamente."
    );
    process.exit(1);
  }
  const backupName = backupDirectories[0];
  const backupDirectory = resolve(workspaceDirectory, backupName);
  mkdirSync(dataDirectory, {recursive: true});
  readdirSync(backupDirectory, {withFileTypes: true}).forEach((entry) => {
    cpSync(
      resolve(backupDirectory, entry.name),
      resolve(dataDirectory, entry.name),
      {recursive: true, force: false, errorOnExist: true}
    );
  });
  console.log(`Se restauró automáticamente el respaldo más reciente: ${backupName}`);
  return existsSync(metadataFile);
}

if (!existsSync(metadataFile) && backupDirectories.length && !restoreLatestBackup()) {
  console.error("No fue posible restaurar el respaldo local más reciente.");
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
  // Firebase reutiliza el directorio importado como destino de exportación
  // cuando --export-on-exit no recibe valor explícito.
  args.push(`--import=${dataDirectory}`, "--export-on-exit");
} else {
  args.push(`--export-on-exit=${dataDirectory}`);
}

const child = spawn("firebase", args, {
  shell: process.platform === "win32",
  stdio: "inherit",
});

let shutdownRequested = false;

function waitForFirebaseExport(signal) {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.log(
    "\nCerrando emuladores. Espera el mensaje de exportación completada antes de cerrar la terminal."
  );
  // En Windows, Ctrl+C también llega al proceso Firebase del mismo terminal.
  // Mantener vivo este wrapper permite que Firebase complete --export-on-exit.
  if (process.platform !== "win32") child.kill(signal);
}

process.on("SIGINT", () => waitForFirebaseExport("SIGINT"));
process.on("SIGTERM", () => waitForFirebaseExport("SIGTERM"));

child.on("error", (error) => {
  console.error("No fue posible iniciar Firebase Emulator Suite:", error.message);
  process.exitCode = 1;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
