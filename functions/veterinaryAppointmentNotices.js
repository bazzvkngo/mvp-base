"use strict";

const {randomUUID} = require("node:crypto");

const COLLECTION = "avisosCitasVeterinarias";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const scheduleFields = ["fecha", "hora", "zonaHoraria", "pacienteId", "tutorClienteId"];

// Resuelve la hora de pared con la zona de la clínica. Si el cambio de hora
// repite un horario, la primera ocurrencia es la que se usa para el aviso.
function resolveVeterinaryAppointmentInstant({fecha, hora, zonaHoraria}) {
  const nominal = Date.parse(fecha + "T" + hora + ":00Z");
  if (!Number.isFinite(nominal) || !zonaHoraria) return null;
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: zonaHoraria, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  function representedAsUtc(value) {
    const parts = Object.fromEntries(formatter.formatToParts(value).map(({type, value}) => [type, Number(value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  }
  const candidates = [nominal - DAY_MS, nominal + DAY_MS].map((sample) =>
    nominal - (representedAsUtc(sample) - sample),
  ).filter((candidate) => representedAsUtc(candidate) === nominal);
  return candidates.length ? new Date(Math.min(...candidates)) : null;
}

function enqueueVeterinaryAppointmentNotices(tx, businessRef, {citaId, previous, appointment, now}) {
  if (previous && scheduleFields.every((field) => previous[field] === appointment[field])) return;
  const inicioCita = resolveVeterinaryAppointmentInstant(appointment);
  const canNotify = inicioCita && inicioCita > now;
  const delay = canNotify ? inicioCita.getTime() - now.getTime() : 0;
  const reminder = delay > DAY_MS ? new Date(inicioCita.getTime() - DAY_MS) :
    delay > HOUR_MS ? new Date(inicioCita.getTime() - HOUR_MS) : null;
  const notices = businessRef.collection(COLLECTION);
  const revision = randomUUID();
  for (const [tipo, procesarEn] of [["confirmacion", canNotify ? now : null], ["recordatorio", reminder]]) {
    const jobRef = notices.doc(citaId + "__" + tipo);
    if (!procesarEn) {
      if (previous) tx.delete(jobRef);
      continue;
    }
    tx.set(jobRef, {
      negocioId: businessRef.id, citaId, tipo, revision, inicioCita, procesarEn,
      estado: "pendiente",
      reprogramada: Boolean(previous),
      ...Object.fromEntries(scheduleFields.map((field) => [field, appointment[field]])),
    });
  }
}

module.exports = {
  COLLECTION,
  enqueueVeterinaryAppointmentNotices,
  resolveVeterinaryAppointmentInstant,
  scheduleFields,
};
