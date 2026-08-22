const {createHash} = require("node:crypto");
const {adaptDocumentLocalization, documentLocalizationSnapshot} = require("./localization");
const {buildAuthoritativeCompanySnapshot, resolveCompanySnapshot} = require("./companySnapshot");
const {fiscalSnapshotFields} = require("./fiscalIdentifier");

const MODEL_VERSION = 2;
const VAT_RATE = 0.19;
const {PURCHASE_WRITE_ROLES: WRITE_ROLES} = require("./rbac");
const TYPES = new Set(["producto", "servicio", "actividad"]);
const DOCUMENT_TYPES = new Set(["factura", "boleta", "otro", "sin_documento"]);
const MAXIMUM_AMOUNT_MESSAGE = "El monto de la compra supera el máximo permitido.";

function fail(HttpsError, code, message) { throw new HttpsError(code, message); }
function text(value, max = 2000) { return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max); }
function id(value, label, HttpsError) {
  const result = text(value, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(result)) fail(HttpsError, "invalid-argument", `${label} no es válido.`);
  return result;
}
function requestId(value, HttpsError) {
  const result = text(value, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(result)) fail(HttpsError, "invalid-argument", "No se pudo validar la solicitud.");
  return result;
}
function number(value, label, HttpsError, {minimum = 0, maximum = Infinity} = {}) {
  if (value === "" || value == null) fail(HttpsError, "invalid-argument", `${label} es obligatorio.`);
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) fail(HttpsError, "invalid-argument", `${label} debe ser numérico.`);
  if (result < minimum || result > maximum) fail(HttpsError, "invalid-argument", `${label} está fuera del rango permitido.`);
  return result;
}
function safeMoney(values, HttpsError) {
  if (values.some((value) => !Number.isFinite(value) || !Number.isSafeInteger(value))) {
    fail(HttpsError, "invalid-argument", MAXIMUM_AMOUNT_MESSAGE);
  }
}
function date(value, label, HttpsError, required = false) {
  const result = text(value, 10);
  if (required && !result) fail(HttpsError, "invalid-argument", `${label} es obligatoria.`);
  if (result && !/^\d{4}-\d{2}-\d{2}$/.test(result)) fail(HttpsError, "invalid-argument", `${label} no es válida.`);
  return result;
}
function chileParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {year: Number(map.year), value: `${map.year}-${map.month}-${map.day}`};
}
function lineInput(raw, index, HttpsError) {
  return {
    lineaId: id(raw?.lineaId || `linea-${index + 1}`, "La línea", HttpsError),
    itemId: id(raw?.itemId, `Ítem ${index + 1}`, HttpsError),
    cantidad: number(raw?.cantidad, `Ítem ${index + 1}: cantidad`, HttpsError, {minimum: Number.MIN_VALUE}),
    costoUnitario: number(raw?.costoUnitario, `Ítem ${index + 1}: costo unitario`, HttpsError),
    descuentoPct: number(raw?.descuentoPct ?? 0, `Ítem ${index + 1}: descuento`, HttpsError, {maximum: 100}),
  };
}
function input(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(HttpsError, "invalid-argument", "Los datos de la compra no son válidos.");
  if (!Array.isArray(raw.items) || !raw.items.length) fail(HttpsError, "invalid-argument", "Agrega al menos un ítem a la compra.");
  if (raw.items.length > 200) fail(HttpsError, "invalid-argument", "La compra admite hasta 200 ítems.");
  const items = raw.items.map((item, index) => lineInput(item, index, HttpsError));
  if (new Set(items.map((item) => item.lineaId)).size !== items.length) fail(HttpsError, "invalid-argument", "Las líneas están duplicadas.");
  const tipoDocumento = DOCUMENT_TYPES.has(raw.tipoDocumento) ? raw.tipoDocumento : "sin_documento";
  return {
    proveedorId: id(raw.proveedorId, "El proveedor", HttpsError), items,
    fechaCompra: date(raw.fechaCompra, "La fecha de compra", HttpsError, true),
    fechaDocumento: date(raw.fechaDocumento, "La fecha del documento", HttpsError),
    tipoDocumento, numeroDocumentoProveedor: text(raw.numeroDocumentoProveedor, 120),
    condicionesPago: text(raw.condicionesPago, 2000), observaciones: text(raw.observaciones, 4000),
  };
}
function provider(snapshot, businessId, providerId, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró el proveedor.");
  const raw = snapshot.data() || {};
  if (raw.negocioId !== businessId || text(raw.proveedorId, 160) !== providerId) fail(HttpsError, "failed-precondition", "El proveedor es inconsistente.");
  if (raw.estado !== "activo") fail(HttpsError, "failed-precondition", "El proveedor no está disponible.");
  if (!text(raw.razonSocial, 240)) fail(HttpsError, "failed-precondition", "El proveedor no tiene razón social.");
  return {
    proveedorId: text(raw.proveedorId, 160), ...fiscalSnapshotFields(raw), razonSocial: text(raw.razonSocial, 240), nombreFantasia: text(raw.nombreFantasia, 240),
    giro: text(raw.giro, 240), personaContacto: text(raw.personaContacto, 200), email: text(raw.email, 240), telefono: text(raw.telefono, 100),
    direccion: text(raw.direccion, 300), regionCodigo: text(raw.regionCodigo, 20), regionNombre: text(raw.regionNombre, 160),
    comunaCodigo: text(raw.comunaCodigo, 20), comunaNombre: text(raw.comunaNombre, 160), condicionesPago: text(raw.condicionesPago, 2000),
  };
}
function inventory(snapshot, businessId, itemId, HttpsError, active = true) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró un ítem de inventario.");
  const raw = snapshot.data() || {};
  if (raw.negocioId && raw.negocioId !== businessId) fail(HttpsError, "failed-precondition", "El ítem pertenece a otro negocio.");
  if (active && raw.estado && raw.estado !== "activo") fail(HttpsError, "failed-precondition", "El ítem no está disponible.");
  const tipoItem = TYPES.has(raw.tipoItem) ? raw.tipoItem : "producto";
  const nombre = text(raw.nombre || raw.descripcionItem, 240);
  if (!nombre) fail(HttpsError, "failed-precondition", "El ítem no tiene nombre.");
  return {inventarioId: itemId, codigoInterno: text(raw.codigoInterno || raw.sku, 100), nombre, descripcion: text(raw.descripcion, 3000), tipoItem, unidad: text(raw.unidad, 80) || "unidad", modeloInventarioVersion: Number(raw.modeloInventarioVersion || 1)};
}
function storedLine(value, snapshot, HttpsError) {
  const subtotalLinea = Math.round(value.cantidad * value.costoUnitario);
  const descuentoLinea = Math.round((subtotalLinea * value.descuentoPct) / 100);
  const totalLinea = subtotalLinea - descuentoLinea;
  safeMoney([subtotalLinea, descuentoLinea, totalLinea], HttpsError);
  return {lineaId: value.lineaId, itemId: value.itemId, codigo: snapshot.codigoInterno, nombre: snapshot.nombre, descripcion: snapshot.descripcion, tipoItem: snapshot.tipoItem, unidad: snapshot.unidad, cantidad: value.cantidad, costoUnitario: value.costoUnitario, descuentoPct: value.descuentoPct, subtotalLinea, descuentoLinea, totalLinea, inventarioSnapshot: snapshot};
}
function totals(items, HttpsError, taxRate = VAT_RATE) {
  const subtotal = items.reduce((sum, item) => sum + item.subtotalLinea, 0);
  const descuentoTotal = items.reduce((sum, item) => sum + item.descuentoLinea, 0);
  const neto = subtotal - descuentoTotal;
  const iva = Math.round(neto * taxRate);
  const total = neto + iva;
  safeMoney([subtotal, descuentoTotal, neto, iva, total], HttpsError);
  return {subtotal, descuentoTotal, neto, iva, total};
}
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function access(request, dependencies) {
  return dependencies.requireBusinessAccess(request, {db: dependencies.db, HttpsError: dependencies.HttpsError}, {roles: WRITE_ROLES});
}
function formatNumber(year, sequence) { return `COM-${year}-${String(sequence).padStart(4, "0")}`; }
function baseStored({businessId, uid, purchaseId, numero, sequence, now, normalized, proveedorSnapshot, items, localization, empresaSnapshot, origin = {}, timestamp, HttpsError}) {
  const location = localization || adaptDocumentLocalization({});
  return {modeloCompraVersion: MODEL_VERSION, compraId: purchaseId, negocioId: businessId, numero, anio: now.year, correlativo: sequence, estado: "borrador", paisCodigo: location.paisCodigo, moneda: location.moneda, locale: location.locale, impuestoNombre: location.impuestoNombre, tasaIva: location.tasaIva, empresaSnapshot, proveedorId: normalized.proveedorId, proveedorSnapshot, ...origin, items, ...totals(items, HttpsError, location.tasaIva), fechaCompra: normalized.fechaCompra, fechaDocumento: normalized.fechaDocumento, tipoDocumento: normalized.tipoDocumento, numeroDocumentoProveedor: normalized.numeroDocumentoProveedor, condicionesPago: normalized.condicionesPago || text(proveedorSnapshot.condicionesPago, 2000), observaciones: normalized.observaciones, stockGestionadoPor: "recepcion", stockAplicado: false, stockAplicadoEn: null, creadoPorUid: uid, actualizadoPorUid: uid, creadoEn: timestamp, actualizadoEn: timestamp};
}
function retryable(error) { return Number(error?.code) === 10 || String(error?.message || "").toLowerCase().includes("transaction is invalid"); }
async function transactionRetry(db, callback) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { return await db.runTransaction(callback); } catch (error) { last = error; if (!retryable(error) || attempt === 4) throw error; await new Promise((resolve) => setTimeout(resolve, 30 * (2 ** attempt))); }
  }
  throw last;
}

async function crearCompraHandler(request, dependencies, clock = new Date()) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const reqId = requestId(request?.data?.requestId, HttpsError);
  const normalized = input(request?.data?.compra, HttpsError);
  const fingerprint = hash(normalized);
  const now = chileParts(clock);
  const purchaseRef = businessRef.collection("compras").doc();
  const requestRef = businessRef.collection("purchaseCreateRequests").doc(reqId);
  const counterRef = businessRef.collection("purchaseCounters").doc(String(now.year));
  return transactionRetry(db, async (transaction) => {
    const previous = await transaction.get(requestRef);
    if (previous.exists) {
      const data = previous.data() || {};
      if (data.uidUsuario !== uid || data.fingerprint !== fingerprint) fail(HttpsError, "already-exists", "La solicitud ya fue usada con otros datos.");
      const existing = await transaction.get(businessRef.collection("compras").doc(data.compraId));
      return {compra: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true};
    }
    const refs = [businessRef.collection("proveedores").doc(normalized.proveedorId), counterRef, businessRef, businessRef.collection("configuracion").doc("impuestos"), businessRef.collection("empresa").doc("perfil"), ...normalized.items.map((item) => businessRef.collection("inventario").doc(item.itemId))];
    const snapshots = await transaction.getAll(...refs);
    const proveedorSnapshot = provider(snapshots[0], businessId, normalized.proveedorId, HttpsError);
    const items = normalized.items.map((item, index) => storedLine(item, inventory(snapshots[index + 5], businessId, item.itemId, HttpsError), HttpsError));
    const current = Number(snapshots[1].data()?.lastNumber || 0);
    const sequence = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatNumber(now.year, sequence);
    const timestamp = FieldValue.serverTimestamp();
    const stored = baseStored({businessId, uid, purchaseId: purchaseRef.id, numero, sequence, now, normalized, proveedorSnapshot, items, localization: documentLocalizationSnapshot(snapshots[2].data() || {}, snapshots[3].data() || {}), empresaSnapshot: buildAuthoritativeCompanySnapshot({businessId, business: snapshots[2].data() || {}, profile: snapshots[4].data() || {}}), timestamp, HttpsError});
    transaction.set(counterRef, {negocioId: businessId, year: now.year, lastNumber: sequence, actualizadoEn: timestamp});
    transaction.set(purchaseRef, stored);
    transaction.set(requestRef, {compraId: purchaseRef.id, numero, negocioId: businessId, uidUsuario: uid, fingerprint, creadoEn: timestamp});
    return {compra: {id: purchaseRef.id, ...stored, creadoEn: null, actualizadoEn: null}, requestId: reqId, idempotent: false};
  });
}

function ocSnapshotLine(raw, index, HttpsError) {
  const snap = raw?.inventarioSnapshot || {};
  const itemId = id(raw?.itemId || snap.inventarioId, `Ítem ${index + 1}`, HttpsError);
  const tipoItem = TYPES.has(raw?.tipoItem || snap.tipoItem) ? raw.tipoItem || snap.tipoItem : "producto";
  const snapshot = {inventarioId: itemId, codigoInterno: text(snap.codigoInterno || raw.codigo, 100), nombre: text(snap.nombre || raw.nombre, 240), descripcion: text(snap.descripcion || raw.descripcion, 3000), tipoItem, unidad: text(snap.unidad || raw.unidad, 80) || "unidad", modeloInventarioVersion: Number(snap.modeloInventarioVersion || 1)};
  return storedLine(lineInput({lineaId: raw?.lineaId, itemId, cantidad: raw?.cantidad, costoUnitario: raw?.costoUnitario, descuentoPct: raw?.descuentoPct}, index, HttpsError), snapshot, HttpsError);
}

async function crearCompraDesdeOrdenHandler(request, dependencies, clock = new Date()) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const reqId = requestId(request?.data?.requestId, HttpsError);
  const orderId = id(request?.data?.ordenCompraId, "La orden de compra", HttpsError);
  const now = chileParts(clock);
  const purchaseRef = businessRef.collection("compras").doc();
  const requestRef = businessRef.collection("purchaseOrderConversionRequests").doc(reqId);
  const orderRef = businessRef.collection("ordenesCompra").doc(orderId);
  const receptionsQuery = businessRef.collection("recepciones")
    .where("ordenCompraId", "==", orderId)
    .limit(1);
  const counterRef = businessRef.collection("purchaseCounters").doc(String(now.year));
  return transactionRetry(db, async (transaction) => {
    const previous = await transaction.get(requestRef);
    if (previous.exists) {
      const data = previous.data() || {};
      if (data.uidUsuario !== uid || data.ordenCompraId !== orderId) fail(HttpsError, "already-exists", "La solicitud ya fue usada para otra orden.");
      const existing = await transaction.get(businessRef.collection("compras").doc(data.compraId));
      return {compra: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true};
    }
    const [orderSnapshot, counterSnapshot, receptionsSnapshot, businessSnapshot, companyProfileSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(counterRef),
      transaction.get(receptionsQuery),
      transaction.get(businessRef),
      transaction.get(businessRef.collection("empresa").doc("perfil")),
    ]);
    if (!orderSnapshot.exists) fail(HttpsError, "not-found", "No se encontró la orden de compra.");
    const order = orderSnapshot.data() || {};
    if (order.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes registrar esta orden.");
    if (order.compraId) {
      const existing = await transaction.get(businessRef.collection("compras").doc(order.compraId));
      if (!existing.exists) fail(HttpsError, "failed-precondition", "El enlace de la orden con su compra es inconsistente.");
      transaction.set(requestRef, {negocioId: businessId, ordenCompraId: orderId, compraId: existing.id, numero: existing.data()?.numero || order.compraNumero || "", uidUsuario: uid, creadoEn: FieldValue.serverTimestamp()});
      return {compra: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true, alreadyConverted: true};
    }
    if (order.estado !== "emitida") fail(HttpsError, "failed-precondition", "Sólo una orden emitida puede registrarse como compra.");
    if (!receptionsSnapshot.empty) {
      fail(
        HttpsError,
        "failed-precondition",
        "La orden ya inició el flujo de recepciones. Prepara cada compra desde su recepción confirmada."
      );
    }
    const proveedorSnapshot = order.proveedorSnapshot || {};
    const normalized = input({proveedorId: order.proveedorId, fechaCompra: now.value, fechaDocumento: "", tipoDocumento: "sin_documento", numeroDocumentoProveedor: "", condicionesPago: order.condicionesPago, observaciones: order.observaciones, items: order.items}, HttpsError);
    const items = order.items.map((item, index) => ocSnapshotLine(item, index, HttpsError));
    const current = Number(counterSnapshot.data()?.lastNumber || 0);
    const sequence = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatNumber(now.year, sequence);
    const timestamp = FieldValue.serverTimestamp();
    const currentCompanySnapshot = buildAuthoritativeCompanySnapshot({businessId, business: businessSnapshot.data() || {}, profile: companyProfileSnapshot.data() || {}});
    const stored = baseStored({businessId, uid, purchaseId: purchaseRef.id, numero, sequence, now, normalized, proveedorSnapshot, items, localization: adaptDocumentLocalization(order), empresaSnapshot: resolveCompanySnapshot(order, currentCompanySnapshot), origin: {ordenCompraId: orderId, ordenCompraNumero: text(order.numero, 120)}, timestamp, HttpsError});
    transaction.set(counterRef, {negocioId: businessId, year: now.year, lastNumber: sequence, actualizadoEn: timestamp});
    transaction.set(purchaseRef, stored);
    transaction.update(orderRef, {compraId: purchaseRef.id, compraNumero: numero, compraRegistradaEn: timestamp, actualizadoEn: timestamp, actualizadoPorUid: uid});
    transaction.set(requestRef, {negocioId: businessId, ordenCompraId: orderId, compraId: purchaseRef.id, numero, uidUsuario: uid, creadoEn: timestamp});
    return {compra: {id: purchaseRef.id, ...stored, creadoEn: null, actualizadoEn: null}, requestId: reqId, idempotent: false};
  });
}

async function crearCompraDesdeRecepcionHandler(request, dependencies, clock = new Date()) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const reqId = requestId(request?.data?.requestId, HttpsError);
  const receptionId = id(request?.data?.recepcionId, "La recepcion", HttpsError);
  const now = chileParts(clock);
  const purchaseRef = businessRef.collection("compras").doc();
  const requestRef = businessRef.collection("receptionPurchaseConversionRequests").doc(reqId);
  const receptionRef = businessRef.collection("recepciones").doc(receptionId);
  const counterRef = businessRef.collection("purchaseCounters").doc(String(now.year));
  return transactionRetry(db, async (transaction) => {
    const previous = await transaction.get(requestRef);
    if (previous.exists) {
      const data = previous.data() || {};
      if (data.uidUsuario !== uid || data.recepcionId !== receptionId) {
        fail(HttpsError, "already-exists", "La solicitud ya fue usada para otra recepcion.");
      }
      const existing = await transaction.get(businessRef.collection("compras").doc(data.compraId));
      return {compra: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true};
    }
    const [receptionSnapshot, counterSnapshot, businessSnapshot, companyProfileSnapshot] = await Promise.all([
      transaction.get(receptionRef),
      transaction.get(counterRef),
      transaction.get(businessRef),
      transaction.get(businessRef.collection("empresa").doc("perfil")),
    ]);
    if (!receptionSnapshot.exists) fail(HttpsError, "not-found", "No se encontro la recepcion.");
    const reception = receptionSnapshot.data() || {};
    if (reception.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes registrar esta recepcion.");
    if (reception.compraId) {
      const existing = await transaction.get(businessRef.collection("compras").doc(reception.compraId));
      if (!existing.exists) fail(HttpsError, "failed-precondition", "El enlace con la compra es inconsistente.");
      return {compra: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true, alreadyConverted: true};
    }
    if (reception.estado !== "confirmada" || reception.stockAplicado !== true) {
      fail(HttpsError, "failed-precondition", "Solo una recepcion recibida puede registrarse como compra.");
    }
    const orderId = id(reception.ordenCompraId, "La orden de compra", HttpsError);
    const orderSnapshot = await transaction.get(
      businessRef.collection("ordenesCompra").doc(orderId)
    );
    if (!orderSnapshot.exists) {
      fail(HttpsError, "failed-precondition", "No se encontro la orden de compra de la recepcion.");
    }
    const order = orderSnapshot.data() || {};
    if (order.negocioId !== businessId) {
      fail(HttpsError, "permission-denied", "La orden de compra pertenece a otro negocio.");
    }
    if (order.compraId) {
      fail(
        HttpsError,
        "failed-precondition",
        "La orden ya fue registrada como compra mediante el flujo anterior. Esta recepcion no puede generar otra compra."
      );
    }
    const acquisitions = await transaction.get(
      businessRef.collection("adquisicionesInventario")
        .where("recepcionId", "==", receptionId)
    );
    const sourceItems = (reception.items || []).filter((line) => Number(line.cantidad) > 0);
    const normalized = input({
      proveedorId: reception.proveedorId,
      fechaCompra: now.value,
      fechaDocumento: "",
      tipoDocumento: "sin_documento",
      numeroDocumentoProveedor: "",
      condicionesPago: "",
      observaciones: `Originada desde ${reception.numero || "recepcion"}`,
      items: sourceItems,
    }, HttpsError);
    const items = sourceItems.map((line, index) => ocSnapshotLine(line, index, HttpsError));
    const current = Number(counterSnapshot.data()?.lastNumber || 0);
    const sequence = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatNumber(now.year, sequence);
    const timestamp = FieldValue.serverTimestamp();
    const currentCompanySnapshot = buildAuthoritativeCompanySnapshot({businessId, business: businessSnapshot.data() || {}, profile: companyProfileSnapshot.data() || {}});
    const stored = baseStored({
      businessId,
      uid,
      purchaseId: purchaseRef.id,
      numero,
      sequence,
      now,
      normalized,
      proveedorSnapshot: reception.proveedorSnapshot || {},
      items,
      localization: adaptDocumentLocalization(reception),
      empresaSnapshot: resolveCompanySnapshot(
        reception,
        resolveCompanySnapshot(order, currentCompanySnapshot)
      ),
      origin: {
        recepcionId: receptionId,
        recepcionNumero: text(reception.numero, 120),
        ordenCompraId: text(reception.ordenCompraId, 160),
        ordenCompraNumero: text(reception.ordenCompraNumero, 120),
      },
      timestamp,
      HttpsError,
    });
    transaction.set(counterRef, {negocioId: businessId, year: now.year, lastNumber: sequence, actualizadoEn: timestamp});
    transaction.set(purchaseRef, stored);
    transaction.update(receptionRef, {compraId: purchaseRef.id, compraNumero: numero, actualizadoPorUid: uid, actualizadoEn: timestamp});
    acquisitions.docs.forEach((acquisition) => {
      transaction.update(acquisition.ref, {
        compraId: purchaseRef.id,
        compraNumero: numero,
        compraVinculadaEn: timestamp,
      });
    });
    transaction.set(requestRef, {negocioId: businessId, recepcionId: receptionId, compraId: purchaseRef.id, uidUsuario: uid, creadoEn: timestamp});
    return {compra: {id: purchaseRef.id, ...stored, creadoEn: null, actualizadoEn: null}, requestId: reqId, idempotent: false};
  });
}

function preservedProvider(purchase) { return purchase.proveedorSnapshot || {}; }
function preservedItem(line) { return line?.inventarioSnapshot || {inventarioId: line?.itemId, codigoInterno: line?.codigo, nombre: line?.nombre, descripcion: line?.descripcion, tipoItem: line?.tipoItem, unidad: line?.unidad}; }
function assertOrderReferencesUnchanged(existing, normalized, HttpsError) {
  const previousItems = Array.isArray(existing.items) ? existing.items : [];
  if (normalized.proveedorId !== existing.proveedorId || normalized.items.length !== previousItems.length) {
    fail(HttpsError, "failed-precondition", "Una compra originada desde una orden no permite cambiar proveedor ni ítems.");
  }
  const previousByLine = new Map(previousItems.map((line) => [text(line.lineaId, 160), text(line.itemId, 160)]));
  const referencesChanged = normalized.items.some((line) => previousByLine.get(line.lineaId) !== line.itemId);
  if (referencesChanged) fail(HttpsError, "failed-precondition", "Una compra originada desde una orden no permite cambiar proveedor ni ítems.");
}

async function actualizarCompraBorradorHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const purchaseId = id(request?.data?.compraId, "La compra", HttpsError);
  const normalized = input(request?.data?.compra, HttpsError);
  const purchaseRef = businessRef.collection("compras").doc(purchaseId);
  return transactionRetry(db, async (transaction) => {
    const snapshot = await transaction.get(purchaseRef);
    if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró la compra.");
    const existing = snapshot.data() || {};
    if (existing.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes editar esta compra.");
    if (existing.estado !== "borrador") fail(HttpsError, "failed-precondition", "Sólo puedes editar compras en borrador.");
    if (existing.ordenCompraId) assertOrderReferencesUnchanged(existing, normalized, HttpsError);
    const previousLines = new Map((existing.items || []).map((line) => [text(line.lineaId, 160), line]));
    const providerChanged = normalized.proveedorId !== existing.proveedorId;
    const itemChanged = normalized.items.map((item) => { const previous = previousLines.get(item.lineaId); return !previous || previous.itemId !== item.itemId; });
    const refs = [];
    if (providerChanged) refs.push(businessRef.collection("proveedores").doc(normalized.proveedorId));
    normalized.items.forEach((item, index) => { if (itemChanged[index]) refs.push(businessRef.collection("inventario").doc(item.itemId)); });
    const snapshots = refs.length ? await transaction.getAll(...refs) : [];
    let cursor = 0;
    const proveedorSnapshot = providerChanged ? provider(snapshots[cursor++], businessId, normalized.proveedorId, HttpsError) : preservedProvider(existing);
    const items = normalized.items.map((item, index) => storedLine(item, itemChanged[index] ? inventory(snapshots[cursor++], businessId, item.itemId, HttpsError) : preservedItem(previousLines.get(item.lineaId)), HttpsError));
    const timestamp = FieldValue.serverTimestamp();
    const update = {...normalized, proveedorSnapshot, items, ...totals(items, HttpsError, adaptDocumentLocalization(existing).tasaIva), actualizadoPorUid: uid, actualizadoEn: timestamp};
    delete update.itemsInput;
    transaction.update(purchaseRef, update);
    return {compra: {id: purchaseId, ...existing, ...update, actualizadoEn: null}};
  });
}

async function confirmarCompraHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const purchaseId = id(request?.data?.compraId, "La compra", HttpsError);
  const reqId = requestId(request?.data?.requestId, HttpsError);
  const purchaseRef = businessRef.collection("compras").doc(purchaseId);
  const requestRef = businessRef.collection("purchaseConfirmRequests").doc(reqId);
  return transactionRetry(db, async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      const data = previousRequest.data() || {};
      if (data.uidUsuario !== uid || data.compraId !== purchaseId) fail(HttpsError, "already-exists", "La solicitud ya fue usada para otra compra.");
      const existing = await transaction.get(purchaseRef);
      return {compra: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true, productosActualizados: Number(data.productosActualizados || 0)};
    }
    const purchaseSnapshot = await transaction.get(purchaseRef);
    if (!purchaseSnapshot.exists) fail(HttpsError, "not-found", "No se encontró la compra.");
    const purchase = purchaseSnapshot.data() || {};
    if (purchase.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes confirmar esta compra.");
    if (purchase.estado === "confirmada" || purchase.stockAplicado === true) {
      transaction.set(requestRef, {negocioId: businessId, compraId: purchaseId, uidUsuario: uid, productosActualizados: 0, creadoEn: FieldValue.serverTimestamp()});
      return {compra: {id: purchaseId, ...purchase}, requestId: reqId, idempotent: true, productosActualizados: 0};
    }
    if (purchase.estado !== "borrador") fail(HttpsError, "failed-precondition", "La compra no puede confirmarse.");
    if (Number(purchase.modeloCompraVersion || 1) >= 2 || purchase.stockGestionadoPor === "recepcion") {
      const timestamp = FieldValue.serverTimestamp();
      const update = {estado: "confirmada", stockAplicado: false, stockAplicadoEn: null, confirmadoPorUid: uid, confirmadoEn: timestamp, actualizadoPorUid: uid, actualizadoEn: timestamp};
      transaction.update(purchaseRef, update);
      transaction.set(requestRef, {negocioId: businessId, compraId: purchaseId, uidUsuario: uid, productosActualizados: 0, creadoEn: timestamp});
      return {compra: {id: purchaseId, ...purchase, ...update, confirmadoEn: null, actualizadoEn: null}, requestId: reqId, idempotent: false, productosActualizados: 0};
    }
    const purchaseLines = Array.isArray(purchase.items) ? purchase.items : [];
    const productLines = purchaseLines.filter((line) => line.tipoItem === "producto");
    const linesToValidate = purchase.ordenCompraId ? productLines : purchaseLines;
    const itemGroups = new Map();
    linesToValidate.forEach((line) => {
      const group = itemGroups.get(line.itemId) || {itemId: line.itemId, lines: []};
      group.lines.push(line);
      itemGroups.set(line.itemId, group);
    });
    const groups = [...itemGroups.values()];
    const providerRef = purchase.ordenCompraId ? null : businessRef.collection("proveedores").doc(purchase.proveedorId);
    const itemRefs = groups.map((group) => businessRef.collection("inventario").doc(group.itemId));
    const refs = providerRef ? [providerRef, ...itemRefs] : itemRefs;
    const snapshots = refs.length ? await transaction.getAll(...refs) : [];
    if (providerRef) provider(snapshots[0], businessId, purchase.proveedorId, HttpsError);
    const itemSnapshots = providerRef ? snapshots.slice(1) : snapshots;
    const timestamp = FieldValue.serverTimestamp();
    groups.forEach((group, index) => {
      const snapshot = itemSnapshots[index];
      if (!snapshot.exists) fail(HttpsError, "failed-precondition", `No se encontró el ítem ${group.lines[0].nombre}.`);
      const raw = snapshot.data() || {};
      if (raw.negocioId && raw.negocioId !== businessId) fail(HttpsError, "permission-denied", "Un ítem pertenece a otro negocio.");
      const currentType = TYPES.has(raw.tipoItem) ? raw.tipoItem : "producto";
      if (group.lines.some((line) => line.tipoItem !== currentType)) fail(HttpsError, "failed-precondition", "Un ítem cambió de tipo.");
      if (!purchase.ordenCompraId && raw.estado && raw.estado !== "activo") fail(HttpsError, "failed-precondition", "Un ítem ya no está disponible.");
      if (currentType !== "producto") return;
      let runningStock = Number(raw.stock || 0);
      if (!Number.isFinite(runningStock)) fail(HttpsError, "failed-precondition", "El stock no pudo actualizarse de forma segura.");
      group.lines.forEach((line) => {
        const stockAnterior = runningStock;
        const cantidad = Number(line.cantidad);
        const stockPosterior = stockAnterior + cantidad;
        if (!Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(stockPosterior) || Math.abs(stockPosterior) > Number.MAX_SAFE_INTEGER) fail(HttpsError, "failed-precondition", "El stock no pudo actualizarse de forma segura.");
        const movementRef = businessRef.collection("movimientosInventario").doc(`${purchaseId}__${line.lineaId}`);
        transaction.set(movementRef, {movimientoId: movementRef.id, negocioId: businessId, itemId: line.itemId, compraId: purchaseId, compraNumero: purchase.numero, tipo: "entrada_compra", cantidad, stockAnterior, stockPosterior, motivo: "Confirmación de compra", codigo: text(line.codigo, 100), nombre: text(line.nombre, 240), unidad: text(line.unidad, 80), creadoPorUid: uid, creadoEn: timestamp});
        runningStock = stockPosterior;
      });
      transaction.update(itemRefs[index], {stock: runningStock, actualizadoEn: timestamp, actualizadoPorUid: uid});
    });
    const update = {estado: "confirmada", stockAplicado: true, stockAplicadoEn: timestamp, confirmadoPorUid: uid, confirmadoEn: timestamp, actualizadoPorUid: uid, actualizadoEn: timestamp};
    transaction.update(purchaseRef, update);
    transaction.set(requestRef, {negocioId: businessId, compraId: purchaseId, uidUsuario: uid, productosActualizados: productLines.length, creadoEn: timestamp});
    return {compra: {id: purchaseId, ...purchase, ...update, confirmadoEn: null, actualizadoEn: null}, requestId: reqId, idempotent: false, productosActualizados: productLines.length};
  });
}

async function cancelarCompraBorradorHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const purchaseId = id(request?.data?.compraId, "La compra", HttpsError);
  const purchaseRef = businessRef.collection("compras").doc(purchaseId);
  return transactionRetry(db, async (transaction) => {
    const snapshot = await transaction.get(purchaseRef);
    if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró la compra.");
    const existing = snapshot.data() || {};
    if (existing.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes cancelar esta compra.");
    if (existing.estado === "cancelada") return {compra: {id: purchaseId, ...existing}, idempotent: true};
    if (existing.estado !== "borrador" || existing.stockAplicado) fail(HttpsError, "failed-precondition", "Sólo puedes cancelar compras en borrador.");
    const timestamp = FieldValue.serverTimestamp();
    const update = {estado: "cancelada", canceladoPorUid: uid, canceladoEn: timestamp, actualizadoPorUid: uid, actualizadoEn: timestamp};
    transaction.update(purchaseRef, update);
    return {compra: {id: purchaseId, ...existing, ...update, actualizadoEn: null}, idempotent: false};
  });
}

module.exports = {actualizarCompraBorradorHandler, cancelarCompraBorradorHandler, confirmarCompraHandler, crearCompraDesdeOrdenHandler, crearCompraDesdeRecepcionHandler, crearCompraHandler, formatPurchaseNumber: formatNumber, normalizePurchaseInput: input, calculatePurchaseTotals: totals, providerSnapshotFromDocument: provider};
