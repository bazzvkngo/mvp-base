import {
  BUSINESS_CATEGORY_CATALOG_VERSION,
  getBusinessCategoryByCode,
  getCountryByCode,
  getRegionByCode,
  isSelectableNewBusinessCountry,
} from "./businessCatalog";
import {
  normalizeBusinessText,
  normalizeQuickBusinessPayload,
} from "./businessQuickPayload.mjs";
import { isSelectableBusinessCategory } from "./businessCategorySearch.mjs";

export { normalizeBusinessText, normalizeQuickBusinessPayload };

export const INITIAL_QUICK_BUSINESS_VALUES = Object.freeze({
  nombreComercial: "",
  rubroCodigo: "",
  rubroOtro: "",
  regionCodigo: "",
});

export const INITIAL_ONBOARDING_BUSINESS_VALUES = Object.freeze({
  ...INITIAL_QUICK_BUSINESS_VALUES,
  paisCodigo: "CL",
});

export const QUICK_BUSINESS_FIELD_ORDER = Object.freeze([
  "nombreComercial",
  "rubroCodigo",
  "regionCodigo",
]);

export const ONBOARDING_BUSINESS_FIELD_ORDER = Object.freeze([
  "nombreComercial",
  "rubroCodigo",
  "paisCodigo",
]);

export function normalizeChileanRut(value) {
  return normalizeBusinessText(value)
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s/g, "");
}

export function isValidChileanRut(value) {
  const rut = normalizeChileanRut(value);
  if (!/^\d{7,8}-[\dK]$/.test(rut)) return false;

  const [body, suppliedDigit] = rut.split("-");
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

export function isValidBusinessEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function validateQuickBusiness(
  values,
  { requireCountry = false, requireRegion = true } = {}
) {
  const errors = {};
  const name = normalizeBusinessText(values.nombreComercial);

  if (!name) errors.nombreComercial = "Ingresa el nombre del negocio.";
  else if (name.length < 2) {
    errors.nombreComercial = "El nombre debe tener al menos 2 caracteres.";
  } else if (name.length > 120) {
    errors.nombreComercial = "El nombre no puede superar 120 caracteres.";
  }

  const category = getBusinessCategoryByCode(values.rubroCodigo);
  if (!isSelectableBusinessCategory(category, BUSINESS_CATEGORY_CATALOG_VERSION)) {
    errors.rubroCodigo = "Selecciona el rubro principal.";
  } else if (
    category.code === "OTRO" &&
    normalizeBusinessText(values.rubroOtro).length < 2
  ) {
    errors.rubroCodigo = "Describe el rubro de tu negocio.";
  }
  if (requireRegion && !getRegionByCode(values.regionCodigo)) {
    errors.regionCodigo = "Selecciona una región.";
  }
  const country = getCountryByCode(values.paisCodigo);
  if (requireCountry && !isSelectableNewBusinessCountry(country)) {
    errors.paisCodigo = "Selecciona un país válido.";
  }

  return errors;
}

export function getBusinessCreationErrorMessage(error) {
  const code = String(error?.code || "");
  if (code.includes("unauthenticated")) {
    return "Tu sesión terminó. Inicia sesión nuevamente para continuar.";
  }
  if (code.includes("permission-denied")) {
    return "No tienes permisos para realizar esta operación.";
  }
  if (code.includes("invalid-argument")) {
    return error?.message || "Revisa los datos ingresados.";
  }
  if (code.includes("failed-precondition")) {
    return error?.message || "No fue posible crear el negocio.";
  }
  if (code.includes("resource-exhausted")) {
    return error?.message || "El servicio no pudo procesar la solicitud. Reintenta en unos segundos.";
  }
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return "No pudimos conectar con el servicio. Reintenta en unos segundos.";
  }
  return "No pudimos crear el negocio. Tus datos siguen en pantalla para que puedas reintentar.";
}

// Alias compatibles para consumidores que aún utilicen los nombres anteriores.
export const INITIAL_ADDITIONAL_BUSINESS_VALUES = INITIAL_QUICK_BUSINESS_VALUES;
export const ADDITIONAL_BUSINESS_FIELD_ORDER = QUICK_BUSINESS_FIELD_ORDER;
export const validateAdditionalBusiness = validateQuickBusiness;
export const normalizeAdditionalBusinessPayload = normalizeQuickBusinessPayload;
export const getAdditionalBusinessErrorMessage = getBusinessCreationErrorMessage;
