import React from "react";
import {ArrowRight} from "lucide-react";
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

// Vista dedicada a Compras: son egresos registrados del negocio, no un
// componente de resultado comercial. No se muestra margen ni utilidad alguna
// aquí; sólo el mismo detalle de compras confirmadas que ya calcula el
// contenedor.
function ReportsComprasView({canOpenPurchases, navigate, purchaseTimeline, summary, topPurchaseProducts, topPurchaseSuppliers}) {
  const hasPurchases = summary.purchases.confirmed.length > 0;
  return <>
    <p className="reports-simple-project-note">Las compras muestran egresos registrados del negocio.</p>
    <div className="reports-simple-currencies">{summary.currencies.map((group) => <section className="reports-simple-currency-group" key={group.currency}>
      <h2>{group.currency}</h2>
      <div className="reports-simple-metrics reports-simple-metrics--3col">
        <article className="reports-simple-card"><div className="reports-simple-card__top"><span className="reports-simple-card__title">Compras confirmadas</span></div><strong className="reports-simple-card__amount">{formatMoney(group.purchases.total, group.currency)}</strong><small>{group.purchases.count} operación(es)</small></article>
        <article className="reports-simple-card"><div className="reports-simple-card__top"><span className="reports-simple-card__title">Cantidad de compras</span></div><strong className="reports-simple-card__amount">{group.purchases.count}</strong><small>Confirmadas en el período</small></article>
        <article className="reports-simple-card"><div className="reports-simple-card__top"><span className="reports-simple-card__title">Monto promedio</span></div><strong className="reports-simple-card__amount">{formatMoney(group.purchases.average, group.currency)}</strong><small>Promedio por compra confirmada</small></article>
      </div>
    </section>)}</div>

    {!hasPurchases && <div className="erp-card reports-simple-state">Aún no hay compras confirmadas en este período.</div>}

    {hasPurchases && summary.currencies.map((group) => <section className="erp-card reports-detail-section" key={group.currency}>
      <div className="reports-section-heading"><div><span>{group.currency}</span><h2>Detalle de Compras</h2><p>Evolución, principales proveedores y productos adquiridos en el período seleccionado.</p></div></div>
      <div className="reports-detail-grid">
        <div>
          <h3 className="reports-detail-subheading">Evolución del período</h3>
          <TimelineTable currency={group.currency} items={purchaseTimeline} />
        </div>
        <div>
          <h3 className="reports-detail-subheading">Principales proveedores</h3>
          <TopEntityTable
            columns={["Proveedor", "Compras", "Monto"]}
            currency={group.currency}
            emptyText="Sin proveedores con compras confirmadas."
            groups={topPurchaseSuppliers}
            renderRow={(entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.count}</td><td>{formatMoney(entry.total, group.currency)}</td></tr>}
          />
        </div>
        <div>
          <h3 className="reports-detail-subheading">Productos adquiridos</h3>
          <TopEntityTable
            columns={["Ítem", "Cantidad", "Monto"]}
            currency={group.currency}
            emptyText="Sin ítems adquiridos en el período."
            groups={topPurchaseProducts}
            renderRow={(entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.quantity}</td><td>{formatMoney(entry.total, group.currency)}</td></tr>}
          />
        </div>
      </div>
    </section>)}

    <section className="erp-card reports-detail-section">
      <div className="reports-section-heading"><div><span>Operaciones</span><h2>Compras del período</h2><p>Listado de compras confirmadas usadas en las métricas de esta vista.</p></div>{canOpenPurchases && <button type="button" onClick={() => navigate("/compras")}>Ir a Compras<ArrowRight size={14} /></button>}</div>
      {!hasPurchases ? <p className="reports-empty-note">Sin compras confirmadas en el período.</p> : (
        <div className="reports-top-list-table-wrap"><table className="reports-top-list-table">
          <thead><tr><th>Número</th><th>Fecha</th><th>Proveedor</th><th>Moneda</th><th>Total</th></tr></thead>
          <tbody>{summary.purchases.confirmed.map((purchase) => <tr key={purchase.id || purchase.compraId || purchase.numero}>
            <td>{purchase.numero || "Compra"}</td>
            <td>{String(purchase.fechaCompra || "").slice(0, 10)}</td>
            <td>{purchase.proveedorSnapshot?.razonSocial || "Proveedor histórico"}</td>
            <td>{purchase.moneda || purchase.monedaCodigo || "CLP"}</td>
            <td>{formatMoney(purchase.total, purchase.moneda || purchase.monedaCodigo || "CLP")}</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </section>
  </>;
}

export default ReportsComprasView;
