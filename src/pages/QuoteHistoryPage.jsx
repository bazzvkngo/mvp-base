import React, { useEffect, useMemo, useState } from "react";
import { getQuotes, updateQuoteStatus } from "../services/quoteService";
import { formatCLP, formatDate } from "../utils/formatters";

const STATUS_OPTIONS = ["borrador", "emitida", "aceptada", "rechazada"];

const statusLabels = {
  borrador: "Borrador",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
};

const statusStyles = {
  borrador: {
    background: "#f1f5f9",
    color: "#475569",
  },
  emitida: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },
  aceptada: {
    background: "#dcfce7",
    color: "#166534",
  },
  rechazada: {
    background: "#fee2e2",
    color: "#991b1b",
  },
};

function formatTimestamp(value) {
  if (!value) return "-";

  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("es-CL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getQuoteTimestamp(quote) {
  return quote?.actualizadoEn || quote?.creadoEn || null;
}

function QuoteHistoryPage({ userId }) {
  const [quotes, setQuotes] = useState([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError("");

    getQuotes(userId)
      .then((items) => {
        if (!active) return;
        setQuotes(items);
        setSelectedQuoteId((current) => current || items[0]?.id || "");
      })
      .catch((err) => {
        console.error("Error al cargar cotizaciones:", err);
        if (active) {
          setError("No se pudieron cargar las cotizaciones.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const filteredQuotes = useMemo(() => {
    const query = search.trim().toLowerCase();

    return quotes.filter((quote) => {
      if (statusFilter !== "todos" && quote.estado !== statusFilter) {
        return false;
      }

      if (!query) return true;

      const text = `${quote.numero || ""} ${quote.clienteNombre || ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [quotes, search, statusFilter]);

  const selectedQuote = useMemo(
    () => quotes.find((quote) => quote.id === selectedQuoteId) || null,
    [quotes, selectedQuoteId]
  );

  const handleChangeStatus = async (quoteId, estado) => {
    setSavingStatus(true);
    setError("");
    setSuccess("");

    try {
      await updateQuoteStatus(userId, quoteId, estado);
      setQuotes((prev) =>
        prev.map((quote) =>
          quote.id === quoteId
            ? { ...quote, estado, actualizadoEn: new Date() }
            : quote
        )
      );
      setSuccess(`Estado actualizado a ${statusLabels[estado].toLowerCase()}.`);
    } catch (err) {
      console.error("Error al actualizar estado:", err);
      setError(err.message || "No se pudo actualizar el estado.");
    } finally {
      setSavingStatus(false);
    }
  };

  if (!userId) {
    return (
      <section className="page-section">
        <p style={styles.errorText}>Debes iniciar sesión para ver cotizaciones.</p>
      </section>
    );
  }

  return (
    <section className="quote-history-page" style={styles.wrapper}>
      <div className="no-print" style={styles.header}>
        <div>
          <span className="eyebrow">Cotizaciones</span>
          <h2 style={styles.title}>Historial de cotizaciones</h2>
          <p style={styles.subtitle}>
            Consulta documentos guardados, revisa su detalle y actualiza el
            estado comercial basico.
          </p>
        </div>
      </div>

      {error && <p className="no-print" style={styles.errorText}>{error}</p>}
      {success && <p className="no-print" style={styles.successText}>{success}</p>}

      <div className="no-print" style={styles.panel}>
        <div style={styles.filters}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por numero o cliente"
            style={styles.searchInput}
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            style={styles.select}
          >
            <option value="todos">Todos los estados</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <p style={styles.emptyText}>Cargando cotizaciones...</p>
        ) : quotes.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>No hay cotizaciones guardadas</h3>
            <p style={styles.emptyText}>
              Crea una cotización desde /cotizaciones/nueva para verla en este
              historial.
            </p>
          </div>
        ) : filteredQuotes.length === 0 ? (
          <p style={styles.emptyText}>No hay cotizaciones con esos filtros.</p>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Numero</th>
                  <th style={styles.th}>Fecha</th>
                  <th style={styles.th}>Cliente</th>
                  <th style={styles.th}>Estado</th>
                  <th style={styles.th}>Total</th>
                  <th style={styles.th}>Ítems</th>
                  <th style={styles.th}>Actualizacion</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuotes.map((quote) => (
                  <tr
                    key={quote.id}
                    style={
                      quote.id === selectedQuoteId
                        ? styles.selectedRow
                        : undefined
                    }
                  >
                    <td style={styles.td}>
                      <strong>{quote.numero || "-"}</strong>
                    </td>
                    <td style={styles.td}>{formatDate(quote.fecha)}</td>
                    <td style={styles.td}>{quote.clienteNombre || "-"}</td>
                    <td style={styles.td}>
                      <StatusBadge status={quote.estado} />
                    </td>
                    <td style={styles.td}>
                      <strong>{formatCLP(quote.total)}</strong>
                    </td>
                    <td style={styles.td}>{quote.items?.length || 0}</td>
                    <td style={styles.td}>
                      {formatTimestamp(getQuoteTimestamp(quote))}
                    </td>
                    <td style={styles.td}>
                      <div style={styles.rowActions}>
                        <button
                          type="button"
                          onClick={() => setSelectedQuoteId(quote.id)}
                          style={styles.secondaryButton}
                        >
                          Ver detalle
                        </button>
                        <select
                          value={quote.estado || "borrador"}
                          onChange={(event) =>
                            handleChangeStatus(quote.id, event.target.value)
                          }
                          disabled={savingStatus}
                          style={styles.smallSelect}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {statusLabels[status]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedQuote ? (
        <QuoteDetail quote={selectedQuote} />
      ) : (
        !loading &&
        quotes.length > 0 && (
          <div className="no-print" style={styles.panel}>
            <p style={styles.emptyText}>
              Selecciona una cotización para revisar el detalle.
            </p>
          </div>
        )
      )}
    </section>
  );
}

function StatusBadge({ status }) {
  const normalizedStatus = status || "borrador";

  return (
    <span
      style={{
        ...styles.statusBadge,
        ...statusStyles[normalizedStatus],
      }}
    >
      {statusLabels[normalizedStatus] || normalizedStatus}
    </span>
  );
}

function QuoteDetail({ quote }) {
  const items = Array.isArray(quote.items) ? quote.items : [];

  return (
    <div className="history-print-area" style={styles.detailPanel}>
      <div className="no-print" style={styles.detailActions}>
        <div>
          <h3 style={styles.panelTitle}>Detalle de cotización</h3>
          <p style={styles.helpText}>
            Vista formal para revision e impresion desde el historial.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          style={styles.printButton}
        >
          Imprimir detalle
        </button>
      </div>

      <article className="quote-print" style={styles.printSheet}>
        <header style={styles.printHeader}>
          <div>
            <h2 style={styles.printBrand}>ValoraCloud</h2>
            <p style={styles.printMuted}>Valorización y cotizaciones</p>
          </div>
          <div style={styles.printMeta}>
            <strong>Cotización {quote.numero || "-"}</strong>
            <span>Fecha: {formatDate(quote.fecha)}</span>
            <span>
              Estado: {statusLabels[quote.estado] || quote.estado || "-"}
            </span>
          </div>
        </header>

        <section style={styles.clientBox}>
          <h3 style={styles.printSectionTitle}>Cliente</h3>
          <p style={styles.printLine}>
            <strong>{quote.clienteNombre || "Sin cliente"}</strong>
          </p>
          <p style={styles.printLine}>RUT/DNI: {quote.clienteRut || "-"}</p>
          <p style={styles.printLine}>Email: {quote.clienteEmail || "-"}</p>
          <p style={styles.printLine}>
            Telefono: {quote.clienteTelefono || "-"}
          </p>
          <p style={styles.printLine}>
            Direccion: {quote.clienteDireccion || "-"}
          </p>
          <p style={styles.printLine}>
            Condiciones: {quote.condicionesPago || "-"}
          </p>
        </section>

        <table style={styles.printTable}>
          <thead>
            <tr>
              <th style={styles.printTh}>Ítem</th>
              <th style={styles.printTh}>Tipo</th>
              <th style={styles.printTh}>Cant.</th>
              <th style={styles.printTh}>Precio unit.</th>
              <th style={styles.printTh}>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} style={styles.printTd}>
                  Sin ítems registrados.
                </td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr key={`${item.itemId || "item"}-${index}`}>
                  <td style={styles.printTd}>
                    <strong>{item.nombre || "Ítem sin nombre"}</strong>
                    <span style={styles.printItemMeta}>
                      {item.descripcion || item.categoria || ""}
                    </span>
                  </td>
                  <td style={styles.printTd}>{item.tipoItem || "-"}</td>
                  <td style={styles.printTd}>{item.cantidad || 0}</td>
                  <td style={styles.printTd}>
                    {formatCLP(item.precioUnitarioEditable)}
                  </td>
                  <td style={styles.printTd}>{formatCLP(item.totalLinea)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div style={styles.printTotals}>
          <TotalRow label="Subtotal" value={formatCLP(quote.subtotal)} />
          <TotalRow label="Descuento" value={formatCLP(quote.descuento)} />
          <TotalRow label="Total" value={formatCLP(quote.total)} strong />
        </div>

        {quote.observaciones && (
          <section style={styles.observationsBox}>
            <h3 style={styles.printSectionTitle}>Observaciones</h3>
            <p style={styles.printLine}>{quote.observaciones}</p>
          </section>
        )}
      </article>
    </div>
  );
}

function TotalRow({ label, value, strong = false }) {
  return (
    <div style={styles.totalRow}>
      <span style={strong ? styles.totalLabelStrong : styles.totalLabel}>
        {label}
      </span>
      <strong style={strong ? styles.totalValueStrong : styles.totalValue}>
        {value}
      </strong>
    </div>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "18px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
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
  panel: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "18px",
  },
  panelTitle: {
    margin: "0 0 6px",
    fontSize: "17px",
  },
  helpText: {
    color: "#64748b",
    margin: 0,
    fontSize: "14px",
  },
  filters: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginBottom: "14px",
  },
  searchInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    flex: "1 1 260px",
    padding: "10px 11px",
  },
  select: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
  },
  smallSelect: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "8px 9px",
  },
  tableWrapper: {
    overflowX: "auto",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
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
    padding: "10px",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  selectedRow: {
    background: "#f0fdfa",
  },
  rowActions: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #0f766e",
    borderRadius: "6px",
    color: "#0f766e",
    cursor: "pointer",
    fontWeight: 800,
    padding: "8px 10px",
  },
  printButton: {
    background: "#111827",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 12px",
  },
  statusBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 800,
    padding: "4px 9px",
    whiteSpace: "nowrap",
  },
  detailPanel: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "18px",
  },
  detailActions: {
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "14px",
  },
  printSheet: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    color: "#111827",
    padding: "28px",
  },
  printHeader: {
    alignItems: "flex-start",
    borderBottom: "2px solid #111827",
    display: "flex",
    justifyContent: "space-between",
    gap: "20px",
    paddingBottom: "16px",
  },
  printBrand: {
    margin: 0,
    fontSize: "26px",
  },
  printMuted: {
    color: "#64748b",
    margin: "4px 0 0",
  },
  printMeta: {
    display: "grid",
    gap: "4px",
    textAlign: "right",
  },
  clientBox: {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    margin: "18px 0",
    padding: "14px",
  },
  printSectionTitle: {
    fontSize: "15px",
    margin: "0 0 8px",
  },
  printLine: {
    margin: "3px 0",
  },
  printTable: {
    borderCollapse: "collapse",
    width: "100%",
  },
  printTh: {
    background: "#111827",
    color: "#ffffff",
    fontSize: "12px",
    padding: "10px",
    textAlign: "left",
    textTransform: "uppercase",
  },
  printTd: {
    borderBottom: "1px solid #e5e7eb",
    padding: "10px",
    verticalAlign: "top",
  },
  printItemMeta: {
    color: "#64748b",
    display: "block",
    fontSize: "12px",
    marginTop: "3px",
  },
  printTotals: {
    marginLeft: "auto",
    marginTop: "18px",
    maxWidth: "320px",
  },
  totalRow: {
    alignItems: "center",
    borderBottom: "1px solid #eef2f7",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    padding: "11px 0",
  },
  totalLabel: {
    color: "#475569",
    fontWeight: 700,
  },
  totalLabelStrong: {
    color: "#111827",
    fontSize: "18px",
    fontWeight: 800,
  },
  totalValue: {
    color: "#111827",
  },
  totalValueStrong: {
    color: "#0f766e",
    fontSize: "22px",
  },
  observationsBox: {
    borderTop: "1px solid #e5e7eb",
    marginTop: "20px",
    paddingTop: "14px",
  },
  emptyState: {
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    padding: "26px",
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
  successText: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    borderRadius: "8px",
    color: "#166534",
    margin: 0,
    padding: "11px 13px",
  },
};

export default QuoteHistoryPage;
