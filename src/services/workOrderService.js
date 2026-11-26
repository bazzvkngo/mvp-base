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

// Al aprobar se elige el responsable de la OT: solo él, el Administrador o el Owner operan los trabajos.
export function ejecutarAccionAprobacionOT(businessId, otId, action, requestId, expectedActualizadoEn, motivo = "", responsableUid = "") {
  const calls = {enviar: "enviarOTAprobacion", aprobar: "aprobarOT", rechazar: "rechazarOT", revalidar: "revalidarDisponibilidadOT"};
  if (!calls[action]) throw new Error("Acción de aprobación no válida.");
  return diagnosisCall(calls[action], "gestionar la aprobación de la OT", businessId, otId, {
    requestId: requireIdentifier(requestId, "La solicitud"), expectedActualizadoEn, motivo,
    ...(action === "aprobar" ? {responsableUid: requireIdentifier(responsableUid, "El responsable de la OT")} : {}),
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
  assertCloudFunctionAllowed("consultar catálogo de Inventario para Taller");
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

export function completarServicioOT(businessId, otId, servicioOtId, expectedActualizadoEn, requestId) {
  return diagnosisCall("completarServicioOT", "completar un servicio de la OT", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"), expectedActualizadoEn,
    requestId: requireIdentifier(requestId, "La solicitud"),
  });
}

export function reabrirServicioOT(businessId, otId, servicioOtId, expectedActualizadoEn, requestId) {
  return diagnosisCall("reabrirServicioOT", "reabrir un trabajo de la OT", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"), expectedActualizadoEn,
    requestId: requireIdentifier(requestId, "La solicitud"),
  });
}

// modo: «cliente» (los repuestos los trae el cliente) o «ninguno» (el trabajo no requiere repuestos).
export function definirRepuestosServicioOT(businessId, otId, servicioOtId, modo, expectedActualizadoEn) {
  return diagnosisCall("definirRepuestosServicioOT", "definir los repuestos de un trabajo", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"), modo, expectedActualizadoEn,
  });
}

export function ejecutarCierreOT(businessId, otId, action, expectedActualizadoEn, requestId, motivo = "", entrega = null) {
  const calls = {finalizar: "finalizarReparacionOT", entregar: "registrarEntregaOT", cancelar: "cancelarOT"};
  if (!calls[action]) throw new Error("Acción de cierre no válida.");
  return diagnosisCall(calls[action], "actualizar el cierre de la OT", businessId, otId, {
    expectedActualizadoEn, requestId: requireIdentifier(requestId, "La solicitud"),
    ...(action === "cancelar" && String(motivo || "").trim() ? {motivo: String(motivo).trim()} : {}),
    ...(action === "entregar" && entrega ? {entrega} : {}),
  });
}

export async function obtenerEventosCierreOT(businessId, otId) {
  const response = await diagnosisCall("obtenerEventosCierreOT", "consultar la finalización y entrega", businessId, otId, {});
  return response.eventos || [];
}

export async function obtenerHistorialOT(businessId, otId) {
  const response = await diagnosisCall("obtenerHistorialOT", "consultar el historial de la OT", businessId, otId, {});
  return response.eventos || [];
}

export function agregarProductoOT(businessId, otId, servicioOtId, itemId, cantidad, requestId) {
  return diagnosisCall("agregarProductoOT", "planificar un producto", businessId, otId, {
    servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"),
    itemId: requireIdentifier(itemId, "El producto de Inventario"), cantidad,
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

// Fotos de recepción: la imagen se envía como JPEG en base64 y solo se lee a través de la Function.
// Cada zona se fotografía una vez y queda sellada; las zonas exteriores llevan sus daños.
export function subirFotoRecepcionOT(businessId, otId, zona, imagen, danos) {
  return diagnosisCall("fotosRecepcionOT", "registrar una foto de recepción", businessId, otId, {
    operacion: "subir", zona, imagen, ...(danos ? {danos} : {}),
  });
}

export async function leerFotoRecepcionOT(businessId, otId, zona) {
  const response = await diagnosisCall("fotosRecepcionOT", "ver una foto de recepción", businessId, otId, {
    operacion: "leer", zona,
  });
  return response.imagen || "";
}

// Fotos «antes» y «después» de un trabajo (opcionales). Misma regla que las de recepción: sellada, sin editar.
export function subirFotoServicioOT(businessId, otId, servicioOtId, momento, imagen) {
  return diagnosisCall("fotosServicioOT", "registrar una foto del trabajo", businessId, otId, {
    operacion: "subir", servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"), momento, imagen,
  });
}

// Entrega con trazabilidad: siete fotos selladas, acta de quien retira (solo Owner/Administrador) y contacto con el cliente.
export function subirFotoEntregaOT(businessId, otId, zona, imagen) {
  return diagnosisCall("entregaOT", "registrar la foto de entrega", businessId, otId, {operacion: "subir", zona, imagen});
}

export function leerFotoEntregaOT(businessId, otId, zona) {
  return diagnosisCall("entregaOT", "ver la foto de entrega", businessId, otId, {operacion: "leer", zona});
}

export function obtenerEstadoEntregaOT(businessId, otId) {
  return diagnosisCall("entregaOT", "consultar la entrega", businessId, otId, {operacion: "estado"});
}

export function obtenerActaEntregaOT(businessId, otId) {
  return diagnosisCall("entregaOT", "consultar el acta de entrega", businessId, otId, {operacion: "acta"});
}

// Enlace único de seguimiento para el cliente y dirección de consulta con patente + RUT (se crea con el ingreso aprobado).
export function obtenerSeguimientoOT(businessId, otId) {
  return diagnosisCall("seguimientoOT", "preparar el seguimiento del cliente", businessId, otId, {operacion: "enlace"});
}

export function obtenerIngresoRecepcionOT(businessId, otId) {
  return diagnosisCall("entregaOT", "consultar quién entregó el vehículo", businessId, otId, {operacion: "ingreso"});
}

export function obtenerContactoClienteOT(businessId, otId) {
  return diagnosisCall("entregaOT", "consultar el contacto del cliente", businessId, otId, {operacion: "contacto"});
}

// Hallazgos: observaciones de la ejecución con foto obligatoria. Solo Owner/Administrador las convierten en trabajo.
export function reportarHallazgoOT(businessId, otId, {descripcion, urgente, imagen}, requestId) {
  return diagnosisCall("hallazgosOT", "reportar el hallazgo", businessId, otId, {
    operacion: "reportar", requestId: requireIdentifier(requestId, "La solicitud"), descripcion, urgente, imagen,
  });
}

export async function listarHallazgosOT(businessId, otId) {
  const response = await diagnosisCall("hallazgosOT", "consultar los hallazgos", businessId, otId, {operacion: "listar"});
  return response.hallazgos || [];
}

export async function leerFotoHallazgoOT(businessId, otId, hallazgoId) {
  const response = await diagnosisCall("hallazgosOT", "ver la foto del hallazgo", businessId, otId, {
    operacion: "foto", hallazgoId: requireIdentifier(hallazgoId, "El hallazgo"),
  });
  return response;
}

export function convertirHallazgoOT(businessId, otId, hallazgoId, itemId, requestId) {
  return diagnosisCall("hallazgosOT", "convertir el hallazgo en trabajo", businessId, otId, {
    operacion: "convertir", hallazgoId: requireIdentifier(hallazgoId, "El hallazgo"),
    itemId: requireIdentifier(itemId, "El servicio"), requestId: requireIdentifier(requestId, "La solicitud"),
  });
}

export async function leerFotoServicioOT(businessId, otId, servicioOtId, momento) {
  const response = await diagnosisCall("fotosServicioOT", "ver una foto del trabajo", businessId, otId, {
    operacion: "leer", servicioOtId: requireIdentifier(servicioOtId, "El servicio de la OT"), momento,
  });
  return response.imagen || "";
}

// Nombre y apellido de la persona que inició sesión (su propio perfil). Si no se puede leer, devuelve null.
export async function obtenerPerfilPropio(uid) {
  const id = requireIdentifier(uid, "El usuario");
  try {
    const snapshot = await getDoc(doc(db, "usuarios", id, "cuenta", "perfil"));
    const data = snapshot.exists() ? snapshot.data() : {};
    return {nombres: data.nombres || "", apellidos: data.apellidos || ""};
  } catch (_error) {
    return null;
  }
}
