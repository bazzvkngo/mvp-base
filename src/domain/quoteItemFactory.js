export function inventoryItemToQuoteItem(item, cantidad = 1) {
  const precioUnitario = Number(item?.precio ?? item?.precioInterno ?? 0);
  const quantity = Number(cantidad) || 1;

  return {
    productoId: item?.id || null,
    nombre: item?.nombre || "Item sin nombre",
    categoria: item?.categoria || "",
    unidad: item?.unidad || "unidad",
    cantidad: quantity,
    precioUnitario,
    subtotal: quantity * precioUnitario,
  };
}
