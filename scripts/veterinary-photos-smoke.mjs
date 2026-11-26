import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {connectStorageEmulator, getBytes, getStorage, ref} from "firebase/storage";
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
const {fotosAtencionVeterinariaHandler} = require("../functions/veterinaryAttentionPhotos");

const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(storageHost)) throw Error("Se requiere Storage Emulator local.");
const storageBucket = projectId + ".appspot.com";
const adminApp = admin.initializeApp({projectId, storageBucket});
const app = initializeApp({projectId, storageBucket, apiKey: "demo-key"});
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
    business.collection("clientes").doc("tutor-demo").set({negocioId: businessId, estado: "activo"}),
    db.doc("negocios/otra-clinica/clientes/tutor-ajeno").set({negocioId: "otra-clinica", estado: "activo"}),
  ]);
  const attentionRef = business.collection("atencionesVeterinarias").doc("atencion-demo");
  await attentionRef.set({negocioId: businessId, estado: "en_atencion", pacienteId: "paciente-demo"});
  const bucket = admin.storage().bucket();
  const imagen = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==";
  const photoId = "foto-demo";
  const run = (operacion, patch = {}) => fotosAtencionVeterinariaHandler({
    auth: {uid}, data: {businessId, atencionId: "atencion-demo", fotoId: photoId, operacion, ...patch},
  }, {db, bucket, HttpsError, FieldValue: admin.firestore.FieldValue, requireBusinessAccess: requireOperationalBusinessAccess});

  const upload = {vista: "trasera", imagen};
  await assert.rejects(run("subir", {...upload, businessId: "otra-clinica"}), {code: "permission-denied"});
  await assert.rejects(run("subir", {...upload, imagen: "SG9sYQ=="}), {code: "invalid-argument"});
  await assert.rejects(run("subir", {...upload, imagen: "/9gAAP/Z"}), {code: "invalid-argument"});
  await run("subir", upload);
  await run("subir", upload);
  assert.equal((await attentionRef.get()).get("fotosClinicas").length, 1);
  assert.equal((await run("leer")).imagen, imagen);
  await assert.rejects(run("leer", {fotoId: "foto-ajena"}), {code: "not-found"});

  const clientStorage = getStorage(app);
  connectStorageEmulator(clientStorage, "127.0.0.1", Number(storageHost.split(":")[1]));
  const objectPath = "negocios/" + businessId + "/atencionesVeterinarias/atencion-demo/fotos/" + photoId + ".jpg";
  await assert.rejects(getBytes(ref(clientStorage, objectPath)), {code: "storage/unauthorized"});
  const [metadata] = await bucket.file(objectPath).getMetadata();
  assert.equal(metadata.metadata.firebaseStorageDownloadTokens, undefined);

  const mark = {zona: "Pata trasera izquierda", nota: "Nota ficticia", x: 0.83, y: 0.73};
  await assert.rejects(run("mapear", {giro: 90, revision: 0, marcas: [{...mark, x: 2}]}), {code: "invalid-argument"});
  const result = await run("mapear", {giro: 90, revision: 0, marcas: [mark]});
  assert.equal(result.revision, 1);
  await assert.rejects(run("mapear", {giro: 0, revision: 0, marcas: []}), {code: "failed-precondition"});
  const photo = (await attentionRef.get()).get("fotosClinicas")[0];
  assert.equal(photo.giro, 90);
  assert.deepEqual(photo.marcas, [mark]);

  await attentionRef.update({fotosRetiradas: Array.from({length: 24}, (_, i) => ({fotoId: "retirada-" + i}))});
  await run("subir", {...upload, fotoId: "foto-equivocada"});
  await run("quitar", {fotoId: "foto-equivocada"});
  await run("quitar", {fotoId: "foto-equivocada"});
  assert.equal((await attentionRef.get()).get("fotosClinicas").length, 1);
  await assert.rejects(run("leer", {fotoId: "foto-equivocada"}), {code: "not-found"});
  await assert.rejects(run("subir", {...upload, fotoId: "foto-equivocada"}), {code: "failed-precondition"});
  assert.equal((await attentionRef.get()).get("fotosRetiradas").length, 24);
  await assert.rejects(run("subir", {...upload, fotoId: "retirada-0"}), {code: "failed-precondition"});
  await membership.update({rol: "TECNICO"});
  await assert.rejects(run("leer"), {code: "permission-denied"});
  await membership.update({rol: "ADMIN"});
  await attentionRef.update({estado: "finalizada"});
  assert.equal((await run("leer")).imagen, imagen);
  await assert.rejects(run("mapear", {giro: 180, revision: 1, marcas: []}), {code: "failed-precondition"});
  await assert.rejects(run("subir", {...upload, fotoId: "otra-foto"}), {code: "failed-precondition"});
  await assert.rejects(run("quitar"), {code: "failed-precondition"});
  console.log("VETERINARY_PHOTOS_SMOKE_OK");
} finally {
  await deleteApp(app);
  await adminApp.delete();
}
