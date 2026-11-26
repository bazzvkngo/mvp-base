import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { mulRound, roundMoney, sumMoney } from "../src/domain/money.mjs";

// SPEC 036, entrega A: helper de redondeo de importes. Con 0 decimales ejecuta la fórmula actual de los
// modelos (CLP no cambia); con decimales calcula en decimal exacto. El helper todavía no está conectado a
// ningún modelo.
const require = createRequire(import.meta.url);
const server = require("../functions/money.js");

// Generador determinista (mulberry32): la prueba da siempre el mismo resultado.
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
const rand = random(36);
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));

// --- Paridad: mismo código en frontend y Functions ---
const body = (source) => source.slice(source.indexOf("const MAX_DECIMALS")).replace(/^export /gm, "").replace(/\r\n/g, "\n");
const [frontSource, serverSource] = await Promise.all([
  readFile(new URL("../src/domain/money.mjs", import.meta.url), "utf8"),
  readFile(new URL("../functions/money.js", import.meta.url), "utf8"),
]);
assert.equal(
  body(frontSource),
  body(serverSource).replace(/\nmodule\.exports = \{[\s\S]*$/, ""),
  "src/domain/money.mjs y functions/money.js tienen el mismo cuerpo"
);
assert.deepEqual(Object.keys(server).sort(), ["hasMaxDecimals", "isMoneyAmount", "mulRound", "roundMoney", "sanitizeDecimals", "sumMoney"]);

// --- Diferencial con 0 decimales: bit a bit la fórmula que usan hoy los modelos ---
const legacyMul = (a, b, divisor = 1) => Math.round((a * b) / divisor);
const legacySum = (values) => values.reduce((sum, value) => sum + value, 0);
const rates = [0.19, 0.13, 0.1, 0.16, 0.21, 0.18, 0.22, 0.15, 0.12, 0.05];
const percents = [0, 1, 2.5, 5, 7.5, 10, 12.5, 15, 19, 20, 33.33, 50, 99.99, 100];
let cases = 0;
const same = (actual, expected, label) => {
  cases += 1;
  assert.ok(Object.is(actual, expected), `${label}: ${actual} != ${expected}`);
};
for (let i = 0; i < 200000; i += 1) {
  const neto = int(0, 50000000);
  const rate = rates[int(0, rates.length - 1)];
  same(mulRound(neto, rate, 0), legacyMul(neto, rate), `IVA ${neto} x ${rate}`);
  same(server.mulRound(neto, rate, 0), legacyMul(neto, rate), `IVA servidor ${neto} x ${rate}`);
  const quantity = int(1, 20000) / [1, 10, 100, 1000][int(0, 3)];
  const price = int(0, 9000000) / [1, 1, 10, 100][int(0, 3)];
  same(mulRound(quantity, price), legacyMul(quantity, price), `línea ${quantity} x ${price}`);
  const subtotal = int(0, 90000000);
  const percent = percents[int(0, percents.length - 1)];
  same(mulRound(subtotal, percent, 0, 100), legacyMul(subtotal, percent, 100), `descuento ${subtotal} x ${percent}%`);
  same(server.mulRound(subtotal, percent, 0, 100), legacyMul(subtotal, percent, 100), `descuento servidor ${subtotal} x ${percent}%`);
  same(roundMoney(price, 0), Math.round(price), `valor suelto ${price}`);
}
// Empates exactos y valores raros: Math.round incluido (-2,5 -> -2, -0).
for (const value of [0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 0.49999999999999994, 1e21, -0.4, 0, NaN, Infinity, -Infinity]) {
  same(roundMoney(value, 0), Math.round(value), `Math.round(${value})`);
  same(roundMoney(value), Math.round(value), `Math.round(${value}) sin decimales`);
}
for (let i = 0; i < 2000; i += 1) {
  const values = Array.from({ length: int(0, 60) }, () => int(0, 9000000) / [1, 1, 10, 100][int(0, 3)]);
  same(sumMoney(values, 0), legacySum(values), "suma de importes");
  same(sumMoney(values), legacySum(values), "suma de importes sin decimales");
  same(server.sumMoney(values, 0), legacySum(values), "suma de importes en el servidor");
}
same(sumMoney([]), 0, "suma vacía");
// Entradas no numéricas: el mismo resultado que la fórmula anterior (NaN), sin excepciones.
same(mulRound(undefined, 5, 0), legacyMul(undefined, 5), "undefined");
same(mulRound(10, 0.19, undefined), legacyMul(10, 0.19), "sin decimales");
same(mulRound(10, 0.19, null), legacyMul(10, 0.19), "decimales nulos");
same(mulRound(10, 5, 0, 0), legacyMul(10, 5, 0), "divisor cero");

// --- Decimales inválidos: error de programación, no un redondeo silencioso ---
for (const bad of [-1, 0.5, 7, "2", NaN, Infinity]) {
  assert.throws(() => mulRound(1, 1, bad), RangeError, `decimales ${bad}`);
  assert.throws(() => roundMoney(1, bad), RangeError);
  assert.throws(() => sumMoney([1], bad), RangeError);
}

// --- Punto flotante con 2 decimales ---
// Empates que el punto flotante resuelve mal con Math.round(x * 100) / 100.
assert.notEqual(Math.round(1.005 * 100) / 100, 1.01, "referencia: la fórmula ingenua falla en 1,005");
for (const [value, expected] of [
  [1.005, 1.01], [8.345, 8.35], [1.255, 1.26], [0.285, 0.29], [10.075, 10.08], [1.045, 1.05],
  [0.125, 0.13], [2.675, 2.68], [1.1, 1.1], [0, 0], [0.004, 0], [0.005, 0.01], [123456789.995, 123456790],
]) {
  assert.equal(roundMoney(value, 2), expected, `roundMoney(${value}, 2)`);
  assert.equal(server.roundMoney(value, 2), expected, `servidor roundMoney(${value}, 2)`);
}
assert.equal(roundMoney(1e-7, 2), 0, "notación científica pequeña");
assert.equal(roundMoney(1.5e-2, 2), 0.02, "notación científica 1.5e-2");
assert.equal(roundMoney(1e21, 2), 1e21, "notación científica grande");
assert.equal(roundMoney(-2.5, 0), -2, "empate negativo como Math.round");
assert.equal(roundMoney(-0.005, 2), 0, "-0,005 redondea hacia +∞ como Math.round");
assert.equal(roundMoney(-1.006, 2), -1.01);
// Producto con deriva: 0,7 × 0,05 = 0,034999… en flotante, pero vale 0,035 y redondea a 0,04.
assert.notEqual(0.7 * 0.05, 0.035, "referencia: el producto en flotante no es 0,035");
assert.equal(mulRound(0.7, 0.05, 2), 0.04);
assert.equal(server.mulRound(0.7, 0.05, 2), 0.04);
assert.equal(mulRound(3, 3.5, 2), 10.5, "3 unidades a Bs 3,50");
assert.equal(mulRound(10.5, 0.13, 2), 1.37, "13 % de 10,50 = 1,365 -> 1,37");
assert.equal(mulRound(10.5, 13, 2, 100), 1.37, "13 % con divisor 100");
assert.equal(mulRound(1.5, 0.01, 2), 0.02);
assert.equal(mulRound(0.1, 0.15, 2), 0.02);
assert.equal(mulRound(100, 0.13, 2), 13);
assert.equal(mulRound(2.5, 4, 2), 10);
assert.equal(mulRound(0.1, 3, 2), 0.3, "0,1 × 3 = 0,30000000000000004 en flotante");
assert.equal(mulRound(19.99, 3, 2), 59.97);
assert.equal(mulRound(1234.56, 0.19, 2), 234.57, "19 %: 234,5664 -> 234,57");
assert.equal(mulRound(5, 5, 2, 3), 8.33, "divisor");
assert.equal(mulRound(1e-7, 1, 2), 0);
// Sumas: 0,1 + 0,2 y 1.000 líneas de 0,07.
assert.notEqual(0.1 + 0.2, 0.3, "referencia: 0,1 + 0,2 en flotante");
assert.equal(sumMoney([0.1, 0.2], 2), 0.3);
assert.equal(server.sumMoney([0.1, 0.2], 2), 0.3);
const thousand = Array.from({ length: 1000 }, () => 0.07);
assert.notEqual(thousand.reduce((sum, value) => sum + value, 0), 70, "referencia: la suma ingenua deriva");
assert.equal(sumMoney(thousand, 2), 70);
assert.equal(server.sumMoney(thousand, 2), 70);
assert.equal(sumMoney(Array.from({ length: 1000 }, () => 0.1), 2), 100);
assert.equal(sumMoney([1.005, 2.005], 2), 3.01, "la suma exacta 3,010 se redondea una sola vez");
assert.equal(sumMoney([0.004, 0.004], 2), 0.01, "0,008 -> 0,01");
assert.equal(sumMoney([], 2), 0);
assert.equal(sumMoney(["1.1", 2.2], 2), 3.3, "acepta texto numérico");
assert.ok(Number.isNaN(sumMoney([1, NaN], 2)), "un valor no numérico da NaN, como la suma anterior");

// --- Diferencial con 2 decimales contra un oráculo de enteros (centavos) ---
// Los datos se generan como enteros, así que el oráculo no usa números flotantes.
const half = (numerator, denominator) => {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  const q = (2n * n + d) / (2n * d);
  return Number(q);
};
let exact = 0;
for (let i = 0; i < 120000; i += 1) {
  // Línea: cantidad con hasta 3 decimales x precio con hasta 2 decimales.
  const quantityMilli = int(1, 99999);
  const priceCents = int(0, 9999999);
  const line = mulRound(quantityMilli / 1000, priceCents / 100, 2);
  assert.equal(line, half(quantityMilli * priceCents, 1000) / 100, `línea ${quantityMilli / 1000} x ${priceCents / 100}`);
  assert.equal(server.mulRound(quantityMilli / 1000, priceCents / 100, 2), line, "paridad de línea");
  // IVA: neto en centavos x tasa de porcentaje entero.
  const netCents = int(0, 99999999);
  const percent = int(0, 30);
  const vat = mulRound(netCents / 100, percent / 100, 2);
  assert.equal(vat, half(netCents * percent, 100) / 100, `IVA ${netCents / 100} x ${percent}%`);
  const vatByDivisor = mulRound(netCents / 100, percent, 2, 100);
  assert.equal(vatByDivisor, vat, "IVA con tasa fraccionaria o con divisor 100");
  // Descuento: subtotal x porcentaje con hasta 2 decimales, con divisor 100.
  const discountCents = int(0, 10000);
  const discount = mulRound(netCents / 100, discountCents / 100, 2, 100);
  assert.equal(discount, half(netCents * discountCents, 10000) / 100, `descuento ${netCents / 100} x ${discountCents / 100}%`);
  assert.equal(server.mulRound(netCents / 100, discountCents / 100, 2, 100), discount, "paridad de descuento");
  exact += 1;
}
// Sumas de centavos enteros: el oráculo es la suma de enteros.
for (let i = 0; i < 3000; i += 1) {
  const cents = Array.from({ length: int(0, 200) }, () => int(0, 9999999));
  const total = cents.reduce((sum, value) => sum + value, 0) / 100;
  assert.equal(sumMoney(cents.map((value) => value / 100), 2), total, "suma de importes con decimales");
  assert.equal(server.sumMoney(cents.map((value) => value / 100), 2), total, "suma en el servidor");
}
// Cada resultado con 2 decimales tiene a lo sumo 2 decimales: round trip por texto.
for (let i = 0; i < 20000; i += 1) {
  const result = mulRound(int(1, 99999) / 1000, int(0, 9999999) / 100, 2);
  assert.equal(Number(result.toFixed(2)), result, `representación de ${result}`);
}

// --- Con otros decimales (monedas de 3 decimales no existen hoy, pero el helper es genérico) ---
assert.equal(roundMoney(1.0005, 3), 1.001);
assert.equal(mulRound(1.5, 2.0005, 3), 3.001);

console.log("MONEY_SMOKE_OK", JSON.stringify({ legacyCases: cases, exactCases: exact }));
