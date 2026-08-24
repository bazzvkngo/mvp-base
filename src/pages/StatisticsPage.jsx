import React, {useEffect, useMemo, useState} from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  BriefcaseBusiness,
  Download,
  Filter,
  PackageCheck,
  ReceiptText,
  ShoppingCart,
  UsersRound,
  WalletCards,
} from "lucide-react";
import {useNavigate, useOutletContext, useSearchParams} from "react-router-dom";
import DashboardDonutChart from "../components/DashboardDonutChart";
import {FinancialTimelineChart} from "../components/finance/FinancialCharts";
import FinancialPeriodSelector from "../components/finance/FinancialPeriodSelector";
import Button from "../components/ui/Button";
import {
  aggregateFinancialTimeline,
  getFinancialPeriodRange,
  getFinancialSummary,
  getSantiagoDateKey,
} from "../domain/financialMovement.mjs";
import {
  REPORT_PERIOD_OPTIONS,
  REPORT_TABS,
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
  isDateInRange,
  resolveReportCurrency,
} from "../domain/reportModel.mjs";
import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../domain/rbac.mjs";
import {getOrderReceptionStatus} from "../domain/receptionModel.mjs";
import {getQuoteStatusLabel} from "../domain/quoteModel.mjs";
import {getSaleStatusLabel} from "../domain/saleModel.mjs";
import {
  canViewWorkProfitability,
  getWorkPriorityLabel,
  getWorkStatusLabel,
} from "../domain/workModel.mjs";
import useFinancialMovements from "../hooks/useFinancialMovements";
import {loadReportData} from "../services/reportService";
import {formatDate, formatMoney, formatPercent} from "../utils/formatters";

const VALID_PERIODS = new Set(REPORT_PERIOD_OPTIONS.map((option) => option.id));
const LEGACY_TABS = Object.freeze({
  summary: "overview",
  sales: "commercial",
  quotes: "commercial",
  inventory: "operations",
  projects: "operations",
  purchases: "supply",
  finances: "finances",
});
const TABS = [
  ["overview", "Vista general"],
  ["commercial", "Comercial"],
  ["operations", "Operación"],
  ["supply", "Abastecimiento"],
  ["finances", "Finanzas"],
];
const DOCUMENT_STATUS_OPTIONS = [
  ["todos", "Todos los estados"],
  ["borrador", "Borrador"],
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
const WORK_CHART = [
  ["pendiente", "Pendientes", "#94a3b8"],
  ["en_progreso", "En progreso", "#2563eb"],
  ["en_espera", "En espera", "#d97706"],
  ["completado", "Completados", "#0f766e"],
  ["cancelado", "Cancelados", "#dc2626"],
];
const QUOTE_CHART = [
  ["borrador", "Pendientes", "#94a3b8"],
  ["emitida", "Emitidas", "#38bdf8"],
  ["aceptada", "Aceptadas", "#0f766e"],
  ["rechazada", "Rechazadas", "#dc2626"],
  ["vencida", "Vencidas", "#d97706"],
  ["archivada", "Archivadas", "#64748b"],
];
const EMPTY_REPORT_DATA = {
  sales: [], purchases: [], purchaseOrders: [], receptions: [], quotes: [],
  inventory: [], inventoryMovements: [], inventoryAcquisitions: [], works: [],
  workCosts: [], projectBalances: [],
};
const ACTIVE_WORK_STATES = new Set(["pendiente", "en_progreso", "en_espera"]);

const text = (value) => String(value ?? "").trim();

function timestampDateKey(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  if (Number.isFinite(Number(value?.seconds))) return new Date(Number(value.seconds) * 1000).toISOString().slice(0, 10);
  return text(value).slice(0, 10);
}

function acquisitionRoute(entry) {
  if (entry.recepcionId) return `/recepciones/${entry.recepcionId}`;
  if (entry.compraId) return `/compras/${entry.compraId}`;
  if (entry.ordenCompraId) return `/ordenes-compra/${entry.ordenCompraId}`;
  return "";
}

function formatCurrencyGroups(groups, field = "total", empty = "Sin registros") {
  const values = (Array.isArray(groups) ? groups : []).map((group) => formatMoney(group[field], group.currency));
  return values.length ? values.join(" · ") : empty;
}

function formatFinancialGroups(groups, field, empty = "Sin movimientos") {
  const values = (Array.isArray(groups) ? groups : []).map((group) => formatMoney(group.summary?.[field], group.currency));
  return values.length ? values.join(" · ") : empty;
}

function uniqueOptions(items, idField, labelField) {
  const values = new Map();
  items.forEach((item) => {
    const id = text(item?.[idField]);
    const label = text(item?.[labelField]);
    if (id && !values.has(id)) values.set(id, label || id);
  });
  return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], "es"));
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
  return <article className={`financial-metric-card financial-metric-card--${tone}`}>
    <div className="financial-metric-card__heading">
      {icon && <span className="financial-metric-card__icon">{React.createElement(icon, {size: 19})}</span>}
      <span className="financial-metric-card__label">{label}</span>
    </div>
    <strong className="financial-metric-card__value">{value}</strong>
    {note && <span className="financial-metric-card__note">{note}</span>}
  </article>;
}

function Panel({action, children, description, title}) {
  return <section className="erp-panel reports-v3-panel">
    <div className="reports-v3-panel__header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>
    {children}
  </section>;
}

function ModuleLink({children, onClick}) {
  return <button className="reports-v3-module-link" type="button" onClick={onClick}>{children}<ArrowRight size={15} /></button>;
}

function DecisionList({empty, items, navigate}) {
  if (!items.length) return <p className="reports-v3-compact-empty">{empty}</p>;
  return <ul className="reports-v3-decision-list">{items.map((item) => <li key={item.id}>
    <span className={`reports-v3-decision-list__marker reports-v3-decision-list__marker--${item.tone || "neutral"}`} aria-hidden="true" />
    <div><strong>{item.title}</strong>{item.meta && <span>{item.meta}</span>}</div>
    {item.route && <button type="button" onClick={() => navigate(item.route)}>Ver</button>}
  </li>)}</ul>;
}

function OperationalTimeline({items, emptyMessage}) {
  if (!items.length) return <p className="reports-v3-compact-empty">{emptyMessage}</p>;
  const byCurrency = items.reduce((groups, item) => ({...groups, [item.currency]: [...(groups[item.currency] || []), item]}), {});
  return <div className="reports-v3-timeline-groups">{Object.entries(byCurrency).map(([currency, currencyItems]) => {
    const recent = currencyItems.slice(-8);
    const maximum = Math.max(...recent.map((item) => item.value), 1);
    return <div className="reports-v3-timeline-group" key={currency}>
      <strong>{currency}</strong>
      <div className="report-timeline" role="img" aria-label={recent.map((item) => `${item.key}: ${formatMoney(item.value, currency)}`).join(". ")}>
        {recent.map((item) => <div className="report-timeline__row" key={`${currency}-${item.key}`}>
          <span>{item.key}</span><div><i style={{width: `${Math.max((item.value / maximum) * 100, item.value ? 3 : 0)}%`}} /></div>
          <strong>{formatMoney(item.value, currency)}</strong><small>{item.count} doc.</small>
        </div>)}
      </div>
    </div>;
  })}</div>;
}

function AdvancedFilters({activeCount, children, open, onToggle}) {
  return <div className="reports-v3-advanced no-print">
    <button className="reports-v3-filter-toggle" type="button" aria-expanded={open} onClick={onToggle}>
      <Filter size={17} /> Filtros avanzados
      {activeCount > 0 && <span aria-label={`${activeCount} filtros activos`}>{activeCount}</span>}
    </button>
    {open && <div className="erp-filters reports-v3-filter-panel">{children}</div>}
  </div>;
}

function Field({children, label}) {
  return <label className="erp-field"><span className="erp-field__label">{label}</span>{children}</label>;
}

function EmptyBusiness({actions, completion, navigate}) {
  return <section className="erp-panel reports-v3-empty-business">
    <span className="reports-v3-empty-business__icon"><BriefcaseBusiness size={30} /></span>
    <div><h2>Tu negocio está listo para comenzar</h2><p>A medida que registres operaciones, aquí verás el estado general de tu empresa.</p></div>
    {completion && completion.percent < 100 && <div className="reports-v3-completion">
      <div><strong>Tu empresa está {completion.percent}% configurada</strong><span>Completa la ficha para trabajar con información más precisa.</span></div>
      <Button variant="secondary" onClick={() => navigate("/empresa")}>Continuar configuración</Button>
    </div>}
    {actions.length > 0 && <div className="reports-v3-empty-actions">{actions.map((action) => <Button key={action.route} variant="secondary" icon={action.icon} onClick={() => navigate(action.route, action.state ? {state: action.state} : undefined)}>{action.label}</Button>)}</div>}
  </section>;
}

function ViewEmpty({action, description, icon, navigate, title}) {
  return <section className="erp-panel reports-v3-section-empty">
    {React.createElement(icon, {size: 25})}
    <div><h2>{title}</h2><p>{description}</p></div>
    {action && <Button variant="secondary" onClick={() => navigate(action.route)}>{action.label}</Button>}
  </section>;
}

function StatisticsPage({businessId, currencyCode = "CLP", role = ""}) {
  const navigate = useNavigate();
  const {businessCompletionStatus} = useOutletContext() || {};
  const [searchParams, setSearchParams] = useSearchParams();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const requestedPeriod = searchParams.get("period") || "month";
  const period = VALID_PERIODS.has(requestedPeriod) ? requestedPeriod : "month";
  const today = getSantiagoDateKey();
  const customStart = searchParams.get("from") || today;
  const customEnd = searchParams.get("to") || today;
  const range = useMemo(() => getFinancialPeriodRange(period, new Date(), customStart, customEnd), [customEnd, customStart, period]);
  const requestedTab = searchParams.get("tab") || "overview";
  const activeTab = REPORT_TABS.includes(requestedTab) ? requestedTab : LEGACY_TABS[requestedTab] || "overview";
  const selectedCurrency = searchParams.get("currency") || "todos";
  const search = searchParams.get("q") || "";
  const legacyStatus = searchParams.get("status") || "todos";
  const saleStatus = searchParams.get("saleStatus") || (requestedTab === "sales" ? legacyStatus : "todos");
  const quoteStatus = searchParams.get("quoteStatus") || (requestedTab === "quotes" ? legacyStatus : "todos");
  const purchaseStatus = searchParams.get("purchaseStatus") || (requestedTab === "purchases" ? legacyStatus : "todos");
  const movementType = searchParams.get("movement") || "todos";
  const sourceType = searchParams.get("source") || "todos";
  const providerId = searchParams.get("provider") || "todos";
  const projectId = searchParams.get("project") || "todos";
  const userId = searchParams.get("user") || "todos";
  const costKind = searchParams.get("cost") || "todos";
  const financeType = searchParams.get("financeType") || "todos";
  const financeStatus = searchParams.get("financeStatus") || "todos";
  const can = (permission) => hasBusinessPermission(role, permission);
  const canViewProfitability = can(BUSINESS_PERMISSIONS.PROFITABILITY_READ) && canViewWorkProfitability(role);
  const [reportState, setReportState] = useState({data: EMPTY_REPORT_DATA, loading: true, error: ""});
  const financial = useFinancialMovements(businessId, range);

  useEffect(() => {
    let active = true;
    setReportState({data: EMPTY_REPORT_DATA, loading: true, error: ""});
    loadReportData(businessId, {fallbackCurrency: currencyCode, includeTraceability: true, role})
      .then((data) => active && setReportState({data, loading: false, error: ""}))
      .catch((error) => {
        if (import.meta.env.DEV) console.error("No se pudieron cargar los reportes:", error);
        if (active) setReportState({data: EMPTY_REPORT_DATA, loading: false, error: "No pudimos cargar los datos de Reportes."});
      });
    return () => { active = false; };
  }, [businessId, currencyCode, role]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (["saleStatus", "quoteStatus", "purchaseStatus"].includes(key)) next.delete("status");
    setSearchParams(next, {replace: true});
  };

  const data = reportState.data;
  const filteredSales = useMemo(() => filterSales(data.sales, {range, status: saleStatus, search, currency: selectedCurrency, fallbackCurrency: currencyCode}), [currencyCode, data.sales, range, saleStatus, search, selectedCurrency]);
  const filteredQuotes = useMemo(() => filterQuotes(data.quotes, {range, status: quoteStatus, search, currency: selectedCurrency, fallbackCurrency: currencyCode}), [currencyCode, data.quotes, quoteStatus, range, search, selectedCurrency]);
  const filteredPurchasesBase = useMemo(() => filterPurchases(data.purchases, {range, status: purchaseStatus, search, currency: selectedCurrency, fallbackCurrency: currencyCode}), [currencyCode, data.purchases, purchaseStatus, range, search, selectedCurrency]);
  const filteredPurchases = useMemo(() => filteredPurchasesBase.filter((purchase) => providerId === "todos" || text(purchase.proveedorId || purchase.proveedorSnapshot?.proveedorId) === providerId), [filteredPurchasesBase, providerId]);
  const filteredMovements = useMemo(() => filterInventoryMovements(data.inventoryMovements, {range, type: movementType, sourceType, currency: selectedCurrency, providerId, projectId, userId, fallbackCurrency: currencyCode}), [currencyCode, data.inventoryMovements, movementType, projectId, providerId, range, selectedCurrency, sourceType, userId]);
  const filteredAcquisitions = useMemo(() => filterInventoryAcquisitions(data.inventoryAcquisitions, {range, currency: selectedCurrency, providerId, userId, fallbackCurrency: currencyCode}), [currencyCode, data.inventoryAcquisitions, providerId, range, selectedCurrency, userId]);
  const filteredWorkCosts = useMemo(() => filterWorkCosts(data.workCosts, {range, kind: costKind, currency: selectedCurrency, projectId, userId, fallbackCurrency: currencyCode}), [costKind, currencyCode, data.workCosts, projectId, range, selectedCurrency, userId]);
  const currencyFinancialItems = useMemo(() => financial.items.filter((entry) =>
    selectedCurrency === "todos" || resolveReportCurrency(entry, currencyCode) === selectedCurrency
  ), [currencyCode, financial.items, selectedCurrency]);
  const filteredFinancialItems = useMemo(() => currencyFinancialItems.filter((entry) =>
    (financeType === "todos" || entry.type === financeType) &&
    (financeStatus === "todos" || entry.status === financeStatus)
  ), [currencyFinancialItems, financeStatus, financeType]);

  const salesMetrics = useMemo(() => getSalesMetrics(data.sales, range, {currency: selectedCurrency, fallbackCurrency: currencyCode}), [currencyCode, data.sales, range, selectedCurrency]);
  const purchaseMetrics = useMemo(() => getPurchaseMetrics(data.purchases, range, {currency: selectedCurrency, fallbackCurrency: currencyCode}), [currencyCode, data.purchases, range, selectedCurrency]);
  const quoteMetrics = useMemo(() => getQuoteMetrics(data.quotes, range, {currency: selectedCurrency, fallbackCurrency: currencyCode}), [currencyCode, data.quotes, range, selectedCurrency]);
  const inventoryMetrics = useMemo(() => getInventoryMetrics(data.inventory, {fallbackCurrency: currencyCode}), [currencyCode, data.inventory]);
  const activeWorks = useMemo(() => data.works.filter((work) => ACTIVE_WORK_STATES.has(work.estado)), [data.works]);
  const urgentWorks = useMemo(() => activeWorks.filter((work) => work.prioridad === "urgente"), [activeWorks]);
  const operationWorks = useMemo(() => projectId === "todos" ? data.works : data.works.filter((work) => work.id === projectId), [data.works, projectId]);
  const operationActiveWorks = useMemo(() => operationWorks.filter((work) => ACTIVE_WORK_STATES.has(work.estado)), [operationWorks]);
  const operationUrgentWorks = useMemo(() => operationActiveWorks.filter((work) => work.prioridad === "urgente"), [operationActiveWorks]);
  const operationWorkCounts = useMemo(() => operationWorks.reduce((counts, work) => ({...counts, [work.estado]: (counts[work.estado] || 0) + 1}), {}), [operationWorks]);
  const workChartItems = WORK_CHART.map(([id, label, color]) => ({id, label, value: operationWorkCounts[id] || 0, color})).filter((item) => item.value > 0);
  const salesTimeline = useMemo(() => aggregateOperationalTimeline(salesMetrics.confirmed, {range, dateField: "fechaVenta", fallbackCurrency: currencyCode}), [currencyCode, range, salesMetrics.confirmed]);

  const filteredOrders = useMemo(() => data.purchaseOrders.filter((order) =>
    isDateInRange(order.fechaEmision, range) &&
    (selectedCurrency === "todos" || resolveReportCurrency(order, currencyCode) === selectedCurrency) &&
    (providerId === "todos" || text(order.proveedorId || order.proveedorSnapshot?.proveedorId) === providerId) &&
    (!search || text(`${order.numero} ${order.proveedorSnapshot?.razonSocial}`).toLocaleLowerCase("es-CL").includes(search.trim().toLocaleLowerCase("es-CL")))
  ), [currencyCode, data.purchaseOrders, providerId, range, search, selectedCurrency]);
  const filteredReceptions = useMemo(() => data.receptions.filter((reception) =>
    isDateInRange(reception.fechaRecepcion || timestampDateKey(reception.creadoEn), range) &&
    (providerId === "todos" || text(reception.proveedorId) === providerId)
  ), [data.receptions, providerId, range]);
  const openOrders = useMemo(() => filteredOrders.filter((order) => order.estado === "emitida"), [filteredOrders]);
  const pendingReceptionOrders = useMemo(() => openOrders.filter((order) => getOrderReceptionStatus(order, data.receptions) !== "recibida_total"), [data.receptions, openOrders]);
  const pendingReceptionDrafts = useMemo(() => filteredReceptions.filter((entry) => entry.estado === "borrador"), [filteredReceptions]);
  const standalonePendingReceptionDrafts = useMemo(() => {
    const pendingOrderIds = new Set(pendingReceptionOrders.map((order) => text(order.id || order.ordenCompraId)));
    return pendingReceptionDrafts.filter((entry) => !entry.ordenCompraId || !pendingOrderIds.has(text(entry.ordenCompraId)));
  }, [pendingReceptionDrafts, pendingReceptionOrders]);
  const overviewPendingReceptionOrders = useMemo(() => data.purchaseOrders.filter((order) =>
    order.estado === "emitida" &&
    isDateInRange(order.fechaEmision, range) &&
    (selectedCurrency === "todos" || resolveReportCurrency(order, currencyCode) === selectedCurrency) &&
    getOrderReceptionStatus(order, data.receptions) !== "recibida_total"
  ), [currencyCode, data.purchaseOrders, data.receptions, range, selectedCurrency]);

  const providerOptions = useMemo(() => uniqueOptions([
    ...data.purchases.map((item) => ({id: item.proveedorId || item.proveedorSnapshot?.proveedorId, label: item.proveedorSnapshot?.razonSocial})),
    ...data.purchaseOrders.map((item) => ({id: item.proveedorId || item.proveedorSnapshot?.proveedorId, label: item.proveedorSnapshot?.razonSocial})),
    ...data.inventoryAcquisitions.map((item) => ({id: item.providerId, label: item.providerName})),
  ], "id", "label"), [data.inventoryAcquisitions, data.purchaseOrders, data.purchases]);
  const projectOptions = useMemo(() => uniqueOptions(data.works.map((work) => ({id: work.id, label: [work.numero, work.titulo].filter(Boolean).join(" · ")})), "id", "label"), [data.works]);
  const userOptions = useMemo(() => uniqueOptions([...data.inventoryMovements, ...data.workCosts, ...data.inventoryAcquisitions].map((entry) => ({id: entry.userId, label: entry.userName || entry.userId})), "id", "label"), [data.inventoryAcquisitions, data.inventoryMovements, data.workCosts]);
  const currencyOptions = useMemo(() => [...new Set([
    currencyCode,
    ...data.sales.map((item) => resolveReportCurrency(item, currencyCode)),
    ...data.purchases.map((item) => resolveReportCurrency(item, currencyCode)),
    ...data.purchaseOrders.map((item) => resolveReportCurrency(item, currencyCode)),
    ...data.quotes.map((item) => resolveReportCurrency(item, currencyCode)),
    ...data.inventoryMovements.map((item) => item.currency),
    ...data.inventoryAcquisitions.map((item) => item.currency),
    ...data.workCosts.map((item) => item.currency),
    ...financial.items.map((item) => resolveReportCurrency(item, currencyCode)),
  ].filter(Boolean))].sort(), [currencyCode, data, financial.items]);

  const financialByCurrency = useMemo(() => {
    const currencies = [...new Set(filteredFinancialItems.map((entry) => resolveReportCurrency(entry, currencyCode)))].sort();
    return currencies.map((currency) => {
      const items = filteredFinancialItems.filter((entry) => resolveReportCurrency(entry, currencyCode) === currency);
      return {currency, items, summary: getFinancialSummary(items)};
    });
  }, [currencyCode, filteredFinancialItems]);
  const overviewFinancialByCurrency = useMemo(() => {
    const currencies = [...new Set(currencyFinancialItems.map((entry) => resolveReportCurrency(entry, currencyCode)))].sort();
    return currencies.map((currency) => {
      const items = currencyFinancialItems.filter((entry) => resolveReportCurrency(entry, currencyCode) === currency);
      return {currency, items, summary: getFinancialSummary(items)};
    });
  }, [currencyCode, currencyFinancialItems]);
  const financialViews = useMemo(() => financialByCurrency.map((group) => ({...group, timeline: aggregateFinancialTimeline(group.items, range)})), [financialByCurrency, range]);
  const projectBalances = useMemo(() => data.projectBalances.filter((entry) =>
    (projectId === "todos" || entry.id === projectId) &&
    (selectedCurrency === "todos" || entry.balance?.moneda === selectedCurrency)
  ), [data.projectBalances, projectId, selectedCurrency]);
  const commercialSalesMetrics = useMemo(() => getSalesMetrics(filteredSales, range, {currency: selectedCurrency, fallbackCurrency: currencyCode}), [currencyCode, filteredSales, range, selectedCurrency]);
  const commercialQuoteMetrics = useMemo(() => getQuoteMetrics(filteredQuotes, range, {currency: selectedCurrency, fallbackCurrency: currencyCode}), [currencyCode, filteredQuotes, range, selectedCurrency]);
  const supplyPurchaseMetrics = useMemo(() => getPurchaseMetrics(filteredPurchases, range, {currency: selectedCurrency, fallbackCurrency: currencyCode}), [currencyCode, filteredPurchases, range, selectedCurrency]);
  const commercialSalesTimeline = useMemo(() => aggregateOperationalTimeline(commercialSalesMetrics.confirmed, {range, dateField: "fechaVenta", fallbackCurrency: currencyCode}), [commercialSalesMetrics.confirmed, currencyCode, range]);
  const supplyPurchaseTimeline = useMemo(() => aggregateOperationalTimeline(supplyPurchaseMetrics.confirmed, {range, dateField: "fechaCompra", fallbackCurrency: currencyCode}), [currencyCode, range, supplyPurchaseMetrics.confirmed]);
  const commercialQuoteChartItems = QUOTE_CHART.map(([id, label, color]) => ({id, label, value: commercialQuoteMetrics.counts[id], color})).filter((item) => item.value > 0);
  const utilizedProviders = useMemo(() => new Set(supplyPurchaseMetrics.confirmed.map((purchase) => text(purchase.proveedorId || purchase.proveedorSnapshot?.proveedorId)).filter(Boolean)).size, [supplyPurchaseMetrics.confirmed]);
  const projectMaterials = useMemo(() => {
    const grouped = new Map();
    filteredMovements.filter((entry) => ["SALIDA_PROYECTO", "DEVOLUCION_PROYECTO"].includes(entry.type)).forEach((entry) => {
      const current = grouped.get(entry.currency) || {currency: entry.currency, total: 0, count: 0};
      current.total += Number(entry.totalCost || 0) * (entry.type === "DEVOLUCION_PROYECTO" ? -1 : 1);
      current.count += 1;
      grouped.set(entry.currency, current);
    });
    return [...grouped.values()].sort((left, right) => left.currency.localeCompare(right.currency));
  }, [filteredMovements]);

  const hasBusinessActivity = Boolean(
    data.sales.length || data.purchases.length || data.purchaseOrders.length || data.receptions.length ||
    data.quotes.length || data.inventory.length || data.inventoryMovements.length || data.inventoryAcquisitions.length ||
    data.works.length || data.workCosts.length || financial.items.length
  );
  const hasOverviewActivity = Boolean(
    salesMetrics.count || purchaseMetrics.count || activeWorks.length || quoteMetrics.count ||
    inventoryMetrics.lowStockProducts.length || overviewPendingReceptionOrders.length
  );
  const hasCommercialActivity = Boolean(filteredSales.length || filteredQuotes.length);
  const hasOperationActivity = Boolean(
    operationWorks.length || inventoryMetrics.activeProducts.length || filteredMovements.length || filteredWorkCosts.length
  );
  const hasSupplyActivity = Boolean(
    filteredPurchases.length || filteredOrders.length || filteredReceptions.length || filteredAcquisitions.length
  );
  const emptyActions = [
    can(BUSINESS_PERMISSIONS.WORKS_MANAGE) && {label: "Crear trabajo", route: "/trabajos", icon: BriefcaseBusiness},
    can(BUSINESS_PERMISSIONS.INVENTORY_WRITE) && {label: "Agregar inventario", route: "/inventario", icon: Boxes},
    can(BUSINESS_PERMISSIONS.CLIENTS_WRITE) && {label: "Crear cliente", route: "/clientes", state: {openCreateClient: true}, icon: UsersRound},
    can(BUSINESS_PERMISSIONS.QUOTES_WRITE) && {label: "Crear cotización", route: "/cotizaciones/nueva", icon: ReceiptText},
    can(BUSINESS_PERMISSIONS.FINANCE_WRITE) && {label: "Registrar movimiento", route: "/finanzas", icon: WalletCards},
    can(BUSINESS_PERMISSIONS.SALES_READ) && {label: "Ver ventas", route: "/ventas", icon: ArrowDownLeft},
    can(BUSINESS_PERMISSIONS.INVENTORY_READ) && {label: "Ver inventario", route: "/inventario", icon: Boxes},
    can(BUSINESS_PERMISSIONS.QUOTES_READ) && {label: "Ver cotizaciones", route: "/cotizaciones", icon: ReceiptText},
    can(BUSINESS_PERMISSIONS.PURCHASES_READ) && {label: "Ver compras", route: "/compras", icon: ShoppingCart},
  ].filter(Boolean).filter((action, index, actions) => actions.findIndex((candidate) => candidate.route === action.route) === index).slice(0, 4);

  const routePermission = (route) => ({
    "/inventario": BUSINESS_PERMISSIONS.INVENTORY_READ,
    "/trabajos": BUSINESS_PERMISSIONS.WORKS_READ,
    "/recepciones": BUSINESS_PERMISSIONS.PURCHASES_READ,
    "/cotizaciones": BUSINESS_PERMISSIONS.QUOTES_READ,
  })[route];
  const overviewAttention = [
    inventoryMetrics.lowStockProducts.length > 0 && {id: "stock", title: `${inventoryMetrics.lowStockProducts.length} productos requieren reposición`, meta: "Stock igual o inferior al mínimo", tone: "warning", route: "/inventario"},
    urgentWorks.length > 0 && {id: "works", title: `${urgentWorks.length} trabajos urgentes activos`, meta: urgentWorks.slice(0, 2).map((work) => work.numero || work.titulo).join(" · "), tone: "danger", route: "/trabajos"},
    overviewPendingReceptionOrders.length > 0 && {id: "receptions", title: `${overviewPendingReceptionOrders.length} órdenes pendientes de recepción`, meta: "Revisa su avance de abastecimiento", tone: "warning", route: "/recepciones"},
    quoteMetrics.counts.vencida > 0 && {id: "quotes", title: `${quoteMetrics.counts.vencida} cotizaciones vencidas`, meta: "Cotizaciones del período seleccionado", tone: "warning", route: "/cotizaciones"},
  ].filter(Boolean).filter((item) => !item.route || can(routePermission(item.route)));

  const commercialActivity = useMemo(() => [
    ...filteredSales.map((sale) => ({id: `sale-${sale.id}`, title: `${sale.numero || "Venta"} · ${sale.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}`, meta: `${formatDate(sale.fechaVenta)} · ${getSaleStatusLabel(sale.estado)} · ${formatMoney(sale.total, resolveReportCurrency(sale, currencyCode))}`, route: `/ventas/${sale.id}`, date: sale.fechaVenta})),
    ...filteredQuotes.map((quote) => ({id: `quote-${quote.id}`, title: `${quote.numero || "Cotización"} · ${quote.clienteNombre || "Sin cliente"}`, meta: `${formatDate(quote.fecha)} · ${getQuoteStatusLabel(quote.estado)} · ${formatMoney(quote.total, resolveReportCurrency(quote, currencyCode))}`, route: "/cotizaciones", date: quote.fecha})),
  ].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 6), [currencyCode, filteredQuotes, filteredSales]);
  const operationAttention = [
    ...operationUrgentWorks.slice(0, 3).map((work) => ({id: `work-${work.id}`, title: `${work.numero || "Trabajo"} · ${work.titulo}`, meta: `${getWorkPriorityLabel(work.prioridad)} · ${getWorkStatusLabel(work.estado)}`, tone: "danger", route: "/trabajos"})),
    ...inventoryMetrics.lowStockProducts.slice(0, 3).map((item) => ({id: `item-${item.id}`, title: item.nombre || "Producto sin nombre", meta: `Stock ${Number(item.stock || 0).toLocaleString("es-CL")} · mínimo ${Number(item.stockMinimo || 0).toLocaleString("es-CL")}`, tone: "warning", route: "/inventario"})),
  ].filter((item) => can(routePermission(item.route))).slice(0, 5);
  const recentMovements = filteredMovements.slice(0, 5).map((entry) => {
    const target = entry.sourceType === "recepcion"
      ? {route: `/recepciones/${entry.sourceId}`, permission: BUSINESS_PERMISSIONS.PURCHASES_READ}
      : entry.sourceType === "compra"
        ? {route: `/compras/${entry.sourceId}`, permission: BUSINESS_PERMISSIONS.PURCHASES_READ}
        : entry.sourceType === "venta"
          ? {route: `/ventas/${entry.sourceId}`, permission: BUSINESS_PERMISSIONS.SALES_READ}
          : entry.sourceType === "proyecto"
            ? {route: "/trabajos", permission: BUSINESS_PERMISSIONS.WORKS_READ}
            : null;
    return {
      id: entry.id,
      title: entry.productName,
      meta: `${formatDate(entry.date)} · ${entry.direction === "ENTRADA" ? "Entrada" : entry.direction === "SALIDA" ? "Salida" : "Movimiento"} de ${entry.quantity.toLocaleString("es-CL")} ${entry.unit}`,
      route: target && can(target.permission) ? target.route : "",
    };
  });
  const supplyAttention = [
    ...pendingReceptionOrders.slice(0, 3).map((order) => ({id: `order-${order.id}`, title: `${order.numero || "Orden"} pendiente de recepción`, meta: order.proveedorSnapshot?.razonSocial || "Proveedor no informado", tone: "warning", route: `/ordenes-compra/${order.id}`})),
    ...standalonePendingReceptionDrafts.slice(0, 2).map((entry) => ({id: `reception-${entry.id}`, title: `${entry.numero || "Recepción"} por confirmar`, meta: entry.proveedorSnapshot?.razonSocial || "Proveedor no informado", tone: "warning", route: `/recepciones/${entry.id}`})),
  ].slice(0, 5);

  const activeFilterCount = {
    overview: 0,
    commercial: [search, saleStatus !== "todos", quoteStatus !== "todos"].filter(Boolean).length,
    operations: [movementType !== "todos", sourceType !== "todos", providerId !== "todos", projectId !== "todos", userId !== "todos", costKind !== "todos"].filter(Boolean).length,
    supply: [search, purchaseStatus !== "todos", providerId !== "todos"].filter(Boolean).length,
    finances: [financeType !== "todos", financeStatus !== "todos"].filter(Boolean).length,
  }[activeTab];

  const handleExport = () => {
    const csv = buildReportCsv(activeTab, {
      sales: activeTab === "overview" ? salesMetrics : filteredSales,
      purchases: activeTab === "overview" ? purchaseMetrics : filteredPurchases,
      quotes: activeTab === "overview" ? quoteMetrics : filteredQuotes,
      inventory: inventoryMetrics,
      financial: activeTab === "overview" ? overviewFinancialByCurrency : financialByCurrency,
      purchaseOrders: filteredOrders,
      receptions: filteredReceptions,
      acquisitions: filteredAcquisitions,
      movements: filteredMovements,
      costs: filteredWorkCosts,
      balances: canViewProfitability ? projectBalances : [],
      items: filteredFinancialItems,
      fallbackCurrency: currencyCode,
    });
    downloadCsv(csv, `reportes-${activeTab}-${range.start}-${range.end}.csv`);
  };

  const renderAdvancedFilters = () => {
    if (activeTab === "commercial") return <>
      <Field label="Buscar"><input className="erp-control" value={search} placeholder="Número o cliente" onChange={(event) => setParam("q", event.target.value)} /></Field>
      <Field label="Estado de venta"><select className="erp-control" value={saleStatus} onChange={(event) => setParam("saleStatus", event.target.value === "todos" ? "" : event.target.value)}>{DOCUMENT_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Estado de cotización"><select className="erp-control" value={quoteStatus} onChange={(event) => setParam("quoteStatus", event.target.value === "todos" ? "" : event.target.value)}>{QUOTE_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    </>;
    if (activeTab === "operations") return <>
      <Field label="Movimiento"><select className="erp-control" value={movementType} onChange={(event) => setParam("movement", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Entradas y salidas</option><option value="ENTRADA">Entradas</option><option value="SALIDA">Salidas</option></select></Field>
      <Field label="Origen"><select className="erp-control" value={sourceType} onChange={(event) => setParam("source", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todos los orígenes</option><option value="recepcion">Recepción</option><option value="compra">Compra</option><option value="venta">Venta</option><option value="proyecto">Trabajo</option><option value="ajuste">Ajuste</option></select></Field>
      <Field label="Trabajo"><select className="erp-control" value={projectId} onChange={(event) => setParam("project", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todos</option>{projectOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label="Proveedor"><select className="erp-control" value={providerId} onChange={(event) => setParam("provider", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todos</option>{providerOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label="Usuario"><select className="erp-control" value={userId} onChange={(event) => setParam("user", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todos</option>{userOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label="Costo"><select className="erp-control" value={costKind} onChange={(event) => setParam("cost", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Gastos y HH</option><option value="GASTO">Gastos</option><option value="HH">Horas hombre</option></select></Field>
    </>;
    if (activeTab === "supply") return <>
      <Field label="Buscar"><input className="erp-control" value={search} placeholder="Número o proveedor" onChange={(event) => setParam("q", event.target.value)} /></Field>
      <Field label="Estado de compra"><select className="erp-control" value={purchaseStatus} onChange={(event) => setParam("purchaseStatus", event.target.value === "todos" ? "" : event.target.value)}>{DOCUMENT_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Proveedor"><select className="erp-control" value={providerId} onChange={(event) => setParam("provider", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todos</option>{providerOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
    </>;
    if (activeTab === "finances") return <>
      <Field label="Tipo"><select className="erp-control" value={financeType} onChange={(event) => setParam("financeType", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Ingresos y egresos</option><option value="income">Ingresos</option><option value="expense">Egresos</option></select></Field>
      <Field label="Estado"><select className="erp-control" value={financeStatus} onChange={(event) => setParam("financeStatus", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Pagados y pendientes</option><option value="paid">Pagados</option><option value="pending">Pendientes</option></select></Field>
    </>;
    return null;
  };

  return <section className="erp-page statistics-page reports-page reports-v3">
    <div className="reports-v3-heading"><div className="erp-page-intro"><h1>Reportes</h1><p>Vista general de tu negocio.</p></div></div>
    <div className="reports-v3-toolbar no-print">
      <FinancialPeriodSelector period={period} customStart={customStart} customEnd={customEnd} options={REPORT_PERIOD_OPTIONS} onPeriodChange={(value) => setParam("period", value === "month" ? "" : value)} onCustomStartChange={(value) => setParam("from", value)} onCustomEndChange={(value) => setParam("to", value)} idPrefix="reports-period" />
      <Field label="Moneda"><select className="erp-control" value={selectedCurrency} onChange={(event) => setParam("currency", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Todas, separadas</option>{currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></Field>
      <Button variant="secondary" icon={Download} disabled={reportState.loading || financial.loading} onClick={handleExport}>Exportar</Button>
      <p className="reports-v3-currency-help">Los montos se muestran separados por moneda. No se realizan conversiones.</p>
    </div>
    <div className="financial-tabs statistics-tabs reports-v3-tabs" role="tablist" aria-label="Secciones de Reportes">
      {TABS.map(([id, label]) => <button className={`financial-tab${activeTab === id ? " financial-tab--active" : ""}`} role="tab" aria-selected={activeTab === id} type="button" key={id} onClick={() => { setParam("tab", id === "overview" ? "" : id); setAdvancedOpen(false); }}>{label}</button>)}
    </div>
    {activeTab !== "overview" && (reportState.loading || financial.loading || hasBusinessActivity) && <AdvancedFilters activeCount={activeFilterCount} open={advancedOpen} onToggle={() => setAdvancedOpen((value) => !value)}>{renderAdvancedFilters()}</AdvancedFilters>}
    {reportState.loading && <div className="financial-inline-loading" role="status">Preparando la vista ejecutiva...</div>}
    {reportState.error && <div className="financial-feedback financial-feedback--error" role="alert">{reportState.error}</div>}
    {financial.error && <div className="financial-feedback financial-feedback--error" role="alert">{financial.error}</div>}

    {!reportState.loading && !financial.loading && !reportState.error && !financial.error && !hasBusinessActivity && <EmptyBusiness actions={emptyActions} completion={can(BUSINESS_PERMISSIONS.COMPANY_WRITE) ? businessCompletionStatus : null} navigate={navigate} />}

    {!reportState.loading && !reportState.error && hasBusinessActivity && activeTab === "overview" && !hasOverviewActivity && <ViewEmpty icon={BriefcaseBusiness} title="No hay actividad operativa en este período" description="Elige otro período o comienza a registrar ventas, compras, trabajos y cotizaciones." navigate={navigate} />}

    {!reportState.loading && !reportState.error && hasBusinessActivity && hasOverviewActivity && activeTab === "overview" && <div className="report-section-stack">
      <section className="financial-metric-grid report-four-metrics">
        <ReportMetricCard icon={ArrowDownLeft} label="Ventas confirmadas" value={formatCurrencyGroups(salesMetrics.totalsByCurrency, "total", "Sin ventas")} note={`${salesMetrics.count} documentos`} tone="income" />
        <ReportMetricCard icon={ArrowUpRight} label="Compras confirmadas" value={formatCurrencyGroups(purchaseMetrics.totalsByCurrency, "total", "Sin compras")} note={`${purchaseMetrics.count} documentos`} tone="expense" />
        <ReportMetricCard icon={BriefcaseBusiness} label="Proyectos activos" value={activeWorks.length.toLocaleString("es-CL")} note="Pendientes, en progreso o espera" />
        <ReportMetricCard icon={ReceiptText} label="Cotizaciones abiertas" value={(quoteMetrics.counts.borrador + quoteMetrics.counts.emitida).toLocaleString("es-CL")} note="Pendientes y emitidas del período" tone="pending" />
      </section>
      <div className="reports-v3-main-grid">
        <Panel title="Evolución comercial" description="Ventas confirmadas del período, separadas por moneda." action={can(BUSINESS_PERMISSIONS.SALES_READ) ? <ModuleLink onClick={() => navigate("/ventas")}>Ver ventas</ModuleLink> : null}><OperationalTimeline items={salesTimeline} emptyMessage="Aún no hay ventas confirmadas en este período." /></Panel>
        <Panel title="Requiere atención" description="Situaciones actuales que conviene revisar."><DecisionList items={overviewAttention} empty="No hay alertas operativas por revisar." navigate={navigate} /></Panel>
      </div>
    </div>}

    {!reportState.loading && !reportState.error && hasBusinessActivity && activeTab === "commercial" && !hasCommercialActivity && <ViewEmpty icon={ReceiptText} title="No hay actividad comercial para estos filtros" description="Prueba otro período o revisa las cotizaciones y ventas del negocio." action={can(BUSINESS_PERMISSIONS.QUOTES_READ) ? {label: "Ver cotizaciones", route: "/cotizaciones"} : can(BUSINESS_PERMISSIONS.SALES_READ) ? {label: "Ver ventas", route: "/ventas"} : null} navigate={navigate} />}

    {!reportState.loading && !reportState.error && hasBusinessActivity && hasCommercialActivity && activeTab === "commercial" && <div className="report-section-stack">
      <section className="financial-metric-grid report-four-metrics">
        <ReportMetricCard icon={ArrowDownLeft} label="Ventas confirmadas" value={formatCurrencyGroups(commercialSalesMetrics.totalsByCurrency, "total", "Sin ventas")} note={`${commercialSalesMetrics.count} documentos`} tone="income" />
        <ReportMetricCard icon={ReceiptText} label="Cotizaciones" value={commercialQuoteMetrics.count.toLocaleString("es-CL")} note="Fechadas en el período" />
        <ReportMetricCard label="Por responder" value={(commercialQuoteMetrics.counts.borrador + commercialQuoteMetrics.counts.emitida).toLocaleString("es-CL")} note="Pendientes y emitidas" tone="pending" />
        <ReportMetricCard label="Conversión" value={commercialQuoteMetrics.conversion == null ? "Sin base" : formatPercent(commercialQuoteMetrics.conversion)} note="Aceptadas sobre decisiones cerradas" />
      </section>
      <div className="reports-v3-main-grid">
        <Panel title="Ventas en el tiempo" description="Sólo ventas confirmadas; cada moneda se presenta por separado." action={can(BUSINESS_PERMISSIONS.SALES_READ) ? <ModuleLink onClick={() => navigate("/ventas")}>Ver ventas</ModuleLink> : null}><OperationalTimeline items={commercialSalesTimeline} emptyMessage="Aún no hay ventas confirmadas en este período." /></Panel>
        <Panel title="Estado de cotizaciones" description="Situación actual de las cotizaciones del período." action={can(BUSINESS_PERMISSIONS.QUOTES_READ) ? <ModuleLink onClick={() => navigate("/cotizaciones")}>Ver cotizaciones</ModuleLink> : null}>{commercialQuoteChartItems.length ? <DashboardDonutChart ariaLabel="Estado actual de cotizaciones" items={commercialQuoteChartItems} /> : <p className="reports-v3-compact-empty">Aún no hay cotizaciones en este período.</p>}</Panel>
      </div>
      <Panel title="Actividad comercial reciente" description="Últimos documentos que coinciden con los filtros." action={can(BUSINESS_PERMISSIONS.CLIENTS_READ) ? <ModuleLink onClick={() => navigate("/clientes")}>Ver clientes</ModuleLink> : null}><DecisionList items={commercialActivity} empty="No hay actividad comercial para estos filtros." navigate={navigate} /></Panel>
    </div>}

    {!reportState.loading && !reportState.error && hasBusinessActivity && activeTab === "operations" && !hasOperationActivity && <ViewEmpty icon={Boxes} title="No hay actividad operativa para estos filtros" description="Prueba otros filtros o revisa los módulos de trabajos e inventario." action={can(BUSINESS_PERMISSIONS.WORKS_READ) ? {label: "Ver trabajos", route: "/trabajos"} : can(BUSINESS_PERMISSIONS.INVENTORY_READ) ? {label: "Ver inventario", route: "/inventario"} : null} navigate={navigate} />}

    {!reportState.loading && !reportState.error && hasBusinessActivity && hasOperationActivity && activeTab === "operations" && <div className="report-section-stack">
      <section className="financial-metric-grid report-four-metrics">
        <ReportMetricCard icon={BriefcaseBusiness} label="Proyectos activos" value={operationActiveWorks.length.toLocaleString("es-CL")} note="Pendientes, en progreso o espera" />
        <ReportMetricCard icon={AlertTriangle} label="Trabajos urgentes" value={operationUrgentWorks.length.toLocaleString("es-CL")} note="Urgentes aún activos" tone="pending" />
        <ReportMetricCard icon={Boxes} label="Stock bajo" value={inventoryMetrics.lowStockProducts.length.toLocaleString("es-CL")} note={`${inventoryMetrics.activeProducts.length} productos activos`} tone="pending" />
        <ReportMetricCard icon={PackageCheck} label="Materiales consumidos" value={formatCurrencyGroups(projectMaterials, "total", "Sin consumos")} note={`${projectMaterials.reduce((sum, group) => sum + group.count, 0)} movimientos de materiales`} />
      </section>
      <div className="reports-v3-main-grid">
        <Panel title="Estado de proyectos" description="Distribución actual de proyectos y trabajos." action={can(BUSINESS_PERMISSIONS.WORKS_READ) ? <ModuleLink onClick={() => navigate("/trabajos")}>Ver trabajos</ModuleLink> : null}>{workChartItems.length ? <DashboardDonutChart ariaLabel="Estado actual de proyectos" items={workChartItems} /> : <p className="reports-v3-compact-empty">Aún no hay proyectos registrados.</p>}</Panel>
        <Panel title="Atención operativa" description="Trabajos urgentes y productos que requieren reposición."><DecisionList items={operationAttention} empty="No hay alertas operativas por revisar." navigate={navigate} /></Panel>
      </div>
      <div className="reports-v3-main-grid">
        <Panel title="Movimientos recientes de inventario" description="Últimas entradas y salidas que coinciden con los filtros." action={can(BUSINESS_PERMISSIONS.INVENTORY_READ) ? <ModuleLink onClick={() => navigate("/inventario")}>Ver inventario</ModuleLink> : null}><DecisionList items={recentMovements} empty="No hay movimientos de inventario para estos filtros." navigate={navigate} /></Panel>
        {canViewProfitability && <Panel title="Resultado por proyecto" description="Calculado con los registros confirmados de cada trabajo."><div className="reports-v3-balance-list">{projectBalances.slice(0, 4).map((entry) => <div key={entry.id}><span><strong>{entry.numero || entry.titulo}</strong><small>{entry.balance?.estado === "INCONSISTENTE_MONEDA" ? "Monedas incompatibles" : entry.balance?.estado === "PARCIAL_SIN_VENTA" ? "Sin venta confirmada" : "Balance completo"}</small></span><strong>{entry.balance?.estado === "COMPLETO" ? formatMoney(entry.balance.resultado, entry.balance.moneda) : "—"}</strong></div>)}{!projectBalances.length && <p className="reports-v3-compact-empty">Aún no hay balances de proyecto disponibles.</p>}</div></Panel>}
      </div>
    </div>}

    {!reportState.loading && !reportState.error && hasBusinessActivity && activeTab === "supply" && !hasSupplyActivity && <ViewEmpty icon={ShoppingCart} title="No hay actividad de abastecimiento para estos filtros" description="Prueba otro período o revisa órdenes, recepciones y compras." action={can(BUSINESS_PERMISSIONS.PURCHASES_READ) ? {label: "Ver órdenes de compra", route: "/ordenes-compra"} : null} navigate={navigate} />}

    {!reportState.loading && !reportState.error && hasBusinessActivity && hasSupplyActivity && activeTab === "supply" && <div className="report-section-stack">
      <section className="financial-metric-grid report-four-metrics">
        <ReportMetricCard icon={ShoppingCart} label="Compras confirmadas" value={formatCurrencyGroups(supplyPurchaseMetrics.totalsByCurrency, "total", "Sin compras")} note={`${supplyPurchaseMetrics.count} documentos`} tone="expense" />
        <ReportMetricCard icon={ReceiptText} label="Órdenes abiertas" value={openOrders.length.toLocaleString("es-CL")} note="Órdenes emitidas del período" />
        <ReportMetricCard icon={PackageCheck} label="Recepciones pendientes" value={(pendingReceptionOrders.length + standalonePendingReceptionDrafts.length).toLocaleString("es-CL")} note="Órdenes por recibir y borradores" tone="pending" />
        <ReportMetricCard icon={UsersRound} label="Proveedores utilizados" value={utilizedProviders.toLocaleString("es-CL")} note="En compras confirmadas" />
      </section>
      <div className="reports-v3-main-grid">
        <Panel title="Compras en el tiempo" description="Compras confirmadas del período, separadas por moneda." action={can(BUSINESS_PERMISSIONS.PURCHASES_READ) ? <ModuleLink onClick={() => navigate("/compras")}>Ver compras</ModuleLink> : null}><OperationalTimeline items={supplyPurchaseTimeline} emptyMessage="Aún no hay compras confirmadas en este período." /></Panel>
        <Panel title="Actividad pendiente" description="Órdenes y recepciones que requieren seguimiento." action={can(BUSINESS_PERMISSIONS.PURCHASES_READ) ? <div className="reports-v3-panel-actions"><ModuleLink onClick={() => navigate("/ordenes-compra")}>Ver órdenes</ModuleLink><ModuleLink onClick={() => navigate("/recepciones")}>Ver recepciones</ModuleLink></div> : null}><DecisionList items={supplyAttention} empty="No hay órdenes ni recepciones pendientes." navigate={navigate} /></Panel>
      </div>
      <Panel title="Adquisiciones recientes" description="Últimas entradas con costo y proveedor trazables." action={can(BUSINESS_PERMISSIONS.PROVIDERS_READ) ? <ModuleLink onClick={() => navigate("/proveedores")}>Ver proveedores</ModuleLink> : null}><DecisionList items={filteredAcquisitions.slice(0, 5).map((entry) => ({id: entry.id, title: entry.productName, meta: `${formatDate(entry.date)} · ${entry.providerName || "Proveedor no informado"} · ${formatMoney(entry.totalCost, entry.currency)}`, route: acquisitionRoute(entry)}))} empty="No hay adquisiciones para estos filtros." navigate={navigate} /></Panel>
    </div>}

    {hasBusinessActivity && activeTab === "finances" && !financial.loading && <div className="report-section-stack">
      {!filteredFinancialItems.length ? <section className="erp-panel reports-v3-section-empty"><WalletCards size={25} /><div><h2>Aún no hay movimientos financieros registrados para este período.</h2><p>Cuando registres ingresos o egresos, aquí verás su estado y evolución.</p></div>{can(BUSINESS_PERMISSIONS.FINANCE_READ) && <Button variant="secondary" onClick={() => navigate("/finanzas")}>Ir a Finanzas</Button>}</section> : <>
        <div className="reports-v3-view-actions"><ModuleLink onClick={() => navigate("/finanzas")}>Ver movimientos financieros</ModuleLink></div>
        <section className="financial-metric-grid report-four-metrics">
          <ReportMetricCard icon={ArrowDownLeft} label="Ingresos pagados" value={formatFinancialGroups(financialByCurrency, "paidIncome")} tone="income" />
          <ReportMetricCard icon={ArrowUpRight} label="Egresos pagados" value={formatFinancialGroups(financialByCurrency, "paidExpense")} tone="expense" />
          <ReportMetricCard icon={ReceiptText} label="Por cobrar" value={formatFinancialGroups(financialByCurrency, "receivable")} tone="pending" />
          <ReportMetricCard icon={WalletCards} label="Por pagar" value={formatFinancialGroups(financialByCurrency, "payable")} tone="pending" />
        </section>
        <div className="reports-v3-finance-grid">{financialViews.map((view) => <Panel key={view.currency} title={`Evolución financiera · ${view.currency}`} description="Movimientos pagados registrados en Finanzas." action={<span className="reports-v3-net-result">Resultado: {formatMoney(view.summary.netResult, view.currency)}</span>}><FinancialTimelineChart currency={view.currency} data={view.timeline} /></Panel>)}</div>
      </>}
    </div>}
  </section>;
}

export default StatisticsPage;
