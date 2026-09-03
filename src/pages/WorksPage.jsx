import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {BriefcaseBusiness, Columns3, LayoutList, Pencil, Plus, Search, Trash2} from "lucide-react";
import {useLocation, useNavigate} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import StatusBadge from "../components/ui/StatusBadge";
import WorkQuoteSelector from "../features/works/WorkQuoteSelector.jsx";
import WorkTaskBoard from "../features/works/WorkTaskBoard.jsx";
import {WORK_EXPENSE_CATEGORIES, WORK_PRIORITIES, WORK_STATUSES, WORK_TASK_STATUSES, buildQuickWorkCreationPayload, buildWorkDailyCostSummary, canManageWorks, canOperateWorkTask, canViewWorkProfitability, getEligibleWorkQuoteOptions, getInventoryCurrentCost, getTaskProgress, getVisibleWorkTasks, getWorkAccumulatedCost, getWorkCostSummary, getWorkDraftErrors, getWorkHistoricalPersonIdentity, getWorkMemberIdentity, getWorkMemberOptionLabel, getWorkOperationalIndicators, getWorkPriorityLabel, getWorkSaleMaterials, getWorkStatusLabel, getWorkTaskProgress, getWorkTaskStatusOptions, hasAdditionalWorkMembers, humanizeWorkEvent, isWorkOperationalReadOnly, matchesWorkFilters} from "../domain/workModel.mjs";
import {listarMiembrosNegocio} from "../services/businessMemberService.js";
import {listarClientes} from "../services/clientService.js";
import {getInventoryItems} from "../services/inventoryService.js";
import {getQuotes} from "../services/quoteService.js";
import {listarVentas} from "../services/saleService.js";
import {actualizarSubtareaTrabajo, actualizarTrabajo, agregarNotaTrabajo, agregarSubtareaTrabajo, agregarTareaTrabajo, anularGastoTrabajo, anularHorasHombreTrabajo, asignarTareaTrabajo, cambiarEstadoTareaTrabajo, cambiarEstadoTrabajo, cargarFichaTrabajo, createWorkCostRequestId, createWorkRequestId, createWorkTaskRequestId, crearTrabajo, documentarTareaTrabajo, eliminarSubtareaTrabajo, eliminarTareaTrabajo, listarTrabajos, obtenerBalanceTrabajo, registrarDevolucionMaterialTrabajo, registrarGastoTrabajo, registrarHorasHombreTrabajo, registrarSalidaMaterialTrabajo} from "../services/workService.js";
import {formatMoney} from "../utils/formatters.js";
import "../features/works/works.css";

const EMPTY_WORK = Object.freeze({titulo: "", descripcion: "", clienteId: "", cotizacionId: "", responsableUid: "", participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""});
const BOARD_STATUSES = ["pendiente", "en_progreso", "en_espera", "completado"];
const NEW_CLIENT_VALUE = "__new_client__";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("list");
  const [filters, setFilters] = useState({query: "", estado: "todos", prioridad: "todas", responsableUid: "todos"});
  const [formOpen, setFormOpen] = useState(false);
  const [editingWork, setEditingWork] = useState(null);
  const [draft, setDraft] = useState({...EMPTY_WORK});
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [selectedWork, setSelectedWork] = useState(null);
  const [detail, setDetail] = useState({tareas: [], notas: [], historial: [], vinculos: [], cotizaciones: [], ventas: [], gastos: [], horasHombre: [], materiales: [], balance: null});
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [processing, setProcessing] = useState("");
  const [cancelWork, setCancelWork] = useState(null);
  const [pendingState, setPendingState] = useState(null);
  const [waitReason, setWaitReason] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError("");
    try {
      const access = {role, currentUserUid};
      const [workList, clientList, memberList, inventoryList, quoteList, saleList] = await Promise.all([listarTrabajos(businessId, access), canManage ? listarClientes(businessId) : Promise.resolve([]), canManage ? listarMiembrosNegocio(businessId) : Promise.resolve([]), getInventoryItems(businessId), canManage ? getQuotes(businessId) : Promise.resolve([]), canManage ? listarVentas(businessId) : Promise.resolve([])]);
      setWorks(workList); setClients(clientList.filter((client) => client.estado === "activo")); setMembers(memberList.filter((member) => member.estado === "activo")); setInventoryProducts(inventoryList.filter((item) => item.estado === "activo" && item.tipoItem === "producto")); setQuotes(quoteList); setSales(saleList);
    } catch (loadError) {
      setError(loadError.message || "No se pudo cargar Proyectos y trabajos.");
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
    setDetailLoading(true);
    try {
      const [file, balance] = await Promise.all([
        cargarFichaTrabajo(businessId, workId, {role, currentUserUid}),
        canViewWorkProfitability(role) ? obtenerBalanceTrabajo(businessId, workId) : Promise.resolve(null),
      ]);
      setDetail({...file, balance});
    }
    catch (detailError) { setError(detailError.message || "No se pudo cargar la ficha del trabajo."); }
    finally { setDetailLoading(false); }
  }, [businessId, currentUserUid, role]);

  useEffect(() => {
    const requestedWorkId = String(location.state?.openWorkId || "");
    if (!requestedWorkId || loading) return;
    const requestedWork = works.find((work) => work.id === requestedWorkId);
    navigate("/trabajos", {replace: true, state: {}});
    if (requestedWork) {
      setSelectedWork(requestedWork);
      setNoteText("");
      loadDetail(requestedWork.id);
    }
  }, [loadDetail, loading, location.state, navigate, works]);

  const openDetail = (work) => { setSelectedWork(work); setNoteText(""); loadDetail(work.id); };
  const refreshWork = async (workId) => {
    const [list, inventoryList] = await Promise.all([listarTrabajos(businessId, {role, currentUserUid}), getInventoryItems(businessId)]); setWorks(list); setInventoryProducts(inventoryList.filter((item) => item.estado === "activo" && item.tipoItem === "producto"));
    const current = list.find((work) => work.id === workId);
    if (current) setSelectedWork(current);
    await loadDetail(workId);
  };

  const visibleWorks = useMemo(() => works.filter((work) => matchesWorkFilters(work, filters)), [filters, works]);
  const quoteOptions = useMemo(() => {
    const eligible = getEligibleWorkQuoteOptions(quotes, sales, {workId: editingWork?.id});
    if (!draft.cotizacionId || eligible.some(({quote}) => quote.id === draft.cotizacionId)) return eligible;
    const selectedQuote = quotes.find((quote) => quote.id === draft.cotizacionId);
    const selectedSale = sales.find((sale) => sale.id === selectedQuote?.ventaId);
    return selectedQuote ? [{quote: selectedQuote, sale: selectedSale}, ...eligible] : eligible;
  }, [draft.cotizacionId, editingWork?.id, quotes, sales]);
  const commercialLinkLocked = Boolean(editingWork && (editingWork.cotizacionId || editingWork.cotizacionesVinculadas || editingWork.ventasVinculadas));
  const hasAdditionalMembers = hasAdditionalWorkMembers(members, currentUserUid);
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
    setFormOpen(true);
  };
  const openEdit = (work) => { if (isWorkOperationalReadOnly(work)) return; setSelectedWork(null); setEditingWork(work); setDraft({titulo: work.titulo, descripcion: work.descripcion, clienteId: work.clienteId, cotizacionId: work.cotizacionId, responsableUid: work.responsableUid, participanteUids: work.participanteUids, estado: work.estado, prioridad: work.prioridad, fechaInicio: work.fechaInicio, fechaPrevista: work.fechaPrevista}); setFieldErrors({}); setFormOpen(true); };
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
    event.preventDefault(); const payload = editingWork ? draft : buildQuickWorkCreationPayload(draft); const errors = getWorkDraftErrors(payload); setFieldErrors(errors); if (Object.keys(errors).length) return;
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

  const runDetailAction = async (key, action) => {
    if (!selectedWork) return false; setProcessing(key); setError("");
    try { await action(); await refreshWork(selectedWork.id); return true; }
    catch (actionError) { setError(actionError.message || "No se pudo actualizar el trabajo."); return false; }
    finally { setProcessing(""); }
  };

  const addNote = (event) => { event.preventDefault(); const value = noteText.trim(); if (!value) return; runDetailAction("note-new", () => agregarNotaTrabajo(businessId, selectedWork.id, value)).then((success) => {if (success) setNoteText("");}); };
  const terminal = ["completado", "cancelado"].includes(selectedWork?.estado);
  const completed = selectedWork?.estado === "completado";
  const operationalReadOnly = isWorkOperationalReadOnly(selectedWork);
  const saleMaterials = useMemo(() => getWorkSaleMaterials(detail.ventas), [detail.ventas]);
  const projectCost = useMemo(() => getWorkCostSummary({expenses: detail.gastos, labor: detail.horasHombre, materials: detail.materiales, saleMaterials}), [detail.gastos, detail.horasHombre, detail.materiales, saleMaterials]);
  const dailyCosts = useMemo(() => buildWorkDailyCostSummary({expenses: detail.gastos, labor: detail.horasHombre, materials: detail.materiales, saleMaterials, events: detail.historial}), [detail.gastos, detail.historial, detail.horasHombre, detail.materiales, saleMaterials]);
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
    <header className="erp-page-header"><div className="erp-page-header__content"><h1 className="erp-page-header__title">Proyectos y trabajos</h1><p className="erp-page-header__description">Organiza y da seguimiento al trabajo operativo del negocio.</p></div>{canManage && <Button type="button" icon={Plus} onClick={openNew}>Nuevo trabajo</Button>}</header>
    {error && <div className="works-message works-message--error" role="alert">{error}</div>}
    <section className="erp-panel works-panel" aria-label="Trabajos registrados">
      <div className="works-toolbar"><div className="works-view-switch" role="group" aria-label="Vista"><button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}><AppIcon icon={LayoutList} size={17} />Lista</button><button type="button" className={view === "board" ? "is-active" : ""} onClick={() => setView("board")}><AppIcon icon={Columns3} size={17} />Tablero</button></div><span>{visibleWorks.length} trabajo{visibleWorks.length === 1 ? "" : "s"}</span></div>
      <div className="erp-filters works-filters"><label className="erp-field works-search"><span className="erp-field__label">Buscar por número, título o cliente</span><span className="works-search-control"><AppIcon icon={Search} size={18} /><input className="erp-control" value={filters.query} onChange={(event) => setFilters((current) => ({...current, query: event.target.value}))} /></span></label><Filter label="Estado" value={filters.estado} onChange={(value) => setFilters((current) => ({...current, estado: value}))}><option value="todos">Todos</option>{WORK_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Filter><Filter label="Prioridad" value={filters.prioridad} onChange={(value) => setFilters((current) => ({...current, prioridad: value}))}><option value="todas">Todas</option>{WORK_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Filter><Filter label="Responsable principal" value={filters.responsableUid} onChange={(value) => setFilters((current) => ({...current, responsableUid: value}))}><option value="todos">Todos</option>{members.map((member) => <option key={member.uid} value={member.uid}>{getWorkMemberIdentity(member)}</option>)}</Filter></div>
      {loading ? <div className="erp-empty-state">Cargando trabajos...</div> : view === "board" ? <WorkBoard works={visibleWorks} onOpen={openDetail} /> : <WorkList works={visibleWorks} canManage={canManage} onEdit={openEdit} onOpen={openDetail} />}
    </section>

    <ResponsiveDialog className="works-form-dialog" open={formOpen} onClose={() => !saving && setFormOpen(false)} size="large" eyebrow="Proyectos y trabajos" title={editingWork ? `Editar ${editingWork.numero}` : "Crear proyecto"} description="Registra la información y planificación inicial del proyecto." footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" form="work-form" disabled={saving}>{saving ? "Guardando..." : editingWork ? "Guardar cambios" : "Crear proyecto"}</Button></>}>
      <form id="work-form" className="works-form" onSubmit={save}>
        <FormSection title="Información">
          <div className="works-form-grid">
            <Field className="works-field--wide" label="Nombre" required error={fieldErrors.titulo}><input autoFocus className="erp-control" maxLength="180" placeholder="Escribe un nombre breve para identificar el proyecto" value={draft.titulo} onChange={(event) => updateDraft("titulo", event.target.value)} /></Field>
            <Field className="works-field--wide" label="Cotización asociada" optional error={fieldErrors.cotizacionId}><WorkQuoteSelector currencyCode={currencyCode} disabled={commercialLinkLocked} loading={loading} onChange={selectQuote} options={quoteOptions} value={draft.cotizacionId} /></Field>
            <Field className="works-field--wide" label="Cliente" optional><select className="erp-control" disabled={Boolean(draft.cotizacionId)} value={draft.clienteId} onChange={selectClient}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.clienteId} value={client.clienteId}>{client.nombreRazonSocial} · {client.rut}</option>)}{!draft.cotizacionId && <option value={NEW_CLIENT_VALUE}>+ Nuevo cliente</option>}</select></Field>
            <Field className="works-field--wide" label="Descripción" optional error={fieldErrors.descripcion}><textarea className="erp-control" rows="2" maxLength="5000" placeholder="Describe el requerimiento o lo informado por el cliente" value={draft.descripcion} onChange={(event) => updateDraft("descripcion", event.target.value)} /></Field>
          </div>
        </FormSection>
        <FormSection title="Planificación">
          <div className="works-form-grid">
            <Field label="Responsable" optional><select className="erp-control" value={draft.responsableUid} onChange={selectPrincipal}><option value="">Sin responsable</option>{members.map((member) => <option key={member.uid} value={member.uid}>{editingWork ? getWorkMemberIdentity(member) : getWorkMemberOptionLabel(member, currentUserUid)}</option>)}</select></Field>
            <Field label="Prioridad" required error={fieldErrors.prioridad}><select className="erp-control" value={draft.prioridad} onChange={(event) => updateDraft("prioridad", event.target.value)}>{WORK_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
            <Field label="Inicio planificado" optional error={fieldErrors.fechaInicio}><input className="erp-control" type="date" value={draft.fechaInicio} onChange={(event) => updateDraft("fechaInicio", event.target.value)} /></Field>
            <Field label="Término planificado" optional error={fieldErrors.fechaPrevista}><input className="erp-control" type="date" value={draft.fechaPrevista} onChange={(event) => updateDraft("fechaPrevista", event.target.value)} /></Field>
            {(editingWork || hasAdditionalMembers) && <fieldset className="works-participants works-field--wide"><legend>Equipo de trabajo</legend><div>{members.filter((member) => member.uid !== draft.responsableUid).map((member) => <label key={member.uid}><input type="checkbox" checked={draft.participanteUids.includes(member.uid)} onChange={(event) => updateDraft("participanteUids", event.target.checked ? [...draft.participanteUids, member.uid] : draft.participanteUids.filter((uid) => uid !== member.uid))} />{getWorkMemberIdentity(member)}</label>)}{!members.length && <span>No hay miembros activos disponibles.</span>}</div></fieldset>}
          </div>
        </FormSection>
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
                {!operationalReadOnly && <Button type="button" variant="ghost-danger" onClick={() => setCancelWork(selectedWork)}>Cancelar trabajo</Button>}
              </>}
            </div>
            <WorkSummary work={selectedWork} cost={projectCost.total} members={members} />
            {selectedWork.estado === "en_espera" && selectedWork.motivoEspera && <p className="works-wait-reason">En espera: {selectedWork.motivoEspera}</p>}
            {getWorkOperationalIndicators(selectedWork).noRecentActivity && <p className="works-message works-message--warning">Sin actividad reciente (3 días o más).</p>}
          </div>

          <section className="works-detail-section works-overview">
            <h3>Resumen</h3>
            <div className="works-overview-description">
              <h4>Descripción</h4>
              <p>{selectedWork.descripcion || "Sin descripción registrada."}</p>
            </div>
            <dl className="works-overview-meta">
              <div><dt>Equipo adicional</dt><dd>{selectedWork.participantesSnapshot?.map((person) => workPersonIdentity(person, person.uid, members, "Integrante sin identificar")).join(", ") || "Sin integrantes"}</dd></div>
              <div><dt>Inicio planificado</dt><dd>{dateLabel(selectedWork.fechaInicio)}</dd></div>
              <div><dt>Término planificado</dt><dd>{dateLabel(selectedWork.fechaPrevista)}</dd></div>
              {completed && selectedWork.fechaCompletado && <div><dt>Completado el</dt><dd>{dateLabel(selectedWork.fechaCompletado, true)}</dd></div>}
            </dl>
            <CommercialFile canManage={canManage} detail={detail} loading={detailLoading} navigate={navigate} />
          </section>

          <TaskSection key={selectedWork.id} businessId={businessId} canManage={canManage} costs={{expenses: detail.gastos, labor: detail.horasHombre, materials: detail.materiales}} currency={selectedWork.moneda || currencyCode || "CLP"} currentUserUid={currentUserUid} loading={detailLoading} members={members} processing={processing} role={role} runAction={runDetailAction} tasks={detail.tareas} terminal={terminal} workId={selectedWork.id} />

          <section className="works-costs-focus">
            <div className="works-section-heading"><div><h3>Costos</h3><span>Materiales, HH, gastos y resumen diario</span></div><strong>{formatMoney(projectCost.total, selectedWork.moneda || currencyCode || "CLP")}</strong></div>
            <div className="works-resources">
              <MaterialsSection key={`materials-${selectedWork.id}`} businessId={businessId} canManage={canManage} currency={selectedWork.moneda || currencyCode || "CLP"} currentUserUid={currentUserUid} hasAssociatedSale={detail.ventas.some((sale) => sale.estado === "confirmada")} loading={detailLoading} movements={detail.materiales} processing={processing} products={inventoryProducts} readOnly={operationalReadOnly} role={role} runAction={runDetailAction} saleMaterials={saleMaterials} tasks={detail.tareas} workId={selectedWork.id} />
              <FinancialSection key={`costs-${selectedWork.id}`} businessId={businessId} canManage={canManage} currency={selectedWork.moneda || currencyCode || "CLP"} currentUserUid={currentUserUid} expenses={detail.gastos} labor={detail.horasHombre} loading={detailLoading} members={members} processing={processing} readOnly={operationalReadOnly} role={role} runAction={runDetailAction} tasks={detail.tareas} workId={selectedWork.id} />
              <DailyCostSummary currency={selectedWork.moneda || currencyCode || "CLP"} rows={dailyCosts} />
              {canViewWorkProfitability(role) && <WorkBalanceSection balance={detail.balance} loading={detailLoading} />}
            </div>
          </section>

          <DetailDisclosure key={`notes-${selectedWork.id}`} title="Notas del proyecto" summary={`${detail.notas.length} nota${detail.notas.length === 1 ? "" : "s"}`}>
            <section className="works-notes-section">
              {canManage && !operationalReadOnly && <form className="works-note-form" onSubmit={addNote}><textarea className="erp-control" rows="2" maxLength="4000" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Agrega una actualización o antecedente relevante." /><Button type="submit" disabled={processing === "note-new"}>Agregar nota</Button></form>}
              <div className="works-notes">{detail.notas.map((note) => <article key={note.id}><header><strong>{workPersonIdentity(note.autorSnapshot, note.autorUid, members, "Persona del equipo")}</strong><time>{dateLabel(note.creadoEn, true)}</time></header><p>{note.texto}</p></article>)}{!detail.notas.length && <p className="works-empty-copy">Aún no hay notas.</p>}</div>
            </section>
          </DetailDisclosure>

          <DetailDisclosure key={`history-${selectedWork.id}`} title="Historial del trabajo" summary={`${detail.historial.length} evento${detail.historial.length === 1 ? "" : "s"}`}>
            {detailLoading ? <p className="works-empty-copy">Cargando historial...</p> : <ol className="works-timeline">{detail.historial.map((event) => <li key={event.id}><time>{dateLabel(event.fecha, true)}</time><p>{humanizeWorkEvent({...event, actorSnapshot: {...event.actorSnapshot, nombre: workPersonIdentity(event.actorSnapshot, "", members, "Una persona del equipo")}}, {includeAmounts: canManage})}</p>{event.tipo === "nota_agregada" && event.detalle?.texto && <blockquote>{event.detalle.texto}</blockquote>}</li>)}</ol>}
          </DetailDisclosure>
        </div>}
      </>
    </ResponsiveDialog>

    <ResponsiveDialog open={Boolean(cancelWork) && !isWorkOperationalReadOnly(cancelWork)} onClose={() => !processing && setCancelWork(null)} size="small" eyebrow="Proyectos y trabajos" title="Cancelar trabajo" description="El registro y su historial se conservarán." footer={<><Button type="button" variant="secondary" disabled={Boolean(processing)} onClick={() => setCancelWork(null)}>Volver</Button><Button type="button" variant="danger" disabled={Boolean(processing)} onClick={() => runDetailAction("cancel", () => cambiarEstadoTrabajo(businessId, cancelWork.id, "cancelado")).then(() => setCancelWork(null))}>{processing ? "Cancelando..." : "Cancelar trabajo"}</Button></>}><p>¿Confirmas que deseas cancelar {cancelWork?.numero}?</p></ResponsiveDialog>
    <ResponsiveDialog open={Boolean(pendingState)} onClose={() => !processing && setPendingState(null)} size="small" eyebrow="Proyectos y trabajos" title={pendingState?.estado === "en_espera" ? "Poner proyecto en espera" : "Completar con pendientes"} description={pendingState?.estado === "en_espera" ? "El motivo quedará registrado en el historial." : "El progreso real y las tareas pendientes se conservarán."} footer={<><Button type="button" variant="secondary" disabled={Boolean(processing)} onClick={() => setPendingState(null)}>Volver</Button><Button type="button" disabled={Boolean(processing) || (pendingState?.estado === "en_espera" && !waitReason.trim())} onClick={() => runDetailAction("state-confirm", () => cambiarEstadoTrabajo(businessId, pendingState.work.id, pendingState.estado, waitReason.trim())).then((success) => {if (success) { setPendingState(null); setWaitReason(""); }})}>{pendingState?.estado === "en_espera" ? "Confirmar espera" : "Completar igualmente"}</Button></>}>
      {pendingState?.estado === "en_espera" ? <Field label="Motivo de espera" required><textarea className="erp-control" rows="3" maxLength="1000" value={waitReason} onChange={(event) => setWaitReason(event.target.value)} placeholder="Ej.: esperando aprobación del cliente" /></Field> : <p>Hay tareas o subtareas pendientes. Esta acción no las completará automáticamente.</p>}
    </ResponsiveDialog>
  </main>;
}

function commercialStatusLabel(value) {
  return String(value || "borrador").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function TaskSection({businessId, canManage, costs, currency, currentUserUid, loading, members, processing, role, runAction, tasks, terminal, workId}) {
  const [draft, setDraft] = useState({titulo: "", descripcion: "", responsableUid: ""});
  const [documentation, setDocumentation] = useState({});
  const [subtaskDrafts, setSubtaskDrafts] = useState({});
  const [subtaskTitles, setSubtaskTitles] = useState({});
  const [waitingTask, setWaitingTask] = useState(null);
  const [waitReason, setWaitReason] = useState("");
  const [taskView, setTaskView] = useState("list");
  const visibleTasks = getVisibleWorkTasks(tasks, {canManage, currentUserUid});
  const createTask = (event) => {
    event.preventDefault();
    if (!draft.titulo.trim()) return;
    runAction("task-new", () => agregarTareaTrabajo(businessId, workId, draft, createWorkTaskRequestId("task-create"))).then((success) => {
      if (success) setDraft({titulo: "", descripcion: "", responsableUid: ""});
    });
  };
  const canOperate = (task) => canOperateWorkTask(task, {canManage, role, currentUserUid});
  const assign = (task, responsableUid) => runAction(`task-assign-${task.id}`, () => asignarTareaTrabajo(businessId, workId, task.id, responsableUid, createWorkTaskRequestId("task-assign")));
  const changeState = (task, estado, motivoEspera = "") => runAction(`task-state-${task.id}`, () => cambiarEstadoTareaTrabajo(businessId, workId, task.id, estado, {motivoEspera, requestId: createWorkTaskRequestId(`task-${estado}`)}));
  const requestTaskState = (task, estado) => {
    if (estado === "en_espera") { setWaitingTask(task); setWaitReason(""); return; }
    changeState(task, estado);
  };
  const addSubtask = (event, task) => {
    event.preventDefault(); const titulo = String(subtaskDrafts[task.id] || "").trim(); if (!titulo) return;
    runAction(`subtask-new-${task.id}`, () => agregarSubtareaTrabajo(businessId, workId, task.id, titulo, createWorkTaskRequestId("subtask-create"))).then((success) => {if (success) setSubtaskDrafts((current) => ({...current, [task.id]: ""}));});
  };
  const toggleSubtask = (task, subtask) => runAction(`subtask-toggle-${subtask.id}`, () => actualizarSubtareaTrabajo(businessId, workId, task.id, subtask.id, {completada: !subtask.completada}, createWorkTaskRequestId("subtask-toggle")));
  const renameSubtask = (task, subtask) => {
    const titulo = String(subtaskTitles[subtask.id] ?? subtask.titulo).trim(); if (!titulo || titulo === subtask.titulo) return;
    runAction(`subtask-title-${subtask.id}`, () => actualizarSubtareaTrabajo(businessId, workId, task.id, subtask.id, {titulo}, createWorkTaskRequestId("subtask-title"))).then((success) => {if (success) setSubtaskTitles((current) => ({...current, [subtask.id]: titulo}));});
  };
  const removeSubtask = (task, subtask) => runAction(`subtask-delete-${subtask.id}`, () => eliminarSubtareaTrabajo(businessId, workId, task.id, subtask.id, createWorkTaskRequestId("subtask-delete")));
  const addDocumentation = (event, task) => {
    event.preventDefault();
    const value = String(documentation[task.id] || "").trim();
    if (!value) return;
    runAction(`task-document-${task.id}`, () => documentarTareaTrabajo(businessId, workId, task.id, value, createWorkTaskRequestId("task-document"))).then((success) => {
      if (success) setDocumentation((current) => ({...current, [task.id]: ""}));
    });
  };
  const removeLegacy = (task) => runAction(`task-delete-${task.id}`, () => eliminarTareaTrabajo(businessId, workId, task.id, createWorkTaskRequestId("task-delete")));

  const emptyTasksCopy = canManage ? "Aún no hay tareas." : "No tienes tareas asignadas.";

  return <section className="works-detail-section">
    <div className="works-section-heading"><div><h3>Tareas</h3><span>{tasks.filter((task) => task.completada).length} / {tasks.length} completadas</span></div><div className="works-view-switch" role="group" aria-label="Vista de tareas"><button type="button" className={taskView === "list" ? "is-active" : ""} onClick={() => setTaskView("list")}><AppIcon icon={LayoutList} size={15} />Lista</button><button type="button" className={taskView === "board" ? "is-active" : ""} onClick={() => setTaskView("board")}><AppIcon icon={Columns3} size={15} />Tablero</button></div></div>
    {canManage && !terminal && <form className="works-task-create" onSubmit={createTask}>
      <input className="erp-control" maxLength="240" value={draft.titulo} onChange={(event) => setDraft((current) => ({...current, titulo: event.target.value}))} placeholder="Título de la tarea" required />
      <textarea className="erp-control" maxLength="4000" rows="2" value={draft.descripcion} onChange={(event) => setDraft((current) => ({...current, descripcion: event.target.value}))} placeholder="Descripción operativa" />
      <select className="erp-control" value={draft.responsableUid} onChange={(event) => setDraft((current) => ({...current, responsableUid: event.target.value}))}><option value="">Sin responsable</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.nombre}</option>)}</select>
      <Button type="submit" icon={Plus} disabled={processing === "task-new"}>Crear tarea</Button>
    </form>}
    {loading ? <p>Cargando tareas...</p> : taskView === "board" ? <WorkTaskBoard canManage={canManage} canOperate={canOperate} costs={costs} currency={currency} emptyCopy={emptyTasksCopy} onRemoveLegacy={removeLegacy} onRequestTaskState={requestTaskState} processing={processing} tasks={visibleTasks} terminal={terminal} /> : <div className="works-task-list works-task-list--v2">
      {visibleTasks.map((task) => { const progress = getTaskProgress(task); const taskCost = getWorkCostSummary({...costs, taskId: task.id}); return <article key={task.id} className={task.completada ? "is-complete" : ""}>
        <header><div><strong>{task.titulo}</strong><span className={`works-task-state works-task-state--${task.estado}`}>{WORK_TASK_STATUSES.find((entry) => entry.value === task.estado)?.label || "Pendiente"}</span></div>{canManage && !terminal && <select aria-label={`Responsable de ${task.titulo}`} className="erp-control" disabled={Boolean(processing)} value={task.responsableUid} onChange={(event) => assign(task, event.target.value)}><option value="">Sin responsable</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.nombre}</option>)}</select>}</header>
        {task.descripcion && <p>{task.descripcion}</p>}
        <div className="works-task-metrics"><span>Progreso <strong>{progress.percent}%</strong>{progress.total > 0 && ` · ${progress.completed}/${progress.total} subtareas`}</span><span>Costo asignado a esta tarea <strong>{formatMoney(taskCost.total, currency)}</strong></span></div>
        {task.estado === "en_espera" && task.motivoEspera && <p className="works-wait-reason">En espera: {task.motivoEspera}</p>}
        <div className="works-subtask-list">{task.subtareas.map((subtask) => <div key={subtask.id} className={subtask.completada ? "is-complete" : ""}><input type="checkbox" checked={subtask.completada} disabled={terminal || !canOperate(task) || Boolean(processing)} onChange={() => toggleSubtask(task, subtask)} /><input className="erp-control" maxLength="240" disabled={terminal || !canManage || subtask.completada} value={subtaskTitles[subtask.id] ?? subtask.titulo} onChange={(event) => setSubtaskTitles((current) => ({...current, [subtask.id]: event.target.value}))} /><div>{canManage && !terminal && !subtask.completada && <><Button type="button" variant="secondary" disabled={Boolean(processing) || (subtaskTitles[subtask.id] ?? subtask.titulo).trim() === subtask.titulo} onClick={() => renameSubtask(task, subtask)}>Guardar</Button><button type="button" aria-label={`Eliminar ${subtask.titulo}`} onClick={() => removeSubtask(task, subtask)}><AppIcon icon={Trash2} size={15} /></button></>}</div></div>)}</div>
        {canOperate(task) && !terminal && !task.completada && <form className="works-subtask-create" onSubmit={(event) => addSubtask(event, task)}><input className="erp-control" maxLength="240" required value={subtaskDrafts[task.id] || ""} onChange={(event) => setSubtaskDrafts((current) => ({...current, [task.id]: event.target.value}))} placeholder="Nueva subtarea" /><Button type="submit" variant="secondary" disabled={Boolean(processing)}>Agregar</Button></form>}
        {!terminal && canOperate(task) && (!task.completada || canManage) && <div className="works-task-actions"><select className="erp-control" value={task.estado} disabled={Boolean(processing)} onChange={(event) => requestTaskState(task, event.target.value)}>{getWorkTaskStatusOptions(task, {canManage}).map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select>{canManage && task.modeloTareaVersion < 2 && !task.completada && <button type="button" aria-label={`Eliminar ${task.titulo}`} onClick={() => removeLegacy(task)}><AppIcon icon={Trash2} size={16} />Eliminar</button>}</div>}
        <details className="works-task-documentation"><summary>Documentación ({task.documentacion.length})</summary>{task.documentacion.map((entry) => <div key={entry.id}><p>{entry.texto}</p><small>{workPersonIdentity(entry.autorSnapshot, entry.autorUid, members, "Persona del equipo")} · {dateLabel(entry.creadoEn, true)}{entry.tipo === "cierre" ? " · Cierre" : ""}</small></div>)}{!terminal && canOperate(task) && <form className="works-task-document-form" onSubmit={(event) => addDocumentation(event, task)}><textarea className="erp-control" maxLength="8000" rows="2" value={documentation[task.id] || ""} onChange={(event) => setDocumentation((current) => ({...current, [task.id]: event.target.value}))} placeholder="Comentario o evidencia" /><Button type="submit" variant="secondary" disabled={Boolean(processing)}>Agregar</Button></form>}</details>
      </article>;})}
      {!visibleTasks.length && <p className="works-empty-copy">{emptyTasksCopy}</p>}
    </div>}
    <ResponsiveDialog open={Boolean(waitingTask)} onClose={() => !processing && setWaitingTask(null)} size="small" eyebrow="Tarea" title="Poner tarea en espera" description="El motivo quedará en el historial." footer={<><Button type="button" variant="secondary" onClick={() => setWaitingTask(null)}>Volver</Button><Button type="button" disabled={Boolean(processing) || !waitReason.trim()} onClick={() => changeState(waitingTask, "en_espera", waitReason.trim()).then((success) => {if (success) {setWaitingTask(null); setWaitReason("");}})}>Confirmar espera</Button></>}><Field label="Motivo" required><textarea className="erp-control" rows="3" maxLength="1000" value={waitReason} onChange={(event) => setWaitReason(event.target.value)} /></Field></ResponsiveDialog>
  </section>;
}

function chileToday() {
  const parts = new Intl.DateTimeFormat("en", {timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function FinancialSection({businessId, canManage, currency, currentUserUid, expenses, labor, loading, members, processing, readOnly, role, runAction, tasks, workId}) {
  const [expenseDraft, setExpenseDraft] = useState({concepto: "", monto: "", categoria: "MATERIAL", responsableDelGastoUid: "", fecha: chileToday(), observacion: "", tareaId: ""});
  const [laborDraft, setLaborDraft] = useState({tecnicoUid: "", horas: "", costoHora: "", fecha: chileToday(), concepto: "", tareaId: ""});
  const [annulReasons, setAnnulReasons] = useState({});
  const canRegister = canManage || ["TECNICO", "MEMBER"].includes(role);
  const visibleExpenses = canManage ? expenses : expenses.filter((entry) => [entry.registradoPorUid, entry.responsableDelGastoUid].includes(currentUserUid));
  const visibleLabor = canManage ? labor : labor.filter((entry) => [entry.registradoPorUid, entry.tecnicoUid].includes(currentUserUid));
  const activeExpenses = visibleExpenses.filter((entry) => entry.estado !== "anulado");
  const activeLabor = visibleLabor.filter((entry) => entry.estado !== "anulado");
  const expenseTotal = activeExpenses.reduce((sum, entry) => sum + entry.monto, 0);
  const directExpenseTotal = activeExpenses.filter((entry) => entry.clasificacionCosto === "DIRECTO").reduce((sum, entry) => sum + entry.monto, 0);
  const indirectExpenseTotal = activeExpenses.filter((entry) => entry.clasificacionCosto === "INDIRECTO").reduce((sum, entry) => sum + entry.monto, 0);
  const laborHours = activeLabor.reduce((sum, entry) => sum + entry.horas, 0);
  const laborTotal = activeLabor.reduce((sum, entry) => sum + entry.total, 0);
  const saveExpense = (event) => {
    event.preventDefault();
    const payload = {...expenseDraft, responsableDelGastoUid: canManage ? expenseDraft.responsableDelGastoUid : currentUserUid};
    runAction("expense-new", () => registrarGastoTrabajo(businessId, workId, payload, createWorkCostRequestId("expense-create"))).then((success) => {
      if (success) setExpenseDraft({concepto: "", monto: "", categoria: "MATERIAL", responsableDelGastoUid: "", fecha: chileToday(), observacion: "", tareaId: ""});
    });
  };
  const saveLabor = (event) => {
    event.preventDefault();
    const payload = {...laborDraft, tecnicoUid: canManage ? laborDraft.tecnicoUid : currentUserUid};
    runAction("labor-new", () => registrarHorasHombreTrabajo(businessId, workId, payload, createWorkCostRequestId("labor-create"))).then((success) => {
      if (success) setLaborDraft({tecnicoUid: "", horas: "", costoHora: "", fecha: chileToday(), concepto: "", tareaId: ""});
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

  return <section className="works-detail-section works-financial-file">
    <div className="works-section-heading"><div><h3>Costos reales</h3><span>Moneda {currency}</span></div></div>
    <p className="works-financial-note">{readOnly ? "Los costos históricos permanecen visibles. Reabre el proyecto para registrar o corregir operaciones." : "Los registros no se editan ni eliminan: para corregir, anula el original y crea el reemplazo."}</p>
    <div className="works-financial-columns">
      <section><header><div><h4>Gastos</h4><strong>{formatMoney(expenseTotal, currency)}</strong></div><small>Directos e indirectos, sin balance final.</small></header>
        {activeExpenses.length > 0 && <dl className="works-cost-subtotals"><div><dt><strong>Costos directos</strong></dt><dd>{formatMoney(directExpenseTotal, currency)}</dd></div><div><dt><strong>Costos indirectos</strong></dt><dd>{formatMoney(indirectExpenseTotal, currency)}</dd></div>{WORK_EXPENSE_CATEGORIES.map((category) => <div key={category.value}><dt>{category.label}</dt><dd>{formatMoney(activeExpenses.filter((entry) => entry.categoria === category.value).reduce((sum, entry) => sum + entry.monto, 0), currency)}</dd></div>)}</dl>}
        {canRegister && !readOnly && <form className="works-cost-form" onSubmit={saveExpense}>
          <input className="erp-control" maxLength="240" required value={expenseDraft.concepto} onChange={(event) => setExpenseDraft((current) => ({...current, concepto: event.target.value}))} placeholder="Concepto del gasto" />
          <input className="erp-control" type="number" min="0.01" max="999999999999.99" step="0.01" required value={expenseDraft.monto} onChange={(event) => setExpenseDraft((current) => ({...current, monto: event.target.value}))} placeholder="Monto" />
          <select className="erp-control" value={expenseDraft.categoria} onChange={(event) => setExpenseDraft((current) => ({...current, categoria: event.target.value}))}>{WORK_EXPENSE_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}{category.classification === "INDIRECTO" ? " · indirecto" : " · directo"}</option>)}</select>
          <TaskCostSelect tasks={tasks} value={expenseDraft.tareaId} onChange={(tareaId) => setExpenseDraft((current) => ({...current, tareaId}))} />
          {canManage && <select className="erp-control" value={expenseDraft.responsableDelGastoUid} onChange={(event) => setExpenseDraft((current) => ({...current, responsableDelGastoUid: event.target.value}))}><option value="">Sin responsable específico</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.nombre}</option>)}</select>}
          <input className="erp-control" type="date" required value={expenseDraft.fecha} onChange={(event) => setExpenseDraft((current) => ({...current, fecha: event.target.value}))} />
          <textarea className="erp-control" maxLength="4000" rows="2" value={expenseDraft.observacion} onChange={(event) => setExpenseDraft((current) => ({...current, observacion: event.target.value}))} placeholder="Observación" />
          <Button type="submit" disabled={Boolean(processing)}>Registrar gasto</Button>
        </form>}
        {loading ? <p>Cargando gastos...</p> : <div className="works-cost-list">{visibleExpenses.map((entry) => { const key = `expense-${entry.id}`; return <article key={entry.id} className={entry.estado === "anulado" ? "is-annulled" : ""}><div><strong>{entry.concepto}</strong><span>{formatMoney(entry.monto, entry.moneda || currency)} · {WORK_EXPENSE_CATEGORIES.find((item) => item.value === entry.categoria)?.label || entry.categoria} · {entry.clasificacionCosto === "INDIRECTO" ? "Indirecto" : "Directo"}</span><small>{dateLabel(entry.fecha)} · {entry.responsableDelGastoSnapshot?.nombre || entry.responsableDelGastoSnapshot?.correo || entry.registradoPorSnapshot?.nombre || entry.registradoPorSnapshot?.correo || "Equipo"} · {taskLabel(tasks, entry.tareaId)}</small>{entry.observacion && <p>{entry.observacion}</p>}{entry.estado === "anulado" && <small>Anulado: {entry.motivoAnulacion}</small>}</div>{canManage && !readOnly && entry.estado !== "anulado" && <form className="works-annul-form" onSubmit={(event) => annul(event, "expense", entry.id)}><input className="erp-control" maxLength="1000" required value={annulReasons[key] || ""} onChange={(event) => setAnnulReasons((current) => ({...current, [key]: event.target.value}))} placeholder="Motivo de anulación" /><Button type="submit" variant="ghost-danger" disabled={Boolean(processing)}>Anular</Button></form>}</article>;})}{!visibleExpenses.length && <p className="works-empty-copy">Aún no se han registrado gastos.</p>}</div>}
      </section>
      <section><header><div><h4>Horas hombre</h4><strong>{laborHours} HH · {formatMoney(laborTotal, currency)}</strong></div><small>El total se calcula en backend.</small></header>
        {canRegister && !readOnly && <form className="works-cost-form" onSubmit={saveLabor}>
          <input className="erp-control" maxLength="240" required value={laborDraft.concepto} onChange={(event) => setLaborDraft((current) => ({...current, concepto: event.target.value}))} placeholder="Concepto o actividad" />
          {canManage && <select className="erp-control" required value={laborDraft.tecnicoUid} onChange={(event) => setLaborDraft((current) => ({...current, tecnicoUid: event.target.value}))}><option value="">Selecciona técnico</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.nombre}</option>)}</select>}
          <TaskCostSelect tasks={tasks} value={laborDraft.tareaId} onChange={(tareaId) => setLaborDraft((current) => ({...current, tareaId}))} />
          <input className="erp-control" type="number" min="0.01" max="1000" step="0.01" required value={laborDraft.horas} onChange={(event) => setLaborDraft((current) => ({...current, horas: event.target.value}))} placeholder="Horas" />
          <input className="erp-control" type="number" min="0.01" max="999999999999.99" step="0.01" required value={laborDraft.costoHora} onChange={(event) => setLaborDraft((current) => ({...current, costoHora: event.target.value}))} placeholder="Costo por hora" />
          <input className="erp-control" type="date" required value={laborDraft.fecha} onChange={(event) => setLaborDraft((current) => ({...current, fecha: event.target.value}))} />
          <Button type="submit" disabled={Boolean(processing)}>Registrar HH</Button>
        </form>}
        {loading ? <p>Cargando HH...</p> : <div className="works-cost-list">{visibleLabor.map((entry) => { const key = `labor-${entry.id}`; return <article key={entry.id} className={entry.estado === "anulado" ? "is-annulled" : ""}><div><strong>{entry.concepto}</strong><span>{entry.horas} HH × {formatMoney(entry.costoHora, entry.moneda || currency)} = {formatMoney(entry.total, entry.moneda || currency)}</span><small>{dateLabel(entry.fecha)} · {entry.tecnicoSnapshot?.nombre || entry.tecnicoSnapshot?.correo || "Técnico"} · {taskLabel(tasks, entry.tareaId)}</small>{entry.estado === "anulado" && <small>Anulado: {entry.motivoAnulacion}</small>}</div>{canManage && !readOnly && entry.estado !== "anulado" && <form className="works-annul-form" onSubmit={(event) => annul(event, "labor", entry.id)}><input className="erp-control" maxLength="1000" required value={annulReasons[key] || ""} onChange={(event) => setAnnulReasons((current) => ({...current, [key]: event.target.value}))} placeholder="Motivo de anulación" /><Button type="submit" variant="ghost-danger" disabled={Boolean(processing)}>Anular</Button></form>}</article>;})}{!visibleLabor.length && <p className="works-empty-copy">Aún no se han registrado horas hombre.</p>}</div>}
      </section>
    </div>
  </section>;
}

function MaterialsSection({businessId, canManage, currency, currentUserUid, hasAssociatedSale, loading, movements, processing, products, readOnly, role, runAction, saleMaterials, tasks, workId}) {
  const [draft, setDraft] = useState({itemId: "", cantidad: "", fecha: chileToday(), tareaId: ""});
  const [returnDrafts, setReturnDrafts] = useState({});
  const canConsume = canManage || ["TECNICO", "MEMBER"].includes(role);
  const exits = movements.filter((movement) => movement.tipo === "SALIDA_PROYECTO" && (canManage || movement.usuarioUid === currentUserUid));
  const returns = movements.filter((movement) => movement.tipo === "DEVOLUCION_PROYECTO");
  const visibleExitIds = new Set(exits.map((movement) => movement.id));
  const visibleReturns = returns.filter((movement) => visibleExitIds.has(movement.movimientoOrigenId));
  const saleValuedTotal = saleMaterials.filter((entry) => entry.costoHistoricoDisponible).reduce((sum, entry) => sum + entry.costoTotal, 0);
  const unavailableSaleMaterialCosts = saleMaterials.filter((entry) => !entry.costoHistoricoDisponible).length;
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
      if (success) setDraft({itemId: "", cantidad: "", fecha: chileToday(), tareaId: ""});
    });
  };
  const saveReturn = (event, exit) => {
    event.preventDefault();
    const value = returnDrafts[exit.id] || {cantidad: "", fecha: chileToday()};
    runAction(`material-return-${exit.id}`, () => registrarDevolucionMaterialTrabajo(businessId, workId, exit.id, value.cantidad, value.fecha, createWorkCostRequestId("material-return"))).then((success) => {
      if (success) setReturnDrafts((current) => ({...current, [exit.id]: {cantidad: "", fecha: chileToday()}}));
    });
  };
  const updateReturn = (exitId, field, value) => setReturnDrafts((current) => ({...current, [exitId]: {...(current[exitId] || {cantidad: "", fecha: chileToday()}), [field]: value}}));

  return <section className="works-detail-section works-financial-file">
    <div className="works-section-heading"><div><h3>Materiales utilizados</h3><span>Consumo neto valorizado</span></div><strong>{formatMoney(Math.max(0, valuedTotal), currency)}</strong></div>
    {hasAssociatedSale && <section className="works-material-group works-material-group--sale">
      <header><div><h4>Materiales incluidos en la venta</h4><p>{readOnly ? "Los materiales de la venta asociada ya fueron descontados del inventario y se conservan como historial." : "Los materiales de la venta asociada ya fueron descontados del inventario. Registra aquí sólo consumos adicionales del proyecto."}</p></div><strong>{formatMoney(saleValuedTotal, currency)}</strong></header>
      {saleMaterials.length > 0 ? <div className="works-sale-materials-list">{saleMaterials.map((material) => <article key={material.id}>
        <div><small>Producto</small><strong>{material.nombre}</strong><span>{material.ventaNumero}</span></div>
        <div><small>Cantidad</small><strong>{material.cantidad} {material.unidad}</strong></div>
        <div><small>Costo unitario histórico</small><strong>{material.costoHistoricoDisponible ? formatMoney(material.costoUnitario, material.moneda || currency) : "No disponible"}</strong></div>
        <div><small>Costo total</small><strong>{material.costoHistoricoDisponible ? formatMoney(material.costoTotal, material.moneda || currency) : "No disponible"}</strong></div>
        <div className="works-material-stock-state"><small>Inventario</small><strong>Stock ya descontado por la Venta</strong></div>
      </article>)}</div> : <p className="works-empty-copy">La venta confirmada no contiene productos físicos descontados del inventario.</p>}
      {unavailableSaleMaterialCosts > 0 && <p className="works-message works-message--warning">El costo histórico de {unavailableSaleMaterialCosts} material{unavailableSaleMaterialCosts === 1 ? "" : "es"} no está disponible.</p>}
    </section>}
    <section className="works-material-group">
      <header><div><h4>Consumos adicionales</h4><p>{readOnly ? "Salidas y devoluciones registradas durante la ejecución del proyecto." : "Estas salidas sí generan un movimiento nuevo de inventario."}</p></div><strong>{formatMoney(Math.max(0, additionalValuedTotal), currency)}</strong></header>
      <p className="works-financial-note">Cada salida congela su costo. Las devoluciones conservan el movimiento de origen y restituyen stock con el mismo costo.</p>
    {canConsume && !readOnly && <form className="works-cost-form works-material-form" onSubmit={saveExit}>
      <select className="erp-control" required value={draft.itemId} onChange={(event) => setDraft((current) => ({...current, itemId: event.target.value}))}>
        <option value="">Selecciona producto</option>
        {products.map((product) => <option key={product.id} value={product.id}>{product.nombre} · stock {Number(product.stock || 0)} {product.unidad || product.unidadStock || "unidad"}</option>)}
      </select>
      <TaskCostSelect tasks={tasks} value={draft.tareaId} onChange={(tareaId) => setDraft((current) => ({...current, tareaId}))} />
      <input className="erp-control" type="number" min="0.01" max="999999999.99" step="0.01" required value={draft.cantidad} onChange={(event) => setDraft((current) => ({...current, cantidad: event.target.value}))} placeholder="Cantidad" />
      <input className="erp-control" type="date" required value={draft.fecha} onChange={(event) => setDraft((current) => ({...current, fecha: event.target.value}))} />
      <Button type="submit" disabled={Boolean(processing)}>Registrar salida</Button>
      {selectedProduct && <dl className="works-material-estimate">
        <div><dt>Stock disponible</dt><dd>{Number(selectedProduct.stock || 0)} {selectedProduct.unidad || selectedProduct.unidadStock || "unidad"}</dd></div>
        <div><dt>Costo unitario vigente</dt><dd>{currentUnitCost == null ? "No disponible" : formatMoney(currentUnitCost, currentCostCurrency)}</dd></div>
        <div><dt>Costo estimado de esta salida</dt><dd>{estimatedCost == null ? "Ingresa una cantidad" : formatMoney(estimatedCost, currentCostCurrency)}</dd></div>
      </dl>}
    </form>}
    {loading ? <p>Cargando materiales...</p> : <div className="works-cost-list">{exits.map((exit) => {
      const returned = returnedFor(exit.id); const remaining = Math.max(0, Math.round((exit.cantidad - returned) * 100) / 100);
      const returnValue = returnDrafts[exit.id] || {cantidad: "", fecha: chileToday()};
      return <article key={exit.id}>
        <div><strong>{exit.productoSnapshot?.nombre || "Producto"}</strong><span>{exit.cantidad} {exit.productoSnapshot?.unidad || "unidad"} × {formatMoney(exit.costoUnitario, exit.moneda || currency)} = {formatMoney(exit.costoTotal, exit.moneda || currency)}</span><small>{dateLabel(exit.fecha)} · {exit.usuarioSnapshot?.nombre || "Equipo"} · {taskLabel(tasks, exit.tareaId)} · devuelto {returned}, pendiente {remaining}</small></div>
        {canManage && !readOnly && remaining > 0 && <form className="works-annul-form" onSubmit={(event) => saveReturn(event, exit)}><input className="erp-control" type="number" min="0.01" max={remaining} step="0.01" required value={returnValue.cantidad} onChange={(event) => updateReturn(exit.id, "cantidad", event.target.value)} placeholder="Cantidad a devolver" /><input className="erp-control" type="date" required value={returnValue.fecha} onChange={(event) => updateReturn(exit.id, "fecha", event.target.value)} /><Button type="submit" variant="secondary" disabled={Boolean(processing)}>Devolver</Button></form>}
      </article>;
    })}{!exits.length && <p className="works-empty-copy">Aún no se han registrado consumos adicionales.</p>}</div>}
    </section>
  </section>;
}

function commercialTotal(document) {
  const currency = /^[A-Z]{3}$/.test(String(document?.moneda || "")) ? document.moneda : "CLP";
  return new Intl.NumberFormat("es-CL", {style: "currency", currency, maximumFractionDigits: currency === "CLP" ? 0 : 2}).format(Number(document?.total || 0));
}

function CommercialFile({canManage, detail, loading, navigate}) {
  return <div className="works-commercial-file">
    <div className="works-commercial-heading"><div><h4>Resumen comercial</h4><span>{detail.cotizaciones.length} cotización{detail.cotizaciones.length === 1 ? "" : "es"} · {detail.ventas.length} venta{detail.ventas.length === 1 ? "" : "s"}</span></div></div>
    {loading ? <p>Cargando expediente...</p> : <div className="works-commercial-list">
      {detail.cotizaciones.map((quote) => {
        const relatedSale = detail.ventas.find((sale) => sale.cotizacionId === quote.id);
        const rejection = quote.motivoRechazoCliente || quote.comentarioRechazoCliente || "";
        return <article key={quote.id}><div><strong>{quote.numero || "Cotización"}</strong><span>{commercialStatusLabel(quote.estado)}{canManage ? ` · ${commercialTotal(quote)}` : ""}</span>{quote.estado === "rechazada" && rejection && <small>{rejection}</small>}</div><div><button type="button" onClick={() => navigate("/cotizaciones", {state: {openQuoteId: quote.id}})}>Abrir cotización</button>{relatedSale && <button type="button" onClick={() => navigate(`/ventas/${relatedSale.id}/editar`)}>Venta {relatedSale.numero}</button>}</div></article>;
      })}
      {detail.ventas.filter((sale) => !detail.cotizaciones.some((quote) => quote.id === sale.cotizacionId)).map((sale) => <article key={sale.id}><div><strong>{sale.numero || "Venta"}</strong><span>{commercialStatusLabel(sale.estado)}{canManage ? ` · ${commercialTotal(sale)}` : ""}</span></div><div><button type="button" onClick={() => navigate(`/ventas/${sale.id}/editar`)}>Abrir venta</button></div></article>)}
      {!detail.cotizaciones.length && !detail.ventas.length && <p className="works-empty-copy">Este proyecto aún no tiene cotizaciones ni ventas vinculadas.</p>}
    </div>}
  </div>;
}

function Filter({children, label, onChange, value}) { return <label className="erp-field"><span className="erp-field__label">{label}</span><select className="erp-control" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>; }
function Field({children, className = "", error, label, optional = false, required}) { return <label className={`erp-field ${className}`}><span className="erp-field__label">{label}{required ? " *" : optional ? <span className="works-field-optional">Opcional</span> : ""}</span>{children}{error && <small className="works-field-error">{error}</small>}</label>; }
function FormSection({children, title}) { return <section className="works-form-section"><h3>{title}</h3>{children}</section>; }
function DetailDisclosure({children, summary, title}) { return <details className="works-detail-disclosure"><summary><span><strong>{title}</strong><small>{summary}</small></span></summary><div className="works-detail-disclosure__content">{children}</div></details>; }
function taskLabel(tasks, taskId) { return taskId ? tasks.find((task) => task.id === taskId)?.titulo || "Tarea no disponible" : "Proyecto completo"; }
function TaskCostSelect({onChange, tasks, value}) { return <select className="erp-control" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Costo general del proyecto</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.titulo}</option>)}</select>; }
function workPersonIdentity(snapshot, uid, members = [], fallback = "Sin responsable principal") {
  return getWorkHistoricalPersonIdentity(snapshot, uid, members, fallback);
}

function WorkList({canManage, onEdit, onOpen, works}) {
  if (!works.length) return <div className="erp-empty-state"><AppIcon icon={BriefcaseBusiness} size={30} /><p>No hay trabajos coincidentes.</p></div>;
  return <><div className="erp-table-region erp-desktop-only"><table className="erp-table works-table"><thead><tr><th>Trabajo</th><th>Cliente</th><th>Responsable principal</th><th>Prioridad</th><th>Término planificado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{works.map((work) => <tr key={work.id}><td><button className="works-link" type="button" onClick={() => onOpen(work)}><strong>{work.numero}</strong><span>{work.titulo}</span></button></td><td>{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</td><td>{workPersonIdentity(work.responsableSnapshot, work.responsableUid)}</td><td><Priority value={work.prioridad} /></td><td>{dateLabel(work.fechaPrevista)}</td><td><Status value={work.estado} /></td><td><div className="works-row-actions"><button type="button" onClick={() => onOpen(work)}>Ver</button>{canManage && !isWorkOperationalReadOnly(work) && <button type="button" onClick={() => onEdit(work)}>Editar</button>}</div></td></tr>)}</tbody></table></div><div className="erp-card-list erp-mobile-only">{works.map((work) => <article key={work.id} className="erp-record-card"><header className="erp-record-card__header"><div><span className="works-number">{work.numero}</span><h3 className="erp-record-card__title">{work.titulo}</h3></div><Status value={work.estado} /></header><dl className="erp-meta-grid"><div className="erp-meta"><dt className="erp-meta__label">Cliente</dt><dd className="erp-meta__value">{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Responsable principal</dt><dd className="erp-meta__value">{workPersonIdentity(work.responsableSnapshot, work.responsableUid)}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Prioridad</dt><dd className="erp-meta__value"><Priority value={work.prioridad} /></dd></div><div className="erp-meta"><dt className="erp-meta__label">Término planificado</dt><dd className="erp-meta__value">{dateLabel(work.fechaPrevista)}</dd></div></dl><div className="works-card-actions"><Button type="button" variant="secondary" onClick={() => onOpen(work)}>Ver ficha</Button>{canManage && !isWorkOperationalReadOnly(work) && <Button type="button" variant="secondary" onClick={() => onEdit(work)}>Editar</Button>}</div></article>)}</div></>;
}

function WorkBoard({onOpen, works}) { return <div className="works-board">{BOARD_STATUSES.map((status) => { const columnWorks = works.filter((work) => work.estado === status); return <section key={status}><header><h3>{getWorkStatusLabel(status)}</h3><span>{columnWorks.length}</span></header><div>{columnWorks.map((work) => { const progress = getWorkTaskProgress(work); const indicators = getWorkOperationalIndicators(work); return <button type="button" className="works-board-card" key={work.id} onClick={() => onOpen(work)}><span className="works-number">{work.numero}</span><strong>{work.titulo}</strong><small>{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</small><dl><div><dt>Responsable</dt><dd>{workPersonIdentity(work.responsableSnapshot, work.responsableUid, [], "Sin responsable")}</dd></div><div><dt>Prioridad</dt><dd><Priority value={work.prioridad} /></dd></div><div><dt>Progreso</dt><dd>{progress.percent}%</dd></div><div><dt>Tareas</dt><dd>{progress.completed}/{progress.total}</dd></div><div><dt>Costo acumulado</dt><dd>{formatMoney(getWorkAccumulatedCost(work), work.moneda || "CLP")}</dd></div><div><dt>Último avance</dt><dd>{dateLabel(work.ultimoAvanceEn)}</dd></div></dl>{work.estado === "en_espera" && work.motivoEspera && <span className="works-wait-reason">{work.motivoEspera}</span>}{indicators.noRecentActivity && <span className="works-alert-chip">Sin actividad reciente</span>}</button>;})}{!columnWorks.length && <p>Sin trabajos</p>}</div></section>; })}</div>; }

function WorkSummary({cost, members, work}) { const progress = getWorkTaskProgress(work); return <dl className="works-summary"><div><dt>Cliente</dt><dd>{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</dd></div><div><dt>Responsable principal</dt><dd>{workPersonIdentity(work.responsableSnapshot, work.responsableUid, members)}</dd></div><div><dt>Prioridad</dt><dd><Priority value={work.prioridad} /></dd></div><div><dt>Término planificado</dt><dd>{dateLabel(work.fechaPrevista)}</dd></div><div><dt>Progreso</dt><dd>{progress.percent}% · {progress.completed}/{progress.total} tareas</dd></div><div><dt>Costo acumulado</dt><dd>{formatMoney(cost, work.moneda || "CLP")}</dd></div></dl>; }

function DailyCostSummary({currency, rows}) { return <section className="works-detail-section works-daily-costs"><h3>Costos por día</h3>{rows.length ? <div className="erp-table-region"><table className="erp-table"><thead><tr><th>Fecha</th><th>Materiales</th><th>HH</th><th>Gastos</th><th>Total</th></tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{dateLabel(row.date)}</td><td>{formatMoney(row.materials, currency)}</td><td>{formatMoney(row.labor, currency)}</td><td>{formatMoney(row.expenses, currency)}</td><td><strong>{formatMoney(row.total, currency)}</strong></td></tr>)}</tbody></table></div> : <p className="works-empty-copy">Aún no hay costos fechados para resumir.</p>}</section>; }

function WorkBalanceSection({balance, loading}) {
  if (loading) return <section className="works-detail-section"><h3>Balance y margen</h3><p>Calculando desde fuentes autoritativas...</p></section>;
  if (!balance) return null;
  const money = (value) => value == null ? "No disponible" : formatMoney(value, balance.moneda);
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
    {inconsistent && <div className="works-balance-breakdown">{balance.desglosePorMoneda.map((entry) => <article key={entry.moneda}><strong>{entry.moneda}</strong><span>Ingresos {formatMoney(entry.valorComercial, entry.moneda)} · costos {formatMoney(entry.costoTotal, entry.moneda)}</span></article>)}</div>}
    {unavailableHistoricalCosts > 0 && <p className="works-message works-message--warning">El costo histórico de {unavailableHistoricalCosts} material{unavailableHistoricalCosts === 1 ? "" : "es"} no está disponible.</p>}
  </section>;
}
