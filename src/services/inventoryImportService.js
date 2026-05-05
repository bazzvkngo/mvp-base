import * as XLSX from "xlsx";
import { importInventoryItems } from "./inventoryService";

function parseNumber(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw;

  const clean = String(raw)
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const num = Number(clean);
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
}

function inferTipoItem(nombre, categoria, tipoRaw) {
  const txt = `${nombre || ""} ${categoria || ""} ${tipoRaw || ""}`.toLowerCase();
  if (
    txt.includes("actividad") ||
    txt.includes("traslado") ||
    txt.includes("visita")
  ) {
    return "actividad";
  }
  if (
    txt.includes("servicio") ||
    txt.includes("instalación") ||
    txt.includes("instalacion") ||
    txt.includes("mantención") ||
    txt.includes("mantencion") ||
    txt.includes("soporte")
  ) {
    return "servicio";
  }
  return "producto";
}

async function leerArchivoComoArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

export async function leerArchivoInventario(file) {
  if (!file) {
    throw new Error("No se recibió archivo de inventario.");
  }

  const buffer = await leerArchivoComoArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (!rows.length) {
    return { items: [], totalFilas: 0, filasValidas: 0 };
  }

  const headers = Object.keys(rows[0]).map((header) => ({
    original: header,
    norm: String(header).toLowerCase().trim(),
  }));

  const findHeader = (...candidates) =>
    headers.find((header) =>
      candidates.some((candidate) =>
        header.norm.includes(candidate.toLowerCase())
      )
    ) || null;

  const hNombre = findHeader("nombre", "producto", "item", "ítem", "descripción");
  const hTipo = findHeader("tipo");
  const hCategoria = findHeader("categoria", "categoría", "rubro", "familia");
  const hDescripcion = findHeader("descripcion", "descripción", "detalle");
  const hSku = findHeader("sku", "código", "codigo");
  const hCosto = findHeader("costo base", "costo", "valor", "precio compra");
  const hPrecioInterno = findHeader("precio interno", "precio venta", "precio");
  const hMargen = findHeader("margen");
  const hUnidad = findHeader("unidad", "u.medida", "medida");

  const items = [];
  let filasValidas = 0;

  for (const row of rows) {
    const nombre = hNombre ? row[hNombre.original] : "";
    const categoria = hCategoria ? row[hCategoria.original] : "";
    const descripcion = hDescripcion ? row[hDescripcion.original] : "";
    const tipoRaw = hTipo ? row[hTipo.original] : "";
    const sku = hSku ? row[hSku.original] : "";
    const unidadArchivo = hUnidad ? row[hUnidad.original] : "";
    const costoBase = parseNumber(hCosto ? row[hCosto.original] : "");
    const precioInternoRaw = parseNumber(
      hPrecioInterno ? row[hPrecioInterno.original] : ""
    );
    const margenDeseado = parseNumber(hMargen ? row[hMargen.original] : "") ?? 0;

    if (!nombre || costoBase === null) {
      continue;
    }

    const tipoItem = inferTipoItem(nombre, categoria, tipoRaw);
    const unidad =
      String(unidadArchivo || "").trim() ||
      (tipoItem === "producto" ? "unidad" : "servicio");
    const precioInterno =
      precioInternoRaw ??
      Math.round(costoBase + (costoBase * margenDeseado) / 100);

    filasValidas += 1;
    items.push({
      nombre: String(nombre).trim(),
      tipoItem,
      categoria: String(categoria || "").trim(),
      descripcion: String(descripcion || "").trim(),
      unidad,
      costoBase,
      precioInterno,
      margenDeseado,
      estado: "activo",
      sku: String(sku || "").trim() || null,
    });
  }

  return {
    items,
    totalFilas: rows.length,
    filasValidas,
  };
}

export async function importarInventarioEnFirestore(userId, items) {
  if (!userId) {
    throw new Error("userId es requerido para importar inventario.");
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { creados: 0 };
  }

  return importInventoryItems(userId, items);
}
