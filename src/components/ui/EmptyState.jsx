import React from "react";
import AppIcon from "./AppIcon";
import Button from "./Button";
import EmptyStateIllustration from "./EmptyStateIllustration";

// Estado vacío de módulo (SPEC 010/016: una sola forma de decir "aún no hay nada").
// - `action` es la ÚNICA acción principal: { label, onClick, icon?, disabled? }. Sin
//   `action` no se dibuja ningún botón (p. ej. un rol sin permiso de crear), y como la
//   cabecera del módulo no recibe acciones mientras no hay datos (ver ModuleHeader),
//   el botón principal nunca queda repetido en la misma pantalla.
// - `links` son acciones secundarias de texto: [{ label, onClick }]. No son botones.
// - Gráfico: `icon` (círculo con el ícono del módulo) o, si no se pasa, la ilustración
//   `illustration` ("empty-list" por omisión; "no-results", "error", etc. para otros casos).
// - `headingLevel` ajusta el nivel del título (2 por omisión: el h1 es de la cabecera).
// Los títulos y textos los pone cada página; este componente no fija ninguno.
function EmptyState({
  action,
  className = "",
  description,
  headingLevel = 2,
  icon,
  illustration = "empty-list",
  links,
  title,
}) {
  const Heading = `h${[2, 3, 4].includes(headingLevel) ? headingLevel : 2}`;
  const secondary = (Array.isArray(links) ? links : []).filter((link) => link?.label && typeof link.onClick === "function");
  const hasAction = Boolean(action?.label);
  const classes = ["ui-empty-state", "ui-empty-state--panel", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      {icon
        ? <span className="ui-empty-state__icon" aria-hidden="true"><AppIcon icon={icon} size={26} /></span>
        : <EmptyStateIllustration variant={illustration} />}
      {title && <Heading className="ui-empty-state__title">{title}</Heading>}
      {description && <p className="ui-empty-state__description">{description}</p>}
      {hasAction && (
        <div className="ui-empty-state__actions">
          <Button type="button" variant="primary" icon={action.icon} disabled={action.disabled} onClick={action.onClick}>{action.label}</Button>
        </div>
      )}
      {secondary.length > 0 && (
        <div className="ui-empty-state__links">
          {secondary.map((link) => <button className="ui-empty-state__link" key={link.label} type="button" onClick={link.onClick}>{link.label}</button>)}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
