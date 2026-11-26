import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {createServer} from "vite";
import {resolveDocumentTaxRate} from "../src/domain/localization.mjs";
import {addInventoryItemToSale, calculateSaleDraftTotals} from "../src/domain/saleModel.mjs";

// Ventas: agregar desde inventario / escanear suma cantidad en vez de duplicar líneas, con tope por stock en
// productos; y la etiqueta del impuesto del resumen vacío usa la tasa del país del negocio. Sin emuladores ni red.

const product = (overrides = {}) => ({id: "p1", nombre: "Filtro de aceite", tipoItem: "producto", stock: 10, precioInterno: 100, ...overrides});
const service = (overrides = {}) => ({id: "s1", nombre: "Instalación", tipoItem: "servicio", stock: null, precioInterno: 500, ...overrides});
let seq = 0;
const lineFor = (item) => () => ({lineaId: `l${++seq}`, itemId: item.id, tipoItem: item.tipoItem, cantidad: 1, precioUnitario: Number(item.precioInterno || 0), descuentoPct: 0});
const add = (items, item, quantity = 1) => addInventoryItemToSale(items, item, {quantity, createLine: lineFor(item)});
const qtys = (items) => items.map((line) => [line.itemId, line.cantidad]);

// --- 1. Agregar el mismo ítem 3 veces: una sola línea con cantidad 3 --------------------
let items = [];
for (let i = 0; i < 3; i += 1) {
  const result = add(items, product());
  assert.equal(result.action, i === 0 ? "added" : "incremented");
  items = result.items;
}
assert.deepEqual(qtys(items), [["p1", 3]], "3 agregados = 1 línea de cantidad 3");

// Otro ítem sí crea otra línea, y no toca la anterior.
items = add(items, product({id: "p2", nombre: "Bujía"})).items;
assert.deepEqual(qtys(items), [["p1", 3], ["p2", 1]]);

// --- 2. Cantidad elegida en el selector (incluye decimales, como el campo de la línea) --
assert.deepEqual(qtys(add([], product(), 4).items), [["p1", 4]]);
assert.deepEqual(qtys(add(add([], product(), 1.5).items, product(), 2.3).items), [["p1", 3.8]], "sin 3,8000000000000003");
assert.equal(add([], product(), 0).action, "invalid");
assert.equal(add([], product(), -2).action, "invalid");
assert.equal(add([], product(), "abc").action, "invalid");
assert.deepEqual(add([], product({id: ""})).items, []);

// --- 3. Tope por stock (solo productos) -------------------------------------------------
const atMax = add([{lineaId: "a", itemId: "p1", tipoItem: "producto", cantidad: 10, precioUnitario: 100, descuentoPct: 0}], product());
assert.equal(atMax.action, "stock_limit", "en el máximo no suma");
assert.equal(atMax.available, 10, "informa el stock para el aviso");
assert.deepEqual(qtys(atMax.items), [["p1", 10]]);
const nearMax = add([{lineaId: "a", itemId: "p1", tipoItem: "producto", cantidad: 8, precioUnitario: 100, descuentoPct: 0}], product(), 5);
assert.equal(nearMax.action, "incremented");
assert.equal(nearMax.limited, true, "pidió 5 y solo caben 2");
assert.deepEqual(qtys(nearMax.items), [["p1", 10]]);
const overOnFirst = add([], product({stock: 3}), 7);
assert.equal(overOnFirst.action, "added");
assert.deepEqual([overOnFirst.items[0].cantidad, overOnFirst.limited], [3, true]);
assert.equal(add([], product({stock: 0})).action, "stock_limit", "sin stock no se agrega");
// El tope cuenta todas las líneas del ítem, no solo la que se suma.
const twoLines = [
  {lineaId: "a", itemId: "p1", tipoItem: "producto", cantidad: 6, precioUnitario: 100, descuentoPct: 0},
  {lineaId: "b", itemId: "p1", tipoItem: "producto", cantidad: 4, precioUnitario: 80, descuentoPct: 0},
];
assert.equal(add(twoLines, product()).action, "stock_limit");
// Stock decimal.
assert.equal(add([{lineaId: "a", itemId: "p1", tipoItem: "producto", cantidad: 2.5, precioUnitario: 100, descuentoPct: 0}], product({stock: 2.5})).action, "stock_limit");
// Servicios, actividades y productos sin stock informado: sin tope.
for (const free of [service(), service({id: "a1", tipoItem: "actividad", stock: 0}), product({stock: null}), product({stock: undefined}), product({stock: ""})]) {
  let list = [];
  for (let i = 0; i < 50; i += 1) list = add(list, free).items;
  assert.deepEqual(qtys(list), [[free.id, 50]], `${free.tipoItem} sin tope`);
}

// --- 4. Precio editado o descuento: línea nueva, sin pisar ni arrastrar el ajuste ---------
// Regla: solo se suma a una línea "limpia" (mismo ítem, sin descuento, precio igual al del inventario).
const edited = [{lineaId: "a", itemId: "p1", tipoItem: "producto", cantidad: 2, precioUnitario: 90, descuentoPct: 0}];
const afterEdited = add(edited, product());
assert.equal(afterEdited.action, "added", "precio editado ≠ inventario: línea nueva");
assert.deepEqual(afterEdited.items.map((l) => [l.lineaId, l.cantidad, l.precioUnitario]), [["a", 2, 90], ["l" + seq, 1, 100]], "la línea editada queda intacta");
const again = add(afterEdited.items, product());
assert.equal(again.action, "incremented", "la siguiente suma a la línea limpia, no crea una tercera");
assert.deepEqual(again.items.map((l) => [l.cantidad, l.precioUnitario]), [[2, 90], [2, 100]]);
const discounted = [{lineaId: "a", itemId: "p1", tipoItem: "producto", cantidad: 2, precioUnitario: 100, descuentoPct: 10}];
const afterDiscount = add(discounted, product());
assert.equal(afterDiscount.action, "added", "con descuento: línea nueva sin descuento");
assert.deepEqual(afterDiscount.items.map((l) => [l.cantidad, l.descuentoPct]), [[2, 10], [1, 0]]);
// Precio del inventario que cambió después de armar la línea: cuenta como precio distinto.
assert.equal(add([{lineaId: "a", itemId: "p1", tipoItem: "producto", cantidad: 1, precioUnitario: 100, descuentoPct: 0}], product({precioInterno: 120})).action, "added");
// Líneas de adicionales de un Proyecto y de una cotización (cantidad máxima): nunca se tocan.
const fromAdditional = [{lineaId: "ad", itemId: "p1", tipoItem: "producto", cantidad: 1, precioUnitario: 100, descuentoPct: 0, origenAdicionalId: "adic-1"}];
assert.deepEqual(qtys(add(fromAdditional, product()).items), [["p1", 1], ["p1", 1]]);
const fromQuote = [{lineaId: "q", itemId: "p1", tipoItem: "producto", cantidad: 1, precioUnitario: 100, descuentoPct: 0, cantidadCotizada: 1}];
assert.equal(add(fromQuote, product()).action, "added");
// El stock cuenta también las líneas de adicionales.
assert.equal(add([{...fromAdditional[0], cantidad: 10}], product()).action, "stock_limit");
// No muta la entrada.
const frozen = Object.freeze([Object.freeze({lineaId: "a", itemId: "p1", tipoItem: "producto", cantidad: 1, precioUnitario: 100, descuentoPct: 0})]);
assert.doesNotThrow(() => add(frozen, product()));

// --- 5. Escaneo repetido: mismo camino, suma de a 1 ---------------------------------------
let scanned = [];
for (let i = 0; i < 3; i += 1) scanned = add(scanned, product({stock: 3})).items;
assert.deepEqual(qtys(scanned), [["p1", 3]], "el mismo código 3 veces suma");
assert.equal(add(scanned, product({stock: 3})).action, "stock_limit", "la 4.ª lectura choca con el stock");

// --- 6. Etiqueta del impuesto con el resumen vacío ---------------------------------------
const bolivia = {paisCodigo: "BO", monedaCodigo: "BOB", impuestoPredeterminadoTasa: 13};
const chile = {paisCodigo: "CL", monedaCodigo: "CLP", impuestoPredeterminadoTasa: 19};
const emptyDraft = {descuento: 0, afectaIva: true, items: []};
const label = (company, draft = emptyDraft, sale = null) => Number((calculateSaleDraftTotals(draft, {taxRate: resolveDocumentTaxRate(sale, company)}).tasaIva * 100).toFixed(4));
assert.equal(label(bolivia), 13, "Bolivia vacío: 13 %");
assert.equal(label(chile), 19, "Chile vacío: 19 %");
assert.equal(label({paisCodigo: "BO"}), 13, "Bolivia sin tasa guardada: la base del país");
assert.equal(label({paisCodigo: "CL"}), 19);
const withItems = {descuento: 0, afectaIva: true, items: [{lineaId: "a", itemId: "p1", nombre: "x", tipoItem: "producto", unidad: "unidad", cantidad: 1, precioUnitario: 100, descuentoPct: 0}]};
assert.equal(label(bolivia, withItems), label(bolivia), "vacío y con ítems muestran la misma tasa");
assert.equal(label(chile, withItems), label(chile));
assert.equal(label(bolivia, {...emptyDraft, afectaIva: false}), 0, "exenta: tasa 0");
assert.equal(label(bolivia, emptyDraft, {tasaIva: 0.13}), 13, "la tasa del documento guardado manda");
assert.equal(label(bolivia, {...emptyDraft, items: "no-lista"}), 13, "un cálculo inválido conserva la tasa del país");
const emptyTotals = calculateSaleDraftTotals({...emptyDraft, descuento: 5}, {taxRate: 0.13});
assert.deepEqual([emptyTotals.subtotal, emptyTotals.iva, emptyTotals.total, emptyTotals.descuento], [0, 0, 0, 5], "los importes del vacío no cambian");
// Con ítems el resultado es el de calculateSaleTotals (sin cambios de cálculo).
const bolivianTotals = calculateSaleDraftTotals({...withItems, items: [{...withItems.items[0], cantidad: 3, precioUnitario: 3.5}]}, {taxRate: 0.13, montoDecimales: 2});
assert.deepEqual([bolivianTotals.neto, bolivianTotals.iva, bolivianTotals.total], [10.5, 1.37, 11.87]);

// --- 7. Fuente: la pantalla y el selector usan la función, y el panel pinta la tasa ---------
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const page = read("src/pages/NewSalePage.jsx");
assert.doesNotMatch(page, /0\.19/, "NewSalePage ya no tiene el 19 % chileno fijo");
assert.equal((page.match(/addInventoryItemToSale\(/g) || []).length, 1, "selector y escaneo comparten una sola función");
assert.match(page, /addInventoryItem\(product\)/, "el escaneo usa la misma ruta");
assert.doesNotMatch(page, /items: \[\.\.\.current\.items, newLine\(item\)\]/, "ya no se agrega sin buscar la línea existente");
assert.match(page, /<InventoryCatalogDialog /, "Venta usa el diálogo compartido (su contenido lo fija inventory-catalog-dialog-smoke)");
assert.match(page, /priceLabel="Precio"/);

// --- 8. Render: el resumen vacío dice 13 % en Bolivia y la pantalla inicial no falla ------
Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const panelModule = await vite.ssrLoadModule("/src/features/sales/SaleSummaryPanel.jsx");
  const pageModule = await vite.ssrLoadModule("/src/pages/NewSalePage.jsx");
  const countries = [
    ["Bolivia", {paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO"}, bolivia, "IVA 13%"],
    ["Chile", {paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL"}, chile, "IVA 19%"],
  ];
  for (const [name, business, company, expected] of countries) {
    const totals = calculateSaleDraftTotals(emptyDraft, {taxRate: resolveDocumentTaxRate(null, company)});
    const panel = renderToStaticMarkup(React.createElement(hook.BusinessFormatProvider, {business},
      React.createElement(panelModule.default, {currency: business.monedaCodigo, locale: business.locale, totals, taxName: "IVA", taxRate: totals.tasaIva * 100, onSave() {}, onConfirm() {}})));
    assert.ok(panel.includes(expected), `${name}: el resumen vacío dice "${expected}"`);
    const unexpected = expected === "IVA 13%" ? "IVA 19%" : "IVA 13%";
    assert.ok(!panel.includes(unexpected), `${name}: no muestra "${unexpected}"`);

    let html;
    assert.doesNotThrow(() => {
      html = renderToStaticMarkup(React.createElement(MemoryRouter, {initialEntries: ["/ventas/nueva"]},
        React.createElement(hook.BusinessFormatProvider, {business}, React.createElement(pageModule.default, {businessId: "negocio-prueba", role: "OWNER"}))));
    }, `${name}: Nueva venta se renderiza sin error`);
    assert.ok(html.length > 0);
  }
} finally {
  await vite.close();
}

console.log("SALE_ADD_ITEMS_SMOKE_OK");
