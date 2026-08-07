const {createHash} = require("node:crypto");
const businessCatalog = require("./businessCatalog.json");

const PROVIDER_MODEL_VERSION = 1;
const ACTIVE_STATUS = "activo";
const ARCHIVED_STATUS = "archivado";
const AUTHORIZED_ROLES = ["OWNER", "ADMIN"];
const PAYMENT_TERMS = new Set(["contado", "transferencia", "credito", "otro"]);
const PROVIDER_INPUT_FIELDS = new Set([
  "rut",
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
  razonSocial: [240, "razón social"],
  nombreFantasia: [240, "nombre de fantasía"],
  giro: [240, "giro"],
  personaContacto: [200, "persona de contacto"],
  email: [240, "correo"],
  telefono: [100, "teléfono"],
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
  return `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${match[2]}`;
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

function getProviderRutKey(value) {
  const normalized = normalizeChileanRut(value);
  return isValidChileanRut(normalized) ? normalized.replace("-", "") : "";
}

function normalizeTerritory(raw, HttpsError) {
  const regionCodigo = normalizeTextField(raw, "regionCodigo", HttpsError);
  const comunaCodigo = normalizeTextField(raw, "comunaCodigo", HttpsError);
  normalizeTextField(raw, "regionNombre", HttpsError);
  normalizeTextField(raw, "comunaNombre", HttpsError);

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

function normalizeProviderInput(raw = {}, HttpsError) {
  const input = editableProviderInput(raw, HttpsError);
  const rutNormalizado = normalizeChileanRut(
    normalizeTextField(input, "rut", HttpsError)
  );
  const razonSocial = normalizeTextField(input, "razonSocial", HttpsError);
  const email = normalizeTextField(input, "email", HttpsError).toLowerCase();
  const telefono = normalizeTextField(input, "telefono", HttpsError);
  const condicionesPago = normalizeTextField(
    input,
    "condicionesPago",
    HttpsError
  ).toLowerCase();

  if (!isValidChileanRut(rutNormalizado)) {
    fail(HttpsError, "invalid-argument", "Ingresa un RUT chileno válido.");
  }
  if (!razonSocial) {
    fail(HttpsError, "invalid-argument", "Ingresa la razón social.");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(HttpsError, "invalid-argument", "Ingresa un correo válido.");
  }
  if (telefono) {
    const digitCount = telefono.replace(/\D/g, "").length;
    if (!/^[+\d\s().-]+$/.test(telefono) || digitCount < 6 || digitCount > 15) {
      fail(HttpsError, "invalid-argument", "Ingresa un teléfono válido.");
    }
  }
  if (condicionesPago && !PAYMENT_TERMS.has(condicionesPago)) {
    fail(HttpsError, "invalid-argument", "Selecciona una condición de pago válida.");
  }

  return {
    modeloProveedorVersion: PROVIDER_MODEL_VERSION,
    rut: formatChileanRut(rutNormalizado),
    rutNormalizado,
    razonSocial,
    nombreFantasia: normalizeTextField(input, "nombreFantasia", HttpsError),
    giro: normalizeTextField(input, "giro", HttpsError),
    personaContacto: normalizeTextField(input, "personaContacto", HttpsError),
    email,
    telefono,
    direccion: normalizeTextField(input, "direccion", HttpsError),
    ...normalizeTerritory(input, HttpsError),
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
  {proveedorId, businessId, rutNormalizado},
  HttpsError
) {
  const reservation = reservationSnapshot.data() || {};
  if (
    !reservationSnapshot.exists ||
    reservation.proveedorId !== proveedorId ||
    reservation.negocioId !== businessId ||
    reservation.rutNormalizado !== rutNormalizado
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "La reserva del RUT del proveedor es inconsistente."
    );
  }
}

function duplicateRutError(reservation, HttpsError) {
  if (reservation?.estadoProveedor === ARCHIVED_STATUS) {
    fail(
      HttpsError,
      "failed-precondition",
      "Ya existe un proveedor archivado con este RUT. Debes reactivarlo."
    );
  }
  fail(
    HttpsError,
    "already-exists",
    "Ya existe un proveedor con este RUT en el negocio."
  );
}

function reservationPayload({
  businessId,
  proveedorId,
  rutNormalizado,
  estadoProveedor,
  uid,
  timestamp,
  created = false,
}) {
  return {
    negocioId: businessId,
    proveedorId,
    rutNormalizado,
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
  const normalized = normalizeProviderInput(
    request?.data?.proveedor || {},
    HttpsError
  );
  const requestId = validateRequestId(request?.data?.requestId, HttpsError);
  const signature = inputSignature(normalized);
  const proveedorRef = context.businessRef.collection("proveedores").doc();
  const reservationRef = context.businessRef
    .collection("providerRutKeys")
    .doc(getProviderRutKey(normalized.rutNormalizado));
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
      duplicateRutError(reservationSnapshot.data(), HttpsError);
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
        rutNormalizado: normalized.rutNormalizado,
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
  const normalized = normalizeProviderInput(
    request?.data?.proveedor || {},
    HttpsError
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

    const previousRut = normalizeChileanRut(stored.rutNormalizado || stored.rut);
    const previousRutKey = getProviderRutKey(previousRut);
    if (!previousRutKey) {
      fail(
        HttpsError,
        "failed-precondition",
        "El RUT almacenado del proveedor es inválido."
      );
    }
    const nextRutKey = getProviderRutKey(normalized.rutNormalizado);
    const previousReservationRef = context.businessRef
      .collection("providerRutKeys")
      .doc(previousRutKey);
    const previousReservationSnapshot = await transaction.get(
      previousReservationRef
    );
    assertReservationOwner(
      previousReservationSnapshot,
      {proveedorId, businessId: context.businessId, rutNormalizado: previousRut},
      HttpsError
    );
    if (previousReservationSnapshot.data()?.estadoProveedor !== stored.estado) {
      fail(
        HttpsError,
        "failed-precondition",
        "El estado de la reserva del RUT es inconsistente."
      );
    }

    let nextReservationRef = previousReservationRef;
    if (nextRutKey !== previousRutKey) {
      nextReservationRef = context.businessRef
        .collection("providerRutKeys")
        .doc(nextRutKey);
      const nextReservationSnapshot = await transaction.get(nextReservationRef);
      if (nextReservationSnapshot.exists) {
        duplicateRutError(nextReservationSnapshot.data(), HttpsError);
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
          rutNormalizado: normalized.rutNormalizado,
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
    const rutNormalizado = normalizeChileanRut(stored.rutNormalizado || stored.rut);
    if (!getProviderRutKey(rutNormalizado)) {
      fail(
        HttpsError,
        "failed-precondition",
        "El RUT almacenado del proveedor es inválido."
      );
    }
    const reservationRef = context.businessRef
      .collection("providerRutKeys")
      .doc(getProviderRutKey(rutNormalizado));
    const reservationSnapshot = await transaction.get(reservationRef);
    assertReservationOwner(
      reservationSnapshot,
      {proveedorId, businessId: context.businessId, rutNormalizado},
      HttpsError
    );
    if (reservationSnapshot.data()?.estadoProveedor !== stored.estado) {
      fail(
        HttpsError,
        "failed-precondition",
        "El estado de la reserva del RUT es inconsistente."
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
