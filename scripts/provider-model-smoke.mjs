import assert from "node:assert/strict";
import fs from "node:fs";
import {
  adaptStoredProvider,
  buildProviderMutationPayload,
  canManageProviders,
  canReadProviders,
  formatProviderRut,
  getProviderFieldErrors,
  getProviderRutKey,
  isValidProviderEmail,
  isValidProviderPhone,
  isValidProviderRut,
  matchesProviderSearch,
  normalizeProviderInput,
  normalizeProviderRut,
} from "../src/domain/providerModel.mjs";

function providerFixture(overrides = {}) {
  return {
    rut: "12.345.678-5",
    razonSocial: "Proveedor Industrial SpA",
    nombreFantasia: "Industrial Sur",
    giro: "Suministros industriales",
    personaContacto: "Ana Pérez",
    email: "VENTAS@PROVEEDOR.CL",
    telefono: "+56 9 1234 5678",
    direccion: "Av. Principal 123",
    regionCodigo: "13",
    regionNombre: "Nombre manipulado",
    comunaCodigo: "13101",
    comunaNombre: "Otra comuna",
    condicionesPago: "credito",
    diasCredito: "30",
    notas: "Proveedor preferente",
    ...overrides,
  };
}

const TERRITORY_CATALOG = {
  getRegionByCode: (code) =>
    code === "13" ? {code: "13", name: "Metropolitana de Santiago"} :
      code === "01" ? {code: "01", name: "Tarapacá"} : null,
  getCommuneByCode: (regionCode, communeCode) =>
    regionCode === "13" && communeCode === "13101"
      ? {code: "13101", name: "Santiago"}
      : null,
};

assert.equal(normalizeProviderRut("12.345.678-5"), "12345678-5");
assert.equal(formatProviderRut("123456785"), "12.345.678-5");
assert.equal(getProviderRutKey("12.345.678-5"), "123456785");
assert.equal(isValidProviderRut("12.345.678-5"), true);
assert.equal(isValidProviderRut("12.345.678-4"), false);
console.log("OK RUT: normalización, formato, clave y DV chileno");

const normalized = normalizeProviderInput(providerFixture(), TERRITORY_CATALOG);
assert.equal(normalized.email, "ventas@proveedor.cl");
assert.equal(normalized.diasCredito, 30);
assert.equal(normalized.regionNombre, "Metropolitana de Santiago");
assert.equal(normalized.comunaNombre, "Santiago");
console.log("OK normalización: texto, correo, crédito y territorio canónico");

assert.equal(isValidProviderEmail("compras@example.cl"), true);
assert.equal(isValidProviderEmail("correo-invalido"), false);
assert.equal(isValidProviderPhone("+56 (9) 1234-5678"), true);
assert.equal(isValidProviderPhone("teléfono secreto"), false);
assert.equal(getProviderFieldErrors(providerFixture({email: "malo"})).email, "Ingresa un correo válido.");
assert.equal(getProviderFieldErrors(providerFixture({telefono: "abc"})).telefono, "Ingresa un teléfono válido.");
console.log("OK contacto: valida correo y teléfono opcionales");

assert.equal(Boolean(getProviderFieldErrors(providerFixture({rut: ""})).rut), true);
assert.equal(Boolean(getProviderFieldErrors(providerFixture({razonSocial: ""})).razonSocial), true);
assert.equal(Boolean(getProviderFieldErrors(providerFixture({diasCredito: "1.5"})).diasCredito), true);
assert.equal(Boolean(getProviderFieldErrors(providerFixture({diasCredito: "-1"})).diasCredito), true);
console.log("OK campos: RUT, razón social y días de crédito");

assert.equal(
  Boolean(getProviderFieldErrors(providerFixture({regionCodigo: "01", comunaCodigo: "13101"}), TERRITORY_CATALOG).comunaCodigo),
  true
);
assert.equal(
  Boolean(getProviderFieldErrors(providerFixture({regionCodigo: "", comunaCodigo: "13101"}), TERRITORY_CATALOG).regionCodigo),
  true
);
console.log("OK territorio: comuna debe pertenecer a la región");

assert.equal(matchesProviderSearch(normalized, "industrial sur"), true);
assert.equal(matchesProviderSearch(normalized, "12.345.678"), true);
assert.equal(matchesProviderSearch(normalized, "sin coincidencia"), false);
console.log("OK búsqueda: razón social, fantasía y RUT");

const payload = buildProviderMutationPayload({
  ...providerFixture(),
  proveedorId: "ignorado-por-constructor",
  negocioId: "otro-negocio",
  estado: "archivado",
  rutNormalizado: "00000000-0",
});
assert.deepEqual(Object.keys(payload).sort(), [
  "comunaCodigo",
  "comunaNombre",
  "condicionesPago",
  "diasCredito",
  "direccion",
  "email",
    "giro",
    "identificadorFiscalTipo",
    "identificadorFiscalValor",
  "nombreFantasia",
    "notas",
    "paisCodigo",
  "personaContacto",
  "razonSocial",
  "regionCodigo",
  "regionNombre",
  "telefono",
].sort());
assert.equal(Object.hasOwn(payload, "proveedorId"), false);
assert.equal(Object.hasOwn(payload, "negocioId"), false);
assert.equal(Object.hasOwn(payload, "rutNormalizado"), false);
assert.equal(Object.hasOwn(payload, "estado"), false);
console.log("OK payload: contiene exclusivamente campos editables");

const adapted = adaptStoredProvider({
  ...providerFixture(),
  id: "provider-1",
  proveedorId: "provider-1",
  negocioId: "business-1",
  estado: "archivado",
});
assert.equal(adapted.proveedorId, "provider-1");
assert.equal(adapted.estado, "archivado");
assert.equal(Object.hasOwn(adapted, "supplierId"), false);
console.log("OK documento: proveedorId canónico y estado adaptado");

assert.equal(canReadProviders("MEMBER"), true);
assert.equal(canManageProviders("MEMBER"), false);
assert.equal(canManageProviders("ADMIN"), true);
assert.equal(canManageProviders("OWNER"), true);
assert.equal(canManageProviders("COMPRAS"), true);
assert.equal(canReadProviders("VENTAS"), false);
console.log("OK roles UI: COMPRAS administra y VENTAS queda fuera");

const sourceService = fs.readFileSync("src/services/providerService.js", "utf8");
const sourceManager = fs.readFileSync(
  "src/features/providers/ProvidersManager.jsx",
  "utf8"
);
const sourceForm = fs.readFileSync(
  "src/features/providers/ProviderFormDialog.jsx",
  "utf8"
);
const sourceRules = fs.readFileSync("firestore.rules", "utf8");
const sourcePersistence = fs.readFileSync(
  "functions/providerPersistence.js",
  "utf8"
);
assert.match(sourceService, /where\("negocioId", "==", normalizedBusinessId\)/);
assert.doesNotMatch(sourceService, /providerRutKeys/);
assert.match(sourceManager, /loadSequenceRef/);
assert.match(sourceManager, /setProviders\(\[\]\)/);
assert.match(sourceManager, /No hay proveedores registrados/);
assert.match(sourceManager, /canManage &&/);
assert.match(sourceForm, /initialFocusRef=\{firstInputRef\}/);
assert.match(sourceForm, /getCommuneByCode/);
assert.match(sourceRules, /match \/proveedores\/\{proveedorId\}/);
assert.match(sourceRules, /match \/providerRutKeys\/\{rutKey\}/);
assert.match(sourcePersistence, /PURCHASE_WRITE_ROLES: AUTHORIZED_ROLES/);
assert.match(sourcePersistence, /collection\("providerCreateRequests"\)/);
console.log("OK contrato: servicio, cambio de negocio, UI, Rules y backend autoritativo");

console.log("PROVIDER_MODEL_SMOKE_OK");
