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
    return {
      supported: false,
      reason: "camera-api-unavailable",
      decoder: "manual",
      formats: [],
    };
  }
  if (typeof BarcodeDetectorClass === "function") {
    try {
      const supportedFormats = typeof BarcodeDetectorClass.getSupportedFormats === "function"
        ? await BarcodeDetectorClass.getSupportedFormats()
        : BARCODE_FORMATS;
      const formats = BARCODE_FORMATS.filter((format) => supportedFormats.includes(format));
      if (formats.length === BARCODE_FORMATS.length) {
        return {supported: true, reason: "", decoder: "native", formats};
      }
    } catch {
      // La cámara sigue disponible mediante el decoder JS acotado a barras 1D.
    }
  }
  return {
    supported: true,
    reason: "",
    decoder: "zxing",
    formats: [...BARCODE_FORMATS],
  };
}

export function barcodeSupportMessage(reason) {
  return reason === "camera-api-unavailable"
    ? "Este navegador o dispositivo no permite abrir la cámara. Usa el lector USB o ingresa el código manualmente."
    : "No se pudo preparar el lector de códigos. Usa el lector USB o ingresa el código manualmente.";
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
