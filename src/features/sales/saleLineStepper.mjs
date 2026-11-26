// Botones "−" y "+" de la cantidad de una línea de venta (solo presentación).
// No valida ni calcula montos: devuelve la cantidad siguiente para entregarla al mismo
// manejador de siempre (update(index, "cantidad", valor)); la validación real sigue siendo
// calculateSaleLine y el backend.
//
// - Acepta los mismos decimales que el campo (step="any"): suma o resta 1 a lo que hay.
// - "−" no está permitido si el resultado sería 0 o menos.
// - "+" respeta el máximo cuando existe (cantidad cotizada de una venta antigua): no lo supera
//   y no está permitido si ya se llegó a él.
// - Redondea a 6 decimales solo para que 2,3 + 1 no quede como 3,3000000000000003.
// Devuelve la cantidad siguiente, o null si el paso no está permitido (botón deshabilitado).
const SCALE = 1e6;

export function stepSaleQuantity(current, direction, {max} = {}) {
  const parsed = Number(current);
  const value = Number.isFinite(parsed) ? parsed : 0;
  const limit = max == null || max === "" || !Number.isFinite(Number(max)) ? Infinity : Number(max);
  const raw = value + (direction < 0 ? -1 : 1);
  if (direction < 0) return raw > 0 ? Math.round(raw * SCALE) / SCALE : null;
  if (value >= limit) return null;
  return Math.round(Math.min(raw, limit) * SCALE) / SCALE;
}
