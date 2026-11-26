import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "veterinary-package-"));
try {
  const staging = join(scratch, "staging");
  const domain = "src/features/veterinary/domain";
  const packaged = join(staging, "functions/veterinary-models");
  mkdirSync(packaged, {recursive: true});
  mkdirSync(join(staging, "scripts"));
  writeFileSync(join(packaged, "obsolete.mjs"), "throw Error('obsolete');");
  cpSync(join(root, domain), join(staging, domain), {recursive: true});
  const script = "scripts/package-veterinary-models.cjs";
  cpSync(join(root, script), join(staging, script));
  execFileSync(process.execPath, [join(staging, script)]);
  assert.equal(existsSync(join(packaged, "obsolete.mjs")), false);

  const isolated = join(scratch, "isolated");
  const functions = join(isolated, "functions");
  mkdirSync(functions, {recursive: true});
  for (const name of readdirSync(join(root, "functions"))) {
    if (/^[a-zA-Z0-9_-]+\.(js|json)$/.test(name)) {
      cpSync(join(root, "functions", name), join(functions, name));
    }
  }
  cpSync(packaged, join(functions, "veterinary-models"), {recursive: true});
  assert.equal(existsSync(join(isolated, "src")), false);
  const require = createRequire(join(functions, "package.json"));
  const {importVeterinaryModel} = require("./veterinaryModels");
  const {resolveVeterinaryAppointmentTimeZone} = require("./veterinaryAppointmentPersistence");
  const {countries} = require("./businessCatalog.json");
  for (const {code} of countries) {
    const zone = resolveVeterinaryAppointmentTimeZone(code);
    if (code === "OTHER") assert.equal(zone, null);
    else assert.ok(zone && new Intl.DateTimeFormat("en", {timeZone: zone}).resolvedOptions().timeZone, code);
  }
  for (const code of [null, "", "ZZ"]) assert.equal(resolveVeterinaryAppointmentTimeZone(code), null);

  const names = readdirSync(join(root, domain)).filter((name) => name.endsWith(".mjs"));
  assert.deepEqual(readdirSync(join(functions, "veterinary-models")), names);
  for (const name of names) {
    const original = join(root, domain, name);
    assert.deepEqual(readFileSync(join(functions, "veterinary-models", name)), readFileSync(original));
    const deployed = await importVeterinaryModel(name.slice(0, -4));
    const source = await import(pathToFileURL(original).href);
    assert.deepEqual(Object.keys(deployed), Object.keys(source));
  }
  console.log("VETERINARY_PACKAGING_SMOKE_OK");
} finally {
  rmSync(scratch, {recursive: true, force: true});
}
