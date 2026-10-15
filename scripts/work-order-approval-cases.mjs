import assert from "node:assert/strict";
import {doc, getDoc, setDoc} from "firebase/firestore";

export async function testWorkOrderApproval({adminDb, businessId, otId, serviceId, diagnosisPath,
  owner, admin, technician, member, outsider, callable, expectCallableError, expectFirestoreDenied, runId}) {
  const base = `negocios/${businessId}`;
  const orderRef = adminDb.doc(`${base}/ordenesTrabajo/${otId}`);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const productRef = adminDb.doc(`${base}/inventario/producto-core`);
  const coreServiceRef = adminDb.doc(`${base}/inventario/servicio-core`);
  let sequence = 0;
  const requestId = () => `approval-${runId}-${++sequence}`;
  const order = async () => (await orderRef.get()).data();
  const service = async () => (await serviceRef.get()).data();
  const payload = async (extra = {}) => ({businessId, otId, requestId: requestId(),
    expectedActualizadoEn: (await order()).actualizadoEn.toMillis(), ...extra});
  const action = async (name, client = owner, extra = {}) => (await callable(client, name)(await payload(extra))).data;
  const reject = (label, name, data, client = owner, codes = ["failed-precondition"]) =>
    expectCallableError(label, () => callable(client, name)(data), codes);
  const addProduct = async (targetService = serviceId, quantity = 2) => {
    const id = requestId();
    await callable(technician, "agregarProductoOT")({businessId, otId, servicioOtId: targetService,
      itemId: "producto-core", cantidad: quantity, requestId: id});
    return id;
  };
  const updateQuantity = async (id, quantity) => callable(technician, "actualizarProductoOT")({
    businessId, otId, servicioOtId: serviceId, productoOtId: id, cantidad: quantity,
    expectedActualizadoEn: (await service()).actualizadoEn.toMillis(),
  });
  const events = async () => (await orderRef.collection("historial").get()).docs.map((snapshot) => snapshot.data());

  // Preconditions and authority are checked by the callable, not the client.
  const reception = (await order()).recepcion;
  await orderRef.update({recepcion: null});
  await reject("envío sin recepción", "enviarOTAprobacion", await payload());
  await orderRef.update({recepcion: reception});
  await adminDb.doc(diagnosisPath).update({estado: "borrador"});
  await reject("envío sin diagnóstico completado", "enviarOTAprobacion", await payload());
  await reject("aprobar sin diagnóstico completado", "aprobarOT", await payload());
  await adminDb.doc(diagnosisPath).update({estado: "completado"});
  await reject("snapshot aportado por frontend", "enviarOTAprobacion", await payload({snapshot: {precioUnitario: 1}}), owner, ["invalid-argument"]);
  await reject("precio manual", "enviarOTAprobacion", await payload({precioUnitario: 1}), owner, ["invalid-argument"]);
  await reject("negocio ajeno", "enviarOTAprobacion", await payload(), outsider, ["permission-denied"]);
  await reject("membresía operativa no concede aprobación", "aprobarOT", await payload(), technician, ["permission-denied"]);
  await reject("perfil Taller no concede aprobación", "aprobarOT", await payload(), member, ["permission-denied"]);
  const memberRef = adminDb.doc(`membresias/${businessId}__${member.uid}`);
  await memberRef.update({estado: "inactivo"});
  await reject("membresía inactiva", "enviarOTAprobacion", await payload(), member, ["permission-denied"]);
  await memberRef.update({estado: "activo"});
  const productId = await addProduct();
  await coreServiceRef.update({tipoItem: "producto"});
  await reject("referencia servicio de tipo incorrecto", "enviarOTAprobacion", await payload());
  await coreServiceRef.update({tipoItem: "servicio", precioInterno: null});
  await reject("precio Core ausente", "enviarOTAprobacion", await payload());
  await coreServiceRef.update({precioInterno: 25000, negocioId: "otro-negocio"});
  await reject("referencia Core de otro negocio", "enviarOTAprobacion", await payload());
  await coreServiceRef.update({negocioId: businessId});
  await productRef.update({tipoItem: "servicio"});
  await reject("referencia producto de tipo incorrecto", "enviarOTAprobacion", await payload());
  await productRef.update({tipoItem: "producto", stock: null});
  await reject("stock inválido", "enviarOTAprobacion", await payload());
  await productRef.update({stock: 12});

  const sendRequest = await payload();
  const sent = (await callable(technician, "enviarOTAprobacion")(sendRequest)).data;
  assert.equal(sent.estado, "esperando_aprobacion");
  assert.equal(sent.estadoAprobacion, "pendiente");
  assert.equal((await service()).precioUnitario, 25000);
  assert.equal((await service()).productos[0].precioUnitario, 8000);
  assert.equal((await productRef.get()).data().stock, 12);
  assert.equal((await callable(technician, "enviarOTAprobacion")(sendRequest)).data.sinCambios, true);
  assert.equal((await events()).filter((event) => event.tipo === "ot_enviada_aprobacion").length, 1);
  await reject("requestId reutilizado", "enviarOTAprobacion", {...sendRequest, motivo: "otro"}, technician, ["already-exists"]);
  await reject("revisión de alcance obsoleta", "aprobarOT", await payload({expectedActualizadoEn: 1}), owner, ["aborted"]);

  const firstFrozen = (await service()).servicioSnapshot;
  await coreServiceRef.update({nombre: "Nombre nuevo", precioInterno: 40000});
  await productRef.update({nombre: "Filtro nuevo", precioInterno: 9000});
  const approveRequest = await payload();
  const approved = (await callable(admin, "aprobarOT")(approveRequest)).data;
  assert.equal(approved.estado, "en_reparacion");
  assert.equal(approved.estadoAprobacion, "aprobada");
  assert.equal((await service()).precioUnitario, 25000);
  assert.deepEqual((await service()).servicioSnapshot, firstFrozen);
  assert.equal((await callable(admin, "aprobarOT")(approveRequest)).data.sinCambios, true);
  await coreServiceRef.update({estado: "inactivo"});
  const summary = (await callable(member, "obtenerResumenAprobacionOT")({businessId, otId})).data;
  assert.equal(summary.alcance[0].precioUnitario, 25000);
  assert.equal(summary.puedeAprobar, false);
  assert.ok(summary.congelado);
  assert.doesNotMatch(JSON.stringify(summary), /costo|margen|precioInterno/);
  await coreServiceRef.update({estado: "activo"});
  await reject("reenviar un alcance aprobado sin modificación", "enviarOTAprobacion", await payload());
  // Responsible and identical quantity changes do not invalidate approved scope.
  await callable(owner, "actualizarServicioOT")({businessId, otId, servicioOtId: serviceId,
    servicio: {itemId: "servicio-core", responsableUid: admin.uid},
    expectedActualizadoEn: (await service()).actualizadoEn.toMillis()});
  await updateQuantity(productId, 2);
  assert.equal((await order()).estadoAprobacion, "aprobada");
  await updateQuantity(productId, 3);
  assert.equal((await order()).estadoAprobacion, "pendiente");
  assert.ok(["en_cola", "en_diagnostico"].includes((await order()).estado));
  await reject("alcance editado requiere nuevo envío", "aprobarOT", await payload());
  const historical = (await events()).find((event) => event.tipo === "ot_aprobada");
  assert.equal(historical.detalle.alcance[0].precioUnitario, 25000);
  assert.deepEqual(historical.detalle.alcance[0].servicioSnapshot, firstFrozen);
  assert.equal((await action("enviarOTAprobacion")).estado, "esperando_aprobacion");
  assert.equal((await service()).precioUnitario, 40000);
  assert.equal((await service()).productos[0].precioUnitario, 9000);
  const rejection = await action("rechazarOT", admin, {motivo: "Revisar el alcance"});
  assert.equal(rejection.estadoAprobacion, "rechazada");
  assert.notEqual(rejection.estado, "en_reparacion");
  await reject("rechazada no se aprueba sin reenvío", "aprobarOT", await payload());
  await action("enviarOTAprobacion");

  // Stock may change between send and approve. Approval remains independent.
  await productRef.update({stock: 1});
  const waitingApproved = await action("aprobarOT");
  assert.equal(waitingApproved.estado, "esperando_repuestos");
  assert.equal(waitingApproved.estadoAprobacion, "aprobada");
  assert.equal(waitingApproved.faltantes[0].cantidad, 3);
  assert.equal((await action("revalidarDisponibilidadOT", technician)).estado, "esperando_repuestos");
  await productRef.update({stock: 12});
  const resumed = await action("revalidarDisponibilidadOT", technician);
  assert.equal(resumed.estado, "en_reparacion");
  assert.equal(resumed.estadoAprobacion, "aprobada");
  assert.equal((await productRef.get()).data().stock, 12);

  // Product addition/removal and service addition/replacement invalidate too.
  const addedId = await addProduct(serviceId, 1);
  assert.equal((await order()).estadoAprobacion, "pendiente");
  await action("enviarOTAprobacion"); await action("aprobarOT");
  await callable(owner, "eliminarProductoOT")({businessId, otId, servicioOtId: serviceId, productoOtId: addedId,
    expectedActualizadoEn: (await service()).actualizadoEn.toMillis()});
  assert.equal((await order()).estadoAprobacion, "pendiente");
  await action("enviarOTAprobacion"); await action("aprobarOT");
  const secondServiceId = requestId();
  await callable(owner, "crearServicioOT")({businessId, otId, requestId: secondServiceId,
    servicio: {itemId: "servicio-core", responsableUid: admin.uid}});
  assert.equal((await order()).estadoAprobacion, "pendiente");
  await addProduct(secondServiceId, 10);
  const waitingPending = await action("enviarOTAprobacion");
  assert.equal(waitingPending.estado, "esperando_repuestos");
  assert.equal(waitingPending.estadoAprobacion, "pendiente");
  assert.equal(waitingPending.faltantes[0].cantidad, 13); // Aggregate same product across services.
  await reject("no aprueba antes de disponibilidad suficiente", "aprobarOT", await payload());
  await productRef.update({stock: 13});
  assert.equal((await action("revalidarDisponibilidadOT")).estado, "esperando_aprobacion");
  await action("aprobarOT");
  await adminDb.doc(`${base}/inventario/servicio-nuevo`).set({
    negocioId: businessId, tipoItem: "servicio", estado: "activo", nombre: "Servicio alternativo", precioInterno: 5000,
  });
  await callable(owner, "actualizarServicioOT")({businessId, otId, servicioOtId: serviceId,
    servicio: {itemId: "servicio-nuevo", responsableUid: admin.uid},
    expectedActualizadoEn: (await service()).actualizadoEn.toMillis()});
  assert.equal((await order()).estadoAprobacion, "pendiente");
  await action("enviarOTAprobacion");

  const concurrentPayload = await payload();
  const decisions = await Promise.allSettled([
    callable(owner, "aprobarOT")(concurrentPayload),
    callable(admin, "rechazarOT")({...concurrentPayload, requestId: requestId()}),
  ]);
  assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(decisions.filter((result) => result.status === "rejected").length, 1);
  for (const internal of ["otApprovalState", "otApprovalRequests"]) {
    await expectFirestoreDenied(`SDK no lee ${internal}`, () => getDoc(doc(owner.db, `${base}/${internal}/${internal === "otApprovalState" ? otId : sendRequest.requestId}`)));
    await expectFirestoreDenied(`SDK no escribe ${internal}`, () => setDoc(doc(owner.db, `${base}/${internal}/directo`), {negocioId: businessId}));
  }
  await expectFirestoreDenied("SDK no escribe aprobación", () => setDoc(doc(owner.db, orderRef.path), {estadoAprobacion: "aprobada"}, {merge: true}));
  assert.ok((await events()).filter((event) => ["ot_enviada_aprobacion", "ot_aprobada", "ot_rechazada", "aprobacion_invalidada"].includes(event.tipo))
    .every((event) => event.actorUid && event.actorSnapshot && event.fecha?.toDate()));
  assert.equal((await productRef.get()).data().stock, 13);
  console.log("WORK_ORDER_APPROVAL_INTEGRATED_OK: snapshots, historial, idempotencia, stock, transiciones, invalidación, concurrencia y RBAC");
}
