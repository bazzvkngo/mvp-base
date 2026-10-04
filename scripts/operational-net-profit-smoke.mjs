import assert from "node:assert/strict";
import {
  calculateOperationalNetProfit,
  classifyOperationalProject,
  normalizeOperationalPeriod,
  OPERATIONAL_NET_PROFIT_COVERAGE,
  OPERATIONAL_PROJECT_EXCLUSION,
} from "../src/domain/operationalNetProfit.mjs";

// SPEC 022 ETAPA 2: ganancia neta operacional, incluibilidad, línea sin costo
// registrado, cobertura y alertas A1-A9. Puro, sin emulador.

const PERIOD = {desde: "2026-03-01", hasta: "2026-06-30"};

function productSale(id, {neto = 100000, price = 50000, quantity = 2, cost = 60000, trabajoId = "", fechaVenta = "2026-04-10", moneda = "CLP", effect = {}} = {}) {
  return {
    ventaId: id, estado: "confirmada", moneda, fechaVenta, trabajoId, neto, total: Math.round(neto * 1.19), descuento: 0,
    items: [{lineaId: `${id}-p`, itemId: `item-${id}`, tipoItem: "producto", cantidad: quantity, precioUnitario: price, descuentoPct: 0}],
    efectosInventario: [{lineaId: `${id}-p`, itemId: `item-${id}`, movimientoId: `mov-${id}`, cantidad: quantity, costoUnitario: cost / quantity, costoTotal: cost, costoHistoricoDisponible: true, ...effect}],
  };
}

function mixedSale(id, {fechaVenta = "2026-05-02"} = {}) {
  return {
    ventaId: id, estado: "confirmada", moneda: "CLP", fechaVenta, trabajoId: "", neto: 50000, total: 59500, descuento: 0,
    items: [
      {lineaId: `${id}-p`, itemId: "item-mixed", tipoItem: "producto", cantidad: 1, precioUnitario: 30000, descuentoPct: 0},
      {lineaId: `${id}-s`, itemId: "service-mixed", tipoItem: "servicio", cantidad: 1, precioUnitario: 20000, descuentoPct: 0},
    ],
    efectosInventario: [{lineaId: `${id}-p`, itemId: "item-mixed", movimientoId: `mov-${id}`, cantidad: 1, costoUnitario: 10000, costoTotal: 10000, costoHistoricoDisponible: true}],
  };
}

function servicesOnlySale(id, {price = 15000} = {}) {
  return {
    ventaId: id, estado: "confirmada", moneda: "CLP", fechaVenta: "2026-05-15", trabajoId: "", neto: price, total: Math.round(price * 1.19), descuento: 0,
    items: [{lineaId: `${id}-s`, itemId: "service-only", tipoItem: "servicio", cantidad: 1, precioUnitario: price, descuentoPct: 0}],
    efectosInventario: [],
  };
}

function month(mes, {ingresoNeto = 0, materialesVenta = 0, materialesAdicionales = 0, horasHombre = 0, gastosDirectos = 0, gastosIndirectos = 0, moneda = "CLP"} = {}) {
  const costoTotal = materialesVenta + materialesAdicionales + horasHombre + gastosDirectos + gastosIndirectos;
  return {mes, moneda, ingresoNeto, materialesVenta, materialesAdicionales, horasHombre, gastosDirectos, gastosIndirectos, costoTotal, resultado: ingresoNeto - costoTotal};
}

function project(id, {estado = "COMPLETO", moneda = "CLP", meses = [], fuentes = {}} = {}) {
  const sum = (field) => meses.filter((entry) => entry.moneda === moneda).reduce((total, entry) => total + entry[field], 0);
  const hasSale = estado === "COMPLETO";
  return {
    id,
    balance: {
      modeloBalanceVersion: 3, trabajoId: id, moneda, estado,
      valorComercial: hasSale ? sum("ingresoNeto") : null,
      costoTotal: sum("costoTotal"),
      resultado: hasSale ? sum("resultado") : null,
      desglosePorMes: meses,
      fuentes: {materialesVentaSinCosto: 0, ventasSinNetoValido: 0, registrosSinFecha: 0, ...fuentes},
    },
  };
}

// P1: costos en marzo, Venta en mayo, y actividad fuera del período (julio).
const p1Months = [
  month("2026-03", {horasHombre: 40000, gastosDirectos: 20000, gastosIndirectos: 10000, materialesAdicionales: 30000}),
  month("2026-05", {ingresoNeto: 200000, materialesVenta: 30000}),
  month("2026-07", {ingresoNeto: 999999}),
];
const p1 = project("p1", {meses: p1Months});
// P2: Proyecto en curso sin Venta, con costos en abril (§5.4: restan).
const p2 = project("p2", {estado: "PARCIAL_SIN_VENTA", meses: [month("2026-04", {horasHombre: 15000})]});

const baseSales = [productSale("v-product"), mixedSale("v-mixed"), servicesOnlySale("v-services")];
// Venta CON Proyecto: aporta sólo vía el balance del Proyecto, nunca vía V1.
const projectSale = productSale("v-with-project", {trabajoId: "p1", neto: 500000, price: 250000, cost: 1});

function group(result, currency = "CLP") {
  return result.grupos.find((entry) => entry.moneda === currency);
}
const alertIds = (entry) => entry.alertas.map((alert) => alert.id);

// --- §4.1: fórmula con ambos universos ---
const full = calculateOperationalNetProfit({sales: [...baseSales, projectSale], projectBalances: [p1, p2], period: PERIOD});
const clp = group(full);
assert.deepEqual(clp.componentes.ventasSinProyecto, {ventas: 2, ingresoNetoProductos: 130000, costoHistoricoProductos: 70000, margenBrutoProductos: 60000});
assert.deepEqual(clp.componentes.proyectos, {proyectos: 2, ingresoNeto: 200000, materialesVenta: 30000, materialesAdicionales: 30000, horasHombre: 55000, gastosDirectos: 20000, gastosIndirectos: 10000, costoTotal: 145000, resultado: 55000});
assert.equal(clp.gananciaNetaOperacional, 115000, "60000 (productos sin Proyecto) + 70000 (P1 marzo−mayo) − 15000 (P2 abril)");
assert.equal(clp.ingresoNetoConsiderado, 330000);
assert.equal(clp.gananciaNetaOperacionalPct, 34.85, "desde las sumas: 115000 / 330000");
// Promedio de porcentajes individuales (producto 40 %, mixta 66,67 %, P1 35 %, P2 sin ingreso): ≠ 34,85 %.
assert.notEqual(clp.gananciaNetaOperacionalPct, Math.round(((40 + 66.67 + 35) / 3) * 100) / 100, "nunca se promedian porcentajes");
console.log("OK §4.1: 60000 + 55000 = 115000; ingreso considerado 330000; 34,85 %");

const withoutProjectSale = calculateOperationalNetProfit({sales: baseSales, projectBalances: [p1, p2], period: PERIOD});
assert.equal(group(withoutProjectSale).gananciaNetaOperacional, clp.gananciaNetaOperacional);
assert.equal(group(withoutProjectSale).componentes.ventasSinProyecto.ventas, 2);
console.log("OK §4.2: la Venta CON Proyecto no entra por la vía V1 (su margen de 499999 no aparece)");

const outsideMonth = calculateOperationalNetProfit({sales: baseSales, projectBalances: [p1], period: {desde: "2026-07-01", hasta: "2026-07-31"}});
assert.equal(group(outsideMonth).componentes.proyectos.ingresoNeto, 999999);
assert.equal(group(outsideMonth).componentes.ventasSinProyecto.ventas, 0, "las Ventas fuera del rango no aportan");
console.log("OK período: Proyectos aportan sólo meses del período y Ventas sólo por fechaVenta en rango");

// --- §4.4: "Ventas sin costo registrado" nunca entra en la suma ---
assert.deepEqual(clp.ventasSinCostoRegistrado, {ventas: 2, monto: 35000}, "servicio de la mixta (20000) + Venta sólo servicios (15000)");
const withoutServices = calculateOperationalNetProfit({sales: [productSale("v-product"), mixedSale("v-mixed")], projectBalances: [p1, p2], period: PERIOD});
const hugeServices = calculateOperationalNetProfit({sales: [...baseSales.slice(0, 2), servicesOnlySale("v-services", {price: 900000000})], projectBalances: [p1, p2], period: PERIOD});
for (const variant of [withoutServices, hugeServices]) {
  assert.equal(group(variant).gananciaNetaOperacional, clp.gananciaNetaOperacional, "la ganancia no cambia con la línea sin costo");
  assert.equal(group(variant).ingresoNetoConsiderado, clp.ingresoNetoConsiderado, "el denominador tampoco");
  assert.equal(group(variant).gananciaNetaOperacionalPct, clp.gananciaNetaOperacionalPct);
}
assert.equal(group(withoutServices).ventasSinCostoRegistrado.monto, 20000);
assert.equal(group(hugeServices).ventasSinCostoRegistrado.monto, 900020000);
assert.equal(clp.gananciaNetaOperacional, clp.componentes.ventasSinProyecto.margenBrutoProductos + clp.componentes.proyectos.resultado, "la ganancia es exactamente sus dos componentes, sin la línea sin costo");
console.log("OK §4.4: sin costo registrado = 35000 aparte; quitarla o multiplicarla no mueve ganancia, ingreso ni %");

// --- §4.5: incluibilidad, un caso por criterio ---
assert.equal(classifyOperationalProject(p1).incluible, true);
assert.equal(classifyOperationalProject(p2).incluible, true, "PARCIAL_SIN_VENTA es incluible");
const p1Result = 70000;
const exclusionCases = [
  ["estado INCONSISTENTE_MONEDA", project("p1", {estado: "INCONSISTENTE_MONEDA", meses: p1Months}), OPERATIONAL_PROJECT_EXCLUSION.CURRENCY_MISMATCH, "A6"],
  ["estado no incluible", project("p1", {estado: "OTRO", meses: p1Months}), OPERATIONAL_PROJECT_EXCLUSION.UNSUPPORTED_STATUS, "A9"],
  ["materialesVentaSinCosto", project("p1", {meses: p1Months, fuentes: {materialesVentaSinCosto: 1}}), OPERATIONAL_PROJECT_EXCLUSION.MISSING_SALE_MATERIAL_COST, "A5"],
  ["ventasSinNetoValido", project("p1", {meses: p1Months, fuentes: {ventasSinNetoValido: 2}}), OPERATIONAL_PROJECT_EXCLUSION.INVALID_SALE_NET, "A3"],
  ["importes no finitos", project("p1", {meses: [...p1Months.slice(0, 1), {...p1Months[1], resultado: Number.NaN}]}), OPERATIONAL_PROJECT_EXCLUSION.NON_FINITE_AMOUNTS, "A9"],
  ["registrosSinFecha (§5.1)", project("p1", {meses: p1Months, fuentes: {registrosSinFecha: 1}}), OPERATIONAL_PROJECT_EXCLUSION.UNDATED_RECORDS, "A7"],
];
for (const [label, excluded, motive, alert] of exclusionCases) {
  const classification = classifyOperationalProject(excluded);
  assert.equal(classification.incluible, false, label);
  assert.equal(classification.motivo, motive, label);
  const result = group(calculateOperationalNetProfit({sales: baseSales, projectBalances: [excluded, p2], period: PERIOD}));
  assert.equal(result.gananciaNetaOperacional, clp.gananciaNetaOperacional - p1Result, `${label}: P1 sale completo (ni ingreso ni costos)`);
  assert.equal(result.componentes.proyectos.ingresoNeto, 0, `${label}: sin ingreso de P1`);
  assert.equal(result.componentes.proyectos.costoTotal, 15000, `${label}: sólo quedan los costos de P2`);
  assert.equal(result.cobertura, OPERATIONAL_NET_PROFIT_COVERAGE.PARTIAL, label);
  assert.ok(alertIds(result).includes(alert), `${label}: dispara ${alert}`);
}
assert.equal(classifyOperationalProject({id: "legacy-v2", balance: {...p1.balance, fuentes: {materialesVentaSinCosto: 0}}}).incluible, false, "un balance v2 sin los contadores nuevos no es incluible");
console.log("OK §4.5: cada criterio excluye el Proyecto completo (115000 → 45000) y deja cobertura PARCIAL");

// --- Cobertura ---
const clean = calculateOperationalNetProfit({sales: [productSale("v-product")], projectBalances: [p1], period: PERIOD});
assert.equal(group(clean).cobertura, OPERATIONAL_NET_PROFIT_COVERAGE.COMPLETE);
assert.equal(group(clean).esTotalDefinitivo, true);
assert.deepEqual(group(clean).alertas, []);
assert.equal(group(clean).gananciaNetaOperacional, 110000);
const onlyA4 = calculateOperationalNetProfit({sales: [productSale("v-product")], projectBalances: [p1, p2], period: PERIOD});
assert.deepEqual(alertIds(group(onlyA4)), ["A4"]);
assert.equal(group(onlyA4).cobertura, OPERATIONAL_NET_PROFIT_COVERAGE.COMPLETE, "A4 se incluye y no degrada la cobertura");
const empty = calculateOperationalNetProfit({sales: [], projectBalances: [], period: PERIOD});
assert.deepEqual(empty.grupos, [], "sin Ventas ni costos: vacío, no cero");
const emptyByPeriod = calculateOperationalNetProfit({sales: [productSale("v-product")], projectBalances: [p1], period: {desde: "2025-01-01", hasta: "2025-01-31"}});
assert.deepEqual(emptyByPeriod.grupos, []);
console.log("OK cobertura: COMPLETA sin alertas (110000), COMPLETA con sólo A4, vacío sin datos");

// --- Alertas A1-A9: cada una dispara con su caso y sólo con él ---
const alertCases = [
  ["A1", {sales: [productSale("v-product"), productSale("v-no-cost", {effect: {costoHistoricoDisponible: false}})]}, {monto: 100000}],
  ["A2", {sales: [productSale("v-product"), productSale("v-currency", {effect: {moneda: "USD"}})]}, {monto: 100000}],
  ["A3", {sales: [productSale("v-product"), {...productSale("v-no-net"), neto: undefined}]}, {monto: null}],
  ["A4", {projectBalances: [p1, p2]}, {monto: 15000}],
  ["A5", {projectBalances: [p1, project("p5", {meses: [month("2026-04", {horasHombre: 1})], fuentes: {materialesVentaSinCosto: 3}})]}, {monto: null}],
  ["A6", {projectBalances: [p1, project("p6", {estado: "INCONSISTENTE_MONEDA", meses: [month("2026-04", {horasHombre: 1})]})]}, {monto: null}],
  ["A7", {projectBalances: [p1, project("p7", {meses: [], fuentes: {registrosSinFecha: 2}})]}, {monto: null}],
  ["A8", {salesTruncated: true}, {monto: null}],
  ["A9", {projectsError: true}, {monto: null}],
];
for (const [id, overrides, expected] of alertCases) {
  const result = calculateOperationalNetProfit({sales: [productSale("v-product")], projectBalances: [p1], period: PERIOD, ...overrides});
  const target = group(result);
  assert.deepEqual(alertIds(target), [id], `${id}: dispara sola`);
  assert.equal(target.alertas[0].conteo, 1, `${id}: conteo`);
  assert.equal(target.alertas[0].monto, expected.monto, `${id}: monto`);
  assert.equal(target.cobertura, id === "A4" ? OPERATIONAL_NET_PROFIT_COVERAGE.COMPLETE : OPERATIONAL_NET_PROFIT_COVERAGE.PARTIAL, `${id}: cobertura`);
}
const projectA3 = group(calculateOperationalNetProfit({sales: [productSale("v-product")], projectBalances: [project("p3", {meses: [month("2026-04", {horasHombre: 1})], fuentes: {ventasSinNetoValido: 2}})], period: PERIOD}));
assert.deepEqual(alertIds(projectA3), ["A3"]);
assert.equal(projectA3.alertas[0].conteo, 2, "A3 también cuenta las Ventas sin neto válido de un Proyecto");
const inactiveMismatch = group(calculateOperationalNetProfit({sales: [productSale("v-product")], projectBalances: [p1, project("old", {estado: "INCONSISTENTE_MONEDA", meses: [month("2025-01", {horasHombre: 1})]})], period: PERIOD}));
assert.deepEqual(alertIds(inactiveMismatch), [], "un Proyecto excluido sin actividad en el período no alerta");
const invalidStructure = group(calculateOperationalNetProfit({sales: [productSale("v-product")], projectBalances: [p1, {id: "broken", balance: {moneda: "CLP", estado: "COMPLETO"}}], period: PERIOD}));
assert.deepEqual(alertIds(invalidStructure), ["A9"], "balance sin desglosePorMes: no utilizable, se reporta como A9");
assert.deepEqual(alertIds(group(clean)), [], "sin ningún caso no dispara ninguna alerta");
console.log("OK alertas: A1..A9 disparan solas con su caso; ninguna sin caso; Proyecto inactivo no alerta");

// --- Monedas separadas ---
const multiCurrency = calculateOperationalNetProfit({sales: [productSale("v-product"), productSale("v-usd", {moneda: "USD", neto: 1000, price: 500, cost: 400})], projectBalances: [p1], period: PERIOD});
assert.deepEqual(multiCurrency.grupos.map((entry) => [entry.moneda, entry.gananciaNetaOperacional]), [["CLP", 110000], ["USD", 600]]);
console.log("OK monedas: CLP y USD separados, sin FX ni total transversal");

// --- Período ---
assert.equal(normalizeOperationalPeriod(PERIOD).proyectosPorMesCompleto, false);
assert.equal(normalizeOperationalPeriod({desde: "2026-03-15", hasta: "2026-06-30"}).proyectosPorMesCompleto, true);
assert.equal(normalizeOperationalPeriod({desde: "2026-02-01", hasta: "2026-02-28"}).proyectosPorMesCompleto, false);
assert.throws(() => normalizeOperationalPeriod({desde: "2026-06-30", hasta: "2026-03-01"}));
console.log("OK período: bandera proyectosPorMesCompleto cuando el rango corta un mes");

console.log("OPERATIONAL_NET_PROFIT_SMOKE_OK");
