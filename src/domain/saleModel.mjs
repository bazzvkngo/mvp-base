import {incrementScannedItem} from "./barcode.mjs";
import {adaptStoredFiscalIdentifier} from "./fiscalIdentifier.mjs";
import {addInventoryItemToLines} from "./inventoryLineAdd.mjs";
import {hasMaxDecimals, isMoneyAmount, mulRound, sanitizeDecimals, sumMoney} from "./money.mjs";

export const SALE_MODEL_VERSION = 1;
export const SALE_VAT_RATE = 0.19;
export const SALE_STATUSES = Object.freeze(["borrador", "confirmada", "cancelada"]);
export const SALE_DOCUMENT_TYPES = Object.freeze(["factura", "boleta", "otro", "sin_documento"]);
export const SALE_STATUS_LABELS = Object.freeze({
  borrador: "Preparada",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
});
export const SALE_STOCK_STATUS_LABELS = Object.freeze({
  completo: "Stock aplicado",
  no_aplica: "No aplica",
  parcial_pendiente: "Abastecimiento parcial pendiente",
  pendiente_abastecimiento: "Abastecimiento pendiente",
  revertido: "Stock revertido",
});
export const SALE_ITEM_TYPE_LABELS = Object.freeze({
  producto: "Producto",
  servicio: "Servicio",
  actividad: "Actividad",
});
export const SALE_DOCUMENT_TYPE_LABELS = Object.freeze({
  factura: "Factura",
  boleta: "Boleta",
  otro: "Otro",
  sin_documento: "Sin documento",
});

const STATUS_SET = new Set(SALE_STATUSES);
const CONFIRMED_STATUS_ALIASES = new Set(["confirmado", "activa", "activo"]);
const DOCUMENT_SET = new Set(SALE_DOCUMENT_TYPES);
const ITEM_TYPES = new Set(["producto", "servicio", "actividad"]);
const MAXIMUM_AMOUNT_MESSAGE = "El monto de la venta supera el máximo permitido.";

const text = (value, max = 2000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export function getSaleStatusLabel(status) {
  return SALE_STATUS_LABELS[String(status || "").toLowerCase()] || String(status || "");
}

export function getSaleStockStatusLabel(status, sale = {}) {
  const value = String(status || "").toLowerCase();
  if (SALE_STOCK_STATUS_LABELS[value]) return SALE_STOCK_STATUS_LABELS[value];
  if (sale.estado === "borrador") return "Pendiente de confirmación";
  if (sale.estado === "cancelada" && sale.stockRevertido) return "Stock revertido";
  return sale.stockAplicado ? "Stock aplicado" : "Sin movimiento de stock";
}

export function getSaleItemTypeLabel(type) {
  return SALE_ITEM_TYPE_LABELS[String(type || "").toLowerCase()] || "Ítem";
}

export function getSaleDocumentTypeLabel(type) {
  return SALE_DOCUMENT_TYPE_LABELS[String(type || "").toLowerCase()] || "Sin documento";
}

function id(value, label, {optional = false} = {}) {
  const result = text(value, 160);
  if (optional && !result) return "";
  if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(result)) throw new Error(`${label} no es válido.`);
  return result;
}

function number(value, label, {minimum = 0, maximum = Infinity} = {}) {
  if (value === "" || value == null) throw new Error(`${label} es obligatorio.`);
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} debe ser un número válido.`);
  if (result < minimum || result > maximum) throw new Error(`${label} está fuera del rango permitido.`);
  return result;
}

// SPEC 036: `decimals` son los decimales de cálculo del documento (`montoDecimales`; 0 = entero, como siempre). Con 0
// la validación es la de antes (un entero seguro); con decimales admite hasta esa cantidad de decimales.
function safeMoney(decimals, ...values) {
  if (values.some((value) => !isMoneyAmount(value, decimals))) {
    throw new Error(MAXIMUM_AMOUNT_MESSAGE);
  }
}

function assertAmountDecimals(value, decimals, label) {
  if (decimals > 0 && !hasMaxDecimals(value, decimals)) {
    throw new Error(`${label} admite hasta ${decimals} decimales.`);
  }
}

export function calculateSaleLine(raw = {}, index = 0, montoDecimales = 0) {
  const decimals = sanitizeDecimals(montoDecimales);
  const cantidad = number(raw.cantidad, `Ítem ${index + 1}: cantidad`, {minimum: Number.MIN_VALUE});
  const precioUnitario = number(raw.precioUnitario, `Ítem ${index + 1}: precio unitario`);
  assertAmountDecimals(precioUnitario, decimals, `Ítem ${index + 1}: precio unitario`);
  const descuentoPct = number(raw.descuentoPct ?? 0, `Ítem ${index + 1}: descuento`, {maximum: 100});
  const subtotalLinea = mulRound(cantidad, precioUnitario, decimals);
  const descuentoLinea = mulRound(subtotalLinea, descuentoPct, decimals, 100);
  const totalLinea = sumMoney([subtotalLinea, -descuentoLinea], decimals);
  safeMoney(decimals, subtotalLinea, descuentoLinea, totalLinea);
  return {cantidad, precioUnitario, descuentoPct, subtotalLinea, descuentoLinea, totalLinea};
}

const EMPTY_SALE_TOTALS = {subtotal: 0, descuentoItems: 0, descuento: 0, descuentoTotal: 0, neto: 0, afectaIva: true, tasaIva: SALE_VAT_RATE, iva: 0, total: 0};

// Totales del borrador para el resumen. Sin ítems (o con un cálculo inválido) devuelve ceros, pero con la misma tasa que
// tendría con ítems (`taxRate`: la del documento o la del país del negocio); así la etiqueta del impuesto no cambia
// al agregar la primera línea. Con la venta exenta la tasa es 0.
export function calculateSaleDraftTotals(draft, {taxRate = SALE_VAT_RATE, montoDecimales = 0} = {}) {
  const afectaIva = draft?.afectaIva !== false;
  const tasaIva = afectaIva ? taxRate : 0;
  const items = Array.isArray(draft?.items) ? draft.items : [];
  try {
    return items.length
      ? calculateSaleTotals(items, draft.descuento, {afectaIva: draft.afectaIva, tasaIva: taxRate, montoDecimales})
      : {...EMPTY_SALE_TOTALS, descuento: Number(draft?.descuento || 0), afectaIva, tasaIva};
  } catch {
    return {...EMPTY_SALE_TOTALS, afectaIva, tasaIva};
  }
}

export function calculateSaleTotals(
  items = [],
  descuentoGeneral = 0,
  {afectaIva = true, tasaIva = SALE_VAT_RATE, montoDecimales = 0} = {}
) {
  if (!Array.isArray(items) || !items.length) throw new Error("Agrega al menos un ítem a la venta.");
  const decimals = sanitizeDecimals(montoDecimales);
  const lines = items.map((item, index) => calculateSaleLine(item, index, decimals));
  const subtotal = sumMoney(lines.map((line) => line.subtotalLinea), decimals);
  const descuentoItems = sumMoney(lines.map((line) => line.descuentoLinea), decimals);
  const descuento = number(descuentoGeneral ?? 0, "El descuento general");
  assertAmountDecimals(descuento, decimals, "El descuento general");
  if (descuento > sumMoney([subtotal, -descuentoItems], decimals)) {
    throw new Error("El descuento general no puede superar el monto disponible.");
  }
  const effectiveRate = afectaIva ? number(tasaIva, "La tasa de IVA", {maximum: 1}) : 0;
  const descuentoTotal = sumMoney([descuentoItems, descuento], decimals);
  const neto = sumMoney([subtotal, -descuentoTotal], decimals);
  const iva = afectaIva ? mulRound(neto, effectiveRate, decimals) : 0;
  const total = sumMoney([neto, iva], decimals);
  safeMoney(decimals, subtotal, descuentoItems, descuento, descuentoTotal, neto, iva, total);
  return {
    subtotal,
    descuentoItems,
    descuento,
    descuentoTotal,
    neto,
    afectaIva: Boolean(afectaIva),
    tasaIva: afectaIva ? effectiveRate : 0,
    iva,
    total,
  };
}

export function buildSaleMutationPayload(raw = {}) {
  if (!Array.isArray(raw.items) || !raw.items.length) throw new Error("Agrega al menos un ítem a la venta.");
  if (raw.items.length > 200) throw new Error("La venta admite hasta 200 ítems.");
  const descuento = number(raw.descuento ?? 0, "El descuento general");
  const afectaIva = raw.afectaIva !== false;
  // Decimales de cálculo del documento (los pone quien arma el borrador; el servidor decide los suyos con el
  // snapshot del documento y no lee este valor).
  const montoDecimales = sanitizeDecimals(raw.montoDecimales);
  calculateSaleTotals(raw.items, descuento, {afectaIva, montoDecimales});
  return {
    clienteId: id(raw.clienteId, "El cliente"),
    // SPEC 020 §16: sólo se acepta cuando ya viene fijado (p. ej. desde
    // WorksPage al abrir "Nueva venta" desde un Proyecto); no existe ningún
    // selector de Proyecto genérico en Ventas. Igual que origenAdicionalId
    // por línea, el backend nunca confía en esto más allá del formato: la
    // pertenencia real se revalida en Functions (crearVenta/confirmarVenta).
    trabajoId: id(raw.trabajoId, "El proyecto", {optional: true}),
    descuento,
    afectaIva,
    fechaVenta: text(raw.fechaVenta, 10),
    fechaDocumento: text(raw.fechaDocumento, 10),
    tipoDocumento: DOCUMENT_SET.has(raw.tipoDocumento) ? raw.tipoDocumento : "sin_documento",
    numeroDocumento: text(raw.numeroDocumento, 120),
    condicionesPago: text(raw.condicionesPago, 2000),
    observaciones: text(raw.observaciones, 4000),
    items: raw.items.map((item, index) => {
      const values = calculateSaleLine(item, index, montoDecimales);
      return {
        lineaId: id(item.lineaId || `linea-${index + 1}`, "La línea"),
        itemId: id(item.itemId, `Ítem ${index + 1}`, {optional: Boolean(raw.cotizacionId) && item.tipoItem !== "producto"}),
        cantidad: values.cantidad,
        precioUnitario: values.precioUnitario,
        descuentoPct: values.descuentoPct,
        // SPEC 020 §5/§17: referencia histórica opcional hacia el adicional
        // de origen (Works). Sólo formato aquí; confirmarVenta es la única
        // autoridad que valida existencia/estado/pertenencia/ítem.
        origenAdicionalId: id(item.origenAdicionalId, `Ítem ${index + 1}: adicional de origen`, {optional: true}),
      };
    }),
  };
}

const clientSnapshot = (raw = {}) => ({
  clienteId: text(raw.clienteId || raw.id, 160),
  tipoCliente: text(raw.tipoCliente, 20),
  ...adaptStoredFiscalIdentifier(raw),
  nombreRazonSocial: text(raw.nombreRazonSocial || raw.nombre, 240),
  giro: text(raw.giro, 240),
  email: text(raw.email, 240),
  telefono: text(raw.telefono, 100),
  direccion: text(raw.direccion, 300),
  personaContacto: text(raw.personaContacto, 200),
  regionCodigo: text(raw.regionCodigo, 20),
  regionNombre: text(raw.regionNombre, 160),
  comunaCodigo: text(raw.comunaCodigo, 20),
  comunaNombre: text(raw.comunaNombre, 160),
});

function storedLine(raw = {}, index = 0, montoDecimales = 0) {
  const snapshot = raw.inventarioSnapshot || {};
  const tipo = text(raw.tipoItem || snapshot.tipoItem, 20);
  return {
    lineaId: text(raw.lineaId, 160) || `linea-${index + 1}`,
    itemId: text(raw.itemId || snapshot.inventarioId, 160),
    codigo: text(raw.codigo || snapshot.codigoInterno, 100),
    nombre: text(raw.nombre || snapshot.nombre, 240) || "Ítem histórico",
    descripcion: text(raw.descripcion || snapshot.descripcion, 3000),
    tipoItem: ITEM_TYPES.has(tipo) ? tipo : "producto",
    unidad: text(raw.unidad || snapshot.unidad, 80) || "unidad",
    cantidadCotizada: raw.cantidadCotizada == null ? null : Number(raw.cantidadCotizada),
    origenAdicionalId: text(raw.origenAdicionalId, 160),
    ...calculateSaleLine(raw, index, montoDecimales),
  };
}

export function adaptStoredSale(raw = {}) {
  const localization = adaptDocumentLocalization(raw);
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((line, index) => storedLine(line, index, localization.montoDecimales));
  const afectaIva = raw.afectaIva !== false;
  const totals = items.length
    ? calculateSaleTotals(items, raw.descuento ?? 0, {
        afectaIva,
        tasaIva: localization.tasaIva,
        montoDecimales: localization.montoDecimales,
      })
    : {
        subtotal: 0,
        descuentoItems: 0,
        descuento: Number(raw.descuento || 0),
        descuentoTotal: Number(raw.descuento || 0),
        neto: 0,
        afectaIva,
        tasaIva: afectaIva ? localization.tasaIva : 0,
        iva: 0,
        total: 0,
      };
  const estado = text(raw.estado, 20).toLowerCase();
  const cliente = clientSnapshot(raw.clienteSnapshot || {clienteId: raw.clienteId, nombreRazonSocial: raw.clienteNombre, rut: raw.clienteRut});
  return {
    ...raw,
    empresaSnapshot: adaptCompanySnapshot(raw.empresaSnapshot || raw.empresa || {}),
    ...localization,
    id: text(raw.id || raw.ventaId, 160),
    ventaId: text(raw.ventaId || raw.id, 160),
    numero: text(raw.numero, 120),
    estado: STATUS_SET.has(estado)
      ? estado
      : CONFIRMED_STATUS_ALIASES.has(estado)
        ? "confirmada"
        : "borrador",
    clienteId: text(raw.clienteId || cliente.clienteId, 160),
    clienteSnapshot: cliente,
    cotizacionId: text(raw.cotizacionId, 160),
    cotizacionNumero: text(raw.cotizacionNumero, 120),
    trabajoId: text(raw.trabajoId, 160),
    trabajoNumero: text(raw.trabajoNumero, 120),
    trabajoTitulo: text(raw.trabajoTitulo, 180),
    fechaVenta: text(raw.fechaVenta, 10),
    fechaDocumento: text(raw.fechaDocumento, 10),
    tipoDocumento: DOCUMENT_SET.has(raw.tipoDocumento) ? raw.tipoDocumento : "sin_documento",
    numeroDocumento: text(raw.numeroDocumento, 120),
    condicionesPago: text(raw.condicionesPago, 2000),
    observaciones: text(raw.observaciones, 4000),
    stockAplicado: raw.stockAplicado === true,
    items,
    ...totals,
  };
}

// Decide qué hacer con una lectura: suma 1 si el producto ya está en una línea
// propia de la venta, o agrega una línea nueva. Las líneas que vienen de
// adicionales (origenAdicionalId) nunca se tocan.
export function resolveSaleScan(items, itemId, createItem) {
  const source = Array.isArray(items) ? items : [];
  const own = source.filter((item) => !item?.origenAdicionalId);
  const result = incrementScannedItem(own, itemId, createItem);
  const byLine = new Map(result.map((item) => [item.lineaId, item]));
  const merged = source.map((item) => item?.origenAdicionalId ? item : byLine.get(item.lineaId) ?? item);
  if (result.length > own.length) {
    return {action: "added", items: [...merged, result[result.length - 1]]};
  }
  return {action: "incremented", items: merged};
}

// Agrega un ítem del inventario a la venta (selector "Agregar desde inventario" y "Escanear producto"). La regla de
// reagrupado y el tope por stock (solo Venta lo activa) viven en inventoryLineAdd.mjs, compartidos con Cotización y Compra.
// Devuelve {action: "added" | "incremented" | "stock_limit" | "invalid", items, available, limited}.
export function addInventoryItemToSale(items, inventoryItem, {quantity = 1, createLine} = {}) {
  return addInventoryItemToLines(items, inventoryItem, {
    itemId: inventoryItem?.id,
    quantity,
    createLine,
    priceKey: "precioUnitario",
    discountKey: "descuentoPct",
    stockLimit: true,
  });
}

export function canManageSales(role) {
  return ["OWNER", "ADMIN", "VENTAS"].includes(String(role || "").toUpperCase());
}

export function shouldReconcileSaleConfirmation(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  return ![
    "already-exists",
    "failed-precondition",
    "invalid-argument",
    "not-found",
    "permission-denied",
    "unauthenticated",
  ].includes(code);
}

export function matchesSaleSearch(sale, search) {
  const normalize = (value) => text(value, 600).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const query = normalize(search);
  if (!query) return true;
  return normalize(`${sale.numero} ${sale.clienteSnapshot?.nombreRazonSocial} ${sale.clienteSnapshot?.rut} ${sale.numeroDocumento} ${sale.cotizacionNumero}`).includes(query);
}
import {adaptDocumentLocalization} from "./localization.mjs";
import {adaptCompanySnapshot} from "./companySnapshot.mjs";
