import React from "react";
import {ProjectProfitabilityV4Summary, SalesCommercialMarginV4Card} from "../ReportProfitabilityV4Section";

// Vista analítica de Ganancias. Mantiene, a propósito, dos bloques separados
// que nunca se suman entre sí: GANANCIAS POR VENTAS (margen comercial V4,
// COMMERCIAL_SALES) y GANANCIAS POR PROYECTOS (balance autoritativo V4,
// PROJECT_PROFITABILITY). No existe -ni debe agregarse- un "total de
// ganancias" que combine ambos bloques: pueden representar universos
// distintos o solaparse (una venta con proyecto asociado). "Ganancias" es
// aquí sólo el lenguaje de interfaz; el modelo económico subyacente no
// cambia.
function ReportsGananciasView({profitabilityV4}) {
  if (!profitabilityV4.canView) {
    return <div className="erp-card reports-simple-state">Tu perfil no incluye información de ganancias.</div>;
  }
  return <>
    <section className="reports-ganancias-block">
      <h2 className="reports-detail-subheading">Ganancias por Ventas</h2>
      <SalesCommercialMarginV4Card canView={profitabilityV4.canView} commercial={profitabilityV4.commercial} onRetry={profitabilityV4.reload} />
    </section>

    <section className="reports-ganancias-block">
      <h2 className="reports-detail-subheading">Ganancias por Proyectos</h2>
      <div className="erp-card">
        <ProjectProfitabilityV4Summary canView={profitabilityV4.canView} projects={profitabilityV4.projects} />
      </div>
    </section>

    <p className="reports-simple-project-note">
      Estos dos bloques se calculan y presentan por separado a propósito: no se suman entre sí, porque una misma
      venta puede estar asociada a un proyecto y contarse en ambos análisis con lógicas distintas.
    </p>
  </>;
}

export default ReportsGananciasView;
