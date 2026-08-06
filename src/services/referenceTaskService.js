import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { assertClientWriteAllowed } from "../config/firebaseEnvironment.mjs";
import { db } from "../firebase/firebaseConfig";
import {
  referenceTaskDocPath,
  referenceTasksCollectionPath,
} from "../firebase/firestorePaths";

const STALE_REFERENCE_DAYS = 30;
const VALID_POSTPONE_DAYS = [7, 15, 30];

function referenceTasksCollectionRef(uid) {
  return collection(db, ...referenceTasksCollectionPath(uid));
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getReferenceDate(reference) {
  if (reference.fechaConsulta) {
    const date = new Date(`${reference.fechaConsulta}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return date;
  }

  if (reference.actualizadoEn?.toDate) return reference.actualizadoEn.toDate();
  if (reference.creadoEn?.toDate) return reference.creadoEn.toDate();
  return null;
}

function isFreshReference(reference) {
  const date = getReferenceDate(reference);
  if (!date) return false;
  const staleMs = STALE_REFERENCE_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - date.getTime() <= staleMs;
}

function getTaskRank(task) {
  const typeOrder = {
    referencias_desactualizadas: 0,
    sin_referencias: 3,
  };
  const priorityOrder = { alta: 1, media: 2, baja: 3 };
  return [
    typeOrder[task.tipoAlerta] ?? 2,
    priorityOrder[task.prioridad] ?? 4,
    -(toMillis(task.creadoEn) || 0),
  ];
}

export function sortReferenceTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const aRank = getTaskRank(a);
    const bRank = getTaskRank(b);
    for (let i = 0; i < aRank.length; i += 1) {
      if (aRank[i] !== bRank[i]) return aRank[i] - bRank[i];
    }
    return String(a.itemNombre || "").localeCompare(String(b.itemNombre || ""));
  });
}

export function isActivePendingReferenceTask(task, now = new Date()) {
  if ((task.estado || "pendiente") !== "pendiente") return false;
  const postponedUntil = toMillis(task.aplazadaHasta);
  return !postponedUntil || postponedUntil <= now.getTime();
}

export function subscribeToReferenceTasks(uid, onTasks, onError) {
  return onSnapshot(
    referenceTasksCollectionRef(uid),
    (snapshot) => {
      const tasks = snapshot.docs.map((taskDoc) => ({
        id: taskDoc.id,
        ...taskDoc.data(),
      }));
      onTasks(sortReferenceTasks(tasks));
    },
    onError
  );
}

export function subscribeToPendingReferenceTasks(uid, onTasks, onError) {
  return subscribeToReferenceTasks(
    uid,
    (tasks) => onTasks(tasks.filter((task) => isActivePendingReferenceTask(task))),
    onError
  );
}

export async function postponeReferenceTask(uid, taskId, days) {
  assertClientWriteAllowed("aplazar tareas de referencias");
  const postponeDays = Number(days);
  if (!VALID_POSTPONE_DAYS.includes(postponeDays)) {
    throw new Error("Plazo de aplazamiento no permitido.");
  }

  const postponedUntil = new Date();
  postponedUntil.setDate(postponedUntil.getDate() + postponeDays);

  return updateDoc(doc(db, ...referenceTaskDocPath(uid, taskId)), {
    estado: "aplazada",
    aplazadaHasta: Timestamp.fromDate(postponedUntil),
    actualizadoEn: serverTimestamp(),
  });
}

export async function updateReferenceTaskStatus(uid, taskId, estado) {
  assertClientWriteAllowed("actualizar tareas de referencias");
  if (!["resuelta"].includes(estado)) {
    throw new Error("Estado de tarea no permitido.");
  }

  return updateDoc(doc(db, ...referenceTaskDocPath(uid, taskId)), {
    estado,
    resueltaEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
  });
}

export async function resolveReferenceTasksForSavedReference(uid, reference) {
  assertClientWriteAllowed("resolver tareas de referencias");
  if (!uid || !reference?.itemId || (reference.estado || "activa") !== "activa") {
    return;
  }

  const snapshot = await getDocs(
    query(referenceTasksCollectionRef(uid), where("itemId", "==", reference.itemId))
  );

  const updates = snapshot.docs
    .map((taskDoc) => ({ id: taskDoc.id, ...taskDoc.data() }))
    .filter((task) => ["pendiente", "aplazada"].includes(task.estado || "pendiente"))
    .filter((task) => {
      if (task.tipoAlerta === "sin_referencias") return true;
      if (task.tipoAlerta === "referencias_desactualizadas") {
        return isFreshReference(reference);
      }
      return false;
    })
    .map((task) =>
      updateDoc(doc(db, ...referenceTaskDocPath(uid, task.id)), {
        estado: "resuelta",
        resueltaEn: serverTimestamp(),
        actualizadoEn: serverTimestamp(),
      })
    );

  await Promise.all(updates);
}
