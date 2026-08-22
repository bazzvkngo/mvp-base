const {createHash} = require("node:crypto");
const {adaptDocumentLocalization, documentLocalizationSnapshot} = require("./localization");
const {buildAuthoritativeCompanySnapshot, resolveCompanySnapshot} = require("./companySnapshot");
const {fiscalSnapshotFields} = require("./fiscalIdentifier");

const MODEL_VERSION = 1;
const VAT_RATE = 0.19;
const WRITE_ROLES = ["OWNER", "ADMIN"];
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
  const subtotalLinea = Math.round(value.cantidad * value.precioUnitario);
  const descuentoLinea = Math.round((subtotalLinea * value.descuentoPct) / 100);
  const totalLinea = subtotalLinea - descuentoLinea;
  safeMoney([subtotalLinea, descuentoLinea, totalLinea], HttpsError);
  return {lineaId: value.lineaId, itemId: value.itemId, codigo: snapshot.codigoInterno, nombre: snapshot.nombre, descripcion: snapshot.descripcion, tipoItem: snapshot.tipoItem, unidad: snapshot.unidad, cantidad: value.cantidad, precioUnitario: value.precioUnitario, descuentoPct: value.descuentoPct, subtotalLinea, descuentoLinea, totalLinea, inventarioSnapshot: snapshot, ...extra};
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
async function access(request, dependencies) { return dependencies.requireBusinessAccess(request, {db: dependencies.db, HttpsError: dependencies.HttpsError}, {roles: WRITE_ROLES}); }
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

async function crearVentaDesdeCotizacionHandler(request, dependencies, clock = new Date()) {
  const {db, FieldValue, HttpsError} = dependencies; const {uid, businessId, businessRef} = await access(request, dependencies);
  const reqId = requestId(request?.data?.requestId, HttpsError); const quoteId = id(request?.data?.cotizacionId, "La cotización", HttpsError);
  const now = chileParts(clock); const saleRef = businessRef.collection("ventas").doc(); const requestRef = businessRef.collection("quoteSaleConversionRequests").doc(reqId);
  const quoteRef = businessRef.collection("cotizaciones").doc(quoteId); const counterRef = businessRef.collection("saleCounters").doc(String(now.year));
  return transactionRetry(db, async (transaction) => {
    const previous = await transaction.get(requestRef);
    if (previous.exists) { const data = previous.data() || {}; if (data.uidUsuario !== uid || data.cotizacionId !== quoteId) fail(HttpsError, "already-exists", "La solicitud ya fue usada para otra cotización."); const existing = await transaction.get(businessRef.collection("ventas").doc(data.ventaId)); return {venta: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true}; }
    const [quoteSnapshot, counterSnapshot, businessSnapshot, companyProfileSnapshot] = await Promise.all([transaction.get(quoteRef), transaction.get(counterRef), transaction.get(businessRef), transaction.get(businessRef.collection("empresa").doc("perfil"))]);
    if (!quoteSnapshot.exists) fail(HttpsError, "not-found", "No se encontró la cotización."); const quote = quoteSnapshot.data() || {};
    if (quote.negocioId && quote.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes registrar esta cotización.");
    if (quote.ventaId) { const existing = await transaction.get(businessRef.collection("ventas").doc(quote.ventaId)); if (!existing.exists) fail(HttpsError, "failed-precondition", "El enlace de la cotización con su venta es inconsistente."); transaction.set(requestRef, {negocioId: businessId, cotizacionId: quoteId, ventaId: existing.id, numero: existing.data()?.numero || quote.ventaNumero || "", uidUsuario: uid, creadoEn: FieldValue.serverTimestamp()}); return {venta: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true, alreadyConverted: true}; }
    if (quote.estado !== "aceptada") fail(HttpsError, "failed-precondition", "Sólo una cotización aceptada puede registrarse como venta.");
    if (!Array.isArray(quote.items) || !quote.items.length) fail(HttpsError, "failed-precondition", "La cotización no contiene ítems.");
    if (quote.items.length > 200) fail(HttpsError, "failed-precondition", "La venta admite hasta 200 ítems.");
    const clienteSnapshot = quoteClientSnapshot(quote, HttpsError); const items = quote.items.map((item, index) => quoteLine(item, index, HttpsError));
    const normalized = input({clienteId: clienteSnapshot.clienteId, descuento: quote.descuento ?? quote.descuentoGeneral ?? 0, afectaIva: quote.afectaIva !== false, fechaVenta: now.value, fechaDocumento: "", tipoDocumento: "sin_documento", numeroDocumento: "", condicionesPago: quote.condicionesPago || quote.condiciones?.formaPago, observaciones: quote.observaciones || quote.condiciones?.observaciones, items}, HttpsError);
    const current = Number(counterSnapshot.data()?.lastNumber || 0); const sequence = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1; const numero = formatNumber(now.year, sequence); const timestamp = FieldValue.serverTimestamp();
    const currentCompanySnapshot = buildAuthoritativeCompanySnapshot({businessId, business: businessSnapshot.data() || {}, profile: companyProfileSnapshot.data() || {}});
    const stored = baseStored({businessId, uid, ventaId: saleRef.id, numero, sequence, now, normalized, clienteSnapshot, items, localization: adaptDocumentLocalization(quote), empresaSnapshot: resolveCompanySnapshot(quote, currentCompanySnapshot), origin: {cotizacionId: quoteId, cotizacionNumero: text(quote.numero, 120)}, timestamp, HttpsError});
    transaction.set(counterRef, {negocioId: businessId, year: now.year, lastNumber: sequence, actualizadoEn: timestamp}); transaction.set(saleRef, stored);
    transaction.update(quoteRef, {ventaId: saleRef.id, ventaNumero: numero, ventaRegistradaEn: timestamp, actualizadoEn: timestamp});
    transaction.set(requestRef, {negocioId: businessId, cotizacionId: quoteId, ventaId: saleRef.id, numero, uidUsuario: uid, creadoEn: timestamp});
    return {venta: {id: saleRef.id, ...stored, createdAt: null, updatedAt: null}, requestId: reqId, idempotent: false};
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
  const {db, FieldValue, HttpsError} = dependencies; const {uid, businessId, businessRef} = await access(request, dependencies);
  const ventaId = id(request?.data?.ventaId, "La venta", HttpsError); const reqId = requestId(request?.data?.requestId, HttpsError);
  const saleRef = businessRef.collection("ventas").doc(ventaId); const requestRef = businessRef.collection("saleConfirmRequests").doc(reqId);
  return transactionRetry(db, async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) { const data = previousRequest.data() || {}; if (data.uidUsuario !== uid || data.ventaId !== ventaId) fail(HttpsError, "already-exists", "La solicitud ya fue usada para otra venta."); const existing = await transaction.get(saleRef); return {venta: {id: existing.id, ...existing.data()}, requestId: reqId, idempotent: true, productosActualizados: Number(data.productosActualizados || 0)}; }
    const saleSnapshot = await transaction.get(saleRef); if (!saleSnapshot.exists) fail(HttpsError, "not-found", "No se encontró la venta."); const sale = saleSnapshot.data() || {};
    if (sale.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes confirmar esta venta.");
    if (sale.estado === "confirmada" || sale.stockAplicado === true) { transaction.set(requestRef, {negocioId: businessId, ventaId, uidUsuario: uid, productosActualizados: 0, creadoEn: FieldValue.serverTimestamp()}); return {venta: {id: ventaId, ...sale}, requestId: reqId, idempotent: true, productosActualizados: 0}; }
    if (sale.estado !== "borrador") fail(HttpsError, "failed-precondition", "La venta no puede confirmarse.");
    const lines = Array.isArray(sale.items) ? sale.items : []; const productLines = lines.filter((line) => line.tipoItem === "producto"); const toValidate = sale.cotizacionId ? productLines : lines;
    const groupMap = new Map(); toValidate.forEach((line) => { if (!line.itemId) fail(HttpsError, "failed-precondition", `El ítem ${line.nombre} no está vinculado al inventario.`); const group = groupMap.get(line.itemId) || {itemId: line.itemId, lines: []}; group.lines.push(line); groupMap.set(line.itemId, group); });
    const groups = [...groupMap.values()]; const clientRef = sale.cotizacionId ? null : businessRef.collection("clientes").doc(sale.clienteId); const itemRefs = groups.map((group) => businessRef.collection("inventario").doc(group.itemId)); const refs = clientRef ? [clientRef, ...itemRefs] : itemRefs;
    const snapshots = refs.length ? await transaction.getAll(...refs) : []; if (clientRef) client(snapshots[0], businessId, sale.clienteId, HttpsError); const itemSnapshots = clientRef ? snapshots.slice(1) : snapshots; const timestamp = FieldValue.serverTimestamp();
    groups.forEach((group, index) => { const snapshot = itemSnapshots[index]; if (!snapshot.exists) fail(HttpsError, "failed-precondition", `No se encontró el ítem ${group.lines[0].nombre}.`); const raw = snapshot.data() || {}; if (raw.negocioId && raw.negocioId !== businessId) fail(HttpsError, "permission-denied", "Un ítem pertenece a otro negocio."); const currentType = TYPES.has(raw.tipoItem) ? raw.tipoItem : "producto"; if (group.lines.some((line) => line.tipoItem !== currentType)) fail(HttpsError, "failed-precondition", "Un ítem cambió de tipo."); if (!sale.cotizacionId && raw.estado && raw.estado !== "activo") fail(HttpsError, "failed-precondition", "Un ítem ya no está disponible."); if (currentType !== "producto") return;
      let runningStock = Number(raw.stock || 0); if (!Number.isFinite(runningStock)) fail(HttpsError, "failed-precondition", "El stock no pudo actualizarse de forma segura.");
      group.lines.forEach((line) => { const cantidad = Number(line.cantidad); if (!Number.isFinite(cantidad) || cantidad <= 0) fail(HttpsError, "failed-precondition", "La cantidad de salida no es válida."); if (runningStock < cantidad) fail(HttpsError, "failed-precondition", `Stock insuficiente para ${text(line.nombre, 240)}. Disponible: ${runningStock}.`); const stockAnterior = runningStock; const stockPosterior = stockAnterior - cantidad; const movementRef = businessRef.collection("movimientosInventario").doc(`${ventaId}__${line.lineaId}`); transaction.set(movementRef, {movimientoId: movementRef.id, negocioId: businessId, itemId: line.itemId, ventaId, ventaNumero: sale.numero, tipo: "salida_venta", cantidad, stockAnterior, stockPosterior, motivo: "Confirmación de venta", codigo: text(line.codigo, 100), nombre: text(line.nombre, 240), unidad: text(line.unidad, 80), creadoPorUid: uid, createdAt: timestamp}); runningStock = stockPosterior; });
      transaction.update(itemRefs[index], {stock: runningStock, actualizadoEn: timestamp, actualizadoPorUid: uid});
    });
    const update = {estado: "confirmada", stockAplicado: true, stockAplicadoAt: timestamp, confirmadoPorUid: uid, confirmedAt: timestamp, actualizadoPorUid: uid, updatedAt: timestamp}; transaction.update(saleRef, update);
    transaction.set(requestRef, {negocioId: businessId, ventaId, uidUsuario: uid, productosActualizados: productLines.length, creadoEn: timestamp});
    return {venta: {id: ventaId, ...sale, ...update, confirmedAt: null, updatedAt: null}, requestId: reqId, idempotent: false, productosActualizados: productLines.length};
  });
}

async function cancelarVentaBorradorHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies; const {uid, businessId, businessRef} = await access(request, dependencies); const ventaId = id(request?.data?.ventaId, "La venta", HttpsError); const saleRef = businessRef.collection("ventas").doc(ventaId);
  return transactionRetry(db, async (transaction) => { const snapshot = await transaction.get(saleRef); if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró la venta."); const existing = snapshot.data() || {}; if (existing.negocioId !== businessId) fail(HttpsError, "permission-denied", "No puedes cancelar esta venta."); if (existing.estado === "cancelada") return {venta: {id: ventaId, ...existing}, idempotent: true}; if (existing.estado !== "borrador" || existing.stockAplicado) fail(HttpsError, "failed-precondition", "Sólo puedes cancelar ventas en borrador."); const timestamp = FieldValue.serverTimestamp(); const update = {estado: "cancelada", canceladoPorUid: uid, cancelledAt: timestamp, actualizadoPorUid: uid, updatedAt: timestamp}; transaction.update(saleRef, update); return {venta: {id: ventaId, ...existing, ...update, updatedAt: null}, idempotent: false}; });
}

module.exports = {actualizarVentaBorradorHandler, cancelarVentaBorradorHandler, confirmarVentaHandler, crearVentaDesdeCotizacionHandler, crearVentaHandler, formatSaleNumber: formatNumber, normalizeSaleInput: input, calculateSaleTotals: totals, clientSnapshotFromDocument: client, quoteClientSnapshot};
