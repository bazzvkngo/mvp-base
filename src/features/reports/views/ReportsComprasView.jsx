import React from "react";
import {ArrowRight} from "lucide-react";
import Button from "../../../components/ui/Button";
import OperationalComparisonChart from "../../../components/reports/OperationalComparisonChart";
import {buildShareBars, countWithoutNet} from "../../../domain/reportFlowOverview.mjs";
import {formatMoney} from "../../../utils/formatters";
import useBusinessFormat from "../../../hooks/useBusinessFormat";
import FoldedEntityTable from "../FoldedEntityTable";
import FoldedTimeline from "../FoldedTimeline";
import LimitedOperationsTable from "../LimitedOperationsTable";
import ReportsFlowHeader from "../ReportsFlowHeader";
import ReportsShareBars from "../ReportsShareBars";

// Vista dedicada a Compras (SPEC 025, visual): son egresos registrados del negocio, no un
// componente de resultado comercial. No se muestra margen ni utilidad alguna aquí:
// la cabecera "Compré" por moneda, a quién se le compró (barras por proveedor), el
// gráfico Ventas vs Compras con su nota, las últimas compras y, plegados, los
// productos adquiridos y la evolución. Reutiliza los datos ya calculados por el
// contenedor.
function ReportsComprasView({canOpenPurchases, chartGroups, fallbackCurrency = "CLP", navigate, purchaseTimeline, summary, topPurchaseProducts, topPurchaseSuppliers}) {
  const { locale: businessLocale } = useBusinessFormat();
  const confirmed = summary.purchases.confirmed;
  const hasPurchases = confirmed.length > 0;
  const showCurrency = summary.currencies.length > 1;
  // El gráfico solo se dibuja para las monedas con ventas o compras en el período.
  const chartGroupsWithData = chartGroups.filter((group) => group.items.length > 0);
  return <>
    {summary.currencies.map((group, index) => <ReportsFlowHeader count={group.purchases.count} currency={group.currency} key={group.currency} kind="purchases" note={index === 0 ? "Las compras muestran egresos registrados del negocio." : ""} showCurrency={showCurrency} total={group.purchases.total} withoutNetCount={countWithoutNet(confirmed, {currency: group.currency, fallbackCurrency})} />)}

    {/* Único mensaje de vacío de la pestaña: los $0 de la cabecera no se repiten en otras secciones. */}
    {!hasPurchases && <div className="erp-card reports-simple-state"><span>Aún no hay compras confirmadas en este período.</span>{canOpenPurchases && <Button type="button" variant="secondary" onClick={() => navigate("/compras")}>Ir a Compras<ArrowRight size={14} /></Button>}</div>}

    {/* SPEC 022 §6.3: el gráfico Ventas vs Compras vive aquí, sin cambios de cálculo. Sin ventas ni compras no se dibuja. */}
    {chartGroupsWithData.length > 0 && <section className="erp-card reports-simple-chart">
      <div className="reports-section-heading"><div><span>Movimiento comercial</span><h2>Ventas y compras</h2><p>Operaciones confirmadas dentro del período seleccionado.</p></div></div>
      <p className="reports-v4-note">Comparar ventas y compras no es ganancia. Las compras incluyen stock que aún no se vende, y ambos montos van sin IVA. Cuánto ganas está en la pestaña Ganancia.</p>
      <div className="reports-chart-groups">{chartGroupsWithData.map((group) => <article className="reports-chart-group" key={group.currency}>
        <div className="reports-chart-summary">
          <span>{group.currency}</span>
          <dl>
            <div><dt><i className="reports-chart-summary__dot reports-chart-summary__dot--sales" aria-hidden="true" />Ventas confirmadas</dt><dd>{formatMoney(group.sales, group.currency, businessLocale)}</dd></div>
            <div><dt><i className="reports-chart-summary__dot reports-chart-summary__dot--purchases" aria-hidden="true" />Compras confirmadas</dt><dd>{formatMoney(group.purchases, group.currency, businessLocale)}</dd></div>
          </dl>
        </div>
        <OperationalComparisonChart currency={group.currency} items={group.items} />
      </article>)}</div>
    </section>}

    {hasPurchases && summary.currencies.map((group) => <ReportsShareBars
      bars={buildShareBars(topPurchaseSuppliers.find((entry) => entry.currency === group.currency)?.entries || [], {locale: businessLocale, total: group.purchases.total})}
      currency={group.currency}
      key={group.currency}
      kind="purchases"
      othersLabel="Otros proveedores"
      showCurrency={showCurrency}
      subtitle={(row) => `${row.count} ${row.count === 1 ? "compra" : "compras"}`}
      title="¿A quién le compré?"
    />)}

    <LimitedOperationsTable
      columns={["Número", "Fecha", "Proveedor", "Moneda", "Neto", "Total"]}
      dateField="fechaCompra"
      noun={{singular: "compra", plural: "compras"}}
      onOpen={canOpenPurchases ? () => navigate("/compras") : null}
      openLabel="Ir a Compras"
      renderRow={(purchase) => <tr key={purchase.id || purchase.compraId || purchase.numero}>
        <td>{purchase.numero || "Compra"}</td>
        <td>{String(purchase.fechaCompra || "").slice(0, 10)}</td>
        <td>{purchase.proveedorSnapshot?.razonSocial || "Proveedor histórico"}</td>
        <td>{purchase.moneda || purchase.monedaCodigo || "CLP"}</td>
        <td>{Number.isFinite(purchase.neto) ? formatMoney(purchase.neto, purchase.moneda || purchase.monedaCodigo || "CLP", businessLocale) : "—"}</td>
        <td>{formatMoney(purchase.total, purchase.moneda || purchase.monedaCodigo || "CLP", businessLocale)}</td>
      </tr>}
      rows={confirmed}
      title="Últimas compras"
    />

    {hasPurchases && summary.currencies.map((group) => <React.Fragment key={group.currency}>
      <FoldedEntityTable
        columns={["Ítem", "Cantidad", "Monto"]}
        currency={group.currency}
        groups={topPurchaseProducts}
        label={`Ver los productos adquiridos${showCurrency ? ` en ${group.currency}` : ""}`}
        renderRow={(entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.quantity}</td><td>{formatMoney(entry.total, group.currency, businessLocale)}</td></tr>}
      />
      <FoldedTimeline currency={group.currency} items={purchaseTimeline} showCurrency={showCurrency} />
    </React.Fragment>)}
  </>;
}

export default ReportsComprasView;
