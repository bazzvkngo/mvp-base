import React from "react";
import AppIcon from "./AppIcon";
import Spinner from "./Spinner";

// Durante la carga el botón no queda `disabled` (así conserva el foco), así
// que este guard imita a uno deshabilitado: ni el clic, ni Enter/Espacio, ni
// el envío del formulario llegan al onClick del consumidor.
function blockWhileLoading(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

const Button = React.forwardRef(function Button(
  {
    children,
    className = "",
    icon,
    iconSize = 18,
    loading = false,
    variant = "primary",
    ...props
  },
  ref
) {
  const isLoading = Boolean(loading);
  const classes = [
    "ui-button",
    `ui-button--${variant}`,
    isLoading && "ui-button--loading",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // Sin loading no se agrega nada: mismo DOM y mismos handlers que antes.
  // Los atributos de carga van antes de {...props} para que un aria-busy o un
  // disabled explícito del consumidor prevalezcan; el guard va después para
  // reemplazar su onClick solo mientras dura la carga.
  const loadingAttributes = isLoading
    ? { "aria-busy": true, "aria-disabled": true }
    : null;
  const loadingHandlers = isLoading ? { onClick: blockWhileLoading } : null;

  return (
    <button
      ref={ref}
      className={classes}
      {...loadingAttributes}
      {...props}
      {...loadingHandlers}
    >
      {isLoading ? (
        <Spinner size="sm" className="ui-spinner--inherit" />
      ) : (
        icon && <AppIcon icon={icon} size={iconSize} />
      )}
      {children && <span className="ui-button__label">{children}</span>}
    </button>
  );
});

export default Button;
