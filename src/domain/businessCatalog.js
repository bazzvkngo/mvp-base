import catalog from "../../functions/businessCatalog.json" with { type: "json" };

export const BUSINESS_CATALOG_VERSION = catalog.schemaVersion;
export const BUSINESS_CATEGORY_CATALOG_VERSION = catalog.businessCategoryCatalogVersion;
export const COUNTRIES = Object.freeze(catalog.countries);
export const NEW_BUSINESS_COUNTRIES = Object.freeze(
  catalog.countries.filter(isSelectableNewBusinessCountry)
);
export const CURRENCIES = Object.freeze(catalog.currencies);
export const LOCALE_CONFIG = Object.freeze(
  Object.fromEntries(
    catalog.countries.map((country) => [country.code, country.defaultLocale])
  )
);
export const BUSINESS_CATEGORY_SECTORS = Object.freeze(
  catalog.businessCategorySectors
);
export const BUSINESS_CATEGORIES = Object.freeze(catalog.businessCategories);
export const CHILE_REGIONS = Object.freeze(catalog.regions);

const countriesByCode = new Map(COUNTRIES.map((country) => [country.code, country]));
const currenciesByCode = new Map(CURRENCIES.map((currency) => [currency.code, currency]));
const categoriesByCode = new Map(
  BUSINESS_CATEGORIES.map((category) => [category.code, category])
);
const regionsByCode = new Map(CHILE_REGIONS.map((region) => [region.code, region]));

export function getCountryByCode(code) {
  return countriesByCode.get(String(code || "")) || null;
}

export function isSelectableNewBusinessCountry(country) {
  return Boolean(
    country?.active !== false && country?.selectableForNewBusiness !== false
  );
}

export function getCurrencyByCode(code) {
  return currenciesByCode.get(String(code || "")) || null;
}

// Nombre en plural para frases ("Los montos se registran en pesos chilenos"). El catálogo guarda el nombre en
// singular; esta tabla cubre cada moneda activa (lo fija business-catalog-smoke) y una moneda sin entrada usa su código.
const CURRENCY_PLURAL_NAMES = Object.freeze({
  CLP: "pesos chilenos",
  BOB: "bolivianos",
  BRL: "reales brasileños",
  PEN: "soles peruanos",
  ARS: "pesos argentinos",
  COP: "pesos colombianos",
  PYG: "guaraníes paraguayos",
  UYU: "pesos uruguayos",
  MXN: "pesos mexicanos",
  USD: "dólares estadounidenses",
  EUR: "euros",
});

export function getCurrencyPluralName(code) {
  const normalized = String(code || "").toUpperCase();
  return CURRENCY_PLURAL_NAMES[normalized] || normalized || "pesos chilenos";
}

// Decimales de CÁLCULO de los importes de una moneda (`amountDecimals` del catálogo): con cuántos decimales
// se redondean y validan los montos de los documentos (SPEC 036). No es `decimals`, que solo decide cómo se
// MUESTRA el monto (CLP 0, BOB 2). amountDecimals nunca supera a decimals; hoy es 2 en BOB y 0 en el resto
// (SPEC 036; el rollback de Bolivia es volver BOB a 0). Una moneda desconocida cuenta 0: el comportamiento entero de siempre.
export function getCurrencyAmountDecimals(code) {
  const currency = getCurrencyByCode(String(code || "").toUpperCase());
  const amountDecimals = currency?.amountDecimals;
  return Number.isInteger(amountDecimals) && amountDecimals >= 0 && amountDecimals <= currency.decimals
    ? amountDecimals
    : 0;
}

export function getDefaultLocaleForCountry(code) {
  return getCountryByCode(code)?.defaultLocale || "es-CL";
}

export function getDefaultFiscalIdentifierLabel(code) {
  return getCountryByCode(code)?.defaultFiscalIdentifierLabel || "RUT";
}

export function getJurisdictionContract(code) {
  const country = getCountryByCode(code) || getCountryByCode("CL");
  const currency = getCurrencyByCode(country.defaultCurrencyCode);
  const tax = country.baseTax || {};
  return {
    paisCodigo: country.code,
    paisNombre: country.name,
    monedaCodigo: currency?.code || country.defaultCurrencyCode,
    monedaNombre: currency?.name || country.defaultCurrencyCode,
    locale: country.defaultLocale || "es-CL",
    identificadorFiscalTipo:
      country.defaultFiscalIdentifierLabel || "Identificación fiscal",
    impuestoPredeterminadoId:
      tax.id || "CONFIGURACION_TRIBUTARIA_ESPECIFICA",
    impuestoPredeterminadoNombre:
      tax.name || "Configuración tributaria específica",
    impuestoPredeterminadoTasa:
      Number.isFinite(Number(tax.rate)) && tax.rate !== null
        ? Number(tax.rate)
        : null,
    configuracionTributariaBaseCompleta: tax.configured === true,
  };
}

export function getBusinessCategoryByCode(code) {
  return categoriesByCode.get(String(code || "")) || null;
}

export function getBusinessCategoryDisplayName(
  code,
  customName = "",
  historicalName = ""
) {
  const category = getBusinessCategoryByCode(code);
  if (category?.code === "OTRO" && String(customName || "").trim()) {
    return String(customName).trim();
  }
  return category?.name || String(historicalName || "").trim();
}

export function getRegionByCode(code) {
  return regionsByCode.get(String(code || "")) || null;
}

export function getCommunesForRegion(regionCode) {
  return getRegionByCode(regionCode)?.communes || [];
}

export function getCommuneByCode(regionCode, communeCode) {
  return (
    getCommunesForRegion(regionCode).find(
      (commune) => commune.code === String(communeCode || "")
    ) || null
  );
}

// Regiones por país (SPEC de rubros y países, Bolivia piloto). Chile sigue en
// `catalog.regions` (con comunas); los demás países con catálogo salen de
// `territoriesByCountry` (hoy solo Bolivia, departamentos, sin municipios).
// Un país sin catálogo devuelve lista vacía: su región no se elige de una lista.
export const TERRITORIES_BY_COUNTRY = Object.freeze(
  catalog.territoriesByCountry || {}
);

function foldName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function getRegionsForCountry(countryCode) {
  const code = String(countryCode || "").toUpperCase();
  if (code === "CL") return CHILE_REGIONS;
  return TERRITORIES_BY_COUNTRY[code]?.regions || [];
}

export function hasRegionCatalog(countryCode) {
  return getRegionsForCountry(countryCode).length > 0;
}

// "Región" en Chile y en países sin etiqueta propia; "Departamento" en Bolivia.
export function getRegionLabel(countryCode) {
  return (
    TERRITORIES_BY_COUNTRY[String(countryCode || "").toUpperCase()]
      ?.regionLabel || "Región"
  );
}

export function getRegionForCountry(countryCode, regionCode) {
  const code = String(regionCode || "");
  return getRegionsForCountry(countryCode).find((region) => region.code === code) || null;
}

// Para perfiles antiguos con la región en texto libre: devuelve el código del
// catálogo si el nombre coincide (sin tildes ni mayúsculas), o "".
export function findRegionCodeByName(countryCode, name) {
  const wanted = foldName(name);
  if (!wanted) return "";
  return (
    getRegionsForCountry(countryCode).find(
      (region) => foldName(region.name) === wanted
    )?.code || ""
  );
}
