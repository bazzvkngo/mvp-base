import assert from "node:assert/strict";
import catalog from "../functions/businessCatalog.json" with { type: "json" };
import { isSelectableBusinessCategory } from "../src/domain/businessCategorySearch.mjs";

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
const expectedNewBusinessCountries = [
  ["CL", "CLP"],
  ["BO", "BOB"],
  ["BR", "BRL"],
  ["PE", "PEN"],
  ["AR", "ARS"],
  ["CO", "COP"],
  ["EC", "USD"],
  ["PY", "PYG"],
  ["UY", "UYU"],
  ["MX", "MXN"],
];
assert.deepEqual(
  catalog.countries
    .filter((country) => country.active !== false && country.selectableForNewBusiness !== false)
    .map(({code, defaultCurrencyCode}) => [code, defaultCurrencyCode]),
  expectedNewBusinessCountries
);
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
  ["SOFTWARE_SOLUCIONES_DIGITALES", "Software y soluciones digitales"],
  ["SEGURIDAD_TELECOMUNICACIONES", "Seguridad electrónica y telecomunicaciones"],
  ["ELECTRICIDAD_ENERGIA_CLIMATIZACION", "Electricidad, energía y climatización"],
  ["AUTOMATIZACION_CONTROL", "Automatización y control"],
  ["MANTENIMIENTO_INSTALACIONES", "Mantenimiento e instalaciones técnicas"],
  ["CONSTRUCCION_OBRAS", "Construcción y obras especializadas"],
  ["AUTOMOTRIZ_MOVILIDAD", "Automotriz y movilidad"],
  ["INGENIERIA_CONSULTORIA", "Ingeniería y consultoría técnica"],
  ["SERVICIOS_DIGITALES_CREATIVOS", "Servicios digitales y creativos"],
  ["OTRO_SERVICIO_PROYECTOS", "Otro servicio por proyectos"],
];
const selectableCategories = catalog.businessCategories.filter((category) =>
  isSelectableBusinessCategory(category, catalog.businessCategoryCatalogVersion)
);
assert.deepEqual(
  selectableCategories.map(({ code, name }) => [code, name]),
  expectedV1Categories
);
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
