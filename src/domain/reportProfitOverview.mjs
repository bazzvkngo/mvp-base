import {
  classifyOperationalProject,
  OPERATIONAL_NET_PROFIT_COVERAGE,
  OPERATIONAL_PROJECT_EXCLUSION,
} from "./operationalNetProfit.mjs";
import {formatMonthLabel, formatMonthName} from "./reportMonthlySummary.mjs";
import {formatMoney} from "../utils/formatters.js";

// SPEC 025 (Ganancia visual): helpers puros que preparan lo que la pestaña Ganancia
// muestra arriba de las tablas: la barra costo | ganancia de productos, el bloque
// "Por qué es parcial / Qué conviene revisar" y la tarjeta de proyectos. Solo
// presentan lo que ya calcula calculateOperationalNetProfit (un grupo por moneda):
// no definen ninguna fórmula económica. Lo único que se calcula aquí son
// proporciones entre cifras ya calculadas (costo / ventas de productos y
// ganancia / ventas de productos) para dibujar la barra y rotularla.

const COVERAGE = OPERATIONAL_NET_PROFIT_COVERAGE;
const EXCLUSION = OPERATIONAL_PROJECT_EXCLUSION;
const EPSILON = 1e-9;

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function percentText(value, locale, decimals = 1) {
  return `${new Intl.NumberFormat(locale, {minimumFractionDigits: 0, maximumFractionDigits: decimals}).format(value)} %`;
}

function moneyOf(value, currency, locale) {
  return formatMoney(value, currency, locale);
}

// --- Período -----------------------------------------------------------------

// Cómo nombrar el período en los textos. Un mes calendario es un rango que empieza
// el día 1 y termina en el mismo mes (el mes completo o lo corrido de él):
//  - el mes ACTUAL dice "este mes";
//  - cualquier otro mes calendario se nombra: "en octubre de 2026";
//  - cualquier otro rango dice "en el período".
// El helper no lee el reloj: la vista le pasa el mes actual (`currentMonthKey`,
// "AAAA-MM"). Sin él no puede saber cuál es el actual y nombra el mes.
export function describePeriod(range, {locale = "es-CL", currentMonthKey = null} = {}) {
  const start = String(range?.start || "");
  const end = String(range?.end || "");
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);
  const isCalendarMonth = valid && start.slice(8) === "01" && start.slice(0, 7) === end.slice(0, 7) && end >= start;
  const monthKey = isCalendarMonth ? start.slice(0, 7) : null;
  const isCurrentMonth = Boolean(monthKey) && monthKey === currentMonthKey;
  const monthLabel = monthKey ? formatMonthLabel(monthKey, locale).toLocaleLowerCase(locale) : null;
  return {
    isCalendarMonth,
    isCurrentMonth,
    monthKey,
    monthName: monthKey ? formatMonthName(monthKey, locale) : null,
    monthLabel,
    phrase: isCurrentMonth ? "este mes" : monthLabel ? `en ${monthLabel}` : "en el período",
  };
}

// --- Barra de productos ------------------------------------------------------

// Redondea las dos proporciones para que, ya redondeadas, sigan sumando 100:
// primero a enteros y, si no suman, a un decimal. Si las cifras de origen no
// cuadran entre sí (costo + ganancia distinto de lo vendido), no se fuerza nada:
// cada una va redondeada a un decimal.
function reconcilePercents(costRaw, profitRaw) {
  for (const decimals of [0, 1]) {
    const cost = roundTo(costRaw, decimals);
    const profit = roundTo(profitRaw, decimals);
    if (Math.abs(cost + profit - 100) < EPSILON) return {cost, profit, decimals};
  }
  return {cost: roundTo(costRaw, 1), profit: roundTo(profitRaw, 1), decimals: 1};
}

const HIDDEN_BAR = Object.freeze({show: false, kind: "hidden", segments: [], legend: [], title: "", ariaLabel: ""});

// `group`: un grupo de calculateOperationalNetProfit. Usa las ventas de productos
// sin proyecto, su costo histórico y su ganancia (margen bruto), tal como vienen.
//   kind: "profit" | "profit-only" (sin costo) | "break-even" (solo costo, ganancia 0)
//         | "loss" (el costo supera lo vendido) | "hidden" (sin ventas de productos o
//         sin ningún tramo que dibujar).
// `segments[].flex` es el propio importe (sirve de ancho relativo) y `width` la
// fracción de la barra (0 a 1). En pérdida la barra es toda costo y la pérdida va
// en la leyenda.
export function describeProductsBar(group, {locale = "es-CL"} = {}) {
  const sales = group?.componentes?.ventasSinProyecto;
  const revenue = finiteOrNull(sales?.ingresoNetoProductos);
  const cost = finiteOrNull(sales?.costoHistoricoProductos);
  const profit = finiteOrNull(sales?.margenBrutoProductos);
  if (revenue === null || cost === null || profit === null || revenue <= 0 || cost < 0) return {...HIDDEN_BAR};

  const currency = group?.moneda || undefined;
  const money = (value) => moneyOf(value, currency, locale);
  const title = `De los ${money(revenue)} que vendiste en productos`;
  const costRaw = (cost / revenue) * 100;
  const profitRaw = (profit / revenue) * 100;
  const legendItem = (id, label, amount, percent, decimals) => ({
    id, label, amount, percent, text: `${label} · ${percentText(percent, locale, decimals)}`,
  });

  if (profit < 0) {
    const lost = roundTo(-profit, 2);
    const lostPercent = roundTo((lost / revenue) * 100, 1);
    const costPercent = roundTo(costRaw, 1);
    return {
      show: true, kind: "loss", revenue, cost, profit, title, scopeLabel: "de productos",
      costPercent, profitPercent: roundTo(profitRaw, 1),
      segments: [{id: "cost", amount: cost, flex: cost, width: 1, percent: costPercent}],
      legend: [
        legendItem("cost", "Costo de lo vendido", cost, costPercent, 1),
        legendItem("loss", "Pérdida de productos", lost, lostPercent, 1),
      ],
      ariaLabel: `${title}: costo de lo vendido ${money(cost)} (${percentText(costPercent, locale)}) y una pérdida de ${money(lost)} (${percentText(lostPercent, locale)}).`,
    };
  }

  // Ventas con costo 0 y ganancia 0 (cifras que no cuadran): no habría ningún tramo.
  if (cost === 0 && profit === 0) return {...HIDDEN_BAR};

  const kind = cost === 0 ? "profit-only" : profit === 0 ? "break-even" : "profit";
  const {cost: costPercent, profit: profitPercent, decimals} = kind === "profit-only"
    ? {cost: 0, profit: 100, decimals: 0}
    : kind === "break-even"
      ? {cost: 100, profit: 0, decimals: 0}
      : reconcilePercents(costRaw, profitRaw);
  const segments = [];
  const total = (kind === "profit-only" ? 0 : cost) + (kind === "break-even" ? 0 : profit);
  if (cost > 0) segments.push({id: "cost", amount: cost, flex: cost, width: roundTo(cost / total, 4), percent: costPercent});
  if (profit > 0) segments.push({id: "profit", amount: profit, flex: profit, width: roundTo(profit / total, 4), percent: profitPercent});
  return {
    show: true, kind, revenue, cost, profit, title, scopeLabel: "de productos", costPercent, profitPercent, segments,
    legend: [
      legendItem("cost", "Costo de lo vendido", cost, costPercent, decimals),
      legendItem("profit", "Ganancia de productos", profit, profitPercent, decimals),
    ],
    ariaLabel: `${title}: costo de lo vendido ${money(cost)} (${percentText(costPercent, locale, decimals)}) y ganancia ${money(profit)} (${percentText(profitPercent, locale, decimals)}).`,
  };
}

// --- Por qué es parcial / Qué conviene revisar ------------------------------

// Frase de cada motivo de exclusión de un proyecto ("N proyecto(s) con ___ quedó
// excluido"). Sin cifras: los importes de un proyecto excluido no son confiables.
const EXCLUSION_PHRASES = Object.freeze({
  [EXCLUSION.MISSING_SALE_MATERIAL_COST]: "materiales vendidos sin costo histórico",
  [EXCLUSION.CURRENCY_MISMATCH]: "registros en más de una moneda",
  [EXCLUSION.UNDATED_RECORDS]: "registros sin fecha válida",
  [EXCLUSION.INVALID_SALE_NET]: "ventas sin neto válido",
});
const EXCLUSION_FALLBACK_PHRASE = "datos del balance que no se pueden usar";
const EXCLUSION_ORDER = [
  EXCLUSION.MISSING_SALE_MATERIAL_COST,
  EXCLUSION.CURRENCY_MISMATCH,
  EXCLUSION.UNDATED_RECORDS,
  EXCLUSION.INVALID_SALE_NET,
];
// Alertas cuyos registros son proyectos excluidos que se pueden nombrar. A1, A2 y
// A8 no tienen frase propia (van a la línea genérica); A3 mezcla ventas y proyectos
// y A9 mezcla un balance inutilizable con el error general de carga.
const PROJECT_ALERTS = new Set(["A3", "A5", "A6", "A7", "A9"]);
const SINGLE_PROJECT_ALERTS = new Set(["A5", "A6", "A7", "A9"]);

function indexProjects(projects) {
  const index = new Map();
  (Array.isArray(projects) ? projects : []).forEach((entry) => {
    const id = String(entry?.trabajoId || entry?.id || entry?.balance?.trabajoId || "").trim();
    if (id && !index.has(id)) index.set(id, entry);
  });
  return index;
}

function projectInfo(id, entry) {
  return {
    id,
    numero: String(entry?.numero || ""),
    titulo: String(entry?.titulo || "").trim() || "Proyecto sin título",
  };
}

function compareProjects(left, right) {
  return left.titulo.localeCompare(right.titulo, "es") || left.numero.localeCompare(right.numero, "es");
}

// Reparte lo que alertan las A3/A5/A6/A7/A9 y las demás del grupo: proyectos
// excluidos con nombre (agrupados por motivo) y lo que no tiene nombre ni frase
// propia, que se cuenta como "genérico". A4 no cuenta: sus costos sí se incluyen
// y no vuelve parcial la ganancia (va solo en la tabla de estado).
function analyzeAlerts(group, projectIndex) {
  const byReason = new Map();
  let generic = 0;
  let unnamedProjects = 0;
  const seen = new Set();

  (group?.alertas || []).forEach((alert) => {
    if (alert.id === "A4") return;
    const conteo = Math.max(0, Math.trunc(finiteOrNull(alert.conteo) ?? 0));
    let matchedCount = 0;
    if (PROJECT_ALERTS.has(alert.id)) {
      (alert.registros || []).forEach((id) => {
        const entry = projectIndex.get(String(id));
        if (!entry) return;
        const key = `${alert.id}:${id}`;
        if (seen.has(key)) return;
        seen.add(key);
        const motive = classifyOperationalProject(entry).motivo || null;
        if (!byReason.has(motive)) byReason.set(motive, new Map());
        byReason.get(motive).set(String(id), projectInfo(String(id), entry));
        // El conteo de A3 de un proyecto son sus ventas sin neto; el resto cuenta 1.
        matchedCount += alert.id === "A3" ? Math.max(1, Math.trunc(finiteOrNull(entry?.balance?.fuentes?.ventasSinNetoValido) ?? 1)) : 1;
      });
    }
    const remaining = Math.max(0, conteo - matchedCount);
    generic += remaining;
    if (SINGLE_PROJECT_ALERTS.has(alert.id) && alert.id !== "A9") unnamedProjects += remaining;
  });

  return {byReason, generic, unnamedProjects};
}

// Líneas del bloque, en este orden: servicios sin proyecto, registros sin moneda,
// un proyecto o varios por motivo y, al final, una sola línea genérica.
//   line: {key, kind: services|no-currency|project|generic, text, amount, count,
//          projects, action}
//   action: {id: "sales"|"works"|"calculation", label, workId?} (null sin permiso)
// Sin líneas no hay bloque (`show: false`): ni causas ni servicios pendientes.
// El título cambia con la cobertura: parcial -> "Por qué es parcial"; completa con
// avisos -> "Qué conviene revisar", porque los servicios sin proyecto no vuelven
// parcial la ganancia.
export function describeProfitReasons(group, {projects = [], links = {}, locale = "es-CL"} = {}) {
  const currency = group?.moneda || undefined;
  const projectIndex = indexProjects(projects);
  const {byReason, generic} = analyzeAlerts(group, projectIndex);
  const lines = [];

  const services = finiteOrNull(group?.ventasSinCostoRegistrado?.monto);
  if (services !== null && services > 0) {
    lines.push({
      key: "services", kind: "services", amount: services, count: finiteOrNull(group?.ventasSinCostoRegistrado?.ventas),
      projects: [],
      text: `Hay ${moneyOf(services, currency, locale)} en servicios vendidos sin proyecto, y no entran en la ganancia. Vincúlalos a un proyecto para saber si ganas o pierdes con ellos.`,
      action: links.sales ? {id: "sales", label: "Ir a Ventas"} : null,
    });
  }

  if (group && group.agregable === false) {
    lines.push({
      key: "no-currency", kind: "no-currency", amount: null, count: null, projects: [],
      text: "Hay registros sin moneda declarada: no se pueden sumar y no entran en la ganancia.",
      action: {id: "calculation", label: "Ver el cálculo paso a paso"},
    });
  }

  const reasons = [...byReason.keys()].sort((left, right) => {
    const rank = (motive) => (EXCLUSION_ORDER.includes(motive) ? EXCLUSION_ORDER.indexOf(motive) : EXCLUSION_ORDER.length);
    return rank(left) - rank(right);
  });
  reasons.forEach((motive) => {
    const list = [...byReason.get(motive).values()].sort(compareProjects);
    const count = list.length;
    const phrase = EXCLUSION_PHRASES[motive] || EXCLUSION_FALLBACK_PHRASE;
    lines.push({
      key: `project:${motive || "otro"}`, kind: "project", amount: null, count, projects: list,
      text: `${count} ${count === 1 ? "proyecto" : "proyectos"} con ${phrase} ${count === 1 ? "quedó excluido" : "quedaron excluidos"}.`,
      action: links.works ? {id: "works", label: "Ir a Proyectos", ...(count === 1 ? {workId: list[0].id} : {})} : null,
    });
  });

  if (generic > 0) {
    lines.push({
      key: "generic", kind: "generic", amount: null, count: generic, projects: [],
      text: `Hay ${generic} ${generic === 1 ? "cosa más" : "cosas más"} por revisar en el cálculo.`,
      action: {id: "calculation", label: "Ver el cálculo paso a paso"},
    });
  }

  const partial = group?.cobertura === COVERAGE.PARTIAL;
  return {
    show: lines.length > 0,
    partial,
    title: partial ? "Por qué es parcial" : "Qué conviene revisar",
    count: lines.length,
    lines,
  };
}

// --- Tarjeta de proyectos ----------------------------------------------------

const PROJECT_ROWS = Object.freeze([
  ["ingresoNeto", "Ingreso neto"],
  ["materialesVenta", "Materiales de venta"],
  ["materialesAdicionales", "Materiales adicionales"],
  ["horasHombre", "Horas hombre"],
  ["gastosDirectos", "Gastos directos"],
  ["gastosIndirectos", "Gastos indirectos"],
]);

// Resultado de proyectos del grupo, la frase que lo explica y las partidas en cero
// exacto que se pliegan detrás del botón. `status: "error"` cuando no se pudieron
// cargar los balances (A9 general): ahí no se afirma nada sobre los proyectos.
// Una partida sin dato (null) nunca se pliega, y "Resultado de proyectos" tampoco.
export function describeProjectsSummary(group, {projects = [], range = null, locale = "es-CL", currentMonthKey = null} = {}) {
  const currency = group?.moneda || undefined;
  const period = describePeriod(range, {locale, currentMonthKey});
  const components = group?.componentes?.proyectos || {};
  const result = finiteOrNull(components.resultado);
  const included = Math.max(0, Math.trunc(finiteOrNull(components.proyectos) ?? 0));
  const {byReason, unnamedProjects} = analyzeAlerts(group, indexProjects(projects));
  const excluded = [...byReason.values()].reduce((sum, list) => sum + list.size, 0) + unnamedProjects;
  const loadFailed = (group?.alertas || []).some((alert) => alert.id === "A9" && !(alert.registros || []).length);

  let status = "ready";
  let sentence;
  if (loadFailed) {
    status = "error";
    sentence = "No fue posible cargar los balances de los proyectos.";
  } else if (included === 0 && excluded > 0) {
    sentence = `Ningún proyecto con movimiento entra en la ganancia ${period.phrase}.`;
  } else if (included === 0) {
    sentence = `Sin proyectos con movimiento ${period.phrase}.`;
  } else {
    sentence = `${included} ${included === 1 ? "proyecto con movimiento entra" : "proyectos con movimiento entran"} en la ganancia ${period.phrase}.`;
    if (excluded > 0) sentence += ` ${excluded} ${excluded === 1 ? "proyecto quedó excluido" : "proyectos quedaron excluidos"}.`;
  }

  const rows = PROJECT_ROWS.map(([key, label]) => {
    const value = finiteOrNull(components[key]);
    return {key, label, value, zero: value === 0};
  });
  const zeroCount = status === "error" ? 0 : rows.filter((row) => row.zero).length;
  const zero = moneyOf(0, currency, locale);
  return {
    status,
    result,
    resultLabel: `resultado de proyectos ${period.phrase}`,
    sentence,
    included,
    excluded,
    period,
    rows,
    zeroCount,
    toggle: {
      show: zeroCount > 0,
      showLabel: `Mostrar ${zeroCount} ${zeroCount === 1 ? "partida" : "partidas"} en ${zero}`,
      hideLabel: `Ocultar ${zeroCount === 1 ? "la partida" : "las partidas"} en ${zero}`,
    },
  };
}
