const businessCatalog = require("./businessCatalog.json");
const {
  adaptStoredFiscalIdentifier,
  buildFiscalIdentifier,
  formatChileanRut,
  getFiscalIdentifierLabel,
  getFiscalReservationKey,
  isValidChileanRut,
  isValidFiscalIdentifier,
  normalizeChileanRut,
  normalizeCountryCode,
} = require("./fiscalIdentifier");

const CLIENT_MODEL_VERSION = 2;
const CLIENT_TYPES = new Set(["persona", "empresa"]);
const ACTIVE_STATUS = "activo";
const ARCHIVED_STATUS = "archivado";
const AUTHORIZED_ROLES = ["OWNER", "ADMIN"];
const CLIENT_INPUT_FIELDS = new Set([
  "tipoCliente",
  "rut",
  "paisCodigo",
  "identificadorFiscalTipo",
  "identificadorFiscalValor",
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
  paisCodigo: "país",
  identificadorFiscalTipo: "tipo de identificación fiscal",
  identificadorFiscalValor: "identificación fiscal",
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

function getClientRutKey(value) {
  return isValidChileanRut(value) ? getFiscalReservationKey("CL", value) : "";
}

function fail(HttpsError, code, message, details = undefined) {
  throw new HttpsError(code, message, details);
}

function normalizeTerritory(raw, HttpsError, countryCode = "CL") {
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

  if (normalizeCountryCode(countryCode) !== "CL") {
    return {
      regionCodigo,
      regionNombre: normalizeTextField(raw, "regionNombre", 160, HttpsError),
      comunaCodigo,
      comunaNombre: normalizeTextField(raw, "comunaNombre", 160, HttpsError),
    };
  }

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

function normalizeClientInput(raw = {}, HttpsError, authoritativeCountry = "CL") {
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
  const countryCode = normalizeCountryCode(authoritativeCountry);
  const fiscalValue = normalizeTextField(
    {identificadorFiscalValor: raw.identificadorFiscalValor || raw.rut},
    "identificadorFiscalValor",
    80,
    HttpsError
  );
  const fiscal = buildFiscalIdentifier(countryCode, fiscalValue);
  const nombreRazonSocial = normalizeTextField(
    raw,
    "nombreRazonSocial",
    240,
    HttpsError
  );
  const email = normalizeTextField(raw, "email", 240, HttpsError).toLowerCase();
  const territory = normalizeTerritory(raw, HttpsError, countryCode);

  if (!CLIENT_TYPES.has(tipoCliente)) {
    fail(
      HttpsError,
      "invalid-argument",
      "Selecciona si el cliente es persona o empresa."
    );
  }
  if (!isValidFiscalIdentifier(countryCode, fiscalValue)) {
    fail(HttpsError, "invalid-argument", `Ingresa un ${getFiscalIdentifierLabel(countryCode)} válido.`);
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
    ...fiscal,
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
  {clienteId, businessId, fiscal},
  HttpsError
) {
  const reservation = reservationSnapshot.data() || {};
  const reservationNormalized = reservation.identificadorFiscalNormalizado ||
    normalizeChileanRut(reservation.rutNormalizado || "").replace("-", "");
  if (
    !reservationSnapshot.exists ||
    reservation.clienteId !== clienteId ||
    reservation.negocioId !== businessId ||
    reservationNormalized !== fiscal.identificadorFiscalNormalizado
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "La reserva de identificación fiscal del cliente es inconsistente."
    );
  }
}

function duplicateFiscalError(reservation, HttpsError) {
  if (reservation?.estadoCliente === ARCHIVED_STATUS) {
    fail(
      HttpsError,
      "failed-precondition",
      "Ya existe un cliente archivado con esta identificación fiscal. Debes reactivarlo."
    );
  }
  fail(
    HttpsError,
    "already-exists",
    "Ya existe un cliente con esta identificación fiscal en el negocio."
  );
}

function reservationPayload({
  businessId,
  clienteId,
  fiscal,
  estadoCliente,
  uid,
  timestamp,
  created = false,
}) {
  return {
    negocioId: businessId,
    clienteId,
    paisCodigo: fiscal.paisCodigo,
    identificadorFiscalTipo: fiscal.identificadorFiscalTipo,
    identificadorFiscalNormalizado: fiscal.identificadorFiscalNormalizado,
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
  const countryCode = normalizeCountryCode(context.businessSnapshot.data()?.paisCodigo);
  const normalized = normalizeClientInput(request?.data?.cliente || {}, HttpsError, countryCode);
  const fiscalKey = getFiscalReservationKey(countryCode, normalized.identificadorFiscalNormalizado);
  const clienteRef = context.businessRef.collection("clientes").doc();
  const reservationRef = context.businessRef
    .collection("clientRutKeys")
    .doc(fiscalKey);

  await db.runTransaction(async (transaction) => {
    const reservationSnapshot = await transaction.get(reservationRef);
    if (reservationSnapshot.exists) {
      duplicateFiscalError(reservationSnapshot.data(), HttpsError);
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
        fiscal: normalized,
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
  const countryCode = normalizeCountryCode(context.businessSnapshot.data()?.paisCodigo);
  const normalized = normalizeClientInput(request?.data?.cliente || {}, HttpsError, countryCode);
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

    const previousFiscal = adaptStoredFiscalIdentifier(stored, countryCode);
    const previousRutKey = getFiscalReservationKey(previousFiscal.paisCodigo, previousFiscal.identificadorFiscalNormalizado);
    const nextRutKey = getFiscalReservationKey(countryCode, normalized.identificadorFiscalNormalizado);
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
        fiscal: previousFiscal,
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
        duplicateFiscalError(nextReservationSnapshot.data(), HttpsError);
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
          fiscal: normalized,
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
    const fiscal = adaptStoredFiscalIdentifier(stored, context.businessSnapshot.data()?.paisCodigo);
    const rutKey = getFiscalReservationKey(fiscal.paisCodigo, fiscal.identificadorFiscalNormalizado);
    const reservationRef = context.businessRef
      .collection("clientRutKeys")
      .doc(rutKey);
    const reservationSnapshot = await transaction.get(reservationRef);
    assertReservationOwner(
      reservationSnapshot,
      {clienteId, businessId: context.businessId, fiscal},
      HttpsError
    );
    if (stored.estado === ARCHIVED_STATUS) {
      if (reservationSnapshot.data()?.estadoCliente !== ARCHIVED_STATUS) {
        fail(
          HttpsError,
          "failed-precondition",
          "El estado de la reserva fiscal es inconsistente."
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
    const fiscal = adaptStoredFiscalIdentifier(stored, context.businessSnapshot.data()?.paisCodigo);
    const rutKey = getFiscalReservationKey(fiscal.paisCodigo, fiscal.identificadorFiscalNormalizado);
    const reservationRef = context.businessRef
      .collection("clientRutKeys")
      .doc(rutKey);
    const reservationSnapshot = await transaction.get(reservationRef);
    assertReservationOwner(
      reservationSnapshot,
      {clienteId, businessId: context.businessId, fiscal},
      HttpsError
    );
    if (stored.estado === ACTIVE_STATUS) {
      if (reservationSnapshot.data()?.estadoCliente !== ACTIVE_STATUS) {
        fail(
          HttpsError,
          "failed-precondition",
          "El estado de la reserva fiscal es inconsistente."
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
