import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { buildQuoteValidityEmailLine } from "../src/domain/quoteEmailCopy.mjs";

const require = createRequire(import.meta.url);
const {
  QUOTE_EMAIL_COOLDOWN_MS,
  assertQuoteEmailAttemptAvailable,
  normalizeSingleRecipient,
  sendQuoteEmailHandler,
  validateStoredQuoteForEmail,
} = require("../functions/quoteEmail.js");

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const FieldValue = {
  serverTimestamp: () => ({ serverTimestamp: true }),
};
const request = {
  auth: { uid: "owner-1" },
  data: {
    businessId: "business-1",
    quoteId: "quote-1",
    emailCliente: "cliente@example.com",
    asunto: "Cotización COT-2026-0001 | Empresa Demo",
    mensaje: "Hola cliente",
    pdfBase64: "JVBERi0xLjQ=",
    pdfFilename: "COT-2026-0001.pdf",
    pdfMimeType: "application/pdf",
  },
};
const validQuote = {
  id: "quote-1",
  negocioId: "business-1",
  numero: "COT-2026-0001",
  estado: "emitida",
  cliente: { email: "cliente@example.com" },
  total: 100000,
};

assert.equal(
  buildQuoteValidityEmailLine(
    {
      estado: "borrador",
      fechaEmision: null,
      fechaVencimiento: "2020-01-01",
      validezDias: 10,
    },
    (value) => value
  ),
  "La propuesta tiene una vigencia de 10 días desde su emisión."
);
assert.equal(
  buildQuoteValidityEmailLine(
    {
      estado: "emitida",
      fechaEmision: "2026-08-13T15:00:00.000Z",
      fechaVencimiento: "2026-08-23",
      validezDias: 10,
    },
    (value) => value
  ),
  "La propuesta está vigente hasta el 2026-08-23."
);

function baseDependencies(overrides = {}, storedQuote = validQuote) {
  const quoteUpdates = [];
  const attemptUpdates = [];
  const quoteRef = {
    update: async (patch) => quoteUpdates.push(patch),
  };
  const attemptRef = {
    set: async (patch) => attemptUpdates.push(patch),
  };
  const calls = { provider: [], roles: [], html: [], text: [], tokens: [] };
  return {
    dependencies: {
      FieldValue,
      HttpsError: TestHttpsError,
      Timestamp: { fromDate: (date) => date },
      buildPlainQuoteEmail: (payload) => {
        calls.text.push(payload);
        return `correo plano ${payload.proposalUrl}`;
      },
      buildQuoteEmailHtml: (payload) => {
        calls.html.push(payload);
        return `<a href="${payload.proposalUrl}">Revisar</a>`;
      },
      buildQuoteEmissionPatch: ({ channel, now, quote }) => ({
        estado: "emitida",
        canalEmision: channel,
        fechaEmision: FieldValue.serverTimestamp(),
        fechaVencimiento: new Date(
          now.getTime() + Number(quote.validezDias || 10) * 24 * 60 * 60 * 1000
        ).toISOString().slice(0, 10),
      }),
      createPublicQuoteToken: async (payload) => {
        calls.tokens.push(payload);
        return {
          publicUrl: "https://valoracloud.bagner.cl/propuesta/token-seguro",
          tokenHash: "a".repeat(64),
        };
      },
      getCompanyProfileForQuote: async () => ({ nombreComercial: "Demo" }),
      getPublicBaseUrl: () => "https://valoracloud.bagner.cl",
      getQuoteEmailSender: () => "Demo <ventas@example.com>",
      getResendApiKey: () => "resend-test-key",
      isEmulatorEnvironment: () => false,
      normalizePdfAttachment: () => ({
        filename: "COT-2026-0001.pdf",
        content: "JVBERi0xLjQ=",
        contentType: "application/pdf",
      }),
      now: () => 1_000_000,
      requireBusinessAccess: async (_request, _deps, options) => {
        calls.roles.push(options.roles);
        return {
          businessId: "business-1",
          businessRef: {},
          uid: "owner-1",
        };
      },
      reserveQuoteEmailAttempt: async () => ({
        attemptRef,
        quote: storedQuote,
        quoteRef,
      }),
      safeText: (value, maxLength) =>
        String(value || "").trim().slice(0, maxLength),
      sendQuoteEmailWithProvider: async (payload) => {
        calls.provider.push(payload);
        return { id: "resend-message-1" };
      },
      ...overrides,
    },
    calls,
    quoteUpdates,
    attemptUpdates,
  };
}

{
  const { dependencies } = baseDependencies({
    requireBusinessAccess: async (_request, _deps, options) => {
      assert.deepEqual(options.roles, ["OWNER", "ADMIN"]);
      throw new TestHttpsError("permission-denied", "Sin acceso");
    },
  });
  await assert.rejects(
    sendQuoteEmailHandler(
      {
        ...request,
        data: { ...request.data, emailCliente: "alternativo@example.com" },
      },
      dependencies
    ),
    (error) => error.code === "permission-denied"
  );
}

{
  const { dependencies, calls, quoteUpdates, attemptUpdates } =
    baseDependencies();
  const result = await sendQuoteEmailHandler(request, dependencies);
  assert.equal(result.success, true);
  assert.deepEqual(calls.roles, [["OWNER", "ADMIN"]]);
  assert.equal(calls.provider.length, 1);
  assert.equal(calls.provider[0].to, "cliente@example.com");
  assert.equal(result.quoteEmailStatus.destinatarioAlternativo, false);
  assert.equal(
    result.quoteEmailStatus.correoOriginalCliente,
    "cliente@example.com"
  );
  assert.match(calls.provider[0].html, /\/propuesta\/token-seguro/);
  assert.match(calls.provider[0].text, /\/propuesta\/token-seguro/);
  assert.equal(calls.tokens.length, 1);
  assert.equal(calls.tokens[0].channel, "correo");
  assert.equal("cc" in calls.provider[0], false);
  assert.equal("bcc" in calls.provider[0], false);
  assert.equal(quoteUpdates.at(-1).estadoEnvioCorreo, "enviado");
  assert.equal(quoteUpdates.at(-1).estado, "emitida");
  assert.equal("canalEmision" in quoteUpdates.at(-1), false);
  assert.equal("fechaEmision" in quoteUpdates.at(-1), false);
  assert.equal(attemptUpdates.at(-1).estado, "enviado");
}

{
  const pendingQuote = { ...validQuote, estado: "borrador" };
  const { dependencies, quoteUpdates } = baseDependencies({}, pendingQuote);
  const result = await sendQuoteEmailHandler(request, dependencies);
  assert.equal(result.success, true);
  assert.equal(result.quoteEmailStatus.estado, "emitida");
  assert.equal(quoteUpdates.at(-1).estado, "emitida");
  assert.equal(quoteUpdates.at(-1).canalEmision, "correo");
  assert.equal(quoteUpdates.at(-1).fechaVencimiento, "1970-01-11");
}

{
  const pendingQuote = { ...validQuote, estado: "borrador" };
  const { dependencies, quoteUpdates } = baseDependencies(
    {
      sendQuoteEmailWithProvider: async () => {
        throw new Error("Proveedor temporalmente no disponible");
      },
    },
    pendingQuote
  );
  const result = await sendQuoteEmailHandler(request, dependencies);
  assert.equal(result.success, false);
  assert.equal(quoteUpdates.at(-1).estadoEnvioCorreo, "error");
  assert.equal("estado" in quoteUpdates.at(-1), false);
  assert.equal(pendingQuote.estado, "borrador");
}

{
  const originalQuote = structuredClone(validQuote);
  const { dependencies, calls, quoteUpdates } = baseDependencies();
  const result = await sendQuoteEmailHandler(
    {
      ...request,
      data: {
        ...request.data,
        emailCliente: "administracion@example.com",
        bcc: "atacante@example.com",
        cc: "copia@example.com",
        from: "Atacante <atacante@example.com>",
        replyTo: "atacante@example.com",
      },
    },
    dependencies
  );

  assert.equal(result.success, true);
  assert.equal(calls.provider.length, 1);
  assert.equal(calls.provider[0].to, "administracion@example.com");
  assert.equal("cc" in calls.provider[0], false);
  assert.equal("bcc" in calls.provider[0], false);
  assert.equal("replyTo" in calls.provider[0], false);
  assert.equal(calls.provider[0].from, "Demo <ventas@example.com>");
  assert.equal(result.quoteEmailStatus.emailClienteDestino, "administracion@example.com");
  assert.equal(result.quoteEmailStatus.correoOriginalCliente, "cliente@example.com");
  assert.equal(result.quoteEmailStatus.destinatarioAlternativo, true);
  assert.equal(quoteUpdates.at(-1).emailClienteDestino, "administracion@example.com");
  assert.equal(quoteUpdates.at(-1).correoOriginalCliente, "cliente@example.com");
  assert.equal(quoteUpdates.at(-1).destinatarioAlternativo, true);
  assert.equal("cliente" in quoteUpdates.at(-1), false);
  assert.equal("clienteEmail" in quoteUpdates.at(-1), false);
  assert.equal("clienteSnapshot" in quoteUpdates.at(-1), false);
  assert.deepEqual(validQuote, originalQuote);
}

for (const invalidRecipient of [
  "correo-invalido",
  "a@example.com,b@example.com",
  "a@example.com; b@example.com",
  "a@example.com\r\nBcc: atacante@example.com",
  ["a@example.com", "b@example.com"],
]) {
  const { dependencies, calls } = baseDependencies();
  await assert.rejects(
    sendQuoteEmailHandler(
      {
        ...request,
        data: { ...request.data, emailCliente: invalidRecipient },
      },
      dependencies
    ),
    (error) => error.code === "invalid-argument"
  );
  assert.equal(calls.provider.length, 0);
}

assert.deepEqual(
  validateStoredQuoteForEmail(validQuote, {
    businessId: "business-1",
    emailCliente: "otro@example.com",
    HttpsError: TestHttpsError,
  }),
  {
    correoOriginalCliente: "cliente@example.com",
    destinatarioAlternativo: true,
    emailClienteDestino: "otro@example.com",
  }
);

assert.equal(
  normalizeSingleRecipient("  ADMINISTRACION@example.com ", TestHttpsError),
  "administracion@example.com"
);

assert.equal(
  validateStoredQuoteForEmail(
    { ...validQuote, estado: "borrador" },
    {
      businessId: "business-1",
      emailCliente: "cliente@example.com",
      HttpsError: TestHttpsError,
    }
  ).emailClienteDestino,
  "cliente@example.com"
);

for (const estado of ["aceptada", "rechazada", "vencida", "archivada"]) {
  assert.throws(
    () =>
      validateStoredQuoteForEmail(
        { ...validQuote, estado },
        {
          businessId: "business-1",
          emailCliente: "cliente@example.com",
          HttpsError: TestHttpsError,
        }
      ),
    (error) => error.code === "failed-precondition"
  );
}

{
  const { dependencies, calls } = baseDependencies({
    reserveQuoteEmailAttempt: async ({ emailCliente, HttpsError, nowMs }) => {
      assert.equal(emailCliente, "alternativo@example.com");
      assertQuoteEmailAttemptAvailable(
        {
          estado: "enviado",
          nextAllowedAtMs: nowMs + QUOTE_EMAIL_COOLDOWN_MS,
        },
        nowMs,
        HttpsError
      );
    },
  });
  await assert.rejects(
    sendQuoteEmailHandler(
      {
        ...request,
        data: { ...request.data, emailCliente: "alternativo@example.com" },
      },
      dependencies
    ),
    (error) => error.code === "resource-exhausted"
  );
  assert.equal(calls.provider.length, 0);
}

{
  const { dependencies } = baseDependencies({
    normalizePdfAttachment: () => null,
  });
  await assert.rejects(
    sendQuoteEmailHandler(request, dependencies),
    (error) =>
      error.code === "invalid-argument" && /PDF adjunto/.test(error.message)
  );
}

assert.throws(
  () =>
    assertQuoteEmailAttemptAvailable(
      {
        estado: "enviado",
        nextAllowedAtMs: 1_000_000 + QUOTE_EMAIL_COOLDOWN_MS,
      },
      1_000_001,
      TestHttpsError
    ),
  (error) => error.code === "resource-exhausted"
);

const functionSource = fs.readFileSync("functions/index.js", "utf8");
const modalSource = fs.readFileSync(
  "src/features/quotes/SendQuoteEmailModal.jsx",
  "utf8"
);
const toastRouteSyncSource = fs.readFileSync(
  "src/components/ToastRouteSync.jsx",
  "utf8"
);
const appSource = fs.readFileSync("src/app/App.jsx", "utf8");
const mainSource = fs.readFileSync("src/main.jsx", "utf8");
assert.doesNotMatch(functionSource, /AUTOMATIC_QUOTE_EMAIL_ENABLED/);
assert.match(functionSource, /sendQuoteEmailHandler/);
assert.match(modalSource, /<ResponsiveDialog/);
assert.match(modalSource, /Usar otro correo/);
assert.match(modalSource, /Volver al correo del cliente/);
assert.doesNotMatch(modalSource, /buildMailtoUrl|downloadQuotePdf/);
assert.match(toastRouteSyncSource, /useLocation/);
assert.match(toastRouteSyncSource, /useRef\(pathname\)/);
assert.match(toastRouteSyncSource, /sileo\.clear\(\)/);
assert.doesNotMatch(toastRouteSyncSource, /location\.(search|hash)/);
assert.match(appSource, /<ToastRouteSync\s*\/>/);
assert.equal((mainSource.match(/<Toaster\b/g) || []).length, 1);

console.log(
  "QUOTE_EMAIL_SMOKE_OK borrador/emisión, reenvío, fallo conservador, permisos, destinatario, trazabilidad, seguridad y cooldown"
);
