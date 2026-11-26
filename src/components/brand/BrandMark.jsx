import React from "react";

// Marca de ValoraCloud: una C abierta con un visto. Decorativa: el nombre
// accesible lo aporta el texto de BrandLogo. La C usa currentColor (el color
// de marca lo fija quien la dibuja) y el visto, --color-logo-accent.
//
// `animated` (opcional, apagado por defecto): dibuja el arco de la C y luego
// hace aparecer el visto, en bucle suave. Las reglas están en layout.css
// (.brand-mark--animated); con prefers-reduced-motion la marca queda quieta y
// completa. pathLength="1" normaliza el largo para animar stroke-dasharray.
//
// `onDark` (opcional): variante para fondos oscuros fijos (p. ej. el menú de la
// consola de plataforma). Fija el trazo de la C y el visto desde los tokens
// --color-dark-* en lugar de seguir el tema (.brand-mark--on-dark en layout.css).
function BrandMark({ size = 40, className = "", animated = false, onDark = false }) {
  const classes = [
    "brand-mark",
    animated && "brand-mark--animated",
    onDark && "brand-mark--on-dark",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const drawProps = animated ? { pathLength: 1 } : {};

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className={animated ? "brand-mark__arc" : undefined}
        d="M46.15 19.38A20.5 20.5 0 1 0 46.15 44.62"
        stroke="currentColor"
        strokeWidth="5.5"
        strokeLinecap="round"
        {...drawProps}
      />
      <path
        className={animated ? "brand-mark__check" : undefined}
        d="M20.5 32.5L28 40 40.5 23.5"
        stroke="var(--color-logo-accent)"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...drawProps}
      />
    </svg>
  );
}

export default BrandMark;
