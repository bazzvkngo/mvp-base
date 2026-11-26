import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { adaptDocumentLocalization } from "../src/domain/localization.mjs";
import { isMoneyAmount, mulRound, sumMoney } from "../src/domain/money.mjs";
import {
  adaptStoredPurchase,
  buildPurchaseMutationPayload,
  calculatePurchaseLine,
  calculatePurchaseTotals,
} from "../src/domain/purchaseModel.mjs";
import {
  adaptStoredPurchaseOrder,
  buildPurchaseOrderMutationPayload,
  calculatePurchaseOrderLine,
  calculatePurchaseOrderTotals,
} from "../src/domain/purchaseOrderModel.mjs";
import { getReceptionConfirmationImpact } from "../src/domain/receptionModel.mjs";

// SPEC 036, entrega B2: compras, órdenes de compra y recepciones con decimales por documento (`montoDecimales`). Los modelos
// reciben montoDecimales: 2 directamente (el catálogo sigue en 0). Con montoDecimales ausente o 0 todo da lo mismo que antes.
const require = createRequire(import.meta.url);
const serverLocalization = require("../functions/localization.js");
const serverPurchase = require("../functions/purchasePersistence.js");
const serverOrder = require("../functions/purchaseOrderPersistence.js");
const serverReception = require("../functions/receptionPersistence.js");

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
// Las líneas de producto guardan la marca de exención (impuestoId); las de servicio no.
const PRODUCT = { inventarioId: "i1", codigoInterno: "P", nombre: "Producto", descripcion: "", tipoItem: "producto", unidad: "unidad" };
const SERVICE = { inventarioId: "", codigoInterno: "", nombre: "Servicio", descripcion: "", tipoItem: "servicio", unidad: "unidad" };

// --- Adaptadores de los helpers del servidor ---
const serverPurchaseLines = (lines, decimals) => lines.map((line, index) => serverPurchase.storedPurchaseLine(
  { lineaId: `l${index + 1}`, itemId: `i${index + 1}`, cantidad: line.cantidad, costoUnitario: line.costo, descuentoPct: line.descuento ?? 0 },
  PRODUCT, HttpsError, line.impuestoId || "", decimals
));
const serverPurchaseTotals = (lines, decimals, tasaIva, tipoDocumento) =>
  serverPurchase.calculatePurchaseTotals(serverPurchaseLines(lines, decimals), HttpsError, tasaIva, { tipoDocumento, decimals });
const serverOrderLines = (lines, decimals) => lines.map((line, index) => serverOrder.buildStoredPurchaseOrderLine(
  { lineaId: `l${index + 1}`, itemId: `i${index + 1}`, cantidad: line.cantidad, costoUnitario: line.costo, descuentoPct: line.descuento ?? 0 },
  SERVICE, HttpsError, decimals
));
const frontLines = (lines) => lines.map((line) => ({ cantidad: line.cantidad, costoUnitario: line.costo, descuentoPct: line.descuento ?? 0, ...(line.impuestoId ? { impuestoId: line.impuestoId } : {}) }));
const line = (cantidad, costo, descuento = 0, impuestoId = "") => ({ cantidad, costo, descuento, impuestoId });

// --- Los ejemplos del enunciado: 3 × Bs 3,50, IVA 13 %, exento, boleta, descuento ---
{
  const front = calculatePurchaseTotals(frontLines([line(3, 3.5)]), { tasaIva: 0.13, montoDecimales: 2 });
  assert.deepEqual([front.subtotal, front.neto, front.iva, front.total], [10.5, 10.5, 1.37, 11.87], "compra: 3 × 3,50 = 10,50; 13 % = 1,37");
  const order = calculatePurchaseOrderTotals(frontLines([line(3, 3.5)]), { tasaIva: 0.13, montoDecimales: 2 });
  assert.deepEqual([order.subtotal, order.neto, order.iva, order.total], [10.5, 10.5, 1.37, 11.87], "orden: 3 × 3,50 = 10,50; 13 % = 1,37");
  const impact = getReceptionConfirmationImpact(frontLines([line(3, 3.5)]).map((l) => ({ ...l, tipoItem: "servicio" })), 0.13, 2);
  assert.equal(impact.totalCompraEstimado, 11.87, "recepción: total estimado con 2 decimales");
  // Sin decimales (hoy en BOB): se redondea al entero, como hasta ahora.
  for (const montoDecimales of [undefined, 0, null, "2", 2.5, 9]) {
    const options = montoDecimales === undefined ? { tasaIva: 0.13 } : { tasaIva: 0.13, montoDecimales };
    const old = calculatePurchaseTotals(frontLines([line(3, 3.5)]), options);
    assert.deepEqual([old.subtotal, old.neto, old.iva, old.total], [11, 11, 1, 12], `compra sin decimales ${montoDecimales}`);
    const oldOrder = calculatePurchaseOrderTotals(frontLines([line(3, 3.5)]), options);
    assert.deepEqual([oldOrder.subtotal, oldOrder.neto, oldOrder.iva, oldOrder.total], [11, 11, 1, 12], `orden sin decimales ${montoDecimales}`);
  }
  assert.equal(getReceptionConfirmationImpact([{ cantidad: 3, costoUnitario: 3.5, tipoItem: "servicio" }], 0.13).totalCompraEstimado, 12);

  // Descuento de línea (10 %): 10,50 − 1,05 = 9,45; IVA 1,23; total 10,68.
  const discounted = calculatePurchaseTotals(frontLines([line(3, 3.5, 10)]), { tasaIva: 0.13, montoDecimales: 2 });
  assert.deepEqual([discounted.subtotal, discounted.descuentoTotal, discounted.neto, discounted.iva, discounted.total], [10.5, 1.05, 9.45, 1.23, 10.68]);
  assert.deepEqual(
    [calculatePurchaseLine(frontLines([line(3, 3.5, 10)])[0], 0, 2).descuentoLinea, calculatePurchaseOrderLine(frontLines([line(3, 3.5, 10)])[0], 0, 2).totalLinea],
    [1.05, 9.45]
  );

  // Compra con exento: 10,50 gravado + 5,25 exento. IVA solo sobre (neto − exento) = 10,50 → 1,37.
  const exemptLines = [line(3, 3.5), line(1, 5.25, 0, "IVA_EXENTO")];
  const withExempt = calculatePurchaseTotals(frontLines(exemptLines), { tasaIva: 0.13, tipoDocumento: "factura", montoDecimales: 2 });
  assert.deepEqual([withExempt.neto, withExempt.montoExento, withExempt.iva, withExempt.total], [15.75, 5.25, 1.37, 17.12]);
  // Boleta: el IVA va incluido en el precio y no se separa.
  const boleta = calculatePurchaseTotals(frontLines(exemptLines), { tasaIva: 0.13, tipoDocumento: "boleta", montoDecimales: 2 });
  assert.deepEqual([boleta.neto, boleta.montoExento, boleta.iva, boleta.total], [15.75, 0, 0, 15.75]);
  // Sin tipo de documento: cálculo anterior (IVA sobre todo el neto).
  assert.equal(calculatePurchaseTotals(frontLines(exemptLines), { tasaIva: 0.13, montoDecimales: 2 }).iva, 2.05, "15,75 × 13 % = 2,0475 → 2,05");

  // Servidor: mismos números.
  const backExempt = serverPurchaseTotals(exemptLines, 2, 0.13, "factura");
  assert.deepEqual([backExempt.neto, backExempt.montoExento, backExempt.iva, backExempt.total], [15.75, 5.25, 1.37, 17.12]);
  assert.equal(serverPurchaseTotals(exemptLines, 2, 0.13, "boleta").iva, 0);
  assert.equal(serverPurchaseTotals(exemptLines, 2, 0.13, "boleta").total, 15.75);
  const backOrder = serverOrder.calculateTotals(serverOrderLines([line(3, 3.5, 10)], 2), HttpsError, 0.13, 2);
  assert.deepEqual([backOrder.subtotal, backOrder.descuentoTotal, backOrder.neto, backOrder.iva, backOrder.total], [10.5, 1.05, 9.45, 1.23, 10.68]);
}

// --- Recalcular un documento guardado da lo mismo ---
{
  const lines = [line(3, 3.5, 10), line(2.5, 19.99, 5), line(1, 0.07), line(4, 1.25, 0, "IVA_EXENTO")];
  const stored = serverPurchaseLines(lines, 2);
  const totals = serverPurchase.calculatePurchaseTotals(stored, HttpsError, 0.13, { tipoDocumento: "factura", decimals: 2 });
  const adapted = adaptStoredPurchase({ compraId: "c1", moneda: "BOB", tasaIva: 0.13, montoDecimales: 2, modeloIvaCompraVersion: 1, tipoDocumento: "factura", items: stored, ...totals });
  for (const key of Object.keys(totals)) assert.equal(adapted[key], totals[key], `compra guardada: ${key} se recalcula igual`);
  adapted.items.forEach((item, index) => {
    for (const key of ["subtotalLinea", "descuentoLinea", "totalLinea"]) assert.equal(item[key], stored[index][key], `línea ${index}: ${key}`);
  });
  assert.equal(adapted.montoDecimales, 2);
  // Un documento sin snapshot se recalcula entero (documento anterior).
  assert.equal(adaptStoredPurchase({ compraId: "c1", moneda: "BOB", tasaIva: 0.13, items: stored }).montoDecimales, 0);

  const orderLines = serverOrderLines(lines, 2);
  const orderTotals = serverOrder.calculateTotals(orderLines, HttpsError, 0.13, 2);
  const adaptedOrder = adaptStoredPurchaseOrder({ ordenCompraId: "o1", moneda: "BOB", tasaIva: 0.13, montoDecimales: 2, items: orderLines, ...orderTotals });
  for (const key of Object.keys(orderTotals)) assert.equal(adaptedOrder[key], orderTotals[key], `orden guardada: ${key} se recalcula igual`);
  assert.equal(adaptedOrder.montoDecimales, 2);
  adaptedOrder.items.forEach((item, index) => {
    for (const key of ["subtotalLinea", "descuentoLinea", "totalLinea"]) assert.equal(item[key], orderLines[index][key], `línea de orden ${index}: ${key}`);
  });
}

// --- Generadores deterministas ---
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = random(362);
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (list) => list[int(0, list.length - 1)];
const PERCENTS = [0, 0, 5, 10, 12.5, 15, 20, 33.33, 50, 100];
const RATES = [0.13, 0.19, 0.1, 0.16, 0.21];
const DOCUMENT_TYPES = [undefined, "factura", "boleta", "sin_documento", "otro"];
const randomLines = (decimals) => Array.from({ length: int(1, 8) }, () => line(
  pick([1, 2, 3, 5, 10, int(1, 40), int(1, 9999) / 1000]),
  decimals > 0 ? int(0, 900000) / 100 : pick([int(0, 9000000), int(0, 9000000) / 10, int(0, 90000000) / 1000]),
  pick(PERCENTS),
  rand() > 0.7 ? "IVA_EXENTO" : ""
));

// --- Paridad frontend/Functions con entradas aleatorias, con 2 decimales ---
const isTwoDecimals = (value) => isMoneyAmount(value, 2);
let parity = 0;
for (let i = 0; i < 4000; i += 1) {
  const lines = randomLines(2);
  const rate = pick(RATES);
  const tipoDocumento = pick(DOCUMENT_TYPES);
  const front = calculatePurchaseTotals(frontLines(lines), { tasaIva: rate, tipoDocumento, montoDecimales: 2 });
  const back = serverPurchaseTotals(lines, 2, rate, tipoDocumento);
  for (const key of Object.keys(front)) {
    assert.ok(Object.is(front[key], back[key]), `compra ${key}: frontend ${front[key]} != servidor ${back[key]}`);
    assert.ok(isTwoDecimals(front[key]), `compra ${key} con más de 2 decimales: ${front[key]}`);
  }
  assert.equal(front.total, sumMoney([front.neto, front.iva], 2), "total = neto + IVA");
  assert.equal(front.neto, sumMoney([front.subtotal, -front.descuentoTotal], 2));
  const taxable = tipoDocumento === undefined ? front.neto : sumMoney([front.neto, -front.montoExento], 2);
  assert.equal(front.iva, tipoDocumento === "boleta" ? 0 : mulRound(taxable, rate, 2), "IVA una sola vez sobre el neto (menos el exento)");
  if (tipoDocumento !== "boleta") {
    const cents = Math.round(taxable * 100);
    assert.equal(front.iva, Math.floor((2 * cents * Math.round(rate * 100) + 100) / 200) / 100, "IVA contra el oráculo de centavos");
  }
  // Orden con los mismos datos.
  const orderFront = calculatePurchaseOrderTotals(frontLines(lines), { tasaIva: rate, montoDecimales: 2 });
  const orderBack = serverOrder.calculateTotals(serverOrderLines(lines, 2), HttpsError, rate, 2);
  for (const key of Object.keys(orderFront)) {
    assert.ok(Object.is(orderFront[key], orderBack[key]), `orden ${key}: frontend ${orderFront[key]} != servidor ${orderBack[key]}`);
    assert.ok(isTwoDecimals(orderFront[key]));
  }
  // Orden y compra (sin tipo de documento) dan lo mismo: la compra desde una orden no cambia ningún importe.
  const legacyPurchase = calculatePurchaseTotals(frontLines(lines), { tasaIva: rate, montoDecimales: 2 });
  for (const key of ["subtotal", "descuentoTotal", "neto", "iva", "total"]) assert.ok(Object.is(orderFront[key], legacyPurchase[key]), `orden y compra coinciden en ${key}`);
  // Recepción: el total estimado es el de la compra equivalente.
  const impact = getReceptionConfirmationImpact(frontLines(lines).map((l) => ({ ...l, tipoItem: "servicio" })), rate, 2);
  assert.ok(Object.is(impact.totalCompraEstimado, legacyPurchase.total), "recepción: total estimado = total de la compra");
  parity += 1;
}

// --- Con montoDecimales ausente o 0: exactamente las fórmulas anteriores (copiadas tal cual; no tocar) ---
const legacyLine = (l) => {
  const subtotalLinea = Math.round(l.cantidad * l.costo);
  const descuentoLinea = Math.round((subtotalLinea * l.descuento) / 100);
  return { subtotalLinea, descuentoLinea, totalLinea: subtotalLinea - descuentoLinea };
};
const legacyPurchaseTotals = (lines, rate, tipoDocumento) => {
  const calculated = lines.map(legacyLine);
  const subtotal = calculated.reduce((sum, l) => sum + l.subtotalLinea, 0);
  const descuentoTotal = calculated.reduce((sum, l) => sum + l.descuentoLinea, 0);
  const neto = subtotal - descuentoTotal;
  if (tipoDocumento === undefined) {
    const iva = Math.round(neto * rate);
    return { subtotal, descuentoTotal, neto, iva, total: neto + iva };
  }
  const montoExento = lines
    .filter((l) => (tipoDocumento === "boleta" ? false : l.impuestoId === "IVA_EXENTO"))
    .reduce((sum, l) => sum + legacyLine(l).totalLinea, 0);
  const iva = tipoDocumento === "boleta" ? 0 : Math.round((neto - montoExento) * rate);
  return { subtotal, descuentoTotal, neto, montoExento, iva, total: neto + iva };
};
const legacyReceptionImpact = (lines, rate) => {
  const neto = lines.reduce((sum, l) => {
    const subtotal = Math.round(Number(l.cantidad) * Number(l.costo || 0));
    const descuento = Math.round(subtotal * Number(l.descuento || 0) / 100);
    return sum + subtotal - descuento;
  }, 0);
  return neto + Math.round(neto * rate);
};
let chile = 0;
for (let i = 0; i < 4000; i += 1) {
  const lines = randomLines(0);
  const rate = pick(RATES);
  const tipoDocumento = pick(DOCUMENT_TYPES);
  const montoDecimales = pick([undefined, 0, null]);
  const options = montoDecimales === undefined ? {} : { montoDecimales };
  let expected;
  try {
    expected = legacyPurchaseTotals(lines, rate, tipoDocumento);
    for (const value of Object.values(expected)) assert.ok(Number.isSafeInteger(value));
  } catch {
    expected = null;
  }
  if (expected) {
    // El montoExento de la compra boleta: la fórmula anterior lo calcula con el tratamiento de cada línea; la boleta lo deja en 0.
    const front = calculatePurchaseTotals(frontLines(lines), { tasaIva: rate, tipoDocumento, ...options });
    const back = serverPurchaseTotals(lines, montoDecimales, rate, tipoDocumento);
    for (const key of ["subtotal", "descuentoTotal", "neto", "iva", "total"]) {
      assert.ok(Object.is(front[key], expected[key]), `Chile compra ${key}: ${front[key]} != ${expected[key]}`);
      assert.ok(Object.is(back[key], expected[key]), `Chile compra (servidor) ${key}: ${back[key]} != ${expected[key]}`);
    }
    if (tipoDocumento !== undefined && tipoDocumento !== "boleta") {
      assert.ok(Object.is(front.montoExento, expected.montoExento), "Chile compra montoExento");
      assert.ok(Object.is(back.montoExento, expected.montoExento));
    }
    const orderExpected = legacyPurchaseTotals(lines, rate, undefined);
    const orderFront = calculatePurchaseOrderTotals(frontLines(lines), { tasaIva: rate, ...options });
    const orderBack = serverOrder.calculateTotals(serverOrderLines(lines, montoDecimales), HttpsError, rate, montoDecimales);
    for (const key of ["subtotal", "descuentoTotal", "neto", "iva", "total"]) {
      assert.ok(Object.is(orderFront[key], orderExpected[key]), `Chile orden ${key}`);
      assert.ok(Object.is(orderBack[key], orderExpected[key]), `Chile orden (servidor) ${key}`);
    }
  }
  const impact = getReceptionConfirmationImpact(lines.map((l) => ({ cantidad: l.cantidad, costoUnitario: l.costo, descuentoPct: l.descuento, tipoItem: "servicio" })), rate, montoDecimales);
  assert.ok(Object.is(impact.totalCompraEstimado, legacyReceptionImpact(lines, rate)), "Chile recepción: total estimado");
  chile += 1;
}

// --- Validación: con decimales, hasta d decimales; con 0, sin límites nuevos ---
{
  assert.throws(() => calculatePurchaseLine({ cantidad: 1, costoUnitario: 3.555 }, 0, 2), /costo unitario admite hasta 2 decimales/);
  assert.throws(() => calculatePurchaseOrderLine({ cantidad: 1, costoUnitario: 3.555 }, 0, 2), /costo unitario admite hasta 2 decimales/);
  assert.doesNotThrow(() => calculatePurchaseLine({ cantidad: 2.345, costoUnitario: 3.5, descuentoPct: 12.345 }, 0, 2), "cantidad y porcentaje no se limitan");
  assert.doesNotThrow(() => calculatePurchaseOrderLine({ cantidad: 2.345, costoUnitario: 3.5, descuentoPct: 12.345 }, 0, 2));
  // Con 0 decimales no hay límite nuevo: un costo con decimales se acepta y se redondea la línea.
  assert.equal(calculatePurchaseLine({ cantidad: 3, costoUnitario: 1234.567 }, 0).subtotalLinea, 3704);
  assert.equal(calculatePurchaseOrderLine({ cantidad: 3, costoUnitario: 1234.567 }, 0).subtotalLinea, 3704);
  const purchaseInput = (cost) => serverPurchase.normalizePurchaseInput({ proveedorId: "p1", fechaCompra: "2026-11-20", items: [{ lineaId: "l1", itemId: "i1", cantidad: 1, costoUnitario: cost }] }, HttpsError);
  const orderInput = (cost) => serverOrder.normalizePurchaseOrderInput({ proveedorId: "p1", items: [{ lineaId: "l1", itemId: "i1", cantidad: 1, costoUnitario: cost }] }, HttpsError);
  assert.throws(() => serverPurchase.assertPurchaseAmountDecimals(purchaseInput(3.555), 2, HttpsError), (error) => error.code === "invalid-argument" && /costo unitario admite hasta 2 decimales/.test(error.message));
  assert.throws(() => serverOrder.assertPurchaseOrderAmountDecimals(orderInput(3.555), 2, HttpsError), /costo unitario admite hasta 2 decimales/);
  assert.throws(() => serverReception.assertReceptionAmountDecimals([{ costoUnitario: 3.555 }], 2, HttpsError), /admite hasta 2 decimales/);
  assert.doesNotThrow(() => serverPurchase.assertPurchaseAmountDecimals(purchaseInput(3.55), 2, HttpsError));
  assert.doesNotThrow(() => serverPurchase.assertPurchaseAmountDecimals(purchaseInput(3.555), 0, HttpsError), "con 0 decimales no hay límite nuevo");
  assert.doesNotThrow(() => serverOrder.assertPurchaseOrderAmountDecimals(orderInput(3.555), 0, HttpsError));
  assert.doesNotThrow(() => serverReception.assertReceptionAmountDecimals([{ costoUnitario: 3.555 }], 0, HttpsError));
  // El payload del cliente valida con los decimales del borrador y no los envía.
  const purchasePayload = buildPurchaseMutationPayload({ proveedorId: "p1", items: [{ lineaId: "l1", itemId: "i1", cantidad: 3, costoUnitario: 3.5 }], montoDecimales: 2 });
  assert.equal(Object.hasOwn(purchasePayload, "montoDecimales"), false);
  assert.throws(() => buildPurchaseMutationPayload({ proveedorId: "p1", items: [{ lineaId: "l1", itemId: "i1", cantidad: 1, costoUnitario: 3.555 }], montoDecimales: 2 }), /admite hasta 2 decimales/);
  assert.doesNotThrow(() => buildPurchaseMutationPayload({ proveedorId: "p1", items: [{ lineaId: "l1", itemId: "i1", cantidad: 1, costoUnitario: 3.555 }] }));
  const orderPayload = buildPurchaseOrderMutationPayload({ proveedorId: "p1", items: [{ lineaId: "l1", itemId: "i1", cantidad: 3, costoUnitario: 3.5 }], montoDecimales: 2 });
  assert.equal(Object.hasOwn(orderPayload, "montoDecimales"), false);
  assert.throws(() => buildPurchaseOrderMutationPayload({ proveedorId: "p1", items: [{ lineaId: "l1", itemId: "i1", cantidad: 1, costoUnitario: 3.555 }], montoDecimales: 2 }), /admite hasta 2 decimales/);
  // Los normalizadores del servidor descartan el valor del cliente.
  const sneaky = serverPurchase.normalizePurchaseInput({ proveedorId: "p1", fechaCompra: "2026-11-20", montoDecimales: 2, items: [{ lineaId: "l1", itemId: "i1", cantidad: 1, costoUnitario: 3.5, montoDecimales: 2 }] }, HttpsError);
  assert.equal(JSON.stringify(sneaky).includes("montoDecimales"), false, "el servidor no lee montoDecimales del cliente (compra)");
  const sneakyOrder = serverOrder.normalizePurchaseOrderInput({ proveedorId: "p1", montoDecimales: 2, items: [{ lineaId: "l1", itemId: "i1", cantidad: 1, costoUnitario: 3.5 }] }, HttpsError);
  assert.equal(JSON.stringify(sneakyOrder).includes("montoDecimales"), false, "el servidor no lee montoDecimales del cliente (orden)");
}

// --- Validación de importes máximos (safeMoney): idéntica con 0 decimales; con decimales, hasta d decimales ---
{
  assert.throws(() => calculatePurchaseTotals(frontLines([line(1, 1e16)]), { montoDecimales: 0 }), /máximo permitido/);
  assert.throws(() => calculatePurchaseTotals(frontLines([line(1, 1e14)]), { montoDecimales: 2 }), /máximo permitido/);
  assert.doesNotThrow(() => calculatePurchaseTotals(frontLines([line(1, 1e12)]), { montoDecimales: 2 }));
  assert.throws(() => calculatePurchaseOrderTotals(frontLines([line(1, 1e16)]), { montoDecimales: 0 }), /máximo permitido/);
  assert.throws(() => calculatePurchaseOrderTotals(frontLines([line(1, 1e14)]), { montoDecimales: 2 }), /máximo permitido/);
  assert.throws(() => serverPurchaseTotals([line(1, 1e16)], 0, 0.19, undefined), /máximo permitido/);
  assert.throws(() => serverPurchaseTotals([line(1, 1e14)], 2, 0.13, undefined), /máximo permitido/);
  assert.throws(() => serverOrder.calculateTotals(serverOrderLines([line(1, 1e16)], 0), HttpsError, 0.19, 0), /máximo permitido/);
}

// --- Tolerancia de coherencia de documentos de compra con decimales ---
{
  // Con decimales la tolerancia es 0,01 × líneas (media unidad menor por componente y línea en cada emisor): sigue siendo correcta.
  assert.equal(serverPurchase.documentTotalsTolerance("BOB", 1), 0.01);
  assert.equal(serverPurchase.documentTotalsTolerance("BOB", 21), 0.21);
  assert.equal(serverPurchase.documentTotalsTolerance("CLP", 21), 21, "CLP no cambia");
  const lines = [line(3, 3.5), line(1, 0.07), line(2, 19.99, 10)];
  const calculated = serverPurchaseTotals(lines, 2, 0.13, "factura");
  const source = (overrides = {}) => ({ moneda: "BOB", neto: calculated.neto, impuestoMonto: calculated.iva, total: calculated.total, ...overrides });
  const state = (declared) => serverPurchase.documentCoherenceState(declared, calculated, { currency: "BOB", tipoDocumento: "factura", lineCount: lines.length });
  assert.equal(state(source()), "coherente");
  assert.equal(state(source({ impuestoMonto: calculated.iva + 0.02 })), "coherente", "otro emisor redondea por línea: 0,02 de diferencia en 3 líneas");
  assert.equal(state(source({ total: calculated.total + 0.03 })), "coherente", "dentro de 0,01 × 3 líneas");
  assert.equal(state(source({ total: calculated.total + 0.04 })), "revisar", "sobre la tolerancia");
  assert.equal(state(source({ neto: calculated.neto + 1 })), "revisar", "un boliviano de diferencia siempre se revisa");
  // El mismo documento calculado con 0 decimales (como hoy) difiere en centavos del declarado con decimales: por eso con 0 en BOB
  // el servidor sigue marcándolo; con decimales calza.
  const rounded = serverPurchaseTotals(lines, 0, 0.13, "factura");
  assert.notEqual(rounded.total, calculated.total);
}

// --- Herencia orden → recepción → compra con una base de datos falsa en memoria ---
{
  const stored = new Map();
  let autoId = 0;
  const makeRef = (path) => ({
    id: path.split("/").pop(), path,
    collection: (name) => ({
      doc: (docId = `auto${autoId += 1}`) => makeRef(`${path}/${name}/${docId}`),
      where: () => { const query = { __query: `${path}/${name}`, limit: () => query }; return query; },
    }),
  });
  const snapshotOf = (ref) => ({ id: ref.id, exists: stored.has(ref.path), data: () => stored.get(ref.path) });
  const transaction = {
    get: async (target) => (target.__query ? { empty: true, docs: [], size: 0, forEach() {} } : snapshotOf(target)),
    getAll: async (...refs) => refs.map(snapshotOf),
    create: (ref, data) => stored.set(ref.path, data),
    set: (ref, data) => stored.set(ref.path, data),
    update: (ref, data) => stored.set(ref.path, { ...(stored.get(ref.path) || {}), ...data }),
  };
  const businessRef = makeRef("negocios/b1");
  const dependencies = {
    db: { runTransaction: (operation) => operation(transaction) },
    FieldValue: { serverTimestamp: () => "ts" },
    HttpsError,
    requireBusinessAccess: async () => ({ uid: "u1", businessId: "b1", businessRef }),
  };
  const clock = new Date("2026-11-20T15:00:00Z");
  const orderBase = {
    negocioId: "b1", numero: "OC-2026-0001", estado: "emitida", proveedorId: "prov1", proveedorSnapshot: { proveedorId: "prov1", razonSocial: "Proveedor SRL" },
    moneda: "BOB", paisCodigo: "BO", locale: "es-BO", tasaIva: 0.13, impuestoNombre: "IVA", condicionesPago: "contado", observaciones: "",
    items: [
      { lineaId: "l1", itemId: "svc1", nombre: "Servicio", tipoItem: "servicio", unidad: "unidad", cantidad: 3, costoUnitario: 3.5, descuentoPct: 10 },
      { lineaId: "l2", itemId: "svc2", nombre: "Otro", tipoItem: "servicio", unidad: "unidad", cantidad: 1, costoUnitario: 0.07, descuentoPct: 0 },
    ],
  };
  const put = (path, data) => stored.set(path, data);
  put("negocios/b1/ordenesCompra/o-dec", { ...orderBase, montoDecimales: 2 });
  put("negocios/b1/ordenesCompra/o-int", { ...orderBase, items: orderBase.items.map((item) => ({ ...item, costoUnitario: Math.round(item.costoUnitario) })) });
  put("negocios/b1/ordenesCompra/o-bad", { ...orderBase, montoDecimales: "2" });
  put("negocios/b1/ordenesCompra/o-direct", { ...orderBase, montoDecimales: 2 });
  put("negocios/b1/ordenesCompra/o-direct-int", { ...orderBase });

  // 1) Orden con 2 decimales -> recepción hereda montoDecimales.
  const receptionResult = await serverReception.crearRecepcionDesdeOrdenHandler({ data: { ordenCompraId: "o-dec", requestId: "request-dec-0001" } }, dependencies, clock);
  const reception = receptionResult.recepcion;
  assert.equal(reception.montoDecimales, 2, "la recepción hereda montoDecimales de la orden");
  assert.equal(reception.moneda, "BOB");
  assert.deepEqual(reception.items.map((l) => l.costoUnitario), [3.5, 0.07]);
  // 2) Recepción confirmada -> compra hereda el de la recepción (no el del catálogo, que sigue en 0).
  const purchase = serverPurchase.buildConfirmedPurchaseFromReception({
    business: {}, businessId: "b1", companyProfile: {}, HttpsError, numero: "COM-2026-0001", order: stored.get("negocios/b1/ordenesCompra/o-dec"),
    purchaseId: "p-rec", reception, sequence: 1, taxIdsByItem: new Map(), timestamp: "ts", uid: "u1", year: 2026,
  });
  assert.equal(purchase.montoDecimales, 2, "la compra desde recepción hereda montoDecimales");
  assert.deepEqual([purchase.subtotal, purchase.descuentoTotal, purchase.neto, purchase.iva, purchase.total], [10.57, 1.05, 9.52, 1.24, 10.76]);
  assert.deepEqual(purchase.items.map((l) => l.totalLinea), [9.45, 0.07]);
  // 3) Compra desde una orden (flujo anterior, sin recepciones) -> hereda el de la orden.
  const fromOrder = await serverPurchase.crearCompraDesdeOrdenHandler({ data: { ordenCompraId: "o-direct", requestId: "request-order-0001" } }, dependencies, clock);
  assert.equal(fromOrder.compra.montoDecimales, 2, "la compra desde orden hereda montoDecimales");
  assert.deepEqual([fromOrder.compra.neto, fromOrder.compra.iva, fromOrder.compra.total], [9.52, 1.24, 10.76]);
  // 4) Sin snapshot (orden anterior o de Chile): ninguna lleva el campo y todo se calcula entero.
  const receptionInt = (await serverReception.crearRecepcionDesdeOrdenHandler({ data: { ordenCompraId: "o-int", requestId: "request-int-0001" } }, dependencies, clock)).recepcion;
  assert.equal(Object.hasOwn(receptionInt, "montoDecimales"), false);
  const purchaseInt = serverPurchase.buildConfirmedPurchaseFromReception({
    business: {}, businessId: "b1", companyProfile: {}, HttpsError, numero: "COM-2026-0002", order: stored.get("negocios/b1/ordenesCompra/o-int"),
    purchaseId: "p-int", reception: receptionInt, sequence: 2, taxIdsByItem: new Map(), timestamp: "ts", uid: "u1", year: 2026,
  });
  assert.equal(Object.hasOwn(purchaseInt, "montoDecimales"), false);
  assert.ok(Number.isInteger(purchaseInt.total));
  const directInt = await serverPurchase.crearCompraDesdeOrdenHandler({ data: { ordenCompraId: "o-direct-int", requestId: "request-order-0002" } }, dependencies, clock);
  assert.equal(Object.hasOwn(directInt.compra, "montoDecimales"), false);
  // 5) Un snapshot inválido (texto) vale 0.
  const badReception = (await serverReception.crearRecepcionDesdeOrdenHandler({ data: { ordenCompraId: "o-bad", requestId: "request-bad-0001" } }, dependencies, clock)).recepcion;
  assert.equal(Object.hasOwn(badReception, "montoDecimales"), false);
}

// --- Fuentes: la localización de cada documento sale del servidor ---
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [purchaseServer, orderServer, receptionServer, purchasePage, orderPage, receptionPage, purchaseEditor, orderEditor, purchaseQuantityStepper] = await Promise.all([
  read("functions/purchasePersistence.js"), read("functions/purchaseOrderPersistence.js"), read("functions/receptionPersistence.js"),
  read("src/pages/NewPurchasePage.jsx"), read("src/pages/NewPurchaseOrderPage.jsx"), read("src/pages/NewReceptionPage.jsx"),
  read("src/features/purchases/PurchaseItemsEditor.jsx"), read("src/features/purchaseOrders/PurchaseOrderItemsEditor.jsx"),
  read("src/components/ui/QuantityStepper.jsx"),
]);
// Cada llamada a documentLocalizationSnapshot (crear) usa los documentos del negocio leídos por el servidor, y cada llamada a
// adaptDocumentLocalization (heredar, editar, duplicar) usa un documento guardado: nunca el payload del cliente.
const callsOf = (source, name) => [...source.matchAll(new RegExp(`${name}\\(([^)]*)\\)`, "g"))].map((match) => match[1].replace(/\s+/g, " ").trim());
const ALLOWED_STORED = new Set(["source", "existing", "order", "reception", "quote"]);
for (const [name, source] of [["purchasePersistence", purchaseServer], ["purchaseOrderPersistence", orderServer], ["receptionPersistence", receptionServer]]) {
  const stripped = source.replace(/\/\/.*$/gm, "");
  const adapt = callsOf(stripped, "adaptDocumentLocalization").filter((argument) => !argument.startsWith("raw") || true);
  for (const argument of adapt) {
    if (argument === "{}") continue; // valor por defecto cuando no hay localización
    assert.ok(ALLOWED_STORED.has(argument), `${name}: adaptDocumentLocalization(${argument}) debe leer un documento guardado`);
  }
  const collapsed = stripped.replace(/\s+/g, " ");
  const snapshotCalls = (collapsed.match(/documentLocalizationSnapshot\(/g) || []).length;
  const businessCalls = (collapsed.match(/documentLocalizationSnapshot\( ?snapshots\[2\]\.data\(\) \|\| \{\}, ?snapshots\[3\]\.data\(\) \|\| \{\} ?\)/g) || []).length;
  assert.equal(snapshotCalls, businessCalls, `${name}: todo snapshot sale de los documentos del negocio leídos por el servidor`);
  assert.doesNotMatch(stripped, /(raw|request\??\.data|\bdata)\??\.montoDecimales/, `${name}: no lee montoDecimales de los datos del cliente`);
}
assert.equal(callsOf(purchaseServer, "adaptDocumentLocalization").filter((a) => a === "reception").length, 2, "compra desde recepción: builder y handler heredan de la recepción");
assert.ok(callsOf(purchaseServer, "adaptDocumentLocalization").includes("order"), "compra desde orden hereda de la orden");
assert.ok(callsOf(purchaseServer, "adaptDocumentLocalization").includes("existing"), "editar compra conserva el del documento");
assert.equal((purchaseServer.match(/documentLocalizationSnapshot\(/g) || []).length, 1, "compra directa: snapshot del negocio");
assert.equal((orderServer.match(/documentLocalizationSnapshot\(/g) || []).length, 1, "crear orden: snapshot del negocio");
assert.deepEqual(callsOf(orderServer, "adaptDocumentLocalization").sort(), ["existing", "existing", "source"], "orden: duplicar hereda de la origen; editar conserva el del documento");
assert.deepEqual(callsOf(receptionServer, "adaptDocumentLocalization").sort(), ["order", "reception"], "recepción: hereda de la orden; editar conserva el del documento");
for (const [name, source] of [["purchasePersistence", purchaseServer], ["purchaseOrderPersistence", orderServer]]) {
  // (quedan Math.round de conteos y bytes del documento importado, que no son importes)
  const withoutCounts = source.replace(/\/\/.*$/gm, "").replace(/.*(lineasDetectadas|lineasAplicadas|tamanoBytes).*\r?\n/g, "");
  assert.doesNotMatch(withoutCounts, /Math\.round\(/, `${name}: ningún Math.round en los importes`);
  assert.doesNotMatch(source, /Number\.isSafeInteger\(value\)/, `${name}: safeMoney ya no exige enteros`);
}
// Los inputs de costo: "any" con 0 decimales (como hoy) y "0.01" con 2; la cantidad y el porcentaje no cambian.
for (const [name, source] of [["NewPurchasePage", purchasePage], ["NewPurchaseOrderPage", orderPage]]) {
  assert.match(source, /const moneyStep = documentDecimals > 0 \? String\(10 \*\* -documentDecimals\) : "any";/, `${name}: moneyStep`);
  assert.match(source, /moneyStep=\{moneyStep\}/, `${name}: pasa moneyStep al editor`);
}
assert.match(receptionPage, /const moneyStep = documentDecimals > 0 \? String\(10 \*\* -documentDecimals\) : "any";/);
assert.match(receptionPage, /className="ui-doc-line__input" type="number" min="0" step=\{moneyStep\}/, "el costo de la recepción usa el campo compartido ui-doc-line__input");
assert.match(receptionPage, /className="ui-doc-line__input" type="number" min="0" max=\{pending\} step="any"/, "la cantidad recibida no cambia");
assert.match(receptionPage, /className="ui-doc-line__input" type="number" min="0" max="100" step="any"/, "el descuento no cambia");
// Los editores de Compra y de Orden de compra son envoltorios del bloque compartido DocumentItemsEditor: el paso del importe
// llega por `moneyStep` y el bloque dibuja los campos (el costo con su aria-label; la cantidad en QuantityStepper).
const itemsBlock = await read("src/components/ui/DocumentItemsEditor.jsx");
for (const [name, source] of [["PurchaseItemsEditor", purchaseEditor], ["PurchaseOrderItemsEditor", orderEditor]]) {
  assert.match(source, /moneyStep = "any"/, `${name}: por defecto "any" (como hoy)`);
  assert.match(source, /moneyStep=\{moneyStep\}/, `${name}: pasa moneyStep al bloque compartido`);
  assert.match(source, /mode="compra"/, `${name}: costo unitario`);
}
assert.match(itemsBlock, /moneyStep = "any"/, "bloque compartido: por defecto \"any\" (como hoy)");
assert.match(itemsBlock, /aria-label=\{`\$\{priceLabel\} de \$\{item\.nombre\}`\}[^>]*step=\{moneyStep\}/, "bloque compartido: el importe usa moneyStep");
assert.match(purchaseQuantityStepper, /min="0\.000001"[^>]*step="any"/,"la cantidad sigue en \"any\"");
assert.match(itemsBlock, /<QuantityStepper /, "bloque compartido: la cantidad vive en QuantityStepper");
assert.match(itemsBlock, /min="0" max="100" step="any"/, "bloque compartido: el porcentaje sigue en \"any\"");
assert.match(purchasePage, /const documentDecimals = purchase\s+\? adaptDocumentAmountDecimals\(purchase, purchase\.moneda\)\s+: businessMoney\.amountDecimals;/);
assert.match(orderPage, /const documentDecimals = order\s+\? adaptDocumentAmountDecimals\(order, order\.moneda\)\s+: businessMoney\.amountDecimals;/);
assert.match(receptionPage, /adaptDocumentAmountDecimals\(reception \|\| \{\}, reception\?\.moneda\)/);
assert.deepEqual(adaptDocumentLocalization({ moneda: "BOB", montoDecimales: 2 }).montoDecimales, 2);
assert.equal(serverLocalization.adaptDocumentLocalization({ moneda: "BOB", montoDecimales: 2 }).montoDecimales, 2);

console.log("PURCHASE_DECIMALS_SMOKE_OK", JSON.stringify({ parity, chile }));
