import React from "react";
import AppIcon from "./AppIcon";

// Control segmentado: elegir una opción entre pocas, siempre visibles. Usa
// radios nativos (ocultos a la vista, no al lector de pantalla), así que el
// teclado funciona como en cualquier grupo de radios: Tab entra al grupo y
// las flechas cambian la opción.
export default function SegmentedControl({ className = "", legend, name, onChange, options, value }) {
  return (
    <fieldset className={["ui-segmented", className].filter(Boolean).join(" ")}>
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label className="ui-segmented__option" key={option.value}>
          <input
            checked={value === option.value}
            className="ui-segmented__input sr-only"
            name={name}
            onChange={() => onChange(option.value)}
            type="radio"
            value={option.value}
          />
          <span className="ui-segmented__content">
            {option.icon && <AppIcon icon={option.icon} size={16} />}
            <span>{option.label}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
