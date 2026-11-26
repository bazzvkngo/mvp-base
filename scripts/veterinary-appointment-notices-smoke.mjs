import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {connectFirestoreEmulator, doc, getDoc, getFirestore} from "firebase/firestore";

const {GCLOUD_PROJECT: projectId, FIREBASE_AUTH_EMULATOR_HOST: authHost, FIRESTORE_EMULATOR_HOST: databaseHost} = process.env;
if (!projectId?.startsWith("demo-") || !/^127\.0\.0\.1:\d+$/.test(authHost) || !/^127\.0\.0\.1:\d+$/.test(databaseHost)) {
  throw new Error("Ejecuta esta prueba con Auth y Firestore locales en un proyecto demo.");
}

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {requireOperationalBusinessAccess} = require("../functions/businessOnboarding");
const {guardarCitaVeterinariaHandler} = require("../functions/veterinaryAppointmentPersistence");
const {resolveVeterinaryAppointmentInstant} = require("../functions/veterinaryAppointmentNotices");
const {processVeterinaryAppointmentNotices, sendVeterinaryAppointmentWithResend} =
  require("../functions/veterinaryAppointmentNoticeDelivery");

const instant = (fecha, hora, zonaHoraria) =>
  resolveVeterinaryAppointmentInstant({fecha, hora, zonaHoraria})?.toISOString();
assert.equal(instant("2026-01-18", "10:30", "America/Santiago"), "2026-01-18T13:30:00.000Z");
assert.equal(instant("2026-01-18", "10:30", "America/La_Paz"), "2026-01-18T14:30:00.000Z");
assert.equal(instant("2026-09-06", "00:30", "America/Santiago"), undefined);

const adminApp = admin.initializeApp({projectId});
const app = initializeApp({projectId, apiKey: "demo-key"});
const auth = getAuth(app);
const clientDb = getFirestore(app);
connectAuthEmulator(auth, "http://" + authHost, {disableWarnings: true});
connectFirestoreEmulator(clientDb, "127.0.0.1", Number(databaseHost.split(":")[1]));
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
let clock = new Date("2038-07-10T12:00:00Z");

try {
  const {user} = await signInAnonymously(auth);
  const businessId = "clinica-avisos-" + randomUUID();
  const business = db.doc("negocios/" + businessId);
  const clients = business.collection("clientes");
  const patients = business.collection("pacientesVeterinarios");
  const appointments = business.collection("citasVeterinarias");
  const jobs = business.collection("avisosCitasVeterinarias");
  await Promise.all([
    business.set({
      estado: "activo", paisCodigo: "CL", locale: "es-CL", nombreComercial: "Clínica de prueba",
      email: "recepcion@example.test", verificacionEmpresa: {estado: "VERIFICADA"}, modulosHabilitados: ["veterinaria"],
    }),
    db.doc("membresias/" + businessId + "__" + user.uid).set({uid: user.uid, negocioId: businessId, estado: "activo", rol: "OWNER"}),
    clients.doc("tutor-demo").set({negocioId: businessId, email: "tutora@example.test", estado: "activo"}),
    clients.doc("sin-correo").set({negocioId: businessId, estado: "activo"}),
    patients.doc("mascota-demo").set({negocioId: businessId, nombre: "Nube Demo", estado: "activo", tutorClienteId: "tutor-demo"}),
    patients.doc("mascota-sin-correo").set({negocioId: businessId, nombre: "Bosque Demo", estado: "activo", tutorClienteId: "sin-correo"}),
  ]);
  const save = (citaId, operacion, cita) => guardarCitaVeterinariaHandler({
    auth: {uid: user.uid}, data: {businessId, citaId, operacion, cita},
  }, {db, HttpsError, FieldValue, requireBusinessAccess: requireOperationalBusinessAccess, now: () => clock});
  const sent = [];
  const acceptedByProvider = new Map();
  let loseResponse = false;
  const fakeResend = {emails: {send: async (payload, options) => {
    sent.push({payload, key: options.idempotencyKey});
    const previous = acceptedByProvider.get(options.idempotencyKey);
    if (previous) {
      assert.deepEqual(payload, previous.payload);
      return {data: {id: previous.id}, error: null};
    }
    const id = "resend-falso-" + sent.length;
    acceptedByProvider.set(options.idempotencyKey, {id, payload});
    if (loseResponse) {
      loseResponse = false;
      throw new Error("Timeout simulado después de recibir el correo");
    }
    return {data: {id}, error: null};
  }}};
  const run = async (time = clock) => {
    clock = new Date(time);
    return processVeterinaryAppointmentNotices({
      db, FieldValue, now: clock,
      sendEmail: (message, options) => sendVeterinaryAppointmentWithResend(fakeResend, "ValoraCloud <avisos@example.test>", message, options),
    });
  };
  const appointment = {pacienteId: "mascota-demo", fecha: "2038-07-12", hora: "10:00", motivo: "Motivo privado"};
  await save("cita-1", "crear", appointment);
  const confirmation = jobs.doc("cita-1__confirmacion");
  const reminder = jobs.doc("cita-1__recordatorio");
  const revision = (await confirmation.get()).get("revision");
  await save("cita-1", "crear", appointment);
  assert.equal((await confirmation.get()).get("revision"), revision);
  assert.equal((await reminder.get()).get("procesarEn").toDate().toISOString(), "2038-07-11T14:00:00.000Z");
  await assert.rejects(getDoc(doc(clientDb, confirmation.path)), {code: "permission-denied"});
  await run();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].payload.to, ["tutora@example.test"]);
  assert.equal(sent[0].payload.replyTo, "recepcion@example.test");
  assert.equal(sent[0].payload.subject, "Cita veterinaria agendada");
  assert.match(sent[0].payload.text, /Nube Demo/);
  assert.match(sent[0].payload.text, /Hora local: 10:00/);
  assert.doesNotMatch(sent[0].payload.text, /Motivo privado/);
  assert.equal((await confirmation.get()).get("estado"), "enviado");
  assert.equal((await confirmation.get()).get("mensaje"), undefined);
  await run("2038-07-11T13:59:00Z");
  assert.equal(sent.length, 1);
  await run("2038-07-11T14:00:00Z");
  assert.equal(sent[1].payload.subject, "Recordatorio de cita veterinaria");
  assert.notEqual(sent[0].key, sent[1].key);
  await run();
  assert.equal(sent.length, 2);

  const moved = {...appointment, fecha: "2038-07-13", hora: "11:00"};
  await save("cita-2", "crear", {...appointment, hora: "16:00"});
  const movedJob = jobs.doc("cita-2__recordatorio");
  const oldRevision = (await movedJob.get()).get("revision");
  await save("cita-2", "reprogramar", moved);
  const newJob = await movedJob.get();
  assert.notEqual(newJob.get("revision"), oldRevision);
  assert.equal(newJob.get("procesarEn").toDate().toISOString(), "2038-07-12T15:00:00.000Z");
  await save("cita-2", "reprogramar", {...moved, motivo: "Motivo actualizado"});
  assert.equal((await movedJob.get()).get("revision"), newJob.get("revision"));
  await run();
  assert.equal(sent[2].payload.subject, "Cita veterinaria reprogramada");
  assert.match(sent[2].payload.text, /Hora local: 11:00/);
  await save("cita-2", "cancelar");
  await run("2038-07-12T15:00:00Z");
  assert.equal((await movedJob.get()).get("estado"), "omitido");
  assert.equal(sent.length, 3);

  await save("cercana", "crear", {...appointment, hora: "15:00"});
  assert.equal((await jobs.doc("cercana__recordatorio").get()).get("procesarEn").toDate().toISOString(), "2038-07-12T18:00:00.000Z");
  await save("sin-email", "crear", {...appointment, pacienteId: "mascota-sin-correo", hora: "11:30"});
  assert.equal((await appointments.doc("sin-email").get()).get("estado"), "agendada");
  assert.equal((await jobs.doc("sin-email__recordatorio").get()).exists, false);
  loseResponse = true;
  await run();
  const shortConfirmation = jobs.doc("cercana__confirmacion");
  assert.equal((await shortConfirmation.get()).get("estado"), "pendiente");
  assert.equal((await jobs.doc("sin-email__confirmacion").get()).get("estado"), "omitido");
  await run("2038-07-12T15:01:00Z");
  assert.equal(sent[3].key, sent[4].key);
  assert.equal(acceptedByProvider.size, 4);
  assert.equal((await shortConfirmation.get()).get("estado"), "enviado");
  await run("2038-07-12T19:00:00Z");
  assert.equal((await jobs.doc("cercana__recordatorio").get()).get("estado"), "omitido");
  assert.equal(sent.length, 5, "Un recordatorio que venció durante una interrupción no se envía");

  await save("contacto-ajeno", "crear", {...appointment, fecha: "2038-07-13"});
  await clients.doc("tutor-demo").update({negocioId: "otra-clinica"});
  await run();
  assert.equal((await jobs.doc("contacto-ajeno__confirmacion").get()).get("estado"), "omitido");
  assert.equal(sent.length, 5);
  console.log("VETERINARY_APPOINTMENT_NOTICES_SMOKE_OK");
} finally {
  await deleteApp(app);
  await adminApp.delete();
}
