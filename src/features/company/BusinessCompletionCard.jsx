import React from "react";
import { Check, Circle } from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";

function BusinessCompletionCard({
  className = "",
  description = "Completa tu perfil para dejar tus documentos y operaciones listos.",
  loading = false,
  onAction,
  status,
  title = "Estado de tu empresa",
}) {
  if (!status) return null;

  return (
    <section
      className={`business-completion-card${className ? ` ${className}` : ""}`}
      aria-labelledby="business-completion-title"
    >
      <div className="business-completion-card__heading">
        <div>
          <h2 id="business-completion-title">{title}</h2>
          <p>{description}</p>
        </div>
        <strong aria-label={`${status.percent}% completado`}>
          {loading ? "…" : `${status.percent}%`}
        </strong>
      </div>
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
      <p className="business-completion-card__summary">
        {status.label} · {status.verificationLabel}
      </p>
      <ul className="business-completion-checklist">
        {status.items.map((item) => (
          <li className={item.completed ? "is-complete" : ""} key={item.id}>
            <span className="business-completion-checklist__item">
              <AppIcon icon={item.completed ? Check : Circle} size={17} />
              <span>{item.label}</span>
            </span>
            {!item.completed && onAction && (
              <button type="button" onClick={() => onAction(item)}>
                {item.actionLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default BusinessCompletionCard;
