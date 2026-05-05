function toSafeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function calculateQuoteLineTotal(item) {
  const cantidad = Math.max(toSafeNumber(item?.cantidad, 0), 0);
  const precioUnitarioEditable = Math.max(
    toSafeNumber(item?.precioUnitarioEditable, 0),
    0
  );
  return Math.round(cantidad * precioUnitarioEditable);
}

export function calculateQuoteTotals(items, descuento = 0) {
  const subtotal = Array.isArray(items)
    ? items.reduce((sum, item) => sum + calculateQuoteLineTotal(item), 0)
    : 0;
  const descuentoSeguro = Math.min(
    Math.max(toSafeNumber(descuento, 0), 0),
    subtotal
  );

  return {
    subtotal,
    descuento: descuentoSeguro,
    total: Math.max(subtotal - descuentoSeguro, 0),
  };
}

export function normalizeQuoteItems(items) {
  return Array.isArray(items)
    ? items.map((item) => ({
        ...item,
        cantidad: Math.max(toSafeNumber(item.cantidad, 1), 0),
        precioUnitarioEditable: Math.max(
          toSafeNumber(item.precioUnitarioEditable, 0),
          0
        ),
        totalLinea: calculateQuoteLineTotal(item),
      }))
    : [];
}

export function createQuoteItemFromValuation(valuation) {
  const cantidad = 1;
  const precioUnitarioEditable = toSafeNumber(valuation?.precioSugerido, 0);

  return {
    itemId: valuation?.itemId || "",
    nombre: valuation?.nombre || "Item sin nombre",
    descripcion: valuation?.item?.descripcion || valuation?.descripcion || "",
    tipoItem: valuation?.tipoItem || "",
    categoria: valuation?.categoria || "",
    unidad: valuation?.unidad || "unidad",
    cantidad,
    costoBase: toSafeNumber(valuation?.costoBase, 0),
    precioBase: toSafeNumber(valuation?.precioBase, 0),
    precioSugerido: toSafeNumber(valuation?.precioSugerido, 0),
    precioUnitarioEditable,
    totalLinea: cantidad * precioUnitarioEditable,
  };
}

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
