import React, {useState} from "react";
import {ChevronDown, Minus, Plus} from "lucide-react";
import Button from "../../components/ui/Button";
import StatusBadge from "../../components/ui/StatusBadge";
import {
  getPartsSourceLabel, getWorkStatusLabel, REPLACEMENT_PARTS_MODES, serviceProducts, WORK_STATUS_VARIANTS,
  worksPartsDefined,
} from "../../domain/workOrderExecutionModel.mjs";
import ServiceWorkPhotos from "./ServiceWorkPhotos";

function formatStock(item) {
  return item && item.stock !== undefined && item.stock !== null ? String(item.stock) : "—";
}

// Un trabajo de la OT (acordeón del prototipo): repuestos, fotos antes/después y las acciones de su estado.
// Sin montos. `canEdit` = quien opera los trabajos y el trabajo no está terminado.
export default function ExecutionWorkItem({
  actions, businessId, busy, canEdit, canManage, canOperate, frozen, item, onToggle, open, otId, productOptions,
  productLookup, readOnly = false, service,
}) {
  const products = serviceProducts(service);
  const [picked, setPicked] = useState(null);
  const [draft, setDraft] = useState({itemId: "", cantidad: "1"});
  // Lo que el usuario elige ahora manda sobre el modo guardado: así puede pasar de «Repuestos del cliente» o
  // «No requiere repuestos» a «Del inventario» (el servidor reemplaza el modo al agregar el primer repuesto).
  const source = products.length ? "inventario" : picked || service.repuestosModo;
  const defined = worksPartsDefined(service);
  const closed = service.estado === "completado";
  const existing = products.find((product) => product.itemId === draft.itemId);
  const name = (frozen ? service.servicioSnapshot?.nombre : item?.nombre) || "Servicio no disponible";
  const bodyId = `work-order-work-${service.servicioOtId}`;

  const submitProduct = (event) => {
    event.preventDefault();
    actions.saveProduct(service, draft, existing).then((ok) => { if (ok) setDraft({itemId: "", cantidad: "1"}); });
  };

  return <article className="work-order-work" data-state={service.estado}>
    <button type="button" className="work-order-work__header" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
      <span className="work-order-work__title">{name}</span>
      <span className="work-order-work__badges">
        {service.origenHallazgoId && <StatusBadge variant="neutral">Desde hallazgo</StatusBadge>}
        <StatusBadge variant={WORK_STATUS_VARIANTS[service.estado] || "neutral"}>{getWorkStatusLabel(service.estado)}</StatusBadge>
        <ChevronDown size={18} aria-hidden="true" className="work-order-work__chevron" />
      </span>
    </button>
    {open && <div id={bodyId} className="work-order-work__body">
      <div className="work-order-work__section">
        <h3 className="work-order-work__heading">Repuestos</h3>
        {canEdit ? <>
          <div className="work-order-chip-row" role="group" aria-label="Origen de los repuestos">
            <button type="button" className="work-order-chip" aria-pressed={source === "inventario"}
              disabled={busy} onClick={() => setPicked("inventario")}>Del inventario</button>
            {Object.entries(REPLACEMENT_PARTS_MODES).map(([mode, label]) => <button key={mode} type="button"
              className="work-order-chip" aria-pressed={source === mode} disabled={busy || products.length > 0}
              onClick={() => { setPicked(null); actions.setPartsMode(service, mode); }}>{label}</button>)}
          </div>
          {products.length > 0 && <p className="erp-secondary-text">Quita los repuestos del inventario para marcar este trabajo como sin repuestos o con repuestos del cliente.</p>}
        </> : <p className="erp-secondary-text">{defined ? getPartsSourceLabel(service) : "Sin repuestos definidos."}</p>}
        {!defined && !closed && <div className="vehicle-message vehicle-message--warning" role="status">Define los repuestos de este servicio.</div>}

        {products.length > 0 && <ul className="work-order-parts" aria-label="Repuestos del inventario">
          {products.map((product) => {
            const core = productLookup(product.itemId);
            return <li key={product.productoOtId} className="work-order-parts__row">
              <span className="work-order-parts__name">{(frozen ? product.productoSnapshot?.nombre : core?.nombre) || "Producto no disponible"}
                <span className="erp-secondary-text"> · Stock: {formatStock(core)}</span></span>
              {canEdit ? <span className="work-order-parts__controls">
                <button type="button" className="work-order-stepper" aria-label="Disminuir cantidad"
                  disabled={busy || product.cantidad <= 1} onClick={() => actions.changeQuantity(service, product, product.cantidad - 1)}><Minus size={14} aria-hidden="true" /></button>
                <span className="work-order-parts__quantity" aria-label="Cantidad">{product.cantidad}</span>
                <button type="button" className="work-order-stepper" aria-label="Aumentar cantidad"
                  disabled={busy} onClick={() => actions.changeQuantity(service, product, product.cantidad + 1)}><Plus size={14} aria-hidden="true" /></button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => actions.removeProduct(service, product)}>Quitar</Button>
              </span> : <span className="work-order-parts__quantity">{product.cantidad}</span>}
            </li>;
          })}
        </ul>}

        {canEdit && source === "inventario" && <form className="work-order-parts__picker" onSubmit={submitProduct} noValidate>
          <label className="erp-field"><span className="erp-field__label">Repuesto del inventario</span>
            <select className="erp-control" value={draft.itemId} disabled={busy}
              onChange={(event) => setDraft((current) => ({...current, itemId: event.target.value}))}>
              <option value="">Selecciona un repuesto</option>
              {productOptions.map((product) => <option key={product.itemId} value={product.itemId}>
                {product.codigoInterno ? `${product.codigoInterno} · ` : ""}{product.nombre} · Stock: {formatStock(product)}</option>)}
            </select></label>
          <label className="erp-field"><span className="erp-field__label">Cantidad</span>
            <input className="erp-control" type="number" min="1" step="1" value={draft.cantidad} disabled={busy}
              onChange={(event) => setDraft((current) => ({...current, cantidad: event.target.value}))} /></label>
          <Button type="submit" disabled={busy || !draft.itemId}>{existing ? "Actualizar" : "Agregar"}</Button>
        </form>}
        {canEdit && source === "inventario" && <p className="erp-secondary-text">El stock es una referencia: no se reserva para esta OT y Ventas lo confirma al vender.</p>}
      </div>

      <ServiceWorkPhotos businessId={businessId} canAdd={canEdit} otId={otId} service={service} onSaved={actions.refresh} />

      <div className="vehicle-form-actions work-order-work__actions">
        {canEdit && service.estado === "pendiente" && <Button type="button" variant="secondary" disabled={busy}
          onClick={() => actions.askRemoveWork(service)}>Quitar trabajo</Button>}
        {canOperate && service.estado === "pendiente" && <Button type="button" disabled={busy}
          onClick={() => actions.start(service)}>Iniciar trabajo</Button>}
        {canOperate && service.estado === "en_progreso" && <Button type="button" disabled={busy || !defined}
          onClick={() => actions.finish(service)}>Terminar trabajo</Button>}
        {closed && canManage && !readOnly && <Button type="button" variant="secondary" disabled={busy}
          onClick={() => actions.askReopen(service)}>Reabrir trabajo</Button>}
        {closed && !canManage && !readOnly && <p className="erp-secondary-text">Trabajo cerrado: solo Owner o Administrador pueden editarlo.</p>}
      </div>
    </div>}
  </article>;
}
