"use strict";

// Reglas puras del seguimiento público del Taller (sin Firestore). El cliente ve en qué etapa está su
// vehículo, el avance de los trabajos y los hallazgos informados. Nunca ve montos, técnico, plaza, fotos,
// nombres de personas ni su RUT. Se entra con un enlace único o, en la página pública de la plataforma
// (/seguimiento), con patente + RUT del titular o de quien entregó el vehículo, con un límite de intentos por IP.

const crypto = require("node:crypto");
const {normalizeChileanRut, normalizeCountryCode} = require("./fiscalIdentifier");

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const PLATE_PATTERN = /^[A-Z0-9]{5,8}$/;

// Límite de intentos fallidos de patente + RUT, siempre por IP (nunca por patente sola: así nadie puede dejar sin
// consulta a otra persona intentando con su patente):
// - IP + patente: 3 fallos en 15 minutos bloquean esa combinación por 15 minutos.
// - IP en total (varias patentes): 10 fallos en 15 minutos bloquean esa IP por 15 minutos.
const MAX_FAILED_ATTEMPTS = 3;
const MAX_FAILED_ATTEMPTS_PER_IP = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

// Estados de la OT que nunca son visibles: sin recepción registrada o ya fuera del taller.
const HIDDEN_ORDER_STATES = new Set(["ingresada", "cerrada", "cancelada"]);
const PUBLIC_STEPS = Object.freeze(["Recibido", "En revisión", "En reparación", "Listo para retiro"]);
const STAGE_TEXT = Object.freeze({
  recibido: "Recibimos tu vehículo. Pronto lo revisaremos.",
  revision: "Estamos revisando tu vehículo para definir los trabajos.",
  espera: "Tu vehículo está en espera. El taller se comunicará contigo.",
  plaza: "Los trabajos fueron aprobados. Tu vehículo espera un espacio en el taller.",
  reparacion: "Estamos trabajando en tu vehículo.",
  listo: "Terminamos los trabajos. El taller se comunicará contigo para coordinar el retiro.",
});
const WORK_STATUS = Object.freeze({pendiente: "pendiente", en_progreso: "en_curso", completado: "terminado"});

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

function createTokenMaterial(randomBytes = crypto.randomBytes) {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {token, tokenHash: hashToken(token)};
}

// Devuelve el hash del token si tiene el formato esperado; si no, cadena vacía (sin distinguir el motivo).
function validTokenHash(rawToken) {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  return TOKEN_PATTERN.test(token) ? hashToken(token) : "";
}

// Índice de patentes para la consulta pública de toda la plataforma: el id es un hash (no guarda la patente en claro).
const PLATE_INDEX_COLLECTION = "tallerSeguimientoPatentes";
const MAX_BUSINESSES_PER_PLATE = 10;

function plateIndexId(plate) {
  return crypto.createHash("sha256").update(`patente|${plate}`).digest("hex");
}

function normalizePlate(value) {
  const plate = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return PLATE_PATTERN.test(plate) ? plate : "";
}

// Documento comparable: en Chile, RUT sin puntos ni guion; en otros países, letras y números en mayúscula.
function normalizeDocument(value, countryCode = "CL") {
  return normalizeCountryCode(countryCode) === "CL"
    ? normalizeChileanRut(value).replace("-", "")
    : String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isVisibleOrder(order = {}) {
  return Boolean(order.recepcion) && !HIDDEN_ORDER_STATES.has(order.estado);
}

// El enlace se activa con el ingreso aprobado y la ejecución iniciada, y funciona hasta la entrega.
const LINK_ORDER_STATES = new Set(["en_reparacion", "pendiente_entrega"]);

function canShareTrackingLink(order = {}) {
  return order.estadoAprobacion === "aprobada" && LINK_ORDER_STATES.has(order.estado) && isVisibleOrder(order);
}

// Etapa pública: índice en PUBLIC_STEPS, clave del texto y si se muestra como espera.
function publicStage(order = {}) {
  if (order.estado === "pendiente_entrega") return {paso: 3, clave: "listo", espera: false};
  if (order.estado === "en_reparacion") return {paso: 2, clave: "reparacion", espera: false};
  if (order.estadoAprobacion === "aprobada") return {paso: 2, clave: "plaza", espera: true};
  if (order.estadoAprobacion === "rechazada") return {paso: 1, clave: "espera", espera: true};
  if (order.estado === "en_diagnostico") return {paso: 1, clave: "revision", espera: false};
  return {paso: 0, clave: "recibido", espera: false};
}

function millis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  return Number.isFinite(value) ? value : null;
}

function cleanText(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

// Vista pública: solo campos permitidos. `services` trae {estado, nombre}; `findings`, {descripcion, urgente, servicioOtId}.
function buildPublicView({business = {}, profile = {}, order = {}, vehicle = {}, services = [], findings = []}) {
  const stage = publicStage(order);
  const showWorks = stage.paso >= 2 && !(stage.clave === "plaza");
  const works = showWorks ? services
    .map((service) => ({nombre: cleanText(service.nombre, 120) || "Trabajo", estado: WORK_STATUS[service.estado] || "pendiente"}))
    : [];
  const finished = works.filter((work) => work.estado === "terminado").length;
  const visibleFindings = stage.paso >= 1 ? findings
    .filter((finding) => !finding.servicioOtId && cleanText(finding.descripcion, 500))
    .map((finding) => ({descripcion: cleanText(finding.descripcion, 500), urgente: finding.urgente === true}))
    : [];
  const updates = [order.actualizadoEn, ...services.map((service) => service.actualizadoEn)].map(millis).filter(Boolean);
  return {
    taller: {
      nombre: cleanText(profile.nombreComercial || business.nombreComercial || business.nombre, 120) || "Taller",
      telefono: cleanText(profile.telefono || business.telefono, 40) || null,
    },
    vehiculo: {
      descripcion: cleanText([vehicle.marca, vehicle.modelo].filter(Boolean).join(" "), 120) || "Vehículo",
      patente: cleanText(vehicle.patente, 12),
    },
    etapa: {pasos: [...PUBLIC_STEPS], paso: stage.paso, clave: stage.clave, espera: stage.espera, texto: STAGE_TEXT[stage.clave]},
    trabajos: works,
    avance: works.length ? {terminados: finished, total: works.length, porcentaje: Math.round((finished / works.length) * 100)} : null,
    hallazgos: visibleFindings,
    actualizadoEn: updates.length ? Math.max(...updates) : null,
  };
}

// Contador de intentos fallidos. Devuelve el nuevo estado y si quedó bloqueado.
function isBlocked(state = {}, now = Date.now()) {
  return Number(state.bloqueadoHasta || 0) > now;
}

function registerFailure(state = {}, now = Date.now(), limit = MAX_FAILED_ATTEMPTS) {
  const windowStart = Number(state.ventanaDesde || 0);
  const fresh = !windowStart || now - windowStart > ATTEMPT_WINDOW_MS;
  const fallos = fresh ? 1 : Number(state.fallos || 0) + 1;
  const blocked = fallos >= limit;
  return {
    fallos: blocked ? 0 : fallos,
    ventanaDesde: blocked ? 0 : fresh ? now : windowStart,
    bloqueadoHasta: blocked ? now + BLOCK_MS : 0,
    // Fecha en que el contador ya no sirve (milisegundos). Se guarda como fecha para la política TTL de Firestore.
    expiraEn: now + ATTEMPT_WINDOW_MS + BLOCK_MS,
    bloqueado: blocked,
  };
}

// La consulta pública con patente + RUT queda apagada hasta contar con App Check o captcha; se enciende con
// SEGUIMIENTO_CONSULTA_PUBLICA=true en las variables de entorno de las Functions.
function isPublicLookupEnabled(env = process.env) {
  return String(env.SEGUIMIENTO_CONSULTA_PUBLICA || "").trim().toLowerCase() === "true";
}

function attemptKey(kind, ...parts) {
  return crypto.createHash("sha256").update([kind, ...parts].join("|")).digest("hex");
}

module.exports = {
  ATTEMPT_WINDOW_MS, BLOCK_MS, MAX_FAILED_ATTEMPTS, MAX_FAILED_ATTEMPTS_PER_IP, PUBLIC_STEPS, STAGE_TEXT, TOKEN_HASH_PATTERN,
  MAX_BUSINESSES_PER_PLATE, PLATE_INDEX_COLLECTION,
  attemptKey, buildPublicView, canShareTrackingLink, createTokenMaterial, hashToken,
  isBlocked, isPublicLookupEnabled, isVisibleOrder, normalizeDocument, normalizePlate, plateIndexId, publicStage, registerFailure, validTokenHash,
};
