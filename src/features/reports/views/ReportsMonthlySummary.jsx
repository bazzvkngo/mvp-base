import React, {useMemo} from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  ChevronLeft,
  ChevronRight,
  Minus,
  RefreshCw,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Button from "../../../components/ui/Button";
import LoadingState from "../../../components/ui/LoadingState";
import {
  MONTHLY_EXPLANATIONS,
  NO_PREVIOUS_MONTH_TEXT,
  buildMonthlyProjectResults,
  buildMonthlySummaryGroups,
  buildProfitNoticeLines,
  buildServicesWithoutProjectNotices,
  canShowNextMonth,
  describeProfitMargin,
  formatComparisonText,
  formatMonthLabel,
  formatMonthName,
  formatReferenceText,
  hasPreviousMonthBase,
  isMonthEmpty,
  isMonthInProgress,
  shiftMonthKey,
} from "../../../domain/reportMonthlySummary.mjs";
import useBusinessFormat from "../../../hooks/useBusinessFormat";
import {formatMoney} from "../../../utils/formatters";
import MarginRing from "./MarginRing";
import ReportsMonthlyProjects from "./ReportsMonthlyProjects";
import ReportsProfitNotice from "./ReportsProfitNotice";

const DELTA_ICONS = Object.freeze({up: ArrowUpRight, down: ArrowDownRight, flat: Minus, none: Minus});

function ComparisonLine({comparison, locale, signed = false}) {
  const Icon = DELTA_ICONS[comparison.direction];
  const tone = signed ? comparison.direction : "none";
  return <span className={`reports-month-delta reports-month-delta--${tone}`}>
    <Icon size={14} aria-hidden="true" />
    {formatComparisonText(comparison, locale)}
  </span>;
}

// Mes en curso: una línea de referencia con el mes anterior completo, sin
// porcentaje. Mes cerrado: la variación porcentual.
function ReferenceLine({text}) {
  return <span className="reports-month-delta reports-month-delta--none">{text}</span>;
}

// Tarjeta del resumen. Las tarjetas "Vendí" y "Compré" son la versión simple; la
// de "Me quedó" suma `subtitle` ("Ganancia"), `aside` (el círculo del margen) y
// `notice` (el aviso único, pegado a la cifra). No hay ningún signo ni operador
// entre las tarjetas: la ganancia no se define como ventas menos compras.
function MonthlyCard({aside, children, comparison, explanation, icon: Icon, locale, notice, onOpenDetail, referenceText, signed, subtitle, title, variant = "default"}) {
  // La fila del título va siempre arriba y a todo el ancho; el círculo (aside) se
  // alinea con el monto, que es lo primero del cuerpo.
  const body = <>
    {children}
    {notice}
    {referenceText ? <ReferenceLine text={referenceText} /> : comparison && <ComparisonLine comparison={comparison} locale={locale} signed={signed} />}
    <small>{explanation}</small>
    {onOpenDetail && <Button type="button" variant="ghost" className="reports-month-card-link" icon={ArrowRight} iconSize={14} onClick={onOpenDetail}>Ver detalle</Button>}
  </>;
  return <article className={`reports-simple-card reports-simple-card--${variant}`}>
    <div className="reports-simple-card__top">
      <span className="reports-simple-card__icon"><Icon size={19} aria-hidden="true" /></span>
      <span className="reports-simple-card__title">
        {subtitle ? <strong className="reports-simple-card__heading">{title}</strong> : title}
        {subtitle && <span className="reports-simple-card__subtitle">{subtitle}</span>}
      </span>
    </div>
    {aside ? <div className="reports-profit-card__body">{aside}<div className="reports-profit-card__main">{body}</div></div> : body}
  </article>;
}

function ProfitAmount({amountText, onRetry, profit}) {
  if (profit.status === "error") {
    // Un fallo de la ganancia es un error propio: nunca se muestra como vacío.
    return <div className="reports-v4-state reports-v4-state--error" role="alert">
      <span>{profit.error || "No fue posible calcular la ganancia."}</span>
      <Button type="button" variant="secondary" icon={RefreshCw} iconSize={14} onClick={onRetry}>Reintentar</Button>
    </div>;
  }
  if (profit.status !== "ready") return <LoadingState variant="inline" label="Calculando ganancia..." />;
  const tone = profit.amount > 0 ? " reports-profit-card__amount--up" : profit.amount < 0 ? " reports-profit-card__amount--down" : "";
  return <strong className={`reports-simple-card__amount${tone}`}>{amountText}</strong>;
}

const MARGIN_ICONS = Object.freeze({up: TrendingUp, down: TrendingDown});

// La cifra de "Me quedó": el monto y, debajo, la frase del margen ("De cada $100
// que vendes, te quedan $X") con su nota de base ("sobre $N de ventas
// consideradas") solo cuando difiere de "Vendí". El ícono de sentido (sube o
// baja) acompaña al color; ambos son refuerzo de la frase, que dice el sentido.
function ProfitFigures({amountText, description, onRetry, profit}) {
  const Icon = MARGIN_ICONS[description.ring.tone];
  return <>
    <ProfitAmount amountText={amountText} onRetry={onRetry} profit={profit} />
    {description.sentence && <p className={`reports-profit-card__sentence reports-profit-card__sentence--${description.ring.tone}`}>
      {Icon && <Icon size={14} aria-hidden="true" />}
      <span>{description.sentence}</span>
    </p>}
    {description.basis.show && <p className="reports-profit-card__basis">{description.basis.text}</p>}
  </>;
}

// Resumen mensual de Reportes (SPEC 025 §3): ventas, compras y ganancia del
// mes elegido con su comparación contra el mes anterior. Solo presenta cifras
// de reportModel y operationalNetProfit; no calcula dinero por su cuenta.
function ReportsMonthlySummary({
  canRegisterPurchase,
  canRegisterSale,
  canViewProfitability,
  canViewPurchases,
  canViewSales,
  currency,
  links,
  month,
  onMonthChange,
  onNavigate,
  onOpenDetail,
  onRetryProfit,
  previousProfit,
  previousSummary,
  profit,
  projects,
  summary,
  todayKey,
}) {
  const {locale} = useBusinessFormat();
  const inProgress = isMonthInProgress(month, todayKey);
  const previousMonthName = formatMonthName(shiftMonthKey(month, -1), locale);
  const groups = useMemo(
    () => buildMonthlySummaryGroups({summary, previousSummary, profit, previousProfit, canViewProfitability, currency, inProgress}),
    [canViewProfitability, currency, inProgress, previousProfit, previousSummary, profit, summary]
  );
  const hasCards = canViewSales || canViewPurchases || canViewProfitability;
  // Sin base en ninguna tarjeta: una sola línea bajo el selector de mes.
  const showComparison = hasPreviousMonthBase(groups, {sales: canViewSales, purchases: canViewPurchases, profit: canViewProfitability});
  // Documentos sin neto válido: solo los de Ventas y Compras que el perfil puede ver.
  const withoutNetCount = (canViewSales ? summary.sales.withoutNetCount : 0) +
    (canViewPurchases ? summary.purchases.withoutNetCount : 0);
  // Proyectos con movimiento que no entran en la ganancia (mismo conteo que Proyectos del mes).
  const incompleteCount = useMemo(
    () => projects?.status === "ready" ? buildMonthlyProjectResults({projects: projects.meta?.proyectos || [], month, currency}).incompletos : 0,
    [currency, month, projects]
  );
  const servicesByCurrency = useMemo(
    () => new Map(buildServicesWithoutProjectNotices(profit, currency).map((entry) => [entry.moneda, entry.monto])),
    [currency, profit]
  );
  // Aviso único: una lista de líneas por moneda (reglas y permisos en buildProfitNoticeLines).
  // Lo que no es de una moneda (documentos sin neto, conteo con varias monedas) va solo en la primera.
  const noticeLines = groups.map((group, index) => buildProfitNoticeLines({
    canOpenSales: Boolean(links.sales),
    canViewProfitability,
    coverage: group.profit?.coverage,
    currencyCount: groups.length,
    incompleteCount,
    primary: index === 0,
    servicesAmount: servicesByCurrency.get(group.currency) ?? null,
    withoutNetCount,
  }));
  const projectsNotes = noticeLines.flat().filter((line) => line.placement === "projects");

  return <>
    <div className="reports-month-nav" role="group" aria-label="Mes del resumen">
      <Button type="button" variant="secondary" icon={ChevronLeft} aria-label="Mes anterior" onClick={() => onMonthChange(shiftMonthKey(month, -1))} />
      <strong className="reports-month-nav__label">{formatMonthLabel(month, locale)}</strong>
      <Button type="button" variant="secondary" icon={ChevronRight} aria-label="Mes siguiente" disabled={!canShowNextMonth(month, todayKey)} onClick={() => onMonthChange(shiftMonthKey(month, 1))} />
    </div>
    {hasCards && !showComparison && <p className="reports-month-no-previous">{NO_PREVIOUS_MONTH_TEXT}</p>}

    {!hasCards && <div className="erp-card reports-simple-state">Tu perfil no incluye informes con cifras del mes.</div>}

    {hasCards && <div className="reports-simple-currencies">{groups.map((group, index) => {
      const money = (value) => formatMoney(value, group.currency, locale);
      const referenceOf = (metric) => metric.reference
        ? formatReferenceText(metric.reference, previousMonthName, money(metric.reference.amount))
        : null;
      const profitLines = noticeLines[index].filter((line) => line.placement === "profit");
      const showsProfitCard = canViewProfitability && Boolean(group.profit);
      const marginDescription = group.profit
        ? describeProfitMargin({
          consideredRevenue: group.profit.consideredRevenue,
          coverage: group.profit.coverage,
          currency: group.currency,
          locale,
          marginPct: group.profit.marginPct,
          // Sin permiso de Ventas no se ve "Vendí": tampoco se compara con él ni se muestra la nota de base.
          salesTotal: canViewSales ? group.sales.total : null,
          status: group.profit.status,
        })
        : null;
      return <section className="reports-simple-currency-group" key={group.currency}>
        {groups.length > 1 && <h2>{group.currency}</h2>}
        <div className="reports-simple-metrics reports-simple-metrics--visual">
          {canViewSales && <MonthlyCard comparison={showComparison ? group.sales.comparison : null} explanation={MONTHLY_EXPLANATIONS.sales} icon={BadgeDollarSign} locale={locale} onOpenDetail={links.sales ? () => onOpenDetail("ventas") : null} referenceText={showComparison ? referenceOf(group.sales) : null} title="Vendí">
            <strong className="reports-simple-card__amount">{money(group.sales.total)}</strong>
          </MonthlyCard>}
          {canViewPurchases && <MonthlyCard comparison={showComparison ? group.purchases.comparison : null} explanation={MONTHLY_EXPLANATIONS.purchases} icon={ShoppingCart} locale={locale} onOpenDetail={links.purchases ? () => onOpenDetail("compras") : null} referenceText={showComparison ? referenceOf(group.purchases) : null} title="Compré">
            <strong className="reports-simple-card__amount">{money(group.purchases.total)}</strong>
          </MonthlyCard>}
          {canViewProfitability && group.profit && <MonthlyCard aside={marginDescription.kind === "pending" ? null : <MarginRing description={marginDescription} locale={locale} />} comparison={showComparison && group.profit.status === "ready" ? group.profit.comparison : null} explanation={MONTHLY_EXPLANATIONS.profit} icon={TrendingUp} locale={locale} notice={<ReportsProfitNotice currency={group.currency} lines={profitLines} locale={locale} onNavigate={onNavigate} onOpenDetail={onOpenDetail} />} onOpenDetail={() => onOpenDetail("ganancias")} referenceText={showComparison && group.profit.status === "ready" ? referenceOf(group.profit) : null} signed subtitle="Ganancia" title="Me quedó" variant="profit">
            <ProfitFigures amountText={money(group.profit.amount)} description={marginDescription} onRetry={onRetryProfit} profit={group.profit} />
          </MonthlyCard>}
        </div>
        {!showsProfitCard && <ReportsProfitNotice currency={group.currency} lines={profitLines} locale={locale} onNavigate={onNavigate} onOpenDetail={onOpenDetail} variant="standalone" />}
      </section>;
    })}</div>}

    {/* Mes sin movimiento: el vacío ya lo dicen los $0 de las tarjetas, así que no hay una tarjeta
        extra que lo repita. Solo el mes en curso ofrece registrar la primera venta o compra. */}
    {hasCards && isMonthEmpty(groups) && inProgress && (canRegisterSale || canRegisterPurchase) && <div className="reports-month-actions">
      {canRegisterSale && <Button type="button" onClick={() => onNavigate("/ventas/nueva")}>Registrar venta</Button>}
      {canRegisterPurchase && <Button type="button" variant="secondary" onClick={() => onNavigate("/compras/nueva")}>Registrar compra</Button>}
    </div>}

    <ReportsMonthlyProjects canView={canViewProfitability} currency={currency} inProgress={inProgress} links={links} month={month} notes={projectsNotes} onNavigate={onNavigate} onRetry={onRetryProfit} projects={projects} />
  </>;
}

export default ReportsMonthlySummary;
