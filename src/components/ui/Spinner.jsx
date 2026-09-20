import React from "react";

const SPINNER_SIZES = ["sm", "md"];

// Decorativo: el texto accesible (role="status", aria-busy) lo aporta el
// contenedor, no el spinner.
function Spinner({ size = "md", className = "" }) {
  const sizeModifier = SPINNER_SIZES.includes(size) ? size : "md";
  const classes = ["ui-spinner", `ui-spinner--${sizeModifier}`, className]
    .filter(Boolean)
    .join(" ");

  return <span className={classes} aria-hidden="true" />;
}

// Adaptador TEMPORAL: Button recibe `icon` como componente de ícono (lo
// renderiza AppIcon con size/strokeWidth), así que este wrapper ignora esas
// props y dibuja el anillo heredando el color del botón. El paso 3
// (Button loading) probablemente lo reemplace.
export function SpinnerIcon() {
  return <Spinner size="sm" className="ui-spinner--inherit" />;
}

export default Spinner;
