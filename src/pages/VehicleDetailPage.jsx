import React, {useCallback, useEffect, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {ArrowLeft, Pencil, Plus, RefreshCw, Save, UserRound} from "lucide-react";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import ClientSelector from "../features/clients/ClientSelector";
import VehicleFormFields from "../features/vehicles/VehicleFormFields";
import {getVehicleFieldErrors, getVehicleTypeLabel} from "../domain/vehicleModel.mjs";
import {listarClientes} from "../services/clientService";
import {actualizarVehiculo, cambiarPropietarioVehiculo, getVehicleErrorMessage, obtenerVehiculo} from "../services/vehicleService";

const MANAGE_ROLES = new Set(["OWNER", "ADMIN"]);

function vehicleFormValues(vehicle) {
  return {patente: vehicle?.patente || "", vin: vehicle?.vin || "", marca: vehicle?.marca || "", modelo: vehicle?.modelo || "", anio: String(vehicle?.anio || ""), color: vehicle?.color || "", tipo: vehicle?.tipo || ""};
}

function VehicleDetailItem({label, value}) {
  return <div className="vehicle-detail-item"><dt>{label}</dt><dd>{value}</dd></div>;
}

function VehicleDetailPage({businessId, role}) {
  const {vehiculoId} = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState(null);
  const [owner, setOwner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(location.state?.feedback || "");
  const [editOpen, setEditOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [saving, setSaving] = useState(false);
  const canManage = MANAGE_ROLES.has(String(role || "").toUpperCase());
  const handleOwnerSelection = useCallback((client) => {
    setSelectedOwner(client);
    setErrors({});
  }, []);

  const load = useCallback(async () => {
    if (!businessId || !vehiculoId) return;
    setLoading(true);
    setError("");
    try {
      const [vehicleItem, clients] = await Promise.all([obtenerVehiculo(businessId, vehiculoId), listarClientes(businessId)]);
      if (!vehicleItem) { setVehicle(null); setOwner(null); return; }
      setVehicle(vehicleItem);
      setOwner(clients.find((client) => client.clienteId === vehicleItem.clienteId) || null);
    } catch (loadError) { setError(getVehicleErrorMessage(loadError)); }
    finally { setLoading(false); }
  }, [businessId, vehiculoId]);

  useEffect(() => { load(); }, [load]);

  const openEdit = () => { setValues(vehicleFormValues(vehicle)); setErrors({}); setEditOpen(true); };
  const openOwner = () => { setSelectedOwner(owner); setErrors({}); setOwnerOpen(true); };
  const saveEdit = async (event) => {
    event.preventDefault();
    const nextErrors = getVehicleFieldErrors(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try { await actualizarVehiculo(businessId, vehiculoId, values); setFeedback("Vehículo actualizado correctamente."); setEditOpen(false); await load(); }
    catch (saveError) { setErrors({server: getVehicleErrorMessage(saveError)}); }
    finally { setSaving(false); }
  };
  const saveOwner = async () => {
    if (!selectedOwner?.clienteId) { setErrors({clienteId: "Selecciona un cliente propietario."}); return; }
    setSaving(true);
    try { await cambiarPropietarioVehiculo(businessId, vehiculoId, selectedOwner.clienteId); setFeedback("Propietario actualizado correctamente."); setOwnerOpen(false); await load(); }
    catch (saveError) { setErrors({server: getVehicleErrorMessage(saveError)}); }
    finally { setSaving(false); }
  };

  if (loading) return <main className="erp-page"><div className="erp-empty-state" role="status">Cargando vehículo...</div></main>;
  if (error) return <main className="erp-page"><div className="vehicle-message vehicle-message--error" role="alert"><span>{error}</span><Button variant="secondary" icon={RefreshCw} onClick={load}>Reintentar</Button></div></main>;
  if (!vehicle) return <main className="erp-page"><div className="erp-empty-state" role="status"><h2>Vehículo no encontrado</h2><p>Puede haber sido eliminado del contexto del negocio activo.</p><Button variant="secondary" icon={ArrowLeft} onClick={() => navigate("/taller/vehiculos")}>Volver a vehículos</Button></div></main>;

  return <main className="erp-page vehicles-page"><header className="erp-page-header"><div className="erp-page-header__content"><p className="erp-page-header__eyebrow">Taller · Vehículos</p><h1 className="erp-page-header__title">{vehicle.patente}</h1><p className="erp-page-header__description">{vehicle.marca} {vehicle.modelo} · {vehicle.anio} · {getVehicleTypeLabel(vehicle.tipo)}</p></div><div className="erp-module-actions"><Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate("/taller/vehiculos")}>Volver</Button>{canManage && <><Button type="button" variant="secondary" icon={Pencil} onClick={openEdit}>Editar</Button><Button type="button" variant="secondary" icon={UserRound} onClick={openOwner}>Cambiar propietario</Button><Button type="button" icon={Plus} onClick={() => navigate("/taller/ordenes/nueva", {state: {vehiculoId: vehicle.vehiculoId}})}>Crear OT</Button></>}</div></header>
    {!canManage && <div className="vehicle-message vehicle-message--warning" role="status">Tu perfil tiene acceso de lectura. OWNER o ADMIN pueden modificar esta ficha.</div>}
    {feedback && <div className="vehicle-message" role="status">{feedback}</div>}
    <section className="erp-panel" aria-labelledby="vehicle-data-title"><div className="erp-panel-header"><div><h2 id="vehicle-data-title" className="erp-panel-title">Datos del vehículo</h2><p className="erp-secondary-text">Información vigente registrada para esta ficha.</p></div></div><dl className="vehicle-detail-grid"><VehicleDetailItem label="Patente" value={vehicle.patente} /><VehicleDetailItem label="VIN" value={vehicle.vin || "No informado"} /><VehicleDetailItem label="Marca" value={vehicle.marca} /><VehicleDetailItem label="Modelo" value={vehicle.modelo} /><VehicleDetailItem label="Año" value={vehicle.anio} /><VehicleDetailItem label="Color" value={vehicle.color} /><VehicleDetailItem label="Tipo" value={getVehicleTypeLabel(vehicle.tipo)} /></dl></section>
    <section className="erp-panel" aria-labelledby="vehicle-owner-title"><div className="erp-panel-header"><div><h2 id="vehicle-owner-title" className="erp-panel-title">Propietario actual</h2><p className="erp-secondary-text">El cambio de propietario no altera las órdenes de trabajo históricas.</p></div></div>{owner ? <div className="vehicle-owner"><strong className="vehicle-owner__name">{owner.nombreRazonSocial}</strong><dl className="vehicle-owner__meta"><VehicleDetailItem label="Identificación" value={owner.identificadorFiscalValor || owner.rut || "No informada"} /><VehicleDetailItem label="Contacto" value={owner.email || owner.telefono || "Sin datos de contacto"} /></dl></div> : <div className="erp-empty-state">No fue posible cargar el propietario actual.</div>}</section>
    <section className="erp-panel" aria-labelledby="vehicle-orders-title"><div className="erp-panel-header"><div><h2 id="vehicle-orders-title" className="erp-panel-title">Historial de órdenes de trabajo</h2><p className="erp-secondary-text">Esta sección usará las órdenes de trabajo persistidas cuando ese backend esté disponible.</p></div></div><div className="erp-empty-state" role="status">Aún no hay una fuente de datos de órdenes de trabajo para mostrar este historial.</div></section>
    <ResponsiveDialog open={editOpen} onClose={() => !saving && setEditOpen(false)} size="medium" eyebrow="Taller" title="Editar vehículo" description="Los cambios se validarán nuevamente en el servidor." footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setEditOpen(false)}>Cancelar</Button><Button type="submit" form="vehicle-edit-form" icon={Save} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button></>}><form id="vehicle-edit-form" onSubmit={saveEdit} noValidate><VehicleFormFields values={values} errors={errors} onChange={(field, value) => { setValues((current) => ({...current, [field]: value})); setErrors((current) => ({...current, [field]: undefined, server: undefined})); }} />{errors.server && <p className="vehicle-field-error" role="alert">{errors.server}</p>}</form></ResponsiveDialog>
    <ResponsiveDialog open={ownerOpen} onClose={() => !saving && setOwnerOpen(false)} size="medium" eyebrow="Taller" title="Cambiar propietario" description="Las órdenes de trabajo históricas conservarán el cliente con que fueron creadas." footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setOwnerOpen(false)}>Cancelar</Button><Button type="button" disabled={saving} onClick={saveOwner}>{saving ? "Guardando..." : "Confirmar propietario"}</Button></>}><ClientSelector businessId={businessId} value={selectedOwner} snapshot={selectedOwner} onChange={handleOwnerSelection} />{errors.clienteId && <p className="vehicle-field-error" role="alert">{errors.clienteId}</p>}{errors.server && <p className="vehicle-field-error" role="alert">{errors.server}</p>}</ResponsiveDialog>
  </main>;
}

export default VehicleDetailPage;
