export const RECEPTION_CHECKLIST_FIELDS = Object.freeze([
  {
    name: "carroceriaPintura",
    label: "Carrocería y pintura",
    options: [
      ["SIN_DANOS_VISIBLES", "Sin daños visibles"],
      ["CON_OBSERVACIONES", "Con observaciones"],
      ["NO_REVISADO", "No revisado"],
    ],
  },
  {
    name: "vidriosEspejos",
    label: "Vidrios y espejos",
    options: [
      ["SIN_DANOS_VISIBLES", "Sin daños visibles"],
      ["CON_OBSERVACIONES", "Con observaciones"],
      ["NO_REVISADO", "No revisado"],
    ],
  },
  {
    name: "lucesOpticos",
    label: "Luces y ópticos",
    options: [
      ["SIN_DANOS_VISIBLES", "Sin daños visibles"],
      ["CON_OBSERVACIONES", "Con observaciones"],
      ["NO_REVISADO", "No revisado"],
    ],
  },
  {
    name: "neumaticosLlantas",
    label: "Neumáticos y llantas",
    options: [
      ["SIN_DANOS_VISIBLES", "Sin daños visibles"],
      ["CON_OBSERVACIONES", "Con observaciones"],
      ["NO_REVISADO", "No revisado"],
    ],
  },
  {
    name: "interior",
    label: "Interior",
    options: [
      ["SIN_DANOS_VISIBLES", "Sin daños visibles"],
      ["CON_OBSERVACIONES", "Con observaciones"],
      ["NO_REVISADO", "No revisado"],
    ],
  },
  {
    name: "tableroIndicadores",
    label: "Tablero e indicadores",
    options: [
      ["SIN_ALERTAS_VISIBLES", "Sin alertas visibles"],
      ["CON_ALERTAS", "Con alertas"],
      ["NO_REVISADO", "No revisado"],
    ],
  },
  {
    name: "encendido",
    label: "Encendido",
    options: [
      ["NORMAL", "Normal"],
      ["CON_DIFICULTAD", "Con dificultad"],
      ["NO_ENCIENDE", "No enciende"],
      ["NO_PROBADO", "No probado"],
    ],
  },
  {
    name: "fugasVisibles",
    label: "Fugas visibles",
    options: [
      ["NO_SE_OBSERVAN", "No se observan"],
      ["SE_OBSERVAN", "Se observan"],
      ["NO_REVISADO", "No revisado"],
    ],
  },
  {
    name: "nivelesVisibles",
    label: "Niveles visibles",
    options: [
      ["SIN_OBSERVACIONES", "Sin observaciones"],
      ["CON_OBSERVACIONES", "Con observaciones"],
      ["NO_REVISADO", "No revisado"],
    ],
  },
  {
    name: "estadoGeneral",
    label: "Estado general",
    options: [
      ["SIN_OBSERVACIONES", "Sin observaciones"],
      ["CON_OBSERVACIONES", "Con observaciones"],
    ],
  },
]);

export const RECEPTION_ANOMALY_VALUES = new Set([
  "CON_OBSERVACIONES",
  "CON_ALERTAS",
  "CON_DIFICULTAD",
  "NO_ENCIENDE",
  "SE_OBSERVAN",
]);

export const RECEPTION_FUEL_LEVELS = Object.freeze([
  {value: "Vacío", label: "Vacío"},
  {value: "1/4", label: "1/4"},
  {value: "1/2", label: "1/2"},
  {value: "3/4", label: "3/4"},
  {value: "Lleno", label: "Lleno"},
]);

export function emptyReceptionValues() {
  return {
    kilometraje: "",
    nivelCombustible: "",
    checklist: Object.fromEntries(RECEPTION_CHECKLIST_FIELDS.map(({name}) => [name, ""])),
    accesoriosTexto: "",
    danosObservados: "",
    observaciones: "",
  };
}

export function receptionValuesFromStored(recepcion) {
  if (!recepcion) return emptyReceptionValues();
  return {
    kilometraje: recepcion.kilometraje == null ? "" : String(recepcion.kilometraje),
    nivelCombustible: String(recepcion.nivelCombustible || ""),
    checklist: Object.fromEntries(RECEPTION_CHECKLIST_FIELDS.map(({name}) => [name, String(recepcion.checklist?.[name] || "")])),
    accesoriosTexto: Array.isArray(recepcion.accesorios) ? recepcion.accesorios.join("\n") : "",
    danosObservados: String(recepcion.danosObservados || ""),
    observaciones: String(recepcion.observaciones || ""),
  };
}

export function hasReceptionAnomaly(checklist = {}) {
  return Object.values(checklist).some((value) => RECEPTION_ANOMALY_VALUES.has(value));
}

export function isReceptionChecklistComplete(checklist = {}) {
  return RECEPTION_CHECKLIST_FIELDS.every(({name}) => Boolean(checklist[name]));
}

export function getReceptionFieldErrors(values) {
  const errors = {};
  const kilometraje = Number(values.kilometraje);
  if (!Number.isSafeInteger(kilometraje) || kilometraje < 0) errors.kilometraje = "Ingresa un kilometraje entero válido.";
  if (!String(values.nivelCombustible || "").trim()) {
    errors.nivelCombustible = "Indica el nivel de combustible.";
  } else if (!RECEPTION_FUEL_LEVELS.some(({value}) => value === values.nivelCombustible)) {
    errors.nivelCombustible = "Selecciona un nivel de combustible válido.";
  }
  for (const {name, label} of RECEPTION_CHECKLIST_FIELDS) {
    if (!values.checklist?.[name]) errors[name] = `Selecciona el estado de ${label.toLocaleLowerCase("es-CL")}.`;
  }
  if (isReceptionChecklistComplete(values.checklist)) {
    if (hasReceptionAnomaly(values.checklist)) {
      const description = String(values.danosObservados || "").trim();
      if (!description || description.toLocaleLowerCase("es-CL") === "ninguno" || description.length < 3) {
        errors.danosObservados = "Describe los daños u observaciones detectados.";
      }
    } else if (values.danosObservados !== "Ninguno") {
      errors.danosObservados = "Sin anomalías visibles, debe indicar exactamente Ninguno.";
    }
  }
  return errors;
}

export function buildReceptionMutationPayload(values) {
  return {
    kilometraje: Number(values.kilometraje),
    nivelCombustible: String(values.nivelCombustible || "").trim(),
    checklist: Object.fromEntries(RECEPTION_CHECKLIST_FIELDS.map(({name}) => [name, values.checklist?.[name] || ""])),
    accesorios: String(values.accesoriosTexto || "").split("\n").map((item) => item.trim()).filter(Boolean),
    danosObservados: String(values.danosObservados || "").trim(),
    observaciones: String(values.observaciones || "").trim(),
  };
}
