import catalog from "../../functions/businessCatalog.json" with { type: "json" };

export const BUSINESS_CATALOG_VERSION = catalog.schemaVersion;
export const COUNTRIES = Object.freeze(catalog.countries);
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

export function getCurrencyByCode(code) {
  return currenciesByCode.get(String(code || "")) || null;
}

export function getDefaultLocaleForCountry(code) {
  return getCountryByCode(code)?.defaultLocale || "es-CL";
}

export function getDefaultFiscalIdentifierLabel(code) {
  return getCountryByCode(code)?.defaultFiscalIdentifierLabel || "RUT";
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
