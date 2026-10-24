import React from "react";
import {formatMoney} from "../../utils/formatters.js";

// Piezas visuales del diálogo de costos (Gastos, Horas hombre y Materiales).
// Presentacionales: no importan servicios ni guardan estado. Los formularios,
// handlers y cálculos siguen en FinancialSection / MaterialsSection
// (WorksPage.jsx); aquí solo viven el campo con etiqueta, el monto con símbolo
// de moneda, el desglose compacto, la fila de un registro y el control plegable
// de acciones secundarias (Anular / Devolver).

// Símbolo corto de la moneda del proyecto ("$" para CLP). Si Intl no lo
// resuelve, cae al código de moneda.
export function getCurrencySymbol(currency, locale = "es-CL") {
  try {
    const parts = new Intl.NumberFormat(locale, {style: "currency", currency, currencyDisplay: "narrowSymbol"}).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value || String(currency || "");
  } catch {
    return String(currency || "");
  }
}

export function CostField({children, className = "", label, optional = false}) {
  return (
    <label className={`erp-field works-cost-field ${className}`.trim()}>
      <span className="erp-field__label">{label}{optional && <span className="works-field-optional">Opcional</span>}</span>
      {children}
    </label>
  );
}

export function CostMoneyInput({currency, locale, ...inputProps}) {
  return (
    <span className="works-money-input">
      <span className="works-money-input__symbol" aria-hidden="true">{getCurrencySymbol(currency, locale)}</span>
      <input className="erp-control" inputMode="decimal" type="number" {...inputProps} />
    </span>
  );
}

// Resumen directos / indirectos siempre visible; el detalle por categoría va
// plegado y lista solo las categorías con monto.
export function WorkCostBreakdown({categories = [], currency, directTotal, indirectTotal, locale}) {
  const withAmount = categories.filter((category) => category.amount > 0);
  return (
    <div className="works-cost-breakdown">
      <dl className="works-cost-breakdown__summary">
        <div><dt>Costos directos</dt><dd>{formatMoney(directTotal, currency, locale)}</dd></div>
        <div><dt>Costos indirectos</dt><dd>{formatMoney(indirectTotal, currency, locale)}</dd></div>
      </dl>
      {withAmount.length > 0 && (
        <details className="works-cost-breakdown__detail">
          <summary>Detalle por categoría</summary>
          <ul>
            {withAmount.map((category) => <li key={category.value}><span>{category.label}</span><strong>{formatMoney(category.amount, currency, locale)}</strong></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

// Un registro de costo: concepto a la izquierda, monto a la derecha, etiquetas
// (tipo, directo/indirecto, anulado), línea de fecha · responsable · tarea y,
// al pie, evidencia y acciones.
export function WorkCostEntry({amount, annulled = false, annulledReason = "", children, meta = "", note = "", tags = [], title}) {
  return (
    <article className={annulled ? "works-cost-entry is-annulled" : "works-cost-entry"}>
      <header className="works-cost-entry__head">
        <strong className="works-cost-entry__title">{title}</strong>
        <strong className="works-cost-entry__amount">{amount}</strong>
      </header>
      {(tags.length > 0 || annulled) && (
        <ul className="works-cost-entry__tags">
          {tags.map((tag) => <li key={tag} className="works-cost-tag">{tag}</li>)}
          {annulled && <li className="works-cost-tag works-cost-tag--danger">Anulado</li>}
        </ul>
      )}
      {meta && <p className="works-cost-entry__meta">{meta}</p>}
      {note && <p className="works-cost-entry__note">{note}</p>}
      {annulled && annulledReason && <p className="works-cost-entry__annulled">Motivo de anulación: {annulledReason}</p>}
      {children && <footer className="works-cost-entry__footer">{children}</footer>}
    </article>
  );
}

// Acción secundaria que se despliega bajo el registro. `tone="danger"` es para
// Anular (destructivo); `neutral` para Devolver.
export function WorkCostDisclosure({children, label, tone = "neutral"}) {
  return (
    <details className={`works-cost-disclosure works-cost-disclosure--${tone}`}>
      <summary>{label}</summary>
      {children}
    </details>
  );
}
