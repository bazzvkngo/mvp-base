import React, { useEffect, useMemo, useState } from "react";
import {
  buildDefaultQuoteEmail,
  buildMailtoUrl,
  isValidEmail,
  sendQuoteEmail,
} from "../../services/quoteEmailService";
import { getQuoteDisplayNumber } from "../../services/quoteService";
import { formatCLP } from "../../utils/formatters";

function SendQuoteEmailModal({
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
  const [emailCliente, setEmailCliente] = useState(defaults.emailCliente);
  const [asunto, setAsunto] = useState(defaults.asunto);
  const [mensaje, setMensaje] = useState(defaults.mensaje);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!open) return;
    setEmailCliente(defaults.emailCliente);
    setAsunto(defaults.asunto);
    setMensaje(defaults.mensaje);
    setError("");
    setSuccess("");
  }, [defaults, open]);

  if (!open || !quote) return null;

  const mailtoUrl = buildMailtoUrl({ emailCliente, asunto, mensaje });

  const handleSubmit = async () => {
    setError("");
    setSuccess("");

    if (!quoteId) {
      setError("Guarda la cotizacion antes de enviarla por correo.");
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

    try {
      setSending(true);
      const result = await sendQuoteEmail({
        quoteId,
        emailCliente,
        asunto,
        mensaje,
      });

      if (onSent) {
        onSent(result.quoteEmailStatus, result);
      }

      if (!result.success) {
        setError(
          result.error ||
            "No se pudo enviar automaticamente. Puedes usar el respaldo manual."
        );
        return;
      }

      setSuccess("Cotizacion enviada correctamente al correo del cliente.");
    } catch (err) {
      console.error("Error enviando cotizacion por correo:", err);
      setError(
        err.message ||
          "No se pudo enviar automaticamente. Puedes usar el respaldo manual."
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
                rows={7}
                value={mensaje}
                onChange={(event) => setMensaje(event.target.value)}
                style={styles.textarea}
              />
            </label>
          </section>

          <aside style={styles.summary}>
            <h4 style={styles.summaryTitle}>Resumen de cotizacion</h4>
            <div style={styles.summaryLine}>
              <span>Numero</span>
              <strong>{getQuoteDisplayNumber(quote, quote.id || "-")}</strong>
            </div>
            <div style={styles.summaryLine}>
              <span>Cliente</span>
              <strong>{quote.clienteNombre || "-"}</strong>
            </div>
            <div style={styles.summaryLine}>
              <span>Items</span>
              <strong>{quote.items?.length || 0}</strong>
            </div>
            <div style={styles.totalLine}>
              <span>Total</span>
              <strong>{formatCLP(quote.total)}</strong>
            </div>
            {quote.observaciones && (
              <p style={styles.observations}>{quote.observaciones}</p>
            )}
            <p style={styles.disclaimer}>
              El envio ocurre solo al confirmar y queda registrado en el historial de la
              cotizacion.
            </p>
          </aside>
        </div>

        {error && <p style={styles.errorText}>{error}</p>}
        {error && (
          <div style={styles.warningBox}>
            <p style={styles.warningText}>
              Puedes usar el respaldo manual para abrir tu cliente de correo.
            </p>
            <a href={mailtoUrl} style={styles.mailtoLink}>
              Abrir correo manual
            </a>
          </div>
        )}
        {success && <p style={styles.successText}>{success}</p>}

        <div style={styles.actions}>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={sending}
            style={styles.primaryButton}
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
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
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
  mailtoLink: {
    color: "#0f766e",
    fontSize: "13px",
    fontWeight: 800,
  },
};

export default SendQuoteEmailModal;
