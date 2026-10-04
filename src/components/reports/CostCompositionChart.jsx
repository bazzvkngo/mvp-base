import React from "react";
import {
  ArcElement,
  Chart as ChartJS,
  Legend,
  Tooltip,
} from "chart.js";
import {Doughnut} from "react-chartjs-2";
import {formatMoney} from "../../utils/formatters";
import usePrefersDarkMode from "../../hooks/usePrefersDarkMode";
import useBusinessFormat from "../../hooks/useBusinessFormat";

ChartJS.register(ArcElement, Legend, Tooltip);

// Refleja a mano --color-data-cost-materials/-labor/-direct/-indirect de
// tokens.css (etapa 5, paso 7) \u2014 Chart.js no puede leer var(). El par
// oscuro se subi\u00f3 para dar contraste consistente entre las 4 categor\u00edas
// (materials/labor fallaban 3:1 contra el panel oscuro; direct/indirect
// pasaban con margen muy fino).
const COLORS = {
  light: ["#0f766e", "#1e3a5f", "#b7791f", "#64748b"],
  dark: ["#45b8a8", "#5b7ba3", "#d1943f", "#93a3ac"],
};
const PANEL_BG = { light: "#ffffff", dark: "#142c3d" };

export default function CostCompositionChart({currency = "CLP", items, total}) {
  const { locale: businessLocale } = useBusinessFormat();
  const isDarkMode = usePrefersDarkMode();
  const colors = isDarkMode ? COLORS.dark : COLORS.light;
  const panelBg = isDarkMode ? PANEL_BG.dark : PANEL_BG.light;
  const visibleItems = items.filter((item) => Number(item.value || 0) > 0);
  const description = items
    .map((item) => `${item.label}: ${formatMoney(item.value, currency, businessLocale)}`)
    .join(". ");

  return (
    <div
      className="reports-cost-chart"
      role="img"
      aria-label={`Composici\u00f3n de costos. Costos registrados: ${formatMoney(total, currency, businessLocale)}. ${description}.`}
    >
      <Doughnut
        data={{
          labels: visibleItems.map((item) => item.label),
          datasets: [{
            data: visibleItems.map((item) => item.value),
            backgroundColor: visibleItems.map((item) => colors[item.colorIndex]),
            borderColor: panelBg,
            borderWidth: 2,
            hoverOffset: 3,
          }],
        }}
        options={{
          animation: false,
          cutout: "68%",
          maintainAspectRatio: false,
          responsive: true,
          plugins: {
            legend: {display: false},
            tooltip: {
              callbacks: {
                label(context) {
                  return `${context.label}: ${formatMoney(context.parsed, currency, businessLocale)}`;
                },
              },
            },
          },
        }}
      />
      <div className="reports-cost-chart__total" aria-hidden="true">
        <span>Costos</span>
        <strong>{formatMoney(total, currency, businessLocale)}</strong>
      </div>
    </div>
  );
}
