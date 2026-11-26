"use strict";

const {importVeterinaryModel} = require("./veterinaryModels");

const countryTimeZones = {
  CL: "America/Santiago", BO: "America/La_Paz", BR: "America/Sao_Paulo",
  PE: "America/Lima", AR: "America/Argentina/Buenos_Aires", CO: "America/Bogota",
  EC: "America/Guayaquil", PY: "America/Asuncion", UY: "America/Montevideo", MX: "America/Mexico_City",
  OTHER: null, // El catálogo usa OTHER para una jurisdicción sin ubicación definida.
};

function resolveVeterinaryAppointmentTimeZone(countryCode) {
  const code = String(countryCode ?? "").trim().toUpperCase();
  return Object.hasOwn(countryTimeZones, code) ? countryTimeZones[code] : null;
}

function requireId(value, HttpsError) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(value)) {
    throw new HttpsError("invalid-argument", "Selecciona una cita o paciente válido.");
  }
  return value;
}

function slotRef(business, {fecha, hora}) {
  return business.collection("cuposVeterinarios").doc(fecha + "_" + hora.replace(":", ""));
}

async function guardarCitaVeterinariaHandler(request, {db, HttpsError, FieldValue, requireBusinessAccess}) {
  const {
    buildVeterinaryAppointmentMutationPayload,
    hasVeterinaryAppointmentSlotConflict,
  } = await importVeterinaryModel("appointmentModel");
  const {uid, businessId, businessRef, businessSnapshot} = await requireBusinessAccess(
      request, {db, HttpsError}, {roles: ["OWNER", "ADMIN"], requiredVerticalModule: "veterinaria"},
  );
  const {operacion, citaId, cita} = request.data;
  if (!["crear", "reprogramar", "cancelar"].includes(operacion)) {
    throw new HttpsError("invalid-argument", "Selecciona una operación válida.");
  }
  const company = businessSnapshot.data();
  const timeZone = resolveVeterinaryAppointmentTimeZone(company.paisCodigo);
  const id = requireId(citaId, HttpsError);
  const appointments = businessRef.collection("citasVeterinarias");
  const ref = appointments.doc(id);
  // Resolve document references outside the transaction, then revalidate every
  // operational snapshot in one getAll. These reads never authorize a write.
  const initial = await ref.get();
  const initialData = initial.data();
  if (operacion !== "crear" && !initial.exists) {
    throw new HttpsError("not-found", "La cita ya no está disponible.");
  }
  const oldSlot = initialData && /^\d{4}-\d{2}-\d{2}$/.test(initialData.fecha) && /^\d{2}:\d{2}$/.test(initialData.hora) ?
    slotRef(businessRef, initialData) : null;
  let patientRef;
  let tutorRef;
  let patientId;
  let tutorId;
  let payload;
  let nextSlot;
  let candidates = [];
  if (operacion !== "cancelar" && !(operacion === "crear" && initial.exists)) {
    patientId = requireId(initialData?.pacienteId ?? cita?.pacienteId, HttpsError);
    patientRef = businessRef.collection("pacientesVeterinarios").doc(patientId);
    const patient = await patientRef.get();
    if (!patient.exists || patient.get("negocioId") !== businessId) {
      throw new HttpsError("failed-precondition", "Selecciona un paciente activo de esta empresa.");
    }
    tutorId = requireId(patient.get("tutorClienteId"), HttpsError);
    tutorRef = businessRef.collection("clientes").doc(tutorId);
    try {
      if (!timeZone) throw new RangeError("Zona horaria ausente");
      payload = buildVeterinaryAppointmentMutationPayload(
          {...cita, pacienteId: patientId, tutorClienteId: tutorId}, {timeZone},
      );
    } catch (error) {
      if (error instanceof RangeError) throw new HttpsError("failed-precondition", "Configura un país con zona horaria definida para la empresa.");
      if (!error.fieldErrors) throw error;
      throw new HttpsError("invalid-argument", Object.values(error.fieldErrors)[0], error.fieldErrors);
    }
    nextSlot = slotRef(businessRef, payload);
    // Compatibility with old appointments without a slot reservation. Re-read
    // these documents in getAll; new concurrent bookings contend on nextSlot.
    candidates = (await appointments.where("fecha", "==", payload.fecha).where("hora", "==", payload.hora).get()).docs.map((doc) => doc.ref);
  }
  const refs = [...new Map([ref, patientRef, tutorRef, nextSlot, oldSlot, ...candidates]
      .filter(Boolean).map((item) => [item.path, item])).values()];
  return db.runTransaction(async (tx) => {
    const snapshots = await tx.getAll(...refs);
    const byPath = new Map(snapshots.map((item) => [item.ref.path, item]));
    const snapshot = byPath.get(ref.path);
    const existing = snapshot.data();
    if (operacion === "crear" && initial.exists && !snapshot.exists) {
      throw new HttpsError("aborted", "La cita cambió. Recarga la agenda antes de volver a intentar.");
    }
    if (operacion === "crear" && snapshot.exists) {
      if (existing.negocioId === businessId && existing.creadoPorUid === uid) return {citaId: id};
      throw new HttpsError("already-exists", "Ya existe una cita con ese identificador.");
    }
    if (operacion !== "crear" && (!existing || existing.negocioId !== businessId)) {
      throw new HttpsError("not-found", "La cita ya no está disponible.");
    }
    if (operacion === "cancelar" && existing.estado === "cancelada") return {citaId: id};
    if (existing && !["agendada", "confirmada"].includes(existing.estado) &&
        !(operacion === "cancelar" && existing.estado === "en_espera")) {
      throw new HttpsError("failed-precondition", "Solo puedes cambiar citas agendadas o confirmadas.");
    }

    if (operacion !== "crear" && !snapshot.updateTime.isEqual(initial.updateTime)) {
      throw new HttpsError("aborted", "La cita cambió. Recarga la agenda antes de volver a intentar.");
    }
    const oldLock = oldSlot ? byPath.get(oldSlot.path) : null;
    const audit = {actualizadoEn: FieldValue.serverTimestamp(), actualizadoPorUid: uid};
    if (operacion === "cancelar") {
      tx.update(ref, {...audit, estado: "cancelada"});
      if (oldLock?.get("citaId") === id) tx.delete(oldSlot);
      return {citaId: id};
    }

    const patient = byPath.get(patientRef.path);
    const tutor = byPath.get(tutorRef.path);
    if (!patient.exists || patient.get("negocioId") !== businessId ||
        !["activo", undefined].includes(patient.get("estado"))) {
      throw new HttpsError("failed-precondition", "Selecciona un paciente activo de esta empresa.");
    }
    if (patient.get("tutorClienteId") !== tutorId) {
      throw new HttpsError("aborted", "El tutor del paciente cambió. Recarga la ficha antes de volver a intentar.");
    }
    if (!tutor.exists || tutor.get("negocioId") !== businessId || tutor.get("estado") === "archivado") {
      throw new HttpsError("failed-precondition", "El paciente debe tener un tutor activo de esta empresa.");
    }
    const lock = byPath.get(nextSlot.path);
    if (lock.exists && lock.get("citaId") !== id) {
      throw new HttpsError("already-exists", "Ya hay una cita en ese horario.");
    }
    const booked = candidates.map((candidate) => byPath.get(candidate.path))
        .filter((item) => item.exists).map((item) => ({...item.data(), citaId: item.id}));
    if (hasVeterinaryAppointmentSlotConflict(booked, payload, id)) {
      throw new HttpsError("already-exists", "Ya hay una cita en ese horario.");
    }

    const update = {...payload, ...audit, zonaHoraria: timeZone, estado: existing?.estado ?? "agendada"};
    if (operacion === "crear") {
      tx.create(ref, {...update, negocioId: businessId, creadoEn: audit.actualizadoEn, creadoPorUid: uid});
    } else {
      tx.update(ref, update);
    }
    tx.set(nextSlot, {citaId: id});
    if (oldSlot && oldSlot.path !== nextSlot.path && oldLock.get("citaId") === id) tx.delete(oldSlot);
    return {citaId: id};
  });
}

module.exports = {guardarCitaVeterinariaHandler, resolveVeterinaryAppointmentTimeZone};
