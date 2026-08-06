const businessCatalog = require("./businessCatalog.json");

const CLIENT_MODEL_VERSION = 1;
const CLIENT_TYPES = new Set(["persona", "empresa"]);
const ACTIVE_STATUS = "activo";
const ARCHIVED_STATUS = "archivado";
const AUTHORIZED_ROLES = ["OWNER", "ADMIN"];
const CLIENT_INPUT_FIELDS = new Set([
  "tipoCliente",
  "rut",
  "nombreRazonSocial",
  "giro",
  "email",
  "telefono",
  "direccion",
  "regionCodigo",
  "regionNombre",
  "comunaCodigo",
  "comunaNombre",
  "personaContacto",
  "notas",
]);
const CLIENT_FIELD_LABELS = {
  tipoCliente: "tipo de cliente",
  rut: "RUT",
  nombreRazonSocial: "nombre o razón social",
  giro: "giro",
  email: "correo",
  telefono: "teléfono",
  direccion: "dirección",
  regionCodigo: "código de región",
  regionNombre: "región",
  comunaCodigo: "código de comuna",
  comunaNombre: "comuna",
  personaContacto: "persona de contacto",
  notas: "notas",
};
const REGIONS_BY_CODE = new Map(
  businessCatalog.regions.map((region) => [region.code, region])
);

function normalizeTextField(raw, field, maxLength, HttpsError) {
  const value = raw?.[field];
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    fail(
      HttpsError,
      "invalid-argument",
      `El campo ${CLIENT_FIELD_LABELS[field]} debe ser texto.`
    );
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength) {
    fail(
      HttpsError,
      "invalid-argument",
      `El campo ${CLIENT_FIELD_LABELS[field]} no puede superar ${maxLength} caracteres.`
    );
  }
  return normalized;
}

function normalizeChileanRut(value) {
  const compact = String(value ?? "")
    .toUpperCase()
    .replace(/[^0-9K]/g, "");
  if (compact.length < 2) return compact;
  return `${compact.slice(0, -1)}-${compact.slice(-1)}`;
}

function formatChileanRut(value) {
  const normalized = normalizeChileanRut(value);
  const match = /^(\d+)-([\dK])$/.exec(normalized);
  if (!match) return normalized;
  const formattedBody = match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formattedBody}-${match[2]}`;
}

function isValidChileanRut(value) {
  const normalized = normalizeChileanRut(value);
  if (!/^\d{7,8}-[\dK]$/.test(normalized)) return false;

  const [body, suppliedDigit] = normalized.split("-");
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expectedDigit =
    remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return suppliedDigit === expectedDigit;
}

function getClientRutKey(value) {
  const normalized = normalizeChileanRut(value);
  return isValidChileanRut(normalized) ? normalized.replace("-", "") : "";
}

function fail(HttpsError, code, message, details = undefined) {
  throw new HttpsError(code, message, details);
}

function normalizeTerritory(raw, HttpsError) {
  const regionCodigo = normalizeTextField(
    raw,
    "regionCodigo",
    20,
    HttpsError
  );
  const comunaCodigo = normalizeTextField(
    raw,
    "comunaCodigo",
    20,
    HttpsError
  );

  // Los nombres se validan como texto, pero nunca son autoritativos.
  normalizeTextField(raw, "regionNombre", 160, HttpsError);
  normalizeTextField(raw, "comunaNombre", 160, HttpsError);

  if (!regionCodigo) {
    if (comunaCodigo) {
      fail(
        HttpsError,
        "invalid-argument",
        "Selecciona una región válida para la comuna."
      );
    }
    return {
      regionCodigo: "",
      regionNombre: "",
      comunaCodigo: "",
      comunaNombre: "",
    };
  }

  const region = REGIONS_BY_CODE.get(regionCodigo);
  if (!region) {
    fail(HttpsError, "invalid-argument", "Selecciona una región válida.");
  }

  if (!comunaCodigo) {
    return {
      regionCodigo: region.code,
      regionNombre: region.name,
      comunaCodigo: "",
      comunaNombre: "",
    };
  }

  const commune = region.communes.find((item) => item.code === comunaCodigo);
  if (!commune) {
    fail(
      HttpsError,
      "invalid-argument",
      "Selecciona una comuna que pertenezca a la región indicada."
    );
  }

  return {
    regionCodigo: region.code,
    regionNombre: region.name,
    comunaCodigo: commune.code,
    comunaNombre: commune.name,
  };
}

function normalizeClientInput(raw = {}, HttpsError) {
  if (raw == null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    fail(
      HttpsError,
      "invalid-argument",
      "Los datos del cliente deben enviarse como un objeto."
    );
  }
  const unknownFields = Object.keys(raw).filter(
    (field) => !CLIENT_INPUT_FIELDS.has(field)
  );
  if (unknownFields.length > 0) {
    fail(
      HttpsError,
      "invalid-argument",
      `El campo de cliente ${unknownFields[0]} no está admitido.`
    );
  }

  const tipoCliente = normalizeTextField(
    raw,
    "tipoCliente",
    20,
    HttpsError
  ).toLowerCase();
  const rutNormalizado = normalizeChileanRut(
    normalizeTextField(raw, "rut", 20, HttpsError)
  );
  const nombreRazonSocial = normalizeTextField(
    raw,
    "nombreRazonSocial",
    240,
    HttpsError
  );
  const email = normalizeTextField(raw, "email", 240, HttpsError).toLowerCase();
  const territory = normalizeTerritory(raw, HttpsError);

  if (!CLIENT_TYPES.has(tipoCliente)) {
    fail(
      HttpsError,
      "invalid-argument",
      "Selecciona si el cliente es persona o empresa."
    );
  }
  if (!isValidChileanRut(rutNormalizado)) {
    fail(HttpsError, "invalid-argument", "Ingresa un RUT chileno válido.");
  }
  if (!nombreRazonSocial) {
    fail(HttpsError, "invalid-argument", "Ingresa el nombre o razón social.");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(HttpsError, "invalid-argument", "Ingresa un correo válido.");
  }

  return {
    modeloClienteVersion: CLIENT_MODEL_VERSION,
    tipoCliente,
    rut: formatChileanRut(rutNormalizado),
    rutNormalizado,
    nombreRazonSocial,
    giro: normalizeTextField(raw, "giro", 240, HttpsError),
    email,
    telefono: normalizeTextField(raw, "telefono", 100, HttpsError),
    direccion: normalizeTextField(raw, "direccion", 300, HttpsError),
    ...territory,
    personaContacto: normalizeTextField(
      raw,
      "personaContacto",
      200,
      HttpsError
    ),
    notas: normalizeTextField(raw, "notas", 4000, HttpsError),
  };
}

function validateClienteId(value, HttpsError) {
  if (typeof value !== "string") {
    fail(HttpsError, "invalid-argument", "Selecciona un cliente válido.");
  }
  const clienteId = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(clienteId)) {
    fail(HttpsError, "invalid-argument", "Selecciona un cliente válido.");
  }
  return clienteId;
}

function assertStoredClient(snapshot, businessId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "not-found", "No se encontró el cliente.");
  }
  const stored = snapshot.data() || {};
  if (stored.negocioId !== businessId) {
    fail(HttpsError, "permission-denied", "El cliente no pertenece al negocio.");
  }
  return stored;
}

function assertReservationOwner(
  reservationSnapshot,
  {clienteId, businessId, rutNormalizado},
  HttpsError
) {
  const reservation = reservationSnapshot.data() || {};
  if (
    !reservationSnapshot.exists ||
    reservation.clienteId !== clienteId ||
    reservation.negocioId !== businessId ||
    reservation.rutNormalizado !== rutNormalizado
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "La reserva del RUT del cliente es inconsistente."
    );
  }
}

function duplicateRutError(reservation, HttpsError) {
  if (reservation?.estadoCliente === ARCHIVED_STATUS) {
    fail(
      HttpsError,
      "failed-precondition",
      "Ya existe un cliente archivado con este RUT. Debes reactivarlo."
    );
  }
  fail(
    HttpsError,
    "already-exists",
    "Ya existe un cliente con este RUT en el negocio."
  );
}

function reservationPayload({
  businessId,
  clienteId,
  rutNormalizado,
  estadoCliente,
  uid,
  timestamp,
  created = false,
}) {
  return {
    negocioId: businessId,
    clienteId,
    rutNormalizado,
    estadoCliente,
    actualizadoPorUid: uid,
    actualizadoEn: timestamp,
    ...(created ? { creadoPorUid: uid, creadoEn: timestamp } : {}),
  };
}

function clientResponse(clienteId, businessId, normalized, estado) {
  return {
    clienteId,
    negocioId: businessId,
    ...normalized,
    estado,
  };
}

async function crearClienteHandler(
  request,
  {db, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: AUTHORIZED_ROLES}
  );
  const normalized = normalizeClientInput(request?.data?.cliente || {}, HttpsError);
  const rutKey = getClientRutKey(normalized.rutNormalizado);
  const clienteRef = context.businessRef.collection("clientes").doc();
  const reservationRef = context.businessRef
    .collection("clientRutKeys")
    .doc(rutKey);

  await db.runTransaction(async (transaction) => {
    const reservationSnapshot = await transaction.get(reservationRef);
    if (reservationSnapshot.exists) {
      duplicateRutError(reservationSnapshot.data(), HttpsError);
    }

    const timestamp = FieldValue.serverTimestamp();
    transaction.set(clienteRef, {
      clienteId: clienteRef.id,
      negocioId: context.businessId,
      ...normalized,
      estado: ACTIVE_STATUS,
      creadoPorUid: context.uid,
      actualizadoPorUid: context.uid,
      creadoEn: timestamp,
      actualizadoEn: timestamp,
      archivadoEn: null,
    });
    transaction.set(
      reservationRef,
      reservationPayload({
        businessId: context.businessId,
        clienteId: clienteRef.id,
        rutNormalizado: normalized.rutNormalizado,
        estadoCliente: ACTIVE_STATUS,
        uid: context.uid,
        timestamp,
        created: true,
      })
    );
  });

  return {
    cliente: clientResponse(
      clienteRef.id,
      context.businessId,
      normalized,
      ACTIVE_STATUS
    ),
  };
}

async function actualizarClienteHandler(
  request,
  {db, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: AUTHORIZED_ROLES}
  );
  const clienteId = validateClienteId(request?.data?.clienteId, HttpsError);
  const normalized = normalizeClientInput(request?.data?.cliente || {}, HttpsError);
  const clienteRef = context.businessRef.collection("clientes").doc(clienteId);

  await db.runTransaction(async (transaction) => {
    const clientSnapshot = await transaction.get(clienteRef);
    const stored = assertStoredClient(clientSnapshot, context.businessId, HttpsError);
    if (stored.estado !== ACTIVE_STATUS) {
      fail(
        HttpsError,
        "failed-precondition",
        "Debes reactivar el cliente antes de editarlo."
      );
    }

    const previousRutKey = getClientRutKey(stored.rutNormalizado || stored.rut);
    const nextRutKey = getClientRutKey(normalized.rutNormalizado);
    const previousReservationRef = context.businessRef
      .collection("clientRutKeys")
      .doc(previousRutKey);
    const previousReservationSnapshot = await transaction.get(
      previousReservationRef
    );
    assertReservationOwner(
      previousReservationSnapshot,
      {
        clienteId,
        businessId: context.businessId,
        rutNormalizado: normalizeChileanRut(stored.rutNormalizado || stored.rut),
      },
      HttpsError
    );

    let nextReservationRef = previousReservationRef;
    if (nextRutKey !== previousRutKey) {
      nextReservationRef = context.businessRef
        .collection("clientRutKeys")
        .doc(nextRutKey);
      const nextReservationSnapshot = await transaction.get(nextReservationRef);
      if (nextReservationSnapshot.exists) {
        duplicateRutError(nextReservationSnapshot.data(), HttpsError);
      }
    }

    const timestamp = FieldValue.serverTimestamp();
    transaction.update(clienteRef, {
      ...normalized,
      negocioId: context.businessId,
      clienteId,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });

    if (nextRutKey !== previousRutKey) {
      transaction.set(
        nextReservationRef,
        reservationPayload({
          businessId: context.businessId,
          clienteId,
          rutNormalizado: normalized.rutNormalizado,
          estadoCliente: ACTIVE_STATUS,
          uid: context.uid,
          timestamp,
          created: true,
        })
      );
      transaction.delete(previousReservationRef);
    } else {
      transaction.update(previousReservationRef, {
        estadoCliente: ACTIVE_STATUS,
        actualizadoPorUid: context.uid,
        actualizadoEn: timestamp,
      });
    }
  });

  return {
    cliente: clientResponse(
      clienteId,
      context.businessId,
      normalized,
      ACTIVE_STATUS
    ),
  };
}

async function archivarClienteHandler(
  request,
  {db, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: AUTHORIZED_ROLES}
  );
  const clienteId = validateClienteId(request?.data?.clienteId, HttpsError);
  const clienteRef = context.businessRef.collection("clientes").doc(clienteId);

  const result = await db.runTransaction(async (transaction) => {
    const clientSnapshot = await transaction.get(clienteRef);
    const stored = assertStoredClient(clientSnapshot, context.businessId, HttpsError);
    const rutNormalizado = normalizeChileanRut(stored.rutNormalizado || stored.rut);
    const rutKey = getClientRutKey(rutNormalizado);
    const reservationRef = context.businessRef
      .collection("clientRutKeys")
      .doc(rutKey);
    const reservationSnapshot = await transaction.get(reservationRef);
    assertReservationOwner(
      reservationSnapshot,
      {clienteId, businessId: context.businessId, rutNormalizado},
      HttpsError
    );
    if (stored.estado === ARCHIVED_STATUS) {
      if (reservationSnapshot.data()?.estadoCliente !== ARCHIVED_STATUS) {
        fail(
          HttpsError,
          "failed-precondition",
          "El estado de la reserva del RUT es inconsistente."
        );
      }
      return {sinCambios: true};
    }
    if (stored.estado !== ACTIVE_STATUS) {
      fail(HttpsError, "failed-precondition", "El estado del cliente es inválido.");
    }

    const timestamp = FieldValue.serverTimestamp();
    transaction.update(clienteRef, {
      estado: ARCHIVED_STATUS,
      archivadoEn: timestamp,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    transaction.update(reservationRef, {
      estadoCliente: ARCHIVED_STATUS,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    return {sinCambios: false};
  });

  return {clienteId, estado: ARCHIVED_STATUS, sinCambios: result.sinCambios};
}

async function reactivarClienteHandler(
  request,
  {db, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: AUTHORIZED_ROLES}
  );
  const clienteId = validateClienteId(request?.data?.clienteId, HttpsError);
  const clienteRef = context.businessRef.collection("clientes").doc(clienteId);

  const result = await db.runTransaction(async (transaction) => {
    const clientSnapshot = await transaction.get(clienteRef);
    const stored = assertStoredClient(clientSnapshot, context.businessId, HttpsError);
    const rutNormalizado = normalizeChileanRut(stored.rutNormalizado || stored.rut);
    const rutKey = getClientRutKey(rutNormalizado);
    const reservationRef = context.businessRef
      .collection("clientRutKeys")
      .doc(rutKey);
    const reservationSnapshot = await transaction.get(reservationRef);
    assertReservationOwner(
      reservationSnapshot,
      {clienteId, businessId: context.businessId, rutNormalizado},
      HttpsError
    );
    if (stored.estado === ACTIVE_STATUS) {
      if (reservationSnapshot.data()?.estadoCliente !== ACTIVE_STATUS) {
        fail(
          HttpsError,
          "failed-precondition",
          "El estado de la reserva del RUT es inconsistente."
        );
      }
      return {sinCambios: true};
    }
    if (stored.estado !== ARCHIVED_STATUS) {
      fail(HttpsError, "failed-precondition", "El estado del cliente es inválido.");
    }

    const timestamp = FieldValue.serverTimestamp();
    transaction.update(clienteRef, {
      estado: ACTIVE_STATUS,
      archivadoEn: null,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    transaction.update(reservationRef, {
      estadoCliente: ACTIVE_STATUS,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    return {sinCambios: false};
  });

  return {clienteId, estado: ACTIVE_STATUS, sinCambios: result.sinCambios};
}

module.exports = {
  CLIENT_MODEL_VERSION,
  actualizarClienteHandler,
  archivarClienteHandler,
  crearClienteHandler,
  formatChileanRut,
  getClientRutKey,
  isValidChileanRut,
  normalizeChileanRut,
  normalizeClientInput,
  reactivarClienteHandler,
};
