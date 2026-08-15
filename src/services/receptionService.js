import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {adaptStoredReception, buildReceptionMutationPayload} from "../domain/receptionModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {receptionDocPath, receptionsCollectionPath} from "../firebase/firestorePaths";

const functions = getFirebaseFunctions("us-central1");
const required = (value, label) => {
  const result = String(value || "").trim();
  if (!result) throw new Error(`Selecciona ${label}.`);
  return result;
};

export function createReceptionRequestId(prefix = "reception") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

async function call(name, payload, fallback) {
  assertCloudFunctionAllowed(name);
  try {
    const response = await httpsCallable(functions, name)(payload);
    return {...response.data, recepcion: adaptStoredReception(response.data?.recepcion || {})};
  } catch (error) {
    const value = String(error?.message || "").trim();
    const normalized = new Error(value || fallback);
    normalized.code = String(error?.code || "").replace(/^functions\//, "");
    throw normalized;
  }
}

export async function listarRecepciones(businessId) {
  const id = required(businessId, "un negocio activo");
  const snapshot = await getDocs(query(
    collection(db, ...receptionsCollectionPath(id)),
    where("negocioId", "==", id)
  ));
  return snapshot.docs.map((entry) => adaptStoredReception({id: entry.id, ...entry.data()}))
    .sort((a, b) => (b.actualizadoEn?.toMillis?.() || 0) - (a.actualizadoEn?.toMillis?.() || 0));
}

export async function obtenerRecepcion(businessId, recepcionId) {
  const snapshot = await getDoc(doc(db, ...receptionDocPath(
    required(businessId, "un negocio activo"),
    required(recepcionId, "una recepcion valida")
  )));
  return snapshot.exists() ? adaptStoredReception({id: snapshot.id, ...snapshot.data()}) : null;
}

export const crearRecepcionDesdeOrden = (businessId, ordenCompraId, options = {}) =>
  call("crearRecepcionDesdeOrden", {
    businessId: required(businessId, "un negocio activo"),
    ordenCompraId: required(ordenCompraId, "una orden valida"),
    requestId: options.requestId || createReceptionRequestId("reception-create"),
  }, "No pudimos preparar la recepcion.");

export const actualizarRecepcionBorrador = (businessId, recepcionId, raw) =>
  call("actualizarRecepcionBorrador", {
    businessId: required(businessId, "un negocio activo"),
    recepcionId: required(recepcionId, "una recepcion valida"),
    recepcion: buildReceptionMutationPayload(raw),
  }, "No pudimos guardar la recepcion.");

export const confirmarRecepcion = (businessId, recepcionId, options = {}) =>
  call("confirmarRecepcion", {
    businessId: required(businessId, "un negocio activo"),
    recepcionId: required(recepcionId, "una recepcion valida"),
    requestId: options.requestId || createReceptionRequestId("reception-confirm"),
  }, "No pudimos confirmar la recepcion.");

export const cancelarRecepcionBorrador = (businessId, recepcionId) =>
  call("cancelarRecepcionBorrador", {
    businessId: required(businessId, "un negocio activo"),
    recepcionId: required(recepcionId, "una recepcion valida"),
  }, "No pudimos cancelar la recepcion.");
