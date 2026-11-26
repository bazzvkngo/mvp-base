// Espejo cliente del mapa rubro -> módulos verticales de functions/categoryModules.js
// (SPEC 033). El servidor lo usa solo al crear el negocio; el cliente lo usa para
// saber qué módulo habilitado es "el del rubro" y mostrarlo como sección principal
// del menú (SPEC 037). La paridad con el de Functions la cubre
// scripts/category-modules-smoke.mjs.
import {
  VERTICAL_MODULES,
  getEnabledVerticalModules,
  normalizeEnabledModules,
} from "./verticalModules.mjs";

export const CATEGORY_MODULES = Object.freeze({
  TALLER_AUTOMOTRIZ: Object.freeze(["taller"]),
  CLINICA_VETERINARIA: Object.freeze(["veterinaria"]),
});

export function modulesForCategory(categoryCode, registry = VERTICAL_MODULES) {
  const ids = typeof categoryCode === "string" &&
    Object.prototype.hasOwnProperty.call(CATEGORY_MODULES, categoryCode) ?
    CATEGORY_MODULES[categoryCode] :
    [];
  return normalizeEnabledModules(ids, registry);
}

// --- Solo frontend: sin copia en functions/categoryModules.js ---

// Módulos verticales del rubro del negocio que además están habilitados: los que
// el menú muestra como sección principal. Acepta la sesión ({activeBusiness}) o el
// negocio activo directo, igual que getEnabledVerticalModules. Un módulo activado
// a mano en un negocio de otro rubro no entra aquí (sigue bajo "Módulos"), y un
// rubro sin mapeo devuelve [].
export function getPrimaryVerticalModules(session, registry = VERTICAL_MODULES) {
  const business = session?.activeBusiness ?? session;
  const ofCategory = modulesForCategory(business?.rubroCodigo, registry);
  if (!ofCategory.length) return [];
  const enabled = getEnabledVerticalModules(business, registry);
  return ofCategory.filter((id) => enabled.includes(id));
}

// Rutas del Core que el rubro no usa y el menú no muestra (SPEC 038). Taller y Veterinaria
// trabajan con órdenes de trabajo y atenciones, no con "Proyectos y trabajos". Solo oculta el
// menú: la ruta, los permisos, las reglas y las Functions no cambian, porque un negocio puede
// tener proyectos, cotizaciones o ventas con proyecto de antes.
export const CATEGORY_HIDDEN_CORE_PATHS = Object.freeze({
  TALLER_AUTOMOTRIZ: Object.freeze(["/trabajos"]),
  CLINICA_VETERINARIA: Object.freeze(["/trabajos"]),
});

// Rutas del Core ocultas para el negocio. Misma condición que la sección principal del menú
// (getPrimaryVerticalModules): el rubro tiene módulo propio Y ese módulo está habilitado.
// Un módulo activado a mano en otro rubro, un rubro sin mapeo, una sesión sin negocio y
// cualquier entrada inválida devuelven [] (el menú queda como siempre).
export function getHiddenCorePaths(session, registry = VERTICAL_MODULES) {
  const business = session?.activeBusiness ?? session;
  if (!getPrimaryVerticalModules(business, registry).length) return [];
  const code = business?.rubroCodigo;
  return Object.prototype.hasOwnProperty.call(CATEGORY_HIDDEN_CORE_PATHS, code) ?
    [...CATEGORY_HIDDEN_CORE_PATHS[code]] :
    [];
}
