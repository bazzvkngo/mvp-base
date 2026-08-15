import React, {useEffect, useMemo, useState} from "react";
import {Ellipsis, Plus, Search} from "lucide-react";
import {useNavigate} from "react-router-dom";
import {sileo} from "sileo";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {
  canManageSales,
  getSaleDocumentTypeLabel,
  getSaleStatusLabel,
  matchesSaleSearch,
} from "../domain/saleModel.mjs";
import {cancelarVentaBorrador, listarVentas} from "../services/saleService";
import {formatDate, formatMoney} from "../utils/formatters";
import "../features/sales/sales.css";

const money = (value, document) => formatMoney(value, document?.moneda, document?.locale);

function Actions({canManage, onAction, processing, sale}) {
  const prepared = sale.estado === "borrador" && canManage;
  if (!prepared) return <span className="sale-history-no-actions">—</span>;

  return (
    <div className="po-history__actions sale-history-actions">
      <details className="sale-more-actions sale-more-actions--history">
        <summary><span>Más acciones</span><AppIcon icon={Ellipsis} size={17} /></summary>
        <button type="button" disabled={processing} onClick={() => onAction(sale)}>Cancelar venta</button>
      </details>
    </div>
  );
}

export default function SalesPage({businessId, role}) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [origin, setOrigin] = useState("todos");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [actionTarget, setActionTarget] = useState(null);
  const canManage = canManageSales(role);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await listarVentas(businessId));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    listarVentas(businessId)
      .then((values) => { if (active) setItems(values); })
      .catch((error) => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId]);

  const filtered = useMemo(() => items.filter((item) => (
    (status === "todos" || item.estado === status)
    && (origin === "todos" || (origin === "cotizacion" ? item.cotizacionId : !item.cotizacionId))
    && matchesSaleSearch(item, search)
  )), [items, origin, search, status]);

  const action = async () => {
    if (!actionTarget) return;
    const sale = actionTarget;
    setProcessing(sale.id);
    setMessage("");
    try {
      await cancelarVentaBorrador(businessId, sale.id);
      sileo.success({title: "Venta cancelada", description: `${sale.numero} quedó cancelada.`});
      setActionTarget(null);
      await load();
    } catch (error) {
      setMessage(error.message);
      sileo.error({title: "No se pudo cancelar la venta", description: error.message});
    } finally {
      setProcessing("");
    }
  };

  const open = (sale) => navigate(sale.estado === "borrador" && canManage ? `/ventas/${sale.id}/editar` : `/ventas/${sale.id}`);
  const openOriginQuote = (sale) => navigate(`/cotizaciones/${sale.cotizacionId}/editar`);

  return (
    <main className="erp-page po-history sale-history">
      <div className="erp-module-intro">
        <div className="erp-page-intro">
          <p>Administra ventas preparadas, confirmadas y canceladas del negocio.</p>
        </div>
        {canManage && <Button type="button" icon={Plus} onClick={() => navigate("/ventas/nueva")}>Nueva venta</Button>}
      </div>

      {message && <p className="po-message po-message--error">{message}</p>}

      <section className="erp-panel erp-history-panel sale-history-panel" aria-labelledby="sales-history-title">
        <div className="erp-panel-header">
          <div>
            <h2 id="sales-history-title" className="erp-panel-title">Ventas registradas</h2>
            <p className="erp-secondary-text">{filtered.length} {filtered.length === 1 ? "venta" : "ventas"}</p>
          </div>
        </div>

        <div className="erp-filters erp-history-filters erp-history-filters--three po-history__toolbar sale-history-filters no-print">
          <label className="erp-field erp-history-search-field sale-history-search-field">
            <span className="erp-field__label">Buscar por número, cliente, RUT o documento</span>
            <span className="sale-history-search-control">
              <AppIcon icon={Search} size={18} />
              <input className="erp-control" placeholder="Ej.: VTA-2026-0001 o cliente" value={search} onChange={(event) => setSearch(event.target.value)} />
            </span>
          </label>
          <label className="erp-field">
            <span className="erp-field__label">Estado</span>
            <select className="erp-control" value={status} onChange={(event) => setStatus(event.target.value)}><option value="todos">Todos los estados</option><option value="borrador">Preparadas</option><option value="confirmada">Confirmadas</option><option value="cancelada">Canceladas</option></select>
          </label>
          <label className="erp-field">
            <span className="erp-field__label">Origen</span>
            <select className="erp-control" value={origin} onChange={(event) => setOrigin(event.target.value)}><option value="todos">Todos los orígenes</option><option value="directa">Directas</option><option value="cotizacion">Desde cotización</option></select>
          </label>
        </div>

        {loading ? <div className="erp-empty-state" role="status">Cargando ventas...</div> : (
          <>
          <section className="erp-table-region po-history__desktop">
            <table className="erp-table clients-table po-history__table sale-history-table">
              <thead><tr><th>Número</th><th>Cliente</th><th>Documento</th><th>Total</th><th>Origen</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {filtered.map((sale) => (
                  <tr key={sale.id}>
                    <td><div className="sale-history-number"><button type="button" className="sale-history-link" onClick={() => open(sale)}>{sale.numero}</button><small className="clients-table__secondary">{formatDate(sale.fechaVenta)}</small></div></td>
                    <td><strong className="clients-table__name">{sale.clienteSnapshot.nombreRazonSocial}</strong><small className="clients-table__secondary">{sale.clienteSnapshot.rut}</small></td>
                    <td>{getSaleDocumentTypeLabel(sale.tipoDocumento)}{sale.tipoDocumento !== "sin_documento" && <small>{sale.numeroDocumento || "Sin número"}</small>}</td>
                    <td className="sale-history-total">{money(sale.total, sale)}</td>
                    <td>{sale.cotizacionId ? <button type="button" className="sale-history-link sale-origin-link" onClick={() => openOriginQuote(sale)}>{sale.cotizacionNumero || "Ver cotización"}</button> : "Directa"}</td>
                    <td><span className={`po-status po-status--${sale.estado}`}>{getSaleStatusLabel(sale.estado)}</span></td>
                    <td><Actions canManage={canManage} onAction={setActionTarget} processing={processing === sale.id} sale={sale} /></td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan="7" className="po-history__empty">No hay ventas coincidentes.</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="po-history__cards" aria-label="Ventas">
            {filtered.map((sale) => (
              <article className="erp-record-card po-history-card" key={sale.id}>
                <header>
                  <div><span className="po-history-card__label">Venta</span><button type="button" className="sale-history-link" onClick={() => open(sale)}>{sale.numero}</button><span className="sale-history-card__date">{formatDate(sale.fechaVenta)}</span></div>
                  <span className={`po-status po-status--${sale.estado}`}>{getSaleStatusLabel(sale.estado)}</span>
                </header>
                <div className="po-history-card__provider"><strong>{sale.clienteSnapshot.nombreRazonSocial}</strong><span>{sale.clienteSnapshot.rut || "Sin RUT"}</span></div>
                <dl><div><dt>Total</dt><dd>{money(sale.total)}</dd></div><div><dt>Documento</dt><dd>{sale.tipoDocumento === "sin_documento" ? "Sin documento" : sale.numeroDocumento || getSaleDocumentTypeLabel(sale.tipoDocumento)}</dd></div><div><dt>Origen</dt><dd>{sale.cotizacionId ? <button type="button" className="sale-history-link sale-origin-link" onClick={() => openOriginQuote(sale)}>{sale.cotizacionNumero || "Ver cotización"}</button> : "Directa"}</dd></div></dl>
                <Actions canManage={canManage} onAction={setActionTarget} processing={processing === sale.id} sale={sale} />
              </article>
            ))}
            {!filtered.length && <div className="po-history__cards-empty">No hay ventas coincidentes.</div>}
          </section>
          </>
        )}
      </section>

      <ResponsiveDialog
        open={Boolean(actionTarget)}
        onClose={() => !processing && setActionTarget(null)}
        eyebrow="Más acciones"
        title="Cancelar venta"
        description="La venta preparada quedará cancelada y ya no podrá editarse."
        size="small"
        footer={<><button type="button" className="po-button po-button--secondary" disabled={Boolean(processing)} onClick={() => setActionTarget(null)}>Volver</button><button type="button" className="po-button po-button--danger" disabled={Boolean(processing)} onClick={action}>{processing ? "Cancelando..." : "Cancelar venta"}</button></>}
      >
        <p className="sale-dialog-copy">Esta acción no descuenta stock.</p>
      </ResponsiveDialog>
    </main>
  );
}
