import React from "react";
import {TrendingDown} from "lucide-react";
import {OPERATIONAL_NET_PROFIT_COVERAGE as COVERAGE} from "../../domain/operationalNetProfit.mjs";
import {describePeriod, describeProductsBar} from "../../domain/reportProfitOverview.mjs";
import useBusinessFormat from "../../hooks/useBusinessFormat";
import {formatMoney} from "../../utils/formatters";
import {ProfitNote, ServicesWithoutCostNote, visibleOperationalGroups} from "./OperationalNetProfitBreakdown";

// Parte superior de la pestaña Ganancia (SPEC 025, Ganancia visual): "Me quedó",
// su margen en texto y la barra de lo que se vendió en productos. Una tarjeta por
// moneda. Todo sale del grupo que calcula calculateOperationalNetProfit; la
// proporción de la barra la prepara describeProductsBar. Este archivo solo
// presenta: no suma ni divide nada.
//
// Bajo la barra van la nota fija de la ganancia y "Ventas sin costo registrado":
// el resto del cálculo vive plegado en la vista.
//
// El costo y la ganancia no se distinguen solo por color: el costo va a la
// izquierda y rayado, la ganancia a la derecha y lisa, y la leyenda los nombra con
// su importe y su porcentaje. La barra no lleva texto dentro.

function marginText(value, locale) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat(locale, {maximumFractionDigits: 2}).format(value)} %`;
}

function ProductsBar({bar, currency, locale}) {
  return <div className="reports-products-bar">
    <p className="reports-products-bar__title">{bar.title}</p>
    <div className="reports-products-bar__track" role="img" aria-label={bar.ariaLabel}>
      {bar.segments.map((segment) => <span className={`reports-products-bar__segment reports-products-bar__segment--${segment.id}`} key={segment.id} style={{flexGrow: segment.flex}} />)}
      {bar.kind === "loss" && <span className="reports-products-bar__loss" />}
    </div>
    <ul className="reports-products-bar__legend">
      {bar.legend.map((item) => <li key={item.id}>
        <span className={`reports-products-bar__swatch reports-products-bar__swatch--${item.id}`} aria-hidden="true" />
        {item.id === "loss" && <TrendingDown size={14} aria-hidden="true" />}
        <span>{item.text}</span>
        <strong>{formatMoney(item.amount, currency, locale)}</strong>
      </li>)}
    </ul>
  </div>;
}

function ProfitSummaryCard({currentMonthKey, group, range, showCurrency}) {
  const {locale} = useBusinessFormat();
  const period = describePeriod(range, {locale, currentMonthKey});
  const currency = group.moneda || undefined;
  const profit = typeof group.gananciaNetaOperacional === "number" && Number.isFinite(group.gananciaNetaOperacional) ? group.gananciaNetaOperacional : null;
  const tone = profit === null ? "none" : profit > 0 ? "up" : profit < 0 ? "down" : "zero";
  const margin = marginText(group.gananciaNetaOperacionalPct, locale);
  const bar = describeProductsBar(group, {locale});
  return <section className="erp-card reports-profit-hero">
    <div className="reports-profit-hero__head">
      <div className="reports-profit-hero__main">
        <div className="reports-profit-hero__label">
          <h2 className="reports-profit-hero__title">Me quedó<span className="sr-only"> {period.phrase}</span></h2>
          {group.cobertura === COVERAGE.PARTIAL && <span className="reports-v4-badge reports-v4-badge--parcial">Parcial</span>}
          {showCurrency && <span className="reports-profit-hero__currency">{currency || "Moneda no declarada"}</span>}
        </div>
        <strong className={`reports-profit-hero__amount reports-profit-hero__amount--${tone}`}>{profit === null ? "—" : formatMoney(profit, currency, locale)}</strong>
      </div>
      {margin && <div className="reports-profit-hero__margin">
        <strong>{margin}</strong>
        <span>margen sobre ventas</span>
      </div>}
    </div>
    {bar.show && <ProductsBar bar={bar} currency={currency} locale={locale} />}
    <div className="reports-profit-hero__notes">
      <ProfitNote />
      <ServicesWithoutCostNote group={group} />
    </div>
  </section>;
}

// `state`: el estado de useOperationalNetProfit. Mientras carga o si falla, lo
// dice el desglose de más abajo (un solo indicador de carga por pantalla), y un
// grupo sin datos no tiene "Me quedó" que mostrar.
// `range` y `currentMonthKey` ("AAAA-MM", lo pasa la vista porque los helpers no
// leen el reloj) nombran el período para quien usa lector de pantalla.
function ProfitSummaryCards({currency, currentMonthKey = null, range = null, state}) {
  if (state?.status !== "ready") return null;
  const groups = visibleOperationalGroups(state.result, currency).filter((group) => group.cobertura !== COVERAGE.EMPTY);
  if (!groups.length) return null;
  return <div className="reports-profit-heroes">
    {groups.map((group) => <ProfitSummaryCard currentMonthKey={currentMonthKey} group={group} key={group.moneda || "sin-moneda"} range={range} showCurrency={groups.length > 1} />)}
  </div>;
}

export default ProfitSummaryCards;
