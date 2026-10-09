"use strict";

const {createHash} = require("node:crypto");
const {
  applyInventoryCostedOutflow, applyInventoryEconomicDelta,
  assertCanonicalInventoryQuantity, inventoryEconomicFields,
  normalizeInventoryQuantity, resolveInventoryEconomicState, round,
} = require("./inventoryAcquisition");
const {
  appendPlanningEvent, diagnosisActor, identifier, readApprovalContext,
  requestIdentifier, requireReceptionAccess, scopeFingerprint,
} = require("./workOrderPersistence");

const MATERIAL_TYPES = new Set(["SALIDA_TALLER", "DEVOLUCION_TALLER"]);
// Matches Core INVENTORY_COSTS_READ; custom module profiles grant no cost capability.
const COST_ROLES = new Set(["OWNER", "ADMIN", "COMPRAS", "FINANZAS", "MEMBER"]);
const RETURN_STATES = new Set(["en_cola", "en_diagnostico", "esperando_aprobacion",
  "esperando_repuestos", "en_reparacion", "pendiente_entrega"]);

function fail(HttpsError, code, message) { throw new HttpsError(code, message); }

function onlyFields(raw, allowed, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).some((field) => !allowed.includes(field))) {
    fail(HttpsError, "invalid-argument", "La solicitud de materiales contiene campos no permitidos.");
  }
}

function materialQuantity(value, HttpsError) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 999999999) {
    fail(HttpsError, "invalid-argument", "Ingresa una cantidad entera positiva válida.");
  }
  return value;
}

function inventoryProduct(snapshot, businessId, HttpsError, active = false) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró el producto.");
  const item = snapshot.data();
  if (item.negocioId !== businessId || item.tipoItem !== "producto" ||
      (active && item.estado !== "activo")) {
    fail(HttpsError, "failed-precondition", "El movimiento requiere un producto válido del negocio.");
  }
  if (typeof item.stock !== "number" || !Number.isFinite(item.stock) || item.stock < 0) {
    fail(HttpsError, "failed-precondition", "El producto no tiene un stock válido.");
  }
  return item;
}

function safeProductSnapshot(item, itemId) {
  return {itemId, nombre: String(item.nombre || item.descripcionItem || "Producto"),
    codigoInterno: String(item.codigoInterno || ""), unidad: String(item.unidad || "unidad")};
}

function currency(value, HttpsError) {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    fail(HttpsError, "failed-precondition", "No hay una moneda válida para registrar el movimiento.");
  }
  return value;
}

function approvedScope(data, approval, businessId, otId) {
  const stored = approval.data() || {};
  return data.order.estado === "en_reparacion" && data.order.estadoAprobacion === "aprobada" &&
    stored.negocioId === businessId && stored.otId === otId &&
    stored.scopeHash === scopeFingerprint(data.services);
}

function returnBalance(origin, balance, ids, HttpsError) {
  if (!origin || !balance || origin.tipo !== "SALIDA_TALLER" ||
      origin.movimientoId !== ids.movimientoOrigenId ||
      [origin, balance].some((record) => record.negocioId !== ids.businessId ||
        record.otId !== ids.otId || record.servicioOtId !== ids.servicioOtId) ||
      balance.movimientoOrigenId !== ids.movimientoOrigenId || balance.itemId !== origin.itemId ||
      balance.cantidadSalida !== origin.cantidad || balance.costoSalida !== origin.costoTotal) {
    fail(HttpsError, "failed-precondition", "La salida y su saldo no corresponden a este servicio.");
  }
  const quantity = assertCanonicalInventoryQuantity(origin.cantidad, HttpsError);
  const returned = assertCanonicalInventoryQuantity(balance.cantidadDevuelta, HttpsError);
  if (returned < 0 || returned > quantity ||
      [origin.costoUnitario, origin.costoTotal, balance.costoDevuelto].some((value) =>
        typeof value !== "number" || !Number.isFinite(value) || value < 0) ||
      balance.costoDevuelto > origin.costoTotal) {
    fail(HttpsError, "failed-precondition", "La salida no tiene un saldo de devolución válido.");
  }
  return {returned, remaining: normalizeInventoryQuantity(quantity - returned)};
}

async function materialOperation(request, dependencies, action) {
  const {db, HttpsError, FieldValue} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const returning = action === "DEVOLUCION_TALLER";
  onlyFields(request.data, ["businessId", "otId", "servicioOtId", "cantidad", "requestId",
    returning ? "movimientoOrigenId" : "itemId"], HttpsError);
  const otId = identifier(request.data.otId, "La OT", HttpsError);
  const servicioOtId = identifier(request.data.servicioOtId, "El servicio", HttpsError);
  const cantidad = materialQuantity(request.data.cantidad, HttpsError);
  const requestId = requestIdentifier(request.data.requestId, HttpsError);
  const referenceId = identifier(returning ? request.data.movimientoOrigenId : request.data.itemId,
    returning ? "La salida original" : "El producto", HttpsError);
  const fingerprint = createHash("sha256").update(JSON.stringify({action, otId, servicioOtId,
    cantidad, referenceId, uid: context.uid})).digest("hex");
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const requests = context.businessRef.collection("tallerMaterialRequests");
  const requestRef = requests.doc(requestId);
  const movements = context.businessRef.collection("movimientosInventario");
  const movementRef = movements.doc();
  const balances = context.businessRef.collection("tallerMaterialBalances");
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  return db.runTransaction(async (transaction) => {
    const [data, previous] = await Promise.all([
      readApprovalContext(transaction, context, orderRef, dependencies, "skip"), transaction.get(requestRef),
    ]);
    if (previous.exists) {
      const stored = previous.data();
      if (stored.negocioId !== context.businessId || stored.fingerprint !== fingerprint) {
        fail(HttpsError, "already-exists", "La solicitud ya fue utilizada con otros datos.");
      }
      return {...stored.resultado, sinCambios: true};
    }
    const service = data.services.find((entry) => entry.servicioOtId === servicioOtId);
    if (!service) fail(HttpsError, "not-found", "No se encontró el servicio de esta OT.");
    let itemId, origin, balance, balanceRef, remaining, returned;
    if (returning) {
      if (!RETURN_STATES.has(data.order.estado)) {
        fail(HttpsError, "failed-precondition", "El estado actual de la OT no permite registrar devoluciones.");
      }
      balanceRef = balances.doc(referenceId);
      const [originSnapshot, balanceSnapshot] = await Promise.all([
        transaction.get(movements.doc(referenceId)), transaction.get(balanceRef),
      ]);
      origin = originSnapshot.data(); balance = balanceSnapshot.data();
      ({remaining, returned} = returnBalance(origin, balance,
        {businessId: context.businessId, otId, servicioOtId, movimientoOrigenId: referenceId}, HttpsError));
      if (cantidad > remaining) fail(HttpsError, "failed-precondition", "La devolución supera la cantidad pendiente de esa salida.");
      itemId = identifier(origin.itemId, "El producto de origen", HttpsError);
    } else {
      const approval = await transaction.get(context.businessRef.collection("otApprovalState").doc(otId));
      if (!approvedScope(data, approval, context.businessId, otId) || service.estado !== "en_progreso") {
        fail(HttpsError, "failed-precondition", "La OT debe estar en reparación, con aprobación vigente y el servicio en progreso.");
      }
      itemId = referenceId;
      if (!service.productos?.some((product) => product.itemId === itemId)) {
        fail(HttpsError, "failed-precondition", "El producto no pertenece al alcance aprobado de este servicio.");
      }
      balanceRef = balances.doc(movementRef.id);
    }
    const itemRef = context.businessRef.collection("inventario").doc(itemId);
    const item = inventoryProduct(await transaction.get(itemRef), context.businessId, HttpsError, !returning);
    const moneda = currency(returning ? origin.moneda : data.order.moneda || data.businessData.monedaCodigo, HttpsError);
    const before = resolveInventoryEconomicState({item, operationCurrency: moneda}, HttpsError);
    let after, costoUnitario, costoTotal, costoFuente;
    if (returning) {
      costoUnitario = origin.costoUnitario;
      costoFuente = origin.costoFuente;
      const cumulativeQuantity = normalizeInventoryQuantity(returned + cantidad);
      // Cumulative valuation avoids rounding each partial return independently. The final return closes V exactly.
      const cumulativeCost = cantidad === remaining ? origin.costoTotal
        : Math.min(origin.costoTotal, round(cumulativeQuantity * costoUnitario));
      costoTotal = round(cumulativeCost - balance.costoDevuelto);
      if (costoTotal < 0) fail(HttpsError, "failed-precondition", "El valor pendiente de devolución es inconsistente.");
      after = applyInventoryEconomicDelta(before, {quantityDelta: cantidad, valueDelta: costoTotal}, HttpsError);
    } else {
      if (before.stock < cantidad) fail(HttpsError, "failed-precondition", "No existe stock suficiente para registrar esta salida.");
      const outflow = applyInventoryCostedOutflow(before, {cantidad, costoUnitario: before.average}, HttpsError);
      ({costoUnitario, costoTotal} = outflow);
      costoFuente = "costoPromedio";
      after = outflow.next;
    }
    const timestamp = FieldValue.serverTimestamp();
    const productoSnapshot = safeProductSnapshot(returning ? origin.productoSnapshot || {} : item, itemId);
    const movement = {movimientoId: movementRef.id, negocioId: context.businessId, otId, servicioOtId,
      tipo: action, itemId, cantidad, costoUnitario, costoTotal, costoFuente, moneda,
      stockAnterior: before.stock, stockPosterior: after.stock,
      valorInventarioAnterior: before.value, valorInventarioPosterior: after.value,
      costoPromedioAnterior: before.average, costoPromedioPosterior: after.average,
      movimientoOrigenId: returning ? referenceId : null, productoSnapshot,
      usuarioUid: context.uid, usuarioSnapshot: actorSnapshot, fecha: new Date().toISOString(), creadoEn: timestamp};
    transaction.update(itemRef, {stock: after.stock, ...inventoryEconomicFields(after, timestamp),
      actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    transaction.create(movementRef, movement);
    if (returning) {
      transaction.update(balanceRef, {cantidadDevuelta: normalizeInventoryQuantity(returned + cantidad),
        costoDevuelto: round(balance.costoDevuelto + costoTotal), actualizadoEn: timestamp});
    } else {
      transaction.create(balanceRef, {negocioId: context.businessId, otId, servicioOtId,
        movimientoOrigenId: movementRef.id, itemId, cantidadSalida: cantidad, cantidadDevuelta: 0,
        costoSalida: costoTotal, costoDevuelto: 0, actualizadoEn: timestamp});
    }
    transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    appendPlanningEvent(transaction, orderRef, {businessId: context.businessId, actorUid: context.uid,
      actorSnapshot, timestamp, type: returning ? "material_devuelto" : "material_consumido",
      detail: {movimientoId: movementRef.id, movimientoOrigenId: movement.movimientoOrigenId,
        servicioOtId, itemId, productoNombre: productoSnapshot.nombre, cantidad}});
    // Mutation receipts never include internal economic data, including on replay after a permission change.
    const resultado = {movimientoId: movementRef.id, tipo: action, stockPosterior: after.stock, sinCambios: false};
    transaction.create(requestRef, {negocioId: context.businessId, otId, servicioOtId, fingerprint,
      operacion: action, uidUsuario: context.uid, resultado, creadoEn: timestamp});
    return resultado;
  });
}

const registrarSalidaMaterialOTHandler = (request, deps) => materialOperation(request, deps, "SALIDA_TALLER");
const registrarDevolucionMaterialOTHandler = (request, deps) => materialOperation(request, deps, "DEVOLUCION_TALLER");

async function obtenerMaterialesOTHandler(request, dependencies) {
  const {db, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  onlyFields(request.data, ["businessId", "otId"], HttpsError);
  const otId = identifier(request.data.otId, "La OT", HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  return db.runTransaction(async (transaction) => {
    const [data, movementSnapshot, approval] = await Promise.all([
      readApprovalContext(transaction, context, orderRef, dependencies, "skip"),
      transaction.get(context.businessRef.collection("movimientosInventario").where("otId", "==", otId)),
      transaction.get(context.businessRef.collection("otApprovalState").doc(otId)),
    ]);
    const puedeVerCostos = !data.membership.profileId && COST_ROLES.has(data.membership.rol);
    const movements = movementSnapshot.docs.map((entry) => entry.data()).filter((entry) =>
      entry.negocioId === context.businessId && MATERIAL_TYPES.has(entry.tipo));
    const exits = movements.filter((entry) => entry.tipo === "SALIDA_TALLER");
    const balanceDocs = await Promise.all(exits.map((entry) =>
      transaction.get(context.businessRef.collection("tallerMaterialBalances").doc(entry.movimientoId))));
    const balances = new Map(balanceDocs.map((entry) => [entry.id, entry.data()]));
    const ids = [...new Set([...data.services.flatMap((service) => (service.productos || []).map((p) => p.itemId)),
      ...movements.map((entry) => entry.itemId)])];
    const itemDocs = await Promise.all(ids.map((id) => transaction.get(context.businessRef.collection("inventario").doc(id))));
    const items = new Map(itemDocs.map((entry) => [entry.id, entry.data()]));
    const enabled = approvedScope(data, approval, context.businessId, otId);
    return {puedeVerCostos, servicios: data.services.map((service) => {
      const own = movements.filter((entry) => entry.servicioOtId === service.servicioOtId);
      const ownIds = [...new Set([...(service.productos || []).map((p) => p.itemId), ...own.map((m) => m.itemId)])];
      return {servicioOtId: service.servicioOtId, puedeConsumir: enabled && service.estado === "en_progreso",
        puedeDevolver: RETURN_STATES.has(data.order.estado),
        productos: ownIds.map((itemId) => {
          const item = items.get(itemId);
          const valid = item?.negocioId === context.businessId && item.tipoItem === "producto";
          const planned = (service.productos || []).filter((p) => p.itemId === itemId);
          return {itemId, nombre: planned[0]?.productoSnapshot?.nombre ||
            own.find((m) => m.itemId === itemId)?.productoSnapshot?.nombre || (valid ? item.nombre : "Producto no disponible"),
          planificado: normalizeInventoryQuantity(planned.reduce((sum, p) => sum + p.cantidad, 0)),
          consumido: normalizeInventoryQuantity(own.filter((m) => m.itemId === itemId)
            .reduce((sum, m) => sum + (m.tipo === "SALIDA_TALLER" ? m.cantidad : -m.cantidad), 0)),
          stock: valid && typeof item.stock === "number" && Number.isFinite(item.stock) ? item.stock : null,
          disponible: valid && item.estado === "activo" && planned.length > 0};
        }),
        movimientos: own.sort((a, b) => a.fecha.localeCompare(b.fecha)).map((movement) => {
          const pending = movement.tipo === "SALIDA_TALLER" ? returnBalance(movement,
            balances.get(movement.movimientoId), {businessId: context.businessId, otId,
              servicioOtId: service.servicioOtId, movimientoOrigenId: movement.movimientoId}, HttpsError) : null;
          return {movimientoId: movement.movimientoId, movimientoOrigenId: movement.movimientoOrigenId,
            tipo: movement.tipo, itemId: movement.itemId, cantidad: movement.cantidad,
            nombre: movement.productoSnapshot?.nombre || "Producto", fecha: movement.fecha,
            usuarioNombre: movement.usuarioSnapshot?.nombre || movement.usuarioSnapshot?.correo || "Usuario no disponible",
            ...(pending ? {cantidadDevuelta: pending.returned, maximoDevolvible: pending.remaining} : {}),
            ...(puedeVerCostos ? {costoUnitario: movement.costoUnitario, costoTotal: movement.costoTotal, moneda: movement.moneda} : {})};
        })};
    })};
  });
}

module.exports = {registrarSalidaMaterialOTHandler, registrarDevolucionMaterialOTHandler, obtenerMaterialesOTHandler};
