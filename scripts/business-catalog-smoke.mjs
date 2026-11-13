import assert from "node:assert/strict";
import catalog from "../functions/businessCatalog.json" with { type: "json" };
import { isSelectableBusinessCategory } from "../src/domain/businessCategorySearch.mjs";
import { NEW_BUSINESS_COUNTRIES, isSelectableNewBusinessCountry } from "../src/domain/businessCatalog.js";

assert.equal(catalog.schemaVersion, 4);
assert.equal(catalog.businessCategoryCatalogVersion, 1);
assert.equal(catalog.countries.length, 11);
assert.equal(catalog.countries[0].code, "CL");
assert.equal(catalog.countries.find((country) => country.code === "BR").defaultLocale, "pt-BR");
for (const country of catalog.countries) {
  assert.ok(country.baseTax?.id);
  assert.ok(country.baseTax?.name);
  assert.equal(typeof country.baseTax?.configured, "boolean");
}
assert.deepEqual(catalog.countries.find((country) => country.code === "CL")?.baseTax, {
  id: "IVA_GENERAL",
  name: "IVA",
  rate: 19,
  configured: true,
});
assert.deepEqual(catalog.countries.find((country) => country.code === "PE")?.baseTax, {
  id: "IGV_GENERAL",
  name: "IGV",
  rate: 18,
  configured: true,
});
assert.equal(catalog.countries.find((country) => country.code === "BR")?.baseTax.configured, false);
assert.equal(catalog.countries.find((country) => country.code === "BR")?.baseTax.rate, null);
// Protección temporal: el dinero del sistema es entero y pierde centavos con monedas de decimales, así que mientras
// no exista el modelo de dinero decimal solo se pueden crear empresas en países cuya moneda no tiene decimales.
// Reactivar un país es quitar su "selectableForNewBusiness": false (o ponerlo en true), sin tocar código.
const expectedNewBusinessCountries = [
  ["CL", "CLP"],
  ["PY", "PYG"],
];
assert.deepEqual(
  catalog.countries
    .filter((country) => country.active !== false && country.selectableForNewBusiness !== false)
    .map(({code, defaultCurrencyCode}) => [code, defaultCurrencyCode]),
  expectedNewBusinessCountries
);
const currencyDecimals = new Map(catalog.currencies.map((currency) => [currency.code, currency.decimals]));
for (const country of catalog.countries.filter((item) => item.code !== "OTHER")) {
  const decimals = currencyDecimals.get(country.defaultCurrencyCode);
  assert.ok(Number.isInteger(decimals), `${country.code}: la moneda ${country.defaultCurrencyCode} debe existir en el catálogo`);
  assert.equal(
    country.selectableForNewBusiness !== false,
    decimals === 0,
    `${country.code}: seleccionable para empresas nuevas solo si su moneda no tiene decimales (${country.defaultCurrencyCode}: ${decimals})`
  );
  assert.equal(country.active, true, `${country.code} sigue activo: las empresas existentes siguen funcionando`);
}
for (const code of ["BO", "BR", "PE", "AR", "CO", "EC", "UY", "MX"]) {
  assert.equal(catalog.countries.find((country) => country.code === code)?.selectableForNewBusiness, false, `${code} no seleccionable`);
}
for (const code of ["CL", "PY"]) {
  assert.notEqual(catalog.countries.find((country) => country.code === code)?.selectableForNewBusiness, false, `${code} seleccionable`);
}
// Lo que ve el formulario (src/domain/businessCatalog.js) sale del mismo flag y del mismo archivo.
assert.deepEqual(NEW_BUSINESS_COUNTRIES.map((country) => country.code), ["CL", "PY"]);
const boliviaEntry = catalog.countries.find((country) => country.code === "BO");
assert.equal(isSelectableNewBusinessCountry(boliviaEntry), false, "BO no se ofrece al crear una empresa");
assert.equal(isSelectableNewBusinessCountry({ ...boliviaEntry, selectableForNewBusiness: true }), true, "reactivar un país es poner el flag en true");
const { selectableForNewBusiness: ignoredFlag, ...boliviaWithoutFlag } = boliviaEntry;
assert.equal(ignoredFlag, false);
assert.equal(isSelectableNewBusinessCountry(boliviaWithoutFlag), true, "reactivar un país también es quitar el flag");
assert.equal(isSelectableNewBusinessCountry({ ...boliviaEntry, selectableForNewBusiness: true, active: false }), false, "un país inactivo no se ofrece aunque el flag sea true");
const legacyOtherCountry = catalog.countries.find((country) => country.code === "OTHER");
assert.equal(legacyOtherCountry?.active, true);
assert.equal(legacyOtherCountry?.selectableForNewBusiness, false);
assert.equal(legacyOtherCountry?.legacy, true);
assert.equal(catalog.currencies.length, 11);
assert.equal(catalog.currencies[0].code, "CLP");
assert.ok(catalog.currencies.some((currency) => currency.code === "BOB"));
assert.ok(catalog.currencies.some((currency) => currency.code === "BRL"));
assert.ok(catalog.currencies.some((currency) => currency.code === "PEN"));
assert.ok(catalog.currencies.some((currency) => currency.code === "USD"));
assert.equal(catalog.businessCategorySectors.length, 7);
assert.ok(catalog.businessCategories.length >= 79);
assert.equal(
  new Set(catalog.businessCategories.map((category) => category.code)).size,
  catalog.businessCategories.length
);
for (const category of catalog.businessCategories) {
  assert.match(category.code, /^[A-Z0-9_]+$/);
  assert.ok(category.name);
  assert.ok(category.sectorCode);
  assert.equal(typeof category.active, "boolean");
  assert.ok(Array.isArray(category.searchTerms));
}
const expectedV1Categories = [
  ["TECNOLOGIA_INFORMATICA", "Tecnología e informática"],
  ["SEGURIDAD_TELECOMUNICACIONES", "Seguridad electrónica y telecomunicaciones"],
  ["ELECTRICIDAD_ENERGIA_CLIMATIZACION", "Electricidad, energía y climatización"],
  ["AUTOMATIZACION_CONTROL", "Automatización y control"],
  ["MANTENIMIENTO_INSTALACIONES", "Mantenimiento e instalaciones técnicas"],
  ["INGENIERIA_CONSULTORIA", "Ingeniería y consultoría técnica"],
  ["OTRO_SERVICIO_PROYECTOS", "Otro servicio por proyectos"],
];
const selectableCategories = catalog.businessCategories.filter((category) =>
  isSelectableBusinessCategory(category, catalog.businessCategoryCatalogVersion)
);
assert.equal(selectableCategories.length, 7);
assert.deepEqual(
  selectableCategories.map(({ code, name }) => [code, name]),
  expectedV1Categories
);
// Rubros que dejaron de ser seleccionables: siguen en el catálogo y activos.
for (const code of [
  "AUTOMOTRIZ_MOVILIDAD",
  "CONSTRUCCION_OBRAS",
  "SOFTWARE_SOLUCIONES_DIGITALES",
  "SERVICIOS_DIGITALES_CREATIVOS",
]) {
  const retired = catalog.businessCategories.find((category) => category.code === code);
  assert.ok(retired, code);
  assert.equal(retired.active, true, code);
  assert.equal(retired.selectable, false, code);
  assert.equal(
    isSelectableBusinessCategory(retired, catalog.businessCategoryCatalogVersion),
    false,
    code
  );
}
for (const legacyCode of ["RESTAURANTE", "TECNOLOGIA_SOFTWARE", "OTRO"]) {
  const legacyCategory = catalog.businessCategories.find(({ code }) => code === legacyCode);
  assert.ok(legacyCategory);
  assert.equal(isSelectableBusinessCategory(legacyCategory, catalog.businessCategoryCatalogVersion), false);
}
const legacyRetail = catalog.businessCategories.find(
  ({ code }) => code === "COMERCIO_MINORISTA"
);
assert.equal(legacyRetail?.active, true);
assert.equal(legacyRetail?.selectable, false);
assert.equal(legacyRetail?.legacy, true);
for (const [code, name] of [
  ["EDUCACION", "Educación"],
  ["MANUFACTURA", "Manufactura"],
]) {
  const historicalCategory = catalog.businessCategories.find(
    (category) => category.code === code
  );
  assert.equal(historicalCategory?.name, name);
  assert.equal(historicalCategory?.selectable, false);
  assert.equal(historicalCategory?.legacy, true);
}
assert.equal(catalog.regions.length, 16);

const communes = catalog.regions.flatMap((region) =>
  region.communes.map((commune) => ({ ...commune, regionCode: region.code }))
);
assert.equal(communes.length, 346);
assert.equal(new Set(catalog.regions.map((region) => region.code)).size, 16);
assert.equal(new Set(communes.map((commune) => commune.code)).size, 346);

for (const region of catalog.regions) {
  assert.match(region.code, /^\d{2}$/);
  assert.ok(region.name);
  assert.ok(region.communes.length > 0);
  for (const commune of region.communes) {
    assert.match(commune.code, /^\d{5}$/);
    assert.equal(commune.code.slice(0, 2), region.code);
    assert.ok(commune.name);
    assert.match(commune.provinceCode, /^\d{3}$/);
  }
}

const nuble = catalog.regions.find((region) => region.code === "16");
assert.equal(nuble?.name, "Ñuble");
assert.ok(nuble.communes.some((commune) => commune.name === "Chillán"));

console.log(
  "BUSINESS_CATALOG_SMOKE_OK",
  JSON.stringify({
    newBusinessCountries: expectedNewBusinessCountries.length,
    regions: catalog.regions.length,
    communes: communes.length,
  })
);
