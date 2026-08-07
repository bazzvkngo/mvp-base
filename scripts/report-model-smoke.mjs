import assert from "node:assert/strict";
import {
  buildReportCsv,
  combineOperationalTimelines,
  filterInventoryMovements,
  filterQuotes,
  filterSales,
  getInventoryMetrics,
  getPurchaseMetrics,
  getQuoteMetrics,
  getSalesMetrics,
  getRecentOperationalActivity,
  normalizeInventoryMovement,
} from "../src/domain/reportModel.mjs";

const range = {start: "2026-08-01", end: "2026-08-31", days: 31};

const sales = [
  {id: "v1", numero: "VTA-2026-0001", fechaVenta: "2026-08-02", estado: "confirmada", total: 1000, clienteId: "c1", clienteSnapshot: {nombreRazonSocial: "Cliente; Uno", rut: "1-9"}},
  {id: "v2", numero: "VTA-2026-0002", fechaVenta: "2026-08-03", estado: "confirmada", total: 3000, clienteId: "c1", clienteSnapshot: {nombreRazonSocial: "Cliente Uno", rut: "1-9"}},
  {id: "v3", numero: "VTA-2026-0003", fechaVenta: "2026-08-04", estado: "borrador", total: 9000, clienteId: "c2", clienteSnapshot: {nombreRazonSocial: "Cliente Dos", rut: "2-7"}},
  {id: "v4", numero: "VTA-2026-0004", fechaVenta: "2026-08-05", estado: "cancelada", total: 8000, clienteId: "c3", clienteSnapshot: {nombreRazonSocial: "Cliente Tres", rut: "3-5"}},
  {id: "v5", numero: "VTA-2026-0005", fechaVenta: "2026-07-31", estado: "confirmada", total: 7000, clienteId: "c4", clienteSnapshot: {nombreRazonSocial: "Fuera", rut: "4-3"}},
];
const salesMetrics = getSalesMetrics(sales, range);
assert.equal(salesMetrics.count, 2);
assert.equal(salesMetrics.total, 4000);
assert.equal(salesMetrics.average, 2000);
assert.equal(salesMetrics.distinctCustomers, 1);
assert.equal(filterSales(sales, {range, status: "borrador"}).length, 1);

const purchases = [
  {fechaCompra: "2026-08-06", estado: "confirmada", total: 2000, proveedorId: "p1"},
  {fechaCompra: "2026-08-07", estado: "confirmada", total: 4000, proveedorId: "p2"},
  {fechaCompra: "2026-08-08", estado: "cancelada", total: 10000, proveedorId: "p3"},
];
const purchaseMetrics = getPurchaseMetrics(purchases, range);
assert.equal(purchaseMetrics.count, 2);
assert.equal(purchaseMetrics.total, 6000);
assert.equal(purchaseMetrics.average, 3000);
assert.equal(purchaseMetrics.distinctProviders, 2);

const quotes = [
  {numero: "COT-1", fecha: "2026-08-01", estado: "aceptada", total: 5000, clienteNombre: "A"},
  {numero: "COT-2", fecha: "2026-08-02", estado: "rechazada", total: 3000, clienteNombre: "B"},
  {numero: "COT-3", fecha: "2026-08-03", estado: "emitida", total: 2000, clienteNombre: "C"},
  {numero: "COT-4", fecha: "2026-07-31", estado: "vencida", total: 1000, clienteNombre: "D"},
];
const quoteMetrics = getQuoteMetrics(quotes, range);
assert.equal(quoteMetrics.count, 3);
assert.equal(quoteMetrics.counts.aceptada, 1);
assert.equal(quoteMetrics.amounts.rechazada, 3000);
assert.equal(quoteMetrics.conversion, 50);
assert.equal(getQuoteMetrics([{fecha: "2026-08-01", estado: "emitida"}], range).conversion, null);
assert.equal(filterQuotes(quotes, {range, status: "emitida"}).length, 1);

const inventoryMetrics = getInventoryMetrics([
  {id: "i1", tipoItem: "producto", estado: "activo", stock: 2, stockMinimo: 3, costoBase: 100},
  {id: "i2", tipoItem: "producto", estado: "activo", stock: 4, stockMinimo: 1, costoBase: 0},
  {id: "i3", tipoItem: "servicio", estado: "activo", costoBase: 500},
]);
assert.equal(inventoryMetrics.activeProducts.length, 2);
assert.equal(inventoryMetrics.lowStockProducts.length, 1);
assert.equal(inventoryMetrics.coverage, 50);
assert.equal(inventoryMetrics.inventoryValue, null);

const purchaseMovement = normalizeInventoryMovement({
  movimientoId: "m1",
  tipo: "entrada_compra",
  nombre: "Producto A",
  cantidad: 2,
  compraNumero: "COM-2026-0001",
  creadoEn: {toDate: () => new Date("2026-08-10T15:00:00Z")},
});
const saleMovement = normalizeInventoryMovement({
  movimientoId: "m2",
  tipo: "salida_venta",
  nombre: "Producto B",
  cantidad: 1,
  ventaNumero: "VTA-2026-0001",
  createdAt: {seconds: Date.parse("2026-08-11T15:00:00Z") / 1000},
});
assert.equal(purchaseMovement.date, "2026-08-10");
assert.equal(saleMovement.date, "2026-08-11");
assert.equal(filterInventoryMovements([purchaseMovement, saleMovement], {range, type: "salida_venta"}).length, 1);

const salesCsv = buildReportCsv("sales", {items: sales.slice(0, 1)});
assert.match(salesCsv, /"Número";"Fecha";"Cliente"/);
assert.match(salesCsv, /"Cliente; Uno"/);
const inventoryCsv = buildReportCsv("inventory", {items: [purchaseMovement]});
assert.match(inventoryCsv, /"Documento\/origen"/);
assert.match(inventoryCsv, /"entrada_compra"/);

const activity = getRecentOperationalActivity(
  sales,
  [
    {id: "p1", numero: "COM-2026-0001", fechaCompra: "2026-08-09", estado: "confirmada", total: 2500, proveedorSnapshot: {razonSocial: "Proveedor Uno"}},
    {id: "p2", numero: "COM-2026-0002", fechaCompra: "2026-08-10", estado: "borrador", total: 9999, proveedorSnapshot: {razonSocial: "No sumar"}},
  ],
  range,
  5
);
assert.deepEqual(activity.map((item) => item.number), ["COM-2026-0001", "VTA-2026-0002", "VTA-2026-0001"]);
assert.equal(activity[0].route, "/compras/p1");
assert.equal(activity[1].route, "/ventas/v2");
assert.equal(getRecentOperationalActivity([], [], range).length, 0);

assert.deepEqual(
  combineOperationalTimelines(
    [{key: "2026-08-01", value: 1000}],
    [{key: "2026-08-02", value: 500}, {key: "2026-08-01", value: 300}]
  ),
  [
    {key: "2026-08-01", sales: 1000, purchases: 300},
    {key: "2026-08-02", sales: 0, purchases: 500},
  ]
);
assert.deepEqual(combineOperationalTimelines([], []), []);

console.log("Report model smoke: OK");
