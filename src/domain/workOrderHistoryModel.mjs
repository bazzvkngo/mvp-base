import {
  getWorkOrderApprovalLabel,
  getWorkOrderStatusLabel,
} from "./workOrderModel.mjs";

const EVENT_LABELS = Object.freeze({
  ot_creada: "Orden de trabajo creada",
  recepcion_registrada: "Recepción registrada",
  recepcion_actualizada: "Recepción actualizada",
  plaza_asignada: "Plaza asignada",
  plaza_liberada: "Plaza liberada",
  diagnostico_creado: "Diagnóstico creado",
  diagnostico_actualizado: "Diagnóstico actualizado",
  diagnostico_completado: "Diagnóstico completado",
  servicio_ot_creado: "Servicio agregado",
  servicio_ot_actualizado: "Servicio actualizado",
  servicio_ot_eliminado: "Servicio eliminado",
  servicio_ot_iniciado: "Servicio iniciado",
  servicio_ot_completado: "Servicio completado",
  producto_ot_agregar: "Producto planificado",
  producto_ot_actualizar: "Producto planificado actualizado",
  producto_ot_eliminar: "Producto planificado eliminado",
  ot_enviada_aprobacion: "OT enviada a aprobación",
  ot_aprobada: "OT aprobada",
  ot_rechazada: "OT rechazada",
  aprobacion_invalidada: "Aprobación invalidada",
  disponibilidad_revalidada: "Disponibilidad revalidada",
  reparacion_finalizada: "Reparación finalizada",
  vehiculo_entregado: "Vehículo entregado",
  ot_cancelada: "Orden de trabajo cancelada",
});

const RECEPTION_FIELD_LABELS = Object.freeze({
  kilometraje: "kilometraje",
  nivelCombustible: "nivel de combustible",
  accesorios: "accesorios",
  danosObservados: "daños observados",
  observaciones: "observaciones",
  "checklist.carroceriaPintura": "carrocería y pintura",
  "checklist.vidriosEspejos": "vidrios y espejos",
  "checklist.lucesOpticos": "luces y ópticos",
  "checklist.neumaticosLlantas": "neumáticos y llantas",
  "checklist.interior": "interior",
  "checklist.tableroIndicadores": "tablero e indicadores",
  "checklist.encendido": "encendido",
  "checklist.fugasVisibles": "fugas visibles",
  "checklist.nivelesVisibles": "niveles visibles",
  "checklist.estadoGeneral": "estado general",
});

export function getWorkOrderHistoryEventLabel(type) {
  return EVENT_LABELS[String(type || "")] || "Actualización de orden de trabajo";
}

export function formatWorkOrderHistoryDate(value) {
  if (!Number.isSafeInteger(value)) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return date.toLocaleString("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function getWorkOrderHistoryDetail(event = {}) {
  const detail = event.detalle || {};
  if (["recepcion_registrada", "recepcion_actualizada"].includes(event.tipo)) {
    const fields = (detail.camposModificados || [])
      .map((field) => RECEPTION_FIELD_LABELS[field])
      .filter(Boolean);
    return fields.length ? `Campos registrados: ${fields.join(", ")}.` : "";
  }
  if (["ot_enviada_aprobacion", "ot_aprobada", "ot_rechazada", "disponibilidad_revalidada", "aprobacion_invalidada"].includes(event.tipo)) {
    const parts = [];
    if (detail.estadoAnterior) parts.push(`Estado anterior: ${getWorkOrderStatusLabel(detail.estadoAnterior)}`);
    if (detail.estado) parts.push(`Estado actual: ${getWorkOrderStatusLabel(detail.estado)}`);
    if (detail.aprobacionAnterior) parts.push(`Aprobación anterior: ${getWorkOrderApprovalLabel(detail.aprobacionAnterior)}`);
    if (detail.estadoAprobacion) parts.push(`Aprobación actual: ${getWorkOrderApprovalLabel(detail.estadoAprobacion)}`);
    if (detail.motivo) parts.push(`Motivo: ${detail.motivo}`);
    return parts.join(" · ");
  }
  if (["reparacion_finalizada", "vehiculo_entregado", "ot_cancelada"].includes(event.tipo) && detail.estado) {
    return `Estado actual: ${getWorkOrderStatusLabel(detail.estado)}.`;
  }
  return "";
}
