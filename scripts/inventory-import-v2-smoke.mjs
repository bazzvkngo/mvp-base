import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_INVENTORY_IMPORT_BATCH_SIZE,
  keepInventoryImportCategoryForArea,
  resolveInventoryImportCatalog,
  stripProductFieldsForInventoryImport,
  validateInventoryImportPreviewRow,
} from "../src/domain/inventoryImportV2.mjs";
import {
  normalizeInventoryAiResponse,
  translateInventoryAiError,
} from "../src/services/inventoryAiClient.mjs";

const areas = [
  { id: "a-info", nombre: "Informática", estado: "activo" },
  { id: "a-civil", nombre: "Obra civil", estado: "activo" },
  { id: "a-old", nombre: "Área histórica", estado: "inactivo" },
];
const categories = [
  { id: "c-redes", areaId: "a-info", nombre: "Redes", estado: "activo" },
  { id: "c-redes-civil", areaId: "a-civil", nombre: "Redes", estado: "activo" },
  { id: "c-old", areaId: "a-info", nombre: "Legacy", estado: "inactivo" },
];

function validProduct(overrides = {}) {
  return {
    id: "row-product",
    tipoItem: "producto",
    areaId: "a-info",
    categoriaId: "c-redes",
    areaResolutionStatus: "resolved",
    categoryResolutionStatus: "resolved",
    nombre: "Router",
    unidad: "unidad",
    costoBase: "1000",
    margenDeseado: "25",
    marca: "Cisco",
    modelo: "ISR",
    stock: "2",
    stockMinimo: "1",
    codigoBarras: "",
    ...overrides,
  };
}

async function main() {
  assert.equal(MAX_INVENTORY_IMPORT_BATCH_SIZE, 200);

  const exact = resolveInventoryImportCatalog(
    { areaPropuesta: "  INFORMATICA ", categoriaPropuesta: " rédes " },
    areas,
    categories
  );
  assert.equal(exact.areaId, "a-info");
  assert.equal(exact.categoriaId, "c-redes");

  assert.equal(
    resolveInventoryImportCatalog(
      { areaPropuesta: "Finanzas", categoriaPropuesta: "Redes" },
      areas,
      categories
    ).areaResolutionStatus,
    "unrecognized"
  );
  assert.equal(
    resolveInventoryImportCatalog(
      { areaPropuesta: "Área histórica", categoriaPropuesta: "Legacy" },
      areas,
      categories
    ).areaResolutionStatus,
    "inactive"
  );
  assert.equal(
    resolveInventoryImportCatalog(
      { areaPropuesta: "Informática", categoriaPropuesta: "Sin categoría" },
      areas,
      categories
    ).categoryResolutionStatus,
    "unrecognized"
  );
  assert.equal(
    resolveInventoryImportCatalog(
      {
        areaId: "a-civil",
        categoriaId: "c-redes",
      },
      areas,
      categories
    ).categoryResolutionStatus,
    "incompatible"
  );
  assert.equal(
    resolveInventoryImportCatalog(
      { areaPropuesta: "Informática", categoriaPropuesta: "Legacy" },
      areas,
      categories
    ).categoryResolutionStatus,
    "inactive"
  );

  const ambiguousAreas = [
    ...areas,
    { id: "a-info-duplicate", nombre: "informatica", estado: "activo" },
  ];
  assert.equal(
    resolveInventoryImportCatalog(
      { areaPropuesta: "Informática", categoriaPropuesta: "Redes" },
      ambiguousAreas,
      categories
    ).areaResolutionStatus,
    "ambiguous"
  );
  const ambiguousCategories = [
    ...categories,
    { id: "c-redes-duplicate", areaId: "a-info", nombre: "REDES", estado: "activo" },
  ];
  assert.equal(
    resolveInventoryImportCatalog(
      { areaPropuesta: "Informática", categoriaPropuesta: "Redes" },
      areas,
      ambiguousCategories
    ).categoryResolutionStatus,
    "ambiguous"
  );

  assert.equal(
    keepInventoryImportCategoryForArea(categories, "a-civil", "c-redes"),
    "",
    "Cambiar el Área debe limpiar una Categoría incompatible."
  );
  assert.equal(
    keepInventoryImportCategoryForArea(categories, "a-info", "c-redes"),
    "c-redes"
  );

  assert.deepEqual(validateInventoryImportPreviewRow(validProduct(), areas, categories), []);
  const invalidProduct = validateInventoryImportPreviewRow(
    validProduct({ marca: "", modelo: "", stock: "-1", stockMinimo: "" }),
    areas,
    categories
  );
  assert.ok(invalidProduct.some((message) => message.includes("Marca")));
  assert.ok(invalidProduct.some((message) => message.includes("Modelo")));
  assert.ok(invalidProduct.some((message) => message.includes("Stock actual")));
  assert.ok(invalidProduct.some((message) => message.includes("Stock mínimo")));

  const service = stripProductFieldsForInventoryImport({
    ...validProduct({ tipoItem: "servicio" }),
  });
  assert.equal("marca" in service, false);
  assert.equal("modelo" in service, false);
  assert.equal("stock" in service, false);
  assert.equal("codigoBarras" in service, false);
  assert.deepEqual(validateInventoryImportPreviewRow(service, areas, categories), []);

  const oldResponse = normalizeInventoryAiResponse({
    items: [
      {
        nombre: "Servicio anterior",
        tipoItem: "servicio",
        area: "Informática",
        categoria: "Redes",
      },
    ],
  });
  assert.equal(oldResponse.items.length, 1);
  assert.equal(
    resolveInventoryImportCatalog(oldResponse.items[0], areas, categories)
      .categoriaId,
    "c-redes"
  );
  assert.throws(() => normalizeInventoryAiResponse({ result: {} }));

  const catalogChangedError = new Error("failed");
  catalogChangedError.code = "functions/failed-precondition";
  catalogChangedError.details = {
    internalCode: "inventory_import_catalog_changed",
  };
  assert.equal(
    translateInventoryAiError(catalogChangedError, { operation: "save" }).kind,
    "catalog_changed"
  );

  const importerSource = await readFile(
    new URL("../src/features/inventory/InventoryAiImporter.jsx", import.meta.url),
    "utf8"
  );
  const saveSource = importerSource.slice(
    importerSource.indexOf("const handleSave"),
    importerSource.indexOf("return (", importerSource.indexOf("const handleSave"))
  );
  assert.match(saveSource, /confirmInventoryImportV2/);
  assert.match(saveSource, /saveInFlightRef\.current/);
  assert.match(saveSource, /setSaveBackendCompatible\(false\)/);
  assert.doesNotMatch(saveSource, /normalizeInventorySourceWithAi|Gemini/);
  assert.doesNotMatch(importerSource, /importarInventarioEnFirestore|Etapa 2C-1B/);
  assert.match(importerSource, /getInventoryAreas/);
  assert.match(importerSource, /validateInventoryImportPreviewRow/);
  assert.match(importerSource, /El código interno se asignará únicamente al confirmar/);
  assert.match(importerSource, /runInventoryAnalysisSingleFlight/);
  assert.match(importerSource, /getInventoryImportAiRateLimitStatus/);

  const modelSource = await readFile(
    new URL("../functions/inventoryModel.js", import.meta.url),
    "utf8"
  );
  assert.match(modelSource, /confirmInventoryImportV2Handler/);
  assert.match(modelSource, /runTransaction/);
  assert.match(modelSource, /inventoryImportRequests/);
  assert.match(modelSource, /inventory_import_batch_too_large/);
  assert.match(modelSource, /inventory_import_catalog_changed/);
  assert.match(modelSource, /codigoInterno/);

  const rulesSource = await readFile(
    new URL("../firestore.rules", import.meta.url),
    "utf8"
  );
  assert.match(rulesSource, /match \/inventoryImportRequests\/\{requestId\}/);

  console.log("INVENTORY_IMPORT_V2_SMOKE_OK");
}

main().catch((error) => {
  console.error("INVENTORY_IMPORT_V2_SMOKE_FAILED", error?.code || "", error);
  process.exitCode = 1;
});
