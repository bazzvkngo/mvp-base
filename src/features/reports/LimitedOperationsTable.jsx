import React, {useId, useState} from "react";
import {ArrowRight} from "lucide-react";
import Button from "../../components/ui/Button";
import {DEFAULT_ROW_LIMIT, describeRowsShown, limitRows, sortByDateDesc} from "../../domain/reportFlowOverview.mjs";

// Operaciones recientes de Ventas y Compras (SPEC 025): las más recientes primero
// (orden por la fecha del documento) y solo las primeras `limit` filas; "Ver todas"
// despliega el resto en la misma página, sin depender de que el perfil pueda abrir
// el módulo. El enlace al módulo (`onOpen`) es aparte y solo se muestra si hay
// acceso. La fila la dibuja quien llama (`renderRow`), así cada pestaña conserva sus
// columnas (Neto y Total incluidos). Sin filas no dibuja nada: el vacío lo dice la
// pestaña una sola vez.
//
// `rows`: documentos; `dateField`: "fechaVenta" | "fechaCompra"; `columns`: rótulos de
// la cabecera de la tabla; `noun`: {singular, plural} para "Mostrando X de N ventas".
function LimitedOperationsTable({columns, dateField, initialExpanded = false, limit = DEFAULT_ROW_LIMIT, noun, onOpen = null, openLabel = "", renderRow, rows, title}) {
  const [expanded, setExpanded] = useState(Boolean(initialExpanded));
  const tableId = useId();
  const sorted = sortByDateDesc(rows, dateField);
  if (!sorted.length) return null;
  const view = limitRows(sorted, {limit, expanded});
  const {status, toggleLabel} = describeRowsShown(view, noun);

  return <section className="erp-card reports-detail-section reports-limited-table">
    <div className="reports-section-heading">
      <div><h2>{title}</h2></div>
      {onOpen && <button type="button" onClick={onOpen}>{openLabel}<ArrowRight size={14} /></button>}
    </div>
    <div className="reports-top-list-table-wrap" id={tableId}>
      <table className="reports-top-list-table">
        <thead><tr>{columns.map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{view.rows.map(renderRow)}</tbody>
      </table>
    </div>
    {status && <div className="reports-limited-table__footer">
      <span>{status}</span>
      <Button type="button" variant="ghost" aria-controls={tableId} aria-expanded={view.expanded} onClick={() => setExpanded((value) => !value)}>{toggleLabel}</Button>
    </div>}
  </section>;
}

export default LimitedOperationsTable;
