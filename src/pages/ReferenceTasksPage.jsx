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

function ReferenceTasksPage({ userId }) {
  const navigate = useNavigate();
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
    <section style={styles.wrapper}>
      <style>
        {`
          .reference-task-full-actions {
            grid-template-columns: minmax(140px, auto) 82px 72px;
          }

          @media (max-width: 900px) {
            .reference-task-filters {
              grid-template-columns: minmax(0, 1fr);
            }

            .reference-task-full-table,
            .reference-task-full-table thead,
            .reference-task-full-table tbody,
            .reference-task-full-table tr,
            .reference-task-full-table th,
            .reference-task-full-table td {
              display: block;
            }

            .reference-task-full-table thead {
              display: none;
            }

            .reference-task-full-table tr {
              border-bottom: 1px solid #eef2f7;
              padding: 8px 0;
            }

            .reference-task-full-table td {
              border-bottom: 0 !important;
              white-space: normal !important;
            }

            .reference-task-full-actions {
              grid-template-columns: 82px 72px;
            }

            .reference-task-full-primary {
              grid-column: 1 / -1;
              width: 100%;
            }
          }
        `}
      </style>

      <div style={styles.header}>
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
          onClick={() => navigate("/dashboard")}
        >
          Volver al Dashboard
        </button>
      </div>

      {error && <p style={styles.errorText}>{error}</p>}

      <div style={styles.panel}>
        <div className="reference-task-filters" style={styles.filters}>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            style={styles.filterSelect}
          >
            <option value="pendientes">Pendientes</option>
            <option value="aplazadas">Aplazadas</option>
            <option value="resueltas">Resueltas</option>
          </select>
          <select
            value={reasonFilter}
            onChange={(event) => setReasonFilter(event.target.value)}
            style={styles.filterSelect}
          >
            <option value="todos">Todos los motivos</option>
            <option value="sin_referencias">Sin referencias</option>
            <option value="referencias_desactualizadas">Desactualizadas</option>
          </select>
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Buscar ítem"
            style={styles.searchInput}
          />
        </div>

        {filteredTasks.length === 0 ? (
          <p style={styles.emptyText}>No hay tareas para este filtro.</p>
        ) : (
          <ReferenceTasksTable
            tasks={filteredTasks}
            postponeDaysByTask={postponeDaysByTask}
            resolvingTaskId={resolvingTaskId}
            onAction={openReferenceAction}
            onPostpone={postponeTask}
            onPostponeDaysChange={changePostponeDays}
          />
        )}
      </div>
    </section>
  );
}

function ReferenceTasksTable({
  tasks,
  postponeDaysByTask,
  resolvingTaskId,
  onAction,
  onPostpone,
  onPostponeDaysChange,
}) {
  return (
    <div style={styles.tableWrapper}>
      <table className="reference-task-full-table" style={styles.taskTable}>
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
                  {isPending ? (
                    <div
                      className="reference-task-full-actions"
                      style={styles.taskActions}
                    >
                      <button
                        className="reference-task-full-primary"
                        type="button"
                        style={styles.primarySmallButton}
                        disabled={resolvingTaskId === task.id}
                        onClick={() => onAction(task)}
                      >
                        {resolvingTaskId === task.id
                          ? "Abriendo..."
                          : getTaskActionLabel(task)}
                      </button>
                      <select
                        value={postponeDaysByTask[task.id] || 7}
                        onChange={(event) =>
                          onPostponeDaysChange(task.id, event.target.value)
                        }
                        style={styles.postponeSelect}
                      >
                        <option value={7}>7 días</option>
                        <option value={15}>15 días</option>
                        <option value={30}>30 días</option>
                      </select>
                      <button
                        type="button"
                        style={styles.postponeButton}
                        onClick={() => onPostpone(task.id)}
                      >
                        Aplazar
                      </button>
                    </div>
                  ) : (
                    <span style={styles.mutedText}>Sin acciones</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "14px",
  },
  header: {
    alignItems: "flex-start",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
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
    borderRadius: "8px",
    padding: "14px",
  },
  filters: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(3, minmax(150px, max-content))",
    marginBottom: "12px",
  },
  filterSelect: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    boxSizing: "border-box",
    padding: "9px 10px",
  },
  searchInput: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    boxSizing: "border-box",
    minWidth: "220px",
    padding: "9px 10px",
  },
  tableWrapper: {
    overflowX: "visible",
  },
  taskTable: {
    borderCollapse: "collapse",
    tableLayout: "fixed",
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
    fontSize: "11px",
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
    fontSize: "12px",
    lineHeight: 1.3,
    marginTop: "3px",
  },
  taskActions: {
    alignItems: "center",
    display: "grid",
    gap: "6px",
  },
  primarySmallButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "6px",
    boxSizing: "border-box",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 800,
    minWidth: "140px",
    padding: "7px 9px",
    whiteSpace: "nowrap",
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
    padding: "7px 9px",
    whiteSpace: "nowrap",
  },
  postponeSelect: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    boxSizing: "border-box",
    color: "#334155",
    fontSize: "12px",
    padding: "7px 8px",
    width: "82px",
  },
  postponeButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    boxSizing: "border-box",
    color: "#334155",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
    padding: "7px 9px",
    textAlign: "center",
    whiteSpace: "nowrap",
    width: "72px",
  },
  priorityBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "12px",
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
    fontSize: "12px",
    fontWeight: 700,
  },
  emptyText: {
    color: "#64748b",
    margin: 0,
  },
  errorText: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    color: "#b91c1c",
    margin: 0,
    padding: "11px 13px",
  },
};

export default ReferenceTasksPage;
