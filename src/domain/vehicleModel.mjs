export const VEHICLE_TYPES = Object.freeze([
  {value: "sedan", label: "Sedán"},
  {value: "hatchback", label: "Hatchback"},
  {value: "suv", label: "SUV"},
  {value: "pickup", label: "Pickup"},
  {value: "station_wagon", label: "Station Wagon"},
  {value: "furgon", label: "Furgón"},
  {value: "van", label: "Van"},
  {value: "coupe", label: "Coupé"},
  {value: "convertible", label: "Convertible"},
  {value: "otro", label: "Otro"},
]);

const VEHICLE_TYPE_VALUES = new Set(VEHICLE_TYPES.map(({value}) => value));
// Formatos ordinarios admitidos por país. Se validan en conjunto para que un
// taller pueda registrar vehículos matriculados en otro país.
export const VEHICLE_PLATE_PATTERNS_BY_COUNTRY = Object.freeze({
  CL: Object.freeze([
    /^[A-Z]{4}\d{2}$/,
    /^[A-Z]{3}\d{2}$/,
    /^[A-Z]{5}\d$/,
    /^[A-Z]{4}\d$/,
    /^[A-Z]{2}\d{4}$/,
    /^[A-Z]{2}\d{3}$/,
  ]),
  BO: Object.freeze([
    /^\d{3}[A-Z]{3}$/,
    /^\d{4}[A-Z]{3}$/,
    /^[A-Z]{3}\d{3}$/,
  ]),
});
const PLATE_PATTERNS = Object.freeze(
  Object.values(VEHICLE_PLATE_PATTERNS_BY_COUNTRY).flat()
);
const TEXT_ONLY_PATTERN = /^\p{L}(?:[\p{L}\s.'-]*\p{L})?$/u;
export const MIN_VEHICLE_YEAR = 1900;
export const MAX_VEHICLE_YEAR = new Date().getFullYear() + 1;
const VEHICLE_TEXT_LIMITS = Object.freeze({
  vin: [80, "El VIN"],
  marca: [120, "La marca"],
  modelo: [120, "El modelo"],
  color: [80, "El color"],
});
const REQUIRED_FIELDS = Object.freeze([
  ["patente", "La patente es obligatoria."],
  ["marca", "La marca es obligatoria."],
  ["modelo", "El modelo es obligatorio."],
  ["anio", "El año es obligatorio."],
  ["color", "El color es obligatorio."],
]);

function normalizedText(value) {
  return String(value ?? "").trim();
}

export function normalizeVehiclePlate(value) {
  return normalizedText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidVehiclePlate(value) {
  return PLATE_PATTERNS.some((pattern) => pattern.test(normalizeVehiclePlate(value)));
}

export function isTextOnly(value) {
  return TEXT_ONLY_PATTERN.test(normalizedText(value));
}

export function keepTextOnlyInput(value) {
  return String(value ?? "").replace(/[^\p{L}\s.'-]/gu, "");
}

export function keepVehicleYearInput(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 4);
}

export function getVehicleTypeLabel(value) {
  return VEHICLE_TYPES.find((item) => item.value === value)?.label || "Sin tipo";
}

export function adaptStoredVehicle(data = {}) {
  const vehiculoId = normalizedText(data.vehiculoId || data.id);
  return {
    ...data,
    vehiculoId,
    clienteId: normalizedText(data.clienteId),
    patente: normalizedText(data.patente),
    vin: normalizedText(data.vin),
    marca: normalizedText(data.marca),
    modelo: normalizedText(data.modelo),
    anio: Number(data.anio) || "",
    color: normalizedText(data.color),
    tipo: normalizedText(data.tipo),
  };
}

export function buildVehicleMutationPayload(raw = {}) {
  const anio = normalizedText(raw.anio);
  return {
    patente: normalizedText(raw.patente),
    vin: normalizedText(raw.vin),
    marca: normalizedText(raw.marca),
    modelo: normalizedText(raw.modelo),
    anio: anio ? Number(anio) : null,
    color: normalizedText(raw.color),
    tipo: normalizedText(raw.tipo),
  };
}

export function getVehicleFieldErrors(raw = {}, {requiresOwner = false} = {}) {
  const errors = {};
  for (const [field, message] of REQUIRED_FIELDS) {
    if (!normalizedText(raw[field])) errors[field] = message;
  }
  if (requiresOwner && !normalizedText(raw.clienteId)) {
    errors.clienteId = "Selecciona un cliente propietario.";
  }
  if (normalizedText(raw.patente) && !isValidVehiclePlate(raw.patente)) {
    errors.patente = "Ingresa una patente válida de Chile o Bolivia (formato ordinario).";
  }
  if (normalizedText(raw.marca) && !isTextOnly(raw.marca)) {
    errors.marca = "La marca solo puede contener texto.";
  }
  if (normalizedText(raw.color) && !isTextOnly(raw.color)) {
    errors.color = "El color solo puede contener texto.";
  }
  for (const [field, [maximum, label]] of Object.entries(VEHICLE_TEXT_LIMITS)) {
    if (normalizedText(raw[field]).length > maximum) {
      errors[field] = `${label} no puede superar ${maximum} caracteres.`;
    }
  }
  const rawYear = normalizedText(raw.anio);
  const anio = Number(rawYear);
  if (rawYear && (
    !/^\d{4}$/.test(rawYear) ||
    !Number.isSafeInteger(anio) ||
    anio < MIN_VEHICLE_YEAR ||
    anio > MAX_VEHICLE_YEAR
  )) {
    errors.anio = `El año debe tener 4 dígitos y estar entre ${MIN_VEHICLE_YEAR} y ${MAX_VEHICLE_YEAR}.`;
  }
  if (normalizedText(raw.tipo) && !VEHICLE_TYPE_VALUES.has(normalizedText(raw.tipo))) {
    errors.tipo = "Selecciona un tipo de vehículo válido.";
  }
  if (!normalizedText(raw.tipo)) errors.tipo = "Selecciona un tipo de vehículo.";
  return errors;
}

export function matchesVehicleSearch(vehicle, rawSearch) {
  const search = normalizedText(rawSearch).toLocaleLowerCase("es-CL");
  if (!search) return true;
  return [vehicle.patente, vehicle.vin, vehicle.marca, vehicle.modelo]
    .some((value) => normalizedText(value).toLocaleLowerCase("es-CL").includes(search));
}
