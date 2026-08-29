import assert from "node:assert/strict";
import fs from "node:fs";
import {
  adaptStoredReception,
  buildReceptionMutationPayload,
  getOrderReceptionStatus,
  getOrderReceptionStatusLabel,
  getReceptionConfirmationImpact,
  getReceptionPurchaseAction,
  getReceptionStatusLabel,
  getSupplierResponseLabel,
  shouldReconcileReceptionConfirmation,
} from "../src/domain/receptionModel.mjs";
import {buildSupplyTrace, getSupplyDocumentRoute} from "../src/domain/supplyTrace.mjs";

const reception = adaptStoredReception({
  id: "rec-1",
  numero: "REC-2026-0001",
  estado: "confirmada",
  ordenCompraId: "oc-1",
  items: [{lineaId: "l1", itemId: "p1", cantidadSolicitada: 10, cantidad: 4}],
});
assert.equal(reception.recepcionId, "rec-1");
assert.equal(getReceptionStatusLabel("confirmada"), "Recibida");
assert.equal(getReceptionStatusLabel("borrador"), "Preparada");
assert.equal(getOrderReceptionStatusLabel("sin_recepcion"), "Recepción pendiente");
assert.equal(getOrderReceptionStatusLabel("recibida_parcial"), "Recepción parcial");
assert.equal(getOrderReceptionStatusLabel("recibida_total"), "Recepción completada");
assert.equal(getSupplierResponseLabel("pendiente"), "Pendiente");
assert.equal(getSupplierResponseLabel("confirmada_con_observaciones"), "Con observaciones");
assert.deepEqual(getReceptionConfirmationImpact([
  {tipoItem: "producto", cantidad: 2, costoUnitario: 1000, descuentoPct: 10},
  {tipoItem: "servicio", cantidad: 1, costoUnitario: 500, descuentoPct: 0},
  {tipoItem: "actividad", cantidad: 0, costoUnitario: 900, descuentoPct: 0},
], 0.19), {productos: 1, servicios: 1, actividades: 0, totalItems: 2, totalCompraEstimado: 2737});

const order = {id: "oc-1", items: [{lineaId: "l1", cantidad: 10}]};
assert.equal(getOrderReceptionStatus(order, [reception]), "recibida_parcial");
assert.equal(getOrderReceptionStatus(order, [
  reception,
  adaptStoredReception({estado: "confirmada", ordenCompraId: "oc-1", items: [{lineaId: "l1", cantidad: 6}]}),
]), "recibida_total");
assert.equal(getOrderReceptionStatus(order, [
  adaptStoredReception({estado: "borrador", ordenCompraId: "oc-1", items: [{lineaId: "l1", cantidad: 10}]}),
]), "sin_recepcion");

const traceShape = (trace) => trace.map((row) => row.map((node) => `${node.type}:${node.id || "pending"}`));
const assertCurrentDocument = (trace, type, id) => {
  const current = trace.flat().filter((node) => node.current && node.type === type && node.id === id);
  assert.ok(current.length >= 1, `El documento actual ${type}:${id} debe aparecer marcado`);
};

const directPurchaseTrace = buildSupplyTrace({
  currentType: "purchase",
  purchase: {id: "com-directa", numero: "COM-2026-0001"},
});
assert.deepEqual(traceShape(directPurchaseTrace), [["purchase:com-directa"]]);
assertCurrentDocument(directPurchaseTrace, "purchase", "com-directa");

const legacyOrderPurchaseTrace = buildSupplyTrace({
  currentType: "purchase",
  purchase: {id: "com-oc", numero: "COM-2026-0002", ordenCompraId: "oc-legacy", ordenCompraNumero: "OC-2025-0042"},
});
assert.deepEqual(traceShape(legacyOrderPurchaseTrace), [["order:oc-legacy", "purchase:com-oc"]]);
assertCurrentDocument(legacyOrderPurchaseTrace, "purchase", "com-oc");

const legacyReceptionPurchaseTrace = buildSupplyTrace({
  currentType: "purchase",
  purchase: {id: "com-rec", numero: "COM-2026-0003", recepcionId: "rec-legacy", recepcionNumero: "REC-2025-0017"},
});
assert.deepEqual(traceShape(legacyReceptionPurchaseTrace), [["reception:rec-legacy", "purchase:com-rec"]]);
assertCurrentDocument(legacyReceptionPurchaseTrace, "purchase", "com-rec");

const modernPurchaseTrace = buildSupplyTrace({
  currentType: "purchase",
  purchase: {
    id: "com-moderna", numero: "COM-2026-0004",
    ordenCompraId: "oc-moderna", ordenCompraNumero: "OC-2026-0009",
    recepcionId: "rec-moderna", recepcionNumero: "REC-2026-0011",
  },
});
assert.deepEqual(traceShape(modernPurchaseTrace), [["order:oc-moderna", "reception:rec-moderna", "purchase:com-moderna"]]);
assertCurrentDocument(modernPurchaseTrace, "purchase", "com-moderna");

const emptyTrace = buildSupplyTrace({currentType: "order", order: {id: "oc-1", numero: "OC-2026-0001"}});
assert.deepEqual(traceShape(emptyTrace), [["order:oc-1", "reception:pending"]]);
assert.equal(emptyTrace[0][1].number, "Recepción pendiente");
assertCurrentDocument(emptyTrace, "order", "oc-1");

const partialTrace = buildSupplyTrace({currentType: "order", order: {id: "oc-1", numero: "OC-2026-0001"}, receptions: [
  {id: "rec-1", numero: "REC-2026-0001", compraId: "com-1", compraNumero: "COM-2026-0001"},
  {id: "rec-2", numero: "REC-2026-0002"},
]});
assert.deepEqual(traceShape(partialTrace), [
  ["order:oc-1", "reception:rec-1", "purchase:com-1"],
  ["order:oc-1", "reception:rec-2"],
]);
assertCurrentDocument(partialTrace, "order", "oc-1");
assert.equal(getSupplyDocumentRoute(partialTrace[1][1]), "/recepciones/rec-2");
assert.equal(getSupplyDocumentRoute(partialTrace[0][2]), "/compras/com-1");
console.log("OK trazabilidad abastecimiento: casos A-F y documento actual preservado");

assert.deepEqual(buildReceptionMutationPayload({
  fechaRecepcion: "2026-08-14",
  observaciones: "  bodega central  ",
  documentoOrigen: {nombreArchivo: "factura.pdf", tipoArchivo: "application/pdf", extension: "pdf", tamanoBytes: 1000, tipoDocumento: "factura", numeroDocumento: "123"},
  items: [{lineaId: "l1", cantidad: 3, costoUnitario: 1200, descuentoPct: 5}, {lineaId: "l2", cantidad: 0, costoUnitario: 800, descuentoPct: 0}],
}), {
  fechaRecepcion: "2026-08-14",
  observaciones: "bodega central",
  documentoOrigen: {origen: "importador_documental", nombreArchivo: "factura.pdf", tipoArchivo: "application/pdf", extension: "pdf", tamanoBytes: 1000, tipoDocumento: "factura", numeroDocumento: "123", fechaDocumento: "", fechaVencimiento: "", condicionesPago: "", moneda: "", proveedorDocumento: {nombre: "", identificadorFiscal: ""}, receptorDocumento: {nombre: "", identificadorFiscal: ""}, neto: null, impuestoPorcentaje: null, impuestoMonto: null, total: null, coherenciaEstado: "sin_datos", lineasDetectadas: 0, lineasAplicadas: 0, advertencias: [], importadoEn: null, actualizadoEn: null},
  items: [{lineaId: "l1", cantidad: 3, costoUnitario: 1200, descuentoPct: 5, documentoLineas: []}, {lineaId: "l2", cantidad: 0, costoUnitario: 800, descuentoPct: 0, documentoLineas: []}],
});
assert.throws(() => buildReceptionMutationPayload({
  fechaRecepcion: "2026-08-14",
  items: [{lineaId: "l1", cantidad: 0}],
}), /al menos una cantidad/i);
assert.throws(() => buildReceptionMutationPayload({
  fechaRecepcion: "2026-08-14",
  items: [{lineaId: "l1", cantidad: -1}],
}), /al menos una cantidad|no son validas/i);
assert.equal(shouldReconcileReceptionConfirmation({code: "functions/unavailable"}), true);
assert.equal(shouldReconcileReceptionConfirmation({code: "functions/failed-precondition"}), false);

assert.equal(getReceptionPurchaseAction(null, null, true), "");
assert.equal(getReceptionPurchaseAction({estado: "borrador"}, null, true), "");
assert.equal(getReceptionPurchaseAction({estado: "confirmada"}, null, true), "");
assert.equal(getReceptionPurchaseAction({estado: "confirmada", compraId: "com-1"}, {estado: "borrador"}, true), "view");
assert.equal(getReceptionPurchaseAction({estado: "confirmada", compraId: "com-1"}, {estado: "confirmada"}, true), "view");
assert.equal(getReceptionPurchaseAction({estado: "confirmada", compraId: "com-1"}, {estado: "borrador"}, false), "view");
assert.equal(getReceptionPurchaseAction({estado: "confirmada"}, null, false), "");

const receptionDetailSource = fs.readFileSync("src/pages/NewReceptionPage.jsx", "utf8");
const receptionListSource = fs.readFileSync("src/pages/ReceptionsPage.jsx", "utf8");
assert.doesNotMatch(receptionDetailSource, /Preparar compra|Continuar compra/);
assert.doesNotMatch(receptionListSource, /Preparar compra|Continuar compra/);
assert.doesNotMatch(receptionListSource, />Ver<|Abrir compra|Ver órdenes de compra/);
assert.match(receptionDetailSource, /generará automáticamente la compra correspondiente/);
assert.match(receptionDetailSource, /Confirmar recepción y registrar compra/);
assert.match(receptionDetailSource, /Recibir ahora/);
assert.match(receptionDetailSource, /Confirmar prestación/);
assert.match(receptionDetailSource, /SupplyTrace/);
assert.match(receptionDetailSource, /Recepción completada correctamente/);
assert.doesNotMatch(receptionDetailSource, /Inventario y compra registrados|Ver compra/);

console.log("Reception model smoke: OK");
