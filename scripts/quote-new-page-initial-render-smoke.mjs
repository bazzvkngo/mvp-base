import assert from "node:assert/strict";
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {createServer} from "vite";
import {GENERIC_ERROR_MESSAGE} from "../src/domain/userFacingError.mjs";
import {quoteTotalsErrorMessage, tryCalculateQuoteTotals} from "../src/domain/quoteModel.mjs";

// Regresión: "Nueva cotización" se rompía en el primer render con "totalsResult.userErrorMessage is not a function"
// (commit 2032922 reemplazó `totalsResult.error?.message` por una llamada a un método que no existe). El fallo no
// dependía del país: el JSX lo evaluaba en cada render. Sin emuladores ni red.

// --- 1. Helper: texto solo cuando hay error ---------------------------------
const okResult = tryCalculateQuoteTotals([], 0, {afectaIva: true, tasaIva: 0.19, montoDecimales: 2});
assert.equal(okResult.error, null, "sin ítems el cálculo no falla");
assert.equal(quoteTotalsErrorMessage(okResult), "", "sin error no se muestra nada (ni el mensaje genérico)");
assert.equal(quoteTotalsErrorMessage(undefined), "");
assert.equal(quoteTotalsErrorMessage({totals: {}, error: null}), "");

for (const montoDecimales of [0, 2]) {
  const failed = tryCalculateQuoteTotals("no-es-una-lista", 0, {afectaIva: true, tasaIva: 0.19, montoDecimales});
  assert.ok(failed.error instanceof Error, `con ${montoDecimales} decimales el error llega en result.error`);
  const text = quoteTotalsErrorMessage(failed);
  assert.equal(typeof text, "string");
  assert.equal(text, "Los ítems de la cotización deben ser una lista.", "el mensaje en español del dominio llega como texto");
}
assert.equal(
  quoteTotalsErrorMessage({totals: {}, error: new TypeError("Cannot read properties of undefined (reading 'x')")}),
  "No se pudieron calcular los totales de la cotización.",
  "un error técnico se traduce al texto de la pantalla",
);
assert.notEqual(quoteTotalsErrorMessage({totals: {}, error: new TypeError("Failed to fetch")}), "");
assert.notEqual(GENERIC_ERROR_MESSAGE, "");

// --- 2. Guardia de fuente: userErrorMessage es una función, no un método -----
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const offenders = walk(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1").replace(/%20/g, " "))
  .filter((file) => /\.(jsx?|mjs)$/.test(file))
  .flatMap((file) => readFileSync(file, "utf8").split("\n")
    .map((line, index) => ({line, number: index + 1}))
    .filter(({line}) => /\.userErrorMessage\s*\(/.test(line))
    .map(({number}) => `${file}:${number}`));
assert.deepEqual(offenders, [], "userErrorMessage se importa y se llama como función, nunca como método de otro objeto");

// --- 3. Render inicial real de la pantalla, con 2 y con 0 decimales ----------
Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const page = await vite.ssrLoadModule("/src/pages/NewQuotePage.jsx");
  const renderInitial = (business) => renderToStaticMarkup(
    React.createElement(MemoryRouter, {initialEntries: ["/cotizaciones/nueva"]},
      React.createElement(hook.BusinessFormatProvider, {business}, React.createElement(page.default, {userId: "usuario-prueba"}))),
  );
  for (const [label, business] of [
    ["Bolivia (BOB, 2 decimales)", {paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO"}],
    ["Chile (CLP, 0 decimales)", {paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL"}],
  ]) {
    let html;
    assert.doesNotThrow(() => { html = renderInitial(business); }, `${label}: el estado inicial no lanza error`);
    assert.ok(html.length > 0, `${label}: renderiza contenido`);
    assert.ok(!html.includes(GENERIC_ERROR_MESSAGE), `${label}: sin ítems no se muestra un error de totales`);
  }
} finally {
  await vite.close();
}

console.log("QUOTE_NEW_PAGE_INITIAL_RENDER_SMOKE_OK");
