// Dónde cae el precio interno de un artículo respecto del rango de mercado
// (precio bajo, mediana, precio alto). Sólo presentación: el rango ya viene
// calculado y filtrado por relevancia desde la Function.

export const PRICE_POSITION = Object.freeze({
  BELOW: "BELOW",
  WITHIN: "WITHIN",
  ABOVE: "ABOVE",
});

const POSITION_LABELS = {
  [PRICE_POSITION.BELOW]: "Tu precio está por debajo del rango de mercado",
  [PRICE_POSITION.WITHIN]: "Tu precio está dentro del rango de mercado",
  [PRICE_POSITION.ABOVE]: "Tu precio está por encima del rango de mercado",
};

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function percentAlong(value, min, max) {
  if (!(max > min)) return 50;
  return clampPercent(((value - min) / (max - min)) * 100);
}

// Devuelve null si no hay resumen o precio interno válido.
// `internalPercent` y `medianPercent` son posiciones 0-100 sobre la barra
// bajo → alto. `differenceVsMedian` es la fracción respecto de la mediana
// (0.1 = 10 % más caro).
export function describeInternalPricePosition(summary, internalPrice) {
  const internal = Number(internalPrice);
  const min = Number(summary?.min);
  const median = Number(summary?.median);
  const max = Number(summary?.max);
  if (internalPrice === null || internalPrice === undefined || internalPrice === "") return null;
  if (![internal, min, median, max].every(Number.isFinite)) return null;

  let position = PRICE_POSITION.WITHIN;
  if (internal < min) position = PRICE_POSITION.BELOW;
  else if (internal > max) position = PRICE_POSITION.ABOVE;

  return {
    position,
    label: POSITION_LABELS[position],
    internalPercent: percentAlong(internal, min, max),
    medianPercent: percentAlong(median, min, max),
    differenceVsMedian: median > 0 ? (internal - median) / median : null,
  };
}
