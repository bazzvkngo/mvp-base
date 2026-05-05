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
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import {
  inventoryCollectionPath,
  inventoryDocPath,
} from "../firebase/firestorePaths";

const VALID_TYPES = ["producto", "servicio", "actividad"];
const VALID_STATUS = ["activo", "inactivo"];

function inventoryCollectionRef(uid) {
  return collection(db, ...inventoryCollectionPath(uid));
}

function inventoryQuery(uid) {
  return query(inventoryCollectionRef(uid), orderBy("actualizadoEn", "desc"));
}

function toNumber(value, fieldName) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${fieldName} debe ser numérico.`);
  }
  return numberValue;
}

export function normalizeInventoryItem(uid, data, { isCreate = false } = {}) {
  const nombre = String(data.nombre || "").trim();
  const tipoItem = String(data.tipoItem || "").trim();
  const unidad = String(data.unidad || "").trim();

  if (!nombre) throw new Error("El nombre es obligatorio.");
  if (!VALID_TYPES.includes(tipoItem)) {
    throw new Error("Selecciona un tipo de ítem válido.");
  }
  if (!unidad) throw new Error("La unidad es obligatoria.");
  if (data.costoBase === "" || data.costoBase === null || data.costoBase === undefined) {
    throw new Error("El costo base es obligatorio.");
  }
  if (
    data.margenDeseado === "" ||
    data.margenDeseado === null ||
    data.margenDeseado === undefined
  ) {
    throw new Error("El margen deseado es obligatorio.");
  }

  const costoBase = toNumber(data.costoBase, "El costo base");
  const margenDeseado = toNumber(data.margenDeseado, "El margen deseado");
  const precioInterno =
    data.precioInterno === "" ||
    data.precioInterno === null ||
    data.precioInterno === undefined
      ? Math.round(costoBase + (costoBase * margenDeseado) / 100)
      : toNumber(data.precioInterno, "El precio interno");

  const estado = VALID_STATUS.includes(data.estado) ? data.estado : "activo";
  const payload = {
    nombre,
    tipoItem,
    categoria: String(data.categoria || "").trim(),
    descripcion: String(data.descripcion || "").trim(),
    unidad,
    costoBase,
    precioInterno,
    margenDeseado,
    estado,
    sku: String(data.sku || "").trim() || null,
    stock:
      data.stock === "" || data.stock === null || data.stock === undefined
        ? null
        : toNumber(data.stock, "El stock"),
    uidUsuario: uid,
    actualizadoEn: serverTimestamp(),
  };

  if (isCreate) {
    payload.creadoEn = serverTimestamp();
  }

  return payload;
}

export async function getInventoryItems(uid) {
  const snapshot = await getDocs(inventoryQuery(uid));
  return snapshot.docs.map((itemDoc) => ({
    id: itemDoc.id,
    ...itemDoc.data(),
  }));
}

export function subscribeToInventory(uid, onItems, onError) {
  return onSnapshot(
    inventoryQuery(uid),
    (snapshot) => {
      const items = snapshot.docs.map((itemDoc) => ({
        id: itemDoc.id,
        ...itemDoc.data(),
      }));
      onItems(items);
    },
    onError
  );
}

export async function createInventoryItem(uid, data) {
  const payload = normalizeInventoryItem(uid, data, { isCreate: true });
  return addDoc(inventoryCollectionRef(uid), payload);
}

export async function updateInventoryItem(uid, itemId, data) {
  const payload = normalizeInventoryItem(uid, data);
  return updateDoc(doc(db, ...inventoryDocPath(uid, itemId)), payload);
}

export async function deactivateInventoryItem(uid, itemId) {
  return updateDoc(doc(db, ...inventoryDocPath(uid, itemId)), {
    estado: "inactivo",
    actualizadoEn: serverTimestamp(),
  });
}

export async function reactivateInventoryItem(uid, itemId) {
  return updateDoc(doc(db, ...inventoryDocPath(uid, itemId)), {
    estado: "activo",
    actualizadoEn: serverTimestamp(),
  });
}

export async function importInventoryItems(uid, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { creados: 0 };
  }

  let creados = 0;
  for (const item of items) {
    await createInventoryItem(uid, item);
    creados += 1;
  }

  return { creados };
}

