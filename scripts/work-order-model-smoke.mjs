import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {
  adaptStoredWorkOrder,
  getWorkOrderApprovalLabel,
  getWorkOrderStatusLabel,
  matchesWorkOrderSearch,
} from "../src/domain/workOrderModel.mjs";
import {
  getReceptionFieldErrors,
  hasReceptionAnomaly as hasReceptionAnomalyForUi,
} from "../src/domain/workOrderReceptionModel.mjs";

const require = createRequire(import.meta.url);
const {
  formatWorkOrderNumber,
  hasReceptionAnomaly,
  normalizeReceptionInput,
  normalizeWorkOrderInput,
  receptionNextStatus,
} = require("../functions/workOrderPersistence.js");

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

assert.deepEqual(
  normalizeWorkOrderInput({vehiculoId: "vehicle-1"}, TestHttpsError),
  {vehiculoId: "vehicle-1"}
);
assert.throws(
  () => normalizeWorkOrderInput({vehiculoId: "vehicle-1", numeroOT: "OT-999999"}, TestHttpsError),
  (error) => error.code === "invalid-argument" && /numeroOT.*no está admitido/i.test(error.message)
);
assert.throws(
  () => normalizeWorkOrderInput({vehiculoId: ""}, TestHttpsError),
  (error) => error.code === "invalid-argument" && /vehículo/i.test(error.message)
);
assert.equal(formatWorkOrderNumber(1), "OT-000001");
assert.equal(formatWorkOrderNumber(42), "OT-000042");
assert.equal(formatWorkOrderNumber(1000000), "OT-1000000");
console.log("OK backend OT: payload acotado y número visible canónico");

const order = adaptStoredWorkOrder({
  id: "ot-1",
  negocioId: "business-1",
  numeroOT: "OT-000001",
  vehiculoId: "vehicle-1",
  clienteId: "client-1",
  estado: "ingresada",
  estadoAprobacion: "pendiente",
  plazaId: null,
});
assert.equal(order.otId, "ot-1");
assert.equal(order.plazaId, "");
assert.equal(getWorkOrderStatusLabel("ingresada"), "Ingresada");
assert.equal(getWorkOrderApprovalLabel("pendiente"), "Pendiente");
assert.equal(
  matchesWorkOrderSearch(order, {patente: "ABCD12"}, "ot-000001"),
  true
);
assert.equal(
  matchesWorkOrderSearch(order, {patente: "ABCD12"}, "abcd12"),
  true
);
assert.equal(
  matchesWorkOrderSearch(order, {patente: "ABCD12"}, "inexistente"),
  false
);
console.log("OK dominio UI OT: adaptación, etiquetas y búsqueda");

const reception = {
  kilometraje: 125000,
  nivelCombustible: "1/2",
  checklist: {
    carroceriaPintura: "NO_REVISADO",
    vidriosEspejos: "SIN_DANOS_VISIBLES",
    lucesOpticos: "SIN_DANOS_VISIBLES",
    neumaticosLlantas: "SIN_DANOS_VISIBLES",
    interior: "SIN_DANOS_VISIBLES",
    tableroIndicadores: "NO_REVISADO",
    encendido: "NO_PROBADO",
    fugasVisibles: "NO_REVISADO",
    nivelesVisibles: "SIN_OBSERVACIONES",
    estadoGeneral: "SIN_OBSERVACIONES",
  },
  accesorios: ["Llave de rueda"],
  danosObservados: "Ninguno",
  observaciones: "",
};
assert.deepEqual(normalizeReceptionInput(reception, TestHttpsError), reception);
assert.equal(hasReceptionAnomaly(reception.checklist), false);
assert.equal(hasReceptionAnomalyForUi(reception.checklist), false);
assert.equal(receptionNextStatus({estado: "ingresada", plazaId: null}), "en_cola");
assert.equal(receptionNextStatus({estado: "ingresada", plazaId: "plaza-1"}), "en_diagnostico");
assert.equal(receptionNextStatus({estado: "en_cola", plazaId: null}), "en_cola");
assert.throws(
  () => normalizeReceptionInput({...reception, danosObservados: "Sin novedades"}, TestHttpsError),
  (error) => error.code === "invalid-argument" && /exactamente Ninguno/i.test(error.message)
);
const withAnomaly = {
  ...reception,
  checklist: {...reception.checklist, encendido: "NO_ENCIENDE"},
  danosObservados: "El motor no enciende al probarlo.",
};
assert.deepEqual(normalizeReceptionInput(withAnomaly, TestHttpsError), withAnomaly);
assert.equal(hasReceptionAnomaly(withAnomaly.checklist), true);
assert.throws(
  () => normalizeReceptionInput({...withAnomaly, danosObservados: "Ninguno"}, TestHttpsError),
  (error) => error.code === "invalid-argument" && /Describe los daños/i.test(error.message)
);
assert.throws(
  () => normalizeReceptionInput({...reception, checklist: {...reception.checklist, encendido: "INVÁLIDO"}}, TestHttpsError),
  (error) => error.code === "invalid-argument" && /no permitido/i.test(error.message)
);
assert.throws(
  () => normalizeReceptionInput({...reception, checklist: {...reception.checklist, interior: ""}}, TestHttpsError),
  (error) => error.code === "invalid-argument" && /obligatorio/i.test(error.message)
);
assert.throws(
  () => normalizeReceptionInput({...reception, nivelCombustible: "Medio"}, TestHttpsError),
  (error) => error.code === "invalid-argument" && /nivel de combustible válido/i.test(error.message)
);
assert.equal(Object.keys(getReceptionFieldErrors({...reception, kilometraje: "125000", accesoriosTexto: "Llave de rueda"})).length, 0);
console.log("OK recepción OT: enums, anomalías, NO_REVISADO/NO_PROBADO y transición autoritativa");
console.log("WORK_ORDER_MODEL_SMOKE_OK");
