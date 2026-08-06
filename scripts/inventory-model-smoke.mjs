import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  INITIAL_INVENTORY_AREAS,
  INITIAL_INVENTORY_CATEGORIES,
  createInventoryItemWithCodeHandler,
  formatInternalCode,
  initializeInventoryCatalogHandler,
  normalizeCatalogName,
  saveInventoryAreaHandler,
  saveInventoryCategoryHandler,
  validateInventoryItemInput,
} = require("../functions/inventoryModel.js");
const {
  buildNewCategoryPayload,
  getCategoriesForArea,
  isDuplicateAreaName,
  isDuplicateCategoryName,
  keepCompatibleCategoryId,
  OTHER_CATEGORY_OPTION,
} = await import("../src/domain/inventoryCatalog.mjs");
const { sortInventoryItems } = await import(
  "../src/domain/inventoryCompatibility.mjs"
);

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class FakeSnapshot {
  constructor(value) {
    this.value = value;
    this.exists = value !== undefined;
  }

  data() {
    return this.value;
  }
}

class FakeDocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new FakeCollectionReference(this.db, `${this.path}/${name}`);
  }
}

class FakeCollectionReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  doc(id) {
    const resolvedId = id || `auto_${++this.db.autoId}`;
    return new FakeDocumentReference(this.db, `${this.path}/${resolvedId}`);
  }

  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => {
        if (!path.startsWith(prefix)) return false;
        return !path.slice(prefix.length).includes("/");
      })
      .map(([path, value]) => ({
        id: path.slice(prefix.length),
        data: () => structuredClone(value),
      }));
    return { docs, size: docs.length };
  }
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
    this.autoId = 0;
    this.queue = Promise.resolve();
  }

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  seed(path, value) {
    this.documents.set(path, structuredClone(value));
  }

  read(path) {
    return this.documents.get(path);
  }

  matching(prefix) {
    return [...this.documents.entries()].filter(([path]) =>
      path.startsWith(prefix)
    );
  }

  runTransaction(callback) {
    const operation = this.queue.then(async () => {
      const working = new Map(
        [...this.documents.entries()].map(([path, value]) => [
          path,
          structuredClone(value),
        ])
      );
      const transaction = {
        get: async (reference) =>
          new FakeSnapshot(
            working.has(reference.path) ? working.get(reference.path) : undefined
          ),
        set: (reference, value, options = {}) => {
          const current = working.get(reference.path) || {};
          working.set(
            reference.path,
            options.merge ? { ...current, ...structuredClone(value) } : structuredClone(value)
          );
        },
        delete: (reference) => working.delete(reference.path),
      };
      const result = await callback(transaction);
      this.documents = working;
      return result;
    });
    this.queue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }
}

const FieldValue = {
  serverTimestamp: () => ({ __serverTimestamp: true }),
};
const dependencies = (db) => ({ db, FieldValue, HttpsError: TestHttpsError });
const request = (uid, data = {}) => ({ auth: { uid }, data });

function item(overrides = {}) {
  return {
    tipoItem: "producto",
    areaId: "area_informatica",
    categoriaId: "cat_hardware",
    nombre: "Notebook corporativo",
    unidad: "unidad",
    costoBase: 500000,
    margenDeseado: 20,
    precioInterno: 600000,
    marca: "Lenovo",
    modelo: "T14",
    stock: 4,
    stockMinimo: 1,
    ...overrides,
  };
}

async function expectCode(expectedCode, operation) {
  await assert.rejects(operation, (error) => error?.code === expectedCode);
}

async function main() {
  const uid = "inventory-model-user";
  const db = new FakeFirestore();
  const deps = dependencies(db);

  assert.equal(normalizeCatalogName("  Informática  "), "informatica");
  assert.equal(formatInternalCode("producto", 1), "PR-0001");
  assert.equal(formatInternalCode("servicio", 19), "SV-0019");
  assert.equal(formatInternalCode("actividad", 10000), "AC-10000");
  assert.equal(
    validateInventoryItemInput(
      item({ stock: -2 }),
      TestHttpsError,
      { allowNegativeStock: true }
    ).stock,
    -2
  );
  assert.throws(
    () => validateInventoryItemInput(item({ stock: -2 }), TestHttpsError),
    (error) => error?.code === "invalid-argument"
  );

  await initializeInventoryCatalogHandler(request(uid), deps);
  await initializeInventoryCatalogHandler(request(uid), deps);
  assert.equal(
    db.matching(`usuarios/${uid}/areas/`).length,
    INITIAL_INVENTORY_AREAS.length,
    "La inicialización debe ser persistente e idempotente."
  );
  assert.equal(
    db.matching(`usuarios/${uid}/categoriasInventario/`).length,
    INITIAL_INVENTORY_CATEGORIES.length,
    "La inicialización repetida no debe duplicar categorías."
  );
  assert.ok(
    db
      .matching(`usuarios/${uid}/categoriasInventario/`)
      .every(([, category]) => category.areaId === "area_informatica"),
    "Las categorías históricas TI deben quedar asociadas a Informática."
  );

  const compatibleUid = "inventory-existing-catalog";
  const compatibleDb = new FakeFirestore();
  compatibleDb.seed(`usuarios/${compatibleUid}/areas/area_existing_info`, {
    nombre: "  INFORMÁTICA ",
    estado: "activo",
    uidUsuario: compatibleUid,
  });
  await initializeInventoryCatalogHandler(
    request(compatibleUid),
    dependencies(compatibleDb)
  );
  await initializeInventoryCatalogHandler(
    request(compatibleUid),
    dependencies(compatibleDb)
  );
  assert.equal(
    compatibleDb.matching(`usuarios/${compatibleUid}/areas/`).length,
    INITIAL_INVENTORY_AREAS.length,
    "Una Área equivalente existente debe reutilizarse sin cambiar su ID."
  );
  assert.equal(
    compatibleDb.read(`usuarios/${compatibleUid}/areas/area_informatica`),
    undefined
  );
  assert.ok(
    compatibleDb
      .matching(`usuarios/${compatibleUid}/categoriasInventario/`)
      .every(([, category]) => category.areaId === "area_existing_info")
  );

  await expectCode("already-exists", () =>
    saveInventoryAreaHandler(
      request(uid, { nombre: "  INFORMÁTICA ", estado: "activo" }),
      deps
    )
  );

  const hardware = await saveInventoryCategoryHandler(
    request(uid, {
      areaId: "area_informatica",
      nombre: "Hardware",
      estado: "activo",
    }),
    deps
  );
  assert.ok(hardware.categoriaId);
  db.seed(
    `usuarios/${uid}/categoriasInventario/cat_hardware`,
    db.read(`usuarios/${uid}/categoriasInventario/${hardware.categoriaId}`)
  );

  await expectCode("already-exists", () =>
    saveInventoryCategoryHandler(
      request(uid, {
        areaId: "area_informatica",
        nombre: " hardware ",
      }),
      deps
    )
  );
  await saveInventoryCategoryHandler(
    request(uid, {
      areaId: "area_electricidad",
      nombre: "Hardware",
    }),
    deps
  );
  await expectCode("failed-precondition", () =>
    saveInventoryCategoryHandler(
      request(uid, {
        categoriaId: "cat_hardware",
        areaId: "area_electricidad",
        nombre: "Hardware de red",
      }),
      deps
    )
  );

  const [first, second] = await Promise.all([
    createInventoryItemWithCodeHandler(
      request(uid, { requestId: "request_product_0001", item: item() }),
      deps
    ),
    createInventoryItemWithCodeHandler(
      request(uid, {
        requestId: "request_product_0002",
        item: item({ nombre: "Notebook secundario" }),
      }),
      deps
    ),
  ]);
  assert.deepEqual(
    [first.codigoInterno, second.codigoInterno].sort(),
    ["PR-0001", "PR-0002"],
    "Dos altas concurrentes no deben duplicar correlativos."
  );
  assert.deepEqual(
    {
      impuestoId: db.read(`usuarios/${uid}/inventario/${first.itemId}`).impuestoId,
      impuestoTasa: db.read(`usuarios/${uid}/inventario/${first.itemId}`).impuestoTasa,
    },
    { impuestoId: "IVA_GENERAL", impuestoTasa: 19 },
    "Los productos nuevos deben recibir un impuesto estable sin modificar ítems previos."
  );

  const idempotentRetry = await createInventoryItemWithCodeHandler(
    request(uid, {
      requestId: "request_product_0001",
      item: item({ nombre: "El cliente reintentó con otro texto" }),
    }),
    deps
  );
  assert.equal(idempotentRetry.codigoInterno, first.codigoInterno);
  assert.equal(idempotentRetry.itemId, first.itemId);
  assert.equal(idempotentRetry.idempotent, true);
  assert.equal(
    db.read(`usuarios/${uid}/inventarioContadores/producto`).ultimoNumero,
    2,
    "Un reintento no debe consumir otro número."
  );

  const inventoryCountBeforeDoubleSubmit = db.matching(
    `usuarios/${uid}/inventario/`
  ).length;
  const doubleSubmit = await Promise.all([
    createInventoryItemWithCodeHandler(
      request(uid, {
        requestId: "request_double_submit_0001",
        item: item({ nombre: "Notebook doble envío" }),
      }),
      deps
    ),
    createInventoryItemWithCodeHandler(
      request(uid, {
        requestId: "request_double_submit_0001",
        item: item({ nombre: "Notebook doble envío" }),
      }),
      deps
    ),
  ]);
  assert.equal(doubleSubmit[0].itemId, doubleSubmit[1].itemId);
  assert.equal(doubleSubmit[0].codigoInterno, doubleSubmit[1].codigoInterno);
  assert.equal(
    db.matching(`usuarios/${uid}/inventario/`).length,
    inventoryCountBeforeDoubleSubmit + 1,
    "Un doble envío con la misma clave debe crear como máximo un ítem."
  );

  const service = await createInventoryItemWithCodeHandler(
    request(uid, {
      requestId: "request_service_0001",
      item: item({
        tipoItem: "servicio",
        nombre: "Instalación",
        marca: "No debe persistir",
        modelo: "No debe persistir",
        stock: 99,
        stockMinimo: 10,
      }),
    }),
    deps
  );
  const activity = await createInventoryItemWithCodeHandler(
    request(uid, {
      requestId: "request_activity_0001",
      item: item({ tipoItem: "actividad", nombre: "Levantamiento" }),
    }),
    deps
  );
  assert.equal(service.codigoInterno, "SV-0001");
  assert.equal(activity.codigoInterno, "AC-0001");
  const serviceData = db.read(`usuarios/${uid}/inventario/${service.itemId}`);
  assert.equal("marca" in serviceData, false);
  assert.equal("stock" in serviceData, false);

  const productCounterBeforeInvalid = db.read(
    `usuarios/${uid}/inventarioContadores/producto`
  ).ultimoNumero;
  await expectCode("invalid-argument", () =>
    createInventoryItemWithCodeHandler(
      request(uid, {
        requestId: "request_missing_area_0001",
        item: item({ areaId: "" }),
      }),
      deps
    )
  );
  await expectCode("invalid-argument", () =>
    createInventoryItemWithCodeHandler(
      request(uid, {
        requestId: "request_missing_category_0001",
        item: item({ categoriaId: "" }),
      }),
      deps
    )
  );
  await expectCode("invalid-argument", () =>
    createInventoryItemWithCodeHandler(
      request(uid, {
        requestId: "request_invalid_0001",
        item: item({ marca: "" }),
      }),
      deps
    )
  );
  assert.equal(
    db.read(`usuarios/${uid}/inventarioContadores/producto`).ultimoNumero,
    productCounterBeforeInvalid,
    "Validar o cancelar un alta no debe reservar números."
  );

  await expectCode("failed-precondition", () =>
    createInventoryItemWithCodeHandler(
      request(uid, {
        requestId: "request_mismatch_0001",
        item: item({ areaId: "area_electricidad" }),
      }),
      deps
    )
  );

  const areas = [
    { id: "a1", nombre: "Informática", estado: "activo" },
    { id: "a2", nombre: "Obra civil", estado: "activo" },
  ];
  const categories = [
    { id: "c1", areaId: "a1", nombre: "Redes", estado: "activo" },
    { id: "c2", areaId: "a1", nombre: "Bajas", estado: "inactivo" },
    { id: "c3", areaId: "a2", nombre: "Redes", estado: "activo" },
  ];
  assert.equal(isDuplicateAreaName(areas, " informatica "), true);
  assert.equal(isDuplicateCategoryName(categories, "a1", "REDES"), true);
  assert.equal(isDuplicateCategoryName(categories, "a2", "Redes", "c3"), false);
  assert.deepEqual(getCategoriesForArea(categories, "a1").map(({ id }) => id), [
    "c1",
  ]);
  assert.equal(keepCompatibleCategoryId(categories, "a2", "c1"), "");
  assert.deepEqual(buildNewCategoryPayload("a1", "  Redes   corporativas "), {
    areaId: "a1",
    nombre: "Redes corporativas",
  });
  assert.throws(() => buildNewCategoryPayload("a1", OTHER_CATEGORY_OPTION));
  assert.throws(() => buildNewCategoryPayload("a1", "Otra categoría…"));

  const legacyItems = sortInventoryItems([
    { id: "legacy-no-date", nombre: "Registro heredado", categoria: "Legacy" },
    { id: "newer", actualizadoEn: new Date("2026-01-02T00:00:00Z") },
    { id: "older", fechaCreacion: "2025-01-01T00:00:00Z" },
  ]);
  assert.equal(legacyItems.length, 3);
  assert.equal(legacyItems[0].id, "newer");
  assert.ok(
    legacyItems.some((item) => item.id === "legacy-no-date"),
    "Un registro legacy sin actualizadoEn debe seguir visible."
  );

  const managerSource = await readFile(
    new URL("../src/features/inventory/InventoryManager.jsx", import.meta.url),
    "utf8"
  );
  assert.match(managerSource, /Se asignará al guardar/);
  assert.doesNotMatch(managerSource, /name=["']sku["']/);
  assert.match(managerSource, /preserveLegacyModel/);
  assert.match(managerSource, /Otra categoría…/);
  assert.match(managerSource, /buildNewCategoryPayload/);
  assert.match(managerSource, /Administrar áreas y categorías/);
  assert.match(managerSource, /readOnly/);
  const catalogSubscriptionEffect = managerSource.slice(
    managerSource.indexOf("const unsubscribeAreas"),
    managerSource.indexOf("const catalogIsLoading")
  );
  assert.doesNotMatch(
    catalogSubscriptionEffect,
    /initializeInventoryCatalog\s*\(/,
    "Abrir Inventario solo debe suscribirse; inicializar el catálogo requiere acción explícita."
  );
  assert.match(managerSource, /window\.confirm\s*\(/);
  assert.match(managerSource, /disabled=\{saving \|\| !catalogReady\}/);
  assert.doesNotMatch(managerSource, /softDeleteInventoryItem|>\s*Eliminar\s*</);

  const catalogManagerSource = await readFile(
    new URL(
      "../src/features/inventory/InventoryCatalogManager.jsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(catalogManagerSource, /Reintentar carga/);
  assert.match(catalogManagerSource, /Crear catálogo inicial/);

  const firebaseConfigSource = await readFile(
    new URL("../src/firebase/firebaseConfig.js", import.meta.url),
    "utf8"
  );
  assert.match(firebaseConfigSource, /firebaseEnvironment\.isEmulator/);
  assert.match(firebaseConfigSource, /connectAuthEmulator/);
  assert.match(firebaseConfigSource, /connectFirestoreEmulator/);
  assert.match(firebaseConfigSource, /connectStorageEmulator/);

  const importerSource = await readFile(
    new URL("../src/features/inventory/InventoryAiImporter.jsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(importerSource, /INVENTORY_MODEL_IMPORT_PENDING|Etapa 2C-1B/);
  assert.match(importerSource, /confirmInventoryImportV2/);
  assert.match(importerSource, /validateInventoryImportPreviewRow/);

  console.log("INVENTORY_MODEL_SMOKE_OK");
}

main().catch((error) => {
  console.error("INVENTORY_MODEL_SMOKE_FAILED", error?.code || "", error);
  process.exitCode = 1;
});
