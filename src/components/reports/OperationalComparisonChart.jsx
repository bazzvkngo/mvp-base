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

function formatCompactMoney(value, currency) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency,
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(Number(value || 0));
}

function proportionalWidth(value, maximum) {
  const amount = Number(value || 0);
  return amount > 0 ? Math.max(2, (amount / maximum) * 100) : 0;
}

export default function OperationalComparisonChart({currency = "CLP", items}) {
  if (!items.length) {
    return (
      <div className="financial-chart-empty">
        Aún no hay ventas ni compras confirmadas en este período.
      </div>
    );
  }

  const description = items
    .map(
      (item) =>
        `${item.key}: ventas ${formatMoney(item.sales, currency)}, compras ${formatMoney(item.purchases, currency)}`
    )
    .join(". ");

  if (items.length === 1) {
    const item = items[0];
    const maximum = Math.max(Number(item.sales || 0), Number(item.purchases || 0), 1);
    return <div className="operational-comparison-single" role="img" aria-label={`Movimiento comercial del ${formatLabel(item.key)}. ${description}.`}>
      <span className="operational-comparison-single__date">{formatLabel(item.key)}</span>
      <div className="operational-comparison-single__row"><div><span>Ventas confirmadas</span><strong>{formatMoney(item.sales, currency)}</strong></div><div className="operational-comparison-single__track"><span className="operational-comparison-single__bar operational-comparison-single__bar--sales" style={{width: `${proportionalWidth(item.sales, maximum)}%`}} /></div></div>
      <div className="operational-comparison-single__row"><div><span>Compras confirmadas</span><strong>{formatMoney(item.purchases, currency)}</strong></div><div className="operational-comparison-single__track"><span className="operational-comparison-single__bar operational-comparison-single__bar--purchases" style={{width: `${proportionalWidth(item.purchases, maximum)}%`}} /></div></div>
    </div>;
  }

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
              maxBarThickness: 24,
            },
            {
              label: "Compras confirmadas",
              data: items.map((item) => item.purchases),
              backgroundColor: "#1e3a5f",
              borderRadius: 4,
              maxBarThickness: 24,
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
            x: {grid: {display: false}, ticks: {autoSkip: true, color: "#64748b", maxRotation: 0}},
            y: {
              beginAtZero: true,
              grid: {color: "#e2e8f0"},
              ticks: {
                color: "#64748b",
                callback(value) {
                  return formatCompactMoney(value, currency);
                },
              },
            },
          },
        }}
      />
    </div>
  );
}
