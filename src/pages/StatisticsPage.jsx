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
  getInventoryCategoryDistribution,
  getInventoryMetrics,
  getInventoryTopValueProducts,
  getProjectProfitabilitySummary,
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
import {useReportProfitabilityV4} from "../features/reports/ReportProfitabilityV4Section";
import ReportsNav, {normalizeReportView} from "../features/reports/ReportsNav";
import ReportsComprasView from "../features/reports/views/ReportsComprasView";
import ReportsGananciasView from "../features/reports/views/ReportsGananciasView";
import ReportsInventarioView from "../features/reports/views/ReportsInventarioView";
import ReportsProyectosView from "../features/reports/views/ReportsProyectosView";
import ReportsResumenView from "../features/reports/views/ReportsResumenView";
import ReportsVentasView from "../features/reports/views/ReportsVentasView";
import {getInventoryItems} from "../services/inventoryService";
import {loadSimplifiedReportData} from "../services/reportService";
import {formatMoney} from "../utils/formatters";

const VALID_PERIODS = new Set(REPORT_PERIOD_OPTIONS.map((option) => option.id));
const EMPTY_DATA = Object.freeze({projectBalances: [], purchases: [], sales: []});
const EMPTY_INVENTORY_METRICS = Object.freeze({activeCount: 0, lowStockCount: 0, coverage: 0, byCurrency: []});

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
  const vista = normalizeReportView(searchParams.get("vista"));
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
  const canViewProfitability = hasBusinessPermission(role, BUSINESS_PERMISSIONS.PROFITABILITY_READ);
  const canViewInventory = hasBusinessPermission(role, BUSINESS_PERMISSIONS.INVENTORY_READ);

  useEffect(() => {
    let active = true;
    if (!businessId) { setData(EMPTY_DATA); setLoading(false); setError(""); return () => { active = false; }; }
    setLoading(true); setError("");
    loadSimplifiedReportData(businessId, {role}).then((next) => { if (active) setData(next); }).catch((loadError) => { if (active) setError(loadError?.message || "No fue posible cargar los reportes."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, reloadKey, role]);

  // Inventario se consulta aparte y sólo la primera vez que esta vista se
  // activa (no en cada carga de /reportes): getInventoryItems trae el
  // catálogo completo sin paginar, y la mayoría de las visitas a Reportes no
  // necesita ese costo.
  const [inventoryItems, setInventoryItems] = useState(null);
  const [inventoryStatus, setInventoryStatus] = useState("idle");
  const [inventoryError, setInventoryError] = useState("");
  const [inventoryReloadKey, setInventoryReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    if (!businessId || !canViewInventory) return () => { active = false; };
    if (vista !== "inventario") return () => { active = false; };
    if (inventoryItems !== null && inventoryReloadKey === 0) return () => { active = false; };
    setInventoryStatus("loading");
    setInventoryError("");
    getInventoryItems(businessId)
      .then((items) => { if (active) { setInventoryItems(items); setInventoryStatus("ready"); } })
      .catch((loadError) => { if (active) { setInventoryStatus("error"); setInventoryError(loadError?.message || "No fue posible cargar el inventario."); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, canViewInventory, vista, inventoryReloadKey]);

  const summary = useMemo(() => getSimplifiedReportSummary({sales: data.sales, purchases: data.purchases, projectBalances: data.projectBalances, range, currency: selectedCurrency, fallbackCurrency: currencyCode, canViewProfitability}), [canViewProfitability, currencyCode, data, range, selectedCurrency]);
  const profitability = useMemo(() => getProjectProfitabilitySummary(data.projectBalances, {currency: selectedCurrency, fallbackCurrency: currencyCode, accessible: canViewProfitability}), [canViewProfitability, currencyCode, data.projectBalances, selectedCurrency]);
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
  const inventoryMetrics = useMemo(() => {
    if (!inventoryItems) return EMPTY_INVENTORY_METRICS;
    const metrics = getInventoryMetrics(inventoryItems, {fallbackCurrency: currencyCode});
    return {
      activeCount: metrics.activeProducts.length,
      lowStockCount: metrics.lowStockProducts.length,
      coverage: metrics.coverage,
      byCurrency: metrics.inventoryValuesByCurrency.map((group) => ({currency: group.currency, total: group.total})),
    };
  }, [currencyCode, inventoryItems]);
  const inventoryTopValue = useMemo(() => inventoryItems ? getInventoryTopValueProducts(inventoryItems, {fallbackCurrency: currencyCode}) : [], [currencyCode, inventoryItems]);
  const inventoryCategories = useMemo(() => inventoryItems ? getInventoryCategoryDistribution(inventoryItems, {fallbackCurrency: currencyCode}) : [], [currencyCode, inventoryItems]);
  const links = {purchases: canAccessBusinessPath(role, "/compras"), sales: canAccessBusinessPath(role, "/ventas"), works: canAccessBusinessPath(role, "/trabajos")};
  const profitabilityV4 = useReportProfitabilityV4({businessId, range, role});

  const goToView = (nextVista) => updateSearchParams(searchParams, setSearchParams, {vista: nextVista === "resumen" ? "" : nextVista});

  const inventoryCard = (() => {
    if (!canViewInventory) return {amount: "Acceso restringido", detail: "", restricted: true, canOpen: false};
    if (inventoryStatus !== "ready") return {amount: "—", detail: "Consulta el detalle en Inventario para calcularlo.", restricted: false, canOpen: true};
    const total = inventoryMetrics.byCurrency[0];
    if (!total) return {amount: "—", detail: "Sin productos con costo válido para valorizar.", restricted: false, canOpen: true};
    return {amount: formatMoney(total.total, total.currency), detail: inventoryMetrics.byCurrency.length > 1 ? "Ver desglose por moneda" : "Costo × stock de productos activos", restricted: false, canOpen: true};
  })();

  if (!businessId) return <section className="erp-page reports-simple"><header className="erp-page-header"><div className="erp-page-intro"><span className="reports-simple-eyebrow">Reportes</span><h1>Centro de reportes</h1><p>Consulta ventas, compras, inventario, proyectos y ganancias en un solo lugar.</p></div></header><div className="erp-card reports-simple-state">Selecciona un negocio para consultar sus reportes.</div></section>;

  return <section className="erp-page reports-simple">
    <header className="erp-page-header reports-simple-header">
      <div className="erp-page-intro"><span className="reports-simple-eyebrow">Reportes</span><h1>Centro de reportes</h1><p>Consulta ventas, compras, inventario, proyectos y ganancias en un solo lugar.</p></div>
      <div className="reports-simple-toolbar">
        <FinancialPeriodSelector customEnd={customEnd} customStart={customStart} idPrefix="reports-period" onCustomEndChange={(value) => updateSearchParams(searchParams, setSearchParams, {to: value})} onCustomStartChange={(value) => updateSearchParams(searchParams, setSearchParams, {from: value})} onPeriodChange={(value) => updateSearchParams(searchParams, setSearchParams, {period: value})} options={REPORT_PERIOD_OPTIONS} period={period} />
        <label className="erp-field reports-simple-currency"><span className="erp-field__label">Moneda</span><select className="erp-control" value={selectedCurrency} onChange={(event) => updateSearchParams(searchParams, setSearchParams, {currency: event.target.value})}><option value="todos">Todas, separadas</option>{availableCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
      </div>
    </header>

    <ReportsNav active={vista} onSelect={goToView} />
    <p className="reports-simple-help">Las monedas se muestran por separado y no se convierten.</p>

    {error && <div className="erp-card reports-simple-state reports-simple-state--error" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={16} /> Reintentar</Button></div>}
    {loading && !error && <LoadingState variant="section" label="Cargando reportes..." />}

    {!loading && !error && <>
      {vista === "resumen" && <ReportsResumenView canViewProfitability={canViewProfitability} chartGroups={chartGroups} inventoryCard={inventoryCard} links={links} onSelectView={goToView} profitabilityV4={profitabilityV4} summary={summary} />}
      {vista === "ventas" && <ReportsVentasView canOpenSales={links.sales} navigate={navigate} profitabilityV4={profitabilityV4} salesTimeline={salesTimeline} summary={summary} topSalesClients={topSalesClients} topSalesProducts={topSalesProducts} />}
      {vista === "compras" && <ReportsComprasView canOpenPurchases={links.purchases} navigate={navigate} purchaseTimeline={purchaseTimeline} summary={summary} topPurchaseProducts={topPurchaseProducts} topPurchaseSuppliers={topPurchaseSuppliers} />}
      {vista === "inventario" && <ReportsInventarioView categories={inventoryCategories} error={inventoryError} metrics={inventoryMetrics} onRetry={() => setInventoryReloadKey((value) => value + 1)} status={canViewInventory ? inventoryStatus : "no_permission"} topValue={inventoryTopValue} />}
      {vista === "proyectos" && <ReportsProyectosView canViewProfitability={canViewProfitability} links={links} navigate={navigate} profitability={profitability} summary={summary} />}
      {vista === "ganancias" && <ReportsGananciasView profitabilityV4={profitabilityV4} />}
    </>}
  </section>;
}

export default StatisticsPage;
