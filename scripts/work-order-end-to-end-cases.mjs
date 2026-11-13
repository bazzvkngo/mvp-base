import assert from "node:assert/strict";
import {collection, getDocs, query, where} from "firebase/firestore";
import {buildClientMutationPayload} from "../src/domain/clientModel.mjs";

// The continuous lifecycle uses only catalog fixtures and public Functions for transitions.
// Separate terminal regressions at the end use legacy fixtures, not a simulated cancellation action.
export async function testWorkOrderEndToEnd({adminDb, businessId, owner, technician,
  callable, expectCallableError, reception, runId}) {
  const base = `negocios/${businessId}`;
  let sequence = 0;
  const id = () => `e2e-${runId}-${++sequence}`;
  const call = async (client, name, input) => (await callable(client, name)({businessId, ...input})).data;
  const cliente = buildClientMutationPayload({tipoCliente: "persona", rut: "12.345.678-5",
    nombreRazonSocial: "Cliente recorrido completo", email: "recorrido@example.test",
    telefono: "+56 9 1234 5678", direccion: "Av. Principal 123", regionCodigo: "13",
    comunaCodigo: "13101", giro: "", notas: "Prueba aislada de integración"});
  const clienteId = (await call(owner, "crearCliente", {cliente})).cliente.clienteId;
  const vehicleInput = {requestId: id(), vehiculo: {clienteId, patente: "ZX-CV-12", vin: "",
    marca: "Toyota", modelo: "Corolla", anio: 2020, color: "Blanco", tipo: "sedan"}};
  const vehicle = (await call(technician, "crearVehiculo", vehicleInput)).vehiculo;
  assert.equal(vehicle.patente, "ZXCV12");
  assert.equal(vehicle.vin, null);
  assert.equal((await call(technician, "crearVehiculo", vehicleInput)).sinCambios, true);
  await expectCallableError("E2E patente duplicada", () => call(owner, "crearVehiculo",
    {...vehicleInput, requestId: id()}), ["already-exists"]);

  const create = {requestId: id(), ordenTrabajo: {vehiculoId: vehicle.vehiculoId}};
  const created = (await call(technician, "crearOrdenTrabajo", create)).ordenTrabajo;
  const otId = created.otId;
  assert.match(created.numeroOT, /^OT-\d{6,}$/);
  assert.equal(created.estado, "ingresada");
  assert.equal(created.estadoAprobacion, "pendiente");
  assert.equal((await call(technician, "crearOrdenTrabajo", create)).sinCambios, true);
  const orderRef = adminDb.doc(`${base}/ordenesTrabajo/${otId}`);
  const order = async () => (await orderRef.get()).data();
  const revision = async (ref) => (await ref.get()).data().actualizadoEn.toMillis();
  const action = async (name, client = technician) => call(client, name,
    {otId, requestId: id(), expectedActualizadoEn: await revision(orderRef)});
  await call(owner, "cambiarPropietarioVehiculo", {vehiculoId: vehicle.vehiculoId, clienteId: "cliente-b"});
  assert.equal((await order()).clienteId, clienteId, "La OT no sigue al propietario actual");
  await call(technician, "registrarRecepcionOrdenTrabajo", {otId, recepcion: reception});
  assert.equal((await order()).estado, "en_cola");
  const plazaId = (await call(owner, "crearPlazaTaller", {requestId: id(), plaza: {nombre: "Plaza E2E"}})).plaza.plazaId;
  await call(technician, "asignarPlazaOT", {otId, plazaId, expectedActualizadoEn: await revision(orderRef)});
  assert.equal((await order()).estado, "en_diagnostico");
  const diagnostico = {responsableUid: technician.uid, descripcion: "Reemplazo de filtro", observaciones: ""};
  const diagnosticoId = (await call(technician, "registrarDiagnostico", {otId, requestId: id(), diagnostico})).diagnosticoId;
  const diagnosisRef = orderRef.collection("diagnosticos").doc(diagnosticoId);
  assert.equal((await diagnosisRef.get()).data().estado, "borrador");
  await call(technician, "completarDiagnostico", {otId, diagnosticoId, expectedActualizadoEn: await revision(diagnosisRef)});
  await expectCallableError("E2E diagnóstico completado no editable", async () => call(technician, "actualizarDiagnostico",
    {otId, diagnosticoId, diagnostico, expectedActualizadoEn: await revision(diagnosisRef)}), ["failed-precondition"]);

  const serviceItemId = id();
  const productItemId = id();
  const itemRef = adminDb.doc(`${base}/inventario/${productItemId}`);
  await adminDb.doc(`${base}/inventario/${serviceItemId}`).set({negocioId: businessId,
    tipoItem: "servicio", estado: "activo", nombre: "Servicio E2E", precioInterno: 5000, unidad: "servicio"});
  await itemRef.set({negocioId: businessId, tipoItem: "producto", estado: "activo",
    nombre: "Filtro E2E", precioInterno: 1000, unidad: "unidad", stock: 10, costoBase: 100, moneda: "CLP"});
  const stock = async () => (await itemRef.get()).data();
  const servicioOtId = (await call(technician, "crearServicioOT", {otId, requestId: id(),
    servicio: {itemId: serviceItemId, responsableUid: technician.uid}})).servicioOtId;
  const serviceRef = orderRef.collection("servicios").doc(servicioOtId);
  await call(technician, "agregarProductoOT", {otId, servicioOtId, itemId: productItemId, cantidad: 2, requestId: id()});
  assert.equal((await stock()).stock, 10);
  await action("enviarOTAprobacion");
  assert.equal((await order()).estado, "esperando_aprobacion");
  await action("aprobarOT", owner);
  assert.equal((await order()).estado, "en_reparacion");
  assert.equal((await order()).estadoAprobacion, "aprobada");
  assert.equal((await stock()).stock, 10, "Aprobar no reserva ni descuenta stock");
  const frozen = (await serviceRef.get()).data();
  assert.equal(frozen.precioUnitario, 5000);
  assert.equal(frozen.productos[0].precioUnitario, 1000);
  // A subsequent Core catalog change cannot rewrite approved history.
  await itemRef.update({precioInterno: 2000, nombre: "Filtro renombrado"});
  await call(technician, "iniciarServicioOT", {otId, servicioOtId, requestId: id(),
    expectedActualizadoEn: await revision(serviceRef)});
  assert.deepEqual((await serviceRef.get()).data().productos, frozen.productos);
  const salesBefore = (await adminDb.collection(`${base}/ventas`).get()).size;
  await call(technician, "completarServicioOT", {otId, servicioOtId, requestId: id(),
    expectedActualizadoEn: await revision(serviceRef)});
  await action("finalizarReparacionOT");
  assert.equal((await order()).estado, "pendiente_entrega");
  await action("registrarEntregaOT");
  assert.equal((await order()).estado, "cerrada");
  assert.equal((await order()).plazaId, null);
  assert.equal((await adminDb.doc(`${base}/plazaOccupancyKeys/${plazaId}`).get()).exists, false);
  assert.equal((await stock()).stock, 10, "Planificar, ejecutar y entregar no modifican stock");
  assert.equal((await adminDb.collection(`${base}/movimientosInventario`).where("otId", "==", otId).get()).size, 0,
    "Taller no genera movimientos físicos mientras espera el mecanismo único de Core");
  assert.equal((await adminDb.collection(`${base}/ventas`).get()).size, salesBefore);
  const listed = await getDocs(query(collection(technician.db, `${base}/ordenesTrabajo`),
    where("negocioId", "==", businessId), where("vehiculoId", "==", vehicle.vehiculoId)));
  assert.equal(listed.size, 1);
  assert.equal(listed.docs[0].data().clienteId, clienteId);
  assert.equal(listed.docs[0].data().estado, "cerrada");
  const history = (await call(technician, "obtenerHistorialOT", {otId})).eventos;
  for (const type of ["ot_creada", "recepcion_registrada", "plaza_asignada", "diagnostico_creado",
    "diagnostico_completado", "servicio_ot_creado", "producto_ot_agregar", "ot_enviada_aprobacion", "ot_aprobada",
    "servicio_ot_iniciado", "servicio_ot_completado",
    "reparacion_finalizada", "vehiculo_entregado"]) {
    assert.equal(history.filter((event) => event.tipo === type).length, 1, `Evento E2E: ${type}`);
  }
  assert.ok(history.every((event) => event.actorNombre && Number.isSafeInteger(event.fecha)));
  await expectCallableError("E2E cerrada no admite liberar Plaza", async () => call(owner, "liberarPlazaOT",
    {otId, expectedActualizadoEn: await revision(orderRef)}), ["failed-precondition"]);
  console.log("WORK_ORDER_END_TO_END_OK: Cliente Core → Vehículo → OT → recepción → Plaza → diagnóstico → aprobación → planificación → entrega");

  // Separate legacy fixtures prove that terminal records retaining a Plaza cannot be altered.
  for (const estado of ["cerrada", "cancelada"]) {
    const legacyRef = adminDb.collection(`${base}/ordenesTrabajo`).doc(id());
    const legacy = {...await order(), otId: legacyRef.id, estado, plazaId};
    await legacyRef.set(legacy);
    await expectCallableError(`Plaza legacy terminal ${estado}`, () => call(owner, "liberarPlazaOT",
      {otId: legacyRef.id, expectedActualizadoEn: legacy.actualizadoEn.toMillis()}), ["failed-precondition"]);
    assert.deepEqual((await legacyRef.get()).data(), legacy);
    assert.equal((await legacyRef.collection("historial").get()).size, 0);
  }
}
