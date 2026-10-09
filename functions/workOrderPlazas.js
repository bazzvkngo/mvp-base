"use strict";

const {normalizeBusinessVerificationState} = require("./businessOperations");
const {TALLER_MANAGEMENT_ROLES, TALLER_OPERATION_ROLES} = require("./rbac");
const {
  appendPlanningEvent,
  diagnosisActor,
  identifier,
  requestIdentifier,
} = require("./workOrderPersistence");

const PLAZA_STATES = new Set(["activa", "inactiva"]);
const TERMINAL_ORDER_STATES = new Set(["cerrada", "cancelada"]);

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function onlyFields(raw, allowed, HttpsError, label) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).some((field) => !allowed.includes(field))) {
    fail(HttpsError, "invalid-argument", `${label} contiene campos no permitidos.`);
  }
}

function normalizedName(value, HttpsError) {
  if (typeof value !== "string") {
    fail(HttpsError, "invalid-argument", "El nombre de la Plaza debe ser texto.");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) fail(HttpsError, "invalid-argument", "El nombre de la Plaza es obligatorio.");
  if (name.length > 120) {
    fail(HttpsError, "invalid-argument", "El nombre de la Plaza no puede superar 120 caracteres.");
  }
  return name;
}

function expectedRevision(value, HttpsError, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(HttpsError, "invalid-argument", `Actualiza ${label} antes de continuar.`);
  }
  return value;
}

function timestampMillis(value) {
  return typeof value?.toMillis === "function" ? value.toMillis() : NaN;
}

function assertRevision(record, expected, HttpsError, label) {
  if (timestampMillis(record.actualizadoEn) !== expected) {
    fail(HttpsError, "aborted", `${label} cambió en otra sesión. Actualiza la información e intenta nuevamente.`);
  }
}

function assertPlaza(snapshot, businessId, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró la Plaza.");
  const plaza = snapshot.data() || {};
  if (plaza.plazaId !== snapshot.id || plaza.negocioId !== businessId ||
      !PLAZA_STATES.has(plaza.estado)) {
    fail(HttpsError, "failed-precondition", "La Plaza no pertenece al negocio seleccionado o requiere revisión.");
  }
  return plaza;
}

function assertOrder(snapshot, businessId, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró la orden de trabajo.");
  const order = snapshot.data() || {};
  if (order.otId !== snapshot.id || order.negocioId !== businessId) {
    fail(HttpsError, "failed-precondition", "La orden de trabajo no pertenece al negocio seleccionado.");
  }
  return order;
}

function isActiveOrder(order) {
  return Boolean(order?.otId) && !TERMINAL_ORDER_STATES.has(order.estado);
}

async function requirePlazaAccess(request, dependencies, roles) {
  return dependencies.requireBusinessAccess(
    request,
    {db: dependencies.db, HttpsError: dependencies.HttpsError},
    {roles, requiresVerifiedBusiness: true, moduleId: "taller"}
  );
}

async function assertFreshAccess(transaction, context, dependencies, roles) {
  const {HttpsError} = dependencies;
  const [membershipSnapshot, businessSnapshot] = await Promise.all([
    transaction.get(context.membershipRef),
    transaction.get(context.businessRef),
  ]);
  const membership = membershipSnapshot.data() || {};
  if (!membershipSnapshot.exists || membership.uid !== context.uid ||
      membership.negocioId !== context.businessId || membership.estado !== "activo" ||
      !roles.includes(membership.rol)) {
    fail(HttpsError, "permission-denied", "Tu membresía ya no permite realizar esta operación de Taller.");
  }
  if (membership.profileId) {
    const profileSnapshot = await transaction.get(
      context.businessRef.collection("perfilesEmpleados").doc(membership.profileId)
    );
    const profile = profileSnapshot.data() || {};
    if (!profileSnapshot.exists || profile.negocioId !== context.businessId ||
        profile.estado !== "activo" || !profile.modulos?.includes("taller")) {
      fail(HttpsError, "permission-denied", "Tu perfil ya no permite operar Taller.");
    }
  }
  const business = businessSnapshot.data() || {};
  if (!businessSnapshot.exists || business.estado !== "activo" || business.eliminadoEn ||
      normalizeBusinessVerificationState(business) !== "VERIFICADA") {
    fail(HttpsError, "failed-precondition", "El negocio no está habilitado para operar.");
  }
}

async function crearPlazaTallerHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  onlyFields(request?.data, ["businessId", "requestId", "plaza"], HttpsError, "La solicitud");
  onlyFields(request.data.plaza, ["nombre"], HttpsError, "La Plaza");
  const context = await requirePlazaAccess(request, dependencies, TALLER_MANAGEMENT_ROLES);
  const plazaId = requestIdentifier(request.data.requestId, HttpsError);
  const nombre = normalizedName(request.data.plaza.nombre, HttpsError);
  const plazaRef = context.businessRef.collection("plazasTaller").doc(plazaId);
  return db.runTransaction(async (transaction) => {
    await assertFreshAccess(transaction, context, dependencies, TALLER_MANAGEMENT_ROLES);
    const existing = await transaction.get(plazaRef);
    if (existing.exists) {
      const plaza = assertPlaza(existing, context.businessId, HttpsError);
      if (plaza.nombre !== nombre || plaza.creadoPorUid !== context.uid) {
        fail(HttpsError, "already-exists", "Esta solicitud ya fue utilizada con otros datos.");
      }
      return {plaza: {...plaza, plazaId}, sinCambios: true};
    }
    const timestamp = FieldValue.serverTimestamp();
    const plaza = {
      plazaId,
      negocioId: context.businessId,
      nombre,
      estado: "activa",
      creadoPorUid: context.uid,
      creadoEn: timestamp,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    };
    transaction.create(plazaRef, plaza);
    return {plaza: {...plaza, creadoEn: null, actualizadoEn: null}, sinCambios: false};
  });
}

async function actualizarPlazaTallerHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  onlyFields(request?.data, ["businessId", "plazaId", "plaza", "expectedActualizadoEn"], HttpsError, "La solicitud");
  onlyFields(request.data.plaza, ["nombre"], HttpsError, "La Plaza");
  const context = await requirePlazaAccess(request, dependencies, TALLER_MANAGEMENT_ROLES);
  const plazaId = identifier(request.data.plazaId, "La Plaza", HttpsError);
  const nombre = normalizedName(request.data.plaza.nombre, HttpsError);
  const expected = expectedRevision(request.data.expectedActualizadoEn, HttpsError, "las Plazas");
  const plazaRef = context.businessRef.collection("plazasTaller").doc(plazaId);
  return db.runTransaction(async (transaction) => {
    await assertFreshAccess(transaction, context, dependencies, TALLER_MANAGEMENT_ROLES);
    const plaza = assertPlaza(await transaction.get(plazaRef), context.businessId, HttpsError);
    assertRevision(plaza, expected, HttpsError, "La Plaza");
    if (plaza.nombre === nombre) return {plazaId, nombre, estado: plaza.estado, sinCambios: true};
    transaction.update(plazaRef, {
      nombre,
      actualizadoPorUid: context.uid,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    return {plazaId, nombre, estado: plaza.estado, sinCambios: false};
  });
}

async function cambiarEstadoPlazaTaller(request, dependencies, estado) {
  const {db, FieldValue, HttpsError} = dependencies;
  onlyFields(request?.data, ["businessId", "plazaId", "expectedActualizadoEn"], HttpsError, "La solicitud");
  const context = await requirePlazaAccess(request, dependencies, TALLER_MANAGEMENT_ROLES);
  const plazaId = identifier(request.data.plazaId, "La Plaza", HttpsError);
  const expected = expectedRevision(request.data.expectedActualizadoEn, HttpsError, "las Plazas");
  const plazaRef = context.businessRef.collection("plazasTaller").doc(plazaId);
  return db.runTransaction(async (transaction) => {
    await assertFreshAccess(transaction, context, dependencies, TALLER_MANAGEMENT_ROLES);
    const plaza = assertPlaza(await transaction.get(plazaRef), context.businessId, HttpsError);
    if (plaza.estado === estado) return {plazaId, estado, sinCambios: true};
    assertRevision(plaza, expected, HttpsError, "La Plaza");
    transaction.update(plazaRef, {
      estado,
      actualizadoPorUid: context.uid,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    return {plazaId, estado, sinCambios: false};
  });
}

const activarPlazaTallerHandler = (request, dependencies) =>
  cambiarEstadoPlazaTaller(request, dependencies, "activa");
const inactivarPlazaTallerHandler = (request, dependencies) =>
  cambiarEstadoPlazaTaller(request, dependencies, "inactiva");

async function readLockOccupant(transaction, context, lock) {
  if (!lock?.otId) return null;
  const snapshot = await transaction.get(
    context.businessRef.collection("ordenesTrabajo").doc(lock.otId)
  );
  if (!snapshot.exists) return null;
  const order = snapshot.data() || {};
  return order.negocioId === context.businessId && order.otId === snapshot.id ? order : null;
}

function assertNoOtherActiveAssignment(assignments, otId, plazaId, HttpsError) {
  const conflicting = assignments.docs.map((item) => item.data() || {})
    .find((order) => order.otId !== otId && order.plazaId === plazaId && isActiveOrder(order));
  if (conflicting) {
    fail(HttpsError, "aborted", "La Plaza fue asignada a otra Orden de Trabajo. Actualiza la información e intenta nuevamente.");
  }
}

async function asignarPlazaOTHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  onlyFields(request?.data, ["businessId", "otId", "plazaId", "expectedActualizadoEn"], HttpsError, "La solicitud");
  const context = await requirePlazaAccess(request, dependencies, TALLER_OPERATION_ROLES);
  const otId = identifier(request.data.otId, "La orden de trabajo", HttpsError);
  const plazaId = identifier(request.data.plazaId, "La Plaza", HttpsError);
  const expected = expectedRevision(request.data.expectedActualizadoEn, HttpsError, "la orden de trabajo");
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const plazaRef = context.businessRef.collection("plazasTaller").doc(plazaId);
  const targetLockRef = context.businessRef.collection("plazaOccupancyKeys").doc(plazaId);
  return db.runTransaction(async (transaction) => {
    await assertFreshAccess(transaction, context, dependencies, TALLER_OPERATION_ROLES);
    const [orderSnapshot, plazaSnapshot, targetLockSnapshot, assignments] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(plazaRef),
      transaction.get(targetLockRef),
      transaction.get(context.businessRef.collection("ordenesTrabajo").where("plazaId", "==", plazaId)),
    ]);
    const order = assertOrder(orderSnapshot, context.businessId, HttpsError);
    const plaza = assertPlaza(plazaSnapshot, context.businessId, HttpsError);
    assertRevision(order, expected, HttpsError, "La orden de trabajo");
    if (!isActiveOrder(order)) {
      fail(HttpsError, "failed-precondition", "No se puede asignar una Plaza a una OT cerrada o cancelada.");
    }
    if (plaza.estado !== "activa") {
      fail(HttpsError, "failed-precondition", "Solo puedes asignar una Plaza activa.");
    }
    assertNoOtherActiveAssignment(assignments, otId, plazaId, HttpsError);
    const targetLock = targetLockSnapshot.data() || null;
    if (targetLockSnapshot.exists && (targetLock.negocioId !== context.businessId || targetLock.plazaId !== plazaId)) {
      fail(HttpsError, "failed-precondition", "La exclusividad de la Plaza requiere revisión.");
    }
    if (targetLock?.otId && targetLock.otId !== otId) {
      const occupant = await readLockOccupant(transaction, context, targetLock);
      if (occupant && occupant.plazaId === plazaId && isActiveOrder(occupant)) {
        fail(HttpsError, "aborted", "La Plaza fue asignada a otra Orden de Trabajo. Actualiza la información e intenta nuevamente.");
      }
    }
    const previousPlazaId = order.plazaId || null;
    let previousLockSnapshot = null;
    let previousLockRef = null;
    if (previousPlazaId && previousPlazaId !== plazaId) {
      previousLockRef = context.businessRef.collection("plazaOccupancyKeys").doc(previousPlazaId);
      previousLockSnapshot = await transaction.get(previousLockRef);
      const previousLock = previousLockSnapshot.data() || {};
      if (previousLockSnapshot.exists &&
          (previousLock.negocioId !== context.businessId || previousLock.plazaId !== previousPlazaId || previousLock.otId !== otId)) {
        fail(HttpsError, "failed-precondition", "La asignación actual de la OT requiere revisión antes de cambiarla.");
      }
    }
    if (previousPlazaId === plazaId && targetLock?.otId === otId) {
      return {otId, plazaId, estado: order.estado, sinCambios: true};
    }
    const timestamp = FieldValue.serverTimestamp();
    const estado = order.estado === "en_cola" ? "en_diagnostico" : order.estado;
    if (previousLockSnapshot?.exists) transaction.delete(previousLockRef);
    transaction.set(targetLockRef, {negocioId: context.businessId, plazaId, otId});
    transaction.update(orderRef, {
      plazaId,
      estado,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    if (previousPlazaId && previousPlazaId !== plazaId) {
      appendPlanningEvent(transaction, orderRef, {
        businessId: context.businessId, actorUid: context.uid, actorSnapshot,
        type: "plaza_liberada", timestamp, detail: {plazaId: previousPlazaId},
      });
    }
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      type: "plaza_asignada", timestamp,
      detail: {plazaId, plazaAnteriorId: previousPlazaId, estadoAnterior: order.estado, estado},
    });
    return {otId, plazaId, estado, sinCambios: false};
  });
}

async function liberarPlazaOTHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  onlyFields(request?.data, ["businessId", "otId", "expectedActualizadoEn"], HttpsError, "La solicitud");
  const context = await requirePlazaAccess(request, dependencies, TALLER_OPERATION_ROLES);
  const otId = identifier(request.data.otId, "La orden de trabajo", HttpsError);
  const expected = expectedRevision(request.data.expectedActualizadoEn, HttpsError, "la orden de trabajo");
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  return db.runTransaction(async (transaction) => {
    await assertFreshAccess(transaction, context, dependencies, TALLER_OPERATION_ROLES);
    const order = assertOrder(await transaction.get(orderRef), context.businessId, HttpsError);
    assertRevision(order, expected, HttpsError, "La orden de trabajo");
    const plazaId = order.plazaId || null;
    if (!plazaId) return {otId, plazaId: null, estado: order.estado, sinCambios: true};
    const lockRef = context.businessRef.collection("plazaOccupancyKeys").doc(plazaId);
    const lockSnapshot = await transaction.get(lockRef);
    const lock = lockSnapshot.data() || {};
    if (lockSnapshot.exists &&
        (lock.negocioId !== context.businessId || lock.plazaId !== plazaId || lock.otId !== otId)) {
      fail(HttpsError, "failed-precondition", "La asignación actual de la OT requiere revisión antes de liberarla.");
    }
    const timestamp = FieldValue.serverTimestamp();
    if (lockSnapshot.exists) transaction.delete(lockRef);
    transaction.update(orderRef, {
      plazaId: null,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      type: "plaza_liberada", timestamp, detail: {plazaId},
    });
    return {otId, plazaId: null, estado: order.estado, sinCambios: false};
  });
}

module.exports = {
  PLAZA_STATES,
  TERMINAL_ORDER_STATES,
  activarPlazaTallerHandler,
  actualizarPlazaTallerHandler,
  asignarPlazaOTHandler,
  crearPlazaTallerHandler,
  inactivarPlazaTallerHandler,
  liberarPlazaOTHandler,
};
