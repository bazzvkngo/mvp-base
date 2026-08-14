import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {
  adaptStoredSale,
  buildSaleMutationPayload,
  calculateSaleLine,
  calculateSaleTotals,
  canManageSales,
  getSaleDocumentTypeLabel,
  getSaleItemTypeLabel,
  getSaleStatusLabel,
  matchesSaleSearch,
  SALE_STATUSES,
  shouldReconcileSaleConfirmation,
} from "../src/domain/saleModel.mjs";

const require = createRequire(import.meta.url);
const {normalizeSaleInput} = require("../functions/salePersistence.js");
class TestHttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const line = (overrides = {}) => ({lineaId: "linea-1", itemId: "item-1", cantidad: 2, precioUnitario: 1000, descuentoPct: 10, ...overrides});

assert.deepEqual(calculateSaleLine(line()), {cantidad: 2, precioUnitario: 1000, descuentoPct: 10, subtotalLinea: 2000, descuentoLinea: 200, totalLinea: 1800});
assert.deepEqual(calculateSaleTotals([line(), line({lineaId: "linea-2", itemId: "item-2", cantidad: 1, precioUnitario: 500, descuentoPct: 0})]), {subtotal: 2500, descuentoItems: 200, descuento: 0, descuentoTotal: 200, neto: 2300, afectaIva: true, tasaIva: 0.19, iva: 437, total: 2737});
assert.deepEqual(calculateSaleTotals([line()], 300, {afectaIva: true}), {subtotal: 2000, descuentoItems: 200, descuento: 300, descuentoTotal: 500, neto: 1500, afectaIva: true, tasaIva: 0.19, iva: 285, total: 1785});
assert.deepEqual(calculateSaleTotals([line()], 300, {afectaIva: false}), {subtotal: 2000, descuentoItems: 200, descuento: 300, descuentoTotal: 500, neto: 1500, afectaIva: false, tasaIva: 0, iva: 0, total: 1500});
assert.throws(() => calculateSaleTotals([line()], 1801), /descuento general no puede superar/);
assert.throws(() => calculateSaleTotals([line()], Infinity), /número válido/);
assert.throws(() => calculateSaleLine(line({cantidad: 0})), /rango/);
assert.throws(() => calculateSaleLine(line({cantidad: NaN})), /número/);
assert.throws(() => calculateSaleLine(line({cantidad: Infinity})), /número/);
assert.throws(() => calculateSaleLine(line({precioUnitario: Number.MAX_VALUE})), /máximo permitido/);
assert.throws(() => calculateSaleLine(line({cantidad: Number.MAX_VALUE, precioUnitario: 2})), /máximo permitido/);
assert.throws(() => calculateSaleTotals([line({cantidad: 1, precioUnitario: Number.MAX_SAFE_INTEGER})]), /máximo permitido/);
console.log("OK ventas modelo: líneas, descuentos, IVA, totales y overflow");

const sale = (count) => ({clienteId: "client-1", fechaVenta: "2026-08-07", items: Array.from({length: count}, (_, index) => line({lineaId: `linea-${index + 1}`, itemId: `item-${index + 1}`}))});
const payload = buildSaleMutationPayload({...sale(1), numero: "VTA-FAKE", estado: "confirmada", clienteSnapshot: {nombreRazonSocial: "Falso"}, stockAplicado: true, total: 1});
assert.deepEqual(payload.items[0], {lineaId: "linea-1", itemId: "item-1", cantidad: 2, precioUnitario: 1000, descuentoPct: 10});
assert.equal(payload.descuento, 0);
assert.equal(payload.afectaIva, true);
const exemptPayload = buildSaleMutationPayload({...sale(1), descuento: 300, afectaIva: false});
assert.equal(exemptPayload.descuento, 300);
assert.equal(exemptPayload.afectaIva, false);
for (const forbidden of ["numero", "estado", "clienteSnapshot", "stockAplicado", "total"]) assert.equal(Object.hasOwn(payload, forbidden), false);
assert.equal(buildSaleMutationPayload(sale(200)).items.length, 200);
assert.throws(() => buildSaleMutationPayload(sale(201)), /La venta admite hasta 200 ítems/);
assert.equal(normalizeSaleInput(sale(200), TestHttpsError).items.length, 200);
assert.equal(normalizeSaleInput(sale(1), TestHttpsError).descuento, 0);
assert.equal(normalizeSaleInput(sale(1), TestHttpsError).afectaIva, true);
assert.throws(() => normalizeSaleInput(sale(201), TestHttpsError), /La venta admite hasta 200 ítems/);
console.log("OK ventas modelo: payload mínimo y máximo de 200 líneas en frontend/backend");

const stored = adaptStoredSale({ventaId: "sale-1", numero: "VTA-2026-0001", estado: "confirmada", clienteId: "client-1", clienteSnapshot: {clienteId: "client-1", nombreRazonSocial: "Cliente Uno", rut: "76.000.000-0"}, cotizacionId: "quote-1", cotizacionNumero: "COT-2026-0001", tipoDocumento: "factura", numeroDocumento: "F-100", items: [{...line(), nombre: "Producto", tipoItem: "producto", unidad: "unidad"}]});
assert.equal(stored.id, "sale-1"); assert.equal(stored.total, 2142); assert.equal(stored.clienteSnapshot.nombreRazonSocial, "Cliente Uno");
assert.equal(matchesSaleSearch(stored, "COT-2026-0001"), true); assert.equal(matchesSaleSearch(stored, "76.000.000-0"), true); assert.equal(matchesSaleSearch(stored, "nada"), false);
assert.equal(canManageSales("OWNER"), true); assert.equal(canManageSales("ADMIN"), true); assert.equal(canManageSales("MEMBER"), false);
assert.deepEqual(SALE_STATUSES, ["borrador", "confirmada", "cancelada"]);
assert.equal(getSaleStatusLabel("borrador"), "Preparada");
assert.equal(getSaleStatusLabel("confirmada"), "Confirmada");
assert.equal(getSaleItemTypeLabel("servicio"), "Servicio");
assert.equal(getSaleDocumentTypeLabel("sin_documento"), "Sin documento");
assert.equal(shouldReconcileSaleConfirmation({code: "functions/unavailable"}), true);
assert.equal(shouldReconcileSaleConfirmation({code: "deadline-exceeded"}), true);
assert.equal(shouldReconcileSaleConfirmation(new Error("respuesta ambigua")), true);
assert.equal(shouldReconcileSaleConfirmation({code: "functions/failed-precondition"}), false);
console.log("OK ventas modelo: adaptación, estados, búsqueda y roles");

const backend = fs.readFileSync(new URL("../functions/salePersistence.js", import.meta.url), "utf8");
const salePage = fs.readFileSync(new URL("../src/pages/NewSalePage.jsx", import.meta.url), "utf8");
const salesHistory = fs.readFileSync(new URL("../src/pages/SalesPage.jsx", import.meta.url), "utf8");
const saleSummary = fs.readFileSync(new URL("../src/features/sales/SaleSummaryPanel.jsx", import.meta.url), "utf8");
const saleClient = fs.readFileSync(new URL("../src/features/sales/SaleClientSelector.jsx", import.meta.url), "utf8");
const saleItems = fs.readFileSync(new URL("../src/features/sales/SaleItemsEditor.jsx", import.meta.url), "utf8");
const salePrint = fs.readFileSync(new URL("../src/features/sales/SalePrintView.jsx", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
for (const token of ["saleCreateRequests", "saleConfirmRequests", "quoteSaleConversionRequests", "movimientosInventario", "salida_venta", "stockAplicado"]) assert.match(backend, new RegExp(token));
for (const name of ["ventas", "saleCounters", "saleCreateRequests", "saleConfirmRequests", "quoteSaleConversionRequests"]) assert.match(rules, new RegExp(`match /${name}/`));
assert.match(salePage, /pendingConfirmationSaleId/);
assert.match(salePage, /obtenerVenta\(businessId, stored\.id\)/);
assert.match(salePage, /authoritative\?\.estado === "confirmada" \|\| authoritative\?\.stockAplicado === true/);
assert.doesNotMatch(salePage, /globalThis\.confirm|window\.confirm/);
assert.doesNotMatch(salesHistory, /globalThis\.confirm|window\.confirm/);
assert.match(salePage, /ResponsiveDialog/);
assert.match(salesHistory, /ResponsiveDialog/);
assert.match(salesHistory, /`\/ventas\/\$\{sale\.id\}\/editar`/);
assert.match(salesHistory, /`\/cotizaciones\/\$\{sale\.cotizacionId\}\/editar`/);
assert.doesNotMatch(salesHistory, />Editar<|>Ver</);
assert.doesNotMatch(salesHistory, /confirmarVenta|Confirmar venta|<th>Fecha<\/th>/);
assert.match(salesHistory, /formatDate\(sale\.fechaVenta\)/);
assert.match(salesHistory, /Ellipsis/);
assert.match(saleSummary, /Guardar cambios/);
assert.match(saleSummary, /Ellipsis/);
assert.match(saleSummary, /No puedes confirmar esta venta porque uno o más productos no tienen stock suficiente/);
assert.match(salePage, /sale-context-card/);
assert.match(saleClient, /sale-context-client__snapshot/);
assert.match(saleItems, /Stock insuficiente/);
assert.match(saleItems, /Disponible: \{stock\} · Solicitado: \{requested\}/);
assert.match(salePrint, /getSaleStatusLabel/);
assert.match(salePrint, /CubeIcon/);
assert.match(salePrint, /sale-document-preview__header/);
assert.match(salePrint, /sale-document-preview__info-grid/);
assert.match(salePage, /Editar condiciones/);
assert.match(salePage, /previewOpen \&\& <div className="sale-preview-body">/);
assert.match(salePage, /Ver vista previa/);
assert.doesNotMatch(salePage, />Ver cotización</);
console.log("OK ventas modelo: defensas backend y reglas declaradas");
console.log("Smoke del modelo de Ventas completado.");
