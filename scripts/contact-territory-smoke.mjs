import assert from "node:assert/strict";
import {
  adaptContactTerritoryForCountry,
  clearContactTerritory,
  getContactRegionOptions,
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
// Departamentos de Bolivia (del catálogo): la configuración no cambia, las opciones salen aparte.
assert.deepEqual(getContactRegionOptions("BO").map(({ code }) => code), ["LP", "CB", "SC", "OR", "PO", "CH", "TJ", "BE", "PD"]);
assert.deepEqual(getContactRegionOptions("CL"), [], "Chile tiene su propio catálogo con comunas");
for (const code of ["MX", "PE", "PY", "OTHER", "ZZ", ""]) assert.deepEqual(getContactRegionOptions(code), [], code);
const bolivianTerritory = { regionCodigo: "SC", regionNombre: "Santa Cruz", comunaCodigo: "", comunaNombre: "Montero", razonSocial: "Cliente" };
assert.deepEqual(adaptContactTerritoryForCountry(bolivianTerritory, "BO", "BO"), bolivianTerritory, "se conserva el código del departamento y el municipio de texto libre");
assert.deepEqual(
  adaptContactTerritoryForCountry({ ...bolivianTerritory, regionCodigo: "", regionNombre: "potosi" }, "BO", "BO"),
  { ...bolivianTerritory, regionCodigo: "PO", regionNombre: "Potosí" },
  "un nombre guardado como texto libre se reconoce en el catálogo"
);
assert.deepEqual(
  adaptContactTerritoryForCountry({ ...bolivianTerritory, regionCodigo: "", regionNombre: "Santa Cruz de la Sierra" }, "BO", "BO"),
  { ...bolivianTerritory, regionCodigo: "", regionNombre: "Santa Cruz de la Sierra" },
  "un texto que no está en el catálogo se conserva"
);
assert.deepEqual(
  adaptContactTerritoryForCountry({ ...bolivianTerritory, regionCodigo: "13" }, "BO", "BO"),
  { ...bolivianTerritory, regionCodigo: "SC" },
  "un código de Chile no vale en Bolivia (se resuelve por el nombre)"
);
assert.equal(adaptContactTerritoryForCountry(bolivianTerritory, "BO", "CL").regionNombre, "", "cambiar de país limpia el territorio");
assert.equal(clearContactTerritory(territory).razonSocial, "Proveedor de prueba");
assert.equal(getContactTerritoryConfig("ZZ").primaryLabel, "Región, estado o provincia");

console.log("CONTACT_TERRITORY_SMOKE_OK", JSON.stringify({countries: Object.keys(expectedLabels).length}));
