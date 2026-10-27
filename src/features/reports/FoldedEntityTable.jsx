import React from "react";
import {ChevronDown} from "lucide-react";

// Tabla de ranking de Ventas y Compras (clientes, productos adquiridos), plegada:
// no es lo primero que se busca, pero no se elimina (SPEC 025). Mismo plegable que
// "Ver el cálculo paso a paso" (clases reports-calc-details). `groups` es el ranking
// por moneda que ya llega de reportModel ({currency, entries}); aquí solo se elige la
// moneda. `label`: "Ver los principales clientes"; la fila la dibuja quien llama.
// Sin entradas no dibuja nada.
function FoldedEntityTable({columns, currency, groups, label, renderRow}) {
  const group = (Array.isArray(groups) ? groups : []).find((entry) => entry.currency === currency);
  const entries = group?.entries || [];
  if (!entries.length) return null;
  return <details className="reports-calc-details reports-folded-entities">
    <summary className="reports-calc-details__summary">
      <span>{`${label} (${entries.length})`}</span>
      <ChevronDown className="reports-calc-details__chevron" size={16} aria-hidden="true" />
    </summary>
    <div className="reports-calc-details__body">
      <div className="reports-top-list-table-wrap"><table className="reports-top-list-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{entries.map(renderRow)}</tbody>
      </table></div>
    </div>
  </details>;
}

export default FoldedEntityTable;
