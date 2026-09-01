import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require = createRequire(import.meta.url);
const {
  MAX_ATOMIC_INVENTORY_WRITES,
  applyInventoryAcquisition,
  applyInventoryAverageStockAdjustment,
  applyInventoryCostedOutflow,
  applyInventoryEconomicDelta,
  assertInventoryTransactionWriteBudget,
  calculateAcquisitionAmounts,
  calculateWeightedAverage,
  inventoryEconomicFields,
  legacyPaidCost,
  resolveInventoryEconomicState,
} = require("../functions/inventoryAcquisition.js");

const first = calculateAcquisitionAmounts({
  cantidad: 7,
  costoUnitario: 100000,
  tasaImpuestoCompra: 0,
});
assert.equal(first.costoPagadoUnitario, 100000);
assert.equal(first.costoPagadoTotal, 700000);
assert.equal(calculateWeightedAverage({
  stockAnterior: 7,
  costoPromedioAnterior: 100000,
  cantidadEntrada: 1,
  costoEntrada: 120000,
}), 102500);

const taxed = calculateAcquisitionAmounts({
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  tasaImpuestoCompra: 19,
});
assert.deepEqual(taxed, {
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  costoUnitarioNeto: 900,
  tasaImpuestoCompra: 19,
  impuestoCompraUnitario: 171,
  impuestoCompraTotal: 342,
  costoPagadoUnitario: 1071,
  costoPagadoTotal: 2142,
});
assert.equal(legacyPaidCost({costoBase: 1000, tasaImpuestoCompra: 19}), 1190);
assert.equal(legacyPaidCost({costoPromedio: 102500, costoPagado: 999}), 102500);

const averageBaseline = resolveInventoryEconomicState({
  item: {stock: 10, costoPromedio: 100, costoPromedioMoneda: "CLP"},
  operationCurrency: "CLP",
});
assert.equal(averageBaseline.value, 1000);
assert.equal(averageBaseline.baseline.fuente, "costoPromedio");
const fallbackBaseline = resolveInventoryEconomicState({
  item: {stock: 10, costoBase: 100},
  operationCurrency: "CLP",
});
assert.equal(fallbackBaseline.value, 1000);
assert.equal(fallbackBaseline.baseline.fuente, "costoBase");

const acquisitionA = applyInventoryAcquisition(averageBaseline, {
  cantidad: 10,
  costoUnitario: 200,
}).next;
assert.deepEqual([acquisitionA.stock, acquisitionA.value, acquisitionA.average], [20, 3000, 150]);
const afterSale = applyInventoryEconomicDelta(acquisitionA, {
  quantityDelta: -5,
  valueDelta: -750,
});
const afterReversalA = applyInventoryEconomicDelta(afterSale, {
  quantityDelta: -10,
  valueDelta: -2000,
});
assert.deepEqual([afterReversalA.stock, afterReversalA.value, afterReversalA.average], [5, 250, 50]);

const acquisitionB = applyInventoryAcquisition(acquisitionA, {
  cantidad: 10,
  costoUnitario: 300,
}).next;
const afterAFromAB = applyInventoryEconomicDelta(acquisitionB, {
  quantityDelta: -10,
  valueDelta: -2000,
});
assert.deepEqual([afterAFromAB.stock, afterAFromAB.value, afterAFromAB.average], [20, 4000, 200]);

const positiveAdjustment = applyInventoryAverageStockAdjustment(averageBaseline, 2);
const negativeAdjustment = applyInventoryAverageStockAdjustment(positiveAdjustment.next, -2);
assert.deepEqual([positiveAdjustment.next.stock, positiveAdjustment.next.value, positiveAdjustment.next.average], [12, 1200, 100]);
assert.deepEqual([negativeAdjustment.next.stock, negativeAdjustment.next.value, negativeAdjustment.next.average], [10, 1000, 100]);
assert.equal(inventoryEconomicFields(averageBaseline, "timestamp").modeloCostoInventarioVersion, 1);
assert.throws(() => applyInventoryEconomicDelta(afterSale, {quantityDelta: -10, valueDelta: -3000}), /saldo de valor inválido/);
assert.throws(() => applyInventoryEconomicDelta(acquisitionA, {quantityDelta: -20, valueDelta: -2999}), /valor residual/);
assert.throws(() => resolveInventoryEconomicState({item: {stock: 1, costoPromedio: 1, costoPromedioMoneda: "USD"}, operationCurrency: "CLP"}), /monedas distintas/);

const zeroUsdState = resolveInventoryEconomicState({
  item: {
    modeloCostoInventarioVersion: 1,
    stock: 0,
    valorInventario: 0,
    valorInventarioMoneda: "USD",
    costoPromedio: null,
    costoPromedioMoneda: "USD",
    costoBase: 100,
    baselineCostoInventario: {costoUnitarioInicial: 100, moneda: "USD"},
  },
  operationCurrency: "CLP",
});
assert.equal(zeroUsdState.currency, "CLP");
assert.equal(zeroUsdState.referenceCost, null);
const zeroUsdAcquisition = applyInventoryAcquisition(zeroUsdState, {
  cantidad: 2,
  costoUnitario: 500,
}).next;
assert.deepEqual(
  [zeroUsdAcquisition.stock, zeroUsdAcquisition.value, zeroUsdAcquisition.currency],
  [2, 1000, "CLP"]
);
assert.equal(inventoryEconomicFields(zeroUsdAcquisition, "timestamp").valorInventarioMoneda, "CLP");
assert.equal(inventoryEconomicFields(zeroUsdAcquisition, "timestamp").costoPromedioMoneda, "CLP");
assert.throws(
  () => applyInventoryAverageStockAdjustment(zeroUsdState, 1),
  /costo vigente confiable/
);

const decimalState = {average: 1, baseline: null, currency: "CLP", referenceCost: 1, stock: 0.3, value: 0.3};
const afterDecimalTenth = applyInventoryEconomicDelta(decimalState, {
  quantityDelta: -0.1,
  valueDelta: -0.1,
});
const afterDecimalRest = applyInventoryEconomicDelta(afterDecimalTenth, {
  quantityDelta: -0.2,
  valueDelta: -0.2,
});
assert.deepEqual([afterDecimalRest.stock, afterDecimalRest.value, afterDecimalRest.average], [0, 0, null]);
assert.throws(
  () => applyInventoryEconomicDelta(afterDecimalTenth, {quantityDelta: -0.2001, valueDelta: -0.2}),
  /stock inválido/
);

const lowAverageState = {
  average: 0.0051,
  baseline: null,
  currency: "CLP",
  referenceCost: 0.0051,
  stock: 20000,
  value: 101,
};
const fullAdjustment = applyInventoryAverageStockAdjustment(lowAverageState, -20000);
assert.deepEqual(
  [fullAdjustment.next.stock, fullAdjustment.next.value, fullAdjustment.next.average],
  [0, 0, null]
);
assert.equal(fullAdjustment.valueDelta, -101);
const partialOutflow = applyInventoryCostedOutflow(lowAverageState, {
  cantidad: 10000,
  costoUnitario: lowAverageState.average,
});
assert.deepEqual(
  [partialOutflow.costoTotal, partialOutflow.next.stock, partialOutflow.next.value],
  [51, 10000, 50]
);
assert.throws(
  () => applyInventoryAcquisition(decimalState, {
    cantidad: 1.0000004,
    costoUnitario: 100000000,
  }),
  /6 decimales/
);
assert.throws(
  () => applyInventoryEconomicDelta(
    {average: 50, baseline: null, currency: "CLP", referenceCost: 50, stock: 2, value: 101},
    {quantityDelta: -2, valueDelta: -100}
  ),
  /valor residual/
);

assert.equal(assertInventoryTransactionWriteBudget({
  acquisitionWrites: 149,
  documentWrites: 3,
  inventoryWrites: 149,
  movementWrites: 149,
}), MAX_ATOMIC_INVENTORY_WRITES);
assert.throws(() => assertInventoryTransactionWriteBudget({
  acquisitionWrites: 149,
  documentWrites: 4,
  inventoryWrites: 149,
  movementWrites: 149,
}), /demasiadas líneas físicas/);

const inventoryManagerSource = readFileSync(
  new URL("../src/features/inventory/InventoryManager.jsx", import.meta.url),
  "utf8"
);
for (const expected of ["Costo base / manual", "Costo promedio", "Último costo", "Historial de adquisiciones", "Compra directa", "Vigente", "Revertida", "Valor de inventario:"]) {
  assert.match(inventoryManagerSource, new RegExp(expected.replace("/", "\\/")));
}

console.log("Inventory acquisition smoke: OK");
