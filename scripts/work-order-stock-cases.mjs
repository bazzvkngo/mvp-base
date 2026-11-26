import assert from "node:assert/strict";
import {completeReceptionPhotos} from "./work-order-photo-fixtures.mjs";

// Stock de repuestos en la Ejecución: el total de un repuesto en la OT no puede superar el stock actual
// de Inventario. No se consideran otras OT ni se reserva stock: Ventas confirma al vender.
// Inventario solo se lee: nunca se descuenta ni se reserva desde el taller.
export async function testWorkOrderStock({adminDb, businessId, owner, technician, callable,
  expectCallableError, reception, runId}) {
  const base = `negocios/${businessId}`;
  let sequence = 0;
  const id = () => `stock-${runId}-${++sequence}`;
  const call = async (client, name, input) => (await callable(client, name)({businessId, ...input})).data;
  const refFor = (otId) => adminDb.doc(`${base}/ordenesTrabajo/${otId}`);
  const revision = async (otId) => (await refFor(otId).get()).data().actualizadoEn.toMillis();
  const itemRef = (itemId) => adminDb.doc(`${base}/inventario/${itemId}`);
  const product = async (itemId, stock, nombre) => {
    await itemRef(itemId).set({negocioId: businessId, tipoItem: "producto", estado: "activo", nombre,
      codigoInterno: itemId.toUpperCase(), unidad: "unidad", precioInterno: 1000, costoBase: 400, stock});
    return itemId;
  };
  const freePlaza = async () => {
    const plazaRef = adminDb.collection(`${base}/plazasTaller`).doc(id());
    const now = new Date();
    await plazaRef.set({plazaId: plazaRef.id, negocioId: businessId, nombre: `Stock ${sequence}`, estado: "activa",
      creadoPorUid: owner.uid, creadoEn: now, actualizadoPorUid: owner.uid, actualizadoEn: now});
  };
  const createService = async (otId) => (await call(owner, "crearServicioOT", {
    otId, requestId: id(), servicio: {itemId: "servicio-core"},
  })).servicioOtId;
  // OT en reparación con un servicio pendiente, lista para planificar repuestos.
  const orderInExecution = async () => {
    const otId = (await call(owner, "crearOrdenTrabajo", {
      requestId: id(), ordenTrabajo: {vehiculoId: "vehiculo-a"},
    })).ordenTrabajo.otId;
    await completeReceptionPhotos(refFor(otId));
    await call(technician, "registrarRecepcionOrdenTrabajo", {otId, recepcion: reception});
    await freePlaza();
    await call(owner, "aprobarOT", {otId, requestId: id(), responsableUid: technician.uid, expectedActualizadoEn: await revision(otId)});
    assert.equal((await refFor(otId).get()).data().estado, "en_reparacion");
    return {otId, servicioOtId: await createService(otId)};
  };
  const add = (order, itemId, cantidad) => call(technician, "agregarProductoOT", {
    otId: order.otId, servicioOtId: order.servicioOtId, requestId: id(), itemId, cantidad,
  });
  const update = async (order, productoOtId, cantidad) => call(technician, "actualizarProductoOT", {
    otId: order.otId, servicioOtId: order.servicioOtId, productoOtId, cantidad,
    expectedActualizadoEn: (await refFor(order.otId).collection("servicios").doc(order.servicioOtId).get())
      .data().actualizadoEn.toMillis(),
  });

  const brakes = await product(`pastilla-${runId}`, 5, "Pastilla de freno");
  const empty = await product(`correa-${runId}`, 0, "Correa de distribución");
  const first = await orderInExecution();

  // Dentro del stock, igual al stock y sobre el stock, sumando las líneas de la OT.
  const firstLine = (await add(first, brakes, 3)).productoOtId;
  const otherService = {...first, servicioOtId: await createService(first.otId)};
  await add(otherService, brakes, 2);
  await expectCallableError("cantidad mayor al stock en la OT", () => add(first, brakes, 1),
    ["failed-precondition"], /Stock insuficiente de «Pastilla de freno»: stock actual 5 y esta OT necesita 6/);
  await expectCallableError("aumentar por sobre el stock", () => update(first, firstLine, 4),
    ["failed-precondition"], /Stock insuficiente/);
  console.log("OK stock repuestos: dentro del stock, igual al stock y sobre el stock (todas las líneas de la OT)");

  // Disminuir siempre se permite.
  await update(first, firstLine, 1);
  await add(first, brakes, 2);

  // Otra OT no se considera: el stock no está reservado y Ventas confirma al vender.
  const second = await orderInExecution();
  await add(second, brakes, 5);
  console.log("OK stock repuestos: disminuir se permite y otras OT no reservan stock");

  // Producto sin stock e ítem inexistente.
  await expectCallableError("producto sin stock", () => add(second, empty, 1),
    ["failed-precondition"], /No hay stock de «Correa de distribución» en Inventario/);
  await expectCallableError("ítem inexistente", () => add(second, `inexistente-${runId}`, 1),
    ["not-found"], /ítem de Inventario/);

  // El catálogo muestra el stock actual como referencia, sin costos ni precio interno.
  const catalogItem = (await call(technician, "listarCatalogoTaller", {})).items.find((item) => item.itemId === brakes);
  assert.equal(catalogItem.stock, 5);
  assert.ok(!Object.keys(catalogItem).some((key) => /costo|margen|precioInterno|disponible/i.test(key)));

  // Inventario no cambia: solo se lee.
  assert.equal((await itemRef(brakes).get()).data().stock, 5);
  assert.equal((await itemRef(empty).get()).data().stock, 0);
  console.log("WORK_ORDER_STOCK_OK: stock por OT, sin stock, ítem inexistente, sin reserva e Inventario intacto");
}
