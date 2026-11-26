import React, {useCallback, useEffect, useMemo, useState} from "react";
import {ExternalLink, Lock, MapPin, Pencil, Plus, Power, PowerOff, RefreshCw} from "lucide-react";
import {Link, useNavigate} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import LoadingState from "../components/ui/LoadingState";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {BayBadge, ProgressRing, TopCar} from "../features/workOrders/WorkshopVisuals";
import {
  canManageWorkshopPlazas,
  deriveWorkshopPlazaOccupancy,
  getPlazaBayStatus,
  getWorkshopPlazaFieldErrors,
  plazaWorkProgress,
  workshopOccupancySummary,
  workshopWaitingQueue,
} from "../domain/workshopPlazaModel.mjs";
import {listarVehiculos} from "../services/vehicleService";
import {listarOrdenesTrabajo, listarServiciosOT} from "../services/workOrderService";
import {
  actualizarPlazaTaller,
  cambiarEstadoPlazaTaller,
  crearPlazaTaller,
  createWorkshopPlazaRequestId,
  getWorkshopPlazaErrorMessage,
  listarPlazasTaller,
} from "../services/workshopPlazaService";

function vehicleLabel(vehicle) {
  return vehicle ? `${vehicle.marca} ${vehicle.modelo} · ${vehicle.patente}` : "Vehículo no disponible";
}

function vehicleName(vehicle) {
  return vehicle ? `${vehicle.marca} ${vehicle.modelo}` : "Vehículo no disponible";
}

function progressText(progress) {
  if (!progress) return "Cargando trabajos...";
  return progress.total ? `${progress.terminados} de ${progress.total} trabajos terminados` : "Definiendo trabajos";
}

function PlazaBay({conflict, onSelect, order, plaza, progress, selected, vehicle}) {
  const inactive = plaza.estado !== "activa";
  const status = order ? getPlazaBayStatus(order) : null;
  const kind = order ? "occupied" : inactive ? "inactive" : "free";
  return <button type="button" className="workshop-bay" data-kind={kind} aria-pressed={selected} onClick={onSelect}>
    <span className="workshop-bay__head">
      <strong>{plaza.nombre}</strong>
      {status ? <BayBadge tone={status.tone}>{status.label}</BayBadge>
        : inactive ? <BayBadge tone="neutral">Inactiva</BayBadge> : <BayBadge tone="success">Libre</BayBadge>}
    </span>
    {order
      ? <>
        <span className="workshop-bay__vehicle">
          <TopCar tone={status.tone} />
          <span><strong>{vehicleName(vehicle)}</strong>
            <span className="erp-secondary-text">{vehicle?.patente || "Sin patente"} · {order.numeroOT}</span></span>
        </span>
        <span className="workshop-bay__foot">
          <span className="erp-secondary-text">{progressText(progress)}<br />{order.responsableNombre || "Sin responsable"}</span>
          <ProgressRing value={progress?.porcentaje || 0} />
        </span>
      </>
      : <span className="workshop-bay__empty">
        {inactive ? <Lock size={26} aria-hidden="true" /> : <span className="workshop-bay__p" aria-hidden="true">P</span>}
        <span className="erp-secondary-text">{inactive ? "No recibe vehículos" : "Disponible"}</span>
      </span>}
    {conflict && <span className="vehicle-field-error">Conflicto: más de una OT activa en esta plaza.</span>}
  </button>;
}

export default function WorkshopPlazasPage({businessId, role}) {
  const canManage = canManageWorkshopPlazas(role);
  const navigate = useNavigate();
  const [plazas, setPlazas] = useState([]);
  const [orders, setOrders] = useState([]);
  const [vehiclesById, setVehiclesById] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formTarget, setFormTarget] = useState(null);
  const [nombre, setNombre] = useState("");
  const [requestId, setRequestId] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [formError, setFormError] = useState("");
  const [stateTarget, setStateTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [progressByOrder, setProgressByOrder] = useState(new Map());

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError("");
    try {
      const [plazaItems, orderItems, vehicleItems] = await Promise.all([
        listarPlazasTaller(businessId), listarOrdenesTrabajo(businessId), listarVehiculos(businessId),
      ]);
      setPlazas(plazaItems);
      setOrders(orderItems);
      setVehiclesById(new Map(vehicleItems.map((vehicle) => [vehicle.vehiculoId, vehicle])));
    } catch (failure) {
      setError(getWorkshopPlazaErrorMessage(failure));
    } finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => {
    if (canManage) load();
  }, [canManage, load]);

  const occupancy = useMemo(() => deriveWorkshopPlazaOccupancy(plazas, orders), [orders, plazas]);

  // Avance de los trabajos de cada OT que ocupa una plaza (sin montos). Si falla, la plaza se muestra igual.
  useEffect(() => {
    let active = true;
    const occupiedOrders = [...occupancy.values()].map((entry) => entry.order).filter(Boolean);
    Promise.all(occupiedOrders.map((order) => listarServiciosOT(businessId, order.otId)
      .then((services) => [order.otId, plazaWorkProgress(services)])
      .catch(() => [order.otId, null])))
      .then((entries) => { if (active) setProgressByOrder(new Map(entries.filter(([, progress]) => progress))); });
    return () => { active = false; };
  }, [businessId, occupancy]);

  const openCreate = () => {
    setFormTarget({mode: "create"}); setNombre(""); setRequestId(createWorkshopPlazaRequestId());
    setFieldError(""); setFormError(""); setNotice("");
  };
  const openEdit = (plaza) => {
    setFormTarget({mode: "edit", plaza}); setNombre(plaza.nombre); setRequestId("");
    setFieldError(""); setFormError(""); setNotice("");
  };

  const save = async (event) => {
    event.preventDefault();
    if (!formTarget || saving) return;
    const nextErrors = getWorkshopPlazaFieldErrors({nombre});
    setFieldError(nextErrors.nombre || "");
    if (nextErrors.nombre) return;
    setSaving(true); setFormError("");
    try {
      if (formTarget.mode === "create") await crearPlazaTaller(businessId, nombre, requestId);
      else await actualizarPlazaTaller(
        businessId,
        formTarget.plaza.plazaId,
        nombre,
        formTarget.plaza.actualizadoEn?.toMillis?.(),
      );
      setFormTarget(null);
      setNotice(formTarget.mode === "create" ? "Plaza creada correctamente." : "Plaza actualizada correctamente.");
      await load();
    } catch (failure) { setFormError(getWorkshopPlazaErrorMessage(failure)); }
    finally { setSaving(false); }
  };

  const changeState = async () => {
    if (!stateTarget || saving) return;
    const nextState = stateTarget.estado === "activa" ? "inactiva" : "activa";
    setSaving(true); setError("");
    try {
      await cambiarEstadoPlazaTaller(
        businessId, stateTarget.plazaId, nextState, stateTarget.actualizadoEn?.toMillis?.(),
      );
      setStateTarget(null);
      setNotice(nextState === "activa" ? "Plaza activada correctamente." : "Plaza inactivada correctamente.");
      await load();
    } catch (failure) {
      setStateTarget(null);
      setError(getWorkshopPlazaErrorMessage(failure));
    } finally { setSaving(false); }
  };

  if (!canManage) {
    return <main className="erp-page workshop-plazas-page">
      <div className="erp-module-intro">
        <div className="erp-page-intro"><p>Administración de ubicaciones físicas del Taller.</p></div>
      </div>
      <div className="vehicle-message vehicle-message--warning" role="status">El acceso a Plazas está restringido para tu perfil. Propietario o Administrador pueden administrar esta sección.</div>
    </main>;
  }

  const summary = workshopOccupancySummary(plazas, occupancy);
  const queue = workshopWaitingQueue(orders);
  const selected = plazas.find((plaza) => plaza.plazaId === selectedId) || null;
  const selectedOrder = selected ? occupancy.get(selected.plazaId)?.order : null;

  return <main className="erp-page workshop-plazas-page">
    <div className="erp-module-intro">
      <div className="erp-page-intro"><p>Administra ubicaciones físicas y consulta su ocupación actual.</p></div>
      {canManage && <Button type="button" icon={Plus} onClick={openCreate}>Nueva Plaza</Button>}
    </div>
    {notice && <div className="vehicle-message" role="status">{notice}</div>}
    {error && <div className="vehicle-message vehicle-message--error" role="alert"><span>{error}</span><Button type="button" variant="secondary" icon={RefreshCw} onClick={load}>Reintentar</Button></div>}
    <section className="erp-panel workshop-bays-panel" aria-labelledby="workshop-plazas-title">
      <div className="erp-panel-header">
        <div><h2 id="workshop-plazas-title" className="erp-panel-title">Ocupación del taller</h2>
          <p className="erp-secondary-text">La ocupación se deriva de las OT activas: no es un estado guardado.</p></div>
        {!loading && plazas.length > 0 && <span className="erp-secondary-text">{summary.ocupadas} de {summary.activas} plazas activas · {summary.porcentaje}%</span>}
      </div>
      {loading ? <LoadingState variant="section" label="Cargando Plazas..." /> : !error && plazas.length === 0 ? <div className="erp-empty-state"><AppIcon icon={MapPin} size={28} /><h3>Aún no hay Plazas</h3><p>Crea la primera ubicación física del Taller.</p><Button type="button" icon={Plus} onClick={openCreate}>Crear primera Plaza</Button></div> : !error && <>
        <div className="workshop-bays__bar" role="progressbar" aria-label="Ocupación del taller" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.porcentaje}>
          <i style={{inlineSize: `${summary.porcentaje}%`}} />
        </div>
        <div className="workshop-bays__legend" aria-label="Estados de las plazas">
          <BayBadge tone="warning">En revisión</BayBadge><BayBadge tone="info">En reparación</BayBadge>
          <BayBadge tone="success">Listo para retiro</BayBadge><BayBadge tone="neutral">Inactiva</BayBadge>
        </div>
        <ul className="workshop-bays">
          {plazas.map((plaza) => {
            const occupied = occupancy.get(plaza.plazaId);
            return <li key={plaza.plazaId}>
              <PlazaBay plaza={plaza} order={occupied?.order} conflict={occupied?.conflict}
                vehicle={occupied?.order ? vehiclesById.get(occupied.order.vehiculoId) : null}
                progress={occupied?.order ? progressByOrder.get(occupied.order.otId) : null}
                selected={plaza.plazaId === selectedId}
                onSelect={() => setSelectedId((current) => current === plaza.plazaId ? "" : plaza.plazaId)} />
            </li>;
          })}
        </ul>
      </>}
    </section>

    {selected && <section className="erp-panel workshop-bay-detail" aria-labelledby="workshop-bay-detail-title">
      <div className="erp-panel-header">
        <h2 id="workshop-bay-detail-title" className="erp-panel-title">{selected.nombre}</h2>
        <button type="button" className="work-order-link-button" onClick={() => setSelectedId("")}>Cerrar</button>
      </div>
      {selectedOrder
        ? <div className="workshop-bay-detail__body">
          <strong>{vehicleLabel(vehiclesById.get(selectedOrder.vehiculoId))}</strong>
          <span className="erp-secondary-text">{selectedOrder.numeroOT} · Responsable: {selectedOrder.responsableNombre || "Sin asignar"} · {progressText(progressByOrder.get(selectedOrder.otId))}</span>
          <BayBadge tone={getPlazaBayStatus(selectedOrder).tone}>{getPlazaBayStatus(selectedOrder).label}</BayBadge>
        </div>
        : <p className="erp-secondary-text">{selected.estado === "activa"
          ? "Plaza libre. La siguiente OT aprobada la ocupa automáticamente."
          : "Plaza inactiva: no recibe vehículos ni entra en la ocupación."}</p>}
      <div className="erp-module-actions">
        {selectedOrder && <Button type="button" variant="secondary" icon={ExternalLink} onClick={() => navigate(`/taller/ordenes/${selectedOrder.otId}`)}>Abrir OT</Button>}
        <Button type="button" variant="secondary" icon={Pencil} onClick={() => openEdit(selected)}>Editar</Button>
        <Button type="button" variant="secondary" icon={selected.estado === "activa" ? PowerOff : Power} onClick={() => setStateTarget(selected)}>{selected.estado === "activa" ? "Inactivar" : "Activar"}</Button>
      </div>
      <p className="erp-secondary-text">Las plazas con historial no se eliminan, se inactivan.</p>
    </section>}

    {!loading && !error && <section className="erp-panel workshop-queue" aria-labelledby="workshop-queue-title">
      <div className="erp-panel-header">
        <h2 id="workshop-queue-title" className="erp-panel-title">Cola de espera</h2>
        <span className="erp-secondary-text">{queue.length} {queue.length === 1 ? "vehículo" : "vehículos"}</span>
      </div>
      {queue.length === 0
        ? <p className="erp-secondary-text">No hay vehículos esperando plaza.</p>
        : <>
          <ol className="workshop-queue__list">
            {queue.map((order, index) => <li key={order.otId}>
              <span className="workshop-queue__position" aria-label={`Posición ${index + 1}`}>{index + 1}</span>
              <TopCar tone="neutral" size={22} />
              <div><Link className="vehicle-link" to={`/taller/ordenes/${order.otId}`}>{vehicleName(vehiclesById.get(order.vehiculoId))}</Link>
                <span className="erp-secondary-text">{vehiclesById.get(order.vehiculoId)?.patente || "Sin patente"} · {order.numeroOT}</span></div>
            </li>)}
          </ol>
          <p className="erp-secondary-text">Cuando se libera o se crea una plaza, entra el primero de la cola.</p>
        </>}
    </section>}

    <ResponsiveDialog open={Boolean(formTarget)} onClose={() => !saving && setFormTarget(null)} size="small" eyebrow="Taller · Plazas" title={formTarget?.mode === "create" ? "Nueva Plaza" : "Editar Plaza"} description="El estado de ocupación se determina desde las órdenes de trabajo activas." footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setFormTarget(null)}>Cancelar</Button><Button type="submit" form="workshop-plaza-form" disabled={saving}>{saving ? "Guardando..." : formTarget?.mode === "create" ? "Crear Plaza" : "Guardar cambios"}</Button></>}>
      <form id="workshop-plaza-form" className="vehicle-form" onSubmit={save} noValidate><label className="erp-field"><span className="erp-field__label">Nombre *</span><input className="erp-control" autoComplete="off" maxLength="120" value={nombre} onChange={(event) => {setNombre(event.target.value); setFieldError(""); setFormError("");}} placeholder="Ej.: Taller - Plaza 1" />{fieldError && <span className="vehicle-field-error" role="alert">{fieldError}</span>}</label>{formError && <div className="vehicle-message vehicle-message--error" role="alert">{formError}</div>}</form>
    </ResponsiveDialog>

    <ResponsiveDialog open={Boolean(stateTarget)} onClose={() => !saving && setStateTarget(null)} size="small" eyebrow="Taller · Plazas" title={stateTarget?.estado === "activa" ? "Inactivar Plaza" : "Activar Plaza"} description={stateTarget?.estado === "activa" ? "Una Plaza inactiva no podrá recibir nuevas asignaciones." : "La Plaza volverá a estar disponible para asignaciones cuando no esté en uso."} footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setStateTarget(null)}>Cancelar</Button><Button type="button" disabled={saving} onClick={changeState}>{saving ? "Procesando..." : stateTarget?.estado === "activa" ? "Inactivar" : "Activar"}</Button></>}>
      <p>¿Confirmas el cambio de estado de <strong>{stateTarget?.nombre}</strong>? La ocupación actual, si existe, no se modifica.</p>
    </ResponsiveDialog>
  </main>;
}
