import assert from "node:assert/strict";
import fs from "node:fs";
import * as XLSX from "xlsx";
import {
  createMissingAiRateLimitStatusError,
  getAiAvailabilityErrorStatus,
  getSafeInventoryAiLogDetails,
  normalizeInventoryAiResponse,
  runInventoryAnalysisSingleFlight,
  translateInventoryAiError,
} from "../src/services/inventoryAiClient.mjs";

const rows = [
  ["Codigo", "Detalle comercial", "Cantidad", "Valor unitario"],
  ["SKU-PRUEBA-001", "Servicio sintetico de instalacion", 2, 25000],
  ["SKU-PRUEBA-002", "Cable de red sintetico", 10, 1500],
];

function readWorkbook(buffer) {
  const workbook = XLSX.read(buffer, {
    cellDates: true,
    type: "buffer",
  });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, {
      blankrows: false,
      defval: "",
      header: 1,
      raw: true,
    });
  });
}

function makeWorkbookBuffer(bookType, multiSheet = false) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Hoja 1");
  if (multiSheet) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Producto", "Costo"],
        ["Monitor sintetico", 90000],
      ]),
      "Hoja 2"
    );
  }
  return XLSX.write(workbook, { bookType, type: "buffer" });
}

const csvBuffer = Buffer.from(
  "Codigo,Detalle comercial,Cantidad,Valor unitario\nSKU-PRUEBA-001,Servicio sintetico de instalacion,2,25000\n",
  "utf8"
);
const csvSheets = readWorkbook(csvBuffer);
assert.equal(csvSheets.length, 1);
assert.equal(csvSheets[0].length, 2);
assert.equal(csvSheets[0][1][1], "Servicio sintetico de instalacion");
console.log("OK planilla: CSV sintético válido");

const xlsxSheets = readWorkbook(makeWorkbookBuffer("xlsx", true));
assert.equal(xlsxSheets.length, 2);
assert.equal(xlsxSheets[0].length, 3);
assert.equal(xlsxSheets[1][1][0], "Monitor sintetico");
console.log("OK planilla: XLSX sintético con varias hojas válido");

const xlsSheets = readWorkbook(makeWorkbookBuffer("xls"));
assert.equal(xlsSheets.length, 1);
assert.equal(xlsSheets[0][1][0], "SKU-PRUEBA-001");
console.log("OK planilla: XLS sintético válido");

const importerSource = fs.readFileSync(
  "src/features/inventory/InventoryAiImporter.jsx",
  "utf8"
);
const functionsSource = fs.readFileSync("functions/index.js", "utf8");
const serviceSource = fs.readFileSync(
  "src/services/inventoryAiImportService.js",
  "utf8"
);
const rateLimitHookSource = fs.readFileSync(
  "src/hooks/useAiRateLimit.js",
  "utf8"
);

assert.ok(importerSource.includes("Analizar documento"));
assert.equal(importerSource.includes("Analizar sin IA externa"), false);
assert.ok(importerSource.includes('handleAnalyze("local")') === false);
assert.ok(importerSource.includes("analysisInFlightRef"));
assert.ok(importerSource.includes("if (analysisInFlightRef.current) return;"));
assert.ok(importerSource.includes("latestAnalysisRequestRef"));
assert.ok(importerSource.includes("latestAnalysisRequestRef.current !== requestId"));
assert.ok(importerSource.includes("setLoadingAnalysis(false)"));
assert.ok(importerSource.includes('setError("");'));
assert.ok(rateLimitHookSource.includes("refreshInFlightRef"));
assert.ok(rateLimitHookSource.includes("return currentRequest.promise"));
assert.ok(functionsSource.includes("const useLocalFallback = ()"));
assert.ok(functionsSource.includes("withSafeInventoryImportErrors"));
assert.ok(functionsSource.includes('internalCode: "inventory_import_internal"'));
assert.ok(functionsSource.includes("buildLocalInventoryImportFallback"));
assert.ok(functionsSource.includes('area: ["area", "area_inventario"]'));
assert.ok(functionsSource.includes('marca: ["marca", "fabricante"]'));
assert.ok(functionsSource.includes("categoriaPropuesta"));
assert.ok(functionsSource.includes("classifyGeminiServiceError(error)"));
assert.ok(
  functionsSource.includes(
    "category: getSafeGeminiLogCategory(geminiClassification.category)"
  )
);
assert.ok(
  functionsSource.includes(
    "El servicio inteligente no se encuentra disponible temporalmente. Se aplicó el análisis local del archivo."
  )
);
console.log("OK interfaz: botón unificado conserva fallback local tabular interno");

assert.ok(importerSource.includes("function getItemDisplayMessages"));
assert.ok(importerSource.includes("item.observacion"));
assert.ok(importerSource.includes("item.advertencias"));
assert.ok(importerSource.includes("function getReviewBadgeText"));
assert.ok(importerSource.includes('"Revisión comercial"'));
assert.ok(importerSource.includes('"Requiere revisión"'));
console.log("OK interfaz: deduplicación final y revisión comercial cubiertas");

const callableErrorCases = [
  ["functions/internal", "internal"],
  ["functions/unauthenticated", "unauthenticated"],
  ["functions/permission-denied", "permission_denied"],
  ["functions/resource-exhausted", "quota"],
  ["functions/deadline-exceeded", "timeout"],
  ["functions/emulator-unavailable", "emulator_unavailable"],
];
callableErrorCases.forEach(([code, expectedKind]) => {
  assert.equal(translateInventoryAiError({ code, message: code }).kind, expectedKind);
});
assert.equal(
  translateInventoryAiError(new TypeError("Failed to fetch")).kind,
  "network"
);
assert.equal(
  translateInventoryAiError({ code: "functions/not-found" }).kind,
  "service_mismatch"
);
assert.equal(
  translateInventoryAiError({ code: "functions/internal", message: "internal" })
    .message.includes("problema interno del servicio"),
  true
);
assert.equal(
  getAiAvailabilityErrorStatus(
    { code: "functions/internal", message: "internal" },
    "gemini-test"
  ).reason,
  "status_error"
);
const compatibilityStatus = getAiAvailabilityErrorStatus(
  createMissingAiRateLimitStatusError(),
  "gemini-test"
);
assert.equal(compatibilityStatus.reason, "status_error");
assert.ok(compatibilityStatus.message.includes("versión anterior"));
console.log("OK errores: códigos callable y red se traducen a mensajes seguros");

const currentContract = normalizeInventoryAiResponse({
  items: [{ nombre: "Item actual" }],
  source: "local",
});
assert.equal(currentContract.items.length, 1);
const compatibleLegacyContract = normalizeInventoryAiResponse({
  result: { items: [{ nombre: "Item compatible" }], source: "gemini" },
});
assert.equal(compatibleLegacyContract.items[0].nombre, "Item compatible");
assert.throws(
  () => normalizeInventoryAiResponse({ source: "gemini" }),
  (error) => translateInventoryAiError(error).kind === "invalid_response"
);
console.log("OK contrato: respuesta actual, adaptador compatible e inválida cubiertos");

const analysisLock = { current: false };
let analysisCalls = 0;
let releaseFirstAnalysis;
const firstAnalysis = runInventoryAnalysisSingleFlight(
  analysisLock,
  async () => {
    analysisCalls += 1;
    return new Promise((resolve) => {
      releaseFirstAnalysis = resolve;
    });
  }
);
const duplicateAnalysis = await runInventoryAnalysisSingleFlight(
  analysisLock,
  async () => {
    analysisCalls += 1;
  }
);
assert.equal(duplicateAnalysis.started, false);
assert.equal(analysisCalls, 1);
releaseFirstAnalysis("vista-previa");
assert.equal((await firstAnalysis).value, "vista-previa");

let loading = false;
await assert.rejects(
  runInventoryAnalysisSingleFlight(
    analysisLock,
    async () => {
      throw new Error("fallo sintético");
    },
    {
      onStart: () => {
        loading = true;
      },
      onFinish: () => {
        loading = false;
      },
    }
  )
);
assert.equal(loading, false);
assert.equal(analysisLock.current, false);
console.log("OK concurrencia: doble envío bloqueado y carga restablecida tras error");

const safeLog = getSafeInventoryAiLogDetails(
  new Error("prompt interno secreto y contenido privado"),
  { stage: "test", rowCount: 12, durationMs: 25 }
);
assert.equal(JSON.stringify(safeLog).includes("contenido privado"), false);
assert.equal(safeLog.rowCount, 12);
console.log("OK registros: solo incluyen metadatos técnicos seguros");

assert.ok(serviceSource.includes('fileData?.kind === "document"'));
assert.ok(serviceSource.includes("return normalizeInventoryDocumentWithAi({ businessId, fileData });"));
assert.ok(serviceSource.includes("normalizeInventoryAiResponse(response.data)"));
assert.ok(serviceSource.includes('invokeInventoryCallable("getAiRateLimitStatus"'));
assert.ok(serviceSource.includes('invokeInventoryCallable("normalizeInventoryItems"'));
assert.ok(serviceSource.includes('invokeInventoryCallable("confirmInventoryImportV2"'));

const analyzeStart = importerSource.indexOf("const handleAnalyze");
const saveStart = importerSource.indexOf("const handleSave");
const analysisSlice = importerSource.slice(analyzeStart, saveStart);
const saveSlice = importerSource.slice(saveStart);
assert.equal(analysisSlice.includes("importarInventarioEnFirestore"), false);
assert.equal(saveSlice.includes("normalizeInventorySourceWithAi"), false);
assert.ok(saveSlice.includes("confirmInventoryImportV2"));
assert.ok(saveSlice.includes("saveInFlightRef.current"));
assert.equal(saveSlice.includes("importarInventarioEnFirestore"), false);
assert.ok(analysisSlice.includes("getInventoryItems"));
assert.ok(analysisSlice.includes("getInventoryAreas"));
assert.ok(importerSource.includes("Stock mínimo"));
assert.ok(importerSource.includes("Código interno: se asignará al confirmar"));
console.log("OK persistencia: previsualizar no escribe y guardar no reinvoca Gemini");

console.log("INVENTORY_SPREADSHEET_SMOKE_OK");
