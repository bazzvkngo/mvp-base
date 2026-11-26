import React, {useEffect, useId, useState} from "react";
import {Mail, MessageCircle} from "lucide-react";
import AppIcon from "./AppIcon";
import Button from "./Button";
import ResponsiveDialog from "./ResponsiveDialog";

// Selector de envío: un diálogo con dos tarjetas grandes, "Correo" y "WhatsApp", que se abre al pulsar "Enviar".
// Solo presenta y delega: no envía nada por sí mismo.
// - onEmail(): el llamador cierra este diálogo y abre el diálogo de correo que ya tiene.
// - onWhatsApp(): el llamador abre el chat. Se invoca de forma síncrona en el clic (el navegador bloquea las ventanas
//   que se abren después de una espera). Debe devolver (o resolver) true si el chat se abrió; entonces el diálogo pasa
//   a "¿La enviaste?", porque abrir WhatsApp no confirma el envío.
// - onWhatsAppSent(): el llamador registra la emisión con el mecanismo manual que ya tiene (canal "whatsapp") y cierra.
// - onAlreadySent: si se entrega, aparece el enlace "Ya la envié por otro medio" (registro manual del llamador).
// - whatsAppEnabled / whatsAppHint: sin teléfono, la tarjeta de WhatsApp sale deshabilitada con la pista.
// - closeLabel: "Cancelar" por defecto; tras guardar un documento nuevo conviene "Más tarde".
export const WHATSAPP_MISSING_PHONE_HINT = "Agrega un teléfono para compartir por WhatsApp.";

// Paso posterior a abrir WhatsApp: no se puede confirmar el envío, así que se pregunta.
export function WhatsAppSentConfirm({confirmLabel, description, onClose, onConfirm, open, processing}) {
  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !processing && onClose()}
      eyebrow="WhatsApp"
      title="¿La enviaste?"
      description={description}
      size="small"
      footer={<>
        <Button type="button" variant="secondary" disabled={processing} onClick={onClose}>Todavía no</Button>
        <Button type="button" loading={processing} onClick={onConfirm}>{processing ? "Registrando..." : confirmLabel}</Button>
      </>}
    >
      <p className="ui-send-method__note">ValoraCloud registrará el envío por WhatsApp, sin afirmar entrega ni lectura.</p>
    </ResponsiveDialog>
  );
}

export default function SendMethodDialog({
  closeLabel = "Cancelar",
  confirmLabel = "Marcar como emitida",
  description,
  emailHelp = "Con el PDF adjunto, desde ValoraCloud.",
  eyebrow,
  onAlreadySent,
  onClose,
  onEmail,
  onWhatsApp,
  onWhatsAppSent,
  open,
  processing = false,
  title,
  whatsAppConfirmDescription = "Abrir WhatsApp no confirma que el destinatario haya recibido el documento.",
  whatsAppEnabled = true,
  whatsAppHelp = "Abre el chat con el mensaje ya escrito.",
  whatsAppHint = WHATSAPP_MISSING_PHONE_HINT,
}) {
  const [step, setStep] = useState("choose");
  const [opening, setOpening] = useState(false);
  const hintId = useId();
  useEffect(() => {
    if (open) { setStep("choose"); setOpening(false); }
  }, [open]);

  const busy = processing || opening;
  const chooseWhatsApp = async () => {
    if (busy || !whatsAppEnabled) return;
    setOpening(true);
    try {
      const opened = await onWhatsApp?.();
      if (opened) setStep("whatsapp");
    } finally {
      setOpening(false);
    }
  };

  if (step === "whatsapp") {
    return (
      <WhatsAppSentConfirm
        confirmLabel={confirmLabel}
        description={whatsAppConfirmDescription}
        onClose={onClose}
        onConfirm={onWhatsAppSent}
        open={open}
        processing={processing}
      />
    );
  }

  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !busy && onClose()}
      eyebrow={eyebrow}
      title={title}
      description={description}
      size="small"
      footer={<Button type="button" variant="secondary" disabled={busy} onClick={onClose}>{closeLabel}</Button>}
    >
      <div className="ui-send-method" role="group" aria-label="Elige cómo enviarla">
        <button type="button" className="ui-send-method__card" disabled={busy} onClick={() => onEmail?.()}>
          <span className="ui-send-method__icon"><AppIcon icon={Mail} size={28} /></span>
          <span className="ui-send-method__title">Correo</span>
          <span className="ui-send-method__help">{emailHelp}</span>
        </button>
        <button
          type="button"
          className="ui-send-method__card"
          aria-describedby={whatsAppEnabled ? undefined : hintId}
          disabled={busy || !whatsAppEnabled}
          onClick={chooseWhatsApp}
        >
          <span className="ui-send-method__icon"><AppIcon icon={MessageCircle} size={28} /></span>
          <span className="ui-send-method__title">WhatsApp</span>
          <span className="ui-send-method__help" id={whatsAppEnabled ? undefined : hintId}>{whatsAppEnabled ? whatsAppHelp : whatsAppHint}</span>
        </button>
      </div>
      {onAlreadySent && (
        <button type="button" className="ui-send-method__link" disabled={busy} onClick={onAlreadySent}>Ya la envié por otro medio</button>
      )}
    </ResponsiveDialog>
  );
}
