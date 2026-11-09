export const VETERINARY_PATIENT_STATUSES = Object.freeze([
  "activo",
  "inactivo",
  "fallecido",
]);

const PATIENT_TEXT_FIELDS = Object.freeze({
  tutorClienteId: {
    maxLength: 160,
    label: "tutor",
  },
  nombre: {
    maxLength: 160,
    label: "nombre",
  },
  especie: {
    maxLength: 100,
    label: "especie",
  },
  raza: {
    maxLength: 120,
    label: "raza",
  },
  sexo: {
    maxLength: 40,
    label: "sexo",
  },
  edadEstimada: {
    maxLength: 80,
    label: "edad estimada",
  },
  color: {
    maxLength: 120,
    label: "color",
  },
  microchip: {
    maxLength: 100,
    label: "microchip",
  },
  alergias: {
    maxLength: 2000,
    label: "alergias",
  },
  antecedentes: {
    maxLength: 4000,
    label: "antecedentes",
  },
  observaciones: {
    maxLength: 4000,
    label: "observaciones",
  },
});

function createPatientError(message, fieldErrors = null) {
  const error = new Error(message);
  error.code = "veterinary-patient/invalid-data";

  if (fieldErrors) {
    error.fieldErrors = fieldErrors;
  }

  return error;
}

export function normalizeVeterinaryPatientText(
  value,
  maxLength = 240,
  fieldLabel = "texto"
) {
  if (value == null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    throw createPatientError(
      `El campo ${fieldLabel} debe ser texto.`
    );
  }

  const normalized = value
    .trim()
    .replace(/\s+/g, " ");

  if (normalized.length > maxLength) {
    throw createPatientError(
      `El campo ${fieldLabel} no puede superar ${maxLength} caracteres.`
    );
  }

  return normalized;
}

export function normalizeVeterinaryPatientDate(value) {
  if (value == null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    throw createPatientError(
      "La fecha de nacimiento debe ser una fecha válida."
    );
  }

  const normalized = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createPatientError(
      "La fecha de nacimiento debe usar el formato AAAA-MM-DD. (año-mes-día)"
    );
  }

  const [year, month, day] = normalized
    .split("-")
    .map(Number);

  const parsed = new Date(
    Date.UTC(year, month - 1, day)
  );

  const valid =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  if (!valid) {
    throw createPatientError(
      "La fecha de nacimiento no es válida."
    );
  }

  return normalized;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function normalizeVeterinaryPatientWeight(value) {
  if (
    value == null ||
    value === ""
  ) {
    return null;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw createPatientError(
      "El peso debe ser un número mayor que cero."
    );
  }

  return normalized;
}

export function getVeterinaryPatientFieldErrors(
  raw = {},
  { today = new Date() } = {}
) {
  const errors = {};
  const normalized = {};

  Object.entries(PATIENT_TEXT_FIELDS).forEach(
    ([field, { maxLength, label }]) => {
      try {
        normalized[field] =
          normalizeVeterinaryPatientText(
            raw?.[field],
            maxLength,
            label
          );
      } catch (error) {
        errors[field] = error.message;
        normalized[field] = "";
      }
    }
  );

  if (!errors.tutorClienteId && !normalized.tutorClienteId) {
    errors.tutorClienteId =
      "Selecciona un tutor registrado.";
  }

  if (!errors.nombre && !normalized.nombre) {
    errors.nombre =
      "Ingresa el nombre del paciente.";
  }

  if (!errors.especie && !normalized.especie) {
    errors.especie =
      "Ingresa la especie del paciente.";
  }

  try {
    const fechaNacimiento =
      normalizeVeterinaryPatientDate(
        raw?.fechaNacimiento
      );

    if (
      fechaNacimiento &&
      fechaNacimiento > formatLocalDate(today)
    ) {
      errors.fechaNacimiento =
        "La fecha de nacimiento no puede ser futura.";
    }
  } catch (error) {
    errors.fechaNacimiento = error.message;
  }

  try {
    normalizeVeterinaryPatientWeight(raw?.peso);
  } catch (error) {
    errors.peso = error.message;
  }

  return errors;
}

export function buildVeterinaryPatientMutationPayload(
  raw = {},
  options = {}
) {
  const errors = getVeterinaryPatientFieldErrors(
    raw,
    options
  );

  if (Object.keys(errors).length > 0) {
    throw createPatientError(
      Object.values(errors)[0],
      errors
    );
  }

  return {
    tutorClienteId:
      normalizeVeterinaryPatientText(
        raw.tutorClienteId,
        160,
        "tutor"
      ),

    nombre:
      normalizeVeterinaryPatientText(
        raw.nombre,
        160,
        "nombre"
      ),

    especie:
      normalizeVeterinaryPatientText(
        raw.especie,
        100,
        "especie"
      ),

    raza:
      normalizeVeterinaryPatientText(
        raw.raza,
        120,
        "raza"
      ),

    sexo:
      normalizeVeterinaryPatientText(
        raw.sexo,
        40,
        "sexo"
      ),

    fechaNacimiento:
      normalizeVeterinaryPatientDate(
        raw.fechaNacimiento
      ),

    edadEstimada:
      normalizeVeterinaryPatientText(
        raw.edadEstimada,
        80,
        "edad estimada"
      ),

    peso:
      normalizeVeterinaryPatientWeight(
        raw.peso
      ),

    color:
      normalizeVeterinaryPatientText(
        raw.color,
        120,
        "color"
      ),

    microchip:
      normalizeVeterinaryPatientText(
        raw.microchip,
        100,
        "microchip"
      ),

    alergias:
      normalizeVeterinaryPatientText(
        raw.alergias,
        2000,
        "alergias"
      ),

    antecedentes:
      normalizeVeterinaryPatientText(
        raw.antecedentes,
        4000,
        "antecedentes"
      ),

    observaciones:
      normalizeVeterinaryPatientText(
        raw.observaciones,
        4000,
        "observaciones"
      ),
  };
}