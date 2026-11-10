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
import StatusBadge from "../../../components/ui/StatusBadge";
import {SPARKLINE_MIN_POINTS, trendItemsFor} from "../../../domain/reportTrend.mjs";
import {
  MONTHLY_EXPLANATIONS,
  MONTHLY_SHORT_NOTES,
  NO_PREVIOUS_MONTH_TEXT,
  buildMonthlyProjectResults,
  buildMonthlySummaryGroups,
  buildProfitNoticeLines,
  buildServicesWithoutProjectNotices,
  canShowNextMonth,
  describeProfitMargin,
  formatComparisonChip,
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
import {formatDate} from "../../../utils/formatters";
import {formatReportMoney} from "../../../utils/formatReportMoney";
import ReportsInfoTip from "../ReportsInfoTip";
import MarginRing from "./MarginRing";
import ReportsMonthlyProjects from "./ReportsMonthlyProjects";
import ReportsMonthlyTrend from "./ReportsMonthlyTrend";
import ReportsProfitNotice from "./ReportsProfitNotice";
import ReportsSparkline from "./ReportsSparkline";

// Resumen en texto de la mini-línea, para lectores de pantalla: cuántos días y de qué monto a qué monto.
function sparklineLabel(points, noun, money, locale) {
  const first = points[0];
  const last = points[points.length - 1];
  return `${noun} por día en el mes: ${points.length} días con movimiento, de ${money(first.value)} el ${formatDate(first.key, locale)} a ${money(last.value)} el ${formatDate(last.key, locale)}.`;
}

const DELTA_ICONS = Object.freeze({up: ArrowUpRight, down: ArrowDownRight, flat: Minus, none: Minus});
// Chip de variación (R5). "signed": subir es bueno (verde) y bajar es malo (rojo), para
// Vendí y Me quedó. "neutral": en Compré subir no es bueno ni malo, así que el chip va
// sin color y solo la flecha dice el sentido.
const CHIP_VARIANTS = Object.freeze({up: "success", down: "danger", flat: "neutral"});

// Mes cerrado con base: chip "+X %" / "-X %" con la variación que ya calcula
// compareWithPreviousMonth, junto a la cifra (R6). El "frente al mes anterior" va solo para
// lectores de pantalla. Sin base no hay chip: solo el aviso en texto bajo la cifra.
function ComparisonChip({comparison, locale, chipTone = "signed"}) {
  const Icon = DELTA_ICONS[comparison.direction];
  const variant = chipTone === "signed" ? CHIP_VARIANTS[comparison.direction] : "neutral";
  return <StatusBadge className={`reports-month-chip reports-month-chip--${comparison.direction}`} variant={variant}>
    <Icon size={14} aria-hidden="true" />
    {formatComparisonChip(comparison, locale)}
    <span className="sr-only"> frente al mes anterior</span>
  </StatusBadge>;
}

function ComparisonLine({comparison, locale}) {
  const Icon = DELTA_ICONS[comparison.direction];
  return <span className="reports-month-delta reports-month-delta--none">
    <Icon size={14} aria-hidden="true" />
    {formatComparisonText(comparison, locale)}
  </span>;
}

// Mes en curso: una línea de referencia con el mes anterior completo, sin
// porcentaje. Mes cerrado: la variación porcentual.
function ReferenceLine({text}) {
  return <span className="reports-month-delta reports-month-delta--none">{text}</span>;
}

// Tarjeta del resumen (R6). Las tres tienen franja de acento arriba (ventas, compras o
// ganancia) y el mismo orden: título con su ícono "i", cifra grande con el chip de variación
// al lado, aviso (solo "Me quedó"), nota corta, y "Ver detalle" al pie, a la izquierda.
// `amount` es la cifra; `children` lo que va bajo ella (en "Me quedó", la frase del margen).
// "Me quedó" suma `subtitle` ("Ganancia"), `aside` (el círculo del margen, a la derecha de la
// cifra) y `notice` (el aviso único); "Vendí" y "Compré" pueden traer `sparkline`. No hay ningún
// signo ni operador entre las tarjetas: la ganancia no se define como ventas menos compras.
function MonthlyCard({amount, aside, children, chipTone = "signed", comparison, explanation, icon: Icon, locale, notice, onOpenDetail, referenceText, shortNote, sparkline = null, subtitle, title, variant = "default"}) {
  // El chip solo existe con mes cerrado y base; en el mes en curso va la referencia del mes anterior completo.
  const chip = !referenceText && comparison?.hasBase ? <ComparisonChip chipTone={chipTone} comparison={comparison} locale={locale} /> : null;
  const main = <>
    <div className="reports-month-amount-row">{amount}{chip}</div>
    {children}
  </>;
  // La cifra va siempre justo bajo el título; el círculo (aside) o la mini-línea quedan a su derecha
  // y el resto (aviso, nota, enlace) baja a todo el ancho de la tarjeta. La mini-línea solo llega con 3 o más puntos.
  const figure = aside
    ? <div className="reports-profit-card__body"><div className="reports-profit-card__main">{main}</div>{aside}</div>
    : sparkline
      ? <div className="reports-month-figure">{main}{sparkline}</div>
      : main;
  return <article className={`reports-simple-card reports-simple-card--${variant}`}>
    <div className="reports-simple-card__top">
      <span className="reports-simple-card__icon"><Icon size={19} aria-hidden="true" /></span>
      <span className="reports-simple-card__title">
        {subtitle ? <strong className="reports-simple-card__heading">{title}</strong> : title}
        {subtitle && <span className="reports-simple-card__subtitle">{subtitle}</span>}
      </span>
      <ReportsInfoTip label={`Qué incluye ${title}`}>{explanation}</ReportsInfoTip>
    </div>
    {figure}
    {notice}
    {referenceText ? <ReferenceLine text={referenceText} /> : comparison && !comparison.hasBase && <ComparisonLine comparison={comparison} locale={locale} />}
    <small>{shortNote}</small>
    {onOpenDetail && <Button type="button" variant="ghost" className="reports-month-card-link" icon={ArrowRight} iconSize={14} onClick={onOpenDetail}>Ver detalle</Button>}
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

// Bajo la cifra de "Me quedó": la frase del margen ("De cada $100 que vendes, te quedan
// $X") con su nota de base ("sobre $N de ventas consideradas") solo cuando difiere de
// "Vendí". El ícono de sentido (sube o baja) acompaña al color; ambos son refuerzo de la
// frase, que dice el sentido.
function ProfitDetails({description}) {
  const Icon = MARGIN_ICONS[description.ring.tone];
  return <>
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
  operationalTimeline = [],
  previousProfit,
  previousSummary,
  profit,
  projects,
  purchaseTimeline = [],
  salesTimeline = [],
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
    {/* El aviso de "sin datos del mes anterior" va en la misma fila del selector de mes (en pantallas angostas baja debajo), sin ocupar una línea propia. */}
    <div className="reports-month-bar">
      <div className="reports-month-nav" role="group" aria-label="Mes del resumen">
        <Button type="button" variant="secondary" icon={ChevronLeft} aria-label="Mes anterior" onClick={() => onMonthChange(shiftMonthKey(month, -1))} />
        <strong className="reports-month-nav__label">{formatMonthLabel(month, locale)}</strong>
        <Button type="button" variant="secondary" icon={ChevronRight} aria-label="Mes siguiente" disabled={!canShowNextMonth(month, todayKey)} onClick={() => onMonthChange(shiftMonthKey(month, 1))} />
      </div>
      {hasCards && !showComparison && <p className="reports-month-no-previous">{NO_PREVIOUS_MONTH_TEXT}</p>}
    </div>

    {!hasCards && <div className="erp-card reports-simple-state">Tu perfil no incluye informes con cifras del mes.</div>}

    {hasCards && <div className="reports-simple-currencies">{groups.map((group, index) => {
      const money = (value) => formatReportMoney(value, group.currency, locale);
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
      // Mini-líneas: los días con ventas (o compras) del mes, tal como los entrega la línea de tiempo.
      // Con menos de 3 puntos no se dibuja nada. "Me quedó" no lleva: la ganancia no existe por día.
      const sparklineOf = (timeline, kind, noun) => {
        const points = trendItemsFor(timeline, group.currency);
        return points.length >= SPARKLINE_MIN_POINTS
          ? <ReportsSparkline kind={kind} label={sparklineLabel(points, noun, money, locale)} points={points} />
          : null;
      };
      return <section className="reports-simple-currency-group" key={group.currency}>
        {groups.length > 1 && <h2>{group.currency}</h2>}
        <div className="reports-simple-metrics reports-simple-metrics--visual">
          {canViewSales && <MonthlyCard amount={<strong className="reports-simple-card__amount">{money(group.sales.total)}</strong>} comparison={showComparison ? group.sales.comparison : null} explanation={MONTHLY_EXPLANATIONS.sales} icon={BadgeDollarSign} locale={locale} onOpenDetail={links.sales ? () => onOpenDetail("ventas") : null} referenceText={showComparison ? referenceOf(group.sales) : null} shortNote={MONTHLY_SHORT_NOTES.sales} sparkline={sparklineOf(salesTimeline, "sales", "Ventas")} title="Vendí" variant="sales" />}
          {canViewPurchases && <MonthlyCard amount={<strong className="reports-simple-card__amount">{money(group.purchases.total)}</strong>} chipTone="neutral" comparison={showComparison ? group.purchases.comparison : null} explanation={MONTHLY_EXPLANATIONS.purchases} icon={ShoppingCart} locale={locale} onOpenDetail={links.purchases ? () => onOpenDetail("compras") : null} referenceText={showComparison ? referenceOf(group.purchases) : null} shortNote={MONTHLY_SHORT_NOTES.purchases} sparkline={sparklineOf(purchaseTimeline, "purchases", "Compras")} title="Compré" variant="purchases" />}
          {canViewProfitability && group.profit && <MonthlyCard amount={<ProfitAmount amountText={money(group.profit.amount)} onRetry={onRetryProfit} profit={group.profit} />} aside={marginDescription.kind === "pending" ? null : <MarginRing description={marginDescription} locale={locale} />} comparison={showComparison && group.profit.status === "ready" ? group.profit.comparison : null} explanation={MONTHLY_EXPLANATIONS.profit} icon={TrendingUp} locale={locale} notice={<ReportsProfitNotice currency={group.currency} lines={profitLines} locale={locale} onNavigate={onNavigate} onOpenDetail={onOpenDetail} />} onOpenDetail={() => onOpenDetail("ganancias")} referenceText={showComparison && group.profit.status === "ready" ? referenceOf(group.profit) : null} shortNote={MONTHLY_SHORT_NOTES.profit} subtitle="Ganancia" title="Me quedó" variant="profit">
            <ProfitDetails description={marginDescription} />
          </MonthlyCard>}
        </div>
        {!showsProfitCard && <ReportsProfitNotice currency={group.currency} lines={profitLines} locale={locale} onNavigate={onNavigate} onOpenDetail={onOpenDetail} variant="standalone" />}
        <ReportsMonthlyTrend canViewPurchases={canViewPurchases} canViewSales={canViewSales} currency={group.currency} items={operationalTimeline} showCurrency={groups.length > 1} />
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
