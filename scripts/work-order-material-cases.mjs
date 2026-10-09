import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where} from "firebase/firestore";

const require = createRequire(import.meta.url);
const {applyInventoryAcquisition, inventoryEconomicFields, resolveInventoryEconomicState} = require("../functions/inventoryAcquisition.js");

export async function testWorkOrderMaterials({adminDb, businessId, otId, owner, admin, technician,
  member, outsider, anonymous, callable, expectCallableError, expectFirestoreDenied, runId}) {
  const base = `negocios/${businessId}`;
  const orderRef = adminDb.doc(`${base}/ordenesTrabajo/${otId}`);
  const itemRef = adminDb.doc(`${base}/inventario/producto-core`);
  const ledger = adminDb.collection(`${base}/movimientosInventario`);
  let sequence = 0;
  const id = () => `materials-${runId}-${++sequence}`;
  const call = (client, name, input) => callable(client, name)(input);
  const reject = (label, client, name, input, codes = ["failed-precondition"]) =>
    expectCallableError(label, () => call(client, name, input), codes);
  const readItem = async () => (await itemRef.get()).data();
  const readOrder = async () => (await orderRef.get()).data();
  const assertStockValue = async (stock, value) => {
    const item = await readItem();
    assert.equal(item.stock, stock); assert.equal(item.valorInventario, value);
    assert.equal(item.valorInventarioMoneda, "CLP");
    assert.equal(item.costoPromedio, stock ? Math.round((value / stock + Number.EPSILON) * 1e4) / 1e4 : null);
    assert.equal(item.costoBase, 3.3333);
    assert.equal(item.precioInterno, 99000);
  };
  // Synthetic legacy stock. First outflow must initialize the Core baseline without an acquisition.
  await itemRef.update({stock: 13, costoBase: 3.3333, moneda: "CLP", precioInterno: 99000});
  const created = await call(owner, "crearServicioOT", {businessId, otId, requestId: id(),
    servicio: {itemId: "servicio-core", responsableUid: technician.uid}});
  const servicioOtId = created.data.servicioOtId;
  const serviceRef = orderRef.collection("servicios").doc(servicioOtId);
  // Earlier stages' second service also plans the same product. Clear only this test's preceding scope via its endpoint.
  const previousServices = await orderRef.collection("servicios").get();
  for (const previous of previousServices.docs) {
    if (previous.id === servicioOtId || previous.data().estado !== "pendiente") continue;
    for (const product of previous.data().productos || []) {
      await call(owner, "eliminarProductoOT", {businessId, otId, servicioOtId: previous.id,
        productoOtId: product.productoOtId, expectedActualizadoEn: (await previous.ref.get()).data().actualizadoEn.toMillis()});
    }
  }
  await call(owner, "agregarProductoOT", {businessId, otId, servicioOtId,
    itemId: "producto-core", cantidad: 10, requestId: id()});
  // Restore sufficient stock for scope approval including already-completed services from preceding cases.
  const all = (await orderRef.collection("servicios").get()).docs.map((s) => s.data());
  const plannedTotal = all.flatMap((s) => s.productos || []).reduce((sum, p) => sum + p.cantidad, 0);
  await itemRef.update({stock: Math.max(13, plannedTotal)});
  await call(owner, "enviarOTAprobacion", {businessId, otId, requestId: id(),
    expectedActualizadoEn: (await readOrder()).actualizadoEn.toMillis()});
  await call(admin, "aprobarOT", {businessId, otId, requestId: id(),
    expectedActualizadoEn: (await readOrder()).actualizadoEn.toMillis()});
  // Availability is not a reservation: another consumer can leave only thirteen units.
  await itemRef.update({stock: 13});
  const payload = (extra = {}) => ({businessId, otId, servicioOtId, itemId: "producto-core", cantidad: 2, requestId: id(), ...extra});
  const exit = (client, input) => call(client, "registrarSalidaMaterialOT", input);
  const giveBack = (client, originId, cantidad, requestId = id(), extra = {}) =>
    call(client, "registrarDevolucionMaterialOT", {businessId, otId, servicioOtId, movimientoOrigenId: originId, cantidad, requestId, ...extra});
  await reject("salida exige servicio iniciado", owner, "registrarSalidaMaterialOT", payload());
  await call(technician, "iniciarServicioOT", {businessId, otId, servicioOtId, requestId: id(),
    expectedActualizadoEn: (await serviceRef.get()).data().actualizadoEn.toMillis()});
  await reject("salida sin autenticación", anonymous, "registrarSalidaMaterialOT", payload(), ["unauthenticated"]);
  await reject("salida cross-tenant", outsider, "registrarSalidaMaterialOT", payload(), ["permission-denied"]);
  await reject("materiales cross-tenant", outsider, "obtenerMaterialesOT", {businessId, otId}, ["permission-denied"]);
  await reject("servicio ajeno a OT", owner, "registrarSalidaMaterialOT", payload({servicioOtId: "inexistente"}), ["not-found"]);
  for (const cantidad of [0, -1, "2", 1e15, 0.5, null]) {
    await reject("cantidad física debe ser entera", owner, "registrarSalidaMaterialOT", payload({cantidad}), ["invalid-argument", "failed-precondition"]);
  }
  for (const field of ["costoUnitario", "stock", "usuarioUid", "fecha", "productoSnapshot"]) {
    await reject("payload económico/autoría manipulado", owner, "registrarSalidaMaterialOT", payload({[field]: 1}), ["invalid-argument"]);
  }
  await reject("servicio Core no mueve stock", owner, "registrarSalidaMaterialOT", payload({itemId: "servicio-core"}));
  await reject("stock insuficiente", owner, "registrarSalidaMaterialOT", payload({cantidad: 14}));
  const memberRef = adminDb.doc(`membresias/${businessId}__${member.uid}`);
  const membership = (await memberRef.get()).data();
  await memberRef.update({estado: "inactivo"});
  await reject("miembro inactivo no consume", member, "registrarSalidaMaterialOT", payload(), ["permission-denied"]);
  await memberRef.set({...membership, rol: "VENTAS"});
  await reject("rol sin operación no consume", member, "registrarSalidaMaterialOT", payload(), ["permission-denied"]);
  await memberRef.set(membership);
  const businessRef = adminDb.doc(base);
  const business = (await businessRef.get()).data();
  await businessRef.update({estado: "suspendido"});
  await reject("negocio suspendido no consume", owner, "registrarSalidaMaterialOT", payload());
  await businessRef.update({estado: business.estado, verificacionEmpresa: {estado: "NO_VERIFICADA"}});
  await reject("negocio sin verificar no consume", owner, "registrarSalidaMaterialOT", payload(), ["failed-precondition", "permission-denied"]);
  await businessRef.update({verificacionEmpresa: business.verificacionEmpresa});
  const profileRef = adminDb.doc(`${base}/perfilesEmpleados/taller-only`);
  await profileRef.update({modulos: ["inventario"]});
  await reject("perfil sin Taller no consume", member, "registrarSalidaMaterialOT", payload(), ["permission-denied"]);
  await profileRef.update({modulos: ["taller"]});
  await orderRef.update({estadoAprobacion: "pendiente"});
  await reject("sin aprobación vigente no consume", owner, "registrarSalidaMaterialOT", payload());
  await orderRef.update({estadoAprobacion: "aprobada", estado: "esperando_repuestos"});
  await reject("OT fuera de reparación no consume", owner, "registrarSalidaMaterialOT", payload());
  await orderRef.update({estado: "en_reparacion"});
  const initialProduct = await readItem();
  await itemRef.update({negocioId: "otro-negocio"});
  await reject("producto de otro negocio", owner, "registrarSalidaMaterialOT", payload());
  await itemRef.set({...initialProduct, tipoItem: "servicio"});
  await reject("tipo Core modificado no mueve stock", owner, "registrarSalidaMaterialOT", payload());
  await itemRef.set({...initialProduct, moneda: "USD"});
  await reject("moneda incompatible no mueve stock", owner, "registrarSalidaMaterialOT", payload());
  await itemRef.set(initialProduct);
  assert.equal((await ledger.where("otId", "==", otId).get()).size, 0);
  assert.equal((await readItem()).valorInventario, undefined);

  const input = payload();
  const concurrentRetry = await Promise.all([exit(technician, input), exit(technician, input)]);
  assert.equal(concurrentRetry[0].data.movimientoId, concurrentRetry[1].data.movimientoId);
  assert.equal(concurrentRetry.filter((entry) => entry.data.sinCambios).length, 1);
  const firstId = concurrentRetry[0].data.movimientoId;
  const first = (await ledger.doc(firstId).get()).data();
  await expectCallableError("devolución decimal rechazada", () => giveBack(owner, firstId, 0.5), ["invalid-argument"]);
  assert.equal(first.costoUnitario, 3.3331); // 43.33 / 13, four decimals from Core.
  assert.equal(first.costoTotal, 6.67);
  assert.equal(first.usuarioUid, technician.uid);
  assert.ok(first.creadoEn?.toDate()); assert.ok(!Number.isNaN(Date.parse(first.fecha)));
  assert.equal(first.otId, otId); assert.equal(first.servicioOtId, servicioOtId);
  assert.equal(first.movimientoOrigenId, null);
  assert.equal((await readItem()).baselineCostoInventario.valorInicial, 43.33);
  await assertStockValue(11, 36.66);
  await reject("requestId distinto payload", technician, "registrarSalidaMaterialOT", {...input, cantidad: 3}, ["already-exists"]);
  const competing = await Promise.allSettled([exit(member, payload({cantidad: 8})), exit(owner, payload({cantidad: 8}))]);
  assert.equal(competing.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(competing.filter((entry) => entry.status === "rejected").length, 1);
  const secondId = competing.find((entry) => entry.status === "fulfilled").value.data.movimientoId;
  const second = (await ledger.doc(secondId).get()).data();
  await assertStockValue(3, 10);

  const exhausted = (await exit(owner, payload({cantidad: 3}))).data.movimientoId;
  await assertStockValue(0, 0);
  await giveBack(owner, exhausted, 1);
  await giveBack(owner, exhausted, 1);
  await giveBack(owner, exhausted, 1);
  await assertStockValue(3, 10);

  const noCosts = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key !== "puedeVerCostos") assert.doesNotMatch(key, /costo|valorInventario|promedio|margen/i);
      noCosts(item);
    }
  };
  noCosts(concurrentRetry[0].data);
  noCosts((await exit(technician, input)).data);
  for (const client of [technician, member]) {
    const data = (await call(client, "obtenerMaterialesOT", {businessId, otId})).data;
    assert.equal(data.puedeVerCostos, false); noCosts(data);
    const own = data.servicios.find((entry) => entry.servicioOtId === servicioOtId);
    assert.equal(own.productos[0].consumido, 10); assert.equal(own.productos[0].planificado, 10);
    assert.equal(own.productos[0].stock, 3);
    await expectFirestoreDenied("SDK sin capacidad no lee costo Taller", () => getDoc(doc(client.db, `${ledger.path}/${firstId}`)));
  }
  const ownerView = (await call(owner, "obtenerMaterialesOT", {businessId, otId})).data;
  assert.equal(ownerView.puedeVerCostos, true);
  assert.equal(ownerView.servicios.find((s) => s.servicioOtId === servicioOtId).movimientos[0].costoTotal, 6.67);
  assert.ok((await getDoc(doc(owner.db, `${ledger.path}/${firstId}`))).exists());
  await profileRef.update({modulos: ["taller", "inventario", "reportes", "trabajos"]});
  await expectFirestoreDenied("módulos no conceden costos Taller", () => getDoc(doc(member.db, `${ledger.path}/${firstId}`)));
  await expectFirestoreDenied("listado amplio no filtra costos Taller", () => getDocs(query(collection(member.db, ledger.path), where("negocioId", "==", businessId))));
  // Same filters as Core's scoped readers; regression for personalized profiles.
  await ledger.doc("core-project-fixture").set({negocioId: businessId, trabajoId: "core-fixture", tipo: "SALIDA_PROYECTO"});
  assert.equal((await getDocs(query(collection(member.db, ledger.path), where("negocioId", "==", businessId),
    where("trabajoId", "==", "core-fixture"), where("tipo", "in", ["SALIDA_PROYECTO", "DEVOLUCION_PROYECTO"])))).size, 1);
  assert.ok((await getDocs(query(collection(member.db, ledger.path), where("negocioId", "==", businessId),
    where("tipo", "not-in", ["SALIDA_TALLER", "DEVOLUCION_TALLER"])))).docs.every((entry) => !entry.data().otId));
  await profileRef.update({modulos: ["taller"]});
  for (const operation of [() => setDoc(doc(owner.db, `${ledger.path}/directo`), {...first, creadoEn: new Date()}),
    () => updateDoc(doc(owner.db, `${ledger.path}/${firstId}`), {cantidad: 500}),
    () => deleteDoc(doc(owner.db, `${ledger.path}/${firstId}`)),
    () => updateDoc(doc(technician.db, itemRef.path), {stock: 500})]) {
    await expectFirestoreDenied("escritura SDK protegida", operation);
  }
  for (const path of [`${base}/tallerMaterialRequests/${input.requestId}`, `${base}/tallerMaterialBalances/${firstId}`]) {
    await expectFirestoreDenied("SDK no lee control interno", () => getDoc(doc(owner.db, path)));
    await expectFirestoreDenied("SDK no altera control interno", () => setDoc(doc(owner.db, path), {}));
  }
  await expectCallableError("sobredevolución", () => giveBack(owner, firstId, 3), ["failed-precondition"]);
  await expectCallableError("devolución cross-tenant", () => giveBack(outsider, firstId, 1), ["permission-denied"]);
  await expectCallableError("salida de otro servicio", () => giveBack(owner, firstId, 1, id(), {servicioOtId: "inexistente"}), ["not-found"]);
  // Simulate an intervening acquisition using the unchanged Core kernel; its higher average must not reprice returns.
  const acquired = applyInventoryAcquisition(resolveInventoryEconomicState({item: await readItem(), operationCurrency: "CLP"}),
    {cantidad: 2, costoUnitario: 10});
  await itemRef.update({stock: acquired.next.stock, ...inventoryEconomicFields(acquired.next, new Date())});
  await assertStockValue(5, 30);
  const returnInputId = id();
  const partial = await giveBack(member, firstId, 1, returnInputId);
  noCosts(partial.data);
  const returnMovement = (await ledger.doc(partial.data.movimientoId).get()).data();
  assert.equal(returnMovement.costoUnitario, first.costoUnitario);
  assert.equal(returnMovement.costoTotal, 3.33);
  assert.equal((await giveBack(member, firstId, 1, returnInputId)).data.sinCambios, true);
  await expectCallableError("request de devolución no admite otra cantidad", () => giveBack(member, firstId, 2, returnInputId), ["already-exists"]);
  await expectCallableError("devolución no usa otra devolución como origen", () => giveBack(owner, returnMovement.movimientoId, 1), ["failed-precondition"]);
  // Changing current commercial cost does not change a historical return.
  await itemRef.update({costoBase: 999});
  const returnRace = await Promise.allSettled([giveBack(owner, firstId, 1), giveBack(admin, firstId, 1)]);
  await itemRef.update({costoBase: 3.3333});
  assert.equal(returnRace.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(returnRace.filter((entry) => entry.status === "rejected").length, 1);
  const firstBalance = (await adminDb.doc(`${base}/tallerMaterialBalances/${firstId}`).get()).data();
  assert.equal(firstBalance.cantidadDevuelta, 2); assert.equal(firstBalance.costoDevuelto, first.costoTotal);
  assert.deepEqual((await ledger.doc(firstId).get()).data(), first);
  await assertStockValue(7, 36.67);
  await call(technician, "completarServicioOT", {businessId, otId, servicioOtId, requestId: id(),
    expectedActualizadoEn: (await serviceRef.get()).data().actualizadoEn.toMillis()});
  await reject("servicio completado no consume", owner, "registrarSalidaMaterialOT", payload());
  await itemRef.update({estado: "archivado"});
  await giveBack(technician, secondId, 3);
  await giveBack(technician, secondId, 5);
  await itemRef.update({estado: "activo"});
  await assertStockValue(15, 63.33);
  assert.deepEqual((await ledger.doc(secondId).get()).data(), second);
  assert.equal((await call(member, "obtenerMaterialesOT", {businessId, otId})).data.servicios
    .find((entry) => entry.servicioOtId === servicioOtId).productos[0].consumido, 0);
  const allMovements = (await ledger.where("otId", "==", otId).get()).docs.map((entry) => entry.data());
  assert.equal(allMovements.length, 10);
  const sumCost = (type) => Math.round(allMovements.filter((m) => m.tipo === type).reduce((s, m) => s + m.costoTotal, 0) * 100) / 100;
  assert.equal(sumCost("SALIDA_TALLER"), sumCost("DEVOLUCION_TALLER"));
  const history = (await orderRef.collection("historial").get()).docs.map((entry) => entry.data())
    .filter((entry) => ["material_consumido", "material_devuelto"].includes(entry.tipo));
  assert.equal(history.length, allMovements.length);
  assert.ok(history.every((entry) => entry.actorUid && entry.fecha?.toDate() && entry.detalle.servicioOtId === servicioOtId));
  for (const estado of ["cerrada", "cancelada"]) {
    await orderRef.update({estado});
    await reject("OT terminal no consume", owner, "registrarSalidaMaterialOT", payload());
    await expectCallableError("OT terminal no devuelve", () => giveBack(owner, secondId, 1), ["failed-precondition"]);
  }
  await orderRef.update({estado: "en_reparacion"});
  console.log("WORK_ORDER_MATERIALS_OK: Q/V, costos congelados, parciales, devoluciones múltiples, idempotencia, concurrencia y seguridad");
}
