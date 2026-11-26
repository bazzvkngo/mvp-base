import React, {useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {addInventoryItemToLines, catalogEntryFromInventoryItem, sumQuantitiesByItem} from "../domain/inventoryLineAdd.mjs";
import {adaptDocumentAmountDecimals, resolveDocumentTaxRate} from "../domain/localization.mjs";
import {useBusinessMoney} from "../hooks/useBusinessFormat";
import {sileo} from "sileo";
import Button from "../components/ui/Button";
import InventoryCatalogDialog from "../components/ui/InventoryCatalogDialog";
import LoadingState from "../components/ui/LoadingState";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import SupplyTrace from "../components/ui/SupplyTrace";
import {
  calculatePurchaseOrderTotals,
  canManagePurchaseOrders,
  canOfferPurchaseOrderDeletion,
  getSupplierResponseLabel,
  getSupplierResponseState,
  getProviderPurchaseOrderPaymentTerms,
  resolvePurchaseOrderProviderPreview,
} from "../domain/purchaseOrderModel.mjs";
import {getOrderReceptionStatus, getOrderReceptionStatusLabel} from "../domain/receptionModel.mjs";
import {incrementScannedItem} from "../domain/barcode.mjs";
import PurchaseProviderSelector from "../features/purchases/PurchaseProviderSelector";
import PurchaseOrderDeleteDialog from "../features/purchaseOrders/PurchaseOrderDeleteDialog";
import PurchaseOrderDetailView from "../features/purchaseOrders/PurchaseOrderDetailView";
import PurchaseOrderItemsEditor from "../features/purchaseOrders/PurchaseOrderItemsEditor";
import PurchaseOrderPrintView from "../features/purchaseOrders/PurchaseOrderPrintView";
import PurchaseOrderSummary from "../features/purchaseOrders/PurchaseOrderSummary";
import SendPurchaseOrderEmailDialog from "../features/purchaseOrders/SendPurchaseOrderEmailDialog";
import {auth} from "../firebase/firebaseConfig.js";
import {listarMiembrosNegocio} from "../services/businessMemberService";
import {getCompanyProfile} from "../services/companyService";
import {findActiveProductByBarcode, getInventoryItems} from "../services/inventoryService";
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
  getPurchaseOrderWhatsAppAvailability,
  sharePurchaseOrderWhatsApp,
} from "../utils/purchaseOrderPdf";
import "../features/purchaseOrders/purchase-orders.css";
import "../features/purchaseOrders/purchase-order-delete.css";
import {userErrorMessage} from "../domain/userFacingError.mjs";

const EMPTY_TOTALS = {subtotal: 0, descuentoTotal: 0, neto: 0, iva: 0, total: 0};
const PROVIDER_AT_ORDER_NOTE = "Datos del proveedor al momento de la orden";
const orderStatusLabel = (order) => (order
  ? (order.estado === "emitida" ? "Emitida" : order.estado === "cancelada" ? "Cancelada" : "Pendiente de envío")
  : "Borrador");

function traceDate(value, locale = "es-CL") {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString(locale, {dateStyle: "short", timeStyle: "short"})
    : "Fecha no disponible";
}

function documentDate(value, locale = "es-CL") {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(locale);
  }
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(locale)
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
  // Decimales de cálculo (SPEC 036): una orden guardada usa el `montoDecimales` de su documento (ausente = 0); un
  // borrador que todavía no existe usa los de la moneda del negocio. Con 0 todo se calcula entero, como siempre.
  const businessMoney = useBusinessMoney();
  const documentDecimals = order
    ? adaptDocumentAmountDecimals(order, order.moneda)
    : businessMoney.amountDecimals;
  // Paso de los importes: "any" con 0 decimales (como siempre) y "0.01" con 2. La cantidad no cambia.
  const moneyStep = documentDecimals > 0 ? String(10 ** -documentDecimals) : "any";
  const [providers, setProviders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [company, setCompany] = useState(null);
  const [members, setMembers] = useState([]);
  const [receptions, setReceptions] = useState([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState("");
  const [whatsAppDestination, setWhatsAppDestination] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [message, setMessage] = useState("");
  const [supplierAnswer, setSupplierAnswer] = useState({estado: "pendiente", comentario: ""});
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
      if (active) setMessage(userErrorMessage(error, "No pudimos cargar la orden."));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [businessId, ordenCompraId]);

  const totals = useMemo(() => {
    try {
      return calculatePurchaseOrderTotals(draft.items, {
        tasaIva: resolveDocumentTaxRate(order, company),
        montoDecimales: documentDecimals,
      });
    } catch {
      return EMPTY_TOTALS;
    }
  }, [company?.impuestoPredeterminadoTasa, company?.paisCodigo, documentDecimals, draft.items, order?.tasaIva]);

  const memberByUid = useMemo(
    () => new Map(members.map((member) => [member.uid, member])),
    [members]
  );

  const printableOrder = useMemo(() => ({
    ...(order || {}),
    ...draft,
    numero: order?.numero || "Nueva orden de compra",
    paisCodigo: order?.paisCodigo || company?.paisCodigo || "CL",
    moneda: order?.moneda || company?.monedaCodigo || "CLP",
    locale: order?.locale || company?.locale || "es-CL",
    impuestoNombre: order?.impuestoNombre || company?.impuestoPredeterminadoNombre || "IVA",
    tasaIva: resolveDocumentTaxRate(order, company),
    proveedorSnapshot: resolvePurchaseOrderProviderPreview(
      order,
      draft.proveedorId,
      providers
    ) || {},
    ...totals,
  }), [company, draft, order, providers, totals]);

  const orderLocale = printableOrder.locale || "es-CL";
  const supplierResponseState = getSupplierResponseState(order);
  const receptionStatus = order ? getOrderReceptionStatus(order, receptions) : "sin_recepcion";
  const receptionCompleted = receptionStatus === "recibida_total";
  const openDraftReception = receptions.find((entry) => entry.estado === "borrador");
  const receptionActionLabel = receptionStatus === "recibida_parcial" || openDraftReception
    ? "Continuar recepción"
    : "Registrar recepción";
  const whatsAppAvailability = getPurchaseOrderWhatsAppAvailability(order);
  const hasConfirmedReceptions = receptions.some((entry) => entry.estado === "confirmada");
  // Eliminar solo se ofrece a OWNER/ADMIN en una orden nunca enviada y sin recepciones;
  // es una cortesía de interfaz, la autoridad es la Function eliminarOrdenCompra.
  const canDeleteOrder = canOfferPurchaseOrderDeletion(order, role) && receptions.length === 0;
  const cancellationDescription = order?.estado === "borrador"
    ? "La orden quedará cancelada y dejará de estar disponible para envío."
    : hasConfirmedReceptions
      ? "Al cancelar, esta orden dejará de estar disponible para nuevas recepciones. Las recepciones ya confirmadas conservarán su trazabilidad y no se revertirán automáticamente."
      : "Al cancelar, esta orden dejará de estar disponible para nuevas recepciones.";

  const openSupplierConfirmation = () => {
    setSupplierAnswer({
      estado: getSupplierResponseState(order),
      comentario: order?.respuestaProveedor?.comentario || "",
    });
    setActionDialog("supplier");
  };

  const catalogEntries = useMemo(() => inventory.map((item) => catalogEntryFromInventoryItem(item, "costoBase")), [inventory]);
  const catalogAddedQuantities = useMemo(() => sumQuantitiesByItem(draft.items), [draft.items]);

  const newLine = (item) => ({
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
  });

  // Escaneo: suma 1 a la línea del ítem (sin reemplazar costo ni descuento editados) o crea una (SPEC 005).
  const addItem = (item) => {
    setDraft((current) => ({
      ...current,
      items: incrementScannedItem(current.items, item.id, () => newLine(item)),
    }));
  };

  // Diálogo "Agregar desde inventario": como en Compra, suma a una línea limpia (mismo ítem, sin descuento, mismo costo
  // actual) o crea otra. La orden no consume stock: sin tope.
  const addCatalogItem = (item, quantity = 1) => setDraft((current) => ({
    ...current,
    items: addInventoryItemToLines(current.items, item, {
      itemId: item.id,
      quantity,
      priceKey: "costoUnitario",
      createLine: () => newLine(item),
    }).items,
  }));

  const addScannedProduct = async (barcode) => {
    const product = await findActiveProductByBarcode(businessId, barcode);
    if (!product) {
      throw new Error("Producto no encontrado para este código.");
    }
    addItem(product);
    // El cuadro de escaneo continuo muestra la confirmación y la lista de la sesión.
    return {key: product.id, label: product.nombre};
  };

  const persistDraft = async () => {
    if (order) {
      if (order.estado !== "borrador") return order;
      return (await actualizarOrdenCompraBorrador(businessId, order.id, {...draft, montoDecimales: documentDecimals})).ordenCompra;
    }
    return (await crearOrdenCompra(businessId, {...draft, montoDecimales: documentDecimals}, {
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
      setMessage(userErrorMessage(error));
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
      setMessage(userErrorMessage(error));
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
      setMessage(userErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  // La confirmación «permanente», el aviso y la guarda viven en PurchaseOrderDeleteDialog (compartido con la lista).
  const openDelete = () => {
    if (!canDeleteOrder) return;
    setActionDialog("delete");
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
      setMessage(userErrorMessage(error));
    } finally {
      setDuplicating(false);
    }
  };

  const createReception = async () => {
    if (!order) return;
    if (openDraftReception) {
      navigate(`/recepciones/${openDraftReception.id}/editar`);
      return;
    }
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
          error: (error) => ({title: "No se pudo preparar la recepción", description: userErrorMessage(error)}),
        }
      );
      conversionRequestIdRef.current = "";
      navigate(`/recepciones/${result.recepcion.id}/editar`);
    } catch {
      // sileo.promise() ya mostró el toast de error (misma
      // description: error.message) — nada más que hacer aquí.
    } finally {
      setSaving(false);
    }
  };

  const saveSupplierAnswer = async () => {
    if (!order) return;
    if (supplierAnswer.estado === "confirmada_con_observaciones" && !supplierAnswer.comentario.trim()) {
      setMessage("Agrega la observación informada por el proveedor.");
      return;
    }
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
        title: "Confirmación registrada",
        description: `Estado actualizado a ${getSupplierResponseLabel(result.ordenCompra)}.`,
      });
    } catch (error) {
      setMessage(userErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const sendEmail = async ({emailProveedor, asunto, mensaje, enviarCopia}) => {
    if (!order) return;
    setSaving(true);
    setMessage("");
    try {
      const saved = await persistDraft();
      const pdfAttachment = await buildPurchaseOrderPdfAttachment({order: saved, companyProfile: company});
      const result = await sendPurchaseOrderEmail({businessId, ordenCompraId: saved.id, emailProveedor, asunto, mensaje, pdfAttachment, enviarCopia});
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
      sileo.error({title: "No se pudo enviar la orden", description: userErrorMessage(error)});
    } finally {
      setSaving(false);
    }
  };

  const openWhatsApp = async () => {
    if (!order) return;
    const targetWindow = window.open("", "_blank");
    if (!targetWindow) {
      sileo.error({title: "No se pudo abrir WhatsApp", description: "El navegador bloqueó la nueva ventana."});
      return;
    }
    targetWindow.opener = null;
    setSaving(true);
    setMessage("");
    try {
      const saved = await persistDraft();
      const result = await sharePurchaseOrderWhatsApp({order: saved, companyProfile: company, targetWindow});
      if (result.externalFlowOpened) {
        setWhatsAppDestination(result.destination || "");
        setActionDialog("whatsapp");
      }
    } catch (error) {
      targetWindow.close();
      if (error?.name !== "AbortError") {
        sileo.error({title: "No se pudo preparar WhatsApp", description: userErrorMessage(error)});
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
      sileo.error({title: "No se pudo registrar el envío", description: userErrorMessage(error)});
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
      sileo.error({title: "No se pudo generar el PDF", description: userErrorMessage(error)});
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState variant="page" label="Cargando orden de compra..." />;

  // Orden emitida o cancelada: detalle de solo lectura. El borrador y la orden nueva conservan el formulario.
  const showDetailView = Boolean(order && order.estado !== "borrador");

  return (
    <main className="po-workspace purchase-workspace">
      {showDetailView ? <PurchaseOrderDetailView
        canManage={canManage}
        company={company}
        currentUser={auth.currentUser}
        duplicating={duplicating}
        memberByUid={memberByUid}
        message={message}
        canDelete={canDeleteOrder}
        onCancel={() => setActionDialog("cancel")}
        onCreateReception={createReception}
        onDelete={openDelete}
        onDownloadPdf={downloadPdf}
        onDuplicate={duplicate}
        onEmail={() => setEmailOpen(true)}
        onSupplierConfirmation={openSupplierConfirmation}
        onWhatsApp={openWhatsApp}
        order={order}
        printableOrder={printableOrder}
        receptionActionLabel={receptionActionLabel}
        receptionStatus={receptionStatus}
        receptions={receptions}
        saving={saving}
        totals={totals}
        whatsAppAvailability={whatsAppAvailability}
      /> : <>
      {/* Un solo h1 por pantalla: el de la barra superior (navigation.js). Por eso el título va en un <p>. */}
      <header className="ui-doc-head no-print">
        <div className="ui-doc-head__main">
          <button type="button" className="ui-doc-back" onClick={() => navigate("/ordenes-compra")}>← Órdenes de compra</button>
          <p className="ui-doc-head__title">{order?.numero || "Nueva orden de compra"}</p>
          <span className={`po-status po-status--${order?.estado || "borrador"}`}>{orderStatusLabel(order)}</span>
        </div>
        <div className="ui-doc-head__side">
          <div className="ui-doc-head__meta">
            <span>{order ? `Creada ${documentDate(order.creadoEn || order.fechaEmision, orderLocale)}` : documentDate(new Date(), orderLocale)}</span>
            <span>{order?.ordenCompraOrigenNumero ? `Copia de ${order.ordenCompraOrigenNumero}` : "Orden directa"}</span>
            {!order && <span>El número se asignará al crearla.</span>}
          </div>
        </div>
        {order && (
          <div className="po-header__action-stack">
            <div className="po-header__actions">
              {canManage && order.estado === "emitida" && supplierResponseState !== "rechazada" && !receptionCompleted && <button type="button" className="po-button po-button--primary" disabled={saving} onClick={createReception}>{saving ? "Preparando..." : receptionActionLabel}</button>}
              {canManage && order.estado === "emitida" && supplierResponseState === "rechazada" && !receptionCompleted && <button type="button" className="po-button po-button--primary" disabled={saving} onClick={openSupplierConfirmation}>Actualizar confirmación</button>}
              {canManage && order.estado === "borrador" && <button type="button" className="po-button po-button--primary" disabled={saving} onClick={() => setEmailOpen(true)}>Enviar por correo</button>}
              {canManage && order.estado !== "cancelada" && !receptionCompleted && <button type="button" className="po-button po-button--danger-subtle" disabled={saving} onClick={() => setActionDialog("cancel")}>Cancelar</button>}
              {canDeleteOrder && order.estado === "borrador" && <button type="button" className="po-button po-button--danger-subtle purchase-order-delete__trigger" disabled={saving} onClick={openDelete}>Eliminar</button>}
              {canManage && order.estado === "emitida" && supplierResponseState !== "rechazada" && !receptionCompleted && <button type="button" className="po-button po-button--secondary" disabled={saving} onClick={openSupplierConfirmation}>Registrar confirmación</button>}
              {canManage && order.estado === "emitida" && <button type="button" className="po-button po-button--secondary" disabled={saving} onClick={() => setEmailOpen(true)}>Reenviar correo</button>}
              {canManage && order.estado !== "cancelada" && <button type="button" className="po-button po-button--secondary" disabled={saving || !whatsAppAvailability.enabled} title={whatsAppAvailability.help} onClick={openWhatsApp}>{order.estado === "emitida" ? "Reenviar por WhatsApp" : "WhatsApp"}</button>}
            </div>
            <div className="po-header__utility-actions">
              <button type="button" className="po-button po-button--quiet" disabled={saving} onClick={downloadPdf}>Descargar PDF</button>
              <button type="button" className="po-button po-button--quiet" onClick={() => window.print()}>Imprimir</button>
              {canManage && order.estado === "borrador" && <button type="button" className="po-button po-button--quiet" disabled={saving} onClick={() => setActionDialog("manual")}>Registrar envío manual</button>}
              {canManage && order.estado !== "borrador" && <button type="button" className="po-button po-button--quiet" disabled={saving || duplicating} onClick={duplicate}>{duplicating ? "Creando copia..." : "Duplicar como nueva orden"}</button>}
            </div>
            {canManage && order.estado !== "cancelada" && !whatsAppAvailability.enabled && <small className="po-action-help">{whatsAppAvailability.help}</small>}
            {canDeleteOrder && order.estado === "borrador" && <small className="purchase-order-delete__hint">Cancelar conserva la orden en el historial; eliminar la quita para siempre.</small>}
          </div>
        )}
      </header>
      {order?.estado === "borrador" && <section className="po-next-step no-print"><strong>Siguiente paso</strong><span>Envía esta orden al proveedor para registrarla como emitida.</span></section>}
      {order?.estado === "emitida" && <section className="po-linked-purchase no-print"><div><span>Estado de recepción</span><strong>{getOrderReceptionStatusLabel(receptionStatus)}</strong><small>Confirmación del proveedor: {getSupplierResponseLabel(order)}</small></div></section>}
      {order && <div className="no-print"><SupplyTrace currentType="order" order={order} receptions={receptions} /></div>}
      {message && <p className="po-message po-message--error no-print">{message}</p>}
      <section className="ui-step-card no-print" aria-labelledby="po-provider-title">
        <h2 id="po-provider-title" className="ui-step-title">¿A quién le pides?</h2>
        <PurchaseProviderSelector
          disabled={readOnly}
          historicalNote={PROVIDER_AT_ORDER_NOTE}
          onChange={(proveedorId) => {
            const provider = providers.find((entry) => entry.proveedorId === proveedorId);
            setDraft((current) => ({
              ...current,
              proveedorId,
              condicionesPago: getProviderPurchaseOrderPaymentTerms(provider),
            }));
          }}
          originalSnapshot={order?.proveedorSnapshot}
          providers={providers}
          purpose="pedir"
          value={draft.proveedorId}
        />
      </section>
      <div className="no-print">
        <div className="po-layout">
          <div className="po-main">
            <PurchaseOrderItemsEditor
              moneyStep={moneyStep}
              disabled={readOnly}
              items={draft.items}
              onChange={(items) => setDraft((current) => ({...current, items}))}
              onOpenCatalog={() => setCatalogOpen(true)}
              onScanProduct={addScannedProduct}
              readOnly={Boolean(order && order.estado !== "borrador")}
            />
            <section className="po-panel po-delivery-panel" aria-labelledby="po-delivery-title">
              <header className="ui-section-head">
                <div><span className="po-kicker">Datos de la orden</span><h2 id="po-delivery-title" className="ui-section-head__title">Entrega</h2></div>
              </header>
              <div className="po-fields">
                <label>Fecha estimada<input disabled={readOnly} type="date" value={draft.fechaEntregaEstimada} onChange={(event) => setDraft({...draft, fechaEntregaEstimada: event.target.value})} /></label>
                <label>Dirección de entrega<input disabled={readOnly} value={draft.direccionEntrega} onChange={(event) => setDraft({...draft, direccionEntrega: event.target.value})} /></label>
              </div>
            </section>
            <section className="po-panel purchase-conditions-panel" aria-labelledby="po-conditions-title">
              <header className="ui-section-head">
                <div><span className="po-kicker">Condiciones</span><h2 id="po-conditions-title" className="ui-section-head__title">Condiciones comerciales</h2></div>
                {!readOnly && <Button type="button" variant="secondary" onClick={() => setConditionsOpen(true)}>Editar condiciones</Button>}
              </header>
              <div className="purchase-conditions-summary">
                <div><strong>Condiciones de pago</strong><p>{draft.condicionesPago || "Sin condiciones informadas."}</p></div>
                {String(draft.observaciones || "").trim() && <div><strong>Observaciones</strong><p>{draft.observaciones}</p></div>}
              </div>
            </section>
            {order && (
              <section className="po-panel po-preview-panel" aria-labelledby="po-preview-title">
                <header className="ui-section-head">
                  <div><span className="po-kicker">Documento</span><h2 id="po-preview-title" className="ui-section-head__title">Vista previa imprimible</h2><p className="ui-section-head__hint">Documento profesional para el proveedor.</p></div>
                  <div className="ui-section-head__actions">
                    <Button type="button" variant="secondary" aria-expanded={previewOpen} onClick={() => setPreviewOpen((current) => !current)}>{previewOpen ? "Ocultar vista previa" : "Ver vista previa"}</Button>
                  </div>
                </header>
                {previewOpen && <div className="po-preview-body"><PurchaseOrderPrintView company={company} order={printableOrder} /></div>}
              </section>
            )}
            {order && (
              <section className="po-panel po-trace">
                <header><h2>Historial de la orden</h2></header>
                <ol>
                  <li><strong>Creada</strong><span>{traceDate(order.creadoEn || order.fechaEmision, orderLocale)} · {visibleActor(order.creadoPorUid, memberByUid)}</span></li>
                  {order.emitidaEn && <li><strong>Emitida por {({correo: "correo", whatsapp: "WhatsApp", manual: "registro manual"})[order.canalEmision] || "canal registrado"}</strong><span>{traceDate(order.emitidaEn, orderLocale)} · {visibleActor(order.emitidaPorUid, memberByUid)}{order.destinatarioEmision ? ` · ${order.destinatarioEmision}` : ""}</span></li>}
                  {Number(order.cantidadEnvios || 0) > 1 && <li><strong>Reenviada por {({correo: "correo", whatsapp: "WhatsApp", manual: "registro manual"})[order.ultimoCanalEnvio] || "canal registrado"}</strong><span>{traceDate(order.reenviadaEn || order.ultimoEnvioEn, orderLocale)} · {visibleActor(order.reenviadaPorUid || order.ultimoEnvioPorUid, memberByUid)}{order.ultimoDestinatarioEnvio ? ` · ${order.ultimoDestinatarioEnvio}` : ""}</span></li>}
                  {order.respuestaProveedor?.fecha && <li><strong>Confirmación del proveedor: {getSupplierResponseLabel(order)}</strong><span>{traceDate(order.respuestaProveedor.fecha, orderLocale)} · {order.respuestaProveedor.registradaPorNombre || order.respuestaProveedor.registradaPorEmail || "Usuario del negocio"}</span></li>}
                  {receptions.map((entry) => <li key={entry.id}><strong>{entry.estado === "confirmada" ? "Recepción confirmada" : entry.estado === "cancelada" ? "Recepción cancelada" : "Recepción creada"}</strong><span>{traceDate(entry.confirmadoEn || entry.creadoEn, orderLocale)} · <button type="button" onClick={() => navigate(`/recepciones/${entry.id}`)}>{entry.numero}</button></span></li>)}
                  {order.estado === "cancelada" && <li><strong>Cancelada</strong><span>{traceDate(order.canceladaEn, orderLocale)} · {visibleActor(order.canceladaPorUid, memberByUid)}</span></li>}
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
      </>}
      <InventoryCatalogDialog
        addedQuantities={catalogAddedQuantities}
        entries={catalogEntries}
        onAdd={addCatalogItem}
        onClose={() => setCatalogOpen(false)}
        open={catalogOpen}
        priceLabel="Costo"
      />
      <ResponsiveDialog
        open={conditionsOpen}
        onClose={() => setConditionsOpen(false)}
        eyebrow="Condiciones"
        title="Editar condiciones comerciales"
        description="Agrega las condiciones de pago y observaciones que deben acompañar la orden de compra."
        size="medium"
        footer={<Button type="button" onClick={() => setConditionsOpen(false)}>Listo</Button>}
      >
        <div className="purchase-conditions-form">
          <label>Condiciones de pago<textarea rows="4" disabled={readOnly} value={draft.condicionesPago} onChange={(event) => setDraft({...draft, condicionesPago: event.target.value})} /></label>
          <label>Observaciones<textarea rows="4" disabled={readOnly} value={draft.observaciones} onChange={(event) => setDraft({...draft, observaciones: event.target.value})} /></label>
        </div>
      </ResponsiveDialog>
      <SendPurchaseOrderEmailDialog companyProfile={company} open={emailOpen} onClose={() => setEmailOpen(false)} onSend={sendEmail} order={order} processing={saving} />
      <ResponsiveDialog open={actionDialog === "supplier"} onClose={() => !saving && setActionDialog("")} eyebrow="Confirmación del proveedor" title="Registrar confirmación" description="Registra aquí la respuesta recibida por correo, teléfono o WhatsApp. Una confirmación rechazada mantiene el bloqueo vigente para nuevas recepciones." size="small" footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setActionDialog("")}>Volver</Button><Button type="button" loading={saving} onClick={saveSupplierAnswer}>{saving ? "Guardando..." : "Guardar confirmación"}</Button></>}><div className="po-fields"><label>Estado<select value={supplierAnswer.estado} onChange={(event) => setSupplierAnswer({...supplierAnswer, estado: event.target.value})}><option value="pendiente">Pendiente</option><option value="confirmada">Confirmada</option><option value="rechazada">Rechazada</option><option value="confirmada_con_observaciones">Confirmada con observaciones</option></select></label><label>Observación{supplierAnswer.estado === "confirmada_con_observaciones" ? " *" : " (opcional)"}<textarea required={supplierAnswer.estado === "confirmada_con_observaciones"} maxLength={2000} placeholder="Ej. Confirma cantidades y solicita ajustar la fecha de entrega." value={supplierAnswer.comentario} onChange={(event) => setSupplierAnswer({...supplierAnswer, comentario: event.target.value})} /></label></div></ResponsiveDialog>
      <ResponsiveDialog open={actionDialog === "whatsapp"} onClose={() => !saving && setActionDialog("")} eyebrow="WhatsApp" title="¿Enviaste la orden de compra?" description="Abrir WhatsApp no confirma que el proveedor haya recibido la orden." size="small" footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setActionDialog("")}>Mantener pendiente</Button><Button type="button" loading={saving} onClick={confirmWhatsApp}>{saving ? "Registrando..." : "Sí, fue enviada"}</Button></>}><p>ValoraCloud registrará la emisión por WhatsApp, sin afirmar entrega ni lectura.</p></ResponsiveDialog>
      <ResponsiveDialog open={actionDialog === "manual"} onClose={() => !saving && setActionDialog("")} eyebrow="Emisión" title="Marcar emisión manual" description="Usa esta opción solo si la orden ya fue entregada al proveedor por otro medio." size="small" footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setActionDialog("")}>Volver</Button><Button type="button" loading={saving} onClick={emitManual}>{saving ? "Registrando..." : "Marcar como emitida"}</Button></>}><p>Se guardará fecha, canal y usuario de la emisión.</p></ResponsiveDialog>
      <ResponsiveDialog open={actionDialog === "cancel"} onClose={() => !saving && setActionDialog("")} eyebrow="Acción de orden" title="Cancelar orden de compra" description={cancellationDescription} size="small" footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setActionDialog("")}>Volver</Button><Button type="button" variant="danger" loading={saving} onClick={cancel}>{saving ? "Cancelando..." : "Cancelar orden"}</Button></>}>{hasConfirmedReceptions ? <p>La cancelación no revierte inventario ni compras ya generadas.</p> : null}</ResponsiveDialog>
      <PurchaseOrderDeleteDialog
        businessId={businessId}
        onClose={() => setActionDialog("")}
        onDeleted={() => navigate("/ordenes-compra", {replace: true})}
        open={actionDialog === "delete" && Boolean(order)}
        order={order}
      />
    </main>
  );
}
