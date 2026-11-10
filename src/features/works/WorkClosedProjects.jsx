import React, {useState} from "react";
import {RefreshCw, Scale, Search, TrendingDown, TrendingUp} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import EmptyStateIllustration from "../../components/ui/EmptyStateIllustration";
import Skeleton from "../../components/ui/Skeleton";
import StatusBadge from "../../components/ui/StatusBadge";
import {WORK_CLOSED_BALANCE_LIMIT, getClosedWorks, getWorkClosedAt, getWorkClosedResultKind, getWorkDurationSummary, getWorkStatusLabel, matchesWorkFilters} from "../../domain/workModel.mjs";
import {formatDate, formatMoney} from "../../utils/formatters.js";
import useBusinessFormat from "../../hooks/useBusinessFormat";

// Vista "Cerrados" de /trabajos (SPEC 028 etapa B2): proyectos completados y
// cancelados, el cierre más reciente primero, con cliente, fecha de cierre y
// duración (planificada contra real). Solo quien tiene canViewWorkProfitability
// (`canViewProfitability`) ve además ingresos, costos, resultado y margen, que
// vienen del balance del trabajo para los 20 cierres más recientes; sin ese
// permiso las columnas monetarias ni se dibujan.
//
// Presentacional: no importa servicios ni consulta nada. La página resuelve la lista
// (`works`) y los balances (`balances`: id de proyecto -> balance), y cada fila
// llama a `onOpenWork(work)`. Estados: el error de la lista (rama de error de la
// página) nunca llega aquí; el error de balances (`balancesError`) es otro
// aviso, con Reintentar, y deja la lista visible con lo no monetario. El vacío
// real ("Aún no hay proyectos cerrados") solo aparece sin proyectos cerrados.

function durationText({plannedDays, actualDays, deltaDays}) {
  const days = (value) => (value == null ? "—" : `${value} d`);
  const delta = deltaDays == null || deltaDays === 0 ? "" : deltaDays > 0 ? ` (+${deltaDays} d)` : ` (−${Math.abs(deltaDays)} d)`;
  return `Plan ${days(plannedDays)} · Real ${days(actualDays)}${delta}`;
}

export function ResultBadge({balance, kind}) {
  if (kind === "gano") return <StatusBadge variant="success"><AppIcon icon={TrendingUp} size={14} />Ganó</StatusBadge>;
  if (kind === "perdio") return <StatusBadge variant="danger"><AppIcon icon={TrendingDown} size={14} />Perdió</StatusBadge>;
  if (kind === "equilibrio") return <StatusBadge variant="neutral"><AppIcon icon={Scale} size={14} />Sin ganancia ni pérdida</StatusBadge>;
  return <span className="works-empty-line">{balance ? "Sin resultado" : "No disponible"}</span>;
}

function ClosedFinancials({balance, loading, locale}) {
  if (loading) return <Skeleton width="70%" />;
  if (!balance) return <span className="works-empty-line">No disponible</span>;
  const usable = balance.estado !== "INCONSISTENTE_MONEDA";
  const money = (value) => (usable && value != null ? formatMoney(value, balance.moneda, locale) : "No disponible");
  const kind = getWorkClosedResultKind(balance);
  return (
    <dl className="works-closed__financials">
      <div><dt>Ingresos</dt><dd>{usable && balance.valorComercial == null ? "Sin ingreso confirmado" : money(balance.valorComercial)}</dd></div>
      <div><dt>Costos</dt><dd>{money(balance.costoTotal)}</dd></div>
      <div><dt>Resultado</dt><dd><ResultBadge balance={balance} kind={kind} />{kind !== "no_disponible" && <span>{money(balance.resultado)}</span>}</dd></div>
      <div><dt>Margen</dt><dd>{usable && balance.rentabilidadPct != null ? `${balance.rentabilidadPct.toLocaleString("es-CL", {maximumFractionDigits: 2})}%` : "No disponible"}</dd></div>
    </dl>
  );
}

export default function WorkClosedProjects({balances, balancesError, balancesLoading, canViewProfitability, onOpenWork, onRetryBalances, works}) {
  const {locale} = useBusinessFormat();
  const [query, setQuery] = useState("");
  const closed = getClosedWorks(works);

  if (!closed.length) {
    return (
      <div className="erp-empty-state ui-empty-state">
        <EmptyStateIllustration variant="empty-list" />
        <h3>Aún no hay proyectos cerrados</h3>
        <p>Los proyectos completados y cancelados aparecerán aquí.</p>
      </div>
    );
  }

  const withBalance = new Set(closed.slice(0, WORK_CLOSED_BALANCE_LIMIT).map((work) => work.id));
  const visible = closed.filter((work) => matchesWorkFilters(work, {query}));
  const balanceCell = (work) => (
    withBalance.has(work.id)
      ? <ClosedFinancials balance={balances?.[work.id] || null} loading={balancesLoading && !balances?.[work.id]} locale={locale} />
      : <span className="works-empty-line">—</span>
  );
  const openLabel = (work) => `Abrir ${work.numero} ${work.titulo}`;

  return (
    <div className="works-closed">
      <div className="erp-filters works-closed__filters">
        <label className="erp-field works-search"><span className="erp-field__label">Buscar por número, título o cliente</span><span className="works-search-control"><AppIcon icon={Search} size={18} /><input className="erp-control" value={query} onChange={(event) => setQuery(event.target.value)} /></span></label>
        <span className="works-closed__count">{visible.length} cerrado{visible.length === 1 ? "" : "s"}</span>
      </div>

      {canViewProfitability && balancesLoading && <span className="sr-only" role="status">Cargando balances...</span>}
      {canViewProfitability && balancesError && (
        <div className="works-message works-message--error works-load-error" role="alert">
          <span>{balancesError}</span>
          <Button type="button" variant="secondary" icon={RefreshCw} onClick={onRetryBalances}>Reintentar</Button>
        </div>
      )}
      {canViewProfitability && closed.length > WORK_CLOSED_BALANCE_LIMIT && <p className="works-closed__note">Ingresos, costos y resultado: solo los {WORK_CLOSED_BALANCE_LIMIT} cierres más recientes.</p>}

      {!visible.length ? (
        <p className="works-empty-copy">Ningún proyecto cerrado coincide con la búsqueda.</p>
      ) : (
        <>
          <div className="erp-table-region erp-desktop-only">
            <table className="erp-table works-table works-closed__table">
              <thead><tr><th>Proyecto</th><th>Cliente</th><th>Cierre</th><th>Duración</th>{canViewProfitability && <th>Balance</th>}</tr></thead>
              <tbody>
                {visible.map((work) => (
                  <tr key={work.id}>
                    <td><button className="works-link" type="button" aria-label={openLabel(work)} onClick={() => onOpenWork(work)}><strong>{work.numero}</strong><span>{work.titulo}</span></button></td>
                    <td>{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</td>
                    <td><div className="works-closed__close"><StatusBadge variant={work.estado === "completado" ? "success" : "warning"}>{getWorkStatusLabel(work.estado)}</StatusBadge><span>{formatDate(getWorkClosedAt(work), locale)}</span></div></td>
                    <td>{durationText(getWorkDurationSummary(work))}</td>
                    {canViewProfitability && <td>{balanceCell(work)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="erp-card-list erp-mobile-only">
            {visible.map((work) => (
              <article key={work.id} className="erp-record-card">
                <header className="erp-record-card__header">
                  <div><span className="works-number">{work.numero}</span><h3 className="erp-record-card__title">{work.titulo}</h3></div>
                  <StatusBadge variant={work.estado === "completado" ? "success" : "warning"}>{getWorkStatusLabel(work.estado)}</StatusBadge>
                </header>
                <dl className="erp-meta-grid">
                  <div className="erp-meta"><dt className="erp-meta__label">Cliente</dt><dd className="erp-meta__value">{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</dd></div>
                  <div className="erp-meta"><dt className="erp-meta__label">Cierre</dt><dd className="erp-meta__value">{formatDate(getWorkClosedAt(work), locale)}</dd></div>
                  <div className="erp-meta"><dt className="erp-meta__label">Duración</dt><dd className="erp-meta__value">{durationText(getWorkDurationSummary(work))}</dd></div>
                </dl>
                {canViewProfitability && balanceCell(work)}
                <div className="works-card-actions"><Button type="button" variant="secondary" aria-label={`Ver ficha de ${work.numero} ${work.titulo}`} onClick={() => onOpenWork(work)}>Ver ficha</Button></div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
