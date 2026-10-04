import assert from "node:assert/strict";
import {
  calculateSaleCommercialMarginV1,
  calculateSaleProductLineMarginsV1,
  SALE_COMMERCIAL_MARGIN_STATUS,
} from "../src/domain/saleCommercialMargin.mjs";

// SPEC 022 §6.5.3: desagregación por línea del margen V1. La suma de las
// líneas debe reconciliar EXACTO con el agregado de la Venta.

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const sumCents = (values) => values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;

function assertLinesReconcile(sale, label) {
  const aggregate = calculateSaleCommercialMarginV1(sale);
  const detail = calculateSaleProductLineMarginsV1(sale);
  assert.equal(aggregate.estado, SALE_COMMERCIAL_MARGIN_STATUS.COMPLETE, `${label}: V1 COMPLETO`);
  assert.equal(detail.margenBrutoProductos, aggregate.margenBrutoProductos, `${label}: mismo agregado`);
  assert.equal(sumCents(detail.lineas.map((line) => line.margenBruto)), aggregate.margenBrutoProductos, `${label}: Σ margen por línea = margenBrutoProductos`);
  assert.equal(sumCents(detail.lineas.map((line) => line.ingresoNeto)), aggregate.ingresoNetoProductos, `${label}: Σ ingreso por línea = ingresoNetoProductos`);
  assert.equal(sumCents(detail.lineas.map((line) => line.costoHistorico)), aggregate.costoHistoricoProductos, `${label}: Σ costo por línea = costoHistoricoProductos`);
  assert.equal(detail.lineas.reduce((total, line) => total + line.descuentoGeneralAsignado, 0), aggregate.asignacionDescuentos.descuentoGeneralProductos, `${label}: Σ descuento general asignado = el de V1`);
  return {aggregate, detail};
}

// --- Caso concreto: descuento general repartido entre tres líneas de producto ---
// Subtotal 40554, descuento ítems 1555, base 38999, descuento general 1001.
// V1 asigna a productos round(1001 × 33999 / 38999) = 873; el servicio absorbe 128.
const discountSale = {
  ventaId: "v-discount", estado: "confirmada", moneda: "CLP", neto: 37998, descuento: 1001,
  items: [
    {lineaId: "a", itemId: "item-a", tipoItem: "producto", cantidad: 3, precioUnitario: 3333, descuentoPct: 0},
    {lineaId: "b", itemId: "item-b", tipoItem: "producto", cantidad: 1, precioUnitario: 10001, descuentoPct: 0},
    {lineaId: "c", itemId: "item-c", tipoItem: "producto", cantidad: 2, precioUnitario: 7777, descuentoPct: 10},
    {lineaId: "s", itemId: "service", tipoItem: "servicio", cantidad: 1, precioUnitario: 5000, descuentoPct: 0},
  ],
  efectosInventario: [
    {lineaId: "a", itemId: "item-a", movimientoId: "m-a", cantidad: 3, costoUnitario: 1666.78, costoTotal: 5000.33},
    {lineaId: "b", itemId: "item-b", movimientoId: "m-b", cantidad: 1, costoUnitario: 6000.1, costoTotal: 6000.1},
    {lineaId: "c", itemId: "item-c", movimientoId: "m-c", cantidad: 2, costoUnitario: 3500.04, costoTotal: 7000.07},
  ],
};
const {aggregate, detail} = assertLinesReconcile(discountSale, "descuento general");
assert.equal(aggregate.asignacionDescuentos.descuentoGeneralProductos, 873);
assert.equal(aggregate.ingresoNetoProductos, 33126);
assert.equal(aggregate.costoHistoricoProductos, 18000.5);
assert.equal(aggregate.margenBrutoProductos, 15125.5);
assert.deepEqual(detail.lineas.map((line) => [line.itemId, line.totalLinea, line.descuentoGeneralAsignado, line.ingresoNeto, line.costoHistorico, line.margenBruto]), [
  ["item-a", 9999, 257, 9742, 5000.33, 4741.67],
  ["item-b", 10001, 257, 9744, 6000.1, 3743.9],
  ["item-c", 13999, 359, 13640, 7000.07, 6639.93],
]);
assert.ok(detail.lineas.every((line) => line.itemId !== "service"), "los servicios no tienen línea de margen");
console.log("OK caso concreto: 873 repartido 257/257/359; márgenes 4741,67 + 3743,90 + 6639,93 = 15125,50 = margenBrutoProductos V1");

// --- Fuzz determinista: la reconciliación se cumple siempre, no por casualidad ---
let seed = 20261004;
const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));
for (let iteration = 0; iteration < 500; iteration += 1) {
  const lineCount = randomInt(1, 6);
  const items = [];
  const effects = [];
  for (let index = 0; index < lineCount; index += 1) {
    const type = index === 0 || random() < 0.75 ? "producto" : "servicio";
    const quantity = randomInt(1, 9);
    items.push({lineaId: `l${index}`, itemId: `i${index}`, tipoItem: type, cantidad: quantity, precioUnitario: randomInt(1, 99999), descuentoPct: randomInt(0, 4) === 0 ? randomInt(1, 40) : 0});
    if (type === "producto") {
      const cost = randomInt(1, 9999999) / 100;
      effects.push({lineaId: `l${index}`, itemId: `i${index}`, movimientoId: `m${iteration}-${index}`, cantidad: quantity, costoUnitario: roundMoney(cost / quantity), costoTotal: cost});
    }
  }
  const base = items.reduce((total, line) => {
    const subtotal = Math.round(line.cantidad * line.precioUnitario);
    return total + subtotal - Math.round((subtotal * line.descuentoPct) / 100);
  }, 0);
  const generalDiscount = random() < 0.7 ? randomInt(0, base) : 0;
  assertLinesReconcile({ventaId: `fuzz-${iteration}`, estado: "confirmada", moneda: "CLP", neto: base - generalDiscount, descuento: generalDiscount, items, efectosInventario: effects}, `fuzz ${iteration}`);
}
console.log("OK fuzz: 500 Ventas aleatorias con descuento general reconcilian exacto línea a línea");

// --- Sin margen completo no hay líneas ---
const partial = {...discountSale, efectosInventario: discountSale.efectosInventario.slice(0, 2)};
assert.notEqual(calculateSaleCommercialMarginV1(partial).estado, SALE_COMMERCIAL_MARGIN_STATUS.COMPLETE);
assert.equal(calculateSaleProductLineMarginsV1(partial).lineas, null);
const servicesOnly = {ventaId: "v-s", estado: "confirmada", moneda: "CLP", neto: 5000, items: [discountSale.items[3]], efectosInventario: []};
assert.equal(calculateSaleProductLineMarginsV1(servicesOnly).estado, SALE_COMMERCIAL_MARGIN_STATUS.NOT_APPLICABLE);
assert.equal(calculateSaleProductLineMarginsV1(servicesOnly).lineas, null);
console.log("OK sin margen completo: PARCIAL y NO_APLICA no publican líneas");

// --- El agregado V1 no cambió de forma ---
assert.deepEqual(Object.keys(aggregate), [
  "modeloMargenVentaVersion", "estado", "incluible", "moneda", "ingresoNetoVenta", "ingresoNetoProductos",
  "costoHistoricoProductos", "costoHistoricoCubierto", "margenBrutoProductos", "margenBrutoPct", "productos", "asignacionDescuentos",
]);
console.log("OK V1: calculateSaleCommercialMarginV1 conserva exactamente sus campos");

console.log("SALE_PRODUCT_LINE_MARGIN_SMOKE_OK");
