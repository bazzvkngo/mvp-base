// Traduce errores técnicos (SDK de Firebase, navegador, red, cuota) a mensajes
// en español para la persona. Los mensajes que ya vienen escritos en español
// (HttpsError del servidor o errores propios de la aplicación) se conservan.
import {PASSWORD_POLICY_MESSAGE} from "./passwordPolicy.mjs";

export const GENERIC_ERROR_MESSAGE =
  "No pudimos completar la operación. Revisa tu conexión e inténtalo nuevamente.";
export const NETWORK_ERROR_MESSAGE =
  "No pudimos conectar con el servicio. Revisa tu conexión e inténtalo nuevamente.";
export const PERMISSION_ERROR_MESSAGE = "No tienes permiso para realizar esta acción.";
export const SESSION_ERROR_MESSAGE = "Tu sesión terminó. Inicia sesión nuevamente para continuar.";
export const QUOTA_ERROR_MESSAGE =
  "El servicio recibió demasiadas solicitudes. Espera unos minutos e inténtalo nuevamente.";
export const AUTH_GENERIC_MESSAGE =
  "No pudimos completar la solicitud. Inténtalo nuevamente en unos minutos.";

// Códigos de Firebase Authentication (auth/...).
export const AUTH_ERROR_MESSAGES = Object.freeze({
  "auth/wrong-password": "Contraseña incorrecta.",
  "auth/user-not-found": "No se encontró un usuario con ese correo.",
  "auth/email-already-in-use": "El correo electrónico ya está en uso.",
  "auth/invalid-email": "Ingresa un correo electrónico válido.",
  "auth/weak-password": PASSWORD_POLICY_MESSAGE,
  "auth/invalid-credential": "Credenciales inválidas.",
  "auth/invalid-login-credentials": "Credenciales inválidas.",
  "auth/missing-password": "Ingresa tu contraseña.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos e inténtalo nuevamente.",
  "auth/network-request-failed": "No pudimos conectar con el servicio. Revisa tu conexión.",
  "auth/popup-closed-by-user": "Cerraste la ventana de Google antes de terminar. Inténtalo nuevamente.",
  "auth/popup-blocked": "Tu navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo nuevamente.",
  "auth/account-exists-with-different-credential": "Ya existe una cuenta con ese correo creada con otro método. Ingresa con tu correo y contraseña.",
  "auth/operation-not-allowed": "El ingreso con Google no está habilitado todavía.",
  "auth/unauthorized-domain": "Este sitio no está autorizado para ingresar con Google.",
  "auth/user-disabled": "Esta cuenta está deshabilitada.",
  "auth/user-token-expired": "Tu sesión expiró. Inicia sesión nuevamente para continuar.",
  "auth/requires-recent-login": "Por seguridad, inicia sesión nuevamente para continuar.",
  "auth/expired-action-code": "El enlace venció. Solicita uno nuevo.",
  "auth/invalid-action-code": "El enlace no es válido o ya fue usado. Solicita uno nuevo.",
  "auth/quota-exceeded": QUOTA_ERROR_MESSAGE,
  "auth/timeout": NETWORK_ERROR_MESSAGE,
  "auth/email-required": "Ingresa tu correo electrónico.",
  "auth/legal-terms-required": "Debes aceptar la política de privacidad y los términos de uso para crear tu cuenta.",
  "auth/no-current-user": SESSION_ERROR_MESSAGE,
});

// Códigos de Functions, Firestore y Storage sin mensaje propio del servidor.
const CODE_MESSAGES = Object.freeze({
  unauthenticated: SESSION_ERROR_MESSAGE,
  "permission-denied": PERMISSION_ERROR_MESSAGE,
  "storage/unauthorized": PERMISSION_ERROR_MESSAGE,
  "resource-exhausted": QUOTA_ERROR_MESSAGE,
  "storage/quota-exceeded": QUOTA_ERROR_MESSAGE,
  unavailable: NETWORK_ERROR_MESSAGE,
  "deadline-exceeded": NETWORK_ERROR_MESSAGE,
  cancelled: NETWORK_ERROR_MESSAGE,
  canceled: NETWORK_ERROR_MESSAGE,
  "storage/canceled": NETWORK_ERROR_MESSAGE,
  "storage/retry-limit-exceeded": NETWORK_ERROR_MESSAGE,
});

// Errores nativos del navegador: su mensaje está en inglés y no es para la persona.
const NETWORK_ERROR_NAMES = new Set(["TypeError", "NetworkError", "AbortError", "TimeoutError"]);
const BROWSER_ERROR_NAMES = new Set([
  "TypeError", "SyntaxError", "RangeError", "ReferenceError", "EvalError", "URIError",
  "DOMException", "NotAllowedError", "SecurityError", "QuotaExceededError",
  "NetworkError", "AbortError", "TimeoutError", "InvalidStateError", "NotFoundError",
]);

const SDK_CODE_NAME = /^[a-z]+(?:-[a-z]+)*$/;
const TECHNICAL_PATTERNS = [
  /\b(?:auth|functions|firestore|storage|app)\/[a-z][\w-]*/i,
  /\bfirebase\b|\bfirestore\b|cloud functions?\b/i,
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|net::err|err_[a-z_]+/i,
  /missing or insufficient permissions|permission denied|quota exceeded|not allowed|is not a function|cannot read propert|unexpected token|is not defined|\bundefined\b|\bnull\b|\bjson\b/i,
  /clipboard|api no disponible/i,
  /\b(?:the|is|are|was|were|could|cannot|unable|failed|please|request|response|server|invalid|expired|exceeded|unexpected|denied|missing|insufficient|available|supported|blocked|timeout|timed|offline|again|document)\b/i,
];

function normalizeCode(error) {
  const raw = String(error?.code || "").trim().toLowerCase();
  if (raw) return raw.replace(/^functions\//, "");
  // authService lanza Error("auth/...") sin propiedad code, y el SDK a veces deja
  // el código solo dentro del texto: "Firebase: Error (auth/...)".
  const fromMessage = String(error?.message || "").trim().toLowerCase();
  const embedded = fromMessage.match(/(auth\/[a-z][\w-]*)/);
  return embedded ? embedded[1] : "";
}

function rawMessage(error) {
  if (typeof error === "string") return error.trim();
  return String(error?.message || "").trim();
}

export function isTechnicalErrorMessage(message, {code = "", name = ""} = {}) {
  const text = String(message || "").trim();
  if (!text) return true;
  if (BROWSER_ERROR_NAMES.has(name)) return true;
  if (SDK_CODE_NAME.test(text)) return true; // "internal", "unavailable", "resource-exhausted"...
  if (code && text.toLowerCase() === code) return true;
  return TECHNICAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function authErrorMessage(code) {
  const key = String(code || "").trim().toLowerCase();
  return AUTH_ERROR_MESSAGES[key] || AUTH_GENERIC_MESSAGE;
}

// Mensaje en español escrito por el servidor o por la aplicación, o "" si el
// mensaje es técnico (SDK, navegador, red) y no debe mostrarse.
export function serverMessage(error) {
  const text = rawMessage(error);
  const code = normalizeCode(error);
  const name = String(error?.name || "");
  if (code.startsWith("auth/")) return "";
  return isTechnicalErrorMessage(text, {code, name}) ? "" : text;
}

export function userErrorMessage(error, fallback = "") {
  const code = normalizeCode(error);
  if (code.startsWith("auth/")) return authErrorMessage(code);
  const own = serverMessage(error);
  if (own) return own;
  if (CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  const name = String(error?.name || "");
  const text = rawMessage(error);
  if (NETWORK_ERROR_NAMES.has(name) && /fetch|network|load failed|timeout|abort/i.test(text)) {
    return NETWORK_ERROR_MESSAGE;
  }
  return String(fallback || "").trim() || GENERIC_ERROR_MESSAGE;
}
