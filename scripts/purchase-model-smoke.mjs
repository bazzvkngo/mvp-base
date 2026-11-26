import assert from "node:assert/strict";
import fs from "node:fs";
import {assertSkipLinkHiddenInPrint} from "./lib/printCss.mjs";
import {createRequire} from "node:module";
import {
  adaptStoredPurchase,
  buildPurchaseMutationPayload,
  calculatePurchaseLine,
  calculatePurchaseTotals,
  canManagePurchases,
  getPurchaseDocumentTypeLabel,
  getPurchaseStockSemantics,
  getPurchaseStatusLabel,
  matchesPurchaseSearch,
  PURCHASE_MODEL_VERSION,
  PURCHASE_STATUSES,
  resolvePurchaseVatTreatment,
  shouldReconcilePurchaseConfirmation,
} from "../src/domain/purchaseModel.mjs";
import {userErrorMessage} from "../src/domain/userFacingError.mjs";

const require = createRequire(import.meta.url);
const {calculatePurchaseTotals: calculateBackendPurchaseTotals, normalizePurchaseInput, normalizeSupplierDocumentNumber, documentCoherenceState, documentTotalsTolerance, DOCUMENT_TOTALS_TOLERANCE} = require("../functions/purchasePersistence.js");
const {resolvePurchaseVatTreatment: resolveBackendPurchaseVatTreatment} = require("../functions/inventoryAcquisition.js");
class TestHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const line = (overrides = {}) => ({
  lineaId: "linea-1",
  itemId: "item-1",
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  ...overrides,
});

assert.deepEqual(calculatePurchaseLine(line()), {
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  subtotalLinea: 2000,
  descuentoLinea: 200,
  totalLinea: 1800,
});
assert.deepEqual(calculatePurchaseTotals([
  line(),
  line({lineaId: "linea-2", itemId: "item-2", cantidad: 1, costoUnitario: 500, descuentoPct: 0}),
]), {subtotal: 2500, descuentoTotal: 200, neto: 2300, iva: 437, total: 2737});
assert.throws(() => calculatePurchaseLine(line({cantidad: 0})), /rango/);
assert.throws(() => calculatePurchaseLine(line({cantidad: NaN})), /número/);
assert.throws(() => calculatePurchaseLine(line({cantidad: Infinity})), /número/);
assert.throws(() => calculatePurchaseLine(line({costoUnitario: Number.MAX_VALUE})), /máximo permitido/);
assert.throws(() => calculatePurchaseLine(line({cantidad: Number.MAX_VALUE, costoUnitario: 2})), /máximo permitido/);
assert.throws(() => calculatePurchaseTotals([line({cantidad: 1, costoUnitario: Number.MAX_SAFE_INTEGER})]), /máximo permitido/);
console.log("OK compras modelo: líneas, descuentos, IVA, totales y overflow");

// SPEC 023 §5.1-§5.2: tratamiento de IVA por línea y totales con boleta/exento.
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "factura"}), "credito_fiscal");
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "boleta"}), "boleta");
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "boleta", impuestoId: "IVA_EXENTO"}), "boleta");
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "factura", impuestoId: "IVA_EXENTO"}), "exento");
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "factura", impuestoId: "SIN_IMPUESTO"}), "exento");
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "factura", impuestoId: "IVA_GENERAL"}), "credito_fiscal");
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "otro"}), "credito_fiscal");
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "sin_documento"}), "credito_fiscal");
assert.equal(resolvePurchaseVatTreatment(), "credito_fiscal");
for (const tipoDocumento of ["factura", "boleta", "otro", "sin_documento", undefined]) {
  for (const impuestoId of ["IVA_GENERAL", "IVA_EXENTO", "SIN_IMPUESTO", "iva_exento", undefined]) {
    assert.equal(
      resolveBackendPurchaseVatTreatment({tipoDocumento, impuestoId}),
      resolvePurchaseVatTreatment({tipoDocumento, impuestoId}),
      `espejo de tratamiento: ${tipoDocumento}/${impuestoId}`
    );
  }
}

const cable = line({lineaId: "cable", itemId: "cable", cantidad: 10, costoUnitario: 10000, descuentoPct: 0, impuestoId: "IVA_GENERAL"});
const exempt = line({lineaId: "exento", itemId: "exento", cantidad: 5, costoUnitario: 4000, descuentoPct: 0, impuestoId: "IVA_EXENTO"});
const pvc = line({lineaId: "pvc", itemId: "pvc", cantidad: 2, costoUnitario: 4165, descuentoPct: 0});
const vatCases = [
  ["factura (Ejemplo A)", [cable], "factura", {subtotal: 100000, descuentoTotal: 0, neto: 100000, montoExento: 0, iva: 19000, total: 119000}],
  ["boleta (Ejemplo B)", [pvc], "boleta", {subtotal: 8330, descuentoTotal: 0, neto: 8330, montoExento: 0, iva: 0, total: 8330}],
  ["exento en factura (Ejemplo C)", [exempt], "factura", {subtotal: 20000, descuentoTotal: 0, neto: 20000, montoExento: 20000, iva: 0, total: 20000}],
  ["factura mixta (Ejemplo D)", [cable, exempt], "factura", {subtotal: 120000, descuentoTotal: 0, neto: 120000, montoExento: 20000, iva: 19000, total: 139000}],
  ["boleta con línea exenta", [pvc, exempt], "boleta", {subtotal: 28330, descuentoTotal: 0, neto: 28330, montoExento: 0, iva: 0, total: 28330}],
  ["otro documento", [cable], "otro", {subtotal: 100000, descuentoTotal: 0, neto: 100000, montoExento: 0, iva: 19000, total: 119000}],
  ["sin documento", [cable], "sin_documento", {subtotal: 100000, descuentoTotal: 0, neto: 100000, montoExento: 0, iva: 19000, total: 119000}],
  ["factura con descuento", [line({impuestoId: "IVA_GENERAL"})], "factura", {subtotal: 2000, descuentoTotal: 200, neto: 1800, montoExento: 0, iva: 342, total: 2142}],
  ["boleta con descuento", [line()], "boleta", {subtotal: 2000, descuentoTotal: 200, neto: 1800, montoExento: 0, iva: 0, total: 1800}],
  ["exento con descuento", [line({impuestoId: "IVA_EXENTO"})], "factura", {subtotal: 2000, descuentoTotal: 200, neto: 1800, montoExento: 1800, iva: 0, total: 1800}],
];
const backendLines = (items) => items.map((item) => ({...item, ...calculatePurchaseLine(item)}));
for (const [label, items, tipoDocumento, expected] of vatCases) {
  assert.deepEqual(calculatePurchaseTotals(items, {tasaIva: 0.19, tipoDocumento}), expected, `frontend: ${label}`);
  assert.deepEqual(calculateBackendPurchaseTotals(backendLines(items), TestHttpsError, 0.19, {tipoDocumento}), expected, `backend: ${label}`);
}
// Sin tipoDocumento ambos lados conservan el cálculo legacy: así se leen las
// compras guardadas antes de SPEC 023 (sin modeloIvaCompraVersion).
const legacyBoleta = {subtotal: 8330, descuentoTotal: 0, neto: 8330, iva: 1583, total: 9913};
assert.deepEqual(calculatePurchaseTotals([pvc], {tasaIva: 0.19}), legacyBoleta);
assert.deepEqual(calculateBackendPurchaseTotals(backendLines([pvc]), TestHttpsError, 0.19), legacyBoleta);
assert.deepEqual(calculatePurchaseTotals([exempt], {tasaIva: 0.19}), {subtotal: 20000, descuentoTotal: 0, neto: 20000, iva: 3800, total: 23800});
const halfMaxLine = (lineaId) => line({lineaId, itemId: lineaId, cantidad: 1, costoUnitario: Math.ceil(Number.MAX_SAFE_INTEGER / 2), descuentoPct: 0});
assert.throws(() => calculatePurchaseTotals([halfMaxLine("a"), halfMaxLine("b")], {tipoDocumento: "boleta"}), /máximo permitido/);
assert.throws(() => calculateBackendPurchaseTotals(backendLines([halfMaxLine("a"), halfMaxLine("b")]), TestHttpsError, 0.19, {tipoDocumento: "boleta"}), /máximo permitido/);
console.log("OK compras modelo SPEC 023: factura, boleta, exento, mixta, descuentos, legacy y espejo frontend/backend");

// SPEC 023 etapa 3: adaptStoredPurchase activa §5.2 solo con
// modeloIvaCompraVersion 1; una compra anterior se lee con su cálculo.
const storedVatLine = (overrides) => ({lineaId: "l1", itemId: "p1", tipoItem: "producto", nombre: "Tubo PVC", unidad: "unidad", cantidad: 2, costoUnitario: 4165, descuentoPct: 0, ...overrides});
const legacyStoredBoleta = adaptStoredPurchase({tipoDocumento: "boleta", tasaIva: 0.19, items: [storedVatLine()]});
assert.deepEqual([legacyStoredBoleta.iva, legacyStoredBoleta.total], [1583, 9913], "una boleta anterior conserva el IVA con el que se guardó");
const newStoredBoleta = adaptStoredPurchase({modeloIvaCompraVersion: 1, tipoDocumento: "boleta", tasaIva: 0.19, items: [storedVatLine()]});
assert.deepEqual([newStoredBoleta.neto, newStoredBoleta.montoExento, newStoredBoleta.iva, newStoredBoleta.total], [8330, 0, 0, 8330]);
const newStoredMixed = adaptStoredPurchase({
  modeloIvaCompraVersion: 1,
  tipoDocumento: "factura",
  tasaIva: 0.19,
  items: [
    storedVatLine({lineaId: "cable", cantidad: 10, costoUnitario: 10000, impuestoId: "IVA_GENERAL"}),
    storedVatLine({lineaId: "exento", cantidad: 5, costoUnitario: 4000, impuestoId: "iva_exento"}),
  ],
});
assert.deepEqual([newStoredMixed.neto, newStoredMixed.montoExento, newStoredMixed.iva, newStoredMixed.total], [120000, 20000, 19000, 139000], "Ejemplo D");
assert.equal(newStoredMixed.items[1].impuestoId, "IVA_EXENTO", "la línea conserva la copia de la marca");
const legacyStoredMixed = adaptStoredPurchase({tipoDocumento: "factura", tasaIva: 0.19, items: newStoredMixed.items});
assert.deepEqual([legacyStoredMixed.iva, legacyStoredMixed.total], [22800, 142800], "sin marca de versión la línea exenta no cambia el cálculo");
assert.equal(adaptStoredPurchase({modeloIvaCompraVersion: 1, items: []}).montoExento, 0);
console.log("OK compras modelo SPEC 023: adaptStoredPurchase solo recalcula con modeloIvaCompraVersion 1");

const payload = buildPurchaseMutationPayload({
  proveedorId: "provider-1",
  fechaCompra: "2026-08-07",
  fechaDocumento: "2026-08-06",
  tipoDocumento: "factura",
  numeroDocumentoProveedor: "F-100",
  condicionesPago: "30 días",
  observaciones: "Recepción parcial",
  items: [{
    ...line(),
    nombre: "Nombre manipulado",
    codigo: "FAKE",
    tipoItem: "servicio",
    inventarioSnapshot: {nombre: "Snapshot manipulado"},
    totalLinea: 1,
  }],
  numero: "COM-FAKE",
  estado: "confirmada",
  proveedorSnapshot: {razonSocial: "Proveedor manipulado"},
  stockAplicado: true,
  total: 1,
});
assert.deepEqual(payload.items[0], {
  lineaId: "linea-1", itemId: "item-1", cantidad: 2,
  costoUnitario: 1000, descuentoPct: 10,
});
for (const forbidden of ["numero", "estado", "proveedorSnapshot", "stockAplicado", "total"]) {
  assert.equal(Object.hasOwn(payload, forbidden), false, `payload no debe aceptar ${forbidden}`);
}
console.log("OK compras modelo: payload editable mínimo sin snapshots ni campos autoritativos");

const purchaseWithLines = (count) => ({
  proveedorId: "provider-1",
  fechaCompra: "2026-08-07",
  items: Array.from({length: count}, (_, index) => line({
    lineaId: `linea-${index + 1}`,
    itemId: `item-${index + 1}`,
  })),
});
assert.equal(buildPurchaseMutationPayload(purchaseWithLines(200)).items.length, 200);
assert.throws(() => buildPurchaseMutationPayload(purchaseWithLines(201)), /La compra admite hasta 200 ítems\./);
assert.equal(normalizePurchaseInput(purchaseWithLines(200), TestHttpsError).items.length, 200);
assert.throws(() => normalizePurchaseInput(purchaseWithLines(201), TestHttpsError), /La compra admite hasta 200 ítems\./);
console.log("OK compras modelo: máximo consistente de 200 líneas en frontend y backend");

const stored = adaptStoredPurchase({
  compraId: "purchase-1",
  numero: "COM-2026-0001",
  estado: "confirmada",
  proveedorId: "provider-1",
  proveedorSnapshot: {proveedorId: "provider-1", razonSocial: "Proveedor Uno", rut: "76.000.000-0"},
  ordenCompraId: "order-1",
  ordenCompraNumero: "OC-2026-0001",
  tipoDocumento: "factura",
  numeroDocumentoProveedor: "F-100",
  items: [{...line(), nombre: "Producto", tipoItem: "producto", unidad: "unidad"}],
});
assert.equal(stored.id, "purchase-1");
assert.equal(stored.total, 2142);
assert.equal(stored.proveedorSnapshot.razonSocial, "Proveedor Uno");
assert.equal(matchesPurchaseSearch(stored, "OC-2026-0001"), true);
assert.equal(matchesPurchaseSearch(stored, "76.000.000-0"), true);
assert.equal(matchesPurchaseSearch(stored, "sin coincidencia"), false);
assert.equal(canManagePurchases("OWNER"), true);
assert.equal(canManagePurchases("ADMIN"), true);
assert.equal(canManagePurchases("COMPRAS"), true);
assert.equal(canManagePurchases("VENTAS"), false);
assert.equal(canManagePurchases("MEMBER"), false);
assert.equal(PURCHASE_MODEL_VERSION, 3);
assert.deepEqual(PURCHASE_STATUSES, ["borrador", "confirmada", "cancelada", "revertida"]);
assert.equal(getPurchaseStatusLabel("borrador"), "Preparada");
assert.equal(getPurchaseStatusLabel("revertida"), "Revertida");
assert.equal(getPurchaseDocumentTypeLabel("sin_documento"), "Sin documento");
assert.equal(shouldReconcilePurchaseConfirmation({code: "unavailable"}), true);
assert.equal(shouldReconcilePurchaseConfirmation({code: "permission-denied"}), false);
const directV3Semantics = getPurchaseStockSemantics({modeloCompraVersion: 3, stockGestionadoPor: "compra_directa"});
assert.equal(directV3Semantics.kind, "direct_v3");
assert.match(directV3Semantics.confirmationMessage, /incrementará el stock de los productos/);
assert.match(getPurchaseStockSemantics({modeloCompraVersion: 3, stockGestionadoPor: "compra_directa", productosActualizados: 1}).confirmationResultMessage, /stock de productos actualizado/);
assert.doesNotMatch(getPurchaseStockSemantics({modeloCompraVersion: 3, stockGestionadoPor: "compra_directa", stockAplicado: false, productosActualizados: 0}).confirmationResultMessage, /stock de productos actualizado/);
const receptionV3Semantics = getPurchaseStockSemantics({modeloCompraVersion: 3, stockGestionadoPor: "recepcion"});
assert.equal(receptionV3Semantics.kind, "reception");
assert.match(receptionV3Semantics.confirmationMessage, /ya fue gestionado mediante la recepción/);
const economicV2Semantics = getPurchaseStockSemantics({modeloCompraVersion: 2, stockGestionadoPor: "recepcion"});
assert.equal(economicV2Semantics.kind, "legacy_v2");
assert.match(economicV2Semantics.confirmationResultMessage, /documento económico sin modificar stock/);
assert.doesNotMatch(economicV2Semantics.confirmationResultMessage, /por la recepción/);
const linkedV2Semantics = getPurchaseStockSemantics({modeloCompraVersion: 2, stockGestionadoPor: "recepcion", recepcionId: "reception-historical"});
assert.equal(linkedV2Semantics.kind, "reception");
assert.match(linkedV2Semantics.confirmationResultMessage, /gestionado por la recepción/);
const legacyV1Semantics = getPurchaseStockSemantics({modeloCompraVersion: 1, productosActualizados: 1});
assert.equal(legacyV1Semantics.kind, "legacy");
assert.match(legacyV1Semantics.confirmationResultMessage, /comportamiento de stock original/);
console.log("OK compras modelo: adaptación, búsqueda y roles");

const backend = fs.readFileSync(new URL("../functions/purchasePersistence.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const purchasesPage = fs.readFileSync(new URL("../src/pages/PurchasesPage.jsx", import.meta.url), "utf8");
const purchaseDetail = fs.readFileSync(new URL("../src/pages/NewPurchasePage.jsx", import.meta.url), "utf8");
// Compra confirmada, revertida o cancelada: solo lectura en PurchaseDetailView; el borrador y la compra nueva conservan el formulario.
const purchaseReadOnlyView = fs.readFileSync(new URL("../src/features/purchases/PurchaseDetailView.jsx", import.meta.url), "utf8");
const purchasePrint = fs.readFileSync(new URL("../src/features/purchases/PurchasePrintView.jsx", import.meta.url), "utf8");
const purchaseSummary = fs.readFileSync(new URL("../src/features/purchases/PurchaseSummaryPanel.jsx", import.meta.url), "utf8");
assert.match(backend, /purchaseConfirmRequests/);
assert.match(backend, /movimientosInventario/);
assert.match(backend, /stockAplicado/);
assert.match(backend, /purchaseReversalRequests/);
assert.match(backend, /salida_reversion_compra/);
assert.doesNotMatch(backend, /cost[oe]Base\s*:/i);
// SPEC 023 §5.3 y §8.1: lo que entra y sale de Q/V es el costo de inventario.
assert.match(backend, /modeloIvaCompraVersion: PURCHASE_VAT_MODEL_VERSION/);
assert.match(backend, /tratamientoIvaCompra: resolvePurchaseVatTreatment\(\{tipoDocumento: purchase\.tipoDocumento, impuestoId: line\.impuestoId\}\)/);
assert.match(backend, /costoUnitarioAplicado: amounts\.costoInventarioUnitario, costoTotal: amounts\.costoInventarioTotal/);
assert.match(backend, /acquisition\.costoInventarioTotal \?\? acquisition\.costoPagadoTotal/);
assert.match(purchaseDetail, /tipoDocumento: draft\.tipoDocumento/);
assert.match(purchaseDetail, /if \(readOnly && purchase\)/);
assert.match(purchasesPage, /Revertir compra/);
assert.match(purchasesPage, /Motivo de reversión \*/);
assert.match(purchasesPage, /getPurchaseStockSemantics/);
assert.match(purchaseDetail, /getPurchaseStockSemantics/);
assert.match(purchaseDetail, /purchase\.estado !== "borrador"\) return <PurchaseDetailView/);
assert.match(purchaseReadOnlyView, /stockSemantics\.kind === "reception"/);
assert.doesNotMatch(purchaseDetail, /purchase\.stockGestionadoPor === "recepcion"/);
assert.doesNotMatch(purchasesPage, /El stock se gestiona en Recepciones|El stock no cambiará en este paso|Confirmar compra histórica/);
assert.doesNotMatch(purchasesPage, />Ver<|onOpen=\{open\}/);
for (const collectionName of [
  "compras", "movimientosInventario", "purchaseCounters",
  "purchaseCreateRequests", "purchaseConfirmRequests",
  "purchaseOrderConversionRequests", "purchaseReversalRequests",
]) assert.match(rules, new RegExp(`match /${collectionName}/`));
console.log("OK compras modelo: defensas backend y reglas declaradas");

// Recorta `source` desde un marcador hasta otro. Falla si algún marcador no existe: con indexOf === -1, slice recortaría
// un texto vacío o engañoso y las aserciones que dependen de él pasarían en vacío (por ejemplo si cambia un comentario).
const sliceBetween = (source, startMarker, endMarker, label) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${label}: no se encuentra el marcador inicial ${JSON.stringify(startMarker)}`);
  if (endMarker === undefined) return source.slice(start);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `${label}: no se encuentra el marcador final ${JSON.stringify(endMarker)} después del inicial`);
  return source.slice(start, end);
};
assert.match(purchaseDetail, /SupplyTrace/);
assert.doesNotMatch(purchaseDetail, /Originada desde recepción|Originada desde orden de compra/);
assert.match(purchaseReadOnlyView, /Trazabilidad de entradas/);
assert.doesNotMatch(purchaseReadOnlyView, /Snapshot hist[oó]rico conservado|SupplyTrace|disabled=|<input|<textarea/);
// Aviso de totales en el detalle: solo con coherenciaEstado "revisar" y documento asociado; fuera de la vista imprimible; CSS solo con tokens.
assert.match(purchaseReadOnlyView, /import Notice from "\.\.\/\.\.\/components\/ui\/Notice"/);
assert.match(purchaseReadOnlyView, /\{hasDocument && source\.coherenciaEstado === "revisar" && <section className="purchase-detail__totals-notice">\s*<Notice variant="warning" role=\{null\}>Los totales del documento no coinciden con las líneas\.<\/Notice>\s*<\/section>\}/);
assert.equal((purchaseReadOnlyView.match(/coherenciaEstado/g) || []).length, 1);
assert.ok(purchaseReadOnlyView.indexOf("purchase-detail__totals-notice") >= 0 && purchaseReadOnlyView.indexOf('className="print-only"') >= 0, "se localizan el aviso y la parte imprimible");
assert.ok(purchaseReadOnlyView.indexOf("purchase-detail__totals-notice") < purchaseReadOnlyView.indexOf('className="print-only"'), "el aviso queda en la parte de pantalla, no en la impresión");
const purchasesCss = fs.readFileSync(new URL("../src/features/purchases/purchases.css", import.meta.url), "utf8");
const noticeRule = purchasesCss.match(/\.purchase-detail__totals-notice \{([^}]*)\}/)?.[1] || "";
assert.match(noticeRule, /padding: 0 var\(--space-4\) var\(--space-4\)/);
assert.doesNotMatch(noticeRule, /#[0-9a-fA-F]{3,8}|rgb|hsl/, "el aviso no introduce colores literales");
assert.match(purchaseDetail, /No hay un documento asociado a esta compra\./);
// Texto del proveedor en el formulario de Compras: sin jerga en inglés, tanto en la vista de solo lectura como en el selector.
assert.doesNotMatch(purchaseDetail, /[Ss]napshot hist[oó]rico/);
assert.equal((purchaseDetail.match(/Datos del proveedor al momento de la compra/g) || []).length, 1, "el texto vive en una sola constante");
assert.match(purchaseDetail, /<small>\{PROVIDER_AT_PURCHASE_NOTE\}<\/small>/);
assert.match(purchaseDetail, /historicalNote=\{PROVIDER_AT_PURCHASE_NOTE\}/);
const providerSelectorSource = fs.readFileSync(new URL("../src/features/purchaseOrders/ProviderSelector.jsx", import.meta.url), "utf8");
assert.match(providerSelectorSource, /\{isHistorical && <em className="po-provider__snapshot">\{historicalNote\}<\/em>\}/);
// Paneles abiertos del formulario de edición: el cuerpo lleva el mismo padding que el resumen y las notas; los valores, peso normal.
const panelBodyRule = purchasesCss.match(/\.po-details > \.purchase-document-grid \{([^}]*)\}/)?.[1] || "";
assert.match(panelBodyRule, /padding: 14px;/, "el cuerpo del panel tiene aire lateral");
assert.match(purchasesCss, /\.purchase-document-summary \{[^}]*padding: 14px;/);
assert.match(purchasesCss, /\.purchase-notes-grid \{[^}]*padding: 14px;/);
const panelValueRule = purchasesCss.match(/\.po-details > \.purchase-document-grid input, \.po-details > \.purchase-document-grid select, \.po-details > \.purchase-document-grid textarea \{([^}]*)\}/)?.[1] || "";
assert.match(panelValueRule, /font-weight: var\(--font-weight-regular\);/, "los valores escritos no van en negrita");
assert.match(purchasesCss, /\.purchase-document-grid label \{[^}]*font-weight: 700;/, "las etiquetas siguen en negrita");
assert.match(purchasesCss, /\.purchase-document-grid \{ display: grid; gap: 12px; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); padding-top: 14px; \}/, "la regla base compartida con Ventas no cambia");
// Nueva compra ya no usa acordeones (consistencia con Nueva venta): Documento y fechas, Condiciones comerciales y la vista previa son tarjetas visibles.
assert.equal((purchaseDetail.match(/<details/g) || []).length, 0, "el formulario de Compras no usa acordeones");
assert.equal((purchaseDetail.match(/<div className="purchase-document-grid purchase-data-grid">/g) || []).length, 1, "el panel Documento y fechas es una tarjeta abierta con los campos de siempre");
// "Cancelar compra" es un botón directo con la variante peligrosa (antes, un menú "Más acciones" de una sola opción), en la lista y en el formulario.
const purchaseOrdersCss = fs.readFileSync(new URL("../src/features/purchaseOrders/purchase-orders.css", import.meta.url), "utf8");
const listActionsSource = sliceBetween(purchasesPage, "function Actions(", "export default function PurchasesPage", "componente Actions de la lista");
assert.doesNotMatch(purchasesPage, /<details|po-more-actions|Más acciones ···/, "la lista no deja el menú de una sola opción");
assert.doesNotMatch(purchaseSummary, /<details|po-more-actions|Más acciones/, "el formulario no deja el menú de una sola opción");
// Jerarquía de las acciones de fila: las tres son Button del sistema (mismo tamaño y peso); Confirmar con contorno de marca,
// Revertir con contorno neutro y Cancelar compra con texto rojo sin relleno. Mismo permiso, mismos estados y mismos diálogos.
assert.match(listActionsSource, /<div className="purchase-row-actions">/);
assert.doesNotMatch(listActionsSource, /<button\b/, "las acciones de fila son Button del sistema, no <button> nativos con estilo de tabla");
assert.doesNotMatch(listActionsSource, /po-history__/, "la fila de Compras no hereda las reglas de .po-history__actions (Órdenes de compra)");
assert.match(listActionsSource, /purchase\.estado === "borrador" && \(\s*<>\s*<Button type="button" variant="ghost" className="purchase-row-actions__confirm" disabled=\{processing\} onClick=\{\(\) => onAction\(purchase, "confirmar"\)\}>Confirmar<\/Button>\s*<Button type="button" variant="ghost-danger" disabled=\{processing\} onClick=\{\(\) => onAction\(purchase, "cancelar"\)\}>Cancelar compra<\/Button>\s*<\/>\s*\)\}/, "en la lista, Confirmar (contorno de marca) y Cancelar compra (texto rojo) solo en borrador con permiso");
assert.match(listActionsSource, /canManage && purchase\.estado === "confirmada" && \(\s*<Button type="button" variant="secondary" disabled=\{processing\} onClick=\{\(\) => onAction\(purchase, "revertir"\)\}>Revertir compra<\/Button>\s*\)\}/, "Revertir compra, contorno neutro y solo en confirmada con permiso");
assert.match(listActionsSource, /canManage && purchase\.estado === "borrador"/, "mismo permiso por rol y mismo estado");
assert.equal((purchasesPage.match(/>Cancelar compra<\/Button>/g) || []).length, 1, "un solo botón directo con el texto fijo (el del diálogo usa expresión)");
assert.match(purchaseSummary, /import Button from "\.\.\/\.\.\/components\/ui\/Button";/);
assert.match(purchaseSummary, /\{onCancel && <div className="po-summary__danger"><Button type="button" variant="ghost-danger" disabled=\{processing\} onClick=\{onCancel\}>Cancelar compra<\/Button><\/div>\}/, "en el formulario, el botón queda en la columna de acciones, apartado de Confirmar compra");
assert.ok(purchaseSummary.indexOf("Guardar cambios") >= 0 && purchaseSummary.indexOf(">Cancelar compra<") >= 0, "se localizan Guardar cambios y Cancelar compra");
assert.ok(purchaseSummary.indexOf("Guardar cambios") < purchaseSummary.indexOf(">Cancelar compra<"), "el botón va bajo Guardar cambios");
assert.match(purchaseDetail, /disabled=\{readOnly\}/, "el panel sigue deshabilitado fuera del borrador o sin permiso");
assert.match(purchaseDetail, /onCancel=\{purchase \? \(\) => setActionDialog\("cancel"\) : null\}/, "solo una compra ya guardada ofrece cancelar");
// CSS de la fila: clase propia del feature, solo tokens de color/espacio/fuente, mismo tamaño para los tres botones y sin peso propio.
const rowActionsCss = sliceBetween(purchasesCss, "/* Acciones de cada fila de la lista de Compras", "/* Importar factura:", "CSS de las acciones de fila");
assert.match(rowActionsCss, /\.purchase-row-actions \{ display: flex; flex-wrap: wrap; gap: var\(--space-2\); \}/);
assert.match(rowActionsCss, /\.purchase-row-actions > button \{ font-size: var\(--font-size-xs\); min-height: 2rem; padding: var\(--space-1\) var\(--space-3\); \}/, "los tres botones comparten tamaño chico");
assert.doesNotMatch(rowActionsCss, /font-weight/, "ningún botón de la fila cambia el peso tipográfico del Button");
assert.match(rowActionsCss, /\.purchase-row-actions > \.purchase-row-actions__confirm \{ border-color: var\(--color-text-brand-accent\); color: var\(--color-text-brand\); \}/, "Confirmar: contorno y texto de marca por token");
assert.match(rowActionsCss, /@media \(pointer: coarse\) \{ \.purchase-row-actions > button \{ min-height: 2\.75rem; \} \}/, "al tacto conserva el área mínima de toque");
assert.match(rowActionsCss, /@media \(max-width: 767px\) \{\s*\.po-history-card \.purchase-row-actions \{ display: grid; grid-template-columns: 1fr; \}\s*\.po-history-card \.purchase-row-actions > button \{ width: 100%; \}\s*\}/, "en las tarjetas móviles los botones se apilan sin desbordar");
assert.doesNotMatch(rowActionsCss, /\.ui-button/, "design-smoke prohíbe definir .ui-button fuera de components.css");
assert.doesNotMatch(rowActionsCss, /#[0-9a-fA-F]{3,8}|rgb\(|hsl\(|border-radius|box-shadow|\d\s*m?s\b|--color-danger|--color-brand|--color-dark/, "sin colores, radios, sombras ni duraciones literales; sin tokens prohibidos");
assert.doesNotMatch(purchasesCss.replace(/\/\*[\s\S]*?\*\//g, ""), /po-history__cancel-purchase|\.po-history__actions/, "Compras no redefine .po-history__actions (sin contar comentarios)");
// Las demás pantallas con .po-history__actions no cambian: Órdenes de compra conserva su clase y las reglas compartidas.
const purchaseOrdersPageSource = fs.readFileSync(new URL("../src/pages/PurchaseOrdersPage.jsx", import.meta.url), "utf8");
assert.match(purchaseOrdersPageSource, /<div className="po-history__actions po-history__actions--purchase-orders">/);
assert.match(purchaseOrdersCss, /\.po-history__actions button,\s*\.po-history__actions summary \{[^}]*padding: 6px;/, "la regla compartida de botones de tabla sigue igual");
assert.match(purchaseOrdersCss, /\.po-history__actions > \.po-history__danger \{\s*border-color: var\(--color-danger-200\);\s*color: var\(--color-danger-700\);\s*\}/, "la regla peligrosa de Órdenes de compra sigue igual");
// "Factura importada y pendiente de confirmación": mismo aire lateral que los campos del panel (14px), solo dentro de .po-details.
assert.match(purchasesCss, /\.po-details > \.purchase-imported-document-summary \{ margin: 14px; \}/, "el bloque importado se alinea con los campos");
assert.match(purchasesCss, /\.purchase-imported-document-summary \{[^}]*margin-top: 14px;/, "la regla base del bloque no cambia");
assert.match(purchaseDetail, /<section className="po-panel purchase-data-panel"[\s\S]*?\{!readOnly && draft\.documentoOrigen && <div className="purchase-imported-document-summary" role="status">/, "el bloque vive dentro de la tarjeta Documento y fechas");
// La cancelación conserva su confirmación: el botón solo abre el diálogo; la Function se llama únicamente desde la acción confirmada.
assert.match(purchasesPage, /const action = \(purchase, type\) => \{ setReversalReason\(""\); setPendingAction\(\{purchase, type\}\); \};/);
assert.equal((purchasesPage.match(/cancelarCompraBorrador\(/g) || []).length, 1);
assert.ok(purchasesPage.indexOf("const executeAction") >= 0 && purchasesPage.indexOf("cancelarCompraBorrador(") >= 0, "se localizan executeAction y la llamada a la Function");
assert.ok(purchasesPage.indexOf("const executeAction") < purchasesPage.indexOf("cancelarCompraBorrador("), "la lista cancela solo desde executeAction");
assert.match(purchasesPage, /variant=\{pendingAction\?\.type === "confirmar" \? "primary" : "danger"\} loading=\{Boolean\(processing\)\}/, "el diálogo de la lista confirma con botón peligroso");
assert.match(purchasesPage, /"La compra preparada quedará cancelada sin modificar stock\."/);
assert.doesNotMatch(purchaseSummary, /cancelarCompra/, "el panel solo avisa onCancel; no cancela por su cuenta");
assert.equal((purchaseDetail.match(/cancelarCompraBorrador\(/g) || []).length, 1);
assert.match(purchaseDetail, /const cancel = async \(\) => \{[\s\S]*?cancelarCompraBorrador\(businessId, purchase\.id\)/);
assert.match(purchaseDetail, /<ResponsiveDialog open=\{actionDialog === "cancel"\}[^\n]*La compra preparada quedará cancelada y ya no podrá editarse\.[^\n]*<Button type="button" variant="danger" loading=\{processing\} disabled=\{Boolean\(cancelError\)\} onClick=\{cancel\}>/, "el formulario confirma en un diálogo antes de cancelar");
// Cuando el servidor rechaza "Confirmar compra" (duplicado, red, permiso), el mensaje queda DENTRO del diálogo con <Notice>, el diálogo
// no se cierra y la misma operación no se repite mientras el aviso esté visible (hay que cerrar el diálogo, o cambiar el motivo en Revertir).
// La lista guarda el error en pendingAction: abrir o cerrar el diálogo descarta el objeto y el error no reaparece en un diálogo nuevo.
const listExecuteSource = sliceBetween(purchasesPage, "const executeAction", "const open = ", "executeAction de la lista");
const listCatchSource = sliceBetween(listExecuteSource, "} catch (error) {", "} finally", "catch de executeAction");
assert.match(purchasesPage, /import Notice from "\.\.\/components\/ui\/Notice";/);
assert.match(listCatchSource, /setPendingAction\(\(current\) => \(current \? \{\.\.\.current, error: \{title, message: userErrorMessage\(error\), retryable\}\} : current\)\)/, "la lista guarda el rechazo en el diálogo abierto, con el mensaje del helper y si es reintentable");
assert.doesNotMatch(listCatchSource, /sileo\./, "el rechazo ya no va solo a una burbuja que desaparece");
assert.doesNotMatch(listCatchSource, /setMessage\(/, "el rechazo no se duplica como mensaje de página detrás del diálogo");
assert.doesNotMatch(listCatchSource, /setPendingAction\(null\)/, "un fallo no cierra el diálogo");
assert.match(purchasesPage, /const actionError = pendingAction\?\.error \|\| null;/);
assert.match(purchasesPage, /\{actionError && <Notice variant="error" className="po-dialog-error" title=\{actionError\.title\}>\{actionError\.message\}<\/Notice>\}<\/ResponsiveDialog>/, "el aviso es un <Notice> de error dentro del diálogo");
assert.match(purchasesPage, /disabled=\{\(pendingAction\?\.type === "revertir" && !reversalReason\.trim\(\)\) \|\| actionBlocked\} onClick=\{executeAction\}/, "con un rechazo definitivo, la acción no se puede repetir");
// Rechazo reintentable (corte de red) solo en Confirmar: el botón principal sigue habilitado y el reintento reutiliza el mismo requestId.
assert.match(purchasesPage, /const actionBlocked = Boolean\(actionError\) && !actionError\.retryable;/, "solo un error no reintentable bloquea el botón principal");
assert.match(listCatchSource, /const retryable = type === "confirmar" && shouldReconcilePurchaseConfirmation\(error\);/, "reintentable = la política de reconciliación, solo al confirmar");
assert.match(purchasesPage, /matchesPurchaseSearch, shouldReconcilePurchaseConfirmation\} from "\.\.\/domain\/purchaseModel\.mjs";/);
assert.match(listExecuteSource, /const requestId = confirmIds\.current\.get\(purchase\.id\) \|\| createPurchaseRequestId\("purchase-confirm"\);\s*confirmIds\.current\.set\(purchase\.id, requestId\);\s*const result = await confirmarCompra\(businessId, purchase\.id, \{requestId\}\);\s*confirmIds\.current\.delete\(purchase\.id\);/, "la lista guarda el requestId antes de llamar y solo lo borra tras el éxito");
assert.equal((listExecuteSource.match(/confirmIds\.current\.delete\(/g) || []).length, 1);
assert.doesNotMatch(listCatchSource, /confirmIds/, "un fallo conserva el requestId para el reintento");
assert.match(listExecuteSource, /setProcessing\(purchase\.id\); setMessage\(""\);\s*setPendingAction\(\(current\) => \(current\?\.error \? \{\.\.\.current, error: null\} : current\)\);\s*try \{/, "al reintentar se limpia el aviso anterior");
assert.match(purchasesPage, /const changeReversalReason = \(value\) => \{ setReversalReason\(value\); setPendingAction\(\(current\) => \(current\?\.error \? \{\.\.\.current, error: null\} : current\)\); \};/, "cambiar el motivo de reversión limpia el error");
assert.match(purchasesPage, /onChange=\{\(event\) => changeReversalReason\(event\.target\.value\)\}/);
assert.match(purchasesPage, /useEffect\(\(\) => \{ if \(actionBlocked\) backButtonRef\.current\?\.focus\(\); \}, \[actionBlocked\]\);/, "el foco pasa a Volver solo cuando el botón principal queda deshabilitado");
// Eyebrows de los diálogos: ya no hay menú "Más acciones"; el rótulo es el estado de la compra (getPurchaseStatusLabel: Preparada / Confirmada).
assert.doesNotMatch(purchasesPage, /Más acciones/);
assert.doesNotMatch(purchaseDetail, /Más acciones/);
assert.match(purchasesPage, /eyebrow=\{pendingAction\?\.type === "revertir" \? "Compra confirmada" : "Compra preparada"\}/, "Revertir parte de una compra confirmada; Confirmar y Cancelar, de una preparada");
assert.match(purchaseDetail, /<ResponsiveDialog open=\{actionDialog === "cancel"\}[^\n]*eyebrow="Compra preparada" title="Cancelar compra"/, "Cancelar en el formulario: la compra está preparada");
assert.equal(getPurchaseStatusLabel("borrador"), "Preparada");
assert.equal(getPurchaseStatusLabel("confirmada"), "Confirmada");
assert.match(purchasesPage, /<Button ref=\{backButtonRef\} type="button" variant="secondary"/);
// Formulario /compras/:id/editar: el diálogo ya no se cierra al pulsar Confirmar; solo se cierra al terminar bien o con Volver.
const formConfirmSource = sliceBetween(purchaseDetail, "const confirm = async", "const cancel = async", "confirm() del formulario");
assert.match(formConfirmSource, /const confirm = async \(\) => \{\s*setConfirmError\(null\);\s*setProcessing\(true\);/, "confirm() no cierra el diálogo al empezar");
assert.equal((formConfirmSource.match(/setConfirmError\(\{title: /g) || []).length, 4, "los cuatro fallos de confirm() van al diálogo");
assert.doesNotMatch(formConfirmSource, /sileo\./, "ningún fallo de confirm() queda solo en una burbuja");
assert.doesNotMatch(formConfirmSource, /setMessage\(userErrorMessage/, "el rechazo no se duplica como mensaje de página");
assert.match(formConfirmSource, /setPurchase\(confirmed\);\s*setActionDialog\(""\);/, "el diálogo se cierra al confirmar bien");
assert.match(purchaseDetail, /const closeConfirmDialog = \(\) => \{ setActionDialog\(""\); setConfirmError\(null\); \};/);
assert.match(purchaseDetail, /<ResponsiveDialog open=\{actionDialog === "confirm"\} onClose=\{\(\) => !processing && closeConfirmDialog\(\)\}/);
assert.match(purchaseDetail, /<Button ref=\{backButtonRef\} type="button" variant="secondary" disabled=\{processing\} onClick=\{closeConfirmDialog\}>Volver<\/Button><Button type="button" loading=\{processing\} disabled=\{confirmBlocked\} onClick=\{confirm\}>/, "Volver descarta el error; con un rechazo definitivo no se repite Confirmar compra");
// Rechazo reintentable (corte de red): botón habilitado; el reintento reutiliza confirmId, que solo se renueva al confirmar bien.
assert.match(purchaseDetail, /const confirmBlocked = Boolean\(confirmError\) && !confirmError\.retryable;/);
assert.equal((formConfirmSource.match(/retryable: true/g) || []).length, 1, "solo \"la compra continúa preparada\" se marca reintentable de forma fija");
assert.equal((formConfirmSource.match(/retryable: false/g) || []).length, 2, "el rechazo definitivo y \"no se pudo verificar\" quedan bloqueados");
assert.match(formConfirmSource, /setConfirmError\(\{title: "No se pudo preparar la compra", message: userErrorMessage\(error\), retryable: shouldReconcilePurchaseConfirmation\(error\)\}\);/, "preparar: reintentable solo con la política de reconciliación");
assert.match(formConfirmSource, /if \(!shouldReconcilePurchaseConfirmation\(error\)\) \{\s*pendingConfirmationPurchaseId\.current = "";\s*setConfirmError\(\{title: "No se pudo confirmar la compra", message: userErrorMessage\(error\), retryable: false\}\);/, "el rechazo definitivo no es reintentable");
assert.match(formConfirmSource, /message: userErrorMessage\(error\) \+ " La compra continúa preparada\. Puedes reintentar con seguridad\.", retryable: true\}/);
assert.match(formConfirmSource, /message: userErrorMessage\(error\) \+ " Recarga la compra antes de volver a intentarlo\.", retryable: false\}/);
assert.match(formConfirmSource, /const result = await confirmarCompra\(businessId, stored\.id, \{\s*requestId: confirmId\.current,\s*\}\);/, "el reintento usa el requestId guardado");
assert.equal((formConfirmSource.match(/confirmId\.current = /g) || []).length, 1, "el requestId solo se renueva en un solo punto");
assert.match(formConfirmSource, /const finishConfirmation = \(confirmed, productsUpdated\) => \{\s*pendingConfirmationPurchaseId\.current = "";\s*confirmId\.current = createPurchaseRequestId\("purchase-confirm"\);/, "... y ese punto es el éxito (finishConfirmation)");
assert.match(purchaseDetail, /useEffect\(\(\) => \{ if \(confirmBlocked\) backButtonRef\.current\?\.focus\(\); \}, \[confirmBlocked\]\);/, "el foco pasa a Volver solo si el botón queda deshabilitado");
// Diálogo "Cancelar compra" del formulario: mismo patrón que Confirmar (aviso con Notice dentro del diálogo, no se cierra solo, foco a Volver).
const formCancelSource = sliceBetween(purchaseDetail, "const cancel = async", "const changeDocumentType", "cancel() del formulario");
assert.match(formCancelSource, /const cancel = async \(\) => \{\s*if \(!purchase\) return;\s*setCancelError\(null\);\s*setProcessing\(true\);\s*try \{/, "cancel() no cierra el diálogo al empezar");
assert.match(formCancelSource, /setPurchase\(result\.compra\);\s*setActionDialog\(""\);/, "el diálogo se cierra al cancelar bien");
assert.match(formCancelSource, /\} catch \(error\) \{\s*setCancelError\(\{title: "No se pudo cancelar la compra", message: userErrorMessage\(error\)\}\);\s*\} finally/, "el rechazo va al diálogo");
assert.doesNotMatch(formCancelSource, /sileo\.error|setActionDialog\(""\);\s*setProcessing/, "ningún fallo queda solo en una burbuja ni se cierra al empezar");
assert.match(purchaseDetail, /const \[cancelError, setCancelError\] = useState\(null\);/);
assert.match(purchaseDetail, /const closeCancelDialog = \(\) => \{ setActionDialog\(""\); setCancelError\(null\); \};/);
assert.match(purchaseDetail, /<ResponsiveDialog open=\{actionDialog === "cancel"\} onClose=\{\(\) => !processing && closeCancelDialog\(\)\}/);
assert.match(purchaseDetail, /<Button ref=\{cancelBackRef\} type="button" variant="secondary" disabled=\{processing\} onClick=\{closeCancelDialog\}>Volver<\/Button>/, "Volver descarta el error de cancelar");
assert.match(purchaseDetail, /\{cancelError && <Notice variant="error" className="po-dialog-error" title=\{cancelError\.title\}>\{cancelError\.message\}<\/Notice>\}/);
assert.match(purchaseDetail, /useEffect\(\(\) => \{ if \(cancelError\) cancelBackRef\.current\?\.focus\(\); \}, \[cancelError\]\);/, "el foco pasa a Volver");
assert.match(purchaseDetail, /\{confirmError && <Notice variant="error" className="po-dialog-error" title=\{confirmError\.title\}>\{confirmError\.message\}<\/Notice>\}/);
assert.match(purchasesCss, /\.po-dialog-error \{ margin-top: var\(--space-3\); \}/, "el aviso se separa del texto del diálogo con un token de espacio");
// El mensaje que se muestra es el del servidor, sin tocar el helper: duplicado, red y permiso (ya normalizados por purchaseService).
const duplicateMessage = "Este proveedor ya tiene una compra confirmada con la factura N° 123 (COM-000001). Revisa que la factura no se haya ingresado antes.";
assert.equal(userErrorMessage(Object.assign(new Error(duplicateMessage), {code: "failed-precondition"})), duplicateMessage);
assert.equal(userErrorMessage(Object.assign(new Error("Tu membresía no permite administrar compras."), {code: "permission-denied"})), "Tu membresía no permite administrar compras.");
assert.equal(userErrorMessage(Object.assign(new Error("No pudimos conectar con el servicio. Intenta nuevamente."), {code: "unavailable"})), "No pudimos conectar con el servicio. Intenta nuevamente.");
assert.equal(shouldReconcilePurchaseConfirmation({code: "failed-precondition"}), false, "el duplicado no pasa por la reconciliación: es un rechazo definitivo");
assert.equal(shouldReconcilePurchaseConfirmation({code: "permission-denied"}), false);
assert.equal(shouldReconcilePurchaseConfirmation({code: "unavailable"}), true, "un corte de red sí se reconcilia contra el servidor");
assert.equal(shouldReconcilePurchaseConfirmation({code: "functions/deadline-exceeded"}), true, "el prefijo functions/ no cambia la política");
assert.equal(shouldReconcilePurchaseConfirmation({code: "already-exists"}), false);
assert.doesNotMatch(purchaseDetail, />\s*\{effect\.movimientoEntradaId\}/);
assert.doesNotMatch(purchaseDetail, />\s*\{effect\.movimientoReversionId\}/);
assert.match(purchasePrint, /po-document-preview/);
// Impresión de la compra: el componente no trae CSS responsivo propio (su CSS vive en purchases.css y purchase-orders.css) y el
// enlace "Saltar al contenido principal" queda oculto al imprimir con la regla global.
assert.doesNotMatch(purchasePrint, /@media|@container|<style/, "PurchasePrintView no trae reglas responsivas propias");
assertSkipLinkHiddenInPrint(fs.readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8"), fs.readFileSync(new URL("../src/components/ui/SkipLink.jsx", import.meta.url), "utf8"));
assert.match(purchasePrint, /Documento asociado/);
assert.match(purchasePrint, /Unidad \/ naturaleza/);
assert.match(purchasePrint, /Orden de compra/);
assert.match(purchasePrint, /Recepci[oó]n/);
assert.match(purchaseSummary, /discounts > 0 \? `-\$\{money\(discounts\)\}` : money\(0\)/);
console.log("OK compras presentación: trazabilidad humana, documento imprimible y descuento cero");

// Factura duplicada: el número de documento se compara sin espacios sobrantes y en mayúsculas; guiones y ceros cuentan.
assert.equal(normalizeSupplierDocumentNumber("  f-100 "), "F-100");
assert.equal(normalizeSupplierDocumentNumber("F  -  100"), "F - 100");
assert.notEqual(normalizeSupplierDocumentNumber("F-100"), normalizeSupplierDocumentNumber("F100"));
assert.equal(normalizeSupplierDocumentNumber(null), "");
assert.equal(normalizeSupplierDocumentNumber("   "), "");
console.log("OK factura duplicada: normalización del número de documento");

// Verificación de totales del documento: el servidor decide coherenciaEstado; tolerancia de 1 por total.
assert.equal(DOCUMENT_TOTALS_TOLERANCE, 1);
const calculatedTotals = {neto: 10000, iva: 1900, total: 11900};
const coherence = (source, options = {}) => documentCoherenceState(source, calculatedTotals, {currency: "CLP", tipoDocumento: "factura", ...options});
assert.equal(coherence({neto: 10000, impuestoMonto: 1900, total: 11900}), "coherente");
assert.equal(coherence({neto: 10001, impuestoMonto: 1899, total: 11901}), "coherente", "1 de diferencia por total");
assert.equal(coherence({total: 11900}), "coherente", "basta un total declarado");
assert.equal(coherence({neto: 10002, impuestoMonto: 1900, total: 11900}), "revisar", "2 de diferencia en el neto");
assert.equal(coherence({neto: 10000, impuestoMonto: 1900, total: 11898}), "revisar", "2 de diferencia en el total");
assert.equal(coherence({neto: 10000, impuestoMonto: 0, total: 11900}), "revisar", "impuesto distinto");
assert.equal(coherence({coherenciaEstado: "coherente", total: 99999}), "revisar", "lo que declara el cliente en coherenciaEstado no cuenta");
assert.equal(coherence({coherenciaEstado: "revisar", total: 11900}), "coherente", "ni cuando dice 'revisar' con totales que calzan");
assert.equal(coherence({neto: null, impuestoMonto: null, total: null}), "sin_datos");
assert.equal(coherence({}), "sin_datos");
assert.equal(coherence({moneda: "USD", total: 5}), "sin_datos", "moneda distinta: no comparable");
assert.equal(coherence({moneda: "clp", total: 11900}), "coherente", "misma moneda en minúsculas");
assert.equal(documentCoherenceState({neto: 8403, impuestoMonto: 1597, total: 10000}, {neto: 10000, iva: 0, total: 10000}, {currency: "CLP", tipoDocumento: "boleta"}), "coherente", "boleta: solo se compara el total");
assert.equal(documentCoherenceState({total: 10005}, {neto: 10000, iva: 0, total: 10000}, {currency: "CLP", tipoDocumento: "boleta"}), "revisar");
console.log("OK verificación de totales del documento: tolerancia, cliente no confiable, moneda y boleta");

// Tolerancia por moneda: el número de decimales sale del catálogo (businessCatalog.json), igual que en formatBusinessMoney.
// Sin decimales (CLP, PYG) o código desconocido: 1. Con decimales (USD, EUR...): 0,01 por total.
for (const [currency, expected] of [["CLP", 1], ["PYG", 1], ["clp", 1], ["USD", 0.01], ["EUR", 0.01], ["COP", 0.01], ["XXX", 1], ["", 1]]) {
  assert.equal(documentTotalsTolerance(currency), expected, `tolerancia de ${currency || "moneda vacía"}`);
}
const decimalCoherence = (source, currency) => documentCoherenceState(source, calculatedTotals, {currency, tipoDocumento: "factura"});
assert.equal(decimalCoherence({total: 11901}, "CLP"), "coherente", "CLP: 1 de diferencia se tolera");
assert.equal(decimalCoherence({total: 11901}, "PYG"), "coherente", "PYG (0 decimales): 1 de diferencia se tolera");
assert.equal(decimalCoherence({total: 11901}, "USD"), "revisar", "USD: 1 de diferencia ya es demasiado (la tolerancia es 0,01)");
assert.equal(decimalCoherence({total: 11900.01}, "USD"), "coherente", "USD: 0,01 de diferencia se tolera");
assert.equal(decimalCoherence({total: 11899.99}, "EUR"), "coherente", "EUR: -0,01 de diferencia se tolera");
assert.equal(decimalCoherence({total: 11900.02}, "USD"), "revisar", "USD: 0,02 de diferencia es 'revisar'");
assert.equal(decimalCoherence({neto: 10000.01, impuestoMonto: 1899.99, total: 11900.01}, "USD"), "coherente", "USD: 0,01 en cada total");
assert.equal(decimalCoherence({neto: 10000.02, impuestoMonto: 1900, total: 11900}, "USD"), "revisar", "USD: 0,02 en el neto");
assert.equal(decimalCoherence({total: 11901}, "XXX"), "coherente", "moneda fuera del catálogo: se conserva la tolerancia de 1");
console.log("OK verificación de totales del documento: tolerancia por moneda según los decimales del catálogo");

// Factura de 21 líneas con cantidades, precios y descuentos distintos (ferretería eléctrica e informática).
// Se compara el cálculo del servidor (redondea el subtotal y el descuento de cada línea) con dos emisores plausibles que SÍ calzan
// con sus propias líneas: A redondea una sola vez al final; B redondea el total de cada línea en una sola operación.
const INVOICE_21 = [
  [3, 1290, 0], [7.5, 845, 5], [12, 2390, 10], [2.25, 15990, 0], [48, 359, 12.5],
  [1.5, 7490, 7], [6, 3150, 0], [10, 1875, 15], [0.75, 22990, 5], [24, 649, 10],
  [5, 4590, 3], [8.5, 1120, 0], [2, 18900, 8], [15, 735, 12], [4.5, 2680, 6],
  [30, 249, 10], [1.25, 9990, 0], [9, 1590, 5], [18, 479, 7.5], [3.5, 5230, 10], [11, 990, 2.5],
];
const invoice21Items = INVOICE_21.map(([cantidad, costoUnitario, descuentoPct], index) => line({lineaId: `l${index}`, itemId: `i${index}`, cantidad, costoUnitario, descuentoPct, impuestoId: "IVA_GENERAL"}));
assert.equal(invoice21Items.length, 21);
const invoice21 = calculateBackendPurchaseTotals(backendLines(invoice21Items), TestHttpsError, 0.19, {tipoDocumento: "factura"});
assert.equal(new Set(INVOICE_21.map(([cantidad]) => cantidad)).size, 21, "21 cantidades distintas");
assert.ok(new Set(INVOICE_21.map(([, , descuentoPct]) => descuentoPct)).size >= 8, "descuentos variados, algunas líneas sin descuento");
assert.deepEqual({neto: invoice21.neto, iva: invoice21.iva, total: invoice21.total}, {neto: 317911, iva: 60403, total: 378314});
const issuerA = {neto: 317911, impuestoMonto: 60403, total: 378314}; // suma exacta de q·c·(1-d) = 317911,45 redondeada una sola vez
const issuerBNeto = INVOICE_21.reduce((sum, [q, c, d]) => sum + Math.round(q * c * (1 - d / 100)), 0);
const issuerB = {neto: issuerBNeto, impuestoMonto: Math.round(issuerBNeto * 0.19), total: issuerBNeto + Math.round(issuerBNeto * 0.19)};
assert.deepEqual(issuerB, {neto: 317914, impuestoMonto: 60404, total: 378318});
assert.equal(documentCoherenceState(issuerA, invoice21, {currency: "CLP", tipoDocumento: "factura"}), "coherente", "21 líneas, emisor A: calza exacto");
// El emisor B calza con sus líneas pero difiere por el redondeo por línea (neto +3, IVA +1, total +4). La tolerancia crece con el
// número de líneas (unidad de la moneda × max(1, líneas)), así que con lineCount 21 es 'coherente'; sin lineCount (1 línea) sería 'revisar'.
assert.deepEqual({neto: issuerB.neto - invoice21.neto, iva: issuerB.impuestoMonto - invoice21.iva, total: issuerB.total - invoice21.total}, {neto: 3, iva: 1, total: 4});
const coherence21 = (source, options = {}) => documentCoherenceState(source, invoice21, {currency: "CLP", tipoDocumento: "factura", lineCount: 21, ...options});
assert.equal(coherence21(issuerA), "coherente", "21 líneas, emisor A: calza exacto");
assert.equal(coherence21(issuerB), "coherente", "21 líneas, emisor B: el redondeo por línea cae dentro de la tolerancia de 21");
assert.equal(coherence21({...issuerB, total: issuerB.total + 100}), "revisar", "21 líneas: 100 pesos de diferencia en el total siguen en 'revisar'");
assert.equal(coherence21({...issuerA, neto: issuerA.neto + 100}), "revisar", "21 líneas: 100 pesos de diferencia en el neto siguen en 'revisar'");
assert.equal(coherence21({...issuerA, impuestoMonto: issuerA.impuestoMonto + 22}), "revisar", "21 líneas: 22 de diferencia (fuera de 21) en el IVA es 'revisar'");
assert.equal(coherence21({total: invoice21.total + 21}), "coherente", "21 líneas: justo en el límite (21)");
assert.equal(coherence21({total: invoice21.total + 22}), "revisar", "21 líneas: 22 ya es 'revisar'");
assert.equal(documentCoherenceState(issuerB, invoice21, {currency: "CLP", tipoDocumento: "factura", lineCount: 1}), "revisar", "el mismo documento con tolerancia de 1 línea sigue en 'revisar' (el cambio depende de lineCount)");
assert.equal(documentCoherenceState(issuerB, invoice21, {currency: "CLP", tipoDocumento: "factura"}), "revisar", "sin lineCount se asume 1 línea");
console.log("OK verificación de totales: factura de 21 líneas (emisores A y B coherentes; una diferencia de 100 sigue en 'revisar')");

// Tolerancia según el número de líneas: unidad de la moneda × max(1, líneas). Con 1 línea es idéntica a la de antes del cambio.
for (const [currency, lineCount, expected] of [
  ["CLP", 1, 1], ["CLP", 0, 1], ["CLP", undefined, 1], ["CLP", 2, 2], ["CLP", 21, 21], ["PYG", 21, 21],
  ["USD", 1, 0.01], ["USD", 21, 0.21], ["BOB", 21, 0.21], ["XXX", 21, 21], ["CLP", -3, 1], ["CLP", 2.5, 1], ["CLP", "21", 1],
]) {
  assert.ok(Math.abs(documentTotalsTolerance(currency, lineCount) - expected) < 1e-9, `tolerancia de ${currency} con ${lineCount} líneas`);
}
// 1 línea: idéntico al comportamiento anterior (1 se tolera, 2 no), con y sin lineCount explícito.
for (const lineCount of [undefined, 1]) {
  const oneLine = (source) => documentCoherenceState(source, calculatedTotals, {currency: "CLP", tipoDocumento: "factura", ...(lineCount ? {lineCount} : {})});
  assert.equal(oneLine({total: 11901}), "coherente", `1 línea (${lineCount}): 1 de diferencia se tolera`);
  assert.equal(oneLine({total: 11902}), "revisar", `1 línea (${lineCount}): 2 de diferencia es 'revisar'`);
  assert.equal(oneLine({neto: 10002, impuestoMonto: 1900, total: 11900}), "revisar", `1 línea (${lineCount}): 2 en el neto es 'revisar'`);
}
// 21 líneas con una diferencia grande: la tolerancia crece, pero no tanto como para esconder un error real.
const coherenceManyLines = (source, lineCount, currency = "CLP") => documentCoherenceState(source, calculatedTotals, {currency, tipoDocumento: "factura", lineCount});
assert.equal(coherenceManyLines({total: 11900 + 21}, 21), "coherente", "21 líneas: 21 de diferencia en el total se tolera");
assert.equal(coherenceManyLines({total: 11900 + 100}, 21), "revisar", "21 líneas: 100 de diferencia es 'revisar'");
assert.equal(coherenceManyLines({neto: 10000 - 100, impuestoMonto: 1900, total: 11900}, 21), "revisar", "21 líneas: 100 de diferencia en el neto es 'revisar'");
// Moneda de 2 decimales: la unidad es 0,01 y también crece con las líneas (0,21 con 21 líneas).
assert.equal(coherenceManyLines({total: 11900.01}, 1, "USD"), "coherente", "USD 1 línea: 0,01 se tolera");
assert.equal(coherenceManyLines({total: 11900.02}, 1, "USD"), "revisar", "USD 1 línea: 0,02 es 'revisar' (igual que antes)");
assert.equal(coherenceManyLines({total: 11900.21}, 21, "USD"), "coherente", "USD 21 líneas: 0,21 se tolera");
assert.equal(coherenceManyLines({neto: 10000.2, impuestoMonto: 1899.8, total: 11900.2}, 21, "BOB"), "coherente", "BOB 21 líneas: 0,20 en cada total se tolera");
assert.equal(coherenceManyLines({total: 11900.22}, 21, "USD"), "revisar", "USD 21 líneas: 0,22 es 'revisar'");
assert.equal(coherenceManyLines({total: 11901}, 21, "USD"), "revisar", "USD 21 líneas: 1 entera es una diferencia grande");
console.log("OK verificación de totales: tolerancia según el número de líneas (1 línea igual que antes, 21 líneas, diferencia grande y moneda de 2 decimales)");

console.log("Smoke del modelo de Compras completado.");
