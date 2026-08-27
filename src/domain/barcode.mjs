export const BARCODE_MAX_LENGTH = 120;

export function normalizeBarcode(value) {
  return String(value ?? "").trim().slice(0, BARCODE_MAX_LENGTH);
}

export function incrementScannedItem(items, itemId, createItem) {
  const source = Array.isArray(items) ? items : [];
  const normalizedItemId = String(itemId || "").trim();
  const existingIndex = source.findIndex((item) =>
    String(item?.itemId || item?.productoId || "").trim() === normalizedItemId
  );
  if (existingIndex < 0) return [...source, createItem()];
  return source.map((item, index) => index === existingIndex
    ? {...item, cantidad: Number(item.cantidad || 0) + 1}
    : item
  );
}

export function stopBarcodeCamera(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}
