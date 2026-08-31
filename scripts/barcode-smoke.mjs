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
assert.match(scanner, /getUserMedia[\s\S]*createBarcodeFrameDecoder/);
assert.match(decoder, /decoder === "native"/);
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
