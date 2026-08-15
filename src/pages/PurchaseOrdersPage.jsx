import React, {useEffect, useMemo, useRef, useState} from "react";
import {Plus, Search} from "lucide-react";
import {useNavigate} from "react-router-dom";
import {sileo} from "sileo";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {canManagePurchaseOrders, getSupplierResponseState, matchesPurchaseOrderSearch} from "../domain/purchaseOrderModel.mjs";
import {getOrderReceptionProgress, getOrderReceptionStatus, getOrderReceptionStatusLabel} from "../domain/receptionModel.mjs";
import SendPurchaseOrderEmailDialog from "../features/purchaseOrders/SendPurchaseOrderEmailDialog";
import {getCompanyProfile} from "../services/companyService";
import {cancelarOrdenCompra, createPurchaseOrderDuplicateRequestId, duplicarOrdenCompraComoBorrador, listarOrdenesCompra} from "../services/purchaseOrderService";
import {sendPurchaseOrderEmail} from "../services/purchaseOrderEmailService";
import {crearRecepcionDesdeOrden, createReceptionRequestId, listarRecepciones} from "../services/receptionService";
import {buildPurchaseOrderPdfAttachment} from "../utils/purchaseOrderPdf";
import "../features/receptions/receptions.css";

const labels = {borrador: "Pendiente de envío", emitida: "Emitida", cancelada: "Cancelada"};
const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;
const responseLabel = (order) => ({pendiente: "Sin respuesta", confirmada: "Confirmada por proveedor", rechazada: "Rechazada por proveedor"})[getSupplierResponseState(order)];

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

function OrderActions({canManage, onCancel, onContinue, onDuplicate, onOpen, onSend, order, processing, receptionStatus}) {
  return <div className="po-history__actions po-history__actions--purchase-orders">
    {order.estado === "borrador" && canManage
      ? <button type="button" className="po-history__primary" disabled={processing} onClick={() => onSend(order)}>Enviar</button>
      : order.estado === "emitida" && canManage
        ? <button type="button" className="po-history__primary" disabled={processing} onClick={() => onContinue(order)}>{getSupplierResponseState(order) === "rechazada" ? "Corregir respuesta" : receptionStatus === "recibida_total" ? "Ver" : "Registrar recepción"}</button>
        : <button type="button" className="po-history__primary" onClick={() => onOpen(order)}>Ver</button>}
    {order.estado === "borrador" && canManage && <button type="button" onClick={() => onOpen(order)}>Editar</button>}
    {canManage && <details className="po-more-actions"><summary>Más acciones ···</summary><div>{order.estado !== "borrador" && <button type="button" onClick={() => onOpen(order)}>Ver orden</button>}{order.estado !== "cancelada" && <button type="button" onClick={() => onCancel(order)}>Cancelar</button>}{order.estado !== "borrador" && <button type="button" onClick={() => onDuplicate(order)}>Duplicar como pendiente</button>}</div></details>}
  </div>;
}

export default function PurchaseOrdersPage({businessId, role}) {
  const navigate = useNavigate();
  const duplicateIds = useRef(new Map()); const receptionIds = useRef(new Map());
  const [orders, setOrders] = useState([]); const [receptions, setReceptions] = useState([]); const [company, setCompany] = useState({});
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("todos"); const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true); const [processingId, setProcessingId] = useState(""); const [pendingAction, setPendingAction] = useState(null); const [emailOrder, setEmailOrder] = useState(null);
  const canManage = canManagePurchaseOrders(role);
  const load = async () => {
    setLoading(true);
    try { const [orderList, receptionList, profile] = await Promise.all([listarOrdenesCompra(businessId), listarRecepciones(businessId), getCompanyProfile(businessId).catch(() => ({}))]); setOrders(orderList); setReceptions(receptionList); setCompany(profile); }
    catch (error) { setMessage(error.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [businessId]);
  const filtered = useMemo(() => orders.filter((order) => (status === "todos" || order.estado === status) && matchesPurchaseOrderSearch(order, search)), [orders, search, status]);
  const open = (order) => navigate(order.estado === "borrador" && canManage ? `/ordenes-compra/${order.id}/editar` : `/ordenes-compra/${order.id}`);
  const continueOrder = async (order) => {
    if (getSupplierResponseState(order) === "rechazada") { open(order); return; }
    if (getOrderReceptionStatus(order, receptions) === "recibida_total") { navigate("/recepciones"); return; }
    const requestId = receptionIds.current.get(order.id) || createReceptionRequestId("reception-create"); receptionIds.current.set(order.id, requestId); setProcessingId(order.id);
    try { const result = await crearRecepcionDesdeOrden(businessId, order.id, {requestId}); receptionIds.current.delete(order.id); navigate(`/recepciones/${result.recepcion.id}/editar`); }
    catch (error) { setMessage(error.message); } finally { setProcessingId(""); }
  };
  const duplicate = async (order) => {
    const requestId = duplicateIds.current.get(order.id) || createPurchaseOrderDuplicateRequestId(); duplicateIds.current.set(order.id, requestId); setProcessingId(order.id);
    try { const result = await duplicarOrdenCompraComoBorrador(businessId, order.id, {requestId}); duplicateIds.current.delete(order.id); navigate(`/ordenes-compra/${result.ordenCompra.id}/editar`, {state: {message: "Copia creada como orden pendiente."}}); }
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
  return <main className="erp-page po-history">
    <div className="erp-module-intro"><div className="erp-page-intro"><p>Administra órdenes, respuesta del proveedor y avance de recepción.</p></div>{canManage && <Button type="button" icon={Plus} onClick={() => navigate("/ordenes-compra/nueva")}>Crear orden de compra</Button>}</div>
    {message && <p className="po-message po-message--error">{message}</p>}
    <section className="erp-panel erp-history-panel"><div className="erp-panel-header"><div><h2 className="erp-panel-title">Órdenes registradas</h2><p className="erp-secondary-text">{filtered.length} órdenes</p></div></div>
      <div className="erp-filters erp-history-filters erp-history-filters--two po-history__toolbar"><label className="erp-field erp-history-search-field"><span className="erp-field__label">Buscar por número, proveedor o RUT</span><span className="clients-search-control"><AppIcon icon={Search} size={18} /><input className="erp-control" value={search} onChange={(event) => setSearch(event.target.value)} /></span></label><label className="erp-field"><span className="erp-field__label">Estado</span><select className="erp-control" value={status} onChange={(event) => setStatus(event.target.value)}><option value="todos">Todos</option><option value="borrador">Pendientes de envío</option><option value="emitida">Emitidas</option><option value="cancelada">Canceladas</option></select></label></div>
      {loading ? <div className="erp-empty-state">Cargando órdenes...</div> : <><section className="erp-table-region po-history__desktop"><table className="erp-table po-history__table"><thead><tr><th>Orden</th><th>Proveedor</th><th>Total</th><th>Estado OC</th><th>Respuesta proveedor</th><th>Recepción</th><th>Acciones</th></tr></thead><tbody>{filtered.map((order) => { const receptionStatus = getOrderReceptionStatus(order, receptions); const progress = getOrderReceptionProgressDisplay(order, receptions); return <tr key={order.id}><td><button type="button" className="po-inline-link" onClick={() => open(order)}>{order.numero}</button></td><td><strong>{order.proveedorSnapshot?.razonSocial}</strong><small>{order.proveedorSnapshot?.rut}</small></td><td>{money(order.total)}</td><td><span className={`po-status po-status--${order.estado}`}>{labels[order.estado]}</span></td><td>{responseLabel(order)}</td><td><span className={`po-status po-status--${receptionStatus}`}>{getOrderReceptionStatusLabel(receptionStatus)}</span><small>{progress.received} / {progress.requested}</small></td><td><OrderActions canManage={canManage} onCancel={setPendingAction} onContinue={continueOrder} onDuplicate={duplicate} onOpen={open} onSend={setEmailOrder} order={order} processing={processingId === order.id} receptionStatus={receptionStatus} /></td></tr>; })}{!filtered.length && <tr><td colSpan="7" className="po-history__empty">No hay órdenes coincidentes.</td></tr>}</tbody></table></section><section className="po-history__cards" aria-label="Órdenes de compra">{filtered.map((order) => { const receptionStatus = getOrderReceptionStatus(order, receptions); const progress = getOrderReceptionProgressDisplay(order, receptions); return <article className="po-history-card" key={order.id}><header><button type="button" className="po-inline-link" onClick={() => open(order)}>{order.numero}</button><span className={`po-status po-status--${order.estado}`}>{labels[order.estado]}</span></header><div className="po-history-card__provider"><strong>{order.proveedorSnapshot?.razonSocial}</strong><span>{money(order.total)}</span></div><dl><div><dt>Respuesta</dt><dd>{responseLabel(order)}</dd></div><div><dt>Recepción</dt><dd>{getOrderReceptionStatusLabel(receptionStatus)} · {progress.received} / {progress.requested}</dd></div></dl><OrderActions canManage={canManage} onCancel={setPendingAction} onContinue={continueOrder} onDuplicate={duplicate} onOpen={open} onSend={setEmailOrder} order={order} processing={processingId === order.id} receptionStatus={receptionStatus} /></article>; })}</section></>}
    </section>
    <SendPurchaseOrderEmailDialog open={Boolean(emailOrder)} onClose={() => setEmailOrder(null)} onSend={sendEmail} order={emailOrder} processing={Boolean(processingId)} />
    <ResponsiveDialog open={Boolean(pendingAction)} onClose={() => !processingId && setPendingAction(null)} eyebrow="Más acciones" title="Cancelar orden de compra" description="La orden quedará cancelada. Las recepciones ya confirmadas conservan su trazabilidad." size="small" footer={<><Button type="button" variant="secondary" disabled={Boolean(processingId)} onClick={() => setPendingAction(null)}>Volver</Button><Button type="button" variant="danger" disabled={Boolean(processingId)} onClick={cancel}>{processingId ? "Cancelando..." : "Cancelar orden"}</Button></>}><p>La cancelación no revierte inventario.</p></ResponsiveDialog>
  </main>;
}
