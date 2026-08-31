import {httpsCallable} from "firebase/functions";
import {getFirebaseFunctions} from "../firebase/firebaseConfig";
import {hasPlatformSuperadminClaim} from "../domain/platformAccess.mjs";

const functions = getFirebaseFunctions("us-central1");

async function call(name, data = {}) {
  const callable = httpsCallable(functions, name);
  const response = await callable(data);
  return response.data;
}

export async function getPlatformAccess(user, forceRefresh = false) {
  if (!user) return {isSuperadmin: false, role: null};
  const token = await user.getIdTokenResult(forceRefresh);
  return {
    isSuperadmin: hasPlatformSuperadminClaim(token.claims),
    role: token.claims.platformRole || null,
  };
}

export const getPlatformSummary = () => call("obtenerResumenPlataforma");

export const listPlatformBusinesses = ({
  cursor,
  limit = 20,
  search = "",
  country = "TODOS",
  state = "TODOS",
  verification = "TODAS",
  mode = "EMPRESAS",
} = {}) => call("listarEmpresasPlataforma", {
  cursor: cursor || "",
  limite: limit,
  busqueda: search,
  pais: country,
  estado: state,
  verificacion: verification,
  modo: mode,
});

export const getPlatformBusiness = (businessId) =>
  call("obtenerEmpresaPlataforma", {businessId});

export function getSafePlatformDocumentUrl(value) {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) throw new Error("El documento no entregó una URL válida.");
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("El documento no entregó una URL válida.");
  }
  const localEmulator = parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localEmulator) {
    throw new Error("El documento no entregó una URL segura.");
  }
  return parsed.href;
}

export async function getPlatformVerificationDocument(businessId, solicitudId) {
  const evidence = await call(
    "obtenerDocumentoVerificacionPlataforma",
    {businessId, solicitudId}
  );
  return {...evidence, url: getSafePlatformDocumentUrl(evidence?.url)};
}

export const listPlatformUsers = ({
  cursor,
  limit = 20,
  search = "",
  state = "TODOS",
  company = "TODAS",
} = {}) => call("listarUsuariosPlataforma", {
  cursor: cursor || "",
  limite: limit,
  busqueda: search,
  estado: state,
  empresa: company,
});

export const getPlatformUser = (uid) =>
  call("obtenerUsuarioPlataforma", {uid});

export const setPlatformBusinessStatus = ({businessId, estado, motivo, requestId}) =>
  call("cambiarEstadoEmpresaPlataforma", {businessId, estado, motivo, requestId});

export const setPlatformUserStatus = ({uid, estado, motivo, requestId}) =>
  call("cambiarEstadoUsuarioPlataforma", {uid, estado, motivo, requestId});

export const permanentlyDeletePlatformBusiness = ({
  businessId,
  confirmationName,
  requestId,
}) => call("eliminarEmpresaPermanentePlataforma", {
  businessId,
  confirmacionNombreComercial: confirmationName,
  requestId,
});

export const resolvePlatformVerification = ({
  businessId,
  solicitudId,
  decision,
  motivo,
  razonSocialOficial,
  requestId,
}) => call("resolverVerificacionEmpresa", {
  businessId,
  solicitudId,
  decision,
  motivo,
  razonSocialOficial,
  requestId,
});

export function createPlatformRequestId(prefix = "platform") {
  const random = globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${String(random).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 120);
}
