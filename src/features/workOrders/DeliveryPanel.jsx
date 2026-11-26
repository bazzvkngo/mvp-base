import React, {useCallback, useEffect, useMemo, useState} from "react";
import {Camera, CircleCheck} from "lucide-react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {RECEPTION_DASHBOARD_ZONE, RECEPTION_VEHICLE_ZONES} from "../../domain/workOrderReceptionPhotoModel.mjs";
import {
  createWorkOrderRequestId, ejecutarCierreOT, getWorkOrderErrorMessage, leerFotoEntregaOT, leerFotoRecepcionOT,
  obtenerActaEntregaOT, obtenerEstadoEntregaOT, subirFotoEntregaOT,
} from "../../services/workOrderService";
import CarSilhouette from "./CarSilhouette";
import ClientContactCard from "./ClientContactCard";
import ReceptionPhotoCapture, {PhotoWithMarks} from "./ReceptionPhotoCapture";

const EMPTY_FORM = {receptorNombre: "", receptorDocumento: "", observaciones: "", conforme: false};

function Card({children, hint, title}) {
  return <section className="erp-panel work-order-reception-card">
    <div className="work-order-reception-card__header">
      <h2 className="erp-panel-title">{title}</h2>
      {hint && <span className="erp-secondary-text">{hint}</span>}
    </div>
    {children}
  </section>;
}

function formatStamp(millis) {
  if (!Number.isSafeInteger(millis)) return "Fecha no disponible";
  return new Date(millis).toLocaleString("es-CL", {dateStyle: "medium", timeStyle: "short"});
}

// Entrega con trazabilidad (misma presentación que la recepción): silueta con las seis zonas, foto del tablero,
// quién retira y su conformidad. Con la OT cerrada, cada zona se compara «Recepción | Entrega».
export default function DeliveryPanel({businessId, canManage, canOperate, onChanged, order, otId, vehicleLabel}) {
  const pendingDelivery = order.estado === "pendiente_entrega";
  const closed = order.estado === "cerrada";
  const [status, setStatus] = useState(null);
  const [acta, setActa] = useState(null);
  const [error, setError] = useState("");
  const [capture, setCapture] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [registering, setRegistering] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [viewer, setViewer] = useState(null);
  const revision = order.actualizadoEn?.toMillis?.();

  const load = useCallback(async () => {
    if (!pendingDelivery && !closed) return;
    try {
      setStatus(await obtenerEstadoEntregaOT(businessId, otId));
      if (closed && canManage) setActa(await obtenerActaEntregaOT(businessId, otId).catch(() => null));
      setError("");
    } catch (failure) { setError(getWorkOrderErrorMessage(failure)); }
  }, [businessId, otId, pendingDelivery, closed, canManage]);
  useEffect(() => { void load(); }, [load, revision]);

  const done = useMemo(() => new Set((status?.fotos || []).filter((photo) => photo.completa).map((photo) => photo.zona)), [status]);
  const zones = useMemo(() => RECEPTION_VEHICLE_ZONES.map((zone) => ({
    ...zone, completed: done.has(zone.id), withDamages: false, damageCount: 0,
  })), [done]);
  const dashboardDone = done.has(RECEPTION_DASHBOARD_ZONE.id);
  const missing = status?.faltantes || [];
  const ready = pendingDelivery && status && missing.length === 0;
  const stamps = useMemo(() => Object.fromEntries((status?.fotos || []).map((photo) => [photo.zona, photo])), [status]);

  const openZone = async (zone) => {
    if (closed) {
      // Cómo llegó y cómo se retiró: la foto de recepción junto a la de entrega.
      const marks = order.fotosRecepcion?.[zone.id]?.conDanos ? order.fotosRecepcion[zone.id].marcas || [] : [];
      setViewer({zone, marks, reception: "", delivery: "", loading: true, error: ""});
      try {
        const [reception, delivery] = await Promise.all([
          leerFotoRecepcionOT(businessId, otId, zone.id), leerFotoEntregaOT(businessId, otId, zone.id)]);
        setViewer({zone, marks, reception: `data:image/jpeg;base64,${reception}`, delivery: `data:image/jpeg;base64,${delivery.imagen}`, loading: false, error: ""});
      } catch (failure) { setViewer({zone, marks, reception: "", delivery: "", loading: false, error: getWorkOrderErrorMessage(failure)}); }
      return;
    }
    if (!done.has(zone.id)) { if (canOperate) setCapture(zone); return; }
    setViewer({zone, marks: [], reception: "", delivery: "", loading: true, error: ""});
    try {
      const delivery = await leerFotoEntregaOT(businessId, otId, zone.id);
      setViewer({zone, marks: [], reception: "", delivery: `data:image/jpeg;base64,${delivery.imagen}`, loading: false, error: ""});
    } catch (failure) { setViewer({zone, marks: [], reception: "", delivery: "", loading: false, error: getWorkOrderErrorMessage(failure)}); }
  };

  const askRegister = () => {
    if (!form.receptorNombre.trim() || !form.receptorDocumento.trim()) { setFormError("Indica el nombre y el RUT de quien retira el vehículo."); return; }
    if (!form.conforme) { setFormError("Confirma que el cliente revisó el vehículo y lo recibe."); return; }
    setFormError(""); setConfirmOpen(true);
  };

  const register = async () => {
    if (registering) return;
    setRegistering(true); setFormError("");
    try {
      await ejecutarCierreOT(businessId, otId, "entregar", revision, createWorkOrderRequestId(), "", form);
      setConfirmOpen(false); setForm(EMPTY_FORM);
      await onChanged();
    } catch (failure) {
      setConfirmOpen(false);
      setFormError(getWorkOrderErrorMessage(failure));
      if (String(failure?.code || "").includes("aborted")) { try { await onChanged(); } catch (_ignored) { /* la ficha se recarga sola */ } }
    } finally { setRegistering(false); }
  };

  if (!pendingDelivery && !closed) {
    return <div className="erp-empty-state" role="status">El vehículo estará listo para entrega al finalizar la ejecución.</div>;
  }
  if (!status) {
    return error
      ? <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>
      : <LoadingState variant="section" label="Cargando entrega..." />;
  }

  const captureProps = (zone) => ({
    businessId, otId, zone, label: "Foto de entrega",
    zoneNumber: RECEPTION_VEHICLE_ZONES.findIndex((item) => item.id === zone.id) + 1,
    onCancel: () => setCapture(null), onDone: () => setCapture(null), onSaved: load,
    onUpload: (base64) => subirFotoEntregaOT(businessId, otId, zone.id, base64),
  });
  const capturingVehicle = Boolean(capture && capture.id !== RECEPTION_DASHBOARD_ZONE.id);
  const capturingDashboard = Boolean(capture && capture.id === RECEPTION_DASHBOARD_ZONE.id);
  const photosTaken = zones.filter((zone) => zone.completed).length + (dashboardDone ? 1 : 0);

  return <div className="work-order-reception work-order-delivery">
    {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    {pendingDelivery && <div className="vehicle-message vehicle-message--warning work-order-delivery-notice" role="status">
      <strong>Vehículo listo para entrega.</strong> Fotografía cómo lo recibe el cliente ({photosTaken} de 7 fotos). La evidencia queda sellada y no se puede modificar.</div>}
    {closed && <div className="vehicle-message" role="status">Entrega registrada{status.entregadaEn ? ` (${formatStamp(status.entregadaEn)})` : ""}. La OT está cerrada.</div>}
    {pendingDelivery && canOperate && <ClientContactCard businessId={businessId} order={order} otId={otId} vehicleLabel={vehicleLabel} />}

    <Card title="Fotos del vehículo" hint={`${zones.filter((zone) => zone.completed).length} de 6`}>
      {capturingVehicle
        ? <>
          <p className="erp-secondary-text">Zona {captureProps(capture).zoneNumber} de 6. La foto queda sellada con fecha y usuario, y no se puede editar.</p>
          <ReceptionPhotoCapture key={capture.id} {...captureProps(capture)} />
        </>
        : <>
          <p className="erp-secondary-text">{closed
            ? "Toca una zona para ver cómo llegó y cómo se retiró el vehículo."
            : canOperate ? "Toca una zona para abrir la cámara con la guía de encuadre." : "Fotos de entrega registradas. Toca una zona fotografiada para verla."}</p>
          <div className="work-order-reception-card__photos">
            <CarSilhouette zones={zones} onSelect={openZone} />
            <ul className="work-order-zone-list">
              {zones.map((zone, index) => <li key={zone.id}>
                <button type="button" data-completed={zone.completed ? "true" : undefined}
                  disabled={!zone.completed && !canOperate} onClick={() => openZone(zone)}>
                  <span className="work-order-zone-list__dot" aria-hidden="true" />
                  <span>{index + 1}. {zone.label}{zone.completed && <span className="work-order-zone-list__ok"> · fotografiada</span>}</span>
                </button>
              </li>)}
            </ul>
          </div>
        </>}
    </Card>

    <Card title="Tablero" hint={dashboardDone ? "Tomada" : "Obligatoria"}>
      {capturingDashboard
        ? <ReceptionPhotoCapture key={capture.id} {...captureProps(capture)} />
        : <Button type="button" variant={dashboardDone ? "secondary" : "primary"} icon={dashboardDone ? CircleCheck : Camera}
          disabled={!dashboardDone && !canOperate}
          onClick={() => (closed ? openZone(RECEPTION_DASHBOARD_ZONE) : dashboardDone ? openZone(RECEPTION_DASHBOARD_ZONE) : setCapture(RECEPTION_DASHBOARD_ZONE))}>
          {dashboardDone ? "Ver foto del tablero" : "Fotografiar tablero"}</Button>}
    </Card>

    {pendingDelivery && canOperate && <Card title="Quién retira el vehículo" hint="Queda registrado en el acta">
      <div className="work-order-delivery__form">
        <label className="erp-field"><span className="erp-field__label">Nombre de quien retira *</span>
          <input className="erp-control" value={form.receptorNombre} maxLength={120} disabled={registering}
            onChange={(event) => setForm((current) => ({...current, receptorNombre: event.target.value}))} /></label>
        <label className="erp-field"><span className="erp-field__label">RUT de quien retira *</span>
          <input className="erp-control" value={form.receptorDocumento} maxLength={20} disabled={registering} placeholder="12.345.678-5"
            onChange={(event) => setForm((current) => ({...current, receptorDocumento: event.target.value}))} /></label>
        <label className="erp-field"><span className="erp-field__label">Observaciones del cliente (opcional)</span>
          <textarea className="erp-control" rows={2} maxLength={1000} value={form.observaciones} disabled={registering}
            onChange={(event) => setForm((current) => ({...current, observaciones: event.target.value}))} /></label>
        <label className="work-order-delivery__agree">
          <input type="checkbox" checked={form.conforme} disabled={registering}
            onChange={(event) => setForm((current) => ({...current, conforme: event.target.checked}))} />
          <span>El cliente revisó el vehículo y lo recibe en el estado que muestran las fotos de entrega.</span></label>
      </div>
    </Card>}

    {pendingDelivery && canOperate && <Card title="Para registrar la entrega">
      <ul className="work-order-requirements" aria-label="Para registrar la entrega">
        <li data-done={zones.every((zone) => zone.completed) ? "true" : undefined}>Las 6 zonas del vehículo fotografiadas ({zones.filter((zone) => zone.completed).length}/6)</li>
        <li data-done={dashboardDone ? "true" : undefined}>Foto del tablero</li>
        <li data-done={form.receptorNombre.trim() && form.receptorDocumento.trim() ? "true" : undefined}>Nombre y RUT de quien retira</li>
        <li data-done={form.conforme ? "true" : undefined}>Conformidad del cliente</li>
      </ul>
      {formError && <div className="vehicle-message vehicle-message--error" role="alert">{formError}</div>}
      <div className="vehicle-form-actions">
        <Button type="button" disabled={!ready || registering} onClick={askRegister}>Registrar entrega</Button>
      </div>
    </Card>}

    {closed && <Card title="Acta de entrega">
      <dl className="vehicle-detail-grid">
        <div className="vehicle-detail-item"><dt>Retira</dt><dd>{acta?.receptorNombre || status.receptorNombre || "No disponible"}</dd></div>
        {acta && <div className="vehicle-detail-item"><dt>RUT</dt><dd>{acta.receptorDocumento}</dd></div>}
        <div className="vehicle-detail-item"><dt>Entregó</dt><dd>{status.entregadaPorNombre || "No disponible"}</dd></div>
        <div className="vehicle-detail-item"><dt>Fecha</dt><dd>{formatStamp(status.entregadaEn)}</dd></div>
        {acta?.observaciones && <div className="vehicle-detail-item"><dt>Observaciones del cliente</dt><dd>{acta.observaciones}</dd></div>}
      </dl>
    </Card>}

    <ResponsiveDialog open={confirmOpen} onClose={() => !registering && setConfirmOpen(false)} size="small" eyebrow="Taller" title="Registrar entrega"
      description="Se registrará la entrega física, quedará sellada la evidencia y la OT se cerrará."
      footer={<><Button type="button" variant="secondary" disabled={registering} onClick={() => setConfirmOpen(false)}>Volver</Button>
        <Button type="button" disabled={registering} onClick={register}>{registering ? "Procesando..." : "Confirmar"}</Button></>}>
      <p>¿Confirmas que {form.receptorNombre.trim() || "la persona indicada"} retira el vehículo? Esta acción no se puede deshacer.</p>
    </ResponsiveDialog>

    <ResponsiveDialog open={Boolean(viewer)} onClose={() => setViewer(null)} size="large" eyebrow={order.numeroOT || "Entrega"}
      title={viewer ? `${viewer.zone.label}${viewer.reception ? " · Recepción y entrega" : " · Entrega"}` : "Foto"}
      description={viewer && stamps[viewer.zone.id]?.subidaEn ? `Entrega: ${formatStamp(stamps[viewer.zone.id].subidaEn)} · ${stamps[viewer.zone.id].subidaPorNombre || ""} · No editable` : ""}
      footer={<Button type="button" variant="secondary" onClick={() => setViewer(null)}>Cerrar</Button>}>
      {viewer?.loading && <LoadingState variant="section" label="Cargando fotos..." />}
      {viewer?.error && <div className="vehicle-message vehicle-message--error" role="alert">{viewer.error}</div>}
      {viewer && !viewer.loading && !viewer.error && <div className="work-order-delivery__compare" data-pair={viewer.reception ? "true" : undefined}>
        {viewer.reception && <figure><figcaption>Recepción · cómo llegó</figcaption>
          <PhotoWithMarks src={viewer.reception} alt={`Recepción: ${viewer.zone.label}`} marks={viewer.marks} />
          {viewer.marks.length > 0 && <ol className="work-order-damage-notes">{viewer.marks.map((mark, index) => <li key={index}>{mark.nota}</li>)}</ol>}</figure>}
        {viewer.delivery && <figure><figcaption>Entrega · cómo se retiró</figcaption>
          <PhotoWithMarks src={viewer.delivery} alt={`Entrega: ${viewer.zone.label}`} /></figure>}
      </div>}
    </ResponsiveDialog>
  </div>;
}
