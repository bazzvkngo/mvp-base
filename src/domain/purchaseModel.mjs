import {adaptStoredFiscalIdentifier} from "./fiscalIdentifier.mjs";

export const PURCHASE_MODEL_VERSION = 2;
export const PURCHASE_VAT_RATE = 0.19;
export const PURCHASE_STATUSES = Object.freeze(["borrador", "confirmada", "cancelada"]);
export const PURCHASE_DOCUMENT_TYPES = Object.freeze(["factura", "boleta", "otro", "sin_documento"]);

export function getPurchaseStatusLabel(value) {
  return ({borrador: "Preparada", confirmada: "Confirmada", cancelada: "Cancelada"})[value] || "Preparada";
}

export function getPurchaseDocumentTypeLabel(value) {
  return ({factura: "Factura", boleta: "Boleta", otro: "Otro", sin_documento: "Sin documento"})[value] || "Sin documento";
}

export function shouldReconcilePurchaseConfirmation(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  return ["cancelled", "deadline-exceeded", "internal", "unknown", "unavailable"].includes(code);
}

const STATUS_SET = new Set(PURCHASE_STATUSES);
const DOCUMENT_SET = new Set(PURCHASE_DOCUMENT_TYPES);
const ITEM_TYPES = new Set(["producto", "servicio", "actividad"]);
const MAXIMUM_AMOUNT_MESSAGE = "El monto de la compra supera el máximo permitido.";
const paymentLabel = (value) => ({contado: "Contado", transferencia: "Transferencia", credito: "Crédito", otro: "Otro"})[value] || value;

const text = (value, max = 2000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

function id(value, label) {
  const result = text(value, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(result)) throw new Error(`${label} no es válido.`);
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

export function calculatePurchaseLine(raw = {}, index = 0) {
  const cantidad = number(raw.cantidad, `Ítem ${index + 1}: cantidad`, {minimum: Number.MIN_VALUE});
  const costoUnitario = number(raw.costoUnitario, `Ítem ${index + 1}: costo unitario`);
  const descuentoPct = number(raw.descuentoPct ?? 0, `Ítem ${index + 1}: descuento`, {maximum: 100});
  const subtotalLinea = Math.round(cantidad * costoUnitario);
  const descuentoLinea = Math.round((subtotalLinea * descuentoPct) / 100);
  const totalLinea = subtotalLinea - descuentoLinea;
  safeMoney(subtotalLinea, descuentoLinea, totalLinea);
  return {cantidad, costoUnitario, descuentoPct, subtotalLinea, descuentoLinea, totalLinea};
}

export function calculatePurchaseTotals(items = [], {tasaIva = PURCHASE_VAT_RATE} = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error("Agrega al menos un ítem a la compra.");
  const lines = items.map(calculatePurchaseLine);
  const subtotal = lines.reduce((sum, line) => sum + line.subtotalLinea, 0);
  const descuentoTotal = lines.reduce((sum, line) => sum + line.descuentoLinea, 0);
  const neto = subtotal - descuentoTotal;
  const iva = Math.round(neto * tasaIva);
  const total = neto + iva;
  safeMoney(subtotal, descuentoTotal, neto, iva, total);
  return {subtotal, descuentoTotal, neto, iva, total};
}

export function buildPurchaseMutationPayload(raw = {}) {
  if (!Array.isArray(raw.items) || !raw.items.length) throw new Error("Agrega al menos un ítem a la compra.");
  if (raw.items.length > 200) throw new Error("La compra admite hasta 200 ítems.");
  const tipoDocumento = DOCUMENT_SET.has(raw.tipoDocumento) ? raw.tipoDocumento : "sin_documento";
  return {
    proveedorId: id(raw.proveedorId, "El proveedor"),
    fechaCompra: text(raw.fechaCompra, 10),
    fechaDocumento: text(raw.fechaDocumento, 10),
    tipoDocumento,
    numeroDocumentoProveedor: text(raw.numeroDocumentoProveedor, 120),
    condicionesPago: text(raw.condicionesPago, 2000),
    observaciones: text(raw.observaciones, 4000),
    items: raw.items.map((item, index) => {
      const values = calculatePurchaseLine(item, index);
      return {
        lineaId: id(item.lineaId || `linea-${index + 1}`, "La línea"),
        itemId: id(item.itemId, `Ítem ${index + 1}`),
        cantidad: values.cantidad,
        costoUnitario: values.costoUnitario,
        descuentoPct: values.descuentoPct,
      };
    }),
  };
}

const providerSnapshot = (raw = {}) => ({
  proveedorId: text(raw.proveedorId || raw.id, 160), ...adaptStoredFiscalIdentifier(raw),
  razonSocial: text(raw.razonSocial || raw.nombre, 240), nombreFantasia: text(raw.nombreFantasia, 240),
  giro: text(raw.giro, 240), personaContacto: text(raw.personaContacto, 200), email: text(raw.email, 240),
  telefono: text(raw.telefono, 100), direccion: text(raw.direccion, 300), condicionesPago: text(raw.condicionesPago, 2000),
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
    ...calculatePurchaseLine(raw, index),
  };
}

export function adaptStoredPurchase(raw = {}) {
  const items = (Array.isArray(raw.items) ? raw.items : []).map(storedLine);
  const localization = adaptDocumentLocalization(raw);
  const totals = items.length ? calculatePurchaseTotals(items, {tasaIva: localization.tasaIva}) : {subtotal: 0, descuentoTotal: 0, neto: 0, iva: 0, total: 0};
  const estado = text(raw.estado, 20).toLowerCase();
  const proveedor = providerSnapshot(raw.proveedorSnapshot || {proveedorId: raw.proveedorId, razonSocial: raw.proveedorNombre, rut: raw.proveedorRut});
  return {
    ...raw,
    empresaSnapshot: adaptCompanySnapshot(raw.empresaSnapshot || raw.empresa || {}),
    ...localization,
    id: text(raw.id || raw.compraId, 160), compraId: text(raw.compraId || raw.id, 160),
    numero: text(raw.numero, 120), estado: STATUS_SET.has(estado) ? estado : "borrador",
    proveedorId: text(raw.proveedorId || proveedor.proveedorId, 160), proveedorSnapshot: proveedor,
    ordenCompraId: text(raw.ordenCompraId, 160), ordenCompraNumero: text(raw.ordenCompraNumero, 120),
    recepcionId: text(raw.recepcionId, 160), recepcionNumero: text(raw.recepcionNumero, 120),
    stockGestionadoPor: text(raw.stockGestionadoPor, 40),
    fechaCompra: text(raw.fechaCompra, 10), fechaDocumento: text(raw.fechaDocumento, 10),
    tipoDocumento: DOCUMENT_SET.has(raw.tipoDocumento) ? raw.tipoDocumento : "sin_documento",
    numeroDocumentoProveedor: text(raw.numeroDocumentoProveedor, 120),
    condicionesPago: paymentLabel(text(raw.condicionesPago, 2000)), observaciones: text(raw.observaciones, 4000),
    items, ...totals,
  };
}

export function canManagePurchases(role) {
  return ["OWNER", "ADMIN", "COMPRAS"].includes(String(role || "").toUpperCase());
}

export function matchesPurchaseSearch(purchase, search) {
  const normalize = (value) => text(value, 600).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const query = normalize(search);
  if (!query) return true;
  return normalize(`${purchase.numero} ${purchase.proveedorSnapshot?.razonSocial} ${purchase.proveedorSnapshot?.rut} ${purchase.numeroDocumentoProveedor} ${purchase.ordenCompraNumero} ${purchase.recepcionNumero}`).includes(query);
}
import {adaptDocumentLocalization} from "./localization.mjs";
import {adaptCompanySnapshot} from "./companySnapshot.mjs";
