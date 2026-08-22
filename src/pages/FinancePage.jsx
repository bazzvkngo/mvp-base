import React, { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Landmark,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  WalletCards,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import FinancialMetricCard from "../components/finance/FinancialMetricCard";
import FinancialMovementDialog from "../components/finance/FinancialMovementDialog";
import FinancialPeriodSelector from "../components/finance/FinancialPeriodSelector";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import StatusBadge from "../components/ui/StatusBadge";
import {
  FINANCIAL_CATEGORIES,
  FINANCIAL_STATUSES,
  PAYMENT_METHODS,
  buildFinancialCsv,
  filterFinancialMovements,
  getFinancialCategoryLabel,
  getFinancialPeriodRange,
  getFinancialStatusLabel,
  getFinancialTypeLabel,
  getPaymentMethodLabel,
  getSantiagoDateKey,
} from "../domain/financialMovement.mjs";
import useFinancialMovements from "../hooks/useFinancialMovements";
import {
  createFinancialMovement,
  deleteFinancialMovement,
  updateFinancialMovement,
} from "../services/financialService";
import { formatCLP, formatDate } from "../utils/formatters";

const TABS = [
  { id: "all", label: "Todos" },
  { id: "income", label: "Ingresos" },
  { id: "expense", label: "Egresos" },
  { id: "receivable", label: "Por cobrar" },
  { id: "payable", label: "Por pagar" },
];
const VALID_TABS = new Set(TABS.map((tab) => tab.id));
const VALID_PERIODS = new Set(["today", "week", "month", "custom"]);
const PAGE_SIZE = 15;

function getTabQuery(tab, statusFilter) {
  if (tab === "income") return { type: "income", status: statusFilter };
  if (tab === "expense") return { type: "expense", status: statusFilter };
  if (tab === "receivable") return { type: "income", status: "pending" };
  if (tab === "payable") return { type: "expense", status: "pending" };
  return { type: "", status: statusFilter };
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function FinancePage({ businessId, role }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getSantiagoDateKey();
  const selectedPeriod = VALID_PERIODS.has(searchParams.get("period"))
    ? searchParams.get("period")
    : "month";
  const initialMonth = getFinancialPeriodRange("month", {}, today);
  const customStart = searchParams.get("from") || initialMonth.start;
  const customEnd = searchParams.get("to") || today;
  const range = useMemo(
    () =>
      getFinancialPeriodRange(
        selectedPeriod,
        { start: customStart, end: customEnd },
        today
      ),
    [customEnd, customStart, selectedPeriod, today]
  );
  const activeTab = VALID_TABS.has(searchParams.get("view"))
    ? searchParams.get("view")
    : "all";
  const statusFilter = FINANCIAL_STATUSES.some(
    (status) => status.id === searchParams.get("status")
  )
    ? searchParams.get("status")
    : "";
  const categoryId = searchParams.get("category") || "";
  const paymentMethodId = searchParams.get("method") || "";
  const search = searchParams.get("q") || "";
  const serverFilters = getTabQuery(activeTab, statusFilter);
  const summaryState = useFinancialMovements(businessId, range);
  const needsFilteredSubscription = Boolean(serverFilters.type || serverFilters.status);
  const filteredState = useFinancialMovements(
    needsFilteredSubscription ? businessId : "",
    range,
    serverFilters
  );
  const sourceItems = needsFilteredSubscription
    ? filteredState.items
    : summaryState.items;
  const loading = needsFilteredSubscription
    ? filteredState.loading
    : summaryState.loading;
  const error = summaryState.error || filteredState.error;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [dialogState, setDialogState] = useState({ open: false, movement: null, type: "income" });
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const canManage = ["OWNER", "ADMIN", "FINANZAS"].includes(String(role || "").toUpperCase());

  const setParam = (name, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
    setVisibleCount(PAGE_SIZE);
  };

  const filteredItems = useMemo(
    () =>
      filterFinancialMovements(sourceItems, {
        categoryId,
        paymentMethodId,
        search,
      }),
    [categoryId, paymentMethodId, search, sourceItems]
  );
  const visibleItems = filteredItems.slice(0, visibleCount);

  const availableCategories = useMemo(() => {
    if (serverFilters.type) return FINANCIAL_CATEGORIES[serverFilters.type];
    return [
      ...FINANCIAL_CATEGORIES.income.map((item) => ({ ...item, group: "Ingresos" })),
      ...FINANCIAL_CATEGORIES.expense.map((item) => ({ ...item, group: "Egresos" })),
    ];
  }, [serverFilters.type]);

  const openCreate = (type) => {
    setFeedback("");
    setDialogState({ open: true, movement: null, type });
  };

  const saveMovement = async (payload) => {
    if (dialogState.movement) {
      await updateFinancialMovement(businessId, dialogState.movement.id, payload);
      setFeedback("Movimiento actualizado correctamente.");
    } else {
      await createFinancialMovement(businessId, payload);
      setFeedback("Movimiento registrado correctamente.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setDeleting(true);
    try {
      await deleteFinancialMovement(businessId, deleteCandidate.id);
      setDeleteCandidate(null);
      setFeedback("Movimiento eliminado correctamente.");
    } catch (deleteError) {
      setFeedback(deleteError?.message || "No pudimos eliminar el movimiento.");
    } finally {
      setDeleting(false);
    }
  };

  const exportFiltered = () => {
    downloadCsv(
      buildFinancialCsv(filteredItems),
      `valoracloud-movimientos-${businessId}-${range.start}-${range.end}.csv`
    );
    setFeedback(`Se exportaron ${filteredItems.length} movimientos del negocio activo.`);
  };

  return (
    <section className="erp-page financial-page">
      <div className="financial-page-heading">
        <div className="erp-page-intro">
          <p>Registra y consulta el dinero que entró, salió o sigue pendiente. Esta vista operativa no reemplaza la contabilidad formal.</p>
        </div>
        <div className="financial-page-actions no-print">
          <Button variant="secondary" icon={Download} onClick={exportFiltered} disabled={!filteredItems.length}>
            Exportar CSV
          </Button>
          {canManage && (
            <Button icon={Plus} onClick={() => openCreate("income")}>
              Nuevo movimiento
            </Button>
          )}
        </div>
      </div>

      {!canManage && (
        <div className="financial-readonly-notice" role="status">
          Tu rol MEMBER legacy conserva acceso de lectura. OWNER, ADMIN o FINANZAS gestionan movimientos.
        </div>
      )}
      {feedback && <div className="financial-feedback" role="status">{feedback}</div>}
      {error && <div className="financial-feedback financial-feedback--error" role="alert">{error}</div>}

      <div className="financial-period-bar">
        <FinancialPeriodSelector
          period={selectedPeriod}
          customStart={customStart}
          customEnd={customEnd}
          onPeriodChange={(value) => setParam("period", value === "month" ? "" : value)}
          onCustomStartChange={(value) => setParam("from", value)}
          onCustomEndChange={(value) => setParam("to", value)}
          idPrefix="finance-period"
        />
        <span className="financial-period-bar__caption">{formatDate(range.start)} al {formatDate(range.end)}</span>
      </div>

      <section className="financial-metric-grid" aria-label="Indicadores financieros del periodo">
        <FinancialMetricCard icon={ArrowDownLeft} label="Ingresos pagados" value={summaryState.summary.paidIncome} tone="income" note="Solo movimientos pagados" />
        <FinancialMetricCard icon={ArrowUpRight} label="Egresos pagados" value={summaryState.summary.paidExpense} tone="expense" note="Solo movimientos pagados" />
        <FinancialMetricCard icon={Landmark} label="Resultado neto" value={summaryState.summary.netResult} tone={summaryState.summary.netResult < 0 ? "expense" : "net"} note="Ingresos pagados − egresos pagados" />
        <FinancialMetricCard icon={ReceiptText} label="Por cobrar" value={summaryState.summary.receivable} tone="pending" note="Ingresos pendientes" />
        <FinancialMetricCard icon={WalletCards} label="Por pagar" value={summaryState.summary.payable} tone="pending" note="Egresos pendientes" />
      </section>

      <section className="erp-panel financial-movements-panel">
        <div className="financial-tabs" role="tablist" aria-label="Tipo de movimientos">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "financial-tab is-active" : "financial-tab"}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                if (tab.id === "all") next.delete("view");
                else next.set("view", tab.id);
                next.delete("category");
                if (tab.id === "receivable" || tab.id === "payable") {
                  next.delete("status");
                }
                setSearchParams(next, { replace: true });
                setVisibleCount(PAGE_SIZE);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="erp-filters financial-filters no-print">
          <label className="erp-field financial-filter-search">
            <span className="erp-field__label">Buscar</span>
            <input className="erp-control" value={search} onChange={(event) => setParam("q", event.target.value)} placeholder="Concepto, contraparte o referencia" />
          </label>
          {!['receivable', 'payable'].includes(activeTab) && (
            <label className="erp-field">
              <span className="erp-field__label">Estado</span>
              <select className="erp-control" value={statusFilter} onChange={(event) => setParam("status", event.target.value)}>
                <option value="">Todos</option>
                {FINANCIAL_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
              </select>
            </label>
          )}
          <label className="erp-field">
            <span className="erp-field__label">Categoría</span>
            <select className="erp-control" value={categoryId} onChange={(event) => setParam("category", event.target.value)}>
              <option value="">Todas</option>
              {serverFilters.type ? availableCategories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>) : (
                <>
                  <optgroup label="Ingresos">{FINANCIAL_CATEGORIES.income.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</optgroup>
                  <optgroup label="Egresos">{FINANCIAL_CATEGORIES.expense.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</optgroup>
                </>
              )}
            </select>
          </label>
          <label className="erp-field">
            <span className="erp-field__label">Método</span>
            <select className="erp-control" value={paymentMethodId} onChange={(event) => setParam("method", event.target.value)}>
              <option value="">Todos</option>
              {PAYMENT_METHODS.map((method) => <option key={method.id} value={method.id}>{method.label}</option>)}
            </select>
          </label>
        </div>

        {loading ? (
          <div className="erp-empty-state" role="status">Cargando movimientos del periodo...</div>
        ) : visibleItems.length === 0 ? (
          <div className="erp-empty-state financial-empty-state">
            <ReceiptText size={28} aria-hidden="true" />
            <h3>No hay movimientos para estos filtros</h3>
            <p>{summaryState.items.length === 0 ? "Aún no existen movimientos en este periodo." : "Prueba cambiando el periodo o limpiando los filtros."}</p>
            {canManage && summaryState.items.length === 0 && (
              <div className="erp-actions">
                <Button onClick={() => openCreate("income")}>Registrar ingreso</Button>
                <Button variant="secondary" onClick={() => openCreate("expense")}>Registrar egreso</Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="erp-table-region financial-table-region">
              <table className="erp-table financial-table">
                <thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Tipo</th><th>Estado</th><th>Método</th><th>Monto</th><th>Acciones</th></tr></thead>
                <tbody>
                  {visibleItems.map((movement) => {
                    const isManual = (movement.sourceType || "manual") === "manual";
                    return (
                      <tr key={movement.id}>
                        <td>{formatDate(movement.date)}</td>
                        <td><strong className="financial-concept">{movement.concept}</strong>{movement.counterpartyName && <span className="financial-cell-note">{movement.counterpartyName}</span>}{!isManual && <span className="financial-cell-note">Origen protegido: {movement.sourceType}</span>}</td>
                        <td>{getFinancialCategoryLabel(movement.type, movement.categoryId)}</td>
                        <td><span className={`financial-type-label financial-type-label--${movement.type}`}><AppIcon icon={movement.type === "income" ? ArrowDownLeft : ArrowUpRight} size={14} />{getFinancialTypeLabel(movement.type)}</span></td>
                        <td><StatusBadge variant={movement.status === "paid" ? "success" : "warning"}>{getFinancialStatusLabel(movement.status)}</StatusBadge></td>
                        <td>{getPaymentMethodLabel(movement.paymentMethodId)}</td>
                        <td className={`financial-amount financial-amount--${movement.type}`}><span aria-hidden="true">{movement.type === "income" ? "+" : "−"}</span>{formatCLP(movement.amount)}</td>
                        <td>
                          {canManage && isManual ? (
                            <div className="financial-row-actions">
                              <button type="button" aria-label={`Editar ${movement.concept}`} title="Editar" onClick={() => setDialogState({ open: true, movement, type: movement.type })}><AppIcon icon={Pencil} size={16} /></button>
                              <button type="button" aria-label={`Eliminar ${movement.concept}`} title="Eliminar" onClick={() => setDeleteCandidate(movement)}><AppIcon icon={Trash2} size={16} /></button>
                            </div>
                          ) : <span className="financial-cell-note">Solo lectura</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="financial-table-footer">
              <span>Mostrando {visibleItems.length} de {filteredItems.length} movimientos</span>
              {visibleCount < filteredItems.length && <Button variant="secondary" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Cargar más</Button>}
            </div>
          </>
        )}
      </section>

      <FinancialMovementDialog
        open={dialogState.open}
        movement={dialogState.movement}
        preferredType={dialogState.type}
        onClose={() => setDialogState((current) => ({ ...current, open: false }))}
        onSave={saveMovement}
      />

      <ResponsiveDialog
        open={Boolean(deleteCandidate)}
        onClose={() => !deleting && setDeleteCandidate(null)}
        title="Eliminar movimiento"
        description="Esta acción afecta solamente al negocio activo y no se puede deshacer."
        size="small"
        footer={<><Button variant="secondary" onClick={() => setDeleteCandidate(null)} disabled={deleting}>Cancelar</Button><Button variant="danger" onClick={confirmDelete} disabled={deleting}>{deleting ? "Eliminando..." : "Eliminar"}</Button></>}
      >
        <p>¿Confirmas que deseas eliminar <strong>{deleteCandidate?.concept}</strong> por {formatCLP(deleteCandidate?.amount)}?</p>
      </ResponsiveDialog>
    </section>
  );
}

export default FinancePage;
