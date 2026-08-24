import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {
  ASSIGNABLE_BUSINESS_ROLES,
  BUSINESS_PERMISSIONS,
  BUSINESS_ROLES,
  canAccessBusinessPath,
  getDefaultBusinessPath,
  hasBusinessPermission,
} from "../src/domain/rbac.mjs";

const require = createRequire(import.meta.url);
const backendRbac = require("../functions/rbac.js");
const {crearVentaHandler} = require("../functions/salePersistence.js");
const {crearCompraHandler} = require("../functions/purchasePersistence.js");
const {obtenerBalanceTrabajoHandler} = require("../functions/workBalance.js");

assert.deepEqual(ASSIGNABLE_BUSINESS_ROLES, ["ADMIN", "VENTAS", "COMPRAS", "TECNICO", "FINANZAS"]);
assert.ok(BUSINESS_ROLES.includes("MEMBER"));
assert.ok(!ASSIGNABLE_BUSINESS_ROLES.includes("MEMBER"));
assert.ok(!BUSINESS_ROLES.includes("PLATFORM_SUPERADMIN"));
assert.deepEqual(backendRbac.BUSINESS_ROLES, BUSINESS_ROLES);
console.log("OK RBAC: seis roles V1, MEMBER sólo legacy y rol plataforma separado");

const P = BUSINESS_PERMISSIONS;
assert.equal(hasBusinessPermission("VENTAS", P.SALES_WRITE), true);
assert.equal(hasBusinessPermission("VENTAS", P.PURCHASES_READ), false);
assert.equal(hasBusinessPermission("COMPRAS", P.PURCHASES_WRITE), true);
assert.equal(hasBusinessPermission("COMPRAS", P.SALES_READ), false);
assert.equal(hasBusinessPermission("TECNICO", P.WORKS_OPERATE), true);
assert.equal(hasBusinessPermission("TECNICO", P.PROFITABILITY_READ), false);
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
