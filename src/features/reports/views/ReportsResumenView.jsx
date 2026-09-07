import React from "react";
import {BadgeDollarSign, Boxes, BriefcaseBusiness, ShoppingCart, TrendingUp} from "lucide-react";
import OperationalComparisonChart from "../../../components/reports/OperationalComparisonChart";
import {ProjectProfitabilityV4Summary} from "../ReportProfitabilityV4Section";
import {MetricCard} from "../ReportsSharedCards";
import {formatMoney} from "../../../utils/formatters";

// Vista ejecutiva compacta: unas pocas tarjetas de indicadores por moneda y un
// único gráfico comparativo. El detalle completo de cada dominio (ventas,
// compras, inventario, proyectos, ganancias) vive en su propia subvista; este
// resumen sólo reutiliza los mismos datos ya calculados por el contenedor
// (ReportsPage), sin duplicar tablas ni recalcular economía.
function ReportsResumenView({
  canViewProfitability,
  chartGroups,
  inventoryCard,
  links,
  onSelectView,
  profitabilityV4,
  summary,
}) {
  return <>
    <div className="reports-simple-currencies">{summary.currencies.map((group) => {
      const commercialGroup = profitabilityV4.commercial.bloque?.grupos?.find((entry) => entry.moneda === group.currency);
      const commercialReady = profitabilityV4.commercial.status === "ready";
      return <section className="reports-simple-currency-group" key={group.currency}>
        <h2>{group.currency}</h2>
        <div className="reports-simple-metrics">
          <MetricCard amount={formatMoney(group.sales.total, group.currency)} detail={group.sales.count ? `${group.sales.count} ${group.sales.count === 1 ? "venta confirmada" : "ventas confirmadas"}` : ""} emptyText="Aún no hay ventas confirmadas en este período." icon={BadgeDollarSign} linkLabel="Ver ventas" onOpen={links.sales ? () => onSelectView("ventas") : null} title="Ventas" />
          <MetricCard amount={formatMoney(group.purchases.total, group.currency)} detail={group.purchases.count ? `${group.purchases.count} ${group.purchases.count === 1 ? "compra confirmada" : "compras confirmadas"}` : ""} emptyText="Aún no hay compras confirmadas en este período." icon={ShoppingCart} linkLabel="Ver compras" onOpen={links.purchases ? () => onSelectView("compras") : null} title="Compras" />
          {profitabilityV4.canView && <MetricCard amount={commercialReady ? formatMoney(commercialGroup?.metricas?.margenBrutoProductosCubiertos, group.currency) : "Calculando…"} detail="Margen bruto de productos vendidos" emptyText="Sin ventas de productos con margen calculable." icon={TrendingUp} linkLabel="Ver ganancias" onOpen={() => onSelectView("ganancias")} title="Ganancia comercial" variant="margin" />}
          <MetricCard amount={group.projects.total === null ? "—" : formatMoney(group.projects.total, group.currency)} detail={group.projects.count ? `${group.projects.count} ${group.projects.count === 1 ? "proyecto con resultado" : "proyectos con resultado"}` : ""} emptyText="Sin proyectos con resultado disponible." icon={BriefcaseBusiness} linkLabel="Ver proyectos" onOpen={links.works ? () => onSelectView("proyectos") : null} restricted={!summary.projects.accessible} title="Ganancia de proyectos" variant="result" />
        </div>
      </section>;
    })}</div>

    <MetricCard
      amount={inventoryCard.amount}
      detail={inventoryCard.detail}
      emptyText="Consulta el detalle en Inventario."
      icon={Boxes}
      linkLabel="Ver inventario"
      onOpen={inventoryCard.canOpen ? () => onSelectView("inventario") : null}
      restricted={inventoryCard.restricted}
      title="Valor de inventario"
    />

    {canViewProfitability && <ProjectProfitabilityV4Summary canView={profitabilityV4.canView} projects={profitabilityV4.projects} />}

    <section className="erp-card reports-simple-chart">
      <div className="reports-section-heading"><div><span>Movimiento comercial</span><h2>Ventas y compras</h2><p>Operaciones confirmadas dentro del período seleccionado.</p></div></div>
      <div className="reports-chart-groups">{chartGroups.map((group) => <article className="reports-chart-group" key={group.currency}>
        <div className="reports-chart-summary">
          <span>{group.currency}</span>
          <dl>
            <div><dt><i className="reports-chart-summary__dot reports-chart-summary__dot--sales" aria-hidden="true" />Ventas confirmadas</dt><dd>{formatMoney(group.sales, group.currency)}</dd></div>
            <div><dt><i className="reports-chart-summary__dot reports-chart-summary__dot--purchases" aria-hidden="true" />Compras confirmadas</dt><dd>{formatMoney(group.purchases, group.currency)}</dd></div>
          </dl>
        </div>
        <OperationalComparisonChart currency={group.currency} items={group.items} />
      </article>)}</div>
    </section>
  </>;
}

export default ReportsResumenView;
