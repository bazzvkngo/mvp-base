import {isKnownBusinessPath} from "./rbac.mjs";
import {isPlatformRoute} from "./platformAccess.mjs";

// Rutas que existen en la aplicación para cualquier persona: el inicio, el
// alta de empresa, la consola de plataforma y las del Core/verticales. Una
// ruta que no está aquí es una dirección inexistente (página 404); una que sí
// está pero no se puede abrir (sin sesión o sin permiso) se redirige.
export function isKnownAppPath(pathname = "") {
  const path = String(pathname);
  return path === "/" ||
    path === "/login" ||
    path === "/onboarding" ||
    isPlatformRoute(path) ||
    isKnownBusinessPath(path);
}
