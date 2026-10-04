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
import {formatMoney} from "../../utils/formatters";

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

function formatCompactMoney(value, currency) {
  return new Intl.NumberFormat("es-CL", {style: "currency", currency, maximumFractionDigits: 1, notation: "compact"}).format(Number(value || 0));
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
export function MonthlyOperationalProfitChart({currency, months}) {
  const {tokens, axis} = useChartChrome();
  if (!months.length) return <div className="financial-chart-empty">Sin meses con datos en el período.</div>;
  const labels = months.map((month) => `${formatMonth(month.mes)}${month.parcial ? " *" : ""}`);
  const description = months.map((month) => `${month.mes}${month.parcial ? " (parcial)" : ""}: ${formatMoney(month.ganancia, currency)}`).join(". ");
  return <div className="financial-chart" role="img" aria-label={`Ganancia neta operacional por mes. ${description}.`}>
    <Bar
      data={{
        labels,
        datasets: [
          {label: "Margen de ventas sin proyecto", data: months.map((month) => month.margenVentas), backgroundColor: tokens["--color-data-cost-materials"], borderRadius: 4, maxBarThickness: 28, stack: "ganancia"},
          {label: "Resultado de proyectos", data: months.map((month) => month.resultadoProyectos), backgroundColor: tokens["--color-data-cost-direct"], borderRadius: 4, maxBarThickness: 28, stack: "ganancia"},
        ],
      }}
      options={{
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        plugins: {
          legend: {position: "bottom", labels: {boxHeight: 8, boxWidth: 8, color: tokens["--color-text-muted"], font: {size: 11}, padding: 12, usePointStyle: true}},
          tooltip: {
            callbacks: {
              label(context) { return `${context.dataset.label}: ${formatMoney(context.parsed.y, currency)}`; },
              footer(items) { return `Ganancia neta operacional: ${formatMoney(months[items[0].dataIndex].ganancia, currency)}`; },
            },
          },
        },
        scales: {
          x: {stacked: true, grid: {display: false}, ticks: {color: tokens["--color-text-muted"], maxRotation: 0}},
          y: {...axis, stacked: true, ticks: {...axis.ticks, callback(value) { return formatCompactMoney(value, currency); }}},
        },
      }}
    />
  </div>;
}

// §6.5.2 y §6.5.3: una serie, barras horizontales ordenadas por magnitud.
export function RankedMarginChart({bars, currency, label}) {
  const {tokens, axis} = useChartChrome();
  if (!bars.length) return <div className="financial-chart-empty">Sin datos en el período.</div>;
  const description = bars.map((bar) => `${bar.nombre}: ${formatMoney(bar.valor, currency)}`).join(". ");
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
          tooltip: {callbacks: {label(context) { return `${label}: ${formatMoney(context.parsed.x, currency)}`; }}},
        },
        scales: {
          x: {...axis, ticks: {...axis.ticks, callback(value) { return formatCompactMoney(value, currency); }}},
          y: {grid: {display: false}, ticks: {color: tokens["--color-text-muted"]}},
        },
      }}
    />
  </div>;
}
