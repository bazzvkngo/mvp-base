"use strict";

const {createHash} = require("node:crypto");
const {
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

async function crearOrdenTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireManagementAccess(request, dependencies);
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

module.exports = {
  crearOrdenTrabajoHandler,
  formatWorkOrderNumber,
  hasReceptionAnomaly,
  normalizeWorkOrderInput,
  normalizeReceptionInput,
  receptionNextStatus,
  registrarRecepcionOrdenTrabajoHandler,
};
