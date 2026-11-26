import {
  getCountryByCode,
  getCurrencyByCode,
  getDefaultFiscalIdentifierLabel,
  getDefaultLocaleForCountry,
  getJurisdictionContract,
} from "./businessCatalog.js";

export const DEFAULT_COUNTRY = "CL";
export const DEFAULT_CURRENCY = "CLP";
export const DEFAULT_LOCALE = "es-CL";

function text(value) {
  return String(value || "").trim();
}

export function normalizeLocale(value, fallback = DEFAULT_LOCALE) {
  try {
    return Intl.getCanonicalLocales(text(value))[0] || fallback;
  } catch {
    return fallback;
  }
}

export function adaptBusinessLocalization(raw = {}) {
  const country = getCountryByCode(text(raw.paisCodigo).toUpperCase()) || getCountryByCode(DEFAULT_COUNTRY);
  const jurisdiction = getJurisdictionContract(country.code);
  const canonical = Number(raw.contratoJurisdiccionalVersion) >= 1;
  const currency = canonical
    ? getCurrencyByCode(jurisdiction.monedaCodigo)
    : getCurrencyByCode(text(raw.monedaCodigo || raw.moneda).toUpperCase()) ||
      getCurrencyByCode(DEFAULT_CURRENCY);
  return {
    paisCodigo: country.code,
    paisNombre: country.name,
    monedaCodigo: currency.code,
    monedaNombre: currency.name,
    locale: canonical
      ? jurisdiction.locale
      : normalizeLocale(raw.locale, getDefaultLocaleForCountry(country.code)),
    identificadorFiscalTipo:
      canonical
        ? jurisdiction.identificadorFiscalTipo
        : text(raw.identificadorFiscalTipo) ||
          getDefaultFiscalIdentifierLabel(country.code),
    identificadorFiscalValor: text(raw.identificadorFiscalValor || raw.rut),
  };
}

// `montoDecimales` es el snapshot de los decimales de CÁLCULO del documento (`amountDecimals` de su moneda al
// crearlo; SPEC 036). Ausente = 0: un documento anterior sigue calculándose entero, sin recalcularse. Un valor
// inválido, o mayor que los decimales de la moneda, vale 0. No confundir con `decimals` del catálogo (formato).
export function adaptDocumentAmountDecimals(raw = {}, currencyCode) {
  const stored = raw.montoDecimales;
  const limit = getCurrencyByCode(currencyCode)?.decimals ?? 0;
  return Number.isInteger(stored) && stored > 0 && stored <= limit ? stored : 0;
}

// Tasa (fracción, 0,19) con que se arma el borrador de un documento: la del propio documento si ya la trae; si no, la
// del negocio (`impuestoPredeterminadoTasa`, en %); y si el negocio aún no la trae (perfil sin cargar), la tasa base de
// su país (Chile 19 %, Bolivia 13 %). Solo un país sin tasa base configurada conserva el 19 % de siempre.
export function resolveDocumentTaxRate(document, business) {
  if (document?.tasaIva !== null && document?.tasaIva !== undefined) return document.tasaIva;
  const stored = business?.impuestoPredeterminadoTasa;
  if (stored !== null && stored !== undefined) return Number(stored) / 100;
  const baseRate = getJurisdictionContract(text(business?.paisCodigo).toUpperCase() || DEFAULT_COUNTRY).impuestoPredeterminadoTasa;
  return Number(baseRate ?? 19) / 100;
}

export function adaptDocumentLocalization(raw = {}) {
  const rate = Number(raw.tasaIva);
  const moneda = text(raw.moneda || raw.monedaCodigo).toUpperCase() || DEFAULT_CURRENCY;
  return {
    paisCodigo: text(raw.paisCodigo).toUpperCase() || DEFAULT_COUNTRY,
    moneda,
    locale: normalizeLocale(raw.locale),
    impuestoNombre: text(raw.impuestoNombre) || "IVA",
    tasaIva: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.19,
    montoDecimales: adaptDocumentAmountDecimals(raw, moneda),
  };
}
