import {
  addDoc,
  collection,
  doc,
  getDoc,
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
  inventoryCollectionPath,
  inventoryDocPath,
} from "../firebase/firestorePaths";

const VALID_TYPES = ["producto", "servicio", "actividad"];
const VALID_STATUS = ["activo", "inactivo", "eliminado"];
const MANUAL_PRICE_FLAGS = [
  "precioManual",
  "ajusteManual",
  "usarPrecioManual",
  "precioPersonalizado",
];

function inventoryCollectionRef(uid) {
  return collection(db, ...inventoryCollectionPath(uid));
}

function inventoryQuery(uid) {
  return query(inventoryCollectionRef(uid), orderBy("actualizadoEn", "desc"));
}

function toNumber(value, fieldName) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${fieldName} debe ser numérico.`);
    }
    return value;
  }

  const normalized = String(value || "")
    .trim()
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const numberValue = Number(normalized);

  if (!Number.isFinite(numberValue)) {
    throw new Error(`${fieldName} debe ser numérico.`);
  }
  return numberValue;
}

function normalizeTipoItem(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (VALID_TYPES.includes(normalized)) return normalized;
  if (normalized.includes("servicio")) return "servicio";
  if (normalized.includes("actividad")) return "actividad";
  return "producto";
}

export function normalizeInventoryItem(uid, data, { isCreate = false } = {}) {
  const nombre = String(data.nombre || "").trim();
  const tipoItem = normalizeTipoItem(data.tipoItem || data.tipo);
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
    data.precioInterno === undefined ||
    toNumber(data.precioInterno, "El precio interno") === 0
      ? Math.round(costoBase + (costoBase * margenDeseado) / 100)
      : toNumber(data.precioInterno, "El precio interno");
  const precioManual = MANUAL_PRICE_FLAGS.some((flag) => data[flag] === true);

  const estadoRaw = String(data.estado || "").trim().toLowerCase();
  const estado = VALID_STATUS.includes(estadoRaw) ? estadoRaw : "activo";
  const payload = {
    nombre,
    tipoItem,
    categoria: String(data.categoria || "").trim(),
    descripcion: String(data.descripcion || "").trim(),
    unidad,
    costoBase,
    precioInterno,
    precioManual,
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

  if (data.origen) {
    payload.origen = String(data.origen).trim();
  }

  if (data.creadoDesdeCotizacion === true) {
    payload.creadoDesdeCotizacion = true;
    payload.fechaCreacion = serverTimestamp();
  }

  if (data.justificacionSugerencia) {
    payload.justificacionSugerencia = String(data.justificacionSugerencia).trim();
  }

  if (data.confianzaPrecio) {
    payload.confianzaPrecio = String(data.confianzaPrecio).trim();
  }

  if (data.justificacionPrecio) {
    payload.justificacionPrecio = String(data.justificacionPrecio).trim();
  }

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

export async function softDeleteInventoryItem(uid, itemId) {
  return updateDoc(doc(db, ...inventoryDocPath(uid, itemId)), {
    estado: "eliminado",
    eliminadoEn: serverTimestamp(),
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
  if (!uid) {
    throw new Error("No hay usuario autenticado para importar inventario.");
  }

  if (!Array.isArray(items) || items.length === 0) {
    return {
      created: 0,
      updated: 0,
      total: 0,
      verifiedCount: 0,
      importados: 0,
      creados: 0,
      actualizados: 0,
    };
  }

  console.log("[IMPORT] uid:", uid);
  console.log("[IMPORT] filas recibidas:", items.length);
  console.log("[IMPORT] path inventario:", `usuarios/${uid}/inventario`);

  try {
    const normalizedItems = items.map((item) =>
      normalizeInventoryItem(uid, item, { isCreate: true })
    );
    console.log("[IMPORT] primera fila normalizada:", normalizedItems[0]);
    console.log("[IMPORT] iniciando escritura en Firestore");

    const collectionRef = inventoryCollectionRef(uid);
    const skuValues = normalizedItems
      .map((item) => item.sku)
      .filter((sku) => typeof sku === "string" && sku.trim());
    const existingBySku = new Map();

    for (const sku of [...new Set(skuValues)]) {
      const snapshot = await getDocs(
        query(collectionRef, where("sku", "==", sku))
      );
      snapshot.forEach((itemDoc) => {
        const itemSku = itemDoc.data().sku;
        if (itemSku && !existingBySku.has(itemSku)) {
          existingBySku.set(itemSku, itemDoc);
        }
      });
    }

    let created = 0;
    let updated = 0;
    const affectedRefs = [];

    for (const item of normalizedItems) {
      const existingDoc = item.sku ? existingBySku.get(item.sku) : null;

      if (existingDoc) {
        await updateInventoryItem(uid, existingDoc.id, item);
        affectedRefs.push(existingDoc.ref);
        updated += 1;
        continue;
      }

      const createdRef = await createInventoryItem(uid, item);
      affectedRefs.push(createdRef);
      created += 1;

      if (item.sku) {
        const createdSnapshot = await getDoc(createdRef);
        existingBySku.set(item.sku, createdSnapshot);
      }
    }

    const verifiedSnapshots = await Promise.all(
      affectedRefs.map((itemRef) => getDoc(itemRef))
    );
    const verifiedCount = verifiedSnapshots.filter((snapshot) =>
      snapshot.exists()
    ).length;
    const total = created + updated;

    const result = {
      created,
      updated,
      total,
      verifiedCount,
      importados: total,
      creados: created,
      actualizados: updated,
    };

    console.log("[IMPORT] resultado:", result);

    if (total > 0 && verifiedCount < total) {
      throw new Error(
        `Firestore confirmo ${verifiedCount} de ${total} items importados. No se mostrara exito.`
      );
    }

    return result;
  } catch (error) {
    console.error("[IMPORT] error guardando en Firestore:", error);
    throw error;
  }
}

