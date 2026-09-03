import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  aggregateCommercialSalesV4,
  aggregateProjectProfitabilityV4,
  buildProfitabilityReportV4,
  classifyProjectBalanceV4,
  REPORT_PROFITABILITY_COVERAGE,
  REPORT_PROFITABILITY_V4_BLOCK,
  REPORT_SALE_PROJECT_SEGMENT,
} from "../src/domain/reportProfitabilityV4.mjs";

function productLine(id, {quantity = 1, price = 100, discount = 0} = {}) {
  return {
    lineaId: `line-${id}`,
    itemId: `product-${id}`,
    tipoItem: "producto",
    cantidad: quantity,
    precioUnitario: price,
    descuentoPct: discount,
  };
}

function serviceLine(id, {quantity = 1, price = 100, discount = 0} = {}) {
  return {
    lineaId: `line-${id}`,
    itemId: `service-${id}`,
    tipoItem: "servicio",
    cantidad: quantity,
    precioUnitario: price,
    descuentoPct: discount,
  };
}

function inventoryEffect(line, {quantity = line.cantidad, cost = 60, currency = "CLP"} = {}) {
  return {
    movimientoId: `movement-${line.lineaId}`,
    lineaId: line.lineaId,
    itemId: line.itemId,
    cantidad: quantity,
    costoUnitario: quantity > 0 ? cost / quantity : cost,
    costoTotal: cost,
    costoHistoricoDisponible: true,
    moneda: currency,
  };
}

function sale({
  id,
  items,
  effects = [],
  net,
  discount = 0,
  currency = "CLP",
  status = "confirmada",
  workId = "",
  reverseEffects = [],
}) {
  return {
    id,
    estado: status,
    moneda: currency,
    neto: net,
    descuento: discount,
    trabajoId: workId,
    items,
    efectosInventario: effects,
    efectosInventarioReversa: reverseEffects,
  };
}

function completeProductSale({
  id,
  revenue = 100,
  cost = 60,
  currency = "CLP",
  workId = "",
  status = "confirmada",
}) {
  const line = productLine(id, {price: revenue});
  const effect = inventoryEffect(line, {cost, currency});
  return sale({
    id,
    items: [line],
    effects: [effect],
    net: revenue,
    currency,
    status,
    workId,
    reverseEffects: status === "cancelada" ? [{...effect, tipo: "REVERSA_VENTA"}] : [],
  });
}

function projectBalance({
  id,
  revenue,
  materials = 0,
  labor = 0,
  direct = 0,
  indirect = 0,
  result,
  currency = "CLP",
  missingSaleMaterialCosts = 0,
  status = "COMPLETO",
  operationalStatus = "en_progreso",
}) {
  const cost = materials + labor + direct + indirect;
  return {
    id,
    estado: operationalStatus,
    balance: {
      trabajoId: id,
      estado: status,
      moneda: currency,
      valorComercial: revenue,
      materiales: materials,
      horasHombre: labor,
      gastosDirectos: direct,
      gastosIndirectos: indirect,
      costoTotal: cost,
      resultado: result,
      rentabilidadPct: revenue > 0 ? (result / revenue) * 100 : null,
      fuentes: {materialesVentaSinCosto: missingSaleMaterialCosts},
    },
  };
}

function groupByCurrency(result, currency) {
  return result.grupos.find((group) => group.moneda === currency);
}

// Casos 1 y adicional de SPEC 018: sumas completas y porcentaje desde totales.
const positiveSmall = completeProductSale({id: "positive-small", revenue: 100, cost: 50});
const positiveLarge = completeProductSale({id: "positive-large", revenue: 900, cost: 810});
const weightedSales = aggregateCommercialSalesV4([positiveSmall, positiveLarge]);
const weightedClp = groupByCurrency(weightedSales, "CLP");
assert.equal(weightedClp.coberturaMargen.estado, REPORT_PROFITABILITY_COVERAGE.COMPLETE);
assert.equal(weightedClp.metricas.ingresoNetoProductosCubiertos, 1000);
assert.equal(weightedClp.metricas.costoHistoricoProductosCubiertos, 860);
assert.equal(weightedClp.metricas.margenBrutoProductosCubiertos, 140);
assert.equal(weightedClp.metricas.margenBrutoProductosPct, 14);
assert.notEqual(weightedClp.metricas.margenBrutoProductosPct, 30, "No debe promediar 50 % y 10 %.");

// Caso 2: descuentos de línea y general permanecen delegados a Margen V1.
const discountedLine = productLine("discounted", {price: 1000, discount: 10});
const discounted = sale({
  id: "discounted",
  items: [discountedLine],
  effects: [inventoryEffect(discountedLine, {cost: 500})],
  discount: 100,
  net: 800,
});
const discountedMetrics = groupByCurrency(aggregateCommercialSalesV4([discounted]), "CLP").metricas;
assert.equal(discountedMetrics.ingresoNetoProductosCubiertos, 800);
assert.equal(discountedMetrics.margenBrutoProductosCubiertos, 300);
assert.equal(discountedMetrics.margenBrutoProductosPct, 37.5);

// Caso 3: la Venta mixta sólo agrega la porción cubierta de productos.
const mixedProduct = productLine("mixed-product", {price: 100});
const mixed = sale({
  id: "mixed",
  items: [mixedProduct, serviceLine("mixed-service", {price: 200})],
  effects: [inventoryEffect(mixedProduct, {cost: 40})],
  discount: 30,
  net: 270,
});
const mixedGroup = groupByCurrency(aggregateCommercialSalesV4([mixed]), "CLP");
assert.equal(mixedGroup.metricas.ventasNetasConfirmadasConocidas, 270);
assert.equal(mixedGroup.metricas.ingresoNetoProductosCubiertos, 90);
assert.equal(mixedGroup.metricas.margenBrutoProductosCubiertos, 50);

// Caso 4: sólo servicios es NO_APLICA, no costo ni margen ficticio.
const servicesOnly = sale({
  id: "services-only",
  items: [serviceLine("services-only", {price: 250})],
  net: 250,
});
const servicesGroup = groupByCurrency(aggregateCommercialSalesV4([servicesOnly]), "CLP");
assert.equal(servicesGroup.coberturaMargen.estado, REPORT_PROFITABILITY_COVERAGE.NOT_APPLICABLE);
assert.equal(servicesGroup.conteos.ventasSoloServicios, 1);
assert.equal(servicesGroup.metricas.ingresoNetoProductosCubiertos, null);
assert.equal(servicesGroup.metricas.costoHistoricoProductosCubiertos, null);
assert.equal(servicesGroup.metricas.margenBrutoProductosCubiertos, null);
assert.equal(servicesGroup.metricas.margenBrutoProductosPct, null);

// Casos 5 y 6: legacy incompleta y mezcla conservan incertidumbre explícita.
const legacyLine = productLine("legacy", {price: 120});
const legacyIncomplete = sale({id: "legacy", items: [legacyLine], net: 120});
const partialLine = productLine("partial", {quantity: 2, price: 50});
const partialSale = sale({
  id: "partial",
  items: [partialLine],
  effects: [inventoryEffect(partialLine, {quantity: 1, cost: 20})],
  net: 100,
});
const incompleteOnly = groupByCurrency(
  aggregateCommercialSalesV4([legacyIncomplete, partialSale]),
  "CLP"
);
assert.equal(incompleteOnly.coberturaMargen.estado, REPORT_PROFITABILITY_COVERAGE.UNAVAILABLE);
assert.equal(incompleteOnly.conteos.ventasParciales, 1);
assert.equal(incompleteOnly.conteos.ventasNoDisponibles, 1);
const mixedCoverage = aggregateCommercialSalesV4([
  positiveSmall,
  positiveLarge,
  legacyIncomplete,
]);
assert.deepEqual(mixedCoverage.cobertura, {
  estado: "PARCIAL",
  totalObjetivo: 3,
  completas: 2,
  parciales: 0,
  noDisponibles: 1,
  monedaInconsistente: 0,
  soloServicios: 0,
  lecturaTruncada: false,
  definitivo: false,
});
assert.equal(groupByCurrency(mixedCoverage, "CLP").metricas.margenCubiertoEsTotal, false);

const legacyCompleteLine = productLine("legacy-complete", {price: 150});
const legacyCompleteEffect = inventoryEffect(legacyCompleteLine, {cost: 75});
delete legacyCompleteEffect.costoHistoricoDisponible;
const legacyComplete = sale({
  id: "legacy-complete",
  items: [legacyCompleteLine],
  effects: [legacyCompleteEffect],
  net: 150,
  status: "activo",
});
const legacyCompleteGroup = groupByCurrency(
  aggregateCommercialSalesV4([legacyComplete]),
  "CLP"
);
assert.equal(legacyCompleteGroup.coberturaMargen.estado, "COMPLETO");
assert.equal(legacyCompleteGroup.metricas.margenBrutoProductosCubiertos, 75);

const saleWithoutPersistedNet = completeProductSale({
  id: "without-persisted-net",
  revenue: 100,
  cost: 50,
});
delete saleWithoutPersistedNet.neto;
const missingNetGroup = groupByCurrency(
  aggregateCommercialSalesV4([positiveSmall, saleWithoutPersistedNet]),
  "CLP"
);
assert.equal(missingNetGroup.coberturaMargen.estado, "COMPLETO");
assert.equal(missingNetGroup.coberturaVentasNetas.estado, "PARCIAL");
assert.equal(missingNetGroup.metricas.ventasNetasConfirmadasConocidas, 100);
assert.equal(missingNetGroup.metricas.ventasNetasEsTotal, false);

// Caso 7: una Venta cancelada cuya salida fue revertida no resta importes.
const canceled = completeProductSale({
  id: "canceled-with-reversal",
  revenue: 500,
  cost: 200,
  status: "cancelada",
});
const cancellationResult = aggregateCommercialSalesV4([positiveSmall, canceled]);
assert.equal(cancellationResult.conteos.anuladas, 1);
assert.equal(cancellationResult.conteos.ventasConfirmadas, 1);
assert.equal(groupByCurrency(cancellationResult, "CLP").metricas.margenBrutoProductosCubiertos, 50);

// Caso 8: denominador cero conserva margen monetario y porcentaje nulo.
const freeProduct = completeProductSale({id: "free-product", revenue: 0, cost: 20});
const freeMetrics = groupByCurrency(aggregateCommercialSalesV4([freeProduct]), "CLP").metricas;
assert.equal(freeMetrics.margenBrutoProductosCubiertos, -20);
assert.equal(freeMetrics.margenBrutoProductosPct, null);

// Casos 9 y adicional: Proyectos con ganancia, pérdida y equilibrio; porcentaje ponderado.
const winningProject = projectBalance({
  id: "project-win",
  revenue: 100,
  materials: 30,
  labor: 20,
  direct: 10,
  result: 40,
});
const losingProject = projectBalance({
  id: "project-loss",
  revenue: 50,
  materials: 50,
  labor: 20,
  direct: 10,
  result: -30,
});
const neutralProject = projectBalance({
  id: "project-neutral",
  revenue: 20,
  materials: 20,
  result: 0,
});
const projectSummary = aggregateProjectProfitabilityV4([
  winningProject,
  losingProject,
  neutralProject,
]);
const projectClp = groupByCurrency(projectSummary, "CLP");
assert.deepEqual(
  {
    gain: projectClp.conteos.conGanancia,
    loss: projectClp.conteos.conPerdida,
    neutral: projectClp.conteos.neutros,
  },
  {gain: 1, loss: 1, neutral: 1}
);
assert.equal(projectClp.metricas.valorComercial, 170);
assert.equal(projectClp.metricas.costoRegistrado, 160);
assert.equal(projectClp.metricas.resultado, 10);
assert.equal(projectClp.metricas.rentabilidadPct, 5.88);
assert.equal(classifyProjectBalanceV4(winningProject).estadoOperacional, "en_progreso");
assert.equal(classifyProjectBalanceV4(winningProject.balance).estadoOperacional, "");

// Caso 10: balances sin Venta, con omisión conocida o inválidos no inflan el total completo.
const noSaleProject = projectBalance({
  id: "project-no-sale",
  revenue: null,
  materials: 25,
  result: null,
  status: "PARCIAL_SIN_VENTA",
});
const missingHistoricalCost = projectBalance({
  id: "project-missing-cost",
  revenue: 200,
  materials: 20,
  result: 180,
  missingSaleMaterialCosts: 1,
});
const inconsistentCurrency = projectBalance({
  id: "project-currency-mismatch",
  revenue: null,
  result: null,
  currency: "USD",
  status: "INCONSISTENTE_MONEDA",
});
const invalidAmounts = projectBalance({
  id: "project-invalid",
  revenue: 100,
  materials: 10,
  result: Number.POSITIVE_INFINITY,
});
assert.equal(classifyProjectBalanceV4(noSaleProject).cobertura, "PARCIAL");
assert.equal(classifyProjectBalanceV4(missingHistoricalCost).cobertura, "PARCIAL");
assert.equal(classifyProjectBalanceV4(inconsistentCurrency).cobertura, "NO_DISPONIBLE");
assert.equal(classifyProjectBalanceV4(invalidAmounts).cobertura, "NO_DISPONIBLE");
const unreliableProjects = groupByCurrency(
  aggregateProjectProfitabilityV4([
    winningProject,
    noSaleProject,
    missingHistoricalCost,
    invalidAmounts,
  ]),
  "CLP"
);
assert.equal(unreliableProjects.cobertura.estado, "PARCIAL");
assert.equal(unreliableProjects.conteos.completos, 1);
assert.equal(unreliableProjects.conteos.parciales, 2);
assert.equal(unreliableProjects.conteos.noDisponibles, 1);
assert.equal(unreliableProjects.metricas.resultado, 40);
assert.equal(unreliableProjects.metricas.balanceEsTotal, false);

// Caso 11: monedas incompatibles quedan en grupos independientes, sin FX.
const usdSale = completeProductSale({id: "sale-usd", revenue: 10, cost: 4, currency: "USD"});
const multiCurrencySales = aggregateCommercialSalesV4([positiveSmall, usdSale]);
assert.deepEqual(multiCurrencySales.grupos.map(({moneda}) => moneda), ["CLP", "USD"]);
assert.equal(groupByCurrency(multiCurrencySales, "CLP").metricas.margenBrutoProductosCubiertos, 50);
assert.equal(groupByCurrency(multiCurrencySales, "USD").metricas.margenBrutoProductosCubiertos, 6);
const mismatchedEffectLine = productLine("effect-currency", {price: 100});
const mismatchedEffectSale = sale({
  id: "effect-currency",
  items: [mismatchedEffectLine],
  effects: [inventoryEffect(mismatchedEffectLine, {cost: 20, currency: "USD"})],
  net: 100,
});
const mismatchGroup = groupByCurrency(
  aggregateCommercialSalesV4([mismatchedEffectSale]),
  "CLP"
);
assert.equal(mismatchGroup.conteos.ventasMonedaInconsistente, 1);
assert.equal(mismatchGroup.coberturaMargen.estado, "NO_DISPONIBLE");
assert.equal(mismatchGroup.metricas.margenBrutoProductosCubiertos, null);

const usdProject = projectBalance({
  id: "project-usd",
  revenue: 100,
  materials: 40,
  result: 60,
  currency: "USD",
});
const multiCurrencyProjects = aggregateProjectProfitabilityV4([winningProject, usdProject]);
assert.deepEqual(multiCurrencyProjects.grupos.map(({moneda}) => moneda), ["CLP", "USD"]);

// Caso 12: dataset vacío usa estado explícito y no inventa ceros económicos globales.
const emptySales = aggregateCommercialSalesV4([]);
const emptyProjects = aggregateProjectProfitabilityV4([]);
assert.equal(emptySales.cobertura.estado, REPORT_PROFITABILITY_COVERAGE.EMPTY);
assert.equal(emptyProjects.cobertura.estado, REPORT_PROFITABILITY_COVERAGE.EMPTY);
assert.deepEqual(emptySales.grupos, []);
assert.deepEqual(emptyProjects.grupos, []);

// La futura lectura truncada nunca se declara definitiva (contrato de etapa 2).
const truncatedSales = aggregateCommercialSalesV4([positiveSmall], {truncated: true});
assert.equal(truncatedSales.cobertura.estado, REPORT_PROFITABILITY_COVERAGE.PARTIAL);
assert.equal(groupByCurrency(truncatedSales, "CLP").metricas.margenCubiertoEsTotal, false);

// Segmentación con/sin Proyecto conserva el mismo total comercial, sin sumarlo dos veces.
const projectLinkedSale = completeProductSale({
  id: "sale-with-project",
  revenue: 200,
  cost: 120,
  workId: "project-win",
});
const segmented = groupByCurrency(
  aggregateCommercialSalesV4([positiveSmall, projectLinkedSale]),
  "CLP"
);
assert.equal(segmented.metricas.margenBrutoProductosCubiertos, 130);
assert.equal(
  segmented.segmentos[REPORT_SALE_PROJECT_SEGMENT.WITH_PROJECT]
    .metricas.margenBrutoProductosCubiertos,
  80
);
assert.equal(
  segmented.segmentos[REPORT_SALE_PROJECT_SEGMENT.WITHOUT_PROJECT]
    .metricas.margenBrutoProductosCubiertos,
  50
);

// Caso 13: las familias económicas permanecen separadas y no existe total transversal.
const combined = buildProfitabilityReportV4({
  sales: [projectLinkedSale],
  projectBalances: [winningProject],
});
assert.deepEqual(Object.keys(combined.bloques), [
  REPORT_PROFITABILITY_V4_BLOCK.COMMERCIAL_SALES,
  REPORT_PROFITABILITY_V4_BLOCK.PROJECT_PROFITABILITY,
]);
assert.equal("rentabilidadTotal" in combined, false);
assert.equal("resultadoTotal" in combined, false);
assert.equal("metricas" in combined, false);

// Pureza y frontera técnica: sin mutación, Firebase, red, usuario actual ni queries.
const immutableInput = [positiveSmall, legacyIncomplete];
const inputSnapshot = structuredClone(immutableInput);
aggregateCommercialSalesV4(immutableInput);
assert.deepEqual(immutableInput, inputSnapshot);
const source = await readFile(
  new URL("../src/domain/reportProfitabilityV4.mjs", import.meta.url),
  "utf8"
);
assert.match(source, /calculateSaleCommercialMarginV1\(sale\)/);
assert.doesNotMatch(source, /firebase|firestore|httpsCallable|fetch\s*\(|currentUser|onAuthStateChanged/i);
assert.doesNotMatch(source, /costoBase|costoPromedio|ultimoCosto|adquisiciones/i);

console.log("REPORT_PROFITABILITY_V4_SMOKE_OK");
