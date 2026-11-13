"use strict";

const {assertBusinessCanOperate} = require("./businessOperations");
const {resolveBaseTaxSettings} = require("./businessJurisdiction");

// Taller mantiene sus grupos localmente para no extender la matriz RBAC del Core.
const INVENTORY_COSTS_READ_ROLES = Object.freeze([
  "OWNER", "ADMIN", "COMPRAS", "TECNICO", "FINANZAS", "MEMBER",
]);
const PRICING_READ_ROLES = Object.freeze(["OWNER", "ADMIN", "VENTAS", "MEMBER"]);
const TALLER_MANAGEMENT_ROLES = Object.freeze(["OWNER", "ADMIN"]);
const TALLER_CREATION_ROLES = Object.freeze(["OWNER", "ADMIN", "TECNICO"]);
const TALLER_OPERATION_ROLES = Object.freeze(["OWNER", "ADMIN", "TECNICO", "MEMBER"]);

// Profiles select modules, not administrative/financial capabilities (Core contract).
function hasTallerCapability(membership, capability) {
  if (!TALLER_OPERATION_ROLES.includes(membership?.rol)) return false;
  if (membership.profileId) {
    return Boolean(membership.rol === "MEMBER" && membership.modules?.includes("taller") &&
      ["read", "operate"].includes(capability));
  }
  if (["read", "operate"].includes(capability)) return true;
  if (capability === "create") return TALLER_CREATION_ROLES.includes(membership.rol);
  if (["approve", "manage"].includes(capability)) return TALLER_MANAGEMENT_ROLES.includes(membership.rol);
  if (capability === "costs") return INVENTORY_COSTS_READ_ROLES.includes(membership.rol);
  return false;
}

function assertTallerCapability(membership, capability, HttpsError) {
  if (!hasTallerCapability(membership, capability)) {
    throw new HttpsError("permission-denied", "Tu membresía no permite realizar esta acción de Taller.");
  }
}

async function requireTallerAccess(request, dependencies, capability = "read") {
  const roles = capability === "create" ? TALLER_CREATION_ROLES :
    ["approve", "manage"].includes(capability) ? TALLER_MANAGEMENT_ROLES : TALLER_OPERATION_ROLES;
  const context = await dependencies.requireBusinessAccess(request,
    {db: dependencies.db, HttpsError: dependencies.HttpsError},
    {roles, requiresVerifiedBusiness: true, requiredVerticalModule: "taller"});
  assertTallerCapability(context.membership, capability, dependencies.HttpsError);
  return context;
}

// Revalidation participates in the transaction, including retries after revocation.
async function assertFreshTallerAccess(transaction, context, dependencies, capability) {
  const {db, HttpsError} = dependencies;
  const [member, business, user, tax] = await transaction.getAll(
    context.membershipRef, context.businessRef, db.collection("usuarios").doc(context.uid),
    context.businessRef.collection("configuracion").doc("impuestos"));
  let membership = member.data() || {};
  if (!member.exists || membership.uid !== context.uid || membership.negocioId !== context.businessId ||
      membership.estado !== "activo" || user.data()?.estadoPlataforma === "suspendido") {
    throw new HttpsError("permission-denied", "Tu membresía ya no permite operar Taller.");
  }
  if (membership.profileId) {
    const profile = await transaction.get(context.businessRef.collection("perfilesEmpleados").doc(membership.profileId));
    const data = profile.data() || {};
    membership = {...membership, modules: profile.exists && data.negocioId === context.businessId &&
      data.estado === "activo" && Array.isArray(data.modulos) ? data.modulos : []};
  }
  assertTallerCapability(membership, capability, HttpsError);
  const businessData = business.data() || {};
  if (!business.exists || businessData.estado !== "activo" || businessData.eliminadoEn) {
    throw new HttpsError("failed-precondition", "El negocio no está habilitado para operar.");
  }
  assertBusinessCanOperate(businessData, resolveBaseTaxSettings(businessData, tax.data() || {}), HttpsError);
  return membership;
}

module.exports = {
  INVENTORY_COSTS_READ_ROLES,
  PRICING_READ_ROLES,
  TALLER_CREATION_ROLES,
  TALLER_MANAGEMENT_ROLES,
  TALLER_OPERATION_ROLES,
  hasTallerCapability,
  assertTallerCapability,
  requireTallerAccess,
  assertFreshTallerAccess,
};
