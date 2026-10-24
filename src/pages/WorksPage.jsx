import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Archive, Clock, Columns3, Info, LayoutList, PackageOpen, Pencil, Plus, Receipt, RefreshCw, Search} from "lucide-react";
import {useLocation, useNavigate, useSearchParams} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import BarcodeInput from "../components/barcode/BarcodeInput";
import Button from "../components/ui/Button";
import EmptyStateIllustration from "../components/ui/EmptyStateIllustration";
import LoadingState from "../components/ui/LoadingState";
import MoreActionsMenu from "../components/ui/MoreActionsMenu";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {SkeletonCards, SkeletonRegion, SkeletonTable} from "../components/ui/Skeleton";
import StatusBadge from "../components/ui/StatusBadge";
import {TabPanel, Tabs} from "../components/ui/Tabs";
import WorkAdditionalsSection from "../features/works/WorkAdditionalsSection.jsx";
import WorkClosedProjects from "../features/works/WorkClosedProjects.jsx";
import {CostField, CostMoneyInput, WorkCostBreakdown, WorkCostDisclosure, WorkCostEmpty, WorkCostEntry} from "../features/works/WorkCostParts.jsx";
import WorkExpenseEvidence from "../features/works/WorkExpenseEvidence.jsx";
import WorkQuoteSelector from "../features/works/WorkQuoteSelector.jsx";
import WorkProjectBoard from "../features/works/WorkProjectBoard.jsx";
import {WORK_CLOSED_BALANCE_LIMIT, WORK_EXPENSE_CATEGORIES, WORK_PRIORITIES, WORK_STATUSES, buildQuickWorkCreationPayload, buildWorkDailyCostSummary, canManageWorks, canOperateWorkTask, canViewWorkProfitability, filterWorkCostsByTaskScope, getClosedWorks, getDefaultBoardWorkId, getEligibleWorkQuoteOptions, getInventoryCurrentCost, getWorkAccumulatedCost, getWorkCostSummary, getWorkDraftErrors, getWorkHistoricalPersonIdentity, getWorkMemberIdentity, getWorkMemberOptionLabel, getWorkOperationalIndicators, getWorkPriorityLabel, getWorkSaleMaterials, getWorkStatusLabel, getWorkTaskProgress, humanizeWorkEvent, isWorkClosed, isWorkOperationalReadOnly, matchesWorkFilters, resolveWorkMaterialScan, WORK_COST_SCOPE_ORPHAN} from "../domain/workModel.mjs";
import {canManageSales} from "../domain/saleModel.mjs";
import {listarMiembrosNegocio} from "../services/businessMemberService.js";
import {listarClientes} from "../services/clientService.js";
import {getInventoryItems} from "../services/inventoryService.js";
import {getQuotes} from "../services/quoteService.js";
import {listarVentas} from "../services/saleService.js";
import {actualizarSubtareaTrabajo, actualizarTrabajo, agregarNotaTrabajo, agregarSubtareaTrabajo, agregarTareaTrabajo, anularAdicionalTrabajo, anularGastoTrabajo, anularHorasHombreTrabajo, asignarTareaTrabajo, cambiarEstadoTareaTrabajo, cambiarEstadoTrabajo, cargarFichaTrabajo, crearAdicionalTrabajo, createWorkCostRequestId, createWorkRequestId, createWorkTaskRequestId, crearTrabajo, documentarTareaTrabajo, eliminarSubtareaTrabajo, eliminarTareaTrabajo, listarTrabajos, obtenerBalanceTrabajo, obtenerEnlaceEvidenciaGastoTrabajo, registrarDevolucionMaterialTrabajo, registrarGastoTrabajo, registrarHorasHombreTrabajo, registrarSalidaMaterialTrabajo, subirEvidenciaGastoTrabajo} from "../services/workService.js";
import {formatMoney} from "../utils/formatters.js";
import "../features/works/works.css";
import useBusinessFormat from "../hooks/useBusinessFormat";

const EMPTY_WORK = Object.freeze({titulo: "", descripcion: "", clienteId: "", cotizacionId: "", responsableUid: "", participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""});
const NEW_CLIENT_VALUE = "__new_client__";
const EMPTY_FILE = Object.freeze({tareas: [], notas: [], historial: [], vinculos: [], cotizaciones: [], ventas: [], gastos: [], horasHombre: [], materiales: [], adicionales: []});
const WORK_DETAIL_TABS = Object.freeze([
  {id: "datos", label: "Datos"},
  {id: "comercial", label: "Comercial"},
  {id: "balance", label: "Balance"},
  {id: "notas", label: "Notas e historial"},
]);

function dateLabel(value, withTime = false) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-CL", withTime ? {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"} : {day: "2-digit", month: "short", year: "numeric"});
}

function Status({value}) {
  const variant = value === "completado" ? "success" : ["cancelado", "en_espera"].includes(value) ? "warning" : "neutral";
  return <StatusBadge variant={variant}>{getWorkStatusLabel(value)}</StatusBadge>;
}

function Priority({value}) {
  return <span className={`works-priority works-priority--${value}`}>{getWorkPriorityLabel(value)}</span>;
}

export default function WorksPage({businessId, currencyCode, currentUserUid, role}) {
  const { locale: businessLocale } = useBusinessFormat();
  const canManage = canManageWorks(role);
  const location = useLocation();
  const navigate = useNavigate();
  const createRequestRef = useRef("");
  const [works, setWorks] = useState([]);
  const [clients, setClients] = useState([]);
  const [members, setMembers] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [sales, setSales] = useState([]);
  const [inventoryProducts, setInventoryProducts] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Un fallo de carga nunca se muestra como vacío: lista y ficha tienen su
  // propio estado de error, separado de `error` (errores de acciones).
  const [loadError, setLoadError] = useState("");
  const [detailError, setDetailError] = useState("");
  // La vista (Lista/Tablero) y el proyecto del tablero viven en la URL
  // (?vista=tablero&proyecto=<id>), así se pueden enlazar y sobreviven a recargar.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("vista") === "tablero" ? "board" : searchParams.get("vista") === "cerrados" ? "closed" : "list";
  const requestedBoardWorkId = searchParams.get("proyecto") || "";
  const updateSearch = (change) => setSearchParams((current) => { const next = new URLSearchParams(current); change(next); return next; }, {replace: true});
  const setView = (next) => updateSearch((params) => { if (next === "board") params.set("vista", "tablero"); else if (next === "closed") { params.set("vista", "cerrados"); params.delete("proyecto"); } else { params.delete("vista"); params.delete("proyecto"); } });
  const selectBoardWork = (workId) => updateSearch((params) => { params.set("vista", "tablero"); params.set("proyecto", workId); });
  const [filters, setFilters] = useState({query: "", estado: "todos", prioridad: "todas", responsableUid: "todos"});
  // Lista: por defecto solo proyectos activos; los cerrados se ven con esta opción o en la vista Cerrados.
  const [showClosed, setShowClosed] = useState(false);
  // Vista Cerrados: balances de los cierres más recientes, con su propio estado de carga y error.
  const [closedBalances, setClosedBalances] = useState({});
  const [closedBalancesLoading, setClosedBalancesLoading] = useState(false);
  const [closedBalancesError, setClosedBalancesError] = useState("");
  const closedBalancesRequestRef = useRef(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingWork, setEditingWork] = useState(null);
  const [draft, setDraft] = useState({...EMPTY_WORK});
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [selectedWork, setSelectedWork] = useState(null);
  const [detail, setDetail] = useState({tareas: [], notas: [], historial: [], vinculos: [], cotizaciones: [], ventas: [], gastos: [], horasHombre: [], materiales: [], adicionales: [], balance: null});
  const [detailLoading, setDetailLoading] = useState(false);
  const [boardDetail, setBoardDetail] = useState(EMPTY_FILE);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState("");
  const selectedIdRef = useRef("");
  const boardIdRef = useRef("");
  const boardRequestRef = useRef(0);
  const [noteText, setNoteText] = useState("");
  const [processing, setProcessing] = useState("");
  const [cancelWork, setCancelWork] = useState(null);
  const [pendingState, setPendingState] = useState(null);
  const [waitReason, setWaitReason] = useState("");
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("datos");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError(""); setLoadError("");
    try {
      const access = {role, currentUserUid};
      const [workList, clientList, memberList, inventoryList, quoteList, saleList] = await Promise.all([listarTrabajos(businessId, access), canManage ? listarClientes(businessId) : Promise.resolve([]), canManage ? listarMiembrosNegocio(businessId) : Promise.resolve([]), getInventoryItems(businessId), canManage ? getQuotes(businessId) : Promise.resolve([]), canManage ? listarVentas(businessId) : Promise.resolve([])]);
      setWorks(workList); setClients(clientList.filter((client) => client.estado === "activo")); setMembers(memberList.filter((member) => member.estado === "activo")); setInventoryProducts(inventoryList.filter((item) => item.estado === "activo" && item.tipoItem === "producto")); setCatalogItems(inventoryList.filter((item) => item.estado === "activo")); setQuotes(quoteList); setSales(saleList);
    } catch (failure) {
      setLoadError(failure.message || "No se pudo cargar Proyectos y trabajos.");
    } finally { setLoading(false); }
  }, [businessId, canManage, currentUserUid, role]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!formOpen || draft.estado !== "cancelado" || editingWork?.estado === "cancelado") return;
    if (editingWork) {
      setFormOpen(false);
      setSelectedWork(editingWork);
      setCancelWork(editingWork);
      return;
    }
    setDraft((current) => ({...current, estado: "pendiente"}));
  }, [draft.estado, editingWork, formOpen]);

  const loadDetail = useCallback(async (workId) => {
    setDetailLoading(true); setDetailError("");
    try {
      const [file, balance] = await Promise.all([
        cargarFichaTrabajo(businessId, workId, {role, currentUserUid}),
        canViewWorkProfitability(role) ? obtenerBalanceTrabajo(businessId, workId) : Promise.resolve(null),
      ]);
      setDetail({...file, balance});
    }
    catch (failure) { setDetailError(failure.message || "No se pudo cargar la ficha del trabajo."); }
    finally { setDetailLoading(false); }
  }, [businessId, currentUserUid, role]);

  // Ficha del proyecto elegido en el tablero (solo tareas, costos y vínculos; sin
  // balance). `silent` recarga tras una acción sin reemplazar el tablero por el
  // aviso de carga, para no perder lo que se está escribiendo en las tarjetas.
  const loadBoardDetail = useCallback(async (workId, {silent = false} = {}) => {
    if (!workId) return;
    const requestNumber = ++boardRequestRef.current;
    if (!silent) setBoardLoading(true);
    setBoardError("");
    try {
      const file = await cargarFichaTrabajo(businessId, workId, {role, currentUserUid});
      if (requestNumber === boardRequestRef.current) setBoardDetail(file);
    }
    catch (failure) { if (requestNumber === boardRequestRef.current) setBoardError(failure.message || "No se pudo cargar el tablero del proyecto."); }
    finally { if (requestNumber === boardRequestRef.current) setBoardLoading(false); }
  }, [businessId, currentUserUid, role]);

  useEffect(() => {
    const requestedWorkId = String(location.state?.openWorkId || "");
    if (!requestedWorkId || loading) return;
    const requestedWork = works.find((work) => work.id === requestedWorkId);
    navigate({pathname: "/trabajos", search: location.search}, {replace: true, state: {}});
    if (requestedWork) {
      setSelectedWork(requestedWork);
      setNoteText("");
      setDetailTab("datos");
      loadDetail(requestedWork.id);
    }
  }, [loadDetail, loading, location.search, location.state, navigate, works]);

  const boardWorkId = works.some((work) => work.id === requestedBoardWorkId) ? requestedBoardWorkId : getDefaultBoardWorkId(works);
  selectedIdRef.current = selectedWork?.id || "";
  boardIdRef.current = view === "board" ? boardWorkId : "";
  useEffect(() => {
    if (view === "board" && !loading && !loadError && boardWorkId) loadBoardDetail(boardWorkId);
  }, [boardWorkId, loadBoardDetail, loadError, loading, view]);

  const openDetail = (work, tab = "datos") => { setSelectedWork(work); setNoteText(""); setDetailTab(tab); loadDetail(work.id); };
  const refreshWork = async (workId) => {
    const [list, inventoryList] = await Promise.all([listarTrabajos(businessId, {role, currentUserUid}), getInventoryItems(businessId)]); setWorks(list); setInventoryProducts(inventoryList.filter((item) => item.estado === "activo" && item.tipoItem === "producto")); setCatalogItems(inventoryList.filter((item) => item.estado === "activo"));
    const current = list.find((work) => work.id === workId);
    if (current && selectedIdRef.current === workId) setSelectedWork(current);
    await Promise.all([
      selectedIdRef.current === workId ? loadDetail(workId) : null,
      boardIdRef.current === workId ? loadBoardDetail(workId, {silent: true}) : null,
    ]);
  };
  const openWorkBoard = (work) => { setSelectedWork(null); selectBoardWork(work.id); };

  const visibleWorks = useMemo(() => works.filter((work) => matchesWorkFilters(work, {...filters, incluirCerrados: showClosed})), [filters, showClosed, works]);
  const hiddenClosedCount = showClosed ? 0 : works.filter(isWorkClosed).length;
  const canSeeProfitability = canViewWorkProfitability(role);
  // Los 20 cierres más recientes cargan su balance en paralelo; un fallo de uno no tumba a los demás.
  const closedBalanceIds = useMemo(() => getClosedWorks(works).slice(0, WORK_CLOSED_BALANCE_LIMIT).map((work) => work.id), [works]);
  const closedBalanceKey = closedBalanceIds.join("|");
  const loadClosedBalances = useCallback(async (ids) => {
    if (!ids.length) return;
    const requestNumber = ++closedBalancesRequestRef.current;
    setClosedBalancesLoading(true); setClosedBalancesError("");
    const results = await Promise.allSettled(ids.map((id) => obtenerBalanceTrabajo(businessId, id)));
    if (requestNumber !== closedBalancesRequestRef.current) return;
    const loaded = {};
    results.forEach((result, index) => { if (result.status === "fulfilled") loaded[ids[index]] = result.value; });
    const failed = results.length - Object.keys(loaded).length;
    setClosedBalances((current) => ({...current, ...loaded}));
    setClosedBalancesError(failed ? `No se pudo cargar el balance de ${failed} proyecto${failed === 1 ? "" : "s"}.` : "");
    setClosedBalancesLoading(false);
  }, [businessId]);
  useEffect(() => {
    if (view === "closed" && canSeeProfitability && !loading && !loadError && closedBalanceKey) loadClosedBalances(closedBalanceKey.split("|"));
  }, [canSeeProfitability, closedBalanceKey, loadClosedBalances, loadError, loading, view]);
  const quoteOptions = useMemo(() => {
    const eligible = getEligibleWorkQuoteOptions(quotes, sales, {workId: editingWork?.id});
    if (!draft.cotizacionId || eligible.some(({quote}) => quote.id === draft.cotizacionId)) return eligible;
    const selectedQuote = quotes.find((quote) => quote.id === draft.cotizacionId);
    const selectedSale = sales.find((sale) => sale.id === selectedQuote?.ventaId);
    return selectedQuote ? [{quote: selectedQuote, sale: selectedSale}, ...eligible] : eligible;
  }, [draft.cotizacionId, editingWork?.id, quotes, sales]);
  const commercialLinkLocked = Boolean(editingWork && (editingWork.cotizacionId || editingWork.cotizacionesVinculadas || editingWork.ventasVinculadas));
  const teamCandidates = members.filter((member) => member.uid !== draft.responsableUid);
  const updateDraft = (field, value) => { setDraft((current) => ({...current, [field]: value})); setFieldErrors((current) => ({...current, [field]: ""})); };
  const selectPrincipal = (event) => {
    const responsableUid = event.target.value;
    setDraft((current) => ({...current, responsableUid, participanteUids: current.participanteUids.filter((uid) => uid !== responsableUid)}));
    setFieldErrors((current) => ({...current, responsableUid: ""}));
  };
  const openNew = () => {
    const currentMember = canManage ? members.find((member) => member.uid === currentUserUid && member.estado === "activo") : null;
    setEditingWork(null);
    setDraft(buildQuickWorkCreationPayload({...EMPTY_WORK, responsableUid: currentMember?.uid || ""}));
    setFieldErrors({});
    createRequestRef.current = createWorkRequestId();
    setMoreDetailsOpen(false);
    setFormOpen(true);
  };
  const openEdit = (work) => { if (isWorkOperationalReadOnly(work)) return; setSelectedWork(null); setEditingWork(work); setDraft({titulo: work.titulo, descripcion: work.descripcion, clienteId: work.clienteId, cotizacionId: work.cotizacionId, responsableUid: work.responsableUid, participanteUids: work.participanteUids, estado: work.estado, prioridad: work.prioridad, fechaInicio: work.fechaInicio, fechaPrevista: work.fechaPrevista}); setFieldErrors({}); setMoreDetailsOpen(false); setFormOpen(true); };
  const selectQuote = (cotizacionId) => {
    const option = quoteOptions.find(({quote}) => quote.id === cotizacionId);
    setDraft((current) => ({...current, cotizacionId, clienteId: option?.quote.clienteId || ""}));
    setFieldErrors((current) => ({...current, cotizacionId: "", clienteId: ""}));
  };
  const selectClient = (event) => {
    if (event.target.value === NEW_CLIENT_VALUE) {
      setFormOpen(false);
      navigate("/clientes", {state: {openCreateClient: true}});
      return;
    }
    updateDraft("clienteId", event.target.value);
  };

  const save = async (event) => {
    event.preventDefault(); const payload = editingWork ? draft : buildQuickWorkCreationPayload(draft); const errors = getWorkDraftErrors(payload); setFieldErrors(errors); if (errors.descripcion || errors.fechaInicio) setMoreDetailsOpen(true); if (Object.keys(errors).length) return;
    setSaving(true); setError("");
    try {
      let workId = editingWork?.id;
      if (editingWork) await actualizarTrabajo(businessId, editingWork.id, payload);
      else { const result = await crearTrabajo(businessId, payload, createRequestRef.current || createWorkRequestId()); workId = result.trabajoId; }
      setFormOpen(false); setEditingWork(null);
      const list = await listarTrabajos(businessId, {role, currentUserUid}); setWorks(list); const current = list.find((work) => work.id === workId); if (current) openDetail(current);
    } catch (saveError) { setError(saveError.message || "No se pudo guardar el trabajo."); }
    finally { setSaving(false); }
  };

  const runWorkAction = async (workId, key, action) => {
    if (!workId) return false; setProcessing(key); setError("");
    try { await action(); await refreshWork(workId); return true; }
    catch (actionError) { setError(actionError.message || "No se pudo actualizar el trabajo."); return false; }
    finally { setProcessing(""); }
  };
  const runDetailAction = (key, action) => runWorkAction(selectedWork?.id, key, action);
  const runBoardAction = (key, action) => runWorkAction(boardWorkId, key, action);

  const addNote = (event) => { event.preventDefault(); const value = noteText.trim(); if (!value) return; runDetailAction("note-new", () => agregarNotaTrabajo(businessId, selectedWork.id, value)).then((success) => {if (success) setNoteText("");}); };
  const completed = selectedWork?.estado === "completado";
  const operationalReadOnly = isWorkOperationalReadOnly(selectedWork);
  const saleMaterials = useMemo(() => getWorkSaleMaterials(detail.ventas), [detail.ventas]);
  const projectCost = useMemo(() => getWorkCostSummary({expenses: detail.gastos, labor: detail.horasHombre, materials: detail.materiales, saleMaterials}), [detail.gastos, detail.horasHombre, detail.materiales, saleMaterials]);
  const dailyCosts = useMemo(() => buildWorkDailyCostSummary({expenses: detail.gastos, labor: detail.horasHombre, materials: detail.materiales, saleMaterials, events: detail.historial}), [detail.gastos, detail.historial, detail.horasHombre, detail.materiales, saleMaterials]);
  const boardWork = works.find((work) => work.id === boardWorkId) || null;
  const boardReadOnly = isWorkOperationalReadOnly(boardWork);
  const boardCurrency = boardWork?.moneda || currencyCode || "CLP";
  const boardSaleMaterials = useMemo(() => getWorkSaleMaterials(boardDetail.ventas), [boardDetail.ventas]);
  // Mismas Functions y mismos requestId que usaba la sección de tareas de la ficha.
  const boardActions = {
    createTask: (task) => runBoardAction("task-new", () => agregarTareaTrabajo(businessId, boardWorkId, task, createWorkTaskRequestId("task-create"))),
    assignTask: (task, responsableUid) => runBoardAction(`task-assign-${task.id}`, () => asignarTareaTrabajo(businessId, boardWorkId, task.id, responsableUid, createWorkTaskRequestId("task-assign"))),
    changeTaskState: (task, estado, motivoEspera = "") => runBoardAction(`task-state-${task.id}`, () => cambiarEstadoTareaTrabajo(businessId, boardWorkId, task.id, estado, {motivoEspera, requestId: createWorkTaskRequestId(`task-${estado}`)})),
    addSubtask: (task, titulo) => runBoardAction(`subtask-new-${task.id}`, () => agregarSubtareaTrabajo(businessId, boardWorkId, task.id, titulo, createWorkTaskRequestId("subtask-create"))),
    toggleSubtask: (task, subtask) => runBoardAction(`subtask-toggle-${subtask.id}`, () => actualizarSubtareaTrabajo(businessId, boardWorkId, task.id, subtask.id, {completada: !subtask.completada}, createWorkTaskRequestId("subtask-toggle"))),
    renameSubtask: (task, subtask, titulo) => runBoardAction(`subtask-title-${subtask.id}`, () => actualizarSubtareaTrabajo(businessId, boardWorkId, task.id, subtask.id, {titulo}, createWorkTaskRequestId("subtask-title"))),
    removeSubtask: (task, subtask) => runBoardAction(`subtask-delete-${subtask.id}`, () => eliminarSubtareaTrabajo(businessId, boardWorkId, task.id, subtask.id, createWorkTaskRequestId("subtask-delete"))),
    addDocumentation: (task, texto) => runBoardAction(`task-document-${task.id}`, () => documentarTareaTrabajo(businessId, boardWorkId, task.id, texto, createWorkTaskRequestId("task-document"))),
    removeLegacy: (task) => runBoardAction(`task-delete-${task.id}`, () => eliminarTareaTrabajo(businessId, boardWorkId, task.id, createWorkTaskRequestId("task-delete"))),
  };
  // Formularios de costos de siempre, acotados a una tarea ("" = General), uno por pestaña
  // del diálogo de costos: Gastos, Horas hombre y Materiales.
  const renderBoardCosts = (scope, section) => section === "materiales"
    ? <MaterialsSection key={`materials-${boardWorkId}-${scope}`} businessId={businessId} canManage={canManage} currency={boardCurrency} currentUserUid={currentUserUid} loading={boardLoading} movements={boardDetail.materiales} processing={processing} products={inventoryProducts} readOnly={boardReadOnly} role={role} runAction={runBoardAction} saleMaterials={boardSaleMaterials} taskId={scope} tasks={boardDetail.tareas} workId={boardWorkId} />
    : <FinancialSection key={`costs-${section}-${boardWorkId}-${scope}`} businessId={businessId} canManage={canManage} currency={boardCurrency} currentUserUid={currentUserUid} expenses={boardDetail.gastos} labor={boardDetail.horasHombre} loading={boardLoading} members={members} part={section === "horas" ? "labor" : "expenses"} processing={processing} readOnly={boardReadOnly} role={role} runAction={runBoardAction} taskId={scope} tasks={boardDetail.tareas} workId={boardWorkId} />;
  const requestStateChange = (next) => {
    if (next === selectedWork?.estado) return;
    if (next === "cancelado") { setCancelWork(selectedWork); return; }
    const progress = getWorkTaskProgress(selectedWork);
    if (next === "en_espera" || (next === "completado" && progress.percent < 100)) {
      setWaitReason(""); setPendingState({estado: next, work: selectedWork}); return;
    }
    runDetailAction("state", () => cambiarEstadoTrabajo(businessId, selectedWork.id, next));
  };

  return <main className="erp-page works-page">
    {canManage && !loadError && <div className="erp-module-intro"><Button type="button" icon={Plus} onClick={openNew}>Nuevo trabajo</Button></div>}
    {error && <div className="works-message works-message--error" role="alert">{error}</div>}
    <section className="erp-panel works-panel" aria-label="Trabajos registrados">
      {loadError ? <LoadFailure message={loadError} onRetry={load} /> : <>
      <div className="works-toolbar"><div className="works-view-switch" role="group" aria-label="Vista"><button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}><AppIcon icon={LayoutList} size={17} />Lista</button><button type="button" className={view === "board" ? "is-active" : ""} onClick={() => setView("board")}><AppIcon icon={Columns3} size={17} />Tablero</button><button type="button" className={view === "closed" ? "is-active" : ""} onClick={() => setView("closed")}><AppIcon icon={Archive} size={17} />Cerrados</button></div>{view === "list" && <span>{visibleWorks.length} trabajo{visibleWorks.length === 1 ? "" : "s"}</span>}</div>
      {view === "list" && <div className="erp-filters works-filters"><label className="erp-field works-search"><span className="erp-field__label">Buscar por número, título o cliente</span><span className="works-search-control"><AppIcon icon={Search} size={18} /><input className="erp-control" value={filters.query} onChange={(event) => setFilters((current) => ({...current, query: event.target.value}))} /></span></label><Filter label="Estado" value={filters.estado} onChange={(value) => setFilters((current) => ({...current, estado: value}))}><option value="todos">Todos</option>{WORK_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Filter><Filter label="Prioridad" value={filters.prioridad} onChange={(value) => setFilters((current) => ({...current, prioridad: value}))}><option value="todas">Todas</option>{WORK_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Filter><Filter label="Responsable principal" value={filters.responsableUid} onChange={(value) => setFilters((current) => ({...current, responsableUid: value}))}><option value="todos">Todos</option>{members.map((member) => <option key={member.uid} value={member.uid}>{getWorkMemberIdentity(member)}</option>)}</Filter><label className="ui-checkbox works-filters__closed"><input className="ui-checkbox__input" type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} /><span className="ui-checkbox__label">Mostrar también cerrados</span></label></div>}
      {loading ? (view === "board" ? <LoadingState variant="section" label="Cargando trabajos..." /> : <SkeletonRegion label="Cargando trabajos..."><SkeletonTable className="erp-desktop-only" columns={7} twoLine /><SkeletonCards className="erp-card-list erp-mobile-only" /></SkeletonRegion>) : view === "board" ? (works.length ? <WorkProjectBoard actions={boardActions} canManage={canManage} canOperate={(task) => canOperateWorkTask(task, {canManage, role, currentUserUid})} costs={{expenses: boardDetail.gastos, labor: boardDetail.horasHombre, materials: boardDetail.materiales}} currency={boardCurrency} currentUserUid={currentUserUid} detail={boardDetail} error={boardError} loading={boardLoading} members={members} onOpenFicha={() => boardWork && openDetail(boardWork)} onRetry={() => loadBoardDetail(boardWorkId)} onSelectWork={selectBoardWork} processing={processing} projectCost={getWorkAccumulatedCost(boardWork || {})} renderCosts={renderBoardCosts} terminal={boardReadOnly} work={boardWork} workId={boardWorkId} works={works} /> : <WorksEmptyState hasAnyWork={false} canManage={canManage} onCreate={openNew} />) : view === "closed" ? <WorkClosedProjects balances={closedBalances} balancesError={closedBalancesError} balancesLoading={closedBalancesLoading} canViewProfitability={canSeeProfitability} onOpenWork={(work) => openDetail(work, canSeeProfitability ? "balance" : "datos")} onRetryBalances={() => loadClosedBalances(closedBalanceIds.filter((id) => !closedBalances[id]))} works={works} /> : <WorkList works={visibleWorks} hasAnyWork={works.length > 0} hiddenClosedCount={hiddenClosedCount} filtersActive={filters.query.trim() !== "" || filters.estado !== "todos" || filters.prioridad !== "todas" || filters.responsableUid !== "todos"} canManage={canManage} onCreate={openNew} onEdit={openEdit} onOpen={openDetail} />}
      </>}
    </section>

    <ResponsiveDialog className="works-form-dialog" open={formOpen} onClose={() => !saving && setFormOpen(false)} size="large" eyebrow="Proyectos y trabajos" title={editingWork ? `Editar ${editingWork.numero}` : "Crear proyecto"} description="Registra la información y planificación inicial del proyecto." footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" form="work-form" loading={saving}>{saving ? "Guardando..." : editingWork ? "Guardar cambios" : "Crear proyecto"}</Button></>}>
      <form id="work-form" className="works-form" onSubmit={save}>
        <FormSection title="Información">
          <div className="works-form-grid">
            <Field className="works-field--wide" label="Nombre" required error={fieldErrors.titulo}><input autoFocus className="erp-control" maxLength="180" placeholder="Escribe un nombre breve para identificar el proyecto" value={draft.titulo} onChange={(event) => updateDraft("titulo", event.target.value)} /></Field>
            <Field className="works-field--wide" label="Cotización asociada" optional error={fieldErrors.cotizacionId}><WorkQuoteSelector currencyCode={currencyCode} disabled={commercialLinkLocked} loading={loading} onChange={selectQuote} options={quoteOptions} value={draft.cotizacionId} /></Field>
            <Field className="works-field--wide" label="Cliente" optional><select className="erp-control" disabled={Boolean(draft.cotizacionId)} value={draft.clienteId} onChange={selectClient}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.clienteId} value={client.clienteId}>{client.nombreRazonSocial} · {client.rut}</option>)}{!draft.cotizacionId && <option value={NEW_CLIENT_VALUE}>+ Nuevo cliente</option>}</select></Field>
          </div>
        </FormSection>
        <FormSection title="Planificación">
          <div className="works-form-grid">
            <Field label="Responsable" optional><select className="erp-control" value={draft.responsableUid} onChange={selectPrincipal}><option value="">Sin responsable</option>{members.map((member) => <option key={member.uid} value={member.uid}>{editingWork ? getWorkMemberIdentity(member) : getWorkMemberOptionLabel(member, currentUserUid)}</option>)}</select></Field>
            <Field label="Prioridad" required error={fieldErrors.prioridad}><select className="erp-control" value={draft.prioridad} onChange={(event) => updateDraft("prioridad", event.target.value)}>{WORK_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
            <fieldset className="works-participants works-field--wide"><legend>Equipo<span className="works-field-optional">Opcional</span></legend>{teamCandidates.length ? <div>{teamCandidates.map((member) => <label key={member.uid} className="ui-checkbox"><input className="ui-checkbox__input" type="checkbox" checked={draft.participanteUids.includes(member.uid)} onChange={(event) => updateDraft("participanteUids", event.target.checked ? [...draft.participanteUids, member.uid] : draft.participanteUids.filter((uid) => uid !== member.uid))} /><span className="ui-checkbox__label">{getWorkMemberIdentity(member)}</span></label>)}</div> : <p className="works-empty-line">No hay otros miembros activos en tu negocio</p>}</fieldset>
            <Field label="Término planificado" optional error={fieldErrors.fechaPrevista}><input className="erp-control" type="date" value={draft.fechaPrevista} onChange={(event) => updateDraft("fechaPrevista", event.target.value)} /></Field>
          </div>
        </FormSection>
        <details className="works-more-details" open={moreDetailsOpen} onToggle={(event) => setMoreDetailsOpen(event.currentTarget.open)}>
          <summary>Más detalles</summary>
          <div className="works-form-grid">
            <Field className="works-field--wide" label="Descripción" optional error={fieldErrors.descripcion}><textarea className="erp-control" rows="2" maxLength="5000" placeholder="Describe el requerimiento o lo informado por el cliente" value={draft.descripcion} onChange={(event) => updateDraft("descripcion", event.target.value)} /></Field>
            <Field label="Inicio planificado" optional error={fieldErrors.fechaInicio}><input className="erp-control" type="date" value={draft.fechaInicio} onChange={(event) => updateDraft("fechaInicio", event.target.value)} /></Field>
          </div>
        </details>
        {!editingWork && <p className="works-form-automatic-note">El número TRB y el estado Pendiente se asignarán automáticamente.</p>}
      </form>
    </ResponsiveDialog>

    <ResponsiveDialog className="works-detail-dialog" open={Boolean(selectedWork)} onClose={() => setSelectedWork(null)} size="large" eyebrow={selectedWork?.numero} title={selectedWork?.titulo} description="Ficha operativa e historial del trabajo.">
      <>
        {selectedWork && <div className="works-detail">
          <div className="works-detail-header">
            <div className="works-detail-actions">
              <Status value={selectedWork.estado} />
              {completed && selectedWork.fechaCompletado && <span className="works-completed-date">Completado el {dateLabel(selectedWork.fechaCompletado, true)}</span>}
              <Button type="button" variant="secondary" icon={Columns3} onClick={() => openWorkBoard(selectedWork)}>Trabajar en el tablero</Button>
              {canManage && <>
                {!operationalReadOnly && <Button type="button" variant="secondary" icon={Pencil} onClick={() => openEdit(selectedWork)}>Editar</Button>}
                {completed ? <Button type="button" variant="secondary" onClick={() => requestStateChange("en_progreso")}>Reabrir proyecto</Button> : <label className="works-status-control">
                  <span className="sr-only">Cambiar estado</span>
                  <select className="erp-control" disabled={Boolean(processing)} value="" onChange={(event) => {
                    const next = event.target.value;
                    requestStateChange(next);
                  }}>
                    <option value="" disabled>Cambiar estado</option>
                    {WORK_STATUSES.filter((item) => item.value !== "cancelado" && item.value !== selectedWork.estado).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>}
                {!operationalReadOnly && <MoreActionsMenu actions={[{label: "Cancelar trabajo", onSelect: () => setCancelWork(selectedWork)}]} menuLabel="Más acciones del proyecto" />}
              </>}
            </div>
            <WorkSummary work={selectedWork} cost={projectCost.total} members={members} />
            {selectedWork.estado === "en_espera" && selectedWork.motivoEspera && <p className="works-wait-reason">En espera: {selectedWork.motivoEspera}</p>}
            {getWorkOperationalIndicators(selectedWork).noRecentActivity && <p className="works-message works-message--warning">Sin actividad reciente (3 días o más).</p>}
          </div>

          {detailError ? <LoadFailure message={detailError} onRetry={() => loadDetail(selectedWork.id)} /> : <>
          <Tabs className="works-detail-tabs" idPrefix="work-detail" label="Secciones del proyecto" onChange={setDetailTab} tabs={WORK_DETAIL_TABS} value={detailTab} />
          <TabPanel active={detailTab === "datos"} id="datos" idPrefix="work-detail">
            <section className="works-detail-section works-overview">
              <h3>Datos</h3>
              <dl className="works-overview-meta">
                <div className="works-overview-meta__wide"><dt>Descripción</dt><dd className={selectedWork.descripcion ? "works-overview-description" : "works-empty-line"}>{selectedWork.descripcion || "Sin descripción registrada."}</dd></div>
                <div className="works-overview-meta__wide"><dt>Equipo adicional</dt><dd className={selectedWork.participantesSnapshot?.length ? "" : "works-empty-line"}>{selectedWork.participantesSnapshot?.map((person) => workPersonIdentity(person, person.uid, members, "Integrante sin identificar")).join(", ") || "Sin integrantes"}</dd></div>
                <div><dt>Inicio planificado</dt><dd>{dateLabel(selectedWork.fechaInicio)}</dd></div>
                {completed && selectedWork.fechaCompletado && <div><dt>Completado el</dt><dd>{dateLabel(selectedWork.fechaCompletado, true)}</dd></div>}
              </dl>
            </section>
          </TabPanel>

          <TabPanel active={detailTab === "comercial"} id="comercial" idPrefix="work-detail">
            <section className="works-detail-section"><CommercialFile canManage={canManage} detail={detail} loading={detailLoading} navigate={navigate} /></section>
            <WorkAdditionalsSection
              key={`additionals-${selectedWork.id}`}
              additionals={detail.adicionales}
              canManage={canManage}
              catalogItems={catalogItems}
              currency={selectedWork.moneda || currencyCode || "CLP"}
              loading={detailLoading}
              onAnnul={(additionalId, motivo) => runDetailAction(`additional-annul-${additionalId}`, () => anularAdicionalTrabajo(businessId, selectedWork.id, additionalId, motivo, createWorkCostRequestId("additional-annul")))}
              onCreate={(payload) => runDetailAction("additional-new", () => crearAdicionalTrabajo(businessId, selectedWork.id, payload, createWorkCostRequestId("additional-create")))}
              onCreateSale={canManageSales(role) ? () => navigate("/ventas/nueva", {state: {trabajoId: selectedWork.id, trabajoNumero: selectedWork.numero, trabajoTitulo: selectedWork.titulo}}) : undefined}
              processing={processing}
              readOnly={operationalReadOnly}
              role={role}
              tasks={detail.tareas}
            />
          </TabPanel>

          <TabPanel active={detailTab === "balance"} id="balance" idPrefix="work-detail">
            {canViewWorkProfitability(role) && <WorkBalanceSection balance={detail.balance} loading={detailLoading} />}
            <DailyCostSummary currency={selectedWork.moneda || currencyCode || "CLP"} loading={detailLoading} rows={dailyCosts} />
            {detail.ventas.some((sale) => sale.estado === "confirmada") && <SaleMaterialsGroup currency={selectedWork.moneda || currencyCode || "CLP"} loading={detailLoading} readOnly={operationalReadOnly} saleMaterials={saleMaterials} />}
          </TabPanel>

          <TabPanel active={detailTab === "notas"} id="notas" idPrefix="work-detail">
            <DetailDisclosure key={`notes-${selectedWork.id}`} defaultOpen title="Notas del proyecto" summary={`${detail.notas.length} nota${detail.notas.length === 1 ? "" : "s"}`}>
              <section className="works-notes-section">
                {canManage && !operationalReadOnly && <form className="works-note-form" onSubmit={addNote}><textarea className="erp-control" rows="2" maxLength="4000" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Agrega una actualización o antecedente relevante." /><Button type="submit" disabled={processing === "note-new"}>Agregar nota</Button></form>}
                <div className="works-notes">{detail.notas.map((note) => <article key={note.id}><header><strong>{workPersonIdentity(note.autorSnapshot, note.autorUid, members, "Persona del equipo")}</strong><time>{dateLabel(note.creadoEn, true)}</time></header><p>{note.texto}</p></article>)}{!detail.notas.length && <p className="works-empty-copy">Aún no hay notas.</p>}</div>
              </section>
            </DetailDisclosure>

            <DetailDisclosure key={`history-${selectedWork.id}`} defaultOpen title="Historial del trabajo" summary={`${detail.historial.length} evento${detail.historial.length === 1 ? "" : "s"}`}>
              {detailLoading ? <LoadingState variant="section" label="Cargando historial..." /> : <ol className="works-timeline">{detail.historial.map((event) => <li key={event.id}><time>{dateLabel(event.fecha, true)}</time><p>{humanizeWorkEvent({...event, actorSnapshot: {...event.actorSnapshot, nombre: workPersonIdentity(event.actorSnapshot, "", members, "Una persona del equipo")}}, {includeAmounts: canManage})}</p>{event.tipo === "nota_agregada" && event.detalle?.texto && <blockquote>{event.detalle.texto}</blockquote>}</li>)}</ol>}
            </DetailDisclosure>
          </TabPanel>
          </>}
        </div>}
      </>
    </ResponsiveDialog>

    <ResponsiveDialog open={Boolean(cancelWork) && !isWorkOperationalReadOnly(cancelWork)} onClose={() => !processing && setCancelWork(null)} size="small" eyebrow="Proyectos y trabajos" title="Cancelar trabajo" description="El registro y su historial se conservarán." footer={<><Button type="button" variant="secondary" disabled={Boolean(processing)} onClick={() => setCancelWork(null)}>Volver</Button><Button type="button" variant="danger" loading={Boolean(processing)} onClick={() => runDetailAction("cancel", () => cambiarEstadoTrabajo(businessId, cancelWork.id, "cancelado")).then(() => setCancelWork(null))}>{processing ? "Cancelando..." : "Cancelar trabajo"}</Button></>}><p>¿Confirmas que deseas cancelar {cancelWork?.numero}?</p></ResponsiveDialog>
    <ResponsiveDialog open={Boolean(pendingState)} onClose={() => !processing && setPendingState(null)} size="small" eyebrow="Proyectos y trabajos" title={pendingState?.estado === "en_espera" ? "Poner proyecto en espera" : "Completar con pendientes"} description={pendingState?.estado === "en_espera" ? "El motivo quedará registrado en el historial." : "El progreso real y las tareas pendientes se conservarán."} footer={<><Button type="button" variant="secondary" disabled={Boolean(processing)} onClick={() => setPendingState(null)}>Volver</Button><Button type="button" disabled={Boolean(processing) || (pendingState?.estado === "en_espera" && !waitReason.trim())} onClick={() => runDetailAction("state-confirm", () => cambiarEstadoTrabajo(businessId, pendingState.work.id, pendingState.estado, waitReason.trim())).then((success) => {if (success) { setPendingState(null); setWaitReason(""); }})}>{pendingState?.estado === "en_espera" ? "Confirmar espera" : "Completar igualmente"}</Button></>}>
      {pendingState?.estado === "en_espera" ? <Field label="Motivo de espera" required><textarea className="erp-control" rows="3" maxLength="1000" value={waitReason} onChange={(event) => setWaitReason(event.target.value)} placeholder="Ej.: esperando aprobación del cliente" /></Field> : <p>Hay tareas o subtareas pendientes. Esta acción no las completará automáticamente.</p>}
    </ResponsiveDialog>
  </main>;
}

function commercialStatusLabel(value) {
  return String(value || "borrador").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function chileToday() {
  const parts = new Intl.DateTimeFormat("en", {timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

// `part` ("expenses" | "labor") muestra solo esa mitad (una pestaña del diálogo de costos); sin él
// muestra Gastos y Horas hombre juntas, como siempre.
// `taskId` (opcional) acota la sección a una tarea ("" = costos generales del proyecto,
// WORK_COST_SCOPE_ORPHAN = costos de tareas que ya no existen, solo lectura): lista solo
// esos registros y registra con la tarea ya asociada. Sin `taskId` se comporta como siempre.
function FinancialSection({businessId, canManage, currency, currentUserUid, expenses, labor, loading, members, part, processing, readOnly, role, runAction, taskId, tasks, workId}) {
  const { locale: businessLocale } = useBusinessFormat();
  const scoped = taskId !== undefined;
  const orphanScope = taskId === WORK_COST_SCOPE_ORPHAN;
  const fixedTaskId = scoped && !orphanScope ? taskId : "";
  const [expenseDraft, setExpenseDraft] = useState({concepto: "", monto: "", categoria: "MATERIAL", responsableDelGastoUid: "", fecha: chileToday(), observacion: "", tareaId: fixedTaskId});
  const [laborDraft, setLaborDraft] = useState({tecnicoUid: "", horas: "", costoHora: "", fecha: chileToday(), concepto: "", tareaId: fixedTaskId});
  const [annulReasons, setAnnulReasons] = useState({});
  const [evidenceError, setEvidenceError] = useState("");
  const canRegister = (canManage || ["TECNICO", "MEMBER"].includes(role)) && !orphanScope;
  const scopedExpenses = filterWorkCostsByTaskScope(expenses, taskId, tasks);
  const scopedLabor = filterWorkCostsByTaskScope(labor, taskId, tasks);
  const visibleExpenses = canManage ? scopedExpenses : scopedExpenses.filter((entry) => [entry.registradoPorUid, entry.responsableDelGastoUid].includes(currentUserUid));
  const visibleLabor = canManage ? scopedLabor : scopedLabor.filter((entry) => [entry.registradoPorUid, entry.tecnicoUid].includes(currentUserUid));
  const activeExpenses = visibleExpenses.filter((entry) => entry.estado !== "anulado");
  const activeLabor = visibleLabor.filter((entry) => entry.estado !== "anulado");
  const expenseTotal = activeExpenses.reduce((sum, entry) => sum + entry.monto, 0);
  const directExpenseTotal = activeExpenses.filter((entry) => entry.clasificacionCosto === "DIRECTO").reduce((sum, entry) => sum + entry.monto, 0);
  const indirectExpenseTotal = activeExpenses.filter((entry) => entry.clasificacionCosto === "INDIRECTO").reduce((sum, entry) => sum + entry.monto, 0);
  const laborHours = activeLabor.reduce((sum, entry) => sum + entry.horas, 0);
  const laborTotal = activeLabor.reduce((sum, entry) => sum + entry.total, 0);
  // Solo visual: el total real lo calcula el servidor al registrar.
  const liveHours = Number(laborDraft.horas); const liveRate = Number(laborDraft.costoHora);
  const liveLaborTotal = liveHours > 0 && liveRate > 0 ? liveHours * liveRate : null;
  const saveExpense = (event) => {
    event.preventDefault();
    const payload = {...expenseDraft, responsableDelGastoUid: canManage ? expenseDraft.responsableDelGastoUid : currentUserUid};
    runAction("expense-new", () => registrarGastoTrabajo(businessId, workId, payload, createWorkCostRequestId("expense-create"))).then((success) => {
      if (success) setExpenseDraft({concepto: "", monto: "", categoria: "MATERIAL", responsableDelGastoUid: "", fecha: chileToday(), observacion: "", tareaId: fixedTaskId});
    });
  };
  const saveLabor = (event) => {
    event.preventDefault();
    const payload = {...laborDraft, tecnicoUid: canManage ? laborDraft.tecnicoUid : currentUserUid};
    runAction("labor-new", () => registrarHorasHombreTrabajo(businessId, workId, payload, createWorkCostRequestId("labor-create"))).then((success) => {
      if (success) setLaborDraft({tecnicoUid: "", horas: "", costoHora: "", fecha: chileToday(), concepto: "", tareaId: fixedTaskId});
    });
  };
  const annul = (event, kind, recordId) => {
    event.preventDefault();
    const key = `${kind}-${recordId}`; const reason = String(annulReasons[key] || "").trim();
    if (!reason) return;
    const action = kind === "expense"
      ? () => anularGastoTrabajo(businessId, workId, recordId, reason, createWorkCostRequestId("expense-annul"))
      : () => anularHorasHombreTrabajo(businessId, workId, recordId, reason, createWorkCostRequestId("labor-annul"));
    runAction(`${key}-annul`, action).then((success) => {if (success) setAnnulReasons((current) => ({...current, [key]: ""}));});
  };
  // SPEC 020 ETAPA 4: la evidencia es un adjunto del gasto ya existente, no
  // un módulo nuevo. Mismo criterio de autorización que registrar el gasto
  // (canManage sin restricción; TECNICO/MEMBER sólo sobre un gasto propio),
  // más "vigente" porque un gasto anulado no admite evidencia nueva
  // (server-side ya lo exige; aquí sólo se oculta el control).
  const canAttachEvidence = (entry) => entry.estado === "vigente" && !readOnly &&
    (canManage || (["TECNICO", "MEMBER"].includes(role) && [entry.registradoPorUid, entry.responsableDelGastoUid].includes(currentUserUid)));
  const uploadEvidence = (expenseId, file) => runAction(`evidence-${expenseId}`, () => subirEvidenciaGastoTrabajo(businessId, workId, expenseId, file, createWorkCostRequestId("expense-evidence")));
  const openEvidence = (storagePath) => {
    setEvidenceError("");
    obtenerEnlaceEvidenciaGastoTrabajo(storagePath)
      .then((url) => window.open(url, "_blank", "noopener,noreferrer"))
      .catch(() => setEvidenceError("No se pudo abrir el documento. Intenta nuevamente."));
  };

  const personOf = (entry) => entry.responsableDelGastoSnapshot?.nombre || entry.responsableDelGastoSnapshot?.correo || entry.registradoPorSnapshot?.nombre || entry.registradoPorSnapshot?.correo || "Equipo";
  const annulControl = (kind, entry, key) => <WorkCostDisclosure label="Anular" tone="danger"><form className="works-annul-form" onSubmit={(event) => annul(event, kind, entry.id)}><CostField label="Motivo de anulación"><input className="erp-control" maxLength="1000" required value={annulReasons[key] || ""} onChange={(event) => setAnnulReasons((current) => ({...current, [key]: event.target.value}))} placeholder="Ej.: monto mal digitado" /></CostField><Button type="submit" variant="danger" disabled={Boolean(processing)}>Confirmar anulación</Button></form></WorkCostDisclosure>;

  return <section className={part ? "works-detail-section works-financial-file works-financial-file--tab" : "works-detail-section works-financial-file"}>
    {!part && <div className="works-section-heading"><div><h3>Costos reales</h3><span>Moneda {currency}</span></div></div>}
    {evidenceError && <div className="works-message works-message--error" role="alert">{evidenceError}</div>}
    <div className={part ? "works-financial-columns works-financial-columns--single" : "works-financial-columns"}>
      {(!part || part === "expenses") && <section><header><div><h4>Gastos</h4><strong>{formatMoney(expenseTotal, currency, businessLocale)}</strong></div><small>Directos e indirectos.</small></header>
        {activeExpenses.length > 0 && <WorkCostBreakdown categories={WORK_EXPENSE_CATEGORIES.map((category) => ({value: category.value, label: category.label, amount: activeExpenses.filter((entry) => entry.categoria === category.value).reduce((sum, entry) => sum + entry.monto, 0)}))} currency={currency} directTotal={directExpenseTotal} indirectTotal={indirectExpenseTotal} locale={businessLocale} />}
        {canRegister && !readOnly && <form className="works-cost-form" onSubmit={saveExpense}>
          <h5 className="works-cost-form__title">Nuevo gasto</h5>
          <CostField className="works-cost-field--wide" label="Concepto"><input className="erp-control" maxLength="240" required value={expenseDraft.concepto} onChange={(event) => setExpenseDraft((current) => ({...current, concepto: event.target.value}))} placeholder="Ej.: compra de conectores" /></CostField>
          <CostField label="Monto"><CostMoneyInput currency={currency} locale={businessLocale} min="0.01" max="999999999999.99" step="0.01" required value={expenseDraft.monto} onChange={(event) => setExpenseDraft((current) => ({...current, monto: event.target.value}))} placeholder="0" /></CostField>
          <CostField label="Tipo de gasto"><select className="erp-control" value={expenseDraft.categoria} onChange={(event) => setExpenseDraft((current) => ({...current, categoria: event.target.value}))}>{WORK_EXPENSE_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}{category.classification === "INDIRECTO" ? " · indirecto" : " · directo"}</option>)}</select></CostField>
          {!scoped && <TaskCostSelect tasks={tasks} value={expenseDraft.tareaId} onChange={(tareaId) => setExpenseDraft((current) => ({...current, tareaId}))} />}
          {canManage && <CostField label="Responsable del gasto" optional><select className="erp-control" value={expenseDraft.responsableDelGastoUid} onChange={(event) => setExpenseDraft((current) => ({...current, responsableDelGastoUid: event.target.value}))}><option value="">Sin responsable específico</option>{members.map((member) => <option key={member.uid} value={member.uid}>{getWorkMemberIdentity(member)}</option>)}</select></CostField>}
          <CostField label="Fecha"><input className="erp-control" type="date" required value={expenseDraft.fecha} onChange={(event) => setExpenseDraft((current) => ({...current, fecha: event.target.value}))} /></CostField>
          <CostField className="works-cost-field--wide" label="Observación" optional><textarea className="erp-control" maxLength="4000" rows="2" value={expenseDraft.observacion} onChange={(event) => setExpenseDraft((current) => ({...current, observacion: event.target.value}))} placeholder="Detalle adicional del gasto" /></CostField>
          <Button type="submit" disabled={Boolean(processing)}>Registrar gasto</Button>
        </form>}
        {loading ? <LoadingState variant="section" label="Cargando gastos..." /> : <><h5 className="works-cost-list__title">Gastos registrados ({visibleExpenses.length})</h5><div className="works-cost-list">{visibleExpenses.map((entry) => { const key = `expense-${entry.id}`; const annulled = entry.estado === "anulado"; return <WorkCostEntry key={entry.id} amount={formatMoney(entry.monto, entry.moneda || currency, businessLocale)} annulled={annulled} annulledReason={entry.motivoAnulacion} meta={`${dateLabel(entry.fecha)} · ${personOf(entry)} · ${taskLabel(tasks, entry.tareaId)}`} note={entry.observacion} tags={[WORK_EXPENSE_CATEGORIES.find((item) => item.value === entry.categoria)?.label || entry.categoria, entry.clasificacionCosto === "INDIRECTO" ? "Indirecto" : "Directo"]} title={entry.concepto}><WorkExpenseEvidence annulled={annulled} canAttach={canAttachEvidence(entry)} entries={entry.evidencia || []} onOpen={openEvidence} onUpload={(file) => uploadEvidence(entry.id, file)} processing={processing === `evidence-${entry.id}`} />{canManage && !readOnly && entry.estado !== "anulado" && annulControl("expense", entry, key)}</WorkCostEntry>;})}{!visibleExpenses.length && <WorkCostEmpty icon={Receipt}>Aún no se han registrado gastos.</WorkCostEmpty>}</div></>}
      </section>}
      {(!part || part === "labor") && <section><header><div><h4>Horas hombre</h4><strong>{laborHours} HH · {formatMoney(laborTotal, currency, businessLocale)}</strong></div><small>El total se calcula al registrar.</small></header>
        {canRegister && !readOnly && <form className="works-cost-form" onSubmit={saveLabor}>
          <h5 className="works-cost-form__title">Nuevas horas hombre</h5>
          <CostField className="works-cost-field--wide" label="Actividad"><input className="erp-control" maxLength="240" required value={laborDraft.concepto} onChange={(event) => setLaborDraft((current) => ({...current, concepto: event.target.value}))} placeholder="Ej.: tendido de cableado" /></CostField>
          {canManage && <CostField label="Técnico"><select className="erp-control" required value={laborDraft.tecnicoUid} onChange={(event) => setLaborDraft((current) => ({...current, tecnicoUid: event.target.value}))}><option value="">Selecciona técnico</option>{members.map((member) => <option key={member.uid} value={member.uid}>{getWorkMemberIdentity(member)}</option>)}</select></CostField>}
          {!scoped && <TaskCostSelect tasks={tasks} value={laborDraft.tareaId} onChange={(tareaId) => setLaborDraft((current) => ({...current, tareaId}))} />}
          <CostField label="Horas"><input className="erp-control" type="number" min="0.01" max="1000" step="0.01" required value={laborDraft.horas} onChange={(event) => setLaborDraft((current) => ({...current, horas: event.target.value}))} placeholder="0" /></CostField>
          <CostField label="Costo por hora"><CostMoneyInput currency={currency} locale={businessLocale} min="0.01" max="999999999999.99" step="0.01" required value={laborDraft.costoHora} onChange={(event) => setLaborDraft((current) => ({...current, costoHora: event.target.value}))} placeholder="0" /></CostField>
          <CostField label="Fecha"><input className="erp-control" type="date" required value={laborDraft.fecha} onChange={(event) => setLaborDraft((current) => ({...current, fecha: event.target.value}))} /></CostField>
          {liveLaborTotal != null && <p className="works-cost-live-total works-cost-field--wide">{liveHours} HH × {formatMoney(liveRate, currency, businessLocale)} = <strong>{formatMoney(liveLaborTotal, currency, businessLocale)}</strong><span>estimado</span></p>}
          <Button type="submit" disabled={Boolean(processing)}>Registrar HH</Button>
        </form>}
        {loading ? <LoadingState variant="section" label="Cargando HH..." /> : <><h5 className="works-cost-list__title">Horas registradas ({visibleLabor.length})</h5><div className="works-cost-list">{visibleLabor.map((entry) => { const key = `labor-${entry.id}`; const annulled = entry.estado === "anulado"; return <WorkCostEntry key={entry.id} amount={formatMoney(entry.total, entry.moneda || currency, businessLocale)} annulled={annulled} annulledReason={entry.motivoAnulacion} meta={`${entry.horas} HH × ${formatMoney(entry.costoHora, entry.moneda || currency, businessLocale)} · ${dateLabel(entry.fecha)} · ${entry.tecnicoSnapshot?.nombre || entry.tecnicoSnapshot?.correo || "Técnico"} · ${taskLabel(tasks, entry.tareaId)}`} title={entry.concepto}>{canManage && !readOnly && entry.estado !== "anulado" && annulControl("labor", entry, key)}</WorkCostEntry>;})}{!visibleLabor.length && <WorkCostEmpty icon={Clock}>Aún no se han registrado horas hombre.</WorkCostEmpty>}</div></>}
      </section>}
    </div>
    <p className="works-financial-note"><AppIcon icon={Info} size={14} />{readOnly ? "Costos históricos visibles: reabre el proyecto para registrar o corregir." : "Los registros no se editan: para corregir, anula el original y crea el reemplazo."}</p>
  </section>;
}

// `taskId` acota la sección igual que en FinancialSection. Los materiales de la venta no se
// asocian a tareas: en modo acotado no suman al total de la sección.
function MaterialsSection({businessId, canManage, currency, currentUserUid, loading, movements, processing, products, readOnly, role, runAction, saleMaterials, taskId, tasks, workId}) {
  const { locale: businessLocale } = useBusinessFormat();
  const scoped = taskId !== undefined;
  const orphanScope = taskId === WORK_COST_SCOPE_ORPHAN;
  const fixedTaskId = scoped && !orphanScope ? taskId : "";
  const [draft, setDraft] = useState({itemId: "", cantidad: "", fecha: chileToday(), tareaId: fixedTaskId});
  const [returnDrafts, setReturnDrafts] = useState({});
  const canConsume = (canManage || ["TECNICO", "MEMBER"].includes(role)) && !orphanScope;
  const scopedMovements = filterWorkCostsByTaskScope(movements, taskId, tasks);
  const exits = scopedMovements.filter((movement) => movement.tipo === "SALIDA_PROYECTO" && (canManage || movement.usuarioUid === currentUserUid));
  const returns = scopedMovements.filter((movement) => movement.tipo === "DEVOLUCION_PROYECTO");
  const visibleExitIds = new Set(exits.map((movement) => movement.id));
  const visibleReturns = returns.filter((movement) => visibleExitIds.has(movement.movimientoOrigenId));
  const saleValuedTotal = scoped ? 0 : saleMaterials.filter((entry) => entry.costoHistoricoDisponible).reduce((sum, entry) => sum + entry.costoTotal, 0);
  const additionalValuedTotal = exits.reduce((sum, movement) => sum + movement.costoTotal, 0) - visibleReturns.reduce((sum, movement) => sum + movement.costoTotal, 0);
  const valuedTotal = saleValuedTotal + additionalValuedTotal;
  const selectedProduct = products.find((product) => product.id === draft.itemId);
  const currentUnitCost = selectedProduct ? getInventoryCurrentCost(selectedProduct) : null;
  const currentCostCurrency = /^[A-Z]{3}$/.test(String(selectedProduct?.costoPromedioMoneda || "").toUpperCase()) ? selectedProduct.costoPromedioMoneda.toUpperCase() : currency;
  const draftQuantity = Number(draft.cantidad);
  const estimatedCost = currentUnitCost != null && Number.isFinite(draftQuantity) && draftQuantity > 0 ? currentUnitCost * draftQuantity : null;
  const returnedFor = (movementId) => returns.filter((movement) => movement.movimientoOrigenId === movementId).reduce((sum, movement) => sum + movement.cantidad, 0);
  const saveExit = (event) => {
    event.preventDefault();
    runAction("material-exit", () => registrarSalidaMaterialTrabajo(businessId, workId, draft, createWorkCostRequestId("material-exit"))).then((success) => {
      if (success) setDraft({itemId: "", cantidad: "", fecha: chileToday(), tareaId: fixedTaskId});
    });
  };
  // Lectura única: solo preselecciona; la salida se registra con "Registrar salida".
  const scanMaterial = (barcode) => {
    const result = resolveWorkMaterialScan(products, barcode, draft);
    if (result.status === "ambiguous") throw new Error("Hay más de un producto con este código.");
    if (result.status !== "found") throw new Error("Este producto no está disponible para salida.");
    setDraft((current) => ({...current, itemId: result.itemId, cantidad: String(current.cantidad ?? "").trim() !== "" ? current.cantidad : result.cantidad}));
    return {key: result.itemId, label: result.product.nombre};
  };
  const saveReturn = (event, exit) => {
    event.preventDefault();
    const value = returnDrafts[exit.id] || {cantidad: "", fecha: chileToday()};
    runAction(`material-return-${exit.id}`, () => registrarDevolucionMaterialTrabajo(businessId, workId, exit.id, value.cantidad, value.fecha, createWorkCostRequestId("material-return"))).then((success) => {
      if (success) setReturnDrafts((current) => ({...current, [exit.id]: {cantidad: "", fecha: chileToday()}}));
    });
  };
  const updateReturn = (exitId, field, value) => setReturnDrafts((current) => ({...current, [exitId]: {...(current[exitId] || {cantidad: "", fecha: chileToday()}), [field]: value}}));

  return <section className="works-detail-section works-financial-file works-financial-file--tab">
    <div className="works-section-heading"><div><h3>Materiales utilizados</h3><span>Consumo neto valorizado</span></div><strong>{formatMoney(Math.max(0, valuedTotal), currency, businessLocale)}</strong></div>
    {canConsume && !readOnly && <form className="works-cost-form works-material-form" onSubmit={saveExit}>
      <h5 className="works-cost-form__title">Nueva salida de material</h5>
      <div className="works-material-product works-cost-field--wide"><CostField label="Producto"><select className="erp-control" required value={draft.itemId} onChange={(event) => setDraft((current) => ({...current, itemId: event.target.value}))}>
        <option value="">Selecciona producto</option>
        {products.map((product) => <option key={product.id} value={product.id}>{product.nombre} · stock {Number(product.stock || 0)} {product.unidad || product.unidadStock || "unidad"}</option>)}
      </select>{selectedProduct && <small className="works-cost-hint">Disponible: {Number(selectedProduct.stock || 0)} {selectedProduct.unidad || selectedProduct.unidadStock || "unidad"}</small>}</CostField><BarcodeInput actionOnly actionLabel="Escanear producto" disabled={Boolean(processing)} onSubmit={scanMaterial} /></div>
      {!scoped && <TaskCostSelect tasks={tasks} value={draft.tareaId} onChange={(tareaId) => setDraft((current) => ({...current, tareaId}))} />}
      <CostField label="Cantidad"><input className="erp-control" type="number" min="0.01" max="999999999.99" step="0.01" required value={draft.cantidad} onChange={(event) => setDraft((current) => ({...current, cantidad: event.target.value}))} placeholder="0" /></CostField>
      <CostField label="Fecha"><input className="erp-control" type="date" required value={draft.fecha} onChange={(event) => setDraft((current) => ({...current, fecha: event.target.value}))} /></CostField>
      <Button type="submit" disabled={Boolean(processing)}>Registrar salida</Button>
      {selectedProduct && <dl className="works-material-estimate">
        <div><dt>Costo unitario vigente</dt><dd>{currentUnitCost == null ? "No disponible" : formatMoney(currentUnitCost, currentCostCurrency, businessLocale)}</dd></div>
        <div><dt>Costo estimado de esta salida</dt><dd>{estimatedCost == null ? "Ingresa una cantidad" : formatMoney(estimatedCost, currentCostCurrency, businessLocale)}</dd></div>
      </dl>}
    </form>}
    <p className="works-financial-note"><AppIcon icon={Info} size={14} />{readOnly ? "Salidas y devoluciones registradas durante el proyecto." : "Cada salida mueve inventario y congela su costo; la devolución restituye stock al mismo costo."}</p>
    {loading ? <LoadingState variant="section" label="Cargando materiales..." /> : <><h5 className="works-cost-list__title">Salidas registradas ({exits.length})</h5><div className="works-cost-list">{exits.map((exit) => {
      const returned = returnedFor(exit.id); const remaining = Math.max(0, Math.round((exit.cantidad - returned) * 100) / 100);
      const returnValue = returnDrafts[exit.id] || {cantidad: "", fecha: chileToday()};
      return <WorkCostEntry key={exit.id} amount={formatMoney(exit.costoTotal, exit.moneda || currency, businessLocale)} meta={`${exit.cantidad} ${exit.productoSnapshot?.unidad || "unidad"} × ${formatMoney(exit.costoUnitario, exit.moneda || currency, businessLocale)} · ${dateLabel(exit.fecha)} · ${exit.usuarioSnapshot?.nombre || "Equipo"} · ${taskLabel(tasks, exit.tareaId)}`} tags={[`Devuelto ${returned}`, `Pendiente ${remaining}`]} title={exit.productoSnapshot?.nombre || "Producto"}>
        {canManage && !readOnly && remaining > 0 && <WorkCostDisclosure label="Devolver"><form className="works-annul-form works-return-form" onSubmit={(event) => saveReturn(event, exit)}><CostField label="Cantidad a devolver"><input className="erp-control" type="number" min="0.01" max={remaining} step="0.01" required value={returnValue.cantidad} onChange={(event) => updateReturn(exit.id, "cantidad", event.target.value)} placeholder="0" /></CostField><CostField label="Fecha"><input className="erp-control" type="date" required value={returnValue.fecha} onChange={(event) => updateReturn(exit.id, "fecha", event.target.value)} /></CostField><Button type="submit" variant="secondary" disabled={Boolean(processing)}>Registrar devolución</Button></form></WorkCostDisclosure>}
      </WorkCostEntry>;
    })}{!exits.length && <WorkCostEmpty icon={PackageOpen}>Aún no se han registrado consumos adicionales.</WorkCostEmpty>}</div></>}
  </section>;
}

// Materiales de la(s) venta(s) confirmada(s) del proyecto: ya descontados del
// inventario por la Venta y valorizados con su costo histórico. Solo lectura;
// los consumos adicionales se registran desde el tablero.
function SaleMaterialsGroup({currency, loading, readOnly, saleMaterials}) {
  const { locale: businessLocale } = useBusinessFormat();
  const saleValuedTotal = saleMaterials.filter((entry) => entry.costoHistoricoDisponible).reduce((sum, entry) => sum + entry.costoTotal, 0);
  const unavailableSaleMaterialCosts = saleMaterials.filter((entry) => !entry.costoHistoricoDisponible).length;
  return <section className="works-detail-section works-material-group works-material-group--sale">
    <header><div><h3>Materiales incluidos en la venta</h3><p>{readOnly ? "Los materiales de la venta asociada ya fueron descontados del inventario y se conservan como historial." : "Los materiales de la venta asociada ya fueron descontados del inventario. Los consumos adicionales del proyecto se registran en el tablero, en la tarjeta de cada tarea o en General."}</p></div><strong>{formatMoney(saleValuedTotal, currency, businessLocale)}</strong></header>
    {loading ? <LoadingState variant="section" label="Cargando materiales de la venta..." /> : saleMaterials.length > 0 ? <div className="works-sale-materials-list">{saleMaterials.map((material) => <article key={material.id}>
      <div><small>Producto</small><strong>{material.nombre}</strong><span>{material.ventaNumero}</span></div>
      <div><small>Cantidad</small><strong>{material.cantidad} {material.unidad}</strong></div>
      <div><small>Costo unitario histórico</small><strong>{material.costoHistoricoDisponible ? formatMoney(material.costoUnitario, material.moneda || currency, businessLocale) : "No disponible"}</strong></div>
      <div><small>Costo total</small><strong>{material.costoHistoricoDisponible ? formatMoney(material.costoTotal, material.moneda || currency, businessLocale) : "No disponible"}</strong></div>
      <div className="works-material-stock-state"><small>Inventario</small><strong>Stock ya descontado por la Venta</strong></div>
    </article>)}</div> : <p className="works-empty-copy">La venta confirmada no contiene productos físicos descontados del inventario.</p>}
    {!loading && unavailableSaleMaterialCosts > 0 && <p className="works-message works-message--warning">El costo histórico de {unavailableSaleMaterialCosts} material{unavailableSaleMaterialCosts === 1 ? "" : "es"} no está disponible.</p>}
  </section>;
}

function commercialTotal(document, locale) {
  const currency = /^[A-Z]{3}$/.test(String(document?.moneda || "")) ? document.moneda : "CLP";
  return new Intl.NumberFormat(locale, {style: "currency", currency, maximumFractionDigits: currency === "CLP" ? 0 : 2}).format(Number(document?.total || 0));
}

function CommercialFile({canManage, detail, loading, navigate}) {
  const { locale: businessLocale } = useBusinessFormat();
  return <div className="works-commercial-file">
    <div className="works-commercial-heading"><div><h4>Resumen comercial</h4><span>{detail.cotizaciones.length} cotización{detail.cotizaciones.length === 1 ? "" : "es"} · {detail.ventas.length} venta{detail.ventas.length === 1 ? "" : "s"}</span></div></div>
    {loading ? <LoadingState variant="section" label="Cargando expediente..." /> : <div className="works-commercial-list">
      {detail.cotizaciones.map((quote) => {
        const relatedSale = detail.ventas.find((sale) => sale.cotizacionId === quote.id);
        const rejection = quote.motivoRechazoCliente || quote.comentarioRechazoCliente || "";
        return <article key={quote.id}><div><strong>{quote.numero || "Cotización"}</strong><span>{commercialStatusLabel(quote.estado)}{canManage ? ` · ${commercialTotal(quote, businessLocale)}` : ""}</span>{quote.estado === "rechazada" && rejection && <small>{rejection}</small>}</div><div><button type="button" onClick={() => navigate("/cotizaciones", {state: {openQuoteId: quote.id}})}>Abrir cotización</button>{relatedSale && <button type="button" onClick={() => navigate(`/ventas/${relatedSale.id}/editar`)}>Venta {relatedSale.numero}</button>}</div></article>;
      })}
      {detail.ventas.filter((sale) => !detail.cotizaciones.some((quote) => quote.id === sale.cotizacionId)).map((sale) => <article key={sale.id}><div><strong>{sale.numero || "Venta"}</strong><span>{commercialStatusLabel(sale.estado)}{canManage ? ` · ${commercialTotal(sale, businessLocale)}` : ""}</span></div><div><button type="button" onClick={() => navigate(`/ventas/${sale.id}/editar`)}>Abrir venta</button></div></article>)}
      {!detail.cotizaciones.length && !detail.ventas.length && <p className="works-empty-copy">Este proyecto aún no tiene cotizaciones ni ventas vinculadas.</p>}
    </div>}
  </div>;
}

function Filter({children, label, onChange, value}) { return <label className="erp-field"><span className="erp-field__label">{label}</span><select className="erp-control" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>; }
function Field({children, className = "", error, label, optional = false, required}) { return <label className={`erp-field ${className}`}><span className="erp-field__label">{label}{required ? " *" : optional ? <span className="works-field-optional">Opcional</span> : ""}</span>{children}{error && <small className="works-field-error">{error}</small>}</label>; }
function FormSection({children, title}) { return <section className="works-form-section"><h3>{title}</h3>{children}</section>; }
function DetailDisclosure({children, defaultOpen = false, summary, title}) { return <details className="works-detail-disclosure" open={defaultOpen || undefined}><summary><span><strong>{title}</strong><small>{summary}</small></span></summary><div className="works-detail-disclosure__content">{children}</div></details>; }
function taskLabel(tasks, taskId) { return taskId ? tasks.find((task) => task.id === taskId)?.titulo || "Tarea no disponible" : "Proyecto completo"; }
function TaskCostSelect({onChange, tasks, value}) { return <CostField label="Asociado a"><select className="erp-control" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Costo general del proyecto</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.titulo}</option>)}</select></CostField>; }
function workPersonIdentity(snapshot, uid, members = [], fallback = "Sin responsable principal") {
  return getWorkHistoricalPersonIdentity(snapshot, uid, members, fallback);
}

// Error de carga (lista o ficha): solo el mensaje y Reintentar. Nunca convive
// con los textos de vacío, porque esos arreglos vacíos no son datos reales.
function LoadFailure({message, onRetry}) {
  return <div className="works-message works-message--error works-load-error" role="alert"><span>{message}</span><Button type="button" variant="secondary" icon={RefreshCw} onClick={onRetry}>Reintentar</Button></div>;
}

// Vacío compartido por la Lista y el Tablero: "no hay Proyectos" frente a
// "los filtros no coinciden".
function WorksEmptyState({canManage, filtersActive = true, hasAnyWork, hiddenClosedCount = 0, onCreate}) {
  // Todos los proyectos están cerrados y la Lista solo muestra los activos: no es un error de filtros.
  const onlyClosed = hasAnyWork && hiddenClosedCount > 0 && !filtersActive;
  return (
    <div className="erp-empty-state ui-empty-state">
      <EmptyStateIllustration variant={hasAnyWork && !onlyClosed ? "no-results" : "empty-list"} />
      <h3>{onlyClosed ? "No hay proyectos activos" : hasAnyWork ? "No hay trabajos coincidentes" : "Aún no hay trabajos"}</h3>
      <p>
        {onlyClosed
          ? "Todos tus proyectos están cerrados. Marca «Mostrar también cerrados» o abre la vista Cerrados."
          : hasAnyWork
          ? `Prueba con otra búsqueda, estado, prioridad o responsable.${hiddenClosedCount > 0 ? " Los proyectos cerrados están ocultos." : ""}`
          : canManage
            ? "Crea el primer trabajo para organizar tareas, costos y avance del proyecto."
            : "Los perfiles autorizados pueden crear el primer trabajo."}
      </p>
      {!hasAnyWork && canManage && (
        <div className="ui-empty-state__actions">
          <Button type="button" icon={Plus} onClick={onCreate}>Nuevo trabajo</Button>
        </div>
      )}
    </div>
  );
}

function WorkList({canManage, filtersActive, hasAnyWork, hiddenClosedCount, onCreate, onEdit, onOpen, works}) {
  if (!works.length) return <WorksEmptyState canManage={canManage} filtersActive={filtersActive} hasAnyWork={hasAnyWork} hiddenClosedCount={hiddenClosedCount} onCreate={onCreate} />;
  return <><div className="erp-table-region erp-desktop-only"><table className="erp-table works-table"><thead><tr><th>Trabajo</th><th>Cliente</th><th>Responsable principal</th><th>Prioridad</th><th>Término planificado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{works.map((work) => <tr key={work.id}><td><button className="works-link" type="button" onClick={() => onOpen(work)}><strong>{work.numero}</strong><span>{work.titulo}</span></button></td><td>{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</td><td>{workPersonIdentity(work.responsableSnapshot, work.responsableUid)}</td><td><Priority value={work.prioridad} /></td><td>{dateLabel(work.fechaPrevista)}</td><td><Status value={work.estado} /></td><td><div className="works-row-actions"><button type="button" onClick={() => onOpen(work)}>Ver</button>{canManage && !isWorkOperationalReadOnly(work) && <button type="button" onClick={() => onEdit(work)}>Editar</button>}</div></td></tr>)}</tbody></table></div><div className="erp-card-list erp-mobile-only">{works.map((work) => <article key={work.id} className="erp-record-card"><header className="erp-record-card__header"><div><span className="works-number">{work.numero}</span><h3 className="erp-record-card__title">{work.titulo}</h3></div><Status value={work.estado} /></header><dl className="erp-meta-grid"><div className="erp-meta"><dt className="erp-meta__label">Cliente</dt><dd className="erp-meta__value">{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Responsable principal</dt><dd className="erp-meta__value">{workPersonIdentity(work.responsableSnapshot, work.responsableUid)}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Prioridad</dt><dd className="erp-meta__value"><Priority value={work.prioridad} /></dd></div><div className="erp-meta"><dt className="erp-meta__label">Término planificado</dt><dd className="erp-meta__value">{dateLabel(work.fechaPrevista)}</dd></div></dl><div className="works-card-actions"><Button type="button" variant="secondary" onClick={() => onOpen(work)}>Ver ficha</Button>{canManage && !isWorkOperationalReadOnly(work) && <Button type="button" variant="secondary" onClick={() => onEdit(work)}>Editar</Button>}</div></article>)}</div></>;
}

function WorkSummary({cost, members, work}) { const { locale: businessLocale } = useBusinessFormat(); const progress = getWorkTaskProgress(work); return <dl className="works-summary"><div><dt>Cliente</dt><dd>{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</dd></div><div><dt>Responsable principal</dt><dd>{workPersonIdentity(work.responsableSnapshot, work.responsableUid, members)}</dd></div><div><dt>Prioridad</dt><dd><Priority value={work.prioridad} /></dd></div><div><dt>Término planificado</dt><dd>{dateLabel(work.fechaPrevista)}</dd></div><div><dt>Progreso</dt><dd>{progress.percent}% · {progress.completed}/{progress.total} tareas</dd></div><div><dt>Costo acumulado</dt><dd>{formatMoney(cost, work.moneda || "CLP", businessLocale)}</dd></div></dl>; }

function DailyCostSummary({currency, loading, rows}) { const { locale: businessLocale } = useBusinessFormat(); return <section className="works-detail-section works-daily-costs"><h3>Costos por día</h3>{loading ? <LoadingState variant="section" label="Cargando costos..." /> : rows.length ? <div className="erp-table-region"><table className="erp-table"><thead><tr><th>Fecha</th><th>Materiales</th><th>HH</th><th>Gastos</th><th>Total</th></tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{dateLabel(row.date)}</td><td>{formatMoney(row.materials, currency, businessLocale)}</td><td>{formatMoney(row.labor, currency, businessLocale)}</td><td>{formatMoney(row.expenses, currency, businessLocale)}</td><td><strong>{formatMoney(row.total, currency, businessLocale)}</strong></td></tr>)}</tbody></table></div> : <p className="works-empty-copy">Aún no hay costos fechados para resumir.</p>}</section>; }

function WorkBalanceSection({balance, loading}) {
  const { locale: businessLocale } = useBusinessFormat();
  if (loading) return <section className="works-detail-section"><h3>Balance y margen</h3><LoadingState variant="section" label="Calculando desde fuentes autoritativas..." /></section>;
  if (!balance) return null;
  const money = (value) => value == null ? "No disponible" : formatMoney(value, balance.moneda, businessLocale);
  const inconsistent = balance.estado === "INCONSISTENTE_MONEDA";
  const unavailableHistoricalCosts = Number(balance.fuentes?.materialesVentaSinCosto || 0);
  return <section className="works-detail-section works-balance">
    <div className="works-section-heading"><div><h3>Balance y margen</h3><span>{balance.estado === "COMPLETO" ? "Con Ventas confirmadas" : balance.estado === "PARCIAL_SIN_VENTA" ? "Balance parcial · sin Venta confirmada" : "Balance bloqueado · monedas incompatibles"}</span></div><strong>{balance.moneda}</strong></div>
    {inconsistent && <div className="works-message works-message--error" role="alert">No se mezclaron importes. Moneda base {balance.moneda}; incompatibles: {balance.monedasIncompatibles.join(", ")}.</div>}
    {balance.estado === "PARCIAL_SIN_VENTA" && <p className="works-empty-copy">Aún no hay venta confirmada para calcular resultado y margen. Los costos registrados se muestran igualmente.</p>}
    {!inconsistent && <><dl className="works-balance-grid works-balance-primary">
      <div><dt>Ingresos</dt><dd>{balance.valorComercial == null ? "Sin ingreso confirmado" : money(balance.valorComercial)}</dd></div>
      <div><dt>Costos</dt><dd>{money(balance.costoTotal)}</dd></div>
      <div><dt>Resultado</dt><dd>{money(balance.resultado)}</dd></div>
      <div><dt>Margen</dt><dd>{balance.rentabilidadPct == null ? "No disponible" : `${balance.rentabilidadPct.toLocaleString("es-CL", {maximumFractionDigits: 2})}%`}</dd></div>
    </dl><dl className="works-balance-detail-grid">
      <div><dt>Materiales de la venta</dt><dd>{money(balance.materialesVenta)}</dd></div>
      <div><dt>Materiales adicionales</dt><dd>{money(balance.materialesAdicionales)}</dd></div>
      <div><dt>Horas hombre</dt><dd>{money(balance.horasHombre)}</dd></div>
      <div><dt>Gastos directos</dt><dd>{money(balance.gastosDirectos)}</dd></div>
      <div><dt>Gastos indirectos</dt><dd>{money(balance.gastosIndirectos)}</dd></div>
    </dl></>}
    {inconsistent && <div className="works-balance-breakdown">{balance.desglosePorMoneda.map((entry) => <article key={entry.moneda}><strong>{entry.moneda}</strong><span>Ingresos {formatMoney(entry.valorComercial, entry.moneda, businessLocale)} · costos {formatMoney(entry.costoTotal, entry.moneda, businessLocale)}</span></article>)}</div>}
    {unavailableHistoricalCosts > 0 && <p className="works-message works-message--warning">El costo histórico de {unavailableHistoricalCosts} material{unavailableHistoricalCosts === 1 ? "" : "es"} no está disponible.</p>}
  </section>;
}
