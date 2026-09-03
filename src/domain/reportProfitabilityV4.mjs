import {
  calculateSaleCommercialMarginV1,
  SALE_COMMERCIAL_MARGIN_STATUS,
} from "./saleCommercialMargin.mjs";

export const REPORT_PROFITABILITY_V4_MODEL_VERSION = 1;

export const REPORT_PROFITABILITY_V4_BLOCK = Object.freeze({
  COMMERCIAL_SALES: "COMMERCIAL_SALES",
  PROJECT_PROFITABILITY: "PROJECT_PROFITABILITY",
});

export const REPORT_PROFITABILITY_COVERAGE = Object.freeze({
  EMPTY: "SIN_DATOS",
  COMPLETE: "COMPLETO",
  PARTIAL: "PARCIAL",
  UNAVAILABLE: "NO_DISPONIBLE",
  NOT_APPLICABLE: "NO_APLICA",
});

export const REPORT_SALE_PROJECT_SEGMENT = Object.freeze({
  WITH_PROJECT: "CON_PROYECTO",
  WITHOUT_PROJECT: "SIN_PROYECTO",
});

export const REPORT_UNASSIGNED_CURRENCY = "SIN_MONEDA";

const PROJECT_BALANCE_STATUS = Object.freeze({
  COMPLETE: "COMPLETO",
  PARTIAL_WITHOUT_SALE: "PARCIAL_SIN_VENTA",
  CURRENCY_MISMATCH: "INCONSISTENTE_MONEDA",
});

const PROJECT_REQUIRED_AMOUNTS = Object.freeze([
  "valorComercial",
  "materiales",
  "horasHombre",
  "gastosDirectos",
  "gastosIndirectos",
  "costoTotal",
  "resultado",
]);

function finiteNumber(value) {
  if (value === "" || value == null) return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function nonNegativeNumber(value) {
  const normalized = finiteNumber(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

function roundMoney(value) {
  const normalized = finiteNumber(value);
  if (normalized === null) return null;
  const rounded = Math.round((normalized + Number.EPSILON) * 100) / 100;
  return Number.isFinite(rounded) ? rounded : null;
}

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

function addAmount(accumulator, field, value) {
  if (accumulator.invalidAggregate) return;
  const normalized = finiteNumber(value);
  const next = normalized === null ? null : accumulator[field] + normalized;
  if (next === null || !Number.isFinite(next) || Math.abs(next) > Number.MAX_SAFE_INTEGER) {
    accumulator.invalidAggregate = true;
    return;
  }
  accumulator[field] = next;
}

function emptySaleCounts() {
  return {
    ventasConfirmadas: 0,
    ventasConProductos: 0,
    ventasCompletas: 0,
    ventasParciales: 0,
    ventasNoDisponibles: 0,
    ventasMonedaInconsistente: 0,
    ventasSoloServicios: 0,
    ventasNetoConocido: 0,
    ventasNetoNoDisponible: 0,
    ventasConProyecto: 0,
    ventasSinProyecto: 0,
  };
}

function createSaleAccumulator() {
  return {
    ...emptySaleCounts(),
    ventasNetasConfirmadasConocidas: 0,
    ingresoNetoProductosCubiertos: 0,
    costoHistoricoProductosCubiertos: 0,
    margenBrutoProductosCubiertos: 0,
    invalidAggregate: false,
  };
}

function registerSaleStatus(accumulator, status) {
  accumulator.ventasConfirmadas += 1;
  if (status === SALE_COMMERCIAL_MARGIN_STATUS.NOT_APPLICABLE) {
    accumulator.ventasSoloServicios += 1;
    return;
  }

  accumulator.ventasConProductos += 1;
  if (status === SALE_COMMERCIAL_MARGIN_STATUS.COMPLETE) {
    accumulator.ventasCompletas += 1;
  } else if (status === SALE_COMMERCIAL_MARGIN_STATUS.PARTIAL) {
    accumulator.ventasParciales += 1;
  } else if (status === SALE_COMMERCIAL_MARGIN_STATUS.CURRENCY_MISMATCH) {
    accumulator.ventasMonedaInconsistente += 1;
  } else {
    accumulator.ventasNoDisponibles += 1;
  }
}

function registerSale(accumulator, sale, margin, {aggregable = true} = {}) {
  registerSaleStatus(accumulator, margin.estado);

  const netRevenue = nonNegativeNumber(sale?.neto);
  if (netRevenue === null) {
    accumulator.ventasNetoNoDisponible += 1;
  } else {
    accumulator.ventasNetoConocido += 1;
    if (aggregable) addAmount(accumulator, "ventasNetasConfirmadasConocidas", netRevenue);
  }

  const hasProject = Boolean(String(sale?.trabajoId || "").trim());
  accumulator[hasProject ? "ventasConProyecto" : "ventasSinProyecto"] += 1;

  if (aggregable && margin.estado === SALE_COMMERCIAL_MARGIN_STATUS.COMPLETE) {
    addAmount(accumulator, "ingresoNetoProductosCubiertos", margin.ingresoNetoProductos);
    addAmount(accumulator, "costoHistoricoProductosCubiertos", margin.costoHistoricoProductos);
    addAmount(accumulator, "margenBrutoProductosCubiertos", margin.margenBrutoProductos);
  }
}

function commercialCoverage(accumulator, {truncated = false} = {}) {
  let state = REPORT_PROFITABILITY_COVERAGE.EMPTY;
  if (truncated) {
    state = REPORT_PROFITABILITY_COVERAGE.PARTIAL;
  } else if (accumulator.ventasConfirmadas === 0) {
    state = REPORT_PROFITABILITY_COVERAGE.EMPTY;
  } else if (accumulator.ventasConProductos === 0) {
    state = REPORT_PROFITABILITY_COVERAGE.NOT_APPLICABLE;
  } else if (accumulator.ventasCompletas === accumulator.ventasConProductos) {
    state = REPORT_PROFITABILITY_COVERAGE.COMPLETE;
  } else if (accumulator.ventasCompletas > 0) {
    state = REPORT_PROFITABILITY_COVERAGE.PARTIAL;
  } else {
    state = REPORT_PROFITABILITY_COVERAGE.UNAVAILABLE;
  }

  return {
    estado: state,
    totalObjetivo: accumulator.ventasConProductos,
    completas: accumulator.ventasCompletas,
    parciales: accumulator.ventasParciales,
    noDisponibles: accumulator.ventasNoDisponibles,
    monedaInconsistente: accumulator.ventasMonedaInconsistente,
    soloServicios: accumulator.ventasSoloServicios,
    lecturaTruncada: Boolean(truncated),
    definitivo: !truncated && [
      REPORT_PROFITABILITY_COVERAGE.COMPLETE,
      REPORT_PROFITABILITY_COVERAGE.NOT_APPLICABLE,
      REPORT_PROFITABILITY_COVERAGE.EMPTY,
    ].includes(state),
  };
}

function netRevenueCoverage(accumulator, {aggregable = true, truncated = false} = {}) {
  let state = REPORT_PROFITABILITY_COVERAGE.EMPTY;
  if (truncated) {
    state = REPORT_PROFITABILITY_COVERAGE.PARTIAL;
  } else if (accumulator.ventasConfirmadas === 0) {
    state = REPORT_PROFITABILITY_COVERAGE.EMPTY;
  } else if (!aggregable || accumulator.ventasNetoConocido === 0) {
    state = REPORT_PROFITABILITY_COVERAGE.UNAVAILABLE;
  } else if (accumulator.ventasNetoConocido === accumulator.ventasConfirmadas) {
    state = REPORT_PROFITABILITY_COVERAGE.COMPLETE;
  } else {
    state = REPORT_PROFITABILITY_COVERAGE.PARTIAL;
  }

  return {
    estado: state,
    totalObjetivo: accumulator.ventasConfirmadas,
    completas: accumulator.ventasNetoConocido,
    noDisponibles: accumulator.ventasNetoNoDisponible,
    lecturaTruncada: Boolean(truncated),
    definitivo: aggregable && !truncated && [
      REPORT_PROFITABILITY_COVERAGE.COMPLETE,
      REPORT_PROFITABILITY_COVERAGE.EMPTY,
    ].includes(state),
  };
}

function finalizeSalesAccumulator(accumulator, {aggregable = true, truncated = false} = {}) {
  const aggregateIsValid = aggregable && !accumulator.invalidAggregate;
  const hasCoveredMargins = accumulator.ventasCompletas > 0;
  const hasKnownNetRevenue = accumulator.ventasNetoConocido > 0;
  const productRevenue = aggregateIsValid && hasCoveredMargins
    ? roundMoney(accumulator.ingresoNetoProductosCubiertos)
    : null;
  const productMargin = aggregateIsValid && hasCoveredMargins
    ? roundMoney(accumulator.margenBrutoProductosCubiertos)
    : null;
  const percentage = productRevenue > 0 && productMargin !== null
    ? roundMoney((productMargin / productRevenue) * 100)
    : null;
  const coverage = commercialCoverage(accumulator, {truncated});
  const netCoverage = netRevenueCoverage(accumulator, {aggregable, truncated});

  return {
    conteos: Object.fromEntries(
      Object.keys(emptySaleCounts()).map((field) => [field, accumulator[field]])
    ),
    coberturaMargen: coverage,
    coberturaVentasNetas: netCoverage,
    metricas: {
      ventasNetasConfirmadasConocidas: aggregateIsValid && hasKnownNetRevenue
        ? roundMoney(accumulator.ventasNetasConfirmadasConocidas)
        : null,
      ingresoNetoProductosCubiertos: productRevenue,
      costoHistoricoProductosCubiertos: aggregateIsValid && hasCoveredMargins
        ? roundMoney(accumulator.costoHistoricoProductosCubiertos)
        : null,
      margenBrutoProductosCubiertos: productMargin,
      margenBrutoProductosPct: percentage,
      ventasNetasEsTotal: netCoverage.definitivo,
      margenCubiertoEsTotal: aggregateIsValid && hasCoveredMargins &&
        coverage.estado === REPORT_PROFITABILITY_COVERAGE.COMPLETE,
    },
    agregacionValida: aggregateIsValid,
  };
}

function createSalesCurrencyBucket(currency) {
  return {
    moneda: currency || null,
    agregable: Boolean(currency),
    total: createSaleAccumulator(),
    segmentos: {
      [REPORT_SALE_PROJECT_SEGMENT.WITH_PROJECT]: createSaleAccumulator(),
      [REPORT_SALE_PROJECT_SEGMENT.WITHOUT_PROJECT]: createSaleAccumulator(),
    },
  };
}

function finalizeSalesCurrencyBucket(bucket, options) {
  return {
    moneda: bucket.moneda,
    agregable: bucket.agregable,
    ...finalizeSalesAccumulator(bucket.total, {...options, aggregable: bucket.agregable}),
    segmentos: {
      [REPORT_SALE_PROJECT_SEGMENT.WITH_PROJECT]: finalizeSalesAccumulator(
        bucket.segmentos[REPORT_SALE_PROJECT_SEGMENT.WITH_PROJECT],
        {...options, aggregable: bucket.agregable}
      ),
      [REPORT_SALE_PROJECT_SEGMENT.WITHOUT_PROJECT]: finalizeSalesAccumulator(
        bucket.segmentos[REPORT_SALE_PROJECT_SEGMENT.WITHOUT_PROJECT],
        {...options, aggregable: bucket.agregable}
      ),
    },
  };
}

export function aggregateCommercialSalesV4(sales = [], {truncated = false} = {}) {
  const records = Array.isArray(sales) ? sales : [];
  const buckets = new Map();
  const overall = createSaleAccumulator();
  let pending = 0;
  let canceled = 0;

  records.forEach((sale) => {
    const margin = calculateSaleCommercialMarginV1(sale);
    if (margin.estado === SALE_COMMERCIAL_MARGIN_STATUS.PENDING) {
      pending += 1;
      return;
    }
    if (margin.estado === SALE_COMMERCIAL_MARGIN_STATUS.CANCELED) {
      canceled += 1;
      return;
    }

    const currency = normalizeCurrency(margin.moneda);
    const key = currency || REPORT_UNASSIGNED_CURRENCY;
    if (!buckets.has(key)) buckets.set(key, createSalesCurrencyBucket(currency));
    const bucket = buckets.get(key);
    const segment = String(sale?.trabajoId || "").trim()
      ? REPORT_SALE_PROJECT_SEGMENT.WITH_PROJECT
      : REPORT_SALE_PROJECT_SEGMENT.WITHOUT_PROJECT;
    registerSale(bucket.total, sale, margin, {aggregable: bucket.agregable});
    registerSale(bucket.segmentos[segment], sale, margin, {aggregable: bucket.agregable});
    registerSale(overall, sale, margin, {aggregable: false});
  });

  const groups = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, bucket]) => finalizeSalesCurrencyBucket(bucket, {truncated}));

  return {
    modeloReportesRentabilidadVersion: REPORT_PROFITABILITY_V4_MODEL_VERSION,
    bloque: REPORT_PROFITABILITY_V4_BLOCK.COMMERCIAL_SALES,
    agrupacionMonetaria: "POR_MONEDA_SIN_FX",
    grupos: groups,
    cobertura: commercialCoverage(overall, {truncated}),
    conteos: {
      operacionesRecibidas: records.length,
      pendientes: pending,
      anuladas: canceled,
      ...Object.fromEntries(
        Object.keys(emptySaleCounts()).map((field) => [field, overall[field]])
      ),
    },
  };
}

export function classifyProjectBalanceV4(entry = {}) {
  const hasWrappedBalance = Boolean(
    entry && typeof entry === "object" && !Array.isArray(entry) &&
    Object.prototype.hasOwnProperty.call(entry, "balance")
  );
  const balance = hasWrappedBalance ? entry.balance : entry;
  const projectId = String(
    entry?.trabajoId || entry?.id || balance?.trabajoId || ""
  ).trim();
  const operationalStatus = hasWrappedBalance ? String(entry?.estado || "").trim() : "";
  const balanceStatus = String(balance?.estado || "").trim().toUpperCase();
  const currency = normalizeCurrency(balance?.moneda);
  const base = {
    proyectoId: projectId,
    estadoOperacional: operationalStatus,
    estadoBalance: balanceStatus,
    moneda: currency || null,
    incluible: false,
  };

  if (!balance || typeof balance !== "object" || Array.isArray(balance) || !currency) {
    return {
      ...base,
      cobertura: REPORT_PROFITABILITY_COVERAGE.UNAVAILABLE,
      motivo: "ESTRUCTURA_INVALIDA",
    };
  }
  if (balanceStatus === PROJECT_BALANCE_STATUS.CURRENCY_MISMATCH) {
    return {
      ...base,
      cobertura: REPORT_PROFITABILITY_COVERAGE.UNAVAILABLE,
      motivo: "MONEDA_INCONSISTENTE",
    };
  }
  if (balanceStatus === PROJECT_BALANCE_STATUS.PARTIAL_WITHOUT_SALE) {
    return {
      ...base,
      cobertura: REPORT_PROFITABILITY_COVERAGE.PARTIAL,
      motivo: "SIN_VENTA_CONFIRMADA",
    };
  }
  if (balanceStatus !== PROJECT_BALANCE_STATUS.COMPLETE) {
    return {
      ...base,
      cobertura: REPORT_PROFITABILITY_COVERAGE.UNAVAILABLE,
      motivo: "ESTADO_BALANCE_NO_SOPORTADO",
    };
  }

  const amounts = Object.fromEntries(
    PROJECT_REQUIRED_AMOUNTS.map((field) => [field, finiteNumber(balance[field])])
  );
  const validAmounts = PROJECT_REQUIRED_AMOUNTS.every((field) => {
    if (amounts[field] === null) return false;
    return field === "resultado" || amounts[field] >= 0;
  });
  if (!validAmounts) {
    return {
      ...base,
      cobertura: REPORT_PROFITABILITY_COVERAGE.UNAVAILABLE,
      motivo: "IMPORTES_NO_FINITOS",
    };
  }

  const missingSaleMaterialCosts = nonNegativeNumber(
    balance?.fuentes?.materialesVentaSinCosto
  );
  if (missingSaleMaterialCosts === null) {
    return {
      ...base,
      cobertura: REPORT_PROFITABILITY_COVERAGE.UNAVAILABLE,
      motivo: "ESTRUCTURA_FUENTES_INVALIDA",
    };
  }
  if (missingSaleMaterialCosts > 0) {
    return {
      ...base,
      cobertura: REPORT_PROFITABILITY_COVERAGE.PARTIAL,
      motivo: "COSTO_HISTORICO_MATERIALES_INCOMPLETO",
    };
  }

  return {
    ...base,
    cobertura: REPORT_PROFITABILITY_COVERAGE.COMPLETE,
    motivo: "BALANCE_CONFIABLE",
    incluible: true,
    importes: amounts,
  };
}

function createProjectAccumulator() {
  return {
    proyectos: 0,
    completos: 0,
    parciales: 0,
    noDisponibles: 0,
    conGanancia: 0,
    conPerdida: 0,
    neutros: 0,
    valorComercial: 0,
    materiales: 0,
    horasHombre: 0,
    gastosDirectos: 0,
    gastosIndirectos: 0,
    costoTotal: 0,
    resultado: 0,
    invalidAggregate: false,
  };
}

function registerProjectClassification(
  accumulator,
  classification,
  {aggregateAmounts = true} = {}
) {
  accumulator.proyectos += 1;
  if (classification.cobertura === REPORT_PROFITABILITY_COVERAGE.PARTIAL) {
    accumulator.parciales += 1;
    return;
  }
  if (!classification.incluible) {
    accumulator.noDisponibles += 1;
    return;
  }

  accumulator.completos += 1;
  if (classification.importes.resultado > 0) accumulator.conGanancia += 1;
  else if (classification.importes.resultado < 0) accumulator.conPerdida += 1;
  else accumulator.neutros += 1;
  if (aggregateAmounts) {
    PROJECT_REQUIRED_AMOUNTS.forEach((field) => {
      addAmount(accumulator, field, classification.importes[field]);
    });
  }
}

function projectCoverage(accumulator) {
  let state = REPORT_PROFITABILITY_COVERAGE.EMPTY;
  if (accumulator.proyectos === 0) {
    state = REPORT_PROFITABILITY_COVERAGE.EMPTY;
  } else if (accumulator.completos === accumulator.proyectos) {
    state = REPORT_PROFITABILITY_COVERAGE.COMPLETE;
  } else if (accumulator.completos > 0 || accumulator.parciales > 0) {
    state = REPORT_PROFITABILITY_COVERAGE.PARTIAL;
  } else {
    state = REPORT_PROFITABILITY_COVERAGE.UNAVAILABLE;
  }
  return {
    estado: state,
    totalObjetivo: accumulator.proyectos,
    completas: accumulator.completos,
    parciales: accumulator.parciales,
    noDisponibles: accumulator.noDisponibles,
    definitivo: [
      REPORT_PROFITABILITY_COVERAGE.COMPLETE,
      REPORT_PROFITABILITY_COVERAGE.EMPTY,
    ].includes(state),
  };
}

function finalizeProjectAccumulator(accumulator, {aggregable = true} = {}) {
  const aggregateIsValid = aggregable && !accumulator.invalidAggregate;
  const hasCompleteBalances = accumulator.completos > 0;
  const revenue = aggregateIsValid && hasCompleteBalances
    ? roundMoney(accumulator.valorComercial)
    : null;
  const result = aggregateIsValid && hasCompleteBalances
    ? roundMoney(accumulator.resultado)
    : null;
  return {
    conteos: {
      proyectos: accumulator.proyectos,
      completos: accumulator.completos,
      parciales: accumulator.parciales,
      noDisponibles: accumulator.noDisponibles,
      conGanancia: accumulator.conGanancia,
      conPerdida: accumulator.conPerdida,
      neutros: accumulator.neutros,
    },
    cobertura: projectCoverage(accumulator),
    metricas: {
      valorComercial: revenue,
      materiales: aggregateIsValid && hasCompleteBalances
        ? roundMoney(accumulator.materiales)
        : null,
      horasHombre: aggregateIsValid && hasCompleteBalances
        ? roundMoney(accumulator.horasHombre)
        : null,
      gastosDirectos: aggregateIsValid && hasCompleteBalances
        ? roundMoney(accumulator.gastosDirectos)
        : null,
      gastosIndirectos: aggregateIsValid && hasCompleteBalances
        ? roundMoney(accumulator.gastosIndirectos)
        : null,
      costoRegistrado: aggregateIsValid && hasCompleteBalances
        ? roundMoney(accumulator.costoTotal)
        : null,
      resultado: result,
      rentabilidadPct: revenue > 0 && result !== null
        ? roundMoney((result / revenue) * 100)
        : null,
      balanceEsTotal: aggregateIsValid && hasCompleteBalances &&
        projectCoverage(accumulator).estado === REPORT_PROFITABILITY_COVERAGE.COMPLETE,
    },
    agregacionValida: aggregateIsValid,
  };
}

export function aggregateProjectProfitabilityV4(projectBalances = []) {
  const records = Array.isArray(projectBalances) ? projectBalances : [];
  const buckets = new Map();
  const overall = createProjectAccumulator();

  records.forEach((entry) => {
    const classification = classifyProjectBalanceV4(entry);
    const key = classification.moneda || REPORT_UNASSIGNED_CURRENCY;
    if (!buckets.has(key)) {
      buckets.set(key, {
        moneda: classification.moneda,
        agregable: Boolean(classification.moneda),
        accumulator: createProjectAccumulator(),
      });
    }
    const bucket = buckets.get(key);
    registerProjectClassification(bucket.accumulator, classification);
    registerProjectClassification(overall, classification, {aggregateAmounts: false});
  });

  const groups = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, bucket]) => ({
      moneda: bucket.moneda,
      agregable: bucket.agregable,
      ...finalizeProjectAccumulator(bucket.accumulator, {aggregable: bucket.agregable}),
    }));

  return {
    modeloReportesRentabilidadVersion: REPORT_PROFITABILITY_V4_MODEL_VERSION,
    bloque: REPORT_PROFITABILITY_V4_BLOCK.PROJECT_PROFITABILITY,
    agrupacionMonetaria: "POR_MONEDA_SIN_FX",
    grupos: groups,
    cobertura: projectCoverage(overall),
    conteos: {
      proyectosRecibidos: records.length,
      completos: overall.completos,
      parciales: overall.parciales,
      noDisponibles: overall.noDisponibles,
      conGanancia: overall.conGanancia,
      conPerdida: overall.conPerdida,
      neutros: overall.neutros,
    },
  };
}

export function buildProfitabilityReportV4({
  sales = [],
  projectBalances = [],
  salesTruncated = false,
} = {}) {
  return {
    modeloReportesRentabilidadVersion: REPORT_PROFITABILITY_V4_MODEL_VERSION,
    agrupacionMonetaria: "POR_MONEDA_SIN_FX",
    bloques: {
      [REPORT_PROFITABILITY_V4_BLOCK.COMMERCIAL_SALES]: aggregateCommercialSalesV4(
        sales,
        {truncated: salesTruncated}
      ),
      [REPORT_PROFITABILITY_V4_BLOCK.PROJECT_PROFITABILITY]:
        aggregateProjectProfitabilityV4(projectBalances),
    },
  };
}
