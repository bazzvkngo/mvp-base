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
const {guardarRecepcionVeterinariaHandler} = require("../functions/veterinaryReceptionPersistence");
const {guardarAtencionVeterinariaHandler} = require("../functions/veterinaryAttentionPersistence");

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
  const businessId = "clinica-ficticia";
  const business = db.doc("negocios/" + businessId);
  const membership = db.doc("membresias/" + businessId + "__" + uid);
  await Promise.all([
    business.set({estado: "activo", paisCodigo: "CL", verificacionEmpresa: {estado: "VERIFICADA"}, modulosHabilitados: ["veterinaria"]}),
    membership.set({uid, negocioId: businessId, estado: "activo", rol: "OWNER"}),
    business.collection("clientes").doc("tutor-demo").set({
      negocioId: businessId, estado: "activo", clienteId: "tutor-demo", nombreRazonSocial: "Tutor ficticio",
    }),
    db.doc("negocios/otra-clinica/clientes/tutor-ajeno").set({negocioId: "otra-clinica", estado: "activo"}),
  ]);
  const citaId = "cita-demo";
  const pacienteId = "paciente-demo";
  const appointment = business.collection("citasVeterinarias").doc(citaId);
  const originalSlot = {fecha: "2099-11-20", hora: "11:00"};
  const product = business.collection("inventario").doc("producto-demo");
  const service = business.collection("inventario").doc("servicio-demo");
  await Promise.all([
    appointment.set({negocioId: businessId, pacienteId, estado: "agendada", motivo: "Control", ...originalSlot}),
    business.collection("citasVeterinarias").doc("cancelada").set({negocioId: businessId, pacienteId, estado: "cancelada"}),
    business.collection("pacientesVeterinarios").doc(pacienteId).set({negocioId: businessId, estado: "activo", tutorClienteId: "tutor-demo"}),
    product.set({negocioId: businessId, estado: "activo", nombre: "Producto ficticio", tipoItem: "producto", unidad: "ml", stock: 10, precioInterno: 750}),
    service.set({negocioId: businessId, estado: "activo", nombre: "Servicio ficticio", tipoItem: "servicio", precioInterno: 2000}),
    db.doc("negocios/otra-clinica/inventario/ajeno").set({negocioId: "otra-clinica", estado: "activo", tipoItem: "producto", stock: 50}),
  ]);
  const control = {fecha: "2099-11-20", hora: "12:00"};
  const clinical = {
    motivoConsulta: "Control", diagnostico: "Diagnóstico ficticio", tratamiento: "Observación",
    indicaciones: "Seguimiento", resultadoClinico: "control", control,
    items: [{itemId: "producto-demo", cantidad: 2.5, nombre: "Nombre manipulado"}, {itemId: "servicio-demo", cantidad: 1}],
  };
  const save = (operacion, patch = {}) => guardarAtencionVeterinariaHandler({
    auth: {uid}, data: {businessId, citaId, atencion: clinical, operacion, ...patch},
  }, {db, HttpsError, FieldValue: admin.firestore.FieldValue, requireBusinessAccess: requireOperationalBusinessAccess});
  const ref = doc(clientDb, "negocios", businessId, "atencionesVeterinarias", citaId);
  await assert.rejects(save("iniciar", {businessId: "otra-clinica"}), {code: "permission-denied"});
  await assert.rejects(save("iniciar", {citaId: "cancelada"}), {code: "failed-precondition"});
  await assert.rejects(save("cerrar"), {code: "failed-precondition"});
  await assert.rejects(setDoc(ref, {negocioId: businessId}), {code: "permission-denied"});
  await assert.rejects(save("iniciar"), {code: "failed-precondition"});
  const receive = (recepcion, patch = {}) => guardarRecepcionVeterinariaHandler({
    auth: {uid}, data: {businessId, citaId, recepcion, ...patch},
  }, {db, HttpsError, FieldValue: admin.firestore.FieldValue, requireBusinessAccess: requireOperationalBusinessAccess});
  const intake = {horaLlegada: "10:20", prioridad: "urgente", pesoKg: 3.5, observacionesTriage: "Prueba local"};
  await assert.rejects(receive(intake, {businessId: "otra-clinica"}), {code: "permission-denied"});
  await assert.rejects(receive(intake, {citaId: "cancelada"}), {code: "failed-precondition"});
  await assert.rejects(receive({...intake, prioridad: "inventada"}), {code: "invalid-argument"});
  await assert.rejects(receive({...intake, pesoKg: -1}), {code: "invalid-argument"});
  assert.equal((await appointment.get()).get("estado"), "agendada");
  await receive(intake);
  const arrival = (await appointment.get()).data();
  assert.equal(arrival.estado, "en_espera");
  assert.equal(arrival.triage.prioridad, "urgente");
  assert.equal(arrival.triage.pesoKg, 3.5);
  await receive({...intake, prioridad: "prioritaria"});
  assert.ok((await appointment.get()).get("recepcion.recibidaEn").isEqual(arrival.recepcion.recibidaEn));
  assert.deepEqual(await Promise.all([save("iniciar"), save("iniciar")]), [{atencionId: citaId}, {atencionId: citaId}]);
  assert.equal((await getDoc(ref)).get("estado"), "en_atencion");
  assert.equal((await getDoc(ref)).get("triage.prioridad"), "prioritaria");
  await assert.rejects(receive(intake), {code: "failed-precondition"});
  assert.equal((await appointment.get()).get("estado"), "en_atencion");
  // Borrador: guarda lo escrito sin exigir los obligatorios y se conserva al recargar.
  await assert.rejects(save("borrador", {businessId: "otra-clinica"}), {code: "permission-denied"});
  await assert.rejects(save("borrador", {atencion: {...clinical, resultadoClinico: "inventado"}}), {code: "invalid-argument"});
  await assert.rejects(save("borrador", {atencion: {...clinical, items: [{itemId: "x", cantidad: 0}]}}), {code: "invalid-argument"});
  await assert.rejects(save("borrador", {citaId: "cancelada"}), {code: "failed-precondition"});
  const partial = {diagnostico: "Solo diagnóstico", items: [{itemId: "producto-demo", cantidad: 2, nombre: "Manipulado"}]};
  assert.deepEqual(await save("borrador", {atencion: partial}), {atencionId: citaId});
  const draftDoc = (await getDoc(ref)).data();
  assert.equal(draftDoc.estado, "en_atencion");
  assert.equal(draftDoc.borrador.diagnostico, "Solo diagnóstico");
  assert.equal(draftDoc.borrador.tratamiento, "");
  assert.deepEqual(draftDoc.borrador.items, [{itemId: "producto-demo", cantidad: 2}]);
  assert.equal(draftDoc.diagnostico, undefined, "el borrador no escribe los campos finales");
  assert.equal((await appointment.get()).get("estado"), "en_atencion");
  // Sin lista de ítems se conserva la del borrador anterior.
  await save("borrador", {atencion: {diagnostico: "Segundo guardado", tratamiento: "Reposo"}});
  const secondDraft = (await getDoc(ref)).get("borrador");
  assert.equal(secondDraft.diagnostico, "Segundo guardado");
  assert.deepEqual(secondDraft.items, [{itemId: "producto-demo", cantidad: 2}]);
  assert.equal((await product.get()).get("stock"), 10);
  await membership.update({rol: "TECNICO"});
  await assert.rejects(save("borrador"), {code: "permission-denied"});
  await membership.update({rol: "OWNER"});
  await assert.rejects(save("cerrar", {atencion: {...clinical, diagnostico: ""}}), {code: "invalid-argument"});
  assert.equal((await getDoc(ref)).get("estado"), "en_atencion", "cerrar sigue exigiendo los obligatorios");
  await assert.rejects(save("cerrar", {atencion: {...clinical, items: [{itemId: "ajeno", cantidad: 1}]}}), {code: "failed-precondition"});
  await assert.rejects(save("cerrar", {atencion: {...clinical, items: [{itemId: "producto-demo", cantidad: 11}]}}), {code: "failed-precondition"});
  await membership.update({rol: "TECNICO"});
  await assert.rejects(save("cerrar"), {code: "permission-denied"});
  await membership.update({rol: "ADMIN"});
  await assert.rejects(save("cerrar", {atencion: {...clinical, control: originalSlot}}), {code: "already-exists"});
  assert.equal((await appointment.get()).get("estado"), "en_atencion");
  assert.deepEqual(await save("cerrar"), {atencionId: citaId});
  await save("cerrar", {atencion: {...clinical, diagnostico: "Cambio posterior"}});
  const closed = (await getDoc(ref)).data();
  assert.equal(closed.estado, "finalizada");
  assert.equal(closed.borrador, undefined, "al cerrar se elimina el borrador");
  await assert.rejects(save("borrador"), {code: "failed-precondition"});
  assert.equal(closed.pacienteId, pacienteId);
  assert.equal(closed.diagnostico, clinical.diagnostico);
  assert.equal(closed.ventaEstado, "generada");
  assert.equal(closed.productos[0].nombre, "Producto ficticio");
  assert.equal(closed.productos[0].cantidad, 2.5);
  assert.equal(closed.servicios[0].nombre, "Servicio ficticio");
  assert.equal((await appointment.get()).get("estado"), "finalizada");
  assert.ok(closed.control?.citaId && closed.control.citaId !== citaId);
  assert.deepEqual(closed.control, {citaId: closed.control.citaId, ...control});
  const followUp = await appointment.parent.doc(closed.control.citaId).get();
  assert.equal(followUp.get("estado"), "agendada");
  assert.equal(followUp.get("pacienteId"), pacienteId);
  assert.equal((await appointment.parent.get()).size, 3, "reintentar el cierre legacy no crea otro control");
  assert.equal((await product.get()).get("stock"), 10);
  await assert.rejects(setDoc(ref, {estado: "en_atencion"}, {merge: true}), {code: "permission-denied"});
  console.log("VETERINARY_ATTENTION_PERSISTENCE_SMOKE_OK");
} finally {
  await deleteApp(app);
  await adminApp.delete();
}
