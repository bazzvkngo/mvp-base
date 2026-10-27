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
  normalizeReportCurrency,
  resolveReportCurrency,
} from "../domain/reportModel.mjs";
import {
  BUSINESS_PERMISSIONS,
  canAccessBusinessPath,
  hasBusinessPermission,
} from "../domain/rbac.mjs";
import {
  currentMonthKey,
  getMonthRange,
  normalizeMonthKey,
  shiftMonthKey,
} from "../domain/reportMonthlySummary.mjs";
import {useOperationalNetProfit} from "../features/reports/OperationalNetProfitBreakdown";
import {useReportProfitabilityV4} from "../features/reports/ReportProfitabilityV4Section";
import ReportsNav, {DEFAULT_REPORT_VIEW_ID, normalizeReportView} from "../features/reports/ReportsNav";
import ReportsComprasView from "../features/reports/views/ReportsComprasView";
import ReportsGananciasView from "../features/reports/views/ReportsGananciasView";
import ReportsMonthlySummary from "../features/reports/views/ReportsMonthlySummary";
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
  const periodRange = useMemo(() => getFinancialPeriodRange(period, {start: customStart, end: customEnd}), [customEnd, customStart, period]);
  // Resumen mensual (SPEC 025 etapa 3): el mes elegido y el anterior salen de
  // las ventas y compras que ya se cargan completas. Solo la ganancia necesita
  // ventas de ambos meses, así que el mismo hook de rentabilidad recibe una
  // ventana de dos meses mientras el Resumen está activo; los balances de
  // proyecto no se vuelven a pedir.
  const isSummary = vista === DEFAULT_REPORT_VIEW_ID;
  const monthKey = normalizeMonthKey(searchParams.get("mes"), today);
  const monthRange = useMemo(() => getMonthRange(monthKey), [monthKey]);
  const previousMonthRange = useMemo(() => getMonthRange(shiftMonthKey(monthKey, -1)), [monthKey]);
  const range = isSummary ? monthRange : periodRange;
  const profitFetchRange = useMemo(
    () => isSummary ? {...monthRange, start: previousMonthRange.start} : periodRange,
    [isSummary, monthRange, periodRange, previousMonthRange.start]
  );
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
  // Monedas presentes en todo lo cargado (no solo en el período). Con una sola,
  // el selector "Moneda" y su nota sobran; si la URL ya filtra por una moneda,
  // el selector se mantiene para poder volver a "Todas".
  const loadedCurrencies = useMemo(() => new Set([
    ...data.sales.map((entry) => resolveReportCurrency(entry, currencyCode)),
    ...data.purchases.map((entry) => resolveReportCurrency(entry, currencyCode)),
    ...data.projectBalances.map((entry) => normalizeReportCurrency(entry.balance?.moneda, currencyCode)),
  ]), [currencyCode, data]);
  const showCurrencyControls = loadedCurrencies.size > 1 || selectedCurrency !== "todos";
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
  const profitabilityV4 = useReportProfitabilityV4({businessId, range: profitFetchRange, role});
  const operationalProfit = useOperationalNetProfit(profitabilityV4, range);
  const previousOperationalProfit = useOperationalNetProfit(profitabilityV4, previousMonthRange);
  const previousSummary = useMemo(
    () => isSummary ? getSimplifiedReportSummary({sales: data.sales, purchases: data.purchases, projectBalances: data.projectBalances, range: previousMonthRange, currency: selectedCurrency, fallbackCurrency: currencyCode, canViewProfitability}) : null,
    [canViewProfitability, currencyCode, data, isSummary, previousMonthRange, selectedCurrency]
  );
  const canRegisterSale = hasBusinessPermission(role, BUSINESS_PERMISSIONS.SALES_WRITE);
  const canRegisterPurchase = hasBusinessPermission(role, BUSINESS_PERMISSIONS.PURCHASES_WRITE);

  const goToView = (nextVista) => updateSearchParams(searchParams, setSearchParams, {vista: nextVista === DEFAULT_REPORT_VIEW_ID ? "" : nextVista});
  const changeMonth = (nextMonth) => updateSearchParams(searchParams, setSearchParams, {mes: nextMonth === currentMonthKey(today) ? "" : nextMonth});
  // Los detalles se abren con el mismo mes del resumen como período, para que
  // sus cifras coincidan con las tarjetas.
  const openDetail = (nextVista) => updateSearchParams(searchParams, setSearchParams, {vista: nextVista, period: "custom", from: monthRange.start, to: monthRange.end, mes: ""});

  if (!businessId) return <section className="erp-page reports-simple"><header className="erp-page-header"><div className="erp-page-intro"><span className="reports-simple-eyebrow">Reportes</span><h1>Centro de reportes</h1><p>{REPORTS_SUBTITLE}</p></div></header><div className="erp-card reports-simple-state">Selecciona un negocio para consultar sus reportes.</div></section>;

  return <section className="erp-page reports-simple">
    <header className="erp-page-header reports-simple-header">
      <div className="erp-page-intro"><span className="reports-simple-eyebrow">Reportes</span><h1>Centro de reportes</h1><p>{REPORTS_SUBTITLE}</p></div>
      <div className="reports-simple-toolbar">
        {!isSummary && <FinancialPeriodSelector customEnd={customEnd} customStart={customStart} idPrefix="reports-period" onCustomEndChange={(value) => updateSearchParams(searchParams, setSearchParams, {to: value})} onCustomStartChange={(value) => updateSearchParams(searchParams, setSearchParams, {from: value})} onPeriodChange={(value) => updateSearchParams(searchParams, setSearchParams, {period: value})} options={REPORT_PERIOD_OPTIONS} period={period} />}
        {showCurrencyControls && <label className="erp-field reports-simple-currency"><span className="erp-field__label">Moneda</span><select className="erp-control" value={selectedCurrency} onChange={(event) => updateSearchParams(searchParams, setSearchParams, {currency: event.target.value})}><option value="todos">Todas, separadas</option>{availableCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>}
      </div>
    </header>

    <ReportsNav active={vista} onSelect={goToView} permissions={viewPermissions} />
    {showCurrencyControls && <p className="reports-simple-help">Las monedas se muestran por separado y no se convierten.</p>}

    {error && <div className="erp-card reports-simple-state reports-simple-state--error" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={16} /> Reintentar</Button></div>}
    {loading && !error && <LoadingState variant="section" label="Cargando reportes..." />}

    {!loading && !error && <>
      {isSummary && <ReportsMonthlySummary canRegisterPurchase={canRegisterPurchase} canRegisterSale={canRegisterSale} canViewProfitability={canViewProfitability} canViewPurchases={viewPermissions.canViewPurchases} canViewSales={viewPermissions.canViewSales} currency={selectedCurrency} links={links} month={monthKey} onMonthChange={changeMonth} onNavigate={navigate} onOpenDetail={openDetail} onRetryProfit={profitabilityV4.reload} previousProfit={previousOperationalProfit} previousSummary={previousSummary} profit={operationalProfit} projects={profitabilityV4.projects} summary={summary} todayKey={today} />}
      {vista === "ventas" && <ReportsVentasView canOpenSales={links.sales} fallbackCurrency={currencyCode} navigate={navigate} salesTimeline={salesTimeline} summary={summary} topSalesClients={topSalesClients} topSalesProducts={topSalesProducts} />}
      {vista === "compras" && <ReportsComprasView canOpenPurchases={links.purchases} chartGroups={chartGroups} fallbackCurrency={currencyCode} navigate={navigate} purchaseTimeline={purchaseTimeline} summary={summary} topPurchaseProducts={topPurchaseProducts} topPurchaseSuppliers={topPurchaseSuppliers} />}
      {vista === "ganancias" && <ReportsGananciasView currency={selectedCurrency} currentMonthKey={currentMonthKey(today)} links={links} navigate={navigate} operationalProfit={operationalProfit} profitabilityV4={profitabilityV4} range={range} />}
    </>}
  </section>;
}

export default StatisticsPage;
