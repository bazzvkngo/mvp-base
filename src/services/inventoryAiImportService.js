import { getFunctions, httpsCallable } from "firebase/functions";
import * as XLSX from "xlsx";
import { app } from "../firebase/firebaseConfig";

const FUNCTIONS_REGION = "us-central1";
const MAX_FILE_SHEETS = 8;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_ROWS = 500;
const MAX_FILE_COLUMNS = 40;
const MAX_CELL_LENGTH = 500;
const ALLOWED_FILE_EXTENSION = /\.(csv|xls|xlsx)$/i;

function validateInventoryFile(file) {
  if (!ALLOWED_FILE_EXTENSION.test(String(file?.name || ""))) {
    throw new Error("Usa un archivo CSV, XLS o XLSX.");
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

export async function readInventoryWorkbook(file) {
  if (!file) {
    throw new Error("Selecciona un archivo de inventario.");
  }
  validateInventoryFile(file);

  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, {
    cellDates: true,
    type: "array",
  });

  if (workbook.SheetNames.length > MAX_FILE_SHEETS) {
    throw new Error("El archivo no puede contener mas de 8 hojas.");
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
      throw new Error("El archivo no puede contener mas de 500 filas.");
    }

    return {
      nombreHoja: sheetName,
      filas: normalizedRows,
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
