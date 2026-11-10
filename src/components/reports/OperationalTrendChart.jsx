import React from "react";
import {
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import {Line} from "react-chartjs-2";
import {formatMonthLabel} from "../../domain/reportMonthlySummary.mjs";
import useBusinessFormat from "../../hooks/useBusinessFormat";
import useCssTokenColors from "../../hooks/useCssTokenColors";
import {formatCompactMoney, formatDate, formatMoney} from "../../utils/formatters";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip);

// Series que sabe dibujar el gráfico de línea de Reportes. Los colores salen de
// tokens.css vía useCssTokenColors (sin literales): ventas con el verde de marca y
// compras con el azul de gasto, los mismos de las tarjetas y del gráfico de barras.
// Compras va además con línea discontinua y otro marcador, para no depender del color.
export const TREND_SERIES = Object.freeze({
  sales: Object.freeze({field: "sales", label: "Ventas confirmadas", word: "ventas", token: "--color-text-brand-accent", dash: [], pointStyle: "circle"}),
  purchases: Object.freeze({field: "purchases", label: "Compras confirmadas", word: "compras", token: "--color-data-expense", dash: [6, 4], pointStyle: "rectRot"}),
});

const CHROME_TOKENS = ["--color-text-muted", "--color-border-subtle"];
const SERIES_TOKENS = Object.values(TREND_SERIES).map((series) => series.token);

// Día: dd-mm-aaaa con formatDate, igual que las tablas. Mes (períodos largos): su nombre.
export function trendLabel(key, locale) {
  return /^\d{4}-\d{2}$/.test(String(key)) ? formatMonthLabel(key, locale) : formatDate(key, locale);
}

// Gráfico de línea de la evolución de Reportes (R5). `items` es la lista que ya arma
// combineOperationalTimelines ({key, sales, purchases}) para una moneda; `series` dice
// cuáles dibujar ("sales", "purchases") según lo que el perfil puede ver. No calcula
// nada: solo dibuja. Quien lo llama decide si hay puntos suficientes; sin puntos no
// dibuja nada. La leyenda la pone quien lo llama (texto real, fuera del lienzo).
export default function OperationalTrendChart({currency = "CLP", items, series = ["sales", "purchases"]}) {
  const {locale} = useBusinessFormat();
  const tokens = useCssTokenColors([...SERIES_TOKENS, ...CHROME_TOKENS]);
  const drawn = series.map((id) => TREND_SERIES[id]).filter(Boolean);
  if (!Array.isArray(items) || !items.length || !drawn.length) return null;

  const labels = items.map((item) => trendLabel(item.key, locale));
  const description = items
    .map((item, index) => `${labels[index]}: ${drawn.map((entry) => `${entry.word} ${formatMoney(item[entry.field], currency, locale)}`).join(", ")}`)
    .join(". ");

  return <div className="reports-trend-chart" role="img" aria-label={`Evolución de ${drawn.map((entry) => entry.word).join(" y ")}. ${description}.`}>
    <Line
      data={{
        labels,
        datasets: drawn.map((entry) => ({
          label: entry.label,
          data: items.map((item) => item[entry.field]),
          borderColor: tokens[entry.token],
          backgroundColor: tokens[entry.token],
          borderDash: entry.dash,
          borderWidth: 2,
          pointHoverRadius: 6,
          pointRadius: 4,
          pointStyle: entry.pointStyle,
          tension: 0.25,
        })),
      }}
      options={{
        animation: false,
        interaction: {intersect: false, mode: "index"},
        maintainAspectRatio: false,
        responsive: true,
        plugins: {
          legend: {display: false},
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${formatMoney(context.parsed.y, currency, locale)}`;
              },
            },
          },
        },
        scales: {
          x: {grid: {display: false}, ticks: {autoSkip: true, color: tokens["--color-text-muted"], maxRotation: 0}},
          y: {
            beginAtZero: true,
            grid: {color: tokens["--color-border-subtle"]},
            ticks: {
              color: tokens["--color-text-muted"],
              maxTicksLimit: 5,
              callback(value) {
                return formatCompactMoney(value, currency, locale);
              },
            },
          },
        },
      }}
    />
  </div>;
}
