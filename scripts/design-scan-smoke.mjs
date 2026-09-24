import assert from "node:assert/strict";
import {scanCss, scanJs, countBy} from "./design-smoke.mjs";

// Fija el conteo esperado del propio escáner de design-smoke.mjs contra
// snippets conocidos, para que un cambio futuro a scanCss/scanJs no pueda
// romper el conteo en silencio (como pasó con el bug arreglado en
// 2c8d0d4: un literal de color escrito como string literal directo de una
// ObjectProperty se contaba dos veces, y un valor de dedup por línea
// escondía literales repetidos en una misma línea).

// --- Caso 1: CSS con color/radio/sombra/duración, y un color embebido en
// un box-shadow (cuenta como color Y como shadow: eso es intencional). ---
const CSS_CASE = `
.foo {
  color: #112233;
  background: #112233;
  border: 1px solid rgba(10, 20, 30, 0.5);
  border-radius: 8px;
  box-shadow: 0 2px 4px #000;
  transition: color 200ms ease;
}
.bar {
  border-radius: var(--radius-md);
}
`;
{
  const found = scanCss(CSS_CASE);
  const c = countBy(found);
  assert.deepEqual(
    c,
    {color: 4, radius: 1, shadow: 1, duration: 1},
    "CSS: #112233 (x2) + rgba(...) + #000 embebido en el shadow = 4 colores; " +
      "1 radio (border-radius: var(...) del .bar no cuenta); 1 shadow; 1 duración"
  );
  console.log("OK: caso 1 (CSS) — conteo exacto", c);
}

// --- Caso 2: objeto de estilo inline con el MISMO color repetido en dos
// propiedades. Antes del fix, cada literal se contaba dos veces (una vía
// ObjectProperty, otra vía el visitor StringLiteral de @babel/traverse). ---
const JS_REPEATED_OBJECT_PROPS = `
const styles = {
  card: {
    borderLeft: "2px solid #0f766e",
    background: "#0f766e",
    borderRadius: "8px",
  },
};
`;
{
  const found = scanJs(JS_REPEATED_OBJECT_PROPS, "fixture.js");
  const c = countBy(found);
  assert.deepEqual(
    c,
    {color: 2, radius: 1, shadow: 0, duration: 0},
    "JS: #0f766e aparece en 2 propiedades de objeto -> 2 colores, no 4 " +
      "(regresión del bug de doble conteo por ObjectProperty + StringLiteral)"
  );
  console.log("OK: caso 2 (JS, objeto de estilo) — conteo exacto", c);
}

// --- Caso 3: el mismo literal repetido varias veces en una sola línea de
// código (típico de CSS-in-JS minificado en un template literal). El dedup
// por (literal, línea, propiedad) que existía antes del fix colapsaba
// estas repeticiones a 1. ---
const JS_SAME_LINE_REPEATS = `const css = \`a{color:#112233}b{color:#112233}c{color:#112233}\`;`;
{
  const found = scanJs(JS_SAME_LINE_REPEATS, "fixture.js");
  const c = countBy(found);
  assert.deepEqual(
    c,
    {color: 3, radius: 0, shadow: 0, duration: 0},
    "JS: #112233 tres veces en la misma línea -> 3 colores, no 1 " +
      "(regresión del bug de dedup por línea)"
  );
  console.log("OK: caso 3 (JS, literal repetido en una línea) — conteo exacto", c);
}

console.log("DESIGN_SCAN_SMOKE_OK");
