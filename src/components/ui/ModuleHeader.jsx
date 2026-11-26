import React from "react";
import AppIcon from "./AppIcon";
import StatusBadge from "./StatusBadge";

// Cabecera de un módulo: ícono + título (el h1 de la página) + una línea de descripción
// a la izquierda, y las acciones a la derecha. NO reemplaza a ui/PageHeader, que sigue
// siendo el título de la barra superior de las rutas que no traen el suyo.
// - Una ruta que usa ModuleHeader debe estar en PAGE_HEADING_ROUTES (app/navigation.js):
//   así la barra superior muestra solo el negocio y no queda un segundo título.
// - `actions` se dibuja solo si `hasData` (por omisión true). Con la lista vacía la
//   página pasa hasData={false} y el único botón principal vive en <EmptyState>.
// - `chips` son textos cortos con lo que la página ya tiene (p. ej. "12 clientes");
//   se ignoran los vacíos y sin ninguno no se dibuja la fila.
function ModuleHeader({ actions, chips, className = "", description, hasData = true, icon, title, titleId }) {
  const chipList = (Array.isArray(chips) ? chips : []).filter((chip) => typeof chip === "string" && chip.trim());
  const showActions = Boolean(actions) && hasData !== false;
  const classes = ["ui-module-header", className].filter(Boolean).join(" ");

  return (
    <header className={classes}>
      {icon && <span className="ui-module-header__icon" aria-hidden="true"><AppIcon icon={icon} size={22} /></span>}
      <div className="ui-module-header__text">
        <h1 className="ui-module-header__title" id={titleId}>{title}</h1>
        {description && <p className="ui-module-header__description">{description}</p>}
        {chipList.length > 0 && (
          <ul className="ui-module-header__chips">
            {chipList.map((chip) => <li key={chip}><StatusBadge variant="neutral">{chip}</StatusBadge></li>)}
          </ul>
        )}
      </div>
      {showActions && <div className="ui-module-header__actions">{actions}</div>}
    </header>
  );
}

export default ModuleHeader;
