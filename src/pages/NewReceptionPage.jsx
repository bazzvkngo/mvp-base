import React, {useEffect, useRef, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {sileo} from "sileo";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import SupplyTrace from "../components/ui/SupplyTrace";
import {
  canManageReceptions,
  getReceptionConfirmationImpact,
  getReceptionStatusLabel,
  getSupplierResponseLabel,
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
import {formatMoney} from "../utils/formatters";
import ReceptionDocumentImportDialog from "../features/receptions/ReceptionDocumentImportDialog";
import "../features/receptions/receptions.css";

const itemActionLabel = (type) => type === "producto"
  ? "Recibir ahora"
  : type === "servicio" ? "Confirmar prestación" : "Confirmar ahora";
const plural = (value, singular, pluralValue) => `${value} ${value === 1 ? singular : pluralValue}`;

export default function NewReceptionPage({businessId, role}) {
  const {recepcionId} = useParams();
  const navigate = useNavigate();
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
  const canManage = canManageReceptions(role);
  const readOnly = !canManage || reception?.estado !== "borrador";
  const receivedProducts = reception?.items?.some((line) => line.tipoItem === "producto" && Number(line.cantidad) > 0);
  const receivedServices = reception?.items?.some((line) => line.tipoItem !== "producto" && Number(line.cantidad) > 0);
  const confirmationImpact = getReceptionConfirmationImpact(draft.items, reception?.tasaIva);

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
        catch (error) { if (active) setMessage(error.message); }
      }
    }).catch((error) => active && setMessage(error.message)).finally(() => active && setLoading(false));
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
    } catch (error) { setMessage(error.message); }
    finally { setProcessing(false); }
  };
  const confirm = async () => {
    if (confirmGuard.current || processing) return;
    confirmGuard.current = true; setDialog(""); setProcessing(true); setMessage("");
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
      } else setMessage(error.message);
    } finally { confirmGuard.current = false; setProcessing(false); }
  };
  const cancel = async () => {
    if (processing) return;
    setDialog(""); setProcessing(true); setMessage("");
    try { const result = await cancelarRecepcionBorrador(businessId, reception.id); setReception(result.recepcion); navigate(`/recepciones/${reception.id}`, {replace: true}); }
    catch (error) { setMessage(error.message); }
    finally { setProcessing(false); }
  };
  const applyImport = ({items, documentoOrigen, aplicadas, omitidas}) => {
    setDraft((current) => ({...current, items, documentoOrigen}));
    sileo.success({title: "Propuesta aplicada", description: `${aplicadas} línea${aplicadas === 1 ? "" : "s"} rellenada${aplicadas === 1 ? "" : "s"}${omitidas ? `; ${omitidas} quedaron sin asociar.` : "."} Aún no se modificó el stock.`});
  };

  if (loading) return <p className="muted">Cargando recepción...</p>;
  if (!reception) return <p className="po-message po-message--error">{message}</p>;
  return <main className="po-workspace">
    <header className="po-header"><div className="po-header__copy"><span className="po-kicker">Recepción</span><div className="po-header__title-row"><h1>{reception.numero}</h1><span className={`po-status po-status--${reception.estado}`}>{getReceptionStatusLabel(reception.estado)}</span></div><div className="po-header__meta"><strong>{reception.proveedorSnapshot?.razonSocial}</strong><span>{draft.fechaRecepcion}</span></div></div><div className="po-header__actions"><button type="button" className="po-button po-button--secondary" onClick={() => navigate("/recepciones")}>Volver al historial</button></div></header>
    {message && <p className="po-message po-message--error">{message}</p>}

    {reception.estado === "confirmada" && <section className="reception-success" role="status" aria-live="polite">
      <div className="reception-success__copy"><span className="reception-success__eyebrow">Recepción confirmada</span><h2>Recepción completada correctamente.</h2><p>{receivedProducts ? "Los productos recibidos actualizaron existencias." : "Esta recepción no incluía productos; no hubo cambios de existencias."}</p>{receivedServices && <p>Los servicios y actividades recibidos quedaron confirmados.</p>}<p className="reception-success__next">{reception.compraId ? reception.compraEstado === "revertida" ? `La compra asociada fue revertida${reception.compraReversionMotivo ? `: ${reception.compraReversionMotivo}` : "."}` : `La compra ${reception.compraNumero || linkedPurchase?.numero || "asociada"} se registró automáticamente.` : "Esta recepción histórica conserva el vínculo económico previo de su orden."}</p></div>
    </section>}

    {reception.estado !== "confirmada" && <section className="reception-order-origin">
      <div><span>Confirmación del proveedor</span><strong>{getSupplierResponseLabel(reception.respuestaProveedorEstado)}</strong></div>
    </section>}
    <SupplyTrace currentType="reception" order={{id: reception.ordenCompraId, numero: reception.ordenCompraNumero}} receptions={[reception]} purchase={linkedPurchase} />

    <section className="po-panel"><h2>Datos de recepción</h2><div className="reception-grid"><label>Fecha de recepción<input type="date" disabled={readOnly} value={draft.fechaRecepcion} onChange={(event) => setDraft({...draft, fechaRecepcion: event.target.value})} /></label><label className="reception-grid__wide">Observaciones<textarea disabled={readOnly} value={draft.observaciones} onChange={(event) => setDraft({...draft, observaciones: event.target.value})} /></label></div></section>
    <section className="po-panel">
      <div className="reception-items-heading"><div><h2>Ítems de la recepción</h2><p>Registra productos recibidos y confirma servicios o actividades prestadas.</p></div>{!readOnly && <button type="button" className="po-button po-button--secondary" disabled={processing} onClick={() => setImportOpen(true)}>Importar factura o documento</button>}</div>
      {draft.documentoOrigen && <div className="reception-document-source"><div><span>Documento conciliado</span><strong>{draft.documentoOrigen.nombreArchivo}</strong></div><div><span>Documento</span><strong>{draft.documentoOrigen.tipoDocumento === "factura" ? "Factura" : draft.documentoOrigen.tipoDocumento === "boleta" ? "Boleta" : "Documento"}{draft.documentoOrigen.numeroDocumento ? ` N° ${draft.documentoOrigen.numeroDocumento}` : ""}</strong></div><div><span>Conciliación</span><strong>{draft.documentoOrigen.lineasAplicadas || 0} de {draft.documentoOrigen.lineasDetectadas || 0} líneas aplicadas</strong></div></div>}
      <div className="erp-table-region"><table className="erp-table reception-items-table"><thead><tr><th>Ítem</th><th>Solicitado</th><th>Recibido / confirmado antes</th><th>Pendiente</th><th>Cantidad actual</th><th>Costo unitario</th><th>Desc. %</th></tr></thead><tbody>{draft.items.map((line) => {
        const pending = Math.max(0, line.cantidadSolicitada - line.cantidadRecibidaAnterior);
        return <tr key={line.lineaId}><td><strong>{line.nombre}</strong><small>{line.tipoItem} · {line.unidad}</small>{line.documentoLineas?.length > 0 && <small>Asociado desde documento</small>}</td><td>{line.cantidadSolicitada}</td><td>{line.cantidadRecibidaAnterior}</td><td>{pending}</td><td><span className="reception-line-action-label">{itemActionLabel(line.tipoItem)}</span>{readOnly ? line.cantidad : <input className="reception-qty" type="number" min="0" max={pending} step="any" value={line.cantidad} onChange={(event) => setDraft({...draft, items: draft.items.map((item) => item.lineaId === line.lineaId ? {...item, cantidad: Number(event.target.value)} : item)})} />}</td><td>{readOnly ? line.costoUnitario : <input className="reception-cost" type="number" min="0" step="any" value={line.costoUnitario} onChange={(event) => setDraft({...draft, items: draft.items.map((item) => item.lineaId === line.lineaId ? {...item, costoUnitario: Number(event.target.value)} : item)})} />}</td><td>{readOnly ? line.descuentoPct : <input className="reception-discount" type="number" min="0" max="100" step="any" value={line.descuentoPct} onChange={(event) => setDraft({...draft, items: draft.items.map((item) => item.lineaId === line.lineaId ? {...item, descuentoPct: Number(event.target.value)} : item)})} />}</td></tr>;
      })}</tbody></table></div>
    </section>
    <div className="po-header__actions">{reception.estado === "borrador" && canManage && <><button type="button" className="po-button po-button--secondary" disabled={processing} onClick={save}>Guardar</button><button type="button" className="po-button po-button--primary" disabled={processing} onClick={() => setDialog("confirm")}>Confirmar recepción</button><button type="button" className="po-button po-button--danger" disabled={processing} onClick={() => setDialog("cancel")}>Cancelar</button></>}</div>

    <ResponsiveDialog open={dialog === "confirm"} onClose={() => !processing && setDialog("")} eyebrow="Lista para confirmar" title="Confirma el impacto de esta recepción" description="Al confirmar, ValoraCloud registrará esta recepción, actualizará el stock de los productos recibidos y generará automáticamente la compra correspondiente. Los servicios y actividades no modificarán existencias." size="small" footer={<><Button type="button" variant="secondary" disabled={processing} onClick={() => setDialog("")}>Volver</Button><Button type="button" aria-busy={processing} disabled={processing} onClick={confirm}>{processing ? "Confirmando recepción…" : "Confirmar recepción y registrar compra"}</Button></>}>
      <div className="reception-confirm-impact"><div><span>Productos que actualizan stock</span><strong>{plural(confirmationImpact.productos, "producto", "productos")}</strong></div><div><span>Servicios sin movimiento de stock</span><strong>{plural(confirmationImpact.servicios, "servicio", "servicios")}</strong></div><div><span>Actividades sin movimiento de stock</span><strong>{plural(confirmationImpact.actividades, "actividad", "actividades")}</strong></div><div><span>Total estimado de la compra</span><strong>{formatMoney(confirmationImpact.totalCompraEstimado, reception.moneda, reception.locale)}</strong></div></div>
    </ResponsiveDialog>
    <ResponsiveDialog open={dialog === "cancel"} onClose={() => !processing && setDialog("")} eyebrow="Cancelar recepción" title="Cancelar recepción" description="La recepción quedará cancelada sin modificar stock." size="small" footer={<><Button type="button" variant="secondary" disabled={processing} onClick={() => setDialog("")}>Volver</Button><Button type="button" variant="danger" disabled={processing} onClick={cancel}>{processing ? "Cancelando..." : "Cancelar recepción"}</Button></>}><p>Esta acción no se puede deshacer.</p></ResponsiveDialog>
    <ReceptionDocumentImportDialog open={importOpen} onClose={() => setImportOpen(false)} onApply={applyImport} businessId={businessId} providerSnapshot={reception.proveedorSnapshot} receptionItems={draft.items} />
  </main>;
}
