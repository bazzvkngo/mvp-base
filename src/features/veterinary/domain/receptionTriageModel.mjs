export const VETERINARY_TRIAGE_PRIORITIES =
  Object.freeze([
    "normal",
    "prioritaria",
    "urgente",
  ]);


function normalizeText(
  value,
  maxLength = 500
) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}


function normalizeTime(value) {
  return normalizeText(
    value,
    5
  );
}


function normalizeNumber(value) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function normalizeInteger(value) {
  const number =
    normalizeNumber(value);

  if (number === null) {
    return null;
  }

  return Number.isInteger(number)
    ? number
    : null;
}


function isValidTime(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(
    value
  );
}


function isAllowedPriority(value) {
  return (
    VETERINARY_TRIAGE_PRIORITIES
      .includes(value)
  );
}


export function canStartVeterinaryReception(
  appointment = {}
) {
  const status =
    normalizeText(
      appointment.estado,
      40
    ).toLowerCase();

  return (
    status === "agendada" ||
    status === "confirmada"
  );
}


export function getVeterinaryReceptionFieldErrors(
  rawData = {}
) {
  const data =
    rawData &&
    typeof rawData === "object"
      ? rawData
      : {};

  const errors = {};


  const citaId =
    normalizeText(
      data.citaId,
      120
    );

  const pacienteId =
    normalizeText(
      data.pacienteId,
      120
    );

  const tutorClienteId =
    normalizeText(
      data.tutorClienteId,
      120
    );

  const horaLlegada =
    normalizeTime(
      data.horaLlegada
    );

  const observacionesRecepcion =
    normalizeText(
      data.observacionesRecepcion,
      1000
    );


  if (!citaId) {
    errors.citaId =
      "La recepción debe estar asociada a una cita.";
  }


  if (!pacienteId) {
    errors.pacienteId =
      "La recepción debe estar asociada a un paciente.";
  }


  if (!tutorClienteId) {
    errors.tutorClienteId =
      "La recepción debe estar asociada al tutor del paciente.";
  }


  if (!horaLlegada) {
    errors.horaLlegada =
      "Ingresa la hora de llegada.";
  } else if (
    !isValidTime(
      horaLlegada
    )
  ) {
    errors.horaLlegada =
      "Ingresa una hora válida en formato HH:mm.";
  }


  if (
    observacionesRecepcion.length >
    1000
  ) {
    errors.observacionesRecepcion =
      "Las observaciones de recepción son demasiado largas.";
  }


  return errors;
}


export function buildVeterinaryReceptionMutationPayload(
  rawData = {}
) {
  const errors =
    getVeterinaryReceptionFieldErrors(
      rawData
    );


  if (
    Object.keys(errors).length >
    0
  ) {
    const error =
      new Error(
        "Los datos de recepción contienen errores."
      );

    error.fieldErrors =
      errors;

    throw error;
  }


  return {
    citaId:
      normalizeText(
        rawData.citaId,
        120
      ),

    pacienteId:
      normalizeText(
        rawData.pacienteId,
        120
      ),

    tutorClienteId:
      normalizeText(
        rawData.tutorClienteId,
        120
      ),

    horaLlegada:
      normalizeTime(
        rawData.horaLlegada
      ),

    observacionesRecepcion:
      normalizeText(
        rawData.observacionesRecepcion,
        1000
      ),
  };
}


export function getVeterinaryTriageFieldErrors(
  rawData = {}
) {
  const data =
    rawData &&
    typeof rawData === "object"
      ? rawData
      : {};

  const errors = {};


  const citaId =
    normalizeText(
      data.citaId,
      120
    );

  const pacienteId =
    normalizeText(
      data.pacienteId,
      120
    );

  const prioridad =
    normalizeText(
      data.prioridad,
      40
    ).toLowerCase();

  const pesoKg =
    normalizeNumber(
      data.pesoKg
    );

  const temperaturaC =
    normalizeNumber(
      data.temperaturaC
    );

  const frecuenciaCardiaca =
    normalizeInteger(
      data.frecuenciaCardiaca
    );

  const frecuenciaRespiratoria =
    normalizeInteger(
      data.frecuenciaRespiratoria
    );

  const observacionesTriage =
    normalizeText(
      data.observacionesTriage,
      2000
    );


  if (!citaId) {
    errors.citaId =
      "El triage debe estar asociado a una cita.";
  }


  if (!pacienteId) {
    errors.pacienteId =
      "El triage debe estar asociado a un paciente.";
  }


  if (!prioridad) {
    errors.prioridad =
      "Selecciona una prioridad.";
  } else if (
    !isAllowedPriority(
      prioridad
    )
  ) {
    errors.prioridad =
      "Selecciona una prioridad válida.";
  }


  if (
    data.pesoKg !== "" &&
    data.pesoKg !== null &&
    data.pesoKg !== undefined
  ) {
    if (
      pesoKg === null ||
      pesoKg <= 0
    ) {
      errors.pesoKg =
        "El peso debe ser mayor que cero.";
    }
  }


  if (
    data.temperaturaC !== "" &&
    data.temperaturaC !== null &&
    data.temperaturaC !== undefined
  ) {
    if (
      temperaturaC === null ||
      temperaturaC <= 0
    ) {
      errors.temperaturaC =
        "La temperatura debe ser mayor que cero.";
    }
  }


  if (
    data.frecuenciaCardiaca !== "" &&
    data.frecuenciaCardiaca !== null &&
    data.frecuenciaCardiaca !== undefined
  ) {
    if (
      frecuenciaCardiaca === null ||
      frecuenciaCardiaca <= 0
    ) {
      errors.frecuenciaCardiaca =
        "La frecuencia cardíaca debe ser un número entero mayor que cero.";
    }
  }


  if (
    data.frecuenciaRespiratoria !== "" &&
    data.frecuenciaRespiratoria !== null &&
    data.frecuenciaRespiratoria !== undefined
  ) {
    if (
      frecuenciaRespiratoria === null ||
      frecuenciaRespiratoria <= 0
    ) {
      errors.frecuenciaRespiratoria =
        "La frecuencia respiratoria debe ser un número entero mayor que cero.";
    }
  }


  if (
    observacionesTriage.length >
    2000
  ) {
    errors.observacionesTriage =
      "Las observaciones de triage son demasiado largas.";
  }


  return errors;
}


export function buildVeterinaryTriageMutationPayload(
  rawData = {}
) {
  const errors =
    getVeterinaryTriageFieldErrors(
      rawData
    );


  if (
    Object.keys(errors).length >
    0
  ) {
    const error =
      new Error(
        "Los datos de triage contienen errores."
      );

    error.fieldErrors =
      errors;

    throw error;
  }


  return {
    citaId:
      normalizeText(
        rawData.citaId,
        120
      ),

    pacienteId:
      normalizeText(
        rawData.pacienteId,
        120
      ),

    prioridad:
      normalizeText(
        rawData.prioridad,
        40
      ).toLowerCase(),

    pesoKg:
      normalizeNumber(
        rawData.pesoKg
      ),

    temperaturaC:
      normalizeNumber(
        rawData.temperaturaC
      ),

    frecuenciaCardiaca:
      normalizeInteger(
        rawData.frecuenciaCardiaca
      ),

    frecuenciaRespiratoria:
      normalizeInteger(
        rawData.frecuenciaRespiratoria
      ),

    observacionesTriage:
      normalizeText(
        rawData.observacionesTriage,
        2000
      ),
  };
}