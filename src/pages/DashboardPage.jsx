import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  FilePlus2,
  Landmark,
  Plus,
  ReceiptText,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import DashboardDonutChart from "../components/DashboardDonutChart";
import FinancialMetricCard from "../components/finance/FinancialMetricCard";
import FinancialMovementDialog from "../components/finance/FinancialMovementDialog";
import FinancialPeriodSelector from "../components/finance/FinancialPeriodSelector";
import Button from "../components/ui/Button";
import {
  getFinancialPeriodRange,
} from "../domain/financialMovement.mjs";
import { PRICING_STATUS } from "../domain/pricing";
import useFinancialMovements from "../hooks/useFinancialMovements";
import {
  getCompanyProfile,
  getCompanyProfileCompletion,
} from "../services/companyService";
import { getQuotes } from "../services/quoteService";
import { subscribeToInventory } from "../services/inventoryService";
import { subscribeToReferences } from "../services/referenceService";
import {
  isActivePendingReferenceTask,
  postponeReferenceTask,
  sortReferenceTasks,
  subscribeToReferenceTasks,
} from "../services/referenceTaskService";
import { buildValuations } from "../services/valuationService";
import { createFinancialMovement } from "../services/financialService";
import { formatCLP, formatDate } from "../utils/formatters";

const quoteStates = [
  "borrador",
  "emitida",
  "aceptada",
  "rechazada",
  "vencida",
  "archivada",
];

const stateLabels = {
  borrador: "Borrador",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  archivada: "Archivada",
};

const quoteStateColors = {
  borrador: "#94a3b8",
  emitida: "#38bdf8",
  aceptada: "#22c55e",
  rechazada: "#f87171",
  vencida: "#f59e0b",
  archivada: "#64748b",
};

const valuationColors = {
  sinReferencias: "#94a3b8",
  bajoMercado: "#38bdf8",
  dentroRango: "#22c55e",
  sobreMercado: "#f87171",
};

function getValuationSummary(valuations) {
  return valuations.reduce(
    (summary, valuation) => {
      if (valuation.estadoValorizacion === PRICING_STATUS.SIN_REFERENCIAS) {
        summary.sinReferencias += 1;
      }
      if (valuation.estadoValorizacion === PRICING_STATUS.BAJO_MERCADO) {
        summary.bajoMercado += 1;
      }
      if (valuation.estadoValorizacion === PRICING_STATUS.DENTRO_DE_RANGO) {
        summary.dentroRango += 1;
      }
      if (valuation.estadoValorizacion === PRICING_STATUS.SOBRE_MERCADO) {
        summary.sobreMercado += 1;
      }
      return summary;
    },
    {
      sinReferencias: 0,
      bajoMercado: 0,
      dentroRango: 0,
      sobreMercado: 0,
    }
  );
}

function getQuoteSummary(quotes) {
  return quotes.reduce(
    (summary, quote) => {
      const estado = quote.estado || "borrador";
      if (estado !== "archivada") {
        summary.totalVigente += Number(quote.total || 0);
        summary.cotizacionesVigentes += 1;
      }
      if (summary.porEstado[estado] !== undefined) {
        summary.porEstado[estado] += 1;
      }
      return summary;
    },
    {
      totalVigente: 0,
      cotizacionesVigentes: 0,
      porEstado: {
        borrador: 0,
        emitida: 0,
        aceptada: 0,
        rechazada: 0,
        vencida: 0,
        archivada: 0,
      },
    }
  );
}

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

function DashboardPage({ usuario, businessId, role }) {
  const navigate = useNavigate();
  const userId = businessId;
  const [inventoryItems, setInventoryItems] = useState([]);
  const [references, setReferences] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [referencesLoaded, setReferencesLoaded] = useState(false);
  const [quotesLoaded, setQuotesLoaded] = useState(false);
  const [referenceTasks, setReferenceTasks] = useState([]);
  const [postponeDaysByTask, setPostponeDaysByTask] = useState({});
  const [error, setError] = useState("");
  const [companyProfilePending, setCompanyProfilePending] = useState(false);
  const [period, setPeriod] = useState("month");
  const [customPeriod, setCustomPeriod] = useState(() => {
    const current = getFinancialPeriodRange("month");
    return { start: current.start, end: current.end };
  });
  const [movementDialog, setMovementDialog] = useState({
    open: false,
    type: "income",
  });
  const [financialFeedback, setFinancialFeedback] = useState("");
  const financialRange = useMemo(
    () => getFinancialPeriodRange(period, customPeriod),
    [customPeriod, period]
  );
  const financialState = useFinancialMovements(businessId, financialRange);
  const canManage = role === "OWNER" || role === "ADMIN";

  useEffect(() => {
    if (!userId) return undefined;

    setError("");
    setInventoryLoaded(false);
    setReferencesLoaded(false);
    setQuotesLoaded(false);

    const unsubscribeInventory = subscribeToInventory(
      userId,
      (items) => {
        setInventoryItems(items);
        setInventoryLoaded(true);
      },
      (err) => {
        console.error("Error al cargar inventario para dashboard:", err);
        setError("No se pudo cargar el inventario del dashboard.");
        setInventoryLoaded(true);
      }
    );

    const unsubscribeReferences = subscribeToReferences(
      userId,
      (items) => {
        setReferences(items);
        setReferencesLoaded(true);
      },
      (err) => {
        console.error("Error al cargar referencias para dashboard:", err);
        setError("No se pudieron cargar las referencias del dashboard.");
        setReferencesLoaded(true);
      }
    );

    getQuotes(userId)
      .then((items) => setQuotes(items))
      .catch((err) => {
        console.error("Error al cargar cotizaciones para dashboard:", err);
        setError("No se pudieron cargar las cotizaciones del dashboard.");
      })
      .finally(() => setQuotesLoaded(true));

    const unsubscribeReferenceTasks = subscribeToReferenceTasks(
      userId,
      (items) => setReferenceTasks(items),
      (err) => {
        console.error("Error al cargar tareas de referencias:", err);
      }
    );

    return () => {
      unsubscribeInventory();
      unsubscribeReferences();
      unsubscribeReferenceTasks();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    setCompanyProfilePending(false);
    getCompanyProfile(userId)
      .then((profile) => {
        if (active) {
          const completion = getCompanyProfileCompletion(profile);
          setCompanyProfilePending(
            !completion.minimumComplete || !completion.recommendedComplete
          );
        }
      })
      .catch((err) => {
        if (import.meta.env.DEV) {
          console.error("Error al revisar el perfil de empresa:", err);
        }
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const openReferenceAction = (task) => {
    if (!task.itemId) return;
    const params = new URLSearchParams({ itemId: task.itemId });

    if (task.tipoAlerta === "referencias_desactualizadas") {
      if (task.referenceId) {
        params.set("referenceId", task.referenceId);
      } else {
        const latestActiveReference = getLatestActiveReference(
          references.filter((reference) => reference.itemId === task.itemId)
        );
        if (latestActiveReference?.id) {
          params.set("referenceId", latestActiveReference.id);
        } else {
          params.set("referenceUnavailable", "1");
        }
      }
    }

    navigate(`/referencias?${params.toString()}`);
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

  const activeInventory = useMemo(
    () =>
      inventoryItems.filter((item) => (item.estado || "activo") === "activo"),
    [inventoryItems]
  );

  const activeReferences = useMemo(
    () =>
      references.filter(
        (reference) => (reference.estado || "activa") === "activa"
      ),
    [references]
  );

  const lowStockProducts = useMemo(
    () =>
      activeInventory.filter(
        (item) =>
          item.tipoItem === "producto" &&
          Number(item.stock || 0) <= Number(item.stockMinimo || 0)
      ),
    [activeInventory]
  );

  const valuations = useMemo(
    () => buildValuations(activeInventory, activeReferences),
    [activeInventory, activeReferences]
  );

  const valuationSummary = useMemo(
    () => getValuationSummary(valuations),
    [valuations]
  );

  const quoteSummary = useMemo(() => getQuoteSummary(quotes), [quotes]);

  const quoteStateChartItems = useMemo(
    () =>
      quoteStates.map((state) => ({
        label: stateLabels[state],
        value: quoteSummary.porEstado[state],
        color: quoteStateColors[state],
      })),
    [quoteSummary]
  );

  const valuationChartItems = useMemo(
    () => [
      {
        label: "Ítems sin referencias",
        value: valuationSummary.sinReferencias,
        color: valuationColors.sinReferencias,
      },
      {
        label: "Ítems bajo mercado",
        value: valuationSummary.bajoMercado,
        color: valuationColors.bajoMercado,
      },
      {
        label: "Ítems dentro de rango",
        value: valuationSummary.dentroRango,
        color: valuationColors.dentroRango,
      },
      {
        label: "Ítems sobre mercado",
        value: valuationSummary.sobreMercado,
        color: valuationColors.sobreMercado,
      },
    ],
    [valuationSummary]
  );

  const activeReferenceTasks = useMemo(
    () =>
      sortReferenceTasks(
        referenceTasks.filter((task) => isActivePendingReferenceTask(task))
      ),
    [referenceTasks]
  );

  const visibleReferenceTasks = activeReferenceTasks.slice(0, 6);

  const saveQuickMovement = async (payload) => {
    await createFinancialMovement(businessId, payload);
    setFinancialFeedback(
      "Movimiento registrado. Resumen y Finanzas ya están actualizados."
    );
  };

  const loading = !inventoryLoaded || !referencesLoaded || !quotesLoaded;
  const hasNoData =
    !loading &&
    activeInventory.length === 0 &&
    activeReferences.length === 0 &&
    quotes.length === 0;

  return (
    <section className="erp-page dashboard-page" style={styles.wrapper}>
      <div className="erp-page-intro">
        <p>
          Una vista breve del estado financiero y operativo del negocio activo.
        </p>
      </div>

      <div className="summary-toolbar">
        <FinancialPeriodSelector
          period={period}
          customStart={customPeriod.start}
          customEnd={customPeriod.end}
          onPeriodChange={setPeriod}
          onCustomStartChange={(start) =>
            setCustomPeriod((current) => ({ ...current, start }))
          }
          onCustomEndChange={(end) =>
            setCustomPeriod((current) => ({ ...current, end }))
          }
          idPrefix="summary-period"
        />
        <span className="summary-toolbar__timezone">
          Periodo comercial · America/Santiago
        </span>
      </div>

      {financialFeedback && (
        <div className="financial-feedback" role="status">
          {financialFeedback}
        </div>
      )}
      {financialState.error && (
        <div className="financial-feedback financial-feedback--error" role="alert">
          {financialState.error}
        </div>
      )}

      <section
        className="financial-metric-grid summary-financial-grid"
        aria-label="Resumen financiero del periodo"
      >
        <FinancialMetricCard
          icon={ArrowDownLeft}
          label="Ingresos"
          value={financialState.summary.paidIncome}
          tone="income"
          note="Pagados en el periodo"
        />
        <FinancialMetricCard
          icon={ArrowUpRight}
          label="Egresos"
          value={financialState.summary.paidExpense}
          tone="expense"
          note="Pagados en el periodo"
        />
        <FinancialMetricCard
          icon={Landmark}
          label="Resultado neto"
          value={financialState.summary.netResult}
          tone={financialState.summary.netResult < 0 ? "expense" : "net"}
          note="Ingresos − egresos pagados"
        />
        <FinancialMetricCard
          icon={ReceiptText}
          label="Por cobrar"
          value={financialState.summary.receivable}
          tone="pending"
          note="Ingresos pendientes"
        />
      </section>

      {financialState.loading ? (
        <div className="financial-inline-loading" role="status">
          Actualizando el resumen financiero...
        </div>
      ) : financialState.items.length === 0 ? (
        <div className="erp-empty-state summary-financial-empty">
          <ReceiptText size={27} aria-hidden="true" />
          <h3>Aún no existen movimientos en este periodo</h3>
          <p>
            {canManage
              ? "Registra tu primer ingreso o egreso para comenzar a ver el resultado del negocio."
              : "Cuando OWNER o ADMIN registren movimientos, aparecerán aquí."}
          </p>
        </div>
      ) : null}

      <section
        className="erp-panel summary-quick-actions"
        aria-labelledby="summary-actions-title"
      >
        <div>
          <h3 id="summary-actions-title" className="erp-panel-title">
            Acciones rápidas
          </h3>
          <p>Atajos a las tareas más frecuentes del negocio.</p>
        </div>
        <div className="summary-quick-actions__buttons">
          {canManage && (
            <Button
              icon={ArrowDownLeft}
              onClick={() => setMovementDialog({ open: true, type: "income" })}
            >
              Registrar ingreso
            </Button>
          )}
          {canManage && (
            <Button
              variant="secondary"
              icon={ArrowUpRight}
              onClick={() => setMovementDialog({ open: true, type: "expense" })}
            >
              Registrar egreso
            </Button>
          )}
          {canManage && (
            <Button
              variant="secondary"
              icon={FilePlus2}
              onClick={() => navigate("/cotizaciones/nueva")}
            >
              Crear cotización
            </Button>
          )}
          <Button
            variant="secondary"
            icon={Boxes}
            onClick={() => navigate("/inventario")}
          >
            Ver inventario
          </Button>
          {canManage && (
            <Button
              variant="secondary"
              icon={Plus}
              onClick={() => navigate("/inventario?new=1")}
            >
              Agregar producto
            </Button>
          )}
        </div>
      </section>

      <section className="erp-panel summary-recent-activity" aria-labelledby="summary-recent-title">
        <div className="erp-panel-header">
          <div>
            <h3 id="summary-recent-title" className="erp-panel-title">
              Actividad financiera reciente
            </h3>
            <p className="erp-secondary-text">
              Últimos movimientos incluidos en el periodo seleccionado.
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate("/finanzas")}>
            Ver Finanzas
          </Button>
        </div>
        {financialState.items.length === 0 ? (
          <p className="erp-secondary-text">
            Aún no existen movimientos en este periodo.
          </p>
        ) : (
          <div className="summary-activity-list">
            {financialState.items.slice(0, 5).map((movement) => (
              <div className="summary-activity-row" key={movement.id}>
                <span
                  className={`summary-activity-row__marker summary-activity-row__marker--${movement.type}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>{movement.concept}</strong>
                  <span>
                    {formatDate(movement.date)} · {movement.status === "paid" ? "Pagado" : "Pendiente"}
                  </span>
                </div>
                <strong className={`financial-amount financial-amount--${movement.type}`}>
                  {movement.type === "income" ? "+" : "−"}
                  {formatCLP(movement.amount)}
                </strong>
              </div>
            ))}
          </div>
        )}
      </section>

      {companyProfilePending && (
        <aside style={styles.companyCompletionCard} aria-labelledby="company-completion-title">
          <div style={styles.companyCompletionCopy}>
            <h3 id="company-completion-title" style={styles.companyCompletionTitle}>
              Completa la información de tu empresa
            </h3>
            <p style={styles.companyCompletionText}>
              Agrega los datos comerciales y de contacto para aprovechar todas
              las funciones de ValoraCloud.
            </p>
          </div>
          <button
            type="button"
            style={styles.companyCompletionButton}
            onClick={() => navigate("/empresa")}
          >
            Completar información
          </button>
        </aside>
      )}

      {error && (
        <p style={styles.errorText} role="alert">
          {error}
        </p>
      )}

      <div className="summary-section-heading">
        <h2>Operación comercial e inventario</h2>
        <p>
          Indicadores existentes de cotizaciones, valorización y referencias.
        </p>
      </div>

      {loading ? (
        <div className="erp-panel" style={styles.panel}>
          <p style={styles.emptyText}>Cargando métricas del sistema...</p>
        </div>
      ) : (
        <>
          {hasNoData && (
            <div className="erp-empty-state" style={styles.emptyState}>
              <h3 style={styles.emptyTitle}>Aún no hay datos operativos</h3>
              <p style={styles.emptyText}>
                Comienza creando ítems de inventario. Luego registra referencias
                y genera cotizaciones para alimentar este panel.
              </p>
            </div>
          )}

          <section
            className="dashboard-metric-panel"
            style={styles.metricGrid}
            aria-label="Indicadores principales"
          >
            <MetricCard label="Ítems activos" value={activeInventory.length} />
            <MetricCard label="Referencias activas" value={activeReferences.length} />
            <MetricCard
              label="Productos con stock bajo"
              value={lowStockProducts.length}
              note={lowStockProducts.length ? "Requieren revisión" : "Sin alertas de inventario"}
            />
            <MetricCard
              label="Cotizaciones vigentes"
              value={quoteSummary.cotizacionesVigentes}
              note={`${quotes.length} totales, incluidas archivadas`}
            />
            <MetricCard
              label="Total cotizado vigente"
              value={formatCLP(quoteSummary.totalVigente)}
              note="Excluye archivadas"
              highlight
            />
          </section>

          <div className="dashboard-chart-grid" style={styles.twoColumnGrid}>
            <div className="erp-panel dashboard-chart-panel" style={styles.panel}>
              <div style={styles.chartHeader}>
                <h3 className="erp-panel-title" style={styles.panelTitle}>
                  Cotizaciones por estado
                </h3>
                <p style={styles.helpText}>Total histórico, incluidas archivadas.</p>
              </div>
              <DashboardDonutChart
                ariaLabel="Distribución de cotizaciones por estado"
                emptyMessage="Sin cotizaciones registradas"
                items={quoteStateChartItems}
              />
            </div>

            <div className="erp-panel dashboard-chart-panel" style={styles.panel}>
              <div style={styles.chartHeader}>
                <h3 className="erp-panel-title" style={styles.panelTitle}>
                  Estado de valorización
                </h3>
                <p style={styles.helpText}>Distribución de ítems activos analizados.</p>
              </div>
              <DashboardDonutChart
                ariaLabel="Distribución del estado de valorización"
                emptyMessage="Sin ítems analizados"
                items={valuationChartItems}
              />
            </div>
          </div>
        </>
      )}

      <div className="erp-panel" style={styles.panel}>
        <div className="erp-panel-header" style={styles.sectionHeader}>
          <div>
            <h3 className="erp-panel-title" style={styles.panelTitle}>
              Tareas de referencias
            </h3>
            <p style={styles.helpText}>
              Prioriza referencias desactualizadas y permite aplazar tareas con
              trazabilidad.
            </p>
          </div>
          {referenceTasks.length > 0 && (
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => navigate("/tareas-referencias")}
            >
              Ver todas las tareas
            </button>
          )}
        </div>

        {activeReferenceTasks.length === 0 ? (
          <p style={styles.emptyText}>No hay tareas pendientes de referencias.</p>
        ) : (
          <>
            <ReferenceTaskTable
              tasks={visibleReferenceTasks}
              postponeDaysByTask={postponeDaysByTask}
              onAction={openReferenceAction}
              onPostpone={postponeTask}
              onPostponeDaysChange={changePostponeDays}
            />
            <p style={styles.tableNote}>
              Mostrando {visibleReferenceTasks.length} de{" "}
              {activeReferenceTasks.length} tareas pendientes.
            </p>
          </>
        )}
      </div>

      <FinancialMovementDialog
        open={movementDialog.open}
        preferredType={movementDialog.type}
        onClose={() =>
          setMovementDialog((current) => ({ ...current, open: false }))
        }
        onSave={saveQuickMovement}
      />
    </section>
  );
}

function ReferenceTaskTable({
  tasks,
  postponeDaysByTask,
  onAction,
  onPostpone,
  onPostponeDaysChange,
}) {
  return (
    <>
      <div
        className="erp-table-region erp-desktop-only"
        style={styles.tableWrapper}
      >
        <table className="erp-table" style={styles.taskTable}>
        <thead>
          <tr>
            <th style={styles.th}>Prioridad</th>
            <th style={styles.th}>Ítem</th>
            <th style={styles.th}>Motivo</th>
            <th style={styles.th}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const isResolved = task.estado === "resuelta";
            const priority = task.prioridad || "media";
            return (
              <tr key={task.id}>
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
                  {isResolved ? (
                    <span style={styles.doneText}>Resuelta automáticamente</span>
                  ) : (
                    <ReferenceTaskActions
                      task={task}
                      postponeDays={postponeDaysByTask[task.id] || 7}
                      onAction={onAction}
                      onPostpone={onPostpone}
                      onPostponeDaysChange={onPostponeDaysChange}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
      <div className="erp-card-list">
        {tasks.map((task) => {
          const priority = task.prioridad || "media";
          return (
            <article className="erp-record-card" key={task.id}>
              <div className="erp-record-card__header">
                <div>
                  <h4 className="erp-record-card__title">{task.itemNombre}</h4>
                  <p className="erp-record-card__subtitle">
                    {getTaskReason(task)}
                  </p>
                </div>
                <span
                  style={{
                    ...styles.priorityBadge,
                    ...getPriorityBadgeStyle(priority),
                  }}
                >
                  {priority}
                </span>
              </div>
              <ReferenceTaskActions
                compact
                task={task}
                postponeDays={postponeDaysByTask[task.id] || 7}
                onAction={onAction}
                onPostpone={onPostpone}
                onPostponeDaysChange={onPostponeDaysChange}
              />
            </article>
          );
        })}
      </div>
    </>
  );
}

function ReferenceTaskActions({
  compact = false,
  task,
  postponeDays,
  onAction,
  onPostpone,
  onPostponeDaysChange,
}) {
  return (
    <div
      className={compact ? "reference-task-card-actions" : "reference-task-actions"}
      style={{
        ...styles.taskActions,
        ...(compact ? styles.taskActionsCompact : {}),
      }}
    >
      <button
        className={compact ? "reference-task-card-primary" : undefined}
        type="button"
        style={styles.primarySmallButton}
        onClick={() => onAction(task)}
      >
        {getTaskActionLabel(task)}
      </button>
      <label
        className="sr-only"
        htmlFor={`dashboard-postpone-${compact ? "mobile" : "desktop"}-${task.id}`}
      >
        Plazo de aplazamiento para {task.itemNombre}
      </label>
      <div className="reference-task-postpone-group" style={styles.postponeGroup}>
        <select
          id={`dashboard-postpone-${compact ? "mobile" : "desktop"}-${task.id}`}
          value={postponeDays}
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
    </div>
  );
}

function MetricCard({ label, value, highlight = false, note = "" }) {
  return (
    <article
      className="erp-metric-card"
      style={{
        ...styles.metricCard,
        ...(highlight ? styles.metricCardHighlight : {}),
      }}
    >
      <span className="erp-metric-card__label" style={styles.metricLabel}>
        {label}
      </span>
      <strong
        className="erp-metric-card__value"
        style={highlight ? styles.metricValueHighlight : styles.metricValue}
      >
        {value}
      </strong>
      {note && <span style={styles.metricNote}>{note}</span>}
    </article>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "14px",
    minWidth: 0,
  },
  companyCompletionCard: {
    alignItems: "center",
    background: "#f0fdfa",
    border: "1px solid #99f6e4",
    borderRadius: "var(--radius-md)",
    display: "flex",
    flexWrap: "wrap",
    gap: "14px",
    justifyContent: "space-between",
    minWidth: 0,
    padding: "14px 16px",
  },
  companyCompletionCopy: {
    flex: "1 1 320px",
    minWidth: 0,
  },
  companyCompletionTitle: {
    color: "#134e4a",
    fontSize: "15px",
    margin: "0 0 4px",
  },
  companyCompletionText: {
    color: "#475569",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: 0,
  },
  companyCompletionButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    minHeight: "40px",
    padding: "9px 12px",
  },
  metricGrid: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: "var(--radius-md)",
    display: "grid",
    gap: 0,
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    minWidth: 0,
    overflow: "hidden",
  },
  twoColumnGrid: {
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: "var(--radius-md)",
    boxShadow: "none",
    minWidth: 0,
    padding: "14px",
  },
  sectionHeader: {
    alignItems: "flex-start",
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "10px",
  },
  panelTitle: {
    fontSize: "16px",
    margin: "0 0 5px",
  },
  chartHeader: {
    borderBottom: "1px solid var(--color-border-subtle)",
    paddingBottom: "10px",
  },
  helpText: {
    color: "#64748b",
    fontSize: "13px",
    margin: 0,
  },
  metricCard: {
    background: "transparent",
    border: 0,
    borderRadius: 0,
    display: "grid",
    gap: "5px",
    minWidth: 0,
    padding: "14px 16px",
  },
  metricCardHighlight: {
    background: "#f7fcfb",
  },
  metricLabel: {
    color: "#64748b",
    fontSize: "13px",
    fontWeight: 700,
  },
  metricValue: {
    color: "#111827",
    fontSize: "22px",
  },
  metricValueHighlight: {
    color: "#0f766e",
    fontSize: "22px",
  },
  metricNote: {
    color: "#64748b",
    fontSize: "13px",
  },
  tableWrapper: {
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "auto",
  },
  taskTable: {
    borderCollapse: "collapse",
    minWidth: "760px",
    width: "100%",
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
    padding: "5px 8px",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  taskActions: {
    alignItems: "center",
    display: "grid",
    gap: "6px",
    gridTemplateColumns: "minmax(132px, 1fr) max-content",
    minWidth: 0,
  },
  taskActionsCompact: {
    gridTemplateColumns: "minmax(0, 1fr)",
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
    minWidth: "132px",
    minHeight: "34px",
    padding: "5px 9px",
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
    borderRadius: "4px 0 0 4px",
    boxSizing: "border-box",
    color: "#334155",
    fontSize: "13px",
    padding: "5px 8px",
    minHeight: "34px",
    width: "86px",
  },
  postponeGroup: {
    alignItems: "center",
    display: "flex",
    minWidth: 0,
  },
  postponeButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "0 4px 4px 0",
    boxSizing: "border-box",
    color: "#334155",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    marginLeft: "-1px",
    padding: "5px 9px",
    textAlign: "center",
    whiteSpace: "nowrap",
    minHeight: "34px",
    width: "76px",
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
  doneText: {
    color: "#047857",
    fontSize: "13px",
    fontWeight: 700,
  },
  tableNote: {
    color: "#64748b",
    fontSize: "13px",
    margin: "10px 0 0",
  },
  emptyState: {
    background: "#ffffff",
    border: "1px dashed #cbd5e1",
    borderRadius: "4px",
    padding: "22px",
    textAlign: "center",
  },
  emptyTitle: {
    margin: "0 0 6px",
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

export default DashboardPage;
