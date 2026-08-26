const catalog = require("./businessCatalog.json");

const JURISDICTION_CONTRACT_VERSION = 1;
const DEFAULT_COUNTRY_CODE = "CL";
const countries = new Map(catalog.countries.map((country) => [country.code, country]));
const currencies = new Map(catalog.currencies.map((currency) => [currency.code, currency]));

const PROTECTED_BUSINESS_FIELDS = Object.freeze([
  "paisCodigo",
  "paisNombre",
  "monedaCodigo",
  "monedaNombre",
  "locale",
  "identificadorFiscalTipo",
  "identificadorFiscalValor",
  "rut",
  "razonSocial",
  "impuestoPredeterminadoId",
  "impuestoPredeterminadoNombre",
  "impuestoPredeterminadoTasa",
]);

function text(value, max = 180) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function canonicalLocale(value, fallback) {
  try {
    return Intl.getCanonicalLocales(text(value, 40))[0] || fallback;
  } catch {
    return fallback;
  }
}

function getJurisdictionContract(countryCode = DEFAULT_COUNTRY_CODE) {
  const requested = text(countryCode, 10).toUpperCase();
  const country = countries.get(requested) || countries.get(DEFAULT_COUNTRY_CODE);
  const currency = currencies.get(country.defaultCurrencyCode);
  const tax = country.baseTax || {};
  return {
    version: JURISDICTION_CONTRACT_VERSION,
    paisCodigo: country.code,
    paisNombre: country.name,
    monedaCodigo: currency?.code || country.defaultCurrencyCode,
    monedaNombre: currency?.name || country.defaultCurrencyCode,
    locale: canonicalLocale(country.defaultLocale, "es-CL"),
    identificadorFiscalTipo:
      text(country.defaultFiscalIdentifierLabel, 40) || "Identificación fiscal",
    impuestoPredeterminadoId:
      text(tax.id, 60) || "CONFIGURACION_TRIBUTARIA_ESPECIFICA",
    impuestoPredeterminadoNombre:
      text(tax.name, 80) || "Configuración tributaria específica",
    impuestoPredeterminadoTasa:
      Number.isFinite(Number(tax.rate)) && tax.rate !== null
        ? Number(tax.rate)
        : null,
    configuracionTributariaBaseCompleta: tax.configured === true,
  };
}

function authoritativeBusinessFields(business = {}, profile = {}) {
  const countryCode = text(
    business.paisCodigo || profile.paisCodigo || DEFAULT_COUNTRY_CODE,
    10
  ).toUpperCase();
  const contract = getJurisdictionContract(countryCode);
  const isCanonical = Number(business.contratoJurisdiccionalVersion) >= 1;
  const verification = business.verificacionEmpresa || {};
  const isVerified = verification.estado === "VERIFICADA";
  const fiscalValue = isVerified
    ? text(
        verification.identificadorFiscalValor || business.identificadorFiscalValor,
        80
      )
    : text(
        business.identificadorFiscalValor || profile.identificadorFiscalValor ||
          business.rut || profile.rut,
        80
      );
  const currencyCode = text(
    business.monedaCodigo || profile.monedaCodigo || contract.monedaCodigo,
    10
  ).toUpperCase();
  const currency = currencies.get(currencyCode);
  return {
    paisCodigo: contract.paisCodigo,
    paisNombre: text(
      business.paisNombre || profile.paisNombre || contract.paisNombre,
      120
    ),
    monedaCodigo: isCanonical ? contract.monedaCodigo : currencyCode,
    monedaNombre: isCanonical
      ? contract.monedaNombre
      : text(
          business.monedaNombre || profile.monedaNombre || currency?.name || currencyCode,
          120
        ),
    locale: isCanonical
      ? contract.locale
      : canonicalLocale(
          business.locale || profile.locale || contract.locale,
          contract.locale
        ),
    identificadorFiscalTipo: isCanonical
      ? contract.identificadorFiscalTipo
      : text(
          business.identificadorFiscalTipo || profile.identificadorFiscalTipo ||
            contract.identificadorFiscalTipo,
          40
        ),
    identificadorFiscalValor: fiscalValue,
    razonSocial: text(profile.razonSocial || business.razonSocial, 180),
    rut: contract.paisCodigo === "CL"
      ? fiscalValue
      : text(business.rut || profile.rut, 80),
  };
}

function comparable(field, value) {
  const normalized = text(value, field === "locale" ? 40 : 180);
  if (["paisCodigo", "monedaCodigo", "identificadorFiscalTipo"].includes(field)) {
    return normalized.toUpperCase();
  }
  if (["identificadorFiscalValor", "rut"].includes(field)) {
    return normalized.toUpperCase().replace(/[.\s-]/g, "");
  }
  if (field === "impuestoPredeterminadoTasa") {
    return value === null || value === "" || value === undefined ? null : Number(value);
  }
  return normalized;
}

function assertProtectedBusinessFieldsUnchanged(
  raw = {},
  business = {},
  profile = {},
  HttpsError
) {
  const authoritative = authoritativeBusinessFields(business, profile);
  const contract = getJurisdictionContract(authoritative.paisCodigo);
  const expected = {...contract, ...authoritative};
  const fiscalExpected = comparable(
    "identificadorFiscalValor",
    authoritative.identificadorFiscalValor
  );
  for (const field of PROTECTED_BUSINESS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
    const supplied = comparable(field, raw[field]);
    const current = ["identificadorFiscalValor", "rut"].includes(field)
      ? fiscalExpected
      : comparable(field, expected[field]);
    if (supplied !== current) {
      throw new HttpsError(
        "failed-precondition",
        "La jurisdicción, identificación fiscal y configuración tributaria base no se pueden modificar desde Empresa."
      );
    }
  }
  return authoritative;
}

function buildProfileInputWithAuthoritativeFields(
  raw = {},
  business = {},
  profile = {},
  HttpsError
) {
  const protectedFields = assertProtectedBusinessFieldsUnchanged(
    raw,
    business,
    profile,
    HttpsError
  );
  return {...raw, ...protectedFields};
}

function buildBaseTaxSettings(countryCode, businessId, timestamps = {}) {
  const contract = getJurisdictionContract(countryCode);
  return {
    negocioId: businessId,
    impuestoPredeterminadoId: contract.impuestoPredeterminadoId,
    impuestoPredeterminadoNombre: contract.impuestoPredeterminadoNombre,
    impuestoPredeterminadoTasa: contract.impuestoPredeterminadoTasa,
    configuracionTributariaBaseCompleta:
      contract.configuracionTributariaBaseCompleta,
    derivadoDePaisCodigo: contract.paisCodigo,
    contratoJurisdiccionalVersion: contract.version,
    ...timestamps,
  };
}

function resolveBaseTaxSettings(business = {}, stored = {}) {
  const contract = getJurisdictionContract(business.paisCodigo);
  if (Number(business.contratoJurisdiccionalVersion) >= 1) return contract;
  const storedRate = stored.impuestoPredeterminadoTasa;
  const rate = Number(stored.impuestoPredeterminadoTasa);
  const hasStoredTax =
    text(stored.impuestoPredeterminadoNombre, 80) &&
    storedRate !== null &&
    storedRate !== "" &&
    storedRate !== undefined &&
    Number.isFinite(rate);
  if (!hasStoredTax) return contract;
  return {
    ...contract,
    impuestoPredeterminadoId:
      text(stored.impuestoPredeterminadoId, 60) || "PERSONALIZADO_LEGACY",
    impuestoPredeterminadoNombre: text(stored.impuestoPredeterminadoNombre, 80),
    impuestoPredeterminadoTasa: rate,
    configuracionTributariaBaseCompleta: true,
  };
}

module.exports = {
  JURISDICTION_CONTRACT_VERSION,
  PROTECTED_BUSINESS_FIELDS,
  assertProtectedBusinessFieldsUnchanged,
  authoritativeBusinessFields,
  buildBaseTaxSettings,
  buildProfileInputWithAuthoritativeFields,
  getJurisdictionContract,
  resolveBaseTaxSettings,
};
