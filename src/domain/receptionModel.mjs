export const RECEPTION_MODEL_VERSION = 1;
export const RECEPTION_STATUSES = Object.freeze(["borrador", "confirmada", "cancelada"]);

const text = (value, max = 2000) => String(value ?? "").trim()
  .replace(/\s+/g, " ").slice(0, max);

const optionalNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const adaptDocumentParty = (raw = {}) => ({
  nombre: text(raw?.nombre, 240),
  identificadorFiscal: text(raw?.identificadorFiscal, 80),
});

function adaptReceptionDocumentSource(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const nombreArchivo = text(raw.nombreArchivo, 240);
  if (!nombreArchivo) return null;
  return {
    origen: "importador_documental",
    nombreArchivo,
    tipoArchivo: text(raw.tipoArchivo, 120),
    extension: text(raw.extension, 12).toLowerCase(),
    tamanoBytes: Number(raw.tamanoBytes || 0),
    tipoDocumento: text(raw.tipoDocumento, 40) || "otro",
    numeroDocumento: text(raw.numeroDocumento, 120),
    fechaDocumento: text(raw.fechaDocumento, 10),
    fechaVencimiento: text(raw.fechaVencimiento, 10),
    condicionesPago: text(raw.condicionesPago, 1000),
    moneda: text(raw.moneda, 12).toUpperCase(),
    proveedorDocumento: adaptDocumentParty(raw.proveedorDocumento),
    receptorDocumento: adaptDocumentParty(raw.receptorDocumento),
    neto: optionalNumber(raw.neto),
    impuestoPorcentaje: optionalNumber(raw.impuestoPorcentaje),
    impuestoMonto: optionalNumber(raw.impuestoMonto),
    total: optionalNumber(raw.total),
    coherenciaEstado: ["coherente", "revisar", "sin_datos"].includes(raw.coherenciaEstado)
      ? raw.coherenciaEstado
      : "sin_datos",
    lineasDetectadas: Number(raw.lineasDetectadas || 0),
    lineasAplicadas: Number(raw.lineasAplicadas || 0),
    advertencias: (Array.isArray(raw.advertencias) ? raw.advertencias : [])
      .map((warning) => text(warning, 300)).filter(Boolean).slice(0, 20),
    importadoEn: raw.importadoEn || null,
    actualizadoEn: raw.actualizadoEn || null,
  };
}

function adaptDocumentLines(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 20).map((line) => ({
    nombre: text(line?.nombre, 240),
    codigoProveedor: text(line?.codigoProveedor || line?.codigo, 100),
    unidad: text(line?.unidad, 80),
    cantidad: Number(line?.cantidad || 0),
    costoUnitario: Number(line?.costoUnitario || 0),
    descuentoPct: Number(line?.descuentoPct || 0),
  }));
}

export function getReceptionStatusLabel(value) {
  return ({borrador: "Preparada", confirmada: "Recibida", cancelada: "Cancelada"})[value] || "Preparada";
}

export function getReceptionPurchaseAction(reception = {}, purchase = null, canManage = false) {
  if (!reception || reception.estado !== "confirmada") return "";
  if (!reception.compraId) return "";
  return "view";
}

export function getSupplierResponseLabel(value) {
  return ({confirmada: "Confirmada", rechazada: "Rechazada", pendiente: "Sin respuesta"})[value] || "Sin respuesta";
}

export function adaptStoredReception(raw = {}) {
  const state = text(raw.estado, 20).toLowerCase();
  return {
    ...raw,
    empresaSnapshot: adaptCompanySnapshot(raw.empresaSnapshot || raw.empresa || {}),
    id: text(raw.id || raw.recepcionId, 160),
    recepcionId: text(raw.recepcionId || raw.id, 160),
    numero: text(raw.numero, 120),
    estado: RECEPTION_STATUSES.includes(state) ? state : "borrador",
    fechaRecepcion: text(raw.fechaRecepcion, 10),
    ordenCompraId: text(raw.ordenCompraId, 160),
    ordenCompraNumero: text(raw.ordenCompraNumero, 120),
    proveedorId: text(raw.proveedorId, 160),
    proveedorSnapshot: raw.proveedorSnapshot || {},
    respuestaProveedorEstado: text(raw.respuestaProveedorEstado, 20) || "pendiente",
    observaciones: text(raw.observaciones, 4000),
    documentoOrigen: adaptReceptionDocumentSource(raw.documentoOrigen),
    compraId: text(raw.compraId, 160),
    compraNumero: text(raw.compraNumero, 120),
    compraEstado: text(raw.compraEstado, 20),
    compraReversionMotivo: text(raw.compraReversionMotivo, 1000),
    compraRevertidaEn: raw.compraRevertidaEn || null,
    items: (Array.isArray(raw.items) ? raw.items : []).map((line, index) => ({
      ...line,
      lineaId: text(line.lineaId || line.ordenLineaId, 160) || `linea-${index + 1}`,
      ordenLineaId: text(line.ordenLineaId || line.lineaId, 160),
      itemId: text(line.itemId, 160),
      nombre: text(line.nombre, 240) || "Item historico",
      codigo: text(line.codigo, 100),
      unidad: text(line.unidad, 80) || "unidad",
      tipoItem: ["producto", "servicio", "actividad"].includes(line.tipoItem)
        ? line.tipoItem
        : "producto",
      cantidadSolicitada: Number(line.cantidadSolicitada || 0),
      cantidadRecibidaAnterior: Number(line.cantidadRecibidaAnterior || 0),
      cantidad: Number(line.cantidad || 0),
      costoUnitario: Number(line.costoUnitario || 0),
      descuentoPct: Number(line.descuentoPct || 0),
      documentoLineas: adaptDocumentLines(line.documentoLineas),
    })),
  };
}

export function buildReceptionMutationPayload(raw = {}) {
  const fechaRecepcion = text(raw.fechaRecepcion, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRecepcion)) {
    throw new Error("Selecciona una fecha de recepcion valida.");
  }
  const items = (Array.isArray(raw.items) ? raw.items : []).map((line) => ({
    lineaId: text(line.lineaId || line.ordenLineaId, 160),
    cantidad: Number(line.cantidad || 0),
    costoUnitario: Number(line.costoUnitario || 0),
    descuentoPct: Number(line.descuentoPct || 0),
    documentoLineas: adaptDocumentLines(line.documentoLineas),
  }));
  if (!items.some((line) => Number.isFinite(line.cantidad) && line.cantidad > 0)) {
    throw new Error("Registra al menos una cantidad recibida.");
  }
  if (items.some((line) => !line.lineaId || !Number.isFinite(line.cantidad) || line.cantidad < 0)) {
    throw new Error("Las cantidades de la recepcion no son validas.");
  }
  if (items.some((line) => !Number.isFinite(line.costoUnitario) || line.costoUnitario < 0 ||
    !Number.isFinite(line.descuentoPct) || line.descuentoPct < 0 || line.descuentoPct > 100)) {
    throw new Error("Los costos o descuentos de la recepcion no son validos.");
  }
  return {
    fechaRecepcion,
    observaciones: text(raw.observaciones, 4000),
    documentoOrigen: adaptReceptionDocumentSource(raw.documentoOrigen),
    items,
  };
}

export function getOrderReceptionStatus(order, receptions = []) {
  const related = receptions.filter((entry) =>
    entry.ordenCompraId === (order.id || order.ordenCompraId) && entry.estado === "confirmada"
  );
  if (!related.length) return "sin_recepcion";
  const totals = new Map();
  related.forEach((entry) => entry.items.forEach((line) => {
    totals.set(line.ordenLineaId, (totals.get(line.ordenLineaId) || 0) + line.cantidad);
  }));
  const complete = (order.items || []).every((line) =>
    (totals.get(line.lineaId) || 0) >= Number(line.cantidad || 0) - 0.000001
  );
  return complete ? "recibida_total" : "recibida_parcial";
}

export function getOrderReceptionStatusLabel(value) {
  return ({sin_recepcion: "Pendiente de recepción", recibida_parcial: "Parcialmente recibida", recibida_total: "Recibida"})[value] || "Pendiente de recepción";
}

export function getOrderReceptionProgress(order, receptions = []) {
  const requested = (order.items || []).reduce((sum, line) => sum + Number(line.cantidad || 0), 0);
  const received = receptions.filter((entry) =>
    entry.ordenCompraId === (order.id || order.ordenCompraId) && entry.estado === "confirmada"
  ).reduce((sum, entry) => sum + entry.items.reduce((subtotal, line) =>
    subtotal + Number(line.cantidad || 0), 0), 0);
  return {received, requested};
}

export function canManageReceptions(role) {
  return ["OWNER", "ADMIN", "COMPRAS"].includes(String(role || "").toUpperCase());
}

export function shouldReconcileReceptionConfirmation(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  return ["cancelled", "deadline-exceeded", "internal", "unknown", "unavailable"].includes(code);
}

import {adaptCompanySnapshot} from "./companySnapshot.mjs";
