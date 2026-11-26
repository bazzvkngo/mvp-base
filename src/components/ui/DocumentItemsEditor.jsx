import React from "react";
import {ChevronDown, ChevronUp, X} from "lucide-react";
import BarcodeInput from "../barcode/BarcodeInput";
import useBusinessFormat, {useBusinessMoney} from "../../hooks/useBusinessFormat";
import {getCurrencySymbol} from "../../utils/formatters";
import Button from "./Button";
import QuantityStepper from "./QuantityStepper";

// Bloque de ítems de un documento en edición (Venta, Compra y Orden de compra). Solo presenta y entrega los cambios
// por `onChange(items)`: no calcula nada de negocio. Los cálculos, el agregado de líneas, el tope por stock, los avisos
// de margen, los permisos y lo que se guarda siguen en la página o en el modelo de cada documento.
// - mode: "venta" edita `precioUnitario` ("Precio unitario") y "compra" edita `costoUnitario` ("Costo unitario"); sirve
//   también para la orden de compra. Lo demás (cantidad, descuento, total, quitar) es igual en los dos.
// - title / titleId: título de la tarjeta, con signos de interrogación ("¿Qué vendes?").
// - canChange: se puede agregar y quitar (muestra "Escanear producto", si hay `onScanProduct`, y "Agregar desde
//   inventario"). disabled: los campos están bloqueados. readOnly: valores estáticos, sin campos.
// - moneyStep: paso del importe según los decimales del documento ("any" con 0 decimales, "0.01" con 2).
// - Ganchos opcionales por línea, para lo propio de cada documento: getMaxQuantity(item), getLineMeta(item) (texto que
//   se suma a "código · tipo · unidad", p. ej. "Disponible 7"), renderTitleExtra(item) (marca junto al nombre),
//   renderLineAlert(item) (aviso bajo la fila) y getDescription(item) (descripción a mostrar, "" si no hay).
// - Ganchos opcionales para un documento que además ordena o describe sus líneas (Cotización); sin ellos el bloque se
//   dibuja exactamente igual: getLineTotal(item) (total ya calculado por el documento; por defecto cantidad × precio ×
//   descuento), onMoveLine(index, direction) (flechas "Subir"/"Bajar"), renderLineDescription(item, index) (reemplaza el
//   texto de la descripción, p. ej. por un campo editable), getLineClassName(item) (clase extra de la línea) y notice
//   (aviso bajo la cabecera).
// - El símbolo de la moneda sale de la moneda del negocio, con los mismos criterios de formatBusinessMoney.
const MODES = Object.freeze({
  venta: Object.freeze({priceKey: "precioUnitario", priceLabel: "Precio unitario"}),
  compra: Object.freeze({priceKey: "costoUnitario", priceLabel: "Costo unitario"}),
});
const TYPE_LABELS = Object.freeze({producto: "Producto", servicio: "Servicio", actividad: "Actividad"});
const typeLabel = (value) => TYPE_LABELS[String(value || "").toLowerCase()] || "Ítem";
const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const defaultDescription = (item) => {
  const description = String(item.descripcion || "").trim();
  return description && !sameText(description, item.nombre) ? description : "";
};

export default function DocumentItemsEditor({
  canChange = true,
  disabled = false,
  emptyText = "Agrega productos, servicios o actividades.",
  getDescription = defaultDescription,
  getLineClassName,
  getLineMeta,
  getLineTotal,
  getMaxQuantity,
  items,
  mode = "compra",
  moneyStep = "any",
  notice,
  onChange,
  onMoveLine,
  onOpenCatalog,
  onScanProduct,
  readOnly = false,
  renderLineAlert,
  renderLineDescription,
  renderTitleExtra,
  title,
  titleId,
}) {
  const money = useBusinessMoney();
  const {currency, locale} = useBusinessFormat();
  const symbol = getCurrencySymbol(currency, locale);
  const {priceKey, priceLabel} = MODES[mode] || MODES.compra;
  const update = (index, field, value) => onChange(items.map((item, current) =>
    current === index ? {...item, [field]: value} : item
  ));
  const countLabel = items.length === 1 ? "1 ítem" : `${items.length} ítems`;

  return (
    <section className="ui-step-card ui-doc-items" aria-labelledby={titleId}>
      <header className="ui-step-head">
        <div className="ui-step-head__text">
          <h2 id={titleId} className="ui-step-title">{title}</h2>
          <p className="ui-step-head__count">{countLabel}</p>
        </div>
        {canChange && (
          <div className="ui-step-head__actions">
            {onScanProduct && <BarcodeInput actionOnly continuous actionLabel="Escanear producto" onSubmit={onScanProduct} />}
            <Button type="button" variant="secondary" onClick={onOpenCatalog}>Agregar desde inventario</Button>
          </div>
        )}
      </header>
      {notice}
      {!items.length ? (
        <div className="ui-doc-items__empty">{emptyText}</div>
      ) : (
        <div className="ui-doc-lines">
          {items.map((item, index) => {
            const price = item[priceKey];
            const total = Number(item.cantidad || 0) * Number(price || 0) * (1 - Number(item.descuentoPct || 0) / 100);
            const lineTotal = getLineTotal ? getLineTotal(item) : total;
            const description = getDescription(item);
            const movable = Boolean(onMoveLine) && canChange && !readOnly;
            const showUnit = item.unidad && !sameText(item.unidad, "unidad");
            const meta = [item.codigo || "Sin código", typeLabel(item.tipoItem), showUnit ? item.unidad : "", getLineMeta?.(item)].filter(Boolean).join(" · ");
            const alert = renderLineAlert?.(item);
            return (
              <article className={["ui-doc-line", getLineClassName?.(item)].filter(Boolean).join(" ")} key={item.lineaId}>
                <div className={movable ? "ui-doc-line__row ui-doc-line__row--movable" : "ui-doc-line__row"}>
                  <div className="ui-doc-line__identity">
                    <div className="ui-doc-line__title">
                      <strong className="ui-doc-line__name" title={item.nombre}>{item.nombre}</strong>
                      {renderTitleExtra?.(item)}
                    </div>
                    <small className="ui-doc-line__meta">{meta}</small>
                  </div>
                  {readOnly ? (
                    <>
                      <span className="ui-doc-line__static ui-doc-line__static--qty"><span className="ui-doc-line__caption">Cantidad</span><span className="ui-doc-line__amount">{item.cantidad}</span></span>
                      <span className="ui-doc-line__static ui-doc-line__static--price"><span className="ui-doc-line__caption">{priceLabel}</span><span className="ui-doc-line__amount">{money(price)}</span></span>
                      <span className="ui-doc-line__static ui-doc-line__static--discount"><span className="ui-doc-line__caption">Desc. %</span><span className="ui-doc-line__amount">{item.descuentoPct}%</span></span>
                    </>
                  ) : (
                    <>
                      <div className="ui-doc-line__field ui-doc-line__field--qty">
                        <span className="ui-doc-line__caption" aria-hidden="true">Cantidad</span>
                        <QuantityStepper disabled={disabled} label={item.nombre} max={getMaxQuantity?.(item)} value={item.cantidad} onChange={(value) => update(index, "cantidad", value)} />
                      </div>
                      <label className="ui-doc-line__field ui-doc-line__field--price">
                        <span className="ui-doc-line__caption" aria-hidden="true">{priceLabel}</span>
                        <span className="ui-doc-line__money">
                          <span className="ui-doc-line__symbol" aria-hidden="true">{symbol}</span>
                          <input className="ui-doc-line__input" aria-label={`${priceLabel} de ${item.nombre}`} disabled={disabled} type="number" min="0" step={moneyStep} value={price} onChange={(event) => update(index, priceKey, event.target.value)} />
                        </span>
                      </label>
                      <label className="ui-doc-line__field ui-doc-line__field--discount">
                        <span className="ui-doc-line__caption" aria-hidden="true">Desc. %</span>
                        <input className="ui-doc-line__input" aria-label={`Descuento % de ${item.nombre}`} disabled={disabled} type="number" min="0" max="100" step="any" value={item.descuentoPct} onChange={(event) => update(index, "descuentoPct", event.target.value)} />
                      </label>
                    </>
                  )}
                  <strong className="ui-doc-line__total"><span className="ui-doc-line__caption">Total</span><span className="ui-doc-line__amount">{money(lineTotal)}</span></strong>
                  {movable && (
                    <div className="ui-doc-line__move">
                      <Button type="button" variant="ghost" icon={ChevronUp} aria-label={`Subir ${item.nombre}`} disabled={disabled || index === 0} onClick={() => onMoveLine(index, -1)} />
                      <Button type="button" variant="ghost" icon={ChevronDown} aria-label={`Bajar ${item.nombre}`} disabled={disabled || index === items.length - 1} onClick={() => onMoveLine(index, 1)} />
                    </div>
                  )}
                  {canChange && !readOnly && (
                    <Button type="button" variant="ghost-danger" icon={X} className="ui-doc-line__remove" aria-label={`Quitar ${item.nombre}`} onClick={() => onChange(items.filter((_, current) => current !== index))} />
                  )}
                </div>
                {alert}
                {renderLineDescription ? renderLineDescription(item, index) : description && <p className="ui-doc-line__description">{description}</p>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
