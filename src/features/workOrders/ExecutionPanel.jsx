import React, {useCallback, useEffect, useMemo, useState} from "react";
import {Plus} from "lucide-react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../../domain/rbac.mjs";
import {
  canOperateOrderWorks, executionRequirements, receptionSummary, workProgress,
} from "../../domain/workOrderExecutionModel.mjs";
import {getReceptionWarningLightLabel} from "../../domain/workOrderReceptionModel.mjs";
import {
  actualizarProductoOT, agregarProductoOT, completarServicioOT, createWorkOrderRequestId, crearServicioOT,
  definirRepuestosServicioOT, eliminarProductoOT, eliminarServicioOT, getWorkOrderErrorMessage, iniciarServicioOT,
  listarCatalogoTaller, reabrirServicioOT,
} from "../../services/workOrderService";
import ExecutionFindings from "./ExecutionFindings";
import ExecutionWorkItem from "./ExecutionWorkItem";

function Card({children, hint, title}) {
  return <section className="erp-panel work-order-reception-card">
    <div className="work-order-reception-card__header">
      <h2 className="erp-panel-title">{title}</h2>
      {hint && <span className="erp-secondary-text">{hint}</span>}
    </div>
    {children}
  </section>;
}

function ReceptionSummary({order}) {
  const summary = receptionSummary(order);
  const lights = summary.testigosEncendidos === true
    ? summary.testigos.map(getReceptionWarningLightLabel).join(", ") || "Sí"
    : summary.testigosEncendidos === false ? "Ninguno" : "No informado";
  return <dl className="vehicle-detail-grid work-order-execution__reception">
    <div className="vehicle-detail-item"><dt>Kilometraje</dt>
      <dd>{summary.kilometraje === null ? "No informado" : `${summary.kilometraje.toLocaleString("es-CL")} km`}</dd></div>
    <div className="vehicle-detail-item"><dt>Combustible</dt><dd>{summary.combustible || "No informado"}</dd></div>
    <div className="vehicle-detail-item"><dt>Fotos selladas</dt><dd>{summary.fotosSelladas}</dd></div>
    <div className="vehicle-detail-item"><dt>Sensores encendidos</dt><dd>{lights}</dd></div>
    <div className="vehicle-detail-item work-order-execution__damages"><dt>Daños previos</dt>
      <dd>{summary.previousDamages.length
        ? <ul>{summary.previousDamages.map((damage) => <li key={damage.zona}>{damage.zona}: {damage.notas.join("; ")}</li>)}</ul>
        : "Sin daños previos registrados"}</dd></div>
  </dl>;
}

// Pantalla de ejecución (prototipo «Panel del Taller»): motivo del cliente, trabajos sin montos y los
// requisitos para finalizar.
export default function ExecutionPanel({
  businessId, currentUserUid, finalizeBusy = false, onChanged, onFinalize, order, otId, role, services,
}) {
  const canOperatePermission = hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_OPERATE);
  const canManage = hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_MANAGE);
  const running = order.estado === "en_reparacion" && order.estadoAprobacion === "aprobada";
  const canOperate = running && canOperateOrderWorks({canManage, canOperate: canOperatePermission, order, uid: currentUserUid});
  // Los nombres del catálogo se congelan al finalizar la ejecución; antes se lee el catálogo vigente.
  const frozen = ["pendiente_entrega", "cerrada"].includes(order.estado);
  const finished = frozen; // la ejecución ya terminó: se muestra lo que se hizo, sin acciones
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [receptionOpen, setReceptionOpen] = useState(false);
  const [newItemId, setNewItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listarCatalogoTaller(businessId)
      .then((items) => { if (active) { setInventory(items); setLoadError(""); } })
      .catch((failure) => { if (active) setLoadError(getWorkOrderErrorMessage(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId]);

  // El stock de Inventario puede cambiar en otras pantallas: se recarga tras cada cambio de repuestos.
  const reloadInventory = useCallback(async () => {
    try { setInventory(await listarCatalogoTaller(businessId)); } catch (_reloadError) { /* conserva el catálogo anterior */ }
  }, [businessId]);

  const serviceOptions = useMemo(() => inventory.filter((item) => item.tipoItem === "servicio" && item.estado === "activo"), [inventory]);
  const productOptions = useMemo(() => inventory.filter((item) => item.tipoItem === "producto" && item.estado === "activo"), [inventory]);
  const lookup = useCallback((itemId) => inventory.find((item) => item.itemId === itemId), [inventory]);

  // Ejecuta una acción del servidor con el mismo manejo de errores; devuelve true si salió bien.
  const run = useCallback(async (action, message, {stock = false} = {}) => {
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      await action();
      await Promise.all([onChanged(), stock ? reloadInventory() : Promise.resolve()]);
      if (message) setNotice(message);
      return true;
    } catch (failure) {
      setError(getWorkOrderErrorMessage(failure));
      if (String(failure?.code || "").includes("aborted")) {
        try { await onChanged(); } catch (refreshError) { setError(getWorkOrderErrorMessage(refreshError)); }
      }
      return false;
    } finally { setBusy(false); }
  }, [busy, onChanged, reloadInventory]);

  const revision = (service) => service.actualizadoEn?.toMillis?.();
  const actions = {
    refresh: onChanged,
    start: (service) => run(() => iniciarServicioOT(businessId, otId, service.servicioOtId, revision(service), createWorkOrderRequestId()), "Trabajo iniciado."),
    finish: (service) => run(() => completarServicioOT(businessId, otId, service.servicioOtId, revision(service), createWorkOrderRequestId()), "Trabajo terminado."),
    setPartsMode: (service, mode) => run(() => definirRepuestosServicioOT(businessId, otId, service.servicioOtId, mode, revision(service)),
      mode === "cliente" ? "Repuestos del cliente registrados." : "Trabajo sin repuestos registrado."),
    saveProduct: (service, draft, existing) => {
      const quantity = Number(draft.cantidad);
      if (!draft.itemId || !Number.isInteger(quantity) || quantity <= 0) {
        setError("Selecciona un repuesto del inventario e ingresa una cantidad entera positiva.");
        return Promise.resolve(false);
      }
      return run(() => existing
        ? actualizarProductoOT(businessId, otId, service.servicioOtId, existing.productoOtId, quantity, revision(service))
        : agregarProductoOT(businessId, otId, service.servicioOtId, draft.itemId, quantity, createWorkOrderRequestId()),
      "Repuesto guardado. El stock no se modificó.", {stock: true});
    },
    changeQuantity: (service, product, quantity) => run(() =>
      actualizarProductoOT(businessId, otId, service.servicioOtId, product.productoOtId, quantity, revision(service)), "", {stock: true}),
    removeProduct: (service, product) => run(() =>
      eliminarProductoOT(businessId, otId, service.servicioOtId, product.productoOtId, revision(service)),
    "Repuesto quitado. El stock no se modificó.", {stock: true}),
    askRemoveWork: (service) => setConfirmation({kind: "quitar", service}),
    askReopen: (service) => setConfirmation({kind: "reabrir", service}),
  };

  const addWork = async (event) => {
    event.preventDefault();
    if (!newItemId) { setError("Selecciona un servicio del catálogo."); return; }
    const ok = await run(() => crearServicioOT(businessId, otId, {itemId: newItemId}, createWorkOrderRequestId()), "Trabajo agregado.");
    if (ok) setNewItemId("");
  };

  const confirmAction = async () => {
    if (!confirmation) return;
    const {kind, service} = confirmation;
    const ok = kind === "reabrir"
      ? await run(() => reabrirServicioOT(businessId, otId, service.servicioOtId, revision(service), createWorkOrderRequestId()), "Trabajo reabierto.")
      : await run(() => eliminarServicioOT(businessId, otId, service.servicioOtId, revision(service)), "Trabajo quitado de la orden.");
    if (ok) setConfirmation(null);
  };

  const summary = receptionSummary(order);
  const progress = workProgress(services);
  const requirements = executionRequirements(services);
  const canFinalize = running && canManage && progress.complete && !finalizeBusy && !busy;

  return <div className="work-order-reception work-order-execution">
    <Card title="Motivo del cliente">
      <p>{summary.motivo || "Sin motivo registrado."}</p>
      <div className="vehicle-form-actions">
        <Button type="button" variant="secondary" aria-expanded={receptionOpen} onClick={() => setReceptionOpen((value) => !value)}>
          {receptionOpen ? "Ocultar recepción" : "Ver recepción"}
        </Button>
      </div>
      {receptionOpen && <ReceptionSummary order={order} />}
    </Card>

    <Card title={finished ? "Trabajos realizados" : "Trabajos"} hint={order.responsableNombre ? `Responsable: ${order.responsableNombre}` : ""}>
      {finished && <div className="vehicle-message" role="status"><strong>Ejecución finalizada.</strong> Estos son los trabajos que se realizaron en la orden ({progress.done} de {progress.total} terminados).</div>}
      {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
      {notice && <div className="vehicle-message" role="status">{notice}</div>}
      {loading && <LoadingState variant="section" label="Cargando catálogo..." />}
      {loadError && <div className="vehicle-message vehicle-message--error" role="alert">{loadError}</div>}
      {running && !canOperate && canOperatePermission && <p className="erp-secondary-text">
        Solo el responsable ({order.responsableNombre || "sin responsable"}), el Administrador o el Owner operan los trabajos.</p>}
      {canOperate && <form className="work-order-execution__add" onSubmit={addWork} noValidate>
        <label className="erp-field"><span className="erp-field__label">Servicio del catálogo</span>
          <select className="erp-control" value={newItemId} disabled={busy || loading}
            onChange={(event) => { setNewItemId(event.target.value); setError(""); }}>
            <option value="">Selecciona un servicio</option>
            {serviceOptions.map((item) => <option key={item.itemId} value={item.itemId}>{item.codigoInterno ? `${item.codigoInterno} · ` : ""}{item.nombre}</option>)}
          </select></label>
        <Button type="submit" icon={Plus} disabled={busy || loading || Boolean(loadError) || !newItemId}>Agregar</Button>
      </form>}
      {canOperate && !serviceOptions.length && !loading && <p className="erp-secondary-text">No hay servicios activos en Inventario.</p>}
      {!services.length && !loading && <div className="erp-empty-state" role="status">Aún no hay trabajos en esta orden.</div>}
      <div className="work-order-works">
        {services.map((service) => <ExecutionWorkItem key={service.servicioOtId} actions={actions} businessId={businessId}
          busy={busy} canEdit={canOperate && service.estado !== "completado"} canManage={canManage} readOnly={finished}
          canOperate={canOperate} frozen={frozen} item={lookup(service.itemId)} open={openId === service.servicioOtId}
          onToggle={() => setOpenId((current) => (current === service.servicioOtId ? null : service.servicioOtId))}
          otId={otId} productLookup={lookup} productOptions={productOptions} service={service} />)}
      </div>
    </Card>

    <ExecutionFindings businessId={businessId} canConvert={canManage} canReport={canOperate} onConverted={onChanged}
      otId={otId} revision={order.actualizadoEn?.toMillis?.()} running={running} serviceOptions={serviceOptions} />

    {!finished && <Card title="Para finalizar la ejecución">
      <ul className="work-order-requirements" aria-label="Para finalizar la ejecución">
        {requirements.map((item) => <li key={item.label} data-done={item.done ? "true" : undefined}>{item.label}</li>)}
      </ul>
      {running && canManage && <div className="vehicle-form-actions">
        <Button type="button" disabled={!canFinalize} onClick={onFinalize}>Finalizar ejecución</Button>
      </div>}
      {running && !canManage && progress.complete && <p className="erp-secondary-text" role="status">
        Trabajos terminados. El Administrador o el Owner pueden finalizar la ejecución.</p>}
    </Card>}

    <ResponsiveDialog open={Boolean(confirmation)} onClose={() => !busy && setConfirmation(null)} size="small" eyebrow="Taller"
      title={confirmation?.kind === "reabrir" ? "Reabrir trabajo" : "Quitar trabajo"}
      description={confirmation?.kind === "reabrir"
        ? "El trabajo vuelve a ejecución y deberá terminarse de nuevo."
        : "Se quitará el trabajo de la orden. Solo se pueden quitar trabajos pendientes."}
      footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Volver</Button>
        <Button type="button" disabled={busy} onClick={confirmAction}>{busy ? "Procesando..." : "Confirmar"}</Button></>}>
      <p>{confirmation?.kind === "reabrir" ? "¿Confirmas que quieres reabrir este trabajo?" : "¿Confirmas que quieres quitar este trabajo?"}</p>
      {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    </ResponsiveDialog>
  </div>;
}
