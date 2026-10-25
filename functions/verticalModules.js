"use strict";

// Registro de módulos verticales (Taller, Veterinaria...). Nace vacío en el
// Core: cada vertical agrega aquí su entrada {id, label, basePath} al
// integrarse. No se mezcla con BUSINESS_MODULES, que son los módulos del Core
// siempre activos. Copia exacta en src/domain/verticalModules.mjs.
const VERTICAL_MODULES = Object.freeze([
  { id: "veterinaria", label: "Clínica veterinaria", basePath: "/clinica-veterinaria" },
]);

function isKnownVerticalModule(id, registry = VERTICAL_MODULES) {
  return registry.some((module) => module.id === id);
}

function normalizeEnabledModules(list, registry = VERTICAL_MODULES) {
  const ids = Array.isArray(list) ? list : [];
  return [...new Set(ids)]
    .filter((id) => typeof id === "string" && isKnownVerticalModule(id, registry))
    .sort();
}

module.exports = {
  VERTICAL_MODULES,
  isKnownVerticalModule,
  normalizeEnabledModules,
};
