import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  Ellipsis,
  Mail,
  MessageCircle,
  Plus,
  Printer,
  Search,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { sileo } from "sileo";
import QuotePrintView from "../features/quotes/QuotePrintView";
import SendQuoteEmailModal from "../features/quotes/SendQuoteEmailModal";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import { getCompanyProfile } from "../services/companyService";
import {
  canDuplicateQuotes,
  getQuoteStatusLabel,
  QUOTE_STATUS_LABELS,
} from "../domain/quoteModel.mjs";
import {
  createQuoteDuplicateRequestId,
  duplicateQuoteAsDraft,
  getQuoteDisplayNumber,
  getQuotes,
  updateQuoteStatus,
} from "../services/quoteService";
import { isQuoteEmailSendable } from "../services/quoteEmailService";
import {
  confirmQuoteWhatsAppSent,
  prepareQuoteWhatsAppShare,
} from "../services/publicQuoteService";
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

const statusLabels = QUOTE_STATUS_LABELS;

const statusFeedbackTitles = {
  borrador: "Cotización restaurada como pendiente",
  emitida: "Cotización emitida",
  aceptada: "Cotización aceptada",
  rechazada: "Cotización rechazada",
  vencida: "Cotización marcada como vencida",
  archivada: "Cotización archivada",
};

const REJECTION_REASON_LABELS = Object.freeze({
  precio: "Precio",
  plazo: "Plazo",
  requerimiento_cambio: "El requerimiento cambió",
  otra_alternativa: "Eligió otra alternativa",
  otro: "Otro",
  no_indica: "No indicado",
});

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

  if (["aceptada", "rechazada", "vencida"].includes(estado)) {
    return "Sólo las cotizaciones pendientes o emitidas pueden enviarse.";
  }

  return "";
}

function QuoteHistoryPage({ userId, role }) {
  const navigate = useNavigate();
  const location = useLocation();
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
  const [prepareSaleQuote, setPrepareSaleQuote] = useState(null);
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

  useEffect(() => {
    const openQuoteId = String(location.state?.openQuoteId || "");
    if (!openQuoteId || !quotes.some((quote) => quote.id === openQuoteId)) return;

    setRestoreDetailFocus(false);
    setSelectedQuoteId(openQuoteId);
    if (location.state?.createdQuoteNumber) {
      sileo.success({
        title: "Cotización creada",
        description: `${location.state.createdQuoteNumber} está pendiente. Aún no ha sido enviada al cliente.`,
      });
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, quotes]);

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
    const {
      confirm = true,
      estadoAnterior,
      notify = true,
      successTitle,
    } = options;

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
      const statusPatch = await updateQuoteStatus(
        userId,
        quoteId,
        estado,
        { estadoAnterior }
      );
      setQuotes((prev) =>
        prev.map((quote) =>
          quote.id === quoteId
            ? {
                ...quote,
                ...statusPatch,
                estado,
                ...(estadoAnterior ? { estadoAnterior } : {}),
                actualizadoEn: new Date(),
              }
            : quote
        )
      );
      if (notify) {
        sileo.success({
          title: successTitle || statusFeedbackTitles[estado],
        });
      }
      return true;
    } catch (err) {
      console.error("Error al actualizar estado:", err);
      const message = err.message || "No se pudo actualizar el estado.";
      setError(message);
      sileo.error({
        title: "No se pudo actualizar la cotización",
        description: message,
      });
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
      successTitle: "Cotización archivada",
    });
    if (!updated) return;
  };

  const handleRestoreQuote = async (quote) => {
    const canRestorePreviousState =
      statusLabels[quote.estadoAnterior] && quote.estadoAnterior !== "archivada";
    const estadoRestaurado = canRestorePreviousState
      ? quote.estadoAnterior
      : "borrador";
    await handleChangeStatus(quote.id, estadoRestaurado, {
      successTitle: "Cotización restaurada",
    });
  };

  const handleEditDraft = (quoteId) => {
    navigate(`/cotizaciones/${quoteId}/editar`);
  };

  const handleOpenSale = (quote) => {
    if (!quote?.ventaId) return;
    navigate(`/ventas/${quote.ventaId}/editar`);
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
        state: {message: "Copia creada como pendiente."},
      });
    } catch (duplicateError) {
      const message =
        duplicateError.message || "No se pudo duplicar la cotización.";
      setError(message);
      sileo.error({
        title: "No se pudo duplicar la cotización",
        description: message,
      });
    } finally {
      setDuplicatingQuoteId("");
    }
  };

  const handleRegisterSale = async (quote, options = {}) => {
    const { navigateAfterCreate = false } = options;

    if (quote.ventaId) {
      navigate(`/ventas/${quote.ventaId}/editar`);
      return null;
    }
    const requestId = saleRequestIdsRef.current.get(quote.id) ||
      createSaleRequestId("sale-quote");
    saleRequestIdsRef.current.set(quote.id, requestId);
    setRegisteringSaleQuoteId(quote.id);
    setError("");
    setSuccess("");
    try {
      const result = await sileo.promise(
        crearVentaDesdeCotizacion(userId, quote.id, {requestId}),
        {
          loading: {
            title: "Preparando venta...",
            description: "Creando la venta en borrador.",
          },
          success: (created) => ({
            title: "Venta preparada",
            description: `${created.venta.numero} fue preparada desde ${getQuoteDisplayNumber(
              quote,
              quote.id || "-"
            )}.`,
            button: {
              title: "Abrir venta",
              onClick: () => navigate(`/ventas/${created.venta.id}/editar`),
            },
          }),
          error: (saleError) => ({
            title: "No se pudo preparar la venta",
            description:
              saleError?.message || "Puedes volver a intentarlo desde la cotización aceptada.",
          }),
        }
      );
      saleRequestIdsRef.current.delete(quote.id);
      setQuotes((current) => current.map((item) => item.id === quote.id
        ? {...item, ventaId: result.venta.id, ventaNumero: result.venta.numero}
        : item));
      if (navigateAfterCreate) {
        navigate(`/ventas/${result.venta.id}/editar`, {
          state: {message: "Venta creada como borrador desde la cotización."},
        });
      }
      return result;
    } catch (saleError) {
      setError(saleError.message || "No se pudo registrar la venta.");
      return null;
    } finally {
      setRegisteringSaleQuoteId("");
    }
  };

  const handleAcceptAndPrepareSale = async (quote) => {
    if (quote.ventaId) return;
    setPrepareSaleQuote(quote);
  };

  const handleConfirmPrepareSale = async () => {
    const currentQuote = quotes.find(
      (quote) => quote.id === prepareSaleQuote?.id
    );
    const quote = currentQuote || prepareSaleQuote;
    if (!quote || quote.ventaId) {
      setPrepareSaleQuote(null);
      return;
    }

    const accepted = await handleChangeStatus(quote.id, "aceptada", {
      confirm: false,
      notify: false,
    });

    if (!accepted) {
      setPrepareSaleQuote(null);
      return;
    }

    await handleRegisterSale(
      { ...quote, estado: "aceptada" },
      { navigateAfterCreate: false }
    );
    setPrepareSaleQuote(null);
  };

  const handleEmailSent = (quoteId, emailPatch) => {
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

  };

  const handleWhatsAppShared = (quoteId, statusPatch) => {
    setQuotes((current) => current.map((quote) => quote.id === quoteId
      ? { ...quote, ...statusPatch, actualizadoEn: new Date() }
      : quote));
  };

  if (!userId) {
    return (
      <section className="page-section">
        <p style={styles.errorText}>Debes iniciar sesión para ver cotizaciones.</p>
      </section>
    );
  }

  return (
    <section className="quote-history-page erp-page">
      <div className="no-print erp-module-intro">
        <div className="erp-page-intro">
          <p>Consulta y administra las cotizaciones del negocio.</p>
        </div>
        {canDuplicate && (
          <Button type="button" icon={Plus} onClick={() => navigate("/cotizaciones/nueva")}>
            Nueva cotización
          </Button>
        )}
      </div>

      {error && <div className="no-print client-message client-message--error" role="alert">{error}</div>}
      {success && <div className="no-print client-message" role="status">{success}</div>}

      <div className="no-print erp-panel erp-history-panel quote-history-list-panel">
        <div className="erp-panel-header">
          <div>
            <h2 className="erp-panel-title">Cotizaciones registradas</h2>
            <p className="erp-secondary-text">{filteredQuotes.length} de {quotes.length} cotizaciones</p>
          </div>
        </div>

        <div className="erp-filters erp-history-filters erp-history-filters--two clients-filters quote-history-filters">
          <label className="erp-field erp-history-search-field">
            <span className="erp-field__label">Buscar por número o cliente</span>
            <span className="clients-search-control">
              <AppIcon icon={Search} size={18} />
              <input
                className="erp-control"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ej.: COT-2026-0001 o cliente"
              />
            </span>
          </label>
          <label className="erp-field">
            <span className="erp-field__label">Estado</span>
            <select
              className="erp-control"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
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
          <div className="erp-empty-state" role="status">Cargando cotizaciones...</div>
        ) : quotes.length === 0 ? (
          <div className="erp-empty-state quote-history-empty">
            <h3>No hay cotizaciones guardadas</h3>
            <p>Crea una nueva cotización para comenzar.</p>
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="erp-empty-state">No hay cotizaciones con esos filtros.</div>
        ) : (
          <>
          <div className="erp-table-region erp-desktop-only">
            <table className="erp-table clients-table quote-history-table">
              <thead>
                <tr>
                  <th className="quote-history-table__number">Número</th>
                  <th className="quote-history-table__client">Cliente</th>
                  <th className="quote-history-table__status">Estado</th>
                  <th className="quote-history-table__total">Total</th>
                  <th className="quote-history-table__sale">Venta</th>
                  <th className="quote-history-table__updated">Actualización</th>
                  <th className="quote-history-table__actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className={quote.id === selectedQuoteId ? "quote-history-table__row--selected" : undefined}
                  >
                    <td>
                      <button
                        type="button"
                        className="quote-record-link"
                        aria-haspopup="dialog"
                        aria-expanded={quote.id === selectedQuoteId}
                        onClick={() => handleToggleDetail(quote.id)}
                      >
                        {getQuoteDisplayNumber(quote, quote.id || "-")}
                      </button>
                    </td>
                    <td
                      className="quote-history-table__client-cell"
                      title={quote.clienteNombre || ""}
                    >
                      {quote.clienteNombre || "-"}
                    </td>
                    <td>
                      <StatusBadge status={quote.estado} />
                    </td>
                    <td className="quote-history-table__total">
                      <strong>{formatCLP(quote.total)}</strong>
                    </td>
                    <td>
                      {quote.ventaId && quote.ventaNumero ? (
                        <button
                          type="button"
                          className="quote-record-link"
                          onClick={() => handleOpenSale(quote)}
                        >
                          {quote.ventaNumero}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {formatTimestamp(getQuoteTimestamp(quote))}
                    </td>
                    <td className="quote-history-table__actions">
                      <div style={styles.rowActions}>
                        {canDuplicate && (
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
                          onAcceptAndPrepareSale={handleAcceptAndPrepareSale}
                          onRegisterSale={handleRegisterSale}
                          registeringSale={registeringSaleQuoteId === quote.id}
                        /> )}
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
            onOpenSale={handleOpenSale}
            onViewDetail={handleToggleDetail}
            canDuplicate={canDuplicate}
            disabled={savingStatus}
            duplicatingQuoteId={duplicatingQuoteId}
            onAcceptAndPrepareSale={handleAcceptAndPrepareSale}
            onArchive={handleArchiveQuote}
            onChangeStatus={handleChangeStatus}
            onDuplicate={handleDuplicateQuote}
            onEditDraft={handleEditDraft}
            onRegisterSale={handleRegisterSale}
            onRestore={handleRestoreQuote}
            registeringSaleQuoteId={registeringSaleQuoteId}
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
            {canDuplicate && (
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
              onAcceptAndPrepareSale={handleAcceptAndPrepareSale}
              onRegisterSale={handleRegisterSale}
              registeringSale={registeringSaleQuoteId === selectedQuote.id}
            /> )}
          </div>
        ) : null}
      >
        {selectedQuote && (
          <QuoteDetail
            businessId={userId}
            canSendByEmail={canDuplicate}
            quote={selectedQuote}
            companyProfile={companyProfile}
            onWhatsAppShared={handleWhatsAppShared}
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

      <ResponsiveDialog
        open={Boolean(prepareSaleQuote)}
        onClose={() => {
          if (!savingStatus && !registeringSaleQuoteId) {
            setPrepareSaleQuote(null);
          }
        }}
        size="small"
        eyebrow="Cotizaciones"
        title="Preparar venta"
        description={
          prepareSaleQuote
            ? `Se creará una venta en borrador a partir de la cotización ${getQuoteDisplayNumber(
                prepareSaleQuote,
                prepareSaleQuote.id || "-"
              )}.`
            : ""
        }
        footer={
          <div className="erp-actions" style={styles.prepareSaleActions}>
            <Button
              type="button"
              variant="secondary"
              disabled={savingStatus || Boolean(registeringSaleQuoteId)}
              onClick={() => setPrepareSaleQuote(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={savingStatus || Boolean(registeringSaleQuoteId)}
              onClick={handleConfirmPrepareSale}
            >
              {savingStatus || registeringSaleQuoteId
                ? "Creando venta..."
                : "Crear venta en borrador"}
            </Button>
          </div>
        }
      >
        <p style={styles.prepareSaleNotice}>
          Podrás revisarla antes de confirmarla. El inventario no se descontará
          todavía.
        </p>
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
      className="ui-status-badge quote-history-status"
      style={{
        ...statusStyles[normalizedStatus],
      }}
    >
      {getQuoteStatusLabel(normalizedStatus)}
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

  if (status === "simulado") {
    return (
      <span style={{ ...styles.emailBadge, ...styles.emailSimulated }}>
        Simulación QA
      </span>
    );
  }

  return <span style={styles.emailMuted}>Sin envío</span>;
}

function QuoteCards({
  quotes,
  selectedQuoteId,
  onOpenSale,
  onViewDetail,
  canDuplicate,
  disabled,
  duplicatingQuoteId,
  onAcceptAndPrepareSale,
  onArchive,
  onChangeStatus,
  onDuplicate,
  onEditDraft,
  onRegisterSale,
  onRestore,
  registeringSaleQuoteId,
}) {
  return (
    <div className="erp-card-list erp-mobile-only" aria-label="Cotizaciones">
      {quotes.map((quote) => (
        <article className="erp-record-card" key={quote.id}>
          <div className="erp-record-card__header">
            <div>
              <h3 className="erp-record-card__title">
                <button
                  type="button"
                  className="quote-record-link"
                  aria-haspopup="dialog"
                  aria-expanded={selectedQuoteId === quote.id}
                  onClick={() => onViewDetail(quote.id)}
                >
                  {getQuoteDisplayNumber(quote, quote.id || "-")}
                </button>
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
            <div className="erp-meta">
              <dt className="erp-meta__label">Venta</dt>
              <dd className="erp-meta__value">
                {quote.ventaId && quote.ventaNumero ? (
                  <button
                    type="button"
                    className="quote-record-link"
                    onClick={() => onOpenSale(quote)}
                  >
                    {quote.ventaNumero}
                  </button>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          {canDuplicate && (
            <div className="erp-actions" style={styles.mobileCardActions}>
              <QuoteActions
                quote={quote}
                disabled={disabled}
                onChangeStatus={onChangeStatus}
                onArchive={onArchive}
                onRestore={onRestore}
                onEditDraft={onEditDraft}
                canDuplicate={canDuplicate}
                duplicating={duplicatingQuoteId === quote.id}
                onDuplicate={onDuplicate}
                onAcceptAndPrepareSale={onAcceptAndPrepareSale}
                onRegisterSale={onRegisterSale}
                registeringSale={registeringSaleQuoteId === quote.id}
              />
            </div>
          )}
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
  onAcceptAndPrepareSale,
  onRegisterSale,
  registeringSale,
}) {
  const estado = quote.estado || "borrador";
  const duplicateMenuAction = canDuplicate && estado !== "borrador"
    ? {
        label: duplicating ? "Creando copia..." : "Duplicar como pendiente",
        disabled: disabled || duplicating,
        onSelect: () => onDuplicate(quote),
      }
    : null;
  const archiveMenuAction = {
    label: "Archivar",
    disabled,
    onSelect: () => onArchive(quote),
  };

  if (quote.ventaId) {
    const linkedSaleActions = [
      duplicateMenuAction,
      estado !== "archivada" ? archiveMenuAction : null,
    ].filter(Boolean);

    return (
      <>
        {estado === "archivada" && (
          <button
            type="button"
            onClick={() => onRestore(quote)}
            disabled={disabled}
            style={styles.secondaryButton}
          >
            Restaurar
          </button>
        )}
        {linkedSaleActions.length > 0 && (
          <MoreActionsMenu
            disabled={disabled || duplicating}
            actions={linkedSaleActions}
          />
        )}
      </>
    );
  }

  if (estado === "borrador") {
    return (
      <>
        <button
          type="button"
          onClick={() => onEditDraft(quote.id)}
          disabled={disabled}
          style={styles.secondaryButton}
        >
          Editar cotización
        </button>
        <button
          type="button"
          onClick={() => onChangeStatus(quote.id, "emitida")}
          disabled={disabled}
          style={styles.primaryButton}
          title="Indica que la cotización fue enviada al cliente. Todavía no registra una venta."
        >
          Marcar como emitida
        </button>
        <MoreActionsMenu
          actions={[archiveMenuAction]}
          disabled={disabled}
        />
      </>
    );
  }

  if (estado === "emitida") {
    return (
      <>
        <button
          type="button"
          onClick={() => onAcceptAndPrepareSale(quote)}
          disabled={disabled || registeringSale}
          style={styles.primaryButton}
        >
          {registeringSale
            ? "Preparando venta..."
            : "Aceptar y preparar venta"}
        </button>
        <MoreActionsMenu
          disabled={disabled || registeringSale}
          actions={[
            {
              label: "Rechazar",
              onSelect: () => onChangeStatus(quote.id, "rechazada"),
            },
            {
              label: "Marcar vencida",
              onSelect: () => onChangeStatus(quote.id, "vencida"),
            },
            duplicateMenuAction,
            archiveMenuAction,
          ].filter(Boolean)}
        />
      </>
    );
  }

  if (estado === "aceptada") {
    return (
      <>
        {canDuplicate && !quote.ventaId && (
          <button
            type="button"
            onClick={() => onRegisterSale(quote)}
            disabled={disabled || registeringSale}
            style={styles.primaryButton}
            title="Crea una venta en borrador. Todavía no descuenta stock."
          >
            {registeringSale ? "Preparando venta..." : "Preparar venta"}
          </button>
        )}
        <MoreActionsMenu
          disabled={disabled || registeringSale}
          actions={[
            {
              label: "Corregir a emitida",
              onSelect: () => onChangeStatus(quote.id, "emitida"),
            },
            duplicateMenuAction,
            archiveMenuAction,
          ].filter(Boolean)}
        />
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
        <MoreActionsMenu
          disabled={disabled}
          actions={[duplicateMenuAction, archiveMenuAction].filter(Boolean)}
        />
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
        {duplicateMenuAction && (
          <MoreActionsMenu
            disabled={disabled || duplicating}
            actions={[duplicateMenuAction]}
          />
        )}
      </>
    );
  }

  return null;
}

function MoreActionsMenu({ actions, disabled }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const itemRefs = useRef([]);
  const menuId = React.useId();

  useEffect(() => {
    if (!open) return undefined;

    const closeMenu = () => setOpen(false);
    const handlePointerDown = (event) => {
      if (
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        closeMenu();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu();
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [open]);

  const openMenu = (focusLast = false) => {
    const trigger = triggerRef.current;
    if (!trigger || disabled) return;

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 224;
    const estimatedHeight = actions.length * 42 + 12;
    const left = Math.max(
      8,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)
    );
    const below = rect.bottom + 6;
    const top = below + estimatedHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - estimatedHeight - 6);

    setPosition({ left, top });
    setOpen(true);
    window.requestAnimationFrame(() => {
      const availableItems = itemRefs.current.filter(
        (item) => item && !item.disabled
      );
      const targetIndex = focusLast ? availableItems.length - 1 : 0;
      availableItems[targetIndex]?.focus();
    });
  };

  const handleMenuKeyDown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const availableItems = itemRefs.current.filter(
      (item) => item && !item.disabled
    );
    if (!availableItems.length) return;
    const currentIndex = availableItems.indexOf(document.activeElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? availableItems.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1 + availableItems.length) % availableItems.length
          : (currentIndex - 1 + availableItems.length) % availableItems.length;
    availableItems[nextIndex]?.focus();
  };

  const handleSelect = (action) => {
    setOpen(false);
    triggerRef.current?.focus();
    action.onSelect();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            openMenu(event.key === "ArrowUp");
          }
        }}
        style={styles.moreActionsButton}
      >
        <span>Más acciones</span>
        <AppIcon icon={Ellipsis} size={17} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="Más acciones de cotización"
          onKeyDown={handleMenuKeyDown}
          style={{ ...styles.actionsMenu, ...position }}
        >
          {actions.map((action, index) => (
            <button
              key={action.label}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => handleSelect(action)}
              style={styles.actionsMenuItem}
            >
              {action.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function QuoteDetail({
  businessId,
  quote,
  companyProfile,
  canSendByEmail,
  onOpenEmail,
  onWhatsAppShared,
}) {
  const canSendEmail = isQuoteEmailSendable(quote, quote.id);
  const canShareWhatsApp = ["borrador", "emitida"].includes(quote.estado);
  const emailActionHint = getEmailActionHint(quote);
  const [pdfAction, setPdfAction] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [whatsAppConfirmationOpen, setWhatsAppConfirmationOpen] = useState(false);
  const [confirmingWhatsApp, setConfirmingWhatsApp] = useState(false);

  const runPdfAction = async (action) => {
    setPdfAction(action);
    setPdfError("");
    try {
      if (action === "download") {
        await downloadQuotePdf({ quote, companyProfile });
      } else {
        const prepared = await prepareQuoteWhatsAppShare(businessId, quote.id);
        await shareQuotePdf({
          quote,
          companyProfile,
          publicUrl: prepared.publicUrl,
        });
        setWhatsAppConfirmationOpen(true);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        const message = error?.message || "No fue posible preparar el PDF.";
        setPdfError(message);
        sileo.error({
          title: action === "download"
            ? "No se pudo descargar el PDF"
            : "No se pudo preparar WhatsApp",
          description: message,
        });
      }
    } finally {
      setPdfAction("");
    }
  };

  const confirmWhatsAppSent = async () => {
    setConfirmingWhatsApp(true);
    setPdfError("");
    try {
      const statusPatch = await confirmQuoteWhatsAppSent(businessId, quote.id);
      onWhatsAppShared?.(quote.id, statusPatch);
      setWhatsAppConfirmationOpen(false);
      sileo.success({
        title: "Cotización emitida",
        description: `${getQuoteDisplayNumber(quote, quote.id)} fue registrada como enviada por WhatsApp.`,
      });
    } catch (error) {
      const message = error?.message || "No fue posible registrar el envío.";
      setPdfError(message);
      sileo.error({
        title: "No se pudo registrar el envío",
        description: message,
      });
    } finally {
      setConfirmingWhatsApp(false);
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
          <CommercialStatusTimeline quote={quote} />
        </div>
        <div style={styles.detailButtonGroup}>
          {canSendByEmail && (
            <button
              type="button"
              onClick={() => runPdfAction("whatsapp")}
              disabled={Boolean(pdfAction) || !canShareWhatsApp}
              title={canShareWhatsApp ? "" : "Sólo disponible para cotizaciones pendientes o emitidas."}
              style={styles.whatsappButton}
            >
              <AppIcon icon={MessageCircle} size={17} />
              {pdfAction === "whatsapp" ? "Preparando..." : "WhatsApp"}
            </button>
          )}
          {canSendByEmail && (
          <button
            type="button"
            onClick={onOpenEmail}
            disabled={!canSendEmail}
            style={{
              ...styles.emailButton,
              ...(!canSendEmail ? styles.disabledButton : {}),
            }}
          >
            <AppIcon icon={Mail} size={17} />
            Correo
          </button> )}
          <button
            type="button"
            onClick={() => runPdfAction("download")}
            disabled={Boolean(pdfAction)}
            style={styles.printButton}
          >
            <AppIcon icon={Download} size={17} />
            {pdfAction === "download" ? "Generando..." : "Descargar PDF"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            style={styles.secondaryDocumentButton}
          >
            <AppIcon icon={Printer} size={17} />
            Imprimir
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

      <ResponsiveDialog
        open={whatsAppConfirmationOpen}
        onClose={() => {
          if (!confirmingWhatsApp) setWhatsAppConfirmationOpen(false);
        }}
        size="small"
        eyebrow="WhatsApp"
        title="¿Enviaste la cotización?"
        description="Si completaste el envío por WhatsApp, registra la cotización como emitida. Si cancelaste o todavía no la enviaste, puedes mantenerla pendiente."
        footer={(
          <div className="erp-actions" style={styles.prepareSaleActions}>
            <Button
              type="button"
              variant="secondary"
              disabled={confirmingWhatsApp}
              onClick={() => setWhatsAppConfirmationOpen(false)}
            >
              Mantener pendiente
            </Button>
            <Button
              type="button"
              disabled={confirmingWhatsApp}
              onClick={confirmWhatsAppSent}
            >
              {confirmingWhatsApp ? "Registrando..." : "Sí, fue enviada"}
            </Button>
          </div>
        )}
      />
    </div>
  );

}

function CommercialStatusTimeline({ quote }) {
  const events = [];
  if (quote.whatsappPreparadoEn && quote.estado === "borrador") {
    events.push({
      label: "Preparada para WhatsApp",
      value: formatTimestamp(quote.whatsappPreparadoEn),
      note: "Todavía pendiente de confirmación de envío",
    });
  }
  if (quote.canalEmision === "whatsapp" && quote.fechaEmision) {
    events.push({
      label: quote.emisionDetectadaPor === "apertura_cliente"
        ? "Emitida al detectar apertura del cliente"
        : "Emitida por WhatsApp",
      value: formatTimestamp(quote.fechaEmision),
    });
  }
  if (quote.estadoEnvioCorreo === "simulado") {
    const destinationEmail = String(quote.emailClienteDestino || "").trim();
    const simulationDate = quote.fechaEnvioCorreo
      ? `Fecha de simulación: ${formatTimestamp(quote.fechaEnvioCorreo)}`
      : "";
    const testRecipient = destinationEmail
      ? `Destinatario de prueba: ${destinationEmail}`
      : "";
    events.push({
      label: "Simulación de correo — QA local",
      value: "No se envió un correo real.",
      note: [simulationDate, testRecipient].filter(Boolean).join(" · "),
    });
  }
  if (quote.estadoEnvioCorreo === "enviado") {
    const destinationEmail = String(quote.emailClienteDestino || "").trim();
    const originalEmail = String(
      quote.correoOriginalCliente ||
        quote.cliente?.email ||
        quote.clienteSnapshot?.email ||
        quote.clienteEmail ||
        ""
    ).trim();
    const destinationNote = destinationEmail
      ? quote.destinatarioAlternativo
        ? `Destinatario alternativo: ${destinationEmail}${
            originalEmail ? ` · Correo asociado: ${originalEmail}` : ""
          }`
        : `Destinatario: ${destinationEmail}`
      : "Destinatario no disponible";
    const providerNote = `Proveedor: ${quote.proveedorCorreo || "no disponible"}`;
    events.push({
      label: "Enviada por correo",
      value: quote.fechaEnvioCorreo
        ? formatTimestamp(quote.fechaEnvioCorreo)
        : "Fecha no disponible",
      note: `${destinationNote} · ${providerNote}`,
    });
  }
  if (quote.propuestaPublicaVistaEn) {
    events.push({
      label: "Vista por cliente",
      value: formatTimestamp(quote.propuestaPublicaVistaEn),
    });
  }
  if (
    quote.respuestaClienteOrigen === "portal_publico" &&
    ["aceptada", "rechazada"].includes(quote.respuestaCliente)
  ) {
    const rejectedByClient = quote.respuestaCliente === "rechazada";
    const rejectionReason = REJECTION_REASON_LABELS[
      String(quote.motivoRechazoCliente || "").trim()
    ] || "No indicado";
    const rejectionComment = String(
      quote.comentarioRechazoCliente || ""
    ).trim();
    events.push({
      label: !rejectedByClient
        ? "Aceptada por cliente"
        : "Rechazada por cliente",
      value: quote.respuestaClienteEn
        ? formatTimestamp(quote.respuestaClienteEn)
        : "Respuesta registrada",
      note: rejectedByClient ? "" : "Respuesta registrada por el cliente",
      details: rejectedByClient
        ? [
            { label: "Motivo", value: rejectionReason },
            {
              label: "Comentario del cliente",
              value: rejectionComment || "Sin comentario adicional",
              quoted: Boolean(rejectionComment),
            },
          ]
        : [],
    });
  } else if (
    quote.estadoEnvioCorreo === "enviado" &&
    !quote.respuestaCliente &&
    quote.estado !== "vencida"
  ) {
    events.push({ label: "Sin respuesta", value: "Pendiente del cliente" });
  }
  if (quote.vencidaAutomaticamente) {
    events.push({
      label: "Vencida automáticamente",
      value: quote.vencidaEn ? formatTimestamp(quote.vencidaEn) : "Vencida",
    });
  }
  if (quote.estadoEnvioCorreo === "error") {
    events.push({
      label: "Error de envío",
      value: quote.ultimoErrorEnvio || "No fue posible enviar el correo",
    });
  }
  if (!events.length) return null;

  return (
    <section style={styles.commercialStatus} aria-label="Estado comercial">
      <strong style={styles.commercialStatusTitle}>Estado comercial</strong>
      <div style={styles.commercialStatusGrid}>
        {events.map((event) => (
          <div key={`${event.label}-${event.value}`} style={styles.commercialStatusEvent}>
            <span style={styles.commercialStatusLabel}>{event.label}</span>
            <span style={styles.commercialStatusValue}>{event.value}</span>
            {event.note && <small style={styles.commercialStatusNote}>{event.note}</small>}
            {event.details?.length > 0 && (
              <div style={styles.commercialStatusDetails}>
                {event.details.map((detail) => (
                  <div key={detail.label} style={styles.commercialStatusDetail}>
                    <strong style={styles.commercialStatusDetailLabel}>
                      {detail.label}:
                    </strong>
                    <span style={styles.commercialStatusDetailValue}>
                      {detail.quoted ? `“${detail.value}”` : detail.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const styles = {
  commercialStatus: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    display: "grid",
    gap: "8px",
    marginTop: "12px",
    padding: "11px 12px",
  },
  commercialStatusTitle: {
    color: "#0f172a",
    fontSize: "13px",
  },
  commercialStatusGrid: {
    display: "grid",
    gap: "8px",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  },
  commercialStatusEvent: {
    borderLeft: "2px solid #0f766e",
    display: "grid",
    gap: "2px",
    paddingLeft: "8px",
  },
  commercialStatusLabel: {
    color: "#334155",
    fontSize: "12px",
    fontWeight: 700,
  },
  commercialStatusValue: {
    color: "#64748b",
    fontSize: "12px",
  },
  commercialStatusNote: {
    color: "#0f766e",
    fontSize: "11px",
    fontWeight: 700,
  },
  commercialStatusDetails: {
    display: "grid",
    gap: "6px",
    marginTop: "4px",
  },
  commercialStatusDetail: {
    display: "grid",
    gap: "1px",
  },
  commercialStatusDetailLabel: {
    color: "#334155",
    fontSize: "11px",
  },
  commercialStatusDetailValue: {
    color: "#475569",
    fontSize: "12px",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
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
  rowActions: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    minWidth: 0,
  },
  mobileCardActions: {
    marginTop: "12px",
  },
  primaryButton: {
    background: "#0f766e",
    border: "1px solid #0f766e",
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    minHeight: "38px",
    padding: "8px 11px",
  },
  moreActionsButton: {
    alignItems: "center",
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    color: "#334155",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "13px",
    fontWeight: 700,
    gap: "6px",
    minHeight: "38px",
    padding: "8px 10px",
  },
  actionsMenu: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.18)",
    display: "grid",
    gap: "2px",
    padding: "6px",
    position: "fixed",
    width: "224px",
    zIndex: 1300,
  },
  actionsMenuItem: {
    background: "transparent",
    border: 0,
    borderRadius: "4px",
    color: "#334155",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    minHeight: "40px",
    padding: "9px 10px",
    textAlign: "left",
    width: "100%",
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
  printButton: {
    alignItems: "center",
    background: "#111827",
    border: 0,
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "13px",
    fontWeight: 800,
    gap: "6px",
    minHeight: "40px",
    padding: "10px 12px",
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
    alignItems: "center",
    background: "#0f766e",
    border: 0,
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "13px",
    fontWeight: 800,
    gap: "6px",
    minHeight: "40px",
    padding: "10px 12px",
    whiteSpace: "nowrap",
  },
  whatsappButton: {
    alignItems: "center",
    background: "#128c7e",
    border: 0,
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "13px",
    fontWeight: 800,
    gap: "6px",
    minHeight: "40px",
    padding: "10px 12px",
    whiteSpace: "nowrap",
  },
  secondaryDocumentButton: {
    alignItems: "center",
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    color: "#334155",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "13px",
    fontWeight: 800,
    gap: "6px",
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
  detailDocument: {
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "auto",
  },
  dialogActions: {
    justifyContent: "flex-end",
    width: "100%",
  },
  prepareSaleActions: {
    justifyContent: "flex-end",
    width: "100%",
  },
  prepareSaleNotice: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: "6px",
    color: "#1e3a8a",
    lineHeight: 1.5,
    margin: 0,
    padding: "12px 14px",
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
  errorText: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "4px",
    color: "#b91c1c",
    margin: 0,
    padding: "11px 13px",
  },
};

export default QuoteHistoryPage;
