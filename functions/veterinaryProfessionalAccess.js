"use strict";

const MANAGEMENT_ROLES = ["OWNER", "ADMIN"];
const ASSIGNED_VETERINARY_ACCESS = "veterinaria_asignada";
const isProfileId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value);

function canManageVeterinaryOrders(membership) {
  return MANAGEMENT_ROLES.includes(membership?.rol) && !membership.profileId;
}

async function requireVeterinaryProfessionalAccess(request, {db, HttpsError, requireBusinessAccess}) {
  const access = await requireBusinessAccess(request, {db, HttpsError}, {
    roles: [...MANAGEMENT_ROLES, "MEMBER"],
    moduleId: ASSIGNED_VETERINARY_ACCESS,
    requiredVerticalModule: "veterinaria",
  });
  if (canManageVeterinaryOrders(access.membership)) return {...access, assignedOnly: false};

  const {membership} = access;
  if (membership?.rol !== "MEMBER" || !isProfileId(membership.profileId) ||
      !Array.isArray(membership.modules) || !membership.modules.includes(ASSIGNED_VETERINARY_ACCESS)) {
    throw new HttpsError("permission-denied", "Tu perfil no tiene acceso a Veterinaria.");
  }
  return {...access, assignedOnly: true};
}

function getVeterinaryProfessionalProfileRef(businessRef, membership) {
  return membership?.rol === "MEMBER" && isProfileId(membership.profileId) ?
    businessRef.collection("perfilesEmpleados").doc(membership.profileId) : null;
}

function hasVeterinaryProfile(profile, businessId) {
  return profile?.negocioId === businessId && profile.estado === "activo" &&
    Array.isArray(profile.modulos) && profile.modulos.includes(ASSIGNED_VETERINARY_ACCESS);
}

function isActiveMembership(membership, {businessId, uid}) {
  return membership?.negocioId === businessId && membership.uid === uid && membership.estado === "activo";
}

function canReceiveVeterinaryReferral(membership, profile, {businessId, uid}) {
  return isActiveMembership(membership, {businessId, uid}) && membership.rol === "MEMBER" &&
    isProfileId(membership.profileId) && hasVeterinaryProfile(profile, businessId);
}

function assertAssignableVeterinaryProfessional(membership, profile, context) {
  if (!(isActiveMembership(membership, context) && canManageVeterinaryOrders(membership)) &&
      !canReceiveVeterinaryReferral(membership, profile, context)) {
    throw new context.HttpsError("failed-precondition", "Selecciona un profesional activo con acceso a Veterinaria.");
  }
}

function getVeterinaryProfessionalGrantRefs(context) {
  if (!context.assignedOnly) return [];
  return [context.membershipRef, getVeterinaryProfessionalProfileRef(context.businessRef, context.membership)];
}

function assertCurrentVeterinaryGrant(context, membership, profile) {
  if (!context.assignedOnly) return;
  if (!isActiveMembership(membership, context) || membership.rol !== "MEMBER" ||
      membership.profileId !== context.membership.profileId || !hasVeterinaryProfile(profile, context.businessId)) {
    throw new context.HttpsError("permission-denied", "Tu perfil ya no tiene acceso a Veterinaria.");
  }
}

async function getVeterinaryProfessionalDisplayName(db, uid) {
  const userRef = db.doc("usuarios/" + uid);
  const [profileSnapshot, userSnapshot] = await db.getAll(userRef.collection("cuenta").doc("perfil"), userRef);
  const profile = profileSnapshot.data() ?? {};
  const userData = userSnapshot.data() ?? {};
  const name = [profile.nombres ?? userData.nombres, profile.apellidos ?? userData.apellidos]
    .filter((part) => typeof part === "string").map((part) => part.trim()).filter(Boolean).join(" ");
  if (name) return name.slice(0, 240);
  try {
    const {getAuth} = require("firebase-admin/auth");
    const user = await getAuth().getUser(uid);
    return user.displayName?.trim().slice(0, 240) || "Profesional " + uid;
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    return "Profesional " + uid;
  }
}

module.exports = {
  assertAssignableVeterinaryProfessional,
  assertCurrentVeterinaryGrant,
  canReceiveVeterinaryReferral,
  getVeterinaryProfessionalDisplayName,
  getVeterinaryProfessionalGrantRefs,
  getVeterinaryProfessionalProfileRef,
  requireVeterinaryProfessionalAccess,
};
