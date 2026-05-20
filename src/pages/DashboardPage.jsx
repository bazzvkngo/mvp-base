import React, { useEffect, useMemo, useState } from "react";
import { PRICING_STATUS } from "../domain/pricing";
import { getQuotes } from "../services/quoteService";
import { subscribeToInventory } from "../services/inventoryService";
import { subscribeToReferences } from "../services/referenceService";
import {
  subscribeToPendingReferenceTasks,
  updateReferenceTaskStatus,
} from "../services/referenceTaskService";
import { buildValuations } from "../services/valuationService";
import { formatCLP } from "../utils/formatters";

const quoteStates = [
  "borrador",
  "emitida",
  "aceptada",
  "rechazada",
  "vencida",
  "archivada",
];

const stateLabels = {
  borrador: "Borrador",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  archivada: "Archivada",
};

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
      if (estado !== "archivada") {
        summary.totalVigente += Number(quote.total || 0);
        summary.cotizacionesVigentes += 1;
      }
      if (summary.porEstado[estado] !== undefined) {
        summary.porEstado[estado] += 1;
      }
      return summary;
    },
    {
      totalVigente: 0,
      cotizacionesVigentes: 0,
      porEstado: {
        borrador: 0,
        emitida: 0,
        aceptada: 0,
        rechazada: 0,
        vencida: 0,
        archivada: 0,
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
  const [referenceTasks, setReferenceTasks] = useState([]);
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

    const unsubscribeReferenceTasks = subscribeToPendingReferenceTasks(
      userId,
      (items) => setReferenceTasks(items),
      (err) => {
        console.error("Error al cargar tareas de referencias:", err);
      }
    );

    return () => {
      unsubscribeInventory();
      unsubscribeReferences();
      unsubscribeReferenceTasks();
    };
  }, [userId]);

  const changeReferenceTaskStatus = async (taskId, status) => {
    try {
      await updateReferenceTaskStatus(userId, taskId, status);
    } catch (err) {
      console.error("Error al actualizar tarea de referencia:", err);
      setError("No se pudo actualizar la tarea de referencia.");
    }
  };

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
  const visibleReferenceTasks = referenceTasks.slice(0, 6);

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
            Resumen operativo del inventario, referencias, valorización y
            cotizaciones.
          </p>
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
            <MetricCard
              label="Cotizaciones vigentes"
              value={quoteSummary.cotizacionesVigentes}
              note="Excluye archivadas"
            />
            <MetricCard
              label="Total cotizado vigente"
              value={formatCLP(quoteSummary.totalVigente)}
              note="Excluye archivadas"
              highlight
            />
          </div>

          <div style={styles.twoColumnGrid}>
            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>Cotizaciones por estado</h3>
              <p style={styles.helpText}>
                Las métricas principales excluyen cotizaciones archivadas.
              </p>
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
          <h3 style={styles.panelTitle}>Tareas de referencias</h3>
          <p style={styles.helpText}>
            Revisión nocturna para detectar ítems sin referencias o referencias
            desactualizadas.
          </p>
        </div>

        {referenceTasks.length === 0 ? (
          <p style={styles.emptyText}>No hay tareas pendientes de referencias.</p>
        ) : (
          <>
            <div style={styles.tableWrapper}>
              <table style={styles.taskTable}>
                <thead>
                  <tr>
                    <th style={styles.th}>Ítem</th>
                    <th style={styles.th}>Motivo</th>
                    <th style={styles.th}>Consulta sugerida</th>
                    <th style={styles.th}>Prioridad</th>
                    <th style={styles.th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleReferenceTasks.map((task) => (
                    <tr key={task.id}>
                      <td style={styles.td}>
                        <strong>{task.itemNombre}</strong>
                      </td>
                      <td style={styles.td}>
                        {task.tipoAlerta === "sin_referencias"
                          ? "Sin referencias activas"
                          : "Referencias desactualizadas"}
                      </td>
                      <td style={styles.tdWrap}>{task.consultaSugerida}</td>
                      <td style={styles.td}>{task.prioridad || "media"}</td>
                      <td style={styles.td}>
                        <div style={styles.taskActions}>
                          <button
                            type="button"
                            style={styles.secondaryButton}
                            onClick={() =>
                              changeReferenceTaskStatus(task.id, "resuelta")
                            }
                          >
                            Marcar resuelta
                          </button>
                          <button
                            type="button"
                            style={styles.clearButton}
                            onClick={() =>
                              changeReferenceTaskStatus(task.id, "ignorada")
                            }
                          >
                            Ignorar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {referenceTasks.length > visibleReferenceTasks.length && (
              <p style={styles.tableNote}>Mostrando las tareas más recientes.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  highlight = false,
  compact = false,
  note = "",
}) {
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
      {note && <span style={styles.metricNote}>{note}</span>}
    </article>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "14px",
  },
  hero: {
    alignItems: "flex-start",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "flex",
    gap: "14px",
    justifyContent: "space-between",
    padding: "18px",
  },
  title: {
    fontSize: "22px",
    margin: "4px 0 6px",
  },
  subtitle: {
    color: "#64748b",
    fontSize: "14px",
    lineHeight: 1.45,
    margin: 0,
    maxWidth: "760px",
  },
  metricGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  },
  twoColumnGrid: {
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  },
  statusGrid: {
    display: "grid",
    gap: "8px",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    marginTop: "10px",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "14px",
  },
  sectionHeader: {
    marginBottom: "10px",
  },
  panelTitle: {
    fontSize: "15px",
    margin: "0 0 5px",
  },
  helpText: {
    color: "#64748b",
    fontSize: "13px",
    margin: 0,
  },
  metricCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "grid",
    gap: "5px",
    padding: "12px",
  },
  metricCardHighlight: {
    background: "#ecfdf5",
    borderColor: "#99f6e4",
  },
  metricCardCompact: {
    padding: "10px",
  },
  metricLabel: {
    color: "#64748b",
    fontSize: "12px",
    fontWeight: 700,
  },
  metricValue: {
    color: "#111827",
    fontSize: "22px",
  },
  metricValueHighlight: {
    color: "#0f766e",
    fontSize: "22px",
  },
  metricNote: {
    color: "#64748b",
    fontSize: "11px",
  },
  tableWrapper: {
    overflowX: "auto",
  },
  taskTable: {
    borderCollapse: "collapse",
    width: "100%",
  },
  th: {
    background: "#f8fafc",
    borderBottom: "1px solid #e5e7eb",
    color: "#64748b",
    fontSize: "11px",
    padding: "8px",
    textAlign: "left",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  td: {
    borderBottom: "1px solid #eef2f7",
    fontSize: "13px",
    padding: "8px",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  tdWrap: {
    borderBottom: "1px solid #eef2f7",
    color: "#475569",
    fontSize: "13px",
    lineHeight: 1.35,
    maxWidth: "360px",
    padding: "8px",
    verticalAlign: "middle",
  },
  taskActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  secondaryButton: {
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
    padding: "7px 9px",
  },
  clearButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
    padding: "7px 9px",
  },
  tableNote: {
    color: "#64748b",
    fontSize: "12px",
    margin: "10px 0 0",
  },
  emptyState: {
    background: "#ffffff",
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    padding: "22px",
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
