// Redondeo de importes (SPEC 036). Tres funciones: mulRound, sumMoney y roundMoney.
//
// IMPORTANTE: el cuerpo de este archivo es idéntico al de functions/money.js (el servidor no puede
// importar src/). scripts/money-smoke.mjs compara el texto de ambos y sus resultados; si cambias uno,
// cambia el otro.
//
// - `decimals` es la cantidad de decimales de CÁLCULO del importe (`amountDecimals` del catálogo,
//   guardada en el documento como `montoDecimales`). No es `decimals` de la moneda, que solo decide
//   cómo se MUESTRA el monto.
// - Con 0 decimales (CLP, PYG y hoy también BOB) cada función ejecuta literalmente la fórmula
//   que usaban los modelos: Math.round((a * b) / divisor) y la suma con reduce. No hay ruta exacta: el
//   resultado es bit a bit el de antes, incluidos los empates que hoy dependen del punto flotante.
// - Con decimales > 0 el cálculo es decimal exacto: cada número se toma de su representación decimal
//   corta (la que tipeó el usuario) y se opera con BigInt. Así 1,005 redondea a 1,01, 0,7 × 0,05 da
//   0,04 y 1.000 líneas de 0,07 suman 70 sin la deriva de 0.1 + 0.2. El empate se resuelve como
//   Math.round (hacia +∞), igual en todas las monedas.

const MAX_DECIMALS = 6;
const NUMBER_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;

function normalizeDecimals(decimals) {
  if (decimals === undefined || decimals === null) return 0;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`Los decimales de un importe deben ser un entero entre 0 y ${MAX_DECIMALS}.`);
  }
  return decimals;
}

// Número finito -> {value: BigInt con signo, scale}, donde el número vale value / 10^scale.
function toScaled(number) {
  const match = NUMBER_PATTERN.exec(String(number));
  if (!match) return null;
  const [, sign, integer, fraction = "", exponent = "0"] = match;
  let scale = fraction.length - Number(exponent);
  let value = BigInt(integer + fraction);
  if (scale < 0) {
    value *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { value: sign === "-" ? -value : value, scale };
}

function floorDivide(numerator, denominator) {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && (numerator < 0n) !== (denominator < 0n) ? quotient - 1n : quotient;
}

// numerator / denominator redondeado a entero, con el empate hacia +∞ (como Math.round).
function roundDivide(numerator, denominator) {
  return floorDivide(2n * numerator + denominator, 2n * denominator);
}

// El texto decimal exacto se convierte al número más cercano (también sirve más allá de 2^53).
function fromMinorUnits(units, decimals) {
  return Number(`${units}e-${decimals}`);
}

// round((a * b) / divisor) a `decimals` decimales.
export function mulRound(a, b, decimals = 0, divisor = 1) {
  const places = normalizeDecimals(decimals);
  if (places === 0) return Math.round((a * b) / divisor);
  const left = Number(a);
  const right = Number(b);
  const by = Number(divisor);
  if (!Number.isFinite((left * right) / by)) return Math.round((left * right) / by);
  const x = toScaled(left);
  const y = toScaled(right);
  const z = toScaled(by);
  if (!x || !y || !z || z.value === 0n) return Math.round((left * right) / by);
  // (x.value * y.value / 10^(x.scale + y.scale)) / (z.value / 10^z.scale) * 10^places
  const exponent = places + z.scale - x.scale - y.scale;
  const numerator = x.value * y.value * (exponent >= 0 ? 10n ** BigInt(exponent) : 1n);
  const denominator = z.value * (exponent < 0 ? 10n ** BigInt(-exponent) : 1n);
  const units = denominator < 0n ? roundDivide(-numerator, -denominator) : roundDivide(numerator, denominator);
  return fromMinorUnits(units, places);
}

// Redondea un importe suelto a `decimals` decimales.
export function roundMoney(value, decimals = 0) {
  const places = normalizeDecimals(decimals);
  if (places === 0) return Math.round(value);
  return mulRound(value, 1, places);
}

// Suma importes. Con decimales, la suma es exacta (sin 0.1 + 0.2) y queda redondeada a `decimals`.
export function sumMoney(values, decimals = 0) {
  const places = normalizeDecimals(decimals);
  const list = Array.from(values);
  if (places === 0) return list.reduce((sum, value) => sum + value, 0);
  const scaled = list.map((value) => (Number.isFinite(Number(value)) ? toScaled(Number(value)) : null));
  if (scaled.some((entry) => !entry)) return list.reduce((sum, value) => sum + Number(value), 0);
  const scale = scaled.reduce((largest, entry) => Math.max(largest, entry.scale), places);
  const total = scaled.reduce((sum, entry) => sum + entry.value * 10n ** BigInt(scale - entry.scale), 0n);
  return fromMinorUnits(roundDivide(total, 10n ** BigInt(scale - places)), places);
}

// Decimales de cálculo válidos de un documento: entero entre 1 y 6. Ausente o inválido = 0.
export function sanitizeDecimals(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_DECIMALS ? value : 0;
}

// ¿El número tiene a lo sumo `decimals` decimales? (0 = entero). Se mide sobre su representación decimal corta.
export function hasMaxDecimals(value, decimals = 0) {
  const places = normalizeDecimals(decimals);
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const scaled = toScaled(value);
  return Boolean(scaled) && scaled.scale <= places;
}

// Validación de un importe calculado. Con 0 decimales es exactamente la de siempre: un entero seguro
// (Number.isFinite y Number.isSafeInteger). Con decimales admite hasta `decimals` decimales, y el importe en
// unidades menores (centavos) tiene que ser un entero seguro.
export function isMoneyAmount(value, decimals = 0) {
  const places = normalizeDecimals(decimals);
  if (places === 0) return Number.isFinite(value) && Number.isSafeInteger(value);
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const scaled = toScaled(value);
  if (!scaled || scaled.scale > places) return false;
  const units = scaled.value * 10n ** BigInt(places - scaled.scale);
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  return units >= -limit && units <= limit;
}
