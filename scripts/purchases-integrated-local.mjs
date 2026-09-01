import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {
  collection, connectFirestoreEmulator, doc, getDoc, getDocs,
  getFirestore, query, setDoc, terminate, updateDoc, where,
} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";
import {getPurchaseStockSemantics} from "../src/domain/purchaseModel.mjs";

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
  const mainResult = await call(owner, "createFirstBusiness")({nombreComercial: "Negocio compras", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-main")});
  const otherResult = await call(outsider, "createFirstBusiness")({nombreComercial: "Negocio compras externo", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-other")});
  const businessId = mainResult.data.business.id; const otherBusinessId = otherResult.data.business.id;
  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).set({identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.500.500-5", verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.500.500-5"}}, {merge: true}),
    adminDb.doc(`negocios/${otherBusinessId}`).set({identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.900.900-9", verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.900.900-9"}}, {merge: true}),
  ]);
  const companyProfile = {negocioId: businessId, nombreComercial: "Empresa Compradora", razonSocial: "Empresa Compradora SpA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.500.500-5"};
  await Promise.all([
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({negocioId: businessId, uid: admin.uid, rol: "ADMIN", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${member.uid}`).set({negocioId: businessId, uid: member.uid, rol: "MEMBER", estado: "activo"}),
    adminDb.doc(`negocios/${businessId}/empresa/perfil`).set(companyProfile, {merge: true}),
  ]);

  const providerId = `provider-${RUN_ID}`; const providerBId = `provider-b-${RUN_ID}`; const providerOtherId = `provider-other-${RUN_ID}`;
  const productA = `product-a-${RUN_ID}`; const productB = `product-b-${RUN_ID}`;
  const economicProduct = `economic-product-${RUN_ID}`; const negativeValueProduct = `negative-value-${RUN_ID}`; const residualValueProduct = `residual-value-${RUN_ID}`; const fxProduct = `fx-product-${RUN_ID}`; const zeroFxProduct = `zero-fx-product-${RUN_ID}`;
  const economicClientId = `economic-client-${RUN_ID}`;
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
    adminDb.doc(`negocios/${businessId}/inventario/${economicProduct}`).set({...itemFixture(economicProduct, "producto", "Producto económico", 10), costoBase: 100, costoPromedio: 100, costoPromedioMoneda: "CLP"}),
    adminDb.doc(`negocios/${businessId}/inventario/${negativeValueProduct}`).set({...itemFixture(negativeValueProduct, "producto", "Producto valor negativo", 0), costoBase: 100}),
    adminDb.doc(`negocios/${businessId}/inventario/${residualValueProduct}`).set({...itemFixture(residualValueProduct, "producto", "Producto valor residual", 0), costoBase: 100}),
    adminDb.doc(`negocios/${businessId}/inventario/${fxProduct}`).set({...itemFixture(fxProduct, "producto", "Producto otra moneda", 1), costoBase: 100, costoPromedio: 100, costoPromedioMoneda: "USD"}),
    adminDb.doc(`negocios/${businessId}/inventario/${zeroFxProduct}`).set({...itemFixture(zeroFxProduct, "producto", "Producto saldo cero otra moneda", 0), modeloCostoInventarioVersion: 1, valorInventario: 0, valorInventarioMoneda: "USD", costoPromedio: null, costoPromedioMoneda: "USD", baselineCostoInventario: {costoUnitarioInicial: 25, fuente: "costoBase", moneda: "USD", stockInicial: 0, valorInicial: 0}}),
    adminDb.doc(`negocios/${businessId}/adquisicionesInventario/old-usd-${RUN_ID}`).set({adquisicionId: `old-usd-${RUN_ID}`, negocioId: businessId, itemId: zeroFxProduct, estado: "vigente", origen: "compra_directa", costoPagadoUnitario: 25, costoPagadoTotal: 25, cantidad: 1, moneda: "USD", proveedorSnapshot: {razonSocial: "Proveedor histórico USD"}, creadoEn: new Date("2026-01-01T00:00:00.000Z")}),
    adminDb.doc(`negocios/${businessId}/clientes/${economicClientId}`).set({clienteId: economicClientId, negocioId: businessId, estado: "activo", tipoCliente: "empresa", rut: "76.111.111-1", nombreRazonSocial: "Cliente económico SpA", email: "economia@example.test"}),
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
  assert.equal(ownerCreated.data.compra.modeloCompraVersion, 3);
  assert.equal(ownerCreated.data.compra.stockGestionadoPor, "compra_directa");
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, 8);
  const ownerRetry = await call(owner, "crearCompra")({businessId, requestId: ownerCreateId, compra: purchasePayload(providerId, [line(productA, "line-main"), line(serviceId, "line-service", {cantidad: 1}), line(activityId, "line-activity", {cantidad: 1})])});
  assert.equal(ownerRetry.data.compra.id, ownerCreated.data.compra.id);
  assert.equal(ownerRetry.data.idempotent, true);
  console.log("OK compra directa OWNER, autoridad e idempotencia de creación");

  const purchasesBeforeNonCanonical = (await adminDb.collection(`negocios/${businessId}/compras`).get()).size;
  await expectCallableError("cantidad fÃ­sica no canÃ³nica en Compra", () => call(owner, "crearCompra")({businessId, requestId: requestId("noncanonical-create"), compra: purchasePayload(providerId, [line(productA, "noncanonical-line", {cantidad: 1.0000004, costoUnitario: 100000000})])}), ["failed-precondition"]);
  assert.equal((await adminDb.collection(`negocios/${businessId}/compras`).get()).size, purchasesBeforeNonCanonical);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, 8);
  assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("itemId", "==", productA).get()).size, 0);
  console.log("OK cantidad fÃ­sica de Compra falla cerrada sin documento ni efectos parciales");

  const otherCreated = await call(outsider, "crearCompra")({businessId: otherBusinessId, requestId: requestId("other-create"), compra: purchasePayload(providerOtherId, [line(productA, "other-line")])});
  assert.equal(otherCreated.data.compra.numero, "COM-2026-0001");
  const adminCreated = await call(admin, "crearCompra")({businessId, requestId: requestId("admin-create"), compra: purchasePayload(providerId, [line(productB, "admin-line")])});
  assert.equal(adminCreated.data.compra.numero, "COM-2026-0002");
  assert.equal(adminCreated.data.compra.modeloCompraVersion, 3);
  assert.equal(adminCreated.data.compra.stockGestionadoPor, "compra_directa");
  console.log("OK roles OWNER/ADMIN y correlativos independientes por negocio");

  await expectCallableError("MEMBER no crea", () => call(member, "crearCompra")({businessId, requestId: requestId("member-create"), compra: purchasePayload(providerId, [line(productA, "member-line")])}), ["permission-denied"]);
  await expectCallableError("MEMBER no confirma", () => call(member, "confirmarCompra")({businessId, compraId: ownerCreated.data.compra.id, requestId: requestId("member-confirm")}), ["permission-denied"]);
  await expectCallableError("confirmación cross-business", () => call(owner, "confirmarCompra")({businessId: otherBusinessId, compraId: otherCreated.data.compra.id, requestId: requestId("cross-confirm")}), ["permission-denied"]);
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

  const stockBeforeEdit = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock;
  await call(owner, "actualizarCompraBorrador")({businessId, compraId: ownerCreated.data.compra.id, compra: purchasePayload(providerId, [line(productA, "line-main", {costoUnitario: 9500}), line(serviceId, "line-service", {cantidad: 1}), line(activityId, "line-activity", {cantidad: 1})])});
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, stockBeforeEdit);
  assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", ownerCreated.data.compra.id).get()).size, 0);
  console.log("OK compra directa V3: crear y editar borrador no modifican stock");

  const beforeProduct = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data();
  const confirmId = requestId("confirm-main");
  const confirmed = await call(owner, "confirmarCompra")({businessId, compraId: ownerCreated.data.compra.id, requestId: confirmId});
  assert.equal(confirmed.data.compra.estado, "confirmada"); assert.equal(confirmed.data.compra.stockAplicado, true);
  const productAfterDirectPurchase = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data();
  assert.equal(productAfterDirectPurchase.stock, beforeProduct.stock + 2);
  assert.equal(productAfterDirectPurchase.valorInventario, 26565);
  assert.equal(productAfterDirectPurchase.costoPromedio, 2656.5);
  assert.equal(productAfterDirectPurchase.ultimoCosto, 10174.5);
  assert.equal(productAfterDirectPurchase.costoBase, 777);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${serviceId}`).get()).data().stock, undefined);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${activityId}`).get()).data().stock, undefined);
  const movements = await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", ownerCreated.data.compra.id).get();
  assert.equal(movements.size, 1); assert.equal(movements.docs[0].data().tipo, "entrada_compra"); assert.equal(movements.docs[0].data().tipoOrigen, "compra_directa");
  assert.equal(movements.docs[0].data().cantidad, 2); assert.equal(movements.docs[0].data().stockAnterior, 8); assert.equal(movements.docs[0].data().stockPosterior, 10);
  const directAcquisition = (await adminDb.doc(`negocios/${businessId}/adquisicionesInventario/${ownerCreated.data.compra.id}__line-main`).get()).data();
  assert.equal(directAcquisition.estado, "vigente");
  assert.equal(directAcquisition.origen, "compra_directa");
  assert.equal(directAcquisition.costoPagadoTotal, 20349);
  assert.equal(directAcquisition.recepcionId, undefined);
  assert.equal(directAcquisition.ordenCompraId, undefined);
  const retrySame = await call(owner, "confirmarCompra")({businessId, compraId: ownerCreated.data.compra.id, requestId: confirmId});
  const retryOther = await call(owner, "confirmarCompra")({businessId, compraId: ownerCreated.data.compra.id, requestId: requestId("confirm-main-other")});
  assert.equal(retrySame.data.idempotent, true); assert.equal(retryOther.data.idempotent, true);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, beforeProduct.stock + 2);
  console.log("OK confirmación: sólo productos, movimiento inmutable, sin costoBase y doble defensa idempotente");

  const reversalId = requestId("reverse-main");
  const reversed = await call(owner, "revertirCompra")({businessId, compraId: ownerCreated.data.compra.id, motivo: "Validar reversión V3 directa", requestId: reversalId});
  assert.equal(reversed.data.compra.estado, "revertida"); assert.equal(reversed.data.productosRevertidos, 1);
  const productAfterDirectReversal = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data();
  assert.equal(productAfterDirectReversal.stock, beforeProduct.stock);
  assert.equal(productAfterDirectReversal.valorInventario, 6216);
  assert.equal(productAfterDirectReversal.costoPromedio, 777);
  assert.equal(productAfterDirectReversal.ultimoCosto, null);
  assert.equal((await adminDb.doc(`negocios/${businessId}/adquisicionesInventario/${ownerCreated.data.compra.id}__line-main`).get()).data().estado, "revertida");
  let reversedMovements = await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", ownerCreated.data.compra.id).get();
  assert.equal(reversedMovements.size, 2);
  assert.equal(reversedMovements.docs.filter((document) => document.data().tipo === "salida_reversion_compra").length, 1);
  const reversalRetry = await call(owner, "revertirCompra")({businessId, compraId: ownerCreated.data.compra.id, motivo: "Validar reversión V3 directa", requestId: reversalId});
  assert.equal(reversalRetry.data.idempotent, true);
  reversedMovements = await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", ownerCreated.data.compra.id).get();
  assert.equal(reversedMovements.size, 2);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, beforeProduct.stock);
  console.log("OK reversión V3 directa: stock restaurado, movimiento compensatorio e idempotencia");

  const economicPurchase = await call(owner, "crearCompra")({businessId, requestId: requestId("economic-a-create"), compra: purchasePayload(providerId, [line(economicProduct, "economic-a", {cantidad: 10, costoUnitario: 168.0672, descuentoPct: 0})])});
  await call(owner, "confirmarCompra")({businessId, compraId: economicPurchase.data.compra.id, requestId: requestId("economic-a-confirm")});
  let economicState = (await adminDb.doc(`negocios/${businessId}/inventario/${economicProduct}`).get()).data();
  assert.deepEqual([economicState.stock, economicState.valorInventario, economicState.costoPromedio], [20, 3000, 150]);
  const economicSale = await call(owner, "crearVenta")({businessId, requestId: requestId("economic-sale-create"), venta: {
    clienteId: economicClientId, fechaVenta: "2026-08-08", tipoDocumento: "sin_documento", condicionesPago: "Contado", observaciones: "Prueba económica",
    items: [{lineaId: "economic-sale", itemId: economicProduct, cantidad: 5, precioUnitario: 500, descuentoPct: 0}],
  }});
  await call(owner, "confirmarVenta")({businessId, ventaId: economicSale.data.venta.id, requestId: requestId("economic-sale-confirm")});
  economicState = (await adminDb.doc(`negocios/${businessId}/inventario/${economicProduct}`).get()).data();
  assert.deepEqual([economicState.stock, economicState.valorInventario, economicState.costoPromedio], [15, 2250, 150]);
  const frozenSale = (await adminDb.doc(`negocios/${businessId}/ventas/${economicSale.data.venta.id}`).get()).data();
  assert.deepEqual([frozenSale.efectosInventario[0].costoUnitario, frozenSale.efectosInventario[0].costoTotal], [150, 750]);
  await call(owner, "revertirCompra")({businessId, compraId: economicPurchase.data.compra.id, motivo: "Reversión posterior a venta", requestId: requestId("economic-a-reverse")});
  economicState = (await adminDb.doc(`negocios/${businessId}/inventario/${economicProduct}`).get()).data();
  assert.deepEqual([economicState.stock, economicState.valorInventario, economicState.costoPromedio], [5, 250, 50]);
  const frozenSaleAfterReversal = (await adminDb.doc(`negocios/${businessId}/ventas/${economicSale.data.venta.id}`).get()).data();
  assert.deepEqual([frozenSaleAfterReversal.efectosInventario[0].costoUnitario, frozenSaleAfterReversal.efectosInventario[0].costoTotal], [150, 750]);
  console.log("OK economía: adquisición A → venta congelada → reversión A conserva Q=5, V=250 y promedio=50");

  const unsafeReversal = async (itemId, label, corruptedValue) => {
    const draft = await call(owner, "crearCompra")({businessId, requestId: requestId(`${label}-create`), compra: purchasePayload(providerId, [line(itemId, `${label}-line`, {cantidad: 10, costoUnitario: 168.0672, descuentoPct: 0})])});
    await call(owner, "confirmarCompra")({businessId, compraId: draft.data.compra.id, requestId: requestId(`${label}-confirm`)});
    await adminDb.doc(`negocios/${businessId}/inventario/${itemId}`).update({valorInventario: corruptedValue});
    await expectCallableError(label, () => call(owner, "revertirCompra")({businessId, compraId: draft.data.compra.id, motivo: label, requestId: requestId(`${label}-reverse`)}), ["failed-precondition"]);
    assert.equal((await adminDb.doc(`negocios/${businessId}/compras/${draft.data.compra.id}`).get()).data().estado, "confirmada");
    assert.equal((await adminDb.doc(`negocios/${businessId}/adquisicionesInventario/${draft.data.compra.id}__${label}-line`).get()).data().estado, "vigente");
    assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", draft.data.compra.id).get()).size, 1);
  };
  await unsafeReversal(negativeValueProduct, "valor-negativo", 1500);
  await unsafeReversal(residualValueProduct, "valor-residual", 2100);
  const fxDraft = await call(owner, "crearCompra")({businessId, requestId: requestId("fx-create"), compra: purchasePayload(providerId, [line(fxProduct, "fx-line", {cantidad: 1})])});
  await expectCallableError("moneda incompatible sin FX", () => call(owner, "confirmarCompra")({businessId, compraId: fxDraft.data.compra.id, requestId: requestId("fx-confirm")}), ["failed-precondition"]);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${fxProduct}`).get()).data().stock, 1);

  const zeroFxDraft = await call(owner, "crearCompra")({businessId, requestId: requestId("zero-fx-create"), compra: purchasePayload(providerId, [line(zeroFxProduct, "zero-fx-line", {cantidad: 1, costoUnitario: 500, descuentoPct: 0})])});
  await call(owner, "confirmarCompra")({businessId, compraId: zeroFxDraft.data.compra.id, requestId: requestId("zero-fx-confirm")});
  let zeroFxState = (await adminDb.doc(`negocios/${businessId}/inventario/${zeroFxProduct}`).get()).data();
  assert.deepEqual([zeroFxState.stock, zeroFxState.valorInventario, zeroFxState.valorInventarioMoneda, zeroFxState.costoPromedioMoneda], [1, 595, "CLP", "CLP"]);
  assert.equal((await adminDb.doc(`negocios/${businessId}/adquisicionesInventario/${zeroFxDraft.data.compra.id}__zero-fx-line`).get()).data().moneda, "CLP");
  await call(owner, "revertirCompra")({businessId, compraId: zeroFxDraft.data.compra.id, motivo: "Validar último costo entre monedas", requestId: requestId("zero-fx-reverse")});
  zeroFxState = (await adminDb.doc(`negocios/${businessId}/inventario/${zeroFxProduct}`).get()).data();
  assert.deepEqual([zeroFxState.stock, zeroFxState.valorInventario, zeroFxState.valorInventarioMoneda], [0, 0, "CLP"]);
  assert.equal(zeroFxState.ultimoCosto, null);
  assert.equal(zeroFxState.ultimoProveedor, null);
  assert.equal(zeroFxState.ultimaAdquisicionId, null);
  assert.equal(zeroFxState.ultimaAdquisicionEn, null);
  console.log("OK saldo cero cambia de USD a CLP y la reversión no presenta último costo cross-currency");
  console.log("OK bloqueos económicos: V negativo, residual con Q=0 y moneda incompatible sin FX");

  const nonProductDraft = await call(owner, "crearCompra")({businessId, requestId: requestId("non-product-create"), compra: purchasePayload(providerId, [line(serviceId, "non-product-service", {cantidad: 1}), line(activityId, "non-product-activity", {cantidad: 1})])});
  const serviceBefore = (await adminDb.doc(`negocios/${businessId}/inventario/${serviceId}`).get()).data();
  const activityBefore = (await adminDb.doc(`negocios/${businessId}/inventario/${activityId}`).get()).data();
  const nonProductConfirmId = requestId("non-product-confirm");
  const nonProductConfirmed = await call(owner, "confirmarCompra")({businessId, compraId: nonProductDraft.data.compra.id, requestId: nonProductConfirmId});
  assert.equal(nonProductConfirmed.data.compra.estado, "confirmada");
  assert.equal(nonProductConfirmed.data.compra.stockAplicado, false);
  assert.equal(nonProductConfirmed.data.productosActualizados, 0);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${serviceId}`).get()).data().stock, serviceBefore.stock);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${activityId}`).get()).data().stock, activityBefore.stock);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${serviceId}`).get()).data().costoBase, serviceBefore.costoBase);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${activityId}`).get()).data().costoBase, activityBefore.costoBase);
  assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", nonProductDraft.data.compra.id).get()).size, 0);
  assert.doesNotMatch(getPurchaseStockSemantics({...nonProductConfirmed.data.compra, productosActualizados: nonProductConfirmed.data.productosActualizados}).confirmationResultMessage, /stock de productos actualizado/i);
  const nonProductRetry = await call(owner, "confirmarCompra")({businessId, compraId: nonProductDraft.data.compra.id, requestId: nonProductConfirmId});
  assert.equal(nonProductRetry.data.idempotent, true); assert.equal(nonProductRetry.data.productosActualizados, 0);
  assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", nonProductDraft.data.compra.id).get()).size, 0);
  console.log("OK V3 sin productos: servicios/actividades sin stock, movimientos ni mensaje físico");

  const concurrencyPayload = (suffix, quantity) => purchasePayload(providerId, [line(productA, `concurrent-${suffix}`, {cantidad: quantity, descuentoPct: 0})]);
  const [draftTwo, draftFive] = await Promise.all([
    call(owner, "crearCompra")({businessId, requestId: requestId("create-two"), compra: concurrencyPayload("two", 2)}),
    call(admin, "crearCompra")({businessId, requestId: requestId("create-five"), compra: concurrencyPayload("five", 5)}),
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
  const productABefore = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock;
  const productBBefore = (await adminDb.doc(`negocios/${businessId}/inventario/${productB}`).get()).data().stock;
  await call(owner, "confirmarCompra")({businessId, compraId: multiProduct.data.compra.id, requestId: requestId("multi-confirm")});
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, productABefore + 2);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productB}`).get()).data().stock, productBBefore + 5);
  console.log("OK confirmación con múltiples productos");

  const unresolvedDocument = {
    origen: "importador_documental", nombreArchivo: "factura.pdf", tipoArchivo: "application/pdf",
    extension: "pdf", tamanoBytes: 2048, tipoDocumento: "factura", numeroDocumento: "F-DOC-1",
    fechaDocumento: "2026-08-06", moneda: "CLP", proveedorDocumento: {nombre: "Proveedor Autoritativo SpA", identificadorFiscal: "76.000.000-0"},
    receptorDocumento: {nombre: "Empresa Compradora", identificadorFiscal: "76.500.500-5"},
    neto: 10000, impuestoPorcentaje: 19, impuestoMonto: 1900, total: 11900,
    coherenciaEstado: "coherente", proveedorCoincidencia: "identificador_fiscal",
    lineasDetectadas: 2, lineasAplicadas: 1, advertencias: [],
  };
  const importedDraft = await call(owner, "crearCompra")({businessId, requestId: requestId("document-create"), compra: purchasePayload(providerId, [line(productA, "document-line", {cantidad: 1, costoUnitario: 10000, descuentoPct: 0})], {documentoOrigen: unresolvedDocument})});
  const stockBeforeDocument = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock;
  assert.equal(importedDraft.data.compra.documentoOrigen.total, 11900);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, stockBeforeDocument);
  await expectCallableError("documento con línea sin resolver", () => call(owner, "confirmarCompra")({businessId, compraId: importedDraft.data.compra.id, requestId: requestId("document-unresolved-confirm")}), ["failed-precondition"]);
  assert.equal((await adminDb.doc(`negocios/${businessId}/compras/${importedDraft.data.compra.id}`).get()).data().estado, "borrador");
  assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", importedDraft.data.compra.id).get()).size, 0);
  console.log("OK importador: factura prepara borrador, conserva tributos y bloquea líneas sin resolver sin stock");

  const rollbackDraft = await call(owner, "crearCompra")({businessId, requestId: requestId("rollback-create"), compra: purchasePayload(providerId, [line(productA, "rollback-a", {cantidad: 1}), line(productB, "rollback-b", {cantidad: 1})])});
  const stockBeforeRollback = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock;
  await adminDb.doc(`negocios/${businessId}/inventario/${productB}`).delete();
  await expectCallableError("rollback por producto faltante", () => call(owner, "confirmarCompra")({businessId, compraId: rollbackDraft.data.compra.id, requestId: requestId("rollback-confirm")}), ["failed-precondition"]);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, stockBeforeRollback);

  const budgetProducts = Array.from({length: 150}, (_, index) => `budget-${index}-${RUN_ID}`);
  const budgetSeed = adminDb.batch();
  budgetProducts.forEach((itemId, index) => budgetSeed.set(
    adminDb.doc(`negocios/${businessId}/inventario/${itemId}`),
    itemFixture(itemId, "producto", `Producto presupuesto ${index + 1}`, 0)
  ));
  await budgetSeed.commit();
  const budgetDraft = await call(owner, "crearCompra")({
    businessId,
    requestId: requestId("budget-create"),
    compra: purchasePayload(providerId, budgetProducts.map((itemId, index) =>
      line(itemId, `budget-line-${index}`, {cantidad: 1, costoUnitario: 1, descuentoPct: 0})
    )),
  });
  const budgetConfirmRequestId = requestId("budget-confirm");
  await expectCallableError("presupuesto atómico de Compra", () => call(owner, "confirmarCompra")({businessId, compraId: budgetDraft.data.compra.id, requestId: budgetConfirmRequestId}), ["failed-precondition"]);
  assert.equal((await adminDb.doc(`negocios/${businessId}/compras/${budgetDraft.data.compra.id}`).get()).data().estado, "borrador");
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${budgetProducts[0]}`).get()).data().stock, 0);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${budgetProducts.at(-1)}`).get()).data().stock, 0);
  assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", budgetDraft.data.compra.id).get()).size, 0);
  assert.equal((await adminDb.collection(`negocios/${businessId}/adquisicionesInventario`).where("compraId", "==", budgetDraft.data.compra.id).get()).size, 0);
  assert.equal((await adminDb.doc(`negocios/${businessId}/purchaseConfirmRequests/${budgetConfirmRequestId}`).get()).exists, false);
  console.log("OK presupuesto atómico: exceso rechazado sin stock, movimiento, adquisición ni request parcial");
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
  assert.equal(conversion.data.compra.modeloCompraVersion, 2); assert.equal(conversion.data.compra.stockGestionadoPor, "recepcion");
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

  const legacyV2 = await call(owner, "crearCompra")({businessId, requestId: requestId("legacy-v2-create"), compra: purchasePayload(providerId, [line(productA, "legacy-v2-line", {cantidad: 1})])});
  await adminDb.doc(`negocios/${businessId}/compras/${legacyV2.data.compra.id}`).update({modeloCompraVersion: 2, stockGestionadoPor: "recepcion"});
  const stockBeforeV2 = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock;
  await call(owner, "confirmarCompra")({businessId, compraId: legacyV2.data.compra.id, requestId: requestId("legacy-v2-confirm")});
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, stockBeforeV2);
  assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("compraId", "==", legacyV2.data.compra.id).get()).size, 0);

  const legacyV1 = await call(owner, "crearCompra")({businessId, requestId: requestId("legacy-v1-create"), compra: purchasePayload(providerId, [line(productA, "legacy-v1-line", {cantidad: 1})])});
  await adminDb.doc(`negocios/${businessId}/compras/${legacyV1.data.compra.id}`).update({modeloCompraVersion: 1, stockGestionadoPor: null});
  const stockBeforeV1 = (await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock;
  await call(owner, "confirmarCompra")({businessId, compraId: legacyV1.data.compra.id, requestId: requestId("legacy-v1-confirm")});
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productA}`).get()).data().stock, stockBeforeV1 + 1);
  console.log("OK compatibilidad: V2 permanece económica y V1 conserva su entrada histórica");

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
