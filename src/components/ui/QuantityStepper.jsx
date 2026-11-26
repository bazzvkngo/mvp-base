import React from "react";
import {Minus, Plus} from "lucide-react";
import AppIcon from "./AppIcon";

// Botones "−" y "+" junto al campo de cantidad (solo presentación). No valida ni calcula montos: entrega la cantidad
// siguiente al mismo manejador de siempre; la validación real sigue en el modelo del documento y en el backend.
// - Acepta los mismos decimales que el campo (step="any"): suma o resta 1 a lo que hay.
// - "−" no está permitido si el resultado sería 0 o menos.
// - "+" respeta el máximo cuando existe (`max`, p. ej. la cantidad cotizada de una venta antigua): no lo supera y no está
//   permitido si ya se llegó a él.
// - Redondea a 6 decimales solo para que 2,3 + 1 no quede como 3,3000000000000003.
// Devuelve la cantidad siguiente, o null si el paso no está permitido (botón deshabilitado).
const SCALE = 1e6;

export function stepQuantity(current, direction, {max} = {}) {
  const parsed = Number(current);
  const value = Number.isFinite(parsed) ? parsed : 0;
  const limit = max == null || max === "" || !Number.isFinite(Number(max)) ? Infinity : Number(max);
  const raw = value + (direction < 0 ? -1 : 1);
  if (direction < 0) return raw > 0 ? Math.round(raw * SCALE) / SCALE : null;
  if (value >= limit) return null;
  return Math.round(Math.min(raw, limit) * SCALE) / SCALE;
}

export default function QuantityStepper({disabled = false, label, max, onChange, value}) {
  const canDecrease = !disabled && stepQuantity(value, -1) !== null;
  const canIncrease = !disabled && stepQuantity(value, 1, {max}) !== null;
  const step = (direction) => {
    const next = stepQuantity(value, direction, {max});
    if (next !== null) onChange(next);
  };
  return (
    <div className="ui-qty">
      <button type="button" className="ui-qty__button" aria-label={`Disminuir cantidad de ${label}`} disabled={!canDecrease} onClick={() => step(-1)}><AppIcon icon={Minus} size={16} /></button>
      <input className="ui-qty__input" aria-label={`Cantidad de ${label}`} disabled={disabled} type="number" min="0.000001" max={max} step="any" value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="ui-qty__button" aria-label={`Aumentar cantidad de ${label}`} disabled={!canIncrease} onClick={() => step(1)}><AppIcon icon={Plus} size={16} /></button>
    </div>
  );
}
