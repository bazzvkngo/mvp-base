// Botones "−" y "+" de la cantidad de una línea de cotización (solo presentación).
// No valida ni calcula montos: devuelve la cantidad siguiente para entregarla al mismo
// manejador de siempre (onUpdate(lineId, "cantidad", valor)); la validación real sigue siendo
// calculateQuoteLineAmounts (cantidad mayor que 0) y el backend.
//
// - Acepta los mismos decimales que el campo: suma o resta 1 a lo que hay.
// - "−" no está permitido si el resultado sería 0 o menos.
// - Redondea a 6 decimales solo para que 2,3 + 1 no quede como 3,3000000000000003.
// Devuelve la cantidad siguiente, o null si el paso no está permitido (botón deshabilitado).
const SCALE = 1e6;

export function stepQuoteQuantity(current, direction) {
  const parsed = Number(current);
  const value = Number.isFinite(parsed) ? parsed : 0;
  const raw = value + (direction < 0 ? -1 : 1);
  if (direction < 0 && raw <= 0) return null;
  return Math.round(raw * SCALE) / SCALE;
}
