import assert from "node:assert/strict";
import catalog from "../functions/businessCatalog.json" with { type: "json" };

assert.equal(catalog.schemaVersion, 3);
assert.equal(catalog.countries.length, 11);
assert.equal(catalog.countries[0].code, "CL");
assert.equal(catalog.countries.find((country) => country.code === "BR").defaultLocale, "pt-BR");
assert.equal(catalog.currencies.length, 11);
assert.equal(catalog.currencies[0].code, "CLP");
assert.ok(catalog.currencies.some((currency) => currency.code === "BOB"));
assert.ok(catalog.currencies.some((currency) => currency.code === "BRL"));
assert.ok(catalog.currencies.some((currency) => currency.code === "PEN"));
assert.ok(catalog.currencies.some((currency) => currency.code === "USD"));
assert.ok(catalog.businessCategories.some((category) => category.code === "OTRO"));
assert.equal(catalog.businessCategorySectors.length, 6);
assert.ok(catalog.businessCategories.length >= 68);
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
for (const expectedCode of [
  "ROPA_VESTUARIO",
  "RESTAURANTE",
  "TALLER_MECANICO",
  "TECNOLOGIA_SOFTWARE",
  "EDUCACION_CAPACITACION",
  "INDUSTRIA_MANUFACTURA",
  "GANADERIA",
  "OTRO",
]) {
  assert.ok(catalog.businessCategories.some(({ code }) => code === expectedCode));
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
  JSON.stringify({ regions: catalog.regions.length, communes: communes.length })
);
