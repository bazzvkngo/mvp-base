import React from "react";
import StatusBadge from "../../components/ui/StatusBadge";

// Piezas visuales del Taller (prototipo «Panel del Taller»), compartidas por Inicio y Plazas. Solo tokens (taller.css).

// Insignia con los tonos del prototipo; «info» usa el par de color de los avisos informativos.
export function BayBadge({children, tone}) {
  return tone === "info"
    ? <StatusBadge variant="neutral" className="workshop-bays__badge workshop-bays__badge--info">{children}</StatusBadge>
    : <StatusBadge variant={tone}>{children}</StatusBadge>;
}

// Vehículo visto desde arriba, teñido según la etapa de la OT.
export function TopCar({size = 40, tone}) {
  return <svg className={`workshop-car workshop-car--${tone}`} viewBox="0 0 60 100" width={size} aria-hidden="true">
    <rect x="8" y="4" width="44" height="92" rx="16" />
    <rect className="workshop-car__glass" x="14" y="26" width="32" height="18" rx="4" />
    <rect className="workshop-car__glass" x="14" y="64" width="32" height="14" rx="4" />
  </svg>;
}

export function ProgressRing({size = 48, value}) {
  const circumference = 2 * Math.PI * 17;
  return <svg className="workshop-ring" viewBox="0 0 44 44" width={size} role="img" aria-label={`${value}% de avance`}>
    <circle className="workshop-ring__track" cx="22" cy="22" r="17" />
    <circle className="workshop-ring__value" cx="22" cy="22" r="17"
      strokeDasharray={`${(circumference * value) / 100} ${circumference}`} transform="rotate(-90 22 22)" />
    <text x="22" y="25.5" textAnchor="middle" fontSize={value === 100 ? 10 : 12}>{value}%</text>
  </svg>;
}

