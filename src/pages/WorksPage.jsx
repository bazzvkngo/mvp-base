import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {BriefcaseBusiness, Columns3, LayoutList, Pencil, Plus, Search, Trash2} from "lucide-react";
import {useLocation, useNavigate} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import StatusBadge from "../components/ui/StatusBadge";
import {WORK_PRIORITIES, WORK_STATUSES, canManageWorks, getWorkDraftErrors, getWorkPriorityLabel, getWorkStatusLabel, getWorkTaskProgress, humanizeWorkEvent, matchesWorkFilters} from "../domain/workModel.mjs";
import {listarMiembrosNegocio} from "../services/businessMemberService.js";
import {listarClientes} from "../services/clientService.js";
import {actualizarTrabajo, agregarNotaTrabajo, agregarTareaTrabajo, asignarTareaTrabajo, cambiarEstadoTareaTrabajo, cambiarEstadoTrabajo, cargarFichaTrabajo, createWorkRequestId, createWorkTaskRequestId, crearTrabajo, documentarTareaTrabajo, eliminarTareaTrabajo, listarTrabajos} from "../services/workService.js";
import "../features/works/works.css";

const EMPTY_WORK = Object.freeze({titulo: "", descripcion: "", clienteId: "", responsableUid: "", participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""});
const BOARD_STATUSES = ["pendiente", "en_progreso", "en_espera", "completado"];

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

export default function WorksPage({businessId, currentUserUid, role}) {
  const canManage = canManageWorks(role);
  const location = useLocation();
  const navigate = useNavigate();
  const createRequestRef = useRef("");
  const [works, setWorks] = useState([]);
  const [clients, setClients] = useState([]);
  const [members, setMembers] = useState([]);
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
  const [detail, setDetail] = useState({tareas: [], notas: [], historial: [], vinculos: [], cotizaciones: [], ventas: []});
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [processing, setProcessing] = useState("");
  const [cancelWork, setCancelWork] = useState(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError("");
    try {
      const [workList, clientList, memberList] = await Promise.all([listarTrabajos(businessId), listarClientes(businessId), listarMiembrosNegocio(businessId)]);
      setWorks(workList); setClients(clientList.filter((client) => client.estado === "activo")); setMembers(memberList.filter((member) => member.estado === "activo"));
    } catch (loadError) {
      setError(loadError.message || "No se pudo cargar Proyectos y trabajos.");
    } finally { setLoading(false); }
  }, [businessId]);

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
    try { setDetail(await cargarFichaTrabajo(businessId, workId)); }
    catch (detailError) { setError(detailError.message || "No se pudo cargar la ficha del trabajo."); }
    finally { setDetailLoading(false); }
  }, [businessId]);

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
    const list = await listarTrabajos(businessId); setWorks(list);
    const current = list.find((work) => work.id === workId);
    if (current) setSelectedWork(current);
    await loadDetail(workId);
  };

  const visibleWorks = useMemo(() => works.filter((work) => matchesWorkFilters(work, filters)), [filters, works]);
  const updateDraft = (field, value) => { setDraft((current) => ({...current, [field]: value})); setFieldErrors((current) => ({...current, [field]: ""})); };
  const openNew = () => { setEditingWork(null); setDraft({...EMPTY_WORK}); setFieldErrors({}); createRequestRef.current = createWorkRequestId(); setFormOpen(true); };
  const openEdit = (work) => { setSelectedWork(null); setEditingWork(work); setDraft({titulo: work.titulo, descripcion: work.descripcion, clienteId: work.clienteId, responsableUid: work.responsableUid, participanteUids: work.participanteUids, estado: work.estado, prioridad: work.prioridad, fechaInicio: work.fechaInicio, fechaPrevista: work.fechaPrevista}); setFieldErrors({}); setFormOpen(true); };

  const save = async (event) => {
    event.preventDefault(); const errors = getWorkDraftErrors(draft); setFieldErrors(errors); if (Object.keys(errors).length) return;
    setSaving(true); setError("");
    try {
      let workId = editingWork?.id;
      if (editingWork) await actualizarTrabajo(businessId, editingWork.id, draft);
      else { const result = await crearTrabajo(businessId, draft, createRequestRef.current || createWorkRequestId()); workId = result.trabajoId; }
      setFormOpen(false); setEditingWork(null);
      const list = await listarTrabajos(businessId); setWorks(list); const current = list.find((work) => work.id === workId); if (current) openDetail(current);
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

  return <main className="erp-page works-page">
    <header className="erp-page-header"><div className="erp-page-header__content"><h1 className="erp-page-header__title">Proyectos y trabajos</h1><p className="erp-page-header__description">Organiza y da seguimiento al trabajo operativo del negocio.</p></div>{canManage && <Button type="button" icon={Plus} onClick={openNew}>Nuevo trabajo</Button>}</header>
    {error && <div className="works-message works-message--error" role="alert">{error}</div>}
    <section className="erp-panel works-panel" aria-label="Trabajos registrados">
      <div className="works-toolbar"><div className="works-view-switch" role="group" aria-label="Vista"><button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}><AppIcon icon={LayoutList} size={17} />Lista</button><button type="button" className={view === "board" ? "is-active" : ""} onClick={() => setView("board")}><AppIcon icon={Columns3} size={17} />Tablero</button></div><span>{visibleWorks.length} trabajo{visibleWorks.length === 1 ? "" : "s"}</span></div>
      <div className="erp-filters works-filters"><label className="erp-field works-search"><span className="erp-field__label">Buscar por número, título o cliente</span><span className="works-search-control"><AppIcon icon={Search} size={18} /><input className="erp-control" value={filters.query} onChange={(event) => setFilters((current) => ({...current, query: event.target.value}))} /></span></label><Filter label="Estado" value={filters.estado} onChange={(value) => setFilters((current) => ({...current, estado: value}))}><option value="todos">Todos</option>{WORK_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Filter><Filter label="Prioridad" value={filters.prioridad} onChange={(value) => setFilters((current) => ({...current, prioridad: value}))}><option value="todas">Todas</option>{WORK_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Filter><Filter label="Responsable" value={filters.responsableUid} onChange={(value) => setFilters((current) => ({...current, responsableUid: value}))}><option value="todos">Todos</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.nombre}</option>)}</Filter></div>
      {loading ? <div className="erp-empty-state">Cargando trabajos...</div> : view === "board" ? <WorkBoard works={visibleWorks} onOpen={openDetail} /> : <WorkList works={visibleWorks} canManage={canManage} onEdit={openEdit} onOpen={openDetail} />}
    </section>

    <ResponsiveDialog className="works-form-dialog" open={formOpen} onClose={() => !saving && setFormOpen(false)} size="large" eyebrow="Proyectos y trabajos" title={editingWork ? `Editar ${editingWork.numero}` : "Nuevo trabajo"} description="Registra la información y planificación operativa." footer={<><Button type="button" variant="secondary" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" form="work-form" disabled={saving}>{saving ? "Guardando..." : editingWork ? "Guardar cambios" : "Crear trabajo"}</Button></>}><form id="work-form" className="works-form" onSubmit={save}><FormSection title="Información"><div className="works-form-grid"><Field className="works-field--wide" label="Título" required error={fieldErrors.titulo}><input autoFocus className="erp-control" maxLength="180" value={draft.titulo} onChange={(event) => updateDraft("titulo", event.target.value)} /></Field><Field className="works-field--wide" label="Descripción" error={fieldErrors.descripcion}><textarea className="erp-control" rows="3" maxLength="5000" value={draft.descripcion} onChange={(event) => updateDraft("descripcion", event.target.value)} /></Field><Field className="works-field--wide" label="Cliente"><select className="erp-control" value={draft.clienteId} onChange={(event) => updateDraft("clienteId", event.target.value)}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.clienteId} value={client.clienteId}>{client.nombreRazonSocial} · {client.rut}</option>)}</select></Field></div></FormSection><FormSection title="Planificación"><div className="works-form-grid"><Field label="Responsable"><select className="erp-control" value={draft.responsableUid} onChange={(event) => updateDraft("responsableUid", event.target.value)}><option value="">Sin responsable</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.nombre}</option>)}</select></Field><Field label="Prioridad" required error={fieldErrors.prioridad}><select className="erp-control" value={draft.prioridad} onChange={(event) => updateDraft("prioridad", event.target.value)}>{WORK_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="Estado" required error={fieldErrors.estado}><select className="erp-control" value={draft.estado} onChange={(event) => updateDraft("estado", event.target.value)}>{WORK_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="Fecha de inicio" error={fieldErrors.fechaInicio}><input className="erp-control" type="date" value={draft.fechaInicio} onChange={(event) => updateDraft("fechaInicio", event.target.value)} /></Field><Field label="Fecha prevista" error={fieldErrors.fechaPrevista}><input className="erp-control" type="date" value={draft.fechaPrevista} onChange={(event) => updateDraft("fechaPrevista", event.target.value)} /></Field><fieldset className="works-participants works-field--wide"><legend>Participantes</legend><div>{members.filter((member) => member.uid !== draft.responsableUid).map((member) => <label key={member.uid}><input type="checkbox" checked={draft.participanteUids.includes(member.uid)} onChange={(event) => updateDraft("participanteUids", event.target.checked ? [...draft.participanteUids, member.uid] : draft.participanteUids.filter((uid) => uid !== member.uid))} />{member.nombre}</label>)}{!members.length && <span>No hay miembros activos disponibles.</span>}</div></fieldset></div></FormSection></form></ResponsiveDialog>

    <ResponsiveDialog className="works-detail-dialog" open={Boolean(selectedWork)} onClose={() => setSelectedWork(null)} size="large" eyebrow={selectedWork?.numero} title={selectedWork?.titulo} description="Ficha operativa e historial del trabajo."><>{selectedWork && <div className="works-detail"><div className="works-detail-actions"><Status value={selectedWork.estado} />{canManage && <><Button type="button" variant="secondary" icon={Pencil} onClick={() => openEdit(selectedWork)}>Editar</Button><label><span className="sr-only">Cambiar estado</span><select className="erp-control" disabled={Boolean(processing)} value={selectedWork.estado} onChange={(event) => { const next = event.target.value; if (next === "cancelado") setCancelWork(selectedWork); else runDetailAction("state", () => cambiarEstadoTrabajo(businessId, selectedWork.id, next)); }}>{WORK_STATUSES.filter((item) => item.value !== "cancelado").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}{selectedWork.estado === "cancelado" && <option value="cancelado">Cancelado</option>}</select></label>{selectedWork.estado !== "cancelado" && <Button type="button" variant="ghost-danger" onClick={() => setCancelWork(selectedWork)}>Cancelar trabajo</Button>}</>}</div><WorkSummary work={selectedWork} /><section className="works-detail-section"><h3>Descripción</h3><p>{selectedWork.descripcion || "Sin descripción registrada."}</p></section><CommercialFile canManage={canManage} detail={detail} loading={detailLoading} navigate={navigate} work={selectedWork} /><TaskSection key={selectedWork.id} businessId={businessId} canManage={canManage} currentUserUid={currentUserUid} loading={detailLoading} members={members} processing={processing} role={role} runAction={runDetailAction} tasks={detail.tareas} terminal={terminal} workId={selectedWork.id} /><section className="works-detail-section"><h3>Notas</h3>{canManage && <form className="works-note-form" onSubmit={addNote}><textarea className="erp-control" rows="2" maxLength="4000" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Agrega una actualización o antecedente relevante." /><Button type="submit" disabled={processing === "note-new"}>Agregar nota</Button></form>}<div className="works-notes">{detail.notas.map((note) => <article key={note.id}><header><strong>{note.autorSnapshot?.nombre || "Persona del equipo"}</strong><time>{dateLabel(note.creadoEn, true)}</time></header><p>{note.texto}</p></article>)}{!detail.notas.length && <p className="works-empty-copy">Aún no hay notas.</p>}</div></section><section className="works-detail-section"><h3>Historial del trabajo</h3><ol className="works-timeline">{detail.historial.map((event) => <li key={event.id}><time>{dateLabel(event.fecha, true)}</time><p>{humanizeWorkEvent(event)}</p>{event.tipo === "nota_agregada" && event.detalle?.texto && <blockquote>{event.detalle.texto}</blockquote>}</li>)}</ol></section></div>}</></ResponsiveDialog>

    <ResponsiveDialog open={Boolean(cancelWork)} onClose={() => !processing && setCancelWork(null)} size="small" eyebrow="Proyectos y trabajos" title="Cancelar trabajo" description="El registro y su historial se conservarán." footer={<><Button type="button" variant="secondary" disabled={Boolean(processing)} onClick={() => setCancelWork(null)}>Volver</Button><Button type="button" variant="danger" disabled={Boolean(processing)} onClick={() => runDetailAction("cancel", () => cambiarEstadoTrabajo(businessId, cancelWork.id, "cancelado")).then(() => setCancelWork(null))}>{processing ? "Cancelando..." : "Cancelar trabajo"}</Button></>}><p>¿Confirmas que deseas cancelar {cancelWork?.numero}?</p></ResponsiveDialog>
  </main>;
}

function commercialStatusLabel(value) {
  return String(value || "borrador").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function TaskSection({businessId, canManage, currentUserUid, loading, members, processing, role, runAction, tasks, terminal, workId}) {
  const [draft, setDraft] = useState({titulo: "", descripcion: "", responsableUid: ""});
  const [documentation, setDocumentation] = useState({});
  const visibleTasks = canManage
    ? tasks
    : tasks.filter((task) => task.modeloTareaVersion < 2 || task.responsableUid === currentUserUid);
  const createTask = (event) => {
    event.preventDefault();
    if (!draft.titulo.trim()) return;
    runAction("task-new", () => agregarTareaTrabajo(businessId, workId, draft, createWorkTaskRequestId("task-create"))).then((success) => {
      if (success) setDraft({titulo: "", descripcion: "", responsableUid: ""});
    });
  };
  const canOperate = (task) => canManage || (role === "MEMBER" && task.responsableUid === currentUserUid);
  const assign = (task, responsableUid) => runAction(`task-assign-${task.id}`, () => asignarTareaTrabajo(businessId, workId, task.id, responsableUid, createWorkTaskRequestId("task-assign")));
  const changeState = (task, completed) => runAction(`task-state-${task.id}`, () => cambiarEstadoTareaTrabajo(businessId, workId, task.id, completed, {requestId: createWorkTaskRequestId(completed ? "task-complete" : "task-reopen")}));
  const addDocumentation = (event, task) => {
    event.preventDefault();
    const value = String(documentation[task.id] || "").trim();
    if (!value) return;
    runAction(`task-document-${task.id}`, () => documentarTareaTrabajo(businessId, workId, task.id, value, createWorkTaskRequestId("task-document"))).then((success) => {
      if (success) setDocumentation((current) => ({...current, [task.id]: ""}));
    });
  };
  const removeLegacy = (task) => runAction(`task-delete-${task.id}`, () => eliminarTareaTrabajo(businessId, workId, task.id, createWorkTaskRequestId("task-delete")));

  return <section className="works-detail-section">
    <div className="works-section-heading"><div><h3>Tareas operativas</h3><span>{tasks.filter((task) => task.completada).length} / {tasks.length} completadas</span></div></div>
    {canManage && !terminal && <form className="works-task-create" onSubmit={createTask}>
      <input className="erp-control" maxLength="240" value={draft.titulo} onChange={(event) => setDraft((current) => ({...current, titulo: event.target.value}))} placeholder="Título de la tarea" required />
      <textarea className="erp-control" maxLength="4000" rows="2" value={draft.descripcion} onChange={(event) => setDraft((current) => ({...current, descripcion: event.target.value}))} placeholder="Descripción operativa" />
      <select className="erp-control" value={draft.responsableUid} onChange={(event) => setDraft((current) => ({...current, responsableUid: event.target.value}))}><option value="">Sin responsable</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.nombre}</option>)}</select>
      <Button type="submit" icon={Plus} disabled={processing === "task-new"}>Crear tarea</Button>
    </form>}
    {loading ? <p>Cargando tareas...</p> : <div className="works-task-list works-task-list--v2">
      {visibleTasks.map((task) => <article key={task.id} className={task.completada ? "is-complete" : ""}>
        <header><div><strong>{task.titulo}</strong><span className={`works-task-state works-task-state--${task.estado}`}>{task.completada ? "Completada" : "Pendiente"}</span></div>{canManage && !terminal && <select aria-label={`Responsable de ${task.titulo}`} className="erp-control" disabled={Boolean(processing)} value={task.responsableUid} onChange={(event) => assign(task, event.target.value)}><option value="">Sin responsable</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.nombre}</option>)}</select>}</header>
        {task.descripcion && <p>{task.descripcion}</p>}
        <small>Responsable: {task.responsableSnapshot?.nombre || "Sin responsable"}{task.modeloTareaVersion < 2 ? " · Tarea legacy" : ""}</small>
        {task.documentacion.length > 0 && <div className="works-task-documentation">{task.documentacion.map((entry) => <div key={entry.id}><p>{entry.texto}</p><small>{entry.autorSnapshot?.nombre || "Persona del equipo"} · {dateLabel(entry.creadoEn, true)}{entry.tipo === "cierre" ? " · Cierre" : ""}</small></div>)}</div>}
        {!terminal && canOperate(task) && <form className="works-task-document-form" onSubmit={(event) => addDocumentation(event, task)}><textarea className="erp-control" maxLength="8000" rows="2" value={documentation[task.id] || ""} onChange={(event) => setDocumentation((current) => ({...current, [task.id]: event.target.value}))} placeholder="Documentar avance o cierre" /><Button type="submit" variant="secondary" disabled={Boolean(processing)}>Documentar</Button></form>}
        {!terminal && <div className="works-task-actions">{!task.completada && canOperate(task) && <Button type="button" disabled={Boolean(processing)} onClick={() => changeState(task, true)}>Completar</Button>}{task.completada && canManage && <Button type="button" variant="secondary" disabled={Boolean(processing)} onClick={() => changeState(task, false)}>Reabrir</Button>}{canManage && task.modeloTareaVersion < 2 && !task.completada && <button type="button" aria-label={`Eliminar ${task.titulo}`} onClick={() => removeLegacy(task)}><AppIcon icon={Trash2} size={16} />Eliminar legacy</button>}</div>}
      </article>)}
      {!visibleTasks.length && <p className="works-empty-copy">{canManage ? "Aún no hay tareas." : "No tienes tareas asignadas."}</p>}
    </div>}
  </section>;
}

function commercialTotal(document) {
  const currency = /^[A-Z]{3}$/.test(String(document?.moneda || "")) ? document.moneda : "CLP";
  return new Intl.NumberFormat("es-CL", {style: "currency", currency, maximumFractionDigits: currency === "CLP" ? 0 : 2}).format(Number(document?.total || 0));
}

function CommercialFile({canManage, detail, loading, navigate, work}) {
  const newQuote = () => navigate("/cotizaciones/nueva", {state: {projectContext: {
    trabajoId: work.id,
    trabajoNumero: work.numero,
    trabajoTitulo: work.titulo,
    clienteId: work.clienteId,
    clienteSnapshot: work.clienteSnapshot,
  }}});
  return <section className="works-detail-section works-commercial-file">
    <div className="works-commercial-heading"><div><h3>Expediente comercial</h3><span>{detail.cotizaciones.length} cotización{detail.cotizaciones.length === 1 ? "" : "es"} · {detail.ventas.length} venta{detail.ventas.length === 1 ? "" : "s"}</span></div>{canManage && <Button type="button" icon={Plus} onClick={newQuote}>Nueva cotización</Button>}</div>
    {loading ? <p>Cargando expediente...</p> : <div className="works-commercial-list">
      {detail.cotizaciones.map((quote) => {
        const relatedSale = detail.ventas.find((sale) => sale.cotizacionId === quote.id);
        const rejection = quote.motivoRechazoCliente || quote.comentarioRechazoCliente || "";
        return <article key={quote.id}><div><strong>{quote.numero || "Cotización"}</strong><span>{commercialStatusLabel(quote.estado)} · {commercialTotal(quote)}</span>{quote.estado === "rechazada" && rejection && <small>{rejection}</small>}</div><div><button type="button" onClick={() => navigate("/cotizaciones", {state: {openQuoteId: quote.id}})}>Abrir cotización</button>{relatedSale && <button type="button" onClick={() => navigate(`/ventas/${relatedSale.id}/editar`)}>Venta {relatedSale.numero}</button>}</div></article>;
      })}
      {detail.ventas.filter((sale) => !detail.cotizaciones.some((quote) => quote.id === sale.cotizacionId)).map((sale) => <article key={sale.id}><div><strong>{sale.numero || "Venta"}</strong><span>{commercialStatusLabel(sale.estado)} · {commercialTotal(sale)}</span></div><div><button type="button" onClick={() => navigate(`/ventas/${sale.id}/editar`)}>Abrir venta</button></div></article>)}
      {!detail.cotizaciones.length && !detail.ventas.length && <p className="works-empty-copy">Este proyecto aún no tiene cotizaciones ni ventas vinculadas.</p>}
    </div>}
  </section>;
}

function Filter({children, label, onChange, value}) { return <label className="erp-field"><span className="erp-field__label">{label}</span><select className="erp-control" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>; }
function Field({children, className = "", error, label, required}) { return <label className={`erp-field ${className}`}><span className="erp-field__label">{label}{required ? " *" : ""}</span>{children}{error && <small className="works-field-error">{error}</small>}</label>; }
function FormSection({children, title}) { return <section className="works-form-section"><h3>{title}</h3>{children}</section>; }

function WorkList({canManage, onEdit, onOpen, works}) {
  if (!works.length) return <div className="erp-empty-state"><AppIcon icon={BriefcaseBusiness} size={30} /><p>No hay trabajos coincidentes.</p></div>;
  return <><div className="erp-table-region erp-desktop-only"><table className="erp-table works-table"><thead><tr><th>Trabajo</th><th>Cliente</th><th>Responsable</th><th>Prioridad</th><th>Fecha prevista</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{works.map((work) => <tr key={work.id}><td><button className="works-link" type="button" onClick={() => onOpen(work)}><strong>{work.numero}</strong><span>{work.titulo}</span></button></td><td>{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</td><td>{work.responsableSnapshot?.nombre || "Sin responsable"}</td><td><Priority value={work.prioridad} /></td><td>{dateLabel(work.fechaPrevista)}</td><td><Status value={work.estado} /></td><td><div className="works-row-actions"><button type="button" onClick={() => onOpen(work)}>Ver</button>{canManage && <button type="button" onClick={() => onEdit(work)}>Editar</button>}</div></td></tr>)}</tbody></table></div><div className="erp-card-list erp-mobile-only">{works.map((work) => <article key={work.id} className="erp-record-card"><header className="erp-record-card__header"><div><span className="works-number">{work.numero}</span><h3 className="erp-record-card__title">{work.titulo}</h3></div><Status value={work.estado} /></header><dl className="erp-meta-grid"><div className="erp-meta"><dt className="erp-meta__label">Cliente</dt><dd className="erp-meta__value">{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Responsable</dt><dd className="erp-meta__value">{work.responsableSnapshot?.nombre || "Sin responsable"}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Prioridad</dt><dd className="erp-meta__value"><Priority value={work.prioridad} /></dd></div><div className="erp-meta"><dt className="erp-meta__label">Fecha prevista</dt><dd className="erp-meta__value">{dateLabel(work.fechaPrevista)}</dd></div></dl><div className="works-card-actions"><Button type="button" variant="secondary" onClick={() => onOpen(work)}>Ver ficha</Button>{canManage && <Button type="button" variant="secondary" onClick={() => onEdit(work)}>Editar</Button>}</div></article>)}</div></>;
}

function WorkBoard({onOpen, works}) { return <div className="works-board">{BOARD_STATUSES.map((status) => { const columnWorks = works.filter((work) => work.estado === status); return <section key={status}><header><h3>{getWorkStatusLabel(status)}</h3><span>{columnWorks.length}</span></header><div>{columnWorks.map((work) => <button type="button" className="works-board-card" key={work.id} onClick={() => onOpen(work)}><span className="works-number">{work.numero}</span><strong>{work.titulo}</strong><small>{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</small><dl><div><dt>Responsable</dt><dd>{work.responsableSnapshot?.nombre || "Sin responsable"}</dd></div><div><dt>Prioridad</dt><dd><Priority value={work.prioridad} /></dd></div><div><dt>Prevista</dt><dd>{dateLabel(work.fechaPrevista)}</dd></div></dl></button>)}{!columnWorks.length && <p>Sin trabajos</p>}</div></section>; })}</div>; }

function WorkSummary({work}) { return <dl className="works-summary"><div><dt>Cliente</dt><dd>{work.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</dd></div><div><dt>Responsable</dt><dd>{work.responsableSnapshot?.nombre || "Sin responsable"}</dd></div><div><dt>Participantes</dt><dd>{work.participantesSnapshot?.map((person) => person.nombre).join(", ") || "Sin participantes"}</dd></div><div><dt>Prioridad</dt><dd><Priority value={work.prioridad} /></dd></div><div><dt>Inicio</dt><dd>{dateLabel(work.fechaInicio)}</dd></div><div><dt>Fecha prevista</dt><dd>{dateLabel(work.fechaPrevista)}</dd></div>{work.fechaCompletado && <div><dt>Completado</dt><dd>{dateLabel(work.fechaCompletado, true)}</dd></div>}</dl>; }
