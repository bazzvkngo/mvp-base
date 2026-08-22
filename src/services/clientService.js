import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { assertClientWriteAllowed } from "../config/firebaseEnvironment.mjs";
import {
  adaptStoredClient,
  buildClientMutationPayload,
} from "../domain/clientModel.mjs";
import { db, getFirebaseFunctions } from "../firebase/firebaseConfig";
import { clientsCollectionPath } from "../firebase/firestorePaths";

const functions = getFirebaseFunctions("us-central1");

function requireBusinessId(businessId) {
  if (typeof businessId !== "string" || !businessId.trim()) {
    throw new Error("Selecciona un negocio activo.");
  }
  return businessId.trim();
}

function requireClienteId(clienteId) {
  if (typeof clienteId !== "string" || !clienteId.trim()) {
    throw new Error("Selecciona un cliente válido.");
  }
  return clienteId.trim();
}

function callableErrorCode(error) {
  return String(error?.code || "").replace(/^functions\//, "");
}

export function getClientErrorMessage(error) {
  const code = callableErrorCode(error);
  const serverMessage = String(error?.message || "").trim();

  if (code === "unauthenticated") return "Debes iniciar sesión nuevamente.";
  if (code === "permission-denied") {
    if (serverMessage && !/missing|insufficient/i.test(serverMessage)) {
      return serverMessage;
    }
    return "Tu membresía no permite acceder a los clientes de este negocio.";
  }
  if (code === "not-found") return "El cliente ya no existe.";
  if (code === "already-exists") {
    return serverMessage || "Ya existe un cliente con esta identificación fiscal en el negocio.";
  }
  if (code === "invalid-argument" || code === "failed-precondition") {
    return serverMessage || "Los datos del cliente no son válidos.";
  }
  if (["cancelled", "deadline-exceeded", "unavailable"].includes(code)) {
    return "No pudimos conectar con el servicio. Intenta nuevamente.";
  }
  if (!code && serverMessage) return serverMessage;
  return "No pudimos completar la operación con clientes.";
}

export async function listarClientes(businessId) {
  const normalizedBusinessId = requireBusinessId(businessId);
  const reference = collection(
    db,
    ...clientsCollectionPath(normalizedBusinessId)
  );
  const snapshot = await getDocs(
    query(reference, where("negocioId", "==", normalizedBusinessId))
  );

  return snapshot.docs
    .map((clientDoc) =>
      adaptStoredClient({...clientDoc.data(), id: clientDoc.id})
    )
    .sort((left, right) =>
      left.nombreRazonSocial.localeCompare(
        right.nombreRazonSocial,
        "es-CL",
        {sensitivity: "base"}
      )
    );
}

export async function crearCliente(businessId, raw) {
  assertClientWriteAllowed("crear clientes");
  const callable = httpsCallable(functions, "crearCliente");
  const response = await callable({
    businessId: requireBusinessId(businessId),
    cliente: buildClientMutationPayload(raw),
  });
  return adaptStoredClient(response.data.cliente);
}

export async function actualizarCliente(businessId, clienteId, raw) {
  assertClientWriteAllowed("editar clientes");
  const callable = httpsCallable(functions, "actualizarCliente");
  const response = await callable({
    businessId: requireBusinessId(businessId),
    clienteId: requireClienteId(clienteId),
    cliente: buildClientMutationPayload(raw),
  });
  return adaptStoredClient(response.data.cliente);
}

export async function archivarCliente(businessId, clienteId) {
  assertClientWriteAllowed("archivar clientes");
  const callable = httpsCallable(functions, "archivarCliente");
  const response = await callable({
    businessId: requireBusinessId(businessId),
    clienteId: requireClienteId(clienteId),
  });
  return response.data;
}

export async function reactivarCliente(businessId, clienteId) {
  assertClientWriteAllowed("reactivar clientes");
  const callable = httpsCallable(functions, "reactivarCliente");
  const response = await callable({
    businessId: requireBusinessId(businessId),
    clienteId: requireClienteId(clienteId),
  });
  return response.data;
}
