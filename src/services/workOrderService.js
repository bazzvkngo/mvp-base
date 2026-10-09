import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {adaptStoredWorkOrder} from "../domain/workOrderModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {workOrderDiagnosesCollectionPath, workOrderDocPath, workOrderServicesCollectionPath, workOrdersCollectionPath} from "../firebase/firestorePaths";

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
  if (code === "aborted") return serverMessage || "El registro cambió en otra sesión. Actualiza la ficha.";
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

export async function listarDiagnosticos(businessId, otId) {
  const normalizedBusinessId = requireIdentifier(businessId, "El negocio activo");
  const normalizedOtId = requireIdentifier(otId, "La orden de trabajo");
  const reference = collection(db, ...workOrderDiagnosesCollectionPath(normalizedBusinessId, normalizedOtId));
  const snapshot = await getDocs(query(reference,
    where("negocioId", "==", normalizedBusinessId), where("otId", "==", normalizedOtId)));
  return snapshot.docs.map((item) => ({...item.data(), diagnosticoId: item.id}))
    .sort((left, right) => (left.creadoEn?.toMillis?.() || 0) - (right.creadoEn?.toMillis?.() || 0));
}

export async function listarPersonasAsignablesTaller(businessId) {
  assertCloudFunctionAllowed("consultar responsables de Taller");
  const response = await httpsCallable(functions, "listarPersonasAsignablesTaller")({
    businessId: requireIdentifier(businessId, "El negocio activo"),
  });
  return {
    personas: response.data.personas || [],
    actores: response.data.actores || [],
  };
}

async function diagnosisCall(name, operation, businessId, otId, payload) {
  assertCloudFunctionAllowed(operation);
  const response = await httpsCallable(functions, name)({
    businessId: requireIdentifier(businessId, "El negocio activo"),
    otId: requireIdentifier(otId, "La orden de trabajo"),
    ...payload,
  });
  return response.data;
}

export function obtenerResumenAprobacionOT(businessId, otId) {
  return diagnosisCall("obtenerResumenAprobacionOT", "consultar el alcance de la OT", businessId, otId, {});
}

export function ejecutarAccionAprobacionOT(businessId, otId, action, requestId, expectedActualizadoEn, motivo = "") {
  const calls = {enviar: "enviarOTAprobacion", aprobar: "aprobarOT", rechazar: "rechazarOT", revalidar: "revalidarDisponibilidadOT"};
  if (!calls[action]) throw new Error("Acción de aprobación no válida.");
  return diagnosisCall(calls[action], "gestionar la aprobación de la OT", businessId, otId, {
    requestId: requireIdentifier(requestId, "La solicitud"), expectedActualizadoEn, motivo,
  });
}

export function registrarDiagnostico(businessId, otId, diagnostico, requestId) {
  return diagnosisCall("registrarDiagnostico", "registrar un diagnóstico", businessId, otId, {
    requestId: requireIdentifier(requestId, "La solicitud de diagnóstico"), diagnostico,
  });
}

export function actualizarDiagnostico(businessId, otId, diagnosticoId, diagnostico, expectedActualizadoEn) {
  return diagnosisCall("actualizarDiagnostico", "actualizar un diagnóstico", businessId, otId, {
    diagnosticoId: requireIdentifier(diagnosticoId, "El diagnóstico"), diagnostico, expectedActualizadoEn,
  });
}

export function completarDiagnostico(businessId, otId, diagnosticoId, expectedActualizadoEn) {
  return diagnosisCall("completarDiagnostico", "completar un diagnóstico", businessId, otId, {
    diagnosticoId: requireIdentifier(diagnosticoId, "El diagnóstico"), expectedActualizadoEn,
  });
}

export async function listarServiciosOT(businessId, otId) {
  const normalizedBusinessId = requireIdentifier(businessId, "El negocio activo");
  const normalizedOtId = requireIdentifier(otId, "La orden de trabajo");
  const reference = collection(db, ...workOrderServicesCollectionPath(normalizedBusinessId, normalizedOtId));
  const snapshot = await getDocs(query(reference,
    where("negocioId", "==", normalizedBusinessId), where("otId", "==", normalizedOtId)));
  return snapshot.docs.map((item) => ({...item.data(), servicioOtId: item.id}))
    .sort((left, right) => (left.creadoEn?.toMillis?.() || 0) - (right.creadoEn?.toMillis?.() || 0));
}

export async function listarCatalogoTaller(businessId) {
  assertCloudFunctionAllowed("consultar catálogo Core para Taller");
  const response = await httpsCallable(functions, "listarCatalogoTaller")({
    businessId: requireIdentifier(businessId, "El negocio activo"),
  });
  return response.data.items || [];
}

export function crearServicioOT(businessId, otId, servicio, requestId) {
  return diagnosisCall("crearServicioOT", "agregar un servicio a la OT", businessId, otId, {
    requestId: requireIdentifier(requestId, "La solicitud de servicio"), servicio,
  });
}

export function actualizarServicioOT(businessId, otId, servicioOtId, servicio, expectedActualizadoEn) {
  return diagnosisCall("actualizarServicioOT", "actualizar un servicio de la OT", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"), servicio, expectedActualizadoEn,
  });
}

export function eliminarServicioOT(businessId, otId, servicioOtId, expectedActualizadoEn) {
  return diagnosisCall("eliminarServicioOT", "eliminar un servicio de la OT", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"), expectedActualizadoEn,
  });
}

export function iniciarServicioOT(businessId, otId, servicioOtId, expectedActualizadoEn, requestId) {
  return diagnosisCall("iniciarServicioOT", "iniciar un servicio de la OT", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"), expectedActualizadoEn,
    requestId: requireIdentifier(requestId, "La solicitud"),
  });
}

export function obtenerMaterialesOT(businessId, otId) {
  return diagnosisCall("obtenerMaterialesOT", "consultar consumos de la OT", businessId, otId, {});
}

export function registrarSalidaMaterialOT(businessId, otId, servicioOtId, itemId, cantidad, requestId) {
  return diagnosisCall("registrarSalidaMaterialOT", "registrar consumo", businessId, otId,
    {servicioOtId, itemId, cantidad, requestId});
}

export function registrarDevolucionMaterialOT(businessId, otId, servicioOtId, movimientoOrigenId, cantidad, requestId) {
  return diagnosisCall("registrarDevolucionMaterialOT", "registrar devolución", businessId, otId,
    {servicioOtId, movimientoOrigenId, cantidad, requestId});
}

export function completarServicioOT(businessId, otId, servicioOtId, expectedActualizadoEn, requestId) {
  return diagnosisCall("completarServicioOT", "completar un servicio de la OT", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"), expectedActualizadoEn,
    requestId: requireIdentifier(requestId, "La solicitud"),
  });
}

export function ejecutarCierreOT(businessId, otId, action, expectedActualizadoEn, requestId) {
  const calls = {finalizar: "finalizarReparacionOT", entregar: "registrarEntregaOT"};
  if (!calls[action]) throw new Error("Acción de cierre no válida.");
  return diagnosisCall(calls[action], "actualizar el cierre de la OT", businessId, otId, {
    expectedActualizadoEn, requestId: requireIdentifier(requestId, "La solicitud"),
  });
}

export async function obtenerEventosCierreOT(businessId, otId) {
  const response = await diagnosisCall("obtenerEventosCierreOT", "consultar la finalización y entrega", businessId, otId, {});
  return response.eventos || [];
}

export function agregarProductoOT(businessId, otId, servicioOtId, itemId, cantidad, requestId) {
  return diagnosisCall("agregarProductoOT", "planificar un producto", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"),
    itemId: requireIdentifier(itemId, "El producto Core"), cantidad,
    requestId: requireIdentifier(requestId, "La solicitud de producto"),
  });
}

export function actualizarProductoOT(businessId, otId, servicioOtId, productoOtId, cantidad, expectedActualizadoEn) {
  return diagnosisCall("actualizarProductoOT", "actualizar la cantidad planificada", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"),
    productoOtId: requireIdentifier(productoOtId, "El producto planificado"), cantidad, expectedActualizadoEn,
  });
}

export function eliminarProductoOT(businessId, otId, servicioOtId, productoOtId, expectedActualizadoEn) {
  return diagnosisCall("eliminarProductoOT", "eliminar un producto planificado", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"),
    productoOtId: requireIdentifier(productoOtId, "El producto planificado"), expectedActualizadoEn,
  });
}
