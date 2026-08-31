import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  INITIAL_INVENTORY_AREAS,
  INITIAL_INVENTORY_CATEGORIES,
  confirmInventoryImportV2Handler,
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
    await this.db.beforeCollectionGet?.(this.path);
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
    this.beforeCollectionGet = null;
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
    barcode: "",
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
  const taxedFormation = validateInventoryItemInput(item({
    costoBase: 100000,
    margenDeseado: 25,
    formacionPrecioVersion: 2,
    tasaImpuestoCompra: 19,
  }), TestHttpsError);
  assert.equal(taxedFormation.montoImpuestoCompra, 19000);
  assert.equal(taxedFormation.costoPagado, 119000);
  assert.equal(taxedFormation.precioVentaSugerido, 148750);
  assert.equal(taxedFormation.precioInterno, 148750);
  const customTaxFormation = validateInventoryItemInput(item({
    costoBase: 100000,
    margenDeseado: 20,
    formacionPrecioVersion: 2,
    tasaImpuestoCompra: 10,
  }), TestHttpsError);
  assert.equal(customTaxFormation.costoPagado, 110000);
  assert.equal(customTaxFormation.precioInterno, 132000);
  const manuallyPricedFormation = validateInventoryItemInput(item({
    costoBase: 100000,
    margenDeseado: 25,
    formacionPrecioVersion: 2,
    tasaImpuestoCompra: 19,
    precioManual: true,
    precioInterno: 140000,
  }), TestHttpsError);
  assert.equal(manuallyPricedFormation.precioVentaSugerido, 148750);
  assert.equal(manuallyPricedFormation.precioInterno, 140000);
  const historicalFormation = validateInventoryItemInput(item({
    costoBase: 100000,
    margenDeseado: 25,
    precioInterno: 125000,
  }), TestHttpsError);
  assert.equal(historicalFormation.precioInterno, 125000);
  assert.equal("formacionPrecioVersion" in historicalFormation, false);
  assert.throws(
    () => validateInventoryItemInput(item({
      formacionPrecioVersion: 2,
      tasaImpuestoCompra: 101,
    }), TestHttpsError),
    (error) => error?.code === "invalid-argument"
  );
  const serviceWithoutProductPricing = validateInventoryItemInput(item({
    tipoItem: "servicio",
    unidad: "hora",
    formacionPrecioVersion: 2,
    tasaImpuestoCompra: 19,
  }), TestHttpsError);
  assert.equal("formacionPrecioVersion" in serviceWithoutProductPricing, false);
  assert.equal("tasaImpuestoCompra" in serviceWithoutProductPricing, false);
  const referencePurchase = validateInventoryItemInput(item({
    proveedorNombre: " Prodalam S.A. ",
    proveedorRut: "937720009",
    fechaCompraReferencia: "2026-08-24",
    numeroFacturaReferencia: " 06897040 ",
  }), TestHttpsError);
  assert.equal(referencePurchase.proveedorNombre, "Prodalam S.A.");
  assert.equal(referencePurchase.proveedorRut, "93.772.000-9");
  assert.equal(referencePurchase.fechaCompraReferencia, "2026-08-24");
  assert.equal(referencePurchase.numeroFacturaReferencia, "06897040");
  assert.throws(
    () => validateInventoryItemInput(item({fechaCompraReferencia: "2026-02-31"}), TestHttpsError),
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
      request(uid, {
        requestId: "request_product_0001",
        item: item({
          barcode: "0012345678905",
          codigoSolicitado: "FORZADO-001",
          codigoInterno: "FORZADO-001",
          proveedorNombre: "Prodalam S.A.",
          proveedorRut: "937720009",
          fechaCompraReferencia: "2026-08-24",
          numeroFacturaReferencia: "06897040",
        }),
      }),
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
  assert.notEqual(first.codigoInterno, "FORZADO-001");
  assert.notEqual(
    db.read(`usuarios/${uid}/inventario/${first.itemId}`).codigoInterno,
    "FORZADO-001",
    "El Callable manual debe ignorar códigos aportados por el cliente."
  );
  assert.deepEqual(
    {
      impuestoId: db.read(`usuarios/${uid}/inventario/${first.itemId}`).impuestoId,
      impuestoTasa: db.read(`usuarios/${uid}/inventario/${first.itemId}`).impuestoTasa,
    },
    { impuestoId: "IVA_GENERAL", impuestoTasa: 19 },
    "Los productos nuevos deben recibir un impuesto estable sin modificar ítems previos."
  );
  assert.equal(
    db.read(`usuarios/${uid}/inventario/${first.itemId}`).barcode,
    "0012345678905",
    "El código de barras debe persistir como string y conservar ceros iniciales."
  );
  const referencedProduct = db.read(`usuarios/${uid}/inventario/${first.itemId}`);
  assert.equal(referencedProduct.proveedorNombre, "Prodalam S.A.");
  assert.equal(referencedProduct.proveedorRut, "93.772.000-9");
  assert.equal(referencedProduct.fechaCompraReferencia, "2026-08-24");
  assert.equal(referencedProduct.numeroFacturaReferencia, "06897040");
  const productWithoutReference = db.read(`usuarios/${uid}/inventario/${second.itemId}`);
  assert.equal("proveedorNombre" in productWithoutReference, false);
  assert.equal("proveedorRut" in productWithoutReference, false);
  assert.equal("fechaCompraReferencia" in productWithoutReference, false);
  assert.equal("numeroFacturaReferencia" in productWithoutReference, false);

  await expectCode("already-exists", () =>
    createInventoryItemWithCodeHandler(
      request(uid, {
        requestId: "request_duplicate_barcode_0001",
        item: item({barcode: "0012345678905"}),
      }),
      deps
    )
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

  db.seed(`usuarios/${uid}/inventario/occupied-legacy-sku`, {
    sku: "  legacy sku 042  ",
  });
  await expectCode("already-exists", () =>
    confirmInventoryImportV2Handler(
      request(uid, {
        requestId: "import_occupied_legacy_0001",
        rows: [{
          rowId: "legacy-sku-row",
          item: item({ codigoSolicitado: "LEGACY-SKU-042" }),
        }],
      }),
      deps
    )
  );

  db.seed("usuarios/inventory-other-business/inventario/foreign-code", {
    codigoInterno: "OTHER-BUSINESS-001",
    sku: "OTHER-BUSINESS-LEGACY-001",
    barcode: "0099999999999",
    tipoItem: "producto",
    estado: "activo",
  });
  const crossBusinessAllowed = await confirmInventoryImportV2Handler(
    request(uid, {
      requestId: "import_cross_business_0001",
      rows: [{
        rowId: "cross-business-row",
        item: item({
          codigoSolicitado: "OTHER-BUSINESS-001",
          barcode: "0099999999999",
        }),
      }],
    }),
    deps
  );
  assert.equal(crossBusinessAllowed.results[0].codigoInterno, "OTHER-BUSINESS-001");

  const freeImportRequest = request(uid, {
    requestId: "import_free_code_0001",
    rows: [{
      rowId: "free-code-row",
      item: item({ codigoSolicitado: "FREE-CODE-001" }),
    }],
  });
  const freeImport = await confirmInventoryImportV2Handler(
    freeImportRequest,
    deps
  );
  assert.equal(freeImport.results[0].codigoInterno, "FREE-CODE-001");
  const freeImportRetry = await confirmInventoryImportV2Handler(
    freeImportRequest,
    deps
  );
  assert.equal(freeImportRetry.idempotent, true);
  assert.deepEqual(freeImportRetry.results, freeImport.results);

  const concurrentManualCodes = await Promise.all([
    createInventoryItemWithCodeHandler(
      request(uid, {
        requestId: "request_code_race_0001",
        item: item({ codigoSolicitado: "RACE-CODE-001" }),
      }),
      deps
    ),
    createInventoryItemWithCodeHandler(
      request(uid, {
        requestId: "request_code_race_0002",
        item: item({ codigoSolicitado: "RACE-CODE-001" }),
      }),
      deps
    ),
  ]);
  assert.equal(new Set(concurrentManualCodes.map(({codigoInterno}) => codigoInterno)).size, 2);
  assert.equal(
    concurrentManualCodes.every(({codigoInterno}) =>
      /^PR-\d+$/.test(codigoInterno) && codigoInterno !== "RACE-CODE-001"
    ),
    true,
    "Altas manuales concurrentes deben ignorar el mismo código forzado y usar correlativos distintos."
  );

  const service = await createInventoryItemWithCodeHandler(
    request(uid, {
      requestId: "request_service_0001",
      item: item({
        tipoItem: "servicio",
        nombre: "Instalación",
        marca: "No debe persistir",
        modelo: "No debe persistir",
        barcode: "0000001",
        stock: 99,
        stockMinimo: 10,
        proveedorNombre: "No debe persistir",
        proveedorRut: "93.772.000-9",
        fechaCompraReferencia: "2026-08-24",
        numeroFacturaReferencia: "123",
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
  assert.equal("modelo" in serviceData, false);
  assert.equal("barcode" in serviceData, false);
  assert.equal("stock" in serviceData, false);
  assert.equal("stockMinimo" in serviceData, false);
  assert.equal("proveedorNombre" in serviceData, false);
  assert.equal("proveedorRut" in serviceData, false);
  assert.equal("fechaCompraReferencia" in serviceData, false);
  assert.equal("numeroFacturaReferencia" in serviceData, false);
  const activityData = db.read(`usuarios/${uid}/inventario/${activity.itemId}`);
  assert.equal("marca" in activityData, false);
  assert.equal("modelo" in activityData, false);
  assert.equal("barcode" in activityData, false);
  assert.equal("stock" in activityData, false);
  assert.equal("stockMinimo" in activityData, false);

  const productCounterBeforeInvalid = db.read(
    `usuarios/${uid}/inventarioContadores/producto`
  ).ultimoNumero;
  const unclassified = await createInventoryItemWithCodeHandler(
    request(uid, {
      requestId: "request_unclassified_0001",
      item: item({ areaId: "", categoriaId: "", marca: "", modelo: "" }),
    }),
    deps
  );
  const unclassifiedData = db.read(
    `usuarios/${uid}/inventario/${unclassified.itemId}`
  );
  assert.equal("areaId" in unclassifiedData, false);
  assert.equal("categoriaId" in unclassifiedData, false);
  assert.equal(unclassifiedData.categoria, "");
  assert.equal("marca" in unclassifiedData, false);
  assert.equal(
    db.read(`usuarios/${uid}/inventarioContadores/producto`).ultimoNumero,
    productCounterBeforeInvalid + 1,
    "Crear sin clasificación debe consumir un único correlativo seguro."
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
  assert.match(managerSource, /Se asignará automáticamente/);
  assert.doesNotMatch(managerSource, /name=["']sku["']/);
  assert.match(managerSource, /SKU \/ código interno/);
  assert.match(managerSource, /Código de barras/);
  assert.match(managerSource, /Stock bajo/);
  assert.match(managerSource, /requestId:\s*createRequestRef\.current/);
  assert.match(
    managerSource,
    /authorizedStatus:\s*editingItem\s*\?\s*adaptInventoryItem\(editingItem\)\.estado/,
    "Guardar una edición debe conservar el estado autorizado del ítem."
  );
  assert.match(managerSource, /Sin área/);
  assert.match(managerSource, /Áreas y categorías/);
  assert.match(managerSource, /readOnly/);
  assert.doesNotMatch(managerSource, /initializeInventoryCatalog\s*\(/);
  assert.match(managerSource, /ResponsiveDialog/);
  assert.match(managerSource, /Importar inventario/);
  assert.match(managerSource, /inventory-type-selector/);
  assert.doesNotMatch(managerSource, /← Cambiar tipo/);
  assert.match(managerSource, /tipoItem:\s*"producto"/);
  assert.doesNotMatch(managerSource, /Selecciona el tipo de ítem para continuar/);
  assert.match(managerSource, /Nombre del ítem/);
  assert.match(managerSource, /Administrar áreas y categorías/);
  assert.match(managerSource, /Definir precio de venta manual/);
  assert.match(managerSource, /<h3>Precio<\/h3>/);
  assert.match(managerSource, /<h3>Existencias<\/h3>/);
  assert.doesNotMatch(managerSource, /Código interno \(opcional\)|Costos y precios|Administrar catálogo completo/);
  assert.match(managerSource, /catalogReturnToForm/);
  assert.match(managerSource, /updateDraft\("areaId", result\.areaId\)/);
  assert.match(managerSource, /updateDraft\("categoriaId", result\.categoriaId\)/);
  assert.match(managerSource, /footer=.*inventory-item-form/s);
  assert.doesNotMatch(managerSource, /softDeleteInventoryItem|>\s*Eliminar\s*</);

  const catalogManagerSource = await readFile(
    new URL(
      "../src/features/inventory/InventoryCatalogManager.jsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(catalogManagerSource, /Reintentar carga/);
  assert.match(catalogManagerSource, /Aún no tienes áreas creadas/);
  assert.match(catalogManagerSource, /Crear primera área/);
  assert.doesNotMatch(catalogManagerSource, /Crear catálogo inicial|Verificar catálogo inicial|initializeInventoryCatalog|Informática|Hardware|Software|Redes/);

  const firebaseConfigSource = await readFile(
    new URL("../src/firebase/firebaseConfig.js", import.meta.url),
    "utf8"
  );
  assert.match(firebaseConfigSource, /firebaseEnvironment\.isEmulator/);
  assert.match(firebaseConfigSource, /connectAuthEmulator/);
  assert.match(firebaseConfigSource, /connectFirestoreEmulator/);
  assert.match(firebaseConfigSource, /connectStorageEmulator/);

  const inventoryPageSource = await readFile(
    new URL("../src/pages/InventoryPage.jsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(inventoryPageSource, /InventoryAiImporter|Gemini/);
  assert.match(inventoryPageSource, /InventoryManager/);

  console.log("INVENTORY_MODEL_SMOKE_OK");
}

main().catch((error) => {
  console.error("INVENTORY_MODEL_SMOKE_FAILED", error?.code || "", error);
  process.exitCode = 1;
});
