import React, { useEffect, useId, useRef, useState } from "react";
import { Check, Eye, FileText, Info, PencilLine, Send } from "lucide-react";
import AppIcon from "./AppIcon";
import Button from "./Button";
import Notice from "./Notice";
import ResponsiveDialog from "./ResponsiveDialog";
import SegmentedControl from "./SegmentedControl";
import { firebaseEnvironment } from "../../config/firebaseEnvironment.mjs";

// Diálogo único para enviar un documento por correo (orden de compra, cotización).
// Solo presenta: la validación, el envío, la simulación y los cambios de estado
// viven en el feature de cada documento y entran por props y callbacks.
//
// - Estado propio (solo de pantalla): pestaña Redactar/Vista previa y si se está
//   usando un correo distinto del guardado.
// - Los valores del formulario (destinatario, asunto, mensaje, copia) los controla
//   el feature.
// - No asume que exista un enlace: lo que se dice del documento va en `note`.
// - El aviso de simulación sale solo en QA local (firebaseEnvironment.isEmulator),
//   la misma condición que usaba Cotización.
export const DOCUMENT_EMAIL_RECIPIENT_PLACEHOLDER = "Escribe el correo del destinatario";
export const DOCUMENT_EMAIL_SIMULATION_TITLE = "Simulación de correo — QA local";

function DocumentEmailDialog({
  accountEmail = "",
  asunto,
  asuntoError = "",
  attachmentName,
  copyTo = "",
  defaultView = "edit",
  description,
  disabled = false,
  disabledReason = "",
  documentName,
  error = "",
  eyebrow,
  from,
  mensaje,
  mensajeError = "",
  note = null,
  onAsuntoChange,
  onClose,
  onMensajeChange,
  onRecipientToggle,
  onSendCopyChange,
  onSubmit,
  open,
  previewContent,
  processing = false,
  recipient,
  replyTo = "",
  replyToEmptyText = "Sin correo de respuesta",
  replyToWarning = "",
  resetKey,
  savedEmailLabel = "Volver al correo guardado",
  sendCopy = false,
  simulated = firebaseEnvironment.isEmulator,
  simulationResult = null,
  simulationText = "No se enviará un correo real.",
  submitLabel,
  submittingLabel,
  summaryRows = [],
}) {
  const formId = useId();
  const recipientId = `${formId}-recipient`;
  const helpId = `${formId}-recipient-help`;
  const recipientErrorId = `${formId}-recipient-error`;
  const asuntoId = `${formId}-asunto`;
  const mensajeId = `${formId}-mensaje`;
  const recipientRef = useRef(null);
  const [view, setView] = useState(defaultView);
  const [usingAlternate, setUsingAlternate] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView(defaultView);
    setUsingAlternate(false);
  }, [defaultView, open, resetKey]);

  const hasSavedEmail = Boolean(String(recipient.defaultValue || "").trim());
  const recipientEditable = usingAlternate || !hasSavedEmail;
  const close = () => {
    if (!processing) onClose?.();
  };

  const toggleRecipient = () => {
    if (usingAlternate) {
      recipient.onChange(recipient.defaultValue);
      setUsingAlternate(false);
    } else {
      setUsingAlternate(true);
      window.requestAnimationFrame(() => {
        recipientRef.current?.focus();
        recipientRef.current?.select();
      });
    }
    onRecipientToggle?.();
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.(event);
  };

  const idleLabel = simulated ? "Preparar simulación" : submitLabel;
  const busyLabel = simulated ? "Preparando..." : submittingLabel;
  const showDisabledReason = Boolean(disabled && disabledReason && !processing);

  const footer = (
    <>
      {showDisabledReason && (
        <p className="quote-email-dialog__footer-hint">{disabledReason}</p>
      )}
      <Button
        type="button"
        variant="secondary"
        onClick={close}
        disabled={processing}
      >
        Cancelar
      </Button>
      <Button
        type="submit"
        form={formId}
        className="quote-email-dialog__send"
        icon={Send}
        loading={processing}
        disabled={disabled}
      >
        {processing ? busyLabel : idleLabel}
      </Button>
    </>
  );

  return (
    <ResponsiveDialog
      className="quote-email-dialog"
      description={description}
      eyebrow={eyebrow}
      footer={footer}
      initialFocusRef={recipientRef}
      onClose={close}
      open={open}
      size="large"
      title={`Enviar ${documentName} por correo`}
    >
      <form
        id={formId}
        className="quote-email-dialog__content"
        onSubmit={handleSubmit}
      >
        {simulated && (
          <div
            className={`quote-email-dialog__qa-notice${
              simulationResult ? " quote-email-dialog__qa-notice--result" : ""
            }`}
            role="status"
          >
            <strong>{DOCUMENT_EMAIL_SIMULATION_TITLE}</strong>
            <span>{simulationResult ? simulationResult.text : simulationText}</span>
            {simulationResult?.actions && (
              <div className="quote-email-dialog__qa-actions">
                {simulationResult.actions}
              </div>
            )}
          </div>
        )}

        <section className="quote-email-dialog__fields">
          <div className="quote-email-dialog__field quote-email-dialog__recipient">
            <label htmlFor={recipientId}>Destinatario</label>
            <input
              id={recipientId}
              ref={recipientRef}
              type="email"
              value={recipient.value}
              maxLength={180}
              autoComplete="email"
              onChange={(event) => recipient.onChange(event.target.value)}
              placeholder={DOCUMENT_EMAIL_RECIPIENT_PLACEHOLDER}
              disabled={processing}
              readOnly={!recipientEditable}
              aria-describedby={
                recipient.error ? `${helpId} ${recipientErrorId}` : helpId
              }
              aria-invalid={recipient.error ? true : undefined}
            />
            {hasSavedEmail && (
              <button
                type="button"
                className="quote-email-dialog__recipient-action"
                onClick={toggleRecipient}
                disabled={processing}
              >
                {usingAlternate ? savedEmailLabel : "Usar otro correo"}
              </button>
            )}
            <p id={helpId} className="quote-email-dialog__help">
              {hasSavedEmail
                ? "Por defecto se usa el correo guardado. Si escribes otro, se usa solo para este envío y no cambia la ficha."
                : "No hay un correo guardado. Escribe uno: se usa solo para este envío y no cambia la ficha."}
            </p>
            {recipient.error && (
              <p id={recipientErrorId} className="quote-email-dialog__field-error">
                {recipient.error}
              </p>
            )}
          </div>

          <dl className="quote-email-dialog__envelope" aria-label="Datos de envío">
            <div>
              <dt>De</dt>
              <dd>{from}</dd>
            </div>
            <div>
              <dt>Responder a</dt>
              <dd>{replyTo || replyToEmptyText}</dd>
            </div>
            <div>
              <dt>Copia oculta</dt>
              <dd>{copyTo || "Sin copia"}</dd>
            </div>
          </dl>
          {!replyTo && replyToWarning && (
            <Notice variant="warning" role={null}>
              {replyToWarning}
            </Notice>
          )}

          {accountEmail && (
            <label className="ui-checkbox">
              <input
                className="ui-checkbox__input"
                type="checkbox"
                checked={sendCopy}
                onChange={(event) => onSendCopyChange?.(event.target.checked)}
                disabled={processing}
              />
              <span className="ui-checkbox__label">
                Enviarme una copia a {accountEmail}
              </span>
            </label>
          )}

          <SegmentedControl
            className="quote-email-dialog__views"
            legend="Contenido del correo"
            name={`${formId}-view`}
            onChange={setView}
            options={[
              { value: "edit", label: "Redactar", icon: PencilLine },
              { value: "preview", label: "Vista previa", icon: Eye },
            ]}
            value={view}
          />

          {view === "edit" ? (
            <>
              <div className="quote-email-dialog__field">
                <label htmlFor={asuntoId}>Asunto</label>
                <input
                  id={asuntoId}
                  type="text"
                  value={asunto}
                  maxLength={180}
                  onChange={(event) => onAsuntoChange(event.target.value)}
                  disabled={processing}
                  aria-invalid={asuntoError ? true : undefined}
                />
                {asuntoError && (
                  <p className="quote-email-dialog__field-error">{asuntoError}</p>
                )}
              </div>

              <div className="quote-email-dialog__field">
                <label htmlFor={mensajeId}>Mensaje</label>
                <textarea
                  id={mensajeId}
                  value={mensaje}
                  maxLength={2000}
                  onChange={(event) => onMensajeChange(event.target.value)}
                  disabled={processing}
                  aria-invalid={mensajeError ? true : undefined}
                />
                {mensajeError && (
                  <p className="quote-email-dialog__field-error">{mensajeError}</p>
                )}
              </div>
            </>
          ) : (
            previewContent
          )}
        </section>

        <aside className="quote-email-dialog__summary">
          {note && (
            <p className="quote-email-dialog__reply-notice">
              <AppIcon icon={Info} size={18} aria-hidden="true" />
              <span>
                <strong>{note.title}</strong>
                {note.description && <small>{note.description}</small>}
              </span>
            </p>
          )}
          <h3>Resumen</h3>
          <dl>
            {summaryRows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="quote-email-dialog__attachment">
            <AppIcon icon={FileText} size={20} />
            <span>
              <strong>PDF adjunto</strong>
              <small>{attachmentName}</small>
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

export default DocumentEmailDialog;
