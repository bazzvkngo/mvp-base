import React, {useId} from "react";
import "./veterinary-forms.css";

// Campo de formulario de Veterinaria: etiqueta con "*" si es obligatorio y error en línea
// bajo el control (mismo patrón que VehicleFormFields de Taller). Los formularios usan
// noValidate y muestran los errores del modelo, no los globos nativos del navegador.
export default function VeterinaryField({children, error, label, required = false}) {
  const errorId = useId();
  return (
    <label className="erp-field">
      <span className="erp-field__label">{label}{required ? " *" : ""}</span>
      {React.cloneElement(children, {
        "aria-describedby": error ? errorId : undefined,
        "aria-invalid": Boolean(error),
        "aria-required": required || undefined,
      })}
      {error && <span id={errorId} className="veterinary-field-error" role="alert">{error}</span>}
    </label>
  );
}
