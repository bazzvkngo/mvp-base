import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { db, storage } from "../firebase/firebaseConfig";
import {
  companyProfileDocPath,
  userConfigDocPath,
} from "../firebase/firestorePaths";

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

export const DEFAULT_COMPANY_PROFILE = {
  nombreComercial: "",
  razonSocial: "",
  rut: "",
  giro: "",
  email: "",
  telefono: "",
  direccion: "",
  ciudad: "",
  sitioWeb: "",
  logoUrl: "",
  logoPath: "",
  logoNombreOriginal: "",
  logoActualizadoEn: null,
  condicionesPago: "50% al iniciar y 50% contra entrega",
  validezCotizacionDias: 15,
  notaPieCotizacion:
    "Los valores pueden variar segun alcance final y disponibilidad de insumos.",
};

export const MAX_COMPANY_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

function isValidNumber(value) {
  return typeof value === "number" && !Number.isNaN(value);
}

function normalizeMargin(rawValue, defaultValue) {
  if (!isValidNumber(rawValue)) return defaultValue;
  if (rawValue > 1) return rawValue / 100;
  if (rawValue <= 0) return defaultValue;
  return rawValue;
}

function safeString(value) {
  return String(value || "").trim();
}

function normalizeUrl(value) {
  const url = safeString(value);
  if (!url) return "";

  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function normalizeDays(value) {
  const days = Number(value);
  return Number.isFinite(days) && days > 0
    ? Math.round(days)
    : DEFAULT_COMPANY_PROFILE.validezCotizacionDias;
}

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
}

function getLogoExtension(file) {
  const typeExtensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
  };
  const nameExtension = String(file?.name || "")
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (nameExtension && nameExtension !== String(file?.name || "").toLowerCase()) {
    return nameExtension;
  }

  return typeExtensions[file?.type] || "png";
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

export function normalizeCompanyProfile(raw = {}) {
  return {
    nombreComercial: safeString(raw.nombreComercial),
    razonSocial: safeString(raw.razonSocial),
    rut: safeString(raw.rut),
    giro: safeString(raw.giro),
    email: safeString(raw.email),
    telefono: safeString(raw.telefono),
    direccion: safeString(raw.direccion),
    ciudad: safeString(raw.ciudad),
    sitioWeb: normalizeUrl(raw.sitioWeb),
    logoUrl: normalizeUrl(raw.logoUrl),
    logoPath: safeString(raw.logoPath),
    logoNombreOriginal: safeString(raw.logoNombreOriginal),
    logoActualizadoEn: raw.logoActualizadoEn || null,
    condicionesPago:
      safeString(raw.condicionesPago) ||
      DEFAULT_COMPANY_PROFILE.condicionesPago,
    validezCotizacionDias: normalizeDays(raw.validezCotizacionDias),
    notaPieCotizacion:
      safeString(raw.notaPieCotizacion) ||
      DEFAULT_COMPANY_PROFILE.notaPieCotizacion,
    uidUsuario: safeString(raw.uidUsuario),
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

export async function getCompanyProfile(userId) {
  if (!userId) {
    throw new Error("userId es requerido para obtener el perfil de empresa.");
  }

  const snap = await getDoc(doc(db, ...companyProfileDocPath(userId)));
  if (!snap.exists()) {
    return {
      ...DEFAULT_COMPANY_PROFILE,
      uidUsuario: userId,
    };
  }

  return normalizeCompanyProfile({
    ...DEFAULT_COMPANY_PROFILE,
    ...snap.data(),
    uidUsuario: userId,
  });
}

export async function saveCompanyProfile(userId, profilePatch) {
  if (!userId) {
    throw new Error("userId es requerido para guardar el perfil de empresa.");
  }
  if (!profilePatch || typeof profilePatch !== "object") {
    throw new Error("profilePatch debe ser un objeto.");
  }

  const payload = normalizeCompanyProfile({
    ...DEFAULT_COMPANY_PROFILE,
    ...profilePatch,
    uidUsuario: userId,
  });

  ["logoPath", "logoNombreOriginal", "logoActualizadoEn"].forEach((field) => {
    if (!hasOwn(profilePatch, field)) {
      delete payload[field];
    }
  });

  await setDoc(
    doc(db, ...companyProfileDocPath(userId)),
    {
      ...payload,
      actualizadoEn: serverTimestamp(),
      uidUsuario: userId,
    },
    { merge: true }
  );

  return {
    ...payload,
    uidUsuario: userId,
  };
}

export async function uploadCompanyLogo(userId, file) {
  if (!userId) {
    throw new Error("userId es requerido para subir el logo de empresa.");
  }
  if (!file) {
    throw new Error("Selecciona una imagen antes de subir el logo.");
  }
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error("El archivo seleccionado debe ser una imagen.");
  }
  if (file.size > MAX_COMPANY_LOGO_SIZE_BYTES) {
    throw new Error("El logo no puede pesar mas de 2 MB.");
  }

  const extension = getLogoExtension(file);
  const logoPath = `usuarios/${userId}/empresa/logo/logo-empresa.${extension}`;
  const ref = storageRef(storage, logoPath);

  await uploadBytes(ref, file, {
    contentType: file.type,
  });

  const logoUrl = await getDownloadURL(ref);
  const payload = {
    logoUrl,
    logoPath,
    logoNombreOriginal: safeString(file.name),
    logoActualizadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
    uidUsuario: userId,
  };

  await setDoc(doc(db, ...companyProfileDocPath(userId)), payload, {
    merge: true,
  });

  return {
    logoUrl,
    logoPath,
    logoNombreOriginal: payload.logoNombreOriginal,
  };
}

export const obtenerConfigNegocio = getCompanyConfig;
export const guardarConfigNegocio = saveCompanyConfig;
export const DEFAULT_CONFIG = DEFAULT_COMPANY_CONFIG;
