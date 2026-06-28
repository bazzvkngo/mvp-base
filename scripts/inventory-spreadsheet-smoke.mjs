import assert from "node:assert/strict";
import fs from "node:fs";
import * as XLSX from "xlsx";

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

assert.ok(importerSource.includes("Analizar documento"));
assert.equal(importerSource.includes("Analizar sin IA externa"), false);
assert.ok(importerSource.includes('handleAnalyze("local")') === false);
assert.ok(importerSource.includes("analysisInFlightRef"));
assert.ok(importerSource.includes("if (analysisInFlightRef.current) return;"));
assert.ok(importerSource.includes("latestAnalysisRequestRef"));
assert.ok(importerSource.includes("latestAnalysisRequestRef.current !== requestId"));
assert.ok(importerSource.includes("setLoadingAnalysis(false)"));
assert.ok(importerSource.includes('setError("");'));
assert.ok(functionsSource.includes("const useLocalFallback = ()"));
assert.ok(functionsSource.includes("buildLocalInventoryImportFallback"));
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

assert.ok(importerSource.includes("function getSafeAnalysisErrorMessage"));
assert.ok(importerSource.includes("resource-exhausted"));
assert.ok(importerSource.includes("daily_quota"));
assert.ok(
  importerSource.includes(
    "El servicio inteligente alcanzó el límite de uso disponible."
  )
);
assert.ok(
  importerSource.includes(
    "El servicio inteligente está temporalmente ocupado."
  )
);
assert.ok(importerSource.includes("invalid-argument"));
assert.ok(serviceSource.includes('fileData?.kind === "document"'));
assert.ok(serviceSource.includes("return normalizeInventoryDocumentWithAi({ fileData });"));
console.log("OK interfaz: diferencia límite de uso, servicio ocupado y validación");

console.log("INVENTORY_SPREADSHEET_SMOKE_OK");
