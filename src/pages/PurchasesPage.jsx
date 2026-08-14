import React, {useEffect, useMemo, useRef, useState} from "react";
import {Plus, Search} from "lucide-react";
import {useNavigate} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import {canManagePurchases, matchesPurchaseSearch} from "../domain/purchaseModel.mjs";
import {cancelarCompraBorrador, confirmarCompra, createPurchaseRequestId, listarCompras} from "../services/purchaseService";
import "../features/purchases/purchases.css";

const labels = {borrador: "Borrador", confirmada: "Confirmada", cancelada: "Cancelada"};
const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;
function Actions({canManage, onAction, onOpen, purchase, processing}) {
  return (
    <div className="po-history__actions">
      <button type="button" onClick={() => onOpen(purchase)}>{purchase.estado === "borrador" && canManage ? "Editar" : "Ver"}</button>
      {canManage && purchase.estado === "borrador" && (
        <>
          <button type="button" disabled={processing} onClick={() => onAction(purchase, "confirmar")}>Confirmar</button>
          <button type="button" disabled={processing} onClick={() => onAction(purchase, "cancelar")}>Cancelar</button>
        </>
      )}
    </div>
  );
}
export default function PurchasesPage({businessId, role}) {
  const navigate = useNavigate();
  const confirmIds = useRef(new Map());
  const [items, setItems] = useState([]); const [search, setSearch] = useState(""); const [status, setStatus] = useState("todos"); const [origin, setOrigin] = useState("todos"); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(true); const [processing, setProcessing] = useState("");
  const canManage = canManagePurchases(role);
  const load = async () => { setLoading(true); try { setItems(await listarCompras(businessId)); } catch (error) { setMessage(error.message); } finally { setLoading(false); } };
  useEffect(() => { let active = true; setLoading(true); listarCompras(businessId).then((values) => { if (active) setItems(values); }).catch((error) => { if (active) setMessage(error.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [businessId]);
  const filtered = useMemo(() => items.filter((item) => (status === "todos" || item.estado === status) && (origin === "todos" || (origin === "oc" ? item.ordenCompraId : !item.ordenCompraId)) && matchesPurchaseSearch(item, search)), [items, origin, search, status]);
  const action = async (purchase, type) => { const prompt = type === "confirmar" ? "Al confirmar la compra se actualizará el stock de los productos incluidos. Esta acción no podrá editarse posteriormente." : "¿Cancelar este borrador de compra?"; if (!globalThis.confirm(prompt)) return; setProcessing(purchase.id); setMessage(""); try { if (type === "confirmar") { const requestId = confirmIds.current.get(purchase.id) || createPurchaseRequestId("purchase-confirm"); confirmIds.current.set(purchase.id, requestId); const result = await confirmarCompra(businessId, purchase.id, {requestId}); confirmIds.current.delete(purchase.id); setMessage(result.productosActualizados ? "Compra confirmada. El inventario fue actualizado." : "Compra confirmada."); } else await cancelarCompraBorrador(businessId, purchase.id); await load(); } catch (error) { setMessage(error.message); } finally { setProcessing(""); } };
  const open = (purchase) => navigate(purchase.estado === "borrador" && canManage ? `/compras/${purchase.id}/editar` : `/compras/${purchase.id}`);
  return (
    <main className="erp-page po-history">
      <div className="erp-module-intro">
        <div className="erp-page-intro">
          <p>Registra y consulta compras y entradas de inventario.</p>
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
              <option value="borrador">Borradores</option>
              <option value="confirmada">Confirmadas</option>
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
              <thead><tr><th>Número</th><th>Fecha</th><th>Proveedor</th><th>Documento</th><th>Total</th><th>Origen</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {filtered.map((purchase) => (
                  <tr key={purchase.id}>
                    <td><strong>{purchase.numero}</strong></td>
                    <td>{purchase.fechaCompra || "—"}</td>
                    <td><strong>{purchase.proveedorSnapshot.razonSocial}</strong><small>{purchase.proveedorSnapshot.rut}</small></td>
                    <td>{purchase.tipoDocumento}<small>{purchase.numeroDocumentoProveedor || "Sin número"}</small></td>
                    <td>{money(purchase.total)}</td>
                    <td>{purchase.ordenCompraNumero || "Directa"}</td>
                    <td><span className={`po-status po-status--${purchase.estado}`}>{labels[purchase.estado]}</span></td>
                    <td><Actions canManage={canManage} onAction={action} onOpen={open} processing={processing === purchase.id} purchase={purchase} /></td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan="8" className="po-history__empty">No hay compras coincidentes.</td></tr>}
              </tbody>
            </table>
          </section>
          <section className="po-history__cards" aria-label="Compras">
            {filtered.map((purchase) => (
              <article className="po-history-card" key={purchase.id}>
                <header><div><span className="po-history-card__label">Compra</span><strong>{purchase.numero}</strong></div><span className={`po-status po-status--${purchase.estado}`}>{labels[purchase.estado]}</span></header>
                <div className="po-history-card__provider"><strong>{purchase.proveedorSnapshot.razonSocial}</strong><span>{purchase.proveedorSnapshot.rut || "Sin RUT"}</span></div>
                <dl><div><dt>Fecha</dt><dd>{purchase.fechaCompra || "—"}</dd></div><div><dt>Total</dt><dd>{money(purchase.total)}</dd></div><div><dt>Documento</dt><dd>{purchase.numeroDocumentoProveedor || "Sin documento"}</dd></div><div><dt>Origen</dt><dd>{purchase.ordenCompraNumero || "Directa"}</dd></div></dl>
                <Actions canManage={canManage} onAction={action} onOpen={open} processing={processing === purchase.id} purchase={purchase} />
              </article>
            ))}
            {!filtered.length && <div className="po-history__cards-empty">No hay compras coincidentes.</div>}
          </section>
          </>
        )}
      </section>
    </main>
  );
}
