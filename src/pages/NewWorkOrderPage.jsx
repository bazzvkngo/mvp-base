import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ArrowLeft, Car, FilePlus2, Plus, RefreshCw, Search} from "lucide-react";
import {useLocation, useNavigate} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import {normalizeVehiclePlate} from "../domain/vehicleModel.mjs";
import {listarClientes} from "../services/clientService";
import {getVehicleErrorMessage, listarVehiculos} from "../services/vehicleService";
import {
  crearOrdenTrabajo,
  createWorkOrderRequestId,
  getWorkOrderErrorMessage,
} from "../services/workOrderService";

const MANAGE_ROLES = new Set(["OWNER", "ADMIN"]);

export default function NewWorkOrderPage({businessId, role}) {
  const location = useLocation();
  const navigate = useNavigate();
  const requestIdRef = useRef("");
  const [vehicles, setVehicles] = useState([]);
  const [clientsById, setClientsById] = useState(new Map());
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canManage = MANAGE_ROLES.has(String(role || "").toUpperCase());

  const load = useCallback(async () => {
    if (!businessId || !canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [vehicleItems, clientItems] = await Promise.all([
        listarVehiculos(businessId),
        listarClientes(businessId),
      ]);
      setVehicles(vehicleItems);
      setClientsById(new Map(clientItems.map((item) => [item.clienteId, item])));
      const requestedId = String(location.state?.vehiculoId || "").trim();
      const requested = vehicleItems.find((item) => item.vehiculoId === requestedId);
      if (requested) {
        setSelectedId(requested.vehiculoId);
        setSearch(requested.patente);
      }
    } catch (loadError) {
      setError(getVehicleErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [businessId, canManage, location.state?.vehiculoId]);

  useEffect(() => { load(); }, [load]);

  const normalizedSearch = normalizeVehiclePlate(search);
  const matches = useMemo(() => {
    if (!normalizedSearch) return vehicles;
    return vehicles.filter((vehicle) => vehicle.patente.includes(normalizedSearch));
  }, [normalizedSearch, vehicles]);
  const selected = vehicles.find((vehicle) => vehicle.vehiculoId === selectedId) || null;
  const owner = selected ? clientsById.get(selected.clienteId) : null;

  const selectVehicle = (vehicle) => {
    setSelectedId(vehicle.vehiculoId);
    setSearch(vehicle.patente);
    setError("");
    requestIdRef.current = createWorkOrderRequestId();
  };

  const createOrder = async () => {
    if (!selected || saving) return;
    if (!requestIdRef.current) requestIdRef.current = createWorkOrderRequestId();
    setSaving(true);
    setError("");
    try {
      const order = await crearOrdenTrabajo(
        businessId,
        selected.vehiculoId,
        requestIdRef.current
      );
      requestIdRef.current = "";
      navigate("/taller/ordenes", {
        replace: true,
        state: {feedback: `${order.numeroOT} creada correctamente.`},
      });
    } catch (createError) {
      setError(getWorkOrderErrorMessage(createError));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) return <main className="erp-page"><div className="erp-empty-state"><h2>No tienes permisos para crear órdenes de trabajo</h2><p>OWNER o ADMIN pueden realizar esta operación.</p><Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate("/taller/ordenes")}>Volver a órdenes</Button></div></main>;

  return <main className="erp-page work-orders-page">
    <header className="erp-page-header"><div className="erp-page-header__content"><p className="erp-page-header__eyebrow">Taller · Órdenes de trabajo</p><h1 className="erp-page-header__title">Nueva orden de trabajo</h1><p className="erp-page-header__description">Busca y selecciona el vehículo antes de crear la OT.</p></div><Button type="button" variant="secondary" icon={ArrowLeft} disabled={saving} onClick={() => navigate("/taller/ordenes")}>Volver</Button></header>
    {error && <div className="vehicle-message vehicle-message--error" role="alert"><span>{error}</span>{!saving && <Button type="button" variant="secondary" icon={RefreshCw} onClick={load}>Recargar vehículos</Button>}</div>}
    <section className="erp-panel" aria-labelledby="vehicle-search-title">
      <div className="erp-panel-header"><div><h2 id="vehicle-search-title" className="erp-panel-title">Buscar vehículo</h2><p className="erp-secondary-text">Filtra por patente o selecciona un vehículo desde el listado.</p></div></div>
      <label className="erp-field vehicle-search-field"><span className="erp-field__label">Patente</span><span className="vehicle-search-control"><AppIcon icon={Search} size={18} /><input className="erp-control" autoFocus type="search" maxLength={20} value={search} onChange={(event) => {setSearch(event.target.value.toUpperCase()); setSelectedId(""); requestIdRef.current = "";}} placeholder="Ej.: ABCD12" /></span></label>
    </section>
    <section className="erp-panel erp-history-panel" aria-labelledby="available-vehicles-title">
      <div className="erp-panel-header"><div><h2 id="available-vehicles-title" className="erp-panel-title">Vehículos disponibles</h2><p className="erp-secondary-text">{normalizedSearch ? `${matches.length} coincidencia${matches.length === 1 ? "" : "s"} para la patente buscada.` : `${vehicles.length} vehículo${vehicles.length === 1 ? "" : "s"} registrado${vehicles.length === 1 ? "" : "s"}.`}</p></div></div>
      {loading ? <div className="erp-empty-state" role="status">Cargando vehículos...</div> : matches.length ? <><div className="erp-table-region erp-desktop-only"><table className="erp-table"><thead><tr><th>Patente</th><th>Vehículo</th><th>Año</th><th>Propietario actual</th><th>Acción</th></tr></thead><tbody>{matches.map((vehicle) => <tr key={vehicle.vehiculoId}><td><strong>{vehicle.patente}</strong></td><td>{vehicle.marca} {vehicle.modelo}</td><td>{vehicle.anio}</td><td>{clientsById.get(vehicle.clienteId)?.nombreRazonSocial || vehicle.clienteId}</td><td><Button type="button" variant={vehicle.vehiculoId === selectedId ? "primary" : "secondary"} onClick={() => selectVehicle(vehicle)}>{vehicle.vehiculoId === selectedId ? "Seleccionado" : "Seleccionar"}</Button></td></tr>)}</tbody></table></div><div className="erp-card-list erp-mobile-only">{matches.map((vehicle) => <article className="erp-record-card" key={vehicle.vehiculoId}><header className="erp-record-card__header"><div><h3 className="erp-record-card__title">{vehicle.patente}</h3><p className="erp-record-card__subtitle">{vehicle.marca} {vehicle.modelo}</p></div></header><dl className="erp-meta-grid"><div className="erp-meta"><dt className="erp-meta__label">Año</dt><dd className="erp-meta__value">{vehicle.anio}</dd></div><div className="erp-meta erp-meta--wide"><dt className="erp-meta__label">Propietario actual</dt><dd className="erp-meta__value">{clientsById.get(vehicle.clienteId)?.nombreRazonSocial || vehicle.clienteId}</dd></div></dl><Button type="button" variant={vehicle.vehiculoId === selectedId ? "primary" : "secondary"} onClick={() => selectVehicle(vehicle)}>{vehicle.vehiculoId === selectedId ? "Seleccionado" : "Seleccionar"}</Button></article>)}</div></> : <div className="erp-empty-state"><AppIcon icon={Car} size={28} /><h3>{normalizedSearch ? "Vehículo no encontrado" : "Aún no hay vehículos"}</h3><p>{normalizedSearch ? "No existe un vehículo que coincida con esa patente." : "Registra un vehículo para poder crear una orden de trabajo."}</p><Button type="button" variant="secondary" icon={Plus} onClick={() => navigate("/taller/vehiculos/nuevo")}>Crear vehículo</Button></div>}
    </section>
    {selected && <section className="erp-panel" aria-labelledby="selected-vehicle-title"><div className="erp-panel-header"><div><h2 id="selected-vehicle-title" className="erp-panel-title">Vehículo seleccionado</h2><p className="erp-secondary-text">Revisa la información antes de crear la orden.</p></div></div><div className="vehicle-form"><dl className="vehicle-detail-grid"><div className="vehicle-detail-item"><dt>Patente</dt><dd>{selected.patente}</dd></div><div className="vehicle-detail-item"><dt>Vehículo</dt><dd>{selected.marca} {selected.modelo}</dd></div><div className="vehicle-detail-item"><dt>Año</dt><dd>{selected.anio}</dd></div><div className="vehicle-detail-item"><dt>Propietario actual</dt><dd>{owner?.nombreRazonSocial || selected.clienteId}</dd></div></dl><div className="vehicle-form-actions"><Button type="button" icon={FilePlus2} disabled={saving} onClick={createOrder}>{saving ? "Creando OT..." : "Crear orden de trabajo"}</Button></div></div></section>}
  </main>;
}
