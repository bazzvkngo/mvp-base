import React from "react";
import {ArrowRight} from "lucide-react";
import {SalesCommercialMarginV4Card} from "../ReportProfitabilityV4Section";
import {formatMoney} from "../../../utils/formatters";

function TimelineTable({items, currency}) {
  const rows = items.filter((item) => item.currency === currency);
  if (!rows.length) return <p className="reports-empty-note">Sin evolución disponible en este período.</p>;
  return <div className="reports-top-list-table-wrap"><table className="reports-top-list-table">
    <thead><tr><th>Período</th><th>Operaciones</th><th>Monto</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key}><td>{row.key}</td><td>{row.count}</td><td>{formatMoney(row.value, currency)}</td></tr>)}</tbody>
  </table></div>;
}

function TopEntityTable({groups, currency, columns, renderRow, emptyText}) {
  const group = groups.find((entry) => entry.currency === currency);
  if (!group || !group.entries.length) return <p className="reports-empty-note">{emptyText}</p>;
  return <div className="reports-top-list-table-wrap"><table className="reports-top-list-table">
    <thead><tr>{columns.map((label) => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{group.entries.map(renderRow)}</tbody>
  </table></div>;
}

// Vista dedicada a Ventas: reutiliza exactamente los datos ya calculados por
// el contenedor (summary.sales, salesTimeline, topSalesClients/Products) y el
// margen comercial V4 ya existente. No recalcula ni redefine ninguna fórmula
// económica; sólo presenta ese mismo dato en un espacio propio.
function ReportsVentasView({canOpenSales, navigate, profitabilityV4, salesTimeline, summary, topSalesClients, topSalesProducts}) {
  const hasSales = summary.sales.confirmed.length > 0;
  return <>
    <div className="reports-simple-currencies">{summary.currencies.map((group) => <section className="reports-simple-currency-group" key={group.currency}>
      <h2>{group.currency}</h2>
      <div className="reports-simple-metrics reports-simple-metrics--3col">
        <article className="reports-simple-card"><div className="reports-simple-card__top"><span className="reports-simple-card__title">Ventas confirmadas</span></div><strong className="reports-simple-card__amount">{formatMoney(group.sales.total, group.currency)}</strong><small>{group.sales.count} operación(es)</small></article>
        <article className="reports-simple-card"><div className="reports-simple-card__top"><span className="reports-simple-card__title">Cantidad de ventas</span></div><strong className="reports-simple-card__amount">{group.sales.count}</strong><small>Confirmadas en el período</small></article>
        <article className="reports-simple-card"><div className="reports-simple-card__top"><span className="reports-simple-card__title">Ticket promedio</span></div><strong className="reports-simple-card__amount">{formatMoney(group.sales.average, group.currency)}</strong><small>Promedio por venta confirmada</small></article>
      </div>
    </section>)}</div>

    {!hasSales && <div className="erp-card reports-simple-state">Aún no hay ventas confirmadas en este período.</div>}

    {hasSales && summary.currencies.map((group) => <section className="erp-card reports-detail-section" key={group.currency}>
      <div className="reports-section-heading"><div><span>{group.currency}</span><h2>Detalle de Ventas</h2><p>Evolución, principales clientes y productos más vendidos, con datos del período seleccionado.</p></div></div>
      <div className="reports-detail-grid">
        <div>
          <h3 className="reports-detail-subheading">Evolución del período</h3>
          <TimelineTable currency={group.currency} items={salesTimeline} />
        </div>
        <div>
          <h3 className="reports-detail-subheading">Principales clientes</h3>
          <TopEntityTable
            columns={["Cliente", "Ventas", "Monto"]}
            currency={group.currency}
            emptyText="Sin clientes con ventas confirmadas."
            groups={topSalesClients}
            renderRow={(entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.count}</td><td>{formatMoney(entry.total, group.currency)}</td></tr>}
          />
        </div>
        <div>
          <h3 className="reports-detail-subheading">Productos/servicios más vendidos</h3>
          <TopEntityTable
            columns={["Ítem", "Cantidad", "Monto"]}
            currency={group.currency}
            emptyText="Sin ítems vendidos en el período."
            groups={topSalesProducts}
            renderRow={(entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.quantity}</td><td>{formatMoney(entry.total, group.currency)}</td></tr>}
          />
        </div>
      </div>
    </section>)}

    <SalesCommercialMarginV4Card canView={profitabilityV4.canView} commercial={profitabilityV4.commercial} onRetry={profitabilityV4.reload} />

    <section className="erp-card reports-detail-section">
      <div className="reports-section-heading"><div><span>Operaciones</span><h2>Ventas del período</h2><p>Listado de ventas confirmadas usadas en las métricas de esta vista.</p></div>{canOpenSales && <button type="button" onClick={() => navigate("/ventas")}>Ir a Ventas<ArrowRight size={14} /></button>}</div>
      {!hasSales ? <p className="reports-empty-note">Sin ventas confirmadas en el período.</p> : (
        <div className="reports-top-list-table-wrap"><table className="reports-top-list-table">
          <thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Moneda</th><th>Total</th></tr></thead>
          <tbody>{summary.sales.confirmed.map((sale) => <tr key={sale.id || sale.ventaId || sale.numero}>
            <td>{sale.numero || "Venta"}</td>
            <td>{String(sale.fechaVenta || "").slice(0, 10)}</td>
            <td>{sale.clienteSnapshot?.nombreRazonSocial || "Cliente histórico"}</td>
            <td>{sale.moneda || sale.monedaCodigo || "CLP"}</td>
            <td>{formatMoney(sale.total, sale.moneda || sale.monedaCodigo || "CLP")}</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </section>
  </>;
}

export default ReportsVentasView;
