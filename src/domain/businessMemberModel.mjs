import {
  ASSIGNABLE_BUSINESS_ROLES,
  BUSINESS_ROLES,
  BUSINESS_ROLE_LABELS,
} from "./rbac.mjs";

export const BUSINESS_MEMBER_ROLES = BUSINESS_ROLES;
export const MANAGEABLE_BUSINESS_MEMBER_ROLES = ASSIGNABLE_BUSINESS_ROLES;
export const BUSINESS_MEMBER_STATUSES = Object.freeze(["activo", "inactivo"]);

export const BUSINESS_MEMBER_ROLE_LABELS = BUSINESS_ROLE_LABELS;

export const BUSINESS_MEMBER_STATUS_LABELS = Object.freeze({
  activo: "Activo",
  inactivo: "Inactivo",
});

function safeText(value) {
  return String(value || "").trim();
}

export function canReadBusinessMembers(role) {
  return BUSINESS_MEMBER_ROLES.includes(safeText(role).toUpperCase());
}

export function canManageBusinessMembers(role) {
  return ["OWNER", "ADMIN"].includes(safeText(role).toUpperCase());
}

export function adaptBusinessMember(raw = {}) {
  const role = safeText(raw.rol).toUpperCase();
  const status = safeText(raw.estado).toLowerCase();
  return {
    uid: safeText(raw.uid),
    nombre: safeText(raw.nombre) || "Sin nombre registrado",
    correo: safeText(raw.correo) || "Sin correo disponible",
    rol: BUSINESS_MEMBER_ROLES.includes(role) ? role : "MEMBER",
    profileId: safeText(raw.profileId),
    perfilNombre: safeText(raw.perfilNombre),
    estado: BUSINESS_MEMBER_STATUSES.includes(status) ? status : "inactivo",
    fechaIncorporacion: safeText(raw.fechaIncorporacion) || null,
  };
}

export function businessMemberProfileLabel(member = {}) {
  return safeText(member.perfilNombre) ||
    BUSINESS_MEMBER_ROLE_LABELS[member.rol] || "Colaborador";
}

export function normalizeBusinessMemberEmail(value) {
  return safeText(value).toLowerCase();
}

export function isValidBusinessMemberEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeBusinessMemberEmail(value));
}
