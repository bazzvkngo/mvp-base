import {collection, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {adaptStoredWorkshopPlaza} from "../domain/workshopPlazaModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {workshopPlazasCollectionPath} from "../firebase/firestorePaths";

const functions = getFirebaseFunctions("us-central1");

function requireIdentifier(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) throw new Error(`${label} no es válido.`);
  return normalized;
}

function callableErrorCode(error) {
  return String(error?.code || "").replace(/^functions\//, "");
}

export function createWorkshopPlazaRequestId() {
  if (globalThis.crypto?.randomUUID) return `plaza-${globalThis.crypto.randomUUID()}`;
  return `plaza-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getWorkshopPlazaErrorMessage(error) {
  const code = callableErrorCode(error);
  const message = String(error?.message || "").trim();
  if (code === "unauthenticated") return "Debes iniciar sesión nuevamente.";
  if (code === "permission-denied") return message || "No tienes permisos para realizar esta acción en Taller.";
  if (code === "not-found") return message || "La Plaza o la OT ya no existe.";
  if (code === "already-exists") return message || "La solicitud ya fue utilizada.";
  if (code === "aborted") return message || "La información cambió en otra sesión. Actualiza e intenta nuevamente.";
  if (["invalid-argument", "failed-precondition"].includes(code)) return message || "No fue posible completar la operación con la Plaza.";
  if (["cancelled", "deadline-exceeded", "unavailable"].includes(code)) return "No pudimos conectar con el servicio. Intenta nuevamente.";
  return message || "No pudimos completar la operación con Plazas.";
}

export async function listarPlazasTaller(businessId) {
  const normalizedBusinessId = requireIdentifier(businessId, "El negocio activo");
  const snapshot = await getDocs(query(
    collection(db, ...workshopPlazasCollectionPath(normalizedBusinessId)),
    where("negocioId", "==", normalizedBusinessId),
  ));
  return snapshot.docs.map((item) => adaptStoredWorkshopPlaza({...item.data(), id: item.id}))
    .sort((left, right) => left.nombre.localeCompare(right.nombre, "es-CL"));
}

async function plazaCall(name, operation, businessId, payload) {
  assertCloudFunctionAllowed(operation);
  const response = await httpsCallable(functions, name)({
    businessId: requireIdentifier(businessId, "El negocio activo"),
    ...payload,
  });
  return response.data;
}

export function crearPlazaTaller(businessId, nombre, requestId) {
  return plazaCall("crearPlazaTaller", "crear una Plaza", businessId, {
    requestId: requireIdentifier(requestId, "La solicitud"), plaza: {nombre},
  });
}

export function actualizarPlazaTaller(businessId, plazaId, nombre, expectedActualizadoEn) {
  return plazaCall("actualizarPlazaTaller", "actualizar una Plaza", businessId, {
    plazaId: requireIdentifier(plazaId, "La Plaza"), plaza: {nombre}, expectedActualizadoEn,
  });
}

export function cambiarEstadoPlazaTaller(businessId, plazaId, estado, expectedActualizadoEn) {
  const calls = {activa: "activarPlazaTaller", inactiva: "inactivarPlazaTaller"};
  if (!calls[estado]) throw new Error("El estado de la Plaza no es válido.");
  return plazaCall(calls[estado], `${estado === "activa" ? "activar" : "inactivar"} una Plaza`, businessId, {
    plazaId: requireIdentifier(plazaId, "La Plaza"), expectedActualizadoEn,
  });
}

export function asignarPlazaOT(businessId, otId, plazaId, expectedActualizadoEn) {
  return plazaCall("asignarPlazaOT", "asignar una Plaza a la OT", businessId, {
    otId: requireIdentifier(otId, "La orden de trabajo"),
    plazaId: requireIdentifier(plazaId, "La Plaza"),
    expectedActualizadoEn,
  });
}

export function liberarPlazaOT(businessId, otId, expectedActualizadoEn) {
  return plazaCall("liberarPlazaOT", "liberar la Plaza de la OT", businessId, {
    otId: requireIdentifier(otId, "La orden de trabajo"), expectedActualizadoEn,
  });
}
