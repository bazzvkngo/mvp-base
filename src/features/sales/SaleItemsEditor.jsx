import React from "react";
import {ChevronDown, Minus, Pencil, Plus, X} from "lucide-react";
import BarcodeInput from "../../components/barcode/BarcodeInput";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import {getSaleItemTypeLabel} from "../../domain/saleModel.mjs";
import {lineDescriptionToShow} from "./saleLineText.mjs";
import {stepSaleQuantity} from "./saleLineStepper.mjs";

const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;

const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// Vista histórica (venta confirmada o cancelada): una fila por ítem con
// encabezados únicos. Sin stock actual: no es un dato de la venta.
function SoldItemsTable({items}) {
  return (
    <div className="sale-sold">
      <table className="sale-sold__table">
        <thead>
          <tr>
            <th scope="col">Ítem</th>
            <th scope="col">Código</th>
            <th scope="col">Cantidad</th>
            <th scope="col">Precio unitario</th>
            <th scope="col">Desc. %</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const discount = Number(item.descuentoPct || 0);
            const total = item.totalLinea ?? Number(item.cantidad || 0) * Number(item.precioUnitario || 0) * (1 - discount / 100);
            const showUnit = item.unidad && !sameText(item.unidad, "unidad");
            return (
              <tr key={item.lineaId}>
                <td className="sale-sold__item" data-label="Ítem">
                  <div className="sale-line-title">
                    <strong title={item.nombre}>{item.nombre}</strong>
                    <span className={`sale-item-type sale-item-type--${item.tipoItem}`}>{getSaleItemTypeLabel(item.tipoItem)}</span>
                    {item.origenAdicionalId && <span className="sale-item-type sale-item-type--adicional">Adicional</span>}
                  </div>
                  {item.descripcion && !sameText(item.descripcion, item.nombre) && <p className="sale-sold__description" title={item.descripcion}>{item.descripcion}</p>}
                </td>
                <td className="sale-sold__code" data-label="Código" title={item.codigo || undefined}>{item.codigo || "—"}</td>
                <td data-label="Cantidad" title={showUnit ? `${item.cantidad} ${item.unidad}` : undefined}>{item.cantidad}{showUnit ? ` ${item.unidad}` : ""}</td>
                <td data-label="Precio unitario">{money(item.precioUnitario)}</td>
                <td data-label="Desc. %">{discount > 0 ? `${discount}%` : "—"}</td>
                <td className="sale-sold__total" data-label="Total">{money(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SaleItemsEditor({disabled, historical = false, inventory, items, onChange, onOpenCatalog, onScanProduct, readOnly, referencesLocked = false}) {
  const update = (index, field, value) => onChange(items.map((item, current) => current === index ? {...item, [field]: value} : item));
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const canChangeReferences = !disabled && !referencesLocked;
  const countLabel = items.length === 1 ? "1 ítem" : `${items.length} ítems`;
  const actions = canChangeReferences && (
    <div className="po-header__actions">
      <BarcodeInput actionOnly continuous actionLabel="Escanear producto" onSubmit={onScanProduct} />
      <button type="button" className="po-button po-button--secondary" onClick={onOpenCatalog}>Agregar desde inventario</button>
    </div>
  );

  if (historical) {
    return (
      <section className="po-panel">
        <header className="po-panel__header">
          <div>
            <span className="po-kicker">Detalle de venta</span>
            <h2>Ítems vendidos</h2>
            <p>{countLabel}</p>
          </div>
          {actions}
        </header>
        {!items.length ? <div className="po-empty">Agrega productos, servicios o actividades.</div> : <SoldItemsTable items={items} />}
      </section>
    );
  }

  return (
    <section className="sale-items-card" aria-labelledby="sale-items-title">
      <header className="sale-items-head">
        <div className="sale-items-head__text">
          <h2 id="sale-items-title" className="sale-step-title">¿Qué vendes?</h2>
          <p className="sale-items-count">{countLabel}</p>
        </div>
        {actions}
      </header>
      {!items.length ? (
        <div className="po-empty">Agrega productos, servicios o actividades.</div>
      ) : (
        <div className="sale-lines">
          {items.map((item, index) => {
            const total = Number(item.cantidad || 0) * Number(item.precioUnitario || 0) * (1 - Number(item.descuentoPct || 0) / 100);
            const inventoryItem = inventoryById.get(item.itemId);
            const stock = inventoryItem ? Number(inventoryItem.stock) : Number.NaN;
            const requested = Number(item.cantidad || 0);
            const hasKnownStock = item.tipoItem === "producto" && Number.isFinite(stock);
            const exceedsStock = hasKnownStock && requested > stock;
            const discountPct = Number(item.descuentoPct || 0);
            const showDiscount = Number.isFinite(discountPct) && discountPct !== 0;
            const maxQuantity = referencesLocked && item.cantidadCotizada != null ? item.cantidadCotizada : undefined;
            const canDecrease = !disabled && stepSaleQuantity(item.cantidad, -1) !== null;
            const canIncrease = !disabled && stepSaleQuantity(item.cantidad, 1, {max: maxQuantity}) !== null;
            const step = (direction) => {
              const next = stepSaleQuantity(item.cantidad, direction, {max: maxQuantity});
              if (next !== null) update(index, "cantidad", next);
            };
            const showUnit = item.unidad && !sameText(item.unidad, "unidad");
            const description = lineDescriptionToShow(item);

            return (
              <article className="sale-line" key={item.lineaId}>
                <div className="sale-line__row">
                  <div className="sale-line__identity">
                    <div className="sale-line__title">
                      <strong className="sale-line__name" title={item.nombre}>{item.nombre}</strong>
                      {item.origenAdicionalId && <span className="sale-item-type sale-item-type--adicional">Adicional</span>}
                      {showDiscount && <span className="sale-line__chip">{`-${Math.abs(discountPct).toLocaleString("es-CL", {maximumFractionDigits: 4})} %`}</span>}
                    </div>
                    <small className="sale-line__meta">{item.codigo || "Sin código"} · {getSaleItemTypeLabel(item.tipoItem)}{showUnit ? ` · ${item.unidad}` : ""}{hasKnownStock && !exceedsStock ? ` · Disponible ${stock}` : ""}</small>
                  </div>
                  {readOnly ? (
                    <>
                      <span className="sale-line__static sale-line__static--qty"><span className="sr-only">Cantidad: </span>{item.cantidad}</span>
                      <span className="sale-line__static sale-line__static--price"><span className="sr-only">Precio unitario: </span>{money(item.precioUnitario)}</span>
                    </>
                  ) : (
                    <>
                      <div className="sale-qty">
                        <button type="button" className="sale-qty__button" aria-label={`Disminuir cantidad de ${item.nombre}`} disabled={!canDecrease} onClick={() => step(-1)}><AppIcon icon={Minus} size={16} /></button>
                        <input className="sale-qty__input" aria-label={`Cantidad de ${item.nombre}`} disabled={disabled} type="number" min="0.000001" max={maxQuantity} step="any" value={item.cantidad} onChange={(event) => update(index, "cantidad", event.target.value)} />
                        <button type="button" className="sale-qty__button" aria-label={`Aumentar cantidad de ${item.nombre}`} disabled={!canIncrease} onClick={() => step(1)}><AppIcon icon={Plus} size={16} /></button>
                      </div>
                      <label className="sale-price">
                        <span className="sr-only">Precio unitario de {item.nombre}</span>
                        <span className="sale-price__symbol" aria-hidden="true">$</span>
                        <input className="sale-price__input" disabled={disabled} type="number" min="0" step="any" value={item.precioUnitario} onChange={(event) => update(index, "precioUnitario", event.target.value)} />
                        <span className="sale-price__edit" aria-hidden="true"><AppIcon icon={Pencil} size={14} /></span>
                      </label>
                    </>
                  )}
                  <strong className="sale-line__total">{money(total)}</strong>
                  {canChangeReferences && !readOnly && <Button type="button" variant="ghost-danger" icon={X} className="sale-line__remove" aria-label={`Quitar ${item.nombre}`} onClick={() => onChange(items.filter((_, current) => current !== index))} />}
                </div>
                {exceedsStock && (
                  <div className="sale-stock-warning" role="alert">
                    <strong>Stock insuficiente</strong>
                    <span>Disponible: {stock} · Solicitado: {requested}</span>
                  </div>
                )}
                <details className="sale-line__more">
                  <summary><span>Descuento</span><span className="sale-line__chevron" aria-hidden="true"><AppIcon icon={ChevronDown} size={16} /></span></summary>
                  <div className="sale-line__more-body">
                    {readOnly ? (
                      <p className="sale-line__discount-static">{`Descuento: ${Math.abs(discountPct).toLocaleString("es-CL", {maximumFractionDigits: 4})} %`}</p>
                    ) : (
                      <label className="sale-line__discount">
                        <span>Descuento %</span>
                        <input className="sale-line__discount-input" disabled={disabled} type="number" min="0" max="100" step="any" value={item.descuentoPct} onChange={(event) => update(index, "descuentoPct", event.target.value)} />
                      </label>
                    )}
                    {description && <p className="sale-line-description">{description}</p>}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
