export const SALE_MODEL_VERSION = 1;
export const SALE_VAT_RATE = 0.19;
export const SALE_STATUSES = Object.freeze(["borrador", "confirmada", "cancelada"]);
export const SALE_DOCUMENT_TYPES = Object.freeze(["factura", "boleta", "otro", "sin_documento"]);
export const SALE_STATUS_LABELS = Object.freeze({
  borrador: "Preparada",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
});
export const SALE_ITEM_TYPE_LABELS = Object.freeze({
  producto: "Producto",
  servicio: "Servicio",
  actividad: "Actividad",
});
export const SALE_DOCUMENT_TYPE_LABELS = Object.freeze({
  factura: "Factura",
  boleta: "Boleta",
  otro: "Otro",
  sin_documento: "Sin documento",
});

const STATUS_SET = new Set(SALE_STATUSES);
const DOCUMENT_SET = new Set(SALE_DOCUMENT_TYPES);
const ITEM_TYPES = new Set(["producto", "servicio", "actividad"]);
const MAXIMUM_AMOUNT_MESSAGE = "El monto de la venta supera el máximo permitido.";

const text = (value, max = 2000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export function getSaleStatusLabel(status) {
  return SALE_STATUS_LABELS[String(status || "").toLowerCase()] || String(status || "");
}

export function getSaleItemTypeLabel(type) {
  return SALE_ITEM_TYPE_LABELS[String(type || "").toLowerCase()] || "Ítem";
}

export function getSaleDocumentTypeLabel(type) {
  return SALE_DOCUMENT_TYPE_LABELS[String(type || "").toLowerCase()] || "Sin documento";
}

function id(value, label, {optional = false} = {}) {
  const result = text(value, 160);
  if (optional && !result) return "";
  if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(result)) throw new Error(`${label} no es válido.`);
  return result;
}

function number(value, label, {minimum = 0, maximum = Infinity} = {}) {
  if (value === "" || value == null) throw new Error(`${label} es obligatorio.`);
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} debe ser un número válido.`);
  if (result < minimum || result > maximum) throw new Error(`${label} está fuera del rango permitido.`);
  return result;
}

function safeMoney(...values) {
  if (values.some((value) => !Number.isFinite(value) || !Number.isSafeInteger(value))) {
    throw new Error(MAXIMUM_AMOUNT_MESSAGE);
  }
}

export function calculateSaleLine(raw = {}, index = 0) {
  const cantidad = number(raw.cantidad, `Ítem ${index + 1}: cantidad`, {minimum: Number.MIN_VALUE});
  const precioUnitario = number(raw.precioUnitario, `Ítem ${index + 1}: precio unitario`);
  const descuentoPct = number(raw.descuentoPct ?? 0, `Ítem ${index + 1}: descuento`, {maximum: 100});
  const subtotalLinea = Math.round(cantidad * precioUnitario);
  const descuentoLinea = Math.round((subtotalLinea * descuentoPct) / 100);
  const totalLinea = subtotalLinea - descuentoLinea;
  safeMoney(subtotalLinea, descuentoLinea, totalLinea);
  return {cantidad, precioUnitario, descuentoPct, subtotalLinea, descuentoLinea, totalLinea};
}

export function calculateSaleTotals(
  items = [],
  descuentoGeneral = 0,
  {afectaIva = true, tasaIva = SALE_VAT_RATE} = {}
) {
  if (!Array.isArray(items) || !items.length) throw new Error("Agrega al menos un ítem a la venta.");
  const lines = items.map(calculateSaleLine);
  const subtotal = lines.reduce((sum, line) => sum + line.subtotalLinea, 0);
  const descuentoItems = lines.reduce((sum, line) => sum + line.descuentoLinea, 0);
  const descuento = number(descuentoGeneral ?? 0, "El descuento general");
  if (descuento > subtotal - descuentoItems) {
    throw new Error("El descuento general no puede superar el monto disponible.");
  }
  const effectiveRate = afectaIva ? number(tasaIva, "La tasa de IVA", {maximum: 1}) : 0;
  const descuentoTotal = descuentoItems + descuento;
  const neto = subtotal - descuentoTotal;
  const iva = afectaIva ? Math.round(neto * effectiveRate) : 0;
  const total = neto + iva;
  safeMoney(subtotal, descuentoItems, descuento, descuentoTotal, neto, iva, total);
  return {
    subtotal,
    descuentoItems,
    descuento,
    descuentoTotal,
    neto,
    afectaIva: Boolean(afectaIva),
    tasaIva: afectaIva ? effectiveRate : 0,
    iva,
    total,
  };
}

export function buildSaleMutationPayload(raw = {}) {
  if (!Array.isArray(raw.items) || !raw.items.length) throw new Error("Agrega al menos un ítem a la venta.");
  if (raw.items.length > 200) throw new Error("La venta admite hasta 200 ítems.");
  const descuento = number(raw.descuento ?? 0, "El descuento general");
  const afectaIva = raw.afectaIva !== false;
  calculateSaleTotals(raw.items, descuento, {afectaIva});
  return {
    clienteId: id(raw.clienteId, "El cliente"),
    descuento,
    afectaIva,
    fechaVenta: text(raw.fechaVenta, 10),
    fechaDocumento: text(raw.fechaDocumento, 10),
    tipoDocumento: DOCUMENT_SET.has(raw.tipoDocumento) ? raw.tipoDocumento : "sin_documento",
    numeroDocumento: text(raw.numeroDocumento, 120),
    condicionesPago: text(raw.condicionesPago, 2000),
    observaciones: text(raw.observaciones, 4000),
    items: raw.items.map((item, index) => {
      const values = calculateSaleLine(item, index);
      return {
        lineaId: id(item.lineaId || `linea-${index + 1}`, "La línea"),
        itemId: id(item.itemId, `Ítem ${index + 1}`, {optional: Boolean(raw.cotizacionId) && item.tipoItem !== "producto"}),
        cantidad: values.cantidad,
        precioUnitario: values.precioUnitario,
        descuentoPct: values.descuentoPct,
      };
    }),
  };
}

const clientSnapshot = (raw = {}) => ({
  clienteId: text(raw.clienteId || raw.id, 160),
  tipoCliente: text(raw.tipoCliente, 20),
  rut: text(raw.rut, 40),
  nombreRazonSocial: text(raw.nombreRazonSocial || raw.nombre, 240),
  giro: text(raw.giro, 240),
  email: text(raw.email, 240),
  telefono: text(raw.telefono, 100),
  direccion: text(raw.direccion, 300),
  personaContacto: text(raw.personaContacto, 200),
  regionCodigo: text(raw.regionCodigo, 20),
  regionNombre: text(raw.regionNombre, 160),
  comunaCodigo: text(raw.comunaCodigo, 20),
  comunaNombre: text(raw.comunaNombre, 160),
});

function storedLine(raw = {}, index = 0) {
  const snapshot = raw.inventarioSnapshot || {};
  const tipo = text(raw.tipoItem || snapshot.tipoItem, 20);
  return {
    lineaId: text(raw.lineaId, 160) || `linea-${index + 1}`,
    itemId: text(raw.itemId || snapshot.inventarioId, 160),
    codigo: text(raw.codigo || snapshot.codigoInterno, 100),
    nombre: text(raw.nombre || snapshot.nombre, 240) || "Ítem histórico",
    descripcion: text(raw.descripcion || snapshot.descripcion, 3000),
    tipoItem: ITEM_TYPES.has(tipo) ? tipo : "producto",
    unidad: text(raw.unidad || snapshot.unidad, 80) || "unidad",
    cantidadCotizada: raw.cantidadCotizada == null ? null : Number(raw.cantidadCotizada),
    ...calculateSaleLine(raw, index),
  };
}

export function adaptStoredSale(raw = {}) {
  const items = (Array.isArray(raw.items) ? raw.items : []).map(storedLine);
  const localization = adaptDocumentLocalization(raw);
  const afectaIva = raw.afectaIva !== false;
  const totals = items.length
    ? calculateSaleTotals(items, raw.descuento ?? 0, {afectaIva, tasaIva: localization.tasaIva})
    : {
        subtotal: 0,
        descuentoItems: 0,
        descuento: Number(raw.descuento || 0),
        descuentoTotal: Number(raw.descuento || 0),
        neto: 0,
        afectaIva,
        tasaIva: afectaIva ? localization.tasaIva : 0,
        iva: 0,
        total: 0,
      };
  const estado = text(raw.estado, 20).toLowerCase();
  const cliente = clientSnapshot(raw.clienteSnapshot || {clienteId: raw.clienteId, nombreRazonSocial: raw.clienteNombre, rut: raw.clienteRut});
  return {
    ...raw,
    empresaSnapshot: adaptCompanySnapshot(raw.empresaSnapshot || raw.empresa || {}),
    ...localization,
    id: text(raw.id || raw.ventaId, 160),
    ventaId: text(raw.ventaId || raw.id, 160),
    numero: text(raw.numero, 120),
    estado: STATUS_SET.has(estado) ? estado : "borrador",
    clienteId: text(raw.clienteId || cliente.clienteId, 160),
    clienteSnapshot: cliente,
    cotizacionId: text(raw.cotizacionId, 160),
    cotizacionNumero: text(raw.cotizacionNumero, 120),
    fechaVenta: text(raw.fechaVenta, 10),
    fechaDocumento: text(raw.fechaDocumento, 10),
    tipoDocumento: DOCUMENT_SET.has(raw.tipoDocumento) ? raw.tipoDocumento : "sin_documento",
    numeroDocumento: text(raw.numeroDocumento, 120),
    condicionesPago: text(raw.condicionesPago, 2000),
    observaciones: text(raw.observaciones, 4000),
    stockAplicado: raw.stockAplicado === true,
    items,
    ...totals,
  };
}

export function canManageSales(role) {
  return ["OWNER", "ADMIN"].includes(String(role || "").toUpperCase());
}

export function shouldReconcileSaleConfirmation(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  return ![
    "already-exists",
    "failed-precondition",
    "invalid-argument",
    "not-found",
    "permission-denied",
    "unauthenticated",
  ].includes(code);
}

export function matchesSaleSearch(sale, search) {
  const normalize = (value) => text(value, 600).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const query = normalize(search);
  if (!query) return true;
  return normalize(`${sale.numero} ${sale.clienteSnapshot?.nombreRazonSocial} ${sale.clienteSnapshot?.rut} ${sale.numeroDocumento} ${sale.cotizacionNumero}`).includes(query);
}
import {adaptDocumentLocalization} from "./localization.mjs";
import {adaptCompanySnapshot} from "./companySnapshot.mjs";
