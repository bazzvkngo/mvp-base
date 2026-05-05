import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { userConfigDocPath } from "../firebase/firestorePaths";

export const DEFAULT_COMPANY_CONFIG = {
  rubroPrincipal: "",
  rubroOtro: "",
  tipoOperacion: "mixto",
  tipoNegocio: "mixto",
  valorHoraBase: 15000,
  margenEcon: 0.15,
  margenStd: 0.25,
  margenPremium: 0.35,
};

function isValidNumber(value) {
  return typeof value === "number" && !Number.isNaN(value);
}

function normalizeMargin(rawValue, defaultValue) {
  if (!isValidNumber(rawValue)) return defaultValue;
  if (rawValue > 1) return rawValue / 100;
  if (rawValue <= 0) return defaultValue;
  return rawValue;
}

export function normalizeCompanyConfig(raw = {}) {
  const legacyBusinessType = raw.tipoNegocio || DEFAULT_COMPANY_CONFIG.tipoNegocio;
  let tipoOperacion = raw.tipoOperacion || "mixto";

  if (!raw.tipoOperacion && legacyBusinessType) {
    switch (legacyBusinessType) {
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

  return {
    rubroPrincipal: raw.rubroPrincipal || "",
    rubroOtro: raw.rubroOtro || "",
    tipoOperacion,
    tipoNegocio: legacyBusinessType,
    valorHoraBase:
      isValidNumber(raw.valorHoraBase) && raw.valorHoraBase > 0
        ? raw.valorHoraBase
        : DEFAULT_COMPANY_CONFIG.valorHoraBase,
    margenEcon: normalizeMargin(
      raw.margenEcon,
      DEFAULT_COMPANY_CONFIG.margenEcon
    ),
    margenStd: normalizeMargin(raw.margenStd, DEFAULT_COMPANY_CONFIG.margenStd),
    margenPremium: normalizeMargin(
      raw.margenPremium,
      DEFAULT_COMPANY_CONFIG.margenPremium
    ),
  };
}

export async function getCompanyConfig(userId) {
  if (!userId) {
    throw new Error("userId es requerido para obtener la configuración.");
  }

  const ref = doc(db, ...userConfigDocPath(userId));
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, DEFAULT_COMPANY_CONFIG, { merge: true });
    return { ...DEFAULT_COMPANY_CONFIG };
  }

  return normalizeCompanyConfig(snap.data() || {});
}

export async function saveCompanyConfig(userId, configPatch) {
  if (!userId) {
    throw new Error("userId es requerido para guardar la configuración.");
  }
  if (!configPatch || typeof configPatch !== "object") {
    throw new Error("configPatch debe ser un objeto.");
  }

  const payload = normalizeCompanyConfig({
    ...DEFAULT_COMPANY_CONFIG,
    ...configPatch,
  });

  await setDoc(doc(db, ...userConfigDocPath(userId)), payload, { merge: true });
  return payload;
}

export const obtenerConfigNegocio = getCompanyConfig;
export const guardarConfigNegocio = saveCompanyConfig;
export const DEFAULT_CONFIG = DEFAULT_COMPANY_CONFIG;
