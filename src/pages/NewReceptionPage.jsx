import React, {useEffect, useRef, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {FileUp} from "lucide-react";
import {adaptDocumentAmountDecimals} from "../domain/localization.mjs";
import useBusinessFormat from "../hooks/useBusinessFormat";
import {sileo} from "sileo";
import Button from "../components/ui/Button";
import LoadingState from "../components/ui/LoadingState";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import SupplyTrace from "../components/ui/SupplyTrace";
import ScanProductButton from "../components/barcode/ScanProductButton";
import {
  canManageReceptions,
  getReceptionConfirmationImpact,
  getReceptionStatusLabel,
  getSupplierResponseLabel,
  resolveReceptionScan,
  shouldReconcileReceptionConfirmation,
} from "../domain/receptionModel.mjs";
import {
  actualizarRecepcionBorrador,
  cancelarRecepcionBorrador,
  confirmarRecepcion,
  createReceptionRequestId,
  obtenerRecepcion,
} from "../services/receptionService";
import {obtenerCompra} from "../services/purchaseService";
import {findActiveProductByBarcode} from "../services/inventoryService";
import {formatDate, formatMoney, getCurrencySymbol} from "../utils/formatters";
import ReceptionDetailView from "../features/receptions/ReceptionDetailView";
import ReceptionDocumentImportDialog from "../features/receptions/ReceptionDocumentImportDialog";
import "../features/receptions/receptions.css";
import {userErrorMessage} from "../domain/userFacingError.mjs";

const itemActionLabel = (type) => type === "producto"
  ? "Recibir ahora"
  : type === "servicio" ? "Confirmar prestación" : "Confirmar ahora";
const ITEM_TYPE_LABELS = {producto: "Producto", servicio: "Servicio", actividad: "Actividad"};
const plural = (value, singular, pluralValue) => `${value} ${value === 1 ? singular : pluralValue}`;
const hasDocumentValue = (value) => value !== "" && value !== null && value !== undefined;

export default function NewReceptionPage({businessId, role}) {
  const {recepcionId} = useParams();
  const navigate = useNavigate();
  const businessFormat = useBusinessFormat();
  const [reception, setReception] = useState(null);
  const [draft, setDraft] = useState({fechaRecepcion: "", observaciones: "", documentoOrigen: null, items: []});
  const [linkedPurchase, setLinkedPurchase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [dialog, setDialog] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [message, setMessage] = useState("");
  const confirmId = useRef(createReceptionRequestId("reception-confirm"));
  const confirmGuard = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const canManage = canManageReceptions(role);
  const readOnly = !canManage || reception?.estado !== "borrador";
  // Decimales de cálculo (SPEC 036): los del documento de la recepción (heredados de la orden; ausente = 0).
  const documentDecimals = adaptDocumentAmountDecimals(reception || {}, reception?.moneda);
  // Paso del costo: "any" con 0 decimales (como siempre) y "0.01" con 2. La cantidad no cambia.
  const moneyStep = documentDecimals > 0 ? String(10 ** -documentDecimals) : "any";
  const confirmationImpact = getReceptionConfirmationImpact(draft.items, reception?.tasaIva, documentDecimals);

  useEffect(() => {
    let active = true;
    setLoading(true); setMessage(""); setLinkedPurchase(null);
    obtenerRecepcion(businessId, recepcionId).then(async (stored) => {
      if (!active) return;
      setReception(stored);
      if (stored) setDraft({fechaRecepcion: stored.fechaRecepcion, observaciones: stored.observaciones, documentoOrigen: stored.documentoOrigen, items: stored.items});
      else setMessage("La recepción no existe.");
      if (stored?.compraId) {
        try { const purchase = await obtenerCompra(businessId, stored.compraId); if (active) setLinkedPurchase(purchase); }
        catch (error) { if (active) setMessage(userErrorMessage(error)); }
      }
    }).catch((error) => active && setMessage(userErrorMessage(error))).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [businessId, recepcionId]);

  const save = async () => {
    if (processing) return;
    setProcessing(true); setMessage("");
    try {
      const result = await actualizarRecepcionBorrador(businessId, reception.id, draft);
      setReception(result.recepcion);
      setDraft({...draft, documentoOrigen: result.recepcion.documentoOrigen, items: result.recepcion.items});
      sileo.success({title: "Recepción preparada", description: "Aún no se modificó el stock."});
    } catch (error) { setMessage(userErrorMessage(error)); }
    finally { setProcessing(false); }
  };
  const confirm = async () => {
    if (confirmGuard.current || processing) return;
    confirmGuard.current = true; setProcessing(true); setMessage("");
    try {
      await actualizarRecepcionBorrador(businessId, reception.id, draft);
      const result = await confirmarRecepcion(businessId, reception.id, {requestId: confirmId.current});
      setReception(result.recepcion); setLinkedPurchase(result.compra);
      sileo.success({title: "Recepción confirmada", description: result.compra ? `${result.compra.numero} fue registrada automáticamente.` : "La recepción histórica conservó su compra original."});
      navigate(`/recepciones/${reception.id}`, {replace: true});
    } catch (error) {
      if (shouldReconcileReceptionConfirmation(error)) {
        try {
          const authoritative = await obtenerRecepcion(businessId, reception.id);
          if (authoritative?.estado === "confirmada" && authoritative?.stockAplicado) {
            setReception(authoritative);
            if (authoritative.compraId) setLinkedPurchase(await obtenerCompra(businessId, authoritative.compraId));
            navigate(`/recepciones/${reception.id}`, {replace: true});
            sileo.success({title: "Recepción confirmada", description: "Se verificó el resultado autoritativo después de recuperar la conexión."});
          } else setMessage("La recepción continúa preparada. Puedes reintentar con seguridad.");
        } catch { setMessage("No se pudo verificar la confirmación. Recarga antes de reintentar."); }
      } else setMessage(userErrorMessage(error));
    // El diálogo se mantiene abierto mientras dura la llamada y se cierra aquí, tanto en éxito como en error.
    } finally { confirmGuard.current = false; setProcessing(false); setDialog(""); }
  };
  const cancel = async () => {
    if (processing) return;
    setDialog(""); setProcessing(true); setMessage("");
    try { const result = await cancelarRecepcionBorrador(businessId, reception.id); setReception(result.recepcion); navigate(`/recepciones/${reception.id}`, {replace: true}); }
    catch (error) { setMessage(userErrorMessage(error)); }
    finally { setProcessing(false); }
  };
  const applyImport = ({items, documentoOrigen, aplicadas, omitidas}) => {
    setDraft((current) => ({...current, items, documentoOrigen}));
    sileo.success({title: "Propuesta aplicada", description: `${aplicadas} línea${aplicadas === 1 ? "" : "s"} rellenada${aplicadas === 1 ? "" : "s"}${omitidas ? `; ${omitidas} quedaron sin asociar.` : "."} Aún no se modificó el stock.`});
  };

  // Suma 1 a la línea de producto de la OC; nunca crea líneas nuevas (SPEC 011).
  const scanReceivedProduct = async (barcode) => {
    const product = await findActiveProductByBarcode(businessId, barcode);
    if (!product) throw new Error("Producto no encontrado para este código.");
    const current = draftRef.current;
    const result = resolveReceptionScan(current.items, product.id);
    if (result.status === "not_in_reception") throw new Error(`${product.nombre || "Este producto"} no está en esta recepción: no figura en la orden de compra.`);
    if (result.status === "completed") throw new Error(`Ya se completó lo pendiente de ${result.line.nombre}.`);
    const {line, cantidad: next} = result;
    const items = current.items.map((item) => item.lineaId === line.lineaId ? {...item, cantidad: next} : item);
    draftRef.current = {...current, items};
    setDraft((latest) => ({...latest, items: latest.items.map((item) => item.lineaId === line.lineaId ? {...item, cantidad: next} : item)}));
    return {key: line.lineaId, label: line.nombre};
  };

  if (loading) return <LoadingState variant="page" label="Cargando recepción..." />;
  if (!reception) return <p className="po-message po-message--error">{message}</p>;
  if (reception.estado !== "borrador") return <ReceptionDetailView linkedPurchase={linkedPurchase} message={message} reception={reception} />;

  // Solo presentación: el formato regional del documento (o, si no lo trae, el del negocio) y el símbolo de su moneda.
  const locale = reception.locale || businessFormat.locale;
  const symbol = getCurrencySymbol(reception.moneda, locale);
  const source = draft.documentoOrigen;
  const updateLine = (lineaId, field, value) => setDraft({...draft, items: draft.items.map((item) => item.lineaId === lineaId ? {...item, [field]: Number(value)} : item)});

  return <main className="po-workspace reception-workspace">
    {/* Un solo h1 por pantalla: el de la barra superior (navigation.js). Por eso el título va en un <p>. */}
    <header className="ui-doc-head no-print">
      <div className="ui-doc-head__main">
        <button type="button" className="ui-doc-back" onClick={() => navigate("/recepciones")}>← Recepciones</button>
        <p className="ui-doc-head__title">{reception.numero}</p>
        <span className={`po-status po-status--${reception.estado}`}>{getReceptionStatusLabel(reception.estado)}</span>
      </div>
      <div className="ui-doc-head__side">
        <div className="ui-doc-head__meta">
          <span>{draft.fechaRecepcion ? formatDate(draft.fechaRecepcion, locale) : "Sin fecha"}</span>
          <span>{reception.ordenCompraNumero ? `Orden de compra ${reception.ordenCompraNumero}` : "Orden de compra"}</span>
        </div>
      </div>
    </header>
    {message && <p className="po-message po-message--error">{message}</p>}

    <section className="ui-step-card reception-order-origin" aria-label="Proveedor y confirmación">
      <dl>
        <div><dt>Proveedor</dt><dd>{reception.proveedorSnapshot?.razonSocial || "Proveedor histórico"}</dd></div>
        <div><dt>Confirmación del proveedor</dt><dd>{getSupplierResponseLabel(reception.respuestaProveedorEstado)}</dd></div>
      </dl>
    </section>
    <SupplyTrace currentType="reception" order={{id: reception.ordenCompraId, numero: reception.ordenCompraNumero}} receptions={[reception]} />

    <section className="ui-step-card" aria-labelledby="reception-data-title">
      <h2 id="reception-data-title" className="ui-step-title">Datos de recepción</h2>
      <div className="reception-grid">
        <label className="erp-field"><span className="erp-field__label">Fecha de recepción</span><input className="erp-control" type="date" disabled={readOnly} value={draft.fechaRecepcion} onChange={(event) => setDraft({...draft, fechaRecepcion: event.target.value})} /></label>
        <label className="erp-field reception-grid__wide"><span className="erp-field__label">Observaciones</span><textarea className="erp-control" rows="3" disabled={readOnly} value={draft.observaciones} onChange={(event) => setDraft({...draft, observaciones: event.target.value})} /></label>
      </div>
    </section>

    <section className="ui-step-card ui-doc-items" aria-labelledby="reception-items-title">
      <header className="ui-step-head">
        <div className="ui-step-head__text">
          <h2 id="reception-items-title" className="ui-step-title">Ítems de la recepción</h2>
          <p className="ui-step-head__count">{draft.items.length === 1 ? "1 ítem" : `${draft.items.length} ítems`}</p>
        </div>
        {!readOnly && <div className="ui-step-head__actions"><ScanProductButton disabled={processing} onSubmit={scanReceivedProduct} /><Button type="button" variant="secondary" icon={FileUp} disabled={processing} onClick={() => setImportOpen(true)}>Importar factura o documento</Button></div>}
      </header>
      <p className="reception-items__hint">Registra productos recibidos y confirma servicios o actividades prestadas.</p>
      {source && <div className="reception-document-source"><div><span>Documento conciliado</span><strong>{source.nombreArchivo}</strong></div><div><span>Documento</span><strong>{source.tipoDocumento === "factura" ? "Factura" : source.tipoDocumento === "boleta" ? "Boleta" : "Documento"}{source.numeroDocumento ? ` N° ${source.numeroDocumento}` : ""}</strong></div>{hasDocumentValue(source.neto) && <div><span>Neto</span><strong>{formatMoney(source.neto, source.moneda || reception.moneda, reception.locale)}</strong></div>}{hasDocumentValue(source.impuestoMonto) && <div><span>{hasDocumentValue(source.impuestoPorcentaje) ? `IVA (${source.impuestoPorcentaje}%)` : "IVA"}</span><strong>{formatMoney(source.impuestoMonto, source.moneda || reception.moneda, reception.locale)}</strong></div>}{hasDocumentValue(source.total) && <div><span>Total</span><strong>{formatMoney(source.total, source.moneda || reception.moneda, reception.locale)}</strong></div>}<div><span>Conciliación</span><strong>{source.lineasAplicadas || 0} de {source.lineasDetectadas || 0} líneas aplicadas</strong></div></div>}
      <div className="ui-doc-lines">{draft.items.map((line) => {
        const pending = Math.max(0, line.cantidadSolicitada - line.cantidadRecibidaAnterior);
        const meta = [line.codigo, ITEM_TYPE_LABELS[line.tipoItem] || "Ítem", line.unidad, line.documentoLineas?.length > 0 ? "Asociado desde documento" : ""].filter(Boolean).join(" · ");
        return <article className="ui-doc-line" key={line.lineaId}>
          <div className="reception-line__row">
            <div className="ui-doc-line__identity">
              <div className="ui-doc-line__title"><strong className="ui-doc-line__name" title={line.nombre}>{line.nombre}</strong></div>{" "}
              <small className="ui-doc-line__meta">{meta}</small>
            </div>
            <span className="ui-doc-line__static reception-line__requested"><span className="ui-doc-line__caption">Solicitado</span><span className="ui-doc-line__amount">{line.cantidadSolicitada}</span></span>
            <span className="ui-doc-line__static reception-line__previous"><span className="ui-doc-line__caption">Recibido antes</span><span className="ui-doc-line__amount">{line.cantidadRecibidaAnterior}</span></span>
            <span className="ui-doc-line__static reception-line__pending"><span className="ui-doc-line__caption">Pendiente</span><span className="ui-doc-line__amount">{pending}</span></span>
            {readOnly ? <>
              <span className="ui-doc-line__static reception-line__current"><span className="ui-doc-line__caption">{itemActionLabel(line.tipoItem)}</span><span className="ui-doc-line__amount">{line.cantidad}</span></span>
              <span className="ui-doc-line__static reception-line__cost"><span className="ui-doc-line__caption">Costo unitario</span><span className="ui-doc-line__amount">{line.costoUnitario}</span></span>
              <span className="ui-doc-line__static reception-line__discount"><span className="ui-doc-line__caption">Desc. %</span><span className="ui-doc-line__amount">{line.descuentoPct}</span></span>
            </> : <>
              <label className="ui-doc-line__field reception-line__current">
                <span className="ui-doc-line__caption" aria-hidden="true">{itemActionLabel(line.tipoItem)}</span>
                <input className="ui-doc-line__input" type="number" min="0" max={pending} step="any" aria-label={`${itemActionLabel(line.tipoItem)}: cantidad de ${line.nombre}`} value={line.cantidad} onChange={(event) => updateLine(line.lineaId, "cantidad", event.target.value)} />
              </label>
              <label className="ui-doc-line__field reception-line__cost">
                <span className="ui-doc-line__caption" aria-hidden="true">Costo unitario</span>
                <span className="ui-doc-line__money">
                  <span className="ui-doc-line__symbol" aria-hidden="true">{symbol}</span>
                  <input className="ui-doc-line__input" type="number" min="0" step={moneyStep} aria-label={`Costo unitario de ${line.nombre}`} value={line.costoUnitario} onChange={(event) => updateLine(line.lineaId, "costoUnitario", event.target.value)} />
                </span>
              </label>
              <label className="ui-doc-line__field reception-line__discount">
                <span className="ui-doc-line__caption" aria-hidden="true">Desc. %</span>
                <input className="ui-doc-line__input" type="number" min="0" max="100" step="any" aria-label={`Descuento % de ${line.nombre}`} value={line.descuentoPct} onChange={(event) => updateLine(line.lineaId, "descuentoPct", event.target.value)} />
              </label>
            </>}
          </div>
        </article>;
      })}</div>
    </section>
    {canManage && <div className="ui-doc-head__actions">
      <Button type="button" variant="secondary" disabled={processing} onClick={save}>Guardar</Button>
      <Button type="button" disabled={processing} onClick={() => setDialog("confirm")}>Confirmar recepción</Button>
      <Button type="button" variant="danger" disabled={processing} onClick={() => setDialog("cancel")}>Cancelar</Button>
    </div>}

    <ResponsiveDialog open={dialog === "confirm"} onClose={() => !processing && setDialog("")} eyebrow="Lista para confirmar" title="Confirma el impacto de esta recepción" description="Al confirmar, ValoraCloud registrará esta recepción, actualizará el stock de los productos recibidos y generará automáticamente la compra correspondiente. Los servicios y actividades no modificarán existencias." size="small" footer={<><Button type="button" variant="secondary" disabled={processing} onClick={() => setDialog("")}>Volver</Button><Button type="button" loading={processing} onClick={confirm}>{processing ? "Confirmando recepción…" : "Confirmar recepción y registrar compra"}</Button></>}>
      <div className="reception-confirm-impact"><div><span>Productos que actualizan stock</span><strong>{plural(confirmationImpact.productos, "producto", "productos")}</strong></div><div><span>Servicios sin movimiento de stock</span><strong>{plural(confirmationImpact.servicios, "servicio", "servicios")}</strong></div><div><span>Actividades sin movimiento de stock</span><strong>{plural(confirmationImpact.actividades, "actividad", "actividades")}</strong></div><div><span>Total estimado de la compra</span><strong>{formatMoney(confirmationImpact.totalCompraEstimado, reception.moneda, reception.locale)}</strong></div></div>
      {processing && <p className="erp-secondary-text" role="status">Esto puede tardar unos segundos. No cierres ni recargues esta página.</p>}
    </ResponsiveDialog>
    <ResponsiveDialog open={dialog === "cancel"} onClose={() => !processing && setDialog("")} eyebrow="Cancelar recepción" title="Cancelar recepción" description="La recepción quedará cancelada sin modificar stock." size="small" footer={<><Button type="button" variant="secondary" disabled={processing} onClick={() => setDialog("")}>Volver</Button><Button type="button" variant="danger" loading={processing} onClick={cancel}>{processing ? "Cancelando..." : "Cancelar recepción"}</Button></>}><p>Esta acción no se puede deshacer.</p></ResponsiveDialog>
    <ReceptionDocumentImportDialog open={importOpen} onClose={() => setImportOpen(false)} onApply={applyImport} businessId={businessId} providerSnapshot={reception.proveedorSnapshot} receptionItems={draft.items} />
  </main>;
}
