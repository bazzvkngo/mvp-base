import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";

// ETAPA 2 (estados de carga), PASO 4: <Skeleton>, <SkeletonRegion>,
// <SkeletonTable> y <SkeletonCards> (src/components/ui/Skeleton.jsx). Sin
// Firebase: se prueba vía Vite ssrLoadModule + renderToStaticMarkup, mismo
// patrón que additional-selector-smoke. Cubre el patrón accesible (texto
// role="status" hermano del contenedor aria-busy/aria-hidden), la geometría
// (filas y columnas) y que el CSS del shimmer respete reduced motion sin
// @media propio ni animation-fill-mode.

const count = (markup, pattern) => (markup.match(pattern) || []).length;
const assertClean = (markup, name) =>
  assert.doesNotMatch(markup, /undefined|NaN|Infinity|<!--/, `${name}: markup sin undefined/NaN/Infinity/comentarios`);

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const module = await vite.ssrLoadModule("/src/components/ui/Skeleton.jsx");
  const {default: Skeleton, SkeletonRegion, SkeletonTable, SkeletonCards} = module;
  const render = (element) => renderToStaticMarkup(element);

  // --- Skeleton: variantes, tamaño y decorativo ---
  const line = render(React.createElement(Skeleton, {}));
  assert.match(line, /^<span class="ui-skeleton ui-skeleton--line" aria-hidden="true"><\/span>$/);
  const sized = render(React.createElement(Skeleton, {variant: "block", width: "60%", height: 40, className: "extra"}));
  assert.match(sized, /class="ui-skeleton ui-skeleton--block extra"/);
  assert.match(sized, /style="width:60%;height:40px"/);
  assert.match(sized, /aria-hidden="true"/);
  for (const bad of [undefined, null, NaN, Infinity, -5, {}, ""]) {
    const markup = render(React.createElement(Skeleton, {width: bad, height: bad}));
    assert.doesNotMatch(markup, /style=/, "tamaño inválido no genera style");
    assertClean(markup, "Skeleton con tamaño inválido");
  }
  assert.match(render(React.createElement(Skeleton, {variant: "bogus"})), /ui-skeleton--line/, "variante desconocida cae a line");
  assert.doesNotMatch(line, />[^<]/, "el skeleton no contiene texto");
  console.log("OK: Skeleton — variantes, tamaño, decorativo y sin style con valores inválidos");

  // --- SkeletonRegion: patrón con hermanos ---
  const region = render(React.createElement(SkeletonRegion, {label: "Cargando compras...", className: "mi-region"}, React.createElement(Skeleton, {})));
  assert.match(
    region,
    /^<div class="ui-skeleton-region mi-region"><span class="sr-only" role="status">Cargando compras\.\.\.<\/span><div aria-busy="true" aria-hidden="true">.*<\/div><\/div>$/,
    "texto role=status hermano previo del contenedor aria-busy/aria-hidden, label como único nodo de texto"
  );
  assert.equal(count(region, /role="status"/g), 1, "un único anuncio");
  assert.equal(count(region, /aria-busy="true"/g), 1);
  const busyOpen = region.indexOf('aria-busy="true"');
  const statusClose = region.indexOf("</span>");
  assert.ok(statusClose < busyOpen, "role=status queda fuera (antes) del contenedor aria-busy");
  const noLabel = render(React.createElement(SkeletonRegion, {}));
  assert.match(noLabel, /role="status"><\/span>/, "sin label imprime vacío");
  assertClean(region, "SkeletonRegion");
  assertClean(noLabel, "SkeletonRegion sin label");
  console.log("OK: SkeletonRegion — role=status hermano fuera de aria-busy, aria-hidden, sin undefined");

  // --- SkeletonTable: filas y columnas ---
  const table = render(React.createElement(SkeletonTable, {columns: 5, rows: 8, className: "erp-desktop-only"}));
  assert.match(table, /^<div class="erp-table-region erp-desktop-only"><table class="erp-table ui-skeleton-table">/);
  assert.equal(count(table, /<thead>/g), 1);
  assert.equal(count(table, /<th>/g), 5, "5 columnas de encabezado");
  assert.equal(count(table, /<tr>/g), 9, "1 fila de encabezado + 8 filas");
  assert.equal(count(table, /<td>/g), 40, "8 filas x 5 columnas");
  assert.equal(count(table, /ui-skeleton--line/g), 5 + 40, "una barra por celda y por encabezado");
  assert.doesNotMatch(table, /<th>[^<]/, "los encabezados no llevan texto real");
  assert.doesNotMatch(table, /<td>[^<]/, "las celdas no llevan texto real");
  assertClean(table, "SkeletonTable");

  const twoLine = render(React.createElement(SkeletonTable, {columns: 3, rows: 2, twoLine: true}));
  assert.equal(count(twoLine, /<td>/g), 6);
  assert.equal(count(twoLine, /ui-skeleton--line/g), 3 + 6 + 2, "twoLine agrega una barra en la primera columna de cada fila");
  const firstRow = twoLine.split("<tbody>")[1].split("</tr>")[0];
  assert.equal(count(firstRow.split("</td>")[0], /ui-skeleton--line/g), 2, "primera celda con 2 barras");
  assert.equal(count(firstRow.split("</td>")[1], /ui-skeleton--line/g), 1, "resto de celdas con 1 barra");

  const defaults = render(React.createElement(SkeletonTable, {}));
  assert.equal(count(defaults, /<tr>/g), 9, "rows por defecto = 8");
  assert.equal(count(defaults, /<th>/g), 5, "columns por defecto = 5");
  for (const bad of [0, -3, NaN, Infinity, "abc", null, 2.5]) {
    const markup = render(React.createElement(SkeletonTable, {columns: bad, rows: bad}));
    assert.equal(count(markup, /<th>/g), 5, `columns inválido (${String(bad)}) cae al valor por defecto`);
    assert.equal(count(markup, /<tr>/g), 9, `rows inválido (${String(bad)}) cae al valor por defecto`);
    assertClean(markup, "SkeletonTable con conteo inválido");
  }
  assert.equal(count(render(React.createElement(SkeletonTable, {rows: 9999})), /<tr>/g), 31, "rows se acota a 30");
  console.log("OK: SkeletonTable — filas, columnas, twoLine, valores por defecto y conteos inválidos");

  // --- SkeletonCards ---
  const cards = render(React.createElement(SkeletonCards, {count: 4, className: "erp-card-list erp-mobile-only"}));
  assert.match(cards, /^<div class="ui-skeleton-cards erp-card-list erp-mobile-only">/);
  assert.equal(count(cards, /class="ui-skeleton-card"/g), 4);
  assert.equal(count(render(React.createElement(SkeletonCards, {})), /class="ui-skeleton-card"/g), 4, "count por defecto = 4");
  assert.equal(count(render(React.createElement(SkeletonCards, {count: NaN})), /class="ui-skeleton-card"/g), 4);
  assert.doesNotMatch(cards, />[^<]/, "las tarjetas no llevan texto");
  assertClean(cards, "SkeletonCards");
  console.log("OK: SkeletonCards — cantidad, clase responsiva de la página y valores por defecto");

  // --- CSS: un solo shimmer, sin fill-mode ni @media propio, tokens declarados ---
  const [components, tokens] = await Promise.all([
    readFile(new URL("../src/styles/components.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8"),
  ]);
  assert.equal(count(components, /@keyframes ui-shimmer/g), 1, "un solo @keyframes ui-shimmer");
  assert.match(components, /animation: ui-shimmer var\(--motion-shimmer-duration\) linear infinite/);
  assert.match(components, /background-size: 300% 100%/);
  assert.match(
    components,
    /var\(--color-skeleton-base\) 0%,\s*var\(--color-skeleton-base\) 40%,\s*var\(--color-skeleton-highlight\) 50%,\s*var\(--color-skeleton-base\) 60%,\s*var\(--color-skeleton-base\) 100%/,
    "paradas base 0/40, highlight 50, base 60/100"
  );
  const start = components.indexOf("/* Skeleton —");
  const end = components.indexOf(".ui-skeleton-card__header");
  assert.ok(start > -1 && end > start);
  // Sin comentarios: uno de ellos menciona animation-fill-mode para advertirlo.
  const skeletonCss = components.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(skeletonCss, /animation-fill-mode|forwards/, "sin animation-fill-mode: el estado en pausa es base plana");
  assert.doesNotMatch(skeletonCss, /@media/, "sin @media propio: globals.css cubre reduced motion");
  assert.match(tokens, /--motion-shimmer-duration:\s*1\.4s/);
  assert.equal(count(tokens, /--motion-shimmer-duration:/g), 1);
  console.log("OK: CSS del shimmer — un keyframes, paradas correctas, sin fill-mode ni @media propio");

  console.log("SKELETON_SMOKE_OK");
} finally {
  await vite.close();
}
