import {adaptDocumentAmountDecimals} from "./localization.mjs";
import {isMoneyAmount, mulRound, sumMoney} from "./money.mjs";

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

// Escala del costo y del margen: centavos (100) como siempre, y más fina solo si la venta tuviera más de 2 decimales
// de cálculo (SPEC 036). Con 0 y con 2 decimales es exactamente 100. Los porcentajes usan siempre 2 decimales.
function moneyScale(decimals = 0) {
  return 10 ** Math.max(2, decimals);
}

function roundMoney(value, decimals = 0) {
  const scale = moneyScale(decimals);
  return Math.round((Number(value || 0) + Number.EPSILON) * scale) / scale;
}

function roundQuantity(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1000000) / 1000000;
}

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

// `decimals`: decimales de cálculo de la venta (su `montoDecimales`; 0 = importes enteros, como siempre).
function normalizeLine(raw = {}, index = 0, decimals = 0) {
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
  const lineSubtotal = mulRound(quantity, unitPrice, decimals);
  const lineDiscount = mulRound(lineSubtotal, discountRate, decimals, 100);
  const lineTotal = sumMoney([lineSubtotal, -lineDiscount], decimals);
  if (![lineSubtotal, lineDiscount, lineTotal].every((value) => isMoneyAmount(value, decimals))) return null;
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
  const decimals = adaptDocumentAmountDecimals(sale, sale?.moneda);
  const lines = rawLines.map((line, index) => normalizeLine(line, index, decimals));
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

  const subtotal = sumMoney(lines.map((line) => line.subtotalLinea), decimals);
  const itemDiscount = sumMoney(lines.map((line) => line.descuentoLinea), decimals);
  const saleBase = sumMoney([subtotal, -itemDiscount], decimals);
  const generalDiscount = nonNegativeNumber(sale.descuento ?? 0);
  if (
    !isMoneyAmount(subtotal, decimals) || !isMoneyAmount(itemDiscount, decimals) ||
    !isMoneyAmount(saleBase, decimals) || generalDiscount === null ||
    !isMoneyAmount(generalDiscount, decimals) || generalDiscount > saleBase
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
  const productSubtotal = sumMoney(productLines.map((line) => line.subtotalLinea), decimals);
  const productItemDiscount = sumMoney(productLines.map((line) => line.descuentoLinea), decimals);
  const productBase = sumMoney([productSubtotal, -productItemDiscount], decimals);
  const productGeneralDiscount = saleBase > 0
    ? mulRound(generalDiscount, productBase, decimals, saleBase)
    : 0;
  const saleNetRevenue = sumMoney([saleBase, -generalDiscount], decimals);
  const productNetRevenue = sumMoney([productBase, -productGeneralDiscount], decimals);
  const persistedNetRevenue = nonNegativeNumber(sale.neto);
  // Con 0 decimales la tolerancia es la de siempre (0,01); con decimales, media unidad menor (0,005 en BOB).
  const tolerance = decimals === 0 ? 0.01 : 0.5 * 10 ** -decimals;
  const reconciles = persistedNetRevenue === null ||
    Math.abs(persistedNetRevenue - saleNetRevenue) <= tolerance;

  return {
    valid: reconciles,
    decimals,
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
  const decimals = amounts.decimals ?? 0;
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
      coverage.costo = roundMoney(coverage.costo + totalCost, decimals);
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
  const coveredCost = roundMoney(coverage.reduce((sum, entry) => sum + entry.costo, 0), decimals);
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
  const productMargin = roundMoney(amounts.ingresoNetoProductos - historicalCost, decimals);
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

// Reparte un descuento entre bases por resto mayor, en la unidad menor de la moneda (con 0 decimales, enteros
// como siempre; con 2, centavos): la suma asignada es exactamente `total`. Empates por orden de línea.
function allocateProportionally(total, bases, decimals) {
  if (decimals === 0) return allocateIntegerProportionally(total, bases);
  const scale = 10 ** decimals;
  const toUnits = (value) => Math.round(value * scale);
  return allocateIntegerProportionally(toUnits(total), bases.map(toUnits)).map((units) => units / scale);
}

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

  const decimals = amounts.decimals ?? 0;
  const generalDiscounts = allocateProportionally(
    amounts.descuentoGeneralProductos,
    productLines.map((line) => line.totalLinea),
    decimals
  );
  // Unidad menor del costo y del margen: la escala sale de los decimales de la venta (100 con 0 y con 2 decimales).
  const scale = moneyScale(decimals);
  const toMinorUnits = (value) => Math.round(Number(value || 0) * scale);
  return {
    ...base,
    lineas: productLines.map((line, position) => {
      const netRevenue = sumMoney([line.totalLinea, -generalDiscounts[position]], decimals);
      const costUnits = toMinorUnits(coverageByLine.get(line.lineaId).costo);
      return {
        lineaId: line.lineaId,
        itemId: line.itemId,
        cantidad: line.cantidad,
        totalLinea: line.totalLinea,
        descuentoGeneralAsignado: generalDiscounts[position],
        ingresoNeto: netRevenue,
        costoHistorico: costUnits / scale,
        margenBruto: ((decimals === 0 ? netRevenue * scale : Math.round(netRevenue * scale)) - costUnits) / scale,
      };
    }),
  };
}
