const {createHash} = require("node:crypto");
const businessCatalog = require("./businessCatalog.json");
const {
  MAX_CONTACT_PHONE_LENGTH,
  getContactPhoneError,
  normalizeContactPhone,
} = require("./contactFormatting");
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

const PROVIDER_MODEL_VERSION = 2;
const ACTIVE_STATUS = "activo";
const ARCHIVED_STATUS = "archivado";
const {PURCHASE_WRITE_ROLES: AUTHORIZED_ROLES} = require("./rbac");
const PAYMENT_TERMS = new Set(["contado", "transferencia", "credito", "otro"]);
const PROVIDER_INPUT_FIELDS = new Set([
  "rut",
  "paisCodigo",
  "identificadorFiscalTipo",
  "identificadorFiscalValor",
  "razonSocial",
  "nombreFantasia",
  "giro",
  "personaContacto",
  "email",
  "telefono",
  "direccion",
  "regionCodigo",
  "regionNombre",
  "comunaCodigo",
  "comunaNombre",
  "condicionesPago",
  "diasCredito",
  "notas",
]);
const AUTHORITATIVE_FIELDS = new Set([
  "modeloProveedorVersion",
  "proveedorId",
  "negocioId",
  "rutNormalizado",
  "identificadorFiscalNormalizado",
  "estado",
  "creadoPorUid",
  "actualizadoPorUid",
  "creadoEn",
  "actualizadoEn",
  "archivadoEn",
  "createdAt",
  "updatedAt",
]);
const FIELD_CONFIG = {
  rut: [20, "RUT"],
  paisCodigo: [10, "país"],
  identificadorFiscalTipo: [40, "tipo de identificación fiscal"],
  identificadorFiscalValor: [80, "identificación fiscal"],
  razonSocial: [240, "razón social"],
  nombreFantasia: [240, "nombre de fantasía"],
  giro: [240, "giro"],
  personaContacto: [200, "persona de contacto"],
  email: [240, "correo"],
  telefono: [MAX_CONTACT_PHONE_LENGTH, "teléfono"],
  direccion: [300, "dirección"],
  regionCodigo: [20, "código de región"],
  regionNombre: [160, "región"],
  comunaCodigo: [20, "código de comuna"],
  comunaNombre: [160, "comuna"],
  condicionesPago: [40, "condición de pago"],
  notas: [4000, "notas"],
};
const REGIONS_BY_CODE = new Map(
  businessCatalog.regions.map((region) => [region.code, region])
);

function fail(HttpsError, code, message, details = undefined) {
  throw new HttpsError(code, message, details);
}

function editableProviderInput(raw, HttpsError) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    fail(
      HttpsError,
      "invalid-argument",
      "Los datos del proveedor deben enviarse como un objeto."
    );
  }
  const unknownFields = Object.keys(raw).filter(
    (field) => !PROVIDER_INPUT_FIELDS.has(field) && !AUTHORITATIVE_FIELDS.has(field)
  );
  if (unknownFields.length > 0) {
    fail(
      HttpsError,
      "invalid-argument",
      `El campo de proveedor ${unknownFields[0]} no está admitido.`
    );
  }
  return Object.fromEntries(
    Object.entries(raw).filter(([field]) => PROVIDER_INPUT_FIELDS.has(field))
  );
}

function normalizeTextField(raw, field, HttpsError) {
  const [maxLength, label] = FIELD_CONFIG[field];
  const value = raw?.[field];
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    fail(HttpsError, "invalid-argument", `El campo ${label} debe ser texto.`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength) {
    fail(
      HttpsError,
      "invalid-argument",
      `El campo ${label} no puede superar ${maxLength} caracteres.`
    );
  }
  return normalized;
}

function getProviderRutKey(value) {
  return isValidChileanRut(value) ? getFiscalReservationKey("CL", value) : "";
}

function normalizeTerritory(raw, HttpsError, countryCode = "CL") {
  const regionCodigo = normalizeTextField(raw, "regionCodigo", HttpsError);
  const comunaCodigo = normalizeTextField(raw, "comunaCodigo", HttpsError);
  normalizeTextField(raw, "regionNombre", HttpsError);
  normalizeTextField(raw, "comunaNombre", HttpsError);

  if (normalizeCountryCode(countryCode) !== "CL") {
    return {
      regionCodigo,
      regionNombre: normalizeTextField(raw, "regionNombre", HttpsError),
      comunaCodigo,
      comunaNombre: normalizeTextField(raw, "comunaNombre", HttpsError),
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

function normalizeCreditDays(value, HttpsError) {
  if (value == null || value === "") return 0;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(number) || number < 0) {
    fail(
      HttpsError,
      "invalid-argument",
      "Ingresa días de crédito como un entero mayor o igual a 0."
    );
  }
  return number;
}

function normalizeProviderInput(raw = {}, HttpsError, authoritativeCountry = "CL") {
  const input = editableProviderInput(raw, HttpsError);
  const countryCode = normalizeCountryCode(authoritativeCountry);
  const fiscalValue = normalizeTextField(
    {...input, identificadorFiscalValor: input.identificadorFiscalValor || input.rut},
    "identificadorFiscalValor",
    HttpsError
  );
  const fiscal = buildFiscalIdentifier(countryCode, fiscalValue);
  const razonSocial = normalizeTextField(input, "razonSocial", HttpsError);
  const email = normalizeTextField(input, "email", HttpsError).toLowerCase();
  const telefono = normalizeTextField(input, "telefono", HttpsError);
  const condicionesPago = normalizeTextField(
    input,
    "condicionesPago",
    HttpsError
  ).toLowerCase();

  if (!isValidFiscalIdentifier(countryCode, fiscalValue)) {
    fail(HttpsError, "invalid-argument", `Ingresa un ${getFiscalIdentifierLabel(countryCode)} válido.`);
  }
  if (!razonSocial) {
    fail(HttpsError, "invalid-argument", "Ingresa la razón social.");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(HttpsError, "invalid-argument", "Ingresa un correo válido.");
  }
  const phoneError = getContactPhoneError(telefono, countryCode);
  if (phoneError) fail(HttpsError, "invalid-argument", phoneError);
  if (condicionesPago && !PAYMENT_TERMS.has(condicionesPago)) {
    fail(HttpsError, "invalid-argument", "Selecciona una condición de pago válida.");
  }

  return {
    modeloProveedorVersion: PROVIDER_MODEL_VERSION,
    ...fiscal,
    razonSocial,
    nombreFantasia: normalizeTextField(input, "nombreFantasia", HttpsError),
    giro: normalizeTextField(input, "giro", HttpsError),
    personaContacto: normalizeTextField(input, "personaContacto", HttpsError),
    email,
    telefono: normalizeContactPhone(telefono, countryCode),
    direccion: normalizeTextField(input, "direccion", HttpsError),
    ...normalizeTerritory(input, HttpsError, countryCode),
    condicionesPago,
    diasCredito: normalizeCreditDays(input.diasCredito, HttpsError),
    notas: normalizeTextField(input, "notas", HttpsError),
  };
}

function validateProviderId(value, HttpsError) {
  if (typeof value !== "string") {
    fail(HttpsError, "invalid-argument", "Selecciona un proveedor válido.");
  }
  const proveedorId = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(proveedorId)) {
    fail(HttpsError, "invalid-argument", "Selecciona un proveedor válido.");
  }
  return proveedorId;
}

function validateRequestId(value, HttpsError) {
  if (typeof value !== "string") {
    fail(HttpsError, "invalid-argument", "La solicitud de creación no es válida.");
  }
  const requestId = value.trim();
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) {
    fail(HttpsError, "invalid-argument", "La solicitud de creación no es válida.");
  }
  return requestId;
}

function assertStoredProvider(snapshot, businessId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "not-found", "No se encontró el proveedor.");
  }
  const stored = snapshot.data() || {};
  if (stored.negocioId !== businessId) {
    fail(HttpsError, "permission-denied", "El proveedor no pertenece al negocio.");
  }
  if (stored.proveedorId !== snapshot.id) {
    fail(HttpsError, "failed-precondition", "El proveedor tiene una identidad inconsistente.");
  }
  return stored;
}

function assertReservationOwner(
  reservationSnapshot,
  {proveedorId, businessId, fiscal},
  HttpsError
) {
  const reservation = reservationSnapshot.data() || {};
  const reservationNormalized = reservation.identificadorFiscalNormalizado ||
    normalizeChileanRut(reservation.rutNormalizado || "").replace("-", "");
  if (
    !reservationSnapshot.exists ||
    reservation.proveedorId !== proveedorId ||
    reservation.negocioId !== businessId ||
    reservationNormalized !== fiscal.identificadorFiscalNormalizado
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "La reserva de identificación fiscal del proveedor es inconsistente."
    );
  }
}

function duplicateFiscalError(reservation, HttpsError) {
  if (reservation?.estadoProveedor === ARCHIVED_STATUS) {
    fail(
      HttpsError,
      "failed-precondition",
      "Ya existe un proveedor archivado con esta identificación fiscal. Debes reactivarlo."
    );
  }
  fail(
    HttpsError,
    "already-exists",
    "Ya existe un proveedor con esta identificación fiscal en el negocio."
  );
}

function reservationPayload({
  businessId,
  proveedorId,
  fiscal,
  estadoProveedor,
  uid,
  timestamp,
  created = false,
}) {
  return {
    negocioId: businessId,
    proveedorId,
    paisCodigo: fiscal.paisCodigo,
    identificadorFiscalTipo: fiscal.identificadorFiscalTipo,
    identificadorFiscalNormalizado: fiscal.identificadorFiscalNormalizado,
    estadoProveedor,
    actualizadoPorUid: uid,
    actualizadoEn: timestamp,
    ...(created ? {creadoPorUid: uid, creadoEn: timestamp} : {}),
  };
}

function providerResponse(proveedorId, businessId, normalized, estado) {
  return {
    proveedorId,
    negocioId: businessId,
    ...normalized,
    estado,
  };
}

function inputSignature(normalized) {
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function crearProveedorHandler(
  request,
  {db, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: AUTHORIZED_ROLES}
  );
  const countryCode = normalizeCountryCode(context.businessSnapshot.data()?.paisCodigo);
  const normalized = normalizeProviderInput(
    request?.data?.proveedor || {},
    HttpsError,
    countryCode
  );
  const requestId = validateRequestId(request?.data?.requestId, HttpsError);
  const signature = inputSignature(normalized);
  const proveedorRef = context.businessRef.collection("proveedores").doc();
  const reservationRef = context.businessRef
    .collection("providerRutKeys")
    .doc(getFiscalReservationKey(countryCode, normalized.identificadorFiscalNormalizado));
  const requestRef = context.businessRef
    .collection("providerCreateRequests")
    .doc(requestId);

  const result = await db.runTransaction(async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists) {
      const storedRequest = requestSnapshot.data() || {};
      if (
        storedRequest.negocioId !== context.businessId ||
        storedRequest.creadoPorUid !== context.uid ||
        storedRequest.inputSignature !== signature
      ) {
        fail(
          HttpsError,
          "already-exists",
          "La solicitud de creación ya fue utilizada con otros datos."
        );
      }
      const existingRef = context.businessRef
        .collection("proveedores")
        .doc(storedRequest.proveedorId);
      const existingSnapshot = await transaction.get(existingRef);
      const stored = assertStoredProvider(
        existingSnapshot,
        context.businessId,
        HttpsError
      );
      return {proveedorId: existingSnapshot.id, stored, sinCambios: true};
    }

    const reservationSnapshot = await transaction.get(reservationRef);
    if (reservationSnapshot.exists) {
      duplicateFiscalError(reservationSnapshot.data(), HttpsError);
    }

    const timestamp = FieldValue.serverTimestamp();
    const stored = {
      proveedorId: proveedorRef.id,
      negocioId: context.businessId,
      ...normalized,
      estado: ACTIVE_STATUS,
      creadoPorUid: context.uid,
      actualizadoPorUid: context.uid,
      creadoEn: timestamp,
      actualizadoEn: timestamp,
      archivadoEn: null,
    };
    transaction.set(proveedorRef, stored);
    transaction.set(
      reservationRef,
      reservationPayload({
        businessId: context.businessId,
        proveedorId: proveedorRef.id,
        fiscal: normalized,
        estadoProveedor: ACTIVE_STATUS,
        uid: context.uid,
        timestamp,
        created: true,
      })
    );
    transaction.set(requestRef, {
      requestId,
      negocioId: context.businessId,
      proveedorId: proveedorRef.id,
      inputSignature: signature,
      creadoPorUid: context.uid,
      creadoEn: timestamp,
    });
    return {proveedorId: proveedorRef.id, stored, sinCambios: false};
  });

  return {
    proveedor: result.sinCambios
      ? result.stored
      : providerResponse(
        result.proveedorId,
        context.businessId,
        normalized,
        ACTIVE_STATUS
      ),
    sinCambios: result.sinCambios,
  };
}

async function actualizarProveedorHandler(
  request,
  {db, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: AUTHORIZED_ROLES}
  );
  const proveedorId = validateProviderId(request?.data?.proveedorId, HttpsError);
  const countryCode = normalizeCountryCode(context.businessSnapshot.data()?.paisCodigo);
  const normalized = normalizeProviderInput(
    request?.data?.proveedor || {},
    HttpsError,
    countryCode
  );
  const proveedorRef = context.businessRef
    .collection("proveedores")
    .doc(proveedorId);

  await db.runTransaction(async (transaction) => {
    const providerSnapshot = await transaction.get(proveedorRef);
    const stored = assertStoredProvider(
      providerSnapshot,
      context.businessId,
      HttpsError
    );
    if (stored.estado !== ACTIVE_STATUS) {
      fail(
        HttpsError,
        "failed-precondition",
        "Debes reactivar el proveedor antes de editarlo."
      );
    }

    const previousFiscal = adaptStoredFiscalIdentifier(stored, countryCode);
    const previousRutKey = getFiscalReservationKey(previousFiscal.paisCodigo, previousFiscal.identificadorFiscalNormalizado);
    if (!previousRutKey) {
      fail(
        HttpsError,
        "failed-precondition",
        "La identificación fiscal almacenada del proveedor es inválida."
      );
    }
    const nextRutKey = getFiscalReservationKey(countryCode, normalized.identificadorFiscalNormalizado);
    const previousReservationRef = context.businessRef
      .collection("providerRutKeys")
      .doc(previousRutKey);
    const previousReservationSnapshot = await transaction.get(
      previousReservationRef
    );
    assertReservationOwner(
      previousReservationSnapshot,
      {proveedorId, businessId: context.businessId, fiscal: previousFiscal},
      HttpsError
    );
    if (previousReservationSnapshot.data()?.estadoProveedor !== stored.estado) {
      fail(
        HttpsError,
        "failed-precondition",
        "El estado de la reserva fiscal es inconsistente."
      );
    }

    let nextReservationRef = previousReservationRef;
    if (nextRutKey !== previousRutKey) {
      nextReservationRef = context.businessRef
        .collection("providerRutKeys")
        .doc(nextRutKey);
      const nextReservationSnapshot = await transaction.get(nextReservationRef);
      if (nextReservationSnapshot.exists) {
        duplicateFiscalError(nextReservationSnapshot.data(), HttpsError);
      }
    }

    const timestamp = FieldValue.serverTimestamp();
    transaction.update(proveedorRef, {
      ...normalized,
      proveedorId,
      negocioId: context.businessId,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    if (nextRutKey === previousRutKey) {
      transaction.update(previousReservationRef, {
        estadoProveedor: ACTIVE_STATUS,
        actualizadoPorUid: context.uid,
        actualizadoEn: timestamp,
      });
    } else {
      transaction.set(
        nextReservationRef,
        reservationPayload({
          businessId: context.businessId,
          proveedorId,
          fiscal: normalized,
          estadoProveedor: ACTIVE_STATUS,
          uid: context.uid,
          timestamp,
          created: true,
        })
      );
      transaction.delete(previousReservationRef);
    }
  });

  return {
    proveedor: providerResponse(
      proveedorId,
      context.businessId,
      normalized,
      ACTIVE_STATUS
    ),
  };
}

async function changeProviderStatus(
  request,
  dependencies,
  {fromStatus, toStatus}
) {
  const {db, HttpsError, FieldValue, requireBusinessAccess} = dependencies;
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: AUTHORIZED_ROLES}
  );
  const proveedorId = validateProviderId(request?.data?.proveedorId, HttpsError);
  const proveedorRef = context.businessRef
    .collection("proveedores")
    .doc(proveedorId);

  const result = await db.runTransaction(async (transaction) => {
    const providerSnapshot = await transaction.get(proveedorRef);
    const stored = assertStoredProvider(
      providerSnapshot,
      context.businessId,
      HttpsError
    );
    const fiscal = adaptStoredFiscalIdentifier(stored, context.businessSnapshot.data()?.paisCodigo);
    const reservationKey = getFiscalReservationKey(fiscal.paisCodigo, fiscal.identificadorFiscalNormalizado);
    if (!reservationKey) {
      fail(
        HttpsError,
        "failed-precondition",
        "La identificación fiscal almacenada del proveedor es inválida."
      );
    }
    const reservationRef = context.businessRef
      .collection("providerRutKeys")
      .doc(reservationKey);
    const reservationSnapshot = await transaction.get(reservationRef);
    assertReservationOwner(
      reservationSnapshot,
      {proveedorId, businessId: context.businessId, fiscal},
      HttpsError
    );
    if (reservationSnapshot.data()?.estadoProveedor !== stored.estado) {
      fail(
        HttpsError,
        "failed-precondition",
        "El estado de la reserva fiscal es inconsistente."
      );
    }

    if (stored.estado === toStatus) {
      return {sinCambios: true};
    }
    if (stored.estado !== fromStatus) {
      fail(HttpsError, "failed-precondition", "El estado del proveedor es inválido.");
    }

    const timestamp = FieldValue.serverTimestamp();
    transaction.update(proveedorRef, {
      estado: toStatus,
      archivadoEn: toStatus === ARCHIVED_STATUS ? timestamp : null,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    transaction.update(reservationRef, {
      estadoProveedor: toStatus,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    return {sinCambios: false};
  });

  return {proveedorId, estado: toStatus, sinCambios: result.sinCambios};
}

async function archivarProveedorHandler(request, dependencies) {
  return changeProviderStatus(request, dependencies, {
    fromStatus: ACTIVE_STATUS,
    toStatus: ARCHIVED_STATUS,
  });
}

async function reactivarProveedorHandler(request, dependencies) {
  return changeProviderStatus(request, dependencies, {
    fromStatus: ARCHIVED_STATUS,
    toStatus: ACTIVE_STATUS,
  });
}

module.exports = {
  PROVIDER_MODEL_VERSION,
  actualizarProveedorHandler,
  archivarProveedorHandler,
  crearProveedorHandler,
  formatChileanRut,
  getProviderRutKey,
  isValidChileanRut,
  normalizeChileanRut,
  normalizeProviderInput,
  reactivarProveedorHandler,
};
