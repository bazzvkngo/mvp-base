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
  inventoryAcquisitionsCollectionPath,
  inventoryAreasCollectionPath,
  inventoryCategoriesCollectionPath,
  inventoryCollectionPath,
  inventoryDocPath,
} from "../firebase/firestorePaths.js";
import { sortInventoryItems } from "../domain/inventoryCompatibility.mjs";
import {
  INVENTORY_PRICE_FORMATION_VERSION,
  adaptInventoryItem,
  calculateInventoryPriceFormation,
} from "../domain/inventoryMvp.mjs";
import {normalizeBarcode} from "../domain/barcode.mjs";
import {formatChileanRut} from "../domain/fiscalIdentifier.mjs";

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

function inventoryStatusRequestId() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
  return `inventory_status_${String(id).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 120);
}

function inventoryCollectionRef(uid) {
  return collection(db, ...inventoryCollectionPath(uid));
}

function inventoryAcquisitionsCollectionRef(businessId) {
  return collection(db, ...inventoryAcquisitionsCollectionPath(businessId));
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

function normalizeReferencePurchaseDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new Error("La fecha de compra de referencia no es válida.");
  }
  return normalized;
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
    throw new Error("El recargo es obligatorio.");
  }

  const costoBase = toNumber(data.costoBase, "El costo base");
  const margenDeseado = toNumber(data.margenDeseado, "El recargo");
  const precioManual = MANUAL_PRICE_FLAGS.some((flag) => data[flag] === true);
  if (costoBase < 0 || margenDeseado < 0 || margenDeseado > 1000) {
    throw new Error("Costo y recargo deben estar dentro del rango permitido.");
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

  if (tipoItem === "producto") {
    const proveedorNombre = String(data.proveedorNombre || "").trim();
    const proveedorRut = formatChileanRut(data.proveedorRut || "");
    const fechaCompraReferencia = normalizeReferencePurchaseDate(
      data.fechaCompraReferencia
    );
    const numeroFacturaReferencia = String(
      data.numeroFacturaReferencia || ""
    ).trim();
    if (proveedorNombre) payload.proveedorNombre = proveedorNombre;
    if (proveedorRut) payload.proveedorRut = proveedorRut;
    if (fechaCompraReferencia) payload.fechaCompraReferencia = fechaCompraReferencia;
    if (numeroFacturaReferencia) {
      payload.numeroFacturaReferencia = numeroFacturaReferencia;
    }
  }

  if (
    tipoItem === "producto" &&
    Number(data.formacionPrecioVersion) === INVENTORY_PRICE_FORMATION_VERSION
  ) {
    const tasaImpuestoCompra = toNumber(
      data.tasaImpuestoCompra,
      "El IVA de compra"
    );
    if (tasaImpuestoCompra < 0 || tasaImpuestoCompra > 100) {
      throw new Error("El IVA de compra debe estar entre 0 y 100%.");
    }
    const formation = calculateInventoryPriceFormation({
      costoBase,
      tasaImpuestoCompra,
      margenDeseado,
      precioInterno,
      precioManual,
    });
    payload.formacionPrecioVersion = INVENTORY_PRICE_FORMATION_VERSION;
    payload.tasaImpuestoCompra = formation.tasaImpuestoCompra;
    payload.montoImpuestoCompra = formation.montoImpuestoCompra;
    payload.costoPagado = formation.costoPagado;
    payload.precioVentaSugerido = formation.precioVentaSugerido;
    payload.precioInterno = formation.precioVentaFinal;
  }

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
    payload.barcode = normalizeBarcode(data.barcode ?? data.codigoBarras) || deleteField();
    payload.codigoBarras = deleteField();
    payload.unidadStock = String(data.unidadStock || data.unidad || "").trim();
    payload.proveedorNombre = String(data.proveedorNombre || "").trim() || deleteField();
    payload.proveedorRut = formatChileanRut(data.proveedorRut || "") || deleteField();
    payload.fechaCompraReferencia = normalizeReferencePurchaseDate(
      data.fechaCompraReferencia
    ) || deleteField();
    payload.numeroFacturaReferencia = String(
      data.numeroFacturaReferencia || ""
    ).trim() || deleteField();
  } else {
    payload.marca = deleteField();
    payload.modelo = deleteField();
    payload.stock = deleteField();
    payload.stockMinimo = deleteField();
    payload.codigoBarras = deleteField();
    payload.barcode = deleteField();
    payload.unidadStock = deleteField();
    payload.proveedorNombre = deleteField();
    payload.proveedorRut = deleteField();
    payload.fechaCompraReferencia = deleteField();
    payload.numeroFacturaReferencia = deleteField();
    payload.formacionPrecioVersion = deleteField();
    payload.tasaImpuestoCompra = deleteField();
    payload.montoImpuestoCompra = deleteField();
    payload.costoPagado = deleteField();
    payload.precioVentaSugerido = deleteField();
  }

  return payload;
}

export async function getInventoryItems(uid) {
  const snapshot = await getDocs(inventoryQuery(uid));
  return sortInventoryItems(
    snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
  );
}

export async function findActiveProductByBarcode(businessId, rawBarcode) {
  const barcode = normalizeBarcode(rawBarcode);
  if (!businessId || !barcode) return null;
  const inventoryRef = inventoryCollectionRef(businessId);
  const [canonicalSnapshot, legacySnapshot] = await Promise.all([
    getDocs(query(inventoryRef, where("barcode", "==", barcode))),
    getDocs(query(inventoryRef, where("codigoBarras", "==", barcode))),
  ]);
  const matches = new Map();
  [...canonicalSnapshot.docs, ...legacySnapshot.docs].forEach((itemDoc) => {
    const data = itemDoc.data() || {};
    if (data.negocioId && data.negocioId !== businessId) return;
    if ((data.estado || "activo") !== "activo") return;
    if ((data.tipoItem || "producto") !== "producto") return;
    matches.set(itemDoc.id, adaptInventoryItem({id: itemDoc.id, ...data}));
  });
  if (matches.size > 1) {
    throw new Error("Hay más de un producto activo con este código de barras.");
  }
  return matches.values().next().value || null;
}

export async function getInventoryAcquisitions(businessId, itemId) {
  const snapshot = await getDocs(query(
    inventoryAcquisitionsCollectionRef(businessId),
    where("negocioId", "==", businessId),
    where("itemId", "==", itemId)
  ));
  return snapshot.docs
    .map((entry) => ({id: entry.id, ...entry.data()}))
    .sort((left, right) => {
      const leftTime = left.creadoEn?.toMillis?.() || 0;
      const rightTime = right.creadoEn?.toMillis?.() || 0;
      return rightTime - leftTime || String(right.fechaAdquisicion || "")
        .localeCompare(String(left.fechaAdquisicion || ""));
    });
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

export async function updateManagedInventoryItem(
  businessId,
  itemId,
  data,
  {requestId} = {}
) {
  const response = await invokeInventoryModelCallable("updateInventoryItem", {
    businessId,
    itemId,
    item: data,
    requestId,
  });
  return response.data;
}

export async function deactivateInventoryItem(uid, itemId) {
  const response = await invokeInventoryModelCallable("setInventoryItemStatus", {
    businessId: uid,
    itemId,
    estado: "inactivo",
    requestId: inventoryStatusRequestId(),
  });
  return response.data;
}

export async function reactivateInventoryItem(uid, itemId) {
  const response = await invokeInventoryModelCallable("setInventoryItemStatus", {
    businessId: uid,
    itemId,
    estado: "activo",
    requestId: inventoryStatusRequestId(),
  });
  return response.data;
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

