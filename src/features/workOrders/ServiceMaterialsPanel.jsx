import React, {useState} from "react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  createWorkOrderRequestId, getWorkOrderErrorMessage,
  registrarSalidaMaterialOT, registrarDevolucionMaterialOT,
} from "../../services/workOrderService";

const number = (value) => new Intl.NumberFormat("es-CL", {maximumFractionDigits: 6}).format(value);
const money = (value, currency) => new Intl.NumberFormat("es-CL", {
  style: "currency", currency, maximumFractionDigits: 4,
}).format(value);

export default function ServiceMaterialsPanel({
  businessId, otId, data, canViewCosts, loading, error, onReload, onChanged,
  products, getProductName, getProductPrice, canEditPlanning, quantityEdit, busy: parentBusy,
  onQuantityChange, onSaveQuantity, onCancelQuantity, onStartQuantityEdit, onRemoveProduct,
}) {
  const [target, setTarget] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const materialByItemId = new Map((data?.productos || []).map((product) => [product.itemId, product]));
  const rows = products.map((product) => ({...product, material: materialByItemId.get(product.itemId)}));
  const canConsume = data?.puedeConsumir === true;
  const showActions = canEditPlanning || canConsume;
  const begin = (action, record) => {
    setTarget({action, record, requestId: createWorkOrderRequestId()});
    setQuantity(""); setOperationError(""); setNotice("");
  };
  const submit = async (event) => {
    event.preventDefault();
    if (busy || !target || !data) return;
    const cantidad = Number(quantity);
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0 || cantidad > 999999999) {
      setOperationError("Ingresa una cantidad entera positiva."); return;
    }
    const returning = target.action === "devolver";
    if (returning && cantidad > target.record.maximoDevolvible) {
      setOperationError("La cantidad supera el máximo pendiente de devolución."); return;
    }
    setBusy(true); setOperationError("");
    try {
      if (returning) await registrarDevolucionMaterialOT(businessId, otId, data.servicioOtId,
        target.record.movimientoId, cantidad, target.requestId);
      else await registrarSalidaMaterialOT(businessId, otId, data.servicioOtId,
        target.record.itemId, cantidad, target.requestId);
      // Once confirmed, never offer a second mutation merely because refreshing fails.
      setTarget(null);
      setNotice(returning ? "Devolución registrada." : "Consumo registrado.");
      setHistoryOpen(true);
      try {
        await onChanged();
      } catch (refreshFailure) {
        setOperationError(`El movimiento fue registrado, pero no se pudo actualizar la vista. ${getWorkOrderErrorMessage(refreshFailure)}`);
      }
    } catch (failure) { setOperationError(getWorkOrderErrorMessage(failure)); }
    finally { setBusy(false); }
  };
  return <section aria-label="Productos y consumo" className="work-order-materials-panel">
    {loading && <p role="status" className="erp-secondary-text">Cargando consumos y stock...</p>}
    {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}<Button type="button" variant="secondary" onClick={onReload}>Reintentar</Button></div>}
    {notice && <div className="vehicle-message" role="status">{notice}</div>}
    {operationError && !target && <div className="vehicle-message vehicle-message--error" role="alert">{operationError}</div>}
    {!error && <>
      {!rows.length ? <p className="erp-secondary-text">Sin productos planificados.</p> : <div className="erp-table-region"><table className="erp-table work-order-products-table"><thead><tr>
        <th>Producto</th><th>Planificado</th><th>Consumido</th><th>Stock</th><th>Precio</th>{showActions && <th>Acciones</th>}
      </tr></thead><tbody>{rows.map((product) => {
        const editing = quantityEdit?.productoOtId === product.productoOtId;
        return <tr key={product.productoOtId}>
          <td>{getProductName(product)}</td>
          <td>{editing ? <input className="erp-control work-order-products-table__quantity" aria-label="Cantidad" type="number" min="1" step="1" value={quantityEdit.cantidad} onChange={(event) => onQuantityChange(event.target.value)} /> : product.cantidad}</td>
          <td>{product.material ? number(product.material.consumido) : loading ? "…" : "0"}</td>
          <td>{product.material?.stock == null ? loading ? "…" : "—" : number(product.material.stock)}</td>
          <td>{getProductPrice(product)}</td>
          {showActions && <td><div className="erp-actions">
            {canEditPlanning && (editing ? <><Button type="button" disabled={parentBusy} onClick={onSaveQuantity}>Guardar</Button><Button type="button" variant="secondary" disabled={parentBusy} onClick={onCancelQuantity}>Cancelar</Button></> : <><Button type="button" variant="secondary" onClick={() => onStartQuantityEdit(product)}>Modificar</Button><Button type="button" variant="secondary" onClick={() => onRemoveProduct(product)}>Eliminar</Button></>)}
            {canConsume && <Button type="button" variant="secondary" disabled={busy || parentBusy || loading || !product.material?.disponible} onClick={() => begin("consumir", product.material)}>Registrar consumo</Button>}
          </div></td>}
        </tr>;
      })}</tbody></table></div>}
      {!data?.movimientos?.length ? <p className="erp-secondary-text">Sin movimientos registrados.</p> :
        <details className="work-order-material-history" open={historyOpen} onToggle={(event) => setHistoryOpen(event.currentTarget.open)}><summary><span><strong>Ver movimientos de inventario</strong><small>{data.movimientos.length} movimiento{data.movimientos.length === 1 ? "" : "s"} registrado{data.movimientos.length === 1 ? "" : "s"}</small></span></summary><div className="work-order-material-history__content">
          <div className="erp-table-region"><table className="erp-table"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Producto</th><th>Cantidad</th><th>Devuelto</th><th>Máximo devolvible</th>{canViewCosts && <><th>Costo unitario histórico</th><th>Costo total</th></>}<th>Acciones</th></tr></thead>
            <tbody>{data.movimientos.map((movement, index) => <tr key={movement.movimientoId}>
              <td>{new Date(movement.fecha).toLocaleString("es-CL")}<br /><span className="erp-secondary-text">{movement.usuarioNombre}</span></td>
              <td>{movement.tipo === "SALIDA_TALLER" ? `Salida ${index + 1}` : `Devolución de salida ${data.movimientos.findIndex((m) => m.movimientoId === movement.movimientoOrigenId) + 1}`}</td>
              <td>{movement.nombre}</td><td>{number(movement.cantidad)}</td><td>{movement.cantidadDevuelta == null ? "—" : number(movement.cantidadDevuelta)}</td><td>{movement.maximoDevolvible == null ? "—" : number(movement.maximoDevolvible)}</td>
              {canViewCosts && <><td>{money(movement.costoUnitario, movement.moneda)}</td><td>{money(movement.costoTotal, movement.moneda)}</td></>}
              <td>{data.puedeDevolver && Math.floor(movement.maximoDevolvible || 0) > 0 ? <Button type="button" variant="secondary" disabled={busy || loading} onClick={() => begin("devolver", movement)}>Registrar devolución</Button> : "—"}</td>
            </tr>)}</tbody></table></div>
        </div></details>}
    </>}
    <ResponsiveDialog open={Boolean(target)} onClose={() => !busy && setTarget(null)} size="small" eyebrow="Taller"
      title={target?.action === "devolver" ? "Registrar devolución" : "Registrar consumo"}
      description={target?.action === "devolver" ? "Se repondrá el producto al inventario usando el costo de la salida original." : "Se descontará del inventario la cantidad que confirmes."}
      footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setTarget(null)}>Cancelar</Button><Button type="submit" form={`material-${data?.servicioOtId}`} disabled={busy || loading || Boolean(error)}>{busy ? "Registrando..." : "Confirmar movimiento"}</Button></>}>
      {target && <form id={`material-${data?.servicioOtId}`} className="vehicle-form" onSubmit={submit} noValidate>
        <strong>{target.record.nombre}</strong>
        <dl className="erp-meta-grid">
          {target.action === "devolver" ? <>
            <div className="erp-meta"><dt className="erp-meta__label">Salida original</dt><dd className="erp-meta__value">{new Date(target.record.fecha).toLocaleString("es-CL")} · {number(target.record.cantidad)}</dd></div>
            <div className="erp-meta"><dt className="erp-meta__label">Ya devuelto</dt><dd className="erp-meta__value">{number(target.record.cantidadDevuelta)}</dd></div>
            <div className="erp-meta"><dt className="erp-meta__label">Máximo devolvible</dt><dd className="erp-meta__value">{number(target.record.maximoDevolvible)}</dd></div>
          </> : <>
            <div className="erp-meta"><dt className="erp-meta__label">Planificado</dt><dd className="erp-meta__value">{number(target.record.planificado)}</dd></div>
            <div className="erp-meta"><dt className="erp-meta__label">Consumido neto</dt><dd className="erp-meta__value">{number(target.record.consumido)}</dd></div>
            <div className="erp-meta"><dt className="erp-meta__label">Stock actual</dt><dd className="erp-meta__value">{target.record.stock == null ? "No disponible" : number(target.record.stock)}</dd></div>
          </>}
        </dl>
        <label className="erp-field"><span className="erp-field__label">Cantidad a {target.action === "devolver" ? "devolver" : "consumir"} *</span>
          <input className="erp-control" type="number" min="1" step="1" max={target.action === "devolver" ? Math.floor(target.record.maximoDevolvible) : undefined} value={quantity} disabled={busy}
            onChange={(event) => {setQuantity(event.target.value); setTarget((current) => ({...current, requestId: createWorkOrderRequestId()}));}} /></label>
        {operationError && <div className="vehicle-message vehicle-message--error" role="alert">{operationError}</div>}
      </form>}
    </ResponsiveDialog>
  </section>;
}
