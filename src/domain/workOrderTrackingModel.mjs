// Seguimiento público del Taller (prototipo «Panel del Taller»): lo que ve el cliente por enlace o con
// patente + RUT. Coincide con functions/workOrderTrackingRules.js. Sin montos, técnico, plaza ni fotos.

export const TRACKING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const MAX_TRACKING_ATTEMPTS = 3;

export const TRACKING_WORK_STATUS = Object.freeze({
  terminado: {label: "Terminado", tone: "success"},
  en_curso: {label: "En curso", tone: "warning"},
  pendiente: {label: "Pendiente", tone: "neutral"},
});

// Rutas públicas: /seguimiento (patente + RUT, para toda la plataforma) y /seguimiento/{token} (enlace único).
// /seguimiento/taller/... (versión anterior, por taller) abre la misma consulta con patente + RUT.
export function parseTrackingPath(pathname = "") {
  if (/^\/seguimiento\/?$/.test(pathname) || /^\/seguimiento\/taller(\/[^/]*)?\/?$/.test(pathname)) return {mode: "manual"};
  const link = /^\/seguimiento\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  if (link) return {mode: "link", token: TRACKING_TOKEN_PATTERN.test(link[1]) ? link[1] : ""};
  return null;
}

export function isTrackingPath(pathname = "") {
  return /^\/seguimiento(\/(taller\/)?[^/]+)?\/?$/.test(pathname);
}

export function normalizeTrackingPlate(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function compactRut(value) {
  return String(value ?? "").toUpperCase().replace(/[^0-9K]/g, "");
}

// Formato visible mientras se escribe: 12.345.678-5.
export function formatTrackingRut(value) {
  const compact = compactRut(value).slice(0, 9);
  if (compact.length < 2) return compact;
  const body = compact.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${body}-${compact.slice(-1)}`;
}

export function isValidTrackingRut(value) {
  const compact = compactRut(value);
  if (!/^\d{7,8}[\dK]$/.test(compact)) return false;
  let sum = 0;
  let factor = 2;
  for (let index = compact.length - 2; index >= 0; index -= 1) {
    sum += Number(compact[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  const expected = rest === 11 ? "0" : rest === 10 ? "K" : String(rest);
  return expected === compact.slice(-1);
}

// Errores del formulario antes de llamar al servidor; un RUT mal escrito no cuenta como intento.
export function trackingLookupError({patente, rut}) {
  if (normalizeTrackingPlate(patente).length < 5 || compactRut(rut).length < 2) return "Completa la patente y el RUT.";
  if (!isValidTrackingRut(rut)) return "El RUT no es válido. Revísalo.";
  return "";
}

export function trackingProgressLabel(avance) {
  return avance ? `${avance.terminados} de ${avance.total} · ${avance.porcentaje}%` : "";
}

export function trackingWhatsappMessage(vehicleLabel, url, name = "") {
  const first = String(name || "").trim().split(" ")[0];
  return `${first ? `Hola ${first}` : "Hola"}, puedes ver cómo va tu vehículo ${vehicleLabel} aquí: ${url}`;
}
