import assert from "node:assert/strict";
import {execSync} from "node:child_process";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {createServer} from "vite";
import {resolveReceptionScan} from "../src/domain/receptionModel.mjs";

// "Escanear producto" como acción principal: un solo componente compartido (ScanProductButton), con el Button común en
// variante primaria, primero en la fila de acciones y con las demás acciones secundarias. Cubre Inventario, Cotización,
// Venta, Orden de compra, Compra y Recepción. Sin emuladores ni red.

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const strip = (html) => html.replace(/<!-- -->/g, "");

Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});

// --- 1. Código fuente: un solo botón de escaneo de producto, sin duplicados ---------------------------------------------
const shared = read("src/components/barcode/ScanProductButton.jsx");
assert.match(shared, /actionVariant="primary"/, "el botón compartido es primario");
assert.match(shared, /actionLabel=\{SCAN_PRODUCT_LABEL\}/);
assert.match(shared, /export const SCAN_PRODUCT_LABEL = "Escanear producto";/);
assert.match(shared, /actionClassName="ui-scan-product"/);
assert.doesNotMatch(shared, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "sin colores literales");

const barcodeInput = read("src/components/barcode/BarcodeInput.jsx");
assert.match(barcodeInput, /import Button from "..\/ui\/Button";/, "reutiliza el Button común");
assert.match(barcodeInput, /<Button type="button" variant=\{actionVariant\} icon=\{ScanLine\}/);

const screens = {
  "Cotización, Venta, Orden de compra y Compra": ["src/components/ui/DocumentItemsEditor.jsx", /import ScanProductButton from "..\/barcode\/ScanProductButton";/],
  "Venta histórica": ["src/features/sales/SaleItemsEditor.jsx", /import ScanProductButton from "..\/..\/components\/barcode\/ScanProductButton";/],
  Recepción: ["src/pages/NewReceptionPage.jsx", /import ScanProductButton from "..\/components\/barcode\/ScanProductButton";/],
  Inventario: ["src/features/inventory/InventoryManager.jsx", /import ScanProductButton from "..\/..\/components\/barcode\/ScanProductButton";/],
};
for (const [screen, [file, importLine]] of Object.entries(screens)) {
  const source = read(file);
  assert.match(source, importLine, `${screen}: usa el botón compartido`);
  assert.match(source, /<ScanProductButton /, `${screen}: lo dibuja`);
  assert.doesNotMatch(source, /actionLabel="Escanear producto"/, `${screen}: no repite el botón propio`);
  assert.doesNotMatch(source, /<BarcodeInput actionOnly/, `${screen}: sin otro botón de escaneo de acción`);
}

// El texto "Escanear producto" solo se define en el botón compartido (y en Trabajos, fuera de este alcance).
const holders = execSync("git grep -l \"actionLabel=\\\"Escanear producto\\\"\" -- src", {encoding: "utf8"}).split(/\r?\n/).filter(Boolean);
assert.deepEqual(holders.filter((file) => !file.endsWith("WorksPage.jsx")), [], "ninguna pantalla de ítems define su propio botón Escanear producto");

// --- 2. Orden en el código: el escaneo va primero y las demás acciones son secundarias -------------------------------------
const items = read("src/components/ui/DocumentItemsEditor.jsx");
assert.ok(items.indexOf("<ScanProductButton") < items.indexOf("onClick={onOpenCatalog}"), "Documentos: Escanear antes de Agregar desde inventario");
assert.match(items, /<Button type="button" variant="secondary" onClick=\{onOpenCatalog\}>Agregar desde inventario<\/Button>/);

const reception = read("src/pages/NewReceptionPage.jsx");
const receptionActions = reception.slice(reception.indexOf('<div className="ui-step-head__actions">'));
assert.ok(receptionActions.indexOf("<ScanProductButton") < receptionActions.indexOf("Importar factura o documento"), "Recepción: Escanear antes de Importar");
assert.match(receptionActions, /<Button type="button" variant="secondary" icon=\{FileUp\}[\s\S]{0,80}?>Importar factura o documento<\/Button>/, "Recepción: Importar es secundario");

const inventory = read("src/features/inventory/InventoryManager.jsx");
const inventoryHeader = inventory.slice(inventory.indexOf('<div className="erp-module-actions inventory-header-actions">'));
assert.ok(inventoryHeader.indexOf("<ScanProductButton continuous={false}") > -1 && inventoryHeader.indexOf("<ScanProductButton") < inventoryHeader.indexOf("importOptions.length"), "Inventario: Escanear es lo primero de las acciones del encabezado");
assert.doesNotMatch(inventory, /\{\(!cannotWrite \|\| canStartPurchase\) && <div className="erp-module-intro">/, "Inventario: el encabezado con Escanear lo ven todos los roles");
assert.match(inventory, /<BarcodeInput actionLabel="Escanear"/, "el campo de código de barras del formulario no cambia");

// --- 3. CSS: ancho completo en móvil, sin literales ----------------------------------------------------------------------
const css = read("src/styles/components.css");
assert.ok(/@media \(max-width: 767px\) \{\s*\.ui-scan-product \{ width: 100%; \}\s*\}/.test(css), "en móvil el botón de escanear ocupa todo el ancho");
assert.equal((css.match(/\.ui-scan-product\b/g) || []).length, 1, "una sola regla para el botón (sin estilos duplicados)");
assert.doesNotMatch(read("src/components/barcode/barcode.css"), /ui-scan-product/);

// --- 4. Render real: primario, con ícono, primero en la fila ------------------------------------------------------------
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const ScanProductButton = (await vite.ssrLoadModule("/src/components/barcode/ScanProductButton.jsx")).default;
  const DocumentItemsEditor = (await vite.ssrLoadModule("/src/components/ui/DocumentItemsEditor.jsx")).default;
  const SaleItemsEditor = (await vite.ssrLoadModule("/src/features/sales/SaleItemsEditor.jsx")).default;
  const business = {paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO"};
  const wrap = (element) => strip(renderToStaticMarkup(
    React.createElement(MemoryRouter, {initialEntries: ["/"]}, React.createElement(hook.BusinessFormatProvider, {business}, element)),
  ));
  const buttons = (html) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => ({
    attrs,
    label: inner.replace(/<[^>]+>/g, "").trim(),
    primary: /\bui-button--primary\b/.test(attrs),
    secondary: /\bui-button--secondary\b/.test(attrs),
  }));
  const scanModes = (html) => [...html.matchAll(/data-scan-mode="([^"]*)"/g)].map((match) => match[1]);
  const noop = () => {};
  const onScanProduct = async () => ({key: "p1", label: "Producto"});

  // El componente solo.
  const alone = wrap(React.createElement(ScanProductButton, {onSubmit: noop}));
  assert.match(alone, /class="ui-button ui-button--primary ui-scan-product"/, "primario y con la clase de ancho móvil");
  assert.match(alone, /<svg/, "con ícono");
  assert.equal(buttons(alone)[0].label, "Escanear producto");
  assert.deepEqual(scanModes(alone), ["continuous"], "por defecto, escaneo continuo");
  assert.deepEqual(scanModes(wrap(React.createElement(ScanProductButton, {continuous: false, onSubmit: noop}))), ["single"], "Inventario: lectura única");
  assert.match(wrap(React.createElement(ScanProductButton, {disabled: true, onSubmit: noop})), /<button[^>]*disabled=""/, "se puede bloquear");

  // Cotización, Venta, Orden de compra y Compra comparten este bloque: el escaneo es el primer botón de la fila de acciones.
  for (const mode of ["venta", "compra"]) {
    const html = wrap(React.createElement(DocumentItemsEditor, {items: [], mode, onChange: noop, onOpenCatalog: noop, onScanProduct, title: "¿Qué vendes?", titleId: "t"}));
    const actions = html.slice(html.indexOf('class="ui-step-head__actions"'));
    const [first, second] = buttons(actions);
    assert.equal(first.label, "Escanear producto", `${mode}: Escanear producto es el primero`);
    assert.ok(first.primary && !first.secondary, `${mode}: Escanear producto es primario`);
    assert.equal(second.label, "Agregar desde inventario", `${mode}: Agregar desde inventario va después`);
    assert.ok(second.secondary && !second.primary, `${mode}: Agregar desde inventario es secundario`);
  }

  // Sin permiso para cambiar: no se ofrece ninguna de las dos acciones.
  const locked = wrap(React.createElement(DocumentItemsEditor, {canChange: false, items: [], onChange: noop, onOpenCatalog: noop, onScanProduct, title: "t", titleId: "t"}));
  assert.ok(!locked.includes("Escanear producto") && !locked.includes("Agregar desde inventario"));

  // Venta ya confirmada (bloque histórico): mismo botón compartido, primero y primario; el catálogo, secundario.
  const historical = wrap(React.createElement(SaleItemsEditor, {historical: true, inventory: [], items: [], onChange: noop, onOpenCatalog: noop, onScanProduct, readOnly: false}));
  const [hFirst, hSecond] = buttons(historical.slice(historical.indexOf('class="po-header__actions"')));
  assert.ok(hFirst.label === "Escanear producto" && hFirst.primary, "Venta histórica: Escanear primero y primario");
  assert.ok(hSecond.label === "Agregar desde inventario" && hSecond.secondary, "Venta histórica: catálogo secundario");
} finally {
  await vite.close();
}

// --- 5. Recepción: el escaneo suma 1 a "Recibir ahora" sin pasar de lo pendiente ----------------------------------------
const lines = [
  {lineaId: "l1", itemId: "p1", tipoItem: "producto", nombre: "Cable UTP", cantidadSolicitada: 5, cantidadRecibidaAnterior: 2, cantidad: 0},
  {lineaId: "l2", itemId: "s1", tipoItem: "servicio", nombre: "Instalación", cantidadSolicitada: 1, cantidadRecibidaAnterior: 0, cantidad: 0},
];
let result = resolveReceptionScan(lines, "p1");
assert.deepEqual([result.status, result.line.lineaId, result.cantidad], ["added", "l1", 1], "primera lectura: suma 1 a la línea del producto");
result = resolveReceptionScan([{...lines[0], cantidad: 2}], "p1");
assert.deepEqual([result.status, result.cantidad], ["added", 3], "sigue sumando mientras haya pendiente");
assert.equal(resolveReceptionScan([{...lines[0], cantidad: 3}], "p1").status, "completed", "no pasa de lo pendiente (3)");
assert.equal(resolveReceptionScan(lines, "p9").status, "not_in_reception", "producto que no está en la orden");
assert.equal(resolveReceptionScan(lines, "s1").status, "not_in_reception", "un servicio no se recibe escaneando");
assert.match(reception, /Producto no encontrado para este código\./, "código que no es de ningún producto");
assert.match(reception, /no está en esta recepción: no figura en la orden de compra\./, "mensaje claro si el producto no está en la orden");
assert.match(reception, /Ya se completó lo pendiente de \$\{result\.line\.nombre\}\./, "mensaje claro si ya se recibió todo lo pendiente");

console.log("scan-product-button-smoke OK");
