import React from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { formatCLP } from "../../utils/formatters";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
);

const TEAL = "#0f766e";
const TEAL_SOFT = "#8bc8c2";
const NAVY = "#1e3a5f";
const AMBER = "#d97706";
const GRID = "#e2e8f0";

function formatTimelineLabel(key) {
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [year, month] = key.split("-");
    return new Intl.DateTimeFormat("es-CL", { month: "short", year: "2-digit", timeZone: "UTC" })
      .format(new Date(Date.UTC(Number(year), Number(month) - 1, 1)))
      .replace(" de ", " ");
  }
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)))
    .replace(" de ", " ");
}

function currencyTooltip(context) {
  return `${context.dataset.label || "Valor"}: ${formatCLP(context.parsed?.y ?? context.parsed ?? 0)}`;
}

function baseOptions() {
  return {
    animation: { duration: 300 },
    maintainAspectRatio: false,
    responsive: true,
    plugins: {
      legend: {
        labels: { color: "#475569", boxWidth: 12, boxHeight: 12, usePointStyle: true },
        position: "bottom",
      },
      tooltip: { callbacks: { label: currencyTooltip } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#64748b" } },
      y: {
        beginAtZero: true,
        grid: { color: GRID },
        ticks: {
          color: "#64748b",
          callback(value) {
            return new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 }).format(value);
          },
        },
      },
    },
  };
}

function ChartEmptyState({ children }) {
  return <div className="financial-chart-empty">{children}</div>;
}

export function FinancialTimelineChart({ data, mode = "cashflow" }) {
  if (!data.length) {
    return <ChartEmptyState>Aún no hay movimientos para construir esta evolución.</ChartEmptyState>;
  }
  const labels = data.map((item) => formatTimelineLabel(item.key));
  const datasets =
    mode === "net"
      ? [
          {
            label: "Resultado neto",
            data: data.map((item) => item.net),
            borderColor: NAVY,
            backgroundColor: "rgba(30, 58, 95, 0.12)",
            fill: true,
            tension: 0.28,
          },
        ]
      : [
          {
            label: "Ingresos pagados",
            data: data.map((item) => item.income),
            backgroundColor: TEAL,
            borderRadius: 3,
          },
          {
            label: "Egresos pagados",
            data: data.map((item) => item.expense),
            backgroundColor: NAVY,
            borderRadius: 3,
          },
        ];
  const description = data
    .map((item) => `${item.key}: ingresos ${formatCLP(item.income)}, egresos ${formatCLP(item.expense)}, resultado ${formatCLP(item.net)}`)
    .join(". ");

  return (
    <div className="financial-chart" role="img" aria-label={description}>
      {mode === "net" ? (
        <Line data={{ labels, datasets }} options={baseOptions()} />
      ) : (
        <Bar data={{ labels, datasets }} options={baseOptions()} />
      )}
    </div>
  );
}

export function FinancialCategoryChart({ data, label }) {
  if (!data.length) {
    return <ChartEmptyState>Sin datos por categoría en este periodo.</ChartEmptyState>;
  }
  const visible = data.slice(0, 7);
  const options = baseOptions();
  options.indexAxis = "y";
  const description = visible
    .map((item) => `${item.label}: ${formatCLP(item.value)}`)
    .join(". ");
  return (
    <div className="financial-chart financial-chart--category" role="img" aria-label={`${label}. ${description}`}>
      <Bar
        data={{
          labels: visible.map((item) => item.label),
          datasets: [{
            label,
            data: visible.map((item) => item.value),
            backgroundColor: label.toLocaleLowerCase("es-CL").includes("ingreso") ? TEAL : NAVY,
            borderRadius: 3,
          }],
        }}
        options={options}
      />
    </div>
  );
}

export function FinancialStatusChart({ movements }) {
  const paid = movements
    .filter((movement) => movement.status === "paid")
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const pending = movements
    .filter((movement) => movement.status === "pending")
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  if (paid + pending === 0) {
    return <ChartEmptyState>Sin movimientos pagados o pendientes en este periodo.</ChartEmptyState>;
  }
  return (
    <div
      className="financial-chart financial-chart--donut"
      role="img"
      aria-label={`Movimientos pagados: ${formatCLP(paid)}. Movimientos pendientes: ${formatCLP(pending)}.`}
    >
      <Doughnut
        data={{
          labels: ["Pagados", "Pendientes"],
          datasets: [{
            data: [paid, pending],
            backgroundColor: [TEAL_SOFT, AMBER],
            borderColor: "#ffffff",
            borderWidth: 2,
          }],
        }}
        options={{
          animation: { duration: 300 },
          cutout: "66%",
          maintainAspectRatio: false,
          responsive: true,
          plugins: {
            legend: { position: "bottom", labels: { usePointStyle: true, color: "#475569" } },
            tooltip: { callbacks: { label: currencyTooltip } },
          },
        }}
      />
    </div>
  );
}
