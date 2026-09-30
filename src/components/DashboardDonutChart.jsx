import React, { useMemo } from "react";
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import useMediaQueryPreference from "../hooks/useMediaQueryPreference";
import usePrefersDarkMode from "../hooks/usePrefersDarkMode";

ChartJS.register(ArcElement, Tooltip, Legend);

function formatPercent(value) {
  return value.toLocaleString("es-CL", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

// Colores de "chrome" (texto dibujado directo en el canvas, no datos):
// par claro/oscuro, elegido en el componente vía usePrefersDarkMode y
// pasado aquí porque este plugin de Chart.js no es un componente de
// React y no puede usar hooks. Mismos tonos que --color-text-strong/
// --color-text-muted en tokens.css (oscuro), sin poder leer la variable
// CSS directamente (Chart.js pinta con strings JS, no CSS).
function createCenterTextPlugin(total, colors) {
  return {
    id: `dashboardDonutCenterText-${total}`,
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;

      const centerX = (chartArea.left + chartArea.right) / 2;
      const centerY = (chartArea.top + chartArea.bottom) / 2;

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = colors.strong;
      ctx.font = '700 24px Inter, "Segoe UI", sans-serif';
      ctx.fillText(String(total), centerX, centerY - 5);
      ctx.fillStyle = colors.muted;
      ctx.font = '650 13px Inter, "Segoe UI", sans-serif';
      ctx.fillText("Total", centerX, centerY + 17);
      ctx.restore();
    },
  };
}

// "Chrome" del chart (texto/fondos alrededor de los datos, no los datos
// en sí): pares claro/oscuro. Mismos valores que sus tokens equivalentes
// en tokens.css (oscuro) — duplicados aquí porque Chart.js/Canvas no
// puede leer var() directamente, mismo criterio ya documentado para
// --color-data-* en tokens.css.
const CHROME_COLORS = {
  light: {
    strong: "#111827",
    muted: "#64748b",
    legendLabel: "#334155",
    panelBg: "#ffffff",
    emptyDonutRing: "#e5e7eb",
  },
  dark: {
    strong: "#e4edf1",
    muted: "#8ba3b0",
    legendLabel: "#8ba3b0",
    panelBg: "#142c3d",
    emptyDonutRing: "#2a4e63",
  },
};

function DashboardDonutChart({ items, emptyMessage, ariaLabel }) {
  const prefersReducedMotion = useMediaQueryPreference(
    "(prefers-reduced-motion: reduce)"
  );
  const isDarkMode = usePrefersDarkMode();
  const chrome = isDarkMode ? CHROME_COLORS.dark : CHROME_COLORS.light;
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const activeItems = items.filter((item) => Number(item.value || 0) > 0);
  const visibleLegendItems = total > 0 ? activeItems : items;

  const chartData = useMemo(
    () => ({
      labels: activeItems.map((item) => item.label),
      datasets: [
        {
          data: activeItems.map((item) => item.value),
          backgroundColor: activeItems.map((item) => item.color),
          borderColor: chrome.panelBg,
          borderWidth: 2,
          hoverOffset: 3,
        },
      ],
    }),
    [activeItems, chrome.panelBg]
  );

  const chartOptions = useMemo(
    () => ({
      animation: prefersReducedMotion ? false : { duration: 450 },
      cutout: "68%",
      maintainAspectRatio: false,
      responsive: true,
      resizeDelay: 80,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              const label = context.label || "";
              const value = Number(context.parsed || 0);
              if (total <= 0) return `${label}: ${value}`;
              const percent = (value / total) * 100;
              return `${label}: ${value} (${formatPercent(percent)} %)`;
            },
          },
        },
      },
    }),
    [prefersReducedMotion, total]
  );

  const centerTextPlugin = useMemo(
    () => createCenterTextPlugin(total, chrome),
    [total, chrome]
  );
  const description = `${ariaLabel}. ${items
    .map((item) => `${item.label}: ${item.value}`)
    .join(". ")}.`;

  return (
    <div
      className="dashboard-donut"
      style={styles.wrapper}
      aria-label={description}
      role="img"
    >
      <div className="dashboard-donut-layout" style={styles.layout}>
        <div className="dashboard-donut-chart" style={styles.chartBox}>
          {total > 0 ? (
            <Doughnut
              data={chartData}
              options={chartOptions}
              plugins={[centerTextPlugin]}
            />
          ) : (
            <div
              style={{
                ...styles.emptyDonut,
                background: `radial-gradient(circle at center, ${chrome.panelBg} 0 48%, transparent 49%), conic-gradient(${chrome.emptyDonutRing} 0 100%)`,
              }}
            >
              <strong style={{ ...styles.emptyTotal, color: chrome.strong }}>
                0
              </strong>
              <span style={{ ...styles.emptyTotalLabel, color: chrome.muted }}>
                Total
              </span>
            </div>
          )}
        </div>

        <div className="dashboard-donut-legend" style={styles.legend}>
          {visibleLegendItems.map((item) => (
            <div key={item.label} style={styles.legendRow}>
              <span
                aria-hidden="true"
                style={{ ...styles.legendDot, background: item.color }}
              />
              <span style={{ ...styles.legendLabel, color: chrome.legendLabel }}>
                {item.label}
              </span>
              <strong style={{ ...styles.legendValue, color: chrome.strong }}>
                {item.value}
              </strong>
            </div>
          ))}
          {total === 0 && (
            <p style={{ ...styles.emptyMessage, color: chrome.muted }}>
              {emptyMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    containerType: "inline-size",
    minWidth: 0,
  },
  layout: {
    alignItems: "center",
    display: "grid",
    gap: "18px",
    gridTemplateColumns: "minmax(150px, 176px) minmax(0, 1fr)",
    marginTop: "14px",
    minWidth: 0,
  },
  chartBox: {
    height: "clamp(150px, 42cqi, 176px)",
    maxWidth: "176px",
    position: "relative",
    width: "100%",
  },
  emptyDonut: {
    alignItems: "center",
    borderRadius: "50%",
    display: "flex",
    flexDirection: "column",
    height: "150px",
    justifyContent: "center",
    width: "150px",
  },
  emptyTotal: {
    fontSize: "24px",
    lineHeight: 1,
  },
  emptyTotalLabel: {
    fontSize: "13px",
    fontWeight: 700,
    marginTop: "5px",
  },
  legend: {
    display: "grid",
    gap: 0,
    minWidth: 0,
    width: "100%",
  },
  legendRow: {
    alignItems: "center",
    display: "grid",
    gap: "8px",
    gridTemplateColumns: "10px minmax(0, 1fr) max-content",
    minWidth: 0,
    padding: "7px 0",
    width: "100%",
  },
  legendDot: {
    borderRadius: "999px",
    height: "9px",
    width: "9px",
  },
  legendLabel: {
    fontSize: "13px",
    lineHeight: 1.25,
    minWidth: 0,
  },
  legendValue: {
    fontSize: "13px",
  },
  emptyMessage: {
    fontSize: "13px",
    margin: "3px 0 0",
  },
};

export default DashboardDonutChart;
