import assert from "node:assert/strict";
import {
  adaptContactTerritoryForCountry,
  clearContactTerritory,
  getContactTerritoryConfig,
} from "../src/domain/contactTerritory.mjs";

const expectedLabels = {
  CL: ["Región", "Comuna", true],
  BO: ["Departamento", "Municipio", false],
  BR: ["Estado", "Municipio", false],
  PE: ["Departamento", "Distrito", false],
  AR: ["Provincia", "Localidad", false],
  CO: ["Departamento", "Municipio", false],
  EC: ["Provincia", "Cantón", false],
  PY: ["Departamento", "Distrito", false],
  UY: ["Departamento", "Localidad", false],
  MX: ["Estado", "Municipio", false],
};

for (const [code, [primaryLabel, secondaryLabel, hasCatalog]] of Object.entries(expectedLabels)) {
  assert.deepEqual(getContactTerritoryConfig(code), {
    countryCode: code,
    primaryLabel,
    secondaryLabel,
    hasCatalog,
  });
}

const territory = {
  regionCodigo: "13",
  regionNombre: "Región Metropolitana de Santiago",
  comunaCodigo: "13101",
  comunaNombre: "Santiago",
  razonSocial: "Proveedor de prueba",
};
assert.deepEqual(adaptContactTerritoryForCountry(territory, "CL", "CL"), territory);
assert.deepEqual(adaptContactTerritoryForCountry(territory, "MX", "MX"), {
  ...territory,
  regionCodigo: "",
  comunaCodigo: "",
});
assert.deepEqual(adaptContactTerritoryForCountry(territory, "PE", "CL"), {
  ...territory,
  regionCodigo: "",
  regionNombre: "",
  comunaCodigo: "",
  comunaNombre: "",
});
assert.equal(clearContactTerritory(territory).razonSocial, "Proveedor de prueba");
assert.equal(getContactTerritoryConfig("ZZ").primaryLabel, "Región, estado o provincia");

console.log("CONTACT_TERRITORY_SMOKE_OK", JSON.stringify({countries: Object.keys(expectedLabels).length}));
