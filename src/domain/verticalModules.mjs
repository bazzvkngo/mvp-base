// Registro de módulos verticales (Taller, Veterinaria...). Nace vacío en el
// Core: cada vertical agrega aquí su entrada {id, label, basePath} al
// integrarse. No se mezcla con BUSINESS_MODULES, que son los módulos del Core
// siempre activos. Copia exacta en functions/verticalModules.js.
export const VERTICAL_MODULES = Object.freeze([
  { id: "veterinaria", label: "Clínica veterinaria", basePath: "/clinica-veterinaria" },
]);

export function isKnownVerticalModule(id, registry = VERTICAL_MODULES) {
  return registry.some((module) => module.id === id);
}

export function normalizeEnabledModules(list, registry = VERTICAL_MODULES) {
  const ids = Array.isArray(list) ? list : [];
  return [...new Set(ids)]
    .filter((id) => typeof id === "string" && isKnownVerticalModule(id, registry))
    .sort();
}

// --- Solo frontend: sin copia en functions/verticalModules.js ---

// Módulos verticales habilitados para el negocio activo. Acepta la sesión
// ({activeBusiness}) o el negocio activo directo; cualquier otra forma (un rol
// como string, null) no habilita nada. Se lee al cargar la sesión: no hay
// refresco en vivo.
export function getEnabledVerticalModules(session, registry = VERTICAL_MODULES) {
  const business = session?.activeBusiness ?? session;
  return normalizeEnabledModules(business?.modulosHabilitados, registry);
}
