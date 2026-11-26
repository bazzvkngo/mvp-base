// Inicio del Taller (prototipo «Panel del Taller»): resumen para Administración y para el técnico.
// Todo se deriva de las OT, sus trabajos y sus hallazgos. Sin montos.
import {getPlazaBayStatus, plazaWorkProgress, workshopWaitingQueue} from "./workshopPlazaModel.mjs";

const CLOSED = new Set(["cerrada", "cancelada"]);

function text(value) {
  return String(value ?? "").trim();
}

function millis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  return Number.isFinite(value) ? value : 0;
}

export function isOpenWorkOrder(order = {}) {
  return !CLOSED.has(text(order.estado));
}

// Plazos para avisar que un vehículo está detenido.
export const STALLED_REPAIR_MS = 24 * 60 * 60 * 1000;
export const STALLED_PICKUP_MS = 2 * 24 * 60 * 60 * 1000;

function startOfDay(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function waitingForApproval(order) {
  return Boolean(order.recepcion) && ["en_cola", "en_diagnostico"].includes(text(order.estado)) &&
    text(order.estadoAprobacion) === "pendiente";
}

// Vistas que abren los indicadores del inicio en la lista de Órdenes (?vista=...).
export const WORKSHOP_HOME_VIEWS = Object.freeze({
  "por-aprobar": {label: "Por aprobar", match: waitingForApproval},
  "en-reparacion": {label: "En reparación", match: (order) => text(order.estado) === "en_reparacion"},
  listos: {label: "Listos para retiro", match: (order) => text(order.estado) === "pendiente_entrega"},
});

export function workOrdersForView(orders = [], view = "", now = new Date()) {
  const definition = WORKSHOP_HOME_VIEWS[view];
  return definition ? orders.filter((order) => definition.match(order, now)) : orders;
}

// Última actividad de una OT: la OT o cualquiera de sus trabajos.
export function lastActivity(order = {}, services = []) {
  return Math.max(millis(order.actualizadoEn), ...services.map((service) => millis(service.actualizadoEn)), 0);
}

// Indicadores del encabezado para Administración (cada uno sin repetir a otro).
export function workshopHomeTiles(orders = [], servicesByOrder = new Map(), now = new Date()) {
  const open = orders.filter(isOpenWorkOrder);
  const count = (view) => workOrdersForView(orders, view, now).length;
  return {
    porAprobar: count("por-aprobar"),
    enReparacion: count("en-reparacion"),
    enCola: workshopWaitingQueue(open).length,
    listos: count("listos"),
  };
}

// Resumen del saludo: vehículos recibidos dentro del taller (sin la cola de espera, que se cuenta aparte).
export function workshopHeadline(orders = []) {
  const open = orders.filter(isOpenWorkOrder);
  const waiting = workshopWaitingQueue(open);
  return {
    enTaller: open.filter((order) => Boolean(order.recepcion) && !waiting.includes(order)).length,
    enCola: waiting.length,
    listos: open.filter((order) => text(order.estado) === "pendiente_entrega").length,
  };
}

// Lo que Administración debe resolver. Los hallazgos urgentes van primero; el resto, del más antiguo al más reciente.
// `since` es desde cuándo espera (para mostrar «hace 3 h»). Cada ítem enlaza a donde se resuelve.
export function workshopAttentionItems({orders = [], servicesByOrder = new Map(), findingsByOrder = new Map(), now = new Date()} = {}) {
  const open = orders.filter(isOpenWorkOrder);
  const nowMs = now.getTime();
  const urgent = [];
  const items = [];
  open.forEach((order) => {
    const pending = (findingsByOrder.get(order.otId) || []).filter((finding) => finding.urgente && !finding.convertido);
    if (pending.length && text(order.estado) === "en_reparacion") {
      urgent.push({tone: "danger", kind: "hallazgo", title: pending.length === 1 ? "Hallazgo urgente sin gestionar" : `${pending.length} hallazgos urgentes sin gestionar`,
        detail: `${order.numeroOT || "OT"} · informar al cliente`, to: `/taller/ordenes/${order.otId}`,
        since: Math.min(...pending.map((finding) => millis(finding.creadoEn) || nowMs))});
    }
  });
  open.filter((order) => text(order.estado) === "en_reparacion").forEach((order) => {
    const services = servicesByOrder.get(order.otId) || [];
    const progress = plazaWorkProgress(services);
    const last = lastActivity(order, services);
    if (progress.total > 0 && progress.terminados === progress.total) {
      items.push({tone: "success", kind: "finalizar", title: "Finalizar ejecución", detail: `${order.numeroOT || "OT"} terminó todos sus trabajos`,
        to: `/taller/ordenes/${order.otId}`, since: last || nowMs});
    } else if (last && nowMs - last >= STALLED_REPAIR_MS) {
      items.push({tone: "warning", kind: "detenido", title: "Sin avance en reparación", detail: `${order.numeroOT || "OT"} · revisar con el responsable`,
        to: `/taller/ordenes/${order.otId}`, since: last});
    }
  });
  open.filter((order) => text(order.estado) === "pendiente_entrega").forEach((order) => {
    const since = millis(order.actualizadoEn);
    if (since && nowMs - since >= STALLED_PICKUP_MS) {
      items.push({tone: "warning", kind: "retiro", title: "Listo para retiro sin retirar", detail: `${order.numeroOT || "OT"} · coordinar el retiro con el cliente`,
        to: `/taller/ordenes/${order.otId}`, since});
    }
  });
  open.filter(waitingForApproval).forEach((order) => {
    items.push({tone: "info", kind: "aprobar", title: "Aprobar ingreso", detail: `${order.numeroOT || "OT"} · recepción registrada`,
      to: `/taller/ordenes/${order.otId}`, since: millis(order.recepcion?.recibidoEn) || millis(order.actualizadoEn) || nowMs});
  });
  const waiting = workshopWaitingQueue(open);
  if (waiting.length) {
    items.push({tone: "warning", kind: "cola", title: `${waiting.length} ${waiting.length === 1 ? "vehículo espera" : "vehículos esperan"} plaza`,
      detail: "Ver cola en Plazas", to: "/taller/plazas", since: millis(waiting[0].aprobadaEn) || nowMs});
  }
  const byAge = (left, right) => left.since - right.since;
  return [...urgent.sort(byAge), ...items.sort(byAge)];
}

// Aviso anticipado: además de los repuestos en o bajo su mínimo, avisa los cercanos (hasta 20 % sobre el mínimo, al
// menos 1 unidad). Ej.: mínimo 5 → avisa desde 6; mínimo 20 → desde 24.
const STOCK_NEAR_RATIO = 0.2;

export function stockNearLimit(minimum) {
  return minimum + Math.max(1, Math.ceil(minimum * STOCK_NEAR_RATIO));
}

// Repuestos en, bajo o cerca de su stock mínimo de Inventario (catálogo del taller), los más críticos primero.
// `nivel`: «bajo» (en o bajo el mínimo) o «cercano».
export function lowStockItems(items = []) {
  return items
    .filter((item) => item.tipoItem === "producto" && Number.isFinite(item.stock) && Number.isFinite(item.stockMinimo) &&
      item.stockMinimo > 0 && item.stock <= stockNearLimit(item.stockMinimo))
    .map((item) => ({...item, nivel: item.stock <= item.stockMinimo ? "bajo" : "cercano"}))
    .sort((left, right) => (left.stock / left.stockMinimo) - (right.stock / right.stockMinimo) ||
      String(left.nombre).localeCompare(String(right.nombre), "es"));
}

// Aviso de stock para «Requiere atención» (va al final: no tiene antigüedad). Sin montos.
export function lowStockAttention(items = []) {
  const low = lowStockItems(items);
  if (!low.length) return null;
  const shown = low.slice(0, 3).map((item) => `${item.nombre} (${item.stock} de mín. ${item.stockMinimo})`).join(" · ");
  const label = low.some((item) => item.nivel === "bajo") ? "Stock bajo" : "Stock cerca del mínimo";
  return {tone: "info", kind: "stock", title: low.length === 1 ? label : `${label} en ${low.length} repuestos`,
    detail: low.length > 3 ? `${shown} · y ${low.length - 3} más` : shown, to: "/inventario", since: 0};
}

// «hace 5 min», «hace 3 h», «hace 2 días».
export function elapsedLabel(since, now = new Date()) {
  if (!Number.isFinite(since) || since <= 0) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - since) / 60000));
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}

// OT con movimiento hoy (según su última actualización), más recientes primero.
export function workshopTodayActivity(orders = [], now = new Date()) {
  const start = startOfDay(now);
  return orders
    .filter((order) => millis(order.actualizadoEn) >= start)
    .sort((left, right) => millis(right.actualizadoEn) - millis(left.actualizadoEn))
    .slice(0, 6);
}

// Inicio del técnico: sus OT abiertas y cuántos trabajos le quedan.
export function technicianWorkOrders(orders = [], uid = "") {
  return orders.filter((order) => isOpenWorkOrder(order) && order.recepcion && uid && order.responsableUid === uid);
}

export function technicianPendingWorks(orders = [], servicesByOrder = new Map()) {
  return orders.reduce((sum, order) =>
    sum + (servicesByOrder.get(order.otId) || []).filter((service) => text(service.estado) !== "completado").length, 0);
}

// Siguiente trabajo de una OT para el técnico: el que está en curso o, si no hay, el primero pendiente.
export function nextPendingWork(services = []) {
  return services.find((service) => text(service.estado) === "en_progreso") ||
    services.find((service) => text(service.estado) === "pendiente") || null;
}

export function workshopGreeting(date = new Date()) {
  const hour = date.getHours();
  return hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
}

// Nombre del saludo: «Nombre Apellido» solo si la persona tiene ambos en su perfil; si no, devuelve cadena vacía
// y la pantalla conserva su saludo actual.
export function greetingPersonName(profile = {}) {
  const first = text(profile?.nombres).split(/\s+/)[0] || "";
  const last = text(profile?.apellidos).split(/\s+/)[0] || "";
  return first && last ? `${first} ${last}` : "";
}

export {getPlazaBayStatus};
