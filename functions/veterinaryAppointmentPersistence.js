"use strict";

const {importVeterinaryModel} = require("./veterinaryModels");
const {enqueueVeterinaryAppointmentNotices, resolveVeterinaryAppointmentInstant} = require("./veterinaryAppointmentNotices");
const {
  assertAssignableVeterinaryProfessional,
  getVeterinaryProfessionalDisplayName,
  getVeterinaryProfessionalProfileRef,
} = require("./veterinaryProfessionalAccess");

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

async function getSlotCandidates(appointments, {fecha, hora}) {
  // Compatibilidad con citas anteriores a las reservas de cupo.
  return (await appointments.where("fecha", "==", fecha).where("hora", "==", hora).get()).docs.map((doc) => doc.ref);
}

function assertSlotAvailable({lock, candidates, snapshots, payload, citaId, hasSlotConflict}, HttpsError, details) {
  const booked = candidates.map((candidate) => snapshots.get(candidate.path)).filter((item) => item.exists)
      .map((item) => ({...item.data(), citaId: item.id}));
  if ((lock.exists && lock.get("citaId") !== citaId) || hasSlotConflict(booked, payload, citaId)) {
    throw new HttpsError("already-exists", "Ya hay una cita en ese horario.", details);
  }
}

function assertAppointmentPatientAndTutor({patient, tutor, businessId, tutorId}, HttpsError) {
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
}

async function prepareVeterinaryControlAppointment(control, {businessRef, businessId, businessSnapshot, pacienteId, citaId, HttpsError, requestedAt}) {
  const timeZone = resolveVeterinaryAppointmentTimeZone(businessSnapshot.get("paisCodigo"));
  if (!timeZone) {
    throw new HttpsError("failed-precondition", "Configura un país con zona horaria definida para la empresa.");
  }
  const patientRef = businessRef.collection("pacientesVeterinarios").doc(requireId(pacienteId, HttpsError));
  const patient = await patientRef.get();
  if (!patient.exists || patient.get("negocioId") !== businessId) {
    throw new HttpsError("failed-precondition", "Selecciona un paciente activo de esta empresa.");
  }
  const tutorId = patient.get("tutorClienteId");
  if (typeof tutorId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(tutorId)) {
    throw new HttpsError("failed-precondition", "El paciente debe tener un tutor activo de esta empresa.");
  }
  const tutorRef = businessRef.collection("clientes").doc(tutorId);
  const {buildVeterinaryAppointmentMutationPayload, hasVeterinaryAppointmentSlotConflict} =
    await importVeterinaryModel("appointmentModel");
  const {fecha, hora} = control;
  let payload;
  try {
    payload = buildVeterinaryAppointmentMutationPayload(
        {fecha, hora, pacienteId, tutorClienteId: tutorId, motivo: "Control veterinario"}, {timeZone, now: requestedAt},
    );
  } catch (error) {
    if (!error.fieldErrors) throw error;
    const {fecha: controlFecha, hora: controlHora} = error.fieldErrors;
    const details = {...(controlFecha ? {controlFecha} : {}), ...(controlHora ? {controlHora} : {})};
    throw new HttpsError("invalid-argument", controlFecha || controlHora || error.message, details);
  }
  const appointment = {...payload, negocioId: businessId, zonaHoraria: timeZone, estado: "agendada"};
  const start = resolveVeterinaryAppointmentInstant(appointment);
  if (!start || start <= requestedAt) {
    const message = "Selecciona una fecha y hora futuras válidas para el control.";
    throw new HttpsError("invalid-argument", message, {controlHora: message});
  }

  const appointments = businessRef.collection("citasVeterinarias");
  const appointmentRef = appointments.doc(citaId);
  const nextSlot = slotRef(businessRef, payload);
  const candidates = await getSlotCandidates(appointments, payload);
  return {
    appointment, appointmentRef, nextSlot, candidates, patientRef, tutorRef, requestedAt,
    hasSlotConflict: hasVeterinaryAppointmentSlotConflict,
    refs: [appointmentRef, nextSlot, patientRef, tutorRef, businessRef, ...candidates],
  };
}

function assertVeterinaryControlAppointmentAvailable(control, snapshots, {businessRef, businessId, HttpsError}) {
  const {appointment, appointmentRef, nextSlot, patientRef, tutorRef, candidates, hasSlotConflict} = control;
  const currentZone = resolveVeterinaryAppointmentTimeZone(snapshots.get(businessRef.path).get("paisCodigo"));
  if (currentZone !== appointment.zonaHoraria) {
    throw new HttpsError("aborted", "Cambió la zona horaria de la empresa. Vuelve a intentar agendar el control.");
  }
  if (snapshots.get(appointmentRef.path).exists) {
    throw new HttpsError("already-exists", "Ya existe una cita de control para esta atención.");
  }
  assertAppointmentPatientAndTutor({
    patient: snapshots.get(patientRef.path), tutor: snapshots.get(tutorRef.path), businessId, tutorId: tutorRef.id,
  }, HttpsError);
  assertSlotAvailable({
    lock: snapshots.get(nextSlot.path), candidates, snapshots, payload: appointment,
    citaId: appointmentRef.id, hasSlotConflict,
  }, HttpsError, {controlHora: "Ya hay una cita en ese horario."});
}

function writeVeterinaryControlAppointment(tx, control, professional, {businessRef, uid, audit}) {
  const {appointment, appointmentRef, nextSlot, requestedAt} = control;
  tx.create(appointmentRef, {...appointment, ...professional, ...audit, creadoEn: audit.actualizadoEn, creadoPorUid: uid});
  tx.set(nextSlot, {citaId: appointmentRef.id});
  enqueueVeterinaryAppointmentNotices(tx, businessRef, {citaId: appointmentRef.id, appointment, now: requestedAt});
}

async function guardarCitaVeterinariaHandler(request, {db, HttpsError, FieldValue, requireBusinessAccess, now = () => new Date()}) {
  const {
    buildVeterinaryAppointmentMutationPayload,
    hasVeterinaryAppointmentSlotConflict,
  } = await importVeterinaryModel("appointmentModel");
  const {uid, businessId, businessRef, businessSnapshot} = await requireBusinessAccess(
      request, {db, HttpsError}, {roles: ["OWNER", "ADMIN"], requiredVerticalModule: "veterinaria"},
  );
  const {operacion, citaId, cita} = request.data;
  const requestedAt = now();
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
  let professionalMemberRef;
  let professionalProfileRef;
  let professionalPatch = {};
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
          {...cita, pacienteId: patientId, tutorClienteId: tutorId}, {timeZone, now: requestedAt},
      );
    } catch (error) {
      if (error instanceof RangeError) throw new HttpsError("failed-precondition", "Configura un país con zona horaria definida para la empresa.");
      if (!error.fieldErrors) throw error;
      throw new HttpsError("invalid-argument", Object.values(error.fieldErrors)[0], error.fieldErrors);
    }
    nextSlot = slotRef(businessRef, payload);
    if (cita?.profesionalUid !== undefined) {
      if (cita.profesionalUid === "") {
        professionalPatch = {profesionalUid: "", profesionalNombre: ""};
      } else {
        const professionalUid = requireId(cita.profesionalUid, HttpsError);
        professionalMemberRef = db.doc("membresias/" + businessId + "__" + professionalUid);
        const member = (await professionalMemberRef.get()).data();
        professionalProfileRef = getVeterinaryProfessionalProfileRef(businessRef, member);
        const profile = professionalProfileRef ? (await professionalProfileRef.get()).data() : undefined;
        assertAssignableVeterinaryProfessional(member, profile, {businessId, uid: professionalUid, HttpsError});
        professionalPatch = {
          profesionalUid: professionalUid,
          profesionalNombre: await getVeterinaryProfessionalDisplayName(db, professionalUid),
        };
      }
    }
    candidates = await getSlotCandidates(appointments, payload);
  }
  const refs = [...new Map([ref, patientRef, tutorRef, nextSlot, oldSlot, professionalMemberRef, professionalProfileRef, ...candidates]
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
    if (operacion === "cancelar" && existing.atencionId) {
      throw new HttpsError("failed-precondition", "Cancela la orden de atención vinculada para liberar este horario.");
    }
    if (existing?.atencionId && professionalPatch.profesionalUid !== undefined &&
        professionalPatch.profesionalUid !== existing.profesionalUid) {
      throw new HttpsError("failed-precondition", "Modifica el responsable desde la orden de atención vinculada.");
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
    assertAppointmentPatientAndTutor({patient, tutor, businessId, tutorId}, HttpsError);
    if (professionalMemberRef) {
      const member = byPath.get(professionalMemberRef.path).data();
      const profile = professionalProfileRef && member?.profileId === professionalProfileRef.id
        ? byPath.get(professionalProfileRef.path).data()
        : undefined;
      assertAssignableVeterinaryProfessional(member, profile, {
        businessId, uid: professionalPatch.profesionalUid, HttpsError,
      });
    }
    assertSlotAvailable({
      lock: byPath.get(nextSlot.path), candidates, snapshots: byPath, payload, citaId: id,
      hasSlotConflict: hasVeterinaryAppointmentSlotConflict,
    }, HttpsError);

    const update = {...payload, ...professionalPatch, ...audit, zonaHoraria: timeZone, estado: existing?.estado ?? "agendada"};
    if (operacion === "crear") {
      tx.create(ref, {...update, negocioId: businessId, creadoEn: audit.actualizadoEn, creadoPorUid: uid});
    } else {
      tx.update(ref, update);
    }
    enqueueVeterinaryAppointmentNotices(tx, businessRef, {citaId: id, previous: existing, appointment: update, now: requestedAt});
    tx.set(nextSlot, {citaId: id});
    if (oldSlot && oldSlot.path !== nextSlot.path && oldLock.get("citaId") === id) tx.delete(oldSlot);
    return {citaId: id};
  });
}

module.exports = {
  guardarCitaVeterinariaHandler, resolveVeterinaryAppointmentTimeZone,
  prepareVeterinaryControlAppointment, assertVeterinaryControlAppointmentAvailable, writeVeterinaryControlAppointment,
};
