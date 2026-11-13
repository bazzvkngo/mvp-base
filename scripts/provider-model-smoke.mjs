import assert from "node:assert/strict";
import fs from "node:fs";
import {
  adaptStoredProvider,
  buildProviderMutationPayload,
  PROVIDER_DELETE_CONFIRMATION_WORD,
  canDeleteProviders,
  canManageProviders,
  isProviderDeleteConfirmed,
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
import {
  formatContactPhoneInput,
  normalizeContactPhone,
} from "../src/domain/contactFormatting.mjs";

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
assert.equal(normalized.telefono, "+56 9 1234 5678");
console.log("OK normalización: texto, correo, crédito y territorio canónico");

assert.equal(isValidProviderEmail("compras@example.cl"), true);
assert.equal(isValidProviderEmail("correo-invalido"), false);
assert.equal(isValidProviderPhone("+56 (9) 1234-5678"), true);
assert.equal(isValidProviderPhone("teléfono secreto"), false);
assert.equal(getProviderFieldErrors(providerFixture({email: "malo"})).email, "Ingresa un correo válido.");
assert.match(getProviderFieldErrors(providerFixture({telefono: "abc"})).telefono, /teléfono chileno válido/i);
assert.equal(formatContactPhoneInput("+56 (9) 6123-4587", "CL"), "+56 9 6123 4587");
assert.equal(normalizeContactPhone("961234587", "CL"), "+56 9 6123 4587");
assert.match(getProviderFieldErrors(providerFixture({telefono: "+56 9 1234 567890"})).telefono, /teléfono chileno válido/i);
assert.deepEqual(getProviderFieldErrors(providerFixture({email: "", telefono: ""})), {});
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

// Eliminación permanente (SPEC 004, enmienda 2026-11-05): solo OWNER y ADMIN, con palabra de confirmación.
for (const role of ["OWNER", "ADMIN", "owner"]) assert.equal(canDeleteProviders(role), true, `${role} elimina`);
for (const role of ["COMPRAS", "MEMBER", "VENTAS", "FINANZAS", "TECNICO", "", undefined]) assert.equal(canDeleteProviders(role), false, `${role} no elimina`);
assert.equal(PROVIDER_DELETE_CONFIRMATION_WORD, "permanente");
assert.equal(isProviderDeleteConfirmed("permanente"), true);
assert.equal(isProviderDeleteConfirmed("  Permanente "), true);
assert.equal(isProviderDeleteConfirmed("perm"), false);
assert.equal(isProviderDeleteConfirmed(""), false);
assert.equal(isProviderDeleteConfirmed(undefined), false);
console.log("OK eliminación: solo OWNER/ADMIN y palabra «permanente»");

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
assert.match(sourceManager, /const \[statusFilter, setStatusFilter\] = useState\("activo"\);/, "el filtro Estado parte en Activos");
assert.match(sourceManager, /\$\{visibleProviders\.length\} de \$\{providers\.length\} proveedores/, "subtítulo N de M proveedores con filtro");
assert.match(sourceForm, /initialFocusRef=\{firstInputRef\}/);
assert.match(sourceForm, /getCommuneByCode/);
assert.match(sourceForm, /onChange=\{handleRutChange\}/);
assert.match(sourceForm, /onChange=\{handlePhoneChange\}/);
assert.doesNotMatch(sourceForm, /client-form-field__optional/);

// Formulario simplificado: 4 campos visibles, resto en el plegable, sin leyendas duplicadas.
assert.match(sourceForm, /import Disclosure from "..\/..\/components\/ui\/Disclosure";/);
assert.match(sourceForm, /title="Más datos del proveedor \(opcional\)"/);
const foldedForm = sourceForm.slice(sourceForm.indexOf("<Disclosure"), sourceForm.indexOf("</Disclosure>"));
assert.ok(foldedForm.length > 0, "el formulario usa el plegable");
for (const field of ["nombreFantasia", "giro", "personaContacto", "direccion", "condicionesPago", "diasCredito", "notas"]) {
  assert.match(foldedForm, new RegExp(`field="${field}"`), `${field} va dentro del plegable`);
}
assert.match(foldedForm, /<ContactTerritoryFields/, "región y comuna van dentro del plegable");
for (const field of ["rut", "razonSocial", "email", "telefono"]) {
  const visible = sourceForm.slice(0, sourceForm.indexOf("<Disclosure"));
  assert.match(visible, new RegExp(`field="${field}"`), `${field} está visible al abrir`);
  assert.doesNotMatch(foldedForm, new RegExp(`field="${field}"`), `${field} NO va plegado`);
}
assert.doesNotMatch(sourceForm, /<legend>Datos del proveedor<\/legend>/, "sin título duplicado");
assert.doesNotMatch(sourceForm, /<legend>(Contacto|Notas)\b/, "sin las leyendas antiguas");
assert.equal((sourceForm.match(/<legend>/g) || []).length, 2, "solo dos sub-leyendas");
assert.match(foldedForm, /<legend>Ubicación<\/legend>/);
assert.match(foldedForm, /<legend>Condiciones comerciales<\/legend>/);
assert.doesNotMatch(sourceForm, /<h[1-6]\b/, "sin encabezados dentro del formulario (el título es el del diálogo)");
assert.equal((sourceForm.match(/<Button\b[^>]*type="submit"/g) || []).length, 1, "un solo botón principal");
assert.match(sourceForm, /diasCredito: "",\s+notas: "",/, "días de crédito vacío por defecto");
assert.doesNotMatch(sourceForm, /diasCredito: "0"/);
assert.match(sourceForm, /values\.condicionesPago === "credito" && \(/, "días de crédito solo con condición Crédito");
assert.match(sourceForm, /hasOptionalContent\(nextValues\)/, "al abrir recalcula si el plegable arranca abierto");
assert.match(sourceForm, /FIELD_ORDER\.find\(\(field\) => nextErrors\[field\]\)/, "el primer error se elige en orden visual");
assert.match(sourceForm, /OPTIONAL_FIELDS\.includes\(firstField\)\) setOptionalOpen\(true\)/, "un error plegado abre el bloque");
assert.match(sourceForm, /setPendingFocus\(firstField\)/);
const interiorCss = fs.readFileSync("src/styles/interior.css", "utf8");
const subsectionRules = [...interiorCss.matchAll(/(\.provider-form-subsection[^{]*)\{([^}]*)\}/g)];
assert.equal(subsectionRules.length, 2, "existen las reglas del sub-grupo");
assert.doesNotMatch(subsectionRules.map((m) => m[2]).join("\n"), /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\d+(px|ms)\b(?!\s*solid)/, "sub-grupo sin literales");
// Días de crédito vacío sigue guardándose como 0 (el modelo no cambia).
assert.equal(normalizeProviderInput(providerFixture({condicionesPago: "credito", diasCredito: ""})).diasCredito, 0);
assert.equal(buildProviderMutationPayload(providerFixture({condicionesPago: "", diasCredito: ""})).diasCredito, 0);
assert.match(sourceRules, /match \/proveedores\/\{proveedorId\}/);
assert.match(sourceRules, /match \/proveedores\/\{proveedorId\}\s*\{[^}]*allow create, update, delete: if false;/, "las Rules siguen sin permitir borrar desde el cliente");

// Eliminación permanente: Function, servicio y UI.
const sourceDeletion = fs.readFileSync("functions/providerDeletion.js", "utf8");
const sourceIndex = fs.readFileSync("functions/index.js", "utf8");
assert.match(sourceIndex, /exports\.eliminarProveedor = onCall\([\s\S]{0,260}eliminarProveedorHandler\(request, providerPersistenceDependencies\)/);
assert.match(sourceDeletion, /roles: BUSINESS_MANAGEMENT_ROLES/, "roles comprobados en el servidor");
assert.match(sourceDeletion, /isDeleteConfirmed\(request\?\.data\?\.confirmacion\)/, "la palabra se exige también en el backend");
assert.match(sourceDeletion, /db\.runTransaction/);
assert.match(sourceDeletion, /transaction\.delete\(proveedorRef\);\s+transaction\.delete\(reservationRef\);/, "borra el proveedor y libera la reserva en la misma transacción");
for (const collectionName of ["ordenesCompra", "compras", "recepciones", "adquisicionesInventario", "inventario"]) {
  assert.match(sourceDeletion, new RegExp(`collection: "${collectionName}"`), `comprueba dependencias en ${collectionName}`);
}
assert.equal((sourceDeletion.match(/"proveedorSnapshot\.proveedorId"/g) || []).length, 4, "comprueba el id directo y el id dentro del snapshot");
assert.match(sourceDeletion, /ultimoProveedor\.proveedorId/);
assert.doesNotMatch(sourceDeletion, /module\.exports[\s\S]*\bdeleteBusiness/);
assert.match(sourceService, /httpsCallable\(functions, "eliminarProveedor"\)/);
assert.match(sourceService, /isProviderDeleteConfirmed\(confirmacion\)/, "el servicio valida la palabra antes de llamar");
assert.match(sourceManager, /canDelete = canDeleteProviders\(role\)/);
assert.match(sourceManager, /\{canDelete && \(/, "el botón solo se muestra con permiso");
assert.match(sourceManager, /Eliminar permanentemente a \$\{provider\.razonSocial\}/);
assert.match(sourceManager, /disabled=\{!isProviderDeleteConfirmed\(deleteConfirmation\)\}/, "el botón rojo exige escribir la palabra");
assert.equal((sourceManager.match(/variant="danger"/g) || []).length, 1, "el diálogo de eliminación tiene un solo botón principal");
const unicodeEscape = new RegExp("\\\\" + "u[0-9a-fA-F]{4}");
assert.doesNotMatch(sourceManager, /#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/, "sin colores literales en la interfaz");
assert.doesNotMatch(sourceManager, unicodeEscape, "sin escapes unicode en la interfaz");
const deleteCss = interiorCss.slice(interiorCss.indexOf(".provider-delete {"), interiorCss.indexOf(".client-confirmation-copy"));
assert.ok(deleteCss.length > 0, "existen los estilos del diálogo de eliminación");
// El grosor de borde de 1px no tiene token en tokens.css: se admite solo en border y sus variantes por lado.
const deleteCssSinBorde1px = deleteCss.replace(/(?<![\w-])(border(?:-(?:top|right|bottom|left|inline|block))?\s*:\s*)1px(?![\w.%-])/g, "$1");
assert.doesNotMatch(deleteCssSinBorde1px, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\d+(px|ms)\b/, "estilos de eliminación sin literales");
assert.match(sourceRules, /match \/providerRutKeys\/\{rutKey\}/);
assert.match(sourcePersistence, /PURCHASE_WRITE_ROLES: AUTHORIZED_ROLES/);
assert.match(sourcePersistence, /collection\("providerCreateRequests"\)/);
console.log("OK contrato: servicio, cambio de negocio, UI, Rules y backend autoritativo");

console.log("PROVIDER_MODEL_SMOKE_OK");
