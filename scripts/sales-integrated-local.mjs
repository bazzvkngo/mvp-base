import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc, terminate} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function createClient(name) {
  const app = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: `sales-${name}-${RUN_ID}`}, `sales-${name}-${RUN_ID}`);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {app, auth, db, functions};
}
async function authenticate(client, label) { const credential = await createUserWithEmailAndPassword(client.auth, `sales-${label}-${RUN_ID}@example.test`, `Sales-${RUN_ID}-Pass!`); client.uid = credential.user.uid; return client; }
const call = (client, name) => httpsCallable(client.functions, name);
const requestId = (prefix) => `${prefix}-${RUN_ID}-${Math.random().toString(36).slice(2, 10)}`;
async function expectCallableError(label, operation, expected = ["failed-precondition"]) { try { await operation(); } catch (error) { assert.ok(expected.some((code) => String(error?.code || "").includes(code)), `${label}: ${error?.code} ${error?.message}`); console.log(`OK rechazo: ${label}`); return; } throw new Error(`Se esperaba rechazo: ${label}`); }
async function expectDenied(label, operation) { try { await operation(); } catch (error) { assert.match(String(error?.code || ""), /permission-denied/); console.log(`OK reglas: ${label}`); return; } throw new Error(`Se esperaba denegación: ${label}`); }
const line = (itemId, lineaId, overrides = {}) => ({lineaId, itemId, cantidad: 1, precioUnitario: 10000, descuentoPct: 0, subtotalLinea: 1, totalLinea: 1, nombre: "Manipulado", ...overrides});
const payload = (clienteId, items, overrides = {}) => ({clienteId, fechaVenta: "2026-08-07", fechaDocumento: "", tipoDocumento: "sin_documento", numeroDocumento: "", condicionesPago: "Contado", observaciones: "", items, numero: "VTA-FAKE", estado: "confirmada", clienteSnapshot: {nombreRazonSocial: "Falso"}, stockAplicado: true, total: 1, ...overrides});

const owner = await authenticate(createClient("owner"), "owner");
const admin = await authenticate(createClient("admin"), "admin");
const member = await authenticate(createClient("member"), "member");
const outsider = await authenticate(createClient("outsider"), "outsider");
const clients = [owner, admin, member, outsider];
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `sales-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

try {
  const main = await call(owner, "createFirstBusiness")({nombreComercial: "Negocio ventas", rubroCodigo: "SERVICIOS_PROFESIONALES", regionCodigo: "13", requestId: requestId("business-main")});
  const other = await call(outsider, "createFirstBusiness")({nombreComercial: "Negocio externo", rubroCodigo: "SERVICIOS_PROFESIONALES", regionCodigo: "13", requestId: requestId("business-other")});
  const businessId = main.data.business.id; const otherBusinessId = other.data.business.id;
  const companyProfileA = {negocioId: businessId, nombreComercial: "Empresa A", razonSocial: "Empresa Histórica A SpA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.200.200-2", email: "empresa-a@example.test"};
  const companyProfileB = {...companyProfileA, nombreComercial: "Empresa B", razonSocial: "Empresa Vigente B SpA", email: "empresa-b@example.test"};
  await Promise.all([
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({negocioId: businessId, uid: admin.uid, rol: "ADMIN", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${member.uid}`).set({negocioId: businessId, uid: member.uid, rol: "MEMBER", estado: "activo"}),
    adminDb.doc(`negocios/${businessId}/empresa/perfil`).set(companyProfileA, {merge: true}),
  ]);
  const clientId = `client-${RUN_ID}`; const crossClient = `cross-client-${RUN_ID}`;
  const product = `product-${RUN_ID}`; const insufficient = `insufficient-${RUN_ID}`; const rollbackA = `rollback-a-${RUN_ID}`; const rollbackB = `rollback-b-${RUN_ID}`; const concurrent = `concurrent-${RUN_ID}`; const historical = `historical-${RUN_ID}`; const crossItem = `cross-item-${RUN_ID}`; const service = `service-${RUN_ID}`; const activity = `activity-${RUN_ID}`;
  const clientFixture = {clienteId: clientId, negocioId: businessId, estado: "activo", tipoCliente: "empresa", rut: "76.111.111-1", nombreRazonSocial: "Cliente Autoritativo SpA", email: "cliente@example.test"};
  const itemFixture = (itemId, tipoItem, nombre, stock) => ({itemId, negocioId: businessId, estado: "activo", tipoItem, nombre, codigoInterno: itemId.toUpperCase(), unidad: tipoItem === "producto" ? "unidad" : "servicio", precioInterno: 12500, ...(tipoItem === "producto" ? {stock} : {})});
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/clientes/${clientId}`).set(clientFixture),
    adminDb.doc(`negocios/${businessId}/clientes/${crossClient}`).set({...clientFixture, clienteId: crossClient, negocioId: otherBusinessId}),
    adminDb.doc(`negocios/${otherBusinessId}/clientes/${clientId}`).set({...clientFixture, negocioId: otherBusinessId}),
    adminDb.doc(`negocios/${businessId}/inventario/${product}`).set(itemFixture(product, "producto", "Notebook Lenovo ThinkPad E13", 10)),
    adminDb.doc(`negocios/${businessId}/inventario/${insufficient}`).set(itemFixture(insufficient, "producto", "Producto escaso", 2)),
    adminDb.doc(`negocios/${businessId}/inventario/${rollbackA}`).set(itemFixture(rollbackA, "producto", "Producto A", 8)),
    adminDb.doc(`negocios/${businessId}/inventario/${rollbackB}`).set(itemFixture(rollbackB, "producto", "Producto B", 3)),
    adminDb.doc(`negocios/${businessId}/inventario/${concurrent}`).set(itemFixture(concurrent, "producto", "Producto concurrente", 5)),
    adminDb.doc(`negocios/${businessId}/inventario/${historical}`).set({...itemFixture(historical, "producto", "Producto histórico vivo", 4), estado: "archivado"}),
    adminDb.doc(`negocios/${businessId}/inventario/${service}`).set(itemFixture(service, "servicio", "Servicio técnico")),
    adminDb.doc(`negocios/${businessId}/inventario/${activity}`).set(itemFixture(activity, "actividad", "Actividad profesional")),
    adminDb.doc(`negocios/${businessId}/inventario/${crossItem}`).set({...itemFixture(crossItem, "producto", "Producto externo", 5), negocioId: otherBusinessId}),
    adminDb.doc(`negocios/${otherBusinessId}/inventario/${product}`).set({...itemFixture(product, "producto", "Producto otro negocio", 10), negocioId: otherBusinessId}),
  ]);

  const createId = requestId("owner-create");
  const created = await call(owner, "crearVenta")({businessId, requestId: createId, venta: payload(clientId, [line(product, "main-product", {cantidad: 3}), line(service, "main-service"), line(activity, "main-activity")])});
  assert.equal(created.data.venta.numero, "VTA-2026-0001"); assert.equal(created.data.venta.estado, "borrador"); assert.equal(created.data.venta.clienteSnapshot.nombreRazonSocial, "Cliente Autoritativo SpA"); assert.equal(created.data.venta.items[0].nombre, "Notebook Lenovo ThinkPad E13"); assert.equal(created.data.venta.stockAplicado, false);
  assert.equal(created.data.venta.descuento, 0); assert.equal(created.data.venta.afectaIva, true); assert.equal(created.data.venta.tasaIva, 0.19);
  assert.equal(created.data.venta.empresaSnapshot.razonSocial, companyProfileA.razonSocial);
  await adminDb.doc(`negocios/${businessId}/empresa/perfil`).set(companyProfileB);
  assert.equal((await adminDb.doc(`negocios/${businessId}/ventas/${created.data.venta.id}`).get()).data().empresaSnapshot.razonSocial, companyProfileA.razonSocial);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${product}`).get()).data().stock, 10);
  const retryCreate = await call(owner, "crearVenta")({businessId, requestId: createId, venta: payload(clientId, [line(product, "main-product", {cantidad: 3}), line(service, "main-service"), line(activity, "main-activity")])});
  assert.equal(retryCreate.data.venta.id, created.data.venta.id); assert.equal(retryCreate.data.idempotent, true);
  const adminCreated = await call(admin, "crearVenta")({businessId, requestId: requestId("admin-create"), venta: payload(clientId, [line(service, "admin-service")])});
  assert.equal(adminCreated.data.venta.numero, "VTA-2026-0002");
  const cancelled = await call(admin, "cancelarVentaBorrador")({businessId, ventaId: adminCreated.data.venta.id});
  assert.equal(cancelled.data.venta.estado, "cancelada");
  const otherCreated = await call(outsider, "crearVenta")({businessId: otherBusinessId, requestId: requestId("other-create"), venta: payload(clientId, [line(product, "other-product")])});
  assert.equal(otherCreated.data.venta.numero, "VTA-2026-0001");
  console.log("OK venta directa OWNER/ADMIN, cancelación sin stock, snapshots, numeración e idempotencia");

  await expectCallableError("MEMBER no crea", () => call(member, "crearVenta")({businessId, requestId: requestId("member-create"), venta: payload(clientId, [line(product, "member")])}), ["permission-denied"]);
  await expectCallableError("cliente cross-business", () => call(owner, "crearVenta")({businessId, requestId: requestId("cross-client"), venta: payload(crossClient, [line(product, "cross-client")])}), ["failed-precondition", "permission-denied"]);
  await expectCallableError("ítem cross-business", () => call(owner, "crearVenta")({businessId, requestId: requestId("cross-item"), venta: payload(clientId, [line(crossItem, "cross-item")])}), ["failed-precondition", "permission-denied"]);
  await expectCallableError("descuento general supera disponible", () => call(owner, "crearVenta")({businessId, requestId: requestId("invalid-discount"), venta: payload(clientId, [line(service, "invalid-discount")], {descuento: 10001})}), ["invalid-argument"]);

  const assertDraftUntouched = async () => { assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${product}`).get()).data().stock, 10); assert.equal((await adminDb.doc(`negocios/${businessId}/ventas/${created.data.venta.id}`).get()).data().estado, "borrador"); assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("ventaId", "==", created.data.venta.id).get()).size, 0); };
  for (const [path, label] of [[`clientes/${clientId}`, "cliente"], [`inventario/${product}`, "producto"], [`inventario/${service}`, "servicio"], [`inventario/${activity}`, "actividad"]]) { await adminDb.doc(`negocios/${businessId}/${path}`).update({estado: "archivado"}); await expectCallableError(`${label} archivado bloquea confirmación directa`, () => call(owner, "confirmarVenta")({businessId, ventaId: created.data.venta.id, requestId: requestId(`archived-${label}`)})); await assertDraftUntouched(); await adminDb.doc(`negocios/${businessId}/${path}`).update({estado: "activo"}); }

  const confirmationId = requestId("confirm-main");
  const confirmed = await call(owner, "confirmarVenta")({businessId, ventaId: created.data.venta.id, requestId: confirmationId});
  assert.equal(confirmed.data.venta.estado, "confirmada"); assert.equal(confirmed.data.venta.stockAplicado, true); assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${product}`).get()).data().stock, 7); assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${service}`).get()).data().stock, undefined); assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${activity}`).get()).data().stock, undefined);
  const movementQuery = await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("ventaId", "==", created.data.venta.id).get(); assert.equal(movementQuery.size, 1); const movement = movementQuery.docs[0].data(); assert.equal(movement.tipo, "salida_venta"); assert.equal(movement.stockAnterior, 10); assert.equal(movement.stockPosterior, 7);
  await call(owner, "confirmarVenta")({businessId, ventaId: created.data.venta.id, requestId: confirmationId}); await call(owner, "confirmarVenta")({businessId, ventaId: created.data.venta.id, requestId: requestId("confirm-other")}); assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${product}`).get()).data().stock, 7);
  console.log("OK confirmación, servicios/actividades sin stock, movimiento y doble idempotencia");

  const low = await call(owner, "crearVenta")({businessId, requestId: requestId("low-create"), venta: payload(clientId, [line(insufficient, "low", {cantidad: 3})])});
  await expectCallableError("stock insuficiente", () => call(owner, "confirmarVenta")({businessId, ventaId: low.data.venta.id, requestId: requestId("low-confirm")})); assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${insufficient}`).get()).data().stock, 2);
  const rollback = await call(owner, "crearVenta")({businessId, requestId: requestId("rollback-create"), venta: payload(clientId, [line(rollbackA, "rollback-a", {cantidad: 2}), line(rollbackB, "rollback-b", {cantidad: 5})])});
  await expectCallableError("rollback con varios productos", () => call(owner, "confirmarVenta")({businessId, ventaId: rollback.data.venta.id, requestId: requestId("rollback-confirm")})); assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${rollbackA}`).get()).data().stock, 8); assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${rollbackB}`).get()).data().stock, 3); assert.equal((await adminDb.doc(`negocios/${businessId}/ventas/${rollback.data.venta.id}`).get()).data().estado, "borrador"); assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("ventaId", "==", rollback.data.venta.id).get()).size, 0);
  console.log("OK stock insuficiente y rollback atómico de múltiples productos");

  const [saleA, saleB] = await Promise.all([call(owner, "crearVenta")({businessId, requestId: requestId("concurrent-a"), venta: payload(clientId, [line(concurrent, "concurrent-a", {cantidad: 3})])}), call(admin, "crearVenta")({businessId, requestId: requestId("concurrent-b"), venta: payload(clientId, [line(concurrent, "concurrent-b", {cantidad: 3})])})]);
  assert.notEqual(saleA.data.venta.numero, saleB.data.venta.numero);
  const concurrentResults = await Promise.allSettled([call(owner, "confirmarVenta")({businessId, ventaId: saleA.data.venta.id, requestId: requestId("confirm-a")}), call(admin, "confirmarVenta")({businessId, ventaId: saleB.data.venta.id, requestId: requestId("confirm-b")})]);
  assert.equal(concurrentResults.filter((entry) => entry.status === "fulfilled").length, 1); assert.equal(concurrentResults.filter((entry) => entry.status === "rejected").length, 1); assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${concurrent}`).get()).data().stock, 2);
  console.log("OK concurrencia: una venta confirma y la otra falla sin stock negativo");

  const quoteId = `quote-${RUN_ID}`; const exemptQuoteId = `quote-exempt-${RUN_ID}`; const rejectedQuoteId = `quote-rejected-${RUN_ID}`;
  const quoteItem = {lineaId: "quote-product", itemId: historical, cantidad: 2, precioUnitarioEditable: 9000, descuentoPorcentaje: 5, codigo: "HIST", nombre: "Producto histórico cotizado", tipoItem: "producto", unidad: "unidad", inventarioSnapshot: {inventarioId: historical, codigoInterno: "HIST", nombre: "Producto histórico cotizado", tipoItem: "producto", unidad: "unidad"}};
  const quoteFixture = {quoteId, negocioId: businessId, numero: "COT-2026-0900", estado: "aceptada", clienteId: clientId, cliente: {...clientFixture, nombreRazonSocial: "Cliente histórico cotizado"}, empresaSnapshot: companyProfileA, items: [quoteItem], subtotal: 18000, descuentoItems: 900, descuento: 1100, descuentoTotal: 2000, neto: 16000, afectaIva: true, tasaIva: 0.19, iva: 3040, total: 19040, condiciones: {formaPago: "30 días", observaciones: "Histórico"}};
  const exemptQuoteFixture = {...quoteFixture, quoteId: exemptQuoteId, numero: "COT-2026-0902", afectaIva: false, tasaIva: 0, iva: 0, total: 16000};
  delete exemptQuoteFixture.empresaSnapshot;
  await Promise.all([adminDb.doc(`negocios/${businessId}/cotizaciones/${quoteId}`).set(quoteFixture), adminDb.doc(`negocios/${businessId}/cotizaciones/${exemptQuoteId}`).set(exemptQuoteFixture), adminDb.doc(`negocios/${businessId}/cotizaciones/${rejectedQuoteId}`).set({...quoteFixture, quoteId: rejectedQuoteId, numero: "COT-2026-0901", estado: "rechazada"})]);
  await expectCallableError("cotización no elegible", () => call(owner, "crearVentaDesdeCotizacion")({businessId, cotizacionId: rejectedQuoteId, requestId: requestId("rejected-quote")}));
  await expectCallableError("cotización cross-business", () => call(outsider, "crearVentaDesdeCotizacion")({businessId: otherBusinessId, cotizacionId: quoteId, requestId: requestId("cross-quote")}), ["not-found", "permission-denied"]);
  const conversionId = requestId("quote-convert"); const converted = await call(owner, "crearVentaDesdeCotizacion")({businessId, cotizacionId: quoteId, requestId: conversionId}); assert.equal(converted.data.venta.cotizacionId, quoteId); assert.equal(converted.data.venta.clienteSnapshot.nombreRazonSocial, "Cliente histórico cotizado"); assert.equal(converted.data.venta.items[0].nombre, "Producto histórico cotizado");
  assert.equal(converted.data.venta.empresaSnapshot.razonSocial, companyProfileA.razonSocial);
  for (const field of ["subtotal", "descuentoItems", "descuento", "descuentoTotal", "neto", "afectaIva", "tasaIva", "iva", "total"]) assert.equal(converted.data.venta[field], quoteFixture[field], `conversión afecta: ${field}`);
  const exemptConverted = await call(owner, "crearVentaDesdeCotizacion")({businessId, cotizacionId: exemptQuoteId, requestId: requestId("quote-exempt")});
  for (const field of ["subtotal", "descuentoItems", "descuento", "descuentoTotal", "neto", "afectaIva", "tasaIva", "iva", "total"]) assert.equal(exemptConverted.data.venta[field], exemptQuoteFixture[field], `conversión exenta: ${field}`);
  assert.equal(exemptConverted.data.venta.iva, 0);
  assert.equal(exemptConverted.data.venta.empresaSnapshot.razonSocial, companyProfileB.razonSocial);
  assert.equal((await adminDb.doc(`negocios/${businessId}/cotizaciones/${quoteId}`).get()).data().total, quoteFixture.total);
  console.log("OK conversión tributaria: descuentos y totales idénticos en cotizaciones afectas y exentas");
  const conversionRetry = await call(owner, "crearVentaDesdeCotizacion")({businessId, cotizacionId: quoteId, requestId: conversionId}); const conversionOther = await call(owner, "crearVentaDesdeCotizacion")({businessId, cotizacionId: quoteId, requestId: requestId("quote-convert-other")}); assert.equal(conversionRetry.data.venta.id, converted.data.venta.id); assert.equal(conversionOther.data.venta.id, converted.data.venta.id); assert.equal((await adminDb.collection(`negocios/${businessId}/ventas`).where("cotizacionId", "==", quoteId).get()).size, 1);
  const editable = {clienteId: clientId, fechaVenta: "2026-08-07", fechaDocumento: "", tipoDocumento: "sin_documento", numeroDocumento: "", condicionesPago: "45 días", observaciones: "Ajustada", items: [{lineaId: "quote-product", itemId: historical, cantidad: 1, precioUnitario: 8500, descuentoPct: 0}]};
  await call(owner, "actualizarVentaBorrador")({businessId, ventaId: converted.data.venta.id, venta: editable});
  await expectCallableError("cantidad supera cotización", () => call(owner, "actualizarVentaBorrador")({businessId, ventaId: converted.data.venta.id, venta: {...editable, items: [{...editable.items[0], cantidad: 3}]}}));
  await expectCallableError("referencia de cotización bloqueada", () => call(owner, "actualizarVentaBorrador")({businessId, ventaId: converted.data.venta.id, venta: {...editable, items: [{...editable.items[0], itemId: product}]}}));
  await adminDb.doc(`negocios/${businessId}/clientes/${clientId}`).update({estado: "archivado"}); const quoteConfirmed = await call(owner, "confirmarVenta")({businessId, ventaId: converted.data.venta.id, requestId: requestId("quote-confirm")}); assert.equal(quoteConfirmed.data.venta.estado, "confirmada"); assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/${historical}`).get()).data().stock, 3); await adminDb.doc(`negocios/${businessId}/clientes/${clientId}`).update({estado: "activo"});
  console.log("OK cotización aceptada: conversión única, snapshot histórico, referencias bloqueadas y producto archivado permitido");

  await expectDenied("escritura directa de venta", () => setDoc(doc(owner.db, `negocios/${businessId}/ventas/sdk-write`), {negocioId: businessId}));
  await expectDenied("escritura directa de movimiento", () => setDoc(doc(owner.db, `negocios/${businessId}/movimientosInventario/sdk-write`), {negocioId: businessId}));
  assert.equal((await getDoc(doc(member.db, `negocios/${businessId}/ventas/${created.data.venta.id}`))).exists(), true);
  await expectDenied("venta de otro negocio no legible", () => getDoc(doc(outsider.db, `negocios/${businessId}/ventas/${created.data.venta.id}`)));
  console.log("OK reglas MEMBER lectura, escrituras cerradas y aislamiento multiempresa");
  console.log("Smoke integrado de Ventas completado.");
} finally {
  await Promise.all(clients.map(async (client) => { try { await terminate(client.db); } catch {} try { await deleteApp(client.app); } catch {} }));
  await deleteAdminApp(adminApp);
}
