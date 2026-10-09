import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Plus, Save} from "lucide-react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import StatusBadge from "../../components/ui/StatusBadge";
import ServiceMaterialsPanel from "./ServiceMaterialsPanel";
import {
  actualizarProductoOT, actualizarServicioOT, agregarProductoOT, crearServicioOT,
  completarServicioOT, createWorkOrderRequestId, eliminarProductoOT, eliminarServicioOT, getWorkOrderErrorMessage,
  iniciarServicioOT, obtenerMaterialesOT,
  listarCatalogoTaller, listarPersonasAsignablesTaller,
} from "../../services/workOrderService";

const OPERATION_ROLES = new Set(["OWNER", "ADMIN", "TECNICO", "MEMBER"]);
const SERVICE_LABELS = {pendiente: "Pendiente", en_progreso: "En progreso", completado: "Completado"};

function priceLabel(value, currency) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("es-CL", {style: "currency", currency: currency || "CLP", maximumFractionDigits: 0}).format(value)
    : "Precio no disponible";
}

export default function ServicePlanningPanel({
  businessId,
  canFinalizeWorkOrder = false,
  onChanged,
  onFinalizeWorkOrder,
  order,
  otId,
  role,
  services,
}) {
  const canOperate = OPERATION_ROLES.has(String(role || "").toUpperCase()) &&
    Boolean(order.recepcion) && ["en_cola", "en_diagnostico", "esperando_aprobacion", "esperando_repuestos", "en_reparacion"].includes(order.estado);
  const frozen = ["esperando_aprobacion", "esperando_repuestos", "en_reparacion", "pendiente_entrega", "cerrada"].includes(order.estado);
  const canExecute = OPERATION_ROLES.has(String(role || "").toUpperCase()) &&
    order.estado === "en_reparacion" && order.estadoAprobacion === "aprobada";
  const [inventory, setInventory] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editingService, setEditingService] = useState(null);
  const [serviceDraft, setServiceDraft] = useState({itemId: "", responsableUid: ""});
  const [serviceRequestId, setServiceRequestId] = useState("");
  const [productServiceId, setProductServiceId] = useState(null);
  const [productDraft, setProductDraft] = useState({itemId: "", cantidad: "1"});
  const [productRequestId, setProductRequestId] = useState("");
  const [quantityEdit, setQuantityEdit] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeServiceTarget, setRemoveServiceTarget] = useState(null);
  const [executionTarget, setExecutionTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [materials, setMaterials] = useState(null);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [materialsError, setMaterialsError] = useState("");
  const materialsRequest = useRef(0);

  const refreshMaterials = useCallback(async () => {
    const request = materialsRequest.current + 1;
    materialsRequest.current = request;
    setMaterialsLoading(true);
    setMaterialsError("");
    try {
      const result = await obtenerMaterialesOT(businessId, otId);
      if (materialsRequest.current === request) setMaterials(result);
      return true;
    } catch (failure) {
      if (materialsRequest.current === request) {
        setMaterials(null);
        setMaterialsError(getWorkOrderErrorMessage(failure));
      }
      return false;
    } finally {
      if (materialsRequest.current === request) setMaterialsLoading(false);
    }
  }, [businessId, otId]);

  useEffect(() => {
    void refreshMaterials();
  }, [refreshMaterials, services, order.estado, order.estadoAprobacion]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([listarCatalogoTaller(businessId), listarPersonasAsignablesTaller(businessId)])
      .then(([items, roster]) => {
        if (!active) return;
        setInventory(items);
        setPeople(roster.personas);
        setLoadError("");
      })
      .catch((loadFailure) => { if (active) setLoadError(getWorkOrderErrorMessage(loadFailure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId]);

  const serviceOptions = useMemo(() => inventory.filter((item) => item.tipoItem === "servicio" && item.estado === "activo"), [inventory]);
  const productOptions = useMemo(() => inventory.filter((item) => item.tipoItem === "producto" && item.estado === "activo"), [inventory]);
  const itemById = (itemId) => inventory.find((item) => item.itemId === itemId);
  const personName = (uid) => people.find((person) => person.uid === uid)?.nombre || "Usuario no disponible";
  const currentPrice = (record, item) => frozen ? record.precioUnitario : item?.precioEfectivo;

  const startService = (record = null) => {
    setEditingService(record?.servicioOtId || "new");
    setServiceDraft({itemId: record?.itemId || "", responsableUid: record?.responsableUid || ""});
    setServiceRequestId(createWorkOrderRequestId());
    setError(""); setNotice("");
  };

  const saveService = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!serviceDraft.itemId || !serviceDraft.responsableUid) {
      setError("Selecciona un Servicio Core y un responsable."); return;
    }
    setBusy(true); setError("");
    try {
      if (editingService === "new") {
        await crearServicioOT(businessId, otId, serviceDraft, serviceRequestId);
      } else {
        const record = services.find((service) => service.servicioOtId === editingService);
        await actualizarServicioOT(businessId, otId, editingService, serviceDraft, record?.actualizadoEn?.toMillis?.());
      }
      await onChanged();
      setEditingService(null);
      setNotice("Servicio guardado correctamente.");
    } catch (saveError) { setError(getWorkOrderErrorMessage(saveError)); }
    finally { setBusy(false); }
  };

  const startProduct = (serviceId) => {
    setProductServiceId(serviceId);
    setProductDraft({itemId: "", cantidad: "1"});
    setProductRequestId(createWorkOrderRequestId());
    setError(""); setNotice("");
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    if (busy) return;
    const quantity = Number(productDraft.cantidad);
    if (!productDraft.itemId || !Number.isInteger(quantity) || quantity <= 0) {
      setError("Selecciona un Producto Core e ingresa una cantidad entera positiva."); return;
    }
    setBusy(true); setError("");
    try {
      await agregarProductoOT(businessId, otId, productServiceId, productDraft.itemId, quantity, productRequestId);
      await onChanged();
      setProductServiceId(null);
      setNotice("Producto agregado a la planificación. El stock no se modificó.");
    } catch (saveError) { setError(getWorkOrderErrorMessage(saveError)); }
    finally { setBusy(false); }
  };

  const saveQuantity = async (service) => {
    if (busy || !quantityEdit) return;
    const quantity = Number(quantityEdit.cantidad);
    if (!Number.isInteger(quantity) || quantity <= 0) { setError("Ingresa una cantidad entera positiva."); return; }
    setBusy(true); setError("");
    try {
      await actualizarProductoOT(businessId, otId, service.servicioOtId, quantityEdit.productoOtId,
        quantity, service.actualizadoEn?.toMillis?.());
      await onChanged();
      setQuantityEdit(null);
      setNotice("Cantidad planificada actualizada. El stock no se modificó.");
    } catch (saveError) { setError(getWorkOrderErrorMessage(saveError)); }
    finally { setBusy(false); }
  };

  const removeProduct = async () => {
    if (busy || !removeTarget) return;
    const service = services.find((item) => item.servicioOtId === removeTarget.servicioOtId);
    setBusy(true); setError("");
    try {
      await eliminarProductoOT(businessId, otId, removeTarget.servicioOtId,
        removeTarget.productoOtId, service?.actualizadoEn?.toMillis?.());
      await onChanged();
      setRemoveTarget(null);
      setNotice("Producto quitado de la planificación. El stock no se modificó.");
    } catch (removeError) { setRemoveTarget(null); setError(getWorkOrderErrorMessage(removeError)); }
    finally { setBusy(false); }
  };

  const removeService = async () => {
    if (busy || !removeServiceTarget) return;
    setBusy(true); setError("");
    try {
      await eliminarServicioOT(businessId, otId, removeServiceTarget.servicioOtId,
        removeServiceTarget.actualizadoEn?.toMillis?.());
      await onChanged();
      setRemoveServiceTarget(null);
      setNotice("Servicio eliminado del alcance.");
    } catch (removeError) {
      setRemoveServiceTarget(null);
      setError(getWorkOrderErrorMessage(removeError));
    } finally { setBusy(false); }
  };

  const confirmExecution = async () => {
    if (busy || !executionTarget) return;
    const {action, serviceId, revision, requestId} = executionTarget;
    setBusy(true); setError("");
    try {
      if (action === "iniciar") await iniciarServicioOT(businessId, otId, serviceId, revision, requestId);
      else await completarServicioOT(businessId, otId, serviceId, revision, requestId);
      await onChanged();
      setExecutionTarget(null);
      setNotice(action === "iniciar" ? "Servicio iniciado." : "Servicio completado.");
    } catch (executionError) {
      setError(getWorkOrderErrorMessage(executionError));
      if (String(executionError?.code || "").includes("aborted")) {
        setExecutionTarget(null);
        try { await onChanged(); }
        catch (refreshError) { setError(getWorkOrderErrorMessage(refreshError)); }
      }
    } finally { setBusy(false); }
  };

  const prepareExecution = (service, action) => {
    setError(""); setNotice("");
    setExecutionTarget({action, serviceId: service.servicioOtId,
      revision: service.actualizadoEn?.toMillis?.(), requestId: createWorkOrderRequestId()});
  };

  return <section className="erp-panel" aria-labelledby="work-order-services-title">
    <div className="erp-panel-header"><div>
      <h2 id="work-order-services-title" className="erp-panel-title">Servicios y repuestos</h2>
      <p className="erp-secondary-text">Planifica el alcance con ítems de Inventario. La cantidad planificada no representa consumo.</p>
    </div><div className="erp-module-actions">
      {canOperate && editingService === null && <Button type="button" icon={Plus} onClick={() => startService()}>Agregar servicio</Button>}
      {onFinalizeWorkOrder && <Button type="button" variant="warning" disabled={!canFinalizeWorkOrder} onClick={onFinalizeWorkOrder}>Finalizar orden de trabajo</Button>}
    </div></div>
    {!order.recepcion && <div className="vehicle-message vehicle-message--warning" role="status">Registra la Recepción antes de planificar servicios.</div>}
    {loading && <div className="erp-empty-state" role="status">Cargando catálogo y responsables...</div>}
    {loadError && <div className="vehicle-message vehicle-message--error" role="alert">{loadError}</div>}
    {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    {notice && <div className="vehicle-message" role="status">{notice}</div>}

    {editingService !== null && <form className="vehicle-form work-order-diagnosis-form" onSubmit={saveService} noValidate>
      <h3>{editingService === "new" ? "Agregar Servicio Core" : "Editar servicio"}</h3>
      <div className="work-order-reception-grid">
        <label className="erp-field"><span className="erp-field__label">Servicio Core *</span>
          <select className="erp-control" value={serviceDraft.itemId} disabled={busy || loading} onChange={(event) => setServiceDraft((current) => ({...current, itemId: event.target.value}))}>
            <option value="">Selecciona un servicio</option>
            {serviceOptions.map((item) => <option key={item.itemId} value={item.itemId}>{item.codigoInterno ? `${item.codigoInterno} · ` : ""}{item.nombre}</option>)}
          </select>
        </label>
        <label className="erp-field"><span className="erp-field__label">Responsable *</span>
          <select className="erp-control" value={serviceDraft.responsableUid} disabled={busy || loading} onChange={(event) => setServiceDraft((current) => ({...current, responsableUid: event.target.value}))}>
            <option value="">Selecciona un responsable</option>
            {people.map((person) => <option key={person.uid} value={person.uid}>{person.nombre}</option>)}
          </select>
        </label>
      </div>
      {!serviceOptions.length && !loading && <p className="erp-secondary-text">No hay servicios activos en Inventario Core.</p>}
      <p className="erp-secondary-text">Valor Servicio: {priceLabel(itemById(serviceDraft.itemId)?.precioEfectivo, order.moneda)}</p>
      <div className="vehicle-form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setEditingService(null)}>Cancelar</Button><Button type="submit" icon={Save} disabled={busy || loading || Boolean(loadError)}>{busy ? "Guardando..." : "Guardar servicio"}</Button></div>
    </form>}

    {!services.length && !loading && <div className="erp-empty-state" role="status">Aún no hay servicios planificados para esta OT.</div>}
    <div className="work-order-diagnoses-list">
      {services.map((service) => {
        const item = itemById(service.itemId);
        const products = Array.isArray(service.productos) ? service.productos : [];
        const materialsData = materials?.servicios.find((entry) => entry.servicioOtId === service.servicioOtId);
        const canEditServicePlanning = canOperate && service.estado === "pendiente" && editingService === null;
        return <article className="erp-record-card" key={service.servicioOtId}>
          <header className="erp-record-card__header"><div><h3 className="erp-record-card__title">{(frozen ? service.servicioSnapshot?.nombre : item?.nombre) || "Servicio Core no disponible"}</h3><p className="erp-record-card__subtitle">Responsable: {personName(service.responsableUid)} · Valor: {priceLabel(currentPrice(service, item), order.moneda)}</p></div><StatusBadge variant={service.estado === "completado" ? "success" : service.estado === "en_progreso" ? "warning" : "neutral"}>{SERVICE_LABELS[service.estado] || service.estado}</StatusBadge></header>
          {canEditServicePlanning && <div className="vehicle-form-actions"><Button type="button" variant="secondary" onClick={() => startService(service)}>Editar servicio</Button><Button type="button" icon={Plus} onClick={() => startProduct(service.servicioOtId)}>Agregar producto</Button><Button type="button" variant="secondary" onClick={() => setRemoveServiceTarget(service)}>Eliminar servicio</Button></div>}
          {canExecute && editingService === null && productServiceId === null && <div className="vehicle-form-actions">
            {service.estado === "pendiente" && <Button type="button" disabled={busy} onClick={() => prepareExecution(service, "iniciar")}>Iniciar servicio</Button>}
            {service.estado === "en_progreso" && <Button type="button" disabled={busy} onClick={() => prepareExecution(service, "completar")}>Completar servicio</Button>}
          </div>}
          {productServiceId === service.servicioOtId && <form className="vehicle-form work-order-diagnosis-form" onSubmit={saveProduct} noValidate>
            <h4>Producto Core planificado</h4><div className="work-order-reception-grid">
              <label className="erp-field"><span className="erp-field__label">Producto *</span><select className="erp-control" value={productDraft.itemId} disabled={busy || loading} onChange={(event) => setProductDraft((current) => ({...current, itemId: event.target.value}))}><option value="">Selecciona un producto</option>{productOptions.map((product) => <option key={product.itemId} value={product.itemId}>{product.codigoInterno ? `${product.codigoInterno} · ` : ""}{product.nombre} · Stock: {product.stock}</option>)}</select></label>
              <label className="erp-field"><span className="erp-field__label">Cantidad *</span><input className="erp-control" type="number" min="1" step="1" value={productDraft.cantidad} disabled={busy} onChange={(event) => setProductDraft((current) => ({...current, cantidad: event.target.value}))} /></label>
            </div><p className="erp-secondary-text">Stock actual Core: {itemById(productDraft.itemId)?.stock ?? "—"} · Precio Core vigente: {priceLabel(itemById(productDraft.itemId)?.precioEfectivo, order.moneda)}</p>
            <div className="vehicle-form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setProductServiceId(null)}>Cancelar</Button><Button type="submit" icon={Save} disabled={busy || loading || Boolean(loadError)}>{busy ? "Guardando..." : "Agregar a planificación"}</Button></div>
          </form>}
          <ServiceMaterialsPanel businessId={businessId} otId={otId}
            data={materialsData} products={products}
            canViewCosts={materials?.puedeVerCostos === true} loading={materialsLoading} error={materialsError}
            canEditPlanning={canEditServicePlanning} quantityEdit={quantityEdit?.servicioOtId === service.servicioOtId ? quantityEdit : null} busy={busy}
            getProductName={(product) => {const core = itemById(product.itemId); return (frozen ? product.productoSnapshot?.nombre : core?.nombre) || "Producto Core no disponible";}}
            getProductPrice={(product) => priceLabel(currentPrice(product, itemById(product.itemId)), order.moneda)}
            onQuantityChange={(cantidad) => setQuantityEdit((current) => ({...current, cantidad}))}
            onSaveQuantity={() => saveQuantity(service)} onCancelQuantity={() => setQuantityEdit(null)}
            onStartQuantityEdit={(product) => {setQuantityEdit({servicioOtId: service.servicioOtId, productoOtId: product.productoOtId, cantidad: String(product.cantidad)}); setError("");}}
            onRemoveProduct={(product) => setRemoveTarget({servicioOtId: service.servicioOtId, productoOtId: product.productoOtId})}
            onReload={() => {void refreshMaterials();}}
            onChanged={async () => {
              const [refreshed] = await Promise.all([refreshMaterials(), onChanged()]);
              if (!refreshed) throw new Error("No se pudo recargar el historial de movimientos.");
            }} />
        </article>;
      })}
    </div>
    <ResponsiveDialog open={Boolean(removeTarget)} onClose={() => !busy && setRemoveTarget(null)} size="small" eyebrow="Taller" title="Eliminar producto planificado" description="Se quitará de este ServicioOT. El stock de Inventario Core no cambiará." footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setRemoveTarget(null)}>Volver</Button><Button type="button" disabled={busy} onClick={removeProduct}>{busy ? "Eliminando..." : "Eliminar producto"}</Button></>}><p>¿Confirmas que deseas quitar este producto de la planificación?</p></ResponsiveDialog>
    <ResponsiveDialog open={Boolean(removeServiceTarget)} onClose={() => !busy && setRemoveServiceTarget(null)} size="small" eyebrow="Taller" title="Eliminar servicio" description="Se quitarán el servicio y sus productos planificados del alcance de la OT." footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setRemoveServiceTarget(null)}>Volver</Button><Button type="button" disabled={busy} onClick={removeService}>{busy ? "Eliminando..." : "Eliminar servicio"}</Button></>}><p>Solo es posible eliminar servicios pendientes y sin movimientos de inventario. Si la OT estaba aprobada, deberá enviarse nuevamente a aprobación.</p></ResponsiveDialog>
    <ResponsiveDialog open={Boolean(executionTarget)} onClose={() => !busy && setExecutionTarget(null)} size="small" eyebrow="Taller"
      title={executionTarget?.action === "iniciar" ? "Iniciar servicio" : "Completar servicio"}
      description="Se registrará la transición y su autoría en el historial de la OT."
      footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setExecutionTarget(null)}>Cancelar</Button>
        <Button type="button" disabled={busy} onClick={confirmExecution}>{busy ? "Procesando..." : "Confirmar"}</Button></>}>
      <p>¿Confirmas esta acción sobre el servicio?</p>
      {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    </ResponsiveDialog>
  </section>;
}
