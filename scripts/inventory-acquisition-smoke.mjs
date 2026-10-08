import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require = createRequire(import.meta.url);
const {
  MAX_ATOMIC_INVENTORY_WRITES,
  PURCHASE_VAT_TREATMENTS,
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
  resolvePurchaseVatTreatment,
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
// SPEC 023 §6.3: sin promedio, el saldo inicial es el costo neto del maestro.
assert.equal(legacyPaidCost({costoBase: 1000, tasaImpuestoCompra: 19}), 1000);
assert.equal(legacyPaidCost({costoBase: 1000, tasaImpuestoCompra: 19, costoPagado: 1190}), 1000);
assert.equal(legacyPaidCost({costoPromedio: 102500, costoPagado: 999}), 102500);

// SPEC 023 §5.3: con tratamiento explícito al inventario entra el neto de la
// línea; el IVA de factura queda sólo como dato informativo.
assert.deepEqual(calculateAcquisitionAmounts({
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  tasaImpuestoCompra: 19,
  tratamientoIvaCompra: PURCHASE_VAT_TREATMENTS.CREDITO_FISCAL,
}), {
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  costoUnitarioNeto: 900,
  tasaImpuestoCompra: 19,
  impuestoCompraUnitario: 171,
  impuestoCompraTotal: 342,
  costoPagadoUnitario: 1071,
  costoPagadoTotal: 2142,
  tratamientoIvaCompra: "credito_fiscal",
  costoInventarioUnitario: 900,
  costoInventarioTotal: 1800,
});
assert.deepEqual(calculateAcquisitionAmounts({
  cantidad: 2,
  costoUnitario: 4165,
  tasaImpuestoCompra: 19,
  tratamientoIvaCompra: PURCHASE_VAT_TREATMENTS.BOLETA,
}), {
  cantidad: 2,
  costoUnitario: 4165,
  descuentoPct: 0,
  costoUnitarioNeto: 4165,
  tasaImpuestoCompra: 0,
  impuestoCompraUnitario: 0,
  impuestoCompraTotal: 0,
  costoPagadoUnitario: 4165,
  costoPagadoTotal: 8330,
  tratamientoIvaCompra: "boleta",
  costoInventarioUnitario: 4165,
  costoInventarioTotal: 8330,
});
const exemptAmounts = calculateAcquisitionAmounts({
  cantidad: 5,
  costoUnitario: 4000,
  tasaImpuestoCompra: 19,
  tratamientoIvaCompra: PURCHASE_VAT_TREATMENTS.EXENTO,
});
assert.deepEqual(
  [exemptAmounts.tasaImpuestoCompra, exemptAmounts.impuestoCompraTotal, exemptAmounts.costoPagadoTotal, exemptAmounts.costoInventarioUnitario, exemptAmounts.costoInventarioTotal],
  [0, 0, 20000, 4000, 20000]
);
assert.equal("costoInventarioTotal" in taxed, false, "sin tratamiento el resultado es el legacy");
assert.throws(
  () => calculateAcquisitionAmounts({cantidad: 1, costoUnitario: 1, tratamientoIvaCompra: "desconocido"}),
  /tratamiento de IVA/
);
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "boleta", impuestoId: "IVA_EXENTO"}), "boleta");
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "factura", impuestoId: "SIN_IMPUESTO"}), "exento");
assert.equal(resolvePurchaseVatTreatment({tipoDocumento: "sin_documento"}), "credito_fiscal");

// Ejemplo A de SPEC 023: 10 rollos a 10.000 con factura entran por 100.000.
const emptyClp = {stock: 0, value: 0, average: null, currency: "CLP", referenceCost: null, baseline: null};
const netInvoiceEntry = applyInventoryAcquisition(emptyClp, {
  cantidad: 10,
  costoUnitario: 10000,
  tasaImpuestoCompra: 19,
  tratamientoIvaCompra: PURCHASE_VAT_TREATMENTS.CREDITO_FISCAL,
});
assert.deepEqual([netInvoiceEntry.next.stock, netInvoiceEntry.next.value, netInvoiceEntry.next.average], [10, 100000, 10000]);
assert.equal(netInvoiceEntry.amounts.costoPagadoTotal, 119000);
const boletaEntry = applyInventoryAcquisition(emptyClp, {
  cantidad: 2,
  costoUnitario: 4165,
  tasaImpuestoCompra: 19,
  tratamientoIvaCompra: PURCHASE_VAT_TREATMENTS.BOLETA,
});
assert.deepEqual([boletaEntry.next.stock, boletaEntry.next.value, boletaEntry.next.average], [2, 8330, 4165]);
const legacyTaxedEntry = applyInventoryAcquisition(emptyClp, {
  cantidad: 10,
  costoUnitario: 10000,
  tasaImpuestoCompra: 19,
});
assert.deepEqual([legacyTaxedEntry.next.value, legacyTaxedEntry.next.average], [119000, 11900], "sin tratamiento sigue entrando el costo pagado");
console.log("OK adquisición SPEC 023: crédito fiscal, boleta, exento, legacy y tratamiento inválido");

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
// Caso 8 (SPEC 023 §12.2): un producto con costo con IVA guardado y sin
// promedio inicializa su saldo con el costo neto; costoPagado no es fuente.
const paidCostBaseline = resolveInventoryEconomicState({
  item: {stock: 5, costoBase: 10000, formacionPrecioVersion: 2, tasaImpuestoCompra: 19, costoPagado: 11900},
  operationCurrency: "CLP",
});
assert.deepEqual(
  [paidCostBaseline.value, paidCostBaseline.average, paidCostBaseline.baseline.fuente, paidCostBaseline.baseline.costoUnitarioInicial],
  [50000, 10000, "costoBase", 10000]
);

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
for (const expected of ["Costo neto", "Costo promedio neto", "Último costo neto", "Historial de adquisiciones", "Compra directa", "Vigente", "Revertida", "Valor de inventario:"]) {
  assert.match(inventoryManagerSource, new RegExp(expected.replace("/", "\\/")));
}

console.log("Inventory acquisition smoke: OK");
