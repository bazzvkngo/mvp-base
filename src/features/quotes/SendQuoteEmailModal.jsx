import React, { useEffect, useMemo, useState } from "react";
import {
  buildDefaultQuoteEmail,
  buildMailtoUrl,
  buildManualQuoteEmail,
  isQuoteEmailSendable,
  isValidEmail,
  sendQuoteEmail,
} from "../../services/quoteEmailService";
import { getQuoteDisplayNumber } from "../../services/quoteService";
import {
  buildQuotePdfAttachment,
  downloadQuotePdf,
  getQuotePdfFileName,
} from "../../utils/quotePdf";
import { formatCLP } from "../../utils/formatters";

function SendQuoteEmailModal({
  businessId,
  open,
  quote,
  quoteId,
  companyProfile,
  onClose,
  onSent,
}) {
  const defaults = useMemo(
    () => buildDefaultQuoteEmail({ quote, companyProfile }),
    [companyProfile, quote]
  );
  const manualMessage = useMemo(
    () => buildManualQuoteEmail({ quote }),
    [quote]
  );
  const canSendQuote = isQuoteEmailSendable(quote, quoteId);
  const pdfFileName = useMemo(() => getQuotePdfFileName(quote), [quote]);
  const [emailCliente, setEmailCliente] = useState(defaults.emailCliente);
  const [asunto, setAsunto] = useState(defaults.asunto);
  const [mensaje, setMensaje] = useState(defaults.mensaje);
  const [sending, setSending] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pdfReady, setPdfReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmailCliente(defaults.emailCliente);
    setAsunto(defaults.asunto);
    setMensaje(defaults.mensaje);
    setError("");
    setSuccess("");
    setPdfReady(false);
  }, [defaults, open]);

  useEffect(() => {
    if (!open || !quote || !canSendQuote) {
      setPdfReady(false);
      return undefined;
    }

    let active = true;
    setPdfReady(false);
    buildQuotePdfAttachment({ quote, companyProfile })
      .then((attachment) => {
        if (active) {
          setPdfReady(Boolean(attachment?.contentBase64));
        }
      })
      .catch((err) => {
        console.error("No se pudo preparar la vista previa del PDF.", err);
        if (active) setPdfReady(false);
      });

    return () => {
      active = false;
    };
  }, [canSendQuote, companyProfile, open, quote]);

  if (!open || !quote) return null;

  const mailtoUrl = buildMailtoUrl({
    emailCliente,
    asunto,
    mensaje: manualMessage,
  });

  const handleDownloadPdf = async () => {
    setError("");
    setSuccess("");
    setDownloadingPdf(true);

    try {
      await downloadQuotePdf({ quote, companyProfile });
    } catch (err) {
      console.error("Error descargando PDF de cotización:", err);
      setError("No fue posible descargar el PDF de la cotización.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleSubmit = async () => {
    setError("");
    setSuccess("");

    if (!quoteId) {
      setError("Guarda la cotizacion antes de enviarla por correo.");
      return;
    }
    if (!canSendQuote) {
      setError("Emite la cotización antes de enviarla al cliente.");
      return;
    }
    if (!isValidEmail(emailCliente)) {
      setError("Ingresa un correo de cliente valido.");
      return;
    }
    if (!asunto.trim()) {
      setError("Ingresa el asunto del correo.");
      return;
    }
    if (!mensaje.trim()) {
      setError("Ingresa el mensaje del correo.");
      return;
    }

    let pdfAttachment = null;
    setSending(true);
    try {
      pdfAttachment = await buildQuotePdfAttachment({ quote, companyProfile });
    } catch (err) {
      console.error("Error generando PDF de cotización:", err);
      setError("No fue posible adjuntar el PDF de la cotización. Intenta nuevamente.");
      setSending(false);
      return;
    }

    if (!pdfAttachment?.contentBase64) {
      console.error("PDF de cotización vacío o inválido.");
      setError("No fue posible adjuntar el PDF de la cotización. Intenta nuevamente.");
      setSending(false);
      return;
    }

    try {
      const result = await sendQuoteEmail({
        businessId,
        quoteId,
        emailCliente,
        asunto,
        mensaje,
        pdfAttachment,
      });

      if (onSent) {
        onSent(result.quoteEmailStatus, result);
      }

      if (!result.success) {
        setError(
          result.error ||
            "No fue posible enviar la cotización. Puedes utilizar el respaldo manual."
        );
        return;
      }

      setSuccess(`Cotización enviada correctamente a ${emailCliente}.`);
    } catch (err) {
      console.error("Error enviando cotizacion por correo:", err);
      const errorMessage = String(err?.message || "");
      setError(
        /PDF adjunto|application\/pdf|formato valido/i.test(errorMessage)
          ? "No fue posible adjuntar el PDF de la cotización. Intenta nuevamente."
          : errorMessage ||
          "No fue posible enviar la cotización. Puedes utilizar el respaldo manual."
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={styles.overlay} role="presentation">
      <div style={styles.modal} role="dialog" aria-modal="true">
        <div style={styles.header}>
          <div>
            <span style={styles.eyebrow}>Envio al cliente</span>
            <h3 style={styles.title}>Enviar por correo</h3>
          </div>
          <button type="button" onClick={onClose} style={styles.closeButton}>
            Cerrar
          </button>
        </div>

        <div style={styles.grid}>
          <section style={styles.formSection}>
            <label style={styles.field}>
              <span style={styles.label}>Correo del cliente</span>
              <input
                type="email"
                value={emailCliente}
                onChange={(event) => setEmailCliente(event.target.value)}
                style={styles.input}
                placeholder="cliente@empresa.cl"
              />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>Asunto</span>
              <input
                value={asunto}
                onChange={(event) => setAsunto(event.target.value)}
                style={styles.input}
              />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>Mensaje editable</span>
              <textarea
                value={mensaje}
                onChange={(event) => setMensaje(event.target.value)}
                style={styles.textarea}
              />
            </label>
          </section>

          <aside style={styles.summary}>
            <h4 style={styles.summaryTitle}>Resumen de cotización</h4>
            <div style={styles.summaryLine}>
              <span>Número</span>
              <strong>{getQuoteDisplayNumber(quote, quote.id || "-")}</strong>
            </div>
            <div style={styles.summaryLine}>
              <span>Cliente</span>
              <strong>{quote.clienteNombre || "-"}</strong>
            </div>
            <div style={styles.summaryLine}>
              <span>Ítems</span>
              <strong>{quote.items?.length || 0}</strong>
            </div>
            <div style={styles.summaryLine}>
              <span>PDF adjunto</span>
              <span style={styles.fileInfo}>
                <strong>{pdfFileName}</strong>
                {pdfReady && (
                  <small style={styles.readyBadge}>Listo para enviar</small>
                )}
              </span>
            </div>
            <div style={styles.totalLine}>
              <span>Total</span>
              <strong>{formatCLP(quote.total)}</strong>
            </div>
            {quote.observaciones && (
              <div style={styles.observationsBlock}>
                <strong style={styles.observationsTitle}>Observaciones</strong>
                <p style={styles.observations}>{quote.observaciones}</p>
              </div>
            )}
            <p style={styles.disclaimer}>
              El envio ocurre solo al confirmar y queda registrado en el historial de la
              cotizacion.
            </p>
          </aside>
        </div>

        {error && <p style={styles.errorText}>{error}</p>}
        <div style={styles.warningBox}>
          <p style={styles.warningText}>
            El respaldo manual abre tu cliente de correo, pero no puede adjuntar archivos automáticamente. Descarga el PDF y adjúntalo antes de enviar.
          </p>
          <div style={styles.manualActions}>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              style={{
                ...styles.manualButton,
                ...(downloadingPdf ? styles.disabledManualButton : {}),
              }}
            >
              {downloadingPdf ? "Descargando..." : "Descargar PDF"}
            </button>
            <a href={mailtoUrl} style={styles.mailtoLink}>
              Abrir cliente de correo
            </a>
          </div>
        </div>
        {success && <p style={styles.successText}>{success}</p>}

        <div style={styles.actions}>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={sending || !canSendQuote}
            style={{
              ...styles.primaryButton,
              ...(sending || !canSendQuote ? styles.disabledButton : {}),
            }}
          >
            {sending ? "Enviando..." : "Confirmar envio"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    alignItems: "flex-start",
    background: "rgba(15, 23, 42, 0.45)",
    bottom: 0,
    display: "flex",
    justifyContent: "center",
    left: 0,
    overflowY: "auto",
    padding: "28px 16px",
    position: "fixed",
    right: 0,
    top: 0,
    zIndex: 60,
  },
  modal: {
    background: "#ffffff",
    borderRadius: "8px",
    boxShadow: "0 20px 50px rgba(15, 23, 42, 0.22)",
    display: "grid",
    gap: "14px",
    maxWidth: "920px",
    padding: "18px",
    width: "100%",
  },
  header: {
    alignItems: "flex-start",
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#0f766e",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  title: {
    fontSize: "20px",
    margin: "3px 0 0",
  },
  closeButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    fontWeight: 800,
    padding: "8px 10px",
  },
  grid: {
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
  },
  formSection: {
    display: "grid",
    gap: "12px",
  },
  field: {
    display: "grid",
    gap: "6px",
  },
  label: {
    color: "#334155",
    fontSize: "13px",
    fontWeight: 700,
  },
  input: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
    width: "100%",
  },
  textarea: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    minHeight: "180px",
    padding: "11px",
    resize: "vertical",
    width: "100%",
  },
  summary: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    display: "grid",
    gap: "10px",
    padding: "14px",
  },
  summaryTitle: {
    fontSize: "15px",
    margin: 0,
  },
  summaryLine: {
    color: "#475569",
    display: "flex",
    gap: "10px",
    justifyContent: "space-between",
  },
  fileInfo: {
    display: "grid",
    gap: "4px",
    justifyItems: "end",
    minWidth: 0,
    textAlign: "right",
  },
  readyBadge: {
    background: "#dcfce7",
    borderRadius: "999px",
    color: "#166534",
    fontSize: "11px",
    fontWeight: 800,
    padding: "3px 7px",
    width: "fit-content",
  },
  totalLine: {
    borderTop: "1px solid #e2e8f0",
    color: "#111827",
    display: "flex",
    fontSize: "17px",
    gap: "10px",
    justifyContent: "space-between",
    paddingTop: "10px",
  },
  observations: {
    color: "#475569",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: 0,
  },
  observationsBlock: {
    display: "grid",
    gap: "4px",
  },
  observationsTitle: {
    color: "#334155",
    fontSize: "13px",
  },
  disclaimer: {
    color: "#64748b",
    fontSize: "12px",
    lineHeight: 1.4,
    margin: 0,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "flex-end",
  },
  primaryButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 14px",
  },
  disabledButton: {
    background: "#f1f5f9",
    color: "#64748b",
    cursor: "not-allowed",
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 14px",
  },
  errorText: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    color: "#b91c1c",
    margin: 0,
    padding: "10px 12px",
  },
  successText: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    borderRadius: "8px",
    color: "#166534",
    margin: 0,
    padding: "10px 12px",
  },
  warningBox: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "8px",
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "space-between",
    padding: "10px 12px",
  },
  warningText: {
    color: "#92400e",
    flex: "1 1 260px",
    fontSize: "13px",
    margin: 0,
  },
  manualActions: {
    alignItems: "center",
    display: "flex",
    flex: "0 1 auto",
    flexWrap: "wrap",
    gap: "8px",
    justifyContent: "flex-end",
  },
  manualButton: {
    background: "#ffffff",
    border: "1px solid #f59e0b",
    borderRadius: "6px",
    color: "#92400e",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    padding: "8px 10px",
  },
  disabledManualButton: {
    background: "#fef3c7",
    color: "#a16207",
    cursor: "not-allowed",
  },
  mailtoLink: {
    background: "#0f766e",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "13px",
    fontWeight: 800,
    padding: "8px 10px",
    textDecoration: "none",
  },
};

export default SendQuoteEmailModal;
