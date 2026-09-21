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

export default Spinner;
