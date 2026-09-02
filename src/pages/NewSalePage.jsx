import React, {useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {sileo} from "sileo";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {
  calculateSaleTotals,
  canManageSales,
  getSaleDocumentTypeLabel,
  getSaleStatusLabel,
  getSaleStockStatusLabel,
  shouldReconcileSaleConfirmation,
} from "../domain/saleModel.mjs";
import SaleCatalogDialog from "../features/sales/SaleCatalogDialog";
import SaleClientSelector from "../features/sales/SaleClientSelector";
import SaleCommercialMarginPanel from "../features/sales/SaleCommercialMarginPanel";
import SaleItemsEditor from "../features/sales/SaleItemsEditor";
import SalePrintView from "../features/sales/SalePrintView";
import SaleSummaryPanel from "../features/sales/SaleSummaryPanel";
import {listarClientes} from "../services/clientService";
import {getCompanyProfile} from "../services/companyService";
import {getInventoryItems} from "../services/inventoryService";
import {formatDate} from "../utils/formatters";
import {
  actualizarVentaBorrador,
  cancelarVenta,
  confirmarVenta,
  crearVenta,
  createSaleRequestId,
  obtenerVenta,
} from "../services/saleService";
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
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const createId = useRef(createSaleRequestId("sale-create"));
  const confirmId = useRef(createSaleRequestId("sale-confirm"));
  const cancelId = useRef(createSaleRequestId("sale-cancel"));
  const pendingConfirmationSaleId = useRef("");
  const canManage = canManageSales(role);
  const readOnly = !canManage || Boolean(sale && sale.estado !== "borrador");
  const isSaleDetailRoute = Boolean(ventaId) && !/\/editar\/?$/.test(location.pathname);
  const referencesLocked = Boolean(sale?.cotizacionId);
  const canCancelConfirmedQuote = Boolean(
    canManage && sale?.cotizacionId && sale?.estado === "confirmada"
  );
  const hasProducts = draft.items.some((item) => item.tipoItem === "producto");

  useEffect(() => {
    setConditionsOpen(false);
    setPreviewOpen(false);
  }, [ventaId]);

  useEffect(() => {
    const toastTitle = location.state?.toastTitle;
    if (!toastTitle) return;
    sileo.success({title: toastTitle, description: location.state?.toastDescription});
    navigate(location.pathname, {replace: true, state: null});
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      listarClientes(businessId),
      getInventoryItems(businessId),
      getCompanyProfile(businessId),
      ventaId ? obtenerVenta(businessId, ventaId) : null,
    ])
      .then(([clientList, itemList, profile, stored]) => {
        if (!active) return;
        setClients(clientList);
        setInventory(itemList);
        setCompany(profile);
        setSale(stored);
        if (ventaId && !stored) {
          setMessage("La venta no existe.");
        } else if (stored) {
          setDraft({
            clienteId: stored.clienteId,
            descuento: stored.descuento,
            afectaIva: stored.afectaIva,
            fechaVenta: stored.fechaVenta,
            fechaDocumento: stored.fechaDocumento,
            tipoDocumento: stored.tipoDocumento,
            numeroDocumento: stored.numeroDocumento,
            condicionesPago: stored.condicionesPago,
            observaciones: stored.observaciones,
            cotizacionId: stored.cotizacionId,
            items: stored.items,
          });
        }
      })
      .catch((error) => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, ventaId]);

  const totals = useMemo(() => {
    try {
      return draft.items.length
        ? calculateSaleTotals(draft.items, draft.descuento, {
            afectaIva: draft.afectaIva,
            tasaIva: sale?.tasaIva ?? Number(company?.impuestoPredeterminadoTasa ?? 19) / 100,
          })
        : {...EMPTY_TOTALS, descuento: Number(draft.descuento || 0), afectaIva: draft.afectaIva !== false, tasaIva: draft.afectaIva === false ? 0 : 0.19};
    } catch {
      return {...EMPTY_TOTALS, afectaIva: draft.afectaIva !== false, tasaIva: draft.afectaIva === false ? 0 : 0.19};
    }
  }, [company?.impuestoPredeterminadoTasa, draft.afectaIva, draft.descuento, draft.items, sale?.tasaIva]);

  const hasInsufficientStock = useMemo(() => {
    const inventoryById = new Map(inventory.map((item) => [item.id, item]));
    return draft.items.some((item) => {
      if (item.tipoItem !== "producto") return false;
      const inventoryItem = inventoryById.get(item.itemId);
      const available = inventoryItem ? Number(inventoryItem.stock) : Number.NaN;
      return Number.isFinite(available) && Number(item.cantidad || 0) > available;
    });
  }, [draft.items, inventory]);

  const printable = useMemo(() => ({
    ...(sale || {}),
    ...draft,
    numero: sale?.numero || "Venta por asignar",
    paisCodigo: sale?.paisCodigo || company?.paisCodigo || "CL",
    moneda: sale?.moneda || company?.monedaCodigo || "CLP",
    locale: sale?.locale || company?.locale || "es-CL",
    impuestoNombre: sale?.impuestoNombre || company?.impuestoPredeterminadoNombre || "IVA",
    tasaIva: sale?.tasaIva ?? Number(company?.impuestoPredeterminadoTasa ?? 19) / 100,
    clienteSnapshot: sale?.clienteId === draft.clienteId
      ? sale.clienteSnapshot
      : clients.find((client) => client.clienteId === draft.clienteId) || {},
    ...totals,
  }), [clients, company, draft, sale, totals]);

  const addItem = (item) => setDraft((current) => ({
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
      precioUnitario: Number(item.precioInterno || 0),
      descuentoPct: 0,
    }],
  }));

  const persist = async () => sale
    ? (await actualizarVentaBorrador(businessId, sale.id, draft)).venta
    : (await crearVenta(businessId, draft, {requestId: createId.current})).venta;

  const save = async () => {
    setProcessing(true);
    setMessage("");
    try {
      const stored = await persist();
      setSale(stored);
      pendingConfirmationSaleId.current = "";
      createId.current = createSaleRequestId("sale-create");
      if (!ventaId) {
        navigate(`/ventas/${stored.id}/editar`, {
          replace: true,
          state: {toastTitle: "Venta actualizada", toastDescription: `${stored.numero} quedó preparada para confirmar.`},
        });
      } else {
        sileo.success({title: "Venta actualizada", description: `${stored.numero} continúa preparada para confirmar.`});
      }
    } catch (error) {
      setMessage(error.message);
      sileo.error({title: "No se pudo guardar la venta", description: error.message});
    } finally {
      setProcessing(false);
    }
  };

  const confirm = async () => {
    setActionDialog("");
    if (hasInsufficientStock) return;
    setProcessing(true);
    setMessage("");
    let stored = sale;
    try {
      if (!stored || pendingConfirmationSaleId.current !== stored.id) {
        stored = await persist();
        setSale(stored);
      }
    } catch (error) {
      setMessage(error.message);
      sileo.error({title: "No se pudo preparar la venta", description: error.message});
      setProcessing(false);
      return;
    }
    pendingConfirmationSaleId.current = stored.id;
    const finishConfirmation = (confirmedSale, productsUpdated) => {
      pendingConfirmationSaleId.current = "";
      confirmId.current = createSaleRequestId("sale-confirm");
      setSale(confirmedSale);
      navigate(`/ventas/${confirmedSale.id}`, {
        replace: true,
        state: {
          toastTitle: "Venta confirmada",
          toastDescription: productsUpdated || confirmedSale.items?.some((item) => item.tipoItem === "producto")
            ? "La venta fue registrada y se actualizó el stock de sus productos."
            : "La venta fue registrada correctamente.",
        },
      });
    };
    try {
      const result = await confirmarVenta(businessId, stored.id, {requestId: confirmId.current});
      finishConfirmation(result.venta, result.productosActualizados);
    } catch (error) {
      if (!shouldReconcileSaleConfirmation(error)) {
        pendingConfirmationSaleId.current = "";
        setMessage(error.message);
        sileo.error({title: "No se pudo confirmar la venta", description: error.message});
        return;
      }
      try {
        const authoritative = await obtenerVenta(businessId, stored.id);
        if (authoritative?.estado === "confirmada" || authoritative?.stockAplicado === true) {
          finishConfirmation(authoritative);
        } else {
          if (authoritative) setSale(authoritative);
          setMessage(error.message);
          sileo.error({title: "No se pudo confirmar la venta", description: error.message});
        }
      } catch {
        setMessage(error.message);
        sileo.error({title: "No se pudo confirmar la venta", description: error.message});
      }
    } finally {
      setProcessing(false);
    }
  };

  const cancel = async () => {
    if (!sale) return;
    const motivo = cancelReason.trim();
    if (motivo.length < 3) {
      setMessage("Ingresa el motivo de cancelación.");
      return;
    }
    setProcessing(true);
    setMessage("");
    try {
      const result = await cancelarVenta(businessId, sale.id, motivo, {requestId: cancelId.current});
      setSale(result.venta);
      setActionDialog("");
      setCancelReason("");
      cancelId.current = createSaleRequestId("sale-cancel");
      navigate(`/ventas/${sale.id}`, {
        replace: true,
        state: {toastTitle: "Venta cancelada", toastDescription: `${sale.numero} quedó cancelada.`},
      });
    } catch (error) {
      setMessage(error.message);
      sileo.error({title: "No se pudo cancelar la venta", description: error.message});
    } finally {
      setProcessing(false);
    }
  };

  const changeDocumentType = (tipoDocumento) => setDraft((current) => ({
    ...current,
    tipoDocumento,
    ...(tipoDocumento === "sin_documento" ? {numeroDocumento: "", fechaDocumento: ""} : {}),
  }));

  const stockStatusMessage = sale?.estado !== "confirmada"
    ? ""
    : sale.alertasStock?.length
      ? `${getSaleStockStatusLabel(sale.estadoStock, sale)}. ${sale.alertasStock.map((alert) => `${alert.nombre}: faltan ${alert.faltante}`).join(" · ")}`
      : hasProducts && sale.stockAplicado
        ? "Stock aplicado. Disponibilidad actualizada al aceptar la cotización."
        : `${getSaleStockStatusLabel(sale.estadoStock, sale)}.`;

  if (loading) return <p className="muted">Cargando venta...</p>;

  return (
    <main className="po-workspace sale-workspace">
      <section className="po-panel sale-context-card no-print">
        <div className="sale-context-toolbar">
          <button type="button" className="sale-back-link" onClick={() => navigate("/ventas")}>← Historial de ventas</button>
          {canCancelConfirmedQuote && <button type="button" className="po-button po-button--danger" onClick={() => setActionDialog("cancel")}>Cancelar venta</button>}
        </div>
        <div className="sale-context-grid">
          <div className="sale-context-sale">
            <span className="po-kicker">Venta</span>
            <div className="sale-context-sale__title">
              <h1>{sale?.numero || "Nueva venta"}</h1>
              <span className={`po-status po-status--${sale?.estado || "borrador"}`}>{getSaleStatusLabel(sale?.estado || "borrador")}</span>
            </div>
            <div className="sale-context-sale__metadata">
              {sale?.cotizacionId ? <span>Originada desde <button type="button" className="sale-inline-link" onClick={() => navigate(`/cotizaciones/${sale.cotizacionId}/editar`)}>{sale.cotizacionNumero || "cotización aceptada"}</button></span> : <span>Venta directa</span>}
              {sale?.trabajoId && <span>Proyecto <button type="button" className="sale-inline-link" onClick={() => navigate("/trabajos", {state: {openWorkId: sale.trabajoId}})}>{sale.trabajoNumero || sale.trabajoTitulo || sale.trabajoId}</button></span>}
              <span>Fecha {formatDate(draft.fechaVenta)}</span>
              {sale?.cotizacionId && sale?.aceptadaEn && <span>Aceptada {formatDate(sale.aceptadaEn)}</span>}
            </div>
            {!readOnly && <p className="sale-header-guidance">Revisa la venta antes de confirmarla.</p>}
          </div>
          <SaleClientSelector clients={clients} disabled={readOnly || referencesLocked} onChange={(clienteId) => setDraft((current) => ({...current, clienteId}))} originalSnapshot={sale?.clienteSnapshot} value={draft.clienteId} />
        </div>
      </section>

      {message && <p className="po-message po-message--error no-print">{message}</p>}
      {sale?.estado === "confirmada" && <p className={`sale-stock-note no-print${sale.alertasStock?.length ? " po-message po-message--error" : ""}`} role={sale.alertasStock?.length ? "alert" : undefined}>{stockStatusMessage}</p>}

      <div className="no-print">
        <div className="po-layout">
          <div className="po-main">
            <SaleItemsEditor disabled={readOnly} inventory={inventory} items={draft.items} onChange={(items) => setDraft((current) => ({...current, items}))} onOpenCatalog={() => setCatalogOpen(true)} readOnly={Boolean(readOnly && sale)} referencesLocked={referencesLocked} />

            {isSaleDetailRoute && <SaleCommercialMarginPanel role={role} sale={sale} />}

            <section className="po-panel sale-data-panel">
              <header className="sale-section-heading">
                <div><span className="po-kicker">Datos de venta</span><h2>Documento y fechas</h2></div>
              </header>
              {readOnly ? (
                <dl className="sale-data-readonly">
                  <div><dt>Tipo de documento</dt><dd>{getSaleDocumentTypeLabel(draft.tipoDocumento)}</dd></div>
                  <div><dt>Fecha de venta</dt><dd>{formatDate(draft.fechaVenta)}</dd></div>
                  {draft.tipoDocumento !== "sin_documento" && <div><dt>Número</dt><dd>{draft.numeroDocumento || "—"}</dd></div>}
                  {draft.tipoDocumento !== "sin_documento" && <div><dt>Fecha documento</dt><dd>{formatDate(draft.fechaDocumento)}</dd></div>}
                </dl>
              ) : (
                <div className="purchase-document-grid sale-document-grid">
                  <label>Tipo de documento<select value={draft.tipoDocumento} onChange={(event) => changeDocumentType(event.target.value)}><option value="factura">Factura</option><option value="boleta">Boleta</option><option value="otro">Otro</option><option value="sin_documento">Sin documento</option></select></label>
                  <label>Fecha de venta<input type="date" value={draft.fechaVenta} onChange={(event) => setDraft({...draft, fechaVenta: event.target.value})} /></label>
                  {draft.tipoDocumento !== "sin_documento" && <label>Número de documento<input value={draft.numeroDocumento} onChange={(event) => setDraft({...draft, numeroDocumento: event.target.value})} /></label>}
                  {draft.tipoDocumento !== "sin_documento" && <label>Fecha documento<input type="date" value={draft.fechaDocumento} onChange={(event) => setDraft({...draft, fechaDocumento: event.target.value})} /></label>}
                </div>
              )}
            </section>

            <section className="po-panel sale-conditions-panel">
              <header className="sale-section-heading">
                <div><span className="po-kicker">Condiciones</span><h2>Condiciones comerciales</h2></div>
                {!readOnly && <button type="button" className="po-button po-button--secondary" onClick={() => setConditionsOpen(true)}>Editar condiciones</button>}
              </header>
              <div className="sale-conditions-summary">
                <div><strong>Condiciones de pago</strong><p>{draft.condicionesPago || "Sin condiciones informadas."}</p></div>
                {draft.observaciones && <div><strong>Observaciones</strong><p>{draft.observaciones}</p></div>}
              </div>
            </section>

            <section className="po-panel sale-preview-panel">
              <header className="sale-section-heading sale-preview-heading">
                <div><span className="po-kicker">Documento</span><h2>Vista previa imprimible</h2><p>Revisa cómo se verá el documento.</p></div>
                <div className="sale-preview-actions">
                  {previewOpen && sale && <button type="button" className="po-button po-button--secondary" onClick={() => window.print()}>Imprimir</button>}
                  <button type="button" className="po-button po-button--secondary" aria-expanded={previewOpen} onClick={() => setPreviewOpen((current) => !current)}>{previewOpen ? "Ocultar vista previa" : "Ver vista previa"}</button>
                </div>
              </header>
              {previewOpen && <div className="sale-preview-body"><SalePrintView company={company} sale={printable} /></div>}
            </section>
          </div>
          <SaleSummaryPanel currency={printable.moneda} disabled={readOnly} hasInsufficientStock={hasInsufficientStock} locale={printable.locale} onCancel={sale ? () => setActionDialog("cancel") : null} onConfirm={() => setActionDialog("confirm")} onSave={save} processing={processing} taxName={printable.impuestoNombre} taxRate={Number(printable.tasaIva || 0) * 100} totals={totals} />
        </div>
      </div>

      <div className="print-only"><SalePrintView company={company} sale={printable} /></div>
      <SaleCatalogDialog items={inventory} onAdd={addItem} onClose={() => setCatalogOpen(false)} open={catalogOpen} />

      <ResponsiveDialog
        open={conditionsOpen}
        onClose={() => setConditionsOpen(false)}
        eyebrow="Condiciones"
        title="Editar condiciones comerciales"
        description="Agrega las condiciones de pago y observaciones que deben acompañar la venta."
        size="medium"
        footer={<button type="button" className="po-button po-button--primary" onClick={() => setConditionsOpen(false)}>Listo</button>}
      >
        <div className="sale-conditions-form">
          <label>Condiciones de pago<textarea rows="4" value={draft.condicionesPago} onChange={(event) => setDraft({...draft, condicionesPago: event.target.value})} /></label>
          <label>Observaciones<textarea rows="4" value={draft.observaciones} onChange={(event) => setDraft({...draft, observaciones: event.target.value})} /></label>
        </div>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={actionDialog === "confirm"}
        onClose={() => !processing && setActionDialog("")}
        eyebrow="Venta preparada"
        title="Confirmar venta"
        description="Al confirmar se registrará la venta y se descontará el stock de los productos correspondientes."
        size="small"
        footer={<><button type="button" className="po-button po-button--secondary" disabled={processing} onClick={() => setActionDialog("")}>Volver</button><button type="button" className="po-button po-button--primary" disabled={processing || hasInsufficientStock} onClick={confirm}>{processing ? "Confirmando..." : "Confirmar venta"}</button></>}
      >
        <p className="sale-dialog-copy">Después de confirmar, la venta quedará registrada y ya no podrá editarse.</p>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={actionDialog === "cancel"}
        onClose={() => !processing && setActionDialog("")}
        eyebrow="Más acciones"
        title="Cancelar venta"
        description={sale?.estado === "confirmada" ? "La venta quedará cancelada y se revertirá exactamente el stock aplicado." : "La venta preparada quedará cancelada y ya no podrá editarse."}
        size="small"
        footer={<><button type="button" className="po-button po-button--secondary" disabled={processing} onClick={() => setActionDialog("")}>Volver</button><button type="button" className="po-button po-button--danger" disabled={processing || cancelReason.trim().length < 3} onClick={cancel}>{processing ? "Cancelando..." : "Cancelar venta"}</button></>}
      >
        <label className="erp-field"><span className="erp-field__label">Motivo de cancelación</span><textarea className="erp-control" rows="4" maxLength="500" required value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
      </ResponsiveDialog>
    </main>
  );
}
