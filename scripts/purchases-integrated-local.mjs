import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {
  collection, connectFirestoreEmulator, doc, getDoc, getDocs,
  getFirestore, query, setDoc, terminate, updateDoc, where,
} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function createClient(name) {
  const app = initializeApp({
    apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID, appId: `purchases-${name}-${RUN_ID}`,
  }, `purchases-${name}-${RUN_ID}`);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {app, auth, db, functions};
}
async function authenticate(client, label) {
  const credential = await createUserWithEmailAndPassword(client.auth, `purchases-${label}-${RUN_ID}@example.test`, `Purchases-${RUN_ID}-Pass!`);
  client.uid = credential.user.uid;
  return client;
}
const call = (client, name) => httpsCallable(client.functions, name);
async function expectCallableError(label, operation, expected) {
  try { await operation(); } catch (error) {
    assert.ok(expected.some((code) => String(error?.code || "").includes(code)), `${label}: código inesperado ${error?.code} ${error?.message}`);
    console.log(`OK rechazo: ${label}`); return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}
async function expectDenied(label, operation) {
  try { await operation(); } catch (error) {
    assert.match(String(error?.code || ""), /permission-denied/); console.log(`OK reglas: ${label}`); return;
  }
  throw new Error(`Se esperaba denegación: ${label}`);
}
const requestId = (prefix) => `${prefix}-${RUN_ID}-${Math.random().toString(36).slice(2, 10)}`;
const line = (itemId, lineaId, overrides = {}) => ({lineaId, itemId, cantidad: 2, costoUnitario: 10000, descuentoPct: 10, stockAnterior: 500, stockPosterior: 9999, tipo: "entrada_compra", nombre: "Nombre falso", totalLinea: 1, ...overrides});
const purchasePayload = (providerId, items, overrides = {}) => ({
  proveedorId: providerId, fechaCompra: "2026-08-07", fechaDocumento: "2026-08-06",
  tipoDocumento: "factura", numeroDocumentoProveedor: "F-100", condicionesPago: "30 días",
  observaciones: "Recepción en bodega", items, numero: "COM-FAKE", estado: "confirmada",
  proveedorSnapshot: {razonSocial: "Manipulado"}, stockAplicado: true, total: 1, ...overrides,
});

const owner = await authenticate(createClient("owner"), "owner");
const admin = await authenticate(createClient("admin"), "admin");
const member = await authenticate(createClient("member"), "member");
const outsider = await authenticate(createClient("outsider"), "outsider");
const clients = [owner, admin, member, outsider];
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `purchases-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

try {
  const mainResult = await call(owner, "createFirstBusiness")({nombreComercial: "Negocio compras", rubroCodigo: "SERVICIOS_PROFESIONALES", regionCodigo: "13", requestId: requestId("business-main")});
  const otherResult = await call(outsider, "createFirstBusiness")({nombreComercial: "Negocio compras externo", rubroCodigo: "SERVICIOS_PROFESIONALES", regionCodigo: "13", requestId: requestId("business-other")});
  const businessId = mainResult.data.business.id; const otherBusinessId = otherResult.data.business.id;
  const companyProfile = {negocioId: businessId, nombreComercial: "Empresa Compradora", razonSocial: "Empresa Compradora SpA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.500.500-5"};
  await Promise.all([
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({negocioId: businessId, uid: admin.uid, rol: "ADMIN", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${member.uid}`).set({negocioId: businessId, uid: member.uid, rol: "MEMBER", estado: "activo"}),
    adminDb.doc(`negocios/${businessId}/empresa/perfil`).set(companyProfile, {merge: true}),
  ]);

  const providerId = `provider-${RUN_ID}`; const providerBId = `provider-b-${RUN_ID}`; const providerOtherId = `provider-other-${RUN_ID}`;
  const productA = `product-a-${RUN_ID}`; const productB = `product-b-${RUN_ID}`;
  const serviceId = `service-${RUN_ID}`; const activityId = `activity-${RUN_ID}`;
  const inactiveProduct = `inactive-${RUN_ID}`; const crossItem = `cross-${RUN_ID}`;
  const providerFixture = {proveedorId: providerId, negocioId: businessId, estado: "activo", rut: "76.000.000-0", razonSocial: "Proveedor Autoritativo SpA", email: "proveedor@example.test", condicionesPago: "crédito"};
  const itemFixture = (itemId, tipoItem, nombre, stock) => ({itemId, negocioId: businessId, estado: "activo", tipoItem, nombre, codigoInterno: itemId.toUpperCase(), unidad: tipoItem === "producto" ? "unidad" : "servicio", costoBase: 777, ...(tipoItem === "producto" ? {stock} : {})});
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/proveedores/${providerId}`).set(providerFixture),
    adminDb.doc(`negocios/${businessId}/proveedores/${providerBId}`).set({...providerFixture, proveedorId: providerBId, razonSocial: "Proveedor B SpA", rut: "77.000.000-1"}),
    adminDb.doc(`negocios/${otherBusinessId}/proveedores/${providerOtherId}`).set({...providerFixture, proveedorId: providerOtherId, negocioId: otherBusinessId, razonSocial: "Proveedor externo"}),
    adminDb.doc(`negocios/${businessId}/proveedores/${providerOtherId}`).set({...providerFixture, proveedorId: providerOtherId, negocioId: otherBusinessId}),
    adminDb.doc(`negocios/${businessId}/inventario/${productA}`).set(itemFixture(productA, "producto", "Producto A", 8)),
    adminDb.doc(`negocios/${businessId}/inventario/${productB}`).set(itemFixture(productB, "producto", "Producto B", 3)),
    adminDb.doc(`negocios/${businessId}/inventario/${serviceId}`).set(itemFixture(serviceId, "servicio", "Servicio técnico")),
    adminDb.doc(`negocios/${businessId}/inventario/${activityId}`).set(itemFixture(activityId, "actividad", "Actividad")),
    adminDb.doc(`negocios/${businessId}/inventario/${inactiveProduct}`).set({...itemFixture(inactiveProduct, "producto", "Producto histórico", 4), estado: "archivado"}),
    adminDb.doc(`negocios/${businessId}/inventario/${crossItem}`).set({...itemFixture(crossItem, "producto", "Producto externo", 0), negocioId: otherBusinessId}),
    adminDb.doc(`negocios/${otherBusinessId}/inventario/${productA}`).set({...itemFixture(productA, "producto", "Producto externo real", 20), negocioId: otherBusinessId}),
  ]);

  const ownerCreateId = requestId("create-owner");
  const ownerCreated = await call(owner, "crearCompra")({businessId, requestId: ownerCreateId, compra: purchasePayload(providerId, [line(productA, "line-main"), line(serviceId, "line-service", {cantidad: 1}), line(activityId, "line-activity", {cantidad: 1})])});
  assert.equal(ownerCreated.data.compra.numero, "COM-2026-0001");
  assert.equal(ownerCreated.data.compra.estado, "borrador");
  assert.equal(ownerCreated.data.compra.proveedorSnapshot.razonSocial, "Proveedor Autoritativo SpA");
  assert.equal(ownerCreated.data.compra.empresaSnapshot.razonSocial, companyProfile.razonSocial);
  assert.equal(ownerCreated.data.compra.items[0].nombre, "Producto A");
  assert.equal(ownerCreated.data.compra.total, 42840);
  assert.equal(ownerCreated.data.compra.stockAplicado, false);
  const ownerRetry = await call(owner, "crearCompra")({businessId, requestId: ownerCreateId, compra: purchasePayload(providerId, [line(productA, "line-main"), line(serviceId, "line-service", {cantidad: 1}), line(activityId, "line-activity", {cantidad: 1})])});
  assert.equal(ownerRetry.data.compra.id, ownerCreated.data.compra.id);
  assert.equal(ownerRetry.data.idempotent, true);
  console.log("OK compra directa OWNER, autoridad e idempotencia de creación");

  const otherCreated = await call(outsider, "crearCompra")({businessId: otherBusinessId, requestId: requestId("other-create"), compra: purchasePayload(providerOtherId, [line(productA, "other-line")])});
  assert.equal(otherCreated.data.compra.numero, "COM-2026-0001");
  const adminCreated = await call(admin, "crearCompra")({businessId, requestId: requestId("admin-create"), compra: purchasePayload(providerId, [line(productB, "admin-line")])});
  assert.equal(adminCreated.data.compra.numero, "COM-2026-0002");
  assert.equal(ownerCreated.data.compra.modeloCompraVersion, 2);
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/compras/${ownerCreated.data.compra.id}`).update({modeloCompraVersion: 1, stockGestionadoPor: null}),
    adminDb.doc(`negocios/${businessId}/compras/${adminCreated.data.compra.id}`).update({modeloCompraVersion: 1, stockGestionadoPor: null}),
  ]);
  console.log("OK roles OWNER/ADMIN y correlativos independientes por negocio");

  await expectCallableError("MEMBER no crea", () => call(member, "crearCompra")({businessId, requestId: requestId("member-create"), compra: purchasePayload(providerId, [line(productA, "member-line")])}), ["permission-denied"]);
  await expectCallableError("proveedor cruzado", () => call(owner, "crearCompra")({businessId, requestId: requestId("cross-provider"), compra: purchasePayload(providerOtherId, [line(productA, "cross-provider-line")])}), ["failed-precondition", "permission-denied"]);
  await expectCallableError("ítem cruzado", () => call(owner, "crearCompra")({businessId, requestId: requestId("cross-item"), compra: purchasePayload(providerId, [line(crossItem, "cross-item-line")])}), ["failed-precondition", "permission-denied"]);
  await expectCallableError("producto inactivo directo", () => call(owner, "crearCompra")({businessId, requestId: requestId("inactive-direct"), compra: purchasePayload(providerId, [line(inactiveProduct, "inactive-direct-line")])}), ["failed-precondition"]);
  await adminDb.doc(`negocios/${businessId}/inventario/${productB}`).update({estado: "archivado"});
  await expectCallableError("producto directo archivado antes de confirmar", () => call(admin, "confirmarCompra")({businessId, compraId: adminCreated.data.compra.id, requestId: requestId("inactive-before-confirm")}), ["failed-precondition"]);
  await adminDb.doc(`negocios/${businessId}/inventario/${productB}`).update({estado: "activo"});

  const assertNoPartialConfirmation = async (purchaseId, itemId, expectedStock) => {
    assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${itemId}`).get()).data().stock, expectedStock);
    assert.equal((await adminDb.doc(`negocios/${businessId}/compras/${purchaseId}`).get()).data().estado, "borrador");
    assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", purchaseId).get()).size, 0);
  };
  await adminDb.doc(`negocios/${businessId}/proveedores/${providerId}`).update({estado: "archivado"});
  await expectCallableError("proveedor directo archivado antes de confirmar", () => call(owner, "confirmarCompra")({businessId, compraId: ownerCreated.data.compra.id, requestId: requestId("provider-archived-confirm")}), ["failed-precondition"]);
  await assertNoPartialConfirmation(ownerCreated.data.compra.id, productA, 8);
  await adminDb.doc(`negocios/${businessId}/proveedores/${providerId}`).update({estado: "activo"});
  await adminDb.doc(`negocios/${businessId}/inventario/${serviceId}`).update({estado: "archivado"});
  await expectCallableError("servicio directo archivado antes de confirmar", () => call(owner, "confirmarCompra")({businessId, compraId: ownerCreated.data.compra.id, requestId: requestId("service-archived-confirm")}), ["failed-precondition"]);
  await assertNoPartialConfirmation(ownerCreated.data.compra.id, productA, 8);
  await adminDb.doc(`negocios/${businessId}/inventario/${serviceId}`).update({estado: "activo"});
  await adminDb.doc(`negocios/${businessId}/inventario/${activityId}`).update({estado: "archivado"});
  await expectCallableError("actividad directa archivada antes de confirmar", () => call(owner, "confirmarCompra")({businessId, compraId: ownerCreated.data.compra.id, requestId: requestId("activity-archived-confirm")}), ["failed-precondition"]);
  await assertNoPartialConfirmation(ownerCreated.data.compra.id, productA, 8);
  await adminDb.doc(`negocios/${businessId}/inventario/${activityId}`).update({estado: "activo"});
  console.log("OK revalidación directa: proveedor, servicio y actividad activos sin efectos parciales");

  const beforeProduct = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data();
  const confirmId = requestId("confirm-main");
  const confirmed = await call(owner, "confirmarCompra")({businessId, compraId: ownerCreated.data.compra.id, requestId: confirmId});
  assert.equal(confirmed.data.compra.estado, "confirmada"); assert.equal(confirmed.data.compra.stockAplicado, true);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, beforeProduct.stock + 2);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().costoBase, 777);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${serviceId}`).get()).data().stock, undefined);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${activityId}`).get()).data().stock, undefined);
  const movements = await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", ownerCreated.data.compra.id).get();
  assert.equal(movements.size, 1); assert.equal(movements.docs[0].data().tipo, "entrada_compra");
  assert.equal(movements.docs[0].data().cantidad, 2); assert.equal(movements.docs[0].data().stockAnterior, 8); assert.equal(movements.docs[0].data().stockPosterior, 10);
  const retrySame = await call(owner, "confirmarCompra")({businessId, compraId: ownerCreated.data.compra.id, requestId: confirmId});
  const retryOther = await call(owner, "confirmarCompra")({businessId, compraId: ownerCreated.data.compra.id, requestId: requestId("confirm-main-other")});
  assert.equal(retrySame.data.idempotent, true); assert.equal(retryOther.data.idempotent, true);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, beforeProduct.stock + 2);
  console.log("OK confirmación: sólo productos, movimiento inmutable, sin costoBase y doble defensa idempotente");

  const concurrencyPayload = (suffix, quantity) => purchasePayload(providerId, [line(productA, `concurrent-${suffix}`, {cantidad: quantity, descuentoPct: 0})]);
  const [draftTwo, draftFive] = await Promise.all([
    call(owner, "crearCompra")({businessId, requestId: requestId("create-two"), compra: concurrencyPayload("two", 2)}),
    call(admin, "crearCompra")({businessId, requestId: requestId("create-five"), compra: concurrencyPayload("five", 5)}),
  ]);
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/compras/${draftTwo.data.compra.id}`).update({modeloCompraVersion: 1, stockGestionadoPor: null}),
    adminDb.doc(`negocios/${businessId}/compras/${draftFive.data.compra.id}`).update({modeloCompraVersion: 1, stockGestionadoPor: null}),
  ]);
  assert.notEqual(draftTwo.data.compra.numero, draftFive.data.compra.numero);
  const stockBeforeConcurrent = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock;
  await Promise.all([
    call(owner, "confirmarCompra")({businessId, compraId: draftTwo.data.compra.id, requestId: requestId("confirm-two")}),
    call(admin, "confirmarCompra")({businessId, compraId: draftFive.data.compra.id, requestId: requestId("confirm-five")}),
  ]);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, stockBeforeConcurrent + 7);
  console.log("OK concurrencia: dos confirmaciones acumulan stock sin pérdida");

  const multiProduct = await call(owner, "crearCompra")({businessId, requestId: requestId("multi-create"), compra: purchasePayload(providerId, [line(productA, "multi-a", {cantidad: 2}), line(productB, "multi-b", {cantidad: 5})])});
  await adminDb.doc(`negocios/${businessId}/compras/${multiProduct.data.compra.id}`).update({modeloCompraVersion: 1, stockGestionadoPor: null});
  const productABefore = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock;
  const productBBefore = (await adminDb.doc(`negocios/${businessId}/inventario/${productB}`).get()).data().stock;
  await call(owner, "confirmarCompra")({businessId, compraId: multiProduct.data.compra.id, requestId: requestId("multi-confirm")});
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, productABefore + 2);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productB}`).get()).data().stock, productBBefore + 5);
  console.log("OK confirmación con múltiples productos");

  const rollbackDraft = await call(owner, "crearCompra")({businessId, requestId: requestId("rollback-create"), compra: purchasePayload(providerId, [line(productA, "rollback-a", {cantidad: 1}), line(productB, "rollback-b", {cantidad: 1})])});
  await adminDb.doc(`negocios/${businessId}/compras/${rollbackDraft.data.compra.id}`).update({modeloCompraVersion: 1, stockGestionadoPor: null});
  const stockBeforeRollback = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock;
  await adminDb.doc(`negocios/${businessId}/inventario/${productB}`).delete();
  await expectCallableError("rollback por producto faltante", () => call(owner, "confirmarCompra")({businessId, compraId: rollbackDraft.data.compra.id, requestId: requestId("rollback-confirm")}), ["failed-precondition"]);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, stockBeforeRollback);
  assert.equal((await adminDb.doc(`negocios/${businessId}/compras/${rollbackDraft.data.compra.id}`).get()).data().estado, "borrador");
  assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", rollbackDraft.data.compra.id).get()).size, 0);
  console.log("OK atomicidad: fallo en B revierte stock, movimientos y estado de A");

  const orderId = `order-emitted-${RUN_ID}`; const concurrentOrderId = `order-concurrent-${RUN_ID}`; const draftOrderId = `order-draft-${RUN_ID}`; const canceledOrderId = `order-canceled-${RUN_ID}`;
  const historicalLine = {lineaId: "order-line", itemId: inactiveProduct, cantidad: 2, costoUnitario: 5000, descuentoPct: 0, codigo: "HIST", nombre: "Producto histórico OC", tipoItem: "producto", unidad: "unidad", inventarioSnapshot: {inventarioId: inactiveProduct, codigoInterno: "HIST", nombre: "Producto histórico OC", tipoItem: "producto", unidad: "unidad"}};
  const historicalService = {lineaId: "order-service", itemId: serviceId, cantidad: 1, costoUnitario: 2500, descuentoPct: 0, codigo: "SERV-HIST", nombre: "Servicio histórico OC", tipoItem: "servicio", unidad: "servicio", inventarioSnapshot: {inventarioId: serviceId, codigoInterno: "SERV-HIST", nombre: "Servicio histórico OC", tipoItem: "servicio", unidad: "servicio"}};
  const orderFixture = {ordenCompraId: orderId, negocioId: businessId, numero: "OC-2026-0900", estado: "emitida", proveedorId: providerId, proveedorSnapshot: {...providerFixture, razonSocial: "Proveedor histórico OC"}, items: [historicalLine, historicalService], condicionesPago: "Histórico", observaciones: "Desde OC"};
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/ordenesCompra/${orderId}`).set(orderFixture),
    adminDb.doc(`negocios/${businessId}/ordenesCompra/${concurrentOrderId}`).set({...orderFixture, ordenCompraId: concurrentOrderId, numero: "OC-2026-0903"}),
    adminDb.doc(`negocios/${businessId}/ordenesCompra/${draftOrderId}`).set({...orderFixture, ordenCompraId: draftOrderId, numero: "OC-2026-0901", estado: "borrador"}),
    adminDb.doc(`negocios/${businessId}/ordenesCompra/${canceledOrderId}`).set({...orderFixture, ordenCompraId: canceledOrderId, numero: "OC-2026-0902", estado: "cancelada"}),
  ]);
  await expectCallableError("OC borrador no convierte", () => call(owner, "crearCompraDesdeOrden")({businessId, ordenCompraId: draftOrderId, requestId: requestId("convert-draft")}), ["failed-precondition"]);
  await expectCallableError("OC cancelada no convierte", () => call(owner, "crearCompraDesdeOrden")({businessId, ordenCompraId: canceledOrderId, requestId: requestId("convert-cancel")}), ["failed-precondition"]);
  await expectCallableError("OC de otro negocio no convierte", () => call(outsider, "crearCompraDesdeOrden")({businessId: otherBusinessId, ordenCompraId: orderId, requestId: requestId("convert-cross")}), ["not-found", "permission-denied"]);
  const conversion = await call(owner, "crearCompraDesdeOrden")({businessId, ordenCompraId: orderId, requestId: requestId("convert-emitted")});
  assert.equal(conversion.data.compra.ordenCompraId, orderId); assert.equal(conversion.data.compra.proveedorSnapshot.razonSocial, "Proveedor histórico OC"); assert.equal(conversion.data.compra.items[0].nombre, "Producto histórico OC");
  const conversionDraft = {
    proveedorId: conversion.data.compra.proveedorId,
    fechaCompra: conversion.data.compra.fechaCompra,
    fechaDocumento: "2026-08-06",
    tipoDocumento: "factura",
    numeroDocumentoProveedor: "F-OC-1",
    condicionesPago: "45 días",
    observaciones: "Recepción ajustada",
    items: conversion.data.compra.items.map((item) => ({
      lineaId: item.lineaId,
      itemId: item.itemId,
      cantidad: item.cantidad,
      costoUnitario: item.costoUnitario,
      descuentoPct: item.descuentoPct,
    })),
  };
  await expectCallableError("compra OC no cambia proveedor", () => call(owner, "actualizarCompraBorrador")({businessId, compraId: conversion.data.compra.id, compra: {...conversionDraft, proveedorId: providerBId}}), ["failed-precondition"]);
  await expectCallableError("compra OC no agrega línea", () => call(owner, "actualizarCompraBorrador")({businessId, compraId: conversion.data.compra.id, compra: {...conversionDraft, items: [...conversionDraft.items, line(activityId, "order-added")]}}), ["failed-precondition"]);
  await expectCallableError("compra OC no quita línea", () => call(owner, "actualizarCompraBorrador")({businessId, compraId: conversion.data.compra.id, compra: {...conversionDraft, items: conversionDraft.items.slice(0, 1)}}), ["failed-precondition"]);
  await expectCallableError("compra OC no sustituye itemId", () => call(owner, "actualizarCompraBorrador")({businessId, compraId: conversion.data.compra.id, compra: {...conversionDraft, items: conversionDraft.items.map((item, index) => index === 0 ? {...item, itemId: productA} : item)}}), ["failed-precondition"]);
  const originalProviderSnapshot = conversion.data.compra.proveedorSnapshot;
  const originalItemSnapshots = conversion.data.compra.items.map((item) => item.inventarioSnapshot);
  const allowedDraft = {...conversionDraft, items: conversionDraft.items.map((item, index) => ({...item, cantidad: index === 0 ? 3 : 2, costoUnitario: item.costoUnitario + 500, descuentoPct: 5}))};
  const allowedUpdate = await call(owner, "actualizarCompraBorrador")({businessId, compraId: conversion.data.compra.id, compra: allowedDraft});
  assert.equal(allowedUpdate.data.compra.items[0].cantidad, 3);
  assert.equal(allowedUpdate.data.compra.items[0].costoUnitario, 5500);
  assert.equal(allowedUpdate.data.compra.items[0].descuentoPct, 5);
  assert.deepEqual(allowedUpdate.data.compra.proveedorSnapshot, originalProviderSnapshot);
  assert.deepEqual(allowedUpdate.data.compra.items.map((item) => item.inventarioSnapshot), originalItemSnapshots);
  console.log("OK compra desde OC: referencias bloqueadas, valores comerciales editables y snapshots exactos");
  const conversionAgain = await call(admin, "crearCompraDesdeOrden")({businessId, ordenCompraId: orderId, requestId: requestId("convert-emitted-again")});
  assert.equal(conversionAgain.data.compra.id, conversion.data.compra.id);
  assert.equal((await adminDb.doc(`negocios/${businessId}/ordenesCompra/${orderId}`).get()).data().compraId, conversion.data.compra.id);
  const inactiveBefore = (await adminDb.doc(`negocios/${businessId}/inventario/${inactiveProduct}`).get()).data().stock;
  await call(owner, "confirmarCompra")({businessId, compraId: conversion.data.compra.id, requestId: requestId("confirm-converted")});
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${inactiveProduct}`).get()).data().stock, inactiveBefore);
  assert.equal((await adminDb.doc(`negocios/${businessId}/ordenesCompra/${orderId}`).get()).data().estado, "emitida");
  assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", conversion.data.compra.id).get()).size, 0);
  const concurrentConversions = await Promise.all([
    call(owner, "crearCompraDesdeOrden")({businessId, ordenCompraId: concurrentOrderId, requestId: requestId("convert-concurrent-a")}),
    call(admin, "crearCompraDesdeOrden")({businessId, ordenCompraId: concurrentOrderId, requestId: requestId("convert-concurrent-b")}),
  ]);
  assert.equal(concurrentConversions[0].data.compra.id, concurrentConversions[1].data.compra.id);
  assert.equal((await adminDb.collection(`negocios/${businessId}/compras`).where("ordenCompraId", "==", concurrentOrderId).get()).size, 1);
  console.log("OK OC emitida: producto histórico, servicio sin movimiento, snapshots, enlace único y conversión concurrente");

  const cancelDraft = await call(owner, "crearCompra")({businessId, requestId: requestId("cancel-create"), compra: purchasePayload(providerId, [line(productA, "cancel-line")])});
  const cancelStock = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock;
  const canceled = await call(owner, "cancelarCompraBorrador")({businessId, compraId: cancelDraft.data.compra.id});
  assert.equal(canceled.data.compra.estado, "cancelada");
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, cancelStock);
  await expectCallableError("compra cancelada no confirma", () => call(owner, "confirmarCompra")({businessId, compraId: cancelDraft.data.compra.id, requestId: requestId("cancel-confirm")}), ["failed-precondition"]);
  console.log("OK estados: cancelar borrador no afecta stock y es final");

  await getDoc(doc(member.db, `negocios/${businessId}/compras/${ownerCreated.data.compra.id}`));
  await getDocs(query(collection(member.db, `negocios/${businessId}/movimientosInventario`), where("negocioId", "==", businessId)));
  await expectDenied("externo no lee compras", () => getDoc(doc(outsider.db, `negocios/${businessId}/compras/${ownerCreated.data.compra.id}`)));
  await expectDenied("cliente no crea compras", () => setDoc(doc(owner.db, `negocios/${businessId}/compras/client-write-${RUN_ID}`), {negocioId: businessId}));
  await expectDenied("cliente no altera movimientos", () => updateDoc(doc(owner.db, `negocios/${businessId}/movimientosInventario/${ownerCreated.data.compra.id}__line-main`), {cantidad: 999}));
  await expectDenied("colección interna cerrada", () => getDocs(collection(owner.db, `negocios/${businessId}/purchaseConfirmRequests`)));
  console.log("OK reglas: lectura por membresía y escrituras/colecciones internas cerradas");

  console.log("Smoke integrado de Compras completado.");
} finally {
  await Promise.all(clients.map(async (client) => { await terminate(client.db).catch(() => {}); await deleteApp(client.app).catch(() => {}); }));
  await deleteAdminApp(adminApp).catch(() => {});
}
