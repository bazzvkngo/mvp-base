import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyPurchaseDocumentImport,
  buildPurchaseDocumentPreview,
  getPurchaseDocumentImportSummary,
  matchPurchaseDocumentProvider,
  updatePurchaseDocumentRow,
} from "../src/domain/purchaseDocumentImport.mjs";

const providers = [
  {proveedorId: "provider-fiscal", estado: "activo", razonSocial: "Proveedor Fiscal SpA", identificadorFiscalNormalizado: "760000000"},
  {proveedorId: "provider-name", estado: "activo", razonSocial: "Comercial del Norte Ltda."},
  {proveedorId: "provider-mx", estado: "activo", paisCodigo: "MX", razonSocial: "Proveedor México SA", identificadorFiscalValor: "ABC-010203-XY9"},
];
const inventory = [
  {id: "barcode-item", negocioId: "business", estado: "activo", tipoItem: "producto", nombre: "Producto Barcode", codigoInterno: "PR-001", barcode: "7801234567890", unidad: "unidad"},
  {id: "internal-item", negocioId: "business", estado: "activo", tipoItem: "servicio", nombre: "Servicio técnico", codigoInterno: "SV-002", unidad: "servicio"},
  {id: "name-item", negocioId: "business", estado: "activo", tipoItem: "producto", nombre: "Perno galvanizado 10 mm", codigoInterno: "PR-003", unidad: "unidad"},
];

const fiscalMatch = matchPurchaseDocumentProvider({proveedor: {nombre: "Otro texto", identificadorFiscal: "76.000.000-0"}}, providers);
assert.equal(fiscalMatch.estado, "vinculado");
assert.equal(fiscalMatch.proveedorId, "provider-fiscal");
assert.equal(fiscalMatch.criterio, "identificador_fiscal");
const nameMatch = matchPurchaseDocumentProvider({proveedor: {nombre: "Comercial del Norte"}}, providers);
assert.equal(nameMatch.estado, "revisar");
assert.equal(nameMatch.proveedorId, "provider-name");
assert.equal(matchPurchaseDocumentProvider({proveedor: {nombre: "Sin registro"}}, providers).estado, "sin_coincidencia");
const multiCountryMatch = matchPurchaseDocumentProvider({proveedor: {identificadorFiscal: "ABC010203XY9"}}, providers);
assert.equal(multiCountryMatch.proveedorId, "provider-mx");
assert.equal(multiCountryMatch.criterio, "identificador_fiscal");
console.log("OK importador compra: match proveedor fiscal, fallback de nombre y no autocreación");

const candidates = [
  {id: "row-barcode", nombre: "Texto OCR", codigoBarras: "7801234567890", cantidadOrigen: 2, costoUnitario: 1000, descuentoPct: 10},
  {id: "row-internal", nombre: "Servicio", sku: "SV-002", cantidadOrigen: 1, costoUnitario: 5000, descuentoPct: 0},
  {id: "row-name", nombre: "Perno galvanizado 10 mm", cantidadOrigen: 4, costoUnitario: 250, descuentoPct: 0},
  {id: "row-unmatched", nombre: "Producto inexistente", cantidadOrigen: 1, costoUnitario: 900, descuentoPct: 0},
];
let rows = buildPurchaseDocumentPreview(candidates, inventory);
assert.equal(rows[0].estado, "vinculada");
assert.equal(rows[0].matchKind, "barcode");
assert.equal(rows[1].estado, "vinculada");
assert.equal(rows[1].matchKind, "codigo_interno");
assert.equal(rows[2].estado, "revisar");
assert.equal(rows[3].estado, "sin_coincidencia");
assert.deepEqual(getPurchaseDocumentImportSummary(rows), {total: 4, vinculadas: 2, revisar: 1, sinCoincidencia: 1, lista: false});
assert.throws(() => applyPurchaseDocumentImport({rows, inventory, providers, selectedProviderId: "provider-fiscal"}), /Resuelve y revisa todas las líneas/);
const correctedProposal = updatePurchaseDocumentRow(rows, "row-barcode", "selectedItemId", "name-item", inventory);
assert.equal(correctedProposal[0].selectedItemId, "name-item");
assert.equal(correctedProposal[0].matchKind, "seleccion_manual");

rows = updatePurchaseDocumentRow(rows, "row-name", "revisionAceptada", true, inventory);
rows = updatePurchaseDocumentRow(rows, "row-unmatched", "selectedItemId", "name-item", inventory);
assert.equal(getPurchaseDocumentImportSummary(rows).lista, true);
const analysis = {
  documentType: "factura",
  documento: {numero: "F-100", fechaEmision: "2026-08-31", fechaVencimiento: "2026-09-30", condicionPago: "30 días", moneda: "CLP"},
  proveedor: {nombre: "Proveedor Fiscal SpA", identificadorFiscal: "76.000.000-0"},
  receptor: {nombre: "Empresa Compradora", identificadorFiscal: "76.500.500-5"},
  totales: {neto: 8000, impuestoPorcentaje: 19, impuestoMonto: 1520, total: 9520},
  coherencia: {estado: "coherente"},
  warnings: [],
};
const applied = applyPurchaseDocumentImport({
  analysis,
  fields: {
    tipoDocumento: "factura", numeroDocumento: "F-100", fechaDocumento: "2026-08-31",
    fechaVencimiento: "2026-09-30", condicionesPago: "30 días", moneda: "CLP",
    neto: 8000, impuestoPorcentaje: 19, impuestoMonto: 1520, total: 9520,
  },
  fileData: {nombreArchivo: "factura.pdf", tipoArchivo: "application/pdf", extension: "pdf", tamanoBytes: 4096},
  inventory,
  providerMatch: fiscalMatch,
  rows,
  selectedProviderId: "provider-fiscal",
});
assert.equal(applied.proveedorId, "provider-fiscal");
assert.equal(applied.items.length, 4);
assert.equal(applied.items[0].cantidad, 2);
assert.equal(applied.items[0].costoUnitario, 1000);
assert.equal(applied.items[0].descuentoPct, 10);
assert.equal(applied.documentoOrigen.lineasDetectadas, 4);
assert.equal(applied.documentoOrigen.lineasAplicadas, 4);
assert.equal(applied.documentoOrigen.impuestoMonto, 1520);
assert.equal(applied.documentoOrigen.total, 9520);
assert.equal(Object.hasOwn(applied.documentoOrigen, "base64"), false);
console.log("OK importador compra: vínculos revisados, cantidades/costos/descuentos y datos tributarios");

const dialog = fs.readFileSync(new URL("../src/features/purchases/PurchaseDocumentImportDialog.jsx", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../src/pages/NewPurchasePage.jsx", import.meta.url), "utf8");
const purchaseModel = fs.readFileSync(new URL("../src/domain/purchaseModel.mjs", import.meta.url), "utf8");
const inventoryDialog = fs.readFileSync(new URL("../src/features/inventory/InventoryImportDialog.jsx", import.meta.url), "utf8");
const inventoryManager = fs.readFileSync(new URL("../src/features/inventory/InventoryManager.jsx", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../src/services/inventoryAiImportService.js", import.meta.url), "utf8");
const backend = fs.readFileSync(new URL("../functions/purchasePersistence.js", import.meta.url), "utf8");
assert.match(dialog, /context: "purchase"/);
assert.match(dialog, /El stock sólo cambia al confirmar la compra/);
assert.match(dialog, /const PURCHASE_DOCUMENT_ACCEPT = "\.pdf,\.jpg,\.jpeg,\.png,\.webp"/);
assert.match(dialog, /accept=\{PURCHASE_DOCUMENT_ACCEPT\}/);
assert.doesNotMatch(dialog, /ACCEPTED_INVENTORY_FILE_TYPES|CSV|XLS|XLSX|planilla/i);
assert.doesNotMatch(dialog, /IVA/);
assert.match(dialog, /taxName = "Impuesto"/);
assert.match(page, /Importar factura/);
assert.match(page, /Factura importada y pendiente de confirmación/);
assert.match(page, /getPurchaseStockSemantics/);
assert.match(purchaseModel, /Al confirmar esta compra se incrementará el stock de los productos/);
assert.doesNotMatch(dialog, /crearProveedor|crearInventoryItem|confirmarCompra/);
assert.match(dialog, /stripInventoryDocumentPayload/);
assert.match(inventoryDialog, /const SPREADSHEET_ACCEPT = "\.csv,\.xls,\.xlsx"/);
assert.doesNotMatch(inventoryDialog, /onPurchaseDocument|readInventorySourceFile|PDF|JPG|PNG|WEBP/);
assert.match(inventoryManager, /navigate\("\/compras\/nueva", \{state: \{openPurchaseImport: true\}\}\)/);
assert.match(inventoryManager, /BUSINESS_PERMISSIONS\.PURCHASES_WRITE/);
assert.match(inventoryManager, /canStartPurchase && <button[^>]*>[\s\S]*?Importar factura/);
assert.match(service, /\["reception", "purchase"\]\.includes\(context\)/);
assert.match(backend, /lineasSinResolver/);
assert.match(backend, /tipoOrigen: isV3DirectPurchase \? "compra_directa"/);
console.log("OK importador compra: pipeline reutilizado, borrador explícito y confirmación separada");

console.log("Smoke del importador documental de Compras completado.");
