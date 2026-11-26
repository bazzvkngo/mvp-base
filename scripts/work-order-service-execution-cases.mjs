import assert from "node:assert/strict";
import {doc, getDoc, setDoc} from "firebase/firestore";

export async function testServiceExecution({adminDb, businessId, otId, serviceId, owner, admin, technician,
  member, outsider, callable, expectCallableError, expectFirestoreDenied, runId}) {
  const base = `negocios/${businessId}`;
  const orderRef = adminDb.doc(`${base}/ordenesTrabajo/${otId}`);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const requestCollection = adminDb.collection(`${base}/otServiceExecutionRequests`);
  const readService = async () => (await serviceRef.get()).data();
  const readOrder = async () => (await orderRef.get()).data();
  const readEvents = async () => (await orderRef.collection("historial").get()).docs.map((item) => item.data());
  let count = 0;
  const requestId = () => `service-execution-${runId}-${++count}`;
  const payload = async (extra = {}) => ({businessId, otId, servicioOtId: serviceId,
    expectedActualizadoEn: (await readService()).actualizadoEn.toMillis(), requestId: requestId(), ...extra});
  const call = (client, name, input) => callable(client, name)(input);
  const reject = (label, client, name, input, codes = ["failed-precondition"]) =>
    expectCallableError(label, () => call(client, name, input), codes);

  const order = await readOrder();
  if (order.estadoAprobacion === "rechazada") {
    await call(owner, "enviarOTAprobacion", {businessId, otId, requestId: requestId(),
      expectedActualizadoEn: order.actualizadoEn.toMillis()});
    const pending = await readOrder();
    await call(admin, "aprobarOT", {businessId, otId, requestId: requestId(), responsableUid: technician.uid,
      expectedActualizadoEn: pending.actualizadoEn.toMillis()});
  }
  assert.equal((await readOrder()).estado, "en_reparacion");
  assert.equal((await readOrder()).estadoAprobacion, "aprobada");
  assert.equal((await readService()).estado, "pendiente");
  const stockBefore = (await adminDb.doc(`${base}/inventario/producto-core`).get()).data().stock;

  await reject("sin salto de pendiente a completado", technician, "completarServicioOT", await payload());
  await reject("sin cambios de estado suministrados por frontend", owner, "iniciarServicioOT",
    await payload({estado: "completado"}), ["invalid-argument"]);
  await reject("OT de otro negocio", outsider, "iniciarServicioOT", await payload(), ["permission-denied"]);
  await reject("revisión obsoleta", owner, "iniciarServicioOT",
    await payload({expectedActualizadoEn: 1}), ["aborted"]);
  const memberRef = adminDb.doc(`membresias/${businessId}__${member.uid}`);
  await memberRef.update({rol: "VENTAS"});
  await reject("rol sin operación de Taller", member, "iniciarServicioOT", await payload(), ["permission-denied"]);
  await memberRef.update({rol: "MEMBER"});
  // Solo el responsable de la OT (elegido al aprobar), el Administrador o el Owner operan los trabajos.
  assert.equal((await readOrder()).responsableUid, technician.uid);
  await reject("quien no es el responsable no opera", member, "iniciarServicioOT", await payload(), ["permission-denied"]);
  const firstOrder = await readOrder();
  await orderRef.update({estado: "esperando_repuestos"});
  await reject("OT fuera de reparación", owner, "iniciarServicioOT", await payload());
  await orderRef.update({estado: "en_reparacion", estadoAprobacion: "pendiente"});
  await reject("OT sin aprobación vigente", owner, "iniciarServicioOT", await payload());
  await orderRef.update({estadoAprobacion: "aprobada"});
  assert.equal(firstOrder.estado, "en_reparacion");

  const startInput = await payload();
  const competingStart = {...startInput, requestId: requestId()};
  const starts = await Promise.allSettled([
    call(technician, "iniciarServicioOT", startInput),
    call(owner, "iniciarServicioOT", competingStart),
  ]);
  assert.equal(starts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(starts.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await readService()).estado, "en_progreso");
  const winningStart = starts[0].status === "fulfilled" ? {client: technician, input: startInput} : {client: owner, input: competingStart};
  assert.equal((await call(winningStart.client, "iniciarServicioOT", winningStart.input)).data.sinCambios, true);
  await reject("requestId no reutilizable con otros datos", winningStart.client, "iniciarServicioOT",
    {...winningStart.input, expectedActualizadoEn: 1}, ["already-exists"]);
  await reject("servicio iniciado no se inicia otra vez", owner, "iniciarServicioOT", await payload());
  await reject("servicio iniciado no se edita ordinariamente", owner, "actualizarServicioOT", {
    businessId, otId, servicioOtId: serviceId,
    servicio: {itemId: (await readService()).itemId},
    expectedActualizadoEn: (await readService()).actualizadoEn.toMillis(),
  });
  assert.equal((await readOrder()).estado, "en_reparacion");
  assert.equal((await readOrder()).estadoAprobacion, "aprobada");

  // Un trabajo solo se termina con sus repuestos definidos (del inventario, del cliente o ninguno).
  await reject("terminar sin repuestos definidos", technician, "completarServicioOT", await payload());
  await reject("repuestos: solo cliente o ninguno", technician, "definirRepuestosServicioOT",
    {businessId, otId, servicioOtId: serviceId, modo: "otro", expectedActualizadoEn: (await readService()).actualizadoEn.toMillis()},
    ["invalid-argument"]);
  await reject("repuestos: quien no es el responsable no los define", member, "definirRepuestosServicioOT",
    {businessId, otId, servicioOtId: serviceId, modo: "cliente", expectedActualizadoEn: (await readService()).actualizadoEn.toMillis()},
    ["permission-denied"]);
  await call(technician, "definirRepuestosServicioOT", {businessId, otId, servicioOtId: serviceId, modo: "cliente",
    expectedActualizadoEn: (await readService()).actualizadoEn.toMillis()});
  assert.equal((await readService()).repuestosModo, "cliente");
  await call(technician, "definirRepuestosServicioOT", {businessId, otId, servicioOtId: serviceId, modo: "ninguno",
    expectedActualizadoEn: (await readService()).actualizadoEn.toMillis()});
  assert.equal((await readService()).repuestosModo, "ninguno");
  const completeInput = await payload();
  const complete = await call(technician, "completarServicioOT", completeInput);
  assert.equal(complete.data.estado, "completado");
  assert.equal((await call(technician, "completarServicioOT", completeInput)).data.sinCambios, true);
  await reject("servicio completado no vuelve a completarse", owner, "completarServicioOT", await payload());
  await reject("servicio completado no vuelve a iniciarse", owner, "iniciarServicioOT", await payload());
  const stored = await readService();
  assert.equal(stored.estado, "completado");
  assert.equal(stored.actualizadoPorUid, technician.uid);
  assert.ok(stored.actualizadoEn?.toDate());
  const executionEvents = (await readEvents()).filter((event) =>
    ["servicio_ot_iniciado", "servicio_ot_completado"].includes(event.tipo) &&
    event.detalle.servicioOtId === serviceId);
  assert.deepEqual(executionEvents.map((event) => event.tipo).sort(),
    ["servicio_ot_iniciado", "servicio_ot_completado"].sort());
  assert.ok(executionEvents.every((event) => event.fecha?.toDate() && event.actorUid &&
    event.actorSnapshot?.correo && event.detalle?.itemId));
  assert.equal((await adminDb.doc(`${base}/inventario/producto-core`).get()).data().stock, stockBefore);
  // Un trabajo terminado se cierra: solo el Owner o el Administrador lo reabren; luego se termina de nuevo.
  await reject("el técnico no reabre un trabajo", technician, "reabrirServicioOT", await payload(), ["permission-denied"]);
  await reject("no se cambian repuestos de un trabajo terminado", technician, "definirRepuestosServicioOT",
    {businessId, otId, servicioOtId: serviceId, modo: "cliente", expectedActualizadoEn: (await readService()).actualizadoEn.toMillis()});
  await reject("no se agregan repuestos a un trabajo terminado", technician, "agregarProductoOT",
    {businessId, otId, servicioOtId: serviceId, itemId: "producto-core", cantidad: 1, requestId: requestId()});
  const reopenInput = await payload();
  assert.equal((await call(admin, "reabrirServicioOT", reopenInput)).data.estado, "en_progreso");
  assert.equal((await call(admin, "reabrirServicioOT", reopenInput)).data.sinCambios, true);
  await reject("solo se reabre un trabajo terminado", admin, "reabrirServicioOT", await payload());
  assert.equal((await call(technician, "completarServicioOT", await payload())).data.estado, "completado");
  const reopenEvents = (await readEvents()).filter((event) => event.tipo === "servicio_ot_reabierto");
  assert.equal(reopenEvents.length, 1);
  await expectFirestoreDenied("SDK no lee requests de ejecución", () =>
    getDoc(doc(owner.db, `${requestCollection.path}/${winningStart.input.requestId}`)));
  await expectFirestoreDenied("SDK no escribe requests de ejecución", () =>
    setDoc(doc(owner.db, `${requestCollection.path}/directo`), {negocioId: businessId}));
  console.log("WORK_ORDER_SERVICE_EXECUTION_OK: secuencia, permisos, auditoría, reintento, concurrencia y stock intacto");
}
