import { getFunctions, httpsCallable } from "firebase/functions";
import * as XLSX from "xlsx";
import { app } from "../firebase/firebaseConfig";

const FUNCTIONS_REGION = "us-central1";
const MAX_FILE_SHEETS = 8;

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

export async function readInventoryWorkbook(file) {
  if (!file) {
    throw new Error("Selecciona un archivo de inventario.");
  }

  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, {
    cellDates: true,
    type: "array",
  });

  const hojas = workbook.SheetNames.slice(0, MAX_FILE_SHEETS).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      blankrows: false,
      defval: "",
      header: 1,
      raw: true,
    });

    return {
      nombreHoja: sheetName,
      filas: rows
        .map((row) => (Array.isArray(row) ? row.map(normalizeCell) : []))
        .filter((row) => row.some((cell) => String(cell || "").trim())),
    };
  }).filter((sheet) => sheet.filas.length > 0);

  return {
    nombreArchivo: file.name,
    tipoArchivo: file.type || "",
    hojas,
  };
}

export async function normalizeInventoryItemsWithAi({
  fileData,
  assistantMode = "auto",
}) {
  const mode = ["local", "gemini"].includes(assistantMode)
    ? assistantMode
    : "auto";

  if (!fileData || !Array.isArray(fileData.hojas) || fileData.hojas.length === 0) {
    throw new Error("El archivo no contiene hojas o filas legibles.");
  }

  const functions = getFunctions(app, FUNCTIONS_REGION);
  const callable = httpsCallable(functions, "normalizeInventoryItems");
  const response = await callable({
    fileData,
    assistantMode: mode,
  });

  return {
    items: Array.isArray(response.data?.items) ? response.data.items : [],
    source: response.data?.source || "local",
    mode: response.data?.mode || mode,
    model: response.data?.model || "",
    warning:
      response.data?.warning ||
      "Los valores detectados son estimaciones y deben ser revisados antes de guardar.",
  };
}
