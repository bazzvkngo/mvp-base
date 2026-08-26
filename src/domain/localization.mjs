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

export function adaptDocumentLocalization(raw = {}) {
  const rate = Number(raw.tasaIva);
  return {
    paisCodigo: text(raw.paisCodigo).toUpperCase() || DEFAULT_COUNTRY,
    moneda: text(raw.moneda || raw.monedaCodigo).toUpperCase() || DEFAULT_CURRENCY,
    locale: normalizeLocale(raw.locale),
    impuestoNombre: text(raw.impuestoNombre) || "IVA",
    tasaIva: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.19,
  };
}
