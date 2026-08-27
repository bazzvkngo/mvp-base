import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  incrementScannedItem,
  normalizeBarcode,
  stopBarcodeCamera,
} from "../src/domain/barcode.mjs";

assert.equal(normalizeBarcode(" 0012345678905\n"), "0012345678905");
assert.equal(normalizeBarcode(""), "");

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

const [scanner, inventoryService, inventoryUi, quotePage, quoteEditor, poPage, poEditor] =
  await Promise.all([
    readFile(new URL("../src/components/barcode/BarcodeInput.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/inventoryService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/inventory/InventoryManager.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/NewQuotePage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/quotes/QuoteItemsEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/NewPurchaseOrderPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/purchaseOrders/PurchaseOrderItemsEditor.jsx", import.meta.url), "utf8"),
  ]);

assert.match(scanner, /BarcodeDetector/);
assert.match(scanner, /getUserMedia/);
assert.match(scanner, /releaseCamera\(\)/);
assert.match(scanner, /event\.key !== "Enter"/);
assert.match(scanner, /ingresar el código manualmente/);
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
