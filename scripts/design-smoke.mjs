import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {parse} from "@babel/parser";
import traverseModule from "@babel/traverse";

// PROTECCIÓN DEL SISTEMA DE DISEÑO — ratchet de literales.
//
// Qué protege: que trabajo nuevo herede src/styles/tokens.css en vez de
// escribir colores (#hex, rgb()/rgba(), hsl()/hsla(), nombres de color),
// radios, sombras o duraciones sueltos en CSS, estilos inline o CSS-in-JS.
//
// Cómo: compara un conteo por archivo contra scripts/design-baseline.json.
//  - Un archivo NUEVO con >=1 literal falla (nada nuevo entra sin token).
//  - Un archivo conocido que SUPERA su tope falla (no crece la deuda).
//  - Un archivo conocido que BAJA su conteo solo avisa (no fuerza a
//    actualizar la baseline; conviene hacerlo, pero no bloquea).
//  - tokens.css está exento (es la fuente de los tokens).
// Además valida dos reglas baratas:
//  - Ninguna clase .ui-* nueva se define fuera de components.css (las ya
//    existentes están en uiClassExceptions con su motivo).
//  - Ningún CSS/JS importa el CSS de otro feature salvo las excepciones
//    listadas en cssCrossFeatureImports.
//
// No sustituye revisión humana: no puede saber si un literal nuevo es un
// hueco real de la escala (que debería ir a tokens.css) o deuda evitable.

const traverse = traverseModule.default ?? traverseModule;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = path.join(ROOT, "src");
const TOKENS_CSS = "src/styles/tokens.css";

const NAMED_COLORS =
  "white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|cyan|magenta|navy|teal|maroon|olive|lime|aqua|silver|gold|crimson|indigo|violet|salmon|tomato|coral|khaki|beige|ivory|lavender|tan|azure|orchid|plum|slateblue|slategray|slategrey|dimgray|dimgrey|lightgray|lightgrey|darkgray|darkgrey|whitesmoke|gainsboro";
const RE_HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const RE_FUNC = /\b(?:rgba?|hsla?)\(/gi;
const RE_NAMED = new RegExp(`(?<![\\w#.-])(?:${NAMED_COLORS})(?![\\w-])`, "gi");
const RE_DUR = /(?<![\w.-])-?\d*\.?\d+(?:ms|s)(?![\w-])/g;
const RE_RADIUS_LIT = /(?<![\w.-])-?\d*\.?\d+(?:px|rem|em|%)?(?![\w-])/g;
const COLOR_PROPS =
  /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)(-color)?|border-color|outline|outline-color|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration|text-decoration-color|filter|column-rule|scrollbar-color|--[\w-]+)$/;

// --- Falsos positivos: comentarios, var()/url() (incluido el fallback). ---

function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function stripVarUrl(value) {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const m = /^(var|url)\(/i.exec(value.slice(i));
    if (m) {
      let depth = 0;
      let j = i + m[0].length - 1;
      for (; j < value.length; j++) {
        if (value[j] === "(") depth++;
        else if (value[j] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      out += " ".repeat(j - i + 1);
      i = j + 1;
    } else {
      out += value[i];
      i++;
    }
  }
  return out;
}

function scanValueColors(prop, rawValue) {
  const found = [];
  const value = stripVarUrl(rawValue);
  for (const m of value.matchAll(RE_HEX)) found.push({k: "color", lit: m[0]});
  for (const m of value.matchAll(RE_FUNC)) found.push({k: "color", lit: m[0] + "…"});
  if (COLOR_PROPS.test(prop)) {
    for (const m of value.matchAll(RE_NAMED)) found.push({k: "color", lit: m[0]});
  }
  return found;
}

function scanDecl(prop, rawValue) {
  const p = prop.toLowerCase();
  const value = stripVarUrl(rawValue);
  const out = scanValueColors(prop, rawValue);
  const isRadiusProp =
    /^border(-(top|bottom)-(left|right))?-radius$|^border-radius$/.test(p) || p === "borderradius";
  if (isRadiusProp && !/var\(/.test(rawValue)) {
    for (const m of value.matchAll(RE_RADIUS_LIT)) {
      if (parseFloat(m[0]) !== 0) out.push({k: "radius", lit: m[0]});
    }
  }
  if (p === "box-shadow" || p === "text-shadow" || p === "boxshadow") {
    if (value.trim() && !/^\s*(none|inherit|initial|unset)\s*$/i.test(value)) {
      out.push({k: "shadow", lit: rawValue.trim().slice(0, 60)});
    }
  }
  if (/^(transition|animation)(-duration|-delay)?$/.test(p)) {
    for (const m of value.matchAll(RE_DUR)) {
      if (parseFloat(m[0]) !== 0) out.push({k: "duration", lit: m[0]});
    }
  }
  return out;
}

function scanCss(text) {
  const blanked = blankComments(text);
  const out = [];
  for (const m of blanked.matchAll(/([\w-]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
    out.push(...scanDecl(m[1], m[2]));
  }
  return out;
}

function scanJs(text, filePath) {
  let ast;
  try {
    ast = parse(text, {sourceType: "module", plugins: ["jsx"], errorRecovery: true});
  } catch (e) {
    throw new Error(`${filePath}: no se pudo parsear (${e.message})`);
  }
  const out = [];
  const visitStr = (val, keyName, line) => {
    if (typeof val !== "string") return;
    // Clave de propiedad de objeto inline (estilos, mapas de color): se
    // interpreta como propiedad CSS. Fuera de ese contexto solo se buscan
    // literales de color explícitos (hex / rgb / hsl), no nombres sueltos,
    // para no marcar cadenas de negocio que no son estilos.
    if (keyName) {
      const prop = keyName.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      out.push(...scanDecl(prop, val).map((o) => ({...o, line, prop})));
    } else {
      const value = stripVarUrl(val);
      for (const m of value.matchAll(RE_HEX)) out.push({k: "color", lit: m[0], line, prop: "str"});
      for (const m of value.matchAll(RE_FUNC)) out.push({k: "color", lit: m[0] + "…", line, prop: "str"});
    }
  };
  traverse(ast, {
    ImportDeclaration(p) {
      p.skip();
    },
    ObjectProperty(p) {
      const key = p.node.key;
      const name = key.type === "Identifier" ? key.name : key.type === "StringLiteral" ? key.value : null;
      const val = p.node.value;
      const line = p.node.loc?.start.line;
      if (name && val.type === "StringLiteral") {
        visitStr(val.value, name, line);
        p.get("value").skip();
      } else if (name && val.type === "TemplateLiteral" && val.expressions.length === 0) {
        visitStr(val.quasis[0].value.cooked, name, line);
        p.get("value").skip();
      }
    },
    StringLiteral(p) {
      if (p.parent.type === "ImportDeclaration" || p.parent.type === "ExportNamedDeclaration") return;
      visitStr(p.node.value, null, p.node.loc?.start.line);
    },
    TemplateElement(p) {
      visitStr(p.node.value.cooked, null, p.node.loc?.start.line);
    },
  });
  // Deduplica solo coincidencias exactas (mismo literal, misma línea, misma
  // propiedad) para no contar dos veces un nodo visitado por más de un
  // visitor; NO deduplica por valor solo, porque el mismo literal puede
  // aparecer legítimamente muchas veces en el archivo.
  const seen = new Set();
  return out.filter((o) => {
    const key = `${o.k}|${o.lit}|${o.line}|${o.prop}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function walk(dir, out) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, out);
    else out.push(p);
  }
}

function toPosix(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

async function scanRepo() {
  const files = [];
  await walk(SRC, files);
  const results = {};
  for (const abs of files) {
    const rel = toPosix(abs);
    if (rel === TOKENS_CSS) continue;
    if (/\.css$/.test(rel)) {
      const text = await readFile(abs, "utf8");
      const found = scanCss(text);
      if (found.length) results[rel] = found;
    } else if (/\.(jsx?|mjs)$/.test(rel) && !/\.(test|smoke)\./.test(rel)) {
      const text = await readFile(abs, "utf8");
      const found = scanJs(text, rel);
      if (found.length) results[rel] = found;
    }
  }
  return results;
}

function countBy(found) {
  const c = {color: 0, radius: 0, shadow: 0, duration: 0};
  for (const o of found) c[o.k]++;
  return c;
}

// --- Regla: clases .ui-* solo se definen en components.css. ---

async function scanUiClasses(baseline) {
  const files = [];
  await walk(SRC, files);
  const violations = [];
  const exceptions = baseline.uiClassExceptions ?? {};
  for (const abs of files) {
    const rel = toPosix(abs);
    if (!rel.endsWith(".css") || rel === "src/styles/components.css") continue;
    const text = await readFile(abs, "utf8");
    const blanked = blankComments(text);
    const names = new Set();
    for (const m of blanked.matchAll(/\.(ui-[a-zA-Z0-9_-]+)/g)) names.add(m[1]);
    for (const name of names) {
      const exc = exceptions[name];
      if (exc && exc.files?.includes(rel)) continue;
      violations.push({name, file: rel});
    }
  }
  return violations;
}

// --- Regla: un feature no importa el CSS de otro feature. ---

async function scanCrossFeatureImports(baseline) {
  const files = [];
  await walk(SRC, files);
  const allowed = new Set((baseline.cssCrossFeatureImports ?? []).map((e) => `${e.from}=>${e.to}`));
  const violations = [];
  const featureOf = (rel) => {
    const m = /^src\/features\/([^/]+)\//.exec(rel);
    return m ? m[1] : null;
  };
  for (const abs of files) {
    const rel = toPosix(abs);
    if (!/\.(jsx?|mjs|css)$/.test(rel)) continue;
    const text = await readFile(abs, "utf8");
    const imports = [];
    if (rel.endsWith(".css")) {
      for (const m of text.matchAll(/@import\s+["']([^"']+\.css)["']/g)) imports.push(m[1]);
    } else {
      for (const m of text.matchAll(/import\s+["']([^"']+\.css)["']/g)) imports.push(m[1]);
    }
    for (const spec of imports) {
      const targetAbs = path.resolve(path.dirname(abs), spec);
      const target = toPosix(targetAbs);
      const fFrom = featureOf(rel);
      const fTo = featureOf(target);
      // La regla es "un feature no importa el CSS de otro feature": solo
      // aplica cuando el archivo que importa vive dentro de src/features/**.
      // Una página (src/pages/**) cargando el CSS de un feature es el
      // patrón normal de entrada, no una violación de esta regla.
      if (!fFrom || !fTo || fFrom === fTo) continue;
      if (allowed.has(`${rel}=>${target}`)) continue;
      violations.push({from: rel, to: target});
    }
  }
  return violations;
}

async function main() {
  const baselinePath = path.join(ROOT, "scripts/design-baseline.json");
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));

  const current = await scanRepo();
  const failures = [];
  const warnings = [];

  const baselineFiles = new Set(Object.keys(baseline.literals ?? {}));
  const currentFiles = new Set(Object.keys(current));

  for (const rel of currentFiles) {
    const c = countBy(current[rel]);
    const cap = baseline.literals[rel];
    if (!cap) {
      failures.push(
        `${rel}: archivo nuevo con literales de diseño sin token (color=${c.color} radius=${c.radius} shadow=${c.shadow} duration=${c.duration}). ` +
          `Usa src/styles/tokens.css o, si falta un token, agrégalo ahí. Si es una excepción legítima, regístrala en scripts/design-baseline.json.`
      );
      continue;
    }
    for (const k of ["color", "radius", "shadow", "duration"]) {
      if (c[k] > cap[k]) {
        failures.push(`${rel}: ${k} subió de ${cap[k]} a ${c[k]} (tope de la baseline superado).`);
      } else if (c[k] < cap[k]) {
        warnings.push(`${rel}: ${k} bajó de ${cap[k]} a ${c[k]}. Puedes reducir el tope en scripts/design-baseline.json.`);
      }
    }
  }
  for (const rel of baselineFiles) {
    if (currentFiles.has(rel)) continue;
    const cap = baseline.literals[rel];
    const anyCap = cap.color || cap.radius || cap.shadow || cap.duration;
    if (anyCap) warnings.push(`${rel}: ya no tiene literales registrados (antes color=${cap.color} radius=${cap.radius} shadow=${cap.shadow} duration=${cap.duration}). Puedes quitarlo de la baseline.`);
  }

  const uiViolations = await scanUiClasses(baseline);
  for (const v of uiViolations) {
    failures.push(`${v.file}: define .${v.name} fuera de src/styles/components.css y no está en uiClassExceptions.`);
  }

  const importViolations = await scanCrossFeatureImports(baseline);
  for (const v of importViolations) {
    failures.push(`${v.from} importa el CSS de otro feature (${v.to}) y no está en cssCrossFeatureImports.`);
  }

  if (warnings.length) {
    console.log(`AVISO (no falla): ${warnings.length} conteo(s) bajaron o quedaron en 0.`);
    for (const w of warnings) console.log(`  - ${w}`);
  }

  if (failures.length) {
    console.error(`FALLÓ: ${failures.length} violación(es) del sistema de diseño.`);
    for (const f of failures) console.error(`  - ${f}`);
    assert.fail("design-smoke: ver violaciones arriba");
  }

  console.log(
    `OK: ${currentFiles.size} archivos con literales dentro de tope, ` +
      `${uiViolations.length === 0 ? "sin" : uiViolations.length} clases .ui-* nuevas fuera de components.css, ` +
      `${importViolations.length === 0 ? "sin" : importViolations.length} imports cruzados de CSS entre features.`
  );
  console.log("DESIGN_SMOKE_OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
