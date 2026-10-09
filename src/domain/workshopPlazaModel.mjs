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
  return ["OWNER", "ADMIN"].includes(normalizedText(role).toUpperCase());
}

export function canAssignWorkshopPlazas(role) {
  return ["OWNER", "ADMIN", "TECNICO", "MEMBER"].includes(normalizedText(role).toUpperCase());
}
