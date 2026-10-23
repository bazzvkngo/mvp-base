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
assert.match(saleSummary, /Guardar cambios/);
assert.match(saleSummary, /discountTotal > 0 \? `-\$\{money\(discountTotal\)\}` : money\(0\)/);
assert.match(saleSummary, /Ellipsis/);
assert.match(saleSummary, /No puedes confirmar esta venta porque uno o más productos no tienen stock suficiente/);
assert.match(salePage, /sale-context-card/);
assert.match(salePage, /className="sale-context-toolbar"/);
assert.match(salePage, /Stock aplicado\. Disponibilidad actualizada al aceptar la cotización\./);
assert.doesNotMatch(salePage, /Stock: Stock aplicado/);
assert.match(saleClient, /sale-context-client__snapshot/);
assert.match(saleItems, /Stock insuficiente/);
assert.match(saleItems, /Disponible: \{stock\} · Solicitado: \{requested\}/);
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
