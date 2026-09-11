"use strict";

const {createHash} = require("node:crypto");
const {TALLER_MANAGEMENT_ROLES} = require("./rbac");

const VEHICLE_TYPES = Object.freeze([
  "sedan",
  "hatchback",
  "suv",
  "pickup",
  "station_wagon",
  "furgon",
  "van",
  "coupe",
  "convertible",
  "otro",
]);
const VEHICLE_TYPE_SET = new Set(VEHICLE_TYPES);
const PLATE_PATTERNS = Object.freeze([
  /^[A-Z]{4}\d{2}$/,
  /^[A-Z]{3}\d{2}$/,
  /^[A-Z]{5}\d$/,
  /^[A-Z]{4}\d$/,
]);
const TEXT_ONLY_PATTERN = /^\p{L}(?:[\p{L}\s.'-]*\p{L})?$/u;
const VEHICLE_INPUT_FIELDS = new Set([
  "clienteId",
  "patente",
  "vin",
  "marca",
  "modelo",
  "anio",
  "color",
  "tipo",
]);
const VEHICLE_DETAILS_FIELDS = new Set([
  "patente",
  "vin",
  "marca",
  "modelo",
  "anio",
  "color",
  "tipo",
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

function normalizeVehicleKey(value, label, maxLength, HttpsError, optional) {
  const raw = text(value, label, maxLength, HttpsError, {required: !optional});
  if (!raw && optional) return null;
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) {
    fail(HttpsError, "invalid-argument", `${label} no es válido.`);
  }
  return normalized;
}

function normalizeVehiclePlate(value, HttpsError) {
  const raw = text(value, "La patente", 30, HttpsError, {required: true});
  if (!/^[A-Za-z0-9\s-]+$/.test(raw)) {
    fail(HttpsError, "invalid-argument", "La patente no tiene un formato válido.");
  }
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!PLATE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    fail(
      HttpsError,
      "invalid-argument",
      "La patente debe usar un formato válido, sin guiones."
    );
  }
  return normalized;
}

function textOnly(value, label, maxLength, HttpsError) {
  const normalized = text(value, label, maxLength, HttpsError, {required: true});
  if (!TEXT_ONLY_PATTERN.test(normalized)) {
    fail(HttpsError, "invalid-argument", `${label} solo puede contener texto.`);
  }
  return normalized;
}

function normalizeVehicleInput(raw, HttpsError, {includeOwner = true} = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(
      HttpsError,
      "invalid-argument",
      "Los datos del vehículo deben enviarse como un objeto."
    );
  }
  const allowedFields = includeOwner ? VEHICLE_INPUT_FIELDS : VEHICLE_DETAILS_FIELDS;
  const unknownField = Object.keys(raw).find(
    (field) => !allowedFields.has(field)
  );
  if (unknownField) {
    fail(
      HttpsError,
      "invalid-argument",
      `El campo de vehículo ${unknownField} no está admitido.`
    );
  }

  const anio = raw.anio;
  if (!Number.isSafeInteger(anio) || anio < 1 || anio > 9999) {
    fail(HttpsError, "invalid-argument", "El año debe ser un número entero válido.");
  }
  const tipo = text(raw.tipo, "El tipo", 40, HttpsError, {required: true})
    .toLowerCase();
  if (!VEHICLE_TYPE_SET.has(tipo)) {
    fail(HttpsError, "invalid-argument", "Selecciona un tipo de vehículo válido.");
  }

  return {
    ...(includeOwner ? {
      clienteId: identifier(raw.clienteId, "El cliente", HttpsError),
    } : {}),
    patente: normalizeVehiclePlate(raw.patente, HttpsError),
    vin: normalizeVehicleKey(raw.vin, "El VIN", 80, HttpsError, true),
    marca: textOnly(raw.marca, "La marca", 120, HttpsError),
    modelo: text(raw.modelo, "El modelo", 120, HttpsError, {required: true}),
    anio,
    color: textOnly(raw.color, "El color", 80, HttpsError),
    tipo,
  };
}

function validateVehicleId(value, HttpsError) {
  return identifier(value, "El vehículo", HttpsError);
}

function assertClient(snapshot, businessId, clienteId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "not-found", "No se encontró el cliente.");
  }
  const stored = snapshot.data() || {};
  if (
    stored.negocioId !== businessId ||
    stored.clienteId !== clienteId ||
    snapshot.id !== clienteId
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "El cliente no pertenece al negocio seleccionado."
    );
  }
  return stored;
}

function assertVehicle(snapshot, businessId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "not-found", "No se encontró el vehículo.");
  }
  const stored = snapshot.data() || {};
  if (stored.negocioId !== businessId) {
    fail(HttpsError, "permission-denied", "El vehículo no pertenece al negocio.");
  }
  if (stored.vehiculoId !== snapshot.id) {
    fail(
      HttpsError,
      "failed-precondition",
      "El vehículo tiene una identidad inconsistente."
    );
  }
  return stored;
}

function assertReservation(
  snapshot,
  {businessId, vehiculoId, field, value},
  HttpsError
) {
  const stored = snapshot.data() || {};
  if (
    !snapshot.exists ||
    stored.negocioId !== businessId ||
    stored.vehiculoId !== vehiculoId ||
    stored[field] !== value
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      `La reserva de ${field === "patente" ? "patente" : "VIN"} es inconsistente.`
    );
  }
}

function duplicateIdentifier(field, HttpsError) {
  fail(
    HttpsError,
    "already-exists",
    field === "patente"
      ? "Ya existe un vehículo con esta patente en el negocio."
      : "Ya existe un vehículo con este VIN en el negocio."
  );
}

function signature(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function vehicleResponse(vehiculoId, businessId, normalized) {
  return {vehiculoId, negocioId: businessId, ...normalized};
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

async function crearVehiculoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireManagementAccess(request, dependencies);
  const normalized = normalizeVehicleInput(
    request?.data?.vehiculo,
    HttpsError
  );
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const inputSignature = signature(normalized);
  const vehicleRef = context.businessRef.collection("vehiculos").doc();
  const clientRef = context.businessRef
    .collection("clientes")
    .doc(normalized.clienteId);
  const plateRef = context.businessRef
    .collection("vehiclePlateKeys")
    .doc(normalized.patente);
  const vinRef = normalized.vin
    ? context.businessRef.collection("vehicleVinKeys").doc(normalized.vin)
    : null;
  const requestRef = context.businessRef
    .collection("vehicleCreateRequests")
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
          .collection("vehiculos")
          .doc(storedRequest.vehiculoId)
      );
      return {
        stored: assertVehicle(existingSnapshot, context.businessId, HttpsError),
        sinCambios: true,
      };
    }

    const refs = [clientRef, plateRef, ...(vinRef ? [vinRef] : [])];
    const snapshots = await transaction.getAll(...refs);
    assertClient(snapshots[0], context.businessId, normalized.clienteId, HttpsError);
    if (snapshots[1].exists) duplicateIdentifier("patente", HttpsError);
    if (vinRef && snapshots[2].exists) duplicateIdentifier("vin", HttpsError);

    const timestamp = FieldValue.serverTimestamp();
    const stored = {
      vehiculoId: vehicleRef.id,
      negocioId: context.businessId,
      ...normalized,
      creadoPorUid: context.uid,
      creadoEn: timestamp,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    };
    transaction.create(vehicleRef, stored);
    transaction.create(plateRef, {
      negocioId: context.businessId,
      vehiculoId: vehicleRef.id,
      patente: normalized.patente,
    });
    if (vinRef) {
      transaction.create(vinRef, {
        negocioId: context.businessId,
        vehiculoId: vehicleRef.id,
        vin: normalized.vin,
      });
    }
    transaction.create(requestRef, {
      requestId,
      negocioId: context.businessId,
      vehiculoId: vehicleRef.id,
      inputSignature,
      creadoPorUid: context.uid,
      creadoEn: timestamp,
    });
    return {stored, sinCambios: false};
  });

  return {
    vehiculo: result.sinCambios
      ? result.stored
      : vehicleResponse(vehicleRef.id, context.businessId, normalized),
    sinCambios: result.sinCambios,
  };
}

async function actualizarVehiculoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireManagementAccess(request, dependencies);
  const vehiculoId = validateVehicleId(request?.data?.vehiculoId, HttpsError);
  const normalized = normalizeVehicleInput(
    request?.data?.vehiculo,
    HttpsError,
    {includeOwner: false}
  );
  const vehicleRef = context.businessRef.collection("vehiculos").doc(vehiculoId);

  const result = await db.runTransaction(async (transaction) => {
    const vehicleSnapshot = await transaction.get(vehicleRef);
    const stored = assertVehicle(vehicleSnapshot, context.businessId, HttpsError);
    const previousPlate = normalizeVehicleKey(
      stored.patente,
      "La patente almacenada",
      30,
      HttpsError,
      false
    );
    const previousVin = normalizeVehicleKey(
      stored.vin,
      "El VIN almacenado",
      80,
      HttpsError,
      true
    );
    const previousPlateRef = context.businessRef
      .collection("vehiclePlateKeys")
      .doc(previousPlate);
    const previousVinRef = previousVin
      ? context.businessRef.collection("vehicleVinKeys").doc(previousVin)
      : null;
    const nextPlateRef = context.businessRef
      .collection("vehiclePlateKeys")
      .doc(normalized.patente);
    const nextVinRef = normalized.vin
      ? context.businessRef.collection("vehicleVinKeys").doc(normalized.vin)
      : null;

    const refs = [
      previousPlateRef,
      ...(previousVinRef ? [previousVinRef] : []),
      ...(normalized.patente !== previousPlate ? [nextPlateRef] : []),
      ...(normalized.vin && normalized.vin !== previousVin ? [nextVinRef] : []),
    ];
    const snapshots = await transaction.getAll(...refs);
    let snapshotIndex = 0;
    assertReservation(
      snapshots[snapshotIndex++],
      {
        businessId: context.businessId,
        vehiculoId,
        field: "patente",
        value: previousPlate,
      },
      HttpsError
    );
    if (previousVinRef) {
      assertReservation(
        snapshots[snapshotIndex++],
        {
          businessId: context.businessId,
          vehiculoId,
          field: "vin",
          value: previousVin,
        },
        HttpsError
      );
    }
    if (normalized.patente !== previousPlate && snapshots[snapshotIndex++].exists) {
      duplicateIdentifier("patente", HttpsError);
    }
    if (
      normalized.vin &&
      normalized.vin !== previousVin &&
      snapshots[snapshotIndex++].exists
    ) {
      duplicateIdentifier("vin", HttpsError);
    }

    const timestamp = FieldValue.serverTimestamp();
    transaction.update(vehicleRef, {
      ...normalized,
      vehiculoId,
      negocioId: context.businessId,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    if (normalized.patente !== previousPlate) {
      transaction.create(nextPlateRef, {
        negocioId: context.businessId,
        vehiculoId,
        patente: normalized.patente,
      });
      transaction.delete(previousPlateRef);
    }
    if (normalized.vin !== previousVin) {
      if (nextVinRef) {
        transaction.create(nextVinRef, {
          negocioId: context.businessId,
          vehiculoId,
          vin: normalized.vin,
        });
      }
      if (previousVinRef) transaction.delete(previousVinRef);
    }
    return stored.clienteId;
  });

  return {
    vehiculo: vehicleResponse(vehiculoId, context.businessId, {
      clienteId: result,
      ...normalized,
    }),
  };
}

async function cambiarPropietarioVehiculoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireManagementAccess(request, dependencies);
  const vehiculoId = validateVehicleId(request?.data?.vehiculoId, HttpsError);
  const clienteId = identifier(request?.data?.clienteId, "El cliente", HttpsError);
  const vehicleRef = context.businessRef.collection("vehiculos").doc(vehiculoId);
  const clientRef = context.businessRef.collection("clientes").doc(clienteId);

  const result = await db.runTransaction(async (transaction) => {
    const [vehicleSnapshot, clientSnapshot] = await transaction.getAll(
      vehicleRef,
      clientRef
    );
    const stored = assertVehicle(vehicleSnapshot, context.businessId, HttpsError);
    assertClient(clientSnapshot, context.businessId, clienteId, HttpsError);
    if (stored.clienteId === clienteId) {
      return {stored, sinCambios: true};
    }
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(vehicleRef, {
      clienteId,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    return {stored: {...stored, clienteId}, sinCambios: false};
  });

  return {
    vehiculo: {
      ...result.stored,
      vehiculoId,
      negocioId: context.businessId,
      clienteId,
    },
    sinCambios: result.sinCambios,
  };
}

module.exports = {
  VEHICLE_TYPES,
  actualizarVehiculoHandler,
  cambiarPropietarioVehiculoHandler,
  crearVehiculoHandler,
  normalizeVehicleInput,
  normalizeVehicleKey,
  normalizeVehiclePlate,
  validateVehicleId,
};
