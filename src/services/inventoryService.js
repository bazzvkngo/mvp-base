import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app, db } from "../firebase/firebaseConfig";
import {
  inventoryCollectionPath,
  inventoryDocPath,
} from "../firebase/firestorePaths";

const functions = getFunctions(app, "us-central1");
const verificarPrecioFn = httpsCallable(functions, "verificarPrecioProducto");

function inventoryCollectionRef(userId) {
  return collection(db, ...inventoryCollectionPath(userId));
}

export function subscribeToInventory(userId, onItems, onError) {
  return onSnapshot(
    inventoryCollectionRef(userId),
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

export async function createInventoryItem(userId, item) {
  return addDoc(inventoryCollectionRef(userId), {
    ...item,
    creadoEn: item.creadoEn || new Date(),
    actualizadoEn: item.actualizadoEn || new Date(),
  });
}

export async function updateInventoryItem(userId, itemId, item) {
  const ref = doc(db, ...inventoryDocPath(userId, itemId));
  return updateDoc(ref, {
    ...item,
    actualizadoEn: item.actualizadoEn || new Date(),
  });
}

export async function deleteInventoryItem(userId, itemId) {
  return deleteDoc(doc(db, ...inventoryDocPath(userId, itemId)));
}

export async function importInventoryItems(userId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { creados: 0 };
  }

  let creados = 0;
  const ahora = new Date();

  for (const item of items) {
    await createInventoryItem(userId, {
      ...item,
      creadoEn: ahora,
      actualizadoEn: ahora,
    });
    creados += 1;
  }

  return { creados };
}

export async function verifySupplierPrice(productoId) {
  const response = await verificarPrecioFn({ productoId });
  return response.data || {};
}
