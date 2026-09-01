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
  shouldReconcilePurchaseConfirmation,
} from "../src/domain/purchaseModel.mjs";

const require = createRequire(import.meta.url);
const {normalizePurchaseInput} = require("../functions/purchasePersistence.js");
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
const purchasePrint = fs.readFileSync(new URL("../src/features/purchases/PurchasePrintView.jsx", import.meta.url), "utf8");
const purchaseSummary = fs.readFileSync(new URL("../src/features/purchases/PurchaseSummaryPanel.jsx", import.meta.url), "utf8");
assert.match(backend, /purchaseConfirmRequests/);
assert.match(backend, /movimientosInventario/);
assert.match(backend, /stockAplicado/);
assert.match(backend, /purchaseReversalRequests/);
assert.match(backend, /salida_reversion_compra/);
assert.doesNotMatch(backend, /cost[oe]Base\s*:/i);
assert.match(purchasesPage, /Revertir compra/);
assert.match(purchasesPage, /Motivo de reversión \*/);
assert.match(purchasesPage, /getPurchaseStockSemantics/);
assert.match(purchaseDetail, /getPurchaseStockSemantics/);
assert.match(purchaseDetail, /stockSemantics\.kind === "reception"/);
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
assert.match(purchaseDetail, /Trazabilidad de entradas/);
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
console.log("OK compras presentaciÃ³n: trazabilidad humana, documento imprimible y descuento cero");

console.log("Smoke del modelo de Compras completado.");
