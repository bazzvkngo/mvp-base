import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {
  addInventoryItemToLines,
  catalogEntryFromInventoryItem,
  catalogEntryFromValuation,
  filterCatalogEntries,
  sumQuantitiesByItem,
} from "../src/domain/inventoryLineAdd.mjs";

// Diálogo compartido "Agregar desde inventario" de Venta, Cotización y Compra: textos uniformes, contador, "Agregar
// otra vez", cantidad por defecto 1, reagrupado con la regla de Venta, tope por stock solo en Venta. Sin emuladores.

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const strip = (html) => html.replace(/<!-- -->/g, "");

const product = (overrides = {}) => ({id: "p1", nombre: "Filtro de aceite", codigoInterno: "FA-1", tipoItem: "producto", unidad: "un", stock: 10, estado: "activo", precioInterno: 100, costoBase: 60, ...overrides});

// --- 1. Reagrupar con la regla compartida: Venta (precioUnitario), Cotización (precioUnitarioEditable), Compra (costoUnitario)
const configs = {
  venta: {priceKey: "precioUnitario", discountKey: "descuentoPct", stockLimit: true, line: (item) => ({lineaId: `v${Math.random()}`, itemId: item.id, tipoItem: item.tipoItem, cantidad: 1, precioUnitario: item.precioInterno, descuentoPct: 0}), price: "precioUnitario", value: 100},
  cotizacion: {priceKey: "precioUnitarioEditable", discountKey: "descuentoPorcentaje", stockLimit: false, line: (item) => ({lineaId: `q${Math.random()}`, itemId: item.id, tipoItem: item.tipoItem, cantidad: 1, precioUnitarioEditable: item.precioInterno, descuentoPorcentaje: 0}), price: "precioUnitarioEditable", value: 100},
  compra: {priceKey: "costoUnitario", discountKey: "descuentoPct", stockLimit: false, line: (item) => ({lineaId: `c${Math.random()}`, itemId: item.id, tipoItem: item.tipoItem, cantidad: 1, costoUnitario: item.costoBase, descuentoPct: 0}), price: "costoUnitario", value: 60},
};
const addTo = (name, lines, item, quantity = 1) => {
  const config = configs[name];
  return addInventoryItemToLines(lines, item, {itemId: item.id, quantity, createLine: () => config.line(item), priceKey: config.priceKey, discountKey: config.discountKey, stockLimit: config.stockLimit});
};
const qtys = (lines) => lines.map((line) => line.cantidad);

for (const name of Object.keys(configs)) {
  let lines = [];
  for (let i = 0; i < 3; i += 1) lines = addTo(name, lines, product()).items;
  assert.deepEqual(qtys(lines), [3], `${name}: el mismo ítem 3 veces = 1 línea de cantidad 3`);
  assert.deepEqual(qtys(addTo(name, lines, product({id: "p2"})).items), [3, 1], `${name}: otro ítem crea otra línea`);
  assert.deepEqual(qtys(addTo(name, [], product(), 2.5).items), [2.5], `${name}: cantidad elegida`);

  const {price, value, discountKey} = configs[name];
  // Precio distinto o descuento: línea nueva (regla "línea limpia" de Venta); la siguiente suma a la limpia.
  const edited = [{...configs[name].line(product()), [price]: value - 10}];
  const afterEdited = addTo(name, edited, product());
  assert.equal(afterEdited.action, "added", `${name}: precio editado -> línea nueva`);
  assert.deepEqual(qtys(addTo(name, afterEdited.items, product()).items), [1, 2], `${name}: la siguiente suma a la línea limpia`);
  const discounted = [{...configs[name].line(product()), [discountKey]: 10}];
  assert.equal(addTo(name, discounted, product()).action, "added", `${name}: con descuento -> línea nueva`);
  assert.equal(addTo(name, [{...configs[name].line(product()), origenAdicionalId: "a1"}], product()).action, "added", `${name}: nunca suma a líneas de adicionales`);
}

// --- 2. Tope por stock solo en Venta -----------------------------------------------------
const stocked = product({stock: 2});
let venta = [];
venta = addTo("venta", venta, stocked, 2).items;
const ventaBlocked = addTo("venta", venta, stocked);
assert.equal(ventaBlocked.action, "stock_limit", "Venta: en el stock máximo no suma");
assert.equal(ventaBlocked.available, 2);
assert.deepEqual(qtys(ventaBlocked.items), [2]);
assert.equal(addTo("venta", [], stocked, 5).items[0].cantidad, 2, "Venta: el pedido se recorta al stock");
for (const name of ["cotizacion", "compra"]) {
  let lines = [];
  lines = addTo(name, lines, stocked, 2).items;
  const more = addTo(name, lines, stocked, 5);
  assert.equal(more.action, "incremented", `${name}: sin tope de stock`);
  assert.deepEqual(qtys(more.items), [7], `${name}: 2 de stock y 7 agregados`);
  assert.equal(addTo(name, [], product({stock: 0})).action, "added", `${name}: sin stock igual se agrega`);
  assert.equal(more.limited, false);
}
assert.equal(addTo("venta", [], product({stock: 0})).action, "stock_limit", "Venta: sin stock no se agrega");
for (const free of [product({tipoItem: "servicio", stock: null}), product({tipoItem: "actividad", stock: 0}), product({stock: null})]) {
  let lines = [];
  for (let i = 0; i < 30; i += 1) lines = addTo("venta", lines, free).items;
  assert.deepEqual(qtys(lines), [30], `Venta: ${free.tipoItem} sin tope`);
}

// --- 3. Contador, adaptadores y filtro ----------------------------------------------------
assert.deepEqual(sumQuantitiesByItem([{itemId: "p1", cantidad: 2}, {itemId: "p1", cantidad: 1.5}, {itemId: "p2", cantidad: 1}, {itemId: "", cantidad: 9}]), {p1: 3.5, p2: 1});
assert.deepEqual(sumQuantitiesByItem(undefined), {});
const sale = catalogEntryFromInventoryItem(product(), "precioInterno");
const purchase = catalogEntryFromInventoryItem(product(), "costoBase");
assert.deepEqual([sale.precio, purchase.precio, sale.stock, sale.activo, sale.codigo], [100, 60, 10, true, "FA-1"]);
assert.equal(catalogEntryFromInventoryItem(product({stock: null}), "precioInterno").stock, null);
const valuation = {itemId: "p1", nombre: "Filtro de aceite", tipoItem: "producto", categoria: "Repuestos", unidad: "un", precioInterno: 120, item: {codigoInterno: "FA-1", descripcion: "Filtro de motor", stock: 4}};
const fromValuation = catalogEntryFromValuation(valuation);
assert.deepEqual([fromValuation.id, fromValuation.precio, fromValuation.codigo, fromValuation.categoria, fromValuation.stock, fromValuation.source === valuation], ["p1", 120, "FA-1", "Repuestos", 4, true]);
const entries = [sale, catalogEntryFromInventoryItem(product({id: "p2", nombre: "Instalación", codigoInterno: "SV-1", tipoItem: "servicio", categoria: "Mano de obra", estado: "activo", stock: null}), "precioInterno"), catalogEntryFromInventoryItem(product({id: "p3", nombre: "Archivado", estado: "archivado"}), "precioInterno")];
assert.deepEqual(filterCatalogEntries(entries).map((e) => e.id), ["p1", "p2"], "solo activos");
assert.deepEqual(filterCatalogEntries(entries, {search: "INSTALACION"}).map((e) => e.id), ["p2"], "sin tildes ni mayúsculas");
assert.deepEqual(filterCatalogEntries(entries, {search: "mano de obra"}).map((e) => e.id), ["p2"], "busca por categoría");
assert.deepEqual(filterCatalogEntries(entries, {search: "fa-1"}).map((e) => e.id), ["p1"], "busca por código");
assert.deepEqual(filterCatalogEntries(entries, {type: "servicio"}).map((e) => e.id), ["p2"]);

// --- 4. Fuentes: cada pantalla usa el diálogo compartido con sus propias reglas ------------
for (const old of ["src/features/sales/SaleCatalogDialog.jsx", "src/features/purchases/PurchaseCatalogDialog.jsx", "src/features/quotes/QuoteCatalogDialog.jsx"]) {
  assert.equal(existsSync(new URL(`../${old}`, import.meta.url)), false, `${old} ya no existe`);
}
const dialogSource = read("src/components/ui/InventoryCatalogDialog.jsx");
const salePage = read("src/pages/NewSalePage.jsx");
const quotePage = read("src/pages/NewQuotePage.jsx");
const purchasePage = read("src/pages/NewPurchasePage.jsx");
for (const [name, source] of [["Venta", salePage], ["Cotización", quotePage], ["Compra", purchasePage]]) {
  assert.match(source, /import InventoryCatalogDialog from "\.\.\/components\/ui\/InventoryCatalogDialog";/, `${name}: importa el diálogo compartido`);
  assert.equal((source.match(/<InventoryCatalogDialog\b/g) || []).length, 1, `${name}: un solo diálogo`);
  assert.doesNotMatch(source, /(?:Sale|Purchase|Quote)CatalogDialog/, `${name}: sin el diálogo anterior`);
}
assert.match(salePage, /priceLabel="Precio"/);
assert.match(quotePage, /priceLabel="Precio"/);
assert.match(purchasePage, /priceLabel="Costo"/);
assert.match(quotePage, /minQuantity=\{1\}/, "Cotización conserva su cantidad mínima 1");
assert.doesNotMatch(salePage, /minQuantity/);
assert.doesNotMatch(purchasePage, /minQuantity/);
assert.match(salePage, /addInventoryItemToSale\(/, "Venta usa su función con tope por stock");
assert.match(read("src/domain/saleModel.mjs"), /stockLimit: true/, "solo Venta activa el tope");
assert.doesNotMatch(quotePage, /stockLimit/);
assert.doesNotMatch(purchasePage, /stockLimit/);
assert.match(quotePage, /addInventoryItemToLines\(/);
assert.match(purchasePage, /addInventoryItemToLines\(/);
assert.doesNotMatch(purchasePage, /items: \[\.\.\.current\.items, \{/, "Compra ya no agrega sin buscar la línea existente");
for (const [file, label] of [["src/components/ui/DocumentItemsEditor.jsx", "Venta, Compra y Orden de compra (bloque compartido)"], ["src/features/quotes/QuoteItemsEditor.jsx", "Cotización"]]) {
  const source = read(file);
  assert.match(source, /Agregar desde inventario/, `${label}: el botón que lo abre dice "Agregar desde inventario"`);
  assert.doesNotMatch(source, /Agregar desde catálogo/);
}
// Comportamiento del diálogo fijado en la fuente (no hay DOM en estas pruebas): cantidad 1 por defecto, vuelve a 1 al
// agregar, Enter agrega, foco inicial en el buscador, cierre con Escape (ResponsiveDialog) y sin colores literales.
assert.match(dialogSource, /quantities\[id\] \?\? "1"/, "cantidad por defecto 1");
assert.match(dialogSource, /setQuantities\(\(current\) => \(\{\.\.\.current, \[entry\.id\]: "1"\}\)\);/, "vuelve a 1 tras agregar");
assert.match(dialogSource, /event\.key === "Enter"[\s\S]*add\(entry\)/, "Enter agrega");
assert.match(dialogSource, /initialFocusRef=\{searchRef\}/, "foco inicial en el buscador");
assert.match(dialogSource, /<ResponsiveDialog/, "Escape y X vienen de ResponsiveDialog");
assert.match(dialogSource, /footer=\{<Button type="button" variant="secondary" onClick=\{onClose\}>Cerrar<\/Button>\}/, "pie con Cerrar");
assert.doesNotMatch(dialogSource, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "sin colores literales");
assert.doesNotMatch(read("src/styles/components.css").split("Diálogo compartido \"Agregar desde inventario\"")[1] || "", /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "CSS del diálogo solo con tokens");

// --- 5. Render del diálogo compartido, en Bolivia y en Chile ----------------------------------
Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const dialogModule = await vite.ssrLoadModule("/src/components/ui/InventoryCatalogDialog.jsx");
  const Dialog = dialogModule.default;
  const render = (business, props) => strip(renderToStaticMarkup(React.createElement(hook.BusinessFormatProvider, {business},
    React.createElement(Dialog, {open: true, onAdd() {}, onClose() {}, ...props}))));
  const countries = [
    ["Bolivia", {paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO"}, /Bs\s?(?:100|120|60),00/],
    ["Chile", {paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL"}, /\$\s?(?:100|120|60)\b/],
  ];
  const screens = [
    ["Venta", {entries: [sale, entries[1]], priceLabel: "Precio"}],
    ["Cotización", {entries: [fromValuation], priceLabel: "Precio", minQuantity: 1}],
    ["Compra", {entries: [purchase], priceLabel: "Costo"}],
  ];
  for (const [country, business, moneyPattern] of countries) {
    for (const [screen, props] of screens) {
      const label = `${country} · ${screen}`;
      const html = render(business, props);
      // Textos uniformes
      assert.match(html, /Agregar desde inventario/, `${label}: título`);
      assert.match(html, /Ítems activos del negocio\./, `${label}: subtítulo`);
      assert.match(html, /<footer[^>]*>.*Cerrar<\/span>/s, `${label}: pie con Cerrar`);
      assert.match(html, /aria-label="Cerrar diálogo"/, `${label}: la X sigue`);
      assert.match(html, /placeholder="Nombre, código o categoría"/, `${label}: buscador`);
      assert.match(html, /resultados/, `${label}: contador de resultados`);
      assert.doesNotMatch(html, /Catálogo de inventario|Cerrar catálogo|Agregar desde catálogo/, `${label}: sin textos anteriores`);
      // Fila: cantidad por defecto 1, botón "Agregar", sin contador
      assert.match(html, /aria-label="Cantidad de [^"]+"[^>]*value="1"/, `${label}: cantidad por defecto 1`);
      assert.match(html, /<span class="ui-button__label">Agregar<\/span>/, `${label}: botón Agregar`);
      assert.doesNotMatch(html, /Agregar otra vez|Agregado:/, `${label}: sin agregados todavía`);
      // Precio o costo según la pantalla
      assert.ok(html.includes(`<small>${props.priceLabel}</small>`), `${label}: etiqueta ${props.priceLabel}`);
      assert.match(html, moneyPattern, `${label}: monto en la moneda del negocio`);
      // Contador y "Agregar otra vez"
      const added = render(business, {...props, addedQuantities: {p1: 3}});
      assert.match(added, /Agregado: 3/, `${label}: contador "Agregado: N"`);
      assert.match(added, /<span class="ui-button__label">Agregar otra vez<\/span>/, `${label}: pasa a "Agregar otra vez"`);
      // Cantidad mínima propia de la pantalla
      assert.ok(html.includes(`min="${props.minQuantity ?? 0.000001}"`), `${label}: cantidad mínima de la pantalla`);
    }
  }
  const business = countries[0][1];
  assert.match(render(business, {entries: [sale]}), /Stock disponible: 10/, "producto con stock conocido muestra su stock");
  assert.doesNotMatch(render(business, {entries: [entries[1]]}), /Stock disponible/, "un servicio no muestra stock");
  assert.match(render(business, {entries: [], loading: true}), /Cargando inventario/, "estado de carga");
  assert.match(render(business, {entries: []}), /No hay ítems activos en el inventario\./, "inventario vacío");
  assert.match(render(business, {entries: [catalogEntryFromInventoryItem(product({estado: "archivado"}), "precioInterno")]}), /No hay ítems activos en el inventario\./, "solo archivados = vacío");
  const many = Array.from({length: 25}, (_, i) => catalogEntryFromInventoryItem(product({id: `x${i}`, nombre: `Ítem ${i}`}), "precioInterno"));
  const paged = render(business, {entries: many});
  assert.match(paged, /Mostrar más/, "más de una página: Mostrar más");
  assert.equal((paged.match(/<article/g) || []).length, 20, "una página muestra 20 filas");
} finally {
  await vite.close();
}

console.log("INVENTORY_CATALOG_DIALOG_SMOKE_OK");
