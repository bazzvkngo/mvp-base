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
const {guardarPacienteVeterinarioHandler} = require("../functions/veterinaryPatientPersistence");

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
  const businessId = "clinica-pacientes-" + uid;
  const business = db.doc("negocios/" + businessId);
  const membership = db.doc("membresias/" + businessId + "__" + uid);
  await Promise.all([
    business.set({estado: "activo", paisCodigo: "CL", verificacionEmpresa: {estado: "VERIFICADA"}, modulosHabilitados: ["veterinaria"]}),
    membership.set({uid, negocioId: businessId, estado: "activo", rol: "OWNER"}),
    business.collection("clientes").doc("tutor-demo").set({negocioId: businessId, estado: "activo"}),
    db.doc("negocios/otra-clinica/clientes/tutor-ajeno").set({negocioId: "otra-clinica", estado: "activo"}),
  ]);
  const pacienteId = "paciente-demo";
  const paciente = {microchip: "00-ab 12", nombre: "Luna", especie: "Canina", tutorClienteId: "tutor-demo"};
  const save = (patch = {}) => guardarPacienteVeterinarioHandler({
    auth: {uid}, data: {businessId, pacienteId, paciente, requestId: "crear-demo", operacion: "crear", ...patch},
  }, {db, HttpsError, FieldValue: admin.firestore.FieldValue, requireBusinessAccess: requireOperationalBusinessAccess});
  const ref = doc(clientDb, "negocios", businessId, "pacientesVeterinarios", pacienteId);
  await assert.rejects(save({businessId: "otra-clinica"}), {code: "permission-denied"});
  await assert.rejects(save({paciente: {...paciente, tutorClienteId: "tutor-ajeno"}}), {code: "failed-precondition"});
  await assert.rejects(save({paciente: {...paciente, nombre: ""}}), {code: "invalid-argument"});
  await assert.rejects(setDoc(ref, {negocioId: businessId}), {code: "permission-denied"});
  assert.deepEqual(await Promise.all([save(), save()]), [{pacienteId}, {pacienteId}]);
  const original = (await getDoc(ref)).data();
  assert.equal(original.nombre, "Luna");
  assert.equal(original.negocioId, businessId);
  assert.equal(original.creadoPorUid, uid);
  assert.equal(original.microchip, "00AB12");
  await assert.rejects(save({requestId: "otro-paciente", pacienteId: "otro-paciente"}), {code: "already-exists"});
  await assert.rejects(save({paciente: {...paciente, nombre: "Otro"}}), {code: "already-exists"});
  const secondAdmin = await admin.auth().createUser({});
  await db.doc("membresias/" + businessId + "__" + secondAdmin.uid).set({
    uid: secondAdmin.uid, negocioId: businessId, estado: "activo", rol: "ADMIN",
  });
  const edit = {operacion: "editar", requestId: "edicion-demo", version: 1, paciente: {...paciente, microchip: "00-CD", nombre: "Luna Demo"}};
  await save(edit);
  await assert.rejects(guardarPacienteVeterinarioHandler({
    auth: {uid: secondAdmin.uid}, data: {businessId, pacienteId, ...edit, requestId: "edicion-paralela"},
  }, {db, HttpsError, FieldValue: admin.firestore.FieldValue, requireBusinessAccess: requireOperationalBusinessAccess}), {code: "aborted"});
  assert.deepEqual(await save(edit), {pacienteId});
  assert.equal((await business.collection("microchipsVeterinarios").doc("00AB12").get()).exists, false);
  await save({requestId: "otro-paciente", pacienteId: "otro-paciente"});
  await assert.rejects(save({...edit, version: 2, requestId: "edicion-falla", paciente}), {code: "already-exists"});
  assert.equal((await business.collection("microchipsVeterinarios").doc("00CD").get()).get("pacienteId"), pacienteId);
  const updated = (await getDoc(ref)).data();
  assert.equal(updated.nombre, "Luna Demo");
  assert.equal(updated.negocioId, businessId);
  assert.ok(updated.creadoEn.isEqual(original.creadoEn));
  await assert.rejects(setDoc(ref, {nombre: "Cambio directo"}, {merge: true}), {code: "permission-denied"});
  await business.update({modulosHabilitados: []});
  await assert.rejects(save({operacion: "editar", version: 2, requestId: "edicion-denegada"}), {code: "failed-precondition"});
  await business.update({modulosHabilitados: ["veterinaria"], "verificacionEmpresa.estado": "NO_VERIFICADA"});
  await assert.rejects(save({operacion: "editar", version: 2, requestId: "edicion-denegada"}), {code: "failed-precondition"});
  await business.update({"verificacionEmpresa.estado": "VERIFICADA"});
  await membership.update({rol: "TECNICO"});
  await assert.rejects(save({operacion: "editar", version: 2, requestId: "edicion-denegada"}), {code: "permission-denied"});
  await membership.update({rol: "OWNER"});
  const concurrent = await Promise.allSettled([
    save({requestId: "paralelo-a", pacienteId: "paralelo-a", paciente: {...paciente, microchip: "00-x y"}}),
    save({requestId: "paralelo-b", pacienteId: "paralelo-b", paciente: {...paciente, microchip: "00XY"}}),
  ]);
  assert.equal(concurrent.filter(({status}) => status === "fulfilled").length, 1);
  assert.equal(concurrent.find(({status}) => status === "rejected").reason.code, "already-exists");
  const winner = concurrent.find(({status}) => status === "fulfilled").value.pacienteId;
  assert.equal((await business.collection("microchipsVeterinarios").doc("00XY").get()).get("pacienteId"), winner);
  assert.equal((await business.collection("pacientesVeterinarios").where("microchip", "==", "00XY").get()).size, 1);
  console.log("VETERINARY_PATIENT_PERSISTENCE_SMOKE_OK");
} finally {
  await deleteApp(app);
  await adminApp.delete();
}
