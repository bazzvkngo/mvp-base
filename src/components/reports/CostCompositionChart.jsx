import React from "react";
import {
  ArcElement,
  Chart as ChartJS,
  Legend,
  Tooltip,
} from "chart.js";
import {Doughnut} from "react-chartjs-2";
import {formatMoney} from "../../utils/formatters";

ChartJS.register(ArcElement, Legend, Tooltip);

const COLORS = ["#0f766e", "#1e3a5f", "#b7791f", "#64748b"];

export default function CostCompositionChart({currency = "CLP", items, total}) {
  const visibleItems = items.filter((item) => Number(item.value || 0) > 0);
  const description = items
    .map((item) => `${item.label}: ${formatMoney(item.value, currency)}`)
    .join(". ");

  return (
    <div
      className="reports-cost-chart"
      role="img"
      aria-label={`Composici\u00f3n de costos. Costos registrados: ${formatMoney(total, currency)}. ${description}.`}
    >
      <Doughnut
        data={{
          labels: visibleItems.map((item) => item.label),
          datasets: [{
            data: visibleItems.map((item) => item.value),
            backgroundColor: visibleItems.map((item) => COLORS[item.colorIndex]),
            borderColor: "#ffffff",
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
                  return `${context.label}: ${formatMoney(context.parsed, currency)}`;
                },
              },
            },
          },
        }}
      />
      <div className="reports-cost-chart__total" aria-hidden="true">
        <span>Costos</span>
        <strong>{formatMoney(total, currency)}</strong>
      </div>
    </div>
  );
}
