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
  getPurchaseStatusLabel,
  matchesPurchaseSearch,
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
assert.deepEqual(PURCHASE_STATUSES, ["borrador", "confirmada", "cancelada", "revertida"]);
assert.equal(getPurchaseStatusLabel("borrador"), "Preparada");
assert.equal(getPurchaseStatusLabel("revertida"), "Revertida");
assert.equal(getPurchaseDocumentTypeLabel("sin_documento"), "Sin documento");
assert.equal(shouldReconcilePurchaseConfirmation({code: "unavailable"}), true);
assert.equal(shouldReconcilePurchaseConfirmation({code: "permission-denied"}), false);
console.log("OK compras modelo: adaptación, búsqueda y roles");

const backend = fs.readFileSync(new URL("../functions/purchasePersistence.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const purchasesPage = fs.readFileSync(new URL("../src/pages/PurchasesPage.jsx", import.meta.url), "utf8");
assert.match(backend, /purchaseConfirmRequests/);
assert.match(backend, /movimientosInventario/);
assert.match(backend, /stockAplicado/);
assert.match(backend, /purchaseReversalRequests/);
assert.match(backend, /salida_reversion_compra/);
assert.doesNotMatch(backend, /cost[oe]Base\s*:/i);
assert.match(purchasesPage, /Revertir compra/);
assert.match(purchasesPage, /Motivo de reversión \*/);
for (const collectionName of [
  "compras", "movimientosInventario", "purchaseCounters",
  "purchaseCreateRequests", "purchaseConfirmRequests",
  "purchaseOrderConversionRequests", "purchaseReversalRequests",
]) assert.match(rules, new RegExp(`match /${collectionName}/`));
console.log("OK compras modelo: defensas backend y reglas declaradas");

console.log("Smoke del modelo de Compras completado.");
