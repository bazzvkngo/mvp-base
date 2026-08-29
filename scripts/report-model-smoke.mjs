import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  REPORT_TABS,
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
  normalizeInventoryMovement,
  normalizeInventoryAcquisition,
  normalizeWorkCost,
  resolveReportCurrency,
} from "../src/domain/reportModel.mjs";
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

const currentSalesMetrics = getSalesMetrics([
  {fechaVenta: "2026-08-09", estado: "activa", total: 2500, moneda: "CLP"},
  {fechaVenta: "2026-08-10", estado: "preparada", total: 9000, moneda: "CLP"},
  {fechaVenta: "2026-08-11", estado: "cancelada", total: 8000, moneda: "CLP"},
], range);
assert.equal(currentSalesMetrics.count, 1);
assert.equal(currentSalesMetrics.total, 2500);

const mixedSalesMetrics = getSalesMetrics([
  {...sales[0], id: "clp", moneda: "CLP", total: 1000},
  {...sales[1], id: "usd", moneda: "USD", total: 20},
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
  {fechaCompra: "2026-08-06", estado: "confirmada", total: 2000, proveedorId: "p1"},
  {fechaCompra: "2026-08-07", estado: "confirmada", total: 4000, proveedorId: "p2"},
  {fechaCompra: "2026-08-08", estado: "cancelada", total: 10000, proveedorId: "p3"},
];
const purchaseMetrics = getPurchaseMetrics(purchases, range);
assert.equal(purchaseMetrics.count, 2);
assert.equal(purchaseMetrics.total, 6000);
assert.equal(purchaseMetrics.average, 3000);
assert.equal(purchaseMetrics.distinctProviders, 2);

const currentPurchaseMetrics = getPurchaseMetrics([
  {fechaCompra: "2026-08-12", estado: "activa", total: 700, moneda: "USD"},
  {fechaCompra: "2026-08-13", estado: "revertida", total: 300, moneda: "USD"},
  {fechaCompra: "2026-08-14", estado: "borrador", total: 200, moneda: "USD"},
], range, {currency: "USD"});
assert.equal(currentPurchaseMetrics.count, 1);
assert.equal(currentPurchaseMetrics.total, 700);

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
  sales: [{fechaVenta: "2026-08-15", estado: "activa", total: 10000, moneda: "CLP"}],
  purchases: [{fechaCompra: "2026-08-16", estado: "confirmada", total: 9000, moneda: "CLP"}],
  projectBalances,
  range,
});
assert.equal(simplified.currencies.find((entry) => entry.currency === "CLP").projects.total, 5000);
assert.notEqual(
  simplified.currencies.find((entry) => entry.currency === "CLP").projects.total,
  10000 - 9000
);
const emptySummary = getSimplifiedReportSummary({range, canViewProfitability: false});
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
    {key: "2026-08-01", currency: "CLP", sales: 1000, purchases: 300},
    {key: "2026-08-02", currency: "CLP", sales: 0, purchases: 500},
  ]
);
assert.deepEqual(combineOperationalTimelines([], []), []);

const reportPageSource = readFileSync("src/pages/StatisticsPage.jsx", "utf8");
const reportServiceSource = readFileSync("src/services/reportService.js", "utf8");
const operationalChartSource = readFileSync("src/components/reports/OperationalComparisonChart.jsx", "utf8");
const costCompositionSource = readFileSync("src/components/reports/CostCompositionChart.jsx", "utf8");
assert.match(reportPageSource, /Analiza ventas, compras y rentabilidad de tus proyectos\./);
assert.match(reportPageSource, /balance actual autoritativo y no se atribuye al período seleccionado/);
assert.match(reportPageSource, /Resultado de proyectos/);
assert.match(reportPageSource, /Rentabilidad de proyectos/);
assert.match(reportPageSource, /Las compras muestran egresos registrados del negocio/);
assert.match(reportPageSource, /openWorkId: project\.id/);
assert.match(reportPageSource, /canAccessBusinessPath\(role, "\/ventas"\)/);
assert.match(reportPageSource, /canAccessBusinessPath\(role, "\/compras"\)/);
assert.match(reportPageSource, /canAccessBusinessPath\(role, "\/trabajos"\)/);
assert.equal((reportPageSource.match(/<OperationalComparisonChart/g) || []).length, 1);
assert.match(operationalChartSource, /<Bar/);
assert.doesNotMatch(operationalChartSource, /operational-comparison-single/);
assert.match(operationalChartSource, /maxBarThickness: items\.length === 1 \? 36 : 24/);
assert.match(operationalChartSource, /animation: false/);
assert.match(operationalChartSource, /formatCompactMoney/);
assert.match(reportPageSource, /<CostCompositionChart currency=\{currency\} items=\{costItems\}/);
assert.match(reportPageSource, /group\.materials/);
assert.match(reportPageSource, /group\.labor/);
assert.match(reportPageSource, /group\.directExpenses/);
assert.match(reportPageSource, /group\.indirectExpenses/);
assert.match(reportPageSource, /reports-profitability-primary/);
assert.match(reportPageSource, /reports-profitability-secondary/);
assert.match(reportPageSource, /reports-chart-summary/);
assert.match(reportPageSource, /formatMoney\(group\.sales, group\.currency\)/);
assert.match(reportPageSource, /formatMoney\(group\.purchases, group\.currency\)/);
assert.match(costCompositionSource, /<Doughnut/);
assert.match(costCompositionSource, /animation: false/);
assert.match(costCompositionSource, /formatMoney\(context\.parsed, currency\)/);
assert.match(costCompositionSource, /formatMoney\(total, currency\)/);
assert.match(reportServiceSource, /BUSINESS_PERMISSIONS\.PROFITABILITY_READ/);
assert.match(reportServiceSource, /canViewProfitability \? listarTrabajos/);

console.log("Report model smoke: OK");
