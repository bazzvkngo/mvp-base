import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {connectFirestoreEmulator, doc, getDoc, getFirestore} from "firebase/firestore";

// Seguimiento público del Taller con emuladores (Auth y Firestore): enlace solo con ingreso aprobado,
// vista pública sin datos internos, consulta con patente + RUT en toda la plataforma (titular o quien entregó), límite de intentos,
// enlace inactivo al cerrar la OT y colecciones internas cerradas al SDK cliente.
// Ejecutar: npx firebase emulators:exec --project demo-valora-taller --only auth,firestore "node scripts/work-order-tracking-smoke.mjs"
const {GCLOUD_PROJECT: projectId, FIREBASE_AUTH_EMULATOR_HOST: authHost, FIRESTORE_EMULATOR_HOST: firestoreHost} = process.env;
if (!projectId?.startsWith("demo-") || ![authHost, firestoreHost].every((host) => /^127\.0\.0\.1:\d+$/.test(host || ""))) {
  throw new Error("Ejecuta el smoke en emuladores locales (auth, firestore) con un proyecto demo.");
}
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {requireOperationalBusinessAccess} = require("../functions/businessOnboarding");
const {hashToken, plateIndexId} = require("../functions/workOrderTrackingRules");
const {
  buscarSeguimientoTallerHandler, consultarSeguimientoTallerHandler, seguimientoOTHandler,
} = require("../functions/workOrderTracking");

admin.initializeApp({projectId});
const app = initializeApp({projectId, apiKey: "demo-key"});
const clientAuth = getAuth(app);
connectAuthEmulator(clientAuth, `http://${authHost}`, {disableWarnings: true});
const clientDb = getFirestore(app);
connectFirestoreEmulator(clientDb, "127.0.0.1", Number(firestoreHost.split(":")[1]));

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const deps = {db, HttpsError, FieldValue, auth: admin.auth(), requireBusinessAccess: requireOperationalBusinessAccess};
const publicDeps = {db, HttpsError, FieldValue};

try {
  const {user} = await signInAnonymously(clientAuth);
  const ownerUid = user.uid;
  const run = Date.now();
  const businessId = `taller-seguimiento-${run}`;
  const otherBusinessId = `taller-seguimiento-ajeno-${run}`;
  const users = {technician: `tecnico-seg-${run}`, outsider: `externo-seg-${run}`};
  await Promise.all(Object.values(users).map((uid) =>
    deps.auth.createUser({uid, email: `${uid}@example.test`}).catch((error) => {
      if (error.code !== "auth/uid-already-exists") throw error;
    })));
  const business = {estado: "activo", paisCodigo: "CL", contratoJurisdiccionalVersion: 1, nombreComercial: "Taller Bagner",
    verificacionEmpresa: {estado: "VERIFICADA"}, modulosHabilitados: ["taller"]};
  const membership = (uid, negocioId, rol) => db.doc(`membresias/${negocioId}__${uid}`).set({uid, negocioId, estado: "activo", rol});
  const base = `negocios/${businessId}`;
  const otId = "ot-seguimiento";
  const orderRef = db.doc(`${base}/ordenesTrabajo/${otId}`);
  const plate = `PR${String(run).slice(-4)}`;
  await Promise.all([
    db.doc(base).set(business), db.doc(`negocios/${otherBusinessId}`).set(business),
    db.doc(`${base}/empresa/perfil`).set({nombreComercial: "Taller Bagner", telefono: "+56 9 1111 2222"}),
    membership(ownerUid, businessId, "OWNER"), membership(users.technician, businessId, "TECNICO"),
    membership(users.outsider, otherBusinessId, "OWNER"),
    db.doc(`${base}/clientes/cliente-1`).set({negocioId: businessId, nombre: "Pedro Soto",
      identificadorFiscalValor: "12.345.678-5", identificadorFiscalNormalizado: "123456785"}),
    db.doc(`${base}/vehiculos/vehiculo-1`).set({vehiculoId: "vehiculo-1", negocioId: businessId, marca: "Ssangyong",
      modelo: "Actyon", patente: plate, clienteId: "cliente-1"}),
    db.doc(`${base}/vehiclePlateKeys/${plate}`).set({negocioId: businessId, vehiculoId: "vehiculo-1", patente: plate}),
    db.doc(`${base}/inventario/servicio-frenos`).set({negocioId: businessId, tipoItem: "servicio", estado: "activo", nombre: "Cambio de pastillas"}),
    orderRef.set({otId, negocioId: businessId, numeroOT: "OT-000001", vehiculoId: "vehiculo-1", clienteId: "cliente-1",
      estado: "en_diagnostico", estadoAprobacion: "pendiente", recepcion: {motivoCliente: "Ruido", ingresaNombre: "Marta Rojas"},
      responsableNombre: "Técnico Uno", plazaId: "plaza-1", creadoEn: FieldValue.serverTimestamp(), actualizadoEn: FieldValue.serverTimestamp()}),
    orderRef.collection("recepcionActa").doc("persona").set({negocioId: businessId, otId, nombre: "Marta Rojas", documento: "11.111.111-1"}),
  ]);
  const staff = (uid, patch = {}) => seguimientoOTHandler({auth: {uid}, data: {businessId, otId, operacion: "enlace", ...patch}}, deps);
  const lookup = (rut, ip = "10.0.0.1", patente = plate) =>
    buscarSeguimientoTallerHandler({rawRequest: {ip}, data: {patente, rut}}, publicDeps);

  // El enlace solo existe con el ingreso aprobado; ajenos no lo obtienen.
  await assert.rejects(staff(ownerUid), {code: "failed-precondition"}, "sin aprobar no hay enlace");
  await assert.rejects(staff(users.outsider), (error) => ["permission-denied", "not-found"].includes(error.code));
  await assert.rejects(staff(ownerUid, {operacion: "otra"}), {code: "invalid-argument"});
  await orderRef.update({estado: "en_cola", estadoAprobacion: "aprobada"});
  await assert.rejects(staff(ownerUid), {code: "failed-precondition"}, "aprobada esperando plaza: aún no hay enlace");
  await orderRef.update({estado: "en_reparacion"});
  const link = await staff(users.technician);
  assert.match(link.url, /\/seguimiento\/[A-Za-z0-9_-]{43}$/);
  assert.match(link.urlConsulta, /\/seguimiento$/, "consulta pública de toda la plataforma");
  assert.ok(!link.url.includes(plate) && !link.url.includes("12345678"), "el enlace no contiene patente ni RUT");
  assert.deepEqual(await staff(ownerUid), link, "el enlace es estable");
  const token = link.url.split("/").pop();
  // Compartir el enlace deja la patente en el índice de la consulta pública (hash, sin la patente en claro).
  const plateIndex = (await db.doc(`tallerSeguimientoPatentes/${plateIndexId(plate)}`).get()).data();
  assert.deepEqual(plateIndex.negocios, [businessId]);
  console.log("OK seguimiento: enlace estable solo con ingreso aprobado y la ejecución iniciada");

  // Vista pública por enlace, sin datos internos.
  await orderRef.collection("servicios").doc("s-1").set({servicioOtId: "s-1", negocioId: businessId, otId, itemId: "servicio-frenos",
    estado: "completado", precioUnitario: 45000});
  await orderRef.collection("servicios").doc("s-2").set({servicioOtId: "s-2", negocioId: businessId, otId, itemId: "no-existe", estado: "en_progreso"});
  await orderRef.collection("hallazgos").doc("h-1").set({hallazgoId: "h-1", negocioId: businessId, otId, descripcion: "Bujes con grietas",
    urgente: true, reportadoPorNombre: "Técnico Uno", foto: {hash: "abc"}});
  const {seguimiento} = await consultarSeguimientoTallerHandler({data: {token}}, publicDeps);
  assert.equal(seguimiento.taller.nombre, "Taller Bagner");
  assert.equal(seguimiento.vehiculo.patente, plate);
  assert.equal(seguimiento.etapa.clave, "reparacion");
  assert.deepEqual(seguimiento.trabajos.map((work) => work.estado).sort(), ["en_curso", "terminado"]);
  assert.ok(seguimiento.trabajos.some((work) => work.nombre === "Cambio de pastillas"));
  assert.deepEqual(seguimiento.hallazgos, [{descripcion: "Bujes con grietas", urgente: true}]);
  const serialized = JSON.stringify(seguimiento);
  for (const leak of ["45000", "Técnico Uno", "plaza-1", "Pedro", "Marta", "12.345.678-5", "11.111.111-1", "cliente-1", "abc"]) {
    assert.ok(!serialized.includes(leak), `la vista pública no debe incluir «${leak}»`);
  }
  for (const bad of ["", "x".repeat(43), "corto", `${token}a`]) {
    await assert.rejects(consultarSeguimientoTallerHandler({data: {token: bad}}, publicDeps), {code: "not-found"});
  }
  await assert.rejects(consultarSeguimientoTallerHandler({data: {token, extra: 1}}, publicDeps), {code: "not-found"});
  console.log("OK seguimiento: vista pública por enlace sin montos, técnico, plaza, fotos ni datos personales");

  // Patente + RUT: vale el RUT del titular y el de quien entregó el vehículo.
  assert.equal((await lookup("12.345.678-5", "10.0.0.1", plate.toLowerCase())).seguimiento.vehiculo.patente, plate);
  assert.equal((await lookup("11111111-1", "10.0.0.2", plate)).seguimiento.etapa.clave, "reparacion");
  await assert.rejects(lookup("12.345.678-5", "10.0.0.3", "ZZZZ99"), {code: "not-found"}, "patente que no está en ningún taller");
  await assert.rejects(lookup("", "10.0.0.3", plate), {code: "invalid-argument"});
  await assert.rejects(buscarSeguimientoTallerHandler({rawRequest: {ip: "10.0.0.3"}, data: {patente: plate, rut: "1", codigoTaller: "x"}},
    publicDeps), {code: "invalid-argument"}, "ya no se admite código de taller");
  // Otro negocio con la misma patente en el índice pero sin OT abierta no estorba: se revisa cada taller.
  await db.doc(`tallerSeguimientoPatentes/${plateIndexId(plate)}`).set({negocios: [otherBusinessId, businessId]}, {merge: true});
  assert.equal((await lookup("12.345.678-5", "10.0.0.6", plate)).seguimiento.taller.nombre, "Taller Bagner");
  // Tres fallos desde una IP la bloquean, incluso con datos correctos después.
  await assert.rejects(lookup("9.999.999-3", "10.0.0.4", plate), {code: "not-found"});
  await assert.rejects(lookup("9.999.999-3", "10.0.0.4", plate), {code: "not-found"});
  await assert.rejects(lookup("9.999.999-3", "10.0.0.4", plate), {code: "resource-exhausted"});
  await assert.rejects(lookup("12.345.678-5", "10.0.0.4", plate), {code: "resource-exhausted"}, "IP bloqueada");
  // La patente también queda bloqueada aunque los intentos vengan de otras IP.
  await assert.rejects(lookup("12.345.678-5", "10.0.0.5", plate), {code: "resource-exhausted"}, "patente bloqueada");
  const attempts = await db.collection("tallerSeguimientoIntentos").get();
  assert.ok(attempts.docs.every((entry) => !JSON.stringify(entry.data()).includes(plate) && !entry.id.includes(plate)),
    "los contadores no guardan la patente ni la IP en claro");
  console.log("OK seguimiento: patente + RUT en toda la plataforma (titular o quien entregó) con límite por IP y por patente");

  // Las colecciones del seguimiento no se leen desde el SDK cliente.
  for (const path of [`tallerSeguimientoTokens/${hashToken(token)}`, `tallerSeguimientoIntentos/${attempts.docs[0]?.id || "x"}`,
    `tallerSeguimientoPatentes/${plateIndexId(plate)}`, `${base}/ordenesTrabajo/${otId}/seguimiento/enlace`]) {
    await assert.rejects(getDoc(doc(clientDb, path)), (error) => String(error.code).includes("permission-denied"), path);
  }
  console.log("OK seguimiento: tokens, índice de patentes y contadores cerrados al SDK cliente");

  // Al entregar (o anular) la OT el enlace deja de funcionar y no se puede volver a pedir.
  await orderRef.update({estado: "cerrada"});
  await assert.rejects(consultarSeguimientoTallerHandler({data: {token}}, publicDeps), {code: "not-found"});
  const tokenDocs = await db.collection("tallerSeguimientoTokens").where("otId", "==", otId).get();
  assert.ok(tokenDocs.docs.some((entry) => entry.data().estado === "inactivo"));
  await assert.rejects(staff(ownerUid), {code: "failed-precondition"});
  // Se limpian los bloqueos para comprobar que una OT cerrada ya no se encuentra con datos correctos.
  await Promise.all((await db.collection("tallerSeguimientoIntentos").get()).docs.map((entry) => entry.ref.delete()));
  await assert.rejects(lookup("12.345.678-5", "10.0.0.9", plate), {code: "not-found"}, "ya no está en el taller");
  console.log("OK seguimiento: enlace inactivo al cerrar la OT");
  console.log("WORK_ORDER_TRACKING_SMOKE_OK");
} finally {
  await deleteApp(app);
  await Promise.all(admin.apps.map((item) => item.delete()));
}
