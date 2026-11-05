import React from "react";
import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import AppIcon from "./AppIcon";

// Aviso en bloque con cuatro variantes. El color refuerza, pero lo que distingue
// una variante de otra es la forma del icono y el texto visible: advertencia = círculo
// con "!", error = círculo con "x", info = "i", éxito = círculo con visto.
// - El icono es decorativo (AppIcon lo marca aria-hidden): nunca es lo único que dice algo.
// - Rol por defecto: "alert" para error y "status" para el resto. `role={null}` lo quita
//   (avisos estáticos que ya existen al montar la pantalla). Un solo role por aviso: no
//   anidar otro role ni aria-live dentro de `children`, `title` ni `actions`.
// - `actions` es un espacio para botones debajo del texto; el aviso no crea botones.
const VARIANT_ICONS = Object.freeze({
  error: CircleX,
  info: Info,
  success: CircleCheck,
  warning: CircleAlert,
});

const DEFAULT_ROLES = Object.freeze({ error: "alert" });

function Notice({
  actions,
  children,
  className = "",
  icon,
  role,
  title,
  variant = "info",
  ...props
}) {
  const knownVariant = Object.hasOwn(VARIANT_ICONS, variant) ? variant : "info";
  const resolvedRole = role === undefined ? DEFAULT_ROLES[knownVariant] || "status" : role || undefined;
  const classes = ["ui-notice", `ui-notice--${knownVariant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role={resolvedRole} {...props}>
      <span className="ui-notice__icon">
        <AppIcon icon={icon || VARIANT_ICONS[knownVariant]} size={18} />
      </span>
      <div className="ui-notice__content">
        {title && <strong className="ui-notice__title">{title}</strong>}
        {children && <div className="ui-notice__body">{children}</div>}
        {actions && <div className="ui-notice__actions">{actions}</div>}
      </div>
    </div>
  );
}

export default Notice;
