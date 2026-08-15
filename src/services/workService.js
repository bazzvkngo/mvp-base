import {collection, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {adaptStoredWork, adaptWorkEvent, adaptWorkNote, adaptWorkTask, buildWorkMutationPayload} from "../domain/workModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {workHistoryCollectionPath, workNotesCollectionPath, worksCollectionPath, workTasksCollectionPath} from "../firebase/firestorePaths";

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

export async function listarTrabajos(rawBusinessId) {
  const id = businessId(rawBusinessId);
  const snapshot = await getDocs(query(collection(db, ...worksCollectionPath(id)), where("negocioId", "==", id)));
  return snapshot.docs.map((entry) => adaptStoredWork({...entry.data(), id: entry.id})).sort((left, right) => String(right.actualizadoEn || "").localeCompare(String(left.actualizadoEn || "")));
}

export async function cargarFichaTrabajo(rawBusinessId, rawWorkId) {
  const id = businessId(rawBusinessId); const selectedWorkId = workId(rawWorkId);
  const [tasks, notes, history] = await Promise.all([
    getDocs(collection(db, ...workTasksCollectionPath(id, selectedWorkId))),
    getDocs(collection(db, ...workNotesCollectionPath(id, selectedWorkId))),
    getDocs(collection(db, ...workHistoryCollectionPath(id, selectedWorkId))),
  ]);
  return {
    tareas: sortByDate(tasks.docs.map((entry) => adaptWorkTask({...entry.data(), id: entry.id})), "creadoEn"),
    notas: sortByDate(notes.docs.map((entry) => adaptWorkNote({...entry.data(), id: entry.id})), "creadoEn", "desc"),
    historial: sortByDate(history.docs.map((entry) => adaptWorkEvent({...entry.data(), id: entry.id})), "fecha", "desc"),
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

export async function agregarTareaTrabajo(rawBusinessId, rawWorkId, titulo) {
  return (await call("agregarTareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), titulo}, "agregar tareas")).data;
}

export async function cambiarEstadoTareaTrabajo(rawBusinessId, rawWorkId, tareaId, completada) {
  return (await call("cambiarEstadoTareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tareaId, completada}, "actualizar tareas")).data;
}

export async function eliminarTareaTrabajo(rawBusinessId, rawWorkId, tareaId) {
  return (await call("eliminarTareaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), tareaId}, "eliminar tareas")).data;
}

export async function agregarNotaTrabajo(rawBusinessId, rawWorkId, texto) {
  return (await call("agregarNotaTrabajo", {businessId: businessId(rawBusinessId), trabajoId: workId(rawWorkId), texto}, "agregar notas")).data;
}
