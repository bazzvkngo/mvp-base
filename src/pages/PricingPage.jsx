import React, { useEffect, useMemo, useState } from "react";
import { PRICING_STATUS } from "../domain/pricing";
import { subscribeToValuations } from "../services/valuationService";
import { formatCLP, formatDate, formatPercent } from "../utils/formatters";

const tipoLabels = {
  producto: "Producto",
  servicio: "Servicio",
  actividad: "Actividad",
};

const statusStyles = {
  [PRICING_STATUS.SIN_REFERENCIAS]: {
    background: "#f1f5f9",
    color: "#475569",
  },
  [PRICING_STATUS.BAJO_MERCADO]: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },
  [PRICING_STATUS.DENTRO_DE_RANGO]: {
    background: "#dcfce7",
    color: "#166534",
  },
  [PRICING_STATUS.SOBRE_MERCADO]: {
    background: "#fee2e2",
    color: "#991b1b",
  },
};

const differenceMetricStyles = {
  [PRICING_STATUS.BAJO_MERCADO]: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    color: "#047857",
  },
  [PRICING_STATUS.DENTRO_DE_RANGO]: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
  },
  [PRICING_STATUS.SOBRE_MERCADO]: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
  },
};

function getSummary(valuations) {
  return valuations.reduce(
    (summary, valuation) => {
      summary.total += 1;
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
      total: 0,
      sinReferencias: 0,
      bajoMercado: 0,
      dentroRango: 0,
      sobreMercado: 0,
    }
  );
}

function formatOptionalCLP(value) {
  return value === null || value === undefined ? "-" : formatCLP(value);
}

function formatOptionalPercent(value) {
  return value === null || value === undefined ? "-" : formatPercent(value, 1);
}

const unitLabels = {
  cuenta: "Cuenta",
  equipo: "Equipo",
  hora: "Hora",
  mes: "Mes",
  metro: "Metro",
  proyecto: "Proyecto",
  punto: "Punto",
  servicio: "Servicio",
  unidad: "Unidad",
  visita: "Visita",
};

function formatDisplayUnit(value) {
  const unit = String(value || "").trim();
  if (!unit) return "-";

  const normalized = unit.toLowerCase();
  return unitLabels[normalized] || `${unit.charAt(0).toUpperCase()}${unit.slice(1)}`;
}

function formatReferenceDate(value) {
  const date = formatDate(value);
  return date === "-" ? "Sin fecha" : date;
}

function PricingPage({ userId }) {
  const [valuations, setValuations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState("todos");
  const [tipoFiltro, setTipoFiltro] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [expandedItemId, setExpandedItemId] = useState(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const unsubscribe = subscribeToValuations(
      userId,
      (items) => {
        setValuations(items);
        setLoading(false);
      },
      (err) => {
        console.error("Error al cargar valorización:", err);
        setError("No se pudo cargar la valorización.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  const summary = useMemo(() => getSummary(valuations), [valuations]);

  const filteredValuations = useMemo(() => {
    const query = busqueda.trim().toLowerCase();

    return valuations.filter((valuation) => {
      if (
        estadoFiltro !== "todos" &&
        valuation.estadoValorizacion !== estadoFiltro
      ) {
        return false;
      }
      if (tipoFiltro !== "todos" && valuation.tipoItem !== tipoFiltro) {
        return false;
      }
      if (!query) return true;

      const text = `${valuation.nombre || ""} ${valuation.categoria || ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [busqueda, estadoFiltro, tipoFiltro, valuations]);

  const hasAnyReference = valuations.some(
    (valuation) => valuation.cantidadReferencias > 0
  );

  return (
    <section style={styles.wrapper}>
      <div style={styles.header}>
        <div>
          <span style={styles.eyebrow}>Valorización</span>
          <h2 style={styles.title}>Precio sugerido por ítem</h2>
          <p style={styles.subtitle}>
            Cruza inventario activo con referencias de mercado activas para
            estimar un precio defendible antes de cotizar.
          </p>
          <p style={styles.logicNote}>
            El precio sugerido combina el precio interno del ítem con referencias
            de mercado activas. Si no existen referencias, se utiliza el precio
            interno como base.
          </p>
        </div>
      </div>

      {!userId && (
        <p style={styles.errorText}>Debes iniciar sesión para ver valorización.</p>
      )}
      {error && <p style={styles.errorText}>{error}</p>}

      <div style={styles.summaryGrid}>
        <MetricCard label="Ítems analizados" value={summary.total} />
        <MetricCard label="Sin referencias" value={summary.sinReferencias} />
        <MetricCard label="Bajo mercado" value={summary.bajoMercado} />
        <MetricCard label="Dentro de rango" value={summary.dentroRango} />
        <MetricCard label="Sobre mercado" value={summary.sobreMercado} />
      </div>

      {!loading && valuations.length > 0 && !hasAnyReference && (
        <div style={styles.notice}>
          Hay inventario activo, pero todavía no existen referencias activas.
          El precio sugerido usa solo el precio interno efectivo del ítem.
        </div>
      )}

      <div style={styles.listCard}>
        <div style={styles.filters}>
          <input
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder="Buscar por nombre o categoría"
            style={styles.searchInput}
          />
          <select
            value={estadoFiltro}
            onChange={(event) => setEstadoFiltro(event.target.value)}
            style={styles.filterSelect}
          >
            <option value="todos">Todos los estados</option>
            <option value={PRICING_STATUS.SIN_REFERENCIAS}>Sin referencias</option>
            <option value={PRICING_STATUS.BAJO_MERCADO}>Bajo mercado</option>
            <option value={PRICING_STATUS.DENTRO_DE_RANGO}>Dentro de rango</option>
            <option value={PRICING_STATUS.SOBRE_MERCADO}>Sobre mercado</option>
          </select>
          <select
            value={tipoFiltro}
            onChange={(event) => setTipoFiltro(event.target.value)}
            style={styles.filterSelect}
          >
            <option value="todos">Todos los tipos</option>
            <option value="producto">Producto</option>
            <option value="servicio">Servicio</option>
            <option value="actividad">Actividad</option>
          </select>
        </div>

        {loading ? (
          <p style={styles.emptyText}>Cargando valorización...</p>
        ) : valuations.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>No hay inventario activo</h3>
            <p style={styles.emptyText}>
              Crea o reactiva ítems en inventario para comenzar el análisis de
              valorización.
            </p>
          </div>
        ) : filteredValuations.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>No hay resultados con esos filtros</h3>
            <p style={styles.emptyText}>
              Ajusta el estado, tipo de ítem o búsqueda para ver valorizaciones.
            </p>
          </div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Ítem</th>
                  <th style={styles.th}>Categoría / tipo</th>
                  <th style={styles.th}>Precio interno</th>
                  <th style={styles.th}>Promedio mercado</th>
                  <th style={styles.th}>Precio sugerido</th>
                  <th style={styles.th}>Estado</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredValuations.map((valuation) => {
                  const isExpanded = expandedItemId === valuation.itemId;
                  return (
                    <React.Fragment key={valuation.itemId}>
                      <tr>
                        <td style={{ ...styles.td, ...styles.itemCell }}>
                          <strong>{valuation.nombre}</strong>
                          <span style={styles.itemMeta}>
                            Unidad: {formatDisplayUnit(valuation.unidad)}
                          </span>
                        </td>
                        <td style={{ ...styles.td, ...styles.categoryCell }}>
                          <strong>{valuation.categoria || "-"}</strong>
                          <span style={styles.itemMeta}>
                            {tipoLabels[valuation.tipoItem] || valuation.tipoItem || "-"}
                          </span>
                        </td>
                        <td style={styles.td}>{formatCLP(valuation.precioInterno)}</td>
                        <td style={styles.td}>
                          {formatOptionalCLP(valuation.promedioReferencias)}
                        </td>
                        <td style={styles.td}>
                          <strong>{formatCLP(valuation.precioSugerido)}</strong>
                        </td>
                        <td style={styles.td}>
                          <span
                            style={{
                              ...styles.statusBadge,
                              ...statusStyles[valuation.estadoValorizacion],
                            }}
                          >
                            {valuation.estadoValorizacion}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button
                            type="button"
                            style={styles.smallButton}
                            onClick={() =>
                              setExpandedItemId(isExpanded ? null : valuation.itemId)
                            }
                          >
                            {isExpanded ? "Ocultar" : "Ver refs."}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} style={styles.detailCell}>
                            <ReferenceDetail valuation={valuation} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function MetricCard({ label, value }) {
  return (
    <div style={styles.metricCard}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={styles.metricValue}>{value}</strong>
    </div>
  );
}

function ReferenceDetail({ valuation }) {
  const references = valuation.referencias || [];
  return (
    <div style={styles.detailContent}>
      <div style={styles.detailGrid}>
        <DetailMetric label="Unidad" value={formatDisplayUnit(valuation.unidad)} />
        <DetailMetric label="Costo base" value={formatCLP(valuation.costoBase)} />
        <DetailMetric
          label={valuation.precioManual ? "Margen base" : "Margen"}
          value={formatPercent(valuation.margenDeseado, 1)}
        />
        <DetailMetric
          label="Precio interno"
          value={formatCLP(valuation.precioInterno)}
        />
        <DetailMetric
          label="Promedio de referencias"
          value={formatOptionalCLP(valuation.promedioReferencias)}
        />
        <DetailMetric
          label="Cantidad de referencias"
          value={valuation.cantidadReferencias}
        />
        <DetailMetric
          label="Diferencia"
          value={formatOptionalPercent(valuation.diferenciaPorcentual)}
          style={differenceMetricStyles[valuation.estadoValorizacion]}
        />
      </div>

      <div>
        <h4 style={styles.detailTitle}>Referencias activas usadas</h4>
        {references.length === 0 ? (
          <p style={styles.emptyText}>Este ítem no tiene referencias activas.</p>
        ) : (
          <div style={styles.referenceGrid}>
            {references.map((reference) => (
              <div key={reference.id} style={styles.referenceItem}>
                <strong>{reference.nombreFuente || "Fuente sin nombre"}</strong>
                <span>{formatCLP(reference.precioObservado)}</span>
                <small>{formatReferenceDate(reference.fechaConsulta)}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailMetric({ label, value, style }) {
  return (
    <div style={{ ...styles.detailMetric, ...style }}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "18px",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
  },
  eyebrow: {
    color: "#0f766e",
    fontSize: "12px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  title: {
    margin: "4px 0 6px",
    fontSize: "24px",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.5,
  },
  logicNote: {
    color: "#64748b",
    fontSize: "14px",
    lineHeight: 1.45,
    margin: "8px 0 0",
    maxWidth: "760px",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "12px",
    minWidth: 0,
  },
  metricCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "16px",
  },
  metricLabel: {
    color: "#64748b",
    display: "block",
    fontSize: "13px",
    marginBottom: "8px",
  },
  metricValue: {
    color: "#111827",
    fontSize: "24px",
  },
  notice: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "8px",
    color: "#92400e",
    padding: "12px 14px",
  },
  listCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    padding: "18px",
  },
  filters: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginBottom: "14px",
  },
  searchInput: {
    flex: "1 1 260px",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
  },
  filterSelect: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
    background: "#ffffff",
  },
  tableWrapper: {
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "auto",
  },
  table: {
    minWidth: "860px",
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    background: "#f8fafc",
    borderBottom: "1px solid #e5e7eb",
    color: "#64748b",
    fontSize: "12px",
    padding: "10px",
    textAlign: "left",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  td: {
    borderBottom: "1px solid #eef2f7",
    fontSize: "14px",
    padding: "12px 10px",
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },
  itemCell: {
    minWidth: "220px",
    whiteSpace: "normal",
  },
  categoryCell: {
    minWidth: "180px",
    whiteSpace: "normal",
  },
  detailCell: {
    background: "#f8fafc",
    borderBottom: "1px solid #eef2f7",
    padding: "14px",
  },
  itemMeta: {
    color: "#64748b",
    display: "block",
    fontSize: "12px",
    marginTop: "3px",
  },
  statusBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 800,
    padding: "4px 9px",
  },
  smallButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    background: "#ffffff",
    cursor: "pointer",
    fontWeight: 700,
    padding: "7px 9px",
  },
  detailContent: {
    display: "grid",
    gap: "14px",
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
  },
  detailMetric: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "grid",
    gap: "4px",
    padding: "10px 12px",
  },
  detailTitle: {
    color: "#334155",
    fontSize: "13px",
    margin: "0 0 10px",
    textTransform: "uppercase",
  },
  referenceGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px",
  },
  referenceItem: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "grid",
    gap: "4px",
    padding: "12px",
  },
  emptyState: {
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
    color: "#b91c1c",
    fontSize: "14px",
    margin: "12px 0 0",
  },
};

export default PricingPage;
