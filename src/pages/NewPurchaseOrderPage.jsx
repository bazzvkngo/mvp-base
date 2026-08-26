import React, {useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {sileo} from "sileo";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {
  calculatePurchaseOrderTotals,
  canManagePurchaseOrders,
  getSupplierResponseLabel,
  getSupplierResponseState,
  resolvePurchaseOrderProviderPreview,
} from "../domain/purchaseOrderModel.mjs";
import ProviderSelector from "../features/purchaseOrders/ProviderSelector";
import PurchaseOrderCatalogDialog from "../features/purchaseOrders/PurchaseOrderCatalogDialog";
import PurchaseOrderItemsEditor from "../features/purchaseOrders/PurchaseOrderItemsEditor";
import PurchaseOrderPrintView from "../features/purchaseOrders/PurchaseOrderPrintView";
import PurchaseOrderSummary from "../features/purchaseOrders/PurchaseOrderSummary";
import SendPurchaseOrderEmailDialog from "../features/purchaseOrders/SendPurchaseOrderEmailDialog";
import {auth} from "../firebase/firebaseConfig.js";
import {listarMiembrosNegocio} from "../services/businessMemberService";
import {getCompanyProfile} from "../services/companyService";
import {getInventoryItems} from "../services/inventoryService";
import {listarProveedores} from "../services/providerService";
import {
  actualizarOrdenCompraBorrador,
  cancelarOrdenCompra,
  createPurchaseOrderDuplicateRequestId,
  createPurchaseOrderRequestId,
  crearOrdenCompra,
  duplicarOrdenCompraComoBorrador,
  emitirOrdenCompra,
  obtenerOrdenCompra,
  registrarRespuestaProveedor,
} from "../services/purchaseOrderService";
import {sendPurchaseOrderEmail} from "../services/purchaseOrderEmailService";
import {crearRecepcionDesdeOrden, createReceptionRequestId, listarRecepciones} from "../services/receptionService";
import {
  buildPurchaseOrderPdfAttachment,
  downloadPurchaseOrderPdf,
  sharePurchaseOrderWhatsApp,
} from "../utils/purchaseOrderPdf";
import "../features/purchaseOrders/purchase-orders.css";

const EMPTY_TOTALS = {subtotal: 0, descuentoTotal: 0, neto: 0, iva: 0, total: 0};

function traceDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("es-CL", {dateStyle: "short", timeStyle: "short"})
    : "Fecha no disponible";
}

function documentDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}-${month}-${year}`;
  }
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("es-CL").replaceAll("/", "-")
    : "—";
}

function visibleActor(uid, memberByUid) {
  const member = memberByUid.get(uid);
  if (member?.nombre && member.nombre !== "Sin nombre registrado") return member.nombre;
  if (member?.correo && member.correo !== "Sin correo disponible") return member.correo;
  if (uid && auth.currentUser?.uid === uid) {
    return auth.currentUser.displayName || auth.currentUser.email || "Usuario del negocio";
  }
  return "Usuario del negocio";
}

function lineId() {
  if (globalThis.crypto?.randomUUID) return `linea-${globalThis.crypto.randomUUID()}`;
  return `linea-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyDraft() {
  return {
    proveedorId: "",
    fechaEntregaEstimada: "",
    direccionEntrega: "",
    condicionesPago: "",
    observaciones: "",
    items: [],
  };
}

export default function NewPurchaseOrderPage({businessId, role}) {
  const {ordenCompraId} = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(emptyDraft);
  const [order, setOrder] = useState(null);
  const [providers, setProviders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [company, setCompany] = useState(null);
  const [members, setMembers] = useState([]);
  const [receptions, setReceptions] = useState([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState("");
  const [whatsAppDestination, setWhatsAppDestination] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [message, setMessage] = useState("");
  const [supplierAnswer, setSupplierAnswer] = useState({estado: "confirmada", comentario: ""});
  const requestIdRef = useRef(createPurchaseOrderRequestId());
  const duplicateRequestIdRef = useRef("");
  const conversionRequestIdRef = useRef("");
  const canManage = canManagePurchaseOrders(role);
  const readOnly = !canManage || (order && order.estado !== "borrador");

  useEffect(() => {
    if (location.state?.message) {
      sileo.success({
        title: location.state.message,
        description: order?.numero ? `${order.numero} quedó pendiente de emisión.` : undefined,
      });
      navigate(location.pathname, {replace: true, state: {}});
    }
  }, [location.pathname, location.state?.message, navigate, order?.numero]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      listarProveedores(businessId),
      getInventoryItems(businessId),
      getCompanyProfile(businessId),
      ordenCompraId ? listarMiembrosNegocio(businessId).catch(() => []) : [],
      ordenCompraId ? obtenerOrdenCompra(businessId, ordenCompraId) : null,
      ordenCompraId ? listarRecepciones(businessId) : [],
    ]).then(([providerList, inventoryItems, profile, businessMembers, storedOrder, receptionList]) => {
      if (!active) return;
      setProviders(providerList);
      setInventory(inventoryItems);
      setCompany(profile);
      setMembers(businessMembers);
      setOrder(storedOrder);
      setReceptions(receptionList.filter((entry) => entry.ordenCompraId === ordenCompraId));
      if (ordenCompraId && !storedOrder) {
        setMessage("La orden de compra no existe.");
      } else if (storedOrder) {
        setDraft({
          proveedorId: storedOrder.proveedorId,
          fechaEntregaEstimada: storedOrder.fechaEntregaEstimada,
          direccionEntrega: storedOrder.direccionEntrega,
          condicionesPago: storedOrder.condicionesPago,
          observaciones: storedOrder.observaciones,
          items: storedOrder.items,
        });
      }
    }).catch((error) => {
      if (active) setMessage(error.message || "No pudimos cargar la orden.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [businessId, ordenCompraId]);

  const totals = useMemo(() => {
    try {
      return calculatePurchaseOrderTotals(draft.items, {
        tasaIva: order?.tasaIva ?? Number(company?.impuestoPredeterminadoTasa ?? 19) / 100,
      });
    } catch {
      return EMPTY_TOTALS;
    }
  }, [company?.impuestoPredeterminadoTasa, draft.items, order?.tasaIva]);

  const memberByUid = useMemo(
    () => new Map(members.map((member) => [member.uid, member])),
    [members]
  );

  const printableOrder = useMemo(() => ({
    ...(order || {}),
    ...draft,
    numero: order?.numero || "OC por asignar",
    paisCodigo: order?.paisCodigo || company?.paisCodigo || "CL",
    moneda: order?.moneda || company?.monedaCodigo || "CLP",
    locale: order?.locale || company?.locale || "es-CL",
    impuestoNombre: order?.impuestoNombre || company?.impuestoPredeterminadoNombre || "IVA",
    tasaIva: order?.tasaIva ?? Number(company?.impuestoPredeterminadoTasa ?? 19) / 100,
    proveedorSnapshot: resolvePurchaseOrderProviderPreview(
      order,
      draft.proveedorId,
      providers
    ) || {},
    ...totals,
  }), [company, draft, order, providers, totals]);

  const addItem = (item) => {
    setDraft((current) => ({
      ...current,
      items: [...current.items, {
        lineaId: lineId(),
        itemId: item.id,
        codigo: item.codigoInterno || item.sku || "",
        nombre: item.nombre,
        descripcion: item.descripcion || "",
        tipoItem: item.tipoItem || "producto",
        unidad: item.unidad || "unidad",
        cantidad: 1,
        costoUnitario: Number(item.costoBase || 0),
        descuentoPct: 0,
      }],
    }));
  };

  const persistDraft = async () => {
    if (order) {
      if (order.estado !== "borrador") return order;
      return (await actualizarOrdenCompraBorrador(businessId, order.id, draft)).ordenCompra;
    }
    return (await crearOrdenCompra(businessId, draft, {
      requestId: requestIdRef.current,
    })).ordenCompra;
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const saved = await persistDraft();
      requestIdRef.current = createPurchaseOrderRequestId();
      setOrder(saved);
      if (!ordenCompraId) {
        navigate("/ordenes-compra", {
          state: {
            createdOrder: saved,
            createdOrderNumber: saved.numero,
            openOrderId: saved.id,
          },
        });
      } else {
        sileo.success({title: "Orden de compra actualizada", description: `${saved.numero} continúa pendiente de emisión.`});
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const emitManual = async () => {
    setActionDialog("");
    setSaving(true);
    setMessage("");
    try {
      const saved = await persistDraft();
      const emitted = (await emitirOrdenCompra(businessId, saved.id, {canalEmision: "manual"})).ordenCompra;
      requestIdRef.current = createPurchaseOrderRequestId();
      setOrder(emitted);
      sileo.success({title: "Orden de compra emitida", description: `${saved.numero} fue registrada como emitida manualmente.`});
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (!order) return;
    setActionDialog("");
    setSaving(true);
    try {
      const cancelled = (await cancelarOrdenCompra(businessId, order.id)).ordenCompra;
      setOrder(cancelled);
      sileo.success({title: "Orden de compra cancelada", description: `${cancelled.numero} quedó cancelada.`});
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    if (!order) return;
    if (!duplicateRequestIdRef.current) {
      duplicateRequestIdRef.current = createPurchaseOrderDuplicateRequestId();
    }
    setDuplicating(true);
    setMessage("");
    try {
      const result = await duplicarOrdenCompraComoBorrador(
        businessId,
        order.id,
        {requestId: duplicateRequestIdRef.current}
      );
      duplicateRequestIdRef.current = "";
      navigate(`/ordenes-compra/${result.ordenCompra.id}/editar`, {
        state: {message: "Copia creada como orden pendiente."},
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setDuplicating(false);
    }
  };

  const createReception = async () => {
    if (!order) return;
    if (!conversionRequestIdRef.current) {
      conversionRequestIdRef.current = createReceptionRequestId("reception-create");
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await sileo.promise(
        crearRecepcionDesdeOrden(businessId, order.id, {
          requestId: conversionRequestIdRef.current,
        }),
        {
          loading: {title: "Preparando recepción...", description: `Calculando cantidades pendientes de ${order.numero}.`},
          success: (created) => ({
            title: "Recepción preparada",
            description: `${created.recepcion.numero} no modificará stock hasta confirmarla.`,
          }),
          error: (error) => ({title: "No se pudo preparar la recepción", description: error.message}),
        }
      );
      conversionRequestIdRef.current = "";
      navigate(`/recepciones/${result.recepcion.id}/editar`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const saveSupplierAnswer = async () => {
    if (!order) return;
    setSaving(true);
    try {
      const result = await registrarRespuestaProveedor(
        businessId,
        order.id,
        supplierAnswer.estado,
        supplierAnswer.comentario
      );
      setOrder(result.ordenCompra);
      setActionDialog("");
      sileo.success({
        title: "Respuesta registrada",
        description: `El proveedor quedó como ${supplierAnswer.estado}.`,
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const sendEmail = async (emailProveedor) => {
    if (!order) return;
    setSaving(true);
    setMessage("");
    try {
      const saved = await persistDraft();
      const pdfAttachment = await buildPurchaseOrderPdfAttachment({order: saved, companyProfile: company});
      const result = await sendPurchaseOrderEmail({businessId, ordenCompraId: saved.id, emailProveedor, pdfAttachment});
      if (!result.success) throw new Error(result.error || "No fue posible enviar la orden de compra.");
      setEmailOpen(false);
      const refreshed = await obtenerOrdenCompra(businessId, saved.id);
      setOrder(refreshed || saved);
      if (result.simulated) {
        sileo.info({title: "Simulación de correo — QA local", description: "No se envió un correo real. La orden permanece pendiente de envío."});
      } else {
        sileo.success({title: result.resent ? "Orden de compra reenviada" : "Correo enviado", description: `${saved.numero} fue enviada a ${emailProveedor}.`});
      }
    } catch (error) {
      setMessage(error.message);
      sileo.error({title: "No se pudo enviar la orden", description: error.message});
    } finally {
      setSaving(false);
    }
  };

  const openWhatsApp = async () => {
    if (!order) return;
    setSaving(true);
    setMessage("");
    try {
      const saved = await persistDraft();
      const result = await sharePurchaseOrderWhatsApp({order: saved, companyProfile: company});
      if (result.externalFlowOpened) {
        setWhatsAppDestination(result.destination || "");
        setActionDialog("whatsapp");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        setMessage(error.message);
        sileo.error({title: "No se pudo preparar WhatsApp", description: error.message});
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmWhatsApp = async () => {
    if (!order) return;
    setSaving(true);
    try {
      const emitted = (await emitirOrdenCompra(businessId, order.id, {
        canalEmision: "whatsapp",
        destinatario: whatsAppDestination,
      })).ordenCompra;
      setOrder(emitted);
      setActionDialog("");
      sileo.success({title: "Orden de compra emitida", description: `${emitted.numero} fue registrada como enviada por WhatsApp.`});
    } catch (error) {
      setMessage(error.message);
      sileo.error({title: "No se pudo registrar el envío", description: error.message});
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async () => {
    if (!order) return;
    setSaving(true);
    try {
      await downloadPurchaseOrderPdf({order: printableOrder, companyProfile: company});
      sileo.success({title: "PDF descargado", description: `${order.numero} quedó disponible en tus descargas.`});
    } catch (error) {
      sileo.error({title: "No se pudo generar el PDF", description: error.message});
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">Cargando orden de compra...</p>;

  return (
    <main className="po-workspace">
      <button type="button" className="po-back-link no-print" onClick={() => navigate("/ordenes-compra")}>← Volver al historial</button>
      <header className="po-header no-print">
        <div className="po-header__copy">
          <div className="po-header__title-row">
            <h1>{order?.numero || "OC por asignar"}</h1>
            {order && (
              <span className={`po-status po-status--${order.estado}`}>
                {order.estado === "emitida"
                  ? "Emitida"
                  : order.estado === "cancelada"
                    ? "Cancelada"
                    : "Pendiente de envío"}
              </span>
            )}
          </div>
          <div className="po-header__meta">
            <span>
              {order
                ? `Creada ${documentDate(order.creadoEn || order.fechaEmision)}`
                : "El número se asignará al crearla."}
            </span>
          </div>
        </div>
        {order && (
          <div className="po-header__actions">
            {canManage && order.estado === "emitida" && getSupplierResponseState(order) !== "rechazada" && <button type="button" className="po-button po-button--primary" disabled={saving} onClick={createReception}>{saving ? "Preparando..." : "Registrar recepción"}</button>}
            {canManage && order.estado === "emitida" && <button type="button" className="po-button po-button--secondary" disabled={saving} onClick={() => { setSupplierAnswer({estado: getSupplierResponseState(order) === "rechazada" ? "rechazada" : "confirmada", comentario: order.respuestaProveedor?.comentario || ""}); setActionDialog("supplier"); }}>Respuesta proveedor</button>}
            {canManage && order.estado !== "cancelada" && <button type="button" className={`po-button ${order.estado === "borrador" ? "po-button--primary" : "po-button--secondary"}`} disabled={saving} onClick={() => setEmailOpen(true)}>{order.estado === "emitida" ? "Reenviar correo" : "Enviar por correo"}</button>}
            {canManage && order.estado !== "cancelada" && <button type="button" className="po-button po-button--secondary" disabled={saving} onClick={openWhatsApp}>{order.estado === "emitida" ? "Reenviar por WhatsApp" : "WhatsApp"}</button>}
            <details className="po-more-actions">
              <summary className="po-button po-button--secondary">Más acciones ···</summary>
              <div>
                <button type="button" disabled={saving} onClick={downloadPdf}>Descargar PDF</button>
                <button type="button" onClick={() => window.print()}>Imprimir</button>
                {canManage && order.estado === "borrador" && <button type="button" disabled={saving} onClick={() => setActionDialog("manual")}>Marcar como enviada manualmente</button>}
                {canManage && order.estado !== "cancelada" && <button type="button" disabled={saving} onClick={() => setActionDialog("cancel")}>Cancelar orden</button>}
                {canManage && order.estado !== "borrador" && <button type="button" disabled={saving || duplicating} onClick={duplicate}>{duplicating ? "Creando copia..." : "Duplicar como pendiente"}</button>}
              </div>
            </details>
          </div>
        )}
      </header>
      {order?.estado === "borrador" && <section className="po-next-step no-print"><strong>Siguiente paso</strong><span>Envía esta orden al proveedor para registrarla como emitida.</span></section>}
      {order?.estado === "emitida" && <section className="po-linked-purchase no-print"><div><span>Respuesta del proveedor</span><strong>{getSupplierResponseLabel(order)}</strong></div><button type="button" className="po-button po-button--secondary" onClick={() => navigate("/recepciones")}>Ver recepciones</button></section>}
      {message && <p className="po-message po-message--error no-print">{message}</p>}
      <div className="no-print">
        <ProviderSelector
          disabled={readOnly}
          onChange={(proveedorId) => setDraft((current) => ({...current, proveedorId}))}
          originalSnapshot={order?.proveedorSnapshot}
          providers={providers}
          value={draft.proveedorId}
        />
        <div className="po-layout">
          <div className="po-main">
            <PurchaseOrderItemsEditor
              disabled={readOnly}
              items={draft.items}
              onChange={(items) => setDraft((current) => ({...current, items}))}
              onOpenCatalog={() => setCatalogOpen(true)}
              readOnly={Boolean(order && order.estado !== "borrador")}
            />
            <details className="po-panel po-details" open>
              <summary>
                <span><strong>Entrega</strong><small>{draft.fechaEntregaEstimada || draft.direccionEntrega || "Sin información adicional"}</small></span>
                <span className="po-details__indicator" aria-hidden="true" />
              </summary>
              <div className="po-fields">
                <label>Fecha estimada<input disabled={readOnly} type="date" value={draft.fechaEntregaEstimada} onChange={(event) => setDraft({...draft, fechaEntregaEstimada: event.target.value})} /></label>
                <label>Dirección de entrega<input disabled={readOnly} value={draft.direccionEntrega} onChange={(event) => setDraft({...draft, direccionEntrega: event.target.value})} /></label>
              </div>
            </details>
            <details className="po-panel po-details">
              <summary>
                <span><strong>Condiciones y observaciones</strong><small>{draft.condicionesPago || draft.observaciones || "Sin información adicional"}</small></span>
                <span className="po-details__indicator" aria-hidden="true" />
              </summary>
              <div className="po-fields">
                <label>Condiciones de pago<textarea disabled={readOnly} value={draft.condicionesPago} onChange={(event) => setDraft({...draft, condicionesPago: event.target.value})} /></label>
                <label>Observaciones<textarea disabled={readOnly} value={draft.observaciones} onChange={(event) => setDraft({...draft, observaciones: event.target.value})} /></label>
              </div>
            </details>
            {order && <section className="po-panel po-preview-panel"><header className="po-panel__header"><div><span className="po-kicker">Documento</span><h2>Vista previa imprimible</h2><p>Documento profesional para el proveedor.</p></div><button type="button" className="po-button po-button--secondary" aria-expanded={previewOpen} onClick={() => setPreviewOpen((current) => !current)}>{previewOpen ? "Ocultar vista previa" : "Ver vista previa"}</button></header>{previewOpen && <div className="po-preview-body"><PurchaseOrderPrintView company={company} order={printableOrder} /></div>}</section>}
            {order && (
              <section className="po-panel po-trace">
                <header><h2>Trazabilidad</h2></header>
                <ol>
                  <li><strong>Creada</strong><span>{traceDate(order.creadoEn || order.fechaEmision)} · {visibleActor(order.creadoPorUid, memberByUid)}</span></li>
                  {order.emitidaEn && <li><strong>Emitida por {({correo: "correo", whatsapp: "WhatsApp", manual: "registro manual"})[order.canalEmision] || "canal registrado"}</strong><span>{traceDate(order.emitidaEn)} · {visibleActor(order.emitidaPorUid, memberByUid)}{order.destinatarioEmision ? ` · ${order.destinatarioEmision}` : ""}</span></li>}
                  {Number(order.cantidadEnvios || 0) > 1 && <li><strong>Reenviada por {({correo: "correo", whatsapp: "WhatsApp", manual: "registro manual"})[order.ultimoCanalEnvio] || "canal registrado"}</strong><span>{traceDate(order.reenviadaEn || order.ultimoEnvioEn)} · {visibleActor(order.reenviadaPorUid || order.ultimoEnvioPorUid, memberByUid)}{order.ultimoDestinatarioEnvio ? ` · ${order.ultimoDestinatarioEnvio}` : ""}</span></li>}
                  {order.respuestaProveedor?.fecha && <li><strong>Respuesta del proveedor: {getSupplierResponseLabel(order)}</strong><span>{traceDate(order.respuestaProveedor.fecha)} · {order.respuestaProveedor.registradaPorNombre || order.respuestaProveedor.registradaPorEmail || "Usuario del negocio"}</span></li>}
                  {receptions.map((entry) => <li key={entry.id}><strong>{entry.estado === "confirmada" ? "Recepción confirmada" : entry.estado === "cancelada" ? "Recepción cancelada" : "Recepción creada"}</strong><span>{traceDate(entry.confirmadoEn || entry.creadoEn)} · <button type="button" onClick={() => navigate(`/recepciones/${entry.id}`)}>{entry.numero}</button></span></li>)}
                  {order.estado === "cancelada" && <li><strong>Cancelada</strong><span>{traceDate(order.canceladaEn)} · {visibleActor(order.canceladaPorUid, memberByUid)}</span></li>}
                </ol>
              </section>
            )}
          </div>
          <PurchaseOrderSummary
            currency={printableOrder.moneda}
            disabled={readOnly}
            isNew={!order}
            locale={printableOrder.locale}
            onSave={save}
            saving={saving}
            totals={totals}
            taxName={printableOrder.impuestoNombre}
            taxRate={Number(printableOrder.tasaIva || 0) * 100}
          />
        </div>
      </div>
      <div className="print-only"><PurchaseOrderPrintView company={company} order={printableOrder} /></div>
      <PurchaseOrderCatalogDialog
        items={inventory}
        onAdd={addItem}
        onClose={() => setCatalogOpen(false)}
        open={catalogOpen}
      />
      <SendPurchaseOrderEmailDialog open={emailOpen} onClose={() => setEmailOpen(false)} onSend={sendEmail} order={order} processing={saving} />
      <ResponsiveDialog open={actionDialog === "supplier"} onClose={() => !saving && setActionDialog("")} eyebrow="Respuesta del proveedor" title="Registrar respuesta" description="Esta dimensión es informativa y no cambia el estado interno de la orden." size="small" footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setActionDialog("")}>Volver</Button><Button type="button" disabled={saving} onClick={saveSupplierAnswer}>Guardar respuesta</Button></>}><div className="po-fields"><label>Estado<select value={supplierAnswer.estado} onChange={(event) => setSupplierAnswer({...supplierAnswer, estado: event.target.value})}><option value="confirmada">Confirmada</option><option value="rechazada">Rechazada</option></select></label><label>Comentario opcional<textarea value={supplierAnswer.comentario} onChange={(event) => setSupplierAnswer({...supplierAnswer, comentario: event.target.value})} /></label></div></ResponsiveDialog>
      <ResponsiveDialog open={actionDialog === "whatsapp"} onClose={() => !saving && setActionDialog("")} eyebrow="WhatsApp" title="¿Enviaste la orden de compra?" description="Abrir WhatsApp o compartir el PDF no confirma que el proveedor lo haya recibido." size="small" footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setActionDialog("")}>Mantener pendiente</Button><Button type="button" disabled={saving} onClick={confirmWhatsApp}>{saving ? "Registrando..." : "Sí, fue enviada"}</Button></>}><p>ValoraCloud registrará la emisión por WhatsApp, sin afirmar entrega ni lectura.</p></ResponsiveDialog>
      <ResponsiveDialog open={actionDialog === "manual"} onClose={() => !saving && setActionDialog("")} eyebrow="Más acciones" title="Marcar emisión manual" description="Usa esta opción solo si la orden ya fue entregada al proveedor por otro medio." size="small" footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setActionDialog("")}>Volver</Button><Button type="button" disabled={saving} onClick={emitManual}>{saving ? "Registrando..." : "Marcar como emitida"}</Button></>}><p>Se guardará fecha, canal y usuario de la emisión.</p></ResponsiveDialog>
      <ResponsiveDialog open={actionDialog === "cancel"} onClose={() => !saving && setActionDialog("")} eyebrow="Más acciones" title="Cancelar orden de compra" description="La orden quedará cancelada y no podrá convertirse en compra." size="small" footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setActionDialog("")}>Volver</Button><Button type="button" variant="danger" disabled={saving} onClick={cancel}>{saving ? "Cancelando..." : "Cancelar orden"}</Button></>}><p>La cancelación no modifica inventario ni compras existentes.</p></ResponsiveDialog>
    </main>
  );
}
