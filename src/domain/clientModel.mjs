import {
  adaptStoredFiscalIdentifier,
  buildFiscalIdentifier,
  formatChileanRut,
  getFiscalIdentifierLabel,
  isValidChileanRut,
  isValidFiscalIdentifier,
  normalizeChileanRut,
  normalizeCountryCode,
} from "./fiscalIdentifier.mjs";

export const CLIENT_MODEL_VERSION = 2;
export {formatChileanRut, isValidChileanRut, normalizeChileanRut};

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

export function getClientRutKey(value) {
  const normalized = normalizeChileanRut(value);
  return isValidChileanRut(normalized) ? normalized.replace("-", "") : "";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function getClientFieldErrors(raw = {}, countryCode = raw?.paisCodigo || "CL") {
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
  const country = normalizeCountryCode(countryCode);
  const fiscalValue = raw?.identificadorFiscalValor || normalized.rut;
  const nombreRazonSocial = normalized.nombreRazonSocial;
  const email = normalized.email.toLowerCase();

  if (!errors.tipoCliente && !CLIENT_TYPE_SET.has(tipoCliente)) {
    errors.tipoCliente = "Selecciona si el cliente es persona o empresa.";
  }
  if (!errors.rut && !fiscalValue) {
    errors.rut = `Ingresa el ${getFiscalIdentifierLabel(country)} del cliente.`;
  } else if (!errors.rut && !isValidFiscalIdentifier(country, fiscalValue)) {
    errors.rut = `Ingresa un ${getFiscalIdentifierLabel(country)} válido.`;
  }
  if (!errors.nombreRazonSocial && !nombreRazonSocial) {
    errors.nombreRazonSocial = "Ingresa el nombre o razón social.";
  }
  if (!errors.email && email && !isValidEmail(email)) {
    errors.email = "Ingresa un correo válido.";
  }

  return errors;
}

export function normalizeClientInput(raw = {}, countryCode = raw?.paisCodigo || "CL") {
  const country = normalizeCountryCode(countryCode);
  const errors = getClientFieldErrors(raw, country);
  if (Object.keys(errors).length > 0) {
    const error = new Error(Object.values(errors)[0]);
    error.code = "client/invalid-data";
    error.fieldErrors = errors;
    throw error;
  }

  const fiscalValue = normalizeClientText(raw.identificadorFiscalValor || raw.rut, 80, getFiscalIdentifierLabel(country));
  const fiscal = buildFiscalIdentifier(country, fiscalValue);
  return {
    modeloClienteVersion: CLIENT_MODEL_VERSION,
    tipoCliente: normalizeClientText(
      raw.tipoCliente,
      20,
      "tipo de cliente"
    ).toLowerCase(),
    ...fiscal,
    rut: fiscal.identificadorFiscalValor,
    rutNormalizado: country === "CL" ? normalizeChileanRut(fiscal.identificadorFiscalNormalizado) : "",
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

export function buildClientMutationPayload(raw = {}, countryCode = raw?.paisCodigo || "CL") {
  const normalized = normalizeClientInput(raw, countryCode);
  return {
    tipoCliente: normalized.tipoCliente,
    paisCodigo: normalized.paisCodigo,
    identificadorFiscalTipo: normalized.identificadorFiscalTipo,
    identificadorFiscalValor: normalized.identificadorFiscalValor,
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
  const fiscal = adaptStoredFiscalIdentifier(raw);
  const clienteId = normalizeClientText(
    raw.clienteId || raw.id || legacyClientId,
    160
  );
  const status = normalizeClientText(raw.estado, 20).toLowerCase();
  return {
    ...stored,
    ...normalizeClientInput({...raw, rut: fiscal.identificadorFiscalValor}, fiscal.paisCodigo),
    ...fiscal,
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
    `${client?.nombreRazonSocial || ""} ${client?.identificadorFiscalValor || client?.rut || ""} ${
      client?.identificadorFiscalNormalizado || client?.rutNormalizado || ""
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
