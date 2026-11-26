import React, {useId} from "react";
import {RECEPTION_VEHICLE_ZONES} from "../../domain/workOrderReceptionPhotoModel.mjs";

// Auto visto desde arriba (frente hacia arriba) en un lienzo de 300 × 400. Las seis zonas del prototipo
// «Panel del Taller» son recortes del contorno de la carrocería: delantera, trasera y los cuatro
// costados. La cabina central no es una zona. Los colores los pone taller.css con tokens.
const BODY = "M150 8 C196 8 226 20 232 60 L234 130 L236 270 L232 340 C226 380 196 392 150 392 " +
  "C104 392 74 380 68 340 L64 270 L66 130 L68 60 C74 20 104 8 150 8 Z";
const MIRROR_FLIP = "translate(300 0) scale(-1 1)";

// Detalles del lado izquierdo; el derecho es su reflejo.
function LeftDetails({layer}) {
  if (layer === "back") {
    return <>
      <rect className="work-order-silhouette__wheel" x="53" y="66" width="13" height="56" rx="5" />
      <rect className="work-order-silhouette__wheel" x="53" y="286" width="13" height="56" rx="5" />
      <path className="work-order-silhouette__mirror" d="M50 132 L65 130 L65 148 L54 148 Q48 140 50 132 Z" />
    </>;
  }
  return <>
    <path className="work-order-silhouette__light" d="M86 30 Q98 24 114 28 L110 42 Q98 40 86 44 Z" />
    <path className="work-order-silhouette__light" d="M86 370 Q98 376 114 372 L110 358 Q98 360 86 356 Z" />
    <path className="work-order-silhouette__line" d="M128 54 L120 125 M120 275 L128 346" />
  </>;
}

function CarDetails() {
  return <g className="work-order-silhouette__details" aria-hidden="true" pointerEvents="none">
    <LeftDetails layer="front" />
    <g transform={MIRROR_FLIP}><LeftDetails layer="front" /></g>
    <rect className="work-order-silhouette__line" x="134" y="18" width="32" height="7" rx="3" />
    <path className="work-order-silhouette__glass" d="M112 125 L188 125 L180 154 L120 154 Z" />
    <path className="work-order-silhouette__glass" d="M120 246 L180 246 L188 275 L112 275 Z" />
    <rect className="work-order-silhouette__roof" x="123" y="160" width="54" height="80" rx="10" />
  </g>;
}

// Silueta interactiva (zones con estado) o mapa mínimo (mini): en el mapa se resalta la zona activa.
export default function CarSilhouette({activeZoneId, mini = false, onSelect, zones = RECEPTION_VEHICLE_ZONES}) {
  const clipId = `work-order-car-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const props = mini
    ? {className: "work-order-silhouette work-order-silhouette--mini", "aria-hidden": "true"}
    : {className: "work-order-silhouette", role: "group", "aria-label": "Silueta del vehículo con seis zonas"};

  return <svg viewBox="0 0 300 400" {...props}>
    <defs><clipPath id={clipId}><path d={BODY} /></clipPath></defs>
    <g aria-hidden="true">
      <LeftDetails layer="back" />
      <g transform={MIRROR_FLIP}><LeftDetails layer="back" /></g>
    </g>
    <g clipPath={`url(#${clipId})`}>
      <rect className="work-order-silhouette__cabin" x="118" y="125" width="64" height="150" />
      {zones.map((zone, index) => {
        const {x, y, width, height, anchor} = zone.slot;
        const active = zone.id === activeZoneId;
        if (mini) {
          return <rect key={zone.id} className="work-order-silhouette__zone" x={x} y={y} width={width} height={height}
            data-active={active ? "true" : undefined} />;
        }
        const label = `${index + 1}. ${zone.label}: ${zone.completed ? (zone.withDamages ? `con ${zone.damageCount} daño(s)` : "sin daños") : "pendiente"}`;
        return <g key={zone.id} className="work-order-silhouette__zone" data-completed={zone.completed ? "true" : undefined}
          role="button" tabIndex={0} aria-label={label} onClick={() => onSelect?.(zone)}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(zone); } }}>
          <rect x={x} y={y} width={width} height={height} />
          <text x={anchor.x} y={anchor.y + 8} textAnchor="middle">{zone.completed ? "✓" : index + 1}</text>
          {zone.withDamages && <g className="work-order-silhouette__damage">
            <circle cx={anchor.x + 12} cy={anchor.y - 22} r="11" />
            <text x={anchor.x + 12} y={anchor.y - 17} textAnchor="middle">{zone.damageCount}</text>
          </g>}
        </g>;
      })}
    </g>
    <path className="work-order-silhouette__body" d={BODY} />
    <CarDetails />
  </svg>;
}
