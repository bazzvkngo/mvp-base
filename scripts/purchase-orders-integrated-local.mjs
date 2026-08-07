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
  doc,
  getDoc,
  getFirestore,
  setDoc,
  terminate,
  updateDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
    appId: `purchase-orders-${name}-${RUN_ID}`,
  }, `purchase-orders-${name}-${RUN_ID}`);
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
    `purchase-orders-${label}-${RUN_ID}@example.test`,
    `PurchaseOrders-${RUN_ID}-Pass!`
  );
  client.uid = credential.user.uid;
  return client;
}

const call = (client, name) => httpsCallable(client.functions, name);

async function expectCallableError(label, operation, expected, messagePattern) {
  try {
    await operation();
  } catch (error) {
    assert.ok(expected.some((code) => String(error?.code || "").includes(code)),
      `${label}: código inesperado ${error?.code}`);
    if (messagePattern) assert.match(String(error?.message || ""), messagePattern);
    console.log(`OK rechazo: ${label}`);
    return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    assert.match(String(error?.code || ""), /permission-denied/);
    console.log(`OK reglas: ${label}`);
    return;
  }
  throw new Error(`Se esperaba denegación: ${label}`);
}

function orderPayload(proveedorId, itemId, overrides = {}) {
  return {
    proveedorId,
    fechaEntregaEstimada: "2026-09-10",
    direccionEntrega: "Bodega central 123",
    condicionesPago: "30 días",
    observaciones: "Entregar en horario hábil",
    items: [{
      lineaId: "linea-principal",
      itemId,
      cantidad: 2,
      costoUnitario: 10000,
      descuentoPct: 10,
      nombre: "Nombre manipulado",
      codigo: "COD-MANIPULADO",
      inventarioSnapshot: {nombre: "Snapshot manipulado"},
      totalLinea: 1,
    }],
    numero: "OC-FAKE",
    estado: "emitida",
    proveedorSnapshot: {razonSocial: "Proveedor manipulado"},
    total: 1,
    ...overrides,
  };
}

const owner = await authenticate(createClient("owner"), "owner");
const admin = await authenticate(createClient("admin"), "admin");
const member = await authenticate(createClient("member"), "member");
const outsider = await authenticate(createClient("outsider"), "outsider");
const clients = [owner, admin, member, outsider];
const adminApp = initializeAdminApp(
  {projectId: PROJECT_ID},
  `purchase-orders-admin-${RUN_ID}`
);
const adminDb = getAdminFirestore(adminApp);

try {
  const businessResponse = await call(owner, "createFirstBusiness")({
    nombreComercial: "Negocio órdenes principal",
    rubroCodigo: "SERVICIOS_PROFESIONALES",
    regionCodigo: "13",
    requestId: `business-main-${RUN_ID}`,
  });
  const businessId = businessResponse.data.business.id;
  const otherResponse = await call(outsider, "createFirstBusiness")({
    nombreComercial: "Negocio órdenes externo",
    rubroCodigo: "SERVICIOS_PROFESIONALES",
    regionCodigo: "13",
    requestId: `business-other-${RUN_ID}`,
  });
  const otherBusinessId = otherResponse.data.business.id;

  await Promise.all([
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({
      negocioId: businessId, uid: admin.uid, rol: "ADMIN", estado: "activo",
    }),
    adminDb.doc(`membresias/${businessId}__${member.uid}`).set({
      negocioId: businessId, uid: member.uid, rol: "MEMBER", estado: "activo",
    }),
  ]);

  const providerId = `provider-${RUN_ID}`;
  const providerBId = `provider-b-${RUN_ID}`;
  const archivedProviderId = `provider-archived-${RUN_ID}`;
  const itemId = `item-${RUN_ID}`;
  const itemBId = `item-b-${RUN_ID}`;
  const archivedItemId = `item-archived-${RUN_ID}`;
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/proveedores/${providerId}`).set({
      proveedorId: providerId,
      negocioId: businessId,
      estado: "activo",
      rut: "12.345.678-5",
      razonSocial: "Proveedor Original SpA",
      email: "original@example.test",
      direccion: "Dirección original 100",
      regionCodigo: "13",
      regionNombre: "Metropolitana de Santiago",
      comunaCodigo: "13101",
      comunaNombre: "Santiago",
      condicionesPago: "crédito",
      diasCredito: 30,
    }),
    adminDb.doc(`negocios/${businessId}/proveedores/${providerBId}`).set({
      proveedorId: providerBId,
      negocioId: businessId,
      estado: "activo",
      rut: "76.111.111-9",
      razonSocial: "Proveedor B SpA",
    }),
    adminDb.doc(`negocios/${businessId}/proveedores/${archivedProviderId}`).set({
      proveedorId: archivedProviderId,
      negocioId: businessId,
      estado: "archivado",
      rut: "77.222.222-2",
      razonSocial: "Proveedor Archivado",
    }),
    adminDb.doc(`negocios/${businessId}/inventario/${itemId}`).set({
      negocioId: businessId,
      estado: "activo",
      codigoInterno: "PR-0001",
      nombre: "Producto original",
      descripcion: "Descripción original",
      tipoItem: "producto",
      unidad: "unidad",
      costoBase: 8500,
    }),
    adminDb.doc(`negocios/${businessId}/inventario/${itemBId}`).set({
      negocioId: businessId,
      estado: "activo",
      codigoInterno: "SV-0002",
      nombre: "Servicio B",
      tipoItem: "servicio",
      unidad: "servicio",
      costoBase: 5000,
    }),
    adminDb.doc(`negocios/${businessId}/inventario/${archivedItemId}`).set({
      negocioId: businessId,
      estado: "inactivo",
      codigoInterno: "PR-0999",
      nombre: "Producto archivado",
      tipoItem: "producto",
      unidad: "unidad",
    }),
    adminDb.doc(`negocios/${otherBusinessId}/proveedores/foreign-provider`).set({
      proveedorId: "foreign-provider",
      negocioId: otherBusinessId,
      estado: "activo",
      razonSocial: "Proveedor externo",
    }),
    adminDb.doc(`negocios/${otherBusinessId}/inventario/foreign-item`).set({
      negocioId: otherBusinessId,
      estado: "activo",
      nombre: "Ítem externo",
      tipoItem: "producto",
      unidad: "unidad",
    }),
  ]);

  const requestId = `create-main-${RUN_ID}`;
  const createResult = await call(owner, "crearOrdenCompra")({
    businessId,
    requestId,
    ordenCompra: orderPayload(providerId, itemId),
  });
  const created = createResult.data.ordenCompra;
  assert.match(created.numero, /^OC-\d{4}-\d{4}$/);
  assert.equal(created.estado, "borrador");
  assert.equal(created.ordenCompraId, created.id);
  assert.equal(Object.hasOwn(created, "purchaseOrderId"), false);
  assert.equal(created.proveedorSnapshot.razonSocial, "Proveedor Original SpA");
  assert.equal(created.proveedorSnapshot.rut, "12.345.678-5");
  assert.equal(created.proveedorSnapshot.regionCodigo, "13");
  assert.equal(created.items[0].nombre, "Producto original");
  assert.equal(created.items[0].codigo, "PR-0001");
  assert.equal(created.items[0].costoUnitario, 10000);
  assert.equal(created.anio, Number(created.numero.slice(3, 7)));
  assert.equal(created.correlativo, 1);
  assert.deepEqual(
    {subtotal: created.subtotal, descuentoTotal: created.descuentoTotal, neto: created.neto, iva: created.iva, total: created.total},
    {subtotal: 20000, descuentoTotal: 2000, neto: 18000, iva: 3420, total: 21420}
  );
  assert.equal(
    (await adminDb.doc(`negocios/${businessId}/inventario/${itemId}`).get())
      .data().costoBase,
    8500
  );
  console.log("OK autoridad: snapshots y totales reconstruidos por backend");

  const otherOrder = await call(outsider, "crearOrdenCompra")({
    businessId: otherBusinessId,
    requestId: `other-create-${RUN_ID}`,
    ordenCompra: orderPayload("foreign-provider", "foreign-item"),
  });
  assert.equal(otherOrder.data.ordenCompra.correlativo, 1);
  assert.equal(otherOrder.data.ordenCompra.numero, created.numero);
  console.log("OK multiempresa: cada negocio tiene correlativo independiente");

  const retry = await call(owner, "crearOrdenCompra")({
    businessId,
    requestId,
    ordenCompra: orderPayload(providerId, itemId),
  });
  assert.equal(retry.data.idempotent, true);
  assert.equal(retry.data.ordenCompra.id, created.id);
  assert.equal(retry.data.ordenCompra.numero, created.numero);
  await expectCallableError("requestId reutilizado con otros datos", () =>
    call(owner, "crearOrdenCompra")({
      businessId,
      requestId,
      ordenCompra: orderPayload(providerId, itemId, {observaciones: "Otro contenido"}),
    }), ["already-exists"]);
  console.log("OK idempotencia: reintento conserva documento y número");

  await expectCallableError("MEMBER no crea", () => call(member, "crearOrdenCompra")({
    businessId, requestId: `member-${RUN_ID}`, ordenCompra: orderPayload(providerId, itemId),
  }), ["permission-denied"]);
  await expectCallableError("externo no crea", () => call(outsider, "crearOrdenCompra")({
    businessId, requestId: `outsider-${RUN_ID}`, ordenCompra: orderPayload(providerId, itemId),
  }), ["permission-denied"]);
  await expectCallableError("proveedor archivado no se selecciona", () =>
    call(owner, "crearOrdenCompra")({businessId, requestId: `arch-provider-${RUN_ID}`, ordenCompra: orderPayload(archivedProviderId, itemId)}),
  ["failed-precondition"]);
  await expectCallableError("ítem archivado no se agrega", () =>
    call(owner, "crearOrdenCompra")({businessId, requestId: `arch-item-${RUN_ID}`, ordenCompra: orderPayload(providerId, archivedItemId)}),
  ["failed-precondition"]);
  await expectCallableError("proveedor de otro negocio no se usa", () =>
    call(owner, "crearOrdenCompra")({businessId, requestId: `foreign-provider-${RUN_ID}`, ordenCompra: orderPayload("foreign-provider", itemId)}),
  ["not-found"]);
  await expectCallableError("ítem de otro negocio no se usa", () =>
    call(owner, "crearOrdenCompra")({businessId, requestId: `foreign-item-${RUN_ID}`, ordenCompra: orderPayload(providerId, "foreign-item")}),
  ["not-found"]);
  await expectCallableError("overflow monetario se rechaza", () =>
    call(owner, "crearOrdenCompra")({
      businessId,
      requestId: `overflow-${RUN_ID}`,
      ordenCompra: orderPayload(providerId, itemId, {
        items: [{
          lineaId: "linea-overflow",
          itemId,
          cantidad: 2,
          costoUnitario: Number.MAX_VALUE,
          descuentoPct: 0,
        }],
      }),
    }),
  ["invalid-argument"], /El monto de la orden supera el máximo permitido\./);

  await Promise.all([
    adminDb.doc(`negocios/${businessId}/proveedores/${providerId}`).update({
      estado: "archivado",
      razonSocial: "Proveedor cambiado después",
      email: "nuevo@example.test",
    }),
    adminDb.doc(`negocios/${businessId}/inventario/${itemId}`).update({
      estado: "inactivo",
      nombre: "Producto cambiado después",
      codigoInterno: "PR-7777",
    }),
  ]);
  const updated = await call(admin, "actualizarOrdenCompraBorrador")({
    businessId,
    ordenCompraId: created.id,
    ordenCompra: orderPayload(providerId, itemId, {
      condicionesPago: "45 días",
      items: [{
        lineaId: "linea-principal",
        itemId,
        cantidad: 3,
        costoUnitario: 12000,
        descuentoPct: 0,
        nombre: "Manipulado de nuevo",
      }],
    }),
  });
  assert.equal(updated.data.ordenCompra.proveedorSnapshot.razonSocial, "Proveedor Original SpA");
  assert.equal(updated.data.ordenCompra.items[0].nombre, "Producto original");
  assert.equal(updated.data.ordenCompra.items[0].codigo, "PR-0001");
  assert.equal(updated.data.ordenCompra.total, 42840);
  console.log("OK historial: mismos vínculos conservan snapshots aunque se archiven/cambien");

  const changed = await call(owner, "actualizarOrdenCompraBorrador")({
    businessId,
    ordenCompraId: created.id,
    ordenCompra: orderPayload(providerBId, itemBId, {
      items: [{
        lineaId: "linea-nueva",
        itemId: itemBId,
        cantidad: 1,
        costoUnitario: 7000,
        descuentoPct: 0,
      }],
    }),
  });
  assert.equal(changed.data.ordenCompra.proveedorSnapshot.razonSocial, "Proveedor B SpA");
  assert.equal(changed.data.ordenCompra.items[0].nombre, "Servicio B");
  console.log("OK edición: cambio explícito reconstruye snapshots activos");

  const concurrent = await Promise.all(Array.from({length: 5}, (_, index) =>
    call(index % 2 ? admin : owner, "crearOrdenCompra")({
      businessId,
      requestId: `concurrent-${index}-${RUN_ID}`,
      ordenCompra: orderPayload(providerBId, itemBId, {
        observaciones: `Concurrente ${index}`,
      }),
    })
  ));
  const numbers = concurrent.map((result) => result.data.ordenCompra.numero);
  assert.equal(new Set(numbers).size, numbers.length);
  console.log("OK concurrencia: numeración transaccional distinta por negocio/año");

  const emitted = await call(owner, "emitirOrdenCompra")({
    businessId, ordenCompraId: created.id,
  });
  assert.equal(emitted.data.ordenCompra.estado, "emitida");
  const emittedRetry = await call(owner, "emitirOrdenCompra")({
    businessId, ordenCompraId: created.id,
  });
  assert.equal(emittedRetry.data.idempotent, true);
  await expectCallableError("emitida no se edita", () =>
    call(owner, "actualizarOrdenCompraBorrador")({businessId, ordenCompraId: created.id, ordenCompra: orderPayload(providerBId, itemBId)}),
  ["failed-precondition"]);
  const cancelled = await call(admin, "cancelarOrdenCompra")({
    businessId, ordenCompraId: created.id,
  });
  assert.equal(cancelled.data.ordenCompra.estado, "cancelada");
  const cancelRetry = await call(admin, "cancelarOrdenCompra")({
    businessId, ordenCompraId: created.id,
  });
  assert.equal(cancelRetry.data.idempotent, true);
  console.log("OK estados: borrador → emitida → cancelada, con reintentos idempotentes");

  const orderPath = `negocios/${businessId}/ordenesCompra/${created.id}`;
  assert.equal((await getDoc(doc(member.db, orderPath))).exists(), true);
  await expectDenied("externo no lee la orden", () => getDoc(doc(outsider.db, orderPath)));
  await expectDenied("cliente no crea orden directa", () => setDoc(
    doc(owner.db, `negocios/${businessId}/ordenesCompra/direct-${RUN_ID}`),
    {negocioId: businessId}
  ));
  await expectDenied("cliente no actualiza orden directa", () => updateDoc(
    doc(owner.db, orderPath), {estado: "borrador"}
  ));
  await expectDenied("contador interno no se lee", () => getDoc(
    doc(owner.db, `negocios/${businessId}/purchaseOrderCounters/2026`)
  ));
  await expectDenied("request interno no se lee", () => getDoc(
    doc(owner.db, `negocios/${businessId}/purchaseOrderCreateRequests/${requestId}`)
  ));
  console.log("OK reglas: MEMBER lee; escrituras directas e internos quedan cerrados");

  console.log("PURCHASE_ORDERS_INTEGRATED_OK");
} finally {
  await Promise.all(clients.map(async (client) => {
    await terminate(client.db).catch(() => {});
    await deleteApp(client.app).catch(() => {});
  }));
  await deleteAdminApp(adminApp).catch(() => {});
}
