import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../domain/rbac.mjs";
import React, {useCallback, useEffect, useRef, useState} from "react";
import {ArrowLeft, Ban, RefreshCw} from "lucide-react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import Button from "../components/ui/Button";
import LoadingState from "../components/ui/LoadingState";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import StatusBadge from "../components/ui/StatusBadge";
import ExecutionPanel from "../features/workOrders/ExecutionPanel";
import DeliveryPanel from "../features/workOrders/DeliveryPanel";
import ApprovalPanel from "../features/workOrders/ApprovalPanel";
import AdminOverviewCards from "../features/workOrders/AdminOverviewCards";
import TrackingLinkCard from "../features/workOrders/TrackingLinkCard";
import ReceptionPanel from "../features/workOrders/ReceptionPanel";
import WorkOrderPlazaControl from "../features/workOrders/WorkOrderPlazaControl";
import {
  getWorkOrderApprovalLabel,
  getWorkOrderApprovalVariant,
  getWorkOrderDisplayStatusLabel,
  getWorkOrderDisplayStatusVariant,
  isWorkOrderWaitingForPlaza,
} from "../domain/workOrderModel.mjs";
import {auth} from "../firebase/firebaseConfig";
import {obtenerVehiculo} from "../services/vehicleService";
import {listarPlazasTaller} from "../services/workshopPlazaService";
import {
  createWorkOrderRequestId,
  ejecutarCierreOT,
  getWorkOrderErrorMessage,
  listarServiciosOT,
  obtenerOrdenTrabajo,
} from "../services/workOrderService";




// Flujo único y predecible: Recepción → Aprobación → Ejecución → Entrega.
const FLOW_STEPS = Object.freeze([
  {id: "recepcion", label: "Recepción"},
  {id: "aprobacion", label: "Aprobación"},
  {id: "ejecucion", label: "Ejecución"},
  {id: "entrega", label: "Entrega"},
]);

function currentFlowStep(order) {
  if (!order.recepcion) return "recepcion";
  if (order.estado === "en_reparacion") return "ejecucion";
  if (["pendiente_entrega", "cerrada"].includes(order.estado)) return "entrega";
  if (order.estado === "cancelada") return "recepcion";
  return "aprobacion";
}

export default function WorkOrderDetailPage({businessId, role}) {
  const {otId} = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const creationFeedback = String(location.state?.feedback || "");
  const [order, setOrder] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [services, setServices] = useState([]);
  const [plazas, setPlazas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedStep, setSelectedStep] = useState(null);
  const hadReceptionRef = useRef(false);
  const [closureTarget, setClosureTarget] = useState(null);
  const [closureBusy, setClosureBusy] = useState(false);
  const [closureNotice, setClosureNotice] = useState("");
  const [closureActionError, setClosureActionError] = useState("");
  const [closureMotivo, setClosureMotivo] = useState("");
  const canManage = hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_MANAGE);
  const canOperate = hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_OPERATE);

  const load = useCallback(async () => {
    if (!businessId || !otId) return;
    setLoading(true);
    setError("");
    try {
      const orderItem = await obtenerOrdenTrabajo(businessId, otId);
      if (!orderItem) {
        setOrder(null);
        setVehicle(null);
        setServices([]);
        setPlazas([]);
        return;
      }
      const [vehicleItem, serviceItems, plazaItems] = await Promise.all([
        obtenerVehiculo(businessId, orderItem.vehiculoId),
        listarServiciosOT(businessId, otId),
        listarPlazasTaller(businessId),
      ]);
      setOrder(orderItem);
      setSelectedStep(null);
      setVehicle(vehicleItem);
      setServices(serviceItems);
      setPlazas(plazaItems);
    } catch (loadError) {
      setError(getWorkOrderErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [businessId, otId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setClosureTarget(null);
    setClosureNotice("");
    setClosureActionError("");
  }, [businessId, otId]);

  // Refresca solo la OT (estado, recepción) sin la pantalla de carga completa de load().
  const refreshOrder = useCallback(async () => {
    const currentOrder = await obtenerOrdenTrabajo(businessId, otId);
    if (currentOrder) {
      // Al registrar la recepción por primera vez, la pantalla avanza sola a la aprobación. Mientras se
      // toman las fotos, o al actualizar una recepción ya registrada, se queda en el paso actual.
      const justRegistered = !hadReceptionRef.current && Boolean(currentOrder.recepcion);
      setOrder(currentOrder);
      setSelectedStep((current) => (justRegistered ? null : current || "recepcion"));
    }
  }, [businessId, otId]);

  const refreshServices = useCallback(async () => {
    const [items, currentOrder] = await Promise.all([
      listarServiciosOT(businessId, otId), obtenerOrdenTrabajo(businessId, otId),
    ]);
    setServices(items);
    if (currentOrder) { setOrder(currentOrder); setSelectedStep(null); }
  }, [businessId, otId]);

  const confirmClosure = async () => {
    if (!closureTarget || closureBusy) return;
    setClosureBusy(true);
    setClosureActionError("");
    try {
      const closure = await ejecutarCierreOT(businessId, otId, closureTarget.action,
        closureTarget.revision, closureTarget.requestId, closureMotivo);
      setClosureTarget(null);
      setClosureNotice(closureTarget.action === "finalizar"
        ? `Ejecución finalizada. La Plaza quedó libre y el vehículo está pendiente de entrega.${closure?.ventaNumero ? ` Se generó la venta ${closure.ventaNumero} en borrador para Ventas.` : ""}`
        : closureTarget.action === "entregar"
          ? "Entrega registrada. La OT quedó cerrada."
          : "Orden de trabajo cancelada.");
      await refreshServices();
    } catch (actionError) {
      setClosureActionError(getWorkOrderErrorMessage(actionError));
      if (String(actionError?.code || "").includes("aborted")) {
        setClosureTarget(null);
        try { await refreshServices(); } catch (refreshError) { setClosureActionError(getWorkOrderErrorMessage(refreshError)); }
      }
    } finally {
      setClosureBusy(false);
    }
  };

  if (loading) return <LoadingState variant="page" label="Cargando orden de trabajo..." />;
  if (error) return <main className="erp-page"><div className="vehicle-message vehicle-message--error" role="alert"><span>{error}</span><Button type="button" variant="secondary" icon={RefreshCw} onClick={load}>Reintentar</Button></div></main>;
  if (!order) return <main className="erp-page"><div className="erp-empty-state" role="status"><h2>Orden de trabajo no encontrada</h2><p>Puede no existir o no pertenecer al negocio activo.</p><Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate("/taller/ordenes")}>Volver a órdenes</Button></div></main>;

  const otLabel = order.numeroOT ? `la orden ${order.numeroOT}` : "esta orden";
  hadReceptionRef.current = Boolean(order.recepcion);
  const flowStep = currentFlowStep(order);
  // Solo el Administrador o el Owner navegan entre pasos; el técnico queda en el paso vigente.
  const activeStep = canManage && selectedStep ? selectedStep : flowStep;
  const vehicleLabel = vehicle ? `${vehicle.marca} ${vehicle.modelo}` : "Vehículo no disponible";
  const plazaLabel = plazas.find((plaza) => plaza.plazaId === order.plazaId)?.nombre || "Sin asignar";
  const currentUserUid = auth.currentUser?.uid || "";
  const canCancel = canOperate && [
    "ingresada", "en_cola", "en_diagnostico", "esperando_aprobacion", "esperando_repuestos",
  ].includes(order.estado);

  const beginClosure = (action) => {
    setClosureActionError("");
    setClosureNotice("");
    setClosureMotivo("");
    setClosureTarget({action, revision: order.actualizadoEn?.toMillis?.(), requestId: createWorkOrderRequestId()});
  };

  return <main className="erp-page work-orders-page">
    <header className="erp-page-header">
      <div className="erp-page-header__content">
        <p className="erp-page-header__eyebrow">Taller · Órdenes de trabajo</p>
        <h1 className="erp-page-header__title">{order.numeroOT || "Orden de trabajo"}</h1>
        <p className="erp-page-header__description">{vehicleLabel} · {vehicle?.patente || "Patente no disponible"}</p>
        <div className="work-order-header-meta" aria-label="Estado actual de la orden">
          <StatusBadge variant={getWorkOrderDisplayStatusVariant(order)}>{getWorkOrderDisplayStatusLabel(order)}</StatusBadge>
          <StatusBadge variant={getWorkOrderApprovalVariant(order.estadoAprobacion)}>{getWorkOrderApprovalLabel(order.estadoAprobacion)}</StatusBadge>
          <StatusBadge variant="neutral">Plaza: {plazaLabel}</StatusBadge>
          {order.responsableNombre && <StatusBadge variant="neutral">Responsable: {order.responsableNombre}</StatusBadge>}
        </div>
      </div>
      <div className="erp-module-actions"><Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate("/taller/ordenes")}>Volver</Button><WorkOrderPlazaControl businessId={businessId} onChanged={load} order={order} plazas={plazas} role={role} />{canCancel && <Button type="button" variant="ghost-danger" icon={Ban} disabled={closureBusy} onClick={() => beginClosure("cancelar")}>Cancelar OT</Button>}</div>
    </header>

    {creationFeedback && <div className="vehicle-message" role="status">{creationFeedback}</div>}
    <nav aria-label="Pasos de la orden de trabajo"><ol className="work-order-steps">
      {FLOW_STEPS.map((step, index) => <li key={step.id}><button type="button" aria-current={activeStep === step.id ? "step" : undefined}
        disabled={!canManage} title={canManage ? undefined : "Solo el Administrador o el Owner pueden cambiar de paso."}
        data-done={FLOW_STEPS.findIndex((item) => item.id === flowStep) > index ? "true" : undefined}
        onClick={() => setSelectedStep(step.id)}><span className="work-order-steps__number">{index + 1}</span>{step.label}</button></li>)}
    </ol></nav>

    {activeStep === "recepcion" && <ReceptionPanel businessId={businessId} onSaved={refreshOrder} order={order} otId={otId} role={role} />}
    {activeStep === "aprobacion" && (order.recepcion
      ? <ApprovalPanel businessId={businessId} otId={otId} order={order} onChanged={refreshServices} />
      : <div className="erp-empty-state" role="status">Registra la recepción para poder aprobar el ingreso.</div>)}
    {activeStep === "ejecucion" && (["en_reparacion", "pendiente_entrega", "cerrada"].includes(order.estado)
      ? <ExecutionPanel businessId={businessId} currentUserUid={currentUserUid} finalizeBusy={closureBusy}
        onChanged={refreshServices} onFinalize={() => beginClosure("finalizar")}
        order={order} otId={otId} role={role} services={services} />
      : <div className="erp-empty-state" role="status">{isWorkOrderWaitingForPlaza(order)
        ? "Ingreso aprobado. La ejecución comienza cuando se asigne una plaza."
        : "La ejecución comienza cuando el ingreso está aprobado."}</div>)}
    {activeStep === "entrega" && <DeliveryPanel businessId={businessId} canManage={canManage} canOperate={canOperate}
      onChanged={refreshServices} order={order} otId={otId}
      vehicleLabel={`${vehicleLabel}${vehicle?.patente ? ` (${vehicle.patente})` : ""}`} />}
    {canOperate && activeStep === "ejecucion" && order.estadoAprobacion === "aprobada" &&
      ["en_reparacion", "pendiente_entrega"].includes(order.estado) &&
      <TrackingLinkCard businessId={businessId} order={order} otId={otId}
        vehicleLabel={`${vehicleLabel}${vehicle?.patente ? ` (${vehicle.patente})` : ""}`} />}
    {canManage && <AdminOverviewCards businessId={businessId} order={order} otId={otId} plazas={plazas} revision={order.actualizadoEn?.toMillis?.()} services={services} />}
    <ResponsiveDialog open={Boolean(closureTarget)} onClose={() => !closureBusy && setClosureTarget(null)} size="small" eyebrow="Taller"
      title={closureTarget?.action === "finalizar" ? "Finalizar ejecución" : closureTarget?.action === "entregar" ? "Registrar entrega" : "Cancelar orden de trabajo"}
      description={closureTarget?.action === "finalizar" ? "Se comprobará que todos los trabajos estén terminados, se liberará la Plaza y se generará la venta en borrador para Ventas." : closureTarget?.action === "entregar" ? "Se registrará la entrega física y la OT quedará cerrada." : "La OT quedará cancelada de forma permanente y se liberará su Plaza, si corresponde."}
      footer={<><Button type="button" variant="secondary" disabled={closureBusy} onClick={() => setClosureTarget(null)}>Volver</Button><Button type="button" variant={closureTarget?.action === "cancelar" ? "danger" : "primary"} disabled={closureBusy} onClick={confirmClosure}>{closureBusy ? "Procesando..." : closureTarget?.action === "cancelar" ? "Cancelar OT" : "Confirmar"}</Button></>}>
      <p>{closureTarget?.action === "finalizar"
        ? `¿Confirmas que la ejecución de ${otLabel} está terminada? Todos los trabajos están terminados, la Plaza quedará libre, se generará la venta en borrador y el vehículo quedará pendiente de entrega.`
        : closureTarget?.action === "entregar"
          ? `¿Confirmas que el vehículo de ${otLabel} fue entregado al cliente? La OT quedará cerrada.`
          : `¿Confirmas que quieres cancelar ${otLabel}? Esta acción no se puede deshacer.`}</p>
      {closureTarget?.action === "cancelar" && <label className="erp-field"><span className="erp-field__label">Motivo (opcional)</span>
        <textarea className="erp-control" value={closureMotivo} maxLength={2000} disabled={closureBusy} onChange={(event) => setClosureMotivo(event.target.value)} /></label>}
      {closureActionError && <div className="vehicle-message vehicle-message--error" role="alert">{closureActionError}</div>}
    </ResponsiveDialog>
  </main>;
}
