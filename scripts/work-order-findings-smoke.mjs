import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {connectStorageEmulator, getBytes, getStorage, ref, uploadBytes} from "firebase/storage";

// Hallazgos de la ejecución con emuladores (Auth, Firestore y Storage): foto opcional, permisos,
// conversión solo por Owner/Administrador, idempotencia e historial.
// Ejecutar: npx firebase emulators:exec --project demo-valora-taller --only auth,firestore,storage "node scripts/work-order-findings-smoke.mjs"
const {GCLOUD_PROJECT: projectId, FIREBASE_AUTH_EMULATOR_HOST: authHost, FIRESTORE_EMULATOR_HOST: firestoreHost,
  FIREBASE_STORAGE_EMULATOR_HOST: storageHost} = process.env;
if (!projectId?.startsWith("demo-") || ![authHost, firestoreHost, storageHost].every((host) => /^127\.0\.0\.1:\d+$/.test(host || ""))) {
  throw new Error("Ejecuta el smoke en emuladores locales (auth, firestore, storage) con un proyecto demo.");
}
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {requireOperationalBusinessAccess} = require("../functions/businessOnboarding");
const {hallazgosOTHandler} = require("../functions/workOrderFindings");
const {obtenerHistorialOTHandler} = require("../functions/workOrderPersistence");

const storageBucket = `${projectId}.appspot.com`;
const adminApp = admin.initializeApp({projectId, storageBucket});
const app = initializeApp({projectId, storageBucket, apiKey: "demo-key"});
const clientAuth = getAuth(app);
connectAuthEmulator(clientAuth, `http://${authHost}`, {disableWarnings: true});
const clientStorage = getStorage(app);
connectStorageEmulator(clientStorage, "127.0.0.1", Number(storageHost.split(":")[1]));

const db = admin.firestore();
const bucket = admin.storage().bucket();
const deps = {db, bucket, HttpsError, FieldValue: admin.firestore.FieldValue, auth: admin.auth(),
  requireBusinessAccess: requireOperationalBusinessAccess};

// JPEG mínimo válido (16×12) y variantes: con EXIF/comentario y con otra tabla de cuantización.
const CLEAN_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==", "base64");
const exif = Buffer.from("Exif\0\0GPS -33.45 -70.66 Telefono de prueba");
const DIRTY_JPEG = Buffer.concat([CLEAN_JPEG.subarray(0, 2),
  Buffer.from([0xff, 0xe1, 0, exif.length + 2]), exif,
  Buffer.from([0xff, 0xfe, 0, 9]), Buffer.from("secreto"), CLEAN_JPEG.subarray(2)]);
const OTHER_JPEG = Buffer.from(CLEAN_JPEG);
OTHER_JPEG[CLEAN_JPEG.indexOf(Buffer.from([0xff, 0xdb])) + 5] ^= 0x01;
const b64 = (bytes) => bytes.toString("base64");

try {
  const {user} = await signInAnonymously(clientAuth);
  const ownerUid = user.uid;
  const businessId = "taller-hallazgos-demo";
  const otherBusinessId = "taller-hallazgos-ajeno";
  const users = {technician: "tecnico-hall", other: "tecnico-otro-hall", outsider: "externo-hall"};
  await Promise.all(Object.values(users).map((uid) =>
    deps.auth.createUser({uid, email: `${uid}@example.test`}).catch((error) => {
      if (error.code !== "auth/uid-already-exists") throw error;
    })));
  const business = {estado: "activo", paisCodigo: "CL", contratoJurisdiccionalVersion: 1,
    verificacionEmpresa: {estado: "VERIFICADA"}, modulosHabilitados: ["taller"]};
  const membership = (uid, negocioId, rol) => db.doc(`membresias/${negocioId}__${uid}`).set({uid, negocioId, estado: "activo", rol});
  await Promise.all([
    db.doc(`negocios/${businessId}`).set(business), db.doc(`negocios/${otherBusinessId}`).set(business),
    membership(ownerUid, businessId, "OWNER"), membership(users.technician, businessId, "TECNICO"),
    membership(users.other, businessId, "TECNICO"), membership(users.outsider, otherBusinessId, "OWNER"),
    db.doc(`negocios/${businessId}/inventario/servicio-frenos`).set({negocioId: businessId, tipoItem: "servicio", estado: "activo", nombre: "Frenos"}),
    db.doc(`negocios/${businessId}/inventario/producto-x`).set({negocioId: businessId, tipoItem: "producto", estado: "activo", nombre: "Pastillas"}),
  ]);
  const otId = "ot-hallazgos-demo";
  const orderRef = db.doc(`negocios/${businessId}/ordenesTrabajo/${otId}`);
  await orderRef.set({otId, negocioId: businessId, numeroOT: "OT-000001", estado: "en_reparacion", estadoAprobacion: "aprobada",
    recepcion: {motivoCliente: "Ruido al frenar"}, responsableUid: users.technician, responsableNombre: "Técnico"});

  let count = 0;
  const nextId = () => `hallazgo-${Date.now()}-${++count}`;
  const run = (uid, operacion, patch = {}) => hallazgosOTHandler({auth: {uid}, data: {businessId, otId, operacion, ...patch}}, deps);
  const report = (uid, patch = {}) => run(uid, "reportar", {requestId: nextId(), descripcion: "Fuga de aceite en el cárter", urgente: true,
    imagen: b64(CLEAN_JPEG), ...patch});
  const prefix = `negocios/${businessId}/ordenesTrabajo/${otId}/hallazgos/`;
  const filesFor = async () => (await bucket.getFiles({prefix}))[0];

  // Validaciones: descripción y prioridad son obligatorias; la foto es opcional pero, si va, debe ser JPEG válido.
  await assert.rejects(report(ownerUid, {imagen: "SG9sYQ=="}), {code: "invalid-argument"}, "no es JPEG");
  await assert.rejects(report(ownerUid, {descripcion: "   "}), {code: "invalid-argument"});
  await assert.rejects(report(ownerUid, {descripcion: "x".repeat(501)}), {code: "invalid-argument"});
  await assert.rejects(report(ownerUid, {urgente: undefined}), {code: "invalid-argument"});
  await assert.rejects(report(ownerUid, {urgente: "si"}), {code: "invalid-argument"});
  await assert.rejects(report(ownerUid, {precio: 1}), {code: "invalid-argument"});
  await assert.rejects(run(ownerUid, "borrar"), {code: "invalid-argument"});
  assert.equal((await filesFor()).length, 0);
  console.log("OK hallazgos: descripción y prioridad obligatorias; foto opcional válida; sin campos extra");

  // Reportar: solo el responsable, el Administrador o el Owner; la foto se guarda sin metadatos.
  await assert.rejects(report(users.other), {code: "permission-denied"}, "otro técnico no es el responsable");
  await assert.rejects(report(users.outsider), {code: "permission-denied"});
  const requestId = nextId();
  const first = await report(users.technician, {requestId, imagen: b64(DIRTY_JPEG)});
  assert.equal(first.sinCambios, false);
  assert.equal((await report(users.technician, {requestId, imagen: b64(DIRTY_JPEG)})).sinCambios, true, "idempotente");
  await assert.rejects(report(ownerUid, {requestId, imagen: b64(DIRTY_JPEG)}), {code: "already-exists"});
  await assert.rejects(report(users.technician, {requestId, imagen: b64(OTHER_JPEG)}), {code: "already-exists"});
  const files = await filesFor();
  assert.equal(files.length, 1, "un intento rechazado no deja archivos huérfanos");
  const [bytes] = await files[0].download();
  assert.deepEqual(bytes, CLEAN_JPEG);
  assert.ok(!bytes.includes("GPS") && !bytes.includes("secreto"));
  await assert.rejects(getBytes(ref(clientStorage, files[0].name)), {code: "storage/unauthorized"});
  const stored = (await orderRef.collection("hallazgos").doc(requestId).get()).data();
  assert.equal(stored.urgente, true);
  assert.equal(stored.reportadoPorUid, users.technician);
  assert.equal(stored.servicioOtId, null);
  console.log("OK hallazgos: reporte idempotente, foto sin metadatos y Storage cerrado al cliente");

  // Sin foto: se acepta, no genera archivo y la foto no está disponible.
  const noPhotoId = nextId();
  assert.equal((await report(users.technician, {requestId: noPhotoId, imagen: undefined, urgente: false})).sinCambios, false);
  assert.equal((await report(users.technician, {requestId: noPhotoId, imagen: undefined, urgente: false})).sinCambios, true);
  assert.equal((await filesFor()).length, 1, "sin foto no se crea archivo");
  await assert.rejects(run(ownerUid, "foto", {hallazgoId: noPhotoId}), {code: "not-found"});
  assert.equal((await orderRef.collection("hallazgos").doc(noPhotoId).get()).data().foto, null);

  // Lectura: listado y foto por la Function; otro negocio no accede.
  const listed = (await run(ownerUid, "listar")).hallazgos;
  assert.equal(listed.length, 2);
  assert.deepEqual(Object.keys(listed[0]).sort(), ["convertido", "creadoEn", "descripcion", "hallazgoId", "reportadoPorNombre",
    "servicioOtId", "tieneFoto", "urgente"]);
  assert.equal(listed.find((item) => item.hallazgoId === requestId).tieneFoto, true);
  assert.equal(listed.find((item) => item.hallazgoId === noPhotoId).tieneFoto, false);
  assert.equal((await run(users.other, "listar")).hallazgos.length, 2);
  assert.equal((await run(users.other, "foto", {hallazgoId: requestId})).imagen, b64(CLEAN_JPEG));
  await assert.rejects(run(users.outsider, "listar"), {code: "permission-denied"});
  await assert.rejects(run(ownerUid, "foto", {hallazgoId: "no-existe"}), {code: "not-found"});

  // Convertir en trabajo: solo Owner/Administrador, con servicio activo del catálogo; una sola vez.
  const serviceId = nextId();
  const convert = (uid, patch = {}) => run(uid, "convertir", {hallazgoId: requestId, itemId: "servicio-frenos", requestId: serviceId, ...patch});
  await assert.rejects(convert(users.technician), {code: "permission-denied"}, "el técnico no convierte");
  await assert.rejects(convert(ownerUid, {itemId: "producto-x"}), {code: "failed-precondition"}, "debe ser un servicio");
  const converted = await convert(ownerUid);
  assert.equal(converted.sinCambios, false);
  assert.equal((await convert(ownerUid)).sinCambios, true, "idempotente");
  await assert.rejects(convert(ownerUid, {requestId: nextId()}), {code: "failed-precondition"}, "una sola conversión");
  const service = (await orderRef.collection("servicios").doc(serviceId).get()).data();
  assert.equal(service.origenHallazgoId, requestId);
  assert.equal(service.estado, "pendiente");
  assert.equal((await orderRef.collection("hallazgos").doc(requestId).get()).data().servicioOtId, serviceId);
  assert.equal((await run(ownerUid, "listar")).hallazgos.find((item) => item.hallazgoId === requestId).convertido, true);

  // Historial.
  const history = (await obtenerHistorialOTHandler({auth: {uid: ownerUid}, data: {businessId, otId}}, deps)).eventos;
  assert.ok(history.find((event) => event.tipo === "hallazgo_reportado" && event.detalle.urgente === true));
  assert.ok(history.find((event) => event.tipo === "hallazgo_convertido"));

  // Fuera de la ejecución no se reportan ni convierten hallazgos.
  await orderRef.update({estado: "pendiente_entrega"});
  await assert.rejects(report(ownerUid), {code: "failed-precondition"});
  await assert.rejects(run(ownerUid, "convertir", {hallazgoId: requestId, itemId: "servicio-frenos", requestId: nextId()}),
    {code: "failed-precondition"});
  assert.equal((await run(users.technician, "listar")).hallazgos.length, 2);
  console.log("WORK_ORDER_FINDINGS_SMOKE_OK: foto opcional, permisos, conversión única, Storage e historial");
} finally {
  await deleteApp(app);
  await adminApp.delete();
}
