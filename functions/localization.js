const catalog = require("./businessCatalog.json");

const DEFAULT_COUNTRY = "CL";
const DEFAULT_CURRENCY = "CLP";
const DEFAULT_LOCALE = "es-CL";
const DEFAULT_TAX_NAME = "IVA";
const DEFAULT_TAX_RATE_PERCENT = 19;

const countries = new Map(catalog.countries.map((item) => [item.code, item]));
const currencies = new Map(catalog.currencies.map((item) => [item.code, item]));

function text(value, max = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function canonicalLocale(value, fallback = DEFAULT_LOCALE) {
  try {
    return Intl.getCanonicalLocales(text(value, 40))[0] || fallback;
  } catch {
    return fallback;
  }
}

function normalizeBusinessLocalization(raw = {}) {
  const country = countries.get(text(raw.paisCodigo, 10).toUpperCase()) || countries.get(DEFAULT_COUNTRY);
  const currency = currencies.get(text(raw.monedaCodigo || raw.moneda, 10).toUpperCase()) || currencies.get(DEFAULT_CURRENCY);
  const locale = canonicalLocale(raw.locale, country.defaultLocale || DEFAULT_LOCALE);
  return {
    paisCodigo: country.code,
    paisNombre: country.name,
    monedaCodigo: currency.code,
    monedaNombre: currency.name,
    locale,
    identificadorFiscalTipo: text(raw.identificadorFiscalTipo, 40) || country.defaultFiscalIdentifierLabel || "Identificación fiscal",
    identificadorFiscalValor: text(raw.identificadorFiscalValor || raw.rut, 80),
  };
}

function normalizeTaxSettings(raw = {}) {
  const parsedRate = Number(raw.impuestoPredeterminadoTasa);
  return {
    impuestoPredeterminadoId: text(raw.impuestoPredeterminadoId, 40) || "PERSONALIZADO",
    impuestoPredeterminadoNombre: text(raw.impuestoPredeterminadoNombre, 60) || DEFAULT_TAX_NAME,
    impuestoPredeterminadoTasa:
      Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 100
        ? parsedRate
        : DEFAULT_TAX_RATE_PERCENT,
  };
}

function documentLocalizationSnapshot(business = {}, tax = {}) {
  const location = normalizeBusinessLocalization(business);
  const normalizedTax = normalizeTaxSettings(tax);
  return {
    paisCodigo: location.paisCodigo,
    moneda: location.monedaCodigo,
    locale: location.locale,
    impuestoNombre: normalizedTax.impuestoPredeterminadoNombre,
    tasaIva: normalizedTax.impuestoPredeterminadoTasa / 100,
  };
}

function adaptDocumentLocalization(raw = {}) {
  const rate = Number(raw.tasaIva);
  return {
    paisCodigo: text(raw.paisCodigo, 10).toUpperCase() || DEFAULT_COUNTRY,
    moneda: text(raw.moneda || raw.monedaCodigo, 10).toUpperCase() || DEFAULT_CURRENCY,
    locale: canonicalLocale(raw.locale, DEFAULT_LOCALE),
    impuestoNombre: text(raw.impuestoNombre, 60) || DEFAULT_TAX_NAME,
    tasaIva: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : DEFAULT_TAX_RATE_PERCENT / 100,
  };
}

module.exports = {
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  adaptDocumentLocalization,
  canonicalLocale,
  documentLocalizationSnapshot,
  normalizeBusinessLocalization,
  normalizeTaxSettings,
};
