import React from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import {Bar} from "react-chartjs-2";
import useCssTokenColors from "../../hooks/useCssTokenColors";
import {formatCompactMoney, formatMoney} from "../../utils/formatters";
import useBusinessFormat from "../../hooks/useBusinessFormat";

ChartJS.register(BarElement, CategoryScale, Legend, LinearScale, Tooltip);

// Gráficos de Ganancias (SPEC 022 §6.5). Colores desde tokens.css vía
// useCssTokenColors; sin literales de color.
const CHART_TOKENS = [
  "--color-data-cost-materials",
  "--color-data-cost-direct",
  "--color-data-net",
  "--color-text-muted",
  "--color-border-subtle",
];

function formatMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", {month: "short", year: "2-digit", timeZone: "UTC"})
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)))
    .replace(" de ", " ");
}

function formatMonthName(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", {month: "long", year: "numeric", timeZone: "UTC"})
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

// Series del gráfico mensual. Solo se dibujan (y entran en la leyenda) las que
// tienen algún valor distinto de cero en el período; el apilado no cambia.
const PROFIT_SERIES = Object.freeze([
  {key: "margenVentas", label: "Ganancia por productos", token: "--color-data-cost-materials"},
  {key: "resultadoProyectos", label: "Resultado de proyectos", token: "--color-data-cost-direct"},
]);

function hasValue(value) {
  return Number.isFinite(Number(value)) && Number(value) !== 0;
}

export function profitSeriesWithData(months) {
  return PROFIT_SERIES.filter((series) => months.some((month) => hasValue(month[series.key])));
}

function useChartChrome() {
  const tokens = useCssTokenColors(CHART_TOKENS);
  return {
    tokens,
    axis: {
      grid: {color: tokens["--color-border-subtle"]},
      ticks: {color: tokens["--color-text-muted"], maxTicksLimit: 5},
    },
  };
}

// §6.5.1: ganancia neta operacional por mes, apilada en sus dos componentes.
// Con un solo mes una barra no muestra evolución: se dice el valor en texto, con
// las cifras que ya trae buildMonthlyOperationalProfit (la vista no suma nada).
export function MonthlyOperationalProfitChart({currency, months}) {
  const { locale: businessLocale } = useBusinessFormat();
  const {tokens, axis} = useChartChrome();
  if (!months.length) return <div className="financial-chart-empty">Sin meses con datos en el período.</div>;
  if (months.length === 1) {
    const [month] = months;
    const money = (value) => formatMoney(value, currency, businessLocale);
    return <p className="reports-monthly-single">
      {`Ganancia de ${formatMonthName(month.mes)}${month.parcial ? " *" : ""}: `}<strong>{money(month.ganancia)}</strong>{` (productos ${money(month.margenVentas)}, proyectos ${money(month.resultadoProyectos)})`}
    </p>;
  }
  const series = profitSeriesWithData(months);
  if (!series.length) return <div className="financial-chart-empty">Sin ganancia registrada en los meses del período.</div>;
  const labels = months.map((month) => `${formatMonth(month.mes)}${month.parcial ? " *" : ""}`);
  const description = months.map((month) => `${month.mes}${month.parcial ? " (parcial)" : ""}: ${formatMoney(month.ganancia, currency, businessLocale)}`).join(". ");
  return <div className="financial-chart" role="img" aria-label={`Ganancia por mes. ${description}.`}>
    <Bar
      data={{
        labels,
        datasets: series.map((entry) => ({label: entry.label, data: months.map((month) => month[entry.key]), backgroundColor: tokens[entry.token], borderRadius: 4, maxBarThickness: 28, stack: "ganancia"})),
      }}
      options={{
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        plugins: {
          legend: {position: "bottom", labels: {boxHeight: 8, boxWidth: 8, color: tokens["--color-text-muted"], font: {size: 11}, padding: 12, usePointStyle: true}},
          tooltip: {
            callbacks: {
              label(context) { return `${context.dataset.label}: ${formatMoney(context.parsed.y, currency, businessLocale)}`; },
              footer(items) { return `Ganancia: ${formatMoney(months[items[0].dataIndex].ganancia, currency, businessLocale)}`; },
            },
          },
        },
        scales: {
          x: {stacked: true, grid: {display: false}, ticks: {color: tokens["--color-text-muted"], maxRotation: 0}},
          y: {...axis, stacked: true, ticks: {...axis.ticks, callback(value) { return formatCompactMoney(value, currency, businessLocale); }}},
        },
      }}
    />
  </div>;
}

// §6.5.2 y §6.5.3: una serie, barras horizontales ordenadas por magnitud.
export function RankedMarginChart({bars, currency, label}) {
  const { locale: businessLocale } = useBusinessFormat();
  const {tokens, axis} = useChartChrome();
  if (!bars.length) return <div className="financial-chart-empty">Sin datos en el período.</div>;
  const description = bars.map((bar) => `${bar.nombre}: ${formatMoney(bar.valor, currency, businessLocale)}`).join(". ");
  return <div className="financial-chart" role="img" aria-label={`${label}. ${description}.`}>
    <Bar
      data={{
        labels: bars.map((bar) => bar.nombre),
        datasets: [{label, data: bars.map((bar) => bar.valor), backgroundColor: tokens["--color-data-net"], borderRadius: 4, maxBarThickness: 22}],
      }}
      options={{
        animation: false,
        indexAxis: "y",
        maintainAspectRatio: false,
        responsive: true,
        plugins: {
          legend: {display: false},
          tooltip: {callbacks: {label(context) { return `${label}: ${formatMoney(context.parsed.x, currency, businessLocale)}`; }}},
        },
        scales: {
          x: {...axis, ticks: {...axis.ticks, callback(value) { return formatCompactMoney(value, currency, businessLocale); }}},
          y: {grid: {display: false}, ticks: {color: tokens["--color-text-muted"]}},
        },
      }}
    />
  </div>;
}
