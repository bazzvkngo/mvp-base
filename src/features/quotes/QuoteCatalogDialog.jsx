import React from "react";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import { formatCLP } from "../../utils/formatters";

const TYPE_LABELS = {
  producto: "Producto",
  servicio: "Servicio",
  actividad: "Actividad",
};

function getCatalogCode(valuation) {
  const item = valuation.item || {};
  return valuation.codigoInterno || valuation.codigo || valuation.sku ||
    item.codigoInterno || item.codigo || item.sku || "Sin código";
}

function QuoteCatalogDialog({
  catalogHasMoreItems,
  catalogShowingAllItems,
  filteredCount,
  itemQuantityById,
  loading,
  onAdd,
  onClose,
  onSearchChange,
  onShowLess,
  onShowMore,
  onTypeChange,
  open,
  search,
  totalCount,
  typeFilter,
  valuations,
}) {
  const searchRef = React.useRef(null);

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      size="large"
      eyebrow="Cotización"
      title="Catálogo de inventario"
      description="Busca productos, servicios o actividades activos del negocio actual."
      initialFocusRef={searchRef}
      className="quote-catalog-dialog"
      footer={(
        <button type="button" className="quote-workspace__button quote-workspace__button--secondary" onClick={onClose}>
          Cerrar catálogo
        </button>
      )}
    >
      <div className="quote-catalog">
        <div className="quote-catalog__toolbar">
          <label className="quote-catalog__search">
            <span>Buscar</span>
            <input
              ref={searchRef}
              value={search}
              onChange={onSearchChange}
              placeholder="Nombre, código o categoría"
            />
          </label>
          <label className="quote-catalog__filter">
            <span>Tipo</span>
            <select value={typeFilter} onChange={onTypeChange}>
              <option value="todos">Todos</option>
              <option value="producto">Productos</option>
              <option value="servicio">Servicios</option>
              <option value="actividad">Actividades</option>
            </select>
          </label>
          <p className="quote-catalog__count" aria-live="polite">
            <strong>{filteredCount}</strong> de {totalCount} resultados
          </p>
        </div>

        {loading ? (
          <div className="quote-workspace__empty" role="status">Cargando inventario valorizado…</div>
        ) : totalCount === 0 ? (
          <div className="quote-workspace__empty">No hay inventario activo valorizado.</div>
        ) : filteredCount === 0 ? (
          <div className="quote-workspace__empty">No hay resultados para los filtros aplicados.</div>
        ) : (
          <div className="quote-catalog__list">
            {valuations.map((valuation) => {
              const quantity = itemQuantityById[valuation.itemId] || 0;
              const description = valuation.descripcion || valuation.item?.descripcion || "";
              return (
                <article key={valuation.itemId} className="quote-catalog__item">
                  <div className="quote-catalog__identity">
                    <strong>{valuation.nombre}</strong>
                    <span>{getCatalogCode(valuation)} · {TYPE_LABELS[valuation.tipoItem] || valuation.tipoItem || "Ítem"} · {valuation.unidad || valuation.item?.unidad || "Sin unidad"}</span>
                    {valuation.categoria && <span>{valuation.categoria}</span>}
                    {description && <p title={description}>{description}</p>}
                  </div>
                  <div className="quote-catalog__price">
                    <small>Precio</small>
                    <strong>{formatCLP(valuation.precioInterno)}</strong>
                  </div>
                  <div className="quote-catalog__add">
                    {quantity > 0 && <span>Agregado: {quantity}</span>}
                    <button
                      type="button"
                      className="quote-workspace__button quote-workspace__button--secondary quote-workspace__button--compact"
                      onClick={() => onAdd(valuation)}
                    >
                      {quantity > 0 ? "Agregar otra vez" : "Agregar"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {(catalogHasMoreItems || catalogShowingAllItems) && (
          <div className="quote-catalog__pagination">
            <button
              type="button"
              className="quote-workspace__button quote-workspace__button--secondary"
              onClick={catalogHasMoreItems ? onShowMore : onShowLess}
            >
              {catalogHasMoreItems ? "Mostrar más" : "Mostrar menos"}
            </button>
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}

export default QuoteCatalogDialog;
