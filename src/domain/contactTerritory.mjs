const TERRITORY_CONFIGS = Object.freeze({
  CL: {primaryLabel: "Región", secondaryLabel: "Comuna", hasCatalog: true},
  BO: {primaryLabel: "Departamento", secondaryLabel: "Municipio"},
  BR: {primaryLabel: "Estado", secondaryLabel: "Municipio"},
  PE: {primaryLabel: "Departamento", secondaryLabel: "Distrito"},
  AR: {primaryLabel: "Provincia", secondaryLabel: "Localidad"},
  CO: {primaryLabel: "Departamento", secondaryLabel: "Municipio"},
  EC: {primaryLabel: "Provincia", secondaryLabel: "Cantón"},
  PY: {primaryLabel: "Departamento", secondaryLabel: "Distrito"},
  UY: {primaryLabel: "Departamento", secondaryLabel: "Localidad"},
  MX: {primaryLabel: "Estado", secondaryLabel: "Municipio"},
  OTHER: {primaryLabel: "Región, estado o provincia", secondaryLabel: "Ciudad o municipio"},
});

export const CONTACT_TERRITORY_FIELDS = Object.freeze([
  "regionCodigo",
  "regionNombre",
  "comunaCodigo",
  "comunaNombre",
]);

function countryCode(value) {
  return String(value || "").trim().toUpperCase() || "OTHER";
}

export function getContactTerritoryConfig(value) {
  const code = countryCode(value);
  return {
    countryCode: code,
    hasCatalog: false,
    ...(TERRITORY_CONFIGS[code] || TERRITORY_CONFIGS.OTHER),
  };
}

export function clearContactTerritory(values = {}) {
  return {
    ...values,
    regionCodigo: "",
    regionNombre: "",
    comunaCodigo: "",
    comunaNombre: "",
  };
}

export function adaptContactTerritoryForCountry(
  values = {},
  selectedCountryCode,
  storedCountryCode = selectedCountryCode
) {
  const selectedCountry = countryCode(selectedCountryCode);
  const storedCountry = countryCode(storedCountryCode);
  if (selectedCountry !== storedCountry) return clearContactTerritory(values);
  if (selectedCountry === "CL") return {...values};
  return {
    ...values,
    regionCodigo: "",
    comunaCodigo: "",
  };
}
