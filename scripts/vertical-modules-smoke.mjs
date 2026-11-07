import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import * as frontendRegistry from "../src/domain/verticalModules.mjs";
import {BUSINESS_MODULES} from "../src/domain/rbac.mjs";

const require = createRequire(import.meta.url);
const backendRegistry = require("../functions/verticalModules.js");
const verticalModulesPath = require.resolve("../functions/verticalModules.js");

// 1. Registro: Veterinaria está integrada y las dos copias son idénticas.
const expectedRegistry = [
  {
    id: "veterinaria",
    label: "Clínica veterinaria",
    basePath: "/clinica-veterinaria",
  },
];

assert.deepEqual(frontendRegistry.VERTICAL_MODULES, expectedRegistry);
assert.deepEqual(backendRegistry.VERTICAL_MODULES, expectedRegistry);
assert.equal(Object.isFrozen(frontendRegistry.VERTICAL_MODULES), true);
assert.equal(Object.isFrozen(backendRegistry.VERTICAL_MODULES), true);
assert.deepEqual(
  frontendRegistry.VERTICAL_MODULES.map((item) => item.id).filter((id) => BUSINESS_MODULES.includes(id)),
  [],
  "un modulo vertical no puede estar tambien en BUSINESS_MODULES"
);

const sample = [
  {id: "taller", label: "Taller", basePath: "/taller"},
  {id: "veterinaria", label: "Clinica veterinaria", basePath: "/clinica-veterinaria"},
];
const inputs = [
  undefined, null, "taller", 7, {}, [], ["taller"], ["veterinaria", "taller"],
  ["taller", "taller", "veterinaria"], ["x", "taller", "", null, 4, "veterinaria", "x"],
  ["Taller", " taller"], ["__proto__", "constructor", "taller"],
];
for (const input of inputs) {
  assert.deepEqual(
    frontendRegistry.normalizeEnabledModules(input, sample),
    backendRegistry.normalizeEnabledModules(input, sample),
    `paridad normalizeEnabledModules ${JSON.stringify(input)}`
  );
  const expectedRealModules =
    Array.isArray(input) && input.includes("veterinaria")
      ? ["veterinaria"]
      : [];
  assert.deepEqual(
    frontendRegistry.normalizeEnabledModules(input),
    expectedRealModules,
    "el registro real conserva solo Veterinaria"
  );
  assert.deepEqual(
    backendRegistry.normalizeEnabledModules(input),
    expectedRealModules
  );
}
assert.deepEqual(frontendRegistry.normalizeEnabledModules(["veterinaria", "taller", "taller", "x"], sample), ["taller", "veterinaria"]);
for (const id of ["taller", "veterinaria", "x", "", null, undefined, "__proto__"]) {
  assert.equal(
    frontendRegistry.isKnownVerticalModule(id, sample),
    backendRegistry.isKnownVerticalModule(id, sample),
    `paridad isKnownVerticalModule ${String(id)}`
  );
  assert.equal(frontendRegistry.isKnownVerticalModule(id), id === "veterinaria");
  assert.equal(backendRegistry.isKnownVerticalModule(id), id === "veterinaria");
}
assert.equal(frontendRegistry.isKnownVerticalModule("taller", sample), true);

// Paridad textual: el mismo codigo salvo la sintaxis de exportacion.
const functionsBlock = (source) => {
  const start = source.indexOf("const VERTICAL_MODULES");
  // El bloque espejo termina en module.exports (Functions) o en el marcador de
  // las funciones solo-frontend (src).
  const cuts = [source.indexOf("\nmodule.exports"), source.indexOf("\n// --- Solo frontend")].filter((index) => index !== -1);
  const end = cuts.length ? Math.min(...cuts) : source.length;
  return source.slice(start, end).replace(/^export /gm, "").replace(/\s+$/g, "");
};
assert.equal(
  functionsBlock(readFileSync(new URL("../src/domain/verticalModules.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n")),
  functionsBlock(readFileSync(new URL("../functions/verticalModules.js", import.meta.url), "utf8").replace(/\r\n/g, "\n")),
  "las dos copias del registro deben tener el mismo contenido"
);
console.log("OK registro de modulos verticales: Veterinaria integrada y con paridad entre copias");

// 2. Helper de acceso.
const {MODULE_DISABLED_MESSAGE, assertBusinessModuleEnabled} = require("../functions/moduleAccess.js");
class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
assert.equal(MODULE_DISABLED_MESSAGE, "Este módulo no está habilitado para tu empresa.");
const snapshotOf = (data) => ({exists: true, data: () => data});
const blocked = (snapshot, moduleId) => {
  try { assertBusinessModuleEnabled(snapshot, moduleId, FakeHttpsError); } catch (error) {
    assert.equal(error.code, "failed-precondition");
    assert.equal(error.message, MODULE_DISABLED_MESSAGE);
    return true;
  }
  return false;
};
assert.equal(blocked(snapshotOf({}), "taller"), true, "campo ausente = deshabilitado");
assert.equal(blocked(snapshotOf({modulosHabilitados: []}), "taller"), true);
assert.equal(blocked(snapshotOf({modulosHabilitados: "taller"}), "taller"), true, "no-arreglo = deshabilitado");
assert.equal(blocked(snapshotOf({modulosHabilitados: ["veterinaria"]}), "taller"), true);
assert.equal(blocked(snapshotOf({modulosHabilitados: ["taller"]}), ""), true, "id vacio nunca habilita");
assert.equal(blocked(null, "taller"), true);
assert.equal(blocked(snapshotOf({modulosHabilitados: ["taller", "veterinaria"]}), "taller"), false);
console.log("OK assertBusinessModuleEnabled: ausente, vacio y distinto bloquean; habilitado pasa");

// 3. requireBusinessAccess y getBusinessSession con un registro de prueba
// inyectado en la cache de modulos (el registro real del Core esta vacio).
require.cache[verticalModulesPath] = {
  id: verticalModulesPath,
  filename: verticalModulesPath,
  loaded: true,
  exports: {
    VERTICAL_MODULES: sample,
    isKnownVerticalModule: (id) => backendRegistry.isKnownVerticalModule(id, sample),
    normalizeEnabledModules: (list) => backendRegistry.normalizeEnabledModules(list, sample),
  },
};
const {getBusinessSessionHandler, requireBusinessAccess} = require("../functions/businessOnboarding.js");

function createFakeDb(documents) {
  const reads = [];
  const writes = [];
  const reference = (path) => ({
    path,
    id: path.split("/").at(-1),
    collection: (name) => ({doc: (id) => reference(`${path}/${name}/${id}`)}),
    get: async () => {
      reads.push(path);
      const data = documents.get(path);
      return {exists: data !== undefined, id: path.split("/").at(-1), data: () => data};
    },
    set: async (value) => { writes.push([path, value]); },
  });
  return {
    reads,
    writes,
    collection: (name) => ({
      doc: (id) => reference(`${name}/${id}`),
      where: () => ({
        get: async () => ({
          docs: [...documents.entries()]
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([path, data]) => ({id: path.split("/").at(-1), data: () => data})),
        }),
      }),
    }),
  };
}

const uid = "user-1";
const businessId = "business-1";
const buildDocuments = (businessPatch = {}) => new Map([
  [`usuarios/${uid}`, {negocioActivoId: businessId}],
  [`membresias/${businessId}__${uid}`, {uid, negocioId: businessId, rol: "OWNER", estado: "activo"}],
  [`negocios/${businessId}`, {
    estado: "activo", nombreComercial: "Empresa", verificacionEmpresa: {estado: "VERIFICADA"}, ...businessPatch,
  }],
]);
const access = async (businessPatch, options) => {
  const db = createFakeDb(buildDocuments(businessPatch));
  const request = {auth: {uid}, data: {businessId}};
  try {
    const context = await requireBusinessAccess(request, {db, HttpsError: FakeHttpsError}, options);
    return {ok: true, context, reads: db.reads.length};
  } catch (error) {
    return {ok: false, error, reads: db.reads.length};
  }
};

const withoutOption = await access({}, {});
assert.equal(withoutOption.ok, true, "sin la opcion el comportamiento no cambia");
const withoutOptionEmpty = await access({modulosHabilitados: []}, {});
assert.equal(withoutOptionEmpty.ok, true);
const missingField = await access({}, {requiredVerticalModule: "taller"});
assert.equal(missingField.ok, false);
assert.equal(missingField.error.code, "failed-precondition");
assert.equal(missingField.error.message, MODULE_DISABLED_MESSAGE);
const emptyField = await access({modulosHabilitados: []}, {requiredVerticalModule: "taller"});
assert.equal(emptyField.ok, false);
assert.equal(emptyField.error.message, MODULE_DISABLED_MESSAGE);
const otherModule = await access({modulosHabilitados: ["veterinaria"]}, {requiredVerticalModule: "taller"});
assert.equal(otherModule.ok, false);
const enabled = await access({modulosHabilitados: ["taller"]}, {requiredVerticalModule: "taller"});
assert.equal(enabled.ok, true);
assert.equal(enabled.context.businessId, businessId);
assert.equal(enabled.reads, withoutOption.reads, "la opcion no agrega lecturas");
const enabledWithoutOption = await access({modulosHabilitados: ["taller"]}, {});
assert.equal(enabledWithoutOption.ok, true);
const suspended = await access({estado: "suspendida", modulosHabilitados: ["taller"]}, {requiredVerticalModule: "taller"});
assert.equal(suspended.ok, false);
assert.notEqual(suspended.error.message, MODULE_DISABLED_MESSAGE, "negocio no disponible se informa primero");
const operational = await access({modulosHabilitados: ["taller"]}, {requiredVerticalModule: "taller", requiresVerifiedBusiness: true});
assert.equal(operational.ok, true);
const unverified = await access(
  {modulosHabilitados: ["taller"], verificacionEmpresa: {estado: "NO_VERIFICADA"}},
  {requiredVerticalModule: "taller", requiresVerifiedBusiness: true}
);
assert.equal(unverified.ok, false);
console.log("OK requireBusinessAccess: sin opcion igual que antes; con opcion bloquea o pasa sin lecturas extra");

const sessionFor = async (businessPatch) => {
  const db = createFakeDb(buildDocuments(businessPatch));
  return getBusinessSessionHandler(
    {auth: {uid, token: {}}},
    {auth: null, db, HttpsError: FakeHttpsError, FieldValue: {serverTimestamp: () => "now", delete: () => "delete"}}
  );
};
const emptySession = await sessionFor({});
assert.deepEqual(emptySession.activeBusiness.modulosHabilitados, []);
assert.deepEqual(emptySession.businesses.map((item) => item.modulosHabilitados), [[]]);
const listedSession = await sessionFor({modulosHabilitados: ["veterinaria", "taller", "taller", "inexistente"]});
assert.deepEqual(listedSession.activeBusiness.modulosHabilitados, ["taller", "veterinaria"]);
assert.deepEqual(listedSession.businesses.map((item) => item.modulosHabilitados), [["taller", "veterinaria"]]);
const malformedSession = await sessionFor({modulosHabilitados: "taller"});
assert.deepEqual(malformedSession.activeBusiness.modulosHabilitados, []);
console.log("OK getBusinessSession: modulosHabilitados normalizado, [] si el campo falta, en activeBusiness y businesses[]");
