import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

// AUDITORÍA DE CONTRASTE — ratchet de contraste WCAG para tokens.css.
//
// Qué protege: que un cambio futuro a un valor de src/styles/tokens.css no
// rompa en silencio uno de los pares texto/fondo o borde/fondo que se
// midieron a mano, uno por uno, a lo largo de los pasos 2-8 de la etapa 5
// (fundación de modo oscuro, familias semánticas, --color-stock-alert-*,
// --color-data-*/--color-data-cost-*/--color-quote-status-*).
//
// Cómo: lee tokens.css como texto, extrae cada `--token: #hex` de :root
// (claro) y del bloque @media (prefers-color-scheme: dark) { :root {...} }
// (oscuro, con fallback a claro para los tokens que no se redefinen ahí —
// el mismo comportamiento real de la cascada), arma los pares que ya se
// verificaron a mano (mismo criterio que se aplicó en cada commit: shade de
// texto/-700/-800 contra su propia -50 Y contra --color-surface-panel;
// shade de borde/-200/-300 contra ambos también; casos puntuales medidos
// aparte como danger-600/panel o brand-400 contra las 6 superficies), y
// calcula el contraste real con la fórmula de luminancia relativa de WCAG 2.
//
// SOLO modo oscuro: lo que los pasos 2-8 midieron y corrigieron a mano fue
// exclusivamente el valor OSCURO de cada token (el claro es el diseño
// original, nunca auditado en esta etapa). Además, varios pares (brand-400
// contra las 6 superficies; -200/-300 de las familias semánticas contra
// panel, no solo contra su propia -50) fueron verificados en pasos 3-5
// como una garantía defensiva para CUALQUIER selector oscuro futuro, no
// porque ya existiera un selector real con esa combinación exacta — así
// que probar esas mismas combinaciones en CLARO no corresponde a ninguna
// garantía que se haya dado nunca (confirmado con grep: brand-400 contra
// canvas/raised/hover/selected en claro no tiene ningún selector real que
// lo use así; solo 2 de los 6 pares sí tienen un selector real, y son
// casos puntuales preexistentes, no la garantía general de pasos 3-4).
// Mezclar claro y oscuro en el mismo chequeo generaba falsos positivos
// (combinaciones que el CSS real nunca ejecuta) sin poder distinguirlos
// de deuda real preexistente — se corrigió acotando todo a oscuro.
//
// Qué NO cubre a propósito: esto verifica los pares reutilizables del
// SISTEMA de tokens, no cada uso puntual en un componente (por ejemplo
// .environment-notice o .po-doc-* con paleta congelada) — esos ya se
// verificaron a mano en su propio commit y no son parte de tokens.css.
//
// Si un par falla, se reporta (ver salida) y el proceso termina con código
// distinto de cero — nunca se ajusta un valor aquí para forzar el pase.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOKENS_CSS = path.join(ROOT, "src/styles/tokens.css");

const TEXT_THRESHOLD = 4.5;
const NONTEXT_THRESHOLD = 3;

// --- Lectura de tokens.css: valores claros y oscuros por nombre de token. ---

function extractDeclarations(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[`--${m[1]}`] = normalizeHex(m[2]);
  }
  return out;
}

function normalizeHex(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h.split("").map((c) => c + c).join("");
  }
  return `#${h.slice(0, 6).toLowerCase()}`;
}

function parseTokens(css) {
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rootMatch = /:root\s*\{([\s\S]*?)\n\}/.exec(blanked);
  if (!rootMatch) throw new Error("No se encontró el bloque :root en tokens.css");
  const light = extractDeclarations(rootMatch[1]);

  const darkBlockMatch = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n\s*\}\s*\}/.exec(
    blanked
  );
  const darkOverrides = darkBlockMatch ? extractDeclarations(darkBlockMatch[1]) : {};
  const dark = {...light, ...darkOverrides};

  return {light, dark};
}

// --- WCAG 2: luminancia relativa y contraste. ---

function relativeLuminance(hex) {
  const h = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hexA, hexB) {
  const [lA, lB] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (lA + 0.05) / (lB + 0.05);
}

// --- Pares verificados a mano en la etapa 5, agrupados por origen. ---
// kind "text" -> umbral 4.5:1 (WCAG AA, texto normal).
// kind "nontext" -> umbral 3:1 (WCAG 1.4.11, componentes/gráficos no textuales).

const PAIRS = [
  // Fundación (paso 2): escala genérica de texto contra superficies.
  {fg: "--color-text-default", bg: "--color-surface-panel", kind: "text", note: "texto por defecto / panel"},
  {fg: "--color-text-default", bg: "--color-surface-canvas", kind: "text", note: "texto por defecto / canvas"},
  {fg: "--color-text-muted", bg: "--color-surface-subtle", kind: "text", note: "texto muted / subtle"},
  {fg: "--color-text-strong", bg: "--color-surface-panel", kind: "text", note: "texto fuerte / panel"},

  // Familias semánticas — shade de texto (-700/-800) contra su -50 y contra panel.
  {fg: "--color-success-700", bg: "--color-success-50", kind: "text", note: "success-700 / success-50"},
  {fg: "--color-success-700", bg: "--color-surface-panel", kind: "text", note: "success-700 / panel"},
  {fg: "--color-warning-800", bg: "--color-warning-50", kind: "text", note: "warning-800 / warning-50"},
  {fg: "--color-warning-800", bg: "--color-surface-panel", kind: "text", note: "warning-800 / panel"},
  {fg: "--color-danger-700", bg: "--color-danger-50", kind: "text", note: "danger-700 / danger-50"},
  {fg: "--color-danger-700", bg: "--color-surface-panel", kind: "text", note: "danger-700 / panel"},
  {fg: "--color-danger-600", bg: "--color-surface-panel", kind: "text", note: "danger-600 / panel (el más ajustado, paso 2)"},
  {fg: "--color-info-700", bg: "--color-info-50", kind: "text", note: "info-700 / info-50"},
  {fg: "--color-info-700", bg: "--color-surface-panel", kind: "text", note: "info-700 / panel"},
  {fg: "--color-stock-alert-800", bg: "--color-stock-alert-50", kind: "text", note: "stock-alert-800 / stock-alert-50 (paso 5)"},
  {fg: "--color-stock-alert-800", bg: "--color-surface-panel", kind: "text", note: "stock-alert-800 / panel (paso 5)"},

  // Familias semánticas — shade de borde (-200/-300) contra su -50 y contra panel.
  {fg: "--color-success-200", bg: "--color-success-50", kind: "nontext", note: "success-200 / success-50 (borde, paso 4)"},
  {fg: "--color-success-200", bg: "--color-surface-panel", kind: "nontext", note: "success-200 / panel (borde, paso 4)"},
  {fg: "--color-success-300", bg: "--color-success-50", kind: "nontext", note: "success-300 / success-50 (borde, paso 4)"},
  {fg: "--color-success-300", bg: "--color-surface-panel", kind: "nontext", note: "success-300 / panel (borde, paso 4)"},
  {fg: "--color-warning-200", bg: "--color-warning-50", kind: "nontext", note: "warning-200 / warning-50 (borde, paso 4)"},
  {fg: "--color-warning-200", bg: "--color-surface-panel", kind: "nontext", note: "warning-200 / panel (borde, paso 4)"},
  {fg: "--color-warning-300", bg: "--color-warning-50", kind: "nontext", note: "warning-300 / warning-50 (borde, paso 4)"},
  {fg: "--color-warning-300", bg: "--color-surface-panel", kind: "nontext", note: "warning-300 / panel (borde, paso 4)"},
  {fg: "--color-danger-200", bg: "--color-danger-50", kind: "nontext", note: "danger-200 / danger-50 (borde, paso 4)"},
  {fg: "--color-danger-200", bg: "--color-surface-panel", kind: "nontext", note: "danger-200 / panel (borde, paso 4)"},
  {fg: "--color-info-200", bg: "--color-info-50", kind: "nontext", note: "info-200 / info-50 (borde, paso 4)"},
  {fg: "--color-info-200", bg: "--color-surface-panel", kind: "nontext", note: "info-200 / panel (borde, paso 4)"},
  {fg: "--color-stock-alert-200", bg: "--color-stock-alert-50", kind: "nontext", note: "stock-alert-200 / stock-alert-50 (borde, paso 5)"},
  {fg: "--color-stock-alert-200", bg: "--color-surface-panel", kind: "nontext", note: "stock-alert-200 / panel (borde, paso 5)"},
  {fg: "--color-stock-alert-500", bg: "--color-stock-alert-50", kind: "nontext", note: "stock-alert-500 / stock-alert-50 (borde-acento, paso 5)"},
  {fg: "--color-stock-alert-500", bg: "--color-surface-panel", kind: "nontext", note: "stock-alert-500 / panel (borde-acento, paso 5)"},

  // Brand (paso 2/3): excepción "se mantiene igual" y su uso seguro.
  {fg: "--color-text-inverse", bg: "--color-brand-600", kind: "text", note: "texto inverso / brand-600 (fondo de botón/badge, paso 2)"},
  {fg: "--color-brand-400", bg: "--color-surface-canvas", kind: "text", note: "brand-400 / canvas (texto/ícono, paso 3+)"},
  {fg: "--color-brand-400", bg: "--color-surface-panel", kind: "text", note: "brand-400 / panel (texto/ícono, paso 3+)"},
  {fg: "--color-brand-400", bg: "--color-surface-subtle", kind: "text", note: "brand-400 / subtle (texto/ícono, paso 3+)"},
  {fg: "--color-brand-400", bg: "--color-surface-raised", kind: "text", note: "brand-400 / raised (texto/ícono, paso 3+)"},
  {fg: "--color-brand-400", bg: "--color-surface-hover", kind: "text", note: "brand-400 / hover (texto/ícono, paso 3+, mínimo real reportado)"},
  {fg: "--color-brand-400", bg: "--color-surface-selected", kind: "text", note: "brand-400 / selected (texto/ícono, paso 3+)"},

  // Paso 7: colores de gráficos JS (Chart.js) — relleno gráfico, no texto.
  {fg: "--color-data-expense", bg: "--color-surface-panel", kind: "nontext", note: "data-expense / panel (relleno de gráfico, paso 7)"},
  {fg: "--color-data-net", bg: "--color-surface-panel", kind: "nontext", note: "data-net / panel (relleno de gráfico, paso 7)"},
  {fg: "--color-data-pending", bg: "--color-surface-panel", kind: "nontext", note: "data-pending / panel (relleno de gráfico, paso 7)"},
  {fg: "--color-data-pending-700", bg: "--color-surface-panel", kind: "nontext", note: "data-pending-700 / panel (relleno de gráfico, paso 7)"},
  {fg: "--color-data-paid", bg: "--color-surface-panel", kind: "nontext", note: "data-paid / panel (relleno de gráfico, paso 7)"},
  {fg: "--color-data-paid", bg: "--color-surface-canvas", kind: "nontext", note: "data-paid / canvas (relleno de gráfico, paso 7)"},
  {fg: "--color-data-cost-materials", bg: "--color-surface-panel", kind: "nontext", note: "data-cost-materials / panel (paso 7)"},
  {fg: "--color-data-cost-labor", bg: "--color-surface-panel", kind: "nontext", note: "data-cost-labor / panel (paso 7)"},
  {fg: "--color-data-cost-direct", bg: "--color-surface-panel", kind: "nontext", note: "data-cost-direct / panel (paso 7)"},
  {fg: "--color-data-cost-indirect", bg: "--color-surface-panel", kind: "nontext", note: "data-cost-indirect / panel (paso 7)"},
  {fg: "--color-quote-status-draft", bg: "--color-surface-panel", kind: "nontext", note: "quote-status-draft / panel (paso 7)"},
  {fg: "--color-quote-status-issued", bg: "--color-surface-panel", kind: "nontext", note: "quote-status-issued / panel (paso 7)"},
  {fg: "--color-quote-status-accepted", bg: "--color-surface-panel", kind: "nontext", note: "quote-status-accepted / panel (paso 7)"},
  {fg: "--color-quote-status-expired", bg: "--color-surface-panel", kind: "nontext", note: "quote-status-expired / panel (paso 7)"},
  {fg: "--color-quote-status-archived", bg: "--color-surface-panel", kind: "nontext", note: "quote-status-archived / panel (paso 7)"},
];

function checkTheme(themeName, tokens, results) {
  for (const pair of PAIRS) {
    const fgHex = tokens[pair.fg];
    const bgHex = tokens[pair.bg];
    if (!fgHex || !bgHex) {
      results.missing.push(`${themeName}: falta ${!fgHex ? pair.fg : pair.bg} para verificar "${pair.note}".`);
      continue;
    }
    const ratio = contrastRatio(fgHex, bgHex);
    const threshold = pair.kind === "text" ? TEXT_THRESHOLD : NONTEXT_THRESHOLD;
    const entry = {
      theme: themeName,
      note: pair.note,
      fg: pair.fg,
      bg: pair.bg,
      ratio: Math.round(ratio * 100) / 100,
      threshold,
      kind: pair.kind,
    };
    if (ratio < threshold) results.failures.push(entry);
    else results.passes.push(entry);
  }
}

async function main() {
  const css = await readFile(TOKENS_CSS, "utf8");
  const {dark} = parseTokens(css);

  const results = {passes: [], failures: [], missing: []};
  checkTheme("oscuro", dark, results);

  if (results.missing.length) {
    console.error(`FALLÓ: ${results.missing.length} par(es) no se pudieron verificar (token inexistente).`);
    for (const m of results.missing) console.error(`  - ${m}`);
  }

  if (results.failures.length) {
    console.error(`FALLÓ: ${results.failures.length} par(es) en modo oscuro no cumplen su umbral WCAG (regresión sobre lo verificado en la etapa 5).`);
    for (const f of results.failures) {
      console.error(
        `  - ${f.note}: ${f.ratio}:1 (umbral ${f.threshold}:1, ${f.kind === "text" ? "texto" : "no-textual"}) — ${f.fg} sobre ${f.bg}`
      );
    }
  }

  if (results.missing.length || results.failures.length) {
    assert.fail("contrast-smoke: ver violaciones arriba");
  }

  console.log(
    `OK: ${results.passes.length} pares de modo oscuro verificados contra tokens.css, todos cumplen su umbral WCAG (4.5:1 texto, 3:1 no-textual).`
  );
  console.log("CONTRAST_SMOKE_OK");
}

export {parseTokens, contrastRatio, relativeLuminance, PAIRS};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
