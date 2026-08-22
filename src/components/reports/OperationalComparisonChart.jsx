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
import {formatMoney} from "../../utils/formatters";

ChartJS.register(BarElement, CategoryScale, Legend, LinearScale, Tooltip);

function formatLabel(key) {
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [year, month] = key.split("-").map(Number);
    return new Intl.DateTimeFormat("es-CL", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    })
      .format(new Date(Date.UTC(year, month - 1, 1)))
      .replace(" de ", " ");
  }
  const [year, month, day] = String(key).split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(year, month - 1, day)))
    .replace(" de ", " ");
}

export default function OperationalComparisonChart({currency = "CLP", items}) {
  if (!items.length) {
    return (
      <div className="financial-chart-empty">
        No hay ventas ni compras confirmadas en este periodo.
      </div>
    );
  }

  const description = items
    .map(
      (item) =>
        `${item.key}: ventas ${formatMoney(item.sales, currency)}, compras ${formatMoney(item.purchases, currency)}`
    )
    .join(". ");

  return (
    <div
      className="operational-comparison-chart"
      role="img"
      aria-label={`Evolución operacional. ${description}.`}
    >
      <Bar
        data={{
          labels: items.map((item) => formatLabel(item.key)),
          datasets: [
            {
              label: "Ventas confirmadas",
              data: items.map((item) => item.sales),
              backgroundColor: "#0f766e",
              borderRadius: 4,
            },
            {
              label: "Compras confirmadas",
              data: items.map((item) => item.purchases),
              backgroundColor: "#1e3a5f",
              borderRadius: 4,
            },
          ],
        }}
        options={{
          animation: {duration: 300},
          maintainAspectRatio: false,
          responsive: true,
          plugins: {
            legend: {
              position: "bottom",
              labels: {boxHeight: 10, boxWidth: 10, color: "#475569", usePointStyle: true},
            },
            tooltip: {
              callbacks: {
                label(context) {
                  return `${context.dataset.label}: ${formatMoney(context.parsed.y, currency)}`;
                },
              },
            },
          },
          scales: {
            x: {grid: {display: false}, ticks: {color: "#64748b"}},
            y: {
              beginAtZero: true,
              grid: {color: "#e2e8f0"},
              ticks: {
                color: "#64748b",
                callback(value) {
                  return new Intl.NumberFormat("es-CL", {
                    maximumFractionDigits: 1,
                    notation: "compact",
                  }).format(value);
                },
              },
            },
          },
        }}
      />
    </div>
  );
}
