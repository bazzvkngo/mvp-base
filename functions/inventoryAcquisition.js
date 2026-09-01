const DEFAULT_TAX_RATE = 0;
const INVENTORY_ECONOMIC_MODEL_VERSION = 1;
const MAX_INVENTORY_VALUE = 999999999999.99;
const MAX_ATOMIC_INVENTORY_WRITES = 450;
const QUANTITY_DECIMALS = 6;
const QUANTITY_EPSILON = 0.000000001;
const VALUE_EPSILON = 0.005;

function finiteNumber(value, fallback = 0) {
  if (value === "" || value == null) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((finiteNumber(value) + Number.EPSILON) * factor) / factor;
}

function normalizeInventoryQuantity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return parsed;
  const factor = 10 ** QUANTITY_DECIMALS;
  const rounded = Math.round((parsed + Number.EPSILON) * factor) / factor;
  return Math.abs(rounded) <= QUANTITY_EPSILON ? 0 : rounded;
}

function assertCanonicalInventoryQuantity(value, HttpsError, label = "La cantidad") {
  const parsed = Number(value);
  const normalized = normalizeInventoryQuantity(parsed);
  if (!Number.isFinite(parsed) || !Number.isFinite(normalized)) {
    economicFailure(HttpsError, `${label} no es representable.`);
  }
  if (Math.abs(parsed - normalized) > QUANTITY_EPSILON) {
    economicFailure(
      HttpsError,
      `${label} debe representarse con un máximo de ${QUANTITY_DECIMALS} decimales.`
    );
  }
  return normalized;
}

function assertInventoryTransactionWriteBudget({
  acquisitionWrites = 0,
  documentWrites = 0,
  inventoryWrites = 0,
  movementWrites = 0,
  operation = "operación",
}, HttpsError) {
  const counts = [acquisitionWrites, documentWrites, inventoryWrites, movementWrites];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    economicFailure(HttpsError, "No se pudo calcular el presupuesto transaccional de inventario.");
  }
  const requiredWrites = counts.reduce((total, count) => total + count, 0);
  if (requiredWrites > MAX_ATOMIC_INVENTORY_WRITES) {
    economicFailure(
      HttpsError,
      `La ${operation} contiene demasiadas líneas físicas de producto para procesarse de forma atómica. ` +
      "Reduce las líneas de producto y vuelve a intentarlo."
    );
  }
  return requiredWrites;
}

function calculateAcquisitionAmounts({
  cantidad,
  costoUnitario,
  descuentoPct = 0,
  tasaImpuestoCompra = DEFAULT_TAX_RATE,
}) {
  const quantity = normalizeInventoryQuantity(Math.max(finiteNumber(cantidad), 0));
  const unitCost = Math.max(finiteNumber(costoUnitario), 0);
  const discountRate = Math.min(Math.max(finiteNumber(descuentoPct), 0), 100);
  const taxRate = Math.min(
    Math.max(finiteNumber(tasaImpuestoCompra, DEFAULT_TAX_RATE), 0),
    100
  );
  const netUnitCost = round(unitCost * (1 - discountRate / 100), 4);
  const unitTax = round(netUnitCost * taxRate / 100, 4);
  const paidUnitCost = round(netUnitCost + unitTax, 4);

  return {
    cantidad: quantity,
    costoUnitario: unitCost,
    descuentoPct: discountRate,
    costoUnitarioNeto: netUnitCost,
    tasaImpuestoCompra: taxRate,
    impuestoCompraUnitario: unitTax,
    impuestoCompraTotal: round(unitTax * quantity),
    costoPagadoUnitario: paidUnitCost,
    costoPagadoTotal: round(paidUnitCost * quantity),
  };
}

function calculateWeightedAverage({
  stockAnterior,
  costoPromedioAnterior,
  cantidadEntrada,
  costoEntrada,
}) {
  const previousStock = Math.max(finiteNumber(stockAnterior), 0);
  const previousAverage = Math.max(finiteNumber(costoPromedioAnterior), 0);
  const incomingQuantity = Math.max(finiteNumber(cantidadEntrada), 0);
  const incomingCost = Math.max(finiteNumber(costoEntrada), 0);
  const resultingStock = previousStock + incomingQuantity;
  if (resultingStock <= 0) return 0;
  return round(
    (previousStock * previousAverage + incomingQuantity * incomingCost) /
      resultingStock,
    4
  );
}

function legacyPaidCost(item = {}) {
  const storedAverage = finiteNumber(item.costoPromedio, NaN);
  if (Number.isFinite(storedAverage) && storedAverage >= 0) return storedAverage;
  const storedPaidCost = finiteNumber(item.costoPagado, NaN);
  if (Number.isFinite(storedPaidCost) && storedPaidCost >= 0) return storedPaidCost;
  const baseCost = Math.max(
    finiteNumber(item.costoBase ?? item.costo ?? item.precioCompra, 0),
    0
  );
  const taxRate = Math.min(
    Math.max(finiteNumber(item.tasaImpuestoCompra, DEFAULT_TAX_RATE), 0),
    100
  );
  return round(baseCost * (1 + taxRate / 100), 4);
}

function validStoredNumber(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizedCurrency(value) {
  const candidate = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(candidate) ? candidate : "";
}

function economicFailure(HttpsError, message) {
  if (HttpsError) throw new HttpsError("failed-precondition", message);
  const error = new Error(message);
  error.code = "failed-precondition";
  throw error;
}

function legacyCostDescriptor(item = {}) {
  const average = validStoredNumber(item.costoPromedio);
  if (average !== null) return {cost: average, source: "costoPromedio"};
  const paid = validStoredNumber(item.costoPagado);
  if (paid !== null) return {cost: paid, source: "costoPagado"};
  const candidates = [
    ["costoBase", item.costoBase],
    ["costo", item.costo],
    ["precioCompra", item.precioCompra],
  ];
  const selected = candidates.find(([, value]) => validStoredNumber(value) !== null);
  return selected ? {cost: legacyPaidCost(item), source: selected[0]} : null;
}

function resolveInventoryEconomicState({item = {}, operationCurrency = ""}, HttpsError) {
  const rawStock = Number(item.stock || 0);
  const stock = assertCanonicalInventoryQuantity(rawStock, HttpsError, "El stock");
  if (
    !Number.isFinite(stock) || rawStock < -QUANTITY_EPSILON ||
    stock < 0 || Math.abs(stock) > Number.MAX_SAFE_INTEGER
  ) {
    economicFailure(HttpsError, "El stock no permite inicializar su saldo económico de forma segura.");
  }
  const requestedCurrency = normalizedCurrency(operationCurrency);
  const storedCurrency = normalizedCurrency(
    item.valorInventarioMoneda || item.costoPromedioMoneda || item.monedaCosto ||
    item.moneda || item.baselineCostoInventario?.moneda
  );
  if (storedCurrency && requestedCurrency && storedCurrency !== requestedCurrency && stock > 0) {
    economicFailure(HttpsError, "No se puede mezclar el saldo de inventario entre monedas distintas.");
  }
  const currency = stock === 0 && requestedCurrency
    ? requestedCurrency
    : storedCurrency || requestedCurrency;
  if (!currency) {
    economicFailure(HttpsError, "No se pudo determinar una moneda autoritativa para el saldo de inventario.");
  }
  const legacyDescriptor = legacyCostDescriptor(item);
  const baselineReference = validStoredNumber(item.baselineCostoInventario?.costoUnitarioInicial);
  const referenceCostCandidate = legacyDescriptor?.cost ?? baselineReference;
  const referenceCurrency = normalizedCurrency(
    legacyDescriptor?.source === "costoPromedio"
      ? item.costoPromedioMoneda || storedCurrency
      : item.monedaCosto || item.moneda ||
        item.baselineCostoInventario?.moneda || storedCurrency || currency
  );
  const referenceCost = referenceCurrency && referenceCurrency !== currency
    ? null
    : referenceCostCandidate;

  if (Number(item.modeloCostoInventarioVersion) === INVENTORY_ECONOMIC_MODEL_VERSION) {
    const storedValue = validStoredNumber(item.valorInventario);
    if (storedValue === null || storedValue > MAX_INVENTORY_VALUE) {
      economicFailure(HttpsError, "El saldo de valor del producto es inválido.");
    }
    if (stock === 0 && Math.abs(storedValue) > VALUE_EPSILON) {
      economicFailure(HttpsError, "Un producto sin stock conserva un valor residual no representable.");
    }
    return {
      average: stock > 0 ? round(storedValue / stock, 4) : null,
      baseline: null,
      currency,
      referenceCost,
      stock,
      value: stock === 0 ? 0 : round(storedValue),
    };
  }

  if (stock > 0 && !legacyDescriptor) {
    economicFailure(HttpsError, "El stock legacy no tiene un costo confiable para inicializar su valorización.");
  }
  const initialUnitCost = referenceCost ?? 0;
  const initialValue = round(stock * initialUnitCost);
  if (!Number.isFinite(initialValue) || initialValue < 0 || initialValue > MAX_INVENTORY_VALUE) {
    economicFailure(HttpsError, "El baseline económico legacy está fuera del rango permitido.");
  }
  return {
    average: stock > 0 ? round(initialValue / stock, 4) : null,
    baseline: {
      costoUnitarioInicial: round(initialUnitCost, 4),
      fuente: referenceCost !== null ? legacyDescriptor?.source || "referencia" : "stock_cero",
      moneda: currency,
      stockInicial: stock,
      valorInicial: initialValue,
    },
    currency,
    referenceCost,
    stock,
    value: initialValue,
  };
}

function applyInventoryEconomicDelta(
  state,
  {quantityDelta, valueDelta},
  HttpsError
) {
  const quantity = assertCanonicalInventoryQuantity(
    quantityDelta,
    HttpsError,
    "La cantidad del efecto económico"
  );
  const value = Number(valueDelta);
  if (!Number.isFinite(quantity) || !Number.isFinite(value)) {
    economicFailure(HttpsError, "El efecto económico contiene valores no representables.");
  }
  let resultingStock = normalizeInventoryQuantity(
    normalizeInventoryQuantity(state.stock) + quantity
  );
  let resultingValue = round(state.value + value);
  if (
    !Number.isFinite(resultingStock) || resultingStock < -QUANTITY_EPSILON ||
    Math.abs(resultingStock) > Number.MAX_SAFE_INTEGER
  ) {
    economicFailure(HttpsError, "El efecto económico produciría un stock inválido.");
  }
  if (Math.abs(resultingStock) <= QUANTITY_EPSILON) resultingStock = 0;
  if (!Number.isFinite(resultingValue) || resultingValue < -VALUE_EPSILON || resultingValue > MAX_INVENTORY_VALUE) {
    economicFailure(HttpsError, "El efecto económico produciría un saldo de valor inválido.");
  }
  if (Math.abs(resultingValue) <= VALUE_EPSILON) resultingValue = 0;
  if (resultingStock === 0 && resultingValue !== 0) {
    economicFailure(HttpsError, "La operación dejaría valor residual en un producto sin stock.");
  }
  return {
    ...state,
    average: resultingStock > 0 ? round(resultingValue / resultingStock, 4) : null,
    referenceCost: resultingStock > 0
      ? round(resultingValue / resultingStock, 4)
      : state.referenceCost,
    stock: resultingStock,
    value: resultingValue,
  };
}

function applyInventoryCostedOutflow(
  state,
  {cantidad, costoUnitario},
  HttpsError
) {
  const quantity = assertCanonicalInventoryQuantity(cantidad, HttpsError);
  const unitCost = Number(costoUnitario);
  if (quantity <= 0) {
    economicFailure(HttpsError, "La salida no contiene una cantidad válida.");
  }
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    economicFailure(HttpsError, "La salida no tiene un costo vigente confiable.");
  }
  const availableStock = assertCanonicalInventoryQuantity(
    state.stock,
    HttpsError,
    "El stock disponible"
  );
  const remainingStock = normalizeInventoryQuantity(availableStock - quantity);
  const closesBalance = remainingStock === 0;
  const totalCost = closesBalance
    ? round(state.value)
    : round(quantity * unitCost);
  const next = applyInventoryEconomicDelta(state, {
    quantityDelta: -quantity,
    valueDelta: -totalCost,
  }, HttpsError);
  return {
    cantidad: quantity,
    closesBalance,
    costoTotal: totalCost,
    costoUnitario: round(unitCost, 4),
    next,
    previous: state,
  };
}

function applyInventoryAcquisition(
  state,
  {cantidad, costoUnitario, descuentoPct = 0, tasaImpuestoCompra = DEFAULT_TAX_RATE},
  HttpsError
) {
  const canonicalQuantity = assertCanonicalInventoryQuantity(cantidad, HttpsError);
  const amounts = calculateAcquisitionAmounts({
    cantidad: canonicalQuantity,
    costoUnitario,
    descuentoPct,
    tasaImpuestoCompra,
  });
  if (amounts.cantidad <= 0) {
    economicFailure(HttpsError, "La adquisición no contiene una cantidad válida.");
  }
  const next = applyInventoryEconomicDelta(state, {
    quantityDelta: amounts.cantidad,
    valueDelta: amounts.costoPagadoTotal,
  }, HttpsError);
  return {amounts, next, previous: state};
}

function applyInventoryAverageStockAdjustment(state, quantityDelta, HttpsError) {
  const quantity = assertCanonicalInventoryQuantity(
    quantityDelta,
    HttpsError,
    "La diferencia de stock"
  );
  if (!Number.isFinite(quantity) || quantity === 0) {
    economicFailure(HttpsError, "El ajuste de stock no contiene una diferencia válida.");
  }
  const unitCost = state.stock > 0 ? state.average : state.referenceCost;
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    economicFailure(HttpsError, "El ajuste no tiene un costo vigente confiable para conservar el promedio.");
  }
  if (quantity < 0) {
    const outflow = applyInventoryCostedOutflow(state, {
      cantidad: -quantity,
      costoUnitario: unitCost,
    }, HttpsError);
    return {
      next: outflow.next,
      previous: state,
      unitCost: round(unitCost, 4),
      valueDelta: -outflow.costoTotal,
    };
  }
  const valueDelta = round(quantity * unitCost);
  return {
    next: applyInventoryEconomicDelta(state, {quantityDelta: quantity, valueDelta}, HttpsError),
    previous: state,
    unitCost: round(unitCost, 4),
    valueDelta,
  };
}

function inventoryEconomicFields(state, timestamp) {
  return {
    modeloCostoInventarioVersion: INVENTORY_ECONOMIC_MODEL_VERSION,
    valorInventario: state.value,
    valorInventarioMoneda: state.currency,
    costoPromedio: state.average,
    costoPromedioMoneda: state.currency,
    ...(state.baseline ? {
      baselineCostoInventario: {
        ...state.baseline,
        inicializadoEn: timestamp,
        modeloVersion: INVENTORY_ECONOMIC_MODEL_VERSION,
      },
    } : {}),
  };
}

module.exports = {
  INVENTORY_ECONOMIC_MODEL_VERSION,
  MAX_ATOMIC_INVENTORY_WRITES,
  QUANTITY_DECIMALS,
  QUANTITY_EPSILON,
  applyInventoryAcquisition,
  applyInventoryAverageStockAdjustment,
  applyInventoryCostedOutflow,
  applyInventoryEconomicDelta,
  assertCanonicalInventoryQuantity,
  assertInventoryTransactionWriteBudget,
  calculateAcquisitionAmounts,
  calculateWeightedAverage,
  inventoryEconomicFields,
  legacyPaidCost,
  normalizeInventoryQuantity,
  resolveInventoryEconomicState,
  round,
};
