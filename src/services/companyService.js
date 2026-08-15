import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  getDownloadURL,
  deleteObject,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { assertClientWriteAllowed } from "../config/firebaseEnvironment.mjs";
import { db, getFirebaseFunctions, storage } from "../firebase/firebaseConfig";
import {
  businessDocPath,
  businessSettingsDocPath,
  companyProfileDocPath,
  personalProfileDocPath,
  userConfigDocPath,
} from "../firebase/firestorePaths";
import { adaptBusinessLocalization } from "../domain/localization.mjs";

const functions = getFirebaseFunctions("us-central1");

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
  rubroCodigo: "",
  rubroNombre: "",
  rubroOtro: "",
  paisCodigo: "CL",
  paisNombre: "Chile",
  monedaCodigo: "CLP",
  monedaNombre: "Peso chileno",
  locale: "es-CL",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: "",
  regionCodigo: "",
  regionNombre: "",
  comunaCodigo: "",
  comunaNombre: "",
  razonSocial: "",
  rut: "",
  giro: "",
  email: "",
  telefono: "",
  direccion: "",
  ciudad: "",
  region: "",
  regionEstado: "",
  codigoPostal: "",
  responsable: "",
  cargoResponsable: "",
  sitioWeb: "",
  logoUrl: "",
  logoPath: "",
  logoNombreOriginal: "",
  logoActualizadoEn: null,
  condicionesPago: "50% al iniciar y 50% contra entrega",
  plazoEntregaCotizacion: "",
  alcanceGeograficoCotizacion: "",
  garantiaCotizacion: "",
  exclusionesCotizacion: "",
  terminosCotizacion: "",
  validezCotizacionDias: 15,
  aceptacionCotizacionHabilitada: false,
  textoAceptacionCotizacion:
    "Acepto los términos y condiciones de esta cotización.",
  notaPieCotizacion:
    "Los valores pueden variar segun alcance final y disponibilidad de insumos.",
  notaFinalCotizacion: "",
  impuestoPredeterminadoId: "IVA_GENERAL",
  impuestoPredeterminadoNombre: "IVA",
  impuestoPredeterminadoTasa: 19,
};

export const DEFAULT_TAX_SETTINGS = {
  impuestoPredeterminadoId: "IVA_GENERAL",
  impuestoPredeterminadoNombre: "IVA",
  impuestoPredeterminadoTasa: 19,
};

export const DEFAULT_INVENTORY_SETTINGS = {
  alertasStockBajo: true,
  umbralStockBajo: 5,
  permitirStockNegativo: false,
};

export const DEFAULT_QUOTE_SETTINGS = {
  condicionesPago: DEFAULT_COMPANY_PROFILE.condicionesPago,
  plazoEntregaCotizacion: "",
  alcanceGeograficoCotizacion: "",
  garantiaCotizacion: "",
  exclusionesCotizacion: "",
  validezCotizacionDias: DEFAULT_COMPANY_PROFILE.validezCotizacionDias,
  notaFinalCotizacion: "",
  terminosCotizacion: "",
  notaPieCotizacion: DEFAULT_COMPANY_PROFILE.notaPieCotizacion,
  aceptacionCotizacionHabilitada: false,
  textoAceptacionCotizacion:
    DEFAULT_COMPANY_PROFILE.textoAceptacionCotizacion,
};

export const DEFAULT_PERSONAL_PROFILE = {
  nombres: "",
  apellidos: "",
  tipoDocumento: "",
  numeroDocumento: "",
  telefonoPersonal: "",
};

export const MAX_COMPANY_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_COMPANY_LOGO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

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

function getLogoExtension(file) {
  const typeExtensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  return typeExtensions[file?.type] || "";
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
  const localization = adaptBusinessLocalization(raw);
  return {
    nombreComercial: safeString(raw.nombreComercial),
    rubroCodigo: safeString(raw.rubroCodigo),
    rubroNombre: safeString(raw.rubroNombre),
    rubroOtro: safeString(raw.rubroOtro),
    ...localization,
    regionCodigo: safeString(raw.regionCodigo),
    regionNombre: safeString(raw.regionNombre || raw.region),
    comunaCodigo: safeString(raw.comunaCodigo),
    comunaNombre: safeString(raw.comunaNombre || raw.ciudad),
    razonSocial: safeString(raw.razonSocial),
    rut: safeString(raw.rut),
    identificadorFiscalValor: localization.identificadorFiscalValor,
    giro: safeString(raw.giro),
    email: safeString(raw.email),
    telefono: safeString(raw.telefono),
    direccion: safeString(raw.direccion),
    ciudad: safeString(raw.ciudad),
    region: safeString(raw.region),
    regionEstado: safeString(raw.regionEstado || raw.regionNombre || raw.region),
    codigoPostal: safeString(raw.codigoPostal),
    responsable: safeString(raw.responsable),
    cargoResponsable: safeString(raw.cargoResponsable),
    sitioWeb: normalizeUrl(raw.sitioWeb),
    logoUrl: normalizeUrl(raw.logoUrl),
    logoPath: safeString(raw.logoPath),
    logoNombreOriginal: safeString(raw.logoNombreOriginal),
    logoActualizadoEn: raw.logoActualizadoEn || null,
    condicionesPago:
      safeString(raw.condicionesPago) ||
      DEFAULT_COMPANY_PROFILE.condicionesPago,
    plazoEntregaCotizacion: safeString(raw.plazoEntregaCotizacion),
    alcanceGeograficoCotizacion: safeString(raw.alcanceGeograficoCotizacion),
    garantiaCotizacion: safeString(raw.garantiaCotizacion),
    exclusionesCotizacion: safeString(raw.exclusionesCotizacion),
    terminosCotizacion: safeString(raw.terminosCotizacion),
    validezCotizacionDias: normalizeDays(raw.validezCotizacionDias),
    aceptacionCotizacionHabilitada:
      raw.aceptacionCotizacionHabilitada === true,
    textoAceptacionCotizacion:
      safeString(raw.textoAceptacionCotizacion) ||
      DEFAULT_COMPANY_PROFILE.textoAceptacionCotizacion,
    notaPieCotizacion:
      safeString(raw.notaPieCotizacion) ||
      DEFAULT_COMPANY_PROFILE.notaPieCotizacion,
    notaFinalCotizacion: safeString(raw.notaFinalCotizacion),
    ...normalizeTaxSettings(raw),
    uidUsuario: safeString(raw.uidUsuario),
  };
}

export function normalizeTaxSettings(raw = {}) {
  const rate = Number(raw.impuestoPredeterminadoTasa);
  return {
    impuestoPredeterminadoId:
      safeString(raw.impuestoPredeterminadoId) || "PERSONALIZADO",
    impuestoPredeterminadoNombre:
      safeString(raw.impuestoPredeterminadoNombre) ||
      DEFAULT_TAX_SETTINGS.impuestoPredeterminadoNombre,
    impuestoPredeterminadoTasa:
      Number.isFinite(rate) && rate >= 0 && rate <= 100
        ? rate
        : DEFAULT_TAX_SETTINGS.impuestoPredeterminadoTasa,
  };
}

export function normalizeInventorySettings(raw = {}) {
  const threshold = Number(raw.umbralStockBajo);
  return {
    alertasStockBajo: raw.alertasStockBajo !== false,
    umbralStockBajo:
      Number.isInteger(threshold) && threshold >= 0
        ? threshold
        : DEFAULT_INVENTORY_SETTINGS.umbralStockBajo,
    permitirStockNegativo: raw.permitirStockNegativo === true,
  };
}

export function normalizeQuoteSettings(raw = {}) {
  return {
    condicionesPago:
      safeString(raw.condicionesPago) || DEFAULT_QUOTE_SETTINGS.condicionesPago,
    validezCotizacionDias: normalizeDays(raw.validezCotizacionDias),
    plazoEntregaCotizacion: safeString(raw.plazoEntregaCotizacion),
    alcanceGeograficoCotizacion: safeString(raw.alcanceGeograficoCotizacion),
    garantiaCotizacion: safeString(raw.garantiaCotizacion),
    exclusionesCotizacion: safeString(raw.exclusionesCotizacion),
    notaFinalCotizacion: safeString(raw.notaFinalCotizacion),
    terminosCotizacion: safeString(raw.terminosCotizacion),
    notaPieCotizacion:
      safeString(raw.notaPieCotizacion) || DEFAULT_QUOTE_SETTINGS.notaPieCotizacion,
    aceptacionCotizacionHabilitada:
      raw.aceptacionCotizacionHabilitada === true,
    textoAceptacionCotizacion:
      safeString(raw.textoAceptacionCotizacion) ||
      DEFAULT_QUOTE_SETTINGS.textoAceptacionCotizacion,
  };
}

export function normalizePersonalProfile(raw = {}) {
  return {
    nombres: safeString(raw.nombres),
    apellidos: safeString(raw.apellidos),
    tipoDocumento: safeString(raw.tipoDocumento).toUpperCase(),
    numeroDocumento: safeString(raw.numeroDocumento),
    telefonoPersonal: safeString(raw.telefonoPersonal),
  };
}

export function getCompanyProfileCompletion(profile = {}) {
  const missingMinimum = [];
  const missingRecommended = [];

  if (!safeString(profile.nombreComercial)) missingMinimum.push("Nombre comercial");
  if (!safeString(profile.rubroCodigo || profile.rubroNombre)) {
    missingMinimum.push("Rubro principal");
  }
  if (!safeString(profile.regionCodigo || profile.regionEstado)) missingMinimum.push("Región / Estado");
  if (!safeString(profile.paisCodigo)) missingMinimum.push("País");
  if (!safeString(profile.monedaCodigo)) missingMinimum.push("Moneda");

  if (!safeString(profile.identificadorFiscalValor || profile.rut)) missingRecommended.push("Identificación fiscal");
  if (!safeString(profile.comunaCodigo || profile.ciudad)) {
    missingRecommended.push("Comuna");
  }
  if (!safeString(profile.direccion)) missingRecommended.push("Dirección");
  if (!safeString(profile.telefono) && !safeString(profile.email)) {
    missingRecommended.push("Teléfono o correo comercial");
  }

  return {
    minimumComplete: missingMinimum.length === 0,
    recommendedComplete: missingRecommended.length === 0,
    missingMinimum,
    missingRecommended,
  };
}

export async function getCompanyConfig(userId) {
  if (!userId) {
    throw new Error("userId es requerido para obtener la configuración.");
  }

  const ref = doc(db, ...userConfigDocPath(userId));
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return { ...DEFAULT_COMPANY_CONFIG };
  }

  return normalizeCompanyConfig(snap.data() || {});
}

export async function saveCompanyConfig(userId, configPatch) {
  assertClientWriteAllowed("guardar la configuración de empresa");
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

  await setDoc(
    doc(db, ...userConfigDocPath(userId)),
    { ...payload, negocioId: userId },
    { merge: true }
  );
  return payload;
}

export async function getCompanyProfile(userId) {
  if (!userId) {
    throw new Error("userId es requerido para obtener el perfil de empresa.");
  }

  const [
    businessSnapshot,
    profileSnapshot,
    quoteSettingsSnapshot,
    taxSettingsSnapshot,
  ] = await Promise.all([
    getDoc(doc(db, ...businessDocPath(userId))),
    getDoc(doc(db, ...companyProfileDocPath(userId))),
    getDoc(doc(db, ...businessSettingsDocPath(userId, "cotizaciones"))),
    getDoc(doc(db, ...businessSettingsDocPath(userId, "impuestos"))),
  ]);
  const business = businessSnapshot.data() || {};
  const profile = profileSnapshot.data() || {};
  const quoteSettings = quoteSettingsSnapshot.exists()
    ? normalizeQuoteSettings(quoteSettingsSnapshot.data() || {})
    : {};
  const taxSettings = normalizeTaxSettings(taxSettingsSnapshot.data() || {});

  return normalizeCompanyProfile({
    ...DEFAULT_COMPANY_PROFILE,
    ...business,
    ...profile,
    nombreComercial:
      profile.nombreComercial || business.nombreComercial || "",
    rubroCodigo: profile.rubroCodigo || business.rubroCodigo || "",
    rubroNombre: profile.rubroNombre || business.rubroNombre || "",
    rubroOtro: profile.rubroOtro || business.rubroOtro || "",
    paisCodigo: profile.paisCodigo || business.paisCodigo || "CL",
    paisNombre: profile.paisNombre || business.paisNombre || "Chile",
    monedaCodigo: profile.monedaCodigo || business.monedaCodigo || "CLP",
    monedaNombre:
      profile.monedaNombre || business.monedaNombre || "Peso chileno",
    locale: profile.locale || business.locale || "es-CL",
    identificadorFiscalTipo:
      profile.identificadorFiscalTipo || business.identificadorFiscalTipo || "RUT",
    identificadorFiscalValor:
      profile.identificadorFiscalValor || profile.rut ||
      business.identificadorFiscalValor || business.rut || "",
    regionCodigo: profile.regionCodigo || business.regionCodigo || "",
    regionNombre:
      profile.regionNombre || profile.region || business.regionNombre || "",
    regionEstado:
      profile.regionEstado || profile.regionNombre || profile.region ||
      business.regionEstado || business.regionNombre || "",
    codigoPostal: profile.codigoPostal || business.codigoPostal || "",
    comunaCodigo: profile.comunaCodigo || business.comunaCodigo || "",
    comunaNombre:
      profile.comunaNombre || profile.ciudad || business.comunaNombre || "",
    ...quoteSettings,
    ...taxSettings,
    negocioId: userId,
  });
}

export async function getBusinessSettings(businessId, section) {
  if (!businessId) throw new Error("businessId es requerido para cargar ajustes.");
  const snapshot = await getDoc(
    doc(db, ...businessSettingsDocPath(businessId, section))
  );
  const raw = snapshot.data() || {};
  if (section === "impuestos") return normalizeTaxSettings(raw);
  if (section === "inventario") return normalizeInventorySettings(raw);
  if (section === "cotizaciones") {
    if (snapshot.exists()) return normalizeQuoteSettings(raw);
    const legacyProfile = await getDoc(doc(db, ...companyProfileDocPath(businessId)));
    return normalizeQuoteSettings(legacyProfile.data() || {});
  }
  throw new Error("La sección de configuración no es válida.");
}

export async function saveBusinessInformation(businessId, profile) {
  assertClientWriteAllowed("guardar la información de empresa");
  const callable = httpsCallable(functions, "updateBusinessInformation");
  const response = await callable({ businessId, profile });
  return normalizeCompanyProfile(response.data?.profile || {});
}

export async function saveBusinessSettings(businessId, section, settings) {
  assertClientWriteAllowed("guardar la configuración de empresa");
  const callable = httpsCallable(functions, "updateBusinessSettings");
  const response = await callable({ businessId, section, settings });
  if (section === "impuestos") return normalizeTaxSettings(response.data?.settings);
  if (section === "inventario") {
    return normalizeInventorySettings(response.data?.settings);
  }
  return normalizeQuoteSettings(response.data?.settings);
}

export async function getPersonalProfile(userId) {
  if (!userId) throw new Error("userId es requerido para cargar la cuenta.");
  const snapshot = await getDoc(doc(db, ...personalProfileDocPath(userId)));
  return normalizePersonalProfile(snapshot.data() || {});
}

export async function savePersonalProfile(userId, profile) {
  assertClientWriteAllowed("guardar el perfil personal");
  if (!userId) throw new Error("userId es requerido para guardar la cuenta.");
  const callable = httpsCallable(functions, "updatePersonalProfile");
  const response = await callable({ profile });
  return normalizePersonalProfile(response.data?.profile || profile);
}

export async function saveCompanyProfile(userId, profilePatch) {
  assertClientWriteAllowed("guardar el perfil de empresa");
  if (!userId) {
    throw new Error("userId es requerido para guardar el perfil de empresa.");
  }
  if (!profilePatch || typeof profilePatch !== "object") {
    throw new Error("profilePatch debe ser un objeto.");
  }

  const payload = normalizeCompanyProfile({
    ...DEFAULT_COMPANY_PROFILE,
    ...profilePatch,
    negocioId: userId,
  });
  delete payload.uidUsuario;
  ["logoUrl", "logoPath", "logoNombreOriginal", "logoActualizadoEn"].forEach(
    (field) => delete payload[field]
  );

  const callable = httpsCallable(functions, "updateBusinessProfile");
  const response = await callable({ businessId: userId, profile: payload });
  return normalizeCompanyProfile({
    ...profilePatch,
    ...response.data?.profile,
    negocioId: userId,
  });
}

export async function uploadCompanyLogo(userId, file) {
  assertClientWriteAllowed("subir archivos a Storage");
  if (!userId) {
    throw new Error("userId es requerido para subir el logo de empresa.");
  }
  if (!file) {
    throw new Error("Selecciona una imagen antes de subir el logo.");
  }
  if (!ALLOWED_COMPANY_LOGO_TYPES.includes(file.type)) {
    throw new Error("El logo debe ser PNG, JPG o WebP.");
  }
  if (file.size > MAX_COMPANY_LOGO_SIZE_BYTES) {
    throw new Error("El logo no puede pesar mas de 2 MB.");
  }

  const currentProfileSnapshot = await getDoc(
    doc(db, ...companyProfileDocPath(userId))
  );
  const previousLogoPath = safeString(currentProfileSnapshot.data()?.logoPath);
  const extension = getLogoExtension(file);
  if (!extension) {
    throw new Error("No fue posible identificar el formato del logo.");
  }
  const logoPath = `negocios/${userId}/empresa/logo/logo-empresa.${extension}`;
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
    negocioId: userId,
  };

  await setDoc(doc(db, ...companyProfileDocPath(userId)), payload, {
    merge: true,
  });

  if (previousLogoPath && previousLogoPath !== logoPath) {
    try {
      await deleteObject(storageRef(storage, previousLogoPath));
    } catch (error) {
      if (error?.code !== "storage/object-not-found" && import.meta.env.DEV) {
        console.warn("No fue posible retirar el logo anterior:", error);
      }
    }
  }

  return {
    logoUrl,
    logoPath,
    logoNombreOriginal: payload.logoNombreOriginal,
  };
}

export async function deleteCompanyLogo(userId, logoPath) {
  assertClientWriteAllowed("eliminar el logo de empresa");
  if (!userId) throw new Error("userId es requerido para eliminar el logo.");
  const normalizedPath = safeString(logoPath);
  if (normalizedPath) {
    try {
      await deleteObject(storageRef(storage, normalizedPath));
    } catch (error) {
      if (error?.code !== "storage/object-not-found") throw error;
    }
  }
  await updateDoc(doc(db, ...companyProfileDocPath(userId)), {
    logoUrl: deleteField(),
    logoPath: deleteField(),
    logoNombreOriginal: deleteField(),
    logoActualizadoEn: deleteField(),
    actualizadoEn: serverTimestamp(),
  });
}

export const obtenerConfigNegocio = getCompanyConfig;
export const guardarConfigNegocio = saveCompanyConfig;
export const DEFAULT_CONFIG = DEFAULT_COMPANY_CONFIG;
