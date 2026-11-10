// Reportes R5: helpers puros de presentación de la tendencia del Resumen (gráfico de
// línea y mini-líneas de las tarjetas). No calculan dinero: reciben las series que ya
// arma reportModel (aggregateOperationalTimeline / combineOperationalTimelines) y solo
// deciden si alcanzan los puntos y dónde cae cada punto dentro del dibujo.

// Con 0 o 1 punto no hay tendencia que mostrar: se dice en texto.
export const TREND_MIN_POINTS = 2;
// La mini-línea de una tarjeta necesita al menos 3 puntos para decir algo.
export const SPARKLINE_MIN_POINTS = 3;
export const NOT_ENOUGH_TREND_TEXT = "Aún no hay suficientes datos para mostrar una tendencia";

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

// Filas de una moneda, en el orden en que llegan (reportModel ya las ordena por fecha).
export function trendItemsFor(items, currency) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.currency === currency);
}

export function hasEnoughTrendPoints(items) {
  return Array.isArray(items) && items.length >= TREND_MIN_POINTS;
}

// Coordenadas de la mini-línea dentro de un lienzo `width` x `height` (unidades del
// viewBox). El menor valor cae abajo y el mayor arriba; si todos son iguales, la línea
// va al medio. Con menos de SPARKLINE_MIN_POINTS valores válidos no se dibuja nada.
export function buildSparkline(values, {width = 100, height = 28, padding = 3} = {}) {
  const list = (Array.isArray(values) ? values : []).filter((value) => typeof value === "number" && Number.isFinite(value));
  if (list.length < SPARKLINE_MIN_POINTS) return {show: false, points: "", count: list.length};
  const min = Math.min(...list);
  const span = Math.max(...list) - min;
  const step = (width - padding * 2) / (list.length - 1);
  const points = list.map((value, index) => {
    const x = padding + step * index;
    const y = span === 0 ? height / 2 : padding + (1 - (value - min) / span) * (height - padding * 2);
    return `${roundTo(x, 2)},${roundTo(y, 2)}`;
  }).join(" ");
  return {show: true, points, count: list.length};
}
