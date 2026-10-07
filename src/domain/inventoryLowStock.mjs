// Regla única de "stock bajo" para todo el sistema (decisión del dueño del
// negocio). Pura y sin dependencias: la usan inventoryMvp.mjs
// (summarizeInventory, isInventoryLowStock) y reportModel.mjs
// (getInventoryMetrics). Sólo evalúa el stock: qué ítems participan
// (producto, activo) lo decide cada llamador.
//
// - stockMinimo > 0: bajo cuando stock <= stockMinimo (manda sobre el umbral
//   general).
// - stockMinimo 0 o ausente: se usa settings.umbralStockBajo, sólo si
//   settings.alertasStockBajo no es false y el umbral es mayor que cero.
// - Ambos se comparan igual: stock <= valor.
// - alertasStockBajo = false apaga sólo el umbral general, nunca los mínimos
//   por producto. Sin settings, sólo cuenta el mínimo propio.
// - Mínimo 0 con stock 0 no es "stock bajo" por su mínimo (el agotado es un
//   evento aparte); sí puede serlo por el umbral general.
export function getGeneralLowStockThreshold(settings) {
  if (!settings || settings.alertasStockBajo === false) return 0;
  const threshold = Number(settings.umbralStockBajo);
  return Number.isFinite(threshold) && threshold > 0 ? threshold : 0;
}

export function isLowStockByRule(item, settings) {
  const stock = Number(item?.stock);
  if (!Number.isFinite(stock)) return false;
  const minimum = Number(item?.stockMinimo);
  const limit = Number.isFinite(minimum) && minimum > 0
    ? minimum
    : getGeneralLowStockThreshold(settings);
  return limit > 0 && stock <= limit;
}
