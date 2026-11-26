import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {createServer} from "vite";

// Bloque de ítems compartido (DocumentItemsEditor) para Nueva venta, Nueva compra y Nueva orden de compra. Solo presentación:
// etiquetas visibles, símbolo y decimales de la moneda del negocio, botones "Escanear producto" y "Agregar desde inventario",
// títulos con signos de interrogación y la fecha del encabezado con barras. Sin emuladores ni red.

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const strip = (html) => html.replace(/<!-- -->/g, "").replace(/\u00a0/g, " ");
const plain = (text) => String(text).replace(/\u00a0/g, " ");
const count = (text, pattern) => (text.match(pattern) || []).length;
const BOB = {paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO"};
const CLP = {paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL"};

Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const formatters = await vite.ssrLoadModule("/src/utils/formatters.js");
  const shared = (await vite.ssrLoadModule("/src/components/ui/DocumentItemsEditor.jsx")).default;
  const wrap = (element, business) => strip(renderToStaticMarkup(
    React.createElement(MemoryRouter, {initialEntries: ["/"]},
      React.createElement(hook.BusinessFormatProvider, {business}, element)),
  ));

  // --- 1. Moneda: símbolo y decimales salen de la moneda del negocio, sin "$" fijo -------------------------------------------
  assert.equal(formatters.getCurrencySymbol("BOB", "es-BO"), "Bs", "BOB: Bs");
  assert.equal(formatters.getCurrencySymbol("CLP", "es-CL"), "$", "CLP: $");
  assert.equal(formatters.getCurrencySymbol(undefined, undefined), "$", "sin negocio: CLP, como siempre");
  assert.equal(plain(formatters.formatBusinessMoney(171, "BOB", "es-BO")), "Bs 171,00", "BOB: 2 decimales");
  assert.equal(plain(formatters.formatBusinessMoney(171, "CLP", "es-CL")), "$171", "CLP: 0 decimales");
  const component = read("src/components/ui/DocumentItemsEditor.jsx");
  assert.doesNotMatch(component, />\$</, "el bloque no escribe el símbolo de dólar a mano");
  assert.doesNotMatch(component, /es-CL/, "el bloque no fija el locale");
  assert.match(component, /getCurrencySymbol\(currency, locale\)/, "el símbolo sale de la moneda del negocio");

  // --- 2. Render en modo venta y en modo compra ------------------------------------------------------------------------------
  const items = [
    {lineaId: "a", itemId: "p1", codigo: "FA-1", nombre: "Filtro de aceite", descripcion: "Filtro de aceite", tipoItem: "producto", unidad: "un", cantidad: 3, precioUnitario: 60, costoUnitario: 40, descuentoPct: 5},
    {lineaId: "b", itemId: "p2", codigo: "SV-1", nombre: "Instalación", descripcion: "Mano de obra en sitio", tipoItem: "servicio", unidad: "unidad", cantidad: 1, precioUnitario: 20.5, costoUnitario: 12.25, descuentoPct: 0},
  ];
  const base = {items, onChange() {}, onOpenCatalog() {}, onScanProduct: async () => ({key: "p1", label: "Filtro"})};
  const render = (props, business = BOB) => wrap(React.createElement(shared, {...base, ...props}), business);
  const modes = [
    ["venta", {title: "¿Qué vendes?", titleId: "sale-items-title", priceLabel: "Precio unitario", price: 60}],
    ["compra", {title: "¿Qué compras?", titleId: "purchase-items-title", priceLabel: "Costo unitario", price: 40}],
    ["compra", {title: "¿Qué pides?", titleId: "po-items-title", priceLabel: "Costo unitario", price: 40}],
  ];
  for (const [mode, spec] of modes) {
    for (const [country, business, symbol] of [["BOB", BOB, "Bs"], ["CLP", CLP, "$"]]) {
      const html = render({mode, title: spec.title, titleId: spec.titleId, moneyStep: country === "BOB" ? "0.01" : "any"}, business);
      const label = `${mode} · ${spec.title} · ${country}`;
      assert.ok(html.includes(`<h2 id="${spec.titleId}" class="ui-step-title">${spec.title}</h2>`), `${label}: título con signos de interrogación`);
      assert.match(spec.title, /^¿[^?]*\?$/, `${label}: abre con ¿ y cierra con ?`);
      assert.ok(html.includes("2 ítems"), `${label}: contador`);
      assert.ok(html.includes("Escanear producto"), `${label}: Escanear producto`);
      assert.ok(html.includes("Agregar desde inventario") && !html.includes("Agregar desde catálogo"), `${label}: Agregar desde inventario`);
      assert.deepEqual([...html.matchAll(/data-scan-mode="([^"]*)"/g)].map((match) => match[1]), ["continuous"], `${label}: escaneo continuo`);
      // Etiquetas visibles pequeñas y campos con nombre accesible
      for (const caption of ["Cantidad", spec.priceLabel, "Desc. %", "Total"]) {
        assert.equal(count(html, new RegExp(`class="ui-doc-line__caption"[^>]*>${caption.replace(".", "\\.")}</span>`, "g")), 2, `${label}: etiqueta visible "${caption}" en cada fila`);
      }
      for (const name of ["Filtro de aceite", "Instalación"]) {
        assert.ok(html.includes(`aria-label="${spec.priceLabel} de ${name}"`), `${label}: ${name}: ${spec.priceLabel}`);
        assert.ok(html.includes(`aria-label="Descuento % de ${name}"`), `${label}: ${name}: descuento`);
        assert.ok(html.includes(`aria-label="Disminuir cantidad de ${name}"`) && html.includes(`aria-label="Aumentar cantidad de ${name}"`), `${label}: ${name}: − y +`);
        assert.ok(html.includes(`aria-label="Quitar ${name}"`), `${label}: ${name}: quitar`);
      }
      // Símbolo de la moneda del negocio y paso de los decimales
      assert.equal(count(html, new RegExp(`<span class="ui-doc-line__symbol" aria-hidden="true">${symbol.replace("$", "\\$")}</span>`, "g")), 2, `${label}: símbolo ${symbol} en cada fila`);
      assert.match(html, new RegExp(`aria-label="${spec.priceLabel} de Filtro de aceite"[^>]*step="${country === "BOB" ? "0\\.01" : "any"}"[^>]*value="${spec.price}"`), `${label}: paso y valor del importe`);
      assert.match(html, /aria-label="Descuento % de Filtro de aceite"[^>]*max="100"[^>]*step="any"[^>]*value="5"/, `${label}: descuento visible, no plegado`);
      assert.ok(!html.includes("<details") && !html.includes("Pencil"), `${label}: sin desplegable ni lápiz`);
      // Total de la primera línea: 3 × precio × (1 − 5 %) con el formato de la moneda
      const expected = mode === "venta" ? 171 : 114;
      const money = plain(formatters.formatBusinessMoney(expected, business.monedaCodigo, business.locale));
      assert.ok(html.includes(money), `${label}: total ${money} con el formato de ${country}`);
      assert.equal(money, country === "BOB" ? `Bs ${expected},00` : `$${expected}`, `${label}: ${country === "BOB" ? "2 decimales" : "0 decimales"}`);
      assert.ok(!(country === "BOB" && /\$\s?\d/.test(html)), `${label}: en BOB no aparece el signo de dólar`);
      // Descripción solo si difiere del nombre; "unidad" genérica no se repite
      assert.ok(html.includes("Mano de obra en sitio") && count(html, /ui-doc-line__description/g) === 1, `${label}: descripción solo si difiere`);
      assert.ok(html.includes("SV-1 · Servicio</small>") && html.includes("FA-1 · Producto · un</small>"), `${label}: código · tipo · unidad`);
      // Estado vacío
      assert.ok(render({mode, title: spec.title, titleId: spec.titleId, items: []}, business).includes("Agrega productos, servicios o actividades."), `${label}: estado vacío`);
    }
  }
  assert.ok(render({mode: "venta", title: "x", titleId: "x"}).includes("Precio unitario de") && !render({mode: "venta", title: "x", titleId: "x"}).includes("Costo unitario de"), "venta: precio, no costo");
  assert.ok(render({mode: "compra", title: "x", titleId: "x"}).includes("Costo unitario de") && !render({mode: "compra", title: "x", titleId: "x"}).includes("Precio unitario de"), "compra: costo, no precio");
  assert.ok(render({mode: "compra", title: "x", titleId: "x", onScanProduct: undefined}).includes("Agregar desde inventario") && !render({mode: "compra", title: "x", titleId: "x", onScanProduct: undefined}).includes("Escanear producto"), "sin escáner conectado no se dibuja el botón");

  // --- 3. Bloqueos y solo lectura ----------------------------------------------------------------------------------------------
  const locked = render({mode: "compra", title: "x", titleId: "x", canChange: false, disabled: true});
  assert.ok(!locked.includes("Agregar desde inventario") && !locked.includes("Escanear producto") && !locked.includes('aria-label="Quitar'), "sin permiso: no se agrega, no se escanea ni se quita");
  assert.match(locked, /aria-label="Costo unitario de Filtro de aceite"[^>]*disabled=""/, "sin permiso: los campos quedan deshabilitados");
  const staticHtml = render({mode: "venta", title: "x", titleId: "x", canChange: false, disabled: true, readOnly: true});
  assert.ok(!staticHtml.includes("<input") && !staticHtml.includes("ui-qty") && staticHtml.includes("Precio unitario") && staticHtml.includes("Desc. %"), "solo lectura: valores estáticos con sus etiquetas");

  // --- 4. Ganchos propios de cada documento (el bloque no decide nada de negocio) --------------------------------------------
  const hooks = render({
    mode: "venta", title: "x", titleId: "x",
    getLineMeta: (item) => (item.itemId === "p1" ? "Disponible 7" : ""),
    getMaxQuantity: () => 3,
    renderLineAlert: (item) => (item.itemId === "p2" ? React.createElement("div", {role: "alert"}, "Stock insuficiente") : null),
    renderTitleExtra: (item) => (item.itemId === "p2" ? React.createElement("span", {className: "sale-item-type"}, "Adicional") : null),
  });
  assert.ok(hooks.includes("FA-1 · Producto · un · Disponible 7</small>"), "getLineMeta se suma a la segunda línea");
  assert.ok(hooks.includes('role="alert">Stock insuficiente') && hooks.includes(">Adicional<"), "avisos y marcas por línea");
  assert.match(hooks, /aria-label="Aumentar cantidad de Filtro de aceite"[^>]*disabled=""/, "con el máximo alcanzado el + queda deshabilitado");
  assert.match(hooks, /aria-label="Cantidad de Filtro de aceite"[^>]*max="3"/);

  // --- 5. Los tres documentos usan el bloque, cada uno con su título y su modo -----------------------------------------------
  const saleEditor = read("src/features/sales/SaleItemsEditor.jsx");
  const purchaseEditor = read("src/features/purchases/PurchaseItemsEditor.jsx");
  const orderEditor = read("src/features/purchaseOrders/PurchaseOrderItemsEditor.jsx");
  assert.match(saleEditor, /mode="venta"[\s\S]*title="¿Qué vendes\?"/);
  assert.match(purchaseEditor, /mode="compra"[\s\S]*title="¿Qué compras\?"/);
  assert.match(orderEditor, /mode="compra"[\s\S]*title="¿Qué pides\?"/);
  for (const [name, source] of [["Venta", saleEditor], ["Compra", purchaseEditor], ["Orden de compra", orderEditor]]) {
    assert.match(source, /<DocumentItemsEditor/, `${name}: usa el bloque compartido`);
    assert.match(source, /onScanProduct=\{onScanProduct\}/, `${name}: Escanear producto conectado`);
    assert.match(source, /onOpenCatalog=\{onOpenCatalog\}/, `${name}: Agregar desde inventario conectado`);
  }
  // Compra: el escáner es el existente y agrega como el diálogo de inventario
  const purchasePage = read("src/pages/NewPurchasePage.jsx");
  assert.match(purchasePage, /findActiveProductByBarcode\(businessId, barcode\)/, "Compra: mismo escáner y misma búsqueda por código de barras");
  assert.match(purchasePage, /onScanProduct=\{addScannedProduct\}/);
  assert.match(purchasePage, /return \{key: product\.id, label: product\.nombre\}/);
  assert.match(purchasePage, /Producto no encontrado para este código\./);

  // --- 6. Fecha del encabezado: mismo formato y helper en Venta, Compra y Reportes (dd/mm/aaaa) -------------------------------
  assert.equal(formatters.formatDate("2026-11-23", "es-BO"), "23/11/2026", "es-BO: dd/mm/aaaa con barras");
  assert.equal(formatters.formatDate("2026-11-23", "es-CL"), "23-11-2026", "es-CL conserva su formato");
  const salePage = read("src/pages/NewSalePage.jsx");
  assert.match(salePage, /<span>\{formatDate\(draft\.fechaVenta, printable\.locale\)\}<\/span>/, "Venta: fecha del encabezado con el locale del documento, como Compra");
  assert.match(purchasePage, /formatDate\(draft\.fechaCompra, printable\.locale\)/, "Compra: mismo helper y mismo locale");
  assert.match(read("src/features/reports/views/ReportsVentasView.jsx"), /formatDate\(String\(sale\.fechaVenta \|\| ""\)\.slice\(0, 10\), businessLocale\)/, "Reportes: mismo helper con el locale del negocio");
  assert.match(salePage, /import \{formatDate, formatTimestamp\} from "\.\.\/utils\/formatters";/, "Venta usa el helper de utils/formatters");
  assert.match(purchasePage, />Fecha de compra\n?\s*<input type="date"/, "etiqueta \"Fecha de compra\"");
  assert.doesNotMatch(purchasePage, /Fecha compra/);
} finally {
  await vite.close();
}

// --- 7. CSS: el bloque vive en components.css (ui-doc-*), solo tokens; Ventas ya no define sus filas -----------------------
const uiCss = read("src/styles/components.css");
const block = uiCss.slice(uiCss.indexOf("/* Bloque de ítems de un documento en edición"), uiCss.indexOf("/* Fin del bloque de ítems del documento."));
assert.ok(block.length > 1500, "se localiza el bloque compartido");
assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "sin colores literales");
assert.doesNotMatch(block, /--color-(brand-[6-9]00|dark-)/, "sin tokens que no cambian con el tema");
assert.doesNotMatch(block, /border-radius:\s*\d|box-shadow:\s*\d|transition:[^;]*\d+m?s/, "sin radios, sombras ni duraciones literales");
assert.match(block, /\.ui-doc-line__input:focus-visible \{ outline: var\(--focus-outline\)/, "foco visible en precio y descuento");
assert.match(block, /\.ui-doc-line__money:focus-within \{ outline: var\(--focus-outline\)/, "foco visible en el importe con símbolo");
assert.match(block, /\.ui-doc-line__input \{[^}]*font-weight: var\(--font-weight-regular\)/, "valores escritos en peso normal");
assert.match(block, /@container \(max-width: 46rem\)[\s\S]*@container \(max-width: 30rem\)/, "la fila baja a dos y a tres renglones con poco ancho");
assert.match(block, /grid-template-areas: "identity identity remove" "qty qty total" "price discount discount"/, "tres renglones sin cortar el precio ni el descuento");
const features = ["src/features/sales/sales.css", "src/features/purchases/purchases.css", "src/features/purchaseOrders/purchase-orders.css"].map(read).join("\n");
assert.doesNotMatch(features, /\.(purchase-line|purchase-lines|purchase-items-card|sale-line__row|sale-qty|sale-price__input)\b/, "los features ya no definen las filas");

console.log("DOCUMENT_ITEMS_EDITOR_SMOKE_OK");
