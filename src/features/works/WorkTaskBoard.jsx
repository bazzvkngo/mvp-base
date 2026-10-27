import React from "react";
import {Plus, Trash2} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import StatusBadge from "../../components/ui/StatusBadge";
import {getTaskProgress, getWorkCostSummary, getWorkHistoricalPersonIdentity, getWorkPersonShort, getWorkTaskDeletionState, groupWorkTasksByBoardColumn} from "../../domain/workModel.mjs";
import {formatDate, formatMoney} from "../../utils/formatters.js";
import useBusinessFormat from "../../hooks/useBusinessFormat";

// Tablero de tareas del Proyecto abierto (SPEC 019 §5, compactado en SPEC 028
// etapa B2). Tres columnas (Por hacer, En curso, Hecho) sobre los cuatro estados
// de tarea de siempre: las tareas "en espera" van al final de "En curso" con su
// etiqueta y motivo. La tarjeta es solo un resumen (título, responsable,
// subtareas, costo asignado y espera); al hacer clic llama a `onOpenTask(task)`
// y el detalle y las acciones viven en WorkTaskPanel. Con `onDeleteTask` (solo
// gestión y proyecto abierto) cada tarjeta suma un basurero en su esquina; queda
// deshabilitado, con el motivo como tooltip, si la tarea tiene costos o
// documentación o está completada.
// Presentacional/controlado: recibe exclusivamente `tasks` ya acotadas al
// Proyecto actual (el arreglo visibleTasks que arma WorkProjectBoard). No define
// ninguna mutación propia, no hace ninguna consulta remota y no recibe ningún
// identificador de negocio ni de Proyecto: por construcción no puede leer ni
// mutar tareas de otro Proyecto. Sin drag-and-drop.

// Mismo criterio que el encabezado del panel de la tarea: nombre del snapshot, luego el del
// miembro actual y, si no hay ninguno, el correo.
function responsableLabel(task, members) {
  return task.responsableUid ? getWorkHistoricalPersonIdentity(task.responsableSnapshot, task.responsableUid, members, "Usuario sin identificar") : "";
}

// Hermano del botón de la tarjeta (un botón dentro de otro no es HTML válido). Deshabilitado con
// aria-disabled y no con `disabled` para que siga enfocable y su tooltip (el motivo) se pueda leer.
function TaskDeleteButton({costs, onDeleteTask, task}) {
  const deletion = getWorkTaskDeletionState(task, costs);
  return (
    <button
      type="button"
      className="works-task-card__delete"
      aria-label="Eliminar tarea"
      aria-disabled={deletion.canDelete ? undefined : "true"}
      title={deletion.canDelete ? "Eliminar tarea" : deletion.reason}
      onClick={(event) => { event.stopPropagation(); if (deletion.canDelete) onDeleteTask(task); }}
    >
      <AppIcon icon={Trash2} size={16} />
    </button>
  );
}

function TaskCard({costs, currency, members, onDeleteTask, onOpenTask, task}) {
  const {locale: businessLocale} = useBusinessFormat();
  const progress = getTaskProgress(task);
  const taskCost = getWorkCostSummary({...costs, taskId: task.id});
  const identity = responsableLabel(task, members);
  const person = identity ? getWorkPersonShort(identity) : null;
  const waiting = task.estado === "en_espera";
  const doneAt = task.estado === "completada" && task.completadaEn ? task.completadaEn : "";

  return (
    <div className={onDeleteTask ? "works-task-card works-task-card--deletable" : "works-task-card"}>
      <button type="button" className="works-task-board__card" aria-haspopup="dialog" onClick={() => onOpenTask(task)}>
        <span className="works-task-card__title">{task.titulo}</span>
        <span className="works-task-card__person">
          {person
            ? <><span className="works-task-card__avatar" aria-hidden="true">{person.initials}</span><span className="works-task-card__name">{person.shortName}</span></>
            : <span className="works-task-card__none">Sin responsable</span>}
        </span>
        {progress.total > 0 && (
          <span className="works-task-card__progress">
            <span>Subtareas {progress.completed}/{progress.total}</span>
            <progress className="works-task-progress works-task-progress--thin" max="100" value={progress.percent} aria-label={`Avance de ${task.titulo}`} />
          </span>
        )}
        <span className="works-task-card__cost"><span>Costo asignado</span><span>{formatMoney(taskCost.total, currency, businessLocale)}</span></span>
        {doneAt && <span className="works-task-card__done">Hecho el {formatDate(doneAt, businessLocale)}</span>}
        {waiting && (
          <span className="works-task-card__wait">
            <StatusBadge variant="warning">En espera</StatusBadge>
            {task.motivoEspera && <span className="works-task-card__wait-reason">{task.motivoEspera}</span>}
          </span>
        )}
      </button>
      {onDeleteTask && <TaskDeleteButton costs={costs} onDeleteTask={onDeleteTask} task={task} />}
    </div>
  );
}

// "Agregar tarea" (onAddTask, solo con permiso de gestión y proyecto abierto) abre el mismo diálogo de
// Nueva tarea: el backend crea toda tarea en Por hacer, así que solo esa columna ofrece el botón.
function AddTaskButton({onAddTask}) {
  return <Button type="button" variant="secondary" icon={Plus} className="works-task-board__add" onClick={onAddTask}>Agregar tarea</Button>;
}

export default function WorkTaskBoard({costs, currency, emptyCopy, members = [], onAddTask, onDeleteTask, onOpenTask, tasks}) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (!list.length) {
    return (
      <div className="works-task-board__empty">
        <p className="works-empty-copy">{emptyCopy}</p>
        {onAddTask && <AddTaskButton onAddTask={onAddTask} />}
      </div>
    );
  }

  return (
    <div className="works-task-board">
      {groupWorkTasksByBoardColumn(list).map((column) => (
        <section className="works-task-board__column" key={column.id} aria-label={column.label}>
          <header><h4>{column.label}</h4><span>{column.tasks.length}</span></header>
          {column.tasks.length > 0
            ? <div className="works-task-board__list">{column.tasks.map((task) => <TaskCard costs={costs} currency={currency} key={task.id} members={members} onDeleteTask={onDeleteTask} onOpenTask={onOpenTask} task={task} />)}</div>
            : <p className="works-task-board__column-empty">Sin tareas</p>}
          {column.id === "por_hacer" && onAddTask && <AddTaskButton onAddTask={onAddTask} />}
        </section>
      ))}
    </div>
  );
}
