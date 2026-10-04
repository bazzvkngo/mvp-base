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
import usePrefersDarkMode from "../../hooks/usePrefersDarkMode";
import useBusinessFormat from "../../hooks/useBusinessFormat";

ChartJS.register(BarElement, CategoryScale, Legend, LinearScale, Tooltip);

// Refleja a mano --color-brand-600/--color-data-expense (datos) y
// --color-text-muted/--color-border-subtle (chrome) de tokens.css
// (etapa 5, paso 7) — Chart.js no puede leer var().
const DATA_COLORS = {
  light: { sales: "#0f766e", purchases: "#1e3a5f" },
  dark: { sales: "#0f766e", purchases: "#5b7ba3" },
};
const CHROME_COLORS = {
  light: { legendText: "#475569", tickText: "#64748b", grid: "#e2e8f0" },
  dark: { legendText: "#8ba3b0", tickText: "#8ba3b0", grid: "#1d3a4d" },
};

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

export default function OperationalComparisonChart({currency = "CLP", items}) {
  const { locale: businessLocale } = useBusinessFormat();
  const isDarkMode = usePrefersDarkMode();
  const dataColors = isDarkMode ? DATA_COLORS.dark : DATA_COLORS.light;
  const chrome = isDarkMode ? CHROME_COLORS.dark : CHROME_COLORS.light;
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
        `${item.key}: ventas ${formatMoney(item.sales, currency, businessLocale)}, compras ${formatMoney(item.purchases, currency, businessLocale)}`
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
              backgroundColor: dataColors.sales,
              borderRadius: 4,
              maxBarThickness: items.length === 1 ? 36 : 24,
            },
            {
              label: "Compras confirmadas",
              data: items.map((item) => item.purchases),
              backgroundColor: dataColors.purchases,
              borderRadius: 4,
              maxBarThickness: items.length === 1 ? 36 : 24,
            },
          ],
        }}
        options={{
          animation: false,
          layout: {padding: {top: 2}},
          maintainAspectRatio: false,
          responsive: true,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                boxHeight: 8,
                boxWidth: 8,
                color: chrome.legendText,
                font: {size: 11},
                padding: 12,
                usePointStyle: true,
              },
            },
            tooltip: {
              callbacks: {
                label(context) {
                  return `${context.dataset.label}: ${formatMoney(context.parsed.y, currency, businessLocale)}`;
                },
              },
            },
          },
          scales: {
            x: {grid: {display: false}, ticks: {autoSkip: true, color: chrome.tickText, maxRotation: 0}},
            y: {
              beginAtZero: true,
              grid: {color: chrome.grid},
              ticks: {
                color: chrome.tickText,
                maxTicksLimit: 5,
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
