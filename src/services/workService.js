import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {adaptStoredQuote} from "../domain/quoteModel.mjs";
import {adaptStoredSale} from "../domain/saleModel.mjs";
import {adaptStoredWork, adaptWorkEvent, adaptWorkLink, adaptWorkNote, adaptWorkTask, adaptWorkTaskDocumentation, buildWorkMutationPayload} from "../domain/workModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {quoteDocPath, saleDocPath, workHistoryCollectionPath, workLinksCollectionPath, workNotesCollectionPath, worksCollectionPath, workTaskDocumentationCollectionPath, workTasksCollectionPath} from "../firebase/firestorePaths";

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

export async function listarTrabajos(rawBusinessId) {
  const id = businessId(rawBusinessId);
  const snapshot = await getDocs(query(collection(db, ...worksCollectionPath(id)), where("negocioId", "==", id)));
  return snapshot.docs.map((entry) => adaptStoredWork({...entry.data(), id: entry.id})).sort((left, right) => String(right.actualizadoEn || "").localeCompare(String(left.actualizadoEn || "")));
}

export async function cargarFichaTrabajo(rawBusinessId, rawWorkId) {
  const id = businessId(rawBusinessId); const selectedWorkId = workId(rawWorkId);
  const [tasks, notes, history, linksSnapshot] = await Promise.all([
    getDocs(collection(db, ...workTasksCollectionPath(id, selectedWorkId))),
    getDocs(collection(db, ...workNotesCollectionPath(id, selectedWorkId))),
    getDocs(collection(db, ...workHistoryCollectionPath(id, selectedWorkId))),
    getDocs(collection(db, ...workLinksCollectionPath(id, selectedWorkId))),
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

export async function cambiarEstadoTrabajo(rawBusinessId, rawWorkId, estado) {
  const response = await call("cambiarEstadoTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), estado}, "cambiar estados de trabajos");
  return response.data;
}

export async function agregarTareaTrabajo(rawBusinessId, rawWorkId, tarea, requestId) {
  return (await call("agregarTareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tarea, requestId}, "agregar tareas")).data;
}

export async function cambiarEstadoTareaTrabajo(rawBusinessId, rawWorkId, tareaId, completada, {documentacionCierre = "", requestId} = {}) {
  return (await call("cambiarEstadoTareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tareaId, completada, documentacionCierre, requestId}, "actualizar tareas")).data;
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

export async function agregarNotaTrabajo(rawBusinessId, rawWorkId, texto) {
  return (await call("agregarNotaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), texto}, "agregar notas")).data;
}
