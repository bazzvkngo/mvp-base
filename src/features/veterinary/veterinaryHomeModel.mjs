// Resumen clínico de Veterinaria: indicadores, «Requiere atención» y «Actividad de hoy».
// Vive fuera de domain/: esa carpeta se empaqueta tal cual en Functions y debe seguir siendo autocontenida.
// Todo se deriva de lo que la pantalla ya lee: pacientes, citas y órdenes de atención (colección de atenciones).
// Con un perfil de atenciones asignadas (professionalUid) esas listas ya llegan filtradas a lo suyo; este modelo no
// consulta nada y no distingue perfiles. No muestra montos ni datos clínicos: solo nombre, prioridad, motivo y estado.
import {elapsedLabel} from "../../domain/workshopHomeModel.mjs";
import {
  getVeterinaryAppointmentsForDay,
  getVeterinaryScheduleDay,
  veterinaryAppointmentPath,
} from "./agenda/veterinaryAppointmentPresentation.mjs";
import {getTodayIsoDate} from "./domain/appointmentModel.mjs";

const BASE_PATH = "/clinica-veterinaria";
export const VETERINARY_HOME_ATTENTION_LIMIT = 8;

const PRIORITY_LABELS = {urgente: "Urgente", prioritaria: "Prioritaria", normal: "Normal"};
const PRIORITY_TONES = {urgente: "danger", prioritaria: "warning"};
const TONE_RANK = {danger: 0, warning: 1, info: 2};
const ORDER_STATUS_LABELS = {
  en_espera: "En espera", en_atencion: "En atención", finalizada: "Finalizada", cancelada: "Cancelada",
};

export const veterinaryOrderPath = (id) => `${BASE_PATH}/ordenes/${encodeURIComponent(id)}`;
const veterinaryAttentionPath = (id) => `${veterinaryOrderPath(id)}/atencion`;

function text(value) {
  return String(value ?? "").trim();
}

function millis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  return Number.isFinite(value) ? value : 0;
}

// Zona horaria de la clínica: la de la primera cita que traiga una reconocible. Sin ella, la del navegador.
function scheduleTimeZone(appointments = []) {
  for (const {zonaHoraria} of appointments) {
    if (!zonaHoraria) continue;
    try {
      new Intl.DateTimeFormat("en", {timeZone: zonaHoraria});
      return zonaHoraria;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return undefined;
}

function dayContext(appointments, now) {
  const timeZone = scheduleTimeZone(appointments);
  return {
    today: getVeterinaryScheduleDay(appointments, now),
    dayOf: (ms) => (ms ? getTodayIsoDate({now: new Date(ms), timeZone}) : ""),
  };
}

// Cuándo llegó la orden a la clínica (mismo criterio que la lista de órdenes).
function receivedMillis(order) {
  return millis(order.recepcion?.recibidaEn ?? order.recibidoEn ?? order.creadoEn);
}

function patientName(patients, id) {
  return patients.get(id) || "Paciente";
}

function patientNames(patients = []) {
  return new Map(patients.map(({id, nombre}) => [id, text(nombre)]));
}

// Lo que falta para poder iniciar una orden en espera (el box, el tipo de atención y el profesional los asigna Administración).
function missingAssignment(order) {
  const missing = [];
  if (!text(order.box)) missing.push("box");
  if (!text(order.tipoAtencion)) missing.push("tipo de atención");
  if (!text(order.profesionalUid)) missing.push("profesional");
  return missing;
}

function joinList(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

// Cuatro indicadores. «Por cerrar» no es un indicador aparte: una orden está por cerrar mientras está en atención.
export function veterinaryHomeTiles({appointments = [], attentions = [], patients = [], now = new Date()} = {}) {
  const day = getVeterinaryScheduleDay(appointments, now);
  return {
    citasHoy: getVeterinaryAppointmentsForDay(appointments, day).length,
    enEspera: attentions.filter((order) => order.estado === "en_espera").length,
    enAtencion: attentions.filter((order) => order.estado === "en_atencion").length,
    pacientes: patients.length,
  };
}

// Lo que requiere atención, lo más grave primero y, a igual gravedad, lo que lleva más tiempo esperando:
// 1. Órdenes en espera urgentes o prioritarias, o a las que aún les falta box, tipo de atención o profesional.
// 2. Consultas en atención de un día anterior que nadie cerró.
// 3. Citas de hoy que aún no se confirman.
export function veterinaryAttentionItems({appointments = [], attentions = [], patients = [], now = new Date()} = {}) {
  const names = patientNames(patients);
  const {today, dayOf} = dayContext(appointments, now);
  const items = [];

  for (const order of attentions) {
    const name = patientName(names, order.pacienteId);
    if (order.estado === "en_espera") {
      const priority = order.triage?.prioridad;
      const missing = missingAssignment(order);
      if (!PRIORITY_TONES[priority] && !missing.length) continue;
      const since = receivedMillis(order);
      items.push({
        kind: PRIORITY_TONES[priority] ? "prioridad" : "asignar",
        tone: PRIORITY_TONES[priority] || "info",
        to: veterinaryOrderPath(order.id),
        title: PRIORITY_TONES[priority] ? `${name} · ${PRIORITY_LABELS[priority]}` : `${name} · Falta asignar`,
        detail: missing.length ? `Falta ${joinList(missing)}` : text(order.motivoConsulta) || "En espera de atención",
        since,
        age: elapsedLabel(since, now),
      });
    } else if (order.estado === "en_atencion") {
      const since = millis(order.iniciadaEn);
      if (!since || dayOf(since) >= today) continue;
      items.push({
        kind: "cierre",
        tone: "warning",
        to: veterinaryAttentionPath(order.id),
        title: `${name} · Consulta sin cerrar`,
        detail: "Quedó en atención desde un día anterior",
        since,
        age: elapsedLabel(since, now),
      });
    }
  }

  for (const appointment of getVeterinaryAppointmentsForDay(appointments, today)) {
    if (appointment.estado !== "agendada") continue;
    items.push({
      kind: "cita",
      tone: "info",
      to: veterinaryAppointmentPath(appointment.id),
      title: `${patientName(names, appointment.pacienteId)} · Cita sin confirmar`,
      detail: text(appointment.motivo) || "Sin motivo registrado",
      since: 0,
      age: text(appointment.hora),
    });
  }

  return items
    .sort((left, right) => (TONE_RANK[left.tone] - TONE_RANK[right.tone]) ||
      ((left.since || Number.MAX_SAFE_INTEGER) - (right.since || Number.MAX_SAFE_INTEGER)))
    .slice(0, VETERINARY_HOME_ATTENTION_LIMIT);
}

// Órdenes con movimiento hoy (llegada, inicio, cierre o cancelación), con su último movimiento y más recientes primero.
export function veterinaryTodayActivity({appointments = [], attentions = [], patients = [], now = new Date()} = {}) {
  const names = patientNames(patients);
  const {today, dayOf} = dayContext(appointments, now);
  return attentions
    .map((order) => {
      const at = Math.max(receivedMillis(order), millis(order.iniciadaEn), millis(order.finalizadaEn), millis(order.canceladaEn));
      return {
        id: order.id,
        at,
        name: patientName(names, order.pacienteId),
        status: ORDER_STATUS_LABELS[order.estado] || "Sin estado",
        priority: order.estado === "en_espera" ? PRIORITY_LABELS[order.triage?.prioridad] || "" : "",
        to: order.estado === "en_espera" ? veterinaryOrderPath(order.id) : veterinaryAttentionPath(order.id),
      };
    })
    .filter((entry) => entry.at && dayOf(entry.at) === today)
    .sort((left, right) => right.at - left.at);
}
