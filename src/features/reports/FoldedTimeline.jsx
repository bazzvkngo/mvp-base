import React from "react";
import {ChevronDown} from "lucide-react";
import useBusinessFormat from "../../hooks/useBusinessFormat";
import {formatMoney} from "../../utils/formatters";

// Evolución del período de Ventas y Compras, plegada (SPEC 025): puede tener una
// fila por día (hasta 92) y no es lo primero que se busca. Usa el mismo plegable
// de "Ver el cálculo paso a paso" (clases reports-calc-details). `items` es la lista que ya arma
// aggregateOperationalTimeline ({key, currency, count, value}); aquí solo se
// filtra por moneda. Sin filas no dibuja nada.
function FoldedTimeline({currency, items, showCurrency = false}) {
  const {locale} = useBusinessFormat();
  const rows = (Array.isArray(items) ? items : []).filter((item) => item.currency === currency);
  if (!rows.length) return null;
  const byMonth = rows.every((row) => /^\d{4}-\d{2}$/.test(String(row.key)));
  return <details className="reports-calc-details reports-folded-timeline">
    <summary className="reports-calc-details__summary">
      <span>{`Ver la evolución por ${byMonth ? "mes" : "día"}${showCurrency ? ` en ${currency}` : ""} (${rows.length})`}</span>
      <ChevronDown className="reports-calc-details__chevron" size={16} aria-hidden="true" />
    </summary>
    <div className="reports-calc-details__body">
      <div className="reports-top-list-table-wrap"><table className="reports-top-list-table">
        <thead><tr><th>Período</th><th>Operaciones</th><th>Monto</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}><td>{row.key}</td><td>{row.count}</td><td>{formatMoney(row.value, currency, locale)}</td></tr>)}</tbody>
      </table></div>
    </div>
  </details>;
}

export default FoldedTimeline;
