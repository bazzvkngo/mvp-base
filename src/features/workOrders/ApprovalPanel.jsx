import React, {useCallback, useEffect, useMemo, useState} from "react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import {
  createWorkOrderRequestId, ejecutarAccionAprobacionOT, ejecutarCierreOT, getWorkOrderErrorMessage,
  listarOrdenesTrabajo, listarPersonasAsignablesTaller, obtenerResumenAprobacionOT,
} from "../../services/workOrderService";
import {listarPlazasTaller} from "../../services/workshopPlazaService";
import {deriveWorkshopPlazaOccupancy} from "../../domain/workshopPlazaModel.mjs";
import {isWorkOrderWaitingForPlaza} from "../../domain/workOrderModel.mjs";

function Card({children, hint, title, titleId}) {
  return <section className="erp-panel work-order-reception-card" aria-labelledby={titleId}>
    <div className="work-order-reception-card__header">
      <h2 id={titleId} className="erp-panel-title">{title}</h2>
      {hint && <span className="erp-secondary-text">{hint}</span>}
    </div>
    {children}
  </section>;
}

// La aprobación es una compuerta (prototipo «Panel del Taller»): el Owner o el Administrador eligen
// responsable y dicen Aprobar, En espera o Anulada. La plaza se asigna sola.
export default function ApprovalPanel({businessId, otId, order, onChanged}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [people, setPeople] = useState([]);
  const [peopleError, setPeopleError] = useState("");
  const [responsableUid, setResponsableUid] = useState("");
  const [freePlaza, setFreePlaza] = useState(undefined);
  const [pending, setPending] = useState(null); // "rechazar" | "cancelar" mientras se pide el motivo
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const revision = order.actualizadoEn?.toMillis?.();

  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setSummary(null);
    obtenerResumenAprobacionOT(businessId, otId)
      .then(async (data) => {
        if (!active) return;
        setSummary(data);
        // Otra operación pudo cambiar la OT después de cargar la ficha.
        if (Number.isSafeInteger(data.revision) && data.revision !== revision) await onChanged();
      })
      .catch((failure) => { if (active) setError(getWorkOrderErrorMessage(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, otId, revision, reload]);

  const canDecide = Boolean(summary?.puedeDecidir && summary?.puedeAprobar);
  useEffect(() => {
    if (!canDecide) return undefined;
    let active = true;
    listarPersonasAsignablesTaller(businessId)
      .then((roster) => { if (active) { setPeople(roster.personas || []); setPeopleError(""); } })
      .catch((failure) => { if (active) setPeopleError(getWorkOrderErrorMessage(failure)); });
    // Vista previa de la plaza que se asignará (la asignación real la hace el servidor, por orden de llegada).
    Promise.all([listarPlazasTaller(businessId), listarOrdenesTrabajo(businessId)])
      .then(([plazas, orders]) => {
        if (!active) return;
        const occupied = deriveWorkshopPlazaOccupancy(plazas, orders);
        const free = plazas.filter((plaza) => plaza.estado === "activa" && !occupied.has(plaza.plazaId))
          .sort((left, right) => String(left.nombre).localeCompare(String(right.nombre), "es", {numeric: true}))[0];
        setFreePlaza(free ? free.nombre : null);
      })
      .catch(() => { if (active) setFreePlaza(undefined); });
    return () => { active = false; };
  }, [businessId, canDecide, revision]);

  const approved = summary?.estadoAprobacion === "aprobada";
  const waitingForPlaza = approved && isWorkOrderWaitingForPlaza(order);
  const onHold = summary?.estadoAprobacion === "rechazada";
  const cancelled = order.estado === "cancelada";
  const missingPhotos = Array.isArray(summary?.fotosFaltantes) ? summary.fotosFaltantes : [];
  const previousDamages = Array.isArray(summary?.danosPrevios) ? summary.danosPrevios : [];
  const checklist = useMemo(() => {
    if (!order.recepcion) return [];
    const reception = order.recepcion;
    return [
      {label: "Motivo del cliente registrado", done: Boolean(reception.motivoCliente)},
      {label: previousDamages.length
        ? `Fotos de las 6 zonas y del tablero · daños previos en ${previousDamages.length} zona(s)`
        : "Fotos de las 6 zonas y del tablero", done: missingPhotos.length === 0},
      {label: "Kilometraje, combustible y sensores", done: Boolean(reception.nivelCombustible)},
    ];
  }, [order.recepcion, missingPhotos.length, previousDamages.length]);

  const run = useCallback(async (task, success) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await task();
      setPending(null); setReason(""); setReasonError("");
      setNotice(typeof success === "function" ? success(result) : success);
      await onChanged();
      setReload((value) => value + 1);
    } catch (failure) {
      setError(getWorkOrderErrorMessage(failure));
      if (String(failure?.code).includes("aborted")) { setPending(null); setSummary(null); setReload((value) => value + 1); }
    } finally { setBusy(false); }
  }, [busy, onChanged]);

  const approve = () => {
    if (!responsableUid) return;
    return run(() => ejecutarAccionAprobacionOT(businessId, otId, "aprobar", createWorkOrderRequestId(),
      summary.revision, "", responsableUid), (result) => result?.enEsperaDePlaza
      ? "Ingreso aprobado. No hay plazas libres: la OT queda en cola y se le asignará una plaza automáticamente."
      : "Ingreso aprobado. Ya se pueden registrar los trabajos en la ejecución.");
  };
  const confirmReason = () => {
    if (!reason.trim()) { setReasonError("Indica el motivo."); return; }
    if (pending === "rechazar") {
      return run(() => ejecutarAccionAprobacionOT(businessId, otId, "rechazar", createWorkOrderRequestId(),
        summary.revision, reason), "OT en espera. Queda registrado el motivo.");
    }
    return run(() => ejecutarCierreOT(businessId, otId, "cancelar", summary.revision,
      createWorkOrderRequestId(), reason), "OT anulada. El vehículo se retira.");
  };

  const plazaLine = freePlaza === undefined ? null
    : freePlaza ? `${freePlaza} · se asigna automáticamente`
      : "Sin plazas libres: la OT queda en cola hasta que se libere una";

  return <>
    <Card title="Aprobación de ingreso" titleId="work-order-approval-title"
      hint={canDecide ? "Decide si el vehículo avanza a Ejecución." : undefined}>
      {loading && <LoadingState variant="section" label="Cargando aprobación..." />}
      {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
      {notice && <div className="vehicle-message" role="status">{notice}</div>}
      {summary && !loading && <>
        {checklist.length > 0 && <ul className="work-order-requirements" aria-label="Recepción">
          {checklist.map((item) => <li key={item.label} data-done={item.done ? "true" : undefined}>{item.label}</li>)}
          {previousDamages.map((damage) => <li key={damage.zona} className="work-order-requirements__damage">
            Daño previo · {damage.zona}: {damage.notas.join("; ")}
          </li>)}
        </ul>}
        {!order.recepcion && <p className="erp-secondary-text">Registra la recepción para poder decidir el ingreso.</p>}
        {cancelled && <div className="vehicle-message vehicle-message--warning" role="status">
          <strong>OT anulada.</strong>{order.motivoCancelacion ? ` Motivo: ${order.motivoCancelacion}` : ""}</div>}
        {!cancelled && approved && !waitingForPlaza && <div className="vehicle-message" role="status">Ingreso aprobado{order.responsableNombre ? ` · Responsable: ${order.responsableNombre}` : ""}.</div>}
        {!cancelled && waitingForPlaza && <div className="vehicle-message vehicle-message--warning" role="status"><strong>En cola de plaza.</strong> El ingreso está aprobado. Se asignará la primera plaza que se libere, por orden de aprobación.</div>}
        {!cancelled && onHold && <div className="vehicle-message vehicle-message--warning" role="status">
          <strong>OT en espera.</strong>{order.motivoRechazo ? ` Motivo: ${order.motivoRechazo}` : ""} Puedes aprobarla cuando se resuelva.</div>}
        {summary.puedeDecidir && !summary.puedeAprobar && <p className="erp-secondary-text">
          Recepción registrada. Esperando la aprobación de Administración u Owner.</p>}
        {canDecide && !cancelled && !approved && <>
          {missingPhotos.length > 0 && <div className="vehicle-message vehicle-message--warning" role="status">
            <strong>Faltan fotos de recepción:</strong> {missingPhotos.join(", ")}. Complétalas en el paso Recepción para poder aprobar.
          </div>}
          <label className="erp-field"><span className="erp-field__label">Responsable de la ejecución</span>
            <select className="erp-control" value={responsableUid} disabled={busy} onChange={(event) => setResponsableUid(event.target.value)}>
              <option value="">Elegir técnico</option>
              {people.map((person) => <option key={person.uid} value={person.uid}>{person.nombre}</option>)}
            </select>
            <span className="erp-secondary-text">Solo el responsable, el Administrador o el Owner operan los trabajos de la OT.</span>
            {peopleError && <span className="work-order-field-error" role="alert">{peopleError}</span>}</label>
          {plazaLine && <p className="erp-secondary-text work-order-approval-plaza">Plaza {plazaLine}</p>}
          {pending && <label className="erp-field"><span className="erp-field__label">
            {pending === "rechazar" ? "Motivo obligatorio (falta algo para continuar)" : "Motivo de la anulación (el vehículo se retira)"}</span>
            <textarea className="erp-control" value={reason} maxLength={2000} disabled={busy} autoFocus
              onChange={(event) => { setReason(event.target.value); setReasonError(""); }} />
            {reasonError && <span className="work-order-field-error" role="alert">{reasonError}</span>}</label>}
          <div className="vehicle-form-actions work-order-approval-actions">
            {!pending && <>
              <Button type="button" disabled={busy || !responsableUid || missingPhotos.length > 0} onClick={approve}>
                {responsableUid ? "Aprobar ingreso" : "Elige responsable"}</Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => { setPending("rechazar"); setReason(""); setReasonError(""); }}>En espera</Button>
              <Button type="button" variant="ghost-danger" disabled={busy} onClick={() => { setPending("cancelar"); setReason(""); setReasonError(""); }}>Anulada</Button>
            </>}
            {pending && <>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => { setPending(null); setReasonError(""); }}>Volver</Button>
              <Button type="button" variant={pending === "cancelar" ? "danger" : "primary"} disabled={busy} onClick={confirmReason}>
                {busy ? "Procesando..." : pending === "cancelar" ? "Confirmar anulación" : "Confirmar espera"}</Button>
            </>}
          </div>
        </>}
      </>}
    </Card>
  </>;
}
