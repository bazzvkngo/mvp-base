import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import {createServer} from "vite";
import {
  REPORT_TABS,
  aggregateOperationalTimeline,
  buildReportCsv,
  combineOperationalTimelines,
  filterInventoryAcquisitions,
  filterInventoryMovements,
  filterQuotes,
  filterSales,
  filterWorkCosts,
  groupAmountsByCurrency,
  getInventoryMetrics,
  getProjectProfitabilitySummary,
  getProjectResultMetrics,
  getPurchaseMetrics,
  getQuoteMetrics,
  getSalesMetrics,
  getRecentOperationalActivity,
  getSimplifiedReportSummary,
  getTopPurchaseProducts,
  getTopPurchaseSuppliers,
  getTopSalesClients,
  getTopSalesProducts,
  normalizeInventoryMovement,
  normalizeInventoryAcquisition,
  normalizeWorkCost,
  resolveReportCurrency,
} from "../src/domain/reportModel.mjs";
import {calculateOperationalNetProfit, OPERATIONAL_PROJECT_EXCLUSION} from "../src/domain/operationalNetProfit.mjs";
import {
  INCOMPLETE_PROJECT_REASONS,
  MONTHLY_EXPLANATIONS,
  NO_MARGIN_TEXT,
  NO_PREVIOUS_MONTH_TEXT,
  PROJECT_RESULT_STATUS,
  buildMonthlyProjectResults,
  buildMonthlySummaryGroups,
  buildProfitNoticeLines,
  buildServicesWithoutProjectNotices,
  describeProfitMargin,
  listIncompleteMonthlyProjects,
  scaleProjectBars,
  projectResultLabel,
  canShowNextMonth,
  compareWithPreviousMonth,
  formatComparisonText,
  formatMonthLabel,
  formatMonthName,
  formatReferenceText,
  getMonthRange,
  isMonthEmpty,
  isMonthInProgress,
  normalizeMonthKey,
  shiftMonthKey,
  summarizeProfitCoverage,
} from "../src/domain/reportMonthlySummary.mjs";
import {canViewWorkProfitability} from "../src/domain/workModel.mjs";

const range = {start: "2026-08-01", end: "2026-08-31", days: 31};

assert.deepEqual(REPORT_TABS, [
  "overview",
  "commercial",
  "operations",
  "supply",
  "finances",
]);

const sales = [
  {id: "v1", numero: "VTA-2026-0001", fechaVenta: "2026-08-02", estado: "confirmada", neto: 1000, iva: 190, total: 1190, clienteId: "c1", clienteSnapshot: {nombreRazonSocial: "Cliente; Uno", rut: "1-9"}},
  {id: "v2", numero: "VTA-2026-0002", fechaVenta: "2026-08-03", estado: "confirmada", neto: 3000, iva: 570, total: 3570, clienteId: "c1", clienteSnapshot: {nombreRazonSocial: "Cliente Uno", rut: "1-9"}},
  {id: "v3", numero: "VTA-2026-0003", fechaVenta: "2026-08-04", estado: "borrador", neto: 9000, iva: 1710, total: 10710, clienteId: "c2", clienteSnapshot: {nombreRazonSocial: "Cliente Dos", rut: "2-7"}},
  {id: "v4", numero: "VTA-2026-0004", fechaVenta: "2026-08-05", estado: "cancelada", neto: 8000, iva: 1520, total: 9520, clienteId: "c3", clienteSnapshot: {nombreRazonSocial: "Cliente Tres", rut: "3-5"}},
  {id: "v5", numero: "VTA-2026-0005", fechaVenta: "2026-07-31", estado: "confirmada", neto: 7000, iva: 1330, total: 8330, clienteId: "c4", clienteSnapshot: {nombreRazonSocial: "Fuera", rut: "4-3"}},
];
const salesMetrics = getSalesMetrics(sales, range);
assert.equal(salesMetrics.count, 2);
assert.equal(salesMetrics.total, 4000);
assert.equal(salesMetrics.average, 2000);
assert.equal(salesMetrics.distinctCustomers, 1);
assert.equal(filterSales(sales, {range, status: "borrador"}).length, 1);

const currentSalesMetrics = getSalesMetrics([
  {fechaVenta: "2026-08-09", estado: "activa", neto: 2500, total: 2975, moneda: "CLP"},
  {fechaVenta: "2026-08-10", estado: "preparada", neto: 9000, total: 10710, moneda: "CLP"},
  {fechaVenta: "2026-08-11", estado: "cancelada", neto: 8000, total: 9520, moneda: "CLP"},
], range);
assert.equal(currentSalesMetrics.count, 1);
assert.equal(currentSalesMetrics.total, 2500);

const mixedSalesMetrics = getSalesMetrics([
  {...sales[0], id: "clp", moneda: "CLP", neto: 1000, total: 1190},
  {...sales[1], id: "usd", moneda: "USD", neto: 20, total: 24},
], range);
assert.equal(mixedSalesMetrics.total, null);
assert.deepEqual(mixedSalesMetrics.totalsByCurrency.map(({currency, total}) => ({currency, total})), [
  {currency: "CLP", total: 1000},
  {currency: "USD", total: 20},
]);
assert.equal(getSalesMetrics(mixedSalesMetrics.confirmed, range, {currency: "USD"}).total, 20);
assert.equal(resolveReportCurrency({}, "BOB"), "BOB");
assert.deepEqual(groupAmountsByCurrency([{amount: 5}, {amount: 7}], {amountField: "amount", fallbackCurrency: "USD"})[0], {currency: "USD", count: 2, total: 12, average: 6});

const purchases = [
  {fechaCompra: "2026-08-06", estado: "confirmada", neto: 2000, total: 2380, proveedorId: "p1"},
  {fechaCompra: "2026-08-07", estado: "confirmada", neto: 4000, total: 4760, proveedorId: "p2"},
  {fechaCompra: "2026-08-08", estado: "cancelada", neto: 10000, total: 11900, proveedorId: "p3"},
];
const purchaseMetrics = getPurchaseMetrics(purchases, range);
assert.equal(purchaseMetrics.count, 2);
assert.equal(purchaseMetrics.total, 6000);
assert.equal(purchaseMetrics.average, 3000);
assert.equal(purchaseMetrics.distinctProviders, 2);

const currentPurchaseMetrics = getPurchaseMetrics([
  {fechaCompra: "2026-08-12", estado: "activa", neto: 700, total: 833, moneda: "USD"},
  {fechaCompra: "2026-08-13", estado: "revertida", neto: 300, total: 357, moneda: "USD"},
  {fechaCompra: "2026-08-14", estado: "borrador", neto: 200, total: 238, moneda: "USD"},
], range, {currency: "USD"});
assert.equal(currentPurchaseMetrics.count, 1);
assert.equal(currentPurchaseMetrics.total, 700);

// SPEC 025 etapa 1: Ventas y Compras suman `neto` (sin IVA), nunca `total`.
const withIva = getSalesMetrics([{fechaVenta: "2026-08-02", estado: "confirmada", neto: 1000, iva: 190, total: 1190}], range);
assert.equal(withIva.total, 1000, "la venta suma neto, no total");
assert.equal(withIva.average, 1000);
// Boleta de compra (SPEC 023 §5.2): neto igual a total, iva 0; sumar neto sigue siendo lo pagado.
const mixedDocPurchases = getPurchaseMetrics([
  {fechaCompra: "2026-08-06", estado: "confirmada", tipoDocumento: "factura", neto: 10000, iva: 1900, total: 11900, moneda: "CLP"},
  {fechaCompra: "2026-08-07", estado: "confirmada", tipoDocumento: "boleta", neto: 8330, iva: 0, total: 8330, moneda: "CLP"},
], range);
assert.equal(mixedDocPurchases.total, 18330, "factura suma neto y boleta suma lo pagado");
assert.equal(mixedDocPurchases.average, 9165);
// Un documento sin neto válido nunca se sustituye por total: cuenta como operación y aporta 0.
for (const invalidNet of [undefined, null, "", "1000", Number.NaN, -500]) {
  const metrics = getSalesMetrics([
    {fechaVenta: "2026-08-02", estado: "confirmada", neto: invalidNet, total: 5000, moneda: "CLP"},
    {fechaVenta: "2026-08-03", estado: "confirmada", neto: 700, total: 833, moneda: "CLP"},
  ], range);
  assert.equal(metrics.count, 2, `neto ${String(invalidNet)}: el documento sigue contando como operación`);
  assert.equal(metrics.total, 700, `neto ${String(invalidNet)}: no se sustituye por total`);
}
assert.equal(getPurchaseMetrics([{fechaCompra: "2026-08-02", estado: "confirmada", total: 5000, moneda: "CLP"}], range).total, 0);
// Gráfico Ventas vs Compras y tops usan el mismo criterio que las tarjetas.
const netTimeline = aggregateOperationalTimeline(
  [{fechaVenta: "2026-08-02", neto: 1000, total: 1190}, {fechaVenta: "2026-08-02", total: 500}],
  {range, dateField: "fechaVenta"}
);
assert.deepEqual(netTimeline.map(({key, value, count}) => ({key, value, count})), [{key: "2026-08-02", value: 1000, count: 2}]);
assert.equal(aggregateOperationalTimeline([{fechaVenta: "2026-08-02", neto: 1000, total: 1190}], {range, dateField: "fechaVenta", amountField: "total"})[0].value, 1190);
assert.equal(
  getTopSalesClients([{...sales[0], moneda: "CLP"}, {...sales[1], moneda: "CLP"}]).find((group) => group.currency === "CLP").entries[0].total,
  4000,
  "el top de clientes suma neto"
);
// La actividad reciente muestra el total del documento, no una suma del período.
assert.equal(getRecentOperationalActivity([sales[0]], [], range)[0].amount, 1190);
const summaryCsv = buildReportCsv("summary", {sales: salesMetrics, purchases: purchaseMetrics});
assert.match(summaryCsv, /"Total vendido confirmado \(sin IVA\)"/);
assert.match(summaryCsv, /"Total comprado confirmado \(sin IVA\)"/);

const projectBalances = [
  {id: "work-1", balance: {estado: "COMPLETO", moneda: "CLP", resultado: 5000}},
  {id: "work-2", balance: {estado: "PARCIAL_SIN_VENTA", moneda: "CLP", resultado: null}},
  {id: "work-3", balance: {estado: "INCONSISTENTE_MONEDA", moneda: "USD", resultado: null}},
  {id: "work-4", balance: {estado: "COMPLETO", moneda: "USD", resultado: -25}},
];
const projectMetrics = getProjectResultMetrics(projectBalances);
assert.equal(projectMetrics.count, 2);
assert.equal(projectMetrics.total, null);
assert.deepEqual(projectMetrics.totalsByCurrency.map(({currency, total}) => ({currency, total})), [
  {currency: "CLP", total: 5000},
  {currency: "USD", total: -25},
]);
assert.deepEqual(getProjectResultMetrics(projectBalances, {accessible: false}), {
  accessible: false,
  count: 0,
  total: null,
  totalsByCurrency: [],
});

const profitability = getProjectProfitabilitySummary([
  {id: "work-a", numero: "TRB-2026-0001", balance: {estado: "COMPLETO", moneda: "CLP", valorComercial: 106559, materiales: 30000, horasHombre: 8000, gastosDirectos: 3000, gastosIndirectos: 1000, costoTotal: 42000, resultado: 64559, rentabilidadPct: 60.58}},
  {id: "work-b", numero: "TRB-2026-0002", balance: {estado: "COMPLETO", moneda: "CLP", valorComercial: 50000, materiales: 0, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: 0, resultado: 50000, rentabilidadPct: 100}},
  {id: "work-usd", balance: {estado: "COMPLETO", moneda: "USD", valorComercial: 100, materiales: 40, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: 40, resultado: 60, rentabilidadPct: 60}},
  {id: "work-partial", balance: {estado: "PARCIAL_SIN_VENTA", moneda: "CLP", costoTotal: 9000, resultado: null}},
]);
assert.equal(profitability.groups.length, 2);
const clpProfitability = profitability.groups.find((entry) => entry.currency === "CLP");
assert.equal(clpProfitability.count, 2);
assert.equal(clpProfitability.revenue, 156559);
assert.equal(clpProfitability.costs, 42000);
assert.equal(clpProfitability.result, 114559);
assert.equal(clpProfitability.materials, 30000);
assert.equal(clpProfitability.labor, 8000);
assert.equal(clpProfitability.directExpenses, 3000);
assert.equal(clpProfitability.indirectExpenses, 1000);
assert.equal(clpProfitability.margin, 73.17);
assert.deepEqual(getProjectProfitabilitySummary(projectBalances, {accessible: false}), {accessible: false, complete: [], groups: []});

const simplified = getSimplifiedReportSummary({
  sales: [{fechaVenta: "2026-08-15", estado: "activa", neto: 10000, total: 11900, moneda: "CLP"}],
  purchases: [{fechaCompra: "2026-08-16", estado: "confirmada", neto: 9000, total: 10710, moneda: "CLP"}],
  projectBalances,
  range,
});
assert.equal(simplified.currencies.find((entry) => entry.currency === "CLP").projects.total, 5000);
assert.notEqual(
  simplified.currencies.find((entry) => entry.currency === "CLP").projects.total,
  10000 - 9000
);
const emptySummary = getSimplifiedReportSummary({range, canViewProfitability: false});
assert.equal(simplified.currencies.find((entry) => entry.currency === "CLP").sales.total, 10000, "el resumen simplificado suma neto en ventas");
assert.equal(simplified.currencies.find((entry) => entry.currency === "CLP").purchases.total, 9000, "el resumen simplificado suma neto en compras");
assert.equal(emptySummary.currencies[0].sales.total, 0);
assert.equal(emptySummary.currencies[0].purchases.total, 0);
assert.equal(emptySummary.currencies[0].projects.total, null);
assert.equal(Number.isNaN(emptySummary.currencies[0].sales.total), false);

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
// Regla única de stock bajo (inventoryLowStock.mjs): mínimo 0 y stock 0 ya
// no cuenta por su mínimo; sí por el umbral general si está activo.
const zeroMinimumInventory = [
  {id: "z0", tipoItem: "producto", estado: "activo", stock: 0, stockMinimo: 0, costoBase: 10},
  {id: "z4", tipoItem: "producto", estado: "activo", stock: 4, stockMinimo: 0, costoBase: 10},
];
assert.deepEqual(getInventoryMetrics(zeroMinimumInventory).lowStockProducts, []);
assert.deepEqual(getInventoryMetrics(zeroMinimumInventory, {lowStockSettings: {alertasStockBajo: false, umbralStockBajo: 5}}).lowStockProducts, []);
assert.deepEqual(getInventoryMetrics(zeroMinimumInventory, {lowStockSettings: {alertasStockBajo: true, umbralStockBajo: 5}}).lowStockProducts.map(({id}) => id), ["z0", "z4"]);
assert.equal(inventoryMetrics.coverage, 50);
assert.equal(inventoryMetrics.inventoryValue, null);

const salesWithLines = [
  {fechaVenta: "2026-08-02", estado: "confirmada", neto: 1000, total: 1190, moneda: "CLP", clienteId: "c1", clienteSnapshot: {nombreRazonSocial: "Cliente Uno"}, items: [{itemId: "prod-1", nombre: "Producto A", cantidad: 2, totalLinea: 700}, {itemId: "prod-2", nombre: "Producto B", cantidad: 1, totalLinea: 300}]},
  {fechaVenta: "2026-08-03", estado: "confirmada", neto: 3000, total: 3570, moneda: "CLP", clienteId: "c1", clienteSnapshot: {nombreRazonSocial: "Cliente Uno"}, items: [{itemId: "prod-1", nombre: "Producto A", cantidad: 3, totalLinea: 3000}]},
  {fechaVenta: "2026-08-04", estado: "confirmada", neto: 20, total: 24, moneda: "USD", clienteId: "c2", clienteSnapshot: {nombreRazonSocial: "Cliente Dos"}, items: [{itemId: "prod-3", nombre: "Producto C", cantidad: 1, totalLinea: 20}]},
];
const topClients = getTopSalesClients(salesWithLines, {limit: 5});
const topClientsClp = topClients.find((group) => group.currency === "CLP");
assert.equal(topClientsClp.entries.length, 1);
assert.equal(topClientsClp.entries[0].name, "Cliente Uno");
assert.equal(topClientsClp.entries[0].total, 4000);
assert.equal(topClientsClp.entries[0].count, 2);
const topClientsUsd = topClients.find((group) => group.currency === "USD");
assert.equal(topClientsUsd.entries[0].total, 20);
const topProducts = getTopSalesProducts(salesWithLines, {limit: 1});
const topProductsClp = topProducts.find((group) => group.currency === "CLP");
assert.equal(topProductsClp.entries.length, 1);
assert.equal(topProductsClp.entries[0].name, "Producto A");
assert.equal(topProductsClp.entries[0].total, 3700);
assert.equal(topProductsClp.entries[0].quantity, 5);
assert.deepEqual(getTopSalesClients([]), []);

const purchasesWithLines = [
  {fechaCompra: "2026-08-06", estado: "confirmada", neto: 2000, total: 2380, moneda: "CLP", proveedorId: "p1", proveedorSnapshot: {razonSocial: "Proveedor Uno"}, items: [{itemId: "mat-1", nombre: "Material A", cantidad: 5, totalLinea: 2000}]},
  {fechaCompra: "2026-08-07", estado: "confirmada", neto: 4000, total: 4760, moneda: "CLP", proveedorId: "p2", proveedorSnapshot: {razonSocial: "Proveedor Dos"}, items: [{itemId: "mat-1", nombre: "Material A", cantidad: 10, totalLinea: 4000}]},
];
const topSuppliers = getTopPurchaseSuppliers(purchasesWithLines, {limit: 5});
const topSuppliersClp = topSuppliers.find((group) => group.currency === "CLP");
assert.equal(topSuppliersClp.entries[0].name, "Proveedor Dos");
assert.equal(topSuppliersClp.entries[0].total, 4000);
const topPurchaseProducts = getTopPurchaseProducts(purchasesWithLines, {limit: 5});
assert.equal(topPurchaseProducts.find((group) => group.currency === "CLP").entries[0].total, 6000);

assert.deepEqual(getTopSalesClients([]), []);
assert.deepEqual(getTopSalesProducts([]), []);
assert.deepEqual(getTopPurchaseSuppliers([]), []);
assert.deepEqual(getTopPurchaseProducts([]), []);
console.log("OK reportes v5: estado sin datos (ventas/compras vacías) no rompe ningún agregador nuevo");
console.log("OK reportes v5: top clientes/productos de ventas y top proveedores/productos de compras por moneda, sin mezclar monedas");

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

const acquisition = normalizeInventoryAcquisition({
  adquisicionId: "a1",
  movimientoInventarioId: "m3",
  fechaAdquisicion: "2026-08-12",
  cantidad: 3,
  costoPagadoUnitario: 120,
  costoPagadoTotal: 360,
  moneda: "USD",
  proveedorId: "provider-1",
  proveedorSnapshot: {razonSocial: "Proveedor trazable"},
  productoSnapshot: {nombre: "Producto recepción", unidad: "unidad"},
  ordenCompraNumero: "OC-1",
  recepcionNumero: "REC-1",
  compraNumero: "COM-1",
  registradoPorUid: "owner-1",
});
const receptionMovement = normalizeInventoryMovement({
  movimientoId: "m3",
  tipo: "entrada_recepcion",
  recepcionId: "rec-1",
  recepcionNumero: "REC-1",
  cantidad: 3,
  costoTotal: 360,
  moneda: "USD",
  creadoPorUid: "owner-1",
  creadoEn: {toDate: () => new Date("2026-08-12T15:00:00Z")},
}, {acquisition});
const projectExit = normalizeInventoryMovement({
  movimientoId: "m4",
  tipo: "SALIDA_PROYECTO",
  trabajoId: "work-1",
  cantidad: 1,
  costoTotal: 120,
  moneda: "USD",
  fecha: "2026-08-13",
  productoSnapshot: {nombre: "Producto recepción", unidad: "unidad"},
  usuarioUid: "tech-1",
}, {work: {numero: "TRB-1", titulo: "Proyecto trazable"}});
assert.equal(receptionMovement.direction, "ENTRADA");
assert.equal(receptionMovement.providerName, "Proveedor trazable");
assert.equal(receptionMovement.sourceType, "recepcion");
assert.equal(projectExit.direction, "SALIDA");
assert.equal(projectExit.projectNumber, "TRB-1");
assert.equal(filterInventoryMovements([receptionMovement, projectExit], {range, type: "ENTRADA", providerId: "provider-1", currency: "USD"}).length, 1);
assert.equal(filterInventoryAcquisitions([acquisition], {range, providerId: "provider-1", currency: "USD"}).length, 1);
assert.equal(normalizeInventoryAcquisition({fechaAdquisicion: "2026-08-12"}, {fallbackCurrency: "BOB"}).currency, "BOB");

const expense = normalizeWorkCost({id: "g1", trabajoId: "work-1", fecha: "2026-08-14", concepto: "Traslado", categoria: "OPERATIVO", monto: 40, moneda: "USD", estado: "vigente", registradoPorUid: "tech-1"}, {kind: "GASTO", work: {id: "work-1", numero: "TRB-1"}});
const labor = normalizeWorkCost({id: "h1", trabajoId: "work-1", fecha: "2026-08-15", concepto: "Diagnóstico", horas: 2, total: 60, moneda: "USD", estado: "vigente", tecnicoUid: "tech-1"}, {kind: "HH", work: {id: "work-1", numero: "TRB-1"}});
assert.deepEqual(filterWorkCosts([expense, labor], {range, projectId: "work-1", userId: "tech-1", currency: "USD"}).map((entry) => entry.kind), ["HH", "GASTO"]);
assert.equal(canViewWorkProfitability("MEMBER"), false);
assert.equal(canViewWorkProfitability("ADMIN"), true);

const salesCsv = buildReportCsv("sales", {items: sales.slice(0, 1)});
assert.match(salesCsv, /"Número";"Fecha";"Cliente"/);
assert.match(salesCsv, /"Cliente; Uno"/);
const inventoryCsv = buildReportCsv("inventory", {items: [purchaseMovement]});
assert.match(inventoryCsv, /"Documento\/origen"/);
assert.match(inventoryCsv, /"entrada_compra"/);
const commercialCsv = buildReportCsv("commercial", {
  sales: sales.slice(0, 1),
  quotes: quotes.slice(0, 1),
});
assert.match(commercialCsv, /"Tipo";"Número";"Fecha";"Cliente"/);
assert.match(commercialCsv, /"Venta"/);
assert.match(commercialCsv, /"Cotización"/);
const supplyCsv = buildReportCsv("supply", {
  purchases: purchases.slice(0, 1),
  purchaseOrders: [{numero: "OC-1", fechaEmision: "2026-08-09", estado: "emitida", moneda: "USD", total: 20}],
  receptions: [{numero: "REC-1", fechaRecepcion: "2026-08-10", estado: "borrador"}],
});
assert.match(supplyCsv, /"Orden de compra"/);
assert.match(supplyCsv, /"Recepción"/);

const activity = getRecentOperationalActivity(
  sales,
  [
    {id: "p1", numero: "COM-2026-0001", fechaCompra: "2026-08-09", estado: "confirmada", neto: 2101, total: 2500, proveedorSnapshot: {razonSocial: "Proveedor Uno"}},
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
    {key: "2026-08-01", currency: "CLP", sales: 1000, purchases: 300},
    {key: "2026-08-02", currency: "CLP", sales: 0, purchases: 500},
  ]
);
assert.deepEqual(combineOperationalTimelines([], []), []);

const reportPageSource = readFileSync("src/pages/StatisticsPage.jsx", "utf8");
const reportServiceSource = readFileSync("src/services/reportService.js", "utf8");
const reportsNavSource = readFileSync("src/features/reports/ReportsNav.jsx", "utf8");
const ventasViewSource = readFileSync("src/features/reports/views/ReportsVentasView.jsx", "utf8");
const comprasViewSource = readFileSync("src/features/reports/views/ReportsComprasView.jsx", "utf8");
const gananciasViewSource = readFileSync("src/features/reports/views/ReportsGananciasView.jsx", "utf8");
const operationalChartSource = readFileSync("src/components/reports/OperationalComparisonChart.jsx", "utf8");
const costCompositionSource = readFileSync("src/components/reports/CostCompositionChart.jsx", "utf8");

// Gráficos y servicio compartidos: sin cambios en SPEC 022. Van antes de las
// aserciones de las vistas para seguir corriendo aunque éstas fallen.
assert.match(operationalChartSource, /<Bar/);
assert.doesNotMatch(operationalChartSource, /operational-comparison-single/);
assert.match(operationalChartSource, /maxBarThickness: items\.length === 1 \? 36 : 24/);
assert.match(operationalChartSource, /animation: false/);
assert.match(operationalChartSource, /formatCompactMoney/);
assert.match(costCompositionSource, /<Doughnut/);
assert.match(costCompositionSource, /animation: false/);
assert.match(costCompositionSource, /formatMoney\(context\.parsed, currency, businessLocale\)/);
assert.match(costCompositionSource, /formatMoney\(total, currency, businessLocale\)/);
assert.match(reportServiceSource, /BUSINESS_PERMISSIONS\.PROFITABILITY_READ/);
assert.match(reportServiceSource, /canViewProfitability \? listarTrabajos/);

// SPEC 022 Etapa 3: un archivo que la Parte B debe crear se exige con un
// mensaje explícito, en vez de dejar caer un ENOENT.
function readRequiredSource(path, purpose) {
  assert.ok(existsSync(path), `SPEC 022: falta ${path} (${purpose})`);
  return readFileSync(path, "utf8");
}

// SPEC 022 §6.1 y SPEC 025 etapa 3: el Resumen es la primera pestaña y las
// cuatro de detalle siguen; Inventario y Proyectos dejaron de serlo. Siguen
// compartiendo período/moneda por query param.
assert.deepEqual(
  [...reportsNavSource.matchAll(/id: "(\w+)"/g)].map((match) => match[1]),
  ["resumen", "ventas", "compras", "ganancias"]
);
// SPEC 025 §3.1: la pestaña se llama "Ganancia" y "Rentabilidad y estado" ya no existe.
assert.match(reportsNavSource, /{id: "ganancias", label: "Ganancia", permission: "canViewProfitability"}/);
assert.doesNotMatch(reportsNavSource.replace(/\/\/.*$/gm, ""), /Rentabilidad y estado/);
assert.match(reportsNavSource, /DEFAULT_REPORT_VIEW_ID = "resumen"/);
assert.match(reportPageSource, /searchParams\.get\("vista"\)/);
assert.match(reportPageSource, /<ReportsNav active=\{vista\} onSelect=\{goToView\}/);
assert.match(reportPageSource, /searchParams\.get\("period"\)/);
assert.match(reportPageSource, /searchParams\.get\("currency"\)/);
assert.match(reportPageSource, /Consulta rentabilidad, ventas, compras y ganancias en un solo lugar\./);
assert.match(reportPageSource, /canAccessBusinessPath\(role, "\/ventas"\)/);
assert.match(reportPageSource, /canAccessBusinessPath\(role, "\/compras"\)/);
assert.match(reportPageSource, /canAccessBusinessPath\(role, "\/trabajos"\)/);

// SPEC 022 §6.1: las URL legacy redirigen sin dejar ningún perfil en una
// vista vacía. Sin profitability.read se cae a la primera pestaña permitida.
const navVite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const {normalizeReportView} = await navVite.ssrLoadModule("/src/features/reports/ReportsNav.jsx");
  const fullAccess = {canViewProfitability: true, canViewSales: true, canViewPurchases: true};
  const salesOnly = {canViewProfitability: false, canViewSales: true, canViewPurchases: false};
  const purchasesOnly = {canViewProfitability: false, canViewSales: false, canViewPurchases: true};
  // SPEC 025 §3.1: ?vista=rentabilidad (y las retiradas inventario/proyectos)
  // abren Ganancia; sin permiso de ganancia caen al resumen.
  for (const legacy of ["rentabilidad", "inventario", "proyectos"]) {
    assert.equal(normalizeReportView(legacy, fullAccess), "ganancias", `${legacy} abre Ganancia`);
    assert.equal(normalizeReportView(legacy, salesOnly), "resumen", `${legacy} sin permiso de ganancia cae al resumen`);
    assert.equal(normalizeReportView(legacy, purchasesOnly), "resumen", `${legacy} sin permiso de ganancia cae al resumen`);
  }
  // SPEC 025 etapa 3: el resumen es la vista por defecto y ningún perfil queda
  // en una pestaña que no puede abrir.
  assert.equal(normalizeReportView(null, fullAccess), "resumen", "la vista inicial es el resumen");
  assert.equal(normalizeReportView(undefined, salesOnly), "resumen");
  assert.equal(normalizeReportView("desconocida", fullAccess), "resumen");
  assert.equal(normalizeReportView("resumen", purchasesOnly), "resumen", "el resumen no exige permisos de informe");
  for (const view of ["resumen", "ventas", "compras", "ganancias"]) {
    assert.equal(normalizeReportView(view, fullAccess), view, `${view} es una vista válida`);
  }
  for (const restricted of ["rentabilidad", "ganancias"]) {
    assert.equal(normalizeReportView(restricted, salesOnly), "resumen", `${restricted} exige profitability.read`);
  }
  assert.equal(normalizeReportView("ventas", purchasesOnly), "resumen", "ventas exige sales.read");
} finally {
  await navVite.close();
}

// SPEC 025 §3.1: "Rentabilidad y estado" se eliminó (repetía Ganancia). Su
// "Estado del sistema" vive al final de Ganancia y solo con alertas. Reportes
// ya no carga inventario ni renderiza Resumen, Inventario o Proyectos.
assert.equal(existsSync("src/features/reports/views/ReportsRentabilidadView.jsx"), false, "la vista Rentabilidad y estado debe estar eliminada");
assert.doesNotMatch(reportPageSource, /ReportsRentabilidadView|vista === "rentabilidad"/);
assert.doesNotMatch(reportPageSource, /<OperationalComparisonChart/);
assert.doesNotMatch(reportPageSource, /<ReportsResumenView|<ReportsInventarioView|<ReportsProyectosView/);
// SPEC 025 etapa 4: las tres vistas huérfanas y sus tarjetas compartidas ya no existen.
for (const removed of [
  "src/features/reports/views/ReportsResumenView.jsx",
  "src/features/reports/views/ReportsInventarioView.jsx",
  "src/features/reports/views/ReportsProyectosView.jsx",
  "src/features/reports/ReportsSharedCards.jsx",
]) {
  assert.equal(existsSync(removed), false, `${removed} debe estar eliminado`);
}
assert.equal(typeof (await import("../src/domain/reportModel.mjs")).getInventoryTopValueProducts, "undefined");
assert.equal(typeof (await import("../src/domain/reportModel.mjs")).getInventoryCategoryDistribution, "undefined");
assert.doesNotMatch(reportPageSource, /getInventoryItems\(/);

// Ventas y Compras: cada subvista es exclusiva de su dominio. El gráfico
// Ventas vs Compras vive en Compras con la nota "no es ganancia" (§6.3) y la
// tarjeta de margen comercial sale de Ventas (§6.4).
assert.doesNotMatch(ventasViewSource, /<SalesCommercialMarginV4Card/);
assert.match(ventasViewSource, /topSalesClients/);
assert.match(ventasViewSource, /topSalesProducts/);
assert.equal((comprasViewSource.match(/<OperationalComparisonChart/g) || []).length, 1);
assert.match(comprasViewSource, /Comparar ventas y compras no es ganancia/);
assert.doesNotMatch(comprasViewSource.replace(/no es ganancia/g, ""), /[Gg]anancia/);
assert.doesNotMatch(comprasViewSource, /margenBrutoProductosCubiertos/);
assert.match(comprasViewSource, /Las compras muestran egresos registrados del negocio/);
// SPEC 025 etapa 1: los montos de Ventas y Compras van sin IVA.
assert.match(comprasViewSource, /ambos montos van sin IVA/);
assert.doesNotMatch(comprasViewSource, /incluyen IVA/);
assert.match(comprasViewSource, /<th>Neto<\/th><th>Total<\/th>/);
assert.match(ventasViewSource, /<th>Neto<\/th><th>Total<\/th>/);
assert.match(comprasViewSource, /topPurchaseSuppliers/);
assert.match(comprasViewSource, /topPurchaseProducts/);

// Ganancia: la única suma permitida es la ganancia, que llega calculada desde
// el helper de dominio; la vista no suma bloques. SPEC 025 §3.1: sin tarjeta de
// margen comercial ni gráficos de margen por cliente o producto; queda la
// evolución mensual y, al final, el estado del sistema solo con alertas.
assert.match(gananciasViewSource, /<OperationalNetProfitBreakdown/);
assert.match(gananciasViewSource, /<MonthlyOperationalProfitChart/);
assert.doesNotMatch(gananciasViewSource, /<SalesCommercialMarginV4Card|Análisis de margen comercial|<RankedMarginChart|Margen por cliente|Margen bruto por producto|buildClientOperationalProfit|buildProductGrossMargin/);
assert.match(gananciasViewSource, /\{hasAlerts && <section[\s\S]*?<h2>Estado del sistema<\/h2>[\s\S]*?<OperationalSystemStatus/);
assert.ok(gananciasViewSource.indexOf("<OperationalSystemStatus") > gananciasViewSource.indexOf("<MonthlyOperationalProfitChart"), "el estado del sistema va al final de Ganancia");
// SPEC 022 §6.5 (decisión del dueño): "Ganancias por Proyectos" y
// ProjectProfitabilityV4Summary salen de esta pestaña.
assert.doesNotMatch(gananciasViewSource, /Ganancias por Proyectos/);
assert.doesNotMatch(gananciasViewSource, /<ProjectProfitabilityV4Summary/);
assert.doesNotMatch(gananciasViewSource, /[Tt]otal de ganancias|ganancia neta(?! operacional)|utilidad neta/i);
assert.doesNotMatch(gananciasViewSource, /Ganancia neta operacional/);
// SPEC 025 §3.1: rótulos en lenguaje simple, sin jerga, en el desglose y el gráfico.
{
  const breakdownSource = readFileSync("src/features/reports/OperationalNetProfitBreakdown.jsx", "utf8");
  const profitChartsSource = readFileSync("src/components/reports/OperationalProfitCharts.jsx", "utf8");
  const visibleBreakdown = breakdownSource.replace(/\/\/.*$/gm, "");
  for (const jargon of [/Ganancia neta operacional/, /Sobre ingreso neto considerado/, /Ingreso neto de productos/, /Costo histórico de productos/, /Margen bruto de productos/, /Margen Comercial V1/]) {
    assert.doesNotMatch(visibleBreakdown, jargon, `el desglose no debe mostrar ${jargon}`);
    assert.doesNotMatch(gananciasViewSource, jargon);
    assert.doesNotMatch(reportPageSource, jargon);
  }
  assert.doesNotMatch(profitChartsSource, /Ganancia neta operacional|Margen de ventas sin proyecto/);
  for (const label of ['"Ganancia (parcial)"', '"Ganancia"', "Margen sobre ventas", '"Ventas de productos (sin IVA)"', '"Costo de lo vendido"', '"Ganancia por productos"', '"Resultado de proyectos"']) {
    assert.ok(breakdownSource.includes(label), `el desglose debe usar ${label}`);
  }
  const reportsCss = readFileSync("src/styles/interior.css", "utf8");
  assert.match(reportsCss, /\.reports-plain-headings \.reports-top-list-table th,[\s\S]*?text-transform: none;/);
  assert.match(gananciasViewSource, /reports-plain-headings/);
}
// Ventas y Compras: solo total y cantidad, sin tarjetas de promedio.
assert.doesNotMatch(ventasViewSource, /Ticket promedio/);
assert.doesNotMatch(comprasViewSource, /Monto promedio/);
// Encabezado: selector "Moneda" y su nota solo con dos o más monedas cargadas.
assert.match(reportPageSource, /const showCurrencyControls = loadedCurrencies\.size > 1 \|\| selectedCurrency !== "todos";/);
assert.match(reportPageSource, /\{showCurrencyControls && <label className="erp-field reports-simple-currency">/);
assert.match(reportPageSource, /\{showCurrencyControls && <p className="reports-simple-help">Las monedas se muestran por separado y no se convierten\.<\/p>\}/);
assert.doesNotMatch(gananciasViewSource, /commercial\.bloque.*\+.*projects\.bloque|projects\.bloque.*\+.*commercial\.bloque/);
console.log("OK reportes SPEC 022/025: pestañas Resumen, Ventas, Compras y Ganancia; ?vista=rentabilidad abre Ganancia; gráfico en Compras; rótulos sin jerga");

// SPEC 025 etapa 3: resumen mensual.
const monthlyPageSource = reportPageSource;
const monthlyViewSource = readRequiredSource("src/features/reports/views/ReportsMonthlySummary.jsx", "resumen mensual, SPEC 025 §3");
const dashboardSource = readFileSync("src/pages/DashboardPage.jsx", "utf8");

// El resumen es la vista por defecto y solo se pinta cuando la carga terminó
// sin error: un fallo de carga muestra su propio error, nunca el vacío.
assert.match(monthlyPageSource, /vista === DEFAULT_REPORT_VIEW_ID/);
assert.match(monthlyPageSource, /\{error && <div[^>]*role="alert"[^>]*>[\s\S]*?Reintentar/);
const pageStatesStart = monthlyPageSource.indexOf("{!loading && !error && <>");
assert.ok(pageStatesStart > 0);
assert.ok(monthlyPageSource.slice(pageStatesStart).includes("<ReportsMonthlySummary"), "el resumen vive dentro de !loading && !error");
assert.equal(monthlyPageSource.slice(0, pageStatesStart).includes("<ReportsMonthlySummary"), false);
assert.match(monthlyPageSource, /loading && !error && <LoadingState/);
assert.match(monthlyPageSource, /profitFetchRange/);
// Un fallo de la ganancia es un error propio (alerta + reintentar) y el vacío
// solo se declara con la ganancia lista.
assert.match(monthlyViewSource, /profit\.status === "error"[\s\S]*?role="alert"[\s\S]*?Reintentar/);
assert.match(monthlyViewSource, /<LoadingState variant="inline"/);
assert.match(monthlyViewSource, /isMonthEmpty\(groups\) && <div[\s\S]*?Aún no hay ventas confirmadas este mes/);
assert.equal((monthlyViewSource.match(/Aún no hay ventas confirmadas este mes/g) || []).length, 1);
assert.match(monthlyViewSource, /"\/ventas\/nueva"/);
assert.match(monthlyViewSource, /"\/compras\/nueva"/);
// Cada tarjeta se oculta por su permiso; Ganancia exige PROFITABILITY_READ.
assert.match(monthlyViewSource, /canViewSales && <MonthlyCard/);
assert.match(monthlyViewSource, /canViewPurchases && <MonthlyCard/);
assert.match(monthlyViewSource, /canViewProfitability && group\.profit && <MonthlyCard/);
assert.match(monthlyPageSource, /canViewProfitability = hasBusinessPermission\(role, BUSINESS_PERMISSIONS\.PROFITABILITY_READ\)/);
assert.match(monthlyPageSource, /canRegisterSale = hasBusinessPermission\(role, BUSINESS_PERMISSIONS\.SALES_WRITE\)/);
assert.match(monthlyPageSource, /canRegisterPurchase = hasBusinessPermission\(role, BUSINESS_PERMISSIONS\.PURCHASES_WRITE\)/);
// Textos exactos de la SPEC §3.
assert.equal(MONTHLY_EXPLANATIONS.sales, "Confirmadas, sin IVA.");
assert.equal(MONTHLY_EXPLANATIONS.purchases, "Confirmadas, sin IVA. Incluye stock aún no vendido.");
assert.equal(MONTHLY_EXPLANATIONS.profit, "Lo vendido menos su costo, más lo que dejaron los proyectos.");
// Resumen: cobertura solo como aviso parcial, "Ver detalle" dentro de cada tarjeta
// y una sola línea cuando ningún mes anterior tiene base.
assert.doesNotMatch(monthlyViewSource, /Cobertura completa/);
assert.doesNotMatch(monthlyViewSource, /reports-month-links|Ver detalle de ventas|Ver detalle de compras|Ver detalle de ganancia/);
assert.match(monthlyViewSource, /onOpenDetail && <Button type="button" variant="ghost" className="reports-month-card-link"[^>]*>Ver detalle<\/Button>/);
assert.match(monthlyViewSource, /onOpenDetail=\{links\.sales \? \(\) => onOpenDetail\("ventas"\) : null\}/);
assert.match(monthlyViewSource, /onOpenDetail=\{links\.purchases \? \(\) => onOpenDetail\("compras"\) : null\}/);
assert.match(monthlyViewSource, /onOpenDetail=\{\(\) => onOpenDetail\("ganancias"\)\}/);
assert.match(monthlyViewSource, /\{hasCards && !showComparison && <p className="reports-month-no-previous">\{NO_PREVIOUS_MONTH_TEXT\}<\/p>\}/);
assert.doesNotMatch(monthlyViewSource, /onOpenDetail\("rentabilidad"\)/);
assert.equal(NO_PREVIOUS_MONTH_TEXT, "Sin datos del mes anterior para comparar");
// Dashboard: rótulos sin IVA (sus cálculos no cambian).
assert.match(dashboardSource, /label="Total vendido \(sin IVA\)"/);
assert.match(dashboardSource, /label="Total comprado \(sin IVA\)"/);
assert.match(dashboardSource, /Evolución operacional \(sin IVA\)/);

// Meses.
const today = "2026-10-15";
assert.equal(normalizeMonthKey(undefined, today), "2026-10");
assert.equal(normalizeMonthKey("2026-09", today), "2026-09");
for (const invalid of ["2026-11", "2027-01", "2026-13", "2026-00", "septiembre", "2026-9", ""]) {
  assert.equal(normalizeMonthKey(invalid, today), "2026-10", `${invalid} cae al mes actual`);
}
assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
assert.equal(canShowNextMonth("2026-10", today), false, "no se pasa del mes actual");
assert.equal(canShowNextMonth("2026-09", today), true);
assert.deepEqual(getMonthRange("2026-02"), {start: "2026-02-01", end: "2026-02-28", days: 28, period: "month"});
assert.equal(getMonthRange("2028-02").end, "2028-02-29");
assert.equal(formatMonthLabel("2026-10"), "Octubre de 2026");

// Comparación: sin base no hay porcentaje.
assert.deepEqual(compareWithPreviousMonth(150, 100), {hasBase: true, percent: 50, direction: "up"});
assert.deepEqual(compareWithPreviousMonth(80, 100), {hasBase: true, percent: -20, direction: "down"});
assert.deepEqual(compareWithPreviousMonth(100, 100), {hasBase: true, percent: 0, direction: "flat"});
assert.deepEqual(compareWithPreviousMonth(-50, -100), {hasBase: true, percent: 50, direction: "up"});
for (const before of [0, null, undefined, Number.NaN, "100"]) {
  assert.deepEqual(compareWithPreviousMonth(100, before), {hasBase: false, percent: null, direction: "none"});
}
assert.equal(formatComparisonText(compareWithPreviousMonth(100, 0)), NO_PREVIOUS_MONTH_TEXT);
assert.equal(formatComparisonText(compareWithPreviousMonth(150, 100)), "50 % más que el mes anterior");
assert.equal(formatComparisonText(compareWithPreviousMonth(80, 100)), "20 % menos que el mes anterior");
assert.equal(formatComparisonText(compareWithPreviousMonth(100, 100)), "Sin variación frente al mes anterior");

// Tarjetas: ventas y compras salen de reportModel (neto), la ganancia de operationalNetProfit.
const monthRangeOctober = getMonthRange("2026-10");
const monthRangeSeptember = getMonthRange("2026-09");
const monthlySales = [
  {fechaVenta: "2026-10-03", estado: "confirmada", neto: 3000, total: 3570, moneda: "CLP"},
  {fechaVenta: "2026-09-10", estado: "confirmada", neto: 2000, total: 2380, moneda: "CLP"},
  {fechaVenta: "2026-10-05", estado: "cancelada", neto: 9000, total: 10710, moneda: "CLP"},
];
const monthlyPurchases = [
  {fechaCompra: "2026-10-04", estado: "confirmada", neto: 1000, total: 1190, moneda: "CLP"},
  {fechaCompra: "2026-10-06", estado: "confirmada", total: 5000, moneda: "CLP"},
];
const monthlySummaryOf = (range, salesList = monthlySales, purchasesList = monthlyPurchases) =>
  getSimplifiedReportSummary({sales: salesList, purchases: purchasesList, projectBalances: [], range});
const readyProfit = (amount, coverage = "COMPLETA") => ({
  status: "ready",
  error: "",
  result: {grupos: [{moneda: "CLP", gananciaNetaOperacional: amount, cobertura: coverage}]},
});
const octoberSummary = monthlySummaryOf(monthRangeOctober);
assert.equal(octoberSummary.sales.withoutNetCount, 0);
assert.equal(octoberSummary.purchases.withoutNetCount, 1, "una compra sin neto válido aporta 0 y se avisa");
const [withData] = buildMonthlySummaryGroups({
  summary: octoberSummary,
  previousSummary: monthlySummaryOf(monthRangeSeptember),
  profit: readyProfit(500),
  previousProfit: readyProfit(300),
});
assert.equal(withData.sales.total, 3000);
assert.deepEqual(withData.sales.comparison, {hasBase: true, percent: 50, direction: "up"});
assert.equal(withData.purchases.total, 1000, "las compras suman neto y la compra sin neto aporta 0");
assert.equal(withData.purchases.comparison.hasBase, false, "sin compras el mes anterior no hay porcentaje");
assert.equal(withData.profit.amount, 500);
assert.equal(withData.profit.coverage, "complete");
assert.deepEqual(withData.profit.comparison, {hasBase: true, percent: 66.7, direction: "up"});
assert.equal(isMonthEmpty([withData]), false);

// Cobertura parcial y estados de la ganancia.
assert.equal(summarizeProfitCoverage(readyProfit(1, "PARCIAL")), "partial");
assert.equal(summarizeProfitCoverage(readyProfit(1, "SIN_DATOS")), "empty");
assert.equal(summarizeProfitCoverage({status: "loading"}), "pending");
assert.equal(summarizeProfitCoverage({status: "error", error: "x"}), "pending");

// Vacío del primer día: ceros, sin porcentaje, y solo con la ganancia lista.
const emptySummaryOctober = monthlySummaryOf(monthRangeOctober, [], []);
const emptyProfit = {status: "ready", error: "", result: calculateOperationalNetProfit({sales: [], projectBalances: [], period: {desde: monthRangeOctober.start, hasta: monthRangeOctober.end}})};
const [firstDay] = buildMonthlySummaryGroups({summary: emptySummaryOctober, previousSummary: monthlySummaryOf(monthRangeSeptember, [], []), profit: emptyProfit, previousProfit: emptyProfit});
assert.equal(firstDay.sales.total, 0);
assert.equal(firstDay.purchases.total, 0);
assert.equal(firstDay.profit.amount, 0);
assert.equal(firstDay.sales.comparison.hasBase, false);
assert.equal(firstDay.profit.comparison.hasBase, false);
assert.equal(isMonthEmpty([firstDay]), true);
for (const unfinished of [{status: "loading", error: ""}, {status: "error", error: "No se pudo calcular"}]) {
  const [pending] = buildMonthlySummaryGroups({summary: emptySummaryOctober, previousSummary: emptySummaryOctober, profit: unfinished, previousProfit: unfinished});
  assert.equal(pending.profit.status, unfinished.status);
  assert.equal(pending.profit.amount, null);
  assert.equal(isMonthEmpty([pending]), false, `un estado ${unfinished.status} de la ganancia nunca se muestra como vacío`);
}

// Permisos: sin PROFITABILITY_READ no hay tarjeta de ganancia ni dato de ganancia.
const [withoutProfit] = buildMonthlySummaryGroups({summary: octoberSummary, previousSummary: octoberSummary, profit: readyProfit(500), previousProfit: readyProfit(300), canViewProfitability: false});
assert.equal(withoutProfit.profit, null);
assert.equal(isMonthEmpty(buildMonthlySummaryGroups({summary: emptySummaryOctober, previousSummary: emptySummaryOctober, profit: {status: "loading"}, previousProfit: {status: "loading"}, canViewProfitability: false})), true);

// Una moneda que solo aparece en la ganancia también tiene su fila.
const usdOnlyProfit = {status: "ready", error: "", result: {grupos: [{moneda: "USD", gananciaNetaOperacional: 40, cobertura: "COMPLETA"}]}};
const usdRows = buildMonthlySummaryGroups({summary: emptySummaryOctober, previousSummary: emptySummaryOctober, profit: usdOnlyProfit, previousProfit: usdOnlyProfit});
assert.deepEqual(usdRows.map((row) => row.currency), ["CLP", "USD"]);
assert.equal(usdRows.find((row) => row.currency === "USD").profit.amount, 40);
// Mes en curso vs mes cerrado: el mes en curso no muestra porcentaje, solo la
// referencia del mes anterior completo; el mes cerrado sí muestra porcentaje.
assert.equal(isMonthInProgress("2026-10", today), true);
assert.equal(isMonthInProgress("2026-09", today), false);
assert.equal(formatMonthName("2026-09"), "Septiembre");
const inProgressInput = {
  summary: octoberSummary,
  previousSummary: monthlySummaryOf(monthRangeSeptember),
  profit: readyProfit(500),
  previousProfit: readyProfit(300),
};
const [running] = buildMonthlySummaryGroups({...inProgressInput, inProgress: true});
for (const metric of [running.sales, running.profit]) {
  assert.deepEqual(metric.comparison, {hasBase: false, percent: null, direction: "none"}, "mes en curso: sin porcentaje");
  assert.equal(metric.reference.hasBase, true);
}
assert.equal(running.sales.reference.amount, 2000, "referencia de ventas: septiembre completo, en neto");
assert.equal(running.profit.reference.amount, 300, "referencia de ganancia: septiembre completo");
assert.deepEqual(running.purchases.comparison, {hasBase: false, percent: null, direction: "none"});
assert.deepEqual(running.purchases.reference, {hasBase: false, amount: null}, "sin compras en septiembre: sin base");
assert.equal(formatReferenceText(running.sales.reference, "Septiembre", "$ 2.000"), "Septiembre completo: $ 2.000");
assert.equal(formatReferenceText(running.purchases.reference, "Septiembre", "$ 0"), NO_PREVIOUS_MONTH_TEXT);
// La ganancia anterior debe estar lista para ser referencia.
const [runningLoadingPrev] = buildMonthlySummaryGroups({...inProgressInput, previousProfit: {status: "loading"}, inProgress: true});
assert.equal(runningLoadingPrev.profit.reference.hasBase, false);
// Mes cerrado: porcentaje y sin referencia.
const [closed] = buildMonthlySummaryGroups({...inProgressInput, inProgress: false});
assert.equal(closed.sales.reference, null);
assert.equal(closed.profit.reference, null);
assert.equal(closed.sales.comparison.percent, 50);
assert.equal(closed.profit.comparison.percent, 66.7);
// Otros asserts estáticos: el componente decide por isMonthInProgress y el
// vacío de un mes pasado no ofrece registrar.
assert.match(monthlyViewSource, /isMonthInProgress\(month, todayKey\)/);
assert.match(monthlyViewSource, /import \{[^}]*\bisMonthInProgress\b[^}]*\} from "\.\.\/\.\.\/\.\.\/domain\/reportMonthlySummary\.mjs"/);
assert.match(monthlyViewSource, /buildMonthlySummaryGroups\(\{[^}]*\binProgress\b[^}]*\}\)/);
assert.match(monthlyViewSource, /formatReferenceText\(metric\.reference, previousMonthName, money\(metric\.reference\.amount\)\)/);
assert.match(monthlyViewSource, /formatMonthName\(shiftMonthKey\(month, -1\), locale\)/);
assert.match(monthlyViewSource, /referenceText=\{showComparison \? referenceOf\(group\.sales\) : null\}/);
assert.match(monthlyViewSource, /referenceText=\{showComparison \? referenceOf\(group\.purchases\) : null\}/);
assert.match(monthlyViewSource, /group\.profit\.status === "ready" \? referenceOf\(group\.profit\)/);
assert.match(monthlyViewSource, /No hubo ventas confirmadas en \{formatMonthLabel\(month, locale\)\.toLocaleLowerCase\(locale\)\}/);
assert.match(monthlyViewSource, /\{inProgress && \(canRegisterSale \|\| canRegisterPurchase\) && <div className="reports-month-actions">/);
console.log("OK reportes SPEC 025: resumen mensual por defecto, comparación sin base, cobertura, permisos y estados carga/error/vacío separados");

// SPEC 025 §3: "Proyectos del mes". Lista pura, misma fuente que la ganancia.
const octoberPeriod = {desde: monthRangeOctober.start, hasta: monthRangeOctober.end};
const projectMonth = (mes, {ingresoNeto = 0, horasHombre = 0, materialesVenta = 0, moneda = "CLP"} = {}) => {
  const costoTotal = horasHombre + materialesVenta;
  return {mes, moneda, ingresoNeto, materialesVenta, materialesAdicionales: 0, horasHombre, gastosDirectos: 0, gastosIndirectos: 0, costoTotal, resultado: ingresoNeto - costoTotal};
};
const projectEntry = (id, numero, titulo, meses, {moneda = "CLP", cliente = "", fuentes = {}} = {}) => ({
  id,
  numero,
  titulo,
  clienteSnapshot: cliente ? {nombreRazonSocial: cliente} : null,
  balance: {
    trabajoId: id,
    moneda,
    estado: "COMPLETO",
    valorComercial: meses.reduce((total, entry) => total + entry.ingresoNeto, 0),
    costoTotal: meses.reduce((total, entry) => total + entry.costoTotal, 0),
    resultado: meses.reduce((total, entry) => total + entry.resultado, 0),
    desglosePorMes: meses,
    fuentes: {materialesVentaSinCosto: 0, ventasSinNetoValido: 0, registrosSinFecha: 0, ...fuentes},
  },
});
const projectFixtures = [
  projectEntry("p-loss", "TR-0001", "Cableado oficina", [projectMonth("2026-09", {ingresoNeto: 900000}), projectMonth("2026-10", {horasHombre: 30000})], {cliente: "Cliente A"}),
  projectEntry("p-worse", "TR-0002", "Red de bodega", [projectMonth("2026-10", {horasHombre: 70000, ingresoNeto: 20000})], {cliente: "Cliente B"}),
  projectEntry("p-win", "TR-0003", "Cámaras de seguridad", [projectMonth("2026-10", {ingresoNeto: 100000, materialesVenta: 20000})]),
  projectEntry("p-zero", "TR-0004", "Mantención", [projectMonth("2026-10", {ingresoNeto: 10000, materialesVenta: 10000})]),
  projectEntry("p-other-month", "TR-0005", "Sin movimiento en octubre", [projectMonth("2026-09", {horasHombre: 5000})]),
  projectEntry("p-unreliable", "TR-0006", "Materiales sin costo", [projectMonth("2026-10", {horasHombre: 1000})], {fuentes: {materialesVentaSinCosto: 1}}),
  projectEntry("p-usd", "TR-0007", "Proyecto en dólares", [projectMonth("2026-10", {ingresoNeto: 400, moneda: "USD"})], {moneda: "USD"}),
  projectEntry("p-cents", "TR-0008", "Con centavos", [projectMonth("2026-10", {ingresoNeto: 0.3, horasHombre: 0.1})]),
  {id: "p-failed", numero: "TR-0009", titulo: "Balance fallido", balance: null},
];
const monthlyProjects = buildMonthlyProjectResults({projects: projectFixtures, month: "2026-10"});
// Pierden primero (el peor al comienzo), luego ganan (el mayor primero) y al final el resultado 0; cada moneda por separado.
assert.deepEqual(monthlyProjects.filas.map((row) => row.id), ["p-worse", "p-loss", "p-win", "p-cents", "p-zero", "p-usd"]);
assert.deepEqual(monthlyProjects.filas.map((row) => row.estado), [
  PROJECT_RESULT_STATUS.LOSING, PROJECT_RESULT_STATUS.LOSING, PROJECT_RESULT_STATUS.WINNING,
  PROJECT_RESULT_STATUS.WINNING, PROJECT_RESULT_STATUS.NEUTRAL, PROJECT_RESULT_STATUS.WINNING,
]);
assert.equal(monthlyProjects.filas.find((row) => row.id === "p-loss").resultado, -30000, "solo cuenta el mes elegido (septiembre queda fuera)");
assert.equal(monthlyProjects.filas.find((row) => row.id === "p-zero").resultado, 0);
assert.equal(projectResultLabel(PROJECT_RESULT_STATUS.NEUTRAL), "Sin resultado");
assert.equal(projectResultLabel(PROJECT_RESULT_STATUS.LOSING), "Perdiendo");
assert.equal(projectResultLabel(PROJECT_RESULT_STATUS.WINNING), "Ganando");
assert.deepEqual(monthlyProjects.filas.find((row) => row.id === "p-loss"), {id: "p-loss", numero: "TR-0001", titulo: "Cableado oficina", cliente: "Cliente A", moneda: "CLP", resultado: -30000, estado: "PERDIENDO", ingresoNeto: 0, costoTotal: 30000, acumulado: {resultado: 870000, rentabilidadPct: null}, estadoBalance: "COMPLETO"});
assert.equal(monthlyProjects.incompletos, 1, "un proyecto con movimiento y datos incompletos no se lista, se cuenta");
assert.equal(monthlyProjects.filas.some((row) => ["p-unreliable", "p-other-month", "p-failed"].includes(row.id)), false);
// La suma de la lista coincide con el "Resultado de proyectos" de la ganancia del mismo mes.
const monthlyProfitOctober = calculateOperationalNetProfit({sales: [], projectBalances: projectFixtures, period: octoberPeriod});
for (const code of ["CLP", "USD"]) {
  const listed = Math.round(monthlyProjects.filas.filter((row) => row.moneda === code).reduce((total, row) => total + row.resultado, 0) * 100) / 100;
  assert.equal(listed, monthlyProfitOctober.grupos.find((entry) => entry.moneda === code).componentes.proyectos.resultado, `${code}: la lista suma el resultado de proyectos de la ganancia`);
}
assert.equal(monthlyProfitOctober.grupos.find((entry) => entry.moneda === "CLP").componentes.proyectos.resultado, -30000 - 50000 + 80000 + 0.2 + 0);
assert.deepEqual(buildMonthlyProjectResults({projects: projectFixtures, month: "2026-10", currency: "USD"}).filas.map((row) => row.id), ["p-usd"]);
assert.equal(buildMonthlyProjectResults({projects: projectFixtures, month: "2026-10", currency: "USD"}).incompletos, 0, "el filtro de moneda también aplica al conteo de incompletos");
assert.deepEqual(buildMonthlyProjectResults({projects: projectFixtures, month: "2026-07"}), {filas: [], incompletos: 0});
assert.deepEqual(buildMonthlyProjectResults({projects: [], month: "2026-10"}), {filas: [], incompletos: 0});

// Aviso de servicios vendidos sin proyecto: sale de la misma ganancia del mes y solo con monto > 0.
const servicesSale = (id, price, moneda = "CLP") => ({
  ventaId: id, estado: "confirmada", moneda, fechaVenta: "2026-10-12", trabajoId: "", neto: price, total: Math.round(price * 1.19), descuento: 0,
  items: [{lineaId: `${id}-s`, itemId: "service-hour", tipoItem: "servicio", cantidad: 1, precioUnitario: price, descuentoPct: 0}],
  efectosInventario: [],
});
const profitWithServices = {status: "ready", error: "", result: calculateOperationalNetProfit({sales: [servicesSale("v1", 15000), servicesSale("v2", 300, "USD")], projectBalances: [], period: octoberPeriod})};
assert.deepEqual(buildServicesWithoutProjectNotices(profitWithServices), [{moneda: "CLP", monto: 15000}, {moneda: "USD", monto: 300}]);
assert.deepEqual(buildServicesWithoutProjectNotices(profitWithServices, "USD"), [{moneda: "USD", monto: 300}]);
assert.deepEqual(buildServicesWithoutProjectNotices({status: "ready", error: "", result: calculateOperationalNetProfit({sales: [], projectBalances: projectFixtures, period: octoberPeriod})}), [], "sin servicios sin proyecto no hay aviso");
for (const unfinished of [{status: "loading"}, {status: "error", error: "x"}, null]) {
  assert.deepEqual(buildServicesWithoutProjectNotices(unfinished), [], "sin ganancia lista no hay aviso");
}
assert.equal(profitWithServices.result.grupos[0].gananciaNetaOperacional, 0, "los servicios sin proyecto no entran en la ganancia: solo se avisa");

// Estáticos: permiso, estados separados, enlaces y textos exactos.
const monthlyProjectsSource = readRequiredSource("src/features/reports/views/ReportsMonthlyProjects.jsx", "proyectos del mes, SPEC 025 §3");
const monthlySummaryDomainSource = readFileSync("src/domain/reportMonthlySummary.mjs", "utf8");
assert.match(monthlyViewSource, /<ReportsMonthlyProjects canView=\{canViewProfitability\}/, "la sección se condiciona al mismo permiso que la tarjeta de ganancia");
assert.match(monthlyProjectsSource, /if \(!canView\) return null;/);
assert.match(monthlyPageSource, /projects=\{profitabilityV4\.projects\}/);
assert.match(monthlyPageSource, /canViewProfitability = hasBusinessPermission\(role, BUSINESS_PERMISSIONS\.PROFITABILITY_READ\)/);
// Orden de estados: carga, error, vacío, datos. El fallo nunca cae en el vacío.
assert.match(monthlyProjectsSource, /projects\.status === "loading"[\s\S]*?else if \(loadError\)[\s\S]*?role="alert"[\s\S]*?Reintentar[\s\S]*?else if \(!results\.filas\.length\)[\s\S]*?Aún no hay proyectos con movimiento este mes/);
assert.match(monthlyProjectsSource, /projects\.status === "error"\s*\?\s*projects\.error/);
assert.match(monthlyProjectsSource, /results && !results\.filas\.length && failedCount > 0/, "una lista vacía por balances fallidos es error, no vacío");
assert.match(monthlyProjectsSource, /<LoadingState variant="section" label="Cargando proyectos del mes\.\.\." \/>/);
assert.match(monthlyProjectsSource, /No hubo proyectos con movimiento en \$\{formatMonthLabel\(month, locale\)\.toLocaleLowerCase\(locale\)\}/);
assert.equal((monthlyProjectsSource.match(/Aún no hay proyectos con movimiento este mes/g) || []).length, 1);
// Enlaces: lista completa, ficha de cada fila y Ventas.
assert.match(monthlyProjectsSource, /onNavigate\("\/trabajos", \{state: \{openWorkId: workId\}\}\)/);
assert.match(monthlyProjectsSource, /Ver todos los proyectos/);
assert.match(monthlyProjectsSource, /onNavigate\("\/ventas"\)/);
assert.match(monthlyProjectsSource, /links\.works/);
assert.match(monthlyProjectsSource, /links\.sales/);
// Aviso accionable con su texto exacto, y estado por icono + texto (no solo color).
assert.match(monthlyProjectsSource, /Hay \{formatMoney\(notice\.monto, notice\.moneda, locale\)\} en servicios vendidos sin proyecto, y no entran en la ganancia\. Vincúlalos a un proyecto para saber si ganas o pierdes con ellos\./);
assert.match(monthlyProjectsSource, /<Icon size=\{14\} aria-hidden="true" \/>\s*\{projectResultLabel\(row\.estado\)\}/);
assert.match(monthlySummaryDomainSource, /PERDIENDO[\s\S]*?"Perdiendo"[\s\S]*?"Ganando"[\s\S]*?"Sin resultado"/);
// Orden: perder va primero en el comparador.
assert.match(monthlySummaryDomainSource, /\[PROJECT_RESULT_STATUS\.LOSING\]: 0,\s*\[PROJECT_RESULT_STATUS\.WINNING\]: 1,\s*\[PROJECT_RESULT_STATUS\.NEUTRAL\]: 2/);
// Solo componentes y tokens del sistema: sin colores ni medidas literales en la sección nueva.
assert.doesNotMatch(monthlyProjectsSource, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|style=\{\{/);
const projectsCss = readFileSync("src/styles/interior.css", "utf8");
const projectsCssBlock = projectsCss.slice(projectsCss.indexOf(".reports-month-projects {"), projectsCss.indexOf(".reports-simple-eyebrow,"));
assert.ok(projectsCssBlock.length > 200, "debe existir el bloque de estilos de proyectos del mes");
assert.doesNotMatch(projectsCssBlock, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
console.log("OK reportes SPEC 025: proyectos del mes (orden, suma = resultado de proyectos de la ganancia, permiso, estados y aviso de servicios sin proyecto)");

// Resumen visual (SPEC 025), bloque 1: datos y helpers puros. Nada de esto calcula dinero nuevo.
const plain = (text) => text.replace(/ /g, " ");
const projectRow = (id) => monthlyProjects.filas.find((row) => row.id === id);

// Filas: ingreso y costo del mes (suma de los mismos registros mensuales), acumulado del proyecto y estado del balance.
assert.deepEqual([projectRow("p-win").ingresoNeto, projectRow("p-win").costoTotal, projectRow("p-win").resultado], [100000, 20000, 80000]);
assert.deepEqual([projectRow("p-worse").ingresoNeto, projectRow("p-worse").costoTotal, projectRow("p-worse").resultado], [20000, 70000, -50000]);
assert.deepEqual(projectRow("p-win").acumulado, {resultado: 80000, rentabilidadPct: null}, "sin rentabilidadPct en el balance no se inventa");
assert.deepEqual([projectRow("p-cents").ingresoNeto, projectRow("p-cents").costoTotal], [0.3, 0.1], "los centavos se suman redondeados a 2 decimales");
for (const row of monthlyProjects.filas) {
  assert.equal(Math.round((row.ingresoNeto - row.costoTotal) * 100) / 100, row.resultado, `${row.id}: ingreso − costo del mes es el resultado que ya se mostraba`);
}
const pctEntry = projectEntry("p-pct", "TR-0010", "Con rentabilidad", [projectMonth("2026-10", {ingresoNeto: 50000, horasHombre: 10000})]);
pctEntry.balance.rentabilidadPct = 80;
const noSaleEntry = projectEntry("p-nosale", "TR-0011", "Sin venta aún", [projectMonth("2026-10", {horasHombre: 8000})]);
Object.assign(noSaleEntry.balance, {estado: "PARCIAL_SIN_VENTA", valorComercial: null, resultado: null, rentabilidadPct: null});
const nanPctEntry = projectEntry("p-nan", "TR-0012", "Rentabilidad inválida", [projectMonth("2026-10", {ingresoNeto: 1000})]);
nanPctEntry.balance.rentabilidadPct = Number.NaN;
const extraRows = buildMonthlyProjectResults({projects: [pctEntry, noSaleEntry, nanPctEntry], month: "2026-10"}).filas;
const extraRow = (id) => extraRows.find((row) => row.id === id);
assert.deepEqual(extraRow("p-pct").acumulado, {resultado: 40000, rentabilidadPct: 80}, "el acumulado y la rentabilidad salen tal cual del balance");
assert.equal(extraRow("p-pct").estadoBalance, "COMPLETO");
assert.deepEqual(extraRow("p-nosale").acumulado, {resultado: null, rentabilidadPct: null}, "sin venta el balance no trae acumulado: null, no 0");
assert.equal(extraRow("p-nosale").estadoBalance, "PARCIAL_SIN_VENTA");
assert.deepEqual([extraRow("p-nosale").ingresoNeto, extraRow("p-nosale").costoTotal, extraRow("p-nosale").resultado], [0, 8000, -8000]);
assert.equal(extraRow("p-nan").acumulado.rentabilidadPct, null, "un valor no numérico del balance queda en null");

// Proyectos incompletos: nombre y motivo, sin cifras; mismo criterio que el conteo `incompletos`.
const incompleteList = listIncompleteMonthlyProjects({projects: projectFixtures, month: "2026-10"});
assert.deepEqual(incompleteList, [{id: "p-unreliable", numero: "TR-0006", titulo: "Materiales sin costo", motivo: "MATERIALES_VENTA_SIN_COSTO", motivoTexto: INCOMPLETE_PROJECT_REASONS.MATERIALES_VENTA_SIN_COSTO}]);
assert.deepEqual(Object.keys(incompleteList[0]).sort(), ["id", "motivo", "motivoTexto", "numero", "titulo"], "ninguna cifra: solo identidad y motivo");
assert.equal(incompleteList.length, monthlyProjects.incompletos);
assert.deepEqual(listIncompleteMonthlyProjects({projects: projectFixtures, month: "2026-07"}), [], "sin movimiento en el mes no hay incompletos");
assert.deepEqual(listIncompleteMonthlyProjects({projects: [], month: "2026-10"}), []);
assert.deepEqual(listIncompleteMonthlyProjects(), []);
assert.equal(listIncompleteMonthlyProjects({projects: projectFixtures, month: "2026-10"}).some((row) => row.id === "p-failed"), false, "un balance fallido (null) no tiene movimiento que listar");
const incompleteFixtures = [
  projectEntry("p-zeta", "TR-0021", "Zeta", [projectMonth("2026-10", {horasHombre: 1})], {fuentes: {registrosSinFecha: 1}}),
  projectEntry("p-alfa", "TR-0020", "Alfa", [projectMonth("2026-10", {horasHombre: 1})], {fuentes: {ventasSinNetoValido: 2}}),
  {id: "p-bad", numero: "TR-0022", titulo: "", balance: {trabajoId: "p-bad", moneda: "", desglosePorMes: [{mes: "2026-10", moneda: "CLP"}]}},
  projectEntry("p-usd-bad", "TR-0023", "Dólar roto", [projectMonth("2026-10", {horasHombre: 1, moneda: "USD"})], {moneda: "USD", fuentes: {materialesVentaSinCosto: 1}}),
  projectEntry("p-fine", "TR-0024", "Sin problemas", [projectMonth("2026-10", {ingresoNeto: 10})]),
];
assert.deepEqual(
  listIncompleteMonthlyProjects({projects: incompleteFixtures, month: "2026-10"}).map((row) => [row.titulo, row.motivo]),
  [["Alfa", "VENTAS_SIN_NETO_VALIDO"], ["Dólar roto", "MATERIALES_VENTA_SIN_COSTO"], ["Proyecto sin título", "ESTRUCTURA_INVALIDA"], ["Zeta", "REGISTROS_SIN_FECHA"]],
  "ordenados por título, con título de respaldo y su motivo"
);
for (const currency of ["todos", "CLP", "USD"]) {
  assert.equal(
    listIncompleteMonthlyProjects({projects: incompleteFixtures, month: "2026-10", currency}).length,
    buildMonthlyProjectResults({projects: incompleteFixtures, month: "2026-10", currency}).incompletos,
    `${currency}: la lista y el conteo coinciden`
  );
}
assert.deepEqual(listIncompleteMonthlyProjects({projects: incompleteFixtures, month: "2026-10", currency: "USD"}).map((row) => row.id), ["p-usd-bad", "p-bad"], "con filtro USD queda el de USD y el de moneda desconocida, como en el conteo");
assert.ok(Object.values(OPERATIONAL_PROJECT_EXCLUSION).every((code) => typeof INCOMPLETE_PROJECT_REASONS[code] === "string" && INCOMPLETE_PROJECT_REASONS[code]), "todos los motivos de exclusión tienen texto");

// La ganancia del mes entrega margen y ventas consideradas; el grupo solo los traspasa (null por defecto).
const profitWithMargin = {status: "ready", error: "", result: {grupos: [{moneda: "CLP", gananciaNetaOperacional: 500, cobertura: "COMPLETA", gananciaNetaOperacionalPct: 25, ingresoNetoConsiderado: 2000}]}};
const marginInput = {summary: octoberSummary, previousSummary: monthlySummaryOf(monthRangeSeptember), previousProfit: readyProfit(300)};
assert.deepEqual(
  (({marginPct, consideredRevenue}) => ({marginPct, consideredRevenue}))(buildMonthlySummaryGroups({...marginInput, profit: profitWithMargin})[0].profit),
  {marginPct: 25, consideredRevenue: 2000}
);
assert.deepEqual([withData.profit.marginPct, withData.profit.consideredRevenue], [null, null], "sin esos campos en la ganancia: null, no 0");
assert.deepEqual(
  [buildMonthlySummaryGroups({...marginInput, profit: {status: "loading"}})[0].profit.marginPct, buildMonthlySummaryGroups({...marginInput, profit: {status: "error", error: "x"}})[0].profit.consideredRevenue],
  [null, null],
  "con la ganancia sin listar no hay margen"
);
const junkProfit = {status: "ready", error: "", result: {grupos: [{moneda: "CLP", gananciaNetaOperacional: 1, cobertura: "COMPLETA", gananciaNetaOperacionalPct: "abc", ingresoNetoConsiderado: Number.NaN}]}};
assert.deepEqual(
  (({marginPct, consideredRevenue}) => ({marginPct, consideredRevenue}))(buildMonthlySummaryGroups({...marginInput, profit: junkProfit})[0].profit),
  {marginPct: null, consideredRevenue: null}
);
const realProfitGroup = monthlyProfitOctober.grupos.find((entry) => entry.moneda === "CLP");
const realMarginGroup = buildMonthlySummaryGroups({...marginInput, profit: {status: "ready", error: "", result: monthlyProfitOctober}}).find((entry) => entry.currency === "CLP");
assert.equal(realMarginGroup.profit.marginPct, realProfitGroup.gananciaNetaOperacionalPct, "mismo margen que calcula la ganancia");
assert.equal(realMarginGroup.profit.consideredRevenue, realProfitGroup.ingresoNetoConsiderado, "misma base de ventas consideradas que la ganancia");

// describeProfitMargin: frase "De cada $100 que vendes…", círculo y nota de base.
const positive = describeProfitMargin({marginPct: 23.456, consideredRevenue: 800000, salesTotal: 1000000});
assert.equal(positive.kind, "positive");
assert.equal(plain(positive.sentence), "De cada $100 que vendes, te quedan $23,5");
assert.deepEqual([positive.percent, positive.dollarsPer100], [23.5, 23.5]);
assert.deepEqual(positive.ring, {fraction: 0.2346, tone: "up"});
assert.deepEqual([positive.basis.show, positive.basis.amount, plain(positive.basis.text)], [true, 800000, "sobre $800.000 de ventas consideradas"]);
assert.equal(plain(positive.ariaLabel), "De cada $100 que vendes, te quedan $23,5, sobre $800.000 de ventas consideradas");
assert.equal(positive.partial, false);
// La nota de base solo aparece si la base difiere de "Vendí".
for (const [considered, sold, label] of [[1000000, 1000000, "iguales"], [1000000.004, 1000000, "difieren menos de un centavo"], [800000, null, "sin total vendido para comparar"], [null, 1000000, "sin ventas consideradas"]]) {
  const basis = describeProfitMargin({marginPct: 10, consideredRevenue: considered, salesTotal: sold}).basis;
  assert.deepEqual(basis, {show: false, amount: null, text: ""}, `sin nota de base: ${label}`);
}
// Cero: ni gana ni pierde; el círculo queda vacío.
for (const zero of [0, 0.04, -0.04]) {
  const result = describeProfitMargin({marginPct: zero});
  assert.equal(result.kind, "zero", `${zero} se redondea a 0`);
  assert.equal(plain(result.sentence), "De cada $100 que vendes, te quedan $0");
  assert.deepEqual(result.ring, {fraction: 0, tone: "none"});
  assert.equal(Object.is(result.percent, -0), false, "nunca -0");
}
// Negativo: número real, círculo vacío y frase de pérdida; sin tope.
const negative = describeProfitMargin({marginPct: -12.34});
assert.deepEqual([negative.kind, negative.percent, negative.dollarsPer100], ["negative", -12.3, 12.3]);
assert.equal(plain(negative.sentence), "De cada $100 que vendes, pierdes $12,3");
assert.deepEqual(negative.ring, {fraction: 0, tone: "down"});
const veryNegative = describeProfitMargin({marginPct: -500});
assert.deepEqual([veryNegative.kind, veryNegative.percent, plain(veryNegative.sentence)], ["negative", -500, "De cada $100 que vendes, pierdes $500"]);
assert.deepEqual(veryNegative.ring, {fraction: 0, tone: "down"}, "sin tope y con el círculo vacío");
// Más de 100: el número es el real; solo el círculo se llena al máximo.
const overHundred = describeProfitMargin({marginPct: 150});
assert.equal(plain(overHundred.sentence), "De cada $100 que vendes, te quedan $150");
assert.deepEqual(overHundred.ring, {fraction: 1, tone: "up"});
// Ventas 0 o sin margen: sin círculo ni número inventado.
for (const missing of [null, undefined, Number.NaN, "", "abc"]) {
  const result = describeProfitMargin({marginPct: missing});
  assert.equal(result.kind, "none", `${String(missing)} no es un margen`);
  assert.deepEqual([result.sentence, result.percent, result.dollarsPer100, result.ring], [NO_MARGIN_TEXT, null, null, {fraction: 0, tone: "none"}]);
}
assert.equal(describeProfitMargin().kind, "none");
// Ganancia sin listar: nada que mostrar.
for (const status of ["loading", "error", "pending"]) {
  const result = describeProfitMargin({marginPct: 50, status});
  assert.deepEqual([result.kind, result.sentence, result.ariaLabel], ["pending", "", ""], `${status}: sin frase`);
}
// Cobertura parcial: el aviso viaja en la etiqueta accesible.
assert.equal(describeProfitMargin({marginPct: 10, coverage: "partial"}).partial, true);
assert.match(describeProfitMargin({marginPct: 10, coverage: "partial"}).ariaLabel, /\. Cobertura parcial$/);
assert.match(describeProfitMargin({marginPct: null, coverage: "partial"}).ariaLabel, /\. Cobertura parcial$/);
assert.doesNotMatch(describeProfitMargin({marginPct: 10, coverage: "complete"}).ariaLabel, /parcial/i);
// Otra moneda y moneda inválida (no revienta).
const dollars = describeProfitMargin({marginPct: 12.34, currency: "USD", consideredRevenue: 300.5, salesTotal: 400});
assert.equal(plain(dollars.sentence), "De cada US$100 que vendes, te quedan US$12,3");
assert.equal(plain(dollars.basis.text), "sobre US$300,50 de ventas consideradas");
assert.doesNotThrow(() => describeProfitMargin({marginPct: 12, currency: "XXXX", locale: "es-CL"}));

// buildProfitNoticeLines: aviso único pegado a la ganancia.
const notice = (overrides = {}) => buildProfitNoticeLines({canViewProfitability: true, canOpenSales: true, ...overrides});
assert.deepEqual(notice(), [], "cobertura completa y nada que avisar: no hay aviso");
assert.deepEqual(notice({coverage: "empty"}), []);
const partialOnly = notice({coverage: "partial"});
assert.deepEqual(partialOnly.map((entry) => [entry.key, entry.placement]), [["partial", "profit"]]);
assert.equal(partialOnly[0].text, "La ganancia del mes es parcial: hay registros que no se incluyen.");
assert.equal(partialOnly[0].detail, "", "sin proyectos incompletos no hay detalle");
assert.deepEqual(partialOnly[0].action, {id: "system-state", label: "Ver estado del sistema"});
assert.equal(notice({coverage: "partial", incompleteCount: 1})[0].detail, "1 proyecto con movimiento no se muestra porque sus datos están incompletos.");
assert.equal(notice({coverage: "partial", incompleteCount: 3})[0].detail, "3 proyectos con movimiento no se muestran porque sus datos están incompletos.");
assert.deepEqual(notice({coverage: "partial", canViewProfitability: false}), [], "sin permiso de ganancia no se avisa de la ganancia");
// Incompletos sin cobertura parcial (caso raro): línea propia, no se esconde.
assert.deepEqual(notice({incompleteCount: 2}).map((entry) => [entry.key, entry.text]), [["incomplete", "2 proyectos con movimiento no se muestran porque sus datos están incompletos."]]);
// Servicios vendidos sin proyecto: solo con monto mayor que 0; el enlace a Ventas depende del permiso.
const services = notice({servicesAmount: 15000});
assert.deepEqual([services[0].key, services[0].amount, services[0].text, services[0].action], ["services", 15000, null, {id: "sales", label: "Ir a Ventas"}]);
assert.equal(notice({servicesAmount: 15000, canOpenSales: false})[0].action, null);
for (const none of [0, -5, null, undefined, Number.NaN, "x"]) assert.deepEqual(notice({servicesAmount: none}), [], `monto ${String(none)}: sin aviso de servicios`);
assert.deepEqual(notice({servicesAmount: 15000, canViewProfitability: false}), [], "los servicios sin proyecto son parte de la ganancia: requieren su permiso");
// Documentos sin neto válido: una sola vez (grupo principal), con plural, y no dependen de la ganancia.
assert.equal(notice({withoutNetCount: 1})[0].text, "Hay 1 documento confirmado sin neto válido, que no se suma en Ventas y Compras.");
assert.equal(notice({withoutNetCount: 4})[0].text, "Hay 4 documentos confirmados sin neto válido, que no se suman en Ventas y Compras.");
assert.deepEqual(notice({withoutNetCount: 4, primary: false}), [], "en el segundo grupo de moneda no se repite");
assert.equal(buildProfitNoticeLines({withoutNetCount: 2})[0].key, "without-net", "se avisa aunque el perfil no vea la ganancia");
// Orden: parcial, servicios, documentos.
assert.deepEqual(notice({coverage: "partial", incompleteCount: 1, servicesAmount: 10, withoutNetCount: 2}).map((entry) => entry.key), ["partial", "services", "without-net"]);
// Varias monedas: el conteo de incompletos va una sola vez, en la sección de proyectos.
const multi = notice({coverage: "partial", incompleteCount: 2, currencyCount: 2});
assert.deepEqual(multi.map((entry) => [entry.key, entry.placement]), [["partial", "profit"], ["incomplete-projects", "projects"]]);
assert.equal(multi[0].detail, "", "con varias monedas el aviso de la ganancia no repite el conteo");
assert.equal(multi[1].text, "2 proyectos con movimiento no se muestran porque sus datos están incompletos.");
assert.deepEqual(notice({coverage: "partial", incompleteCount: 2, currencyCount: 2, primary: false}).map((entry) => entry.key), ["partial"], "solo el grupo principal lleva el conteo");
assert.deepEqual(notice({incompleteCount: 2, currencyCount: 2}).map((entry) => entry.key), ["incomplete-projects"]);
assert.deepEqual(notice({coverage: "partial", incompleteCount: 0, currencyCount: 3}).map((entry) => entry.key), ["partial"], "sin incompletos no hay línea de proyectos");
// Entradas raras no revientan.
assert.deepEqual(buildProfitNoticeLines(), []);
assert.deepEqual(notice({incompleteCount: "abc", withoutNetCount: -3}), []);
assert.deepEqual(notice({incompleteCount: 2.9, coverage: "partial"}).map((entry) => entry.detail), ["2 proyectos con movimiento no se muestran porque sus datos están incompletos."]);

// scaleProjectBars: escala por moneda, el que gana a la derecha y el que pierde a la izquierda.
const barRows = scaleProjectBars(monthlyProjects.filas);
const barOf = (id) => barRows.find((row) => row.id === id).bar;
assert.deepEqual(barRows.map((row) => row.id), monthlyProjects.filas.map((row) => row.id), "mismo orden");
assert.deepEqual(barOf("p-win"), {direction: "right", fraction: 1}, "el mayor valor absoluto de la moneda mide 1");
assert.deepEqual(barOf("p-worse"), {direction: "left", fraction: 0.625});
assert.deepEqual(barOf("p-loss"), {direction: "left", fraction: 0.375});
assert.deepEqual(barOf("p-zero"), {direction: "none", fraction: 0});
assert.deepEqual(barOf("p-cents"), {direction: "right", fraction: 0}, "un resultado minúsculo mantiene su sentido y casi no mide");
assert.deepEqual(barOf("p-usd"), {direction: "right", fraction: 1}, "cada moneda tiene su propia escala");
assert.equal("bar" in monthlyProjects.filas[0], false, "no modifica las filas originales");
assert.deepEqual(scaleProjectBars([{moneda: "CLP", resultado: -10}]).map((row) => row.bar), [{direction: "left", fraction: 1}]);
assert.deepEqual(scaleProjectBars([{moneda: "CLP", resultado: 0}, {moneda: "CLP", resultado: 0}]).map((row) => row.bar), [{direction: "none", fraction: 0}, {direction: "none", fraction: 0}]);
assert.deepEqual(scaleProjectBars([]), []);
assert.deepEqual(scaleProjectBars(), []);
assert.deepEqual(scaleProjectBars("x"), []);
assert.deepEqual(scaleProjectBars([{moneda: "CLP", resultado: "abc"}]).map((row) => row.bar), [{direction: "none", fraction: 0}], "un resultado inválido no dibuja barra");
console.log("OK reportes SPEC 025 (resumen visual, bloque 1): filas con ingreso/costo/acumulado, incompletos sin cifras, margen, aviso único y barras");

console.log("Report model smoke: OK");
