export const PLATFORM_SUPERADMIN = "PLATFORM_SUPERADMIN";

export function hasPlatformSuperadminClaim(claims = {}) {
  return claims.platformRole === PLATFORM_SUPERADMIN;
}

export function isPlatformRoute(pathname = "") {
  return /^\/admin(?:\/|$)/.test(String(pathname));
}

export const PLATFORM_HOME_PATH = "/admin/dashboard";

// Superadmin de plataforma sin negocio (needsOnboarding): no tiene ERP al que ir, así que
// toda ruta fuera de /admin (raíz, /login, /onboarding y el comodín) lleva a la consola.
// Devuelve null (sin redirigir) para un usuario normal, para un superadmin que sí tiene
// negocio y mientras platformAccess no está resuelto (null/undefined).
export function resolvePlatformOnlyRedirect({platformAccess, needsOnboarding, pathname} = {}) {
  if (platformAccess?.isSuperadmin !== true) return null;
  if (needsOnboarding !== true) return null;
  if (isPlatformRoute(pathname)) return null;
  return PLATFORM_HOME_PATH;
}
