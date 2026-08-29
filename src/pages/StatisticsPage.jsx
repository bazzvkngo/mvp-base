import React, {useEffect, useMemo, useState} from "react";
import {
  ArrowRight,
  BadgeDollarSign,
  BriefcaseBusiness,
  Percent,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import {useNavigate, useSearchParams} from "react-router-dom";
import FinancialPeriodSelector from "../components/finance/FinancialPeriodSelector";
import CostCompositionChart from "../components/reports/CostCompositionChart";
import OperationalComparisonChart from "../components/reports/OperationalComparisonChart";
import Button from "../components/ui/Button";
import {getFinancialPeriodRange, getSantiagoDateKey} from "../domain/financialMovement.mjs";
import {
  REPORT_PERIOD_OPTIONS,
  aggregateOperationalTimeline,
  combineOperationalTimelines,
  getProjectProfitabilitySummary,
  getSimplifiedReportSummary,
} from "../domain/reportModel.mjs";
import {
  BUSINESS_PERMISSIONS,
  canAccessBusinessPath,
  hasBusinessPermission,
} from "../domain/rbac.mjs";
import {getWorkStatusLabel} from "../domain/workModel.mjs";
import {loadSimplifiedReportData} from "../services/reportService";
import {formatMoney} from "../utils/formatters";

const VALID_PERIODS = new Set(REPORT_PERIOD_OPTIONS.map((option) => option.id));
const EMPTY_DATA = Object.freeze({projectBalances: [], purchases: [], sales: []});
const MAX_PROJECTS_PER_CURRENCY = 6;

function updateSearchParams(searchParams, setSearchParams, changes) {
  const next = new URLSearchParams(searchParams);
  Object.entries(changes).forEach(([key, value]) => {
    if (value) next.set(key, value);
    else next.delete(key);
  });
  setSearchParams(next, {replace: true});
}

function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("es-CL", {maximumFractionDigits: 2})}%`;
}

function MetricCard({amount, detail, emptyText, icon: Icon, linkLabel, onOpen, restricted, title, variant = "default"}) {
  const content = <>
    <div className="reports-simple-card__top">
      <span className="reports-simple-card__icon"><Icon size={19} aria-hidden="true" /></span>
      <span className="reports-simple-card__title">{title}</span>
      {onOpen && <span className="reports-simple-card__link">{linkLabel}<ArrowRight size={14} /></span>}
    </div>
    <strong className="reports-simple-card__amount">{restricted ? "Acceso restringido" : amount}</strong>
    <small>{restricted ? "Tu perfil no incluye información de rentabilidad." : detail || emptyText}</small>
  </>;
  const className = `reports-simple-card reports-simple-card--${variant}${onOpen ? " reports-simple-card--link" : ""}`;
  if (onOpen) return <button className={className} type="button" onClick={onOpen}>{content}</button>;
  return <article className={className}>{content}</article>;
}

function ProfitabilitySummary({currency, group}) {
  if (!group) return <div className="reports-profitability-empty">Registra costos en tus proyectos para analizar su rentabilidad.</div>;
  const money = (value) => formatMoney(value, currency);
  const costItems = [
    {label: "Materiales", value: group.materials, colorIndex: 0},
    {label: "Horas hombre", value: group.labor, colorIndex: 1},
    {label: "Gastos directos", value: group.directExpenses, colorIndex: 2},
    {label: "Administrativos / indirectos", value: group.indirectExpenses, colorIndex: 3},
  ];
  const hasCostComposition = costItems.some((item) => Number(item.value || 0) > 0);
  return <article className="reports-profitability-group">
    <header><span>{currency}</span><small>{group.count} {group.count === 1 ? "proyecto conciliado" : "proyectos conciliados"}</small></header>
    <div className="reports-profitability-focus">
      <dl className="reports-profitability-primary">
        <div className="reports-profitability-result"><dt>Resultado</dt><dd>{money(group.result)}</dd></div>
        <div><dt>Margen</dt><dd>{formatPercent(group.margin)}</dd></div>
      </dl>
      <dl className="reports-profitability-secondary">
        <div><dt>Ingresos asociados</dt><dd>{money(group.revenue)}</dd></div>
        <div><dt>Costos registrados</dt><dd>{money(group.costs)}</dd></div>
      </dl>
    </div>
    <div className={`reports-cost-composition${hasCostComposition ? " reports-cost-composition--chart" : ""}`}>
      {hasCostComposition && <CostCompositionChart currency={currency} items={costItems} total={group.costs} />}
      <div className="reports-cost-breakdown">
        <span>Composición de costos</span>
        <dl>
          <div><dt>Materiales</dt><dd>{money(group.materials)}</dd></div>
          <div><dt>Horas hombre</dt><dd>{money(group.labor)}</dd></div>
          <div><dt>Gastos directos</dt><dd>{money(group.directExpenses)}</dd></div>
          <div><dt>Administrativos / indirectos</dt><dd>{money(group.indirectExpenses)}</dd></div>
        </dl>
      </div>
    </div>
  </article>;
}

function ProjectResults({groups, navigate, showLink}) {
  if (!groups.length) return <div className="reports-projects-empty"><div><strong>Aún no hay proyectos con resultado disponible.</strong><span>Registra costos en tus proyectos para analizar su rentabilidad.</span></div>{showLink && <Button variant="secondary" onClick={() => navigate("/trabajos")}>Ver proyectos</Button>}</div>;
  const openProject = (project) => navigate("/trabajos", {state: {openWorkId: project.id}});
  return <div className="reports-project-groups">{groups.map((group) => {
    const projects = [...group.projects].sort((left, right) =>
      Math.abs(Number(right.balance?.resultado || 0)) - Math.abs(Number(left.balance?.resultado || 0)) ||
      String(right.actualizadoEn || right.fechaCompletado || "").localeCompare(String(left.actualizadoEn || left.fechaCompletado || ""))
    ).slice(0, MAX_PROJECTS_PER_CURRENCY);
    const money = (value) => formatMoney(value, group.currency);
    return <section className="reports-project-group" key={group.currency}>
      <h3>{group.currency}</h3>
      <div className="reports-project-table-wrap"><table className="reports-project-table">
        <thead><tr><th>Proyecto</th><th>Cliente</th><th>Ingresos</th><th>Costos</th><th>Resultado</th><th>Margen</th><th>Estado</th></tr></thead>
        <tbody>{projects.map((project) => <tr key={project.id}>
          <td><button type="button" onClick={() => openProject(project)}><strong>{project.numero || "Proyecto"}</strong><span title={project.titulo}>{project.titulo}</span></button></td>
          <td>{project.clienteSnapshot?.nombreRazonSocial || "Sin cliente asociado"}</td>
          <td>{money(project.balance.valorComercial)}</td><td>{money(project.balance.costoTotal)}</td>
          <td className={Number(project.balance.resultado) < 0 ? "reports-negative" : "reports-positive"}>{money(project.balance.resultado)}</td>
          <td>{formatPercent(project.balance.rentabilidadPct)}</td>
          <td><span className={`reports-project-status reports-project-status--${project.estado}`}>{getWorkStatusLabel(project.estado)}</span></td>
        </tr>)}</tbody>
      </table></div>
      <div className="reports-project-cards">{projects.map((project) => <article key={project.id}>
        <header><button type="button" onClick={() => openProject(project)}><strong>{project.numero || "Proyecto"}</strong><span>{project.titulo}</span></button><span className={`reports-project-status reports-project-status--${project.estado}`}>{getWorkStatusLabel(project.estado)}</span></header>
        <p>{project.clienteSnapshot?.nombreRazonSocial || "Sin cliente asociado"}</p>
        <dl><div><dt>Ingresos</dt><dd>{money(project.balance.valorComercial)}</dd></div><div><dt>Costos</dt><dd>{money(project.balance.costoTotal)}</dd></div><div><dt>Resultado</dt><dd className={Number(project.balance.resultado) < 0 ? "reports-negative" : "reports-positive"}>{money(project.balance.resultado)}</dd></div><div><dt>Margen</dt><dd>{formatPercent(project.balance.rentabilidadPct)}</dd></div></dl>
      </article>)}</div>
    </section>;
  })}</div>;
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
  const range = useMemo(() => getFinancialPeriodRange(period, {start: customStart, end: customEnd}), [customEnd, customStart, period]);
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(Boolean(businessId));
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const canViewProfitability = hasBusinessPermission(role, BUSINESS_PERMISSIONS.PROFITABILITY_READ);

  useEffect(() => {
    let active = true;
    if (!businessId) { setData(EMPTY_DATA); setLoading(false); setError(""); return () => { active = false; }; }
    setLoading(true); setError("");
    loadSimplifiedReportData(businessId, {role}).then((next) => { if (active) setData(next); }).catch((loadError) => { if (active) setError(loadError?.message || "No fue posible cargar los reportes."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, reloadKey, role]);

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
  const links = {purchases: canAccessBusinessPath(role, "/compras"), sales: canAccessBusinessPath(role, "/ventas"), works: canAccessBusinessPath(role, "/trabajos")};

  if (!businessId) return <section className="erp-page reports-simple"><header className="erp-page-header"><div className="erp-page-intro"><span className="reports-simple-eyebrow">Reportes</span><h1>Resumen ejecutivo</h1><p>Analiza ventas, compras y rentabilidad de tus proyectos.</p></div></header><div className="erp-card reports-simple-state">Selecciona un negocio para consultar sus reportes.</div></section>;

  return <section className="erp-page reports-simple">
    <header className="erp-page-header reports-simple-header">
      <div className="erp-page-intro"><span className="reports-simple-eyebrow">Reportes</span><h1>Resumen ejecutivo</h1><p>Analiza ventas, compras y rentabilidad de tus proyectos.</p></div>
      <div className="reports-simple-toolbar">
        <FinancialPeriodSelector customEnd={customEnd} customStart={customStart} idPrefix="reports-period" onCustomEndChange={(value) => updateSearchParams(searchParams, setSearchParams, {to: value})} onCustomStartChange={(value) => updateSearchParams(searchParams, setSearchParams, {from: value})} onPeriodChange={(value) => updateSearchParams(searchParams, setSearchParams, {period: value})} options={REPORT_PERIOD_OPTIONS} period={period} />
        <label className="erp-field reports-simple-currency"><span className="erp-field__label">Moneda</span><select className="erp-control" value={selectedCurrency} onChange={(event) => updateSearchParams(searchParams, setSearchParams, {currency: event.target.value})}><option value="todos">Todas, separadas</option>{availableCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
      </div>
    </header>
    <p className="reports-simple-help">Las monedas se muestran por separado y no se convierten.</p>
    {error && <div className="erp-card reports-simple-state reports-simple-state--error" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={16} /> Reintentar</Button></div>}
    {loading && !error && <div className="erp-card reports-simple-state">Cargando resumen ejecutivo...</div>}

    {!loading && !error && <>
      <div className="reports-simple-currencies">{summary.currencies.map((group) => {
        const projectGroup = profitability.groups.find((entry) => entry.currency === group.currency);
        return <section className="reports-simple-currency-group" key={group.currency}><h2>{group.currency}</h2><div className="reports-simple-metrics">
          <MetricCard amount={formatMoney(group.sales.total, group.currency)} detail={group.sales.count ? `${group.sales.count} ${group.sales.count === 1 ? "venta confirmada" : "ventas confirmadas"}` : ""} emptyText="Aún no hay ventas confirmadas en este período." icon={BadgeDollarSign} linkLabel="Ver ventas" onOpen={links.sales ? () => navigate("/ventas") : null} title="Ventas" />
          <MetricCard amount={formatMoney(group.purchases.total, group.currency)} detail={group.purchases.count ? `${group.purchases.count} ${group.purchases.count === 1 ? "compra confirmada" : "compras confirmadas"}` : ""} emptyText="Aún no hay compras confirmadas en este período." icon={ShoppingCart} linkLabel="Ver compras" onOpen={links.purchases ? () => navigate("/compras") : null} title="Compras" />
          <MetricCard amount={group.projects.total === null ? "—" : formatMoney(group.projects.total, group.currency)} detail={group.projects.count ? `${group.projects.count} ${group.projects.count === 1 ? "proyecto con resultado" : "proyectos con resultado"}` : ""} emptyText="Sin proyectos con resultado disponible." icon={BriefcaseBusiness} linkLabel="Ver proyectos" onOpen={links.works ? () => navigate("/trabajos") : null} restricted={!summary.projects.accessible} title="Resultado de proyectos" variant="result" />
          {summary.projects.accessible && <MetricCard amount={formatPercent(projectGroup?.margin)} detail="Sobre ingresos asociados a proyectos" emptyText="Margen no disponible." icon={Percent} title="Margen de proyectos" variant="margin" />}
        </div></section>;
      })}</div>

      <p className="reports-simple-project-note">Las compras muestran egresos registrados del negocio. La rentabilidad de proyectos considera únicamente ingresos y costos asociados a cada proyecto; corresponde al balance actual autoritativo y no se atribuye al período seleccionado.</p>

      <div className="reports-executive-grid">
        <section className="erp-card reports-profitability">
          <div className="reports-section-heading"><div><span>Rentabilidad operativa</span><h2>Rentabilidad de proyectos</h2><p>Ingresos y costos provenientes del balance autoritativo de cada proyecto.</p></div>{links.works && <button type="button" onClick={() => navigate("/trabajos")}>Ver proyectos<ArrowRight size={14} /></button>}</div>
          {!canViewProfitability ? <div className="reports-profitability-empty">Tu perfil no incluye información de rentabilidad.</div> : <div className="reports-profitability-groups">{summary.currencies.map((group) => <ProfitabilitySummary currency={group.currency} group={profitability.groups.find((entry) => entry.currency === group.currency)} key={group.currency} />)}</div>}
        </section>
        <section className="erp-card reports-simple-chart">
          <div className="reports-section-heading"><div><span>Movimiento comercial</span><h2>Ventas y compras</h2><p>Operaciones confirmadas dentro del período seleccionado.</p></div></div>
          <div className="reports-chart-groups">{chartGroups.map((group) => <article className="reports-chart-group" key={group.currency}>
            <div className="reports-chart-summary">
              <span>{group.currency}</span>
              <dl>
                <div><dt><i className="reports-chart-summary__dot reports-chart-summary__dot--sales" aria-hidden="true" />Ventas confirmadas</dt><dd>{formatMoney(group.sales, group.currency)}</dd></div>
                <div><dt><i className="reports-chart-summary__dot reports-chart-summary__dot--purchases" aria-hidden="true" />Compras confirmadas</dt><dd>{formatMoney(group.purchases, group.currency)}</dd></div>
              </dl>
            </div>
            <OperationalComparisonChart currency={group.currency} items={group.items} />
          </article>)}</div>
        </section>
      </div>

      {canViewProfitability && <section className="erp-card reports-projects">
        <div className="reports-section-heading"><div><span>Rentabilidad operativa</span><h2>Resultados por proyecto</h2><p>Proyectos con balance completo, ordenados por resultado absoluto.</p></div>{links.works && <button type="button" onClick={() => navigate("/trabajos")}>Ver proyectos<ArrowRight size={14} /></button>}</div>
        <ProjectResults groups={profitability.groups} navigate={navigate} showLink={links.works} />
      </section>}
    </>}
  </section>;
}

export default StatisticsPage;
