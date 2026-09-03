import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  documentId,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  terminate,
  where,
} from "firebase/firestore";

// Prueba de integración de ETAPA 2 (REPORTES_RENTABILIDAD_V4) contra Firebase
// Emulator Suite exclusivamente. Reproduce la MISMA forma de consulta que
// fetchSalesPageFromFirestore en src/services/reportProfitabilityV4Service.js
// (negocioId ==, fechaVenta rango, orderBy fechaVenta desc + documentId desc,
// limit, startAfter) usando un cliente propio conectado al emulador, siguiendo
// el mismo patrón que scripts/sales-integrated-local.mjs. No se importa
// src/firebase/firebaseConfig.js: bajo `node` puro (sin Vite) esa configuración
// resuelve a modo "production" y no debe arriesgarse a tocar Firebase real.

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function createClient(name) {
  const app = initializeApp({
    apiKey: "demo-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    appId: `rv4-${name}-${RUN_ID}`,
  }, `rv4-${name}-${RUN_ID}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  return {app, auth, db};
}

async function authenticate(client, label) {
  const credential = await createUserWithEmailAndPassword(
    client.auth,
    `rv4-${label}-${RUN_ID}@example.test`,
    `Rv4-${RUN_ID}-Pass!`
  );
  client.uid = credential.user.uid;
  return client;
}

// Copia fiel de la forma de consulta implementada en fetchSalesPageFromFirestore.
async function querySalesPage(clientDb, businessId, {from, to, cursor, pageSize}) {
  const constraints = [
    where("negocioId", "==", businessId),
    where("fechaVenta", ">=", from),
    where("fechaVenta", "<=", to),
    orderBy("fechaVenta", "desc"),
    orderBy(documentId(), "desc"),
    limit(pageSize + 1),
  ];
  if (cursor) constraints.push(startAfter(cursor.fechaVenta, cursor.id));
  const snapshot = await getDocs(query(collection(clientDb, "negocios", businessId, "ventas"), ...constraints));
  const docs = snapshot.docs.slice(0, pageSize);
  const hasMore = snapshot.docs.length > pageSize;
  const last = docs[docs.length - 1];
  return {
    docs,
    hasMore,
    nextCursor: hasMore && last ? {fechaVenta: last.get("fechaVenta"), id: last.id} : null,
  };
}

const owner = await authenticate(createClient("owner"), "owner");
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `rv4-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

const businessId = `biz-a-${RUN_ID}`;
const otherBusinessId = `biz-b-${RUN_ID}`;

try {
  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).set({estado: "activo", verificacionEmpresa: {estado: "VERIFICADA"}}),
    adminDb.doc(`negocios/${otherBusinessId}`).set({estado: "activo", verificacionEmpresa: {estado: "VERIFICADA"}}),
    adminDb.doc(`membresias/${businessId}__${owner.uid}`).set({negocioId: businessId, uid: owner.uid, rol: "OWNER", estado: "activo"}),
  ]);

  const saleDoc = (id, overrides = {}) => ({
    negocioId: businessId,
    estado: "confirmada",
    moneda: "CLP",
    neto: 1000,
    fechaVenta: "2026-06-10",
    trabajoId: "",
    items: [],
    efectosInventario: [],
    ...overrides,
  });

  // Rango de la consulta: 2026-06-01..2026-06-10.
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/ventas/venta-01-${RUN_ID}`).set(saleDoc(`venta-01-${RUN_ID}`, {fechaVenta: "2026-06-10"})),
    adminDb.doc(`negocios/${businessId}/ventas/venta-02-${RUN_ID}`).set(saleDoc(`venta-02-${RUN_ID}`, {fechaVenta: "2026-06-08"})),
    // Dos ventas con la MISMA fechaVenta: prueban el desempate por documentId (caso 7).
    adminDb.doc(`negocios/${businessId}/ventas/venta-03a-${RUN_ID}`).set(saleDoc(`venta-03a-${RUN_ID}`, {fechaVenta: "2026-06-05"})),
    adminDb.doc(`negocios/${businessId}/ventas/venta-03b-${RUN_ID}`).set(saleDoc(`venta-03b-${RUN_ID}`, {fechaVenta: "2026-06-05"})),
    // Venta de forma legacy: sin efectosInventario ni trabajoId, alias de estado confirmado.
    adminDb.doc(`negocios/${businessId}/ventas/venta-legacy-${RUN_ID}`).set({
      negocioId: businessId,
      estado: "activo",
      moneda: "CLP",
      neto: 500,
      fechaVenta: "2026-06-02",
    }),
    // Fuera del rango consultado: no debe aparecer.
    adminDb.doc(`negocios/${businessId}/ventas/venta-fuera-rango-${RUN_ID}`).set(saleDoc(`venta-fuera-rango-${RUN_ID}`, {fechaVenta: "2026-05-01"})),
    // Venta en el otro negocio: prueba de aislamiento cross-tenant.
    adminDb.doc(`negocios/${otherBusinessId}/ventas/venta-otro-${RUN_ID}`).set({
      negocioId: otherBusinessId,
      estado: "confirmada",
      moneda: "CLP",
      neto: 700,
      fechaVenta: "2026-06-05",
    }),
  ]);

  const from = "2026-06-01";
  const to = "2026-06-10";

  // Caso 19/20: la consulta compuesta (negocioId == + fechaVenta rango + orderBy
  // fechaVenta desc + orderBy documentId desc) se valida contra Emulator Suite.
  const page1 = await querySalesPage(owner.db, businessId, {from, to, cursor: null, pageSize: 2});
  assert.equal(page1.docs.length, 2, "primera página debe respetar pageSize");
  assert.equal(page1.hasMore, true);
  assert.equal(page1.docs[0].id, `venta-01-${RUN_ID}`);
  assert.equal(page1.docs[1].id, `venta-02-${RUN_ID}`);
  console.log("OK caso 19: la consulta compuesta se ejecutó en Emulator Suite sin error");
  console.log("OK caso 5: primera página real respeta pageSize y orden fechaVenta DESC");

  const page2 = await querySalesPage(owner.db, businessId, {from, to, cursor: page1.nextCursor, pageSize: 2});
  assert.equal(page2.docs.length, 2);
  // Mismo fechaVenta (2026-06-05): el desempate por documentId DESC debe ser estable.
  const sameDateIds = [`venta-03a-${RUN_ID}`, `venta-03b-${RUN_ID}`].sort().reverse();
  assert.deepEqual(page2.docs.map((entry) => entry.id), sameDateIds);
  console.log("OK caso 6: segunda página continúa desde el cursor sin perder ni repetir filas");
  console.log("OK caso 7: múltiples ventas con la misma fechaVenta se ordenan de forma estable por documentId");

  const page3 = await querySalesPage(owner.db, businessId, {from, to, cursor: page2.nextCursor, pageSize: 2});
  assert.equal(page3.docs.length, 1, "sólo la venta legacy queda dentro del rango en la última página");
  assert.equal(page3.docs[0].id, `venta-legacy-${RUN_ID}`);
  assert.equal(page3.hasMore, false);
  console.log("OK caso 12: la venta legacy (sin efectosInventario/trabajoId) se conserva en el universo del reporte");

  // Determinismo: repetir la primera página produce exactamente el mismo resultado.
  const page1Again = await querySalesPage(owner.db, businessId, {from, to, cursor: null, pageSize: 2});
  assert.deepEqual(page1Again.docs.map((entry) => entry.id), page1.docs.map((entry) => entry.id));
  console.log("OK caso 8: la consulta real es determinista ante la misma entrada");

  // Caso 13: aislamiento por negocio. El owner no tiene membresía en otherBusinessId:
  // Rules debe denegar la lectura, no sólo el filtro negocioId de la consulta.
  await assert.rejects(
    () => querySalesPage(owner.db, otherBusinessId, {from, to, cursor: null, pageSize: 10}),
    (error) => {
      assert.match(String(error?.code || ""), /permission-denied/);
      return true;
    }
  );
  console.log("OK caso 13: Rules deniega la lectura cross-tenant; el aislamiento no depende sólo del filtro negocioId");

  console.log("REPORT_PROFITABILITY_V4_STAGE2_INTEGRATED_OK");
} finally {
  await terminate(owner.db).catch(() => {});
  await deleteApp(owner.app).catch(() => {});
  await deleteAdminApp(adminApp).catch(() => {});
}
