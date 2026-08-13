import React, {useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {calculateSaleTotals, canManageSales, shouldReconcileSaleConfirmation} from "../domain/saleModel.mjs";
import SaleCatalogDialog from "../features/sales/SaleCatalogDialog";
import SaleClientSelector from "../features/sales/SaleClientSelector";
import SaleItemsEditor from "../features/sales/SaleItemsEditor";
import SalePrintView from "../features/sales/SalePrintView";
import SaleSummaryPanel from "../features/sales/SaleSummaryPanel";
import {listarClientes} from "../services/clientService";
import {getCompanyProfile} from "../services/companyService";
import {getInventoryItems} from "../services/inventoryService";
import {actualizarVentaBorrador, cancelarVentaBorrador, confirmarVenta, crearVenta, createSaleRequestId, obtenerVenta} from "../services/saleService";
import "../features/sales/sales.css";

const EMPTY_TOTALS = {subtotal: 0, descuentoItems: 0, descuento: 0, descuentoTotal: 0, neto: 0, afectaIva: true, tasaIva: 0.19, iva: 0, total: 0};
const today = () => new Intl.DateTimeFormat("en-CA", {timeZone: "America/Santiago"}).format(new Date());
const emptyDraft = () => ({clienteId: "", descuento: 0, afectaIva: true, fechaVenta: today(), fechaDocumento: "", tipoDocumento: "sin_documento", numeroDocumento: "", condicionesPago: "", observaciones: "", items: []});
const lineId = () => `linea-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export default function NewSalePage({businessId, role}) {
  const {ventaId} = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(emptyDraft);
  const [sale, setSale] = useState(null);
  const [clients, setClients] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [company, setCompany] = useState(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(() => location.state?.message || "");
  const createId = useRef(createSaleRequestId("sale-create"));
  const confirmId = useRef(createSaleRequestId("sale-confirm"));
  const pendingConfirmationSaleId = useRef("");
  const canManage = canManageSales(role);
  const readOnly = !canManage || Boolean(sale && sale.estado !== "borrador");
  const referencesLocked = Boolean(sale?.cotizacionId);
  const hasProducts = Boolean(
    sale?.items?.some((item) => item.tipoItem === "producto")
  );

  useEffect(() => { if (location.state?.message) setMessage(location.state.message); }, [location.state?.message]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([listarClientes(businessId), getInventoryItems(businessId), getCompanyProfile(businessId), ventaId ? obtenerVenta(businessId, ventaId) : null])
      .then(([clientList, itemList, profile, stored]) => {
        if (!active) return;
        setClients(clientList); setInventory(itemList); setCompany(profile); setSale(stored);
        if (ventaId && !stored) setMessage("La venta no existe.");
        else if (stored) setDraft({clienteId: stored.clienteId, descuento: stored.descuento, afectaIva: stored.afectaIva, fechaVenta: stored.fechaVenta, fechaDocumento: stored.fechaDocumento, tipoDocumento: stored.tipoDocumento, numeroDocumento: stored.numeroDocumento, condicionesPago: stored.condicionesPago, observaciones: stored.observaciones, cotizacionId: stored.cotizacionId, items: stored.items});
      }).catch((error) => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, ventaId]);

  const totals = useMemo(() => { try { return draft.items.length ? calculateSaleTotals(draft.items, draft.descuento, {afectaIva: draft.afectaIva}) : {...EMPTY_TOTALS, descuento: Number(draft.descuento || 0), afectaIva: draft.afectaIva !== false, tasaIva: draft.afectaIva === false ? 0 : 0.19}; } catch { return {...EMPTY_TOTALS, afectaIva: draft.afectaIva !== false, tasaIva: draft.afectaIva === false ? 0 : 0.19}; } }, [draft.afectaIva, draft.descuento, draft.items]);
  const printable = useMemo(() => ({...(sale || {}), ...draft, numero: sale?.numero || "Venta por asignar", clienteSnapshot: sale?.clienteId === draft.clienteId ? sale.clienteSnapshot : clients.find((client) => client.clienteId === draft.clienteId) || {}, ...totals}), [clients, draft, sale, totals]);
  const addItem = (item) => setDraft((current) => ({...current, items: [...current.items, {lineaId: lineId(), itemId: item.id, codigo: item.codigoInterno || item.sku || "", nombre: item.nombre, descripcion: item.descripcion || "", tipoItem: item.tipoItem || "producto", unidad: item.unidad || "unidad", cantidad: 1, precioUnitario: Number(item.precioInterno || 0), descuentoPct: 0}]}));
  const persist = async () => sale ? (await actualizarVentaBorrador(businessId, sale.id, draft)).venta : (await crearVenta(businessId, draft, {requestId: createId.current})).venta;

  const save = async () => { setProcessing(true); setMessage(""); try { const stored = await persist(); setSale(stored); pendingConfirmationSaleId.current = ""; createId.current = createSaleRequestId("sale-create"); setMessage("Borrador guardado."); if (!ventaId) navigate(`/ventas/${stored.id}/editar`, {replace: true, state: {message: "Borrador guardado."}}); } catch (error) { setMessage(error.message); } finally { setProcessing(false); } };
  const confirm = async () => {
    if (!globalThis.confirm("Al confirmar la venta se descontará del inventario el stock de los productos incluidos. Esta venta no podrá editarse posteriormente.")) return;
    setProcessing(true); setMessage("");
    let stored = sale;
    try {
      if (!stored || pendingConfirmationSaleId.current !== stored.id) {
        stored = await persist();
        setSale(stored);
      }
    } catch (error) {
      setMessage(error.message);
      setProcessing(false);
      return;
    }
    pendingConfirmationSaleId.current = stored.id;
    const finishConfirmation = (confirmedSale, productsUpdated) => {
      pendingConfirmationSaleId.current = "";
      confirmId.current = createSaleRequestId("sale-confirm");
      setSale(confirmedSale);
      const hasProducts = productsUpdated || confirmedSale.items?.some((item) => item.tipoItem === "producto");
      const success = hasProducts ? "Venta confirmada. El inventario fue actualizado." : "Venta confirmada.";
      setMessage(success);
      navigate(`/ventas/${confirmedSale.id}`, {replace: true, state: {message: success}});
    };
    try {
      const result = await confirmarVenta(businessId, stored.id, {requestId: confirmId.current});
      finishConfirmation(result.venta, result.productosActualizados);
    } catch (error) {
      if (!shouldReconcileSaleConfirmation(error)) {
        pendingConfirmationSaleId.current = "";
        setMessage(error.message);
        return;
      }
      try {
        const authoritative = await obtenerVenta(businessId, stored.id);
        if (authoritative?.estado === "confirmada" || authoritative?.stockAplicado === true) {
          finishConfirmation(authoritative);
        } else {
          if (authoritative) setSale(authoritative);
          setMessage(error.message);
        }
      } catch {
        setMessage(error.message);
      }
    } finally {
      setProcessing(false);
    }
  };
  const cancel = async () => { if (!sale || !globalThis.confirm("¿Cancelar este borrador de venta?")) return; setProcessing(true); try { const result = await cancelarVentaBorrador(businessId, sale.id); setSale(result.venta); setMessage("Venta cancelada."); navigate(`/ventas/${sale.id}`, {replace: true, state: {message: "Venta cancelada."}}); } catch (error) { setMessage(error.message); } finally { setProcessing(false); } };

  if (loading) return <p className="muted">Cargando venta...</p>;
  return <main className="po-workspace"><header className="po-header no-print"><div className="po-header__copy"><span className="po-kicker">Venta</span><div className="po-header__title-row"><h1>{sale ? "Venta" : "Nueva venta"}</h1><span className={`po-status po-status--${sale?.estado || "borrador"}`}>{sale?.estado || "Borrador"}</span></div><div className="po-header__meta"><strong>{sale?.numero || "Venta por asignar"}</strong><span>{draft.fechaVenta}</span></div></div><div className="po-header__actions"><button type="button" className="po-button po-button--secondary" onClick={() => navigate("/ventas")}>Volver al historial</button>{sale && <button type="button" className="po-button po-button--secondary" onClick={() => window.print()}>Imprimir</button>}</div></header>{message && <p className="po-message no-print">{message}</p>}{sale?.cotizacionId && <div className="sale-origin no-print"><div className="sale-origin__copy"><strong>Venta originada desde {sale.cotizacionNumero || "una cotización aceptada"}</strong><p>Esta venta se originó desde una cotización aceptada. Revísala y confírmala para completar la operación.{hasProducts ? " El stock de los productos se descuenta al confirmar." : ""}</p></div><button type="button" className="po-button po-button--secondary" onClick={() => navigate("/cotizaciones")}>Ver cotización</button></div>}{sale?.estado === "confirmada" && sale.stockAplicado && hasProducts && <p className="sale-stock-note no-print">Stock descontado al confirmar esta venta.</p>}<div className="no-print"><SaleClientSelector clients={clients} disabled={readOnly || referencesLocked} onChange={(clienteId) => setDraft((current) => ({...current, clienteId}))} originalSnapshot={sale?.clienteSnapshot} value={draft.clienteId} /><div className="po-layout"><div className="po-main"><SaleItemsEditor disabled={readOnly} inventory={inventory} items={draft.items} onChange={(items) => setDraft((current) => ({...current, items}))} onOpenCatalog={() => setCatalogOpen(true)} readOnly={Boolean(readOnly && sale)} referencesLocked={referencesLocked} /><details className="po-panel po-details" open><summary><span><strong>Documento</strong><small>{draft.numeroDocumento || "Sin documento asociado"}</small></span><span className="po-details__indicator" aria-hidden="true" /></summary>{readOnly ? <dl className="po-line__readonly"><div><dt>Tipo</dt><dd>{draft.tipoDocumento}</dd></div><div><dt>Número</dt><dd>{draft.numeroDocumento || "—"}</dd></div><div><dt>Fecha venta</dt><dd>{draft.fechaVenta}</dd></div><div><dt>Fecha documento</dt><dd>{draft.fechaDocumento || "—"}</dd></div></dl> : <div className="purchase-document-grid"><label>Tipo de documento<select value={draft.tipoDocumento} onChange={(event) => setDraft({...draft, tipoDocumento: event.target.value})}><option value="factura">Factura</option><option value="boleta">Boleta</option><option value="otro">Otro</option><option value="sin_documento">Sin documento</option></select></label><label>Número documento<input value={draft.numeroDocumento} onChange={(event) => setDraft({...draft, numeroDocumento: event.target.value})} /></label><label>Fecha venta<input type="date" value={draft.fechaVenta} onChange={(event) => setDraft({...draft, fechaVenta: event.target.value})} /></label><label>Fecha documento<input type="date" value={draft.fechaDocumento} onChange={(event) => setDraft({...draft, fechaDocumento: event.target.value})} /></label></div>}</details><details className="po-panel po-details"><summary><span><strong>Condiciones y observaciones</strong><small>{draft.condicionesPago || draft.observaciones || "Sin información adicional"}</small></span><span className="po-details__indicator" aria-hidden="true" /></summary>{readOnly ? <div className="purchase-document-grid"><p><strong>Condiciones</strong><br />{draft.condicionesPago || "—"}</p><p><strong>Observaciones</strong><br />{draft.observaciones || "—"}</p></div> : <div className="purchase-document-grid"><label className="purchase-field-wide">Condiciones de pago<textarea value={draft.condicionesPago} onChange={(event) => setDraft({...draft, condicionesPago: event.target.value})} /></label><label className="purchase-field-wide">Observaciones<textarea value={draft.observaciones} onChange={(event) => setDraft({...draft, observaciones: event.target.value})} /></label></div>}</details><details className="po-panel po-details"><summary><span><strong>Vista previa imprimible</strong><small>Documento listo para impresión</small></span><span className="po-details__indicator" aria-hidden="true" /></summary><SalePrintView company={company} sale={printable} /></details></div><SaleSummaryPanel disabled={readOnly} onCancel={sale ? cancel : null} onConfirm={confirm} onSave={save} processing={processing} totals={totals} /></div></div><div className="print-only"><SalePrintView company={company} sale={printable} /></div><SaleCatalogDialog items={inventory} onAdd={addItem} onClose={() => setCatalogOpen(false)} open={catalogOpen} /></main>;
}
