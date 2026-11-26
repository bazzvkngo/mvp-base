import assert from "node:assert/strict";
import {completeDeliveryPhotos, deliveryInput} from "./work-order-delivery-fixtures.mjs";
import {collection, getDocs, query, where} from "firebase/firestore";
import {buildClientMutationPayload} from "../src/domain/clientModel.mjs";
import {completeReceptionPhotos} from "./work-order-photo-fixtures.mjs";

// The continuous lifecycle uses only catalog fixtures and public Functions for transitions.
// Separate terminal regressions at the end use legacy fixtures, not a simulated cancellation action.
export async function testWorkOrderEndToEnd({adminDb, businessId, owner, technician, anonymous,
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
  await expectCallableError("E2E recepción sin fotos", () => call(technician, "registrarRecepcionOrdenTrabajo",
    {otId, recepcion: reception}), ["failed-precondition"], /Faltan fotos de recepción/);
  await completeReceptionPhotos(orderRef);
  await call(technician, "registrarRecepcionOrdenTrabajo", {otId, recepcion: reception});
  assert.equal((await order()).estado, "en_cola");
  const plazaId = (await call(owner, "crearPlazaTaller", {requestId: id(), plaza: {nombre: "Plaza E2E"}})).plaza.plazaId;
  await call(technician, "asignarPlazaOT", {otId, plazaId, expectedActualizadoEn: await revision(orderRef)});
  assert.equal((await order()).estado, "en_diagnostico");
  // El diagnóstico ya no es parte del flujo visible ni requisito: Recepción → Aprobación → Ejecución → Entrega.

  const serviceItemId = id();
  const productItemId = id();
  const itemRef = adminDb.doc(`${base}/inventario/${productItemId}`);
  await adminDb.doc(`${base}/inventario/${serviceItemId}`).set({negocioId: businessId,
    tipoItem: "servicio", estado: "activo", nombre: "Servicio E2E", precioInterno: 5000, unidad: "servicio"});
  await itemRef.set({negocioId: businessId, tipoItem: "producto", estado: "activo",
    nombre: "Filtro E2E", precioInterno: 1000, unidad: "unidad", stock: 10, costoBase: 100, moneda: "CLP"});
  const stock = async () => (await itemRef.get()).data();
  // Los trabajos se registran en la ejecución: antes de aprobar el ingreso el servidor los rechaza.
  await expectCallableError("E2E trabajos antes de aprobar", () => call(technician, "crearServicioOT", {otId, requestId: id(),
    servicio: {itemId: serviceItemId}}), ["failed-precondition"]);
  await expectCallableError("E2E enviar a aprobación ya no existe", () => action("enviarOTAprobacion", owner), ["failed-precondition"]);
  await expectCallableError("E2E el técnico no aprueba", () => action("aprobarOT"), ["permission-denied"]);
  await call(owner, "aprobarOT", {otId, requestId: id(), responsableUid: technician.uid,
    expectedActualizadoEn: await revision(orderRef)});
  assert.equal((await order()).responsableUid, technician.uid);
  assert.equal((await order()).estado, "en_reparacion");
  assert.equal((await order()).estadoAprobacion, "aprobada");
  const servicioOtId = (await call(technician, "crearServicioOT", {otId, requestId: id(),
    servicio: {itemId: serviceItemId}})).servicioOtId;
  const serviceRef = orderRef.collection("servicios").doc(servicioOtId);
  await call(technician, "agregarProductoOT", {otId, servicioOtId, itemId: productItemId, cantidad: 2, requestId: id()});
  assert.equal((await order()).estadoAprobacion, "aprobada", "Agregar trabajos no invalida la aprobación");
  assert.equal((await stock()).stock, 10, "Aprobar y planificar no reservan ni descuentan stock");
  assert.equal((await serviceRef.get()).data().precioUnitario, null, "Antes de finalizar no hay precios congelados");
  await call(technician, "iniciarServicioOT", {otId, servicioOtId, requestId: id(),
    expectedActualizadoEn: await revision(serviceRef)});
  const salesBefore = (await adminDb.collection(`${base}/ventas`).get()).size;
  // Un trabajo solo se termina con los repuestos definidos; aquí tiene repuestos del inventario.
  await call(technician, "completarServicioOT", {otId, servicioOtId, requestId: id(),
    expectedActualizadoEn: await revision(serviceRef)});
  // Finalizar la ejecución es del Owner o del Administrador, no del responsable técnico.
  await expectCallableError("E2E el técnico no finaliza la ejecución", () => action("finalizarReparacionOT"), ["permission-denied"]);
  await action("finalizarReparacionOT", owner);
  assert.equal((await order()).estado, "pendiente_entrega");
  // Los precios se congelan al finalizar (envío a Ventas) y el taller no los muestra.
  const frozen = (await serviceRef.get()).data();
  assert.equal(frozen.precioUnitario, 5000);
  assert.equal(frozen.productos[0].precioUnitario, 1000);
  assert.ok((await order()).moneda, "La OT guarda la moneda al finalizar");
  // Un cambio posterior del catálogo Core no reescribe el historial congelado.
  await itemRef.update({precioInterno: 2000, nombre: "Filtro renombrado"});
  assert.deepEqual((await serviceRef.get()).data().productos, frozen.productos);
  await completeDeliveryPhotos(orderRef);
  // Seguimiento del cliente: el enlace funciona hasta confirmar la entrega y se inactiva en la misma transacción.
  const tracking = await call(technician, "seguimientoOT", {otId, operacion: "enlace"});
  const trackingToken = tracking.url.split("/").pop();
  assert.equal((await callable(anonymous, "consultarSeguimientoTaller")({token: trackingToken})).data.seguimiento.etapa.clave, "listo");
  await call(technician, "registrarEntregaOT", {otId, requestId: id(), expectedActualizadoEn: await revision(orderRef), ...deliveryInput()});
  assert.equal((await order()).estado, "cerrada");
  const trackingHash = (await orderRef.collection("seguimiento").doc("enlace").get()).data().tokenHash;
  const trackingTokenDoc = (await adminDb.doc(`tallerSeguimientoTokens/${trackingHash}`).get()).data();
  assert.equal(trackingTokenDoc.estado, "inactivo", "La entrega inactiva el enlace de seguimiento");
  assert.equal(trackingTokenDoc.motivoInactivacion, "entregada");
  await expectCallableError("E2E enlace inactivo tras la entrega", () => callable(anonymous, "consultarSeguimientoTaller")({token: trackingToken}), ["not-found"]);
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
  const history = (await call(owner, "obtenerHistorialOT", {otId})).eventos;
  for (const type of ["ot_creada", "recepcion_registrada", "plaza_asignada",
    "ot_aprobada", "servicio_ot_creado", "producto_ot_agregar",
    "servicio_ot_iniciado", "servicio_ot_completado",
    "reparacion_finalizada", "vehiculo_entregado"]) {
    assert.equal(history.filter((event) => event.tipo === type).length, 1, `Evento E2E: ${type}`);
  }
  assert.ok(history.every((event) => event.actorNombre && Number.isSafeInteger(event.fecha)));
  await expectCallableError("E2E cerrada no admite liberar Plaza", async () => call(owner, "liberarPlazaOT",
    {otId, expectedActualizadoEn: await revision(orderRef)}), ["failed-precondition"]);
  console.log("WORK_ORDER_END_TO_END_OK: Cliente Core → Vehículo → OT → recepción → Plaza → aprobación → ejecución → entrega");

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
