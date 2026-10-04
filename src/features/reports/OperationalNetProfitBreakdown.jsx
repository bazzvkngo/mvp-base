import React, {useMemo} from "react";
import {RefreshCw} from "lucide-react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import {
  calculateOperationalNetProfit,
  OPERATIONAL_NET_PROFIT_COVERAGE as COVERAGE,
} from "../../domain/operationalNetProfit.mjs";
import {formatMoney} from "../../utils/formatters";
import useBusinessFormat from "../../hooks/useBusinessFormat";

// SPEC 022 §6.2: ganancia neta operacional, su desglose y la línea de ventas
// sin costo registrado. La cifra sale de calculateOperationalNetProfit; este
// archivo sólo la presenta, nunca suma bloques por su cuenta.

const INITIAL_STATE = Object.freeze({status: "loading", result: null, error: ""});

// Combina las dos cargas que ya hace useReportProfitabilityV4 (Ventas del
// rango y balances de Proyecto). Un error de Proyectos no bloquea el cálculo:
// llega como alerta A9 y cobertura parcial.
export function useOperationalNetProfit(profitabilityV4, range) {
  const {commercial, projects} = profitabilityV4;
  return useMemo(() => {
    if (commercial.status === "error") return {status: "error", result: null, error: commercial.error};
    if (commercial.status !== "ready" || projects.status === "loading") return INITIAL_STATE;
    try {
      return {
        status: "ready",
        error: "",
        result: calculateOperationalNetProfit({
          sales: commercial.meta?.items || [],
          projectBalances: projects.meta?.proyectos || [],
          period: {desde: range.start, hasta: range.end},
          salesTruncated: Boolean(commercial.meta?.lecturaTruncada),
          projectsError: projects.status === "error",
        }),
      };
    } catch (error) {
      return {status: "error", result: null, error: error?.message || "No fue posible calcular la ganancia neta operacional."};
    }
  }, [commercial, projects, range.end, range.start]);
}

function money(value, currency, businessLocale) {
  return value == null ? "—" : formatMoney(value, currency, businessLocale);
}

function percent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("es-CL", {maximumFractionDigits: 2})} %`;
}

export function visibleOperationalGroups(result, currency) {
  const groups = result?.grupos || [];
  return currency && currency !== "todos" ? groups.filter((group) => group.moneda === currency) : groups;
}

function BreakdownTable({caption, rows, currency}) {
  const { locale: businessLocale } = useBusinessFormat();
  return <div className="reports-top-list-table-wrap"><table className="reports-top-list-table">
    <caption className="reports-detail-subheading">{caption}</caption>
    <tbody>{rows.map(([label, value, strong]) => <tr key={label}>
      <th scope="row">{strong ? <strong>{label}</strong> : label}</th>
      <td>{strong ? <strong>{money(value, currency, businessLocale)}</strong> : money(value, currency, businessLocale)}</td>
    </tr>)}</tbody>
  </table></div>;
}

function CurrencyBreakdown({group}) {
  const { locale: businessLocale } = useBusinessFormat();
  const partial = group.cobertura === COVERAGE.PARTIAL;
  const sales = group.componentes.ventasSinProyecto;
  const projects = group.componentes.proyectos;
  const currency = group.moneda;
  return <article className="reports-v4-currency-group">
    <header>
      <span>{currency || "Moneda no declarada"}</span>
      <span className={partial ? "reports-v4-badge reports-v4-badge--parcial" : "reports-v4-badge"}>Cobertura {partial ? "parcial" : "completa"}</span>
    </header>

    <dl className="reports-v4-metrics">
      <div className="reports-v4-metrics__primary">
        <dt>{partial ? "Ganancia neta operacional conocida (parcial)" : "Ganancia neta operacional"}</dt>
        <dd className={Number(group.gananciaNetaOperacional) < 0 ? "reports-negative" : undefined}>{money(group.gananciaNetaOperacional, currency, businessLocale)}</dd>
      </div>
      <div>
        <dt>Sobre ingreso neto considerado</dt>
        <dd>{percent(group.gananciaNetaOperacionalPct)}</dd>
        <small>{money(group.ingresoNetoConsiderado, currency, businessLocale)} de ingreso neto</small>
      </div>
    </dl>
    <p className="reports-v4-note">
      Ganancia neta operacional: ventas sin IVA menos costos registrados de productos y proyectos.
      {" "}No incluye gastos generales del negocio.
    </p>

    <div className="reports-detail-grid">
      <BreakdownTable caption="Ventas sin proyecto" currency={currency} rows={[
        ["Ingreso neto de productos", sales.ingresoNetoProductos],
        ["Costo histórico de productos", sales.costoHistoricoProductos],
        ["Margen bruto de productos", sales.margenBrutoProductos, true],
      ]} />
      <BreakdownTable caption="Proyectos" currency={currency} rows={[
        ["Ingreso neto", projects.ingresoNeto],
        ["Materiales de venta", projects.materialesVenta],
        ["Materiales adicionales", projects.materialesAdicionales],
        ["Horas hombre", projects.horasHombre],
        ["Gastos directos", projects.gastosDirectos],
        ["Gastos indirectos", projects.gastosIndirectos],
        ["Resultado de proyectos", projects.resultado, true],
      ]} />
      <BreakdownTable caption="Total" currency={currency} rows={[
        ["Margen bruto de productos sin proyecto", sales.margenBrutoProductos],
        ["Resultado de proyectos", projects.resultado],
        [partial ? "Ganancia neta operacional conocida" : "Ganancia neta operacional", group.gananciaNetaOperacional, true],
      ]} />
    </div>

    {group.ventasSinCostoRegistrado.ventas > 0 && <p className="reports-v4-note">
      Ventas sin costo registrado: {money(group.ventasSinCostoRegistrado.monto, currency, businessLocale)} — servicios vendidos sin
      proyecto. No se incluyen en la ganancia porque no tienen costos asociados.
    </p>}
  </article>;
}

// Puntos 1 a 3 de §6.2. Lo reutilizan Rentabilidad y estado y Ganancias.
export function OperationalNetProfitBreakdown({canView, currency, onRetry, state}) {
  if (!canView) return null;
  if (state.status === "loading") return <LoadingState variant="section" label="Calculando ganancia neta operacional..." />;
  if (state.status === "error") {
    return <div className="reports-v4-state reports-v4-state--error" role="alert">
      <span>{state.error}</span>
      {onRetry && <Button type="button" variant="secondary" icon={RefreshCw} iconSize={14} onClick={onRetry}>Reintentar</Button>}
    </div>;
  }

  const groups = visibleOperationalGroups(state.result, currency);
  if (!groups.length) return <div className="reports-v4-empty">No hay ventas ni costos de proyecto en el período seleccionado.</div>;

  return <div className="reports-v4-currency-groups">
    {state.result.periodo.proyectosPorMesCompleto && <p className="reports-v4-note">
      El período corta un mes: los proyectos aportan ese mes completo, porque su balance se registra por mes.
    </p>}
    {groups.map((group) => <CurrencyBreakdown group={group} key={group.moneda || "sin-moneda"} />)}
  </div>;
}

const ALERT_COPY = Object.freeze({
  A1: {label: "Ventas sin proyecto con productos sin costo histórico", target: "sales"},
  A2: {label: "Ventas con moneda inconsistente en sus costos", target: "sales"},
  A3: {label: "Ventas confirmadas sin neto válido", target: "sales"},
  A4: {label: "Proyectos con costos en el período y sin venta confirmada", target: "works"},
  A5: {label: "Proyectos con materiales vendidos sin costo histórico", target: "works"},
  A6: {label: "Proyectos con monedas incompatibles", target: "works"},
  A7: {label: "Proyectos con registros sin fecha válida", target: "works"},
  A8: {label: "Lectura truncada por límite de rango o de documentos: acota el período", target: null},
  A9: {label: "No fue posible cargar balances de proyecto", target: "works"},
});

const EFFECT_COPY = Object.freeze({
  EXCLUIDAS: "Excluidas; cobertura parcial",
  EXCLUIDOS: "Excluidos; cobertura parcial",
  INCLUIDOS: "Incluidos: sus costos restan",
  COBERTURA_PARCIAL: "Cobertura parcial",
});

const ALERT_PATHS = Object.freeze({sales: "/ventas", works: "/trabajos"});

function AlertRows({alerts, currency, links, onNavigate}) {
  const { locale: businessLocale } = useBusinessFormat();
  return alerts.map((alert) => {
    const copy = ALERT_COPY[alert.id];
    const target = copy?.target && links?.[copy.target] ? ALERT_PATHS[copy.target] : null;
    return <tr key={`${currency || "general"}-${alert.id}`}>
      <td>{copy?.label || alert.clave}</td>
      <td>{currency || "—"}</td>
      <td>{alert.conteo}</td>
      <td>{alert.monto == null ? "—" : money(alert.monto, currency, businessLocale)}</td>
      <td>{EFFECT_COPY[alert.efecto] || alert.efecto}</td>
      <td>{target && onNavigate ? <Button type="button" variant="secondary" onClick={() => onNavigate(target)}>Revisar</Button> : null}</td>
    </tr>;
  });
}

// Punto 4 de §6.2: alertas A1-A9. Sólo se listan las que tienen conteo.
export function OperationalSystemStatus({canView, currency, links, onNavigate, state}) {
  if (!canView || state.status !== "ready") return null;
  const groups = visibleOperationalGroups(state.result, currency).filter((group) => group.alertas.length);
  const general = state.result.alertasGenerales;
  if (!groups.length && !general.length) return <p className="reports-empty-note">Sin alertas en el período seleccionado.</p>;

  return <div className="reports-top-list-table-wrap"><table className="reports-top-list-table">
    <thead><tr><th>Alerta</th><th>Moneda</th><th>Cantidad</th><th>Monto</th><th>Efecto en la ganancia</th><th><span className="sr-only">Acción</span></th></tr></thead>
    <tbody>
      {groups.length ? groups.map((group) => <AlertRows alerts={group.alertas} currency={group.moneda} key={group.moneda || "sin-moneda"} links={links} onNavigate={onNavigate} />)
        : <AlertRows alerts={general} currency={null} links={links} onNavigate={onNavigate} />}
    </tbody>
  </table></div>;
}

export default OperationalNetProfitBreakdown;
