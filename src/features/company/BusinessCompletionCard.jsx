import React from "react";
import { Check, ChevronDown, ChevronUp, Circle } from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";

// `collapsible` pliega la tarjeta a una fila (título, barra, porcentaje y estado) con un
// control "Ver pendientes (N)": arranca siempre plegada y no persiste. Sin `collapsible`
// el marcado es el de siempre (p. ej. la activación inicial). Plegada, la lista no se
// dibuja, así que sus botones no entran en el orden de tabulación.
function BusinessCompletionCard({
  canActOnItem,
  className = "",
  collapsible = false,
  description = "Completa tu perfil para dejar tus documentos y operaciones listos.",
  error = false,
  loading = false,
  onAction,
  showSummary = true,
  status,
  title = "Estado de tu empresa",
}) {
  const [open, setOpen] = React.useState(false);
  const bodyId = `${React.useId()}-body`;

  if (!status) return null;

  const pendingCount = status.pendingItems.length;
  const canFold = collapsible && pendingCount > 0;
  const percentLabel = loading ? "…" : `${status.percent}%`;
  const progress = (
    <div
      className="business-completion-progress"
      role="progressbar"
      aria-label="Completitud de la empresa"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={status.percent}
    >
      <span style={{ width: `${status.percent}%` }} />
    </div>
  );
  const errorNotice = error && (
    <p className="settings-message settings-message--warning" role="status">
      No pudimos actualizar el estado de la empresa. Los datos pueden estar desactualizados.
    </p>
  );
  const summary = showSummary && (
    <p className="business-completion-card__summary">
      {status.label} · {status.verificationLabel}
    </p>
  );
  const checklist = (
    <ul className="business-completion-checklist">
      {status.items.map((item) => (
        <li className={item.completed ? "is-complete" : ""} key={item.id}>
          <span className="business-completion-checklist__item">
            <AppIcon icon={item.completed ? Check : Circle} size={17} />
            <span>{item.label}</span>
          </span>
          {!item.completed && item.actionLabel && onAction &&
            (!canActOnItem || canActOnItem(item)) && (
            <button type="button" onClick={() => onAction(item)}>
              {item.actionLabel}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
  const sectionClassName = `business-completion-card${collapsible ? " business-completion-card--collapsible" : ""}${className ? ` ${className}` : ""}`;

  if (collapsible) {
    return (
      <section className={sectionClassName} aria-labelledby="business-completion-title">
        <div className="business-completion-card__row">
          <h2 id="business-completion-title">{title}</h2>
          {progress}
          <strong aria-label={`${status.percent}% completado`}>{percentLabel}</strong>
          {summary}
          {canFold && (
            <Button
              type="button"
              variant="ghost"
              icon={open ? ChevronUp : ChevronDown}
              aria-controls={open ? bodyId : undefined}
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
            >
              {open ? "Ocultar pendientes" : `Ver pendientes (${pendingCount})`}
            </Button>
          )}
        </div>
        {errorNotice}
        {canFold && open && (
          <div className="business-completion-card__body" id={bodyId}>
            <p className="business-completion-card__summary">{description}</p>
            {checklist}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className={sectionClassName} aria-labelledby="business-completion-title">
      <div className="business-completion-card__heading">
        <div>
          <h2 id="business-completion-title">{title}</h2>
          <p>{description}</p>
        </div>
        <strong aria-label={`${status.percent}% completado`}>{percentLabel}</strong>
      </div>
      {progress}
      {errorNotice}
      {summary}
      {checklist}
    </section>
  );
}

export default BusinessCompletionCard;
