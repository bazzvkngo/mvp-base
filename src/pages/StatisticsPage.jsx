import React, {useEffect, useMemo, useState} from "react";
import {RefreshCw} from "lucide-react";
import {useNavigate, useSearchParams} from "react-router-dom";
import FinancialPeriodSelector from "../components/finance/FinancialPeriodSelector";
import Button from "../components/ui/Button";
import LoadingState from "../components/ui/LoadingState";
import {getFinancialPeriodRange, getSantiagoDateKey} from "../domain/financialMovement.mjs";
import {
  REPORT_PERIOD_OPTIONS,
  aggregateOperationalTimeline,
  combineOperationalTimelines,
  getSimplifiedReportSummary,
  getTopPurchaseProducts,
  getTopPurchaseSuppliers,
  getTopSalesClients,
  getTopSalesProducts,
} from "../domain/reportModel.mjs";
import {
  BUSINESS_PERMISSIONS,
  canAccessBusinessPath,
  hasBusinessPermission,
} from "../domain/rbac.mjs";
import {useOperationalNetProfit} from "../features/reports/OperationalNetProfitBreakdown";
import {useReportProfitabilityV4} from "../features/reports/ReportProfitabilityV4Section";
import ReportsNav, {normalizeReportView} from "../features/reports/ReportsNav";
import ReportsComprasView from "../features/reports/views/ReportsComprasView";
import ReportsGananciasView from "../features/reports/views/ReportsGananciasView";
import ReportsRentabilidadView from "../features/reports/views/ReportsRentabilidadView";
import ReportsVentasView from "../features/reports/views/ReportsVentasView";
import {loadSimplifiedReportData} from "../services/reportService";

const VALID_PERIODS = new Set(REPORT_PERIOD_OPTIONS.map((option) => option.id));
const EMPTY_DATA = Object.freeze({projectBalances: [], purchases: [], sales: []});
const REPORTS_SUBTITLE = "Consulta rentabilidad, ventas, compras y ganancias en un solo lugar.";

function updateSearchParams(searchParams, setSearchParams, changes) {
  const next = new URLSearchParams(searchParams);
  Object.entries(changes).forEach(([key, value]) => {
    if (value) next.set(key, value);
    else next.delete(key);
  });
  setSearchParams(next, {replace: true});
}

function StatisticsPage({businessId, currencyCode = "CLP", role = ""}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canViewProfitability = hasBusinessPermission(role, BUSINESS_PERMISSIONS.PROFITABILITY_READ);
  const viewPermissions = {
    canViewProfitability,
    canViewSales: hasBusinessPermission(role, BUSINESS_PERMISSIONS.SALES_READ),
    canViewPurchases: hasBusinessPermission(role, BUSINESS_PERMISSIONS.PURCHASES_READ),
  };
  const vista = normalizeReportView(searchParams.get("vista"), viewPermissions);
  const requestedPeriod = searchParams.get("period") || "month";
  const period = VALID_PERIODS.has(requestedPeriod) ? requestedPeriod : "month";
  const today = getSantiagoDateKey();
  const customStart = searchParams.get("from") || today;
  const customEnd = searchParams.get("to") || today;
  const selectedCurrency = searchParams.get("currency") || "todos";
  const range = useMemo(() => getFinancialPeriodRange(period, {start: customStart, end: customEnd}), [customEnd, customStart, period]);
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(Boolean(businessId));
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    if (!businessId) { setData(EMPTY_DATA); setLoading(false); setError(""); return () => { active = false; }; }
    setLoading(true); setError("");
    loadSimplifiedReportData(businessId, {role}).then((next) => { if (active) setData(next); }).catch((loadError) => { if (active) setError(loadError?.message || "No fue posible cargar los reportes."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, reloadKey, role]);

  const summary = useMemo(() => getSimplifiedReportSummary({sales: data.sales, purchases: data.purchases, projectBalances: data.projectBalances, range, currency: selectedCurrency, fallbackCurrency: currencyCode, canViewProfitability}), [canViewProfitability, currencyCode, data, range, selectedCurrency]);
  const availableCurrencies = useMemo(() => {
    const all = getSimplifiedReportSummary({sales: data.sales, purchases: data.purchases, projectBalances: data.projectBalances, range, fallbackCurrency: currencyCode, canViewProfitability});
    const values = all.currencies.map((entry) => entry.currency);
    if (selectedCurrency !== "todos" && !values.includes(selectedCurrency)) values.push(selectedCurrency);
    return values.sort();
  }, [canViewProfitability, currencyCode, data, range, selectedCurrency]);
  const salesTimeline = useMemo(() => aggregateOperationalTimeline(summary.sales.confirmed, {range, dateField: "fechaVenta", fallbackCurrency: currencyCode}), [currencyCode, range, summary.sales.confirmed]);
  const purchaseTimeline = useMemo(() => aggregateOperationalTimeline(summary.purchases.confirmed, {range, dateField: "fechaCompra", fallbackCurrency: currencyCode}), [currencyCode, range, summary.purchases.confirmed]);
  const operationalTimeline = useMemo(() => combineOperationalTimelines(salesTimeline, purchaseTimeline), [purchaseTimeline, salesTimeline]);
  const chartGroups = summary.currencies.map((group) => ({
    currency: group.currency,
    items: operationalTimeline.filter((item) => item.currency === group.currency),
    purchases: group.purchases.total,
    sales: group.sales.total,
  }));
  const topSalesClients = useMemo(() => getTopSalesClients(summary.sales.confirmed, {fallbackCurrency: currencyCode}), [currencyCode, summary.sales.confirmed]);
  const topSalesProducts = useMemo(() => getTopSalesProducts(summary.sales.confirmed, {fallbackCurrency: currencyCode}), [currencyCode, summary.sales.confirmed]);
  const topPurchaseSuppliers = useMemo(() => getTopPurchaseSuppliers(summary.purchases.confirmed, {fallbackCurrency: currencyCode}), [currencyCode, summary.purchases.confirmed]);
  const topPurchaseProducts = useMemo(() => getTopPurchaseProducts(summary.purchases.confirmed, {fallbackCurrency: currencyCode}), [currencyCode, summary.purchases.confirmed]);
  const links = {purchases: canAccessBusinessPath(role, "/compras"), sales: canAccessBusinessPath(role, "/ventas"), works: canAccessBusinessPath(role, "/trabajos")};
  const profitabilityV4 = useReportProfitabilityV4({businessId, range, role});
  const operationalProfit = useOperationalNetProfit(profitabilityV4, range);

  const goToView = (nextVista) => updateSearchParams(searchParams, setSearchParams, {vista: nextVista === "rentabilidad" ? "" : nextVista});

  if (!businessId) return <section className="erp-page reports-simple"><header className="erp-page-header"><div className="erp-page-intro"><span className="reports-simple-eyebrow">Reportes</span><h1>Centro de reportes</h1><p>{REPORTS_SUBTITLE}</p></div></header><div className="erp-card reports-simple-state">Selecciona un negocio para consultar sus reportes.</div></section>;

  return <section className="erp-page reports-simple">
    <header className="erp-page-header reports-simple-header">
      <div className="erp-page-intro"><span className="reports-simple-eyebrow">Reportes</span><h1>Centro de reportes</h1><p>{REPORTS_SUBTITLE}</p></div>
      <div className="reports-simple-toolbar">
        <FinancialPeriodSelector customEnd={customEnd} customStart={customStart} idPrefix="reports-period" onCustomEndChange={(value) => updateSearchParams(searchParams, setSearchParams, {to: value})} onCustomStartChange={(value) => updateSearchParams(searchParams, setSearchParams, {from: value})} onPeriodChange={(value) => updateSearchParams(searchParams, setSearchParams, {period: value})} options={REPORT_PERIOD_OPTIONS} period={period} />
        <label className="erp-field reports-simple-currency"><span className="erp-field__label">Moneda</span><select className="erp-control" value={selectedCurrency} onChange={(event) => updateSearchParams(searchParams, setSearchParams, {currency: event.target.value})}><option value="todos">Todas, separadas</option>{availableCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
      </div>
    </header>

    <ReportsNav active={vista} onSelect={goToView} permissions={viewPermissions} />
    <p className="reports-simple-help">Las monedas se muestran por separado y no se convierten.</p>

    {error && <div className="erp-card reports-simple-state reports-simple-state--error" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={16} /> Reintentar</Button></div>}
    {loading && !error && <LoadingState variant="section" label="Cargando reportes..." />}

    {!loading && !error && <>
      {vista === "rentabilidad" && <ReportsRentabilidadView canViewProfitability={canViewProfitability} currency={selectedCurrency} links={links} navigate={navigate} onRetry={profitabilityV4.reload} operationalProfit={operationalProfit} />}
      {vista === "ventas" && <ReportsVentasView canOpenSales={links.sales} navigate={navigate} profitabilityV4={profitabilityV4} salesTimeline={salesTimeline} summary={summary} topSalesClients={topSalesClients} topSalesProducts={topSalesProducts} />}
      {vista === "compras" && <ReportsComprasView canOpenPurchases={links.purchases} chartGroups={chartGroups} navigate={navigate} purchaseTimeline={purchaseTimeline} summary={summary} topPurchaseProducts={topPurchaseProducts} topPurchaseSuppliers={topPurchaseSuppliers} />}
      {vista === "ganancias" && <ReportsGananciasView profitabilityV4={profitabilityV4} />}
    </>}
  </section>;
}

export default StatisticsPage;
