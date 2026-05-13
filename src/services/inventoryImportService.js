import * as XLSX from "xlsx";
import { importInventoryItems } from "./inventoryService";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

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
  const txt = normalizeText(`${nombre || ""} ${categoria || ""} ${tipoRaw || ""}`);
  if (
    txt.includes("actividad") ||
    txt.includes("traslado") ||
    txt.includes("visita")
  ) {
    return "actividad";
  }
  if (
    txt.includes("servicio") ||
    txt.includes("instalacion") ||
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
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

export async function leerArchivoInventario(file) {
  if (!file) {
    throw new Error("No se recibio archivo de inventario.");
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
    norm: normalizeText(header),
  }));

  const findHeader = (...candidates) =>
    headers.find((header) =>
      candidates.some((candidate) => header.norm.includes(normalizeText(candidate)))
    ) || null;

  const hNombre = findHeader("nombre", "producto", "item", "item");
  const hTipo = findHeader("tipoItem", "tipo item", "tipo");
  const hCategoria = findHeader("categoria", "rubro", "familia");
  const hDescripcion = findHeader("descripcion", "detalle");
  const hSku = findHeader("sku", "codigo");
  const hCosto = findHeader("costo base", "costoBase", "costo", "valor", "precio compra");
  const hPrecioInterno = findHeader("precio interno", "precioInterno", "precio venta");
  const hMargen = findHeader("margen", "margenDeseado", "margen deseado");
  const hUnidad = findHeader("unidad", "u.medida", "medida");
  const hEstado = findHeader("estado");

  const items = [];
  let filasValidas = 0;

  for (const row of rows) {
    const nombre = hNombre ? row[hNombre.original] : "";
    const categoria = hCategoria ? row[hCategoria.original] : "";
    const descripcion = hDescripcion ? row[hDescripcion.original] : "";
    const tipoRaw = hTipo ? row[hTipo.original] : "";
    const sku = hSku ? row[hSku.original] : "";
    const unidadArchivo = hUnidad ? row[hUnidad.original] : "";
    const estadoArchivo = hEstado ? row[hEstado.original] : "";
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
      precioInternoRaw && precioInternoRaw > 0
        ? precioInternoRaw
        : Math.round(costoBase + (costoBase * margenDeseado) / 100);

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
      estado: String(estadoArchivo || "").trim().toLowerCase() || "activo",
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
    throw new Error("No hay usuario autenticado para importar inventario.");
  }

  if (!Array.isArray(items) || items.length === 0) {
    return {
      created: 0,
      updated: 0,
      total: 0,
      verifiedCount: 0,
      importados: 0,
      creados: 0,
      actualizados: 0,
    };
  }

  return importInventoryItems(userId, items);
}
