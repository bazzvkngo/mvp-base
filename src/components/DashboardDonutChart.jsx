import React, { useEffect, useMemo, useState } from "react";
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

function formatPercent(value) {
  return value.toLocaleString("es-CL", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (event) => setPrefersReducedMotion(event.matches);
    mediaQuery.addEventListener?.("change", handleChange);
    return () => mediaQuery.removeEventListener?.("change", handleChange);
  }, []);

  return prefersReducedMotion;
}

function createCenterTextPlugin(total) {
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
      ctx.fillStyle = "#111827";
      ctx.font = "700 24px Arial, sans-serif";
      ctx.fillText(String(total), centerX, centerY - 5);
      ctx.fillStyle = "#64748b";
      ctx.font = "700 11px Arial, sans-serif";
      ctx.fillText("Total", centerX, centerY + 17);
      ctx.restore();
    },
  };
}

function DashboardDonutChart({ items, emptyMessage, ariaLabel }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const activeItems = items.filter((item) => Number(item.value || 0) > 0);

  const chartData = useMemo(
    () => ({
      labels: activeItems.map((item) => item.label),
      datasets: [
        {
          data: activeItems.map((item) => item.value),
          backgroundColor: activeItems.map((item) => item.color),
          borderColor: "#ffffff",
          borderWidth: 2,
          hoverOffset: 3,
        },
      ],
    }),
    [activeItems]
  );

  const chartOptions = useMemo(
    () => ({
      animation: prefersReducedMotion ? false : { duration: 450 },
      cutout: "68%",
      maintainAspectRatio: false,
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

  const centerTextPlugin = useMemo(() => createCenterTextPlugin(total), [total]);
  const description = `${ariaLabel}. ${items
    .map((item) => `${item.label}: ${item.value}`)
    .join(". ")}.`;

  return (
    <div style={styles.wrapper} aria-label={description} role="img">
      <style>
        {`
          @media (max-width: 680px) {
            .dashboard-donut-layout {
              grid-template-columns: minmax(0, 1fr);
              justify-items: center;
            }

            .dashboard-donut-legend {
              width: 100%;
            }
          }
        `}
      </style>
      <div className="dashboard-donut-layout" style={styles.layout}>
        <div style={styles.chartBox}>
          {total > 0 ? (
            <Doughnut
              data={chartData}
              options={chartOptions}
              plugins={[centerTextPlugin]}
            />
          ) : (
            <div style={styles.emptyDonut}>
              <strong style={styles.emptyTotal}>0</strong>
              <span style={styles.emptyTotalLabel}>Total</span>
            </div>
          )}
        </div>

        <div className="dashboard-donut-legend" style={styles.legend}>
          {items.map((item) => (
            <div key={item.label} style={styles.legendRow}>
              <span
                aria-hidden="true"
                style={{ ...styles.legendDot, background: item.color }}
              />
              <span style={styles.legendLabel}>{item.label}</span>
              <strong style={styles.legendValue}>{item.value}</strong>
            </div>
          ))}
          {total === 0 && <p style={styles.emptyMessage}>{emptyMessage}</p>}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    minWidth: 0,
  },
  layout: {
    alignItems: "center",
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "150px minmax(0, 1fr)",
    marginTop: "12px",
    minWidth: 0,
  },
  chartBox: {
    height: "150px",
    position: "relative",
    width: "150px",
  },
  emptyDonut: {
    alignItems: "center",
    background:
      "radial-gradient(circle at center, #ffffff 0 48%, transparent 49%), conic-gradient(#e5e7eb 0 100%)",
    borderRadius: "50%",
    display: "flex",
    flexDirection: "column",
    height: "150px",
    justifyContent: "center",
    width: "150px",
  },
  emptyTotal: {
    color: "#111827",
    fontSize: "24px",
    lineHeight: 1,
  },
  emptyTotalLabel: {
    color: "#64748b",
    fontSize: "11px",
    fontWeight: 700,
    marginTop: "5px",
  },
  legend: {
    display: "grid",
    gap: "7px",
    minWidth: 0,
  },
  legendRow: {
    alignItems: "center",
    display: "grid",
    gap: "8px",
    gridTemplateColumns: "10px minmax(0, 1fr) max-content",
  },
  legendDot: {
    borderRadius: "999px",
    height: "9px",
    width: "9px",
  },
  legendLabel: {
    color: "#334155",
    fontSize: "13px",
    lineHeight: 1.25,
    minWidth: 0,
  },
  legendValue: {
    color: "#111827",
    fontSize: "13px",
  },
  emptyMessage: {
    color: "#64748b",
    fontSize: "12px",
    margin: "3px 0 0",
  },
};

export default DashboardDonutChart;
