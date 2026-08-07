import assert from "node:assert/strict";
import fs from "node:fs";
import {
  adaptStoredPurchaseOrder,
  buildPurchaseOrderMutationPayload,
  calculatePurchaseOrderLine,
  calculatePurchaseOrderTotals,
  canManagePurchaseOrders,
  matchesPurchaseOrderSearch,
  resolvePurchaseOrderProviderPreview,
} from "../src/domain/purchaseOrderModel.mjs";

const item = (overrides = {}) => ({
  lineaId: "linea-1",
  itemId: "item-1",
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  ...overrides,
});

assert.deepEqual(calculatePurchaseOrderLine(item()), {
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  subtotalLinea: 2000,
  descuentoLinea: 200,
  totalLinea: 1800,
});
assert.deepEqual(calculatePurchaseOrderTotals([
  item(),
  item({lineaId: "linea-2", itemId: "item-2", cantidad: 1, costoUnitario: 500, descuentoPct: 0}),
]), {subtotal: 2500, descuentoTotal: 200, neto: 2300, iva: 437, total: 2737});
assert.throws(() => calculatePurchaseOrderLine(item({cantidad: 0})), /entre|mayor/);
assert.throws(() => calculatePurchaseOrderLine(item({cantidad: Infinity})), /numérico|número/);
assert.throws(() => calculatePurchaseOrderLine(item({cantidad: NaN})), /numérico|número/);
assert.throws(() => calculatePurchaseOrderLine(item({costoUnitario: -1})), /entre|mayor/);
assert.throws(() => calculatePurchaseOrderLine(item({descuentoPct: 101})), /superar|entre/);
assert.throws(
  () => calculatePurchaseOrderLine(item({costoUnitario: Number.MAX_VALUE})),
  /El monto de la orden supera el máximo permitido\./
);
assert.throws(
  () => calculatePurchaseOrderLine(item({cantidad: Number.MAX_VALUE, costoUnitario: 1})),
  /El monto de la orden supera el máximo permitido\./
);
assert.throws(
  () => calculatePurchaseOrderLine(item({cantidad: 2, costoUnitario: Number.MAX_VALUE})),
  /El monto de la orden supera el máximo permitido\./
);
assert.throws(
  () => calculatePurchaseOrderTotals([item({cantidad: 1, costoUnitario: Number.MAX_SAFE_INTEGER, descuentoPct: 0})]),
  /El monto de la orden supera el máximo permitido\./
);
console.log("OK modelo: cantidades, costos, descuentos, IVA y totales");

const historicalProviderA = {
  proveedorId: "provider-a",
  estado: "activo",
  razonSocial: "Proveedor A histórico",
};
const liveProviderA = {
  proveedorId: "provider-a",
  estado: "activo",
  razonSocial: "Proveedor A vivo modificado",
};
const liveProviderB = {
  proveedorId: "provider-b",
  estado: "activo",
  razonSocial: "Proveedor B actual",
};
const orderWithProviderA = {
  proveedorId: "provider-a",
  proveedorSnapshot: historicalProviderA,
};
assert.strictEqual(
  resolvePurchaseOrderProviderPreview(
    orderWithProviderA,
    "provider-a",
    [liveProviderA, liveProviderB]
  ),
  historicalProviderA
);
assert.strictEqual(
  resolvePurchaseOrderProviderPreview(
    orderWithProviderA,
    "provider-b",
    [liveProviderA, liveProviderB]
  ),
  liveProviderB
);
assert.strictEqual(
  resolvePurchaseOrderProviderPreview(
    orderWithProviderA,
    "provider-a",
    [liveProviderA, liveProviderB]
  ),
  historicalProviderA
);
console.log("OK preview proveedor: A→A histórico, A→B vivo y A→B→A histórico");

const mutation = buildPurchaseOrderMutationPayload({
  proveedorId: "proveedor-1",
  items: [{
    ...item(),
    nombre: "Nombre manipulado",
    codigo: "FAKE",
    inventarioSnapshot: {nombre: "Snapshot manipulado"},
    totalLinea: 1,
  }],
  proveedorSnapshot: {razonSocial: "Proveedor manipulado"},
  numero: "OC-FAKE",
  estado: "emitida",
  total: 1,
});
assert.deepEqual(Object.keys(mutation.items[0]).sort(), [
  "cantidad", "costoUnitario", "descuentoPct", "itemId", "lineaId",
].sort());
assert.equal("proveedorSnapshot" in mutation, false);
assert.equal("numero" in mutation, false);
assert.equal("estado" in mutation, false);
assert.equal("total" in mutation, false);
console.log("OK contrato: frontend solo envía IDs y valores editables");

const stored = adaptStoredPurchaseOrder({
  id: "oc-legacy",
  numeroOrdenCompra: "OC-2025-0002",
  proveedorNombre: "Proveedor histórico",
  proveedorRut: "12.345.678-5",
  estado: "emitida",
  items: [{
    inventarioId: "legacy-1",
    nombre: "Ítem legacy",
    tipo: "servicio",
    cantidad: 1,
    costo: 10000,
  }],
});
assert.equal(stored.ordenCompraId, "oc-legacy");
assert.equal(stored.numero, "OC-2025-0002");
assert.equal(stored.proveedorSnapshot.razonSocial, "Proveedor histórico");
assert.equal(stored.items[0].tipoItem, "servicio");
assert.equal(stored.total, 11900);
assert.equal("purchaseOrderId" in stored, false);
assert.equal(matchesPurchaseOrderSearch(stored, "historico"), true);
assert.equal(canManagePurchaseOrders("ADMIN"), true);
assert.equal(canManagePurchaseOrders("MEMBER"), false);
console.log("OK compatibilidad: adapter legacy y roles");

const backendSource = fs.readFileSync("functions/purchaseOrderPersistence.js", "utf8");
const rulesSource = fs.readFileSync("firestore.rules", "utf8");
const pageSource = fs.readFileSync("src/pages/NewPurchaseOrderPage.jsx", "utf8");
const providerSelectorSource = fs.readFileSync(
  "src/features/purchaseOrders/ProviderSelector.jsx",
  "utf8"
);
const historySource = fs.readFileSync("src/pages/PurchaseOrdersPage.jsx", "utf8");
const purchaseOrderCssSource = fs.readFileSync(
  "src/features/purchaseOrders/purchase-orders.css",
  "utf8"
);
assert.match(backendSource, /transaction\.getAll/);
assert.match(backendSource, /purchaseOrderCreateRequests/);
assert.match(backendSource, /purchaseOrderCounters/);
assert.match(backendSource, /providerSnapshotFromDocument/);
assert.match(backendSource, /inventorySnapshotFromDocument/);
assert.match(rulesSource, /match \/ordenesCompra\/\{ordenCompraId\}/);
assert.match(rulesSource, /allow create, update, delete: if false/);
assert.match(pageSource, /PurchaseOrderPrintView/);
assert.doesNotMatch(pageSource, /Quote[A-Z]/);
assert.match(providerSelectorSource, /isHistorical \? originalSnapshot : selected/);
assert.match(historySource, /po-history__cards/);
assert.match(historySource, /<OrderActions/);
assert.match(purchaseOrderCssSource, /@media\(max-width:767px\)/);
assert.doesNotMatch(purchaseOrderCssSource, /po-history__table\{min-width:800px\}/);
console.log("OK integración estática: persistencia, reglas, vista imprimible y desacoplamiento");

console.log("PURCHASE_ORDERS_MODEL_SMOKE_OK");
