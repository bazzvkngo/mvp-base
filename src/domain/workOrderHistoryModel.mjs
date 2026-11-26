import {
  getWorkOrderApprovalLabel,
  getWorkOrderStatusLabel,
} from "./workOrderModel.mjs";
import {getReceptionPhotoZoneLabel} from "./workOrderReceptionPhotoModel.mjs";

const EVENT_LABELS = Object.freeze({
  ot_creada: "Orden de trabajo creada",
  recepcion_registrada: "Recepción registrada",
  recepcion_actualizada: "Recepción actualizada",
  foto_recepcion_registrada: "Foto de recepción registrada",
  plaza_asignada: "Plaza asignada",
  plaza_liberada: "Plaza liberada",
  diagnostico_creado: "Diagnóstico creado",
  diagnostico_actualizado: "Diagnóstico actualizado",
  diagnostico_completado: "Diagnóstico completado",
  servicio_ot_creado: "Trabajo agregado",
  servicio_ot_actualizado: "Trabajo actualizado",
  servicio_ot_eliminado: "Trabajo eliminado",
  servicio_ot_iniciado: "Trabajo iniciado",
  servicio_ot_completado: "Trabajo terminado",
  servicio_ot_reabierto: "Trabajo reabierto",
  servicio_ot_repuestos_definidos: "Repuestos del trabajo definidos",
  foto_servicio_registrada: "Foto del trabajo registrada",
  foto_entrega_registrada: "Foto de entrega registrada",
  hallazgo_reportado: "Hallazgo reportado",
  hallazgo_convertido: "Hallazgo convertido en trabajo",
  producto_ot_agregar: "Producto planificado",
  producto_ot_actualizar: "Producto planificado actualizado",
  producto_ot_eliminar: "Producto planificado eliminado",
  ot_enviada_aprobacion: "OT enviada a aprobación",
  ot_aprobada: "OT aprobada",
  ot_rechazada: "OT en espera",
  aprobacion_invalidada: "Aprobación invalidada",
  disponibilidad_revalidada: "Disponibilidad revalidada",
  reparacion_finalizada: "Reparación finalizada",
  vehiculo_entregado: "Vehículo entregado",
  ot_cancelada: "Orden de trabajo cancelada",
});

const RECEPTION_FIELD_LABELS = Object.freeze({
  motivoCliente: "motivo del cliente",
  kilometraje: "kilometraje",
  testigosEncendidos: "sensores encendidos",
  testigos: "sensores",
  nivelCombustible: "nivel de combustible",
  ingresaNombre: "quién entrega el vehículo",
  ingresaDocumento: "documento de quien entrega",
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
    if (detail.enEsperaDePlaza) parts.push("En espera de plaza");
    if (detail.responsableNombre) parts.push(`Responsable: ${detail.responsableNombre}`);
    return parts.join(" · ");
  }
  if (event.tipo === "foto_recepcion_registrada" && detail.zona) {
    const damages = detail.conDanos === true ? ` · ${detail.cantidadDanos || 0} daño(s) anotado(s)`
      : detail.conDanos === false ? " · sin daños" : "";
    return `Zona: ${getReceptionPhotoZoneLabel(detail.zona)}${damages}.`;
  }
  if (event.tipo === "servicio_ot_repuestos_definidos" && detail.modo) {
    return detail.modo === "cliente" ? "Los repuestos los trae el cliente." : "No requiere repuestos.";
  }
  if (event.tipo === "foto_servicio_registrada" && detail.momento) {
    return `Foto «${detail.momento === "antes" ? "antes" : "después"}».`;
  }
  if (event.tipo === "foto_entrega_registrada" && detail.zona) {
    return `Zona: ${getReceptionPhotoZoneLabel(detail.zona)}.`;
  }
  if (event.tipo === "vehiculo_entregado" && detail.receptorNombre) {
    return `Retira: ${detail.receptorNombre}${detail.conObservaciones ? " · con observaciones del cliente" : ""}.`;
  }
  if (event.tipo === "hallazgo_reportado" && typeof detail.urgente === "boolean") {
    return detail.urgente ? "Urgente · seguridad." : "Recomendado.";
  }
  if (event.tipo === "plaza_asignada" && detail.automatica) {
    return "Asignada automáticamente.";
  }
  if (["reparacion_finalizada", "vehiculo_entregado", "ot_cancelada"].includes(event.tipo) && detail.estado) {
    return `Estado actual: ${getWorkOrderStatusLabel(detail.estado)}.${detail.motivo ? ` Motivo: ${detail.motivo}` : ""}`;
  }
  return "";
}
