import assert from "node:assert/strict";
import fs from "node:fs";

import {
  VETERINARY_HOME_ATTENTION_LIMIT,
  veterinaryAttentionItems,
  veterinaryHomeTiles,
  veterinaryTodayActivity,
} from "../src/features/veterinary/veterinaryHomeModel.mjs";

// Resumen clínico (modelo sin Firebase): indicadores, «Requiere atención» y «Actividad de hoy» derivados de pacientes,
// citas y órdenes de atención. La clínica de la prueba está en America/Santiago: el 26-11-2026 a las 12:00.
const now = new Date("2026-11-26T15:00:00Z");
const stamp = (iso) => ({toMillis: () => new Date(iso).getTime()});
const ZONE = "America/Santiago";

const patients = [
  {id: "p1", nombre: "Luna"},
  {id: "p2", nombre: "Toby"},
  {id: "p3", nombre: "Mora"},
  {id: "p4", nombre: "Rocco"},
];
const appointments = [
  {id: "c1", pacienteId: "p1", fecha: "2026-11-26", hora: "10:00", motivo: "Control", estado: "agendada", zonaHoraria: ZONE},
  {id: "c2", pacienteId: "p2", fecha: "2026-11-26", hora: "09:00", motivo: "Vacuna", estado: "confirmada", zonaHoraria: ZONE},
  {id: "c3", pacienteId: "p3", fecha: "2026-11-26", hora: "11:00", motivo: "Revisión", estado: "cancelada", zonaHoraria: ZONE},
  {id: "c4", pacienteId: "p4", fecha: "2026-11-27", hora: "09:00", motivo: "Control", estado: "agendada", zonaHoraria: ZONE},
];
const attentions = [
  {
    id: "a1", pacienteId: "p1", estado: "en_espera", triage: {prioridad: "urgente"}, box: "Box 1", tipoAtencion: "Consulta",
    profesionalUid: "vet-1", motivoConsulta: "Atropello", recepcion: {recibidaEn: stamp("2026-11-26T14:30:00Z")},
  },
  {
    id: "a2", pacienteId: "p2", estado: "en_espera", triage: {prioridad: "normal"}, motivoConsulta: "Tos",
    recepcion: {recibidaEn: stamp("2026-11-26T14:00:00Z")},
  },
  {
    id: "a3", pacienteId: "p3", estado: "en_espera", triage: {prioridad: "normal"}, box: "Box 2", tipoAtencion: "Control",
    profesionalUid: "vet-1", recepcion: {recibidaEn: stamp("2026-11-26T14:10:00Z")},
  },
  {
    id: "a4", pacienteId: "p4", estado: "en_atencion", box: "Box 3", tipoAtencion: "Consulta", profesionalUid: "vet-1",
    recibidoEn: stamp("2026-11-25T13:00:00Z"), iniciadaEn: stamp("2026-11-25T13:30:00Z"),
  },
  {
    id: "a5", pacienteId: "p2", estado: "en_atencion", box: "Box 1", tipoAtencion: "Consulta", profesionalUid: "vet-1",
    recibidoEn: stamp("2026-11-26T13:00:00Z"), iniciadaEn: stamp("2026-11-26T13:20:00Z"),
  },
  {
    id: "a6", pacienteId: "p1", estado: "finalizada", recibidoEn: stamp("2026-11-26T12:00:00Z"),
    iniciadaEn: stamp("2026-11-26T12:10:00Z"), finalizadaEn: stamp("2026-11-26T12:40:00Z"),
  },
  {id: "a7", pacienteId: "p3", estado: "finalizada", recibidoEn: stamp("2026-11-20T12:00:00Z"), finalizadaEn: stamp("2026-11-20T12:40:00Z")},
];
const data = {appointments, attentions, patients, now};

// Indicadores: las citas canceladas y las de otro día no cuentan; «por cerrar» es lo que sigue en atención.
assert.deepEqual(veterinaryHomeTiles(data), {citasHoy: 2, enEspera: 3, enAtencion: 2, pacientes: 4});
assert.deepEqual(veterinaryHomeTiles({now}), {citasHoy: 0, enEspera: 0, enAtencion: 0, pacientes: 0}, "sin datos todo es cero");

// Requiere atención: lo más grave primero y, a igual gravedad, lo que lleva más tiempo.
const attention = veterinaryAttentionItems(data);
assert.deepEqual(attention.map(({kind, tone, to}) => [kind, tone, to]), [
  ["prioridad", "danger", "/clinica-veterinaria/ordenes/a1"],
  ["cierre", "warning", "/clinica-veterinaria/ordenes/a4/atencion"],
  ["asignar", "info", "/clinica-veterinaria/ordenes/a2"],
  ["cita", "info", "/clinica-veterinaria/citas/c1"],
]);
assert.equal(attention[0].title, "Luna · Urgente");
assert.equal(attention[0].detail, "Atropello", "con todo asignado, el detalle es el motivo");
assert.equal(attention[0].age, "hace 30 min");
assert.equal(attention[1].title, "Rocco · Consulta sin cerrar");
assert.equal(attention[2].title, "Toby · Falta asignar");
assert.equal(attention[2].detail, "Falta box, tipo de atención y profesional");
assert.equal(attention[3].title, "Luna · Cita sin confirmar");
assert.equal(attention[3].age, "10:00", "la cita muestra su hora");
assert.ok(!attention.some((item) => item.to.endsWith("/a3")), "una orden normal con todo asignado no es un pendiente");
assert.ok(!attention.some((item) => item.to.endsWith("/a5")), "una consulta abierta hoy no es un pendiente");
assert.ok(!attention.some((item) => item.to.endsWith("/c2")), "una cita confirmada no es un pendiente");

// Una prioritaria sin asignar conserva la prioridad y dice qué falta.
const prioritized = veterinaryAttentionItems({
  ...data, appointments: [], attentions: [{id: "b1", pacienteId: "p2", estado: "en_espera", triage: {prioridad: "prioritaria"}, box: "Box 1"}],
});
assert.equal(prioritized[0].tone, "warning");
assert.equal(prioritized[0].detail, "Falta tipo de atención y profesional");

// El tope evita una lista interminable.
const many = Array.from({length: 20}, (_, index) => (
  {id: `m${index}`, pacienteId: "p1", fecha: "2026-11-26", hora: "10:00", estado: "agendada", zonaHoraria: ZONE}));
assert.equal(veterinaryAttentionItems({...data, appointments: many, attentions: []}).length, VETERINARY_HOME_ATTENTION_LIMIT);
assert.deepEqual(veterinaryAttentionItems({now}), [], "sin datos no hay pendientes");

// Actividad de hoy: una línea por orden con su último movimiento de hoy, la más reciente primero; lo de otros días no entra.
const activity = veterinaryTodayActivity(data);
assert.deepEqual(activity.map(({id}) => id), ["a1", "a3", "a2", "a5", "a6"]);
assert.deepEqual(activity.map(({status}) => status), ["En espera", "En espera", "En espera", "En atención", "Finalizada"]);
assert.equal(activity[0].priority, "Urgente");
assert.equal(activity[0].to, "/clinica-veterinaria/ordenes/a1");
assert.equal(activity[3].to, "/clinica-veterinaria/ordenes/a5/atencion");
assert.equal(activity[3].priority, "", "la prioridad solo se muestra mientras la orden espera");
assert.ok(!activity.some(({id}) => id === "a4" || id === "a7"), "sin movimiento hoy no aparece");
assert.deepEqual(veterinaryTodayActivity({now}), []);

// Zona horaria de la clínica: a las 23:30 del 26-11 en Santiago ya es 27-11 en UTC y sigue siendo «hoy».
const lateNow = new Date("2026-11-27T02:30:00Z");
const lateOrder = {id: "z1", pacienteId: "p1", estado: "en_espera", recibidoEn: stamp("2026-11-27T02:00:00Z")};
assert.equal(veterinaryTodayActivity({appointments, attentions: [lateOrder], patients, now: lateNow}).length, 1);
assert.equal(veterinaryTodayActivity({appointments, attentions: [lateOrder], patients, now: new Date("2026-11-27T05:00:00Z")}).length, 0,
  "al día siguiente de la clínica ya no es de hoy");

// Un paciente que el perfil no puede leer se muestra como «Paciente», sin romper la lista.
assert.equal(veterinaryAttentionItems({now, appointments: [], patients: [], attentions: [{id: "q1", estado: "en_espera", triage: {prioridad: "urgente"}}]})[0].title,
  "Paciente · Urgente");

// El modelo no lee Firebase ni muestra montos.
const source = fs.readFileSync("src/features/veterinary/veterinaryHomeModel.mjs", "utf8");
assert.doesNotMatch(source, /firebase|firestore|precio|subtotal|total/i);

// La pantalla: misma estructura que el Panel del taller (componentes compartidos), acciones por perfil y solo datos que ya lee.
const view = fs.readFileSync("src/features/veterinary/VeterinaryHomeView.jsx", "utf8");
for (const piece of ["<HomeHero", "<HomeTiles", "<HomeAttentionPanel", "<HomeTimelinePanel", "Requiere atención", "Actividad de hoy",
  "Citas de hoy", "Registrar paciente", "Ver agenda", "Ver órdenes de atención", "Mis citas", "Mis órdenes", "Mis pacientes"]) {
  assert.ok(view.includes(piece), `Resumen clínico: falta «${piece}»`);
}
assert.match(view, /professional\s*\?\s*<>[\s\S]*Mis citas[\s\S]*:\s*<>[\s\S]*Registrar paciente/, "el perfil asignado no ve Registrar paciente");
assert.match(view, /loading\s*\?\s*<LoadingState[\s\S]*error \? <div className="erp-empty-state" role="alert">/, "primero la carga, luego el error y al final los datos");
const manager = fs.readFileSync("src/features/veterinary/VeterinaryManager.jsx", "utf8");
assert.match(manager, /<VeterinaryHomeView professional /, "el perfil de atenciones asignadas usa la misma vista");
assert.match(manager, /subscribeToVeterinaryAttentions\(businessId, setAttentions,[\s\S]*professionalUid\)/, "sus órdenes se consultan con su uid");
assert.match(manager, /subscribeToVeterinaryAppointments\(businessId, setAppointments,[\s\S]*professionalUid\)/, "sus citas se consultan con su uid");
assert.doesNotMatch(manager, /getVeterinaryBusinessName|httpsCallable|listarCatalogoVeterinario/, "sin lecturas nuevas");
assert.ok(fs.readFileSync("src/styles/components.css", "utf8").includes(".ui-home__hero"), "estilos compartidos en components.css");

console.log("OK veterinary-home-model-smoke");
