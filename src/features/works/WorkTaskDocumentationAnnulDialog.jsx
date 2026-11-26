import React, {useRef, useState} from "react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {WorkFormError} from "./WorkCostParts.jsx";
import useWorkFormSubmit from "./useWorkFormSubmit.js";

// Anular un comentario de la documentación de una tarea (solo propietario y administrador). Presentacional:
// `onAnnul(motivo, {requestId, onError})` devuelve una promesa con true si se anuló (la página resuelve la
// Function). El motivo es obligatorio: vacío o solo espacios no se envía y el mensaje queda bajo el campo. El error
// del backend se muestra aquí dentro con Notice, el diálogo sigue abierto con el motivo escrito, y el requestId se
// reutiliza en los reintentos (useWorkFormSubmit). El comentario no se borra: queda anulado en la lista.

const FORM_ID = "work-task-annul-form";

function AnnulBody({entry, onAnnul, onClose, reasonRef}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState("");
  const form = useWorkFormSubmit({prefix: "task-document-annul"});
  const submit = (event) => {
    event.preventDefault();
    const motivo = reason.trim();
    if (!motivo) { setFieldError("Escribe el motivo de la anulación."); reasonRef.current?.focus(); return; }
    form.submit({entryId: entry.id, motivo}, (requestId, onError) => onAnnul(motivo, {onError, requestId})).then((success) => { if (success) onClose(); });
  };
  return (
    <form id={FORM_ID} className="works-task-annul" onSubmit={submit}>
      <p className="works-task-annul__text">El comentario no se borra: queda en la lista como anulado, con tu nombre, la fecha y el motivo. No cambia los costos.</p>
      <blockquote className="works-task-annul__quote">{entry.texto}</blockquote>
      <label className="erp-field">
        <span className="erp-field__label">Motivo de la anulación *</span>
        <textarea aria-describedby={fieldError ? "work-task-annul-reason-error" : undefined} aria-invalid={fieldError ? "true" : undefined} className="erp-control" maxLength="1000" ref={reasonRef} rows="3" value={reason} onChange={(event) => { setReason(event.target.value); setFieldError(""); form.clearError(); }} />
      </label>
      {fieldError && <small className="works-field-error" id="work-task-annul-reason-error">{fieldError}</small>}
      <WorkFormError error={form.error} noticeRef={form.noticeRef} title="No se pudo anular el comentario" />
    </form>
  );
}

export default function WorkTaskDocumentationAnnulDialog({entry, onAnnul, onClose, processing = "", processingKey = ""}) {
  const reasonRef = useRef(null);
  const busy = Boolean(processing);
  const loading = busy && processing === processingKey;
  return (
    <ResponsiveDialog
      open={Boolean(entry)}
      onClose={() => !busy && onClose()}
      size="small"
      eyebrow="Tarea"
      title="Anular comentario"
      description="Esta acción no se puede deshacer."
      initialFocusRef={reasonRef}
      footer={<><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Volver</Button><Button type="submit" form={FORM_ID} variant="danger" loading={loading} disabled={busy && !loading}>Anular comentario</Button></>}
    >
      {entry && <AnnulBody key={entry.id} entry={entry} onAnnul={onAnnul} onClose={onClose} reasonRef={reasonRef} />}
    </ResponsiveDialog>
  );
}
