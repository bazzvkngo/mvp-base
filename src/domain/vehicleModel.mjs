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
const PLATE_PATTERNS = Object.freeze([
  /^[A-Z]{4}\d{2}$/,
  /^[A-Z]{3}\d{2}$/,
  /^[A-Z]{5}\d$/,
  /^[A-Z]{4}\d$/,
]);
const TEXT_ONLY_PATTERN = /^\p{L}(?:[\p{L}\s.'-]*\p{L})?$/u;
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
    errors.patente = "Ingresa una patente válida sin guiones, por ejemplo ABCD12.";
  }
  if (normalizedText(raw.marca) && !isTextOnly(raw.marca)) {
    errors.marca = "La marca solo puede contener texto.";
  }
  if (normalizedText(raw.color) && !isTextOnly(raw.color)) {
    errors.color = "El color solo puede contener texto.";
  }
  const anio = Number(normalizedText(raw.anio));
  if (normalizedText(raw.anio) && (
    !Number.isSafeInteger(anio) || anio < 1 || anio > 9999
  )) {
    errors.anio = "El año debe ser un número entero válido.";
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
