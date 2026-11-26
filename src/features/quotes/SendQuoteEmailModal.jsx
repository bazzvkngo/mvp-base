import React, { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { sileo } from "sileo";
import AppIcon from "../../components/ui/AppIcon";
import DocumentEmailDialog from "../../components/ui/DocumentEmailDialog";
import QuoteEmailPreview from "./QuoteEmailPreview";
import { firebaseEnvironment } from "../../config/firebaseEnvironment.mjs";
import {
  buildDefaultQuoteEmail,
  buildQuoteEmailPanelPreview,
  createQuoteEmailRequestId,
  isQuoteEmailSendable,
  isValidEmail,
  sendQuoteEmail,
} from "../../services/quoteEmailService";
import { getQuoteDisplayNumber } from "../../services/quoteService";
import { getVerifiedAccountEmail } from "../../services/senderAccount";
import {
  buildQuotePdfAttachment,
  getQuotePdfFileName,
} from "../../utils/quotePdf";
import { useBusinessMoney } from "../../hooks/useBusinessFormat";

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
  const formatBusinessAmount = useBusinessMoney();
  const accountEmail = getVerifiedAccountEmail();
  const defaults = useMemo(
    () => buildDefaultQuoteEmail({ quote, companyProfile, accountEmail }),
    [accountEmail, companyProfile, quote]
  );
  const canSendQuote = isQuoteEmailSendable(quote, quoteId);
  const pdfFileName = useMemo(() => getQuotePdfFileName(quote), [quote]);
  const submittingRef = useRef(false);
  const requestIdRef = useRef("");
  const [emailCliente, setEmailCliente] = useState(defaults.emailCliente);
  const [asunto, setAsunto] = useState(defaults.asunto);
  const [mensaje, setMensaje] = useState(defaults.mensaje);
  const [enviarCopia, setEnviarCopia] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [qaPublicUrl, setQaPublicUrl] = useState("");
  const preview = useMemo(
    () =>
      buildQuoteEmailPanelPreview({
        quote,
        companyProfile,
        accountEmail,
        emailCliente,
        asunto,
        mensaje,
        enviarCopia,
      }),
    [accountEmail, asunto, companyProfile, emailCliente, enviarCopia, mensaje, quote]
  );

  useEffect(() => {
    if (!open) {
      setQaPublicUrl("");
      return;
    }
    setEmailCliente(defaults.emailCliente);
    setAsunto(defaults.asunto);
    setMensaje(defaults.mensaje);
    setEnviarCopia(false);
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
          enviarCopia: Boolean(accountEmail) && enviarCopia,
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
          title: "No se pudo enviar la cotización",
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

  const qaResultActions = qaPublicUrl ? (
    <>
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
    </>
  ) : null;

  // Estructura compartida con la orden de compra (DocumentEmailDialog). Aquí quedan
  // el envío, la simulación, los estados y los textos propios de la cotización: al
  // cliente se le responde desde un enlace.
  return (
    <DocumentEmailDialog
      accountEmail={accountEmail}
      asunto={asunto}
      attachmentName={pdfFileName}
      copyTo={preview.copyTo}
      description="Revisa los datos del correo antes de enviar el documento al cliente."
      disabled={!canSendQuote}
      disabledReason={
        canSendQuote ? "" : "La cotización no puede enviarse desde su estado actual."
      }
      documentName="cotización"
      error={error}
      eyebrow="Envío al cliente"
      from={preview.from}
      mensaje={mensaje}
      note={{
        title: "El cliente podrá aceptar o rechazar",
        description:
          "La persona que reciba este correo podrá revisar, aceptar o rechazar esta cotización desde el enlace.",
      }}
      onAsuntoChange={setAsunto}
      onClose={closeDialog}
      onMensajeChange={setMensaje}
      onRecipientToggle={() => setError("")}
      onSendCopyChange={setEnviarCopia}
      onSubmit={handleSubmit}
      open={open}
      previewContent={<QuoteEmailPreview preview={preview} />}
      processing={sending}
      recipient={{
        defaultValue: defaults.emailCliente,
        onChange: setEmailCliente,
        value: emailCliente,
      }}
      replyTo={preview.replyTo}
      replyToEmptyText="Sin correo de respuesta: el cliente responderá desde el enlace"
      resetKey={quoteId}
      savedEmailLabel="Volver al correo del cliente"
      sendCopy={enviarCopia}
      simulationResult={
        qaPublicUrl
          ? {
              actions: qaResultActions,
              text: "No se envió un correo real. Usa este enlace para revisar exactamente la propuesta que recibiría el cliente.",
            }
          : null
      }
      simulationText="No se enviará un correo real. El destinatario se registrará solo como dato de prueba."
      submitLabel="Enviar cotización"
      submittingLabel="Enviando..."
      summaryRows={[
        { label: "Cotización", value: quoteNumber },
        { label: "Cliente", value: quote.clienteNombre || "—" },
        { label: "Total", value: formatBusinessAmount(quote.total) },
      ]}
    />
  );
}

export default SendQuoteEmailModal;
