import React from "react";
import BrandLogo from "./BrandLogo";
import AppIcon from "./ui/AppIcon";
import Button from "./ui/Button";
import EmptyStateIllustration from "./ui/EmptyStateIllustration";

// Mensaje de estado de la aplicación (ruta inexistente, error inesperado).
// - variant="screen": pantalla completa (sin sesión o fuera del menú); el título es el h1.
// - variant="content": dentro de la zona de contenido, con el menú y el encabezado
//   visibles; el h1 ya lo pone el encabezado, así que el título es un h2.
// `actions`: [{label, onClick, icon?}]; la primera es la acción principal.
function AppStatusPage({
  actions = [],
  description,
  icon,
  illustration = "error",
  role,
  title,
  titleId,
  variant = "content",
}) {
  const buttons = actions.map((action, index) => (
    <Button
      key={action.label}
      type="button"
      variant={index === 0 ? "primary" : "secondary"}
      icon={action.icon}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  ));

  if (variant === "screen") {
    return (
      <main className="onboarding-screen">
        <section className="onboarding-card onboarding-card--message" aria-labelledby={titleId} role={role}>
          <BrandLogo variant="auth" showText />
          {icon && (
            <span className="onboarding-icon" aria-hidden="true">
              <AppIcon icon={icon} size={24} />
            </span>
          )}
          <h1 id={titleId}>{title}</h1>
          <p>{description}</p>
          <div className="onboarding-message-actions">{buttons}</div>
        </section>
      </main>
    );
  }

  return (
    <section className="ui-empty-state ui-empty-state--panel" aria-labelledby={titleId} role={role}>
      <EmptyStateIllustration variant={illustration} />
      <h2 id={titleId} className="ui-empty-state__title">{title}</h2>
      <p className="ui-empty-state__description">{description}</p>
      <div className="ui-empty-state__actions">{buttons}</div>
    </section>
  );
}

export default AppStatusPage;
