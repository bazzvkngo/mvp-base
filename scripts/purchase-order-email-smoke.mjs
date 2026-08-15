import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const {
  assertAttemptAvailable,
  buildHtmlEmail,
  buildPlainEmail,
  finalizeSuccessfulSend,
  normalizeSingleRecipient,
  sendPurchaseOrderEmailHandler,
  validateStoredOrder,
} = require("../functions/purchaseOrderEmail.js");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

assert.equal(normalizeSingleRecipient("Proveedor@Empresa.cl", FakeHttpsError), "proveedor@empresa.cl");
for (const invalid of ["", "a@b.cl,c@d.cl", "a@b.cl\nBcc:x@y.cl", ["a@b.cl"]]) {
  assert.throws(() => normalizeSingleRecipient(invalid, FakeHttpsError), FakeHttpsError);
}
assert.throws(() => validateStoredOrder({negocioId: "business-b", estado: "borrador"}, {businessId: "business-a", emailProveedor: "a@b.cl", HttpsError: FakeHttpsError}), /No puedes enviar/);
assert.throws(() => validateStoredOrder({negocioId: "business-a", estado: "cancelada"}, {businessId: "business-a", emailProveedor: "a@b.cl", HttpsError: FakeHttpsError}), /pendientes o emitidas/);
const recipient = validateStoredOrder({negocioId: "business-a", estado: "borrador", proveedorSnapshot: {email: "original@empresa.cl"}}, {businessId: "business-a", emailProveedor: "alternativo@empresa.cl", HttpsError: FakeHttpsError});
assert.equal(recipient.destinatarioAlternativo, true);
assert.equal(recipient.correoOriginalProveedor, "original@empresa.cl");
assert.throws(() => assertAttemptAvailable({estado: "enviando", leaseUntilMs: 2000}, 1000, FakeHttpsError), /en curso/);
assert.throws(() => assertAttemptAvailable({estado: "error", nextAllowedAtMs: 2000}, 1000, FakeHttpsError), /Espera/);

const order = {
  id: "order-1",
  negocioId: "business-a",
  numero: "OC-2026-0001",
  estado: "borrador",
  total: 11900,
  condicionesPago: "Transferencia",
  proveedorSnapshot: {razonSocial: "Proveedor Uno", email: "proveedor@empresa.cl"},
};
assert.match(buildPlainEmail({company: {nombreComercial: "Valora"}, order}), /OC-2026-0001/);
assert.match(buildHtmlEmail({company: {nombreComercial: "Valora"}, order, escapeHtml: (value) => String(value)}), /ORDEN|Orden de compra/i);

async function runHandler({emulator = false, configured = true, providerFails = false} = {}) {
  const orderPatches = [];
  const attemptPatches = [];
  const orderRef = {update: async (patch) => orderPatches.push(patch)};
  const attemptRef = {set: async (patch) => attemptPatches.push(patch)};
  const result = await sendPurchaseOrderEmailHandler({
    auth: {uid: "owner-1"},
    data: {ordenCompraId: order.id, emailProveedor: order.proveedorSnapshot.email, pdfBase64: "pdf"},
  }, {
    FieldValue: {serverTimestamp: () => "SERVER_TIMESTAMP"},
    HttpsError: FakeHttpsError,
    escapeHtml: (value) => String(value),
    getCompanyProfile: async () => ({nombreComercial: "Valora"}),
    getEmailSender: () => configured ? "compras@empresa.cl" : "",
    getResendApiKey: () => configured ? "secret" : "",
    isEmulatorEnvironment: () => emulator,
    normalizePdfAttachment: () => ({filename: "OC-2026-0001.pdf", content: "pdf", contentType: "application/pdf"}),
    now: () => 1000,
    requireBusinessAccess: async () => ({businessId: "business-a", businessRef: {}, uid: "owner-1"}),
    reserveAttempt: async () => ({attemptRef, order, orderRef, recipient: {correoOriginalProveedor: order.proveedorSnapshot.email, destinatarioAlternativo: false, emailProveedorDestino: order.proveedorSnapshot.email}}),
    finalizeSuccessfulSend: async ({basePatch, emailProveedor, FieldValue, providerId, uid}) => {
      orderPatches.push({...basePatch, estado: "emitida", canalEmision: "correo", destinatarioEmision: emailProveedor, cantidadEnvios: 1, emitidaEn: FieldValue.serverTimestamp(), emitidaPorUid: uid, idEnvioCorreoProveedor: providerId});
      return {emitted: true, resent: false, finalStatus: "emitida"};
    },
    sendEmailWithProvider: async () => {
      if (providerFails) throw new Error("provider failed");
      return {id: "resend-1"};
    },
  });
  return {attemptPatches, orderPatches, result};
}

const simulated = await runHandler({emulator: true});
assert.equal(simulated.result.simulated, true);
assert.equal(simulated.orderPatches.at(-1).estadoEnvioCorreo, "simulado");
assert.equal("estado" in simulated.orderPatches.at(-1), false, "la simulación no emite la OC");

const missingConfig = await runHandler({configured: false});
assert.equal(missingConfig.result.success, false);
assert.equal(missingConfig.orderPatches.at(-1).estadoEnvioCorreo, "error");
assert.equal("estado" in missingConfig.orderPatches.at(-1), false, "un error conserva la OC pendiente");

const sent = await runHandler();
assert.equal(sent.result.success, true);
assert.equal(sent.orderPatches.at(-1).estado, "emitida");
assert.equal(sent.orderPatches.at(-1).canalEmision, "correo");
assert.equal(sent.orderPatches.at(-1).cantidadEnvios, 1);

const originalConsoleError = console.error;
console.error = () => {};
const providerFailure = await runHandler({providerFails: true});
console.error = originalConsoleError;
assert.equal(providerFailure.result.success, false);
assert.equal(providerFailure.orderPatches.at(-1).estadoEnvioCorreo, "error");
assert.equal("estado" in providerFailure.orderPatches.at(-1), false);

let concurrentCancelPatch;
const concurrentCancel = await finalizeSuccessfulSend({
  basePatch: {estadoEnvioCorreo: "enviando"},
  businessRef: {firestore: {runTransaction: async (operation) => operation({
    get: async () => ({exists: true, data: () => ({estado: "cancelada"})}),
    update: (_ref, patch) => { concurrentCancelPatch = patch; },
  })}},
  emailProveedor: "proveedor@empresa.cl",
  FieldValue: {serverTimestamp: () => "SERVER_TIMESTAMP"},
  HttpsError: FakeHttpsError,
  orderRef: {},
  providerId: "resend-concurrent",
  uid: "owner-1",
});
assert.equal(concurrentCancel.finalStatus, "cancelada");
assert.equal("estado" in concurrentCancelPatch, false, "un envío concurrente no revive una OC cancelada");

const pageSource = fs.readFileSync(new URL("../src/pages/NewPurchaseOrderPage.jsx", import.meta.url), "utf8");
const historySource = fs.readFileSync(new URL("../src/pages/PurchaseOrdersPage.jsx", import.meta.url), "utf8");
const dialogSource = fs.readFileSync(new URL("../src/features/purchaseOrders/SendPurchaseOrderEmailDialog.jsx", import.meta.url), "utf8");
const purchaseOrderCssSource = fs.readFileSync(new URL("../src/features/purchaseOrders/purchase-orders.css", import.meta.url), "utf8");
const backendSource = fs.readFileSync(new URL("../functions/purchaseOrderPersistence.js", import.meta.url), "utf8");
const rulesSource = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
assert.match(pageSource, /\u00bfEnviaste la orden de compra\?/);
assert.match(pageSource, /Mantener pendiente/);
assert.match(pageSource, /Sí, fue enviada/);
assert.match(historySource, /SendPurchaseOrderEmailDialog/);
assert.match(historySource, /sendPurchaseOrderEmail/);
assert.match(historySource, /onClick=\{\(\) => onSend\(order\)\}/);
assert.doesNotMatch(historySource, /Esperando respuesta/);
assert.match(dialogSource, /Enviar por correo/);
assert.match(dialogSource, /import Button from/);
assert.match(dialogSource, /className="quote-email-dialog"/);
assert.match(dialogSource, /variant="secondary"/);
assert.doesNotMatch(purchaseOrderCssSource, /\.po-email-dialog/);
assert.match(pageSource, /No se envió un correo real\. La orden permanece pendiente de envío\./);
assert.match(historySource, /No se envió un correo real\. La orden permanece pendiente de envío\./);
assert.match(backendSource, /\["correo", "whatsapp", "manual"\]/);
assert.match(rulesSource, /match \/purchaseOrderEmailAttempts\/\{attemptId\}/);

console.log("OK correo OC: destinatario único, cooldown, simulación, fallo y emisión exitosa");
console.log("OK WhatsApp OC: apertura separada de confirmación autoritativa");
