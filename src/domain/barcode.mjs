export const BARCODE_MAX_LENGTH = 120;
export const BARCODE_FORMATS = Object.freeze([
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
]);
export const BARCODE_DUPLICATE_WINDOW_MS = 1500;

export function normalizeBarcode(value) {
  return String(value ?? "").trim().slice(0, BARCODE_MAX_LENGTH);
}

export async function getBarcodeCameraSupport({
  BarcodeDetectorClass = globalThis.BarcodeDetector,
  mediaDevices = globalThis.navigator?.mediaDevices,
} = {}) {
  if (typeof mediaDevices?.getUserMedia !== "function") {
    return {supported: false, reason: "camera-api-unavailable", formats: []};
  }
  if (typeof BarcodeDetectorClass !== "function") {
    return {supported: false, reason: "barcode-detector-unavailable", formats: []};
  }
  try {
    const supportedFormats = typeof BarcodeDetectorClass.getSupportedFormats === "function"
      ? await BarcodeDetectorClass.getSupportedFormats()
      : BARCODE_FORMATS;
    const formats = BARCODE_FORMATS.filter((format) => supportedFormats.includes(format));
    return formats.length
      ? {supported: true, reason: "", formats}
      : {supported: false, reason: "barcode-formats-unavailable", formats: []};
  } catch {
    return {supported: false, reason: "barcode-detector-error", formats: []};
  }
}

export function barcodeSupportMessage(reason) {
  if (reason === "camera-api-unavailable") {
    return "Este navegador o dispositivo no permite abrir la cámara. Usa el lector USB o ingresa el código manualmente.";
  }
  if (reason === "barcode-formats-unavailable") {
    return "Este navegador no puede leer los formatos compatibles. Usa el lector USB o ingresa el código manualmente.";
  }
  return "Este navegador no admite lectura de códigos con cámara. Usa el lector USB o ingresa el código manualmente.";
}

export function barcodeCameraErrorMessage(error) {
  const name = String(error?.name || "");
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name)) {
    return "No se autorizó la cámara. Habilita el permiso del sitio y vuelve a intentar, o ingresa el código manualmente.";
  }
  if (["NotFoundError", "DevicesNotFoundError"].includes(name)) {
    return "No se encontró una cámara en este dispositivo. Usa el lector USB o ingresa el código manualmente.";
  }
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(name)) {
    return "La cámara no está disponible o está siendo usada por otra aplicación. Ciérrala allí y vuelve a intentar.";
  }
  return "No se pudo iniciar la cámara. Puedes usar el lector USB o ingresar el código manualmente.";
}

export function isDuplicateBarcodeRead(previous, value, now = Date.now()) {
  const barcode = normalizeBarcode(value);
  return Boolean(
    barcode &&
    previous?.barcode === barcode &&
    Number.isFinite(previous?.readAt) &&
    now - previous.readAt >= 0 &&
    now - previous.readAt < BARCODE_DUPLICATE_WINDOW_MS
  );
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
