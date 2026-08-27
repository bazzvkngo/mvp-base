import assert from "node:assert/strict";
import fs from "node:fs";
import {
  adaptStoredReception,
  buildReceptionMutationPayload,
  getOrderReceptionStatus,
  getOrderReceptionStatusLabel,
  getReceptionPurchaseAction,
  getReceptionStatusLabel,
  shouldReconcileReceptionConfirmation,
} from "../src/domain/receptionModel.mjs";

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
assert.equal(getOrderReceptionStatusLabel("recibida_parcial"), "Parcialmente recibida");

const order = {id: "oc-1", items: [{lineaId: "l1", cantidad: 10}]};
assert.equal(getOrderReceptionStatus(order, [reception]), "recibida_parcial");
assert.equal(getOrderReceptionStatus(order, [
  reception,
  adaptStoredReception({estado: "confirmada", ordenCompraId: "oc-1", items: [{lineaId: "l1", cantidad: 6}]}),
]), "recibida_total");
assert.equal(getOrderReceptionStatus(order, [
  adaptStoredReception({estado: "borrador", ordenCompraId: "oc-1", items: [{lineaId: "l1", cantidad: 10}]}),
]), "sin_recepcion");

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
assert.match(receptionDetailSource, /registrará automáticamente la compra/);

console.log("Reception model smoke: OK");
