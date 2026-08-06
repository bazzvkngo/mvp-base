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
    giro: "Servicios profesionales",
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
const outsider = await authenticate(createClientApp("outsider"), "outsider");
const clients = [owner, outsider];
const adminApp = initializeAdminApp(
  {projectId: PROJECT_ID},
  `quotes-admin-${RUN_ID}`
);
const adminDb = getAdminFirestore(adminApp);

try {
  const ownerBusiness = await callable(owner, "createFirstBusiness")({
    nombreComercial: "Empresa cotizaciones local",
    rubroCodigo: "SERVICIOS_PROFESIONALES",
    regionCodigo: "13",
    requestId: `business-owner-${RUN_ID}`,
  });
  const outsiderBusiness = await callable(outsider, "createFirstBusiness")({
    nombreComercial: "Empresa cotizaciones externa",
    rubroCodigo: "SERVICIOS_PROFESIONALES",
    regionCodigo: "13",
    requestId: `business-outsider-${RUN_ID}`,
  });
  const businessId = ownerBusiness.data.business.id;
  const outsiderBusinessId = outsiderBusiness.data.business.id;

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
  console.log("OK snapshot: Functions ignora datos de cliente enviados por frontend");

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

  assert.equal(
    (await adminDb.collection(`negocios/${businessId}/cotizaciones`).get()).size,
    4
  );
  console.log("QUOTE_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
