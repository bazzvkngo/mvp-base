// Recepción del Taller (prototipo «Panel del Taller»): relato del cliente, kilometraje, nivel de
// combustible y sensores encendidos del tablero. Las fotos se registran aparte
// (workOrderReceptionPhotoModel.mjs). Los valores admitidos coinciden con functions/workOrderPersistence.js.
export const RECEPTION_FUEL_LEVELS = Object.freeze([
  {value: "Reserva", label: "Reserva"},
  {value: "1/4", label: "1/4"},
  {value: "1/2", label: "1/2"},
  {value: "3/4", label: "3/4"},
  {value: "Lleno", label: "Lleno"},
]);

export const RECEPTION_WARNING_LIGHTS = Object.freeze([
  {value: "check-engine", label: "Check engine"},
  {value: "abs", label: "ABS"},
  {value: "airbag", label: "Airbag"},
  {value: "bateria", label: "Batería"},
  {value: "aceite", label: "Aceite"},
  {value: "temperatura", label: "Temperatura"},
  {value: "frenos", label: "Frenos"},
]);

// Frases rápidas para armar el relato; se agregan al texto, no lo reemplazan.
export const RECEPTION_QUICK_REASONS = Object.freeze([
  "Ruido en frenos", "Vibración", "Luz encendida", "Mantención", "Fuga",
]);

export const MAX_RECEPTION_MILEAGE_KM = 2_000_000;
export const MAX_RECEPTION_REASON_LENGTH = 1000;

export function emptyReceptionValues() {
  return {
    motivoCliente: "", kilometraje: "", nivelCombustible: "", testigosEncendidos: null, testigos: [],
    ingresaNombre: "", ingresaDocumento: "", ingresaTieneDocumento: false,
  };
}

export function receptionValuesFromStored(recepcion) {
  if (!recepcion) return emptyReceptionValues();
  return {
    motivoCliente: String(recepcion.motivoCliente || ""),
    kilometraje: recepcion.kilometraje == null ? "" : String(recepcion.kilometraje),
    nivelCombustible: String(recepcion.nivelCombustible || ""),
    testigosEncendidos: typeof recepcion.testigosEncendidos === "boolean" ? recepcion.testigosEncendidos : null,
    testigos: Array.isArray(recepcion.testigos) ? [...recepcion.testigos] : [],
    ingresaNombre: String(recepcion.ingresaNombre || ""),
    ingresaDocumento: "", // el documento no viaja a la pantalla: solo se informa si ya está registrado
    ingresaTieneDocumento: recepcion.ingresaTieneDocumento === true,
  };
}

export function getReceptionWarningLightLabel(value) {
  return RECEPTION_WARNING_LIGHTS.find((light) => light.value === value)?.label || value;
}

// Agrega una frase rápida al relato, separada por un punto.
export function appendReceptionReason(current, reason) {
  const base = String(current || "").trim();
  const next = base ? `${base.replace(/[.\s]+$/, "")}. ${reason}` : reason;
  return next.slice(0, MAX_RECEPTION_REASON_LENGTH);
}

function mileageError(value) {
  const mileage = Number(value);
  if (String(value ?? "").trim() === "" || !Number.isSafeInteger(mileage) || mileage <= 0) {
    return "Ingresa un kilometraje entero mayor que cero.";
  }
  if (mileage > MAX_RECEPTION_MILEAGE_KM) {
    return `El kilometraje no puede superar ${MAX_RECEPTION_MILEAGE_KM.toLocaleString("es-CL")} km.`;
  }
  return "";
}

export function getReceptionFieldErrors(values) {
  const errors = {};
  if (!String(values.motivoCliente || "").trim()) errors.motivoCliente = "Escribe el motivo de ingreso que indica el cliente.";
  const mileage = mileageError(values.kilometraje);
  if (mileage) errors.kilometraje = mileage;
  if (!RECEPTION_FUEL_LEVELS.some(({value}) => value === values.nivelCombustible)) {
    errors.nivelCombustible = "Indica el nivel de combustible.";
  }
  if (typeof values.testigosEncendidos !== "boolean") {
    errors.testigos = "Indica si hay sensores encendidos en el tablero.";
  } else if (values.testigosEncendidos && !(values.testigos || []).length) {
    errors.testigos = "Elige cuáles sensores están encendidos.";
  }
  if (!String(values.ingresaNombre || "").trim()) errors.ingresaNombre = "Escribe el nombre de quien entrega el vehículo.";
  if (!String(values.ingresaDocumento || "").trim() && values.ingresaTieneDocumento !== true) {
    errors.ingresaDocumento = "Escribe el RUT de quien entrega el vehículo.";
  }
  return errors;
}

// Requisitos para registrar la recepción, en el orden del prototipo. `photos` viene de receptionPhotoProgress.
export function receptionRequirements(values, photos) {
  const lightsAnswered = values.testigosEncendidos === false ||
    (values.testigosEncendidos === true && (values.testigos || []).length > 0);
  return [
    {label: "Relato del cliente", done: String(values.motivoCliente || "").trim().length > 0},
    {label: "Nombre y RUT de quien entrega",
      done: Boolean(String(values.ingresaNombre || "").trim()) &&
        (Boolean(String(values.ingresaDocumento || "").trim()) || values.ingresaTieneDocumento === true)},
    {label: `6 fotos del vehículo (${photos.completedVehicle}/${photos.totalVehicle})`,
      done: photos.completedVehicle === photos.totalVehicle},
    {label: "Foto del tablero", done: photos.dashboard.completed},
    {label: "Kilometraje", done: !mileageError(values.kilometraje)},
    {label: "Nivel de combustible", done: RECEPTION_FUEL_LEVELS.some(({value}) => value === values.nivelCombustible)},
    {label: `Sensores indicados${values.testigosEncendidos === true && !lightsAnswered ? " (elige cuáles)" : ""}`,
      done: lightsAnswered},
  ];
}

export function buildReceptionMutationPayload(values) {
  return {
    motivoCliente: String(values.motivoCliente || "").trim(),
    kilometraje: Number(values.kilometraje),
    nivelCombustible: String(values.nivelCombustible || "").trim(),
    testigosEncendidos: values.testigosEncendidos === true,
    testigos: values.testigosEncendidos === true
      ? RECEPTION_WARNING_LIGHTS.map((light) => light.value).filter((value) => (values.testigos || []).includes(value))
      : [],
    ingresaNombre: String(values.ingresaNombre || "").trim(),
    ingresaDocumento: String(values.ingresaDocumento || "").trim(),
  };
}
