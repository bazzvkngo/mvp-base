import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import {
  referenceTaskDocPath,
  referenceTasksCollectionPath,
} from "../firebase/firestorePaths";

function referenceTasksCollectionRef(uid) {
  return collection(db, ...referenceTasksCollectionPath(uid));
}

export function subscribeToPendingReferenceTasks(uid, onTasks, onError) {
  return onSnapshot(
    query(referenceTasksCollectionRef(uid), where("estado", "==", "pendiente")),
    (snapshot) => {
      const tasks = snapshot.docs
        .map((taskDoc) => ({
          id: taskDoc.id,
          ...taskDoc.data(),
        }))
        .sort((a, b) => {
          const priorityOrder = { alta: 0, media: 1, baja: 2 };
          const aPriority = priorityOrder[a.prioridad] ?? 3;
          const bPriority = priorityOrder[b.prioridad] ?? 3;
          if (aPriority !== bPriority) return aPriority - bPriority;
          const aDate = a.creadoEn?.toMillis?.() || 0;
          const bDate = b.creadoEn?.toMillis?.() || 0;
          return bDate - aDate;
        });
      onTasks(tasks);
    },
    onError
  );
}

export async function updateReferenceTaskStatus(uid, taskId, estado) {
  if (!["resuelta", "ignorada"].includes(estado)) {
    throw new Error("Estado de tarea no permitido.");
  }

  return updateDoc(doc(db, ...referenceTaskDocPath(uid, taskId)), {
    estado,
    actualizadoEn: serverTimestamp(),
  });
}
