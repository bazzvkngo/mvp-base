export const BUSINESS_MEMBER_ROLES = Object.freeze(["OWNER", "ADMIN", "MEMBER"]);
export const MANAGEABLE_BUSINESS_MEMBER_ROLES = Object.freeze(["ADMIN", "MEMBER"]);
export const BUSINESS_MEMBER_STATUSES = Object.freeze(["activo", "inactivo"]);

export const BUSINESS_MEMBER_ROLE_LABELS = Object.freeze({
  OWNER: "Propietario",
  ADMIN: "Administrador",
  MEMBER: "Miembro",
});

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
  return safeText(role).toUpperCase() === "OWNER";
}

export function adaptBusinessMember(raw = {}) {
  const role = safeText(raw.rol).toUpperCase();
  const status = safeText(raw.estado).toLowerCase();
  return {
    uid: safeText(raw.uid),
    nombre: safeText(raw.nombre) || "Sin nombre registrado",
    correo: safeText(raw.correo) || "Sin correo disponible",
    rol: BUSINESS_MEMBER_ROLES.includes(role) ? role : "MEMBER",
    estado: BUSINESS_MEMBER_STATUSES.includes(status) ? status : "inactivo",
    fechaIncorporacion: safeText(raw.fechaIncorporacion) || null,
  };
}

export function normalizeBusinessMemberEmail(value) {
  return safeText(value).toLowerCase();
}

export function isValidBusinessMemberEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeBusinessMemberEmail(value));
}
