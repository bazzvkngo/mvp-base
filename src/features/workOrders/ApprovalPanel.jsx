import React, {useCallback, useEffect, useState} from "react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  createWorkOrderRequestId, ejecutarAccionAprobacionOT, getWorkOrderErrorMessage,
  obtenerResumenAprobacionOT,
} from "../../services/workOrderService";

const ACTIONS = {
  enviar: "Enviar a aprobación", aprobar: "Aprobar", rechazar: "Rechazar",
  revalidar: "Revalidar disponibilidad",
};

function amount(value, currency) {
  return Number.isFinite(value) && currency
    ? new Intl.NumberFormat("es-CL", {style: "currency", currency}).format(value)
    : "No disponible";
}

export default function ApprovalPanel({businessId, otId, order, onChanged}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const revision = order.actualizadoEn?.toMillis?.();

  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setSummary(null);
    obtenerResumenAprobacionOT(businessId, otId)
      .then(async (data) => {
        if (!active) return;
        setSummary(data);
        // A concurrent operation may have changed the OT after the parent loaded it.
        // Refresh its header and badges from the same authoritative revision.
        if (Number.isSafeInteger(data.revision) && data.revision !== revision) {
          await onChanged();
        }
      })
      .catch((failure) => { if (active) setError(getWorkOrderErrorMessage(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, otId, revision, reload]);

  const begin = (action) => {
    setConfirmation({action, requestId: createWorkOrderRequestId(), revision: summary.revision});
    setReason(""); setError(""); setNotice("");
  };
  const confirm = useCallback(async () => {
    if (!confirmation || busy) return;
    setBusy(true); setError("");
    try {
      const result = await ejecutarAccionAprobacionOT(businessId, otId, confirmation.action,
        confirmation.requestId, confirmation.revision, reason);
      setConfirmation(null);
      setNotice(result.faltantes.length
        ? "Operación registrada. La OT espera repuestos; no se reservó ni descontó stock."
        : "Operación registrada correctamente. El stock no se modificó.");
      await onChanged();
      setReload((value) => value + 1);
    } catch (failure) {
      setError(getWorkOrderErrorMessage(failure));
      if (String(failure.code).includes("aborted")) {
        setConfirmation(null);
        // Keep the conflict visible until the user explicitly refreshes the summary.
        setSummary(null);
      }
    } finally { setBusy(false); }
  }, [businessId, otId, confirmation, busy, reason, onChanged]);

  const awaitingDecision = summary?.estado === "esperando_aprobacion" && summary?.estadoAprobacion === "pendiente";
  return <section className="erp-panel" aria-labelledby="work-order-approval-title">
    <div className="erp-panel-header"><div>
      <h2 id="work-order-approval-title" className="erp-panel-title">Alcance y aprobación</h2>
      <p className="erp-secondary-text">{summary?.congelado
        ? "Alcance congelado al enviar. Los cambios posteriores del catálogo no modifican estos valores."
        : "Vista previa de valores vigentes. Se confirmarán desde Inventario al enviar a aprobación."}</p>
    </div><Button type="button" variant="secondary" disabled={loading || busy} onClick={() => setReload((value) => value + 1)}>Actualizar</Button></div>
    {loading && <div className="erp-empty-state" role="status">Cargando alcance...</div>}
    {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    {notice && <div className="vehicle-message" role="status">{notice}</div>}
    {summary && !loading && <>
      {!summary.alcance.length ? <div className="erp-empty-state">Aún no hay servicios definidos.</div> :
        <div className="erp-table-region work-order-approval-table"><table className="erp-table">
          <thead><tr><th>Servicio / producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead>
          <tbody>{summary.alcance.map((service) => <React.Fragment key={service.servicioOtId}>
            <tr><td><strong>{service.servicioSnapshot?.nombre || "Servicio no disponible"}</strong></td><td>1</td><td>{amount(service.precioUnitario, summary.moneda)}</td><td>{amount(service.precioUnitario, summary.moneda)}</td></tr>
            {service.productos.map((product) => <tr key={product.productoOtId}><td>{product.productoSnapshot?.nombre || "Producto no disponible"}</td><td>{product.cantidad}</td><td>{amount(product.precioUnitario, summary.moneda)}</td><td>{amount(product.precioUnitario * product.cantidad, summary.moneda)}</td></tr>)}
          </React.Fragment>)}</tbody>
        </table></div>}
      {summary.estado === "esperando_repuestos" && <div className="vehicle-message vehicle-message--warning" role="status">{summary.estadoAprobacion === "aprobada"
        ? "El alcance está aprobado. Revalida la disponibilidad para continuar cuando existan repuestos."
        : "Faltan repuestos. Revalida la disponibilidad antes de solicitar la decisión de aprobación."}</div>}
      {summary.estadoAprobacion === "rechazada" && <div className="vehicle-message vehicle-message--warning" role="status">Alcance rechazado. Revisa los servicios y repuestos antes de reenviarlo.</div>}
      {!summary.puedeEnviar && !summary.congelado && <p className="erp-secondary-text">Para enviar se requiere Recepción, al menos un Diagnóstico completado y servicios definidos.</p>}
      {awaitingDecision && !summary.puedeAprobar && <p className="erp-secondary-text">Tu membresía permite consultar el alcance, pero no aprobarlo ni rechazarlo.</p>}
      <div className="vehicle-form-actions work-order-approval-actions">
        {summary.puedeEnviar && <Button type="button" disabled={busy} onClick={() => begin("enviar")}>Enviar a aprobación</Button>}
        {awaitingDecision && summary.puedeAprobar && <><Button type="button" variant="secondary" disabled={busy} onClick={() => begin("rechazar")}>Rechazar</Button><Button type="button" disabled={busy} onClick={() => begin("aprobar")}>Aprobar</Button></>}
        {summary.estado === "esperando_repuestos" && summary.estadoAprobacion !== "rechazada" && <Button type="button" disabled={busy} onClick={() => begin("revalidar")}>Revalidar disponibilidad</Button>}
      </div>
    </>}
    <ResponsiveDialog open={Boolean(confirmation)} onClose={() => !busy && setConfirmation(null)} size="small" eyebrow="Taller" title={ACTIONS[confirmation?.action] || "Confirmar acción"}
      description={confirmation?.action === "enviar" ? "Se consultarán nuevamente los precios de Inventario y se congelará el alcance vigente." : "La operación se validará en el servidor sobre esta versión del alcance."}
      footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancelar</Button><Button type="button" disabled={busy} onClick={confirm}>{busy ? "Procesando..." : "Confirmar"}</Button></>}>
      {confirmation?.action === "rechazar" && <label className="erp-field"><span className="erp-field__label">Motivo (opcional)</span><textarea className="erp-control" value={reason} maxLength={2000} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>}
      {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    </ResponsiveDialog>
  </section>;
}
