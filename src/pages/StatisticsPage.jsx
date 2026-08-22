import React, {useEffect, useMemo, useState} from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Download,
  Landmark,
  ReceiptText,
  ShoppingCart,
  Truck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import {useNavigate, useSearchParams} from "react-router-dom";
import DashboardDonutChart from "../components/DashboardDonutChart";
import {
  FinancialCategoryChart,
  FinancialStatusChart,
  FinancialTimelineChart,
} from "../components/finance/FinancialCharts";
import FinancialPeriodSelector from "../components/finance/FinancialPeriodSelector";
import Button from "../components/ui/Button";
import {
  aggregateFinancialByCategory,
  aggregateFinancialTimeline,
  getFinancialPeriodRange,
  getSantiagoDateKey,
  summarizeFinancialMovements,
} from "../domain/financialMovement.mjs";
import {
  REPORT_TABS,
  REPORT_PERIOD_OPTIONS,
  aggregateOperationalTimeline,
  buildReportCsv,
  filterInventoryAcquisitions,
  filterInventoryMovements,
  filterPurchases,
  filterQuotes,
  filterSales,
  filterWorkCosts,
  getInventoryMetrics,
  getPurchaseMetrics,
  getQuoteMetrics,
  getSalesMetrics,
  resolveReportCurrency,
} from "../domain/reportModel.mjs";
import {getQuoteStatusLabel} from "../domain/quoteModel.mjs";
import {getSaleStatusLabel} from "../domain/saleModel.mjs";
import useFinancialMovements from "../hooks/useFinancialMovements";
import {loadReportData} from "../services/reportService";
import {formatDate, formatMoney, formatPercent} from "../utils/formatters";

const VALID_PERIODS = new Set(REPORT_PERIOD_OPTIONS.map((option) => option.id));
const TABS = [
  ["summary", "Resumen"],
  ["sales", "Ventas"],
  ["purchases", "Compras"],
  ["inventory", "Inventario"],
  ["projects", "Proyectos"],
  ["quotes", "Cotizaciones"],
  ["finances", "Finanzas"],
];
const DOCUMENT_STATUS_OPTIONS = [
  ["todos", "Todos los estados"],
  ["borrador", "Borrador"],
  ["confirmada", "Confirmada"],
  ["cancelada", "Cancelada"],
];
const SALE_STATUS_OPTIONS = [
  ["todos", "Todos los estados"],
  ["borrador", "Preparada"],
  ["confirmada", "Confirmada"],
  ["cancelada", "Cancelada"],
];
const QUOTE_STATUS_OPTIONS = [
  ["todos", "Todos los estados"],
  ["borrador", "Pendiente"],
  ["emitida", "Emitida"],
  ["aceptada", "Aceptada"],
  ["rechazada", "Rechazada"],
  ["vencida", "Vencida"],
  ["archivada", "Archivada"],
];
const QUOTE_CHART = [
  ["borrador", "Pendiente", "#94a3b8"],
  ["emitida", "Emitida", "#38bdf8"],
  ["aceptada", "Aceptada", "#0f766e"],
  ["rechazada", "Rechazada", "#dc2626"],
  ["vencida", "Vencida", "#d97706"],
  ["archivada", "Archivada", "#64748b"],
];
const STATUS_LABELS = {
  borrador: "Borrador",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  archivada: "Archivada",
};

const EMPTY_REPORT_DATA = {
  sales: [],
  purchases: [],
  quotes: [],
  inventory: [],
  inventoryMovements: [],
  inventoryAcquisitions: [],
  works: [],
  workCosts: [],
  projectBalances: [],
};

const MOVEMENT_LABELS = {
  entrada_compra: "Entrada por compra legacy",
  entrada_recepcion: "Entrada por recepción",
  salida_venta: "Salida por venta",
  SALIDA_PROYECTO: "Salida a proyecto",
  DEVOLUCION_PROYECTO: "Devolución de proyecto",
  AJUSTE_STOCK: "Ajuste de stock",
};

function formatCurrencyGroups(groups, field = "total") {
  const values = (Array.isArray(groups) ? groups : []).map((group) =>
    formatMoney(group[field], group.currency)
  );
  return values.length ? values.join(" · ") : "Sin monto";
}

function formatFinancialGroups(groups, field) {
  const values = (Array.isArray(groups) ? groups : []).map((group) =>
    formatMoney(group.summary?.[field], group.currency)
  );
  return values.length ? values.join(" · ") : "Sin movimientos";
}

function uniqueOptions(items, idField, labelField) {
  const values = new Map();
  items.forEach((item) => {
    const id = String(item?.[idField] || "").trim();
    const label = String(item?.[labelField] || "").trim();
    if (id && !values.has(id)) values.set(id, label || id);
  });
  return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], "es"));
}

function sourceRoute(item) {
  if (item.sourceType === "venta") return `/ventas/${item.sourceId}`;
  if (item.sourceType === "compra") return `/compras/${item.sourceId}`;
  if (item.sourceType === "recepcion") return `/recepciones/${item.sourceId}`;
  if (item.sourceType === "proyecto") return "/trabajos";
  return "";
}

function TraceFilters({costKind, movementType, projectId, projectOptions, providerId, providerOptions, sourceType, setParam, userId, userOptions}) {
  return <div className="erp-filters report-filters no-print">
    {movementType != null && <label className="erp-field"><span className="erp-field__label">Movimiento</span><select className="erp-control" value={movementType} onChange={(event) => setParam("movement", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Entradas y salidas</option><option value="ENTRADA">Entradas</option><option value="SALIDA">Salidas</option></select></label>}
    {sourceType != null && <label className="erp-field"><span className="erp-field__label">Documento/origen</span><select className="erp-control" value={sourceType} onChange={(event) => setParam("source", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todos</option><option value="recepcion">Recepción</option><option value="compra">Compra legacy</option><option value="venta">Venta</option><option value="proyecto">Proyecto</option><option value="ajuste">Ajuste</option></select></label>}
    {costKind != null && <label className="erp-field"><span className="erp-field__label">Registro</span><select className="erp-control" value={costKind} onChange={(event) => setParam("cost", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Gastos y HH</option><option value="GASTO">Gastos</option><option value="HH">Horas hombre</option></select></label>}
    <label className="erp-field"><span className="erp-field__label">Proveedor</span><select className="erp-control" value={providerId} onChange={(event) => setParam("provider", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todos</option>{providerOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label className="erp-field"><span className="erp-field__label">Proyecto</span><select className="erp-control" value={projectId} onChange={(event) => setParam("project", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todos</option>{projectOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label className="erp-field"><span className="erp-field__label">Usuario</span><select className="erp-control" value={userId} onChange={(event) => setParam("user", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todos</option>{userOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
  </div>;
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], {type: "text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ReportMetricCard({icon, label, note, tone = "neutral", value}) {
  return (
    <article className={`financial-metric-card financial-metric-card--${tone}`}>
      <div className="financial-metric-card__heading">
        {icon && <span className="financial-metric-card__icon">{React.createElement(icon, {size: 19})}</span>}
        <span className="financial-metric-card__label">{label}</span>
      </div>
      <strong className="financial-metric-card__value">{value}</strong>
      {note && <span className="financial-metric-card__note">{note}</span>}
    </article>
  );
}

function Status({value, quote = false, sale = false}) {
  const label = quote
    ? getQuoteStatusLabel(value)
    : sale
      ? getSaleStatusLabel(value)
      : STATUS_LABELS[value] || value || "—";
  return <span className={`report-status report-status--${value}`}>{label}</span>;
}

function ReportFilters({search, status, statusOptions, onSearch, onStatus, placeholder}) {
  return (
    <div className="erp-filters report-filters no-print">
      <label className="erp-field">
        <span className="erp-field__label">Buscar</span>
        <input className="erp-control" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} />
      </label>
      <label className="erp-field">
        <span className="erp-field__label">Estado</span>
        <select className="erp-control" value={status} onChange={(event) => onStatus(event.target.value)}>
          {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
  );
}

function OperationalTimeline({items, emptyMessage}) {
  if (!items.length) return <div className="financial-chart-empty">{emptyMessage}</div>;
  const maximum = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="report-timeline" role="img" aria-label={items.map((item) => `${item.key}: ${formatMoney(item.value, item.currency)}`).join(". ")}>
      {items.map((item) => (
        <div className="report-timeline__row" key={item.key}>
          <span>{item.key}</span>
          <div><i style={{width: `${Math.max((item.value / maximum) * 100, 3)}%`}} /></div>
          <strong>{formatMoney(item.value, item.currency)}</strong>
          <small>{item.count} doc.</small>
        </div>
      ))}
    </div>
  );
}

function EmptyRow({columns, children}) {
  return <tr><td className="report-table-empty" colSpan={columns}>{children}</td></tr>;
}

function SalesReport({items, metrics, timeline, navigate, search, status, setParam}) {
  return (
    <div className="report-section-stack">
      <section className="financial-metric-grid report-four-metrics">
        <ReportMetricCard icon={ShoppingCart} label="Total vendido" value={formatCurrencyGroups(metrics.totalsByCurrency)} tone="income" note="Sólo ventas confirmadas; separado por moneda" />
        <ReportMetricCard icon={ReceiptText} label="Ventas confirmadas" value={metrics.count.toLocaleString("es-CL")} note="Actividad real del periodo" />
        <ReportMetricCard icon={Landmark} label="Ticket promedio" value={formatCurrencyGroups(metrics.totalsByCurrency, "average")} tone="net" note="Promedio separado por moneda" />
        <ReportMetricCard icon={UsersRound} label="Clientes distintos" value={metrics.distinctCustomers.toLocaleString("es-CL")} note="Asociados a ventas confirmadas" />
      </section>
      <section className="erp-panel financial-chart-panel">
        <div className="financial-chart-panel__header"><h2>Evolución de ventas confirmadas</h2><p>Según fecha comercial de la venta.</p></div>
        <OperationalTimeline items={timeline} emptyMessage="No hay ventas confirmadas en este periodo." />
      </section>
      <section className="erp-panel report-documents-panel">
        <div className="financial-chart-panel__header"><h2>Documentos del periodo</h2><p>Los filtros del listado no alteran las métricas confirmadas.</p></div>
        <ReportFilters search={search} status={status} statusOptions={SALE_STATUS_OPTIONS} placeholder="Número o cliente" onSearch={(value) => setParam("q", value)} onStatus={(value) => setParam("status", value === "todos" ? "" : value)} />
        <div className="erp-table-region report-table-region"><table className="erp-table report-table"><thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Total</th><th>Detalle</th></tr></thead><tbody>
          {items.map((sale) => <tr key={sale.id}><td><strong>{sale.numero || "—"}</strong></td><td>{formatDate(sale.fechaVenta)}</td><td><strong>{sale.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</strong><small>{sale.clienteSnapshot?.identificadorFiscalValor || sale.clienteSnapshot?.rut || ""}</small></td><td><Status sale value={sale.estado} /></td><td>{formatMoney(sale.total, resolveReportCurrency(sale))}</td><td><button className="report-detail-button" type="button" onClick={() => navigate(`/ventas/${sale.id}`)}>Ver</button></td></tr>)}
          {!items.length && <EmptyRow columns={6}>No hay ventas para estos filtros.</EmptyRow>}
        </tbody></table></div>
      </section>
    </div>
  );
}

function PurchasesReport({items, metrics, timeline, navigate, search, status, setParam}) {
  return (
    <div className="report-section-stack">
      <section className="financial-metric-grid report-four-metrics">
        <ReportMetricCard icon={Truck} label="Total comprado" value={formatCurrencyGroups(metrics.totalsByCurrency)} tone="expense" note="Sólo compras confirmadas; separado por moneda" />
        <ReportMetricCard icon={ReceiptText} label="Compras confirmadas" value={metrics.count.toLocaleString("es-CL")} note="Actividad real del periodo" />
        <ReportMetricCard icon={Landmark} label="Compra promedio" value={formatCurrencyGroups(metrics.totalsByCurrency, "average")} tone="net" note="Promedio separado por moneda" />
        <ReportMetricCard icon={UsersRound} label="Proveedores distintos" value={metrics.distinctProviders.toLocaleString("es-CL")} note="Asociados a compras confirmadas" />
      </section>
      <section className="erp-panel financial-chart-panel">
        <div className="financial-chart-panel__header"><h2>Evolución de compras confirmadas</h2><p>Según fecha comercial de la compra.</p></div>
        <OperationalTimeline items={timeline} emptyMessage="No hay compras confirmadas en este periodo." />
      </section>
      <section className="erp-panel report-documents-panel">
        <div className="financial-chart-panel__header"><h2>Documentos del periodo</h2><p>Los filtros del listado no alteran las métricas confirmadas.</p></div>
        <ReportFilters search={search} status={status} statusOptions={DOCUMENT_STATUS_OPTIONS} placeholder="Número o proveedor" onSearch={(value) => setParam("q", value)} onStatus={(value) => setParam("status", value === "todos" ? "" : value)} />
        <div className="erp-table-region report-table-region"><table className="erp-table report-table"><thead><tr><th>Número</th><th>Fecha</th><th>Proveedor</th><th>Estado</th><th>Total</th><th>Detalle</th></tr></thead><tbody>
          {items.map((purchase) => <tr key={purchase.id}><td><strong>{purchase.numero || "—"}</strong></td><td>{formatDate(purchase.fechaCompra)}</td><td><strong>{purchase.proveedorSnapshot?.razonSocial || "Sin proveedor"}</strong><small>{purchase.proveedorSnapshot?.identificadorFiscalValor || purchase.proveedorSnapshot?.rut || ""}</small></td><td><Status value={purchase.estado} /></td><td>{formatMoney(purchase.total, resolveReportCurrency(purchase))}</td><td><button className="report-detail-button" type="button" onClick={() => navigate(`/compras/${purchase.id}`)}>Ver</button></td></tr>)}
          {!items.length && <EmptyRow columns={6}>No hay compras para estos filtros.</EmptyRow>}
        </tbody></table></div>
      </section>
    </div>
  );
}

function StatisticsPage({businessId, currencyCode = "CLP", role = ""}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getSantiagoDateKey();
  const period = VALID_PERIODS.has(searchParams.get("period")) ? searchParams.get("period") : "month";
  const defaultRange = getFinancialPeriodRange("month", {}, today);
  const customStart = searchParams.get("from") || defaultRange.start;
  const customEnd = searchParams.get("to") || defaultRange.end;
  const activeTab = REPORT_TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "summary";
  const status = searchParams.get("status") || "todos";
  const search = searchParams.get("q") || "";
  const movementType = searchParams.get("movement") || "todos";
  const currency = searchParams.get("currency") || "todos";
  const sourceType = searchParams.get("source") || "todos";
  const providerId = searchParams.get("provider") || "todos";
  const projectId = searchParams.get("project") || "todos";
  const userId = searchParams.get("user") || "todos";
  const costKind = searchParams.get("cost") || "todos";
  const range = useMemo(() => getFinancialPeriodRange(period, {start: customStart, end: customEnd}, today), [customEnd, customStart, period, today]);
  const financial = useFinancialMovements(businessId, range);
  const [reportState, setReportState] = useState({data: EMPTY_REPORT_DATA, loading: true, error: ""});
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    let active = true;
    setReportState((current) => ({...current, loading: true, error: ""}));
    loadReportData(businessId, {fallbackCurrency: currencyCode, includeTraceability: true, role})
      .then((data) => active && setReportState({data, loading: false, error: ""}))
      .catch((error) => active && setReportState((current) => ({...current, loading: false, error: error?.message || "No pudimos cargar los datos de Reportes."})));
    return () => { active = false; };
  }, [businessId, currencyCode, role]);

  const setParam = (name, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, {replace: true});
    setFeedback("");
  };
  const selectTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === "summary") next.delete("tab");
    else next.set("tab", tab);
    next.delete("status");
    next.delete("q");
    next.delete("movement");
    next.delete("source");
    next.delete("provider");
    next.delete("project");
    next.delete("user");
    next.delete("cost");
    setSearchParams(next, {replace: true});
    setFeedback("");
  };

  const {sales, purchases, quotes, inventory, inventoryMovements, inventoryAcquisitions, works, workCosts, projectBalances} = reportState.data;
  const currencyOptions = useMemo(() => [...new Set([
    ...sales, ...purchases, ...quotes, ...inventoryMovements, ...inventoryAcquisitions,
    ...workCosts, ...financial.items,
  ].map((item) => resolveReportCurrency(item, currencyCode)))].sort(), [currencyCode, financial.items, inventoryAcquisitions, inventoryMovements, purchases, quotes, sales, workCosts]);
  const metricOptions = {currency, fallbackCurrency: currencyCode};
  const salesMetrics = useMemo(() => getSalesMetrics(sales, range, metricOptions), [currency, currencyCode, range, sales]);
  const purchaseMetrics = useMemo(() => getPurchaseMetrics(purchases, range, metricOptions), [currency, currencyCode, purchases, range]);
  const quoteMetrics = useMemo(() => getQuoteMetrics(quotes, range, metricOptions), [currency, currencyCode, quotes, range]);
  const inventoryMetrics = useMemo(() => getInventoryMetrics(inventory, {fallbackCurrency: currencyCode}), [currencyCode, inventory]);
  const filteredSales = useMemo(() => filterSales(sales, {range, status, search, ...metricOptions}), [currency, currencyCode, range, sales, search, status]);
  const filteredPurchases = useMemo(() => filterPurchases(purchases, {range, status, search, ...metricOptions}), [currency, currencyCode, purchases, range, search, status]);
  const filteredQuotes = useMemo(() => filterQuotes(quotes, {range, status, search, ...metricOptions}), [currency, currencyCode, quotes, range, search, status]);
  const traceFilters = {range, type: movementType, sourceType, currency, providerId, projectId, userId, fallbackCurrency: currencyCode};
  const filteredMovements = useMemo(() => filterInventoryMovements(inventoryMovements, traceFilters), [currency, currencyCode, inventoryMovements, movementType, projectId, providerId, range, sourceType, userId]);
  const filteredAcquisitions = useMemo(() => filterInventoryAcquisitions(inventoryAcquisitions, traceFilters), [currency, currencyCode, inventoryAcquisitions, providerId, range, userId]);
  const filteredWorkCosts = useMemo(() => filterWorkCosts(workCosts, {...traceFilters, kind: costKind}), [costKind, currency, currencyCode, projectId, range, userId, workCosts]);
  const filteredProjectBalances = useMemo(() => projectBalances.filter((entry) =>
    (projectId === "todos" || entry.id === projectId) &&
    (currency === "todos" || entry.balance?.moneda === currency || entry.balance?.monedasIncompatibles?.includes(currency))
  ), [currency, projectBalances, projectId]);
  const salesTimeline = useMemo(() => aggregateOperationalTimeline(salesMetrics.confirmed, {range, dateField: "fechaVenta", fallbackCurrency: currencyCode}), [currencyCode, range, salesMetrics.confirmed]);
  const purchaseTimeline = useMemo(() => aggregateOperationalTimeline(purchaseMetrics.confirmed, {range, dateField: "fechaCompra", fallbackCurrency: currencyCode}), [currencyCode, purchaseMetrics.confirmed, range]);
  const filteredFinancial = useMemo(() => financial.items.filter((item) => currency === "todos" || resolveReportCurrency(item, currencyCode) === currency), [currency, currencyCode, financial.items]);
  const financialByCurrency = useMemo(() => currencyOptions.map((currencyId) => {
    const items = filteredFinancial.filter((item) => resolveReportCurrency(item, currencyCode) === currencyId);
    return {currency: currencyId, items, summary: summarizeFinancialMovements(items)};
  }).filter((entry) => entry.items.length), [currencyCode, currencyOptions, filteredFinancial]);
  const financialViews = useMemo(() => financialByCurrency.map((entry) => {
    const paid = entry.items.filter((movement) => movement.status === "paid");
    return {
      ...entry,
      timeline: aggregateFinancialTimeline(entry.items, range),
      incomeCategories: aggregateFinancialByCategory(paid, "income"),
      expenseCategories: aggregateFinancialByCategory(paid, "expense"),
    };
  }), [financialByCurrency, range]);
  const quoteChartItems = QUOTE_CHART.map(([id, label, color]) => ({label, color, value: quoteMetrics.counts[id]}));
  const providerOptions = useMemo(() => uniqueOptions([...inventoryAcquisitions, ...inventoryMovements], "providerId", "providerName"), [inventoryAcquisitions, inventoryMovements]);
  const projectOptions = useMemo(() => works.map((work) => [work.id, [work.numero, work.titulo].filter(Boolean).join(" · ") || work.id]), [works]);
  const userOptions = useMemo(() => uniqueOptions([...inventoryMovements, ...inventoryAcquisitions, ...workCosts], "userId", "userName"), [inventoryAcquisitions, inventoryMovements, workCosts]);
  const canViewProfitability = ["OWNER", "ADMIN"].includes(String(role || "").toUpperCase());

  const exportActive = () => {
    const shared = {
      sales: salesMetrics,
      purchases: purchaseMetrics,
      quotes: quoteMetrics,
      inventory: inventoryMetrics,
      financial: financialByCurrency,
      fallbackCurrency: currencyCode,
    };
    const items = activeTab === "sales" ? filteredSales
      : activeTab === "purchases" ? filteredPurchases
        : activeTab === "inventory" ? filteredMovements
          : activeTab === "projects" ? filteredWorkCosts
            : activeTab === "finances" ? filteredFinancial
              : filteredQuotes;
    const csv = buildReportCsv(activeTab, {
      ...shared,
      items,
      acquisitions: filteredAcquisitions,
      balances: canViewProfitability ? filteredProjectBalances : [],
    });
    downloadCsv(csv, `valoracloud-reporte-${activeTab}-${businessId}-${range.start}-${range.end}.csv`);
    setFeedback("CSV generado con los datos visibles de la pestaña activa.");
  };

  return (
    <section className="erp-page statistics-page reports-page">
      <div className="financial-page-heading">
        <div className="erp-page-intro"><p>Información operacional consolidada del negocio activo. Reportes no reemplaza la contabilidad formal.</p></div>
        <div className="financial-page-actions no-print"><Button variant="secondary" icon={Download} onClick={exportActive} disabled={reportState.loading || (["summary", "finances"].includes(activeTab) && financial.loading)}>Exportar CSV</Button></div>
      </div>
      <div className="financial-period-bar">
        <FinancialPeriodSelector period={period} customStart={customStart} customEnd={customEnd} options={REPORT_PERIOD_OPTIONS} onPeriodChange={(value) => setParam("period", value === "month" ? "" : value)} onCustomStartChange={(value) => setParam("from", value)} onCustomEndChange={(value) => setParam("to", value)} idPrefix="reports-period" />
        <span className="financial-period-bar__caption">{formatDate(range.start)} al {formatDate(range.end)} · America/Santiago</span>
        <label className="erp-field no-print"><span className="erp-field__label">Moneda</span><select className="erp-control" value={currency} onChange={(event) => setParam("currency", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todas, sin sumar</option>{currencyOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <div className="financial-tabs statistics-tabs" role="tablist" aria-label="Secciones de Reportes">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "financial-tab is-active" : "financial-tab"} onClick={() => selectTab(id)}>{label}</button>)}
      </div>
      {feedback && <div className="financial-feedback" role="status">{feedback}</div>}
      {reportState.error && <div className="financial-feedback financial-feedback--error" role="alert">{reportState.error}</div>}
      {(activeTab === "summary" || activeTab === "finances") && financial.error && <div className="financial-feedback financial-feedback--error" role="alert">{financial.error}</div>}
      {reportState.loading && <div className="financial-inline-loading" role="status">Cargando información operacional del negocio activo...</div>}
      {!reportState.loading && !reportState.error && activeTab === "summary" && financial.loading && <div className="financial-inline-loading" role="status">Cargando resumen financiero registrado...</div>}

      {!reportState.loading && !reportState.error && !financial.loading && activeTab === "summary" && (
        <div className="report-section-stack">
          <section className="financial-metric-grid report-summary-metrics">
            <ReportMetricCard icon={ShoppingCart} label="Total vendido" value={formatCurrencyGroups(salesMetrics.totalsByCurrency)} tone="income" note={`${salesMetrics.count} ventas confirmadas`} />
            <ReportMetricCard icon={Truck} label="Total comprado" value={formatCurrencyGroups(purchaseMetrics.totalsByCurrency)} tone="expense" note={`${purchaseMetrics.count} compras confirmadas`} />
            <ReportMetricCard icon={ReceiptText} label="Cotizaciones" value={quoteMetrics.count.toLocaleString("es-CL")} note={`${quoteMetrics.counts.aceptada} aceptadas · ${quoteMetrics.conversion === null ? "sin base" : formatPercent(quoteMetrics.conversion)}`} />
            <ReportMetricCard icon={Boxes} label="Productos activos" value={inventoryMetrics.activeProducts.length.toLocaleString("es-CL")} note={`${inventoryMetrics.lowStockProducts.length} con stock bajo`} />
            <ReportMetricCard icon={Landmark} label="Resultado financiero" value={formatFinancialGroups(financialByCurrency, "netResult")} tone="net" note="Separado por moneda registrada" />
          </section>
          <div className="financial-data-note">Ventas y compras no alimentan Finanzas automáticamente. Cada total se separa por moneda; no se aplica FX.</div>
          <div className="statistics-overview-grid">
            <section className="erp-panel statistics-compact-panel"><div><h2>Actividad comercial</h2><p>Documentos confirmados del periodo.</p></div><strong>{salesMetrics.count + purchaseMetrics.count}</strong><span>{salesMetrics.count} ventas · {purchaseMetrics.count} compras</span></section>
            <section className="erp-panel statistics-compact-panel"><div><h2>Conversión de cotizaciones</h2><p>Estado actual de cotizaciones fechadas en el periodo.</p></div><strong>{quoteMetrics.conversion === null ? "—" : formatPercent(quoteMetrics.conversion)}</strong><span>Aceptadas ÷ aceptadas + rechazadas</span></section>
          </div>
        </div>
      )}

      {!reportState.loading && !reportState.error && activeTab === "sales" && <SalesReport items={filteredSales} metrics={salesMetrics} timeline={salesTimeline} navigate={navigate} search={search} status={status} setParam={setParam} />}
      {!reportState.loading && !reportState.error && activeTab === "purchases" && <PurchasesReport items={filteredPurchases} metrics={purchaseMetrics} timeline={purchaseTimeline} navigate={navigate} search={search} status={status} setParam={setParam} />}

      {!reportState.loading && !reportState.error && activeTab === "inventory" && (
        <div className="report-section-stack">
          <div className="financial-data-note"><strong>Trazabilidad canónica.</strong> El stock es actual; el periodo filtra movimientos y adquisiciones. Los costos se separan por moneda y no usan FX.</div>
          <section className="financial-metric-grid report-four-metrics">
            <ReportMetricCard icon={Boxes} label="Productos activos" value={inventoryMetrics.activeProducts.length.toLocaleString("es-CL")} note="No incluye servicios ni actividades" />
            <ReportMetricCard icon={Boxes} label="Stock bajo" value={inventoryMetrics.lowStockProducts.length.toLocaleString("es-CL")} tone="pending" note="Stock actual ≤ stock mínimo" />
            <ReportMetricCard icon={Landmark} label="Cobertura de costos" value={formatPercent(inventoryMetrics.coverage)} note={`${inventoryMetrics.coveredProducts.length} de ${inventoryMetrics.activeProducts.length} productos`} />
            <ReportMetricCard icon={Landmark} label="Valorización actual" value={inventoryMetrics.coverage === 100 ? formatCurrencyGroups(inventoryMetrics.inventoryValuesByCurrency) : "No disponible"} tone="net" note={inventoryMetrics.coverage === 100 ? "Costo promedio compatible × stock" : "Cobertura de costos incompleta"} />
          </section>
          <TraceFilters movementType={movementType} sourceType={sourceType} projectId={projectId} projectOptions={projectOptions} providerId={providerId} providerOptions={providerOptions} userId={userId} userOptions={userOptions} setParam={setParam} />
          <section className="erp-panel report-documents-panel"><div className="financial-chart-panel__header"><h2>Entradas y salidas</h2><p>Movimiento, origen, responsable y vínculo documental/proyecto.</p></div><div className="erp-table-region report-table-region"><table className="erp-table report-table"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Producto</th><th>Cantidad</th><th>Origen</th><th>Proveedor / proyecto</th><th>Usuario</th><th>Costo</th></tr></thead><tbody>{filteredMovements.map((movement) => { const route = sourceRoute(movement); return <tr key={movement.id}><td>{formatDate(movement.date)}</td><td><span className={`report-movement-type report-movement-type--${movement.direction.toLowerCase()}`}>{MOVEMENT_LABELS[movement.type] || movement.type || "Histórico"}</span></td><td><strong>{movement.productName}</strong></td><td>{movement.quantity.toLocaleString("es-CL")} {movement.unit}</td><td>{route ? <button className="report-detail-button" type="button" onClick={() => navigate(route)}>{movement.documentNumber || "Ver origen"}</button> : movement.documentNumber || "—"}</td><td>{movement.providerName || [movement.projectNumber, movement.projectTitle].filter(Boolean).join(" · ") || "—"}</td><td>{movement.userName || movement.userId || "No informado"}</td><td>{movement.totalCost > 0 ? formatMoney(movement.totalCost, movement.currency) : "—"}</td></tr>; })}{!filteredMovements.length && <EmptyRow columns={8}>No hay movimientos para estos filtros.</EmptyRow>}</tbody></table></div></section>
          <section className="erp-panel report-documents-panel"><div className="financial-chart-panel__header"><h2>Adquisiciones y costos</h2><p>Producto → proveedor → OC → REC → COM; Recepción es la fuente de stock.</p></div><div className="erp-table-region report-table-region"><table className="erp-table report-table"><thead><tr><th>Fecha</th><th>Producto</th><th>Proveedor</th><th>Cantidad</th><th>Costo unitario</th><th>Costo pagado</th><th>Origen</th><th>Usuario</th></tr></thead><tbody>{filteredAcquisitions.map((entry) => <tr key={entry.id}><td>{formatDate(entry.date)}</td><td><strong>{entry.productName}</strong></td><td>{entry.providerName || "No informado"}</td><td>{entry.quantity.toLocaleString("es-CL")} {entry.unit}</td><td>{formatMoney(entry.unitCost, entry.currency)}</td><td>{formatMoney(entry.totalCost, entry.currency)}</td><td>{[entry.ordenCompraNumero, entry.recepcionNumero, entry.compraNumero].filter(Boolean).join(" · ") || "Legacy sin origen"}</td><td>{entry.userId || "No informado"}</td></tr>)}{!filteredAcquisitions.length && <EmptyRow columns={8}>No hay adquisiciones para estos filtros.</EmptyRow>}</tbody></table></div></section>
        </div>
      )}

      {!reportState.loading && !reportState.error && activeTab === "projects" && (
        <div className="report-section-stack">
          <div className="financial-data-note"><strong>Costos del expediente.</strong> Gastos y HH vigentes provienen del TRB; la rentabilidad usa la Function autoritativa y sólo es visible a OWNER/ADMIN.</div>
          <TraceFilters costKind={costKind} projectId={projectId} projectOptions={projectOptions} providerId={providerId} providerOptions={[]} userId={userId} userOptions={userOptions} setParam={setParam} />
          <section className="erp-panel report-documents-panel"><div className="financial-chart-panel__header"><h2>Gastos y horas hombre</h2><p>Registros vigentes del periodo; las anulaciones permanecen en el expediente.</p></div><div className="erp-table-region report-table-region"><table className="erp-table report-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Proyecto</th><th>Concepto/categoría</th><th>Responsable</th><th>Horas</th><th>Costo</th></tr></thead><tbody>{filteredWorkCosts.map((entry) => <tr key={`${entry.kind}-${entry.id}`}><td>{formatDate(entry.date)}</td><td>{entry.kind === "HH" ? "Horas hombre" : "Gasto"}</td><td><strong>{entry.projectNumber || entry.projectTitle || entry.projectId}</strong></td><td>{entry.concept || "Sin concepto"}<small>{entry.category}</small></td><td>{entry.userName || entry.userId || "No informado"}</td><td>{entry.hours == null ? "—" : entry.hours.toLocaleString("es-CL")}</td><td>{formatMoney(entry.amount, entry.currency)}</td></tr>)}{!filteredWorkCosts.length && <EmptyRow columns={7}>No hay gastos ni HH para estos filtros.</EmptyRow>}</tbody></table></div></section>
          {!canViewProfitability ? <div className="financial-data-note"><strong>Rentabilidad restringida.</strong> Los miembros operativos no pueden consultar ingresos, resultado ni margen empresarial.</div> : <section className="erp-panel report-documents-panel"><div className="financial-chart-panel__header"><h2>Rentabilidad por proyecto</h2><p>Venta confirmada menos materiales netos, HH, gastos directos e indirectos.</p></div><div className="erp-table-region report-table-region"><table className="erp-table report-table"><thead><tr><th>Proyecto</th><th>Estado</th><th>Ingreso</th><th>Materiales</th><th>HH</th><th>Gastos directos</th><th>Indirectos</th><th>Resultado</th><th>Rentabilidad</th></tr></thead><tbody>{filteredProjectBalances.map((entry) => { const balance = entry.balance; const incompatible = balance.estado === "INCONSISTENTE_MONEDA"; return <tr key={entry.id}><td><strong>{entry.numero || entry.titulo}</strong></td><td>{balance.estado}</td><td>{incompatible ? "No sumable" : formatMoney(balance.valorComercial, balance.moneda)}</td><td>{incompatible ? "—" : formatMoney(balance.materiales, balance.moneda)}</td><td>{incompatible ? "—" : formatMoney(balance.horasHombre, balance.moneda)}</td><td>{incompatible ? "—" : formatMoney(balance.gastosDirectos, balance.moneda)}</td><td>{incompatible ? "—" : formatMoney(balance.gastosIndirectos, balance.moneda)}</td><td>{incompatible ? "—" : formatMoney(balance.resultado, balance.moneda)}</td><td>{incompatible || balance.rentabilidadPct == null ? "—" : formatPercent(balance.rentabilidadPct)}</td></tr>; })}{!filteredProjectBalances.length && <EmptyRow columns={9}>No hay balances de proyecto disponibles.</EmptyRow>}</tbody></table></div></section>}
        </div>
      )}

      {!reportState.loading && !reportState.error && activeTab === "quotes" && (
        <div className="report-section-stack">
          <div className="financial-data-note">Las cotizaciones no son ingresos. Los estados corresponden al estado actual de documentos fechados en el periodo, no a la fecha de la transición.</div>
          <section className="financial-metric-grid report-quote-metrics">
            <ReportMetricCard icon={ReceiptText} label="Cotizaciones" value={quoteMetrics.count.toLocaleString("es-CL")} note="Fechadas en el periodo" />
            <ReportMetricCard label="Emitidas" value={quoteMetrics.counts.emitida.toLocaleString("es-CL")} note={formatCurrencyGroups(quoteMetrics.amountsByCurrency.emitida)} />
            <ReportMetricCard label="Aceptadas" value={quoteMetrics.counts.aceptada.toLocaleString("es-CL")} tone="income" note={formatCurrencyGroups(quoteMetrics.amountsByCurrency.aceptada)} />
            <ReportMetricCard label="Rechazadas" value={quoteMetrics.counts.rechazada.toLocaleString("es-CL")} tone="expense" note={formatCurrencyGroups(quoteMetrics.amountsByCurrency.rechazada)} />
            <ReportMetricCard label="Vencidas" value={quoteMetrics.counts.vencida.toLocaleString("es-CL")} tone="pending" note={formatCurrencyGroups(quoteMetrics.amountsByCurrency.vencida)} />
            <ReportMetricCard label="Conversión" value={quoteMetrics.conversion === null ? "Sin base" : formatPercent(quoteMetrics.conversion)} note="Aceptadas ÷ aceptadas + rechazadas" />
          </section>
          <div className="statistics-module-grid"><section className="erp-panel"><div className="financial-chart-panel__header"><h2>Cotizaciones por estado actual</h2><p>Incluye todos los estados del periodo seleccionado.</p></div><DashboardDonutChart ariaLabel="Cotizaciones por estado actual" emptyMessage="Sin cotizaciones en el periodo" items={quoteChartItems} /><dl className="statistics-definition-list report-quote-amounts">{QUOTE_CHART.map(([id, label]) => <div key={id}><dt>Monto {label.toLocaleLowerCase("es-CL")}</dt><dd>{formatCurrencyGroups(quoteMetrics.amountsByCurrency[id])}</dd></div>)}</dl></section><section className="erp-panel report-documents-panel"><div className="financial-chart-panel__header"><h2>Documentos del periodo</h2><p>Montos cotizados; no representan ingresos.</p></div><ReportFilters search={search} status={status} statusOptions={QUOTE_STATUS_OPTIONS} placeholder="Número o cliente" onSearch={(value) => setParam("q", value)} onStatus={(value) => setParam("status", value === "todos" ? "" : value)} /><div className="erp-table-region report-table-region"><table className="erp-table report-table"><thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Estado actual</th><th>Monto</th></tr></thead><tbody>{filteredQuotes.map((quote) => <tr key={quote.id}><td><strong>{quote.numero || "—"}</strong></td><td>{formatDate(quote.fecha)}</td><td><strong>{quote.clienteNombre || "Sin cliente"}</strong><small>{quote.cliente?.identificadorFiscalValor || quote.clienteRut || ""}</small></td><td><Status value={quote.estado} quote /></td><td>{formatMoney(quote.total, resolveReportCurrency(quote, currencyCode))}</td></tr>)}{!filteredQuotes.length && <EmptyRow columns={5}>No hay cotizaciones para estos filtros.</EmptyRow>}</tbody></table></div></section></div>
        </div>
      )}

      {activeTab === "finances" && (
        <div className="report-section-stack">
          <div className="financial-data-note"><strong>Movimientos financieros registrados.</strong> Cada moneda se resume y grafica por separado; no se aplica FX.</div>
          {financial.loading ? <div className="financial-inline-loading" role="status">Cargando movimientos financieros...</div> : <><section className="financial-metric-grid"><ReportMetricCard icon={ArrowDownLeft} label="Ingresos pagados" value={formatFinancialGroups(financialByCurrency, "paidIncome")} tone="income" /><ReportMetricCard icon={ArrowUpRight} label="Egresos pagados" value={formatFinancialGroups(financialByCurrency, "paidExpense")} tone="expense" /><ReportMetricCard icon={Landmark} label="Resultado neto" value={formatFinancialGroups(financialByCurrency, "netResult")} tone="net" /><ReportMetricCard icon={ReceiptText} label="Por cobrar" value={formatFinancialGroups(financialByCurrency, "receivable")} tone="pending" /><ReportMetricCard icon={WalletCards} label="Por pagar" value={formatFinancialGroups(financialByCurrency, "payable")} tone="pending" /></section>{financialViews.map((view) => <section className="report-section-stack" key={view.currency}><div className="financial-data-note"><strong>{view.currency}</strong> · {view.items.length} movimientos</div><div className="statistics-chart-grid"><section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><h2>Evolución financiera {view.currency}</h2><p>Sólo movimientos pagados.</p></div><FinancialTimelineChart currency={view.currency} data={view.timeline} /></section><section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><h2>Pagados y pendientes {view.currency}</h2><p>Movimientos efectivamente registrados.</p></div><FinancialStatusChart currency={view.currency} movements={view.items} /></section><section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><h2>Ingresos por categoría {view.currency}</h2></div><FinancialCategoryChart currency={view.currency} data={view.incomeCategories} label={`Ingresos ${view.currency}`} /></section><section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><h2>Egresos por categoría {view.currency}</h2></div><FinancialCategoryChart currency={view.currency} data={view.expenseCategories} label={`Egresos ${view.currency}`} /></section></div></section>)}</>}
        </div>
      )}
    </section>
  );
}

export default StatisticsPage;
