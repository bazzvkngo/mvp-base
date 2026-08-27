import React, {useEffect, useMemo, useState} from "react";
import {
  ArrowRight,
  BadgeDollarSign,
  BriefcaseBusiness,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import {useNavigate, useSearchParams} from "react-router-dom";
import FinancialPeriodSelector from "../components/finance/FinancialPeriodSelector";
import OperationalComparisonChart from "../components/reports/OperationalComparisonChart";
import Button from "../components/ui/Button";
import {getFinancialPeriodRange, getSantiagoDateKey} from "../domain/financialMovement.mjs";
import {
  REPORT_PERIOD_OPTIONS,
  aggregateOperationalTimeline,
  combineOperationalTimelines,
  getSimplifiedReportSummary,
} from "../domain/reportModel.mjs";
import {
  BUSINESS_PERMISSIONS,
  canAccessBusinessPath,
  hasBusinessPermission,
} from "../domain/rbac.mjs";
import {loadSimplifiedReportData} from "../services/reportService";
import {formatMoney} from "../utils/formatters";

const VALID_PERIODS = new Set(REPORT_PERIOD_OPTIONS.map((option) => option.id));
const EMPTY_DATA = Object.freeze({projectBalances: [], purchases: [], sales: []});

function updateSearchParams(searchParams, setSearchParams, changes) {
  const next = new URLSearchParams(searchParams);
  Object.entries(changes).forEach(([key, value]) => {
    if (value) next.set(key, value);
    else next.delete(key);
  });
  setSearchParams(next, {replace: true});
}

function MetricCard({amount, count, emptyText, icon: Icon, linkLabel, onOpen, restricted, title}) {
  const content = (
    <>
      <div className="reports-simple-card__top">
        <span className="reports-simple-card__icon"><Icon size={20} aria-hidden="true" /></span>
        {onOpen && <span className="reports-simple-card__link">{linkLabel}<ArrowRight size={14} /></span>}
      </div>
      <span className="reports-simple-card__title">{title}</span>
      <strong className="reports-simple-card__amount">
        {restricted ? "Acceso restringido" : amount}
      </strong>
      <small>
        {restricted
          ? "Tu perfil no incluye información de rentabilidad."
          : count > 0
            ? `${count} ${count === 1 ? "registro" : "registros"}`
            : emptyText}
      </small>
    </>
  );
  if (onOpen) {
    return <button className="reports-simple-card reports-simple-card--link" type="button" onClick={onOpen}>{content}</button>;
  }
  return <article className="reports-simple-card">{content}</article>;
}

function StatisticsPage({businessId, currencyCode = "CLP", role = ""}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPeriod = searchParams.get("period") || "month";
  const period = VALID_PERIODS.has(requestedPeriod) ? requestedPeriod : "month";
  const today = getSantiagoDateKey();
  const customStart = searchParams.get("from") || today;
  const customEnd = searchParams.get("to") || today;
  const selectedCurrency = searchParams.get("currency") || "todos";
  const range = useMemo(
    () => getFinancialPeriodRange(period, {start: customStart, end: customEnd}),
    [customEnd, customStart, period]
  );
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(Boolean(businessId));
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const canViewProfitability = hasBusinessPermission(
    role,
    BUSINESS_PERMISSIONS.PROFITABILITY_READ
  );

  useEffect(() => {
    let active = true;
    if (!businessId) {
      setData(EMPTY_DATA);
      setLoading(false);
      setError("");
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    loadSimplifiedReportData(businessId, {role})
      .then((next) => {
        if (active) setData(next);
      })
      .catch((loadError) => {
        if (active) setError(loadError?.message || "No fue posible cargar los reportes.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [businessId, reloadKey, role]);

  const summary = useMemo(() => getSimplifiedReportSummary({
    sales: data.sales,
    purchases: data.purchases,
    projectBalances: data.projectBalances,
    range,
    currency: selectedCurrency,
    fallbackCurrency: currencyCode,
    canViewProfitability,
  }), [canViewProfitability, currencyCode, data, range, selectedCurrency]);
  const availableCurrencies = useMemo(() => {
    const all = getSimplifiedReportSummary({
      sales: data.sales,
      purchases: data.purchases,
      projectBalances: data.projectBalances,
      range,
      fallbackCurrency: currencyCode,
      canViewProfitability,
    });
    const values = all.currencies.map((entry) => entry.currency);
    if (selectedCurrency !== "todos" && !values.includes(selectedCurrency)) {
      values.push(selectedCurrency);
    }
    return values.sort();
  }, [canViewProfitability, currencyCode, data, range, selectedCurrency]);
  const salesTimeline = useMemo(() => aggregateOperationalTimeline(
    summary.sales.confirmed,
    {range, dateField: "fechaVenta", fallbackCurrency: currencyCode}
  ), [currencyCode, range, summary.sales.confirmed]);
  const purchaseTimeline = useMemo(() => aggregateOperationalTimeline(
    summary.purchases.confirmed,
    {range, dateField: "fechaCompra", fallbackCurrency: currencyCode}
  ), [currencyCode, range, summary.purchases.confirmed]);
  const chartCurrency = selectedCurrency !== "todos"
    ? selectedCurrency
    : summary.currencies.length === 1
      ? summary.currencies[0]?.currency
      : "";
  const chartItems = useMemo(() => combineOperationalTimelines(
    salesTimeline,
    purchaseTimeline
  ).filter((item) => !chartCurrency || item.currency === chartCurrency), [chartCurrency, purchaseTimeline, salesTimeline]);
  const links = {
    purchases: canAccessBusinessPath(role, "/compras"),
    sales: canAccessBusinessPath(role, "/ventas"),
    works: canAccessBusinessPath(role, "/trabajos"),
  };

  if (!businessId) {
    return (
      <section className="erp-page reports-simple">
        <header className="erp-page-header">
          <div className="erp-page-intro"><h1>Reportes</h1><p>Resumen de ventas, compras y resultados de tus proyectos.</p></div>
        </header>
        <div className="erp-card reports-simple-state">Selecciona un negocio para consultar sus reportes.</div>
      </section>
    );
  }

  return (
    <section className="erp-page reports-simple">
      <header className="erp-page-header reports-simple-header">
        <div className="erp-page-intro">
          <h1>Reportes</h1>
          <p>Resumen de ventas, compras y resultados de tus proyectos.</p>
        </div>
        <div className="reports-simple-toolbar">
          <FinancialPeriodSelector
            customEnd={customEnd}
            customStart={customStart}
            idPrefix="reports-period"
            onCustomEndChange={(value) => updateSearchParams(searchParams, setSearchParams, {to: value})}
            onCustomStartChange={(value) => updateSearchParams(searchParams, setSearchParams, {from: value})}
            onPeriodChange={(value) => updateSearchParams(searchParams, setSearchParams, {period: value})}
            options={REPORT_PERIOD_OPTIONS}
            period={period}
          />
          <label className="erp-field reports-simple-currency">
            <span className="erp-field__label">Moneda</span>
            <select
              className="erp-control"
              value={selectedCurrency}
              onChange={(event) => updateSearchParams(searchParams, setSearchParams, {currency: event.target.value})}
            >
              <option value="todos">Todas, separadas</option>
              {availableCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
          </label>
        </div>
      </header>

      <p className="reports-simple-help">Los montos de monedas distintas se muestran por separado y no se convierten.</p>

      {error && (
        <div className="erp-card reports-simple-state reports-simple-state--error" role="alert">
          <span>{error}</span>
          <Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={16} /> Reintentar</Button>
        </div>
      )}
      {loading && !error && <div className="erp-card reports-simple-state">Cargando resumen...</div>}

      {!loading && !error && (
        <>
          <div className="reports-simple-currencies">
            {summary.currencies.map((group) => (
              <section className="reports-simple-currency-group" key={group.currency}>
                <h2>{group.currency}</h2>
                <div className="reports-simple-metrics">
                  <MetricCard
                    amount={formatMoney(group.sales.total, group.currency)}
                    count={group.sales.count}
                    emptyText="Sin ventas registradas en este período."
                    icon={BadgeDollarSign}
                    linkLabel="Ver ventas"
                    onOpen={links.sales ? () => navigate("/ventas") : null}
                    title="Ventas"
                  />
                  <MetricCard
                    amount={formatMoney(group.purchases.total, group.currency)}
                    count={group.purchases.count}
                    emptyText="Sin compras registradas en este período."
                    icon={ShoppingCart}
                    linkLabel="Ver compras"
                    onOpen={links.purchases ? () => navigate("/compras") : null}
                    title="Compras"
                  />
                  <MetricCard
                    amount={group.projects.total === null ? "—" : formatMoney(group.projects.total, group.currency)}
                    count={group.projects.count}
                    emptyText="Sin proyectos con resultado disponible."
                    icon={BriefcaseBusiness}
                    linkLabel="Ver proyectos"
                    onOpen={links.works ? () => navigate("/trabajos") : null}
                    restricted={!summary.projects.accessible}
                    title="Ganancia de proyectos"
                  />
                </div>
              </section>
            ))}
          </div>

          {canViewProfitability && (
            <p className="reports-simple-project-note">
              La ganancia de proyectos muestra el balance actual autoritativo y no se atribuye al período seleccionado.
            </p>
          )}

          <section className="erp-card reports-simple-chart">
            <div className="reports-simple-chart__header">
              <div><h2>Ventas y compras</h2><p>Comparación de operaciones confirmadas en el período.</p></div>
              {chartCurrency && <span>{chartCurrency}</span>}
            </div>
            {chartCurrency
              ? <OperationalComparisonChart currency={chartCurrency} items={chartItems} />
              : <div className="financial-chart-empty">Selecciona una moneda para comparar ventas y compras.</div>}
          </section>
        </>
      )}
    </section>
  );
}

export default StatisticsPage;
