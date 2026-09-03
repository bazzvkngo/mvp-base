import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {collection, connectFirestoreEmulator, doc, getDocs, getFirestore, query, terminate, updateDoc, where} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";

// SPEC 020 ETAPA 5 (final): integración comercial autoritativa —
// PENDIENTE_COBRO -> INCORPORADO_A_VENTA dentro de la MISMA transacción de
// confirmarVenta. Emulator Suite real (auth+firestore+functions), nunca
// Firebase real. Mismo arnés que sales-integrated-local.mjs y
// work-additional-integrated-local.mjs.

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function createClientApp(name) {
  const app = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: `saleadd-${name}-${RUN_ID}`}, `saleadd-${name}-${RUN_ID}`);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {app, auth, db, functions};
}
async function authenticate(client, label) {
  const credential = await createUserWithEmailAndPassword(client.auth, `saleadd-${label}-${RUN_ID}@example.test`, `SaleAdd-${RUN_ID}-Pass!`);
  client.uid = credential.user.uid;
  return client;
}
const callable = (client, name) => httpsCallable(client.functions, name);
const requestId = (label) => `saleadd-${RUN_ID}-${label}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
async function expectCallableError(label, operation, expectedCodes) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    assert.ok(expectedCodes.some((expected) => code.includes(expected)), `${label}: código inesperado ${code} (${error?.message})`);
    console.log(`OK rechazo: ${label}`);
    return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}
const line = (itemId, lineaId, overrides = {}) => ({lineaId, itemId, cantidad: 1, precioUnitario: 10000, descuentoPct: 0, ...overrides});
const salePayload = (clienteId, items, overrides = {}) => ({clienteId, fechaVenta: "2026-09-04", fechaDocumento: "", tipoDocumento: "sin_documento", numeroDocumento: "", condicionesPago: "", observaciones: "", items, descuento: 0, afectaIva: true, ...overrides});

const owner = await authenticate(createClientApp("owner"), "owner");
const outsider = await authenticate(createClientApp("outsider"), "outsider");
const clients = [owner, outsider];
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `saleadd-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

try {
  const main = await callable(owner, "createFirstBusiness")({nombreComercial: "Negocio integración comercial", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-main")});
  const other = await callable(outsider, "createFirstBusiness")({nombreComercial: "Negocio externo integración", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-other")});
  const businessId = main.data.business.id;
  const otherBusinessId = other.data.business.id;
  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).set({identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.600.600-6", verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.600.600-6"}}, {merge: true}),
    adminDb.doc(`negocios/${otherBusinessId}`).set({identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.900.900-9", verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.900.900-9"}}, {merge: true}),
    adminDb.doc(`negocios/${businessId}/empresa/perfil`).set({negocioId: businessId, nombreComercial: "Empresa integración", razonSocial: "Empresa Integración SpA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.600.600-6", email: "integracion@example.test"}, {merge: true}),
  ]);

  const clientId = `client-${RUN_ID}`;
  await adminDb.doc(`negocios/${businessId}/clientes/${clientId}`).set({clienteId: clientId, negocioId: businessId, estado: "activo", tipoCliente: "empresa", rut: "76.111.111-1", nombreRazonSocial: "Cliente Integración SpA", email: "cliente@example.test"});

  const product = `product-${RUN_ID}`; const lowStockProduct = `lowstock-${RUN_ID}`; const service = `service-${RUN_ID}`;
  const itemFixture = (itemId, tipoItem, nombre, stock) => ({itemId, negocioId: businessId, estado: "activo", tipoItem, nombre, codigoInterno: itemId.toUpperCase(), unidad: tipoItem === "producto" ? "unidad" : "servicio", precioInterno: 12500, ...(tipoItem === "producto" ? {stock, costoBase: 4000, costoPromedio: 3500, costoPromedioMoneda: "CLP"} : {})});
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/inventario/${product}`).set(itemFixture(product, "producto", "Cable UTP categoría 6", 50)),
    adminDb.doc(`negocios/${businessId}/inventario/${lowStockProduct}`).set(itemFixture(lowStockProduct, "producto", "Producto escaso", 2)),
    adminDb.doc(`negocios/${businessId}/inventario/${service}`).set(itemFixture(service, "servicio", "Instalación adicional", 0)),
  ]);

  const project = await callable(owner, "crearTrabajo")({businessId, requestId: requestId("work-main"), trabajo: {titulo: "Proyecto con adicionales", descripcion: "", clienteId: clientId, responsableUid: "", participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""}});
  const workId = project.data.trabajoId;

  const crearAdicional = callable(owner, "crearAdicionalTrabajo");
  const anularAdicional = callable(owner, "anularAdicionalTrabajo");
  const crearVenta = callable(owner, "crearVenta");
  const actualizarVentaBorrador = callable(owner, "actualizarVentaBorrador");
  const confirmarVenta = callable(owner, "confirmarVenta");

  // ==================================================================
  // Caso 1: Venta sin adicionales funciona igual que antes
  // ==================================================================
  const plainSale = await crearVenta({businessId, requestId: requestId("plain-create"), venta: salePayload(clientId, [line(product, "plain-1", {cantidad: 1})])});
  const plainConfirm = await confirmarVenta({businessId, ventaId: plainSale.data.venta.id, requestId: requestId("plain-confirm")});
  assert.equal(plainConfirm.data.venta.estado, "confirmada");
  console.log("OK caso 1: una Venta sin adicionales se confirma exactamente igual que antes de ETAPA 5");

  // --- Caso 2: Proyecto sin adicionales (Venta vinculada a un Proyecto vacío de adicionales, igual de válida) ---
  const emptyProjectSale = await crearVenta({businessId, requestId: requestId("empty-project-create"), venta: salePayload(clientId, [line(product, "empty-1", {cantidad: 1})], {trabajoId: workId})});
  assert.equal(emptyProjectSale.data.venta.trabajoId, workId);
  const emptyProjectConfirm = await confirmarVenta({businessId, ventaId: emptyProjectSale.data.venta.id, requestId: requestId("empty-project-confirm")});
  assert.equal(emptyProjectConfirm.data.venta.estado, "confirmada");
  console.log("OK caso 2: una Venta vinculada a un Proyecto sin adicionales se confirma con normalidad");

  // ==================================================================
  // Preparar varios adicionales pendientes para el resto de los casos
  // ==================================================================
  const additionalProduct = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-product"), adicional: {itemId: product, cantidad: 2, precioUnitario: 15000}})).data;
  const additionalService = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-service"), adicional: {itemId: service, cantidad: 1, precioUnitario: 20000}})).data;

  // --- Casos 3/4/5: el selector (misma consulta real que listarAdicionalesPendientesTrabajo) lista sólo PENDIENTE_COBRO ---
  const annulledAdditional = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-to-annul"), adicional: {itemId: service, cantidad: 1, precioUnitario: 5000}})).data;
  await anularAdicional({businessId, trabajoId: workId, adicionalId: annulledAdditional.adicionalId, motivo: "Prueba de exclusión del selector", requestId: requestId("annul-for-selector")});
  const pendingQuery = query(collection(owner.db, `negocios/${businessId}/trabajos/${workId}/adicionales`), where("negocioId", "==", businessId), where("trabajoId", "==", workId), where("estado", "==", "PENDIENTE_COBRO"));
  const pendingSnapshot = await getDocs(pendingQuery);
  const pendingIds = pendingSnapshot.docs.map((entry) => entry.id);
  assert.ok(pendingIds.includes(additionalProduct.adicionalId), "caso 3: el adicional producto pendiente aparece en el selector");
  assert.ok(pendingIds.includes(additionalService.adicionalId), "caso 3: el adicional servicio pendiente aparece en el selector");
  assert.ok(!pendingIds.includes(annulledAdditional.adicionalId), "caso 4: un adicional ANULADO nunca aparece en el selector");
  console.log("OK casos 3/4: la misma consulta que usa el selector lista sólo PENDIENTE_COBRO, excluye ANULADO");

  // ==================================================================
  // Casos 6/7/10/11/12/13/14: seleccionar uno, varios; conversión a línea;
  // borrador no cambia estado; confirmación cierra correctamente
  // ==================================================================
  const multiSale = await crearVenta({businessId, requestId: requestId("multi-create"), venta: salePayload(clientId, [
    line(product, "multi-product", {cantidad: additionalProduct.cantidad ?? 2, precioUnitario: 15000, origenAdicionalId: additionalProduct.adicionalId}),
    line(service, "multi-service", {cantidad: 1, precioUnitario: 20000, origenAdicionalId: additionalService.adicionalId}),
  ], {trabajoId: workId})});
  const multiSaleId = multiSale.data.venta.id;
  const storedProductLine = multiSale.data.venta.items.find((item) => item.lineaId === "multi-product");
  assert.equal(storedProductLine.origenAdicionalId, additionalProduct.adicionalId, "caso 10: la línea conserva la referencia al adicional de origen");
  assert.equal(storedProductLine.itemId, product);
  assert.equal(storedProductLine.tipoItem, "producto");
  console.log("OK casos 6/7/10: uno y varios adicionales se convierten en líneas de venta válidas con itemId/tipoItem/cantidad/precio + origenAdicionalId");

  const additionalProductAfterDraft = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${additionalProduct.adicionalId}`).get()).data();
  assert.equal(additionalProductAfterDraft.estado, "PENDIENTE_COBRO", "caso 11: crear/guardar un borrador NUNCA cambia el estado del adicional");
  console.log("OK caso 11: un borrador con adicionales seleccionados no muta su estado");

  const multiConfirm = await confirmarVenta({businessId, ventaId: multiSaleId, requestId: requestId("multi-confirm")});
  assert.equal(multiConfirm.data.venta.estado, "confirmada");
  const additionalProductAfterConfirm = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${additionalProduct.adicionalId}`).get()).data();
  const additionalServiceAfterConfirm = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${additionalService.adicionalId}`).get()).data();
  assert.equal(additionalProductAfterConfirm.estado, "INCORPORADO_A_VENTA", "caso 12/13: confirmar cierra el adicional");
  assert.equal(additionalServiceAfterConfirm.estado, "INCORPORADO_A_VENTA");
  assert.equal(additionalProductAfterConfirm.ventaId, multiSaleId, "caso 14: ventaId queda trazado");
  assert.equal(additionalProductAfterConfirm.lineaId, "multi-product", "caso 14: lineaId queda trazado");
  assert.equal(additionalServiceAfterConfirm.ventaId, multiSaleId);
  console.log("OK casos 12/13/14: PENDIENTE_COBRO -> INCORPORADO_A_VENTA con ventaId/lineaId trazados para ambos adicionales");

  // --- Caso 5: INCORPORADO_A_VENTA excluido del selector (misma consulta que casos 3/4) ---
  const pendingAfterIncorporationSnapshot = await getDocs(pendingQuery);
  const pendingIdsAfterIncorporation = pendingAfterIncorporationSnapshot.docs.map((entry) => entry.id);
  assert.ok(!pendingIdsAfterIncorporation.includes(additionalProduct.adicionalId), "caso 5: un adicional ya INCORPORADO_A_VENTA nunca aparece en el selector");
  assert.ok(!pendingIdsAfterIncorporation.includes(additionalService.adicionalId), "caso 5: idem para el segundo adicional recién incorporado");
  console.log("OK caso 5: un adicional INCORPORADO_A_VENTA queda excluido del selector tan pronto se confirma la venta");

  // --- Caso 15: replay idempotente de la MISMA venta no reprocesa el adicional ---
  const historyCountBefore = (await adminDb.collection(`negocios/${businessId}/trabajos/${workId}/historial`).where("tipo", "==", "adicional_incorporado_a_venta").get()).size;
  const replay = await confirmarVenta({businessId, ventaId: multiSaleId, requestId: requestId("multi-confirm")});
  assert.equal(replay.data.idempotent, true);
  const historyCountAfterReplay = (await adminDb.collection(`negocios/${businessId}/trabajos/${workId}/historial`).where("tipo", "==", "adicional_incorporado_a_venta").get()).size;
  assert.equal(historyCountAfterReplay, historyCountBefore, "caso 15: un replay con el mismo requestId no duplica el evento de incorporación");
  const additionalProductAfterReplay = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${additionalProduct.adicionalId}`).get()).data();
  assert.equal(additionalProductAfterReplay.estado, "INCORPORADO_A_VENTA");
  console.log("OK caso 15: replay idempotente de la misma venta no reprocesa ni duplica el cierre del adicional");

  // --- Caso 16: otra Venta intenta reutilizar un adicional ya incorporado -> rechazada ---
  const reuseSale = await crearVenta({businessId, requestId: requestId("reuse-create"), venta: salePayload(clientId, [line(product, "reuse-1", {cantidad: 1, precioUnitario: 15000, origenAdicionalId: additionalProduct.adicionalId})], {trabajoId: workId})});
  await expectCallableError("otra venta reutiliza un adicional ya incorporado", () => confirmarVenta({businessId, ventaId: reuseSale.data.venta.id, requestId: requestId("reuse-confirm")}), ["failed-precondition"]);
  const reuseSaleAfter = (await adminDb.doc(`negocios/${businessId}/ventas/${reuseSale.data.venta.id}`).get()).data();
  assert.equal(reuseSaleAfter.estado, "borrador", "la venta que intentó reutilizar el adicional queda sin confirmar");
  console.log("OK caso 16: una venta distinta no puede incorporar un adicional que otra venta ya cerró");

  // ==================================================================
  // Caso 17: dos ventas concurrentes por el mismo adicional -> una sola gana
  // ==================================================================
  const concurrentAdditional = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-concurrent"), adicional: {itemId: service, cantidad: 1, precioUnitario: 8000}})).data;
  const concurrentSaleA = await crearVenta({businessId, requestId: requestId("concurrent-a-create"), venta: salePayload(clientId, [line(service, "concurrent-a", {cantidad: 1, precioUnitario: 8000, origenAdicionalId: concurrentAdditional.adicionalId})], {trabajoId: workId})});
  const concurrentSaleB = await crearVenta({businessId, requestId: requestId("concurrent-b-create"), venta: salePayload(clientId, [line(service, "concurrent-b", {cantidad: 1, precioUnitario: 8000, origenAdicionalId: concurrentAdditional.adicionalId})], {trabajoId: workId})});
  const concurrentResults = await Promise.allSettled([
    confirmarVenta({businessId, ventaId: concurrentSaleA.data.venta.id, requestId: requestId("concurrent-a-confirm")}),
    confirmarVenta({businessId, ventaId: concurrentSaleB.data.venta.id, requestId: requestId("concurrent-b-confirm")}),
  ]);
  const fulfilled = concurrentResults.filter((entry) => entry.status === "fulfilled");
  const rejected = concurrentResults.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactamente una de las dos confirmaciones concurrentes debe ganar");
  assert.equal(rejected.length, 1, "la otra debe fallar limpiamente, sin quedar en un estado intermedio");
  const concurrentAdditionalAfter = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${concurrentAdditional.adicionalId}`).get()).data();
  assert.equal(concurrentAdditionalAfter.estado, "INCORPORADO_A_VENTA");
  const winningSaleId = fulfilled[0].value.data.venta.id;
  assert.equal(concurrentAdditionalAfter.ventaId, winningSaleId, "el adicional queda trazado exclusivamente a la venta que ganó la carrera");
  const losingSaleId = winningSaleId === concurrentSaleA.data.venta.id ? concurrentSaleB.data.venta.id : concurrentSaleA.data.venta.id;
  const losingSaleAfter = (await adminDb.doc(`negocios/${businessId}/ventas/${losingSaleId}`).get()).data();
  assert.equal(losingSaleAfter.estado, "borrador", "la venta perdedora nunca queda confirmada (sin doble incorporación ni doble cobro)");
  console.log("OK caso 17: dos ventas concurrentes por el mismo adicional — una sola gana, la otra falla limpio, sin estado incoherente");

  // --- Caso 18: adicional ya anulado -> confirmación rechazada ---
  const preAnnulled = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-pre-annul"), adicional: {itemId: service, cantidad: 1, precioUnitario: 9000}})).data;
  await anularAdicional({businessId, trabajoId: workId, adicionalId: preAnnulled.adicionalId, motivo: "Cliente desistió antes de vender", requestId: requestId("annul-before-sale")});
  const annulledSale = await crearVenta({businessId, requestId: requestId("annulled-create"), venta: salePayload(clientId, [line(service, "annulled-1", {cantidad: 1, precioUnitario: 9000, origenAdicionalId: preAnnulled.adicionalId})], {trabajoId: workId})});
  await expectCallableError("adicional anulado no puede incorporarse", () => confirmarVenta({businessId, ventaId: annulledSale.data.venta.id, requestId: requestId("annulled-confirm")}), ["failed-precondition"]);
  console.log("OK caso 18: un adicional ANULADO nunca puede incorporarse a una venta");

  // --- Caso 19: cross-business (documento sembrado con negocioId adulterado) -> rechazado ---
  const crossBusinessAdditionalId = `cross-biz-${RUN_ID}`;
  await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${crossBusinessAdditionalId}`).set({adicionalId: crossBusinessAdditionalId, negocioId: otherBusinessId, trabajoId: workId, itemId: product, tipoItem: "producto", cantidad: 1, precioUnitario: 15000, moneda: "CLP", estado: "PENDIENTE_COBRO", ventaId: "", lineaId: "", registradoPorUid: owner.uid, creadoEn: new Date()});
  const crossBusinessSale = await crearVenta({businessId, requestId: requestId("cross-biz-create"), venta: salePayload(clientId, [line(product, "cross-biz-1", {cantidad: 1, precioUnitario: 15000, origenAdicionalId: crossBusinessAdditionalId})], {trabajoId: workId})});
  await expectCallableError("adicional con negocioId de otro negocio", () => confirmarVenta({businessId, ventaId: crossBusinessSale.data.venta.id, requestId: requestId("cross-biz-confirm")}), ["not-found"]);
  console.log("OK caso 19: un adicional cuyo negocioId real no coincide se rechaza (not-found)");

  // --- Caso 20: cross-work (documento sembrado con trabajoId adulterado) -> rechazado ---
  const otherProject = await callable(owner, "crearTrabajo")({businessId, requestId: requestId("work-other"), trabajo: {titulo: "Otro proyecto", descripcion: "", clienteId: "", responsableUid: "", participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""}});
  const otherWorkId = otherProject.data.trabajoId;
  const crossWorkAdditionalId = `cross-work-${RUN_ID}`;
  await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${crossWorkAdditionalId}`).set({adicionalId: crossWorkAdditionalId, negocioId: businessId, trabajoId: otherWorkId, itemId: product, tipoItem: "producto", cantidad: 1, precioUnitario: 15000, moneda: "CLP", estado: "PENDIENTE_COBRO", ventaId: "", lineaId: "", registradoPorUid: owner.uid, creadoEn: new Date()});
  const crossWorkSale = await crearVenta({businessId, requestId: requestId("cross-work-create"), venta: salePayload(clientId, [line(product, "cross-work-1", {cantidad: 1, precioUnitario: 15000, origenAdicionalId: crossWorkAdditionalId})], {trabajoId: workId})});
  await expectCallableError("adicional con trabajoId de otro proyecto", () => confirmarVenta({businessId, ventaId: crossWorkSale.data.venta.id, requestId: requestId("cross-work-confirm")}), ["not-found"]);
  console.log("OK caso 20: un adicional cuyo trabajoId real no coincide con el de la venta se rechaza (not-found)");

  // --- Caso 21: ítem manipulado (la línea apunta a un itemId distinto al del adicional) -> rechazado ---
  const itemMismatchAdditional = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-item-mismatch"), adicional: {itemId: product, cantidad: 1, precioUnitario: 15000}})).data;
  const itemMismatchSale = await crearVenta({businessId, requestId: requestId("item-mismatch-create"), venta: salePayload(clientId, [line(service, "item-mismatch-1", {cantidad: 1, precioUnitario: 15000, origenAdicionalId: itemMismatchAdditional.adicionalId})], {trabajoId: workId})});
  await expectCallableError("línea con itemId distinto al del adicional", () => confirmarVenta({businessId, ventaId: itemMismatchSale.data.venta.id, requestId: requestId("item-mismatch-confirm")}), ["failed-precondition"]);
  const itemMismatchAdditionalAfter = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${itemMismatchAdditional.adicionalId}`).get()).data();
  assert.equal(itemMismatchAdditionalAfter.estado, "PENDIENTE_COBRO", "el adicional no se cierra si el ítem de la línea no coincide");
  console.log("OK caso 21: un ítem manipulado (distinto al del adicional referenciado) se rechaza sin cerrar el adicional");

  // --- Casos 22/23: cantidad/precio manipulados siguen la MISMA validación genérica de cualquier línea (sin bypass por traer origenAdicionalId) ---
  const validationAdditional = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-validation"), adicional: {itemId: product, cantidad: 1, precioUnitario: 15000}})).data;
  await expectCallableError("cantidad inválida en línea con origenAdicionalId", () => crearVenta({businessId, requestId: requestId("bad-qty-create"), venta: salePayload(clientId, [line(product, "bad-qty-1", {cantidad: 0, precioUnitario: 15000, origenAdicionalId: validationAdditional.adicionalId})], {trabajoId: workId})}), ["invalid-argument"]);
  await expectCallableError("precio inválido en línea con origenAdicionalId", () => crearVenta({businessId, requestId: requestId("bad-price-create"), venta: salePayload(clientId, [line(product, "bad-price-1", {cantidad: 1, precioUnitario: -1, origenAdicionalId: validationAdditional.adicionalId})], {trabajoId: workId})}), ["invalid-argument"]);
  console.log("OK casos 22/23: una línea con origenAdicionalId no se salta la validación genérica de cantidad/precio ya existente");

  // --- Caso 24: moneda incompatible (adicional sembrado con moneda distinta a la de la venta) -> rechazada ---
  const currencyMismatchAdditionalId = `currency-mismatch-${RUN_ID}`;
  await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${currencyMismatchAdditionalId}`).set({adicionalId: currencyMismatchAdditionalId, negocioId: businessId, trabajoId: workId, itemId: product, tipoItem: "producto", cantidad: 1, precioUnitario: 15000, moneda: "USD", estado: "PENDIENTE_COBRO", ventaId: "", lineaId: "", registradoPorUid: owner.uid, creadoEn: new Date()});
  const currencyMismatchSale = await crearVenta({businessId, requestId: requestId("currency-mismatch-create"), venta: salePayload(clientId, [line(product, "currency-mismatch-1", {cantidad: 1, precioUnitario: 15000, origenAdicionalId: currencyMismatchAdditionalId})], {trabajoId: workId})});
  await expectCallableError("adicional en moneda distinta a la de la venta", () => confirmarVenta({businessId, ventaId: currencyMismatchSale.data.venta.id, requestId: requestId("currency-mismatch-confirm")}), ["failed-precondition"]);
  console.log("OK caso 24: un adicional en una moneda distinta a la de la venta se rechaza, sin conversión FX");

  // --- Casos 25/26: stock insuficiente / fallo normal -> el adicional permanece PENDIENTE_COBRO (sin partial commit) ---
  const stockAdditional = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-stock"), adicional: {itemId: lowStockProduct, cantidad: 1, precioUnitario: 15000}})).data;
  const stockSale = await crearVenta({businessId, requestId: requestId("stock-create"), venta: salePayload(clientId, [line(lowStockProduct, "stock-1", {cantidad: 999, precioUnitario: 15000, origenAdicionalId: stockAdditional.adicionalId})], {trabajoId: workId})});
  await expectCallableError("stock insuficiente con adicional referenciado", () => confirmarVenta({businessId, ventaId: stockSale.data.venta.id, requestId: requestId("stock-confirm")}), ["failed-precondition"]);
  const stockAdditionalAfter = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${stockAdditional.adicionalId}`).get()).data();
  assert.equal(stockAdditionalAfter.estado, "PENDIENTE_COBRO", "casos 25/26: un fallo de confirmarVenta (stock insuficiente) no deja el adicional cerrado ni la venta parcialmente confirmada");
  const stockSaleAfter = (await adminDb.doc(`negocios/${businessId}/ventas/${stockSale.data.venta.id}`).get()).data();
  assert.equal(stockSaleAfter.estado, "borrador");
  console.log("OK casos 25/26: stock insuficiente (fallo normal de confirmarVenta) deja el adicional PENDIENTE_COBRO, sin commit parcial");

  // --- Casos 27/28: producto consume stock una única vez; servicio no genera consumo inventado ---
  const stockBefore = (await adminDb.doc(`negocios/${businessId}/inventario/${product}`).get()).data().stock;
  const movementQuery = await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("ventaId", "==", multiSaleId).get();
  assert.equal(movementQuery.size, 1, "caso 27: exactamente un movimiento de inventario para la línea producto-adicional");
  assert.equal(movementQuery.docs[0].data().itemId, product);
  assert.equal(movementQuery.docs[0].data().cantidad, storedProductLine.cantidad);
  const serviceMovementQuery = await adminDb.collection(`negocios/${businessId}/movimientosInventario`).where("itemId", "==", service).get();
  assert.equal(serviceMovementQuery.size, 0, "caso 28: un adicional de servicio jamás genera un movimiento de inventario");
  console.log(`OK casos 27/28: producto consume stock exactamente una vez (stock actual ${stockBefore}); servicio no genera ningún movimiento`);

  // --- Caso 29: Margen V1 sigue leyendo exactamente el mismo contrato (tipoItem/efectosInventario) para la línea producto-adicional ---
  const multiSaleStored = (await adminDb.doc(`negocios/${businessId}/ventas/${multiSaleId}`).get()).data();
  const productEffect = multiSaleStored.efectosInventario.find((effect) => effect.lineaId === "multi-product");
  assert.ok(productEffect, "caso 29: la línea producto-adicional generó un efecto de inventario, mismo insumo que ya usa Margen V1");
  assert.ok(Number.isFinite(productEffect.costoTotal) && productEffect.costoTotal >= 0, "costoTotal congelado disponible, igual que cualquier línea de producto");
  console.log("OK caso 29: Margen Comercial V1 sigue operando sobre el mismo contrato (tipoItem/efectosInventario), sin cambios de fórmula");

  // --- Casos 30/31: workBalance no suma el adicional directamente; el ingreso proviene exclusivamente de la Venta confirmada ---
  const balanceBeforeExtra = await callable(owner, "obtenerBalanceTrabajo")({businessId, trabajoId: workId});
  const extraAdditional = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-balance-check"), adicional: {itemId: service, cantidad: 1, precioUnitario: 77777}})).data;
  const balanceAfterCreatingPending = await callable(owner, "obtenerBalanceTrabajo")({businessId, trabajoId: workId});
  assert.deepEqual({...balanceAfterCreatingPending.data, calculadoEn: null}, {...balanceBeforeExtra.data, calculadoEn: null}, "un adicional recién creado (PENDIENTE_COBRO) no debe alterar el balance en absoluto");
  const balanceSale = await crearVenta({businessId, requestId: requestId("balance-create"), venta: salePayload(clientId, [line(service, "balance-1", {cantidad: 1, precioUnitario: 77777, origenAdicionalId: extraAdditional.adicionalId})], {trabajoId: workId})});
  await confirmarVenta({businessId, ventaId: balanceSale.data.venta.id, requestId: requestId("balance-confirm")});
  const balanceAfterConfirm = await callable(owner, "obtenerBalanceTrabajo")({businessId, trabajoId: workId});
  const expectedDelta = balanceSale.data.venta.total ?? 77777 * 1.19;
  const actualDelta = Number(balanceAfterConfirm.data.valorComercial || 0) - Number(balanceBeforeExtra.data.valorComercial || 0);
  assert.ok(Math.abs(actualDelta - Number(balanceSale.data.venta.total)) < 1 || actualDelta === Number(balanceSale.data.venta.total), `caso 30/31: el balance sólo debe subir por el total real de la Venta confirmada (esperado ${balanceSale.data.venta.total}, delta real ${actualDelta}), nunca sumando el adicional aparte`);
  console.log(`OK casos 30/31: crear un adicional pendiente no altera workBalance; confirmar la venta lo mueve exactamente por el total de la Venta (delta=${actualDelta}), sin suma paralela del adicional`);

  // --- Caso 32: no existe update directo del cliente a INCORPORADO_A_VENTA ---
  await expectCallableError("cliente intenta marcar INCORPORADO_A_VENTA directamente", () => updateDoc(doc(owner.db, `negocios/${businessId}/trabajos/${workId}/adicionales/${additionalService.adicionalId}`), {estado: "INCORPORADO_A_VENTA"}), ["permission-denied"]);
  console.log("OK caso 32: firestore.rules sigue sin permitir ningún update directo del cliente sobre un adicional (create/update/delete: if false, sin cambios en ETAPA 5)");

  // --- Caso 33: múltiples adicionales se cierran todos o ninguno (variante negativa: uno inválido invalida toda la venta) ---
  const allOrNothingValid = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-aon-valid"), adicional: {itemId: product, cantidad: 1, precioUnitario: 15000}})).data;
  const allOrNothingAnnulled = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-aon-annulled"), adicional: {itemId: service, cantidad: 1, precioUnitario: 9000}})).data;
  await anularAdicional({businessId, trabajoId: workId, adicionalId: allOrNothingAnnulled.adicionalId, motivo: "Para probar todo-o-nada", requestId: requestId("annul-aon")});
  const allOrNothingSale = await crearVenta({businessId, requestId: requestId("aon-create"), venta: salePayload(clientId, [
    line(product, "aon-valid", {cantidad: 1, precioUnitario: 15000, origenAdicionalId: allOrNothingValid.adicionalId}),
    line(service, "aon-invalid", {cantidad: 1, precioUnitario: 9000, origenAdicionalId: allOrNothingAnnulled.adicionalId}),
  ], {trabajoId: workId})});
  await expectCallableError("uno de varios adicionales inválido rechaza toda la venta", () => confirmarVenta({businessId, ventaId: allOrNothingSale.data.venta.id, requestId: requestId("aon-confirm")}), ["failed-precondition"]);
  const allOrNothingValidAfter = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${allOrNothingValid.adicionalId}`).get()).data();
  assert.equal(allOrNothingValidAfter.estado, "PENDIENTE_COBRO", "caso 33: el adicional válido tampoco se cierra si otro de la misma venta falla (todo o nada)");
  console.log("OK caso 33: varios adicionales en la misma venta se cierran todos o ninguno — uno inválido revierte la venta completa");

  // --- Caso 34: additionalId duplicado en la misma venta -> rechazado ---
  const duplicateAdditional = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-duplicate"), adicional: {itemId: product, cantidad: 1, precioUnitario: 15000}})).data;
  const duplicateSale = await crearVenta({businessId, requestId: requestId("duplicate-create"), venta: salePayload(clientId, [
    line(product, "duplicate-1", {cantidad: 1, precioUnitario: 15000, origenAdicionalId: duplicateAdditional.adicionalId}),
    line(product, "duplicate-2", {cantidad: 1, precioUnitario: 15000, origenAdicionalId: duplicateAdditional.adicionalId}),
  ], {trabajoId: workId})});
  await expectCallableError("el mismo adicional referenciado en dos líneas de la misma venta", () => confirmarVenta({businessId, ventaId: duplicateSale.data.venta.id, requestId: requestId("duplicate-confirm")}), ["invalid-argument"]);
  console.log("OK caso 34: un mismo adicional referenciado dos veces en la misma venta se rechaza");

  // --- Caso 9 (revisitado a nivel backend): trabajoId es inmutable vía actualizarVentaBorrador — no hay forma de "cambiar de Proyecto" un borrador existente ---
  const secondProject = await callable(owner, "crearTrabajo")({businessId, requestId: requestId("work-second"), trabajo: {titulo: "Segundo proyecto", descripcion: "", clienteId: "", responsableUid: "", participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""}});
  const immutableSale = await crearVenta({businessId, requestId: requestId("immutable-create"), venta: salePayload(clientId, [line(product, "immutable-1", {cantidad: 1})], {trabajoId: workId})});
  await actualizarVentaBorrador({businessId, ventaId: immutableSale.data.venta.id, venta: salePayload(clientId, [line(product, "immutable-1", {cantidad: 1})], {trabajoId: secondProject.data.trabajoId})});
  const immutableSaleAfter = (await adminDb.doc(`negocios/${businessId}/ventas/${immutableSale.data.venta.id}`).get()).data();
  assert.equal(immutableSaleAfter.trabajoId, workId, "caso 9: trabajoId es inmutable tras crearVenta; un intento de reenviar otro Proyecto vía actualizarVentaBorrador se ignora, evitando referencias cruzadas");
  console.log("OK caso 9: trabajoId no puede cambiarse vía actualizarVentaBorrador (protección estructural, no hay forma de referenciar otro Proyecto)");

  // --- Caso 8: deseleccionar antes de confirmar — el adicional deseleccionado no se cierra ---
  const deselectAdditionalA = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-deselect-a"), adicional: {itemId: product, cantidad: 1, precioUnitario: 15000}})).data;
  const deselectAdditionalB = (await crearAdicional({businessId, trabajoId: workId, requestId: requestId("add-deselect-b"), adicional: {itemId: service, cantidad: 1, precioUnitario: 9000}})).data;
  const deselectSale = await crearVenta({businessId, requestId: requestId("deselect-create"), venta: salePayload(clientId, [
    line(product, "deselect-a", {cantidad: 1, precioUnitario: 15000, origenAdicionalId: deselectAdditionalA.adicionalId}),
    line(service, "deselect-b", {cantidad: 1, precioUnitario: 9000, origenAdicionalId: deselectAdditionalB.adicionalId}),
  ], {trabajoId: workId})});
  await actualizarVentaBorrador({businessId, ventaId: deselectSale.data.venta.id, venta: salePayload(clientId, [line(product, "deselect-a", {cantidad: 1, precioUnitario: 15000, origenAdicionalId: deselectAdditionalA.adicionalId})], {trabajoId: workId})});
  await confirmarVenta({businessId, ventaId: deselectSale.data.venta.id, requestId: requestId("deselect-confirm")});
  const deselectAAfter = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${deselectAdditionalA.adicionalId}`).get()).data();
  const deselectBAfter = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${deselectAdditionalB.adicionalId}`).get()).data();
  assert.equal(deselectAAfter.estado, "INCORPORADO_A_VENTA", "el adicional que permaneció en el borrador sí se cierra");
  assert.equal(deselectBAfter.estado, "PENDIENTE_COBRO", "caso 8: el adicional quitado del borrador antes de confirmar nunca se cierra");
  console.log("OK caso 8: deseleccionar un adicional (quitar su línea) antes de confirmar lo deja fuera del cierre");

  // --- Auditoría SPEC 020 §15: anulación posterior de una Venta con adicionales incorporados ---
  // cancelarVentaBorrador/cancelarVenta (mismo handler, dos alias) sólo
  // permite cancelar una venta CONFIRMADA cuando proviene de una Cotización
  // (existing.estado === "confirmada" && existing.cotizacionId). Los
  // adicionales nunca tienen vínculo con Cotizaciones (SPEC 020 §6.2): por
  // lo tanto, una venta directa que incorporó adicionales (como
  // `multiSaleId`, ya confirmada) NUNCA es cancelable por este flujo. No
  // existe ningún camino alcanzable donde haya que decidir si un adicional
  // vuelve a PENDIENTE_COBRO tras anular su Venta: se verifica aquí que ese
  // escenario es estructuralmente irreproducible con el contrato actual, en
  // vez de asumir o inventar una semántica de reversa no definida por SPEC.
  await expectCallableError(
    "cancelar una venta directa ya confirmada (con adicionales incorporados) no está permitido por el contrato existente",
    () => callable(owner, "cancelarVenta")({businessId, ventaId: multiSaleId, motivo: "Intento de auditoría SPEC 020 §15", requestId: requestId("cancel-confirmed-direct")}),
    ["failed-precondition"],
  );
  const multiSaleAfterCancelAttempt = (await adminDb.doc(`negocios/${businessId}/ventas/${multiSaleId}`).get()).data();
  assert.equal(multiSaleAfterCancelAttempt.estado, "confirmada", "la venta sigue confirmada: el intento de cancelación fue rechazado por el contrato ya existente, no por lógica nueva de ETAPA 5");
  const additionalProductStillIncorporated = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${additionalProduct.adicionalId}`).get()).data();
  assert.equal(additionalProductStillIncorporated.estado, "INCORPORADO_A_VENTA", "sin ningún camino de reversa: el adicional permanece incorporado, tal como corresponde a una Venta que sigue confirmada");
  console.log("OK auditoría §15: una Venta directa (con adicionales) ya confirmada no es cancelable por el flujo existente; no hay ninguna reversa que decidir ni inventar en ETAPA 5");

  console.log("SALE_ADDITIONAL_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
