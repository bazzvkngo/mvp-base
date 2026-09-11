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
    appId: `vehicles-${name}-${RUN_ID}`,
  }, `vehicles-${name}-${RUN_ID}`);
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
    `vehicles-${label}-${RUN_ID}@example.test`,
    `Vehicles-${RUN_ID}-Pass!`
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

function vehiclePayload(overrides = {}) {
  return {
    clienteId: "cliente-a",
    patente: "AB-CD 12",
    vin: "1HG CM826 33A004352",
    marca: "Toyota",
    modelo: "Corolla",
    anio: 2021,
    color: "Azul",
    tipo: "sedan",
    ...overrides,
  };
}

function storedClient(businessId, clienteId, name) {
  return {
    clienteId,
    negocioId: businessId,
    nombreRazonSocial: name,
    estado: "activo",
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
  `vehicles-admin-${RUN_ID}`
);
const adminDb = getAdminFirestore(adminApp);

try {
  const ownerBusiness = await callable(owner, "createFirstBusiness")({
    nombreComercial: "Taller vehículos principal",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-owner-${RUN_ID}`,
  });
  const businessId = ownerBusiness.data.business.id;
  const outsiderBusiness = await callable(outsider, "createFirstBusiness")({
    nombreComercial: "Taller vehículos externo",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-outsider-${RUN_ID}`,
  });
  const outsiderBusinessId = outsiderBusiness.data.business.id;

  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).update({
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
      storedClient(outsiderBusinessId, "cliente-inconsistente", "Otro negocio")
    ),
    adminDb.doc(`negocios/${outsiderBusinessId}/clientes/cliente-externo`).set(
      storedClient(outsiderBusinessId, "cliente-externo", "Cliente externo")
    ),
  ]);

  const requestId = `vehicle-create-${RUN_ID}`;
  const firstCreate = await callable(owner, "crearVehiculo")({
    businessId,
    requestId,
    vehiculo: vehiclePayload(),
  });
  const vehiculoId = firstCreate.data.vehiculo.vehiculoId;
  assert.ok(vehiculoId);
  assert.equal(firstCreate.data.sinCambios, false);
  assert.equal(firstCreate.data.vehiculo.patente, "ABCD12");
  assert.equal(firstCreate.data.vehiculo.vin, "1HGCM82633A004352");

  const vehiclePath = `negocios/${businessId}/vehiculos/${vehiculoId}`;
  const storedVehicle = (await adminDb.doc(vehiclePath).get()).data();
  assert.equal(storedVehicle.negocioId, businessId);
  assert.equal(storedVehicle.clienteId, "cliente-a");
  assert.equal(storedVehicle.creadoPorUid, owner.uid);
  assert.equal(storedVehicle.actualizadoPorUid, owner.uid);
  assert.ok(storedVehicle.creadoEn?.toDate());
  assert.ok(storedVehicle.actualizadoEn?.toDate());
  assert.equal(Object.hasOwn(storedVehicle, "patenteNormalizada"), false);
  assert.equal(Object.hasOwn(storedVehicle, "vinNormalizado"), false);
  assert.deepEqual(Object.keys(storedVehicle).sort(), [
    "actualizadoEn",
    "actualizadoPorUid",
    "anio",
    "clienteId",
    "color",
    "creadoEn",
    "creadoPorUid",
    "marca",
    "modelo",
    "negocioId",
    "patente",
    "tipo",
    "vehiculoId",
    "vin",
  ]);
  console.log("OK creación: documento canónico, timestamps y autoría");

  const repeated = await callable(owner, "crearVehiculo")({
    businessId,
    requestId,
    vehiculo: vehiclePayload(),
  });
  assert.equal(repeated.data.vehiculo.vehiculoId, vehiculoId);
  assert.equal(repeated.data.sinCambios, true);
  assert.equal(
    (await adminDb.collection(`negocios/${businessId}/vehiculos`).get()).size,
    1
  );
  await expectCallableError(
    "requestId reutilizado con otros datos",
    () => callable(owner, "crearVehiculo")({
      businessId,
      requestId,
      vehiculo: vehiclePayload({color: "Rojo"}),
    }),
    ["already-exists"],
    /otros datos/i
  );
  console.log("OK idempotencia: el reintento no duplica vehículos");

  const noVinOne = await callable(admin, "crearVehiculo")({
    businessId,
    requestId: `vehicle-no-vin-1-${RUN_ID}`,
    vehiculo: vehiclePayload({patente: "EFGH34", vin: "", tipo: "suv"}),
  });
  const noVinTwo = await callable(admin, "crearVehiculo")({
    businessId,
    requestId: `vehicle-no-vin-2-${RUN_ID}`,
    vehiculo: vehiclePayload({patente: "IJKL56", vin: null, tipo: "pickup"}),
  });
  assert.equal(noVinOne.data.vehiculo.vin, null);
  assert.equal(noVinTwo.data.vehiculo.vin, null);
  assert.equal(
    (await adminDb.collection(`negocios/${businessId}/vehicleVinKeys`).get()).size,
    1
  );
  console.log("OK VIN opcional: múltiples ausencias no crean reserva");

  await expectCallableError(
    "patente duplicada normalizada",
    () => callable(admin, "crearVehiculo")({
      businessId,
      requestId: `vehicle-plate-duplicate-${RUN_ID}`,
      vehiculo: vehiclePayload({patente: "ab cd-12", vin: "VIN-UNICO-2"}),
    }),
    ["already-exists"],
    /patente/i
  );
  await expectCallableError(
    "VIN duplicado normalizado",
    () => callable(admin, "crearVehiculo")({
      businessId,
      requestId: `vehicle-vin-duplicate-${RUN_ID}`,
      vehiculo: vehiclePayload({patente: "MNOP78", vin: "1hg-cm82633a004352"}),
    }),
    ["already-exists"],
    /VIN/i
  );

  const concurrentPlate = "QRST90";
  const concurrent = await Promise.allSettled([
    callable(owner, "crearVehiculo")({
      businessId,
      requestId: `vehicle-concurrent-owner-${RUN_ID}`,
      vehiculo: vehiclePayload({patente: concurrentPlate, vin: "VIN-CONCURRENT-1"}),
    }),
    callable(admin, "crearVehiculo")({
      businessId,
      requestId: `vehicle-concurrent-admin-${RUN_ID}`,
      vehiculo: vehiclePayload({patente: concurrentPlate, vin: "VIN-CONCURRENT-2"}),
    }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  assert.match(
    String(concurrent.find((result) => result.status === "rejected").reason.code),
    /already-exists/
  );
  console.log("OK unicidad: la reserva transaccional resiste concurrencia");

  await expectCallableError(
    "tipo fuera del catálogo",
    () => callable(owner, "crearVehiculo")({
      businessId,
      requestId: `vehicle-invalid-type-${RUN_ID}`,
      vehiculo: vehiclePayload({patente: "UVWX12", tipo: "camion"}),
    }),
    ["invalid-argument"],
    /tipo de vehículo/i
  );
  await expectCallableError(
    "cliente con negocioId inconsistente",
    () => callable(owner, "crearVehiculo")({
      businessId,
      requestId: `vehicle-cross-client-${RUN_ID}`,
      vehiculo: vehiclePayload({
        clienteId: "cliente-inconsistente",
        patente: "YZAB34",
      }),
    }),
    ["failed-precondition"],
    /no pertenece al negocio/i
  );
  await expectCallableError(
    "MEMBER no administra vehículos",
    () => callable(member, "crearVehiculo")({
      businessId,
      requestId: `vehicle-member-${RUN_ID}`,
      vehiculo: vehiclePayload({patente: "CDEF56"}),
    }),
    ["permission-denied"]
  );

  const crossBusinessCreate = await callable(outsider, "crearVehiculo")({
    businessId: outsiderBusinessId,
    requestId: `vehicle-outsider-${RUN_ID}`,
    vehiculo: vehiclePayload({
      clienteId: "cliente-externo",
      patente: "ABCD12",
      vin: "1HGCM82633A004352",
    }),
  });
  assert.ok(crossBusinessCreate.data.vehiculo.vehiculoId);
  console.log("OK aislamiento: patente y VIN son únicos por negocio, no globales");

  await expectCallableError(
    "actualización general no cambia propietario",
    () => callable(owner, "actualizarVehiculo")({
      businessId,
      vehiculoId,
      vehiculo: vehiclePayload({clienteId: "cliente-b"}),
    }),
    ["invalid-argument"],
    /clienteId.*no está admitido/i
  );
  await callable(owner, "actualizarVehiculo")({
    businessId,
    vehiculoId,
    vehiculo: {
      patente: "ZZ-YY 99",
      vin: "VIN ACTUALIZADO 99",
      marca: "Toyota",
      modelo: "Corolla Cross",
      anio: 2022,
      color: "Gris",
      tipo: "suv",
    },
  });
  const updatedVehicle = (await adminDb.doc(vehiclePath).get()).data();
  assert.equal(updatedVehicle.patente, "ZZYY99");
  assert.equal(updatedVehicle.vin, "VINACTUALIZADO99");
  assert.equal(updatedVehicle.creadoPorUid, owner.uid);
  assert.equal(updatedVehicle.actualizadoPorUid, owner.uid);
  assert.equal(
    (await adminDb.doc(`negocios/${businessId}/vehiclePlateKeys/ABCD12`).get()).exists,
    false
  );
  assert.equal(
    (await adminDb.doc(`negocios/${businessId}/vehicleVinKeys/1HGCM82633A004352`).get()).exists,
    false
  );
  assert.equal(
    (await adminDb.doc(`negocios/${businessId}/vehiclePlateKeys/ZZYY99`).get()).data().vehiculoId,
    vehiculoId
  );
  console.log("OK actualización: migra reservas y conserva autoría de creación");

  await adminDb.doc(`negocios/${businessId}/ordenesTrabajo/ot-historica`).set({
    otId: "ot-historica",
    negocioId: businessId,
    vehiculoId,
    clienteId: "cliente-a",
  });
  const ownerChange = await callable(owner, "cambiarPropietarioVehiculo")({
    businessId,
    vehiculoId,
    clienteId: "cliente-b",
  });
  assert.equal(ownerChange.data.sinCambios, false);
  assert.equal((await adminDb.doc(vehiclePath).get()).data().clienteId, "cliente-b");
  assert.equal(
    (await adminDb.doc(`negocios/${businessId}/ordenesTrabajo/ot-historica`).get()).data().clienteId,
    "cliente-a"
  );
  const repeatedOwnerChange = await callable(owner, "cambiarPropietarioVehiculo")({
    businessId,
    vehiculoId,
    clienteId: "cliente-b",
  });
  assert.equal(repeatedOwnerChange.data.sinCambios, true);
  console.log("OK propietario: cambia la referencia actual sin reescribir OTs");

  assert.ok((await getDoc(doc(technician.db, vehiclePath))).exists());
  const listedVehicles = await getDocs(query(
    collection(technician.db, `negocios/${businessId}/vehiculos`),
    where("negocioId", "==", businessId)
  ));
  assert.ok(listedVehicles.docs.some((item) => item.id === vehiculoId));
  console.log("OK lectura: listado de vehículos autorizado para Taller");
  await expectFirestoreDenied(
    "otro negocio no puede leer el vehículo",
    () => getDoc(doc(outsider.db, vehiclePath))
  );
  await expectFirestoreDenied(
    "SDK cliente no puede crear vehículos",
    () => setDoc(doc(owner.db, `negocios/${businessId}/vehiculos/directo`), {
      vehiculoId: "directo",
      negocioId: businessId,
    })
  );
  await expectFirestoreDenied(
    "SDK cliente no puede leer claves de patente",
    () => getDoc(doc(owner.db, `negocios/${businessId}/vehiclePlateKeys/ZZYY99`))
  );
  await expectFirestoreDenied(
    "SDK cliente no puede leer idempotencia",
    () => getDoc(doc(owner.db, `negocios/${businessId}/vehicleCreateRequests/${requestId}`))
  );
  console.log("VEHICLES_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
