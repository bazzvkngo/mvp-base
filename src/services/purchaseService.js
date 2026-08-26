import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {adaptStoredPurchase, buildPurchaseMutationPayload} from "../domain/purchaseModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {purchaseDocPath, purchasesCollectionPath} from "../firebase/firestorePaths";

const functions = getFirebaseFunctions("us-central1");
const businessId = (value) => { const id = String(value || "").trim(); if (!id) throw new Error("Selecciona un negocio activo."); return id; };
const purchaseId = (value) => { const id = String(value || "").trim(); if (!id) throw new Error("Selecciona una compra válida."); return id; };

export function createPurchaseRequestId(prefix = "purchase") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function message(error, fallback) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  const value = String(error?.message || "").trim();
  if (code === "permission-denied") return "Tu membresía no permite administrar compras.";
  if (code === "unauthenticated") return "Debes iniciar sesión nuevamente.";
  if (["invalid-argument", "failed-precondition", "not-found", "already-exists"].includes(code)) return value || fallback;
  if (["cancelled", "deadline-exceeded", "unavailable"].includes(code)) return "No pudimos conectar con el servicio. Intenta nuevamente.";
  return value || fallback;
}

async function call(name, payload, fallback) {
  assertCloudFunctionAllowed(name);
  try {
    const response = await httpsCallable(functions, name)(payload);
    return {...response.data, compra: adaptStoredPurchase(response.data?.compra || {})};
  } catch (error) {
    const normalized = new Error(message(error, fallback));
    normalized.code = String(error?.code || "").replace(/^functions\//, "");
    throw normalized;
  }
}

export async function listarCompras(value) {
  const id = businessId(value);
  const snapshot = await getDocs(query(collection(db, ...purchasesCollectionPath(id)), where("negocioId", "==", id)));
  return snapshot.docs.map((entry) => adaptStoredPurchase({id: entry.id, ...entry.data()})).sort((a, b) => (b.actualizadoEn?.toMillis?.() || 0) - (a.actualizadoEn?.toMillis?.() || 0));
}
export async function obtenerCompra(value, compraId) {
  const snapshot = await getDoc(doc(db, ...purchaseDocPath(businessId(value), purchaseId(compraId))));
  return snapshot.exists() ? adaptStoredPurchase({id: snapshot.id, ...snapshot.data()}) : null;
}
export const crearCompra = (value, raw, options = {}) => call("crearCompra", {businessId: businessId(value), requestId: options.requestId || createPurchaseRequestId("purchase-create"), compra: buildPurchaseMutationPayload(raw)}, "No pudimos crear la compra.");
export const crearCompraDesdeOrden = (value, ordenCompraId, options = {}) => call("crearCompraDesdeOrden", {businessId: businessId(value), ordenCompraId, requestId: options.requestId || createPurchaseRequestId("purchase-order")}, "No pudimos registrar la orden como compra.");
export const crearCompraDesdeRecepcion = (value, recepcionId, options = {}) => call("crearCompraDesdeRecepcion", {businessId: businessId(value), recepcionId, requestId: options.requestId || createPurchaseRequestId("purchase-reception")}, "No pudimos registrar la recepcion como compra.");
export const actualizarCompraBorrador = (value, compraId, raw) => call("actualizarCompraBorrador", {businessId: businessId(value), compraId: purchaseId(compraId), compra: buildPurchaseMutationPayload(raw)}, "No pudimos guardar el borrador.");
export const confirmarCompra = (value, compraId, options = {}) => call("confirmarCompra", {businessId: businessId(value), compraId: purchaseId(compraId), requestId: options.requestId || createPurchaseRequestId("purchase-confirm")}, "No pudimos confirmar la compra.");
export const cancelarCompraBorrador = (value, compraId) => call("cancelarCompraBorrador", {businessId: businessId(value), compraId: purchaseId(compraId)}, "No pudimos cancelar la compra.");
export const revertirCompra = (value, compraId, motivo, options = {}) => call("revertirCompra", {
  businessId: businessId(value),
  compraId: purchaseId(compraId),
  motivo: String(motivo || "").trim(),
  requestId: options.requestId || createPurchaseRequestId("purchase-reversal"),
}, "No pudimos revertir la compra.");
