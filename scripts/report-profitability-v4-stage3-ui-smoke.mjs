import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../src/domain/rbac.mjs";
import {
  REPORT_PROFITABILITY_COVERAGE as COVERAGE,
  REPORT_SALE_PROJECT_SEGMENT as SEGMENT,
} from "../src/domain/reportProfitabilityV4.mjs";

const P = BUSINESS_PERMISSIONS;

// --- RBAC: la puerta de ETAPA 3 (sales.read + profitability.read) reutiliza contratos reales ---
assert.equal(hasBusinessPermission("OWNER", P.SALES_READ) && hasBusinessPermission("OWNER", P.PROFITABILITY_READ), true);
assert.equal(hasBusinessPermission("FINANZAS", P.SALES_READ) && hasBusinessPermission("FINANZAS", P.PROFITABILITY_READ), true);
assert.equal(hasBusinessPermission("VENTAS", P.PROFITABILITY_READ), false, "VENTAS no debe ver rentabilidad V4");
assert.equal(hasBusinessPermission("MEMBER", P.PROFITABILITY_READ), false, "MEMBER no debe ver rentabilidad V4");
assert.equal(hasBusinessPermission("TECNICO", P.PROFITABILITY_READ), false);
console.log("OK caso 1/2: la matriz RBAC real decide quién ve Reports V4 (sin permisos nuevos)");

function saleSegment(overrides = {}) {
  return {
    conteos: {
      ventasConfirmadas: 1, ventasConProductos: 1, ventasCompletas: 1, ventasParciales: 0,
      ventasNoDisponibles: 0, ventasMonedaInconsistente: 0, ventasSoloServicios: 0,
      ventasNetoConocido: 1, ventasNetoNoDisponible: 0, ventasConProyecto: 0, ventasSinProyecto: 1,
    },
    coberturaMargen: {estado: COVERAGE.COMPLETE, totalObjetivo: 1, completas: 1, parciales: 0, noDisponibles: 0, monedaInconsistente: 0, soloServicios: 0, lecturaTruncada: false, definitivo: true},
    coberturaVentasNetas: {estado: COVERAGE.COMPLETE, totalObjetivo: 1, completas: 1, noDisponibles: 0, lecturaTruncada: false, definitivo: true},
    metricas: {
      ventasNetasConfirmadasConocidas: 1000, ingresoNetoProductosCubiertos: 1000,
      costoHistoricoProductosCubiertos: 600, margenBrutoProductosCubiertos: 400,
      margenBrutoProductosPct: 40, ventasNetasEsTotal: true, margenCubiertoEsTotal: true,
    },
    agregacionValida: true,
    ...overrides,
  };
}

function commercialGroup(currency, overrides = {}) {
  const base = saleSegment();
  return {
    moneda: currency,
    agregable: true,
    ...base,
    segmentos: {
      [SEGMENT.WITH_PROJECT]: saleSegment({metricas: {...base.metricas, margenBrutoProductosCubiertos: 150}, conteos: {...base.conteos, ventasConfirmadas: 0}}),
      [SEGMENT.WITHOUT_PROJECT]: saleSegment({metricas: {...base.metricas, margenBrutoProductosCubiertos: 250}}),
    },
    ...overrides,
  };
}

function commercialBloque(grupos, coberturaEstado = COVERAGE.COMPLETE) {
  return {
    bloque: "COMMERCIAL_SALES",
    grupos,
    cobertura: {estado: coberturaEstado, totalObjetivo: grupos.length, completas: grupos.length, parciales: 0, noDisponibles: 0, monedaInconsistente: 0, soloServicios: 0, lecturaTruncada: false, definitivo: true},
    conteos: {},
  };
}

function projectsBloque(overrides = {}) {
  return {
    bloque: "PROJECT_PROFITABILITY",
    grupos: [],
    cobertura: {estado: COVERAGE.COMPLETE, totalObjetivo: 3, completas: 3, parciales: 0, noDisponibles: 0, definitivo: true},
    conteos: {proyectosRecibidos: 3, completos: 3, parciales: 0, noDisponibles: 0, conGanancia: 1, conPerdida: 1, neutros: 1},
    ...overrides,
  };
}

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {
    ProjectProfitabilityV4Summary,
    SalesCommercialMarginV4Card,
  } = await vite.ssrLoadModule("/src/features/reports/ReportProfitabilityV4Cards.jsx");

  const renderCommercial = (commercial, canView = true, onRetry) =>
    renderToStaticMarkup(React.createElement(SalesCommercialMarginV4Card, {canView, commercial, onRetry}));
  const renderProjects = (projects, canView = true) =>
    renderToStaticMarkup(React.createElement(ProjectProfitabilityV4Summary, {canView, projects}));

  // --- Caso: sin profitability.read (o sin sales.read) no renderiza nada, sin disparar carga ---
  const hiddenCommercial = renderCommercial({status: "loading", bloque: null, meta: null, error: ""}, false);
  const hiddenProjects = renderProjects({status: "loading", bloque: null, meta: null, error: ""}, false);
  assert.equal(hiddenCommercial, "");
  assert.equal(hiddenProjects, "");
  console.log("OK caso 2: canView=false no renderiza ningún bloque V4");

  // --- Caso: una sola moneda, cobertura completa ---
  const oneCurrency = renderCommercial({
    status: "ready",
    bloque: commercialBloque([commercialGroup("CLP")]),
    meta: {lecturaTruncada: false, cantidadCargada: 1},
    error: "",
  });
  assert.match(oneCurrency, /CLP/);
  assert.match(oneCurrency, /Margen bruto de productos cubierto/);
  assert.match(oneCurrency, /Cobertura Completa/);
  assert.doesNotMatch(oneCurrency, /utilidad neta|ganancia neta|ebitda|resultado contable/i);
  console.log("OK casos 1/5/7: una moneda, cobertura completa, wording de SPEC 018 (sin ganancia/utilidad/EBITDA)");

  // --- Caso: múltiples monedas separadas, sin total combinado ---
  const twoCurrencies = renderCommercial({
    status: "ready",
    bloque: commercialBloque([commercialGroup("CLP"), commercialGroup("USD")]),
    meta: {lecturaTruncada: false, cantidadCargada: 2},
    error: "",
  });
  assert.match(twoCurrencies, /CLP/);
  assert.match(twoCurrencies, /USD/);
  assert.equal((twoCurrencies.match(/class="reports-v4-currency-group"/g) || []).length, 2, "cada moneda debe tener su propia tarjeta");
  console.log("OK caso 6: monedas separadas, sin sumar CLP+USD en un único KPI");

  // --- Caso: cobertura parcial visible, con nota de subtotal no definitivo ---
  const partialGroup = commercialGroup("CLP", {
    conteos: {ventasConfirmadas: 10, ventasConProductos: 10, ventasCompletas: 6, ventasParciales: 2, ventasNoDisponibles: 2, ventasMonedaInconsistente: 0, ventasSoloServicios: 0, ventasNetoConocido: 10, ventasNetoNoDisponible: 0, ventasConProyecto: 3, ventasSinProyecto: 7},
    coberturaMargen: {estado: COVERAGE.PARTIAL, totalObjetivo: 10, completas: 6, parciales: 2, noDisponibles: 2, monedaInconsistente: 0, soloServicios: 0, lecturaTruncada: false, definitivo: false},
    metricas: {ventasNetasConfirmadasConocidas: 5000, ingresoNetoProductosCubiertos: 3000, costoHistoricoProductosCubiertos: 1800, margenBrutoProductosCubiertos: 1200, margenBrutoProductosPct: 40, ventasNetasEsTotal: true, margenCubiertoEsTotal: false},
  });
  const partial = renderCommercial({status: "ready", bloque: commercialBloque([partialGroup], COVERAGE.PARTIAL), meta: {lecturaTruncada: false, cantidadCargada: 10}, error: ""});
  assert.match(partial, /Cobertura Parcial/);
  assert.match(partial, /6 de 10 ventas de productos/);
  assert.match(partial, /2 parcial/);
  assert.match(partial, /2 sin información/);
  assert.match(partial, /no es un total definitivo/);
  console.log("OK caso 8: cobertura parcial visible, con N de M y advertencia de subtotal no definitivo");

  // --- Caso: lectura truncada muestra advertencia explícita ---
  const truncated = renderCommercial({
    status: "ready",
    bloque: commercialBloque([commercialGroup("CLP")]),
    meta: {lecturaTruncada: true, cantidadCargada: 5000},
    error: "",
  });
  assert.match(truncated, /límite de seguridad/);
  assert.match(truncated, /no representa necesariamente el total del período/);
  console.log("OK caso 9: lecturaTruncada muestra advertencia explícita y no la presenta como total");

  // --- Caso: dataset vacío ---
  const empty = renderCommercial({status: "ready", bloque: commercialBloque([], COVERAGE.EMPTY), meta: {lecturaTruncada: false, cantidadCargada: 0}, error: ""});
  assert.match(empty, /No hay ventas confirmadas en el rango seleccionado/);
  assert.doesNotMatch(empty, /reports-v4-currency-group/);
  console.log("OK caso 10: dataset vacío usa un estado explícito, no una tarjeta con ceros");

  // --- Caso: rango inválido / error del service se muestra tal cual, con opción de reintentar ---
  let retried = false;
  const rangeError = renderCommercial(
    {status: "error", bloque: null, meta: null, error: "El rango no puede superar 366 días inclusivos."},
    true,
    () => { retried = true; }
  );
  assert.match(rangeError, /El rango no puede superar 366 días/);
  assert.match(rangeError, /Reintentar/);
  console.log("OK casos 3/4: un rango inválido (validado por el dominio, no la UI) se muestra como error con reintento");
  assert.equal(retried, false, "SSR no ejecuta handlers; sólo se valida que el botón exista");

  // --- Caso: loading no muestra NaN/Infinity/undefined ---
  const loading = renderCommercial({status: "loading", bloque: null, meta: null, error: ""});
  assert.match(loading, /Calculando margen comercial/);
  assert.doesNotMatch(loading, /NaN|Infinity|undefined/);
  console.log("OK estado loading: sin NaN/Infinity/undefined mientras carga");

  // --- Caso: denominador cero / servicios-only no inventan 100% ni $0 ficticio ---
  const zeroGroup = commercialGroup("CLP", {
    conteos: {ventasConfirmadas: 1, ventasConProductos: 1, ventasCompletas: 1, ventasParciales: 0, ventasNoDisponibles: 0, ventasMonedaInconsistente: 0, ventasSoloServicios: 0, ventasNetoConocido: 1, ventasNetoNoDisponible: 0, ventasConProyecto: 0, ventasSinProyecto: 1},
    metricas: {ventasNetasConfirmadasConocidas: 0, ingresoNetoProductosCubiertos: 0, costoHistoricoProductosCubiertos: 20, margenBrutoProductosCubiertos: -20, margenBrutoProductosPct: null, ventasNetasEsTotal: true, margenCubiertoEsTotal: true},
  });
  const zeroDenominator = renderCommercial({status: "ready", bloque: commercialBloque([zeroGroup]), meta: {lecturaTruncada: false, cantidadCargada: 1}, error: ""});
  assert.match(zeroDenominator, /Margen bruto % ponderado<\/dt><dd>—<\/dd>/, "porcentaje nulo debe mostrarse como —, nunca 0% ni NaN%");
  assert.doesNotMatch(zeroDenominator, /0\s*%|NaN|Infinity|undefined/);
  console.log("OK caso 16: denominador cero muestra margen negativo y porcentaje —, nunca NaN/Infinity/0% ficticio");

  const servicesOnlyGroup = commercialGroup("CLP", {
    coberturaMargen: {estado: COVERAGE.NOT_APPLICABLE, totalObjetivo: 0, completas: 0, parciales: 0, noDisponibles: 0, monedaInconsistente: 0, soloServicios: 1, lecturaTruncada: false, definitivo: true},
    conteos: {ventasConfirmadas: 1, ventasConProductos: 0, ventasCompletas: 0, ventasParciales: 0, ventasNoDisponibles: 0, ventasMonedaInconsistente: 0, ventasSoloServicios: 1, ventasNetoConocido: 1, ventasNetoNoDisponible: 0, ventasConProyecto: 0, ventasSinProyecto: 1},
    metricas: {ventasNetasConfirmadasConocidas: 500, ingresoNetoProductosCubiertos: null, costoHistoricoProductosCubiertos: null, margenBrutoProductosCubiertos: null, margenBrutoProductosPct: null, ventasNetasEsTotal: true, margenCubiertoEsTotal: false},
  });
  const servicesOnly = renderCommercial({status: "ready", bloque: commercialBloque([servicesOnlyGroup], COVERAGE.NOT_APPLICABLE), meta: {lecturaTruncada: false, cantidadCargada: 1}, error: ""});
  assert.match(servicesOnly, /Cobertura No aplica/);
  assert.doesNotMatch(servicesOnly, /100\s*%/, "servicios-only nunca debe mostrar 100% ficticio de margen");
  assert.doesNotMatch(servicesOnly, /NaN|Infinity|undefined/);
  console.log('OK: venta sólo-servicios no inventa costo $0 ni margen 100%');

  // --- Proyectos: OK, parcial, algunos fallidos, error total y coexistencia con comercial ready ---
  const projectsReady = renderProjects({status: "ready", bloque: projectsBloque(), meta: {fallidos: []}, error: ""});
  assert.match(projectsReady, /3 proyecto\(s\) analizados/);
  assert.match(projectsReady, /1 con ganancia/);
  assert.match(projectsReady, /1 con pérdida/);
  assert.match(projectsReady, /1 en equilibrio/);
  assert.doesNotMatch(projectsReady, /Rentabilidad total|Resultado total|Utilidad global/i);
  console.log("OK caso 11/15: Proyectos OK muestra ganancia/pérdida/equilibrio sin \"rentabilidad total\"");

  const projectsPartial = renderProjects({
    status: "ready",
    bloque: projectsBloque({conteos: {proyectosRecibidos: 5, completos: 2, parciales: 2, noDisponibles: 1, conGanancia: 1, conPerdida: 0, neutros: 1}}),
    meta: {fallidos: []},
    error: "",
  });
  assert.match(projectsPartial, /2 con información parcial/);
  assert.match(projectsPartial, /1 sin información disponible/);
  console.log("OK caso 12: Proyectos con cobertura parcial visible (no oculta parciales/no disponibles)");

  const projectsSomeFailed = renderProjects({
    status: "ready",
    bloque: projectsBloque(),
    meta: {fallidos: [{trabajoId: "work-1", mensaje: "timeout"}, {trabajoId: "work-2", mensaje: "timeout"}]},
    error: "",
  });
  assert.match(projectsSomeFailed, /2 balance\(s\) de Proyecto no pudieron cargarse/);
  assert.doesNotMatch(projectsSomeFailed, /\$0|balance cero/i);
  console.log("OK: algunos balances de Proyecto fallidos se comunican sin inventar balance cero");

  const projectsError = renderProjects({status: "error", bloque: null, meta: null, error: "obtenerBalanceTrabajo caído"});
  assert.match(projectsError, /No fue posible cargar los balances de Proyecto/);
  assert.match(projectsError, /obtenerBalanceTrabajo caído/);
  assert.match(projectsError, /resumen comercial de Ventas no se ve afectado/);
  console.log("OK caso 13: fallo total de Proyectos se comunica sin ocultar que Ventas sigue disponible");

  const noProjects = renderProjects({status: "ready", bloque: projectsBloque({conteos: {proyectosRecibidos: 0, completos: 0, parciales: 0, noDisponibles: 0, conGanancia: 0, conPerdida: 0, neutros: 0}}), meta: {fallidos: []}, error: ""});
  assert.match(noProjects, /0 proyecto\(s\) analizados/);
  assert.doesNotMatch(noProjects, /NaN|Infinity|undefined/);
  console.log("OK: ningún Proyecto no produce NaN/Infinity, sólo conteos en cero explícitos");

  // Caso 14: comercial sobrevive a un error total de Proyectos (ambos se renderizan de forma independiente).
  const commercialReadyMarkup = renderCommercial({status: "ready", bloque: commercialBloque([commercialGroup("CLP")]), meta: {lecturaTruncada: false, cantidadCargada: 1}, error: ""});
  assert.match(commercialReadyMarkup, /Margen bruto de productos cubierto/);
  assert.match(projectsError, /No fue posible cargar los balances de Proyecto/);
  console.log("OK caso 14: COMMERCIAL_SALES se renderiza listo aunque PROJECT_PROFITABILITY esté en error");

  // Caso 15: nunca existe una fórmula ni texto de rentabilidad combinada Venta + Proyecto.
  const cardsSource = await readFile(
    new URL("../src/features/reports/ReportProfitabilityV4Cards.jsx", import.meta.url),
    "utf8"
  );
  const hookSource = await readFile(
    new URL("../src/features/reports/ReportProfitabilityV4Section.jsx", import.meta.url),
    "utf8"
  );
  for (const source of [cardsSource, hookSource]) {
    assert.doesNotMatch(source, /rentabilidad total|resultado total|utilidad total|utilidad neta|utilidad empresarial|ebitda|resultado contable|ganancia neta/i);
    assert.doesNotMatch(source, /margenBrutoProductosCubiertos\s*\+|resultado\s*\+.*margenBruto|margenBruto.*\+\s*resultado/i);
  }
  console.log("OK caso 15: el código fuente no contiene wording ni fórmula de rentabilidad combinada");

  // Caso 17: resultados obsoletos se descartan. useReportProfitabilityV4 reinicia cada
  // efecto con `let active = true; ...; return () => { active = false; }` (misma
  // convención usada en StatisticsPage y ~20 páginas más de la app). Esta simulación
  // reproduce esa MISMA lógica línea por línea para probarla de forma determinista sin
  // necesitar React Testing Library/jsdom (no son dependencias del proyecto).
  async function simulateStaleGuardedEffect(loaders) {
    let applied = null;
    let cleanup = () => {};
    function runEffect(loadPromise) {
      cleanup();
      let active = true;
      loadPromise.then((value) => { if (active) applied = value; });
      cleanup = () => { active = false; };
    }
    for (const loader of loaders) {
      runEffect(loader());
      await Promise.resolve(); // deja que el efecto anterior se "monte" antes del siguiente cambio
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    return applied;
  }

  const delayed = (value, ms) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
  const staleResult = await simulateStaleGuardedEffect([
    () => delayed("respuesta-rango-antiguo", 20), // rango/negocio inicial, lento
    () => delayed("respuesta-rango-nuevo", 5), // el usuario cambia el rango antes de que termine el anterior
  ]);
  assert.equal(staleResult, "respuesta-rango-nuevo", "una respuesta lenta de una carga anterior no debe sobrescribir la más reciente");
  console.log("OK caso 17: una respuesta lenta de un rango/negocio anterior no pisa el resultado del más reciente");

  console.log("REPORT_PROFITABILITY_V4_STAGE3_UI_SMOKE_OK");
} finally {
  await vite.close();
}
