// Venta en borrador generada al finalizar la ejecución de una OT (alcance autorizado el 2026-11-26).
// Taller no modifica Ventas: usa las funciones que salePersistence.js ya exporta y deja el mismo documento que
// crearVenta (estado «borrador», sin tocar stock). Ventas revisa, ajusta y confirma; recién ahí se descuenta stock.
const {documentLocalizationSnapshot} = require("./localization");
const {sanitizeDecimals} = require("./money");
const {buildAuthoritativeCompanySnapshot} = require("./companySnapshot");
const {
  assertSaleAmountDecimals,
  calculateSaleTotals,
  clientSnapshotFromDocument,
  formatSaleNumber,
  storedSaleLine,
} = require("./salePersistence");

const SALE_MODEL_VERSION = 1;

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function text(value, max = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

// Misma fecha de negocio que usa Ventas para el correlativo y la fecha de venta.
function saleDateParts(clock) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(clock);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {year: Number(map.year), value: `${map.year}-${map.month}-${map.day}`};
}

// Un id fijo por OT: dos finalizaciones nunca crean dos ventas (transaction.create falla si ya existe).
function workOrderSaleId(otId) {
  return `ordenTrabajo__${otId}`;
}

// Lecturas de la venta. Se llama antes de cualquier escritura de la transacción de cierre.
async function readWorkOrderSaleContext(transaction, {businessRef, businessId, order, otId, HttpsError, clock = new Date()}) {
  const clienteId = text(order.clienteId, 160);
  if (!clienteId) fail(HttpsError, "failed-precondition", "La OT no tiene cliente para generar la venta.");
  const date = saleDateParts(clock);
  const saleRef = businessRef.collection("ventas").doc(workOrderSaleId(otId));
  const counterRef = businessRef.collection("saleCounters").doc(String(date.year));
  const [sale, client, counter, tax, profile] = await transaction.getAll(
    saleRef,
    businessRef.collection("clientes").doc(clienteId),
    counterRef,
    businessRef.collection("configuracion").doc("impuestos"),
    businessRef.collection("empresa").doc("perfil"),
  );
  if (sale.exists) fail(HttpsError, "failed-precondition", "Esta OT ya tiene una venta generada.");
  // Mismas validaciones del cliente que Ventas (activo, del negocio y con nombre o razón social).
  const clienteSnapshot = clientSnapshotFromDocument(client, businessId, clienteId, HttpsError);
  return {date, saleRef, counterRef, clienteId, clienteSnapshot,
    counterData: counter.data() || {}, taxData: tax.data() || {}, profileData: profile.data() || {}};
}

function saleItemSnapshot(itemSnapshot, itemId, tipoItem, frozenName) {
  const raw = itemSnapshot?.data() || {};
  return {
    inventarioId: itemId,
    codigoInterno: text(raw.codigoInterno || raw.sku, 100),
    nombre: text(frozenName || raw.nombre || raw.descripcionItem, 240),
    descripcion: text(raw.descripcion, 3000),
    tipoItem,
    unidad: text(raw.unidad, 80) || "unidad",
    modeloInventarioVersion: Number(raw.modeloInventarioVersion || 1),
  };
}

// Líneas de la venta: cada servicio (cantidad 1) y, debajo, sus repuestos del inventario, con los precios
// congelados al finalizar. Los repuestos del cliente o «no requiere» no generan líneas.
function workOrderSaleLines(frozenServices, items) {
  const lines = [];
  frozenServices.forEach((service) => {
    lines.push({
      value: {lineaId: `servicio-${service.servicioOtId}`, itemId: service.itemId, cantidad: 1,
        precioUnitario: service.precioUnitario, descuentoPct: 0, origenAdicionalId: ""},
      snapshot: saleItemSnapshot(items.get(service.itemId), service.itemId, "servicio", service.servicioSnapshot?.nombre),
    });
    (service.productos || []).forEach((product, index) => {
      lines.push({
        value: {lineaId: `repuesto-${service.servicioOtId}-${index + 1}`, itemId: product.itemId, cantidad: product.cantidad,
          precioUnitario: product.precioUnitario, descuentoPct: 0, origenAdicionalId: ""},
        snapshot: saleItemSnapshot(items.get(product.itemId), product.itemId, "producto", product.productoSnapshot?.nombre),
      });
    });
  });
  return lines;
}

// Arma el documento de la venta (sin escribir). Mismo formato que crearVenta en salePersistence.js.
function buildWorkOrderDraftSale({saleContext, businessId, businessData, uid, order, otId, frozenServices, items,
  closureCurrency, timestamp, HttpsError}) {
  const localization = documentLocalizationSnapshot(businessData || {}, saleContext.taxData);
  if (localization.moneda !== closureCurrency) {
    fail(HttpsError, "failed-precondition", "La moneda de la OT no coincide con la del negocio. Revisa la configuración antes de finalizar.");
  }
  const decimals = sanitizeDecimals(localization.montoDecimales);
  const lines = workOrderSaleLines(frozenServices, items);
  if (!lines.length) fail(HttpsError, "failed-precondition", "La OT no tiene trabajos para generar la venta.");
  if (lines.length > 200) fail(HttpsError, "failed-precondition", "La venta admite hasta 200 ítems.");
  assertSaleAmountDecimals({items: lines.map((line) => line.value), descuento: 0}, decimals, HttpsError);
  const saleItems = lines.map((line) => storedSaleLine(line.value, line.snapshot, HttpsError, {}, decimals));
  const current = Number(saleContext.counterData.lastNumber || 0);
  const sequence = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
  const numero = formatSaleNumber(saleContext.date.year, sequence);
  const numeroOT = text(order.numeroOT, 40);
  const stored = {
    modeloVentaVersion: SALE_MODEL_VERSION, ventaId: saleContext.saleRef.id, negocioId: businessId, numero,
    anio: saleContext.date.year, correlativo: sequence, estado: "borrador",
    paisCodigo: localization.paisCodigo, moneda: localization.moneda, locale: localization.locale,
    impuestoNombre: localization.impuestoNombre, ...(decimals > 0 ? {montoDecimales: decimals} : {}),
    empresaSnapshot: buildAuthoritativeCompanySnapshot({businessId, business: businessData || {}, profile: saleContext.profileData}),
    clienteId: saleContext.clienteId, clienteSnapshot: saleContext.clienteSnapshot,
    // Origen: la OT que la generó (mismos nombres que en la OT).
    otId, numeroOT,
    items: saleItems,
    ...calculateSaleTotals(saleItems, HttpsError, {descuentoGeneral: 0, afectaIva: true, tasaIva: localization.tasaIva, decimals}),
    fechaVenta: saleContext.date.value, fechaDocumento: "", tipoDocumento: "sin_documento", numeroDocumento: "",
    condicionesPago: "", observaciones: numeroOT ? `Generada al finalizar la orden de trabajo ${numeroOT}.` : "Generada al finalizar una orden de trabajo.",
    stockAplicado: false, stockAplicadoAt: null,
    creadoPorUid: uid, actualizadoPorUid: uid, createdAt: timestamp, updatedAt: timestamp,
  };
  return {
    saleRef: saleContext.saleRef, stored,
    counterRef: saleContext.counterRef,
    counter: {negocioId: businessId, year: saleContext.date.year, lastNumber: sequence, actualizadoEn: timestamp},
  };
}

module.exports = {buildWorkOrderDraftSale, readWorkOrderSaleContext, workOrderSaleId, workOrderSaleLines};
