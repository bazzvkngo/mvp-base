import React from "react";
import {OperationalNetProfitBreakdown, OperationalSystemStatus} from "../OperationalNetProfitBreakdown";

// Vista inicial de /reportes (SPEC 022 §6.2): ganancia neta operacional con su
// desglose y ventas sin costo registrado, más el estado del sistema (alertas).
function ReportsRentabilidadView({canViewProfitability, currency, links, navigate, onRetry, operationalProfit}) {
  if (!canViewProfitability) {
    return <div className="erp-card reports-simple-state">Tu perfil no incluye información de rentabilidad.</div>;
  }
  return <>
    <section className="erp-card reports-detail-section">
      <div className="reports-section-heading"><div><span>Rentabilidad</span><h2>Ganancia neta operacional</h2><p>Ventas y proyectos del período seleccionado, cada venta contada una sola vez.</p></div></div>
      <OperationalNetProfitBreakdown canView={canViewProfitability} currency={currency} onRetry={onRetry} state={operationalProfit} />
    </section>

    <section className="erp-card reports-detail-section">
      <div className="reports-section-heading"><div><span>Estado</span><h2>Estado del sistema</h2><p>Registros que se excluyen de la ganancia o que la dejan parcial.</p></div></div>
      {operationalProfit.status === "ready"
        ? <OperationalSystemStatus canView={canViewProfitability} currency={currency} links={links} onNavigate={navigate} state={operationalProfit} />
        : <p className="reports-empty-note">Las alertas aparecen cuando termina el cálculo de la ganancia.</p>}
    </section>
  </>;
}

export default ReportsRentabilidadView;
