import React from "react";
import AppIcon from "../ui/AppIcon";
import { formatCLP } from "../../utils/formatters";

function FinancialMetricCard({
  icon,
  label,
  note = "",
  tone = "neutral",
  value,
}) {
  return (
    <article className={`financial-metric-card financial-metric-card--${tone}`}>
      <div className="financial-metric-card__heading">
        {icon && (
          <span className="financial-metric-card__icon" aria-hidden="true">
            <AppIcon icon={icon} size={19} />
          </span>
        )}
        <span className="financial-metric-card__label">{label}</span>
      </div>
      <strong className="financial-metric-card__value">{formatCLP(value)}</strong>
      {note && <span className="financial-metric-card__note">{note}</span>}
    </article>
  );
}

export default FinancialMetricCard;
