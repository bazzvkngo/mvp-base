import assert from "node:assert/strict";
import {completeDeliveryPhotos, deliveryInput} from "./work-order-delivery-fixtures.mjs";
import {completeReceptionPhotos} from "./work-order-photo-fixtures.mjs";

// Asignación automática de Plaza: al aprobar, la cola FIFO de OT en espera y la promoción
// cuando una Plaza queda libre (finalización, entrega, cancelación, liberación, creación, activación y cambio).
// Corre al final de la suite: deja inactivas las Plazas previas para trabajar con Plazas propias.
export async function testWorkshopPlazaAutoAssignment({adminDb, businessId, owner, admin, technician,
  callable, expectCallableError, reception, runId}) {
  const base = `negocios/${businessId}`;
  let sequence = 0;
  const id = () => `plaza-auto-${runId}-${++sequence}`;
  const call = async (client, name, input) => (await callable(client, name)({businessId, ...input})).data;
  const refFor = (otId) => adminDb.doc(`${base}/ordenesTrabajo/${otId}`);
  const read = async (otId) => (await refFor(otId).get()).data();
  const revision = async (otId) => (await read(otId)).actualizadoEn.toMillis();
  const lock = async (plazaId) => (await adminDb.doc(`${base}/plazaOccupancyKeys/${plazaId}`).get()).data() || null;
  const events = async (otId, tipo) => (await refFor(otId).collection("historial").where("tipo", "==", tipo).get())
    .docs.map((entry) => entry.data());

  const receivedOrder = async () => {
    const order = (await call(owner, "crearOrdenTrabajo", {
      requestId: id(), ordenTrabajo: {vehiculoId: "vehiculo-a"},
    })).ordenTrabajo;
    await completeReceptionPhotos(refFor(order.otId));
    await call(technician, "registrarRecepcionOrdenTrabajo", {otId: order.otId, recepcion: reception});
    assert.equal((await read(order.otId)).estado, "en_cola");
    return order.otId;
  };
  const approve = async (otId, client = owner) => call(client, "aprobarOT", {
    otId, requestId: id(), responsableUid: technician.uid, expectedActualizadoEn: await revision(otId),
  });
  const createPlaza = async (nombre) => (await call(admin, "crearPlazaTaller", {
    requestId: id(), plaza: {nombre},
  })).plaza.plazaId;
  // Fixture directa (sin Function): una Plaza activa y libre que no dispara promociones.
  const fixturePlaza = async (nombre) => {
    const plazaRef = adminDb.collection(`${base}/plazasTaller`).doc(id());
    const now = new Date();
    await plazaRef.set({plazaId: plazaRef.id, negocioId: businessId, nombre, estado: "activa",
      creadoPorUid: owner.uid, creadoEn: now, actualizadoPorUid: owner.uid, actualizadoEn: now});
    return plazaRef.id;
  };
  const assertWaiting = async (otId, label) => {
    const order = await read(otId);
    assert.equal(order.estado, "en_cola", `${label}: sigue en cola`);
    assert.equal(order.estadoAprobacion, "aprobada", `${label}: queda aprobada`);
    assert.equal(order.plazaId, null, `${label}: sin Plaza`);
    assert.ok(order.aprobadaEn?.toMillis(), `${label}: guarda aprobadaEn`);
  };
  const assertRepairing = async (otId, plazaId, label) => {
    const order = await read(otId);
    assert.equal(order.estado, "en_reparacion", `${label}: inicia la reparación`);
    assert.equal(order.plazaId, plazaId, `${label}: recibe la Plaza`);
    assert.equal((await lock(plazaId))?.otId, otId, `${label}: el candado apunta a la OT`);
  };

  // Punto de partida: sin OT en espera y solo con Plazas creadas por esta prueba.
  const waitingBefore = await adminDb.collection(`${base}/ordenesTrabajo`)
    .where("estado", "==", "en_cola").where("estadoAprobacion", "==", "aprobada").get();
  assert.equal(waitingBefore.size, 0, "la suite no deja OT aprobadas en espera");
  const previousPlazas = (await adminDb.collection(`${base}/plazasTaller`).where("estado", "==", "activa").get()).docs;
  await Promise.all(previousPlazas.map((plaza) => plaza.ref.update({estado: "inactiva"})));

  // 0. Sin Plazas activas no se aprueba; la última Plaza activa no se puede inactivar.
  const holder = await receivedOrder();
  await expectCallableError("aprobar sin Plazas activas", () => approve(holder),
    ["failed-precondition"], /al menos una Plaza activa/i);
  assert.equal((await read(holder)).estadoAprobacion, "pendiente");
  const plaza1 = await createPlaza("Automática 1");
  const onlyPlaza = (await adminDb.doc(`${base}/plazasTaller/${plaza1}`).get()).data();
  await expectCallableError("no se inactiva la última Plaza activa", () => call(owner, "inactivarPlazaTaller", {
    plazaId: plaza1, expectedActualizadoEn: onlyPlaza.actualizadoEn.toMillis(),
  }), ["failed-precondition"], /al menos una Plaza activa/i);
  assert.equal((await adminDb.doc(`${base}/plazasTaller/${plaza1}`).get()).data().estado, "activa");
  console.log("OK Plaza automática: el negocio conserva al menos una Plaza activa para aprobar");

  // 1. Con una Plaza libre, aprobar la asigna automáticamente.
  const approvedWithPlaza = await approve(holder);
  assert.equal(approvedWithPlaza.estado, "en_reparacion");
  assert.equal(approvedWithPlaza.plazaId, plaza1);
  assert.equal(approvedWithPlaza.enEsperaDePlaza, false);
  await assertRepairing(holder, plaza1, "aprobación con Plaza libre");
  const automatic = await events(holder, "plaza_asignada");
  assert.equal(automatic.length, 1);
  assert.equal(automatic[0].detalle.automatica, true);
  assert.equal(automatic[0].detalle.origen, "aprobacion");
  console.log("OK Plaza automática: aprobar asigna la primera Plaza libre");

  // 2. Sin Plaza libre, la OT queda aprobada en espera; el orden de llegada se respeta.
  const first = await receivedOrder();
  const second = await receivedOrder();
  const waitingResult = await approve(first);
  assert.equal(waitingResult.estado, "en_cola");
  assert.equal(waitingResult.enEsperaDePlaza, true);
  assert.equal(waitingResult.plazaId, null);
  await approve(second, admin);
  await assertWaiting(first, "primera en espera");
  await assertWaiting(second, "segunda en espera");
  assert.ok((await read(first)).aprobadaEn.toMillis() <= (await read(second)).aprobadaEn.toMillis());
  const waitingApproval = (await events(first, "ot_aprobada")).at(-1);
  assert.equal(waitingApproval.detalle.enEsperaDePlaza, true);
  await expectCallableError("OT en espera no inicia servicios", () => call(owner, "crearServicioOT", {
    otId: first, requestId: id(), servicio: {itemId: "servicio-core"},
  }), ["failed-precondition"]);
  console.log("OK Plaza automática: sin Plaza libre la OT aprobada queda en espera con aprobadaEn");

  // 3. Liberar la Plaza la entrega a la OT más antigua en espera.
  const released = await call(owner, "liberarPlazaOT", {otId: holder, expectedActualizadoEn: await revision(holder)});
  assert.equal(released.otPromovidaId, first);
  await assertRepairing(first, plaza1, "liberación promueve la más antigua");
  await assertWaiting(second, "la siguiente sigue esperando");
  const promotedEvent = (await events(first, "plaza_asignada")).at(-1);
  assert.equal(promotedEvent.detalle.automatica, true);
  assert.equal(promotedEvent.detalle.origen, "liberacion");
  assert.equal(promotedEvent.detalle.estadoAnterior, "en_cola");
  console.log("OK Plaza automática: liberar promueve por orden de llegada");

  // 4. Crear una Plaza la entrega a la OT en espera.
  const created = await call(admin, "crearPlazaTaller", {requestId: id(), plaza: {nombre: "Automática 2"}});
  const plaza2 = created.plaza.plazaId;
  assert.equal(created.otPromovidaId, second);
  await assertRepairing(second, plaza2, "crear Plaza promueve");
  console.log("OK Plaza automática: una Plaza nueva atiende la cola");

  // 5. Entregar libera la Plaza y promueve.
  const third = await receivedOrder();
  await approve(third);
  await assertWaiting(third, "tercera en espera");
  await refFor(first).update({estado: "pendiente_entrega"});
  await completeDeliveryPhotos(refFor(first));
  const delivered = await call(owner, "registrarEntregaOT", {
    otId: first, requestId: id(), expectedActualizadoEn: await revision(first), ...deliveryInput(),
  });
  assert.equal(delivered.estado, "cerrada");
  assert.equal(delivered.otPromovidaId, third);
  assert.equal((await read(first)).plazaId, null);
  await assertRepairing(third, plaza1, "entrega promueve");
  console.log("OK Plaza automática: entregar promueve la siguiente OT");

  // 5b. Finalizar la ejecución libera la Plaza y la entrega a la siguiente OT en espera.
  const finishWaiting = await receivedOrder();
  await approve(finishWaiting);
  await assertWaiting(finishWaiting, "en espera de una Plaza que se libera al finalizar");
  const serviceRefFor = (otId, servicioOtId) => refFor(otId).collection("servicios").doc(servicioOtId);
  const serviceRevision = async (otId, servicioOtId) => (await serviceRefFor(otId, servicioOtId).get()).data().actualizadoEn.toMillis();
  const finishService = (await call(technician, "crearServicioOT", {
    otId: third, requestId: id(), servicio: {itemId: "servicio-core"},
  })).servicioOtId;
  await call(technician, "definirRepuestosServicioOT", {otId: third, servicioOtId: finishService, modo: "ninguno",
    expectedActualizadoEn: await serviceRevision(third, finishService)});
  await call(technician, "iniciarServicioOT", {otId: third, servicioOtId: finishService, requestId: id(),
    expectedActualizadoEn: await serviceRevision(third, finishService)});
  await call(technician, "completarServicioOT", {otId: third, servicioOtId: finishService, requestId: id(),
    expectedActualizadoEn: await serviceRevision(third, finishService)});
  const finished = await call(owner, "finalizarReparacionOT", {
    otId: third, requestId: id(), expectedActualizadoEn: await revision(third),
  });
  assert.equal(finished.estado, "pendiente_entrega");
  assert.equal(finished.plazaId, null, "finalizar libera la Plaza");
  assert.equal(finished.otPromovidaId, finishWaiting);
  assert.equal((await read(third)).plazaId, null);
  await assertRepairing(finishWaiting, plaza1, "finalizar promueve");
  assert.equal((await events(finishWaiting, "plaza_asignada")).at(-1).detalle.origen, "finalizacion");
  console.log("OK Plaza automática: finalizar la ejecución libera la Plaza y promueve la siguiente OT");

  // 6. Cancelar una OT con Plaza (antes de aprobar) la libera y promueve.
  const pending = await receivedOrder();
  const plaza3 = await fixturePlaza("Automática 3");
  await call(technician, "asignarPlazaOT", {otId: pending, plazaId: plaza3, expectedActualizadoEn: await revision(pending)});
  assert.equal((await read(pending)).estado, "en_diagnostico", "una OT pendiente con Plaza pasa a diagnóstico");
  const fourth = await receivedOrder();
  await approve(fourth);
  await assertWaiting(fourth, "cuarta en espera");
  const cancelled = await call(owner, "cancelarOT", {
    otId: pending, requestId: id(), expectedActualizadoEn: await revision(pending),
  });
  assert.equal(cancelled.otPromovidaId, fourth);
  await assertRepairing(fourth, plaza3, "cancelación promueve");
  console.log("OK Plaza automática: cancelar promueve la siguiente OT");

  // 7. Una Plaza inactiva nunca se asigna; al activarla atiende la cola.
  const plaza4 = await fixturePlaza("Automática 4");
  let plaza4Data = (await adminDb.doc(`${base}/plazasTaller/${plaza4}`).get()).data();
  await call(owner, "inactivarPlazaTaller", {plazaId: plaza4, expectedActualizadoEn: plaza4Data.actualizadoEn.toMillis()});
  const fifth = await receivedOrder();
  await approve(fifth);
  await assertWaiting(fifth, "Plaza inactiva no se asigna");
  assert.equal(await lock(plaza4), null);
  plaza4Data = (await adminDb.doc(`${base}/plazasTaller/${plaza4}`).get()).data();
  const activated = await call(owner, "activarPlazaTaller", {plazaId: plaza4, expectedActualizadoEn: plaza4Data.actualizadoEn.toMillis()});
  assert.equal(activated.otPromovidaId, fifth);
  await assertRepairing(fifth, plaza4, "activar Plaza promueve");
  console.log("OK Plaza automática: una Plaza inactiva no se asigna y al activarla promueve");

  // 8. Asignación manual de una OT en espera: pasa a reparación, no a diagnóstico.
  const sixth = await receivedOrder();
  await approve(sixth);
  await assertWaiting(sixth, "sexta en espera");
  const manualPlaza = await fixturePlaza("Manual");
  const manual = await call(admin, "asignarPlazaOT", {otId: sixth, plazaId: manualPlaza, expectedActualizadoEn: await revision(sixth)});
  assert.equal(manual.estado, "en_reparacion");
  await assertRepairing(sixth, manualPlaza, "asignación manual de OT en espera");

  // 9. Cambiar de Plaza libera la anterior y promueve la cola.
  const seventh = await receivedOrder();
  await approve(seventh);
  await assertWaiting(seventh, "séptima en espera");
  const swapPlaza = await fixturePlaza("Cambio");
  const swapped = await call(owner, "asignarPlazaOT", {otId: sixth, plazaId: swapPlaza, expectedActualizadoEn: await revision(sixth)});
  assert.equal(swapped.otPromovidaId, seventh);
  await assertRepairing(sixth, swapPlaza, "OT que cambia de Plaza");
  await assertRepairing(seventh, manualPlaza, "cambio de Plaza promueve");
  console.log("OK Plaza automática: asignación manual de OT en espera y cambio de Plaza promueve");

  // 10. Dos aprobaciones concurrentes con una sola Plaza libre: solo una la obtiene.
  const left = await receivedOrder();
  const right = await receivedOrder();
  const racePlaza = await fixturePlaza("Concurrencia");
  const race = await Promise.allSettled([approve(left), approve(right, admin)]);
  assert.ok(race.every((result) => result.status === "fulfilled"),
    race.map((result) => result.reason?.message || result.status).join(" | "));
  const outcomes = await Promise.all([read(left), read(right)]);
  assert.equal(outcomes.filter((order) => order.plazaId === racePlaza && order.estado === "en_reparacion").length, 1);
  assert.equal(outcomes.filter((order) => order.estado === "en_cola" && !order.plazaId).length, 1);
  const raceWinner = outcomes.find((order) => order.plazaId === racePlaza);
  assert.equal((await lock(racePlaza)).otId, raceWinner.otId);
  console.log("OK Plaza automática: dos aprobaciones concurrentes no comparten Plaza");

  // Limpieza: la OT que quedó esperando se cancela y se restauran las Plazas previas.
  const raceLoser = outcomes.find((order) => order.estado === "en_cola");
  await call(owner, "cancelarOT", {otId: raceLoser.otId, requestId: id(), expectedActualizadoEn: await revision(raceLoser.otId)});
  await Promise.all(previousPlazas.map((plaza) => plaza.ref.update({estado: "activa"})));
  console.log("WORK_ORDER_PLAZA_AUTO_OK: asignación al aprobar, espera FIFO, promoción y concurrencia");
}
