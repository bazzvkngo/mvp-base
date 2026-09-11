import React, {useCallback, useEffect, useMemo, useState} from "react";
import {FilePlus2, RefreshCw, Search, Wrench} from "lucide-react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import StatusBadge from "../components/ui/StatusBadge";
import {
  getWorkOrderApprovalLabel,
  getWorkOrderApprovalVariant,
  getWorkOrderStatusLabel,
  getWorkOrderStatusVariant,
  matchesWorkOrderSearch,
  WORK_ORDER_APPROVAL_STATUSES,
  WORK_ORDER_STATUSES,
} from "../domain/workOrderModel.mjs";
import {listarClientes} from "../services/clientService";
import {listarVehiculos} from "../services/vehicleService";
import {
  getWorkOrderErrorMessage,
  listarOrdenesTrabajo,
} from "../services/workOrderService";
import {formatDate} from "../utils/formatters";

const MANAGE_ROLES = new Set(["OWNER", "ADMIN"]);
const CLIENT_READ_ROLES = new Set(["OWNER", "ADMIN"]);

function OrderStatus({order}) {
  return <StatusBadge variant={getWorkOrderStatusVariant(order.estado)}>{getWorkOrderStatusLabel(order.estado)}</StatusBadge>;
}

function ApprovalStatus({order}) {
  return <StatusBadge variant={getWorkOrderApprovalVariant(order.estadoAprobacion)}>{getWorkOrderApprovalLabel(order.estadoAprobacion)}</StatusBadge>;
}

function vehicleLabel(vehicle) {
  return vehicle ? `${vehicle.marca} ${vehicle.modelo}` : "Vehículo no disponible";
}

function clientLabel(order, clientsById) {
  return clientsById.get(order.clienteId)?.nombreRazonSocial || order.clienteId || "Cliente no disponible";
}

export default function WorkOrdersPage({businessId, role}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [vehiclesById, setVehiclesById] = useState(new Map());
  const [clientsById, setClientsById] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [approval, setApproval] = useState("todos");
  const normalizedRole = String(role || "").toUpperCase();
  const canManage = MANAGE_ROLES.has(normalizedRole);
  const canReadClients = CLIENT_READ_ROLES.has(normalizedRole);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError("");
    try {
      const [orderItems, vehicleItems, clientItems] = await Promise.all([
        listarOrdenesTrabajo(businessId),
        listarVehiculos(businessId),
        canReadClients ? listarClientes(businessId) : Promise.resolve([]),
      ]);
      setOrders(orderItems);
      setVehiclesById(new Map(vehicleItems.map((item) => [item.vehiculoId, item])));
      setClientsById(new Map(clientItems.map((item) => [item.clienteId, item])));
    } catch (loadError) {
      setError(getWorkOrderErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [businessId, canReadClients]);

  useEffect(() => { load(); }, [load]);

  const visibleOrders = useMemo(() => orders.filter((order) => {
    const vehicle = vehiclesById.get(order.vehiculoId);
    return matchesWorkOrderSearch(order, vehicle, search)
      && (status === "todos" || order.estado === status)
      && (approval === "todos" || order.estadoAprobacion === approval);
  }), [approval, orders, search, status, vehiclesById]);

  const feedback = String(location.state?.feedback || "");

  return <main className="erp-page work-orders-page">
    <div className="erp-module-intro">
      <div className="erp-page-intro"><p>Consulta y crea órdenes de trabajo asociadas a vehículos del negocio activo.</p></div>
      {canManage && <Button type="button" icon={FilePlus2} onClick={() => navigate("/taller/ordenes/nueva")}>Nueva OT</Button>}
    </div>
    {feedback && <div className="vehicle-message" role="status">{feedback}</div>}
    {!canManage && <div className="vehicle-message vehicle-message--warning" role="status">Tu perfil tiene acceso de lectura. OWNER o ADMIN pueden crear órdenes de trabajo.</div>}
    {error && <div className="vehicle-message vehicle-message--error" role="alert"><span>{error}</span><Button type="button" variant="secondary" icon={RefreshCw} onClick={load}>Reintentar</Button></div>}
    <section className="erp-panel erp-history-panel" aria-labelledby="work-orders-title">
      <div className="erp-panel-header"><div><h2 id="work-orders-title" className="erp-panel-title">Órdenes de trabajo</h2><p className="erp-secondary-text">{visibleOrders.length} {visibleOrders.length === 1 ? "orden" : "órdenes"}</p></div></div>
      <div className="erp-filters erp-history-filters--three no-print">
        <label className="erp-field erp-history-search-field"><span className="erp-field__label">Buscar por número OT o patente</span><span className="vehicle-search-control"><AppIcon icon={Search} size={18} /><input className="erp-control" type="search" maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej.: OT-000001 o ABCD12" /></span></label>
        <label className="erp-field"><span className="erp-field__label">Estado</span><select className="erp-control" value={status} onChange={(event) => setStatus(event.target.value)}><option value="todos">Todos los estados</option>{WORK_ORDER_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="erp-field"><span className="erp-field__label">Aprobación</span><select className="erp-control" value={approval} onChange={(event) => setApproval(event.target.value)}><option value="todos">Todos</option>{WORK_ORDER_APPROVAL_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
      {loading ? <div className="erp-empty-state" role="status">Cargando órdenes de trabajo...</div> : !error && visibleOrders.length === 0 ? <div className="erp-empty-state"><AppIcon icon={Wrench} size={28} /><h3>{orders.length ? "No hay coincidencias" : "Aún no hay órdenes de trabajo"}</h3><p>{orders.length ? "Prueba con otros filtros o términos de búsqueda." : canManage ? "Crea la primera OT desde un vehículo registrado." : "Todavía no existen órdenes para consultar."}</p>{!orders.length && canManage && <Button type="button" icon={FilePlus2} onClick={() => navigate("/taller/ordenes/nueva")}>Crear primera OT</Button>}</div> : !error && <>
        <div className="erp-table-region erp-desktop-only"><table className="erp-table"><thead><tr><th>Número OT</th><th>Patente</th><th>Vehículo</th><th>Cliente histórico</th><th>Estado</th><th>Aprobación</th><th>Plaza</th><th>Actualización</th></tr></thead><tbody>{visibleOrders.map((order) => { const vehicle = vehiclesById.get(order.vehiculoId); return <tr key={order.otId}><td><Link className="vehicle-link" to={`/taller/ordenes/${order.otId}`}>{order.numeroOT}</Link></td><td>{vehicle?.patente || "No disponible"}</td><td>{vehicleLabel(vehicle)}</td><td>{clientLabel(order, clientsById)}</td><td><OrderStatus order={order} /></td><td><ApprovalStatus order={order} /></td><td>{order.plazaId || "Sin asignar"}</td><td>{formatDate(order.actualizadoEn)}</td></tr>; })}</tbody></table></div>
        <div className="erp-card-list erp-mobile-only">{visibleOrders.map((order) => { const vehicle = vehiclesById.get(order.vehiculoId); return <article className="erp-record-card" key={order.otId}><header className="erp-record-card__header"><div><h3 className="erp-record-card__title"><Link className="vehicle-link" to={`/taller/ordenes/${order.otId}`}>{order.numeroOT}</Link></h3><p className="erp-record-card__subtitle">{vehicle?.patente || "Patente no disponible"} · {vehicleLabel(vehicle)}</p></div><OrderStatus order={order} /></header><dl className="erp-meta-grid"><div className="erp-meta erp-meta--wide"><dt className="erp-meta__label">Cliente histórico</dt><dd className="erp-meta__value">{clientLabel(order, clientsById)}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Aprobación</dt><dd className="erp-meta__value"><ApprovalStatus order={order} /></dd></div><div className="erp-meta"><dt className="erp-meta__label">Plaza</dt><dd className="erp-meta__value">{order.plazaId || "Sin asignar"}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Actualización</dt><dd className="erp-meta__value">{formatDate(order.actualizadoEn)}</dd></div></dl></article>; })}</div>
      </>}
    </section>
  </main>;
}
