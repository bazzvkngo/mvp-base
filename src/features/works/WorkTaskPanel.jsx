import React, {useRef, useState} from "react";
import {Trash2} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import StatusBadge from "../../components/ui/StatusBadge";
import {WORK_TASK_DOCUMENTATION_PREVIEW_LIMIT, WORK_TASK_STATUSES, getTaskProgress, getWorkCostSummary, getWorkHistoricalPersonIdentity, getWorkMemberIdentity, getWorkTaskDeletionState, getWorkTaskDocumentationView, getWorkTaskStatusOptions, isWorkTaskDocumentationAnnulled} from "../../domain/workModel.mjs";
import {formatMoney, formatTimestamp} from "../../utils/formatters.js";
import useBusinessFormat from "../../hooks/useBusinessFormat";
import {WorkFormError} from "./WorkCostParts.jsx";
import useWorkFormSubmit from "./useWorkFormSubmit.js";

// Panel de una tarea del tablero (SPEC 028 etapa B2): ResponsiveDialog de tamaño medio (diálogo centrado en
// escritorio; en celular el propio ResponsiveDialog lo muestra casi a pantalla completa). Orden: título con el
// chip de estado, Responsable y Estado en dos columnas iguales, Descripción, y las secciones Subtareas,
// Documentación y Costos con el mismo estilo; al final, una zona separada para Eliminar. En Documentación el
// campo "Comentario o evidencia" va arriba de la lista; la lista muestra los 3 comentarios vigentes más recientes
// (con fecha y hora) y "Ver todos (N)" muestra el resto. Un comentario no se borra: propietario y administrador lo
// anulan con motivo (`onRequestAnnulDocumentation`, que abre su diálogo) y queda tachado con quién, cuándo y por qué;
// el contador de Documentación cuenta solo los vigentes.
//
// Presentacional: no importa servicios ni Firebase. `actions` son los callbacks de la página (cada uno
// devuelve una promesa con true si se aplicó) y reciben `{requestId, onError}`: el requestId es estable en los
// reintentos y el error del backend se muestra aquí dentro, con el panel abierto y lo escrito intacto
// (useWorkFormSubmit). `task` es la tarea viva del tablero (el padre la busca por id en cada render), así el
// panel refleja los cambios que trae la recarga silenciosa; si la tarea deja de existir, el panel se cierra solo.

function statusVariant(task) {
  return task.completada ? "success" : task.estado === "en_espera" ? "warning" : "neutral";
}

function statusLabel(task) {
  return WORK_TASK_STATUSES.find((entry) => entry.value === task.estado)?.label || "";
}

// La hora en es-CL termina en "a. m."/"p. m.": no se le agrega otro punto al cerrar la oración.
const endSentence = (value) => (String(value).endsWith(".") ? String(value) : `${value}.`);

function PanelSection({children, count, title}) {
  return (
    <section className="works-task-panel__section" aria-label={title}>
      <h3>{title}{count != null && <span className="works-task-panel__count">{count}</span>}</h3>
      {children}
    </section>
  );
}

function PanelBody({actions, canManage, canOperate, costs, currency, members, onOpenCosts, onRequestAnnulDocumentation, onRequestDelete, onRequestTaskState, processing, task, terminal}) {
  const {locale: businessLocale} = useBusinessFormat();
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskError, setSubtaskError] = useState("");
  const subtaskRef = useRef(null);
  const [subtaskTitles, setSubtaskTitles] = useState({});
  const [renameErrors, setRenameErrors] = useState({});
  const renameRefs = useRef({});
  const [documentation, setDocumentation] = useState("");
  const [documentationError, setDocumentationError] = useState("");
  const [showAllDocumentation, setShowAllDocumentation] = useState(false);
  const documentationRef = useRef(null);
  // Un hook por zona: el error queda junto a lo que lo causó y el requestId se reutiliza en los reintentos.
  const rowForm = useWorkFormSubmit({prefix: "task-update"});
  const subtaskForm = useWorkFormSubmit({prefix: "subtask-update"});
  const documentationForm = useWorkFormSubmit({prefix: "task-document"});
  const progress = getTaskProgress(task);
  const taskCost = getWorkCostSummary({...costs, taskId: task.id});
  const operable = canOperate(task);
  const busy = Boolean(processing);
  const loadingKey = (key) => processing === key;
  const legacy = task.modeloTareaVersion < 2;
  const showStateControl = !terminal && operable && (!task.completada || canManage);
  // Eliminar (SPEC 028 §4.2): solo gestión y proyecto abierto; se deshabilita, con el motivo a la vista, si la
  // tarea está completada o tiene costos (también anulados) o documentación. El backend decide en última instancia.
  const showDelete = canManage && !terminal;
  // Anular un comentario: mismos permisos que anular un gasto (gestión) y proyecto abierto; el backend lo valida.
  const canAnnulDocumentation = canManage && !terminal && Boolean(onRequestAnnulDocumentation);
  const documentationView = getWorkTaskDocumentationView(task.documentacion, {expanded: showAllDocumentation});
  const deletion = getWorkTaskDeletionState(task, costs);
  // Solo el nombre: nombre del snapshot, luego el del miembro actual y, si no hay ninguno, el correo (igual que la tarjeta).
  const responsableIdentity = task.responsableUid ? getWorkHistoricalPersonIdentity(task.responsableSnapshot, task.responsableUid, members, "Usuario sin identificar") : "Sin responsable";

  const assign = (responsableUid) => rowForm.submit({assign: responsableUid}, (requestId, onError) => actions.assignTask(task, responsableUid, {onError, requestId}));
  const changeState = (estado) => rowForm.submit({estado}, (requestId, onError) => onRequestTaskState(task, estado, {onError, requestId}));
  const addSubtask = (event) => {
    event.preventDefault();
    const titulo = subtaskTitle.trim();
    if (!titulo) { setSubtaskError("Escribe el nombre de la subtarea antes de agregarla."); subtaskRef.current?.focus(); return; }
    subtaskForm.submit({add: titulo}, (requestId, onError) => actions.addSubtask(task, titulo, {onError, requestId})).then((success) => { if (success) setSubtaskTitle(""); });
  };
  const renameSubtask = (subtask) => {
    const titulo = String(subtaskTitles[subtask.id] ?? subtask.titulo).trim();
    // Vacío o solo espacios: no se envía y el mensaje queda bajo el campo, igual que al agregar una subtarea.
    if (!titulo) { setRenameErrors((current) => ({...current, [subtask.id]: "Escribe el nombre de la subtarea antes de guardarla."})); renameRefs.current[subtask.id]?.focus(); return; }
    if (titulo === subtask.titulo) return;
    subtaskForm.submit({rename: subtask.id, titulo}, (requestId, onError) => actions.renameSubtask(task, subtask, titulo, {onError, requestId})).then((success) => { if (success) setSubtaskTitles((current) => ({...current, [subtask.id]: titulo})); });
  };
  const toggleSubtask = (subtask) => subtaskForm.submit({toggle: subtask.id, completada: !subtask.completada}, (requestId, onError) => actions.toggleSubtask(task, subtask, {onError, requestId}));
  const removeSubtask = (subtask) => subtaskForm.submit({remove: subtask.id}, (requestId, onError) => actions.removeSubtask(task, subtask, {onError, requestId}));
  const addDocumentation = (event) => {
    event.preventDefault();
    const texto = documentation.trim();
    if (!texto) { setDocumentationError("Escribe el comentario o la evidencia antes de agregarlo."); documentationRef.current?.focus(); return; }
    documentationForm.submit({texto}, (requestId, onError) => actions.addDocumentation(task, texto, {onError, requestId})).then((success) => { if (success) setDocumentation(""); });
  };

  return (
    <div className="works-task-panel__content">
      <div className="works-task-panel__row">
        {canManage && !terminal ? (
          <label className="erp-field works-task-panel__field">
            <span className="erp-field__label">Responsable</span>
            <select className="erp-control" disabled={busy} value={task.responsableUid} onChange={(event) => assign(event.target.value)}>
              <option value="">Sin responsable</option>
              {members.map((member) => <option key={member.uid} value={member.uid}>{getWorkMemberIdentity(member)}</option>)}
            </select>
          </label>
        ) : (
          <div className="erp-field works-task-panel__field"><span className="erp-field__label">Responsable</span><span className="works-task-panel__value">{responsableIdentity}</span></div>
        )}
        {showStateControl ? (
          <label className="erp-field works-task-panel__field">
            <span className="erp-field__label">Estado</span>
            <select className="erp-control" value={task.estado} disabled={busy} onChange={(event) => changeState(event.target.value)}>
              {getWorkTaskStatusOptions(task, {canManage}).map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
        ) : (
          <div className="erp-field works-task-panel__field"><span className="erp-field__label">Estado</span><span className="works-task-panel__value">{statusLabel(task)}</span></div>
        )}
      </div>
      <WorkFormError error={rowForm.error} noticeRef={rowForm.noticeRef} title="No se pudo actualizar la tarea" />
      {(legacy || !operable) && (
        <div className="works-task-panel__tags">
          {legacy && <span className="works-task-board__legacy">Tarea legacy</span>}
          {!operable && <span className="works-task-board__readonly">Solo lectura</span>}
        </div>
      )}
      {task.estado === "en_espera" && task.motivoEspera && <p className="works-wait-reason">En espera: {task.motivoEspera}</p>}

      {task.descripcion
        ? <PanelSection title="Descripción"><p className="works-project-board__description">{task.descripcion}</p></PanelSection>
        : <p className="works-empty-line">Sin descripción.</p>}

      <PanelSection title="Subtareas" count={progress.total > 0 ? `${progress.completed}/${progress.total}` : null}>
        {progress.total > 0 && <progress className="works-task-progress" max="100" value={progress.percent} aria-label={`Avance de ${task.titulo}`} />}
        {task.subtareas.length > 0 && (
          <div className="works-subtask-list">
            {task.subtareas.map((subtask) => (
              <div key={subtask.id} className={subtask.completada ? "is-complete" : ""}>
                <input type="checkbox" aria-label={`Completar ${subtask.titulo}`} checked={subtask.completada} disabled={terminal || !operable || busy} onChange={() => toggleSubtask(subtask)} />
                <input aria-describedby={renameErrors[subtask.id] ? `subtask-rename-error-${subtask.id}` : undefined} aria-invalid={renameErrors[subtask.id] ? "true" : undefined} className="erp-control" maxLength="240" aria-label={`Subtarea: ${subtask.titulo}`} disabled={terminal || !canManage || subtask.completada} ref={(node) => { renameRefs.current[subtask.id] = node; }} value={subtaskTitles[subtask.id] ?? subtask.titulo} onChange={(event) => { setSubtaskTitles((current) => ({...current, [subtask.id]: event.target.value})); setRenameErrors((current) => (current[subtask.id] ? {...current, [subtask.id]: ""} : current)); subtaskForm.clearError(); }} />
                <div>
                  {canManage && !terminal && !subtask.completada && (
                    <>
                      <Button type="button" variant="secondary" loading={loadingKey(`subtask-title-${subtask.id}`)} disabled={(busy && !loadingKey(`subtask-title-${subtask.id}`)) || (subtaskTitles[subtask.id] ?? subtask.titulo).trim() === subtask.titulo} onClick={() => renameSubtask(subtask)}>Guardar</Button>
                      <button type="button" aria-label={`Eliminar ${subtask.titulo}`} disabled={busy} onClick={() => removeSubtask(subtask)}><AppIcon icon={Trash2} size={15} /></button>
                    </>
                  )}
                </div>
                {renameErrors[subtask.id] && <small className="works-field-error" id={`subtask-rename-error-${subtask.id}`}>{renameErrors[subtask.id]}</small>}
              </div>
            ))}
          </div>
        )}
        {!task.subtareas.length && <p className="works-empty-line">Sin subtareas.</p>}
        {operable && !terminal && !task.completada && (
          <form className="works-subtask-create" onSubmit={addSubtask}>
            <label className="erp-field">
              <span className="erp-field__label">Nueva subtarea</span>
              <input aria-describedby={subtaskError ? `subtask-new-error-${task.id}` : undefined} aria-invalid={subtaskError ? "true" : undefined} className="erp-control" maxLength="240" ref={subtaskRef} value={subtaskTitle} onChange={(event) => { setSubtaskTitle(event.target.value); setSubtaskError(""); subtaskForm.clearError(); }} />
            </label>
            <Button type="submit" variant="secondary" loading={loadingKey(`subtask-new-${task.id}`)} disabled={busy && !loadingKey(`subtask-new-${task.id}`)}>Agregar</Button>
            {subtaskError && <small className="works-field-error" id={`subtask-new-error-${task.id}`}>{subtaskError}</small>}
          </form>
        )}
        <WorkFormError error={subtaskForm.error} noticeRef={subtaskForm.noticeRef} title="No se pudo actualizar la subtarea" />
      </PanelSection>

      <PanelSection title="Documentación" count={documentationView.activeCount}>
        {!terminal && operable && (
          <form className="works-task-document-form" onSubmit={addDocumentation}>
            <label className="erp-field">
              <span className="erp-field__label">Comentario o evidencia</span>
              <textarea aria-describedby={documentationError ? `task-documentation-error-${task.id}` : undefined} aria-invalid={documentationError ? "true" : undefined} className="erp-control" maxLength="8000" rows="2" ref={documentationRef} value={documentation} onChange={(event) => { setDocumentation(event.target.value); setDocumentationError(""); documentationForm.clearError(); }} />
            </label>
            <Button type="submit" variant="secondary" loading={loadingKey(`task-document-${task.id}`)} disabled={busy && !loadingKey(`task-document-${task.id}`)}>Agregar</Button>
            {documentationError && <small className="works-field-error" id={`task-documentation-error-${task.id}`}>{documentationError}</small>}
          </form>
        )}
        <WorkFormError error={documentationForm.error} noticeRef={documentationForm.noticeRef} title="No se pudo agregar la documentación" />
        {task.documentacion.length === 0 && <p className="works-empty-line">{!terminal && operable ? "Aún no hay documentación." : "No hay documentación registrada."}</p>}
        {documentationView.visible.length > 0 && (
          <div className="works-task-panel__entries">
            {documentationView.visible.map((entry) => {
              const annulled = isWorkTaskDocumentationAnnulled(entry);
              return (
                <div key={entry.id} className={annulled ? "is-annulled" : undefined}>
                  <p>{entry.texto}</p>
                  <small>{getWorkHistoricalPersonIdentity(entry.autorSnapshot, entry.autorUid, members, "Persona del equipo")} · {formatTimestamp(entry.creadoEn, businessLocale)}{entry.tipo === "cierre" ? " · Cierre" : ""}</small>
                  {annulled && <small className="works-task-panel__annulled">Anulado por {getWorkHistoricalPersonIdentity(entry.anuladoPorSnapshot, entry.anuladoPorUid, members, "Persona del equipo")} el {endSentence(formatTimestamp(entry.anuladoEn, businessLocale))} Motivo: {entry.motivoAnulacion || "sin motivo registrado"}</small>}
                  {canAnnulDocumentation && !annulled && <Button type="button" variant="ghost-danger" className="works-task-panel__annul" aria-label={`Anular comentario: ${String(entry.texto || "").slice(0, 40)}`} disabled={busy} onClick={() => onRequestAnnulDocumentation(task, entry)}>Anular</Button>}
                </div>
              );
            })}
          </div>
        )}
        {documentationView.activeCount > WORK_TASK_DOCUMENTATION_PREVIEW_LIMIT && (
          <Button type="button" variant="ghost" className="works-task-panel__more" aria-expanded={showAllDocumentation} onClick={() => setShowAllDocumentation((current) => !current)}>
            {showAllDocumentation ? `Ver solo los ${WORK_TASK_DOCUMENTATION_PREVIEW_LIMIT} más recientes` : `Ver todos (${documentationView.activeCount})`}
          </Button>
        )}
      </PanelSection>

      <PanelSection title="Costos">
        <div className="works-task-panel__cost">
          <div>
            <span>Costo asignado</span>
            <strong>{formatMoney(taskCost.total, currency, businessLocale)}</strong>
            <small className="works-task-panel__breakdown">Horas {formatMoney(taskCost.labor, currency, businessLocale)} · Gastos {formatMoney(taskCost.expenses, currency, businessLocale)} · Materiales {formatMoney(taskCost.materials, currency, businessLocale)}</small>
          </div>
          <Button type="button" variant="secondary" onClick={() => onOpenCosts({scope: task.id, title: task.titulo})}>Gastos, horas y materiales</Button>
        </div>
      </PanelSection>

      {showDelete && (
        <div className="works-task-panel__danger">
          {!deletion.canDelete && <p className="works-task-panel__hint" id={`task-delete-reason-${task.id}`}>{deletion.reason}</p>}
          <Button type="button" variant="ghost-danger" icon={Trash2} iconSize={15} aria-describedby={deletion.canDelete ? undefined : `task-delete-reason-${task.id}`} disabled={busy || !deletion.canDelete} onClick={() => onRequestDelete(task)}>Eliminar tarea</Button>
        </div>
      )}
    </div>
  );
}

export default function WorkTaskPanel({onClose, task, ...bodyProps}) {
  return (
    <ResponsiveDialog
      className="works-task-panel"
      open={Boolean(task)}
      onClose={onClose}
      size="medium"
      eyebrow="Tarea"
      title={task ? <span className="works-task-panel__title"><span>{task.titulo}</span><StatusBadge variant={statusVariant(task)}>{statusLabel(task)}</StatusBadge></span> : "Tarea"}
      description="Detalle y acciones de la tarea."
    >
      {task && <PanelBody key={task.id} task={task} {...bodyProps} />}
    </ResponsiveDialog>
  );
}
