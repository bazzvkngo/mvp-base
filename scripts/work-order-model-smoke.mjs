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
import {
  adaptStoredWorkshopPlaza,
  canAssignWorkshopPlazas,
  canManageWorkshopPlazas,
  deriveWorkshopPlazaOccupancy,
  getWorkshopPlazaFieldErrors,
} from "../src/domain/workshopPlazaModel.mjs";

const require = createRequire(import.meta.url);
const {
  scopeFingerprint,
  freezeCoreItem,
  canApproveWorkOrder,
  formatWorkOrderNumber,
  hasReceptionAnomaly,
  listarCatalogoTallerHandler,
  normalizeDiagnosisInput,
  normalizeReceptionInput,
  normalizeWorkOrderInput,
  normalizeServiceInput,
  plannedQuantity,
  profileIdentityName,
  receptionNextStatus,
} = require("../functions/workOrderPersistence.js");

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const baseScope = [{servicioOtId: "s1", itemId: "core-s1", responsableUid: "u1",
  productos: [{productoOtId: "p1", itemId: "core-p1", cantidad: 2}]}];
assert.equal(scopeFingerprint(baseScope), scopeFingerprint([{...baseScope[0], responsableUid: "u2", precioUnitario: 50}]));
assert.notEqual(scopeFingerprint(baseScope), scopeFingerprint([{...baseScope[0], itemId: "core-s2"}]));
assert.notEqual(scopeFingerprint(baseScope), scopeFingerprint([{...baseScope[0], productos: [{...baseScope[0].productos[0], cantidad: 3}]}]));
const reorderedScope = [...baseScope, {servicioOtId: "s2", itemId: "core-s2", productos: []}];
assert.equal(scopeFingerprint(reorderedScope), scopeFingerprint([...reorderedScope].reverse()));
for (const role of ["OWNER", "ADMIN"]) assert.equal(canApproveWorkOrder({rol: role}), true);
for (const role of ["TECNICO", "MEMBER", "VENTAS", "FINANZAS"]) assert.equal(canApproveWorkOrder({rol: role}), false);
assert.equal(canApproveWorkOrder({rol: "ADMIN", profileId: "perfil-solo-modulos"}), false);
const coreSnapshot = (overrides = {}) => ({exists: true, id: "core-s1", data: () => ({
  negocioId: "b1", tipoItem: "servicio", estado: "activo", precioInterno: 25000,
  nombre: "Cambio de aceite", codigoInterno: "S1", unidad: "servicio", costoUnitario: 5, ...overrides,
})});
const frozen = freezeCoreItem(coreSnapshot(), "b1", "core-s1", "servicio", TestHttpsError);
assert.equal(frozen.precioUnitario, 25000);
assert.equal(frozen.snapshot.nombre, "Cambio de aceite");
assert.deepEqual(Object.keys(frozen.snapshot).sort(), ["codigoInterno", "nombre", "unidad", "modeloInventarioVersion"].sort());
for (const overrides of [{precioInterno: "25000"}, {precioInterno: NaN}, {precioInterno: -1},
  {tipoItem: "producto"}, {negocioId: "b2"}, {estado: "inactivo"}]) {
  assert.throws(() => freezeCoreItem(coreSnapshot(overrides), "b1", "core-s1", "servicio", TestHttpsError));
}
console.log("OK aprobación OT: huella de alcance, capacidad separada y snapshot Core sin costos");

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
assert.deepEqual(normalizeServiceInput({itemId: "service-1", responsableUid: "member-1"}, TestHttpsError),
  {itemId: "service-1", responsableUid: "member-1"});
assert.throws(() => normalizeServiceInput({itemId: "service-1", responsableUid: "member-1", precioUnitario: 1}, TestHttpsError),
  (error) => error.code === "invalid-argument");
assert.equal(plannedQuantity(1.25, TestHttpsError), 1.25);
assert.throws(() => plannedQuantity(0, TestHttpsError), (error) => error.code === "invalid-argument");
const catalog = await listarCatalogoTallerHandler({data: {businessId: "business-1"}}, {
  db: {}, HttpsError: TestHttpsError,
  requireBusinessAccess: async (request, dependencies, options) => {
    assert.equal(request.data.businessId, "business-1");
    assert.equal(options.moduleId, "taller");
    return {businessId: "business-1", businessRef: {collection: () => ({where: () => ({get: async () => ({docs: [
      {id: "service-1", data: () => ({negocioId: "business-1", tipoItem: "servicio", estado: "activo", nombre: "Servicio", precioInterno: 25000, costoBase: 10000})},
      {id: "foreign", data: () => ({negocioId: "business-2", tipoItem: "producto", estado: "activo", nombre: "Ajeno"})},
    ]})})})}};
  },
});
assert.deepEqual(catalog.items, [{
  itemId: "service-1", tipoItem: "servicio", estado: "activo", nombre: "Servicio",
  codigoInterno: "", stock: null, precioEfectivo: 25000,
}]);
assert.equal(
  profileIdentityName({nombres: "Matías", apellidos: "Pérez"}, {email: "matias@bagner.cl", displayName: "matias@bagner.cl"}),
  "Matías Pérez"
);
assert.equal(
  profileIdentityName({nombres: "", apellidos: ""}, {email: "matias@bagner.cl", displayName: "Otro nombre"}),
  "matias@bagner.cl"
);
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

const plaza = adaptStoredWorkshopPlaza({id: "plaza-1", negocioId: "business-1", nombre: " Plaza 1 ", estado: "activa"});
assert.equal(plaza.plazaId, "plaza-1");
assert.equal(plaza.nombre, "Plaza 1");
assert.deepEqual(getWorkshopPlazaFieldErrors({nombre: ""}), {nombre: "El nombre de la Plaza es obligatorio."});
assert.deepEqual(getWorkshopPlazaFieldErrors({nombre: "Plaza 1"}), {});
assert.equal(canManageWorkshopPlazas("OWNER"), true);
assert.equal(canManageWorkshopPlazas("ADMIN"), true);
assert.equal(canManageWorkshopPlazas("TECNICO"), false);
assert.equal(canAssignWorkshopPlazas("TECNICO"), true);
assert.equal(canAssignWorkshopPlazas("VENTAS"), false);
const derivedOccupancy = deriveWorkshopPlazaOccupancy([plaza], [
  {otId: "ot-active", plazaId: "plaza-1", estado: "en_diagnostico"},
  {otId: "ot-closed", plazaId: "plaza-1", estado: "cerrada"},
]);
assert.equal(derivedOccupancy.get("plaza-1").order.otId, "ot-active");
assert.equal(derivedOccupancy.get("plaza-1").conflict, false);
assert.equal(deriveWorkshopPlazaOccupancy([plaza], [
  {otId: "ot-closed", plazaId: "plaza-1", estado: "cerrada"},
]).has("plaza-1"), false);
console.log("OK dominio Plaza: estado persistido separado de ocupación derivada y permisos UI");

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
assert.deepEqual(normalizeDiagnosisInput({responsableUid: "member-1", descripcion: "  Falla en arranque  ", observaciones: ""}, TestHttpsError), {
  responsableUid: "member-1", descripcion: "Falla en arranque", observaciones: "",
});
assert.throws(() => normalizeDiagnosisInput({responsableUid: "member-1", descripcion: "", observaciones: "", estado: "completado"}, TestHttpsError),
  (error) => error.code === "invalid-argument" && /estado.*no está admitido/i.test(error.message));
console.log("OK recepción OT: enums, anomalías, NO_REVISADO/NO_PROBADO y transición autoritativa");
console.log("WORK_ORDER_MODEL_SMOKE_OK");
