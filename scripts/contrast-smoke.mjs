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
// (claro) y del bloque :root[data-theme="dark"] { ... } (oscuro; antes del
// paso 9 era @media (prefers-color-scheme: dark), con fallback a claro para los tokens que no se redefinen ahí —
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
// Qué selector usa qué token como texto lo vigila scripts/contrast-usage-
// smoke.mjs (npm run test:contrast-usage): sin él, un token "bueno" mal usado
// (p. ej. --color-dark-ink como texto en platform.css) pasa este smoke.
//
// Corrección de contraste, parte 1: se agregan los pares REALES de uso —
// texto de marca/fuerte/normal/tenue contra las cinco superficies donde
// viven (canvas, panel, raised, hover y --color-surface-brand), foco y borde
// de control (3:1 contra panel, raised y hover), bordes de tarjeta (1.6:1
// contra panel, 1.8:1 contra canvas) y el texto de botones y skip-link
// contra su fondo. Un par puede llevar `threshold` propio y usar un hex
// literal en fg/bg (los rellenos de botón fijados en components.css).
//
// Si un par falla, se reporta (ver salida) y el proceso termina con código
// distinto de cero — nunca se ajusta un valor aquí para forzar el pase.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOKENS_CSS = path.join(ROOT, "src/styles/tokens.css");

const TEXT_THRESHOLD = 4.5;
const NONTEXT_THRESHOLD = 3;
const SURFACES_OF_USE = ["--color-surface-canvas", "--color-surface-panel", "--color-surface-raised", "--color-surface-hover", "--color-surface-brand"];

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

  const darkBlockMatch = /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\s*\}/.exec(blanked);
  // Sin bloque oscuro, "dark" sería en silencio una copia de los valores
  // claros y el smoke mediría otra cosa: se falla en vez de seguir.
  if (!darkBlockMatch) throw new Error('No se encontró el bloque :root[data-theme="dark"] en tokens.css');
  const darkOverrides = extractDeclarations(darkBlockMatch[1]);
  assert.ok(Object.keys(darkOverrides).length > 0, "El bloque oscuro de tokens.css no declara ningún token");
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
  // AppFooter: texto tenue del pie del login (panel) y texto del pie de Mi cuenta (canvas).
  {fg: "--color-text-muted", bg: "--color-surface-panel", kind: "text", note: "texto muted / panel (pie del login)"},
  {fg: "--color-text-muted", bg: "--color-surface-canvas", kind: "text", note: "texto muted / canvas (pie)"},
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
  // Marca (BrandMark): visto ámbar y C en brand-400 sobre el recuadro oscuro (surface-subtle).
  {fg: "--color-logo-accent", bg: "--color-surface-subtle", kind: "nontext", note: "logo-accent / subtle (visto de la marca)"},
  {fg: "--color-logo-accent", bg: "--color-surface-panel", kind: "nontext", note: "logo-accent / panel (visto de la marca)"},
  {fg: "--color-brand-400", bg: "--color-surface-subtle", kind: "nontext", note: "brand-400 / subtle (C de la marca)"},
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
  // Ganancia visual (SPEC 025): barra costo | ganancia de productos. El costo va rayado
  // (border-default y border-control) con contorno text-muted, y la ganancia lisa
  // (success-700); aparte del color los distinguen la posición, el rayado y la leyenda.
  {fg: "--color-success-700", bg: "--color-surface-panel", kind: "nontext", note: "success-700 / panel (tramo de ganancia de la barra)"},
  {fg: "--color-success-700", bg: "--color-border-default", kind: "nontext", note: "success-700 / border-default (tramo de ganancia junto al costo)"},
  {fg: "--color-border-control", bg: "--color-border-default", kind: "nontext", threshold: 1.2, note: "border-control / border-default (rayas del costo entre sí; solo textura, la forma la da el contorno)"},
  {fg: "--color-text-muted", bg: "--color-surface-panel", kind: "nontext", note: "text-muted / panel (contorno del tramo de costo)"},
  {fg: "--color-danger-700", bg: "--color-surface-panel", kind: "nontext", note: "danger-700 / panel (remate de pérdida de la barra)"},
  {fg: "--color-quote-status-draft", bg: "--color-surface-panel", kind: "nontext", note: "quote-status-draft / panel (paso 7)"},
  {fg: "--color-quote-status-issued", bg: "--color-surface-panel", kind: "nontext", note: "quote-status-issued / panel (paso 7)"},
  {fg: "--color-quote-status-accepted", bg: "--color-surface-panel", kind: "nontext", note: "quote-status-accepted / panel (paso 7)"},
  {fg: "--color-quote-status-expired", bg: "--color-surface-panel", kind: "nontext", note: "quote-status-expired / panel (paso 7)"},
  {fg: "--color-quote-status-archived", bg: "--color-surface-panel", kind: "nontext", note: "quote-status-archived / panel (paso 7)"},

  // Corrección de contraste, parte 1 — pares de uso real.
  // Texto de marca, fuerte, normal y tenue contra las superficies donde viven.
  ...["--color-text-brand", "--color-text-brand-accent", "--color-text-brand-hover", "--color-text-strong", "--color-text-default", "--color-text-muted", "--color-text-faint", "--color-text-expense"]
    .flatMap((fg) => SURFACES_OF_USE.map((bg) => ({
      fg, bg, kind: "text", note: `${fg.replace("--color-", "")} / ${bg.replace("--color-surface-", "")}`,
    }))),
  {fg: "--color-text-expense", bg: "--color-info-50", kind: "text", note: "text-expense / info-50 (chip de compra del Inicio)"},
  // Foco y borde de control: 3:1 (WCAG 1.4.11) contra panel, raised y hover
  // (el foco además contra canvas y surface-brand).
  ...["--color-focus", "--color-border-control"].flatMap((fg) =>
    ["--color-surface-panel", "--color-surface-raised", "--color-surface-hover"].map((bg) => ({
      fg, bg, kind: "nontext", note: `${fg.replace("--color-", "")} / ${bg.replace("--color-surface-", "")}`,
    }))),
  {fg: "--color-focus", bg: "--color-surface-canvas", kind: "nontext", note: "focus / canvas"},
  {fg: "--color-focus", bg: "--color-surface-brand", kind: "nontext", note: "focus / surface-brand"},
  {fg: "--color-border-control", bg: "--color-surface-canvas", kind: "nontext", note: "border-control / canvas"},
  // Bordes de tarjeta: no es un umbral WCAG (la tarjeta se identifica por su
  // texto), es el objetivo de legibilidad del diseño: 1.6:1 contra el panel y
  // 1.8:1 contra el canvas, para subtle y default.
  ...["--color-border-subtle", "--color-border-default"].flatMap((fg) => [
    {fg, bg: "--color-surface-panel", kind: "nontext", threshold: 1.6, note: `${fg.replace("--color-", "")} / panel (tarjeta)`},
    {fg, bg: "--color-surface-canvas", kind: "nontext", threshold: 1.8, note: `${fg.replace("--color-", "")} / canvas (tarjeta)`},
  ]),
  // Texto de botones y skip-link contra su fondo. Los rellenos rojos son
  // literales fijados en el bloque oscuro de components.css (no son tokens).
  {fg: "--color-text-inverse", bg: "--color-brand-700", kind: "text", note: "texto inverso / brand-700 (hover del botón primario)"},
  {fg: "--color-text-inverse", bg: "#dc2626", kind: "text", note: "texto inverso / rojo fijo (.ui-button--danger, oscuro)"},
  {fg: "--color-text-inverse", bg: "#b91c1c", kind: "text", note: "texto inverso / rojo fijo hover y .ui-badge-count (oscuro)"},
  {fg: "--color-text-on-strong", bg: "--color-text-strong", kind: "text", note: "texto sobre text-strong / text-strong (.skip-link y botón Descargar PDF)"},
];

// Espejos de Chart.js (parte 2). Chart.js pinta con strings JS y no puede leer
// var(), así que cada gráfico duplica a mano su par oscuro. Aquí se mide el
// valor OSCURO real de cada espejo contra el panel oscuro y, además, se exige
// que el hex siga escrito en el archivo (si alguien lo cambia allá sin
// actualizar esta tabla, el smoke falla en vez de medir un valor que ya no
// existe). kind: "text" 4.5:1 | "nontext" 3:1 | threshold propio.
const CHART_MIRRORS = [
  {file: "src/components/finance/FinancialCharts.jsx", hex: "#45b8a8", kind: "nontext", note: "FinancialCharts ingreso (teal)"},
  {file: "src/components/finance/FinancialCharts.jsx", hex: "#8bc8c2", kind: "nontext", note: "FinancialCharts pagados (tealSoft)"},
  {file: "src/components/finance/FinancialCharts.jsx", hex: "#5b7ba3", kind: "nontext", note: "FinancialCharts gasto/neto (navy)"},
  {file: "src/components/finance/FinancialCharts.jsx", hex: "#d97706", kind: "nontext", note: "FinancialCharts pendiente (amber)"},
  {file: "src/components/finance/FinancialCharts.jsx", hex: "#8ba3b0", kind: "text", note: "FinancialCharts leyenda y ejes"},
  {file: "src/components/finance/FinancialCharts.jsx", hex: "#2c4f64", kind: "nontext", threshold: 1.6, note: "FinancialCharts grilla"},
  {file: "src/components/reports/OperationalComparisonChart.jsx", hex: "#45b8a8", kind: "nontext", note: "OperationalComparisonChart ventas"},
  {file: "src/components/reports/OperationalComparisonChart.jsx", hex: "#5b7ba3", kind: "nontext", note: "OperationalComparisonChart compras"},
  {file: "src/components/reports/OperationalComparisonChart.jsx", hex: "#8ba3b0", kind: "text", note: "OperationalComparisonChart leyenda y ejes"},
  {file: "src/components/reports/OperationalComparisonChart.jsx", hex: "#2c4f64", kind: "nontext", threshold: 1.6, note: "OperationalComparisonChart grilla"},
  ...["#45b8a8", "#5b7ba3", "#d1943f", "#93a3ac"].map((hex) => ({file: "src/components/reports/CostCompositionChart.jsx", hex, kind: "nontext", note: `CostCompositionChart ${hex}`})),
  {file: "src/components/DashboardDonutChart.jsx", hex: "#e4edf1", kind: "text", note: "DashboardDonutChart texto fuerte"},
  {file: "src/components/DashboardDonutChart.jsx", hex: "#8ba3b0", kind: "text", note: "DashboardDonutChart texto tenue y leyenda"},
  {file: "src/components/DashboardDonutChart.jsx", hex: "#3a6580", kind: "nontext", threshold: 1.6, note: "DashboardDonutChart aro vacío"},
  ...["#94a3b8", "#38bdf8", "#45b8a8", "#f2685f", "#d97706", "#93a3ac"].map((hex) => ({file: "src/pages/DashboardPage.jsx", hex, kind: "nontext", note: `DashboardPage estado de cotización ${hex}`})),
];

async function checkChartMirrors(tokens, results) {
  const panel = tokens["--color-surface-panel"];
  const sources = new Map();
  for (const mirror of CHART_MIRRORS) {
    if (!sources.has(mirror.file)) sources.set(mirror.file, (await readFile(path.join(ROOT, mirror.file), "utf8")).toLowerCase());
    if (!sources.get(mirror.file).includes(mirror.hex)) {
      results.missing.push(`${mirror.file} ya no contiene ${mirror.hex} ("${mirror.note}"): actualiza CHART_MIRRORS.`);
      continue;
    }
    const ratio = contrastRatio(mirror.hex, panel);
    const threshold = mirror.threshold ?? (mirror.kind === "text" ? TEXT_THRESHOLD : NONTEXT_THRESHOLD);
    const entry = {theme: "oscuro", note: mirror.note, fg: mirror.hex, bg: "--color-surface-panel", ratio: Math.round(ratio * 100) / 100, threshold, kind: mirror.kind};
    if (ratio < threshold) results.failures.push(entry);
    else results.passes.push(entry);
  }
}

function checkTheme(themeName, tokens, results) {
  for (const pair of PAIRS) {
    const fgHex = pair.fg.startsWith("#") ? normalizeHex(pair.fg) : tokens[pair.fg];
    const bgHex = pair.bg.startsWith("#") ? normalizeHex(pair.bg) : tokens[pair.bg];
    if (!fgHex || !bgHex) {
      results.missing.push(`${themeName}: falta ${!fgHex ? pair.fg : pair.bg} para verificar "${pair.note}".`);
      continue;
    }
    const ratio = contrastRatio(fgHex, bgHex);
    const threshold = pair.threshold ?? (pair.kind === "text" ? TEXT_THRESHOLD : NONTEXT_THRESHOLD);
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
  await checkChartMirrors(dark, results);

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
