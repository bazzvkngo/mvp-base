import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, query, setDoc, where} from "firebase/firestore";

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
const {guardarBoxVeterinarioHandler} = require("../functions/veterinaryBoxPersistence");
const {guardarCitaVeterinariaHandler} = require("../functions/veterinaryAppointmentPersistence");
const {listarCatalogoVeterinarioParaAtencionHandler} = require("../functions/veterinaryAssignedCatalog");

const adminApp = admin.initializeApp({projectId});
const app = initializeApp({projectId, apiKey: "demo-key"});
const assignedApp = initializeApp({projectId, apiKey: "demo-key"}, "profesional-asignado");
const auth = getAuth(app);
const clientDb = getFirestore(app);
const assignedAuth = getAuth(assignedApp);
const assignedClientDb = getFirestore(assignedApp);
connectAuthEmulator(auth, "http://" + authHost, {disableWarnings: true});
connectFirestoreEmulator(clientDb, "127.0.0.1", Number(firestoreHost.split(":")[1]));
connectAuthEmulator(assignedAuth, "http://" + authHost, {disableWarnings: true});
connectFirestoreEmulator(assignedClientDb, "127.0.0.1", Number(firestoreHost.split(":")[1]));
const db = admin.firestore();
const dependencies = {
  db, HttpsError, FieldValue: admin.firestore.FieldValue, requireBusinessAccess: requireOperationalBusinessAccess,
};

try {
  const {user: owner} = await signInAnonymously(auth);
  const professional = await admin.auth().createUser({displayName: "Profesional de prueba"});
  const outsider = await admin.auth().createUser({displayName: "Profesional de otra clínica"});
  const technician = await admin.auth().createUser({displayName: "Técnico de prueba"});
  const {user: veterinarian} = await signInAnonymously(assignedAuth);
  const otherVeterinarian = await admin.auth().createUser({displayName: "Veterinario de prueba"});
  const businessId = "ordenes-" + randomUUID();
  const otherBusinessId = "otra-" + randomUUID();
  const business = db.doc("negocios/" + businessId);
  const otherBusiness = db.doc("negocios/" + otherBusinessId);
  const businessData = {
    estado: "activo", paisCodigo: "CL", verificacionEmpresa: {estado: "VERIFICADA"}, modulosHabilitados: ["veterinaria"],
  };
  const membership = (member, rol, company = businessId) =>
    db.doc("membresias/" + company + "__" + member.uid).set({uid: member.uid, negocioId: company, estado: "activo", rol});
  const vetProfile = {negocioId: businessId, estado: "activo", nombre: "Veterinario", modulos: ["veterinaria_asignada"]};
  const vetProfileRef = business.collection("perfilesEmpleados").doc("perfil-veterinario");
  const patients = business.collection("pacientesVeterinarios");
  const appointments = business.collection("citasVeterinarias");
  const orders = business.collection("atencionesVeterinarias");
  const pacienteId = "paciente-ficticio";
  const citaId = "cita-programada";
  const legacyCitaId = "cita-anterior";
  const cancelCitaId = "cita-por-cancelar";
  const cancelOrderId = "orden-por-cancelar";
  const cancelSlot = business.collection("cuposVeterinarios").doc("2026-11-29_1130");
  const unreservedSlot = {fecha: "2099-11-20", hora: "10:45"};
  const orderId = "orden-programada";
  const emergencyId = "orden-emergencia";
  const directId = "orden-directa";
  await Promise.all([
    business.set(businessData),
    otherBusiness.set(businessData),
    membership(owner, "OWNER"),
    membership(professional, "ADMIN"),
    membership(technician, "TECNICO"),
    membership(outsider, "OWNER", otherBusinessId),
    vetProfileRef.set(vetProfile),
    ...[veterinarian, otherVeterinarian].map(({uid}) => db.doc("membresias/" + businessId + "__" + uid)
      .set({uid, negocioId: businessId, estado: "activo", rol: "MEMBER", profileId: vetProfileRef.id})),
    db.doc("usuarios/" + professional.uid + "/cuenta/perfil").set({nombres: "Profesional", apellidos: "de prueba"}),
    db.doc("usuarios/" + veterinarian.uid + "/cuenta/perfil").set({nombres: "Veterinaria", apellidos: "de prueba"}),
    business.collection("clientes").doc("tutor-ficticio").set({
      negocioId: businessId, estado: "activo", clienteId: "tutor-ficticio", nombreRazonSocial: "Tutor ficticio",
    }),
    patients.doc(pacienteId).set({negocioId: businessId, estado: "activo", tutorClienteId: "tutor-ficticio"}),
    business.collection("inventario").doc("control-ficticio").set({
      negocioId: businessId, estado: "activo", nombre: "Control ficticio", tipoItem: "servicio", costo: 123, precioInterno: 10000,
    }),
    otherBusiness.collection("pacientesVeterinarios").doc("paciente-ajeno").set({negocioId: otherBusinessId, estado: "activo"}),
    appointments.doc(cancelCitaId).set({
      negocioId: businessId, pacienteId, estado: "agendada", motivo: "Cita para cancelar", fecha: "2026-11-29", hora: "11:30",
    }),
    cancelSlot.set({citaId: cancelCitaId}),
    appointments.doc(legacyCitaId).set({negocioId: businessId, pacienteId, estado: "agendada", motivo: "Control ficticio"}),
    appointments.doc("cita-sin-reserva").set({negocioId: businessId, pacienteId, estado: "confirmada", ...unreservedSlot}),
  ]);

  const handle = (operacion, data, uid = owner.uid) =>
    guardarAtencionVeterinariaHandler({auth: {uid}, data: {businessId, operacion, ...data}}, dependencies);
  const saveBox = (nombre, uid = owner.uid, company = businessId) => guardarBoxVeterinarioHandler({
    auth: {uid}, data: {businessId: company, nombre},
  }, dependencies);
  const [{boxId: surgeryBoxId}, {boxId: foreignBoxId}] = await Promise.all([
    saveBox("  Box   Cirugía  ", professional.uid),
    saveBox("Box de otra clínica", outsider.uid, otherBusinessId),
    saveBox("Box 1"),
    saveBox("Box Emergencia"),
    saveBox("Box concurrente"),
  ]);
  await assert.rejects(saveBox(" box cirugía "), {code: "already-exists"});
  await assert.rejects(saveBox("   "), {code: "invalid-argument"});
  await assert.rejects(saveBox("Box sin permisos", veterinarian.uid), {code: "permission-denied"});
  await assert.rejects(saveBox("Box sin permisos", outsider.uid), {code: "permission-denied"});
  const surgeryBox = doc(clientDb, "negocios", businessId, "boxesVeterinarios", surgeryBoxId);
  assert.equal((await getDoc(surgeryBox)).get("nombre"), "Box Cirugía");
  const boxesQuery = (client, company) => query(collection(client, "negocios", company, "boxesVeterinarios"), where("negocioId", "==", company));
  assert.deepEqual((await getDocs(boxesQuery(clientDb, businessId))).docs.map((item) => item.get("nombre")).sort(), [
    "Box 1", "Box Cirugía", "Box Emergencia", "Box concurrente",
  ]);
  await assert.rejects(getDoc(doc(clientDb, "negocios", otherBusinessId, "boxesVeterinarios", foreignBoxId)), {code: "permission-denied"});
  await assert.rejects(getDocs(boxesQuery(assignedClientDb, businessId)), {code: "permission-denied"});
  await assert.rejects(setDoc(surgeryBox, {nombre: "Box manipulado"}, {merge: true}), {code: "permission-denied"});

  const receive = (id, prioridad) => guardarRecepcionVeterinariaHandler({
    auth: {uid: owner.uid}, data: {businessId, citaId: id, recepcion: {horaLlegada: "09:15", prioridad, pesoKg: 5}},
  }, dependencies);
  const create = (atencionId, atencion, cita = {}) => handle("crearOrden", {atencionId, atencion, ...cita});
  const directData = {origen: "directa", pacienteId, horaLlegada: "09:20", prioridad: "normal", motivoConsulta: "Llegada sin cita"};
  const emergencyData = {...directData, origen: "emergencia", horaLlegada: "09:25", prioridad: "urgente", motivoConsulta: "Urgencia ficticia"};
  const fromCalendar = {atencionId: orderId, citaId, atencion: {origen: "cita"}};
  const appointmentData = {pacienteId, fecha: "2099-11-20", hora: "10:00", motivo: "Control ficticio"};
  const saveAppointment = (operacion, cita, actorUid = owner.uid) => guardarCitaVeterinariaHandler({
    auth: {uid: actorUid}, data: {businessId, citaId, operacion, cita},
  }, dependencies);

  await assert.rejects(saveAppointment("crear", {...appointmentData, profesionalUid: outsider.uid}), {code: "failed-precondition"});
  await assert.rejects(saveAppointment("crear", {...appointmentData, profesionalUid: veterinarian.uid}, veterinarian.uid),
    {code: "permission-denied"});
  await saveAppointment("crear", {...appointmentData, profesionalUid: veterinarian.uid});
  assert.equal((await appointments.doc(citaId).get()).get("profesionalUid"), veterinarian.uid);
  await saveAppointment("reprogramar", {...appointmentData, hora: "10:15", profesionalUid: ""});
  assert.equal((await appointments.doc(citaId).get()).get("profesionalUid"), "");
  await saveAppointment("reprogramar", {...appointmentData, profesionalUid: otherVeterinarian.uid});
  await saveAppointment("reprogramar", {...appointmentData, hora: "10:15"});
  assert.equal((await appointments.doc(citaId).get()).get("profesionalUid"), otherVeterinarian.uid);

  await assert.rejects(handle("crearOrden", fromCalendar), {code: "failed-precondition"});
  await assert.rejects(handle("crearOrden", fromCalendar, outsider.uid), {code: "permission-denied"});
  await assert.rejects(handle("crearOrden", fromCalendar, technician.uid), {code: "permission-denied"});
  await assert.rejects(create("paciente-fuera", {...directData, pacienteId: "paciente-ajeno"}), {code: "failed-precondition"});
  await receive(citaId, "prioritaria");
  assert.equal((await appointments.doc(citaId).get()).get("estado"), "en_espera");
  assert.deepEqual(await handle("crearOrden", fromCalendar), {atencionId: orderId});
  const waiting = (await orders.doc(orderId).get()).data();
  assert.equal(waiting.estado, "en_espera");
  assert.equal(waiting.origen, "cita");
  assert.equal(waiting.pacienteId, pacienteId);
  assert.equal(waiting.citaId, citaId);
  assert.equal(waiting.profesionalUid, otherVeterinarian.uid);
  assert.equal(waiting.recepcion.horaLlegada, "09:15");
  assert.equal(waiting.triage.prioridad, "prioritaria");
  assert.equal(waiting.triage.pesoKg, 5);
  assert.equal((await appointments.doc(citaId).get()).get("atencionId"), orderId);
  assert.equal((await orders.doc(citaId).get()).exists, false, "la orden no adopta el id de la cita");
  assert.deepEqual(await handle("crearOrden", fromCalendar), {atencionId: orderId});
  await assert.rejects(create("otra-orden", {origen: "cita"}, {citaId}), {code: "already-exists"});
  assert.equal((await orders.doc("otra-orden").get()).exists, false);
  await assert.rejects(handle("iniciar", {atencionId: orderId}, otherVeterinarian.uid), {code: "failed-precondition"});

  const appointmentCount = (await appointments.get()).size;
  assert.deepEqual(await create(directId, directData), {atencionId: directId});
  assert.deepEqual(await create(directId, directData), {atencionId: directId});
  await assert.rejects(create(emergencyId, {...emergencyData, prioridad: "normal"}), {code: "invalid-argument"});
  await assert.rejects(create(emergencyId, emergencyData, {citaId}), {code: "invalid-argument"});
  assert.deepEqual(await create(emergencyId, emergencyData), {atencionId: emergencyId});
  for (const [id, data] of [[directId, directData], [emergencyId, emergencyData]]) {
    const order = (await orders.doc(id).get()).data();
    assert.equal(order.estado, "en_espera");
    assert.equal(order.origen, data.origen);
    assert.equal(order.triage.prioridad, data.prioridad);
    assert.equal(order.recepcion.horaLlegada, data.horaLlegada);
    assert.ok(!order.citaId, "una orden sin cita no conserva vínculos de agenda");
  }
  assert.equal((await appointments.get()).size, appointmentCount, "recepción directa y emergencia no crean citas");

  const assignment = {box: "Box 1", tipoAtencion: "Consulta", profesionalUid: professional.uid};
  await assert.rejects(handle("asignarOrden", {
    atencionId: orderId, atencion: {...assignment, profesionalUid: outsider.uid},
  }), {code: "failed-precondition"});
  await assert.rejects(handle("asignarOrden", {
    atencionId: orderId, atencion: {...assignment, profesionalUid: technician.uid},
  }), {code: "failed-precondition"});

  for (const nonexistentBox of ["Box que no existe", "Box de otra clínica"]) {
    await assert.rejects(handle("asignarOrden", {
      atencionId: directId, atencion: {...assignment, box: nonexistentBox},
    }), {code: "failed-precondition"});
  }
  assert.equal((await orders.doc(directId).get()).get("box"), undefined);

  const vetAssignment = {atencionId: directId, atencion: {...assignment, box: " box  cirugía ", profesionalUid: veterinarian.uid}};
  for (const invalidProfile of [
    {...vetProfile, nombre: "Tecnico veterinario", modulos: ["inventario"]},
    {...vetProfile, estado: "inactivo"},
    {...vetProfile, negocioId: otherBusinessId},
  ]) {
    await vetProfileRef.set(invalidProfile);
    await assert.rejects(handle("asignarOrden", vetAssignment), {code: "failed-precondition"});
  }
  await vetProfileRef.set(vetProfile);
  await assert.rejects(handle("asignarOrden", vetAssignment, veterinarian.uid), {code: "permission-denied"});
  assert.deepEqual(await handle("asignarOrden", vetAssignment), {atencionId: directId});
  const assignedSurgery = await orders.doc(directId).get();
  assert.equal(assignedSurgery.get("profesionalUid"), veterinarian.uid);
  assert.equal(assignedSurgery.get("box"), "Box Cirugía");
  await assert.rejects(handle("iniciar", {atencionId: directId}, otherVeterinarian.uid), {code: "permission-denied"});

  assert.deepEqual(await handle("asignarOrden", {atencionId: orderId, atencion: assignment}), {atencionId: orderId});
  const assigned = (await orders.doc(orderId).get()).data();
  assert.equal(assigned.box, assignment.box);
  assert.equal(assigned.tipoAtencion, assignment.tipoAtencion);
  assert.equal(assigned.profesionalUid, professional.uid);
  assert.equal(assigned.profesionalNombre, "Profesional de prueba");
  assert.equal((await appointments.doc(citaId).get()).get("profesionalUid"), professional.uid);
  await assert.rejects(handle("asignarOrden", {
    atencionId: directId, atencion: {...assignment, box: "  box 1  "},
  }), {code: "already-exists"});

  // Una orden de antes del catálogo conserva el box que ya tenía reservado.
  const oldBoxOrderId = "orden-box-anterior";
  const {boxId: oldBoxId} = await saveBox("Box anterior");
  await create(oldBoxOrderId, directData);
  await handle("asignarOrden", {atencionId: oldBoxOrderId, atencion: {...assignment, box: "Box anterior"}});
  await business.collection("boxesVeterinarios").doc(oldBoxId).delete();
  await handle("asignarOrden", {
    atencionId: oldBoxOrderId, atencion: {...assignment, box: " box anterior ", tipoAtencion: "Control"},
  });
  const oldBoxOrder = await orders.doc(oldBoxOrderId).get();
  assert.equal(oldBoxOrder.get("box"), "Box anterior");
  assert.equal(oldBoxOrder.get("tipoAtencion"), "Control");
  await handle("cancelarOrden", {atencionId: oldBoxOrderId});

  const competingOrders = ["primera-orden-box", "segunda-orden-box"];
  await Promise.all(competingOrders.map((id) => create(id, directData)));
  const boxAssignments = await Promise.allSettled(competingOrders.map((atencionId) => handle("asignarOrden", {
    atencionId, atencion: {...assignment, box: "Box concurrente"},
  })));
  assert.equal(boxAssignments.filter(({status}) => status === "fulfilled").length, 1);
  assert.equal(boxAssignments.find(({status}) => status === "rejected").reason.code, "already-exists");
  const winner = competingOrders[boxAssignments.findIndex(({status}) => status === "fulfilled")];
  await handle("cancelarOrden", {atencionId: winner});

  await assert.rejects(handle("iniciar", {atencionId: orderId}), {code: "permission-denied"});
  const waitingRecipe = {
    recetaId: "receta-antes-de-iniciar",
    medicamentos: [{nombre: "Ficticio", dosis: "Prueba", frecuencia: "Prueba", duracion: "Prueba"}],
  };
  await assert.rejects(handle("emitirReceta", {atencionId: orderId, atencion: waitingRecipe}, professional.uid),
    {code: "failed-precondition"});
  assert.deepEqual(await handle("iniciar", {atencionId: orderId}, professional.uid), {atencionId: orderId});
  assert.deepEqual(await handle("iniciar", {atencionId: orderId}, professional.uid), {atencionId: orderId});
  assert.equal((await appointments.doc(citaId).get()).get("estado"), "en_atencion");
  assert.equal((await orders.doc(orderId).get()).get("iniciadoPorUid"), professional.uid);

  const clinical = {
    motivoConsulta: "Control ficticio", diagnostico: "Diagnóstico de prueba", tratamiento: "Observación",
    indicaciones: "Seguimiento", resultadoClinico: "alta",
    items: [{itemId: "control-ficticio", cantidad: 1}],
  };
  const recipe = {
    recetaId: "receta-ficticia",
    medicamentos: [{
      nombre: "Medicamento ficticio", dosis: "Dosis de prueba", frecuencia: "Frecuencia de prueba", duracion: "Duración de prueba",
      instrucciones: "Instrucciones de prueba",
    }],
    indicaciones: "Receta de prueba",
  };
  const issue = (atencion = recipe, uid = professional.uid) => handle("emitirReceta", {atencionId: orderId, atencion}, uid);
  await assert.rejects(issue(recipe, owner.uid), {code: "permission-denied"});
  await assert.rejects(issue({...recipe, medicamentos: []}), {code: "invalid-argument"});
  const recipeResult = {atencionId: orderId, recetaId: recipe.recetaId};
  assert.deepEqual(await issue(), recipeResult);
  const [issued] = (await orders.doc(orderId).get()).get("recetas");
  assert.equal(issued.recetaId, recipe.recetaId);
  assert.deepEqual(issued.medicamentos, recipe.medicamentos);
  assert.equal(issued.indicaciones, recipe.indicaciones);
  assert.equal(issued.profesionalUid, professional.uid);
  assert.equal(issued.profesionalNombre, "Profesional de prueba");
  assert.ok(issued.emitidaEn?.toMillis() > 0);
  assert.deepEqual(await issue(), recipeResult);
  assert.equal((await orders.doc(orderId).get()).get("recetas").length, 1);
  await assert.rejects(issue({...recipe, indicaciones: "Intento de reemplazo"}), {code: "already-exists"});

  await handle("borrador", {atencionId: orderId, atencion: {diagnostico: "Borrador ficticio"}}, professional.uid);
  assert.equal((await orders.doc(orderId).get()).get("borrador.diagnostico"), "Borrador ficticio");
  await handle("borrador", {atencionId: orderId, atencion: {
    resultadoClinico: "derivacion", derivacion: {tipo: "interna"},
  }}, professional.uid);
  assert.deepEqual((await orders.doc(orderId).get()).get("borrador.derivacion"), {tipo: "interna", profesionalUid: ""});
  await assert.rejects(handle("cerrar", {atencionId: orderId, atencion: clinical}), {code: "permission-denied"});
  const refer = (derivacion) => handle("cerrar", {
    atencionId: orderId, atencion: {...clinical, resultadoClinico: "derivacion", derivacion},
  }, professional.uid);
  await assert.rejects(refer(undefined), {code: "invalid-argument"});
  for (const {uid} of [owner, professional, technician, outsider]) {
    await assert.rejects(refer({tipo: "interna", profesionalUid: uid}), {code: "failed-precondition"});
  }
  await vetProfileRef.update({estado: "inactivo"});
  await assert.rejects(refer({tipo: "interna", profesionalUid: veterinarian.uid}), {code: "failed-precondition"});
  await vetProfileRef.set(vetProfile);
  assert.equal((await orders.doc(orderId).get()).get("estado"), "en_atencion");
  assert.equal((await refer({tipo: "interna", profesionalUid: veterinarian.uid, profesionalNombre: "Nombre manipulado"})).atencionId, orderId);
  const closed = (await orders.doc(orderId).get()).data();
  assert.equal(closed.estado, "finalizada");
  assert.deepEqual(closed.derivacion, {tipo: "interna", profesionalUid: veterinarian.uid, profesionalNombre: "Veterinaria de prueba"});
  assert.equal(closed.control, undefined);
  assert.equal(closed.finalizadoPorUid, professional.uid);
  assert.equal(closed.borrador, undefined);
  assert.deepEqual(closed.recetas, [issued], "el cierre conserva la receta original y su auditoría");
  assert.equal((await appointments.doc(citaId).get()).get("estado"), "finalizada");
  assert.deepEqual(await issue(), recipeResult);
  await assert.rejects(issue({...recipe, recetaId: "receta-posterior"}), {code: "failed-precondition"});

  await handle("asignarOrden", {atencionId: directId, atencion: {...assignment, profesionalUid: veterinarian.uid}});
  await handle("iniciar", {atencionId: directId}, veterinarian.uid);
  const readCatalog = (uid) => listarCatalogoVeterinarioParaAtencionHandler({auth: {uid}, data: {businessId, atencionId: directId}}, dependencies);
  await assert.rejects(readCatalog(otherVeterinarian.uid), {code: "not-found"});
  assert.deepEqual(await readCatalog(veterinarian.uid), {
    items: [{id: "control-ficticio", nombre: "Control ficticio", tipoItem: "servicio", unidad: "unidad", estado: "activo"}],
  });
  await handle("borrador", {atencionId: directId, atencion: {diagnostico: "Borrador directo"}}, veterinarian.uid);
  await assert.rejects(handle("emitirReceta", {atencionId: directId, atencion: recipe}, otherVeterinarian.uid), {code: "permission-denied"});
  await handle("emitirReceta", {atencionId: directId, atencion: recipe}, veterinarian.uid);
  await vetProfileRef.update({modulos: ["inventario"]});
  await assert.rejects(handle("cerrar", {atencionId: directId, atencion: clinical}, veterinarian.uid), {code: "permission-denied"});
  await vetProfileRef.set(vetProfile);
  const closeWithControl = (control) => handle("cerrar", {
    atencionId: directId, atencion: {...clinical, resultadoClinico: "control", control},
  }, veterinarian.uid);
  const controlSlot = {fecha: appointmentData.fecha, hora: "11:15"};
  await handle("borrador", {atencionId: directId, atencion: {
    resultadoClinico: "control", control: {fecha: controlSlot.fecha},
  }}, veterinarian.uid);
  assert.deepEqual((await orders.doc(directId).get()).get("borrador.control"), {fecha: controlSlot.fecha, hora: ""});
  await assert.rejects(closeWithControl(undefined), {code: "invalid-argument"});
  await assert.rejects(closeWithControl({...controlSlot, fecha: "2000-01-01"}), {code: "invalid-argument"});
  const occupiedSlot = {fecha: appointmentData.fecha, hora: "10:15"};
  await assert.rejects(closeWithControl(occupiedSlot), {code: "already-exists"});
  await assert.rejects(closeWithControl(unreservedSlot), {code: "already-exists"});
  const stillOpen = await orders.doc(directId).get();
  assert.equal(stillOpen.get("estado"), "en_atencion");
  assert.equal(stillOpen.get("ventaEstado"), undefined);
  assert.equal((await appointments.get()).size, appointmentCount);

  assert.equal((await closeWithControl(controlSlot)).atencionId, directId);
  const directClosed = (await orders.doc(directId).get()).data();
  assert.equal(directClosed.estado, "finalizada");
  assert.equal(directClosed.diagnostico, clinical.diagnostico);
  assert.equal(directClosed.finalizadoPorUid, veterinarian.uid);
  assert.equal(directClosed.recetas[0].profesionalUid, veterinarian.uid);
  assert.ok(!directClosed.citaId, "cerrar una orden directa no fabrica un id de cita");
  const {citaId: controlCitaId} = directClosed.control;
  assert.ok(controlCitaId && controlCitaId !== citaId);
  assert.deepEqual(directClosed.control, {citaId: controlCitaId, ...controlSlot});
  const controlAppointment = await appointments.doc(controlCitaId).get();
  for (const [field, value] of Object.entries({
    ...controlSlot, negocioId: businessId, pacienteId, tutorClienteId: "tutor-ficticio",
    estado: "agendada", motivo: "Control veterinario", zonaHoraria: "America/Santiago", profesionalUid: veterinarian.uid,
  })) {
    assert.equal(controlAppointment.get(field), value);
  }
  const reserved = await business.collection("cuposVeterinarios").doc(`${controlSlot.fecha}_1115`).get();
  assert.equal(reserved.get("citaId"), controlCitaId);
  const notificationRefs = ["confirmacion", "recordatorio"].map((type) =>
    business.collection("avisosCitasVeterinarias").doc(`${controlCitaId}__${type}`));
  const initialNotices = await db.getAll(...notificationRefs);
  assert.deepEqual(initialNotices.map((notice) => notice.get("tipo")), ["confirmacion", "recordatorio"]);
  assert.ok(initialNotices.every((notice) => notice.get("citaId") === controlCitaId && notice.get("estado") === "pendiente"));
  await closeWithControl({...controlSlot, hora: "11:45"});
  assert.deepEqual((await orders.doc(directId).get()).get("control"), directClosed.control);
  const retriedNotices = await db.getAll(...notificationRefs);
  assert.deepEqual(retriedNotices.map((notice) => notice.get("revision")), initialNotices.map((notice) => notice.get("revision")));

  // Cerrar la primera orden liberó el box para la directa. Cancelar otra orden
  // libera sus reservas, conservando la orden y su vínculo con la cita.
  await receive(cancelCitaId, "normal");
  await create(cancelOrderId, {origen: "cita"}, {citaId: cancelCitaId});
  const cancelAssignment = {...assignment, box: "Box Emergencia"};
  await handle("asignarOrden", {atencionId: cancelOrderId, atencion: cancelAssignment});
  assert.deepEqual(await handle("cancelarOrden", {atencionId: cancelOrderId}), {atencionId: cancelOrderId});
  assert.equal((await orders.doc(cancelOrderId).get()).get("estado"), "cancelada");
  assert.equal((await orders.doc(cancelOrderId).get()).get("citaId"), cancelCitaId);
  assert.equal((await appointments.doc(cancelCitaId).get()).get("estado"), "cancelada");
  assert.equal((await appointments.doc(cancelCitaId).get()).get("atencionId"), cancelOrderId);
  assert.equal((await cancelSlot.get()).exists, false);
  await handle("asignarOrden", {atencionId: emergencyId, atencion: {...cancelAssignment, profesionalUid: otherVeterinarian.uid}});
  await handle("iniciar", {atencionId: emergencyId}, otherVeterinarian.uid);
  await assert.rejects(handle("cerrar", {atencionId: emergencyId, atencion: clinical}, veterinarian.uid), {code: "permission-denied"});
  await handle("cerrar", {atencionId: emergencyId, atencion: {
    ...clinical, resultadoClinico: "derivacion", derivacion: {tipo: "externa", profesionalUid: outsider.uid},
  }}, otherVeterinarian.uid);
  const externalOrder = await orders.doc(emergencyId).get();
  assert.equal(externalOrder.get("estado"), "finalizada");
  assert.deepEqual(externalOrder.get("derivacion"), {tipo: "externa"});
  assert.equal(externalOrder.get("control"), undefined);

  await receive(legacyCitaId, "normal");
  assert.deepEqual(await handle("iniciar", {citaId: legacyCitaId}), {atencionId: legacyCitaId});
  assert.deepEqual(await handle("cerrar", {citaId: legacyCitaId, atencion: clinical}), {atencionId: legacyCitaId});
  assert.equal((await orders.doc(legacyCitaId).get()).get("estado"), "finalizada");
  assert.equal((await appointments.get()).size, appointmentCount + 1, "solo el control agrega una cita");

  const concurrentOrderId = "orden-control-concurrente";
  const manualCitaId = "cita-manual-concurrente";
  const concurrentSlot = {fecha: appointmentData.fecha, hora: "12:15"};
  await create(concurrentOrderId, directData);
  await handle("asignarOrden", {atencionId: concurrentOrderId, atencion: {
    ...assignment, box: "Box concurrente", profesionalUid: veterinarian.uid,
  }});
  await handle("iniciar", {atencionId: concurrentOrderId}, veterinarian.uid);
  const [closeResult, manualResult] = await Promise.allSettled([
    handle("cerrar", {atencionId: concurrentOrderId, atencion: {
      ...clinical, resultadoClinico: "control", control: concurrentSlot,
    }}, veterinarian.uid),
    guardarCitaVeterinariaHandler({auth: {uid: owner.uid}, data: {
      businessId, citaId: manualCitaId, operacion: "crear", cita: {...appointmentData, ...concurrentSlot},
    }}, dependencies),
  ]);
  assert.notEqual(closeResult.status, manualResult.status, "solo una operación obtiene el cupo concurrente");
  const rejected = closeResult.status === "rejected" ? closeResult : manualResult;
  assert.equal(rejected.reason.code, "already-exists", rejected.reason.message);
  const concurrentOrder = await orders.doc(concurrentOrderId).get();
  assert.equal(concurrentOrder.get("estado"), closeResult.status === "fulfilled" ? "finalizada" : "en_atencion");
  if (closeResult.status === "rejected") assert.equal(concurrentOrder.get("ventaEstado"), undefined);
  const bookings = await appointments.where("fecha", "==", concurrentSlot.fecha).where("hora", "==", concurrentSlot.hora).get();
  assert.equal(bookings.size, 1);
  assert.equal(bookings.docs[0].id, closeResult.status === "fulfilled" ? concurrentOrder.get("control.citaId") : manualCitaId);

  const clientOrder = doc(clientDb, "negocios", businessId, "atencionesVeterinarias", orderId);
  assert.equal((await getDoc(clientOrder)).get("estado"), "finalizada");
  await assert.rejects(setDoc(clientOrder, {recetas: []}, {merge: true}), {code: "permission-denied"});
  console.log("VETERINARY_ORDER_PERSISTENCE_SMOKE_OK");
} finally {
  await deleteApp(app);
  await deleteApp(assignedApp);
  await adminApp.delete();
}
