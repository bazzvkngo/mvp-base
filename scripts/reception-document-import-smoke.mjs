import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyReceptionImportRows,
  buildReceptionDocumentSource,
  buildReceptionImportPreview,
  getReceptionImportedProviderStatus,
  getReceptionImportRowReason,
  getReceptionImportSummary,
  getReceptionOrderImportSummary,
  updateReceptionImportRow,
} from "../src/domain/receptionDocumentImport.mjs";

const receptionItems = [
  {lineaId: "oc-line-1", itemId: "inventory-1", codigo: "SKU-A", nombre: "Producto A", cantidadSolicitada: 5, cantidadRecibidaAnterior: 0, cantidad: 0, costoUnitario: 1000, descuentoPct: 0},
  {lineaId: "oc-line-2", itemId: "inventory-2", codigo: "SKU-B", nombre: "Cable industrial", cantidadSolicitada: 3, cantidadRecibidaAnterior: 0, cantidad: 0, costoUnitario: 500, descuentoPct: 0, inventarioSnapshot: {codigoProveedor: "PROV-B"}},
  {lineaId: "oc-line-3", itemId: "inventory-3", codigo: "SKU-C", nombre: "Cable industrial", cantidadSolicitada: 3, cantidadRecibidaAnterior: 0, cantidad: 0, costoUnitario: 600, descuentoPct: 0},
];

const preview = buildReceptionImportPreview([
  {id: "doc-1", inventoryId: "inventory-1", nombre: "Producto A", cantidadOrigen: 4, costoBase: 1200},
  {id: "doc-2", nombre: "Cable industrial", cantidadOrigen: 2, costoBase: 550},
  {id: "doc-3", nombre: "Producto desconocido", cantidadOrigen: 1, costoBase: 900},
  {id: "doc-4", codigoProveedor: "PROV-B", nombre: "Nombre distinto", cantidadOrigen: 1, costoBase: 600},
], receptionItems);

assert.equal(preview[0].selectedLineId, "oc-line-1");
assert.equal(preview[0].matchKind, "item_id");
assert.equal(preview[0].estado, "revisar");
assert.match(getReceptionImportRowReason(preview[0], receptionItems), /costo unitario difiere/i);
assert.equal(preview[1].selectedLineId, "");
assert.equal(preview[1].estado, "revisar");
assert.match(preview[1].advertencias.join(" "), /más de una coincidencia/i);
assert.equal(preview[2].estado, "sin_asociar");
assert.equal(preview[3].selectedLineId, "oc-line-2");
assert.equal(preview[3].matchKind, "codigo_proveedor");
assert.deepEqual(getReceptionImportSummary(preview), {total: 4, asociadas: 2, revisar: 3, sinAsociar: 2});
assert.deepEqual(getReceptionOrderImportSummary(preview, receptionItems), {solicitados: 3, identificados: 2, pendientes: 1});

const manuallyMatched = updateReceptionImportRow(preview, "doc-2", "selectedLineId", "oc-line-2", receptionItems);
assert.equal(manuallyMatched[1].estado, "revisar");
assert.match(getReceptionImportRowReason(manuallyMatched[1], receptionItems), /costo unitario difiere/i);
const applied = applyReceptionImportRows(receptionItems, manuallyMatched);
assert.equal(applied.items[0].cantidad, 4);
assert.equal(applied.items[0].costoUnitario, 1200);
assert.equal(applied.items[1].cantidad, 3);
assert.equal(applied.items[1].documentoLineas.some((line) => line.codigoProveedor === "PROV-B"), true);
assert.equal(applied.items[2].cantidad, 0);
assert.equal(applied.aplicadas, 3);
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
assert.equal(source.lineasAplicadas, 3);
assert.equal(Object.hasOwn(source, "base64"), false);

const detailedSource = buildReceptionDocumentSource({
  kind: "document",
  nombreArchivo: "factura-sintetica.pdf",
  tipoArchivo: "application/pdf",
  extension: "pdf",
  tamanoBytes: 2048,
}, {
  documentType: "factura",
  proveedor: {nombre: "Proveedor QA", identificadorFiscal: "11.111.111-1"},
  receptor: {nombre: "Receptor QA", identificadorFiscal: "22.222.222-2"},
  documento: {moneda: "CLP"},
  totales: {neto: 1000, impuestoPorcentaje: 19, impuestoMonto: 190, total: 1190},
  coherencia: {estado: "coherente"},
}, {}, manuallyMatched);
assert.equal(detailedSource.proveedorDocumento.nombre, "Proveedor QA");
assert.equal(detailedSource.receptorDocumento.nombre, "Receptor QA");
assert.equal(detailedSource.moneda, "CLP");
assert.equal(detailedSource.total, 1190);
assert.equal(detailedSource.coherenciaEstado, "coherente");
assert.deepEqual(getReceptionImportedProviderStatus(
  {proveedor: {identificadorFiscal: "93.772.000-9"}},
  {rut: "93.772.000-9"}
), {estado: "coincidencia", mensaje: "Proveedor reconocido por identificador fiscal."});
assert.equal(getReceptionImportedProviderStatus(
  {proveedor: {nombre: "Mismo nombre", identificadorFiscal: "77.091.679-8"}},
  {razonSocial: "Mismo nombre", rut: "93.772.000-9"}
).estado, "otro_proveedor");
assert.equal(getReceptionImportedProviderStatus(
  {proveedor: {nombre: "Sin RUT"}},
  {razonSocial: "Proveedor QA", rut: "93.772.000-9"}
).estado, "no_identificado");

const dialogSource = fs.readFileSync("src/features/receptions/ReceptionDocumentImportDialog.jsx", "utf8");
const pageSource = fs.readFileSync("src/pages/NewReceptionPage.jsx", "utf8");
const backendSource = fs.readFileSync("functions/receptionPersistence.js", "utf8");
const purchaseSource = fs.readFileSync("functions/purchasePersistence.js", "utf8");
assert.match(dialogSource, /normalizeInventorySourceWithAi/);
assert.match(dialogSource, /context: "reception"/);
assert.match(dialogSource, /El documento corresponde a otro proveedor|providerStatus\.mensaje/);
assert.match(dialogSource, /Cambiar archivo/);
assert.match(dialogSource, /Continuar con revisión manual/);
assert.match(dialogSource, /Leyendo documento…/);
assert.match(dialogSource, /Documento/);
assert.match(dialogSource, /Orden/);
assert.match(dialogSource, /Revisar totales/);
assert.match(dialogSource, /`IVA \(\$\{fields\.impuestoPorcentaje\}%\)`/);
assert.match(dialogSource, /readInventorySourceFile/);
assert.doesNotMatch(dialogSource, /confirmInventoryImportV2|confirmLocalInventoryImport|confirmarRecepcion/);
assert.match(pageSource, /Importar factura o documento/);
assert.match(pageSource, /draft\.documentoOrigen\.neto/);
assert.match(pageSource, /draft\.documentoOrigen\.impuestoPorcentaje/);
assert.match(pageSource, /draft\.documentoOrigen\.total/);
assert.match(pageSource, /Aún no se modificó el stock/);
assert.match(backendSource, /normalizeDocumentSource/);
assert.match(purchaseSource, /documentoOrigen: reception\.documentoOrigen/);

console.log("Reception document import smoke: OK");
