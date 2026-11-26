import {isMoneyAmount, mulRound, sanitizeDecimals, sumMoney} from "./money.mjs";

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
  {value: "rechazada", label: "En espera"},
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

// OT aprobada que espera una Plaza libre: el servidor la deja en cola hasta asignarla.
export function isWorkOrderWaitingForPlaza(order) {
  return Boolean(order?.recepcion) && order.estado === "en_cola" &&
    order.estadoAprobacion === "aprobada" && !normalizedText(order.plazaId);
}

export function getWorkOrderDisplayStatusLabel(order) {
  return isWorkOrderWaitingForPlaza(order) ? "En espera de plaza" : getWorkOrderStatusLabel(order?.estado);
}

export function getWorkOrderDisplayStatusVariant(order) {
  return isWorkOrderWaitingForPlaza(order) ? "warning" : getWorkOrderStatusVariant(order?.estado);
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

// Total del alcance: suma de cada servicio (cantidad 1) y de cada producto (cantidad x precio),
// con los valores de Inventario ya congelados o vigentes. No calcula IVA: el alcance de la OT
// no guarda tasa ni exenciones (el IVA de las ventas se calcula al emitir la venta, no aquí).
// Devuelve null si algún precio no está disponible.
// `decimals` son los decimales de cálculo de la OT (su `montoDecimales`; SPEC 036). Con 0 se ejecuta literalmente la
// fórmula de siempre (Math.round por línea de producto y total entero seguro). Con decimales, cada línea de producto
// se redondea a esos decimales (decimal exacto, 3 × Bs 3,50 = Bs 10,50) y el total se valida en unidades menores.
export function calculateWorkOrderScopeTotal(scope = [], decimals = 0) {
  const places = sanitizeDecimals(decimals);
  const lines = [];
  let total = 0;
  for (const service of Array.isArray(scope) ? scope : []) {
    if (!Number.isFinite(service?.precioUnitario)) return null;
    if (places === 0) total += service.precioUnitario;
    else lines.push(service.precioUnitario);
    for (const product of service.productos || []) {
      if (!Number.isFinite(product?.precioUnitario) || !Number.isFinite(product?.cantidad)) return null;
      if (places === 0) total += Math.round(product.precioUnitario * product.cantidad);
      else lines.push(mulRound(product.precioUnitario, product.cantidad, places));
    }
  }
  if (places === 0) return Number.isSafeInteger(total) ? total : null;
  total = sumMoney(lines, places);
  return isMoneyAmount(total, places) ? total : null;
}

// Importe de una línea de producto de la OT. Con 0 decimales es el producto sin redondear que la pantalla de
// aprobación mostraba (precio × cantidad); con decimales, el importe redondeado a los decimales de la OT.
export function calculateWorkOrderProductLineTotal(product, decimals = 0) {
  const places = sanitizeDecimals(decimals);
  return places === 0
    ? product.precioUnitario * product.cantidad
    : mulRound(product.precioUnitario, product.cantidad, places);
}

export function matchesWorkOrderSearch(order, vehicle, rawSearch) {
  const search = normalizedText(rawSearch).toLocaleLowerCase("es-CL");
  if (!search) return true;
  return [order.numeroOT, vehicle?.patente]
    .some((value) => normalizedText(value)
      .toLocaleLowerCase("es-CL")
      .includes(search));
}
