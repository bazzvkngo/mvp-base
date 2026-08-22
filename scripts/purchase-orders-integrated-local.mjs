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
  const companyProfileA = {
    negocioId: businessId,
    nombreComercial: "Empresa A",
    razonSocial: "Empresa Histórica A SpA",
    identificadorFiscalTipo: "RUT",
    identificadorFiscalValor: "76.300.300-3",
  };
  const companyProfileB = {...companyProfileA, nombreComercial: "Empresa B", razonSocial: "Empresa Vigente B SpA"};

  await Promise.all([
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({
      negocioId: businessId, uid: admin.uid, rol: "ADMIN", estado: "activo",
    }),
    adminDb.doc(`membresias/${businessId}__${member.uid}`).set({
      negocioId: businessId, uid: member.uid, rol: "MEMBER", estado: "activo",
    }),
    adminDb.doc(`negocios/${businessId}/empresa/perfil`).set(companyProfileA, {merge: true}),
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
  assert.equal(created.empresaSnapshot.razonSocial, companyProfileA.razonSocial);
  await adminDb.doc(`negocios/${businessId}/empresa/perfil`).set(companyProfileB);
  assert.equal((await adminDb.doc(`negocios/${businessId}/ordenesCompra/${created.id}`).get()).data().empresaSnapshot.razonSocial, companyProfileA.razonSocial);
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

  const emailDraftId = concurrent[0].data.ordenCompra.id;
  const simulatedEmail = await call(owner, "sendPurchaseOrderEmail")({
    businessId,
    ordenCompraId: emailDraftId,
    emailProveedor: "compras@proveedor.test",
    pdfBase64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
    pdfFilename: `${concurrent[0].data.ordenCompra.numero}.pdf`,
    pdfMimeType: "application/pdf",
  });
  assert.equal(simulatedEmail.data.simulated, true);
  assert.equal((await adminDb.doc(
    `negocios/${businessId}/ordenesCompra/${emailDraftId}`
  ).get()).data().estado, "borrador");
  await expectCallableError("MEMBER no envía OC por correo", () =>
    call(member, "sendPurchaseOrderEmail")({
      businessId,
      ordenCompraId: emailDraftId,
      emailProveedor: "compras@proveedor.test",
      pdfBase64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
      pdfFilename: "orden.pdf",
      pdfMimeType: "application/pdf",
    }),
  ["permission-denied"]);
  console.log("OK correo OC: simulación local conserva pendiente y MEMBER es rechazado");

  const emitted = await call(owner, "emitirOrdenCompra")({
    businessId, ordenCompraId: created.id,
  });
  assert.equal(emitted.data.ordenCompra.estado, "emitida");
  const emittedRetry = await call(owner, "emitirOrdenCompra")({
    businessId, ordenCompraId: created.id,
  });
  assert.equal(emittedRetry.data.idempotent, true);
  const whatsAppResend = await call(owner, "emitirOrdenCompra")({
    businessId,
    ordenCompraId: created.id,
    canalEmision: "whatsapp",
    destinatario: "+56 9 1234 5678",
  });
  assert.equal(whatsAppResend.data.idempotent, false);
  assert.equal(whatsAppResend.data.ordenCompra.estado, "emitida");
  assert.equal(whatsAppResend.data.ordenCompra.ultimoCanalEnvio, "whatsapp");
  assert.equal(whatsAppResend.data.ordenCompra.cantidadEnvios, 2);
  await expectCallableError("emitida no se edita", () =>
    call(owner, "actualizarOrdenCompraBorrador")({businessId, ordenCompraId: created.id, ordenCompra: orderPayload(providerBId, itemBId)}),
  ["failed-precondition"]);
  await expectCallableError("borrador se edita y no se duplica", () =>
    call(owner, "duplicarOrdenCompraComoBorrador")({
      businessId,
      sourceId: concurrent[0].data.ordenCompra.id,
      requestId: `duplicate-draft-${RUN_ID}`,
    }),
  ["failed-precondition"]);

  const itemBRef = adminDb.doc(
    `negocios/${businessId}/inventario/${itemBId}`
  );
  const ordersBeforeInactiveItem = await adminDb.collection(
    `negocios/${businessId}/ordenesCompra`
  ).get();
  const counterRef = adminDb.doc(
    `negocios/${businessId}/purchaseOrderCounters/${created.anio}`
  );
  const counterBeforeInactiveItem = await counterRef.get();
  await itemBRef.update({estado: "inactivo"});
  await expectCallableError("ítem original inactivo bloquea la copia", () =>
    call(owner, "duplicarOrdenCompraComoBorrador")({
      businessId,
      sourceId: created.id,
      requestId: `duplicate-inactive-item-${RUN_ID}`,
    }),
  ["failed-precondition"]);
  const ordersAfterInactiveItem = await adminDb.collection(
    `negocios/${businessId}/ordenesCompra`
  ).get();
  const counterAfterInactiveItem = await counterRef.get();
  assert.equal(ordersAfterInactiveItem.size, ordersBeforeInactiveItem.size);
  assert.equal(
    counterAfterInactiveItem.data().lastNumber,
    counterBeforeInactiveItem.data().lastNumber
  );
  await itemBRef.update({estado: "activo"});
  console.log("OK duplicación rechazada: ítem inactivo no crea orden ni consume correlativo");

  const sourceRef = adminDb.doc(
    `negocios/${businessId}/ordenesCompra/${created.id}`
  );
  const sourceBeforeDuplicate = await sourceRef.get();
  const inventoryBeforeDuplicate = await adminDb.doc(
    `negocios/${businessId}/inventario/${itemBId}`
  ).get();
  const movementsBeforeDuplicate = await adminDb.collection(
    `negocios/${businessId}/financialMovements`
  ).get();
  const duplicateRequestId = `duplicate-emitted-${RUN_ID}`;
  const [duplicatedEmitted, duplicatedRetry] = await Promise.all([
    call(owner, "duplicarOrdenCompraComoBorrador")({
      businessId,
      sourceId: created.id,
      requestId: duplicateRequestId,
      ordenCompra: orderPayload(archivedProviderId, archivedItemId, {
        total: 1,
      }),
      proveedorSnapshot: {razonSocial: "Proveedor falsificado"},
    }),
    call(owner, "duplicarOrdenCompraComoBorrador")({
      businessId,
      sourceId: created.id,
      requestId: duplicateRequestId,
    }),
  ]);
  const emittedCopy = duplicatedEmitted.data.ordenCompra;
  assert.equal(emittedCopy.id, duplicatedRetry.data.ordenCompra.id);
  assert.notEqual(emittedCopy.id, created.id);
  assert.notEqual(emittedCopy.numero, sourceBeforeDuplicate.data().numero);
  assert.equal(emittedCopy.estado, "borrador");
  assert.equal(emittedCopy.ordenCompraOrigenId, created.id);
  assert.equal(
    emittedCopy.ordenCompraOrigenNumero,
    sourceBeforeDuplicate.data().numero
  );
  assert.equal(emittedCopy.proveedorId, providerBId);
  assert.equal(emittedCopy.proveedorSnapshot.razonSocial, "Proveedor B SpA");
  assert.notEqual(emittedCopy.proveedorSnapshot.razonSocial, "Proveedor falsificado");
  assert.equal(emittedCopy.empresaSnapshot.razonSocial, companyProfileB.razonSocial);
  assert.equal(emittedCopy.items[0].itemId, itemBId);
  assert.equal(emittedCopy.items[0].nombre, "Servicio B");
  assert.equal(emittedCopy.items[0].costoUnitario, 7000);
  assert.deepEqual(
    {
      subtotal: emittedCopy.subtotal,
      descuentoTotal: emittedCopy.descuentoTotal,
      neto: emittedCopy.neto,
      iva: emittedCopy.iva,
      total: emittedCopy.total,
    },
    {subtotal: 7000, descuentoTotal: 0, neto: 7000, iva: 1330, total: 8330}
  );
  const sourceAfterDuplicate = await sourceRef.get();
  assert.equal(
    sourceAfterDuplicate.updateTime.toMillis(),
    sourceBeforeDuplicate.updateTime.toMillis()
  );
  assert.deepEqual(sourceAfterDuplicate.data(), sourceBeforeDuplicate.data());
  const inventoryAfterDuplicate = await adminDb.doc(
    `negocios/${businessId}/inventario/${itemBId}`
  ).get();
  assert.equal(
    inventoryAfterDuplicate.updateTime.toMillis(),
    inventoryBeforeDuplicate.updateTime.toMillis()
  );
  assert.deepEqual(inventoryAfterDuplicate.data(), inventoryBeforeDuplicate.data());
  assert.equal(
    (await adminDb.collection(`negocios/${businessId}/financialMovements`).get()).size,
    movementsBeforeDuplicate.size
  );
  assert.equal(
    (await adminDb.collection(`negocios/${businessId}/compras`).get()).size,
    0
  );
  console.log("OK duplicación emitida: copia independiente, recalculada y sin stock/compras");

  await expectCallableError("MEMBER no duplica", () =>
    call(member, "duplicarOrdenCompraComoBorrador")({
      businessId,
      sourceId: created.id,
      requestId: `duplicate-member-${RUN_ID}`,
    }),
  ["permission-denied"]);
  await expectCallableError("orden de otro negocio no se duplica", () =>
    call(outsider, "duplicarOrdenCompraComoBorrador")({
      businessId: otherBusinessId,
      sourceId: created.id,
      requestId: `duplicate-cross-${RUN_ID}`,
    }),
  ["not-found"]);

  const cancelled = await call(admin, "cancelarOrdenCompra")({
    businessId, ordenCompraId: created.id,
  });
  assert.equal(cancelled.data.ordenCompra.estado, "cancelada");
  const cancelRetry = await call(admin, "cancelarOrdenCompra")({
    businessId, ordenCompraId: created.id,
  });
  assert.equal(cancelRetry.data.idempotent, true);
  const duplicatedCancelled = await call(admin, "duplicarOrdenCompraComoBorrador")({
    businessId,
    sourceId: created.id,
    requestId: `duplicate-cancelled-${RUN_ID}`,
  });
  assert.equal(duplicatedCancelled.data.ordenCompra.estado, "borrador");
  assert.notEqual(duplicatedCancelled.data.ordenCompra.id, emittedCopy.id);
  assert.notEqual(duplicatedCancelled.data.ordenCompra.numero, cancelled.data.ordenCompra.numero);
  assert.equal(duplicatedCancelled.data.ordenCompra.ordenCompraOrigenId, created.id);
  console.log("OK estados y duplicación: emitida/cancelada generan borradores nuevos");

  await adminDb.doc(`negocios/${businessId}/proveedores/${providerBId}`).update({
    estado: "archivado",
  });
  await expectCallableError("proveedor original archivado bloquea la copia", () =>
    call(owner, "duplicarOrdenCompraComoBorrador")({
      businessId,
      sourceId: created.id,
      requestId: `duplicate-archived-provider-${RUN_ID}`,
    }),
  ["failed-precondition"], /proveedor.*archivado/i);

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
  await expectDenied("request de duplicación no se lee", () => getDoc(
    doc(owner.db, `negocios/${businessId}/purchaseOrderDuplicateRequests/${duplicateRequestId}`)
  ));
  await expectDenied("intento de correo OC no se lee", () => getDoc(
    doc(owner.db, `negocios/${businessId}/purchaseOrderEmailAttempts/${emailDraftId}`)
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
