import React, {useCallback, useEffect, useMemo, useState} from "react";
import {MapPin, Pencil, Plus, Power, PowerOff, RefreshCw} from "lucide-react";
import {Link} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import StatusBadge from "../components/ui/StatusBadge";
import {
  canManageWorkshopPlazas,
  deriveWorkshopPlazaOccupancy,
  getWorkshopPlazaFieldErrors,
  getWorkshopPlazaStateLabel,
  getWorkshopPlazaStateVariant,
} from "../domain/workshopPlazaModel.mjs";
import {listarVehiculos} from "../services/vehicleService";
import {listarOrdenesTrabajo} from "../services/workOrderService";
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

function OccupancyBadge({occupied}) {
  return <StatusBadge variant={occupied ? "warning" : "success"}>{occupied ? "En uso" : "Disponible"}</StatusBadge>;
}

export default function WorkshopPlazasPage({businessId, role}) {
  const canManage = canManageWorkshopPlazas(role);
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

  useEffect(() => { load(); }, [load]);

  const occupancy = useMemo(() => deriveWorkshopPlazaOccupancy(plazas, orders), [orders, plazas]);

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

  const actions = (plaza) => canManage ? <div className="erp-module-actions">
    <Button type="button" variant="secondary" icon={Pencil} onClick={() => openEdit(plaza)}>Editar</Button>
    <Button type="button" variant="secondary" icon={plaza.estado === "activa" ? PowerOff : Power} onClick={() => setStateTarget(plaza)}>{plaza.estado === "activa" ? "Inactivar" : "Activar"}</Button>
  </div> : <span className="erp-secondary-text">Solo lectura</span>;

  return <main className="erp-page workshop-plazas-page">
    <header className="erp-page-header">
      <div className="erp-page-header__content"><p className="erp-page-header__eyebrow">Taller</p><h1 className="erp-page-header__title">Plazas</h1><p className="erp-page-header__description">Administra ubicaciones físicas y consulta su ocupación actual.</p></div>
      {canManage && <Button type="button" icon={Plus} onClick={openCreate}>Nueva Plaza</Button>}
    </header>
    {!canManage && <div className="vehicle-message vehicle-message--warning" role="status">Puedes consultar las Plazas. La creación y administración corresponde a OWNER o ADMIN.</div>}
    {notice && <div className="vehicle-message" role="status">{notice}</div>}
    {error && <div className="vehicle-message vehicle-message--error" role="alert"><span>{error}</span><Button type="button" variant="secondary" icon={RefreshCw} onClick={load}>Reintentar</Button></div>}
    <section className="erp-panel" aria-labelledby="workshop-plazas-title">
      <div className="erp-panel-header"><div><h2 id="workshop-plazas-title" className="erp-panel-title">Plazas del Taller</h2><p className="erp-secondary-text">Disponible y En uso son valores derivados de las OTs activas; no son estados persistidos.</p></div><span className="erp-secondary-text">{plazas.length} {plazas.length === 1 ? "Plaza" : "Plazas"}</span></div>
      {loading ? <div className="erp-empty-state" role="status">Cargando Plazas...</div> : !error && plazas.length === 0 ? <div className="erp-empty-state"><AppIcon icon={MapPin} size={28} /><h3>Aún no hay Plazas</h3><p>{canManage ? "Crea la primera ubicación física del Taller." : "OWNER o ADMIN pueden crear la primera Plaza."}</p>{canManage && <Button type="button" icon={Plus} onClick={openCreate}>Crear primera Plaza</Button>}</div> : !error && <>
        <div className="erp-table-region erp-desktop-only"><table className="erp-table workshop-plazas-table"><thead><tr><th>Nombre</th><th>Estado</th><th>Ocupación actual</th><th>OT asignada</th><th>Vehículo asignado</th><th className="workshop-plazas-actions-column">Acciones</th></tr></thead><tbody>{plazas.map((plaza) => { const occupied = occupancy.get(plaza.plazaId); const order = occupied?.order; return <tr key={plaza.plazaId}><td><strong>{plaza.nombre}</strong></td><td><StatusBadge variant={getWorkshopPlazaStateVariant(plaza.estado)}>{getWorkshopPlazaStateLabel(plaza.estado)}</StatusBadge></td><td><OccupancyBadge occupied={Boolean(order)} />{occupied?.conflict && <p className="vehicle-field-error">Conflicto de asignación</p>}</td><td>{order ? <Link className="vehicle-link" to={`/taller/ordenes/${order.otId}`}>{order.numeroOT}</Link> : "—"}</td><td>{order ? vehicleLabel(vehiclesById.get(order.vehiculoId)) : "—"}</td><td className="workshop-plazas-actions-column">{actions(plaza)}</td></tr>; })}</tbody></table></div>
        <div className="erp-card-list erp-mobile-only">{plazas.map((plaza) => { const occupied = occupancy.get(plaza.plazaId); const order = occupied?.order; return <article className="erp-record-card" key={plaza.plazaId}><header className="erp-record-card__header"><div><h3 className="erp-record-card__title">{plaza.nombre}</h3><StatusBadge variant={getWorkshopPlazaStateVariant(plaza.estado)}>{getWorkshopPlazaStateLabel(plaza.estado)}</StatusBadge></div><OccupancyBadge occupied={Boolean(order)} /></header><dl className="erp-meta-grid"><div className="erp-meta"><dt className="erp-meta__label">OT asignada</dt><dd className="erp-meta__value">{order ? <Link className="vehicle-link" to={`/taller/ordenes/${order.otId}`}>{order.numeroOT}</Link> : "Sin asignar"}</dd></div><div className="erp-meta erp-meta--wide"><dt className="erp-meta__label">Vehículo</dt><dd className="erp-meta__value">{order ? vehicleLabel(vehiclesById.get(order.vehiculoId)) : "Sin asignar"}</dd></div></dl>{occupied?.conflict && <p className="vehicle-field-error">Se detectaron múltiples OTs activas asociadas. Revisa la consistencia.</p>}{actions(plaza)}</article>; })}</div>
      </>}
    </section>

    <ResponsiveDialog open={Boolean(formTarget)} onClose={() => !saving && setFormTarget(null)} size="small" eyebrow="Taller · Plazas" title={formTarget?.mode === "create" ? "Nueva Plaza" : "Editar Plaza"} description="El estado de ocupación se determina desde las órdenes de trabajo activas." footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setFormTarget(null)}>Cancelar</Button><Button type="submit" form="workshop-plaza-form" disabled={saving}>{saving ? "Guardando..." : formTarget?.mode === "create" ? "Crear Plaza" : "Guardar cambios"}</Button></>}>
      <form id="workshop-plaza-form" className="vehicle-form" onSubmit={save} noValidate><label className="erp-field"><span className="erp-field__label">Nombre *</span><input className="erp-control" autoComplete="off" maxLength="120" value={nombre} onChange={(event) => {setNombre(event.target.value); setFieldError(""); setFormError("");}} placeholder="Ej.: Taller - Plaza 1" />{fieldError && <span className="vehicle-field-error" role="alert">{fieldError}</span>}</label>{formError && <div className="vehicle-message vehicle-message--error" role="alert">{formError}</div>}</form>
    </ResponsiveDialog>

    <ResponsiveDialog open={Boolean(stateTarget)} onClose={() => !saving && setStateTarget(null)} size="small" eyebrow="Taller · Plazas" title={stateTarget?.estado === "activa" ? "Inactivar Plaza" : "Activar Plaza"} description={stateTarget?.estado === "activa" ? "Una Plaza inactiva no podrá recibir nuevas asignaciones." : "La Plaza volverá a estar disponible para asignaciones cuando no esté en uso."} footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setStateTarget(null)}>Cancelar</Button><Button type="button" disabled={saving} onClick={changeState}>{saving ? "Procesando..." : stateTarget?.estado === "activa" ? "Inactivar" : "Activar"}</Button></>}>
      <p>¿Confirmas el cambio de estado de <strong>{stateTarget?.nombre}</strong>? La ocupación actual, si existe, no se modifica.</p>
    </ResponsiveDialog>
  </main>;
}
