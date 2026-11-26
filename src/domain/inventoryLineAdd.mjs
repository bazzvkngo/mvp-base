// Agregar ítems del inventario a un documento (Venta, Cotización y Compra): reagrupado de líneas, tope opcional por
// stock y adaptadores para el diálogo compartido "Agregar desde inventario". Funciones puras, sin red.

const QUANTITY_SCALE = 1e6;
export const roundQuantity = (value) => Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE;

export const CATALOG_ITEM_TYPE_LABELS = Object.freeze({producto: "Producto", servicio: "Servicio", actividad: "Actividad"});

// Agrega `quantity` de un ítem del inventario a las líneas de un documento.
// - Suma a una línea existente solo si es "limpia": línea propia (no viene de un adicional ni de una cotización con
//   cantidad máxima), del mismo ítem, sin descuento y con el mismo precio que tendría la línea nueva (el precio
//   actual del inventario; `priceKey` es el campo de precio de la línea: precioUnitario, precioUnitarioEditable o
//   costoUnitario). Si no hay ninguna línea limpia, crea una nueva con `createLine()`. Con varias limpias suma a la
//   primera.
// - `stockLimit` (solo Venta): en productos con stock conocido, el total del ítem en el documento (todas sus líneas) no
//   supera el stock. Servicios, actividades y productos sin stock informado no tienen tope. Cotizar y comprar no
//   consumen stock: Cotización y Compra no lo activan.
// Devuelve {action: "added" | "incremented" | "stock_limit" | "invalid", items, available, limited}.
export function addInventoryItemToLines(lines, item, {itemId, quantity = 1, createLine, priceKey, discountKey = "descuentoPct", stockLimit = false} = {}) {
  const source = Array.isArray(lines) ? lines : [];
  const id = String(itemId || "").trim();
  const requested = Number(quantity);
  if (!id || !Number.isFinite(requested) || requested <= 0) return {action: "invalid", items: source, available: null, limited: false};
  const hasStock = stockLimit
    && (item?.tipoItem || "producto") === "producto"
    && item?.stock !== null && item?.stock !== undefined && item?.stock !== ""
    && Number.isFinite(Number(item.stock));
  const available = hasStock ? Number(item.stock) : null;
  let toAdd = requested;
  if (hasStock) {
    const inDocument = source.reduce((sum, line) => (String(line?.itemId || "").trim() === id ? sum + Number(line.cantidad || 0) : sum), 0);
    const remaining = roundQuantity(available - inDocument);
    if (remaining <= 0) return {action: "stock_limit", items: source, available, limited: true};
    toAdd = Math.min(requested, remaining);
  }
  const limited = toAdd < requested;
  const fresh = createLine();
  const price = Number(fresh[priceKey]);
  const index = source.findIndex((line) => !line?.origenAdicionalId
    && line?.cantidadCotizada == null
    && String(line?.itemId || "").trim() === id
    && Number(line[discountKey] || 0) === 0
    && Number(line[priceKey]) === price);
  if (index >= 0) {
    return {
      action: "incremented",
      items: source.map((line, position) => position === index ? {...line, cantidad: roundQuantity(Number(line.cantidad || 0) + toAdd)} : line),
      available,
      limited,
    };
  }
  return {action: "added", items: [...source, {...fresh, cantidad: toAdd}], available, limited};
}

// Cantidad total por ítem en las líneas de un documento (para el contador "Agregado: N" del diálogo).
export function sumQuantitiesByItem(lines) {
  const totals = {};
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const id = String(line?.itemId || "").trim();
    if (id) totals[id] = roundQuantity((totals[id] || 0) + Number(line.cantidad || 0));
  });
  return totals;
}

const finiteOrNull = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

// Ítem de inventario (Venta: precioInterno; Compra: costoBase) -> entrada del diálogo. `source` es el original que
// recibe onAdd.
export function catalogEntryFromInventoryItem(item, priceField) {
  return {
    id: item.id,
    nombre: item.nombre || "",
    codigo: item.codigoInterno || item.sku || "",
    tipoItem: item.tipoItem || "producto",
    unidad: item.unidad || "",
    categoria: item.categoria || "",
    descripcion: item.descripcion || "",
    precio: Number(item[priceField] || 0),
    stock: finiteOrNull(item.stock),
    activo: item.estado === "activo",
    source: item,
  };
}

// Valorización de la cotización -> entrada del diálogo (el precio es el precio interno valorizado).
export function catalogEntryFromValuation(valuation) {
  const inventoryItem = valuation?.item || {};
  return {
    id: valuation.itemId,
    nombre: valuation.nombre || inventoryItem.nombre || "",
    codigo: valuation.codigoInterno || valuation.codigo || valuation.sku || inventoryItem.codigoInterno || inventoryItem.codigo || inventoryItem.sku || "",
    tipoItem: valuation.tipoItem || inventoryItem.tipoItem || "producto",
    unidad: valuation.unidad || inventoryItem.unidad || "",
    categoria: valuation.categoria || inventoryItem.categoria || "",
    descripcion: valuation.descripcion || inventoryItem.descripcion || "",
    precio: Number(valuation.precioInterno || 0),
    stock: finiteOrNull(inventoryItem.stock),
    activo: true,
    source: valuation,
  };
}

export const normalizeCatalogText = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Activos que coinciden con la búsqueda (nombre, código o categoría) y el tipo.
export function filterCatalogEntries(entries, {search = "", type = "todos"} = {}) {
  const query = normalizeCatalogText(search).trim();
  return (Array.isArray(entries) ? entries : []).filter((entry) => entry.activo
    && (type === "todos" || entry.tipoItem === type)
    && (!query || normalizeCatalogText(`${entry.nombre} ${entry.codigo} ${entry.categoria}`).includes(query)));
}
