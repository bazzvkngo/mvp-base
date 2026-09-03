import React from "react";
import {getSaleItemTypeLabel} from "../../domain/saleModel.mjs";

const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;

export default function SaleItemsEditor({disabled, inventory, items, onChange, onOpenCatalog, readOnly, referencesLocked = false}) {
  const update = (index, field, value) => onChange(items.map((item, current) => current === index ? {...item, [field]: value} : item));
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const canChangeReferences = !disabled && !referencesLocked;

  return (
    <section className="po-panel">
      <header className="po-panel__header">
        <div>
          <span className="po-kicker">Detalle de venta</span>
          <h2>Ítems vendidos</h2>
          <p>{items.length === 1 ? "1 ítem" : `${items.length} ítems`}</p>
        </div>
        {canChangeReferences && <button type="button" className="po-button po-button--secondary" onClick={onOpenCatalog}>Agregar desde inventario</button>}
      </header>
      {!items.length ? (
        <div className="po-empty">Agrega productos, servicios o actividades.</div>
      ) : (
        <div className="po-lines">
          <div className="po-lines__head"><span>Ítem</span><span>Cantidad</span><span>Precio unitario</span><span>Desc. %</span><span>Total</span><span /></div>
          {items.map((item, index) => {
            const total = Number(item.cantidad || 0) * Number(item.precioUnitario || 0) * (1 - Number(item.descuentoPct || 0) / 100);
            const inventoryItem = inventoryById.get(item.itemId);
            const stock = inventoryItem ? Number(inventoryItem.stock) : Number.NaN;
            const requested = Number(item.cantidad || 0);
            const hasKnownStock = item.tipoItem === "producto" && Number.isFinite(stock);
            const exceedsStock = hasKnownStock && requested > stock;

            return (
              <article className={`po-line${readOnly ? " po-line--readonly" : ""}`} key={item.lineaId}>
                <div className="po-line__identity">
                  <div className="sale-line-title">
                    <strong>{item.nombre}</strong>
                    <span className={`sale-item-type sale-item-type--${item.tipoItem}`}>{getSaleItemTypeLabel(item.tipoItem)}</span>
                    {item.origenAdicionalId && <span className="sale-item-type sale-item-type--adicional">Adicional</span>}
                  </div>
                  <small>{item.codigo || "Sin código"} · {item.unidad}</small>
                  {item.descripcion && <p className="sale-line-description">{item.descripcion}</p>}
                  {hasKnownStock && (
                    exceedsStock ? (
                      <div className="sale-stock-warning" role="alert">
                        <strong>Stock insuficiente</strong>
                        <span>Disponible: {stock} · Solicitado: {requested}</span>
                      </div>
                    ) : (
                      <small className="sale-stock">Disponible: {stock}</small>
                    )
                  )}
                </div>
                {readOnly ? (
                  <dl className="po-line__readonly">
                    <div><dt>Cantidad</dt><dd>{item.cantidad}</dd></div>
                    <div><dt>Precio unitario</dt><dd>{money(item.precioUnitario)}</dd></div>
                    <div><dt>Descuento</dt><dd>{item.descuentoPct}%</dd></div>
                    <div className="po-line__readonly-total"><dt>Total</dt><dd>{money(total)}</dd></div>
                  </dl>
                ) : (
                  <>
                    <label><span>Cantidad</span><input disabled={disabled} type="number" min="0.000001" max={referencesLocked && item.cantidadCotizada != null ? item.cantidadCotizada : undefined} step="any" value={item.cantidad} onChange={(event) => update(index, "cantidad", event.target.value)} /></label>
                    <label><span>Precio unitario</span><input disabled={disabled} type="number" min="0" step="any" value={item.precioUnitario} onChange={(event) => update(index, "precioUnitario", event.target.value)} /></label>
                    <label><span>Desc. %</span><input disabled={disabled} type="number" min="0" max="100" step="any" value={item.descuentoPct} onChange={(event) => update(index, "descuentoPct", event.target.value)} /></label>
                    <strong className="po-line__total">{money(total)}</strong>
                    {canChangeReferences && <button type="button" className="po-line__remove" onClick={() => onChange(items.filter((_, current) => current !== index))}>Quitar</button>}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
