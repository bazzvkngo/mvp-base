import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  barcodeCameraErrorMessage,
  barcodeSupportMessage,
  getBarcodeCameraSupport,
  incrementScannedItem,
  isDuplicateBarcodeRead,
  normalizeBarcode,
  stopBarcodeCamera,
} from "../src/domain/barcode.mjs";
import {
  createBarcodeDecoderSession,
  isBarcodeVideoReady,
  isZxingRetryableError,
  NATIVE_DECODER_FALLBACK_MS,
  waitForBarcodeVideoReady,
} from "../src/services/barcodeDecoder.js";

assert.equal(normalizeBarcode(" 0012345678905\n"), "0012345678905");
assert.equal(normalizeBarcode(""), "");

const unsupportedCamera = await getBarcodeCameraSupport({
  BarcodeDetectorClass: class Detector {},
  mediaDevices: {},
});
assert.deepEqual(unsupportedCamera, {
  supported: false,
  reason: "camera-api-unavailable",
  decoder: "manual",
  formats: [],
});

class SupportedDetector {
  static async getSupportedFormats() {
    return ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"];
  }
}
const supportedCamera = await getBarcodeCameraSupport({
  BarcodeDetectorClass: SupportedDetector,
  mediaDevices: {getUserMedia() {}},
});
assert.deepEqual(supportedCamera, {
  supported: true,
  reason: "",
  decoder: "native",
  formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
});
const fallbackCamera = await getBarcodeCameraSupport({
  BarcodeDetectorClass: undefined,
  mediaDevices: {getUserMedia() {}},
});
assert.deepEqual(fallbackCamera, {
  supported: true,
  reason: "",
  decoder: "zxing",
  formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
});
const unverifiableNativeCamera = await getBarcodeCameraSupport({
  BarcodeDetectorClass: class DetectorWithoutFormatProbe {},
  mediaDevices: {getUserMedia() {}},
});
assert.equal(unverifiableNativeCamera.decoder, "zxing");
assert.match(barcodeSupportMessage("camera-api-unavailable"), /lector USB/);
assert.match(barcodeCameraErrorMessage({name: "NotAllowedError"}), /Habilita el permiso/);
assert.match(barcodeCameraErrorMessage({name: "NotFoundError"}), /No se encontró una cámara/);
assert.equal(isDuplicateBarcodeRead({barcode: "001234", readAt: 1000}, "001234", 2000), true);
assert.equal(isDuplicateBarcodeRead({barcode: "001234", readAt: 1000}, "001234", 2500), false);
assert.equal(isDuplicateBarcodeRead({barcode: "001234", readAt: 1000}, "987", 1100), false);

const created = incrementScannedItem([], "product-1", () => ({
  lineaId: "line-1",
  itemId: "product-1",
  cantidad: 1,
  costoUnitario: 100,
  descuentoPct: 5,
}));
const incremented = incrementScannedItem(created, "product-1", () => {
  throw new Error("No debe crear una segunda línea.");
});
assert.equal(incremented.length, 1);
assert.equal(incremented[0].cantidad, 2);
assert.equal(incremented[0].costoUnitario, 100);
assert.equal(incremented[0].descuentoPct, 5);

let stopped = 0;
stopBarcodeCamera({getTracks: () => [
  {stop: () => { stopped += 1; }},
  {stop: () => { stopped += 1; }},
]});
assert.equal(stopped, 2, "Cerrar el escáner debe detener todas las pistas.");

const readyVideo = {readyState: 2, videoWidth: 1280, videoHeight: 720};

// A. Native detecta y entrega el valor sin crear ZXing.
const nativeCreates = [];
const nativeSession = await createBarcodeDecoderSession({
  decoder: "native",
  formats: supportedCamera.formats,
  createDecoder: async ({decoder}) => {
    nativeCreates.push(decoder);
    return {kind: decoder, detect: async () => "0012345678905", stop() {}};
  },
  now: () => 0,
});
assert.equal(await nativeSession.detect(readyVideo), "0012345678905");
assert.deepEqual(nativeCreates, ["native"]);
nativeSession.stop();

// B y C. La ventana depende del reloj; native se detiene antes de crear ZXing y ZXing se acepta.
let scanClock = 0;
const decoderEvents = [];
const fallbackSession = await createBarcodeDecoderSession({
  decoder: "native",
  formats: supportedCamera.formats,
  now: () => scanClock,
  createDecoder: async ({decoder}) => {
    decoderEvents.push(`create:${decoder}`);
    return decoder === "native"
      ? {
          kind: "native",
          detect: async () => "",
          stop: () => decoderEvents.push("stop:native"),
        }
      : {
          kind: "zxing",
          detect: async () => " 00012345 ",
          stop: () => decoderEvents.push("stop:zxing"),
        };
  },
  onFallback: () => decoderEvents.push("fallback"),
});
assert.equal(await fallbackSession.detect(readyVideo), "");
assert.equal(fallbackSession.kind, "native");
scanClock = NATIVE_DECODER_FALLBACK_MS + 1;
assert.equal(await fallbackSession.detect(readyVideo), "");
assert.equal(fallbackSession.kind, "zxing");
assert.deepEqual(decoderEvents.slice(0, 4), [
  "create:native",
  "stop:native",
  "create:zxing",
  "fallback",
]);
assert.equal(normalizeBarcode(await fallbackSession.detect(readyVideo)), "00012345");

// D. NotFound/Checksum/Format de ZXing son reintentos normales.
const {
  ChecksumException,
  FormatException,
  NotFoundException,
} = await import("@zxing/library");
const retryableTypes = [NotFoundException, ChecksumException, FormatException];
for (const RetryableError of retryableTypes) {
  assert.equal(isZxingRetryableError(new RetryableError(), retryableTypes), true);
}
assert.equal(isZxingRetryableError(new Error("inesperado"), retryableTypes), false);

// E. No se decodifica hasta tener estado y dimensiones reales del video.
let earlyDetectCalls = 0;
const waitingSession = await createBarcodeDecoderSession({
  decoder: "zxing",
  formats: supportedCamera.formats,
  createDecoder: async () => ({
    kind: "zxing",
    detect: async () => { earlyDetectCalls += 1; return "123"; },
    stop() {},
  }),
});
assert.equal(isBarcodeVideoReady({readyState: 1, videoWidth: 0, videoHeight: 0}), false);
assert.equal(await waitingSession.detect({readyState: 1, videoWidth: 0, videoHeight: 0}), "");
assert.equal(earlyDetectCalls, 0);
class MockVideo extends EventTarget {
  readyState = 1;
  videoWidth = 0;
  videoHeight = 0;
}
const loadingVideo = new MockVideo();
let videoReadyResolved = false;
const videoReadyPromise = waitForBarcodeVideoReady(loadingVideo).then(() => {
  videoReadyResolved = true;
});
await Promise.resolve();
assert.equal(videoReadyResolved, false);
loadingVideo.readyState = 2;
loadingVideo.videoWidth = 1280;
loadingVideo.videoHeight = 720;
loadingVideo.dispatchEvent(new Event("loadeddata"));
await videoReadyPromise;
assert.equal(videoReadyResolved, true);
waitingSession.stop();

// F. Cerrar detiene el decoder; el stream y los recursos del loop se validan abajo.
fallbackSession.stop();
assert.equal(decoderEvents.at(-1), "stop:zxing");

// G. Una sesión nunca ejecuta dos intentos de decoder simultáneamente.
let activeDecodes = 0;
let maxActiveDecodes = 0;
let finishDecode;
const exclusiveSession = await createBarcodeDecoderSession({
  decoder: "native",
  formats: supportedCamera.formats,
  now: () => 0,
  createDecoder: async () => ({
    kind: "native",
    async detect() {
      activeDecodes += 1;
      maxActiveDecodes = Math.max(maxActiveDecodes, activeDecodes);
      const result = await new Promise((resolve) => { finishDecode = resolve; });
      activeDecodes -= 1;
      return result;
    },
    stop() {},
  }),
});
const firstDetection = exclusiveSession.detect(readyVideo);
assert.equal(await exclusiveSession.detect(readyVideo), "");
finishDecode("987654321");
assert.equal(await firstDetection, "987654321");
assert.equal(maxActiveDecodes, 1);
exclusiveSession.stop();

const [scanner, decoder, inventoryService, inventoryUi, quotePage, quoteEditor, poPage, poEditor] =
  await Promise.all([
    readFile(new URL("../src/components/barcode/BarcodeInput.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/barcodeDecoder.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/inventoryService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/inventory/InventoryManager.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/NewQuotePage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/quotes/QuoteItemsEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/NewPurchaseOrderPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/purchaseOrders/PurchaseOrderItemsEditor.jsx", import.meta.url), "utf8"),
  ]);

assert.match(decoder, /BarcodeDetector/);
assert.match(scanner, /getUserMedia/);
assert.match(scanner, /releaseCamera\(\)/);
assert.match(scanner, /event\.key !== "Enter"/);
assert.match(scanner, /getBarcodeCameraSupport/);
assert.match(scanner, /isDuplicateBarcodeRead/);
assert.match(scanner, /getUserMedia[\s\S]*createBarcodeDecoderSession/);
assert.match(scanner, /width: \{ideal: 1280\}/);
assert.match(scanner, /height: \{ideal: 720\}/);
assert.match(scanner, /focusMode\.includes\("continuous"\)/);
assert.match(scanner, /waitForBarcodeVideoReady/);
assert.match(scanner, /import\.meta\.env\.DEV/);
assert.match(scanner, /cancelAnimationFrame/);
assert.match(scanner, /clearTimeout/);
assert.match(scanner, /cameraAbortRef\.current\?\.abort/);
assert.match(scanner, /decoderRef\.current\?\.stop/);
assert.match(scanner, /stopBarcodeCamera/);
assert.match(decoder, /decoder === "native"/);
assert.match(decoder, /NATIVE_DECODER_FALLBACK_MS = 2000/);
assert.match(decoder, /currentDecoder = null;[\s\S]*decoderAtStart\.stop[\s\S]*decoder: "zxing"/);
assert.match(decoder, /import\("@zxing\/library"\)/);
for (const format of ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128"]) {
  assert.match(decoder, new RegExp(format));
}
assert.doesNotMatch(decoder, /QR_CODE/);
assert.match(inventoryService, /where\("barcode", "==", barcode\)/);
assert.match(inventoryService, /where\("codigoBarras", "==", barcode\)/);
assert.doesNotMatch(inventoryService, /findActiveProductByBarcode[\s\S]*?getInventoryItems/);
assert.match(inventoryUi, /Código de barras/);
assert.match(inventoryUi, /BarcodeInput/);
assert.match(quoteEditor, /Escanear producto/);
assert.match(quotePage, /Producto no encontrado para este código\./);
assert.match(quotePage, /Number\(item\.cantidad \|\| 0\) \+ quantityToAdd/);
assert.match(poEditor, /Escanear producto/);
assert.match(poPage, /incrementScannedItem/);
assert.match(poPage, /Producto no encontrado para este código\./);
assert.doesNotMatch(`${quotePage}\n${poPage}`, /crear.*producto.*barcode/i);

console.log("BARCODE_SMOKE_OK");
