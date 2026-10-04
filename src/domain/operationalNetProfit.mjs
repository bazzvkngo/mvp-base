import {
  calculateSaleCommercialMarginV1,
  SALE_COMMERCIAL_MARGIN_STATUS,
} from "./saleCommercialMargin.mjs";

// SPEC 022 §4: ganancia neta operacional. Helper puro (sin Firebase ni red)
// que combina dos universos disjuntos por `trabajoId`:
// - Ventas SIN_PROYECTO: margen bruto de productos de Margen V1 COMPLETO;
// - Proyectos incluibles: resultado mensual de `desglosePorMes` del balance
//   autoritativo (obtenerBalanceTrabajo), sólo en los meses del período.
// Ninguna Venta aporta por dos vías y ningún término usa Compras.

export const OPERATIONAL_NET_PROFIT_MODEL_VERSION = 1;

export const OPERATIONAL_NET_PROFIT_COVERAGE = Object.freeze({
  COMPLETE: "COMPLETA",
  PARTIAL: "PARCIAL",
  EMPTY: "SIN_DATOS",
});

export const OPERATIONAL_NET_PROFIT_UNASSIGNED_CURRENCY = "SIN_MONEDA";

// SPEC 022 §6.2. `efecto` describe qué pasa con los registros alertados.
export const OPERATIONAL_NET_PROFIT_ALERTS = Object.freeze({
  A1: Object.freeze({id: "A1", clave: "VENTAS_SIN_PROYECTO_SIN_COSTO_HISTORICO", efecto: "EXCLUIDAS"}),
  A2: Object.freeze({id: "A2", clave: "VENTAS_MONEDA_INCONSISTENTE", efecto: "EXCLUIDAS"}),
  A3: Object.freeze({id: "A3", clave: "VENTAS_SIN_NETO_VALIDO", efecto: "EXCLUIDAS"}),
  A4: Object.freeze({id: "A4", clave: "PROYECTOS_CON_COSTOS_SIN_VENTA", efecto: "INCLUIDOS"}),
  A5: Object.freeze({id: "A5", clave: "PROYECTOS_MATERIALES_SIN_COSTO_HISTORICO", efecto: "EXCLUIDOS"}),
  A6: Object.freeze({id: "A6", clave: "PROYECTOS_MONEDA_INCONSISTENTE", efecto: "EXCLUIDOS"}),
  A7: Object.freeze({id: "A7", clave: "PROYECTOS_REGISTROS_SIN_FECHA", efecto: "EXCLUIDOS"}),
  A8: Object.freeze({id: "A8", clave: "LECTURA_TRUNCADA", efecto: "COBERTURA_PARCIAL"}),
  A9: Object.freeze({id: "A9", clave: "BALANCES_PROYECTO_NO_DISPONIBLES", efecto: "COBERTURA_PARCIAL"}),
});

export const OPERATIONAL_PROJECT_EXCLUSION = Object.freeze({
  INVALID_STRUCTURE: "ESTRUCTURA_INVALIDA",
  UNSUPPORTED_STATUS: "ESTADO_BALANCE_NO_INCLUIBLE",
  CURRENCY_MISMATCH: "MONEDA_INCONSISTENTE",
  MISSING_SALE_MATERIAL_COST: "MATERIALES_VENTA_SIN_COSTO",
  INVALID_SALE_NET: "VENTAS_SIN_NETO_VALIDO",
  UNDATED_RECORDS: "REGISTROS_SIN_FECHA",
  NON_FINITE_AMOUNTS: "IMPORTES_NO_FINITOS",
});

const INCLUDABLE_BALANCE_STATUSES = new Set(["COMPLETO", "PARCIAL_SIN_VENTA"]);
const MONTHLY_FIELDS = ["ingresoNeto", "materialesVenta", "materialesAdicionales", "horasHombre", "gastosDirectos", "gastosIndirectos", "costoTotal", "resultado"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

function validDate(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return DATE_PATTERN.test(normalized) && !Number.isNaN(new Date(`${normalized}T12:00:00Z`).getTime())
    ? normalized
    : null;
}

// Mismo criterio que functions/workBalance.js (saleNetAmount): un neto válido
// es un número finito ≥ 0; nunca se sustituye por `total`.
function hasValidSaleNet(sale) {
  const value = sale?.neto;
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function lastDayOfMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function normalizeOperationalPeriod(period = null) {
  if (!period) return {desde: null, hasta: null, mesDesde: null, mesHasta: null, proyectosPorMesCompleto: false};
  const from = validDate(period.desde);
  const to = validDate(period.hasta);
  if (!from || !to || from > to) throw new Error("El período de ganancia neta operacional no es válido.");
  const monthFrom = from.slice(0, 7);
  const monthTo = to.slice(0, 7);
  return {
    desde: from,
    hasta: to,
    mesDesde: monthFrom,
    mesHasta: monthTo,
    // SPEC 022 §5.2 vs §5.3: el balance sólo entrega importes por mes. Si el
    // rango corta un mes, los Proyectos aportan ese mes completo; esta bandera
    // lo deja explícito para la UI.
    proyectosPorMesCompleto: from.slice(8) !== "01" || Number(to.slice(8)) !== lastDayOfMonth(monthTo),
  };
}

function saleInPeriod(sale, period) {
  if (!period.desde) return true;
  const date = validDate(sale?.fechaVenta);
  return Boolean(date) && date >= period.desde && date <= period.hasta;
}

function monthInPeriod(month, period) {
  if (!period.mesDesde) return true;
  return month >= period.mesDesde && month <= period.mesHasta;
}

function unwrapBalance(entry = {}) {
  const wrapped = entry && typeof entry === "object" && !Array.isArray(entry) &&
    Object.prototype.hasOwnProperty.call(entry, "balance");
  const balance = wrapped ? entry.balance : entry;
  const projectId = String(entry?.trabajoId || entry?.id || balance?.trabajoId || "").trim();
  return {balance, projectId};
}

function periodMonths(balance, currency, period) {
  const entries = Array.isArray(balance?.desglosePorMes) ? balance.desglosePorMes : [];
  return entries.filter((entry) => entry?.moneda === currency && monthInPeriod(String(entry?.mes || ""), period));
}

function hasPeriodActivity(balance, period) {
  const entries = Array.isArray(balance?.desglosePorMes) ? balance.desglosePorMes : [];
  return entries.some((entry) => monthInPeriod(String(entry?.mes || ""), period));
}

// SPEC 022 §4.5 (y §5.1 para registros sin fecha). Un Proyecto no incluible
// queda fuera completo: ni su ingreso ni sus costos entran en la suma.
export function classifyOperationalProject(entry = {}) {
  const {balance, projectId} = unwrapBalance(entry);
  const currency = normalizeCurrency(balance?.moneda);
  const status = String(balance?.estado || "").trim().toUpperCase();
  const base = {proyectoId: projectId, moneda: currency || null, estadoBalance: status, incluible: false};
  const exclude = (motivo) => ({...base, motivo});

  if (!balance || typeof balance !== "object" || Array.isArray(balance) || !currency || !Array.isArray(balance.desglosePorMes)) {
    return exclude(OPERATIONAL_PROJECT_EXCLUSION.INVALID_STRUCTURE);
  }
  if (status === "INCONSISTENTE_MONEDA") return exclude(OPERATIONAL_PROJECT_EXCLUSION.CURRENCY_MISMATCH);
  if (!INCLUDABLE_BALANCE_STATUSES.has(status)) return exclude(OPERATIONAL_PROJECT_EXCLUSION.UNSUPPORTED_STATUS);
  if (balance.fuentes?.materialesVentaSinCosto !== 0) return exclude(OPERATIONAL_PROJECT_EXCLUSION.MISSING_SALE_MATERIAL_COST);
  if (balance.fuentes?.ventasSinNetoValido !== 0) return exclude(OPERATIONAL_PROJECT_EXCLUSION.INVALID_SALE_NET);
  if (balance.fuentes?.registrosSinFecha !== 0) return exclude(OPERATIONAL_PROJECT_EXCLUSION.UNDATED_RECORDS);

  const months = balance.desglosePorMes.filter((month) => month?.moneda === currency);
  const finiteMonths = months.every((month) => MONTH_PATTERN.test(String(month?.mes || "")) &&
    MONTHLY_FIELDS.every((field) => finiteNumber(month[field]) !== null));
  const finiteTotals = finiteNumber(balance.costoTotal) !== null &&
    (status !== "COMPLETO" || (finiteNumber(balance.valorComercial) !== null && finiteNumber(balance.resultado) !== null));
  if (!finiteMonths || !finiteTotals) return exclude(OPERATIONAL_PROJECT_EXCLUSION.NON_FINITE_AMOUNTS);

  return {...base, incluible: true, motivo: null};
}

function createGroup(currency) {
  return {
    moneda: currency || null,
    agregable: Boolean(currency),
    ventas: {ventas: 0, ingresoNetoProductos: 0, costoHistoricoProductos: 0, margenBrutoProductos: 0},
    proyectos: {proyectos: 0, ingresoNeto: 0, materialesVenta: 0, materialesAdicionales: 0, horasHombre: 0, gastosDirectos: 0, gastosIndirectos: 0, costoTotal: 0, resultado: 0},
    sinCosto: {ventas: 0, monto: 0},
    alerts: new Map(),
    activity: false,
  };
}

function addAlert(group, definition, {count = 1, amount = null, reference = ""} = {}) {
  if (!group.alerts.has(definition.id)) {
    group.alerts.set(definition.id, {...definition, conteo: 0, monto: null, registros: []});
  }
  const alert = group.alerts.get(definition.id);
  alert.conteo += count;
  if (amount !== null) alert.monto = roundMoney((alert.monto || 0) + amount);
  if (reference) alert.registros.push(reference);
}

function saleReference(sale) {
  return String(sale?.ventaId || sale?.id || sale?.numero || "").trim();
}

function registerSale(groups, sale, period) {
  if (String(sale?.trabajoId || "").trim() || !saleInPeriod(sale, period)) return;
  const margin = calculateSaleCommercialMarginV1(sale);
  if (margin.estado === SALE_COMMERCIAL_MARGIN_STATUS.PENDING || margin.estado === SALE_COMMERCIAL_MARGIN_STATUS.CANCELED) return;

  const currency = normalizeCurrency(sale?.moneda);
  const key = currency || OPERATIONAL_NET_PROFIT_UNASSIGNED_CURRENCY;
  if (!groups.has(key)) groups.set(key, createGroup(currency));
  const group = groups.get(key);
  group.activity = true;
  const reference = saleReference(sale);

  if (!hasValidSaleNet(sale)) {
    addAlert(group, OPERATIONAL_NET_PROFIT_ALERTS.A3, {reference});
    return;
  }
  if (margin.estado === SALE_COMMERCIAL_MARGIN_STATUS.CURRENCY_MISMATCH) {
    addAlert(group, OPERATIONAL_NET_PROFIT_ALERTS.A2, {amount: sale.neto, reference});
    return;
  }
  if (margin.estado === SALE_COMMERCIAL_MARGIN_STATUS.PARTIAL || margin.estado === SALE_COMMERCIAL_MARGIN_STATUS.UNAVAILABLE) {
    addAlert(group, OPERATIONAL_NET_PROFIT_ALERTS.A1, {amount: sale.neto, reference});
    return;
  }

  // COMPLETO o NO_APLICA. La porción de servicios/actividades va SOLO a la
  // línea "Ventas sin costo registrado" (§4.4): nunca se suma ni se resta.
  const serviceRevenue = roundMoney(margin.ingresoNetoVenta - margin.ingresoNetoProductos);
  if (serviceRevenue > 0) {
    group.sinCosto.ventas += 1;
    group.sinCosto.monto += serviceRevenue;
  }
  if (margin.estado === SALE_COMMERCIAL_MARGIN_STATUS.COMPLETE) {
    group.ventas.ventas += 1;
    group.ventas.ingresoNetoProductos += margin.ingresoNetoProductos;
    group.ventas.costoHistoricoProductos += margin.costoHistoricoProductos;
    group.ventas.margenBrutoProductos += margin.margenBrutoProductos;
  }
}

function registerProject(groups, entry, period) {
  const {balance} = unwrapBalance(entry);
  const classification = classifyOperationalProject(entry);
  const key = classification.moneda || OPERATIONAL_NET_PROFIT_UNASSIGNED_CURRENCY;
  const reference = classification.proyectoId;
  const motive = classification.motivo;

  // Sin fechas confiables o sin estructura no se puede saber si hubo actividad
  // en el período: se alerta siempre (conservador).
  const activityUnknown = motive === OPERATIONAL_PROJECT_EXCLUSION.INVALID_STRUCTURE ||
    motive === OPERATIONAL_PROJECT_EXCLUSION.UNDATED_RECORDS;
  if (!activityUnknown && !hasPeriodActivity(balance, period)) return;

  if (!groups.has(key)) groups.set(key, createGroup(classification.moneda));
  const group = groups.get(key);
  group.activity = true;

  if (!classification.incluible) {
    const alertByMotive = {
      [OPERATIONAL_PROJECT_EXCLUSION.MISSING_SALE_MATERIAL_COST]: OPERATIONAL_NET_PROFIT_ALERTS.A5,
      [OPERATIONAL_PROJECT_EXCLUSION.CURRENCY_MISMATCH]: OPERATIONAL_NET_PROFIT_ALERTS.A6,
      [OPERATIONAL_PROJECT_EXCLUSION.UNDATED_RECORDS]: OPERATIONAL_NET_PROFIT_ALERTS.A7,
    };
    if (motive === OPERATIONAL_PROJECT_EXCLUSION.INVALID_SALE_NET) {
      addAlert(group, OPERATIONAL_NET_PROFIT_ALERTS.A3, {count: balance.fuentes.ventasSinNetoValido, reference});
    } else if (alertByMotive[motive]) {
      addAlert(group, alertByMotive[motive], {reference});
    } else {
      // Estructura inválida, estado no soportado o importes no finitos: el
      // balance existe pero no es utilizable, igual que si no se hubiera cargado.
      addAlert(group, OPERATIONAL_NET_PROFIT_ALERTS.A9, {reference});
    }
    return;
  }

  const months = periodMonths(balance, classification.moneda, period);
  group.proyectos.proyectos += 1;
  months.forEach((month) => {
    ["ingresoNeto", "materialesVenta", "materialesAdicionales", "horasHombre", "gastosDirectos", "gastosIndirectos", "costoTotal", "resultado"]
      .forEach((field) => { group.proyectos[field] += month[field]; });
  });
  if (classification.estadoBalance === "PARCIAL_SIN_VENTA" && months.length) {
    addAlert(group, OPERATIONAL_NET_PROFIT_ALERTS.A4, {
      amount: months.reduce((sum, month) => sum + month.costoTotal, 0),
      reference,
    });
  }
}

function finalizeGroup(group, generalAlerts) {
  const alerts = [...group.alerts.values(), ...generalAlerts]
    .filter((alert) => alert.conteo > 0)
    .sort((left, right) => Number(left.id.slice(1)) - Number(right.id.slice(1)));
  // A4 no degrada cobertura: sus costos sí se incluyen (§5.4).
  const hasPartialAlert = alerts.some((alert) => alert.id !== OPERATIONAL_NET_PROFIT_ALERTS.A4.id);
  const coverage = !group.activity && !generalAlerts.length
    ? OPERATIONAL_NET_PROFIT_COVERAGE.EMPTY
    : hasPartialAlert || !group.agregable
      ? OPERATIONAL_NET_PROFIT_COVERAGE.PARTIAL
      : OPERATIONAL_NET_PROFIT_COVERAGE.COMPLETE;
  const empty = coverage === OPERATIONAL_NET_PROFIT_COVERAGE.EMPTY || !group.agregable;

  const sales = Object.fromEntries(Object.entries(group.ventas).map(([key, value]) => [key, key === "ventas" ? value : roundMoney(value)]));
  const projects = Object.fromEntries(Object.entries(group.proyectos).map(([key, value]) => [key, key === "proyectos" ? value : roundMoney(value)]));
  const profit = roundMoney(sales.margenBrutoProductos + projects.resultado);
  const consideredRevenue = roundMoney(sales.ingresoNetoProductos + projects.ingresoNeto);

  return {
    moneda: group.moneda,
    agregable: group.agregable,
    gananciaNetaOperacional: empty ? null : profit,
    gananciaNetaOperacionalPct: !empty && consideredRevenue > 0 ? roundMoney((profit / consideredRevenue) * 100) : null,
    ingresoNetoConsiderado: empty ? null : consideredRevenue,
    componentes: {
      ventasSinProyecto: sales,
      proyectos: projects,
    },
    ventasSinCostoRegistrado: {
      ventas: group.sinCosto.ventas,
      monto: group.agregable ? roundMoney(group.sinCosto.monto) : null,
    },
    cobertura: coverage,
    esTotalDefinitivo: coverage === OPERATIONAL_NET_PROFIT_COVERAGE.COMPLETE,
    alertas: alerts,
  };
}

export function calculateOperationalNetProfit({
  sales = [],
  projectBalances = [],
  period = null,
  salesTruncated = false,
  projectsError = false,
} = {}) {
  const normalizedPeriod = normalizeOperationalPeriod(period);
  const groups = new Map();
  (Array.isArray(sales) ? sales : []).forEach((sale) => registerSale(groups, sale, normalizedPeriod));
  if (!projectsError) {
    (Array.isArray(projectBalances) ? projectBalances : []).forEach((entry) => registerProject(groups, entry, normalizedPeriod));
  }

  const generalAlerts = [
    ...(salesTruncated ? [{...OPERATIONAL_NET_PROFIT_ALERTS.A8, conteo: 1, monto: null, registros: []}] : []),
    ...(projectsError ? [{...OPERATIONAL_NET_PROFIT_ALERTS.A9, conteo: 1, monto: null, registros: []}] : []),
  ];

  return {
    modeloGananciaNetaOperacionalVersion: OPERATIONAL_NET_PROFIT_MODEL_VERSION,
    agrupacionMonetaria: "POR_MONEDA_SIN_FX",
    periodo: normalizedPeriod,
    grupos: [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, group]) => finalizeGroup(group, generalAlerts)),
    alertasGenerales: generalAlerts,
  };
}
