import React, {useEffect, useState} from "react";
import {Plus, Save} from "lucide-react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import StatusBadge from "../../components/ui/StatusBadge";
import {
  actualizarDiagnostico, completarDiagnostico, createWorkOrderRequestId,
  getWorkOrderErrorMessage, listarPersonasAsignablesTaller, registrarDiagnostico,
} from "../../services/workOrderService";

const OPERATION_ROLES = new Set(["OWNER", "ADMIN", "TECNICO", "MEMBER"]);
const emptyDraft = {responsableUid: "", descripcion: "", observaciones: ""};

function dateLabel(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("es-CL", {dateStyle: "medium", timeStyle: "short"})
    : "Pendiente";
}

export default function DiagnosisPanel({businessId, diagnoses, onChanged, order, otId, role}) {
  const canAccess = OPERATION_ROLES.has(String(role || "").toUpperCase());
  const canOperate = canAccess &&
    Boolean(order.recepcion) && !["ingresada", "pendiente_entrega", "cerrada", "cancelada"].includes(order.estado);
  const [people, setPeople] = useState([]);
  const [actors, setActors] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [requestId, setRequestId] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!canAccess) return;
    let active = true;
    setPeopleLoading(true);
    listarPersonasAsignablesTaller(businessId)
      .then(({personas, actores}) => { if (active) { setPeople(personas); setActors(actores); setPeopleError(""); } })
      .catch((loadError) => { if (active) setPeopleError(getWorkOrderErrorMessage(loadError)); })
      .finally(() => { if (active) setPeopleLoading(false); });
    return () => { active = false; };
  }, [businessId, canAccess]);

  const startNew = () => {
    setDraft(emptyDraft);
    setEditingId("new");
    setRequestId(createWorkOrderRequestId());
    setError("");
    setNotice("");
  };

  const startEdit = (diagnosis) => {
    setDraft({responsableUid: diagnosis.responsableUid, descripcion: diagnosis.descripcion, observaciones: diagnosis.observaciones});
    setEditingId(diagnosis.diagnosticoId);
    setError("");
    setNotice("");
  };

  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!draft.responsableUid) { setError("Selecciona un responsable."); return; }
    const diagnosis = diagnoses.find((item) => item.diagnosticoId === editingId);
    setBusy(true);
    setError("");
    try {
      if (editingId === "new") {
        await registrarDiagnostico(businessId, otId, draft, requestId);
      } else {
        await actualizarDiagnostico(businessId, otId, editingId, draft, diagnosis?.actualizadoEn?.toMillis?.());
      }
      await onChanged();
      setEditingId(null);
      setNotice("Borrador guardado correctamente.");
    } catch (saveError) {
      setError(getWorkOrderErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    const diagnosis = diagnoses.find((item) => item.diagnosticoId === confirmId);
    if (!diagnosis || busy) return;
    setBusy(true);
    setError("");
    try {
      await completarDiagnostico(businessId, otId, diagnosis.diagnosticoId, diagnosis.actualizadoEn?.toMillis?.());
      await onChanged();
      setConfirmId(null);
      setNotice("Diagnóstico completado. El registro quedó en modo lectura.");
    } catch (completeError) {
      setConfirmId(null);
      setError(getWorkOrderErrorMessage(completeError));
    } finally {
      setBusy(false);
    }
  };

  const personName = (uid) => actors.find((person) => person.uid === uid)?.nombre ||
    people.find((person) => person.uid === uid)?.nombre || "Usuario no disponible";

  return <section className="erp-panel" aria-labelledby="work-order-diagnoses-title">
    <div className="erp-panel-header">
      <div><h2 id="work-order-diagnoses-title" className="erp-panel-title">Diagnósticos</h2><p className="erp-secondary-text">Cada evaluación se conserva como un registro independiente.</p></div>
      {canOperate && editingId === null && <Button type="button" icon={Plus} onClick={startNew}>Nuevo diagnóstico</Button>}
    </div>
    {!order.recepcion && <div className="vehicle-message vehicle-message--warning" role="status">Registra la Recepción antes de iniciar un diagnóstico.</div>}
    {peopleError && <div className="vehicle-message vehicle-message--error" role="alert">{peopleError}</div>}
    {notice && <div className="vehicle-message" role="status">{notice}</div>}
    {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}

    {editingId !== null && <form className="vehicle-form work-order-diagnosis-form" onSubmit={save} noValidate>
      <h3>{editingId === "new" ? "Nuevo diagnóstico" : "Editar borrador"}</h3>
      <label className="erp-field"><span className="erp-field__label">Responsable *</span>
        <select className="erp-control" value={draft.responsableUid} disabled={busy || peopleLoading} onChange={(event) => setDraft((current) => ({...current, responsableUid: event.target.value}))}>
          <option value="">{peopleLoading ? "Cargando responsables..." : "Selecciona un responsable"}</option>
          {draft.responsableUid && !people.some((person) => person.uid === draft.responsableUid) && <option value={draft.responsableUid} disabled>Responsable anterior ya no asignable</option>}
          {people.map((person) => <option key={person.uid} value={person.uid}>{person.nombre}</option>)}
        </select>
      </label>
      <label className="erp-field"><span className="erp-field__label">Descripción</span><textarea className="erp-control work-order-reception-textarea" maxLength={5000} rows={4} value={draft.descripcion} onChange={(event) => setDraft((current) => ({...current, descripcion: event.target.value}))} placeholder="Describe la evaluación técnica. Es obligatoria para completar." /></label>
      <label className="erp-field"><span className="erp-field__label">Observaciones</span><textarea className="erp-control work-order-reception-textarea" maxLength={2000} rows={3} value={draft.observaciones} onChange={(event) => setDraft((current) => ({...current, observaciones: event.target.value}))} /></label>
      <div className="vehicle-form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => {setEditingId(null); setError("");}}>Cancelar</Button><Button type="submit" icon={Save} disabled={busy || peopleLoading}>{busy ? "Guardando..." : "Guardar borrador"}</Button></div>
    </form>}

    {!diagnoses.length && editingId === null && <div className="erp-empty-state" role="status">Aún no hay diagnósticos registrados.</div>}
    <div className="work-order-diagnoses-list">
      {diagnoses.map((diagnosis) => <article className="erp-record-card" key={diagnosis.diagnosticoId}>
        <header className="erp-record-card__header"><div><h3 className="erp-record-card__title">Diagnóstico · {personName(diagnosis.responsableUid)}</h3><p className="erp-secondary-text">Creado el {dateLabel(diagnosis.creadoEn)}</p></div><StatusBadge variant={diagnosis.estado === "completado" ? "success" : "neutral"}>{diagnosis.estado === "completado" ? "Completado" : "Borrador"}</StatusBadge></header>
        <dl className="erp-meta-grid"><div className="erp-meta"><dt className="erp-meta__label">Descripción</dt><dd className="erp-meta__value">{diagnosis.descripcion || "Sin descripción todavía"}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Observaciones</dt><dd className="erp-meta__value">{diagnosis.observaciones || "Sin observaciones"}</dd></div></dl>
        {diagnosis.estado === "completado" && <p className="erp-secondary-text">Completado el {dateLabel(diagnosis.completadoEn)} · Por {personName(diagnosis.completadoPorUid)}</p>}
        {canOperate && diagnosis.estado === "borrador" && editingId === null && <div className="vehicle-form-actions"><Button type="button" variant="secondary" onClick={() => startEdit(diagnosis)}>Editar</Button><Button type="button" disabled={!diagnosis.descripcion?.trim()} onClick={() => {setError(""); setConfirmId(diagnosis.diagnosticoId);}}>Completar diagnóstico</Button></div>}
      </article>)}
    </div>
    <ResponsiveDialog open={Boolean(confirmId)} onClose={() => !busy && setConfirmId(null)} size="small" eyebrow="Taller" title="Completar diagnóstico" description="El diagnóstico quedará en modo lectura. La nueva información deberá registrarse en otro diagnóstico." footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmId(null)}>Volver</Button><Button type="button" disabled={busy} onClick={complete}>{busy ? "Completando..." : "Completar diagnóstico"}</Button></>}><p>¿Confirmas que esta evaluación está lista para definir el alcance?</p></ResponsiveDialog>
  </section>;
}
