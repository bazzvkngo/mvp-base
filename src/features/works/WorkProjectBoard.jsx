import React, {useState} from "react";
import {ExternalLink, Plus, RefreshCw} from "lucide-react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import StatusBadge from "../../components/ui/StatusBadge";
import {TabPanel, Tabs} from "../../components/ui/Tabs";
import {WORK_COST_SCOPE_ORPHAN, filterWorkCostsByTaskScope, getVisibleWorkTasks, getWorkCostSummary, getWorkStatusLabel, getWorkTaskProgress} from "../../domain/workModel.mjs";
import {formatMoney} from "../../utils/formatters.js";
import useBusinessFormat from "../../hooks/useBusinessFormat";
import WorkTaskBoard from "./WorkTaskBoard.jsx";
import WorkTaskCreateDialog from "./WorkTaskCreateDialog.jsx";
import WorkTaskPanel from "./WorkTaskPanel.jsx";

// Vista Tablero de /trabajos (SPEC 028 etapas B y B2): se elige UN proyecto y se
// ven solo sus tareas como tarjetas compactas en tres columnas (Por hacer, En
// curso, Hecho; las tareas en espera van dentro de En curso). Al hacer clic en
// una tarjeta se abre WorkTaskPanel (panel lateral; diálogo completo en móvil)
// con descripción, responsable, estado, subtareas, documentación y costos. "Nueva
// tarea" abre un formulario corto. Los costos de la tarea (con el `tareaId` ya
// asociado) se abren en un diálogo con pestañas Gastos, Horas hombre y
// Materiales. Dos tarjetas más reciben los costos sin tarea: "General" y "Sin
// tarea asignada".
//
// Presentacional: no importa servicios ni Firebase. Recibe el proyecto, su
// ficha ya cargada y `actions`, un conjunto de callbacks que la página resuelve
// con las mismas Functions y los mismos requestId de siempre (cada una
// devuelve una promesa con true si la acción se aplicó). `renderCosts(scope,
// section)` devuelve la sección de costos ("gastos", "horas" o "materiales")
// acotada a una tarea.

const GENERAL_SCOPE = "";
const COST_TABS = Object.freeze([
  {id: "gastos", label: "Gastos"},
  {id: "horas", label: "Horas hombre"},
  {id: "materiales", label: "Materiales"},
]);

function projectOptionLabel(work) {
  const closed = ["completado", "cancelado"].includes(work.estado) ? ` (${getWorkStatusLabel(work.estado)})` : "";
  return `${work.numero} · ${work.titulo}${closed}`;
}

function LoadFailure({message, onRetry}) {
  return (
    <div className="works-message works-message--error works-load-error" role="alert">
      <span>{message}</span>
      <Button type="button" variant="secondary" icon={RefreshCw} onClick={onRetry}>Reintentar</Button>
    </div>
  );
}

function CostCard({amount, currency, description, label, onOpen, openLabel}) {
  const {locale: businessLocale} = useBusinessFormat();
  return (
    <article className="works-task-board__card works-project-board__cost-card">
      <div className="works-project-board__cost-text">
        <strong>{label}</strong>
        <p className="works-project-board__description">{description}</p>
      </div>
      <dl><div><dt>Costo asignado</dt><dd>{formatMoney(amount, currency, businessLocale)}</dd></div></dl>
      <Button type="button" variant="secondary" onClick={onOpen}>{openLabel}</Button>
    </article>
  );
}

export default function WorkProjectBoard({
  actions, canManage, canOperate, costs, currency, currentUserUid, detail, error, loading, members, onOpenFicha, onRetry, onSelectWork,
  processing, projectCost, renderCosts, terminal, work, workId, works,
}) {
  const {locale: businessLocale} = useBusinessFormat();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [waitingTask, setWaitingTask] = useState(null);
  const [waitReason, setWaitReason] = useState("");
  const [costTarget, setCostTarget] = useState(null);
  const [costTab, setCostTab] = useState("gastos");
  const tasks = Array.isArray(detail?.tareas) ? detail.tareas : [];
  const visibleTasks = getVisibleWorkTasks(tasks, {canManage, currentUserUid});
  const selectedTask = loading || error ? null : visibleTasks.find((task) => task.id === selectedTaskId) || null;
  const emptyTasksCopy = canManage ? "Aún no hay tareas." : "No tienes tareas asignadas.";
  const progress = work ? getWorkTaskProgress(work) : null;

  const requestTaskState = (task, estado) => {
    if (estado === "en_espera") { setWaitingTask(task); setWaitReason(""); return; }
    actions.changeTaskState(task, estado);
  };
  const openCosts = (target) => { setCostTab("gastos"); setCostTarget(target); };

  const orphanRecords = [
    ...filterWorkCostsByTaskScope(costs.expenses, WORK_COST_SCOPE_ORPHAN, tasks),
    ...filterWorkCostsByTaskScope(costs.labor, WORK_COST_SCOPE_ORPHAN, tasks),
    ...filterWorkCostsByTaskScope(costs.materials, WORK_COST_SCOPE_ORPHAN, tasks),
  ];
  const generalCost = getWorkCostSummary({...costs, taskId: GENERAL_SCOPE});
  const orphanCost = getWorkCostSummary({
    expenses: filterWorkCostsByTaskScope(costs.expenses, WORK_COST_SCOPE_ORPHAN, tasks),
    labor: filterWorkCostsByTaskScope(costs.labor, WORK_COST_SCOPE_ORPHAN, tasks),
    materials: filterWorkCostsByTaskScope(costs.materials, WORK_COST_SCOPE_ORPHAN, tasks),
  });
  const costTitle = costTarget?.scope === GENERAL_SCOPE ? "General" : costTarget?.scope === WORK_COST_SCOPE_ORPHAN ? "Sin tarea asignada" : costTarget?.title;

  return (
    <section className="works-project-board" aria-label="Tablero del proyecto">
      <div className="works-project-board__header">
        <label className="erp-field works-project-board__picker">
          <span className="erp-field__label">Proyecto</span>
          <select className="erp-control" value={workId} onChange={(event) => onSelectWork(event.target.value)}>
            {works.map((entry) => <option key={entry.id} value={entry.id}>{projectOptionLabel(entry)}</option>)}
          </select>
        </label>
        {work && (
          <div className="works-project-board__actions">
            <Button type="button" variant="secondary" icon={ExternalLink} onClick={onOpenFicha}>Ver ficha</Button>
            {canManage && !terminal && <Button type="button" icon={Plus} disabled={loading || Boolean(error)} onClick={() => setCreateOpen(true)}>Nueva tarea</Button>}
          </div>
        )}
      </div>

      {work && (
        <section className="works-project-board__overview" aria-label="Resumen del proyecto">
          <div className="works-project-board__identity">
            <StatusBadge variant={work.estado === "completado" ? "success" : ["cancelado", "en_espera"].includes(work.estado) ? "warning" : "neutral"}>{getWorkStatusLabel(work.estado)}</StatusBadge>
            <span>{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</span>
          </div>
          <dl className="works-project-board__metrics">
            <div className="works-project-board__metric">
              <dt>Avance de tareas</dt>
              <dd>
                <strong>{Math.round(progress.percent)}%</strong>
                <span>{progress.completed}/{progress.total} tareas</span>
                <progress className="works-task-progress" max="100" value={progress.percent} aria-label="Avance de tareas del proyecto" />
              </dd>
            </div>
            <div className="works-project-board__metric works-project-board__metric--primary">
              <dt>Costo acumulado</dt>
              <dd><strong>{formatMoney(projectCost, currency, businessLocale)}</strong></dd>
            </div>
          </dl>
        </section>
      )}

      {terminal && work && <p className="works-message works-message--warning">Este proyecto está {getWorkStatusLabel(work.estado).toLowerCase()}: el tablero es de solo lectura. Reábrelo desde la ficha para operar.</p>}

      {loading ? <LoadingState variant="section" label="Cargando tablero..." /> : error ? <LoadFailure message={error} onRetry={onRetry} /> : (
        <>
          <div className="works-project-board__costs" role="group" aria-label="Costos sin tarea">
            <CostCard
              amount={generalCost.total}
              currency={currency}
              description="Costos del proyecto que no pertenecen a una tarea."
              label="General"
              onOpen={() => openCosts({scope: GENERAL_SCOPE, title: "General"})}
              openLabel="Gastos, HH y materiales"
            />
            {orphanRecords.length > 0 && (
              <CostCard
                amount={orphanCost.total}
                currency={currency}
                description="Costos de tareas que ya no existen. Solo lectura."
                label="Sin tarea asignada"
                onOpen={() => openCosts({scope: WORK_COST_SCOPE_ORPHAN, title: "Sin tarea asignada"})}
                openLabel="Ver costos"
              />
            )}
          </div>

          <WorkTaskBoard
            costs={costs}
            currency={currency}
            emptyCopy={emptyTasksCopy}
            members={members}
            onAddTask={canManage && !terminal ? () => setCreateOpen(true) : undefined}
            onOpenTask={(task) => setSelectedTaskId(task.id)}
            tasks={visibleTasks}
          />
        </>
      )}

      <WorkTaskPanel
        actions={actions}
        canManage={canManage}
        canOperate={canOperate}
        costs={costs}
        currency={currency}
        members={members}
        onClose={() => setSelectedTaskId("")}
        onOpenCosts={openCosts}
        onRequestTaskState={requestTaskState}
        processing={processing}
        task={selectedTask}
        terminal={terminal}
      />

      <WorkTaskCreateDialog members={members} onClose={() => setCreateOpen(false)} onSubmit={actions.createTask} open={createOpen && canManage && !terminal} processing={processing} />

      <ResponsiveDialog
        open={Boolean(waitingTask)}
        onClose={() => !processing && setWaitingTask(null)}
        size="small"
        eyebrow="Tarea"
        title="Poner tarea en espera"
        description="El motivo quedará en el historial."
        footer={<><Button type="button" variant="secondary" onClick={() => setWaitingTask(null)}>Volver</Button><Button type="button" disabled={Boolean(processing) || !waitReason.trim()} onClick={() => actions.changeTaskState(waitingTask, "en_espera", waitReason.trim()).then((success) => { if (success) { setWaitingTask(null); setWaitReason(""); } })}>Confirmar espera</Button></>}
      >
        <label className="erp-field">
          <span className="erp-field__label">Motivo *</span>
          <textarea className="erp-control" rows="3" maxLength="1000" value={waitReason} onChange={(event) => setWaitReason(event.target.value)} />
        </label>
      </ResponsiveDialog>

      <ResponsiveDialog
        className="works-cost-dialog"
        open={Boolean(costTarget)}
        onClose={() => setCostTarget(null)}
        size="large"
        eyebrow={work?.numero}
        title={`Costos · ${costTitle || ""}`}
        description={costTarget?.scope === WORK_COST_SCOPE_ORPHAN ? "Registros de tareas que ya no existen: puedes consultarlos y anularlos." : costTarget?.scope === GENERAL_SCOPE ? "Costos generales del proyecto, sin tarea." : "Los registros quedan asociados a esta tarea."}
      >
        {costTarget && (
          <>
            <Tabs className="works-cost-tabs" idPrefix="work-costs" label="Tipo de costo" onChange={setCostTab} tabs={COST_TABS} value={costTab} />
            {COST_TABS.map((tab) => (
              <TabPanel key={tab.id} active={costTab === tab.id} id={tab.id} idPrefix="work-costs">{renderCosts(costTarget.scope, tab.id)}</TabPanel>
            ))}
          </>
        )}
      </ResponsiveDialog>
    </section>
  );
}
