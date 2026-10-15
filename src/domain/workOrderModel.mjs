export const WORK_ORDER_STATUSES = Object.freeze([
  {value: "ingresada", label: "Ingresada"},
  {value: "en_cola", label: "En cola"},
  {value: "en_diagnostico", label: "En diagnóstico"},
  {value: "esperando_repuestos", label: "Esperando repuestos"},
  {value: "esperando_aprobacion", label: "Esperando aprobación"},
  {value: "en_reparacion", label: "En reparación"},
  {value: "pendiente_entrega", label: "Pendiente de entrega"},
  {value: "cerrada", label: "Cerrada"},
  {value: "cancelada", label: "Cancelada"},
]);

export const WORK_ORDER_APPROVAL_STATUSES = Object.freeze([
  {value: "pendiente", label: "Pendiente"},
  {value: "aprobada", label: "Aprobada"},
  {value: "rechazada", label: "Rechazada"},
]);

const STATUS_LABELS = new Map(
  WORK_ORDER_STATUSES.map(({value, label}) => [value, label])
);
const APPROVAL_LABELS = new Map(
  WORK_ORDER_APPROVAL_STATUSES.map(({value, label}) => [value, label])
);

function normalizedText(value) {
  return String(value ?? "").trim();
}

export function adaptStoredWorkOrder(data = {}) {
  return {
    ...data,
    otId: normalizedText(data.otId || data.id),
    negocioId: normalizedText(data.negocioId),
    numeroOT: normalizedText(data.numeroOT),
    vehiculoId: normalizedText(data.vehiculoId),
    clienteId: normalizedText(data.clienteId),
    estado: normalizedText(data.estado),
    estadoAprobacion: normalizedText(data.estadoAprobacion),
    plazaId: normalizedText(data.plazaId),
  };
}

export function getWorkOrderStatusLabel(value) {
  return STATUS_LABELS.get(normalizedText(value)) || "Sin estado";
}

export function getWorkOrderApprovalLabel(value) {
  return APPROVAL_LABELS.get(normalizedText(value)) || "Sin estado";
}

export function getWorkOrderStatusVariant(value) {
  if (value === "cerrada") return "success";
  if (["cancelada", "esperando_repuestos"].includes(value)) return "warning";
  return "neutral";
}

export function getWorkOrderApprovalVariant(value) {
  if (value === "aprobada") return "success";
  if (value === "rechazada") return "warning";
  return "neutral";
}

export function matchesWorkOrderSearch(order, vehicle, rawSearch) {
  const search = normalizedText(rawSearch).toLocaleLowerCase("es-CL");
  if (!search) return true;
  return [order.numeroOT, vehicle?.patente]
    .some((value) => normalizedText(value)
      .toLocaleLowerCase("es-CL")
      .includes(search));
}
