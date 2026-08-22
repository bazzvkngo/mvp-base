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

export const PROVIDER_MODEL_VERSION = 2;
export const PROVIDER_STATUSES = Object.freeze(["activo", "archivado"]);
export const PROVIDER_PAYMENT_TERMS = Object.freeze([
  "contado",
  "transferencia",
  "credito",
  "otro",
]);

const PROVIDER_STATUS_SET = new Set(PROVIDER_STATUSES);
const PROVIDER_PAYMENT_TERM_SET = new Set(PROVIDER_PAYMENT_TERMS);
const READ_ROLES = new Set(["OWNER", "ADMIN", "COMPRAS", "MEMBER"]);
const WRITE_ROLES = new Set(["OWNER", "ADMIN", "COMPRAS"]);
const PROVIDER_TEXT_FIELDS = Object.freeze({
  rut: {maxLength: 20, label: "RUT"},
  razonSocial: {maxLength: 240, label: "razón social"},
  nombreFantasia: {maxLength: 240, label: "nombre de fantasía"},
  giro: {maxLength: 240, label: "giro"},
  personaContacto: {maxLength: 200, label: "persona de contacto"},
  email: {maxLength: 240, label: "correo"},
  telefono: {maxLength: 100, label: "teléfono"},
  direccion: {maxLength: 300, label: "dirección"},
  regionCodigo: {maxLength: 20, label: "código de región"},
  regionNombre: {maxLength: 160, label: "región"},
  comunaCodigo: {maxLength: 20, label: "código de comuna"},
  comunaNombre: {maxLength: 160, label: "comuna"},
  condicionesPago: {maxLength: 40, label: "condición de pago"},
  notas: {maxLength: 4000, label: "notas"},
});

export function normalizeProviderText(
  value,
  maxLength = 240,
  fieldLabel = "texto"
) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    const error = new Error(`El campo ${fieldLabel} debe ser texto.`);
    error.code = "provider/invalid-data";
    throw error;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength) {
    const error = new Error(
      `El campo ${fieldLabel} no puede superar ${maxLength} caracteres.`
    );
    error.code = "provider/invalid-data";
    throw error;
  }
  return normalized;
}

export function normalizeProviderRut(value) {
  return normalizeChileanRut(value);
}

export function formatProviderRut(value) {
  return formatChileanRut(value);
}

export function isValidProviderRut(value) {
  return isValidChileanRut(value);
}

export function getProviderRutKey(value) {
  const normalized = normalizeProviderRut(value);
  return isValidProviderRut(normalized) ? normalized.replace("-", "") : "";
}

export function isValidProviderEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidProviderPhone(value) {
  if (!value) return true;
  if (!/^[+\d\s().-]+$/.test(value)) return false;
  const digitCount = value.replace(/\D/g, "").length;
  return digitCount >= 6 && digitCount <= 15;
}

function normalizeCreditDays(value, errors) {
  if (value == null || value === "") return 0;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(number) || number < 0) {
    errors.diasCredito = "Ingresa días de crédito como un entero mayor o igual a 0.";
    return 0;
  }
  return number;
}

function normalizeTerritory(normalized, errors, territoryCatalog = {}, countryCode = "CL") {
  const regionCodigo = normalized.regionCodigo;
  const comunaCodigo = normalized.comunaCodigo;

  if (normalizeCountryCode(countryCode) !== "CL") {
    return {regionCodigo, regionNombre: normalized.regionNombre, comunaCodigo, comunaNombre: normalized.comunaNombre};
  }

  if (!regionCodigo) {
    if (comunaCodigo) {
      errors.regionCodigo = "Selecciona una región válida para la comuna.";
    }
    return {
      regionCodigo: "",
      regionNombre: "",
      comunaCodigo: "",
      comunaNombre: "",
    };
  }

  const region = territoryCatalog.getRegionByCode?.(regionCodigo);
  if (territoryCatalog.getRegionByCode && !region) {
    errors.regionCodigo = "Selecciona una región válida.";
    return {
      regionCodigo,
      regionNombre: "",
      comunaCodigo: "",
      comunaNombre: "",
    };
  }

  if (!comunaCodigo) {
    return {
      regionCodigo: region?.code || regionCodigo,
      regionNombre: region?.name || normalized.regionNombre,
      comunaCodigo: "",
      comunaNombre: "",
    };
  }

  const commune = territoryCatalog.getCommuneByCode?.(
    regionCodigo,
    comunaCodigo
  );
  if (territoryCatalog.getCommuneByCode && !commune) {
    errors.comunaCodigo = "Selecciona una comuna que pertenezca a la región indicada.";
    return {
      regionCodigo: region?.code || regionCodigo,
      regionNombre: region?.name || normalized.regionNombre,
      comunaCodigo,
      comunaNombre: "",
    };
  }

  return {
    regionCodigo: region?.code || regionCodigo,
    regionNombre: region?.name || normalized.regionNombre,
    comunaCodigo: commune?.code || comunaCodigo,
    comunaNombre: commune?.name || normalized.comunaNombre,
  };
}

function collectProviderValidation(raw = {}, territoryCatalog = {}, countryCode = raw?.paisCodigo || "CL") {
  const errors = {};
  const normalized = {};

  Object.entries(PROVIDER_TEXT_FIELDS).forEach(
    ([field, {maxLength, label}]) => {
      try {
        normalized[field] = normalizeProviderText(raw?.[field], maxLength, label);
      } catch (error) {
        errors[field] = error.message;
        normalized[field] = "";
      }
    }
  );

  const country = normalizeCountryCode(countryCode);
  const fiscalValue = raw?.identificadorFiscalValor || normalized.rut;
  normalized.email = normalized.email.toLowerCase();
  normalized.condicionesPago = normalized.condicionesPago.toLowerCase();
  normalized.diasCredito = normalizeCreditDays(raw?.diasCredito, errors);

  if (!errors.rut && !fiscalValue) {
    errors.rut = `Ingresa el ${getFiscalIdentifierLabel(country)} del proveedor.`;
  } else if (!errors.rut && !isValidFiscalIdentifier(country, fiscalValue)) {
    errors.rut = `Ingresa un ${getFiscalIdentifierLabel(country)} válido.`;
  }
  if (!errors.razonSocial && !normalized.razonSocial) {
    errors.razonSocial = "Ingresa la razón social.";
  }
  if (!errors.email && !isValidProviderEmail(normalized.email)) {
    errors.email = "Ingresa un correo válido.";
  }
  if (!errors.telefono && !isValidProviderPhone(normalized.telefono)) {
    errors.telefono = "Ingresa un teléfono válido.";
  }
  if (
    !errors.condicionesPago &&
    normalized.condicionesPago &&
    !PROVIDER_PAYMENT_TERM_SET.has(normalized.condicionesPago)
  ) {
    errors.condicionesPago = "Selecciona una condición de pago válida.";
  }

  const territory = normalizeTerritory(normalized, errors, territoryCatalog, country);
  return {errors, normalized: {...normalized, ...territory}, country, fiscalValue};
}

export function getProviderFieldErrors(raw = {}, territoryCatalog = {}, countryCode = raw?.paisCodigo || "CL") {
  return collectProviderValidation(raw, territoryCatalog, countryCode).errors;
}

export function normalizeProviderInput(raw = {}, territoryCatalog = {}, countryCode = raw?.paisCodigo || "CL") {
  const {errors, normalized, country, fiscalValue} = collectProviderValidation(raw, territoryCatalog, countryCode);
  if (Object.keys(errors).length > 0) {
    const error = new Error(Object.values(errors)[0]);
    error.code = "provider/invalid-data";
    error.fieldErrors = errors;
    throw error;
  }

  const fiscal = buildFiscalIdentifier(country, fiscalValue);
  return {
    modeloProveedorVersion: PROVIDER_MODEL_VERSION,
    ...fiscal,
    rut: fiscal.identificadorFiscalValor,
    rutNormalizado: country === "CL" ? normalizeChileanRut(fiscal.identificadorFiscalNormalizado) : "",
    razonSocial: normalized.razonSocial,
    nombreFantasia: normalized.nombreFantasia,
    giro: normalized.giro,
    personaContacto: normalized.personaContacto,
    email: normalized.email,
    telefono: normalized.telefono,
    direccion: normalized.direccion,
    regionCodigo: normalized.regionCodigo,
    regionNombre: normalized.regionNombre,
    comunaCodigo: normalized.comunaCodigo,
    comunaNombre: normalized.comunaNombre,
    condicionesPago: normalized.condicionesPago,
    diasCredito: normalized.diasCredito,
    notas: normalized.notas,
  };
}

export function buildProviderMutationPayload(raw = {}, countryCode = raw?.paisCodigo || "CL") {
  const normalized = normalizeProviderInput(raw, {}, countryCode);
  return {
    paisCodigo: normalized.paisCodigo,
    identificadorFiscalTipo: normalized.identificadorFiscalTipo,
    identificadorFiscalValor: normalized.identificadorFiscalValor,
    razonSocial: normalized.razonSocial,
    nombreFantasia: normalized.nombreFantasia,
    giro: normalized.giro,
    personaContacto: normalized.personaContacto,
    email: normalized.email,
    telefono: normalized.telefono,
    direccion: normalized.direccion,
    regionCodigo: normalized.regionCodigo,
    regionNombre: normalized.regionNombre,
    comunaCodigo: normalized.comunaCodigo,
    comunaNombre: normalized.comunaNombre,
    condicionesPago: normalized.condicionesPago,
    diasCredito: normalized.diasCredito,
    notas: normalized.notas,
  };
}

export function adaptStoredProvider(raw = {}) {
  const fiscal = adaptStoredFiscalIdentifier(raw);
  const stored = normalizeProviderInput({...raw, rut: fiscal.identificadorFiscalValor}, {}, fiscal.paisCodigo);
  const proveedorId = normalizeProviderText(raw.proveedorId || raw.id, 160, "proveedorId");
  const status = normalizeProviderText(raw.estado, 20, "estado").toLowerCase();
  return {
    ...raw,
    ...stored,
    ...fiscal,
    proveedorId,
    negocioId: normalizeProviderText(raw.negocioId, 160, "negocioId"),
    estado: PROVIDER_STATUS_SET.has(status) ? status : "activo",
  };
}

function normalizeSearchText(value) {
  return (typeof value === "string" ? value : "")
    .slice(0, 500)
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL");
}

export function matchesProviderSearch(provider, search) {
  const query = normalizeSearchText(search).replace(/[^a-z0-9k]/g, "");
  if (!query) return true;
  const searchable = normalizeSearchText(
    `${provider?.razonSocial || ""} ${provider?.nombreFantasia || ""} ` +
      `${provider?.identificadorFiscalValor || provider?.rut || ""} ${provider?.identificadorFiscalNormalizado || provider?.rutNormalizado || ""}`
  ).replace(/[^a-z0-9k]/g, "");
  return searchable.includes(query);
}

export function canReadProviders(role) {
  return READ_ROLES.has(String(role || "").toUpperCase());
}

export function canManageProviders(role) {
  return WRITE_ROLES.has(String(role || "").toUpperCase());
}
