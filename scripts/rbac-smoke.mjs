import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {
  ASSIGNABLE_BUSINESS_ROLES,
  BUSINESS_PERMISSIONS,
  BUSINESS_MODULES,
  BUSINESS_ROLES,
  canAccessBusinessPath,
  filterNavigationSections,
  getBusinessPathOptions,
  getDefaultBusinessPath,
  hasBusinessPermission,
} from "../src/domain/rbac.mjs";

const require = createRequire(import.meta.url);
const backendRbac = require("../functions/rbac.js");
const {crearVentaHandler} = require("../functions/salePersistence.js");
const {crearCompraHandler} = require("../functions/purchasePersistence.js");
const {obtenerBalanceTrabajoHandler} = require("../functions/workBalance.js");

assert.deepEqual(ASSIGNABLE_BUSINESS_ROLES, ["ADMIN", "VENTAS", "COMPRAS", "TECNICO", "FINANZAS", "MEMBER"]);
assert.ok(BUSINESS_ROLES.includes("MEMBER"));
assert.ok(ASSIGNABLE_BUSINESS_ROLES.includes("MEMBER"));
assert.ok(!BUSINESS_ROLES.includes("PLATFORM_SUPERADMIN"));
assert.deepEqual(backendRbac.BUSINESS_ROLES, BUSINESS_ROLES);
console.log("OK RBAC: perfiles predefinidos compatibles y Colaborador asignable");

const P = BUSINESS_PERMISSIONS;
assert.equal(hasBusinessPermission("VENTAS", P.SALES_WRITE), true);
assert.equal(hasBusinessPermission("VENTAS", P.PURCHASES_READ), false);
assert.equal(hasBusinessPermission("COMPRAS", P.PURCHASES_WRITE), true);
assert.equal(hasBusinessPermission("COMPRAS", P.SALES_READ), false);
assert.equal(hasBusinessPermission("TECNICO", P.WORKS_OPERATE), true);
assert.equal(hasBusinessPermission("TECNICO", P.PROFITABILITY_READ), false);
// Decisión de Bruno: el técnico ve costos de inventario, y nada más que eso.
assert.equal(hasBusinessPermission("TECNICO", P.INVENTORY_COSTS_READ), true);
for (const permission of [P.INVENTORY_WRITE, P.PURCHASES_READ, P.PURCHASES_WRITE, P.SALES_READ, P.FINANCE_READ, P.REPORTS_READ, P.PRICING_READ]) {
  assert.equal(hasBusinessPermission("TECNICO", permission), false, `TECNICO no debe tener ${permission}`);
}
assert.equal(hasBusinessPermission("VENTAS", P.INVENTORY_COSTS_READ), false, "VENTAS sigue sin costos de inventario");
assert.equal(canAccessBusinessPath("TECNICO", "/inventario"), true);
assert.equal(canAccessBusinessPath("TECNICO", "/compras"), false);
assert.equal(canAccessBusinessPath("TECNICO", "/ordenes-compra"), false);
assert.equal(canAccessBusinessPath("TECNICO", "/ventas"), false);
// Un perfil por módulos no hereda el permiso del rol.
assert.equal(hasBusinessPermission({role: "TECNICO", profileId: "p", modules: ["inventario"]}, P.INVENTORY_COSTS_READ), false);
// El historial de adquisiciones de la ficha de Inventario sigue la regla de
// adquisicionesInventario: la lista de roles se lee de firestore.rules y debe
// coincidir con quienes tienen PURCHASES_READ, que es lo que usa la interfaz.
const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const acquisitionRead = rulesSource.match(/match \/adquisicionesInventario\/\{adquisicionId\} \{\s*allow read: if hasBusinessModuleAccess\(businessId, \[([^\]]*)\]/);
assert.ok(acquisitionRead, "no se encontró la regla de lectura de adquisicionesInventario");
const acquisitionRoles = [...acquisitionRead[1].matchAll(/"([A-Z]+)"/g)].map((match) => match[1]).sort();
assert.deepEqual(BUSINESS_ROLES.filter((role) => hasBusinessPermission(role, P.PURCHASES_READ)).sort(), acquisitionRoles);
assert.equal(acquisitionRoles.includes("TECNICO"), false);
const inventorySource = readFileSync(new URL("../src/features/inventory/InventoryManager.jsx", import.meta.url), "utf8");
assert.match(inventorySource, /const canReadAcquisitions = canReadCosts && hasBusinessPermission\(role, BUSINESS_PERMISSIONS\.PURCHASES_READ\)/);
assert.match(inventorySource, /if \(!businessId \|\| !canReadAcquisitions \|\|/, "sin permiso no se consulta adquisiciones");
assert.match(inventorySource, /showCosts=\{canReadCosts\} showAcquisitions=\{canReadAcquisitions\}/);
assert.match(inventorySource, /\{showAcquisitions && adapted\.tipoItem === "producto" && <AcquisitionHistory/);
assert.match(inventorySource, /\{showCosts && <Detail label="Costo promedio neto"/, "el técnico sigue viendo los costos de la ficha");
assert.equal(/\{showCosts && adapted\.tipoItem === "producto" && <AcquisitionHistory/.test(inventorySource), false);
assert.equal(hasBusinessPermission("TECNICO", P.INVENTORY_COSTS_READ) && !hasBusinessPermission("TECNICO", P.PURCHASES_READ), true, "TECNICO ve costos pero no el historial");
assert.equal(hasBusinessPermission("FINANZAS", P.PROFITABILITY_READ), true);
assert.equal(hasBusinessPermission("FINANZAS", P.COMPANY_WRITE), false);
assert.equal(hasBusinessPermission("MEMBER", P.CLIENTS_READ), true);
assert.equal(hasBusinessPermission("MEMBER", P.CLIENTS_WRITE), false);
console.log("OK RBAC: matriz mínima por dominio y compatibilidad MEMBER");

assert.equal(canAccessBusinessPath("VENTAS", "/ventas/nueva"), true);
assert.equal(canAccessBusinessPath("VENTAS", "/compras"), false);
assert.equal(canAccessBusinessPath("COMPRAS", "/ordenes-compra/nueva"), true);
assert.equal(canAccessBusinessPath("COMPRAS", "/ventas"), false);
assert.equal(canAccessBusinessPath("TECNICO", "/trabajos"), true);
assert.equal(canAccessBusinessPath("TECNICO", "/reportes"), false);
assert.equal(canAccessBusinessPath("FINANZAS", "/reportes"), true);
assert.equal(canAccessBusinessPath("FINANZAS", "/empresa"), false);
assert.equal(getDefaultBusinessPath("OWNER"), "/reportes");
assert.equal(getDefaultBusinessPath("ADMIN"), "/reportes");
assert.equal(getDefaultBusinessPath("FINANZAS"), "/reportes");
assert.equal(getDefaultBusinessPath("VENTAS"), "/cotizaciones");
assert.equal(getDefaultBusinessPath("COMPRAS"), "/ordenes-compra");
assert.equal(getDefaultBusinessPath("TECNICO"), "/trabajos");
assert.equal(getDefaultBusinessPath("MEMBER"), "/cotizaciones");
for (const role of BUSINESS_ROLES) {
  assert.equal(canAccessBusinessPath(role, getDefaultBusinessPath(role)), true);
}
console.log("OK RBAC: rutas y redirecciones seguras por rol");

const customAccess = {role: "MEMBER", profileId: "profile-1", modules: ["clientes", "ventas"]};
assert.deepEqual(BUSINESS_MODULES.slice(0, 3), ["reportes", "trabajos", "inventario"]);
assert.equal(canAccessBusinessPath(customAccess, "/clientes"), true);
assert.equal(canAccessBusinessPath(customAccess, "/ventas/venta-1"), true);
assert.equal(canAccessBusinessPath(customAccess, "/cotizaciones"), false);
assert.equal(canAccessBusinessPath(customAccess, "/cuenta"), true);
assert.equal(hasBusinessPermission(customAccess, P.CLIENTS_READ), true);
assert.equal(hasBusinessPermission(customAccess, P.CLIENTS_WRITE), false);
assert.equal(getDefaultBusinessPath(customAccess), "/clientes");
assert.equal(getDefaultBusinessPath({role: "MEMBER", profileId: "empty", modules: []}), "/cuenta");
console.log("OK RBAC: perfil personalizado limita módulos y resuelve landing determinista");

// Módulos verticales (SPEC 031). El registro real nace vacío; aquí se inyecta un
// registro de prueba. Su basePath solapa a propósito con /clientes para probar
// la regla completa: el módulo habilitado Y el permiso normal de la ruta
// (clients.read). Las rutas del Core no cambian con el registro vacío.
const testRegistry = Object.freeze([{id: "prueba", label: "Prueba", basePath: "/clientes"}]);
const withModule = {enabledModules: ["prueba"], registry: testRegistry};
const withoutModule = {enabledModules: [], registry: testRegistry};
assert.equal(canAccessBusinessPath({role: "VENTAS"}, "/clientes", {registry: testRegistry}), false, "sin enabledModules queda denegada");
assert.equal(canAccessBusinessPath({role: "VENTAS"}, "/clientes", withoutModule), false, "modulo no habilitado");
assert.equal(canAccessBusinessPath({role: "VENTAS"}, "/clientes", {enabledModules: ["otro"], registry: testRegistry}), false);
assert.equal(canAccessBusinessPath({role: "VENTAS"}, "/clientes", withModule), true, "habilitado mas permiso");
assert.equal(canAccessBusinessPath({role: "VENTAS"}, "/clientes/cliente-1", withModule), true);
assert.equal(canAccessBusinessPath({role: "TECNICO"}, "/clientes", withModule), false, "habilitado pero sin permiso");
assert.equal(canAccessBusinessPath("VENTAS", "/clientes", withModule), false, "acceso en string: vertical denegada");
// Un vertical sin permiso propio en rbac queda denegado aunque este habilitado, y
// los perfiles por modulos nunca lo incluyen.
const isolatedRegistry = Object.freeze([{id: "aislado", label: "Aislado", basePath: "/modulo-aislado"}]);
const isolatedEnabled = {enabledModules: ["aislado"], registry: isolatedRegistry};
assert.equal(canAccessBusinessPath({role: "OWNER"}, "/modulo-aislado", isolatedEnabled), false, "sin permiso en rbac");
assert.equal(canAccessBusinessPath({role: "MEMBER", profileId: "p", modules: ["clientes", "ventas"]}, "/modulo-aislado/x", isolatedEnabled), false, "los perfiles por modulos no incluyen verticales");
assert.equal(canAccessBusinessPath({role: "VENTAS"}, "/ventas", withoutModule), true, "rutas del Core no cambian");
assert.equal(canAccessBusinessPath("VENTAS", "/ventas"), true);
assert.equal(canAccessBusinessPath({role: "OWNER"}, "/reportes", withoutModule), true);
// getDefaultBusinessPath nunca aterriza en un vertical deshabilitado.
const landingRegistry = Object.freeze([{id: "aterrizaje", label: "Aterrizaje", basePath: "/reportes"}]);
assert.equal(getDefaultBusinessPath({role: "OWNER"}, {enabledModules: [], registry: landingRegistry}), "/cuenta");
assert.equal(getDefaultBusinessPath({role: "OWNER"}, {registry: landingRegistry}), "/cuenta");
assert.equal(getDefaultBusinessPath("OWNER", {enabledModules: ["aterrizaje"], registry: landingRegistry}), "/cuenta");
assert.equal(getDefaultBusinessPath({role: "OWNER"}, {enabledModules: ["aterrizaje"], registry: landingRegistry}), "/reportes");
assert.equal(getDefaultBusinessPath({role: "VENTAS"}, {registry: landingRegistry}), "/cotizaciones");
// Menú: el ítem vertical solo aparece habilitado.
const verticalMenu = [{label: "Modulos", items: [{to: "/clientes"}, {to: "/ventas"}]}];
const menuTargets = (options) => filterNavigationSections(verticalMenu, {role: "OWNER"}, options).flatMap((section) => section.items.map((item) => item.to));
assert.deepEqual(menuTargets(withoutModule), ["/ventas"]);
assert.deepEqual(menuTargets(withModule), ["/clientes", "/ventas"]);
// Con el registro real (vacio) nada cambia y las opciones salen de la sesion.
assert.deepEqual(getBusinessPathOptions({modulosHabilitados: ["taller"]}), {enabledModules: []}, "el registro real vacio descarta todo");
assert.deepEqual(getBusinessPathOptions(undefined), {enabledModules: []});
assert.equal(canAccessBusinessPath({role: "OWNER"}, "/clientes", getBusinessPathOptions({role: "OWNER"})), true);
// Ningun vertical entra en BUSINESS_MODULES.
for (const entry of testRegistry) assert.equal(BUSINESS_MODULES.includes(entry.id), false);
assert.equal(BUSINESS_MODULES.includes("taller"), false);
assert.equal(BUSINESS_MODULES.includes("veterinaria"), false);
// Veterinaria: la ruta exige modulo habilitado y permiso clinico.
const veterinaryDisabled = getBusinessPathOptions({
  role: "OWNER",
  modulosHabilitados: [],
});
const veterinaryEnabled = getBusinessPathOptions({
  role: "OWNER",
  modulosHabilitados: ["veterinaria"],
});

assert.equal(
  canAccessBusinessPath({role: "OWNER"}, "/clinica-veterinaria", veterinaryDisabled),
  false,
  "OWNER no accede con veterinaria deshabilitada"
);
assert.equal(
  canAccessBusinessPath({role: "OWNER"}, "/clinica-veterinaria", veterinaryEnabled),
  true,
  "OWNER accede con veterinaria habilitada"
);
assert.equal(
  canAccessBusinessPath({role: "ADMIN"}, "/clinica-veterinaria/pacientes", veterinaryEnabled),
  true,
  "ADMIN accede a rutas internas con veterinaria habilitada"
);
assert.equal(
  canAccessBusinessPath({role: "TECNICO"}, "/clinica-veterinaria", veterinaryEnabled),
  false,
  "TECNICO no tiene permiso clinico"
);
assert.equal(
  canAccessBusinessPath({role: "MEMBER"}, "/clinica-veterinaria", veterinaryEnabled),
  false,
  "MEMBER no tiene permiso clinico"
);

console.log("OK RBAC: Veterinaria exige modulo habilitado y permiso clinico");
console.log("OK RBAC: rutas verticales exigen modulo habilitado ademas del permiso");

function rejectingDependencies(role) {
  return {
    db: {},
    HttpsError: class HttpsError extends Error {},
    requireBusinessAccess: async (_request, _dependencies, {roles = []} = {}) => {
      if (!roles.includes(role)) {
        const error = new Error("denied");
        error.code = "permission-denied";
        throw error;
      }
      throw new Error("La prueba esperaba rechazo antes de validar payload.");
    },
  };
}

await assert.rejects(
  crearCompraHandler({data: {businessId: "business"}}, rejectingDependencies("VENTAS")),
  (error) => error.code === "permission-denied"
);
await assert.rejects(
  crearVentaHandler({data: {businessId: "business"}}, rejectingDependencies("COMPRAS")),
  (error) => error.code === "permission-denied"
);
await assert.rejects(
  obtenerBalanceTrabajoHandler({data: {businessId: "business"}}, rejectingDependencies("TECNICO")),
  (error) => error.code === "permission-denied"
);
console.log("OK RBAC: Functions rechazan cruces VENTAS/COMPRAS y margen para TECNICO");

console.log("RBAC_SMOKE_OK");
