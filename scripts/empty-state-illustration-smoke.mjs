import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {scanCss, scanJs} from "./design-smoke.mjs";

// <EmptyStateIllustration> (src/components/ui/EmptyStateIllustration.jsx):
// mismo patrón que skeleton-smoke (Vite ssrLoadModule + renderToStaticMarkup,
// sin Firebase). Cubre: las 5 variantes renderizan limpio y distintas entre
// sí, el SVG es decorativo (aria-hidden + focusable=false), variante
// desconocida cae a empty-list, y que todo el color sale de tokens: cero
// literales en el JSX y en las reglas .ui-empty-illustration* de
// components.css, medidos con el mismo escáner de test:design.

const count = (markup, pattern) => (markup.match(pattern) || []).length;
const assertClean = (markup, name) =>
  assert.doesNotMatch(markup, /undefined|NaN|Infinity|<!--/, `${name}: markup sin undefined/NaN/Infinity/comentarios`);

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const module = await vite.ssrLoadModule("/src/components/ui/EmptyStateIllustration.jsx");
  const {default: EmptyStateIllustration, EMPTY_STATE_ILLUSTRATION_VARIANTS: VARIANTS} = module;
  const render = (props) => renderToStaticMarkup(React.createElement(EmptyStateIllustration, props));

  // --- Variantes ---
  assert.deepEqual(VARIANTS, ["empty-list", "no-results", "all-done", "error", "empty-search"]);
  const markups = new Map();
  for (const variant of VARIANTS) {
    const markup = render({variant});
    assertClean(markup, variant);
    assert.match(markup, new RegExp(`^<svg class="ui-empty-illustration ui-empty-illustration--${variant}"`), `${variant}: clase raíz y modificador`);
    assert.match(markup, /viewBox="0 0 160 120"/, `${variant}: viewBox fijo`);
    assert.ok(count(markup, /<(circle|rect|path)\b/g) >= 5, `${variant}: dibujo con al menos 5 formas`);
    assert.match(markup, /ui-empty-illustration__backdrop/, `${variant}: fondo circular`);
    markups.set(variant, markup);
  }
  assert.equal(new Set(markups.values()).size, VARIANTS.length, "cada variante dibuja un SVG distinto");
  console.log("OK: 5 variantes — renderizan limpio, clase raíz + modificador, viewBox fijo y dibujos distintos");

  // --- Decorativa ---
  for (const [variant, markup] of markups) {
    assert.equal(count(markup, /aria-hidden="true"/g), 1, `${variant}: aria-hidden una vez, en la raíz`);
    assert.match(markup, /^<svg[^>]*aria-hidden="true"/, `${variant}: aria-hidden en el <svg>`);
    assert.match(markup, /^<svg[^>]*focusable="false"/, `${variant}: focusable=false`);
    assert.doesNotMatch(markup, /role=|aria-label|<title|<desc|>[^<\s][^<]*</, `${variant}: sin rol, nombre ni texto propio`);
  }
  console.log("OK: decorativa — aria-hidden y focusable=false en el <svg>, sin role/aria-label/title/texto");

  // --- Fallback y className ---
  assert.equal(render({}), markups.get("empty-list"), "sin variant = empty-list");
  for (const bad of ["bogus", "", null, undefined, 3]) {
    const markup = render({variant: bad});
    assertClean(markup, `variant=${String(bad)}`);
    assert.match(markup, /ui-empty-illustration--empty-list"/, `variant=${String(bad)} cae a empty-list`);
  }
  assert.match(render({variant: "error", className: "extra"}), /^<svg class="ui-empty-illustration ui-empty-illustration--error extra"/);
  console.log("OK: variante desconocida o vacía cae a empty-list; className extra se agrega al final");

  // --- Sin color en el markup: todo vía clases ---
  for (const [variant, markup] of markups) {
    assert.doesNotMatch(markup, /\s(fill|stroke|style|color)=/, `${variant}: sin fill/stroke/style/color en atributos`);
    assert.doesNotMatch(markup, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|var\(/, `${variant}: sin colores literales ni var() en atributos`);
  }

  // --- Cero literales: mismo escáner de test:design ---
  const jsxSource = await readFile(new URL("../src/components/ui/EmptyStateIllustration.jsx", import.meta.url), "utf8");
  assert.deepEqual(scanJs(jsxSource, "EmptyStateIllustration.jsx"), [], "EmptyStateIllustration.jsx: 0 literales según test:design");

  const css = await readFile(new URL("../src/styles/components.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/(\.ui-empty-illustration[^{]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 10, "existen las reglas .ui-empty-illustration*");
  const block = rules.map((m) => m[0]).join("\n");
  assert.deepEqual(scanCss(block), [], "reglas .ui-empty-illustration*: 0 literales de color/radio/sombra/duración según test:design");
  console.log("OK: sin literales — 0 en el JSX y 0 en las reglas CSS (escáner de test:design), color solo por clase");

  // --- Cada clase usada tiene regla, y cada var() existe en tokens.css ---
  const usedParts = new Set();
  for (const markup of markups.values()) {
    for (const m of markup.matchAll(/ui-empty-illustration__([a-z-]+)/g)) usedParts.add(m[1]);
  }
  for (const part of usedParts) {
    assert.match(css, new RegExp(`\\.ui-empty-illustration__${part}\\b[^{]*\\{`), `.ui-empty-illustration__${part} tiene regla en components.css`);
  }
  const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const localAliases = new Set([...block.matchAll(/(--ui-empty-illustration-[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const m of block.matchAll(/var\((--[\w-]+)\)/g)) {
    assert.ok(defined.has(m[1]) || localAliases.has(m[1]), `${m[1]} existe en tokens.css (o es alias local)`);
  }
  for (const m of block.matchAll(/(--ui-empty-illustration-[\w-]+)\s*:\s*([^;]+);/g)) {
    assert.match(m[2].trim(), /^var\(--color-[\w-]+\)$/, `${m[1]} solo apunta a un token --color-*`);
  }
  console.log(`OK: ${usedParts.size} clases de forma con regla propia; todo var() existe en tokens.css; alias locales = un token cada uno`);

  console.log("EMPTY_STATE_ILLUSTRATION_SMOKE_OK");
} finally {
  await vite.close();
}
