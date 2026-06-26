import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import {
  referenceDocPath,
  referencesCollectionPath,
} from "../firebase/firestorePaths";
import { resolveReferenceTasksForSavedReference } from "./referenceTaskService";

const VALID_STATUS = ["activa", "inactiva"];

function referencesCollectionRef(uid) {
  return collection(db, ...referencesCollectionPath(uid));
}

function referencesQuery(uid) {
  return query(referencesCollectionRef(uid), orderBy("actualizadoEn", "desc"));
}

function toNumber(value, fieldName) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${fieldName} debe ser numérico.`);
  }
  return numberValue;
}

function isValidUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeReference(uid, data, { isCreate = false } = {}) {
  const itemId = String(data.itemId || "").trim();
  const itemNombre = String(data.itemNombre || "").trim();
  const nombreFuente = String(data.nombreFuente || "").trim();
  const urlFuente = String(data.urlFuente || "").trim();
  const fechaConsulta = String(data.fechaConsulta || "").trim();

  if (!itemId) throw new Error("Selecciona un ítem del inventario.");
  if (!nombreFuente) throw new Error("Ingresa el nombre de la fuente.");
  if (data.precioObservado === "" || data.precioObservado === null || data.precioObservado === undefined) {
    throw new Error("Ingresa el precio observado.");
  }
  if (!fechaConsulta) throw new Error("Ingresa la fecha de consulta.");
  if (!isValidUrl(urlFuente)) {
    throw new Error("La URL debe comenzar con http:// o https://.");
  }

  const estado = VALID_STATUS.includes(data.estado) ? data.estado : "activa";
  const payload = {
    itemId,
    itemNombre,
    nombreFuente,
    urlFuente: urlFuente || null,
    precioObservado: toNumber(data.precioObservado, "El precio observado"),
    fechaConsulta,
    observacion: String(data.observacion || "").trim(),
    estado,
    uidUsuario: uid,
    actualizadoEn: serverTimestamp(),
  };

  if (isCreate) {
    payload.creadoEn = serverTimestamp();
  }

  return payload;
}

export async function getReferences(uid) {
  const snapshot = await getDocs(referencesQuery(uid));
  return snapshot.docs.map((referenceDoc) => ({
    id: referenceDoc.id,
    ...referenceDoc.data(),
  }));
}

export async function getReferencesByItem(uid, itemId) {
  const snapshot = await getDocs(
    query(
      referencesCollectionRef(uid),
      where("itemId", "==", itemId)
    )
  );

  return snapshot.docs
    .map((referenceDoc) => ({
      id: referenceDoc.id,
      ...referenceDoc.data(),
    }))
    .sort((a, b) => {
      const aDate = a.actualizadoEn?.toMillis?.() || 0;
      const bDate = b.actualizadoEn?.toMillis?.() || 0;
      return bDate - aDate;
    });
}

export function subscribeToReferences(uid, onReferences, onError) {
  return onSnapshot(
    referencesQuery(uid),
    (snapshot) => {
      const references = snapshot.docs.map((referenceDoc) => ({
        id: referenceDoc.id,
        ...referenceDoc.data(),
      }));
      onReferences(references);
    },
    onError
  );
}

export async function createReference(uid, data) {
  const payload = normalizeReference(uid, data, { isCreate: true });
  const docRef = await addDoc(referencesCollectionRef(uid), payload);
  await resolveReferenceTasksForSavedReference(uid, payload);
  return docRef;
}

export async function updateReference(uid, referenceId, data) {
  const payload = normalizeReference(uid, data);
  await updateDoc(doc(db, ...referenceDocPath(uid, referenceId)), payload);
  await resolveReferenceTasksForSavedReference(uid, payload);
}

export async function deactivateReference(uid, referenceId) {
  await updateDoc(doc(db, ...referenceDocPath(uid, referenceId)), {
    estado: "inactiva",
    actualizadoEn: serverTimestamp(),
  });
}

export async function reactivateReference(uid, referenceId) {
  await updateDoc(doc(db, ...referenceDocPath(uid, referenceId)), {
    estado: "activa",
    actualizadoEn: serverTimestamp(),
  });
}

