import React from "react";

const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;
const typeLabel = (value) => ({producto: "Producto", servicio: "Servicio", actividad: "Actividad"})[value] || "Producto";

export default function PurchaseItemsEditor({
  disabled,
  items,
  onChange,
  onOpenCatalog,
  readOnly,
  referencesLocked = false,
}) {
  const update = (index, field, value) => onChange(items.map((item, current) =>
    current === index ? {...item, [field]: value} : item
  ));
  const canChangeReferences = !disabled && !referencesLocked;

  return (
    <section className="po-panel purchase-items-panel">
      <header className="po-panel__header">
        <div>
          <span className="po-kicker">Detalle de compra</span>
          <h2>Ítems de la compra</h2>
          <p>{items.length === 1 ? "1 ítem" : `${items.length} ítems`}</p>
        </div>
        {canChangeReferences && (
          <button type="button" className="po-button po-button--secondary" onClick={onOpenCatalog}>
            Agregar desde inventario
          </button>
        )}
      </header>
      {!items.length ? (
        <div className="po-empty">Agrega productos, servicios o actividades.</div>
      ) : (
        <div className="po-lines">
          <div className="po-lines__head">
            <span>Ítem</span><span>Cantidad</span><span>Costo unitario</span>
            <span>Desc. %</span><span>Total</span><span />
          </div>
          {items.map((item, index) => {
            const total = Number(item.cantidad || 0) * Number(item.costoUnitario || 0) *
              (1 - Number(item.descuentoPct || 0) / 100);
            return (
              <article className={`po-line${readOnly ? " po-line--readonly" : ""}`} key={item.lineaId}>
                <div className="po-line__identity">
                  <strong title={item.nombre}>{item.nombre}</strong>
                  <small>{item.codigo || "Sin código"} · {typeLabel(item.tipoItem)}{item.unidad ? ` · ${item.unidad}` : ""}</small>
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
                    <label>
                      <span>Cantidad</span>
                      <input disabled={disabled} type="number" min="0.000001" step="any" value={item.cantidad} onChange={(event) => update(index, "cantidad", event.target.value)} />
                    </label>
                    <label>
                      <span>Costo unitario</span>
                      <input disabled={disabled} type="number" min="0" step="any" value={item.costoUnitario} onChange={(event) => update(index, "costoUnitario", event.target.value)} />
                    </label>
                    <label>
                      <span>Desc. %</span>
                      <input disabled={disabled} type="number" min="0" max="100" step="any" value={item.descuentoPct} onChange={(event) => update(index, "descuentoPct", event.target.value)} />
                    </label>
                    <strong className="po-line__total">{money(total)}</strong>
                    {canChangeReferences && (
                      <button type="button" className="po-line__remove" onClick={() => onChange(items.filter((_, current) => current !== index))}>
                        Quitar
                      </button>
                    )}
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
