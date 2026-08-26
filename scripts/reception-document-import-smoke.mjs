import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyReceptionImportRows,
  buildReceptionDocumentSource,
  buildReceptionImportPreview,
  getReceptionImportSummary,
  updateReceptionImportRow,
} from "../src/domain/receptionDocumentImport.mjs";

const receptionItems = [
  {lineaId: "oc-line-1", itemId: "inventory-1", codigo: "SKU-A", nombre: "Producto A", cantidadSolicitada: 5, cantidadRecibidaAnterior: 0, cantidad: 0, costoUnitario: 1000, descuentoPct: 0},
  {lineaId: "oc-line-2", itemId: "inventory-2", codigo: "SKU-B", nombre: "Cable industrial", cantidadSolicitada: 3, cantidadRecibidaAnterior: 0, cantidad: 0, costoUnitario: 500, descuentoPct: 0},
  {lineaId: "oc-line-3", itemId: "inventory-3", codigo: "SKU-C", nombre: "Cable industrial", cantidadSolicitada: 3, cantidadRecibidaAnterior: 0, cantidad: 0, costoUnitario: 600, descuentoPct: 0},
];

const preview = buildReceptionImportPreview([
  {id: "doc-1", inventoryId: "inventory-1", nombre: "Producto A", cantidadOrigen: 4, costoBase: 1200},
  {id: "doc-2", nombre: "Cable industrial", cantidadOrigen: 2, costoBase: 550},
  {id: "doc-3", nombre: "Producto desconocido", cantidadOrigen: 1, costoBase: 900},
], receptionItems);

assert.equal(preview[0].selectedLineId, "oc-line-1");
assert.equal(preview[0].matchKind, "item_id");
assert.equal(preview[0].estado, "coincidencia");
assert.equal(preview[1].selectedLineId, "");
assert.equal(preview[1].estado, "revisar");
assert.match(preview[1].advertencias.join(" "), /más de una coincidencia/i);
assert.equal(preview[2].estado, "sin_asociar");
assert.deepEqual(getReceptionImportSummary(preview), {total: 3, asociadas: 1, revisar: 1, sinAsociar: 2});

const manuallyMatched = updateReceptionImportRow(preview, "doc-2", "selectedLineId", "oc-line-2");
assert.equal(manuallyMatched[1].estado, "coincidencia");
const applied = applyReceptionImportRows(receptionItems, manuallyMatched);
assert.equal(applied.items[0].cantidad, 4);
assert.equal(applied.items[0].costoUnitario, 1200);
assert.equal(applied.items[1].cantidad, 2);
assert.equal(applied.items[2].cantidad, 0);
assert.equal(applied.aplicadas, 2);
assert.equal(applied.omitidas, 1);
assert.throws(() => applyReceptionImportRows(receptionItems, [
  {...preview[0], cantidad: 6},
]), /supera lo pendiente/i);

const source = buildReceptionDocumentSource({
  kind: "document",
  nombreArchivo: "factura-sintetica.pdf",
  tipoArchivo: "application/pdf",
  extension: "pdf",
  tamanoBytes: 2048,
  base64: "NO_DEBE_PERSISTIR",
}, {documentType: "factura", warnings: ["Revisar datos"]}, {
  numeroDocumento: "F-123",
  fechaDocumento: "2026-08-26",
}, manuallyMatched);
assert.equal(source.tipoDocumento, "factura");
assert.equal(source.numeroDocumento, "F-123");
assert.equal(source.lineasAplicadas, 2);
assert.equal(Object.hasOwn(source, "base64"), false);

const dialogSource = fs.readFileSync("src/features/receptions/ReceptionDocumentImportDialog.jsx", "utf8");
const pageSource = fs.readFileSync("src/pages/NewReceptionPage.jsx", "utf8");
const backendSource = fs.readFileSync("functions/receptionPersistence.js", "utf8");
const purchaseSource = fs.readFileSync("functions/purchasePersistence.js", "utf8");
assert.match(dialogSource, /normalizeInventorySourceWithAi/);
assert.match(dialogSource, /readInventorySourceFile/);
assert.doesNotMatch(dialogSource, /confirmInventoryImportV2|confirmLocalInventoryImport|confirmarRecepcion/);
assert.match(pageSource, /Importar factura o documento/);
assert.match(pageSource, /Aún no se modificó el stock/);
assert.match(backendSource, /normalizeDocumentSource/);
assert.match(purchaseSource, /documentoOrigen: reception\.documentoOrigen/);

console.log("Reception document import smoke: OK");
