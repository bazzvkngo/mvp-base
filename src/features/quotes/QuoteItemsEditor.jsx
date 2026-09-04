import React from "react";
import BarcodeInput from "../../components/barcode/BarcodeInput";
import { formatCLP } from "../../utils/formatters";

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
  subtotal,
  validationError,
}) {
  return (
    <section className="quote-workspace__panel quote-items no-print">
      <header className="quote-workspace__panel-header">
        <div>
          <span className="quote-workspace__kicker">Detalle comercial</span>
          <h2>Ítems de la cotización</h2>
          <p>
            {items.length === 0
              ? "Sin ítems agregados"
              : `${items.length} ítem${items.length === 1 ? "" : "s"} · Subtotal ${formatCLP(subtotal)}`}
          </p>
        </div>
        <div className="quote-workspace__inline-actions">
          <BarcodeInput actionOnly actionLabel="Escanear producto" onSubmit={onScanProduct} />
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
          <button type="button" className="quote-workspace__button quote-workspace__button--primary" onClick={onOpenCatalog}>
            Abrir catálogo
          </button>
        </div>
      ) : (
        <div className="quote-items__list">
          <div className="quote-items__head" aria-hidden="true">
            <span>Ítem</span><span>Cantidad</span><span>Precio</span><span>Desc.</span><span>Total</span><span>Acciones</span>
          </div>
          {items.map((item, index) => {
            const lineId = item.lineaId || item.itemId;
            const code = item.codigo || item.inventarioSnapshot?.codigoInterno || `Ítem ${index + 1}`;
            return (
              <article
                key={lineId}
                className={`quote-item${highlightedItemId === item.itemId ? " quote-item--highlighted" : ""}`}
              >
                <div className="quote-item__identity">
                  <strong>{item.nombre}</strong>
                  <span>{code} · {TYPE_LABELS[item.tipoItem] || item.tipoItem || "Ítem"} · {item.unidad || "Sin unidad"}</span>
                </div>
                <label className="quote-item__field">
                  <span>Cantidad</span>
                  <input type="number" min="0" step="0.01" value={item.cantidad} onChange={(event) => onUpdate(lineId, "cantidad", event.target.value)} />
                </label>
                <label className="quote-item__field">
                  <span>Precio</span>
                  <input type="number" min="0" value={item.precioUnitarioEditable} onChange={(event) => onUpdate(lineId, "precioUnitarioEditable", event.target.value)} />
                </label>
                <label className="quote-item__field">
                  <span>Descuento %</span>
                  <input type="number" min="0" max="100" step="0.01" value={item.descuentoPorcentaje ?? 0} onChange={(event) => onUpdate(lineId, "descuentoPorcentaje", event.target.value)} />
                </label>
                <div className="quote-item__total">
                  <span>Total</span>
                  <strong>{formatCLP(item.totalLinea)}</strong>
                </div>
                <div className="quote-item__actions">
                  <button type="button" aria-label={`Subir ${item.nombre}`} disabled={index === 0} onClick={() => onMove(index, -1)}>↑</button>
                  <button type="button" aria-label={`Bajar ${item.nombre}`} disabled={index === items.length - 1} onClick={() => onMove(index, 1)}>↓</button>
                  <button type="button" className="quote-item__remove" onClick={() => onRemove(lineId)}>Quitar</button>
                </div>
                <details className="quote-item__details">
                  <summary>Personalizar ítem</summary>
                  <div>
                    <label>
                      <span>Descripción para esta cotización</span>
                      <textarea rows="2" value={item.descripcionComercial ?? item.descripcion ?? ""} onChange={(event) => onUpdate(lineId, "descripcionComercial", event.target.value)} />
                    </label>
                    <p className="quote-item__details-help">
                      Personaliza cómo aparecerá este ítem en la propuesta. No modifica el producto del catálogo.
                    </p>
                    <label>
                      <span>Unidad de cobro</span>
                      <input value={item.unidad || ""} onChange={(event) => onUpdate(lineId, "unidad", event.target.value)} />
                    </label>
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
