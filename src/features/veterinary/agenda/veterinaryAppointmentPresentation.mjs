import {getTodayIsoDate} from "../domain/appointmentModel.mjs";

const statusLabels = {
  agendada: "Agendada",
  confirmada: "Confirmada",
  en_espera: "En espera",
  en_atencion: "En atención",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
  completada: "Completada",
};

export const veterinaryAppointmentPath = (id) => "/clinica-veterinaria/citas/" + encodeURIComponent(id);

export function getVeterinaryAppointmentStatusLabel(status) {
  return Object.hasOwn(statusLabels, status) ? statusLabels[status] : "Sin estado";
}

export function getVeterinaryScheduleDay(appointments, now = new Date()) {
  for (const {zonaHoraria} of appointments) {
    if (!zonaHoraria) continue;
    try {
      return getTodayIsoDate({now, timeZone: zonaHoraria});
    } catch (error) {
      // Un registro anterior puede tener una zona no reconocida.
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return getTodayIsoDate({now});
}

export function getVeterinaryAppointmentsForDay(appointments, day) {
  return appointments
    .filter(({fecha, estado}) => fecha === day && estado !== "cancelada")
    .sort((first, second) => (first.hora || "").localeCompare(second.hora || ""));
}
