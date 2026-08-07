export const REPORT_TABS = Object.freeze([
  "summary",
  "sales",
  "purchases",
  "inventory",
  "quotes",
  "finances",
]);

export const REPORT_PERIOD_OPTIONS = Object.freeze([
  {id: "week", label: "Esta semana"},
  {id: "month", label: "Este mes"},
  {id: "three_months", label: "Últimos 3 meses"},
  {id: "six_months", label: "Últimos 6 meses"},
  {id: "year", label: "Este año"},
  {id: "custom", label: "Periodo personalizado"},
]);

export const DOCUMENT_STATUSES = Object.freeze([
  "borrador",
  "confirmada",
  "cancelada",
]);

export const QUOTE_STATUSES = Object.freeze([
  "borrador",
  "emitida",
  "aceptada",
  "rechazada",
  "vencida",
  "archivada",
]);

export const INVENTORY_MOVEMENT_TYPES = Object.freeze([
  "entrada_compra",
  "salida_venta",
]);

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ZONE = "America/Santiago";

function text(value) {
  return String(value ?? "").trim();
}

function searchText(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .replace(/\s+/g, " ");
}

function safeAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function isDateInRange(date, range) {
  const value = text(date).slice(0, 10);
  if (!DATE_KEY_PATTERN.test(value)) return false;
  return value >= text(range?.start) && value <= text(range?.end);
}

function matchesSearch(values, search) {
  const needle = searchText(search);
  if (!needle) return true;
  return searchText(values.filter(Boolean).join(" ")).includes(needle);
}

export function filterSales(sales, {range, status = "todos", search = ""} = {}) {
  return (Array.isArray(sales) ? sales : []).filter(
    (sale) =>
      isDateInRange(sale.fechaVenta, range) &&
      (status === "todos" || sale.estado === status) &&
      matchesSearch(
        [
          sale.numero,
          sale.clienteSnapshot?.nombreRazonSocial,
          sale.clienteSnapshot?.rut,
          sale.numeroDocumento,
        ],
        search
      )
  );
}

export function getSalesMetrics(sales, range) {
  const confirmed = filterSales(sales, {range, status: "confirmada"});
  const total = confirmed.reduce((sum, sale) => sum + safeAmount(sale.total), 0);
  return {
    confirmed,
    count: confirmed.length,
    total,
    average: confirmed.length ? Math.round(total / confirmed.length) : 0,
    distinctCustomers: new Set(
      confirmed
        .map((sale) => text(sale.clienteId || sale.clienteSnapshot?.clienteId))
        .filter(Boolean)
    ).size,
  };
}

export function filterPurchases(
  purchases,
  {range, status = "todos", search = ""} = {}
) {
  return (Array.isArray(purchases) ? purchases : []).filter(
    (purchase) =>
      isDateInRange(purchase.fechaCompra, range) &&
      (status === "todos" || purchase.estado === status) &&
      matchesSearch(
        [
          purchase.numero,
          purchase.proveedorSnapshot?.razonSocial,
          purchase.proveedorSnapshot?.rut,
          purchase.numeroDocumentoProveedor,
        ],
        search
      )
  );
}

export function getPurchaseMetrics(purchases, range) {
  const confirmed = filterPurchases(purchases, {range, status: "confirmada"});
  const total = confirmed.reduce(
    (sum, purchase) => sum + safeAmount(purchase.total),
    0
  );
  return {
    confirmed,
    count: confirmed.length,
    total,
    average: confirmed.length ? Math.round(total / confirmed.length) : 0,
    distinctProviders: new Set(
      confirmed
        .map((purchase) =>
          text(purchase.proveedorId || purchase.proveedorSnapshot?.proveedorId)
        )
        .filter(Boolean)
    ).size,
  };
}

export function filterQuotes(
  quotes,
  {range, status = "todos", search = ""} = {}
) {
  return (Array.isArray(quotes) ? quotes : []).filter(
    (quote) =>
      isDateInRange(quote.fecha, range) &&
      (status === "todos" || quote.estado === status) &&
      matchesSearch([quote.numero, quote.clienteNombre, quote.clienteRut], search)
  );
}

export function getQuoteMetrics(quotes, range) {
  const periodQuotes = filterQuotes(quotes, {range});
  const counts = Object.fromEntries(QUOTE_STATUSES.map((status) => [status, 0]));
  const amounts = Object.fromEntries(QUOTE_STATUSES.map((status) => [status, 0]));

  periodQuotes.forEach((quote) => {
    const status = QUOTE_STATUSES.includes(quote.estado) ? quote.estado : "borrador";
    counts[status] += 1;
    amounts[status] += safeAmount(quote.total);
  });

  const decided = counts.aceptada + counts.rechazada;
  return {
    periodQuotes,
    count: periodQuotes.length,
    counts,
    amounts,
    conversion: decided ? (counts.aceptada / decided) * 100 : null,
  };
}

export function getInventoryMetrics(items) {
  const activeProducts = (Array.isArray(items) ? items : []).filter(
    (item) =>
      item.tipoItem === "producto" && (item.estado || "activo") === "activo"
  );
  const coveredProducts = activeProducts.filter((item) => {
    const cost = Number(item.costoBase);
    const stock = Number(item.stock);
    return Number.isFinite(cost) && cost > 0 && Number.isFinite(stock) && stock >= 0;
  });
  const lowStockProducts = activeProducts.filter((item) => {
    const stock = Number(item.stock);
    const minimum = Number(item.stockMinimo);
    return Number.isFinite(stock) && Number.isFinite(minimum) && stock <= minimum;
  });
  const coverage = activeProducts.length
    ? (coveredProducts.length / activeProducts.length) * 100
    : 0;
  const inventoryValue = coveredProducts.reduce(
    (sum, item) => sum + Number(item.costoBase) * Number(item.stock),
    0
  );

  return {
    activeProducts,
    lowStockProducts,
    coveredProducts,
    coverage,
    inventoryValue: coverage === 100 && activeProducts.length ? inventoryValue : null,
  };
}

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (Number.isFinite(Number(value.seconds))) {
    return new Date(Number(value.seconds) * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateToSantiagoKey(date) {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeInventoryMovement(raw = {}) {
  const timestamp = timestampToDate(raw.creadoEn || raw.createdAt);
  const type = INVENTORY_MOVEMENT_TYPES.includes(raw.tipo) ? raw.tipo : "";
  return {
    ...raw,
    id: text(raw.id || raw.movimientoId),
    type,
    date: dateToSantiagoKey(timestamp),
    timestampMillis: timestamp?.getTime?.() || 0,
    productName: text(raw.nombre) || "Producto histórico",
    quantity: safeAmount(raw.cantidad),
    unit: text(raw.unidad),
    documentNumber: text(raw.compraNumero || raw.ventaNumero),
    sourceId: text(raw.compraId || raw.ventaId),
  };
}

export function filterInventoryMovements(
  movements,
  {range, type = "todos"} = {}
) {
  return (Array.isArray(movements) ? movements : [])
    .filter(
      (movement) =>
        isDateInRange(movement.date, range) &&
        (type === "todos" || movement.type === type)
    )
    .sort((left, right) => right.timestampMillis - left.timestampMillis);
}

export function aggregateOperationalTimeline(
  documents,
  {range, dateField, amountField = "total"}
) {
  const byKey = new Map();
  const useMonths = Number(range?.days || 0) > 92;
  (Array.isArray(documents) ? documents : []).forEach((document) => {
    const date = text(document?.[dateField]).slice(0, 10);
    if (!isDateInRange(date, range)) return;
    const key = useMonths ? date.slice(0, 7) : date;
    const current = byKey.get(key) || {key, count: 0, value: 0};
    current.count += 1;
    current.value += safeAmount(document?.[amountField]);
    byKey.set(key, current);
  });
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function combineOperationalTimelines(salesTimeline, purchasesTimeline) {
  const combined = new Map();
  (Array.isArray(salesTimeline) ? salesTimeline : []).forEach((item) => {
    combined.set(item.key, {
      key: item.key,
      sales: safeAmount(item.value),
      purchases: 0,
    });
  });
  (Array.isArray(purchasesTimeline) ? purchasesTimeline : []).forEach((item) => {
    const current = combined.get(item.key) || {key: item.key, sales: 0, purchases: 0};
    current.purchases = safeAmount(item.value);
    combined.set(item.key, current);
  });
  return [...combined.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function getRecentOperationalActivity(sales, purchases, range, limit = 5) {
  const salesActivity = getSalesMetrics(sales, range).confirmed.map((sale) => ({
    id: text(sale.id || sale.ventaId),
    type: "sale",
    label: "Venta",
    number: text(sale.numero) || "Venta sin número",
    date: text(sale.fechaVenta).slice(0, 10),
    counterparty: text(sale.clienteSnapshot?.nombreRazonSocial) || "Cliente histórico",
    amount: safeAmount(sale.total),
    route: `/ventas/${text(sale.id || sale.ventaId)}`,
  }));
  const purchasesActivity = getPurchaseMetrics(purchases, range).confirmed.map(
    (purchase) => ({
      id: text(purchase.id || purchase.compraId),
      type: "purchase",
      label: "Compra",
      number: text(purchase.numero) || "Compra sin número",
      date: text(purchase.fechaCompra).slice(0, 10),
      counterparty:
        text(purchase.proveedorSnapshot?.razonSocial) || "Proveedor histórico",
      amount: safeAmount(purchase.total),
      route: `/compras/${text(purchase.id || purchase.compraId)}`,
    })
  );
  const maximum = Number.isSafeInteger(Number(limit)) && Number(limit) >= 0
    ? Number(limit)
    : 5;
  return [...salesActivity, ...purchasesActivity]
    .sort((left, right) => {
      const dateOrder = right.date.localeCompare(left.date);
      if (dateOrder !== 0) return dateOrder;
      return `${left.type}-${left.id}`.localeCompare(`${right.type}-${right.id}`);
    })
    .slice(0, maximum);
}

function csvCell(value) {
  const normalized = String(value ?? "").replace(/"/g, '""');
  return `"${normalized}"`;
}

function csv(rows) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

export function buildReportCsv(tab, data = {}) {
  if (tab === "summary") {
    return csv([
      ["Área", "Indicador", "Valor"],
      ["Ventas", "Total vendido confirmado", data.sales?.total || 0],
      ["Ventas", "Cantidad confirmada", data.sales?.count || 0],
      ["Compras", "Total comprado confirmado", data.purchases?.total || 0],
      ["Compras", "Cantidad confirmada", data.purchases?.count || 0],
      ["Cotizaciones", "Cantidad del periodo", data.quotes?.count || 0],
      ["Cotizaciones", "Aceptadas (estado actual)", data.quotes?.counts?.aceptada || 0],
      ["Inventario", "Productos activos", data.inventory?.activeProducts?.length || 0],
      ["Inventario", "Productos con stock bajo", data.inventory?.lowStockProducts?.length || 0],
      ["Finanzas", "Resultado de movimientos registrados", data.financial?.netResult || 0],
    ]);
  }

  if (tab === "sales") {
    return csv([
      ["Número", "Fecha", "Cliente", "RUT", "Estado", "Total"],
      ...(data.items || []).map((sale) => [
        sale.numero,
        sale.fechaVenta,
        sale.clienteSnapshot?.nombreRazonSocial,
        sale.clienteSnapshot?.rut,
        sale.estado,
        safeAmount(sale.total),
      ]),
    ]);
  }

  if (tab === "purchases") {
    return csv([
      ["Número", "Fecha", "Proveedor", "RUT", "Estado", "Total"],
      ...(data.items || []).map((purchase) => [
        purchase.numero,
        purchase.fechaCompra,
        purchase.proveedorSnapshot?.razonSocial,
        purchase.proveedorSnapshot?.rut,
        purchase.estado,
        safeAmount(purchase.total),
      ]),
    ]);
  }

  if (tab === "inventory") {
    return csv([
      ["Fecha", "Tipo", "Producto", "Cantidad", "Unidad", "Documento/origen"],
      ...(data.items || []).map((movement) => [
        movement.date,
        movement.type,
        movement.productName,
        movement.quantity,
        movement.unit,
        movement.documentNumber,
      ]),
    ]);
  }

  if (tab === "quotes") {
    return csv([
      ["Número", "Fecha", "Cliente", "RUT", "Estado actual", "Total"],
      ...(data.items || []).map((quote) => [
        quote.numero,
        quote.fecha,
        quote.clienteNombre,
        quote.clienteRut,
        quote.estado,
        safeAmount(quote.total),
      ]),
    ]);
  }

  return csv([["Sin datos exportables"]]);
}
