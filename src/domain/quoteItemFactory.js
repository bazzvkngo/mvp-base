import {
  calculateQuoteLineTotal,
  calculateQuoteTotals,
  normalizeQuoteItem,
  normalizeQuoteItems,
} from "./quoteModel.mjs";

export {
  calculateQuoteLineTotal,
  calculateQuoteTotals,
  normalizeQuoteItem,
  normalizeQuoteItems,
};

function finiteNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function createQuoteItemFromValuation(valuation) {
  const inventoryItem = valuation?.item || {};
  const precioUnitarioEditable = Math.max(
    finiteNumber(valuation?.precioSugerido, valuation?.precioInterno || 0),
    0
  );
  const itemId = valuation?.itemId || inventoryItem.id || "";
  const cantidad = Math.max(finiteNumber(valuation?.cantidad, 1), 0) || 1;

  return normalizeQuoteItem(
    {
      lineaId: `linea-${itemId || "manual"}-${Date.now()}`,
      itemId,
      productoId: itemId,
      codigo:
        inventoryItem.codigoInterno ||
        inventoryItem.codigo ||
        inventoryItem.sku ||
        "",
      nombre: valuation?.nombre || inventoryItem.nombre || "Ítem sin nombre",
      descripcionComercial:
        inventoryItem.descripcion || valuation?.descripcion || "",
      tipoItem: valuation?.tipoItem || inventoryItem.tipoItem || "producto",
      categoria: valuation?.categoria || inventoryItem.categoria || "",
      unidad: valuation?.unidad || inventoryItem.unidad || "unidad",
      cantidad,
      precioSugerido: precioUnitarioEditable,
      precioUnitarioEditable,
      descuentoPorcentaje: 0,
      inventarioSnapshot: {
        inventarioId: itemId,
        codigoInterno:
          inventoryItem.codigoInterno ||
          inventoryItem.codigo ||
          inventoryItem.sku ||
          "",
        nombre: valuation?.nombre || inventoryItem.nombre || "Ítem sin nombre",
        descripcion: inventoryItem.descripcion || valuation?.descripcion || "",
        tipoItem: valuation?.tipoItem || inventoryItem.tipoItem || "producto",
        areaId: inventoryItem.areaId || "",
        areaNombre: inventoryItem.areaNombre || "",
        categoriaId: inventoryItem.categoriaId || "",
        categoria: valuation?.categoria || inventoryItem.categoria || "",
        unidad: valuation?.unidad || inventoryItem.unidad || "unidad",
        modeloInventarioVersion: inventoryItem.modeloInventarioVersion || null,
      },
    },
    0,
    { strict: true }
  );
}

export function inventoryItemToQuoteItem(item, cantidad = 1) {
  return createQuoteItemFromValuation({
    itemId: item?.id || "",
    item,
    nombre: item?.nombre,
    tipoItem: item?.tipoItem,
    categoria: item?.categoria,
    unidad: item?.unidad,
    cantidad,
    precioSugerido: item?.precioInterno ?? item?.precio ?? 0,
  });
}
