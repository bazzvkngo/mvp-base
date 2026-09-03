import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  REPORT_PROJECT_BALANCE_CONCURRENCY_V4,
  REPORT_SALES_QUERY_LIMITS,
  ReportRangeError,
  clampSalesPageSize,
  combineSalesAndProjectSources,
  loadSalesPagesBounded,
  runProjectBalancesBounded,
  validateSalesDateRangeV4,
} from "../src/domain/reportProfitabilityV4Query.mjs";

function saleStub(id, fechaVenta) {
  return {id, estado: "confirmada", moneda: "CLP", neto: 100, fechaVenta, items: [], efectosInventario: []};
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fabrica un fetchPage en memoria que reparte `total` ventas sintéticas en páginas,
// simulando el mismo contrato que fetchSalesPageFromFirestore sin tocar Firebase.
function makeInMemoryFetchPage(total, {pageSize: sourcePageSize} = {}) {
  const dataset = Array.from({length: total}, (_, index) =>
    saleStub(`sale-${String(total - index).padStart(6, "0")}`, "2026-06-01"));
  return async ({cursor, pageSize}) => {
    const size = sourcePageSize ?? pageSize;
    const startIndex = cursor ? dataset.findIndex((entry) => entry.id === cursor.id) + 1 : 0;
    const slice = dataset.slice(startIndex, startIndex + size);
    const hasMore = startIndex + size < dataset.length;
    const last = slice[slice.length - 1];
    return {
      items: slice,
      hasMore,
      nextCursor: hasMore && last ? {fechaVenta: last.fechaVenta, id: last.id} : null,
    };
  };
}

// --- Casos 1-3: validación de rango (SPEC 018 §11.1) ---
const validRange = validateSalesDateRangeV4({from: "2026-01-01", to: "2026-01-31"});
assert.deepEqual(validRange, {from: "2026-01-01", to: "2026-01-31", dias: 31});
console.log("OK caso 1: rango temporal válido");

assert.throws(
  () => validateSalesDateRangeV4({from: "2025-01-01", to: "2026-01-02"}),
  ReportRangeError
);
const exactMax = validateSalesDateRangeV4({from: "2025-01-01", to: "2026-01-01"});
assert.equal(exactMax.dias, 366);
console.log("OK caso 2: rango > 366 días rechazado, 366 exactos aceptado");

assert.throws(() => validateSalesDateRangeV4({from: "2026-02-01", to: "2026-01-01"}), ReportRangeError);
assert.throws(() => validateSalesDateRangeV4({from: "", to: "2026-01-01"}), ReportRangeError);
assert.throws(() => validateSalesDateRangeV4({from: "2026-01-01", to: ""}), ReportRangeError);
console.log("OK caso 3: from > to y fechas faltantes rechazadas");

// --- Caso 4: dataset vacío ---
const emptyResult = await loadSalesPagesBounded({
  fetchPage: async () => ({items: [], hasMore: false, nextCursor: null}),
  from: "2026-01-01",
  to: "2026-01-31",
});
assert.deepEqual(emptyResult.items, []);
assert.equal(emptyResult.lecturaTruncada, false);
assert.equal(emptyResult.cantidadCargada, 0);
console.log("OK caso 4: dataset vacío no se declara truncado");

// --- Casos 5-6: primera y segunda página, con cursor estable ---
const twoPageFetch = makeInMemoryFetchPage(7, {pageSize: 3});
const pagedResult = await loadSalesPagesBounded({fetchPage: twoPageFetch, from: "a", to: "b", pageSize: 3, maxDocuments: 5000});
assert.equal(pagedResult.items.length, 7);
assert.equal(pagedResult.items[0].id, "sale-000007");
assert.equal(pagedResult.items[2].id, "sale-000005");
assert.equal(pagedResult.items[3].id, "sale-000004");
assert.equal(pagedResult.lecturaTruncada, false);
console.log("OK casos 5-6: primera y segunda página concatenadas en orden estable");

// --- Caso 7 (parcial, sin Firestore): múltiples ventas con la misma fechaVenta se distinguen por id ---
const sameDateFetch = async ({cursor, pageSize}) => {
  const dataset = ["c", "b", "a"].map((suffix) => saleStub(`sale-${suffix}`, "2026-06-01"));
  const startIndex = cursor ? dataset.findIndex((entry) => entry.id === cursor.id) + 1 : 0;
  const slice = dataset.slice(startIndex, startIndex + pageSize);
  const hasMore = startIndex + pageSize < dataset.length;
  const last = slice[slice.length - 1];
  return {items: slice, hasMore, nextCursor: hasMore && last ? {fechaVenta: last.fechaVenta, id: last.id} : null};
};
const sameDateResult = await loadSalesPagesBounded({fetchPage: sameDateFetch, from: "2026-06-01", to: "2026-06-01", pageSize: 1});
assert.deepEqual(sameDateResult.items.map((entry) => entry.id), ["sale-c", "sale-b", "sale-a"]);
console.log("OK caso 7 (orquestación): misma fechaVenta se distingue por documentId sin perder ni duplicar filas");

// --- Caso 8: determinismo del cursor ante la misma entrada ---
const runA = await loadSalesPagesBounded({fetchPage: makeInMemoryFetchPage(5, {pageSize: 2}), from: "a", to: "b", pageSize: 2});
const runB = await loadSalesPagesBounded({fetchPage: makeInMemoryFetchPage(5, {pageSize: 2}), from: "a", to: "b", pageSize: 2});
assert.deepEqual(runA.items.map((entry) => entry.id), runB.items.map((entry) => entry.id));
assert.deepEqual(runA.nextCursor, runB.nextCursor);
console.log("OK caso 8: cursor y secuencia son deterministas ante la misma entrada");

// --- Caso 9: pageSize se acota a 250 sin importar lo solicitado ---
assert.equal(clampSalesPageSize(9999), 250);
assert.equal(clampSalesPageSize(0), 250);
assert.equal(clampSalesPageSize(-5), 250);
assert.equal(clampSalesPageSize(10), 10);
let observedPageSize = null;
await loadSalesPagesBounded({
  fetchPage: async ({pageSize}) => { observedPageSize = pageSize; return {items: [], hasMore: false, nextCursor: null}; },
  from: "a", to: "b", pageSize: 9999,
});
assert.equal(observedPageSize, 250);
console.log("OK caso 9: pageSize nunca excede 250, incluso si se solicita más");

// --- Casos 10-11: límite total de 5.000 documentos y detección explícita de truncamiento ---
const largeFetch = makeInMemoryFetchPage(12000, {pageSize: 250});
const cappedResult = await loadSalesPagesBounded({fetchPage: largeFetch, from: "a", to: "b", pageSize: 250, maxDocuments: 5000});
assert.equal(cappedResult.items.length, 5000);
assert.equal(cappedResult.cantidadCargada, 5000);
assert.equal(cappedResult.lecturaTruncada, true);
assert.ok(cappedResult.nextCursor, "debe conservar un cursor para continuar tras el truncamiento");
console.log("OK caso 10: la carga nunca excede 5.000 documentos aunque existan más");

const exactCapFetch = makeInMemoryFetchPage(5000, {pageSize: 250});
const exactCapResult = await loadSalesPagesBounded({fetchPage: exactCapFetch, from: "a", to: "b", pageSize: 250, maxDocuments: 5000});
assert.equal(exactCapResult.items.length, 5000);
assert.equal(exactCapResult.lecturaTruncada, false, "exactamente 5.000 documentos no debe marcarse como truncado");
assert.equal(exactCapResult.nextCursor, null);
console.log("OK caso 11: truncamiento sólo se declara cuando existe al menos un documento adicional real");

// --- Caso 14: concurrencia máxima respetada ---
let active = 0;
let maxActive = 0;
const concurrencyWorks = Array.from({length: 10}, (_, index) => ({id: `work-${index}`}));
await runProjectBalancesBounded(concurrencyWorks, async () => {
  active += 1;
  maxActive = Math.max(maxActive, active);
  await delay(15);
  active -= 1;
  return {estado: "COMPLETO", moneda: "CLP", valorComercial: 1, materiales: 0, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: 0, resultado: 1, fuentes: {materialesVentaSinCosto: 0}};
}, {concurrency: 4});
assert.equal(maxActive, 4, `la concurrencia debe llegar exactamente al límite (4), fue ${maxActive}`);
console.log("OK caso 14: nunca hay más de REPORT_PROJECT_BALANCE_CONCURRENCY_V4 Callables en vuelo");
assert.equal(REPORT_PROJECT_BALANCE_CONCURRENCY_V4, 4);

// --- Caso 15: el orden del resultado sigue el orden de entrada, no el de resolución ---
const orderedWorks = [{id: "work-slow"}, {id: "work-fast"}, {id: "work-medium"}];
const delays = {"work-slow": 30, "work-fast": 5, "work-medium": 15};
const orderedResult = await runProjectBalancesBounded(orderedWorks, async (work) => {
  await delay(delays[work.id]);
  return {estado: "COMPLETO", moneda: "CLP", valorComercial: 1, materiales: 0, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: 0, resultado: 1, fuentes: {materialesVentaSinCosto: 0}};
}, {concurrency: 4});
assert.deepEqual(orderedResult.proyectos.map((entry) => entry.id), ["work-slow", "work-fast", "work-medium"]);
console.log("OK caso 15: el orden lógico de Proyectos se preserva pese a resolver en desorden");

// --- Caso 16: un fallo individual no dispara todos los Callables ni pierde a los demás ---
let inFlightDuringFailure = 0;
let maxInFlightDuringFailure = 0;
const mixedWorks = Array.from({length: 8}, (_, index) => ({id: `work-${index}`}));
const failing = new Set(["work-2", "work-5"]);
const mixedResult = await runProjectBalancesBounded(mixedWorks, async (work) => {
  inFlightDuringFailure += 1;
  maxInFlightDuringFailure = Math.max(maxInFlightDuringFailure, inFlightDuringFailure);
  await delay(10);
  inFlightDuringFailure -= 1;
  if (failing.has(work.id)) throw new Error(`fallo simulado ${work.id}`);
  return {estado: "COMPLETO", moneda: "CLP", valorComercial: 1, materiales: 0, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: 0, resultado: 1, fuentes: {materialesVentaSinCosto: 0}};
}, {concurrency: 3});
assert.equal(mixedResult.fallidos.length, 2);
assert.deepEqual(mixedResult.fallidos.map((entry) => entry.trabajoId).sort(), ["work-2", "work-5"]);
assert.equal(mixedResult.proyectos.filter((entry) => entry.balance === null).length, 2);
assert.equal(mixedResult.proyectos.filter((entry) => entry.balance !== null).length, 6);
assert.ok(maxInFlightDuringFailure <= 3, "un fallo no debe destrabar más Callables que el límite de concurrencia");
console.log("OK caso 16: un fallo individual queda aislado sin perder al resto ni romper el límite");

// --- Caso 17: el resumen comercial sobrevive a un fallo total de Proyectos ---
const survivingSales = {items: [saleStub("sale-ok", "2026-01-01")], nextCursor: null, hasMore: false, cantidadCargada: 1, lecturaTruncada: false, rango: {from: "2026-01-01", to: "2026-01-01"}};
const combined = await combineSalesAndProjectSources({
  loadSales: async () => survivingSales,
  loadProjects: async () => { throw new Error("obtenerBalanceTrabajo caído"); },
});
assert.deepEqual(combined.sales, survivingSales);
assert.equal(combined.projects.cargaFallida, true);
assert.equal(combined.projects.error, "obtenerBalanceTrabajo caído");
assert.deepEqual(combined.projects.proyectos, []);
console.log("OK caso 17: COMMERCIAL_SALES sobrevive aunque PROJECT_PROFITABILITY falle por completo");

// Un rango inválido en Ventas sí debe propagarse: no es el fallo aislado que tolera Proyectos.
await assert.rejects(
  () => combineSalesAndProjectSources({
    loadSales: async () => { throw new ReportRangeError("rango inválido"); },
    loadProjects: async () => ({proyectos: [], fallidos: []}),
  }),
  ReportRangeError
);
console.log("OK caso 17b: un fallo de Ventas (p. ej. rango inválido) se propaga, no se oculta");

// --- Caso 18: el service no reconstruye el balance manualmente ---
const serviceSource = await readFile(
  new URL("../src/services/reportProfitabilityV4Service.js", import.meta.url),
  "utf8"
);
assert.match(serviceSource, /obtenerBalanceTrabajo/);
assert.doesNotMatch(serviceSource, /workExpensesCollectionPath|workLaborCollectionPath|inventoryMovementsCollectionPath/);
assert.doesNotMatch(serviceSource, /costoBase|costoPromedio|ultimoCosto|adquisiciones/i);
assert.doesNotMatch(serviceSource, /getInventoryItems|inventarioCollectionPath/);
const querySource = await readFile(
  new URL("../src/domain/reportProfitabilityV4Query.mjs", import.meta.url),
  "utf8"
);
assert.doesNotMatch(querySource, /firebase|firestore|httpsCallable|fetch\s*\(|currentUser|onAuthStateChanged/i);
console.log("OK caso 18: el balance de Proyecto siempre viene de obtenerBalanceTrabajo, nunca recalculado en frontend");

console.log("REPORT_PROFITABILITY_V4_STAGE2_SMOKE_OK");
