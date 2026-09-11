import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {adaptStoredVehicle, buildVehicleMutationPayload} from "../domain/vehicleModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {vehicleDocPath, vehiclesCollectionPath} from "../firebase/firestorePaths";

const functions = getFirebaseFunctions("us-central1");

function requireIdentifier(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} es obligatorio.`);
  return normalized;
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return `vehicle-${globalThis.crypto.randomUUID()}`;
  return `vehicle-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function callableErrorCode(error) {
  return String(error?.code || "").replace(/^functions\//, "");
}

export function getVehicleErrorMessage(error) {
  const code = callableErrorCode(error);
  const serverMessage = String(error?.message || "").trim();
  if (code === "unauthenticated") return "Debes iniciar sesión nuevamente.";
  if (code === "permission-denied") return serverMessage || "Tu membresía no permite administrar vehículos.";
  if (code === "not-found") return serverMessage || "El vehículo o cliente ya no existe.";
  if (code === "already-exists") return serverMessage || "La patente o el VIN ya está registrado en este negocio.";
  if (["invalid-argument", "failed-precondition"].includes(code)) return serverMessage || "Revisa los datos del vehículo.";
  if (["cancelled", "deadline-exceeded", "unavailable"].includes(code)) return "No pudimos conectar con el servicio. Intenta nuevamente.";
  return serverMessage || "No pudimos completar la operación con vehículos.";
}

export async function listarVehiculos(businessId) {
  const normalizedBusinessId = requireIdentifier(businessId, "El negocio activo");
  const reference = collection(db, ...vehiclesCollectionPath(normalizedBusinessId));
  const snapshot = await getDocs(query(reference, where("negocioId", "==", normalizedBusinessId)));
  return snapshot.docs
    .map((item) => adaptStoredVehicle({...item.data(), id: item.id}))
    .sort((left, right) => left.patente.localeCompare(right.patente, "es-CL", {sensitivity: "base"}));
}

export async function obtenerVehiculo(businessId, vehiculoId) {
  const snapshot = await getDoc(doc(db, ...vehicleDocPath(
    requireIdentifier(businessId, "El negocio activo"),
    requireIdentifier(vehiculoId, "El vehículo"),
  )));
  if (!snapshot.exists()) return null;
  return adaptStoredVehicle({...snapshot.data(), id: snapshot.id});
}

export async function crearVehiculo(businessId, clienteId, raw) {
  assertCloudFunctionAllowed("crear vehículos");
  const response = await httpsCallable(functions, "crearVehiculo")({
    businessId: requireIdentifier(businessId, "El negocio activo"),
    requestId: createRequestId(),
    vehiculo: {...buildVehicleMutationPayload(raw), clienteId: requireIdentifier(clienteId, "El cliente")},
  });
  return adaptStoredVehicle(response.data.vehiculo);
}

export async function actualizarVehiculo(businessId, vehiculoId, raw) {
  assertCloudFunctionAllowed("editar vehículos");
  const response = await httpsCallable(functions, "actualizarVehiculo")({
    businessId: requireIdentifier(businessId, "El negocio activo"),
    vehiculoId: requireIdentifier(vehiculoId, "El vehículo"),
    vehiculo: buildVehicleMutationPayload(raw),
  });
  return adaptStoredVehicle(response.data.vehiculo);
}

export async function cambiarPropietarioVehiculo(businessId, vehiculoId, clienteId) {
  assertCloudFunctionAllowed("cambiar el propietario de un vehículo");
  const response = await httpsCallable(functions, "cambiarPropietarioVehiculo")({
    businessId: requireIdentifier(businessId, "El negocio activo"),
    vehiculoId: requireIdentifier(vehiculoId, "El vehículo"),
    clienteId: requireIdentifier(clienteId, "El cliente"),
  });
  return adaptStoredVehicle(response.data.vehiculo);
}
