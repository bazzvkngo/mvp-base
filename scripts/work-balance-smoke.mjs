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
const sales = [
  {ventaId: "sale-confirmed", negocioId: "business-a", trabajoId: "work-a", estado: "confirmada", moneda: "USD", total: 200000, items: [
    {lineaId: "product-line", tipoItem: "producto", nombre: "Cable"},
    {lineaId: "service-line", tipoItem: "servicio", nombre: "Instalación"},
    {lineaId: "activity-line", tipoItem: "actividad", nombre: "Programación"},
  ], efectosInventario: [{lineaId: "product-line", movimientoId: "sale-movement", itemId: "product-a", cantidad: 2, costoUnitario: 15000, costoTotal: 30000, moneda: "USD", costoHistoricoDisponible: true}]},
  {ventaId: "sale-draft", negocioId: "business-a", trabajoId: "work-a", estado: "borrador", moneda: "USD", total: 500000},
];
const quotes = [{cotizacionId: "quote-rejected", negocioId: "business-a", trabajoId: "work-a", estado: "rechazada", moneda: "USD", total: 999999}];
const expenses = [
  {gastoId: "material-manual", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", categoria: "MATERIAL", clasificacionCosto: "DIRECTO", moneda: "USD", monto: 50000},
  {gastoId: "direct", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", categoria: "OPERATIVO", clasificacionCosto: "DIRECTO", moneda: "USD", monto: 20000},
  {gastoId: "admin", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", categoria: "ADMINISTRATIVO", clasificacionCosto: "INDIRECTO", moneda: "USD", monto: 10000},
  {gastoId: "annulled", negocioId: "business-a", trabajoId: "work-a", estado: "anulado", categoria: "OTRO", clasificacionCosto: "DIRECTO", moneda: "USD", monto: 300000},
];
const labor = [{horasHombreId: "labor-a", negocioId: "business-a", trabajoId: "work-a", estado: "vigente", moneda: "USD", horas: 4, costoHora: 10000, total: 40000}];
const materialMovements = [
  {movimientoId: "exit-a", negocioId: "business-a", trabajoId: "work-a", tipo: "SALIDA_PROYECTO", moneda: "USD", costoTotal: 30000},
  {movimientoId: "return-a", negocioId: "business-a", trabajoId: "work-a", tipo: "DEVOLUCION_PROYECTO", movimientoOrigenId: "exit-a", moneda: "USD", costoTotal: 10000},
];

const complete = calculateWorkBalance({business, work, sales, quotes, expenses, labor, materialMovements});
assert.equal(complete.modeloBalanceVersion, WORK_BALANCE_MODEL_VERSION);
assert.equal(complete.estado, "COMPLETO");
assert.equal(complete.valorComercial, 200000);
assert.equal(complete.materialesVenta, 30000);
assert.equal(complete.materialesAdicionales, 20000);
assert.equal(complete.materiales, 50000);
assert.equal(complete.horasHombre, 40000);
assert.equal(complete.gastosDirectos, 20000);
assert.equal(complete.gastosIndirectos, 10000);
assert.equal(complete.costoTotal, 120000);
assert.equal(complete.resultado, 80000);
assert.equal(complete.rentabilidadPct, 40);
assert.equal(complete.gastosMaterialExcluido, 50000);
assert.equal(complete.fuentes.cotizacionesRechazadas, 1);
assert.equal(complete.fuentes.ventasConfirmadas, 1);
assert.equal(complete.fuentes.movimientosMaterialesVenta, 1);
assert.equal(complete.fuentes.materialesVentaSinCosto, 0);
assert.equal(complete.fuentes.gastosMaterialExcluidos, 1);
console.log("OK balance: Venta confirmada, costos vigentes, devolución, resultado y rentabilidad");

const partial = calculateWorkBalance({business, work, sales: [], quotes, expenses, labor, materialMovements});
assert.equal(partial.estado, "PARCIAL_SIN_VENTA");
assert.equal(partial.valorComercial, null); assert.equal(partial.resultado, null); assert.equal(partial.rentabilidadPct, null); assert.equal(partial.costoTotal, 90000);
console.log("OK parcial: sin Venta no inventa ingresos ni margen");

const canceled = calculateWorkBalance({business, work, sales: [{...sales[0], estado: "cancelada"}], quotes, expenses, labor, materialMovements});
assert.equal(canceled.estado, "PARCIAL_SIN_VENTA"); assert.equal(canceled.materialesVenta, 0); assert.equal(canceled.materialesAdicionales, 20000); assert.equal(canceled.costoTotal, 90000);
console.log("OK cancelación: revierte la Venta completa sin borrar consumos adicionales del Proyecto");

const legacySaleCost = calculateWorkBalance({business, work, sales: [{...sales[0], efectosInventario: [{lineaId: "product-line", movimientoId: "legacy-movement", itemId: "product-a", cantidad: 2}]}], quotes, expenses, labor, materialMovements});
assert.equal(legacySaleCost.materialesVenta, 0); assert.equal(legacySaleCost.fuentes.materialesVentaSinCosto, 1); assert.equal(legacySaleCost.reglaMateriales, "INVENTARIO_AUTORITATIVO");
console.log("OK legacy: costo histórico ausente se informa y no se reemplaza por costo vigente");

const inconsistent = calculateWorkBalance({business, work, sales: [...sales, {ventaId: "sale-clp", negocioId: "business-a", trabajoId: "work-a", estado: "confirmada", moneda: "CLP", total: 100000}], quotes, expenses, labor, materialMovements});
assert.equal(inconsistent.estado, "INCONSISTENTE_MONEDA");
assert.equal(inconsistent.consistenteMoneda, false); assert.deepEqual(inconsistent.monedasIncompatibles, ["CLP"]);
for (const field of ["valorComercial", "materiales", "horasHombre", "gastosDirectos", "gastosIndirectos", "costoTotal", "resultado", "rentabilidadPct"]) assert.equal(inconsistent[field], null);
assert.equal(inconsistent.desglosePorMoneda.length, 2);
console.log("OK moneda: no mezcla importes y conserva desglose por moneda");

const legacy = calculateWorkBalance({business, work: {trabajoId: "legacy", negocioId: "business-a"}, expenses: [{negocioId: "business-a", trabajoId: "legacy", categoria: "MATERIAL", monto: 50000}], sales: [], labor: [], materialMovements: []});
assert.equal(legacy.estado, "PARCIAL_SIN_VENTA"); assert.equal(legacy.reglaMateriales, "GASTO_MATERIAL_LEGACY"); assert.equal(legacy.gastosDirectos, 50000); assert.equal(legacy.materiales, 0);
const emptyLegacy = calculateWorkBalance({business, work: {trabajoId: "empty", negocioId: "business-a"}});
assert.equal(emptyLegacy.costoTotal, 0); assert.equal(emptyLegacy.valorComercial, null);
console.log("OK legacy: gasto MATERIAL sin libro se conserva y expediente vacío queda en cero/parcial");

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
assert.equal(ownerBalance.resultado, 80000); assert.equal(typeof ownerBalance.calculadoEn, "string");
const financeBalance = await obtenerBalanceTrabajoHandler({auth: {uid: "finance-a", role: "FINANZAS"}, data: {businessId: "business-a", trabajoId: "work-a"}}, dependencies);
assert.equal(financeBalance.resultado, 80000);
await assert.rejects(() => obtenerBalanceTrabajoHandler({auth: {uid: "member-a", role: "MEMBER"}, data: {businessId: "business-a", trabajoId: "work-a"}}, dependencies), (error) => error.code === "permission-denied");
await assert.rejects(() => obtenerBalanceTrabajoHandler({auth: {uid: "tech-a", role: "TECNICO"}, data: {businessId: "business-a", trabajoId: "work-a"}}, dependencies), (error) => error.code === "permission-denied");
console.log("OK seguridad: margen limitado a OWNER/ADMIN/FINANZAS y denegado a TECNICO");

console.log("WORK_BALANCE_SMOKE_OK");
