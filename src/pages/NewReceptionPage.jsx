import React, {useEffect, useRef, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {sileo} from "sileo";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {
  canManageReceptions,
  getReceptionPurchaseAction,
  getReceptionStatusLabel,
  shouldReconcileReceptionConfirmation,
} from "../domain/receptionModel.mjs";
import {
  actualizarRecepcionBorrador,
  cancelarRecepcionBorrador,
  confirmarRecepcion,
  createReceptionRequestId,
  obtenerRecepcion,
} from "../services/receptionService";
import {crearCompraDesdeRecepcion, obtenerCompra} from "../services/purchaseService";
import "../features/receptions/receptions.css";

export default function NewReceptionPage({businessId, role}) {
  const {recepcionId} = useParams();
  const navigate = useNavigate();
  const [reception, setReception] = useState(null);
  const [draft, setDraft] = useState({fechaRecepcion: "", observaciones: "", items: []});
  const [linkedPurchase, setLinkedPurchase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [dialog, setDialog] = useState("");
  const [message, setMessage] = useState("");
  const confirmId = useRef(createReceptionRequestId("reception-confirm"));
  const purchaseId = useRef(createReceptionRequestId("purchase-reception"));
  const canManage = canManageReceptions(role);
  const readOnly = !canManage || reception?.estado !== "borrador";
  const purchaseAction = getReceptionPurchaseAction(reception, linkedPurchase, canManage);
  const receivedProducts = reception?.items?.some((line) =>
    line.tipoItem === "producto" && Number(line.cantidad) > 0
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    setLinkedPurchase(null);
    obtenerRecepcion(businessId, recepcionId).then(async (stored) => {
      if (!active) return;
      setReception(stored);
      if (stored) setDraft({fechaRecepcion: stored.fechaRecepcion, observaciones: stored.observaciones, items: stored.items});
      else setMessage("La recepcion no existe.");
      if (stored?.compraId) {
        try {
          const purchase = await obtenerCompra(businessId, stored.compraId);
          if (active) setLinkedPurchase(purchase);
        } catch (error) {
          if (active) setMessage(error.message);
        }
      }
    }).catch((error) => active && setMessage(error.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [businessId, recepcionId]);
  const save = async () => {
    setProcessing(true);
    try {
      const result = await actualizarRecepcionBorrador(businessId, reception.id, draft);
      setReception(result.recepcion);
      setDraft({...draft, items: result.recepcion.items});
      sileo.success({title: "Recepcion preparada", description: "Aun no se modifico el stock."});
    } catch (error) { setMessage(error.message); } finally { setProcessing(false); }
  };
  const confirm = async () => {
    setDialog(""); setProcessing(true);
    try {
      await actualizarRecepcionBorrador(businessId, reception.id, draft);
      const result = await confirmarRecepcion(businessId, reception.id, {requestId: confirmId.current});
      setReception(result.recepcion);
      sileo.success({title: "Recepcion confirmada", description: result.productosActualizados ? "El stock de productos fue actualizado." : "No habia productos que movieran stock."});
      navigate(`/recepciones/${reception.id}`, {replace: true});
    } catch (error) {
      if (shouldReconcileReceptionConfirmation(error)) {
        try {
          const authoritative = await obtenerRecepcion(businessId, reception.id);
          if (authoritative?.estado === "confirmada" && authoritative?.stockAplicado) {
            setReception(authoritative);
            navigate(`/recepciones/${reception.id}`, {replace: true});
            sileo.success({title: "Recepción confirmada", description: "Se verificó el resultado autoritativo después de recuperar la conexión."});
          } else {
            setMessage("La recepción continúa preparada. Puedes reintentar con seguridad.");
          }
        } catch {
          setMessage("No se pudo verificar la confirmación. Recarga antes de reintentar.");
        }
      } else {
        setMessage(error.message);
      }
    } finally { setProcessing(false); }
  };
  const cancel = async () => {
    setDialog(""); setProcessing(true);
    try { const result = await cancelarRecepcionBorrador(businessId, reception.id); setReception(result.recepcion); navigate(`/recepciones/${reception.id}`, {replace: true}); }
    catch (error) { setMessage(error.message); } finally { setProcessing(false); }
  };
  const preparePurchase = async () => {
    setProcessing(true);
    setMessage("");
    try {
      const result = await crearCompraDesdeRecepcion(businessId, reception.id, {requestId: purchaseId.current});
      setLinkedPurchase(result.compra);
      setReception((current) => ({
        ...current,
        compraId: result.compra.id,
        compraNumero: result.compra.numero,
      }));
      const path = result.compra.estado === "borrador" && canManage
        ? `/compras/${result.compra.id}/editar`
        : `/compras/${result.compra.id}`;
      navigate(path, {state: {message: result.alreadyConverted ? "Compra recuperada" : "Compra preparada", description: "Revisa el documento económico del proveedor. El stock no se aplicará nuevamente."}});
    } catch (error) {
      const description = `La recepción continúa confirmada y el inventario no se revirtió. ${error.message}`;
      setMessage(`No se pudo preparar la compra. ${description}`);
      sileo.error({title: "No se pudo preparar la compra", description});
    } finally { setProcessing(false); }
  };
  const openPurchase = () => {
    if (!reception.compraId) return;
    navigate(purchaseAction === "continue"
      ? `/compras/${reception.compraId}/editar`
      : `/compras/${reception.compraId}`);
  };
  if (loading) return <p className="muted">Cargando recepcion...</p>;
  if (!reception) return <p className="po-message po-message--error">{message}</p>;
  return <main className="po-workspace">
    <header className="po-header"><div className="po-header__copy"><span className="po-kicker">Recepcion</span><div className="po-header__title-row"><h1>{reception.numero}</h1><span className={`po-status po-status--${reception.estado}`}>{getReceptionStatusLabel(reception.estado)}</span></div><div className="po-header__meta"><strong>{reception.proveedorSnapshot?.razonSocial}</strong><span>{draft.fechaRecepcion}</span></div></div><div className="po-header__actions"><button type="button" className="po-button po-button--secondary" onClick={() => navigate("/recepciones")}>Volver al historial</button></div></header>
    {message && <p className="po-message po-message--error">{message}</p>}
    {reception.estado === "confirmada" && <section className="reception-success" role="status" aria-live="polite">
      <div className="reception-success__copy">
        <span className="reception-success__eyebrow">Recepción confirmada</span>
        <h2>La recepción física finalizó correctamente</h2>
        <p>{receivedProducts ? "El inventario fue actualizado correctamente." : "No había productos que modificaran stock."}</p>
        <p className="reception-success__next">{purchaseAction === "prepare" ? "Ahora puedes preparar la compra asociada para revisar y registrar el documento económico del proveedor." : purchaseAction === "continue" ? "La compra asociada está preparada para continuar la revisión del documento económico." : reception.compraId ? "La compra asociada ya está disponible para consulta." : "La documentación económica puede completarse posteriormente por un administrador."}</p>
      </div>
      {purchaseAction && <div className="reception-success__action">
        {purchaseAction === "prepare" ? <Button type="button" disabled={processing} onClick={preparePurchase}>{processing ? "Preparando..." : "Preparar compra"}</Button> : <Button type="button" variant={purchaseAction === "continue" ? "primary" : "secondary"} disabled={processing} onClick={openPurchase}>{purchaseAction === "continue" ? "Continuar compra" : "Ver compra"}</Button>}
        {reception.compraNumero && <small>{reception.compraNumero}</small>}
      </div>}
    </section>}
    <div className="reception-callout"><span>Origen: <button type="button" className="po-inline-link" onClick={() => navigate(`/ordenes-compra/${reception.ordenCompraId}`)}>{reception.ordenCompraNumero}</button></span><span>Respuesta proveedor: {reception.respuestaProveedorEstado === "pendiente" ? "Sin respuesta" : reception.respuestaProveedorEstado === "confirmada" ? "Confirmada" : "Rechazada"}</span></div>
    <section className="po-panel"><h2>Datos de recepcion</h2><div className="reception-grid"><label>Fecha de recepcion<input type="date" disabled={readOnly} value={draft.fechaRecepcion} onChange={(event) => setDraft({...draft, fechaRecepcion: event.target.value})} /></label><label className="reception-grid__wide">Observaciones<textarea disabled={readOnly} value={draft.observaciones} onChange={(event) => setDraft({...draft, observaciones: event.target.value})} /></label></div></section>
    <section className="po-panel"><h2>Ítems recibidos</h2><div className="erp-table-region"><table className="erp-table"><thead><tr><th>Item</th><th>Solicitado</th><th>Recibido antes</th><th>Pendiente</th><th>Recibir ahora</th></tr></thead><tbody>{draft.items.map((line) => { const pending = Math.max(0, line.cantidadSolicitada - line.cantidadRecibidaAnterior); return <tr key={line.lineaId}><td><strong>{line.nombre}</strong><small>{line.tipoItem} · {line.unidad}</small></td><td>{line.cantidadSolicitada}</td><td>{line.cantidadRecibidaAnterior}</td><td>{pending}</td><td>{readOnly ? line.cantidad : <input className="reception-qty" type="number" min="0" max={pending} step="any" value={line.cantidad} onChange={(event) => setDraft({...draft, items: draft.items.map((item) => item.lineaId === line.lineaId ? {...item, cantidad: Number(event.target.value)} : item)})} />}</td></tr>; })}</tbody></table></div></section>
    <div className="po-header__actions">{reception.estado === "borrador" && canManage && <><button type="button" className="po-button po-button--secondary" disabled={processing} onClick={save}>Guardar</button><button type="button" className="po-button po-button--primary" disabled={processing} onClick={() => setDialog("confirm")}>Confirmar recepcion</button><button type="button" className="po-button po-button--danger" disabled={processing} onClick={() => setDialog("cancel")}>Cancelar</button></>}</div>
    <ResponsiveDialog open={dialog === "confirm"} onClose={() => !processing && setDialog("")} eyebrow="Recepción preparada" title="Confirmar recepción" description="Al confirmar, se registrará la recepción física y el inventario aumentará únicamente por los productos recibidos." size="small" footer={<><Button type="button" variant="secondary" disabled={processing} onClick={() => setDialog("")}>Volver</Button><Button type="button" disabled={processing} onClick={confirm}>{processing ? "Confirmando..." : "Confirmar recepción"}</Button></>}><p>Los servicios y actividades no modifican existencias. Revisa las cantidades antes de confirmar.</p></ResponsiveDialog>
    <ResponsiveDialog open={dialog === "cancel"} onClose={() => !processing && setDialog("")} eyebrow="Recepción preparada" title="Cancelar recepción" description="La recepción quedará cancelada sin modificar stock." size="small" footer={<><Button type="button" variant="secondary" disabled={processing} onClick={() => setDialog("")}>Volver</Button><Button type="button" variant="danger" disabled={processing} onClick={cancel}>{processing ? "Cancelando..." : "Cancelar recepción"}</Button></>}><p>Esta acción no se puede deshacer.</p></ResponsiveDialog>
  </main>;
}
