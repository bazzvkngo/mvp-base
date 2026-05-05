// src/services/inventoryImportService.js
//
// Servicio para leer archivos Excel/CSV de inventario y crearlos en Firestore
// Mantiene la misma idea de tu importador, pero con código simple y comentado.

import * as XLSX from "xlsx";
import { importInventoryItems } from "./inventoryService";

// ---- Utilidades básicas -----------------------------------------

function parseNumber(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw;

  // limpiamos símbolos de moneda, espacios, puntos de miles, etc.
  const clean = String(raw)
    .replace(/[^\d,.-]/g, "") // quitamos todo lo que no sea dígito, coma, punto o signo
    .replace(/\./g, "") // sacamos puntos de miles
    .replace(",", "."); // cambiamos coma decimal a punto

  const num = Number(clean);
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
}

function inferTipoItem(nombre, categoria) {
  const txt = `${nombre || ""} ${categoria || ""}`.toLowerCase();
  if (
    txt.includes("servicio") ||
    txt.includes("instalación") ||
    txt.includes("instalacion") ||
    txt.includes("mantención") ||
    txt.includes("mantencion") ||
    txt.includes("visita técnica") ||
    txt.includes("visita tecnica")
  ) {
    return "servicio";
  }
  return "producto";
}

// ---- Lectura de archivo -----------------------------------------

async function leerArchivoComoArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Dado un archivo Excel/CSV, devuelve:
 * - items: array de objetos listos para importar
 * - totalFilas: filas leídas
 * - filasValidas: filas que se consideran válidas (con nombre o precio)
 */
export async function leerArchivoInventario(file) {
  if (!file) {
    throw new Error("No se recibió archivo de inventario.");
  }

  const buffer = await leerArchivoComoArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: "array" });

  const hojaNombre = workbook.SheetNames[0];
  const hoja = workbook.Sheets[hojaNombre];

  // sheet_to_json con defval="" para no tener undefined
  const rows = XLSX.utils.sheet_to_json(hoja, { defval: "" });

  if (!rows.length) {
    return { items: [], totalFilas: 0, filasValidas: 0 };
  }

  // Mapeo de encabezados
  const headers = Object.keys(rows[0]).map((h) => ({
    original: h,
    norm: String(h).toLowerCase().trim(),
  }));

  const findHeader = (...candidatos) => {
    return (
      headers.find((h) =>
        candidatos.some((c) => h.norm.includes(c.toLowerCase()))
      ) || null
    );
  };

  const hNombre = findHeader("nombre", "producto", "item", "descripción");
  const hCategoria = findHeader("categoria", "rubro", "familia");
  const hSku = findHeader("sku", "código", "codigo");
  const hStock = findHeader("stock", "cantidad");
  const hPrecio = findHeader("precio", "valor", "costo");
  const hUrl = findHeader("url", "link", "enlace");
  const hUnidad = findHeader("unidad", "u.medida", "medida");

  const items = [];
  let filasValidas = 0;

  for (const row of rows) {
    const nombre = hNombre ? row[hNombre.original] : "";
    const categoria = hCategoria ? row[hCategoria.original] : "";
    const sku = hSku ? row[hSku.original] : "";
    const stockRaw = hStock ? row[hStock.original] : "";
    const precioRaw = hPrecio ? row[hPrecio.original] : "";
    const url = hUrl ? row[hUrl.original] : "";
    const unidadArchivo = hUnidad ? row[hUnidad.original] : "";

    const precio = parseNumber(precioRaw);
    const stock = parseNumber(stockRaw);

    if (!nombre && !precio) {
      // fila vacía / sin datos relevantes
      continue;
    }

    filasValidas += 1;

    const tipoItem = inferTipoItem(nombre, categoria);
    const unidad =
      unidadArchivo ||
      (tipoItem === "servicio" ? "servicio" : "unidad");

    items.push({
      nombre: String(nombre || "").trim(),
      categoria: String(categoria || "").trim(),
      sku: String(sku || "").trim() || null,
      tipoItem,
      unidad,
      stock: tipoItem === "servicio" ? null : stock ?? 0,
      precio: precio ?? 0,
      url: String(url || "").trim(),
    });
  }

  return {
    items,
    totalFilas: rows.length,
    filasValidas,
  };
}

/**
 * Importa los ítems leídos al inventario del usuario.
 */
export async function importarInventarioEnFirestore(userId, items) {
  if (!userId) {
    throw new Error("userId es requerido para importar inventario.");
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { creados: 0 };
  }

  return importInventoryItems(userId, items);
}
