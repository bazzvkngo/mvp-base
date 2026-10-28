import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {
  adaptStoredSale,
  buildSaleMutationPayload,
  calculateSaleLine,
  calculateSaleTotals,
  canManageSales,
  getSaleDocumentTypeLabel,
  getSaleItemTypeLabel,
  getSaleStatusLabel,
  getSaleStockStatusLabel,
  matchesSaleSearch,
  resolveSaleScan,
  SALE_STATUSES,
  shouldReconcileSaleConfirmation,
} from "../src/domain/saleModel.mjs";
import {stepSaleQuantity} from "../src/features/sales/saleLineStepper.mjs";
import {lineDescriptionToShow} from "../src/features/sales/saleLineText.mjs";

const require = createRequire(import.meta.url);
const {normalizeSaleInput} = require("../functions/salePersistence.js");
const {inventoryCostSnapshot} = require("../functions/workPersistence.js");
class TestHttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const line = (overrides = {}) => ({lineaId: "linea-1", itemId: "item-1", cantidad: 2, precioUnitario: 1000, descuentoPct: 10, ...overrides});

assert.deepEqual(calculateSaleLine(line()), {cantidad: 2, precioUnitario: 1000, descuentoPct: 10, subtotalLinea: 2000, descuentoLinea: 200, totalLinea: 1800});
assert.deepEqual(calculateSaleTotals([line(), line({lineaId: "linea-2", itemId: "item-2", cantidad: 1, precioUnitario: 500, descuentoPct: 0})]), {subtotal: 2500, descuentoItems: 200, descuento: 0, descuentoTotal: 200, neto: 2300, afectaIva: true, tasaIva: 0.19, iva: 437, total: 2737});
assert.deepEqual(calculateSaleTotals([line()], 300, {afectaIva: true}), {subtotal: 2000, descuentoItems: 200, descuento: 300, descuentoTotal: 500, neto: 1500, afectaIva: true, tasaIva: 0.19, iva: 285, total: 1785});
assert.deepEqual(calculateSaleTotals([line()], 300, {afectaIva: false}), {subtotal: 2000, descuentoItems: 200, descuento: 300, descuentoTotal: 500, neto: 1500, afectaIva: false, tasaIva: 0, iva: 0, total: 1500});
assert.throws(() => calculateSaleTotals([line()], 1801), /descuento general no puede superar/);
assert.throws(() => calculateSaleTotals([line()], Infinity), /número válido/);
assert.throws(() => calculateSaleLine(line({cantidad: 0})), /rango/);
assert.throws(() => calculateSaleLine(line({cantidad: NaN})), /número/);
assert.throws(() => calculateSaleLine(line({cantidad: Infinity})), /número/);
assert.throws(() => calculateSaleLine(line({precioUnitario: Number.MAX_VALUE})), /máximo permitido/);
assert.throws(() => calculateSaleLine(line({cantidad: Number.MAX_VALUE, precioUnitario: 2})), /máximo permitido/);
assert.throws(() => calculateSaleTotals([line({cantidad: 1, precioUnitario: Number.MAX_SAFE_INTEGER})]), /máximo permitido/);
assert.deepEqual(inventoryCostSnapshot({costoPromedio: 750, costoBase: 900}), {costoUnitario: 750, costoFuente: "costoPromedio"});
assert.deepEqual(inventoryCostSnapshot({costoBase: 900}), {costoUnitario: 900, costoFuente: "costoBase"});
assert.equal(inventoryCostSnapshot({}), null);
console.log("OK ventas modelo: líneas, descuentos, IVA, totales y overflow");

const sale = (count) => ({clienteId: "client-1", fechaVenta: "2026-08-07", items: Array.from({length: count}, (_, index) => line({lineaId: `linea-${index + 1}`, itemId: `item-${index + 1}`}))});
const payload = buildSaleMutationPayload({...sale(1), numero: "VTA-FAKE", estado: "confirmada", clienteSnapshot: {nombreRazonSocial: "Falso"}, stockAplicado: true, total: 1});
assert.deepEqual(payload.items[0], {lineaId: "linea-1", itemId: "item-1", cantidad: 2, precioUnitario: 1000, descuentoPct: 10, origenAdicionalId: ""});
assert.equal(payload.descuento, 0);
assert.equal(payload.afectaIva, true);
const exemptPayload = buildSaleMutationPayload({...sale(1), descuento: 300, afectaIva: false});
assert.equal(exemptPayload.descuento, 300);
assert.equal(exemptPayload.afectaIva, false);
for (const forbidden of ["numero", "estado", "clienteSnapshot", "stockAplicado", "total"]) assert.equal(Object.hasOwn(payload, forbidden), false);
assert.equal(buildSaleMutationPayload(sale(200)).items.length, 200);
assert.throws(() => buildSaleMutationPayload(sale(201)), /La venta admite hasta 200 ítems/);
assert.equal(normalizeSaleInput(sale(200), TestHttpsError).items.length, 200);
assert.equal(normalizeSaleInput(sale(1), TestHttpsError).descuento, 0);
assert.equal(normalizeSaleInput(sale(1), TestHttpsError).afectaIva, true);
assert.throws(() => normalizeSaleInput(sale(201), TestHttpsError), /La venta admite hasta 200 ítems/);
console.log("OK ventas modelo: payload mínimo y máximo de 200 líneas en frontend/backend");

const stored = adaptStoredSale({ventaId: "sale-1", numero: "VTA-2026-0001", estado: "confirmada", clienteId: "client-1", clienteSnapshot: {clienteId: "client-1", nombreRazonSocial: "Cliente Uno", rut: "76.000.000-0"}, cotizacionId: "quote-1", cotizacionNumero: "COT-2026-0001", trabajoId: "work-1", trabajoNumero: "TRB-2026-0001", trabajoTitulo: "Diagnóstico", tipoDocumento: "factura", numeroDocumento: "F-100", items: [{...line(), nombre: "Producto", tipoItem: "producto", unidad: "unidad"}]});
assert.equal(stored.id, "sale-1"); assert.equal(stored.total, 2142); assert.equal(stored.clienteSnapshot.nombreRazonSocial, "Cliente Uno");
assert.equal(stored.trabajoId, "work-1"); assert.equal(stored.trabajoNumero, "TRB-2026-0001");
for (const estado of ["confirmado", "activa", "activo"]) {
  assert.equal(adaptStoredSale({...stored, estado}).estado, "confirmada");
}
assert.equal(matchesSaleSearch(stored, "COT-2026-0001"), true); assert.equal(matchesSaleSearch(stored, "76.000.000-0"), true); assert.equal(matchesSaleSearch(stored, "nada"), false);
assert.equal(canManageSales("OWNER"), true); assert.equal(canManageSales("ADMIN"), true); assert.equal(canManageSales("VENTAS"), true); assert.equal(canManageSales("COMPRAS"), false); assert.equal(canManageSales("MEMBER"), false);
assert.deepEqual(SALE_STATUSES, ["borrador", "confirmada", "cancelada"]);
assert.equal(getSaleStatusLabel("borrador"), "Preparada");
assert.equal(getSaleStatusLabel("confirmada"), "Confirmada");
assert.equal(getSaleStockStatusLabel("pendiente_abastecimiento", stored), "Abastecimiento pendiente");
assert.equal(getSaleItemTypeLabel("servicio"), "Servicio");
assert.equal(getSaleDocumentTypeLabel("sin_documento"), "Sin documento");
assert.equal(shouldReconcileSaleConfirmation({code: "functions/unavailable"}), true);
assert.equal(shouldReconcileSaleConfirmation({code: "deadline-exceeded"}), true);
assert.equal(shouldReconcileSaleConfirmation(new Error("respuesta ambigua")), true);
assert.equal(shouldReconcileSaleConfirmation({code: "functions/failed-precondition"}), false);
console.log("OK ventas modelo: adaptación, estados, búsqueda y roles");

const backend = fs.readFileSync(new URL("../functions/salePersistence.js", import.meta.url), "utf8");
const salePage = fs.readFileSync(new URL("../src/pages/NewSalePage.jsx", import.meta.url), "utf8");
const salesHistory = fs.readFileSync(new URL("../src/pages/SalesPage.jsx", import.meta.url), "utf8");
const saleSummary = fs.readFileSync(new URL("../src/features/sales/SaleSummaryPanel.jsx", import.meta.url), "utf8");
const saleClient = fs.readFileSync(new URL("../src/features/sales/SaleClientSelector.jsx", import.meta.url), "utf8");
const saleItems = fs.readFileSync(new URL("../src/features/sales/SaleItemsEditor.jsx", import.meta.url), "utf8");
const salePrint = fs.readFileSync(new URL("../src/features/sales/SalePrintView.jsx", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
for (const token of ["saleCreateRequests", "saleConfirmRequests", "quoteSaleConversionRequests", "saleCancellationRequests", "movimientosInventario", "salida_venta", "entrada_cancelacion_venta", "efectosInventario", "stockAplicado", "costoHistoricoDisponible", "costoUnitario", "costoTotal"]) assert.match(backend, new RegExp(token));
assert.match(backend, /writeSaleConfirmationEvent/);
for (const name of ["ventas", "saleCounters", "saleCreateRequests", "saleConfirmRequests", "saleCancellationRequests", "quoteSaleConversionRequests"]) assert.match(rules, new RegExp(`match /${name}/`));
assert.match(salePage, /pendingConfirmationSaleId/);
assert.match(salePage, /obtenerVenta\(businessId, stored\.id\)/);
assert.match(salePage, /authoritative\?\.estado === "confirmada" \|\| authoritative\?\.stockAplicado === true/);
assert.doesNotMatch(salePage, /globalThis\.confirm|window\.confirm/);
assert.doesNotMatch(salesHistory, /globalThis\.confirm|window\.confirm/);
assert.match(salePage, /ResponsiveDialog/);
assert.match(salesHistory, /`\/ventas\/\$\{sale\.id\}\/editar`/);
// La cotización de origen ya fue aceptada: se abre su detalle de solo lectura, no el editor.
assert.match(salesHistory, /navigate\("\/cotizaciones", \{state: \{openQuoteId: sale\.cotizacionId\}\}\)/);
assert.doesNotMatch(salesHistory, /\/cotizaciones\/\$\{sale\.cotizacionId\}\/editar/);
assert.match(salePage, /navigate\("\/cotizaciones", \{state: \{openQuoteId: sale\.cotizacionId\}\}\)/);
assert.doesNotMatch(salePage, /\/cotizaciones\/\$\{sale\.cotizacionId\}\/editar/);
assert.doesNotMatch(salesHistory, />Editar<|>Ver</);
assert.doesNotMatch(salesHistory, /confirmarVenta|Confirmar venta/);
assert.match(salesHistory, /<th>Número<\/th><th>Cliente<\/th><th>Total<\/th><th>Origen<\/th><th>Estado<\/th><th>Stock<\/th><th>Fecha<\/th>/);
assert.match(salesHistory, /formatDate\(sale\.fechaVenta\)/);
assert.match(salesHistory, /getSaleStockStatusLabel/);
// Bloque 1: "Guardar cambios" pasa a "Guardar para después" (enlace). Sigue existiendo la acción de guardar
// con el mismo handler, y el resumen tiene UN solo botón principal ("Confirmar venta").
assert.match(saleSummary, /Guardar para después/);
assert.doesNotMatch(saleSummary, /Guardar cambios/);
assert.match(saleSummary, /variant="ghost" className="sale-summary__save" disabled=\{processing\} onClick=\{onSave\}/, "guardar para después usa el mismo onSave");
assert.match(saleSummary, /className="sale-summary__confirm"\s+disabled=\{processing \|\| hasInsufficientStock\}\s+onClick=\{onConfirm\}/, "confirmar conserva su bloqueo por stock");
assert.doesNotMatch(saleSummary, /po-button--primary/, "un solo botón principal, sin otra familia de botón");
assert.equal((saleSummary.match(/<Button\b/g) || []).length, 2, "dos acciones: Confirmar venta y el enlace Guardar para después");
assert.match(saleSummary, /simple = false/, "el detalle histórico conserva el resumen anterior");
assert.match(saleSummary, /discountTotal > 0 \? `-\$\{money\(discountTotal\)\}` : money\(0\)/);
assert.match(saleSummary, /Ellipsis/);
assert.match(saleSummary, /No puedes confirmar esta venta porque uno o más productos no tienen stock suficiente/);
assert.match(salePage, /sale-context-card/);
assert.match(salePage, /className="sale-context-toolbar"/);
// Líneas 112-113 siguen vigentes: ahora describen la cabecera del DETALLE histórico, que no cambia.
// Bloque 1: el editor (borrador) tiene cabecera corta y un solo h1 en pantalla (el de la barra superior).
assert.match(salePage, /\{historical \? \(\s*<section className="po-panel sale-context-card no-print">/, "la tarjeta de contexto es sólo del detalle histórico");
assert.match(salePage, /<header className="sale-head no-print">/);
assert.match(salePage, /<p className="sale-head__title">\{sale\?\.numero \|\| "Nueva venta"\}<\/p>/, "título del editor sin h1");
assert.equal((salePage.match(/<h1\b/g) || []).length, 1, "NewSalePage dibuja un solo h1 y es el del detalle histórico");
assert.ok(salePage.indexOf("<h1") < salePage.indexOf('<header className="sale-head no-print">'), "el h1 vive en la rama histórica, antes de la cabecera del editor");
assert.match(salePage, /<SaleClientSelector inline /, "el editor elige el cliente en línea");
assert.match(salePage, /<SaleClientSelector clients=\{clients\} disabled=\{readOnly \|\| referencesLocked\} onChange=\{changeClient\}/, "el detalle histórico conserva el selector anterior");
assert.match(salePage, /<SaleSummaryPanel simple=\{!historical\}/);
assert.doesNotMatch(salePage, /sale-header-guidance|Revisa la venta antes de confirmarla/);
assert.match(salePage, /Stock aplicado\. Disponibilidad actualizada al aceptar la cotización\./);
assert.doesNotMatch(salePage, /Stock: Stock aplicado/);
assert.match(saleClient, /sale-context-client__snapshot/);
// Bloque 1: selector en línea con la misma lista (clientes activos), filtro y onChange; el diálogo sigue para el histórico.
assert.match(saleClient, /function InlineSaleClientSelector/);
assert.match(saleClient, /client\.estado === "activo" && searchable\(`\$\{client\.nombreRazonSocial\} \$\{client\.rut\}`\)/, "sólo clientes activos, mismo filtro");
assert.match(saleClient, /onChange\(client\.clienteId\); finish\(\)/, "elegir cliente usa el mismo onChange");
assert.match(saleClient, /function DialogSaleClientSelector/);
assert.match(saleClient, /<ResponsiveDialog open=\{open\}/);
assert.doesNotMatch(saleClient, /Crear cliente/, "sin función nueva: crear cliente queda fuera");
// Ningún .jsx de Ventas escribe tildes ni símbolos como secuencias de escape: en texto JSX y en atributos
// entre comillas se mostrarían literales ("identificaci" + barra + "u00f3n"). Sólo se tolera el rango de
// diacríticos de un regex (normalize("NFD")). Las secuencias se arman con código para no escribirlas aquí.
{
  const BS = String.fromCharCode(92);
  const escapeSequence = new RegExp(`${BS}${BS}u[0-9a-fA-F]{4}`);
  const diacriticsRange = `${BS}u0300-${BS}u036f`;
  const salesDir = new URL("../src/features/sales/", import.meta.url);
  const jsxFiles = [...fs.readdirSync(salesDir).filter((name) => name.endsWith(".jsx")).map((name) => new URL(name, salesDir)), new URL("../src/pages/NewSalePage.jsx", import.meta.url)];
  const checkedNames = jsxFiles.map((file) => file.pathname.split("/").pop());
  for (const required of ["SaleClientSelector.jsx", "SaleSummaryPanel.jsx", "SaleItemsEditor.jsx", "NewSalePage.jsx"]) assert.ok(checkedNames.includes(required), `se revisa ${required}`);
  for (const file of jsxFiles) {
    const lines = fs.readFileSync(file, "utf8").split(diacriticsRange).join("").split(/\r?\n/);
    const bad = lines.findIndex((line) => escapeSequence.test(line));
    assert.equal(bad, -1, `${file.pathname.split("/").pop()}:${bad + 1} contiene una secuencia de escape unicode fuera de un regex; escribe el carácter real en UTF-8`);
  }
  assert.ok(escapeSequence.test(`x${BS}u00f3y`), "la aserción detecta una secuencia de escape");
  assert.equal(escapeSequence.test("identificación · línea"), false, "los caracteres reales no se marcan");
}
// Selección de cliente en línea: solo los primeros 6 resultados, aviso del total y mensaje claro sin clientes. Mismo filtro y mismo onChange.
assert.match(saleClient, /const INLINE_RESULTS_LIMIT = 6;/);
assert.match(saleClient, /visible\.slice\(0, INLINE_RESULTS_LIMIT\)\.map/);
assert.match(saleClient, /Mostrando \{INLINE_RESULTS_LIMIT\} de \{visible\.length\} · sigue escribiendo para afinar/);
assert.match(saleClient, /const searching = search\.trim\(\)\.length > 0;/, "sin escribir no se dibuja ninguna lista");
assert.match(saleClient, /\{searching && \(\s*<div className="sale-client__list">/, "la lista solo existe al escribir");
assert.match(saleClient, /Tienes \{activeCount === 1 \? "1 cliente activo" : `\$\{activeCount\} clientes activos`\} · escribe un nombre o RUT para buscar/);
assert.match(saleClient, /<p className="sr-only" aria-live="polite">/, "aviso para lectores de pantalla con la cantidad de resultados");
assert.match(saleClient, /<strong>Aún no tienes clientes<\/strong>/);
assert.match(saleClient, /<Link className="sale-client__link" to="\/clientes">Ir a Clientes<\/Link>/);
assert.match(saleClient, /const activeCount = clients\.filter\(\(client\) => client\.estado === "activo"\)\.length;/);
assert.match(saleClient, /const noClients = activeCount === 0;/);
assert.match(saleClient, /No hay clientes activos coincidentes\./, "con clientes pero sin coincidencias se conserva el texto de búsqueda");
assert.equal((saleClient.match(/visible\.map\(/g) || []).length, 1, "la ventana conserva su lista completa (una sola lista completa, en SaleClientDialog)");
// "Ver todos los clientes": enlace junto a "Tienes N…" que abre la misma ventana de clientes (SaleClientDialog).
assert.equal((saleClient.match(/<SaleClientDialog /g) || []).length, 2, "la ventana la usan el selector con diálogo y el selector en línea");
assert.match(saleClient, /<button type="button" className="sale-client__all" aria-haspopup="dialog" aria-expanded=\{dialogOpen\} onClick=\{\(\) => setDialogOpen\(true\)\}>Ver todos los clientes<\/button>/);
assert.match(saleClient, /<div className="sale-client__count">\s*<p className="sale-client__more">Tienes /, "el enlace va junto a la línea Tienes N clientes activos (solo con clientes y sin escribir)");
assert.match(saleClient, /onPick=\{\(clienteId\) => \{ onChange\(clienteId\); setDialogOpen\(false\); finish\(\); \}\}/, "elegir en la ventana usa el mismo onChange, la cierra y devuelve el foco");
assert.match(saleClient, /const close = \(\) => \{ onClose\(\); setSearch\(""\); \};/, "Escape y la X cierran sin cambiar nada");
assert.match(fs.readFileSync("src/features/sales/sales.css", "utf8"), /\.sale-client__all \{[^}]*min-height: 44px;/, "área táctil de 44 px");
assert.match(saleItems, /Stock insuficiente/);
assert.match(saleItems, /Disponible: \{stock\} · Solicitado: \{requested\}/);
// Bloque 2: filas compactas del editor. Mismos manejadores y misma fórmula de línea que antes; sólo cambia la presentación.
assert.match(saleItems, /<h2 id="sale-items-title" className="sale-step-title">¿Qué vendes\?<\/h2>/, "el editor titula la tarjeta sin número");
assert.match(saleItems, /<h2>Ítems vendidos<\/h2>/, "el detalle histórico conserva su título");
assert.match(saleItems, /onChange=\{\(event\) => update\(index, "cantidad", event\.target\.value\)\}/, "la cantidad escrita usa el mismo manejador");
assert.match(saleItems, /onChange=\{\(event\) => update\(index, "precioUnitario", event\.target\.value\)\}/, "el precio usa el mismo manejador");
assert.match(saleItems, /onChange=\{\(event\) => update\(index, "descuentoPct", event\.target\.value\)\}/, "el descuento usa el mismo manejador");
assert.match(saleItems, /if \(next !== null\) update\(index, "cantidad", next\)/, "− y + entregan la cantidad al mismo manejador");
assert.match(saleItems, /const total = Number\(item\.cantidad \|\| 0\) \* Number\(item\.precioUnitario \|\| 0\) \* \(1 - Number\(item\.descuentoPct \|\| 0\) \/ 100\);/, "la fórmula del total de línea no cambia");
assert.match(saleItems, /min="0\.000001" max=\{maxQuantity\} step="any"/, "misma validación de cantidad (decimales y máximo de la cotización)");
assert.match(saleItems, /aria-label=\{`Quitar \$\{item\.nombre\}`\}/, "quitar es un botón de ícono con aria-label");
assert.ok(saleItems.indexOf('role="alert"') < saleItems.indexOf('<details className="sale-line__more">'), "el aviso de stock va fuera del plegable");
{
  const salesCss = fs.readFileSync(new URL("../src/features/sales/sales.css", import.meta.url), "utf8");
  const rowsCss = salesCss.slice(salesCss.indexOf("/* Editor de ítems (borrador)"), salesCss.search(/^\.sale-item-type \{/m));
  const rules = (selector) => rowsCss.split(`${selector} {`)[1]?.split("}")[0] || "";
  assert.ok(rowsCss.length > 1500, "bloque de CSS de las filas presente");
  assert.doesNotMatch(rowsCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "filas: sin colores literales");
  assert.doesNotMatch(rowsCss, /--color-(brand-[6-9]00|dark-)/, "filas: sin colores de marca fijos ni dark-* como color");
  assert.doesNotMatch(rowsCss, /\.po-/, "filas: estilos con prefijo propio, sin tocar po-*");
  assert.doesNotMatch(rowsCss, /border-radius:\s*[0-9]|box-shadow:\s*[0-9]/, "filas: sin radios ni sombras literales");
  for (const selector of [".sale-qty__button", ".sale-price", ".sale-line__more > summary", ".sale-line .sale-line__remove"]) assert.match(rules(selector), /min-height: 2\.75rem/, `${selector}: área táctil de 44 px`);
  assert.match(rules(".sale-qty__button"), /min-width: 2\.75rem/);
  assert.match(rules(".sale-line__discount"), /width: 6rem/, "el campo de descuento mide unos 6 rem");
  assert.match(rules(".sale-line__discount"), /max-width: 100%/);
  assert.match(rowsCss, /@container \(max-width: 38rem\)/, "con poco ancho la fila baja a dos renglones");
}
assert.match(salePrint, /getSaleStatusLabel/);
assert.match(salePrint, /CubeIcon/);
assert.match(salePrint, /sale-document-preview__header/);
assert.match(salePrint, /sale-document-preview__info-grid/);
assert.match(salePage, /Editar condiciones/);
assert.match(salePage, /Motivo de cancelación/);
assert.match(salePage, /cancelReason\.trim\(\)\.length < 3/);
assert.match(salePage, /previewOpen \&\& <div className="sale-preview-body">/);
assert.match(salePage, /Ver vista previa/);
assert.doesNotMatch(salePage, />Ver cotización</);
console.log("OK ventas modelo: defensas backend y reglas declaradas");
const scanLine = (overrides = {}) => ({lineaId: "a", itemId: "p1", cantidad: 1, ...overrides});
const scanCreate = () => scanLine({lineaId: "nueva", itemId: "p2"});
const summed = resolveSaleScan([scanLine()], "p1", scanCreate);
assert.equal(summed.action, "incremented");
assert.deepEqual(summed.items.map((item) => [item.lineaId, item.cantidad]), [["a", 2]]);
const appended = resolveSaleScan([scanLine()], "p2", scanCreate);
assert.equal(appended.action, "added");
assert.deepEqual(appended.items.map((item) => item.lineaId), ["a", "nueva"]);
const withAdditional = [scanLine({lineaId: "ad", origenAdicionalId: "adic-1"})];
const untouched = resolveSaleScan(withAdditional, "p1", () => scanLine({lineaId: "nueva"}));
assert.equal(untouched.action, "added");
assert.deepEqual(untouched.items.map((item) => [item.lineaId, item.cantidad]), [["ad", 1], ["nueva", 1]]);
const mixed = resolveSaleScan([scanLine({lineaId: "ad", origenAdicionalId: "adic-1"}), scanLine()], "p1", scanCreate);
assert.deepEqual(mixed.items.map((item) => [item.lineaId, item.cantidad]), [["ad", 1], ["a", 2]]);
console.log("Smoke del modelo de Ventas completado.");

// Detalle histórico (venta confirmada o cancelada): tabla de ítems de una fila,
// historial desde campos existentes y tarjeta de contexto. Presentación pura.
{
  const [{default: React}, {renderToStaticMarkup}, {createServer}] = await Promise.all([
    import("react"),
    import("react-dom/server"),
    import("vite"),
  ]);
  const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
  try {
    const {default: SaleItemsEditor} = await vite.ssrLoadModule("/src/features/sales/SaleItemsEditor.jsx");
    const {buildSaleTimeline} = await vite.ssrLoadModule("/src/features/sales/saleTimeline.mjs");
    const soldItems = [
      {lineaId: "a", itemId: "p1", codigo: "COD-1", nombre: "Cable UTP", descripcion: "Cable UTP", tipoItem: "producto", unidad: "unidad", cantidad: 2, precioUnitario: 1000, descuentoPct: 0, totalLinea: 2000},
      {lineaId: "b", itemId: "s1", codigo: "", nombre: "Instalación", descripcion: "Punto de red certificado", tipoItem: "servicio", unidad: "hora", cantidad: 3, precioUnitario: 5000, descuentoPct: 10, totalLinea: 13500, origenAdicionalId: "adic-1"},
    ];
    const editorProps = {disabled: true, inventory: [{id: "p1", stock: 0}], items: soldItems, onChange() {}, onOpenCatalog() {}, onScanProduct() {}, readOnly: true, referencesLocked: true};
    const historical = renderToStaticMarkup(React.createElement(SaleItemsEditor, {...editorProps, historical: true}));
    assert.equal((historical.match(/<thead>/g) || []).length, 1, "encabezados únicos arriba");
    assert.equal((historical.match(/<tr>/g) || []).length, 3, "una fila por ítem más la de encabezados");
    for (const heading of ["Ítem", "Código", "Cantidad", "Precio unitario", "Desc. %", "Total"]) assert.match(historical, new RegExp(`<th scope="col">${heading}</th>`));
    assert.doesNotMatch(historical, /Disponible|Stock insuficiente|po-line__readonly/);
    assert.equal((historical.match(/>Cable UTP</g) || []).length, 1, "descripción igual al nombre no se repite");
    assert.match(historical, /Punto de red certificado/);
    assert.match(historical, /<strong title="Cable UTP">Cable UTP<\/strong>/, "nombre completo en title");
    assert.match(historical, /<strong title="Instalación">Instalación<\/strong>/);
    assert.match(historical, /sale-item-type--adicional/);
    assert.match(historical, /3 hora/);
    assert.match(historical, /10%/);
    assert.match(historical, /\$13\.500/);
    const draftMode = renderToStaticMarkup(React.createElement(SaleItemsEditor, {...editorProps, disabled: false, referencesLocked: false, readOnly: false, historical: false}));
    assert.match(draftMode, /Stock insuficiente/, "el borrador conserva su aviso de stock");
    assert.doesNotMatch(draftMode, /sale-sold/);
    // Bloque 2: filas compactas del editor (borrador).
    assert.match(draftMode, /¿Qué vendes\?/);
    assert.doesNotMatch(draftMode, /Ítems vendidos|<h1|po-line/, "el editor no repite el título histórico, no dibuja h1 y no usa po-line");
    assert.match(draftMode, /aria-label="Quitar Cable UTP"/);
    assert.match(draftMode, /aria-label="Quitar Instalación"/);
    assert.equal((draftMode.match(/sale-line__chip/g) || []).length, 1, "chip de descuento sólo en la línea con descuento distinto de 0");
    assert.match(draftMode, /<span class="sale-line__chip">-10 %<\/span>/);
    assert.match(draftMode, /Escanear producto/);
    assert.match(draftMode, /Agregar desde inventario/);
    assert.match(draftMode, /Stock insuficiente/);
    assert.match(draftMode.replace(/<details[\s\S]*?<\/details>/g, ""), /Stock insuficiente/, "el aviso de stock nunca queda dentro del plegable");
    assert.match(draftMode, /<details class="sale-line__more">[\s\S]*Punto de red certificado[\s\S]*<\/details>/, "la descripción larga va plegada");
    assert.doesNotMatch(draftMode.replace(/<details[\s\S]*?<\/details>/g, ""), /Punto de red certificado/);
    // Ajuste: el rótulo del plegable es siempre "Descuento"; la descripción sólo se muestra si difiere del nombre.
    assert.doesNotMatch(draftMode, /Descuento y descripción|Descripción</, "rótulo único del plegable");
    assert.equal((draftMode.match(/<summary><span>Descuento<\/span>/g) || []).length, 2, "cada fila editable tiene su plegable de Descuento, haya o no descripción que mostrar");
    assert.equal((draftMode.match(/sale-line__discount-input/g) || []).length, 2, "el descuento se puede escribir en todas las filas");
    assert.equal((draftMode.match(/sale-line-description/g) || []).length, 1, "la descripción igual al nombre no se repite; la distinta sí");
    assert.match(draftMode, /<small class="sale-line__meta">COD-1 · Producto<\/small>/, "código · tipo en la segunda línea (con stock insuficiente el dato va en el aviso)");
    assert.match(draftMode, /Sin código · Servicio · hora/, "la unidad distinta de 'unidad' se muestra");
    const withStock = renderToStaticMarkup(React.createElement(SaleItemsEditor, {...editorProps, disabled: false, referencesLocked: false, readOnly: false, historical: false, inventory: [{id: "p1", stock: 7}]}));
    assert.match(withStock, /COD-1 · Producto · Disponible 7/, "código · tipo · Disponible N");
    assert.doesNotMatch(withStock, /Stock insuficiente/);
    const single = [{...soldItems[0], cantidad: 1}];
    const atOne = renderToStaticMarkup(React.createElement(SaleItemsEditor, {...editorProps, disabled: false, referencesLocked: false, readOnly: false, historical: false, items: single, inventory: [{id: "p1", stock: 7}]}));
    assert.match(atOne, /aria-label="Disminuir cantidad de Cable UTP"[^>]*disabled=""/, "con cantidad 1 el − queda deshabilitado");
    assert.doesNotMatch(atOne, /aria-label="Aumentar cantidad de Cable UTP"[^>]*disabled=""/);
    const atMax = renderToStaticMarkup(React.createElement(SaleItemsEditor, {...editorProps, disabled: false, referencesLocked: true, readOnly: false, historical: false, items: [{...soldItems[0], cantidad: 2, cantidadCotizada: 2}], inventory: [{id: "p1", stock: 7}]}));
    assert.match(atMax, /aria-label="Aumentar cantidad de Cable UTP"[^>]*disabled=""/, "en el máximo de la cotización el + queda deshabilitado");
    assert.match(atMax, /max="2"/);
    assert.doesNotMatch(atMax, /Quitar Cable UTP|Escanear producto|Agregar desde inventario/, "con referencias bloqueadas no se quita ni se agrega");
    const readOnlyRows = renderToStaticMarkup(React.createElement(SaleItemsEditor, {...editorProps, disabled: true, referencesLocked: true, readOnly: true, historical: false}));
    assert.doesNotMatch(readOnlyRows, /<input|Quitar|sale-qty__button/, "borrador de sólo lectura: sin campos ni botones");
    assert.match(readOnlyRows, /Punto de red certificado/);
    assert.match(readOnlyRows, /Descuento: 10 %/, "sólo lectura: el descuento se ve como texto");
    console.log("OK editor de ítems: filas compactas, chip de descuento, stock siempre visible, − y + con máximo, sólo lectura");

    // Descripción de línea: sólo si es distinta del nombre (sin tildes, mayúsculas ni espacios sobrantes).
    assert.equal(lineDescriptionToShow({nombre: "Cable UTP", descripcion: "Cable UTP"}), "");
    assert.equal(lineDescriptionToShow({nombre: "Cable UTP", descripcion: "  cable   utp "}), "");
    assert.equal(lineDescriptionToShow({nombre: "Instalación", descripcion: "INSTALACION"}), "");
    assert.equal(lineDescriptionToShow({nombre: "Instalacion", descripcion: "instalación"}), "");
    assert.equal(lineDescriptionToShow({nombre: "Cable UTP", descripcion: ""}), "");
    assert.equal(lineDescriptionToShow({nombre: "Cable UTP"}), "");
    assert.equal(lineDescriptionToShow({nombre: "Instalación", descripcion: "  Punto de red   certificado "}), "Punto de red certificado");
    assert.equal(lineDescriptionToShow({nombre: "Cable UTP", descripcion: "Cable UTP cat 6"}), "Cable UTP cat 6", "una descripción que sólo contiene el nombre sí es distinta");
    assert.equal(lineDescriptionToShow(null), "");
    console.log("OK descripción de línea: sólo se muestra si difiere del nombre");

    // − y + : mismos decimales que el campo, nunca 0 o menos, y sin superar el máximo de la cotización.
    assert.equal(stepSaleQuantity(1, 1), 2);
    assert.equal(stepSaleQuantity("2", 1), 3);
    assert.equal(stepSaleQuantity(2.5, -1), 1.5);
    assert.equal(stepSaleQuantity(2.3, 1), 3.3, "sin deriva de punto flotante");
    assert.equal(stepSaleQuantity(1, -1), null, "1 − 1 sería 0");
    assert.equal(stepSaleQuantity(0.5, -1), null, "0,5 − 1 sería negativo");
    assert.equal(stepSaleQuantity(0.000001, -1), null);
    assert.equal(stepSaleQuantity("", 1), 1, "campo vacío: + parte de 0");
    assert.equal(stepSaleQuantity("", -1), null);
    assert.equal(stepSaleQuantity(2, 1, {max: 3}), 3);
    assert.equal(stepSaleQuantity(2.5, 1, {max: 3}), 3, "no supera el máximo");
    assert.equal(stepSaleQuantity(3, 1, {max: 3}), null, "en el máximo no avanza");
    assert.equal(stepSaleQuantity(5, 1, {max: 3}), null);
    assert.equal(stepSaleQuantity(4, -1, {max: 3}), 3, "bajar siempre se permite mientras quede más de 0");
    assert.equal(stepSaleQuantity(1, 1, {max: null}), 2, "sin máximo (null) no hay tope");
    assert.equal(stepSaleQuantity(1, 1, {max: undefined}), 2);
    console.log("OK stepper de cantidad: decimales, mínimo y máximo");
    console.log("OK detalle de venta: tabla compacta sólo en modo histórico, borrador intacto");

    const stamp = (seconds) => ({seconds, nanoseconds: 0});
    const titles = (events) => events.map((event) => event.key);
    const quoteSale = {
      cotizacionId: "c1", cotizacionNumero: "COT-1", aceptadaEn: stamp(1700000000), createdAt: stamp(1700000000), confirmedAt: stamp(1700000000),
      stockAplicadoAt: stamp(1700000000), estadoStock: "completo", efectosInventario: [{}, {}], origenAceptacion: "aceptacion_manual",
      creadoPorUid: "u1", confirmadoPorUid: "u1",
    };
    const quoteEvents = buildSaleTimeline(quoteSale, "u1");
    assert.deepEqual(titles(quoteEvents), ["aceptada", "stock"]);
    assert.equal(quoteEvents[0].title, "Cotización COT-1 aceptada");
    assert.equal(quoteEvents[0].actor, "Tú");
    assert.equal(quoteEvents[0].detail, "Registrada por el equipo", "una sola idea, sin repetir la venta confirmada");
    assert.equal(buildSaleTimeline({...quoteSale, origenAceptacion: "portal_publico"}, "")[0].detail, "Desde la propuesta pública");
    assert.equal(buildSaleTimeline({...quoteSale, origenAceptacion: "registro_compatibilidad"}, "")[0].detail, "");
    assert.equal(quoteEvents[1].detail, "2 productos");
    assert.equal(buildSaleTimeline(quoteSale, "otro")[0].actor, "", "otra persona: sin nombre");
    assert.equal(buildSaleTimeline(quoteSale, "")[0].actor, "");
    assert.ok(quoteEvents[0].date instanceof Date);

    // Cancelación recién hecha: la Function aún no devuelve el sello resuelto.
    const {withLocalCancellationStamp} = await vite.ssrLoadModule("/src/features/sales/saleTimeline.mjs");
    const cancelledMoment = new Date("2026-05-01T15:30:00Z");
    const freshCancel = {estado: "cancelada", motivoCancelacion: "Error de digitación", canceladoPorUid: "u1", cancelledAt: null, stockRevertido: true, stockRevertidoEn: null, efectosInventarioReversa: [{}]};
    assert.equal(buildSaleTimeline(freshCancel, "u1").find((e) => e.key === "cancelada").date, null, "sin sello el evento no tiene fecha");
    const stamped = buildSaleTimeline(withLocalCancellationStamp(freshCancel, cancelledMoment), "u1");
    assert.equal(stamped.find((e) => e.key === "cancelada").date.getTime(), cancelledMoment.getTime());
    assert.equal(stamped.find((e) => e.key === "revertido").date.getTime(), cancelledMoment.getTime());
    const serverStamp = stamp(1700000500);
    assert.equal(withLocalCancellationStamp({...freshCancel, cancelledAt: serverStamp, stockRevertidoEn: serverStamp}, cancelledMoment).cancelledAt, serverStamp, "el sello del servidor manda");
    assert.equal(withLocalCancellationStamp({...freshCancel, stockRevertido: false}, cancelledMoment).stockRevertidoEn, null, "sin reversa no se inventa 'Stock revertido'");
    const notCancelled = {estado: "confirmada"};
    assert.equal(withLocalCancellationStamp(notCancelled, cancelledMoment), notCancelled, "venta no cancelada intacta");
    console.log("OK historial de venta: cancelación reciente con fecha local mientras falta el sello");

    const canceled = buildSaleTimeline({
      ...quoteSale, cancelledAt: stamp(1700100000), motivoCancelacion: "Error de carga", canceladoPorUid: "u2",
      stockRevertidoEn: stamp(1700100000), efectosInventarioReversa: [{}],
    }, "u1");
    assert.deepEqual(titles(canceled), ["aceptada", "stock", "cancelada", "revertido"]);
    assert.equal(canceled[2].detail, "Motivo: Error de carga");
    assert.equal(canceled[2].actor, "", "el UID de otra persona no se muestra");
    assert.equal(canceled[2].tone, "danger");
    assert.equal(canceled[3].detail, "1 producto");

    // Sin campos no hay eventos: nada se inventa (legacy, sin movimiento de stock, sin cancelación).
    assert.deepEqual(buildSaleTimeline({}, "u1"), []);
    assert.deepEqual(buildSaleTimeline(null, "u1"), []);
    const direct = buildSaleTimeline({createdAt: stamp(1700000000), confirmedAt: stamp(1700000500), confirmadoPorUid: "u1", stockAplicadoAt: null, estadoStock: "no_aplica"}, "u1");
    assert.deepEqual(titles(direct), ["creada", "confirmada"]);
    assert.equal(direct[0].actor, "", "creadoPorUid ausente: sin actor");
    // Sello recién escrito sin resolver: el evento aparece, sin fecha.
    const unresolved = buildSaleTimeline({estado: "cancelada", cancelledAt: {}, motivoCancelacion: "Duplicada"}, "u1");
    assert.deepEqual(titles(unresolved), ["cancelada"]);
    assert.equal(unresolved[0].date, null);
    // Serialización de callable ({_seconds}) también se entiende.
    assert.ok(buildSaleTimeline({createdAt: {_seconds: 1700000000, _nanoseconds: 0}}, "")[0].date instanceof Date);
    const partial = buildSaleTimeline({stockAplicadoAt: stamp(1700000000), estadoStock: "parcial_pendiente", efectosInventario: []}, "");
    assert.equal(partial[0].title, "Stock aplicado parcialmente");
    assert.equal(partial[0].detail, "");
    console.log("OK detalle de venta: historial sólo con campos existentes, 'Tú' sólo para el usuario actual");
  } finally {
    await vite.close();
  }
}

const detailPage = fs.readFileSync(new URL("../src/pages/NewSalePage.jsx", import.meta.url), "utf8");
const detailStyles = fs.readFileSync(new URL("../src/features/sales/sales.css", import.meta.url), "utf8");
assert.match(detailPage, /const historical = Boolean\(sale && sale\.estado !== "borrador"\)/);
assert.match(detailPage, /\{!historical && <section className="po-panel sale-data-panel">/, "Documento y fechas sólo en edición");
assert.match(detailPage, /Cotización de origen/);
assert.match(detailPage, /Ver proyecto/);
assert.match(detailPage, /variant="ghost-danger"/, "Cancelar venta como acción secundaria destructiva");
assert.match(detailPage, /canCancelConfirmedQuote && <Button/);
assert.doesNotMatch(detailPage, /estadoCobro|estadoPago|Cobrad|Pagad/i, "sin estado de cobro: el dato no existe");
assert.doesNotMatch(detailPage, /<SalePrintView[^>]*historical/);
assert.match(detailStyles, /\.sale-sold__table td::before\s*\{[\s\S]*attr\(data-label\)/);
assert.match(detailStyles, /@container \(max-width: 29\.99rem\)[\s\S]*\.sale-sold__table tr/, "tarjetas con poco ancho");
assert.match(detailPage, /\{project && \(\s*<div>\s*<dt>Proyecto<\/dt>/, "Proyecto sólo si hay dato");
assert.match(detailPage, /\{hasDocument && \(\s*<div>\s*<dt>Documento<\/dt>/, "Documento sólo si hay dato");
assert.doesNotMatch(detailPage.slice(detailPage.indexOf("function SaleInfoCard"), detailPage.indexOf("export default function NewSalePage")), /Sin proyecto|Sin documento/);
assert.match(detailPage, /\{stockMessage && \(\s*<div className="sale-info__wide">/, "Estado del stock sólo con mensaje");
assert.match(detailPage, /historical && !\(sale\.stockAplicado && !sale\.alertasStock\?\.length\)/, "stock aplicado sin alertas no repite el historial");
assert.match(detailPage, /role=\{alert \? "alert" : undefined\}/, "las alertas de stock conservan role=alert");
const soldCss = detailStyles.slice(detailStyles.indexOf(".sale-sold {"), detailStyles.indexOf(".sale-info {"));
assert.match(soldCss, /table-layout: fixed/);
assert.doesNotMatch(soldCss, /^\s+min-width:\s*[1-9.]/m, "ningún ancho mínimo (distinto de 0) fuerza el scroll");
assert.doesNotMatch(soldCss, /overflow-x:\s*(auto|scroll)/, "sin scroll horizontal en la tabla");
for (const column of [2, 3, 4, 5, 6]) assert.ok(soldCss.includes(`th:nth-child(${column}) { width:`), `columna ${column} de ancho fijo`);
assert.match(soldCss, /\.sale-sold__item \.sale-line-title > strong\s*\{[^}]*text-overflow: ellipsis[^}]*white-space: nowrap/, "nombre truncado a una línea");
assert.match(soldCss, /\.sale-sold__description\s*\{[^}]*text-overflow: ellipsis[^}]*white-space: nowrap/, "descripción truncada a una línea");
const newDetailCss = detailStyles.slice(detailStyles.indexOf("/* Detalle histórico de la venta"), detailStyles.indexOf("/* Modo oscuro (etapa 5"));
assert.ok(newDetailCss.length > 500);
assert.doesNotMatch(newDetailCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "sin colores literales");
assert.doesNotMatch(newDetailCss, /--color-(brand-[6-9]00|dark-)/, "sin colores de marca fijos ni dark-* como color");
console.log("OK detalle de venta: estructura, sin estado de cobro y CSS sólo con tokens");
