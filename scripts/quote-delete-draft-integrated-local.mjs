// Eliminación de cotizaciones en borrador (callable deleteQuoteDraft) contra
// emuladores: borra un borrador limpio y rechaza todo lo que ya no lo es.
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
import {buildClientMutationPayload} from "../src/domain/clientModel.mjs";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function createClientApp(name) {
  const app = initializeApp(
    {
      apiKey: "demo-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      appId: `quote-delete-${name}-${RUN_ID}`,
    },
    `quote-delete-${name}-${RUN_ID}`
  );
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
    `quote-delete-${label}-${RUN_ID}@example.test`,
    `QuoteDelete-${RUN_ID}-Pass!`
  );
  client.uid = credential.user.uid;
  return client;
}

const callable = (client, name) => httpsCallable(client.functions, name);

async function expectCallableError(label, operation, expectedCodes) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    assert.ok(
      expectedCodes.some((expected) => code.includes(expected)),
      `${label}: código inesperado ${code} (${error?.message})`
    );
    console.log(`OK rechazo: ${label}`);
    return error;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

function rutFromBody(bodyValue) {
  const body = String(bodyValue);
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const digit = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return `${body}-${digit}`;
}

function makeQuote(clienteId, overrides = {}) {
  return {
    clienteId,
    estado: "borrador",
    validezDias: 10,
    afectaIva: true,
    proyectoNombre: "Borrador a eliminar",
    empresa: {nombreComercial: "Empresa local", rut: "77.091.679-8", validezCotizacionDias: 10},
    items: [
      {
        lineaId: "linea-1",
        itemId: "inventory-1",
        codigo: "SRV-0001",
        nombre: "Servicio de fabricación",
        descripcionComercial: "Servicio de prueba.",
        tipoItem: "servicio",
        unidad: "servicio",
        cantidad: 1,
        precioSugerido: 100000,
        precioUnitarioEditable: 100000,
        descuentoPorcentaje: 0,
        inventarioSnapshot: {
          inventarioId: "inventory-1",
          codigoInterno: "SRV-0001",
          nombre: "Servicio de fabricación",
          tipoItem: "servicio",
          areaId: "area-servicios",
          categoriaId: "categoria-fabricacion",
          categoria: "Fabricación",
          unidad: "servicio",
          modeloInventarioVersion: 2,
        },
      },
    ],
    descuento: 0,
    seccionesAlcance: [{id: "servicios", titulo: "Servicios", lineas: ["Fabricación."]}],
    condiciones: {formaPago: "50% al inicio", plazoEntrega: "3 días"},
    aceptacion: {habilitada: true, texto: "Acepto."},
    ...overrides,
  };
}

const owner = await authenticate(createClientApp("owner"), "owner");
const admin = await authenticate(createClientApp("admin"), "admin");
const sales = await authenticate(createClientApp("sales"), "sales");
const member = await authenticate(createClientApp("member"), "member");
const outsider = await authenticate(createClientApp("outsider"), "outsider");
const clients = [owner, admin, sales, member, outsider];
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `quote-delete-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

const dataOf = async (path) => {
  const snapshot = await adminDb.doc(path).get();
  return snapshot.exists ? JSON.parse(JSON.stringify(snapshot.data())) : null;
};
const exists = async (path) => (await adminDb.doc(path).get()).exists;

try {
  const ownerBusiness = await callable(owner, "createFirstBusiness")({
    nombreComercial: "Empresa borrado de cotizaciones",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-owner-${RUN_ID}`,
  });
  const outsiderBusiness = await callable(outsider, "createFirstBusiness")({
    nombreComercial: "Empresa externa borrado",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-outsider-${RUN_ID}`,
  });
  const businessId = ownerBusiness.data.business.id;
  const outsiderBusinessId = outsiderBusiness.data.business.id;
  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).set({
      identificadorFiscalTipo: "RUT",
      identificadorFiscalValor: "76.100.100-1",
      verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.100.100-1"},
    }, {merge: true}),
    adminDb.doc(`negocios/${outsiderBusinessId}`).set({
      identificadorFiscalTipo: "RUT",
      identificadorFiscalValor: "76.900.900-9",
      verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.900.900-9"},
    }, {merge: true}),
    ...[[admin, "ADMIN"], [sales, "VENTAS"], [member, "MEMBER"]].map(([client, rol]) =>
      adminDb.doc(`membresias/${businessId}__${client.uid}`).set({
        negocioId: businessId,
        uid: client.uid,
        rol,
        estado: "activo",
      })
    ),
  ]);

  const clientResponse = await callable(owner, "crearCliente")({
    businessId,
    cliente: buildClientMutationPayload({
      tipoCliente: "empresa",
      rut: rutFromBody(30000001),
      nombreRazonSocial: "Cliente Borrado SpA",
      giro: "Servicios",
      email: "cliente-borrado@example.test",
      telefono: "+56 9 1234 5678",
      direccion: "Av. Principal 123",
      regionCodigo: "13",
      regionNombre: "Metropolitana de Santiago",
      comunaCodigo: "13101",
      comunaNombre: "Santiago",
      personaContacto: "Contacto",
      notas: "",
    }),
  });
  const clienteId = clientResponse.data.cliente.clienteId;

  const quotePath = (id) => `negocios/${businessId}/cotizaciones/${id}`;
  let sequence = 0;
  const createDraft = async (overrides = {}, client = owner) => {
    sequence += 1;
    const requestId = `quote-${RUN_ID}-${sequence}`;
    const response = await callable(client, "createQuoteWithNumber")({
      businessId,
      requestId,
      quote: makeQuote(clienteId, overrides),
    });
    return {id: response.data.quote.id, numero: response.data.quote.numero, requestId};
  };
  const transition = (id, estado, client = owner) =>
    callable(client, "transitionQuoteStatus")({
      businessId,
      quoteId: id,
      estado,
      requestId: `transition-${RUN_ID}-${id}-${estado}-${Math.random().toString(36).slice(2, 8)}`,
    });
  const deleteDraft = (id, confirmacion = "permanente", client = owner, targetBusiness = businessId) =>
    callable(client, "deleteQuoteDraft")({businessId: targetBusiness, quoteId: id, confirmacion});
  const counterDoc = async () => {
    const counters = await adminDb.collection(`negocios/${businessId}/contadores`).get();
    return counters.docs.filter((d) => d.id.startsWith("cotizaciones_")).map((d) => d.data().lastNumber);
  };
  const assertStillExists = async (id, label) => {
    assert.equal(await exists(quotePath(id)), true, `${label}: la cotización debe seguir existiendo`);
  };

  // ---------------------------------------------------------------
  // 1. Borra un borrador limpio (OWNER), con eventos y solicitudes.
  // ---------------------------------------------------------------
  const clean = await createDraft();
  const bystander = await createDraft({proyectoNombre: "No se debe tocar"});
  await transition(clean.id, "archivada");
  await transition(clean.id, "borrador");
  const eventsBefore = await adminDb.collection(`${quotePath(clean.id)}/eventos`).get();
  assert.ok(eventsBefore.size >= 2, "el borrador debe tener eventos de historial antes de borrarse");
  const lifecycleBefore = await adminDb.collection(`negocios/${businessId}/quoteLifecycleRequests`)
    .where("cotizacionId", "==", clean.id).get();
  assert.ok(lifecycleBefore.size >= 2);
  const createRequestBefore = await adminDb.collection(`negocios/${businessId}/quoteCreateRequests`)
    .where("quoteId", "==", clean.id).get();
  assert.equal(createRequestBefore.size, 1);
  const bystanderBefore = await dataOf(quotePath(bystander.id));
  const countersBefore = await counterDoc();

  const cleanResult = await deleteDraft(clean.id, "  PermaNente ");
  assert.equal(cleanResult.data.success, true);
  assert.equal(cleanResult.data.numero, clean.numero);
  assert.equal(await exists(quotePath(clean.id)), false);
  assert.equal((await adminDb.collection(`${quotePath(clean.id)}/eventos`).get()).size, 0);
  assert.equal((await adminDb.collection(`negocios/${businessId}/quoteLifecycleRequests`).where("cotizacionId", "==", clean.id).get()).size, 0);
  assert.equal((await adminDb.collection(`negocios/${businessId}/quoteCreateRequests`).where("quoteId", "==", clean.id).get()).size, 0);
  assert.deepEqual(await counterDoc(), countersBefore, "la numeración no retrocede (hueco aceptado)");
  assert.deepEqual(await dataOf(quotePath(bystander.id)), bystanderBefore, "otra cotización no se toca");
  console.log("OK borrado: OWNER elimina un borrador con sus eventos y solicitudes; el contador y otras cotizaciones no cambian");

  const byAdmin = await createDraft({}, admin);
  await deleteDraft(byAdmin.id, "permanente", admin);
  assert.equal(await exists(quotePath(byAdmin.id)), false);
  console.log("OK borrado: ADMIN también puede eliminar");

  // ---------------------------------------------------------------
  // 2. Copia de una cotización emitida: se borra la copia, no el origen.
  // ---------------------------------------------------------------
  const origin = await createDraft();
  await transition(origin.id, "emitida");
  const copyResponse = await callable(owner, "duplicateQuoteAsDraft")({
    businessId,
    sourceId: origin.id,
    requestId: `duplicate-${RUN_ID}`,
  });
  const copyId = copyResponse.data.quote.id;
  const originBefore = await dataOf(quotePath(origin.id));
  const originEventsBefore = (await adminDb.collection(`${quotePath(origin.id)}/eventos`).get()).size;
  assert.equal((await adminDb.collection(`negocios/${businessId}/quoteDuplicateRequests`).where("quoteId", "==", copyId).get()).size, 1);
  await deleteDraft(copyId);
  assert.equal(await exists(quotePath(copyId)), false);
  assert.equal((await adminDb.collection(`negocios/${businessId}/quoteDuplicateRequests`).where("quoteId", "==", copyId).get()).size, 0);
  assert.deepEqual(await dataOf(quotePath(origin.id)), originBefore, "la cotización original no cambia");
  assert.equal((await adminDb.collection(`${quotePath(origin.id)}/eventos`).get()).size, originEventsBefore);
  console.log("OK borrado: la copia de una cotización emitida se elimina junto con su solicitud de duplicación; el origen queda intacto");

  // ---------------------------------------------------------------
  // 3. Con proyecto: se retira el vínculo y los costos quedan intactos.
  // ---------------------------------------------------------------
  const project = await callable(owner, "crearTrabajo")({
    businessId,
    requestId: `work-${RUN_ID}`,
    trabajo: {titulo: "Proyecto con costos", descripcion: "", clienteId: "", responsableUid: "", participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""},
  });
  const workId = project.data.trabajoId;
  const workPath = `negocios/${businessId}/trabajos/${workId}`;
  const linked = await createDraft({trabajoId: workId});
  const linkedKeep = await createDraft({trabajoId: workId, proyectoNombre: "Otra del mismo proyecto"});
  const costDocs = {
    [`${workPath}/gastos/gasto-1`]: {negocioId: businessId, trabajoId: workId, estado: "vigente", monto: 25000, concepto: "Materiales"},
    [`${workPath}/horasHombre/horas-1`]: {negocioId: businessId, trabajoId: workId, estado: "vigente", horas: 6, total: 48000},
    [`${workPath}/adicionales/adicional-1`]: {negocioId: businessId, trabajoId: workId, estado: "PENDIENTE_COBRO", precioUnitario: 15000},
    [`negocios/${businessId}/movimientosInventario/salida-${RUN_ID}`]: {negocioId: businessId, trabajoId: workId, tipo: "SALIDA_PROYECTO", cantidad: 2},
  };
  await Promise.all(Object.entries(costDocs).map(([path, data]) => adminDb.doc(path).set(data)));
  const costsBefore = Object.fromEntries(await Promise.all(Object.keys(costDocs).map(async (path) => [path, await dataOf(path)])));
  const workBefore = await dataOf(workPath);
  assert.equal(workBefore.cotizacionesVinculadas, 2);
  assert.equal(await exists(`${workPath}/vinculos/cotizacion__${linked.id}`), true);

  const projectResult = await deleteDraft(linked.id);
  assert.equal(projectResult.data.vinculoProyectoRetirado, true);
  assert.equal(await exists(quotePath(linked.id)), false);
  assert.equal(await exists(`${workPath}/vinculos/cotizacion__${linked.id}`), false);
  assert.equal(await exists(`${workPath}/vinculos/cotizacion__${linkedKeep.id}`), true, "el vínculo de otra cotización se conserva");
  const workAfter = await dataOf(workPath);
  assert.equal(workAfter.cotizacionesVinculadas, 1);
  const {cotizacionesVinculadas: ignoredCount, actualizadoEn: ignoredUpdate, ...workAfterRest} = workAfter;
  const {cotizacionesVinculadas: ignoredCountBefore, actualizadoEn: ignoredUpdateBefore, ...workBeforeRest} = workBefore;
  assert.deepEqual(workAfterRest, workBeforeRest, "el proyecto solo cambia su contador de cotizaciones");
  const history = await adminDb.collection(`${workPath}/historial`).get();
  const deletedEvent = history.docs.find((d) => d.data().tipo === "cotizacion_eliminada");
  assert.ok(deletedEvent, "el historial del proyecto deja constancia");
  assert.equal(deletedEvent.data().detalle.documentoId, linked.id);
  assert.equal(deletedEvent.data().actorUid, owner.uid);
  assert.ok(history.docs.some((d) => d.id === `cotizacion_vinculada__${linked.id}`), "el evento de vinculación original se conserva");
  for (const [path, before] of Object.entries(costsBefore)) {
    assert.deepEqual(await dataOf(path), before, `costo intacto: ${path}`);
  }
  console.log("OK proyecto: se retira el vínculo, baja el contador y queda un evento; gastos, horas, adicionales e inventario no cambian");

  // ---------------------------------------------------------------
  // 4. Rechazos por estado y por datos asociados.
  // ---------------------------------------------------------------
  const emitted = await createDraft();
  await transition(emitted.id, "emitida");
  await expectCallableError("cotización emitida", () => deleteDraft(emitted.id), ["failed-precondition"]);
  await assertStillExists(emitted.id, "emitida");

  const accepted = await createDraft();
  await transition(accepted.id, "emitida");
  await transition(accepted.id, "aceptada");
  const acceptedData = await dataOf(quotePath(accepted.id));
  assert.ok(acceptedData.ventaId, "la cotización aceptada tiene venta");
  await expectCallableError("cotización aceptada (con venta)", () => deleteDraft(accepted.id), ["failed-precondition"]);
  await assertStillExists(accepted.id, "aceptada");

  const archived = await createDraft();
  await transition(archived.id, "archivada");
  await expectCallableError("borrador archivado", () => deleteDraft(archived.id), ["failed-precondition"]);

  const rejectionCases = [
    ["borrador con fechaEmision", {fechaEmision: "2026-01-01"}, null],
    ["borrador con ventaId", {ventaId: "venta-x"}, null],
    ["borrador con respuesta del cliente", {respuestaCliente: "aceptada"}, null],
    ["borrador con envío por correo registrado", {}, "envio"],
    ["borrador con estadoEnvioCorreo", {estadoEnvioCorreo: "enviado"}, null],
    ["borrador con tokenPublicoHash", {tokenPublicoHash: "a".repeat(64)}, null],
    ["borrador preparado para WhatsApp", {whatsappPreparadoEn: new Date()}, null],
    ["borrador con token público en quotePublicTokens", {}, "token"],
  ];
  for (const [label, fields, extra] of rejectionCases) {
    const draft = await createDraft();
    if (Object.keys(fields).length) await adminDb.doc(quotePath(draft.id)).set(fields, {merge: true});
    if (extra === "envio") {
      await adminDb.doc(`negocios/${businessId}/enviosCotizaciones/${draft.id}`).set({cotizacionId: draft.id, negocioId: businessId});
    }
    if (extra === "token") {
      await adminDb.doc(`quotePublicTokens/token-${RUN_ID}-${draft.id}`).set({cotizacionId: draft.id, negocioId: businessId, estado: "active"});
    }
    await expectCallableError(label, () => deleteDraft(draft.id), ["failed-precondition"]);
    await assertStillExists(draft.id, label);
  }

  // Un borrador del que parte otra cotización (solicitud de duplicación) tampoco se borra.
  const originOfOther = await createDraft();
  await adminDb.doc(`negocios/${businessId}/quoteDuplicateRequests/dup-origin-${RUN_ID}`).set({
    quoteId: "otra-cotizacion",
    cotizacionOrigenId: originOfOther.id,
    negocioId: businessId,
  });
  await expectCallableError("borrador usado como origen de otra cotización", () => deleteDraft(originOfOther.id), ["failed-precondition"]);

  // ---------------------------------------------------------------
  // 5. Confirmación, roles y otro negocio.
  // ---------------------------------------------------------------
  const guarded = await createDraft();
  for (const word of ["", "perman", "permanentemente", "eliminar", null]) {
    await expectCallableError(`palabra incorrecta (${JSON.stringify(word)})`, () => deleteDraft(guarded.id, word), ["invalid-argument"]);
  }
  await expectCallableError("rol VENTAS (puede crear cotizaciones pero no eliminarlas)", () => deleteDraft(guarded.id, "permanente", sales), ["permission-denied"]);
  await expectCallableError("rol MEMBER", () => deleteDraft(guarded.id, "permanente", member), ["permission-denied"]);
  await expectCallableError("usuario de otro negocio sobre este negocio", () => deleteDraft(guarded.id, "permanente", outsider), ["permission-denied"]);
  await expectCallableError("usuario de otro negocio con su propio negocio y el id ajeno", () => deleteDraft(guarded.id, "permanente", outsider, outsiderBusinessId), ["not-found"]);
  await expectCallableError("cotización inexistente", () => deleteDraft(`no-existe-${RUN_ID}`), ["not-found"]);
  await expectCallableError("quoteId inválido", () => deleteDraft("../otra"), ["invalid-argument"]);
  await expectCallableError("sin sesión", async () => {
    const anonymous = createClientApp("anonymous");
    clients.push(anonymous);
    await deleteDraft(guarded.id, "permanente", anonymous);
  }, ["unauthenticated"]);
  await assertStillExists(guarded.id, "tras todos los rechazos");

  // Las reglas siguen sin permitir borrar desde el cliente.
  await expectCallableError("borrado directo desde el SDK cliente (reglas)", () =>
    deleteDoc(doc(owner.db, quotePath(guarded.id))), ["permission-denied"]);
  await assertStillExists(guarded.id, "borrado directo");

  console.log("QUOTE_DELETE_DRAFT_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
