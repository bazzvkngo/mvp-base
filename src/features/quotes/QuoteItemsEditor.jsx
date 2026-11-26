import React, {useMemo} from "react";
import DocumentItemsEditor from "../../components/ui/DocumentItemsEditor";
import Notice from "../../components/ui/Notice";

// Ítems de la cotización: el bloque compartido en modo "venta" (precio unitario), el mismo de Ventas, Compras y Órdenes
// de compra, con "Escanear producto" y "Agregar desde inventario". Aquí solo se conecta lo propio de la cotización:
// las flechas para reordenar, la descripción comercial de cada línea (visible bajo la fila) y el total de línea que ya
// calcula la página con calculateQuoteLineAmounts.
// Los campos de una línea de cotización se llaman distinto (`precioUnitarioEditable`, `descuentoPorcentaje`); el
// adaptador los entrega al bloque con los nombres del documento y traduce de vuelta cada cambio a los mismos manejadores
// de siempre (onUpdate / onRemove / onMove), así la lógica de la página no cambia.
const FIELD_TO_QUOTE = Object.freeze({
  cantidad: "cantidad",
  precioUnitario: "precioUnitarioEditable",
  descuentoPct: "descuentoPorcentaje",
});
const lineKey = (item) => item.lineaId || item.itemId;

function QuoteItemsEditor({
  feedback,
  highlightedItemId,
  items,
  moneyStep = "any",
  onMove,
  onOpenCatalog,
  onScanProduct,
  onRemove,
  onUpdate,
  validationError,
}) {
  const lines = useMemo(() => items.map((item) => ({
    ...item,
    codigo: item.codigo || item.inventarioSnapshot?.codigoInterno || "",
    descuentoPct: item.descuentoPorcentaje ?? 0,
    lineaId: lineKey(item),
    precioUnitario: item.precioUnitarioEditable,
  })), [items]);

  const handleChange = (next) => {
    if (next.length < lines.length) {
      const removed = lines.find((line) => !next.some((entry) => entry.lineaId === line.lineaId));
      if (removed) onRemove(removed.lineaId);
      return;
    }
    next.forEach((entry, index) => {
      Object.entries(FIELD_TO_QUOTE).forEach(([field, quoteField]) => {
        if (entry[field] !== lines[index][field]) onUpdate(entry.lineaId, quoteField, entry[field]);
      });
    });
  };

  const notice = (feedback || validationError || items.length > 0) && (
    <>
      {feedback && <Notice variant="info">{feedback}</Notice>}
      {validationError && <Notice variant="error">{validationError}</Notice>}
      {items.length > 0 && <p className="ui-step-head__count">La descripción y el descuento de cada línea solo cambian esta cotización; el inventario no se modifica.</p>}
    </>
  );

  return (
    <DocumentItemsEditor
      emptyText="Agrega productos, servicios o actividades para construir la cotización."
      getLineClassName={(line) => (highlightedItemId && highlightedItemId === line.itemId ? "ui-doc-line--highlighted" : "")}
      getLineTotal={(line) => line.totalLinea}
      items={lines}
      mode="venta"
      moneyStep={moneyStep}
      notice={notice}
      onChange={handleChange}
      onMoveLine={onMove}
      onOpenCatalog={onOpenCatalog}
      onScanProduct={onScanProduct}
      renderLineDescription={(line) => (
        <label className="quote-line-note">
          <span className="ui-doc-line__caption">Descripción para esta cotización</span>
          <textarea
            className="ui-doc-line__input quote-line-note__input"
            rows="2"
            value={line.descripcionComercial ?? line.descripcion ?? ""}
            onChange={(event) => onUpdate(line.lineaId, "descripcionComercial", event.target.value)}
          />
        </label>
      )}
      title="¿Qué cotizas?"
      titleId="quote-items-title"
    />
  );
}

export default QuoteItemsEditor;
