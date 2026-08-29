import React, {useEffect, useMemo, useRef, useState} from "react";
import {Plus, Search} from "lucide-react";
import {useLocation, useNavigate} from "react-router-dom";
import {sileo} from "sileo";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {canManagePurchaseOrders, getSupplierResponseLabel, getSupplierResponseState, matchesPurchaseOrderSearch} from "../domain/purchaseOrderModel.mjs";
import {getOrderReceptionProgress, getOrderReceptionStatus, getOrderReceptionStatusLabel} from "../domain/receptionModel.mjs";
import PurchaseOrderPrintView from "../features/purchaseOrders/PurchaseOrderPrintView";
import SendPurchaseOrderEmailDialog from "../features/purchaseOrders/SendPurchaseOrderEmailDialog";
import {getCompanyProfile} from "../services/companyService";
import {cancelarOrdenCompra, emitirOrdenCompra, listarOrdenesCompra} from "../services/purchaseOrderService";
import {sendPurchaseOrderEmail} from "../services/purchaseOrderEmailService";
import {crearRecepcionDesdeOrden, createReceptionRequestId, listarRecepciones} from "../services/receptionService";
import {buildPurchaseOrderPdfAttachment, downloadPurchaseOrderPdf, getPurchaseOrderWhatsAppAvailability, sharePurchaseOrderWhatsApp} from "../utils/purchaseOrderPdf";
import "../features/receptions/receptions.css";

const labels = {borrador: "Pendiente de envío", emitida: "Emitida", cancelada: "Cancelada"};
const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;
const responseLabel = (order) => getSupplierResponseLabel(order);

class PurchaseOrderPreviewBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {failed: false};
  }

  static getDerivedStateFromError() {
    return {failed: true};
  }

  componentDidCatch(error) {
    console.error("No se pudo renderizar la vista previa de la orden de compra:", error);
  }

  render() {
    if (this.state.failed) return <p className="po-message po-message--error" role="alert">La orden fue creada, pero no pudimos mostrar su vista previa. Puedes volver al listado y abrirla nuevamente.</p>;
    return this.props.children;
  }
}

const quantityLabel = (value) => Number(value || 0).toLocaleString("es-CL", {
  maximumFractionDigits: 6,
});

function normalizedUnit(value) {
  return String(value || "unidad").trim().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function unitLabel(value, total) {
  const unit = String(value || "unidad").trim();
  if (Number(total) === 1) return unit;
  return ({unidad: "unidades", hora: "horas", proyecto: "proyectos"})[normalizedUnit(unit)] || unit;
}

function getOrderReceptionProgressDisplay(order, receptions) {
  const lines = Array.isArray(order.items) ? order.items : [];
  const units = new Set(lines.map((line) => normalizedUnit(line.unidad)));
  if (units.size <= 1) {
    const progress = getOrderReceptionProgress(order, receptions);
    return {
      received: quantityLabel(progress.received),
      requested: `${quantityLabel(progress.requested)} ${unitLabel(lines[0]?.unidad, progress.requested)}`,
    };
  }
  const receivedByLine = new Map();
  receptions.filter((entry) =>
    entry.ordenCompraId === (order.id || order.ordenCompraId) && entry.estado === "confirmada"
  ).forEach((entry) => entry.items.forEach((line) => {
    receivedByLine.set(
      line.ordenLineaId,
      (receivedByLine.get(line.ordenLineaId) || 0) + Number(line.cantidad || 0)
    );
  }));
  const complete = lines.filter((line) =>
    (receivedByLine.get(line.lineaId) || 0) >= Number(line.cantidad || 0) - 0.000001
  ).length;
  return {
    received: complete,
    requested: `${lines.length} ${lines.length === 1 ? "línea completa" : "líneas completas"}`,
  };
}

function OrderActions({canManage, hasDraftReception, onCancel, onContinue, onEdit, onSend, order, processing, receptionStatus}) {
  return <div className="po-history__actions po-history__actions--purchase-orders">
    {order.estado === "borrador" && canManage
      ? <button type="button" className="po-history__primary" disabled={processing} onClick={() => onSend(order)}>Enviar</button>
      : order.estado === "emitida" && canManage
        ? receptionStatus === "recibida_total"
          ? <span className="po-reception-complete">Recepción completada</span>
          : getSupplierResponseState(order) === "rechazada"
            ? <button type="button" className="po-history__primary" disabled={processing} onClick={() => onContinue(order)}>Actualizar confirmación</button>
            : <button type="button" className="po-history__primary" disabled={processing} onClick={() => onContinue(order)}>{receptionStatus === "recibida_parcial" || hasDraftReception ? "Continuar recepción" : "Registrar recepción"}</button>
        : null}
    {canManage && order.estado !== "cancelada" && receptionStatus !== "recibida_total" && <button type="button" className="po-history__danger" disabled={processing} onClick={() => onCancel(order)}>Cancelar</button>}
    {order.estado === "borrador" && canManage && <button type="button" disabled={processing} onClick={() => onEdit(order)}>Editar</button>}
  </div>;
}

export default function PurchaseOrdersPage({businessId, role}) {
  const location = useLocation();
  const navigate = useNavigate();
  const initialCreatedOrder = location.state?.createdOrder?.negocioId === businessId ? location.state.createdOrder : null;
  const requestedOrderIdRef = useRef(String(location.state?.openOrderId || "").trim());
  const initialPreviewRef = useRef(Boolean(initialCreatedOrder));
  const locationStateConsumedRef = useRef(false);
  const receptionIds = useRef(new Map());
  const [orders, setOrders] = useState([]); const [receptions, setReceptions] = useState([]); const [company, setCompany] = useState({});
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("todos"); const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true); const [processingId, setProcessingId] = useState(""); const [pendingAction, setPendingAction] = useState(null); const [emailOrder, setEmailOrder] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(initialCreatedOrder); const [recentOrderId, setRecentOrderId] = useState(initialCreatedOrder?.id || ""); const [whatsAppOrder, setWhatsAppOrder] = useState(null); const [whatsAppDestination, setWhatsAppDestination] = useState("");
  const canManage = canManagePurchaseOrders(role);
  const load = async () => {
    setLoading(true);
    try { const [orderList, receptionList, profile] = await Promise.all([listarOrdenesCompra(businessId), listarRecepciones(businessId), getCompanyProfile(businessId).catch(() => ({}))]); setOrders(orderList); setReceptions(receptionList); setCompany(profile); }
    catch (error) { setMessage(error.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [businessId]);
  useEffect(() => {
    setSelectedOrder((current) => current?.negocioId === businessId ? current : null);
    setEmailOrder((current) => current?.negocioId === businessId ? current : null);
    setWhatsAppOrder((current) => current?.negocioId === businessId ? current : null);
  }, [businessId]);
  useEffect(() => {
    if (locationStateConsumedRef.current || !requestedOrderIdRef.current) return;
    locationStateConsumedRef.current = true;
    if (location.state?.createdOrderNumber) sileo.success({title: "Orden de compra creada", description: `${location.state.createdOrderNumber} quedó guardada y pendiente de envío.`});
    navigate(location.pathname, {replace: true, state: {}});
  }, [location.pathname, location.state?.createdOrderNumber, navigate]);
  useEffect(() => {
    const requestedOrderId = requestedOrderIdRef.current;
    if (!requestedOrderId || loading) return;
    requestedOrderIdRef.current = "";
    const requestedOrder = orders.find((order) => order.id === requestedOrderId);
    setRecentOrderId(requestedOrderId);
    if (requestedOrder) {
      setSelectedOrder((current) => {
        if (!initialPreviewRef.current) return requestedOrder;
        return current?.id === requestedOrderId ? requestedOrder : current;
      });
    } else {
      setMessage("La orden fue creada, pero no pudimos cargarla en el listado. Intenta recargar el panel.");
    }
  }, [loading, orders]);
  const filtered = useMemo(() => orders.filter((order) => (status === "todos" || order.estado === status) && matchesPurchaseOrderSearch(order, search)), [orders, search, status]);
  const open = (order) => setSelectedOrder(order);
  const openWorkspace = (order) => navigate(order.estado === "borrador" && canManage ? `/ordenes-compra/${order.id}/editar` : `/ordenes-compra/${order.id}`);
  const continueOrder = async (order) => {
    if (getSupplierResponseState(order) === "rechazada") { openWorkspace(order); return; }
    if (getOrderReceptionStatus(order, receptions) === "recibida_total") return;
    const draftReception = receptions.find((entry) => entry.ordenCompraId === order.id && entry.estado === "borrador");
    if (draftReception) { navigate(`/recepciones/${draftReception.id}/editar`); return; }
    const requestId = receptionIds.current.get(order.id) || createReceptionRequestId("reception-create"); receptionIds.current.set(order.id, requestId); setProcessingId(order.id);
    try { const result = await crearRecepcionDesdeOrden(businessId, order.id, {requestId}); receptionIds.current.delete(order.id); navigate(`/recepciones/${result.recepcion.id}/editar`); }
    catch (error) { setMessage(error.message); } finally { setProcessingId(""); }
  };
  const cancel = async () => {
    if (!pendingAction) return; setProcessingId(pendingAction.id);
    try { await cancelarOrdenCompra(businessId, pendingAction.id); setPendingAction(null); await load(); }
    catch (error) { setMessage(error.message); } finally { setProcessingId(""); }
  };
  const sendEmail = async (emailProveedor) => {
    const order = emailOrder; if (!order) return; setProcessingId(order.id);
    try { const pdfAttachment = await buildPurchaseOrderPdfAttachment({order, companyProfile: company}); const result = await sendPurchaseOrderEmail({businessId, ordenCompraId: order.id, emailProveedor, pdfAttachment}); if (!result.success) throw new Error(result.error || "No fue posible enviar la orden."); setEmailOrder(null); await load(); if (result.simulated) sileo.info({title: "Simulación de correo — QA local", description: "No se envió un correo real. La orden permanece pendiente de envío."}); else sileo.success({title: "Correo enviado", description: `${order.numero} fue enviada a ${emailProveedor}.`}); }
    catch (error) { setMessage(error.message); } finally { setProcessingId(""); }
  };
  const downloadPdf = async (order) => {
    if (!order) return; setProcessingId(order.id); setMessage("");
    try { await downloadPurchaseOrderPdf({order, companyProfile: company}); sileo.success({title: "PDF descargado", description: `${order.numero} quedó disponible en tus descargas.`}); }
    catch (error) { setMessage(error.message); sileo.error({title: "No se pudo generar el PDF", description: error.message}); }
    finally { setProcessingId(""); }
  };
  const shareWhatsApp = async (order) => {
    if (!order) return; setProcessingId(order.id); setMessage("");
    try {
      const result = await sharePurchaseOrderWhatsApp({order, companyProfile: company});
      if (result.externalFlowOpened) { setWhatsAppDestination(result.destination || ""); setWhatsAppOrder(order); }
    } catch (error) {
      if (error?.name !== "AbortError") { setMessage(error.message); sileo.error({title: "No se pudo preparar WhatsApp", description: error.message}); }
    } finally { setProcessingId(""); }
  };
  const confirmWhatsApp = async () => {
    if (!whatsAppOrder) return; setProcessingId(whatsAppOrder.id); setMessage("");
    try {
      const emitted = (await emitirOrdenCompra(businessId, whatsAppOrder.id, {canalEmision: "whatsapp", destinatario: whatsAppDestination})).ordenCompra;
      setOrders((current) => current.map((order) => order.id === emitted.id ? emitted : order));
      setSelectedOrder((current) => current?.id === emitted.id ? emitted : current);
      setWhatsAppOrder(null); setWhatsAppDestination("");
      sileo.success({title: "Orden de compra emitida", description: `${emitted.numero} fue registrada como enviada por WhatsApp.`});
    } catch (error) { setMessage(error.message); sileo.error({title: "No se pudo registrar el envío", description: error.message}); }
    finally { setProcessingId(""); }
  };
  const selectedWhatsAppAvailability = getPurchaseOrderWhatsAppAvailability(selectedOrder);
  const hasConfirmedReceptions = Boolean(pendingAction && receptions.some((entry) =>
    entry.ordenCompraId === (pendingAction.id || pendingAction.ordenCompraId) && entry.estado === "confirmada"
  ));
  const cancellationDescription = pendingAction?.estado === "borrador"
    ? "La orden quedará cancelada y dejará de estar disponible para envío."
    : hasConfirmedReceptions
      ? "Al cancelar, esta orden dejará de estar disponible para nuevas recepciones. Las recepciones ya confirmadas conservarán su trazabilidad y no se revertirán automáticamente."
      : "Al cancelar, esta orden dejará de estar disponible para nuevas recepciones.";

  return <main className="erp-page po-history">
    <div className="erp-module-intro"><div className="erp-page-intro"><p>Administra órdenes, confirmación del proveedor y avance de recepción.</p></div>{canManage && <Button type="button" icon={Plus} onClick={() => navigate("/ordenes-compra/nueva")}>Crear orden de compra</Button>}</div>
    {message && <p className="po-message po-message--error">{message}</p>}
    <section className="erp-panel erp-history-panel"><div className="erp-panel-header"><div><h2 className="erp-panel-title">Órdenes registradas</h2><p className="erp-secondary-text">{filtered.length} órdenes</p></div></div>
      <div className="erp-filters erp-history-filters erp-history-filters--two po-history__toolbar"><label className="erp-field erp-history-search-field"><span className="erp-field__label">Buscar por número, proveedor o RUT</span><span className="clients-search-control"><AppIcon icon={Search} size={18} /><input className="erp-control" value={search} onChange={(event) => setSearch(event.target.value)} /></span></label><label className="erp-field"><span className="erp-field__label">Estado</span><select className="erp-control" value={status} onChange={(event) => setStatus(event.target.value)}><option value="todos">Todos</option><option value="borrador">Pendientes de envío</option><option value="emitida">Emitidas</option><option value="cancelada">Canceladas</option></select></label></div>
      {loading ? <div className="erp-empty-state">Cargando órdenes...</div> : <><section className="erp-table-region po-history__desktop"><table className="erp-table po-history__table"><thead><tr><th>Orden</th><th>Proveedor</th><th>Total</th><th>Estado OC</th><th>Confirmación proveedor</th><th>Recepción</th><th>Acciones</th></tr></thead><tbody>{filtered.map((order) => { const receptionStatus = getOrderReceptionStatus(order, receptions); const progress = getOrderReceptionProgressDisplay(order, receptions); const relatedReceptions = receptions.filter((entry) => entry.ordenCompraId === order.id); const hasDraftReception = relatedReceptions.some((entry) => entry.estado === "borrador"); return <tr className={order.id === recentOrderId ? "po-history__recent" : ""} key={order.id}><td><button type="button" className="po-inline-link" onClick={() => openWorkspace(order)}>{order.numero}</button></td><td><strong>{order.proveedorSnapshot?.razonSocial}</strong><small>{order.proveedorSnapshot?.rut}</small></td><td>{money(order.total)}</td><td><span className={`po-status po-status--${order.estado}`}>{labels[order.estado]}</span></td><td className={receptionStatus === "recibida_total" ? "po-secondary-state" : ""}>{responseLabel(order)}</td><td><span className={`po-status po-status--${receptionStatus}`}>{getOrderReceptionStatusLabel(receptionStatus)}</span><small>{progress.received} / {progress.requested}</small>{relatedReceptions.length > 0 && <span className="po-related-documents">{relatedReceptions.map((entry) => <button type="button" className="po-inline-link" key={entry.id} onClick={() => navigate(entry.estado === "borrador" && canManage ? `/recepciones/${entry.id}/editar` : `/recepciones/${entry.id}`)}>{entry.numero}</button>)}</span>}</td><td><OrderActions canManage={canManage} hasDraftReception={hasDraftReception} onCancel={setPendingAction} onContinue={continueOrder} onEdit={openWorkspace} onSend={setEmailOrder} order={order} processing={processingId === order.id} receptionStatus={receptionStatus} /></td></tr>; })}{!filtered.length && <tr><td colSpan="7" className="po-history__empty">No hay órdenes coincidentes.</td></tr>}</tbody></table></section><section className="po-history__cards" aria-label="Órdenes de compra">{filtered.map((order) => { const receptionStatus = getOrderReceptionStatus(order, receptions); const progress = getOrderReceptionProgressDisplay(order, receptions); const relatedReceptions = receptions.filter((entry) => entry.ordenCompraId === order.id); const hasDraftReception = relatedReceptions.some((entry) => entry.estado === "borrador"); return <article className={`po-history-card ${order.id === recentOrderId ? "po-history__recent" : ""}`} key={order.id}><header><button type="button" className="po-inline-link" onClick={() => openWorkspace(order)}>{order.numero}</button><span className={`po-status po-status--${order.estado}`}>{labels[order.estado]}</span></header><div className="po-history-card__provider"><strong>{order.proveedorSnapshot?.razonSocial}</strong><span>{money(order.total)}</span></div><dl><div><dt>Confirmación</dt><dd className={receptionStatus === "recibida_total" ? "po-secondary-state" : ""}>{responseLabel(order)}</dd></div><div><dt>Recepción</dt><dd>{getOrderReceptionStatusLabel(receptionStatus)} · {progress.received} / {progress.requested}</dd></div>{relatedReceptions.length > 0 && <div><dt>Documentos</dt><dd className="po-related-documents">{relatedReceptions.map((entry) => <button type="button" className="po-inline-link" key={entry.id} onClick={() => navigate(entry.estado === "borrador" && canManage ? `/recepciones/${entry.id}/editar` : `/recepciones/${entry.id}`)}>{entry.numero}</button>)}</dd></div>}</dl><OrderActions canManage={canManage} hasDraftReception={hasDraftReception} onCancel={setPendingAction} onContinue={continueOrder} onEdit={openWorkspace} onSend={setEmailOrder} order={order} processing={processingId === order.id} receptionStatus={receptionStatus} /></article>; })}</section></>}
    </section>
    {selectedOrder && <div className="print-only"><PurchaseOrderPrintView company={company} order={selectedOrder} /></div>}
    <ResponsiveDialog className="po-order-preview-dialog" layerClassName="po-order-preview-layer no-print" open={Boolean(selectedOrder)} onClose={() => setSelectedOrder(null)} eyebrow="Órdenes de compra" title={selectedOrder ? `Orden de compra ${selectedOrder.numero}` : "Vista previa"} description="Revisa el documento guardado y compártelo con el proveedor." size="large" footer={selectedOrder ? <div className="erp-actions po-order-preview-actions">{canManage && selectedOrder.estado !== "cancelada" && !selectedWhatsAppAvailability.enabled && <small className="po-action-help">{selectedWhatsAppAvailability.help}</small>}{canManage && selectedOrder.estado !== "cancelada" && <Button type="button" disabled={processingId === selectedOrder.id} onClick={() => { setEmailOrder(selectedOrder); setSelectedOrder(null); }}>Correo</Button>}{canManage && selectedOrder.estado !== "cancelada" && <Button type="button" variant="secondary" disabled={processingId === selectedOrder.id || !selectedWhatsAppAvailability.enabled} title={selectedWhatsAppAvailability.help} onClick={() => shareWhatsApp(selectedOrder)}>WhatsApp</Button>}<Button type="button" variant="secondary" disabled={processingId === selectedOrder.id} onClick={() => downloadPdf(selectedOrder)}>Descargar PDF</Button><Button type="button" variant="secondary" onClick={() => window.print()}>Imprimir</Button>{canManage && selectedOrder.estado === "borrador" && <Button type="button" variant="secondary" onClick={() => openWorkspace(selectedOrder)}>Editar</Button>}<Button type="button" variant="secondary" onClick={() => setSelectedOrder(null)}>Volver al listado</Button></div> : null}>
      {selectedOrder && <PurchaseOrderPreviewBoundary key={selectedOrder.id}><div className="po-preview-body"><PurchaseOrderPrintView company={company} order={selectedOrder} /></div></PurchaseOrderPreviewBoundary>}
    </ResponsiveDialog>
    <SendPurchaseOrderEmailDialog open={Boolean(emailOrder)} onClose={() => setEmailOrder(null)} onSend={sendEmail} order={emailOrder} processing={Boolean(processingId)} />
    <ResponsiveDialog open={Boolean(whatsAppOrder)} onClose={() => !processingId && setWhatsAppOrder(null)} eyebrow="WhatsApp" title="¿Enviaste la orden de compra?" description="Abrir WhatsApp no confirma que el proveedor haya recibido la orden." size="small" footer={<><Button type="button" variant="secondary" disabled={Boolean(processingId)} onClick={() => setWhatsAppOrder(null)}>Mantener pendiente</Button><Button type="button" disabled={Boolean(processingId)} onClick={confirmWhatsApp}>{processingId ? "Registrando..." : "Sí, fue enviada"}</Button></>}><p>ValoraCloud registrará la emisión por WhatsApp, sin afirmar entrega ni lectura.</p></ResponsiveDialog>
    <ResponsiveDialog open={Boolean(pendingAction)} onClose={() => !processingId && setPendingAction(null)} eyebrow="Acción de orden" title="Cancelar orden de compra" description={cancellationDescription} size="small" footer={<><Button type="button" variant="secondary" disabled={Boolean(processingId)} onClick={() => setPendingAction(null)}>Volver</Button><Button type="button" variant="danger" disabled={Boolean(processingId)} onClick={cancel}>{processingId ? "Cancelando..." : "Cancelar orden"}</Button></>}>{hasConfirmedReceptions ? <p>La cancelación no revierte inventario ni compras ya generadas.</p> : null}</ResponsiveDialog>
  </main>;
}
