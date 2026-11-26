import React from "react";

// Círculo del margen sobre ventas (SPEC 025, Resumen visual). Dibuja lo que
// entrega describeProfitMargin: no calcula nada. Solo un margen positivo llena
// el arco (hasta el 100 %); cero y negativo dejan el círculo vacío y el número
// del centro (con su signo) y la frase de la tarjeta dicen el sentido, así que
// el color nunca es lo único que distingue ganar de perder.
//
// Los colores y el grosor salen de interior.css con tokens (sin literales). El
// círculo es decorativo para lectores de pantalla (aria-hidden): el contenedor
// expone la frase completa como etiqueta de la imagen.
const RADIUS = 16;
const CENTER = 20;

function ringValueText(description, locale) {
  if (description.kind === "none") return "—";
  const text = Math.abs(description.percent).toLocaleString(locale, {maximumFractionDigits: 1});
  return description.kind === "negative" ? `−${text} %` : `${text} %`;
}

function MarginRing({description, locale = "es-CL"}) {
  if (!description || description.kind === "pending") return null;
  const {fraction, tone} = description.ring;

  return <div className={`reports-ring reports-ring--${tone}`} role="img" aria-label={description.ariaLabel}>
    <svg className="reports-ring__svg" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle className="reports-ring__track" cx={CENTER} cy={CENTER} r={RADIUS} />
      {fraction > 0 && <circle
        className="reports-ring__arc"
        cx={CENTER}
        cy={CENTER}
        r={RADIUS}
        pathLength="100"
        strokeDasharray={`${Math.round(fraction * 10000) / 100} 100`}
        transform={`rotate(-90 ${CENTER} ${CENTER})`}
      />}
    </svg>
    <span className="reports-ring__value" aria-hidden="true">{ringValueText(description, locale)}</span>
  </div>;
}

export default MarginRing;
