import React from "react";
import BarcodeInput from "../../components/barcode/BarcodeInput";

const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;
const typeLabel = (value) => ({producto: "Producto", servicio: "Servicio", actividad: "Actividad"})[value] || "Producto";

export default function PurchaseOrderItemsEditor({disabled, items, onChange, onOpenCatalog, onScanProduct, readOnly}) {
  const update = (index, field, value) => onChange(items.map((item, itemIndex) =>
    itemIndex === index ? {...item, [field]: value} : item
  ));
  return (
    <section className="po-panel">
      <header className="po-panel__header">
        <div>
          <h2>Ítems de la orden</h2>
          <p>{items.length === 1 ? "1 ítem" : `${items.length} ítems`}</p>
        </div>
        {!disabled && (
          <div className="po-header__actions">
            <BarcodeInput actionOnly actionLabel="Escanear producto" onSubmit={onScanProduct} />
            <button type="button" className="po-button po-button--secondary" onClick={onOpenCatalog}>
              Agregar desde inventario
            </button>
          </div>
        )}
      </header>
      {!items.length ? (
        <div className="po-empty">Agrega productos, servicios o actividades del inventario.</div>
      ) : (
        <div className="po-lines">
          <div className="po-lines__head">
            <span>Ítem</span><span>Cantidad</span><span>Costo unitario</span><span>Desc. %</span><span>Total</span><span />
          </div>
          {items.map((item, index) => {
            const subtotal = Number(item.cantidad || 0) * Number(item.costoUnitario || 0);
            const total = subtotal * (1 - Number(item.descuentoPct || 0) / 100);
            return (
              <article className={`po-line${readOnly ? " po-line--readonly" : ""}`} key={item.lineaId}>
                <div className="po-line__identity">
                  <strong>{item.nombre}</strong>
                  <small>{item.codigo || "Sin código"} · {typeLabel(item.tipoItem)} · {item.unidad || "unidad"}</small>
                </div>
                {readOnly ? (
                  <dl className="po-line__readonly">
                    <div><dt>Cantidad</dt><dd>{item.cantidad}</dd></div>
                    <div><dt>Costo unitario</dt><dd>{money(item.costoUnitario)}</dd></div>
                    <div><dt>Descuento</dt><dd>{item.descuentoPct}%</dd></div>
                    <div className="po-line__readonly-total"><dt>Total</dt><dd>{money(total)}</dd></div>
                  </dl>
                ) : (
                  <>
                    <label><span>Cantidad</span><input disabled={disabled} type="number" min="0.000001" step="any" value={item.cantidad} onChange={(event) => update(index, "cantidad", event.target.value)} /></label>
                    <label><span>Costo unitario</span><input disabled={disabled} type="number" min="0" step="any" value={item.costoUnitario} onChange={(event) => update(index, "costoUnitario", event.target.value)} /></label>
                    <label><span>Desc. %</span><input disabled={disabled} type="number" min="0" max="100" step="any" value={item.descuentoPct} onChange={(event) => update(index, "descuentoPct", event.target.value)} /></label>
                    <strong className="po-line__total">{money(total)}</strong>
                    {!disabled && <button type="button" className="po-line__remove" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button>}
                  </>
                )}
                {item.descripcion && <p>{item.descripcion}</p>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
