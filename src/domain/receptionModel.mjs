export const RECEPTION_MODEL_VERSION = 1;
export const RECEPTION_STATUSES = Object.freeze(["borrador", "confirmada", "cancelada"]);

const text = (value, max = 2000) => String(value ?? "").trim()
  .replace(/\s+/g, " ").slice(0, max);

export function getReceptionStatusLabel(value) {
  return ({borrador: "Preparada", confirmada: "Recibida", cancelada: "Cancelada"})[value] || "Preparada";
}

export function getReceptionPurchaseAction(reception = {}, purchase = null, canManage = false) {
  if (!reception || reception.estado !== "confirmada") return "";
  if (!reception.compraId) return canManage ? "prepare" : "";
  return canManage && purchase?.estado === "borrador" ? "continue" : "view";
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
    compraId: text(raw.compraId, 160),
    compraNumero: text(raw.compraNumero, 120),
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
  }));
  if (!items.some((line) => Number.isFinite(line.cantidad) && line.cantidad > 0)) {
    throw new Error("Registra al menos una cantidad recibida.");
  }
  if (items.some((line) => !line.lineaId || !Number.isFinite(line.cantidad) || line.cantidad < 0)) {
    throw new Error("Las cantidades de la recepcion no son validas.");
  }
  return {fechaRecepcion, observaciones: text(raw.observaciones, 4000), items};
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
  return ["OWNER", "ADMIN"].includes(String(role || "").toUpperCase());
}

export function shouldReconcileReceptionConfirmation(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  return ["cancelled", "deadline-exceeded", "internal", "unknown", "unavailable"].includes(code);
}

import {adaptCompanySnapshot} from "./companySnapshot.mjs";
