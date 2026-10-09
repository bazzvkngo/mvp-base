"use strict";

const {createHash} = require("node:crypto");
const {normalizeBusinessVerificationState} = require("./businessOperations");
const {
  ASSIGNABLE_BUSINESS_ROLES,
  TALLER_CREATION_ROLES,
  TALLER_MANAGEMENT_ROLES,
  TALLER_OPERATION_ROLES,
} = require("./rbac");

const WORK_ORDER_INPUT_FIELDS = new Set(["vehiculoId"]);
const RECEPTION_INPUT_FIELDS = new Set([
  "kilometraje",
  "nivelCombustible",
  "checklist",
  "accesorios",
  "danosObservados",
  "observaciones",
]);
const RECEPTION_CHECKLIST_VALUES = Object.freeze({
  carroceriaPintura: new Set(["SIN_DANOS_VISIBLES", "CON_OBSERVACIONES", "NO_REVISADO"]),
  vidriosEspejos: new Set(["SIN_DANOS_VISIBLES", "CON_OBSERVACIONES", "NO_REVISADO"]),
  lucesOpticos: new Set(["SIN_DANOS_VISIBLES", "CON_OBSERVACIONES", "NO_REVISADO"]),
  neumaticosLlantas: new Set(["SIN_DANOS_VISIBLES", "CON_OBSERVACIONES", "NO_REVISADO"]),
  interior: new Set(["SIN_DANOS_VISIBLES", "CON_OBSERVACIONES", "NO_REVISADO"]),
  tableroIndicadores: new Set(["SIN_ALERTAS_VISIBLES", "CON_ALERTAS", "NO_REVISADO"]),
  encendido: new Set(["NORMAL", "CON_DIFICULTAD", "NO_ENCIENDE", "NO_PROBADO"]),
  fugasVisibles: new Set(["NO_SE_OBSERVAN", "SE_OBSERVAN", "NO_REVISADO"]),
  nivelesVisibles: new Set(["SIN_OBSERVACIONES", "CON_OBSERVACIONES", "NO_REVISADO"]),
  estadoGeneral: new Set(["SIN_OBSERVACIONES", "CON_OBSERVACIONES"]),
});
const RECEPTION_ANOMALY_VALUES = new Set([
  "CON_OBSERVACIONES",
  "CON_ALERTAS",
  "CON_DIFICULTAD",
  "NO_ENCIENDE",
  "SE_OBSERVAN",
]);
const RECEPTION_FUEL_LEVELS = new Set([
  "Vacío",
  "1/4",
  "1/2",
  "3/4",
  "Lleno",
]);
const DIAGNOSIS_INPUT_FIELDS = new Set(["responsableUid", "descripcion", "observaciones"]);
const SERVICE_INPUT_FIELDS = new Set(["itemId", "responsableUid"]);
const APPROVAL_ROLES = new Set(["OWNER", "ADMIN"]);
const PLANNING_STATES = new Set(["en_cola", "en_diagnostico", "esperando_aprobacion", "esperando_repuestos", "en_reparacion"]);

function canApproveWorkOrder(membership) {
  return APPROVAL_ROLES.has(membership.rol) && !membership.profileId;
}

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function text(value, label, maxLength, HttpsError, {required = false} = {}) {
  if (value == null) value = "";
  if (typeof value !== "string") {
    fail(HttpsError, "invalid-argument", `${label} debe ser texto.`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (required && !normalized) {
    fail(HttpsError, "invalid-argument", `${label} es obligatorio.`);
  }
  if (normalized.length > maxLength) {
    fail(
      HttpsError,
      "invalid-argument",
      `${label} no puede superar ${maxLength} caracteres.`
    );
  }
  return normalized;
}

function identifier(value, label, HttpsError) {
  const normalized = text(value, label, 160, HttpsError, {required: true});
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    fail(HttpsError, "invalid-argument", `${label} no es válido.`);
  }
  return normalized;
}

function requestIdentifier(value, HttpsError) {
  const normalized = text(
    value,
    "La solicitud de creación",
    120,
    HttpsError,
    {required: true}
  );
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(normalized)) {
    fail(
      HttpsError,
      "invalid-argument",
      "La solicitud de creación no es válida."
    );
  }
  return normalized;
}

function normalizeWorkOrderInput(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(
      HttpsError,
      "invalid-argument",
      "Los datos de la orden de trabajo deben enviarse como un objeto."
    );
  }
  const unknownField = Object.keys(raw).find(
    (field) => !WORK_ORDER_INPUT_FIELDS.has(field)
  );
  if (unknownField) {
    fail(
      HttpsError,
      "invalid-argument",
      `El campo de orden de trabajo ${unknownField} no está admitido.`
    );
  }
  return {
    vehiculoId: identifier(raw.vehiculoId, "El vehículo", HttpsError),
  };
}

function nonNegativeInteger(value, label, HttpsError) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(HttpsError, "invalid-argument", `${label} debe ser un número entero válido.`);
  }
  return value;
}

function normalizeChecklist(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(HttpsError, "invalid-argument", "La checklist de recepción debe enviarse como un objeto.");
  }
  const allowedFields = Object.keys(RECEPTION_CHECKLIST_VALUES);
  const unknownField = Object.keys(raw).find((field) => !allowedFields.includes(field));
  if (unknownField) {
    fail(HttpsError, "invalid-argument", `El campo de checklist ${unknownField} no está admitido.`);
  }
  return allowedFields.reduce((checklist, field) => {
    const value = text(raw[field], `El control ${field}`, 40, HttpsError, {required: true});
    if (!RECEPTION_CHECKLIST_VALUES[field].has(value)) {
      fail(HttpsError, "invalid-argument", `El control ${field} tiene un valor no permitido.`);
    }
    checklist[field] = value;
    return checklist;
  }, {});
}

function hasReceptionAnomaly(checklist) {
  return Object.values(checklist).some((value) => RECEPTION_ANOMALY_VALUES.has(value));
}

function normalizeAccessories(value, HttpsError) {
  if (!Array.isArray(value)) {
    fail(HttpsError, "invalid-argument", "Los accesorios deben enviarse como una lista.");
  }
  if (value.length > 50) {
    fail(HttpsError, "invalid-argument", "La recepción no puede incluir más de 50 accesorios.");
  }
  return value.map((item) => text(item, "Cada accesorio", 120, HttpsError, {required: true}));
}

function normalizeReceptionInput(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(HttpsError, "invalid-argument", "Los datos de recepción deben enviarse como un objeto.");
  }
  const unknownField = Object.keys(raw).find((field) => !RECEPTION_INPUT_FIELDS.has(field));
  if (unknownField) {
    fail(HttpsError, "invalid-argument", `El campo de recepción ${unknownField} no está admitido.`);
  }
  const checklist = normalizeChecklist(raw.checklist, HttpsError);
  const danosObservados = text(raw.danosObservados, "Los daños observados", 2000, HttpsError);
  if (hasReceptionAnomaly(checklist)) {
    if (!danosObservados || danosObservados.toLocaleLowerCase("es-CL") === "ninguno" || danosObservados.length < 3) {
      fail(HttpsError, "invalid-argument", "Describe los daños u observaciones detectados en la recepción.");
    }
  } else if (danosObservados !== "Ninguno") {
    fail(HttpsError, "invalid-argument", "Sin anomalías visibles, los daños observados deben indicar exactamente Ninguno.");
  }
  const nivelCombustible = text(raw.nivelCombustible, "El nivel de combustible", 80, HttpsError, {required: true});
  if (!RECEPTION_FUEL_LEVELS.has(nivelCombustible)) {
    fail(HttpsError, "invalid-argument", "Selecciona un nivel de combustible válido.");
  }
  return {
    kilometraje: nonNegativeInteger(raw.kilometraje, "El kilometraje", HttpsError),
    nivelCombustible,
    checklist,
    accesorios: normalizeAccessories(raw.accesorios, HttpsError),
    danosObservados,
    observaciones: text(raw.observaciones, "Las observaciones", 2000, HttpsError),
  };
}

function formatWorkOrderNumber(sequence) {
  return `OT-${String(sequence).padStart(6, "0")}`;
}

function signature(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertVehicle(snapshot, businessId, vehiculoId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "not-found", "No se encontró el vehículo.");
  }
  const stored = snapshot.data() || {};
  if (
    snapshot.id !== vehiculoId ||
    stored.vehiculoId !== vehiculoId ||
    stored.negocioId !== businessId
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "El vehículo no pertenece al negocio seleccionado."
    );
  }
  return stored;
}

function assertClient(snapshot, businessId, clienteId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "failed-precondition", "El propietario actual ya no existe.");
  }
  const stored = snapshot.data() || {};
  if (
    snapshot.id !== clienteId ||
    stored.clienteId !== clienteId ||
    stored.negocioId !== businessId
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "El propietario actual no pertenece al negocio seleccionado."
    );
  }
}

function assertWorkOrder(snapshot, businessId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "failed-precondition", "La orden creada ya no existe.");
  }
  const stored = snapshot.data() || {};
  if (snapshot.id !== stored.otId || stored.negocioId !== businessId) {
    fail(HttpsError, "failed-precondition", "La orden creada es inconsistente.");
  }
  return stored;
}

function nextSequence(counterSnapshot, HttpsError) {
  if (!counterSnapshot.exists) return 1;
  const counter = counterSnapshot.data() || {};
  if (
    !Number.isSafeInteger(counter.lastNumber) ||
    counter.lastNumber < 0
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "El correlativo de órdenes de trabajo requiere revisión."
    );
  }
  return counter.lastNumber + 1;
}

function businessCurrency(context) {
  const value = String(
    context.businessSnapshot?.data()?.monedaCodigo || ""
  ).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

async function requireManagementAccess(request, dependencies) {
  return dependencies.requireBusinessAccess(
    request,
    {db: dependencies.db, HttpsError: dependencies.HttpsError},
    {
      roles: TALLER_MANAGEMENT_ROLES,
      requiresVerifiedBusiness: true,
      moduleId: "taller",
    }
  );
}

async function requireCreationAccess(request, dependencies) {
  return dependencies.requireBusinessAccess(
    request,
    {db: dependencies.db, HttpsError: dependencies.HttpsError},
    {
      roles: TALLER_CREATION_ROLES,
      requiresVerifiedBusiness: true,
      moduleId: "taller",
    }
  );
}

async function requireReceptionAccess(request, dependencies) {
  return dependencies.requireBusinessAccess(
    request,
    {db: dependencies.db, HttpsError: dependencies.HttpsError},
    {
      roles: TALLER_OPERATION_ROLES,
      requiresVerifiedBusiness: true,
      moduleId: "taller",
    }
  );
}

function normalizeDiagnosisInput(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(HttpsError, "invalid-argument", "Los datos del diagnóstico deben enviarse como objeto.");
  }
  const unknown = Object.keys(raw).find((field) => !DIAGNOSIS_INPUT_FIELDS.has(field));
  if (unknown) fail(HttpsError, "invalid-argument", `El campo ${unknown} no está admitido en el diagnóstico.`);
  return {
    responsableUid: identifier(raw.responsableUid, "El responsable", HttpsError),
    descripcion: text(raw.descripcion, "La descripción", 5000, HttpsError),
    observaciones: text(raw.observaciones, "Las observaciones", 2000, HttpsError),
  };
}

function normalizeServiceInput(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(HttpsError, "invalid-argument", "Los datos del servicio deben enviarse como objeto.");
  }
  const unknown = Object.keys(raw).find((field) => !SERVICE_INPUT_FIELDS.has(field));
  if (unknown) fail(HttpsError, "invalid-argument", `El campo ${unknown} no está admitido en el servicio.`);
  return {
    itemId: identifier(raw.itemId, "El servicio Core", HttpsError),
    responsableUid: identifier(raw.responsableUid, "El responsable", HttpsError),
  };
}

function plannedQuantity(value, HttpsError) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 ||
      Math.round(value * 1000) !== value * 1000) {
    fail(HttpsError, "invalid-argument", "La cantidad planificada debe ser un número positivo con hasta tres decimales.");
  }
  return value;
}

function assertPlanningOrder(order, HttpsError) {
  if (!order.recepcion || !PLANNING_STATES.has(order.estado)) {
    fail(HttpsError, "failed-precondition", "El estado actual de la OT no permite modificar el alcance.");
  }
}

function invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp) {
  const invalidated = order.estadoAprobacion === "aprobada" || ["esperando_aprobacion", "esperando_repuestos"].includes(order.estado);
  transaction.update(orderRef, {
    estado: invalidated ? (order.plazaId ? "en_diagnostico" : "en_cola") : order.estado,
    estadoAprobacion: "pendiente",
    actualizadoPorUid: context.uid, actualizadoEn: timestamp,
  });
  if (invalidated) {
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot, timestamp,
      type: "aprobacion_invalidada", detail: {estadoAnterior: order.estado, aprobacionAnterior: order.estadoAprobacion,
        estado: order.plazaId ? "en_diagnostico" : "en_cola", estadoAprobacion: "pendiente"},
    });
  }
}

function assertPlanningItem(snapshot, businessId, itemId, type, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró el ítem de Inventario Core.");
  const item = snapshot.data() || {};
  if (snapshot.id !== itemId || (item.negocioId && item.negocioId !== businessId) ||
      item.tipoItem !== type || (item.estado || "activo") !== "activo") {
    fail(HttpsError, "failed-precondition", `Selecciona un ${type} activo de Inventario Core del mismo negocio.`);
  }
}

function assertService(snapshot, businessId, otId, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró el servicio de la OT.");
  const service = snapshot.data() || {};
  if (service.servicioOtId !== snapshot.id || service.negocioId !== businessId || service.otId !== otId) {
    fail(HttpsError, "failed-precondition", "El servicio no pertenece a esta orden.");
  }
  return service;
}

function appendPlanningEvent(transaction, orderRef, {businessId, actorUid, actorSnapshot, type, detail, timestamp}) {
  const eventRef = orderRef.collection("historial").doc();
  transaction.create(eventRef, {
    eventoId: eventRef.id, negocioId: businessId, otId: orderRef.id,
    tipo: type, fecha: timestamp, actorUid, actorSnapshot, detalle: detail,
  });
}

async function listarCatalogoTallerHandler(request, dependencies) {
  const context = await requireReceptionAccess(request, dependencies);
  const snapshot = await context.businessRef.collection("inventario")
    .where("tipoItem", "in", ["servicio", "producto"]).get();
  const items = snapshot.docs.flatMap((document) => {
    const item = document.data() || {};
    if ((item.negocioId && item.negocioId !== context.businessId) ||
        (item.estado || "activo") !== "activo") return [];
    const price = item.precioInterno == null || item.precioInterno === ""
      ? null : Number(item.precioInterno);
    return [{
      itemId: document.id, tipoItem: item.tipoItem, estado: "activo",
      nombre: String(item.nombre || item.descripcionItem || "Ítem sin nombre").trim(),
      codigoInterno: String(item.codigoInterno || item.sku || "").trim(),
      stock: item.tipoItem === "producto" && Number.isFinite(Number(item.stock))
        ? Number(item.stock) : null,
      precioEfectivo: price !== null && Number.isFinite(price) && price >= 0
        ? Math.round(price) : null,
    }];
  });
  return {items};
}

function assertDiagnosisOperationAllowed(order, HttpsError) {
  if (!order.recepcion || order.estado === "ingresada") {
    fail(HttpsError, "failed-precondition", "Registra la recepción antes de diagnosticar.");
  }
  if (["pendiente_entrega", "cerrada", "cancelada"].includes(order.estado)) {
    fail(HttpsError, "failed-precondition", "Esta orden ya no admite diagnósticos.");
  }
}

function assertDiagnosis(snapshot, businessId, otId, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró el diagnóstico.");
  const diagnosis = snapshot.data() || {};
  if (diagnosis.diagnosticoId !== snapshot.id || diagnosis.negocioId !== businessId || diagnosis.otId !== otId) {
    fail(HttpsError, "failed-precondition", "El diagnóstico no pertenece a esta orden.");
  }
  return diagnosis;
}

function assertDiagnosisRevision(record, expected, HttpsError, label = "diagnóstico") {
  if (!Number.isSafeInteger(expected) || record.actualizadoEn?.toMillis?.() !== expected) {
    fail(HttpsError, "aborted", `El ${label} cambió en otra sesión. Actualiza la ficha antes de continuar.`);
  }
}

function assertAssignableMember(snapshot, businessId, uid, HttpsError) {
  const member = snapshot.data() || {};
  if (!snapshot.exists || snapshot.id !== `${businessId}__${uid}` || member.negocioId !== businessId ||
      member.uid !== uid || member.estado !== "activo" || !ASSIGNABLE_BUSINESS_ROLES.includes(member.rol)) {
    fail(HttpsError, "failed-precondition", "Selecciona un responsable asignable y activo del negocio.");
  }
}

function profileIdentityName(profile, user) {
  const name = [profile?.nombres, profile?.apellidos]
    .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  return name || String(user?.email || "Usuario no disponible").trim();
}

async function diagnosisActor(dependencies, uid) {
  const [user, profileSnapshot] = await Promise.all([
    dependencies.auth.getUser(uid),
    dependencies.db.collection("usuarios").doc(uid).collection("cuenta").doc("perfil").get(),
  ]);
  return {
    nombre: profileIdentityName(profileSnapshot.data() || {}, user),
    correo: String(user.email || "").trim(),
  };
}

function appendDiagnosisEvent(transaction, orderRef, {businessId, diagnosisId, type, actorUid, actorSnapshot, timestamp}) {
  const eventRef = orderRef.collection("historial").doc();
  transaction.create(eventRef, {
    eventoId: eventRef.id, negocioId: businessId, otId: orderRef.id,
    tipo: type, fecha: timestamp, actorUid, actorSnapshot,
    detalle: {diagnosticoId: diagnosisId},
  });
}

async function listarPersonasAsignablesTallerHandler(request, dependencies) {
  const context = await requireReceptionAccess(request, dependencies);
  const snapshot = await dependencies.db.collection("membresias")
    .where("negocioId", "==", context.businessId).get();
  const members = snapshot.docs.filter((item) => {
    const member = item.data() || {};
    return member.estado === "activo" &&
      (ASSIGNABLE_BUSINESS_ROLES.includes(member.rol) || TALLER_OPERATION_ROLES.includes(member.rol)) &&
      item.id === `${context.businessId}__${member.uid}`;
  }).map((item) => item.data());
  const identities = [];
  for (let index = 0; index < members.length; index += 100) {
    const batch = members.slice(index, index + 100);
    const uids = batch.map((member) => member.uid);
    const [users, profiles] = await Promise.all([
      dependencies.auth.getUsers(uids.map((uid) => ({uid}))),
      dependencies.db.getAll(...uids.map((uid) => dependencies.db.collection("usuarios")
        .doc(uid).collection("cuenta").doc("perfil"))),
    ]);
    const authUsers = new Map(users.users.map((user) => [user.uid, user]));
    batch.forEach((member, offset) => {
      const profile = profiles[offset].data() || {};
      const user = authUsers.get(member.uid);
      if (!user || user.disabled) return;
      identities.push({uid: member.uid, rol: member.rol, nombre: profileIdentityName(profile, user)});
    });
  }
  const byName = (left, right) => left.nombre.localeCompare(right.nombre, "es-CL");
  const publicIdentity = ({uid, nombre}) => ({uid, nombre});
  return {
    personas: identities.filter((person) => ASSIGNABLE_BUSINESS_ROLES.includes(person.rol))
      .sort(byName).map(publicIdentity),
    actores: identities.filter((person) => TALLER_OPERATION_ROLES.includes(person.rol))
      .sort(byName).map(publicIdentity),
  };
}

async function crearOrdenTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireCreationAccess(request, dependencies);
  const input = normalizeWorkOrderInput(
    request?.data?.ordenTrabajo,
    HttpsError
  );
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const inputSignature = signature(input);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc();
  const vehicleRef = context.businessRef
    .collection("vehiculos")
    .doc(input.vehiculoId);
  const counterRef = context.businessRef.collection("otCounters").doc("global");
  const requestRef = context.businessRef
    .collection("otCreateRequests")
    .doc(requestId);

  const result = await db.runTransaction(async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists) {
      const storedRequest = requestSnapshot.data() || {};
      if (
        storedRequest.negocioId !== context.businessId ||
        storedRequest.creadoPorUid !== context.uid ||
        storedRequest.inputSignature !== inputSignature
      ) {
        fail(
          HttpsError,
          "already-exists",
          "La solicitud de creación ya fue utilizada con otros datos."
        );
      }
      const existingSnapshot = await transaction.get(
        context.businessRef
          .collection("ordenesTrabajo")
          .doc(storedRequest.otId)
      );
      return {
        stored: assertWorkOrder(
          existingSnapshot,
          context.businessId,
          HttpsError
        ),
        sinCambios: true,
      };
    }

    const [vehicleSnapshot, counterSnapshot] = await transaction.getAll(
      vehicleRef,
      counterRef
    );
    const vehicle = assertVehicle(
      vehicleSnapshot,
      context.businessId,
      input.vehiculoId,
      HttpsError
    );
    const clienteId = identifier(
      vehicle.clienteId,
      "El propietario actual",
      HttpsError
    );
    const clientRef = context.businessRef.collection("clientes").doc(clienteId);
    assertClient(
      await transaction.get(clientRef),
      context.businessId,
      clienteId,
      HttpsError
    );

    const sequence = nextSequence(counterSnapshot, HttpsError);
    const numeroOT = formatWorkOrderNumber(sequence);
    const timestamp = FieldValue.serverTimestamp();
    const stored = {
      otId: orderRef.id,
      negocioId: context.businessId,
      numeroOT,
      vehiculoId: input.vehiculoId,
      clienteId,
      estado: "ingresada",
      estadoAprobacion: "pendiente",
      plazaId: null,
      moneda: businessCurrency(context),
      recepcion: null,
      creadoPorUid: context.uid,
      creadoEn: timestamp,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    };

    transaction.create(orderRef, stored);
    transaction.set(counterRef, {
      negocioId: context.businessId,
      lastNumber: sequence,
      actualizadoEn: timestamp,
    });
    transaction.create(requestRef, {
      requestId,
      negocioId: context.businessId,
      otId: orderRef.id,
      numeroOT,
      inputSignature,
      creadoPorUid: context.uid,
      creadoEn: timestamp,
    });

    return {stored, sinCambios: false};
  });

  return {
    ordenTrabajo: result.sinCambios ? result.stored : {
      otId: orderRef.id,
      negocioId: context.businessId,
      numeroOT: result.stored.numeroOT,
      vehiculoId: result.stored.vehiculoId,
      clienteId: result.stored.clienteId,
      estado: result.stored.estado,
      estadoAprobacion: result.stored.estadoAprobacion,
      plazaId: result.stored.plazaId,
      moneda: result.stored.moneda,
      recepcion: result.stored.recepcion,
      creadoPorUid: context.uid,
      actualizadoPorUid: context.uid,
    },
    sinCambios: result.sinCambios,
  };
}

function assertStoredWorkOrder(snapshot, businessId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "not-found", "No se encontró la orden de trabajo.");
  }
  const stored = snapshot.data() || {};
  if (snapshot.id !== stored.otId || stored.negocioId !== businessId) {
    fail(HttpsError, "failed-precondition", "La orden de trabajo no pertenece al negocio seleccionado.");
  }
  return stored;
}

function receptionNextStatus(order) {
  if (order.estado !== "ingresada") return order.estado;
  return order.plazaId ? "en_diagnostico" : "en_cola";
}

async function registrarRecepcionOrdenTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const input = normalizeReceptionInput(request?.data?.recepcion, HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  let result;

  await db.runTransaction(async (transaction) => {
    const stored = assertStoredWorkOrder(
      await transaction.get(orderRef),
      context.businessId,
      HttpsError
    );
    const existingReception = stored.recepcion;
    if (existingReception != null && (typeof existingReception !== "object" || Array.isArray(existingReception))) {
      fail(HttpsError, "failed-precondition", "La recepción existente requiere revisión antes de actualizarse.");
    }
    if (!existingReception && stored.estado !== "ingresada") {
      fail(HttpsError, "failed-precondition", "La recepción solo puede registrarse desde una OT ingresada.");
    }
    if (["pendiente_entrega", "cerrada", "cancelada"].includes(stored.estado)) {
      fail(HttpsError, "failed-precondition", "Esta OT ya no permite modificar la recepción.");
    }
    const timestamp = FieldValue.serverTimestamp();
    const reception = {
      ...input,
      recibidoPorUid: existingReception?.recibidoPorUid || context.uid,
      recibidoEn: existingReception?.recibidoEn || timestamp,
    };
    const estado = receptionNextStatus(stored);
    transaction.update(orderRef, {
      recepcion: reception,
      estado,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    result = {
      otId,
      negocioId: context.businessId,
      numeroOT: stored.numeroOT,
      vehiculoId: stored.vehiculoId,
      clienteId: stored.clienteId,
      estado,
      estadoAprobacion: stored.estadoAprobacion,
      plazaId: stored.plazaId,
      moneda: stored.moneda,
      recepcion: {
        ...input,
        recibidoPorUid: existingReception?.recibidoPorUid || context.uid,
        recibidoEn: existingReception?.recibidoEn || null,
      },
    };
  });
  return {ordenTrabajo: result};
}

async function registrarDiagnosticoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const input = normalizeDiagnosisInput(request?.data?.diagnostico, HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const diagnosisRef = orderRef.collection("diagnosticos").doc(requestId);
  const memberRef = db.collection("membresias").doc(`${context.businessId}__${input.responsableUid}`);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const assignedUser = await dependencies.auth.getUser(input.responsableUid);
  if (assignedUser.disabled) fail(HttpsError, "failed-precondition", "El responsable seleccionado está deshabilitado.");
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(diagnosisRef);
    if (existing.exists) {
      const stored = assertDiagnosis(existing, context.businessId, otId, HttpsError);
      if (stored.creadoPorUid !== context.uid ||
          !Object.keys(input).every((key) => stored[key] === input[key])) {
        fail(HttpsError, "already-exists", "Esta solicitud de diagnóstico ya fue utilizada.");
      }
      return {diagnostico: {...stored, diagnosticoId: diagnosisRef.id}, sinCambios: true};
    }
    const [orderSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(memberRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertDiagnosisOperationAllowed(order, HttpsError);
    assertAssignableMember(memberSnapshot, context.businessId, input.responsableUid, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    const stored = {
      diagnosticoId: diagnosisRef.id, negocioId: context.businessId, otId,
      ...input, estado: "borrador", creadoPorUid: context.uid, creadoEn: timestamp,
      actualizadoPorUid: context.uid, actualizadoEn: timestamp,
      completadoPorUid: null, completadoEn: null,
    };
    transaction.create(diagnosisRef, stored);
    transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    appendDiagnosisEvent(transaction, orderRef, {
      businessId: context.businessId, diagnosisId: diagnosisRef.id,
      type: "diagnostico_creado", actorUid: context.uid, actorSnapshot, timestamp,
    });
    return {diagnosticoId: diagnosisRef.id, sinCambios: false};
  });
}

async function actualizarDiagnosticoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const diagnosticoId = identifier(request?.data?.diagnosticoId, "El diagnóstico", HttpsError);
  const input = normalizeDiagnosisInput(request?.data?.diagnostico, HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const diagnosisRef = orderRef.collection("diagnosticos").doc(diagnosticoId);
  const memberRef = db.collection("membresias").doc(`${context.businessId}__${input.responsableUid}`);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const assignedUser = await dependencies.auth.getUser(input.responsableUid);
  if (assignedUser.disabled) fail(HttpsError, "failed-precondition", "El responsable seleccionado está deshabilitado.");
  return db.runTransaction(async (transaction) => {
    const [orderSnapshot, diagnosisSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(diagnosisRef), transaction.get(memberRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertDiagnosisOperationAllowed(order, HttpsError);
    const stored = assertDiagnosis(diagnosisSnapshot, context.businessId, otId, HttpsError);
    if (stored.estado !== "borrador") fail(HttpsError, "failed-precondition", "Un diagnóstico completado es de solo lectura.");
    assertDiagnosisRevision(stored, expected, HttpsError);
    assertAssignableMember(memberSnapshot, context.businessId, input.responsableUid, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(diagnosisRef, {...input, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    appendDiagnosisEvent(transaction, orderRef, {
      businessId: context.businessId, diagnosisId: diagnosticoId,
      type: "diagnostico_actualizado", actorUid: context.uid, actorSnapshot, timestamp,
    });
    return {diagnosticoId};
  });
}

async function completarDiagnosticoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const diagnosticoId = identifier(request?.data?.diagnosticoId, "El diagnóstico", HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const diagnosisRef = orderRef.collection("diagnosticos").doc(diagnosticoId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  return db.runTransaction(async (transaction) => {
    const [orderSnapshot, diagnosisSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(diagnosisRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertDiagnosisOperationAllowed(order, HttpsError);
    const stored = assertDiagnosis(diagnosisSnapshot, context.businessId, otId, HttpsError);
    if (stored.estado !== "borrador") fail(HttpsError, "failed-precondition", "El diagnóstico ya está completado.");
    assertDiagnosisRevision(stored, expected, HttpsError);
    if (!String(stored.descripcion || "").trim()) {
      fail(HttpsError, "failed-precondition", "Describe el diagnóstico antes de completarlo.");
    }
    const memberRef = db.collection("membresias").doc(`${context.businessId}__${stored.responsableUid}`);
    assertAssignableMember(await transaction.get(memberRef), context.businessId, stored.responsableUid, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(diagnosisRef, {
      estado: "completado", completadoPorUid: context.uid, completadoEn: timestamp,
      actualizadoPorUid: context.uid, actualizadoEn: timestamp,
    });
    transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    appendDiagnosisEvent(transaction, orderRef, {
      businessId: context.businessId, diagnosisId: diagnosticoId,
      type: "diagnostico_completado", actorUid: context.uid, actorSnapshot, timestamp,
    });
    return {diagnosticoId};
  });
}

async function crearServicioOTHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = requestIdentifier(request?.data?.requestId, HttpsError);
  const input = normalizeServiceInput(request?.data?.servicio, HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const itemRef = context.businessRef.collection("inventario").doc(input.itemId);
  const memberRef = db.collection("membresias").doc(`${context.businessId}__${input.responsableUid}`);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const assignedUser = await dependencies.auth.getUser(input.responsableUid);
  if (assignedUser.disabled) fail(HttpsError, "failed-precondition", "El responsable seleccionado está deshabilitado.");
  return db.runTransaction(async (transaction) => {
    const [existing, orderSnapshot, itemSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(serviceRef), transaction.get(orderRef), transaction.get(itemRef), transaction.get(memberRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    if (existing.exists) {
      const stored = assertService(existing, context.businessId, otId, HttpsError);
      if (stored.creadoPorUid !== context.uid || stored.itemId !== input.itemId ||
          stored.responsableUid !== input.responsableUid) {
        fail(HttpsError, "already-exists", "Esta solicitud de servicio ya fue utilizada.");
      }
      return {servicioOtId: serviceId, sinCambios: true};
    }
    assertPlanningOrder(order, HttpsError);
    assertPlanningItem(itemSnapshot, context.businessId, input.itemId, "servicio", HttpsError);
    assertAssignableMember(memberSnapshot, context.businessId, input.responsableUid, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.create(serviceRef, {
      servicioOtId: serviceId, negocioId: context.businessId, otId,
      ...input, estado: "pendiente", precioUnitario: null, servicioSnapshot: null, productos: [],
      creadoPorUid: context.uid, creadoEn: timestamp,
      actualizadoPorUid: context.uid, actualizadoEn: timestamp,
    });
    invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp);
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      type: "servicio_ot_creado", detail: {servicioOtId: serviceId, itemId: input.itemId}, timestamp,
    });
    return {servicioOtId: serviceId, sinCambios: false};
  });
}

async function actualizarServicioOTHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = identifier(request?.data?.servicioOtId, "El servicio de la OT", HttpsError);
  const input = normalizeServiceInput(request?.data?.servicio, HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const itemRef = context.businessRef.collection("inventario").doc(input.itemId);
  const memberRef = db.collection("membresias").doc(`${context.businessId}__${input.responsableUid}`);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const assignedUser = await dependencies.auth.getUser(input.responsableUid);
  if (assignedUser.disabled) fail(HttpsError, "failed-precondition", "El responsable seleccionado está deshabilitado.");
  return db.runTransaction(async (transaction) => {
    const [orderSnapshot, serviceSnapshot, itemSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(serviceRef), transaction.get(itemRef), transaction.get(memberRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertPlanningOrder(order, HttpsError);
    const stored = assertService(serviceSnapshot, context.businessId, otId, HttpsError);
    if (stored.estado !== "pendiente") fail(HttpsError, "failed-precondition", "Este servicio ya inició su ejecución.");
    assertDiagnosisRevision(stored, expected, HttpsError, "servicio");
    assertPlanningItem(itemSnapshot, context.businessId, input.itemId, "servicio", HttpsError);
    assertAssignableMember(memberSnapshot, context.businessId, input.responsableUid, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(serviceRef, {...input, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    if (stored.itemId !== input.itemId) {
      invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp);
    } else {
      transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    }
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      type: "servicio_ot_actualizado", detail: {servicioOtId: serviceId, itemId: input.itemId}, timestamp,
    });
    return {servicioOtId: serviceId};
  });
}

async function eliminarServicioOTHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = identifier(request?.data?.servicioOtId, "El servicio de la OT", HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const movementsQuery = context.businessRef.collection("movimientosInventario")
    .where("servicioOtId", "==", serviceId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  return db.runTransaction(async (transaction) => {
    const [orderSnapshot, serviceSnapshot, movementSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(serviceRef), transaction.get(movementsQuery),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertPlanningOrder(order, HttpsError);
    const stored = assertService(serviceSnapshot, context.businessId, otId, HttpsError);
    if (stored.estado !== "pendiente") {
      fail(HttpsError, "failed-precondition", "Solo se puede eliminar un servicio que aún no ha iniciado.");
    }
    assertDiagnosisRevision(stored, expected, HttpsError, "servicio");
    if (movementSnapshot.docs.some((entry) => {
      const movement = entry.data();
      return movement.negocioId === context.businessId && movement.otId === otId;
    })) {
      fail(HttpsError, "failed-precondition", "No se puede eliminar un servicio con movimientos de inventario.");
    }
    const timestamp = FieldValue.serverTimestamp();
    transaction.delete(serviceRef);
    invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp);
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      type: "servicio_ot_eliminado", detail: {servicioOtId: serviceId, itemId: stored.itemId}, timestamp,
    });
    return {servicioOtId: serviceId};
  });
}

async function changeProductoOTHandler(request, dependencies, action) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const forbidden = ["precioUnitario", "productoSnapshot", "stock", "estado"].find((field) =>
    Object.prototype.hasOwnProperty.call(request?.data || {}, field));
  if (forbidden) fail(HttpsError, "invalid-argument", `El campo ${forbidden} no está admitido en ProductoOT.`);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = identifier(request?.data?.servicioOtId, "El servicio de la OT", HttpsError);
  const productId = action === "agregar"
    ? requestIdentifier(request?.data?.requestId, HttpsError)
    : identifier(request?.data?.productoOtId, "El producto planificado", HttpsError);
  const itemId = action === "agregar"
    ? identifier(request?.data?.itemId, "El producto Core", HttpsError)
    : null;
  const quantity = action === "eliminar" ? null : plannedQuantity(request?.data?.cantidad, HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const itemRef = itemId ? context.businessRef.collection("inventario").doc(itemId) : null;
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  return db.runTransaction(async (transaction) => {
    const [orderSnapshot, serviceSnapshot, itemSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(serviceRef),
      itemRef ? transaction.get(itemRef) : Promise.resolve(null),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    const stored = assertService(serviceSnapshot, context.businessId, otId, HttpsError);
    const products = Array.isArray(stored.productos) ? stored.productos : [];
    const existing = products.find((product) => product.productoOtId === productId);
    if (action === "agregar" && existing) {
      if (existing.itemId !== itemId || existing.cantidad !== quantity) {
        fail(HttpsError, "already-exists", "Esta solicitud de producto ya fue utilizada.");
      }
      return {servicioOtId: serviceId, productoOtId: productId, sinCambios: true};
    }
    assertPlanningOrder(order, HttpsError);
    if (stored.estado !== "pendiente") fail(HttpsError, "failed-precondition", "Este servicio ya inició su ejecución.");
    if (action !== "agregar") assertDiagnosisRevision(stored, expected, HttpsError, "servicio");
    if (action === "agregar") assertPlanningItem(itemSnapshot, context.businessId, itemId, "producto", HttpsError);
    if (action !== "agregar" && !existing) fail(HttpsError, "not-found", "No se encontró el producto planificado.");
    if (action === "actualizar") {
      const existingItemRef = context.businessRef.collection("inventario").doc(existing.itemId);
      assertPlanningItem(await transaction.get(existingItemRef), context.businessId, existing.itemId, "producto", HttpsError);
    }
    const next = action === "agregar"
      ? [...products, {productoOtId: productId, itemId, cantidad: quantity,
        precioUnitario: null, productoSnapshot: null}]
      : action === "eliminar"
        ? products.filter((product) => product.productoOtId !== productId)
        : products.map((product) => product.productoOtId === productId ? {...product, cantidad: quantity} : product);
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(serviceRef, {productos: next, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    if (action !== "actualizar" || existing.cantidad !== quantity) {
      invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp);
    } else {
      transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    }
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      type: `producto_ot_${action}`, detail: {servicioOtId: serviceId, productoOtId: productId,
        itemId: existing?.itemId || itemId}, timestamp,
    });
    return {servicioOtId: serviceId, productoOtId: productId, sinCambios: false};
  });
}

const agregarProductoOTHandler = (request, dependencies) => changeProductoOTHandler(request, dependencies, "agregar");
const actualizarProductoOTHandler = (request, dependencies) => changeProductoOTHandler(request, dependencies, "actualizar");
const eliminarProductoOTHandler = (request, dependencies) => changeProductoOTHandler(request, dependencies, "eliminar");

function scopeFingerprint(services) {
  const scope = services.map((service) => ({
    servicioOtId: service.servicioOtId, itemId: service.itemId,
    productos: (service.productos || []).map(({productoOtId, itemId, cantidad}) =>
      ({productoOtId, itemId, cantidad})).sort((a, b) => a.productoOtId.localeCompare(b.productoOtId)),
  })).sort((a, b) => a.servicioOtId.localeCompare(b.servicioOtId));
  return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

async function transitionServiceOT(request, dependencies, action) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const allowed = new Set(["businessId", "otId", "servicioOtId", "requestId", "expectedActualizadoEn"]);
  if (Object.keys(request?.data || {}).some((field) => !allowed.has(field))) {
    fail(HttpsError, "invalid-argument", "La solicitud contiene campos no permitidos para ejecutar el servicio.");
  }
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = identifier(request?.data?.servicioOtId, "El servicio de la OT", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  if (!Number.isSafeInteger(expected)) fail(HttpsError, "invalid-argument", "Actualiza la ficha antes de ejecutar el servicio.");
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const approvalRef = context.businessRef.collection("otApprovalState").doc(otId);
  const requestRef = context.businessRef.collection("otServiceExecutionRequests").doc(requestId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const fingerprint = createHash("sha256").update(JSON.stringify({otId, serviceId, action, expected, actor: context.uid})).digest("hex");
  return db.runTransaction(async (transaction) => {
    const [requestSnapshot, orderSnapshot, serviceSnapshot, approvalSnapshot, servicesSnapshot, memberSnapshot,
      businessSnapshot] = await Promise.all([
      transaction.get(requestRef), transaction.get(orderRef), transaction.get(serviceRef), transaction.get(approvalRef),
      transaction.get(orderRef.collection("servicios")), transaction.get(context.membershipRef),
      transaction.get(context.businessRef),
    ]);
    const membership = memberSnapshot.data() || {};
    if (!memberSnapshot.exists || membership.uid !== context.uid || membership.negocioId !== context.businessId ||
        membership.estado !== "activo" || !TALLER_OPERATION_ROLES.includes(membership.rol)) {
      fail(HttpsError, "permission-denied", "Tu membresía ya no permite operar esta OT.");
    }
    if (membership.profileId) {
      const profile = await transaction.get(context.businessRef.collection("perfilesEmpleados").doc(membership.profileId));
      const data = profile.data() || {};
      if (data.negocioId !== context.businessId || data.estado !== "activo" || !data.modulos?.includes("taller")) {
        fail(HttpsError, "permission-denied", "Tu perfil ya no permite operar Taller.");
      }
    }
    const business = businessSnapshot.data() || {};
    if (!businessSnapshot.exists || business.estado !== "activo" || business.eliminadoEn ||
        normalizeBusinessVerificationState(business) !== "VERIFICADA") {
      fail(HttpsError, "failed-precondition", "El negocio no está habilitado para operar.");
    }
    if (requestSnapshot.exists) {
      if (requestSnapshot.data().fingerprint !== fingerprint) {
        fail(HttpsError, "already-exists", "La solicitud ya fue utilizada con otros datos.");
      }
      return {...requestSnapshot.data().resultado, sinCambios: true};
    }
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    const service = assertService(serviceSnapshot, context.businessId, otId, HttpsError);
    assertDiagnosisRevision(service, expected, HttpsError, "servicio");
    if (order.estado !== "en_reparacion" || order.estadoAprobacion !== "aprobada" ||
        !approvalSnapshot.exists || approvalSnapshot.data().negocioId !== context.businessId ||
        approvalSnapshot.data().otId !== otId ||
        approvalSnapshot.data().scopeHash !== scopeFingerprint(servicesSnapshot.docs.map((snapshot) =>
          assertService(snapshot, context.businessId, otId, HttpsError)))) {
      fail(HttpsError, "failed-precondition", "La OT debe estar en reparación con el alcance vigente aprobado.");
    }
    const previous = action === "iniciar" ? "pendiente" : "en_progreso";
    const next = action === "iniciar" ? "en_progreso" : "completado";
    if (service.estado !== previous) {
      fail(HttpsError, "failed-precondition", `Solo puedes ${action} un servicio ${previous.replace("_", " ")}.`);
    }
    const responsibleUid = identifier(service.responsableUid, "El responsable", HttpsError);
    const responsibleRef = db.collection("membresias").doc(`${context.businessId}__${responsibleUid}`);
    assertAssignableMember(await transaction.get(responsibleRef), context.businessId, responsibleUid, HttpsError);
    const responsible = await dependencies.auth.getUser(responsibleUid);
    if (responsible.disabled) fail(HttpsError, "failed-precondition", "El responsable del servicio está deshabilitado.");
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(serviceRef, {estado: next, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot, timestamp,
      type: action === "iniciar" ? "servicio_ot_iniciado" : "servicio_ot_completado",
      detail: {servicioOtId: serviceId, itemId: service.itemId, responsableUid: service.responsableUid,
        estadoAnterior: previous, estado: next},
    });
    const resultado = {servicioOtId: serviceId, estado: next, sinCambios: false};
    transaction.create(requestRef, {negocioId: context.businessId, otId, servicioOtId: serviceId,
      fingerprint, resultado, creadoEn: timestamp});
    return resultado;
  });
}

const iniciarServicioOTHandler = (request, deps) => transitionServiceOT(request, deps, "iniciar");
const completarServicioOTHandler = (request, deps) => transitionServiceOT(request, deps, "completar");

async function transitionWorkOrderClosure(request, dependencies, action) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const allowed = new Set(["businessId", "otId", "requestId", "expectedActualizadoEn"]);
  if (Object.keys(request?.data || {}).some((field) => !allowed.has(field))) {
    fail(HttpsError, "invalid-argument", "La solicitud de cierre contiene campos no permitidos.");
  }
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  if (!Number.isSafeInteger(expected)) {
    fail(HttpsError, "invalid-argument", "Actualiza la ficha antes de continuar.");
  }
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const requestRef = context.businessRef.collection("otClosureRequests").doc(requestId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const fingerprint = createHash("sha256").update(JSON.stringify({otId, action, expected, actor: context.uid})).digest("hex");
  return db.runTransaction(async (transaction) => {
    const [previous, data] = await Promise.all([
      transaction.get(requestRef), readApprovalContext(transaction, context, orderRef, dependencies, "skip"),
    ]);
    if (previous.exists) {
      if (previous.data().negocioId !== context.businessId || previous.data().fingerprint !== fingerprint) {
        fail(HttpsError, "already-exists", "La solicitud ya fue utilizada con otros datos.");
      }
      return {...previous.data().resultado, sinCambios: true};
    }
    const {order, services} = data;
    assertDiagnosisRevision(order, expected, HttpsError, "orden de trabajo");
    const previousStatus = action === "finalizar" ? "en_reparacion" : "pendiente_entrega";
    if (order.estado !== previousStatus) {
      fail(HttpsError, "failed-precondition", action === "finalizar" ?
        "Solo se puede finalizar una OT en reparación." : "Solo se puede registrar la entrega de una OT pendiente de entrega.");
    }
    if (action === "finalizar") {
      if (!services.length || services.some((service) => service.estado !== "completado")) {
        fail(HttpsError, "failed-precondition", "Completa todos los servicios antes de finalizar la reparación.");
      }
      const approval = await transaction.get(context.businessRef.collection("otApprovalState").doc(otId));
      const approvalData = approval.data() || {};
      if (order.estadoAprobacion !== "aprobada" || !approval.exists ||
          approvalData.negocioId !== context.businessId || approvalData.otId !== otId ||
          approvalData.scopeHash !== scopeFingerprint(services)) {
        fail(HttpsError, "failed-precondition", "La OT no tiene un alcance vigente aprobado.");
      }
    }
    const estado = action === "finalizar" ? "pendiente_entrega" : "cerrada";
    const plazaIdLiberada = action === "entregar" ? order.plazaId || null : null;
    const plazaLockRef = plazaIdLiberada
      ? context.businessRef.collection("plazaOccupancyKeys").doc(plazaIdLiberada)
      : null;
    const plazaLockSnapshot = plazaLockRef ? await transaction.get(plazaLockRef) : null;
    const plazaLock = plazaLockSnapshot?.data() || null;
    const timestamp = FieldValue.serverTimestamp();
    if (plazaLockSnapshot?.exists && plazaLock?.negocioId === context.businessId &&
        plazaLock.plazaId === plazaIdLiberada && plazaLock.otId === otId) {
      transaction.delete(plazaLockRef);
    }
    transaction.update(orderRef, {
      estado,
      ...(action === "entregar" ? {plazaId: null} : {}),
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot, timestamp,
      type: action === "finalizar" ? "reparacion_finalizada" : "vehiculo_entregado",
      detail: {estadoAnterior: previousStatus, estado, plazaIdLiberada},
    });
    const resultado = {otId, estado, estadoAprobacion: order.estadoAprobacion,
      plazaId: action === "entregar" ? null : order.plazaId || null};
    transaction.create(requestRef, {negocioId: context.businessId, otId, fingerprint, resultado, creadoEn: timestamp});
    return resultado;
  });
}

const finalizarReparacionOTHandler = (request, deps) => transitionWorkOrderClosure(request, deps, "finalizar");
const registrarEntregaOTHandler = (request, deps) => transitionWorkOrderClosure(request, deps, "entregar");

async function obtenerEventosCierreOTHandler(request, dependencies) {
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", dependencies.HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  assertStoredWorkOrder(await orderRef.get(), context.businessId, dependencies.HttpsError);
  const snapshot = await orderRef.collection("historial")
    .where("tipo", "in", ["reparacion_finalizada", "vehiculo_entregado"]).get();
  return {eventos: snapshot.docs.map((entry) => {
    const event = entry.data();
    if (event.negocioId !== context.businessId || event.otId !== otId) return null;
    return {eventoId: entry.id, tipo: event.tipo, fecha: event.fecha?.toMillis?.() || null,
      actorNombre: event.actorSnapshot?.nombre || event.actorSnapshot?.correo || "Usuario no disponible"};
  }).filter(Boolean).sort((a, b) => (a.fecha || 0) - (b.fecha || 0))};
}

function freezeCoreItem(snapshot, businessId, itemId, type, HttpsError) {
  assertPlanningItem(snapshot, businessId, itemId, type, HttpsError);
  const item = snapshot.data();
  if (typeof item.precioInterno !== "number" || !Number.isFinite(item.precioInterno) ||
      item.precioInterno < 0 || item.precioInterno > Number.MAX_SAFE_INTEGER) {
    fail(HttpsError, "failed-precondition", "Un ítem no tiene precio de venta vigente válido en Inventario. Revisa el catálogo antes de enviar.");
  }
  const nombre = text(item.nombre || item.descripcionItem, "El nombre del ítem", 240, HttpsError, {required: true});
  return {
    precioUnitario: Math.round(item.precioInterno),
    snapshot: {
      codigoInterno: String(item.codigoInterno || item.sku || ""), nombre,
      unidad: String(item.unidad || "unidad"),
      modeloInventarioVersion: Number(item.modeloInventarioVersion) || null,
    },
  };
}

async function readApprovalContext(transaction, context, orderRef, dependencies, inventoryMode = "required") {
  const {db, HttpsError} = dependencies;
  const [orderSnapshot, serviceSnapshot, diagnoses, business, member] = await Promise.all([
    transaction.get(orderRef), transaction.get(orderRef.collection("servicios")),
    transaction.get(orderRef.collection("diagnosticos").where("estado", "==", "completado")),
    transaction.get(context.businessRef), transaction.get(context.membershipRef),
  ]);
  const membership = member.data() || {};
  if (!member.exists || membership.uid !== context.uid || membership.negocioId !== context.businessId ||
      membership.estado !== "activo" || !TALLER_OPERATION_ROLES.includes(membership.rol)) {
    fail(HttpsError, "permission-denied", "Tu membresía ya no permite operar esta OT.");
  }
  if (membership.profileId) {
    const profile = await transaction.get(context.businessRef.collection("perfilesEmpleados").doc(membership.profileId));
    const data = profile.data() || {};
    if (data.negocioId !== context.businessId || data.estado !== "activo" || !data.modulos?.includes("taller")) {
      fail(HttpsError, "permission-denied", "Tu perfil ya no permite operar Taller.");
    }
  }
  const businessData = business.data() || {};
  if (!business.exists || businessData.estado !== "activo" || businessData.eliminadoEn ||
      normalizeBusinessVerificationState(businessData) !== "VERIFICADA") {
    fail(HttpsError, "failed-precondition", "El negocio no está habilitado para operar.");
  }
  const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
  const services = serviceSnapshot.docs.map((doc) => assertService(doc, context.businessId, orderRef.id, HttpsError));
  if (services.reduce((count, service) => count + 1 + (service.productos?.length || 0), 0) > 200) {
    fail(HttpsError, "failed-precondition", "El alcance supera el límite técnico de 200 líneas por envío.");
  }
  const result = {order, services, membership, businessData,
    hasDiagnosis: diagnoses.docs.some((doc) => doc.data().negocioId === context.businessId && doc.data().otId === orderRef.id)};
  // Reading frozen history must not depend on a later catalog edit or archival.
  if (inventoryMode === "skip" || (inventoryMode === "preview" && approvalIsSubmitted(order))) {
    return {...result, items: new Map(), faltantes: null};
  }
  const ids = new Set();
  services.forEach((service) => {
    ids.add(identifier(service.itemId, "El servicio Core", HttpsError));
    (service.productos || []).forEach((product) => {
      ids.add(identifier(product.itemId, "El producto Core", HttpsError));
      plannedQuantity(product.cantidad, HttpsError);
    });
  });
  const itemSnapshots = await Promise.all([...ids].map((id) => transaction.get(context.businessRef.collection("inventario").doc(id))));
  const items = new Map(itemSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  services.forEach((service) => assertPlanningItem(items.get(service.itemId), context.businessId, service.itemId, "servicio", HttpsError));
  const required = new Map();
  services.forEach((service) => (service.productos || []).forEach((product) =>
    required.set(product.itemId, (required.get(product.itemId) || 0) + product.cantidad)));
  const faltantes = [];
  for (const [itemId, cantidad] of required) {
    const snapshot = items.get(itemId);
    assertPlanningItem(snapshot, context.businessId, itemId, "producto", HttpsError);
    const item = snapshot.data();
    if (typeof item.stock !== "number" || !Number.isFinite(item.stock) || item.stock < 0) {
      fail(HttpsError, "failed-precondition", "Un producto no tiene stock válido en Inventario.");
    }
    if (item.stock < cantidad) faltantes.push({itemId, nombre: String(item.nombre || item.descripcionItem || itemId), cantidad, stock: item.stock});
  }
  // A shared OT write serializes scope changes with approval; all reads precede writes.
  return {...result, items, faltantes};
}

function frozenScope(services) {
  return services.map(({servicioOtId, itemId, responsableUid, precioUnitario, servicioSnapshot, productos}) => ({
    servicioOtId, itemId, responsableUid, precioUnitario: precioUnitario ?? null,
    servicioSnapshot: servicioSnapshot || null, productos: productos || [],
  }));
}

function approvalIsSubmitted(order) {
  return ["esperando_aprobacion", "esperando_repuestos", "en_reparacion", "pendiente_entrega", "cerrada"].includes(order.estado);
}

async function obtenerResumenAprobacionOTHandler(request, dependencies) {
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La OT", dependencies.HttpsError);
  return dependencies.db.runTransaction(async (transaction) => {
    const data = await readApprovalContext(transaction, context, context.businessRef.collection("ordenesTrabajo").doc(otId), dependencies, "preview");
    const {order, services, items, membership, faltantes} = data;
    const submitted = approvalIsSubmitted(order);
    const scope = frozenScope(services).map((service) => {
      if (submitted) return service;
      const core = freezeCoreItem(items.get(service.itemId), context.businessId, service.itemId, "servicio", dependencies.HttpsError);
      return {...service, precioUnitario: core.precioUnitario, servicioSnapshot: core.snapshot,
        productos: service.productos.map((product) => {
          const coreProduct = freezeCoreItem(items.get(product.itemId), context.businessId, product.itemId, "producto", dependencies.HttpsError);
          return {...product, precioUnitario: coreProduct.precioUnitario, productoSnapshot: coreProduct.snapshot};
        })};
    });
    return {alcance: scope, moneda: order.moneda || businessCurrency({businessSnapshot: {data: () => data.businessData}}),
      congelado: submitted, faltantes, puedeAprobar: canApproveWorkOrder(membership),
      puedeEnviar: Boolean(order.recepcion && services.length && data.hasDiagnosis &&
        PLANNING_STATES.has(order.estado) && order.estadoAprobacion !== "aprobada"),
      estado: order.estado, estadoAprobacion: order.estadoAprobacion,
      revision: order.actualizadoEn?.toMillis?.()};
  });
}

async function approvalOperation(request, dependencies, action) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const allowed = new Set(["businessId", "otId", "requestId", "expectedActualizadoEn", "motivo"]);
  if (Object.keys(request?.data || {}).some((key) => !allowed.has(key))) {
    fail(HttpsError, "invalid-argument", "La solicitud contiene campos no permitidos. El alcance y los precios se resuelven en backend.");
  }
  const otId = identifier(request?.data?.otId, "La OT", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const motivo = text(request?.data?.motivo, "El motivo", 2000, HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const stateRef = context.businessRef.collection("otApprovalState").doc(otId);
  const requestRef = context.businessRef.collection("otApprovalRequests").doc(requestId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const fingerprint = createHash("sha256").update(JSON.stringify({otId, action, motivo, actor: context.uid,
    revision: request?.data?.expectedActualizadoEn})).digest("hex");
  return db.runTransaction(async (transaction) => {
    const [previous, approvalState] = await Promise.all([transaction.get(requestRef), transaction.get(stateRef)]);
    const data = await readApprovalContext(transaction, context, orderRef, dependencies, previous.exists ? "skip" : "required");
    const {order, services, items, faltantes, membership} = data;
    if (["aprobar", "rechazar"].includes(action) && !canApproveWorkOrder(membership)) {
      fail(HttpsError, "permission-denied", "No tienes la capacidad de aprobación de Taller.");
    }
    if (previous.exists) {
      if (previous.data().fingerprint !== fingerprint) fail(HttpsError, "already-exists", "La solicitud ya fue utilizada con otros datos.");
      return {...previous.data().resultado, sinCambios: true};
    }
    assertDiagnosisRevision(order, request?.data?.expectedActualizadoEn, HttpsError, "alcance de la OT");
    if (!order.recepcion || !data.hasDiagnosis || !services.length || !PLANNING_STATES.has(order.estado)) {
      fail(HttpsError, "failed-precondition", "La OT requiere recepción, al menos un diagnóstico completado, servicios definidos y un estado compatible.");
    }
    let estado = order.estado;
    let estadoAprobacion = order.estadoAprobacion;
    let moneda = order.moneda;
    let scope = frozenScope(services);
    const scopeHash = scopeFingerprint(services);
    let envioId = approvalState.data()?.envioId || null;
    if (action === "enviar") {
      if (order.estadoAprobacion === "aprobada") fail(HttpsError, "failed-precondition", "El alcance ya está aprobado.");
      moneda = businessCurrency({businessSnapshot: {data: () => data.businessData}});
      if (!moneda) fail(HttpsError, "failed-precondition", "Configura una moneda válida en el negocio antes de enviar.");
      scope = services.map((service) => {
        const core = freezeCoreItem(items.get(service.itemId), context.businessId, service.itemId, "servicio", HttpsError);
        return {...frozenScope([service])[0], precioUnitario: core.precioUnitario, servicioSnapshot: core.snapshot,
          productos: service.productos.map((product) => {
            const coreProduct = freezeCoreItem(items.get(product.itemId), context.businessId, product.itemId, "producto", HttpsError);
            return {...product, precioUnitario: coreProduct.precioUnitario, productoSnapshot: coreProduct.snapshot};
          })};
      });
      estado = faltantes.length ? "esperando_repuestos" : "esperando_aprobacion";
      estadoAprobacion = "pendiente";
      envioId = requestId;
    } else {
      if (!approvalState.exists || approvalState.data().scopeHash !== scopeHash || !approvalIsSubmitted(order)) {
        fail(HttpsError, "failed-precondition", "El alcance cambió. Debes enviarlo nuevamente a aprobación.");
      }
      if (action === "aprobar" || action === "rechazar") {
        if (order.estado !== "esperando_aprobacion" || order.estadoAprobacion !== "pendiente") {
          fail(HttpsError, "failed-precondition", "La OT no está esperando una decisión de aprobación.");
        }
        estadoAprobacion = action === "aprobar" ? "aprobada" : "rechazada";
        if (action === "aprobar") estado = faltantes.length ? "esperando_repuestos" : "en_reparacion";
      } else {
        if (order.estado !== "esperando_repuestos" || order.estadoAprobacion === "rechazada") {
          fail(HttpsError, "failed-precondition", "Esta OT no requiere revalidación de disponibilidad.");
        }
        estado = faltantes.length ? "esperando_repuestos" :
          order.estadoAprobacion === "aprobada" ? "en_reparacion" : "esperando_aprobacion";
      }
    }
    const timestamp = FieldValue.serverTimestamp();
    if (action === "enviar") {
      scope.forEach((service) => transaction.update(orderRef.collection("servicios").doc(service.servicioOtId), {
        precioUnitario: service.precioUnitario, servicioSnapshot: service.servicioSnapshot, productos: service.productos,
        actualizadoEn: timestamp, actualizadoPorUid: context.uid,
      }));
      transaction.set(stateRef, {negocioId: context.businessId, otId, scopeHash, envioId, actualizadoEn: timestamp});
    }
    transaction.update(orderRef, {estado, estadoAprobacion, moneda, actualizadoEn: timestamp, actualizadoPorUid: context.uid});
    const type = {enviar: "ot_enviada_aprobacion", aprobar: "ot_aprobada", rechazar: "ot_rechazada", revalidar: "disponibilidad_revalidada"}[action];
    appendPlanningEvent(transaction, orderRef, {businessId: context.businessId, actorUid: context.uid, actorSnapshot, timestamp,
      type, detail: {envioId, moneda, alcance: scope, motivo, faltantes,
        estadoAnterior: order.estado, estado, aprobacionAnterior: order.estadoAprobacion, estadoAprobacion}});
    const resultado = {otId, estado, estadoAprobacion, faltantes, envioId};
    transaction.create(requestRef, {negocioId: context.businessId, otId, fingerprint, resultado, creadoEn: timestamp});
    return resultado;
  });
}

const enviarOTAprobacionHandler = (request, deps) => approvalOperation(request, deps, "enviar");
const aprobarOTHandler = (request, deps) => approvalOperation(request, deps, "aprobar");
const rechazarOTHandler = (request, deps) => approvalOperation(request, deps, "rechazar");
const revalidarDisponibilidadOTHandler = (request, deps) => approvalOperation(request, deps, "revalidar");

module.exports = {
  appendPlanningEvent,
  diagnosisActor,
  identifier,
  readApprovalContext,
  requestIdentifier,
  requireReceptionAccess,
  iniciarServicioOTHandler, completarServicioOTHandler,
  finalizarReparacionOTHandler, registrarEntregaOTHandler, obtenerEventosCierreOTHandler,
  enviarOTAprobacionHandler, aprobarOTHandler, rechazarOTHandler, revalidarDisponibilidadOTHandler,
  obtenerResumenAprobacionOTHandler, scopeFingerprint, canApproveWorkOrder, freezeCoreItem,
  actualizarProductoOTHandler,
  actualizarServicioOTHandler,
  agregarProductoOTHandler,
  actualizarDiagnosticoHandler,
  completarDiagnosticoHandler,
  crearOrdenTrabajoHandler,
  crearServicioOTHandler,
  eliminarServicioOTHandler,
  eliminarProductoOTHandler,
  listarCatalogoTallerHandler,
  formatWorkOrderNumber,
  hasReceptionAnomaly,
  listarPersonasAsignablesTallerHandler,
  normalizeDiagnosisInput,
  normalizeWorkOrderInput,
  normalizeReceptionInput,
  normalizeServiceInput,
  plannedQuantity,
  profileIdentityName,
  receptionNextStatus,
  registrarRecepcionOrdenTrabajoHandler,
  registrarDiagnosticoHandler,
};
