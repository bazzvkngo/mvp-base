import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {adaptStoredFiscalIdentifier, buildFiscalIdentifier, isValidFiscalIdentifier} from "../src/domain/fiscalIdentifier.mjs";

const require = createRequire(import.meta.url);
const backend = require("../functions/fiscalIdentifier.js");
const {registeredClientQuoteFields} = require("../functions/quotePersistence.js");
const {clientSnapshotFromDocument, quoteClientSnapshot} = require("../functions/salePersistence.js");
const {providerSnapshotFromDocument} = require("../functions/purchaseOrderPersistence.js");
const {providerSnapshotFromDocument: purchaseProviderSnapshot} = require("../functions/purchasePersistence.js");

const cases = [
  ["CL", "12.345.678-5", true], ["CL", "12.345.678-4", false],
  ["BO", "1234567", true], ["BR", "529.982.247-25", true],
  ["BR", "11.222.333/0001-81", true], ["PE", "20100070970", true],
  ["OTHER", "TAX-12345", true],
];
for (const [country, value, expected] of cases) {
  assert.equal(isValidFiscalIdentifier(country, value), expected);
  assert.equal(backend.isValidFiscalIdentifier(country, value), expected);
}
assert.deepEqual(buildFiscalIdentifier("BO", "12-34567"), {
  paisCodigo: "BO", identificadorFiscalTipo: "NIT", identificadorFiscalValor: "12-34567", identificadorFiscalNormalizado: "1234567",
});
assert.equal(buildFiscalIdentifier("BR", "52998224725").identificadorFiscalTipo, "CPF");
assert.equal(buildFiscalIdentifier("BR", "11222333000181").identificadorFiscalTipo, "CNPJ");
assert.equal(adaptStoredFiscalIdentifier({rut: "12.345.678-5"}).identificadorFiscalNormalizado, "123456785");
assert.equal(backend.getFiscalReservationKey("CL", "12.345.678-5"), "123456785");
assert.equal(backend.getFiscalReservationKey("BO", "1234567"), "BO__1234567");

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const customer = {negocioId: "business-bo", clienteId: "client-1", estado: "activo", tipoCliente: "empresa", paisCodigo: "BO", identificadorFiscalTipo: "NIT", identificadorFiscalValor: "1234567", identificadorFiscalNormalizado: "1234567", nombreRazonSocial: "Cliente Bolivia"};
const provider = {negocioId: "business-bo", proveedorId: "provider-1", estado: "activo", paisCodigo: "BO", identificadorFiscalTipo: "NIT", identificadorFiscalValor: "7654321", identificadorFiscalNormalizado: "7654321", razonSocial: "Proveedor Bolivia"};
const snapshot = (id, data) => ({id, exists: true, data: () => data});
const quoteSnapshot = registeredClientQuoteFields(snapshot("client-1", customer), {businessId: "business-bo", clienteId: "client-1"}, HttpsError).cliente;
assert.equal(quoteSnapshot.identificadorFiscalTipo, "NIT");
assert.equal(clientSnapshotFromDocument(snapshot("client-1", customer), "business-bo", "client-1", HttpsError).identificadorFiscalValor, "1234567");
assert.equal(quoteClientSnapshot({clienteId: "client-1", cliente: quoteSnapshot}, HttpsError).identificadorFiscalTipo, "NIT");
assert.equal(providerSnapshotFromDocument(snapshot("provider-1", provider), {businessId: "business-bo", proveedorId: "provider-1"}, HttpsError).identificadorFiscalTipo, "NIT");
assert.equal(purchaseProviderSnapshot(snapshot("provider-1", provider), "business-bo", "provider-1", HttpsError).identificadorFiscalNormalizado, "7654321");
const legacyCustomer = {...customer, paisCodigo: undefined, identificadorFiscalTipo: undefined, identificadorFiscalValor: undefined, identificadorFiscalNormalizado: undefined, rut: "12.345.678-5"};
assert.equal(clientSnapshotFromDocument(snapshot("client-1", legacyCustomer), "business-bo", "client-1", HttpsError).identificadorFiscalTipo, "RUT");
console.log("Fiscal identifier smoke OK");
