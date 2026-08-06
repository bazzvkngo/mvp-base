import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INVENTORY_UNITS,
  adaptInventoryItem,
  buildInventoryPayload,
  filterInventoryItems,
  parseInventoryNumber,
  summarizeInventory,
  validateInventoryDraft,
} from "../src/domain/inventoryMvp.mjs";
import {
  INVENTORY_TEMPLATE_COLUMNS,
  MAX_LOCAL_INVENTORY_ROWS,
  buildInventoryImportBatchRequestId,
  confirmLocalInventoryImport,
  getInventoryImportSummary,
  mapInventoryHeaders,
  revalidateInventoryImportCodes,
  transformInventorySpreadsheetRows,
  updateInventoryImportRow,
} from "../src/services/inventoryImportService.js";

const areas = [{ id: "area-1", nombre: "Informática", estado: "activo" }];
const categories = [{ id: "cat-1", areaId: "area-1", nombre: "Redes", estado: "activo" }];

function main() {
  [
    [520000, 520000],
    ["520000", 520000],
    ["520.000", 520000],
    ["$ 520.000", 520000],
    ["1.234.567", 1234567],
    ["12,5", 12.5],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1000.50", 1000.5],
    ["-10", -10],
  ].forEach(([input, expected]) => {
    assert.equal(parseInventoryNumber(input), expected, `Debe interpretar ${input}.`);
  });
  ["", Number.NaN, Number.POSITIVE_INFINITY, "NaN", "Infinity", "1.2.3", "1,23,456", "texto"]
    .forEach((input) => {
      assert.equal(parseInventoryNumber(input), null, `Debe rechazar ${input}.`);
    });

  const product = buildInventoryPayload({
    tipoItem: "producto", nombre: "Router", unidad: "unidad", costoBase: "1000",
    margenDeseado: "25", precioManual: "", stock: "4", stockMinimo: "2",
    areaId: "", categoriaId: "", descripcion: "",
  });
  assert.equal(product.precioInterno, 1250);
  assert.equal(product.stock, 4);
  assert.equal(product.areaId, "");
  assert.equal(product.estado, "activo", "Un ítem nuevo debe quedar activo.");
  const chileanFormattedProduct = buildInventoryPayload({
    tipoItem: "producto", nombre: "Equipo", unidad: "unidad", costoBase: "520.000",
    margenDeseado: "12,5", precioManual: "", stock: "1", stockMinimo: "0",
    areaId: "", categoriaId: "", descripcion: "",
  });
  assert.equal(chileanFormattedProduct.costoBase, 520000);
  assert.equal(chileanFormattedProduct.margenDeseado, 12.5);
  assert.equal(
    buildInventoryPayload(product, [], { authorizedStatus: "activo" }).estado,
    "activo",
    "Editar un ítem activo debe conservar su estado."
  );
  assert.equal(
    buildInventoryPayload(product, [], { authorizedStatus: "inactivo" }).estado,
    "inactivo",
    "Editar un ítem inactivo no debe reactivarlo."
  );
  assert.equal(
    buildInventoryPayload(product, [], { authorizedStatus: "eliminado" }).estado,
    "eliminado",
    "Editar un estado legacy permitido debe conservarlo."
  );

  const service = buildInventoryPayload({
    tipoItem: "servicio", nombre: "Soporte", unidad: "hora", costoBase: "20000",
    margenDeseado: "30", precioManual: "30000", areaId: "", categoriaId: "",
  });
  assert.equal(service.precioInterno, 30000);
  assert.equal(service.precioManual, true);
  assert.equal("stock" in service, false);

  const activity = buildInventoryPayload({
    tipoItem: "actividad", nombre: "Levantamiento", unidad: "actividad", costoBase: "0",
    margenDeseado: "0", precioManual: "", areaId: "", categoriaId: "",
  });
  assert.equal("stock" in activity, false);
  assert.equal(Object.keys(validateInventoryDraft({ ...activity, stock: "-1" })).length, 0);
  assert.ok(validateInventoryDraft({ ...product, costoBase: "-1" }).costoBase);
  assert.ok(validateInventoryDraft({ ...product, costoBase: "Infinity" }).costoBase);
  assert.ok(validateInventoryDraft({ ...product, costoBase: "1.2.3" }).costoBase);
  assert.ok(validateInventoryDraft({ ...product, costoBase: "valor inválido" }).costoBase);
  assert.ok(INVENTORY_UNITS.some((unit) => unit.label === "Metro cuadrado (m²)"));

  const legacy = adaptInventoryItem({ nombre: "Legacy", precio: 900, stock: 2 });
  assert.equal(legacy.tipoItem, "producto");
  assert.equal(legacy.costoBase, 900);
  const list = [
    { id: "p", nombre: "Router", codigoInterno: "PR-0001", tipoItem: "producto", costoBase: 100, margenDeseado: 20, stock: 1, stockMinimo: 2, estado: "activo" },
    { id: "s", nombre: "Soporte", tipoItem: "servicio", costoBase: 200, margenDeseado: 10, estado: "activo" },
    { id: "a", nombre: "Archivado", tipoItem: "actividad", costoBase: 100, margenDeseado: 10, estado: "inactivo" },
  ];
  assert.equal(summarizeInventory(list).total, 2);
  assert.equal(summarizeInventory(list).lowStock, 1);
  assert.equal(summarizeInventory(list).inventoryCost, 100);
  assert.deepEqual(filterInventoryItems(list, { query: "pr-0001", status: "activo" }).map(({ id }) => id), ["p"]);
  assert.deepEqual(filterInventoryItems(list, { type: "servicio", status: "activo" }).map(({ id }) => id), ["s"]);

  const headers = mapInventoryHeaders(["TÍPO ÍTEM", "Producto", "Código", "Área", "Categoría", "Medida", "Costo Base", "Margen %", "Precio venta", "Cantidad", "Stock mínimo", "Descripción"]);
  assert.equal(headers.tipoItem, 0);
  assert.equal(headers.nombre, 1);
  assert.equal(headers.costoBase, 6);
  const rows = transformInventorySpreadsheetRows([
    ["tipo", "nombre", "codigo", "área", "categoría", "unidad", "costo_base", "margen", "precio_manual", "stock", "stock_mínimo", "descripción"],
    ["producto", "Switch", "SW-01", "Informática", "Redes", "unidad", 50000, 20, "", 5, 1, "Gestionable"],
    ["servicio", "Instalación", "", "", "", "hora", 10000, 30, "", 8, 2, ""],
    ["", "Fila a revisar", "", "", "", "unidad", 100, 10, "", "", "", ""],
    ["producto", "", "", "", "", "unidad", -1, 10, "", 0, 0, ""],
  ], { areas, categories });
  assert.equal(rows[0].draft.areaId, "area-1");
  assert.equal(rows[0].draft.categoriaId, "cat-1");
  assert.equal(Object.keys(rows[0].fieldErrors).length, 0);
  assert.ok(rows[1].warnings.some((warning) => warning.includes("stock")));
  assert.ok(rows[2].fieldErrors.tipoItem);
  assert.ok(rows[3].fieldErrors.nombre);
  assert.ok(rows[3].fieldErrors.costoBase);
  assert.equal(getInventoryImportSummary(rows).invalid, 2);

  const formattedImportRows = transformInventorySpreadsheetRows([
    ["tipo", "nombre", "codigo", "area", "categoria", "unidad", "costo_base", "margen", "precio_manual", "stock", "stock_minimo", "descripcion"],
    ["servicio", "Soporte en terreno", "", "", "", "servicio", "$12.500", "12,5", "", "", "", ""],
  ]);
  assert.equal(Object.keys(formattedImportRows[0].fieldErrors).length, 0);
  const formattedImportPayload = buildInventoryPayload(formattedImportRows[0].draft);
  assert.equal(formattedImportPayload.costoBase, 12500);
  assert.equal(formattedImportPayload.margenDeseado, 12.5);

  const duplicated = revalidateInventoryImportCodes([
    rows[0],
    updateInventoryImportRow(rows[1], "codigoSolicitado", "SW-01"),
  ]);
  assert.ok(duplicated.every((row) => row.fieldErrors.codigoSolicitado));
  const duplicateExcluded = revalidateInventoryImportCodes(
    duplicated.map((row, index) => index === 1 ? { ...row, included: false } : row)
  );
  assert.equal(duplicateExcluded[0].fieldErrors.codigoSolicitado, undefined);
  assert.equal(duplicateExcluded[1].fieldErrors.codigoSolicitado, undefined);
  assert.equal(getInventoryImportSummary(duplicateExcluded).invalid, 0);
  const duplicateReincluded = revalidateInventoryImportCodes(
    duplicateExcluded.map((row) => ({ ...row, included: true }))
  );
  assert.ok(duplicateReincluded.every((row) => row.fieldErrors.codigoSolicitado));
  const existingCodeIncluded = revalidateInventoryImportCodes(
    [{ ...rows[0], included: true }],
    [{ sku: "SW-01" }]
  );
  assert.match(existingCodeIncluded[0].fieldErrors.codigoSolicitado, /ya existe/);
  const existingCodeExcluded = revalidateInventoryImportCodes(
    [{ ...existingCodeIncluded[0], included: false }],
    [{ sku: "SW-01" }]
  );
  assert.equal(getInventoryImportSummary(existingCodeExcluded).invalid, 0);
  const reserved = updateInventoryImportRow(rows[1], "codigoSolicitado", "PR-0099");
  assert.match(reserved.fieldErrors.codigoSolicitado, /reservados/);
  const excluded = rows.map((row, index) => index >= 2 ? { ...row, included: false } : row);
  assert.equal(getInventoryImportSummary(excluded).excluded, 2);
  assert.equal(MAX_LOCAL_INVENTORY_ROWS, 500);
  assert.deepEqual(INVENTORY_TEMPLATE_COLUMNS, [
    "tipo", "nombre", "codigo", "area", "categoria", "unidad", "costo_base",
    "margen", "precio_manual", "stock", "stock_minimo", "descripcion",
  ]);
}

async function retryChecks() {
  const requestIdBase = "inventory_local_retry_test";
  assert.equal(buildInventoryImportBatchRequestId(requestIdBase, 0), `${requestIdBase}_0`);
  assert.equal(buildInventoryImportBatchRequestId(requestIdBase, 200), `${requestIdBase}_200`);

  const importRows = Array.from({ length: 201 }, (_, index) => ({
    rowId: `retry_${index}`,
    sourceRow: index + 2,
    included: true,
    fieldErrors: {},
    warnings: [],
    draft: {
      tipoItem: "servicio",
      nombre: `Servicio ${index}`,
      unidad: "servicio",
      costoBase: 100,
      margenDeseado: 10,
      precioManual: "",
      areaId: "",
      categoriaId: "",
      descripcion: "",
    },
  }));
  const persistedByRequest = new Map();
  const requestIds = [];
  let failSecondBatch = true;
  const confirmBatch = async (_businessId, payload) => {
    requestIds.push(payload.requestId);
    if (payload.requestId === `${requestIdBase}_200` && failSecondBatch) {
      failSecondBatch = false;
      throw new Error("Falla simulada del segundo lote.");
    }
    if (!persistedByRequest.has(payload.requestId)) {
      persistedByRequest.set(payload.requestId, payload.rows.map((row) => ({
        rowId: row.rowId,
        itemId: `item_${row.rowId}`,
      })));
    }
    return { results: persistedByRequest.get(payload.requestId) };
  };

  await assert.rejects(
    confirmLocalInventoryImport({
      businessId: "business-retry",
      rows: importRows,
      requestIdBase,
      confirmBatch,
    }),
    (error) => error.partialCreated === 200 && error.remaining === 1
  );
  const retried = await confirmLocalInventoryImport({
    businessId: "business-retry",
    rows: importRows,
    requestIdBase,
    confirmBatch,
  });
  assert.deepEqual(requestIds, [
    `${requestIdBase}_0`,
    `${requestIdBase}_200`,
    `${requestIdBase}_0`,
    `${requestIdBase}_200`,
  ]);
  assert.equal(retried.created, 201);
  assert.equal(new Set(retried.results.map(({ itemId }) => itemId)).size, 201);
  assert.equal(
    [...persistedByRequest.values()].flat().length,
    201,
    "Reintentar el lote cero debe ser idempotente y no duplicar registros."
  );
}

async function sourceChecks() {
  const page = await readFile(new URL("../src/pages/InventoryPage.jsx", import.meta.url), "utf8");
  const importer = await readFile(new URL("../src/features/inventory/InventoryImportDialog.jsx", import.meta.url), "utf8");
  const importService = await readFile(new URL("../src/services/inventoryImportService.js", import.meta.url), "utf8");
  assert.doesNotMatch(page, /InventoryAiImporter|Gemini|normalizeInventoryDocument|normalizeInventoryItems/);
  assert.doesNotMatch(importer + importService, /Gemini|OCR|Firebase Storage|normalizeInventoryDocument|normalizeInventoryItems/);
  assert.match(importService, /confirmManagedInventoryImport/);
  assert.match(importer, /Nada se guarda hasta tu confirmación/);
  assert.match(importer, /Reintentar importación/);
  assert.match(importer, /No vuelvas a importar el archivo completo con una solicitud nueva/);
  assert.match(importer, /toggleRow\(row\.rowId, event\.target\.checked\)/);
  assert.equal(
    (importer.match(/requestIdBaseRef\.current\s*=/g) || []).length,
    2,
    "Solo cargar otro archivo y cerrar deben cambiar la base idempotente."
  );
  assert.match(importer, /requestIdBaseRef\.current = createInventoryImportRequestIdBase\(\)/);
  assert.match(importer, /requestIdBaseRef\.current = ""/);
}

main();
await retryChecks();
await sourceChecks();
console.log("INVENTORY_MVP_SMOKE_OK");
