import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {isSelectableBusinessCategory} from "../src/domain/businessCategorySearch.mjs";
import * as frontendMap from "../src/domain/categoryModules.mjs";

const require = createRequire(import.meta.url);
const {CATEGORY_MODULES, modulesForCategory} = require("../functions/categoryModules.js");
const {VERTICAL_MODULES, normalizeEnabledModules} = require("../functions/verticalModules.js");
const catalog = require("../functions/businessCatalog.json");

// Mapa exacto de la SPEC 033.
assert.deepEqual(
  Object.fromEntries(Object.entries(CATEGORY_MODULES).map(([code, ids]) => [code, [...ids]])),
  {TALLER_AUTOMOTRIZ: ["taller"], CLINICA_VETERINARIA: ["veterinaria"]}
);
assert.equal(Object.isFrozen(CATEGORY_MODULES), true);
for (const ids of Object.values(CATEGORY_MODULES)) {
  assert.equal(Object.isFrozen(ids), true, "las listas del mapa no se pueden mutar");
}

// Todos los ids del mapa existen en el registro real.
const registryIds = VERTICAL_MODULES.map((module) => module.id);
for (const [code, ids] of Object.entries(CATEGORY_MODULES)) {
  assert.ok(ids.length > 0, `${code} mapea al menos un módulo`);
  for (const id of ids) {
    assert.ok(registryIds.includes(id), `${code}: el módulo ${id} existe en VERTICAL_MODULES`);
  }
}

// Todos los códigos del mapa existen en el catálogo y son seleccionables.
for (const code of Object.keys(CATEGORY_MODULES)) {
  const category = catalog.businessCategories.find((item) => item.code === code);
  assert.ok(category, `${code} existe en el catálogo`);
  assert.equal(category.sectorCode, "SERVICIOS_PROYECTOS", code);
  assert.equal(category.catalogVersion, 1, code);
  assert.equal(
    isSelectableBusinessCategory(category, catalog.businessCategoryCatalogVersion),
    true,
    `${code} es seleccionable`
  );
}
// El rubro antiguo sigue retirado y no activa ningún módulo.
const retiredAutomotive = catalog.businessCategories.find((item) => item.code === "AUTOMOTRIZ_MOVILIDAD");
assert.equal(retiredAutomotive.selectable, false);
assert.deepEqual(modulesForCategory("AUTOMOTRIZ_MOVILIDAD"), []);

// Resultado por rubro.
assert.deepEqual(modulesForCategory("TALLER_AUTOMOTRIZ"), ["taller"]);
assert.deepEqual(modulesForCategory("CLINICA_VETERINARIA"), ["veterinaria"]);

// Un rubro sin mapeo (o un valor inválido) devuelve [].
for (const code of [
  "TECNOLOGIA_INFORMATICA", "OTRO_SERVICIO_PROYECTOS", "OTRO", "", "taller_automotriz",
  "CATEGORIA_INEXISTENTE", undefined, null, 7, {}, [], ["TALLER_AUTOMOTRIZ"],
  "__proto__", "constructor", "toString", "hasOwnProperty",
]) {
  assert.deepEqual(modulesForCategory(code), [], `sin mapeo: ${String(code)}`);
}

// El resultado es siempre un arreglo nuevo (no se puede mutar el mapa por fuera).
const first = modulesForCategory("TALLER_AUTOMOTRIZ");
first.push("veterinaria");
assert.deepEqual(modulesForCategory("TALLER_AUTOMOTRIZ"), ["taller"]);
assert.deepEqual([...CATEGORY_MODULES.TALLER_AUTOMOTRIZ], ["taller"]);

// Pasa por normalizeEnabledModules: los ids que el registro no conoce se descartan.
const onlyTaller = [{id: "taller", label: "Taller", basePath: "/taller"}];
const onlyVeterinaria = [{id: "veterinaria", label: "Veterinaria", basePath: "/clinica-veterinaria"}];
assert.deepEqual(modulesForCategory("TALLER_AUTOMOTRIZ", onlyTaller), ["taller"]);
assert.deepEqual(modulesForCategory("CLINICA_VETERINARIA", onlyTaller), []);
assert.deepEqual(modulesForCategory("TALLER_AUTOMOTRIZ", onlyVeterinaria), []);
assert.deepEqual(modulesForCategory("CLINICA_VETERINARIA", onlyVeterinaria), ["veterinaria"]);
assert.deepEqual(modulesForCategory("TALLER_AUTOMOTRIZ", []), []);
assert.deepEqual(
  modulesForCategory("TALLER_AUTOMOTRIZ"),
  normalizeEnabledModules(CATEGORY_MODULES.TALLER_AUTOMOTRIZ)
);

// --- Espejo cliente (src/domain/categoryModules.mjs, SPEC 037): paridad con Functions ---
assert.deepEqual(
  Object.fromEntries(Object.entries(frontendMap.CATEGORY_MODULES).map(([code, ids]) => [code, [...ids]])),
  Object.fromEntries(Object.entries(CATEGORY_MODULES).map(([code, ids]) => [code, [...ids]])),
  "el mapa del cliente es idéntico al de Functions"
);
assert.equal(Object.isFrozen(frontendMap.CATEGORY_MODULES), true);
for (const ids of Object.values(frontendMap.CATEGORY_MODULES)) assert.equal(Object.isFrozen(ids), true);
const parityCodes = [
  ...catalog.businessCategories.map((item) => item.code),
  "", "taller_automotriz", "CATEGORIA_INEXISTENTE", undefined, null, 7, {}, [], ["TALLER_AUTOMOTRIZ"],
  "__proto__", "constructor", "toString", "hasOwnProperty",
];
const parityRegistries = [undefined, onlyTaller, onlyVeterinaria, []];
for (const code of parityCodes) {
  for (const registry of parityRegistries) {
    assert.deepEqual(
      frontendMap.modulesForCategory(code, registry),
      modulesForCategory(code, registry),
      `paridad modulesForCategory ${String(code)}`
    );
  }
}

// getPrimaryVerticalModules: el módulo del rubro, solo si está habilitado.
const primary = frontendMap.getPrimaryVerticalModules;
assert.deepEqual(primary({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["taller"]}), ["taller"]);
assert.deepEqual(primary({rubroCodigo: "CLINICA_VETERINARIA", modulosHabilitados: ["veterinaria"]}), ["veterinaria"]);
assert.deepEqual(
  primary({activeBusiness: {rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["taller"]}}),
  ["taller"],
  "acepta la sesión además del negocio"
);
// Rubro con módulo pero el módulo no está habilitado (el superadmin lo quitó, o negocio antiguo): nada.
assert.deepEqual(primary({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: []}), []);
assert.deepEqual(primary({rubroCodigo: "TALLER_AUTOMOTRIZ"}), []);
assert.deepEqual(primary({rubroCodigo: "CLINICA_VETERINARIA", modulosHabilitados: ["taller"]}), [], "el módulo habilitado no es el del rubro");
// Módulo activado a mano en un negocio de otro rubro: no es principal.
for (const rubroCodigo of [
  "TECNOLOGIA_INFORMATICA", "ELECTRICIDAD_ENERGIA_CLIMATIZACION", "INGENIERIA_CONSULTORIA",
  "OTRO_SERVICIO_PROYECTOS", "OTRO", "TALLER_MECANICO", "AUTOMOTRIZ_MOVILIDAD", "", undefined,
]) {
  assert.deepEqual(
    primary({rubroCodigo, modulosHabilitados: ["taller", "veterinaria"]}),
    [],
    `${String(rubroCodigo)} con módulos a mano no tiene módulo principal`
  );
}
// Un rubro con módulo solo marca el suyo aunque el otro también esté habilitado.
assert.deepEqual(primary({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["veterinaria", "taller"]}), ["taller"]);
assert.deepEqual(primary({rubroCodigo: "CLINICA_VETERINARIA", modulosHabilitados: ["taller", "veterinaria"]}), ["veterinaria"]);
// Entradas inválidas.
for (const input of [undefined, null, "OWNER", 7, {}, [], {activeBusiness: null}, {rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: "taller"}]) {
  assert.deepEqual(primary(input), [], `entrada inválida ${JSON.stringify(input)}`);
}
// Registro inyectado: un id fuera del registro no entra.
assert.deepEqual(primary({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["taller"]}, onlyVeterinaria), []);
assert.deepEqual(primary({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["taller"]}, onlyTaller), ["taller"]);

// --- Rutas del Core ocultas por rubro (SPEC 038, solo frontend: sin copia en Functions) ---
const {CATEGORY_HIDDEN_CORE_PATHS, getHiddenCorePaths} = frontendMap;
assert.deepEqual(
  Object.fromEntries(Object.entries(CATEGORY_HIDDEN_CORE_PATHS).map(([code, paths]) => [code, [...paths]])),
  {TALLER_AUTOMOTRIZ: ["/trabajos"], CLINICA_VETERINARIA: ["/trabajos"]},
  "Taller y Veterinaria ocultan solo Proyectos y trabajos"
);
assert.equal(Object.isFrozen(CATEGORY_HIDDEN_CORE_PATHS), true);
for (const paths of Object.values(CATEGORY_HIDDEN_CORE_PATHS)) assert.equal(Object.isFrozen(paths), true);
// Solo rubros que tienen módulo propio, así que la ocultación siempre va con los ítems del rubro dentro de Operación (SPEC 041).
for (const code of Object.keys(CATEGORY_HIDDEN_CORE_PATHS)) {
  assert.ok(Object.hasOwn(CATEGORY_MODULES, code), `${code} tiene módulo propio`);
}
assert.deepEqual(getHiddenCorePaths({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["taller"]}), ["/trabajos"]);
assert.deepEqual(getHiddenCorePaths({rubroCodigo: "CLINICA_VETERINARIA", modulosHabilitados: ["veterinaria"]}), ["/trabajos"]);
assert.deepEqual(
  getHiddenCorePaths({activeBusiness: {rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["taller"]}}),
  ["/trabajos"],
  "acepta la sesión además del negocio"
);
// Misma condición que la sección principal: sin el módulo del rubro habilitado no se oculta nada.
assert.deepEqual(getHiddenCorePaths({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: []}), []);
assert.deepEqual(getHiddenCorePaths({rubroCodigo: "TALLER_AUTOMOTRIZ"}), []);
assert.deepEqual(getHiddenCorePaths({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["veterinaria"]}), []);
assert.deepEqual(getHiddenCorePaths({rubroCodigo: "CLINICA_VETERINARIA", modulosHabilitados: ["taller"]}), []);
for (const rubroCodigo of [
  "TECNOLOGIA_INFORMATICA", "ELECTRICIDAD_ENERGIA_CLIMATIZACION", "INGENIERIA_CONSULTORIA",
  "OTRO_SERVICIO_PROYECTOS", "OTRO", "TALLER_MECANICO", "AUTOMOTRIZ_MOVILIDAD", "", undefined,
]) {
  assert.deepEqual(
    getHiddenCorePaths({rubroCodigo, modulosHabilitados: ["taller", "veterinaria"]}),
    [],
    `${String(rubroCodigo)}: ni con módulos a mano se oculta nada`
  );
}
for (const input of [undefined, null, "OWNER", 7, {}, [], {activeBusiness: null}, {rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: "taller"}]) {
  assert.deepEqual(getHiddenCorePaths(input), [], `entrada inválida ${JSON.stringify(input)}`);
}
// Los códigos heredados de Object.prototype no cuentan como rubro.
for (const rubroCodigo of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
  assert.deepEqual(getHiddenCorePaths({rubroCodigo, modulosHabilitados: ["taller", "veterinaria"]}), [], rubroCodigo);
}
// Devuelve un arreglo nuevo: no se puede mutar el mapa por fuera.
const hiddenOnce = getHiddenCorePaths({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["taller"]});
hiddenOnce.push("/ventas");
assert.deepEqual(getHiddenCorePaths({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["taller"]}), ["/trabajos"]);
// Registro inyectado: sin el módulo en el registro no hay rubro principal ni ocultación.
assert.deepEqual(getHiddenCorePaths({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["taller"]}, onlyVeterinaria), []);
assert.deepEqual(getHiddenCorePaths({rubroCodigo: "TALLER_AUTOMOTRIZ", modulosHabilitados: ["taller"]}, onlyTaller), ["/trabajos"]);

// --- SPEC 039: el rubro que cambia después recalcula los módulos (categoryModulesPatch) ---
const {categoryModulesPatch} = require("../functions/categoryModules.js");
const patchOf = (currentCode, nextCode, extra = {}, registry) =>
  categoryModulesPatch({rubroCodigo: currentCode, ...extra}, nextCode, registry);
// Taller a otro rubro sin módulo: la lista queda vacía (no conserva "taller").
assert.deepEqual(patchOf("TALLER_AUTOMOTRIZ", "TECNOLOGIA_INFORMATICA", {modulosHabilitados: ["taller"]}), {modulosHabilitados: []});
// ...y de vuelta a Taller: el módulo reaparece.
assert.deepEqual(patchOf("TECNOLOGIA_INFORMATICA", "TALLER_AUTOMOTRIZ", {modulosHabilitados: []}), {modulosHabilitados: ["taller"]});
// Entre rubros con módulo: exactamente los del rubro nuevo (el anterior sale, no se suman).
assert.deepEqual(patchOf("TALLER_AUTOMOTRIZ", "CLINICA_VETERINARIA", {modulosHabilitados: ["taller"]}), {modulosHabilitados: ["veterinaria"]});
assert.deepEqual(patchOf("CLINICA_VETERINARIA", "TALLER_AUTOMOTRIZ", {modulosHabilitados: ["veterinaria"]}), {modulosHabilitados: ["taller"]});
// Módulos activados a mano (taller + veterinaria): al cambiar de rubro se alinean al nuevo.
assert.deepEqual(patchOf("TECNOLOGIA_INFORMATICA", "CLINICA_VETERINARIA", {modulosHabilitados: ["taller", "veterinaria"]}), {modulosHabilitados: ["veterinaria"]});
assert.deepEqual(patchOf("TALLER_AUTOMOTRIZ", "TECNOLOGIA_INFORMATICA", {modulosHabilitados: ["taller", "veterinaria"]}), {modulosHabilitados: []});
// Rubro sin módulo a otro rubro sin módulo (o a OTRO, o a un rubro retirado): [] explícito.
assert.deepEqual(patchOf("TECNOLOGIA_INFORMATICA", "ELECTRICIDAD_ENERGIA_CLIMATIZACION"), {modulosHabilitados: []});
assert.deepEqual(patchOf("TECNOLOGIA_INFORMATICA", "OTRO"), {modulosHabilitados: []});
assert.deepEqual(patchOf("TALLER_AUTOMOTRIZ", "TALLER_MECANICO", {modulosHabilitados: ["taller"]}), {modulosHabilitados: []});
assert.deepEqual(patchOf("TALLER_AUTOMOTRIZ", "AUTOMOTRIZ_MOVILIDAD", {modulosHabilitados: ["taller"]}), {modulosHabilitados: []});
// Un negocio sin campo (antiguo) que cambia a un rubro con módulo lo recibe; a uno sin módulo recibe [].
assert.deepEqual(patchOf("TECNOLOGIA_INFORMATICA", "TALLER_AUTOMOTRIZ"), {modulosHabilitados: ["taller"]});
assert.deepEqual(patchOf(undefined, "CLINICA_VETERINARIA"), {modulosHabilitados: ["veterinaria"]});
// Rubro de texto libre (sin código): el código vacío no mapea nada.
assert.deepEqual(patchOf("TALLER_AUTOMOTRIZ", "", {modulosHabilitados: ["taller"]}), {modulosHabilitados: []});
assert.deepEqual(patchOf("TALLER_AUTOMOTRIZ", undefined, {modulosHabilitados: ["taller"]}), {modulosHabilitados: []});
// Solo cuando el rubro realmente cambia: sin cambio, el parche es {} y la lista guardada no se toca
// (ni siquiera un negocio antiguo o con módulos a mano).
for (const code of ["TALLER_AUTOMOTRIZ", "CLINICA_VETERINARIA", "TECNOLOGIA_INFORMATICA", "OTRO", "TALLER_MECANICO"]) {
  assert.deepEqual(patchOf(code, code, {modulosHabilitados: ["taller", "veterinaria"]}), {}, `${code} sin cambio de rubro`);
  assert.deepEqual(patchOf(code, code), {}, `${code} sin cambio y sin campo`);
}
assert.deepEqual(patchOf(undefined, undefined), {}, "sin rubro antes ni después");
assert.deepEqual(patchOf(undefined, ""), {}, "rubro ausente equivale a código vacío");
assert.deepEqual(patchOf("", undefined), {});
assert.deepEqual(patchOf(" TALLER_AUTOMOTRIZ ", "TALLER_AUTOMOTRIZ"), {}, "espacios no cuentan como cambio");
// Entradas inválidas: sin documento o con tipos raros no lanza y se comporta como "sin rubro".
for (const business of [undefined, null, {}, "x", 7, []]) {
  assert.deepEqual(categoryModulesPatch(business, "TALLER_AUTOMOTRIZ"), {modulosHabilitados: ["taller"]});
  assert.deepEqual(categoryModulesPatch(business, "TECNOLOGIA_INFORMATICA"), {modulosHabilitados: []});
  assert.deepEqual(categoryModulesPatch(business, ""), {});
}
for (const next of [7, {}, [], null, ["TALLER_AUTOMOTRIZ"], "__proto__", "constructor"]) {
  assert.deepEqual(categoryModulesPatch({rubroCodigo: "TALLER_AUTOMOTRIZ"}, next), {modulosHabilitados: []}, `rubro nuevo inválido ${JSON.stringify(next)}`);
}
// El resultado es un arreglo nuevo y el parche es solo el campo de módulos (no borra nada más).
const patch = patchOf("TECNOLOGIA_INFORMATICA", "TALLER_AUTOMOTRIZ");
assert.deepEqual(Object.keys(patch), ["modulosHabilitados"]);
patch.modulosHabilitados.push("veterinaria");
assert.deepEqual(patchOf("TECNOLOGIA_INFORMATICA", "TALLER_AUTOMOTRIZ"), {modulosHabilitados: ["taller"]});
// Pasa por el registro: un módulo que el registro no conoce no entra.
assert.deepEqual(patchOf("TECNOLOGIA_INFORMATICA", "TALLER_AUTOMOTRIZ", {}, onlyVeterinaria), {modulosHabilitados: []});
assert.deepEqual(patchOf("TECNOLOGIA_INFORMATICA", "TALLER_AUTOMOTRIZ", {}, onlyTaller), {modulosHabilitados: ["taller"]});
// Ida y vuelta completa sobre el mapa real: el estado final depende solo del rubro actual.
let storedModules = ["taller"];
let storedCategory = "TALLER_AUTOMOTRIZ";
for (const nextCategory of ["CLINICA_VETERINARIA", "TECNOLOGIA_INFORMATICA", "TALLER_AUTOMOTRIZ", "TALLER_AUTOMOTRIZ", "OTRO", "CLINICA_VETERINARIA"]) {
  const applied = categoryModulesPatch({rubroCodigo: storedCategory, modulosHabilitados: storedModules}, nextCategory);
  storedModules = applied.modulosHabilitados ?? storedModules;
  storedCategory = nextCategory;
  assert.deepEqual(storedModules, modulesForCategory(nextCategory), `tras pasar a ${nextCategory} los módulos son los de su rubro`);
}

// Cableado: ambas Functions que escriben el rubro mezclan el parche dentro de su transacción, con el
// documento leído en ella, y las de creación no lo usan (ahí rige modulesForCategory, SPEC 033).
const {readFileSync} = await import("node:fs");
const functionsDir = new URL("../functions/", import.meta.url);
const onboardingSource = readFileSync(new URL("businessOnboarding.js", functionsDir), "utf8");
const settingsSource = readFileSync(new URL("businessSettings.js", functionsDir), "utf8");
const sliceOf = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `bloque ${startMarker}`);
  return source.slice(start, end);
};
const profileHandler = sliceOf(onboardingSource, "async function updateBusinessProfileHandler(", "async function setActiveBusinessHandler(");
assert.match(profileHandler, /transaction\.update\(context\.businessRef, \{[\s\S]*?\.\.\.categoryStoragePatch,[\s\S]*?\.\.\.categoryModulesPatch\(currentBusiness\.data\(\) \|\| \{\}, profileInput\.rubroCodigo\),/);
const informationHandler = sliceOf(settingsSource, "async function updateBusinessInformationHandler(", "async function updateBusinessSettingsHandler(");
assert.match(informationHandler, /transaction\.update\(context\.businessRef, \{[\s\S]*?\.\.\.categoryPatch,[\s\S]*?\.\.\.categoryModulesPatch\(currentBusiness\.data\(\) \|\| \{\}, input\.rubroCodigo\),/);
assert.match(onboardingSource, /const \{categoryModulesPatch, modulesForCategory\} = require\("\.\/categoryModules"\)/);
assert.match(settingsSource, /const \{ categoryModulesPatch \} = require\("\.\/categoryModules"\)/);
assert.equal(onboardingSource.split("categoryModulesPatch(").length - 1, 1, "solo updateBusinessProfile usa el parche en businessOnboarding");
assert.equal(settingsSource.split("categoryModulesPatch(").length - 1, 1, "solo updateBusinessInformation usa el parche en businessSettings");
const settingsHandler = sliceOf(settingsSource, "async function updateBusinessSettingsHandler(", "module.exports");
assert.doesNotMatch(settingsHandler, /categoryModulesPatch|modulosHabilitados/, "updateBusinessSettings no toca los módulos");
// La Function de plataforma y la sección "Módulos" del menú no cambian (SPEC 039).
assert.match(readFileSync(new URL("platformAdmin.js", functionsDir), "utf8"), /async function cambiarModulosEmpresaPlataformaHandler\(request, dependencies\)/);
assert.match(readFileSync(new URL("../src/app/navigation.js", import.meta.url), "utf8"), /\[\{label: "Módulos", items: rest\.map\(buildModuleEntry\)\}\]/);
console.log("OK recálculo al cambiar el rubro (SPEC 039): Taller a otro rubro y de vuelta, rubro sin módulo, sin cambio no toca, cableado en ambas Functions");

console.log("OK mapa rubro a módulos: ids en el registro, códigos seleccionables, sin mapeo devuelve [] e ids desconocidos se descartan");
