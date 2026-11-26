function normalizeText(
  value,
  maxLength = 500
) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}


export function getVeterinaryClinicalConsultationFieldErrors(
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

  const motivoConsulta =
    normalizeText(
      data.motivoConsulta,
      1000
    );

  const anamnesis =
    normalizeText(
      data.anamnesis,
      4000
    );

  const examenClinico =
    normalizeText(
      data.examenClinico,
      4000
    );


  if (!citaId) {
    errors.citaId =
      "La consulta debe estar asociada a una cita.";
  }


  if (!pacienteId) {
    errors.pacienteId =
      "La consulta debe estar asociada a un paciente.";
  }


  if (!motivoConsulta) {
    errors.motivoConsulta =
      "Ingresa el motivo de consulta.";
  }


  if (
    motivoConsulta.length >
    1000
  ) {
    errors.motivoConsulta =
      "El motivo de consulta es demasiado largo.";
  }


  if (
    anamnesis.length >
    4000
  ) {
    errors.anamnesis =
      "La anamnesis es demasiado larga.";
  }


  if (
    examenClinico.length >
    4000
  ) {
    errors.examenClinico =
      "El examen clínico es demasiado largo.";
  }


  return errors;
}


export function buildVeterinaryClinicalConsultationMutationPayload(
  rawData = {}
) {
  const errors =
    getVeterinaryClinicalConsultationFieldErrors(
      rawData
    );


  if (
    Object.keys(errors).length >
    0
  ) {
    const error =
      new Error(
        "Los datos de la consulta clínica contienen errores."
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

    motivoConsulta:
      normalizeText(
        rawData.motivoConsulta,
        1000
      ),

    anamnesis:
      normalizeText(
        rawData.anamnesis,
        4000
      ),

    examenClinico:
      normalizeText(
        rawData.examenClinico,
        4000
      ),
  };
}