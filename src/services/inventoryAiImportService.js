import { httpsCallable } from "firebase/functions";
import { assertCloudFunctionAllowed } from "../config/firebaseEnvironment.mjs";
import { normalizeAiRateLimitStatus } from "./aiRateLimitService";
import { normalizeInventoryAiResponse } from "./inventoryAiClient.mjs";
import * as XLSX from "xlsx";
import { getFirebaseFunctions } from "../firebase/firebaseConfig";
import { MAX_INVENTORY_IMPORT_BATCH_SIZE } from "../domain/inventoryImportV2.mjs";

const FUNCTIONS_REGION = "us-central1";
const MAX_FILE_SHEETS = 8;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_ROWS = 500;
const MAX_FILE_COLUMNS = 40;
const MAX_CELL_LENGTH = 500;
const SPREADSHEET_EXTENSION = /\.(csv|xls|xlsx)$/i;
const DOCUMENT_EXTENSION = /\.(pdf|jpe?g|png|webp)$/i;
const MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const ACCEPTED_INVENTORY_FILE_TYPES =
  ".csv,.xls,.xlsx,.pdf,.jpg,.jpeg,.png,.webp";

function normalizeInventoryCallableError(error, functionName) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  const hasStructuredDetails =
    error?.details && typeof error.details === "object";

  if (
    import.meta.env.DEV &&
    code === "functions/internal" &&
    message === "internal" &&
    !hasStructuredDetails
  ) {
    const emulatorError = new Error("Firebase Functions emulator unavailable");
    emulatorError.code = "functions/emulator-unavailable";
    emulatorError.details = {
      internalCode: "emulator_unavailable",
      functionName,
    };
    return emulatorError;
  }

  return error;
}

async function invokeInventoryCallable(functionName, payload) {
  assertCloudFunctionAllowed(`la Function ${functionName}`);
  const functions = getFirebaseFunctions(FUNCTIONS_REGION);
  const callable = httpsCallable(functions, functionName);
  try {
    return await callable(payload);
  } catch (error) {
    throw normalizeInventoryCallableError(error, functionName);
  }
}

export async function getInventoryImportAiRateLimitStatus(model) {
  const response = await invokeInventoryCallable("getAiRateLimitStatus", {
    model,
  });
  return normalizeAiRateLimitStatus(response.data, model);
}

function getFileExtension(fileName) {
  const match = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function normalizeMimeType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function validateSpreadsheetFile(file) {
  if (!SPREADSHEET_EXTENSION.test(String(file?.name || ""))) {
    throw new Error("Usa un archivo CSV, XLS o XLSX.");
  }
  if (Number(file?.size || 0) > MAX_FILE_SIZE_BYTES) {
    throw new Error("El archivo no puede superar 5 MB.");
  }
}

function validateSupportedFile(file) {
  const fileName = String(file?.name || "");
  if (!SPREADSHEET_EXTENSION.test(fileName) && !DOCUMENT_EXTENSION.test(fileName)) {
    throw new Error("Usa un archivo CSV, XLS, XLSX, PDF, JPG, PNG o WebP.");
  }
  if (Number(file?.size || 0) > MAX_FILE_SIZE_BYTES) {
    throw new Error("El archivo no puede superar 5 MB.");
  }
}

async function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}

function normalizeCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function startsWithBytes(bytes, signature) {
  if (!bytes || bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function bytesToText(bytes, start = 0, end = bytes.length) {
  let text = "";
  const chunkSize = 0x8000;
  for (let index = start; index < end; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, end));
    text += String.fromCharCode(...chunk);
  }
  return text;
}

function arrayBufferToBase64(buffer) {
  return btoa(bytesToText(new Uint8Array(buffer)));
}

function detectDocumentMime(bytes) {
  if (bytesToText(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytesToText(bytes, 0, 4) === "RIFF" &&
    bytesToText(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

function validatePdfBytes(bytes) {
  if (bytes.length < 128) {
    throw new Error("El PDF está vacío o incompleto.");
  }

  const text = bytesToText(bytes);
  if (!text.slice(-2048).includes("%%EOF")) {
    throw new Error("El PDF parece estar corrupto o truncado.");
  }
  if (/\/Encrypt\b|\/Filter\s*\/Standard\b/i.test(text)) {
    throw new Error("El PDF protegido no puede analizarse.");
  }
  if (/\/Count\s+0\b/i.test(text) || !/\/Type\s*\/Page\b/i.test(text)) {
    throw new Error("El PDF no contiene páginas legibles.");
  }
}

function validateDocumentFile(file, buffer) {
  const extension = getFileExtension(file?.name);
  const expectedMime = MIME_BY_EXTENSION[extension];
  const declaredMime = normalizeMimeType(file?.type);
  const bytes = new Uint8Array(buffer);
  const detectedMime = detectDocumentMime(bytes);

  if (!expectedMime) {
    throw new Error("Usa un archivo PDF, JPG, PNG o WebP.");
  }
  if (!declaredMime) {
    throw new Error("El navegador no informó el tipo MIME del documento.");
  }
  if (declaredMime !== expectedMime) {
    throw new Error("La extensión no coincide con el tipo MIME declarado.");
  }
  if (detectedMime !== declaredMime) {
    throw new Error("La firma real del archivo no coincide con un formato admitido.");
  }
  if (detectedMime === "application/pdf") validatePdfBytes(bytes);
  if (detectedMime !== "application/pdf" && bytes.length < 24) {
    throw new Error("La imagen está vacía o incompleta.");
  }

  return {
    extension,
    detectedMime,
    declaredMime,
  };
}

export async function readInventoryWorkbook(file) {
  if (!file) {
    throw new Error("Selecciona un archivo de inventario.");
  }
  validateSpreadsheetFile(file);

  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, {
    cellDates: true,
    type: "array",
  });

  if (workbook.SheetNames.length > MAX_FILE_SHEETS) {
    throw new Error("El archivo no puede contener más de 8 hojas.");
  }

  let totalRows = 0;
  const hojas = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      blankrows: false,
      defval: "",
      header: 1,
      raw: true,
    });

    const normalizedRows = rows
      .map((row) =>
        Array.isArray(row)
          ? row
              .slice(0, MAX_FILE_COLUMNS)
              .map((cell) => normalizeCell(cell).slice(0, MAX_CELL_LENGTH))
          : []
      )
      .filter((row) => row.some((cell) => String(cell || "").trim()));

    totalRows += normalizedRows.length;
    if (totalRows > MAX_FILE_ROWS) {
      throw new Error("El archivo no puede contener más de 500 filas.");
    }

    return {
      nombreHoja: sheetName,
      filas: normalizedRows,
    };
  }).filter((sheet) => sheet.filas.length > 0);

  return {
    kind: "spreadsheet",
    nombreArchivo: file.name,
    tipoArchivo: file.type || "",
    extension: getFileExtension(file.name),
    tamanoBytes: file.size || 0,
    analysisType: "planilla",
    hojas,
  };
}

export async function readInventoryDocument(file) {
  if (!file) {
    throw new Error("Selecciona un documento.");
  }
  validateSupportedFile(file);

  const buffer = await readFileAsArrayBuffer(file);
  const validation = validateDocumentFile(file, buffer);

  return {
    kind: "document",
    nombreArchivo: file.name,
    tipoArchivo: validation.declaredMime,
    detectedMime: validation.detectedMime,
    extension: validation.extension,
    tamanoBytes: file.size || 0,
    analysisType: "documental multimodal",
    base64: arrayBufferToBase64(buffer),
  };
}

export async function readInventorySourceFile(file) {
  validateSupportedFile(file);
  if (SPREADSHEET_EXTENSION.test(String(file?.name || ""))) {
    return readInventoryWorkbook(file);
  }
  return readInventoryDocument(file);
}

export function stripInventoryDocumentPayload(fileData) {
  if (!fileData || fileData.kind !== "document") return fileData;
  const { base64, ...metadata } = fileData;
  return metadata;
}

export async function normalizeInventoryItemsWithAi({
  businessId,
  fileData,
  assistantMode = "auto",
}) {
  const mode = ["local", "gemini"].includes(assistantMode)
    ? assistantMode
    : "auto";

  if (!fileData || !Array.isArray(fileData.hojas) || fileData.hojas.length === 0) {
    throw new Error("El archivo no contiene hojas o filas legibles.");
  }

  const response = await invokeInventoryCallable("normalizeInventoryItems", {
    businessId,
    fileData,
    assistantMode: mode,
  });
  const data = normalizeInventoryAiResponse(response.data);

  return {
    items: data.items,
    source: data.source || "local",
    sourceKind: "spreadsheet",
    mode: data.mode || mode,
    model: data.model || "",
    warning:
      data.warning ||
      "Los valores detectados son estimaciones y deben ser revisados antes de guardar.",
    aiRateLimit: data.aiRateLimit
      ? normalizeAiRateLimitStatus(data.aiRateLimit)
      : null,
  };
}

export async function normalizeInventoryDocumentWithAi({
  businessId,
  fileData,
  context = "inventory",
}) {
  if (!fileData || fileData.kind !== "document" || !fileData.base64) {
    throw new Error("Selecciona un documento antes de analizar.");
  }

  const response = await invokeInventoryCallable("normalizeInventoryDocument", {
    businessId,
    context: ["reception", "purchase"].includes(context) ? context : "inventory",
    document: {
      nombreArchivo: fileData.nombreArchivo,
      tipoArchivo: fileData.tipoArchivo,
      extension: fileData.extension,
      tamanoBytes: fileData.tamanoBytes,
      base64: fileData.base64,
    },
  });
  const data = normalizeInventoryAiResponse(response.data);

  return {
    items: data.items,
    source: data.source || "gemini-document",
    sourceKind: "document",
    mode: data.mode || "document-multimodal",
    model: data.model || "",
    documentType: data.documentType || "otro",
    documento: data.documento || {},
    proveedor: data.proveedor || {},
    receptor: data.receptor || {},
    totales: data.totales || {},
    coherencia: data.coherencia || {estado: "sin_datos"},
    inferenciaImpuestoCompra: data.inferenciaImpuestoCompra || {
      estado: "requiere_revision",
      tasa: null,
      tasaSugerida: null,
    },
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    warning:
      data.warning ||
      "Documento procesado. Revisa los candidatos antes de guardar.",
    aiRateLimit: data.aiRateLimit
      ? normalizeAiRateLimitStatus(data.aiRateLimit)
      : null,
  };
}

export async function normalizeInventorySourceWithAi({
  businessId,
  fileData,
  assistantMode = "auto",
  context = "inventory",
}) {
  if (fileData?.kind === "document") {
    return normalizeInventoryDocumentWithAi({businessId, fileData, context});
  }
  return normalizeInventoryItemsWithAi({ businessId, fileData, assistantMode });
}

export async function confirmInventoryImportV2({ businessId, requestId, rows }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Selecciona al menos una fila válida para guardar.");
  }
  if (rows.length > MAX_INVENTORY_IMPORT_BATCH_SIZE) {
    const error = new Error(
      `La confirmación admite un máximo de ${MAX_INVENTORY_IMPORT_BATCH_SIZE} filas por lote.`
    );
    error.code = "inventory-import/batch-too-large";
    error.details = { internalCode: "inventory_import_batch_too_large" };
    throw error;
  }

  const response = await invokeInventoryCallable("confirmInventoryImportV2", {
    businessId,
    requestId,
    rows,
  });
  const data = response?.data;
  if (
    !data ||
    !Array.isArray(data.results) ||
    !Number.isSafeInteger(Number(data.total)) ||
    data.results.length !== Number(data.total)
  ) {
    const error = new Error("Respuesta incompatible al confirmar la importación.");
    error.code = "functions/incompatible-contract";
    error.details = { internalCode: "incompatible_contract" };
    throw error;
  }
  return {
    requestId: String(data.requestId || requestId),
    results: data.results.map((result) => ({
      rowId: String(result?.rowId || ""),
      itemId: String(result?.itemId || ""),
      codigoInterno: String(result?.codigoInterno || ""),
    })),
    total: Number(data.total),
    idempotent: data.idempotent === true,
  };
}
