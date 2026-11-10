import React from "react";
import {buildSparkline} from "../../../domain/reportTrend.mjs";

// Mini-línea de tendencia de una tarjeta del Resumen (R5): sin ejes ni leyenda. Solo se
// dibuja con 3 o más puntos (buildSparkline lo decide); si no, nada. `points` son las
// filas que ya arma aggregateOperationalTimeline ({key, value}); `label` es el resumen
// en texto para lectores de pantalla. El color sale de interior.css con tokens.
function ReportsSparkline({kind = "sales", label, points}) {
  const line = buildSparkline((Array.isArray(points) ? points : []).map((point) => point?.value));
  if (!line.show) return null;
  return <svg className={`reports-sparkline reports-sparkline--${kind}`} viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label} focusable="false">
    <polyline className="reports-sparkline__line" points={line.points} />
  </svg>;
}

export default ReportsSparkline;
