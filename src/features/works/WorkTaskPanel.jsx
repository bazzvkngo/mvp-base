import React, {useState} from "react";
import {Trash2} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import StatusBadge from "../../components/ui/StatusBadge";
import {WORK_TASK_STATUSES, getTaskProgress, getWorkCostSummary, getWorkHistoricalPersonIdentity, getWorkMemberIdentity, getWorkTaskStatusOptions} from "../../domain/workModel.mjs";
import {formatDate, formatMoney} from "../../utils/formatters.js";
import useBusinessFormat from "../../hooks/useBusinessFormat";

// Panel de una tarea del tablero (SPEC 028 etapa B2): panel lateral en escritorio
// y diálogo completo en móvil (ResponsiveDialog). Reúne lo que ya no cabe en la
// tarjeta compacta: descripción, responsable, estado, subtareas, documentación,
// costos y la etiqueta de tarea legacy.
//
// Presentacional: no importa servicios ni Firebase. `actions` son los mismos
// callbacks de siempre (la página los resuelve con las mismas Functions y los
// mismos requestId; cada uno devuelve una promesa con true si se aplicó).
// `task` es la tarea viva del tablero (el padre la busca por id en cada render),
// así el panel refleja los cambios que trae la recarga silenciosa; si la tarea
// deja de existir, el panel se cierra solo.

function PanelBody({actions, canManage, canOperate, costs, currency, members, onOpenCosts, onRequestTaskState, processing, task, terminal}) {
  const {locale: businessLocale} = useBusinessFormat();
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskTitles, setSubtaskTitles] = useState({});
  const [documentation, setDocumentation] = useState("");
  const progress = getTaskProgress(task);
  const taskCost = getWorkCostSummary({...costs, taskId: task.id});
  const operable = canOperate(task);
  const busy = Boolean(processing);
  const legacy = task.modeloTareaVersion < 2;
  const showStateControl = !terminal && operable && (!task.completada || canManage);
  // Igual que en la tarjeta anterior: la acción legacy solo existe donde también se puede cambiar el estado.
  const showDelete = showStateControl && canManage && legacy && !task.completada;
  // Nombre del snapshot, luego el del miembro actual y, si no hay ninguno, el correo (igual que la tarjeta).
  const responsableIdentity = task.responsableUid ? getWorkHistoricalPersonIdentity(task.responsableSnapshot, task.responsableUid, members, "Usuario sin identificar") : "Sin responsable";
  const assignedMember = members.find((entry) => entry.uid === task.responsableUid);
  const responsableEmail = task.responsableUid ? [task.responsableSnapshot?.correo, assignedMember?.correo].map((value) => String(value || "").trim()).find((value) => value && value !== "Sin correo disponible") || "" : "";
  const responsableSecondary = responsableEmail && responsableEmail !== responsableIdentity ? responsableEmail : "";

  const addSubtask = (event) => {
    event.preventDefault();
    const titulo = subtaskTitle.trim();
    if (!titulo) return;
    actions.addSubtask(task, titulo).then((success) => { if (success) setSubtaskTitle(""); });
  };
  const renameSubtask = (subtask) => {
    const titulo = String(subtaskTitles[subtask.id] ?? subtask.titulo).trim();
    if (!titulo || titulo === subtask.titulo) return;
    actions.renameSubtask(task, subtask, titulo).then((success) => { if (success) setSubtaskTitles((current) => ({...current, [subtask.id]: titulo})); });
  };
  const addDocumentation = (event) => {
    event.preventDefault();
    const texto = documentation.trim();
    if (!texto) return;
    actions.addDocumentation(task, texto).then((success) => { if (success) setDocumentation(""); });
  };

  return (
    <div className="works-task-panel__content">
      {legacy && <span className="works-task-board__legacy">Tarea legacy</span>}
      <section className="works-task-panel__block" aria-label="Descripción">
        <h3>Descripción</h3>
        {task.descripcion ? <p className="works-project-board__description">{task.descripcion}</p> : <p className="works-empty-line">Sin descripción.</p>}
      </section>
      {task.estado === "en_espera" && task.motivoEspera && <p className="works-wait-reason">En espera: {task.motivoEspera}</p>}

      <div className="works-task-panel__row">
        {canManage && !terminal ? (
          <label className="erp-field works-project-board__assign">
            <span className="erp-field__label">Responsable</span>
            <select className="erp-control" disabled={busy} value={task.responsableUid} onChange={(event) => actions.assignTask(task, event.target.value)}>
              <option value="">Sin responsable</option>
              {members.map((member) => <option key={member.uid} value={member.uid}>{getWorkMemberIdentity(member)}</option>)}
            </select>
            {responsableSecondary && <small className="works-task-panel__secondary">{responsableSecondary}</small>}
          </label>
        ) : (
          <div className="erp-field"><span className="erp-field__label">Responsable</span><span className="works-task-panel__person">{responsableIdentity}</span>{responsableSecondary && <small className="works-task-panel__secondary">{responsableSecondary}</small>}</div>
        )}
        {showStateControl ? (
          <label className="erp-field">
            <span className="erp-field__label">Estado</span>
            <select className="erp-control" value={task.estado} disabled={busy} onChange={(event) => onRequestTaskState(task, event.target.value)}>
              {getWorkTaskStatusOptions(task, {canManage}).map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
        ) : (
          <div className="erp-field"><span className="erp-field__label">Estado</span><StatusBadge variant={task.completada ? "success" : task.estado === "en_espera" ? "warning" : "neutral"}>{WORK_TASK_STATUSES.find((entry) => entry.value === task.estado)?.label}</StatusBadge></div>
        )}
      </div>
      {!operable && <span className="works-task-board__readonly">Sólo lectura</span>}

      <section className="works-task-panel__section" aria-label="Subtareas">
        <h3>Subtareas{progress.total > 0 && <span className="works-task-panel__count">{progress.completed}/{progress.total}</span>}</h3>
        {progress.total > 0 && <progress className="works-task-progress" max="100" value={progress.percent} aria-label={`Avance de ${task.titulo}`} />}
        {task.subtareas.length > 0 && (
          <div className="works-subtask-list">
            {task.subtareas.map((subtask) => (
              <div key={subtask.id} className={subtask.completada ? "is-complete" : ""}>
                <input type="checkbox" aria-label={`Completar ${subtask.titulo}`} checked={subtask.completada} disabled={terminal || !operable || busy} onChange={() => actions.toggleSubtask(task, subtask)} />
                <input className="erp-control" maxLength="240" aria-label={`Subtarea: ${subtask.titulo}`} disabled={terminal || !canManage || subtask.completada} value={subtaskTitles[subtask.id] ?? subtask.titulo} onChange={(event) => setSubtaskTitles((current) => ({...current, [subtask.id]: event.target.value}))} />
                <div>
                  {canManage && !terminal && !subtask.completada && (
                    <>
                      <Button type="button" variant="secondary" disabled={busy || (subtaskTitles[subtask.id] ?? subtask.titulo).trim() === subtask.titulo} onClick={() => renameSubtask(subtask)}>Guardar</Button>
                      <button type="button" aria-label={`Eliminar ${subtask.titulo}`} disabled={busy} onClick={() => actions.removeSubtask(task, subtask)}><AppIcon icon={Trash2} size={15} /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {!task.subtareas.length && <p className="works-empty-line">Sin subtareas.</p>}
        {operable && !terminal && !task.completada && (
          <form className="works-subtask-create" onSubmit={addSubtask}>
            <input className="erp-control" maxLength="240" required aria-label={`Nueva subtarea de ${task.titulo}`} value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Nueva subtarea" />
            <Button type="submit" variant="secondary" disabled={busy}>Agregar</Button>
          </form>
        )}
      </section>

      <details className="works-task-documentation works-task-panel__docs">
        <summary>Documentación ({task.documentacion.length}){task.documentacion.length === 0 && <span className="works-task-panel__hint">Sin registros aún</span>}</summary>
        {task.documentacion.length === 0 && <p className="works-empty-line">{!terminal && operable ? "Aún no hay documentación. Agrega un comentario o evidencia." : "No hay documentación registrada."}</p>}
        {task.documentacion.map((entry) => (
          <div key={entry.id}>
            <p>{entry.texto}</p>
            <small>{getWorkHistoricalPersonIdentity(entry.autorSnapshot, entry.autorUid, members, "Persona del equipo")} · {formatDate(entry.creadoEn)}{entry.tipo === "cierre" ? " · Cierre" : ""}</small>
          </div>
        ))}
        {!terminal && operable && (
          <form className="works-task-document-form" onSubmit={addDocumentation}>
            <textarea className="erp-control" maxLength="8000" rows="2" aria-label={`Documentación de ${task.titulo}`} value={documentation} onChange={(event) => setDocumentation(event.target.value)} placeholder="Comentario o evidencia" />
            <Button type="submit" variant="secondary" disabled={busy}>Agregar</Button>
          </form>
        )}
      </details>

      <section className="works-task-panel__section" aria-label="Costos de la tarea">
        <h3>Costos</h3>
        <div className="works-task-panel__cost">
          <div>
            <span>Costo asignado</span>
            <strong>{formatMoney(taskCost.total, currency, businessLocale)}</strong>
          </div>
          <Button type="button" variant="secondary" onClick={() => onOpenCosts({scope: task.id, title: task.titulo})}>Gastos, HH y materiales</Button>
        </div>
      </section>

      {showDelete && (
        <div className="works-task-panel__danger">
          <button type="button" aria-label={`Eliminar ${task.titulo}`} disabled={busy} onClick={() => actions.removeLegacy(task)}>
            <AppIcon icon={Trash2} size={15} />Eliminar
          </button>
        </div>
      )}
    </div>
  );
}

export default function WorkTaskPanel({onClose, task, ...bodyProps}) {
  return (
    <ResponsiveDialog
      className="works-task-panel"
      layerClassName="works-task-panel-layer"
      open={Boolean(task)}
      onClose={onClose}
      size="medium"
      eyebrow="Tarea"
      title={task?.titulo || "Tarea"}
      description="Detalle y acciones de la tarea."
    >
      {task && <PanelBody key={task.id} task={task} {...bodyProps} />}
    </ResponsiveDialog>
  );
}
