import { findRegionCodeByName, getRegionForCountry, getRegionsForCountry } from "./businessCatalog.js";

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

// Lista de regiones (departamentos) del catálogo de un país distinto de Chile. Vacía si el país no tiene
// catálogo: entonces la región se escribe como texto libre. Chile no pasa por aquí (tiene regiones y comunas).
export function getContactRegionOptions(value) {
  const code = countryCode(value);
  return code === "CL" ? [] : getRegionsForCountry(code);
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
  // País con catálogo de departamentos: se conserva el código válido, o se deduce del nombre guardado como
  // texto libre. El municipio siempre es texto libre (sin código). Sin catálogo no cambia nada respecto a antes.
  const catalogRegion = getRegionForCountry(selectedCountry, values.regionCodigo) || (() => {
    const matchedCode = findRegionCodeByName(selectedCountry, values.regionNombre);
    return matchedCode ? getRegionForCountry(selectedCountry, matchedCode) : null;
  })();
  return {
    ...values,
    regionCodigo: catalogRegion?.code || "",
    ...(catalogRegion ? {regionNombre: catalogRegion.name} : {}),
    comunaCodigo: "",
  };
}
