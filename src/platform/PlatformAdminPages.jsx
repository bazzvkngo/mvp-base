import React from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import {useNavigate, useParams} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import StatusBadge from "../components/ui/StatusBadge";
import {
  createPlatformRequestId,
  getPlatformBusiness,
  getPlatformSummary,
  getPlatformUser,
  getPlatformVerificationDocument,
  listPlatformBusinesses,
  listPlatformUsers,
  resolvePlatformVerification,
  setPlatformBusinessStatus,
  setPlatformUserStatus,
} from "../services/platformAdminService";

const VERIFICATION_LABELS = {
  NO_VERIFICADA: "No verificada",
  PENDIENTE: "Pendiente",
  VERIFICADA: "Verificada",
  RECHAZADA: "Rechazada",
};

function message(error, fallback) {
  const code = String(error?.code || "");
  if (code.includes("permission-denied")) return "No tienes autorizacion para esta accion.";
  if (code.includes("already-exists")) return "La identidad fiscal ya pertenece a otra empresa verificada.";
  if (code.includes("failed-precondition")) return error?.message || "La operacion no esta disponible.";
  return fallback;
}

function date(value) {
  if (!value) return "Sin registro";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Sin registro" :
    new Intl.DateTimeFormat("es-CL", {dateStyle: "medium", timeStyle: "short"}).format(parsed);
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
    <div><span>{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>
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

function BusinessesTable({businesses, emptyText = "No hay empresas para mostrar."}) {
  const navigate = useNavigate();
  if (!businesses.length) return <div className="platform-empty">{emptyText}</div>;
  return <div className="platform-table-wrap"><table className="platform-table">
    <thead><tr><th>Empresa</th><th>Pais</th><th>Propietario</th><th>Usuarios</th><th>Estado</th><th>Verificacion</th><th>Registro</th></tr></thead>
    <tbody>{businesses.map((business) => <tr key={business.id} tabIndex="0" onClick={() => navigate(`/admin/empresas/${business.id}`)} onKeyDown={(event) => event.key === "Enter" && navigate(`/admin/empresas/${business.id}`)}>
      <td><strong>{business.nombreComercial}</strong><small>{business.id}</small></td>
      <td>{business.paisCodigo}</td><td>{business.propietario?.nombre || "Sin propietario"}<small>{business.propietario?.correo}</small></td><td>{business.usuarios}</td>
      <td><StatusBadge variant={stateVariant(business.estado)}>{business.estado}</StatusBadge></td>
      <td><StatusBadge variant={verificationVariant(business.verificacion)}>{VERIFICATION_LABELS[business.verificacion] || business.verificacion}</StatusBadge></td><td>{date(business.fechaRegistro)}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function PlatformBusinessesPage({verificationOnly = false}) {
  const [state, setState] = React.useState({loading: true, items: [], cursor: null, error: ""});
  const verification = verificationOnly ? "PENDIENTE" : "TODAS";
  const load = React.useCallback(async (cursor = "", append = false) => {
    setState((current) => ({...current, loading: true, error: ""}));
    try {
      const data = await listPlatformBusinesses({cursor, verification});
      setState((current) => ({loading: false, items: append ? [...current.items, ...data.empresas] : data.empresas, cursor: data.cursor, error: ""}));
    } catch (error) {
      setState((current) => ({...current, loading: false, error: message(error, "No pudimos cargar las empresas.")}));
    }
  }, [verification]);
  React.useEffect(() => { load(); }, [load]);
  return <>
    <PlatformHeading eyebrow="Clientes de ValoraCloud" title={verificationOnly ? "Verificaciones" : "Empresas"} description={verificationOnly ? "Solicitudes pendientes de revision por la plataforma." : "Directorio global de empresas registradas."} action={<Button variant="secondary" icon={RefreshCw} onClick={() => load()}>Actualizar</Button>} />
    {state.error && <ErrorState error={state.error} retry={() => load()} />}
    {!state.error && state.loading && !state.items.length && <Loading />}
    {!state.error && Boolean(state.items.length || !state.loading) && <BusinessesTable businesses={state.items} emptyText={verificationOnly ? "No hay verificaciones pendientes." : undefined} />}
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
  const [working, setWorking] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [evidence, setEvidence] = React.useState(null);
  const requestRef = React.useRef("");
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
      requestRef.current = ""; setReason(""); setRejectionReason(""); setNotice("Accion aplicada correctamente."); load();
    } catch (error) {
      setNotice(message(error, "No pudimos completar la accion."));
    } finally { setWorking(false); }
  };
  const loadEvidence = async () => {
    setWorking(true); setNotice("");
    try {
      setEvidence(await getPlatformVerificationDocument(businessId, state.data.solicitudActual.id));
    } catch (error) {
      setNotice(message(error, "No pudimos abrir el documento acreditativo."));
    } finally { setWorking(false); }
  };
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState error={state.error} retry={load} />;
  const {empresa, propietario, miembros, solicitudActual, eventos} = state.data;
  const pending = empresa.verificacion?.estado === "PENDIENTE" && solicitudActual;
  return <>
    <button className="platform-back" type="button" onClick={() => navigate(-1)}><AppIcon icon={ChevronLeft} size={18} />Volver</button>
    <PlatformHeading eyebrow="Empresa" title={empresa.nombreComercial || "Empresa sin nombre"} description={`ID: ${empresa.id}`} action={<StatusBadge variant={stateVariant(empresa.estado)}>{empresa.estado}</StatusBadge>} />
    {notice && <div className="platform-notice" role="status">{notice}</div>}
    <div className="platform-detail-columns">
      <section className="platform-panel"><h2>Datos legales</h2><DetailGrid items={[
        {label: "Razon social", value: empresa.razonSocial}, {label: "Pais", value: empresa.paisCodigo},
        {label: empresa.identificadorFiscalTipo || "Identificacion fiscal", value: empresa.identificadorFiscalValor},
        {label: "Correo", value: empresa.email}, {label: "Telefono", value: empresa.telefono}, {label: "Fecha de registro", value: date(empresa.fechaRegistro)},
      ]} /></section>
      <section className="platform-panel"><h2>Propietario y estado</h2><DetailGrid items={[
        {label: "Propietario", value: propietario?.nombre}, {label: "Correo", value: propietario?.correo},
        {label: "Estado", value: empresa.estado}, {label: "Verificacion", value: VERIFICATION_LABELS[empresa.verificacion?.estado] || empresa.verificacion?.estado},
      ]} />
      {empresa.estado === "activo" ? <div className="platform-action-form"><label>Motivo de suspension<textarea rows="2" value={reason} onChange={(event) => {setReason(event.target.value); requestRef.current = "";}} /></label><Button variant="danger" disabled={working || !reason.trim()} onClick={() => run("suspend_business", (requestId) => setPlatformBusinessStatus({businessId, estado: "suspendida", motivo: reason, requestId}))}>Suspender empresa</Button></div> : empresa.estado === "suspendida" ? <Button disabled={working} onClick={() => run("reactivate_business", (requestId) => setPlatformBusinessStatus({businessId, estado: "activo", motivo: "", requestId}))}>Reactivar empresa</Button> : null}
      </section>
    </div>
    <section className="platform-panel"><h2>Verificacion empresarial</h2>
      <div className="platform-verification-summary"><StatusBadge variant={verificationVariant(empresa.verificacion?.estado)}>{VERIFICATION_LABELS[empresa.verificacion?.estado] || empresa.verificacion?.estado}</StatusBadge>{solicitudActual && <span>Solicitada por {solicitudActual.solicitadoPorUid} · {date(solicitudActual.solicitadoEn)}</span>}</div>
      {solicitudActual?.documentoAcreditativo && <div className="platform-evidence">{evidence ? <a className="ui-button ui-button--secondary" href={evidence.url} target="_blank" rel="noreferrer">Abrir {evidence.nombre}</a> : <Button variant="secondary" disabled={working} onClick={loadEvidence}>Generar acceso temporal al documento</Button>}</div>}
      {pending && <div className="platform-verification-actions"><Button icon={CheckCircle2} disabled={working} onClick={() => run("approve_verification", (requestId) => resolvePlatformVerification({businessId, solicitudId: solicitudActual.id, decision: "APROBAR", motivo: "", requestId}))}>Aprobar</Button><label>Motivo de rechazo<textarea rows="2" value={rejectionReason} onChange={(event) => {setRejectionReason(event.target.value); requestRef.current = "";}} /></label><Button variant="danger" disabled={working || !rejectionReason.trim()} onClick={() => run("reject_verification", (requestId) => resolvePlatformVerification({businessId, solicitudId: solicitudActual.id, decision: "RECHAZAR", motivo: rejectionReason, requestId}))}>Rechazar</Button></div>}
    </section>
    <section className="platform-panel"><h2>Miembros ({miembros.length})</h2><div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th></tr></thead><tbody>{miembros.map((member) => <tr key={member.uid} onClick={() => navigate(`/admin/usuarios/${member.uid}`)}><td>{member.nombre}</td><td>{member.correo}</td><td>{member.rol}</td><td>{member.estado}</td></tr>)}</tbody></table></div></section>
    <section className="platform-panel"><h2>Eventos basicos</h2>{eventos.length ? <ol className="platform-timeline">{eventos.map((event) => <li key={`${event.origen}-${event.id}`}><span>{event.origen}</span><strong>{event.tipo}</strong><p>{event.estadoAnterior && `${event.estadoAnterior} → `}{event.estadoResultante}{event.motivo && ` · ${event.motivo}`}</p><time>{date(event.creadoEn)}</time></li>)}</ol> : <div className="platform-empty">Sin eventos registrados.</div>}</section>
  </>;
}

export function PlatformUsersPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({loading: true, items: [], cursor: null, error: ""});
  const load = React.useCallback(async (cursor = "", append = false) => {
    setState((current) => ({...current, loading: true, error: ""}));
    try {
      const data = await listPlatformUsers({cursor});
      setState((current) => ({loading: false, items: append ? [...current.items, ...data.usuarios] : data.usuarios, cursor: data.cursor, error: ""}));
    } catch (error) { setState((current) => ({...current, loading: false, error: message(error, "No pudimos cargar los usuarios.")})); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  return <><PlatformHeading eyebrow="Clientes de ValoraCloud" title="Usuarios" description="Directorio global de cuentas y membresias." action={<Button variant="secondary" icon={RefreshCw} onClick={() => load()}>Actualizar</Button>} />
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
