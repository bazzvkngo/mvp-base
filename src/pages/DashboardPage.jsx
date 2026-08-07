import React, {useEffect, useMemo, useState} from "react";
import {
  BarChart3,
  Boxes,
  ClipboardCheck,
  FilePlus2,
  Landmark,
  PackagePlus,
  ReceiptText,
  ShoppingCart,
  Truck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import {useNavigate} from "react-router-dom";
import DashboardDonutChart from "../components/DashboardDonutChart";
import FinancialMetricCard from "../components/finance/FinancialMetricCard";
import FinancialPeriodSelector from "../components/finance/FinancialPeriodSelector";
import OperationalComparisonChart from "../components/reports/OperationalComparisonChart";
import Button from "../components/ui/Button";
import {
  getFinancialPeriodRange,
  getSantiagoDateKey,
} from "../domain/financialMovement.mjs";
import {
  REPORT_PERIOD_OPTIONS,
  aggregateOperationalTimeline,
  combineOperationalTimelines,
  getInventoryMetrics,
  getPurchaseMetrics,
  getQuoteMetrics,
  getRecentOperationalActivity,
  getSalesMetrics,
} from "../domain/reportModel.mjs";
import useFinancialMovements from "../hooks/useFinancialMovements";
import {
  getCompanyProfile,
  getCompanyProfileCompletion,
} from "../services/companyService";
import {loadReportData} from "../services/reportService";
import {formatCLP, formatDate, formatPercent} from "../utils/formatters";

const QUOTE_CHART = [
  ["borrador", "Borrador", "#94a3b8"],
  ["emitida", "Emitida", "#38bdf8"],
  ["aceptada", "Aceptada", "#0f766e"],
  ["rechazada", "Rechazada", "#dc2626"],
  ["vencida", "Vencida", "#d97706"],
  ["archivada", "Archivada", "#64748b"],
];

const EMPTY_REPORT_DATA = {
  sales: [],
  purchases: [],
  quotes: [],
  inventory: [],
  inventoryMovements: [],
};

function DashboardCountCard({icon, label, note, tone = "neutral", value}) {
  return (
    <article className={`financial-metric-card financial-metric-card--${tone}`}>
      <div className="financial-metric-card__heading">
        <span className="financial-metric-card__icon" aria-hidden="true">
          {React.createElement(icon, {size: 19})}
        </span>
        <span className="financial-metric-card__label">{label}</span>
      </div>
      <strong className="financial-metric-card__value">{value}</strong>
      <span className="financial-metric-card__note">{note}</span>
    </article>
  );
}

function QuickActions({canManage, navigate}) {
  const actions = canManage
    ? [
        {label: "Nueva venta", route: "/ventas/nueva", icon: ShoppingCart, primary: true},
        {label: "Nueva cotización", route: "/cotizaciones/nueva", icon: FilePlus2},
        {label: "Nueva compra", route: "/compras/nueva", icon: Truck},
        {label: "Nueva orden de compra", route: "/ordenes-compra/nueva", icon: ClipboardCheck},
        {label: "Nuevo ítem", route: "/inventario", icon: PackagePlus},
      ]
    : [
        {label: "Ver ventas", route: "/ventas", icon: ShoppingCart, primary: true},
        {label: "Ver compras", route: "/compras", icon: Truck},
        {label: "Ver inventario", route: "/inventario", icon: Boxes},
        {label: "Ver Reportes", route: "/reportes", icon: BarChart3},
      ];

  return (
    <section className="erp-panel dashboard-v2-actions" aria-labelledby="dashboard-actions-title">
      <div>
        <h2 id="dashboard-actions-title" className="erp-panel-title">Acciones rápidas</h2>
        <p>{canManage ? "Atajos para registrar la operación diaria." : "Accesos de consulta disponibles para tu rol."}</p>
      </div>
      <div className="dashboard-v2-actions__buttons">
        {actions.map((action) => (
          <Button
            key={action.route}
            icon={action.icon}
            variant={action.primary ? undefined : "secondary"}
            onClick={() => navigate(action.route)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

function RecentActivity({items, navigate}) {
  return (
    <section className="erp-panel dashboard-v2-secondary-panel" aria-labelledby="dashboard-activity-title">
      <div className="erp-panel-header dashboard-v2-panel-header">
        <div>
          <h2 id="dashboard-activity-title" className="erp-panel-title">Actividad comercial reciente</h2>
          <p>Fecha comercial de ventas y compras confirmadas.</p>
        </div>
      </div>
      {!items.length ? (
        <div className="dashboard-v2-empty">No hay ventas ni compras confirmadas en este periodo.</div>
      ) : (
        <div className="dashboard-activity-v2-list">
          {items.map((item) => (
            <article className="dashboard-activity-v2-row" key={`${item.type}-${item.id}`}>
              <span className={`dashboard-activity-v2-type dashboard-activity-v2-type--${item.type}`}>{item.label}</span>
              <div className="dashboard-activity-v2-copy">
                <strong>{item.number}</strong>
                <span>{formatDate(item.date)} · {item.counterparty}</span>
              </div>
              <strong className="dashboard-activity-v2-amount">{formatCLP(item.amount)}</strong>
              <button type="button" onClick={() => navigate(item.route)}>Ver</button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function RequiredAttention({companyProfilePending, lowStockProducts, navigate}) {
  const hasAlerts = companyProfilePending || lowStockProducts.length > 0;
  return (
    <section className="erp-panel dashboard-v2-secondary-panel" aria-labelledby="dashboard-attention-title">
      <div className="erp-panel-header dashboard-v2-panel-header">
        <div>
          <h2 id="dashboard-attention-title" className="erp-panel-title">Atención requerida</h2>
          <p>Información accionable del negocio actual.</p>
        </div>
      </div>
      {!hasAlerts ? (
        <div className="dashboard-v2-clean-state"><span aria-hidden="true">✓</span><div><strong>Todo en orden</strong><p>No hay alertas de stock ni datos empresariales pendientes.</p></div></div>
      ) : (
        <div className="dashboard-attention-list">
          {lowStockProducts.slice(0, 5).map((item) => (
            <div className="dashboard-attention-item" key={item.id}>
              <span className="dashboard-attention-item__icon"><Boxes size={17} /></span>
              <div><strong>{item.nombre}</strong><p>Stock {Number(item.stock)} · Mínimo {Number(item.stockMinimo)}</p></div>
              <button type="button" onClick={() => navigate("/inventario")}>Revisar</button>
            </div>
          ))}
          {companyProfilePending && (
            <div className="dashboard-attention-item">
              <span className="dashboard-attention-item__icon"><Landmark size={17} /></span>
              <div><strong>Información de empresa incompleta</strong><p>Completa los datos comerciales y de contacto.</p></div>
              <button type="button" onClick={() => navigate("/empresa")}>Completar</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function DashboardPage({businessId, role}) {
  const navigate = useNavigate();
  const today = getSantiagoDateKey();
  const [period, setPeriod] = useState("month");
  const [customPeriod, setCustomPeriod] = useState(() => {
    const current = getFinancialPeriodRange("month", {}, today);
    return {start: current.start, end: current.end};
  });
  const [reportState, setReportState] = useState({
    data: EMPTY_REPORT_DATA,
    loading: true,
    error: "",
  });
  const [companyProfilePending, setCompanyProfilePending] = useState(false);
  const range = useMemo(
    () => getFinancialPeriodRange(period, customPeriod, today),
    [customPeriod, period, today]
  );
  const financial = useFinancialMovements(businessId, range);
  const canManage = role === "OWNER" || role === "ADMIN";

  useEffect(() => {
    let active = true;
    setReportState((current) => ({...current, loading: true, error: ""}));
    loadReportData(businessId)
      .then((data) => active && setReportState({data, loading: false, error: ""}))
      .catch((error) => active && setReportState((current) => ({
        ...current,
        loading: false,
        error: error?.message || "No pudimos cargar el resumen operacional.",
      })));
    return () => { active = false; };
  }, [businessId]);

  useEffect(() => {
    let active = true;
    setCompanyProfilePending(false);
    getCompanyProfile(businessId)
      .then((profile) => {
        if (!active) return;
        const completion = getCompanyProfileCompletion(profile);
        setCompanyProfilePending(!completion.minimumComplete || !completion.recommendedComplete);
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.error("No se pudo revisar el perfil de empresa:", error);
      });
    return () => { active = false; };
  }, [businessId]);

  const {sales, purchases, quotes, inventory} = reportState.data;
  const salesMetrics = useMemo(() => getSalesMetrics(sales, range), [range, sales]);
  const purchaseMetrics = useMemo(() => getPurchaseMetrics(purchases, range), [purchases, range]);
  const quoteMetrics = useMemo(() => getQuoteMetrics(quotes, range), [quotes, range]);
  const inventoryMetrics = useMemo(() => getInventoryMetrics(inventory), [inventory]);
  const recentActivity = useMemo(
    () => getRecentOperationalActivity(sales, purchases, range, 5),
    [purchases, range, sales]
  );
  const salesTimeline = useMemo(
    () => aggregateOperationalTimeline(salesMetrics.confirmed, {range, dateField: "fechaVenta"}),
    [range, salesMetrics.confirmed]
  );
  const purchaseTimeline = useMemo(
    () => aggregateOperationalTimeline(purchaseMetrics.confirmed, {range, dateField: "fechaCompra"}),
    [purchaseMetrics.confirmed, range]
  );
  const operationalTimeline = useMemo(
    () => combineOperationalTimelines(salesTimeline, purchaseTimeline),
    [purchaseTimeline, salesTimeline]
  );
  const quoteChartItems = QUOTE_CHART.map(([id, label, color]) => ({
    label,
    color,
    value: quoteMetrics.counts[id],
  }));
  const reportParams = new URLSearchParams();
  if (period !== "month") reportParams.set("period", period);
  if (period === "custom") {
    reportParams.set("from", range.start);
    reportParams.set("to", range.end);
  }
  const reportQuery = reportParams.toString();
  const reportsRoute = reportQuery ? `/reportes?${reportQuery}` : "/reportes";

  return (
    <section className="erp-page dashboard-page dashboard-v2">
      <header className="dashboard-v2-hero">
        <div>
          <span className="dashboard-v2-kicker">Resumen</span>
          <h2>Estado operacional del negocio</h2>
          <p>Ventas, compras, cotizaciones, inventario y movimientos financieros registrados.</p>
        </div>
        <Button variant="secondary" icon={BarChart3} onClick={() => navigate(reportsRoute)}>Ver Reportes</Button>
      </header>

      <div className="financial-period-bar dashboard-v2-period">
        <FinancialPeriodSelector
          period={period}
          customStart={customPeriod.start}
          customEnd={customPeriod.end}
          options={REPORT_PERIOD_OPTIONS}
          onPeriodChange={setPeriod}
          onCustomStartChange={(start) => setCustomPeriod((current) => ({...current, start}))}
          onCustomEndChange={(end) => setCustomPeriod((current) => ({...current, end}))}
          idPrefix="dashboard-period"
        />
        <span className="financial-period-bar__caption">{formatDate(range.start)} al {formatDate(range.end)} · America/Santiago</span>
      </div>

      {reportState.error && <div className="financial-feedback financial-feedback--error" role="alert">{reportState.error}</div>}
      {reportState.loading && <div className="financial-inline-loading" role="status">Cargando estado operacional del negocio activo...</div>}

      <QuickActions canManage={canManage} navigate={navigate} />

      {!reportState.loading && !reportState.error && (
        <>
          <section className="financial-metric-grid dashboard-v2-metrics" aria-label="Indicadores principales">
            <FinancialMetricCard icon={ShoppingCart} label="Total vendido" value={salesMetrics.total} tone="income" note={`${salesMetrics.count} ventas confirmadas`} />
            <FinancialMetricCard icon={Truck} label="Total comprado" value={purchaseMetrics.total} tone="expense" note={`${purchaseMetrics.count} compras confirmadas`} />
            <DashboardCountCard icon={ReceiptText} label="Cotizaciones" value={quoteMetrics.count.toLocaleString("es-CL")} note={`${quoteMetrics.counts.aceptada} aceptadas · ${quoteMetrics.conversion === null ? "Sin base de conversión" : formatPercent(quoteMetrics.conversion)}`} />
            <DashboardCountCard icon={Boxes} label="Inventario actual" value={inventoryMetrics.activeProducts.length.toLocaleString("es-CL")} tone={inventoryMetrics.lowStockProducts.length ? "pending" : "neutral"} note={`Estado actual · ${inventoryMetrics.lowStockProducts.length} productos con stock bajo`} />
            <DashboardCountCard icon={WalletCards} label="Saldo financiero registrado" value={financial.loading || financial.error ? "—" : formatCLP(financial.summary.netResult)} tone="net" note={financial.error ? "Finanzas no disponible" : financial.loading ? "Actualizando movimientos registrados" : `Por cobrar ${formatCLP(financial.summary.receivable)} · Por pagar ${formatCLP(financial.summary.payable)}`} />
          </section>

          <div className="dashboard-v2-financial-note">
            <span>La tarjeta financiera corresponde a movimientos financieros registrados; no representa utilidad, margen ni ventas menos compras.</span>
            <button type="button" onClick={() => navigate("/finanzas")}>Ver Finanzas</button>
          </div>

          <div className="dashboard-v2-visual-grid">
            <section className="erp-panel financial-chart-panel">
              <div className="financial-chart-panel__header"><h2>Evolución operacional</h2><p>Ventas y compras confirmadas según su fecha comercial.</p></div>
              <OperationalComparisonChart items={operationalTimeline} />
            </section>
            <section className="erp-panel financial-chart-panel">
              <div className="financial-chart-panel__header"><h2>Cotizaciones por estado actual</h2><p>Documentos fechados dentro del periodo seleccionado. No son ingresos.</p></div>
              <DashboardDonutChart ariaLabel="Cotizaciones por estado actual en el periodo" emptyMessage="Sin cotizaciones en este periodo" items={quoteChartItems} />
            </section>
          </div>

          <div className="dashboard-v2-secondary-grid">
            <RecentActivity items={recentActivity} navigate={navigate} />
            <RequiredAttention companyProfilePending={companyProfilePending} lowStockProducts={inventoryMetrics.lowStockProducts} navigate={navigate} />
          </div>
        </>
      )}
    </section>
  );
}
