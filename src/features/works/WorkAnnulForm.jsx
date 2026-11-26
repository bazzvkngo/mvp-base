import React, {useRef, useState} from "react";
import Button from "../../components/ui/Button";
import {CostField, WorkFormError} from "./WorkCostParts.jsx";
import useWorkFormSubmit from "./useWorkFormSubmit.js";

// Formulario de anulación de un registro (gasto, horas o adicional): motivo obligatorio, requestId estable
// en los reintentos, error del backend dentro del formulario y botón con loading.
// `onAnnul(motivo, requestId, onError)` devuelve una promesa con true si se anuló; la página resuelve la
// Function. Un motivo vacío (o solo espacios) no se envía: el mensaje queda bajo el campo.
export default function WorkAnnulForm({className = "works-annul-form", label, onAnnul, placeholder = "Motivo de anulación", prefix, processing = "", processingKey, submitLabel, submitVariant = "danger", visibleLabel = true}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState("");
  const inputRef = useRef(null);
  const form = useWorkFormSubmit({prefix});
  const busy = Boolean(processing);
  const loading = busy && processing === processingKey;
  const describedBy = fieldError ? `${processingKey}-reason-error` : undefined;
  const input = <input aria-describedby={describedBy} aria-invalid={fieldError ? "true" : undefined} aria-label={visibleLabel ? undefined : label} className="erp-control" maxLength="1000" placeholder={placeholder} ref={inputRef} required value={reason} onChange={(event) => { setReason(event.target.value); setFieldError(""); form.clearError(); }} />;
  const submit = (event) => {
    event.preventDefault();
    const motivo = reason.trim();
    if (!motivo) { setFieldError("Escribe el motivo de la anulación."); inputRef.current?.focus(); return; }
    form.submit({motivo}, (requestId, onError) => onAnnul(motivo, requestId, onError)).then((success) => { if (success) setReason(""); });
  };
  return (
    <form className={className} onSubmit={submit}>
      {visibleLabel ? <CostField label={label}>{input}</CostField> : input}
      <Button type="submit" variant={submitVariant} loading={loading} disabled={busy && !loading}>{submitLabel}</Button>
      {fieldError && <small className="works-field-error" id={describedBy}>{fieldError}</small>}
      <WorkFormError error={form.error} noticeRef={form.noticeRef} title="No se pudo anular el registro" />
    </form>
  );
}
