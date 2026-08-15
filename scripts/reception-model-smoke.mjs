import assert from "node:assert/strict";
import {
  adaptStoredReception,
  buildReceptionMutationPayload,
  getOrderReceptionStatus,
  getOrderReceptionStatusLabel,
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
  items: [{lineaId: "l1", cantidad: 3}, {lineaId: "l2", cantidad: 0}],
}), {
  fechaRecepcion: "2026-08-14",
  observaciones: "bodega central",
  items: [{lineaId: "l1", cantidad: 3}, {lineaId: "l2", cantidad: 0}],
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

console.log("Reception model smoke: OK");
