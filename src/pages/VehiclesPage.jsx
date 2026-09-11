import React, {useCallback, useEffect, useMemo, useState} from "react";
import {Link, useNavigate} from "react-router-dom";
import {Car, Plus, RefreshCw, Search} from "lucide-react";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import {matchesVehicleSearch, getVehicleTypeLabel} from "../domain/vehicleModel.mjs";
import {getClientErrorMessage, listarClientes} from "../services/clientService";
import {getVehicleErrorMessage, listarVehiculos} from "../services/vehicleService";

const MANAGE_ROLES = new Set(["OWNER", "ADMIN"]);

function ownerName(vehicle, clientsById) {
  return clientsById.get(vehicle.clienteId)?.nombreRazonSocial || "Cliente no disponible";
}

function VehiclesPage({businessId, role}) {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [clientsById, setClientsById] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const canManage = MANAGE_ROLES.has(String(role || "").toUpperCase());

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError("");
    try {
      const [vehicleItems, clientItems] = await Promise.all([listarVehiculos(businessId), listarClientes(businessId)]);
      setVehicles(vehicleItems);
      setClientsById(new Map(clientItems.map((client) => [client.clienteId, client])));
    } catch (loadError) {
      setError(getVehicleErrorMessage(loadError) || getClientErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const visibleVehicles = useMemo(
    () => vehicles.filter((vehicle) => matchesVehicleSearch(vehicle, search)),
    [search, vehicles],
  );
  const hasSearch = Boolean(search.trim());

  return (
    <main className="erp-page vehicles-page">
      <div className="erp-module-intro">
        <div className="erp-page-intro"><p>Consulta los vehículos registrados y su propietario actual en el negocio activo.</p></div>
        {canManage && <Button icon={Plus} onClick={() => navigate("/taller/vehiculos/nuevo")}>Nuevo vehículo</Button>}
      </div>
      {!canManage && <div className="vehicle-message vehicle-message--warning" role="status">Tu perfil tiene acceso de lectura. OWNER o ADMIN pueden administrar vehículos.</div>}
      {error && <div className="vehicle-message vehicle-message--error" role="alert"><span>{error}</span><Button variant="secondary" icon={RefreshCw} onClick={load}>Reintentar</Button></div>}
      <section className="erp-panel" aria-labelledby="vehicles-list-title">
        <div className="erp-panel-header"><div><h2 id="vehicles-list-title" className="erp-panel-title">Vehículos registrados</h2><p className="erp-secondary-text">{hasSearch ? `${visibleVehicles.length} de ${vehicles.length} vehículos` : `${vehicles.length} ${vehicles.length === 1 ? "vehículo" : "vehículos"}`}</p></div></div>
        <div className="erp-filters no-print">
          <label className="erp-field vehicle-search-field"><span className="erp-field__label">Buscar vehículo</span><span className="vehicle-search-control"><AppIcon icon={Search} size={18} /><input className="erp-control" type="search" value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} placeholder="Patente, VIN, marca o modelo" /></span></label>
        </div>
        {loading ? <div className="erp-empty-state" role="status">Cargando vehículos del negocio activo...</div> : !error && visibleVehicles.length === 0 ? (
          <div className="erp-empty-state"><AppIcon icon={Car} size={28} /><h3>{hasSearch ? "No hay coincidencias" : "Aún no hay vehículos"}</h3><p>{hasSearch ? "Prueba con otra patente, VIN, marca o modelo." : canManage ? "Registra el primer vehículo para comenzar." : "OWNER o ADMIN pueden registrar el primer vehículo."}</p>{!hasSearch && canManage && <Button icon={Plus} onClick={() => navigate("/taller/vehiculos/nuevo")}>Crear primer vehículo</Button>}</div>
        ) : !error && <>
          <div className="erp-table-region erp-desktop-only"><table className="erp-table"><thead><tr><th>Patente</th><th>Marca / modelo</th><th>Año</th><th>Tipo</th><th>Propietario actual</th></tr></thead><tbody>{visibleVehicles.map((vehicle) => <tr key={vehicle.vehiculoId}><td><Link className="vehicle-link" to={`/taller/vehiculos/${vehicle.vehiculoId}`}>{vehicle.patente}</Link></td><td>{vehicle.marca} {vehicle.modelo}</td><td>{vehicle.anio}</td><td>{getVehicleTypeLabel(vehicle.tipo)}</td><td>{ownerName(vehicle, clientsById)}</td></tr>)}</tbody></table></div>
          <div className="erp-card-list erp-mobile-only">{visibleVehicles.map((vehicle) => <article className="erp-record-card" key={vehicle.vehiculoId}><header className="erp-record-card__header"><div><h3 className="erp-record-card__title"><Link className="vehicle-link" to={`/taller/vehiculos/${vehicle.vehiculoId}`}>{vehicle.patente}</Link></h3><p>{vehicle.marca} {vehicle.modelo}</p></div></header><dl className="erp-meta-grid"><div><dt>Año</dt><dd>{vehicle.anio}</dd></div><div><dt>Tipo</dt><dd>{getVehicleTypeLabel(vehicle.tipo)}</dd></div><div><dt>Propietario actual</dt><dd>{ownerName(vehicle, clientsById)}</dd></div></dl></article>)}</div>
        </>}
      </section>
    </main>
  );
}

export default VehiclesPage;
