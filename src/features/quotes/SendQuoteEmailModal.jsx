import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, FileText } from "lucide-react";
import { sileo } from "sileo";
import Button from "../../components/ui/Button";
import AppIcon from "../../components/ui/AppIcon";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import { firebaseEnvironment } from "../../config/firebaseEnvironment.mjs";
import {
  buildDefaultQuoteEmail,
  createQuoteEmailRequestId,
  isQuoteEmailSendable,
  isValidEmail,
  sendQuoteEmail,
} from "../../services/quoteEmailService";
import { getQuoteDisplayNumber } from "../../services/quoteService";
import {
  buildQuotePdfAttachment,
  getQuotePdfFileName,
} from "../../utils/quotePdf";
import { formatCLP } from "../../utils/formatters";

function getSafeEmailError(error) {
  const message = String(error?.message || "");
  if (/PDF adjunto|application\/pdf|formato v[aá]lido/i.test(message)) {
    return "No fue posible adjuntar el PDF. Intenta nuevamente.";
  }
  if (/envío.+curso/i.test(message)) {
    return "Ya hay un envío de esta cotización en curso.";
  }
  if (/espera unos segundos/i.test(message)) {
    return "Espera unos segundos antes de volver a enviarla.";
  }
  if (/correo.+válido|único correo/i.test(message)) {
    return "Ingresa un único correo de destino válido.";
  }
  if (/permiso|acceso|permission-denied/i.test(message)) {
    return "No tienes permisos para enviar cotizaciones por correo.";
  }
  return "Intenta nuevamente más tarde.";
}

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
  const canSendQuote = isQuoteEmailSendable(quote, quoteId);
  const pdfFileName = useMemo(() => getQuotePdfFileName(quote), [quote]);
  const emailInputRef = useRef(null);
  const submittingRef = useRef(false);
  const requestIdRef = useRef("");
  const [emailCliente, setEmailCliente] = useState(defaults.emailCliente);
  const [usingAlternateEmail, setUsingAlternateEmail] = useState(false);
  const [asunto, setAsunto] = useState(defaults.asunto);
  const [mensaje, setMensaje] = useState(defaults.mensaje);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [qaPublicUrl, setQaPublicUrl] = useState("");

  useEffect(() => {
    if (!open) {
      setQaPublicUrl("");
      return;
    }
    setEmailCliente(defaults.emailCliente);
    setUsingAlternateEmail(false);
    setAsunto(defaults.asunto);
    setMensaje(defaults.mensaje);
    setError("");
    setQaPublicUrl("");
    submittingRef.current = false;
    requestIdRef.current = createQuoteEmailRequestId();
  }, [defaults, open, quoteId]);

  if (!quote) return null;

  const quoteNumber = getQuoteDisplayNumber(quote, quote.id || "-");
  const closeDialog = () => {
    if (!submittingRef.current) onClose?.();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");
    setQaPublicUrl("");

    let validationError = "";
    if (!quoteId) {
      validationError = "Guarda la cotización antes de enviarla por correo.";
    } else if (!canSendQuote) {
      validationError = "La cotización no puede enviarse desde su estado actual.";
    } else if (!isValidEmail(emailCliente)) {
      validationError = "Ingresa un único correo de destino válido.";
    } else if (!asunto.trim()) {
      validationError = "Ingresa el asunto del correo.";
    } else if (!mensaje.trim()) {
      validationError = "Ingresa el mensaje del correo.";
    }

    if (validationError) {
      setError(validationError);
      return;
    }

    submittingRef.current = true;
    setSending(true);
    let completedResult = null;

    try {
      const request = (async () => {
        const pdfAttachment = await buildQuotePdfAttachment({
          quote,
          companyProfile,
        });
        if (!pdfAttachment?.contentBase64) {
          throw new Error("El PDF adjunto no tiene un formato válido.");
        }

        const result = await sendQuoteEmail({
          businessId,
          quoteId,
          emailCliente,
          asunto,
          mensaje,
          pdfAttachment,
          requestId: requestIdRef.current,
        });
        completedResult = result;
        if (!result.success) {
          throw new Error(result.error || "No fue posible enviar la cotización.");
        }
        return result;
      })();

      const loadingToastId = sileo.show({
        duration: null,
        type: "loading",
        title: firebaseEnvironment.isEmulator
          ? "Preparando simulación"
          : "Procesando correo",
        description: `Preparando ${quoteNumber} y su PDF adjunto.`,
      });
      let result;
      try {
        result = await request;
      } catch (sendError) {
        sileo.dismiss(loadingToastId);
        sileo.error({
          title: "No pudimos enviar la cotización",
          description: getSafeEmailError(sendError),
        });
        throw sendError;
      }
      sileo.dismiss(loadingToastId);

      const isQaSimulation = firebaseEnvironment.isEmulator && result.simulated;
      const resultQaPublicUrl = isQaSimulation
        ? String(result.qaPublicUrl || "").trim()
        : "";
      const qaLinkAction = resultQaPublicUrl
        ? {
            button: {
              title: "Copiar enlace QA",
              onClick: () => {
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(resultQaPublicUrl).catch(() => {
                    window.prompt("Copia el enlace público de QA:", resultQaPublicUrl);
                  });
                } else {
                  window.prompt("Copia el enlace público de QA:", resultQaPublicUrl);
                }
              },
            },
          }
        : {};
      if (result.simulated) {
        setQaPublicUrl(resultQaPublicUrl);
        sileo.info({
          title: "Simulación preparada",
          description: "En QA local no se envió un correo real.",
          ...qaLinkAction,
        });
      } else {
        sileo.success({
          title: "Cotización enviada",
          description: `${quoteNumber} fue enviada a ${emailCliente.trim()}.`,
        });
      }

      onSent?.(result.quoteEmailStatus, result);
      if (!isQaSimulation) onClose?.();
    } catch (sendError) {
      console.error("Error enviando cotización por correo:", sendError);
      const safeMessage = getSafeEmailError(sendError);
      setError(safeMessage);
      if (completedResult?.quoteEmailStatus) {
        onSent?.(completedResult.quoteEmailStatus, completedResult);
      }
    } finally {
      submittingRef.current = false;
      setSending(false);
    }
  };

  const copyQaPublicUrl = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API no disponible.");
      }
      await navigator.clipboard.writeText(qaPublicUrl);
      sileo.info({
        title: "Enlace copiado",
        duration: 2200,
      });
    } catch {
      window.prompt("Copia el enlace público de QA:", qaPublicUrl);
    }
  };

  const footer = (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={closeDialog}
        disabled={sending}
      >
        Cancelar
      </Button>
      <Button
        type="submit"
        form="send-quote-email-form"
        disabled={sending || !canSendQuote}
      >
        {firebaseEnvironment.isEmulator
          ? sending
            ? "Preparando..."
            : "Preparar simulación"
          : sending
            ? "Enviando..."
            : "Enviar cotización"}
      </Button>
    </>
  );

  return (
    <ResponsiveDialog
      className="quote-email-dialog"
      description={firebaseEnvironment.isEmulator
        ? "Revisa los datos que se usarán en esta simulación local."
        : "Revisa los datos del correo antes de enviar el documento al cliente."}
      footer={footer}
      initialFocusRef={emailInputRef}
      onClose={closeDialog}
      open={open}
      size="large"
      title={firebaseEnvironment.isEmulator
        ? "Simular correo de cotización"
        : "Enviar cotización por correo"}
    >
      <form
        id="send-quote-email-form"
        className="quote-email-dialog__content"
        onSubmit={handleSubmit}
      >
        {firebaseEnvironment.isEmulator && (
          <div
            className={`quote-email-dialog__qa-notice${
              qaPublicUrl ? " quote-email-dialog__qa-notice--result" : ""
            }`}
            role="status"
          >
            <strong>Simulación de correo — QA local</strong>
            <span>
              {qaPublicUrl
                ? "No se envió un correo real. Usa este enlace para revisar exactamente la propuesta que recibiría el cliente."
                : "No se enviará un correo real. El destinatario se registrará sólo como dato de prueba."}
            </span>
            {qaPublicUrl && (
              <div className="quote-email-dialog__qa-actions">
                <a
                  className="quote-email-dialog__qa-action"
                  href={qaPublicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <AppIcon icon={ExternalLink} size={16} />
                  <span>Abrir propuesta QA</span>
                </a>
                <button
                  className="quote-email-dialog__qa-action"
                  type="button"
                  onClick={copyQaPublicUrl}
                >
                  <AppIcon icon={Copy} size={16} />
                  <span>Copiar enlace</span>
                </button>
              </div>
            )}
          </div>
        )}
        <section className="quote-email-dialog__fields">
          <div className="quote-email-dialog__field">
            <div className="quote-email-dialog__field-heading">
              <label htmlFor="quote-email-recipient">Destinatario</label>
              <button
                type="button"
                className="quote-email-dialog__recipient-action"
                onClick={() => {
                  if (usingAlternateEmail) {
                    setEmailCliente(defaults.emailCliente);
                    setUsingAlternateEmail(false);
                  } else {
                    setUsingAlternateEmail(true);
                    window.requestAnimationFrame(() => {
                      emailInputRef.current?.focus();
                      emailInputRef.current?.select();
                    });
                  }
                  setError("");
                }}
                disabled={sending}
              >
                {usingAlternateEmail
                  ? "Volver al correo del cliente"
                  : "Usar otro correo"}
              </button>
            </div>
            <input
              id="quote-email-recipient"
              ref={emailInputRef}
              type="email"
              value={emailCliente}
              maxLength={180}
              autoComplete="email"
              onChange={(event) => setEmailCliente(event.target.value)}
              placeholder="cliente@empresa.cl"
              disabled={sending}
              readOnly={!usingAlternateEmail}
            />
            {usingAlternateEmail && (
              <div
                className="quote-email-dialog__alternate-note"
                role="status"
              >
                <strong>Envío puntual a un correo alternativo</strong>
                <span>
                  Este correo se utilizará sólo para este envío. Este cambio
                  sólo aplica a esta cotización y no modifica la ficha ni los
                  datos del cliente.
                </span>
              </div>
            )}
            <p className="quote-email-dialog__recipient-help">
              La persona que reciba este correo podrá revisar, aceptar o rechazar
              esta cotización.
            </p>
          </div>

          <label className="quote-email-dialog__field">
            <span>Asunto</span>
            <input
              value={asunto}
              maxLength={180}
              onChange={(event) => setAsunto(event.target.value)}
              disabled={sending}
            />
          </label>

          <label className="quote-email-dialog__field">
            <span>Mensaje</span>
            <textarea
              value={mensaje}
              maxLength={2000}
              onChange={(event) => setMensaje(event.target.value)}
              disabled={sending}
            />
          </label>
        </section>

        <aside className="quote-email-dialog__summary">
          <h3>Resumen</h3>
          <dl>
            <div>
              <dt>Cotización</dt>
              <dd>{quoteNumber}</dd>
            </div>
            <div>
              <dt>Cliente</dt>
              <dd>{quote.clienteNombre || "—"}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{formatCLP(quote.total)}</dd>
            </div>
          </dl>
          <div className="quote-email-dialog__attachment">
            <AppIcon icon={FileText} size={20} />
            <span>
              <strong>PDF adjunto</strong>
              <small>{pdfFileName}</small>
            </span>
            <AppIcon icon={Check} size={18} aria-hidden="true" />
          </div>
        </aside>

        {error && (
          <p className="quote-email-dialog__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </ResponsiveDialog>
  );
}

export default SendQuoteEmailModal;
