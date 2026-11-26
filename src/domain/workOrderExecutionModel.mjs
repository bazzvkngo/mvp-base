// Ejecución del Taller (prototipo «Panel del Taller»): trabajos de la OT, repuestos y requisitos para
// finalizar. La pantalla no muestra montos. Las reglas coinciden con functions/workOrderPersistence.js.
import {receptionPhotoProgress} from "./workOrderReceptionPhotoModel.mjs";

export const WORK_STATUS_LABELS = Object.freeze({
  pendiente: "Pendiente",
  en_progreso: "En ejecución",
  completado: "Terminado",
});

export const WORK_STATUS_VARIANTS = Object.freeze({
  pendiente: "neutral",
  en_progreso: "warning",
  completado: "success",
});

export const WORK_PHOTO_MOMENTS = Object.freeze([
  {id: "antes", label: "Antes"},
  {id: "despues", label: "Después"},
]);

export const REPLACEMENT_PARTS_MODES = Object.freeze({
  cliente: "Repuestos del cliente",
  ninguno: "No requiere repuestos",
});

export function getWorkStatusLabel(state) {
  return WORK_STATUS_LABELS[state] || "Sin estado";
}

// Quién opera los trabajos: el responsable de la OT, el Administrador o el Owner. Una OT anterior a esta regla
// no tiene responsable y la puede operar cualquier operador de Taller. El servidor repite esta validación.
export function canOperateOrderWorks({canManage, canOperate, order, uid}) {
  if (!canOperate) return false;
  return Boolean(canManage) || !order?.responsableUid || order.responsableUid === uid;
}

export function serviceProducts(service) {
  return Array.isArray(service?.productos) ? service.productos : [];
}

// Un trabajo solo se termina cuando se definieron sus repuestos: del inventario, del cliente o ninguno.
export function worksPartsDefined(service) {
  return serviceProducts(service).length > 0 || Object.hasOwn(REPLACEMENT_PARTS_MODES, service?.repuestosModo);
}

export function getPartsSourceLabel(service) {
  if (serviceProducts(service).length) return "Del inventario";
  return REPLACEMENT_PARTS_MODES[service?.repuestosModo] || "";
}

export function workProgress(services = []) {
  const done = services.filter((service) => service.estado === "completado").length;
  return {done, total: services.length, complete: services.length > 0 && done === services.length};
}

// Requisitos para finalizar la ejecución, en el orden del prototipo.
export function executionRequirements(services = []) {
  const progress = workProgress(services);
  return [
    {label: "Al menos un trabajo registrado", done: progress.total > 0},
    {label: `Todos los trabajos terminados (${progress.done}/${progress.total})`, done: progress.complete},
  ];
}

// Resumen de la recepción para la tarjeta «Motivo del cliente» → «Ver recepción».
export function receptionSummary(order = {}) {
  const reception = order.recepcion || {};
  const photos = receptionPhotoProgress(order);
  const sealed = [...photos.zones, photos.dashboard].filter((zone) => zone.completed).length;
  const previousDamages = photos.zones.filter((zone) => zone.withDamages).map((zone) => ({
    zona: zone.label,
    notas: (zone.photo.marcas || []).map((mark) => mark.nota).filter(Boolean),
  }));
  return {
    motivo: String(reception.motivoCliente || ""),
    kilometraje: Number.isFinite(Number(reception.kilometraje)) && reception.kilometraje !== null
      ? Number(reception.kilometraje) : null,
    combustible: String(reception.nivelCombustible || ""),
    testigosEncendidos: typeof reception.testigosEncendidos === "boolean" ? reception.testigosEncendidos : null,
    testigos: Array.isArray(reception.testigos) ? reception.testigos : [],
    fotosSelladas: sealed,
    previousDamages,
  };
}
