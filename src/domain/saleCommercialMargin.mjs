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

// Evaluación compartida por el resultado V1 y por su desagregación por línea:
// ambos salen del mismo `amounts` y de la misma cobertura por línea.
function evaluateSaleCommercialMargin(sale = {}) {
  const amounts = commercialAmounts(sale);
  const state = String(sale.estado || "").trim().toLowerCase();
  const finish = (status, overrides = {}, coverageByLine = null) => ({
    result: baseResult(sale, amounts, status, overrides),
    amounts,
    coverageByLine,
  });

  if (CANCELED_STATES.has(state)) {
    return finish(SALE_COMMERCIAL_MARGIN_STATUS.CANCELED);
  }
  if (!CONFIRMED_STATES.has(state)) {
    return finish(SALE_COMMERCIAL_MARGIN_STATUS.PENDING);
  }
  if (!amounts.valid) {
    return finish(SALE_COMMERCIAL_MARGIN_STATUS.UNAVAILABLE);
  }

  const productLines = amounts.productLines;
  if (!productLines.length) {
    return finish(SALE_COMMERCIAL_MARGIN_STATUS.NOT_APPLICABLE);
  }

  const saleCurrency = normalizeCurrency(sale.moneda);
  if (!saleCurrency || productLines.some((line) => !line.lineaId || !line.itemId)) {
    return finish(SALE_COMMERCIAL_MARGIN_STATUS.UNAVAILABLE);
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
    return finish(SALE_COMMERCIAL_MARGIN_STATUS.CURRENCY_MISMATCH, {
      costoHistoricoCubierto: coveredCost,
      productos: coverageSummary,
    });
  }

  const complete = !hasAnomaly && coveredLines.length === productLines.length;
  if (!complete) {
    const status = coveredQuantity > QUANTITY_EPSILON
      ? SALE_COMMERCIAL_MARGIN_STATUS.PARTIAL
      : SALE_COMMERCIAL_MARGIN_STATUS.UNAVAILABLE;
    return finish(status, {
      costoHistoricoCubierto: coveredCost,
      productos: coverageSummary,
    });
  }

  const historicalCost = coveredCost;
  const productMargin = roundMoney(amounts.ingresoNetoProductos - historicalCost);
  const marginPercentage = amounts.ingresoNetoProductos > 0
    ? roundMoney((productMargin / amounts.ingresoNetoProductos) * 100)
    : null;
  return finish(SALE_COMMERCIAL_MARGIN_STATUS.COMPLETE, {
    costoHistoricoProductos: historicalCost,
    costoHistoricoCubierto: historicalCost,
    margenBrutoProductos: productMargin,
    margenBrutoPct: marginPercentage,
    productos: coverageSummary,
  }, coverageByLine);
}

export function calculateSaleCommercialMarginV1(sale = {}) {
  return evaluateSaleCommercialMargin(sale).result;
}

// Reparte un descuento entero entre bases enteras por resto mayor: la suma
// asignada es exactamente `total`. Empates por orden de línea.
function allocateIntegerProportionally(total, bases) {
  const baseSum = bases.reduce((sum, value) => sum + value, 0);
  if (!total || baseSum <= 0) return bases.map(() => 0);
  const shares = bases.map((base, index) => {
    const exact = (total * base) / baseSum;
    const floor = Math.floor(exact);
    return {index, floor, remainder: exact - floor};
  });
  let pending = total - shares.reduce((sum, share) => sum + share.floor, 0);
  [...shares]
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .forEach((share) => {
      if (pending <= 0) return;
      share.floor += 1;
      pending -= 1;
    });
  return shares.map((share) => share.floor);
}

// SPEC 022 §6.5.3: desagregación por línea de producto del margen V1. No
// recalcula la Venta: usa el mismo `amounts` y la misma cobertura que V1, y
// reparte `descuentoGeneralProductos` (ya calculado por V1) entre las líneas
// en proporción a su total de línea. Trabaja en enteros de centavos, por lo
// que la suma de las líneas es exactamente el agregado de la Venta.
export function calculateSaleProductLineMarginsV1(sale = {}) {
  const {result, amounts, coverageByLine} = evaluateSaleCommercialMargin(sale);
  const base = {
    modeloMargenVentaVersion: SALE_COMMERCIAL_MARGIN_MODEL_VERSION,
    estado: result.estado,
    moneda: result.moneda,
    margenBrutoProductos: result.margenBrutoProductos,
    lineas: null,
  };
  if (result.estado !== SALE_COMMERCIAL_MARGIN_STATUS.COMPLETE || !coverageByLine) return base;

  const productLines = amounts.productLines;
  if (new Set(productLines.map((line) => line.lineaId)).size !== productLines.length) {
    return {...base, motivo: "LINEAS_DUPLICADAS"};
  }

  const generalDiscounts = allocateIntegerProportionally(
    amounts.descuentoGeneralProductos,
    productLines.map((line) => line.totalLinea)
  );
  const toCents = (value) => Math.round(Number(value || 0) * 100);
  return {
    ...base,
    lineas: productLines.map((line, position) => {
      const netRevenue = line.totalLinea - generalDiscounts[position];
      const costCents = toCents(coverageByLine.get(line.lineaId).costo);
      return {
        lineaId: line.lineaId,
        itemId: line.itemId,
        cantidad: line.cantidad,
        totalLinea: line.totalLinea,
        descuentoGeneralAsignado: generalDiscounts[position],
        ingresoNeto: netRevenue,
        costoHistorico: costCents / 100,
        margenBruto: (netRevenue * 100 - costCents) / 100,
      };
    }),
  };
}
