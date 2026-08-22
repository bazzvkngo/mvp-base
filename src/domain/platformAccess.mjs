export const PLATFORM_SUPERADMIN = "PLATFORM_SUPERADMIN";

export function hasPlatformSuperadminClaim(claims = {}) {
  return claims.platformRole === PLATFORM_SUPERADMIN;
}

export function isPlatformRoute(pathname = "") {
  return /^\/admin(?:\/|$)/.test(String(pathname));
}
