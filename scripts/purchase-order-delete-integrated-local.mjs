// Eliminación permanente de órdenes de compra (callable eliminarOrdenCompra) contra
// los emuladores de Auth, Firestore y Functions. Nunca usa producción.
// SPEC 005, enmienda 2026-11-06: solo borradores y canceladas nunca enviadas.
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
    appId: `po-delete-${name}-${RUN_ID}`,
  }, `po-delete-${name}-${RUN_ID}`);
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
    `po-delete-${label}-${RUN_ID}@example.test`,
    `PoDelete-${RUN_ID}-Pass!`
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
    assert.ok(
      expected.some((item) => code.includes(item)),
      `${label}: código inesperado ${code} (${error?.message})`
    );
    if (messagePattern) assert.match(String(error?.message || ""), messagePattern, label);
    console.log(`OK rechazo: ${label}`);
    return error;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

const owner = await authenticate(createClient("owner"), "owner");
const admin = await authenticate(createClient("admin"), "admin");
const compras = await authenticate(createClient("compras"), "compras");
const member = await authenticate(createClient("member"), "member");
const outsider = await authenticate(createClient("outsider"), "outsider");
const clients = [owner, admin, compras, member, outsider];
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `po-delete-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

try {
  const businessId = (await call(owner, "createFirstBusiness")({
    nombreComercial: "Negocio eliminar órdenes",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-main-${RUN_ID}`,
  })).data.business.id;
  const otherBusinessId = (await call(outsider, "createFirstBusiness")({
    nombreComercial: "Negocio eliminar órdenes externo",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-other-${RUN_ID}`,
  })).data.business.id;

  const fiscal = {identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.300.300-3"};
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
      nombreComercial: "Empresa eliminar órdenes",
      razonSocial: "Empresa Eliminar Órdenes SpA",
      ...fiscal,
    }, {merge: true}),
    ...[[admin, "ADMIN"], [compras, "COMPRAS"], [member, "MEMBER"]].map(([client, rol]) =>
      adminDb.doc(`membresias/${businessId}__${client.uid}`).set({
        negocioId: businessId, uid: client.uid, rol, estado: "activo",
      })
    ),
  ]);
  const providerId = `provider-${RUN_ID}`;
  const itemId = `item-${RUN_ID}`;
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/proveedores/${providerId}`).set({
      proveedorId: providerId,
      negocioId: businessId,
      estado: "activo",
      rut: "12.345.678-5",
      razonSocial: "Proveedor Órdenes SpA",
      email: "proveedor@example.test",
    }),
    adminDb.doc(`negocios/${businessId}/inventario/${itemId}`).set({
      negocioId: businessId,
      estado: "activo",
      codigoInterno: "PR-0001",
      nombre: "Producto de prueba",
      tipoItem: "producto",
      unidad: "unidad",
      costoBase: 8500,
    }),
  ]);

  const orderPayload = () => ({
    proveedorId: providerId,
    fechaEntregaEstimada: "2026-09-10",
    direccionEntrega: "Bodega central 123",
    condicionesPago: "30 días",
    observaciones: "Orden de prueba de eliminación",
    items: [{lineaId: "linea-principal", itemId, cantidad: 2, costoUnitario: 10000, descuentoPct: 0}],
  });
  const orderPath = (id) => `negocios/${businessId}/ordenesCompra/${id}`;
  const attemptPath = (id) => `negocios/${businessId}/purchaseOrderEmailAttempts/${id}`;
  const exists = async (path) => (await adminDb.doc(path).get()).exists;
  const yearOf = (numero) => numero.split("-")[1];
  const counterNumber = async (year) =>
    (await adminDb.doc(`negocios/${businessId}/purchaseOrderCounters/${year}`).get()).data()?.lastNumber;
  const createRequestsFor = async (id) =>
    (await adminDb.collection(`negocios/${businessId}/purchaseOrderCreateRequests`).where("ordenCompraId", "==", id).get()).size;
  const duplicateRequestsFor = async (id) =>
    (await adminDb.collection(`negocios/${businessId}/purchaseOrderDuplicateRequests`).where("ordenCompraId", "==", id).get()).size;

  let sequence = 0;
  const createOrder = async (client = owner) => {
    sequence += 1;
    const requestId = `create-${RUN_ID}-${sequence}`;
    const response = await call(client, "crearOrdenCompra")({businessId, requestId, ordenCompra: orderPayload()});
    const order = response.data.ordenCompra;
    return {id: order.id, numero: order.numero, correlativo: order.correlativo, requestId};
  };
  const remove = (client, ordenCompraId, confirmacion = WORD, targetBusiness = businessId) =>
    call(client, "eliminarOrdenCompra")({businessId: targetBusiness, ordenCompraId, confirmacion});
  const intact = async (order, label) => {
    assert.ok(await exists(orderPath(order.id)), `${label}: la orden debe seguir existiendo`);
    assert.equal(await createRequestsFor(order.id), 1, `${label}: su solicitud de creación debe seguir existiendo`);
  };

  // 1. OWNER elimina un borrador: se van la orden y su solicitud; el contador no se mueve y queda un hueco.
  const first = await createOrder();
  const second = await createOrder();
  const year = yearOf(first.numero);
  assert.equal(second.correlativo, first.correlativo + 1);
  assert.equal(await createRequestsFor(first.id), 1);
  const counterBefore = await counterNumber(year);
  const deletion = await remove(owner, first.id);
  assert.equal(deletion.data.success, true);
  assert.equal(deletion.data.numero, first.numero);
  assert.equal(deletion.data.solicitudesEliminadas, 1);
  assert.equal(await exists(orderPath(first.id)), false);
  assert.equal(await createRequestsFor(first.id), 0);
  assert.equal(await counterNumber(year), counterBefore, "el contador no retrocede");
  const third = await createOrder();
  assert.equal(third.correlativo, counterBefore + 1, "la siguiente orden continúa la secuencia");
  const remainingNumbers = (await adminDb.collection(`negocios/${businessId}/ordenesCompra`).get()).docs.map((entry) => entry.data().numero);
  assert.ok(!remainingNumbers.includes(first.numero), "el número eliminado no se reutiliza");
  assert.ok(remainingNumbers.includes(second.numero) && remainingNumbers.includes(third.numero), "queda un hueco en la numeración");
  console.log("OK borrado: OWNER elimina un borrador, retira su solicitud y el contador no retrocede (queda un hueco)");

  // 2. ADMIN también puede.
  const byAdmin = await createOrder(admin);
  await remove(admin, byAdmin.id);
  assert.equal(await exists(orderPath(byAdmin.id)), false);
  console.log("OK borrado: ADMIN también elimina");

  // 3. Un reintento con la misma solicitud de creación, después de borrar, no queda a medias.
  const retried = await call(owner, "crearOrdenCompra")({businessId, requestId: first.requestId, ordenCompra: orderPayload()});
  assert.equal(retried.data.idempotent, false);
  assert.notEqual(retried.data.ordenCompra.id, first.id);
  assert.equal(retried.data.ordenCompra.correlativo, third.correlativo + 1 + 1, "usa un número nuevo (el de ADMIN ya ocupó uno)");
  console.log("OK idempotencia: la solicitud de creación se retiró con la orden; no queda una solicitud incompleta");

  // 4. Un segundo borrado de la misma orden responde no encontrada.
  await expectCallableError("segundo borrado de la misma orden", () => remove(owner, first.id), ["not-found"]);

  // 5. Envío fallido o simulado: no entregó nada y no bloquea; el intento de correo se borra con la orden.
  const simulated = await createOrder();
  const mail = await call(owner, "sendPurchaseOrderEmail")({
    businessId,
    ordenCompraId: simulated.id,
    emailProveedor: "compras@proveedor.test",
    pdfBase64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
    pdfFilename: `${simulated.numero}.pdf`,
    pdfMimeType: "application/pdf",
  });
  assert.equal(mail.data.simulated, true);
  const simulatedOrder = (await adminDb.doc(orderPath(simulated.id)).get()).data();
  assert.equal(simulatedOrder.estado, "borrador");
  assert.equal(simulatedOrder.estadoEnvioCorreo, "simulado");
  assert.equal((await adminDb.doc(attemptPath(simulated.id)).get()).data().estado, "simulado");
  const simulatedDeletion = await remove(owner, simulated.id);
  assert.equal(simulatedDeletion.data.intentoCorreoEliminado, true);
  assert.equal(await exists(orderPath(simulated.id)), false);
  assert.equal(await exists(attemptPath(simulated.id)), false);

  const failed = await createOrder();
  await adminDb.doc(orderPath(failed.id)).update({estadoEnvioCorreo: "error", enviadoPorCorreo: false, fechaEnvioCorreo: new Date(), ultimoErrorEnvio: "fallo"});
  await adminDb.doc(attemptPath(failed.id)).set({negocioId: businessId, ordenCompraId: failed.id, estado: "error", leaseUntilMs: 0, nextAllowedAtMs: 0});
  await remove(owner, failed.id);
  assert.equal(await exists(orderPath(failed.id)), false);
  assert.equal(await exists(attemptPath(failed.id)), false);
  console.log("OK correo: un envío simulado o fallido no bloquea y su intento se borra con la orden");

  // 6. Cancelada que nunca se emitió: se elimina.
  const cancelledClean = await createOrder();
  await call(owner, "cancelarOrdenCompra")({businessId, ordenCompraId: cancelledClean.id});
  assert.equal((await adminDb.doc(orderPath(cancelledClean.id)).get()).data().estado, "cancelada");
  await remove(admin, cancelledClean.id);
  assert.equal(await exists(orderPath(cancelledClean.id)), false);
  console.log("OK alcance B: una cancelada que nunca se emitió se elimina");

  // 7. Emitida, o cancelada después de emitirse: nunca se elimina.
  const emitted = await createOrder();
  await call(owner, "emitirOrdenCompra")({businessId, ordenCompraId: emitted.id, canalEmision: "manual"});
  await expectCallableError("orden emitida", () => remove(owner, emitted.id), ["failed-precondition"], /ya fue emitida/);
  await intact(emitted, "emitida");
  await call(owner, "cancelarOrdenCompra")({businessId, ordenCompraId: emitted.id});
  assert.equal((await adminDb.doc(orderPath(emitted.id)).get()).data().estado, "cancelada");
  await expectCallableError("cancelada después de emitirse", () => remove(owner, emitted.id), ["failed-precondition"], /ya se envió/);
  await intact(emitted, "cancelada tras emitirse");
  console.log("OK alcance B: una orden emitida alguna vez no se elimina, aunque esté cancelada");

  // 8. Cada rastro de emisión bloquea un borrador.
  const traceCases = [
    ["emitidaEn", {emitidaEn: new Date()}],
    ["emitidaPorUid", {emitidaPorUid: owner.uid}],
    ["canalEmision", {canalEmision: "correo"}],
    ["destinatarioEmision", {destinatarioEmision: "compras@proveedor.test"}],
    ["cantidadEnvios", {cantidadEnvios: 1}],
    ["ultimoEnvioEn", {ultimoEnvioEn: new Date()}],
    ["reenviadaEn", {reenviadaEn: new Date()}],
    ["respuesta del proveedor con fecha", {respuestaProveedor: {estado: "pendiente", fecha: new Date()}}],
    ["respuesta del proveedor confirmada", {respuestaProveedor: {estado: "confirmada"}}],
    ["enviadoPorCorreo", {enviadoPorCorreo: true}],
    ["estadoEnvioCorreo enviado", {estadoEnvioCorreo: "enviado"}],
  ];
  for (const [label, patch] of traceCases) {
    const target = await createOrder();
    await adminDb.doc(orderPath(target.id)).update(patch);
    await expectCallableError(`rastro de emisión: ${label}`, () => remove(owner, target.id), ["failed-precondition"], /ya se envió/);
    await intact(target, label);
  }
  console.log("OK alcance B: cada rastro de emisión bloquea la eliminación");

  // 9. Envío por correo en curso o ya realizado (intento de correo).
  const inFlight = await createOrder();
  await adminDb.doc(attemptPath(inFlight.id)).set({negocioId: businessId, ordenCompraId: inFlight.id, estado: "enviando", leaseUntilMs: Date.now() + 60000, nextAllowedAtMs: Date.now() + 60000});
  await expectCallableError("envío por correo en curso", () => remove(owner, inFlight.id), ["failed-precondition"], /envío por correo en curso/);
  await intact(inFlight, "enviando");
  const stuck = await createOrder();
  await adminDb.doc(orderPath(stuck.id)).update({estadoEnvioCorreo: "enviando"});
  await expectCallableError("orden marcada como enviando", () => remove(owner, stuck.id), ["failed-precondition"], /envío por correo en curso/);
  const sentAttempt = await createOrder();
  await adminDb.doc(attemptPath(sentAttempt.id)).set({negocioId: businessId, ordenCompraId: sentAttempt.id, estado: "enviado", leaseUntilMs: 0, nextAllowedAtMs: 0});
  await expectCallableError("intento de correo enviado", () => remove(owner, sentAttempt.id), ["failed-precondition"], /ya se envió/);
  assert.ok(await exists(attemptPath(sentAttempt.id)), "el intento sigue existiendo");
  console.log("OK correo: un intento enviando o enviado bloquea");

  // 10. Dependencias: cada tipo bloquea con su cantidad y, al quitarlo, el borrado procede.
  const dependencyCases = [
    {label: "recepción en borrador", seed: (id) => [[`recepciones/rec-borrador-${id}`, {negocioId: businessId, ordenCompraId: id, estado: "borrador"}]], message: /1 recepción\b/},
    {label: "recepción confirmada", seed: (id) => [[`recepciones/rec-confirmada-${id}`, {negocioId: businessId, ordenCompraId: id, estado: "confirmada"}]], message: /1 recepción\b/},
    {label: "recepción cancelada", seed: (id) => [[`recepciones/rec-cancelada-${id}`, {negocioId: businessId, ordenCompraId: id, estado: "cancelada"}]], message: /1 recepción\b/},
    {label: "varias recepciones", seed: (id) => [
      [`recepciones/rec-a-${id}`, {negocioId: businessId, ordenCompraId: id}],
      [`recepciones/rec-b-${id}`, {negocioId: businessId, ordenCompraId: id}],
    ], message: /2 recepciones/},
    {label: "compra", seed: (id) => [[`compras/compra-${id}`, {negocioId: businessId, ordenCompraId: id, estado: "borrador"}]], message: /1 compra\b/},
    {label: "adquisición de inventario", seed: (id) => [[`adquisicionesInventario/adq-${id}`, {negocioId: businessId, ordenCompraId: id}]], message: /1 adquisición de inventario/},
    {label: "movimiento de inventario", seed: (id) => [[`movimientosInventario/mov-${id}`, {negocioId: businessId, ordenCompraId: id}]], message: /1 movimiento de inventario/},
    {label: "solicitud de recepción", seed: (id) => [[`receptionCreateRequests/req-${id}`, {negocioId: businessId, ordenCompraId: id}]], message: /1 solicitud de recepción/},
    {label: "solicitud de conversión a compra", seed: (id) => [[`purchaseOrderConversionRequests/conv-${id}`, {negocioId: businessId, ordenCompraId: id}]], message: /1 solicitud de conversión a compra/},
    {label: "otra orden creada a partir de esta", seed: (id) => [[`purchaseOrderDuplicateRequests/dup-${id}`, {negocioId: businessId, ordenCompraId: `otra-${id}`, ordenCompraOrigenId: id}]], message: /1 orden creada a partir de esta/},
    {label: "compraId en la orden", order: {compraId: "compra-x", compraNumero: "COM-X"}, message: /1 vínculo con recepciones o compras/},
    {label: "comprasDesdeRecepciones en la orden", order: {comprasDesdeRecepciones: [{compraId: "compra-x", recepcionId: "rec-x"}]}, message: /1 vínculo con recepciones o compras/},
    {label: "estadoRecepcion en la orden", order: {estadoRecepcion: "recibida_parcial"}, message: /1 vínculo con recepciones o compras/},
    {label: "recepcionResumen en la orden", order: {recepcionResumen: {estado: "recibida_parcial", lineasCompletas: 0, lineasTotales: 1}}, message: /1 vínculo con recepciones o compras/},
    {label: "varios tipos a la vez", seed: (id) => [
      [`recepciones/rec-multi-${id}`, {negocioId: businessId, ordenCompraId: id}],
      [`compras/compra-multi-${id}`, {negocioId: businessId, ordenCompraId: id}],
    ], message: /1 recepción, 1 compra\./},
  ];
  for (const [index, scenario] of dependencyCases.entries()) {
    const target = await createOrder();
    const seeded = (scenario.seed ? scenario.seed(target.id) : []);
    await Promise.all(seeded.map(([path, data]) => adminDb.doc(`negocios/${businessId}/${path}`).set(data)));
    if (scenario.order) await adminDb.doc(orderPath(target.id)).update(scenario.order);
    const error = await expectCallableError(
      `con ${scenario.label}`,
      () => remove(index % 2 === 0 ? owner : admin, target.id),
      ["failed-precondition"],
      scenario.message
    );
    assert.match(String(error.message), /cancélala/);
    assert.ok(Array.isArray(error.details?.dependencias) && error.details.dependencias.length >= 1, "el rechazo informa las dependencias");
    await intact(target, scenario.label);
    await Promise.all(seeded.map(([path]) => adminDb.doc(`negocios/${businessId}/${path}`).delete()));
    if (scenario.order) {
      await adminDb.doc(orderPath(target.id)).update(Object.fromEntries(Object.keys(scenario.order).map((key) => [key, null])));
    }
    await remove(owner, target.id);
    assert.equal(await exists(orderPath(target.id)), false);
  }
  // Cancelada nunca enviada pero con una recepción en borrador: bloquea.
  const cancelledWithReception = await createOrder();
  await call(owner, "cancelarOrdenCompra")({businessId, ordenCompraId: cancelledWithReception.id});
  await adminDb.doc(`negocios/${businessId}/recepciones/rec-cancelada-oc-${RUN_ID}`).set({negocioId: businessId, ordenCompraId: cancelledWithReception.id, estado: "borrador"});
  await expectCallableError("cancelada con una recepción en borrador", () => remove(owner, cancelledWithReception.id), ["failed-precondition"], /1 recepción\b/);
  await adminDb.doc(`negocios/${businessId}/recepciones/rec-cancelada-oc-${RUN_ID}`).delete();
  await remove(owner, cancelledWithReception.id);
  console.log("OK dependencias: cada tipo bloquea con su cantidad y, al quitarlo, el borrado procede");

  // 11. Copias reales: una orden con copias no se elimina; la copia sí, y retira su solicitud de duplicación.
  const origin = await createOrder();
  await call(owner, "cancelarOrdenCompra")({businessId, ordenCompraId: origin.id});
  const duplicated = await call(owner, "duplicarOrdenCompraComoBorrador")({businessId, sourceId: origin.id, requestId: `dup-${RUN_ID}-1`});
  const copyId = duplicated.data.ordenCompra.id;
  assert.equal(duplicated.data.ordenCompra.ordenCompraOrigenId, origin.id);
  assert.equal(await duplicateRequestsFor(copyId), 1);
  await expectCallableError("orden con una copia", () => remove(owner, origin.id), ["failed-precondition"], /1 orden creada a partir de esta/);
  assert.ok(await exists(orderPath(origin.id)));
  const copyDeletion = await remove(owner, copyId);
  assert.equal(copyDeletion.data.solicitudesEliminadas, 1);
  assert.equal(await exists(orderPath(copyId)), false);
  assert.equal(await duplicateRequestsFor(copyId), 0);
  await remove(owner, origin.id);
  assert.equal(await exists(orderPath(origin.id)), false);
  console.log("OK copias: la copia se elimina con su solicitud y recién entonces se puede eliminar el origen");

  // 12. Seguridad: rol, palabra, ids, negocio ajeno y SDK cliente. Nada se borra.
  const guarded = await createOrder();
  await expectCallableError("COMPRAS no puede eliminar", () => remove(compras, guarded.id), ["permission-denied"]);
  await expectCallableError("MEMBER no puede eliminar", () => remove(member, guarded.id), ["permission-denied"]);
  await expectCallableError("usuario de otro negocio no puede eliminar", () => remove(outsider, guarded.id), ["permission-denied"]);
  await expectCallableError("sin palabra de confirmación", () => remove(owner, guarded.id, ""), ["invalid-argument"], /permanente/);
  await expectCallableError("palabra de confirmación incorrecta", () => remove(owner, guarded.id, "borrar"), ["invalid-argument"], /permanente/);
  await expectCallableError("id de orden inválido", () => remove(owner, "../x"), ["invalid-argument"]);
  await expectCallableError("orden inexistente", () => remove(owner, `no-existe-${RUN_ID}`), ["not-found"]);
  await expectCallableError(
    "el dueño de otro negocio no alcanza una orden ajena",
    () => remove(outsider, guarded.id, WORD, otherBusinessId),
    ["not-found"]
  );
  await intact(guarded, "tras rechazos");
  await expectCallableError("eliminación directa con el SDK cliente", () => deleteDoc(doc(owner.db, orderPath(guarded.id))), ["permission-denied"]);
  await intact(guarded, "tras rechazos de rol y SDK");
  const lowerCase = await remove(owner, guarded.id, "  PERMANENTE ");
  assert.equal(lowerCase.data.success, true, "la palabra no distingue mayúsculas ni espacios");
  console.log("OK seguridad: rol, palabra de confirmación, ids, negocio ajeno y SDK cliente no borran nada");

  // 13. Multiempresa: documentos de otro negocio con el mismo id no bloquean ni se tocan.
  const isolated = await createOrder();
  await Promise.all([
    adminDb.doc(`negocios/${otherBusinessId}/recepciones/rec-ajena-${RUN_ID}`).set({negocioId: otherBusinessId, ordenCompraId: isolated.id}),
    adminDb.doc(`negocios/${otherBusinessId}/compras/compra-ajena-${RUN_ID}`).set({negocioId: otherBusinessId, ordenCompraId: isolated.id}),
    adminDb.doc(`negocios/${otherBusinessId}/ordenesCompra/${isolated.id}`).set({negocioId: otherBusinessId, estado: "borrador", numero: "OC-AJENA"}),
  ]);
  await remove(owner, isolated.id);
  assert.equal(await exists(orderPath(isolated.id)), false);
  assert.ok(await exists(`negocios/${otherBusinessId}/ordenesCompra/${isolated.id}`), "la orden de otro negocio no se toca");
  assert.ok(await exists(`negocios/${otherBusinessId}/recepciones/rec-ajena-${RUN_ID}`));
  console.log("OK multiempresa: documentos de otro negocio no bloquean ni se tocan");

  // 14. Carrera: emitir una orden mientras se elimina. Exactamente una operación gana
  // y nunca queda una orden emitida que fue eliminada ni una eliminada que se emitió.
  const ROUNDS = 8;
  const outcomes = {emisiónGanó: 0, borradoGanó: 0};
  for (let round = 0; round < ROUNDS; round += 1) {
    const target = await createOrder();
    const delay = [0, 0, 15, 40, 80][round % 5];
    const emitCall = () => call(owner, "emitirOrdenCompra")({businessId, ordenCompraId: target.id, canalEmision: "manual"});
    const deleteCall = () => remove(round % 2 === 0 ? admin : owner, target.id);
    const [emitResult, deleteResult] = await Promise.allSettled(
      round % 2 === 0
        ? [emitCall(), new Promise((resolve) => setTimeout(resolve, delay)).then(deleteCall)]
        : [new Promise((resolve) => setTimeout(resolve, delay)).then(emitCall), deleteCall()]
    );
    const stored = await adminDb.doc(orderPath(target.id)).get();
    if (deleteResult.status === "fulfilled") {
      assert.equal(emitResult.status, "rejected", `ronda ${round}: se eliminó la orden y aun así se emitió`);
      assert.equal(stored.exists, false, `ronda ${round}: la orden eliminada sigue existiendo`);
      assert.match(String(emitResult.reason?.code || ""), /not-found/);
      outcomes.borradoGanó += 1;
    } else {
      assert.equal(emitResult.status, "fulfilled", `ronda ${round}: ni se emitió ni se eliminó`);
      assert.match(String(deleteResult.reason?.code || ""), /failed-precondition/);
      assert.equal(stored.data().estado, "emitida", `ronda ${round}: la orden debía quedar emitida`);
      outcomes.emisiónGanó += 1;
    }
  }
  console.log(`OK carrera: ${ROUNDS} rondas sin órdenes emitidas y eliminadas a la vez (emisión ganó ${outcomes.emisiónGanó}, borrado ganó ${outcomes.borradoGanó})`);

  console.log("PURCHASE_ORDER_DELETE_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
