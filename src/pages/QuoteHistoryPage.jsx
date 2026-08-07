import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuotePrintView from "../features/quotes/QuotePrintView";
import SendQuoteEmailModal from "../features/quotes/SendQuoteEmailModal";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import { getCompanyProfile } from "../services/companyService";
import { canDuplicateQuotes } from "../domain/quoteModel.mjs";
import {
  createQuoteDuplicateRequestId,
  duplicateQuoteAsDraft,
  getQuoteDisplayNumber,
  getQuotes,
  updateQuoteStatus,
} from "../services/quoteService";
import { isQuoteEmailSendable } from "../services/quoteEmailService";
import {
  crearVentaDesdeCotizacion,
  createSaleRequestId,
} from "../services/saleService";
import { formatCLP, formatDate } from "../utils/formatters";
import { downloadQuotePdf, shareQuotePdf } from "../utils/quotePdf";

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

function getEmailActionHint(quote) {
  const estado = quote?.estado || "borrador";

  if (estado === "archivada") {
    return "Restaura la cotización antes de enviarla nuevamente.";
  }

  if (estado === "borrador") {
    return "Emite la cotización antes de enviarla al cliente.";
  }

  return "";
}

function QuoteHistoryPage({ userId, role }) {
  const navigate = useNavigate();
  const duplicateRequestIdsRef = useRef(new Map());
  const saleRequestIdsRef = useRef(new Map());
  const [quotes, setQuotes] = useState([]);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [emailModalQuote, setEmailModalQuote] = useState(null);
  const [restoreDetailFocus, setRestoreDetailFocus] = useState(true);
  const [duplicatingQuoteId, setDuplicatingQuoteId] = useState("");
  const [registeringSaleQuoteId, setRegisteringSaleQuoteId] = useState("");
  const canDuplicate = canDuplicateQuotes(role);

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

      const text = `${getQuoteDisplayNumber(quote, quote.id || "")} ${
        quote.clienteNombre || ""
      }`.toLowerCase();
      return text.includes(query);
    });
  }, [quotes, search, statusFilter]);

  const selectedQuote = useMemo(
    () => quotes.find((quote) => quote.id === selectedQuoteId) || null,
    [quotes, selectedQuoteId]
  );

  useEffect(() => {
    if (
      selectedQuoteId &&
      !filteredQuotes.some((quote) => quote.id === selectedQuoteId)
    ) {
      setSelectedQuoteId("");
    }
  }, [filteredQuotes, selectedQuoteId]);

  const handleToggleDetail = (quoteId) => {
    setRestoreDetailFocus(true);
    setSelectedQuoteId((current) => (current === quoteId ? "" : quoteId));
  };

  const handleCloseDetail = () => setSelectedQuoteId("");

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
      setSuccess("Cotización archivada correctamente.");
    }
  };

  const handleRestoreQuote = async (quote) => {
    const canRestorePreviousState =
      statusLabels[quote.estadoAnterior] && quote.estadoAnterior !== "archivada";
    const estadoRestaurado = canRestorePreviousState
      ? quote.estadoAnterior
      : "borrador";
    const updated = await handleChangeStatus(quote.id, estadoRestaurado);

    if (updated) {
      setSuccess("Cotización restaurada correctamente.");
    }
  };

  const handleEditDraft = (quoteId) => {
    navigate(`/cotizaciones/${quoteId}/editar`);
  };

  const handleDuplicateQuote = async (quote) => {
    if (!window.confirm(
      "Se creará un nuevo documento editable. El original permanecerá sin cambios."
    )) return;
    const requestId = duplicateRequestIdsRef.current.get(quote.id) ||
      createQuoteDuplicateRequestId();
    duplicateRequestIdsRef.current.set(quote.id, requestId);
    setDuplicatingQuoteId(quote.id);
    setError("");
    setSuccess("");
    try {
      const result = await duplicateQuoteAsDraft(userId, quote.id, {requestId});
      duplicateRequestIdsRef.current.delete(quote.id);
      navigate(`/cotizaciones/${result.quote.id}/editar`, {
        state: {message: "Copia creada como borrador."},
      });
    } catch (duplicateError) {
      setError(duplicateError.message || "No se pudo duplicar la cotización.");
    } finally {
      setDuplicatingQuoteId("");
    }
  };

  const handleRegisterSale = async (quote) => {
    if (quote.ventaId) {
      navigate(`/ventas/${quote.ventaId}`);
      return;
    }
    const requestId = saleRequestIdsRef.current.get(quote.id) ||
      createSaleRequestId("sale-quote");
    saleRequestIdsRef.current.set(quote.id, requestId);
    setRegisteringSaleQuoteId(quote.id);
    setError("");
    setSuccess("");
    try {
      const result = await crearVentaDesdeCotizacion(userId, quote.id, {requestId});
      saleRequestIdsRef.current.delete(quote.id);
      setQuotes((current) => current.map((item) => item.id === quote.id
        ? {...item, ventaId: result.venta.id, ventaNumero: result.venta.numero}
        : item));
      navigate(`/ventas/${result.venta.id}/editar`, {
        state: {message: "Venta creada como borrador desde la cotización."},
      });
    } catch (saleError) {
      setError(saleError.message || "No se pudo registrar la venta.");
    } finally {
      setRegisteringSaleQuoteId("");
    }
  };

  const handleEmailSent = (quoteId, emailPatch, result) => {
    setQuotes((prev) =>
      prev.map((quote) =>
        quote.id === quoteId
          ? {
              ...quote,
              ...emailPatch,
              actualizadoEn: new Date(),
            }
          : quote
      )
    );

    if (result?.success) {
      setSuccess(
        `Cotización enviada correctamente a ${emailPatch?.emailClienteDestino || "cliente"}.`
      );
    } else {
      setError(
        result?.error ||
          "No fue posible enviar la cotización. Puedes utilizar el respaldo manual."
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
    <section className="quote-history-page erp-page" style={styles.wrapper}>
      <div className="no-print erp-page-header" style={styles.header}>
        <div className="erp-page-header__content">
          <span className="eyebrow">Cotizaciones</span>
          <h2 style={styles.title}>Historial de cotizaciones</h2>
          <p style={styles.subtitle}>
            Consulta documentos guardados, revisa su detalle y actualiza el
            estado comercial básico.
          </p>
        </div>
        {canDuplicate && (
          <Button type="button" onClick={() => navigate("/cotizaciones/nueva")}>
            Nueva cotización
          </Button>
        )}
      </div>

      {error && <p className="no-print" role="alert" style={styles.errorText}>{error}</p>}
      {success && <p className="no-print" role="status" style={styles.successText}>{success}</p>}

      <div className="no-print erp-panel" style={styles.panel}>
        <div className="erp-filters" style={styles.filters}>
          <label className="erp-field">
            <span>Buscar cotización</span>
            <input
              className="erp-control"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Número o cliente"
              style={styles.searchInput}
            />
          </label>
          <label className="erp-field">
            <span>Estado</span>
            <select
              className="erp-control"
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
          </label>
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
          <>
          <div className="erp-table-region erp-desktop-only" style={styles.tableWrapper}>
            <table className="erp-table" style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Número</th>
                  <th style={styles.th}>Fecha</th>
                  <th style={styles.th}>Cliente</th>
                  <th style={styles.th}>Estado</th>
                  <th style={styles.th}>Correo</th>
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
                      <strong>{getQuoteDisplayNumber(quote, quote.id || "-")}</strong>
                    </td>
                    <td style={styles.td}>{formatDate(quote.fecha)}</td>
                    <td style={styles.td}>{quote.clienteNombre || "-"}</td>
                    <td style={styles.td}>
                      <StatusBadge status={quote.estado} />
                    </td>
                    <td style={styles.td}>
                      <EmailStatusBadge quote={quote} />
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
                          aria-haspopup="dialog"
                          onClick={() => handleToggleDetail(quote.id)}
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
                          onEditDraft={handleEditDraft}
                          canDuplicate={canDuplicate}
                          duplicating={duplicatingQuoteId === quote.id}
                          onDuplicate={handleDuplicateQuote}
                          onRegisterSale={handleRegisterSale}
                          registeringSale={registeringSaleQuoteId === quote.id}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <QuoteCards
            quotes={filteredQuotes}
            selectedQuoteId={selectedQuoteId}
            onViewDetail={handleToggleDetail}
          />
          </>
        )}
      </div>

      <ResponsiveDialog
        open={Boolean(selectedQuote)}
        onClose={handleCloseDetail}
        portal={false}
        restoreFocus={restoreDetailFocus}
        size="large"
        eyebrow="Cotizaciones"
        title={selectedQuote ? `Cotización ${getQuoteDisplayNumber(selectedQuote, selectedQuote.id || "-")}` : "Detalle de cotización"}
        description="Revisa el documento formal y administra su estado comercial."
        footer={selectedQuote ? (
          <div className="erp-actions" style={styles.dialogActions}>
            <QuoteActions
              quote={selectedQuote}
              disabled={savingStatus}
              onChangeStatus={handleChangeStatus}
              onArchive={handleArchiveQuote}
              onRestore={handleRestoreQuote}
              onEditDraft={handleEditDraft}
              canDuplicate={canDuplicate}
              duplicating={duplicatingQuoteId === selectedQuote.id}
              onDuplicate={handleDuplicateQuote}
              onRegisterSale={handleRegisterSale}
              registeringSale={registeringSaleQuoteId === selectedQuote.id}
            />
          </div>
        ) : null}
      >
        {selectedQuote && (
          <QuoteDetail
            quote={selectedQuote}
            companyProfile={companyProfile}
            onOpenEmail={() => {
              if (isQuoteEmailSendable(selectedQuote, selectedQuote.id)) {
                setRestoreDetailFocus(false);
                setEmailModalQuote(selectedQuote);
                setSelectedQuoteId("");
              }
            }}
          />
        )}
      </ResponsiveDialog>

      {emailModalQuote && (
        <SendQuoteEmailModal
          businessId={userId}
          open
          quote={emailModalQuote}
          quoteId={emailModalQuote.id}
          companyProfile={companyProfile}
          onClose={() => setEmailModalQuote(null)}
          onSent={(emailPatch, result) =>
            handleEmailSent(emailModalQuote.id, emailPatch, result)
          }
        />
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

function EmailStatusBadge({ quote }) {
  const status = quote.estadoEnvioCorreo || "";

  if (status === "enviado") {
    return (
      <span style={{ ...styles.emailBadge, ...styles.emailSent }}>
        Enviado
      </span>
    );
  }

  if (status === "error") {
    return (
      <span style={{ ...styles.emailBadge, ...styles.emailError }}>
        Error
      </span>
    );
  }

  return <span style={styles.emailMuted}>Sin envío</span>;
}

function QuoteCards({ quotes, selectedQuoteId, onViewDetail }) {
  return (
    <div className="erp-card-list erp-mobile-only" aria-label="Cotizaciones">
      {quotes.map((quote) => (
        <article className="erp-record-card" key={quote.id}>
          <div className="erp-record-card__header">
            <div>
              <h3 className="erp-record-card__title">
                {getQuoteDisplayNumber(quote, quote.id || "-")}
              </h3>
              <p className="erp-record-card__subtitle">
                {quote.clienteNombre || "Cliente sin nombre"}
              </p>
            </div>
            <StatusBadge status={quote.estado} />
          </div>
          <dl className="erp-meta-grid">
            <div className="erp-meta">
              <dt className="erp-meta__label">Fecha</dt>
              <dd className="erp-meta__value">{formatDate(quote.fecha)}</dd>
            </div>
            <div className="erp-meta">
              <dt className="erp-meta__label">Total</dt>
              <dd className="erp-meta__value"><strong>{formatCLP(quote.total)}</strong></dd>
            </div>
            <div className="erp-meta">
              <dt className="erp-meta__label">Correo</dt>
              <dd className="erp-meta__value"><EmailStatusBadge quote={quote} /></dd>
            </div>
            <div className="erp-meta">
              <dt className="erp-meta__label">Ítems</dt>
              <dd className="erp-meta__value">{quote.items?.length || 0}</dd>
            </div>
          </dl>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={selectedQuoteId === quote.id}
            onClick={() => onViewDetail(quote.id)}
            style={styles.cardPrimaryButton}
          >
            Ver detalle
          </button>
        </article>
      ))}
    </div>
  );
}

function QuoteActions({
  quote,
  disabled,
  onChangeStatus,
  onArchive,
  onRestore,
  onEditDraft,
  canDuplicate,
  duplicating,
  onDuplicate,
  onRegisterSale,
  registeringSale,
}) {
  const estado = quote.estado || "borrador";
  const duplicateAction = canDuplicate && estado !== "borrador" ? (
    <button
      type="button"
      onClick={() => onDuplicate(quote)}
      disabled={disabled || duplicating}
      style={styles.secondaryButton}
    >
      {duplicating ? "Creando copia..." : "Duplicar como borrador"}
    </button>
  ) : null;

  if (estado === "borrador") {
    return (
      <>
        <button
          type="button"
          onClick={() => onEditDraft(quote.id)}
          disabled={disabled}
          style={styles.secondaryButton}
        >
          Editar borrador
        </button>
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
        {duplicateAction}
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
        {duplicateAction}
      </>
    );
  }

  if (estado === "aceptada") {
    return (
      <>
        {canDuplicate && (
          <button
            type="button"
            onClick={() => onRegisterSale(quote)}
            disabled={disabled || registeringSale}
            style={styles.acceptButton}
          >
            {quote.ventaId
              ? `Ver venta${quote.ventaNumero ? ` ${quote.ventaNumero}` : ""}`
              : registeringSale ? "Registrando venta..." : "Registrar venta"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onChangeStatus(quote.id, "emitida")}
          disabled={disabled}
          style={styles.secondaryButton}
        >
          Corregir a emitida
        </button>
        <button
          type="button"
          onClick={() => onArchive(quote)}
          disabled={disabled}
          style={styles.archiveButton}
        >
          Archivar
        </button>
        {duplicateAction}
      </>
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
        {duplicateAction}
      </>
    );
  }

  if (estado === "archivada") {
    return (
      <>
        <button
          type="button"
          onClick={() => onRestore(quote)}
          disabled={disabled}
          style={styles.secondaryButton}
        >
          Restaurar
        </button>
        {duplicateAction}
      </>
    );
  }

  return null;
}

function QuoteDetail({ quote, companyProfile, onOpenEmail }) {
  const canSendEmail = isQuoteEmailSendable(quote, quote.id);
  const emailActionHint = getEmailActionHint(quote);
  const [pdfAction, setPdfAction] = useState("");
  const [pdfError, setPdfError] = useState("");

  const runPdfAction = async (action) => {
    setPdfAction(action);
    setPdfError("");
    try {
      if (action === "download") {
        await downloadQuotePdf({ quote, companyProfile });
      } else {
        await shareQuotePdf({ quote, companyProfile });
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        setPdfError(error?.message || "No fue posible preparar el PDF.");
      }
    } finally {
      setPdfAction("");
    }
  };

  return (
    <div className="history-print-area" style={styles.detailPanel}>
      <div className="no-print" style={styles.detailActions}>
        <div style={styles.detailHeading}>
          <h3 style={styles.panelTitle}>Detalle de cotización</h3>
          <p style={styles.helpText}>
            Vista formal para revisión e impresión desde el historial.
          </p>
          {quote.clienteHistoricoNoVinculado && (
            <p className="quote-legacy-client-note">
              Cliente histórico no vinculado a un registro actual.
            </p>
          )}
          <EmailStatusLine quote={quote} />
        </div>
        <div style={styles.detailButtonGroup}>
          <button
            type="button"
            onClick={onOpenEmail}
            disabled={!canSendEmail}
            style={{
              ...styles.emailButton,
              ...(!canSendEmail ? styles.disabledButton : {}),
            }}
          >
            Enviar por correo
          </button>
          <button
            type="button"
            onClick={() => runPdfAction("download")}
            disabled={Boolean(pdfAction)}
            style={styles.printButton}
          >
            {pdfAction === "download" ? "Generando..." : "Descargar PDF"}
          </button>
          <button
            type="button"
            onClick={() => runPdfAction("share")}
            disabled={Boolean(pdfAction)}
            style={styles.printButton}
          >
            {pdfAction === "share" ? "Preparando..." : "Compartir PDF"}
          </button>
        </div>
        {!canSendEmail && emailActionHint && (
          <p className="no-print" style={styles.actionHint}>
            {emailActionHint}
          </p>
        )}
        {pdfError && <p style={styles.actionHint}>{pdfError}</p>}
      </div>

      <div style={styles.detailDocument}>
        <QuotePrintView quote={quote} companyProfile={companyProfile} />
      </div>
    </div>
  );

}

function EmailStatusLine({ quote }) {
  if (!quote.estadoEnvioCorreo || quote.estadoEnvioCorreo === "simulado") {
    return null;
  }

  return (
    <p style={styles.emailStatusLine}>
      Correo: <strong>{quote.estadoEnvioCorreo}</strong>
      {quote.emailClienteDestino ? ` a ${quote.emailClienteDestino}` : ""}
      {quote.fechaEnvioCorreo
        ? ` · ultimo intento ${formatTimestamp(quote.fechaEnvioCorreo)}`
        : ""}
      {quote.ultimoErrorEnvio ? ` · ${quote.ultimoErrorEnvio}` : ""}
    </p>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "18px",
    minWidth: 0,
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
    borderRadius: "4px",
    minWidth: 0,
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
    display: "grid",
    gap: "10px",
    marginBottom: "14px",
  },
  searchInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    fontSize: "13px",
    minWidth: 0,
    padding: "10px 11px",
  },
  select: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    fontSize: "13px",
    padding: "10px 11px",
  },
  tableWrapper: {
    overflowX: "auto",
    minWidth: 0,
  },
  table: {
    borderCollapse: "collapse",
    minWidth: "1180px",
    width: "100%",
  },
  th: {
    background: "#f8fafc",
    borderBottom: "1px solid #e5e7eb",
    color: "#64748b",
    fontSize: "13px",
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
    borderRadius: "4px",
    color: "#334155",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    minHeight: "38px",
    padding: "8px 10px",
  },
  acceptButton: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: "4px",
    color: "#166534",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    minHeight: "38px",
    padding: "8px 10px",
  },
  rejectButton: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "4px",
    color: "#991b1b",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    minHeight: "38px",
    padding: "8px 10px",
  },
  expireButton: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "4px",
    color: "#92400e",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    minHeight: "38px",
    padding: "8px 10px",
  },
  archiveButton: {
    background: "#f8fafc",
    border: "1px solid #d1d5db",
    borderRadius: "4px",
    color: "#4b5563",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    minHeight: "38px",
    padding: "8px 10px",
  },
  printButton: {
    background: "#111827",
    border: 0,
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    minHeight: "40px",
    padding: "10px 12px",
    whiteSpace: "nowrap",
  },
  statusBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "13px",
    fontWeight: 800,
    padding: "4px 9px",
    whiteSpace: "nowrap",
  },
  emailBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "13px",
    fontWeight: 800,
    padding: "4px 8px",
    whiteSpace: "nowrap",
  },
  emailSent: {
    background: "#dcfce7",
    color: "#166534",
  },
  emailSimulated: {
    background: "#fffbeb",
    color: "#92400e",
  },
  emailError: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  emailMuted: {
    color: "#475569",
    fontSize: "13px",
    whiteSpace: "nowrap",
  },
  detailPanel: {
    background: "#ffffff",
    minWidth: 0,
  },
  detailActions: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "14px",
  },
  detailHeading: {
    flex: "1 1 280px",
    minWidth: 0,
  },
  detailButtonGroup: {
    alignItems: "center",
    display: "flex",
    flex: "0 0 auto",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "flex-end",
  },
  emailButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    minHeight: "40px",
    padding: "10px 12px",
    whiteSpace: "nowrap",
  },
  disabledButton: {
    background: "#f1f5f9",
    border: "1px solid #cbd5e1",
    color: "#64748b",
    cursor: "not-allowed",
  },
  actionHint: {
    color: "#64748b",
    flexBasis: "100%",
    fontSize: "13px",
    margin: "4px 0 0",
  },
  emailStatusLine: {
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.4,
    margin: "8px 0 0",
  },
  detailDocument: {
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "auto",
  },
  dialogActions: {
    justifyContent: "flex-end",
    width: "100%",
  },
  cardPrimaryButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    minHeight: "40px",
    padding: "9px 12px",
    width: "100%",
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
    borderRadius: "4px",
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
    borderRadius: "4px",
    color: "#b91c1c",
    margin: 0,
    padding: "11px 13px",
  },
  successText: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    borderRadius: "4px",
    color: "#166534",
    margin: 0,
    padding: "11px 13px",
  },
};

export default QuoteHistoryPage;
