import React from "react";
import {ChevronDown, ChevronUp, Minus, Pencil, Plus, X} from "lucide-react";
import BarcodeInput from "../../components/barcode/BarcodeInput";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import { useBusinessMoney } from "../../hooks/useBusinessFormat";
import { stepQuoteQuantity } from "./quoteLineStepper.mjs";

const TYPE_LABELS = {
  producto: "Producto",
  servicio: "Servicio",
  actividad: "Actividad",
};

function QuoteItemsEditor({
  feedback,
  highlightedItemId,
  items,
  onMove,
  onOpenCatalog,
  onScanProduct,
  onRemove,
  onUpdate,
  validationError,
}) {
  const formatBusinessAmount = useBusinessMoney();
  const countLabel = items.length === 0
    ? "Sin ítems agregados"
    : items.length === 1 ? "1 ítem" : `${items.length} ítems`;
  return (
    <section className="quote-workspace__panel quote-items no-print" aria-labelledby="quote-items-title">
      <header className="quote-workspace__panel-header">
        <div>
          <h2 id="quote-items-title">2 · ¿Qué cotizas?</h2>
          <p>{countLabel}</p>
        </div>
        <div className="quote-workspace__inline-actions">
          <BarcodeInput actionOnly continuous actionLabel="Escanear producto" onSubmit={onScanProduct} />
          <button type="button" className="quote-workspace__button quote-workspace__button--primary" onClick={onOpenCatalog}>
            Agregar desde catálogo
          </button>
        </div>
      </header>

      {feedback && <p className="quote-workspace__feedback" aria-live="polite">{feedback}</p>}

      {items.length === 0 ? (
        <div className="quote-workspace__empty quote-workspace__empty--items">
          <strong>Agrega el detalle de la cotización</strong>
          <span>Agrega productos, servicios o actividades para construir la cotización.</span>
        </div>
      ) : (
        <div className="quote-lines">
          {items.map((item, index) => {
            const lineId = item.lineaId || item.itemId;
            const code = item.codigo || item.inventarioSnapshot?.codigoInterno || `Ítem ${index + 1}`;
            const discountPct = Number(item.descuentoPorcentaje || 0);
            const showDiscount = Number.isFinite(discountPct) && discountPct !== 0;
            const canDecrease = stepQuoteQuantity(item.cantidad, -1) !== null;
            const step = (direction) => {
              const next = stepQuoteQuantity(item.cantidad, direction);
              if (next !== null) onUpdate(lineId, "cantidad", next);
            };
            return (
              <article
                key={lineId}
                className={`quote-line${highlightedItemId === item.itemId ? " quote-line--highlighted" : ""}`}
              >
                <div className="quote-line__row">
                  <div className="quote-line__identity">
                    <div className="quote-line__title">
                      <strong className="quote-line__name" title={item.nombre}>{item.nombre}</strong>
                      {showDiscount && <span className="quote-line__chip">{`-${Math.abs(discountPct).toLocaleString("es-CL", {maximumFractionDigits: 4})} %`}</span>}
                    </div>
                    <small className="quote-line__meta">{code} · {TYPE_LABELS[item.tipoItem] || item.tipoItem || "Ítem"} · {item.unidad || "Sin unidad"}</small>
                  </div>
                  <div className="quote-qty">
                    <button type="button" className="quote-qty__button" aria-label={`Disminuir cantidad de ${item.nombre}`} disabled={!canDecrease} onClick={() => step(-1)}><AppIcon icon={Minus} size={16} /></button>
                    <input className="quote-qty__input" aria-label={`Cantidad de ${item.nombre}`} type="number" min="0" step="0.01" value={item.cantidad} onChange={(event) => onUpdate(lineId, "cantidad", event.target.value)} />
                    <button type="button" className="quote-qty__button" aria-label={`Aumentar cantidad de ${item.nombre}`} onClick={() => step(1)}><AppIcon icon={Plus} size={16} /></button>
                  </div>
                  <label className="quote-price">
                    <span className="sr-only">Precio unitario de {item.nombre}</span>
                    <input className="quote-price__input" type="number" min="0" value={item.precioUnitarioEditable} onChange={(event) => onUpdate(lineId, "precioUnitarioEditable", event.target.value)} />
                    <span className="quote-price__edit" aria-hidden="true"><AppIcon icon={Pencil} size={14} /></span>
                  </label>
                  <strong className="quote-line__total">{formatBusinessAmount(item.totalLinea)}</strong>
                  <div className="quote-line__actions">
                    <Button type="button" variant="secondary" icon={ChevronUp} className="quote-line__icon-button" aria-label={`Subir ${item.nombre}`} disabled={index === 0} onClick={() => onMove(index, -1)} />
                    <Button type="button" variant="secondary" icon={ChevronDown} className="quote-line__icon-button" aria-label={`Bajar ${item.nombre}`} disabled={index === items.length - 1} onClick={() => onMove(index, 1)} />
                    <Button type="button" variant="ghost-danger" icon={X} className="quote-line__icon-button quote-line__remove" aria-label={`Quitar ${item.nombre}`} onClick={() => onRemove(lineId)} />
                  </div>
                </div>
                <details className="quote-line__more">
                  <summary><span>Descripción y descuento</span><span className="quote-line__chevron" aria-hidden="true"><AppIcon icon={ChevronDown} size={16} /></span></summary>
                  <div className="quote-line__more-body">
                    <label className="quote-line__field--wide">
                      <span>Descripción para esta cotización</span>
                      <textarea rows="2" value={item.descripcionComercial ?? item.descripcion ?? ""} onChange={(event) => onUpdate(lineId, "descripcionComercial", event.target.value)} />
                    </label>
                    <label className="quote-line__discount">
                      <span>Descuento %</span>
                      <input type="number" min="0" max="100" step="0.01" value={item.descuentoPorcentaje ?? 0} onChange={(event) => onUpdate(lineId, "descuentoPorcentaje", event.target.value)} />
                    </label>
                    <p className="quote-line__help">Solo cambia esta cotización; el inventario no se modifica.</p>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}

      {validationError && <p className="quote-workspace__message quote-workspace__message--error" role="alert">{validationError}</p>}
    </section>
  );
}

export default QuoteItemsEditor;
