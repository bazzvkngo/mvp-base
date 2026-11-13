import assert from "node:assert/strict";
import fs from "node:fs";
import {
  acceptExactPurchaseDocumentMatches,
  applyPurchaseDocumentImport,
  buildPurchaseDocumentPreview,
  getPurchaseDocumentImportSummary,
  matchPurchaseDocumentProvider,
  selectExactPurchaseDocumentMatches,
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

// F1: "Aceptar coincidencias exactas". Los estados por defecto NO cambian (ver
// aserción de la línea 46: el nombre exacto nace "revisar"); aceptar es una
// acción aparte, con resumen y segundo clic.
const exactInventory = [
  {id: "ex-cable", estado: "activo", nombre: "Cable UTP Cat6 305 m", codigoInterno: "CB-001", unidad: "unidad"},
  {id: "ex-switch", estado: "activo", nombre: "Switch 24 puertos", codigoInterno: "SW-024", unidad: "unidad"},
  {id: "ex-router-a", estado: "activo", nombre: "Router doble banda", codigoInterno: "RT-001", unidad: "unidad"},
  {id: "ex-router-b", estado: "activo", nombre: "Router doble banda", codigoInterno: "RT-002", unidad: "unidad"},
  {id: "ex-panel", estado: "activo", nombre: "Patch panel 24 puertos", codigoInterno: "PP-024", unidad: "unidad"},
  {id: "ex-rack", estado: "activo", nombre: "Rack mural 12U", codigoInterno: "RK-012", unidad: "unidad"},
  {id: "ex-caja", estado: "activo", nombre: "Caja de paso", codigoInterno: "CJ-001", unidad: "unidad"},
  {id: "ex-inactivo", estado: "inactivo", nombre: "Cable HDMI 2 m", codigoInterno: "CB-HDMI", unidad: "unidad"},
];
const exactCandidates = [
  {id: "x-nombre", nombre: "Cable UTP Cat6 305 m", cantidadOrigen: 2, costoUnitario: 90000},
  {id: "x-contenido", nombre: "Switch 24 puertos gigabit administrable", cantidadOrigen: 1, costoUnitario: 120000},
  {id: "x-varios", nombre: "Router doble banda", cantidadOrigen: 1, costoUnitario: 50000},
  {id: "x-aviso", nombre: "Patch panel 24 puertos", cantidadOrigen: 1, costoUnitario: 30000, advertencias: ["Cantidad poco legible"]},
  {id: "x-ia", nombre: "Rack mural 12U", cantidadOrigen: 1, costoUnitario: 70000, revisionRequerida: true},
  {id: "x-interno-ok", nombre: "Texto OCR", sku: "CJ-001", cantidadOrigen: 1, costoUnitario: 1},
  {id: "x-sin", nombre: "Producto que no existe", cantidadOrigen: 1, costoUnitario: 10},
];
const exactRows = buildPurchaseDocumentPreview(exactCandidates, exactInventory);
const byId = (list, id) => list.find((row) => row.rowId === id);
// Estados por defecto intactos: nombre exacto, contenido, varios, aviso e IA siguen sin aceptarse.
assert.equal(byId(exactRows, "x-nombre").estado, "revisar");
assert.equal(byId(exactRows, "x-nombre").matchKind, "nombre");
assert.equal(byId(exactRows, "x-nombre").revisionAceptada, false);
assert.equal(byId(exactRows, "x-contenido").matchKind, "descripcion");
assert.equal(byId(exactRows, "x-contenido").estado, "revisar");
assert.equal(byId(exactRows, "x-varios").selectedItemId, "");
assert.equal(byId(exactRows, "x-varios").estado, "sin_coincidencia");
assert.equal(byId(exactRows, "x-interno-ok").estado, "vinculada");
assert.equal(byId(exactRows, "x-sin").estado, "sin_coincidencia");

const exactSelection = selectExactPurchaseDocumentMatches(exactRows, exactInventory);
// Solo el nombre idéntico con un único ítem y sin avisos. Nunca contenido, varios candidatos, aviso ni revisión de la IA.
assert.deepEqual(exactSelection.matches.map((match) => match.rowId), ["x-nombre"]);
assert.equal(exactSelection.matches[0].itemNombre, "Cable UTP Cat6 305 m");
assert.equal(exactSelection.matches.some((match) => match.rowId === "x-contenido"), false);
assert.equal(exactSelection.matches.some((match) => match.rowId === "x-varios"), false);
assert.equal(exactSelection.matches.some((match) => match.rowId === "x-aviso"), false);
assert.equal(exactSelection.matches.some((match) => match.rowId === "x-ia"), false);
// Pendientes = lo no vinculado que no se aceptará (contenido, varios, aviso, IA y sin coincidencia).
assert.equal(exactSelection.pendientes, 5);
// Seleccionar no modifica las filas.
assert.equal(byId(exactRows, "x-nombre").estado, "revisar");

// El segundo clic es obligatorio: sin confirmación no se acepta nada.
assert.throws(() => acceptExactPurchaseDocumentMatches(exactRows, exactInventory), /Confirma el resumen/);
assert.throws(() => acceptExactPurchaseDocumentMatches(exactRows, exactInventory, {}), /Confirma el resumen/);
assert.throws(() => acceptExactPurchaseDocumentMatches(exactRows, exactInventory, {confirmed: "true"}), /Confirma el resumen/);
assert.throws(() => acceptExactPurchaseDocumentMatches(exactRows, exactInventory, {confirmed: 1}), /Confirma el resumen/);
const accepted = acceptExactPurchaseDocumentMatches(exactRows, exactInventory, {confirmed: true});
assert.equal(byId(accepted, "x-nombre").estado, "vinculada");
assert.equal(byId(accepted, "x-nombre").revisionAceptada, true);
assert.equal(byId(accepted, "x-nombre").matchKind, "nombre");
// Lo que no es exacto sigue igual, fila por fila.
["x-contenido", "x-varios", "x-aviso", "x-ia", "x-interno-ok", "x-sin"].forEach((rowId) =>
  assert.deepEqual(byId(accepted, rowId), byId(exactRows, rowId)));
// Aceptar no aplica la compra: sigue bloqueada mientras haya líneas sin resolver.
assert.equal(getPurchaseDocumentImportSummary(accepted).lista, false);
assert.throws(() => applyPurchaseDocumentImport({rows: accepted, inventory: exactInventory, selectedProviderId: "provider-fiscal"}), /Resuelve y revisa todas las líneas/);
// Solo acepta las filas del resumen que la persona vio.
assert.equal(byId(acceptExactPurchaseDocumentMatches(exactRows, exactInventory, {confirmed: true, rowIds: ["x-contenido"]}), "x-nombre").estado, "revisar");

// Dos renglones al mismo ítem: ninguno es exacto (puede ser un error de lectura).
const duplicated = buildPurchaseDocumentPreview([
  {id: "d-1", nombre: "Cable UTP Cat6 305 m", cantidadOrigen: 1, costoUnitario: 90000},
  {id: "d-2", nombre: "Cable UTP Cat6 305 m", cantidadOrigen: 1, costoUnitario: 90000},
], exactInventory);
assert.deepEqual(selectExactPurchaseDocumentMatches(duplicated, exactInventory).matches, []);
// Cantidad inválida, ítem cambiado a mano o inactivo: tampoco.
const badQuantity = updatePurchaseDocumentRow(exactRows, "x-nombre", "cantidad", 0, exactInventory);
assert.deepEqual(selectExactPurchaseDocumentMatches(badQuantity, exactInventory).matches, []);
const manual = updatePurchaseDocumentRow(exactRows, "x-nombre", "selectedItemId", "ex-switch", exactInventory);
assert.equal(byId(manual, "x-nombre").estado, "vinculada");
assert.deepEqual(selectExactPurchaseDocumentMatches(manual, exactInventory).matches, []);
const inactiveInventory = exactInventory.map((item) => item.id === "ex-cable" ? {...item, estado: "inactivo"} : item);
assert.deepEqual(selectExactPurchaseDocumentMatches(exactRows, inactiveInventory).matches, []);
// Si aparece otro ítem con el mismo nombre, deja de ser exacta (nunca con varios candidatos).
const twinInventory = [...exactInventory, {id: "ex-cable-2", estado: "activo", nombre: "Cable UTP Cat6 305 m", codigoInterno: "CB-002", unidad: "unidad"}];
assert.deepEqual(selectExactPurchaseDocumentMatches(exactRows, twinInventory).matches, []);
// "Aceptar vínculo revisado" por línea sigue funcionando igual.
const singleAccepted = updatePurchaseDocumentRow(exactRows, "x-contenido", "revisionAceptada", true, exactInventory);
assert.equal(byId(singleAccepted, "x-contenido").estado, "vinculada");
console.log("OK importador compra: aceptar coincidencias exactas (solo exactas, resumen y segundo clic obligatorio)");

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
assert.match(dialog, /Aceptar coincidencias exactas/);
assert.match(dialog, /Aceptar vínculo revisado/);
assert.match(dialog, /Revisa antes de aceptar/);
assert.match(dialog, /por revisar a mano/);
assert.match(dialog, /aria-label=\{`Aceptar coincidencias exactas/);
// "Aplicar a Nueva compra" sigue bloqueado mientras haya líneas sin resolver.
assert.match(dialog, /disabled=\{analyzing \|\| !summary\.lista \|\| !selectedProviderId\}/);
// El primer clic solo abre el resumen: no llama a la función que acepta ni cambia filas.
const openExactBody = dialog.match(/const openExactSummary = \(\) => \{[\s\S]*?\n {2}\};/)?.[0] || "";
assert.ok(openExactBody.length > 0);
assert.doesNotMatch(openExactBody, /acceptExactPurchaseDocumentMatches|setRows/);
assert.match(openExactBody, /setExactSummaryOpen\(true\)/);
// Solo el segundo clic acepta, con confirmación explícita.
assert.equal((dialog.match(/acceptExactPurchaseDocumentMatches\(/g) || []).length, 1);
assert.match(dialog, /confirmed: true/);
assert.match(dialog, /onClick=\{confirmExactMatches\}/);
// Escape (cierre del diálogo) cierra primero el resumen.
assert.match(dialog, /if \(exactSummaryOpen\) \{\s*closeExactSummary\(\);\s*return;\s*\}/);
// Sin colores ni medidas sueltas en el CSS nuevo.
const purchasesCss = fs.readFileSync(new URL("../src/features/purchases/purchases.css", import.meta.url), "utf8");
const exactCss = purchasesCss.slice(purchasesCss.indexOf(".purchase-exact-accept {"));
assert.ok(exactCss.length > 0);
// El ancho de borde "1px solid var(--color-border-*)" es la convención del repo (no hay token de ancho).
assert.doesNotMatch(exactCss.replaceAll("1px solid var(--color-border-", ""), /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\d(px|ms)\b/);
assert.match(inventoryDialog, /const SPREADSHEET_ACCEPT = "\.csv,\.xls,\.xlsx"/);
assert.doesNotMatch(inventoryDialog, /onPurchaseDocument|readInventorySourceFile|PDF|JPG|PNG|WEBP/);
assert.match(inventoryManager, /navigate\("\/compras\/nueva", \{state: \{openPurchaseImport: true\}\}\)/);
assert.match(inventoryManager, /BUSINESS_PERMISSIONS\.PURCHASES_WRITE/);
// "Importar factura" solo con permiso de compras: como opción del menú "Importar"
// o, si es el único permiso, como botón directo.
assert.match(inventoryManager, /canStartPurchase && \{ label: "Factura de compra \(PDF o imagen\)", onSelect: \(\) => navigate\("\/compras\/nueva", \{state: \{openPurchaseImport: true\}\}\) \}/);
assert.match(inventoryManager, /: canStartPurchase \? \(\s*<button[^>]*>[\s\S]*?Importar factura/);
assert.match(service, /\["reception", "purchase"\]\.includes\(context\)/);
assert.match(backend, /lineasSinResolver/);
// tipoOrigen del movimiento entrada_compra es un literal fijo, no condicional
// a isV3DirectPurchase: toda Compra V3 directa confirmada es, por definición,
// stockManagedBy === "compra_directa" (ver isV3DirectPurchase más arriba en
// este mismo archivo) — intencional, SPEC 006 línea 144 ("... crea movimientos
// deterministas entrada_compra con tipoOrigen: compra_directa").
assert.match(backend, /tipoOrigen: "compra_directa"/);
console.log("OK importador compra: pipeline reutilizado, borrador explícito y confirmación separada");

// Aviso de totales: solo con coherenciaEstado "revisar" (la verificación la hace el servidor), con <Notice> existente,
// sin role propio (el panel que lo contiene ya es role="status"), sin bloquear nada y sin mensaje para coherente/sin_datos.
assert.match(page, /import Notice from "\.\.\/components\/ui\/Notice"/);
const pageNotice = page.match(/\{draft\.documentoOrigen\.coherenciaEstado === "revisar" && <Notice variant="warning" role=\{null\}>([^<]*)<\/Notice>\}/);
assert.ok(pageNotice, "aviso de totales en Nueva compra, solo con estado revisar");
assert.equal(pageNotice[1], "Los totales del documento no coinciden con las líneas. Revisa antes de confirmar.");
assert.equal((page.match(/coherenciaEstado/g) || []).length, 1, "ninguna otra rama lee coherenciaEstado en la pantalla");
const importedStart = page.indexOf('<div className="purchase-imported-document-summary" role="status">');
const importedPanel = importedStart >= 0 ? page.slice(importedStart, page.indexOf("</details>", importedStart)) : "";
assert.match(importedPanel, /<Notice variant="warning" role=\{null\}>/, "el aviso va dentro del panel importado y sin role anidado");
assert.equal((importedPanel.match(/role=/g) || []).length, 2, "un solo role=\"status\" (el del panel) más el role={null} del aviso");
assert.doesNotMatch(page, /variant="error"[^>]*>Los totales|disabled=\{[^}]*coherencia/, "el aviso no usa tono de error ni bloquea acciones");
console.log("OK importador compra: aviso visible de totales solo con estado revisar");

console.log("Smoke del importador documental de Compras completado.");
