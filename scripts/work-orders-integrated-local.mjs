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
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  terminate,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  const app = initializeApp({
    apiKey: "demo-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    appId: `work-orders-${name}-${RUN_ID}`,
  }, `work-orders-${name}-${RUN_ID}`);
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
    `work-orders-${label}-${RUN_ID}@example.test`,
    `WorkOrders-${RUN_ID}-Pass!`
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
    console.log(`OK Rules: ${label}`);
    return;
  }
  throw new Error(`Se esperaba denegación de Firestore: ${label}`);
}

function storedClient(businessId, clienteId, name) {
  return {
    clienteId,
    negocioId: businessId,
    nombreRazonSocial: name,
    estado: "activo",
  };
}

function storedVehicle(businessId, vehiculoId, clienteId, patente) {
  return {
    vehiculoId,
    negocioId: businessId,
    clienteId,
    patente,
    vin: null,
    marca: "Toyota",
    modelo: "Corolla",
    anio: 2020,
    color: "Blanco",
    tipo: "sedan",
  };
}

function workOrderReception({checklist: checklistOverrides = {}, ...overrides} = {}) {
  return {
    kilometraje: 45210,
    nivelCombustible: "1/2",
    checklist: {
      carroceriaPintura: "SIN_DANOS_VISIBLES",
      vidriosEspejos: "SIN_DANOS_VISIBLES",
      lucesOpticos: "SIN_DANOS_VISIBLES",
      neumaticosLlantas: "SIN_DANOS_VISIBLES",
      interior: "SIN_DANOS_VISIBLES",
      tableroIndicadores: "SIN_ALERTAS_VISIBLES",
      encendido: "NO_PROBADO",
      fugasVisibles: "NO_REVISADO",
      nivelesVisibles: "SIN_OBSERVACIONES",
      estadoGeneral: "SIN_OBSERVACIONES",
      ...checklistOverrides,
    },
    accesorios: ["Llave de rueda"],
    danosObservados: "Ninguno",
    observaciones: "Sin novedades visibles.",
    ...overrides,
  };
}

const owner = await authenticate(createClientApp("owner"), "owner");
const admin = await authenticate(createClientApp("admin"), "admin");
const technician = await authenticate(createClientApp("technician"), "technician");
const member = await authenticate(createClientApp("member"), "member");
const outsider = await authenticate(createClientApp("outsider"), "outsider");
const clients = [owner, admin, technician, member, outsider];
const adminApp = initializeAdminApp(
  {projectId: PROJECT_ID},
  `work-orders-admin-${RUN_ID}`
);
const adminDb = getAdminFirestore(adminApp);

try {
  const ownerBusiness = await callable(owner, "createFirstBusiness")({
    nombreComercial: "Taller OT principal",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-owner-${RUN_ID}`,
  });
  const businessId = ownerBusiness.data.business.id;
  const outsiderBusiness = await callable(outsider, "createFirstBusiness")({
    nombreComercial: "Taller OT externo",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-outsider-${RUN_ID}`,
  });
  const outsiderBusinessId = outsiderBusiness.data.business.id;

  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).update({
      monedaCodigo: "CLP",
      verificacionEmpresa: {estado: "VERIFICADA"},
    }),
    adminDb.doc(`negocios/${outsiderBusinessId}`).update({
      verificacionEmpresa: {estado: "VERIFICADA"},
    }),
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({
      negocioId: businessId,
      uid: admin.uid,
      rol: "ADMIN",
      estado: "activo",
    }),
    adminDb.doc(`membresias/${businessId}__${technician.uid}`).set({
      negocioId: businessId,
      uid: technician.uid,
      rol: "TECNICO",
      estado: "activo",
    }),
    adminDb.doc(`membresias/${businessId}__${member.uid}`).set({
      negocioId: businessId,
      uid: member.uid,
      rol: "MEMBER",
      estado: "activo",
    }),
    adminDb.doc(`negocios/${businessId}/clientes/cliente-a`).set(
      storedClient(businessId, "cliente-a", "Cliente A")
    ),
    adminDb.doc(`negocios/${businessId}/clientes/cliente-b`).set(
      storedClient(businessId, "cliente-b", "Cliente B")
    ),
    adminDb.doc(`negocios/${businessId}/clientes/cliente-inconsistente`).set(
      storedClient(outsiderBusinessId, "cliente-inconsistente", "Externo")
    ),
    adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-a`).set(
      storedVehicle(businessId, "vehiculo-a", "cliente-a", "ABCD12")
    ),
    adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-b`).set(
      storedVehicle(businessId, "vehiculo-b", "cliente-b", "EFGH34")
    ),
    adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-inconsistente`).set(
      storedVehicle(
        outsiderBusinessId,
        "vehiculo-inconsistente",
        "cliente-a",
        "IJKL56"
      )
    ),
    adminDb.doc(`negocios/${outsiderBusinessId}/clientes/cliente-externo`).set(
      storedClient(outsiderBusinessId, "cliente-externo", "Cliente externo")
    ),
    adminDb.doc(`negocios/${outsiderBusinessId}/vehiculos/vehiculo-externo`).set(
      storedVehicle(
        outsiderBusinessId,
        "vehiculo-externo",
        "cliente-externo",
        "MNOP78"
      )
    ),
  ]);

  const requestId = `work-order-create-${RUN_ID}`;
  const first = await callable(owner, "crearOrdenTrabajo")({
    businessId,
    requestId,
    ordenTrabajo: {vehiculoId: "vehiculo-a"},
  });
  assert.equal(first.data.sinCambios, false);
  assert.equal(first.data.ordenTrabajo.numeroOT, "OT-000001");
  assert.equal(first.data.ordenTrabajo.clienteId, "cliente-a");
  const otId = first.data.ordenTrabajo.otId;
  const orderPath = `negocios/${businessId}/ordenesTrabajo/${otId}`;
  const stored = (await adminDb.doc(orderPath).get()).data();
  assert.deepEqual(Object.keys(stored).sort(), [
    "actualizadoEn",
    "actualizadoPorUid",
    "clienteId",
    "creadoEn",
    "creadoPorUid",
    "estado",
    "estadoAprobacion",
    "moneda",
    "negocioId",
    "numeroOT",
    "otId",
    "plazaId",
    "recepcion",
    "vehiculoId",
  ]);
  assert.equal(stored.negocioId, businessId);
  assert.equal(stored.numeroOT, "OT-000001");
  assert.equal(stored.vehiculoId, "vehiculo-a");
  assert.equal(stored.clienteId, "cliente-a");
  assert.equal(stored.estado, "ingresada");
  assert.equal(stored.estadoAprobacion, "pendiente");
  assert.equal(stored.plazaId, null);
  assert.equal(stored.moneda, "CLP");
  assert.equal(stored.recepcion, null);
  assert.equal(stored.creadoPorUid, owner.uid);
  assert.equal(stored.actualizadoPorUid, owner.uid);
  assert.ok(stored.creadoEn?.toDate());
  assert.ok(stored.actualizadoEn?.toDate());
  console.log("OK creación OT: contrato inicial, autoría y timestamps autoritativos");

  await expectCallableError(
    "anomalía de recepción sin descripción",
    () => callable(owner, "registrarRecepcionOrdenTrabajo")({
      businessId,
      otId,
      recepcion: workOrderReception({
        checklist: {encendido: "NO_ENCIENDE"},
      }),
    }),
    ["invalid-argument"],
    /Describe los daños/i
  );
  await expectCallableError(
    "recepción sin checklist completa",
    () => callable(owner, "registrarRecepcionOrdenTrabajo")({
      businessId,
      otId,
      recepcion: workOrderReception({
        checklist: {interior: ""},
      }),
    }),
    ["invalid-argument"],
    /obligatorio/i
  );
  const registeredReception = await callable(owner, "registrarRecepcionOrdenTrabajo")({
    businessId,
    otId,
    recepcion: workOrderReception(),
  });
  assert.equal(registeredReception.data.ordenTrabajo.estado, "en_cola");
  const orderAfterReception = (await adminDb.doc(orderPath).get()).data();
  assert.equal(orderAfterReception.estado, "en_cola");
  assert.equal(orderAfterReception.recepcion.danosObservados, "Ninguno");
  assert.equal(orderAfterReception.recepcion.recibidoPorUid, owner.uid);
  assert.ok(orderAfterReception.recepcion.recibidoEn?.toDate());
  assert.equal(orderAfterReception.actualizadoPorUid, owner.uid);
  console.log("OK recepción OT: checklist completa, autoría backend y transición sin Plaza");

  const updatedReception = await callable(technician, "registrarRecepcionOrdenTrabajo")({
    businessId,
    otId,
    recepcion: workOrderReception({
      checklist: {carroceriaPintura: "CON_OBSERVACIONES"},
      danosObservados: "Rayón visible en puerta trasera.",
    }),
  });
  assert.equal(updatedReception.data.ordenTrabajo.estado, "en_cola");
  const orderAfterReceptionUpdate = (await adminDb.doc(orderPath).get()).data();
  assert.equal(orderAfterReceptionUpdate.recepcion.recibidoPorUid, owner.uid);
  assert.equal(orderAfterReceptionUpdate.recepcion.danosObservados, "Rayón visible en puerta trasera.");
  assert.equal(orderAfterReceptionUpdate.actualizadoPorUid, technician.uid);
  console.log("OK actualización recepción: rol operativo autorizado y autoría inicial preservada");

  const repeated = await callable(owner, "crearOrdenTrabajo")({
    businessId,
    requestId,
    ordenTrabajo: {vehiculoId: "vehiculo-a"},
  });
  assert.equal(repeated.data.sinCambios, true);
  assert.equal(repeated.data.ordenTrabajo.otId, otId);
  assert.equal(
    (await adminDb.collection(`negocios/${businessId}/ordenesTrabajo`).get()).size,
    1
  );
  await expectCallableError(
    "requestId reutilizado con otro vehículo",
    () => callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId,
      ordenTrabajo: {vehiculoId: "vehiculo-b"},
    }),
    ["already-exists"],
    /otros datos/i
  );
  console.log("OK idempotencia OT: el reintento no crea otra orden ni consume número");

  await adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-a`).update({
    clienteId: "cliente-b",
  });
  assert.equal((await adminDb.doc(orderPath).get()).data().clienteId, "cliente-a");
  const afterOwnerChange = await callable(admin, "crearOrdenTrabajo")({
    businessId,
    requestId: `work-order-new-owner-${RUN_ID}`,
    ordenTrabajo: {vehiculoId: "vehiculo-a"},
  });
  assert.equal(afterOwnerChange.data.ordenTrabajo.numeroOT, "OT-000002");
  assert.equal(afterOwnerChange.data.ordenTrabajo.clienteId, "cliente-b");
  assert.equal((await adminDb.doc(orderPath).get()).data().clienteId, "cliente-a");
  await adminDb.doc(`negocios/${businessId}/ordenesTrabajo/${afterOwnerChange.data.ordenTrabajo.otId}`).update({
    plazaId: "plaza-prueba",
  });
  const receptionWithPlaza = await callable(admin, "registrarRecepcionOrdenTrabajo")({
    businessId,
    otId: afterOwnerChange.data.ordenTrabajo.otId,
    recepcion: workOrderReception(),
  });
  assert.equal(receptionWithPlaza.data.ordenTrabajo.estado, "en_diagnostico");
  console.log("OK transición recepción: una OT con Plaza pasa a diagnóstico");
  console.log("OK Cliente histórico: cada OT congela el propietario vigente al crear");

  const concurrent = await Promise.all([
    callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-concurrent-owner-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-a"},
    }),
    callable(admin, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-concurrent-admin-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-b"},
    }),
  ]);
  assert.deepEqual(
    concurrent.map((result) => result.data.ordenTrabajo.numeroOT).sort(),
    ["OT-000003", "OT-000004"]
  );
  assert.equal(
    new Set(concurrent.map((result) => result.data.ordenTrabajo.numeroOT)).size,
    2
  );
  assert.equal(
    (await adminDb.doc(`negocios/${businessId}/otCounters/global`).get()).data().lastNumber,
    4
  );
  console.log("OK concurrencia OT: el contador entrega números únicos e incrementales");

  await expectCallableError(
    "frontend intenta fijar numeroOT y estado",
    () => callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-protected-${RUN_ID}`,
      ordenTrabajo: {
        vehiculoId: "vehiculo-b",
        numeroOT: "OT-999999",
        estado: "cerrada",
      },
    }),
    ["invalid-argument"],
    /no está admitido/i
  );
  await expectCallableError(
    "vehículo inexistente",
    () => callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-missing-vehicle-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-inexistente"},
    }),
    ["not-found"]
  );
  await expectCallableError(
    "vehículo con negocioId inconsistente",
    () => callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-cross-vehicle-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-inconsistente"},
    }),
    ["failed-precondition"],
    /no pertenece al negocio/i
  );
  await adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-b`).update({
    clienteId: "cliente-inconsistente",
  });
  await expectCallableError(
    "Cliente del vehículo pertenece a otro negocio",
    () => callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-cross-client-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-b"},
    }),
    ["failed-precondition"],
    /propietario actual no pertenece/i
  );
  await expectCallableError(
    "TECNICO no crea OT",
    () => callable(technician, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-technician-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-a"},
    }),
    ["permission-denied"]
  );
  await expectCallableError(
    "MEMBER no crea OT",
    () => callable(member, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-member-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-a"},
    }),
    ["permission-denied"]
  );
  await expectCallableError(
    "usuario sin membresía manipula businessId",
    () => callable(outsider, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-outsider-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-a"},
    }),
    ["permission-denied"]
  );
  await expectCallableError(
    "usuario sin membresía registra recepción",
    () => callable(outsider, "registrarRecepcionOrdenTrabajo")({
      businessId,
      otId,
      recepcion: workOrderReception(),
    }),
    ["permission-denied"]
  );

  const outsiderOrder = await callable(outsider, "crearOrdenTrabajo")({
    businessId: outsiderBusinessId,
    requestId: `work-order-outsider-own-${RUN_ID}`,
    ordenTrabajo: {vehiculoId: "vehiculo-externo"},
  });
  assert.equal(outsiderOrder.data.ordenTrabajo.numeroOT, "OT-000001");
  console.log("OK aislamiento OT: correlativo e idempotencia son por negocio");

  assert.ok((await getDoc(doc(technician.db, orderPath))).exists());
  const listed = await getDocs(query(
    collection(technician.db, `negocios/${businessId}/ordenesTrabajo`),
    where("negocioId", "==", businessId)
  ));
  assert.equal(listed.size, 4);
  console.log("OK lectura OT: listado filtrado autorizado para Taller");
  await expectFirestoreDenied(
    "otro negocio no puede leer la OT",
    () => getDoc(doc(outsider.db, orderPath))
  );
  await expectFirestoreDenied(
    "consulta OT sin filtro de negocioId",
    () => getDocs(collection(owner.db, `negocios/${businessId}/ordenesTrabajo`))
  );
  await expectFirestoreDenied(
    "SDK cliente no puede crear OT",
    () => setDoc(doc(owner.db, `negocios/${businessId}/ordenesTrabajo/directa`), {
      otId: "directa",
      negocioId: businessId,
      numeroOT: "OT-999999",
    })
  );
  await expectFirestoreDenied(
    "SDK cliente no puede leer contador OT",
    () => getDoc(doc(owner.db, `negocios/${businessId}/otCounters/global`))
  );
  await expectFirestoreDenied(
    "SDK cliente no puede leer idempotencia OT",
    () => getDoc(doc(owner.db, `negocios/${businessId}/otCreateRequests/${requestId}`))
  );
  console.log("WORK_ORDERS_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
