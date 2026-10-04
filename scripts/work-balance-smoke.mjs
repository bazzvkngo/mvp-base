import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {adaptWorkBalance, canViewWorkProfitability} from "../src/domain/workModel.mjs";

const require = createRequire(import.meta.url);
const {calculateWorkBalance, obtenerBalanceTrabajoHandler, WORK_BALANCE_MODEL_VERSION} = require("../functions/workBalance.js");

class TestHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const work = {trabajoId: "work-a", negocioId: "business-a", moneda: "USD"};
const business = {negocioId: "business-a", monedaCodigo: "USD"};
// SPEC 022 §7: la Venta trae neto distinto de total (IVA 19 %); el balance debe usar el neto.
const sales = [
  {ventaId: "sale-confirmed", negocioId: "business-a", trabajoId: "work-a", estado: "confirmada", moneda: "USD", fechaVenta: "2026-05-20", neto: 200000, iva: 38000, total: 238000, items: [
    {lineaId: "product-line", tipoItem: "producto", nombre: "Cable"},
    {lineaId: "service-line", tipoItem: "servicio", nombre: "Instalación"},
    {lineaId: "activity-line", tipoItem: "actividad", nombre: "Programación"},
  ], efectosInventario: [{lineaId: "product-line", movimientoId: "sale-movement", itemId: "product-a", cantidad: 2, costoUnitario: 15000, costoTotal: 30000, moneda: "USD", costoHistoricoDisponible: true}]},
  {ventaId: "sale-draft", negocioId: "business-a", trabajoId: "work-a", estado: "borrador", moneda: "USD", fechaVenta: "2026-05-21", neto: 500000, total: 595000},
];
const quotes = [{cotizacionId: "quote-rejected", negocioId: "business-a", trabajoId: "work-a", estado: "rechazada", moneda: "USD", total: 999999}];
// Costos registrados en marzo/abril y Venta en mayo (SPEC 022 §5.4).
const expenses = [
  {gastoId: "material-manual", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", categoria: "MATERIAL", clasificacionCosto: "DIRECTO", moneda: "USD", monto: 50000, fecha: "2026-03-08"},
  {gastoId: "direct", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", categoria: "OPERATIVO", clasificacionCosto: "DIRECTO", moneda: "USD", monto: 20000, fecha: "2026-03-10"},
  {gastoId: "admin", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", categoria: "ADMINISTRATIVO", clasificacionCosto: "INDIRECTO", moneda: "USD", monto: 10000, fecha: "2026-03-31"},
  {gastoId: "annulled", negocioId: "business-a", trabajoId: "work-a", estado: "anulado", categoria: "OTRO", clasificacionCosto: "DIRECTO", moneda: "USD", monto: 300000, fecha: "2026-03-12"},
];
const labor = [{horasHombreId: "labor-a", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", moneda: "USD", horas: 4, costoHora: 10000, total: 40000, fecha: "2026-03-15"}];
const materialMovements = [
  {movimientoId: "exit-a", negocioId: "business-a", trabajoId: "work-a", tipo: "SALIDA_PROYECTO", moneda: "USD", costoTotal: 30000, fecha: "2026-03-05"},
  {movimientoId: "return-a", negocioId: "business-a", trabajoId: "work-a", tipo: "DEVOLUCION_PROYECTO", movimientoOrigenId: "exit-a", moneda: "USD", costoTotal: 10000, fecha: "2026-04-02"},
];

// Reconciliación SPEC 022 §5.3: por moneda, la suma de desglosePorMes es exactamente el acumulado.
const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const MONTHLY_TO_ACCUMULATED = {ingresoNeto: "valorComercial", materialesVenta: "materialesVenta", materialesAdicionales: "materialesAdicionales", horasHombre: "horasHombre", gastosDirectos: "gastosDirectos", gastosIndirectos: "gastosIndirectos", costoTotal: "costoTotal"};
function monthlyTotals(balance, currencyCode) {
  const totals = Object.fromEntries([...Object.keys(MONTHLY_TO_ACCUMULATED), "resultado"].map((field) => [field, 0]));
  balance.desglosePorMes.filter((entry) => entry.moneda === currencyCode).forEach((entry) => {
    Object.keys(totals).forEach((field) => { totals[field] = roundMoney(totals[field] + entry[field]); });
  });
  return totals;
}
function assertReconciles(balance, label) {
  assert.equal(balance.fuentes.registrosSinFecha, 0, `${label}: la reconciliación exacta exige registros con fecha`);
  for (const bucket of balance.desglosePorMoneda) {
    const totals = monthlyTotals(balance, bucket.moneda);
    for (const [monthlyField, accumulatedField] of Object.entries(MONTHLY_TO_ACCUMULATED)) {
      assert.equal(totals[monthlyField], bucket[accumulatedField], `${label}: ${bucket.moneda} ${monthlyField} mensual ≠ ${accumulatedField} acumulado`);
    }
    assert.equal(totals.resultado, roundMoney(bucket.valorComercial - bucket.costoTotal), `${label}: ${bucket.moneda} resultado mensual ≠ acumulado`);
  }
  if (!balance.consistenteMoneda) return;
  const base = monthlyTotals(balance, balance.moneda);
  assert.equal(base.costoTotal, balance.costoTotal, `${label}: costoTotal`);
  if (balance.valorComercial !== null) assert.equal(base.ingresoNeto, balance.valorComercial, `${label}: valorComercial`);
  if (balance.resultado !== null) assert.equal(base.resultado, balance.resultado, `${label}: resultado`);
}

const complete = calculateWorkBalance({business, work, sales, quotes, expenses, labor, materialMovements});
assert.equal(complete.modeloBalanceVersion, WORK_BALANCE_MODEL_VERSION);
assert.equal(WORK_BALANCE_MODEL_VERSION, 3);
assert.equal(complete.estado, "COMPLETO");
assert.equal(complete.valorComercial, 200000, "valorComercial es el neto de la Venta, no su total con IVA");
assert.notEqual(complete.valorComercial, sales[0].total);
assert.equal(complete.materialesVenta, 30000);
assert.equal(complete.materialesAdicionales, 20000);
assert.equal(complete.materiales, 50000);
assert.equal(complete.horasHombre, 40000);
assert.equal(complete.gastosDirectos, 20000);
assert.equal(complete.gastosIndirectos, 10000);
assert.equal(complete.costoTotal, 120000);
assert.equal(complete.resultado, 80000, "resultado = neto 200000 − costos 120000 (con total sería 118000)");
assert.equal(complete.rentabilidadPct, 40, "rentabilidad sobre neto (con total sería 49,58 %)");
assert.equal(complete.gastosMaterialExcluido, 50000);
assert.equal(complete.fuentes.cotizacionesRechazadas, 1);
assert.equal(complete.fuentes.ventasConfirmadas, 1);
assert.equal(complete.fuentes.ventasSinNetoValido, 0);
assert.equal(complete.fuentes.registrosSinFecha, 0);
assert.equal(complete.fuentes.movimientosMaterialesVenta, 1);
assert.equal(complete.fuentes.materialesVentaSinCosto, 0);
assert.equal(complete.fuentes.gastosMaterialExcluidos, 1);
console.log("OK balance: Venta confirmada a neto, costos vigentes, devolución, resultado y rentabilidad");

// SPEC 022 §5.1/§5.4: cada componente cae en el mes de su propia fecha; el gasto
// anulado y el gasto MATERIAL excluido no aparecen en ningún mes.
assert.deepEqual(complete.desglosePorMes, [
  {mes: "2026-03", moneda: "USD", ingresoNeto: 0, materialesVenta: 0, materialesAdicionales: 30000, horasHombre: 40000, gastosDirectos: 20000, gastosIndirectos: 10000, costoTotal: 100000, resultado: -100000},
  {mes: "2026-04", moneda: "USD", ingresoNeto: 0, materialesVenta: 0, materialesAdicionales: -10000, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: -10000, resultado: 10000},
  {mes: "2026-05", moneda: "USD", ingresoNeto: 200000, materialesVenta: 30000, materialesAdicionales: 0, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: 30000, resultado: 170000},
]);
assertReconciles(complete, "completo");
console.log("OK desglose mensual: costos en marzo (−100000), devolución en abril (+10000), Venta en mayo (+170000); suma = resultado 80000");

const partial = calculateWorkBalance({business, work, sales: [], quotes, expenses, labor, materialMovements});
assert.equal(partial.estado, "PARCIAL_SIN_VENTA");
assert.equal(partial.valorComercial, null); assert.equal(partial.resultado, null); assert.equal(partial.rentabilidadPct, null); assert.equal(partial.costoTotal, 90000);
assertReconciles(partial, "parcial");
assert.deepEqual(partial.desglosePorMes.map((entry) => [entry.mes, entry.resultado]), [["2026-03", -100000], ["2026-04", 10000]]);
console.log("OK parcial: sin Venta no inventa ingresos ni margen; sus costos sí restan en su mes");

const canceled = calculateWorkBalance({business, work, sales: [{...sales[0], estado: "cancelada"}], quotes, expenses, labor, materialMovements});
assert.equal(canceled.estado, "PARCIAL_SIN_VENTA"); assert.equal(canceled.materialesVenta, 0); assert.equal(canceled.materialesAdicionales, 20000); assert.equal(canceled.costoTotal, 90000);
console.log("OK cancelación: revierte la Venta completa sin borrar consumos adicionales del Proyecto");

const legacySaleCost = calculateWorkBalance({business, work, sales: [{...sales[0], efectosInventario: [{lineaId: "product-line", movimientoId: "legacy-movement", itemId: "product-a", cantidad: 2}]}], quotes, expenses, labor, materialMovements});
assert.equal(legacySaleCost.materialesVenta, 0); assert.equal(legacySaleCost.fuentes.materialesVentaSinCosto, 1); assert.equal(legacySaleCost.reglaMateriales, "INVENTARIO_AUTORITATIVO");
console.log("OK legacy: costo histórico ausente se informa y no se reemplaza por costo vigente");

const inconsistent = calculateWorkBalance({business, work, sales: [...sales, {ventaId: "sale-clp", negocioId: "business-a", trabajoId: "work-a", estado: "confirmada", moneda: "CLP", fechaVenta: "2026-05-22", neto: 100000, total: 119000}], quotes, expenses, labor, materialMovements});
assert.equal(inconsistent.estado, "INCONSISTENTE_MONEDA");
assert.equal(inconsistent.consistenteMoneda, false); assert.deepEqual(inconsistent.monedasIncompatibles, ["CLP"]);
for (const field of ["valorComercial", "materiales", "horasHombre", "gastosDirectos", "gastosIndirectos", "costoTotal", "resultado", "rentabilidadPct"]) assert.equal(inconsistent[field], null);
assert.equal(inconsistent.desglosePorMoneda.length, 2);
assert.equal(inconsistent.desglosePorMoneda.find((entry) => entry.moneda === "CLP").valorComercial, 100000);
assert.deepEqual(inconsistent.desglosePorMes.filter((entry) => entry.moneda === "CLP").map((entry) => [entry.mes, entry.ingresoNeto]), [["2026-05", 100000]]);
assertReconciles(inconsistent, "moneda inconsistente");
console.log("OK moneda: no mezcla importes y conserva desglose por moneda");

const legacy = calculateWorkBalance({business, work: {trabajoId: "legacy", negocioId: "business-a"}, expenses: [{negocioId: "business-a", trabajoId: "legacy", categoria: "MATERIAL", monto: 50000}], sales: [], labor: [], materialMovements: []});
assert.equal(legacy.estado, "PARCIAL_SIN_VENTA"); assert.equal(legacy.reglaMateriales, "GASTO_MATERIAL_LEGACY"); assert.equal(legacy.gastosDirectos, 50000); assert.equal(legacy.materiales, 0);
const emptyLegacy = calculateWorkBalance({business, work: {trabajoId: "empty", negocioId: "business-a"}});
assert.equal(emptyLegacy.costoTotal, 0); assert.equal(emptyLegacy.valorComercial, null);
console.log("OK legacy: gasto MATERIAL sin libro se conserva y expediente vacío queda en cero/parcial");

// SPEC 022 §7.3: ejemplo declarado del cambio numérico (antes 59000 / 49,58 %).
const vatExample = calculateWorkBalance({
  business,
  work,
  sales: [{ventaId: "sale-vat", negocioId: "business-a", trabajoId: "work-a", estado: "confirmada", moneda: "USD", fechaVenta: "2026-06-10", neto: 100000, iva: 19000, total: 119000}],
  labor: [{horasHombreId: "labor-vat", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", moneda: "USD", total: 60000, fecha: "2026-06-11"}],
});
assert.equal(vatExample.valorComercial, 100000); assert.equal(vatExample.costoTotal, 60000); assert.equal(vatExample.resultado, 40000); assert.equal(vatExample.rentabilidadPct, 40);
assertReconciles(vatExample, "ejemplo IVA");
console.log("OK IVA real: Venta neto 100000 / total 119000 con costos 60000 da resultado 40000 y margen 40 %");

// SPEC 022 §7.1.2: una Venta confirmada sin neto finito ≥ 0 no aporta ingreso ni usa total como respaldo.
const invalidNetSales = [
  {ventaId: "sale-valid", negocioId: "business-a", trabajoId: "work-a", estado: "confirmada", moneda: "USD", fechaVenta: "2026-05-20", neto: 200000, total: 238000},
  {ventaId: "sale-no-net", negocioId: "business-a", trabajoId: "work-a", estado: "confirmada", moneda: "USD", fechaVenta: "2026-05-21", total: 119000},
  {ventaId: "sale-negative-net", negocioId: "business-a", trabajoId: "work-a", estado: "confirmada", moneda: "USD", fechaVenta: "2026-05-22", neto: -1, total: 119000},
  {ventaId: "sale-text-net", negocioId: "business-a", trabajoId: "work-a", estado: "confirmada", moneda: "USD", fechaVenta: "2026-05-23", neto: "100000", total: 119000},
];
const invalidNet = calculateWorkBalance({business, work, sales: invalidNetSales, labor});
assert.equal(invalidNet.estado, "COMPLETO");
assert.equal(invalidNet.fuentes.ventasConfirmadas, 4); assert.equal(invalidNet.fuentes.ventasSinNetoValido, 3);
assert.equal(invalidNet.valorComercial, 200000, "sólo aporta la Venta con neto válido");
assert.equal(invalidNet.resultado, 160000);
assertReconciles(invalidNet, "neto inválido");
const onlyInvalidNet = calculateWorkBalance({business, work, sales: [invalidNetSales[1]], labor});
assert.equal(onlyInvalidNet.fuentes.ventasSinNetoValido, 1);
assert.equal(onlyInvalidNet.valorComercial, 0, "nunca 119000: total no es respaldo del neto");
assert.equal(onlyInvalidNet.resultado, -40000); assert.equal(onlyInvalidNet.rentabilidadPct, null);
assertReconciles(onlyInvalidNet, "sólo neto inválido");
console.log("OK neto inválido: ausente, negativo o texto no aporta ingreso, no usa total y se cuenta en ventasSinNetoValido");

// SPEC 022 §5.1: un registro sin fecha válida aporta al acumulado pero a ningún mes, y se cuenta.
const undated = calculateWorkBalance({
  business,
  work,
  sales: [{...sales[0], fechaVenta: ""}],
  expenses: [...expenses, {gastoId: "bad-date", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", categoria: "OPERATIVO", clasificacionCosto: "DIRECTO", moneda: "USD", monto: 5000, fecha: "2026-13-40"}],
  labor: [...labor, {horasHombreId: "labor-undated", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", moneda: "USD", total: 7000}],
  materialMovements,
});
assert.equal(undated.fuentes.registrosSinFecha, 3, "Venta sin fechaVenta (con su material), gasto con fecha inválida y HH sin fecha");
assert.equal(undated.valorComercial, 200000); assert.equal(undated.horasHombre, 47000); assert.equal(undated.gastosDirectos, 25000); assert.equal(undated.materialesVenta, 30000);
const undatedMonthly = monthlyTotals(undated, "USD");
assert.equal(undatedMonthly.ingresoNeto, 0); assert.equal(undatedMonthly.materialesVenta, 0);
assert.equal(roundMoney(undated.horasHombre - undatedMonthly.horasHombre), 7000);
assert.equal(roundMoney(undated.gastosDirectos - undatedMonthly.gastosDirectos), 5000);
assert.equal(roundMoney(undated.costoTotal - undatedMonthly.costoTotal), 42000, "la diferencia es exactamente lo no fechado: 30000 + 5000 + 7000");
console.log("OK sin fecha: registrosSinFecha=3; el mensual difiere del acumulado exactamente en lo no fechado (42000 de costo, 200000 de ingreso)");

assert.equal(canViewWorkProfitability("OWNER"), true); assert.equal(canViewWorkProfitability("ADMIN"), true); assert.equal(canViewWorkProfitability("FINANZAS"), true); assert.equal(canViewWorkProfitability("TECNICO"), false); assert.equal(canViewWorkProfitability("MEMBER"), false);
assert.equal(adaptWorkBalance(complete).rentabilidadPct, 40);

const snapshot = (value) => ({exists: value != null, data: () => value});
const loaded = {workSnapshot: snapshot(work), businessSnapshot: snapshot(business), sales, quotes, expenses, labor, materialMovements};
const dependencies = {
  db: {},
  HttpsError: TestHttpsError,
  requireBusinessAccess: async (request, _dependencies, options) => {
    const role = request.auth?.role;
    if (!request.auth?.uid) throw new TestHttpsError("unauthenticated", "auth");
    if (!options.roles.includes(role)) throw new TestHttpsError("permission-denied", "role");
    return {uid: request.auth.uid, businessId: request.data.businessId, businessRef: {}};
  },
  loadWorkBalanceDocuments: async () => loaded,
};
const ownerBalance = await obtenerBalanceTrabajoHandler({auth: {uid: "owner-a", role: "OWNER"}, data: {businessId: "business-a", trabajoId: "work-a"}}, dependencies);
assert.equal(ownerBalance.resultado, 80000); assert.equal(ownerBalance.valorComercial, 200000); assert.equal(ownerBalance.modeloBalanceVersion, 3); assert.equal(typeof ownerBalance.calculadoEn, "string");
assert.equal(ownerBalance.desglosePorMes.length, 3);
const financeBalance = await obtenerBalanceTrabajoHandler({auth: {uid: "finance-a", role: "FINANZAS"}, data: {businessId: "business-a", trabajoId: "work-a"}}, dependencies);
assert.equal(financeBalance.resultado, 80000);
await assert.rejects(() => obtenerBalanceTrabajoHandler({auth: {uid: "member-a", role: "MEMBER"}, data: {businessId: "business-a", trabajoId: "work-a"}}, dependencies), (error) => error.code === "permission-denied");
await assert.rejects(() => obtenerBalanceTrabajoHandler({auth: {uid: "tech-a", role: "TECNICO"}, data: {businessId: "business-a", trabajoId: "work-a"}}, dependencies), (error) => error.code === "permission-denied");
console.log("OK seguridad: margen limitado a OWNER/ADMIN/FINANZAS y denegado a TECNICO");

console.log("WORK_BALANCE_SMOKE_OK");
