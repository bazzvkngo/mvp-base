import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {formatCompactMoney} from "../src/utils/formatters.js";
import {describePeriod, describeProductsBar, describeProfitReasons, describeProjectsSummary} from "../src/domain/reportProfitOverview.mjs";
import {DEFAULT_ROW_LIMIT, buildShareBars, describeFlowSummary, describeProductBars, describeQuantity, describeRowsShown, limitRows, sortByDateDesc} from "../src/domain/reportFlowOverview.mjs";
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
// La nota señala la pestaña por su nombre, sin cifras de ganancia en esta vista.
assert.doesNotMatch(comprasViewSource.replace(/no es ganancia|pestaña Ganancia/g, ""), /[Gg]anancia/);
assert.match(comprasViewSource, /Cuánto ganas está en la pestaña Ganancia\./);
assert.doesNotMatch(comprasViewSource, /Rentabilidad y estado/);
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
// El estado del sistema sigue al final de Ganancia: vive dentro de `calculation`, que se dibuja después de la
// evolución, plegado en el <details> (el orden en el archivo ya no es el de la pantalla; lo prueba el render del bloque 2b).
assert.ok(gananciasViewSource.indexOf("<OperationalSystemStatus") < gananciasViewSource.indexOf("{foldCalculation ? <details"), "el estado del sistema está dentro del cálculo plegado");
assert.ok(gananciasViewSource.indexOf("{foldCalculation ? <details") > gananciasViewSource.indexOf("<MonthlyOperationalProfitChart"), "el cálculo, con el estado del sistema, se dibuja después de la evolución");
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
// Mes sin movimiento: el vacío ya lo dicen los $0 de las tarjetas; no hay una tarjeta extra que lo repita.
assert.match(monthlyViewSource, /isMonthEmpty\(groups\) && inProgress && \(canRegisterSale \|\| canRegisterPurchase\) && <div className="reports-month-actions">/);
assert.doesNotMatch(monthlyViewSource, /reports-month-empty|Registra tu primera venta/);
assert.equal((monthlyViewSource.match(/Aún no hay ventas confirmadas este mes|No hubo ventas confirmadas en/g) || []).length, 0, "el vacío no se repite en texto");
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
// "Ir a Ventas" y su permiso ahora viven en el aviso único (ReportsProfitNotice) y en cómo la pantalla lo alimenta.
const profitNoticeSource = readRequiredSource("src/features/reports/views/ReportsProfitNotice.jsx", "aviso único de la ganancia, SPEC 025 resumen visual");
assert.match(profitNoticeSource, /onNavigate\("\/ventas"\)/);
assert.match(monthlyProjectsSource, /links\.works/);
assert.match(monthlyViewSource, /canOpenSales: Boolean\(links\.sales\),/);
// Aviso accionable con su texto exacto, y estado por icono + texto (no solo color).
assert.match(profitNoticeSource, /Hay \{formatMoney\(line\.amount, currency, locale\)\} en servicios vendidos sin proyecto, y no entran en la ganancia\. Vincúlalos a un proyecto para saber si ganas o pierdes con ellos\./);
// Nueva: Proyectos del mes ya no lleva el aviso de incompletos ni el de servicios (los reúne el aviso único).
assert.doesNotMatch(monthlyProjectsSource, /datos están incompletos/);
assert.doesNotMatch(monthlyProjectsSource, /servicios vendidos sin proyecto|buildServicesWithoutProjectNotices|Ir a Ventas/);
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

// Resumen visual (SPEC 025), bloque 2: aviso único, tarjetas Vendí / Compré / Me quedó y círculo del margen.
const marginRingSource = readRequiredSource("src/features/reports/views/MarginRing.jsx", "círculo del margen, SPEC 025 resumen visual");
// Aviso único: reemplaza CoverageLine y los avisos sueltos.
assert.doesNotMatch(monthlyViewSource, /CoverageLine|reports-month-coverage|Cobertura parcial/);
assert.doesNotMatch(projectsCss, /\.reports-month-coverage|\.reports-month-projects__notice/, "el estilo de lo que se reemplazó ya no queda");
assert.match(monthlyViewSource, /buildProfitNoticeLines\(\{/);
assert.match(monthlyViewSource, /canViewProfitability,\s*coverage: group\.profit\?\.coverage,/);
assert.match(monthlyViewSource, /primary: index === 0,/, "lo que no es de una moneda va solo en la primera");
assert.match(monthlyViewSource, /const withoutNetCount = \(canViewSales \? summary\.sales\.withoutNetCount : 0\) \+\s*\(canViewPurchases \? summary\.purchases\.withoutNetCount : 0\);/, "los documentos sin neto cuentan solo los de Ventas y Compras que el perfil puede ver");
assert.match(monthlyViewSource, /notice=\{<ReportsProfitNotice currency=\{group\.currency\} lines=\{profitLines\}/, "el aviso va pegado a la tarjeta de ganancia");
assert.match(monthlyViewSource, /\{!showsProfitCard && <ReportsProfitNotice[^>]*variant="standalone" \/>\}/, "sin permiso de ganancia el aviso sigue existiendo, suelto");
assert.match(monthlyViewSource, /notes=\{projectsNotes\}/);
assert.match(profitNoticeSource, /<details/);
assert.match(profitNoticeSource, /<summary/);
assert.match(profitNoticeSource, /Parcial · \$\{review\}/);
assert.match(profitNoticeSource, /onOpenDetail\("ganancias"\)/);
// Tarjetas: Vendí, Compré y Me quedó (con "Ganancia" de subtítulo). Sin signos ni operadores entre ellas.
assert.match(monthlyViewSource, /title="Vendí">/);
assert.match(monthlyViewSource, /title="Compré">/);
assert.match(monthlyViewSource, /subtitle="Ganancia" title="Me quedó" variant="profit">/);
assert.doesNotMatch(monthlyViewSource, /\stitle="(Ventas|Compras|Ganancia)"/);
assert.match(monthlyViewSource, /<\/MonthlyCard>\}\s*\{canViewPurchases && <MonthlyCard/, "entre Vendí y Compré no hay nada");
assert.match(monthlyViewSource, /<\/MonthlyCard>\}\s*\{canViewProfitability && group\.profit && <MonthlyCard/, "entre Compré y Me quedó no hay nada");
assert.doesNotMatch(monthlyViewSource, />\s*[−=+×÷-]\s*</, "ningún operador suelto entre tarjetas: la ganancia no es ventas menos compras (SPEC 016 §E, 022 §4.3)");
assert.doesNotMatch(monthlyViewSource, /\{["'`]\s*[−=+×÷-]\s*["'`]\}/);
// Solo tokens: sin colores ni medidas sueltas en lo nuevo.
for (const [name, source] of [["aviso", profitNoticeSource], ["círculo", marginRingSource]]) {
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|style=\{\{/, `${name}: sin colores ni estilos en línea`);
}
const visualCss = projectsCss.slice(projectsCss.indexOf("/* Resumen visual (SPEC 025)"), projectsCss.indexOf(".reports-simple-eyebrow,"));
assert.ok(visualCss.includes(".reports-ring__arc") && visualCss.includes(".reports-profit-notice__chip"), "debe existir el bloque de estilos del resumen visual");
assert.doesNotMatch(visualCss, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|box-shadow|border-radius:\s*\d|transition|animation/);
assert.doesNotMatch(visualCss, /(?:color|fill|stroke):\s*var\(--color-(?:brand-(?:600|700|800|900)|dark-)/, "nada de colores que no cambian con el tema como texto o trazo");
for (const token of ["--color-success-700", "--color-danger-700", "--color-danger-200", "--color-border-subtle", "--color-warning-50", "--color-warning-800"]) {
  assert.ok(visualCss.includes(`var(${token})`), `usa el token ${token}`);
}

// Render de la pantalla (SSR, sin navegador): permisos, aviso único, círculo y tarjetas.
const summaryVite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const [{default: ReportsMonthlySummary}, {default: ReportsProfitNotice}, {default: MarginRing}] = await Promise.all([
    summaryVite.ssrLoadModule("/src/features/reports/views/ReportsMonthlySummary.jsx"),
    summaryVite.ssrLoadModule("/src/features/reports/views/ReportsProfitNotice.jsx"),
    summaryVite.ssrLoadModule("/src/features/reports/views/MarginRing.jsx"),
  ]);
  const html = (element) => plain(renderToStaticMarkup(element));
  const count = (text, pattern) => (text.match(pattern) || []).length;

  // Círculo.
  const ringOf = (input) => html(React.createElement(MarginRing, {description: describeProfitMargin(input), locale: "es-CL"}));
  const ringPositive = ringOf({marginPct: 23.456, consideredRevenue: 800000, salesTotal: 1000000});
  assert.match(ringPositive, /class="reports-ring reports-ring--up" role="img" aria-label="De cada \$100 que vendes, te quedan \$23,5, sobre \$800\.000 de ventas consideradas"/);
  assert.match(ringPositive, /stroke-dasharray="23\.46 100"/, "el arco mide el margen");
  assert.match(ringPositive, />23,5 %</);
  assert.match(ringPositive, /<svg[^>]*aria-hidden="true"/, "el trazo es decorativo para lectores de pantalla");
  const ringFull = ringOf({marginPct: 150});
  assert.match(ringFull, /stroke-dasharray="100 100"/, "más de 100 % llena el círculo");
  assert.match(ringFull, />150 %</, "el número es el real");
  for (const [label, input, text, tone] of [
    ["negativo", {marginPct: -12.34}, "−12,3 %", "down"],
    ["muy negativo", {marginPct: -500}, "−500 %", "down"],
    ["cero", {marginPct: 0}, "0 %", "none"],
    ["sin margen", {marginPct: null}, "—", "none"],
  ]) {
    const ring = ringOf(input);
    assert.doesNotMatch(ring, /reports-ring__arc/, `${label}: el círculo queda vacío`);
    assert.match(ring, new RegExp(`reports-ring--${tone}`), `${label}: tono ${tone}`);
    assert.ok(ring.includes(`>${text}<`), `${label}: el centro dice ${text}`);
  }
  assert.match(ringOf({marginPct: -12.34}), /pierdes \$12,3/, "el sentido también está en la etiqueta accesible");
  assert.equal(ringOf({marginPct: 10, status: "loading"}), "", "con la ganancia sin listar no hay círculo");
  assert.match(ringOf({marginPct: 10, coverage: "partial"}), /Cobertura parcial/);

  // Aviso único (componente).
  const noticeHtml = (overrides = {}, props = {}) => html(React.createElement(ReportsProfitNotice, {
    currency: "CLP", locale: "es-CL", onNavigate: () => {}, onOpenDetail: () => {},
    lines: buildProfitNoticeLines({canViewProfitability: true, canOpenSales: true, ...overrides}), ...props,
  }));
  assert.equal(noticeHtml(), "", "sin nada que avisar no se dibuja nada");
  const fullNotice = noticeHtml({coverage: "partial", incompleteCount: 2, servicesAmount: 15000, withoutNetCount: 1});
  assert.match(fullNotice, /<details class="reports-profit-notice reports-profit-notice--card reports-profit-notice--partial">/);
  assert.match(fullNotice, /<summary class="reports-profit-notice__chip">[\s\S]*?<span>Parcial · 3 cosas por revisar<\/span>/);
  assert.ok(fullNotice.includes("La ganancia del mes es parcial: hay registros que no se incluyen. 2 proyectos con movimiento no se muestran porque sus datos están incompletos."));
  assert.ok(fullNotice.includes("Hay $15.000 en servicios vendidos sin proyecto, y no entran en la ganancia. Vincúlalos a un proyecto para saber si ganas o pierdes con ellos."));
  assert.ok(fullNotice.includes("Hay 1 documento confirmado sin neto válido, que no se suma en Ventas y Compras."));
  assert.equal(count(fullNotice, /Ver estado del sistema/g), 1);
  assert.equal(count(fullNotice, /Ir a Ventas/g), 1);
  assert.doesNotMatch(noticeHtml({servicesAmount: 15000, canOpenSales: false}), /Ir a Ventas/, "sin permiso de Ventas no hay botón");
  assert.match(noticeHtml({servicesAmount: 15000}), /<span>1 cosa por revisar<\/span>/);
  assert.doesNotMatch(noticeHtml({servicesAmount: 15000}), /Parcial/, "sin cobertura parcial no se dice Parcial");
  assert.match(noticeHtml({coverage: "partial"}), /<span>Parcial · 1 cosa por revisar<\/span>/);
  assert.match(noticeHtml({withoutNetCount: 2}, {variant: "standalone"}), /reports-profit-notice--standalone/);

  // Pantalla completa.
  const marginProfit = {status: "ready", error: "", result: {grupos: [{moneda: "CLP", gananciaNetaOperacional: 500, cobertura: "PARCIAL", gananciaNetaOperacionalPct: 25, ingresoNetoConsiderado: 2000}]}};
  const screenProps = (overrides = {}) => ({
    canRegisterPurchase: true, canRegisterSale: true, canViewProfitability: true, canViewPurchases: true, canViewSales: true,
    currency: "todos", links: {sales: true, purchases: true, works: true}, month: "2026-10",
    onMonthChange: () => {}, onNavigate: () => {}, onOpenDetail: () => {}, onRetryProfit: () => {},
    previousProfit: readyProfit(300), previousSummary: monthlySummaryOf(monthRangeSeptember), profit: marginProfit,
    projects: {status: "ready", error: "", meta: {proyectos: projectFixtures, fallidos: []}},
    summary: octoberSummary, todayKey: "2026-10-15", ...overrides,
  });
  const screen = (overrides) => html(React.createElement(ReportsMonthlySummary, screenProps(overrides)));
  const full = screen();
  assert.ok(full.indexOf(">Vendí<") < full.indexOf(">Compré<") && full.indexOf(">Compré<") < full.indexOf(">Me quedó<"), "orden: Vendí, Compré, Me quedó");
  assert.match(full, /class="reports-simple-card__subtitle">Ganancia</);
  assert.doesNotMatch(full, /<span class="reports-simple-card__title">(Ventas|Compras|Ganancia)</);
  assert.match(full, /reports-simple-card--profit/);
  assert.match(full, /reports-ring reports-ring--up/);
  assert.ok(full.includes("De cada $100 que vendes, te quedan $25"));
  assert.ok(full.includes("sobre $2.000 de ventas consideradas"), "la base difiere de Vendí ($3.000): se aclara");
  assert.match(full, /<summary class="reports-profit-notice__chip">[\s\S]*?<span>Parcial · 2 cosas por revisar<\/span>/, "Parcial siempre visible, con sus 2 cosas por revisar");
  assert.ok(full.includes("1 proyecto con movimiento no se muestra porque sus datos están incompletos."));
  assert.equal(count(full, /Hay 1 documento confirmado sin neto válido/g), 1, "los documentos sin neto se avisan una sola vez");
  assert.equal(count(full, /Ver estado del sistema/g), 1);
  assert.doesNotMatch(full, /reports-month-coverage|reports-v4-badge/, "la línea de cobertura y su insignia ya no existen");
  assert.match(full, /aria-label="[^"]*\. Cobertura parcial"/, "pero el círculo dice en su etiqueta accesible que la ganancia es parcial");
  const projectsSection = full.slice(full.indexOf('<section class="erp-card reports-month-projects"'), full.indexOf("</section>", full.indexOf('<section class="erp-card reports-month-projects"')));
  assert.ok(projectsSection.length > 100 && projectsSection.includes("Proyectos del mes"));
  assert.doesNotMatch(projectsSection, /datos están incompletos|servicios vendidos sin proyecto/, "Proyectos del mes ya no lleva avisos propios");
  // Ganancia sin listar: sin círculo ni frase.
  const loadingScreen = screen({profit: {status: "loading"}});
  assert.doesNotMatch(loadingScreen, /reports-ring|De cada \$100/);
  assert.match(loadingScreen, /Calculando ganancia/);
  // Sin ventas consideradas (margen null) y margen negativo.
  const noMarginProfit = {status: "ready", error: "", result: {grupos: [{moneda: "CLP", gananciaNetaOperacional: 0, cobertura: "COMPLETA"}]}};
  assert.ok(screen({profit: noMarginProfit}).includes("Aún no hay ventas para calcular el margen"));
  const lossProfit = {status: "ready", error: "", result: {grupos: [{moneda: "CLP", gananciaNetaOperacional: -300, cobertura: "COMPLETA", gananciaNetaOperacionalPct: -12.3, ingresoNetoConsiderado: 3000}]}};
  const lossScreen = screen({profit: lossProfit});
  assert.match(lossScreen, /reports-ring reports-ring--down/);
  assert.ok(lossScreen.includes("De cada $100 que vendes, pierdes $12,3"));
  assert.match(lossScreen, /reports-profit-card__amount--down/);
  assert.doesNotMatch(lossScreen, /sobre \$[\d.]+ de ventas consideradas/, "base igual a Vendí: sin nota");

  // Permisos de Ventas y Compras para la línea de documentos sin neto.
  const salesNoNet = monthlySummaryOf(monthRangeOctober, [...monthlySales, {fechaVenta: "2026-10-09", estado: "confirmada", total: 1190, moneda: "CLP"}], []);
  assert.equal(salesNoNet.sales.withoutNetCount, 1);
  assert.equal(salesNoNet.purchases.withoutNetCount, 0);
  const noProfit = {canViewProfitability: false};
  const withoutProfitCard = screen({...noProfit});
  assert.doesNotMatch(withoutProfitCard, /Me quedó|reports-ring|reports-month-projects/, "sin permiso de ganancia no hay tarjeta, círculo ni proyectos");
  assert.match(withoutProfitCard, /reports-profit-notice--standalone/, "pero el aviso de documentos sin neto sigue, suelto");
  assert.ok(withoutProfitCard.includes("Hay 1 documento confirmado sin neto válido"));
  assert.match(withoutProfitCard, /<span>1 cosa por revisar<\/span>/);
  assert.doesNotMatch(screen({...noProfit, canViewPurchases: false}), /reports-profit-notice/, "solo Ventas: la compra sin neto no se cuenta ni se avisa");
  assert.ok(screen({...noProfit, canViewSales: false}).includes("Hay 1 documento confirmado sin neto válido"), "solo Compras: se avisa su compra sin neto");
  assert.ok(screen({...noProfit, canViewPurchases: false, summary: salesNoNet}).includes("Hay 1 documento confirmado sin neto válido"), "solo Ventas: se avisa su venta sin neto");
  assert.doesNotMatch(screen({...noProfit, canViewSales: false, summary: salesNoNet}), /sin neto válido/, "solo Compras: la venta sin neto de Ventas no se cuenta");
  assert.doesNotMatch(screen({...noProfit, canViewSales: false, canViewPurchases: false}), /reports-profit-notice|Vendí|Compré/, "sin ningún permiso no hay tarjetas ni aviso");

  // Varias monedas: el conteo de incompletos va una vez, en Proyectos del mes; lo que no es de una moneda, solo en la primera.
  const multiSummary = monthlySummaryOf(monthRangeOctober, [...monthlySales, {fechaVenta: "2026-10-02", estado: "confirmada", neto: 300, total: 357, moneda: "USD"}]);
  const multiProfit = {status: "ready", error: "", result: {grupos: [
    {moneda: "CLP", gananciaNetaOperacional: 500, cobertura: "PARCIAL", gananciaNetaOperacionalPct: 25, ingresoNetoConsiderado: 2000},
    {moneda: "USD", gananciaNetaOperacional: 30, cobertura: "COMPLETA", gananciaNetaOperacionalPct: 10, ingresoNetoConsiderado: 300},
  ]}};
  const multi = screen({summary: multiSummary, profit: multiProfit});
  assert.equal(count(multi, /<details class="reports-profit-notice/g), 1, "solo la moneda con algo que avisar lleva aviso");
  assert.equal(count(multi, /1 proyecto con movimiento no se muestra porque sus datos están incompletos\./g), 1, "el conteo de incompletos va una sola vez");
  assert.equal(count(multi.slice(multi.indexOf('<section class="erp-card reports-month-projects"')), /1 proyecto con movimiento no se muestra porque sus datos están incompletos\./g), 1, "y va en Proyectos del mes");
  assert.equal(count(multi, /Hay 1 documento confirmado sin neto válido/g), 1, "los documentos sin neto, una sola vez");
  assert.match(multi, /<span>Parcial · 2 cosas por revisar<\/span>/);
  assert.equal(count(multi, /reports-ring reports-ring--up/g), 2, "un círculo por moneda");
} finally {
  await summaryVite.close();
}
console.log("OK reportes SPEC 025 (resumen visual, bloque 2): aviso único con Parcial siempre visible, tarjetas Vendí / Compré / Me quedó, círculo del margen y permisos de la línea de documentos sin neto");

// Pulido del resumen visual: tarjetas alineadas arriba, círculo mayor y grueso, chip táctil y vacíos sin repetir.
assert.match(visualCss, /\.reports-simple-metrics--visual \{[^}]*align-items: flex-start;/, "Vendí y Compré no se estiran hasta la altura de Me quedó");
assert.match(visualCss, /\.reports-simple-metrics--visual > \.reports-simple-card \{[^}]*align-content: start;[^}]*min-height: 0;/);
assert.match(visualCss, /\.reports-profit-card__body \{[^}]*align-items: flex-start;/, "el círculo se alinea arriba, con el monto");
assert.match(visualCss, /\.reports-ring \{[^}]*height: calc\(var\(--space-10\) \* 2\.75\);[^}]*width: calc\(var\(--space-10\) \* 2\.75\);/);
assert.equal((visualCss.match(/stroke-width: 6;/g) || []).length, 2, "pista y arco con el trazo grueso");
assert.match(visualCss, /@media \(max-width: 640px\) \{[\s\S]*?\.reports-profit-notice__chip \{\s*min-height: calc\(var\(--space-10\) \+ var\(--space-1\)\);/, "zona táctil de 44 px (2,75 rem) del chip en móvil");
assert.doesNotMatch(projectsCss, /\.reports-month-empty/, "el estilo de la tarjeta de vacío repetido ya no existe");
assert.match(marginRingSource, /<circle className="reports-ring__track"/);
{
  const summaryVite2 = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
  try {
    const {default: ReportsMonthlySummary} = await summaryVite2.ssrLoadModule("/src/features/reports/views/ReportsMonthlySummary.jsx");
    const html = (props) => plain(renderToStaticMarkup(React.createElement(ReportsMonthlySummary, {
      canRegisterPurchase: true, canRegisterSale: true, canViewProfitability: true, canViewPurchases: true, canViewSales: true,
      currency: "todos", links: {sales: true, purchases: true, works: true}, month: "2026-10",
      onMonthChange: () => {}, onNavigate: () => {}, onOpenDetail: () => {}, onRetryProfit: () => {},
      projects: {status: "ready", error: "", meta: {proyectos: [], fallidos: []}}, todayKey: "2026-10-15", ...props,
    })));
    const emptyProfit = {status: "ready", error: "", result: {grupos: [{moneda: "CLP", gananciaNetaOperacional: null, cobertura: "SIN_DATOS"}]}};
    const emptyProps = (month, extra = {}) => ({
      month, profit: emptyProfit, previousProfit: emptyProfit,
      summary: monthlySummaryOf(getMonthRange(month), [], []), previousSummary: monthlySummaryOf(getMonthRange(shiftMonthKey(month, -1)), [], []), ...extra,
    });
    const countOf = (text, pattern) => (text.match(pattern) || []).length;
    const marginProfit = {status: "ready", error: "", result: {grupos: [{moneda: "CLP", gananciaNetaOperacional: 500, cobertura: "PARCIAL", gananciaNetaOperacionalPct: 25, ingresoNetoConsiderado: 2000}]}};
    const screen = (props) => html({
      profit: marginProfit, previousProfit: readyProfit(300), previousSummary: monthlySummaryOf(monthRangeSeptember), summary: octoberSummary,
      projects: {status: "ready", error: "", meta: {proyectos: projectFixtures, fallidos: []}}, ...props,
    });
    const full = screen({});
    // Mes en curso sin movimiento: los $0 de las tarjetas, sin tarjeta extra, y las dos acciones una sola vez.
    const emptyCurrent = html(emptyProps("2026-10"));
    assert.ok(countOf(emptyCurrent, /\$0</g) >= 2, "los $0 están en las tarjetas");
    assert.doesNotMatch(emptyCurrent, /reports-month-empty|Aún no hay ventas confirmadas|Registra tu primera venta|No hubo ventas confirmadas/);
    assert.equal(countOf(emptyCurrent, /class="reports-month-actions"/g), 1);
    assert.ok(emptyCurrent.includes("Registrar venta") && emptyCurrent.includes("Registrar compra"));
    assert.doesNotMatch(html(emptyProps("2026-10", {canRegisterSale: false, canRegisterPurchase: false})), /reports-month-actions/, "sin permiso de registrar no hay acciones");
    assert.equal(countOf(html(emptyProps("2026-10", {canRegisterPurchase: false})), /Registrar compra/g), 0);
    // Mes pasado sin movimiento: solo los $0, ni tarjeta ni acciones.
    const emptyPast = html(emptyProps("2026-09"));
    assert.ok(countOf(emptyPast, /\$0</g) >= 2);
    assert.doesNotMatch(emptyPast, /reports-month-empty|reports-month-actions|No hubo ventas confirmadas|Aún no hay ventas confirmadas/);
    // Con movimiento no hay acciones de "primera venta".
    assert.doesNotMatch(full, /reports-month-actions/);
    // Sin permiso de Ventas no se muestra la nota "sobre $N de ventas consideradas" (aunque la base difiera).
    assert.ok(screen({}).includes("sobre $2.000 de ventas consideradas"));
    const noSalesPermission = screen({canViewSales: false});
    assert.doesNotMatch(noSalesPermission, /sobre \$[\d.]+ de ventas consideradas/);
    assert.ok(noSalesPermission.includes("De cada $100 que vendes, te quedan $25"), "la frase del margen sigue");
    assert.doesNotMatch(noSalesPermission, />Vendí</);
    // La fila del título va arriba y a todo el ancho; el círculo queda junto al monto, no junto al título.
    const profitCard = full.slice(full.indexOf("reports-simple-card--profit"));
    assert.ok(profitCard.indexOf("reports-simple-card__top") < profitCard.indexOf("reports-profit-card__body"), "título arriba");
    assert.ok(profitCard.indexOf("reports-profit-card__body") < profitCard.indexOf("reports-ring ") && profitCard.indexOf("reports-ring ") < profitCard.indexOf("reports-simple-card__amount"), "el círculo está en el cuerpo, junto al monto");
  } finally {
    await summaryVite2.close();
  }
}
console.log("OK reportes SPEC 025 (resumen visual, pulido): tarjetas alineadas arriba, círculo mayor, chip táctil de 44 px, mes sin ventas sin vacío repetido y sin nota de base sin permiso de Ventas");

// Pulido de Compras: un solo mensaje de vacío y el gráfico solo si hay ventas o compras.
assert.doesNotMatch(comprasViewSource, /Sin compras confirmadas en el período/);
assert.equal((comprasViewSource.match(/Aún no hay compras confirmadas en este período/g) || []).length, 1, "un solo mensaje de vacío en Compras");
assert.match(comprasViewSource, /chartGroupsWithData\.length > 0 && <section className="erp-card reports-simple-chart">/);
assert.match(comprasViewSource, /\{hasPurchases && <section className="erp-card reports-detail-section">\s*<div className="reports-section-heading"><div><span>Operaciones<\/span>/);
{
  const comprasVite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
  try {
    const {default: ReportsComprasView} = await comprasVite.ssrLoadModule("/src/features/reports/views/ReportsComprasView.jsx");
    const range = {start: "2026-09-01", end: "2026-09-30", days: 30};
    const countOf = (text, pattern) => (text.match(pattern) || []).length;
    const renderCompras = (sales, purchases, extra = {}) => {
      const summary = getSimplifiedReportSummary({sales, purchases, projectBalances: [], range});
      const salesTimeline = aggregateOperationalTimeline(summary.sales.confirmed, {range, dateField: "fechaVenta"});
      const purchaseTimeline = aggregateOperationalTimeline(summary.purchases.confirmed, {range, dateField: "fechaCompra"});
      const timeline = combineOperationalTimelines(salesTimeline, purchaseTimeline);
      const chartGroups = summary.currencies.map((group) => ({
        currency: group.currency, items: timeline.filter((item) => item.currency === group.currency), purchases: group.purchases.total, sales: group.sales.total,
      }));
      return plain(renderToStaticMarkup(React.createElement(ReportsComprasView, {
        canOpenPurchases: true, chartGroups, navigate: () => {}, purchaseTimeline, summary, topPurchaseProducts: [], topPurchaseSuppliers: [], ...extra,
      })));
    };
    const septemberSale = {ventaId: "v1", estado: "confirmada", moneda: "CLP", fechaVenta: "2026-09-10", neto: 1000, total: 1190, items: []};
    const septemberPurchase = {compraId: "c1", numero: "C-1", estado: "confirmada", moneda: "CLP", fechaCompra: "2026-09-12", neto: 400, total: 476, proveedorSnapshot: {razonSocial: "Proveedor Uno"}};
    // Mes sin ventas ni compras: un solo mensaje, sin gráfico, sin su nota y sin listado.
    const nothing = renderCompras([], []);
    assert.equal(countOf(nothing, /Aún no hay compras confirmadas en este período\./g), 1);
    assert.doesNotMatch(nothing, /Sin compras confirmadas en el período|Aún no hay ventas ni compras confirmadas|Compras del período|Comparar ventas y compras no es ganancia|Movimiento comercial/);
    assert.ok(countOf(nothing, /\$0</g) === 1 && nothing.includes("0 operación(es)"), "el $0 y el conteo siguen en las tarjetas");
    assert.ok(nothing.includes("Ir a Compras"), "el único mensaje lleva su acceso con permiso");
    assert.ok(!renderCompras([], [], {canOpenPurchases: false}).includes("Ir a Compras"), "sin permiso no hay acceso");
    // Mes con una venta y sin compras: el gráfico y su nota siguen; el vacío se dice una sola vez.
    const salesOnly = renderCompras([septemberSale], []);
    assert.ok(salesOnly.includes("Movimiento comercial") && salesOnly.includes("Comparar ventas y compras no es ganancia."), "el gráfico sigue con ventas");
    assert.ok(salesOnly.includes("Ventas confirmadas") && salesOnly.includes("$1.000"));
    assert.equal(countOf(salesOnly, /Aún no hay compras confirmadas en este período\./g), 1);
    assert.doesNotMatch(salesOnly, /Sin compras confirmadas en el período|Compras del período/);
    assert.ok(salesOnly.includes("Cuánto ganas está en la pestaña Ganancia."));
    // Mes con compras: sin mensaje de vacío, con el listado y el gráfico.
    const withPurchases = renderCompras([], [septemberPurchase]);
    assert.doesNotMatch(withPurchases, /Aún no hay compras confirmadas en este período/);
    assert.ok(withPurchases.includes("Compras del período") && withPurchases.includes("Proveedor Uno") && withPurchases.includes("Movimiento comercial"));
  } finally {
    await comprasVite.close();
  }
}
console.log("OK reportes Compras (limpieza): un solo mensaje de vacío, gráfico solo con ventas o compras, nota con la pestaña Ganancia");
// Monto abreviado compartido de los ejes: una sola función, sufijo en mayúscula y signo bien formado.
{
  const profitChartsSource2 = readFileSync("src/components/reports/OperationalProfitCharts.jsx", "utf8");
  for (const [name, source] of [["OperationalProfitCharts", profitChartsSource2], ["OperationalComparisonChart", operationalChartSource]]) {
    assert.match(source, /import \{formatCompactMoney, formatMoney\} from "\.\.\/\.\.\/utils\/formatters";/, `${name} importa la función compartida`);
    assert.doesNotMatch(source, /function formatCompactMoney|notation: "compact"/, `${name} no define su propia versión`);
    assert.match(source, /formatCompactMoney\(value, currency, businessLocale\)/, `${name} usa el locale del negocio en el eje`);
  }
  assert.equal((readFileSync("src/utils/formatters.js", "utf8").match(/export function formatCompactMoney/g) || []).length, 1);
  const axisValues = [0, 5000, 10000, 15000, 25000, 143089, 1500000, 2500000];
  for (const locale of ["es-CL", "es-MX", "es-AR", "es"]) {
    for (const currency of ["CLP", "USD"]) {
      // Un mismo eje: ninguna marca con "k" minúscula, aunque el ICU la entregue así (es-MX).
      const ticks = axisValues.map((value) => formatCompactMoney(value, currency, locale));
      assert.ok(ticks.every((tick) => !/k/.test(tick)), `${locale} ${currency}: sin "k" minúscula en ${ticks.join(" | ")}`);
      assert.ok(ticks.every((tick) => !/[-−]/.test(tick)), `${locale} ${currency}: los positivos no llevan signo`);
      // Negativos: un solo signo, al comienzo, y el mismo sufijo que su positivo.
      for (const value of [300000, 15000, 1500, 1500000]) {
        const negative = formatCompactMoney(-value, currency, locale);
        const positive = formatCompactMoney(value, currency, locale);
        assert.equal((negative.match(/[-−]/g) || []).length, 1, `${locale} ${currency}: un solo signo en ${negative}`);
        assert.match(negative, /^[-−]/, `${locale} ${currency}: el signo va primero en ${negative}`);
        assert.equal(negative.slice(1), positive, `${locale} ${currency}: ${negative} es el negativo de ${positive}`);
      }
      assert.ok(!/[-−]/.test(formatCompactMoney(-0, currency, locale)), `${locale} ${currency}: el cero negativo no lleva signo`);
    }
  }
  // Valores concretos en el formato del negocio piloto.
  assert.equal(formatCompactMoney(15000, "CLP", "es-CL").replace(/\s/g, " "), "$15 K");
  assert.equal(formatCompactMoney(5000, "CLP", "es-CL").replace(/\s/g, " "), "$5 K");
  assert.equal(formatCompactMoney(-300000, "CLP", "es-CL").replace(/\s/g, " "), "-$300 K");
  assert.equal(formatCompactMoney(1500000, "CLP", "es-CL").replace(/\s/g, " "), "$1,5 M");
  assert.equal(formatCompactMoney(0, "CLP", "es-CL"), "$0");
  assert.equal(formatCompactMoney(undefined, "CLP"), "$0");
  assert.equal(formatCompactMoney("no", "CLP"), "$0");
}
console.log("OK reportes (formato compacto): una sola formatCompactMoney con sufijo en mayúscula y signo bien formado en es-CL, es-MX, es-AR y es");
// Gráfico de Ganancia: leyenda solo con series con datos y, con un solo mes, el valor en texto.
{
  const monthlyChartSource = readFileSync("src/components/reports/OperationalProfitCharts.jsx", "utf8");
  assert.match(monthlyChartSource, /const \{ locale: businessLocale \} = useBusinessFormat\(\);\s*const \{tokens, axis\} = useChartChrome\(\);/, "businessLocale sale de useBusinessFormat");
  assert.match(monthlyChartSource, /datasets: series\.map\(/, "los conjuntos de datos salen de las series con datos");
  assert.doesNotMatch(monthlyChartSource, /margenVentas\s*\+|\+\s*[\w.]*resultadoProyectos/, "la vista no suma componentes");
  assert.doesNotMatch(monthlyChartSource, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "sin colores literales");
  const chartsVite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
  try {
    const {MonthlyOperationalProfitChart, profitSeriesWithData} = await chartsVite.ssrLoadModule("/src/components/reports/OperationalProfitCharts.jsx");
    const month = (mes, margenVentas, resultadoProyectos, parcial = false) => ({mes, margenVentas, resultadoProyectos, ganancia: margenVentas + resultadoProyectos, parcial});
    const labelsOf = (months) => profitSeriesWithData(months).map((entry) => entry.label);
    assert.deepEqual(labelsOf([month("2026-08", 100, 0), month("2026-09", 0, 50)]), ["Ganancia por productos", "Resultado de proyectos"]);
    assert.deepEqual(labelsOf([month("2026-08", 100, 0), month("2026-09", 20, 0)]), ["Ganancia por productos"], "sin proyectos no hay serie de proyectos");
    assert.deepEqual(labelsOf([month("2026-08", 0, -30), month("2026-09", 0, 0)]), ["Resultado de proyectos"], "un valor negativo cuenta como dato");
    assert.deepEqual(labelsOf([month("2026-08", 0, 0), month("2026-09", 0, 0)]), []);
    assert.deepEqual(labelsOf([{mes: "2026-08", margenVentas: null, resultadoProyectos: undefined}]), [], "null y undefined no cuentan");
    const chart = (months) => plain(renderToStaticMarkup(React.createElement(MonthlyOperationalProfitChart, {currency: "CLP", months})));
    // Un solo mes: texto con los valores que ya trae el helper, sin gráfico.
    const single = chart([month("2026-09", 200, 300)]);
    assert.ok(single.includes("Ganancia de septiembre de 2026: <strong>$500</strong> (productos $200, proyectos $300)"), single);
    assert.doesNotMatch(single, /<canvas|financial-chart|role="img"/);
    assert.ok(chart([month("2026-09", 200, -300)]).includes("Ganancia de septiembre de 2026: <strong>$-100</strong> (productos $200, proyectos $-300)"), "los negativos salen con el formato de formatMoney");
    assert.ok(chart([month("2026-09", 0, 0)]).includes("<strong>$0</strong> (productos $0, proyectos $0)"), "un mes sin movimiento también va en texto");
    assert.ok(chart([month("2026-09", 200, 300, true)]).includes("Ganancia de septiembre de 2026 *: "), "el mes parcial lleva el asterisco que explica la nota de la vista");
    // Varios meses: el gráfico, con su descripción accesible; sin el texto del mes único.
    const several = chart([month("2026-08", 100, 0), month("2026-09", 40, 0)]);
    assert.ok(several.includes("<canvas") && several.includes('aria-label="Ganancia por mes. 2026-08: $100. 2026-09: $40."'), several);
    assert.doesNotMatch(several, /reports-monthly-single/);
    assert.ok(chart([month("2026-08", 0, 0), month("2026-09", 0, 0)]).includes("Sin ganancia registrada en los meses del período."));
    assert.ok(chart([]).includes("Sin meses con datos en el período."));
  } finally {
    await chartsVite.close();
  }
  const profitCss = readFileSync("src/styles/interior.css", "utf8");
  assert.match(profitCss, /\.reports-monthly-single \{[^}]*color: var\(--color-text-default\);[^}]*font-size: var\(--font-size-md\);/);
  assert.match(profitCss, /\.reports-monthly-single strong \{[^}]*color: var\(--color-text-strong\);/);
}
console.log("OK reportes (gráfico de Ganancia): leyenda solo con series con datos y, con un solo mes, el valor en texto con los componentes del helper");
// Ganancia visual, bloque 1: helpers puros de la barra, del "por qué" y de la tarjeta de proyectos.
{
  const norm = (text) => String(text).replace(/\s/g, " ");
  const zeroProjects = {proyectos: 0, ingresoNeto: 0, materialesVenta: 0, materialesAdicionales: 0, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: 0, resultado: 0};
  const overviewGroup = ({revenue = 0, cost = 0, profit = 0, moneda = "CLP", projects = {}, ...rest} = {}) => ({
    moneda, agregable: true, cobertura: "COMPLETA",
    componentes: {ventasSinProyecto: {ventas: 1, ingresoNetoProductos: revenue, costoHistoricoProductos: cost, margenBrutoProductos: profit}, proyectos: {...zeroProjects, ...projects}},
    ventasSinCostoRegistrado: {ventas: 0, monto: 0}, alertas: [], ...rest,
  });

  // --- Barra: cifras de la maqueta (octubre de 2026) ---
  const mockupGroup = overviewGroup({revenue: 83089, cost: 66473, profit: 16616});
  const frozenBefore = JSON.stringify(mockupGroup);
  const mockupBar = describeProductsBar(mockupGroup);
  assert.equal(JSON.stringify(mockupGroup), frozenBefore, "el helper no modifica el grupo");
  assert.deepEqual([mockupBar.show, mockupBar.kind], [true, "profit"]);
  assert.equal(norm(mockupBar.title), "De los $83.089 que vendiste en productos");
  assert.equal(mockupBar.scopeLabel, "de productos");
  assert.deepEqual([mockupBar.costPercent, mockupBar.profitPercent], [80, 20]);
  assert.deepEqual(mockupBar.legend.map((item) => norm(item.text)), ["Costo de lo vendido · 80 %", "Ganancia de productos · 20 %"]);
  assert.deepEqual(mockupBar.legend.map((item) => item.amount), [66473, 16616]);
  assert.deepEqual(mockupBar.segments.map((segment) => [segment.id, segment.flex]), [["cost", 66473], ["profit", 16616]], "el ancho relativo es el propio importe");
  assert.ok(Math.abs(mockupBar.segments[0].width - 0.8) < 0.001 && Math.abs(mockupBar.segments[1].width - 0.2) < 0.001);
  assert.ok(Math.abs(mockupBar.segments.reduce((total, segment) => total + segment.width, 0) - 1) < 0.001, "los tramos llenan la barra");
  assert.equal(norm(mockupBar.ariaLabel), "De los $83.089 que vendiste en productos: costo de lo vendido $66.473 (80 %) y ganancia $16.616 (20 %).");
  // Los porcentajes ya redondeados suman 100: enteros si cuadran, un decimal si no.
  const halves = describeProductsBar(overviewGroup({revenue: 1000, cost: 335, profit: 665}));
  assert.deepEqual([halves.costPercent, halves.profitPercent], [33.5, 66.5]);
  assert.deepEqual(halves.legend.map((item) => norm(item.text)), ["Costo de lo vendido · 33,5 %", "Ganancia de productos · 66,5 %"]);
  const thirds = describeProductsBar(overviewGroup({revenue: 3, cost: 1, profit: 2}));
  assert.deepEqual([thirds.costPercent, thirds.profitPercent], [33, 67]);
  for (const [revenue, cost] of [[7, 3], [9, 4], [1000, 123], [90000, 33333], [83089, 12345]]) {
    const bar = describeProductsBar(overviewGroup({revenue, cost, profit: revenue - cost}));
    assert.ok(Math.abs(bar.costPercent + bar.profitPercent - 100) < 1e-9, `${cost}/${revenue}: los porcentajes redondeados suman 100`);
  }
  // Solo costo (ganancia 0): toda la barra es costo.
  const breakEven = describeProductsBar(overviewGroup({revenue: 1000, cost: 1000, profit: 0}));
  assert.deepEqual([breakEven.kind, breakEven.costPercent, breakEven.profitPercent], ["break-even", 100, 0]);
  assert.deepEqual(breakEven.segments.map((segment) => segment.id), ["cost"]);
  assert.equal(norm(breakEven.legend[1].text), "Ganancia de productos · 0 %");
  // Sin costo: toda la barra es ganancia.
  const profitOnly = describeProductsBar(overviewGroup({revenue: 500, cost: 0, profit: 500}));
  assert.deepEqual([profitOnly.kind, profitOnly.costPercent, profitOnly.profitPercent], ["profit-only", 0, 100]);
  assert.deepEqual(profitOnly.segments.map((segment) => [segment.id, segment.width]), [["profit", 1]]);
  // Pérdida: la barra es toda costo y la pérdida va en la leyenda, sin tramo de ganancia.
  const loss = describeProductsBar(overviewGroup({revenue: 1000, cost: 1200, profit: -200}));
  assert.deepEqual([loss.kind, loss.costPercent, loss.profitPercent], ["loss", 120, -20]);
  assert.deepEqual(loss.segments.map((segment) => [segment.id, segment.width]), [["cost", 1]]);
  assert.deepEqual(loss.legend.map((item) => [item.id, item.amount, norm(item.text)]), [["cost", 1200, "Costo de lo vendido · 120 %"], ["loss", 200, "Pérdida de productos · 20 %"]]);
  assert.equal(norm(loss.ariaLabel), "De los $1.000 que vendiste en productos: costo de lo vendido $1.200 (120 %) y una pérdida de $200 (20 %).");
  // Sin ventas de productos (o datos que no sirven): la barra no se dibuja.
  for (const [label, input] of [
    ["ventas 0", overviewGroup({revenue: 0, cost: 0, profit: 0})],
    ["ventas negativas", overviewGroup({revenue: -5, cost: 0, profit: -5})],
    ["sin dato de ventas", overviewGroup({revenue: null, cost: 10, profit: 5})],
    ["sin dato de costo", overviewGroup({revenue: 100, cost: null, profit: 5})],
    ["costo negativo", overviewGroup({revenue: 100, cost: -1, profit: 101})],
    ["texto", overviewGroup({revenue: "100", cost: 10, profit: 90})],
    ["ventas con costo 0 y ganancia 0 (sin ningún tramo)", overviewGroup({revenue: 500, cost: 0, profit: 0})],
    ["NaN", overviewGroup({revenue: Number.NaN, cost: 0, profit: 0})],
    ["sin grupo", undefined],
    ["grupo vacío", {}],
    ["sin componentes", {moneda: "CLP"}],
  ]) {
    const hidden = describeProductsBar(input);
    assert.deepEqual([hidden.show, hidden.kind, hidden.segments, hidden.legend], [false, "hidden", [], []], label);
  }
  // Cifras que no cuadran entre sí: no se fuerza nada y los anchos siguen sumando 1.
  const inconsistent = describeProductsBar(overviewGroup({revenue: 100, cost: 30, profit: 60}));
  assert.deepEqual([inconsistent.costPercent, inconsistent.profitPercent], [30, 60]);
  assert.ok(Math.abs(inconsistent.segments.reduce((total, segment) => total + segment.width, 0) - 1) < 0.001);
  assert.ok(norm(describeProductsBar(overviewGroup({revenue: 1000, cost: 600, profit: 400, moneda: "USD"})).title).includes("US$1.000"), "la moneda es la del grupo");

  // --- Período: "este mes" solo con el mes calendario ACTUAL; otro mes se nombra ---
  const monthRanges = ["2026-10-01|2026-10-31", "2026-10-01|2026-10-27", "2026-10-01|2026-10-01"].map((pair) => ({start: pair.split("|")[0], end: pair.split("|")[1]}));
  assert.deepEqual(monthRanges.map((range) => describePeriod(range, {currentMonthKey: "2026-10"}).phrase), ["este mes", "este mes", "este mes"], "mes completo, mes corrido y un solo día del día 1, en el mes actual");
  assert.deepEqual(monthRanges.map((range) => describePeriod(range, {currentMonthKey: "2026-11"}).phrase), ["en octubre de 2026", "en octubre de 2026", "en octubre de 2026"], "otro mes calendario se nombra");
  assert.deepEqual(monthRanges.map((range) => describePeriod(range).phrase), ["en octubre de 2026", "en octubre de 2026", "en octubre de 2026"], "sin el mes actual el helper no puede decir \"este mes\"");
  assert.deepEqual(monthRanges.map((range) => describePeriod(range, {currentMonthKey: "2026-10"}).isCurrentMonth), [true, true, true]);
  assert.deepEqual([describePeriod(monthRanges[0], {currentMonthKey: "2026-11"}).isCurrentMonth, describePeriod(monthRanges[0], {currentMonthKey: "2026-11"}).monthLabel], [false, formatMonthLabel("2026-10").toLocaleLowerCase("es-CL")]);
  assert.equal(describePeriod({start: "2025-12-01", end: "2025-12-31"}, {currentMonthKey: "2026-01"}).phrase, "en diciembre de 2025", "el mes anterior al actual, aun cruzando de año");
  for (const range of [
    {start: "2026-10-05", end: "2026-10-31"}, {start: "2026-09-01", end: "2026-10-27"}, {start: "2026-08-01", end: "2026-10-31"},
    {start: "2026-10-01", end: "2026-09-30"}, {start: "2026-10-01"}, {start: "no", end: "no"}, {}, null, undefined,
  ]) {
    for (const currentMonthKey of [null, "2026-10"]) {
      const period = describePeriod(range, {currentMonthKey});
      assert.deepEqual([period.isCalendarMonth, period.isCurrentMonth, period.phrase, period.monthKey, period.monthName, period.monthLabel], [false, false, "en el período", null, null, null], JSON.stringify(range));
    }
  }
  assert.deepEqual([describePeriod({start: "2026-10-01", end: "2026-10-31"}).monthKey, describePeriod({start: "2026-10-01", end: "2026-10-31"}).monthName], ["2026-10", formatMonthName("2026-10")]);
  const octoberRange = {start: "2026-10-01", end: "2026-10-31"};
  const customRange = {start: "2026-10-05", end: "2026-10-31"};

  // --- "Por qué es parcial / Qué conviene revisar" ---
  const links = {sales: true, works: true};
  const sinAvisos = describeProfitReasons(overviewGroup({revenue: 100, cost: 60, profit: 40}), {links});
  assert.deepEqual([sinAvisos.show, sinAvisos.count, sinAvisos.lines, sinAvisos.partial], [false, 0, [], false], "sin causas ni servicios no hay bloque");
  assert.equal(describeProfitReasons(undefined).show, false);
  assert.equal(describeProfitReasons({}).show, false);
  // Cobertura completa con servicios pendientes: se avisa, pero no se dice que es parcial.
  const servicesOnly = describeProfitReasons(overviewGroup({ventasSinCostoRegistrado: {ventas: 2, monto: 60000}}), {links});
  assert.deepEqual([servicesOnly.show, servicesOnly.partial, servicesOnly.title, servicesOnly.count], [true, false, "Qué conviene revisar", 1]);
  assert.equal(norm(servicesOnly.lines[0].text), "Hay $60.000 en servicios vendidos sin proyecto, y no entran en la ganancia. Vincúlalos a un proyecto para saber si ganas o pierdes con ellos.");
  assert.deepEqual([servicesOnly.lines[0].kind, servicesOnly.lines[0].amount, servicesOnly.lines[0].action], ["services", 60000, {id: "sales", label: "Ir a Ventas"}]);
  assert.equal(describeProfitReasons(overviewGroup({ventasSinCostoRegistrado: {ventas: 2, monto: 60000}}), {links: {works: true}}).lines[0].action, null, "sin permiso de Ventas no hay acción");
  assert.equal(describeProfitReasons(overviewGroup({ventasSinCostoRegistrado: {ventas: 0, monto: 0}})).show, false, "monto 0: no hay aviso");
  assert.equal(describeProfitReasons(overviewGroup({ventasSinCostoRegistrado: {ventas: 1, monto: null}})).show, false, "monto sin dato: no hay aviso");

  // Cobertura parcial con un proyecto excluido y servicios (la maqueta), con el cálculo real de la ganancia.
  const mockupProject = projectEntry("p-mock", "TR-0012", "Instalación Norte", [projectMonth("2026-10", {horasHombre: 1000})], {fuentes: {materialesVentaSinCosto: 1}});
  const mockupResult = calculateOperationalNetProfit({sales: [], projectBalances: [mockupProject], period: octoberPeriod});
  const mockupProfit = mockupResult.grupos.find((entry) => entry.moneda === "CLP");
  assert.equal(mockupProfit.cobertura, "PARCIAL");
  const mockupReasons = describeProfitReasons({...mockupProfit, ventasSinCostoRegistrado: {ventas: 3, monto: 60000}}, {projects: [mockupProject], links});
  assert.deepEqual([mockupReasons.show, mockupReasons.partial, mockupReasons.title, mockupReasons.count], [true, true, "Por qué es parcial", 2]);
  assert.deepEqual(mockupReasons.lines.map((line) => line.key), ["services", "project:MATERIALES_VENTA_SIN_COSTO"]);
  assert.equal(mockupReasons.lines[1].text, "1 proyecto con materiales vendidos sin costo histórico quedó excluido.");
  assert.deepEqual(mockupReasons.lines[1].projects, [{id: "p-mock", numero: "TR-0012", titulo: "Instalación Norte"}], "con nombre y número");
  assert.deepEqual(mockupReasons.lines[1].action, {id: "works", label: "Ir a Proyectos", workId: "p-mock"}, "un solo proyecto: su ficha");
  assert.equal(describeProfitReasons({...mockupProfit}, {projects: [mockupProject], links: {sales: true}}).lines[0].action, null, "sin permiso de Proyectos no hay acción");

  // Varios proyectos por motivo, con el conteo de ventas sin neto de A3 bien atribuido y sin línea genérica de más.
  const incompleteResult = calculateOperationalNetProfit({sales: [], projectBalances: incompleteFixtures, period: octoberPeriod});
  const incompleteClp = incompleteResult.grupos.find((entry) => entry.moneda === "CLP");
  const clpReasons = describeProfitReasons(incompleteClp, {projects: incompleteFixtures, links});
  assert.deepEqual(clpReasons.lines.map((line) => [line.key, line.text]), [
    ["project:REGISTROS_SIN_FECHA", "1 proyecto con registros sin fecha válida quedó excluido."],
    ["project:VENTAS_SIN_NETO_VALIDO", "1 proyecto con ventas sin neto válido quedó excluido."],
  ], "A3 con 2 ventas de un proyecto nombrado no deja una línea genérica");
  assert.deepEqual(clpReasons.lines.map((line) => line.projects.map((project) => project.titulo)), [["Zeta"], ["Alfa"]]);
  const manyProjects = [
    projectEntry("p-b", "TR-0031", "Beta", [projectMonth("2026-10", {horasHombre: 1})], {fuentes: {materialesVentaSinCosto: 1}}),
    projectEntry("p-a", "TR-0030", "Alfa", [projectMonth("2026-10", {horasHombre: 1})], {fuentes: {materialesVentaSinCosto: 2}}),
  ];
  const manyResult = calculateOperationalNetProfit({sales: [], projectBalances: manyProjects, period: octoberPeriod}).grupos[0];
  const manyReasons = describeProfitReasons(manyResult, {projects: manyProjects, links});
  assert.equal(manyReasons.lines.length, 1);
  assert.equal(manyReasons.lines[0].text, "2 proyectos con materiales vendidos sin costo histórico quedaron excluidos.");
  assert.deepEqual(manyReasons.lines[0].projects.map((project) => project.titulo), ["Alfa", "Beta"], "ordenados por título");
  assert.deepEqual(manyReasons.lines[0].action, {id: "works", label: "Ir a Proyectos"}, "con varios proyectos no hay ficha única");
  // Moneda sin declarar: el grupo no es agregable, lo dice una línea propia y el proyecto sigue con nombre.
  const noCurrency = incompleteResult.grupos.find((entry) => entry.moneda === null);
  const noCurrencyReasons = describeProfitReasons(noCurrency, {projects: incompleteFixtures, links});
  assert.equal(noCurrency.agregable, false);
  assert.deepEqual(noCurrencyReasons.lines.map((line) => line.kind), ["no-currency", "project"]);
  assert.deepEqual(noCurrencyReasons.lines[0].action, {id: "calculation", label: "Ver el cálculo paso a paso"});
  // El grupo USD tiene su propio proyecto excluido: cada moneda se explica por separado.
  const usdReasons = describeProfitReasons(incompleteResult.grupos.find((entry) => entry.moneda === "USD"), {projects: incompleteFixtures, links});
  assert.deepEqual(usdReasons.lines.map((line) => [line.key, line.projects.map((project) => project.titulo)]), [["project:MATERIALES_VENTA_SIN_COSTO", ["Dólar roto"]]]);
  // Toda cobertura parcial de un cálculo real tiene al menos una línea que la explica.
  for (const result of [mockupResult, incompleteResult, manyResult && {grupos: [manyResult]}, monthlyProfitOctober]) {
    result.grupos.filter((entry) => entry.cobertura === "PARCIAL").forEach((entry) => {
      assert.equal(describeProfitReasons(entry, {projects: [...incompleteFixtures, ...manyProjects, mockupProject, ...projectFixtures], links}).show, true, `${entry.moneda}: parcial sin explicación`);
    });
  }

  // Alertas sin frase propia (A1, A2, A8, A9 general) o sin nombre: una sola línea genérica con el conteo.
  const genericGroup = overviewGroup({cobertura: "PARCIAL", alertas: [
    {id: "A1", conteo: 3, monto: 100, registros: ["v1", "v2", "v3"]},
    {id: "A2", conteo: 1, monto: 10, registros: ["v4"]},
    {id: "A4", conteo: 2, monto: 50, registros: ["p-4"]},
    {id: "A8", conteo: 1, monto: null, registros: []},
  ]});
  const genericReasons = describeProfitReasons(genericGroup, {links});
  assert.deepEqual(genericReasons.lines.map((line) => [line.key, line.count, line.text, line.action]), [["generic", 5, "Hay 5 cosas más por revisar en el cálculo.", {id: "calculation", label: "Ver el cálculo paso a paso"}]], "A4 no cuenta");
  assert.equal(describeProfitReasons(overviewGroup({cobertura: "PARCIAL", alertas: [{id: "A8", conteo: 1, monto: null, registros: []}]}), {links}).lines[0].text, "Hay 1 cosa más por revisar en el cálculo.");
  assert.equal(describeProfitReasons(overviewGroup({alertas: [{id: "A4", conteo: 2, monto: 50, registros: ["p-4"]}]}), {links}).show, false, "A4 sola no es aviso (queda en la tabla plegada)");
  const ghost = describeProfitReasons(overviewGroup({cobertura: "PARCIAL", alertas: [{id: "A5", conteo: 1, monto: null, registros: ["p-ghost"]}]}), {projects: [], links});
  assert.deepEqual(ghost.lines.map((line) => [line.kind, line.count]), [["generic", 1]], "un proyecto que no se encuentra no se nombra: va al conteo genérico");
  const withGeneric = describeProfitReasons({...mockupProfit, ventasSinCostoRegistrado: {ventas: 1, monto: 5}, alertas: [...mockupProfit.alertas, {id: "A8", conteo: 1, monto: null, registros: []}]}, {projects: [mockupProject], links});
  assert.deepEqual(withGeneric.lines.map((line) => line.kind), ["services", "project", "generic"], "orden: servicios, proyectos, genérica");
  assert.equal(withGeneric.count, 3);

  // --- Tarjeta de proyectos ---
  const monthlyClp = monthlyProfitOctober.grupos.find((entry) => entry.moneda === "CLP");
  const projectsCard = describeProjectsSummary(monthlyClp, {projects: projectFixtures, range: octoberRange, currentMonthKey: "2026-10"});
  assert.equal(projectsCard.status, "ready");
  assert.equal(projectsCard.result, monthlyClp.componentes.proyectos.resultado, "el resultado es el del grupo, sin recalcular");
  assert.deepEqual([projectsCard.included, projectsCard.excluded], [5, 1]);
  assert.equal(projectsCard.sentence, "5 proyectos con movimiento entran en la ganancia este mes. 1 proyecto quedó excluido.");
  assert.equal(projectsCard.resultLabel, "resultado de proyectos este mes");
  assert.deepEqual(projectsCard.rows.filter((row) => row.zero).map((row) => row.key), ["materialesAdicionales", "gastosDirectos", "gastosIndirectos"]);
  assert.deepEqual([projectsCard.zeroCount, norm(projectsCard.toggle.showLabel), norm(projectsCard.toggle.hideLabel), projectsCard.toggle.show], [3, "Mostrar 3 partidas en $0", "Ocultar las partidas en $0", true]);
  assert.equal(describeProjectsSummary(monthlyClp, {projects: projectFixtures, range: customRange}).sentence, "5 proyectos con movimiento entran en la ganancia en el período. 1 proyecto quedó excluido.", "un rango que no es un mes dice \"en el período\"");
  assert.equal(describeProjectsSummary(monthlyClp, {projects: projectFixtures, range: customRange}).resultLabel, "resultado de proyectos en el período");
  // Un mes calendario que no es el actual se nombra, no dice "este mes".
  const pastMonthCard = describeProjectsSummary(mockupProfit, {projects: [mockupProject], range: octoberRange, currentMonthKey: "2026-11"});
  assert.equal(pastMonthCard.sentence, "Ningún proyecto con movimiento entra en la ganancia en octubre de 2026.");
  assert.equal(pastMonthCard.resultLabel, "resultado de proyectos en octubre de 2026");
  assert.equal(describeProjectsSummary(mockupProfit, {projects: [mockupProject], range: octoberRange}).sentence, "Ningún proyecto con movimiento entra en la ganancia en octubre de 2026.", "sin el mes actual se nombra el mes");
  // La maqueta: ningún proyecto entra y 1 queda excluido; las seis partidas están en cero.
  const noneIncluded = describeProjectsSummary(mockupProfit, {projects: [mockupProject], range: octoberRange, currentMonthKey: "2026-10"});
  assert.equal(noneIncluded.sentence, "Ningún proyecto con movimiento entra en la ganancia este mes.");
  assert.deepEqual([noneIncluded.result, noneIncluded.zeroCount, norm(noneIncluded.toggle.showLabel)], [0, 6, "Mostrar 6 partidas en $0"]);
  assert.equal(describeProjectsSummary(mockupProfit, {projects: [mockupProject], range: customRange}).sentence, "Ningún proyecto con movimiento entra en la ganancia en el período.");
  // Sin proyectos con movimiento ni excluidos.
  const noProjects = describeProjectsSummary(overviewGroup({revenue: 100, cost: 60, profit: 40}), {range: octoberRange, currentMonthKey: "2026-10"});
  assert.deepEqual([noProjects.sentence, noProjects.zeroCount, noProjects.included, noProjects.excluded], ["Sin proyectos con movimiento este mes.", 6, 0, 0]);
  assert.equal(describeProjectsSummary(overviewGroup({}), {}).sentence, "Sin proyectos con movimiento en el período.", "sin rango: en el período");
  // Una partida sin dato no se pliega; la moneda es la del grupo; singular.
  const partial = describeProjectsSummary(overviewGroup({moneda: "USD", projects: {ingresoNeto: null, materialesVenta: 10, materialesAdicionales: 20, horasHombre: 30, gastosDirectos: 40, gastosIndirectos: 0}}), {range: octoberRange, currentMonthKey: "2026-10"});
  assert.deepEqual([partial.zeroCount, partial.rows[0].zero, partial.rows[0].value], [1, false, null]);
  assert.deepEqual([norm(partial.toggle.showLabel), norm(partial.toggle.hideLabel)], ["Mostrar 1 partida en US$0,00", "Ocultar la partida en US$0,00"]);
  assert.deepEqual(describeProjectsSummary(overviewGroup({projects: {ingresoNeto: 1, materialesVenta: 1, materialesAdicionales: 1, horasHombre: 1, gastosDirectos: 1, gastosIndirectos: 1}})).toggle, {show: false, showLabel: "Mostrar 0 partidas en $0", hideLabel: "Ocultar las partidas en $0"}, "sin partidas en cero el botón no se muestra");
  // Los balances no cargaron (A9 general): no se afirma nada sobre los proyectos.
  const loadFailed = describeProjectsSummary(overviewGroup({cobertura: "PARCIAL", alertas: [{id: "A9", conteo: 1, monto: null, registros: []}]}), {range: octoberRange, currentMonthKey: "2026-10"});
  assert.deepEqual([loadFailed.status, loadFailed.sentence, loadFailed.zeroCount, loadFailed.toggle.show], ["error", "No fue posible cargar los balances de los proyectos.", 0, false]);
  assert.equal(describeProjectsSummary(undefined).status, "ready");
  assert.equal(describeProjectsSummary(undefined).result, null);

  // Solo presentación: ningún helper toca Firebase, la red ni nombra Compras (la ganancia no es ventas - compras).
  const overviewSource = readFileSync("src/domain/reportProfitOverview.mjs", "utf8");
  assert.doesNotMatch(overviewSource, /firebase|fetch\(|Date\.now|new Date\(|[Cc]ompra|#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.match(overviewSource, /import \{formatMoney\} from "\.\.\/utils\/formatters\.js";/);
}
console.log("OK reportes (ganancia visual, bloque 1): barra de productos, por qué es parcial, tarjeta de proyectos y período, con casos límite");
// Ganancia visual, bloque 2: parte superior de la pestaña Ganancia ("Me quedó", margen en texto y barra de productos).
{
  const heroSource = readFileSync("src/features/reports/ProfitSummaryCards.jsx", "utf8");
  const heroViewSource = readFileSync("src/features/reports/views/ReportsGananciasView.jsx", "utf8");
  const heroCss = readFileSync("src/styles/interior.css", "utf8");
  // La vista monta la tarjeta antes del desglose; la tarjeta solo presenta (no suma ni divide) y no usa colores literales.
  assert.match(heroViewSource, /import ProfitSummaryCards from "\.\.\/ProfitSummaryCards";/);
  assert.ok(heroViewSource.indexOf("<ProfitSummaryCards currency={currency} currentMonthKey={currentMonthKey} range={range} state={operationalProfit} />") > -1 && heroViewSource.indexOf("<ProfitSummaryCards") < heroViewSource.indexOf("{foldCalculation ? <details"), "la tarjeta va arriba del cálculo");
  assert.match(heroSource, /describeProductsBar\(group, \{locale\}\)/);
  assert.doesNotMatch(heroSource, /\s\/\s|\*\s*100|\.reduce\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|[Cc]ompra/, "solo presenta: sin divisiones, sumas, colores literales ni Compras");
  assert.doesNotMatch(heroSource, /Cobertura parcial|Ganancia neta operacional|ganancia neta|utilidad neta/);
  // Estilos: cifra con --font-size-2xl, costo rayado y con contorno, ganancia lisa y reglas móviles; solo tokens.
  assert.match(heroCss, /\.reports-profit-hero__amount \{[^}]*font-size: var\(--font-size-2xl\);/);
  assert.match(heroCss, /\.reports-profit-hero__amount--up \{\s*color: var\(--color-success-700\);/);
  assert.match(heroCss, /\.reports-profit-hero__amount--down \{\s*color: var\(--color-danger-700\);/);
  assert.match(heroCss, /\.reports-products-bar__segment--cost,\s*\.reports-products-bar__swatch--cost \{[^}]*repeating-linear-gradient\(135deg, var\(--color-border-default\)[^}]*var\(--color-border-control\)[^}]*border: 1px solid var\(--color-text-muted\);/, "el costo va rayado y con contorno");
  assert.match(heroCss, /\.reports-products-bar__segment--profit,\s*\.reports-products-bar__swatch--profit \{\s*background: var\(--color-success-700\);/, "la ganancia va lisa");
  assert.match(heroCss, /\.reports-products-bar__loss,\s*\.reports-products-bar__swatch--loss \{\s*background: var\(--color-danger-700\);/);
  assert.match(heroCss, /\.reports-products-bar__segment \{[^}]*flex-basis: 0;[^}]*min-width: var\(--space-1\);/, "el ancho sale del importe y ningún tramo desaparece");
  assert.match(heroCss, /@media \(max-width: 640px\) \{\s*\.reports-profit-hero__margin \{\s*justify-items: start;[\s\S]*?\.reports-products-bar__legend \{\s*flex-direction: column;/);
  const heroCssStart = heroCss.indexOf('/* Ganancia visual (SPEC 025): "Me quedó"');
  const heroCssBlock = heroCss.slice(heroCssStart, heroCss.indexOf("flex-direction: column;", heroCssStart) + 30);
  assert.ok(heroCssStart > -1 && heroCssBlock.length > 500);
  assert.doesNotMatch(heroCssBlock, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|--color-brand-[6-9]00|--color-dark-/, "solo tokens");
  const contrastSource = readFileSync("scripts/contrast-smoke.mjs", "utf8");
  for (const pair of ['fg: "--color-success-700", bg: "--color-border-default", kind: "nontext"', 'fg: "--color-text-muted", bg: "--color-surface-panel", kind: "nontext"', 'fg: "--color-danger-700", bg: "--color-surface-panel", kind: "nontext"']) {
    assert.ok(contrastSource.includes(pair), `contrast-smoke mide ${pair}`);
  }

  const heroVite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
  try {
    const {default: ProfitSummaryCards} = await heroVite.ssrLoadModule("/src/features/reports/ProfitSummaryCards.jsx");
    const zero = {proyectos: 0, ingresoNeto: 0, materialesVenta: 0, materialesAdicionales: 0, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: 0, resultado: 0};
    const heroGroup = ({moneda = "CLP", cobertura = "COMPLETA", profit = 0, pct = null, revenue = 0, cost = 0, margin = 0} = {}) => ({
      moneda, agregable: Boolean(moneda), cobertura, gananciaNetaOperacional: profit, gananciaNetaOperacionalPct: pct, ingresoNetoConsiderado: revenue,
      componentes: {ventasSinProyecto: {ventas: 1, ingresoNetoProductos: revenue, costoHistoricoProductos: cost, margenBrutoProductos: margin}, proyectos: zero},
      ventasSinCostoRegistrado: {ventas: 0, monto: 0}, alertas: [],
    });
    const renderHero = (grupos, {currency = "todos", status = "ready"} = {}) => plain(renderToStaticMarkup(React.createElement(ProfitSummaryCards, {
      currency, state: {status, error: "", result: status === "ready" ? {grupos, alertasGenerales: []} : null},
    })));
    const countOf = (text, pattern) => (text.match(pattern) || []).length;

    // La maqueta (octubre de 2026): Me quedó $16.616, Parcial, 20 % y la barra de $83.089 en productos.
    const mockup = renderHero([heroGroup({cobertura: "PARCIAL", profit: 16616, pct: 20, revenue: 83089, cost: 66473, margin: 16616})]);
    for (const text of [">Me quedó<", ">Parcial<", "$16.616", "20 %", "margen sobre ventas", "De los $83.089 que vendiste en productos", "Costo de lo vendido · 80 %", "Ganancia de productos · 20 %", "<strong>$66.473</strong>", "<strong>$16.616</strong>"]) {
      assert.ok(mockup.includes(text), `falta ${text}`);
    }
    assert.ok(mockup.includes('role="img" aria-label="De los $83.089 que vendiste en productos: costo de lo vendido $66.473 (80 %) y ganancia $16.616 (20 %)."'), "la barra tiene su descripción accesible completa");
    assert.ok(mockup.includes("flex-grow:66473") && mockup.includes("flex-grow:16616"), "el ancho de cada tramo es su importe");
    assert.ok(mockup.indexOf("reports-products-bar__segment--cost") < mockup.indexOf("reports-products-bar__segment--profit"), "costo a la izquierda, ganancia a la derecha");
    assert.ok(mockup.includes("reports-profit-hero__amount--up") && !mockup.includes("reports-products-bar__loss"));
    assert.doesNotMatch(mockup, /Cobertura parcial|reports-v4-currency-group|reports-profit-hero__currency/, "sin la insignia larga del desglose ni rótulo de moneda con una sola");
    assert.ok(mockup.indexOf(">Me quedó<") < mockup.indexOf(">Parcial<") && mockup.indexOf(">Parcial<") < mockup.indexOf("$16.616") && mockup.indexOf("$16.616") < mockup.indexOf("reports-products-bar"), "orden: título y chip, cifra y barra");
    assert.equal(countOf(mockup, /<section class="erp-card reports-profit-hero">/g), 1);
    // Cobertura completa: sin chip.
    assert.doesNotMatch(renderHero([heroGroup({profit: 16616, pct: 20, revenue: 83089, cost: 66473, margin: 16616})]), />Parcial</);
    // Pérdida: cifra en rojo con su signo, margen negativo en texto, barra toda costo con remate y leyenda de pérdida.
    const loss = renderHero([heroGroup({profit: -200, pct: -20, revenue: 1000, cost: 1200, margin: -200})]);
    assert.ok(loss.includes("reports-profit-hero__amount--down") && loss.includes("$-200") && loss.includes("-20 %"));
    assert.ok(loss.includes("reports-products-bar__loss") && loss.includes("Pérdida de productos · 20 %") && loss.includes("Costo de lo vendido · 120 %"));
    assert.ok(!loss.includes("reports-products-bar__segment--profit"), "no hay tramo de ganancia");
    // Sin ventas de productos (o sin ningún tramo): la barra no se dibuja y la cifra sigue.
    for (const input of [heroGroup({profit: 0, pct: null}), heroGroup({profit: 0, pct: null, revenue: 500, cost: 0, margin: 0})]) {
      const noBar = renderHero([input]);
      assert.ok(noBar.includes("$0") && !noBar.includes("reports-products-bar"), "sin barra");
      assert.doesNotMatch(noBar, /margen sobre ventas/, "sin margen no se dice");
    }
    // Sin cifra (grupo sin moneda declarada): "—", sin margen ni barra.
    const noFigure = renderHero([{...heroGroup({moneda: null, cobertura: "PARCIAL"}), gananciaNetaOperacional: null}]);
    assert.ok(noFigure.includes("reports-profit-hero__amount--none") && noFigure.includes(">—<") && noFigure.includes(">Parcial<") && !noFigure.includes("reports-products-bar"));
    // Varias monedas: una tarjeta por moneda, con su rótulo; el filtro deja solo la elegida; sin datos o sin cargar no se dibuja nada.
    const two = renderHero([heroGroup({profit: 100, pct: 10, revenue: 1000, cost: 900, margin: 100}), heroGroup({moneda: "USD", profit: 5, pct: 10, revenue: 50, cost: 45, margin: 5})]);
    assert.equal(countOf(two, /<section class="erp-card reports-profit-hero">/g), 2);
    assert.ok(two.includes('reports-profit-hero__currency">CLP<') && two.includes('reports-profit-hero__currency">USD<'));
    assert.ok(two.includes("US$") && two.includes("De los US$50"), "cada barra usa la moneda de su grupo");
    const onlyUsd = renderHero([heroGroup({profit: 100, pct: 10, revenue: 1000, cost: 900, margin: 100}), heroGroup({moneda: "USD", profit: 5, pct: 10, revenue: 50, cost: 45, margin: 5})], {currency: "USD"});
    assert.equal(countOf(onlyUsd, /<section class="erp-card reports-profit-hero">/g), 1);
    assert.doesNotMatch(onlyUsd, /reports-profit-hero__currency/, "con un solo grupo visible no se rotula la moneda");
    assert.equal(renderHero([heroGroup({cobertura: "SIN_DATOS", profit: null})]), "", "un grupo sin datos no tiene Me quedó");
    assert.equal(renderHero([]), "");
    assert.equal(renderHero([], {status: "loading"}), "", "mientras carga lo dice el desglose, no esta tarjeta");
    assert.equal(renderHero([], {status: "error"}), "");
  } finally {
    await heroVite.close();
  }
}
console.log("OK reportes (ganancia visual, bloque 2): Me quedó con chip Parcial, margen en texto y barra de productos con costo rayado, leyenda y descripción accesible");
// Ganancia visual, bloque 2b: relleno y grosor de la tarjeta, nota y "Ventas sin costo registrado" visibles, y el cálculo plegado.
{
  const foldViewSource = readFileSync("src/features/reports/views/ReportsGananciasView.jsx", "utf8");
  const foldBreakdownSource = readFileSync("src/features/reports/OperationalNetProfitBreakdown.jsx", "utf8");
  const foldPageSource = readFileSync("src/pages/StatisticsPage.jsx", "utf8");
  const foldCss = readFileSync("src/styles/interior.css", "utf8");
  // Causa del relleno que faltaba: .erp-card no declara padding; cada tarjeta lo trae con su propia clase.
  assert.doesNotMatch(foldCss.match(/\.erp-card \{[^}]*\}/)[0], /padding/, ".erp-card no trae relleno: la tarjeta lo declara completo");
  assert.match(foldCss, /\.reports-profit-hero \{[^}]*padding: var\(--space-6\) var\(--space-6\) calc\(var\(--space-6\) \+ var\(--space-1\)\);/, "relleno en los cuatro lados");
  assert.match(foldCss, /\.reports-profit-heroes \{[^}]*margin-top: var\(--space-2\);/, "espacio entre las pestañas y la tarjeta");
  assert.match(foldCss, /\.reports-products-bar__track \{[^}]*height: var\(--space-10\);/, "la barra mide --space-10 de alto");
  assert.match(foldCss, /\.reports-products-bar__segment \{[^}]*border-radius: var\(--radius-md\);/, "esquinas redondeadas");
  assert.match(foldCss, /@media \(max-width: 640px\) \{[\s\S]*?\.reports-profit-hero \{\s*padding: var\(--space-4\) var\(--space-4\) calc\(var\(--space-4\) \+ var\(--space-1\)\);/, "relleno menor en móvil");
  const foldCssStart = foldCss.indexOf('/* "Ver el cálculo paso a paso"');
  const foldCssBlock = foldCss.slice(foldCssStart, foldCss.indexOf("margin-top: var(--space-3);", foldCssStart) + 30);
  assert.ok(foldCssStart > -1 && foldCssBlock.length > 300);
  assert.doesNotMatch(foldCssBlock, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|--color-brand-[6-9]00|--color-dark-/, "solo tokens");
  assert.match(foldCssBlock, /\.reports-calc-details__summary \{[^}]*border: 1px dashed var\(--color-border-control\);[^}]*color: var\(--color-text-brand\);/);
  assert.match(foldCssBlock, /\.reports-calc-details\[open\] \.reports-calc-details__chevron \{\s*transform: rotate\(180deg\);/);
  // Piezas: la nota y "Ventas sin costo registrado" salen del cálculo plegado y viven bajo "Me quedó".
  assert.match(foldBreakdownSource, /export function ProfitNote\(\)/);
  assert.match(foldBreakdownSource, /export function ServicesWithoutCostNote\(\{group\}\)/);
  assert.equal((foldBreakdownSource.match(/No incluye gastos generales del negocio/g) || []).length, 1, "la nota existe una sola vez");
  assert.equal((foldBreakdownSource.match(/Ventas sin costo registrado:/g) || []).length, 1, "la línea de ventas sin costo existe una sola vez");
  assert.match(readFileSync("src/features/reports/ProfitSummaryCards.jsx", "utf8"), /<ProfitNote \/>\s*<ServicesWithoutCostNote group=\{group\} \/>/);
  // Vista: el cálculo plegado y cerrado por defecto, después de la evolución; el mes actual llega desde la página.
  assert.match(foldViewSource, /<details className="reports-calc-details">\s*<summary className="reports-calc-details__summary">\s*<span>Ver el cálculo paso a paso<\/span>/);
  assert.doesNotMatch(foldViewSource, /<details[^>]*\bopen\b/, "cerrado por defecto");
  assert.ok(foldViewSource.indexOf("<MonthlyOperationalProfitChart") < foldViewSource.indexOf("<details"), "el plegable va después de la evolución");
  assert.ok(foldViewSource.indexOf("<ProfitSummaryCards") < foldViewSource.indexOf("<MonthlyOperationalProfitChart"), "Me quedó va arriba");
  assert.doesNotMatch(foldViewSource, /revisa el estado del sistema al final de esta página/, "la nota antigua ya no es cierta");
  assert.match(foldViewSource, /\* Mes con cobertura parcial: abre «Ver el cálculo paso a paso», más abajo, para ver el estado del sistema\./);
  assert.match(foldViewSource, /\{hasAlerts && <section className="erp-card reports-detail-section reports-plain-headings">[\s\S]*?<h2>Estado del sistema<\/h2>[\s\S]*?<OperationalSystemStatus[\s\S]*?\{foldCalculation \? <details/, "el estado del sistema queda dentro del mismo plegable");
  assert.match(foldViewSource, /const foldCalculation = Boolean\(result\) && visibleOperationalGroups\(result, currency\)\.some\(\(group\) => group\.cobertura !== COVERAGE\.EMPTY\);/);
  assert.match(foldViewSource, /<ProfitSummaryCards currency=\{currency\} currentMonthKey=\{currentMonthKey\} range=\{range\} state=\{operationalProfit\} \/>/);
  assert.match(foldPageSource, /<ReportsGananciasView currency=\{selectedCurrency\} currentMonthKey=\{currentMonthKey\(today\)\}/, "la página pasa el mes actual");

  const foldVite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
  try {
    const {default: ReportsGananciasView} = await foldVite.ssrLoadModule("/src/features/reports/views/ReportsGananciasView.jsx");
    const zeroComponents = {proyectos: 0, ingresoNeto: 0, materialesVenta: 0, materialesAdicionales: 0, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: 0, resultado: 0};
    const foldGroup = (extra = {}) => ({
      moneda: "CLP", agregable: true, cobertura: "PARCIAL", gananciaNetaOperacional: 16616, gananciaNetaOperacionalPct: 20, ingresoNetoConsiderado: 83089,
      componentes: {ventasSinProyecto: {ventas: 3, ingresoNetoProductos: 83089, costoHistoricoProductos: 66473, margenBrutoProductos: 16616}, proyectos: zeroComponents},
      ventasSinCostoRegistrado: {ventas: 2, monto: 60000},
      alertas: [{id: "A8", clave: "LECTURA_TRUNCADA", efecto: "COBERTURA_PARCIAL", conteo: 1, monto: null, registros: []}], ...extra,
    });
    const foldProps = (state, extra = {}) => ({
      currency: "todos", currentMonthKey: "2026-10", links: {sales: true, works: true}, navigate: () => {},
      profitabilityV4: {canView: true, reload: () => {}, commercial: {status: "ready", meta: {items: [], lecturaTruncada: false}}, projects: {status: "ready", meta: {proyectos: []}}},
      operationalProfit: state, range: {start: "2026-10-01", end: "2026-10-31", days: 31}, ...extra,
    });
    const readyState = (grupos, alertasGenerales = []) => ({status: "ready", error: "", result: {grupos, alertasGenerales, periodo: {proyectosPorMesCompleto: false}}});
    const renderFold = (state, extra) => plain(renderToStaticMarkup(React.createElement(ReportsGananciasView, foldProps(state, extra))));

    const folded = renderFold(readyState([foldGroup()]));
    const detailsAt = folded.indexOf('<details class="reports-calc-details">');
    assert.ok(detailsAt > -1, "hay un plegable");
    const before = folded.slice(0, detailsAt);
    const inside = folded.slice(detailsAt);
    assert.doesNotMatch(folded.slice(detailsAt, detailsAt + 40), /\bopen\b/, "cerrado por defecto");
    // Visible fuera del plegable: Me quedó, su barra, la nota fija y "Ventas sin costo registrado".
    for (const text of [">Me quedó<", ">Parcial<", "$16.616", "margen sobre ventas", "De los $83.089 que vendiste en productos", "Ganancia: ventas sin IVA menos costos registrados de productos y proyectos. No incluye gastos generales del negocio.", "Ventas sin costo registrado: $60.000"]) {
      assert.ok(before.includes(text), `fuera del plegable falta ${text}`);
      assert.ok(!inside.includes(text) || text === ">Parcial<" || text === "$16.616", `${text} no se repite dentro del plegable`);
    }
    assert.equal((folded.match(/No incluye gastos generales del negocio/g) || []).length, 1);
    assert.equal((folded.match(/Ventas sin costo registrado:/g) || []).length, 1);
    // Lo que se pliega: el desglose antiguo (cifras, margen, insignia y tablas) y el estado del sistema.
    for (const text of ["Ver el cálculo paso a paso", "Ganancia (parcial)", "Margen sobre ventas", "Cobertura parcial", "Ventas sin proyecto", "Resultado de proyectos", ">Total<", "Estado del sistema", "Lectura truncada"]) {
      assert.ok(inside.includes(text), `dentro del plegable falta ${text}`);
      assert.ok(!before.includes(text), `${text} no debe estar a la vista`);
    }
    assert.ok(before.indexOf(">Me quedó<") > -1 && before.indexOf(">Me quedó<") < before.indexOf("De los $83.089"), "Me quedó arriba de la barra");
    assert.ok(inside.indexOf("Ganancia del período") < inside.indexOf("Estado del sistema"), "el estado del sistema queda dentro, al final");
    // Con evolución mensual (proyectos de octubre): Me quedó, luego la evolución con su nota y al final el plegable con el estado del sistema.
    const withChart = renderFold(readyState([foldGroup()]), {profitabilityV4: {...foldProps(null).profitabilityV4, projects: {status: "ready", meta: {proyectos: projectFixtures}}}});
    const chartAt = withChart.indexOf("Evolución mensual");
    assert.ok(withChart.indexOf(">Me quedó<") < chartAt && chartAt < withChart.indexOf("<details"), "orden: Me quedó, evolución, cálculo plegado");
    assert.ok(withChart.indexOf("Estado del sistema") > withChart.indexOf("<details"), "el estado del sistema queda al final, dentro del plegable");
    assert.ok(withChart.slice(0, withChart.indexOf("<details")).includes("* Mes con cobertura parcial: abre «Ver el cálculo paso a paso», más abajo, para ver el estado del sistema."), "la nota apunta a algo que existe");
    assert.doesNotMatch(withChart, /al final de esta página/);
    // Sin alertas: el plegable no trae la sección de estado.
    const folded2 = renderFold(readyState([foldGroup({cobertura: "COMPLETA", alertas: [], ventasSinCostoRegistrado: {ventas: 0, monto: 0}})]));
    assert.ok(folded2.includes('<details class="reports-calc-details">') && !folded2.includes("Estado del sistema") && !folded2.includes("Ventas sin costo registrado:"));
    // Nombre del período para lector de pantalla: el mes actual, otro mes o un rango.
    assert.ok(folded.includes('Me quedó<span class="sr-only"> este mes</span>'));
    assert.ok(renderFold(readyState([foldGroup()]), {currentMonthKey: "2026-11"}).includes('Me quedó<span class="sr-only"> en octubre de 2026</span>'));
    assert.ok(renderFold(readyState([foldGroup()]), {range: {start: "2026-09-05", end: "2026-10-31", days: 57}}).includes('Me quedó<span class="sr-only"> en el período</span>'));
    // Cargando, con error, sin datos o sin grupos con cifra: el desglose queda a la vista (ahí viven el indicador, el error y el vacío).
    const loading = renderFold({status: "loading", result: null, error: ""});
    assert.ok(loading.includes("Calculando ganancia...") && !loading.includes("<details") && !loading.includes(">Me quedó<"));
    const failed = renderFold({status: "error", result: null, error: "No se pudo calcular."});
    assert.ok(failed.includes("No se pudo calcular.") && failed.includes("Reintentar") && !failed.includes("<details"));
    const noGroups = renderFold(readyState([]));
    assert.ok(noGroups.includes("No hay ventas ni costos de proyecto en el período seleccionado.") && !noGroups.includes("<details"));
    const noData = renderFold(readyState([foldGroup({cobertura: "SIN_DATOS", gananciaNetaOperacional: null, alertas: [], ventasSinCostoRegistrado: {ventas: 0, monto: 0}})]));
    assert.ok(!noData.includes("<details") && !noData.includes(">Me quedó<"), "un grupo sin datos no se pliega");
    // Perfil sin permiso: el mensaje de siempre y nada de lo demás.
    const denied = renderFold(readyState([foldGroup()]), {profitabilityV4: {...foldProps(null).profitabilityV4, canView: false}});
    assert.ok(denied.includes("Tu perfil no incluye información de ganancias.") && !denied.includes(">Me quedó<") && !denied.includes("<details"));
  } finally {
    await foldVite.close();
  }
}
console.log("OK reportes (ganancia visual, bloque 2b): relleno, grosor y espacio de la tarjeta; nota y ventas sin costo visibles; cálculo y estado del sistema plegados");
// Ventas y Compras visuales, bloque 1: helpers puros y piezas compartidas (sin cablear en las vistas).
{
  const norm = (text) => String(text).replace(/\s/g, " ");
  const flowRange = {start: "2026-10-01", end: "2026-10-31", days: 31};
  const flowSale = (n, date, extra = {}) => ({id: `v${n}`, numero: `VTA-2026-${String(n).padStart(4, "0")}`, estado: "confirmada", moneda: "CLP", fechaVenta: date, neto: 1000 * n, total: 1190 * n, descuento: 0, items: [], ...extra});
  const line = (itemId, nombre, cantidad, totalLinea, extra = {}) => ({lineaId: `l-${itemId || nombre}`, itemId, nombre, cantidad, totalLinea, tipoItem: "producto", unidad: "unidad", ...extra});

  // --- Cabecera: rótulos, conteo y aviso de documentos sin neto válido ---
  const sales1 = describeFlowSummary({kind: "sales", count: 1});
  assert.deepEqual([sales1.title, sales1.countText, sales1.caption, sales1.withoutNetText], ["Vendí", "1 venta confirmada", "1 venta confirmada · sin IVA", null]);
  const purchases3 = describeFlowSummary({kind: "purchases", count: 3});
  assert.deepEqual([purchases3.title, purchases3.countText, purchases3.caption], ["Compré", "3 compras confirmadas", "3 compras confirmadas · sin IVA"]);
  assert.equal(describeFlowSummary({kind: "sales", count: 0}).caption, "0 ventas confirmadas · sin IVA", "el vacío también dice sus cifras");
  assert.equal(describeFlowSummary({kind: "sales", count: 5, withoutNetCount: 1}).withoutNetText, "1 venta sin neto válido no suma en este total.");
  assert.equal(describeFlowSummary({kind: "purchases", count: 5, withoutNetCount: 3}).withoutNetText, "3 compras sin neto válido no suman en este total.");
  for (const junk of [{count: Number.NaN}, {count: -2}, {count: "x"}, {count: undefined}, {kind: "otra", count: 0}, {}, undefined]) {
    const result = describeFlowSummary(junk);
    assert.deepEqual([result.count, result.title, result.withoutNetText], [0, "Vendí", null], JSON.stringify(junk));
  }
  assert.equal(describeFlowSummary({kind: "sales", count: 2, withoutNetCount: -4}).withoutNetText, null);

  // --- Orden por fecha y límite de filas ---
  const unsorted = [flowSale(1, "2026-10-03"), flowSale(2, "2026-10-08"), flowSale(10, "2026-10-08"), flowSale(3, ""), flowSale(4, "2026-10-20T15:30:00.000Z"), flowSale(5, undefined)];
  const originalOrder = unsorted.map((sale) => sale.id);
  assert.deepEqual(sortByDateDesc(unsorted, "fechaVenta").map((sale) => sale.id), ["v4", "v10", "v2", "v1", "v5", "v3"], "fecha descendente; el mismo día, número mayor primero (0010 antes que 0002); sin fecha al final, también por número");
  assert.deepEqual(unsorted.map((sale) => sale.id), originalOrder, "no modifica la lista");
  assert.deepEqual(sortByDateDesc(undefined, "fechaVenta"), []);
  assert.deepEqual(sortByDateDesc([{id: "a", fechaCompra: "2026-09-01"}, {id: "b", fechaCompra: "2026-09-02"}], "fechaCompra").map((entry) => entry.id), ["b", "a"]);
  assert.equal(DEFAULT_ROW_LIMIT, 5);
  const rowsOf = (n) => Array.from({length: n}, (_, index) => ({id: index}));
  assert.deepEqual([limitRows([]).rows.length, limitRows([]).limited, limitRows([]).total], [0, false, 0], "vacío");
  assert.deepEqual([limitRows(rowsOf(1)).shown, limitRows(rowsOf(1)).limited], [1, false], "una fila");
  assert.deepEqual([limitRows(rowsOf(5)).shown, limitRows(rowsOf(5)).limited, limitRows(rowsOf(5)).hidden], [5, false, 0], "justo el límite: nada que ocultar");
  const six = limitRows(rowsOf(6));
  assert.deepEqual([six.shown, six.total, six.hidden, six.limited, six.expanded], [5, 6, 1, true, false]);
  const twelveAll = limitRows(rowsOf(12), {expanded: true});
  assert.deepEqual([twelveAll.shown, twelveAll.hidden, twelveAll.expanded], [12, 0, true]);
  assert.equal(limitRows(rowsOf(3), {expanded: true}).expanded, false, "sin nada que ocultar no hay estado expandido");
  assert.deepEqual([limitRows(rowsOf(9), {limit: 3}).shown, limitRows(rowsOf(9), {limit: 0}).shown, limitRows(rowsOf(9), {limit: "x"}).shown, limitRows(null).total], [3, 1, 5, 0], "límite inválido: el mínimo o el de siempre");
  const salesNoun = {singular: "venta", plural: "ventas"};
  assert.deepEqual(describeRowsShown(limitRows(rowsOf(12)), salesNoun), {status: "Mostrando 5 de 12 ventas", toggleLabel: "Ver todas (12)"});
  assert.deepEqual(describeRowsShown(limitRows(rowsOf(12), {expanded: true}), salesNoun), {status: "Mostrando las 12 ventas", toggleLabel: "Ver solo las 5 más recientes"});
  assert.deepEqual(describeRowsShown(limitRows(rowsOf(7)), {singular: "compra", plural: "compras"}), {status: "Mostrando 5 de 7 compras", toggleLabel: "Ver todas (7)"});
  assert.deepEqual(describeRowsShown(limitRows(rowsOf(4)), salesNoun), {status: null, toggleLabel: null}, "sin nada que ocultar no hay textos ni botón");
  assert.deepEqual(describeRowsShown(undefined, salesNoun), {status: null, toggleLabel: null});

  // --- Barras de porcentaje ---
  // Compras de la maqueta: tres proveedores que suman todo el total.
  const suppliers = [{id: "a", name: "Proveedor A", count: 1, total: 210000}, {id: "b", name: "Proveedor B", count: 1, total: 128300}, {id: "c", name: "Proveedor C", count: 1, total: 74000}];
  const supplierBars = buildShareBars(suppliers, {total: 412300});
  assert.equal(supplierBars.show, true);
  assert.deepEqual(supplierBars.rows.map((row) => [row.name, row.share, norm(row.shareText), row.fraction]), [
    ["Proveedor A", 50.9, "50,9 %", 1], ["Proveedor B", 31.1, "31,1 %", 0.611], ["Proveedor C", 17.9, "17,9 %", 0.3524],
  ]);
  assert.equal(supplierBars.others, null, "los tres suman el total: no hay resto");
  assert.deepEqual(supplierBars.rows.map((row) => row.amount), [210000, 128300, 74000]);
  // Hay más que lo listado: el resto se ve como "otros", con su porcentaje.
  const partialBars = buildShareBars(suppliers.slice(0, 2), {total: 500000});
  assert.deepEqual([partialBars.others.amount, partialBars.others.share, norm(partialBars.others.shareText)], [161700, 32.3, "32,3 %"]);
  assert.equal(buildShareBars(suppliers, {total: 500000, othersCount: 4}).others.count, 4);
  assert.equal(buildShareBars([{id: "x", name: "Solo", total: 1000}], {total: 1000}).rows[0].shareText, "100 %", "una sola fila: 100 %");
  assert.equal(buildShareBars([{id: "x", name: "Solo", total: 1000}], {total: 1000}).rows[0].fraction, 1);
  // Entradas desordenadas o inválidas, y el límite.
  const messy = buildShareBars([{id: "z", name: "Cero", total: 0}, {id: "n", name: "Nada", total: Number.NaN}, {id: "m", name: "Menos", total: -5}, {id: "s", name: "Texto", total: "10"}, {id: "p", name: "Pequeño", total: 100}, {id: "g", name: "Grande", total: 300}], {total: 1000});
  assert.deepEqual(messy.rows.map((row) => row.name), ["Grande", "Pequeño"], "ordenadas de mayor a menor y sin importes 0, negativos ni inválidos");
  assert.equal(buildShareBars(suppliers, {total: 412300, limit: 2}).rows.length, 2);
  assert.deepEqual(buildShareBars([{id: "a", name: "A", amount: 50}], {total: 100}).rows.map((row) => [row.amount, row.share]), [[50, 50]], "también acepta `amount`");
  for (const total of [0, -1, Number.NaN, null, undefined, "100"]) {
    const none = buildShareBars(suppliers, {total});
    assert.deepEqual([none.show, none.rows, none.others], [false, [], null], `total ${String(total)}: sin barras`);
  }
  assert.deepEqual([buildShareBars([], {total: 100}).show, buildShareBars(undefined, {total: 100}).show, buildShareBars(null).show], [false, false, false], "sin entradas");
  assert.deepEqual(buildShareBars(suppliers, {total: 412300, locale: "en-US"}).rows.map((row) => row.shareText), ["50.9 %", "31.1 %", "17.9 %"], "el decimal sigue el locale");

  // Cantidad con unidad.
  assert.deepEqual(
    [[2, "unidad"], [1, "unidad"], [2, "hora"], [1, "hora"], [3, "kg"], [3, "m2"], [1.5, "caja"], [2, "global"], [2, undefined], [0, "unidad"], [2, "hora técnica"], [2, "días"]].map(([quantity, unit]) => norm(describeQuantity(quantity, unit))),
    ["2 unidades", "1 unidad", "2 horas", "1 hora", "3 kg", "3 m2", "1,5 cajas", "2 globales", "2 unidades", "0 unidades", "2 hora técnica", "2 días"],
    "pluraliza palabras completas y deja abreviaturas, números y frases tal cual",
  );
  assert.equal(describeQuantity(Number.NaN, "hora"), "");
  assert.equal(describeQuantity("2", "hora"), "", "un texto no es una cantidad");

  // Barras por producto: las cifras de la maqueta de Ventas (octubre de 2026), con el ranking real.
  const mockupSale = flowSale(2, "2026-10-08", {
    neto: 143089, total: 170276, items: [
      line("a50", "Ángulo laminado 50x50x4x6.000 mm", 2, 62430),
      line("hora", "Hora técnica en terreno", 2, 60000, {tipoItem: "servicio", unidad: "hora"}),
      line("a20", "Ángulo laminado 20x20x3x6.000 mm", 1, 8976),
      line("fierro", "Fierro A-63 10 mm x 6 m estriado", 1, 6277),
      line("pletina", "Pletina comercial 20x3x6.000 mm", 1, 5406),
    ],
  });
  const flowSummary = getSimplifiedReportSummary({sales: [mockupSale], purchases: [], projectBalances: [], range: flowRange});
  const ranking = getTopSalesProducts(flowSummary.sales.confirmed);
  const products = describeProductBars({entries: ranking[0].entries, documents: flowSummary.sales.confirmed, currency: "CLP"});
  assert.equal(products.show, true);
  assert.deepEqual(products.rows.map((row) => [row.name, row.amount, row.share]), [
    ["Ángulo laminado 50x50x4x6.000 mm", 62430, 43.6], ["Hora técnica en terreno", 60000, 41.9], ["Ángulo laminado 20x20x3x6.000 mm", 8976, 6.3],
    ["Fierro A-63 10 mm x 6 m estriado", 6277, 4.4], ["Pletina comercial 20x3x6.000 mm", 5406, 3.8],
  ], "los mismos porcentajes de la maqueta");
  assert.equal(products.linesTotal, flowSummary.currencies[0].sales.total, "sin descuento general las líneas suman el neto del encabezado");
  assert.equal(products.hasGeneralDiscount, false);
  assert.equal(products.others, null);
  assert.deepEqual(products.rows.map((row) => [row.tipoItem, norm(row.quantityText)]), [["producto", "2 unidades"], ["servicio", "2 horas"], ["producto", "1 unidad"], ["producto", "1 unidad"], ["producto", "1 unidad"]], "tipo y unidad salen de las líneas");
  assert.equal(products.rows[0].fraction, 1);
  assert.equal(products.rows[1].fraction, 0.9611);
  // Con descuento general las líneas suman más que el neto (totalLinea no lo descuenta): se avisa y no se reparte.
  const discounted = flowSale(3, "2026-10-09", {neto: 90000, total: 107100, descuento: 10000, items: [line("p1", "Producto con descuento", 1, 100000)]});
  const discountedProducts = describeProductBars({entries: getTopSalesProducts([discounted])[0].entries, documents: [discounted], currency: "CLP"});
  assert.deepEqual([discountedProducts.linesTotal, discountedProducts.hasGeneralDiscount, discountedProducts.rows[0].share], [100000, true, 100]);
  assert.notEqual(discountedProducts.linesTotal, discounted.neto, "las líneas y el neto no coinciden cuando hay descuento general");
  // Más ítems que el límite: el todo son todas las líneas, y el resto queda como "otros" con su cuenta.
  const manyItems = flowSale(4, "2026-10-10", {neto: 700, total: 833, items: ["a", "b", "c", "d", "e", "f", "g"].map((id, index) => line(id, `Ítem ${id}`, 1, 100 - index))});
  const manyProducts = describeProductBars({entries: getTopSalesProducts([manyItems])[0].entries, documents: [manyItems], currency: "CLP"});
  assert.equal(manyProducts.rows.length, 5);
  assert.equal(manyProducts.linesTotal, 100 + 99 + 98 + 97 + 96 + 95 + 94);
  assert.deepEqual([manyProducts.others.amount, manyProducts.others.count], [95 + 94, 2]);
  assert.ok(Math.abs(manyProducts.rows.reduce((sum, row) => sum + row.share, 0) + manyProducts.others.share - 100) < 0.2, "filas más resto suman 100 (salvo el redondeo)");
  // Multimoneda: cada moneda con su todo; un documento sin neto válido está en el ranking y en el todo, igual que en el ranking.
  const usdSale = flowSale(5, "2026-10-11", {moneda: "USD", neto: 50, total: 59.5, items: [line("u1", "Licencia", 1, 50, {tipoItem: "servicio", unidad: "licencia"})]});
  const noNet = flowSale(6, "2026-10-12", {neto: null, total: 500, items: [line("p9", "Sin neto", 1, 500)]});
  const mixed = [mockupSale, usdSale, noNet];
  const mixedSummary = getSimplifiedReportSummary({sales: mixed, purchases: [], projectBalances: [], range: flowRange});
  const mixedRanking = getTopSalesProducts(mixedSummary.sales.confirmed);
  const clpBars = describeProductBars({entries: mixedRanking.find((group) => group.currency === "CLP").entries, documents: mixedSummary.sales.confirmed, currency: "CLP"});
  const usdBars = describeProductBars({entries: mixedRanking.find((group) => group.currency === "USD").entries, documents: mixedSummary.sales.confirmed, currency: "USD"});
  assert.equal(clpBars.linesTotal, 143089 + 500, "el documento sin neto válido cuenta en las líneas, como en el ranking");
  assert.deepEqual([usdBars.linesTotal, usdBars.rows.length, usdBars.rows[0].tipoItem, norm(usdBars.rows[0].quantityText)], [50, 1, "servicio", "1 licencia"], "la otra moneda no se mezcla");
  assert.equal(clpBars.rows.some((row) => row.name === "Licencia"), false);
  assert.ok(Math.abs(clpBars.rows.reduce((sum, row) => sum + row.amount, 0) + (clpBars.others?.amount || 0) - clpBars.linesTotal) < 0.01, "filas más resto = todas las líneas");
  // Servicios sin itemId: el ranking los junta en "sin-identificar"; con tipos distintos el tipo queda sin decidir.
  const noIds = flowSale(7, "2026-10-13", {items: [line("", "Servicio uno", 1, 100, {tipoItem: "servicio", unidad: "hora"}), line("", "Producto suelto", 1, 50)]});
  const noIdBars = describeProductBars({entries: getTopSalesProducts([noIds])[0].entries, documents: [noIds], currency: "CLP"});
  assert.deepEqual([noIdBars.rows.length, noIdBars.rows[0].id, noIdBars.rows[0].tipoItem], [1, "sin-identificar", null], "tipos distintos en el mismo grupo: null");
  assert.equal(describeProductBars({entries: [{id: "cod", name: "Por código", quantity: 1, total: 10}], documents: [flowSale(8, "2026-10-14", {items: [line("", "Por código", 1, 10, {codigo: "cod", tipoItem: "actividad"})]})], currency: "CLP"}).rows[0].tipoItem, "actividad", "agrupa por código cuando no hay itemId, igual que el ranking");
  // Vacíos y entradas inválidas.
  for (const input of [undefined, {}, {entries: [], documents: []}, {entries: ranking[0].entries, documents: []}, {entries: null, documents: null}]) {
    const none = describeProductBars(input);
    assert.deepEqual([none.show, none.rows, none.hasGeneralDiscount], [false, [], false], JSON.stringify(input) || "sin argumentos");
  }

  // --- Piezas compartidas (sin cablear): cabecera, tabla limitada y evolución plegada ---
  const flowSource = readFileSync("src/domain/reportFlowOverview.mjs", "utf8");
  const flowCss = readFileSync("src/styles/interior.css", "utf8");
  assert.doesNotMatch(flowSource, /firebase|fetch\(|Date\.now|new Date\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|[Gg]anancia/, "solo presentación: sin red, reloj, colores ni ganancia");
  for (const file of ["ReportsFlowHeader", "LimitedOperationsTable", "FoldedTimeline"]) {
    const source = readFileSync(`src/features/reports/${file}.jsx`, "utf8");
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\.reduce\(|[Gg]anancia/, `${file}: sin colores literales, sumas ni ganancia`);
  }
  const flowCssStart = flowCss.indexOf("/* Ventas y Compras (SPEC 025): cabecera");
  const flowCssBlock = flowCss.slice(flowCssStart, flowCss.indexOf("text-align: left;", flowCssStart) + 30);
  assert.ok(flowCssStart > -1 && flowCssBlock.length > 500);
  assert.doesNotMatch(flowCssBlock, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|--color-brand-[6-9]00|--color-dark-/, "solo tokens");
  assert.match(flowCssBlock, /\.reports-flow-header \{[^}]*padding: var\(--space-6\) var\(--space-6\) calc\(var\(--space-6\) \+ var\(--space-1\)\);/, "relleno completo (.erp-card no trae)");
  assert.match(flowCssBlock, /\.reports-flow-header__amount \{[^}]*font-size: var\(--font-size-2xl\);/);
  assert.match(flowCssBlock, /\.reports-flow-header--purchases::after \{\s*background: var\(--color-data-expense\);/);

  const flowVite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
  try {
    const {default: ReportsFlowHeader} = await flowVite.ssrLoadModule("/src/features/reports/ReportsFlowHeader.jsx");
    const {default: LimitedOperationsTable} = await flowVite.ssrLoadModule("/src/features/reports/LimitedOperationsTable.jsx");
    const {default: FoldedTimeline} = await flowVite.ssrLoadModule("/src/features/reports/FoldedTimeline.jsx");
    const html = (component, props) => plain(renderToStaticMarkup(React.createElement(component, props)));

    // Cabecera
    const salesHeader = html(ReportsFlowHeader, {kind: "sales", count: 1, currency: "CLP", total: 143089});
    for (const text of [">Vendí<", "$143.089", "1 venta confirmada · sin IVA", "reports-flow-header--sales"]) assert.ok(salesHeader.includes(text), `falta ${text}`);
    assert.doesNotMatch(salesHeader, /reports-flow-header__currency|reports-flow-header__note|reports-flow-header__warning/, "sin moneda, nota ni aviso si no hacen falta");
    assert.ok(salesHeader.indexOf(">Vendí<") < salesHeader.indexOf("$143.089") && salesHeader.indexOf("$143.089") < salesHeader.indexOf("1 venta confirmada"), "título, cifra y conteo");
    const purchasesHeader = html(ReportsFlowHeader, {kind: "purchases", count: 3, currency: "USD", total: 412.3, showCurrency: true, note: "Las compras muestran egresos registrados del negocio.", withoutNetCount: 2});
    for (const text of [">Compré<", "reports-flow-header--purchases", "3 compras confirmadas · sin IVA", 'reports-flow-header__currency">USD<', "Las compras muestran egresos registrados del negocio.", "2 compras sin neto válido no suman en este total."]) assert.ok(purchasesHeader.includes(text), `falta ${text}`);
    assert.ok(purchasesHeader.includes("US$"), "la cifra usa la moneda del grupo");
    assert.equal(html(ReportsFlowHeader, {kind: "sales", count: 0, currency: "CLP", total: 0}).includes("0 ventas confirmadas · sin IVA"), true, "con 0 operaciones: $0 y su conteo, sin mensajes extra");

    // Tabla limitada
    const columns = ["Número", "Fecha", "Cliente", "Neto", "Total"];
    const renderSaleRow = (sale) => React.createElement("tr", {key: sale.id}, React.createElement("td", null, sale.numero), React.createElement("td", null, String(sale.fechaVenta || "").slice(0, 10)));
    const tableOf = (rows, extra = {}) => html(LimitedOperationsTable, {columns, dateField: "fechaVenta", noun: {singular: "venta", plural: "ventas"}, renderRow: renderSaleRow, rows, title: "Últimas ventas", ...extra});
    const sevenSales = [1, 2, 3, 4, 5, 6, 7].map((n) => flowSale(n, `2026-10-0${n}`));
    const limited = tableOf(sevenSales);
    assert.equal((limited.match(/<tr><td>VTA/g) || []).length, 5, "solo 5 filas");
    assert.ok(limited.indexOf("VTA-2026-0007") < limited.indexOf("VTA-2026-0006") && limited.indexOf("VTA-2026-0003") > -1 && !limited.includes("VTA-2026-0002") && !limited.includes("VTA-2026-0001"), "las 5 más recientes por fecha, no las primeras de la lista");
    assert.ok(limited.includes("Mostrando 5 de 7 ventas") && limited.includes(">Ver todas (7)<") && limited.includes('aria-expanded="false"') && /aria-controls="[^"]+"/.test(limited));
    assert.ok(limited.includes("<th>Neto</th><th>Total</th>") || (limited.includes("<th>Neto</th>") && limited.includes("<th>Total</th>")), "las columnas de la vista se conservan");
    const expandedTable = tableOf(sevenSales, {initialExpanded: true});
    assert.equal((expandedTable.match(/<tr><td>VTA/g) || []).length, 7);
    assert.ok(expandedTable.includes("Mostrando las 7 ventas") && expandedTable.includes("Ver solo las 5 más recientes") && expandedTable.includes('aria-expanded="true"'));
    const five = tableOf(sevenSales.slice(0, 5));
    assert.ok(!five.includes("Mostrando") && !five.includes("Ver todas") && !five.includes("aria-expanded"), "con 5 o menos no hay botón");
    assert.equal(tableOf([]), "", "sin filas no dibuja nada: el vacío lo dice la pestaña");
    assert.equal(tableOf(undefined), "");
    assert.equal((tableOf([flowSale(1, "2026-10-01")]).match(/<tr><td>VTA/g) || []).length, 1, "una fila");
    assert.ok(!tableOf(sevenSales).includes("Ir a Ventas") && tableOf(sevenSales, {onOpen: () => {}, openLabel: "Ir a Ventas"}).includes("Ir a Ventas"), "el enlace al módulo solo con acceso");

    // Evolución plegada
    const timelineDays = [{key: "2026-10-01", currency: "CLP", count: 1, value: 1000}, {key: "2026-10-02", currency: "CLP", count: 2, value: 2500}, {key: "2026-10-02", currency: "USD", count: 1, value: 50}];
    const folded = html(FoldedTimeline, {currency: "CLP", items: timelineDays});
    assert.ok(folded.includes('<details class="reports-calc-details reports-folded-timeline">') && !/<details[^>]*\bopen\b/.test(folded), "cerrada por defecto");
    assert.ok(folded.includes("Ver la evolución por día (2)") && folded.includes("$2.500") && !folded.includes("US$50"), "solo las filas de la moneda");
    assert.ok(html(FoldedTimeline, {currency: "CLP", items: [{key: "2026-09", currency: "CLP", count: 3, value: 900}]}).includes("Ver la evolución por mes (1)"));
    assert.equal(html(FoldedTimeline, {currency: "EUR", items: timelineDays}), "", "sin filas no dibuja nada");
    assert.equal(html(FoldedTimeline, {currency: "CLP", items: undefined}), "");
  } finally {
    await flowVite.close();
  }
}
console.log("OK reportes (ventas y compras, bloque 1): helpers de cabecera, orden por fecha, límite de filas y barras de porcentaje, y piezas compartidas sin cablear");
console.log("Report model smoke: OK");
