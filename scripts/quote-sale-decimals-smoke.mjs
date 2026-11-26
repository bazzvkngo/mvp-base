import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { adaptDocumentLocalization } from "../src/domain/localization.mjs";
import { hasMaxDecimals, isMoneyAmount, mulRound, sanitizeDecimals, sumMoney } from "../src/domain/money.mjs";
import {
  adaptStoredQuote,
  buildQuotePayload,
  calculateQuoteLineAmounts,
  calculateQuoteTotals,
  normalizeQuoteItems,
  validateQuoteDraft,
} from "../src/domain/quoteModel.mjs";
import {
  SALE_COMMERCIAL_MARGIN_STATUS as STATUS,
  calculateSaleCommercialMarginV1,
  calculateSaleProductLineMarginsV1,
} from "../src/domain/saleCommercialMargin.mjs";
import { adaptStoredSale, buildSaleMutationPayload, calculateSaleLine, calculateSaleTotals } from "../src/domain/saleModel.mjs";

// SPEC 036, entrega B1: cotizaciones y ventas con decimales por documento (`montoDecimales`). Los modelos reciben
// montoDecimales: 2 directamente (el catálogo sigue en 0). Con montoDecimales ausente o 0 todo da lo mismo que antes.
const require = createRequire(import.meta.url);
const serverLocalization = require("../functions/localization.js");
const serverQuote = require("../functions/quotePersistence.js");
const serverSale = require("../functions/salePersistence.js");

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const SERVER_QUOTE_OPTIONS = (montoDecimales, tasaIva = 0.13) => ({
  clientFields: { clienteId: "cliente-1" },
  companySnapshot: {},
  localization: serverLocalization.adaptDocumentLocalization({
    paisCodigo: "BO", moneda: "BOB", locale: "es-BO", impuestoNombre: "IVA", tasaIva, montoDecimales,
  }),
});
const serverQuoteFor = (raw, montoDecimales, tasaIva) =>
  serverQuote.normalizeQuoteInput("uid-1", raw, "2026-11-20", HttpsError, SERVER_QUOTE_OPTIONS(montoDecimales, tasaIva));
const SERVICE_SNAPSHOT = { inventarioId: "", codigoInterno: "", nombre: "Servicio", descripcion: "", tipoItem: "servicio", unidad: "unidad" };
const serverSaleTotals = (lines, descuento, montoDecimales, tasaIva = 0.13, afectaIva = true) => {
  const items = lines.map((line, index) => serverSale.storedSaleLine(
    { lineaId: `l${index + 1}`, itemId: "", cantidad: line.cantidad, precioUnitario: line.precioUnitario, descuentoPct: line.descuentoPct ?? 0 },
    SERVICE_SNAPSHOT, HttpsError, {}, montoDecimales
  ));
  return { items, totals: serverSale.calculateSaleTotals(items, HttpsError, { descuentoGeneral: descuento, afectaIva, tasaIva, decimals: montoDecimales }) };
};

const quoteItem = (cantidad, price, discount = 0, extra = {}) => ({
  lineaId: `l-${Math.random()}`, nombre: "Servicio", tipoItem: "servicio", cantidad,
  precioUnitarioEditable: price, descuentoPorcentaje: discount, ...extra,
});
const saleLine = (cantidad, precioUnitario, descuentoPct = 0) => ({ cantidad, precioUnitario, descuentoPct });

// --- Los ejemplos del enunciado: 3 × Bs 3,50, IVA 13 %, descuentos ---
{
  const t = calculateQuoteTotals([quoteItem(3, 3.5)], 0, { tasaIva: 0.13, montoDecimales: 2 });
  assert.deepEqual([t.subtotal, t.neto, t.iva, t.total], [10.5, 10.5, 1.37, 11.87], "cotización: 3 × 3,50 = 10,50; 13 % = 1,37");
  const s = calculateSaleTotals([saleLine(3, 3.5)], 0, { tasaIva: 0.13, montoDecimales: 2 });
  assert.deepEqual([s.subtotal, s.neto, s.iva, s.total], [10.5, 10.5, 1.37, 11.87], "venta: 3 × 3,50 = 10,50; 13 % = 1,37");
  // Sin decimales (hoy en BOB): se redondea al entero, como hasta ahora.
  for (const options of [{}, { montoDecimales: 0 }, { montoDecimales: undefined }, { montoDecimales: null }, { montoDecimales: "2" }, { montoDecimales: 2.5 }, { montoDecimales: 9 }]) {
    const old = calculateQuoteTotals([quoteItem(3, 3.5)], 0, { tasaIva: 0.13, ...options });
    assert.deepEqual([old.subtotal, old.neto, old.iva, old.total], [11, 11, 1, 12], `cotización sin decimales ${JSON.stringify(options)}`);
    const oldSale = calculateSaleTotals([saleLine(3, 3.5)], 0, { tasaIva: 0.13, ...options });
    assert.deepEqual([oldSale.subtotal, oldSale.neto, oldSale.iva, oldSale.total], [11, 11, 1, 12], `venta sin decimales ${JSON.stringify(options)}`);
  }

  // Descuento de línea (10 %) y general (0,45): 10,50 − 1,05 − 0,45 = 9,00; IVA 1,17; total 10,17.
  const q = calculateQuoteTotals([quoteItem(3, 3.5, 10)], 0.45, { tasaIva: 0.13, montoDecimales: 2 });
  assert.deepEqual(
    [q.subtotal, q.descuentoItems, q.descuentoGeneral, q.descuentoTotal, q.neto, q.iva, q.total],
    [10.5, 1.05, 0.45, 1.5, 9, 1.17, 10.17]
  );
  assert.deepEqual([q.lineAmounts[0].bruto, q.lineAmounts[0].descuentoLinea, q.lineAmounts[0].totalLinea], [10.5, 1.05, 9.45]);
  const v = calculateSaleTotals([saleLine(3, 3.5, 10)], 0.45, { tasaIva: 0.13, montoDecimales: 2 });
  assert.deepEqual(
    [v.subtotal, v.descuentoItems, v.descuento, v.descuentoTotal, v.neto, v.iva, v.total],
    [10.5, 1.05, 0.45, 1.5, 9, 1.17, 10.17]
  );
  // Un descuento general mayor que el monto disponible se rechaza igual que antes.
  assert.throws(() => calculateQuoteTotals([quoteItem(3, 3.5)], 10.51, { montoDecimales: 2 }), /no puede superar/);
  assert.throws(() => calculateSaleTotals([saleLine(3, 3.5)], 10.51, { montoDecimales: 2 }), /no puede superar/);
  assert.equal(calculateSaleTotals([saleLine(3, 3.5)], 10.5, { montoDecimales: 2 }).neto, 0, "el descuento puede igualar el monto");
  // IVA exenta.
  assert.equal(calculateQuoteTotals([quoteItem(3, 3.5)], 0, { afectaIva: false, montoDecimales: 2 }).total, 10.5);
  assert.equal(calculateSaleTotals([saleLine(3, 3.5)], 0, { afectaIva: false, montoDecimales: 2 }).total, 10.5);

  // Servidor: mismos números, y `montoDecimales` solo se guarda cuando es > 0.
  const sq = serverQuoteFor({ items: [quoteItem(3, 3.5, 10)], descuento: 0.45 }, 2);
  assert.deepEqual([sq.subtotal, sq.descuentoItems, sq.descuento, sq.descuentoTotal, sq.neto, sq.iva, sq.total], [10.5, 1.05, 0.45, 1.5, 9, 1.17, 10.17]);
  assert.equal(sq.montoDecimales, 2);
  assert.equal(sq.moneda, "BOB");
  const sq0 = serverQuoteFor({ items: [quoteItem(3, 3.5)], descuento: 0 }, 0);
  assert.deepEqual([sq0.subtotal, sq0.neto, sq0.iva, sq0.total], [11, 11, 1, 12]);
  assert.equal(Object.hasOwn(sq0, "montoDecimales"), false, "con 0 decimales el documento no lleva el campo (Chile idéntico)");
  assert.equal(Object.hasOwn(serverQuoteFor({ items: [quoteItem(3, 3.5)] }, undefined), "montoDecimales"), false);
  const ss = serverSaleTotals([saleLine(3, 3.5, 10)], 0.45, 2);
  assert.deepEqual(
    [ss.totals.subtotal, ss.totals.descuentoItems, ss.totals.descuento, ss.totals.descuentoTotal, ss.totals.neto, ss.totals.iva, ss.totals.total],
    [10.5, 1.05, 0.45, 1.5, 9, 1.17, 10.17]
  );
}

// --- Recalcular un documento guardado da lo mismo ---
{
  const items = [quoteItem(3, 3.5, 10), quoteItem(2.5, 19.99, 5), quoteItem(1, 0.07)];
  const stored = serverQuoteFor({ items, descuento: 1.25 }, 2);
  const withoutTotals = { ...stored, id: "q1", empresaSnapshot: {}, modeloCotizacionVersion: 2 };
  for (const key of ["subtotal", "descuentoItems", "descuentoTotal", "neto", "iva", "total"]) delete withoutTotals[key]; // `descuento` es dato de entrada: se conserva
  const adapted = adaptStoredQuote(withoutTotals);
  for (const key of ["subtotal", "descuentoItems", "descuentoTotal", "neto", "iva", "total"]) {
    assert.equal(adapted[key], stored[key], `cotización guardada: ${key} se recalcula igual`);
  }
  assert.equal(adapted.montoDecimales, 2);
  adapted.items.forEach((item, index) => {
    for (const key of ["subtotalLinea", "descuentoLinea", "totalLinea"]) assert.equal(item[key], stored.items[index][key], `línea ${index}: ${key}`);
  });
  // El mismo documento sin snapshot se recalcula entero (documento anterior).
  const legacy = adaptStoredQuote({ ...withoutTotals, montoDecimales: undefined });
  assert.equal(legacy.montoDecimales, 0);

  const sale = serverSaleTotals([saleLine(3, 3.5, 10), saleLine(2.5, 19.99, 5), saleLine(1, 0.07)], 1.25, 2);
  const storedSale = { ventaId: "v1", moneda: "BOB", locale: "es-BO", tasaIva: 0.13, montoDecimales: 2, descuento: 1.25, items: sale.items, ...sale.totals };
  const adaptedSale = adaptStoredSale(storedSale);
  for (const key of ["subtotal", "descuentoItems", "descuentoTotal", "neto", "iva", "total"]) {
    assert.equal(adaptedSale[key], sale.totals[key], `venta guardada: ${key} se recalcula igual`);
  }
  adaptedSale.items.forEach((item, index) => {
    for (const key of ["subtotalLinea", "descuentoLinea", "totalLinea"]) assert.equal(item[key], sale.items[index][key], `línea de venta ${index}: ${key}`);
  });
  assert.equal(adaptedSale.montoDecimales, 2);
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
const rand = random(361);
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (list) => list[int(0, list.length - 1)];
const PERCENTS = [0, 0, 5, 10, 12.5, 15, 20, 33.33, 50, 100];
const RATES = [0.13, 0.19, 0.1, 0.16, 0.21];
const randomLines = (decimals) => Array.from({ length: int(1, 8) }, () => ({
  cantidad: pick([1, 2, 3, 5, 10, int(1, 40), int(1, 9999) / 1000]),
  // Con decimales, los precios tienen a lo sumo 2; con 0, cualquiera (Chile hoy no limita).
  precio: decimals > 0 ? int(0, 900000) / 100 : pick([int(0, 9000000), int(0, 9000000) / 10, int(0, 90000000) / 1000]),
  descuento: pick(PERCENTS),
}));

// --- Paridad frontend/Functions con entradas aleatorias, con 2 decimales ---
const isTwoDecimals = (value) => isMoneyAmount(value, 2);
let parity = 0;
for (let i = 0; i < 4000; i += 1) {
  const lines = randomLines(2);
  const rate = pick(RATES);
  const afectaIva = rand() > 0.15;
  const items = lines.map((line) => quoteItem(line.cantidad, line.precio, line.descuento));
  // Descuento general: hasta lo que queda tras los descuentos de línea.
  const available = calculateQuoteTotals(items, 0, { afectaIva, tasaIva: rate, montoDecimales: 2 });
  const maxGeneralCents = Math.round((available.subtotal - available.descuentoItems) * 100);
  const general = rand() > 0.5 ? int(0, maxGeneralCents) / 100 : 0;
  const front = calculateQuoteTotals(items, general, { afectaIva, tasaIva: rate, montoDecimales: 2 });
  const back = serverQuoteFor({ items, descuento: general, afectaIva }, 2, rate);
  for (const key of ["subtotal", "descuentoItems", "descuentoTotal", "neto", "iva", "total"]) {
    assert.ok(Object.is(front[key], back[key]), `cotización ${key}: frontend ${front[key]} != servidor ${back[key]}`);
    assert.ok(isTwoDecimals(front[key]), `cotización ${key} con más de 2 decimales: ${front[key]}`);
  }
  assert.ok(Object.is(front.descuentoGeneral, back.descuento));
  front.lineAmounts.forEach((line, index) => {
    assert.ok(Object.is(line.bruto, back.items[index].subtotalLinea), "subtotal de línea");
    assert.ok(Object.is(line.descuentoLinea, back.items[index].descuentoLinea), "descuento de línea");
    assert.ok(Object.is(line.totalLinea, back.items[index].totalLinea), "total de línea");
    assert.ok(isTwoDecimals(line.totalLinea));
  });
  // Invariantes: total = neto + IVA; neto = subtotal − descuentos; el IVA es el 13 % (u otra tasa) del neto con medio hacia arriba.
  assert.equal(front.total, sumMoney([front.neto, front.iva], 2));
  assert.equal(front.neto, sumMoney([front.subtotal, -front.descuentoTotal], 2));
  assert.equal(front.subtotal, sumMoney(front.lineAmounts.map((line) => line.bruto), 2));
  assert.equal(front.iva, afectaIva ? mulRound(front.neto, rate, 2) : 0);
  const netoCents = Math.round(front.neto * 100);
  const rateHundredths = Math.round(rate * 100);
  if (afectaIva) assert.equal(front.iva, Math.floor((2 * netoCents * rateHundredths + 100) / 200) / 100, "IVA contra el oráculo de centavos");
  // Venta con los mismos datos.
  const saleFront = calculateSaleTotals(lines.map((line) => saleLine(line.cantidad, line.precio, line.descuento)), general, { afectaIva, tasaIva: rate, montoDecimales: 2 });
  const saleBack = serverSaleTotals(lines.map((line) => saleLine(line.cantidad, line.precio, line.descuento)), general, 2, rate, afectaIva);
  for (const key of ["subtotal", "descuentoItems", "descuento", "descuentoTotal", "neto", "iva", "total"]) {
    assert.ok(Object.is(saleFront[key], saleBack.totals[key]), `venta ${key}: frontend ${saleFront[key]} != servidor ${saleBack.totals[key]}`);
    assert.ok(isTwoDecimals(saleFront[key]));
  }
  // Cotización y venta con los mismos datos dan lo mismo (la venta desde una cotización no cambia ningún importe).
  for (const key of ["subtotal", "descuentoItems", "descuentoTotal", "neto", "iva", "total"]) {
    assert.ok(Object.is(front[key], saleFront[key]), `cotización y venta coinciden en ${key}`);
  }
  parity += 1;
}

// --- Con montoDecimales ausente o 0: exactamente las fórmulas anteriores (copiadas tal cual; no tocar) ---
const legacyQuoteTotals = (lines, discount, rate, afectaIva) => {
  const amounts = lines.map((line) => {
    const bruto = Math.round(line.cantidad * line.precio);
    const descuentoLinea = Math.round((bruto * line.descuento) / 100);
    return { bruto, descuentoLinea, totalLinea: Math.max(bruto - descuentoLinea, 0) };
  });
  const subtotal = amounts.reduce((sum, line) => sum + line.bruto, 0);
  const descuentoItems = amounts.reduce((sum, line) => sum + line.descuentoLinea, 0);
  const descuentoTotal = descuentoItems + discount;
  const neto = Math.max(subtotal - descuentoTotal, 0);
  const iva = afectaIva ? Math.round(neto * rate) : 0;
  return { amounts, subtotal, descuentoItems, descuentoTotal, neto, iva, total: neto + iva };
};
const legacySaleTotals = (lines, discount, rate, afectaIva) => {
  const amounts = lines.map((line) => {
    const subtotalLinea = Math.round(line.cantidad * line.precio);
    const descuentoLinea = Math.round((subtotalLinea * line.descuento) / 100);
    return { subtotalLinea, descuentoLinea, totalLinea: subtotalLinea - descuentoLinea };
  });
  const subtotal = amounts.reduce((sum, line) => sum + line.subtotalLinea, 0);
  const descuentoItems = amounts.reduce((sum, line) => sum + line.descuentoLinea, 0);
  const descuentoTotal = descuentoItems + discount;
  const neto = subtotal - descuentoTotal;
  const iva = afectaIva ? Math.round(neto * rate) : 0;
  return { amounts, subtotal, descuentoItems, descuentoTotal, neto, iva, total: neto + iva };
};
let chile = 0;
for (let i = 0; i < 4000; i += 1) {
  const lines = randomLines(0);
  const rate = pick(RATES);
  const afectaIva = rand() > 0.15;
  const legacy = legacyQuoteTotals(lines, 0, rate, afectaIva);
  const maxDiscount = Math.max(legacy.subtotal - legacy.descuentoItems, 0);
  const discount = rand() > 0.5 ? int(0, maxDiscount) : 0;
  const expected = legacyQuoteTotals(lines, discount, rate, afectaIva);
  const expectedSale = legacySaleTotals(lines, discount, rate, afectaIva);
  const montoDecimales = pick([undefined, 0, null]);
  const items = lines.map((line) => quoteItem(line.cantidad, line.precio, line.descuento));
  const front = calculateQuoteTotals(items, discount, { afectaIva, tasaIva: rate, ...(montoDecimales === undefined ? {} : { montoDecimales }) });
  const back = serverQuoteFor({ items, descuento: discount, afectaIva }, montoDecimales, rate);
  for (const key of ["subtotal", "descuentoItems", "descuentoTotal", "neto", "iva", "total"]) {
    assert.ok(Object.is(front[key], expected[key]), `Chile cotización ${key}: ${front[key]} != ${expected[key]}`);
    assert.ok(Object.is(back[key], expected[key]), `Chile cotización (servidor) ${key}: ${back[key]} != ${expected[key]}`);
  }
  front.lineAmounts.forEach((line, index) => {
    assert.ok(Object.is(line.totalLinea, expected.amounts[index].totalLinea));
    assert.ok(Object.is(back.items[index].subtotalLinea, expected.amounts[index].bruto));
    assert.ok(Object.is(back.items[index].descuentoLinea, expected.amounts[index].descuentoLinea));
  });
  assert.equal(Object.hasOwn(back, "montoDecimales"), false);
  const saleLines = lines.map((line) => saleLine(line.cantidad, line.precio, line.descuento));
  let saleFront;
  try {
    saleFront = calculateSaleTotals(saleLines, discount, { afectaIva, tasaIva: rate, ...(montoDecimales === undefined ? {} : { montoDecimales }) });
  } catch (error) {
    assert.match(error.message, /máximo permitido|no puede superar/);
    saleFront = null;
  }
  if (saleFront) {
    const saleBack = serverSaleTotals(saleLines, discount, montoDecimales, rate, afectaIva).totals;
    for (const key of ["subtotal", "descuentoItems", "descuentoTotal", "neto", "iva", "total"]) {
      assert.ok(Object.is(saleFront[key], expectedSale[key]), `Chile venta ${key}: ${saleFront[key]} != ${expectedSale[key]}`);
      assert.ok(Object.is(saleBack[key], expectedSale[key]), `Chile venta (servidor) ${key}: ${saleBack[key]} != ${expectedSale[key]}`);
    }
  }
  chile += 1;
}

// --- Validación: con decimales, hasta d decimales; con 0, sin límites nuevos ---
{
  assert.throws(() => calculateQuoteTotals([quoteItem(1, 3.555)], 0, { montoDecimales: 2 }), /precio unitario admite hasta 2 decimales/);
  assert.throws(() => calculateQuoteTotals([quoteItem(1, 3.5)], 0.555, { montoDecimales: 2 }), /descuento general admite hasta 2 decimales/);
  assert.throws(() => calculateSaleTotals([saleLine(1, 3.555)], 0, { montoDecimales: 2 }), /precio unitario admite hasta 2 decimales/);
  assert.throws(() => calculateSaleTotals([saleLine(1, 3.5)], 0.555, { montoDecimales: 2 }), /descuento general admite hasta 2 decimales/);
  assert.throws(() => serverQuoteFor({ items: [quoteItem(1, 3.555)] }, 2), (error) => error.code === "invalid-argument" && /admite hasta 2 decimales/.test(error.message));
  assert.throws(() => serverQuoteFor({ items: [quoteItem(1, 3.5)], descuento: 0.555 }, 2), /admite hasta 2 decimales/);
  const staleDraft = validateQuoteDraft({ items: [quoteItem(1, 3.555)], clienteId: "c", clienteNombre: "X", montoDecimales: 2 });
  assert.match(staleDraft.fieldErrors.numericos, /admite hasta 2 decimales/);
  // La cantidad y el porcentaje no se limitan (metros, 12,5 %): solo los importes.
  assert.doesNotThrow(() => calculateQuoteTotals([quoteItem(2.345, 3.5, 12.345)], 0, { montoDecimales: 2 }));
  assert.doesNotThrow(() => calculateSaleTotals([saleLine(2.345, 3.5, 12.345)], 0, { montoDecimales: 2 }));
  // Con 0 decimales (Chile) no hay ningún límite nuevo: un precio con decimales se acepta y se redondea la línea.
  assert.equal(calculateQuoteLineAmounts(quoteItem(3, 1234.567), 0).bruto, 3704);
  assert.equal(calculateSaleLine(saleLine(3, 1234.567), 0).subtotalLinea, 3704);
  assert.doesNotThrow(() => serverQuoteFor({ items: [quoteItem(3, 1234.567)], descuento: 0.5 }, 0));
  assert.doesNotThrow(() => serverSaleTotals([saleLine(3, 1234.567)], 1, 0), "precio con decimales aceptado; el total sigue entero");
  assert.throws(() => serverSaleTotals([saleLine(3, 1234.567)], 0.5, 0), /máximo permitido/, "un descuento fraccionario sigue rechazándose con 0 decimales, como antes");
  const saleInput = (price, discount = 0) => serverSale.normalizeSaleInput({ clienteId: "c1", items: [{ lineaId: "l1", itemId: "i1", cantidad: 1, precioUnitario: price }], descuento: discount, fechaVenta: "2026-11-20" }, HttpsError);
  assert.throws(() => serverSale.assertSaleAmountDecimals(saleInput(3.555), 2, HttpsError), (error) => error.code === "invalid-argument" && /precio unitario admite hasta 2 decimales/.test(error.message));
  assert.throws(() => serverSale.assertSaleAmountDecimals(saleInput(3.5, 0.555), 2, HttpsError), /descuento general admite hasta 2 decimales/);
  assert.doesNotThrow(() => serverSale.assertSaleAmountDecimals(saleInput(3.55, 0.45), 2, HttpsError));
  assert.doesNotThrow(() => serverSale.assertSaleAmountDecimals(saleInput(3.555, 0.555), 0, HttpsError), "con 0 decimales no hay límite nuevo");
  // El payload del cliente valida con los decimales del borrador y no los envía: el servidor decide los suyos.
  const payload = buildQuotePayload("uid-1", {
    clienteId: "c1", cliente: { empresa: "X" }, items: [quoteItem(3, 3.5)], montoDecimales: 2, empresa: {},
  }, { issueDate: "2026-11-20" });
  assert.equal(payload.total, 12.5, "el borrador usa la tasa por defecto del modelo (19 %): 1,995 -> 2,00");
  assert.equal(payload.neto, 10.5);
  assert.equal(Object.hasOwn(payload, "montoDecimales"), false, "el payload no lleva montoDecimales");
  const payload0 = buildQuotePayload("uid-1", { clienteId: "c1", cliente: { empresa: "X" }, items: [quoteItem(3, 3.5)], empresa: {} }, { issueDate: "2026-11-20" });
  assert.equal(payload0.neto, 11, "sin decimales, el payload es el de siempre");
  const salePayload = buildSaleMutationPayload({ clienteId: "c1", items: [{ lineaId: "l1", itemId: "i1", ...saleLine(3, 3.5) }], descuento: 0, montoDecimales: 2 });
  assert.equal(Object.hasOwn(salePayload, "montoDecimales"), false);
  assert.throws(() => buildSaleMutationPayload({ clienteId: "c1", items: [{ lineaId: "l1", itemId: "i1", ...saleLine(1, 3.555) }], descuento: 0, montoDecimales: 2 }), /admite hasta 2 decimales/);
  assert.doesNotThrow(() => buildSaleMutationPayload({ clienteId: "c1", items: [{ lineaId: "l1", itemId: "i1", ...saleLine(1, 3.555) }], descuento: 0 }));
  // normalizeQuoteItems con decimales.
  assert.equal(normalizeQuoteItems([quoteItem(3, 3.5)], { montoDecimales: 2 })[0].totalLinea, 10.5);
  assert.equal(normalizeQuoteItems([quoteItem(3, 3.5)])[0].totalLinea, 11);
}

// --- safeMoney: con 0 decimales es la validación de siempre; con decimales, hasta d decimales ---
{
  const oldSafe = (value) => Number.isFinite(value) && Number.isSafeInteger(value);
  const samples = [0, 1, -1, 10.5, 1e15, 2 ** 53, 2 ** 53 - 1, 9007199254740993, NaN, Infinity, -Infinity, 1e21, 0.1 + 0.2, "5", null, undefined];
  for (const value of samples) assert.equal(isMoneyAmount(value, 0), oldSafe(value), `isMoneyAmount(${value}, 0) = validación anterior`);
  for (let i = 0; i < 50000; i += 1) {
    const value = pick([int(-1e9, 1e9), int(0, 1e15), rand() * 1e15, int(0, 1e6) / 100]);
    assert.equal(isMoneyAmount(value, 0), oldSafe(value));
  }
  assert.equal(isMoneyAmount(10.5, 2), true);
  assert.equal(isMoneyAmount(10, 2), true);
  assert.equal(isMoneyAmount(10.555, 2), false);
  assert.equal(isMoneyAmount(0.1 + 0.2, 2), false, "un importe sin redondear no es válido");
  assert.equal(isMoneyAmount(90071992547409.91, 2), true, "el límite son los centavos seguros");
  assert.equal(isMoneyAmount(90071992547409.92, 2), false);
  assert.equal(isMoneyAmount(NaN, 2), false);
  assert.equal(isMoneyAmount("5", 2), false);
  assert.equal(hasMaxDecimals(3.5, 2), true);
  assert.equal(hasMaxDecimals(3.555, 2), false);
  assert.equal(hasMaxDecimals(3, 0), true);
  assert.equal(hasMaxDecimals(3.5, 0), false);
  assert.equal(hasMaxDecimals("3", 2), false);
  assert.equal(sanitizeDecimals(2), 2);
  for (const bad of [undefined, null, 0, -1, 1.5, "2", NaN, 7, 100]) assert.equal(sanitizeDecimals(bad), 0, `sanitizeDecimals(${bad})`);
  // Montos máximos como antes.
  assert.throws(() => calculateSaleTotals([saleLine(1, 1e16)], 0, { montoDecimales: 0 }), /máximo permitido/);
  assert.throws(() => calculateSaleTotals([saleLine(1, 1e14)], 0, { montoDecimales: 2 }), /máximo permitido/);
  assert.doesNotThrow(() => calculateSaleTotals([saleLine(1, 1e12)], 0, { montoDecimales: 2 }));
  assert.throws(() => serverSaleTotals([saleLine(1, 1e16)], 0, 0), /máximo permitido/);
  assert.throws(() => serverSaleTotals([saleLine(1, 1e14)], 0, 2), /máximo permitido/);
}

// --- Margen comercial con decimales ---
{
  const sale = (overrides = {}) => ({
    ventaId: "v1", estado: "confirmada", moneda: "BOB", montoDecimales: 2, descuento: 0.5, neto: 10,
    items: [{ lineaId: "p1", itemId: "i1", tipoItem: "producto", cantidad: 3, precioUnitario: 3.5, descuentoPct: 0 }],
    efectosInventario: [{ movimientoId: "m1", lineaId: "p1", itemId: "i1", cantidad: 3, costoUnitario: 2, costoTotal: 6, costoHistoricoDisponible: true, moneda: "BOB" }],
    ...overrides,
  });
  const margin = calculateSaleCommercialMarginV1(sale());
  assert.equal(margin.estado, STATUS.COMPLETE);
  assert.equal(margin.ingresoNetoVenta, 10);
  assert.equal(margin.ingresoNetoProductos, 10);
  assert.equal(margin.costoHistoricoProductos, 6);
  assert.equal(margin.margenBrutoProductos, 4);
  assert.equal(margin.margenBrutoPct, 40);
  // Con decimales una venta que no cuadra con su neto guardado se marca como no disponible.
  assert.equal(calculateSaleCommercialMarginV1(sale({ neto: 10.01 })).estado, STATUS.UNAVAILABLE, "tolerancia de media unidad menor");
  assert.equal(calculateSaleCommercialMarginV1(sale({ neto: 10.004 })).estado, STATUS.COMPLETE);
  // Con 3 unidades a 3,50 sin snapshot de decimales la línea se calcula entera (11) y el neto guardado ya no cuadra.
  assert.equal(calculateSaleCommercialMarginV1(sale({ montoDecimales: undefined })).estado, STATUS.UNAVAILABLE);
  // Desagregación por línea: reparte el descuento general en centavos y suma exactamente el agregado.
  const detail = calculateSaleProductLineMarginsV1(sale({
    descuento: 0.99,
    items: [
      { lineaId: "p1", itemId: "i1", tipoItem: "producto", cantidad: 3, precioUnitario: 3.5, descuentoPct: 0 },
      { lineaId: "p2", itemId: "i2", tipoItem: "producto", cantidad: 1, precioUnitario: 0.01, descuentoPct: 0 },
      { lineaId: "p3", itemId: "i3", tipoItem: "producto", cantidad: 2, precioUnitario: 7.25, descuentoPct: 0 },
    ],
    efectosInventario: [
      { movimientoId: "m1", lineaId: "p1", itemId: "i1", cantidad: 3, costoUnitario: 2, costoTotal: 6, moneda: "BOB" },
      { movimientoId: "m2", lineaId: "p2", itemId: "i2", cantidad: 1, costoUnitario: 0.01, costoTotal: 0.01, moneda: "BOB" },
      { movimientoId: "m3", lineaId: "p3", itemId: "i3", cantidad: 2, costoUnitario: 3, costoTotal: 6, moneda: "BOB" },
    ],
    neto: 24.02, // 10,50 + 0,01 + 14,50 - 0,99
  }));
  assert.equal(detail.estado, STATUS.COMPLETE, JSON.stringify(detail));
  const assigned = sumMoney(detail.lineas.map((line) => line.descuentoGeneralAsignado), 2);
  assert.equal(assigned, 0.99, "la suma asignada es exactamente el descuento general");
  detail.lineas.forEach((line) => {
    assert.ok(isMoneyAmount(line.descuentoGeneralAsignado, 2) && isMoneyAmount(line.ingresoNeto, 2) && isMoneyAmount(line.margenBruto, 2), `línea ${line.lineaId} con 2 decimales`);
  });
  assert.equal(sumMoney(detail.lineas.map((line) => line.ingresoNeto), 2), 24.02, "la suma de las líneas es el ingreso neto de la venta");
}

// --- Documento de origen con 2 decimales: la venta desde cotización y el duplicado heredan sus decimales ---
{
  const stored = new Map();
  const makeRef = (path) => ({
    id: path.split("/").pop(), path,
    collection: (name) => ({ doc: (docId = `auto-${stored.size}`) => makeRef(`${path}/${name}/${docId}`) }),
  });
  const snapshotOf = (ref) => ({ id: ref.id, exists: stored.has(ref.path), data: () => stored.get(ref.path) });
  const transaction = {
    get: async (ref) => snapshotOf(ref),
    create: (ref, data) => stored.set(ref.path, data),
    set: (ref, data) => stored.set(ref.path, data),
    update: (ref, data) => stored.set(ref.path, { ...(stored.get(ref.path) || {}), ...data }),
  };
  const dependencies = { FieldValue: { serverTimestamp: () => "ts" }, HttpsError };
  const businessRef = makeRef("negocios/b1");
  const clock = new Date("2026-11-20T15:00:00Z");
  const quoteBase = {
    negocioId: "b1", numero: "COT-1", estado: "aceptada", clienteId: "c1", moneda: "BOB", paisCodigo: "BO", locale: "es-BO",
    tasaIva: 0.13, afectaIva: true, descuento: 0.45, cliente: { clienteId: "c1", empresa: "Cliente SRL", nombreRazonSocial: "Cliente SRL" },
    items: [
      { lineaId: "l1", itemId: "", nombre: "Servicio", tipoItem: "servicio", cantidad: 3, precioUnitarioEditable: 3.5, descuentoPorcentaje: 10 },
    ],
  };
  const convert = async (quote, quoteId) => serverSale.createConfirmedSaleFromQuoteInTransaction({
    actor: { uid: "u1" }, businessId: "b1", businessRef, clock, dependencies, quote, quoteId, transaction,
  });
  const withDecimals = await convert({ ...quoteBase, montoDecimales: 2 }, "q-dec");
  assert.equal(withDecimals.sale.montoDecimales, 2, "la venta hereda montoDecimales de la cotización, aunque el catálogo siga en 0");
  assert.deepEqual(
    [withDecimals.sale.subtotal, withDecimals.sale.descuentoItems, withDecimals.sale.descuento, withDecimals.sale.neto, withDecimals.sale.iva, withDecimals.sale.total],
    [10.5, 1.05, 0.45, 9, 1.17, 10.17]
  );
  assert.deepEqual(withDecimals.sale.items.map((line) => line.totalLinea), [9.45]);
  assert.equal(stored.get("negocios/b1/ventas/cotizacion__q-dec").montoDecimales, 2);
  // Sin snapshot (cotización anterior o de Chile): la venta no lleva el campo y se calcula entera.
  const withoutDecimals = await convert({ ...quoteBase, descuento: 0, items: [{ ...quoteBase.items[0], descuentoPorcentaje: 0 }] }, "q-int");
  assert.equal(Object.hasOwn(withoutDecimals.sale, "montoDecimales"), false);
  assert.deepEqual([withoutDecimals.sale.subtotal, withoutDecimals.sale.iva, withoutDecimals.sale.total], [11, 1, 12]);
  // Un snapshot de otra forma (texto, mayor que los decimales de la moneda) vale 0.
  const invalid = await convert({ ...quoteBase, montoDecimales: "2", descuento: 0, items: [{ ...quoteBase.items[0], descuentoPorcentaje: 0 }] }, "q-bad");
  assert.equal(Object.hasOwn(invalid.sale, "montoDecimales"), false);
  assert.equal(invalid.sale.total, 12);

  // Duplicar y editar una cotización: la localización sale del documento de origen (no del catálogo).
  const source = { ...quoteBase, montoDecimales: 2, estado: "emitida" };
  const duplicated = serverQuote.normalizeQuoteInput("u1", serverQuote.historicalQuoteCopyInput(source), "2026-11-20", HttpsError, {
    clientFields: { clienteId: "c1" }, companySnapshot: {}, localization: serverLocalization.adaptDocumentLocalization(source),
  });
  assert.equal(duplicated.montoDecimales, 2, "el duplicado hereda montoDecimales");
  assert.deepEqual([duplicated.neto, duplicated.iva, duplicated.total], [9, 1.17, 10.17]);
  const duplicatedLegacy = serverQuote.normalizeQuoteInput("u1", serverQuote.historicalQuoteCopyInput({ ...source, montoDecimales: undefined, descuento: 0 }), "2026-11-20", HttpsError, {
    clientFields: { clienteId: "c1" }, companySnapshot: {}, localization: serverLocalization.adaptDocumentLocalization({ ...source, montoDecimales: undefined }),
  });
  assert.equal(Object.hasOwn(duplicatedLegacy, "montoDecimales"), false);
}

// --- Fuentes: los dos handlers leen los decimales del documento, no del catálogo ---
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [quoteServer, saleServer, quotePage, salePage] = await Promise.all([
  read("functions/quotePersistence.js"), read("functions/salePersistence.js"), read("src/pages/NewQuotePage.jsx"), read("src/pages/NewSalePage.jsx"),
]);
assert.match(quoteServer, /localization: documentLocalizationSnapshot\(/, "crear: snapshot de la moneda del negocio");
assert.match(quoteServer, /localization: adaptDocumentLocalization\(source\)/, "duplicar: hereda los decimales del origen");
assert.match(quoteServer, /localization: adaptDocumentLocalization\(existing\)/, "editar: conserva los decimales del documento");
assert.match(saleServer, /\n\s+localization,\r?\n\s+empresaSnapshot: resolveCompanySnapshot\(quote, currentCompanySnapshot\)/, "venta desde cotización: usa la localización heredada de la cotización");
assert.match(saleServer, /const localization = adaptDocumentLocalization\(quote\);/);
assert.match(saleServer, /const decimals = sanitizeDecimals\(adaptDocumentLocalization\(existing\)\.montoDecimales\);/, "editar venta: conserva los decimales del documento");
for (const [name, source] of [["quotePersistence", quoteServer], ["salePersistence", saleServer]]) {
  // (salePersistence conserva roundCost: costos del inventario a 2 decimales, fuera de este alcance)
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, "").replace(/function roundCost[^\n]*/, ""), /Math\.round\(/, `${name}: ningún Math.round en los importes`);
  assert.doesNotMatch(source, /Number\.isSafeInteger\(value\)/, `${name}: safeMoney ya no exige enteros`);
}
// Los 2 inputs de costo y recargo del ítem sugerido siguen "1" con 0 decimales y pasan a 0.01 con 2; la cantidad no cambia.
assert.match(quotePage, /const moneyStep = documentDecimals > 0 \? String\(10 \*\* -documentDecimals\) : "1";/);
assert.equal((quotePage.match(/step=\{moneyStep\}/g) || []).length, 2, "costo y recargo usan moneyStep");
assert.match(quotePage, /min="1"\s+step="1"\s+value=\{suggestedItemDraft\.cantidadSugerida\}/, "la cantidad sugerida sigue en step 1");
assert.doesNotMatch(quotePage, /step="any"/);
assert.match(quotePage, /const documentDecimals = savedQuoteId\s+\? adaptDocumentAmountDecimals\(quote, quote\.moneda\)\s+: formatBusinessAmount\.amountDecimals;/);
assert.match(salePage, /const documentDecimals = sale\s+\? adaptDocumentAmountDecimals\(sale, sale\.moneda\)\s+: businessMoney\.amountDecimals;/);
assert.equal(String(10 ** -2), "0.01");

// --- useBusinessMoney expone amountDecimals (la moneda del negocio: 2 en BOB, 0 en el resto) ---
const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const probe = (business) => {
    let captured;
    const Probe = () => {
      const money = hook.useBusinessMoney();
      captured = { amountDecimals: money.amountDecimals, text: money(11), format: hook.default() };
      return null;
    };
    renderToStaticMarkup(React.createElement(hook.BusinessFormatProvider, { business }, React.createElement(Probe)));
    return captured;
  };
  assert.equal(probe(undefined).amountDecimals, 0, "sin negocio: 0");
  assert.equal(probe({ paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL" }).amountDecimals, 0);
  assert.equal(probe({ paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL" }).text, "$11");
  const bolivia = probe({ paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO" });
  assert.equal(bolivia.amountDecimals, 2, "BOB calcula con 2 decimales desde la entrega D");
  assert.equal(bolivia.format.amountDecimals, 2);
  assert.match(bolivia.text, /^Bs\s?11,00$/);
  assert.equal(hook.resolveBusinessFormat({ monedaCodigo: "bob" }).amountDecimals, 2);
} finally {
  await vite.close();
}
assert.deepEqual(adaptDocumentLocalization({ moneda: "BOB", montoDecimales: 2 }).montoDecimales, 2);

console.log("QUOTE_SALE_DECIMALS_SMOKE_OK", JSON.stringify({ parity, chile }));
