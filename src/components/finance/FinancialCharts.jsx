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
import { formatMoney } from "../../utils/formatters";
import useBusinessFormat from "../../hooks/useBusinessFormat";
import usePrefersDarkMode from "../../hooks/usePrefersDarkMode";

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

// Colores de datos: par claro/oscuro que refleja a mano los tokens
// --color-brand-600/--color-data-expense/--color-data-pending/
// --color-data-paid de tokens.css (etapa 5, paso 7) — Chart.js pinta con
// strings JS, no puede leer var(). Si se cambia un valor allá, hay que
// cambiarlo también aquí (deuda ya documentada en tokens.css).
const DATA_COLORS = {
  light: {
    teal: "#0f766e", // --color-brand-600 (ingreso, sin token propio)
    tealSoft: "#8bc8c2", // --color-data-paid
    navy: "#1e3a5f", // --color-data-expense (también usado para "neto", fiel al código actual)
    navyFill: "rgba(30, 58, 95, 0.12)",
    amber: "#d97706", // --color-data-pending
  },
  dark: {
    teal: "#0f766e", // --color-brand-600 sin cambio (decisión del paso 2)
    tealSoft: "#8bc8c2", // --color-data-paid sin cambio (ya pasaba 7.64:1)
    navy: "#5b7ba3", // --color-data-expense oscuro (3.30:1 contra panel; el claro medía 1.25:1)
    navyFill: "rgba(91, 123, 163, 0.12)",
    amber: "#d97706", // --color-data-pending sin cambio (ya pasaba 4.52:1)
  },
};

// "Chrome" del chart (ejes, leyenda, grid — no son datos): par
// claro/oscuro, mapeado a --color-text-muted/--color-border-subtle
// (etapa 5, paso 7, decisión de la Parte A). Los hex claros (#475569,
// #64748b, #e2e8f0) no coinciden exacto con esos tokens, así que se
// mantienen tal cual en claro; en oscuro sí se usa el valor real del
// token correspondiente.
const CHROME_COLORS = {
  light: {
    legendText: "#475569",
    tickText: "#64748b",
    grid: "#e2e8f0",
    panelBg: "#ffffff",
  },
  dark: {
    legendText: "#8ba3b0", // --color-text-muted oscuro
    tickText: "#8ba3b0", // --color-text-muted oscuro
    grid: "#1d3a4d", // --color-border-subtle oscuro
    panelBg: "#142c3d", // --color-surface-panel oscuro (separador entre porciones del donut)
  },
};

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

function currencyTooltip(currency, businessLocale) {
  return (context) => `${context.dataset.label || "Valor"}: ${formatMoney(context.parsed?.y ?? context.parsed ?? 0, currency, businessLocale)}`;
}

function baseOptions(currency = "CLP", chrome, businessLocale) {
  return {
    animation: { duration: 300 },
    maintainAspectRatio: false,
    responsive: true,
    plugins: {
      legend: {
        labels: { color: chrome.legendText, boxWidth: 12, boxHeight: 12, usePointStyle: true },
        position: "bottom",
      },
      tooltip: { callbacks: { label: currencyTooltip(currency, businessLocale) } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: chrome.tickText } },
      y: {
        beginAtZero: true,
        grid: { color: chrome.grid },
        ticks: {
          color: chrome.tickText,
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

export function FinancialTimelineChart({ currency = "CLP", data, mode = "cashflow" }) {
  const isDarkMode = usePrefersDarkMode();
  const { locale: businessLocale } = useBusinessFormat();
  const dataColors = isDarkMode ? DATA_COLORS.dark : DATA_COLORS.light;
  const chrome = isDarkMode ? CHROME_COLORS.dark : CHROME_COLORS.light;
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
            borderColor: dataColors.navy,
            backgroundColor: dataColors.navyFill,
            fill: true,
            tension: 0.28,
          },
        ]
      : [
          {
            label: "Ingresos pagados",
            data: data.map((item) => item.income),
            backgroundColor: dataColors.teal,
            borderRadius: 3,
          },
          {
            label: "Egresos pagados",
            data: data.map((item) => item.expense),
            backgroundColor: dataColors.navy,
            borderRadius: 3,
          },
        ];
  const description = data
    .map((item) => `${item.key}: ingresos ${formatMoney(item.income, currency, businessLocale)}, egresos ${formatMoney(item.expense, currency, businessLocale)}, resultado ${formatMoney(item.net, currency, businessLocale)}`)
    .join(". ");

  return (
    <div className="financial-chart" role="img" aria-label={description}>
      {mode === "net" ? (
        <Line data={{ labels, datasets }} options={baseOptions(currency, chrome, businessLocale)} />
      ) : (
        <Bar data={{ labels, datasets }} options={baseOptions(currency, chrome, businessLocale)} />
      )}
    </div>
  );
}

export function FinancialCategoryChart({ currency = "CLP", data, label }) {
  const isDarkMode = usePrefersDarkMode();
  const { locale: businessLocale } = useBusinessFormat();
  const dataColors = isDarkMode ? DATA_COLORS.dark : DATA_COLORS.light;
  const chrome = isDarkMode ? CHROME_COLORS.dark : CHROME_COLORS.light;
  if (!data.length) {
    return <ChartEmptyState>Sin datos por categoría en este periodo.</ChartEmptyState>;
  }
  const visible = data.slice(0, 7);
  const options = baseOptions(currency, chrome, businessLocale);
  options.indexAxis = "y";
  const description = visible
    .map((item) => `${item.label}: ${formatMoney(item.value, currency, businessLocale)}`)
    .join(". ");
  return (
    <div className="financial-chart financial-chart--category" role="img" aria-label={`${label}. ${description}`}>
      <Bar
        data={{
          labels: visible.map((item) => item.label),
          datasets: [{
            label,
            data: visible.map((item) => item.value),
            backgroundColor: label.toLocaleLowerCase("es-CL").includes("ingreso") ? dataColors.teal : dataColors.navy,
            borderRadius: 3,
          }],
        }}
        options={options}
      />
    </div>
  );
}

export function FinancialStatusChart({ currency = "CLP", movements }) {
  const isDarkMode = usePrefersDarkMode();
  const { locale: businessLocale } = useBusinessFormat();
  const dataColors = isDarkMode ? DATA_COLORS.dark : DATA_COLORS.light;
  const chrome = isDarkMode ? CHROME_COLORS.dark : CHROME_COLORS.light;
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
      aria-label={`Movimientos pagados: ${formatMoney(paid, currency, businessLocale)}. Movimientos pendientes: ${formatMoney(pending, currency, businessLocale)}.`}
    >
      <Doughnut
        data={{
          labels: ["Pagados", "Pendientes"],
          datasets: [{
            data: [paid, pending],
            backgroundColor: [dataColors.tealSoft, dataColors.amber],
            borderColor: chrome.panelBg,
            borderWidth: 2,
          }],
        }}
        options={{
          animation: { duration: 300 },
          cutout: "66%",
          maintainAspectRatio: false,
          responsive: true,
          plugins: {
            legend: { position: "bottom", labels: { usePointStyle: true, color: chrome.legendText } },
            tooltip: { callbacks: { label: currencyTooltip(currency, businessLocale) } },
          },
        }}
      />
    </div>
  );
}
