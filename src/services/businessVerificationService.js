import {httpsCallable} from "firebase/functions";
import {getMetadata, ref as storageRef, uploadBytes} from "firebase/storage";
import {assertClientWriteAllowed} from "../config/firebaseEnvironment.mjs";
import {getFirebaseFunctions, storage} from "../firebase/firebaseConfig";

export const BUSINESS_VERIFICATION_STATES = Object.freeze({
  NOT_VERIFIED: "NO_VERIFICADA",
  PENDING: "PENDIENTE",
  VERIFIED: "VERIFICADA",
  REJECTED: "RECHAZADA",
});
export const BUSINESS_VERIFICATION_STATUS_LABELS = Object.freeze({
  NO_VERIFICADA: "Empresa no verificada",
  PENDIENTE: "Verificación en revisión",
  VERIFICADA: "Empresa verificada",
  RECHAZADA: "Verificación empresarial rechazada",
});
export const VERIFICATION_EVIDENCE_TYPES = Object.freeze([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
export const MAX_VERIFICATION_EVIDENCE_BYTES = 5 * 1024 * 1024;

const functions = getFirebaseFunctions("us-central1");

export function createBusinessVerificationRequestId() {
  const value = globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `business_verification_${String(value).replace(/[^a-zA-Z0-9_-]/g, "")}`
    .slice(0, 120);
}

export function normalizeBusinessVerification(raw = {}) {
  const legacyState = String(raw.estado || "").trim().toUpperCase();
  const normalizedState = legacyState === "EN_REVISION"
    ? BUSINESS_VERIFICATION_STATES.PENDING
    : legacyState;
  const estado = Object.values(BUSINESS_VERIFICATION_STATES).includes(normalizedState)
    ? normalizedState
    : BUSINESS_VERIFICATION_STATES.NOT_VERIFIED;
  return {
    ...raw,
    estado,
    solicitudIdActual: String(raw.solicitudIdActual || "").trim(),
    motivoRechazo: String(raw.motivoRechazo || "").trim(),
  };
}

function evidenceExtension(type) {
  if (type === "application/pdf") return "pdf";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  return "";
}

function validateEvidence(file) {
  if (!file) return;
  if (!VERIFICATION_EVIDENCE_TYPES.includes(file.type)) {
    throw new Error("El documento debe ser PDF, JPG o PNG.");
  }
  if (file.size <= 0 || file.size > MAX_VERIFICATION_EVIDENCE_BYTES) {
    throw new Error("El documento acreditativo no puede superar 5 MB.");
  }
}

async function uploadEvidence({businessId, file, requestId, uid}) {
  if (!file) return null;
  validateEvidence(file);
  const extension = evidenceExtension(file.type);
  const path = `negocios/${businessId}/verificacion/${uid}/${requestId}/documento.${extension}`;
  const reference = storageRef(storage, path);
  let metadata;
  try {
    metadata = await getMetadata(reference);
  } catch (error) {
    if (error?.code !== "storage/object-not-found") throw error;
    const result = await uploadBytes(reference, file, {
      contentType: file.type,
      customMetadata: {nombreOriginal: String(file.name || "documento")},
    });
    metadata = result.metadata;
  }
  return {
    ruta: path,
    nombreOriginal: String(file.name || metadata.customMetadata?.nombreOriginal || "documento"),
    tipoContenido: metadata.contentType || file.type,
    tamanoBytes: Number(metadata.size || file.size),
  };
}

export async function requestBusinessVerification({
  businessId,
  file,
  requestId,
  solicitud,
  uid,
}) {
  assertClientWriteAllowed("solicitar la verificación empresarial");
  if (!businessId || !uid || !requestId) {
    throw new Error("No fue posible identificar la empresa o la solicitud.");
  }
  const documentoAcreditativo = await uploadEvidence({
    businessId,
    file,
    requestId,
    uid,
  });
  const callable = httpsCallable(functions, "solicitarVerificacionEmpresa");
  const response = await callable({
    businessId,
    requestId,
    solicitud: {
      ...solicitud,
      ...(documentoAcreditativo ? {documentoAcreditativo} : {}),
    },
  });
  return response.data;
}
