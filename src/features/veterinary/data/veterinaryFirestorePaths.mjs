export function requireBusinessId(businessId) {
  const normalized =
    String(businessId || "").trim();

  if (!normalized) {
    throw new Error(
      "Selecciona un negocio activo."
    );
  }

  return normalized;
}


function requireDocumentId(value, label) {
  const normalized =
    String(value || "").trim();

  if (!normalized) {
    throw new Error(
      `Selecciona ${label}.`
    );
  }

  return normalized;
}


export function veterinaryPatientsCollectionPath(
  businessId
) {
  return [
    "negocios",
    requireBusinessId(businessId),
    "pacientesVeterinarios",
  ];
}


export function veterinaryPatientDocPath(
  businessId,
  patientId
) {
  return [
    ...veterinaryPatientsCollectionPath(
      businessId
    ),
    requireDocumentId(
      patientId,
      "un paciente válido"
    ),
  ];
}


export function veterinaryAppointmentsCollectionPath(
  businessId
) {
  return [
    "negocios",
    requireBusinessId(businessId),
    "citasVeterinarias",
  ];
}


export function veterinaryAppointmentDocPath(
  businessId,
  appointmentId
) {
  return [
    ...veterinaryAppointmentsCollectionPath(
      businessId
    ),
    requireDocumentId(
      appointmentId,
      "una cita válida"
    ),
  ];
}


export function veterinaryAttentionsCollectionPath(
  businessId
) {
  return [
    "negocios",
    requireBusinessId(businessId),
    "atencionesVeterinarias",
  ];
}


export function veterinaryAttentionDocPath(
  businessId,
  attentionId
) {
  return [
    ...veterinaryAttentionsCollectionPath(
      businessId
    ),
    requireDocumentId(
      attentionId,
      "una atención válida"
    ),
  ];
}