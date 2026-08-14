import React, {useEffect, useMemo, useRef, useState} from "react";
import {Plus, Search} from "lucide-react";
import {useNavigate} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import {
  canManagePurchaseOrders,
  matchesPurchaseOrderSearch,
} from "../domain/purchaseOrderModel.mjs";
import {
  cancelarOrdenCompra,
  createPurchaseOrderDuplicateRequestId,
  duplicarOrdenCompraComoBorrador,
  emitirOrdenCompra,
  listarOrdenesCompra,
} from "../services/purchaseOrderService";
import {
  crearCompraDesdeOrden,
  createPurchaseRequestId,
} from "../services/purchaseService";
import "../features/purchaseOrders/purchase-orders.css";

const labels = {borrador: "Borrador", emitida: "Emitida", cancelada: "Cancelada"};
const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;

function dateLabel(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("es-CL") : "—";
}

function OrderActions({canManage, converting, duplicating, onAction, onConvert, onDuplicate, onOpen, order}) {
  return (
    <div className="po-history__actions">
      <button type="button" onClick={() => onOpen(order)}>
        {order.estado === "borrador" && canManage ? "Editar" : "Ver"}
      </button>
      {canManage && order.estado === "borrador" && (
        <button type="button" onClick={() => onAction(order, "emitida")}>Emitir</button>
      )}
      {canManage && order.estado !== "cancelada" && (
        <button type="button" onClick={() => onAction(order, "cancelada")}>Cancelar</button>
      )}
      {canManage && order.estado !== "borrador" && (
        <button type="button" disabled={duplicating} onClick={() => onDuplicate(order)}>
          {duplicating ? "Creando copia..." : "Duplicar como borrador"}
        </button>
      )}
      {canManage && order.estado === "emitida" && (
        <button type="button" disabled={converting} onClick={() => onConvert(order)}>
          {order.compraId ? "Ver compra" : converting ? "Registrando..." : "Registrar compra"}
        </button>
      )}
    </div>
  );
}

export default function PurchaseOrdersPage({businessId, role}) {
  const navigate = useNavigate();
  const duplicateRequestIdsRef = useRef(new Map());
  const conversionRequestIdsRef = useRef(new Map());
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [duplicatingOrderId, setDuplicatingOrderId] = useState("");
  const [convertingOrderId, setConvertingOrderId] = useState("");
  const canManage = canManagePurchaseOrders(role);

  const load = () => {
    let current = true;
    setLoading(true);
    listarOrdenesCompra(businessId).then((results) => {
      if (current) setOrders(results);
    }).catch((error) => {
      if (current) setMessage(error.message);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  };

  useEffect(load, [businessId]);

  const filtered = useMemo(() => orders.filter((order) =>
    (status === "todos" || order.estado === status) &&
    matchesPurchaseOrderSearch(order, search)
  ), [orders, search, status]);

  const action = async (order, nextStatus) => {
    setMessage("");
    try {
      if (nextStatus === "cancelada" && !globalThis.confirm("¿Cancelar esta orden?")) return;
      if (nextStatus === "emitida") await emitirOrdenCompra(businessId, order.id);
      else await cancelarOrdenCompra(businessId, order.id);
      setOrders(await listarOrdenesCompra(businessId));
    } catch (error) {
      setMessage(error.message);
    }
  };

  const openOrder = (order) => navigate(
    order.estado === "borrador" && canManage
      ? `/ordenes-compra/${order.id}/editar`
      : `/ordenes-compra/${order.id}`
  );

  const duplicateOrder = async (order) => {
    if (!globalThis.confirm(
      "Se creará un nuevo documento editable. El original permanecerá sin cambios."
    )) return;
    const requestId = duplicateRequestIdsRef.current.get(order.id) ||
      createPurchaseOrderDuplicateRequestId();
    duplicateRequestIdsRef.current.set(order.id, requestId);
    setDuplicatingOrderId(order.id);
    setMessage("");
    try {
      const result = await duplicarOrdenCompraComoBorrador(
        businessId,
        order.id,
        {requestId}
      );
      duplicateRequestIdsRef.current.delete(order.id);
      navigate(`/ordenes-compra/${result.ordenCompra.id}/editar`, {
        state: {message: "Copia creada como borrador."},
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setDuplicatingOrderId("");
    }
  };

  const convertOrder = async (order) => {
    if (order.compraId) {
      navigate(`/compras/${order.compraId}`);
      return;
    }
    const requestId = conversionRequestIdsRef.current.get(order.id) ||
      createPurchaseRequestId("convertir-oc");
    conversionRequestIdsRef.current.set(order.id, requestId);
    setConvertingOrderId(order.id);
    setMessage("");
    try {
      const result = await crearCompraDesdeOrden(businessId, order.id, {requestId});
      conversionRequestIdsRef.current.delete(order.id);
      navigate(`/compras/${result.compra.id}/editar`, {
        state: {message: `Compra creada desde ${order.numero}.`},
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setConvertingOrderId("");
    }
  };

  return (
    <main className="erp-page po-history">
      <div className="erp-module-intro">
        <div className="erp-page-intro">
          <p>Administra las órdenes enviadas a proveedores.</p>
        </div>
        {canManage && <Button type="button" icon={Plus} onClick={() => navigate("/ordenes-compra/nueva")}>Nueva orden de compra</Button>}
      </div>

      {message && <p className="po-message">{message}</p>}

      <section className="erp-panel erp-history-panel" aria-labelledby="purchase-orders-list-title">
        <div className="erp-panel-header">
          <div>
            <h2 id="purchase-orders-list-title" className="erp-panel-title">Órdenes registradas</h2>
            <p className="erp-secondary-text">{filtered.length} {filtered.length === 1 ? "orden" : "órdenes"}</p>
          </div>
        </div>

        <div className="erp-filters erp-history-filters erp-history-filters--two po-history__toolbar no-print">
          <label className="erp-field erp-history-search-field">
            <span className="erp-field__label">Buscar por número, proveedor o RUT</span>
            <span className="clients-search-control">
              <AppIcon icon={Search} size={18} />
              <input className="erp-control" placeholder="Ej.: OC-2026-0001 o proveedor" value={search} onChange={(event) => setSearch(event.target.value)} />
            </span>
          </label>
          <label className="erp-field">
            <span className="erp-field__label">Estado</span>
            <select className="erp-control" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="todos">Todos los estados</option>
              <option value="borrador">Borradores</option>
              <option value="emitida">Emitidas</option>
              <option value="cancelada">Canceladas</option>
            </select>
          </label>
        </div>

        {loading ? <div className="erp-empty-state" role="status">Cargando órdenes...</div> : (
          <>
          <section className="erp-table-region po-history__desktop">
            <table className="erp-table po-history__table">
              <thead><tr><th>Número</th><th>Fecha</th><th>Proveedor</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {filtered.map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.numero}</strong></td>
                    <td>{dateLabel(order.creadoEn || order.fechaEmision)}</td>
                    <td><strong>{order.proveedorSnapshot.razonSocial}</strong><small>{order.proveedorSnapshot.rut}</small></td>
                    <td>{money(order.total)}</td>
                    <td><span className={`po-status po-status--${order.estado}`}>{labels[order.estado]}</span></td>
                    <td><OrderActions canManage={canManage} converting={convertingOrderId === order.id} duplicating={duplicatingOrderId === order.id} onAction={action} onConvert={convertOrder} onDuplicate={duplicateOrder} onOpen={openOrder} order={order} /></td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan="6" className="po-history__empty">No hay órdenes coincidentes.</td></tr>}
              </tbody>
            </table>
          </section>
          <section className="po-history__cards" aria-label="Órdenes de compra">
            {filtered.map((order) => (
              <article className="po-history-card" key={order.id}>
                <header>
                  <div>
                    <span className="po-history-card__label">Orden de compra</span>
                    <strong>{order.numero}</strong>
                  </div>
                  <span className={`po-status po-status--${order.estado}`}>
                    {labels[order.estado]}
                  </span>
                </header>
                <div className="po-history-card__provider">
                  <strong>{order.proveedorSnapshot.razonSocial}</strong>
                  <span>{order.proveedorSnapshot.rut || "Sin RUT"}</span>
                </div>
                <dl>
                  <div><dt>Fecha</dt><dd>{dateLabel(order.creadoEn || order.fechaEmision)}</dd></div>
                  <div><dt>Total</dt><dd>{money(order.total)}</dd></div>
                </dl>
                <OrderActions canManage={canManage} converting={convertingOrderId === order.id} duplicating={duplicatingOrderId === order.id} onAction={action} onConvert={convertOrder} onDuplicate={duplicateOrder} onOpen={openOrder} order={order} />
              </article>
            ))}
            {!filtered.length && <div className="po-history__cards-empty">No hay órdenes coincidentes.</div>}
          </section>
          </>
        )}
      </section>
    </main>
  );
}
