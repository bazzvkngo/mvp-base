import assert
  from "node:assert/strict";

import {
  buildVeterinaryAppointmentMutationPayload,
  getVeterinaryAppointmentFieldErrors,
  hasVeterinaryAppointmentSlotConflict,
} from "../src/features/veterinary/domain/appointmentModel.mjs";
import {
  getVeterinaryAppointmentsForDay,
  getVeterinaryScheduleDay,
} from "../src/features/veterinary/agenda/veterinaryAppointmentPresentation.mjs";


function getFutureDate(
  daysToAdd = 1
) {
  const date =
    new Date();

  date.setDate(
    date.getDate() +
      daysToAdd
  );

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
}


const futureDate =
  getFutureDate(2);


/*
 * 1. Reserva válida
 */

const validPayload =
  buildVeterinaryAppointmentMutationPayload({
    pacienteId:
      "paciente-001",

    tutorClienteId:
      "cliente-001",

    fecha:
      futureDate,

    hora:
      "10:30",

    motivo:
      "  Control   general  ",

    observaciones:
      "Paciente llega para control.",


    /*
     * Estos campos NO
     * deben entrar al payload.
     */

    negocioId:
      "NEGOCIO-FALSO",

    businessId:
      "BUSINESS-FALSO",

    estado:
      "completada",

    creadoPorUid:
      "UID-FALSO",
  });


assert.equal(
  validPayload.pacienteId,
  "paciente-001"
);


assert.equal(
  validPayload.tutorClienteId,
  "cliente-001"
);


assert.equal(
  validPayload.fecha,
  futureDate
);


assert.equal(
  validPayload.hora,
  "10:30"
);


assert.equal(
  validPayload.motivo,
  "Control general"
);


assert.equal(
  "businessId" in
    validPayload,
  false
);


assert.equal(
  "negocioId" in
    validPayload,
  false
);


assert.equal(
  "estado" in
    validPayload,
  false
);


assert.equal(
  "creadoPorUid" in
    validPayload,
  false
);


/*
 * 2. Campos obligatorios
 */

const requiredErrors =
  getVeterinaryAppointmentFieldErrors({
    pacienteId: "",
    tutorClienteId: "",
    fecha: "",
    hora: "",
    motivo: "",
  });


assert.ok(
  requiredErrors.pacienteId
);


assert.ok(
  requiredErrors.tutorClienteId
);


assert.ok(
  requiredErrors.fecha
);


assert.ok(
  requiredErrors.hora
);


assert.ok(
  requiredErrors.motivo
);


/*
 * 3. Hora inválida
 */

const invalidTimeErrors =
  getVeterinaryAppointmentFieldErrors({
    pacienteId:
      "paciente-001",

    tutorClienteId:
      "cliente-001",

    fecha:
      futureDate,

    hora:
      "27:90",

    motivo:
      "Control",
  });


assert.ok(
  invalidTimeErrors.hora
);


/*
 * 4. Fecha pasada
 */

const yesterday =
  getFutureDate(-1);


const pastDateErrors =
  getVeterinaryAppointmentFieldErrors({
    pacienteId:
      "paciente-001",

    tutorClienteId:
      "cliente-001",

    fecha:
      yesterday,

    hora:
      "09:00",

    motivo:
      "Control",
  });


assert.ok(
  pastDateErrors.fecha
);


/*
 * 5. Conflicto de horario
 */

const appointments = [
  {
    citaId:
      "cita-001",

    fecha:
      futureDate,

    hora:
      "10:30",

    estado:
      "agendada",
  },
];


assert.equal(
  hasVeterinaryAppointmentSlotConflict(
    appointments,
    {
      fecha:
        futureDate,

      hora:
        "10:30",
    }
  ),
  true
);


/*
 * 6. Horario disponible
 */

assert.equal(
  hasVeterinaryAppointmentSlotConflict(
    appointments,
    {
      fecha:
        futureDate,

      hora:
        "11:30",
    }
  ),
  false
);


/*
 * 7. Una cita cancelada
 * no bloquea el horario.
 */

assert.equal(
  hasVeterinaryAppointmentSlotConflict(
    [
      {
        citaId:
          "cita-cancelada",

        fecha:
          futureDate,

        hora:
          "12:00",

        estado:
          "cancelada",
      },
    ],

    {
      fecha:
        futureDate,

      hora:
        "12:00",
    }
  ),
  false
);


const localDate = {pacienteId: "p", tutorClienteId: "t", fecha: "2026-11-15", hora: "23:30", motivo: "Demo"};
const instant = new Date("2026-11-16T01:30:00Z");
assert.equal(getVeterinaryAppointmentFieldErrors(localDate, {now: instant, timeZone: "America/Santiago"}).fecha, undefined);
assert.ok(getVeterinaryAppointmentFieldErrors(localDate, {now: instant, timeZone: "UTC"}).fecha);

const schedule = [
  {id: "cancelada", fecha: "2026-11-15", hora: "09:00", estado: "cancelada"},
  {id: "tarde", fecha: "2026-11-15", hora: "16:30", estado: "confirmada", zonaHoraria: "America/Santiago"},
  {id: "mañana", fecha: "2026-11-16", hora: "08:00", estado: "agendada"},
  {id: "temprano", fecha: "2026-11-15", hora: "08:30", estado: "finalizada"},
];
const scheduleDay = getVeterinaryScheduleDay(schedule, instant);
assert.equal(scheduleDay, "2026-11-15");
assert.deepEqual(getVeterinaryAppointmentsForDay(schedule, scheduleDay).map(({id}) => id), ["temprano", "tarde"]);
assert.deepEqual(getVeterinaryAppointmentsForDay(schedule, "2026-11-17"), []);
assert.equal(getVeterinaryScheduleDay(schedule, new Date("2026-11-16T04:01:00Z")), "2026-11-16");

console.log("OK veterinary-appointment-model-smoke");
