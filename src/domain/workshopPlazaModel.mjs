import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "./rbac.mjs";
export const WORKSHOP_PLAZA_STATES = Object.freeze([
  {value: "activa", label: "Activa"},
  {value: "inactiva", label: "Inactiva"},
]);

export const ACTIVE_WORK_ORDER_STATES = Object.freeze([
  "ingresada",
  "en_cola",
  "en_diagnostico",
  "esperando_repuestos",
  "esperando_aprobacion",
  "en_reparacion",
  "pendiente_entrega",
]);

const ACTIVE_ORDER_STATES = new Set(ACTIVE_WORK_ORDER_STATES);

function normalizedText(value) {
  return String(value ?? "").trim();
}

export function adaptStoredWorkshopPlaza(data = {}) {
  return {
    ...data,
    plazaId: normalizedText(data.plazaId || data.id),
    negocioId: normalizedText(data.negocioId),
    nombre: normalizedText(data.nombre),
    estado: normalizedText(data.estado),
  };
}

export function isActiveWorkOrder(order = {}) {
  return ACTIVE_ORDER_STATES.has(normalizedText(order.estado));
}

export function deriveWorkshopPlazaOccupancy(plazas = [], orders = []) {
  const plazaIds = new Set(plazas.map((plaza) => normalizedText(plaza.plazaId)).filter(Boolean));
  const occupancy = new Map();
  orders.forEach((order) => {
    const plazaId = normalizedText(order.plazaId);
    if (!plazaIds.has(plazaId) || !isActiveWorkOrder(order)) return;
    const current = occupancy.get(plazaId);
    if (!current) occupancy.set(plazaId, {order, conflict: false});
    else occupancy.set(plazaId, {order: current.order, conflict: true});
  });
  return occupancy;
}

export function getWorkshopPlazaStateLabel(value) {
  return WORKSHOP_PLAZA_STATES.find((item) => item.value === normalizedText(value))?.label || "Sin estado";
}

export function getWorkshopPlazaStateVariant(value) {
  return normalizedText(value) === "activa" ? "success" : "neutral";
}

export function getWorkshopPlazaFieldErrors(values = {}) {
  const errors = {};
  const nombre = normalizedText(values.nombre);
  if (!nombre) errors.nombre = "El nombre de la Plaza es obligatorio.";
  else if (nombre.length > 120) errors.nombre = "El nombre no puede superar 120 caracteres.";
  return errors;
}

export function canManageWorkshopPlazas(role) {
  return hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_MANAGE);
}

export function canAssignWorkshopPlazas(role) {
  return hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_OPERATE);
}

// ---------- Vista gráfica de Plazas (prototipo «Panel del Taller») ----------

// Estado visible de una plaza ocupada según su OT: En revisión, En reparación o Listo para retiro.
export function getPlazaBayStatus(order = {}) {
  const estado = normalizedText(order.estado);
  if (estado === "pendiente_entrega") return {key: "listo", label: "Listo para retiro", tone: "success"};
  if (estado === "en_reparacion") return {key: "reparacion", label: "En reparación", tone: "info"};
  return {key: "revision", label: "En revisión", tone: "warning"};
}

// Ocupación: solo cuentan las plazas activas; una plaza inactiva con vehículo no suma.
export function workshopOccupancySummary(plazas = [], occupancy = new Map()) {
  const active = plazas.filter((plaza) => normalizedText(plaza.estado) === "activa");
  const occupied = active.filter((plaza) => occupancy.get(normalizedText(plaza.plazaId))?.order).length;
  return {activas: active.length, ocupadas: occupied, porcentaje: active.length ? Math.round((occupied / active.length) * 100) : 0};
}

// Cola de espera: OT aprobadas sin plaza, por orden de aprobación (la primera entra a la próxima plaza libre).
export function workshopWaitingQueue(orders = []) {
  const millis = (value) => value?.toMillis?.() ?? (Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER);
  return orders
    .filter((order) => Boolean(order?.recepcion) && normalizedText(order.estado) === "en_cola" &&
      normalizedText(order.estadoAprobacion) === "aprobada" && !normalizedText(order.plazaId))
    .sort((left, right) => millis(left.aprobadaEn) - millis(right.aprobadaEn));
}

// Avance de los trabajos de una OT (sin montos).
export function plazaWorkProgress(services = []) {
  const total = services.length;
  const done = services.filter((service) => normalizedText(service.estado) === "completado").length;
  return {terminados: done, total, porcentaje: total ? Math.round((done / total) * 100) : 0};
}
