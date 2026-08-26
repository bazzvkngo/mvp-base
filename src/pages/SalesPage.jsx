import React, {useEffect, useMemo, useState} from "react";
import {Plus, Search} from "lucide-react";
import {useNavigate} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import {
  canManageSales,
  getSaleStatusLabel,
  getSaleStockStatusLabel,
  matchesSaleSearch,
} from "../domain/saleModel.mjs";
import {listarVentas} from "../services/saleService";
import {formatDate, formatMoney} from "../utils/formatters";
import "../features/sales/sales.css";

const money = (value, document) => formatMoney(value, document?.moneda, document?.locale);

export default function SalesPage({businessId, role}) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [origin, setOrigin] = useState("todos");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const canManage = canManageSales(role);

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

  const open = (sale) => navigate(sale.estado === "borrador" && canManage ? `/ventas/${sale.id}/editar` : `/ventas/${sale.id}`);
  const openOriginQuote = (sale) => navigate(`/cotizaciones/${sale.cotizacionId}/editar`);

  return (
    <main className="erp-page po-history sale-history">
      <div className="erp-module-intro">
        <div className="erp-page-intro">
            <p>Consulta el historial de ventas directas y originadas desde cotizaciones.</p>
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
              <thead><tr><th>Número</th><th>Cliente</th><th>Total</th><th>Origen</th><th>Estado</th><th>Stock</th><th>Fecha</th></tr></thead>
              <tbody>
                {filtered.map((sale) => (
                  <tr key={sale.id}>
                    <td><div className="sale-history-number"><button type="button" className="sale-history-link" onClick={() => open(sale)}>{sale.numero}</button></div></td>
                    <td><strong className="clients-table__name">{sale.clienteSnapshot.nombreRazonSocial}</strong><small className="clients-table__secondary">{sale.clienteSnapshot.rut}</small></td>
                    <td className="sale-history-total">{money(sale.total, sale)}</td>
                    <td>{sale.cotizacionId ? <button type="button" className="sale-history-link sale-origin-link" onClick={() => openOriginQuote(sale)}>{sale.cotizacionNumero || "Ver cotización"}</button> : "Directa"}</td>
                    <td><span className={`po-status po-status--${sale.estado}`}>{getSaleStatusLabel(sale.estado)}</span></td>
                    <td>{getSaleStockStatusLabel(sale.estadoStock, sale)}</td>
                    <td>{formatDate(sale.fechaVenta)}</td>
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
                <dl><div><dt>Total</dt><dd>{money(sale.total, sale)}</dd></div><div><dt>Origen</dt><dd>{sale.cotizacionId ? <button type="button" className="sale-history-link sale-origin-link" onClick={() => openOriginQuote(sale)}>{sale.cotizacionNumero || "Ver cotización"}</button> : "Directa"}</dd></div><div><dt>Stock</dt><dd>{getSaleStockStatusLabel(sale.estadoStock, sale)}</dd></div><div><dt>Fecha</dt><dd>{formatDate(sale.fechaVenta)}</dd></div></dl>
              </article>
            ))}
            {!filtered.length && <div className="po-history__cards-empty">No hay ventas coincidentes.</div>}
          </section>
          </>
        )}
      </section>
    </main>
  );
}
