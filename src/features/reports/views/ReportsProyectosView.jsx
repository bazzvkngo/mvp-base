import React from "react";
import {ArrowRight} from "lucide-react";
import CostCompositionChart from "../../../components/reports/CostCompositionChart";
import Button from "../../../components/ui/Button";
import {getWorkStatusLabel} from "../../../domain/workModel.mjs";
import {formatPercent} from "../ReportsSharedCards";
import {formatMoney} from "../../../utils/formatters";

const MAX_PROJECTS_PER_CURRENCY = 6;

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

// Vista dedicada a Proyectos: usa el balance autoritativo existente
// (Work Balance) tal cual — no redefine el resultado ni el margen de cada
// proyecto, sólo lo presenta en su propio espacio en vez de compartir el
// resumen ejecutivo con Ventas/Compras.
function ReportsProyectosView({canViewProfitability, links, navigate, profitability, summary}) {
  return <>
    <p className="reports-simple-project-note">La rentabilidad de proyectos considera únicamente ingresos y costos asociados a cada proyecto; corresponde al balance actual autoritativo y no se atribuye al período seleccionado.</p>

    <section className="erp-card reports-profitability">
      <div className="reports-section-heading"><div><span>Rentabilidad operativa</span><h2>Rentabilidad de proyectos</h2><p>Ingresos y costos provenientes del balance autoritativo de cada proyecto.</p></div>{links.works && <button type="button" onClick={() => navigate("/trabajos")}>Ver proyectos<ArrowRight size={14} /></button>}</div>
      {!canViewProfitability ? <div className="reports-profitability-empty">Tu perfil no incluye información de rentabilidad.</div> : <div className="reports-profitability-groups">{summary.currencies.map((group) => <ProfitabilitySummary currency={group.currency} group={profitability.groups.find((entry) => entry.currency === group.currency)} key={group.currency} />)}</div>}
    </section>

    {canViewProfitability && <section className="erp-card reports-projects">
      <div className="reports-section-heading"><div><span>Rentabilidad operativa</span><h2>Resultados por proyecto</h2><p>Proyectos con balance completo, ordenados por resultado absoluto.</p></div>{links.works && <button type="button" onClick={() => navigate("/trabajos")}>Ver proyectos<ArrowRight size={14} /></button>}</div>
      <ProjectResults groups={profitability.groups} navigate={navigate} showLink={links.works} />
    </section>}
  </>;
}

export default ReportsProyectosView;
