import assert from "node:assert/strict";
import catalog from "../functions/businessCatalog.json" with { type: "json" };
import { isSelectableBusinessCategory } from "../src/domain/businessCategorySearch.mjs";
import { getCountryFiscalNote } from "../src/domain/countryFiscalNote.mjs";
import {
  NEW_BUSINESS_COUNTRIES,
  findRegionCodeByName,
  getDefaultFiscalIdentifierLabel,
  getRegionForCountry,
  getCurrencyAmountDecimals,
  getRegionLabel,
  getRegionsForCountry,
  hasRegionCatalog,
  isSelectableNewBusinessCountry,
} from "../src/domain/businessCatalog.js";

assert.equal(catalog.schemaVersion, 6);
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
// Países abiertos a empresas nuevas: Chile y Bolivia. Bolivia es el piloto con montos enteros redondeados
// (acta 7.6.1, opción (a), decisión de Mauricio del 20-nov): el dinero se guarda entero y Bs pierde los centavos.
// Paraguay se cierra para empresas nuevas (las existentes no cambian) y el resto sigue cerrado.
// Reactivar o cerrar un país es poner o quitar su "selectableForNewBusiness": false, sin tocar código.
const expectedNewBusinessCountries = [
  ["CL", "CLP"],
  ["BO", "BOB"],
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
    ["CL", "BO"].includes(country.code),
    `${country.code}: seleccionable para empresas nuevas solo Chile y Bolivia`
  );
  assert.equal(country.active, true, `${country.code} sigue activo: las empresas existentes siguen funcionando`);
}
for (const code of ["PY", "BR", "PE", "AR", "CO", "EC", "UY", "MX"]) {
  assert.equal(catalog.countries.find((country) => country.code === code)?.selectableForNewBusiness, false, `${code} no seleccionable`);
}
for (const code of ["CL", "BO"]) {
  assert.notEqual(catalog.countries.find((country) => country.code === code)?.selectableForNewBusiness, false, `${code} seleccionable`);
}
// Lo que ve el formulario (src/domain/businessCatalog.js) sale del mismo flag y del mismo archivo.
assert.deepEqual(NEW_BUSINESS_COUNTRIES.map((country) => country.code), ["CL", "BO"]);
const paraguayEntry = catalog.countries.find((country) => country.code === "PY");
assert.equal(isSelectableNewBusinessCountry(paraguayEntry), false, "PY no se ofrece al crear una empresa");
assert.equal(paraguayEntry.active, true, "PY sigue activo: las empresas existentes no cambian");
assert.equal(isSelectableNewBusinessCountry({ ...paraguayEntry, selectableForNewBusiness: true }), true, "reactivar un país es poner el flag en true");
const { selectableForNewBusiness: ignoredFlag, ...paraguayWithoutFlag } = paraguayEntry;
assert.equal(ignoredFlag, false);
assert.equal(isSelectableNewBusinessCountry(paraguayWithoutFlag), true, "reactivar un país también es quitar el flag");
assert.equal(isSelectableNewBusinessCountry({ ...paraguayEntry, selectableForNewBusiness: true, active: false }), false, "un país inactivo no se ofrece aunque el flag sea true");
const boliviaEntry = catalog.countries.find((country) => country.code === "BO");
assert.equal(boliviaEntry.selectableForNewBusiness, undefined, "BO ya no lleva el flag");
assert.equal(boliviaEntry.defaultCurrencyCode, "BOB");
assert.equal(boliviaEntry.baseTax.rate, 13);
const legacyOtherCountry = catalog.countries.find((country) => country.code === "OTHER");
assert.equal(legacyOtherCountry?.active, true);
assert.equal(legacyOtherCountry?.selectableForNewBusiness, false);
assert.equal(legacyOtherCountry?.legacy, true);
// SPEC 036: `decimals` es el formato; `amountDecimals` son los decimales de CÁLCULO de los importes. Nunca supera
// a `decimals`. Entrega D: BOB calcula con 2 decimales (el rollback es volver a 0); todas las demás monedas siguen en 0.
for (const currency of catalog.currencies) {
  assert.ok(Number.isInteger(currency.amountDecimals), `${currency.code}: amountDecimals definido`);
  assert.ok(currency.amountDecimals >= 0 && currency.amountDecimals <= currency.decimals, `${currency.code}: amountDecimals <= decimals`);
  assert.equal(currency.amountDecimals, currency.code === "BOB" ? 2 : 0, `${currency.code}: amountDecimals (solo BOB calcula con 2 decimales)`);
  assert.equal(getCurrencyAmountDecimals(currency.code), currency.amountDecimals, `${currency.code}: el helper lee el catálogo`);
}
assert.equal(catalog.currencies.find((currency) => currency.code === "BOB").decimals, 2);
for (const code of ["", "bob-x", null, undefined, "XXX"]) assert.equal(getCurrencyAmountDecimals(code), 0, `moneda desconocida: ${code}`);
assert.equal(getCurrencyAmountDecimals("bob"), 2, "el código se normaliza a mayúsculas: BOB calcula con 2 decimales");
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
// Rubros para empresas nuevas (Bolivia piloto, SPEC 035): Tecnología e informática; Electricidad, energía y
// climatización; Taller automotriz; Clínica veterinaria; Ingeniería y consultoría técnica y Otro servicio
// (en pantalla, "Otro servicio técnico o profesional"). Los demás siguen en el catálogo y activos.
const expectedV1Categories = [
  ["TECNOLOGIA_INFORMATICA", "Tecnología e informática"],
  ["ELECTRICIDAD_ENERGIA_CLIMATIZACION", "Electricidad, energía y climatización"],
  ["TALLER_AUTOMOTRIZ", "Taller automotriz"],
  ["CLINICA_VETERINARIA", "Clínica veterinaria"],
  ["INGENIERIA_CONSULTORIA", "Ingeniería y consultoría técnica"],
  ["OTRO_SERVICIO_PROYECTOS", "Otro servicio por proyectos"],
];
const selectableCategories = catalog.businessCategories.filter((category) =>
  isSelectableBusinessCategory(category, catalog.businessCategoryCatalogVersion)
);
assert.equal(selectableCategories.length, 6);
assert.deepEqual(
  selectableCategories.map(({ code, name }) => [code, name]),
  expectedV1Categories
);
// Rubros que dejaron de ser seleccionables: siguen en el catálogo y activos.
for (const code of [
  "SEGURIDAD_TELECOMUNICACIONES",
  "AUTOMATIZACION_CONTROL",
  "MANTENIMIENTO_INSTALACIONES",
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

// Etiqueta del identificador fiscal por país (la usa el paso 1 del onboarding): RUT en Chile, NIT en Bolivia.
assert.equal(getDefaultFiscalIdentifierLabel("CL"), "RUT");
assert.equal(getDefaultFiscalIdentifierLabel("BO"), "NIT");
assert.equal(getDefaultFiscalIdentifierLabel(""), "RUT", "sin país elegido, la de Chile");
assert.equal(getDefaultFiscalIdentifierLabel(undefined), "RUT");

// Nota fiscal del alta: qué se calcula (IVA con la tasa del país, del catálogo) y qué no se incluye.
assert.equal(
  getCountryFiscalNote("BO"),
  "ValoraCloud calcula el IVA con la tasa de Bolivia (13 %). La facturación y los impuestos propios de Bolivia, como el IT, no están incluidos."
);
assert.equal(getCountryFiscalNote("CL"), "", "Chile no lleva nota");
assert.equal(getCountryFiscalNote(""), "");
assert.equal(getCountryFiscalNote("BR"), "", "sin impuesto base configurado no hay nota");
assert.equal(getCountryFiscalNote("OTHER"), "");
assert.match(getCountryFiscalNote("PY"), /^ValoraCloud calcula el IVA con la tasa de Paraguay \(10 %\)\. La facturación y los impuestos propios de Paraguay no están incluidos\.$/, "otro país: misma frase, sin ejemplo inventado");
assert.doesNotMatch(getCountryFiscalNote("BO"), /revisión|pensadas/);

// Departamentos de Bolivia (9, sin lista de municipios) y helpers por país.
const bolivia = catalog.territoriesByCountry?.BO;
assert.equal(bolivia?.regionLabel, "Departamento");
assert.deepEqual(
  bolivia.regions.map(({ code, name }) => [code, name]),
  [
    ["LP", "La Paz"],
    ["CB", "Cochabamba"],
    ["SC", "Santa Cruz"],
    ["OR", "Oruro"],
    ["PO", "Potosí"],
    ["CH", "Chuquisaca"],
    ["TJ", "Tarija"],
    ["BE", "Beni"],
    ["PD", "Pando"],
  ]
);
assert.equal(new Set(bolivia.regions.map((region) => region.code)).size, 9);
for (const region of bolivia.regions) {
  assert.match(region.code, /^[A-Z]{2}$/);
  assert.equal(region.communes, undefined, "sin lista de municipios");
}
assert.deepEqual(Object.keys(catalog.territoriesByCountry), ["BO"], "solo Bolivia tiene catálogo propio; Chile sigue en regions");
assert.equal(hasRegionCatalog("CL"), true);
assert.equal(hasRegionCatalog("BO"), true);
assert.equal(hasRegionCatalog("PY"), false, "un país sin catálogo no ofrece lista de regiones");
assert.equal(hasRegionCatalog(""), false);
assert.equal(getRegionsForCountry("CL").length, 16);
assert.equal(getRegionsForCountry("BO").length, 9);
assert.deepEqual(getRegionsForCountry("PY"), []);
assert.equal(getRegionLabel("CL"), "Región");
assert.equal(getRegionLabel("BO"), "Departamento");
assert.equal(getRegionLabel("PY"), "Región");
assert.equal(getRegionForCountry("BO", "SC")?.name, "Santa Cruz");
assert.equal(getRegionForCountry("BO", "13"), null, "un código de Chile no es un departamento");
assert.equal(getRegionForCountry("CL", "13")?.name, "Metropolitana de Santiago");
assert.equal(getRegionForCountry("CL", "SC"), null);
assert.equal(findRegionCodeByName("BO", "potosi"), "PO");
assert.equal(findRegionCodeByName("BO", "  SANTA   cruz "), "SC");
assert.equal(findRegionCodeByName("BO", "Florida"), "");

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
