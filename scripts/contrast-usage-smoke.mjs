import assert from "node:assert/strict";
import {readdir, readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

// GUARDIA DE USO DE COLOR DE TEXTO — complementa a contrast-smoke.mjs.
//
// contrast-smoke mide pares token/token, pero no sabe QUÉ selector usa QUÉ
// token como texto. Así pasó que platform.css pintaba títulos con
// --color-dark-ink (el fondo del sidebar, que no cambia con el tema) y
// quedaban casi invisibles en oscuro con test:contrast en verde.
//
// Regla: ningún CSS (ni estilos inline de JSX) puede usar como color de TEXTO
// (color, fill, stroke) un token que no cambia con el tema:
//   --color-dark-*                  (familia fija del sidebar y del login)
//   --color-brand-600/700/800/900   (como texto sobre superficie oscura miden
//                                    1.1:1 a 3.1:1)
// Alternativas con valor oscuro propio, que dan lo mismo en claro:
//   --color-text-brand, --color-text-brand-accent, --color-text-brand-hover,
//   --color-text-strong/default/muted, --color-text-on-strong.
//
// Un uso se tolera solo si cumple UNA de estas condiciones, todas visibles:
//   1. Está en ALLOWLIST (abajo), con motivo por escrito.
//   2. La misma regla pinta un fondo brand-50/100/200 (par claro fijo: texto
//      de marca sobre fondo de marca, ambos fijos; no depende del tema).
//   3. Existe un override oscuro del mismo selector y propiedad dentro de
//      :where(:root[data-theme="dark"]) (corrección selector por selector de
//      las etapas anteriores). Es DEUDA TRANSITORIA: se cuenta e imprime, y el
//      objetivo es migrarla a los tokens de arriba.
//   4. Una regla posterior del mismo archivo con el mismo selector reemplaza
//      la propiedad por un valor permitido (la cascada la anula).
//
// Uso: node scripts/contrast-usage-smoke.mjs [--root <carpeta con src/>]
// (--root sirve para demostrar que el guardia falla con código anterior).

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf("--root");
const ROOT = rootFlag >= 0
  ? path.resolve(argv[rootFlag + 1])
  : fileURLToPath(new URL("..", import.meta.url));

const TEXT_PROPS = new Set(["color", "fill", "stroke"]);
const FORBIDDEN = /var\(\s*--color-(dark-[a-z-]+|brand-(?:600|700|800|900))\s*[,)]/;
const FIXED_LIGHT_BG = /var\(\s*--color-brand-(?:50|100|200)\s*[,)]/;

// Lista blanca. Cada entrada: archivo, selector y por qué es legítimo.
const ALLOWLIST = [
  {
    file: "src/styles/platform.css",
    selector: /^\.platform-(?:sidebar|brand|nav|mobile-heading)/,
    reason: "Sidebar de la consola: fondo --color-dark-ink fijo en ambos temas, por diseño (tokens.css, familia --color-dark-*).",
  },
  {
    file: "src/features/auth/login.css",
    selector: /^\.auth-stage/,
    reason: "Panel visual del login (AuthStage): fondo --color-dark-* fijo en ambos temas, por diseño.",
  },
  {
    file: "src/styles/layout.css",
    selector: /^\.brand-mark\.brand-mark--on-dark$/,
    reason: "BrandMark onDark: se dibuja sobre el sidebar/login oscuros fijos.",
  },
  {
    file: "src/features/quotes/public-quote.css",
    selector: /^\.public-proposal/,
    reason: "Propuesta pública: .public-proposal fija los tokens claros en su raíz (bloque oscuro de ese archivo), así que brand-600/700 caen sobre superficies claras.",
  },
  {
    file: "src/components/BrandLogo.jsx",
    reason: "CubeIcon: logo de reemplazo en documentos impresos (cotización, orden, compra, venta), papel blanco fijo.",
  },
];

// --- Lectura de archivos -------------------------------------------------

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await walk(full, out);
    } else out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file).replace(/\\/g, "/");

// --- Parser mínimo de CSS (con anidado) -----------------------------------
// Devuelve nodos {selector, decls:[{prop,value,line}], children, line}.

function parseCss(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const root = {selector: "", decls: [], children: [], line: 1};
  const stack = [root];
  let buffer = "";
  let bufferLine = 1;
  let line = 1;
  let paren = 0;
  let quote = "";
  const top = () => stack[stack.length - 1];

  const flushDecl = () => {
    const raw = buffer.trim();
    buffer = "";
    if (!raw || raw.startsWith("@")) return;
    const colon = raw.indexOf(":");
    if (colon < 0) return;
    top().decls.push({prop: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim(), line: bufferLine});
  };

  for (const ch of text) {
    if (ch === "\n") line += 1;
    if (!buffer.trim()) bufferLine = line;
    if (quote) {
      buffer += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buffer += ch; continue; }
    if (ch === "(") paren += 1;
    if (ch === ")") paren -= 1;
    if (paren > 0) { buffer += ch; continue; }
    if (ch === "{") {
      const node = {selector: buffer.trim().replace(/\s+/g, " "), decls: [], children: [], line: bufferLine};
      top().children.push(node);
      stack.push(node);
      buffer = "";
    } else if (ch === "}") {
      flushDecl();
      if (stack.length > 1) stack.pop();
    } else if (ch === ";") {
      flushDecl();
    } else buffer += ch;
  }
  return root;
}

const DARK_PREFIX = /^:where\(:root\[data-theme="dark"\]\)\s*/;

function splitList(selector) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(current.trim()); current = ""; } else current += ch;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

// Aplana el árbol a reglas {selectors:[{text,dark}], decls, line}.
function flatten(node, parents, dark, out) {
  for (const child of node.children) {
    if (child.selector.startsWith("@")) {
      flatten(child, parents, dark, out);
      continue;
    }
    const items = splitList(child.selector).map((raw) => {
      let text = raw;
      let isDark = dark;
      if (DARK_PREFIX.test(text)) { text = text.replace(DARK_PREFIX, "").trim(); isDark = true; }
      return {text, dark: isDark};
    });
    const wrapperOnly = items.length === 1 && items[0].text === "" && items[0].dark;
    const selectors = [];
    if (wrapperOnly) selectors.push(...parents.map((p) => ({text: p.text, dark: true})));
    else {
      for (const item of items) {
        const bases = parents.length ? parents : [{text: "", dark}];
        for (const base of bases) {
          const joined = !base.text ? item.text
            : item.text.includes("&") ? item.text.replace(/&/g, base.text) : `${base.text} ${item.text}`;
          selectors.push({text: joined.trim(), dark: item.dark || base.dark});
        }
      }
    }
    if (child.decls.length && !wrapperOnly) out.push({selectors, decls: child.decls, line: child.line});
    flatten(child, wrapperOnly ? [{text: "", dark: true}] : selectors, wrapperOnly ? true : dark, out);
  }
}

function allowed(file, selectorText) {
  return ALLOWLIST.some((entry) => entry.file === file && (!entry.selector || entry.selector.test(selectorText)));
}

// --- Escaneo de CSS --------------------------------------------------------

function scanCssFile(file, source, report) {
  const rules = [];
  flatten(parseCss(source), [], false, rules);
  const darkOverrides = new Map(); // `${selector}|${prop}`
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (!sel.dark) continue;
      for (const decl of rule.decls) darkOverrides.set(`${sel.text}|${decl.prop}`, true);
    }
  }
  rules.forEach((rule, index) => {
    const lightSelectors = rule.selectors.filter((sel) => !sel.dark);
    if (!lightSelectors.length) return;
    for (const decl of rule.decls) {
      if (!TEXT_PROPS.has(decl.prop) || !FORBIDDEN.test(decl.value)) continue;
      const token = FORBIDDEN.exec(decl.value)[1];
      const fixedLightBg = rule.decls.some((d) => /^background(-color)?$/.test(d.prop) && FIXED_LIGHT_BG.test(d.value));
      for (const sel of lightSelectors) {
        if (allowed(file, sel.text)) { report.allowlisted += 1; continue; }
        if (fixedLightBg) { report.fixedPairs += 1; continue; }
        if (darkOverrides.has(`${sel.text}|${decl.prop}`)) { report.darkOverridden += 1; continue; }
        const superseded = rules.slice(index + 1).some((later) =>
          later.selectors.some((s) => !s.dark && s.text === sel.text) &&
          later.decls.some((d) => d.prop === decl.prop && !FORBIDDEN.test(d.value)));
        if (superseded) { report.superseded += 1; continue; }
        report.violations.push({file, line: decl.line, where: sel.text, detail: `${decl.prop}: ${decl.value} (--color-${token})`});
      }
    }
  });
}

// --- Escaneo de JSX/JS (estilos inline) ---------------------------------------

const INLINE_RE = /\b(color|fill|stroke)\s*[:=]\s*\{?\s*["'`](var\(\s*--color-(?:dark-[a-z-]+|brand-(?:600|700|800|900))\s*[,)][^"'`]*)["'`]/;

function scanScriptFile(file, source, report) {
  if (allowed(file, "")) { report.allowlisted += 1; return; }
  const lines = source.split("\n");
  const indentOf = (text) => text.length - text.trimStart().length;
  lines.forEach((text, index) => {
    const match = INLINE_RE.exec(text);
    if (!match) return;
    // Bloque de objeto que contiene la línea: hacia arriba hasta una línea que
    // abre "{" con menos sangría; hacia abajo hasta que se cierra.
    const own = indentOf(text);
    let start = index;
    while (start > 0 && !(lines[start - 1].trimEnd().endsWith("{") && indentOf(lines[start - 1]) < own)) start -= 1;
    let end = index;
    while (end < lines.length - 1 && !(/^\s*\}/.test(lines[end + 1]) && indentOf(lines[end + 1]) < own)) end += 1;
    const block = lines.slice(start, end + 1).join("\n");
    if (/background(?:Color)?\s*:\s*["'`]var\(\s*--color-brand-(?:50|100|200)\s*[,)]/.test(block)) { report.fixedPairs += 1; return; }
    report.violations.push({file, line: index + 1, where: "(estilo inline)", detail: match[0]});
  });
}

// --- Principal -------------------------------------------------------------------

async function main() {
  const files = (await walk(path.join(ROOT, "src"))).map((f) => ({full: f, name: rel(f)}));
  const report = {violations: [], allowlisted: 0, fixedPairs: 0, darkOverridden: 0, superseded: 0, scanned: 0};

  for (const {full, name} of files) {
    if (/\.css$/.test(name)) {
      if (name === "src/styles/tokens.css") continue; // define los tokens; no los consume como texto
      scanCssFile(name, await readFile(full, "utf8"), report);
      report.scanned += 1;
    } else if (/\.(jsx|js)$/.test(name) && !/\.test\./.test(name)) {
      scanScriptFile(name, await readFile(full, "utf8"), report);
      report.scanned += 1;
    }
  }

  if (report.violations.length) {
    console.error(`FALLÓ: ${report.violations.length} uso(s) de color de texto que no cambian con el tema.`);
    console.error("Usa --color-text-brand / -accent / -hover, --color-text-strong/default/muted o --color-text-on-strong.");
    for (const v of report.violations) console.error(`  - ${v.file}:${v.line}  ${v.where}  ${v.detail}`);
    assert.fail("contrast-usage-smoke: ver violaciones arriba");
  }

  console.log(
    `OK: ${report.scanned} archivos revisados; 0 violaciones. ` +
    `Tolerados: ${report.allowlisted} en lista blanca, ${report.fixedPairs} pares claros fijos (fondo brand-50/100/200), ` +
    `${report.superseded} anulados por cascada, ${report.darkOverridden} con override oscuro por selector (deuda transitoria a migrar a tokens).`
  );
  console.log("CONTRAST_USAGE_SMOKE_OK");
}

export {parseCss, flatten, scanCssFile, scanScriptFile};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  });
}
