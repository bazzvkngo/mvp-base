const catalog = require("./businessCatalog.json");
const {
  getJurisdictionContract,
  resolveBaseTaxSettings,
} = require("./businessJurisdiction");

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
  const jurisdiction = getJurisdictionContract(country.code);
  const canonical = Number(raw.contratoJurisdiccionalVersion) >= 1;
  const currency = canonical
    ? currencies.get(jurisdiction.monedaCodigo)
    : currencies.get(text(raw.monedaCodigo || raw.moneda, 10).toUpperCase()) ||
      currencies.get(DEFAULT_CURRENCY);
  const locale = canonical
    ? jurisdiction.locale
    : canonicalLocale(raw.locale, country.defaultLocale || DEFAULT_LOCALE);
  return {
    paisCodigo: country.code,
    paisNombre: country.name,
    monedaCodigo: currency.code,
    monedaNombre: currency.name,
    locale,
    identificadorFiscalTipo: canonical
      ? jurisdiction.identificadorFiscalTipo
      : text(raw.identificadorFiscalTipo, 40) ||
        country.defaultFiscalIdentifierLabel || "Identificación fiscal",
    identificadorFiscalValor: text(raw.identificadorFiscalValor || raw.rut, 80),
  };
}

function normalizeTaxSettings(raw = {}, business = {}) {
  const resolved = resolveBaseTaxSettings(business, raw);
  return {
    impuestoPredeterminadoId: resolved.impuestoPredeterminadoId,
    impuestoPredeterminadoNombre: resolved.impuestoPredeterminadoNombre,
    impuestoPredeterminadoTasa: resolved.impuestoPredeterminadoTasa,
    configuracionTributariaBaseCompleta:
      resolved.configuracionTributariaBaseCompleta === true,
  };
}

// `montoDecimales` congela los decimales de CÁLCULO del documento (`amountDecimals` de su moneda al crearlo;
// SPEC 036). Hoy es 2 en BOB y 0 en el resto. No confundir con `decimals` (formato de presentación).
function documentLocalizationSnapshot(business = {}, tax = {}) {
  const location = normalizeBusinessLocalization(business);
  const normalizedTax = normalizeTaxSettings(tax, business);
  return {
    paisCodigo: location.paisCodigo,
    moneda: location.monedaCodigo,
    locale: location.locale,
    impuestoNombre: normalizedTax.impuestoPredeterminadoNombre,
    tasaIva: normalizedTax.impuestoPredeterminadoTasa === null
      ? null
      : normalizedTax.impuestoPredeterminadoTasa / 100,
    montoDecimales: currencyAmountDecimals(location.monedaCodigo),
  };
}

// Decimales de FORMATO que el catálogo define para una moneda (`decimals`: CLP 0, BOB 2...). null si el código
// no está en el catálogo. Solo decide cómo se muestra el monto.
function currencyDecimals(code) {
  const decimals = currencies.get(text(code, 10).toUpperCase())?.decimals;
  return Number.isInteger(decimals) && decimals >= 0 ? decimals : null;
}

// Decimales de CÁLCULO de los importes (`amountDecimals`: con cuántos decimales se redondean y validan los
// montos de un documento nuevo; SPEC 036). Nunca supera a `decimals`. Una moneda desconocida cuenta 0.
function currencyAmountDecimals(code) {
  const currency = currencies.get(text(code, 10).toUpperCase());
  const amountDecimals = currency?.amountDecimals;
  return Number.isInteger(amountDecimals) && amountDecimals >= 0 && amountDecimals <= currency.decimals
    ? amountDecimals
    : 0;
}

// Monto para textos (correos): moneda y locale del documento o de la empresa.
// Muestra entre 0 y los decimales que el catálogo define para la moneda, igual
// que formatBusinessMoney del frontend. Sin datos o con un código inválido cae en
// CLP/es-CL, que da exactamente el texto que producía el formato fijo anterior.
function formatMoneyText(value, currency, locale) {
  let code = text(currency, 10).toUpperCase() || DEFAULT_CURRENCY;
  const options = {style: "currency", currency: code, minimumFractionDigits: 0};
  const decimals = currencyDecimals(code);
  if (decimals !== null) {
    options.minimumFractionDigits = decimals;
    options.maximumFractionDigits = decimals;
  }
  const amount = Number(value || 0);
  try {
    return amount.toLocaleString(canonicalLocale(locale, DEFAULT_LOCALE), options);
  } catch {
    code = DEFAULT_CURRENCY;
    return amount.toLocaleString(DEFAULT_LOCALE, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
    });
  }
}

// Fecha para textos (correos): locale del documento o de la empresa (dd/mm/aaaa con dos dígitos). Sin locale, o con
// uno inválido, cae en es-CL: exactamente el texto que producía el formato fijo anterior.
function formatDateText(date, locale) {
  return date.toLocaleDateString(canonicalLocale(locale, DEFAULT_LOCALE), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// `montoDecimales` es el snapshot de los decimales de cálculo del documento. Ausente = 0 (un documento anterior
// sigue calculándose entero); un valor inválido, o mayor que los decimales de la moneda, vale 0.
function adaptDocumentAmountDecimals(raw = {}, currencyCode) {
  const stored = raw.montoDecimales;
  const limit = currencyDecimals(currencyCode) ?? 0;
  return Number.isInteger(stored) && stored > 0 && stored <= limit ? stored : 0;
}

function adaptDocumentLocalization(raw = {}) {
  const rate = Number(raw.tasaIva);
  const moneda = text(raw.moneda || raw.monedaCodigo, 10).toUpperCase() || DEFAULT_CURRENCY;
  return {
    paisCodigo: text(raw.paisCodigo, 10).toUpperCase() || DEFAULT_COUNTRY,
    moneda,
    locale: canonicalLocale(raw.locale, DEFAULT_LOCALE),
    impuestoNombre: text(raw.impuestoNombre, 60) || DEFAULT_TAX_NAME,
    tasaIva: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : DEFAULT_TAX_RATE_PERCENT / 100,
    montoDecimales: adaptDocumentAmountDecimals(raw, moneda),
  };
}

module.exports = {
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  adaptDocumentAmountDecimals,
  adaptDocumentLocalization,
  canonicalLocale,
  currencyAmountDecimals,
  currencyDecimals,
  documentLocalizationSnapshot,
  formatDateText,
  formatMoneyText,
  normalizeBusinessLocalization,
  normalizeTaxSettings,
};
