"use strict";

const {importVeterinaryModel} = require("./veterinaryModels");

const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value);

async function guardarRecepcionVeterinariaHandler(request, {db, HttpsError, FieldValue, requireBusinessAccess}) {
  const {
    buildVeterinaryReceptionMutationPayload,
    buildVeterinaryTriageMutationPayload,
    canStartVeterinaryReception,
  } = await importVeterinaryModel("receptionTriageModel");
  const {uid, businessId, businessRef} = await requireBusinessAccess(
      request, {db, HttpsError}, {roles: ["OWNER", "ADMIN"], requiredVerticalModule: "veterinaria"},
  );
  const {citaId, recepcion} = request.data;
  if (!validId(citaId) || !recepcion || typeof recepcion !== "object" || Array.isArray(recepcion)) {
    throw new HttpsError("invalid-argument", "Selecciona una cita y completa los datos de recepción.");
  }
  const ref = businessRef.collection("citasVeterinarias").doc(citaId);
  return db.runTransaction(async (tx) => {
    const appointment = (await tx.get(ref)).data();
    if (!appointment || appointment.negocioId !== businessId) {
      throw new HttpsError("not-found", "La cita ya no está disponible.");
    }
    if (!canStartVeterinaryReception(appointment) && appointment.estado !== "en_espera") {
      throw new HttpsError("failed-precondition", "La cita ya no admite cambios de recepción.");
    }
    if (!validId(appointment.pacienteId)) {
      throw new HttpsError("failed-precondition", "La cita no tiene un paciente válido.");
    }
    const patient = (await tx.get(businessRef.collection("pacientesVeterinarios").doc(appointment.pacienteId))).data();
    if (!patient || patient.negocioId !== businessId || !validId(patient.tutorClienteId)) {
      throw new HttpsError("failed-precondition", "El paciente debe estar asociado a un tutor de esta empresa.");
    }
    const tutor = (await tx.get(businessRef.collection("clientes").doc(patient.tutorClienteId))).data();
    if (!tutor || tutor.negocioId !== businessId || tutor.estado === "archivado") {
      throw new HttpsError("failed-precondition", "El tutor del paciente debe estar activo en esta empresa.");
    }

    let arrival;
    let triage;
    try {
      const payload = {...recepcion, citaId, pacienteId: appointment.pacienteId, tutorClienteId: patient.tutorClienteId};
      arrival = buildVeterinaryReceptionMutationPayload(payload);
      triage = buildVeterinaryTriageMutationPayload(payload);
    } catch (error) {
      if (!error.fieldErrors) throw error;
      throw new HttpsError("invalid-argument", Object.values(error.fieldErrors)[0], error.fieldErrors);
    }
    const stamp = FieldValue.serverTimestamp();
    tx.update(ref, {
      estado: "en_espera",
      tutorClienteId: patient.tutorClienteId,
      recepcion: {
        horaLlegada: arrival.horaLlegada,
        observacionesRecepcion: arrival.observacionesRecepcion,
        recibidaEn: appointment.recepcion?.recibidaEn ?? stamp,
        recibidaPorUid: appointment.recepcion?.recibidaPorUid ?? uid,
      },
      triage: {
        prioridad: triage.prioridad,
        pesoKg: triage.pesoKg,
        temperaturaC: triage.temperaturaC,
        frecuenciaCardiaca: triage.frecuenciaCardiaca,
        frecuenciaRespiratoria: triage.frecuenciaRespiratoria,
        observacionesTriage: triage.observacionesTriage,
      },
      actualizadoEn: stamp,
      actualizadoPorUid: uid,
    });
    return {citaId};
  });
}

module.exports = {guardarRecepcionVeterinariaHandler};
