import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {adaptStoredWorkOrder} from "../domain/workOrderModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {workOrderDocPath, workOrdersCollectionPath} from "../firebase/firestorePaths";

const functions = getFirebaseFunctions("us-central1");

function requireIdentifier(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    throw new Error(`${label} no es válido.`);
  }
  return normalized;
}

function callableErrorCode(error) {
  return String(error?.code || "").replace(/^functions\//, "");
}

export function createWorkOrderRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return `work-order-${globalThis.crypto.randomUUID()}`;
  }
  return `work-order-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getWorkOrderErrorMessage(error) {
  const code = callableErrorCode(error);
  const serverMessage = String(error?.message || "").trim();
  if (code === "unauthenticated") return "Debes iniciar sesión nuevamente.";
  if (code === "permission-denied") {
    return serverMessage || "Tu membresía no permite administrar órdenes de trabajo.";
  }
  if (code === "not-found") return serverMessage || "El vehículo ya no existe.";
  if (code === "already-exists") return serverMessage || "La solicitud ya fue utilizada.";
  if (["invalid-argument", "failed-precondition"].includes(code)) {
    return serverMessage || "No fue posible crear la orden de trabajo.";
  }
  if (["cancelled", "deadline-exceeded", "unavailable"].includes(code)) {
    return "No pudimos conectar con el servicio. Intenta nuevamente.";
  }
  return serverMessage || "No pudimos completar la operación con órdenes de trabajo.";
}

export async function listarOrdenesTrabajo(businessId) {
  const normalizedBusinessId = requireIdentifier(businessId, "El negocio activo");
  const reference = collection(
    db,
    ...workOrdersCollectionPath(normalizedBusinessId)
  );
  const snapshot = await getDocs(
    query(reference, where("negocioId", "==", normalizedBusinessId))
  );
  return snapshot.docs
    .map((item) => adaptStoredWorkOrder({...item.data(), id: item.id}))
    .sort((left, right) => right.numeroOT.localeCompare(left.numeroOT, "es-CL"));
}

export async function obtenerOrdenTrabajo(businessId, otId) {
  const snapshot = await getDoc(doc(
    db,
    ...workOrderDocPath(
      requireIdentifier(businessId, "El negocio activo"),
      requireIdentifier(otId, "La orden de trabajo"),
    ),
  ));
  if (!snapshot.exists()) return null;
  return adaptStoredWorkOrder({...snapshot.data(), id: snapshot.id});
}

export async function crearOrdenTrabajo(
  businessId,
  vehiculoId,
  requestId
) {
  assertCloudFunctionAllowed("crear órdenes de trabajo");
  const response = await httpsCallable(functions, "crearOrdenTrabajo")({
    businessId: requireIdentifier(businessId, "El negocio activo"),
    requestId: requireIdentifier(requestId, "La solicitud de creación"),
    ordenTrabajo: {
      vehiculoId: requireIdentifier(vehiculoId, "El vehículo"),
    },
  });
  return adaptStoredWorkOrder(response.data.ordenTrabajo);
}

export async function registrarRecepcionOrdenTrabajo(businessId, otId, recepcion) {
  assertCloudFunctionAllowed("registrar la recepción de una orden de trabajo");
  const response = await httpsCallable(functions, "registrarRecepcionOrdenTrabajo")({
    businessId: requireIdentifier(businessId, "El negocio activo"),
    otId: requireIdentifier(otId, "La orden de trabajo"),
    recepcion,
  });
  return adaptStoredWorkOrder(response.data.ordenTrabajo);
}
