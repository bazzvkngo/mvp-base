import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {getDownloadURL, ref as storageRef, uploadBytes} from "firebase/storage";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {adaptStoredQuote} from "../domain/quoteModel.mjs";
import {adaptStoredSale} from "../domain/saleModel.mjs";
import {adaptStoredWork, adaptWorkAdditional, adaptWorkBalance, adaptWorkEvent, adaptWorkExpense, adaptWorkLabor, adaptWorkLink, adaptWorkMaterialMovement, adaptWorkNote, adaptWorkTask, adaptWorkTaskDocumentation, buildWorkExpenseEvidenceFileName, buildWorkMutationPayload, validateWorkExpenseEvidenceSelection} from "../domain/workModel.mjs";
import {db, getFirebaseFunctions, storage} from "../firebase/firebaseConfig";
import {inventoryMovementsCollectionPath, quoteDocPath, saleDocPath, workAdditionalsCollectionPath, workExpensesCollectionPath, workHistoryCollectionPath, workLaborCollectionPath, workLinksCollectionPath, workNotesCollectionPath, worksCollectionPath, workTaskDocumentationCollectionPath, workTasksCollectionPath} from "../firebase/firestorePaths";

const functions = getFirebaseFunctions("us-central1");

function businessId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error("Selecciona un negocio activo.");
  return normalized;
}

function workId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error("Selecciona un trabajo válido.");
  return normalized;
}

function call(name, data, operation) {
  assertCloudFunctionAllowed(operation);
  return httpsCallable(functions, name)(data);
}

function sortByDate(values, field, direction = "asc") {
  const multiplier = direction === "desc" ? -1 : 1;
  return values.sort((left, right) => multiplier * String(left[field] || "").localeCompare(String(right[field] || "")));
}

export function createWorkRequestId() {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
  return `work_${String(value).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 120);
}

export function createWorkTaskRequestId(action = "task") {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
  return `${action}_${String(value).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 120);
}

export function createWorkCostRequestId(action = "cost") {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
  return `${action}_${String(value).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 120);
}

export async function listarTrabajos(rawBusinessId, {role = "", currentUserUid = ""} = {}) {
  const id = businessId(rawBusinessId);
  const isTechnician = String(role).toUpperCase() === "TECNICO";
  const base = collection(db, ...worksCollectionPath(id));
  const snapshots = isTechnician
    ? await Promise.all([
        getDocs(query(base, where("negocioId", "==", id), where("responsableUid", "==", currentUserUid))),
        getDocs(query(base, where("negocioId", "==", id), where("participanteUids", "array-contains", currentUserUid))),
      ])
    : [await getDocs(query(base, where("negocioId", "==", id)))];
  const entries = new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((entry) => [entry.id, entry]));
  return [...entries.values()].map((entry) => adaptStoredWork({...entry.data(), id: entry.id})).sort((left, right) => String(right.actualizadoEn || "").localeCompare(String(left.actualizadoEn || "")));
}

export async function obtenerBalanceTrabajo(rawBusinessId, rawWorkId) {
  const response = await call("obtenerBalanceTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId)}, "consultar balances de trabajos");
  return adaptWorkBalance(response.data);
}

// SPEC 020 ETAPA 5: lectura acotada para el selector de adicionales de
// Ventas (src/features/works/AdditionalSelector.jsx) — a diferencia de
// cargarFichaTrabajo (toda la ficha del Proyecto), aquí sólo se necesitan los
// adicionales PENDIENTE_COBRO, así que se filtra en la propia consulta en
// vez de traer todo y filtrar en memoria.
export async function listarAdicionalesPendientesTrabajo(rawBusinessId, rawWorkId) {
  const id = businessId(rawBusinessId); const selectedWorkId = workId(rawWorkId);
  const snapshot = await getDocs(query(
    collection(db, ...workAdditionalsCollectionPath(id, selectedWorkId)),
    where("negocioId", "==", id),
    where("trabajoId", "==", selectedWorkId),
    where("estado", "==", "PENDIENTE_COBRO"),
  ));
  return sortByDate(snapshot.docs.map((entry) => adaptWorkAdditional({...entry.data(), id: entry.id})), "creadoEn", "desc");
}

export async function cargarFichaTrabajo(rawBusinessId, rawWorkId, {role = "", currentUserUid = ""} = {}) {
  const id = businessId(rawBusinessId); const selectedWorkId = workId(rawWorkId);
  const isTechnician = String(role).toUpperCase() === "TECNICO";
  const emptySnapshot = {docs: []};
  const [tasks, notes, history, linksSnapshot, expensesSnapshot, laborSnapshot, materialMovementsSnapshot, additionalsSnapshot] = await Promise.all([
    getDocs(query(
      collection(db, ...workTasksCollectionPath(id, selectedWorkId)),
      where("negocioId", "==", id),
      where("trabajoId", "==", selectedWorkId),
      ...(isTechnician ? [where("responsableUid", "==", currentUserUid)] : []),
    )),
    getDocs(query(collection(db, ...workNotesCollectionPath(id, selectedWorkId)), where("negocioId", "==", id), where("trabajoId", "==", selectedWorkId))),
    getDocs(query(collection(db, ...workHistoryCollectionPath(id, selectedWorkId)), where("negocioId", "==", id), where("trabajoId", "==", selectedWorkId))),
    isTechnician ? Promise.resolve(emptySnapshot) : getDocs(query(collection(db, ...workLinksCollectionPath(id, selectedWorkId)), where("negocioId", "==", id), where("trabajoId", "==", selectedWorkId))),
    getDocs(query(collection(db, ...workExpensesCollectionPath(id, selectedWorkId)), where("negocioId", "==", id), where("trabajoId", "==", selectedWorkId), ...(isTechnician ? [where("registradoPorUid", "==", currentUserUid)] : []))),
    getDocs(query(collection(db, ...workLaborCollectionPath(id, selectedWorkId)), where("negocioId", "==", id), where("trabajoId", "==", selectedWorkId), ...(isTechnician ? [where("registradoPorUid", "==", currentUserUid)] : []))),
    getDocs(query(collection(db, ...inventoryMovementsCollectionPath(id)), where("negocioId", "==", id), where("trabajoId", "==", selectedWorkId))),
    // Mismo predicado que gastos/HH: canReadWorkCosts restringe TECNICO a lo autoatribuido.
    getDocs(query(collection(db, ...workAdditionalsCollectionPath(id, selectedWorkId)), where("negocioId", "==", id), where("trabajoId", "==", selectedWorkId), ...(isTechnician ? [where("registradoPorUid", "==", currentUserUid)] : []))),
  ]);
  const vinculos = sortByDate(linksSnapshot.docs.map((entry) => adaptWorkLink({...entry.data(), id: entry.id})), "creadoEn");
  const taskDocuments = tasks.docs.map((entry) => adaptWorkTask({...entry.data(), id: entry.id}));
  const taskDocumentation = await Promise.all(taskDocuments.map(async (task) => {
    const snapshot = await getDocs(query(
      collection(db, ...workTaskDocumentationCollectionPath(id, selectedWorkId, task.id)),
      where("negocioId", "==", id),
      where("trabajoId", "==", selectedWorkId),
      where("tareaId", "==", task.id),
    ));
    return sortByDate(snapshot.docs.map((entry) => adaptWorkTaskDocumentation({...entry.data(), id: entry.id})), "creadoEn", "desc");
  }));
  const canonicalDocuments = await Promise.all(vinculos.map(async (link) => {
    const path = link.tipoDocumento === "venta"
      ? saleDocPath(id, link.documentoId)
      : quoteDocPath(id, link.documentoId);
    const snapshot = await getDoc(doc(db, ...path));
    if (!snapshot.exists()) return null;
    const stored = {id: snapshot.id, ...snapshot.data()};
    if (String(stored.trabajoId || "") !== selectedWorkId) return null;
    return {
      tipo: link.tipoDocumento,
      documento: link.tipoDocumento === "venta" ? adaptStoredSale(stored) : adaptStoredQuote(stored),
    };
  }));
  return {
    tareas: sortByDate(taskDocuments.map((task, index) => ({...task, documentacion: taskDocumentation[index]})), "creadoEn"),
    notas: sortByDate(notes.docs.map((entry) => adaptWorkNote({...entry.data(), id: entry.id})), "creadoEn", "desc"),
    historial: sortByDate(history.docs.map((entry) => adaptWorkEvent({...entry.data(), id: entry.id})), "fecha", "desc"),
    vinculos,
    cotizaciones: canonicalDocuments.filter((entry) => entry?.tipo === "cotizacion").map((entry) => entry.documento),
    ventas: canonicalDocuments.filter((entry) => entry?.tipo === "venta").map((entry) => entry.documento),
    gastos: sortByDate(expensesSnapshot.docs.map((entry) => adaptWorkExpense({...entry.data(), id: entry.id})), "fecha", "desc"),
    horasHombre: sortByDate(laborSnapshot.docs.map((entry) => adaptWorkLabor({...entry.data(), id: entry.id})), "fecha", "desc"),
    adicionales: sortByDate(additionalsSnapshot.docs.map((entry) => adaptWorkAdditional({...entry.data(), id: entry.id})), "creadoEn", "desc"),
    materiales: sortByDate(materialMovementsSnapshot.docs
      .map((entry) => ({...entry.data(), id: entry.id}))
      .filter((entry) => ["SALIDA_PROYECTO", "DEVOLUCION_PROYECTO"].includes(entry.tipo))
      .map(adaptWorkMaterialMovement), "creadoEn"),
  };
}

export async function crearTrabajo(rawBusinessId, raw, requestId) {
  const response = await call("crearTrabajo", {businessId: businessId(rawBusinessId), requestId, trabajo: buildWorkMutationPayload(raw)}, "crear trabajos");
  return response.data;
}

export async function actualizarTrabajo(rawBusinessId, rawWorkId, raw) {
  const response = await call("actualizarTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), trabajo: buildWorkMutationPayload(raw)}, "actualizar trabajos");
  return response.data;
}

export async function cambiarEstadoTrabajo(rawBusinessId, rawWorkId, estado, motivoEspera = "") {
  const response = await call("cambiarEstadoTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), estado, motivoEspera}, "cambiar estados de trabajos");
  return response.data;
}

export async function agregarTareaTrabajo(rawBusinessId, rawWorkId, tarea, requestId) {
  return (await call("agregarTareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tarea, requestId}, "agregar tareas")).data;
}

export async function cambiarEstadoTareaTrabajo(rawBusinessId, rawWorkId, tareaId, estado, {documentacionCierre = "", motivoEspera = "", requestId} = {}) {
  const payload = typeof estado === "boolean" ? {completada: estado} : {estado};
  return (await call("cambiarEstadoTareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tareaId, ...payload, motivoEspera, documentacionCierre, requestId}, "actualizar tareas")).data;
}

export async function agregarSubtareaTrabajo(rawBusinessId, rawWorkId, tareaId, titulo, requestId) {
  return (await call("agregarSubtareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tareaId, titulo, requestId}, "agregar subtareas")).data;
}

export async function actualizarSubtareaTrabajo(rawBusinessId, rawWorkId, tareaId, subtareaId, cambios, requestId) {
  return (await call("actualizarSubtareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tareaId, subtareaId, ...cambios, requestId}, "actualizar subtareas")).data;
}

export async function eliminarSubtareaTrabajo(rawBusinessId, rawWorkId, tareaId, subtareaId, requestId) {
  return (await call("eliminarSubtareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tareaId, subtareaId, requestId}, "eliminar subtareas")).data;
}

export async function asignarTareaTrabajo(rawBusinessId, rawWorkId, tareaId, responsableUid, requestId) {
  return (await call("asignarTareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tareaId, responsableUid, requestId}, "asignar tareas")).data;
}

export async function documentarTareaTrabajo(rawBusinessId, rawWorkId, tareaId, texto, requestId) {
  return (await call("documentarTareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tareaId, texto, requestId}, "documentar tareas")).data;
}

export async function eliminarTareaTrabajo(rawBusinessId, rawWorkId, tareaId, requestId) {
  return (await call("eliminarTareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tareaId, requestId}, "eliminar tareas")).data;
}

export async function registrarGastoTrabajo(rawBusinessId, rawWorkId, gasto, requestId) {
  return (await call("registrarGastoTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), gasto, requestId}, "registrar gastos de trabajos")).data;
}

export async function anularGastoTrabajo(rawBusinessId, rawWorkId, gastoId, motivo, requestId) {
  return (await call("anularGastoTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), gastoId, motivo, requestId}, "anular gastos de trabajos")).data;
}

export async function crearAdicionalTrabajo(rawBusinessId, rawWorkId, adicional, requestId) {
  return (await call("crearAdicionalTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), adicional, requestId}, "registrar adicionales de trabajos")).data;
}

export async function anularAdicionalTrabajo(rawBusinessId, rawWorkId, adicionalId, motivo, requestId) {
  return (await call("anularAdicionalTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), adicionalId, motivo, requestId}, "anular adicionales de trabajos")).data;
}

export async function adjuntarEvidenciaGastoTrabajo(rawBusinessId, rawWorkId, gastoId, nombreArchivo, requestId) {
  return (await call("adjuntarEvidenciaGastoTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), gastoId, nombreArchivo, requestId}, "adjuntar evidencia de gastos de trabajos")).data;
}

// Flujo aprobado (SPEC 020 §8/§9): subir directo a Storage (create-only,
// gobernado por storage.rules) y luego registrar la metadata mediante la
// Function autoritativa, que relee el objeto real — esta función nunca
// declara contentType/size al backend, sólo el nombre de archivo ya sano.
// La validación/saneo son los mismos helpers puros de workModel.mjs que ya
// usa WorkExpenseEvidence.jsx para la UX, para no duplicar la regla.
export async function subirEvidenciaGastoTrabajo(rawBusinessId, rawWorkId, gastoId, file, requestId) {
  const id = businessId(rawBusinessId);
  const wId = workId(rawWorkId);
  const validation = validateWorkExpenseEvidenceSelection(file, 0);
  if (!validation.ok) throw new Error(validation.reason);
  const fileName = buildWorkExpenseEvidenceFileName(file.name, file.type);
  const path = `negocios/${id}/trabajos/${wId}/gastos/${gastoId}/${fileName}`;
  try {
    await uploadBytes(storageRef(storage, path), file, {contentType: file.type});
  } catch (uploadFailure) {
    const error = new Error("No pudimos subir el documento. Intenta nuevamente.");
    error.cause = uploadFailure;
    throw error;
  }
  return adjuntarEvidenciaGastoTrabajo(id, wId, gastoId, fileName, requestId);
}

// Lectura directa vía SDK cliente (SPEC 020 §11): Storage Rules es la
// autoridad de acceso, no hace falta una Function ni una URL firmada aquí.
export async function obtenerEnlaceEvidenciaGastoTrabajo(storagePath) {
  const path = String(storagePath || "").trim();
  if (!path) throw new Error("No se encontró la ruta del documento.");
  return getDownloadURL(storageRef(storage, path));
}

export async function registrarHorasHombreTrabajo(rawBusinessId, rawWorkId, horasHombre, requestId) {
  return (await call("registrarHorasHombreTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), horasHombre, requestId}, "registrar horas hombre")).data;
}

export async function anularHorasHombreTrabajo(rawBusinessId, rawWorkId, horasHombreId, motivo, requestId) {
  return (await call("anularHorasHombreTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), horasHombreId, motivo, requestId}, "anular horas hombre")).data;
}

export async function registrarSalidaMaterialTrabajo(rawBusinessId, rawWorkId, {itemId, cantidad, fecha, tareaId = ""}, requestId) {
  return (await call("registrarSalidaMaterialTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), itemId, cantidad, fecha, tareaId, requestId}, "registrar salidas de materiales")).data;
}

export async function registrarDevolucionMaterialTrabajo(rawBusinessId, rawWorkId, movimientoOrigenId, cantidad, fecha, requestId) {
  return (await call("registrarDevolucionMaterialTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), movimientoOrigenId, cantidad, fecha, requestId}, "registrar devoluciones de materiales")).data;
}

export async function agregarNotaTrabajo(rawBusinessId, rawWorkId, texto) {
  return (await call("agregarNotaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), texto}, "agregar notas")).data;
}
