"use strict";

const {createHash, randomUUID} = require("node:crypto");
const {normalizeBusinessVerificationState, VERIFIED_STATE} = require("./businessOperations");
const {buildSenderFrom, normalizeReplyAddress, sanitizeSenderName} = require("./emailEnvelope");
const {COLLECTION, scheduleFields} = require("./veterinaryAppointmentNotices");

const MINUTE_MS = 60_000;
const LEASE_MS = 3 * MINUTE_MS;
const RETRY_WINDOW_MS = 6 * 60 * MINUTE_MS;
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 16;
const ACTIVE_APPOINTMENT_STATES = ["agendada", "confirmada"];
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
const asDate = (value) => value?.toDate?.() || value;

function buildMessage(job, clinic, patient, recipient) {
  const businessName = sanitizeSenderName(clinic.nombreComercial || clinic.razonSocial) || "Clínica Veterinaria";
  const patientName = sanitizeSenderName(patient.nombre) || "tu mascota";
  const heading = job.tipo === "recordatorio" ? "Recordatorio de cita veterinaria" :
    job.reprogramada ? "Cita veterinaria reprogramada" : "Cita veterinaria agendada";
  let date;
  const options = {dateStyle: "long", timeZone: job.zonaHoraria};
  try {
    date = new Intl.DateTimeFormat(clinic.locale || "es", options).format(asDate(job.inicioCita));
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    date = new Intl.DateTimeFormat("es", options).format(asDate(job.inicioCita));
  }
  const replyTo = normalizeReplyAddress(clinic.email);
  return {
    to: [recipient],
    businessName,
    subject: heading,
    text: [
      heading,
      "",
      "Clínica: " + businessName,
      "Paciente: " + patientName,
      "Fecha: " + date,
      "Hora local: " + job.hora,
      "",
      "Si necesitas cambiar la cita, comunícate con la clínica.",
    ].join("\n"),
    ...(replyTo ? {replyTo} : {}),
  };
}

function finishJob(FieldValue, estado, result = {}) {
  return {
    estado,
    procesarEn: FieldValue.delete(),
    bloqueo: FieldValue.delete(),
    mensaje: FieldValue.delete(),
    actualizadoEn: FieldValue.serverTimestamp(),
    ...result,
  };
}

function appointmentIsCurrent(job, appointment, clinic, businessId) {
  return clinic?.estado === "activo" && !clinic.eliminadoEn &&
    normalizeBusinessVerificationState(clinic) === VERIFIED_STATE &&
    Array.isArray(clinic.modulosHabilitados) && clinic.modulosHabilitados.includes("veterinaria") &&
    appointment?.negocioId === businessId && ACTIVE_APPOINTMENT_STATES.includes(appointment.estado) &&
    scheduleFields.every((field) => job[field] === appointment[field]);
}

async function claimNotice(db, FieldValue, candidate, now) {
  const {citaId, pacienteId, tutorClienteId, revision, tipo} = candidate.data();
  const business = candidate.ref.parent.parent;
  if (!business || business.parent.path !== "negocios" || ![citaId, pacienteId, tutorClienteId].every(validId) ||
      !["confirmacion", "recordatorio"].includes(tipo)) return null;

  const appointmentRef = business.collection("citasVeterinarias").doc(citaId);
  const patientRef = business.collection("pacientesVeterinarios").doc(pacienteId);
  const tutorRef = business.collection("clientes").doc(tutorClienteId);
  const claimId = randomUUID();

  return db.runTransaction(async (tx) => {
    const [snap, clinicSnap, appointmentSnap, patientSnap, tutorSnap] =
      await tx.getAll(candidate.ref, business, appointmentRef, patientRef, tutorRef);
    const job = snap.data();
    if (!job || job.revision !== revision || !job.procesarEn || asDate(job.procesarEn) > now) return null;
    const clinic = clinicSnap.data();
    const patient = patientSnap.data();
    const tutor = tutorSnap.data();
    const expires = asDate(job.inicioCita);
    if (job.negocioId !== business.id || !expires || expires <= now ||
        !appointmentIsCurrent(job, appointmentSnap.data(), clinic, business.id) ||
        patient?.negocioId !== business.id || patient.tutorClienteId !== tutorClienteId ||
        tutor?.negocioId !== business.id || tutor.estado === "archivado") {
      tx.update(candidate.ref, finishJob(FieldValue, "omitido", {resultado: "cita_no_vigente"}));
      return {estado: "omitido"};
    }
    const recipient = normalizeReplyAddress(tutor.email ?? tutor.correo);
    if (!recipient || (job.mensaje && job.mensaje.to[0] !== recipient)) {
      tx.update(candidate.ref, finishJob(FieldValue, "omitido", {resultado: "correo_no_disponible"}));
      return {estado: "omitido"};
    }
    const firstAttempt = asDate(job.primerIntentoEn) || now;
    const attempts = (job.intentos || 0) + 1;
    if (attempts > MAX_ATTEMPTS || now.getTime() - firstAttempt.getTime() >= RETRY_WINDOW_MS) {
      tx.update(candidate.ref, finishJob(FieldValue, "fallido", {resultado: "reintentos_agotados"}));
      return {estado: "fallido"};
    }
    const message = job.mensaje || buildMessage(job, clinic, patient, recipient);
    tx.update(candidate.ref, {
      estado: "procesando",
      bloqueo: claimId,
      mensaje: message,
      intentos: attempts,
      primerIntentoEn: firstAttempt,
      procesarEn: new Date(now.getTime() + LEASE_MS),
    });
    const idempotencyKey = createHash("sha256").update(candidate.ref.path + "/" + revision).digest("hex");
    return {claimId, revision, message, attempts, expires, idempotencyKey};
  });
}

async function completeNotice(db, FieldValue, ref, claim, delivery, now) {
  return db.runTransaction(async (tx) => {
    const job = (await tx.get(ref)).data();
    if (job?.revision !== claim.revision || job.bloqueo !== claim.claimId) return null;
    if (delivery.id) {
      tx.update(ref, finishJob(FieldValue, "enviado", {proveedorId: delivery.id, enviadoEn: FieldValue.serverTimestamp()}));
      return "enviado";
    }
    const nextAttempt = new Date(now.getTime() + MINUTE_MS * 2 ** (claim.attempts - 1));
    if (delivery.retryable && claim.attempts < MAX_ATTEMPTS && nextAttempt < claim.expires) {
      tx.update(ref, {estado: "pendiente", bloqueo: FieldValue.delete(), procesarEn: nextAttempt});
      return "reintento";
    }
    tx.update(ref, finishJob(FieldValue, "fallido", {resultado: "proveedor_no_disponible"}));
    return "fallido";
  });
}

async function processVeterinaryAppointmentNotices({db, FieldValue, sendEmail, now = new Date()}) {
  const snapshot = await db.collectionGroup(COLLECTION).where("procesarEn", "<=", now)
      .orderBy("procesarEn").limit(BATCH_SIZE).get();
  const totals = {enviado: 0, omitido: 0, reintento: 0, fallido: 0};
  for (const candidate of snapshot.docs) {
    const claim = await claimNotice(db, FieldValue, candidate, now);
    if (!claim) continue;
    if (claim.estado) {
      totals[claim.estado] += 1;
      continue;
    }
    let delivery;
    try {
      const id = await sendEmail(claim.message, {idempotencyKey: claim.idempotencyKey});
      delivery = {id, retryable: true};
    } catch (error) {
      delivery = {retryable: error?.retryable !== false};
    }
    const outcome = await completeNotice(db, FieldValue, candidate.ref, claim, delivery, now);
    if (outcome) totals[outcome] += 1;
  }
  return totals;
}

async function sendVeterinaryAppointmentWithResend(resend, configuredFrom, message, {idempotencyKey}) {
  const {businessName, ...payload} = message;
  const {data, error} = await resend.emails.send({
    ...payload,
    from: buildSenderFrom({configuredFrom, businessName}),
  }, {idempotencyKey});
  if (!error) return data?.id;
  const failure = new Error("Resend rechazó el aviso veterinario.");
  failure.retryable = !error.statusCode || error.statusCode >= 500 || [408, 429].includes(error.statusCode) ||
    error.name === "concurrent_idempotent_requests";
  throw failure;
}

module.exports = {processVeterinaryAppointmentNotices, sendVeterinaryAppointmentWithResend};
