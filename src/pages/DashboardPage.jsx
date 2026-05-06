import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PRICING_STATUS } from "../domain/pricing";
import { getQuotes } from "../services/quoteService";
import { subscribeToInventory } from "../services/inventoryService";
import { subscribeToReferences } from "../services/referenceService";
import { buildValuations } from "../services/valuationService";
import { formatCLP } from "../utils/formatters";

const quoteStates = ["borrador", "emitida", "aceptada", "rechazada"];

const stateLabels = {
  borrador: "Borrador",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
};

const quickActions = [
  {
    to: "/inventario",
    title: "Crear ítem",
    description: "Agregar productos, servicios o actividades al inventario.",
  },
  {
    to: "/referencias",
    title: "Registrar referencia",
    description: "Guardar precios observados para comparar mercado.",
  },
  {
    to: "/valorizacion",
    title: "Ver valorización",
    description: "Revisar precios sugeridos y estado de mercado.",
  },
  {
    to: "/cotizaciones/nueva",
    title: "Nueva cotización",
    description: "Crear una cotización formal desde ítems valorizados.",
  },
  {
    to: "/cotizaciones",
    title: "Ver historial",
    description: "Consultar cotizaciones guardadas y cambiar estados.",
  },
];

function getValuationSummary(valuations) {
  return valuations.reduce(
    (summary, valuation) => {
      if (valuation.estadoValorizacion === PRICING_STATUS.SIN_REFERENCIAS) {
        summary.sinReferencias += 1;
      }
      if (valuation.estadoValorizacion === PRICING_STATUS.BAJO_MERCADO) {
        summary.bajoMercado += 1;
      }
      if (valuation.estadoValorizacion === PRICING_STATUS.DENTRO_DE_RANGO) {
        summary.dentroRango += 1;
      }
      if (valuation.estadoValorizacion === PRICING_STATUS.SOBRE_MERCADO) {
        summary.sobreMercado += 1;
      }
      return summary;
    },
    {
      sinReferencias: 0,
      bajoMercado: 0,
      dentroRango: 0,
      sobreMercado: 0,
    }
  );
}

function getQuoteSummary(quotes) {
  return quotes.reduce(
    (summary, quote) => {
      const estado = quote.estado || "borrador";
      summary.totalCotizado += Number(quote.total || 0);
      if (summary.porEstado[estado] !== undefined) {
        summary.porEstado[estado] += 1;
      }
      return summary;
    },
    {
      totalCotizado: 0,
      porEstado: {
        borrador: 0,
        emitida: 0,
        aceptada: 0,
        rechazada: 0,
      },
    }
  );
}

function DashboardPage({ usuario }) {
  const userId = usuario?.uid;
  const [inventoryItems, setInventoryItems] = useState([]);
  const [references, setReferences] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [referencesLoaded, setReferencesLoaded] = useState(false);
  const [quotesLoaded, setQuotesLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return undefined;

    setError("");
    setInventoryLoaded(false);
    setReferencesLoaded(false);
    setQuotesLoaded(false);

    const unsubscribeInventory = subscribeToInventory(
      userId,
      (items) => {
        setInventoryItems(items);
        setInventoryLoaded(true);
      },
      (err) => {
        console.error("Error al cargar inventario para dashboard:", err);
        setError("No se pudo cargar el inventario del dashboard.");
        setInventoryLoaded(true);
      }
    );

    const unsubscribeReferences = subscribeToReferences(
      userId,
      (items) => {
        setReferences(items);
        setReferencesLoaded(true);
      },
      (err) => {
        console.error("Error al cargar referencias para dashboard:", err);
        setError("No se pudieron cargar las referencias del dashboard.");
        setReferencesLoaded(true);
      }
    );

    getQuotes(userId)
      .then((items) => setQuotes(items))
      .catch((err) => {
        console.error("Error al cargar cotizaciones para dashboard:", err);
        setError("No se pudieron cargar las cotizaciones del dashboard.");
      })
      .finally(() => setQuotesLoaded(true));

    return () => {
      unsubscribeInventory();
      unsubscribeReferences();
    };
  }, [userId]);

  const activeInventory = useMemo(
    () =>
      inventoryItems.filter((item) => (item.estado || "activo") === "activo"),
    [inventoryItems]
  );

  const activeReferences = useMemo(
    () =>
      references.filter(
        (reference) => (reference.estado || "activa") === "activa"
      ),
    [references]
  );

  const valuations = useMemo(
    () => buildValuations(activeInventory, activeReferences),
    [activeInventory, activeReferences]
  );

  const valuationSummary = useMemo(
    () => getValuationSummary(valuations),
    [valuations]
  );

  const quoteSummary = useMemo(() => getQuoteSummary(quotes), [quotes]);

  const loading = !inventoryLoaded || !referencesLoaded || !quotesLoaded;
  const hasNoData =
    !loading &&
    activeInventory.length === 0 &&
    activeReferences.length === 0 &&
    quotes.length === 0;

  return (
    <section style={styles.wrapper}>
      <div style={styles.hero}>
        <div>
          <span className="eyebrow">Inicio</span>
          <h2 style={styles.title}>Dashboard ValoraCloud</h2>
          <p style={styles.subtitle}>
            Resumen operativo del inventario, referencias de mercado,
            valorización y cotizaciones guardadas.
          </p>
        </div>
        <div style={styles.userBox}>
          <span style={styles.userLabel}>Sesión</span>
          <strong>{usuario?.email || "Usuario autenticado"}</strong>
        </div>
      </div>

      {error && <p style={styles.errorText}>{error}</p>}

      {loading ? (
        <div style={styles.panel}>
          <p style={styles.emptyText}>Cargando métricas del sistema...</p>
        </div>
      ) : (
        <>
          {hasNoData && (
            <div style={styles.emptyState}>
              <h3 style={styles.emptyTitle}>Aún no hay datos operativos</h3>
              <p style={styles.emptyText}>
                Comienza creando ítems de inventario. Luego registra referencias
                y genera cotizaciones para alimentar este panel.
              </p>
            </div>
          )}

          <div style={styles.metricGrid}>
            <MetricCard label="Ítems activos" value={activeInventory.length} />
            <MetricCard label="Referencias activas" value={activeReferences.length} />
            <MetricCard label="Cotizaciones totales" value={quotes.length} />
            <MetricCard
              label="Total cotizado acumulado"
              value={formatCLP(quoteSummary.totalCotizado)}
              highlight
            />
          </div>

          <div style={styles.twoColumnGrid}>
            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>Cotizaciones por estado</h3>
              <div style={styles.statusGrid}>
                {quoteStates.map((state) => (
                  <MetricCard
                    key={state}
                    label={stateLabels[state]}
                    value={quoteSummary.porEstado[state]}
                    compact
                  />
                ))}
              </div>
            </div>

            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>Estado de valorización</h3>
              <div style={styles.statusGrid}>
                <MetricCard
                  label="Ítems sin referencias"
                  value={valuationSummary.sinReferencias}
                  compact
                />
                <MetricCard
                  label="Ítems bajo mercado"
                  value={valuationSummary.bajoMercado}
                  compact
                />
                <MetricCard
                  label="Ítems dentro de rango"
                  value={valuationSummary.dentroRango}
                  compact
                />
                <MetricCard
                  label="Ítems sobre mercado"
                  value={valuationSummary.sobreMercado}
                  compact
                />
              </div>
            </div>
          </div>
        </>
      )}

      <div style={styles.panel}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.panelTitle}>Accesos rápidos</h3>
          <p style={styles.helpText}>
            Atajos al flujo principal del MVP para presentar el caso completo.
          </p>
        </div>
        <div style={styles.quickGrid}>
          {quickActions.map((action) => (
            <Link key={action.to} to={action.to} style={styles.quickCard}>
              <strong>{action.title}</strong>
              <span>{action.description}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value, highlight = false, compact = false }) {
  return (
    <article
      style={{
        ...styles.metricCard,
        ...(highlight ? styles.metricCardHighlight : {}),
        ...(compact ? styles.metricCardCompact : {}),
      }}
    >
      <span style={styles.metricLabel}>{label}</span>
      <strong style={highlight ? styles.metricValueHighlight : styles.metricValue}>
        {value}
      </strong>
    </article>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "18px",
  },
  hero: {
    alignItems: "flex-start",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "flex",
    gap: "18px",
    justifyContent: "space-between",
    padding: "24px",
  },
  title: {
    fontSize: "24px",
    margin: "4px 0 8px",
  },
  subtitle: {
    color: "#64748b",
    lineHeight: 1.5,
    margin: 0,
    maxWidth: "760px",
  },
  userBox: {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "grid",
    gap: "4px",
    minWidth: "240px",
    padding: "14px",
  },
  userLabel: {
    color: "#64748b",
    fontSize: "12px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  metricGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  },
  twoColumnGrid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  },
  statusGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "18px",
  },
  sectionHeader: {
    marginBottom: "12px",
  },
  panelTitle: {
    fontSize: "17px",
    margin: "0 0 6px",
  },
  helpText: {
    color: "#64748b",
    fontSize: "14px",
    margin: 0,
  },
  metricCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "grid",
    gap: "8px",
    padding: "16px",
  },
  metricCardHighlight: {
    background: "#ecfdf5",
    borderColor: "#99f6e4",
  },
  metricCardCompact: {
    padding: "14px",
  },
  metricLabel: {
    color: "#64748b",
    fontSize: "13px",
    fontWeight: 700,
  },
  metricValue: {
    color: "#111827",
    fontSize: "26px",
  },
  metricValueHighlight: {
    color: "#0f766e",
    fontSize: "26px",
  },
  quickGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  },
  quickCard: {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    color: "#111827",
    display: "grid",
    gap: "6px",
    padding: "15px",
    textDecoration: "none",
  },
  emptyState: {
    background: "#ffffff",
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    padding: "28px",
    textAlign: "center",
  },
  emptyTitle: {
    margin: "0 0 6px",
  },
  emptyText: {
    color: "#64748b",
    margin: 0,
  },
  errorText: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    color: "#b91c1c",
    margin: 0,
    padding: "11px 13px",
  },
};

export default DashboardPage;
