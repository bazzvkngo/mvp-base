import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {connectStorageEmulator, getBytes, getStorage, ref, uploadBytes} from "firebase/storage";

// Fotos de recepción del Taller con emuladores (Auth, Firestore y Storage):
// zonas del prototipo, daños, fotos selladas, permisos, límites, metadatos y reglas que no abren Storage.
// Ejecutar: npx firebase emulators:exec --project demo-valora-taller --only auth,firestore,storage "node scripts/work-order-photos-smoke.mjs"
const {GCLOUD_PROJECT: projectId, FIREBASE_AUTH_EMULATOR_HOST: authHost, FIRESTORE_EMULATOR_HOST: firestoreHost,
  FIREBASE_STORAGE_EMULATOR_HOST: storageHost} = process.env;
if (!projectId?.startsWith("demo-") || ![authHost, firestoreHost, storageHost].every((host) => /^127\.0\.0\.1:\d+$/.test(host || ""))) {
  throw new Error("Ejecuta el smoke en emuladores locales (auth, firestore, storage) con un proyecto demo.");
}
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {requireOperationalBusinessAccess} = require("../functions/businessOnboarding");
const {fotosRecepcionOTHandler, RECEPTION_PHOTO_ZONES} = require("../functions/workOrderReceptionPhotos");
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
  const businessId = "taller-fotos-demo";
  const otherBusinessId = "taller-ajeno-demo";
  const users = {technician: "tecnico-fotos", outsider: "externo-fotos", restricted: "perfil-sin-taller"};
  await Promise.all(Object.values(users).map((uid) =>
    deps.auth.createUser({uid, email: `${uid}@example.test`}).catch((error) => {
      if (error.code !== "auth/uid-already-exists") throw error;
    })));
  const business = {estado: "activo", paisCodigo: "CL", contratoJurisdiccionalVersion: 1,
    verificacionEmpresa: {estado: "VERIFICADA"}, modulosHabilitados: ["taller"]};
  const membership = (uid, negocioId, rol, extra = {}) =>
    db.doc(`membresias/${negocioId}__${uid}`).set({uid, negocioId, estado: "activo", rol, ...extra});
  await Promise.all([
    db.doc(`negocios/${businessId}`).set(business),
    db.doc(`negocios/${otherBusinessId}`).set(business),
    membership(ownerUid, businessId, "OWNER"),
    membership(users.technician, businessId, "TECNICO"),
    membership(users.outsider, otherBusinessId, "OWNER"),
    membership(users.restricted, businessId, "MEMBER", {profileId: "solo-ventas"}),
    db.doc(`negocios/${businessId}/perfilesEmpleados/solo-ventas`).set({negocioId: businessId, estado: "activo", modulos: ["cotizaciones"]}),
  ]);
  const otId = "ot-fotos-demo";
  const orderRef = db.doc(`negocios/${businessId}/ordenesTrabajo/${otId}`);
  // Las fotos se toman antes de registrar la recepción.
  await orderRef.set({otId, negocioId: businessId, numeroOT: "OT-000001", estado: "ingresada",
    estadoAprobacion: "pendiente", plazaId: null, recepcion: null});
  await db.doc(`negocios/${otherBusinessId}/ordenesTrabajo/${otId}`).set({otId, negocioId: otherBusinessId, estado: "en_cola"});

  const exterior = (patch = {}) => ({zona: "delantera", danos: {conDanos: false, marcas: []}, ...patch});
  const run = (uid, operacion, patch = {}) => fotosRecepcionOTHandler({auth: {uid},
    data: {businessId, otId, operacion, ...exterior(), ...patch}}, deps);
  const stored = async () => (await orderRef.get()).data().fotosRecepcion || {};
  const prefix = `negocios/${businessId}/ordenesTrabajo/${otId}/recepcion/`;
  const filesFor = async () => (await bucket.getFiles({prefix}))[0].map((file) => file.name);

  // Zonas del prototipo y validaciones de entrada.
  assert.deepEqual(RECEPTION_PHOTO_ZONES, ["delantera", "lateral-izquierdo-delantero", "lateral-izquierdo-trasero",
    "lateral-derecho-delantero", "lateral-derecho-trasero", "trasera", "tablero"]);
  await assert.rejects(run(ownerUid, "subir", {zona: "frente", imagen: b64(CLEAN_JPEG)}), {code: "invalid-argument"});
  await assert.rejects(run(ownerUid, "subir", {imagen: "SG9sYQ=="}), {code: "invalid-argument"}, "no es JPEG");
  await assert.rejects(run(ownerUid, "subir", {imagen: "/9gAAP/Z"}), {code: "invalid-argument"}, "JPEG truncado");
  await assert.rejects(run(ownerUid, "subir", {imagen: "A".repeat(Math.ceil(2 * 1024 * 1024 / 3) * 4 + 4)}),
    {code: "invalid-argument"}, "supera 2 MiB");
  await assert.rejects(run(ownerUid, "subir", {imagen: b64(CLEAN_JPEG), precio: 1}), {code: "invalid-argument"});
  await assert.rejects(run(ownerUid, "quitar"), {code: "invalid-argument"}, "las fotos no se quitan");
  console.log("OK fotos recepción: zona, tipo JPEG, tamaño y campos admitidos se validan en el servidor");

  // Daños: obligatorio indicar el estado; con daños, al menos una marca con nota y posición válida.
  const damages = (danos) => run(ownerUid, "subir", {imagen: b64(CLEAN_JPEG), danos});
  await assert.rejects(damages(undefined), {code: "invalid-argument"}, "falta el estado de la zona");
  await assert.rejects(damages({conDanos: true, marcas: []}), {code: "invalid-argument"}, "con daños sin marcas");
  await assert.rejects(damages({conDanos: true, marcas: [{x: 0.5, y: 0.5, nota: "  "}]}), {code: "invalid-argument"});
  await assert.rejects(damages({conDanos: true, marcas: [{x: 1.5, y: 0.5, nota: "rayón"}]}), {code: "invalid-argument"});
  await assert.rejects(damages({conDanos: false, marcas: [{x: 0.5, y: 0.5, nota: "rayón"}]}), {code: "invalid-argument"});
  await assert.rejects(run(ownerUid, "subir", {zona: "tablero", imagen: b64(CLEAN_JPEG), danos: {conDanos: false, marcas: []}}),
    {code: "invalid-argument"}, "el tablero no registra daños");
  assert.deepEqual(await stored(), {});
  console.log("OK fotos recepción: estado de daños obligatorio y marcas con nota y posición");

  // Subida con metadatos y daños: el archivo guardado no conserva EXIF ni comentarios.
  const marks = [{x: 0.25, y: 0.6, nota: "  rayón de 15 cm  "}, {x: 0.7, y: 0.4, nota: "abolladura en puerta"}];
  const uploaded = await run(users.technician, "subir", {zona: "lateral-izquierdo-delantero", imagen: b64(DIRTY_JPEG),
    danos: {conDanos: true, marcas: marks}});
  assert.equal(uploaded.sinCambios, false);
  const side = (await stored())["lateral-izquierdo-delantero"];
  assert.ok(side.hash && side.subidaPorUid === users.technician && side.subidaPorNombre && side.subidaEn?.toDate());
  assert.equal(side.bytes, CLEAN_JPEG.length);
  assert.equal(side.conDanos, true);
  assert.deepEqual(side.marcas.map((mark) => mark.nota), ["rayón de 15 cm", "abolladura en puerta"]);
  const [files] = await bucket.getFiles({prefix});
  assert.equal(files.length, 1);
  const [savedBytes] = await files[0].download();
  assert.deepEqual(savedBytes, CLEAN_JPEG, "se guardan los mismos píxeles sin metadatos");
  assert.ok(!savedBytes.includes("GPS") && !savedBytes.includes("secreto"));
  const [metadata] = await files[0].getMetadata();
  assert.equal(metadata.metadata?.firebaseStorageDownloadTokens, undefined);
  console.log("OK fotos recepción: el archivo guardado no conserva EXIF, ubicación ni comentarios");

  // Sellada: la misma foto con los mismos daños es idempotente; cualquier cambio se rechaza.
  assert.equal((await run(ownerUid, "subir", {zona: "lateral-izquierdo-delantero", imagen: b64(CLEAN_JPEG),
    danos: {conDanos: true, marcas}})).sinCambios, true);
  await assert.rejects(run(ownerUid, "subir", {zona: "lateral-izquierdo-delantero", imagen: b64(OTHER_JPEG),
    danos: {conDanos: true, marcas}}), {code: "failed-precondition", message: /ya fue registrada y no se puede modificar/});
  await assert.rejects(run(ownerUid, "subir", {zona: "lateral-izquierdo-delantero", imagen: b64(CLEAN_JPEG)}),
    {code: "failed-precondition"}, "no se cambian los daños de una foto sellada");
  assert.equal((await filesFor()).length, 1, "un intento rechazado no deja archivos huérfanos");
  console.log("OK fotos recepción: cada foto queda sellada con fecha y usuario");

  // Lectura solo a través de la Function; Storage no se abre al cliente.
  assert.equal((await run(users.technician, "leer", {zona: "lateral-izquierdo-delantero"})).imagen, b64(CLEAN_JPEG));
  await assert.rejects(run(ownerUid, "leer", {zona: "trasera"}), {code: "not-found"});
  await assert.rejects(getBytes(ref(clientStorage, files[0].name)), {code: "storage/unauthorized"});
  await assert.rejects(uploadBytes(ref(clientStorage, `${prefix}directa.jpg`), new Uint8Array(CLEAN_JPEG)),
    {code: "storage/unauthorized"});
  console.log("OK fotos recepción: Storage cerrado al cliente; lectura solo por la Function");

  // Permisos: otro negocio, perfil sin Taller y anónimo no leen ni suben.
  await assert.rejects(run(users.outsider, "leer", {zona: "lateral-izquierdo-delantero"}), {code: "permission-denied"});
  await assert.rejects(run(users.outsider, "subir", {imagen: b64(CLEAN_JPEG)}), {code: "permission-denied"});
  await assert.rejects(run(users.restricted, "leer", {zona: "lateral-izquierdo-delantero"}), {code: "permission-denied"});
  await assert.rejects(fotosRecepcionOTHandler({auth: {uid: users.outsider},
    data: {businessId: otherBusinessId, otId, operacion: "leer", zona: "lateral-izquierdo-delantero"}}, deps), {code: "not-found"},
  "la OT del otro negocio no tiene la foto");
  await assert.rejects(fotosRecepcionOTHandler({data: {businessId, otId, operacion: "leer", zona: "delantera"}}, deps),
    {code: "unauthenticated"});
  console.log("OK fotos recepción: otro negocio, perfil sin Taller y anónimo no acceden");

  // Tablero sin daños y una zona exterior sin daños.
  await run(users.technician, "subir", {zona: "tablero", imagen: b64(OTHER_JPEG), danos: undefined});
  await run(users.technician, "subir", {zona: "trasera", imagen: b64(CLEAN_JPEG)});
  const photos = await stored();
  assert.equal("conDanos" in photos.tablero, false);
  assert.deepEqual([photos.trasera.conDanos, photos.trasera.marcas], [false, []]);

  // Historial: eventos con la zona y los daños, sin identificadores internos.
  const history = (await obtenerHistorialOTHandler({auth: {uid: ownerUid}, data: {businessId, otId}}, deps)).eventos;
  const photoEvents = history.filter((event) => event.tipo === "foto_recepcion_registrada");
  assert.equal(photoEvents.length, 3);
  assert.deepEqual(photoEvents.find((event) => event.detalle.zona === "lateral-izquierdo-delantero").detalle,
    {zona: "lateral-izquierdo-delantero", conDanos: true, cantidadDanos: 2});
  assert.ok(photoEvents.every((event) => !("hash" in event.detalle)));

  // Después de aprobar el ingreso ya no se registran fotos, pero se pueden ver.
  await orderRef.update({estadoAprobacion: "aprobada"});
  await assert.rejects(run(ownerUid, "subir", {imagen: b64(CLEAN_JPEG)}),
    {code: "failed-precondition", message: /antes de aprobar el ingreso/});
  await orderRef.update({estado: "cerrada"});
  assert.equal((await run(users.technician, "leer", {zona: "tablero"})).imagen, b64(OTHER_JPEG));
  console.log("WORK_ORDER_PHOTOS_SMOKE_OK: zonas, daños, sellado, permisos, límites, metadatos, Storage e historial");
} finally {
  await deleteApp(app);
  await adminApp.delete();
}
