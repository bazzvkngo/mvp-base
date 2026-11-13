import assert from "node:assert/strict";
import fs from "node:fs";
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

assert.match(purchaseDetail, /SupplyTrace/);
assert.doesNotMatch(purchaseDetail, /Originada desde recepción|Originada desde orden de compra/);
assert.match(purchaseReadOnlyView, /Trazabilidad de entradas/);
assert.doesNotMatch(purchaseReadOnlyView, /Snapshot hist[oó]rico conservado|SupplyTrace|disabled=|<input|<textarea/);
// Aviso de totales en el detalle: solo con coherenciaEstado "revisar" y documento asociado; fuera de la vista imprimible; CSS solo con tokens.
assert.match(purchaseReadOnlyView, /import Notice from "\.\.\/\.\.\/components\/ui\/Notice"/);
assert.match(purchaseReadOnlyView, /\{hasDocument && source\.coherenciaEstado === "revisar" && <section className="purchase-detail__totals-notice">\s*<Notice variant="warning" role=\{null\}>Los totales del documento no coinciden con las líneas\.<\/Notice>\s*<\/section>\}/);
assert.equal((purchaseReadOnlyView.match(/coherenciaEstado/g) || []).length, 1);
assert.ok(purchaseReadOnlyView.indexOf("purchase-detail__totals-notice") < purchaseReadOnlyView.indexOf('className="print-only"'), "el aviso queda en la parte de pantalla, no en la impresión");
const purchasesCss = fs.readFileSync(new URL("../src/features/purchases/purchases.css", import.meta.url), "utf8");
const noticeRule = purchasesCss.match(/\.purchase-detail__totals-notice \{([^}]*)\}/)?.[1] || "";
assert.match(noticeRule, /padding: 0 var\(--space-4\) var\(--space-4\)/);
assert.doesNotMatch(noticeRule, /#[0-9a-fA-F]{3,8}|rgb|hsl/, "el aviso no introduce colores literales");
assert.match(purchaseDetail, /No hay un documento asociado a esta compra\./);
assert.match(purchaseDetail, /Snapshot hist[oó]rico conservado/);
assert.doesNotMatch(purchaseDetail, />\s*\{effect\.movimientoEntradaId\}/);
assert.doesNotMatch(purchaseDetail, />\s*\{effect\.movimientoReversionId\}/);
assert.match(purchasePrint, /po-document-preview/);
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
