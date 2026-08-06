import assert from "node:assert/strict";
import {
  adaptStoredClient,
  buildClientMutationPayload,
  formatChileanRut,
  getClientFieldErrors,
  getClientRutKey,
  isValidChileanRut,
  matchesClientSearch,
  normalizeChileanRut,
  normalizeClientInput,
} from "../src/domain/clientModel.mjs";

assert.equal(normalizeChileanRut("12.345.678-5"), "12345678-5");
assert.equal(normalizeChileanRut(" 12 345 678 5 "), "12345678-5");
assert.equal(formatChileanRut("123456785"), "12.345.678-5");
assert.equal(getClientRutKey("12.345.678-5"), "123456785");
console.log("OK RUT: normalización, formato y clave canónica");

assert.equal(isValidChileanRut("12.345.678-5"), true);
assert.equal(isValidChileanRut("6.000.000-K"), true);
assert.equal(isValidChileanRut("12.345.678-9"), false);
assert.equal(isValidChileanRut("1234"), false);
console.log("OK RUT: acepta dígitos válidos y rechaza RUT inválidos");

const normalized = normalizeClientInput({
  tipoCliente: " EMPRESA ",
  rut: "12.345.678-5",
  nombreRazonSocial: "  Servicios   del Sur SpA  ",
  giro: "Tecnología",
  email: " CONTACTO@EXAMPLE.CL ",
  telefono: "+56 9 1234 5678",
  direccion: "Av. Siempre Viva 123",
  regionCodigo: "13",
  regionNombre: "Metropolitana de Santiago",
  comunaCodigo: "13101",
  comunaNombre: "Santiago",
  personaContacto: "Ana Pérez",
  notas: "Cliente preferente",
});
assert.equal(normalized.tipoCliente, "empresa");
assert.equal(normalized.rut, "12.345.678-5");
assert.equal(normalized.rutNormalizado, "12345678-5");
assert.equal(normalized.nombreRazonSocial, "Servicios del Sur SpA");
assert.equal(normalized.email, "contacto@example.cl");
console.log("OK cliente: normaliza el contrato del documento");

const mutationPayload = buildClientMutationPayload({
  tipoCliente: " EMPRESA ",
  rut: "12.345.678-5",
  nombreRazonSocial: "  Servicios   del Sur SpA  ",
  giro: "Tecnología",
  email: " CONTACTO@EXAMPLE.CL ",
  telefono: "+56 9 1234 5678",
  direccion: "Av. Siempre Viva 123",
  regionCodigo: "13",
  regionNombre: "Metropolitana de Santiago",
  comunaCodigo: "13101",
  comunaNombre: "Santiago",
  personaContacto: "Ana Pérez",
  notas: "Cliente preferente",
});
assert.deepEqual(Object.keys(mutationPayload), [
  "tipoCliente",
  "rut",
  "nombreRazonSocial",
  "giro",
  "email",
  "telefono",
  "direccion",
  "regionCodigo",
  "regionNombre",
  "comunaCodigo",
  "comunaNombre",
  "personaContacto",
  "notas",
]);
assert.equal(Object.hasOwn(mutationPayload, "modeloClienteVersion"), false);
assert.equal(Object.hasOwn(mutationPayload, "rutNormalizado"), false);
assert.equal(Object.hasOwn(mutationPayload, "estado"), false);
assert.equal(Object.hasOwn(mutationPayload, "clienteId"), false);
assert.equal(Object.hasOwn(mutationPayload, "negocioId"), false);
console.log("OK mutación: payload contiene exclusivamente campos editables");

assert.deepEqual(
  Object.keys(getClientFieldErrors({
    tipoCliente: "otro",
    rut: "12.345.678-9",
    nombreRazonSocial: "",
    email: "correo-invalido",
  })).sort(),
  ["email", "nombreRazonSocial", "rut", "tipoCliente"]
);
assert.throws(
  () => normalizeClientInput({ tipoCliente: "persona", rut: "1-9" }),
  (error) => error.code === "client/invalid-data"
);
console.log("OK cliente: valida campos obligatorios y correo");

assert.throws(
  () => normalizeClientInput({
    tipoCliente: "empresa",
    rut: "12.345.678-5",
    nombreRazonSocial: "Cliente inválido",
    giro: {valor: "Servicios"},
  }),
  (error) =>
    error.code === "client/invalid-data" && /debe ser texto/i.test(error.message)
);
assert.throws(
  () => normalizeClientInput({
    tipoCliente: "empresa",
    rut: "12.345.678-5",
    nombreRazonSocial: "Cliente inválido",
    telefono: ["+56", "9"],
  }),
  (error) =>
    error.code === "client/invalid-data" && /debe ser texto/i.test(error.message)
);
assert.throws(
  () => normalizeClientInput({
    tipoCliente: "empresa",
    rut: "12.345.678-5",
    nombreRazonSocial: "Cliente inválido",
    notas: "x".repeat(4001),
  }),
  (error) =>
    error.code === "client/invalid-data" && /4000 caracteres/i.test(error.message)
);
const lengthErrors = getClientFieldErrors({
  tipoCliente: "empresa",
  rut: "12.345.678-5",
  nombreRazonSocial: "Cliente inválido",
  notas: "x".repeat(4001),
});
assert.match(lengthErrors.notas, /4000 caracteres/i);
console.log("OK cliente: rechaza tipos no textuales y excesos sin truncar");

const adapted = adaptStoredClient({
  clientId: "legacy-client-id",
  tipoCliente: "persona",
  rut: "6.000.000-K",
  nombreRazonSocial: "María Muñoz",
  estado: "archivado",
});
assert.equal(adapted.clienteId, "legacy-client-id");
assert.equal(Object.hasOwn(adapted, "clientId"), false);
assert.equal(adapted.estado, "archivado");
assert.equal(matchesClientSearch(adapted, "maria"), true);
assert.equal(matchesClientSearch(adapted, "6000000k"), true);
assert.equal(matchesClientSearch(adapted, "empresa inexistente"), false);
const longSearchResult = matchesClientSearch(adapted, "x".repeat(501));
assert.equal(typeof longSearchResult, "boolean");
assert.doesNotThrow(() => matchesClientSearch(adapted, "x".repeat(800)));
assert.doesNotThrow(() => matchesClientSearch(adapted, null));
assert.doesNotThrow(() => matchesClientSearch(adapted, undefined));
assert.equal(matchesClientSearch(adapted, null), true);
assert.equal(matchesClientSearch(adapted, undefined), true);
console.log("OK compatibilidad: clientId solo se lee como alias y la búsqueda usa nombre/RUT");
console.log("OK búsqueda: entradas extensas, null y undefined son toleradas");

console.log("CLIENT_MODEL_SMOKE_OK");
