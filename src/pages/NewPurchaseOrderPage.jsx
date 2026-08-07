import React, {useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {
  calculatePurchaseOrderTotals,
  canManagePurchaseOrders,
  resolvePurchaseOrderProviderPreview,
} from "../domain/purchaseOrderModel.mjs";
import ProviderSelector from "../features/purchaseOrders/ProviderSelector";
import PurchaseOrderCatalogDialog from "../features/purchaseOrders/PurchaseOrderCatalogDialog";
import PurchaseOrderItemsEditor from "../features/purchaseOrders/PurchaseOrderItemsEditor";
import PurchaseOrderPrintView from "../features/purchaseOrders/PurchaseOrderPrintView";
import PurchaseOrderSummary from "../features/purchaseOrders/PurchaseOrderSummary";
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
} from "../services/purchaseOrderService";
import {
  crearCompraDesdeOrden,
  createPurchaseRequestId,
} from "../services/purchaseService";
import "../features/purchaseOrders/purchase-orders.css";

const EMPTY_TOTALS = {subtotal: 0, descuentoTotal: 0, neto: 0, iva: 0, total: 0};

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
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [message, setMessage] = useState(() => location.state?.message || "");
  const requestIdRef = useRef(createPurchaseOrderRequestId());
  const duplicateRequestIdRef = useRef("");
  const conversionRequestIdRef = useRef("");
  const canManage = canManagePurchaseOrders(role);
  const readOnly = !canManage || (order && order.estado !== "borrador");

  useEffect(() => {
    if (location.state?.message) setMessage(location.state.message);
  }, [location.state?.message]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      listarProveedores(businessId),
      getInventoryItems(businessId),
      getCompanyProfile(businessId),
      ordenCompraId ? obtenerOrdenCompra(businessId, ordenCompraId) : null,
    ]).then(([providerList, inventoryItems, profile, storedOrder]) => {
      if (!active) return;
      setProviders(providerList);
      setInventory(inventoryItems);
      setCompany(profile);
      setOrder(storedOrder);
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
      return calculatePurchaseOrderTotals(draft.items);
    } catch {
      return EMPTY_TOTALS;
    }
  }, [draft.items]);

  const printableOrder = useMemo(() => ({
    ...(order || {}),
    ...draft,
    numero: order?.numero || "OC por asignar",
    proveedorSnapshot: resolvePurchaseOrderProviderPreview(
      order,
      draft.proveedorId,
      providers
    ) || {},
    ...totals,
  }), [draft, order, providers, totals]);

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
      setMessage("Borrador guardado.");
      if (!ordenCompraId) navigate(`/ordenes-compra/${saved.id}/editar`, {replace: true});
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const emit = async () => {
    setSaving(true);
    setMessage("");
    try {
      const saved = await persistDraft();
      const emitted = (await emitirOrdenCompra(businessId, saved.id)).ordenCompra;
      requestIdRef.current = createPurchaseOrderRequestId();
      setOrder(emitted);
      setMessage("Orden emitida correctamente.");
      navigate(`/ordenes-compra/${saved.id}`, {replace: true});
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (!order || !globalThis.confirm("¿Cancelar esta orden de compra?")) return;
    setSaving(true);
    try {
      const cancelled = (await cancelarOrdenCompra(businessId, order.id)).ordenCompra;
      setOrder(cancelled);
      setMessage("Orden cancelada.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    if (!order || !globalThis.confirm(
      "Se creará un nuevo documento editable. El original permanecerá sin cambios."
    )) return;
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
        state: {message: "Copia creada como borrador."},
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setDuplicating(false);
    }
  };

  const convertToPurchase = async () => {
    if (!order) return;
    if (order.compraId) {
      navigate(`/compras/${order.compraId}`);
      return;
    }
    if (!conversionRequestIdRef.current) {
      conversionRequestIdRef.current = createPurchaseRequestId("convertir-oc");
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await crearCompraDesdeOrden(businessId, order.id, {
        requestId: conversionRequestIdRef.current,
      });
      conversionRequestIdRef.current = "";
      navigate(`/compras/${result.compra.id}/editar`, {
        state: {message: `Compra creada desde ${order.numero}.`},
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">Cargando orden de compra...</p>;

  return (
    <main className="po-workspace">
      <header className="po-header no-print">
        <div className="po-header__copy">
          <span className="po-kicker">Compras</span>
          <div className="po-header__title-row">
            <h1>{order ? "Orden de compra" : "Nueva orden de compra"}</h1>
            <span className={`po-status po-status--${order?.estado || "borrador"}`}>
              {order?.estado === "emitida"
                ? "Emitida"
                : order?.estado === "cancelada"
                  ? "Cancelada"
                  : "Borrador"}
            </span>
          </div>
          <div className="po-header__meta">
            <strong>{order?.numero || "OC por asignar"}</strong>
            <span>
              {order
                ? `Emisión ${order.fechaEmision || "—"}`
                : "El número se asignará al guardar"}
            </span>
          </div>
        </div>
        <div className="po-header__actions">
          <button type="button" className="po-button po-button--secondary" onClick={() => navigate("/ordenes-compra")}>Volver al historial</button>
          {order && <button type="button" className="po-button po-button--secondary" onClick={() => window.print()}>Imprimir</button>}
          {readOnly && canManage && order?.estado === "emitida" && <button type="button" className="po-button po-button--danger" onClick={cancel}>Cancelar orden</button>}
          {readOnly && canManage && order?.estado === "emitida" && <button type="button" className="po-button po-button--primary" disabled={saving} onClick={convertToPurchase}>{order.compraId ? "Ver compra" : saving ? "Registrando..." : "Registrar compra"}</button>}
          {readOnly && canManage && order && <button type="button" className="po-button po-button--secondary" disabled={saving || duplicating} onClick={duplicate}>{duplicating ? "Creando copia..." : "Duplicar como borrador"}</button>}
        </div>
      </header>
      {message && <p className="po-message no-print">{message}</p>}
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
            <details className="po-panel po-details">
              <summary>
                <span><strong>Vista previa imprimible</strong><small>Documento comercial listo para impresión</small></span>
                <span className="po-details__indicator" aria-hidden="true" />
              </summary>
              <PurchaseOrderPrintView company={company} order={printableOrder} />
            </details>
          </div>
          <PurchaseOrderSummary
            disabled={readOnly}
            onCancel={order ? cancel : null}
            onEmit={emit}
            onSave={save}
            saving={saving}
            totals={totals}
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
    </main>
  );
}
