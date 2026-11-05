// Eliminación permanente de proveedores (callable eliminarProveedor) contra los
// emuladores de Auth, Firestore y Functions. Nunca usa producción.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getFirestore,
  terminate,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  buildProviderMutationPayload,
  getProviderRutKey,
} from "../src/domain/providerModel.mjs";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const WORD = "permanente";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
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

function createClient(name) {
  const app = initializeApp({
    apiKey: "demo-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    appId: `provider-delete-${name}-${RUN_ID}`,
  }, `provider-delete-${name}-${RUN_ID}`);
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
    `provider-delete-${label}-${RUN_ID}@example.test`,
    `ProviderDelete-${RUN_ID}-Pass!`
  );
  client.uid = credential.user.uid;
  return client;
}

const call = (client, name) => httpsCallable(client.functions, name);

async function expectCallableError(label, operation, expected, messagePattern) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    assert.ok(expected.some((item) => code.includes(item)), `${label}: código inesperado ${code} (${error?.message})`);
    if (messagePattern) assert.match(String(error?.message || ""), messagePattern, label);
    console.log(`OK rechazo: ${label}`);
    return error;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

// Un RUT chileno válido distinto por llamada (DV módulo 11).
let rutCounter = 0;
function nextRut() {
  rutCounter += 1;
  const body = String(30000000 + Number(RUN_ID.replace(/\D/g, "").slice(-5)) * 20 + rutCounter);
  let sum = 0;
  let factor = 2;
  for (const digit of body.split("").reverse()) {
    sum += Number(digit) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  const dv = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return `${body}-${dv}`;
}

function providerPayload(razonSocial, rut = nextRut()) {
  return buildProviderMutationPayload({
    rut,
    razonSocial,
    email: "proveedor@example.test",
    telefono: "+56 9 1234 5678",
  });
}

function orderPayload(proveedorId, itemId) {
  return {
    proveedorId,
    fechaEntregaEstimada: "2026-09-10",
    direccionEntrega: "Bodega central 123",
    condicionesPago: "30 días",
    observaciones: "Orden de prueba de carrera",
    items: [{lineaId: "linea-principal", itemId, cantidad: 2, costoUnitario: 10000, descuentoPct: 0}],
  };
}

const owner = await authenticate(createClient("owner"), "owner");
const admin = await authenticate(createClient("admin"), "admin");
const compras = await authenticate(createClient("compras"), "compras");
const member = await authenticate(createClient("member"), "member");
const outsider = await authenticate(createClient("outsider"), "outsider");
const clients = [owner, admin, compras, member, outsider];
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `provider-delete-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

try {
  const businessId = (await call(owner, "createFirstBusiness")({
    nombreComercial: "Negocio eliminar proveedores",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-main-${RUN_ID}`,
  })).data.business.id;
  const otherBusinessId = (await call(outsider, "createFirstBusiness")({
    nombreComercial: "Negocio eliminar proveedores externo",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-other-${RUN_ID}`,
  })).data.business.id;

  const fiscal = {
    identificadorFiscalTipo: "RUT",
    identificadorFiscalValor: "76.300.300-3",
  };
  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).set({
      ...fiscal,
      verificacionEmpresa: {estado: "VERIFICADA", ...fiscal},
    }, {merge: true}),
    adminDb.doc(`negocios/${otherBusinessId}`).set({
      verificacionEmpresa: {estado: "VERIFICADA"},
    }, {merge: true}),
    adminDb.doc(`negocios/${businessId}/empresa/perfil`).set({
      negocioId: businessId,
      nombreComercial: "Empresa eliminar proveedores",
      razonSocial: "Empresa Eliminar SpA",
      ...fiscal,
    }, {merge: true}),
    ...[[admin, "ADMIN"], [compras, "COMPRAS"], [member, "MEMBER"]].map(([client, rol]) =>
      adminDb.doc(`membresias/${businessId}__${client.uid}`).set({
        negocioId: businessId, uid: client.uid, rol, estado: "activo",
      })
    ),
  ]);
  const itemId = `item-${RUN_ID}`;
  await adminDb.doc(`negocios/${businessId}/inventario/${itemId}`).set({
    negocioId: businessId,
    estado: "activo",
    codigoInterno: "PR-0001",
    nombre: "Producto de prueba",
    tipoItem: "producto",
    unidad: "unidad",
    costoBase: 8500,
  });

  const providerPath = (id) => `negocios/${businessId}/proveedores/${id}`;
  const reservationPath = (rut) => `negocios/${businessId}/providerRutKeys/${getProviderRutKey(rut)}`;
  const exists = async (path) => (await adminDb.doc(path).get()).exists;
  const createProvider = async (name, client = owner, rut = nextRut()) => {
    const response = await call(client, "crearProveedor")({
      businessId,
      requestId: `provider-${RUN_ID}-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`.slice(0, 120),
      proveedor: providerPayload(name, rut),
    });
    return {proveedorId: response.data.proveedor.proveedorId, rut};
  };
  const remove = (client, proveedorId, confirmacion = WORD, targetBusiness = businessId) =>
    call(client, "eliminarProveedor")({businessId: targetBusiness, proveedorId, confirmacion});
  const createRequestsFor = async (proveedorId) =>
    (await adminDb.collection(`negocios/${businessId}/providerCreateRequests`).where("proveedorId", "==", proveedorId).get()).size;

  // 1. Borrado sin movimientos: OWNER, proveedor activo.
  const first = await createProvider("Proveedor Sin Movimientos");
  assert.ok(await exists(reservationPath(first.rut)));
  assert.equal(await createRequestsFor(first.proveedorId), 1);
  const deletion = await remove(owner, first.proveedorId);
  assert.equal(deletion.data.success, true);
  assert.equal(await exists(providerPath(first.proveedorId)), false);
  assert.equal(await exists(reservationPath(first.rut)), false);
  assert.equal(await createRequestsFor(first.proveedorId), 0);
  console.log("OK borrado: OWNER elimina un proveedor activo sin movimientos, libera la reserva y retira su solicitud de creación");

  // 2. RUT liberado y reutilizable.
  const reused = await createProvider("Proveedor Mismo RUT", owner, first.rut);
  assert.notEqual(reused.proveedorId, first.proveedorId);
  assert.ok(await exists(reservationPath(first.rut)));
  console.log("OK RUT: queda libre y se puede registrar de nuevo");

  // 3. ADMIN elimina un proveedor archivado.
  const archived = await createProvider("Proveedor Archivado");
  await call(admin, "archivarProveedor")({businessId, proveedorId: archived.proveedorId});
  assert.equal((await adminDb.doc(providerPath(archived.proveedorId)).get()).data().estado, "archivado");
  await remove(admin, archived.proveedorId);
  assert.equal(await exists(providerPath(archived.proveedorId)), false);
  assert.equal(await exists(reservationPath(archived.rut)), false);
  console.log("OK borrado: ADMIN elimina un proveedor archivado");

  // 4. Roles y entradas inválidas: nada se borra.
  const guarded = await createProvider("Proveedor Protegido");
  const intact = async (label) => {
    assert.ok(await exists(providerPath(guarded.proveedorId)), `${label}: el proveedor debe seguir existiendo`);
    assert.ok(await exists(reservationPath(guarded.rut)), `${label}: la reserva debe seguir existiendo`);
  };
  await expectCallableError("COMPRAS no puede eliminar", () => remove(compras, guarded.proveedorId), ["permission-denied"]);
  await expectCallableError("MEMBER no puede eliminar", () => remove(member, guarded.proveedorId), ["permission-denied"]);
  await expectCallableError("usuario de otro negocio no puede eliminar", () => remove(outsider, guarded.proveedorId), ["permission-denied"]);
  await expectCallableError("sin palabra de confirmación", () => remove(owner, guarded.proveedorId, ""), ["invalid-argument"], /permanente/);
  await expectCallableError("palabra de confirmación incorrecta", () => remove(owner, guarded.proveedorId, "borrar"), ["invalid-argument"], /permanente/);
  await expectCallableError("id de proveedor inválido", () => remove(owner, "../x"), ["invalid-argument"]);
  await expectCallableError("proveedor inexistente", () => remove(owner, `no-existe-${RUN_ID}`), ["not-found"]);
  await expectCallableError(
    "el dueño de otro negocio no alcanza un proveedor ajeno",
    () => remove(outsider, guarded.proveedorId, WORD, otherBusinessId),
    ["not-found"]
  );
  await intact("tras rechazos");
  await expectCallableError("eliminación directa con el SDK cliente", () => deleteDoc(doc(owner.db, providerPath(guarded.proveedorId))), ["permission-denied"]);
  await intact("tras rechazos de rol y SDK");
  console.log("OK seguridad: rol, palabra de confirmación, negocio ajeno y SDK cliente no borran nada");

  // 5. Rechazo por cada tipo de dependencia, con cantidades. Después de quitar la
  // dependencia el borrado procede (el bloqueo era exactamente ese documento).
  const dependencyCases = [
    {
      label: "orden de compra por proveedorId",
      seed: (id) => [[`ordenesCompra/oc-direct-${id}`, {negocioId: businessId, proveedorId: id, estado: "borrador"}]],
      message: /1 orden de compra\b/,
    },
    {
      label: "orden de compra solo con el id dentro del snapshot",
      seed: (id) => [[`ordenesCompra/oc-snap-${id}`, {negocioId: businessId, proveedorSnapshot: {proveedorId: id, razonSocial: "Copia"}, estado: "emitida"}]],
      message: /1 orden de compra\b/,
    },
    {
      label: "varias órdenes de compra (cuenta sin duplicar un documento con ambos campos)",
      seed: (id) => [
        [`ordenesCompra/oc-a-${id}`, {negocioId: businessId, proveedorId: id, proveedorSnapshot: {proveedorId: id}}],
        [`ordenesCompra/oc-b-${id}`, {negocioId: businessId, proveedorId: id}],
        [`ordenesCompra/oc-c-${id}`, {negocioId: businessId, proveedorSnapshot: {proveedorId: id}}],
      ],
      message: /3 órdenes de compra/,
    },
    {
      label: "compra por proveedorId",
      seed: (id) => [[`compras/compra-direct-${id}`, {negocioId: businessId, proveedorId: id, estado: "borrador"}]],
      message: /1 compra\b/,
    },
    {
      label: "compra solo con el id dentro del snapshot",
      seed: (id) => [[`compras/compra-snap-${id}`, {negocioId: businessId, proveedorSnapshot: {proveedorId: id}, estado: "confirmada"}]],
      message: /1 compra\b/,
    },
    {
      label: "recepción por proveedorId",
      seed: (id) => [[`recepciones/recepcion-direct-${id}`, {negocioId: businessId, proveedorId: id}]],
      message: /1 recepción\b/,
    },
    {
      label: "recepción solo con el id dentro del snapshot",
      seed: (id) => [[`recepciones/recepcion-snap-${id}`, {negocioId: businessId, proveedorSnapshot: {proveedorId: id}}]],
      message: /1 recepción\b/,
    },
    {
      label: "adquisición de inventario",
      seed: (id) => [[`adquisicionesInventario/adq-${id}`, {negocioId: businessId, proveedorId: id, proveedorSnapshot: {proveedorId: id}}]],
      message: /1 adquisición de inventario/,
    },
    {
      label: "producto de inventario con último proveedor",
      seed: (id) => [[`inventario/item-ultimo-${id}`, {negocioId: businessId, estado: "activo", nombre: "Con último proveedor", tipoItem: "producto", ultimoProveedor: {proveedorId: id, razonSocial: "Copia"}}]],
      message: /1 producto de inventario que lo registra como último proveedor/,
    },
    {
      label: "varios tipos a la vez",
      seed: (id) => [
        [`ordenesCompra/oc-multi-${id}`, {negocioId: businessId, proveedorId: id}],
        [`compras/compra-multi-${id}`, {negocioId: businessId, proveedorId: id}],
      ],
      message: /1 orden de compra, 1 compra\./,
    },
  ];
  for (const [index, scenario] of dependencyCases.entries()) {
    const target = await createProvider(`Proveedor Dependencia ${index}`);
    const seeded = scenario.seed(target.proveedorId);
    await Promise.all(seeded.map(([path, data]) => adminDb.doc(`negocios/${businessId}/${path}`).set(data)));
    const error = await expectCallableError(
      `con ${scenario.label}`,
      () => remove(index % 2 === 0 ? owner : admin, target.proveedorId),
      ["failed-precondition"],
      scenario.message
    );
    assert.match(String(error.message), /Archívalo/);
    assert.ok(Array.isArray(error.details?.dependencias) && error.details.dependencias.length >= 1, "el rechazo informa las dependencias");
    assert.ok(await exists(providerPath(target.proveedorId)), "el proveedor sigue existiendo");
    assert.ok(await exists(reservationPath(target.rut)), "la reserva sigue ocupada");
    assert.equal(await createRequestsFor(target.proveedorId), 1, "la solicitud de creación sigue existiendo");
    await Promise.all(seeded.map(([path]) => adminDb.doc(`negocios/${businessId}/${path}`).delete()));
    await remove(owner, target.proveedorId);
    assert.equal(await exists(providerPath(target.proveedorId)), false);
    assert.equal(await exists(reservationPath(target.rut)), false);
  }
  console.log("OK dependencias: cada tipo bloquea con su cantidad y, al quitarlo, el borrado procede");

  // Dependencias reales creadas por las Functions: una orden de compra de verdad bloquea.
  const withOrder = await createProvider("Proveedor Con Orden Real");
  const realOrder = await call(owner, "crearOrdenCompra")({
    businessId,
    requestId: `real-order-${RUN_ID}`,
    ordenCompra: orderPayload(withOrder.proveedorId, itemId),
  });
  assert.equal(realOrder.data.ordenCompra.proveedorId, withOrder.proveedorId);
  await expectCallableError("orden de compra real", () => remove(owner, withOrder.proveedorId), ["failed-precondition"], /1 orden de compra\b/);
  assert.ok(await exists(providerPath(withOrder.proveedorId)));
  console.log("OK dependencias: una orden de compra creada por la Function bloquea la eliminación");

  // Otro negocio con un documento que apunta a un id igual no bloquea (aislamiento).
  const isolated = await createProvider("Proveedor Aislado");
  await adminDb.doc(`negocios/${otherBusinessId}/ordenesCompra/oc-ajena-${RUN_ID}`).set({negocioId: otherBusinessId, proveedorId: isolated.proveedorId});
  await remove(owner, isolated.proveedorId);
  assert.equal(await exists(providerPath(isolated.proveedorId)), false);
  console.log("OK multiempresa: documentos de otro negocio no bloquean ni se tocan");

  // 6. Carrera: crear una orden de compra mientras se elimina el proveedor. Nunca
  // puede quedar una orden apuntando a un proveedor inexistente.
  const ROUNDS = 10;
  const outcomes = {ordenGanó: 0, borradoGanó: 0};
  for (let round = 0; round < ROUNDS; round += 1) {
    const target = await createProvider(`Proveedor Carrera ${round}`);
    const delay = [0, 0, 15, 40, 80][round % 5];
    const orderCall = () => call(owner, "crearOrdenCompra")({
      businessId,
      requestId: `race-order-${RUN_ID}-${round}`,
      ordenCompra: orderPayload(target.proveedorId, itemId),
    });
    const deleteCall = () => remove(round % 2 === 0 ? admin : owner, target.proveedorId);
    const [orderResult, deleteResult] = await Promise.allSettled(
      round % 2 === 0
        ? [orderCall(), new Promise((resolve) => setTimeout(resolve, delay)).then(deleteCall)]
        : [new Promise((resolve) => setTimeout(resolve, delay)).then(orderCall), deleteCall()]
    );
    const orders = await adminDb.collection(`negocios/${businessId}/ordenesCompra`).where("proveedorId", "==", target.proveedorId).get();
    const providerExists = await exists(providerPath(target.proveedorId));
    const reservationExists = await exists(reservationPath(target.rut));

    // Invariante: ninguna orden sin proveedor, y exactamente una de las dos operaciones gana.
    assert.ok(!(orders.size > 0 && !providerExists), `ronda ${round}: una orden quedó apuntando a un proveedor inexistente`);
    assert.equal(providerExists, reservationExists, `ronda ${round}: proveedor y reserva deben coexistir o desaparecer juntos`);
    assert.ok(orders.size <= 1, `ronda ${round}: orden duplicada`);
    if (deleteResult.status === "fulfilled") {
      assert.equal(orderResult.status, "rejected", `ronda ${round}: se borró el proveedor y aun así se creó la orden`);
      assert.equal(orders.size, 0);
      assert.equal(providerExists, false);
      assert.match(String(orderResult.reason?.code || ""), /not-found|failed-precondition/);
      outcomes.borradoGanó += 1;
    } else {
      assert.equal(orderResult.status, "fulfilled", `ronda ${round}: ni se creó la orden ni se borró el proveedor`);
      assert.match(String(deleteResult.reason?.code || ""), /failed-precondition/);
      assert.match(String(deleteResult.reason?.message || ""), /1 orden de compra\b/);
      assert.equal(orders.size, 1);
      assert.equal(providerExists, true);
      outcomes.ordenGanó += 1;
    }
  }
  console.log(`OK carrera: ${ROUNDS} rondas sin órdenes huérfanas (orden ganó ${outcomes.ordenGanó}, borrado ganó ${outcomes.borradoGanó})`);

  console.log("PROVIDER_DELETE_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
