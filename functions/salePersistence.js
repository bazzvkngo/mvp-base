const {createHash} = require("node:crypto");
const {adaptDocumentLocalization, documentLocalizationSnapshot} = require("./localization");
const {buildAuthoritativeCompanySnapshot, resolveCompanySnapshot} = require("./companySnapshot");
const {fiscalSnapshotFields} = require("./fiscalIdentifier");
const {inventoryCostSnapshot, linkedWorkFields, writeCommercialLink, writeSaleConfirmationEvent} = require("./workPersistence");
const {
  INVENTORY_ECONOMIC_MODEL_VERSION,
  applyInventoryCostedOutflow,
  applyInventoryEconomicDelta,
  assertCanonicalInventoryQuantity,
  inventoryEconomicFields,
  resolveInventoryEconomicState,
} = require("./inventoryAcquisition");

const MODEL_VERSION = 1;
const VAT_RATE = 0.19;
const {SALES_WRITE_ROLES: WRITE_ROLES} = require("./rbac");
const TYPES = new Set(["producto", "servicio", "actividad"]);
const DOCUMENT_TYPES = new Set(["factura", "boleta", "otro", "sin_documento"]);
const MAXIMUM_AMOUNT_MESSAGE = "El monto de la venta supera el máximo permitido.";

function fail(HttpsError, code, message) { throw new HttpsError(code, message); }
function text(value, max = 2000) { return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max); }
function id(value, label, HttpsError, {optional = false} = {}) {
  const result = text(value, 160);
  if (optional && !result) return "";
  if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(result)) fail(HttpsError, "invalid-argument", `${label} no es válido.`);
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
  if (values.some((value) => !Number.isFinite(value) || !Number.isSafeInteger(value))) fail(HttpsError, "invalid-argument", MAXIMUM_AMOUNT_MESSAGE);
}
function roundCost(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
function costCurrency(item = {}, fallback = "CLP") {
  const candidate = text(item.costoPromedioMoneda || item.monedaCosto || item.moneda, 3).toUpperCase();
  const normalizedFallback = text(fallback, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(candidate) ? candidate : /^[A-Z]{3}$/.test(normalizedFallback) ? normalizedFallback : "CLP";
}
function historicalCostFields(item, quantity, fallbackCurrency) {
  const snapshot = inventoryCostSnapshot(item);
  if (!snapshot) return {costoHistoricoDisponible: false};
  return {
    ...snapshot,
    costoTotal: roundCost(snapshot.costoUnitario * Number(quantity || 0)),
    moneda: costCurrency(item, fallbackCurrency),
    costoHistoricoDisponible: true,
  };
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
    itemId: id(raw?.itemId, `Ítem ${index + 1}`, HttpsError, {optional: true}),
    cantidad: number(raw?.cantidad, `Ítem ${index + 1}: cantidad`, HttpsError, {minimum: Number.MIN_VALUE}),
    precioUnitario: number(raw?.precioUnitario, `Ítem ${index + 1}: precio unitario`, HttpsError),
    descuentoPct: number(raw?.descuentoPct ?? 0, `Ítem ${index + 1}: descuento`, HttpsError, {maximum: 100}),
  };
}
function input(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(HttpsError, "invalid-argument", "Los datos de la venta no son válidos.");
  if (!Array.isArray(raw.items) || !raw.items.length) fail(HttpsError, "invalid-argument", "Agrega al menos un ítem a la venta.");
  if (raw.items.length > 200) fail(HttpsError, "invalid-argument", "La venta admite hasta 200 ítems.");
  const items = raw.items.map((item, index) => lineInput(item, index, HttpsError));
  if (new Set(items.map((item) => item.lineaId)).size !== items.length) fail(HttpsError, "invalid-argument", "Las líneas están duplicadas.");
  return {
    clienteId: id(raw.clienteId, "El cliente", HttpsError), items,
    descuento: number(raw.descuento ?? 0, "El descuento general", HttpsError),
    afectaIva: raw.afectaIva !== false,
    fechaVenta: date(raw.fechaVenta, "La fecha de venta", HttpsError, true),
    fechaDocumento: date(raw.fechaDocumento, "La fecha del documento", HttpsError),
    tipoDocumento: DOCUMENT_TYPES.has(raw.tipoDocumento) ? raw.tipoDocumento : "sin_documento",
    numeroDocumento: text(raw.numeroDocumento, 120), condicionesPago: text(raw.condicionesPago, 2000), observaciones: text(raw.observaciones, 4000),
  };
}
function client(snapshot, businessId, clientId, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró el cliente.");
  const raw = snapshot.data() || {};
  if (raw.negocioId !== businessId || text(raw.clienteId, 160) !== clientId) fail(HttpsError, "failed-precondition", "El cliente es inconsistente.");
  if (raw.estado !== "activo") fail(HttpsError, "failed-precondition", "El cliente no está disponible.");
  if (!text(raw.nombreRazonSocial, 240)) fail(HttpsError, "failed-precondition", "El cliente no tiene nombre o razón social.");
  return {clienteId: clientId, tipoCliente: text(raw.tipoCliente, 20), ...fiscalSnapshotFields(raw), nombreRazonSocial: text(raw.nombreRazonSocial, 240), giro: text(raw.giro, 240), email: text(raw.email, 240), telefono: text(raw.telefono, 100), direccion: text(raw.direccion, 300), personaContacto: text(raw.personaContacto, 200), regionCodigo: text(raw.regionCodigo, 20), regionNombre: text(raw.regionNombre, 160), comunaCodigo: text(raw.comunaCodigo, 20), comunaNombre: text(raw.comunaNombre, 160)};
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
function storedLine(value, snapshot, HttpsError, extra = {}) {
  const cantidad = snapshot.tipoItem === "producto"
    ? assertCanonicalInventoryQuantity(value.cantidad, HttpsError)
    : value.cantidad;
  const subtotalLinea = Math.round(cantidad * value.precioUnitario);
  const descuentoLinea = Math.round((subtotalLinea * value.descuentoPct) / 100);
  const totalLinea = subtotalLinea - descuentoLinea;
  safeMoney([subtotalLinea, descuentoLinea, totalLinea], HttpsError);
  return {lineaId: value.lineaId, itemId: value.itemId, codigo: snapshot.codigoInterno, nombre: snapshot.nombre, descripcion: snapshot.descripcion, tipoItem: snapshot.tipoItem, unidad: snapshot.unidad, cantidad, precioUnitario: value.precioUnitario, descuentoPct: value.descuentoPct, subtotalLinea, descuentoLinea, totalLinea, inventarioSnapshot: snapshot, ...extra};
}
function totals(items, HttpsError, {descuentoGeneral = 0, afectaIva = true, tasaIva = VAT_RATE} = {}) {
  const subtotal = items.reduce((sum, item) => sum + item.subtotalLinea, 0);
  const descuentoItems = items.reduce((sum, item) => sum + item.descuentoLinea, 0);
  const descuento = number(descuentoGeneral ?? 0, "El descuento general", HttpsError);
  if (descuento > subtotal - descuentoItems) fail(HttpsError, "invalid-argument", "El descuento general no puede superar el monto disponible.");
  const descuentoTotal = descuentoItems + descuento;
  const neto = subtotal - descuentoTotal; const effectiveTaxRate = afectaIva ? tasaIva : 0;
  const iva = afectaIva ? Math.round(neto * effectiveTaxRate) : 0; const total = neto + iva;
  safeMoney([subtotal, descuentoItems, descuento, descuentoTotal, neto, iva, total], HttpsError);
  return {subtotal, descuentoItems, descuento, descuentoTotal, neto, afectaIva, tasaIva: effectiveTaxRate, iva, total};
}
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function access(request, dependencies) { return dependencies.requireBusinessAccess(request, {db: dependencies.db, HttpsError: dependencies.HttpsError}, {roles: WRITE_ROLES, requiresVerifiedBusiness: true}); }
function formatNumber(year, sequence) { return `VTA-${year}-${String(sequence).padStart(4, "0")}`; }
function baseStored({businessId, uid, ventaId, numero, sequence, now, normalized, clienteSnapshot, items, localization, empresaSnapshot, origin = {}, timestamp, HttpsError}) {
  const location = localization || adaptDocumentLocalization({});
  return {modeloVentaVersion: MODEL_VERSION, ventaId, negocioId: businessId, numero, anio: now.year, correlativo: sequence, estado: "borrador", paisCodigo: location.paisCodigo, moneda: location.moneda, locale: location.locale, impuestoNombre: location.impuestoNombre, empresaSnapshot, clienteId: normalized.clienteId, clienteSnapshot, ...origin, items, ...totals(items, HttpsError, {descuentoGeneral: normalized.descuento, afectaIva: normalized.afectaIva, tasaIva: location.tasaIva}), fechaVenta: normalized.fechaVenta, fechaDocumento: normalized.fechaDocumento, tipoDocumento: normalized.tipoDocumento, numeroDocumento: normalized.numeroDocumento, condicionesPago: normalized.condicionesPago, observaciones: normalized.observaciones, stockAplicado: false, stockAplicadoAt: null, creadoPorUid: uid, actualizadoPorUid: uid, createdAt: timestamp, updatedAt: timestamp};
}
function retryable(error) { return Number(error?.code) === 10 || String(error?.message || "").toLowerCase().includes("transaction is invalid"); }
async function transactionRetry(db, callback) { let last; for (let attempt = 0; attempt < 5; attempt += 1) { try { return await db.runTransaction(callback); } catch (error) { last = error; if (!retryable(error) || attempt === 4) throw error; await new Promise((resolve) => setTimeout(resolve, 30 * (2 ** attempt))); } } throw last; }

async function crearVentaHandler(request, dependencies, clock = new Date()) {
  const {db, FieldValue, HttpsError} = dependencies; const {uid, businessId, businessRef} = await access(request, dependencies);
  const reqId = requestId(request?.data?.requestId, HttpsError); const normalized = input(request?.data?.venta, HttpsError);
  if (normalized.items.some((item) => !item.itemId)) fail(HttpsError, "invalid-argument", "Todos los ítems de una venta directa deben provenir del inventario.");
  const fingerprint = hash(normalized); const now = chileParts(clock); const saleRef = businessRef.collection("ventas").doc();
  const requestRef = businessRef.collection("saleCreateRequests").doc(reqId); const counterRef = businessRef.collection("saleCounters").doc(String(now.year));
  return transactionRetry(db, async (transaction) => {
    const previous = await transaction.get(requestRef);
    if (previous.exists) { const data = previous.data() || {}; if (data.uidUsuario !== uid || data.fingerprint !== fingerprint) fail(HttpsError, "already-exists", "La solicitud ya fue usada con otros datos."); const existing = await transaction.get(businessRef.collection("ventas").doc(data.ventaId)); return {venta: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true}; }
    const refs = [businessRef.collection("clientes").doc(normalized.clienteId), counterRef, businessRef, businessRef.collection("configuracion").doc("impuestos"), businessRef.collection("empresa").doc("perfil"), ...normalized.items.map((item) => businessRef.collection("inventario").doc(item.itemId))];
    const snapshots = await transaction.getAll(...refs); const clienteSnapshot = client(snapshots[0], businessId, normalized.clienteId, HttpsError);
    const items = normalized.items.map((item, index) => storedLine(item, inventory(snapshots[index + 5], businessId, item.itemId, HttpsError), HttpsError));
    const current = Number(snapshots[1].data()?.lastNumber || 0); const sequence = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatNumber(now.year, sequence); const timestamp = FieldValue.serverTimestamp();
    const stored = baseStored({businessId, uid, ventaId: saleRef.id, numero, sequence, now, normalized, clienteSnapshot, items, localization: documentLocalizationSnapshot(snapshots[2].data() || {}, snapshots[3].data() || {}), empresaSnapshot: buildAuthoritativeCompanySnapshot({businessId, business: snapshots[2].data() || {}, profile: snapshots[4].data() || {}}), timestamp, HttpsError});
    transaction.set(counterRef, {negocioId: businessId, year: now.year, lastNumber: sequence, actualizadoEn: timestamp}); transaction.set(saleRef, stored);
    transaction.set(requestRef, {ventaId: saleRef.id, numero, negocioId: businessId, uidUsuario: uid, fingerprint, creadoEn: timestamp});
    return {venta: {id: saleRef.id, ...stored, createdAt: null, updatedAt: null}, requestId: reqId, idempotent: false};
  });
}

function quoteClientSnapshot(quote, HttpsError) {
  const source = quote.cliente || {};
  const clienteId = id(quote.clienteId || source.clienteId, "El cliente de la cotización", HttpsError);
  const nombreRazonSocial = text(source.nombreRazonSocial || source.empresa || quote.clienteNombre, 240);
  if (!nombreRazonSocial) fail(HttpsError, "failed-precondition", "La cotización no contiene un snapshot de cliente válido.");
  return {clienteId, tipoCliente: text(source.tipoCliente, 20), ...fiscalSnapshotFields({...source, rut: source.rut || quote.clienteRut}), nombreRazonSocial, giro: text(source.giro, 240), email: text(source.email || quote.clienteEmail, 240), telefono: text(source.telefono || quote.clienteTelefono, 100), direccion: text(source.direccion || quote.clienteDireccion, 300), personaContacto: text(source.personaContacto || source.contacto || quote.clienteContacto, 200), regionCodigo: text(source.regionCodigo, 20), regionNombre: text(source.regionNombre, 160), comunaCodigo: text(source.comunaCodigo, 20), comunaNombre: text(source.comunaNombre || source.ciudad || quote.clienteCiudad, 160)};
}
function quoteLine(raw, index, HttpsError) {
  const snap = raw?.inventarioSnapshot || {}; const tipoItem = TYPES.has(raw?.tipoItem || snap.tipoItem) ? raw.tipoItem || snap.tipoItem : "producto";
  const itemId = id(raw?.itemId || snap.inventarioId, `Ítem ${index + 1}`, HttpsError, {optional: tipoItem !== "producto"});
  if (tipoItem === "producto" && !itemId) fail(HttpsError, "failed-precondition", `El producto ${text(raw?.nombre, 240) || index + 1} no está vinculado al inventario.`);
  const snapshot = {inventarioId: itemId, codigoInterno: text(snap.codigoInterno || raw.codigo, 100), nombre: text(snap.nombre || raw.nombre, 240), descripcion: text(raw.descripcionComercial || snap.descripcion || raw.descripcion, 3000), tipoItem, unidad: text(snap.unidad || raw.unidad, 80) || "unidad", modeloInventarioVersion: Number(snap.modeloInventarioVersion || 1)};
  const values = lineInput({lineaId: raw?.lineaId, itemId, cantidad: raw?.cantidad, precioUnitario: raw?.precioUnitarioEditable ?? raw?.precioUnitario ?? raw?.precio, descuentoPct: raw?.descuentoPorcentaje ?? raw?.descuentoPct}, index, HttpsError);
  return storedLine(values, snapshot, HttpsError, {cantidadCotizada: values.cantidad});
}

function quoteSaleId(quoteId) {
  return `cotizacion__${quoteId}`;
}

function groupProductLines(items = []) {
  const groups = new Map();
  items.filter((line) => line.tipoItem === "producto").forEach((line) => {
    const group = groups.get(line.itemId) || {itemId: line.itemId, lines: []};
    group.lines.push(line);
    groups.set(line.itemId, group);
  });
  return [...groups.values()];
}

async function createConfirmedSaleFromQuoteInTransaction({
  actor = {},
  businessId,
  businessRef,
  clock = new Date(),
  dependencies,
  quote,
  quoteId,
  transaction,
}) {
  const {FieldValue, HttpsError} = dependencies;
  const saleRef = businessRef.collection("ventas").doc(quoteSaleId(quoteId));
  if (quote.ventaId) {
    const linkedSale = await transaction.get(
      businessRef.collection("ventas").doc(id(quote.ventaId, "La venta", HttpsError))
    );
    if (!linkedSale.exists) {
      fail(HttpsError, "failed-precondition", "El enlace de la cotización con su venta es inconsistente.");
    }
    return {
      idempotent: true,
      productosActualizados: 0,
      sale: {id: linkedSale.id, ...(linkedSale.data() || {})},
    };
  }
  if (!Array.isArray(quote.items) || !quote.items.length) {
    fail(HttpsError, "failed-precondition", "La cotización no contiene ítems.");
  }
  if (quote.items.length > 200) {
    fail(HttpsError, "failed-precondition", "La venta admite hasta 200 ítems.");
  }

  const now = chileParts(clock);
  const counterRef = businessRef.collection("saleCounters").doc(String(now.year));
  const companyProfileRef = businessRef.collection("empresa").doc("perfil");
  const trabajoId = quote.trabajoId
    ? id(quote.trabajoId, "El proyecto", HttpsError)
    : "";
  const workRef = trabajoId ? businessRef.collection("trabajos").doc(trabajoId) : null;
  const clienteSnapshot = quoteClientSnapshot(quote, HttpsError);
  const items = quote.items.map((item, index) => quoteLine(item, index, HttpsError));
  const productGroups = groupProductLines(items);
  const inventoryRefs = productGroups.map((group) =>
    businessRef.collection("inventario").doc(group.itemId)
  );
  const refs = [counterRef, businessRef, companyProfileRef, ...inventoryRefs];
  if (workRef) refs.push(workRef);
  const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
  const counterSnapshot = snapshots[0];
  const businessSnapshot = snapshots[1];
  const companyProfileSnapshot = snapshots[2];
  const inventorySnapshots = snapshots.slice(3, 3 + inventoryRefs.length);
  const workSnapshot = workRef ? snapshots.at(-1) : null;
  const workFields = workRef ? linkedWorkFields(workSnapshot, businessId, HttpsError) : {};
  const current = Number(counterSnapshot.data()?.lastNumber || 0);
  const sequence = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
  const numero = formatNumber(now.year, sequence);
  const timestamp = FieldValue.serverTimestamp();
  const actorUid = text(actor.uid, 160);
  const normalized = input({
    clienteId: clienteSnapshot.clienteId,
    descuento: quote.descuento ?? quote.descuentoGeneral ?? 0,
    afectaIva: quote.afectaIva !== false,
    fechaVenta: now.value,
    fechaDocumento: "",
    tipoDocumento: "sin_documento",
    numeroDocumento: "",
    condicionesPago: quote.condicionesPago || quote.condiciones?.formaPago,
    observaciones: quote.observaciones || quote.condiciones?.observaciones,
    items,
  }, HttpsError);
  const currentCompanySnapshot = buildAuthoritativeCompanySnapshot({
    businessId,
    business: businessSnapshot.data() || {},
    profile: companyProfileSnapshot.data() || {},
  });
  const base = baseStored({
    businessId,
    uid: actorUid,
    ventaId: saleRef.id,
    numero,
    sequence,
    now,
    normalized,
    clienteSnapshot,
    items,
    localization: adaptDocumentLocalization(quote),
    empresaSnapshot: resolveCompanySnapshot(quote, currentCompanySnapshot),
    origin: {
      cotizacionId: quoteId,
      cotizacionNumero: text(quote.numero, 120),
      ...workFields,
    },
    timestamp,
    HttpsError,
  });

  const efectosInventario = [];
  const alertasStock = [];
  productGroups.forEach((group, index) => {
    const snapshot = inventorySnapshots[index];
    const required = group.lines.reduce((sum, line) => sum + Number(line.cantidad || 0), 0);
    const raw = snapshot.exists ? snapshot.data() || {} : {};
    if (raw.negocioId && raw.negocioId !== businessId) {
      fail(HttpsError, "permission-denied", "Un ítem pertenece a otro negocio.");
    }
    const currentType = TYPES.has(raw.tipoItem) ? raw.tipoItem : "producto";
    const available = Number(raw.stock);
    const validProduct = snapshot.exists && currentType === "producto" &&
      Number.isFinite(available) && available >= 0;
    const safeAvailable = validProduct ? available : 0;
    if (!validProduct || available < required) {
      alertasStock.push({
        itemId: group.itemId,
        nombre: text(group.lines[0]?.nombre, 240),
        requerido: required,
        disponible: safeAvailable,
        faltante: Math.max(required - safeAvailable, 0),
        motivo: !snapshot.exists
          ? "producto_no_disponible"
          : currentType !== "producto"
            ? "tipo_inconsistente"
            : "stock_insuficiente",
      });
    }
    if (!validProduct || safeAvailable === 0) return;
    let running = resolveInventoryEconomicState({item: raw, operationCurrency: base.moneda}, HttpsError);
    let pendingToApply = Math.min(safeAvailable, required);
    group.lines.forEach((line) => {
      const cantidadSolicitada = Number(line.cantidad);
      const cantidad = Math.min(cantidadSolicitada, pendingToApply);
      if (cantidad <= 0) return;
      const movementRef = businessRef.collection("movimientosInventario")
        .doc(`${saleRef.id}__${line.lineaId}`);
      let costFields = historicalCostFields({...raw, costoPromedio: running.average}, cantidad, base.moneda);
      if (costFields.costoHistoricoDisponible !== true) {
        fail(HttpsError, "failed-precondition", "El producto no tiene un costo vigente confiable.");
      }
      const outflow = applyInventoryCostedOutflow(running, {
        cantidad,
        costoUnitario: costFields.costoUnitario,
      }, HttpsError);
      costFields = {...costFields, costoTotal: outflow.costoTotal};
      const next = outflow.next;
      transaction.create(movementRef, {
        movimientoId: movementRef.id,
        negocioId: businessId,
        itemId: line.itemId,
        ventaId: saleRef.id,
        ventaNumero: numero,
        cotizacionId: quoteId,
        cotizacionNumero: text(quote.numero, 120),
        tipo: "salida_venta",
        cantidad,
        cantidadSolicitada,
        stockAnterior: running.stock,
        stockPosterior: next.stock,
        valorInventarioAnterior: running.value,
        valorInventarioPosterior: next.value,
        costoPromedioAnterior: running.average,
        costoPromedioPosterior: next.average,
        modeloEconomiaInventarioVersion: INVENTORY_ECONOMIC_MODEL_VERSION,
        motivo: "Aceptación de cotización",
        codigo: text(line.codigo, 100),
        nombre: text(line.nombre, 240),
        unidad: text(line.unidad, 80),
        ...costFields,
        creadoPorUid: actorUid,
        origenAceptacion: text(actor.origen, 80) || "manual",
        createdAt: timestamp,
      });
      efectosInventario.push({
        itemId: line.itemId,
        lineaId: line.lineaId,
        movimientoId: movementRef.id,
        cantidad,
        cantidadSolicitada,
        codigo: text(line.codigo, 100),
        nombre: text(line.nombre, 240),
        unidad: text(line.unidad, 80),
        fecha: base.fechaVenta,
        tipoItem: "producto",
        ...costFields,
      });
      running = next;
      pendingToApply -= cantidad;
    });
    transaction.update(inventoryRefs[index], {
      stock: running.stock,
      ...inventoryEconomicFields(running, timestamp),
      actualizadoEn: timestamp,
      actualizadoPorUid: actorUid,
    });
  });

  const productLineCount = items.filter((line) => line.tipoItem === "producto").length;
  const appliedProductCount = efectosInventario.length;
  const estadoStock = productLineCount === 0
    ? "no_aplica"
    : alertasStock.length === 0
      ? "completo"
      : appliedProductCount > 0
        ? "parcial_pendiente"
        : "pendiente_abastecimiento";
  const stored = {
    ...base,
    estado: "confirmada",
    estadoStock,
    alertasStock,
    efectosInventario,
    stockAplicado: alertasStock.length === 0,
    stockAplicadoAt: appliedProductCount > 0 ? timestamp : null,
    stockProcesadoEn: timestamp,
    origenAceptacion: text(actor.origen, 80) || "manual",
    aceptadaEn: timestamp,
    confirmadoPorUid: actorUid,
    confirmedAt: timestamp,
  };
  transaction.set(counterRef, {
    negocioId: businessId,
    year: now.year,
    lastNumber: sequence,
    actualizadoEn: timestamp,
  });
  transaction.create(saleRef, stored);
  if (workRef) {
    const work = workSnapshot.data() || {};
    const eventActor = {
      nombre: text(actor.nombre, 200) || "Persona del equipo",
      correo: text(actor.correo, 240),
    };
    writeCommercialLink(transaction, workRef, {
      actor: eventActor,
      actorUid,
      businessId,
      currentCount: work.ventasVinculadas,
      documentId: saleRef.id,
      documentNumber: numero,
      documentStatus: "confirmada",
      documentType: "venta",
      extra: {cotizacionId: quoteId, cotizacionNumero: text(quote.numero, 120)},
      timestamp,
      total: stored.total,
    });
    writeSaleConfirmationEvent(transaction, workRef, {
      actor: eventActor,
      actorUid,
      businessId,
      currency: stored.moneda,
      quoteNumber: stored.cotizacionNumero,
      saleId: saleRef.id,
      saleNumber: numero,
      timestamp,
      total: stored.total,
    });
  }
  return {
    idempotent: false,
    productosActualizados: appliedProductCount,
    sale: {id: saleRef.id, ...stored, createdAt: null, updatedAt: null},
    quotePatch: {
      ventaId: saleRef.id,
      ventaNumero: numero,
      ventaEstado: "confirmada",
      ventaRegistradaEn: timestamp,
    },
  };
}

async function crearVentaDesdeCotizacionHandler(request, dependencies, clock = new Date()) {
  const {db, FieldValue, HttpsError} = dependencies; const {uid, businessId, businessRef} = await access(request, dependencies);
  const reqId = requestId(request?.data?.requestId, HttpsError); const quoteId = id(request?.data?.cotizacionId, "La cotización", HttpsError);
  const requestRef = businessRef.collection("quoteSaleConversionRequests").doc(reqId);
  const quoteRef = businessRef.collection("cotizaciones").doc(quoteId);
  return transactionRetry(db, async (transaction) => {
    const previous = await transaction.get(requestRef);
    if (previous.exists) { const data = previous.data() || {}; if (data.uidUsuario !== uid || data.cotizacionId !== quoteId) fail(HttpsError, "already-exists", "La solicitud ya fue usada para otra cotización."); const existing = await transaction.get(businessRef.collection("ventas").doc(data.ventaId)); return {venta: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true}; }
    const quoteSnapshot = await transaction.get(quoteRef);
    if (!quoteSnapshot.exists) fail(HttpsError, "not-found", "No se encontró la cotización."); const quote = quoteSnapshot.data() || {};
    if (quote.negocioId && quote.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes registrar esta cotización.");
    if (quote.estado !== "aceptada") fail(HttpsError, "failed-precondition", "Sólo una cotización aceptada puede registrarse como venta.");
    const created = await createConfirmedSaleFromQuoteInTransaction({
      actor: {uid, origen: "registro_compatibilidad"},
      businessId,
      businessRef,
      clock,
      dependencies,
      quote,
      quoteId,
      transaction,
    });
    const timestamp = FieldValue.serverTimestamp();
    if (created.quotePatch) {
      transaction.update(quoteRef, {...created.quotePatch, actualizadoEn: timestamp});
    }
    transaction.set(requestRef, {
      negocioId: businessId,
      cotizacionId: quoteId,
      ventaId: created.sale.id,
      numero: created.sale.numero,
      uidUsuario: uid,
      creadoEn: timestamp,
    });
    return {
      venta: created.sale,
      requestId: reqId,
      idempotent: created.idempotent,
      alreadyConverted: created.idempotent,
      productosActualizados: created.productosActualizados,
    };
  });
}

function preservedClient(sale) { return sale.clienteSnapshot || {}; }
function preservedItem(line) { return line?.inventarioSnapshot || {inventarioId: line?.itemId, codigoInterno: line?.codigo, nombre: line?.nombre, descripcion: line?.descripcion, tipoItem: line?.tipoItem, unidad: line?.unidad}; }
function assertQuoteReferences(existing, normalized, HttpsError) {
  const previous = Array.isArray(existing.items) ? existing.items : [];
  if (normalized.clienteId !== existing.clienteId || normalized.items.length !== previous.length) fail(HttpsError, "failed-precondition", "Una venta originada desde una cotización no permite cambiar cliente ni ítems.");
  const byLine = new Map(previous.map((line) => [text(line.lineaId, 160), line]));
  normalized.items.forEach((line) => { const original = byLine.get(line.lineaId); if (!original || text(original.itemId, 160) !== line.itemId) fail(HttpsError, "failed-precondition", "Una venta originada desde una cotización no permite cambiar cliente ni ítems."); if (Number(line.cantidad) > Number(original.cantidadCotizada ?? original.cantidad)) fail(HttpsError, "failed-precondition", "La cantidad no puede superar la cantidad cotizada."); });
}

async function actualizarVentaBorradorHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies; const {uid, businessId, businessRef} = await access(request, dependencies);
  const ventaId = id(request?.data?.ventaId, "La venta", HttpsError); const normalized = input(request?.data?.venta, HttpsError); const saleRef = businessRef.collection("ventas").doc(ventaId);
  return transactionRetry(db, async (transaction) => {
    const snapshot = await transaction.get(saleRef); if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró la venta."); const existing = snapshot.data() || {};
    if (existing.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes editar esta venta."); if (existing.estado !== "borrador") fail(HttpsError, "failed-precondition", "Sólo puedes editar ventas en borrador.");
    if (existing.cotizacionId) assertQuoteReferences(existing, normalized, HttpsError);
    const previousLines = new Map((existing.items || []).map((line) => [text(line.lineaId, 160), line])); const clientChanged = normalized.clienteId !== existing.clienteId;
    const itemChanged = normalized.items.map((item) => { const previous = previousLines.get(item.lineaId); return !previous || previous.itemId !== item.itemId; }); const refs = [];
    if (clientChanged) refs.push(businessRef.collection("clientes").doc(normalized.clienteId));
    normalized.items.forEach((item, index) => { if (itemChanged[index]) { if (!item.itemId) fail(HttpsError, "invalid-argument", "Selecciona un ítem de inventario válido."); refs.push(businessRef.collection("inventario").doc(item.itemId)); } });
    const snapshots = refs.length ? await transaction.getAll(...refs) : []; let cursor = 0;
    const clienteSnapshot = clientChanged ? client(snapshots[cursor++], businessId, normalized.clienteId, HttpsError) : preservedClient(existing);
    const items = normalized.items.map((item, index) => storedLine(item, itemChanged[index] ? inventory(snapshots[cursor++], businessId, item.itemId, HttpsError) : preservedItem(previousLines.get(item.lineaId)), HttpsError, existing.cotizacionId ? {cantidadCotizada: previousLines.get(item.lineaId).cantidadCotizada} : {}));
    const timestamp = FieldValue.serverTimestamp(); const update = {...normalized, clienteSnapshot, items, ...totals(items, HttpsError, {descuentoGeneral: normalized.descuento, afectaIva: normalized.afectaIva, tasaIva: adaptDocumentLocalization(existing).tasaIva}), actualizadoPorUid: uid, updatedAt: timestamp}; transaction.update(saleRef, update);
    return {venta: {id: ventaId, ...existing, ...update, updatedAt: null}};
  });
}

async function confirmarVentaHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies; const context = await access(request, dependencies); const {uid, businessId, businessRef} = context;
  const ventaId = id(request?.data?.ventaId, "La venta", HttpsError); const reqId = requestId(request?.data?.requestId, HttpsError);
  const saleRef = businessRef.collection("ventas").doc(ventaId); const requestRef = businessRef.collection("saleConfirmRequests").doc(reqId);
  return transactionRetry(db, async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) { const data = previousRequest.data() || {}; if (data.uidUsuario !== uid || data.ventaId !== ventaId) fail(HttpsError, "already-exists", "La solicitud ya fue usada para otra venta."); const existing = await transaction.get(saleRef); return {venta: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true, productosActualizados: Number(data.productosActualizados || 0)}; }
    const saleSnapshot = await transaction.get(saleRef); if (!saleSnapshot.exists) fail(HttpsError, "not-found", "No se encontró la venta."); const sale = saleSnapshot.data() || {};
    if (sale.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes confirmar esta venta.");
    if (sale.estado === "confirmada" || sale.stockAplicado === true) { transaction.set(requestRef, {negocioId: businessId, ventaId, uidUsuario: uid, productosActualizados: 0, creadoEn: FieldValue.serverTimestamp()}); return {venta: {id: ventaId, ...sale}, requestId: reqId, idempotent: true, productosActualizados: 0}; }
    if (sale.estado !== "borrador") fail(HttpsError, "failed-precondition", "La venta no puede confirmarse.");
    const workRef = sale.trabajoId ? businessRef.collection("trabajos").doc(id(sale.trabajoId, "El proyecto", HttpsError)) : null;
    if (workRef) linkedWorkFields(await transaction.get(workRef), businessId, HttpsError);
    const lines = Array.isArray(sale.items) ? sale.items : []; const productLines = lines.filter((line) => line.tipoItem === "producto"); const toValidate = sale.cotizacionId ? productLines : lines;
    const groupMap = new Map(); toValidate.forEach((line) => { if (!line.itemId) fail(HttpsError, "failed-precondition", `El ítem ${line.nombre} no está vinculado al inventario.`); const group = groupMap.get(line.itemId) || {itemId: line.itemId, lines: []}; group.lines.push(line); groupMap.set(line.itemId, group); });
    const groups = [...groupMap.values()]; const clientRef = sale.cotizacionId ? null : businessRef.collection("clientes").doc(sale.clienteId); const itemRefs = groups.map((group) => businessRef.collection("inventario").doc(group.itemId)); const refs = clientRef ? [clientRef, ...itemRefs] : itemRefs;
    const snapshots = refs.length ? await transaction.getAll(...refs) : []; if (clientRef) client(snapshots[0], businessId, sale.clienteId, HttpsError); const itemSnapshots = clientRef ? snapshots.slice(1) : snapshots; const timestamp = FieldValue.serverTimestamp();
    const efectosInventario = [];
    groups.forEach((group, index) => { const snapshot = itemSnapshots[index]; if (!snapshot.exists) fail(HttpsError, "failed-precondition", `No se encontró el ítem ${group.lines[0].nombre}.`); const raw = snapshot.data() || {}; if (raw.negocioId && raw.negocioId !== businessId) fail(HttpsError, "permission-denied", "Un ítem pertenece a otro negocio."); const currentType = TYPES.has(raw.tipoItem) ? raw.tipoItem : "producto"; if (group.lines.some((line) => line.tipoItem !== currentType)) fail(HttpsError, "failed-precondition", "Un ítem cambió de tipo."); if (!sale.cotizacionId && raw.estado && raw.estado !== "activo") fail(HttpsError, "failed-precondition", "Un ítem ya no está disponible."); if (currentType !== "producto") return;
      let running = resolveInventoryEconomicState({item: raw, operationCurrency: sale.moneda}, HttpsError);
      group.lines.forEach((line) => {
        const cantidad = Number(line.cantidad);
        if (!Number.isFinite(cantidad) || cantidad <= 0) fail(HttpsError, "failed-precondition", "La cantidad de salida no es válida.");
        if (running.stock < cantidad) fail(HttpsError, "failed-precondition", `Stock insuficiente para ${text(line.nombre, 240)}. Disponible: ${running.stock}.`);
        const movementRef = businessRef.collection("movimientosInventario").doc(`${ventaId}__${line.lineaId}`);
        let costFields = historicalCostFields({...raw, costoPromedio: running.average}, cantidad, sale.moneda);
        if (costFields.costoHistoricoDisponible !== true) fail(HttpsError, "failed-precondition", "El producto no tiene un costo vigente confiable.");
        const outflow = applyInventoryCostedOutflow(running, {
          cantidad,
          costoUnitario: costFields.costoUnitario,
        }, HttpsError);
        costFields = {...costFields, costoTotal: outflow.costoTotal};
        const next = outflow.next;
        transaction.set(movementRef, {movimientoId: movementRef.id, negocioId: businessId, itemId: line.itemId, ventaId, ventaNumero: sale.numero, tipo: "salida_venta", cantidad, stockAnterior: running.stock, stockPosterior: next.stock, valorInventarioAnterior: running.value, valorInventarioPosterior: next.value, costoPromedioAnterior: running.average, costoPromedioPosterior: next.average, modeloEconomiaInventarioVersion: INVENTORY_ECONOMIC_MODEL_VERSION, motivo: "Confirmación de venta", codigo: text(line.codigo, 100), nombre: text(line.nombre, 240), unidad: text(line.unidad, 80), ...costFields, creadoPorUid: uid, createdAt: timestamp});
        efectosInventario.push({itemId: line.itemId, lineaId: line.lineaId, movimientoId: movementRef.id, cantidad, cantidadSolicitada: cantidad, codigo: text(line.codigo, 100), nombre: text(line.nombre, 240), unidad: text(line.unidad, 80), fecha: sale.fechaVenta, tipoItem: "producto", ...costFields});
        running = next;
      });
      transaction.update(itemRefs[index], {stock: running.stock, ...inventoryEconomicFields(running, timestamp), actualizadoEn: timestamp, actualizadoPorUid: uid});
    });
    const update = {estado: "confirmada", efectosInventario, stockAplicado: true, stockAplicadoAt: timestamp, confirmadoPorUid: uid, confirmedAt: timestamp, actualizadoPorUid: uid, updatedAt: timestamp}; transaction.update(saleRef, update);
    if (workRef) writeSaleConfirmationEvent(transaction, workRef, {actor: {nombre: text(context.membership?.nombre || context.membership?.correo, 200) || "Persona del equipo", correo: text(context.membership?.correo, 240)}, actorUid: uid, businessId, currency: sale.moneda, quoteNumber: sale.cotizacionNumero, saleId: ventaId, saleNumber: sale.numero, timestamp, total: sale.total});
    transaction.set(requestRef, {negocioId: businessId, ventaId, uidUsuario: uid, productosActualizados: productLines.length, creadoEn: timestamp});
    return {venta: {id: ventaId, ...sale, ...update, confirmedAt: null, updatedAt: null}, requestId: reqId, idempotent: false, productosActualizados: productLines.length};
  });
}

async function cancelarVentaBorradorHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await access(request, dependencies);
  const ventaId = id(request?.data?.ventaId, "La venta", HttpsError);
  const reqId = requestId(request?.data?.requestId, HttpsError);
  const motivo = text(request?.data?.motivo, 500);
  if (motivo.length < 3) {
    fail(HttpsError, "invalid-argument", "Ingresa el motivo de cancelación.");
  }
  const saleRef = businessRef.collection("ventas").doc(ventaId);
  const requestRef = businessRef.collection("saleCancellationRequests").doc(reqId);
  const fingerprint = hash({ventaId, motivo});
  return transactionRetry(db, async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      const previous = previousRequest.data() || {};
      if (previous.uidUsuario !== uid || previous.fingerprint !== fingerprint) {
        fail(HttpsError, "already-exists", "La solicitud ya fue usada con otros datos.");
      }
      const existingSnapshot = await transaction.get(saleRef);
      return {
        venta: {id: ventaId, ...(existingSnapshot.data() || {})},
        requestId: reqId,
        idempotent: true,
        productosRevertidos: Number(previous.productosRevertidos || 0),
      };
    }
    const snapshot = await transaction.get(saleRef);
    if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró la venta.");
    const existing = snapshot.data() || {};
    if (existing.negocioId !== businessId) {
      fail(HttpsError, "permission-denied", "No puedes cancelar esta venta.");
    }
    const isQuoteConfirmed = existing.estado === "confirmada" && Boolean(existing.cotizacionId);
    if (existing.estado !== "borrador" && !isQuoteConfirmed && existing.estado !== "cancelada") {
      fail(HttpsError, "failed-precondition", "La venta no puede cancelarse desde este flujo.");
    }
    if (existing.estado === "cancelada") {
      const timestamp = FieldValue.serverTimestamp();
      transaction.set(requestRef, {
        negocioId: businessId,
        ventaId,
        uidUsuario: uid,
        fingerprint,
        productosRevertidos: 0,
        creadoEn: timestamp,
      });
      return {venta: {id: ventaId, ...existing}, requestId: reqId, idempotent: true, productosRevertidos: 0};
    }

    const effects = Array.isArray(existing.efectosInventario)
      ? existing.efectosInventario
      : [];
    const productLines = (Array.isArray(existing.items) ? existing.items : [])
      .filter((line) => line.tipoItem === "producto");
    if (isQuoteConfirmed && existing.stockAplicado === true && productLines.length && !effects.length) {
      fail(HttpsError, "failed-precondition", "Esta venta histórica no contiene el detalle necesario para revertir su stock de forma segura.");
    }
    const groups = new Map();
    effects.forEach((effect, index) => {
      const itemId = id(effect?.itemId, `Efecto ${index + 1}`, HttpsError);
      const lineaId = id(effect?.lineaId, `Línea ${index + 1}`, HttpsError);
      const cantidad = number(effect?.cantidad, `Efecto ${index + 1}: cantidad`, HttpsError, {minimum: Number.MIN_VALUE});
      const group = groups.get(itemId) || {itemId, effects: []};
      const costoUnitario = Number(effect?.costoUnitario);
      const costoTotal = Number(effect?.costoTotal);
      const hasHistoricalCost = Number.isFinite(costoUnitario) && costoUnitario >= 0 && Number.isFinite(costoTotal) && costoTotal >= 0;
      group.effects.push({
        cantidad,
        itemId,
        lineaId,
        movimientoId: text(effect?.movimientoId, 160),
        ...(hasHistoricalCost ? {
          costoUnitario,
          costoTotal,
          costoFuente: text(effect?.costoFuente, 80),
          moneda: costCurrency(effect, existing.moneda),
          costoHistoricoDisponible: true,
        } : {costoHistoricoDisponible: false}),
      });
      groups.set(itemId, group);
    });
    const groupedEffects = [...groups.values()];
    const inventoryRefs = groupedEffects.map((group) =>
      businessRef.collection("inventario").doc(group.itemId)
    );
    const inventorySnapshots = await Promise.all(
      inventoryRefs.map((ref) => transaction.get(ref))
    );
    const timestamp = FieldValue.serverTimestamp();
    const reversalEffects = [];
    groupedEffects.forEach((group, index) => {
      const inventorySnapshot = inventorySnapshots[index];
      if (!inventorySnapshot.exists) {
        fail(HttpsError, "failed-precondition", "No se encontró un producto necesario para revertir el stock.");
      }
      const raw = inventorySnapshot.data() || {};
      if (raw.negocioId && raw.negocioId !== businessId) {
        fail(HttpsError, "permission-denied", "Un producto pertenece a otro negocio.");
      }
      const firstCurrency = group.effects.find((effect) => effect.moneda)?.moneda || existing.moneda;
      let running = resolveInventoryEconomicState({item: raw, operationCurrency: firstCurrency}, HttpsError);
      group.effects.forEach((effect) => {
        if (!effect.costoHistoricoDisponible) {
          fail(HttpsError, "failed-precondition", "La venta no conserva el costo histórico necesario para reponer inventario.");
        }
        if (effect.moneda !== running.currency) {
          fail(HttpsError, "failed-precondition", "La venta no puede reponer valor en una moneda distinta al saldo de inventario.");
        }
        const next = applyInventoryEconomicDelta(running, {
          quantityDelta: effect.cantidad,
          valueDelta: effect.costoTotal,
        }, HttpsError);
        const movementRef = businessRef.collection("movimientosInventario")
          .doc(`cancelacion__${ventaId}__${effect.lineaId}`);
        transaction.create(movementRef, {
          movimientoId: movementRef.id,
          movimientoOrigenId: effect.movimientoId,
          negocioId: businessId,
          itemId: effect.itemId,
          ventaId,
          ventaNumero: existing.numero,
          cotizacionId: existing.cotizacionId || "",
          cotizacionNumero: existing.cotizacionNumero || "",
          tipo: "entrada_cancelacion_venta",
          cantidad: effect.cantidad,
          ...(effect.costoHistoricoDisponible ? {
            costoUnitario: effect.costoUnitario,
            costoTotal: effect.costoTotal,
            costoFuente: effect.costoFuente,
            moneda: effect.moneda,
            costoHistoricoDisponible: true,
          } : {costoHistoricoDisponible: false}),
          stockAnterior: running.stock,
          stockPosterior: next.stock,
          valorInventarioAnterior: running.value,
          valorInventarioPosterior: next.value,
          costoPromedioAnterior: running.average,
          costoPromedioPosterior: next.average,
          modeloEconomiaInventarioVersion: INVENTORY_ECONOMIC_MODEL_VERSION,
          motivo,
          creadoPorUid: uid,
          createdAt: timestamp,
        });
        reversalEffects.push({
          itemId: effect.itemId,
          lineaId: effect.lineaId,
          movimientoId: movementRef.id,
          movimientoOrigenId: effect.movimientoId,
          cantidad: effect.cantidad,
          ...(effect.costoHistoricoDisponible ? {
            costoUnitario: effect.costoUnitario,
            costoTotal: effect.costoTotal,
            costoFuente: effect.costoFuente,
            moneda: effect.moneda,
            costoHistoricoDisponible: true,
          } : {costoHistoricoDisponible: false}),
        });
        running = next;
      });
      transaction.update(inventoryRefs[index], {
        stock: running.stock,
        ...inventoryEconomicFields(running, timestamp),
        actualizadoEn: timestamp,
        actualizadoPorUid: uid,
      });
    });
    const update = {
      estado: "cancelada",
      motivoCancelacion: motivo,
      canceladoPorUid: uid,
      cancelledAt: timestamp,
      stockRevertido: reversalEffects.length > 0,
      stockRevertidoEn: reversalEffects.length > 0 ? timestamp : null,
      efectosInventarioReversa: reversalEffects,
      estadoStock: reversalEffects.length > 0 ? "revertido" : existing.estadoStock || "no_aplica",
      actualizadoPorUid: uid,
      updatedAt: timestamp,
    };
    transaction.update(saleRef, update);
    transaction.create(saleRef.collection("eventos").doc(`cancelacion__${reqId}`), {
      negocioId: businessId,
      ventaId,
      tipo: "venta_cancelada",
      motivo,
      uidUsuario: uid,
      requestId: reqId,
      productosRevertidos: reversalEffects.length,
      creadoEn: timestamp,
    });
    if (existing.cotizacionId) {
      const quoteRef = businessRef.collection("cotizaciones").doc(existing.cotizacionId);
      transaction.update(quoteRef, {
          ventaEstado: "cancelada",
          ventaCanceladaEn: timestamp,
          ventaCancelacionMotivo: motivo,
          actualizadoEn: timestamp,
      });
      transaction.create(quoteRef.collection("eventos").doc(`venta_cancelada__${ventaId}`), {
        negocioId: businessId,
        cotizacionId: existing.cotizacionId,
        tipo: "venta_cancelada",
        estadoAnterior: "aceptada",
        estadoResultante: "aceptada",
        medio: "sistema",
        uidUsuario: uid,
        requestId: reqId,
        detalle: {ventaId, ventaNumero: existing.numero || "", motivo},
        creadoEn: timestamp,
      });
    }
    transaction.set(requestRef, {
      negocioId: businessId,
      ventaId,
      uidUsuario: uid,
      fingerprint,
      productosRevertidos: reversalEffects.length,
      creadoEn: timestamp,
    });
    return {
      venta: {id: ventaId, ...existing, ...update, updatedAt: null},
      requestId: reqId,
      idempotent: false,
      productosRevertidos: reversalEffects.length,
    };
  });
}

module.exports = {actualizarVentaBorradorHandler, cancelarVentaBorradorHandler, confirmarVentaHandler, crearVentaDesdeCotizacionHandler, crearVentaHandler, createConfirmedSaleFromQuoteInTransaction, formatSaleNumber: formatNumber, normalizeSaleInput: input, calculateSaleTotals: totals, clientSnapshotFromDocument: client, quoteClientSnapshot};
