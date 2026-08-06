import React, { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Boxes, Landmark, ReceiptText, TrendingUp } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import DashboardDonutChart from "../components/DashboardDonutChart";
import {
  FinancialCategoryChart,
  FinancialStatusChart,
  FinancialTimelineChart,
} from "../components/finance/FinancialCharts";
import FinancialMetricCard from "../components/finance/FinancialMetricCard";
import FinancialPeriodSelector from "../components/finance/FinancialPeriodSelector";
import {
  aggregateFinancialByCategory,
  aggregateFinancialTimeline,
  compareFinancialSummaries,
  getFinancialPeriodRange,
  getPreviousFinancialPeriod,
  getSantiagoDateKey,
} from "../domain/financialMovement.mjs";
import useFinancialMovements from "../hooks/useFinancialMovements";
import { subscribeToInventory } from "../services/inventoryService";
import { getQuotes } from "../services/quoteService";
import { formatCLP, formatDate, formatPercent } from "../utils/formatters";

const PERIOD_OPTIONS = [
  { id: "week", label: "Esta semana" },
  { id: "month", label: "Este mes" },
  { id: "three_months", label: "Últimos 3 meses" },
  { id: "six_months", label: "Últimos 6 meses" },
  { id: "year", label: "Este año" },
  { id: "custom", label: "Periodo personalizado" },
];
const VALID_PERIODS = new Set(PERIOD_OPTIONS.map((option) => option.id));
const TABS = ["general", "finances", "quotes", "inventory"];

const QUOTE_STATES = [
  { id: "borrador", label: "Borrador", color: "#94a3b8" },
  { id: "emitida", label: "Emitida", color: "#38bdf8" },
  { id: "aceptada", label: "Aceptada", color: "#0f766e" },
  { id: "rechazada", label: "Rechazada", color: "#dc2626" },
  { id: "vencida", label: "Vencida", color: "#d97706" },
  { id: "archivada", label: "Archivada", color: "#64748b" },
];

function ComparisonCard({ comparison, icon, label, tone }) {
  const hasBase = comparison.percent !== null;
  const direction = comparison.absolute > 0 ? "+" : "";
  return (
    <article className={`financial-comparison-card financial-comparison-card--${tone}`}>
      <div className="financial-comparison-card__metric">
        <span aria-hidden="true">{React.createElement(icon, { size: 18 })}</span>
        <span>{label}</span>
      </div>
      <strong>{formatCLP(comparison.current)}</strong>
      <dl>
        <div><dt>Periodo anterior</dt><dd>{formatCLP(comparison.previous)}</dd></div>
        <div><dt>Variación</dt><dd>{direction}{formatCLP(comparison.absolute)}</dd></div>
      </dl>
      <span className="financial-comparison-card__percent">
        {hasBase ? `${comparison.percent > 0 ? "+" : ""}${formatPercent(comparison.percent)}` : "Sin base de comparación"}
      </span>
    </article>
  );
}

function getQuoteSummary(quotes) {
  const counts = Object.fromEntries(QUOTE_STATES.map((state) => [state.id, 0]));
  quotes.forEach((quote) => {
    const status = quote.estado || "borrador";
    if (counts[status] !== undefined) counts[status] += 1;
  });
  const decided = counts.aceptada + counts.rechazada;
  return {
    counts,
    accepted: counts.aceptada,
    active: counts.borrador + counts.emitida,
    conversion: decided > 0 ? (counts.aceptada / decided) * 100 : null,
  };
}

function StatisticsPage({ businessId }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getSantiagoDateKey();
  const period = VALID_PERIODS.has(searchParams.get("period")) ? searchParams.get("period") : "month";
  const defaultRange = getFinancialPeriodRange("month", {}, today);
  const customStart = searchParams.get("from") || defaultRange.start;
  const customEnd = searchParams.get("to") || defaultRange.end;
  const activeTab = TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "general";
  const range = useMemo(
    () => getFinancialPeriodRange(period, { start: customStart, end: customEnd }, today),
    [customEnd, customStart, period, today]
  );
  const previousRange = useMemo(() => getPreviousFinancialPeriod(range), [range]);
  const current = useFinancialMovements(businessId, range);
  const previous = useFinancialMovements(businessId, previousRange);
  const [quotes, setQuotes] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [operationsError, setOperationsError] = useState("");

  useEffect(() => {
    if (!businessId) return undefined;
    let active = true;
    setOperationsLoading(true);
    setOperationsError("");
    getQuotes(businessId)
      .then((items) => active && setQuotes(items))
      .catch(() => active && setOperationsError("No pudimos cargar las cotizaciones para el análisis."))
      .finally(() => active && setOperationsLoading(false));
    const unsubscribe = subscribeToInventory(
      businessId,
      (items) => setInventory(items),
      () => setOperationsError("No pudimos cargar el inventario para el análisis.")
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [businessId]);

  const updateParam = (name, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
  };

  const comparison = useMemo(
    () => compareFinancialSummaries(current.summary, previous.summary),
    [current.summary, previous.summary]
  );
  const paidMovements = useMemo(
    () => current.items.filter((movement) => movement.status === "paid"),
    [current.items]
  );
  const timeline = useMemo(
    () => aggregateFinancialTimeline(current.items, range),
    [current.items, range]
  );
  const incomeCategories = useMemo(
    () => aggregateFinancialByCategory(paidMovements, "income"),
    [paidMovements]
  );
  const expenseCategories = useMemo(
    () => aggregateFinancialByCategory(paidMovements, "expense"),
    [paidMovements]
  );

  const periodQuotes = useMemo(
    () => quotes.filter((quote) => quote.fecha >= range.start && quote.fecha <= range.end),
    [quotes, range.end, range.start]
  );
  const quoteSummary = useMemo(() => getQuoteSummary(periodQuotes), [periodQuotes]);
  const quoteChartItems = QUOTE_STATES.map((state) => ({
    label: state.label,
    value: quoteSummary.counts[state.id],
    color: state.color,
  }));
  const activeProducts = useMemo(
    () => inventory.filter((item) => item.tipoItem === "producto" && (item.estado || "activo") === "activo"),
    [inventory]
  );
  const lowStockProducts = useMemo(
    () => activeProducts.filter((item) => Number(item.stock || 0) <= Number(item.stockMinimo || 0)),
    [activeProducts]
  );
  const hasReliableInventoryValue =
    activeProducts.length > 0 &&
    activeProducts.every(
      (item) => Number.isFinite(Number(item.costoBase)) && Number.isFinite(Number(item.stock)) && Number(item.costoBase) >= 0
    );
  const inventoryValue = hasReliableInventoryValue
    ? activeProducts.reduce((sum, item) => sum + Number(item.costoBase) * Number(item.stock), 0)
    : null;
  const loading = current.loading || previous.loading;
  const error = current.error || previous.error || operationsError;

  return (
    <section className="erp-page statistics-page">
      <div className="erp-page-intro">
        <p>Analiza tendencias reales del negocio. Las cotizaciones no se cuentan como ingresos ni ventas.</p>
      </div>

      <div className="financial-period-bar">
        <FinancialPeriodSelector
          period={period}
          customStart={customStart}
          customEnd={customEnd}
          options={PERIOD_OPTIONS}
          onPeriodChange={(value) => updateParam("period", value === "month" ? "" : value)}
          onCustomStartChange={(value) => updateParam("from", value)}
          onCustomEndChange={(value) => updateParam("to", value)}
          idPrefix="statistics-period"
        />
        <span className="financial-period-bar__caption">Actual: {formatDate(range.start)} al {formatDate(range.end)} · Comparación: {formatDate(previousRange.start)} al {formatDate(previousRange.end)}</span>
      </div>

      <div className="financial-tabs statistics-tabs" role="tablist" aria-label="Secciones de estadísticas">
        {[
          ["general", "General"],
          ["finances", "Finanzas"],
          ["quotes", "Cotizaciones"],
          ["inventory", "Inventario"],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "financial-tab is-active" : "financial-tab"} onClick={() => updateParam("tab", id === "general" ? "" : id)}>{label}</button>
        ))}
      </div>

      {error && <div className="financial-feedback financial-feedback--error" role="alert">{error}</div>}
      {loading && <div className="financial-inline-loading" role="status">Calculando estadísticas del negocio activo...</div>}

      {!loading && activeTab === "general" && (
        <>
          <section className="financial-comparison-grid" aria-label="Comparación con el periodo anterior">
            <ComparisonCard label="Ingresos pagados" icon={ArrowDownLeft} comparison={comparison.paidIncome} tone="income" />
            <ComparisonCard label="Egresos pagados" icon={ArrowUpRight} comparison={comparison.paidExpense} tone="expense" />
            <ComparisonCard label="Resultado neto" icon={Landmark} comparison={comparison.netResult} tone="net" />
          </section>
          <section className="erp-panel financial-chart-panel">
            <div className="financial-chart-panel__header"><div><h2>Evolución de ingresos y egresos</h2><p>{formatDate(range.start)} al {formatDate(range.end)} · solo movimientos pagados.</p></div></div>
            <FinancialTimelineChart data={timeline} />
          </section>
          <div className="statistics-overview-grid">
            <section className="erp-panel statistics-compact-panel">
              <div><h2>Cotizaciones del periodo</h2><p>No se contabilizan como ingresos.</p></div>
              {operationsLoading ? <p>Cargando...</p> : <><strong>{periodQuotes.length}</strong><span>{quoteSummary.active} vigentes · {quoteSummary.accepted} aceptadas</span></>}
            </section>
            <section className="erp-panel statistics-compact-panel">
              <div><h2>Alertas de inventario</h2><p>Productos activos en o bajo su stock mínimo.</p></div>
              <strong>{lowStockProducts.length}</strong><span>{lowStockProducts.length ? "Requieren revisión" : "Sin alertas de stock"}</span>
            </section>
          </div>
        </>
      )}

      {!loading && activeTab === "finances" && (
        <>
          <section className="financial-metric-grid statistics-financial-grid">
            <FinancialMetricCard icon={ArrowDownLeft} label="Ingresos pagados" value={current.summary.paidIncome} tone="income" />
            <FinancialMetricCard icon={ArrowUpRight} label="Egresos pagados" value={current.summary.paidExpense} tone="expense" />
            <FinancialMetricCard icon={Landmark} label="Resultado neto" value={current.summary.netResult} tone="net" />
            <FinancialMetricCard icon={ReceiptText} label="Pendiente total" value={current.summary.receivable + current.summary.payable} tone="pending" />
          </section>
          <div className="statistics-chart-grid">
            <section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><div><h2>Resultado neto por periodo</h2><p>Ingresos pagados menos egresos pagados.</p></div></div><FinancialTimelineChart data={timeline} mode="net" /></section>
            <section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><div><h2>Pagados y pendientes</h2><p>Composición por monto del periodo.</p></div></div><FinancialStatusChart movements={current.items} /></section>
            <section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><div><h2>Ingresos por categoría</h2><p>Solo ingresos pagados.</p></div></div><FinancialCategoryChart data={incomeCategories} label="Ingresos pagados" /></section>
            <section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><div><h2>Egresos por categoría</h2><p>Solo egresos pagados.</p></div></div><FinancialCategoryChart data={expenseCategories} label="Egresos pagados" /></section>
          </div>
        </>
      )}

      {activeTab === "quotes" && (
        <section className="statistics-module-grid">
          <div className="statistics-module-copy">
            <span className="statistics-module-icon"><TrendingUp size={21} /></span>
            <div><h2>Cotizaciones por estado</h2><p>Se usa la fecha de emisión del documento. Una cotización aceptada sigue sin convertirse automáticamente en ingreso.</p></div>
            <dl className="statistics-definition-list"><div><dt>Total del periodo</dt><dd>{periodQuotes.length}</dd></div><div><dt>Aceptadas</dt><dd>{quoteSummary.accepted}</dd></div><div><dt>Tasa de conversión</dt><dd>{quoteSummary.conversion === null ? "Sin base de comparación" : formatPercent(quoteSummary.conversion)}</dd></div></dl>
          </div>
          <div className="erp-panel"><DashboardDonutChart ariaLabel="Cotizaciones del periodo por estado" emptyMessage="Sin cotizaciones en este periodo" items={quoteChartItems} /></div>
        </section>
      )}

      {activeTab === "inventory" && (
        <section className="statistics-inventory-layout">
          <div className="financial-metric-grid statistics-inventory-metrics">
            <article className="financial-metric-card financial-metric-card--neutral"><div className="financial-metric-card__heading"><span className="financial-metric-card__icon"><Boxes size={19} /></span><span className="financial-metric-card__label">Productos activos</span></div><strong className="financial-metric-card__value">{activeProducts.length}</strong><span className="financial-metric-card__note">Servicios y actividades no se incluyen</span></article>
            <article className="financial-metric-card financial-metric-card--pending"><div className="financial-metric-card__heading"><span className="financial-metric-card__icon"><Boxes size={19} /></span><span className="financial-metric-card__label">Existencias bajas</span></div><strong className="financial-metric-card__value">{lowStockProducts.length}</strong><span className="financial-metric-card__note">Stock actual ≤ stock mínimo</span></article>
            {inventoryValue !== null && <FinancialMetricCard icon={Landmark} label="Valor de inventario" value={inventoryValue} tone="net" note="Costo base × stock actual" />}
          </div>
          <section className="erp-panel">
            <div className="financial-chart-panel__header"><div><h2>Productos con existencias bajas</h2><p>Coincide con las reglas del módulo Inventario.</p></div></div>
            {lowStockProducts.length === 0 ? <div className="financial-chart-empty">No hay alertas de inventario.</div> : (
              <div className="statistics-low-stock-list">{lowStockProducts.slice(0, 10).map((item) => <div key={item.id}><strong>{item.nombre}</strong><span>Stock {Number(item.stock || 0)} · Mínimo {Number(item.stockMinimo || 0)}</span></div>)}</div>
            )}
          </section>
          {!hasReliableInventoryValue && activeProducts.length > 0 && <p className="financial-data-note">El valor de inventario se oculta porque uno o más productos no tienen costo base o stock confiable.</p>}
        </section>
      )}
    </section>
  );
}

export default StatisticsPage;
