import React, {useEffect, useMemo, useRef, useState} from "react";
import {Plus, Search} from "lucide-react";
import {useNavigate} from "react-router-dom";
import {sileo} from "sileo";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {formatMoney} from "../utils/formatters";
import {canManagePurchases, getPurchaseDocumentTypeLabel, getPurchaseStockSemantics, getPurchaseStatusLabel, matchesPurchaseSearch} from "../domain/purchaseModel.mjs";
import {cancelarCompraBorrador, confirmarCompra, createPurchaseRequestId, listarCompras, revertirCompra} from "../services/purchaseService";
import "../features/purchases/purchases.css";

const money = (value, document) => formatMoney(value, document?.moneda, document?.locale);
function Actions({canManage, onAction, purchase, processing}) {
  return (
    <div className="po-history__actions">
      {canManage && purchase.estado === "borrador" && (
        <>
          <button type="button" disabled={processing} onClick={() => onAction(purchase, "confirmar")}>Confirmar</button>
          <details className="po-more-actions"><summary>Más acciones ···</summary><div><button type="button" disabled={processing} onClick={() => onAction(purchase, "cancelar")}>Cancelar compra</button></div></details>
        </>
      )}
      {canManage && purchase.estado === "confirmada" && (
        <button type="button" disabled={processing} onClick={() => onAction(purchase, "revertir")}>Revertir compra</button>
      )}
    </div>
  );
}
export default function PurchasesPage({businessId, role}) {
  const navigate = useNavigate();
  const confirmIds = useRef(new Map());
  const reversalIds = useRef(new Map());
  const [items, setItems] = useState([]); const [search, setSearch] = useState(""); const [status, setStatus] = useState("todos"); const [origin, setOrigin] = useState("todos"); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(true); const [processing, setProcessing] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [reversalReason, setReversalReason] = useState("");
  const canManage = canManagePurchases(role);
  const load = async () => { setLoading(true); try { setItems(await listarCompras(businessId)); } catch (error) { setMessage(error.message); } finally { setLoading(false); } };
  useEffect(() => { let active = true; setLoading(true); listarCompras(businessId).then((values) => { if (active) setItems(values); }).catch((error) => { if (active) setMessage(error.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [businessId]);
  const filtered = useMemo(() => items.filter((item) => (status === "todos" || item.estado === status) && (origin === "todos" || (origin === "oc" ? item.ordenCompraId : !item.ordenCompraId)) && matchesPurchaseSearch(item, search)), [items, origin, search, status]);
  const action = (purchase, type) => { setReversalReason(""); setPendingAction({purchase, type}); };
  const executeAction = async () => {
    const {purchase, type} = pendingAction || {};
    if (!purchase) return;
    if (type === "revertir" && !reversalReason.trim()) {
      setMessage("El motivo de reversión es obligatorio.");
      return;
    }
    setProcessing(purchase.id); setMessage("");
    try {
      if (type === "confirmar") {
        const requestId = confirmIds.current.get(purchase.id) || createPurchaseRequestId("purchase-confirm");
        confirmIds.current.set(purchase.id, requestId);
        const result = await confirmarCompra(businessId, purchase.id, {requestId});
        confirmIds.current.delete(purchase.id);
        sileo.success({
          title: "Compra confirmada",
          description: getPurchaseStockSemantics({
            ...purchase,
            ...result.compra,
            productosActualizados: result.productosActualizados,
          }).confirmationResultMessage,
        });
      } else if (type === "revertir") {
        const requestId = reversalIds.current.get(purchase.id) || createPurchaseRequestId("purchase-reversal");
        reversalIds.current.set(purchase.id, requestId);
        const result = await revertirCompra(businessId, purchase.id, reversalReason.trim(), {requestId});
        reversalIds.current.delete(purchase.id);
        sileo.success({title: "Compra revertida", description: result.productosRevertidos ? "Los movimientos de inventario fueron compensados." : "La compra quedó revertida sin movimientos físicos."});
      } else {
        await cancelarCompraBorrador(businessId, purchase.id);
        sileo.success({title: "Compra cancelada", description: `${purchase.numero} quedó cancelada sin modificar stock.`});
      }
      setPendingAction(null); setReversalReason(""); await load();
    } catch (error) {
      setMessage(error.message);
      const title = type === "confirmar" ? "No se pudo confirmar la compra" : type === "revertir" ? "No se pudo revertir la compra" : "No se pudo cancelar la compra";
      sileo.error({title, description: error.message});
    } finally { setProcessing(""); }
  };
  const open = (purchase) => navigate(purchase.estado === "borrador" && canManage ? `/compras/${purchase.id}/editar` : `/compras/${purchase.id}`);
  return (
    <main className="erp-page po-history">
      <div className="erp-module-intro">
        <div className="erp-page-intro">
          <p>Registra compras directas y documentos económicos derivados de Recepciones. Confirmar una Compra V3 directa incrementa stock; una Compra de Recepción no lo duplica.</p>
        </div>
        {canManage && <Button type="button" icon={Plus} onClick={() => navigate("/compras/nueva")}>Nueva compra</Button>}
      </div>

      {message && <p className="po-message">{message}</p>}

      <section className="erp-panel erp-history-panel" aria-labelledby="purchases-list-title">
        <div className="erp-panel-header">
          <div>
            <h2 id="purchases-list-title" className="erp-panel-title">Compras registradas</h2>
            <p className="erp-secondary-text">{filtered.length} {filtered.length === 1 ? "compra" : "compras"}</p>
          </div>
        </div>

        <div className="erp-filters erp-history-filters erp-history-filters--three po-history__toolbar no-print">
          <label className="erp-field erp-history-search-field">
            <span className="erp-field__label">Buscar por número, proveedor, RUT o documento</span>
            <span className="clients-search-control">
              <AppIcon icon={Search} size={18} />
              <input className="erp-control" placeholder="Ej.: COM-2026-0001 o proveedor" value={search} onChange={(event) => setSearch(event.target.value)} />
            </span>
          </label>
          <label className="erp-field">
            <span className="erp-field__label">Estado</span>
            <select className="erp-control" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="todos">Todos los estados</option>
              <option value="borrador">Preparadas</option>
              <option value="confirmada">Confirmadas</option>
              <option value="revertida">Revertidas</option>
              <option value="cancelada">Canceladas</option>
            </select>
          </label>
          <label className="erp-field">
            <span className="erp-field__label">Origen</span>
            <select className="erp-control" value={origin} onChange={(event) => setOrigin(event.target.value)}>
              <option value="todos">Todos los orígenes</option>
              <option value="directa">Directas</option>
              <option value="oc">Desde OC</option>
            </select>
          </label>
        </div>

        {loading ? <div className="erp-empty-state" role="status">Cargando compras...</div> : (
          <>
          <section className="erp-table-region po-history__desktop">
            <table className="erp-table po-history__table">
              <thead><tr><th>Compra</th><th>Proveedor</th><th>Documento</th><th>Total</th><th>Origen</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {filtered.map((purchase) => (
                  <tr key={purchase.id}>
                    <td><button type="button" className="po-inline-link" onClick={() => open(purchase)}>{purchase.numero}</button><small>{purchase.fechaCompra || "—"}</small></td>
                    <td><strong>{purchase.proveedorSnapshot.razonSocial}</strong><small>{purchase.proveedorSnapshot.rut}</small></td>
                    <td>{getPurchaseDocumentTypeLabel(purchase.tipoDocumento)}<small>{purchase.tipoDocumento === "sin_documento" ? "" : purchase.numeroDocumentoProveedor || "Sin número"}</small></td>
                    <td>{money(purchase.total, purchase)}</td>
                    <td>{purchase.recepcionId ? <button type="button" className="po-inline-link" onClick={() => navigate(`/recepciones/${purchase.recepcionId}`)}>{purchase.recepcionNumero || "Abrir recepción"}</button> : purchase.ordenCompraId ? <button type="button" className="po-inline-link" onClick={() => navigate(`/ordenes-compra/${purchase.ordenCompraId}`)}>{purchase.ordenCompraNumero || "Abrir OC"}</button> : "Directa"}</td>
                    <td><span className={`po-status po-status--${purchase.estado}`}>{getPurchaseStatusLabel(purchase.estado)}</span></td>
                    <td><Actions canManage={canManage} onAction={action} processing={processing === purchase.id} purchase={purchase} /></td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan="7" className="po-history__empty">No hay compras coincidentes.</td></tr>}
              </tbody>
            </table>
          </section>
          <section className="po-history__cards" aria-label="Compras">
            {filtered.map((purchase) => (
              <article className="po-history-card" key={purchase.id}>
                <header><div><span className="po-history-card__label">Compra</span><button type="button" className="po-inline-link" onClick={() => open(purchase)}>{purchase.numero}</button></div><span className={`po-status po-status--${purchase.estado}`}>{getPurchaseStatusLabel(purchase.estado)}</span></header>
                <div className="po-history-card__provider"><strong>{purchase.proveedorSnapshot.razonSocial}</strong><span>{purchase.proveedorSnapshot.rut || "Sin RUT"}</span></div>
                <dl><div><dt>Fecha</dt><dd>{purchase.fechaCompra || "—"}</dd></div><div><dt>Total</dt><dd>{money(purchase.total)}</dd></div><div><dt>Documento</dt><dd>{purchase.tipoDocumento === "sin_documento" ? "Sin documento" : purchase.numeroDocumentoProveedor || getPurchaseDocumentTypeLabel(purchase.tipoDocumento)}</dd></div><div><dt>Origen</dt><dd>{purchase.recepcionId ? <button type="button" className="po-inline-link" onClick={() => navigate(`/recepciones/${purchase.recepcionId}`)}>{purchase.recepcionNumero || "Abrir recepción"}</button> : purchase.ordenCompraId ? <button type="button" className="po-inline-link" onClick={() => navigate(`/ordenes-compra/${purchase.ordenCompraId}`)}>{purchase.ordenCompraNumero || "Abrir OC"}</button> : "Directa"}</dd></div></dl>
                <Actions canManage={canManage} onAction={action} processing={processing === purchase.id} purchase={purchase} />
              </article>
            ))}
            {!filtered.length && <div className="po-history__cards-empty">No hay compras coincidentes.</div>}
          </section>
          </>
        )}
      </section>
      <ResponsiveDialog open={Boolean(pendingAction)} onClose={() => !processing && setPendingAction(null)} eyebrow={pendingAction?.type === "confirmar" ? "Compra preparada" : "Más acciones"} title={pendingAction?.type === "confirmar" ? "Confirmar compra" : pendingAction?.type === "revertir" ? "Revertir compra" : "Cancelar compra"} description={pendingAction?.type === "confirmar" ? "Revisa el efecto físico de este documento antes de confirmar." : pendingAction?.type === "revertir" ? "Esta acción revertirá los movimientos de inventario asociados y conservará el registro histórico." : "La compra preparada quedará cancelada sin modificar stock."} size="small" footer={<><Button type="button" variant="secondary" disabled={Boolean(processing)} onClick={() => setPendingAction(null)}>Volver</Button><Button type="button" variant={pendingAction?.type === "confirmar" ? "primary" : "danger"} disabled={Boolean(processing) || (pendingAction?.type === "revertir" && !reversalReason.trim())} onClick={executeAction}>{processing ? "Procesando..." : pendingAction?.type === "confirmar" ? "Confirmar compra" : pendingAction?.type === "revertir" ? "Revertir compra" : "Cancelar compra"}</Button></>}>{pendingAction?.type === "revertir" ? <label className="purchase-field-wide">Motivo de reversión *<textarea value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} /></label> : <p>{pendingAction?.type === "confirmar" ? getPurchaseStockSemantics(pendingAction.purchase).confirmationMessage : "Esta acción no se puede deshacer."}</p>}</ResponsiveDialog>
    </main>
  );
}
