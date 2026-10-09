import assert from "node:assert/strict";
import {collection, doc, getDoc, getDocs, query, setDoc, where} from "firebase/firestore";

export async function testWorkshopPlazas({
  adminDb, businessId, transitionOtId, transitionPlazaId, primaryOtId, concurrentOtIds,
  owner, admin, technician, member, outsider, callable, expectCallableError,
  expectFirestoreDenied, runId,
}) {
  const base = `negocios/${businessId}`;
  const plazaCollection = adminDb.collection(`${base}/plazasTaller`);
  const lockCollection = adminDb.collection(`${base}/plazaOccupancyKeys`);
  let sequence = 0;
  const requestId = () => `plaza-${runId}-${++sequence}`;
  const call = (client, name, input) => callable(client, name)(input);
  const readPlaza = async (plazaId) => (await plazaCollection.doc(plazaId).get()).data();
  const readOrder = async (otId) => (await adminDb.doc(`${base}/ordenesTrabajo/${otId}`).get()).data();
  const revision = async (otId) => (await readOrder(otId)).actualizadoEn.toMillis();

  const transitionPlaza = await readPlaza(transitionPlazaId);
  assert.deepEqual(Object.keys(transitionPlaza).sort(), [
    "actualizadoEn", "actualizadoPorUid", "creadoEn", "creadoPorUid",
    "estado", "negocioId", "nombre", "plazaId",
  ].sort());
  assert.equal(transitionPlaza.estado, "activa");
  assert.equal((await readOrder(transitionOtId)).plazaId, transitionPlazaId);
  assert.equal((await lockCollection.doc(transitionPlazaId).get()).data().otId, transitionOtId);
  assert.equal("ocupacion" in transitionPlaza, false);
  assert.equal("ocupada" in transitionPlaza, false);

  await expectCallableError("TECNICO no crea Plazas", () => call(technician, "crearPlazaTaller", {
    businessId, requestId: requestId(), plaza: {nombre: "No autorizada"},
  }), ["permission-denied"]);
  await expectCallableError("MEMBER no inactiva Plazas", () => call(member, "inactivarPlazaTaller", {
    businessId, plazaId: transitionPlazaId, expectedActualizadoEn: transitionPlaza.actualizadoEn.toMillis(),
  }), ["permission-denied"]);
  await expectCallableError("usuario externo no crea Plazas", () => call(outsider, "crearPlazaTaller", {
    businessId, requestId: requestId(), plaza: {nombre: "Externa"},
  }), ["permission-denied"]);
  await expectCallableError("estado funcional no se acepta al crear Plaza", () => call(owner, "crearPlazaTaller", {
    businessId, requestId: requestId(), plaza: {nombre: "Inválida", estado: "ocupada"},
  }), ["invalid-argument"]);

  const plazaBRequest = requestId();
  const plazaBResult = await call(owner, "crearPlazaTaller", {
    businessId, requestId: plazaBRequest, plaza: {nombre: "Taller - Plaza 2"},
  });
  const plazaBId = plazaBResult.data.plaza.plazaId;
  assert.equal((await call(owner, "crearPlazaTaller", {
    businessId, requestId: plazaBRequest, plaza: {nombre: "Taller - Plaza 2"},
  })).data.sinCambios, true);
  await expectCallableError("request de Plaza no se reutiliza con otro nombre", () => call(owner, "crearPlazaTaller", {
    businessId, requestId: plazaBRequest, plaza: {nombre: "Otro nombre"},
  }), ["already-exists"]);
  const plazaCResult = await call(admin, "crearPlazaTaller", {
    businessId, requestId: requestId(), plaza: {nombre: "Taller - Plaza 3"},
  });
  const plazaCId = plazaCResult.data.plaza.plazaId;

  let plazaB = await readPlaza(plazaBId);
  const stalePlazaRevision = plazaB.actualizadoEn.toMillis();
  await call(admin, "actualizarPlazaTaller", {
    businessId, plazaId: plazaBId, plaza: {nombre: "Estacionamiento - Plaza 2"},
    expectedActualizadoEn: stalePlazaRevision,
  });
  plazaB = await readPlaza(plazaBId);
  assert.equal(plazaB.nombre, "Estacionamiento - Plaza 2");
  await expectCallableError("edición concurrente de Plaza", () => call(owner, "actualizarPlazaTaller", {
    businessId, plazaId: plazaBId, plaza: {nombre: "Nombre obsoleto"},
    expectedActualizadoEn: stalePlazaRevision,
  }), ["aborted"]);

  const primaryBefore = await readOrder(primaryOtId);
  assert.equal(primaryBefore.plazaId, null);
  assert.equal(primaryBefore.estado, "en_cola");
  const assigned = await call(technician, "asignarPlazaOT", {
    businessId, otId: primaryOtId, plazaId: plazaBId,
    expectedActualizadoEn: primaryBefore.actualizadoEn.toMillis(),
  });
  assert.equal(assigned.data.estado, "en_diagnostico");
  assert.equal((await readOrder(primaryOtId)).plazaId, plazaBId);
  assert.equal((await lockCollection.doc(plazaBId).get()).data().otId, primaryOtId);
  assert.equal((await call(technician, "asignarPlazaOT", {
    businessId, otId: primaryOtId, plazaId: plazaBId,
    expectedActualizadoEn: await revision(primaryOtId),
  })).data.sinCambios, true);

  await call(admin, "asignarPlazaOT", {
    businessId, otId: primaryOtId, plazaId: plazaCId,
    expectedActualizadoEn: await revision(primaryOtId),
  });
  assert.equal((await readOrder(primaryOtId)).plazaId, plazaCId);
  assert.equal((await lockCollection.doc(plazaBId).get()).exists, false);
  assert.equal((await lockCollection.doc(plazaCId).get()).data().otId, primaryOtId);
  const plazaEvents = (await adminDb.collection(`${base}/ordenesTrabajo/${primaryOtId}/historial`).get())
    .docs.map((item) => item.data()).filter((event) => event.tipo.startsWith("plaza_"));
  assert.ok(plazaEvents.some((event) => event.tipo === "plaza_asignada" && event.detalle.plazaId === plazaBId));
  assert.ok(plazaEvents.some((event) => event.tipo === "plaza_liberada" && event.detalle.plazaId === plazaBId));
  assert.ok(plazaEvents.every((event) => event.actorUid && event.actorSnapshot?.correo && event.fecha?.toDate()));

  await call(technician, "liberarPlazaOT", {
    businessId, otId: primaryOtId, expectedActualizadoEn: await revision(primaryOtId),
  });
  assert.equal((await readOrder(primaryOtId)).plazaId, null);
  assert.equal((await readOrder(primaryOtId)).estado, "en_diagnostico");
  assert.equal((await lockCollection.doc(plazaCId).get()).exists, false);
  assert.equal((await call(technician, "liberarPlazaOT", {
    businessId, otId: primaryOtId, expectedActualizadoEn: await revision(primaryOtId),
  })).data.sinCambios, true);

  const [leftOtId, rightOtId] = concurrentOtIds;
  const competing = await Promise.allSettled([
    call(technician, "asignarPlazaOT", {
      businessId, otId: leftOtId, plazaId: plazaBId, expectedActualizadoEn: await revision(leftOtId),
    }),
    call(admin, "asignarPlazaOT", {
      businessId, otId: rightOtId, plazaId: plazaBId, expectedActualizadoEn: await revision(rightOtId),
    }),
  ]);
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(competing.filter((result) => result.status === "rejected").length, 1);
  assert.match(String(competing.find((result) => result.status === "rejected").reason?.message || ""), /otra Orden de Trabajo/i);
  const winnerOtId = competing[0].status === "fulfilled" ? leftOtId : rightOtId;
  const loserOtId = winnerOtId === leftOtId ? rightOtId : leftOtId;
  assert.equal((await readOrder(winnerOtId)).plazaId, plazaBId);
  assert.equal((await readOrder(loserOtId)).plazaId, null);
  assert.equal((await lockCollection.doc(plazaBId).get()).data().otId, winnerOtId);
  await call(owner, "liberarPlazaOT", {
    businessId, otId: winnerOtId, expectedActualizadoEn: await revision(winnerOtId),
  });

  plazaB = await readPlaza(plazaBId);
  await call(owner, "inactivarPlazaTaller", {
    businessId, plazaId: plazaBId, expectedActualizadoEn: plazaB.actualizadoEn.toMillis(),
  });
  plazaB = await readPlaza(plazaBId);
  assert.equal(plazaB.estado, "inactiva");
  await expectCallableError("Plaza inactiva no se asigna", async () => call(owner, "asignarPlazaOT", {
    businessId, otId: primaryOtId, plazaId: plazaBId, expectedActualizadoEn: await revision(primaryOtId),
  }), ["failed-precondition"], /Plaza activa/i);
  await call(owner, "activarPlazaTaller", {
    businessId, plazaId: plazaBId, expectedActualizadoEn: plazaB.actualizadoEn.toMillis(),
  });
  assert.equal((await readPlaza(plazaBId)).estado, "activa");

  const visible = await getDocs(query(
    collection(technician.db, `${base}/plazasTaller`), where("negocioId", "==", businessId),
  ));
  assert.ok(visible.size >= 3);
  await expectFirestoreDenied("otro negocio no lee Plaza", () =>
    getDoc(doc(outsider.db, `${base}/plazasTaller/${plazaBId}`)));
  await expectFirestoreDenied("SDK cliente no crea Plaza", () =>
    setDoc(doc(owner.db, `${base}/plazasTaller/directa`), {negocioId: businessId, nombre: "Directa", estado: "activa"}));
  await expectFirestoreDenied("SDK cliente no lee clave de ocupación", () =>
    getDoc(doc(owner.db, `${base}/plazaOccupancyKeys/${transitionPlazaId}`)));
  await expectFirestoreDenied("SDK cliente no escribe clave de ocupación", () =>
    setDoc(doc(owner.db, `${base}/plazaOccupancyKeys/directa`), {negocioId: businessId, plazaId: "directa", otId: primaryOtId}));

  console.log("WORK_ORDER_PLAZAS_OK: CRUD, estados, ocupación derivada, cambio, liberación, concurrencia y permisos");
}
