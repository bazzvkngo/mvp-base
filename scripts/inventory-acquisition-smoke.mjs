import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const {
  calculateAcquisitionAmounts,
  calculateWeightedAverage,
  legacyPaidCost,
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

console.log("Inventory acquisition smoke: OK");
