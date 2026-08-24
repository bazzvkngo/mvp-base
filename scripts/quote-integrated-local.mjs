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
      appId: `quotes-${name}-${RUN_ID}`,
    },
    `quotes-${name}-${RUN_ID}`
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
    `quotes-${label}-${RUN_ID}@example.test`,
    `Quotes-${RUN_ID}-Pass!`
  );
  client.uid = credential.user.uid;
  return client;
}

function callable(client, name) {
  return httpsCallable(client.functions, name);
}

async function expectCallableError(label, operation, expectedCodes) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    assert.ok(
      expectedCodes.some((expected) => code.includes(expected)),
      `${label}: código inesperado ${code}`
    );
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

function clientPayload({body, name, email}) {
  return buildClientMutationPayload({
    tipoCliente: "empresa",
    rut: rutFromBody(body),
    nombreRazonSocial: name,
    giro: "Ingeniería y consultoría técnica",
    email,
    telefono: "+56 9 1234 5678",
    direccion: "Av. Principal 123",
    regionCodigo: "13",
    regionNombre: "Metropolitana de Santiago",
    comunaCodigo: "13101",
    comunaNombre: "Santiago",
    personaContacto: "Contacto de prueba",
    notas: "Cliente para smoke de cotizaciones",
  });
}

function makeQuote(clienteId, index = 1, overrides = {}) {
  return {
    clienteId,
    estado: "borrador",
    validezDias: 10,
    afectaIva: true,
    cliente: {
      clienteId,
      nombreRazonSocial: "NOMBRE MANIPULADO",
      empresa: "NOMBRE MANIPULADO",
      rut: "1-9",
      email: "manipulado@example.test",
    },
    clienteNombre: "NOMBRE MANIPULADO",
    clienteRut: "1-9",
    clienteEmail: "manipulado@example.test",
    proyectoNombre: "Fabricación local",
    empresa: {
      nombreComercial: "Bagner local",
      rut: "77.091.679-8",
      responsable: "Responsable local",
      validezCotizacionDias: 10,
    },
    items: [
      {
        lineaId: `linea-${index}`,
        itemId: `inventory-${index}`,
        codigo: `SRV-${String(index).padStart(4, "0")}`,
        nombre: "Servicio de fabricación",
        descripcionComercial: "Descripción con áéíóú y ñ.",
        tipoItem: "servicio",
        unidad: "servicio",
        cantidad: 2,
        precioSugerido: 100000,
        precioUnitarioEditable: 100000,
        descuentoPorcentaje: 5,
        inventarioSnapshot: {
          inventarioId: `inventory-${index}`,
          codigoInterno: `SRV-${String(index).padStart(4, "0")}`,
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
    descuento: 10000,
    seccionesAlcance: [
      {id: "servicios", titulo: "Servicios", lineas: ["Fabricación y montaje."]},
    ],
    condiciones: {
      formaPago: "50% al inicio y 50% contra entrega",
      plazoEntrega: "3 días hábiles",
    },
    aceptacion: {habilitada: true, texto: "Acepto los términos."},
    ...overrides,
  };
}

function snapshotFields(snapshot) {
  return {
    clienteId: snapshot.clienteId,
    tipoCliente: snapshot.tipoCliente,
    rut: snapshot.rut,
    nombreRazonSocial: snapshot.nombreRazonSocial,
    giro: snapshot.giro,
    email: snapshot.email,
    telefono: snapshot.telefono,
    direccion: snapshot.direccion,
    regionCodigo: snapshot.regionCodigo,
    regionNombre: snapshot.regionNombre,
    comunaCodigo: snapshot.comunaCodigo,
    comunaNombre: snapshot.comunaNombre,
    personaContacto: snapshot.personaContacto,
  };
}

const owner = await authenticate(createClientApp("owner"), "owner");
const member = await authenticate(createClientApp("member"), "member");
const outsider = await authenticate(createClientApp("outsider"), "outsider");
const clients = [owner, member, outsider];
const adminApp = initializeAdminApp(
  {projectId: PROJECT_ID},
  `quotes-admin-${RUN_ID}`
);
const adminDb = getAdminFirestore(adminApp);

try {
  const ownerBusiness = await callable(owner, "createFirstBusiness")({
    nombreComercial: "Empresa cotizaciones local",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-owner-${RUN_ID}`,
  });
  const outsiderBusiness = await callable(outsider, "createFirstBusiness")({
    nombreComercial: "Empresa cotizaciones externa",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-outsider-${RUN_ID}`,
  });
  const businessId = ownerBusiness.data.business.id;
  const outsiderBusinessId = outsiderBusiness.data.business.id;
  const companyProfileA = {
    negocioId: businessId,
    nombreComercial: "Empresa Histórica A",
    razonSocial: "Empresa Histórica A SpA",
    identificadorFiscalTipo: "RUT",
    identificadorFiscalValor: "76.100.100-1",
    email: "empresa-a@example.test",
    direccion: "Dirección histórica 100",
  };
  await adminDb.doc(`negocios/${businessId}/empresa/perfil`).set(companyProfileA, {merge: true});
  await adminDb.doc(`membresias/${businessId}__${member.uid}`).set({
    negocioId: businessId,
    uid: member.uid,
    rol: "MEMBER",
    estado: "activo",
  });

  const primaryData = clientPayload({
    body: 30000001,
    name: "Cliente Principal SpA",
    email: "principal@example.test",
  });
  const secondaryData = clientPayload({
    body: 30000002,
    name: "Cliente Alternativo Ltda.",
    email: "alternativo@example.test",
  });
  const archivedData = clientPayload({
    body: 30000003,
    name: "Cliente Archivado SpA",
    email: "archivado@example.test",
  });
  const foreignData = clientPayload({
    body: 30000004,
    name: "Cliente Externo SpA",
    email: "externo@example.test",
  });

  const [primary, secondary, archived, foreign] = await Promise.all([
    callable(owner, "crearCliente")({businessId, cliente: primaryData}),
    callable(owner, "crearCliente")({businessId, cliente: secondaryData}),
    callable(owner, "crearCliente")({businessId, cliente: archivedData}),
    callable(outsider, "crearCliente")({
      businessId: outsiderBusinessId,
      cliente: foreignData,
    }),
  ]);
  const primaryId = primary.data.cliente.clienteId;
  const secondaryId = secondary.data.cliente.clienteId;
  const archivedId = archived.data.cliente.clienteId;
  const foreignId = foreign.data.cliente.clienteId;
  await callable(owner, "archivarCliente")({businessId, clienteId: archivedId});

  const createQuote = callable(owner, "createQuoteWithNumber");
  const updateQuoteDraft = callable(owner, "updateQuoteDraft");
  await expectCallableError(
    "cotización nueva sin cliente registrado",
    () => createQuote({
      businessId,
      requestId: `quote-${RUN_ID}-missing-client`,
      quote: makeQuote(""),
    }),
    ["invalid-argument"]
  );
  await expectCallableError(
    "cliente inexistente",
    () => createQuote({
      businessId,
      requestId: `quote-${RUN_ID}-unknown-client`,
      quote: makeQuote("cliente-inexistente"),
    }),
    ["not-found"]
  );
  await expectCallableError(
    "cliente archivado",
    () => createQuote({
      businessId,
      requestId: `quote-${RUN_ID}-archived-client`,
      quote: makeQuote(archivedId),
    }),
    ["failed-precondition"]
  );
  await expectCallableError(
    "cliente de otro negocio",
    () => createQuote({
      businessId,
      requestId: `quote-${RUN_ID}-foreign-client`,
      quote: makeQuote(foreignId),
    }),
    ["not-found"]
  );
  assert.equal(
    (await adminDb.collection(`negocios/${businessId}/cotizaciones`).get()).size,
    0
  );
  console.log("OK creación: selección obligatoria, activa y aislada por negocio");

  const project = await callable(owner, "crearTrabajo")({
    businessId,
    requestId: `work-commercial-${RUN_ID}`,
    trabajo: {titulo: "Diagnóstico y reparación", descripcion: "Expediente comercial", clienteId: primaryId, responsableUid: "", participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""},
  });
  const foreignProject = await callable(outsider, "crearTrabajo")({
    businessId: outsiderBusinessId,
    requestId: `work-foreign-${RUN_ID}`,
    trabajo: {titulo: "Proyecto externo", descripcion: "", clienteId: "", responsableUid: "", participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""},
  });
  await expectCallableError(
    "proyecto de otro negocio",
    () => createQuote({businessId, requestId: `quote-cross-work-${RUN_ID}`, quote: makeQuote(primaryId, 40, {trabajoId: foreignProject.data.trabajoId})}),
    ["not-found"]
  );
  const transitionStatus = callable(owner, "transitionQuoteStatus");
  const rejectedProjectQuote = await createQuote({businessId, requestId: `quote-work-rejected-${RUN_ID}`, quote: makeQuote(primaryId, 41, {trabajoId: project.data.trabajoId, trabajoNumero: "TRB-FALSO", trabajoTitulo: "Proyecto falso"})});
  assert.equal(rejectedProjectQuote.data.quote.trabajoNumero, project.data.numero);
  await transitionStatus({businessId, quoteId: rejectedProjectQuote.data.quote.id, estado: "emitida", requestId: `work-quote-emit-${RUN_ID}`});
  const rejectionRequestId = `work-quote-reject-${RUN_ID}`;
  await transitionStatus({businessId, quoteId: rejectedProjectQuote.data.quote.id, estado: "rechazada", requestId: rejectionRequestId});
  await transitionStatus({businessId, quoteId: rejectedProjectQuote.data.quote.id, estado: "rechazada", requestId: rejectionRequestId});
  const acceptedProjectQuote = await createQuote({businessId, requestId: `quote-work-accepted-${RUN_ID}`, quote: makeQuote(primaryId, 42, {trabajoId: project.data.trabajoId})});
  await transitionStatus({businessId, quoteId: acceptedProjectQuote.data.quote.id, estado: "emitida", requestId: `work-quote-two-emit-${RUN_ID}`});
  await transitionStatus({businessId, quoteId: acceptedProjectQuote.data.quote.id, estado: "aceptada", requestId: `work-quote-two-accept-${RUN_ID}`});
  const projectSaleRequestId = `work-sale-${RUN_ID}`;
  const projectSale = await callable(owner, "crearVentaDesdeCotizacion")({businessId, cotizacionId: acceptedProjectQuote.data.quote.id, requestId: projectSaleRequestId});
  const projectSaleRetry = await callable(owner, "crearVentaDesdeCotizacion")({businessId, cotizacionId: acceptedProjectQuote.data.quote.id, requestId: projectSaleRequestId});
  assert.equal(projectSaleRetry.data.venta.id, projectSale.data.venta.id);
  assert.equal(projectSale.data.venta.trabajoId, project.data.trabajoId);
  const workRef = adminDb.doc(`negocios/${businessId}/trabajos/${project.data.trabajoId}`);
  const workLinks = await workRef.collection("vinculos").get();
  const workEvents = await workRef.collection("historial").get();
  assert.equal(workLinks.size, 3);
  assert.equal(workEvents.docs.filter((entry) => entry.data().tipo === "cotizacion_vinculada").length, 2);
  assert.equal(workEvents.docs.filter((entry) => entry.data().tipo === "cotizacion_respuesta").length, 2);
  assert.equal(workEvents.docs.filter((entry) => entry.data().tipo === "venta_vinculada").length, 1);
  assert.equal((await workRef.get()).data().cotizacionesVinculadas, 2);
  assert.equal((await workRef.get()).data().ventasVinculadas, 1);
  console.log("OK expediente TRB/COT/VEN: múltiples propuestas, rechazo append-only, Venta e aislamiento");

  const requestId = `quote-${RUN_ID}-same`;
  const [first, retry] = await Promise.all([
    createQuote({businessId, requestId, quote: makeQuote(primaryId, 1)}),
    createQuote({businessId, requestId, quote: makeQuote(primaryId, 1)}),
  ]);
  assert.equal(first.data.quote.id, retry.data.quote.id);
  assert.equal(first.data.quote.numero, retry.data.quote.numero);

  const concurrent = await Promise.all(
    [2, 3].map((index) => createQuote({
      businessId,
      requestId: `quote-${RUN_ID}-concurrent-${index}`,
      quote: makeQuote(primaryId, index),
    }))
  );
  const numbers = [first, ...concurrent].map((result) => result.data.quote.numero);
  assert.equal(new Set(numbers).size, numbers.length);
  console.log("OK idempotencia y concurrencia: una solicitud y numeración única");

  const quoteId = first.data.quote.id;
  const quoteRef = doc(owner.db, `negocios/${businessId}/cotizaciones/${quoteId}`);
  let stored = (await getDoc(quoteRef)).data();
  assert.equal(stored.clienteId, primaryId);
  assert.equal("clientId" in stored, false);
  assert.equal(stored.empresaSnapshot.nombreComercial, companyProfileA.nombreComercial);
  assert.equal(stored.empresaSnapshot.razonSocial, companyProfileA.razonSocial);
  assert.equal(stored.empresaSnapshot.identificadorFiscalValor, companyProfileA.identificadorFiscalValor);
  assert.equal("empresa" in stored, false);
  assert.notEqual(stored.empresaSnapshot.nombreComercial, "Bagner local");
  assert.deepEqual(snapshotFields(stored.cliente), {
    clienteId: primaryId,
    tipoCliente: primaryData.tipoCliente,
    rut: primaryData.rut,
    nombreRazonSocial: primaryData.nombreRazonSocial,
    giro: primaryData.giro,
    email: primaryData.email,
    telefono: primaryData.telefono,
    direccion: primaryData.direccion,
    regionCodigo: primaryData.regionCodigo,
    regionNombre: primaryData.regionNombre,
    comunaCodigo: primaryData.comunaCodigo,
    comunaNombre: primaryData.comunaNombre,
    personaContacto: primaryData.personaContacto,
  });
  assert.notEqual(stored.cliente.nombreRazonSocial, "NOMBRE MANIPULADO");
  const historicalSnapshot = structuredClone(stored.cliente);
  const historicalCompanySnapshot = structuredClone(stored.empresaSnapshot);
  await adminDb.doc(`negocios/${businessId}/empresa/perfil`).set({
    ...companyProfileA,
    nombreComercial: "Empresa Vigente B",
    razonSocial: "Empresa Vigente B SpA",
  });
  stored = (await getDoc(quoteRef)).data();
  assert.deepEqual(stored.empresaSnapshot, historicalCompanySnapshot);
  console.log("OK snapshot: Functions ignora empresa manipulada y conserva identidad histórica");

  const changedPrimary = {...primaryData,
    nombreRazonSocial: "Cliente Principal Renombrado SpA",
    email: "nuevo@example.test",
    direccion: "Nueva dirección 456",
  };
  await callable(owner, "actualizarCliente")({
    businessId,
    clienteId: primaryId,
    cliente: changedPrimary,
  });
  stored = (await getDoc(quoteRef)).data();
  assert.deepEqual(stored.cliente, historicalSnapshot);
  assert.deepEqual(stored.empresaSnapshot, historicalCompanySnapshot);
  console.log("OK histórico: editar el cliente no cambia la cotización existente");

  await updateQuoteDraft({
    businessId,
    quoteId,
    quote: makeQuote(primaryId, 1, {
      condiciones: {formaPago: "Pago actualizado", observaciones: "Mismo cliente"},
    }),
  });
  stored = (await getDoc(quoteRef)).data();
  assert.deepEqual(stored.cliente, historicalSnapshot);
  assert.equal(stored.observaciones, "Mismo cliente");
  console.log("OK edición: mismo cliente conserva exactamente el snapshot histórico");

  await callable(owner, "archivarCliente")({businessId, clienteId: primaryId});
  await updateQuoteDraft({
    businessId,
    quoteId,
    quote: makeQuote(primaryId, 1, {
      condiciones: {formaPago: "Pago actualizado", observaciones: "Archivado conservado"},
    }),
  });
  stored = (await getDoc(quoteRef)).data();
  assert.deepEqual(stored.cliente, historicalSnapshot);
  console.log("OK archivado: el cliente original puede seguir visible y el borrador editarse");

  const adminQuoteRef = adminDb.doc(
    `negocios/${businessId}/cotizaciones/${quoteId}`
  );
  const beforeForeignChange = await adminQuoteRef.get();
  await expectCallableError(
    "cambio explícito a cliente de otro negocio",
    () => updateQuoteDraft({
      businessId,
      quoteId,
      quote: makeQuote(foreignId, 1),
    }),
    ["not-found"]
  );
  const afterForeignChange = await adminQuoteRef.get();
  assert.equal(
    afterForeignChange.updateTime.toMillis(),
    beforeForeignChange.updateTime.toMillis()
  );
  assert.deepEqual(afterForeignChange.data().cliente, beforeForeignChange.data().cliente);

  await updateQuoteDraft({
    businessId,
    quoteId,
    quote: makeQuote(secondaryId, 1, {
      condiciones: {formaPago: "Pago actualizado", observaciones: "Cliente cambiado"},
    }),
  });
  stored = (await getDoc(quoteRef)).data();
  assert.equal(stored.clienteId, secondaryId);
  assert.equal(stored.cliente.nombreRazonSocial, secondaryData.nombreRazonSocial);
  assert.equal(stored.cliente.email, secondaryData.email);
  console.log("OK edición: cambio explícito obtiene un nuevo snapshot autoritativo");

  await adminQuoteRef.update({estado: "emitida"});
  const sourceBeforeDuplicate = await adminQuoteRef.get();
  const duplicateQuote = callable(owner, "duplicateQuoteAsDraft");
  await expectCallableError(
    "borrador se edita y no se duplica",
    () => duplicateQuote({
      businessId,
      sourceId: concurrent[0].data.quote.id,
      requestId: `quote-copy-draft-${RUN_ID}`,
    }),
    ["failed-precondition"]
  );
  const duplicateRequestId = `quote-copy-${RUN_ID}-same`;
  const [duplicated, duplicatedRetry] = await Promise.all([
    duplicateQuote({
      businessId,
      sourceId: quoteId,
      requestId: duplicateRequestId,
      quote: {clienteId: archivedId, total: 1, estado: "aceptada"},
      clienteSnapshot: {nombreRazonSocial: "Snapshot falsificado"},
    }),
    duplicateQuote({businessId, sourceId: quoteId, requestId: duplicateRequestId}),
  ]);
  assert.equal(duplicated.data.quote.id, duplicatedRetry.data.quote.id);
  assert.notEqual(duplicated.data.quote.id, quoteId);
  assert.notEqual(duplicated.data.quote.numero, sourceBeforeDuplicate.data().numero);
  assert.equal(duplicated.data.quote.estado, "borrador");
  assert.equal(duplicated.data.quote.cotizacionOrigenId, quoteId);
  assert.equal(
    duplicated.data.quote.cotizacionOrigenNumero,
    sourceBeforeDuplicate.data().numero
  );
  const duplicateRef = adminDb.doc(
    `negocios/${businessId}/cotizaciones/${duplicated.data.quote.id}`
  );
  const storedDuplicate = (await duplicateRef.get()).data();
  assert.equal(storedDuplicate.clienteId, secondaryId);
  assert.equal(storedDuplicate.cliente.nombreRazonSocial, secondaryData.nombreRazonSocial);
  assert.notEqual(storedDuplicate.cliente.nombreRazonSocial, "Snapshot falsificado");
  assert.equal(storedDuplicate.empresaSnapshot.nombreComercial, "Empresa Vigente B");
  assert.notDeepEqual(storedDuplicate.empresaSnapshot, historicalCompanySnapshot);
  assert.deepEqual(storedDuplicate.items, sourceBeforeDuplicate.data().items);
  assert.equal(storedDuplicate.proyectoNombre, sourceBeforeDuplicate.data().proyectoNombre);
  assert.equal(storedDuplicate.condicionesPago, sourceBeforeDuplicate.data().condicionesPago);
  assert.equal(storedDuplicate.total, sourceBeforeDuplicate.data().total);
  const sourceAfterDuplicate = await adminQuoteRef.get();
  assert.equal(
    sourceAfterDuplicate.updateTime.toMillis(),
    sourceBeforeDuplicate.updateTime.toMillis()
  );
  assert.deepEqual(sourceAfterDuplicate.data(), sourceBeforeDuplicate.data());
  await expectDenied("request de duplicación no se lee", () => getDoc(doc(
    owner.db,
    `negocios/${businessId}/quoteDuplicateRequests/${duplicateRequestId}`
  )));
  console.log("OK duplicación: nuevo borrador y número, copia comercial e histórico intacto");

  await expectCallableError(
    "MEMBER no duplica cotizaciones",
    () => callable(member, "duplicateQuoteAsDraft")({
      businessId,
      sourceId: quoteId,
      requestId: `quote-copy-member-${RUN_ID}`,
    }),
    ["permission-denied"]
  );
  await expectCallableError(
    "cotización de otro negocio no se duplica",
    () => callable(outsider, "duplicateQuoteAsDraft")({
      businessId: outsiderBusinessId,
      sourceId: quoteId,
      requestId: `quote-copy-cross-${RUN_ID}`,
    }),
    ["not-found"]
  );
  await callable(owner, "archivarCliente")({businessId, clienteId: secondaryId});
  await expectCallableError(
    "cliente original archivado bloquea la copia",
    () => duplicateQuote({
      businessId,
      sourceId: quoteId,
      requestId: `quote-copy-archived-${RUN_ID}`,
    }),
    ["failed-precondition"]
  );
  console.log("OK duplicación segura: roles, aislamiento y cliente activo autoritativo");

  const legacyQuoteId = `legacy-${RUN_ID}`;
  const legacyRef = adminDb.doc(
    `negocios/${businessId}/cotizaciones/${legacyQuoteId}`
  );
  await legacyRef.set({
    negocioId: businessId,
    uidUsuario: owner.uid,
    numero: "COT-2025-LEGACY",
    fecha: "2025-01-10",
    estado: "borrador",
    clienteNombre: "Cliente histórico libre",
    clienteRut: "76.123.456-7",
    clienteEmail: "historico@example.test",
    items: makeQuote(primaryId, 9).items,
    empresa: makeQuote(primaryId, 9).empresa,
    afectaIva: true,
    descuento: 0,
  });
  const legacyUpdate = makeQuote(undefined, 9, {
    cliente: {
      empresa: "Cliente histórico libre",
      rut: "76.123.456-7",
      email: "historico@example.test",
    },
    clienteNombre: "Cliente histórico libre",
    clienteRut: "76.123.456-7",
    clienteEmail: "historico@example.test",
    condiciones: {formaPago: "Contado", observaciones: "Legacy editable"},
  });
  delete legacyUpdate.clienteId;
  await updateQuoteDraft({businessId, quoteId: legacyQuoteId, quote: legacyUpdate});
  const storedLegacy = (await legacyRef.get()).data();
  assert.equal(Boolean(storedLegacy.clienteId), false);
  assert.equal(storedLegacy.clienteNombre, "Cliente histórico libre");
  assert.equal(storedLegacy.observaciones, "Legacy editable");
  console.log("OK legacy: abre y guarda sin inferir ni forzar una vinculación");

  await duplicateRef.update({
    estado: "rechazada",
    respuestaCliente: "rechazada",
    respuestaClienteOrigen: "portal_publico",
    motivoRechazoCliente: "precio",
    comentarioRechazoCliente: "Respuesta histórica integrada",
    respuestaClienteEn: new Date(),
  });
  const quoteCountBeforeReopen = (
    await adminDb.collection(`negocios/${businessId}/cotizaciones`).get()
  ).size;
  const reopenRequestId = `quote-reopen-${RUN_ID}`;
  const reopened = await callable(owner, "reopenQuote")({
    businessId,
    quoteId: duplicated.data.quote.id,
    requestId: reopenRequestId,
  });
  assert.equal(reopened.data.quoteStatus.estado, "emitida");
  const repeatedReopen = await callable(owner, "reopenQuote")({
    businessId,
    quoteId: duplicated.data.quote.id,
    requestId: reopenRequestId,
  });
  assert.equal(repeatedReopen.data.quoteStatus.idempotent, true);
  const publicToken = reopened.data.quoteStatus.publicUrl.split("/").at(-1);
  await callable(owner, "respondPublicQuoteProposal")({
    token: publicToken,
    action: "accept",
  });
  const afterAcceptance = (await duplicateRef.get()).data();
  assert.equal(afterAcceptance.estado, "aceptada");
  assert.equal(afterAcceptance.respuestaOportunidadVersion, 2);
  const lifecycleEvents = await duplicateRef.collection("eventos").get();
  assert.equal(lifecycleEvents.size, 3);
  assert.equal(
    (await adminDb.collection(`negocios/${businessId}/cotizaciones`).get()).size,
    quoteCountBeforeReopen
  );

  const emailRequest = {
    businessId,
    quoteId: duplicated.data.quote.id,
    requestId: `quote-email-${RUN_ID}`,
    emailCliente: "cliente@example.test",
    asunto: "Copia de cotización integrada",
    mensaje: "Envío de copia sin cambiar el estado.",
    pdfBase64: "JVBERi0xLjQK",
    pdfFilename: "cotizacion.pdf",
    pdfMimeType: "application/pdf",
  };
  const emailResend = await callable(owner, "sendQuoteEmail")(emailRequest);
  assert.equal(emailResend.data.success, true);
  assert.equal(emailResend.data.simulated, true);
  const repeatedEmail = await callable(owner, "sendQuoteEmail")(emailRequest);
  assert.equal(repeatedEmail.data.idempotent, true);
  assert.equal((await duplicateRef.get()).data().estado, "aceptada");
  assert.equal((await duplicateRef.collection("eventos").get()).size, 4);

  const converted = await callable(owner, "crearVentaDesdeCotizacion")({
    businessId,
    cotizacionId: duplicated.data.quote.id,
    requestId: `quote-sale-${RUN_ID}`,
  });
  assert.ok(converted.data.venta.id);
  await expectCallableError(
    "cotización con Venta no se reabre",
    () => callable(owner, "reopenQuote")({
      businessId,
      quoteId: duplicated.data.quote.id,
      requestId: `quote-reopen-after-sale-${RUN_ID}`,
    }),
    ["failed-precondition"]
  );
  console.log("OK ciclo: reapertura idempotente, historial, aceptación y venta protegida");

  assert.equal(
    (await adminDb.collection(`negocios/${businessId}/cotizaciones`).get()).size,
    7
  );
  console.log("QUOTE_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
