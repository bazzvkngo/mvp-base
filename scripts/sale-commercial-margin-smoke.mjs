import assert from "node:assert/strict";
import {
  calculateSaleCommercialMarginV1,
  SALE_COMMERCIAL_MARGIN_STATUS as STATUS,
} from "../src/domain/saleCommercialMargin.mjs";

const product = (overrides = {}) => ({
  lineaId: "product-1",
  itemId: "inventory-product-1",
  tipoItem: "producto",
  cantidad: 1,
  precioUnitario: 1000,
  descuentoPct: 0,
  ...overrides,
});

const service = (overrides = {}) => ({
  lineaId: "service-1",
  itemId: "inventory-service-1",
  tipoItem: "servicio",
  cantidad: 1,
  precioUnitario: 1000,
  descuentoPct: 0,
  ...overrides,
});

const effect = (overrides = {}) => ({
  movimientoId: "movement-1",
  lineaId: "product-1",
  itemId: "inventory-product-1",
  cantidad: 1,
  costoUnitario: 400,
  costoTotal: 400,
  costoHistoricoDisponible: true,
  moneda: "CLP",
  ...overrides,
});

const sale = (overrides = {}) => ({
  ventaId: "sale-1",
  estado: "confirmada",
  moneda: "CLP",
  descuento: 0,
  items: [product()],
  efectosInventario: [effect()],
  ...overrides,
});

const onlyProducts = calculateSaleCommercialMarginV1(sale());
assert.equal(onlyProducts.estado, STATUS.COMPLETE);
assert.equal(onlyProducts.ingresoNetoVenta, 1000);
assert.equal(onlyProducts.ingresoNetoProductos, 1000);
assert.equal(onlyProducts.costoHistoricoProductos, 400);
assert.equal(onlyProducts.margenBrutoProductos, 600);
assert.equal(onlyProducts.margenBrutoPct, 60);
console.log("OK caso 1: sólo productos con ingreso, costo y margen conocidos");

const discounted = calculateSaleCommercialMarginV1(sale({
  descuento: 300,
  neto: 1500,
  items: [product({cantidad: 2, precioUnitario: 1000, descuentoPct: 10})],
  efectosInventario: [effect({cantidad: 2, costoUnitario: 400, costoTotal: 800})],
}));
assert.equal(discounted.estado, STATUS.COMPLETE);
assert.equal(discounted.ingresoNetoVenta, 1500);
assert.equal(discounted.ingresoNetoProductos, 1500);
assert.equal(discounted.costoHistoricoProductos, 800);
assert.equal(discounted.margenBrutoProductos, 700);
assert.equal(discounted.margenBrutoPct, 46.67);
assert.equal(discounted.asignacionDescuentos.descuentoItemsProductos, 200);
assert.equal(discounted.asignacionDescuentos.descuentoGeneralProductos, 300);
console.log("OK caso 2: descuentos de línea y general reducen ingreso antes del margen");

const mixed = calculateSaleCommercialMarginV1(sale({
  descuento: 200,
  neto: 1800,
  items: [product(), service()],
}));
assert.equal(mixed.estado, STATUS.COMPLETE);
assert.equal(mixed.ingresoNetoVenta, 1800);
assert.equal(mixed.ingresoNetoProductos, 900);
assert.equal(mixed.asignacionDescuentos.descuentoGeneralProductos, 100);
assert.equal(mixed.costoHistoricoProductos, 400);
assert.equal(mixed.margenBrutoProductos, 500);
assert.equal(mixed.margenBrutoPct, 55.56);
assert.equal(mixed.productos.lineas, 1);
console.log("OK caso 3: Venta mixta calcula sólo la porción de productos");

const onlyServices = calculateSaleCommercialMarginV1(sale({
  items: [service()],
  efectosInventario: [],
}));
assert.equal(onlyServices.estado, STATUS.NOT_APPLICABLE);
assert.equal(onlyServices.ingresoNetoVenta, 1000);
assert.equal(onlyServices.ingresoNetoProductos, 0);
assert.equal(onlyServices.costoHistoricoProductos, null);
assert.equal(onlyServices.margenBrutoProductos, null);
assert.equal(onlyServices.margenBrutoPct, null);
console.log("OK caso 4: sólo servicios no inventa margen ni costo cero");

const qvClosure = calculateSaleCommercialMarginV1(sale({
  items: [product({cantidad: 20000, precioUnitario: 1})],
  efectosInventario: [effect({cantidad: 20000, costoUnitario: 0.0051, costoTotal: 101})],
}));
assert.equal(qvClosure.estado, STATUS.COMPLETE);
assert.equal(qvClosure.costoHistoricoProductos, 101);
assert.notEqual(qvClosure.costoHistoricoProductos, 20000 * 0.0051);
assert.equal(qvClosure.margenBrutoProductos, 19899);
assert.equal(qvClosure.margenBrutoPct, 99.5);
console.log("OK caso 5: cierre Q/V consume costoTotal congelado, no cantidad por costo unitario");

const zeroDenominator = calculateSaleCommercialMarginV1(sale({
  items: [product({precioUnitario: 0})],
  efectosInventario: [effect({costoUnitario: 100, costoTotal: 100})],
}));
assert.equal(zeroDenominator.estado, STATUS.COMPLETE);
assert.equal(zeroDenominator.ingresoNetoProductos, 0);
assert.equal(zeroDenominator.margenBrutoProductos, -100);
assert.equal(zeroDenominator.margenBrutoPct, null);
assert.equal(Number.isNaN(zeroDenominator.margenBrutoPct), false);
console.log("OK caso 6: denominador cero no produce NaN, Infinity ni porcentaje");

const incompleteLegacy = calculateSaleCommercialMarginV1(sale({
  efectosInventario: [],
  inventarioActual: {costoPromedio: 10, costoBase: 5},
}));
assert.equal(incompleteLegacy.estado, STATUS.UNAVAILABLE);
assert.equal(incompleteLegacy.costoHistoricoProductos, null);
assert.equal(incompleteLegacy.margenBrutoProductos, null);
assert.equal(incompleteLegacy.margenBrutoPct, null);
console.log("OK caso 7: legacy incompleto no reconstruye costo desde Inventario");

const partial = calculateSaleCommercialMarginV1(sale({
  items: [product({cantidad: 3})],
  efectosInventario: [effect({cantidad: 2, costoUnitario: 35, costoTotal: 70})],
}));
assert.equal(partial.estado, STATUS.PARTIAL);
assert.equal(partial.costoHistoricoProductos, null);
assert.equal(partial.costoHistoricoCubierto, 70);
assert.equal(partial.margenBrutoProductos, null);
console.log("OK adicional: cobertura parcial no publica margen");

const legacyFlagMissing = calculateSaleCommercialMarginV1(sale({
  efectosInventario: [{...effect(), costoHistoricoDisponible: undefined}],
}));
assert.equal(legacyFlagMissing.estado, STATUS.COMPLETE);
assert.equal(legacyFlagMissing.costoHistoricoProductos, 400);
console.log("OK adicional: snapshot legacy con importes y bandera ausente es compatible");

const canceled = calculateSaleCommercialMarginV1(sale({
  estado: "cancelada",
  estadoStock: "revertido",
}));
assert.equal(canceled.estado, STATUS.CANCELED);
assert.equal(canceled.incluible, false);
assert.equal(canceled.margenBrutoProductos, null);
console.log("OK adicional: Venta cancelada con stock revertido no aporta margen");

const incompatibleCurrency = calculateSaleCommercialMarginV1(sale({
  efectosInventario: [effect({moneda: "USD"})],
}));
assert.equal(incompatibleCurrency.estado, STATUS.CURRENCY_MISMATCH);
assert.equal(incompatibleCurrency.margenBrutoProductos, null);
console.log("OK adicional: moneda incompatible no se convierte ni produce margen");

const pending = calculateSaleCommercialMarginV1(sale({estado: "borrador"}));
assert.equal(pending.estado, STATUS.PENDING);
assert.equal(pending.incluible, false);
assert.equal(pending.margenBrutoProductos, null);

for (const estado of ["confirmado", "activa", "activo"]) {
  const legacyConfirmed = calculateSaleCommercialMarginV1(sale({estado}));
  assert.equal(legacyConfirmed.estado, STATUS.COMPLETE);
}
console.log("OK adicional: borrador pendiente y aliases legacy confirmados son conservadores");

const anomalies = [
  sale({efectosInventario: [effect(), effect({movimientoId: "movement-1"})]}),
  sale({efectosInventario: [effect({lineaId: "orphan-line"})]}),
  sale({efectosInventario: [effect({cantidad: 2, costoTotal: 800})]}),
];
for (const anomalousSale of anomalies) {
  const result = calculateSaleCommercialMarginV1(anomalousSale);
  assert.notEqual(result.estado, STATUS.COMPLETE);
  assert.equal(result.margenBrutoProductos, null);
}
console.log("OK adicional: efectos duplicados, huérfanos o excesivos no publican margen");

const legacyCurrency = calculateSaleCommercialMarginV1(sale({
  efectosInventario: [effect({moneda: undefined})],
}));
assert.equal(legacyCurrency.estado, STATUS.COMPLETE);

const linkedWork = calculateSaleCommercialMarginV1(sale({trabajoId: "work-1"}));
assert.equal(linkedWork.estado, STATUS.COMPLETE);
assert.equal(linkedWork.margenBrutoProductos, onlyProducts.margenBrutoProductos);
console.log("OK adicional: moneda legacy hereda Venta y vínculo a Proyecto no agrega resultados");

console.log("Smoke de Margen Comercial de Ventas V1 completado.");
