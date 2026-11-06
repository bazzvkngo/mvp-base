import {adaptStoredFiscalIdentifier} from "./fiscalIdentifier.mjs";

export const PURCHASE_ORDER_MODEL_VERSION = 1;
export const PURCHASE_ORDER_VAT_RATE = 0.19;
export const PURCHASE_ORDER_STATUSES = Object.freeze([
  "borrador",
  "emitida",
  "cancelada",
]);

const STATUS_SET = new Set(PURCHASE_ORDER_STATUSES);
const ITEM_TYPE_SET = new Set(["producto", "servicio", "actividad"]);
const MAXIMUM_AMOUNT_MESSAGE = "El monto de la orden supera el máximo permitido.";
const paymentLabel = (value) => ({contado: "Contado", transferencia: "Transferencia", credito: "Crédito", otro: "Otro"})[value] || value;

function text(value, maxLength = 2000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function validId(value, label) {
  const result = text(value, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(result)) {
    throw new Error(`${label} no es válido.`);
  }
  return result;
}

function finiteNumber(value, label, {minimum = 0, maximum = Infinity} = {}) {
  if (value === "" || value === null || value === undefined) {
    throw new Error(`${label} es obligatorio.`);
  }
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} debe ser un número válido.`);
  if (result < minimum) throw new Error(`${label} debe ser mayor o igual a ${minimum}.`);
  if (result > maximum) throw new Error(`${label} no puede superar ${maximum}.`);
  return result;
}

function assertSafeMoney(...values) {
  if (values.some((value) => !Number.isFinite(value) || !Number.isSafeInteger(value))) {
    throw new Error(MAXIMUM_AMOUNT_MESSAGE);
  }
}

export function calculatePurchaseOrderLine(raw = {}, index = 0) {
  const cantidad = finiteNumber(raw.cantidad, `Ítem ${index + 1}: cantidad`, {
    minimum: Number.MIN_VALUE,
  });
  const costoUnitario = finiteNumber(
    raw.costoUnitario,
    `Ítem ${index + 1}: costo unitario`
  );
  const descuentoPct = finiteNumber(
    raw.descuentoPct ?? 0,
    `Ítem ${index + 1}: descuento`,
    {maximum: 100}
  );
  const subtotalLinea = Math.round(cantidad * costoUnitario);
  const descuentoLinea = Math.round((subtotalLinea * descuentoPct) / 100);
  const totalLinea = subtotalLinea - descuentoLinea;
  assertSafeMoney(subtotalLinea, descuentoLinea, totalLinea);
  return {
    cantidad,
    costoUnitario,
    descuentoPct,
    subtotalLinea,
    descuentoLinea,
    totalLinea,
  };
}

export function calculatePurchaseOrderTotals(items = [], {tasaIva = PURCHASE_ORDER_VAT_RATE} = {}) {
  if (!Array.isArray(items)) throw new Error("Los ítems de la orden no son válidos.");
  const lines = items.map(calculatePurchaseOrderLine);
  const subtotal = lines.reduce((sum, line) => sum + line.subtotalLinea, 0);
  const descuentoTotal = lines.reduce((sum, line) => sum + line.descuentoLinea, 0);
  const neto = subtotal - descuentoTotal;
  const iva = Math.round(neto * tasaIva);
  const total = neto + iva;
  assertSafeMoney(subtotal, descuentoTotal, neto, iva, total);
  return {subtotal, descuentoTotal, neto, iva, total};
}

export function resolvePurchaseOrderProviderPreview(
  order,
  draftProveedorId,
  providers = []
) {
  if (order && draftProveedorId === order.proveedorId) {
    return order.proveedorSnapshot || null;
  }
  return providers.find((provider) =>
    provider.proveedorId === draftProveedorId && provider.estado === "activo"
  ) || null;
}

export function getProviderPurchaseOrderPaymentTerms(provider = {}) {
  const terms = text(provider.condicionesPago, 2000);
  if (!terms) return "";
  const label = paymentLabel(terms.toLocaleLowerCase("es-CL"));
  const creditDays = Number(provider.diasCredito);
  return terms.toLocaleLowerCase("es-CL") === "credito" && Number.isSafeInteger(creditDays) && creditDays > 0
    ? `${label} a ${creditDays} días`
    : label;
}

export function buildPurchaseOrderMutationPayload(raw = {}) {
  const proveedorId = validId(raw.proveedorId, "El proveedor");
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error("Agrega al menos un ítem a la orden de compra.");
  }
  if (raw.items.length > 250) throw new Error("La orden admite hasta 250 ítems.");

  return {
    proveedorId,
    fechaEntregaEstimada: text(raw.fechaEntregaEstimada, 10),
    direccionEntrega: text(raw.direccionEntrega, 500),
    condicionesPago: paymentLabel(text(raw.condicionesPago, 2000)),
    observaciones: text(raw.observaciones, 4000),
    items: raw.items.map((item, index) => {
      const calculated = calculatePurchaseOrderLine(item, index);
      return {
        lineaId: validId(item.lineaId || `linea-${index + 1}`, "La línea"),
        itemId: validId(item.itemId, `Ítem ${index + 1}`),
        cantidad: calculated.cantidad,
        costoUnitario: calculated.costoUnitario,
        descuentoPct: calculated.descuentoPct,
      };
    }),
  };
}

function adaptProviderSnapshot(raw = {}) {
  return {
    proveedorId: text(raw.proveedorId || raw.id, 160),
    ...adaptStoredFiscalIdentifier(raw),
    razonSocial: text(raw.razonSocial || raw.nombre || raw.nombreProveedor, 240),
    nombreFantasia: text(raw.nombreFantasia, 240),
    giro: text(raw.giro, 240),
    personaContacto: text(raw.personaContacto || raw.contacto, 200),
    email: text(raw.email || raw.correo, 240),
    telefono: text(raw.telefono, 100),
    direccion: text(raw.direccion, 300),
    regionCodigo: text(raw.regionCodigo, 20),
    regionNombre: text(raw.regionNombre || raw.region, 160),
    comunaCodigo: text(raw.comunaCodigo, 20),
    comunaNombre: text(raw.comunaNombre || raw.comuna, 160),
    condicionesPago: text(raw.condicionesPago, 2000),
    diasCredito: Number.isSafeInteger(Number(raw.diasCredito))
      ? Number(raw.diasCredito)
      : 0,
  };
}

function adaptStoredLine(raw = {}, index = 0) {
  const snapshot = raw.inventarioSnapshot || raw.itemSnapshot || {};
  const calculations = calculatePurchaseOrderLine({
    cantidad: raw.cantidad ?? 1,
    costoUnitario: raw.costoUnitario ?? raw.costo ?? raw.precioUnitario ?? 0,
    descuentoPct: raw.descuentoPct ?? raw.descuentoPorcentaje ?? 0,
  }, index);
  const tipoItem = text(raw.tipoItem || raw.tipo || snapshot.tipoItem, 20);
  return {
    lineaId: text(raw.lineaId, 160) || `linea-${index + 1}`,
    itemId: text(raw.itemId || raw.inventarioId || snapshot.inventarioId, 160),
    codigo: text(raw.codigo || snapshot.codigoInterno || snapshot.sku, 100),
    nombre: text(raw.nombre || snapshot.nombre, 240) || "Ítem histórico",
    descripcion: text(raw.descripcion || snapshot.descripcion, 3000),
    tipoItem: ITEM_TYPE_SET.has(tipoItem) ? tipoItem : "producto",
    unidad: text(raw.unidad || snapshot.unidad, 80) || "unidad",
    ...calculations,
  };
}

export function adaptStoredPurchaseOrder(raw = {}) {
  const items = (Array.isArray(raw.items) ? raw.items : []).map(adaptStoredLine);
  const localization = adaptDocumentLocalization(raw);
  const calculated = calculatePurchaseOrderTotals(items, {tasaIva: localization.tasaIva});
  const estado = text(raw.estado, 20).toLowerCase();
  const proveedorSnapshot = adaptProviderSnapshot(
    raw.proveedorSnapshot || raw.proveedor || {
      proveedorId: raw.proveedorId,
      razonSocial: raw.proveedorNombre,
      rut: raw.proveedorRut,
    }
  );
  return {
    ...raw,
    empresaSnapshot: adaptCompanySnapshot(raw.empresaSnapshot || raw.empresa || {}),
    id: text(raw.id || raw.ordenCompraId, 160),
    ordenCompraId: text(raw.ordenCompraId || raw.id, 160),
    numero: text(raw.numero || raw.numeroOrdenCompra, 120),
    proveedorId: text(raw.proveedorId || proveedorSnapshot.proveedorId, 160),
    proveedorSnapshot,
    items,
    estado: STATUS_SET.has(estado) ? estado : "borrador",
    fechaEmision: text(raw.fechaEmision || raw.fecha, 10),
    fechaEntregaEstimada: text(raw.fechaEntregaEstimada, 10),
    direccionEntrega: text(raw.direccionEntrega, 500),
    condicionesPago: paymentLabel(text(raw.condicionesPago, 2000)),
    observaciones: text(raw.observaciones, 4000),
    ...localization,
    ...calculated,
  };
}

export function matchesPurchaseOrderSearch(order, search) {
  const normalize = (value) => text(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL");
  const query = normalize(search);
  if (!query) return true;
  return normalize(
    `${order?.numero || ""} ${order?.proveedorSnapshot?.razonSocial || ""} ` +
      `${order?.proveedorSnapshot?.rut || ""}`
  ).includes(query);
}

export function canManagePurchaseOrders(role) {
  return ["OWNER", "ADMIN", "COMPRAS"].includes(String(role || "").toUpperCase());
}

// Eliminación permanente (SPEC 005, enmienda 2026-11-06). Estas funciones solo
// orientan la interfaz (ocultan el botón); la autoridad real es la Function
// eliminarOrdenCompra, que vuelve a validar rol, palabra, estado y dependencias.
// Espejo de functions/purchaseOrderDeletion.js: si cambia allí, cambia aquí.
export const DELETE_CONFIRMATION_WORD = "permanente";
const DELETE_ROLES = new Set(["OWNER", "ADMIN"]);

export function canDeletePurchaseOrder(role) {
  return DELETE_ROLES.has(String(role || "").toUpperCase());
}

export function isDeleteConfirmed(value) {
  return String(value ?? "").trim().slice(0, 100).toLowerCase() === DELETE_CONFIRMATION_WORD;
}

const hasStoredValue = (value) =>
  value !== undefined && value !== null && value !== "" && value !== false;

// Rastro de que la orden se emitió o se envió alguna vez (misma lista que
// findEmissionTrace en el backend). Un envío fallido o simulado no cuenta.
export function hasPurchaseOrderEmissionTrace(order) {
  const safe = order || {};
  if (safe.estado === "emitida") return true;
  if (
    hasStoredValue(safe.emitidaEn) ||
    hasStoredValue(safe.emitidaPorUid) ||
    hasStoredValue(safe.canalEmision) ||
    hasStoredValue(safe.destinatarioEmision)
  ) {
    return true;
  }
  if (
    Number(safe.cantidadEnvios || 0) > 0 ||
    hasStoredValue(safe.ultimoEnvioEn) ||
    hasStoredValue(safe.reenviadaEn)
  ) {
    return true;
  }
  const response = safe.respuestaProveedor || {};
  if (
    hasStoredValue(response.fecha) ||
    (hasStoredValue(response.estado) && response.estado !== "pendiente")
  ) {
    return true;
  }
  return safe.enviadoPorCorreo === true || safe.estadoEnvioCorreo === "enviado";
}

// ¿Se ofrece "Eliminar" para esta orden? Solo si el rol puede y la orden es un
// borrador, o una cancelada sin ningún rastro de emisión. Además se oculta con
// un envío por correo en curso o con vínculos a recepciones o compras, que la
// Function también rechaza.
export function canOfferPurchaseOrderDeletion(order, role) {
  if (!order || !canDeletePurchaseOrder(role)) return false;
  if (!["borrador", "cancelada"].includes(order.estado)) return false;
  if (hasPurchaseOrderEmissionTrace(order)) return false;
  if (order.estadoEnvioCorreo === "enviando") return false;
  return !(
    hasStoredValue(order.compraId) ||
    (Array.isArray(order.comprasDesdeRecepciones) && order.comprasDesdeRecepciones.length > 0) ||
    hasStoredValue(order.estadoRecepcion) ||
    hasStoredValue(order.recepcionResumen)
  );
}

// Mensaje de un intento de eliminar fallido. Los mensajes reales de la Function (en español, de
// varias palabras: failed-precondition, permission-denied, not-found de una orden...) se muestran
// tal cual. Si el error no trae un texto legible (vacío, una sola palabra técnica como "internal"
// o "NOT_FOUND", o un fallo de red del navegador), se muestra un mensaje genérico.
export const DELETE_FALLBACK_MESSAGE = "No pudimos eliminar la orden de compra. Inténtalo de nuevo.";
const NETWORK_MESSAGE = /failed to fetch|network ?(request )?(error|failed)|load failed|networkerror/i;

export function getPurchaseOrderDeleteErrorMessage(error) {
  const message = String(error?.message ?? "").trim();
  // Una sola palabra ("internal", "unavailable", "NOT_FOUND"...) es el estado técnico del SDK, no un mensaje.
  if (!message || !/\s/.test(message) || NETWORK_MESSAGE.test(message)) return DELETE_FALLBACK_MESSAGE;
  return message;
}

export function getSupplierResponseState(order) {
  const value = text(order?.respuestaProveedor?.estado, 40).toLowerCase();
  return ["pendiente", "confirmada", "rechazada", "confirmada_con_observaciones"].includes(value)
    ? value
    : "pendiente";
}

export function getSupplierResponseLabel(order) {
  return ({
    pendiente: "Pendiente",
    confirmada: "Confirmada",
    rechazada: "Rechazada",
    confirmada_con_observaciones: "Confirmada con observaciones",
  })[
    getSupplierResponseState(order)
  ];
}
import {adaptDocumentLocalization} from "./localization.mjs";
import {adaptCompanySnapshot} from "./companySnapshot.mjs";
