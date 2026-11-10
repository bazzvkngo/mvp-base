import React from "react";
import OperationalTrendChart, {TREND_SERIES} from "../../../components/reports/OperationalTrendChart";
import {NOT_ENOUGH_TREND_TEXT, hasEnoughTrendPoints, trendItemsFor} from "../../../domain/reportTrend.mjs";
import ReportsInfoTip from "../ReportsInfoTip";

// Evolución del mes en el Resumen (R5): ventas y compras confirmadas por día, sin IVA,
// en una línea a todo el ancho. Usa la misma serie del gráfico de barras de Compras
// (combineOperationalTimelines), ya filtrada al mes elegido: aquí no se calcula nada.
// La ganancia no se dibuja porque no existe por día (solo por mes, en la pestaña Ganancia).
// Con 0 o 1 punto no hay línea: se dice en una frase. La leyenda es texto real.
function ReportsMonthlyTrend({canViewPurchases, canViewSales, currency, items, showCurrency = false}) {
  const series = [canViewSales && "sales", canViewPurchases && "purchases"].filter(Boolean);
  if (!series.length) return null;
  const rows = trendItemsFor(items, currency);
  const title = `Evolución del mes${showCurrency ? ` en ${currency}` : ""}`;

  if (!hasEnoughTrendPoints(rows)) {
    return <section className="erp-card reports-trend reports-trend--empty">
      <h2 className="reports-trend__title">{title}</h2>
      <p className="reports-trend__empty">{NOT_ENOUGH_TREND_TEXT}</p>
    </section>;
  }

  return <section className="erp-card reports-trend">
    <div className="reports-trend__heading">
      <div>
        <h2 className="reports-trend__title">{title}</h2>
        <p className="reports-trend__caption">Confirmadas por día, sin IVA.
          <ReportsInfoTip label="Cómo leer la evolución del mes">Solo aparecen los días con movimiento. La ganancia se ve por mes en la pestaña Ganancia.</ReportsInfoTip>
        </p>
      </div>
      <ul className="reports-trend__legend">
        {series.map((id) => <li key={id}>
          <i className={`reports-trend__mark reports-trend__mark--${id}`} aria-hidden="true" />
          {TREND_SERIES[id].label}
        </li>)}
      </ul>
    </div>
    <OperationalTrendChart currency={currency} items={rows} series={series} />
  </section>;
}

export default ReportsMonthlyTrend;
