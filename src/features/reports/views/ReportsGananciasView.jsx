import React, {useMemo} from "react";
import {MonthlyOperationalProfitChart, RankedMarginChart} from "../../../components/reports/OperationalProfitCharts";
import {OperationalNetProfitBreakdown} from "../OperationalNetProfitBreakdown";
import {SalesCommercialMarginV4Card} from "../ReportProfitabilityV4Cards";
import {
  buildClientOperationalProfit,
  buildMonthlyOperationalProfit,
  buildProductGrossMargin,
} from "../operationalNetProfitCharts.mjs";

// Vista de Ganancias (SPEC 022 §6.5): el desglose de la
// ganancia neta operacional, el análisis de margen comercial de todas las
// Ventas (que no se suma a ella) y tres gráficos. La única suma es la que entrega el helper de
// dominio; esta vista no combina bloques por su cuenta.
function ReportsGananciasView({currency, operationalProfit, profitabilityV4, range}) {
  const {commercial, projects} = profitabilityV4;
  const charts = useMemo(() => {
    if (operationalProfit.status !== "ready") return null;
    const input = {
      sales: commercial.meta?.items || [],
      projectBalances: projects.meta?.proyectos || [],
      range,
      currency,
    };
    return {
      monthly: buildMonthlyOperationalProfit({...input, salesTruncated: Boolean(commercial.meta?.lecturaTruncada), projectsError: projects.status === "error"}),
      clients: buildClientOperationalProfit(input),
      products: buildProductGrossMargin(input),
    };
  }, [commercial, currency, operationalProfit.status, projects, range]);

  if (!profitabilityV4.canView) {
    return <div className="erp-card reports-simple-state">Tu perfil no incluye información de ganancias.</div>;
  }

  return <>
    <section className="erp-card reports-detail-section">
      <div className="reports-section-heading"><div><span>Ganancias</span><h2>Ganancia neta operacional</h2><p>Ventas sin proyecto y proyectos del período, cada venta contada una sola vez.</p></div></div>
      <OperationalNetProfitBreakdown canView={profitabilityV4.canView} currency={currency} onRetry={profitabilityV4.reload} state={operationalProfit} />
    </section>

    <section className="reports-ganancias-block">
      <h2 className="reports-detail-subheading">Ganancias por Ventas</h2>
      <p className="reports-simple-project-note">Análisis de margen comercial, no se suma a la ganancia neta operacional.</p>
      <SalesCommercialMarginV4Card canView={profitabilityV4.canView} commercial={commercial} onRetry={profitabilityV4.reload} />
    </section>

    {charts && <>
      {charts.monthly.map((group) => <section className="erp-card reports-detail-section" key={`monthly-${group.moneda}`}>
        <div className="reports-section-heading"><div><span>{group.moneda}</span><h2>Evolución mensual</h2><p>Ganancia neta operacional por mes, en sus dos componentes.</p></div></div>
        <MonthlyOperationalProfitChart currency={group.moneda} months={group.meses} />
        {group.meses.some((month) => month.parcial) && <p className="reports-v4-note">* Mes con cobertura parcial: revisa el estado del sistema en Rentabilidad y estado.</p>}
      </section>)}

      {charts.clients.map((group) => <section className="erp-card reports-detail-section" key={`clients-${group.moneda}`}>
        <div className="reports-section-heading"><div><span>{group.moneda}</span><h2>Margen por cliente</h2><p>Ganancia neta operacional atribuida a cada cliente; las barras suman la del período.</p></div></div>
        <RankedMarginChart bars={group.barras} currency={group.moneda} label="Ganancia neta operacional del cliente" />
      </section>)}

      {charts.products.map((group) => <section className="erp-card reports-detail-section" key={`products-${group.moneda}`}>
        <div className="reports-section-heading"><div><span>{group.moneda}</span><h2>Margen bruto por producto</h2><p>Productos de ventas sin proyecto con costo histórico completo.</p></div></div>
        <RankedMarginChart bars={group.barras} currency={group.moneda} label="Margen bruto del producto" />
      </section>)}
    </>}
  </>;
}

export default ReportsGananciasView;
