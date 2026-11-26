import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, query, terminate, updateDoc, where} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";

// Anular un comentario de la documentación de una tarea (callable anularDocumentacionTareaTrabajo), contra
// Auth + Firestore + Functions reales de los emuladores (nunca Firebase real). Mismo arnés que
// work-task-delete-race-integrated-local.mjs. Cubre, con consultas y reglas reales de Firestore (el FakeDb de
// works-model-smoke no las ejecuta):
//  1. Permisos: solo OWNER/ADMIN (los mismos roles que anular un gasto). TECNICO (aun siendo el autor y el
//     responsable), FINANZAS, otro negocio y sin sesión quedan fuera. Además exige el módulo "trabajos" igual que
//     documentarTareaTrabajo: un ADMIN cuyo perfil no lo incluye queda fuera y uno cuyo perfil sí lo incluye anula.
//     Un MEMBER con perfil sin "trabajos" también queda fuera, pero por su rol (MEMBER nunca anula): con el patrón
//     del producto (el perfil solo se asigna a MEMBER) el módulo no se puede aislar en un MEMBER; por eso el ADMIN
//     con perfil se siembra directo (no es una membresía que el producto pueda crear hoy).
//     Aislamiento entre negocios con un trabajo REAL del otro negocio: un usuario con membresía ADMIN/OWNER en dos
//     negocios que envía el businessId de uno y el trabajoId (con su tarea y comentario reales) del otro es
//     rechazado en ambos sentidos y ninguno de los dos comentarios cambia.
//  2. Motivo obligatorio (vacío, solo espacios, ausente) e identificadores inválidos o inexistentes.
//  3. El comentario NO se borra: queda anulado con quién, cuándo y por qué; el texto y la autoría siguen; la
//     cantidad de comentarios y `documentacionTotal` no cambian; ningún costo cambia (gasto, horas y totales del
//     proyecto idénticos); la tarea con documentación (también anulada) sigue sin poder eliminarse.
//  4. requestId repetido: mismo resultado y un solo evento; con otro motivo u otro usuario, rechazo.
//  5. Doble anulación con otro requestId: rechazo claro (failed-precondition) y el motivo original se conserva.
//  6. Reglas: el cliente puede leer el comentario anulado pero no modificarlo (sin cambios en firestore.rules).
//  7. Proyecto cancelado: se rechaza igual que documentar o modificar tareas.
//  8. Carrera: dos anulaciones simultáneas del mismo comentario con requestId distintos. INVARIANTE (falla de
//     inmediato): un solo evento y el comentario queda anulado por una de las dos. LIMPIO: una gana y la otra recibe
//     failed-precondition. Si el emulador devuelve otro error al perdedor ("Transaction is invalid or closed",
//     hallazgo ya documentado en work-task-delete-race-integrated-local.mjs) se imprime como ADVERTENCIA y no falla,
//     salvo con WORK_TASK_DOCUMENT_ANNUL_STRICT=1.
// Puertos: NO hay puertos por defecto, para que una configuración incompleta nunca llegue a otro emulador que
// esté abierto en los puertos de siempre. Firestore y Auth salen de las variables que fija `firebase
// emulators:exec` (FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST); `emulators:exec` no exporta la de
// Functions, así que su host y puerto se piden al hub de ese mismo emulador (FIREBASE_EMULATOR_HUB). Si falta
// cualquiera de las tres cosas, el script se detiene antes de crear ningún cliente o hacer ninguna llamada.
// WORK_TASK_DOCUMENT_ANNUL_ROUNDS=n cambia las rondas de la carrera (4 por defecto).

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const RACE_ROUNDS = Math.max(1, Number(process.env.WORK_TASK_DOCUMENT_ANNUL_ROUNDS || 4));
const requiredEnv = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Falta ${name}: ejecuta este script con "firebase emulators:exec" (no usa puertos por defecto).`);
  return value;
};
const splitHost = (value, label) => {
  const [host, port] = String(value).replace(/^https?:\/\//, "").split(":");
  if (!host || !Number.isInteger(Number(port)) || Number(port) <= 0) throw new Error(`${label} inválido: «${value}».`);
  return {host, port: Number(port)};
};
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
const FIRESTORE = splitHost(requiredEnv("FIRESTORE_EMULATOR_HOST"), "FIRESTORE_EMULATOR_HOST");
const AUTH = splitHost(requiredEnv("FIREBASE_AUTH_EMULATOR_HOST"), "FIREBASE_AUTH_EMULATOR_HOST");
const hubInfo = await (await fetch(`http://${requiredEnv("FIREBASE_EMULATOR_HUB")}/emulators`)).json();
if (!hubInfo?.functions?.port) throw new Error("El hub del emulador no informa un emulador de Functions: usa --only auth,firestore,functions.");
const FUNCTIONS = splitHost(`${hubInfo.functions.host}:${hubInfo.functions.port}`, "Functions del hub");
console.log(`Emuladores de esta corrida: firestore ${FIRESTORE.host}:${FIRESTORE.port}, auth ${AUTH.host}:${AUTH.port}, functions ${FUNCTIONS.host}:${FUNCTIONS.port}`);
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function createClientApp(name) {
  const app = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: `wkannul-${name}-${RUN_ID}`}, `wkannul-${name}-${RUN_ID}`);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, `http://${AUTH.host}:${AUTH.port}`, {disableWarnings: true});
  connectFirestoreEmulator(db, FIRESTORE.host, FIRESTORE.port); connectFunctionsEmulator(functions, FUNCTIONS.host, FUNCTIONS.port);
  return {app, auth, db, functions};
}
async function authenticate(client, label) {
  const credential = await createUserWithEmailAndPassword(client.auth, `wkannul-${label}-${RUN_ID}@example.test`, `WkAnnul-${RUN_ID}-Pass!`);
  client.uid = credential.user.uid;
  return client;
}
const callable = (client, name) => httpsCallable(client.functions, name);
let sequence = 0;
const requestId = (label) => `wkannul-${RUN_ID}-${label}-${++sequence}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
async function expectCallableError(label, operation, expectedCodes, expectedMessage = "") {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    assert.ok(expectedCodes.some((expected) => code.includes(expected)), `${label}: código inesperado ${code} (${error?.message})`);
    if (expectedMessage) assert.ok(String(error?.message || "").includes(expectedMessage), `${label}: mensaje inesperado «${error?.message}»`);
    console.log(`OK rechazo: ${label}`);
    return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}
const rejectionCode = (result) => (result.status === "rejected" ? String(result.reason?.code || "") : "");

const owner = await authenticate(createClientApp("owner"), "owner");
const admin = await authenticate(createClientApp("admin"), "admin");
const technician = await authenticate(createClientApp("technician"), "technician");
const finance = await authenticate(createClientApp("finance"), "finance");
const outsider = await authenticate(createClientApp("outsider"), "outsider");
const dual = await authenticate(createClientApp("dual"), "dual");
const memberNoModule = await authenticate(createClientApp("member-no-module"), "member-no-module");
const adminNoModule = await authenticate(createClientApp("admin-no-module"), "admin-no-module");
const adminWithModule = await authenticate(createClientApp("admin-with-module"), "admin-with-module");
const unauthenticated = createClientApp("unauthenticated");
const clients = [owner, admin, technician, finance, outsider, dual, memberNoModule, adminNoModule, adminWithModule];

const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `wkannul-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

try {
  const main = await callable(owner, "createFirstBusiness")({nombreComercial: "Negocio anular comentarios", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-main")});
  const other = await callable(outsider, "createFirstBusiness")({nombreComercial: "Negocio externo anular comentarios", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-other")});
  const dualBusiness = await callable(dual, "createFirstBusiness")({nombreComercial: "Negocio doble anular comentarios", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-dual")});
  const businessId = main.data.business.id;
  const otherBusinessId = other.data.business.id;
  const dualBusinessId = dualBusiness.data.business.id;
  await Promise.all([
    adminDb.doc(`negocios/${dualBusinessId}`).set({
      identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.800.800-8",
      verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.800.800-8"},
    }, {merge: true}),
    // El usuario "dual" es OWNER de su negocio (arriba) y ADMIN del negocio principal.
    adminDb.doc(`membresias/${businessId}__${dual.uid}`).set({negocioId: businessId, uid: dual.uid, rol: "ADMIN", estado: "activo"}),
    // Perfiles de empleado: uno sin el módulo "trabajos" y otro con él.
    adminDb.doc(`negocios/${businessId}/perfilesEmpleados/perfil-sin-trabajos`).set({negocioId: businessId, estado: "activo", nombre: "Solo clientes", modulos: ["clientes"]}),
    adminDb.doc(`negocios/${businessId}/perfilesEmpleados/perfil-con-trabajos`).set({negocioId: businessId, estado: "activo", nombre: "Trabajos", modulos: ["trabajos"]}),
    adminDb.doc(`membresias/${businessId}__${memberNoModule.uid}`).set({negocioId: businessId, uid: memberNoModule.uid, rol: "MEMBER", estado: "activo", profileId: "perfil-sin-trabajos"}),
    adminDb.doc(`membresias/${businessId}__${adminNoModule.uid}`).set({negocioId: businessId, uid: adminNoModule.uid, rol: "ADMIN", estado: "activo", profileId: "perfil-sin-trabajos"}),
    adminDb.doc(`membresias/${businessId}__${adminWithModule.uid}`).set({negocioId: businessId, uid: adminWithModule.uid, rol: "ADMIN", estado: "activo", profileId: "perfil-con-trabajos"}),
  ]);
  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).set({
      identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.600.600-6",
      verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.600.600-6"},
    }, {merge: true}),
    adminDb.doc(`negocios/${otherBusinessId}`).set({
      identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.700.700-7",
      verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.700.700-7"},
    }, {merge: true}),
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({negocioId: businessId, uid: admin.uid, rol: "ADMIN", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${technician.uid}`).set({negocioId: businessId, uid: technician.uid, rol: "TECNICO", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${finance.uid}`).set({negocioId: businessId, uid: finance.uid, rol: "FINANZAS", estado: "activo"}),
  ]);

  const createWork = async (title) => (await callable(owner, "crearTrabajo")({
    businessId, requestId: requestId("work"),
    trabajo: {titulo: title, descripcion: "Proyecto de la prueba integrada", clienteId: "", responsableUid: technician.uid, participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""},
  })).data.trabajoId;
  const workId = await createWork("Anular comentarios");
  const workPath = `negocios/${businessId}/trabajos/${workId}`;
  const today = new Date().toISOString().slice(0, 10);

  const createTask = async (title, targetWorkId = workId) => (await callable(owner, "agregarTareaTrabajo")({businessId, trabajoId: targetWorkId, requestId: requestId("task"), tarea: {titulo: title, descripcion: "", responsableUid: technician.uid}})).data.tareaId;
  const document = async (client, taskId, texto, targetWorkId = workId) => (await callable(client, "documentarTareaTrabajo")({businessId, trabajoId: targetWorkId, tareaId: taskId, texto, requestId: requestId("document")})).data.documentacionId;
  const annul = (client, taskId, documentationId, patch = {}) => callable(client, "anularDocumentacionTareaTrabajo")({businessId, trabajoId: workId, tareaId: taskId, documentacionId: documentationId, motivo: "Foto equivocada", requestId: requestId("annul"), ...patch});
  const docRef = (taskId, documentationId, targetWorkId = workId) => adminDb.doc(`negocios/${businessId}/trabajos/${targetWorkId}/tareas/${taskId}/documentacion/${documentationId}`);
  const docData = async (taskId, documentationId) => (await docRef(taskId, documentationId).get()).data();
  const annulEvents = async (documentationId, targetWorkId = workId) => (await adminDb.collection(`negocios/${businessId}/trabajos/${targetWorkId}/historial`).where("tipo", "==", "tarea_documentacion_anulada").get()).docs.filter((entry) => entry.data().detalle?.documentacionId === documentationId);
  const documentationCount = async (taskId) => (await adminDb.collection(`${workPath}/tareas/${taskId}/documentacion`).get()).size;
  const costSnapshot = async () => {
    const work = (await adminDb.doc(workPath).get()).data();
    const totals = Object.fromEntries(Object.entries(work).filter(([key]) => /^(gastos|horas|materiales|adicionales|costo)/i.test(key)));
    const read = async (name) => (await adminDb.collection(`${workPath}/${name}`).get()).docs.map((entry) => [entry.id, entry.data()]).sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify({totals, gastos: await read("gastos"), horasHombre: await read("horasHombre"), adicionales: await read("adicionales")});
  };

  // Un gasto y horas con tarea, para comprobar que anular un comentario no mueve ningún costo.
  const taskId = await createTask("Tarea con comentarios");
  await callable(owner, "registrarGastoTrabajo")({businessId, trabajoId: workId, requestId: requestId("gasto"), gasto: {concepto: "Gasto de la prueba", monto: 1000, categoria: "OTRO", responsableDelGastoUid: "", fecha: today, observacion: "", tareaId: taskId}});
  await callable(owner, "registrarHorasHombreTrabajo")({businessId, trabajoId: workId, requestId: requestId("horas"), horasHombre: {tecnicoUid: owner.uid, horas: 1, costoHora: 1000, fecha: today, concepto: "Horas de la prueba", tareaId: taskId}});
  const authored = await document(technician, taskId, "Foto del tramo instalado.");
  const second = await document(owner, taskId, "Segundo comentario que no se anula.");
  const third = await document(owner, taskId, "Tercer comentario para el administrador.");
  assert.equal(await documentationCount(taskId), 3);
  const totalBefore = (await adminDb.doc(`${workPath}/tareas/${taskId}`).get()).data().documentacionTotal;
  assert.equal(totalBefore, 3);
  const costsBefore = await costSnapshot();
  const original = await docData(taskId, authored);
  assert.notEqual(original.estado, "anulado");

  // ---------------------------------------------------------------- 1. Permisos
  await expectCallableError("TECNICO (aun siendo autor y responsable) no anula", () => annul(technician, taskId, authored), ["permission-denied"]);
  await expectCallableError("FINANZAS no anula", () => annul(finance, taskId, authored), ["permission-denied"]);
  await expectCallableError("otro negocio no anula", () => annul(outsider, taskId, authored), ["permission-denied"]);
  await expectCallableError("sin sesión no anula", () => annul(unauthenticated, taskId, authored), ["unauthenticated"]);
  assert.deepEqual(await docData(taskId, authored), original, "ningún rechazo modificó el comentario");
  console.log("OK parte 1: solo OWNER/ADMIN anulan; TECNICO (autor y responsable), FINANZAS, otro negocio y sin sesión quedan fuera");

  // ---------------------------------------------------------------- 1b. Módulo "trabajos" (igual que documentarTareaTrabajo)
  await expectCallableError("MEMBER con perfil sin el módulo trabajos no anula (por su rol)", () => annul(memberNoModule, taskId, authored), ["permission-denied"]);
  await expectCallableError("ADMIN con perfil sin el módulo trabajos no anula", () => annul(adminNoModule, taskId, authored), ["permission-denied"], "Tu perfil no tiene acceso a este módulo.");
  // Documentar exige lo mismo: la anulación queda alineada con ella.
  await expectCallableError("ADMIN con perfil sin el módulo trabajos tampoco documenta (referencia)", () => document(adminNoModule, taskId, "No debe registrarse"), ["permission-denied"], "Tu perfil no tiene acceso a este módulo.");
  assert.deepEqual(await docData(taskId, authored), original, "ningún rechazo modificó el comentario");
  assert.equal((await annulEvents(authored)).length, 0);
  const profileTask = await createTask("Tarea del perfil con trabajos");
  const profileComment = await document(owner, profileTask, "Comentario que anula el ADMIN con módulo trabajos.");
  const byProfiledAdmin = await annul(adminWithModule, profileTask, profileComment, {motivo: "Perfil con módulo trabajos"});
  assert.equal(byProfiledAdmin.data.idempotent, false);
  assert.equal((await docData(profileTask, profileComment)).anuladoPorUid, adminWithModule.uid, "un ADMIN con perfil que incluye trabajos sí anula");
  console.log("OK parte 1b: exige el módulo trabajos (ADMIN con perfil sin él, rechazado; con él, anula); MEMBER con perfil sin él queda fuera por su rol");

  // ---------------------------------------------------------------- 1c. Trabajo real de otro negocio
  // El usuario "dual" es ADMIN del negocio principal y OWNER del suyo; cada negocio tiene un trabajo, una tarea y un comentario reales.
  const dualWork = (await callable(dual, "crearTrabajo")({
    businessId: dualBusinessId, requestId: requestId("work-dual"),
    trabajo: {titulo: "Trabajo del otro negocio", descripcion: "", clienteId: "", responsableUid: dual.uid, participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""},
  })).data.trabajoId;
  const dualTask = (await callable(dual, "agregarTareaTrabajo")({businessId: dualBusinessId, trabajoId: dualWork, requestId: requestId("task-dual"), tarea: {titulo: "Tarea del otro negocio", descripcion: "", responsableUid: dual.uid}})).data.tareaId;
  const dualComment = (await callable(dual, "documentarTareaTrabajo")({businessId: dualBusinessId, trabajoId: dualWork, tareaId: dualTask, texto: "Comentario real del otro negocio.", requestId: requestId("document-dual")})).data.documentacionId;
  const dualCommentRef = adminDb.doc(`negocios/${dualBusinessId}/trabajos/${dualWork}/tareas/${dualTask}/documentacion/${dualComment}`);
  const dualOriginal = (await dualCommentRef.get()).data();
  const dualAnnul = (patch) => callable(dual, "anularDocumentacionTareaTrabajo")({requestId: requestId("annul-dual"), motivo: "Cruce entre negocios", ...patch});
  // businessId del otro negocio con el trabajo (y la tarea y el comentario) reales del principal.
  await expectCallableError("businessId del otro negocio con el trabajo real del principal", () => dualAnnul({businessId: dualBusinessId, trabajoId: workId, tareaId: taskId, documentacionId: authored}), ["not-found"], "No se encontró el trabajo.");
  // businessId del principal con el trabajo real del otro negocio.
  await expectCallableError("businessId del principal con el trabajo real del otro negocio", () => dualAnnul({businessId, trabajoId: dualWork, tareaId: dualTask, documentacionId: dualComment}), ["not-found"], "No se encontró el trabajo.");
  // Mezcla: trabajo y negocio correctos, pero la tarea y el comentario son del otro negocio.
  await expectCallableError("trabajo del principal con tarea y comentario del otro negocio", () => dualAnnul({businessId, trabajoId: workId, tareaId: dualTask, documentacionId: dualComment}), ["not-found"], "No se encontró la tarea.");
  await expectCallableError("trabajo y tarea del principal con el comentario del otro negocio", () => dualAnnul({businessId, trabajoId: workId, tareaId: taskId, documentacionId: dualComment}), ["not-found"], "No se encontró el comentario.");
  assert.deepEqual(await docData(taskId, authored), original, "el comentario del negocio principal sigue intacto");
  assert.deepEqual((await dualCommentRef.get()).data(), dualOriginal, "el comentario del otro negocio sigue intacto");
  assert.equal((await annulEvents(authored)).length, 0);
  assert.equal((await adminDb.collection(`negocios/${dualBusinessId}/trabajos/${dualWork}/historial`).where("tipo", "==", "tarea_documentacion_anulada").get()).size, 0, "ningún cruce dejó eventos en el otro negocio");
  // Control: el mismo usuario sí anula el comentario de su propio negocio con la combinación correcta (no era un rechazo por permisos).
  const ownBusinessAnnul = await dualAnnul({businessId: dualBusinessId, trabajoId: dualWork, tareaId: dualTask, documentacionId: dualComment});
  assert.equal(ownBusinessAnnul.data.idempotent, false);
  assert.equal((await dualCommentRef.get()).data().estado, "anulado");
  assert.deepEqual(await docData(taskId, authored), original, "anular en el otro negocio no tocó el comentario del principal");
  console.log("OK parte 1c: un usuario con membresía en dos negocios no puede anular con el businessId de uno y el trabajo real del otro (en ambos sentidos); ningún comentario cambió");

  // ---------------------------------------------------------------- 2. Validación
  for (const [label, motivo] of [["motivo vacío", ""], ["motivo de solo espacios", "   \n  "], ["sin motivo", undefined]]) {
    await expectCallableError(label, () => annul(owner, taskId, authored, {motivo}), ["invalid-argument"], "El motivo de anulación");
  }
  await expectCallableError("motivo de más de 1000 caracteres", () => annul(owner, taskId, authored, {motivo: "x".repeat(1001)}), ["invalid-argument"]);
  await expectCallableError("sin requestId", () => annul(owner, taskId, authored, {requestId: undefined}), ["invalid-argument"]);
  await expectCallableError("identificador de comentario inválido", () => annul(owner, taskId, "../otro"), ["invalid-argument"]);
  await expectCallableError("comentario inexistente", () => annul(owner, taskId, "no-existe"), ["not-found"], "No se encontró el comentario.");
  await expectCallableError("tarea inexistente", () => annul(owner, "tarea-inexistente", authored), ["not-found"], "No se encontró la tarea.");
  const otherTask = await createTask("Otra tarea del mismo proyecto");
  await expectCallableError("comentario de otra tarea", () => annul(owner, otherTask, authored), ["not-found"], "No se encontró el comentario.");
  await expectCallableError("proyecto inexistente", () => callable(owner, "anularDocumentacionTareaTrabajo")({businessId, trabajoId: "trabajo-inexistente", tareaId: taskId, documentacionId: authored, motivo: "Prueba", requestId: requestId("annul")}), ["not-found"]);
  assert.deepEqual(await docData(taskId, authored), original);
  assert.equal((await annulEvents(authored)).length, 0);
  console.log("OK parte 2: motivo obligatorio (vacío, solo espacios, ausente), identificadores inválidos o inexistentes y comentario de otra tarea");

  // ---------------------------------------------------------------- 3. Anular: no borra y no toca costos
  const annulRequest = requestId("annul-main");
  const reason = "Foto equivocada: era de otro tramo.";
  const annulled = await annul(owner, taskId, authored, {motivo: reason, requestId: annulRequest});
  assert.equal(annulled.data.idempotent, false); assert.equal(annulled.data.documentacionId, authored); assert.equal(annulled.data.tareaId, taskId);
  const after = await docData(taskId, authored);
  assert.ok(after, "el comentario no se borra");
  assert.equal(after.estado, "anulado"); assert.equal(after.motivoAnulacion, reason); assert.equal(after.anuladoPorUid, owner.uid);
  assert.ok(after.anuladoEn, "queda cuándo"); assert.ok(after.anuladoPorSnapshot?.nombre, "queda quién (nombre)");
  for (const field of ["texto", "autorUid", "tipo", "tareaId", "trabajoId", "negocioId"]) assert.equal(after[field], original[field], `${field} no cambia`);
  assert.deepEqual(after.creadoEn, original.creadoEn, "creadoEn no cambia");
  assert.equal(await documentationCount(taskId), 3, "los tres comentarios siguen registrados");
  assert.equal((await adminDb.doc(`${workPath}/tareas/${taskId}`).get()).data().documentacionTotal, totalBefore, "documentacionTotal no baja");
  assert.equal(await costSnapshot(), costsBefore, "anular un comentario no cambia ningún costo: gasto, horas ni totales del proyecto");
  const events = await annulEvents(authored);
  assert.equal(events.length, 1); assert.equal(events[0].data().detalle.motivo, reason); assert.equal(events[0].data().actorUid, owner.uid);
  // La tarea con documentación (también anulada) sigue sin poder eliminarse.
  const blocked = await callable(owner, "eliminarTareaTrabajo")({businessId, trabajoId: workId, tareaId: taskId, requestId: requestId("delete")}).then(() => null, (error) => error);
  assert.ok(blocked && String(blocked.code).includes("failed-precondition") && blocked.message.includes("documentación"), "la tarea con comentarios (anulados o no) no se elimina");
  console.log("OK parte 3: el comentario sigue existiendo, anulado con quién, cuándo y por qué; no cambia costos, contador ni autoría");

  // ---------------------------------------------------------------- 4. requestId repetido
  const retry = await annul(owner, taskId, authored, {motivo: reason, requestId: annulRequest});
  assert.equal(retry.data.idempotent, true); assert.equal(retry.data.documentacionId, authored);
  assert.equal((await annulEvents(authored)).length, 1, "el reintento no duplica el evento");
  assert.deepEqual(await docData(taskId, authored), after, "el reintento no reescribe el comentario");
  await expectCallableError("mismo requestId con otro motivo", () => annul(owner, taskId, authored, {motivo: "Otro motivo", requestId: annulRequest}), ["already-exists"]);
  await expectCallableError("mismo requestId desde otro usuario", () => annul(admin, taskId, authored, {motivo: reason, requestId: annulRequest}), ["already-exists"]);
  console.log("OK parte 4: requestId repetido devuelve el resultado guardado sin duplicar; con otro motivo u otro usuario se rechaza");

  // ---------------------------------------------------------------- 5. Doble anulación
  await expectCallableError("doble anulación (otro requestId, otro usuario)", () => annul(admin, taskId, authored, {motivo: "Segunda vez"}), ["failed-precondition"], "El comentario ya está anulado.");
  await expectCallableError("doble anulación (otro requestId, mismo usuario)", () => annul(owner, taskId, authored, {motivo: reason}), ["failed-precondition"], "El comentario ya está anulado.");
  const unchanged = await docData(taskId, authored);
  assert.equal(unchanged.motivoAnulacion, reason, "el motivo original se conserva"); assert.equal(unchanged.anuladoPorUid, owner.uid);
  assert.equal((await annulEvents(authored)).length, 1);
  // ADMIN sí puede anular (mismos permisos que anular un gasto).
  const byAdmin = await annul(admin, taskId, third, {motivo: "Duplicado del anterior."});
  assert.equal(byAdmin.data.idempotent, false);
  assert.equal((await docData(taskId, third)).anuladoPorUid, admin.uid);
  assert.equal((await docData(taskId, second)).estado, undefined, "los demás comentarios siguen vigentes");
  assert.equal(await costSnapshot(), costsBefore);
  console.log("OK parte 5: la doble anulación se rechaza con un mensaje claro y conserva el motivo original; ADMIN también anula");

  // ---------------------------------------------------------------- 6. Reglas de Firestore (sin cambios)
  const clientDoc = doc(owner.db, `negocios/${businessId}/trabajos/${workId}/tareas/${taskId}/documentacion/${authored}`);
  const readBack = (await getDoc(clientDoc)).data();
  assert.equal(readBack.estado, "anulado"); assert.equal(readBack.motivoAnulacion, reason);
  // La misma consulta que hace workService (con los tres filtros que exigen las reglas).
  const listed = await getDocs(query(collection(owner.db, `negocios/${businessId}/trabajos/${workId}/tareas/${taskId}/documentacion`), where("negocioId", "==", businessId), where("trabajoId", "==", workId), where("tareaId", "==", taskId)));
  assert.equal(listed.size, 3, "el panel sigue leyendo los comentarios anulados con las reglas actuales");
  await expectCallableError("el cliente no puede reabrir un comentario anulado", () => updateDoc(clientDoc, {estado: "vigente"}), ["permission-denied"]);
  assert.equal((await docData(taskId, authored)).estado, "anulado");
  console.log("OK parte 6: las reglas actuales bastan: el cliente lee el comentario anulado y no puede modificarlo");

  // ---------------------------------------------------------------- 7. Proyecto cancelado
  const closedWorkId = await createWork("Proyecto que se cancela");
  const closedTask = await createTask("Tarea del proyecto cancelado", closedWorkId);
  const closedDoc = await document(owner, closedTask, "Comentario previo al cierre.", closedWorkId);
  await callable(owner, "cambiarEstadoTrabajo")({businessId, trabajoId: closedWorkId, estado: "cancelado", motivoEspera: ""});
  await expectCallableError("proyecto cancelado", () => callable(owner, "anularDocumentacionTareaTrabajo")({businessId, trabajoId: closedWorkId, tareaId: closedTask, documentacionId: closedDoc, motivo: "No debe anularse", requestId: requestId("annul")}), ["failed-precondition"], "Reabre el trabajo antes de modificar sus tareas.");
  assert.equal((await docRef(closedTask, closedDoc, closedWorkId).get()).data().estado, undefined, "el comentario del proyecto cancelado sigue vigente");
  console.log("OK parte 7: un proyecto cancelado rechaza la anulación igual que documentar o modificar tareas");

  // ---------------------------------------------------------------- 8. Carrera: dos anulaciones simultáneas
  const tally = {unaGana: 0, anomalias: 0};
  const anomalies = [];
  for (let round = 1; round <= RACE_ROUNDS; round += 1) {
    const raceDoc = await document(owner, otherTask, `Comentario de la carrera #${round}`);
    const [first, secondResult] = await Promise.allSettled([
      annul(owner, otherTask, raceDoc, {motivo: `Primera #${round}`}),
      annul(admin, otherTask, raceDoc, {motivo: `Segunda #${round}`}),
    ]);
    const stored = await docData(otherTask, raceDoc);
    const eventCount = (await annulEvents(raceDoc)).length;
    const detail = `ronda ${round} (primera ${first.status}${rejectionCode(first) ? ` ${rejectionCode(first)}` : ""}; segunda ${secondResult.status}${rejectionCode(secondResult) ? ` ${rejectionCode(secondResult)}` : ""}; comentario ${stored?.estado}; eventos ${eventCount})`;
    assert.equal(stored?.estado, "anulado", `INVARIANTE ROTO: el comentario quedó sin anular — ${detail}`);
    assert.equal(eventCount, 1, `INVARIANTE ROTO: se registró más de un evento de anulación — ${detail}`);
    assert.ok([`Primera #${round}`, `Segunda #${round}`].includes(stored.motivoAnulacion), `INVARIANTE ROTO: motivo inesperado — ${detail}`);
    const results = [first, secondResult];
    const clean = results.filter((entry) => entry.status === "fulfilled").length === 1 && results.filter((entry) => entry.status === "rejected" && rejectionCode(entry).includes("failed-precondition")).length === 1;
    if (clean) tally.unaGana += 1;
    else { tally.anomalias += 1; anomalies.push(detail); console.log(`ANOMALÍA (comentario anulado una sola vez): ${detail}`); }
  }
  console.log(`OK parte 8: ${RACE_ROUNDS} rondas con un solo evento y el comentario anulado (una gana ${tally.unaGana}, anomalías ${tally.anomalias})`);
  if (anomalies.length) {
    const message = `${anomalies.length} de ${RACE_ROUNDS} ronda(s) terminaron sin un rechazo limpio para la segunda anulación, aunque el invariante sí se cumplió:\n  ${anomalies.join("\n  ")}`;
    if (process.env.WORK_TASK_DOCUMENT_ANNUL_STRICT === "1") assert.fail(message);
    console.warn(`ADVERTENCIA: ${message}\n  (Con WORK_TASK_DOCUMENT_ANNUL_STRICT=1 esto hace fallar el script.)`);
  }

  // ----------------------------------------------------------- Invariantes finales
  assert.equal(await costSnapshot(), costsBefore, "ningún costo cambió en toda la prueba");
  const remaining = await adminDb.collection(`${workPath}/tareas/${taskId}/documentacion`).get();
  assert.equal(remaining.size, 3, "ningún comentario se borró");
  console.log("WORK_TASK_DOCUMENT_ANNUL_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await terminate(unauthenticated.db);
  await deleteApp(unauthenticated.app);
  await deleteAdminApp(adminApp);
}
