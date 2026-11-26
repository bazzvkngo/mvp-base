import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  AlertTriangle, Car, CheckCircle2, ClipboardCheck, ClipboardList, Clock, Hourglass, Info, Package, PackageCheck, RefreshCw,
  Search, Warehouse, Wrench,
} from "lucide-react";
import {Link, useNavigate} from "react-router-dom";
import Button from "../components/ui/Button";
import LoadingState from "../components/ui/LoadingState";
import StatusBadge from "../components/ui/StatusBadge";
import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../domain/rbac.mjs";
import {getWorkOrderDisplayStatusLabel} from "../domain/workOrderModel.mjs";
import {
  elapsedLabel,
  greetingPersonName,
  lowStockAttention,
  technicianPendingWorks,
  technicianWorkOrders,
  workshopAttentionItems,
  workshopGreeting,
  workshopHeadline,
  workshopHomeTiles,
  workshopTodayActivity,
} from "../domain/workshopHomeModel.mjs";
import {deriveWorkshopPlazaOccupancy, getPlazaBayStatus, plazaWorkProgress} from "../domain/workshopPlazaModel.mjs";
import {WORK_STATUS_LABELS, WORK_STATUS_VARIANTS} from "../domain/workOrderExecutionModel.mjs";
import {BayBadge, ProgressRing, TopCar} from "../features/workOrders/WorkshopVisuals";
import {auth} from "../firebase/firebaseConfig";
import {listarVehiculos} from "../services/vehicleService";
import {listarCatalogoTaller, listarHallazgosOT, listarOrdenesTrabajo, listarServiciosOT, obtenerPerfilPropio} from "../services/workOrderService";
import {listarPlazasTaller} from "../services/workshopPlazaService";

// Panel del taller (prototipo «Panel del Taller»). Administración ve el pulso del taller: indicadores que llevan a la
// lista filtrada, lo que requiere atención (con cuánto lleva esperando), las plazas y la actividad del día. El técnico
// ve sus OT, el siguiente trabajo de cada una y sus pendientes. Se actualiza solo cada 2 minutos y al volver a la
// pestaña. Todo se deriva de las OT, sus trabajos y sus hallazgos; no se muestran montos.

const REFRESH_MS = 2 * 60 * 1000;
const ATTENTION_ICONS = {
  hallazgo: AlertTriangle, finalizar: CheckCircle2, detenido: Hourglass, retiro: PackageCheck, aprobar: ClipboardCheck, cola: Clock, stock: Package,
};

function vehicleName(vehicle) {
  return vehicle ? `${vehicle.marca} ${vehicle.modelo}` : "Vehículo no disponible";
}

function todayLabel(date = new Date()) {
  const label = date.toLocaleDateString("es-CL", {weekday: "long", day: "numeric", month: "long"});
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function timeLabel(value) {
  const millis = typeof value?.toMillis === "function" ? value.toMillis() : value;
  return millis ? new Date(millis).toLocaleTimeString("es-CL", {hour: "2-digit", minute: "2-digit"}) : "";
}

// Saludo: «Nombre Apellido» del perfil si la persona tiene ambos; si no, lo de siempre (nombre de la cuenta o correo).
function fallbackUserName() {
  const user = auth.currentUser;
  return user?.displayName || user?.email?.split("@")[0] || "";
}

function Tile({icon: Icon, label, to, tone, value}) {
  return <Link className="workshop-home__tile" data-tone={tone} to={to}>
    <span className="workshop-home__tile-icon" aria-hidden="true"><Icon size={22} /></span>
    <span><strong>{value}</strong><span>{label}</span></span>
  </Link>;
}

export default function WorkshopHomePage({businessId, role}) {
  const navigate = useNavigate();
  const canManage = hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_MANAGE);
  const canCreate = hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_CREATE);
  const uid = auth.currentUser?.uid || "";
  const [data, setData] = useState({orders: [], vehicles: new Map(), plazas: [], catalog: []});
  const [servicesByOrder, setServicesByOrder] = useState(new Map());
  const [findingsByOrder, setFindingsByOrder] = useState(new Map());
  const [workNames, setWorkNames] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const loadingRef = useRef(false);

  // Con `silent` (actualización automática) no se muestra la carga ni se pierde lo que ya está en pantalla.
  const load = useCallback(async ({silent = false} = {}) => {
    if (!businessId || loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) { setLoading(true); setError(""); }
    try {
      const [orders, vehicles, plazas, catalog] = await Promise.all([
        listarOrdenesTrabajo(businessId), listarVehiculos(businessId), canManage ? listarPlazasTaller(businessId) : [],
        // Stock bajo: si el catálogo no responde, el panel se muestra igual sin ese aviso.
        canManage ? listarCatalogoTaller(businessId).catch(() => []) : [],
      ]);
      setData({orders, vehicles: new Map(vehicles.map((vehicle) => [vehicle.vehiculoId, vehicle])), plazas, catalog});
      setNow(new Date());
      setError("");
    } catch (_failure) {
      if (!silent) setError("No se pudo cargar el panel del taller. Revisa tu conexión e inténtalo nuevamente.");
    } finally {
      loadingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [businessId, canManage]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") load({silent: true}); };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);

  useEffect(() => {
    let active = true;
    if (uid) obtenerPerfilPropio(uid).then((profile) => { if (active) setProfileName(greetingPersonName(profile)); });
    return () => { active = false; };
  }, [uid]);

  const myOrders = useMemo(() => technicianWorkOrders(data.orders, uid), [data.orders, uid]);

  // Trabajos (y, para Administración, hallazgos) de las OT en curso. Si uno falla, el resto del panel se muestra igual.
  useEffect(() => {
    let active = true;
    const executing = data.orders.filter((order) => ["en_reparacion", "pendiente_entrega"].includes(order.estado));
    const targets = canManage ? executing : executing.filter((order) => myOrders.includes(order));
    Promise.all(targets.map((order) => listarServiciosOT(businessId, order.otId)
      .then((services) => [order.otId, services]).catch(() => [order.otId, []])))
      .then((entries) => { if (active) setServicesByOrder(new Map(entries)); });
    if (canManage) {
      Promise.all(executing.filter((order) => order.estado === "en_reparacion").map((order) => listarHallazgosOT(businessId, order.otId)
        .then((findings) => [order.otId, findings]).catch(() => [order.otId, []])))
        .then((entries) => { if (active) setFindingsByOrder(new Map(entries)); });
    }
    return () => { active = false; };
  }, [businessId, canManage, data.orders, myOrders]);

  // Nombres de los trabajos para «Siguiente» del técnico (catálogo del taller; no se muestran precios).
  useEffect(() => {
    if (canManage || !myOrders.length || workNames.size) return undefined;
    let active = true;
    listarCatalogoTaller(businessId)
      .then((items) => { if (active) setWorkNames(new Map(items.map((item) => [item.itemId || item.id, item.nombre]))); })
      .catch(() => {});
    return () => { active = false; };
  }, [businessId, canManage, myOrders.length, workNames.size]);

  const headline = workshopHeadline(data.orders);
  const pendingMine = technicianPendingWorks(myOrders, servicesByOrder);
  const hero = <section className="workshop-home__hero">
    <p className="workshop-home__kicker">{role?.nombreComercial ? `${role.nombreComercial} · ` : ""}{todayLabel(now)}</p>
    <h2>{workshopGreeting(now)}{(profileName || fallbackUserName()) ? `, ${profileName || fallbackUserName()}` : ""}</h2>
    {!loading && !error && (canManage
      ? <p>Hoy hay <strong>{headline.enTaller} {headline.enTaller === 1 ? "vehículo" : "vehículos"}</strong> en el taller
        {headline.enCola ? <> y <strong>{headline.enCola} esperando plaza</strong></> : null}
        {headline.listos ? <>. <strong>{headline.listos}</strong> {headline.listos === 1 ? "listo" : "listos"} para retiro.</> : "."}</p>
      : <p>Tienes <strong>{myOrders.length} OT a tu cargo</strong> y <strong>{pendingMine} {pendingMine === 1 ? "trabajo pendiente" : "trabajos pendientes"}</strong>.</p>)}
    <div className="workshop-home__actions">
      {canCreate && <Button type="button" icon={Car} onClick={() => navigate("/taller/ordenes/nueva")}>Nueva recepción</Button>}
      <Button type="button" variant="secondary" icon={Search} onClick={() => navigate("/taller/vehiculos")}>Buscar por patente</Button>
      {canManage && <Button type="button" variant="secondary" icon={Warehouse} onClick={() => navigate("/taller/plazas")}>Plazas</Button>}
    </div>
  </section>;

  if (loading) return <main className="erp-page workshop-home">{hero}<LoadingState variant="section" label="Cargando el taller..." /></main>;
  if (error) {
    return <main className="erp-page workshop-home">{hero}
      <div className="vehicle-message vehicle-message--error" role="alert"><span>{error}</span>
        <Button type="button" variant="secondary" icon={RefreshCw} onClick={() => load()}>Reintentar</Button></div>
    </main>;
  }
  return <main className="erp-page workshop-home">
    {hero}
    {canManage
      ? <AdminHome data={data} findingsByOrder={findingsByOrder} now={now} servicesByOrder={servicesByOrder} />
      : <TechnicianHome orders={myOrders} pending={pendingMine} servicesByOrder={servicesByOrder} vehicles={data.vehicles} workNames={workNames} />}
  </main>;
}

function AdminHome({data, findingsByOrder, now, servicesByOrder}) {
  const {catalog, orders, plazas, vehicles} = data;
  const tiles = workshopHomeTiles(orders, servicesByOrder, now);
  const stockAlert = lowStockAttention(catalog);
  const attention = [...workshopAttentionItems({orders, servicesByOrder, findingsByOrder, now}), ...(stockAlert ? [stockAlert] : [])];
  const occupancy = deriveWorkshopPlazaOccupancy(plazas, orders);
  const activity = workshopTodayActivity(orders, now);
  const view = (key) => `/taller/ordenes?vista=${key}`;
  return <>
    <nav className="workshop-home__tiles" aria-label="Indicadores del taller">
      <Tile icon={ClipboardCheck} tone="info" value={tiles.porAprobar} label="Por aprobar" to={view("por-aprobar")} />
      <Tile icon={Wrench} tone="info" value={tiles.enReparacion} label="En reparación" to={view("en-reparacion")} />
      <Tile icon={Clock} tone="warning" value={tiles.enCola} label="En cola" to="/taller/plazas" />
      <Tile icon={PackageCheck} tone="success" value={tiles.listos} label="Listos para retiro" to={view("listos")} />
    </nav>

    <div className="workshop-home__two">
      <section className="erp-panel workshop-home__panel" aria-labelledby="workshop-attention-title">
        <h2 id="workshop-attention-title" className="erp-panel-title">Requiere atención</h2>
        {attention.length === 0
          ? <p className="erp-secondary-text">Todo al día: no hay pendientes de Administración.</p>
          : <ul className="workshop-home__alerts">
            {attention.map((item) => {
              const Icon = ATTENTION_ICONS[item.kind] || Info;
              return <li key={`${item.kind}-${item.to}-${item.detail}`} data-tone={item.tone}>
                <Link to={item.to}><Icon size={18} aria-hidden="true" />
                  <span><strong>{item.title}</strong><span>{item.detail}</span></span>
                  <time className="workshop-home__age">{elapsedLabel(item.since, now)}</time></Link>
              </li>;
            })}
          </ul>}
      </section>

      <section className="erp-panel workshop-home__panel" aria-labelledby="workshop-glance-title">
        <div className="erp-panel-header"><h2 id="workshop-glance-title" className="erp-panel-title">Plazas de un vistazo</h2>
          <Link className="vehicle-link" to="/taller/plazas">Ver detalle</Link></div>
        {plazas.length === 0
          ? <p className="erp-secondary-text">Aún no hay plazas. Créalas en Plazas.</p>
          : <ul className="workshop-home__mini">
            {plazas.map((plaza) => {
              const order = occupancy.get(plaza.plazaId)?.order;
              const inactive = plaza.estado !== "activa";
              const progress = order ? plazaWorkProgress(servicesByOrder.get(order.otId) || []) : null;
              const label = `${plaza.nombre}: ${order ? `${order.numeroOT}, ${getPlazaBayStatus(order).label}, ${progress.porcentaje}%` : inactive ? "inactiva" : "libre"}`;
              const content = <>
                <span>{plaza.nombre}</span>
                {order ? <TopCar size={26} tone={getPlazaBayStatus(order).tone} />
                  : <span className="workshop-home__mini-p" aria-hidden="true">{inactive ? "–" : "P"}</span>}
                <span>{order ? `${progress.porcentaje}%` : inactive ? "Inactiva" : "Libre"}</span>
              </>;
              // Una plaza ocupada abre la OT que la ocupa; libre o inactiva no tiene OT y no es un enlace.
              return <li key={plaza.plazaId}>
                {order
                  ? <Link to={`/taller/ordenes/${order.otId}`} aria-label={label} data-kind="occupied">{content}</Link>
                  : <span className="workshop-home__mini-cell" aria-label={label} data-kind={inactive ? "inactive" : "free"}>{content}</span>}
              </li>;
            })}
          </ul>}
      </section>
    </div>

    <section className="erp-panel workshop-home__panel" aria-labelledby="workshop-activity-title">
      <h2 id="workshop-activity-title" className="erp-panel-title">Actividad de hoy</h2>
      {activity.length === 0
        ? <p className="erp-secondary-text">Aún no hay movimientos hoy.</p>
        : <ul className="workshop-home__timeline">
          {activity.map((order) => <li key={order.otId}>
            <time>{timeLabel(order.actualizadoEn)}</time>
            <span><Link className="vehicle-link" to={`/taller/ordenes/${order.otId}`}>{order.numeroOT}</Link>
              {" · "}{vehicleName(vehicles.get(order.vehiculoId))} · {getWorkOrderDisplayStatusLabel(order)}</span>
          </li>)}
        </ul>}
    </section>
  </>;
}

function TechnicianHome({orders, pending, servicesByOrder, vehicles, workNames}) {
  return <>
    <div className="workshop-home__tiles">
      <div className="workshop-home__tile" data-tone="info">
        <span className="workshop-home__tile-icon" aria-hidden="true"><ClipboardList size={22} /></span>
        <span><strong>{orders.length}</strong><span>OT a mi cargo</span></span></div>
      <div className="workshop-home__tile" data-tone="warning">
        <span className="workshop-home__tile-icon" aria-hidden="true"><Wrench size={22} /></span>
        <span><strong>{pending}</strong><span>Trabajos pendientes</span></span></div>
    </div>
    <section className="erp-panel workshop-home__panel" aria-labelledby="workshop-mine-title">
      <h2 id="workshop-mine-title" className="erp-panel-title">Mis trabajos</h2>
      {orders.length === 0
        ? <p className="erp-secondary-text">No tienes OT a tu cargo por ahora.</p>
        : <ul className="workshop-home__mine">
          {orders.map((order) => {
            const vehicle = vehicles.get(order.vehiculoId);
            const status = getPlazaBayStatus(order);
            const services = servicesByOrder.get(order.otId) || [];
            const progress = plazaWorkProgress(services);
            return <li key={order.otId}>
              <Link to={`/taller/ordenes/${order.otId}`} className="workshop-home__mine-link">
                <TopCar size={34} tone={status.tone} />
                <span className="workshop-home__mine-body">
                  <strong>{vehicleName(vehicle)}</strong>
                  <span className="erp-secondary-text">{vehicle?.patente || "Sin patente"} · {order.numeroOT}</span>
                  <span className="workshop-home__mine-badges"><BayBadge tone={status.tone}>{status.label}</BayBadge>
                    <BayBadge tone="neutral">{progress.total ? `${progress.terminados} de ${progress.total} trabajos` : "Sin trabajos aún"}</BayBadge></span>
                </span>
                <ProgressRing size={56} value={progress.porcentaje} />
              </Link>
              {services.length > 0 && <ul className="workshop-home__works" aria-label={`Trabajos de ${order.numeroOT}`}>
                {services.map((service) => <li key={service.servicioOtId || service.itemId}>
                  <span>{service.servicioSnapshot?.nombre || workNames.get(service.itemId) || "Trabajo"}</span>
                  <StatusBadge variant={WORK_STATUS_VARIANTS[service.estado] || "neutral"}>{WORK_STATUS_LABELS[service.estado] || "Pendiente"}</StatusBadge>
                </li>)}
              </ul>}
            </li>;
          })}
        </ul>}
    </section>
    <div className="vehicle-message" role="note"><Info size={16} aria-hidden="true" />
      <span>Si encuentras algo fuera del motivo de ingreso, repórtalo como hallazgo dentro de la OT.</span></div>
  </>;
}
