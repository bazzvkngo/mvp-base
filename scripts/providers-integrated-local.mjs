import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  terminate,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  buildProviderMutationPayload,
  getProviderRutKey,
  normalizeProviderRut,
} from "../src/domain/providerModel.mjs";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const {
  deleteApp: deleteAdminApp,
  initializeApp: initializeAdminApp,
} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions(
  "firebase-admin/firestore"
);

function createClientApp(name) {
  const app = initializeApp(
    {
      apiKey: "demo-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      appId: `providers-${name}-${RUN_ID}`,
    },
    `providers-${name}-${RUN_ID}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {app, auth, db, functions};
}

async function authenticate(client, label) {
  const credential = await createUserWithEmailAndPassword(
    client.auth,
    `providers-${label}-${RUN_ID}@example.test`,
    `Providers-${RUN_ID}-Pass!`
  );
  client.uid = credential.user.uid;
  return client;
}

function callable(client, name) {
  return httpsCallable(client.functions, name);
}

async function expectCallableError(label, operation, codes, messagePattern) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    assert.ok(
      codes.some((expected) => code.includes(expected)),
      `${label}: código inesperado ${code}`
    );
    if (messagePattern) assert.match(String(error?.message || ""), messagePattern);
    console.log(`OK rechazo: ${label}`);
    return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

async function expectFirestoreDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    assert.match(String(error?.code || ""), /permission-denied/);
    console.log(`OK reglas: ${label}`);
    return;
  }
  throw new Error(`Se esperaba denegación de Firestore: ${label}`);
}

function providerPayload({rut, razonSocial}) {
  return buildProviderMutationPayload({
    rut,
    razonSocial,
    nombreFantasia: `${razonSocial} Comercial`,
    giro: "Suministros empresariales",
    personaContacto: "Contacto de prueba",
    email: `${razonSocial.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test`,
    telefono: "+56 9 1234 5678",
    direccion: "Av. Principal 123",
    regionCodigo: "13",
    regionNombre: "Metropolitana de Santiago",
    comunaCodigo: "13101",
    comunaNombre: "Santiago",
    condicionesPago: "credito",
    diasCredito: 30,
    notas: "Creado por smoke integrado",
  });
}

function createProvider(client, businessId, requestId, proveedor) {
  return callable(client, "crearProveedor")({
    businessId,
    requestId,
    proveedor,
  });
}

function updateTimeMillis(snapshot) {
  return snapshot.updateTime?.toMillis?.() || 0;
}

const owner = await authenticate(createClientApp("owner"), "owner");
const admin = await authenticate(createClientApp("admin"), "admin");
const member = await authenticate(createClientApp("member"), "member");
const outsider = await authenticate(createClientApp("outsider"), "outsider");
const clients = [owner, admin, member, outsider];
const adminApp = initializeAdminApp(
  {projectId: PROJECT_ID},
  `providers-admin-${RUN_ID}`
);
const adminDb = getAdminFirestore(adminApp);

try {
  const ownerBusinessResponse = await callable(owner, "createFirstBusiness")({
    nombreComercial: "Negocio proveedores principal",
    rubroCodigo: "SERVICIOS_PROFESIONALES",
    regionCodigo: "13",
    requestId: `business-owner-${RUN_ID}`,
  });
  const businessId = ownerBusinessResponse.data.business.id;
  const outsiderBusinessResponse = await callable(outsider, "createFirstBusiness")({
    nombreComercial: "Negocio proveedores externo",
    rubroCodigo: "SERVICIOS_PROFESIONALES",
    regionCodigo: "13",
    requestId: `business-outsider-${RUN_ID}`,
  });
  const outsiderBusinessId = outsiderBusinessResponse.data.business.id;

  await Promise.all([
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({
      negocioId: businessId,
      uid: admin.uid,
      rol: "ADMIN",
      estado: "activo",
    }),
    adminDb.doc(`membresias/${businessId}__${member.uid}`).set({
      negocioId: businessId,
      uid: member.uid,
      rol: "MEMBER",
      estado: "activo",
    }),
  ]);

  const ownerData = providerPayload({
    rut: "12.345.678-5",
    razonSocial: "Proveedor Owner",
  });
  ownerData.regionNombre = "Región manipulada";
  ownerData.comunaNombre = "Comuna manipulada";
  ownerData.proveedorId = "proveedor-manipulado";
  ownerData.negocioId = outsiderBusinessId;
  ownerData.rutNormalizado = "00000000-0";
  ownerData.estado = "archivado";
  ownerData.creadoPorUid = outsider.uid;
  const ownerRequestId = `owner-create-${RUN_ID}`;
  const ownerCreate = await createProvider(
    owner,
    businessId,
    ownerRequestId,
    ownerData
  );
  const ownerProviderId = ownerCreate.data.proveedor.proveedorId;
  assert.ok(ownerProviderId);
  const ownerProviderPath =
    `negocios/${businessId}/proveedores/${ownerProviderId}`;
  const storedOwner = (await adminDb.doc(ownerProviderPath).get()).data();
  assert.equal(storedOwner.proveedorId, ownerProviderId);
  assert.equal(Object.hasOwn(storedOwner, "supplierId"), false);
  assert.equal(storedOwner.negocioId, businessId);
  assert.equal(storedOwner.estado, "activo");
  assert.equal(storedOwner.creadoPorUid, owner.uid);
  assert.equal(storedOwner.regionNombre, "Metropolitana de Santiago");
  assert.equal(storedOwner.comunaNombre, "Santiago");
  console.log("OK creación: OWNER crea con territorio y autoridad backend");

  const clientWithSameRut = await callable(owner, "crearCliente")({
    businessId,
    cliente: {
      tipoCliente: "empresa",
      rut: ownerData.rut,
      nombreRazonSocial: "Cliente con RUT de proveedor",
      giro: "Servicios",
      email: "cliente.mismo.rut@example.test",
      telefono: "+56 9 2222 3333",
      direccion: "Av. Cliente 456",
      regionCodigo: "13",
      regionNombre: "Metropolitana de Santiago",
      comunaCodigo: "13101",
      comunaNombre: "Santiago",
      personaContacto: "Contacto cliente",
      notas: "Dominio independiente",
    },
  });
  assert.ok(clientWithSameRut.data.cliente.clienteId);
  console.log("OK dominios: cliente y proveedor comparten RUT en el mismo negocio");

  const repeatedCreate = await createProvider(
    owner,
    businessId,
    ownerRequestId,
    ownerData
  );
  assert.equal(repeatedCreate.data.proveedor.proveedorId, ownerProviderId);
  assert.equal(repeatedCreate.data.sinCambios, true);
  const ownerRutQuery = await adminDb
    .collection(`negocios/${businessId}/proveedores`)
    .where("rutNormalizado", "==", normalizeProviderRut(ownerData.rut))
    .get();
  assert.equal(ownerRutQuery.size, 1);
  console.log("OK idempotencia: reintento conserva el mismo proveedor");

  const adminData = providerPayload({
    rut: "77.091.679-8",
    razonSocial: "Proveedor Admin",
  });
  const adminCreate = await createProvider(
    admin,
    businessId,
    `admin-create-${RUN_ID}`,
    adminData
  );
  const adminProviderId = adminCreate.data.proveedor.proveedorId;
  assert.ok(adminProviderId);
  console.log("OK creación: ADMIN crea proveedor");

  await expectCallableError(
    "MEMBER no puede crear",
    () => createProvider(
      member,
      businessId,
      `member-create-${RUN_ID}`,
      providerPayload({rut: "11.111.111-1", razonSocial: "Proveedor Member"})
    ),
    ["permission-denied"]
  );
  await expectCallableError(
    "negocioActivoId no reemplaza membresía",
    () => createProvider(
      outsider,
      businessId,
      `outsider-create-${RUN_ID}`,
      providerPayload({rut: "11.111.111-1", razonSocial: "Proveedor Externo"})
    ),
    ["permission-denied"]
  );

  assert.ok((await getDoc(doc(member.db, ownerProviderPath))).exists());
  const memberQuery = await getDocs(query(
    collection(member.db, `negocios/${businessId}/proveedores`),
    where("negocioId", "==", businessId)
  ));
  assert.ok(memberQuery.size >= 2);
  console.log("OK lectura: MEMBER consulta proveedores del negocio");
  await expectFirestoreDenied(
    "otro negocio no lee proveedor",
    () => getDoc(doc(outsider.db, ownerProviderPath))
  );

  await expectCallableError(
    "RUT duplicado dentro del negocio",
    () => createProvider(
      admin,
      businessId,
      `duplicate-${RUN_ID}`,
      {...ownerData, razonSocial: "Proveedor Duplicado"}
    ),
    ["already-exists"]
  );

  const concurrentRut = "22.222.222-2";
  const concurrentResults = await Promise.allSettled([
    createProvider(
      owner,
      businessId,
      `concurrent-owner-${RUN_ID}`,
      providerPayload({rut: concurrentRut, razonSocial: "Concurrente Uno"})
    ),
    createProvider(
      admin,
      businessId,
      `concurrent-admin-${RUN_ID}`,
      providerPayload({rut: concurrentRut, razonSocial: "Concurrente Dos"})
    ),
  ]);
  assert.equal(concurrentResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrentResults.filter((result) => result.status === "rejected").length, 1);
  console.log("OK concurrencia: una sola creación reserva el RUT");

  const externalSameRut = await createProvider(
    outsider,
    outsiderBusinessId,
    `external-same-rut-${RUN_ID}`,
    providerPayload({rut: ownerData.rut, razonSocial: "Proveedor Otro Negocio"})
  );
  assert.notEqual(externalSameRut.data.proveedor.proveedorId, ownerProviderId);
  console.log("OK multiempresa: el mismo RUT existe en otro negocio");

  await expectCallableError(
    "otro negocio no modifica proveedor",
    () => callable(outsider, "actualizarProveedor")({
      businessId,
      proveedorId: ownerProviderId,
      proveedor: ownerData,
    }),
    ["permission-denied"]
  );

  const ownerRutKey = getProviderRutKey(ownerData.rut);
  const ownerReservationPath =
    `negocios/${businessId}/providerRutKeys/${ownerRutKey}`;
  const reservationBeforeSameRut = await adminDb.doc(ownerReservationPath).get();
  await callable(owner, "actualizarProveedor")({
    businessId,
    proveedorId: ownerProviderId,
    proveedor: {...ownerData, razonSocial: "Proveedor Owner Editado"},
  });
  const reservationAfterSameRut = await adminDb.doc(ownerReservationPath).get();
  assert.equal(
    reservationAfterSameRut.createTime.toMillis(),
    reservationBeforeSameRut.createTime.toMillis()
  );
  assert.equal(
    (await adminDb.doc(ownerProviderPath).get()).data().razonSocial,
    "Proveedor Owner Editado"
  );
  console.log("OK edición: RUT sin cambios conserva la reserva");

  const changedRut = "11.111.111-1";
  const changedRutKey = getProviderRutKey(changedRut);
  await callable(owner, "actualizarProveedor")({
    businessId,
    proveedorId: ownerProviderId,
    proveedor: {...ownerData, rut: changedRut},
  });
  assert.equal((await adminDb.doc(ownerReservationPath).get()).exists, false);
  assert.equal(
    (await adminDb.doc(`negocios/${businessId}/providerRutKeys/${changedRutKey}`).get()).data().proveedorId,
    ownerProviderId
  );
  const releasedRutCreate = await createProvider(
    owner,
    businessId,
    `released-rut-${RUN_ID}`,
    providerPayload({rut: ownerData.rut, razonSocial: "Proveedor RUT Liberado"})
  );
  assert.notEqual(releasedRutCreate.data.proveedor.proveedorId, ownerProviderId);
  console.log("OK edición: cambia RUT y libera el anterior atómicamente");

  const adminRutKey = getProviderRutKey(adminData.rut);
  const adminReservationPath =
    `negocios/${businessId}/providerRutKeys/${adminRutKey}`;
  const firstArchive = await callable(admin, "archivarProveedor")({
    businessId,
    proveedorId: adminProviderId,
  });
  assert.equal(firstArchive.data.sinCambios, false);
  assert.equal((await adminDb.doc(adminReservationPath).get()).data().estadoProveedor, "archivado");
  const archivedSnapshot = await adminDb
    .doc(`negocios/${businessId}/proveedores/${adminProviderId}`)
    .get();
  const secondArchive = await callable(admin, "archivarProveedor")({
    businessId,
    proveedorId: adminProviderId,
  });
  assert.equal(secondArchive.data.sinCambios, true);
  assert.equal(
    updateTimeMillis(await adminDb.doc(`negocios/${businessId}/proveedores/${adminProviderId}`).get()),
    updateTimeMillis(archivedSnapshot)
  );
  console.log("OK archivo: mantiene reserva y el reintento es idempotente");

  await expectCallableError(
    "RUT archivado exige reactivación",
    () => createProvider(
      owner,
      businessId,
      `archived-rut-${RUN_ID}`,
      {...adminData, razonSocial: "No debe crearse"}
    ),
    ["failed-precondition"],
    /reactivarlo/i
  );

  const firstReactivation = await callable(admin, "reactivarProveedor")({
    businessId,
    proveedorId: adminProviderId,
  });
  assert.equal(firstReactivation.data.sinCambios, false);
  const activeSnapshot = await adminDb
    .doc(`negocios/${businessId}/proveedores/${adminProviderId}`)
    .get();
  const secondReactivation = await callable(admin, "reactivarProveedor")({
    businessId,
    proveedorId: adminProviderId,
  });
  assert.equal(secondReactivation.data.sinCambios, true);
  assert.equal(
    updateTimeMillis(await adminDb.doc(`negocios/${businessId}/proveedores/${adminProviderId}`).get()),
    updateTimeMillis(activeSnapshot)
  );
  console.log("OK reactivación: reutiliza reserva y es idempotente");

  await expectFirestoreDenied(
    "creación directa de proveedor bloqueada",
    () => setDoc(doc(owner.db, `negocios/${businessId}/proveedores/directo`), {
      proveedorId: "directo",
      negocioId: businessId,
      rut: "9.000.000-4",
    })
  );
  await expectFirestoreDenied(
    "actualización directa de proveedor bloqueada",
    () => updateDoc(doc(owner.db, ownerProviderPath), {razonSocial: "Manipulado"})
  );
  await expectFirestoreDenied(
    "eliminación directa de proveedor bloqueada",
    () => deleteDoc(doc(owner.db, ownerProviderPath))
  );
  await expectFirestoreDenied(
    "providerRutKeys bloquea lectura",
    () => getDoc(doc(owner.db, adminReservationPath))
  );
  await expectFirestoreDenied(
    "providerRutKeys bloquea listado",
    () => getDocs(collection(owner.db, `negocios/${businessId}/providerRutKeys`))
  );
  await expectFirestoreDenied(
    "providerRutKeys bloquea collectionGroup",
    () => getDocs(collectionGroup(owner.db, "providerRutKeys"))
  );
  await expectFirestoreDenied(
    "providerRutKeys bloquea escritura",
    () => setDoc(doc(owner.db, `negocios/${businessId}/providerRutKeys/90000004`), {})
  );
  await expectFirestoreDenied(
    "providerCreateRequests es interna",
    () => getDocs(collection(owner.db, `negocios/${businessId}/providerCreateRequests`))
  );

  console.log("PROVIDERS_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
