export const VETERINARY_APPOINTMENT_STATUSES =
  Object.freeze([
    "agendada",
    "confirmada",
    "cancelada",
    "completada",
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


function normalizeDate(value) {
  return normalizeText(
    value,
    10
  );
}


function normalizeTime(value) {
  return normalizeText(
    value,
    5
  );
}


function isValidIsoDate(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value
    )
  ) {
    return false;
  }

  const [
    year,
    month,
    day,
  ] = value
    .split("-")
    .map(Number);

  const date =
    new Date(
      year,
      month - 1,
      day
    );

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}


function isValidTime(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(
    value
  );
}


function getTodayIsoDate() {
  const now = new Date();

  const year =
    now.getFullYear();

  const month =
    String(
      now.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      now.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
}


export function getVeterinaryAppointmentFieldErrors(
  rawData = {}
) {
  const data =
    rawData &&
    typeof rawData === "object"
      ? rawData
      : {};

  const errors = {};

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

  const fecha =
    normalizeDate(
      data.fecha
    );

  const hora =
    normalizeTime(
      data.hora
    );

  const motivo =
    normalizeText(
      data.motivo,
      500
    );

  const observaciones =
    normalizeText(
      data.observaciones,
      2000
    );


  if (!pacienteId) {
    errors.pacienteId =
      "Selecciona un paciente.";
  }


  if (!tutorClienteId) {
    errors.tutorClienteId =
      "La reserva debe estar asociada al tutor del paciente.";
  }


  if (!fecha) {
    errors.fecha =
      "Selecciona una fecha.";
  } else if (
    !isValidIsoDate(fecha)
  ) {
    errors.fecha =
      "Ingresa una fecha válida.";
  } else if (
    fecha < getTodayIsoDate()
  ) {
    errors.fecha =
      "La fecha de la reserva no puede ser anterior a hoy.";
  }


  if (!hora) {
    errors.hora =
      "Selecciona una hora.";
  } else if (
    !isValidTime(hora)
  ) {
    errors.hora =
      "Ingresa una hora válida en formato HH:mm.";
  }


  if (!motivo) {
    errors.motivo =
      "Ingresa el motivo de la reserva.";
  }


  if (
    motivo.length > 500
  ) {
    errors.motivo =
      "El motivo es demasiado largo.";
  }


  if (
    observaciones.length > 2000
  ) {
    errors.observaciones =
      "Las observaciones son demasiado largas.";
  }


  return errors;
}


export function buildVeterinaryAppointmentMutationPayload(
  rawData = {}
) {
  const errors =
    getVeterinaryAppointmentFieldErrors(
      rawData
    );

  if (
    Object.keys(errors).length > 0
  ) {
    const error =
      new Error(
        "Los datos de la reserva contienen errores."
      );

    error.fieldErrors =
      errors;

    throw error;
  }


  return {
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

    fecha:
      normalizeDate(
        rawData.fecha
      ),

    hora:
      normalizeTime(
        rawData.hora
      ),

    motivo:
      normalizeText(
        rawData.motivo,
        500
      ),

    observaciones:
      normalizeText(
        rawData.observaciones,
        2000
      ),
  };
}


export function hasVeterinaryAppointmentSlotConflict(
  appointments = [],
  candidate = {},
  ignoredAppointmentId = ""
) {
  const fecha =
    normalizeDate(
      candidate.fecha
    );

  const hora =
    normalizeTime(
      candidate.hora
    );

  if (
    !fecha ||
    !hora
  ) {
    return false;
  }


  return appointments.some(
    (appointment) => {

      const appointmentId =
        appointment.citaId ||
        appointment.id ||
        "";

      if (
        ignoredAppointmentId &&
        appointmentId ===
          ignoredAppointmentId
      ) {
        return false;
      }


      const status =
        normalizeText(
          appointment.estado,
          40
        ).toLowerCase();


      if (
        status === "cancelada"
      ) {
        return false;
      }


      return (
        normalizeDate(
          appointment.fecha
        ) === fecha &&
        normalizeTime(
          appointment.hora
        ) === hora
      );
    }
  );
}