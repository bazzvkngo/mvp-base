import React from "react";
import {Trash2} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import {WORK_TASK_STATUSES, getTaskProgress, getWorkCostSummary, getWorkMemberIdentity, getWorkTaskStatusOptions} from "../../domain/workModel.mjs";
import {formatDate, formatMoney} from "../../utils/formatters.js";

// Tablero de tareas del Proyecto abierto (PROJECTS_V3 ETAPA 2, SPEC 019 §5).
// Presentacional/controlado: recibe exclusivamente `tasks` ya acotadas al
// Proyecto actual (el mismo arreglo visibleTasks que ya renderiza la lista
// de TaskSection en WorksPage.jsx) y las callbacks ya existentes
// (onRequestTaskState -> cambiarEstadoTareaTrabajo, onRemoveLegacy ->
// eliminarTareaTrabajo). No define ninguna mutación propia, no hace ninguna
// consulta remota y no recibe ningún identificador de negocio ni de
// Proyecto: por construcción no puede leer ni mutar tareas de otro
// Proyecto. Sin drag-and-drop: el cambio de estado reutiliza el mismo
// <select> ya usado por la vista de lista.

function responsableLabel(task) {
  return task.responsableUid ? getWorkMemberIdentity(task.responsableSnapshot || {}) : "Sin responsable";
}

function TaskCard({canManage, canOperate, costs, currency, onRemoveLegacy, onRequestTaskState, processing, task, terminal}) {
  const progress = getTaskProgress(task);
  const taskCost = getWorkCostSummary({...costs, taskId: task.id});
  const operable = canOperate(task);
  const showStateControl = !terminal && operable && (!task.completada || canManage);
  const showDelete = canManage && task.modeloTareaVersion < 2 && !task.completada;

  return (
    <article className="works-task-board__card">
      <strong>{task.titulo}</strong>
      <dl>
        <div><dt>Responsable</dt><dd>{responsableLabel(task)}</dd></div>
        {progress.total > 0 && <div><dt>Subtareas</dt><dd>{progress.completed}/{progress.total} · {progress.percent}%</dd></div>}
        <div><dt>Costo asignado</dt><dd>{formatMoney(taskCost.total, currency)}</dd></div>
        <div><dt>Creada</dt><dd>{formatDate(task.creadoEn)}</dd></div>
      </dl>
      {task.estado === "en_espera" && task.motivoEspera && <p className="works-wait-reason">En espera: {task.motivoEspera}</p>}
      {task.modeloTareaVersion < 2 && <span className="works-task-board__legacy">Tarea legacy</span>}
      {showStateControl && (
        <div className="works-task-board__actions">
          <label className="sr-only" htmlFor={`board-task-state-${task.id}`}>Cambiar estado de {task.titulo}</label>
          <select
            id={`board-task-state-${task.id}`}
            className="erp-control"
            value={task.estado}
            disabled={Boolean(processing)}
            onChange={(event) => onRequestTaskState(task, event.target.value)}
          >
            {getWorkTaskStatusOptions(task, {canManage}).map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
          {showDelete && (
            <button type="button" aria-label={`Eliminar ${task.titulo}`} disabled={Boolean(processing)} onClick={() => onRemoveLegacy(task)}>
              <AppIcon icon={Trash2} size={15} />
            </button>
          )}
        </div>
      )}
      {!operable && <span className="works-task-board__readonly">Sólo lectura</span>}
    </article>
  );
}

export default function WorkTaskBoard({canManage, canOperate, costs, currency, emptyCopy, onRemoveLegacy, onRequestTaskState, processing, tasks, terminal}) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (!list.length) return <p className="works-empty-copy">{emptyCopy}</p>;

  return (
    <div className="works-task-board">
      {WORK_TASK_STATUSES.map((column) => {
        const columnTasks = list.filter((task) => task.estado === column.value);
        return (
          <section className="works-task-board__column" key={column.value}>
            <header><h4>{column.label}</h4><span>{columnTasks.length}</span></header>
            <div className="works-task-board__list">
              {columnTasks.map((task) => (
                <TaskCard
                  canManage={canManage}
                  canOperate={canOperate}
                  costs={costs}
                  currency={currency}
                  key={task.id}
                  onRemoveLegacy={onRemoveLegacy}
                  onRequestTaskState={onRequestTaskState}
                  processing={processing}
                  task={task}
                  terminal={terminal}
                />
              ))}
              {!columnTasks.length && <p className="works-task-board__column-empty">Sin tareas en este estado.</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
