import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {collection, connectFirestoreEmulator, doc, getDocs, getFirestore, query, setDoc, terminate, where} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function client(name) {
  const app = initializeApp({apiKey: "demo", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: `recep-${name}-${RUN_ID}`}, `recep-${name}-${RUN_ID}`);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {app, auth, db, functions};
}
async function authenticate(target, name) {
  const credential = await createUserWithEmailAndPassword(target.auth, `reception-${name}-${RUN_ID}@example.test`, `Reception-${RUN_ID}-Pass!`);
  target.uid = credential.user.uid; return target;
}
const call = (target, name) => httpsCallable(target.functions, name);
const requestId = (prefix) => `${prefix}-${RUN_ID}-${Math.random().toString(36).slice(2, 10)}`;
async function rejected(label, operation, codes) {
  try { await operation(); } catch (error) {
    assert.ok(codes.some((code) => String(error?.code || "").includes(code)), `${label}: ${error?.code} ${error?.message}`);
    console.log(`OK rechazo: ${label}`); return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

const owner = await authenticate(client("owner"), "owner");
const member = await authenticate(client("member"), "member");
const outsider = await authenticate(client("outsider"), "outsider");
const clients = [owner, member, outsider];
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `recep-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

try {
  const businessResult = await call(owner, "createFirstBusiness")({nombreComercial: "Negocio recepciones", rubroCodigo: "SERVICIOS_PROFESIONALES", regionCodigo: "13", requestId: requestId("business")});
  const otherResult = await call(outsider, "createFirstBusiness")({nombreComercial: "Negocio externo", rubroCodigo: "SERVICIOS_PROFESIONALES", regionCodigo: "13", requestId: requestId("other")});
  const businessId = businessResult.data.business.id; const otherBusinessId = otherResult.data.business.id;
  await adminDb.doc(`membresias/${businessId}__${member.uid}`).set({negocioId: businessId, uid: member.uid, rol: "MEMBER", estado: "activo"});
  const providerId = `provider-${RUN_ID}`; const productId = `product-${RUN_ID}`; const serviceId = `service-${RUN_ID}`;
  const provider = {proveedorId: providerId, negocioId: businessId, estado: "activo", rut: "76.111.111-1", razonSocial: "Proveedor Recepciones SpA"};
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/proveedores/${providerId}`).set(provider),
    adminDb.doc(`negocios/${businessId}/inventario/${productId}`).set({negocioId: businessId, estado: "activo", tipoItem: "producto", nombre: "Producto", unidad: "unidad", stock: 5}),
    adminDb.doc(`negocios/${businessId}/inventario/${serviceId}`).set({negocioId: businessId, estado: "activo", tipoItem: "servicio", nombre: "Servicio", unidad: "servicio"}),
  ]);
  const orderLine = (lineaId, itemId, nombre, tipoItem, cantidad) => ({lineaId, itemId, nombre, tipoItem, unidad: tipoItem === "producto" ? "unidad" : "servicio", cantidad, costoUnitario: 1000, descuentoPct: 0, inventarioSnapshot: {inventarioId: itemId, nombre, tipoItem, unidad: "unidad"}});
  const seedOrder = async (id, quantity = 10, response = "pendiente") => {
    await adminDb.doc(`negocios/${businessId}/ordenesCompra/${id}`).set({ordenCompraId: id, negocioId: businessId, numero: `OC-${id}`, estado: "emitida", proveedorId: providerId, proveedorSnapshot: provider, respuestaProveedor: {estado: response}, items: [orderLine("product-line", productId, "Producto", "producto", quantity), orderLine("service-line", serviceId, "Servicio", "servicio", 2)]});
  };
  const orderId = `partial-${RUN_ID}`; await seedOrder(orderId);

  await rejected("MEMBER no prepara recepción", () => call(member, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: orderId, requestId: requestId("member")}), ["permission-denied"]);
  const createId = requestId("create-first");
  const first = await call(owner, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: orderId, requestId: createId});
  const retryCreate = await call(owner, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: orderId, requestId: createId});
  assert.equal(first.data.recepcion.id, retryCreate.data.recepcion.id); assert.equal(retryCreate.data.idempotent, true);
  assert.equal(first.data.recepcion.numero, "REC-2026-0001"); assert.equal(first.data.recepcion.stockAplicado, false);
  const firstItems = first.data.recepcion.items.map((line) => ({lineaId: line.lineaId, cantidad: line.tipoItem === "producto" ? 4 : 1}));
  await call(owner, "actualizarRecepcionBorrador")({businessId, recepcionId: first.data.recepcion.id, recepcion: {fechaRecepcion: "2026-08-14", observaciones: "Parcial", items: firstItems}});
  const confirmId = requestId("confirm-first");
  const confirmed = await call(owner, "confirmarRecepcion")({businessId, recepcionId: first.data.recepcion.id, requestId: confirmId});
  assert.equal(confirmed.data.recepcion.estado, "confirmada"); assert.equal(confirmed.data.productosActualizados, 1);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productId}`).get()).data().stock, 9);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${serviceId}`).get()).data().stock, undefined);
  const movements = await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("recepcionId", "==", first.data.recepcion.id).get();
  assert.equal(movements.size, 1); assert.equal(movements.docs[0].data().tipo, "entrada_recepcion");
  await call(owner, "confirmarRecepcion")({businessId, recepcionId: first.data.recepcion.id, requestId: confirmId});
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productId}`).get()).data().stock, 9);
  console.log("OK recepción parcial, servicio sin stock e idempotencia");

  const second = await call(owner, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: orderId, requestId: requestId("create-second")});
  assert.equal(second.data.recepcion.items.find((line) => line.tipoItem === "producto").cantidad, 6);
  await call(owner, "confirmarRecepcion")({businessId, recepcionId: second.data.recepcion.id, requestId: requestId("confirm-second")});
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productId}`).get()).data().stock, 15);
  await rejected("orden totalmente recibida", () => call(owner, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: orderId, requestId: requestId("complete")}), ["failed-precondition"]);
  console.log("OK recepción acumulada total");

  const firstConversion = await call(owner, "crearCompraDesdeRecepcion")({businessId, recepcionId: first.data.recepcion.id, requestId: requestId("purchase-from-first-reception")});
  assert.equal(firstConversion.data.compra.recepcionId, first.data.recepcion.id);
  assert.equal(firstConversion.data.compra.items.find((line) => line.tipoItem === "producto").cantidad, 4);
  const conversionId = requestId("purchase-from-reception");
  const fromReception = await call(owner, "crearCompraDesdeRecepcion")({businessId, recepcionId: second.data.recepcion.id, requestId: conversionId});
  const conversionRetry = await call(owner, "crearCompraDesdeRecepcion")({businessId, recepcionId: second.data.recepcion.id, requestId: conversionId});
  const conversionRetryWithOtherRequest = await call(owner, "crearCompraDesdeRecepcion")({businessId, recepcionId: second.data.recepcion.id, requestId: requestId("purchase-from-reception-retry")});
  assert.equal(fromReception.data.compra.id, conversionRetry.data.compra.id);
  assert.equal(fromReception.data.compra.id, conversionRetryWithOtherRequest.data.compra.id);
  assert.notEqual(firstConversion.data.compra.id, fromReception.data.compra.id);
  assert.equal(fromReception.data.compra.recepcionId, second.data.recepcion.id);
  assert.equal(fromReception.data.compra.items.find((line) => line.tipoItem === "producto").cantidad, 6);
  assert.equal((await adminDb.collection(`negocios/${businessId}/compras`).where("ordenCompraId", "==", orderId).get()).size, 2);
  await rejected("ruta legacy no convierte una OC con recepciones", () => call(owner, "crearCompraDesdeOrden")({businessId, ordenCompraId: orderId, requestId: requestId("legacy-after-receptions")}), ["failed-precondition"]);
  const economicItems = fromReception.data.compra.items.map((line) => ({lineaId: line.lineaId, itemId: line.itemId, cantidad: line.cantidad, costoUnitario: line.costoUnitario + 300, descuentoPct: 0}));
  await call(owner, "actualizarCompraBorrador")({businessId, compraId: fromReception.data.compra.id, compra: {proveedorId: providerId, fechaCompra: "2026-08-14", fechaDocumento: "2026-08-14", tipoDocumento: "factura", numeroDocumentoProveedor: "F-REC-1", items: economicItems}});
  const stockBeforeEconomicDocument = (await adminDb.doc(`negocios/${businessId}/inventario/${productId}`).get()).data().stock;
  await call(owner, "confirmarCompra")({businessId, compraId: fromReception.data.compra.id, requestId: requestId("confirm-economic")});
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productId}`).get()).data().stock, stockBeforeEconomicDocument);
  assert.equal((await adminDb.doc(`negocios/${businessId}/recepciones/${second.data.recepcion.id}`).get()).data().compraId, fromReception.data.compra.id);
  console.log("OK recepciones parciales preparan compras independientes e idempotentes sin doble stock");

  const legacyOrderId = `legacy-collision-${RUN_ID}`; await seedOrder(legacyOrderId, 3);
  const legacyPurchase = await call(owner, "crearCompraDesdeOrden")({businessId, ordenCompraId: legacyOrderId, requestId: requestId("legacy-before-reception")});
  const legacyReception = await call(owner, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: legacyOrderId, requestId: requestId("legacy-reception")});
  const legacyReceptionItems = legacyReception.data.recepcion.items.map((line) => ({lineaId: line.lineaId, cantidad: line.tipoItem === "producto" ? 3 : 0}));
  await call(owner, "actualizarRecepcionBorrador")({businessId, recepcionId: legacyReception.data.recepcion.id, recepcion: {fechaRecepcion: "2026-08-14", observaciones: "Recepción posterior a compra legacy", items: legacyReceptionItems}});
  await call(owner, "confirmarRecepcion")({businessId, recepcionId: legacyReception.data.recepcion.id, requestId: requestId("legacy-confirm-reception")});
  await rejected("recepción no duplica una compra legacy", () => call(owner, "crearCompraDesdeRecepcion")({businessId, recepcionId: legacyReception.data.recepcion.id, requestId: requestId("v2-after-legacy")}), ["failed-precondition"]);
  assert.equal((await adminDb.collection(`negocios/${businessId}/compras`).where("ordenCompraId", "==", legacyOrderId).get()).size, 1);
  assert.equal((await adminDb.doc(`negocios/${businessId}/ordenesCompra/${legacyOrderId}`).get()).data().compraId, legacyPurchase.data.compra.id);
  console.log("OK compatibilidad legacy: recepción conserva stock y no crea una segunda compra");

  const concurrentOrder = `concurrent-${RUN_ID}`; await seedOrder(concurrentOrder, 5);
  const draftA = await call(owner, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: concurrentOrder, requestId: requestId("draft-a")});
  const draftB = await call(owner, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: concurrentOrder, requestId: requestId("draft-b")});
  const inputFor = (draft, amount) => ({fechaRecepcion: "2026-08-14", items: draft.data.recepcion.items.map((line) => ({lineaId: line.lineaId, cantidad: line.tipoItem === "producto" ? amount : 0}))});
  await call(owner, "actualizarRecepcionBorrador")({businessId, recepcionId: draftA.data.recepcion.id, recepcion: inputFor(draftA, 4)});
  await call(owner, "actualizarRecepcionBorrador")({businessId, recepcionId: draftB.data.recepcion.id, recepcion: inputFor(draftB, 5)});
  await call(owner, "confirmarRecepcion")({businessId, recepcionId: draftA.data.recepcion.id, requestId: requestId("confirm-a")});
  await rejected("sobre-recepción acumulada", () => call(owner, "confirmarRecepcion")({businessId, recepcionId: draftB.data.recepcion.id, requestId: requestId("confirm-b")}), ["failed-precondition"]);
  console.log("OK bloqueo autoritativo de sobre-recepción");

  const rejectedOrder = `rejected-${RUN_ID}`; await seedOrder(rejectedOrder, 1, "rechazada");
  await rejected("respuesta rechazada bloquea acción primaria", () => call(owner, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: rejectedOrder, requestId: requestId("rejected")}), ["failed-precondition"]);
  await call(owner, "registrarRespuestaProveedorOrdenCompra")({businessId, ordenCompraId: rejectedOrder, estado: "confirmada", comentario: "Proveedor corrigió respuesta"});
  await call(owner, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: rejectedOrder, requestId: requestId("corrected")});
  console.log("OK respuesta proveedor separada y corregible");

  const purchase = await call(owner, "crearCompra")({businessId, requestId: requestId("purchase"), compra: {proveedorId: providerId, fechaCompra: "2026-08-14", tipoDocumento: "factura", fechaDocumento: "2026-08-14", numeroDocumentoProveedor: "F-1", items: [{lineaId: "purchase-line", itemId: productId, cantidad: 3, costoUnitario: 1200, descuentoPct: 0}]}});
  const beforePurchase = (await adminDb.doc(`negocios/${businessId}/inventario/${productId}`).get()).data().stock;
  const purchaseConfirmed = await call(owner, "confirmarCompra")({businessId, compraId: purchase.data.compra.id, requestId: requestId("purchase-confirm")});
  assert.equal(purchaseConfirmed.data.compra.estado, "confirmada"); assert.equal(purchaseConfirmed.data.compra.stockAplicado, false);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${productId}`).get()).data().stock, beforePurchase);
  console.log("OK compra nueva económica sin doble stock");

  const receptionsQuery = (target) => query(collection(target.db, "negocios", businessId, "recepciones"), where("negocioId", "==", businessId));
  assert.ok((await getDocs(receptionsQuery(member))).size >= 2);
  await rejected("lectura cruzada", () => getDocs(receptionsQuery(outsider)), ["permission-denied"]);
  await rejected("escritura cliente bloqueada", () => setDoc(doc(owner.db, "negocios", businessId, "recepciones", `fake-${RUN_ID}`), {negocioId: businessId}), ["permission-denied"]);
  assert.equal((await adminDb.collection(`negocios/${otherBusinessId}/recepciones`).get()).size, 0);
  console.log("Reception integrated smoke: OK");
} finally {
  await Promise.all(clients.map(async (target) => { try { await terminate(target.db); } catch {} try { await deleteApp(target.app); } catch {} }));
  await deleteAdminApp(adminApp);
}
