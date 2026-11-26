import assert from "node:assert/strict";

// Aserciones compartidas por los smokes de los documentos imprimibles (Cotizaciones, Ventas, Compras y Órdenes de compra).
//
// Por qué existen: al imprimir, el navegador evalúa los @media (max-width) con el ancho útil de la hoja (A4 con 14 mm de
// margen = 182 mm = 688 px), no con el de la ventana, y `zoom` no lo cambia. Una regla responsiva sin restringir a pantalla
// apila el documento al imprimir. Todo @media del CSS de un documento debe ser `print` o ir como `screen and (...)`.

// Bloques @media (y @container) de primer nivel de un CSS, con su condición y su cuerpo.
export function extractMediaBlocks(css) {
  const blocks = [];
  for (let at = css.indexOf("@media"); at !== -1; at = css.indexOf("@media", at + 1)) {
    const open = css.indexOf("{", at);
    let depth = 0;
    let close = open;
    for (; close < css.length; close += 1) {
      if (css[close] === "{") depth += 1;
      if (css[close] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push({condition: css.slice(at + "@media".length, open).trim(), body: css.slice(open + 1, close)});
  }
  return blocks;
}

// ¿Aplica este @media al imprimir? Sí, salvo que toda consulta de la lista empiece por `screen` o `not print`.
export const appliesInPrint = (condition) => condition.split(",").some(
  (query) => !/^\s*(?:only\s+)?screen\b/i.test(query) && !/^\s*not\s+print\b/i.test(query)
);

// Ninguna regla responsiva por ancho aplica en impresión. Devuelve los bloques de pantalla para otras aserciones.
export function assertNoWidthQueriesInPrint(css, name) {
  const blocks = extractMediaBlocks(css);
  assert.ok(blocks.length >= 2, `${name}: tiene su bloque de pantalla y su bloque de impresión`);
  assert.doesNotMatch(css, /@container/, `${name}: no usa container queries`);
  const printApplying = blocks.filter((block) => appliesInPrint(block.condition));
  assert.deepEqual(printApplying.map((block) => block.condition), ["print"], `${name}: el único @media que aplica al imprimir es \`print\` (sin consultas de ancho)`);
  assert.doesNotMatch(printApplying[0].body, /@media|@container|\((?:max-|min-)?width\s*[:<>]/, `${name}: el bloque de impresión no contiene consultas de ancho`);
  const screenBlocks = blocks.filter((block) => !appliesInPrint(block.condition));
  assert.ok(
    screenBlocks.length >= 1 && screenBlocks.every((block) => /^screen and \(max-width:\s*\d+px\)$/.test(block.condition)),
    `${name}: las reglas responsivas van como \`screen and (max-width: ...)\``
  );
  return {screenBlocks, printBlock: printApplying[0]};
}

// .skip-link ("Saltar al contenido principal") se oculta al imprimir con la regla global de globals.css, igual que la barra
// lateral, la superior y .no-print, y sigue funcionando en pantalla (position: fixed fuera de vista, visible al recibir foco).
export function assertSkipLinkHiddenInPrint(globalsSource, skipLinkComponentSource) {
  const blocks = extractMediaBlocks(globalsSource);
  const printBlocks = blocks.filter((block) => block.condition === "print");
  assert.equal(printBlocks.length, 1, "globals.css tiene un solo bloque @media print");
  const rule = printBlocks[0].body.match(/([^{}]*\.skip-link[^{}]*)\{([^}]*)\}/);
  assert.ok(rule, "globals.css: @media print menciona .skip-link");
  assert.match(rule[1], /\.sidebar[\s\S]*\.topbar[\s\S]*\.no-print[\s\S]*\.skip-link/, ".skip-link va en la misma regla que sidebar, topbar y .no-print");
  assert.match(rule[2], /display:\s*none\s*!important/, ".skip-link queda con display: none !important al imprimir");
  // En pantalla no cambia: sigue fuera de vista con position: fixed y aparece al recibir foco.
  const screenCss = printBlocks.reduce((css, block) => css.replace(block.body, ""), globalsSource);
  assert.match(screenCss, /\.skip-link\s*\{[^}]*position:\s*fixed[^}]*transform:\s*translateY\(calc\(-100% - var\(--space-5\)\)\)/, "en pantalla el enlace sigue fuera de vista");
  assert.match(screenCss, /\.skip-link:focus\s*\{\s*transform:\s*translateY\(0\);?\s*\}/, "en pantalla el enlace aparece al recibir foco");
  assert.doesNotMatch(screenCss.match(/\.skip-link[^{]*\{[^}]*\}/g).join(""), /display\s*:\s*none/, "en pantalla el enlace nunca se oculta");
  assert.match(skipLinkComponentSource, /className="skip-link"/, "la regla apunta a la clase real del enlace");
}
