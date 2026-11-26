import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc} from "firebase/firestore";

const {GCLOUD_PROJECT: projectId, FIREBASE_AUTH_EMULATOR_HOST: authHost, FIRESTORE_EMULATOR_HOST: firestoreHost} = process.env;
if (!projectId?.startsWith("demo-") || !/^127\.0\.0\.1:\d+$/.test(authHost) || !/^127\.0\.0\.1:\d+$/.test(firestoreHost)) {
  throw new Error("Ejecuta el smoke en emuladores locales con un proyecto demo.");
}
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {requireOperationalBusinessAccess} = require("../functions/businessOnboarding");
const {guardarCitaVeterinariaHandler} = require("../functions/veterinaryAppointmentPersistence");

const adminApp = admin.initializeApp({projectId});
const app = initializeApp({projectId, apiKey: "demo-key"});
const auth = getAuth(app);
const clientDb = getFirestore(app);
connectAuthEmulator(auth, "http://" + authHost, {disableWarnings: true});
connectFirestoreEmulator(clientDb, "127.0.0.1", Number(firestoreHost.split(":")[1]));
const db = admin.firestore();
try {
  const {user} = await signInAnonymously(auth);
  const uid = user.uid;
  const businessId = "clinica-citas-" + uid;
  const business = db.doc("negocios/" + businessId);
  const membership = db.doc("membresias/" + businessId + "__" + uid);
  await Promise.all([
    business.set({estado: "activo", paisCodigo: "CL", verificacionEmpresa: {estado: "VERIFICADA"}, modulosHabilitados: ["veterinaria"]}),
    membership.set({uid, negocioId: businessId, estado: "activo", rol: "OWNER"}),
    business.collection("clientes").doc("tutor-demo").set({negocioId: businessId, estado: "activo"}),
    db.doc("negocios/otra-clinica/clientes/tutor-ajeno").set({negocioId: "otra-clinica", estado: "activo"}),
  ]);
  await Promise.all([
    business.collection("pacientesVeterinarios").doc("paciente-demo").set({negocioId: businessId, estado: "activo", tutorClienteId: "tutor-demo"}),
    db.doc("negocios/otra-clinica/pacientesVeterinarios/paciente-ajeno").set({negocioId: "otra-clinica", estado: "activo", tutorClienteId: "tutor-ajeno"}),
  ]);
  const citaId = "cita-demo";
  const cita = {pacienteId: "paciente-demo", fecha: "2099-11-12", hora: "10:30", motivo: "Control de prueba"};
  const save = (patch = {}, dependencyDb = db, requireBusinessAccess = requireOperationalBusinessAccess) => guardarCitaVeterinariaHandler({
    auth: {uid}, data: {businessId, citaId, cita, operacion: "crear", ...patch},
  }, {db: dependencyDb, HttpsError, FieldValue: admin.firestore.FieldValue, requireBusinessAccess});
  // El Core valida la empresa antes de que el handler resuelva su zona horaria.
  // Conservamos el acceso real y variamos solo el país que recibe el handler.
  const accessWithCountry = (country) => async (...args) => {
    const access = await requireOperationalBusinessAccess(...args);
    const businessData = {...access.businessSnapshot.data()};
    if (country === null) delete businessData.paisCodigo;
    else businessData.paisCodigo = country;
    return {...access, businessSnapshot: {data: () => businessData}};
  };
  const missingTimeZone = {
    code: "failed-precondition",
    message: "Configura un país con zona horaria definida para la empresa.",
  };
  const ref = doc(clientDb, "negocios", businessId, "citasVeterinarias", citaId);
  await assert.rejects(save({businessId: "otra-clinica"}), {code: "permission-denied"});
  await assert.rejects(save({cita: {...cita, pacienteId: "paciente-ajeno"}}), {code: "failed-precondition"});
  await assert.rejects(save({cita: {...cita, hora: "25:00"}}), {code: "invalid-argument"});
  await assert.rejects(setDoc(ref, {negocioId: businessId}), {code: "permission-denied"});

  for (const country of [null, "OTHER"]) {
    await assert.rejects(save({}, db, accessWithCountry(country)), missingTimeZone);
    assert.equal((await business.collection("citasVeterinarias").doc(citaId).get()).exists, false);
    assert.equal((await business.collection("cuposVeterinarios").get()).size, 0);
  }
  const competing = await Promise.allSettled([save(), save({citaId: "cita-competidora"})]);
  assert.equal(competing.filter(({status}) => status === "fulfilled").length, 1);
  assert.equal(competing.find(({status}) => status === "rejected").reason.code, "already-exists");
  const winner = competing.find(({status}) => status === "fulfilled").value.citaId;
  const winningRef = doc(clientDb, "negocios", businessId, "citasVeterinarias", winner);
  assert.deepEqual(await save({citaId: winner}), {citaId: winner});
  const original = (await getDoc(winningRef)).data();
  assert.equal(original.tutorClienteId, "tutor-demo");
  await membership.update({rol: "ADMIN"});
  await business.collection("citasVeterinarias").doc(winner).update({estado: "confirmada"});
  for (const country of [null, "OTHER"]) {
    await assert.rejects(
      save({citaId: winner, operacion: "reprogramar", cita: {...cita, hora: "11:30"}}, db, accessWithCountry(country)),
      missingTimeZone,
    );
    assert.equal((await getDoc(winningRef)).get("hora"), "10:30");
  }
  await save({citaId: winner, operacion: "reprogramar", cita: {...cita, hora: "11:30"}});
  const updated = (await getDoc(winningRef)).data();
  assert.equal(updated.hora, "11:30");
  assert.equal(updated.estado, "confirmada");
  assert.equal(updated.zonaHoraria, "America/Santiago");
  assert.ok(updated.creadoEn.isEqual(original.creadoEn));
  await assert.rejects(setDoc(winningRef, {estado: "cancelada"}, {merge: true}), {code: "permission-denied"});
  await save({citaId: "cita-liberada"});
  await save({citaId: winner, operacion: "cancelar"});
  await save({citaId: winner, operacion: "cancelar"});
  assert.equal((await getDoc(winningRef)).get("estado"), "cancelada");
  await assert.rejects(save({citaId: winner, operacion: "reprogramar"}), {code: "failed-precondition"});
  await save({citaId: "cita-reutilizada", cita: {...cita, hora: "11:30"}});
  // Change references after discovery and before the authoritative getAll.
  const changeBeforeTransaction = (change) => new Proxy(db, {
    get(target, key) {
      if (key === "runTransaction") return async (...args) => {
        await change();
        return target.runTransaction(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const patientRef = business.collection("pacientesVeterinarios").doc("paciente-demo");
  await business.collection("clientes").doc("otro-tutor").set({negocioId: businessId, estado: "activo"});
  await assert.rejects(save({citaId: "tutor-cambio", cita: {...cita, hora: "12:30"}}, changeBeforeTransaction(
    () => patientRef.update({tutorClienteId: "otro-tutor"}),
  )), {code: "aborted"});
  assert.equal((await business.collection("citasVeterinarias").doc("tutor-cambio").get()).exists, false);
  assert.equal((await business.collection("cuposVeterinarios").doc(cita.fecha + "_1230").get()).exists, false);
  await patientRef.update({tutorClienteId: "tutor-demo"});
  const reusable = business.collection("citasVeterinarias").doc("cita-reutilizada");
  await assert.rejects(save({citaId: "cita-reutilizada", operacion: "reprogramar", cita: {...cita, hora: "12:30"}}, changeBeforeTransaction(
    () => reusable.update({estado: "confirmada"}),
  )), {code: "aborted"});
  assert.equal((await reusable.get()).get("hora"), "11:30");
  assert.equal((await business.collection("cuposVeterinarios").doc(cita.fecha + "_1130").get()).get("citaId"), "cita-reutilizada");
  await business.update({modulosHabilitados: []});
  await assert.rejects(save(), {code: "failed-precondition"});
  await business.update({modulosHabilitados: ["veterinaria"]});
  await membership.update({rol: "TECNICO"});
  await assert.rejects(save(), {code: "permission-denied"});
  console.log("VETERINARY_APPOINTMENT_PERSISTENCE_SMOKE_OK");
} finally {
  await deleteApp(app);
  await adminApp.delete();
}
