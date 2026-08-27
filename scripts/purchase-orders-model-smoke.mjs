import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {
  adaptStoredPurchaseOrder,
  buildPurchaseOrderMutationPayload,
  calculatePurchaseOrderLine,
  calculatePurchaseOrderTotals,
  canManagePurchaseOrders,
  matchesPurchaseOrderSearch,
  resolvePurchaseOrderProviderPreview,
} from "../src/domain/purchaseOrderModel.mjs";
import {buildPurchaseOrderPdfDocument} from "../src/domain/purchaseOrderDocument.mjs";

const require = createRequire(import.meta.url);
const {historicalPurchaseOrderCopyInput} = require(
  "../functions/purchaseOrderPersistence.js"
);

const item = (overrides = {}) => ({
  lineaId: "linea-1",
  itemId: "item-1",
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  ...overrides,
});

const companySnapshot = {
  nombreComercial: "Valora Ingeniería",
  razonSocial: "Valora Ingeniería SpA",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: "77.091.679-8",
  giro: "Servicios de ingeniería",
  direccion: "Avenida Industrial 2450",
  ciudad: "Iquique",
  region: "Tarapacá",
  responsable: "María Soto",
  telefono: "+56 9 5555 1212",
  email: "compras@valora.test",
};

const providerSnapshot = {
  proveedorId: "provider-document",
  razonSocial: "Suministros del Norte SpA",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: "76.345.678-9",
  personaContacto: "Carlos Muñoz",
  email: "ventas@suministros.test",
  telefono: "+56 9 4444 2323",
  direccion: "Ruta A-16 1800",
  comunaNombre: "Alto Hospicio",
  regionNombre: "Tarapacá",
  condicionesPago: "Transferencia a 30 días",
  diasCredito: 30,
};

const documentItem = (index, overrides = {}) => ({
  lineaId: `linea-documento-${index}`,
  itemId: `item-documento-${index}`,
  codigo: `PROD-${String(index).padStart(4, "0")}`,
  nombre: `Producto industrial ${index}`,
  descripcion: "Suministro según especificación técnica acordada.",
  tipoItem: "producto",
  unidad: "unidad",
  cantidad: 2,
  costoUnitario: 45000,
  descuentoPct: 0,
  ...overrides,
});

const orderFixture = (overrides = {}) => ({
  id: "order-document",
  numero: "OC-2026-0142",
  estado: "emitida",
  fechaEmision: "2026-08-27",
  fechaEntregaEstimada: "2026-09-05",
  direccionEntrega: "Bodega central, Avenida Industrial 2450, Iquique",
  condicionesPago: "Transferencia a 30 días",
  observaciones: "Coordinar horario de descarga con el área de operaciones.",
  moneda: "CLP",
  locale: "es-CL",
  impuestoNombre: "IVA",
  tasaIva: 0.19,
  empresaSnapshot: companySnapshot,
  proveedorId: providerSnapshot.proveedorId,
  proveedorSnapshot: providerSnapshot,
  items: [documentItem(1)],
  ...overrides,
});

assert.deepEqual(calculatePurchaseOrderLine(item()), {
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  subtotalLinea: 2000,
  descuentoLinea: 200,
  totalLinea: 1800,
});
assert.deepEqual(calculatePurchaseOrderTotals([
  item(),
  item({lineaId: "linea-2", itemId: "item-2", cantidad: 1, costoUnitario: 500, descuentoPct: 0}),
]), {subtotal: 2500, descuentoTotal: 200, neto: 2300, iva: 437, total: 2737});
assert.throws(() => calculatePurchaseOrderLine(item({cantidad: 0})), /entre|mayor/);
assert.throws(() => calculatePurchaseOrderLine(item({cantidad: Infinity})), /numérico|número/);
assert.throws(() => calculatePurchaseOrderLine(item({cantidad: NaN})), /numérico|número/);
assert.throws(() => calculatePurchaseOrderLine(item({costoUnitario: -1})), /entre|mayor/);
assert.throws(() => calculatePurchaseOrderLine(item({descuentoPct: 101})), /superar|entre/);
assert.throws(
  () => calculatePurchaseOrderLine(item({costoUnitario: Number.MAX_VALUE})),
  /El monto de la orden supera el máximo permitido\./
);
assert.throws(
  () => calculatePurchaseOrderLine(item({cantidad: Number.MAX_VALUE, costoUnitario: 1})),
  /El monto de la orden supera el máximo permitido\./
);
assert.throws(
  () => calculatePurchaseOrderLine(item({cantidad: 2, costoUnitario: Number.MAX_VALUE})),
  /El monto de la orden supera el máximo permitido\./
);
assert.throws(
  () => calculatePurchaseOrderTotals([item({cantidad: 1, costoUnitario: Number.MAX_SAFE_INTEGER, descuentoPct: 0})]),
  /El monto de la orden supera el máximo permitido\./
);
console.log("OK modelo: cantidades, costos, descuentos, IVA y totales");

const historicalProviderA = {
  proveedorId: "provider-a",
  estado: "activo",
  razonSocial: "Proveedor A histórico",
};
const liveProviderA = {
  proveedorId: "provider-a",
  estado: "activo",
  razonSocial: "Proveedor A vivo modificado",
};
const liveProviderB = {
  proveedorId: "provider-b",
  estado: "activo",
  razonSocial: "Proveedor B actual",
};
const orderWithProviderA = {
  proveedorId: "provider-a",
  proveedorSnapshot: historicalProviderA,
};
assert.strictEqual(
  resolvePurchaseOrderProviderPreview(
    orderWithProviderA,
    "provider-a",
    [liveProviderA, liveProviderB]
  ),
  historicalProviderA
);
assert.strictEqual(
  resolvePurchaseOrderProviderPreview(
    orderWithProviderA,
    "provider-b",
    [liveProviderA, liveProviderB]
  ),
  liveProviderB
);
assert.strictEqual(
  resolvePurchaseOrderProviderPreview(
    orderWithProviderA,
    "provider-a",
    [liveProviderA, liveProviderB]
  ),
  historicalProviderA
);
console.log("OK preview proveedor: A→A histórico, A→B vivo y A→B→A histórico");

const mutation = buildPurchaseOrderMutationPayload({
  proveedorId: "proveedor-1",
  items: [{
    ...item(),
    nombre: "Nombre manipulado",
    codigo: "FAKE",
    inventarioSnapshot: {nombre: "Snapshot manipulado"},
    totalLinea: 1,
  }],
  proveedorSnapshot: {razonSocial: "Proveedor manipulado"},
  numero: "OC-FAKE",
  estado: "emitida",
  total: 1,
});
assert.deepEqual(Object.keys(mutation.items[0]).sort(), [
  "cantidad", "costoUnitario", "descuentoPct", "itemId", "lineaId",
].sort());
assert.equal("proveedorSnapshot" in mutation, false);
assert.equal("numero" in mutation, false);
assert.equal("estado" in mutation, false);
assert.equal("total" in mutation, false);
console.log("OK contrato: frontend solo envía IDs y valores editables");

const stored = adaptStoredPurchaseOrder({
  id: "oc-legacy",
  numeroOrdenCompra: "OC-2025-0002",
  proveedorNombre: "Proveedor histórico",
  proveedorRut: "12.345.678-5",
  estado: "emitida",
  items: [{
    inventarioId: "legacy-1",
    nombre: "Ítem legacy",
    tipo: "servicio",
    cantidad: 1,
    costo: 10000,
  }],
});
assert.equal(stored.ordenCompraId, "oc-legacy");
assert.equal(stored.numero, "OC-2025-0002");
assert.equal(stored.proveedorSnapshot.razonSocial, "Proveedor histórico");
assert.equal(stored.items[0].tipoItem, "servicio");
assert.equal(stored.total, 11900);
assert.equal("purchaseOrderId" in stored, false);
assert.equal(matchesPurchaseOrderSearch(stored, "historico"), true);
assert.equal(canManagePurchaseOrders("ADMIN"), true);
assert.equal(canManagePurchaseOrders("COMPRAS"), true);
assert.equal(canManagePurchaseOrders("VENTAS"), false);
assert.equal(canManagePurchaseOrders("MEMBER"), false);
console.log("OK compatibilidad: adapter legacy y roles");

const copyInput = historicalPurchaseOrderCopyInput({
  ...stored,
  id: "orden-original",
  ordenCompraId: "orden-original",
  numero: "OC-2026-0001",
  estado: "cancelada",
  proveedorId: "proveedor-1",
  total: 1,
  items: [{
    lineaId: "linea-copy",
    itemId: "item-copy",
    cantidad: 3,
    costoUnitario: 12500,
    descuentoPct: 5,
    inventarioSnapshot: {nombre: "Histórico"},
  }],
});
assert.equal(copyInput.proveedorId, "proveedor-1");
assert.deepEqual(copyInput.items[0], {
  lineaId: "linea-copy",
  itemId: "item-copy",
  cantidad: 3,
  costoUnitario: 12500,
  descuentoPct: 5,
});
assert.equal("id" in copyInput, false);
assert.equal("numero" in copyInput, false);
assert.equal("estado" in copyInput, false);
assert.equal("total" in copyInput, false);
console.log("OK duplicación: copia datos editables sin autoridad histórica");

const backendSource = fs.readFileSync("functions/purchaseOrderPersistence.js", "utf8");
const rulesSource = fs.readFileSync("firestore.rules", "utf8");
const pageSource = fs.readFileSync("src/pages/NewPurchaseOrderPage.jsx", "utf8");
const providerSelectorSource = fs.readFileSync(
  "src/features/purchaseOrders/ProviderSelector.jsx",
  "utf8"
);
const historySource = fs.readFileSync("src/pages/PurchaseOrdersPage.jsx", "utf8");
const printViewSource = fs.readFileSync("src/features/purchaseOrders/PurchaseOrderPrintView.jsx", "utf8");
const documentSource = fs.readFileSync("src/domain/purchaseOrderDocument.mjs", "utf8");
const pdfSource = fs.readFileSync("src/utils/purchaseOrderPdf.js", "utf8");
const purchaseOrderCssSource = fs.readFileSync(
  "src/features/purchaseOrders/purchase-orders.css",
  "utf8"
);
assert.match(backendSource, /transaction\.getAll/);
assert.match(backendSource, /purchaseOrderCreateRequests/);
assert.match(backendSource, /purchaseOrderDuplicateRequests/);
assert.match(backendSource, /ordenCompraOrigenId/);
assert.match(backendSource, /purchaseOrderCounters/);
assert.match(backendSource, /providerSnapshotFromDocument/);
assert.match(backendSource, /inventorySnapshotFromDocument/);
assert.match(rulesSource, /match \/ordenesCompra\/\{ordenCompraId\}/);
assert.match(rulesSource, /allow create, update, delete: if false/);
assert.match(pageSource, /PurchaseOrderPrintView/);
assert.doesNotMatch(pageSource, /Quote[A-Z]/);
assert.match(pageSource, /navigate\("\/ordenes-compra", \{[\s\S]*createdOrder: saved[\s\S]*openOrderId: saved\.id/);
assert.match(providerSelectorSource, /isHistorical \? originalSnapshot : selected/);
assert.match(historySource, /po-history__cards/);
assert.match(historySource, /<OrderActions/);
assert.match(historySource, /Duplicar como pendiente/);
assert.match(historySource, /PurchaseOrderPreviewBoundary/);
assert.match(historySource, /className="po-order-preview-dialog"/);
assert.match(historySource, /PurchaseOrderPrintView company=\{company\} order=\{selectedOrder\}/);
assert.match(historySource, /Correo<\/Button>[\s\S]*WhatsApp<\/Button>[\s\S]*Descargar PDF<\/Button>[\s\S]*Imprimir<\/Button>/);
assert.match(historySource, /onClick=\{\(\) => setSelectedOrder\(null\)\}>Volver al listado/);
assert.match(historySource, /createdOrder\?\.negocioId === businessId/);
assert.match(printViewSource, /Orden de compra/);
assert.match(printViewSource, /proveedorSnapshot/);
assert.match(printViewSource, /items\.map/);
assert.match(printViewSource, /order\.neto/);
assert.match(printViewSource, /order\.iva/);
assert.match(printViewSource, /order\.total/);
assert.match(printViewSource, /showCode/);
assert.match(printViewSource, /showUnit/);
assert.match(printViewSource, /showDiscount/);
assert.match(printViewSource, /Condiciones de pago/);
assert.doesNotMatch(printViewSource, /19%/);
assert.doesNotMatch(printViewSource, /getDoc|getDocs|onSnapshot|listarProveedores/);
assert.match(documentSource, /ORDEN DE COMPRA/);
assert.match(documentSource, /showCode/);
assert.match(documentSource, /showUnit/);
assert.match(documentSource, /showDiscount/);
assert.match(documentSource, /taxLabel\(order\)/);
assert.doesNotMatch(documentSource, /19%/);
assert.match(pdfSource, /buildPurchaseOrderPdfBase64/);
assert.match(pdfSource, /sharePurchaseOrderWhatsApp/);
assert.match(purchaseOrderCssSource, /@media\(max-width:767px\)/);
assert.match(purchaseOrderCssSource, /size:\s*A4/);
assert.match(purchaseOrderCssSource, /po-order-preview-dialog/);
assert.match(purchaseOrderCssSource, /po-history__recent/);
assert.doesNotMatch(purchaseOrderCssSource, /po-history__table\{min-width:800px\}/);
console.log("OK documento: snapshots, columnas condicionales, impuesto dinámico y acciones externas");

const outputDir = path.resolve("output/pdf/purchase-order-validation");
fs.mkdirSync(outputDir, {recursive: true});
const logoPath = path.resolve("tmp/pdfs/reference/bagner-logo.png");
const logoDataUrl = fs.existsSync(logoPath)
  ? `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`
  : "";

const scenarios = [
  ["01-short", orderFixture()],
  [
    "02-mixed-items-discount",
    orderFixture({
      items: [
        documentItem(1, {cantidad: 4, costoUnitario: 125000, descuentoPct: 8}),
        documentItem(2, {
          codigo: "SRV-0002",
          nombre: "Instalación y puesta en marcha",
          tipoItem: "servicio",
          unidad: "servicio",
          cantidad: 1,
          costoUnitario: 180000,
        }),
        ...Array.from({length: 7}, (_, index) =>
          documentItem(index + 3, {costoUnitario: 35000 + index * 7500})
        ),
      ],
    }),
  ],
  [
    "03-multipage",
    orderFixture({
      items: Array.from({length: 60}, (_, index) =>
        documentItem(index + 1, {
          descripcion: `Componente ${index + 1} con embalaje, control de calidad y entrega documentada.`,
          costoUnitario: 10000 + index * 500,
        })
      ),
    }),
  ],
  [
    "04-empty-optionals",
    orderFixture({
      fechaEntregaEstimada: "",
      direccionEntrega: "",
      condicionesPago: "",
      observaciones: "",
      proveedorSnapshot: {...providerSnapshot, condicionesPago: "", diasCredito: 0},
    }),
  ],
  [
    "05-multicurrency-tax-snapshot",
    orderFixture({
      moneda: "USD",
      locale: "es-PE",
      impuestoNombre: "IGV",
      tasaIva: 0.18,
      items: [documentItem(1, {cantidad: 3, costoUnitario: 1250, descuentoPct: 5})],
    }),
  ],
];

for (const [name, order] of scenarios) {
  const result = buildPurchaseOrderPdfDocument({order, logoDataUrl});
  const file = path.join(outputDir, `${name}.pdf`);
  fs.writeFileSync(file, Buffer.from(result.doc.output("arraybuffer")));
  assert.equal(result.order.proveedorSnapshot.razonSocial, providerSnapshot.razonSocial);
  assert.equal(result.order.empresaSnapshot.razonSocial, companySnapshot.razonSocial);
  if (name === "03-multipage") assert.ok(result.doc.getNumberOfPages() >= 2);
  console.log(`PDF_VALIDATION ${name} pages=${result.doc.getNumberOfPages()} file=${file}`);
}

console.log("PURCHASE_ORDERS_MODEL_SMOKE_OK");
