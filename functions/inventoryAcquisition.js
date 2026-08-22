const DEFAULT_TAX_RATE = 0;

function finiteNumber(value, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((finiteNumber(value) + Number.EPSILON) * factor) / factor;
}

function calculateAcquisitionAmounts({
  cantidad,
  costoUnitario,
  descuentoPct = 0,
  tasaImpuestoCompra = DEFAULT_TAX_RATE,
}) {
  const quantity = Math.max(finiteNumber(cantidad), 0);
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

module.exports = {
  calculateAcquisitionAmounts,
  calculateWeightedAverage,
  legacyPaidCost,
  round,
};
