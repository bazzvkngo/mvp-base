import React from "react";
import { ChevronDown } from "lucide-react";
import AppIcon from "./AppIcon";

// Plegable de campos o datos opcionales. Controlado: la página guarda `open` y recibe
// `onOpenChange(siguiente)`, así puede abrirlo sola cuando hay contenido, un error de
// validación o un enfoque pedido desde fuera (nada con contenido queda oculto).
// - Cerrado no dibuja el cuerpo: los campos plegados no entran en el orden de tabulación.
// - Es un botón de disclosure (aria-expanded + aria-controls), no una acción: no es otra
//   familia de botón y la pantalla conserva su único botón principal.
// - `disabled` lo bloquea en su estado actual (p. ej. formulario de solo lectura, que lo
//   deja abierto).
function Disclosure({ children, className = "", description, disabled = false, id, onOpenChange, open, title }) {
  const generatedId = React.useId();
  const bodyId = `${id || generatedId}-body`;
  const classes = ["ui-disclosure", open ? "is-open" : "", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <button
        type="button"
        className="ui-disclosure__toggle"
        aria-controls={open ? bodyId : undefined}
        aria-expanded={Boolean(open)}
        disabled={disabled}
        onClick={() => onOpenChange?.(!open)}
      >
        <span className="ui-disclosure__text">
          <strong className="ui-disclosure__title">{title}</strong>
          {description && <small className="ui-disclosure__description">{description}</small>}
        </span>
        <AppIcon icon={ChevronDown} size={18} />
      </button>
      {open && <div className="ui-disclosure__body" id={bodyId}>{children}</div>}
    </div>
  );
}

export default Disclosure;
