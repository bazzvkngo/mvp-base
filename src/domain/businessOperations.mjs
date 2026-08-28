const UNVERIFIED_BUSINESS_PATHS = Object.freeze(["/empresa", "/cuenta"]);

export function normalizeBusinessVerificationState(value) {
  const state = String(value || "").trim().toUpperCase();
  if (state === "EN_REVISION") return "PENDIENTE";
  return ["NO_VERIFICADA", "PENDIENTE", "VERIFICADA", "RECHAZADA"].includes(state)
    ? state
    : "NO_VERIFICADA";
}

function normalizedPath(pathname = "") {
  return String(pathname || "").replace(/\/+$/, "") || "/";
}

export function isUnverifiedBusinessAllowedPath(pathname = "") {
  return UNVERIFIED_BUSINESS_PATHS.includes(normalizedPath(pathname));
}

export function canBusinessOperate(business = {}) {
  const verified = normalizeBusinessVerificationState(
    business.verificacionEmpresa?.estado
  ) === "VERIFICADA";
  if (Object.prototype.hasOwnProperty.call(business, "puedeOperar")) {
    return verified && business.puedeOperar === true;
  }
  return verified;
}

export function canAccessBusinessPathForVerification(business = {}, pathname = "") {
  return canBusinessOperate(business) || isUnverifiedBusinessAllowedPath(pathname);
}

export function filterNavigationForBusinessVerification(
  sections = [],
  business = {}
) {
  if (canBusinessOperate(business)) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        isUnverifiedBusinessAllowedPath(item.to)
      ),
    }))
    .filter((section) => section.items.length > 0);
}

export {UNVERIFIED_BUSINESS_PATHS};
