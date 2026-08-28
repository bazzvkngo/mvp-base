export const REPORT_TABS = Object.freeze([
  "overview",
  "commercial",
  "operations",
  "supply",
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

const VALID_SALE_STATES = new Set(["confirmada", "confirmado", "activa", "activo"]);
const VALID_PURCHASE_STATES = new Set(["confirmada", "confirmado", "activa", "activo"]);

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
  "entrada_recepcion",
  "salida_venta",
  "SALIDA_PROYECTO",
  "DEVOLUCION_PROYECTO",
  "AJUSTE_STOCK",
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

export function normalizeReportCurrency(value, fallback = "CLP") {
  const normalized = text(value).toUpperCase();
  if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  const compatibleFallback = text(fallback).toUpperCase();
  return /^[A-Z]{3}$/.test(compatibleFallback) ? compatibleFallback : "CLP";
}

export function resolveReportCurrency(record = {}, fallback = "CLP") {
  return normalizeReportCurrency(
    record.moneda ||
      record.monedaCodigo ||
      record.currency ||
      record.empresaSnapshot?.monedaCodigo ||
      record.empresa?.monedaCodigo,
    fallback
  );
}

export function groupAmountsByCurrency(
  records,
  {amountField = "total", fallbackCurrency = "CLP"} = {}
) {
  const buckets = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const currency = resolveReportCurrency(record, fallbackCurrency);
    const current = buckets.get(currency) || {currency, count: 0, total: 0};
    current.count += 1;
    current.total += safeAmount(record?.[amountField]);
    buckets.set(currency, current);
  });
  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      average: bucket.count ? bucket.total / bucket.count : 0,
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

function singleCurrencyValue(groups, field = "total") {
  return groups.length === 1 ? safeAmount(groups[0]?.[field]) : null;
}

function currencyMatches(record, currency, fallbackCurrency) {
  return !currency || currency === "todos" ||
    resolveReportCurrency(record, fallbackCurrency) === currency;
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

export function filterSales(
  sales,
  {range, status = "todos", search = "", currency = "todos", fallbackCurrency = "CLP"} = {}
) {
  return (Array.isArray(sales) ? sales : []).filter(
    (sale) =>
      isDateInRange(sale.fechaVenta, range) &&
      (status === "todos" || sale.estado === status) &&
      currencyMatches(sale, currency, fallbackCurrency) &&
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

export function getSalesMetrics(sales, range, options = {}) {
  const confirmed = filterSales(sales, {range, ...options, status: "todos"})
    .filter((sale) => VALID_SALE_STATES.has(text(sale.estado).toLowerCase()));
  const totalsByCurrency = groupAmountsByCurrency(confirmed, options);
  const total = singleCurrencyValue(totalsByCurrency);
  return {
    confirmed,
    count: confirmed.length,
    total,
    average: singleCurrencyValue(totalsByCurrency, "average"),
    totalsByCurrency,
    distinctCustomers: new Set(
      confirmed
        .map((sale) => text(sale.clienteId || sale.clienteSnapshot?.clienteId))
        .filter(Boolean)
    ).size,
  };
}

export function filterPurchases(
  purchases,
  {range, status = "todos", search = "", currency = "todos", fallbackCurrency = "CLP"} = {}
) {
  return (Array.isArray(purchases) ? purchases : []).filter(
    (purchase) =>
      isDateInRange(purchase.fechaCompra, range) &&
      (status === "todos" || purchase.estado === status) &&
      currencyMatches(purchase, currency, fallbackCurrency) &&
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

export function getPurchaseMetrics(purchases, range, options = {}) {
  const confirmed = filterPurchases(purchases, {range, ...options, status: "todos"})
    .filter((purchase) => VALID_PURCHASE_STATES.has(text(purchase.estado).toLowerCase()));
  const totalsByCurrency = groupAmountsByCurrency(confirmed, options);
  const total = singleCurrencyValue(totalsByCurrency);
  return {
    confirmed,
    count: confirmed.length,
    total,
    average: singleCurrencyValue(totalsByCurrency, "average"),
    totalsByCurrency,
    distinctProviders: new Set(
      confirmed
        .map((purchase) =>
          text(purchase.proveedorId || purchase.proveedorSnapshot?.proveedorId)
        )
        .filter(Boolean)
    ).size,
  };
}

export function getProjectResultMetrics(
  projectBalances,
  {currency = "todos", fallbackCurrency = "CLP", accessible = true} = {}
) {
  if (!accessible) return {accessible: false, count: 0, total: null, totalsByCurrency: []};
  const complete = (Array.isArray(projectBalances) ? projectBalances : []).filter((entry) => {
    const balance = entry?.balance || {};
    const result = Number(balance.resultado);
    const balanceCurrency = normalizeReportCurrency(balance.moneda, fallbackCurrency);
    return balance.estado === "COMPLETO" && Number.isFinite(result) &&
      (currency === "todos" || currency === balanceCurrency);
  });
  const totalsByCurrency = groupAmountsByCurrency(
    complete.map((entry) => ({
      moneda: entry.balance.moneda,
      total: entry.balance.resultado,
    })),
    {fallbackCurrency}
  );
  return {
    accessible: true,
    complete,
    count: complete.length,
    total: singleCurrencyValue(totalsByCurrency),
    totalsByCurrency,
  };
}

export function getProjectProfitabilitySummary(
  projectBalances,
  {currency = "todos", fallbackCurrency = "CLP", accessible = true} = {}
) {
  if (!accessible) return {accessible: false, complete: [], groups: []};
  const metrics = getProjectResultMetrics(projectBalances, {
    currency,
    fallbackCurrency,
    accessible,
  });
  const buckets = new Map();
  metrics.complete.forEach((entry) => {
    const balance = entry.balance || {};
    const selected = normalizeReportCurrency(balance.moneda, fallbackCurrency);
    const current = buckets.get(selected) || {
      currency: selected,
      count: 0,
      revenue: 0,
      materials: 0,
      labor: 0,
      directExpenses: 0,
      indirectExpenses: 0,
      costs: 0,
      result: 0,
      projects: [],
    };
    current.count += 1;
    current.revenue += safeAmount(balance.valorComercial);
    current.materials += safeAmount(balance.materiales);
    current.labor += safeAmount(balance.horasHombre);
    current.directExpenses += safeAmount(balance.gastosDirectos);
    current.indirectExpenses += safeAmount(balance.gastosIndirectos);
    current.costs += safeAmount(balance.costoTotal);
    current.result += safeAmount(balance.resultado);
    current.projects.push(entry);
    buckets.set(selected, current);
  });
  const round = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  const groups = [...buckets.values()].map((group) => ({
    ...group,
    revenue: round(group.revenue),
    materials: round(group.materials),
    labor: round(group.labor),
    directExpenses: round(group.directExpenses),
    indirectExpenses: round(group.indirectExpenses),
    costs: round(group.costs),
    result: round(group.result),
    margin: group.revenue > 0 ? round((group.result / group.revenue) * 100) : null,
  })).sort((left, right) => left.currency.localeCompare(right.currency));
  return {accessible: true, complete: metrics.complete, groups};
}

export function getSimplifiedReportSummary({
  sales = [],
  purchases = [],
  projectBalances = [],
  range,
  currency = "todos",
  fallbackCurrency = "CLP",
  canViewProfitability = true,
} = {}) {
  const options = {currency, fallbackCurrency};
  const salesMetrics = getSalesMetrics(sales, range, options);
  const purchaseMetrics = getPurchaseMetrics(purchases, range, options);
  const projectMetrics = getProjectResultMetrics(projectBalances, {
    ...options,
    accessible: canViewProfitability,
  });
  const discoveredCurrencies = [...new Set([
    ...salesMetrics.totalsByCurrency.map((group) => group.currency),
    ...purchaseMetrics.totalsByCurrency.map((group) => group.currency),
    ...projectMetrics.totalsByCurrency.map((group) => group.currency),
  ])];
  const currencies = currency === "todos"
    ? (discoveredCurrencies.length ? discoveredCurrencies : [fallbackCurrency]).sort()
    : [currency];
  const groupFor = (groups, selected) =>
    groups.find((group) => group.currency === selected) ||
    {currency: selected, count: 0, total: 0, average: 0};
  return {
    sales: salesMetrics,
    purchases: purchaseMetrics,
    projects: projectMetrics,
    currencies: currencies.map((selected) => ({
      currency: selected,
      sales: groupFor(salesMetrics.totalsByCurrency, selected),
      purchases: groupFor(purchaseMetrics.totalsByCurrency, selected),
      projects: projectMetrics.accessible
        ? groupFor(projectMetrics.totalsByCurrency, selected)
        : {currency: selected, count: 0, total: null},
    })),
  };
}

export function filterQuotes(
  quotes,
  {range, status = "todos", search = "", currency = "todos", fallbackCurrency = "CLP"} = {}
) {
  return (Array.isArray(quotes) ? quotes : []).filter(
    (quote) =>
      isDateInRange(quote.fecha, range) &&
      (status === "todos" || quote.estado === status) &&
      currencyMatches(quote, currency, fallbackCurrency) &&
      matchesSearch([quote.numero, quote.clienteNombre, quote.clienteRut], search)
  );
}

export function getQuoteMetrics(quotes, range, options = {}) {
  const periodQuotes = filterQuotes(quotes, {range, ...options});
  const counts = Object.fromEntries(QUOTE_STATUSES.map((status) => [status, 0]));
  const recordsByStatus = Object.fromEntries(QUOTE_STATUSES.map((status) => [status, []]));

  periodQuotes.forEach((quote) => {
    const status = QUOTE_STATUSES.includes(quote.estado) ? quote.estado : "borrador";
    counts[status] += 1;
    recordsByStatus[status].push(quote);
  });

  const amountsByCurrency = Object.fromEntries(
    QUOTE_STATUSES.map((status) => [
      status,
      groupAmountsByCurrency(recordsByStatus[status], options),
    ])
  );
  const amounts = Object.fromEntries(
    QUOTE_STATUSES.map((status) => [status, singleCurrencyValue(amountsByCurrency[status])])
  );

  const decided = counts.aceptada + counts.rechazada;
  return {
    periodQuotes,
    count: periodQuotes.length,
    counts,
    amounts,
    amountsByCurrency,
    conversion: decided ? (counts.aceptada / decided) * 100 : null,
  };
}

export function getInventoryMetrics(items, {fallbackCurrency = "CLP"} = {}) {
  const activeProducts = (Array.isArray(items) ? items : []).filter(
    (item) =>
      item.tipoItem === "producto" && (item.estado || "activo") === "activo"
  );
  const coveredProducts = activeProducts.filter((item) => {
    const cost = Number(item.costoPromedio ?? item.costoBase);
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
  const inventoryValuesByCurrency = groupAmountsByCurrency(
    coveredProducts.map((item) => ({
      moneda: item.costoPromedioMoneda || item.moneda,
      total: Number(item.costoPromedio ?? item.costoBase) * Number(item.stock),
    })),
    {fallbackCurrency}
  );

  return {
    activeProducts,
    lowStockProducts,
    coveredProducts,
    coverage,
    inventoryValuesByCurrency,
    inventoryValue: coverage === 100 && activeProducts.length
      ? singleCurrencyValue(inventoryValuesByCurrency)
      : null,
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

function movementDirection(type, raw = {}) {
  if (["entrada_compra", "entrada_recepcion", "DEVOLUCION_PROYECTO"].includes(type)) return "ENTRADA";
  if (["salida_venta", "SALIDA_PROYECTO"].includes(type)) return "SALIDA";
  if (type === "AJUSTE_STOCK") return raw.direccion === "SALIDA" ? "SALIDA" : "ENTRADA";
  return "";
}

function movementOrigin(type, raw = {}) {
  if (type === "entrada_recepcion") return {sourceType: "recepcion", sourceId: raw.recepcionId, documentNumber: raw.recepcionNumero};
  if (type === "entrada_compra") return {sourceType: "compra", sourceId: raw.compraId, documentNumber: raw.compraNumero};
  if (type === "salida_venta") return {sourceType: "venta", sourceId: raw.ventaId, documentNumber: raw.ventaNumero};
  if (["SALIDA_PROYECTO", "DEVOLUCION_PROYECTO"].includes(type)) return {sourceType: "proyecto", sourceId: raw.trabajoId, documentNumber: raw.trabajoNumero};
  if (type === "AJUSTE_STOCK") return {sourceType: "ajuste", sourceId: raw.itemId, documentNumber: "Ajuste manual"};
  return {sourceType: text(raw.tipoOrigen), sourceId: "", documentNumber: ""};
}

export function normalizeInventoryMovement(
  raw = {},
  {acquisition = null, fallbackCurrency = "CLP", purchase = null, work = null} = {}
) {
  const timestamp = timestampToDate(raw.creadoEn || raw.createdAt);
  const type = INVENTORY_MOVEMENT_TYPES.includes(raw.tipo) ? raw.tipo : "";
  const origin = movementOrigin(type, raw);
  const productSnapshot = raw.productoSnapshot || acquisition?.productoSnapshot || {};
  const providerSnapshot = acquisition?.proveedorSnapshot || purchase?.proveedorSnapshot || raw.proveedorSnapshot || null;
  return {
    ...raw,
    id: text(raw.id || raw.movimientoId),
    type,
    direction: movementDirection(type, raw),
    date: text(raw.fecha) || dateToSantiagoKey(timestamp),
    timestampMillis: timestamp?.getTime?.() || 0,
    productName: text(raw.nombre || productSnapshot.nombre) || "Producto histórico",
    quantity: safeAmount(raw.cantidad),
    unit: text(raw.unidad || productSnapshot.unidad),
    documentNumber: text(origin.documentNumber || raw.ordenCompraNumero),
    sourceType: origin.sourceType,
    sourceId: text(origin.sourceId),
    providerId: text(acquisition?.proveedorId || purchase?.proveedorId || providerSnapshot?.proveedorId),
    providerName: text(providerSnapshot?.razonSocial),
    projectId: text(raw.trabajoId),
    projectNumber: text(work?.numero || raw.trabajoNumero),
    projectTitle: text(work?.titulo || raw.trabajoTitulo),
    userId: text(raw.usuarioUid || raw.creadoPorUid || raw.registradoPorUid),
    userName: text(raw.usuarioSnapshot?.nombre || raw.registradoPorSnapshot?.nombre),
    unitCost: safeAmount(raw.costoUnitario ?? raw.costoUnitarioAplicado),
    totalCost: safeAmount(raw.costoTotal),
    currency: resolveReportCurrency(raw, acquisition?.moneda || fallbackCurrency),
  };
}

export function filterInventoryMovements(
  movements,
  {
    range,
    type = "todos",
    sourceType = "todos",
    currency = "todos",
    providerId = "todos",
    projectId = "todos",
    userId = "todos",
    fallbackCurrency = "CLP",
  } = {}
) {
  return (Array.isArray(movements) ? movements : [])
    .filter(
      (movement) =>
        isDateInRange(movement.date, range) &&
        (type === "todos" || movement.direction === type || movement.type === type) &&
        (sourceType === "todos" || movement.sourceType === sourceType) &&
        currencyMatches(movement, currency, fallbackCurrency) &&
        (providerId === "todos" || movement.providerId === providerId) &&
        (projectId === "todos" || movement.projectId === projectId) &&
        (userId === "todos" || movement.userId === userId)
    )
    .sort((left, right) => right.timestampMillis - left.timestampMillis);
}

export function normalizeInventoryAcquisition(raw = {}, {fallbackCurrency = "CLP"} = {}) {
  const timestamp = timestampToDate(raw.creadoEn);
  return {
    ...raw,
    id: text(raw.id || raw.adquisicionId),
    date: text(raw.fechaAdquisicion) || dateToSantiagoKey(timestamp),
    timestampMillis: timestamp?.getTime?.() || 0,
    productName: text(raw.productoSnapshot?.nombre) || "Producto histórico",
    unit: text(raw.productoSnapshot?.unidad),
    quantity: safeAmount(raw.cantidad),
    unitCost: safeAmount(raw.costoPagadoUnitario ?? raw.costoUnitario),
    totalCost: safeAmount(raw.costoPagadoTotal ?? raw.costoPagado),
    taxAmount: safeAmount(raw.impuestoCompraTotal ?? raw.impuestoCompra),
    currency: resolveReportCurrency(raw, fallbackCurrency),
    providerId: text(raw.proveedorId || raw.proveedorSnapshot?.proveedorId),
    providerName: text(raw.proveedorSnapshot?.razonSocial),
    userId: text(raw.registradoPorUid || raw.creadoPorUid),
    documentNumber: text(raw.recepcionNumero || raw.ordenCompraNumero || raw.compraNumero),
  };
}

export function filterInventoryAcquisitions(
  acquisitions,
  {range, currency = "todos", providerId = "todos", userId = "todos", fallbackCurrency = "CLP"} = {}
) {
  return (Array.isArray(acquisitions) ? acquisitions : [])
    .filter((entry) =>
      isDateInRange(entry.date, range) &&
      currencyMatches(entry, currency, fallbackCurrency) &&
      (providerId === "todos" || entry.providerId === providerId) &&
      (userId === "todos" || entry.userId === userId)
    )
    .sort((left, right) => right.timestampMillis - left.timestampMillis || right.date.localeCompare(left.date));
}

export function normalizeWorkCost(raw = {}, {fallbackCurrency = "CLP", kind, work} = {}) {
  const isLabor = kind === "HH";
  return {
    ...raw,
    id: text(raw.id || raw.gastoId || raw.horasHombreId),
    kind: isLabor ? "HH" : "GASTO",
    date: text(raw.fecha),
    projectId: text(raw.trabajoId || work?.trabajoId || work?.id),
    projectNumber: text(work?.numero),
    projectTitle: text(work?.titulo),
    concept: text(raw.concepto),
    category: isLabor ? "MANO_DE_OBRA" : text(raw.categoria || "OTRO").toUpperCase(),
    status: raw.estado === "anulado" ? "anulado" : "vigente",
    hours: isLabor ? safeAmount(raw.horas) : null,
    amount: safeAmount(isLabor ? raw.total : raw.monto),
    currency: resolveReportCurrency(raw, work?.moneda || fallbackCurrency),
    userId: text(raw.registradoPorUid || raw.tecnicoUid || raw.responsableDelGastoUid),
    userName: text(raw.registradoPorSnapshot?.nombre || raw.tecnicoSnapshot?.nombre || raw.responsableDelGastoSnapshot?.nombre),
  };
}

export function filterWorkCosts(
  costs,
  {range, kind = "todos", currency = "todos", projectId = "todos", userId = "todos", fallbackCurrency = "CLP"} = {}
) {
  return (Array.isArray(costs) ? costs : [])
    .filter((entry) =>
      isDateInRange(entry.date, range) &&
      entry.status === "vigente" &&
      (kind === "todos" || entry.kind === kind) &&
      currencyMatches(entry, currency, fallbackCurrency) &&
      (projectId === "todos" || entry.projectId === projectId) &&
      (userId === "todos" || entry.userId === userId)
    )
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function aggregateOperationalTimeline(
  documents,
  {range, dateField, amountField = "total", fallbackCurrency = "CLP"}
) {
  const byKey = new Map();
  const useMonths = Number(range?.days || 0) > 92;
  (Array.isArray(documents) ? documents : []).forEach((document) => {
    const date = text(document?.[dateField]).slice(0, 10);
    if (!isDateInRange(date, range)) return;
    const key = useMonths ? date.slice(0, 7) : date;
    const currency = resolveReportCurrency(document, fallbackCurrency);
    const bucketKey = `${currency}__${key}`;
    const current = byKey.get(bucketKey) || {key, currency, count: 0, value: 0};
    current.count += 1;
    current.value += safeAmount(document?.[amountField]);
    byKey.set(bucketKey, current);
  });
  return [...byKey.values()].sort((left, right) =>
    left.currency.localeCompare(right.currency) || left.key.localeCompare(right.key)
  );
}

export function combineOperationalTimelines(salesTimeline, purchasesTimeline) {
  const combined = new Map();
  (Array.isArray(salesTimeline) ? salesTimeline : []).forEach((item) => {
    const currency = normalizeReportCurrency(item.currency);
    const bucketKey = `${currency}__${item.key}`;
    combined.set(bucketKey, {
      key: item.key,
      currency,
      sales: safeAmount(item.value),
      purchases: 0,
    });
  });
  (Array.isArray(purchasesTimeline) ? purchasesTimeline : []).forEach((item) => {
    const currency = normalizeReportCurrency(item.currency);
    const bucketKey = `${currency}__${item.key}`;
    const current = combined.get(bucketKey) || {key: item.key, currency, sales: 0, purchases: 0};
    current.purchases = safeAmount(item.value);
    combined.set(bucketKey, current);
  });
  return [...combined.values()].sort((left, right) =>
    left.currency.localeCompare(right.currency) || left.key.localeCompare(right.key)
  );
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
    currency: resolveReportCurrency(sale),
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
      currency: resolveReportCurrency(purchase),
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
  if (tab === "overview") {
    return buildReportCsv("summary", data);
  }

  if (tab === "commercial") {
    return csv([
      ["Tipo", "Número", "Fecha", "Cliente", "Estado", "Moneda", "Monto"],
      ...(data.sales || []).map((sale) => [
        "Venta",
        sale.numero,
        sale.fechaVenta,
        sale.clienteSnapshot?.nombreRazonSocial,
        sale.estado,
        resolveReportCurrency(sale, data.fallbackCurrency),
        safeAmount(sale.total),
      ]),
      ...(data.quotes || []).map((quote) => [
        "Cotización",
        quote.numero,
        quote.fecha,
        quote.clienteNombre,
        quote.estado,
        resolveReportCurrency(quote, data.fallbackCurrency),
        safeAmount(quote.total),
      ]),
    ]);
  }

  if (tab === "operations") {
    return csv([
      ["Tipo", "Fecha", "Registro", "Detalle", "Estado o movimiento", "Moneda", "Valor"],
      ...(data.movements || []).map((movement) => [
        "Inventario",
        movement.date,
        movement.documentNumber || movement.projectNumber,
        movement.productName,
        movement.type,
        movement.currency,
        movement.totalCost,
      ]),
      ...(data.costs || []).map((entry) => [
        entry.kind === "HH" ? "Horas hombre" : "Gasto de trabajo",
        entry.date,
        entry.projectNumber || entry.projectTitle || entry.projectId,
        entry.concept,
        entry.category,
        entry.currency,
        entry.amount,
      ]),
      ...(data.balances || []).map((entry) => [
        "Balance de trabajo",
        "",
        entry.numero || entry.titulo,
        "Resultado del trabajo",
        entry.balance?.estado,
        entry.balance?.moneda,
        entry.balance?.resultado,
      ]),
    ]);
  }

  if (tab === "supply") {
    return csv([
      ["Tipo", "Número", "Fecha", "Proveedor", "Estado", "Moneda", "Monto"],
      ...(data.purchases || []).map((purchase) => [
        "Compra",
        purchase.numero,
        purchase.fechaCompra,
        purchase.proveedorSnapshot?.razonSocial,
        purchase.estado,
        resolveReportCurrency(purchase, data.fallbackCurrency),
        safeAmount(purchase.total),
      ]),
      ...(data.purchaseOrders || []).map((order) => [
        "Orden de compra",
        order.numero,
        order.fechaEmision,
        order.proveedorSnapshot?.razonSocial,
        order.estado,
        resolveReportCurrency(order, data.fallbackCurrency),
        safeAmount(order.total),
      ]),
      ...(data.receptions || []).map((reception) => [
        "Recepción",
        reception.numero,
        reception.fechaRecepcion,
        reception.proveedorSnapshot?.razonSocial,
        reception.estado,
        "",
        "",
      ]),
      ...(data.acquisitions || []).map((entry) => [
        "Adquisición",
        entry.documentNumber,
        entry.date,
        entry.providerName,
        "registrada",
        entry.currency,
        entry.totalCost,
      ]),
    ]);
  }

  if (tab === "summary") {
    const monetaryRows = (area, indicator, groups, field = "total") =>
      (groups || []).map((group) => [area, indicator, group.currency, group[field]]);
    return csv([
      ["Área", "Indicador", "Moneda", "Valor"],
      ...monetaryRows("Ventas", "Total vendido confirmado", data.sales?.totalsByCurrency),
      ["Ventas", "Cantidad confirmada", "", data.sales?.count || 0],
      ...monetaryRows("Compras", "Total comprado confirmado", data.purchases?.totalsByCurrency),
      ["Compras", "Cantidad confirmada", "", data.purchases?.count || 0],
      ["Cotizaciones", "Cantidad del periodo", "", data.quotes?.count || 0],
      ["Cotizaciones", "Aceptadas (estado actual)", "", data.quotes?.counts?.aceptada || 0],
      ["Inventario", "Productos activos", "", data.inventory?.activeProducts?.length || 0],
      ["Inventario", "Productos con stock bajo", "", data.inventory?.lowStockProducts?.length || 0],
      ...(data.financial || []).map((group) => ["Finanzas", "Resultado registrado", group.currency, group.summary?.netResult || 0]),
    ]);
  }

  if (tab === "sales") {
    return csv([
      ["Número", "Fecha", "Cliente", "Identificación fiscal", "Estado", "Moneda", "Total"],
      ...(data.items || []).map((sale) => [
        sale.numero,
        sale.fechaVenta,
        sale.clienteSnapshot?.nombreRazonSocial,
        sale.clienteSnapshot?.identificadorFiscalValor || sale.clienteSnapshot?.rut,
        sale.estado,
        resolveReportCurrency(sale, data.fallbackCurrency),
        safeAmount(sale.total),
      ]),
    ]);
  }

  if (tab === "purchases") {
    return csv([
      ["Número", "Fecha", "Proveedor", "Identificación fiscal", "Estado", "Moneda", "Total"],
      ...(data.items || []).map((purchase) => [
        purchase.numero,
        purchase.fechaCompra,
        purchase.proveedorSnapshot?.razonSocial,
        purchase.proveedorSnapshot?.identificadorFiscalValor || purchase.proveedorSnapshot?.rut,
        purchase.estado,
        resolveReportCurrency(purchase, data.fallbackCurrency),
        safeAmount(purchase.total),
      ]),
    ]);
  }

  if (tab === "inventory") {
    return csv([
      ["Registro", "Fecha", "Tipo", "Producto", "Cantidad", "Unidad", "Documento/origen", "Proveedor", "Proyecto", "Usuario", "Moneda", "Costo"],
      ...(data.items || []).map((movement) => [
        "MOVIMIENTO",
        movement.date,
        movement.type,
        movement.productName,
        movement.quantity,
        movement.unit,
        movement.documentNumber,
        movement.providerName,
        movement.projectNumber || movement.projectTitle,
        movement.userName || movement.userId,
        movement.currency,
        movement.totalCost,
      ]),
      ...(data.acquisitions || []).map((entry) => [
        "ADQUISICIÓN",
        entry.date,
        "entrada_recepcion",
        entry.productName,
        entry.quantity,
        entry.unit,
        [entry.ordenCompraNumero, entry.recepcionNumero, entry.compraNumero].filter(Boolean).join(" / "),
        entry.providerName,
        "",
        entry.userId,
        entry.currency,
        entry.totalCost,
      ]),
    ]);
  }

  if (tab === "projects") {
    return csv([
      ["Registro", "Fecha", "Proyecto", "Concepto", "Categoría/estado", "Usuario", "Moneda", "Monto", "Resultado", "Rentabilidad %"],
      ...(data.items || []).map((entry) => ["COSTO", entry.date, entry.projectNumber || entry.projectTitle || entry.projectId, entry.concept, entry.category, entry.userName || entry.userId, entry.currency, entry.amount, "", ""]),
      ...(data.balances || []).map((entry) => ["BALANCE", "", entry.numero || entry.titulo, "Balance autoritativo", entry.balance?.estado, "", entry.balance?.moneda, entry.balance?.costoTotal, entry.balance?.resultado, entry.balance?.rentabilidadPct]),
    ]);
  }

  if (tab === "quotes") {
    return csv([
      ["Número", "Fecha", "Cliente", "Identificación fiscal", "Estado actual", "Moneda", "Total"],
      ...(data.items || []).map((quote) => [
        quote.numero,
        quote.fecha,
        quote.clienteNombre,
        quote.cliente?.identificadorFiscalValor || quote.clienteRut,
        quote.estado,
        resolveReportCurrency(quote, data.fallbackCurrency),
        safeAmount(quote.total),
      ]),
    ]);
  }


  if (tab === "finances") {
    return csv([
      ["Fecha", "Concepto", "Tipo", "Estado", "Contraparte", "Origen", "Moneda", "Monto"],
      ...(data.items || []).map((entry) => [entry.date, entry.concept, entry.type, entry.status, entry.counterpartyName, entry.sourceType, resolveReportCurrency(entry, data.fallbackCurrency), safeAmount(entry.amount)]),
    ]);
  }

  return csv([["Sin datos exportables"]]);
}
