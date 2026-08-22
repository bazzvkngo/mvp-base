const WRITE_ROLES = ["OWNER", "ADMIN"];
const ITEM_TYPES = new Set(["producto", "servicio", "actividad"]);
const EPSILON = 0.000001;
const {adaptDocumentLocalization} = require("./localization");
const {buildAuthoritativeCompanySnapshot, resolveCompanySnapshot} = require("./companySnapshot");
const {
  calculateAcquisitionAmounts,
  calculateWeightedAverage,
  legacyPaidCost,
} = require("./inventoryAcquisition");

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function text(value, max = 2000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function id(value, label, HttpsError) {
  const result = text(value, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(result)) {
    fail(HttpsError, "invalid-argument", `${label} no es valido.`);
  }
  return result;
}

function requestId(value, HttpsError) {
  const result = text(value, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(result)) {
    fail(HttpsError, "invalid-argument", "No se pudo validar la solicitud.");
  }
  return result;
}

function quantity(value, label, HttpsError) {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result) || result < 0) {
    fail(HttpsError, "invalid-argument", `${label} debe ser una cantidad valida.`);
  }
  return result;
}

function chileDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
  }).format(date);
}

function chileYear(date) {
  return Number(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
  }).format(date));
}

function formatReceptionNumber(year, sequence) {
  return `REC-${year}-${String(sequence).padStart(4, "0")}`;
}

function retryable(error) {
  const code = Number(error?.code);
  const message = String(error?.details || error?.message || "").toLowerCase();
  return code === 10 || (code === 3 && message.includes("transaction is invalid"));
}

async function transactionRetry(db, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await db.runTransaction(operation);
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

async function access(request, dependencies) {
  return dependencies.requireBusinessAccess(
    request,
    {db: dependencies.db, HttpsError: dependencies.HttpsError},
    {roles: WRITE_ROLES}
  );
}

function confirmedTotals(snapshot, excludedId = "") {
  const totals = new Map();
  snapshot.docs.forEach((entry) => {
    const reception = entry.data() || {};
    if (entry.id === excludedId || reception.estado !== "confirmada") return;
    (reception.items || []).forEach((line) => {
      const key = text(line.ordenLineaId || line.lineaId, 160);
      totals.set(key, (totals.get(key) || 0) + Number(line.cantidad || 0));
    });
  });
  return totals;
}

function responseState(order) {
  const state = text(order?.respuestaProveedor?.estado, 20).toLowerCase();
  return ["confirmada", "rechazada"].includes(state) ? state : "pendiente";
}

function assertReceivableOrder(order, businessId, HttpsError) {
  if (!order || order.negocioId !== businessId) {
    fail(HttpsError, "not-found", "No se encontro la orden de compra.");
  }
  if (order.estado !== "emitida") {
    fail(HttpsError, "failed-precondition", "Solo se reciben ordenes emitidas.");
  }
  if (responseState(order) === "rechazada") {
    fail(
      HttpsError,
      "failed-precondition",
      "La respuesta del proveedor esta rechazada. Corrigela antes de registrar una recepcion."
    );
  }
}

function buildLine(orderLine, received, amount) {
  const tipoItem = ITEM_TYPES.has(orderLine.tipoItem) ? orderLine.tipoItem : "producto";
  return {
    lineaId: orderLine.lineaId,
    ordenLineaId: orderLine.lineaId,
    itemId: orderLine.itemId,
    codigo: text(orderLine.codigo, 100),
    nombre: text(orderLine.nombre, 240),
    descripcion: text(orderLine.descripcion, 3000),
    tipoItem,
    unidad: text(orderLine.unidad, 80) || "unidad",
    cantidadSolicitada: Number(orderLine.cantidad || 0),
    cantidadRecibidaAnterior: received,
    cantidad: amount,
    costoUnitario: Number(orderLine.costoUnitario || 0),
    descuentoPct: Number(orderLine.descuentoPct || 0),
    inventarioSnapshot: orderLine.inventarioSnapshot || {},
  };
}

function normalizeDraft(raw, reception, HttpsError) {
  const date = text(raw?.fechaRecepcion, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail(HttpsError, "invalid-argument", "La fecha de recepcion no es valida.");
  }
  const supplied = Array.isArray(raw?.items) ? raw.items : [];
  const amounts = new Map(supplied.map((line, index) => [
    id(line?.lineaId || line?.ordenLineaId, `Linea ${index + 1}`, HttpsError),
    quantity(line?.cantidad, `Linea ${index + 1}`, HttpsError),
  ]));
  const items = (reception.items || []).map((line) => ({
    ...line,
    cantidad: amounts.has(line.lineaId) ? amounts.get(line.lineaId) : 0,
  }));
  if (!items.some((line) => line.cantidad > EPSILON)) {
    fail(HttpsError, "invalid-argument", "Registra al menos una cantidad recibida.");
  }
  return {
    fechaRecepcion: date,
    observaciones: text(raw?.observaciones, 4000),
    items,
  };
}

function assertNoOverreceipt(order, items, totals, HttpsError) {
  const orderLines = new Map((order.items || []).map((line) => [line.lineaId, line]));
  items.forEach((line) => {
    const ordered = Number(orderLines.get(line.ordenLineaId)?.cantidad || 0);
    const already = Number(totals.get(line.ordenLineaId) || 0);
    if (!orderLines.has(line.ordenLineaId) || already + line.cantidad > ordered + EPSILON) {
      fail(
        HttpsError,
        "failed-precondition",
        `La cantidad de ${line.nombre || "un item"} supera lo pendiente por recibir.`
      );
    }
  });
}

async function crearRecepcionDesdeOrdenHandler(request, dependencies, now = new Date()) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const orderId = id(request?.data?.ordenCompraId, "La orden", HttpsError);
  const operationId = requestId(request?.data?.requestId, HttpsError);
  const orderRef = businessRef.collection("ordenesCompra").doc(orderId);
  const operationRef = businessRef.collection("receptionCreateRequests").doc(operationId);
  const year = chileYear(now);
  const counterRef = businessRef.collection("receptionCounters").doc(String(year));
  const receptionRef = businessRef.collection("recepciones").doc();
  const receptionsQuery = businessRef.collection("recepciones")
    .where("ordenCompraId", "==", orderId);

  return transactionRetry(db, async (transaction) => {
    const operation = await transaction.get(operationRef);
    if (operation.exists) {
      const data = operation.data() || {};
      if (data.uidUsuario !== uid || data.ordenCompraId !== orderId) {
        fail(HttpsError, "already-exists", "La solicitud ya fue usada.");
      }
      const existing = await transaction.get(
        businessRef.collection("recepciones").doc(data.recepcionId)
      );
      return {recepcion: {id: existing.id, ...existing.data()}, idempotent: true};
    }
    const [orderSnapshot, counterSnapshot, receptions, businessSnapshot, companyProfileSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(counterRef),
      transaction.get(receptionsQuery),
      transaction.get(businessRef),
      transaction.get(businessRef.collection("empresa").doc("perfil")),
    ]);
    const order = orderSnapshot.data();
    assertReceivableOrder(order, businessId, HttpsError);
    const totals = confirmedTotals(receptions);
    const items = (order.items || [])
      .map((line) => {
        const received = totals.get(line.lineaId) || 0;
        return buildLine(line, received, Math.max(0, Number(line.cantidad) - received));
      })
      .filter((line) => line.cantidad > EPSILON)
      .slice(0, 200);
    if (!items.length) {
      fail(HttpsError, "failed-precondition", "La orden ya fue recibida completamente.");
    }
    const current = Number(counterSnapshot.data()?.lastNumber || 0);
    const sequence = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatReceptionNumber(year, sequence);
    const timestamp = FieldValue.serverTimestamp();
    const localization = adaptDocumentLocalization(order);
    const stored = {
      modeloRecepcionVersion: 1,
      recepcionId: receptionRef.id,
      negocioId: businessId,
      numero,
      anio: year,
      correlativo: sequence,
      estado: "borrador",
      paisCodigo: localization.paisCodigo,
      moneda: localization.moneda,
      locale: localization.locale,
      impuestoNombre: localization.impuestoNombre,
      tasaIva: localization.tasaIva,
      empresaSnapshot: resolveCompanySnapshot(
        order,
        buildAuthoritativeCompanySnapshot({
          businessId,
          business: businessSnapshot.data() || {},
          profile: companyProfileSnapshot.data() || {},
        })
      ),
      fechaRecepcion: chileDate(now),
      observaciones: "",
      ordenCompraId: orderId,
      ordenCompraNumero: text(order.numero, 120),
      proveedorId: order.proveedorId,
      proveedorSnapshot: order.proveedorSnapshot || {},
      respuestaProveedorEstado: responseState(order),
      items,
      stockAplicado: false,
      stockAplicadoEn: null,
      compraId: "",
      compraNumero: "",
      creadoPorUid: uid,
      actualizadoPorUid: uid,
      creadoEn: timestamp,
      actualizadoEn: timestamp,
    };
    transaction.set(counterRef, {
      negocioId: businessId,
      year,
      lastNumber: sequence,
      actualizadoEn: timestamp,
    });
    transaction.set(receptionRef, stored);
    transaction.set(operationRef, {
      negocioId: businessId,
      ordenCompraId: orderId,
      recepcionId: receptionRef.id,
      uidUsuario: uid,
      creadoEn: timestamp,
    });
    return {
      recepcion: {...stored, id: receptionRef.id, creadoEn: null, actualizadoEn: null},
      idempotent: false,
    };
  });
}

async function actualizarRecepcionBorradorHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const receptionId = id(request?.data?.recepcionId, "La recepcion", HttpsError);
  const receptionRef = businessRef.collection("recepciones").doc(receptionId);
  return transactionRetry(db, async (transaction) => {
    const snapshot = await transaction.get(receptionRef);
    if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontro la recepcion.");
    const reception = snapshot.data() || {};
    if (reception.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes editar esta recepcion.");
    if (reception.estado !== "borrador" || reception.stockAplicado) {
      fail(HttpsError, "failed-precondition", "Solo puedes editar recepciones preparadas.");
    }
    const orderRef = businessRef.collection("ordenesCompra").doc(reception.ordenCompraId);
    const receptionsQuery = businessRef.collection("recepciones")
      .where("ordenCompraId", "==", reception.ordenCompraId);
    const [orderSnapshot, receptions] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(receptionsQuery),
    ]);
    const order = orderSnapshot.data();
    assertReceivableOrder(order, businessId, HttpsError);
    const normalized = normalizeDraft(request?.data?.recepcion, reception, HttpsError);
    assertNoOverreceipt(order, normalized.items, confirmedTotals(receptions, receptionId), HttpsError);
    const update = {
      ...normalized,
      respuestaProveedorEstado: responseState(order),
      actualizadoPorUid: uid,
      actualizadoEn: FieldValue.serverTimestamp(),
    };
    transaction.update(receptionRef, update);
    return {recepcion: {id: receptionId, ...reception, ...update, actualizadoEn: null}};
  });
}

async function confirmarRecepcionHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const receptionId = id(request?.data?.recepcionId, "La recepcion", HttpsError);
  const operationId = requestId(request?.data?.requestId, HttpsError);
  const receptionRef = businessRef.collection("recepciones").doc(receptionId);
  const operationRef = businessRef.collection("receptionConfirmRequests").doc(operationId);
  return transactionRetry(db, async (transaction) => {
    const operation = await transaction.get(operationRef);
    if (operation.exists) {
      const operationData = operation.data() || {};
      if (operationData.uidUsuario !== uid || operationData.recepcionId !== receptionId) {
        fail(HttpsError, "already-exists", "La solicitud ya fue usada.");
      }
      const existing = await transaction.get(receptionRef);
      return {recepcion: {id: existing.id, ...existing.data()}, idempotent: true};
    }
    const snapshot = await transaction.get(receptionRef);
    if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontro la recepcion.");
    const reception = snapshot.data() || {};
    if (reception.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes confirmar esta recepcion.");
    if (reception.estado === "confirmada" && reception.stockAplicado) {
      return {recepcion: {id: receptionId, ...reception}, idempotent: true};
    }
    if (reception.estado !== "borrador" || reception.stockAplicado) {
      fail(HttpsError, "failed-precondition", "La recepcion no esta preparada.");
    }
    const orderRef = businessRef.collection("ordenesCompra").doc(reception.ordenCompraId);
    const receptionsQuery = businessRef.collection("recepciones")
      .where("ordenCompraId", "==", reception.ordenCompraId);
    const [orderSnapshot, receptions] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(receptionsQuery),
    ]);
    const order = orderSnapshot.data();
    assertReceivableOrder(order, businessId, HttpsError);
    assertNoOverreceipt(order, reception.items || [], confirmedTotals(receptions, receptionId), HttpsError);
    const productLines = (reception.items || []).filter((line) =>
      line.tipoItem === "producto" && Number(line.cantidad) > EPSILON
    );
    const inventoryIds = [...new Set(productLines.map((line) => line.itemId))];
    const inventoryRefs = inventoryIds.map((itemId) =>
      businessRef.collection("inventario").doc(itemId)
    );
    const inventorySnapshots = inventoryRefs.length
      ? await transaction.getAll(...inventoryRefs)
      : [];
    const inventory = new Map(inventorySnapshots.map((entry) => [entry.id, entry]));
    const timestamp = FieldValue.serverTimestamp();
    const receptionCurrency = text(reception.moneda, 12).toUpperCase() || "CLP";
    const providerSnapshot = reception.proveedorSnapshot || {};
    const running = new Map();
    productLines.forEach((line) => {
      const inventorySnapshot = inventory.get(line.itemId);
      if (!inventorySnapshot?.exists) {
        fail(HttpsError, "not-found", `No se encontro el item ${line.nombre}.`);
      }
      const item = inventorySnapshot.data() || {};
      if (item.negocioId && item.negocioId !== businessId) {
        fail(HttpsError, "permission-denied", "El item pertenece a otro negocio.");
      }
      const previous = running.get(line.itemId) || {
        stock: Number(item.stock || 0),
        costoPromedio: legacyPaidCost(item),
        moneda: text(item.costoPromedioMoneda, 12).toUpperCase(),
      };
      if (
        previous.stock > EPSILON &&
        previous.moneda &&
        previous.moneda !== receptionCurrency
      ) {
        fail(
          HttpsError,
          "failed-precondition",
          `No se puede promediar ${line.nombre || "el producto"} en monedas distintas.`
        );
      }
      const amounts = calculateAcquisitionAmounts({
        cantidad: line.cantidad,
        costoUnitario: line.costoUnitario,
        descuentoPct: line.descuentoPct,
        tasaImpuestoCompra: Number(reception.tasaIva || 0) * 100,
      });
      const after = previous.stock + amounts.cantidad;
      const average = calculateWeightedAverage({
        stockAnterior: previous.stock,
        costoPromedioAnterior: previous.costoPromedio,
        cantidadEntrada: amounts.cantidad,
        costoEntrada: amounts.costoPagadoUnitario,
      });
      running.set(line.itemId, {
        stock: after,
        costoPromedio: average,
        moneda: receptionCurrency,
        ultimoCosto: amounts.costoPagadoUnitario,
        ultimaAdquisicionId: `${receptionId}__${line.lineaId}`,
      });
      const movementRef = businessRef.collection("movimientosInventario")
        .doc(`${receptionId}__${line.lineaId}`);
      const acquisitionRef = businessRef.collection("adquisicionesInventario")
        .doc(`${receptionId}__${line.lineaId}`);
      transaction.create(movementRef, {
        negocioId: businessId,
        tipo: "entrada_recepcion",
        tipoOrigen: "recepcion",
        recepcionId: receptionId,
        recepcionNumero: reception.numero,
        ordenCompraId: reception.ordenCompraId,
        ordenCompraNumero: reception.ordenCompraNumero,
        itemId: line.itemId,
        lineaId: line.lineaId,
        adquisicionId: acquisitionRef.id,
        cantidad: amounts.cantidad,
        costoUnitarioAplicado: amounts.costoPagadoUnitario,
        costoTotal: amounts.costoPagadoTotal,
        moneda: receptionCurrency,
        stockAnterior: previous.stock,
        stockResultante: after,
        creadoPorUid: uid,
        creadoEn: timestamp,
      });
      transaction.create(acquisitionRef, {
        modeloAdquisicionVersion: 1,
        adquisicionId: acquisitionRef.id,
        negocioId: businessId,
        itemId: line.itemId,
        lineaId: line.lineaId,
        productoSnapshot: {
          inventarioId: line.itemId,
          codigoInterno: text(
            line.inventarioSnapshot?.codigoInterno || line.codigo,
            100
          ),
          nombre: text(line.inventarioSnapshot?.nombre || line.nombre, 240),
          tipoItem: "producto",
          unidad: text(line.inventarioSnapshot?.unidad || line.unidad, 80) || "unidad",
        },
        proveedorId: text(reception.proveedorId, 160),
        proveedorSnapshot: {
          proveedorId: text(
            providerSnapshot.proveedorId || reception.proveedorId,
            160
          ),
          razonSocial: text(
            providerSnapshot.razonSocial || providerSnapshot.nombre,
            240
          ),
          identificadorFiscalTipo: text(
            providerSnapshot.identificadorFiscalTipo,
            40
          ),
          identificadorFiscalValor: text(
            providerSnapshot.identificadorFiscalValor || providerSnapshot.rut,
            80
          ),
        },
        ...amounts,
        moneda: receptionCurrency,
        fechaAdquisicion: text(reception.fechaRecepcion, 10),
        ordenCompraId: text(reception.ordenCompraId, 160),
        ordenCompraNumero: text(reception.ordenCompraNumero, 120),
        recepcionId: receptionId,
        recepcionNumero: text(reception.numero, 120),
        compraId: text(reception.compraId, 160),
        compraNumero: text(reception.compraNumero, 120),
        movimientoInventarioId: movementRef.id,
        registradoPorUid: uid,
        creadoEn: timestamp,
      });
    });
    running.forEach((state, itemId) => {
      transaction.update(businessRef.collection("inventario").doc(itemId), {
        stock: state.stock,
        costoPromedio: state.costoPromedio,
        costoPromedioMoneda: state.moneda,
        ultimoCosto: state.ultimoCosto,
        ultimoProveedor: {
          proveedorId: text(reception.proveedorId, 160),
          razonSocial: text(
            providerSnapshot.razonSocial || providerSnapshot.nombre,
            240
          ),
        },
        ultimaAdquisicionId: state.ultimaAdquisicionId,
        ultimaAdquisicionEn: timestamp,
        actualizadoEn: timestamp,
      });
    });
    const update = {
      estado: "confirmada",
      stockAplicado: true,
      stockAplicadoEn: timestamp,
      confirmadoPorUid: uid,
      confirmadoEn: timestamp,
      actualizadoPorUid: uid,
      actualizadoEn: timestamp,
    };
    transaction.update(receptionRef, update);
    transaction.set(operationRef, {
      negocioId: businessId,
      recepcionId: receptionId,
      uidUsuario: uid,
      creadoEn: timestamp,
    });
    return {
      recepcion: {id: receptionId, ...reception, ...update, actualizadoEn: null},
      productosActualizados: running.size,
      idempotent: false,
    };
  });
}

async function cancelarRecepcionBorradorHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const receptionId = id(request?.data?.recepcionId, "La recepcion", HttpsError);
  const receptionRef = businessRef.collection("recepciones").doc(receptionId);
  return transactionRetry(db, async (transaction) => {
    const snapshot = await transaction.get(receptionRef);
    if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontro la recepcion.");
    const reception = snapshot.data() || {};
    if (reception.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes cancelar esta recepcion.");
    if (reception.estado === "cancelada") return {recepcion: {id: receptionId, ...reception}, idempotent: true};
    if (reception.estado !== "borrador" || reception.stockAplicado) {
      fail(HttpsError, "failed-precondition", "Solo puedes cancelar recepciones preparadas.");
    }
    const timestamp = FieldValue.serverTimestamp();
    const update = {
      estado: "cancelada",
      canceladoPorUid: uid,
      canceladoEn: timestamp,
      actualizadoPorUid: uid,
      actualizadoEn: timestamp,
    };
    transaction.update(receptionRef, update);
    return {recepcion: {id: receptionId, ...reception, ...update, actualizadoEn: null}};
  });
}

module.exports = {
  actualizarRecepcionBorradorHandler,
  cancelarRecepcionBorradorHandler,
  confirmarRecepcionHandler,
  crearRecepcionDesdeOrdenHandler,
  confirmedTotals,
  formatReceptionNumber,
  responseState,
};
