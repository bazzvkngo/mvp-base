import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getReferencesByItem,
} from "../services/referenceService";
import {
  isActivePendingReferenceTask,
  postponeReferenceTask,
  sortReferenceTasks,
  subscribeToReferenceTasks,
} from "../services/referenceTaskService";
import { formatDate } from "../utils/formatters";

const taskStatusLabels = {
  pendiente: "Pendiente",
  aplazada: "Aplazada",
  resuelta: "Resuelta",
};

function getTaskReason(task) {
  if (task.motivo) return task.motivo;
  return task.tipoAlerta === "sin_referencias"
    ? "Sin referencias de mercado"
    : "Referencias desactualizadas";
}

function getTaskActionLabel(task) {
  if (task.accionPrincipal) return task.accionPrincipal;
  return task.tipoAlerta === "sin_referencias"
    ? "Agregar referencia"
    : "Actualizar referencias";
}

function getStatusLabel(task) {
  return taskStatusLabels[task.estado || "pendiente"] || task.estado || "Pendiente";
}

function getTraceLine(task) {
  const estado = task.estado || "pendiente";
  if (estado === "aplazada") {
    return buildTraceLine("Aplazada hasta", task.aplazadaHasta);
  }
  if (estado === "resuelta") {
    return buildTraceLine("Resuelta", task.resueltaEn);
  }
  return buildTraceLine("Creada", task.creadoEn);
}

function buildTraceLine(label, value) {
  const date = formatDate(value);
  return date === "-" ? "" : `${label}: ${date}`;
}

function getPriorityBadgeStyle(priority) {
  if (priority === "alta") return styles.priorityHigh;
  if (priority === "media") return styles.priorityMedium;
  return styles.priorityLow;
}

function getReferenceDateTime(reference) {
  if (!reference?.fechaConsulta) return 0;
  const date = new Date(`${reference.fechaConsulta}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getLatestActiveReference(references) {
  return [...references]
    .filter((reference) => (reference.estado || "activa") === "activa")
    .sort((a, b) => getReferenceDateTime(b) - getReferenceDateTime(a))[0];
}

function ReferenceTasksPage({ userId, role }) {
  const navigate = useNavigate();
  const canWriteReferences = ["OWNER", "ADMIN"].includes(
    String(role || "").toUpperCase()
  );
  const [referenceTasks, setReferenceTasks] = useState([]);
  const [statusFilter, setStatusFilter] = useState("pendientes");
  const [reasonFilter, setReasonFilter] = useState("todos");
  const [searchText, setSearchText] = useState("");
  const [postponeDaysByTask, setPostponeDaysByTask] = useState({});
  const [resolvingTaskId, setResolvingTaskId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return undefined;

    setError("");
    return subscribeToReferenceTasks(
      userId,
      (items) => setReferenceTasks(items),
      (err) => {
        console.error("Error al cargar tareas de referencias:", err);
        setError("No se pudieron cargar las tareas de referencias.");
      }
    );
  }, [userId]);

  const filteredTasks = useMemo(() => {
    const normalizedSearch = searchText.trim().toLocaleLowerCase("es-CL");
    return sortReferenceTasks(
      referenceTasks.filter((task) => {
        if (statusFilter === "pendientes" && !isActivePendingReferenceTask(task)) {
          return false;
        }
        if (
          statusFilter === "aplazadas" &&
          (task.estado || "pendiente") !== "aplazada"
        ) {
          return false;
        }
        if (statusFilter === "resueltas" && task.estado !== "resuelta") {
          return false;
        }
        if (reasonFilter !== "todos" && task.tipoAlerta !== reasonFilter) {
          return false;
        }
        if (
          normalizedSearch &&
          !String(task.itemNombre || "")
            .toLocaleLowerCase("es-CL")
            .includes(normalizedSearch)
        ) {
          return false;
        }
        return true;
      })
    );
  }, [referenceTasks, reasonFilter, searchText, statusFilter]);

  const openReferenceAction = async (task) => {
    if (!task.itemId) return;

    const params = new URLSearchParams({ itemId: task.itemId });

    if (task.tipoAlerta !== "referencias_desactualizadas") {
      navigate(`/referencias?${params.toString()}`);
      return;
    }

    if (task.referenceId) {
      params.set("referenceId", task.referenceId);
      navigate(`/referencias?${params.toString()}`);
      return;
    }

    try {
      setResolvingTaskId(task.id);
      setError("");
      const itemReferences = await getReferencesByItem(userId, task.itemId);
      const latestActiveReference = getLatestActiveReference(itemReferences);
      if (latestActiveReference?.id) {
        params.set("referenceId", latestActiveReference.id);
      } else {
        params.set("referenceUnavailable", "1");
      }
      navigate(`/referencias?${params.toString()}`);
    } catch (err) {
      console.error("Error al buscar referencia activa para la tarea:", err);
      setError("No se pudo abrir la referencia asociada a la tarea.");
    } finally {
      setResolvingTaskId("");
    }
  };

  const postponeTask = async (taskId) => {
    try {
      await postponeReferenceTask(userId, taskId, postponeDaysByTask[taskId] || 7);
    } catch (err) {
      console.error("Error al aplazar tarea de referencia:", err);
      setError("No se pudo aplazar la tarea de referencia.");
    }
  };

  const changePostponeDays = (taskId, days) => {
    setPostponeDaysByTask((prev) => ({ ...prev, [taskId]: Number(days) }));
  };

  return (
    <section className="erp-page" style={styles.wrapper}>
      <div className="erp-page-header" style={styles.header}>
        <div>
          <span className="eyebrow">Referencias</span>
          <h2 style={styles.title}>Tareas de referencias</h2>
          <p style={styles.subtitle}>
            Revisa, aplaza y actualiza las tareas generadas por el control
            automático de referencias.
          </p>
        </div>
        <button
          type="button"
          style={styles.secondaryButton}
          onClick={() => navigate("/cotizaciones")}
        >
          Volver a Cotizaciones
        </button>
      </div>

      {error && <p role="alert" style={styles.errorText}>{error}</p>}

      <div className="erp-panel" style={styles.panel}>
        <div className="erp-filters" style={styles.filters}>
          <label className="erp-field">
            <span>Estado</span>
            <select
              className="erp-control"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              style={styles.filterSelect}
            >
              <option value="pendientes">Pendientes</option>
              <option value="aplazadas">Aplazadas</option>
              <option value="resueltas">Resueltas</option>
            </select>
          </label>
          <label className="erp-field">
            <span>Motivo</span>
            <select
              className="erp-control"
              value={reasonFilter}
              onChange={(event) => setReasonFilter(event.target.value)}
              style={styles.filterSelect}
            >
              <option value="todos">Todos los motivos</option>
              <option value="sin_referencias">Sin referencias</option>
              <option value="referencias_desactualizadas">Desactualizadas</option>
            </select>
          </label>
          <label className="erp-field">
            <span>Buscar ítem</span>
            <input
              className="erp-control"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Nombre del ítem"
              style={styles.searchInput}
            />
          </label>
        </div>

        {filteredTasks.length === 0 ? (
          <p className="erp-empty-state" style={styles.emptyText}>No hay tareas para este filtro.</p>
        ) : (
          <>
            <ReferenceTasksTable
              tasks={filteredTasks}
              canWrite={canWriteReferences}
              postponeDaysByTask={postponeDaysByTask}
              resolvingTaskId={resolvingTaskId}
              onAction={openReferenceAction}
              onPostpone={postponeTask}
              onPostponeDaysChange={changePostponeDays}
            />
            <ReferenceTaskCards
              tasks={filteredTasks}
              canWrite={canWriteReferences}
              postponeDaysByTask={postponeDaysByTask}
              resolvingTaskId={resolvingTaskId}
              onAction={openReferenceAction}
              onPostpone={postponeTask}
              onPostponeDaysChange={changePostponeDays}
            />
          </>
        )}
      </div>
    </section>
  );
}

function ReferenceTasksTable({
  tasks,
  canWrite,
  postponeDaysByTask,
  resolvingTaskId,
  onAction,
  onPostpone,
  onPostponeDaysChange,
}) {
  return (
    <div className="erp-table-region erp-desktop-only" style={styles.tableWrapper}>
      <table className="erp-table" style={styles.taskTable}>
        <colgroup>
          <col style={styles.statusColumn} />
          <col style={styles.priorityColumn} />
          <col style={styles.itemColumn} />
          <col style={styles.reasonColumn} />
          <col style={styles.actionsColumn} />
        </colgroup>
        <thead>
          <tr>
            <th style={styles.th}>Estado</th>
            <th style={styles.th}>Prioridad</th>
            <th style={styles.th}>Ítem</th>
            <th style={styles.th}>Motivo</th>
            <th style={styles.th}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const isPending = isActivePendingReferenceTask(task);
            const priority = task.prioridad || "media";
            const traceLine = getTraceLine(task);
            return (
              <tr key={task.id}>
                <td style={styles.td}>
                  <strong style={styles.statusText}>{getStatusLabel(task)}</strong>
                  {traceLine && <span style={styles.traceText}>{traceLine}</span>}
                </td>
                <td style={styles.td}>
                  <span
                    style={{
                      ...styles.priorityBadge,
                      ...getPriorityBadgeStyle(priority),
                    }}
                  >
                    {priority}
                  </span>
                </td>
                <td style={styles.td}>
                  <strong>{task.itemNombre}</strong>
                </td>
                <td style={styles.td}>{getTaskReason(task)}</td>
                <td style={styles.td}>
                  <ReferenceTaskActions
                    task={task}
                    canWrite={canWrite}
                    isPending={isPending}
                    postponeDays={postponeDaysByTask[task.id] || 7}
                    resolving={resolvingTaskId === task.id}
                    onAction={onAction}
                    onPostpone={onPostpone}
                    onPostponeDaysChange={onPostponeDaysChange}
                    idPrefix="table"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReferenceTaskCards(props) {
  return (
    <div className="erp-card-list erp-mobile-only" aria-label="Tareas de referencias">
      {props.tasks.map((task) => {
        const isPending = isActivePendingReferenceTask(task);
        const priority = task.prioridad || "media";
        const traceLine = getTraceLine(task);
        return (
          <article className="erp-record-card" key={task.id}>
            <div className="erp-record-card__header">
              <div>
                <h3 className="erp-record-card__title">{task.itemNombre || "Ítem sin nombre"}</h3>
                <p className="erp-record-card__subtitle">
                  {getStatusLabel(task)}{traceLine ? ` · ${traceLine}` : ""}
                </p>
              </div>
              <span style={{ ...styles.priorityBadge, ...getPriorityBadgeStyle(priority) }}>
                {priority}
              </span>
            </div>
            <dl className="erp-meta-grid">
              <div className="erp-meta erp-meta--wide">
                <dt className="erp-meta__label">Motivo</dt>
                <dd className="erp-meta__value">{getTaskReason(task)}</dd>
              </div>
            </dl>
            <ReferenceTaskActions
              task={task}
              canWrite={props.canWrite}
              isPending={isPending}
              postponeDays={props.postponeDaysByTask[task.id] || 7}
              resolving={props.resolvingTaskId === task.id}
              onAction={props.onAction}
              onPostpone={props.onPostpone}
              onPostponeDaysChange={props.onPostponeDaysChange}
              idPrefix="card"
              compact
            />
          </article>
        );
      })}
    </div>
  );
}

function ReferenceTaskActions({
  task,
  canWrite,
  isPending,
  postponeDays,
  resolving,
  onAction,
  onPostpone,
  onPostponeDaysChange,
  idPrefix,
  compact = false,
}) {
  if (!canWrite) return <span style={styles.mutedText}>Solo lectura</span>;
  if (!isPending) return <span style={styles.mutedText}>Sin acciones pendientes</span>;

  const selectId = `${idPrefix}-postpone-${task.id}`;
  return (
    <div
      className={compact ? "reference-task-card-actions" : undefined}
      style={{ ...styles.taskActions, ...(compact ? styles.compactTaskActions : {}) }}
    >
      <button
        type="button"
        style={styles.primarySmallButton}
        disabled={resolving}
        onClick={() => onAction(task)}
      >
        {resolving ? "Abriendo..." : getTaskActionLabel(task)}
      </button>
      <label className="sr-only" htmlFor={selectId}>Plazo para aplazar</label>
      <select
        id={selectId}
        aria-label="Plazo para aplazar"
        value={postponeDays}
        onChange={(event) => onPostponeDaysChange(task.id, event.target.value)}
        style={styles.postponeSelect}
      >
        <option value={7}>7 días</option>
        <option value={15}>15 días</option>
        <option value={30}>30 días</option>
      </select>
      <button type="button" style={styles.postponeButton} onClick={() => onPostpone(task.id)}>
        Aplazar
      </button>
    </div>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "14px",
    minWidth: 0,
  },
  header: {
    alignItems: "flex-start",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "4px",
    display: "flex",
    gap: "14px",
    justifyContent: "space-between",
    padding: "18px",
  },
  title: {
    fontSize: "22px",
    margin: "4px 0 6px",
  },
  subtitle: {
    color: "#64748b",
    fontSize: "14px",
    lineHeight: 1.45,
    margin: 0,
    maxWidth: "760px",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "4px",
    minWidth: 0,
    padding: "14px",
  },
  filters: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(3, minmax(180px, 1fr))",
    marginBottom: "12px",
  },
  filterSelect: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    fontSize: "13px",
    boxSizing: "border-box",
    padding: "9px 10px",
  },
  searchInput: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    boxSizing: "border-box",
    fontSize: "13px",
    minWidth: 0,
    padding: "9px 10px",
  },
  tableWrapper: {
    overflowX: "auto",
    minWidth: 0,
  },
  taskTable: {
    borderCollapse: "collapse",
    tableLayout: "fixed",
    minWidth: "950px",
    width: "100%",
  },
  statusColumn: {
    width: "14%",
  },
  priorityColumn: {
    width: "10%",
  },
  itemColumn: {
    width: "24%",
  },
  reasonColumn: {
    width: "18%",
  },
  actionsColumn: {
    width: "34%",
  },
  th: {
    background: "#f8fafc",
    borderBottom: "1px solid #e5e7eb",
    color: "#64748b",
    fontSize: "13px",
    padding: "8px",
    textAlign: "left",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  td: {
    borderBottom: "1px solid #eef2f7",
    fontSize: "13px",
    padding: "8px",
    verticalAlign: "middle",
    whiteSpace: "normal",
  },
  statusText: {
    display: "block",
  },
  traceText: {
    color: "#64748b",
    display: "block",
    fontSize: "13px",
    lineHeight: 1.3,
    marginTop: "3px",
  },
  taskActions: {
    alignItems: "center",
    display: "grid",
    gap: "6px",
    gridTemplateColumns: "minmax(140px, auto) 88px 76px",
  },
  compactTaskActions: {
    gridTemplateColumns: "minmax(0, 1fr) 88px",
    width: "100%",
  },
  primarySmallButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "4px",
    boxSizing: "border-box",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    minWidth: "140px",
    minHeight: "38px",
    padding: "7px 9px",
    whiteSpace: "nowrap",
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    color: "#334155",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    padding: "7px 9px",
    whiteSpace: "nowrap",
  },
  postponeSelect: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    boxSizing: "border-box",
    color: "#334155",
    fontSize: "13px",
    minHeight: "38px",
    padding: "7px 8px",
    width: "82px",
  },
  postponeButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    boxSizing: "border-box",
    color: "#334155",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    minHeight: "38px",
    padding: "7px 9px",
    textAlign: "center",
    whiteSpace: "nowrap",
    width: "72px",
  },
  priorityBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "13px",
    fontWeight: 800,
    lineHeight: 1,
    minWidth: "44px",
    padding: "5px 8px",
    textAlign: "center",
  },
  priorityHigh: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  priorityMedium: {
    background: "#fef3c7",
    color: "#92400e",
  },
  priorityLow: {
    background: "#ecfdf5",
    color: "#166534",
  },
  mutedText: {
    color: "#64748b",
    fontSize: "13px",
    fontWeight: 700,
  },
  emptyText: {
    color: "#64748b",
    margin: 0,
  },
  errorText: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "4px",
    color: "#b91c1c",
    margin: 0,
    padding: "11px 13px",
  },
};

export default ReferenceTasksPage;
