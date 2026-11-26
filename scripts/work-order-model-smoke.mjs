import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {
  adaptStoredWorkOrder,
  calculateWorkOrderScopeTotal,
  getWorkOrderApprovalLabel,
  getWorkOrderDisplayStatusLabel,
  getWorkOrderDisplayStatusVariant,
  getWorkOrderStatusLabel,
  isWorkOrderWaitingForPlaza,
  matchesWorkOrderSearch,
} from "../src/domain/workOrderModel.mjs";
import {getWorkOrderHistoryDetail} from "../src/domain/workOrderHistoryModel.mjs";
import {
  appendReceptionReason,
  buildReceptionMutationPayload,
  getReceptionFieldErrors,
  MAX_RECEPTION_MILEAGE_KM,
  RECEPTION_FUEL_LEVELS,
  RECEPTION_WARNING_LIGHTS,
  receptionRequirements,
  receptionValuesFromStored,
} from "../src/domain/workOrderReceptionModel.mjs";
import {
  adaptStoredWorkshopPlaza,
  canAssignWorkshopPlazas,
  canManageWorkshopPlazas,
  deriveWorkshopPlazaOccupancy,
  getPlazaBayStatus,
  getWorkshopPlazaFieldErrors,
  plazaWorkProgress,
  workshopOccupancySummary,
  workshopWaitingQueue,
} from "../src/domain/workshopPlazaModel.mjs";

const require = createRequire(import.meta.url);
const {
  MAX_RECEPTION_MILEAGE_KM: MAX_BACKEND_RECEPTION_MILEAGE_KM,
  scopeFingerprint,
  freezeCoreItem,
  canApproveWorkOrder,
  formatWorkOrderNumber,
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
// El trabajo no tiene responsable propio: el responsable es de la OT y se elige al aprobar.
assert.deepEqual(normalizeServiceInput({itemId: "service-1"}, TestHttpsError), {itemId: "service-1"});
assert.throws(() => normalizeServiceInput({itemId: "service-1", responsableUid: "member-1"}, TestHttpsError),
  (error) => error.code === "invalid-argument");
assert.throws(() => normalizeServiceInput({itemId: "service-1", precioUnitario: 1}, TestHttpsError),
  (error) => error.code === "invalid-argument");
assert.equal(plannedQuantity(1.25, TestHttpsError), 1.25);
assert.throws(() => plannedQuantity(0, TestHttpsError), (error) => error.code === "invalid-argument");
const catalogDocuments = [
  {id: "service-1", data: () => ({negocioId: "business-1", tipoItem: "servicio", estado: "activo", nombre: "Servicio", precioInterno: 25000, costoBase: 10000})},
  {id: "foreign", data: () => ({negocioId: "business-2", tipoItem: "producto", estado: "activo", nombre: "Ajeno"})},
  {id: "part-1", data: () => ({negocioId: "business-1", tipoItem: "producto", estado: "activo", nombre: "Pastillas", stock: 3, stockMinimo: 5})},
  {id: "part-2", data: () => ({negocioId: "business-1", tipoItem: "producto", estado: "activo", nombre: "Filtro", stock: 9, stockMinimo: ""})},
];
const catalogFor = (membership) => listarCatalogoTallerHandler({data: {businessId: "business-1"}}, {
  db: {}, HttpsError: TestHttpsError,
  requireBusinessAccess: async (request, dependencies, options) => {
    assert.equal(request.data.businessId, "business-1");
    assert.equal(options.requiredVerticalModule, "taller");
    assert.equal(Object.hasOwn(options, "moduleId"), false);
    return {membership, businessId: "business-1", businessRef: {collection: () => ({where: () => ({get: async () => ({docs: catalogDocuments})})})}};
  },
});
const technicianCatalog = await catalogFor({rol: "TECNICO"});
assert.deepEqual(technicianCatalog.items, [{
  itemId: "service-1", tipoItem: "servicio", estado: "activo", nombre: "Servicio",
  codigoInterno: "", stock: null, stockMinimo: null, precioEfectivo: null,
}, {
  itemId: "part-1", tipoItem: "producto", estado: "activo", nombre: "Pastillas",
  codigoInterno: "", stock: 3, stockMinimo: 5, precioEfectivo: null,
}, {
  itemId: "part-2", tipoItem: "producto", estado: "activo", nombre: "Filtro",
  codigoInterno: "", stock: 9, stockMinimo: null, precioEfectivo: null,
}]);
assert.equal((await catalogFor({rol: "OWNER"})).items[0].precioEfectivo, 25000);
assert.equal((await catalogFor({rol: "MEMBER"})).items[0].precioEfectivo, 25000);
assert.equal((await catalogFor({rol: "MEMBER", profileId: "profile", modules: ["taller"]})).items[0].precioEfectivo, null);
assert.equal((await catalogFor({rol: "MEMBER", profileId: "profile", modules: ["taller", "cotizaciones"]})).items[0].precioEfectivo, 25000);
assert.equal(
  profileIdentityName({nombres: "Matías", apellidos: "Pérez"}, {email: "usuario@example.test", displayName: "usuario@example.test"}),
  "Matías Pérez"
);
assert.equal(
  profileIdentityName({nombres: "", apellidos: ""}, {email: "usuario@example.test", displayName: "Otro nombre"}),
  "usuario@example.test"
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
  motivoCliente: "Ruido al frenar y vibración en el volante.",
  kilometraje: 125000,
  nivelCombustible: "1/2",
  testigosEncendidos: false,
  testigos: [],
  ingresaNombre: "Marta Rojas",
  ingresaDocumento: "12.345.678-5",
};
assert.deepEqual(normalizeReceptionInput(reception, TestHttpsError), reception);
const rejectsBearer = (input, pattern) => assert.throws(
  () => normalizeReceptionInput(input, TestHttpsError),
  (error) => error.code === "invalid-argument" && pattern.test(error.message)
);
// Quien entrega puede no ser el titular: nombre y RUT válido son obligatorios (el RUT puede omitirse si ya está guardado).
rejectsBearer({...reception, ingresaNombre: " "}, /nombre de quien entrega.*obligatorio/i);
rejectsBearer({...reception, ingresaDocumento: ""}, /documento de identidad.*obligatorio/i);
rejectsBearer({...reception, ingresaDocumento: "12.345.678-9"}, /RUT válido/i);
assert.equal(normalizeReceptionInput({...reception, ingresaDocumento: ""}, TestHttpsError, {hasStoredDocument: true}).ingresaDocumento, "");
assert.equal(normalizeReceptionInput({...reception, ingresaDocumento: "123456785"}, TestHttpsError).ingresaDocumento, "12.345.678-5");
assert.equal(MAX_BACKEND_RECEPTION_MILEAGE_KM, MAX_RECEPTION_MILEAGE_KM);
assert.deepEqual(
  normalizeReceptionInput({...reception, kilometraje: MAX_RECEPTION_MILEAGE_KM}, TestHttpsError),
  {...reception, kilometraje: MAX_RECEPTION_MILEAGE_KM}
);
const rejectsReception = (input, pattern) => assert.throws(
  () => normalizeReceptionInput(input, TestHttpsError),
  (error) => error.code === "invalid-argument" && pattern.test(error.message)
);
rejectsReception({...reception, kilometraje: MAX_RECEPTION_MILEAGE_KM + 1}, /kilometraje.*no puede superar/i);
assert.equal(receptionNextStatus({estado: "ingresada", plazaId: null}), "en_cola");
assert.equal(receptionNextStatus({estado: "ingresada", plazaId: "plaza-1"}), "en_diagnostico");
assert.equal(receptionNextStatus({estado: "en_cola", plazaId: null}), "en_cola");
// Prototipo: relato, kilometraje, combustible y sensores; la checklist anterior ya no se admite.
rejectsReception({...reception, motivoCliente: "   "}, /motivo del cliente.*obligatorio/i);
rejectsReception({...reception, nivelCombustible: "Medio"}, /nivel de combustible válido/i);
rejectsReception({...reception, nivelCombustible: "Vacío"}, /nivel de combustible válido/i);
rejectsReception({...reception, testigosEncendidos: undefined}, /Indica si hay sensores encendidos/i);
rejectsReception({...reception, testigosEncendidos: true, testigos: []}, /Elige cuáles sensores/i);
rejectsReception({...reception, testigosEncendidos: false, testigos: ["abs"]}, /lista debe estar vacía/i);
rejectsReception({...reception, testigosEncendidos: true, testigos: ["turbo"]}, /no son válidos/i);
rejectsReception({...reception, testigosEncendidos: true, testigos: ["abs", "abs"]}, /no son válidos/i);
rejectsReception({...reception, checklist: {}}, /campo de recepción checklist no está admitido/i);
rejectsReception({...reception, danosObservados: "Ninguno"}, /danosObservados no está admitido/i);
const withLights = {...reception, testigosEncendidos: true, testigos: ["frenos", "abs"]};
assert.deepEqual(normalizeReceptionInput(withLights, TestHttpsError).testigos, ["abs", "frenos"]);
// La interfaz y el servidor comparten las mismas listas.
const serverLights = require("node:fs").readFileSync("functions/workOrderPersistence.js", "utf8").match(/RECEPTION_WARNING_LIGHTS = Object\.freeze\(\[([^\]]+)\]/)[1];
assert.deepEqual(serverLights.match(/"([^"]+)"/g).map((item) => item.slice(1, -1)), RECEPTION_WARNING_LIGHTS.map((light) => light.value));
assert.deepEqual(RECEPTION_FUEL_LEVELS.map((level) => level.value), ["Reserva", "1/4", "1/2", "3/4", "Lleno"]);

const formValues = {motivoCliente: "Ruido", kilometraje: "125000", nivelCombustible: "1/2", testigosEncendidos: false, testigos: [],
  ingresaNombre: "Marta Rojas",  ingresaDocumento: "12.345.678-5", ingresaTieneDocumento: false};
assert.equal(Object.keys(getReceptionFieldErrors(formValues)).length, 0);
assert.match(getReceptionFieldErrors({...formValues, kilometraje: String(MAX_RECEPTION_MILEAGE_KM + 1)}).kilometraje, /no puede superar/i);
assert.match(getReceptionFieldErrors({...formValues, kilometraje: "0"}).kilometraje, /mayor que cero/i);
assert.match(getReceptionFieldErrors({...formValues, motivoCliente: " "}).motivoCliente, /motivo de ingreso/i);
assert.match(getReceptionFieldErrors({...formValues, nivelCombustible: ""}).nivelCombustible, /combustible/i);
assert.match(getReceptionFieldErrors({...formValues, testigosEncendidos: null}).testigos, /Indica si hay sensores/i);
assert.match(getReceptionFieldErrors({...formValues, testigosEncendidos: true}).testigos, /Elige cuáles/i);
assert.deepEqual(buildReceptionMutationPayload({...formValues, testigosEncendidos: true, testigos: ["frenos", "abs"]}),
  {motivoCliente: "Ruido", kilometraje: 125000, nivelCombustible: "1/2", testigosEncendidos: true, testigos: ["abs", "frenos"],
    ingresaNombre: "Marta Rojas",  ingresaDocumento: "12.345.678-5"});
assert.match(getReceptionFieldErrors({...formValues, ingresaNombre: " "}).ingresaNombre, /nombre de quien entrega/i);
assert.match(getReceptionFieldErrors({...formValues, ingresaDocumento: ""}).ingresaDocumento, /RUT/i);
assert.equal(getReceptionFieldErrors({...formValues, ingresaDocumento: "", ingresaTieneDocumento: true}).ingresaDocumento, undefined);
assert.deepEqual(buildReceptionMutationPayload({...formValues, testigos: ["abs"]}).testigos, []);
assert.deepEqual(receptionValuesFromStored(null), {motivoCliente: "", kilometraje: "", nivelCombustible: "", testigosEncendidos: null, testigos: [],
  ingresaNombre: "", ingresaDocumento: "", ingresaTieneDocumento: false});
const storedBearer = receptionValuesFromStored({...reception, ingresaTieneDocumento: true});
assert.equal(storedBearer.ingresaDocumento, "", "el RUT no se vuelve a mostrar en el formulario");
assert.equal(storedBearer.ingresaTieneDocumento, true);
assert.equal(receptionValuesFromStored({...reception, testigosEncendidos: true, testigos: ["abs"]}).testigos[0], "abs");
assert.equal(appendReceptionReason("", "Fuga"), "Fuga");
assert.equal(appendReceptionReason("Ruido en frenos.", "Fuga"), "Ruido en frenos. Fuga");
assert.equal(appendReceptionReason("Vibración", "Fuga"), "Vibración. Fuga");
// Requisitos del prototipo, en su orden.
const photosDone = {completedVehicle: 6, totalVehicle: 6, dashboard: {completed: true}};
const photosNone = {completedVehicle: 2, totalVehicle: 6, dashboard: {completed: false}};
assert.deepEqual(receptionRequirements(formValues, photosDone).map((item) => item.label),
  ["Relato del cliente", "Nombre y RUT de quien entrega", "6 fotos del vehículo (6/6)", "Foto del tablero", "Kilometraje", "Nivel de combustible", "Sensores indicados"]);
assert.equal(receptionRequirements(formValues, photosDone).every((item) => item.done), true);
assert.deepEqual(receptionRequirements(receptionValuesFromStored(null), photosNone).map((item) => item.done),
  [false, false, false, false, false, false, false]);
assert.equal(receptionRequirements({...formValues, testigosEncendidos: true}, photosDone).at(-1).label, "Sensores indicados (elige cuáles)");
assert.equal(receptionRequirements({...formValues, testigosEncendidos: true, testigos: ["abs"]}, photosDone).at(-1).done, true);
assert.deepEqual(normalizeDiagnosisInput({responsableUid: "member-1", descripcion: "  Falla en arranque  ", observaciones: ""}, TestHttpsError), {
  responsableUid: "member-1", descripcion: "Falla en arranque", observaciones: "",
});
assert.throws(() => normalizeDiagnosisInput({responsableUid: "member-1", descripcion: "", observaciones: "", estado: "completado"}, TestHttpsError),
  (error) => error.code === "invalid-argument" && /estado.*no está admitido/i.test(error.message));
console.log("OK recepción OT: relato, combustible, sensores, requisitos del prototipo y transición autoritativa");
// Mensajes de error que ve la persona: Inventario, sin la palabra interna «Core».
{
  const fs = require("node:fs");
  const visible = [];
  assert.throws(() => normalizeServiceInput({itemId: ""}, TestHttpsError),
    (error) => { visible.push(error.message); return error.code === "invalid-argument" && /El servicio de Inventario/.test(error.message); });
  const missing = {exists: false, id: "x", data: () => undefined};
  assert.throws(() => freezeCoreItem(missing, "negocio-1", "x", "servicio", TestHttpsError),
    (error) => { visible.push(error.message); return error.code === "not-found" && /ítem de Inventario\./.test(error.message); });
  const wrongType = {exists: true, id: "x", data: () => ({tipoItem: "producto", estado: "activo"})};
  assert.throws(() => freezeCoreItem(wrongType, "negocio-1", "x", "servicio", TestHttpsError),
    (error) => { visible.push(error.message); return error.code === "failed-precondition" && /de Inventario del mismo negocio/.test(error.message); });
  visible.forEach((message) => assert.doesNotMatch(message, /Core/, `mensaje visible con «Core»: ${message}`));
  // Los productos de planificación se validan dentro de una transacción: se revisa el código fuente.
  const persistenceSource = fs.readFileSync("functions/workOrderPersistence.js", "utf8");
  const leaks = persistenceSource.split(/\r?\n/).filter((line) => /(fail\(|identifier\()/.test(line) && /Core/.test(line));
  assert.deepEqual(leaks, [], `mensajes de error con «Core»:\n${leaks.join("\n")}`);
  assert.match(persistenceSource, /"El producto de Inventario"/);
}
// Total del alcance: servicios (x1) + productos (cantidad x precio), sin IVA.
assert.equal(calculateWorkOrderScopeTotal([
  {precioUnitario: 25000, productos: [{precioUnitario: 8000, cantidad: 3}, {precioUnitario: 1500, cantidad: 2}]},
  {precioUnitario: 5000, productos: []},
]), 57000);
assert.equal(calculateWorkOrderScopeTotal([]), 0);
assert.equal(calculateWorkOrderScopeTotal([{precioUnitario: null, productos: []}]), null, "sin precio no hay total");
assert.equal(calculateWorkOrderScopeTotal([{precioUnitario: 100, productos: [{precioUnitario: 5, cantidad: undefined}]}]), null);
{
  // La aprobación es una compuerta: rechazar exige motivo y no cambia el estado; ya no hay envío a aprobación.
  const fs = require("node:fs");
  const persistenceSource = fs.readFileSync("functions/workOrderPersistence.js", "utf8");
  assert.match(persistenceSource, /"El motivo del rechazo"[^\n]*\{required: true\}/);
  assert.match(persistenceSource, /El ingreso se aprueba o rechaza directamente; los trabajos se registran en la ejecución\./);
  assert.match(persistenceSource, /action === "aprobar" \? \(waitsForPlaza \? "en_cola" : "en_reparacion"\) : gateOrder\.estado/);
}
console.log("OK alcance OT: total sin IVA, motivo de rechazo obligatorio y aprobación como compuerta");
{
  // Espera de Plaza: misma regla en la interfaz y en el servidor.
  const {isWaitingForPlaza} = require("../functions/workOrderPlazaAssignment.js");
  const waiting = {recepcion: {kilometraje: 1}, estado: "en_cola", estadoAprobacion: "aprobada", plazaId: ""};
  const cases = [
    [waiting, true],
    [{...waiting, plazaId: "plaza-1"}, false],
    [{...waiting, estadoAprobacion: "pendiente"}, false],
    [{...waiting, estado: "en_reparacion"}, false],
    [{...waiting, recepcion: null}, false],
  ];
  for (const [order, expected] of cases) {
    assert.equal(isWorkOrderWaitingForPlaza(order), expected);
    assert.equal(isWaitingForPlaza({...order, plazaId: order.plazaId || null}), expected);
  }
  assert.equal(getWorkOrderDisplayStatusLabel(waiting), "En espera de plaza");
  assert.equal(getWorkOrderDisplayStatusVariant(waiting), "warning");
  assert.equal(getWorkOrderDisplayStatusLabel({...waiting, estadoAprobacion: "pendiente"}), "En cola");
  assert.match(getWorkOrderHistoryDetail({tipo: "ot_aprobada", detalle: {estado: "en_cola", enEsperaDePlaza: true}}),
    /En espera de plaza/);
  assert.equal(getWorkOrderHistoryDetail({tipo: "plaza_asignada", detalle: {plazaId: "p", automatica: true}}),
    "Asignada automáticamente.");
  assert.equal(getWorkOrderHistoryDetail({tipo: "plaza_asignada", detalle: {plazaId: "p"}}), "");
  assert.equal(getWorkOrderHistoryDetail({tipo: "foto_recepcion_registrada", detalle: {zona: "lateral-izquierdo-delantero", conDanos: true, cantidadDanos: 2}}),
    "Zona: Lateral izq. delantero · 2 daño(s) anotado(s).");
  assert.equal(getWorkOrderHistoryDetail({tipo: "foto_recepcion_registrada", detalle: {zona: "trasera", conDanos: false}}),
    "Zona: Trasera · sin daños.");
  assert.equal(getWorkOrderHistoryDetail({tipo: "foto_recepcion_registrada", detalle: {zona: "tablero"}}), "Zona: Tablero.");
  {
    const {receptionPhotoProgress} = await import("../src/domain/workOrderReceptionPhotoModel.mjs");
    const {receptionPhotoDamages, missingReceptionPhotoZones} = require("../functions/workOrderReceptionPhotoZones.js");
    const order = {fotosRecepcion: {
      "delantera": {hash: "a", conDanos: false, marcas: []},
      "lateral-izquierdo-delantero": {hash: "b", conDanos: true, marcas: [{x: 0.1, y: 0.2, nota: "rayón"}]},
    }};
    const progress = receptionPhotoProgress(order);
    assert.equal(progress.completedVehicle, 2);
    assert.equal(progress.damagedZones, 1);
    assert.equal(progress.dashboard.completed, false);
    assert.equal(progress.complete, false);
    assert.deepEqual(progress.missing, missingReceptionPhotoZones(order), "faltantes iguales en cliente y servidor");
    assert.deepEqual(receptionPhotoDamages(order), [{zona: "Lateral izq. delantero", notas: ["rayón"]}]);
  }
  console.log("OK espera de Plaza: etiqueta, variante e historial coinciden con la regla del servidor");
}
// Plazas en vista gráfica: estado de cada bahía, ocupación (solo plazas activas), cola por orden de aprobación y avance.
assert.deepEqual(getPlazaBayStatus({estado: "en_diagnostico"}), {key: "revision", label: "En revisión", tone: "warning"});
assert.deepEqual(getPlazaBayStatus({estado: "en_reparacion"}), {key: "reparacion", label: "En reparación", tone: "info"});
assert.deepEqual(getPlazaBayStatus({estado: "pendiente_entrega"}), {key: "listo", label: "Listo para retiro", tone: "success"});
{
  const plazasDemo = [{plazaId: "p1", estado: "activa"}, {plazaId: "p2", estado: "activa"}, {plazaId: "p3", estado: "inactiva"}];
  const occupancyDemo = deriveWorkshopPlazaOccupancy(plazasDemo, [
    {otId: "o1", plazaId: "p1", estado: "en_reparacion"}, {otId: "o3", plazaId: "p3", estado: "en_reparacion"}]);
  assert.deepEqual(workshopOccupancySummary(plazasDemo, occupancyDemo), {activas: 2, ocupadas: 1, porcentaje: 50});
  assert.deepEqual(workshopOccupancySummary([], new Map()), {activas: 0, ocupadas: 0, porcentaje: 0});
  const waiting = workshopWaitingQueue([
    {otId: "b", recepcion: {}, estado: "en_cola", estadoAprobacion: "aprobada", aprobadaEn: {toMillis: () => 20}},
    {otId: "a", recepcion: {}, estado: "en_cola", estadoAprobacion: "aprobada", aprobadaEn: {toMillis: () => 10}},
    {otId: "c", recepcion: {}, estado: "en_cola", estadoAprobacion: "pendiente"},
    {otId: "d", recepcion: {}, estado: "en_cola", estadoAprobacion: "aprobada", plazaId: "p1"},
  ]);
  assert.deepEqual(waiting.map((order) => order.otId), ["a", "b"]);
  assert.deepEqual(plazaWorkProgress([{estado: "completado"}, {estado: "en_progreso"}, {estado: "pendiente"}]),
    {terminados: 1, total: 3, porcentaje: 33});
  assert.deepEqual(plazaWorkProgress([]), {terminados: 0, total: 0, porcentaje: 0});
}
console.log("OK Plazas: estado por bahía, ocupación, cola de espera y avance");
// Panel del taller: indicadores sin repetir, vistas de la lista, pendientes por antigüedad (con detenidos), actividad y técnico.
{
  const home = await import("../src/domain/workshopHomeModel.mjs");
  const ts = (value) => ({toMillis: () => value});
  const now = new Date(2026, 10, 25, 15, 0);
  const hour = 60 * 60 * 1000;
  const at = (hoursAgo) => ts(now.getTime() - hoursAgo * hour);
  const orders = [
    {otId: "r", numeroOT: "OT-1", estado: "ingresada", estadoAprobacion: "pendiente"},
    {otId: "a", numeroOT: "OT-2", estado: "en_diagnostico", estadoAprobacion: "pendiente", recepcion: {recibidoEn: at(5)}},
    {otId: "q", numeroOT: "OT-3", estado: "en_cola", estadoAprobacion: "aprobada", recepcion: {}, aprobadaEn: at(2)},
    {otId: "e", numeroOT: "OT-4", estado: "en_reparacion", estadoAprobacion: "aprobada", recepcion: {}, responsableUid: "tec", actualizadoEn: at(1)},
    {otId: "f", numeroOT: "OT-5", estado: "en_reparacion", estadoAprobacion: "aprobada", recepcion: {}, responsableUid: "otro", actualizadoEn: at(3)},
    {otId: "s", numeroOT: "OT-8", estado: "en_reparacion", estadoAprobacion: "aprobada", recepcion: {}, actualizadoEn: at(30)},
    {otId: "l", numeroOT: "OT-6", estado: "pendiente_entrega", estadoAprobacion: "aprobada", recepcion: {}, responsableUid: "tec", actualizadoEn: at(60)},
    {otId: "c", numeroOT: "OT-7", estado: "cerrada", recepcion: {}, responsableUid: "tec", actualizadoEn: at(1)},
    {otId: "x", numeroOT: "OT-9", estado: "cerrada", recepcion: {}, actualizadoEn: at(40)},
  ];
  const services = new Map([
    ["e", [{estado: "completado"}, {estado: "en_progreso", itemId: "frenos", actualizadoEn: at(1)}]],
    ["f", [{estado: "completado", actualizadoEn: at(3)}]],
    ["s", [{estado: "pendiente", actualizadoEn: at(26)}]],
  ]);
  assert.deepEqual(home.workshopHomeTiles(orders, services, now),
    {porAprobar: 1, enReparacion: 3, enCola: 1, listos: 1});
  assert.deepEqual(home.workshopHeadline(orders), {enTaller: 5, enCola: 1, listos: 1});
  assert.deepEqual(home.workOrdersForView(orders, "por-aprobar", now).map((order) => order.otId), ["a"]);
  assert.equal(home.WORKSHOP_HOME_VIEWS["entregados-hoy"], undefined, "sin «Entregados hoy» por decisión del usuario");
  assert.equal(home.WORKSHOP_HOME_VIEWS["por-recibir"], undefined, "una OT sin recepción no cuenta en el panel");
  assert.equal(home.workOrdersForView(orders, "inexistente", now).length, orders.length, "una vista desconocida no filtra");
  const attention = home.workshopAttentionItems({orders, servicesByOrder: services, now,
    findingsByOrder: new Map([["e", [{urgente: true, convertido: false, creadoEn: now.getTime() - hour}, {urgente: true, convertido: true}]],
      ["f", [{urgente: false}]]])});
  assert.deepEqual(attention.map((item) => item.kind), ["hallazgo", "retiro", "detenido", "aprobar", "finalizar", "cola"],
    "hallazgos urgentes primero; el resto del más antiguo al más reciente");
  assert.equal(attention[0].detail, "OT-4 · informar al cliente");
  assert.equal(attention.find((item) => item.kind === "detenido").detail, "OT-8 · revisar con el responsable");
  assert.equal(attention.find((item) => item.kind === "finalizar").detail, "OT-5 terminó todos sus trabajos");
  assert.equal(attention.at(-1).to, "/taller/plazas");
  assert.deepEqual(home.workshopAttentionItems({orders: [], now}), []);
  // Stock: avisa en o bajo el mínimo y también cerca de él (hasta 20 %, mínimo 1 unidad); sin mínimo no avisa.
  const catalog = [
    {tipoItem: "producto", nombre: "Pastillas delanteras", stock: 6, stockMinimo: 6},
    {tipoItem: "producto", nombre: "Bujes de parrilla", stock: 1, stockMinimo: 4},
    {tipoItem: "producto", nombre: "Filtro", stock: 20, stockMinimo: 5},
    {tipoItem: "producto", nombre: "Aceite", stock: 6, stockMinimo: 5},
    {tipoItem: "producto", nombre: "Bujías", stock: 7, stockMinimo: 5},
    {tipoItem: "producto", nombre: "Líquido", stock: 24, stockMinimo: 20},
    {tipoItem: "producto", nombre: "Correa", stock: 25, stockMinimo: 20},
    {tipoItem: "producto", nombre: "Sin mínimo", stock: 0, stockMinimo: null},
    {tipoItem: "servicio", nombre: "Alineación", stock: null, stockMinimo: null},
  ];
  assert.equal(home.stockNearLimit(5), 6);
  assert.equal(home.stockNearLimit(20), 24);
  assert.equal(home.stockNearLimit(1), 2);
  const lowItems = home.lowStockItems(catalog);
  assert.deepEqual(lowItems.map((item) => [item.nombre, item.nivel]), [
    ["Bujes de parrilla", "bajo"], ["Pastillas delanteras", "bajo"], ["Aceite", "cercano"], ["Líquido", "cercano"]]);
  assert.deepEqual(home.lowStockAttention(catalog), {tone: "info", kind: "stock", title: "Stock bajo en 4 repuestos",
    detail: "Bujes de parrilla (1 de mín. 4) · Pastillas delanteras (6 de mín. 6) · Aceite (6 de mín. 5) · y 1 más", to: "/inventario", since: 0});
  assert.equal(home.lowStockAttention([catalog[2]]), null);
  assert.equal(home.lowStockAttention([catalog[4]]), null, "7 con mínimo 5: aún lejos");
  assert.equal(home.lowStockAttention([catalog[3]]).title, "Stock cerca del mínimo", "solo cercanos: no dice «bajo»");
  assert.match(home.lowStockAttention(Array.from({length: 5}, (_, index) => ({tipoItem: "producto", nombre: `R${index}`, stock: 0, stockMinimo: 1}))).detail,
    /y 2 más$/);
  assert.equal(home.elapsedLabel(0, now), "", "sin antigüedad no se muestra «hace…»");
  assert.equal(home.elapsedLabel(now.getTime() - 30 * 1000, now), "recién");
  assert.equal(home.elapsedLabel(now.getTime() - 5 * 60 * 1000, now), "hace 5 min");
  assert.equal(home.elapsedLabel(now.getTime() - 3 * hour, now), "hace 3 h");
  assert.equal(home.elapsedLabel(now.getTime() - 26 * hour, now), "hace 1 día");
  assert.equal(home.elapsedLabel(now.getTime() - 60 * hour, now), "hace 2 días");
  const today = new Date(2026, 10, 25, 9, 0).getTime();
  const activity = home.workshopTodayActivity([{otId: "x", actualizadoEn: ts(today)}, {otId: "y", actualizadoEn: ts(today + 1000)},
    {otId: "z", actualizadoEn: ts(new Date(2026, 10, 24, 23, 0).getTime())}], now);
  assert.deepEqual(activity.map((order) => order.otId), ["y", "x"]);
  const mine = home.technicianWorkOrders(orders, "tec");
  assert.deepEqual(mine.map((order) => order.otId), ["e", "l"], "solo OT abiertas a su cargo");
  assert.deepEqual(home.technicianWorkOrders(orders, ""), []);
  assert.equal(home.technicianPendingWorks(mine, services), 1);
  assert.equal(home.nextPendingWork(services.get("e")).itemId, "frenos", "el trabajo en curso va antes que los pendientes");
  assert.equal(home.nextPendingWork([{estado: "completado"}]), null);
  assert.equal(home.workshopGreeting(new Date(2026, 0, 1, 9)), "Buenos días");
  assert.equal(home.workshopGreeting(new Date(2026, 0, 1, 15)), "Buenas tardes");
  assert.equal(home.workshopGreeting(new Date(2026, 0, 1, 21)), "Buenas noches");
  // Saludo con nombre y apellido del perfil; sin ambos se conserva el saludo actual (cadena vacía).
  assert.equal(home.greetingPersonName({nombres: "Matías Andrés", apellidos: "Alamos Soto"}), "Matías Alamos");
  assert.equal(home.greetingPersonName({nombres: "Matías", apellidos: ""}), "");
  assert.equal(home.greetingPersonName({nombres: "", apellidos: "Alamos"}), "");
  assert.equal(home.greetingPersonName(null), "");
}
console.log("OK Panel del taller: indicadores, vistas, atención por antigüedad, detenidos, actividad y técnico");
console.log("WORK_ORDER_MODEL_SMOKE_OK");

// Ejecución: responsable por OT, repuestos definidos y requisitos para finalizar (cliente y servidor coinciden).
{
  const {
    canOperateOrderWorks, executionRequirements, getPartsSourceLabel, receptionSummary, worksPartsDefined, workProgress,
  } = await import("../src/domain/workOrderExecutionModel.mjs");
  const persistence = require("../functions/workOrderPersistence.js");
  const order = {responsableUid: "tec-1"};
  assert.equal(canOperateOrderWorks({canManage: false, canOperate: true, order, uid: "tec-1"}), true);
  assert.equal(canOperateOrderWorks({canManage: false, canOperate: true, order, uid: "tec-2"}), false);
  assert.equal(canOperateOrderWorks({canManage: true, canOperate: true, order, uid: "admin"}), true);
  assert.equal(canOperateOrderWorks({canManage: true, canOperate: false, order, uid: "admin"}), false);
  assert.equal(canOperateOrderWorks({canManage: false, canOperate: true, order: {}, uid: "tec-2"}), true, "OT sin responsable (anterior)");
  // Mismo criterio en el servidor.
  const operator = {rol: "TECNICO"};
  const manager = {rol: "ADMIN"};
  assert.equal(persistence.canOperateWorks(operator, order, "tec-1"), true);
  assert.equal(persistence.canOperateWorks(operator, order, "tec-2"), false);
  assert.equal(persistence.canOperateWorks(manager, order, "otro"), true);
  assert.equal(persistence.canOperateWorks(operator, {}, "tec-2"), true);
  assert.throws(() => persistence.assertWorkOperator(operator, order, "tec-2", TestHttpsError),
    (error) => error.code === "permission-denied" && /Solo el responsable de la OT/.test(error.message));
  // Repuestos definidos: del inventario, del cliente o ninguno.
  assert.equal(worksPartsDefined({productos: []}), false);
  assert.equal(worksPartsDefined({productos: [{productoOtId: "p1"}]}), true);
  assert.equal(worksPartsDefined({repuestosModo: "cliente"}), true);
  assert.equal(worksPartsDefined({repuestosModo: "ninguno"}), true);
  assert.equal(worksPartsDefined({repuestosModo: "otro"}), false);
  assert.equal(getPartsSourceLabel({repuestosModo: "cliente"}), "Repuestos del cliente");
  assert.equal(getPartsSourceLabel({repuestosModo: "ninguno"}), "No requiere repuestos");
  assert.equal(getPartsSourceLabel({productos: [{productoOtId: "p1"}]}), "Del inventario");
  assert.deepEqual(workProgress([{estado: "completado"}, {estado: "pendiente"}]), {done: 1, total: 2, complete: false});
  assert.equal(workProgress([]).complete, false);
  assert.deepEqual(executionRequirements([]).map((item) => item.done), [false, false]);
  assert.deepEqual(executionRequirements([{estado: "completado"}]).map((item) => item.done), [true, true]);
  const summary = receptionSummary({recepcion: {motivoCliente: "Ruido", kilometraje: 120000, nivelCombustible: "1/2",
    testigosEncendidos: true, testigos: ["abs"]},
  fotosRecepcion: {delantera: {hash: "h", conDanos: true, marcas: [{x: 0.1, y: 0.2, nota: "Rayón"}]}, tablero: {hash: "t"}}});
  assert.equal(summary.fotosSelladas, 2);
  assert.deepEqual(summary.previousDamages, [{zona: "Delantera", notas: ["Rayón"]}]);
  assert.equal(summary.kilometraje, 120000);
  // Historial de los eventos nuevos.
  assert.match(getWorkOrderHistoryDetail({tipo: "servicio_ot_repuestos_definidos", detalle: {modo: "cliente"}}), /trae el cliente/);
  assert.match(getWorkOrderHistoryDetail({tipo: "foto_servicio_registrada", detalle: {momento: "despues"}}), /después/);
  assert.match(getWorkOrderHistoryDetail({tipo: "ot_aprobada", detalle: {responsableNombre: "Ana Soto"}}), /Responsable: Ana Soto/);
}
