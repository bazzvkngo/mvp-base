import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createPublicQuoteToken,
  confirmQuoteWhatsAppSentHandler,
  calculateEmissionExpiryDate,
  calculateQuoteExpiryDate,
  evaluateExpiration,
  expireOnePublicQuoteProposal,
  getPublicQuoteProposalHandler,
  hashPublicToken,
  markQuoteEmittedManuallyHandler,
  prepareQuoteWhatsAppShareHandler,
  respondPublicQuoteProposalHandler,
  sanitizePublicQuote,
} = require("../functions/quotePublicProposal.js");

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const now = new Date("2026-08-13T15:00:00.000Z");
const FieldValue = { serverTimestamp: () => new Date(now) };
const Timestamp = { fromDate: (date) => new Date(date) };

assert.equal(
  calculateEmissionExpiryDate({ validezDias: 10 }, now),
  "2026-08-23"
);
assert.equal(
  calculateQuoteExpiryDate({
    fechaEmision: now,
    fechaVencimiento: "2026-01-01",
    validezDias: 10,
  }),
  "2026-08-23"
);

function createFakeDb(initialEntries = []) {
  const store = new Map(initialEntries.map(([path, data]) => [path, structuredClone(data)]));
  let api;
  const makeRef = (path) => ({
    path,
    id: path.split("/").at(-1),
    get firestore() {
      return api;
    },
    collection(name) {
      return makeCollection(`${path}/${name}`);
    },
  });
  const makeCollection = (path) => ({
    path,
    doc(id) {
      return makeRef(`${path}/${id}`);
    },
  });
  const snapshot = (ref) => ({
    exists: store.has(ref.path),
    id: ref.id,
    ref,
    data: () => structuredClone(store.get(ref.path)),
  });
  const merge = (ref, patch, options = {}) => {
    const next = options.merge
      ? { ...(store.get(ref.path) || {}), ...structuredClone(patch) }
      : structuredClone(patch);
    store.set(ref.path, next);
  };
  const transaction = {
    get: async (ref) => snapshot(ref),
    set: (ref, patch, options) => merge(ref, patch, options),
    update: (ref, patch) => merge(ref, patch, { merge: true }),
    create: (ref, data) => {
      assert.equal(store.has(ref.path), false, `Documento duplicado ${ref.path}`);
      merge(ref, data);
    },
  };
  api = {
    collection: makeCollection,
    runTransaction: async (handler) => handler(transaction),
    read: (path) => store.get(path),
    store,
  };
  return api;
}

function quoteFixture(overrides = {}) {
  return {
    negocioId: "business-1",
    numero: "COT-2026-0001",
    estado: "emitida",
    fecha: "2026-08-13",
    fechaVencimiento: "2026-08-23",
    validezDias: 10,
    moneda: "CLP",
    empresa: {
      nombreComercial: "Empresa Demo",
      email: "ventas@empresa.cl",
      logoUrl: "https://example.com/logo.png",
    },
    cliente: {
      clienteId: "internal-client-id",
      empresa: "Cliente Demo",
      email: "cliente@example.com",
    },
    proyectoNombre: "Proyecto seguro",
    items: [{
      itemId: "inventory-secret",
      inventarioSnapshot: { costoBase: 500, margenDeseado: 30 },
      nombre: "Servicio comercial",
      descripcionComercial: "Descripción pública",
      unidad: "servicio",
      cantidad: 1,
      precioUnitarioEditable: 1000,
      descuentoPorcentaje: 0,
      subtotalLinea: 1000,
      totalLinea: 1000,
    }],
    condiciones: { formaPago: "30 días", observaciones: "Observación pública" },
    subtotal: 1000,
    neto: 1000,
    iva: 190,
    total: 1190,
    costoBase: 500,
    margenDeseado: 40,
    uidUsuario: "internal-user",
    ...overrides,
  };
}

async function createProposalFixture(overrides = {}, { channel = "" } = {}) {
  const quotePath = "negocios/business-1/cotizaciones/quote-1";
  const db = createFakeDb([[quotePath, quoteFixture(overrides)]]);
  const quoteRef = db.collection("negocios").doc("business-1")
    .collection("cotizaciones").doc("quote-1");
  const created = await createPublicQuoteToken({
    businessId: "business-1",
    channel,
    db,
    FieldValue,
    HttpsError: TestHttpsError,
    now,
    publicBaseUrl: "http://localhost:5173",
    quoteRef,
    Timestamp,
  });
  const rawToken = created.publicUrl.split("/").at(-1);
  return { created, db, quotePath, rawToken };
}

{
  const pendingWithOldDocumentDate = await createProposalFixture({
    estado: "borrador",
    fechaVencimiento: "2026-08-12",
  });
  assert.ok(pendingWithOldDocumentDate.created.expiresAt > now);
  assert.equal(pendingWithOldDocumentDate.db.read(
    pendingWithOldDocumentDate.quotePath
  ).estado, "borrador");
}

{
  const { created, db, quotePath, rawToken } = await createProposalFixture();
  const tokenPath = `quotePublicTokens/${created.tokenHash}`;
  const storedToken = db.read(tokenPath);
  assert.equal(hashPublicToken(rawToken), created.tokenHash);
  assert.equal("token" in storedToken, false);
  assert.equal("rawToken" in storedToken, false);
  assert.doesNotMatch(JSON.stringify([...db.store.values()]), new RegExp(rawToken));

  const result = await getPublicQuoteProposalHandler(
    { data: { token: rawToken } },
    { db, FieldValue, HttpsError: TestHttpsError, now: () => now.getTime() }
  );
  assert.equal(result.proposal.numero, "COT-2026-0001");
  assert.equal(result.proposal.items[0].nombre, "Servicio comercial");
  const publicJson = JSON.stringify(result.proposal);
  ["business-1", "quote-1", "inventory-secret", "internal-client-id", "internal-user"]
    .forEach((secretValue) => assert.doesNotMatch(publicJson, new RegExp(secretValue)));
  ["costoBase", "margenDeseado", "inventarioSnapshot", "uidUsuario"]
    .forEach((secretField) => assert.doesNotMatch(publicJson, new RegExp(secretField)));
  assert.ok(db.read(quotePath).propuestaPublicaVistaEn);

  await assert.rejects(
    getPublicQuoteProposalHandler(
      { data: { token: "x".repeat(43) } },
      { db, FieldValue, HttpsError: TestHttpsError, now: () => now.getTime() }
    ),
    (error) => error.code === "not-found"
  );
}

{
  const { db, quotePath, rawToken } = await createProposalFixture();
  const dependencies = {
    db,
    FieldValue,
    HttpsError: TestHttpsError,
    now: () => now.getTime(),
  };
  const accepted = await respondPublicQuoteProposalHandler(
    { data: { token: rawToken, action: "accept" } },
    dependencies
  );
  assert.equal(accepted.estado, "aceptada");
  assert.equal(db.read(quotePath).respuestaClienteOrigen, "portal_publico");
  const repeated = await respondPublicQuoteProposalHandler(
    { data: { token: rawToken, action: "accept" } },
    dependencies
  );
  assert.equal(repeated.idempotent, true);
  await assert.rejects(
    respondPublicQuoteProposalHandler(
      { data: { token: rawToken, action: "reject", motivo: "precio" } },
      dependencies
    ),
    (error) => error.code === "failed-precondition"
  );
}

{
  const { created, db, quotePath, rawToken: firstToken } =
    await createProposalFixture();
  const quoteRef = db.collection("negocios").doc("business-1")
    .collection("cotizaciones").doc("quote-1");
  const second = await createPublicQuoteToken({
    businessId: "business-1",
    channel: "whatsapp",
    db,
    FieldValue,
    HttpsError: TestHttpsError,
    now,
    publicBaseUrl: "http://localhost:5173",
    quoteRef,
    Timestamp,
  });
  const secondToken = second.publicUrl.split("/").at(-1);
  assert.notEqual(created.tokenHash, second.tokenHash);
  assert.equal(db.read(`quotePublicTokens/${created.tokenHash}`).estado, "active");
  assert.equal(
    db.read(`quotePublicTokens/${second.tokenHash}`).canalOrigen,
    "whatsapp"
  );

  for (const token of [firstToken, secondToken]) {
    const proposal = await getPublicQuoteProposalHandler(
      { data: { token } },
      { db, FieldValue, HttpsError: TestHttpsError, now: () => now.getTime() }
    );
    assert.equal(proposal.proposal.numero, "COT-2026-0001");
  }

  const dependencies = {
    db,
    FieldValue,
    HttpsError: TestHttpsError,
    now: () => now.getTime(),
  };
  await respondPublicQuoteProposalHandler(
    { data: { token: firstToken, action: "accept" } },
    dependencies
  );
  await assert.rejects(
    respondPublicQuoteProposalHandler(
      { data: { token: secondToken, action: "reject", motivo: "precio" } },
      dependencies
    ),
    (error) => error.code === "failed-precondition"
  );
  const sameResponse = await respondPublicQuoteProposalHandler(
    { data: { token: secondToken, action: "accept" } },
    dependencies
  );
  assert.equal(sameResponse.idempotent, true);
  assert.equal(db.read(quotePath).estado, "aceptada");
}

{
  const quotePath = "negocios/business-1/cotizaciones/quote-1";
  const db = createFakeDb([[quotePath, quoteFixture({ estado: "borrador" })]]);
  const businessRef = db.collection("negocios").doc("business-1");
  const roles = [];
  const dependencies = {
    db,
    FieldValue,
    getPublicBaseUrl: () => "http://localhost:5173",
    HttpsError: TestHttpsError,
    now: () => now.getTime(),
    requireBusinessAccess: async (_request, _dependencies, options) => {
      roles.push(options.roles);
      return { businessId: "business-1", businessRef, uid: "owner-1" };
    },
    Timestamp,
  };
  const prepared = await prepareQuoteWhatsAppShareHandler(
    { auth: { uid: "owner-1" }, data: { quoteId: "quote-1" } },
    dependencies
  );
  assert.match(prepared.publicUrl, /\/propuesta\//);
  assert.equal(db.read(quotePath).estado, "borrador");

  const shared = await confirmQuoteWhatsAppSentHandler(
    { auth: { uid: "owner-1" }, data: { quoteId: "quote-1" } },
    dependencies
  );
  assert.deepEqual(roles, [["OWNER", "ADMIN"], ["OWNER", "ADMIN"]]);
  assert.equal(shared.quoteStatus.estado, "emitida");
  assert.equal(db.read(quotePath).estado, "emitida");
  assert.equal(db.read(quotePath).canalEmision, "whatsapp");
  assert.equal(db.read(quotePath).emisionDetectadaPor, "confirmacion_usuario");
  assert.equal(db.read(quotePath).fechaVencimiento, "2026-08-23");

  const canceledDb = createFakeDb([
    [quotePath, quoteFixture({ estado: "borrador" })],
  ]);
  assert.equal(canceledDb.read(quotePath).estado, "borrador");
}

{
  const quotePath = "negocios/business-1/cotizaciones/quote-1";
  const db = createFakeDb([[quotePath, quoteFixture({ estado: "borrador" })]]);
  const businessRef = db.collection("negocios").doc("business-1");
  const dependencies = {
    FieldValue,
    HttpsError: TestHttpsError,
    now: () => now.getTime(),
    requireBusinessAccess: async (_request, _dependencies, options) => {
      assert.deepEqual(options.roles, ["OWNER", "ADMIN"]);
      return { businessId: "business-1", businessRef, uid: "owner-1" };
    },
  };
  const emitted = await markQuoteEmittedManuallyHandler(
    { auth: { uid: "owner-1" }, data: { quoteId: "quote-1" } },
    dependencies
  );
  assert.equal(emitted.quoteStatus.estado, "emitida");
  assert.equal(db.read(quotePath).canalEmision, "manual");
  assert.ok(db.read(quotePath).fechaEmision);
  assert.equal(db.read(quotePath).fechaVencimiento, "2026-08-23");

  const originalEmission = db.read(quotePath).fechaEmision;
  db.store.set(quotePath, {
    ...db.read(quotePath),
    estado: "archivada",
    estadoAnterior: "emitida",
  });
  await markQuoteEmittedManuallyHandler(
    { auth: { uid: "owner-1" }, data: { quoteId: "quote-1" } },
    dependencies
  );
  assert.deepEqual(db.read(quotePath).fechaEmision, originalEmission);

  await assert.rejects(
    markQuoteEmittedManuallyHandler(
      { auth: { uid: "member-1" }, data: { quoteId: "quote-1" } },
      {
        ...dependencies,
        requireBusinessAccess: async () => {
          throw new TestHttpsError("permission-denied", "Sin acceso");
        },
      }
    ),
    (error) => error.code === "permission-denied"
  );
}

{
  const { db, quotePath, rawToken } = await createProposalFixture(
    { estado: "borrador", fechaVencimiento: "2026-01-01" },
    { channel: "whatsapp" }
  );
  const opened = await getPublicQuoteProposalHandler(
    { data: { token: rawToken } },
    {
      db,
      FieldValue,
      HttpsError: TestHttpsError,
      now: () => now.getTime(),
      Timestamp,
    }
  );
  assert.equal(opened.proposal.estado, "emitida");
  assert.equal(db.read(quotePath).estado, "emitida");
  assert.equal(db.read(quotePath).canalEmision, "whatsapp");
  assert.equal(db.read(quotePath).emisionDetectadaPor, "apertura_cliente");
  assert.equal(db.read(quotePath).fechaVencimiento, "2026-08-23");
  const tokenData = db.read(`quotePublicTokens/${hashPublicToken(rawToken)}`);
  assert.ok(tokenData.primeraAperturaEn);
  assert.equal(tokenData.aperturas, 1);
}

for (const [action, expectedStatus, extraData] of [
  ["accept", "aceptada", {}],
  ["reject", "rechazada", { motivo: "precio" }],
]) {
  const { db, quotePath, rawToken } = await createProposalFixture(
    { estado: "borrador" },
    { channel: "whatsapp" }
  );
  const response = await respondPublicQuoteProposalHandler(
    { data: { token: rawToken, action, ...extraData } },
    {
      db,
      FieldValue,
      HttpsError: TestHttpsError,
      now: () => now.getTime(),
      Timestamp,
    }
  );
  assert.equal(response.estado, expectedStatus);
  assert.equal(db.read(quotePath).estado, expectedStatus);
  assert.equal(db.read(quotePath).canalEmision, "whatsapp");
  assert.ok(db.read(quotePath).fechaEmision);
  assert.equal(db.read(quotePath).emisionDetectadaPor, "apertura_cliente");
}

{
  const preparedAt = new Date("2026-08-01T15:00:00.000Z");
  const emittedAt = new Date("2026-08-08T15:00:00.000Z");
  const checkedAt = new Date("2026-08-13T15:00:00.000Z");
  const { created, db, quotePath, rawToken } = await createProposalFixture(
    { estado: "borrador", validezDias: 10 },
    { channel: "whatsapp" }
  );
  const tokenPath = `quotePublicTokens/${created.tokenHash}`;
  const provisionalExpiry = new Date("2026-08-11T04:00:00.000Z");
  db.store.set(tokenPath, {
    ...db.read(tokenPath),
    creadoEn: preparedAt,
    expiraEn: provisionalExpiry,
  });
  db.store.set(quotePath, {
    ...db.read(quotePath),
    estado: "emitida",
    canalEmision: "whatsapp",
    fechaEmision: emittedAt,
    fechaVencimiento: "2026-08-18",
  });

  const opened = await getPublicQuoteProposalHandler(
    { data: { token: rawToken } },
    {
      db,
      FieldValue,
      HttpsError: TestHttpsError,
      now: () => checkedAt.getTime(),
      Timestamp,
    }
  );
  assert.equal(opened.proposal.estado, "emitida");
  assert.ok(db.read(tokenPath).expiraEn > checkedAt);

  db.store.set(tokenPath, {
    ...db.read(tokenPath),
    expiraEn: provisionalExpiry,
  });
  const accepted = await respondPublicQuoteProposalHandler(
    { data: { token: rawToken, action: "accept" } },
    {
      db,
      FieldValue,
      HttpsError: TestHttpsError,
      now: () => checkedAt.getTime(),
      Timestamp,
    }
  );
  assert.equal(accepted.estado, "aceptada");

  db.store.set(quotePath, {
    ...db.read(quotePath),
    estado: "emitida",
    respuestaCliente: "",
  });
  db.store.set(tokenPath, {
    ...db.read(tokenPath),
    estado: "active",
    respuesta: null,
    expiraEn: provisionalExpiry,
  });
  const schedulerOutcome = await expireOnePublicQuoteProposal(
    {
      data: () => structuredClone(db.read(tokenPath)),
      id: created.tokenHash,
      ref: db.collection("quotePublicTokens").doc(created.tokenHash),
    },
    { db, FieldValue, Timestamp },
    checkedAt
  );
  assert.equal(schedulerOutcome, "reschedule");
  assert.equal(db.read(quotePath).estado, "emitida");
  assert.ok(db.read(tokenPath).expiraEn > checkedAt);
}

{
  const { db, quotePath, rawToken } = await createProposalFixture();
  const dependencies = {
    db,
    FieldValue,
    HttpsError: TestHttpsError,
    now: () => now.getTime(),
  };
  const rejected = await respondPublicQuoteProposalHandler(
    {
      data: {
        token: rawToken,
        action: "reject",
        motivo: "precio",
        comentario: "Fuera del presupuesto actual.",
      },
    },
    dependencies
  );
  assert.equal(rejected.estado, "rechazada");
  assert.equal(db.read(quotePath).motivoRechazoCliente, "precio");
  assert.equal(
    db.read(quotePath).comentarioRechazoCliente,
    "Fuera del presupuesto actual."
  );
  await assert.rejects(
    respondPublicQuoteProposalHandler(
      { data: { token: rawToken, action: "accept" } },
      dependencies
    ),
    (error) => error.code === "failed-precondition"
  );
  await assert.rejects(
    respondPublicQuoteProposalHandler(
      {
        data: {
          token: rawToken,
          action: "reject",
          motivo: "otro",
          comentario: "x".repeat(501),
        },
      },
      dependencies
    ),
    (error) => error.code === "invalid-argument"
  );
}

{
  const expiredNow = new Date("2026-08-25T12:00:00.000Z");
  const { db, quotePath, rawToken } = await createProposalFixture();
  await assert.rejects(
    respondPublicQuoteProposalHandler(
      { data: { token: rawToken, action: "accept" } },
      {
        db,
        FieldValue,
        HttpsError: TestHttpsError,
        now: () => expiredNow.getTime(),
      }
    ),
    (error) => error.code === "failed-precondition" && /vencido/i.test(error.message)
  );
  assert.equal(db.read(quotePath).estado, "vencida");
}

const pastExpiry = new Date("2026-08-12T12:00:00.000Z");
assert.equal(
  evaluateExpiration({
    nowMs: now.getTime(),
    quote: quoteFixture({ estado: "borrador", fechaEmision: null }),
    tokenData: { estado: "active", expiraEn: pastExpiry },
  }).outcome,
  "preserve_quote"
);
assert.equal(
  evaluateExpiration({
    nowMs: now.getTime(),
    quote: quoteFixture(),
    tokenData: { estado: "active", expiraEn: pastExpiry },
  }).outcome,
  "expire_quote"
);
assert.equal(
  evaluateExpiration({
    nowMs: now.getTime(),
    quote: quoteFixture({ estado: "aceptada" }),
    tokenData: { estado: "active", expiraEn: pastExpiry },
  }).outcome,
  "preserve_quote"
);
assert.equal(
  evaluateExpiration({
    nowMs: now.getTime(),
    quote: quoteFixture({ estado: "rechazada" }),
    tokenData: { estado: "active", expiraEn: pastExpiry },
  }).outcome,
  "preserve_quote"
);
assert.equal(
  evaluateExpiration({
    nowMs: now.getTime(),
    quote: quoteFixture(),
    tokenData: { estado: "expired", expiraEn: pastExpiry },
  }).outcome,
  "skip"
);

const sanitized = sanitizePublicQuote(quoteFixture());
assert.equal(sanitized.total, 1190);
assert.equal(sanitized.items[0].precioUnitarioEditable, 1000);

const appSource = fs.readFileSync("src/app/App.jsx", "utf8");
const historySource = fs.readFileSync("src/pages/QuoteHistoryPage.jsx", "utf8");
const publicPageSource = fs.readFileSync(
  "src/pages/PublicQuoteProposalPage.jsx",
  "utf8"
);
const quoteServiceSource = fs.readFileSync("src/services/quoteService.js", "utf8");
const rulesSource = fs.readFileSync("firestore.rules", "utf8");
const indexes = JSON.parse(fs.readFileSync("firestore.indexes.json", "utf8"));
assert.ok(
  appSource.indexOf('/propuesta/:token') < appSource.indexOf("if (!usuario)"),
  "La ruta pública debe resolverse antes del guard de autenticación"
);
assert.match(
  rulesSource,
  /match \/quotePublicTokens\/\{tokenHash\}[\s\S]*allow read, write: if false;/
);
assert.ok(
  indexes.indexes.some(
    (index) =>
      index.collectionGroup === "quotePublicTokens" &&
      index.fields.some((field) => field.fieldPath === "estado") &&
      index.fields.some((field) => field.fieldPath === "expiraEn")
  )
);
const shareFlowSource = historySource.slice(
  historySource.indexOf("const runPdfAction"),
  historySource.indexOf("const confirmWhatsAppSent")
);
assert.match(shareFlowSource, /await shareQuotePdf/);
assert.match(shareFlowSource, /setWhatsAppConfirmationOpen\(true\)/);
assert.doesNotMatch(shareFlowSource, /confirmQuoteWhatsAppSent/);
assert.match(historySource, /¿Enviaste la cotización\?/);
assert.match(historySource, /Mantener pendiente/);
assert.match(historySource, /Sí, fue enviada/);
assert.match(historySource, /title: "Cotización emitida"/);
assert.match(historySource, /error\?\.name !== "AbortError"/);
assert.match(historySource, /\{canSendByEmail && \([\s\S]*runPdfAction\("whatsapp"\)/);
assert.match(publicPageSource, /Propuesta preparada por/);
assert.match(publicPageSource, /Vigencia: \$\{proposal\.validezDias/);
assert.match(publicPageSource, /Respuesta a la propuesta/);
assert.match(publicPageSource, /Confirma tu decisión respecto de la cotización/);
assert.match(publicPageSource, /Al confirmar, tu respuesta quedará registrada/);
assert.doesNotMatch(publicPageSource, /No genera una venta|afecta inventario|stock/i);
const publicToolbarSource = publicPageSource.slice(
  publicPageSource.indexOf('<div className="public-proposal__toolbar'),
  publicPageSource.indexOf('<section className="public-proposal__document">')
);
assert.doesNotMatch(publicToolbarSource, /Rechazar propuesta|Aceptar propuesta/);
assert.ok(
  publicPageSource.indexOf('<section className="public-proposal__response no-print">') >
    publicPageSource.indexOf('<section className="public-proposal__document">'),
  "La respuesta pública debe aparecer después del documento completo"
);
assert.match(quoteServiceSource, /"markQuoteEmittedManually"/);
const manualEmissionClientSource = quoteServiceSource.slice(
  quoteServiceSource.indexOf('if \(estado === "emitida"\)'.replace("\\", "")),
  quoteServiceSource.indexOf('assertClientWriteAllowed("cambiar el estado')
);
assert.doesNotMatch(manualEmissionClientSource, /updateDoc|serverTimestamp/);

console.log(
  "QUOTE_PUBLIC_PROPOSAL_SMOKE_OK confirmación WhatsApp, apertura cliente, tokens múltiples, respuestas y vigencia"
);
