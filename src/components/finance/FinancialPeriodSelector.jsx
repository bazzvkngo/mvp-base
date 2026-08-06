import React from "react";

const DEFAULT_OPTIONS = [
  { id: "today", label: "Hoy" },
  { id: "week", label: "Esta semana" },
  { id: "month", label: "Este mes" },
  { id: "custom", label: "Periodo personalizado" },
];

function FinancialPeriodSelector({
  customEnd,
  customStart,
  idPrefix = "financial-period",
  onCustomEndChange,
  onCustomStartChange,
  onPeriodChange,
  options = DEFAULT_OPTIONS,
  period,
}) {
  return (
    <div className="financial-period-control">
      <label className="erp-field">
        <span className="erp-field__label">Periodo</span>
        <select
          className="erp-control"
          id={`${idPrefix}-select`}
          value={period}
          onChange={(event) => onPeriodChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {period === "custom" && (
        <>
          <label className="erp-field">
            <span className="erp-field__label">Desde</span>
            <input
              className="erp-control"
              id={`${idPrefix}-start`}
              type="date"
              value={customStart}
              onChange={(event) => onCustomStartChange(event.target.value)}
            />
          </label>
          <label className="erp-field">
            <span className="erp-field__label">Hasta</span>
            <input
              className="erp-control"
              id={`${idPrefix}-end`}
              type="date"
              value={customEnd}
              onChange={(event) => onCustomEndChange(event.target.value)}
            />
          </label>
        </>
      )}
    </div>
  );
}

export default FinancialPeriodSelector;
