import {
  addDoc,
  collection,
  deleteField,
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
import { httpsCallable } from "firebase/functions";
import {
  assertClientWriteAllowed,
  assertCloudFunctionAllowed,
  firebaseEnvironment,
} from "../config/firebaseEnvironment.mjs";
import { db, getFirebaseFunctions } from "../firebase/firebaseConfig.js";
import {
  inventoryAreasCollectionPath,
  inventoryCategoriesCollectionPath,
  inventoryCollectionPath,
  inventoryDocPath,
} from "../firebase/firestorePaths.js";
import { sortInventoryItems } from "../domain/inventoryCompatibility.mjs";

const VALID_TYPES = ["producto", "servicio", "actividad"];
const VALID_STATUS = ["activo", "inactivo", "eliminado"];
const INVENTORY_MODEL_VERSION = 2;
const FUNCTIONS_REGION = "us-central1";
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
  return query(inventoryCollectionRef(uid));
}

async function invokeInventoryModelCallable(functionName, payload) {
  assertCloudFunctionAllowed(`la Function ${functionName}`);
  const callable = httpsCallable(
    getFirebaseFunctions(FUNCTIONS_REGION),
    functionName
  );
  try {
    return await callable(payload);
  } catch (error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (
      code === "functions/not-found" ||
      (code === "functions/internal" && message === "internal")
    ) {
      throw new Error(
        firebaseEnvironment.isEmulator
          ? "No fue posible conectar con el emulador local de Firebase Functions. Inícialo y vuelve a intentar."
          : `La Function ${functionName} no está disponible en Firebase real. Debe desplegarse antes de usar esta acción.`
      );
    }
    throw error;
  }
}

function inventoryAreasCollectionRef(uid) {
  return collection(db, ...inventoryAreasCollectionPath(uid));
}

function inventoryCategoriesCollectionRef(uid) {
  return collection(db, ...inventoryCategoriesCollectionPath(uid));
}

function catalogQuery(collectionRef) {
  return query(collectionRef, orderBy("nombreNormalizado", "asc"));
}

export async function getInventoryAreas(uid) {
  const snapshot = await getDocs(catalogQuery(inventoryAreasCollectionRef(uid)));
  return snapshot.docs.map((areaDoc) => ({
    id: areaDoc.id,
    ...areaDoc.data(),
  }));
}

export async function getInventoryCategories(uid) {
  const snapshot = await getDocs(
    catalogQuery(inventoryCategoriesCollectionRef(uid))
  );
  return snapshot.docs.map((categoryDoc) => ({
    id: categoryDoc.id,
    ...categoryDoc.data(),
  }));
}

export function subscribeToInventoryAreas(uid, onItems, onError) {
  return onSnapshot(
    catalogQuery(inventoryAreasCollectionRef(uid)),
    (snapshot) =>
      onItems(snapshot.docs.map((areaDoc) => ({ id: areaDoc.id, ...areaDoc.data() }))),
    onError
  );
}

export function subscribeToInventoryCategories(uid, onItems, onError) {
  return onSnapshot(
    catalogQuery(inventoryCategoriesCollectionRef(uid)),
    (snapshot) =>
      onItems(
        snapshot.docs.map((categoryDoc) => ({
          id: categoryDoc.id,
          ...categoryDoc.data(),
        }))
      ),
    onError
  );
}

export async function initializeInventoryCatalog(businessId) {
  const response = await invokeInventoryModelCallable(
    "initializeInventoryCatalog",
    { businessId }
  );
  return response.data;
}

export async function saveInventoryArea(businessId, data) {
  const response = await invokeInventoryModelCallable("saveInventoryArea", {
    ...data,
    businessId,
  });
  return response.data;
}

export async function saveInventoryCategory(businessId, data) {
  const response = await invokeInventoryModelCallable(
    "saveInventoryCategory",
    { ...data, businessId }
  );
  return response.data;
}

export async function createManagedInventoryItem(businessId, data, requestId) {
  const response = await invokeInventoryModelCallable(
    "createInventoryItemWithCode",
    { businessId, item: data, requestId }
  );
  return response.data;
}

export async function confirmManagedInventoryImport(
  businessId,
  { requestId, rows }
) {
  const response = await invokeInventoryModelCallable("confirmInventoryImportV2", {
    businessId,
    requestId,
    rows,
  });
  return response.data;
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
  const precioManual = MANUAL_PRICE_FLAGS.some((flag) => data[flag] === true);
  if (costoBase < 0 || margenDeseado < 0 || margenDeseado > 1000) {
    throw new Error("Costo y margen deben estar dentro del rango permitido.");
  }
  const precioInterno = precioManual
    ? toNumber(data.precioInterno, "El precio interno")
    : Math.round(costoBase + (costoBase * margenDeseado) / 100);
  if (precioInterno < 0) throw new Error("El precio interno no puede ser negativo.");

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
    negocioId: uid,
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

export function normalizeManagedInventoryUpdate(
  uid,
  data,
  { preserveLegacyModel = false, allowNegativeStock = false } = {}
) {
  const areaId = String(data.areaId || "").trim();
  const categoriaId = String(data.categoriaId || "").trim();
  const categoria = String(data.categoria || "").trim();
  if (categoriaId && !areaId) {
    throw new Error("Una categoría debe pertenecer a un área.");
  }

  const payload = normalizeInventoryItem(uid, {
    ...data,
    sku: "",
    stock: null,
  });
  delete payload.sku;
  delete payload.stock;
  payload.areaId = areaId || deleteField();
  payload.categoriaId = categoriaId || deleteField();
  payload.categoria = categoria;
  if (!preserveLegacyModel) {
    payload.modeloInventarioVersion = INVENTORY_MODEL_VERSION;
  }

  if (payload.tipoItem === "producto") {
    const marca = String(data.marca || "").trim();
    const modelo = String(data.modelo || "").trim();
    const stock = toNumber(data.stock ?? 0, "El stock actual");
    const stockMinimo = toNumber(data.stockMinimo ?? 0, "El stock mínimo");
    if ((!allowNegativeStock && stock < 0) || stockMinimo < 0) {
      throw new Error(
        allowNegativeStock
          ? "El stock mínimo no puede ser negativo."
          : "El stock actual y mínimo no pueden ser negativos."
      );
    }
    payload.marca = marca || deleteField();
    payload.modelo = modelo || deleteField();
    payload.stock = stock;
    payload.stockMinimo = stockMinimo;
    payload.codigoBarras = String(data.codigoBarras || "").trim() || deleteField();
    payload.unidadStock = String(data.unidadStock || data.unidad || "").trim();
  } else {
    payload.marca = deleteField();
    payload.modelo = deleteField();
    payload.stock = deleteField();
    payload.stockMinimo = deleteField();
    payload.codigoBarras = deleteField();
    payload.unidadStock = deleteField();
  }

  return payload;
}

export async function getInventoryItems(uid) {
  const snapshot = await getDocs(inventoryQuery(uid));
  return sortInventoryItems(
    snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
  );
}

export function subscribeToInventory(uid, onItems, onError) {
  return onSnapshot(
    inventoryQuery(uid),
    (snapshot) => {
      const items = sortInventoryItems(
        snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
      );
      onItems(items);
    },
    onError
  );
}

export async function createInventoryItem(uid, data) {
  assertClientWriteAllowed("crear inventario");
  const payload = normalizeInventoryItem(uid, data, { isCreate: true });
  return addDoc(inventoryCollectionRef(uid), payload);
}

export async function updateInventoryItem(uid, itemId, data) {
  assertClientWriteAllowed("editar inventario");
  const payload = normalizeInventoryItem(uid, data);
  return updateDoc(doc(db, ...inventoryDocPath(uid, itemId)), payload);
}

export async function updateManagedInventoryItem(uid, itemId, data, options) {
  assertClientWriteAllowed("editar inventario");
  const payload = normalizeManagedInventoryUpdate(uid, data, options);
  return updateDoc(doc(db, ...inventoryDocPath(uid, itemId)), payload);
}

export async function deactivateInventoryItem(uid, itemId) {
  assertClientWriteAllowed("desactivar inventario");
  return updateDoc(doc(db, ...inventoryDocPath(uid, itemId)), {
    estado: "inactivo",
    actualizadoEn: serverTimestamp(),
  });
}

export async function reactivateInventoryItem(uid, itemId) {
  assertClientWriteAllowed("reactivar inventario");
  return updateDoc(doc(db, ...inventoryDocPath(uid, itemId)), {
    estado: "activo",
    actualizadoEn: serverTimestamp(),
  });
}

export async function importInventoryItems(uid, items) {
  assertClientWriteAllowed("importar inventario");
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

  try {
    const normalizedItems = items.map((item) =>
      normalizeInventoryItem(uid, item, { isCreate: true })
    );

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

