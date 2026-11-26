"use strict";

// Asignación automática de Plazas del Taller.
// Este módulo no importa workOrderPersistence.js ni workOrderPlazas.js (ambos lo usan),
// por eso recibe appendPlanningEvent y el actorSnapshot como parámetros.
// Todas las funciones read* solo leen; las write* solo escriben. Quien las llama debe
// completar todas las lecturas de la transacción antes de la primera escritura.

const TERMINAL_ORDER_STATES = new Set(["cerrada", "cancelada"]);

function timestampMillis(value) {
  return typeof value?.toMillis === "function" ? value.toMillis() : Number.POSITIVE_INFINITY;
}

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), "es");
}

function compareMillis(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

// Una OT aprobada que espera Plaza: sigue en cola, sin Plaza y con la recepción registrada.
function isWaitingForPlaza(order) {
  return Boolean(order?.recepcion) && order.estado === "en_cola" &&
    order.estadoAprobacion === "aprobada" && !order.plazaId;
}

function plazaRefs(businessRef, plazaId) {
  return {
    plazaRef: businessRef.collection("plazasTaller").doc(plazaId),
    lockRef: businessRef.collection("plazaOccupancyKeys").doc(plazaId),
  };
}

// Un candado ocupa la Plaza solo si apunta a una OT activa del negocio que sigue en esa Plaza.
async function lockIsOccupied(transaction, businessRef, businessId, plazaId, lockSnapshot) {
  if (!lockSnapshot.exists) return false;
  const lock = lockSnapshot.data() || {};
  if (lock.negocioId !== businessId || lock.plazaId !== plazaId) return true;
  if (!lock.otId) return false;
  const occupantSnapshot = await transaction.get(businessRef.collection("ordenesTrabajo").doc(lock.otId));
  if (!occupantSnapshot.exists) return false;
  const occupant = occupantSnapshot.data() || {};
  return occupant.negocioId === businessId && occupant.otId === occupantSnapshot.id &&
    occupant.plazaId === plazaId && !TERMINAL_ORDER_STATES.has(occupant.estado);
}

// Primera Plaza activa sin ocupar, ordenada por fecha de creación y luego por nombre.
// hasActivePlazas=false indica que el negocio no usa Plazas (no hay ninguna activa).
async function readFreePlaza(transaction, businessRef, businessId) {
  const snapshot = await transaction.get(
    businessRef.collection("plazasTaller").where("estado", "==", "activa")
  );
  const plazas = snapshot.docs
    .map((document) => ({plazaId: document.id, data: document.data() || {}}))
    .filter(({plazaId, data}) => data.plazaId === plazaId && data.negocioId === businessId)
    .sort((left, right) =>
      compareMillis(timestampMillis(left.data.creadoEn), timestampMillis(right.data.creadoEn)) ||
      compareText(left.data.nombre, right.data.nombre) ||
      compareText(left.plazaId, right.plazaId));
  if (!plazas.length) return {hasActivePlazas: false, plazaId: null, lockRef: null};
  for (const {plazaId} of plazas) {
    const {lockRef} = plazaRefs(businessRef, plazaId);
    const lockSnapshot = await transaction.get(lockRef);
    if (!(await lockIsOccupied(transaction, businessRef, businessId, plazaId, lockSnapshot))) {
      return {hasActivePlazas: true, plazaId, lockRef};
    }
  }
  return {hasActivePlazas: true, plazaId: null, lockRef: null};
}

// Cola FIFO de OT aprobadas en espera de Plaza. Dos filtros de igualdad no requieren
// índice compuesto; el orden por aprobadaEn se resuelve en memoria.
async function readWaitingOrders(transaction, businessRef, businessId, excludeOtId = null) {
  const snapshot = await transaction.get(businessRef.collection("ordenesTrabajo")
    .where("estado", "==", "en_cola")
    .where("estadoAprobacion", "==", "aprobada"));
  return snapshot.docs
    .map((document) => ({orderRef: document.ref, order: document.data() || {}}))
    .filter(({orderRef, order}) => order.otId === orderRef.id && order.negocioId === businessId &&
      orderRef.id !== excludeOtId && isWaitingForPlaza(order))
    .sort((left, right) =>
      compareMillis(timestampMillis(left.order.aprobadaEn), timestampMillis(right.order.aprobadaEn)) ||
      compareText(left.order.numeroOT, right.order.numeroOT));
}

// Lecturas necesarias para entregar una Plaza liberada a la próxima OT en espera.
// Devuelve null si la Plaza no está activa o no hay nadie esperando.
async function readPromotionCandidate(transaction, businessRef, businessId, plazaId, excludeOtId = null) {
  if (!plazaId) return null;
  const {plazaRef, lockRef} = plazaRefs(businessRef, plazaId);
  const plazaSnapshot = await transaction.get(plazaRef);
  const plaza = plazaSnapshot.data() || {};
  if (!plazaSnapshot.exists || plaza.plazaId !== plazaId || plaza.negocioId !== businessId ||
      plaza.estado !== "activa") {
    return null;
  }
  const waiting = await readWaitingOrders(transaction, businessRef, businessId, excludeOtId);
  if (!waiting.length) return null;
  return {plazaId, lockRef, ...waiting[0]};
}

function automaticAssignmentDetail(plazaId, estadoAnterior, origen) {
  return {plazaId, plazaAnteriorId: null, estadoAnterior, estado: "en_reparacion", automatica: true, origen};
}

// Escribe la promoción: candado, OT en reparación con la Plaza y evento plaza_asignada.
function writePromotion(transaction, candidate, {appendPlanningEvent, businessId, actorUid, actorSnapshot, timestamp, origen}) {
  if (!candidate) return null;
  const {plazaId, lockRef, orderRef, order} = candidate;
  transaction.set(lockRef, {negocioId: businessId, plazaId, otId: orderRef.id});
  transaction.update(orderRef, {
    plazaId,
    estado: "en_reparacion",
    actualizadoPorUid: actorUid,
    actualizadoEn: timestamp,
  });
  appendPlanningEvent(transaction, orderRef, {
    businessId, actorUid, actorSnapshot, type: "plaza_asignada", timestamp,
    detail: automaticAssignmentDetail(plazaId, order.estado, origen),
  });
  return {otId: orderRef.id, plazaId};
}

module.exports = {
  automaticAssignmentDetail,
  isWaitingForPlaza,
  readFreePlaza,
  readPromotionCandidate,
  readWaitingOrders,
  writePromotion,
};
