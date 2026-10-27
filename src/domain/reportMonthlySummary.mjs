import {
  classifyOperationalProject,
  OPERATIONAL_NET_PROFIT_COVERAGE as COVERAGE,
  OPERATIONAL_PROJECT_EXCLUSION,
} from "./operationalNetProfit.mjs";

// SPEC 025 etapa 3: resumen mensual de Reportes. Este módulo solo resuelve
// meses, comparación porcentual y cobertura; las cifras vienen de reportModel
// (ventas y compras en neto) y de operationalNetProfit (ganancia). No calcula
// ningún monto por su cuenta.

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MONTHLY_EXPLANATIONS = Object.freeze({
  sales: "Confirmadas, sin IVA.",
  purchases: "Confirmadas, sin IVA. Incluye stock aún no vendido.",
  profit: "Lo vendido menos su costo, más lo que dejaron los proyectos.",
});

export const NO_PREVIOUS_MONTH_TEXT = "Sin datos del mes anterior para comparar";

export function currentMonthKey(todayKey) {
  return String(todayKey || "").slice(0, 7);
}

// Un mes inválido o posterior al actual cae al mes actual.
export function normalizeMonthKey(value, todayKey) {
  const current = currentMonthKey(todayKey);
  const month = String(value || "").trim();
  return MONTH_PATTERN.test(month) && month <= current ? month : current;
}

export function shiftMonthKey(monthKey, delta) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + Number(delta || 0), 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function canShowNextMonth(monthKey, todayKey) {
  return monthKey < currentMonthKey(todayKey);
}

// El mes en curso aún no termina: compararlo en porcentaje contra el mes
// anterior completo induce a error (el día 15 mostraría "50 % menos").
export function isMonthInProgress(monthKey, todayKey) {
  return monthKey >= currentMonthKey(todayKey);
}

export function getMonthRange(monthKey) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${monthKey}-01`,
    end: `${monthKey}-${String(days).padStart(2, "0")}`,
    days,
    period: "month",
  };
}

export function formatMonthLabel(monthKey, locale = "es-CL") {
  const [year, month] = String(monthKey).split("-").map(Number);
  const label = new Intl.DateTimeFormat(locale, {month: "long", year: "numeric", timeZone: "UTC"})
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}

// Solo el nombre del mes ("Septiembre"), para la referencia del mes anterior.
export function formatMonthName(monthKey, locale = "es-CL") {
  const [year, month] = String(monthKey).split("-").map(Number);
  const name = new Intl.DateTimeFormat(locale, {month: "long", timeZone: "UTC"})
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

// Referencia del mes anterior completo, sin porcentaje. Sin base (valor
// ausente) no hay monto que mostrar.
export function buildPreviousMonthReference(previousAmount) {
  return typeof previousAmount === "number" && Number.isFinite(previousAmount)
    ? {hasBase: true, amount: previousAmount}
    : {hasBase: false, amount: null};
}

export function formatReferenceText(reference, previousMonthName, formattedAmount) {
  return reference?.hasBase ? `${previousMonthName} completo: ${formattedAmount}` : NO_PREVIOUS_MONTH_TEXT;
}

// Sin base de comparación (mes anterior ausente, cero o no numérico) no hay
// porcentaje: nunca se divide por cero ni se inventa una variación.
export function compareWithPreviousMonth(current, previous) {
  const now = typeof current === "number" ? current : Number.NaN;
  const before = typeof previous === "number" ? previous : Number.NaN;
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) {
    return {hasBase: false, percent: null, direction: "none"};
  }
  const percent = Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
  return {hasBase: true, percent, direction: percent > 0 ? "up" : percent < 0 ? "down" : "flat"};
}

export function formatComparisonText(comparison, locale = "es-CL") {
  if (!comparison?.hasBase) return NO_PREVIOUS_MONTH_TEXT;
  if (comparison.direction === "flat") return "Sin variación frente al mes anterior";
  const amount = Math.abs(comparison.percent).toLocaleString(locale, {maximumFractionDigits: 1});
  return `${amount} % ${comparison.direction === "up" ? "más" : "menos"} que el mes anterior`;
}

// Número finito o null: nunca convierte null/""/texto en 0.
function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function profitGroups(profit, currency) {
  const groups = profit?.status === "ready" ? profit.result?.grupos || [] : [];
  return groups.filter((group) => group.moneda && (!currency || currency === "todos" || group.moneda === currency));
}

// Resume la cobertura de la ganancia del mes entre las monedas visibles.
export function summarizeProfitCoverage(profit, currency = "todos") {
  if (profit?.status !== "ready") return "pending";
  const groups = profitGroups(profit, currency);
  if (groups.some((group) => group.cobertura === COVERAGE.PARTIAL)) return "partial";
  if (groups.some((group) => group.cobertura === COVERAGE.COMPLETE)) return "complete";
  return "empty";
}

// Una fila por moneda con lo que pintan las tres tarjetas. `summary` y
// `previousSummary` salen de getSimplifiedReportSummary; `profit` y
// `previousProfit` salen de useOperationalNetProfit (estado + resultado).
// Con `inProgress` (mes actual) no hay porcentaje: cada métrica trae un
// `reference` con el total del mes anterior completo. Con el mes ya cerrado
// trae `comparison` en porcentaje y `reference` es null.
export function buildMonthlySummaryGroups({
  summary,
  previousSummary,
  profit,
  previousProfit,
  canViewProfitability = true,
  currency = "todos",
  inProgress = false,
}) {
  const NO_PERCENT = {hasBase: false, percent: null, direction: "none"};
  // `comparison` y `reference` según el estado del mes elegido.
  const compareOrRefer = (current, previousAmount) => inProgress
    ? {comparison: NO_PERCENT, reference: buildPreviousMonthReference(previousAmount)}
    : {comparison: compareWithPreviousMonth(current, previousAmount), reference: null};
  const known = new Set(summary.currencies.map((entry) => entry.currency));
  const extra = canViewProfitability
    ? profitGroups(profit, currency).map((group) => group.moneda).filter((code) => !known.has(code))
    : [];
  const empty = (code) => ({currency: code, sales: {count: 0, total: 0}, purchases: {count: 0, total: 0}});
  const rows = [...summary.currencies, ...extra.map(empty)]
    .sort((left, right) => left.currency.localeCompare(right.currency));
  const find = (source, code) => source?.currencies.find((entry) => entry.currency === code);

  return rows.map((group) => {
    const previous = find(previousSummary, group.currency);
    // Sin operaciones el mes anterior no hay base, aunque el total sea 0.
    const baseOf = (before) => before?.count > 0 ? before.total : null;
    const row = {
      currency: group.currency,
      sales: {
        count: group.sales.count,
        total: group.sales.total,
        ...compareOrRefer(group.sales.total, baseOf(previous?.sales)),
      },
      purchases: {
        count: group.purchases.count,
        total: group.purchases.total,
        ...compareOrRefer(group.purchases.total, baseOf(previous?.purchases)),
      },
      profit: null,
    };
    if (!canViewProfitability) return row;

    const ready = profit?.status === "ready";
    const current = profitGroups(profit, group.currency)[0];
    const before = profitGroups(previousProfit, group.currency)[0];
    const amount = ready ? current?.gananciaNetaOperacional ?? 0 : null;
    row.profit = {
      status: profit?.status || "loading",
      error: profit?.error || "",
      amount,
      coverage: summarizeProfitCoverage(profit, group.currency),
      // Margen sobre ventas y base de ventas consideradas tal como las entrega la
      // ganancia (gananciaNetaOperacionalPct / ingresoNetoConsiderado): solo se
      // traspasan, no se recalculan. Sin ganancia lista, o sin esos campos, son null.
      marginPct: ready ? finiteOrNull(current?.gananciaNetaOperacionalPct) : null,
      consideredRevenue: ready ? finiteOrNull(current?.ingresoNetoConsiderado) : null,
      // La referencia de la ganancia solo existe con la ganancia anterior lista.
      ...compareOrRefer(amount, previousProfit?.status === "ready" ? before?.gananciaNetaOperacional : null),
    };
    return row;
  });
}

// ¿Alguna tarjeta visible tiene base del mes anterior? Si ninguna la tiene, la
// pantalla muestra una sola línea "Sin datos del mes anterior para comparar"
// en vez de repetirla en cada tarjeta. La ganancia solo cuenta cuando está lista.
export function hasPreviousMonthBase(groups, {sales = true, purchases = true, profit = true} = {}) {
  const baseOf = (metric) => Boolean(metric && (metric.reference ? metric.reference.hasBase : metric.comparison?.hasBase));
  return groups.some((group) =>
    (sales && baseOf(group.sales)) ||
    (purchases && baseOf(group.purchases)) ||
    (profit && group.profit?.status === "ready" && baseOf(group.profit))
  );
}

// Vacío del primer día: ningún dato visible del mes. Mientras la ganancia se
// calcula o falla no se declara vacío, para no confundir un fallo con "no hay".
export function isMonthEmpty(groups) {
  return groups.every((group) =>
    group.sales.count === 0 &&
    group.purchases.count === 0 &&
    (!group.profit || (group.profit.status === "ready" && group.profit.coverage === "empty"))
  );
}

// --- Proyectos del mes (SPEC 025 §3) ---
// Lista de proyectos con movimiento en el mes elegido. No calcula dinero nuevo:
// toma el `resultado` mensual de `desglosePorMes` de cada balance, con el mismo
// criterio de proyecto incluible y de mes que calculateOperationalNetProfit, así
// que la suma de la lista es el "Resultado de proyectos" de la pestaña Ganancia.

export const PROJECT_RESULT_STATUS = Object.freeze({
  LOSING: "PERDIENDO",
  WINNING: "GANANDO",
  NEUTRAL: "SIN_RESULTADO",
});

const PROJECT_RESULT_LABELS = Object.freeze({
  [PROJECT_RESULT_STATUS.LOSING]: "Perdiendo",
  [PROJECT_RESULT_STATUS.WINNING]: "Ganando",
  [PROJECT_RESULT_STATUS.NEUTRAL]: "Sin resultado",
});

export function projectResultLabel(status) {
  return PROJECT_RESULT_LABELS[status] || PROJECT_RESULT_LABELS[PROJECT_RESULT_STATUS.NEUTRAL];
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function projectResultStatus(result) {
  if (result < 0) return PROJECT_RESULT_STATUS.LOSING;
  if (result > 0) return PROJECT_RESULT_STATUS.WINNING;
  return PROJECT_RESULT_STATUS.NEUTRAL;
}

// Pierden primero (el peor al comienzo), luego los que ganan (el mayor primero)
// y al final los de resultado 0. Empates por título y número para que el orden
// sea estable.
const STATUS_RANK = Object.freeze({
  [PROJECT_RESULT_STATUS.LOSING]: 0,
  [PROJECT_RESULT_STATUS.WINNING]: 1,
  [PROJECT_RESULT_STATUS.NEUTRAL]: 2,
});

export function compareProjectResultRows(left, right) {
  return left.moneda.localeCompare(right.moneda) ||
    STATUS_RANK[left.estado] - STATUS_RANK[right.estado] ||
    (left.estado === PROJECT_RESULT_STATUS.LOSING ? left.resultado - right.resultado : right.resultado - left.resultado) ||
    left.titulo.localeCompare(right.titulo, "es") ||
    left.numero.localeCompare(right.numero, "es");
}

// Mes elegido de un proyecto: su clasificación (misma regla que la ganancia), los
// registros mensuales de ese mes y si el filtro de moneda lo deja fuera. Lo
// comparten la lista de resultados y la de proyectos incompletos para que
// cuenten exactamente lo mismo.
function inspectMonthlyProject(entry, month, currency) {
  const months = Array.isArray(entry?.balance?.desglosePorMes)
    ? entry.balance.desglosePorMes.filter((item) => item?.mes === month)
    : [];
  const classification = classifyOperationalProject(entry);
  const filtered = Boolean(currency && currency !== "todos" && classification.moneda && classification.moneda !== currency);
  return {classification, months, filtered};
}

// `projects` son las entradas de `projects.meta.proyectos` del hook de
// rentabilidad: el trabajo con su `balance`. Un proyecto no incluible (misma
// regla que la ganancia) no tiene resultado confiable: no se lista y se cuenta
// en `incompletos` si tuvo movimiento ese mes.
// Cada fila trae, además del resultado del mes, el ingreso y el costo de ese mes
// (suma de los mismos registros mensuales), el acumulado del proyecto completo
// (`resultado` y `rentabilidadPct` tal como los entrega el balance, null si el
// balance no los tiene, p. ej. sin venta) y el estado del balance. No hay
// ninguna división ni fórmula nueva.
export function buildMonthlyProjectResults({projects = [], month, currency = "todos"} = {}) {
  const rows = [];
  let incomplete = 0;
  (Array.isArray(projects) ? projects : []).forEach((entry) => {
    const {classification, months, filtered} = inspectMonthlyProject(entry, month, currency);
    if (!classification.incluible) {
      if (months.length && !filtered) incomplete += 1;
      return;
    }
    if (filtered) return;
    const monthRows = months.filter((item) => item.moneda === classification.moneda);
    if (!monthRows.length) return;
    const sumOf = (field) => roundMoney(monthRows.reduce((total, item) => total + item[field], 0));
    const result = sumOf("resultado");
    rows.push({
      id: classification.proyectoId,
      numero: String(entry.numero || ""),
      titulo: String(entry.titulo || "").trim() || "Proyecto sin título",
      cliente: String(entry.clienteSnapshot?.nombreRazonSocial || "").trim(),
      moneda: classification.moneda,
      resultado: result,
      estado: projectResultStatus(result),
      ingresoNeto: sumOf("ingresoNeto"),
      costoTotal: sumOf("costoTotal"),
      acumulado: {
        resultado: finiteOrNull(entry.balance?.resultado),
        rentabilidadPct: finiteOrNull(entry.balance?.rentabilidadPct),
      },
      estadoBalance: classification.estadoBalance,
    });
  });
  return {filas: rows.sort(compareProjectResultRows), incompletos: incomplete};
}

// Motivo, en palabras, por el que un proyecto no entra en la ganancia. Sin cifras:
// sus importes no son confiables.
export const INCOMPLETE_PROJECT_REASONS = Object.freeze({
  [OPERATIONAL_PROJECT_EXCLUSION.INVALID_STRUCTURE]: "El balance del proyecto no tiene un formato válido.",
  [OPERATIONAL_PROJECT_EXCLUSION.UNSUPPORTED_STATUS]: "El balance del proyecto no está disponible para la ganancia.",
  [OPERATIONAL_PROJECT_EXCLUSION.CURRENCY_MISMATCH]: "Tiene registros en más de una moneda.",
  [OPERATIONAL_PROJECT_EXCLUSION.MISSING_SALE_MATERIAL_COST]: "Tiene materiales vendidos sin costo histórico.",
  [OPERATIONAL_PROJECT_EXCLUSION.INVALID_SALE_NET]: "Tiene ventas sin neto válido.",
  [OPERATIONAL_PROJECT_EXCLUSION.UNDATED_RECORDS]: "Tiene registros sin fecha válida.",
  [OPERATIONAL_PROJECT_EXCLUSION.NON_FINITE_AMOUNTS]: "Tiene importes que no son números válidos.",
});
const INCOMPLETE_REASON_FALLBACK = "Sus datos están incompletos.";

// Los proyectos que `buildMonthlyProjectResults` cuenta en `incompletos`
// (mismo criterio: no incluibles, con movimiento en el mes y no filtrados por
// moneda), con nombre y motivo y sin ninguna cifra. Ordenados por título.
export function listIncompleteMonthlyProjects({projects = [], month, currency = "todos"} = {}) {
  const list = [];
  (Array.isArray(projects) ? projects : []).forEach((entry) => {
    const {classification, months, filtered} = inspectMonthlyProject(entry, month, currency);
    if (classification.incluible || filtered || !months.length) return;
    list.push({
      id: classification.proyectoId,
      numero: String(entry.numero || ""),
      titulo: String(entry.titulo || "").trim() || "Proyecto sin título",
      motivo: classification.motivo,
      motivoTexto: INCOMPLETE_PROJECT_REASONS[classification.motivo] || INCOMPLETE_REASON_FALLBACK,
    });
  });
  return list.sort((left, right) => left.titulo.localeCompare(right.titulo, "es") || left.numero.localeCompare(right.numero, "es"));
}

// Monto de servicios vendidos sin proyecto del mes, por moneda, tal como lo
// entrega calculateOperationalNetProfit (`ventasSinCostoRegistrado`). Solo las
// monedas con monto mayor que 0.
export function buildServicesWithoutProjectNotices(profit, currency = "todos") {
  const groups = profit?.status === "ready" ? profit.result?.grupos || [] : [];
  return groups
    .filter((group) => group.moneda && (!currency || currency === "todos" || group.moneda === currency))
    .map((group) => ({moneda: group.moneda, monto: group.ventasSinCostoRegistrado?.monto}))
    .filter((notice) => Number.isFinite(notice.monto) && notice.monto > 0);
}

// --- Resumen visual (SPEC 025): helpers puros para el círculo del margen, el
// aviso único de la ganancia y las barras de proyectos. Solo presentan lo que ya
// calculan operationalNetProfit y buildMonthlyProjectResults; no definen
// ninguna fórmula económica.

function numberFormatters(locale, currency) {
  const build = (options) => {
    try {
      return new Intl.NumberFormat(locale, {style: "currency", currency, ...options});
    } catch (error) {
      return new Intl.NumberFormat("es-CL", {style: "currency", currency: "CLP", ...options});
    }
  };
  // Hasta un decimal para lo "por cada $100" (sin ceros de relleno, también en
  // monedas con centavos) y los decimales propios de la moneda para el resto.
  const perHundred = build({minimumFractionDigits: 0, maximumFractionDigits: 1});
  const full = build({});
  return {perHundred: (value) => perHundred.format(value), full: (value) => full.format(value)};
}

const MARGIN_BASE = 100;
export const NO_MARGIN_TEXT = "Aún no hay ventas para calcular el margen";

// Círculo y frase del margen sobre ventas. `marginPct` es
// gananciaNetaOperacionalPct tal cual (ganancia ÷ ventas consideradas × 100).
//  - pending: la ganancia aún no está lista (sin frase ni círculo).
//  - none: sin margen (null: no hay ventas consideradas) → sin círculo.
//  - zero / positive / negative: frase con el valor real, sin tope. Solo un
//    margen positivo llena el círculo (hasta 100 %); cero y negativo lo dejan
//    vacío, y la frase y el ícono dicen el sentido.
// `basis` pide la nota "sobre $N de ventas consideradas" solo si esa base
// difiere del total "Vendí" (`salesTotal`) del mismo grupo.
export function describeProfitMargin({
  marginPct = null,
  consideredRevenue = null,
  salesTotal = null,
  status = "ready",
  coverage = "complete",
  currency = "CLP",
  locale = "es-CL",
} = {}) {
  const partial = coverage === "partial";
  const empty = {
    kind: "pending",
    partial,
    percent: null,
    dollarsPer100: null,
    ring: {fraction: 0, tone: "none"},
    sentence: "",
    basis: {show: false, amount: null, text: ""},
    ariaLabel: "",
  };
  if (status !== "ready") return empty;

  const money = numberFormatters(locale, currency);
  const withPartial = (text) => (partial ? `${text}. Cobertura parcial` : text);
  const pct = finiteOrNull(marginPct);
  if (pct === null) {
    return {...empty, kind: "none", sentence: NO_MARGIN_TEXT, ariaLabel: withPartial(NO_MARGIN_TEXT)};
  }

  const rounded = Math.round(pct * 10) / 10 || 0;
  const kind = rounded > 0 ? "positive" : rounded < 0 ? "negative" : "zero";
  const dollars = Math.abs(rounded);
  const sentence = kind === "negative"
    ? `De cada ${money.perHundred(MARGIN_BASE)} que vendes, pierdes ${money.perHundred(dollars)}`
    : `De cada ${money.perHundred(MARGIN_BASE)} que vendes, te quedan ${money.perHundred(dollars)}`;

  const considered = finiteOrNull(consideredRevenue);
  const sold = finiteOrNull(salesTotal);
  const differs = considered !== null && sold !== null && Math.abs(roundMoney(considered) - roundMoney(sold)) >= 0.01;
  const basisText = differs ? `sobre ${money.full(considered)} de ventas consideradas` : "";

  return {
    kind,
    partial,
    percent: rounded,
    dollarsPer100: dollars,
    ring: {
      fraction: kind === "positive" ? Math.round((Math.min(pct, MARGIN_BASE) / MARGIN_BASE) * 10000) / 10000 : 0,
      tone: kind === "positive" ? "up" : kind === "negative" ? "down" : "none",
    },
    sentence,
    basis: {show: differs, amount: differs ? considered : null, text: basisText},
    ariaLabel: withPartial(basisText ? `${sentence}, ${basisText}` : sentence),
  };
}

const PARTIAL_PROFIT_TEXT = "La ganancia del mes es parcial: hay registros que no se incluyen.";

function incompleteProjectsText(count) {
  return `${count} ${count === 1 ? "proyecto con movimiento no se muestra" : "proyectos con movimiento no se muestran"} porque sus datos están incompletos.`;
}

function withoutNetText(count) {
  return `Hay ${count} ${count === 1 ? "documento confirmado sin neto válido, que no se suma" : "documentos confirmados sin neto válido, que no se suman"} en Ventas y Compras.`;
}

// Líneas del aviso único de la ganancia (una moneda por llamada). Cada línea:
// {key, placement, text, detail, amount, action}.
//  - placement "profit": va pegada a la tarjeta de ganancia; "projects": va
//    una sola vez en la sección de proyectos.
//  - partial: cobertura parcial (con permiso de ganancia). Con una sola moneda
//    suma en `detail` cuántos proyectos con movimiento quedaron fuera.
//  - incomplete: lo mismo, pero sin cobertura parcial (caso raro): línea propia.
//  - services: monto de servicios vendidos sin proyecto (el texto lo arma la
//    pantalla porque lleva el monto formateado); solo con monto mayor que 0.
//  - without-net: documentos sin neto válido de Ventas y Compras (una vez:
//    solo en el grupo `primary`).
//  - incomplete-projects: con 2 o más monedas el conteo no se puede atribuir
//    a una moneda, así que va una sola vez, en la sección de proyectos.
// Sin líneas no se muestra aviso.
export function buildProfitNoticeLines({
  coverage = "complete",
  incompleteCount = 0,
  servicesAmount = null,
  withoutNetCount = 0,
  currencyCount = 1,
  primary = true,
  canViewProfitability = false,
  canOpenSales = false,
} = {}) {
  const lines = [];
  const line = (key, placement, extra = {}) => ({key, placement, text: null, detail: "", amount: null, action: null, ...extra});
  const incomplete = Math.max(0, Math.trunc(finiteOrNull(incompleteCount) ?? 0));
  const multiCurrency = (finiteOrNull(currencyCount) ?? 1) > 1;

  if (canViewProfitability) {
    const detail = !multiCurrency && incomplete > 0 ? incompleteProjectsText(incomplete) : "";
    if (coverage === "partial") {
      lines.push(line("partial", "profit", {text: PARTIAL_PROFIT_TEXT, detail, action: {id: "system-state", label: "Ver estado del sistema"}}));
    } else if (detail) {
      lines.push(line("incomplete", "profit", {text: detail}));
    }
    const services = finiteOrNull(servicesAmount);
    if (services !== null && services > 0) {
      lines.push(line("services", "profit", {amount: services, action: canOpenSales ? {id: "sales", label: "Ir a Ventas"} : null}));
    }
  }

  const withoutNet = Math.max(0, Math.trunc(finiteOrNull(withoutNetCount) ?? 0));
  if (primary && withoutNet > 0) lines.push(line("without-net", "profit", {text: withoutNetText(withoutNet)}));
  if (canViewProfitability && primary && multiCurrency && incomplete > 0) {
    lines.push(line("incomplete-projects", "projects", {text: incompleteProjectsText(incomplete)}));
  }
  return lines;
}

// Barras del resultado del mes. Escala por moneda (no se comparan monedas): la
// barra más larga de cada moneda mide 1 y las demás son proporcionales a su
// valor absoluto. `direction`: "right" para el que gana, "left" para el que
// pierde y "none" para resultado 0 (fracción 0). Devuelve filas nuevas con
// `bar`, en el mismo orden, sin modificar las originales.
export function scaleProjectBars(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const largest = new Map();
  list.forEach((row) => {
    const size = Math.abs(finiteOrNull(row?.resultado) ?? 0);
    largest.set(row?.moneda, Math.max(largest.get(row?.moneda) || 0, size));
  });
  return list.map((row) => {
    const value = finiteOrNull(row?.resultado) ?? 0;
    const max = largest.get(row?.moneda) || 0;
    const fraction = value !== 0 && max > 0 ? Math.round((Math.abs(value) / max) * 10000) / 10000 : 0;
    return {...row, bar: {direction: value > 0 ? "right" : value < 0 ? "left" : "none", fraction}};
  });
}
