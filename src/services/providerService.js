import {collection, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {
  PROVIDER_DELETE_CONFIRMATION_WORD,
  adaptStoredProvider,
  buildProviderMutationPayload,
  isProviderDeleteConfirmed,
} from "../domain/providerModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {providersCollectionPath} from "../firebase/firestorePaths";

const functions = getFirebaseFunctions("us-central1");

function requireBusinessId(businessId) {
  if (typeof businessId !== "string" || !businessId.trim()) {
    throw new Error("Selecciona un negocio activo.");
  }
  return businessId.trim();
}

function requireProviderId(proveedorId) {
  if (typeof proveedorId !== "string" || !proveedorId.trim()) {
    throw new Error("Selecciona un proveedor válido.");
  }
  return proveedorId.trim();
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return `provider-${globalThis.crypto.randomUUID()}`;
  }
  return `provider-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function callableErrorCode(error) {
  return String(error?.code || "").replace(/^functions\//, "");
}

export function getProviderErrorMessage(error) {
  const code = callableErrorCode(error);
  const serverMessage = String(error?.message || "").trim();

  if (code === "unauthenticated") return "Debes iniciar sesión nuevamente.";
  if (code === "permission-denied") {
    if (serverMessage && !/missing|insufficient/i.test(serverMessage)) {
      return serverMessage;
    }
    return "Tu membresía no permite administrar proveedores de este negocio.";
  }
  if (code === "not-found") return "El proveedor ya no existe.";
  if (code === "already-exists") {
    return serverMessage || "Ya existe un proveedor con esta identificación fiscal en el negocio.";
  }
  if (code === "invalid-argument" || code === "failed-precondition") {
    return serverMessage || "Los datos del proveedor no son válidos.";
  }
  if (["cancelled", "deadline-exceeded", "unavailable"].includes(code)) {
    return "No pudimos conectar con el servicio. Intenta nuevamente.";
  }
  if (!code && serverMessage) return serverMessage;
  return "No pudimos completar la operación con proveedores.";
}

export async function listarProveedores(businessId) {
  const normalizedBusinessId = requireBusinessId(businessId);
  const reference = collection(
    db,
    ...providersCollectionPath(normalizedBusinessId)
  );
  const snapshot = await getDocs(
    query(reference, where("negocioId", "==", normalizedBusinessId))
  );

  return snapshot.docs
    .map((providerDoc) =>
      adaptStoredProvider({...providerDoc.data(), id: providerDoc.id})
    )
    .sort((left, right) =>
      left.razonSocial.localeCompare(right.razonSocial, "es-CL", {
        sensitivity: "base",
      })
    );
}

export async function crearProveedor(businessId, raw) {
  assertCloudFunctionAllowed("crear proveedores");
  const callable = httpsCallable(functions, "crearProveedor");
  const response = await callable({
    businessId: requireBusinessId(businessId),
    requestId: createRequestId(),
    proveedor: buildProviderMutationPayload(raw),
  });
  return adaptStoredProvider(response.data.proveedor);
}

export async function actualizarProveedor(businessId, proveedorId, raw) {
  assertCloudFunctionAllowed("editar proveedores");
  const callable = httpsCallable(functions, "actualizarProveedor");
  const response = await callable({
    businessId: requireBusinessId(businessId),
    proveedorId: requireProviderId(proveedorId),
    proveedor: buildProviderMutationPayload(raw),
  });
  return adaptStoredProvider(response.data.proveedor);
}

export async function archivarProveedor(businessId, proveedorId) {
  assertCloudFunctionAllowed("archivar proveedores");
  const callable = httpsCallable(functions, "archivarProveedor");
  const response = await callable({
    businessId: requireBusinessId(businessId),
    proveedorId: requireProviderId(proveedorId),
  });
  return response.data;
}

// Eliminación permanente: la palabra de confirmación se valida aquí y otra vez
// en la Function, que además rechaza si el proveedor tiene movimientos.
export async function eliminarProveedor(businessId, proveedorId, confirmacion) {
  assertCloudFunctionAllowed("eliminar proveedores");
  if (!isProviderDeleteConfirmed(confirmacion)) {
    throw new Error(`Escribe «${PROVIDER_DELETE_CONFIRMATION_WORD}» para confirmar la eliminación.`);
  }
  const callable = httpsCallable(functions, "eliminarProveedor");
  const response = await callable({
    businessId: requireBusinessId(businessId),
    proveedorId: requireProviderId(proveedorId),
    confirmacion,
  });
  return response.data;
}

export async function reactivarProveedor(businessId, proveedorId) {
  assertCloudFunctionAllowed("reactivar proveedores");
  const callable = httpsCallable(functions, "reactivarProveedor");
  const response = await callable({
    businessId: requireBusinessId(businessId),
    proveedorId: requireProviderId(proveedorId),
  });
  return response.data;
}
