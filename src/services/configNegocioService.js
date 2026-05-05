// src/services/configNegocioService.js
import { db } from "../firebaseConfig";
import { doc, getDoc, setDoc } from "firebase/firestore";

const CONFIG_COLLECTION = "config";
const CONFIG_DOC_ID = "negocio";

/**
 * Configuración por defecto del negocio.
 * IMPORTANTE: los márgenes se guardan en DECIMALES (0.15 = 15%).
 */
export const DEFAULT_CONFIG = {
  // Nuevo modelo
  rubroPrincipal: "",       // Ej: "Servicios TI, soporte e instalaciones"
  rubroOtro: "",            // Solo cuando el usuario elige "Otro / mixto"
  // "productos" | "servicios" | "mixto"
  tipoOperacion: "mixto",

  // Campo legacy (por compatibilidad con versiones anteriores)
  // "ferreteria" | "services_ti" | "electricidad" | "mixto"
  tipoNegocio: "mixto",

  // Base para mano de obra
  valorHoraBase: 15000, // CLP

  // Márgenes en decimales (0.15 = 15%)
  margenEcon: 0.15,
  margenStd: 0.25,
  margenPremium: 0.35,
};

// Utilidad interna
function esNumeroValido(value) {
  return typeof value === "number" && !Number.isNaN(value);
}

/**
 * Normaliza un margen:
 * - Acepta valores en decimal (0.15) o en porcentaje (15).
 * - Siempre devuelve un decimal (0.15).
 */
function normalizarMargen(rawValue, defaultValue) {
  if (!esNumeroValido(rawValue)) {
    return defaultValue;
  }

  // Si el valor es mayor a 1, asumimos que viene como porcentaje (15, 25, 34...)
  if (rawValue > 1) {
    return rawValue / 100;
  }

  // Si es <= 0, usamos el default
  if (rawValue <= 0) {
    return defaultValue;
  }

  // Ya está en formato decimal
  return rawValue;
}

/**
 * Mezcla la configuración cruda con DEFAULT_CONFIG
 * y aplica conversiones necesarias (márgenes, tipoOperacion, etc.).
 */
function normalizarConfig(raw = {}) {
  const rubroPrincipal = raw.rubroPrincipal || "";
  const rubroOtro = raw.rubroOtro || "";

  // Compatibilidad con el campo legacy tipoNegocio
  const tipoNegocioLegacy = raw.tipoNegocio || DEFAULT_CONFIG.tipoNegocio;

  let tipoOperacion = raw.tipoOperacion || "mixto";

  if (!raw.tipoOperacion && tipoNegocioLegacy) {
    // Mapeo simple desde el modelo antiguo
    switch (tipoNegocioLegacy) {
      case "ferreteria":
        tipoOperacion = "productos";
        break;
      case "services_ti":
      case "electricidad":
        tipoOperacion = "servicios";
        break;
      default:
        tipoOperacion = "mixto";
    }
  }

  const valorHoraBaseRaw = raw.valorHoraBase;
  const valorHoraBase = esNumeroValido(valorHoraBaseRaw) && valorHoraBaseRaw > 0
    ? valorHoraBaseRaw
    : DEFAULT_CONFIG.valorHoraBase;

  const margenEcon = normalizarMargen(
    raw.margenEcon,
    DEFAULT_CONFIG.margenEcon
  );
  const margenStd = normalizarMargen(
    raw.margenStd,
    DEFAULT_CONFIG.margenStd
  );
  const margenPremium = normalizarMargen(
    raw.margenPremium,
    DEFAULT_CONFIG.margenPremium
  );

  return {
    rubroPrincipal,
    rubroOtro,
    tipoOperacion,
    // mantenemos tipoNegocio por compatibilidad,
    // aunque el front nuevo ya no lo use directamente
    tipoNegocio: tipoNegocioLegacy,
    valorHoraBase,
    margenEcon,
    margenStd,
    margenPremium,
  };
}

/**
 * Obtiene la configuración del negocio para un usuario.
 * Si no existe, crea una base con valores por defecto.
 */
export async function obtenerConfigNegocio(userId) {
  if (!userId) {
    throw new Error("userId es requerido para obtener la configuración.");
  }

  const ref = doc(db, "usuarios", userId, CONFIG_COLLECTION, CONFIG_DOC_ID);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // Creamos config por defecto para este usuario
    await setDoc(ref, DEFAULT_CONFIG, { merge: true });
    return { ...DEFAULT_CONFIG };
  }

  const configRaw = snap.data() || {};
  return normalizarConfig(configRaw);
}

/**
 * Guarda la configuración del negocio para un usuario.
 *
 * NOTA:
 * - Puedes pasar los márgenes como decimales (0.15) o como porcentajes (15).
 *   Esta función siempre los normaliza a decimales antes de escribir en Firestore.
 */
export async function guardarConfigNegocio(userId, configParcial) {
  if (!userId) {
    throw new Error("userId es requerido para guardar la configuración.");
  }

  if (!configParcial || typeof configParcial !== "object") {
    throw new Error("configParcial debe ser un objeto.");
  }

  const ref = doc(db, "usuarios", userId, CONFIG_COLLECTION, CONFIG_DOC_ID);

  // Mezclamos con defaults para garantizar campos mínimos
  const merged = {
    ...DEFAULT_CONFIG,
    ...configParcial,
  };

  // Normalizamos (incluye corrección de márgenes)
  const payload = normalizarConfig(merged);

  await setDoc(ref, payload, { merge: true });

  return payload;
}
