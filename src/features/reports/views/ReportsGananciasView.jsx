import React, {useMemo} from "react";
import {ChevronDown} from "lucide-react";
import {MonthlyOperationalProfitChart} from "../../../components/reports/OperationalProfitCharts";
import {OPERATIONAL_NET_PROFIT_COVERAGE as COVERAGE} from "../../../domain/operationalNetProfit.mjs";
import {OperationalNetProfitBreakdown, OperationalSystemStatus, visibleOperationalGroups} from "../OperationalNetProfitBreakdown";
import {buildMonthlyOperationalProfit} from "../operationalNetProfitCharts.mjs";
import ProfitSummaryCards from "../ProfitSummaryCards";

// Vista de Ganancia (SPEC 022 §6.5, simplificada y rediseñada en SPEC 025): arriba
// "Me quedó" con su barra de productos, luego la evolución mensual y, al final, el
// cálculo completo (desglose y estado del sistema, este solo si hay alertas)
// plegado en "Ver el cálculo paso a paso". La única suma es la que entrega el
// helper de dominio; esta vista no combina bloques por su cuenta.
// `currentMonthKey` ("AAAA-MM") lo pasa la página: los helpers no leen el reloj.
function ReportsGananciasView({currency, currentMonthKey = null, links, navigate, operationalProfit, profitabilityV4, range}) {
  const {commercial, projects} = profitabilityV4;
  const monthly = useMemo(() => {
    if (operationalProfit.status !== "ready") return null;
    return buildMonthlyOperationalProfit({
      sales: commercial.meta?.items || [],
      projectBalances: projects.meta?.proyectos || [],
      range,
      currency,
      salesTruncated: Boolean(commercial.meta?.lecturaTruncada),
      projectsError: projects.status === "error",
    });
  }, [commercial, currency, operationalProfit.status, projects, range]);

  if (!profitabilityV4.canView) {
    return <div className="erp-card reports-simple-state">Tu perfil no incluye información de ganancias.</div>;
  }

  const result = operationalProfit.status === "ready" ? operationalProfit.result : null;
  const hasAlerts = Boolean(result) && (
    visibleOperationalGroups(result, currency).some((group) => group.alertas.length) ||
    result.alertasGenerales.length > 0
  );
  // Con "Me quedó" a la vista, el cálculo va plegado. Mientras carga, si falla o si no
  // hay nada que resumir, el desglose se queda a la vista: ahí viven el indicador de
  // carga, el error con "Reintentar" y el mensaje de vacío.
  const foldCalculation = Boolean(result) && visibleOperationalGroups(result, currency).some((group) => group.cobertura !== COVERAGE.EMPTY);

  const calculation = <>
    <section className="erp-card reports-detail-section reports-plain-headings">
      <div className="reports-section-heading"><div><span>Ganancia</span><h2>Ganancia del período</h2><p>Ventas sin proyecto y proyectos del período, cada venta contada una sola vez.</p></div></div>
      <OperationalNetProfitBreakdown canView={profitabilityV4.canView} currency={currency} onRetry={profitabilityV4.reload} state={operationalProfit} />
    </section>

    {hasAlerts && <section className="erp-card reports-detail-section reports-plain-headings">
      <div className="reports-section-heading"><div><span>Estado</span><h2>Estado del sistema</h2><p>Registros que se excluyen de la ganancia o que la dejan parcial.</p></div></div>
      <OperationalSystemStatus canView={profitabilityV4.canView} currency={currency} links={links} onNavigate={navigate} state={operationalProfit} />
    </section>}
  </>;

  return <>
    <ProfitSummaryCards currency={currency} currentMonthKey={currentMonthKey} range={range} state={operationalProfit} />

    {monthly && monthly.map((group) => <section className="erp-card reports-detail-section reports-plain-headings" key={`monthly-${group.moneda}`}>
      <div className="reports-section-heading"><div><span>{group.moneda}</span><h2>Evolución mensual</h2><p>Ganancia por mes, en sus dos componentes.</p></div></div>
      <MonthlyOperationalProfitChart currency={group.moneda} months={group.meses} />
      {group.meses.some((month) => month.parcial) && <p className="reports-v4-note">* Mes con cobertura parcial: abre «Ver el cálculo paso a paso», más abajo, para ver el estado del sistema.</p>}
    </section>)}

    {foldCalculation ? <details className="reports-calc-details">
      <summary className="reports-calc-details__summary">
        <span>Ver el cálculo paso a paso</span>
        <ChevronDown className="reports-calc-details__chevron" size={16} aria-hidden="true" />
      </summary>
      <div className="reports-calc-details__body">{calculation}</div>
    </details> : calculation}
  </>;
}

export default ReportsGananciasView;
