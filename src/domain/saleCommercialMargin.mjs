export const SALE_COMMERCIAL_MARGIN_MODEL_VERSION = 1;

export const SALE_COMMERCIAL_MARGIN_STATUS = Object.freeze({
  PENDING: "PENDIENTE",
  CANCELED: "ANULADA",
  NOT_APPLICABLE: "NO_APLICA",
  COMPLETE: "COMPLETO",
  PARTIAL: "PARCIAL",
  UNAVAILABLE: "NO_DISPONIBLE",
  CURRENCY_MISMATCH: "INCONSISTENTE_MONEDA",
});

const CONFIRMED_STATES = new Set(["confirmada", "confirmado", "activa", "activo"]);
const CANCELED_STATES = new Set(["cancelada", "cancelado", "anulada", "anulado"]);
const ITEM_TYPES = new Set(["producto", "servicio", "actividad"]);
const QUANTITY_EPSILON = 0.000001;

function finiteNumber(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1000000) / 1000000;
}

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

function normalizeLine(raw = {}, index = 0) {
  const snapshot = raw.inventarioSnapshot || {};
  const type = String(raw.tipoItem || snapshot.tipoItem || "").trim().toLowerCase();
  const quantity = finiteNumber(raw.cantidad);
  const unitPrice = nonNegativeNumber(raw.precioUnitario);
  const discountRate = nonNegativeNumber(raw.descuentoPct ?? 0);
  if (
    !ITEM_TYPES.has(type) || quantity === null || quantity <= 0 ||
    unitPrice === null || discountRate === null || discountRate > 100
  ) {
    return null;
  }
  const lineSubtotal = Math.round(quantity * unitPrice);
  const lineDiscount = Math.round((lineSubtotal * discountRate) / 100);
  const lineTotal = lineSubtotal - lineDiscount;
  if (![lineSubtotal, lineDiscount, lineTotal].every(Number.isSafeInteger)) return null;
  return {
    index,
    lineaId: String(raw.lineaId || "").trim(),
    itemId: String(raw.itemId || snapshot.inventarioId || "").trim(),
    tipoItem: type,
    cantidad: quantity,
    subtotalLinea: lineSubtotal,
    descuentoLinea: lineDiscount,
    totalLinea: lineTotal,
  };
}

function commercialAmounts(sale = {}) {
  const rawLines = Array.isArray(sale.items) ? sale.items : [];
  const lines = rawLines.map(normalizeLine);
  const fallbackNetRevenue = nonNegativeNumber(sale.neto);
  if (!lines.length || lines.some((line) => !line)) {
    return {
      valid: false,
      lines: [],
      ingresoNetoVenta: fallbackNetRevenue,
      ingresoNetoProductos: null,
      subtotalProductos: null,
      descuentoItemsProductos: null,
      descuentoGeneralProductos: null,
    };
  }

  const subtotal = lines.reduce((sum, line) => sum + line.subtotalLinea, 0);
  const itemDiscount = lines.reduce((sum, line) => sum + line.descuentoLinea, 0);
  const saleBase = subtotal - itemDiscount;
  const generalDiscount = nonNegativeNumber(sale.descuento ?? 0);
  if (
    !Number.isSafeInteger(subtotal) || !Number.isSafeInteger(itemDiscount) ||
    !Number.isSafeInteger(saleBase) || generalDiscount === null ||
    !Number.isSafeInteger(generalDiscount) || generalDiscount > saleBase
  ) {
    return {
      valid: false,
      lines,
      ingresoNetoVenta: fallbackNetRevenue,
      ingresoNetoProductos: null,
      subtotalProductos: null,
      descuentoItemsProductos: null,
      descuentoGeneralProductos: null,
    };
  }

  const productLines = lines.filter((line) => line.tipoItem === "producto");
  const productSubtotal = productLines.reduce((sum, line) => sum + line.subtotalLinea, 0);
  const productItemDiscount = productLines.reduce((sum, line) => sum + line.descuentoLinea, 0);
  const productBase = productSubtotal - productItemDiscount;
  const productGeneralDiscount = saleBase > 0
    ? Math.round((generalDiscount * productBase) / saleBase)
    : 0;
  const saleNetRevenue = saleBase - generalDiscount;
  const productNetRevenue = productBase - productGeneralDiscount;
  const persistedNetRevenue = nonNegativeNumber(sale.neto);
  const reconciles = persistedNetRevenue === null ||
    Math.abs(persistedNetRevenue - saleNetRevenue) <= 0.01;

  return {
    valid: reconciles,
    lines,
    productLines,
    ingresoNetoVenta: saleNetRevenue,
    ingresoNetoProductos: productNetRevenue,
    subtotalProductos: productSubtotal,
    descuentoItemsProductos: productItemDiscount,
    descuentoGeneralProductos: productGeneralDiscount,
  };
}

function baseResult(sale, amounts, status, overrides = {}) {
  const productLines = amounts.productLines || [];
  return {
    modeloMargenVentaVersion: SALE_COMMERCIAL_MARGIN_MODEL_VERSION,
    estado: status,
    incluible: status === SALE_COMMERCIAL_MARGIN_STATUS.COMPLETE,
    moneda: normalizeCurrency(sale?.moneda),
    ingresoNetoVenta: amounts.ingresoNetoVenta,
    ingresoNetoProductos: amounts.ingresoNetoProductos,
    costoHistoricoProductos: null,
    costoHistoricoCubierto: 0,
    margenBrutoProductos: null,
    margenBrutoPct: null,
    productos: {
      lineas: productLines.length,
      lineasCubiertas: 0,
      cantidadVendida: roundQuantity(productLines.reduce((sum, line) => sum + line.cantidad, 0)),
      cantidadCubierta: 0,
    },
    asignacionDescuentos: {
      subtotalProductos: amounts.subtotalProductos,
      descuentoItemsProductos: amounts.descuentoItemsProductos,
      descuentoGeneralProductos: amounts.descuentoGeneralProductos,
    },
    ...overrides,
  };
}

export function calculateSaleCommercialMarginV1(sale = {}) {
  const amounts = commercialAmounts(sale);
  const state = String(sale.estado || "").trim().toLowerCase();

  if (CANCELED_STATES.has(state)) {
    return baseResult(sale, amounts, SALE_COMMERCIAL_MARGIN_STATUS.CANCELED);
  }
  if (!CONFIRMED_STATES.has(state)) {
    return baseResult(sale, amounts, SALE_COMMERCIAL_MARGIN_STATUS.PENDING);
  }
  if (!amounts.valid) {
    return baseResult(sale, amounts, SALE_COMMERCIAL_MARGIN_STATUS.UNAVAILABLE);
  }

  const productLines = amounts.productLines;
  if (!productLines.length) {
    return baseResult(sale, amounts, SALE_COMMERCIAL_MARGIN_STATUS.NOT_APPLICABLE);
  }

  const saleCurrency = normalizeCurrency(sale.moneda);
  if (!saleCurrency || productLines.some((line) => !line.lineaId || !line.itemId)) {
    return baseResult(sale, amounts, SALE_COMMERCIAL_MARGIN_STATUS.UNAVAILABLE);
  }

  const coverageByLine = new Map(productLines.map((line) => [line.lineaId, {
    cantidad: 0,
    costo: 0,
    invalid: false,
    line,
  }]));
  const seenMovements = new Set();
  let hasAnomaly = false;
  let hasCurrencyMismatch = false;

  (Array.isArray(sale.efectosInventario) ? sale.efectosInventario : [])
    .forEach((effect = {}) => {
      const lineId = String(effect.lineaId || "").trim();
      const coverage = coverageByLine.get(lineId);
      if (!coverage) {
        hasAnomaly = true;
        return;
      }

      const movementId = String(effect.movimientoId || "").trim();
      if (movementId && seenMovements.has(movementId)) {
        coverage.invalid = true;
        hasAnomaly = true;
        return;
      }
      if (movementId) seenMovements.add(movementId);

      const effectItemId = String(effect.itemId || "").trim();
      if (effectItemId && effectItemId !== coverage.line.itemId) {
        coverage.invalid = true;
        hasAnomaly = true;
        return;
      }

      const explicitCurrency = normalizeCurrency(effect.moneda);
      if (explicitCurrency && explicitCurrency !== saleCurrency) {
        hasCurrencyMismatch = true;
        return;
      }

      const quantity = finiteNumber(effect.cantidad);
      const unitCost = nonNegativeNumber(effect.costoUnitario);
      const totalCost = nonNegativeNumber(effect.costoTotal);
      const costAvailable = effect.costoHistoricoDisponible !== false &&
        quantity !== null && quantity > 0 && unitCost !== null && totalCost !== null;
      if (!costAvailable) {
        coverage.invalid = true;
        hasAnomaly = true;
        return;
      }

      coverage.cantidad += quantity;
      coverage.costo = roundMoney(coverage.costo + totalCost);
      if (coverage.cantidad - coverage.line.cantidad > QUANTITY_EPSILON) {
        coverage.invalid = true;
        hasAnomaly = true;
      }
    });

  const coverage = [...coverageByLine.values()];
  const coveredLines = coverage.filter((entry) =>
    !entry.invalid && Math.abs(entry.cantidad - entry.line.cantidad) <= QUANTITY_EPSILON
  );
  const coveredQuantity = coverage.reduce((sum, entry) => sum + entry.cantidad, 0);
  const coveredCost = roundMoney(coverage.reduce((sum, entry) => sum + entry.costo, 0));
  const coverageSummary = {
    lineas: productLines.length,
    lineasCubiertas: coveredLines.length,
    cantidadVendida: roundQuantity(productLines.reduce((sum, line) => sum + line.cantidad, 0)),
    cantidadCubierta: roundQuantity(coveredQuantity),
  };

  if (hasCurrencyMismatch) {
    return baseResult(sale, amounts, SALE_COMMERCIAL_MARGIN_STATUS.CURRENCY_MISMATCH, {
      costoHistoricoCubierto: coveredCost,
      productos: coverageSummary,
    });
  }

  const complete = !hasAnomaly && coveredLines.length === productLines.length;
  if (!complete) {
    const status = coveredQuantity > QUANTITY_EPSILON
      ? SALE_COMMERCIAL_MARGIN_STATUS.PARTIAL
      : SALE_COMMERCIAL_MARGIN_STATUS.UNAVAILABLE;
    return baseResult(sale, amounts, status, {
      costoHistoricoCubierto: coveredCost,
      productos: coverageSummary,
    });
  }

  const historicalCost = coveredCost;
  const productMargin = roundMoney(amounts.ingresoNetoProductos - historicalCost);
  const marginPercentage = amounts.ingresoNetoProductos > 0
    ? roundMoney((productMargin / amounts.ingresoNetoProductos) * 100)
    : null;
  return baseResult(sale, amounts, SALE_COMMERCIAL_MARGIN_STATUS.COMPLETE, {
    costoHistoricoProductos: historicalCost,
    costoHistoricoCubierto: historicalCost,
    margenBrutoProductos: productMargin,
    margenBrutoPct: marginPercentage,
    productos: coverageSummary,
  });
}
