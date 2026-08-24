import * as XLSX from "xlsx";
import {
  INVENTORY_PRICE_FORMATION_VERSION,
  buildInventoryPayload,
  getDefaultUnitForType,
  normalizeInventoryText,
  parseInventoryNumber,
  validateInventoryDraft,
} from "../domain/inventoryMvp.mjs";
import { confirmManagedInventoryImport } from "./inventoryService.js";

export const MAX_LOCAL_INVENTORY_ROWS = 500;
export const INVENTORY_IMPORT_ACCEPT = ".xlsx,.xls,.csv";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_FILE_EXTENSION = /\.(csv|xls|xlsx)$/i;
const SAVE_BATCH_SIZE = 200;

export const INVENTORY_TEMPLATE_COLUMNS = Object.freeze([
  "tipo", "nombre", "codigo", "area", "categoria", "unidad", "costo_base",
  "margen", "precio_manual", "stock", "stock_minimo", "descripcion",
]);

const HEADER_ALIASES = Object.freeze({
  tipoItem: ["tipo", "tipo item", "tipo de item", "clasificacion", "clase"],
  nombre: ["nombre", "item", "producto", "servicio", "nombre producto"],
  codigoSolicitado: ["codigo", "sku", "codigo interno", "referencia"],
  areaPropuesta: ["area", "familia"],
  categoriaPropuesta: ["categoria", "subcategoria"],
  unidad: ["unidad", "medida", "unidad medida"],
  marca: ["marca", "fabricante"],
  modelo: ["modelo"],
  codigoBarras: ["codigo barras", "codigo de barras", "barcode", "ean", "upc"],
  tasaImpuestoCompra: ["iva", "iva compra", "impuesto", "tasa impuesto"],
  costoBase: ["costo", "costo base", "costo_base", "costo unitario", "precio compra"],
  margenDeseado: ["margen", "margen %", "margen deseado"],
  precioManual: ["precio", "precio venta", "precio de venta", "precio_manual"],
  stock: ["stock", "cantidad", "existencia", "existencias"],
  stockMinimo: ["stock minimo", "stock_minimo", "minimo"],
  descripcion: ["descripcion", "detalle", "observacion"],
});

export function createInventoryImportRequestIdBase(prefix = "inventory_local") {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
  return `${prefix}_${String(random).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 100);
}

export function buildInventoryImportBatchRequestId(requestIdBase, offset) {
  const base = String(requestIdBase || "").trim();
  const batchOffset = Number(offset);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(base)) {
    throw new Error("Falta un identificador válido para la importación.");
  }
  if (!Number.isSafeInteger(batchOffset) || batchOffset < 0) {
    throw new Error("El desplazamiento del lote no es válido.");
  }
  return `${base}_${batchOffset}`;
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsArrayBuffer(file);
  });
}

function normalizeHeader(value) {
  return normalizeInventoryText(value).replace(/[_-]+/g, " ");
}

export function mapInventoryHeaders(headers) {
  const normalizedHeaders = (headers || []).map((header, index) => ({
    index,
    normalized: normalizeHeader(header),
  }));
  return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([field, aliases]) => {
    const match = normalizedHeaders.find(({ normalized }) =>
      aliases.some((alias) => normalized === normalizeHeader(alias))
    );
    return [field, match?.index ?? -1];
  }));
}

function cell(row, index) {
  if (index < 0) return "";
  const value = row[index];
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : value;
}

function resolveCatalogValue(name, entries, areaId = "") {
  const normalized = normalizeInventoryText(name);
  if (!normalized) return "";
  return entries.find((entry) =>
    (entry.estado || "activo") === "activo" &&
    (!areaId || entry.areaId === areaId) &&
    normalizeInventoryText(entry.nombre) === normalized
  )?.id || "";
}

export function normalizeRequestedCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "-");
  return /^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(code) &&
    !/^(PR|SV|AC)-\d+$/.test(code)
    ? code
    : "";
}

function requestedCodeError(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "-");
  if (/^(PR|SV|AC)-\d+$/.test(code)) {
    return "Los prefijos PR, SV y AC están reservados para códigos automáticos.";
  }
  return "El código contiene caracteres no permitidos.";
}

export function transformInventorySpreadsheetRows(
  matrix,
  { areas = [], categories = [], existingItems = [] } = {}
) {
  if (!Array.isArray(matrix) || matrix.length < 2) return [];
  const headers = mapInventoryHeaders(matrix[0]);
  const existingCodes = new Set(existingItems.flatMap((item) =>
    [item.codigoInterno, item.sku].map(normalizeRequestedCode).filter(Boolean)
  ));
  const fileCodes = new Set();

  return matrix.slice(1).filter((row) => row.some((value) => String(value ?? "").trim())).map((row, index) => {
    const rawType = normalizeInventoryText(cell(row, headers.tipoItem));
    const tipoItem = ["producto", "servicio", "actividad"].includes(rawType) ? rawType : "";
    const areaPropuesta = String(cell(row, headers.areaPropuesta) || "").trim();
    const areaId = resolveCatalogValue(areaPropuesta, areas);
    const categoriaPropuesta = String(cell(row, headers.categoriaPropuesta) || "").trim();
    const categoriaId = resolveCatalogValue(categoriaPropuesta, categories, areaId);
    const rawCode = String(cell(row, headers.codigoSolicitado) || "").trim();
    const codigoSolicitado = normalizeRequestedCode(rawCode);
    const draft = {
      tipoItem,
      nombre: String(cell(row, headers.nombre) || "").trim(),
      codigoSolicitado,
      areaId,
      categoriaId,
      areaPropuesta,
      categoriaPropuesta,
      unidad: String(cell(row, headers.unidad) || getDefaultUnitForType(tipoItem)).trim(),
      marca: tipoItem === "producto" ? String(cell(row, headers.marca) || "").trim() : "",
      modelo: tipoItem === "producto" ? String(cell(row, headers.modelo) || "").trim() : "",
      codigoBarras: tipoItem === "producto" ? String(cell(row, headers.codigoBarras) || "").trim() : "",
      formacionPrecioVersion:
        tipoItem === "producto" && cell(row, headers.tasaImpuestoCompra) !== ""
          ? INVENTORY_PRICE_FORMATION_VERSION
          : "",
      tasaImpuestoCompra:
        tipoItem === "producto" ? cell(row, headers.tasaImpuestoCompra) : "",
      costoBase: cell(row, headers.costoBase),
      margenDeseado: cell(row, headers.margenDeseado) === "" ? 0 : cell(row, headers.margenDeseado),
      precioManual: cell(row, headers.precioManual),
      stock: tipoItem === "producto" ? (cell(row, headers.stock) === "" ? 0 : cell(row, headers.stock)) : 0,
      stockMinimo: tipoItem === "producto" ? (cell(row, headers.stockMinimo) === "" ? 0 : cell(row, headers.stockMinimo)) : 0,
      descripcion: String(cell(row, headers.descripcion) || "").trim(),
    };
    const fieldErrors = validateInventoryDraft(draft);
    if (rawCode && !codigoSolicitado) fieldErrors.codigoSolicitado = requestedCodeError(rawCode);
    if (codigoSolicitado && existingCodes.has(codigoSolicitado)) fieldErrors.codigoSolicitado = "El código ya existe en el inventario.";
    if (codigoSolicitado && fileCodes.has(codigoSolicitado)) fieldErrors.codigoSolicitado = "El código está repetido en el archivo.";
    if (codigoSolicitado) fileCodes.add(codigoSolicitado);
    const warnings = [];
    if (areaPropuesta && !areaId) warnings.push("Área no reconocida; se guardará sin área.");
    if (categoriaPropuesta && !categoriaId) warnings.push("Categoría no reconocida; se guardará sin categoría.");
    if (tipoItem && tipoItem !== "producto" && (cell(row, headers.stock) !== "" || cell(row, headers.stockMinimo) !== "")) {
      warnings.push("El stock se ignorará porque no corresponde a este tipo.");
    }
    return {
      rowId: `row_${index + 2}`,
      sourceRow: index + 2,
      included: true,
      draft,
      fieldErrors,
      warnings,
    };
  });
}

export function transformInventoryDocumentCandidates(
  items,
  { areas = [], categories = [], existingItems = [] } = {}
) {
  const rows = (Array.isArray(items) ? items : []).map((item, index) => {
    const rawType = normalizeInventoryText(item?.tipoItem || item?.tipo);
    const tipoItem = ["producto", "servicio", "actividad"].includes(rawType)
      ? rawType
      : "";
    const areaPropuesta = String(item?.areaPropuesta || item?.areaNombre || "").trim();
    const areaId = resolveCatalogValue(areaPropuesta, areas);
    const categoriaPropuesta = String(
      item?.categoriaPropuesta || item?.categoriaNombre || item?.categoria || ""
    ).trim();
    const categoriaId = resolveCatalogValue(categoriaPropuesta, categories, areaId);
    const rawCode = String(item?.codigo || item?.sku || "").trim();
    const codigoSolicitado = normalizeRequestedCode(rawCode);
    const draft = {
      tipoItem,
      nombre: String(item?.nombre || "").trim(),
      codigoSolicitado,
      areaId,
      categoriaId,
      areaPropuesta,
      categoriaPropuesta,
      unidad: String(item?.unidad || getDefaultUnitForType(tipoItem)).trim(),
      marca: tipoItem === "producto" ? String(item?.marca || "").trim() : "",
      modelo: tipoItem === "producto" ? String(item?.modelo || "").trim() : "",
      codigoBarras:
        tipoItem === "producto" ? String(item?.codigoBarras || "").trim() : "",
      formacionPrecioVersion:
        tipoItem === "producto" && item?.tasaImpuestoCompra !== null &&
        item?.tasaImpuestoCompra !== undefined
          ? INVENTORY_PRICE_FORMATION_VERSION
          : "",
      tasaImpuestoCompra:
        tipoItem === "producto" ? item?.tasaImpuestoCompra ?? "" : "",
      costoBase: item?.costoBase ?? 0,
      margenDeseado: item?.margenDeseado ?? 0,
      precioManual: "",
      stock:
        tipoItem === "producto"
          ? item?.stock ?? item?.cantidadSugerida ?? item?.cantidadOrigen ?? 0
          : 0,
      stockMinimo: tipoItem === "producto" ? item?.stockMinimo ?? 0 : 0,
      descripcion: String(item?.descripcion || "").trim(),
    };
    const fieldErrors = validateInventoryDraft(draft);
    if (rawCode && !codigoSolicitado) {
      fieldErrors.codigoSolicitado = requestedCodeError(rawCode);
    }
    const warnings = [
      ...(Array.isArray(item?.advertencias) ? item.advertencias : []),
      ...(item?.observacion ? [item.observacion] : []),
    ].filter(Boolean);
    if (areaPropuesta && !areaId) {
      warnings.push("Área no reconocida; se guardará sin área.");
    }
    if (categoriaPropuesta && !categoriaId) {
      warnings.push("Categoría no reconocida; se guardará sin categoría.");
    }
    return {
      rowId: String(item?.id || `document_${index + 1}`),
      sourceRow: index + 1,
      sourceKind: "document",
      included: item?.revisionRequerida !== true,
      draft,
      fieldErrors,
      warnings: [...new Set(warnings)],
    };
  });

  return revalidateInventoryImportCodes(rows, existingItems);
}

export async function readLocalInventoryWorkbook(file, context = {}) {
  if (!file) throw new Error("Selecciona un archivo de inventario.");
  if (!ALLOWED_FILE_EXTENSION.test(String(file.name || ""))) throw new Error("Usa un archivo XLSX, XLS o CSV.");
  if (Number(file.size || 0) > MAX_FILE_SIZE_BYTES) throw new Error("El archivo no puede superar 5 MB.");
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { cellDates: true, type: "array" });
  let usefulMatrix = null;
  let usefulSheetName = "";
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      blankrows: false,
      defval: "",
      header: 1,
      raw: true,
    }).filter((row) => Array.isArray(row) && row.some((value) => String(value ?? "").trim()));
    if (matrix.length > 1) {
      usefulMatrix = matrix;
      usefulSheetName = sheetName;
      break;
    }
  }
  if (!usefulMatrix) throw new Error("No se encontró una hoja con encabezados y datos.");
  const dataRows = usefulMatrix.length - 1;
  if (dataRows > MAX_LOCAL_INVENTORY_ROWS) throw new Error("El archivo no puede contener más de 500 filas de datos.");
  return {
    sheetName: usefulSheetName,
    rows: revalidateInventoryImportCodes(
      transformInventorySpreadsheetRows(usefulMatrix, context),
      context.existingItems
    ),
  };
}

export function updateInventoryImportRow(row, field, value, context = {}) {
  const draft = { ...row.draft, [field]: value };
  if (field === "tipoItem" && value !== "producto") {
    draft.stock = 0;
    draft.stockMinimo = 0;
    draft.marca = "";
    draft.modelo = "";
    draft.codigoBarras = "";
    draft.formacionPrecioVersion = "";
    draft.tasaImpuestoCompra = "";
  }
  if (field === "areaId") draft.categoriaId = "";
  const fieldErrors = validateInventoryDraft(draft);
  const rawCode = String(draft.codigoSolicitado || "").trim();
  const normalizedCode = normalizeRequestedCode(rawCode);
  draft.codigoSolicitado = normalizedCode || rawCode.toUpperCase();
  if (rawCode && !normalizedCode) {
    fieldErrors.codigoSolicitado = requestedCodeError(rawCode);
  }
  return { ...row, draft, fieldErrors };
}

export function revalidateInventoryImportCodes(rows, existingItems = []) {
  const existing = new Set(existingItems.flatMap((item) =>
    [item.codigoInterno, item.sku].map(normalizeRequestedCode).filter(Boolean)
  ));
  const existingNames = new Set(
    existingItems.map((item) => normalizeInventoryText(item.nombre)).filter(Boolean)
  );
  const existingBarcodes = new Set(
    existingItems.map((item) => String(item.codigoBarras || "").trim()).filter(Boolean)
  );
  const counts = new Map();
  const nameCounts = new Map();
  const barcodeCounts = new Map();
  rows.filter((row) => row.included).forEach((row) => {
    const code = normalizeRequestedCode(row.draft.codigoSolicitado);
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
    const name = normalizeInventoryText(row.draft.nombre);
    if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    const barcode = String(row.draft.codigoBarras || "").trim();
    if (barcode) barcodeCounts.set(barcode, (barcodeCounts.get(barcode) || 0) + 1);
  });
  return rows.map((row) => {
    const code = normalizeRequestedCode(row.draft.codigoSolicitado);
    const fieldErrors = { ...row.fieldErrors };
    if (fieldErrors.codigoSolicitado?.includes("ya existe") || fieldErrors.codigoSolicitado?.includes("repetido")) {
      delete fieldErrors.codigoSolicitado;
    }
    if (row.included && code && existing.has(code)) fieldErrors.codigoSolicitado = "El código ya existe en el inventario.";
    else if (row.included && code && counts.get(code) > 1) fieldErrors.codigoSolicitado = "El código está repetido en el archivo.";
    const warnings = (row.warnings || []).filter(
      (warning) => !String(warning).startsWith("Posible duplicado:")
    );
    const name = normalizeInventoryText(row.draft.nombre);
    const barcode = String(row.draft.codigoBarras || "").trim();
    if (row.included && name && existingNames.has(name)) {
      warnings.push("Posible duplicado: ya existe un ítem con este nombre.");
    } else if (row.included && name && nameCounts.get(name) > 1) {
      warnings.push("Posible duplicado: el nombre se repite en la vista previa.");
    }
    if (row.included && barcode && existingBarcodes.has(barcode)) {
      warnings.push("Posible duplicado: el código de barras ya existe.");
    } else if (row.included && barcode && barcodeCounts.get(barcode) > 1) {
      warnings.push("Posible duplicado: el código de barras se repite en la vista previa.");
    }
    return { ...row, fieldErrors, warnings };
  });
}

export function getInventoryImportSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    included: list.filter((row) => row.included).length,
    valid: list.filter((row) => row.included && Object.keys(row.fieldErrors || {}).length === 0).length,
    invalid: list.filter((row) => row.included && Object.keys(row.fieldErrors || {}).length > 0).length,
    excluded: list.filter((row) => !row.included).length,
  };
}

export async function confirmLocalInventoryImport({
  businessId,
  rows,
  categories = [],
  requestIdBase,
  confirmBatch = confirmManagedInventoryImport,
}) {
  const selected = rows.filter((row) => row.included && Object.keys(row.fieldErrors || {}).length === 0);
  if (!selected.length) throw new Error("No hay filas válidas incluidas para guardar.");
  const resolvedRequestIdBase = requestIdBase;
  const results = [];
  for (let offset = 0; offset < selected.length; offset += SAVE_BATCH_SIZE) {
    const chunk = selected.slice(offset, offset + SAVE_BATCH_SIZE);
    try {
      const response = await confirmBatch(businessId, {
        requestId: buildInventoryImportBatchRequestId(resolvedRequestIdBase, offset),
        rows: chunk.map((row) => {
          const item = buildInventoryPayload(row.draft, categories);
          if (row.draft.codigoSolicitado) item.codigoSolicitado = row.draft.codigoSolicitado;
          item.origen = row.sourceKind === "document"
            ? "importacion_documental_multiformato"
            : "importacion_excel_local";
          return { rowId: row.rowId, item };
        }),
      });
      results.push(...(response.results || []));
    } catch (error) {
      error.partialCreated = results.length;
      error.remaining = selected.length - results.length;
      throw error;
    }
  }
  return { created: results.length, skipped: rows.length - selected.length, results };
}

export function downloadInventoryTemplate() {
  const example = [
    "producto", "Taladro inalámbrico", "", "", "", "unidad", 45000, 30, "", 8, 2,
    "Ejemplo: elimina esta fila antes de importar tus datos.",
  ];
  const worksheet = XLSX.utils.aoa_to_sheet([INVENTORY_TEMPLATE_COLUMNS, example]);
  worksheet["!cols"] = INVENTORY_TEMPLATE_COLUMNS.map((column) => ({ wch: Math.max(column.length + 2, 14) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
  XLSX.writeFile(workbook, "plantilla-inventario-valoracloud.xlsx");
}

export { parseInventoryNumber };
