// Verificación previa al despliegue. NO despliega nada: solo lee y ejecuta
// comprobaciones locales. Nunca invoca `firebase deploy` ni otro comando de
// despliegue; los scripts con emuladores usan `firebase emulators:exec`, que
// corre contra emuladores locales.
//
// Uso:
//   npm run verify:deploy                 comprobaciones sin emuladores
//   npm run verify:deploy -- --emuladores suma reglas y Functions con emuladores
//   npm run verify:deploy -- --detalle    muestra la salida completa de cada prueba
// Termina con "Fallas: N" y código de salida distinto de 0 si N > 0.
import {spawnSync} from "node:child_process";
import fs from "node:fs";

const EXPECTED_PROJECT = "tesis-inventario-ia";
const withEmulators = process.argv.includes("--emuladores");
const verbose = process.argv.includes("--detalle");
const isWindows = process.platform === "win32";

const SMOKE_SCRIPTS = [
  "test:design",
  "test:contrast",
  "test:contrast-usage",
  "test:storage-rules-budget",
  "test:quote-model",
  "test:quote-email",
  "test:quote-public",
  "test:sales-model",
  "test:rbac",
];
const EMULATOR_SCRIPTS = [
  "test:rules",
  "test:business-verification-rules",
];

const results = [];
const packageScripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts || {};

function run(name, execute) {
  console.log(`\n== ${name}`);
  const started = Date.now();
  let ok = false;
  let detail = "";
  try {
    ({ok, detail = ""} = execute());
  } catch (error) {
    detail = error.message;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok ? "OK    " : "FALLA "}${name} (${seconds}s)${detail ? ` ${detail}` : ""}`);
  results.push({name, ok});
}

function command(cmd, args) {
  return () => {
    // Defensa: este script jamás debe desplegar.
    if ([cmd, ...args].some((part) => /(^|\s)deploy(\s|$)/.test(part))) {
      throw new Error("comando de despliegue bloqueado");
    }
    const result = spawnSync(cmd, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      shell: isWindows,
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    if (verbose) process.stdout.write(output);
    if (result.status !== 0 && !verbose) {
      const tail = output.trim().split(/\r?\n/).slice(-40).join("\n");
      console.log(tail);
    }
    return {ok: result.status === 0, detail: `[exit ${result.status}]`};
  };
}

const npmScript = (name) => command("npm", ["run", name]);

function readJson(file) {
  return () => {
    JSON.parse(fs.readFileSync(file, "utf8"));
    return {ok: true};
  };
}

run(`Proyecto Firebase por defecto = ${EXPECTED_PROJECT}`, () => {
  const current = JSON.parse(fs.readFileSync(".firebaserc", "utf8")).projects?.default;
  return {ok: current === EXPECTED_PROJECT, detail: `(actual: ${current})`};
});
run("firebase.json es JSON válido", readJson("firebase.json"));
run("firestore.indexes.json es JSON válido", readJson("firestore.indexes.json"));
run("Los scripts npm que se invocan existen en package.json", () => {
  const missing = [...SMOKE_SCRIPTS, ...(withEmulators ? EMULATOR_SCRIPTS : [])]
    .filter((name) => !packageScripts[name]);
  return {ok: missing.length === 0, detail: missing.length ? `(faltan: ${missing.join(", ")})` : ""};
});
run("git diff --check", command("git", ["diff", "--check"]));
run("Lint de functions", command("npm", ["--prefix", "functions", "run", "lint"]));
run("Build del frontend", npmScript("build"));
SMOKE_SCRIPTS.forEach((name) => run(name, npmScript(name)));
if (withEmulators) {
  EMULATOR_SCRIPTS.forEach((name) => run(`${name} (emuladores)`, npmScript(name)));
} else {
  console.log("\nOmitidas (requieren emuladores): " + EMULATOR_SCRIPTS.join(", ") +
    ". Usa --emuladores antes de tocar reglas.");
}

const dirty = spawnSync("git", ["status", "--short"], {encoding: "utf8", shell: isWindows}).stdout.trimEnd();
if (dirty) console.log(`\nAVISO: hay cambios sin commitear:\n${dirty}`);

const failures = results.filter((result) => !result.ok);
if (failures.length) console.log(`\nFallaron: ${failures.map((result) => result.name).join(", ")}`);
console.log(`\nComprobaciones: ${results.length}  Fallas: ${failures.length}`);
process.exit(failures.length ? 1 : 0);
