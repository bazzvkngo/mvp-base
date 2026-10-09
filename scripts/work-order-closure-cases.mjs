import assert from "node:assert/strict";
import {doc, getDoc, setDoc} from "firebase/firestore";

export async function testWorkOrderClosure({adminDb, businessId, otId, serviceId, owner, admin, technician,
  member, outsider, anonymous, callable, expectCallableError, expectFirestoreDenied, reception, runId}) {
  const base = `negocios/${businessId}`;
  const orderRef = adminDb.doc(`${base}/ordenesTrabajo/${otId}`);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const requests = adminDb.collection(`${base}/otClosureRequests`);
  const readOrder = async () => (await orderRef.get()).data();
  const closureEvents = async () => (await orderRef.collection("historial").get()).docs.map((entry) => entry.data())
    .filter((event) => ["reparacion_finalizada", "vehiculo_entregado"].includes(event.tipo));
  const call = (client, name, input) => callable(client, name)(input);
  let counter = 0;
  const id = () => `closure-${runId}-${++counter}`;
  const payload = async (extra = {}) => ({businessId, otId, requestId: id(),
    expectedActualizadoEn: (await readOrder()).actualizadoEn.toMillis(), ...extra});
  const reject = (label, client, name, input, codes = ["failed-precondition"]) =>
    expectCallableError(label, () => call(client, name, input), codes);

  assert.equal((await readOrder()).estado, "en_reparacion");
  assert.equal((await serviceRef.get()).data().estado, "completado");
  const activePlazas = (await adminDb.collection(`${base}/plazasTaller`).where("estado", "==", "activa").get()).docs;
  const activePlaza = (await Promise.all(activePlazas.map(async (plaza) => ({
    plaza,
    occupied: (await adminDb.doc(`${base}/plazaOccupancyKeys/${plaza.id}`).get()).exists,
  })))).find((entry) => !entry.occupied)?.plaza;
  assert.ok(activePlaza, "Se requiere una Plaza activa para comprobar su liberación al entregar.");
  await call(owner, "asignarPlazaOT", {
    businessId, otId, plazaId: activePlaza.id,
    expectedActualizadoEn: (await readOrder()).actualizadoEn.toMillis(),
  });
  const plazaLockRef = adminDb.doc(`${base}/plazaOccupancyKeys/${activePlaza.id}`);
  assert.equal((await readOrder()).plazaId, activePlaza.id);
  assert.equal((await plazaLockRef.get()).data().otId, otId);
  const pendingRef = orderRef.collection("servicios").doc(`pending-${runId}`);
  await pendingRef.set({...((await serviceRef.get()).data()), servicioOtId: pendingRef.id, estado: "pendiente"});
  await reject("servicio pendiente impide finalizar", owner, "finalizarReparacionOT", await payload());
  await pendingRef.update({estado: "en_progreso"});
  await reject("servicio en progreso impide finalizar", technician, "finalizarReparacionOT", await payload());
  await pendingRef.delete();
  for (const entry of (await orderRef.collection("servicios").get()).docs) {
    let service = entry.data();
    if (service.estado === "pendiente") {
      await call(technician, "iniciarServicioOT", {businessId, otId, servicioOtId: entry.id,
        requestId: id(), expectedActualizadoEn: service.actualizadoEn.toMillis()});
      service = (await entry.ref.get()).data();
    }
    if (service.estado === "en_progreso") {
      await call(technician, "completarServicioOT", {businessId, otId, servicioOtId: entry.id,
        requestId: id(), expectedActualizadoEn: service.actualizadoEn.toMillis()});
    }
  }
  assert.ok((await orderRef.collection("servicios").get()).docs.every((entry) => entry.data().estado === "completado"));
  await reject("no se entrega desde reparación", owner, "registrarEntregaOT", await payload());
  await reject("identidad requerida", anonymous, "finalizarReparacionOT", await payload(), ["unauthenticated"]);
  await reject("otro negocio no finaliza", outsider, "finalizarReparacionOT", await payload(), ["permission-denied"]);
  await reject("OT inexistente", owner, "finalizarReparacionOT", await payload({otId: "inexistente"}), ["not-found"]);
  await reject("estado no proviene del cliente", owner, "finalizarReparacionOT",
    await payload({estado: "cerrada"}), ["invalid-argument"]);
  await reject("revisión obsoleta", owner, "finalizarReparacionOT",
    await payload({expectedActualizadoEn: 1}), ["aborted"]);
  const memberRef = adminDb.doc(`membresias/${businessId}__${member.uid}`);
  await memberRef.update({rol: "VENTAS"});
  await reject("rol sin capacidad operacional", member, "finalizarReparacionOT", await payload(), ["permission-denied"]);
  await memberRef.update({rol: "MEMBER"});
  const initialSales = (await adminDb.collection(`${base}/ventas`).get()).size;
  const initialMovements = (await adminDb.collection(`${base}/movimientosInventario`).get()).size;
  const start = await payload();
  const competing = {...start, requestId: id()};
  const finals = await Promise.allSettled([
    call(owner, "finalizarReparacionOT", start), call(technician, "finalizarReparacionOT", competing),
  ]);
  assert.equal(finals.filter((entry) => entry.status === "fulfilled").length, 1,
    finals.map((entry) => entry.status === "rejected"
      ? `${entry.reason?.code}: ${entry.reason?.message}` : "fulfilled").join(" | "));
  const winner = finals[0].status === "fulfilled" ? {client: owner, input: start} : {client: technician, input: competing};
  assert.equal((await call(winner.client, "finalizarReparacionOT", winner.input)).data.sinCambios, true);
  assert.equal((await readOrder()).estado, "pendiente_entrega");
  assert.equal((await readOrder()).estadoAprobacion, "aprobada");
  await reject("finalizar dos veces", owner, "finalizarReparacionOT", await payload());
  await reject("requestId no se reutiliza", winner.client, "finalizarReparacionOT",
    {...winner.input, expectedActualizadoEn: 1}, ["already-exists"]);
  await reject("recepción no cambia tras finalizar", owner, "registrarRecepcionOrdenTrabajo",
    {businessId, otId, recepcion: reception});
  await reject("diagnóstico no se crea tras finalizar", owner, "registrarDiagnostico", {
    businessId, otId, requestId: id(),
    diagnostico: {responsableUid: owner.uid, descripcion: "Diagnóstico posterior al cierre", observaciones: ""},
  });
  const pendingEvents = await closureEvents();
  assert.deepEqual(pendingEvents.map((event) => event.tipo), ["reparacion_finalizada"]);
  assert.equal(pendingEvents[0].detalle.estadoAnterior, "en_reparacion");
  assert.ok(pendingEvents[0].actorUid && pendingEvents[0].actorSnapshot?.nombre && pendingEvents[0].fecha?.toDate());

  const delivery = await payload();
  const competingDelivery = {...delivery, requestId: id()};
  const deliveryRace = await Promise.allSettled([
    call(member, "registrarEntregaOT", delivery),
    call(admin, "registrarEntregaOT", competingDelivery),
  ]);
  assert.equal(deliveryRace.filter((entry) => entry.status === "fulfilled").length, 1);
  const deliveryWinner = deliveryRace[0].status === "fulfilled"
    ? {client: member, input: delivery}
    : {client: admin, input: competingDelivery};
  assert.equal((await call(deliveryWinner.client, "registrarEntregaOT", deliveryWinner.input)).data.sinCambios, true);
  assert.equal((await readOrder()).estado, "cerrada");
  assert.equal((await readOrder()).plazaId, null);
  assert.equal((await plazaLockRef.get()).exists, false);
  await reject("entrega terminal", owner, "registrarEntregaOT", await payload());
  await reject("no reabrir OT cerrada", owner, "finalizarReparacionOT", await payload());
  await reject("recepción cerrada es de solo lectura", owner, "registrarRecepcionOrdenTrabajo",
    {businessId, otId, recepcion: reception});
  const events = await closureEvents();
  assert.deepEqual(events.map((event) => event.tipo).sort(), ["reparacion_finalizada", "vehiculo_entregado"]);
  assert.ok(events.every((event) => event.actorUid && event.actorSnapshot?.nombre && event.fecha?.toDate() &&
    event.detalle.estadoAnterior && event.detalle.estado));
  assert.equal(events.find((event) => event.tipo === "vehiculo_entregado").detalle.plazaIdLiberada, activePlaza.id);
  const visible = (await call(technician, "obtenerEventosCierreOT", {businessId, otId})).data.eventos;
  assert.deepEqual(visible.map((event) => event.tipo), ["reparacion_finalizada", "vehiculo_entregado"]);
  assert.ok(visible.every((event) => Number.isSafeInteger(event.fecha) && event.actorNombre));
  await reject("historial cross-tenant", outsider, "obtenerEventosCierreOT", {businessId, otId}, ["permission-denied"]);
  await expectFirestoreDenied("SDK no lee requests de cierre", () => getDoc(doc(owner.db, `${requests.path}/${winner.input.requestId}`)));
  await expectFirestoreDenied("SDK no escribe requests de cierre", () => setDoc(doc(owner.db, `${requests.path}/directo`), {}));
  assert.equal((await adminDb.collection(`${base}/ventas`).get()).size, initialSales);
  assert.equal((await adminDb.collection(`${base}/movimientosInventario`).get()).size, initialMovements);
  console.log("WORK_ORDER_CLOSURE_OK: estados, servicios, permisos, concurrencia, idempotencia, auditoría y terminalidad");
}
