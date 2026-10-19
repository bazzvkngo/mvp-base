import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

// Reglas de negocios/{id}/notificaciones con emuladores. La campana
// (notificationService.js) escucha esa colección con onSnapshot. La regla de
// lectura exige OWNER y resource.data.negocioId == businessId; Firestore
// rechaza con permission-denied toda consulta que no pueda garantizar esa
// condición. Esta prueba deja documentado el motivo del error "Missing or
// insufficient permissions" y comprueba la consulta corregida.

const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const {initializeApp: initAdmin, deleteApp: deleteAdmin} =
  requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore, Timestamp} =
  requireFromFunctions("firebase-admin/firestore");

const PROJECT_ID = "tesis-inventario-ia";

async function client(label) {
  const app = initializeApp({
    apiKey: "demo-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
  }, `notification-rules-${label}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const credential = await signInAnonymously(auth);
  return {app, db, uid: credential.user.uid};
}

// Misma consulta que notificationsQuery() de notificationService.js (ese
// módulo importa firebaseConfig y no se puede cargar aquí; el smoke
// notification-bell-smoke verifica su fuente).
const currentQuery = (db, businessId, filterBusinessId = businessId) =>
  query(
    collection(db, "negocios", businessId, "notificaciones"),
    where("negocioId", "==", filterBusinessId),
    orderBy("creadoEn", "desc")
  );
// Consulta anterior, sin filtro por negocioId.
const legacyQuery = (db, businessId) =>
  query(
    collection(db, "negocios", businessId, "notificaciones"),
    orderBy("creadoEn", "desc")
  );

// Primer snapshot del servidor o el error del listener, como lo vería el hook.
function listen(queryRef) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onSnapshot(
      queryRef,
      {includeMetadataChanges: true},
      (snapshot) => {
        if (snapshot.metadata.fromCache) return;
        unsubscribe();
        resolve(snapshot.docs.map((item) => ({id: item.id, ...item.data()})));
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );
  });
}

async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    if (String(error?.code || "").includes("permission-denied")) {
      console.log(`OK denegado: ${label}`);
      return;
    }
    throw error;
  }
  throw new Error(`Se esperaba permission-denied: ${label}`);
}

const adminApp = initAdmin({projectId: PROJECT_ID}, "notification-rules-admin");
const adminDb = getAdminFirestore(adminApp);

const owner = await client("owner");
const admin = await client("admin");
const outsider = await client("outsider");

const businessId = "notification-rules-business";
const otherBusinessId = "notification-rules-other";

try {
  const seedBusiness = (id) => adminDb.doc(`negocios/${id}`).set({
    estado: "activo",
    verificacionEmpresa: {estado: "VERIFICADA"},
  });
  const seedMember = (id, uid, rol) => Promise.all([
    adminDb.doc(`usuarios/${uid}`).set({negocioActivoId: id, estadoPlataforma: "activo"}),
    adminDb.doc(`membresias/${id}__${uid}`).set({negocioId: id, uid, rol, estado: "activo"}),
  ]);
  const notification = (id, negocioId, day, extra = {}) =>
    adminDb.doc(`negocios/${businessId}/notificaciones/${id}`).set({
      notificacionId: id,
      tipo: "VERIFICACION_APROBADA",
      titulo: `Aviso ${id}`,
      leida: false,
      creadoEn: Timestamp.fromDate(new Date(`2026-10-${day}T10:00:00Z`)),
      ...(negocioId ? {negocioId} : {}),
      ...extra,
    });

  await Promise.all([
    seedBusiness(businessId),
    seedBusiness(otherBusinessId),
    seedMember(businessId, owner.uid, "OWNER"),
    seedMember(businessId, admin.uid, "ADMIN"),
    seedMember(otherBusinessId, outsider.uid, "OWNER"),
    notification("n-viejo", businessId, "10"),
    notification("n-nuevo", businessId, "15"),
    // Documento sin negocioId: la regla no lo deja leer y la consulta
    // corregida no lo devuelve (ver propuesta en el informe).
    notification("n-sin-negocio", null, "12"),
  ]);

  // 1. OWNER con la consulta corregida: sin error, solo los suyos, por fecha.
  const ownerItems = await listen(currentQuery(owner.db, businessId));
  assert.deepEqual(
    ownerItems.map((item) => item.id),
    ["n-nuevo", "n-viejo"],
    "OWNER: devuelve sus notificaciones con negocioId, de la más reciente a la más antigua"
  );
  console.log("OK permitido: OWNER con where(negocioId) + orderBy(creadoEn)");

  // 2. La consulta anterior (sin filtro) falla aun siendo OWNER: la regla
  // exige negocioId y la consulta no lo garantiza.
  await expectDenied("OWNER con la consulta anterior, sin filtro por negocioId", () =>
    listen(legacyQuery(owner.db, businessId))
  );

  // 3. Otro rol del mismo negocio no puede leer, ni con la consulta correcta.
  await expectDenied("ADMIN del negocio con la consulta corregida", () =>
    listen(currentQuery(admin.db, businessId))
  );

  // 4. Usuario de otro negocio: ni filtrando por el negocio ajeno ni por el suyo.
  await expectDenied("OWNER de otro negocio, filtrando por el negocio ajeno", () =>
    listen(currentQuery(outsider.db, businessId))
  );
  await expectDenied("OWNER de otro negocio, filtrando por su propio negocioId", () =>
    listen(currentQuery(outsider.db, businessId, otherBusinessId))
  );

  console.log("NOTIFICATION_RULES_SMOKE_OK");
} finally {
  await Promise.allSettled([
    deleteApp(owner.app),
    deleteApp(admin.app),
    deleteApp(outsider.app),
    deleteAdmin(adminApp),
  ]);
}
