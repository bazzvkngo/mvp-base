import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INVENTORY_UNITS,
  INVENTORY_PRICE_FORMATION_VERSION,
  LEGACY_PURCHASE_TAX_PRICE_FORMATION_VERSION,
  adaptInventoryItem,
  buildInventoryPayload,
  calculateInventoryPriceFormation,
  filterInventoryItems,
  isInventoryLowStock,
  parseInventoryNumber,
  summarizeInventory,
  validateInventoryDraft,
} from "../src/domain/inventoryMvp.mjs";
import { isLowStockByRule } from "../src/domain/inventoryLowStock.mjs";
import { getInventoryMetrics } from "../src/domain/reportModel.mjs";
import {
  INVENTORY_TEMPLATE_COLUMNS,
  MAX_LOCAL_INVENTORY_ROWS,
  markInventoryImportRowsExempt,
  buildInventoryImportBatchRequestId,
  confirmLocalInventoryImport,
  getInventoryImportSummary,
  mapInventoryHeaders,
  revalidateInventoryImportCodes,
  transformInventoryDocumentCandidates,
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
    tipoItem: "producto", codigoSolicitado: " nb-001 ", nombre: "Router", unidad: "unidad", costoBase: "1000",
    margenDeseado: "25", precioManual: "", stock: "4", stockMinimo: "2",
    marca: " Lenovo ", modelo: " ThinkPad E13 ", codigoBarras: " 07801234567890 ",
    areaId: "", categoriaId: "", descripcion: "",
  });
  assert.equal(product.codigoSolicitado, "NB-001");
  assert.equal(product.marca, "Lenovo");
  assert.equal(product.modelo, "ThinkPad E13");
  assert.equal(product.barcode, "07801234567890");
  assert.equal(product.precioInterno, 1250);
  assert.equal(product.stock, 4);
  assert.equal(product.proveedorNombre, "");
  assert.equal(product.proveedorRut, "");
  assert.equal(product.fechaCompraReferencia, "");
  assert.equal(product.numeroFacturaReferencia, "");
  assert.equal(product.areaId, "");
  assert.equal(product.estado, "activo", "Un ítem nuevo debe quedar activo.");
  const manualProduct = buildInventoryPayload(
    {...product, codigoSolicitado: "FORZADO-DESDE-FRONTEND"},
    [],
    {allowRequestedCode: false}
  );
  assert.equal(Object.hasOwn(manualProduct, "codigoSolicitado"), false);
  const taxedProduct = buildInventoryPayload({
    tipoItem: "producto", nombre: "Router con IVA", unidad: "unidad", costoBase: "100000",
    margenDeseado: "25", precioManual: "", stock: "4", stockMinimo: "2",
    marca: "Cisco", modelo: "C1111", codigoBarras: "07801234567890",
    areaId: "", categoriaId: "", descripcion: "",
    exentoIva: false,
    proveedorNombre: " Prodalam S.A. ",
    proveedorRut: "937720009",
    fechaCompraReferencia: "2026-08-24",
    numeroFacturaReferencia: " 06897040 ",
  });
  // SPEC 023 §6: el cliente solo envía la marca; Functions calcula la v3.
  assert.equal(taxedProduct.impuestoId, "IVA_GENERAL");
  assert.equal(taxedProduct.precioInterno, 125000);
  assert.equal("formacionPrecioVersion" in taxedProduct, false);
  assert.equal("costoPagado" in taxedProduct, false);
  assert.equal(buildInventoryPayload({...taxedProduct, exentoIva: true}).impuestoId, "IVA_EXENTO");
  assert.equal("impuestoId" in buildInventoryPayload({...taxedProduct, exentoIva: ""}), false, "sin marca rige el valor del negocio");
  assert.ok(validateInventoryDraft({...taxedProduct, exentoIva: "quizás"}).exentoIva);
  assert.equal(taxedProduct.barcode, "07801234567890");
  assert.equal(taxedProduct.stock, 4);
  assert.equal(taxedProduct.proveedorNombre, "Prodalam S.A.");
  assert.equal(taxedProduct.proveedorRut, "93.772.000-9");
  assert.equal(taxedProduct.fechaCompraReferencia, "2026-08-24");
  assert.equal(taxedProduct.numeroFacturaReferencia, "06897040");
  assert.ok(validateInventoryDraft({
    ...taxedProduct,
    fechaCompraReferencia: "2026-02-31",
  }).fechaCompraReferencia);

  // Espejo de la v3 (P1): 125000 con y sin IVA; el exento no suma referencia.
  const v3WithTax = calculateInventoryPriceFormation({
    formacionPrecioVersion: INVENTORY_PRICE_FORMATION_VERSION,
    costoBase: 100000,
    tasaImpuestoCompra: 19,
    margenDeseado: 25,
  });
  assert.deepEqual(
    [v3WithTax.montoImpuestoCompra, v3WithTax.costoPagado, v3WithTax.precioVentaSugerido],
    [19000, 119000, 125000]
  );
  const v3Exempt = calculateInventoryPriceFormation({
    formacionPrecioVersion: INVENTORY_PRICE_FORMATION_VERSION,
    costoBase: 100000,
    tasaImpuestoCompra: 0,
    margenDeseado: 25,
  });
  assert.deepEqual([v3Exempt.costoPagado, v3Exempt.precioVentaSugerido], [100000, 125000]);
  const legacyV2 = calculateInventoryPriceFormation({
    formacionPrecioVersion: LEGACY_PURCHASE_TAX_PRICE_FORMATION_VERSION,
    costoBase: 100000,
    tasaImpuestoCompra: 19,
    margenDeseado: 25,
  });
  assert.equal(legacyV2.precioVentaSugerido, 148750, "un producto v2 se lee con su fórmula (D5)");

  const manualTaxedProduct = buildInventoryPayload({
    ...taxedProduct,
    precioManual: "140000",
  });
  assert.equal(manualTaxedProduct.precioInterno, 140000);
  assert.equal(manualTaxedProduct.precioManual, true);
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
    marca: "No corresponde", modelo: "No corresponde", codigoBarras: "000123",
    stock: "8", stockMinimo: "2",
    proveedorNombre: "No corresponde", proveedorRut: "93.772.000-9",
    fechaCompraReferencia: "2026-08-24", numeroFacturaReferencia: "123",
  });
  assert.equal(service.precioInterno, 30000);
  assert.equal(service.precioManual, true);
  assert.equal("stock" in service, false);
  assert.equal("stockMinimo" in service, false);
  assert.equal("marca" in service, false);
  assert.equal("modelo" in service, false);
  assert.equal("barcode" in service, false);
  assert.equal("proveedorNombre" in service, false);
  assert.equal("proveedorRut" in service, false);
  assert.equal("fechaCompraReferencia" in service, false);
  assert.equal("numeroFacturaReferencia" in service, false);
  assert.equal("formacionPrecioVersion" in service, false);
  assert.equal("tasaImpuestoCompra" in service, false);
  assert.equal("costoPagado" in service, false);
  assert.equal("impuestoId" in service, false);

  const activity = buildInventoryPayload({
    tipoItem: "actividad", nombre: "Levantamiento", unidad: "actividad", costoBase: "0",
    margenDeseado: "0", precioManual: "", areaId: "", categoriaId: "",
  });
  assert.equal("stock" in activity, false);
  assert.equal("stockMinimo" in activity, false);
  assert.equal(Object.keys(validateInventoryDraft({ ...activity, stock: "-1" })).length, 0);
  assert.ok(validateInventoryDraft({ ...product, costoBase: "-1" }).costoBase);
  assert.ok(validateInventoryDraft({ ...product, costoBase: "Infinity" }).costoBase);
  assert.ok(validateInventoryDraft({ ...product, costoBase: "1.2.3" }).costoBase);
  assert.ok(validateInventoryDraft({ ...product, costoBase: "valor inválido" }).costoBase);
  assert.ok(INVENTORY_UNITS.some((unit) => unit.label === "Metro cuadrado (m²)"));

  const legacy = adaptInventoryItem({ nombre: "Legacy", precio: 900, stock: 2 });
  assert.equal(legacy.tipoItem, "producto");
  assert.equal(legacy.costoBase, 900);
  assert.equal(legacy.codigoInterno, "");
  assert.equal(legacy.marca, "");
  assert.equal(legacy.modelo, "");
  assert.equal(legacy.codigoBarras, "");
  assert.equal(legacy.proveedorNombre, "");
  assert.equal(legacy.proveedorRut, "");
  assert.equal(legacy.fechaCompraReferencia, "");
  assert.equal(legacy.numeroFacturaReferencia, "");
  const historicalProduct = adaptInventoryItem({
    tipoItem: "producto",
    nombre: "Producto histórico",
    costoBase: 100000,
    margenDeseado: 25,
    precioInterno: 125000,
  });
  assert.equal(historicalProduct.tasaImpuestoCompra, 0);
  assert.equal(historicalProduct.precioEfectivo, 125000);
  const storedV3Product = adaptInventoryItem({
    tipoItem: "producto", nombre: "Router v3", costoBase: 100000, margenDeseado: 25,
    formacionPrecioVersion: 3, tasaImpuestoCompra: 19, impuestoId: "IVA_GENERAL",
    precioInterno: 125000,
  });
  assert.deepEqual(
    [storedV3Product.costoPagado, storedV3Product.precioCalculado, storedV3Product.precioEfectivo, storedV3Product.exentoIva],
    [119000, 125000, 125000, false]
  );
  const storedV2Product = adaptInventoryItem({
    tipoItem: "producto", nombre: "Router v2", costoBase: 100000, margenDeseado: 25,
    formacionPrecioVersion: 2, tasaImpuestoCompra: 19, precioInterno: 148750,
  });
  assert.equal(storedV2Product.precioEfectivo, 148750, "v2 se muestra como está guardado");
  assert.equal(adaptInventoryItem({tipoItem: "producto", impuestoId: "SIN_IMPUESTO"}).exentoIva, true);
  assert.equal(adaptInventoryItem({tipoItem: "servicio", impuestoId: "IVA_EXENTO"}).exentoIva, false);
  const list = [
    { id: "p", nombre: "ThinkPad", codigoInterno: "NB-001", marca: "Lenovo", modelo: "E13", codigoBarras: "07801234567890", tipoItem: "producto", costoBase: 100, margenDeseado: 20, stock: 1, stockMinimo: 2, estado: "activo" },
    { id: "s", nombre: "Soporte", tipoItem: "servicio", costoBase: 200, margenDeseado: 10, estado: "activo" },
    { id: "a", nombre: "Archivado", tipoItem: "actividad", costoBase: 100, margenDeseado: 10, estado: "inactivo" },
    { id: "z", nombre: "Sin mínimo", tipoItem: "producto", costoBase: 50, margenDeseado: 10, stock: 0, stockMinimo: 0, estado: "activo" },
  ];
  assert.equal(summarizeInventory(list).total, 3);
  assert.equal(summarizeInventory(list).lowStock, 1);
  assert.equal(summarizeInventory(list).inventoryCost, 100);
  ["thinkpad", "lenovo", "e13", "nb-001", "07801234567890"].forEach((query) => {
    assert.deepEqual(filterInventoryItems(list, { query, status: "activo" }).map(({ id }) => id), ["p"]);
  });
  assert.deepEqual(filterInventoryItems(list, { type: "servicio", status: "activo" }).map(({ id }) => id), ["s"]);
  assert.equal(isInventoryLowStock(list[0]), true);
  assert.equal(isInventoryLowStock(list[1]), false);
  assert.equal(isInventoryLowStock(list[3]), false);

  // summarizeInventory(items, { lowStockSettings }): el mínimo por ítem
  // manda si está definido; el umbral general solo decide para ítems sin
  // mínimo propio (mismo criterio que el hint de "Umbral general de stock
  // bajo" en CompanyConfig).
  const generalThreshold = (umbralStockBajo) => ({ alertasStockBajo: true, umbralStockBajo });
  const thresholdCases = [
    { id: "own-min-low", nombre: "Con mínimo propio, bajo", tipoItem: "producto", costoBase: 10, margenDeseado: 10, stock: 1, stockMinimo: 2, estado: "activo" },
    { id: "own-min-ok", nombre: "Con mínimo propio, ok pese al umbral general", tipoItem: "producto", costoBase: 10, margenDeseado: 10, stock: 10, stockMinimo: 2, estado: "activo" },
    { id: "no-min-low-by-threshold", nombre: "Sin mínimo propio, bajo por umbral general", tipoItem: "producto", costoBase: 10, margenDeseado: 10, stock: 3, stockMinimo: 0, estado: "activo" },
    { id: "no-min-ok", nombre: "Sin mínimo propio, sobre el umbral general", tipoItem: "producto", costoBase: 10, margenDeseado: 10, stock: 20, stockMinimo: 0, estado: "activo" },
  ];
  assert.equal(
    summarizeInventory(thresholdCases).lowStock,
    1,
    "sin lowStockSettings, solo el mínimo por ítem cuenta (own-min-low)"
  );
  assert.equal(
    summarizeInventory(thresholdCases, { lowStockSettings: { alertasStockBajo: false, umbralStockBajo: 5 } }).lowStock,
    1,
    "alertasStockBajo desactivado se comporta igual que sin umbral"
  );
  assert.equal(
    summarizeInventory(thresholdCases, { lowStockSettings: generalThreshold(5) }).lowStock,
    2,
    "el umbral general suma ítems sin mínimo propio (no-min-low-by-threshold)"
  );
  assert.equal(
    summarizeInventory(thresholdCases, { lowStockSettings: generalThreshold(20) }).lowStock,
    3,
    "own-min-ok sigue sin contar pese a un umbral general alto: el mínimo por ítem tiene prioridad"
  );

  // Regla única de stock bajo (isLowStockByRule), la misma que usan
  // summarizeInventory, isInventoryLowStock y getInventoryMetrics.
  const rule = (stock, stockMinimo, settings) => isLowStockByRule({ stock, stockMinimo }, settings);
  // Mínimo propio: stock <= mínimo (el igual cuenta).
  assert.equal(rule(1, 2), true, "mínimo propio: bajo el mínimo");
  assert.equal(rule(2, 2), true, "mínimo propio: igual al mínimo cuenta como bajo");
  assert.equal(rule(3, 2), false, "mínimo propio: sobre el mínimo");
  // Umbral general: misma comparación stock <= umbral (el igual cuenta).
  assert.equal(rule(4, 0, generalThreshold(5)), true, "umbral general: bajo el umbral");
  assert.equal(rule(5, 0, generalThreshold(5)), true, "umbral general: igual al umbral cuenta como bajo, igual que el mínimo");
  assert.equal(rule(6, 0, generalThreshold(5)), false, "umbral general: sobre el umbral");
  assert.equal(rule(5, undefined, generalThreshold(5)), true, "stockMinimo ausente usa el umbral general");
  // El mínimo propio manda sobre el umbral general, en ambos sentidos.
  assert.equal(rule(10, 2, generalThreshold(20)), false, "mínimo propio bajo manda sobre un umbral general alto");
  assert.equal(rule(10, 15, generalThreshold(5)), true, "mínimo propio alto manda sobre un umbral general bajo");
  // alertasStockBajo = false apaga solo el umbral general.
  const alertsOff = { alertasStockBajo: false, umbralStockBajo: 5 };
  assert.equal(rule(3, 0, alertsOff), false, "alertas apagadas: sin mínimo propio no hay stock bajo");
  assert.equal(rule(1, 2, alertsOff), true, "alertas apagadas: el mínimo propio sigue vigente");
  // Umbral general 0, settings ausentes o incompletos: solo el mínimo propio.
  assert.equal(rule(0, 0, generalThreshold(0)), false, "umbral general 0 no marca nada");
  assert.equal(rule(3, 0), false, "sin settings no hay umbral general");
  assert.equal(rule(3, 0, {}), false, "settings sin umbral no marcan nada");
  // Mínimo 0 y stock 0: no es bajo por su mínimo (el agotado es otro
  // evento), pero sí por un umbral general activo.
  assert.equal(rule(0, 0), false, "mínimo 0 y stock 0 no es stock bajo por su mínimo");
  assert.equal(rule(0, 0, alertsOff), false, "mínimo 0 y stock 0 con alertas apagadas tampoco");
  assert.equal(rule(0, 0, generalThreshold(5)), true, "mínimo 0 y stock 0 cuenta por el umbral general activo");
  // Stock no numérico: no se puede evaluar.
  assert.equal(rule(undefined, 2), false, "stock ausente no se marca");
  assert.equal(rule("abc", 2, generalThreshold(5)), false, "stock no numérico no se marca");

  // isInventoryLowStock: misma regla, solo para productos activos.
  assert.equal(isInventoryLowStock(thresholdCases[2]), false, "sin settings, el umbral general no aplica en la fila");
  assert.equal(isInventoryLowStock(thresholdCases[2], generalThreshold(5)), true, "la fila ahora respeta el umbral general");
  assert.equal(isInventoryLowStock({ ...thresholdCases[0], tipoItem: "servicio" }, generalThreshold(5)), false, "un servicio nunca tiene stock bajo");
  assert.equal(isInventoryLowStock({ ...thresholdCases[0], estado: "inactivo" }, generalThreshold(5)), false, "un ítem archivado nunca tiene stock bajo");

  // Los tres puntos de uso coinciden sobre la misma lista y configuración.
  for (const settings of [undefined, alertsOff, generalThreshold(5), generalThreshold(20)]) {
    const expected = thresholdCases.filter((item) => isInventoryLowStock(item, settings)).map(({ id }) => id);
    assert.equal(summarizeInventory(thresholdCases, { lowStockSettings: settings }).lowStock, expected.length);
    assert.deepEqual(
      getInventoryMetrics(thresholdCases, { lowStockSettings: settings }).lowStockProducts.map(({ id }) => id),
      expected,
      "getInventoryMetrics usa la misma regla que /inventario"
    );
  }

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
  assert.equal(rows[0].draft.exentoIva, "", "sin columna de exención rige el valor del negocio");

  // SPEC 023 §6.5: columna opcional exento_iva y columna de IVA ignorada.
  const exemptionRows = transformInventorySpreadsheetRows([
    ["tipo", "nombre", "unidad", "costo_base", "exento_iva", "iva", "margen"],
    ["producto", "Libro", "unidad", 10000, "Sí", "", 30],
    ["producto", "Cable", "unidad", 5000, "no", 19, 30],
    ["producto", "Tubo", "unidad", 3000, "", "", 30],
    ["producto", "Dudoso", "unidad", 3000, "quizás", "", 30],
    ["servicio", "Asesoría", "hora", 3000, "sí", "", 30],
  ]);
  assert.deepEqual(exemptionRows.map((row) => row.draft.exentoIva), [true, false, "", "quizás", ""]);
  assert.equal(buildInventoryPayload(exemptionRows[0].draft).impuestoId, "IVA_EXENTO");
  assert.equal(buildInventoryPayload(exemptionRows[1].draft).impuestoId, "IVA_GENERAL");
  assert.equal(buildInventoryPayload(exemptionRows[1].draft).precioInterno, 6500, "el costo de la planilla se toma neto");
  assert.equal("impuestoId" in buildInventoryPayload(exemptionRows[2].draft), false);
  assert.ok(exemptionRows[3].fieldErrors.exentoIva);
  assert.ok(exemptionRows[1].warnings.some((warning) => /columna de IVA se ignora/.test(warning)));
  assert.equal(exemptionRows[0].warnings.some((warning) => /columna de IVA/.test(warning)), false);
  assert.equal(mapInventoryHeaders(["Exento IVA"]).exentoIva, 0);

  const formattedImportRows = transformInventorySpreadsheetRows([
    ["tipo", "nombre", "codigo", "area", "categoria", "unidad", "costo_base", "margen", "precio_manual", "stock", "stock_minimo", "descripcion"],
    ["servicio", "Soporte en terreno", "", "", "", "servicio", "$12.500", "12,5", "", "", "", ""],
  ]);
  assert.equal(Object.keys(formattedImportRows[0].fieldErrors).length, 0);
  const formattedImportPayload = buildInventoryPayload(formattedImportRows[0].draft);
  assert.equal(formattedImportPayload.costoBase, 12500);
  assert.equal(formattedImportPayload.margenDeseado, 12.5);

  const documentRows = transformInventoryDocumentCandidates([
    {
      id: "documento-1",
      tipoItem: "producto",
      nombre: "Switch",
      sku: "SW-02",
      marca: "Cisco",
      modelo: "CBS110",
      codigoBarras: "780000000001",
      tasaImpuestoCompra: 19,
      costoBase: 45000,
      margenDeseado: 20,
      stock: 3,
      stockMinimo: 1,
      descripcion: "Detectado desde factura",
      revisionRequerida: true,
      advertencias: ["Revisar precio unitario."],
    },
    {
      id: "documento-2",
      tipoItem: "producto",
      nombre: "Router de prueba",
      codigoProveedor: "PROV-7788",
      costoBase: 18000,
      margenDeseado: 25,
      cantidadOrigen: 2,
      revisionRequerida: false,
      advertencias: ["Revisar IVA.", " revisar iva. "],
    },
  ], { areas, categories, existingItems: [{ nombre: "Switch" }] });
  assert.equal(documentRows[0].sourceKind, "document");
  assert.equal(documentRows[0].included, false);
  assert.equal(documentRows[0].draft.codigoSolicitado, "SW-02");
  assert.equal(documentRows[0].draft.marca, "Cisco");
  assert.equal(documentRows[0].draft.modelo, "CBS110");
  // SPEC 023 §6.5: la tasa detectada no decide la formación; costo neto.
  assert.equal("formacionPrecioVersion" in documentRows[0].draft, false);
  assert.equal("tasaImpuestoCompra" in documentRows[0].draft, false);
  assert.equal(documentRows[0].draft.exentoIva, "");
  assert.ok(documentRows[0].warnings.some((warning) => warning.includes("precio")));
  assert.equal(documentRows[1].included, true);
  assert.equal(documentRows[1].sourceCode, "PROV-7788");
  assert.equal(documentRows[1].draft.codigoSolicitado, "");
  assert.equal(documentRows[1].warnings.length, 1);
  assert.equal(getInventoryImportSummary(documentRows).review, 1);
  assert.equal(getInventoryImportSummary(documentRows).excluded, 1);
  assert.equal(getInventoryImportSummary(documentRows).importable, 1);
  const exemptDocumentRows = markInventoryImportRowsExempt(documentRows, {areas, categories});
  assert.equal(exemptDocumentRows[0].draft.exentoIva, "", "las filas excluidas no se marcan");
  assert.equal(exemptDocumentRows[1].draft.exentoIva, true);
  assert.equal(buildInventoryPayload(exemptDocumentRows[1].draft).impuestoId, "IVA_EXENTO");

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
    "exento_iva", "margen", "precio_manual", "stock", "stock_minimo", "descripcion",
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
  const manager = await readFile(new URL("../src/features/inventory/InventoryManager.jsx", import.meta.url), "utf8");
  const importer = await readFile(new URL("../src/features/inventory/InventoryImportDialog.jsx", import.meta.url), "utf8");
  const importService = await readFile(new URL("../src/services/inventoryImportService.js", import.meta.url), "utf8");
  assert.doesNotMatch(page, /InventoryAiImporter|Gemini|normalizeInventoryDocument|normalizeInventoryItems/);
  assert.match(importer, /SPREADSHEET_EXTENSION = \/\\\.\(csv\|xls\|xlsx\)\$\/i/);
  assert.match(importer, /SPREADSHEET_ACCEPT = "\.csv,\.xls,\.xlsx"/);
  assert.match(importer, /Carga el catálogo maestro desde una planilla Excel o CSV/);
  assert.match(importer, /CSV, XLS o XLSX/);
  assert.match(importer, /readLocalInventoryWorkbook/);
  assert.match(importer, /procesamiento local sin IA/);
  assert.doesNotMatch(importer, /normalizeInventoryDocumentWithAi|useAiRateLimit|Gemini/);
  assert.doesNotMatch(importer, /application\/pdf|image\/(?:jpeg|png|webp)|\.pdf|\.jpe?g|\.png|\.webp/i);
  assert.match(importService, /confirmManagedInventoryImport/);
  assert.match(importer, /Nada se guarda hasta confirmar la importación/);
  assert.match(importer, /Reintentar importación/);
  assert.match(importer, /No vuelvas a importar el archivo completo con una solicitud nueva/);
  assert.match(importer, /toggleRow\(row\.rowId, event\.target\.checked\)/);
  assert.match(importer, /requestIdBaseRef\.current = createInventoryImportRequestIdBase\(\)/);
  assert.match(importer, /requestIdBaseRef\.current = ""/);
  assert.match(importer, /Importar \$\{summary\.importable\}/);
  assert.match(importer, /savingInFlightRef\.current/);
  assert.match(importer, /Subir archivo/);
  assert.match(importer, /Revisar/);
  assert.match(importer, /Importando inventario/);
  assert.match(importer, /Marcar como exentos/);
  assert.match(importer, /<ImportField label="Exento de IVA"/);
  assert.doesNotMatch(importer, /IVA compra %/);
  // Smoke 21 (SPEC 023 §12.2): formulario y ficha con costo neto y exención.
  assert.match(manager, /"Costo neto \(sin IVA\)"/);
  assert.match(manager, /"Costo \(exento de IVA\)"/);
  assert.match(manager, /<span>Exento de IVA<\/span>/);
  assert.match(manager, /label="Costo con IVA \(referencia\)"/);
  assert.match(manager, /"Exento: no lleva IVA"/);
  assert.match(manager, /<Detail label="Costo neto"/);
  assert.match(manager, /<Detail label="Costo promedio neto"/);
  assert.match(manager, /<Detail label="Último costo neto"/);
  assert.match(manager, /disabled=\{exemptionLocked\}/);
  assert.match(manager, /Al guardar se recalcula sobre el costo neto/);
  assert.doesNotMatch(manager, /label="IVA de compra"|Tasa personalizada|label="Costo pagado"|Costo base \/ manual/);
  assert.match(importer, /Eliminar fila/);
  assert.doesNotMatch(manager, /Hikvision|Prodalam|06897040|93\.772\.000-9/);
  assert.match(manager, /Origen de compra/);
  assert.match(manager, /draft\.tipoItem === "producto" && <section className="inventory-form-section"><h3>Origen de compra/);
  assert.match(manager, /type="date" value=\{draft\.fechaCompraReferencia\}/);
  assert.match(manager, /<BarcodeInput actionLabel="Escanear"/);
  assert.match(manager, /value=\{editingItem \? draft\.codigoInterno : "Se asignará automáticamente"\}/);
  assert.match(manager, /readOnly aria-readonly="true"/);
  assert.match(manager, /allowRequestedCode: false/);
}

main();
await retryChecks();
await sourceChecks();
console.log("INVENTORY_MVP_SMOKE_OK");
