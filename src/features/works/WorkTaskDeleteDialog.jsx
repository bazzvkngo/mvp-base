import React, {useRef} from "react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";

// Confirmación simple para eliminar una tarea (SPEC 028 §4.2). Presentacional:
// el padre decide qué tarea se confirma (`task`), qué hace `onConfirm` y qué
// error mostrar (`error`). Si el backend rechaza la eliminación, el diálogo
// sigue abierto y muestra el mensaje aquí dentro. El foco inicial queda en
// "Volver" para que Enter no destruya nada por accidente.
export default function WorkTaskDeleteDialog({error = "", onClose, onConfirm, processing = "", task}) {
  const cancelRef = useRef(null);
  const busy = Boolean(processing);
  const subtasks = Array.isArray(task?.subtareas) ? task.subtareas.length : 0;

  return (
    <ResponsiveDialog
      open={Boolean(task)}
      onClose={() => !busy && onClose()}
      size="small"
      eyebrow="Tarea"
      title="Eliminar tarea"
      description="Esta acción no se puede deshacer."
      initialFocusRef={cancelRef}
      footer={(
        <>
          <Button ref={cancelRef} type="button" variant="secondary" disabled={busy} onClick={onClose}>Volver</Button>
          <Button type="button" variant="danger" loading={busy} onClick={onConfirm}>Eliminar</Button>
        </>
      )}
    >
      {task && (
        <div className="works-task-delete">
          <p className="works-task-delete__text">
            ¿Eliminar la tarea <strong>«{task.titulo}»</strong>?{subtasks > 0 ? " Se eliminarán también sus subtareas." : ""}
          </p>
          {error && <div className="works-message works-message--error" role="alert">{error}</div>}
        </div>
      )}
    </ResponsiveDialog>
  );
}
