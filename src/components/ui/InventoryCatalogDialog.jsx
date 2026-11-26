import React from "react";
import {CATALOG_ITEM_TYPE_LABELS, filterCatalogEntries} from "../../domain/inventoryLineAdd.mjs";
import {useBusinessMoney} from "../../hooks/useBusinessFormat";
import Button from "./Button";
import LoadingState from "./LoadingState";
import ResponsiveDialog from "./ResponsiveDialog";

// Diálogo "Agregar desde inventario" de Venta, Cotización y Compra. Solo muestra y recoge la cantidad: la regla de
// reagrupar y el tope por stock (solo Venta) las aplica cada pantalla en `onAdd` con inventoryLineAdd.mjs.
// - entries: ver catalogEntryFromInventoryItem / catalogEntryFromValuation (dominio).
// - addedQuantities: cantidad ya presente en el documento por id de ítem (contador "Agregado: N").
// - priceLabel: "Precio" (Venta, Cotización) o "Costo" (Compra).
// - minQuantity: cantidad mínima que acepta el campo (cada pantalla conserva la suya).
// - onAdd(source, cantidad): `source` es el ítem original de la entrada.
const PAGE_SIZE = 20;

function InventoryCatalogDialog({addedQuantities = {}, entries, loading = false, minQuantity = 0.000001, onAdd, onClose, open, priceLabel = "Precio"}) {
  const money = useBusinessMoney();
  const searchRef = React.useRef(null);
  const [search, setSearch] = React.useState("");
  const [type, setType] = React.useState("todos");
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  // Texto del campo de cantidad por ítem. Sin valor es 1; tras agregar vuelve a 1. Acepta decimales (step="any"):
  // la unidad no limita la cantidad en estas pantallas, solo `minQuantity`.
  const [quantities, setQuantities] = React.useState({});

  const activeEntries = React.useMemo(() => (entries || []).filter((entry) => entry.activo), [entries]);
  const filtered = React.useMemo(() => filterCatalogEntries(entries, {search, type}), [entries, search, type]);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const showingAll = filtered.length > PAGE_SIZE && !hasMore;

  const quantityOf = (id) => quantities[id] ?? "1";
  const isValidQuantity = (id) => {
    const value = Number(quantityOf(id));
    return Number.isFinite(value) && value > 0 && value >= minQuantity;
  };
  const add = (entry) => {
    if (!isValidQuantity(entry.id)) return;
    onAdd(entry.source, Number(quantityOf(entry.id)));
    setQuantities((current) => ({...current, [entry.id]: "1"}));
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      size="large"
      title="Agregar desde inventario"
      description="Ítems activos del negocio."
      initialFocusRef={searchRef}
      className="ui-inventory-catalog-dialog"
      footer={<Button type="button" variant="secondary" onClick={onClose}>Cerrar</Button>}
    >
      <div className="ui-inventory-catalog">
        <div className="ui-inventory-catalog__toolbar">
          <label className="ui-inventory-catalog__field">
            <span>Buscar</span>
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => { setSearch(event.target.value); setVisibleCount(PAGE_SIZE); }}
              placeholder="Nombre, código o categoría"
            />
          </label>
          <label className="ui-inventory-catalog__field">
            <span>Tipo</span>
            <select value={type} onChange={(event) => { setType(event.target.value); setVisibleCount(PAGE_SIZE); }}>
              <option value="todos">Todos</option>
              <option value="producto">Productos</option>
              <option value="servicio">Servicios</option>
              <option value="actividad">Actividades</option>
            </select>
          </label>
          <p className="ui-inventory-catalog__count" aria-live="polite">
            <strong>{filtered.length}</strong> de {activeEntries.length} resultados
          </p>
        </div>

        {loading ? (
          <LoadingState variant="section" label="Cargando inventario…" />
        ) : activeEntries.length === 0 ? (
          <div className="ui-inventory-catalog__empty">No hay ítems activos en el inventario.</div>
        ) : filtered.length === 0 ? (
          <div className="ui-inventory-catalog__empty">No hay resultados para los filtros aplicados.</div>
        ) : (
          <div className="ui-inventory-catalog__list">
            {visible.map((entry) => {
              const added = Number(addedQuantities[entry.id] || 0);
              const meta = [
                entry.codigo || "Sin código",
                CATALOG_ITEM_TYPE_LABELS[entry.tipoItem] || "Ítem",
                entry.unidad,
                entry.tipoItem === "producto" && entry.stock !== null ? `Stock disponible: ${entry.stock}` : "",
              ].filter(Boolean).join(" · ");
              return (
                <article key={entry.id} className="ui-inventory-catalog__row">
                  <div className="ui-inventory-catalog__identity">
                    <strong>{entry.nombre}</strong>
                    <span>{meta}</span>
                    {entry.categoria && <span>{entry.categoria}</span>}
                    {entry.descripcion && <p title={entry.descripcion}>{entry.descripcion}</p>}
                  </div>
                  <div className="ui-inventory-catalog__price">
                    <small>{priceLabel}</small>
                    <strong>{money(entry.precio)}</strong>
                  </div>
                  <div className="ui-inventory-catalog__add">
                    {added > 0 && <span className="ui-inventory-catalog__added">Agregado: {added}</span>}
                    <div className="ui-inventory-catalog__add-controls">
                      <input
                        aria-label={`Cantidad de ${entry.nombre}`}
                        type="number"
                        min={minQuantity}
                        step="any"
                        inputMode="decimal"
                        value={quantityOf(entry.id)}
                        onChange={(event) => setQuantities((current) => ({...current, [entry.id]: event.target.value}))}
                        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(entry); } }}
                      />
                      <Button type="button" variant="secondary" disabled={!isValidQuantity(entry.id)} onClick={() => add(entry)}>
                        {added > 0 ? "Agregar otra vez" : "Agregar"}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {(hasMore || showingAll) && (
          <div className="ui-inventory-catalog__pagination">
            <Button type="button" variant="secondary" onClick={() => setVisibleCount(hasMore ? visibleCount + PAGE_SIZE : PAGE_SIZE)}>
              {hasMore ? "Mostrar más" : "Mostrar menos"}
            </Button>
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}

export default InventoryCatalogDialog;
