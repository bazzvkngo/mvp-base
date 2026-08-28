import React from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import StatusBadge from "../components/ui/StatusBadge";
import {COUNTRIES, getCountryByCode} from "../domain/businessCatalog";
import {formatFiscalIdentifierForDisplay} from "../domain/fiscalIdentifier.mjs";
import {BUSINESS_ROLE_LABELS} from "../domain/rbac.mjs";
import {
  createPlatformRequestId,
  getPlatformBusiness,
  getPlatformSummary,
  getPlatformUser,
  getPlatformVerificationDocument,
  listPlatformBusinesses,
  listPlatformUsers,
  permanentlyDeletePlatformBusiness,
  resolvePlatformVerification,
  setPlatformBusinessStatus,
  setPlatformUserStatus,
} from "../services/platformAdminService";

const VERIFICATION_LABELS = {
  NO_VERIFICADA: "Empresa no verificada",
  PENDIENTE: "Verificación en revisión",
  VERIFICADA: "Empresa verificada",
  RECHAZADA: "Verificación rechazada",
};

function message(error, fallback) {
  const code = String(error?.code || "");
  if (code.includes("permission-denied")) return "No tienes autorizacion para esta accion.";
  if (code.includes("already-exists")) return "La identidad fiscal ya pertenece a otra empresa verificada.";
  if (code.includes("failed-precondition")) return error?.message || "La operacion no esta disponible.";
  return fallback;
}

function destructiveMessage(error) {
  const code = String(error?.code || "");
  if (code.includes("permission-denied")) {
    return "No tienes autorización para eliminar esta empresa.";
  }
  return error?.message || "No pudimos eliminar permanentemente la empresa.";
}

function date(value) {
  if (!value) return "Sin registro";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Sin registro" :
    new Intl.DateTimeFormat("es-CL", {dateStyle: "medium", timeStyle: "short"}).format(parsed);
}

function countryName(code) {
  return getCountryByCode(code)?.name || code || "Sin registro";
}

function fiscalIdentifier(countryCode, value) {
  return value
    ? formatFiscalIdentifierForDisplay(countryCode, value)
    : "Sin registro";
}

function fiscalFieldLabel(type, state) {
  const normalizedType = String(type || "").trim().toUpperCase();
  if (!normalizedType || normalizedType === "IDENTIFICACION_FISCAL") {
    return `Identificación fiscal ${state === "declarado" ? "declarada" : "confirmada"}`;
  }
  return `${normalizedType} ${state}`;
}

function verificationVariant(state) {
  if (state === "VERIFICADA") return "success";
  if (state === "PENDIENTE") return "warning";
  return "neutral";
}

function stateVariant(state) {
  return state === "activo" ? "success" : state === "suspendida" || state === "suspendido" ? "warning" : "neutral";
}

function PlatformHeading({eyebrow, title, description, action}) {
  return <header className="platform-page-heading">
    <div><span className="platform-page-heading__eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action}
  </header>;
}

function Loading() {
  return <div className="platform-state"><RefreshCw className="platform-spin" size={22} /><p>Cargando datos globales...</p></div>;
}

function ErrorState({error, retry}) {
  return <div className="platform-state is-error"><AppIcon icon={AlertTriangle} size={24} /><p>{error}</p><Button variant="secondary" onClick={retry}>Reintentar</Button></div>;
}

export function PlatformDashboardPage() {
  const [state, setState] = React.useState({loading: true, data: null, error: ""});
  const load = React.useCallback(() => {
    setState((current) => ({...current, loading: true, error: ""}));
    getPlatformSummary()
      .then((data) => setState({loading: false, data, error: ""}))
      .catch((error) => setState({loading: false, data: null, error: message(error, "No pudimos cargar el resumen.")}));
  }, []);
  React.useEffect(load, [load]);
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState error={state.error} retry={load} />;
  const cards = [
    {label: "Empresas", value: state.data.empresas.total, detail: `${state.data.empresas.activas} activas`, icon: Building2},
    {label: "Usuarios", value: state.data.usuarios.total, detail: `${state.data.usuarios.conMembresiaActiva} con membresia activa`, icon: Users},
    {label: "Verificaciones pendientes", value: state.data.empresas.verificacionesPendientes, detail: `${state.data.empresas.verificadas} verificadas`, icon: Clock3},
    {label: "Suspensiones", value: state.data.empresas.suspendidas + state.data.usuarios.suspendidos, detail: `${state.data.empresas.suspendidas} empresas · ${state.data.usuarios.suspendidos} usuarios`, icon: AlertTriangle},
  ];
  return <>
    <PlatformHeading eyebrow="Resumen" title="Dashboard" description="Vista operativa global de ValoraCloud." />
    <section className="platform-metric-grid">
      {cards.map((card) => <article className="platform-metric" key={card.label}>
        <span><AppIcon icon={card.icon} size={20} /></span><strong>{card.value}</strong><h2>{card.label}</h2><p>{card.detail}</p>
      </article>)}
    </section>
    <section className="platform-callout"><AppIcon icon={ShieldCheck} size={24} /><div><strong>Autoridad separada del ERP</strong><p>Las consultas y acciones globales se ejecutan mediante Functions y no conceden acceso SDK a datos empresariales.</p></div></section>
  </>;
}

function BusinessesTable({
  businesses,
  emptyText = "No hay empresas para mostrar.",
  verificationOnly = false,
}) {
  const navigate = useNavigate();
  if (!businesses.length) return <div className="platform-empty">{emptyText}</div>;
  return <div className="platform-table-wrap"><table className="platform-table">
    <thead><tr><th>Empresa</th><th>País</th><th>Usuarios</th><th>Estado</th><th>Verificación</th><th>{verificationOnly ? "Solicitud" : "Registro"}</th></tr></thead>
    <tbody>{businesses.map((business) => <tr key={business.id} tabIndex="0" onClick={() => navigate(`/admin/empresas/${business.id}`)} onKeyDown={(event) => event.key === "Enter" && navigate(`/admin/empresas/${business.id}`)}>
      <td><strong>{business.nombreComercial}</strong><small>{business.propietario?.correo || "Propietario sin correo"}</small></td>
      <td>{countryName(business.paisCodigo)}</td><td>{business.usuarios}</td>
      <td><StatusBadge variant={stateVariant(business.estado)}>{business.estado}</StatusBadge></td>
      <td><StatusBadge variant={verificationVariant(business.verificacion)}>{VERIFICATION_LABELS[business.verificacion] || business.verificacion}</StatusBadge></td><td>{date(verificationOnly ? business.fechaSolicitud : business.fechaRegistro)}</td>
    </tr>)}</tbody>
  </table></div>;
}

function PlatformListFilters({
  draft,
  onChange,
  onReset,
  onSelectorChange,
  onSubmit,
  type,
}) {
  const verificationOnly = type === "verifications";
  const users = type === "users";
  return <form className="platform-filters" onSubmit={onSubmit}>
    <label className="platform-filters__search">
      <span>Buscar</span>
      <input
        type="search"
        value={draft.search}
        placeholder={users ? "Nombre, correo o UID" : verificationOnly ? "Empresa, correo, ID o identificación fiscal" : "Empresa, razón social, correo o ID"}
        onChange={(event) => onChange({...draft, search: event.target.value})}
      />
    </label>
    {!users && <label><span>País</span><select value={draft.country} onChange={(event) => onSelectorChange({...draft, country: event.target.value})}>
      <option value="TODOS">Todos</option>
      {COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
    </select></label>}
    {!users && !verificationOnly && <label><span>Estado</span><select value={draft.state} onChange={(event) => onSelectorChange({...draft, state: event.target.value})}>
      <option value="TODOS">Todos</option><option value="ACTIVA">Activa</option><option value="SUSPENDIDA">Suspendida</option><option value="ELIMINADA">Eliminada</option>
    </select></label>}
    {!users && <label><span>Verificación</span><select value={draft.verification} onChange={(event) => onSelectorChange({...draft, verification: event.target.value})}>
      <option value="TODAS">Todas</option><option value="PENDIENTE">Pendiente</option><option value="VERIFICADA">Verificada</option><option value="RECHAZADA">Rechazada</option><option value="NO_VERIFICADA">No verificada</option>
    </select></label>}
    {users && <label><span>Estado</span><select value={draft.state} onChange={(event) => onSelectorChange({...draft, state: event.target.value})}>
      <option value="TODOS">Todos</option><option value="ACTIVO">Activo</option><option value="SUSPENDIDO">Suspendido</option>
    </select></label>}
    {users && <label><span>Empresa</span><select value={draft.company} onChange={(event) => onSelectorChange({...draft, company: event.target.value})}>
      <option value="TODAS">Todas las cuentas</option><option value="CON_EMPRESA">Con empresa</option><option value="SIN_EMPRESA">Sin empresa</option>
    </select></label>}
    <div className="platform-filters__actions"><Button type="submit">Buscar</Button><Button type="button" variant="secondary" onClick={onReset}>Limpiar</Button></div>
  </form>;
}

export function PlatformBusinessesPage({verificationOnly = false}) {
  const location = useLocation();
  const initialFilters = React.useMemo(() => ({
    search: "",
    country: "TODOS",
    state: "TODOS",
    verification: verificationOnly ? "PENDIENTE" : "TODAS",
  }), [verificationOnly]);
  const [draft, setDraft] = React.useState(initialFilters);
  const [filters, setFilters] = React.useState(initialFilters);
  const [state, setState] = React.useState({loading: true, items: [], cursor: null, error: ""});
  const load = React.useCallback(async (cursor = "", append = false) => {
    setState((current) => ({...current, loading: true, error: ""}));
    try {
      const data = await listPlatformBusinesses({
        cursor,
        search: filters.search,
        country: filters.country,
        state: filters.state,
        verification: filters.verification,
        mode: verificationOnly ? "VERIFICACIONES" : "EMPRESAS",
      });
      setState((current) => ({loading: false, items: append ? [...current.items, ...data.empresas] : data.empresas, cursor: data.cursor, error: ""}));
    } catch (error) {
      setState((current) => ({...current, loading: false, error: message(error, "No pudimos cargar las empresas.")}));
    }
  }, [filters, verificationOnly]);
  React.useEffect(() => { load(); }, [load]);
  const applyFilters = (event) => {
    event.preventDefault();
    setFilters({...draft, search: draft.search.trim()});
  };
  const applySelector = (nextFilters) => {
    setDraft(nextFilters);
    setFilters({...nextFilters, search: nextFilters.search.trim()});
  };
  const resetFilters = () => {
    setDraft({...initialFilters});
    setFilters({...initialFilters});
  };
  return <>
    <PlatformHeading eyebrow="Clientes de ValoraCloud" title={verificationOnly ? "Verificaciones" : "Empresas"} description={verificationOnly ? "Solicitudes pendientes de revision por la plataforma." : "Directorio global de empresas registradas."} action={<Button variant="secondary" icon={RefreshCw} onClick={() => load()}>Actualizar</Button>} />
    {location.state?.platformNotice && <div className="platform-notice" role="status">{location.state.platformNotice}</div>}
    <PlatformListFilters draft={draft} onChange={setDraft} onReset={resetFilters} onSelectorChange={applySelector} onSubmit={applyFilters} type={verificationOnly ? "verifications" : "businesses"} />
    {state.error && <ErrorState error={state.error} retry={() => load()} />}
    {!state.error && state.loading && !state.items.length && <Loading />}
    {!state.error && Boolean(state.items.length || !state.loading) && <BusinessesTable businesses={state.items} verificationOnly={verificationOnly} emptyText={verificationOnly ? "No hay verificaciones para los filtros seleccionados." : undefined} />}
    {state.cursor && <div className="platform-load-more"><Button variant="secondary" disabled={state.loading} onClick={() => load(state.cursor, true)}>{state.loading ? "Cargando..." : "Cargar mas"}</Button></div>}
  </>;
}

function DetailGrid({items}) {
  return <dl className="platform-detail-grid">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value || "Sin registro"}</dd></div>)}</dl>;
}

export function PlatformBusinessDetailPage() {
  const {businessId} = useParams();
  const navigate = useNavigate();
  const [state, setState] = React.useState({loading: true, data: null, error: ""});
  const [reason, setReason] = React.useState("");
  const [rejectionReason, setRejectionReason] = React.useState("");
  const [officialLegalName, setOfficialLegalName] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = React.useState("");
  const [deleteError, setDeleteError] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const requestRef = React.useRef("");
  const deleteRequestRef = React.useRef("");
  const deleteInputRef = React.useRef(null);
  const load = React.useCallback(() => {
    setState((current) => ({...current, loading: true, error: ""}));
    getPlatformBusiness(businessId).then((data) => setState({loading: false, data, error: ""}))
      .catch((error) => setState({loading: false, data: null, error: message(error, "No pudimos cargar la empresa.")}));
  }, [businessId]);
  React.useEffect(load, [load]);
  const run = async (prefix, operation) => {
    setWorking(true); setNotice("");
    try {
      if (!requestRef.current) requestRef.current = createPlatformRequestId(prefix);
      await operation(requestRef.current);
      requestRef.current = "";
      setReason("");
      setRejectionReason("");
      setOfficialLegalName("");
      setNotice("Accion aplicada correctamente.");
      load();
    } catch (error) {
      setNotice(message(error, "No pudimos completar la accion."));
    } finally { setWorking(false); }
  };
  const loadEvidence = async () => {
    setNotice("");
    const popup = window.open("", "_blank");
    if (!popup) {
      setNotice("El navegador bloqueó la nueva pestaña. Habilita las ventanas emergentes e inténtalo nuevamente.");
      return;
    }
    popup.opener = null;
    try {
      const document = await getPlatformVerificationDocument(
        businessId,
        state.data.solicitudActual.id
      );
      popup.location.replace(document.url);
    } catch {
      popup.close();
      setNotice("No pudimos abrir el documento de respaldo.");
    }
  };
  const deleteBusiness = async () => {
    setDeleting(true); setDeleteError(""); setNotice("");
    try {
      if (!deleteRequestRef.current) {
        deleteRequestRef.current = createPlatformRequestId("delete_business");
      }
      await permanentlyDeletePlatformBusiness({
        businessId,
        confirmationName: deleteConfirmation,
        requestId: deleteRequestRef.current,
      });
      navigate("/admin/empresas", {
        replace: true,
        state: {platformNotice: "Empresa eliminada permanentemente."},
      });
    } catch (error) {
      setDeleteError(destructiveMessage(error));
    } finally {
      setDeleting(false);
    }
  };
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState error={state.error} retry={load} />;
  const {empresa, propietario, miembros, solicitudActual, eventos} = state.data;
  const pending = empresa.verificacion?.estado === "PENDIENTE" && solicitudActual;
  const verified = empresa.verificacion?.estado === "VERIFICADA";
  const verificationLabel = VERIFICATION_LABELS[empresa.verificacion?.estado] ||
    empresa.verificacion?.estado || "Empresa no verificada";
  return <>
    <button className="platform-back" type="button" onClick={() => navigate(-1)}><AppIcon icon={ChevronLeft} size={18} />Volver</button>
    <PlatformHeading eyebrow="Empresa" title={empresa.nombreComercial || "Empresa sin nombre"} description={<span className="platform-business-heading-meta"><span>{propietario?.correo || "Propietario sin correo"}</span><span>{countryName(empresa.paisCodigo)} · {verificationLabel}</span><small>ID: {empresa.id}</small></span>} action={<StatusBadge variant={stateVariant(empresa.estado)}>{empresa.estado}</StatusBadge>} />
    {notice && <div className="platform-notice" role="status">{notice}</div>}
    <section className="platform-panel"><h2>Datos de la empresa</h2><DetailGrid items={[
      {label: "País", value: countryName(empresa.paisCodigo)},
      {label: "Correo empresa", value: empresa.email},
      {label: "Teléfono", value: empresa.telefono},
      {label: "Fecha de registro", value: date(empresa.fechaRegistro)},
      ...(verified ? [
        {label: "Razón social oficial", value: empresa.razonSocial},
        {label: fiscalFieldLabel(empresa.identificadorFiscalTipo, "confirmado"), value: fiscalIdentifier(empresa.paisCodigo, empresa.identificadorFiscalValor)},
      ] : []),
    ]} />
      {empresa.estado === "activo" ? <div className="platform-action-form"><label>Motivo de suspension<textarea rows="2" value={reason} onChange={(event) => {setReason(event.target.value); requestRef.current = "";}} /></label><Button variant="danger" disabled={working || !reason.trim()} onClick={() => run("suspend_business", (requestId) => setPlatformBusinessStatus({businessId, estado: "suspendida", motivo: reason, requestId}))}>Suspender empresa</Button></div> : empresa.estado === "suspendida" ? <Button disabled={working} onClick={() => run("reactivate_business", (requestId) => setPlatformBusinessStatus({businessId, estado: "activo", motivo: "", requestId}))}>Reactivar empresa</Button> : null}
    </section>
    <section className="platform-panel"><h2>Verificación empresarial</h2>
      <div className="platform-verification-summary"><StatusBadge variant={verificationVariant(empresa.verificacion?.estado)}>{verificationLabel}</StatusBadge>{solicitudActual && <span>{date(solicitudActual.solicitadoEn)}</span>}</div>
      {solicitudActual && <DetailGrid items={[
        {label: fiscalFieldLabel(solicitudActual.identificadorFiscalTipo, "declarado"), value: fiscalIdentifier(solicitudActual.paisCodigo, solicitudActual.identificadorFiscalValor)},
        {label: "Relación o cargo", value: solicitudActual.relacionSolicitante},
        {label: "Correo del solicitante", value: solicitudActual.correoSolicitante},
        {label: "Teléfono del solicitante", value: solicitudActual.telefonoSolicitante},
        {label: "Observaciones", value: solicitudActual.observaciones},
      ]} />}
      {solicitudActual?.documentoAcreditativo && <div className="platform-evidence"><span>Documento de respaldo: {solicitudActual.documentoAcreditativo.nombreOriginal || "Documento adjunto"}</span><Button variant="secondary" onClick={loadEvidence}>Ver documento</Button></div>}
      {pending && <div className="platform-verification-actions">
        <label>Razón social oficial<input required value={officialLegalName} onChange={(event) => {setOfficialLegalName(event.target.value); requestRef.current = "";}} /></label>
        <Button icon={CheckCircle2} disabled={working || !officialLegalName.trim()} onClick={() => run("approve_verification", (requestId) => resolvePlatformVerification({businessId, solicitudId: solicitudActual.id, decision: "APROBAR", motivo: "", razonSocialOficial: officialLegalName.trim(), requestId}))}>Aprobar</Button>
        <label>Motivo de rechazo<textarea rows="2" value={rejectionReason} onChange={(event) => {setRejectionReason(event.target.value); requestRef.current = "";}} /></label>
        <Button variant="danger" disabled={working || !rejectionReason.trim()} onClick={() => run("reject_verification", (requestId) => resolvePlatformVerification({businessId, solicitudId: solicitudActual.id, decision: "RECHAZAR", motivo: rejectionReason.trim(), razonSocialOficial: "", requestId}))}>Rechazar</Button>
      </div>}
    </section>
    <section className="platform-panel"><h2>Miembros ({miembros.length})</h2><div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Usuario</th><th>Correo</th><th>Perfil</th><th>Estado</th></tr></thead><tbody>{miembros.map((member) => <tr key={member.uid} onClick={() => navigate(`/admin/usuarios/${member.uid}`)}><td>{member.nombre}</td><td>{member.correo}</td><td>{BUSINESS_ROLE_LABELS[member.rol] || member.rol}</td><td>{member.estado}</td></tr>)}</tbody></table></div></section>
    <section className="platform-panel"><h2>Historial</h2>{eventos.length ? <ol className="platform-timeline">{eventos.map((event) => <li key={`${event.origen}-${event.id}`}><span>{event.origen}</span><strong>{event.tipo}</strong><p>{event.estadoAnterior && `${event.estadoAnterior} → `}{event.estadoResultante}{event.motivo && ` · ${event.motivo}`}</p><time>{date(event.creadoEn)}</time></li>)}</ol> : <div className="platform-empty">Sin eventos registrados.</div>}</section>
    <section className="platform-panel platform-danger-zone"><div><h2>Zona de peligro</h2><p>Esta acción elimina permanentemente la empresa y todos sus datos exclusivos. Los usuarios de Auth no se eliminan.</p></div><Button variant="danger" icon={Trash2} onClick={() => {setDeleteConfirmation(""); setDeleteError(""); deleteRequestRef.current = ""; setDeleteOpen(true);}}>Eliminar empresa permanentemente</Button></section>
    <ResponsiveDialog
      open={deleteOpen}
      title="Eliminar empresa permanentemente"
      description="Esta acción no se puede deshacer. Escribe el nombre comercial exacto para continuar."
      initialFocusRef={deleteInputRef}
      onClose={() => !deleting && setDeleteOpen(false)}
      footer={<><Button variant="secondary" disabled={deleting} onClick={() => setDeleteOpen(false)}>Cancelar</Button><Button variant="danger" icon={Trash2} disabled={deleting || deleteConfirmation !== empresa.nombreComercial} onClick={deleteBusiness}>{deleting ? "Eliminando..." : "Eliminar permanentemente"}</Button></>}
    >
      <div className="platform-delete-confirmation"><p>Nombre comercial: <strong>{empresa.nombreComercial}</strong></p><label>Confirmación<input ref={deleteInputRef} value={deleteConfirmation} autoComplete="off" onChange={(event) => {setDeleteConfirmation(event.target.value); setDeleteError(""); deleteRequestRef.current = "";}} /></label>{deleteError && <div className="platform-delete-error" role="alert">{deleteError}</div>}</div>
    </ResponsiveDialog>
  </>;
}

export function PlatformUsersPage() {
  const navigate = useNavigate();
  const initialFilters = React.useMemo(() => ({
    search: "",
    state: "TODOS",
    company: "TODAS",
  }), []);
  const [draft, setDraft] = React.useState(initialFilters);
  const [filters, setFilters] = React.useState(initialFilters);
  const [state, setState] = React.useState({loading: true, items: [], cursor: null, error: ""});
  const load = React.useCallback(async (cursor = "", append = false) => {
    setState((current) => ({...current, loading: true, error: ""}));
    try {
      const data = await listPlatformUsers({cursor, ...filters});
      setState((current) => ({loading: false, items: append ? [...current.items, ...data.usuarios] : data.usuarios, cursor: data.cursor, error: ""}));
    } catch (error) { setState((current) => ({...current, loading: false, error: message(error, "No pudimos cargar los usuarios.")})); }
  }, [filters]);
  React.useEffect(() => { load(); }, [load]);
  const applyFilters = (event) => {
    event.preventDefault();
    setFilters({...draft, search: draft.search.trim()});
  };
  const applySelector = (nextFilters) => {
    setDraft(nextFilters);
    setFilters({...nextFilters, search: nextFilters.search.trim()});
  };
  const resetFilters = () => {
    setDraft({...initialFilters});
    setFilters({...initialFilters});
  };
  return <><PlatformHeading eyebrow="Clientes de ValoraCloud" title="Usuarios" description="Directorio global de cuentas y membresias." action={<Button variant="secondary" icon={RefreshCw} onClick={() => load()}>Actualizar</Button>} />
    <PlatformListFilters draft={draft} onChange={setDraft} onReset={resetFilters} onSelectorChange={applySelector} onSubmit={applyFilters} type="users" />
    {state.error && <ErrorState error={state.error} retry={() => load()} />}{state.loading && !state.items.length && <Loading />}
    {!state.error && Boolean(state.items.length || !state.loading) && <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Usuario</th><th>Correo</th><th>Empresas</th><th>Estado</th><th>Fecha alta</th><th>Ultimo acceso</th></tr></thead><tbody>{state.items.map((user) => <tr key={user.uid} onClick={() => navigate(`/admin/usuarios/${user.uid}`)}><td><strong>{user.nombre}</strong><small>{user.uid}</small></td><td>{user.correo}</td><td>{user.empresas}</td><td><StatusBadge variant={stateVariant(user.estado)}>{user.estado}</StatusBadge></td><td>{date(user.fechaAlta)}</td><td>{date(user.ultimoAcceso)}</td></tr>)}</tbody></table></div>}
    {state.cursor && <div className="platform-load-more"><Button variant="secondary" disabled={state.loading} onClick={() => load(state.cursor, true)}>Cargar mas</Button></div>}
  </>;
}

export function PlatformUserDetailPage() {
  const {uid} = useParams(); const navigate = useNavigate();
  const [state, setState] = React.useState({loading: true, data: null, error: ""});
  const [reason, setReason] = React.useState(""); const [working, setWorking] = React.useState(false); const [notice, setNotice] = React.useState("");
  const requestRef = React.useRef("");
  const load = React.useCallback(() => { setState((current) => ({...current, loading: true, error: ""})); getPlatformUser(uid).then((data) => setState({loading: false, data, error: ""})).catch((error) => setState({loading: false, data: null, error: message(error, "No pudimos cargar el usuario.")})); }, [uid]);
  React.useEffect(load, [load]);
  const changeStatus = async (estado) => { setWorking(true); setNotice(""); try { if (!requestRef.current) requestRef.current = createPlatformRequestId(`${estado}_user`); await setPlatformUserStatus({uid, estado, motivo: estado === "suspendido" ? reason : "", requestId: requestRef.current}); requestRef.current = ""; setReason(""); setNotice("Estado actualizado correctamente."); load(); } catch (error) { setNotice(message(error, "No pudimos actualizar el usuario.")); } finally { setWorking(false); } };
  if (state.loading && !state.data) return <Loading />; if (state.error) return <ErrorState error={state.error} retry={load} />;
  const {usuario, membresias, eventos} = state.data;
  return <><button className="platform-back" type="button" onClick={() => navigate(-1)}><AppIcon icon={ChevronLeft} size={18} />Volver</button><PlatformHeading eyebrow="Usuario" title={usuario.nombre} description={usuario.correo} action={<StatusBadge variant={stateVariant(usuario.estado)}>{usuario.estado}</StatusBadge>} />
    {notice && <div className="platform-notice" role="status">{notice}</div>}
    <div className="platform-detail-columns"><section className="platform-panel"><h2>Cuenta</h2><DetailGrid items={[{label: "UID", value: usuario.uid}, {label: "Correo", value: usuario.correo}, {label: "Estado", value: usuario.estado}, {label: "Fecha alta", value: date(usuario.fechaAlta)}, {label: "Ultimo acceso", value: date(usuario.ultimoAcceso)}]} /></section>
      <section className="platform-panel"><h2>Control de acceso</h2>{usuario.estado === "activo" ? <div className="platform-action-form"><label>Motivo de suspension<textarea rows="2" value={reason} onChange={(event) => {setReason(event.target.value); requestRef.current = "";}} /></label><Button variant="danger" disabled={working || !reason.trim()} onClick={() => changeStatus("suspendido")}>Suspender usuario</Button></div> : <Button disabled={working} onClick={() => changeStatus("activo")}>Reactivar usuario</Button>}<p className="platform-help">La suspension deshabilita Auth y el acceso ERP sin borrar membresias ni historicos.</p></section></div>
    <section className="platform-panel"><h2>Membresias ({membresias.length})</h2>{membresias.length ? <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Empresa</th><th>Rol</th><th>Estado</th><th>Ingreso</th></tr></thead><tbody>{membresias.map((membership) => <tr key={membership.negocioId} onClick={() => navigate(`/admin/empresas/${membership.negocioId}`)}><td>{membership.empresa}</td><td>{membership.rol}</td><td>{membership.estado}</td><td>{date(membership.fechaIncorporacion)}</td></tr>)}</tbody></table></div> : <div className="platform-empty">El usuario no posee membresias.</div>}</section>
    <section className="platform-panel"><h2>Eventos de plataforma</h2>{eventos.length ? <ol className="platform-timeline">{eventos.map((event) => <li key={event.id}><span>USUARIO</span><strong>{event.tipo}</strong><p>{event.estadoAnterior} → {event.estadoResultante}</p><time>{date(event.creadoEn)}</time></li>)}</ol> : <div className="platform-empty">Sin eventos registrados.</div>}</section>
  </>;
}

export const platformAdminIcons = {Building2, ShieldCheck, UserRound, Users};
