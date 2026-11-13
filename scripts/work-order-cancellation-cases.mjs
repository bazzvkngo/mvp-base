import assert from "node:assert/strict";
import {doc, getDoc, setDoc} from "firebase/firestore";

export async function testWorkOrderCancellation({adminDb, businessId, owner, technician, outsider,
  callable, expectCallableError, expectFirestoreDenied, reception, runId}) {
  const base = `negocios/${businessId}`;
  let sequence = 0;
  const id = () => `cancel-${runId}-${++sequence}`;
  const call = async (client, name, input) => (await callable(client, name)({businessId, ...input})).data;
  const createOrder = async () => (await call(owner, "crearOrdenTrabajo", {
    requestId: id(), ordenTrabajo: {vehiculoId: "vehiculo-a"},
  })).ordenTrabajo;
  const refFor = (otId) => adminDb.doc(`${base}/ordenesTrabajo/${otId}`);
  const read = async (otId) => (await refFor(otId).get()).data();
  const revision = async (otId) => (await read(otId)).actualizadoEn.toMillis();
  const cancelInput = async (otId, requestId = id()) => ({
    otId, requestId, expectedActualizadoEn: await revision(otId),
  });

  const entered = await createOrder();
  const firstInput = await cancelInput(entered.otId);
  const cancelled = await call(owner, "cancelarOT", firstInput);
  assert.equal(cancelled.estado, "cancelada");
  assert.equal(cancelled.estadoAprobacion, "pendiente");
  assert.equal(cancelled.plazaId, null);
  assert.equal((await call(owner, "cancelarOT", firstInput)).sinCambios, true);
  const cancelledStored = await read(entered.otId);
  assert.equal(cancelledStored.estado, "cancelada");
  assert.equal(cancelledStored.numeroOT, entered.numeroOT);
  const events = (await refFor(entered.otId).collection("historial").get()).docs.map((entry) => entry.data());
  const cancellation = events.find((event) => event.tipo === "ot_cancelada");
  assert.equal(cancellation.detalle.estadoAnterior, "ingresada");
  assert.equal(cancellation.detalle.estado, "cancelada");
  assert.ok(cancellation.actorUid === owner.uid && cancellation.actorSnapshot?.nombre && cancellation.fecha?.toDate());
  const visible = await call(technician, "obtenerHistorialOT", {otId: entered.otId});
  assert.ok(visible.eventos.some((event) => event.tipo === "ot_cancelada" && event.actorNombre));
  const closureEvents = await call(technician, "obtenerEventosCierreOT", {otId: entered.otId});
  assert.deepEqual(closureEvents.eventos.map((event) => event.tipo), ["ot_cancelada"]);
  await expectCallableError("cancelada es terminal", () => call(owner, "cancelarOT",
    {otId: entered.otId, requestId: id(), expectedActualizadoEn: cancelledStored.actualizadoEn.toMillis()}),
  ["failed-precondition"]);
  const nextOrder = await createOrder();
  const firstNumber = Number(entered.numeroOT.replace("OT-", ""));
  const nextNumber = Number(nextOrder.numeroOT.replace("OT-", ""));
  assert.ok(nextNumber > firstNumber, "El número cancelado no se reutiliza");

  await call(technician, "registrarRecepcionOrdenTrabajo", {otId: nextOrder.otId, recepcion: reception});
  const plaza = (await call(owner, "crearPlazaTaller", {
    requestId: id(), plaza: {nombre: `Plaza cancelación ${runId}`},
  })).plaza;
  await call(technician, "asignarPlazaOT", {
    otId: nextOrder.otId, plazaId: plaza.plazaId, expectedActualizadoEn: await revision(nextOrder.otId),
  });
  assert.equal((await read(nextOrder.otId)).estado, "en_diagnostico");
  assert.equal((await adminDb.doc(`${base}/plazaOccupancyKeys/${plaza.plazaId}`).get()).data().otId, nextOrder.otId);
  await call(technician, "cancelarOT", await cancelInput(nextOrder.otId));
  assert.equal((await read(nextOrder.otId)).plazaId, null);
  assert.equal((await adminDb.doc(`${base}/plazaOccupancyKeys/${plaza.plazaId}`).get()).exists, false);

  const raceOrder = await createOrder();
  await call(owner, "registrarRecepcionOrdenTrabajo", {otId: raceOrder.otId, recepcion: reception});
  const raceRevision = await revision(raceOrder.otId);
  const race = await Promise.allSettled([
    call(owner, "cancelarOT", {otId: raceOrder.otId, requestId: id(), expectedActualizadoEn: raceRevision}),
    call(technician, "cancelarOT", {otId: raceOrder.otId, requestId: id(), expectedActualizadoEn: raceRevision}),
  ]);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await read(raceOrder.otId)).estado, "cancelada");
  assert.equal((await refFor(raceOrder.otId).collection("historial").where("tipo", "==", "ot_cancelada").get()).size, 1);

  // Canonical orders are used; Admin only prepares edge states for the transition matrix.
  for (const estado of ["esperando_aprobacion", "esperando_repuestos"]) {
    const candidate = await createOrder();
    await refFor(candidate.otId).update({estado, estadoAprobacion: estado === "esperando_repuestos" ? "aprobada" : "pendiente"});
    const before = await read(candidate.otId);
    await call(owner, "cancelarOT", await cancelInput(candidate.otId));
    const after = await read(candidate.otId);
    assert.equal(after.estado, "cancelada");
    assert.equal(after.estadoAprobacion, before.estadoAprobacion, "La cancelación conserva la decisión histórica");
  }
  for (const estado of ["en_reparacion", "pendiente_entrega", "cerrada", "cancelada"]) {
    const candidate = await createOrder();
    await refFor(candidate.otId).update({estado});
    await expectCallableError(`no cancelar desde ${estado}`, async () => call(owner, "cancelarOT",
      {otId: candidate.otId, requestId: id(), expectedActualizadoEn: await revision(candidate.otId)}),
    ["failed-precondition"]);
    assert.equal((await read(candidate.otId)).estado, estado);
  }

  await expectCallableError("cancelación cross-business", () => call(outsider, "cancelarOT",
    {otId: entered.otId, requestId: id(), expectedActualizadoEn: cancelledStored.actualizadoEn.toMillis()}),
  ["permission-denied"]);
  await expectFirestoreDenied("SDK no lee request de cancelación", () =>
    getDoc(doc(owner.db, `${base}/otClosureRequests/${firstInput.requestId}`)));
  await expectFirestoreDenied("SDK no escribe request de cancelación", () =>
    setDoc(doc(owner.db, `${base}/otClosureRequests/cancel-directa`), {negocioId: businessId}));
  console.log("WORK_ORDER_CANCELLATION_OK: estados, terminalidad, Plaza, idempotencia, concurrencia y RBAC");
}
