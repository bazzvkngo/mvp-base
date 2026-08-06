export const CLIENT_MODEL_VERSION = 1;

export const CLIENT_TYPES = Object.freeze(["persona", "empresa"]);
export const CLIENT_STATUSES = Object.freeze(["activo", "archivado"]);

const CLIENT_TYPE_SET = new Set(CLIENT_TYPES);
const CLIENT_STATUS_SET = new Set(CLIENT_STATUSES);
const CLIENT_TEXT_FIELDS = Object.freeze({
  tipoCliente: {maxLength: 20, label: "tipo de cliente"},
  rut: {maxLength: 20, label: "RUT"},
  nombreRazonSocial: {maxLength: 240, label: "nombre o razón social"},
  giro: {maxLength: 240, label: "giro"},
  email: {maxLength: 240, label: "correo"},
  telefono: {maxLength: 100, label: "teléfono"},
  direccion: {maxLength: 300, label: "dirección"},
  regionCodigo: {maxLength: 20, label: "código de región"},
  regionNombre: {maxLength: 160, label: "región"},
  comunaCodigo: {maxLength: 20, label: "código de comuna"},
  comunaNombre: {maxLength: 160, label: "comuna"},
  personaContacto: {maxLength: 200, label: "persona de contacto"},
  notas: {maxLength: 4000, label: "notas"},
});

export function normalizeClientText(
  value,
  maxLength = 240,
  fieldLabel = "texto"
) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    const error = new Error(`El campo ${fieldLabel} debe ser texto.`);
    error.code = "client/invalid-data";
    throw error;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength) {
    const error = new Error(
      `El campo ${fieldLabel} no puede superar ${maxLength} caracteres.`
    );
    error.code = "client/invalid-data";
    throw error;
  }
  return normalized;
}

export function normalizeChileanRut(value) {
  const compact = String(value ?? "")
    .toUpperCase()
    .replace(/[^0-9K]/g, "");
  if (compact.length < 2) return compact;
  return `${compact.slice(0, -1)}-${compact.slice(-1)}`;
}

export function formatChileanRut(value) {
  const normalized = normalizeChileanRut(value);
  const match = /^(\d+)-([\dK])$/.exec(normalized);
  if (!match) return normalized;
  const formattedBody = match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formattedBody}-${match[2]}`;
}

export function isValidChileanRut(value) {
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

export function getClientRutKey(value) {
  const normalized = normalizeChileanRut(value);
  return isValidChileanRut(normalized) ? normalized.replace("-", "") : "";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function getClientFieldErrors(raw = {}) {
  const errors = {};
  const normalized = {};

  Object.entries(CLIENT_TEXT_FIELDS).forEach(
    ([field, {maxLength, label}]) => {
      try {
        normalized[field] = normalizeClientText(
          raw?.[field],
          maxLength,
          label
        );
      } catch (error) {
        errors[field] = error.message;
        normalized[field] = "";
      }
    }
  );

  const tipoCliente = normalized.tipoCliente.toLowerCase();
  const rut = normalizeChileanRut(normalized.rut);
  const nombreRazonSocial = normalized.nombreRazonSocial;
  const email = normalized.email.toLowerCase();

  if (!errors.tipoCliente && !CLIENT_TYPE_SET.has(tipoCliente)) {
    errors.tipoCliente = "Selecciona si el cliente es persona o empresa.";
  }
  if (!errors.rut && !rut) {
    errors.rut = "Ingresa el RUT del cliente.";
  } else if (!errors.rut && !isValidChileanRut(rut)) {
    errors.rut = "Ingresa un RUT chileno válido.";
  }
  if (!errors.nombreRazonSocial && !nombreRazonSocial) {
    errors.nombreRazonSocial = "Ingresa el nombre o razón social.";
  }
  if (!errors.email && email && !isValidEmail(email)) {
    errors.email = "Ingresa un correo válido.";
  }

  return errors;
}

export function normalizeClientInput(raw = {}) {
  const errors = getClientFieldErrors(raw);
  if (Object.keys(errors).length > 0) {
    const error = new Error(Object.values(errors)[0]);
    error.code = "client/invalid-data";
    error.fieldErrors = errors;
    throw error;
  }

  const rutNormalizado = normalizeChileanRut(
    normalizeClientText(raw.rut, 20, "RUT")
  );
  return {
    modeloClienteVersion: CLIENT_MODEL_VERSION,
    tipoCliente: normalizeClientText(
      raw.tipoCliente,
      20,
      "tipo de cliente"
    ).toLowerCase(),
    rut: formatChileanRut(rutNormalizado),
    rutNormalizado,
    nombreRazonSocial: normalizeClientText(
      raw.nombreRazonSocial,
      240,
      "nombre o razón social"
    ),
    giro: normalizeClientText(raw.giro, 240, "giro"),
    email: normalizeClientText(raw.email, 240, "correo").toLowerCase(),
    telefono: normalizeClientText(raw.telefono, 100, "teléfono"),
    direccion: normalizeClientText(raw.direccion, 300, "dirección"),
    regionCodigo: normalizeClientText(
      raw.regionCodigo,
      20,
      "código de región"
    ),
    regionNombre: normalizeClientText(raw.regionNombre, 160, "región"),
    comunaCodigo: normalizeClientText(
      raw.comunaCodigo,
      20,
      "código de comuna"
    ),
    comunaNombre: normalizeClientText(raw.comunaNombre, 160, "comuna"),
    personaContacto: normalizeClientText(
      raw.personaContacto,
      200,
      "persona de contacto"
    ),
    notas: normalizeClientText(raw.notas, 4000, "notas"),
  };
}

export function buildClientMutationPayload(raw = {}) {
  const normalized = normalizeClientInput(raw);
  return {
    tipoCliente: normalized.tipoCliente,
    rut: normalized.rut,
    nombreRazonSocial: normalized.nombreRazonSocial,
    giro: normalized.giro,
    email: normalized.email,
    telefono: normalized.telefono,
    direccion: normalized.direccion,
    regionCodigo: normalized.regionCodigo,
    regionNombre: normalized.regionNombre,
    comunaCodigo: normalized.comunaCodigo,
    comunaNombre: normalized.comunaNombre,
    personaContacto: normalized.personaContacto,
    notas: normalized.notas,
  };
}

export function adaptStoredClient(raw = {}) {
  const { clientId: legacyClientId, ...stored } = raw;
  const clienteId = normalizeClientText(
    raw.clienteId || raw.id || legacyClientId,
    160
  );
  const status = normalizeClientText(raw.estado, 20).toLowerCase();
  return {
    ...stored,
    ...normalizeClientInput(raw),
    clienteId,
    estado: CLIENT_STATUS_SET.has(status) ? status : "activo",
  };
}

function normalizeSearchText(value) {
  const safeValue = typeof value === "string" ? value : "";
  return safeValue
    .slice(0, 500)
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL");
}

export function matchesClientSearch(client, search) {
  const query = normalizeSearchText(search).replace(/[^a-z0-9k]/g, "");
  if (!query) return true;
  const searchable = normalizeSearchText(
    `${client?.nombreRazonSocial || ""} ${client?.rut || ""} ${
      client?.rutNormalizado || ""
    }`
  ).replace(/[^a-z0-9k]/g, "");
  return searchable.includes(query);
}

export function filterSelectableClients(clients, businessId, search = "") {
  if (!Array.isArray(clients) || typeof businessId !== "string") return [];
  const normalizedBusinessId = businessId.trim();
  if (!normalizedBusinessId) return [];
  return clients.filter(
    (client) =>
      client?.negocioId === normalizedBusinessId &&
      client?.estado === "activo" &&
      matchesClientSearch(client, search)
  );
}
