import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {EventEmitter, on} from "node:events";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {
  collection, connectFirestoreEmulator, doc, getDocFromServer, getDocsFromServer, getFirestore,
  onSnapshot, query, setDoc, where,
} from "firebase/firestore";

const {GCLOUD_PROJECT: projectId, FIREBASE_AUTH_EMULATOR_HOST: authHost, FIRESTORE_EMULATOR_HOST: firestoreHost} = process.env;
if (!projectId?.startsWith("demo-") || !/^127\.0\.0\.1:\d+$/.test(authHost) || !/^127\.0\.0\.1:\d+$/.test(firestoreHost)) {
  throw new Error("Ejecuta el smoke en emuladores locales con un proyecto demo.");
}
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {requireOperationalBusinessAccess} = require("../functions/businessOnboarding");
const {canReadVeterinaryPatient, consultarPacientesVeterinariosAsignadosHandler} = require("../functions/veterinaryAssignedPatients");
const {listarProfesionalesDerivacionVeterinariaHandler} = require("../functions/veterinaryReferralDirectory");
const adminApp = admin.initializeApp({projectId});
const db = adminApp.firestore();
const apps = [];
async function createClinician() {
  const app = initializeApp({projectId, apiKey: "demo-key"}, randomUUID());
  apps.push(app);
  const auth = getAuth(app);
  const clientDb = getFirestore(app);
  connectAuthEmulator(auth, "http://" + authHost, {disableWarnings: true});
  connectFirestoreEmulator(clientDb, "127.0.0.1", Number(firestoreHost.split(":")[1]));
  const {user} = await signInAnonymously(auth);
  return {uid: user.uid, clientDb};
}

const deps = {db, HttpsError, requireBusinessAccess: requireOperationalBusinessAccess};
const businessId = "clinica-" + randomUUID();
const otherBusinessId = "otra-" + randomUUID();
const business = db.doc("negocios/" + businessId);
const patients = business.collection("pacientesVeterinarios");
const appointments = business.collection("citasVeterinarias");
const orders = business.collection("atencionesVeterinarias");
const profile = business.collection("perfilesEmpleados").doc("veterinario");
const denied = {code: "permission-denied"};
const stopPendingOrderWatches = [];

try {
  const [first, second, legacyMember] = await Promise.all([createClinician(), createClinician(), createClinician()]);
  const businessData = {
    estado: "activo", paisCodigo: "CL", verificacionEmpresa: {estado: "VERIFICADA"}, modulosHabilitados: ["veterinaria"],
  };
  await Promise.all([
    business.set(businessData), db.doc("negocios/" + otherBusinessId).set(businessData),
    profile.set({negocioId: businessId, estado: "activo", modulos: ["veterinaria_asignada"]}),
    ...[first, second, legacyMember].map(({uid}, index) =>
      db.doc("membresias/" + businessId + "__" + uid).set({
        uid, negocioId: businessId, estado: "activo", rol: "MEMBER",
        ...(index === 2 ? {} : {profileId: profile.id}),
      }),
    ),
    db.doc("usuarios/" + first.uid).set({nombres: "Ana QA", email: "ana-qa@example.test"}),
    db.doc("usuarios/" + second.uid).set({nombres: "Bruno QA", email: "bruno-qa@example.test"}),
    patients.doc("luna").set({negocioId: businessId, nombre: "Luna", tutorClienteId: "tutor-privado", alergias: "Vacuna ficticia"}),
    patients.doc("luna").collection("perfil").doc("foto").set({imagen: "foto-ficticia", datoInterno: "interno"}),
    patients.doc("sol").set({negocioId: businessId, nombre: "Sol"}),
    patients.doc("cancelado").set({negocioId: businessId, nombre: "Cancelado"}),
    patients.doc("mezclado").set({negocioId: otherBusinessId, nombre: "Mezclado"}),
    appointments.doc("cita-luna").set({negocioId: businessId, pacienteId: "luna", estado: "agendada", profesionalUid: first.uid}),
    appointments.doc("cita-sol").set({negocioId: businessId, pacienteId: "sol", estado: "confirmada", profesionalUid: second.uid}),
    appointments.doc("cita-cancelada").set({negocioId: businessId, pacienteId: "cancelado", estado: "cancelada", profesionalUid: first.uid}),
    appointments.doc("cita-mezclada").set({negocioId: otherBusinessId, pacienteId: "mezclado", estado: "agendada", profesionalUid: first.uid}),
    orders.doc("orden-luna").set({negocioId: businessId, pacienteId: "luna", estado: "en_espera", profesionalUid: first.uid}),
    orders.doc("orden-sol").set({
      negocioId: businessId, pacienteId: "sol", estado: "en_espera", profesionalUid: second.uid,
      box: "Box 2", tipoAtencion: "Consulta",
    }),
    orders.doc("historial-luna").set({
      negocioId: businessId, pacienteId: "luna", estado: "finalizada", profesionalUid: second.uid,
      finalizadaEn: new Date("2026-11-14T14:00:00.000Z"), tratamiento: "Tratamiento de prueba",
      resultadoClinico: "control", control: {citaId: "control-luna", fecha: "2026-11-21", hora: "10:00"},
      recetas: [{recetaId: "r1", emitidaEn: new Date("2026-11-14T11:00:00.000Z"), medicamentos: []}],
      fotosClinicas: [{fotoId: "foto-1", vista: "general", hash: "interno", subidaPorUid: second.uid}],
    }),
  ]);

  const read = (member, pacienteId, company = businessId, soloFoto) => consultarPacientesVeterinariosAsignadosHandler({
    auth: {uid: member.uid},
    data: {businessId: company, ...(pacienteId === undefined ? {} : {pacienteId}), ...(soloFoto === undefined ? {} : {soloFoto})},
  }, deps);
  const listReferrals = (member, atencionId) => listarProfesionalesDerivacionVeterinariaHandler({
    auth: {uid: member.uid}, data: {businessId, atencionId},
  }, deps);
  const clientCollection = (member, name) => collection(member.clientDb, "negocios", businessId, name);
  const clientDoc = (member, name, id) => doc(clientCollection(member, name), id);
  const assignedQuery = (member, name) => query(
    clientCollection(member, name), where("negocioId", "==", businessId), where("profesionalUid", "==", member.uid),
  );
  const pendingOrdersQuery = (member) => query(
    assignedQuery(member, "atencionesVeterinarias"), where("estado", "==", "en_espera"),
  );
  function watchPendingOrders(member) {
    const updates = new EventEmitter();
    const snapshots = on(updates, "orders", {signal: AbortSignal.timeout(30000)});
    const stop = onSnapshot(pendingOrdersQuery(member), {includeMetadataChanges: true}, (snapshot) => {
      if (snapshot.metadata.fromCache) return;
      const ids = snapshot.docs.filter((entry) => entry.get("box") && entry.get("tipoAtencion"))
        .map((entry) => entry.id).sort();
      updates.emit("orders", ids);
    }, (error) => updates.emit("error", error));
    stopPendingOrderWatches.push(() => {
      stop();
      return snapshots.return();
    });
    return async (expected) => {
      const {value: [ids]} = await snapshots.next();
      assert.deepEqual(ids, expected);
    };
  }
  const documentIds = (snapshots) => snapshots.docs.map((document) => document.id).sort();

  assert.deepEqual(documentIds(await getDocsFromServer(assignedQuery(first, "citasVeterinarias"))), ["cita-cancelada", "cita-luna"]);
  assert.deepEqual(documentIds(await getDocsFromServer(assignedQuery(second, "citasVeterinarias"))), ["cita-sol"]);
  assert.deepEqual(documentIds(await getDocsFromServer(assignedQuery(first, "atencionesVeterinarias"))), ["orden-luna"]);
  assert.deepEqual(documentIds(await getDocsFromServer(assignedQuery(second, "atencionesVeterinarias"))), ["historial-luna", "orden-sol"]);
  assert.equal((await getDocFromServer(clientDoc(first, "citasVeterinarias", "cita-luna"))).exists(), true);
  await assert.rejects(getDocFromServer(clientDoc(first, "citasVeterinarias", "cita-sol")), denied);
  await assert.rejects(getDocFromServer(clientDoc(first, "citasVeterinarias", "cita-mezclada")), denied);
  await assert.rejects(getDocFromServer(clientDoc(second, "atencionesVeterinarias", "orden-luna")), denied);
  await assert.rejects(getDocFromServer(clientDoc(first, "atencionesVeterinarias", "historial-luna")), denied);
  await assert.rejects(getDocsFromServer(query(clientCollection(first, "atencionesVeterinarias"),
    where("negocioId", "==", businessId))), denied);
  await assert.rejects(getDocFromServer(clientDoc(first, "pacientesVeterinarios", "luna")), denied);
  await assert.rejects(getDocFromServer(doc(clientDoc(first, "pacientesVeterinarios", "luna"), "perfil", "foto")), denied);
  await assert.rejects(getDocFromServer(clientDoc(legacyMember, "citasVeterinarias", "cita-luna")), denied);
  await assert.rejects(setDoc(clientDoc(first, "atencionesVeterinarias", "orden-luna"), {estado: "finalizada"}, {merge: true}), denied);

  assert.deepEqual(await read(first), {patients: [{id: "luna", nombre: "Luna"}]});
  assert.deepEqual((await read(second)).patients.map(({id}) => id).sort(), ["luna", "sol"]);
  const result = await read(first, "luna");
  assert.deepEqual(result.patient, {
    id: "luna", nombre: "Luna", alergias: "Vacuna ficticia", fotoPerfil: {imagen: "foto-ficticia"},
  });
  assert.deepEqual(await read(first, "luna", businessId, true), {fotoPerfil: {imagen: "foto-ficticia"}});
  assert.deepEqual(await read(second, "sol", businessId, true), {fotoPerfil: null});
  await assert.rejects(read(first, "sol", businessId, true), denied);
  await assert.rejects(read(first, "luna", otherBusinessId, true), denied);
  await assert.rejects(read(first, undefined, businessId, true), {code: "invalid-argument"});
  assert.equal(result.attentions.length, 1);
  assert.equal(result.attentions[0].id, "historial-luna");
  assert.deepEqual(result.attentions[0].control, {fecha: "2026-11-21", hora: "10:00"});
  assert.equal((await read(second, "luna")).attentions[0].control.citaId, "control-luna");
  assert.equal(result.attentions[0].finalizadaEn, "2026-11-14T14:00:00.000Z");
  assert.equal(result.attentions[0].recetas[0].emitidaEn, "2026-11-14T11:00:00.000Z");
  assert.deepEqual(result.attentions[0].fotosClinicas[0], {fotoId: "foto-1", vista: "general"});
  assert.deepEqual((await read(second, "sol")).attentions, []);
  for (const pacienteId of ["sol", "cancelado", "mezclado"]) {
    await assert.rejects(read(first, pacienteId), denied);
  }
  await assert.rejects(read(first, "luna", otherBusinessId), denied);
  await assert.rejects(read(legacyMember), denied);
  assert.equal(await canReadVeterinaryPatient(business, businessId, "luna", first.uid), true);
  await assert.rejects(listReferrals(first, "orden-luna"), {code: "failed-precondition"});

  await assert.rejects(getDocsFromServer(pendingOrdersQuery(legacyMember)), denied);
  const expectFirstPending = watchPendingOrders(first);
  const expectSecondPending = watchPendingOrders(second);
  await Promise.all([expectFirstPending([]), expectSecondPending(["orden-sol"])]);

  await orders.doc("orden-luna").update({box: "Box 1", tipoAtencion: "Control"});
  await expectFirstPending(["orden-luna"]);

  await Promise.all([
    appointments.doc("cita-luna").update({profesionalUid: second.uid}),
    orders.doc("orden-luna").update({profesionalUid: second.uid}),
  ]);
  await Promise.all([expectFirstPending([]), expectSecondPending(["orden-luna", "orden-sol"])]);
  await assert.rejects(read(first, "luna"), denied);
  await assert.rejects(getDocFromServer(clientDoc(first, "atencionesVeterinarias", "orden-luna")), denied);
  assert.equal(await canReadVeterinaryPatient(business, businessId, "luna", first.uid), false);

  await orders.doc("orden-luna").update({estado: "en_atencion"});
  await expectSecondPending(["orden-sol"]);
  assert.deepEqual(await listReferrals(second, "orden-luna"), {profesionales: [
    {uid: first.uid, nombre: "Ana QA"}, {uid: second.uid, nombre: "Bruno QA"},
  ]});
  await assert.rejects(listReferrals(first, "orden-luna"), {code: "not-found"});
  await assert.rejects(listReferrals(legacyMember, "orden-luna"), denied);
  await orders.doc("orden-sol").update({estado: "cancelada"});
  await expectSecondPending([]);
  await Promise.all(stopPendingOrderWatches.splice(0).map((stop) => stop()));

  await profile.update({estado: "inactivo"});
  await assert.rejects(listReferrals(second, "orden-luna"), denied);
  await assert.rejects(read(second, "sol"), denied);
  await assert.rejects(getDocFromServer(clientDoc(second, "atencionesVeterinarias", "orden-sol")), denied);
  console.log("VETERINARY_ASSIGNED_PATIENTS_SMOKE_OK");
} finally {
  await Promise.all(stopPendingOrderWatches.map((stop) => stop()));
  await Promise.all(apps.map((app) => deleteApp(app)));
  await adminApp.delete();
}
