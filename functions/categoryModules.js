"use strict";

// Módulos verticales que se habilitan al crear un negocio con cierto rubro
// (SPEC 033). Archivo aparte de verticalModules.js: ese archivo tiene una copia
// espejo en src/domain y una prueba de paridad textual, y este mapa es solo de
// Functions. Se evalúa al crear el negocio (SPEC 033) y cuando el rubro cambia
// después (SPEC 039, categoryModulesPatch).
const {VERTICAL_MODULES, normalizeEnabledModules} = require("./verticalModules");

const CATEGORY_MODULES = Object.freeze({
  TALLER_AUTOMOTRIZ: Object.freeze(["taller"]),
  CLINICA_VETERINARIA: Object.freeze(["veterinaria"]),
});

function modulesForCategory(categoryCode, registry = VERTICAL_MODULES) {
  const ids = typeof categoryCode === "string" &&
    Object.prototype.hasOwnProperty.call(CATEGORY_MODULES, categoryCode) ?
    CATEGORY_MODULES[categoryCode] :
    [];
  return normalizeEnabledModules(ids, registry);
}

function categoryCodeOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

// SPEC 039: los módulos son los del rubro, también cuando el rubro cambia después de crear el
// negocio. Devuelve el parche de modulosHabilitados que el llamador mezcla en su transaction.update,
// o {} si el rubro no cambió (un negocio que guarda otros datos conserva su lista tal cual, sea cual
// sea). Si cambió, la lista pasa a ser exactamente modulesForCategory(rubro nuevo): ni conserva los
// del rubro anterior ni suma otros. No borra datos: un módulo que sale de la lista queda oculto y
// bloqueado con sus datos intactos (SPEC 031) y reaparece si el rubro vuelve. Un rubro sin mapeo,
// o sin código (rubro de texto libre), deja []. `currentBusiness` es el documento leído dentro de
// la misma transacción.
function categoryModulesPatch(currentBusiness, nextCategoryCode, registry = VERTICAL_MODULES) {
  const current = categoryCodeOf(currentBusiness?.rubroCodigo);
  const next = categoryCodeOf(nextCategoryCode);
  if (current === next) return {};
  return {modulosHabilitados: modulesForCategory(next, registry)};
}

module.exports = {
  CATEGORY_MODULES,
  categoryModulesPatch,
  modulesForCategory,
};
