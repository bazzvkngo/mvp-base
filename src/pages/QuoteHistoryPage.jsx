import React, { useEffect, useMemo, useState } from "react";
import QuotePrintView from "../features/quotes/QuotePrintView";
import { getCompanyProfile } from "../services/companyService";
import { getQuotes, updateQuoteStatus } from "../services/quoteService";
import { formatCLP, formatDate } from "../utils/formatters";

const STATUS_OPTIONS = [
  "borrador",
  "emitida",
  "aceptada",
  "rechazada",
  "vencida",
  "archivada",
];

const statusLabels = {
  borrador: "Borrador",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  archivada: "Archivada",
};

const statusStyles = {
  borrador: {
    background: "#e0f2fe",
    color: "#0369a1",
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
  vencida: {
    background: "#fef3c7",
    color: "#92400e",
  },
  archivada: {
    background: "#e5e7eb",
    color: "#374151",
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
  const [companyProfile, setCompanyProfile] = useState(null);
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

    getCompanyProfile(userId)
      .then((profile) => {
        if (active) setCompanyProfile(profile);
      })
      .catch((err) => {
        console.error("Error al cargar perfil de empresa:", err);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const filteredQuotes = useMemo(() => {
    const query = search.trim().toLowerCase();

    return quotes.filter((quote) => {
      const estado = quote.estado || "borrador";

      if (statusFilter === "todos" && estado === "archivada") {
        return false;
      }

      if (statusFilter !== "todos" && estado !== statusFilter) {
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

  useEffect(() => {
    if (filteredQuotes.length === 0) {
      setSelectedQuoteId("");
      return;
    }

    if (!filteredQuotes.some((quote) => quote.id === selectedQuoteId)) {
      setSelectedQuoteId(filteredQuotes[0].id);
    }
  }, [filteredQuotes, selectedQuoteId]);

  const handleChangeStatus = async (quoteId, estado, options = {}) => {
    const { confirm = true, estadoAnterior } = options;

    if (confirm) {
      const confirmed = window.confirm(
        "¿Seguro que deseas cambiar el estado de esta cotización?"
      );

      if (!confirmed) return false;
    }

    setSavingStatus(true);
    setError("");
    setSuccess("");

    try {
      await updateQuoteStatus(userId, quoteId, estado, { estadoAnterior });
      setQuotes((prev) =>
        prev.map((quote) =>
          quote.id === quoteId
            ? {
                ...quote,
                estado,
                ...(estadoAnterior ? { estadoAnterior } : {}),
                actualizadoEn: new Date(),
              }
            : quote
        )
      );
      setSuccess(`Estado actualizado a ${statusLabels[estado].toLowerCase()}.`);
      return true;
    } catch (err) {
      console.error("Error al actualizar estado:", err);
      setError(err.message || "No se pudo actualizar el estado.");
      return false;
    } finally {
      setSavingStatus(false);
    }
  };

  const handleArchiveQuote = async (quote) => {
    const confirmed = window.confirm(
      "¿Seguro que deseas archivar esta cotización? Se ocultará del historial principal y podrás restaurarla más adelante."
    );

    if (!confirmed) return;

    const estadoActual = quote.estado || "borrador";
    const updated = await handleChangeStatus(quote.id, "archivada", {
      confirm: false,
      estadoAnterior: estadoActual,
    });
    if (updated) {
      setSuccess("Cotización archivada. Puedes restaurarla desde el filtro Archivada.");
    }
  };

  const handleRestoreQuote = async (quote) => {
    const canRestorePreviousState =
      statusLabels[quote.estadoAnterior] && quote.estadoAnterior !== "archivada";
    const estadoRestaurado = canRestorePreviousState
      ? quote.estadoAnterior
      : "emitida";
    const updated = await handleChangeStatus(quote.id, estadoRestaurado);

    if (updated) {
      setSuccess(
        `Cotización restaurada a ${statusLabels[estadoRestaurado].toLowerCase()}.`
      );
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
            estado comercial básico.
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
            placeholder="Buscar por número o cliente"
            style={styles.searchInput}
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            style={styles.select}
          >
            <option value="todos">Todas excepto archivadas</option>
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
                  <th style={styles.th}>Número</th>
                  <th style={styles.th}>Fecha</th>
                  <th style={styles.th}>Cliente</th>
                  <th style={styles.th}>Estado</th>
                  <th style={styles.th}>Total</th>
                  <th style={styles.th}>Ítems</th>
                  <th style={styles.th}>Actualización</th>
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
                        <QuoteActions
                          quote={quote}
                          disabled={savingStatus}
                          onChangeStatus={handleChangeStatus}
                          onArchive={handleArchiveQuote}
                          onRestore={handleRestoreQuote}
                        />
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
        <QuoteDetail quote={selectedQuote} companyProfile={companyProfile} />
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

function QuoteActions({
  quote,
  disabled,
  onChangeStatus,
  onArchive,
  onRestore,
}) {
  const estado = quote.estado || "borrador";

  if (estado === "borrador") {
    return (
      <>
        <button
          type="button"
          onClick={() => onChangeStatus(quote.id, "emitida")}
          disabled={disabled}
          style={styles.secondaryButton}
        >
          Marcar emitida
        </button>
        <button
          type="button"
          onClick={() => onArchive(quote)}
          disabled={disabled}
          style={styles.archiveButton}
        >
          Archivar
        </button>
      </>
    );
  }

  if (estado === "emitida") {
    return (
      <>
        <button
          type="button"
          onClick={() => onChangeStatus(quote.id, "aceptada")}
          disabled={disabled}
          style={styles.acceptButton}
        >
          Aceptada
        </button>
        <button
          type="button"
          onClick={() => onChangeStatus(quote.id, "rechazada")}
          disabled={disabled}
          style={styles.rejectButton}
        >
          Rechazada
        </button>
        <button
          type="button"
          onClick={() => onChangeStatus(quote.id, "vencida")}
          disabled={disabled}
          style={styles.expireButton}
        >
          Vencida
        </button>
        <button
          type="button"
          onClick={() => onArchive(quote)}
          disabled={disabled}
          style={styles.archiveButton}
        >
          Archivar
        </button>
      </>
    );
  }

  if (estado === "aceptada") {
    return (
      <button
        type="button"
        onClick={() => onChangeStatus(quote.id, "emitida")}
        disabled={disabled}
        style={styles.secondaryButton}
      >
        Corregir a emitida
      </button>
    );
  }

  if (estado === "rechazada" || estado === "vencida") {
    return (
      <>
        <button
          type="button"
          onClick={() => onChangeStatus(quote.id, "emitida")}
          disabled={disabled}
          style={styles.secondaryButton}
        >
          Reabrir como emitida
        </button>
        <button
          type="button"
          onClick={() => onArchive(quote)}
          disabled={disabled}
          style={styles.archiveButton}
        >
          Archivar
        </button>
      </>
    );
  }

  if (estado === "archivada") {
    return (
      <button
        type="button"
        onClick={() => onRestore(quote)}
        disabled={disabled}
        style={styles.secondaryButton}
      >
        Restaurar
      </button>
    );
  }

  return null;
}

function QuoteDetail({ quote, companyProfile }) {

  return (
    <div className="history-print-area" style={styles.detailPanel}>
      <div className="no-print" style={styles.detailActions}>
        <div>
          <h3 style={styles.panelTitle}>Detalle de cotización</h3>
          <p style={styles.helpText}>
            Vista formal para revisión e impresión desde el historial.
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

      <QuotePrintView quote={quote} companyProfile={companyProfile} />
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
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    fontWeight: 700,
    padding: "8px 10px",
  },
  acceptButton: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: "6px",
    color: "#166534",
    cursor: "pointer",
    fontWeight: 700,
    padding: "8px 10px",
  },
  rejectButton: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "6px",
    color: "#991b1b",
    cursor: "pointer",
    fontWeight: 700,
    padding: "8px 10px",
  },
  expireButton: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "6px",
    color: "#92400e",
    cursor: "pointer",
    fontWeight: 700,
    padding: "8px 10px",
  },
  archiveButton: {
    background: "#f8fafc",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    color: "#4b5563",
    cursor: "pointer",
    fontWeight: 700,
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
