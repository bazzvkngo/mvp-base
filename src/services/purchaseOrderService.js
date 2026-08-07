import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {
  adaptStoredPurchaseOrder,
  buildPurchaseOrderMutationPayload,
} from "../domain/purchaseOrderModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {
  purchaseOrderDocPath,
  purchaseOrdersCollectionPath,
} from "../firebase/firestorePaths";

const functions = getFirebaseFunctions("us-central1");

function requireBusinessId(value) {
  const businessId = String(value || "").trim();
  if (!businessId) throw new Error("Selecciona un negocio activo.");
  return businessId;
}

function requireOrderId(value) {
  const orderId = String(value || "").trim();
  if (!orderId) throw new Error("Selecciona una orden de compra válida.");
  return orderId;
}

export function createPurchaseOrderRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return `purchase-order-${globalThis.crypto.randomUUID()}`;
  }
  return `purchase-order-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createPurchaseOrderDuplicateRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return `purchase-order-copy-${globalThis.crypto.randomUUID()}`;
  }
  return `purchase-order-copy-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function errorMessage(error, fallback) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  const message = String(error?.message || "").trim();
  if (code === "permission-denied") {
    return "Tu membresía no permite administrar órdenes de compra.";
  }
  if (code === "unauthenticated") return "Debes iniciar sesión nuevamente.";
  if (["invalid-argument", "failed-precondition", "not-found", "already-exists"].includes(code)) {
    return message || fallback;
  }
  if (["cancelled", "deadline-exceeded", "unavailable"].includes(code)) {
    return "No pudimos conectar con el servicio. Intenta nuevamente.";
  }
  return message || fallback;
}

async function callPurchaseOrder(functionName, payload, fallback) {
  assertCloudFunctionAllowed(functionName);
  try {
    const response = await httpsCallable(functions, functionName)(payload);
    return {
      ...response.data,
      ordenCompra: adaptStoredPurchaseOrder(response.data?.ordenCompra || {}),
    };
  } catch (error) {
    throw new Error(errorMessage(error, fallback));
  }
}

export async function listarOrdenesCompra(businessId) {
  const normalized = requireBusinessId(businessId);
  const reference = collection(db, ...purchaseOrdersCollectionPath(normalized));
  const snapshot = await getDocs(
    query(reference, where("negocioId", "==", normalized))
  );
  return snapshot.docs
    .map((orderDoc) => adaptStoredPurchaseOrder({id: orderDoc.id, ...orderDoc.data()}))
    .sort((left, right) => {
      const leftDate = left.actualizadoEn?.toMillis?.() || 0;
      const rightDate = right.actualizadoEn?.toMillis?.() || 0;
      return rightDate - leftDate || right.numero.localeCompare(left.numero, "es-CL");
    });
}

export async function obtenerOrdenCompra(businessId, ordenCompraId) {
  const snapshot = await getDoc(doc(
    db,
    ...purchaseOrderDocPath(
      requireBusinessId(businessId),
      requireOrderId(ordenCompraId)
    )
  ));
  return snapshot.exists()
    ? adaptStoredPurchaseOrder({id: snapshot.id, ...snapshot.data()})
    : null;
}

export function crearOrdenCompra(businessId, raw, options = {}) {
  return callPurchaseOrder("crearOrdenCompra", {
    businessId: requireBusinessId(businessId),
    requestId: options.requestId || createPurchaseOrderRequestId(),
    ordenCompra: buildPurchaseOrderMutationPayload(raw),
  }, "No pudimos crear la orden de compra.");
}

export function duplicarOrdenCompraComoBorrador(
  businessId,
  sourceId,
  options = {}
) {
  return callPurchaseOrder("duplicarOrdenCompraComoBorrador", {
    businessId: requireBusinessId(businessId),
    sourceId: requireOrderId(sourceId),
    requestId: options.requestId || createPurchaseOrderDuplicateRequestId(),
  }, "No pudimos duplicar la orden de compra.");
}

export function actualizarOrdenCompraBorrador(businessId, ordenCompraId, raw) {
  return callPurchaseOrder("actualizarOrdenCompraBorrador", {
    businessId: requireBusinessId(businessId),
    ordenCompraId: requireOrderId(ordenCompraId),
    ordenCompra: buildPurchaseOrderMutationPayload(raw),
  }, "No pudimos guardar el borrador.");
}

export function emitirOrdenCompra(businessId, ordenCompraId) {
  return callPurchaseOrder("emitirOrdenCompra", {
    businessId: requireBusinessId(businessId),
    ordenCompraId: requireOrderId(ordenCompraId),
  }, "No pudimos emitir la orden de compra.");
}

export function cancelarOrdenCompra(businessId, ordenCompraId) {
  return callPurchaseOrder("cancelarOrdenCompra", {
    businessId: requireBusinessId(businessId),
    ordenCompraId: requireOrderId(ordenCompraId),
  }, "No pudimos cancelar la orden de compra.");
}
