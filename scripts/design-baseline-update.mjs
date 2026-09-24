import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {scanRepo, countBy} from "./design-smoke.mjs";

// Regenera los conteos de scripts/design-baseline.json a partir del mismo
// escáner que usa test:design (scanRepo), para que la baseline nunca se
// desincronice de la lógica real de conteo. Conserva category/note de cada
// archivo ya conocido (son curatoriales, no se derivan del escaneo) y avisa
// de archivos nuevos que necesitan categoría/nota manual, y de archivos que
// ya no tienen literales (candidatos a quitar de la baseline).
//
// Uso: node scripts/design-baseline-update.mjs [--write]
// Sin --write, solo muestra qué cambiaría (dry run).

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = path.join(ROOT, "scripts/design-baseline.json");

async function main() {
  const write = process.argv.includes("--write");
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  const current = await scanRepo();

  const newLiterals = {};
  const changed = [];
  const missingMeta = [];
  for (const [rel, found] of Object.entries(current)) {
    const c = countBy(found);
    const prev = baseline.literals[rel];
    if (!prev) {
      missingMeta.push(rel);
      newLiterals[rel] = {...c, category: "c", note: "PENDIENTE: asignar categoría y nota manualmente."};
      continue;
    }
    newLiterals[rel] = {...c, category: prev.category, note: prev.note};
    for (const k of ["color", "radius", "shadow", "duration"]) {
      if (prev[k] !== c[k]) changed.push(`${rel}: ${k} ${prev[k]} -> ${c[k]}`);
    }
  }
  const removed = Object.keys(baseline.literals).filter((rel) => !current[rel]);

  console.log(`Archivos con literales ahora: ${Object.keys(newLiterals).length} (antes ${Object.keys(baseline.literals).length})`);
  if (changed.length) {
    console.log(`Conteos que cambian (${changed.length}):`);
    for (const c of changed) console.log(`  - ${c}`);
  } else {
    console.log("Ningún conteo cambia.");
  }
  if (missingMeta.length) {
    console.log(`Archivos nuevos sin categoría/nota (revisar a mano antes de --write):`);
    for (const f of missingMeta) console.log(`  - ${f}`);
  }
  if (removed.length) {
    console.log(`Archivos que ya no tienen literales (se quitan de la baseline):`);
    for (const f of removed) console.log(`  - ${f}`);
  }

  if (write) {
    baseline.literals = newLiterals;
    await writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log("Escrito scripts/design-baseline.json.");
  } else {
    console.log("Dry run: nada escrito. Ejecuta con --write para aplicar.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
