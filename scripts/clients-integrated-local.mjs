import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  terminate,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  buildClientMutationPayload,
  getClientRutKey,
  normalizeChileanRut,
} from "../src/domain/clientModel.mjs";
import {buildFiscalIdentifier} from "../src/domain/fiscalIdentifier.mjs";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const {
  deleteApp: deleteAdminApp,
  initializeApp: initializeAdminApp,
} = requireFromFunctions("firebase-admin/app");
const { getFirestore: getAdminFirestore } = requireFromFunctions(
  "firebase-admin/firestore"
);

function createClientApp(name) {
  const app = initializeApp(
    {
      apiKey: "demo-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      appId: `clients-${name}-${RUN_ID}`,
    },
    `clients-${name}-${RUN_ID}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { app, auth, db, functions };
}

async function authenticate(client, label) {
  const credential = await createUserWithEmailAndPassword(
    client.auth,
    `clients-${label}-${RUN_ID}@example.test`,
    `Clients-${RUN_ID}-Pass!`
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
    if (messagePattern) {
      assert.match(String(error?.message || ""), messagePattern);
    }
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
    console.log(`OK aislamiento: ${label}`);
    return;
  }
  throw new Error(`Se esperaba denegación de Firestore: ${label}`);
}

function clientPayload({ rut, nombre, tipoCliente = "empresa" }) {
  return {
    tipoCliente,
    rut,
    nombreRazonSocial: nombre,
    giro: tipoCliente === "empresa" ? "Ingeniería y consultoría técnica" : "",
    email: `${nombre.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test`,
    telefono: "+56 9 1234 5678",
    direccion: "Av. Principal 123",
    regionCodigo: "13",
    regionNombre: "Metropolitana de Santiago",
    comunaCodigo: "13101",
    comunaNombre: "Santiago",
    personaContacto: "Contacto de prueba",
    notas: "Creado por smoke integrado",
  };
}

async function assertClientInputWasNotPersisted(adminDb, businessId, rut) {
  const [reservationSnapshot, clientsSnapshot] = await Promise.all([
    adminDb
      .doc(`negocios/${businessId}/clientRutKeys/${getClientRutKey(rut)}`)
      .get(),
    adminDb
      .collection(`negocios/${businessId}/clientes`)
      .where("identificadorFiscalNormalizado", "==", buildFiscalIdentifier("CL", rut).identificadorFiscalNormalizado)
      .get(),
  ]);
  assert.equal(reservationSnapshot.exists, false);
  assert.equal(clientsSnapshot.empty, true);
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
  { projectId: PROJECT_ID },
  `clients-admin-${RUN_ID}`
);
const adminDb = getAdminFirestore(adminApp);

try {
  const ownerBusinessResponse = await callable(owner, "createFirstBusiness")({
    nombreComercial: "Negocio clientes principal",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-owner-${RUN_ID}`,
  });
  const businessId = ownerBusinessResponse.data.business.id;
  const outsiderBusinessResponse = await callable(
    outsider,
    "createFirstBusiness"
  )({
    nombreComercial: "Negocio externo",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
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

  const ownerData = buildClientMutationPayload(
    clientPayload({
      rut: "12.345.678-5",
      nombre: "Cliente Owner",
    })
  );
  assert.equal(Object.hasOwn(ownerData, "modeloClienteVersion"), false);
  assert.equal(Object.hasOwn(ownerData, "rutNormalizado"), false);
  ownerData.regionNombre = "Nombre de región manipulado";
  ownerData.comunaNombre = "Nombre de comuna manipulado";
  const ownerCreate = await callable(owner, "crearCliente")({
    businessId,
    cliente: ownerData,
  });
  const ownerClientId = ownerCreate.data.cliente.clienteId;
  assert.ok(ownerClientId);
  assert.equal(ownerCreate.data.cliente.negocioId, businessId);
  assert.equal(ownerCreate.data.cliente.estado, "activo");
  const storedOwnerClient = (await adminDb.doc(
    `negocios/${businessId}/clientes/${ownerClientId}`
  ).get()).data();
  assert.equal(storedOwnerClient.clienteId, ownerClientId);
  assert.equal(Object.hasOwn(storedOwnerClient, "clientId"), false);
  assert.equal(storedOwnerClient.regionNombre, "Metropolitana de Santiago");
  assert.equal(storedOwnerClient.comunaNombre, "Santiago");
  assert.equal(
    ownerCreate.data.cliente.regionNombre,
    "Metropolitana de Santiago"
  );
  assert.equal(ownerCreate.data.cliente.comunaNombre, "Santiago");
  console.log("OK creación: OWNER crea cliente");

  const adminData = clientPayload({
    rut: "77.091.679-8",
    nombre: "Cliente Admin",
  });
  const adminCreate = await callable(admin, "crearCliente")({
    businessId,
    cliente: adminData,
  });
  const adminClientId = adminCreate.data.cliente.clienteId;
  assert.ok(adminClientId);
  console.log("OK creación: ADMIN crea cliente");

  await expectCallableError(
    "MEMBER no puede crear clientes",
    () =>
      callable(member, "crearCliente")({
        businessId,
        cliente: clientPayload({
          rut: "11.111.111-1",
          nombre: "Cliente Member",
        }),
      }),
    ["permission-denied"]
  );
  await expectCallableError(
    "usuario sin membresía no puede crear en otro negocio",
    () =>
      callable(outsider, "crearCliente")({
        businessId,
        cliente: clientPayload({
          rut: "11.111.111-1",
          nombre: "Cliente Externo",
        }),
      }),
    ["permission-denied"]
  );
  await expectCallableError(
    "businessId de otro negocio no concede acceso",
    () =>
      callable(owner, "crearCliente")({
        businessId: outsiderBusinessId,
        cliente: clientPayload({
          rut: "11.111.111-1",
          nombre: "Cliente Cruzado",
        }),
      }),
    ["permission-denied"]
  );

  const invalidTextCases = [
    {
      label: "objeto en campo textual",
      rut: "6.000.000-K",
      patch: {giro: {valor: "Servicios"}},
      messagePattern: /debe ser texto/i,
    },
    {
      label: "arreglo en campo textual",
      rut: "7.000.000-8",
      patch: {telefono: ["+56", "9"]},
      messagePattern: /debe ser texto/i,
    },
    {
      label: "texto que supera el máximo",
      rut: "8.000.000-6",
      patch: {notas: "x".repeat(4001)},
      messagePattern: /4000 caracteres/i,
    },
    {
      label: "campo de cliente desconocido",
      rut: "9.000.000-4",
      patch: {estado: "archivado"},
      messagePattern: /no está admitido/i,
    },
    {
      label: "modeloClienteVersion enviado manualmente",
      rut: "10.000.000-8",
      patch: {modeloClienteVersion: 1},
      messagePattern: /no está admitido/i,
    },
    {
      label: "rutNormalizado enviado manualmente",
      rut: "14.000.000-0",
      patch: {rutNormalizado: "14000000-0"},
      messagePattern: /no está admitido/i,
    },
  ];
  for (const invalidCase of invalidTextCases) {
    await expectCallableError(
      invalidCase.label,
      () =>
        callable(owner, "crearCliente")({
          businessId,
          cliente: {
            ...clientPayload({
              rut: invalidCase.rut,
              nombre: `Inválido ${invalidCase.rut}`,
            }),
            ...invalidCase.patch,
          },
        }),
      ["invalid-argument"],
      invalidCase.messagePattern
    );
    await assertClientInputWasNotPersisted(
      adminDb,
      businessId,
      invalidCase.rut
    );
  }
  console.log("OK validación: no trunca ni persiste campos inválidos");

  const invalidTerritoryCases = [
    {
      label: "código de región inexistente",
      rut: "15.000.000-9",
      patch: {regionCodigo: "99", comunaCodigo: ""},
      messagePattern: /región válida/i,
    },
    {
      label: "comuna que no pertenece a la región",
      rut: "15.000.001-7",
      patch: {regionCodigo: "01", comunaCodigo: "13101"},
      messagePattern: /pertenezca a la región/i,
    },
    {
      label: "comuna sin región",
      rut: "15.000.002-5",
      patch: {
        regionCodigo: "",
        regionNombre: "",
        comunaCodigo: "13101",
      },
      messagePattern: /región válida/i,
    },
  ];
  for (const invalidCase of invalidTerritoryCases) {
    await expectCallableError(
      invalidCase.label,
      () =>
        callable(owner, "crearCliente")({
          businessId,
          cliente: {
            ...clientPayload({
              rut: invalidCase.rut,
              nombre: `Territorio inválido ${invalidCase.rut}`,
            }),
            ...invalidCase.patch,
          },
        }),
      ["invalid-argument"],
      invalidCase.messagePattern
    );
    await assertClientInputWasNotPersisted(
      adminDb,
      businessId,
      invalidCase.rut
    );
  }
  console.log("OK territorio: valida códigos y deriva nombres autoritativos");

  const ownerClientPath = `negocios/${businessId}/clientes/${ownerClientId}`;
  assert.ok((await getDoc(doc(member.db, ownerClientPath))).exists());
  await expectFirestoreDenied(
    "miembro de otro negocio no lee clientes",
    () => getDoc(doc(outsider.db, ownerClientPath))
  );

  await expectCallableError(
    "RUT duplicado dentro del negocio",
    () =>
      callable(owner, "crearCliente")({
        businessId,
        cliente: {...ownerData, nombreRazonSocial: "Duplicado"},
      }),
    ["already-exists"]
  );

  const concurrentRut = "22.222.222-2";
  const concurrentResults = await Promise.allSettled([
    callable(owner, "crearCliente")({
      businessId,
      cliente: clientPayload({rut: concurrentRut, nombre: "Concurrente Uno"}),
    }),
    callable(admin, "crearCliente")({
      businessId,
      cliente: clientPayload({rut: concurrentRut, nombre: "Concurrente Dos"}),
    }),
  ]);
  assert.equal(
    concurrentResults.filter((result) => result.status === "fulfilled").length,
    1
  );
  assert.equal(
    concurrentResults.filter((result) => result.status === "rejected").length,
    1
  );
  assert.match(
    String(concurrentResults.find((result) => result.status === "rejected").reason.code),
    /already-exists/
  );
  console.log("OK concurrencia: una sola creación reserva el RUT");

  const ownerRutKey = getClientRutKey(ownerData.identificadorFiscalValor);
  const ownerReservationPath =
    `negocios/${businessId}/clientRutKeys/${ownerRutKey}`;
  await callable(owner, "actualizarCliente")({
    businessId,
    clienteId: ownerClientId,
    cliente: {...ownerData, nombreRazonSocial: "Cliente Owner Editado"},
  });
  assert.equal(
    (await adminDb.doc(ownerReservationPath).get()).data().clienteId,
    ownerClientId
  );
  assert.equal(
    (await adminDb.doc(ownerClientPath).get()).data().nombreRazonSocial,
    "Cliente Owner Editado"
  );
  console.log("OK edición: conserva la reserva cuando el RUT no cambia");

  const changedRut = "11.111.111-1";
  const changedRutKey = getClientRutKey(changedRut);
  await callable(owner, "actualizarCliente")({
    businessId,
    clienteId: ownerClientId,
    cliente: {...ownerData, identificadorFiscalValor: changedRut},
  });
  assert.equal((await adminDb.doc(ownerReservationPath).get()).exists, false);
  assert.equal(
    (
      await adminDb
        .doc(`negocios/${businessId}/clientRutKeys/${changedRutKey}`)
        .get()
    ).data().clienteId,
    ownerClientId
  );
  const releasedRutCreate = await callable(owner, "crearCliente")({
    businessId,
    cliente: clientPayload({
      rut: ownerData.identificadorFiscalValor,
      nombre: "Cliente RUT Liberado",
    }),
  });
  assert.notEqual(releasedRutCreate.data.cliente.clienteId, ownerClientId);
  console.log("OK edición: cambia RUT, reserva el nuevo y libera el anterior");

  const changedReservationPath =
    `negocios/${businessId}/clientRutKeys/${changedRutKey}`;
  const assertRejectedReservationDoesNotWrite = async (label) => {
    const clientBefore = await adminDb.doc(ownerClientPath).get();
    const reservationBefore = await adminDb.doc(changedReservationPath).get();
    await expectCallableError(
      label,
      () =>
        callable(owner, "archivarCliente")({
          businessId,
          clienteId: ownerClientId,
        }),
      ["failed-precondition"],
      /reserva.*fiscal/i
    );
    const [clientAfter, reservationAfter] = await Promise.all([
      adminDb.doc(ownerClientPath).get(),
      adminDb.doc(changedReservationPath).get(),
    ]);
    assert.equal(updateTimeMillis(clientAfter), updateTimeMillis(clientBefore));
    assert.equal(
      updateTimeMillis(reservationAfter),
      updateTimeMillis(reservationBefore)
    );
  };

  await adminDb.doc(changedReservationPath).update({
    negocioId: outsiderBusinessId,
  });
  await assertRejectedReservationDoesNotWrite(
    "reserva con negocioId inconsistente"
  );
  await adminDb.doc(changedReservationPath).update({negocioId: businessId});

  await adminDb.doc(changedReservationPath).update({
    identificadorFiscalNormalizado: "123456785",
  });
  await assertRejectedReservationDoesNotWrite(
    "reserva con identificador fiscal inconsistente"
  );
  await adminDb.doc(changedReservationPath).update({
    identificadorFiscalNormalizado: buildFiscalIdentifier("CL", changedRut).identificadorFiscalNormalizado,
  });
  console.log("OK reservas: valida clienteId, negocioId y RUT sin escrituras parciales");

  const adminRutKey = getClientRutKey(adminData.rut);
  const adminReservationPath =
    `negocios/${businessId}/clientRutKeys/${adminRutKey}`;
  const firstArchive = await callable(admin, "archivarCliente")({
    businessId,
    clienteId: adminClientId,
  });
  assert.equal(firstArchive.data.sinCambios, false);
  assert.equal(
    (await adminDb.doc(adminReservationPath).get()).data().estadoCliente,
    "archivado"
  );
  assert.equal(
    (
      await adminDb
        .doc(`negocios/${businessId}/clientes/${adminClientId}`)
        .get()
    ).data().estado,
    "archivado"
  );
  console.log("OK archivo: conserva la reserva del RUT");

  const archivedClientSnapshot = await adminDb
    .doc(`negocios/${businessId}/clientes/${adminClientId}`)
    .get();
  await adminDb.doc(adminReservationPath).update({estadoCliente: "activo"});
  const archivedMismatchClientBefore = await adminDb
    .doc(`negocios/${businessId}/clientes/${adminClientId}`)
    .get();
  const archivedMismatchReservationBefore = await adminDb
    .doc(adminReservationPath)
    .get();
  await expectCallableError(
    "cliente archivado con reserva activa",
    () =>
      callable(admin, "archivarCliente")({
        businessId,
        clienteId: adminClientId,
      }),
    ["failed-precondition"],
    /estado de la reserva/i
  );
  assert.equal(
    updateTimeMillis(
      await adminDb.doc(`negocios/${businessId}/clientes/${adminClientId}`).get()
    ),
    updateTimeMillis(archivedMismatchClientBefore)
  );
  assert.equal(
    updateTimeMillis(await adminDb.doc(adminReservationPath).get()),
    updateTimeMillis(archivedMismatchReservationBefore)
  );
  await adminDb.doc(adminReservationPath).update({estadoCliente: "archivado"});
  const archivedReservationBeforeRepeat = await adminDb
    .doc(adminReservationPath)
    .get();
  const repeatedArchive = await callable(admin, "archivarCliente")({
    businessId,
    clienteId: adminClientId,
  });
  assert.equal(repeatedArchive.data.sinCambios, true);
  assert.equal(
    updateTimeMillis(
      await adminDb.doc(`negocios/${businessId}/clientes/${adminClientId}`).get()
    ),
    updateTimeMillis(archivedClientSnapshot)
  );
  assert.equal(
    updateTimeMillis(await adminDb.doc(adminReservationPath).get()),
    updateTimeMillis(archivedReservationBeforeRepeat)
  );
  console.log("OK archivo: segunda solicitud es idempotente y no reescribe");

  await expectCallableError(
    "RUT de cliente archivado exige reactivación",
    () =>
      callable(owner, "crearCliente")({
        businessId,
        cliente: {...adminData, nombreRazonSocial: "No debe crearse"},
      }),
    ["failed-precondition"],
    /reactivarlo/i
  );

  const firstReactivation = await callable(admin, "reactivarCliente")({
    businessId,
    clienteId: adminClientId,
  });
  assert.equal(firstReactivation.data.sinCambios, false);
  assert.equal(
    (await adminDb.doc(adminReservationPath).get()).data().estadoCliente,
    "activo"
  );
  assert.equal(
    (
      await adminDb
        .doc(`negocios/${businessId}/clientes/${adminClientId}`)
        .get()
    ).data().estado,
    "activo"
  );
  console.log("OK reactivación: reutiliza la reserva existente");

  const activeClientSnapshot = await adminDb
    .doc(`negocios/${businessId}/clientes/${adminClientId}`)
    .get();
  await adminDb.doc(adminReservationPath).update({estadoCliente: "archivado"});
  const activeMismatchClientBefore = await adminDb
    .doc(`negocios/${businessId}/clientes/${adminClientId}`)
    .get();
  const activeMismatchReservationBefore = await adminDb
    .doc(adminReservationPath)
    .get();
  await expectCallableError(
    "cliente activo con reserva archivada",
    () =>
      callable(admin, "reactivarCliente")({
        businessId,
        clienteId: adminClientId,
      }),
    ["failed-precondition"],
    /estado de la reserva/i
  );
  assert.equal(
    updateTimeMillis(
      await adminDb.doc(`negocios/${businessId}/clientes/${adminClientId}`).get()
    ),
    updateTimeMillis(activeMismatchClientBefore)
  );
  assert.equal(
    updateTimeMillis(await adminDb.doc(adminReservationPath).get()),
    updateTimeMillis(activeMismatchReservationBefore)
  );
  await adminDb.doc(adminReservationPath).update({estadoCliente: "activo"});
  const activeReservationBeforeRepeat = await adminDb
    .doc(adminReservationPath)
    .get();
  const repeatedReactivation = await callable(admin, "reactivarCliente")({
    businessId,
    clienteId: adminClientId,
  });
  assert.equal(repeatedReactivation.data.sinCambios, true);
  assert.equal(
    updateTimeMillis(
      await adminDb.doc(`negocios/${businessId}/clientes/${adminClientId}`).get()
    ),
    updateTimeMillis(activeClientSnapshot)
  );
  assert.equal(
    updateTimeMillis(await adminDb.doc(adminReservationPath).get()),
    updateTimeMillis(activeReservationBeforeRepeat)
  );
  console.log("OK reactivación: segunda solicitud es idempotente y no reescribe");

  console.log("CLIENTS_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
