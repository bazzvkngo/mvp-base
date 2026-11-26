import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {connectStorageEmulator, getBytes, getStorage, ref, uploadBytes} from "firebase/storage";

// Entrega con trazabilidad con emuladores (Auth, Firestore y Storage): siete fotos selladas, acta de quien
// retira, contacto con el cliente y permisos.
// Ejecutar: npx firebase emulators:exec --project demo-valora-taller --only auth,firestore,storage "node scripts/work-order-delivery-smoke.mjs"
const {GCLOUD_PROJECT: projectId, FIREBASE_AUTH_EMULATOR_HOST: authHost, FIRESTORE_EMULATOR_HOST: firestoreHost,
  FIREBASE_STORAGE_EMULATOR_HOST: storageHost} = process.env;
if (!projectId?.startsWith("demo-") || ![authHost, firestoreHost, storageHost].every((host) => /^127\.0\.0\.1:\d+$/.test(host || ""))) {
  throw new Error("Ejecuta el smoke en emuladores locales (auth, firestore, storage) con un proyecto demo.");
}
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {requireOperationalBusinessAccess} = require("../functions/businessOnboarding");
const {entregaOTHandler} = require("../functions/workOrderDelivery");
const {registrarEntregaOTHandler} = require("../functions/workOrderPersistence");
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
  const businessId = "taller-entrega-demo";
  const otherBusinessId = "taller-entrega-ajeno";
  const users = {technician: "tecnico-ent", other: "tecnico-otro-ent", outsider: "externo-ent"};
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
    db.doc(`negocios/${businessId}/clientes/cliente-demo`).set({negocioId: businessId, clienteId: "cliente-demo",
      nombreRazonSocial: "María Pérez", telefono: "+56 9 6123 4587", estado: "activo"}),
  ]);
  const otId = "ot-entrega-demo";
  const orderRef = db.doc(`negocios/${businessId}/ordenesTrabajo/${otId}`);
  await orderRef.set({otId, negocioId: businessId, numeroOT: "OT-000001", estado: "en_reparacion", estadoAprobacion: "aprobada",
    recepcion: {motivoCliente: "Ruido"}, clienteId: "cliente-demo", responsableUid: users.technician, plazaId: null});

  const run = (uid, operacion, patch = {}) => entregaOTHandler({auth: {uid}, data: {businessId, otId, operacion, ...patch}}, deps);
  const prefix = `negocios/${businessId}/ordenesTrabajo/${otId}/entrega/`;
  const filesFor = async () => (await bucket.getFiles({prefix}))[0];
  const ZONES = ["delantera", "lateral-izquierdo-delantero", "lateral-izquierdo-trasero", "lateral-derecho-delantero",
    "lateral-derecho-trasero", "trasera", "tablero"];

  // Contacto: solo Owner/Administrador o el responsable; teléfono normalizado para llamar o WhatsApp.
  const contact = await run(users.technician, "contacto");
  assert.deepEqual(contact, {nombre: "María Pérez", telefono: "+56 9 6123 4587", telefonoInternacional: "56961234587"});
  assert.equal((await run(ownerUid, "contacto")).nombre, "María Pérez");
  await assert.rejects(run(users.other, "contacto"), {code: "permission-denied"}, "otro técnico no es el responsable");
  await assert.rejects(run(users.outsider, "contacto"), {code: "permission-denied"});
  await db.doc(`negocios/${businessId}/clientes/cliente-demo`).update({telefono: "12"});
  assert.equal((await run(ownerUid, "contacto")).telefono, null, "un teléfono inválido no se ofrece");
  console.log("OK entrega: contacto del cliente solo para Owner/Administrador/responsable");

  // Las fotos de entrega solo se toman con el vehículo pendiente de entrega.
  await assert.rejects(run(ownerUid, "subir", {zona: "delantera", imagen: b64(CLEAN_JPEG)}), {code: "failed-precondition"});
  await orderRef.update({estado: "pendiente_entrega"});
  await assert.rejects(run(ownerUid, "subir", {zona: "frente", imagen: b64(CLEAN_JPEG)}), {code: "invalid-argument"});
  await assert.rejects(run(ownerUid, "subir", {zona: "delantera", imagen: "SG9sYQ=="}), {code: "invalid-argument"}, "no es JPEG");
  await assert.rejects(run(ownerUid, "subir", {zona: "delantera", imagen: b64(CLEAN_JPEG), precio: 1}), {code: "invalid-argument"});
  await assert.rejects(run(users.other, "subir", {zona: "delantera", imagen: b64(CLEAN_JPEG)}), {code: "permission-denied"});
  await assert.rejects(run(users.outsider, "estado"), {code: "permission-denied"});

  // Subida sin metadatos y sellada.
  const first = await run(users.technician, "subir", {zona: "delantera", imagen: b64(DIRTY_JPEG)});
  assert.equal(first.sinCambios, false);
  const [saved] = await (await filesFor())[0].download();
  assert.deepEqual(saved, CLEAN_JPEG);
  assert.ok(!saved.includes("GPS") && !saved.includes("secreto"));
  assert.equal((await run(ownerUid, "subir", {zona: "delantera", imagen: b64(CLEAN_JPEG)})).sinCambios, true, "idempotente");
  await assert.rejects(run(ownerUid, "subir", {zona: "delantera", imagen: b64(OTHER_JPEG)}),
    {code: "failed-precondition", message: /ya fue registrada y no se puede modificar/});
  assert.equal((await filesFor()).length, 1, "un intento rechazado no deja archivos huérfanos");
  await assert.rejects(getBytes(ref(clientStorage, (await filesFor())[0].name)), {code: "storage/unauthorized"});
  assert.equal((await run(users.technician, "leer", {zona: "delantera"})).imagen, b64(CLEAN_JPEG));
  await assert.rejects(run(ownerUid, "leer", {zona: "trasera"}), {code: "not-found"});
  const status = await run(users.technician, "estado");
  assert.equal(status.faltantes.length, 6);
  assert.equal(status.fotos.find((photo) => photo.zona === "delantera").completa, true);
  console.log("OK entrega: fotos selladas, sin metadatos, Storage cerrado al cliente");

  // Registrar la entrega: faltan fotos, datos inválidos y entrega correcta.
  let n = 0;
  const deliver = (uid, entrega, extra = {}) => registrarEntregaOTHandler({auth: {uid}, data: {businessId, otId, requestId: `entrega-${Date.now()}-${++n}`,
    expectedActualizadoEn: extra.expected, ...(entrega ? {entrega} : {})}}, deps);
  const expected = async () => (await orderRef.get()).data().actualizadoEn.toMillis();
  const valid = {receptorNombre: "María Pérez", receptorDocumento: "11.111.111-1", observaciones: "Raspón antiguo en la puerta", conforme: true};
  await assert.rejects(deliver(users.technician, valid, {expected: await expected()}), {code: "failed-precondition", message: /Faltan fotos de entrega/});
  for (const zone of ZONES.filter((item) => item !== "delantera")) await run(users.technician, "subir", {zona: zone, imagen: b64(zone === "tablero" ? OTHER_JPEG : CLEAN_JPEG)});
  assert.equal((await run(ownerUid, "estado")).faltantes.length, 0);
  await assert.rejects(deliver(users.technician, undefined, {expected: await expected()}), {code: "invalid-argument"}, "faltan los datos");
  await assert.rejects(deliver(users.technician, {...valid, conforme: false}, {expected: await expected()}), {code: "invalid-argument"});
  await assert.rejects(deliver(users.technician, {...valid, receptorDocumento: "11.111.111-2"}, {expected: await expected()}), {code: "invalid-argument"}, "RUT inválido");
  await assert.rejects(deliver(users.technician, {...valid, receptorNombre: "  "}, {expected: await expected()}), {code: "invalid-argument"});
  await assert.rejects(deliver(users.technician, {...valid, extra: 1}, {expected: await expected()}), {code: "invalid-argument"});
  const delivered = await deliver(users.technician, valid, {expected: await expected()});
  assert.equal(delivered.estado, "cerrada");
  // Después de entregar ya no se toman ni cambian fotos de entrega.
  await assert.rejects(run(ownerUid, "subir", {zona: "trasera", imagen: b64(OTHER_JPEG)}), {code: "failed-precondition"});
  console.log("OK entrega: exige las siete fotos, RUT válido y conformidad; cierra la OT");

  // Acta: el documento de quien retira solo lo ve el Owner/Administrador; el estado no lo expone.
  const acta = await run(ownerUid, "acta");
  assert.equal(acta.receptorNombre, "María Pérez");
  assert.equal(acta.receptorDocumento, "11.111.111-1");
  assert.equal(acta.conforme, true);
  await assert.rejects(run(users.technician, "acta"), {code: "permission-denied"});
  const publicStatus = await run(users.technician, "estado");
  assert.equal(publicStatus.entregada, true);
  assert.ok(!JSON.stringify(publicStatus).includes("11.111.111"), "el estado no expone el documento");
  const history = (await obtenerHistorialOTHandler({auth: {uid: ownerUid}, data: {businessId, otId}}, deps)).eventos;
  const event = history.find((item) => item.tipo === "vehiculo_entregado");
  assert.equal(event.detalle.receptorNombre, "María Pérez");
  assert.ok(!JSON.stringify(history).includes("11.111.111"), "el historial no expone el documento");
  assert.equal(history.filter((item) => item.tipo === "foto_entrega_registrada").length, 7);
  console.log("WORK_ORDER_DELIVERY_SMOKE_OK: fotos selladas, acta protegida, contacto, permisos e historial");
} finally {
  await deleteApp(app);
  await adminApp.delete();
}
