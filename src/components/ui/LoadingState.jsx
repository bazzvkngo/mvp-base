import React from "react";
import Spinner from "./Spinner";

const LOADING_STATE_VARIANTS = ["page", "section", "inline"];

// Estado de carga de una región (no de un botón). El texto visible es el
// nombre accesible: role="status" vive solo aquí, así que el elemento que se
// reemplace no debe conservar su propio role ni aria-live. El label va como
// único nodo de texto de su elemento.
function LoadingState({ variant = "section", label, className = "" }) {
  const variantModifier = LOADING_STATE_VARIANTS.includes(variant)
    ? variant
    : "section";
  const text = typeof label === "string" ? label : "";
  const classes = [
    "ui-loading-state",
    `ui-loading-state--${variantModifier}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="status">
      <Spinner size={variantModifier === "inline" ? "sm" : "md"} />
      <span className="ui-loading-state__label">{text}</span>
    </div>
  );
}

export default LoadingState;
