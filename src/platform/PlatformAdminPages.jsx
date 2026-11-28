import React from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import {Link, useLocation, useNavigate, useOutletContext, useParams} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import LoadingState from "../components/ui/LoadingState";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import Skeleton, {SkeletonRegion} from "../components/ui/Skeleton";
import Notice from "../components/ui/Notice";
import StatusBadge from "../components/ui/StatusBadge";
import AccountRecoveryPanel from "./AccountRecoveryPanel";
import VerificationDecisionDialog from "./VerificationDecisionDialog";
import {userEventSummary} from "./accountRecovery.mjs";
import {INITIAL_DECISION_STATE, confirmDecision, decisionReducer} from "./verificationDecision.mjs";
import {MODULES_EVENT_TYPE, moduleEventSummary} from "./platformModuleEvents.mjs";
import {COUNTRIES, getCountryByCode} from "../domain/businessCatalog";
import {formatFiscalIdentifierForDisplay} from "../domain/fiscalIdentifier.mjs";
import {isSameListState, mergeRefreshedFirstPage} from "../domain/listRefresh.mjs";
import {REFRESH_INTERVAL_MS} from "../domain/visiblePolling.mjs";
import useVisiblePolling from "../hooks/useVisiblePolling";
import {BUSINESS_ROLE_LABELS} from "../domain/rbac.mjs";
import {
  createPlatformRequestId,
  getPlatformBusiness,
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

const PLATFORM_STATE_LABELS = {
  activa: "Activa",
  activo: "Activo",
  eliminada: "Eliminada",
  eliminado: "Eliminado",
  suspendida: "Suspendida",
  suspendido: "Suspendido",
  NO_VERIFICADA: "No verificada",
  PENDIENTE: "En revisión",
  VERIFICADA: "Verificada",
  RECHAZADA: "Rechazada",
};

const PLATFORM_EVENT_LABELS = {
  VERIFICACION_SOLICITADA: "Solicitud de verificación enviada",
  VERIFICACION_APROBADA: "Verificación aprobada",
  VERIFICACION_RECHAZADA: "Verificación rechazada",
  VERIFICACION_INVALIDADA: "Verificación invalidada",
  EMPRESA_SUSPENDIDA: "Empresa suspendida",
  EMPRESA_REACTIVADA: "Empresa reactivada",
  USUARIO_SUSPENDIDO: "Usuario suspendido",
  USUARIO_REACTIVADO: "Usuario reactivado",
  USUARIO_RESTABLECIMIENTO_ENVIADO: "Enlace de restablecimiento enviado",
  USUARIO_CORREO_CAMBIADO: "Correo cambiado",
  USUARIO_PERFIL_EDITADO: "Datos del usuario editados",
  modulos_actualizados: "Módulos actualizados",
};

function humanizeToken(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Sin registro";
  const text = raw.replaceAll("_", " ").toLocaleLowerCase("es");
  return `${text.charAt(0).toLocaleUpperCase("es")}${text.slice(1)}`;
}

function platformStateLabel(value) {
  return PLATFORM_STATE_LABELS[value] || humanizeToken(value);
}

function platformEventLabel(value) {
  return PLATFORM_EVENT_LABELS[value] || humanizeToken(value);
}

function platformOriginLabel(value) {
  return value === "VERIFICACION" ? "Verificación" : value === "PLATAFORMA" ? "Plataforma" : humanizeToken(value);
}

// Identidad principal de una cuenta: el nombre si existe y, si no, el correo.
function personIdentity(name, email) {
  const normalizedName = String(name || "").trim();
  if (normalizedName && normalizedName !== "Sin nombre registrado") return normalizedName;
  return String(email || "").trim() || "Nombre no informado";
}

const NO_RECORD = "Sin registro";

// "Sin registro" en tono tenue; cualquier otro valor se muestra tal cual.
function RecordValue({value}) {
  if (!value || value === NO_RECORD) return <span className="platform-no-record">{NO_RECORD}</span>;
  return value;
}

function CopyIdButton({value, label = "Copiar ID de usuario"}) {
  const [copied, setCopied] = React.useState(false);
  const copy = async (event) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return <Button
    variant="ghost"
    className="platform-copy-id"
    aria-label={label}
    onClick={copy}
    onKeyDown={(event) => event.stopPropagation()}
  >{copied ? "ID copiado" : "Copiar ID"}</Button>;
}

function message(error, fallback) {
  const code = String(error?.code || "");
  if (code.includes("permission-denied")) return "No tienes autorización para esta acción.";
  if (code.includes("already-exists")) return "La identidad fiscal ya pertenece a otra empresa verificada.";
  if (code.includes("failed-precondition")) return error?.message || "La operación no está disponible.";
  return fallback;
}

// Código corto del error (p. ej. "permission-denied") para soporte; sin el
// prefijo "functions/" ni texto libre del servidor.
function evidenceErrorCode(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  return /^[a-z0-9-]{1,40}$/.test(code) ? code : "";
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
    new Intl.DateTimeFormat("es-CL", {dateStyle: "medium", timeStyle: "short", hourCycle: "h23"}).format(parsed);
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
  return <LoadingState variant="page" label="Cargando datos globales..." />;
}

function ErrorState({error, retry}) {
  return <div className="platform-state is-error"><AppIcon icon={AlertTriangle} size={24} /><p>{error}</p><Button variant="secondary" onClick={retry}>Reintentar</Button></div>;
}

function RecentBusinesses() {
  const [state, setState] = React.useState({loading: true, items: [], error: ""});
  const load = React.useCallback(() => {
    setState({loading: true, items: [], error: ""});
    listPlatformBusinesses({limit: 5})
      .then((data) => setState({loading: false, items: data.empresas || [], error: ""}))
      .catch((error) => setState({loading: false, items: [], error: message(error, "No pudimos cargar las empresas recientes.")}));
  }, []);
  React.useEffect(load, [load]);
  let body;
  if (state.loading) body = <LoadingState variant="inline" label="Cargando empresas..." />;
  else if (state.error) body = <div className="platform-empty">{state.error} <Button variant="secondary" onClick={load}>Reintentar</Button></div>;
  else if (!state.items.length) body = <div className="platform-empty">Aún no hay empresas registradas.</div>;
  else body = <ul className="platform-recent-list">{state.items.map((business) => <li key={business.id}>
    <Link to={`/admin/empresas/${business.id}`}>
      <span>{business.nombreComercial}</span>
      <StatusBadge variant={stateVariant(business.estado)}>{platformStateLabel(business.estado)}</StatusBadge>
    </Link>
  </li>)}</ul>;
  return <section className="platform-panel" aria-labelledby="platform-recent-title">
    <h2 id="platform-recent-title">Empresas recientes</h2>
    {body}
  </section>;
}

export function PlatformDashboardPage() {
  const {summary: state, reloadSummary} = useOutletContext();
  const load = React.useCallback(() => reloadSummary(true), [reloadSummary]);
  const heading = <PlatformHeading eyebrow="Resumen" title="Dashboard" description="Vista operativa global de ValoraCloud." />;
  if (state.loading && !state.data) return <>
    {heading}
    <SkeletonRegion label="Cargando datos globales...">
      <section className="platform-metric-grid">
        {[0, 1, 2, 3].map((index) => <div className="platform-metric" key={index}>
          <span><Skeleton variant="block" width={20} height={20} /></span>
          <strong><Skeleton width="40%" /></strong>
          <h2><Skeleton width="70%" /></h2>
          <p><Skeleton width="55%" /></p>
        </div>)}
      </section>
    </SkeletonRegion>
  </>;
  if (state.error && !state.data) return <ErrorState error={state.error} retry={load} />;
  const pendingVerifications = state.data.empresas.verificacionesPendientes;
  const oldestPending = state.data.verificacionesPendientesAntiguas || [];
  const cards = [
    {label: "Empresas", value: state.data.empresas.total, detail: `${state.data.empresas.activas} activas`, icon: Building2, to: "/admin/empresas"},
    {label: "Usuarios", value: state.data.usuarios.total, detail: `${state.data.usuarios.conMembresiaActiva} con membresía activa`, icon: Users, to: "/admin/usuarios"},
    {label: "Verificaciones pendientes", value: state.data.empresas.verificacionesPendientes, detail: `${state.data.empresas.verificadas} verificadas`, icon: Clock3, to: "/admin/verificaciones"},
    {label: "Suspensiones", value: state.data.empresas.suspendidas, detail: "Empresas suspendidas", icon: AlertTriangle, to: "/admin/empresas?estado=SUSPENDIDA"},
  ];
  return <>
    {heading}
    <section className="platform-metric-grid">
      {cards.map((card) => <Link className="platform-metric platform-metric--link" key={card.label} to={card.to} aria-label={`Abrir ${card.label.toLowerCase()}`}>
        <span><AppIcon icon={card.icon} size={20} /></span><strong>{card.value}</strong><h2>{card.label}</h2><p>{card.detail}</p>
      </Link>)}
    </section>
    <div className="platform-dashboard-panels">
      <section className="platform-panel" aria-labelledby="platform-pending-title">
        <h2 id="platform-pending-title">Acciones pendientes</h2>
        {pendingVerifications > 0
          ? <p className="platform-pending-action"><Link to="/admin/verificaciones">{pendingVerifications === 1 ? "1 verificación pendiente" : `${pendingVerifications} verificaciones pendientes`}</Link></p>
          : <p className="platform-pending-action">Todo al día</p>}
        {oldestPending.length > 0 && <>
          <h3 className="platform-pending-subtitle" id="platform-pending-oldest-title">Las más antiguas primero</h3>
          <ul className="platform-recent-list platform-recent-list--detailed" aria-labelledby="platform-pending-oldest-title">
            {oldestPending.map((business) => <li key={business.id}>
              <Link to={`/admin/empresas/${business.id}`}>
                <span><strong>{business.nombreComercial}</strong><small>Solicitud {date(business.fechaSolicitud)} · {business.propietario?.correo || "Propietario sin correo"}</small></span>
                <AppIcon icon={ChevronRight} size={18} />
              </Link>
            </li>)}
          </ul>
        </>}
      </section>
      <RecentBusinesses />
    </div>
  </>;
}

function BusinessesTable({
  businesses,
  emptyText = "No hay empresas para mostrar.",
  verificationOnly = false,
}) {
  const navigate = useNavigate();
  if (!businesses.length) return <div className="platform-empty">{emptyText}</div>;
  return <div className="platform-table-wrap"><table className="platform-table platform-table--clickable">
    <thead><tr><th>Empresa</th><th>País</th><th>Usuarios</th><th>Estado</th><th>Verificación</th><th>{verificationOnly ? "Solicitud" : "Registro"}</th><th className="platform-table__go"><span className="sr-only">Abrir</span></th></tr></thead>
    <tbody>{businesses.map((business) => <tr key={business.id} tabIndex="0" onClick={() => navigate(`/admin/empresas/${business.id}`)} onKeyDown={(event) => event.key === "Enter" && navigate(`/admin/empresas/${business.id}`)}>
      <td><strong>{business.nombreComercial}</strong><small className="platform-table__owner"><span className="platform-table__owner-label">Propietario</span>{business.propietario?.correo || "Propietario sin correo"}</small></td>
      <td>{countryName(business.paisCodigo)}</td><td>{business.usuarios}</td>
      <td><StatusBadge variant={stateVariant(business.estado)}>{platformStateLabel(business.estado)}</StatusBadge></td>
      <td><StatusBadge variant={verificationVariant(business.verificacion)}>{VERIFICATION_LABELS[business.verificacion] || business.verificacion}</StatusBadge></td><td><RecordValue value={date(verificationOnly ? business.fechaSolicitud : business.fechaRegistro)} /></td>
      <td className="platform-table__go" aria-hidden="true"><AppIcon icon={ChevronRight} size={18} /></td>
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
  // Filtro por cuenta: `?uid=` abre el directorio con las empresas de las que esa cuenta es propietaria.
  const requestedUid = new URLSearchParams(location.search).get("uid") || "";
  const accountUid = !verificationOnly && /^[a-zA-Z0-9_-]{1,160}$/.test(requestedUid) ? requestedUid : "";
  const initialFilters = React.useMemo(() => {
    const requestedState = new URLSearchParams(location.search).get("estado");
    return {
      search: "",
      country: "TODOS",
      state: ["ACTIVA", "SUSPENDIDA", "ELIMINADA"].includes(requestedState) ? requestedState : "TODOS",
      verification: verificationOnly ? "PENDIENTE" : "TODAS",
      uid: accountUid,
    };
  }, [accountUid, location.search, verificationOnly]);
  const [draft, setDraft] = React.useState(initialFilters);
  const [filters, setFilters] = React.useState(initialFilters);
  const [state, setState] = React.useState({loading: true, items: [], cursor: null, account: null, error: ""});
  // Si la URL cambia de cuenta (o la quita) con la página ya abierta, los filtros la siguen.
  React.useEffect(() => {
    setDraft((current) => current.uid === accountUid ? current : {...current, uid: accountUid});
    setFilters((current) => current.uid === accountUid ? current : {...current, uid: accountUid});
  }, [accountUid]);
  // Refresco silencioso (solo en Verificaciones): `loadSeq` cambia con cada carga manual para descartar
  // una respuesta silenciosa que llegue tarde; `loadedMore` recuerda si hubo "Cargar más".
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const loadSeqRef = React.useRef(0);
  const loadedMoreRef = React.useRef(false);
  const silentBusyRef = React.useRef(false);
  const load = React.useCallback(async (cursor = "", append = false) => {
    loadSeqRef.current += 1;
    loadedMoreRef.current = append;
    setState((current) => ({...current, loading: true, error: ""}));
    try {
      const data = await listPlatformBusinesses({
        cursor,
        search: filters.search,
        country: filters.country,
        state: filters.state,
        verification: filters.verification,
        uid: filters.uid,
        mode: verificationOnly ? "VERIFICACIONES" : "EMPRESAS",
      });
      setState((current) => ({loading: false, items: append ? [...current.items, ...data.empresas] : data.empresas, cursor: data.cursor, account: data.cuenta || null, error: ""}));
    } catch (error) {
      setState((current) => ({...current, loading: false, error: message(error, "No pudimos cargar las empresas.")}));
    }
  }, [filters, verificationOnly]);
  React.useEffect(() => { load(); }, [load]);
  // Una solicitud nueva aparece sin recargar: cada minuto, con la pestaña visible y al volver a ella, se pide
  // otra vez la primera página y se mezcla con lo que hay en pantalla. No toca filtros, texto escrito ni
  // diálogos; no muestra "cargando"; no hace nada si hay una carga manual en curso o un error visible; y si no
  // cambió nada no actualiza el estado (sin re-render).
  const refreshSilently = React.useCallback(async () => {
    const current = stateRef.current;
    if (silentBusyRef.current || current.loading || current.error) return;
    silentBusyRef.current = true;
    const seq = loadSeqRef.current;
    try {
      const data = await listPlatformBusinesses({
        search: filters.search,
        country: filters.country,
        state: filters.state,
        verification: filters.verification,
        mode: "VERIFICACIONES",
      });
      if (seq !== loadSeqRef.current) return;
      setState((latest) => {
        if (latest.loading || latest.error) return latest;
        const merged = mergeRefreshedFirstPage(
          {items: latest.items, cursor: latest.cursor, loadedMore: loadedMoreRef.current},
          {items: data.empresas, cursor: data.cursor}
        );
        return isSameListState(latest, merged) ? latest : {...latest, items: merged.items, cursor: merged.cursor};
      });
    } catch {
      // Un fallo del refresco no tapa lo que ya se muestra.
    } finally {
      silentBusyRef.current = false;
    }
  }, [filters]);
  useVisiblePolling(refreshSilently, {enabled: verificationOnly, intervalMs: REFRESH_INTERVAL_MS});
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
    <PlatformHeading eyebrow="Clientes de ValoraCloud" title={verificationOnly ? "Verificaciones" : "Empresas"} description={verificationOnly ? "Solicitudes pendientes de revisión por la plataforma." : "Directorio global de empresas registradas."} action={<Button variant="secondary" icon={RefreshCw} onClick={() => load()}>Actualizar</Button>} />
    {location.state?.platformNotice && <div className="platform-notice" role="status">{location.state.platformNotice}</div>}
    {filters.uid && <div className="platform-account-filter">
      <p>Empresas de la cuenta <strong>{state.account ? personIdentity(state.account.nombre, state.account.correo) : filters.uid}</strong></p>
      <Link to="/admin/empresas">Ver todas las empresas</Link>
    </div>}
    <PlatformListFilters draft={draft} onChange={setDraft} onReset={resetFilters} onSelectorChange={applySelector} onSubmit={applyFilters} type={verificationOnly ? "verifications" : "businesses"} />
    {state.error && <ErrorState error={state.error} retry={() => load()} />}
    {!state.error && state.loading && !state.items.length && <Loading />}
    {!state.error && Boolean(state.items.length || !state.loading) && <BusinessesTable businesses={state.items} verificationOnly={verificationOnly} emptyText={verificationOnly ? (filters.verification === "PENDIENTE" && !filters.search && filters.country === "TODOS" ? "No hay verificaciones pendientes." : "No hay verificaciones para los filtros seleccionados.") : filters.uid ? "Esta cuenta no es propietaria de empresas con los filtros seleccionados." : undefined} />}
    {state.cursor && <div className="platform-load-more"><Button variant="secondary" loading={state.loading} onClick={() => load(state.cursor, true)}>{state.loading ? "Cargando..." : "Cargar más"}</Button></div>}
  </>;
}

function DetailGrid({items}) {
  return <dl className="platform-detail-grid">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><RecordValue value={item.value} /></dd></div>)}</dl>;
}

export function PlatformBusinessDetailPage() {
  const {businessId} = useParams();
  const navigate = useNavigate();
  const {reloadSummary} = useOutletContext();
  const [state, setState] = React.useState({loading: true, data: null, error: ""});
  const [reason, setReason] = React.useState("");
  const [rejectionReason, setRejectionReason] = React.useState("");
  const [officialLegalName, setOfficialLegalName] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [openingEvidence, setOpeningEvidence] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [evidenceError, setEvidenceError] = React.useState(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [decisionState, dispatchDecision] = React.useReducer(decisionReducer, INITIAL_DECISION_STATE);
  const verificationDecision = decisionState.decision;
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
  // `onError` (opcional) recibe el error en lugar de mostrarlo como aviso de página: el modal de confirmación lo
  // muestra dentro, porque el aviso de página queda detrás del modal.
  const run = async (prefix, operation, {onError} = {}) => {
    setWorking(true); setNotice("");
    try {
      if (!requestRef.current) requestRef.current = createPlatformRequestId(prefix);
      await operation(requestRef.current);
      requestRef.current = "";
      setReason("");
      setRejectionReason("");
      setOfficialLegalName("");
      setNotice("Acción aplicada correctamente.");
      load();
      reloadSummary(true);
      return true;
    } catch (error) {
      if (onError) onError(error);
      else setNotice(message(error, "No pudimos completar la acción."));
      return false;
    } finally { setWorking(false); }
  };
  const loadEvidence = async () => {
    if (openingEvidence) return;
    setNotice("");
    const popup = window.open("", "_blank");
    if (!popup) {
      setEvidenceError({text: "El navegador bloqueó la nueva pestaña. Habilita las ventanas emergentes e inténtalo nuevamente.", code: ""});
      return;
    }
    popup.opener = null;
    popup.document.title = "Preparando documento";
    popup.document.body.textContent = "Preparando documento seguro…";
    setOpeningEvidence(true);
    try {
      const evidence = await getPlatformVerificationDocument(
        businessId,
        state.data.solicitudActual.id
      );
      if (popup.closed) {
        throw new Error("La pestaña del documento fue cerrada.");
      }
      popup.location.assign(evidence.url);
      setEvidenceError(null);
    } catch (error) {
      if (!popup.closed) popup.close();
      setEvidenceError({
        text: message(error, "No pudimos abrir el documento de respaldo."),
        code: evidenceErrorCode(error),
      });
    } finally {
      setOpeningEvidence(false);
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
  const {empresa, propietario, miembros, solicitudActual, eventos, modulosDisponibles = []} = state.data;
  const pending = empresa.verificacion?.estado === "PENDIENTE" && solicitudActual;
  const verified = empresa.verificacion?.estado === "VERIFICADA";
  const verificationLabel = VERIFICATION_LABELS[empresa.verificacion?.estado] ||
    empresa.verificacion?.estado || "Empresa no verificada";
  return <>
    <button className="platform-back" type="button" onClick={() => navigate(-1)}><AppIcon icon={ChevronLeft} size={18} />Volver</button>
    <PlatformHeading eyebrow="Empresa" title={empresa.nombreComercial || "Empresa sin nombre"} description={<span className="platform-business-heading-meta"><span>{propietario?.correo || "Propietario sin correo"}</span><span>{countryName(empresa.paisCodigo)} · {verificationLabel}</span><span className="platform-business-heading-meta__id"><small>ID: {empresa.id}</small><CopyIdButton value={empresa.id} label="Copiar ID de empresa" /></span></span>} action={<StatusBadge variant={stateVariant(empresa.estado)}>{platformStateLabel(empresa.estado)}</StatusBadge>} />
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
    ]} /></section>
    {(empresa.estado === "activo" || empresa.estado === "suspendida") && <section className="platform-panel"><h2>Acciones</h2>
      {empresa.estado === "activo" ? <div className="platform-action-form platform-action-form--standalone"><label>Motivo de suspensión<textarea rows="2" value={reason} onChange={(event) => {setReason(event.target.value); requestRef.current = "";}} /></label><Button variant="danger" disabled={working || !reason.trim()} onClick={() => run("suspend_business", (requestId) => setPlatformBusinessStatus({businessId, estado: "suspendida", motivo: reason, requestId}))}>Suspender empresa</Button></div> : <Button disabled={working} onClick={() => run("reactivate_business", (requestId) => setPlatformBusinessStatus({businessId, estado: "activo", motivo: "", requestId}))}>Reactivar empresa</Button>}
    </section>}
    <section className="platform-panel"><h2>Verificación empresarial</h2>
      <div className="platform-verification-summary"><StatusBadge variant={verificationVariant(empresa.verificacion?.estado)}>{verificationLabel}</StatusBadge>{solicitudActual && <span>Solicitud recibida {date(solicitudActual.solicitadoEn)}</span>}</div>
      {solicitudActual && <div className="platform-verification-review">
        <article><span>{fiscalFieldLabel(solicitudActual.identificadorFiscalTipo, "declarado")}</span><strong>{fiscalIdentifier(solicitudActual.paisCodigo, solicitudActual.identificadorFiscalValor)}</strong><small>{countryName(solicitudActual.paisCodigo)}</small></article>
        <article><span>Solicitante</span><strong>{solicitudActual.correoSolicitante || "Correo no informado"}</strong><small>{solicitudActual.relacionSolicitante || "Relación no informada"}{solicitudActual.telefonoSolicitante ? ` · ${solicitudActual.telefonoSolicitante}` : ""}</small></article>
        <article className="platform-verification-review__evidence"><span>Evidencia</span><strong>{solicitudActual.documentoAcreditativo?.nombreOriginal || "Sin documento adjunto"}</strong>{solicitudActual.documentoAcreditativo && <Button variant="secondary" loading={openingEvidence} onClick={loadEvidence}>{openingEvidence ? "Abriendo…" : "Ver documento"}</Button>}
          {evidenceError && <div className="platform-evidence-error">
            <div role="alert"><p>{evidenceError.text}</p>{evidenceError.code && <small>código: {evidenceError.code}</small>}</div>
            <Button variant="secondary" loading={openingEvidence} onClick={loadEvidence}>Reintentar</Button>
          </div>}
        </article>
        {solicitudActual.observaciones && <article><span>Observaciones</span><strong>{solicitudActual.observaciones}</strong></article>}
      </div>}
      {pending && <div className="platform-verification-actions">
        <div className="platform-verification-decision"><label>Razón social oficial *<input required value={officialLegalName} onChange={(event) => {setOfficialLegalName(event.target.value); requestRef.current = "";}} /></label><small>Obligatoria para aprobar y registrar la identidad fiscal oficial.</small><Button icon={CheckCircle2} disabled={working || !officialLegalName.trim()} onClick={() => dispatchDecision({type: "open", decision: "APROBAR"})}>Revisar aprobación</Button></div>
        <div className="platform-verification-decision"><label>Motivo de rechazo *<textarea required rows="2" value={rejectionReason} onChange={(event) => {setRejectionReason(event.target.value); requestRef.current = "";}} /></label><small>Explica brevemente qué debe corregir la empresa.</small><Button variant="danger" disabled={working || !rejectionReason.trim()} onClick={() => dispatchDecision({type: "open", decision: "RECHAZAR"})}>Revisar rechazo</Button></div>
      </div>}
    </section>
    <section className="platform-panel"><h2>Miembros ({miembros.length})</h2><div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Usuario</th><th>Correo</th><th>Perfil</th><th>Estado</th></tr></thead><tbody>{miembros.map((member) => <tr key={member.uid} onClick={() => navigate(`/admin/usuarios/${member.uid}`)}><td>{personIdentity(member.nombre, member.correo)}</td><td>{member.correo}</td><td>{BUSINESS_ROLE_LABELS[member.rol] || humanizeToken(member.rol)}</td><td>{platformStateLabel(member.estado)}</td></tr>)}</tbody></table></div></section>
    <section className="platform-panel"><h2>Historial</h2>{eventos.length ? <ol className="platform-timeline">{eventos.map((event) => <li key={`${event.origen}-${event.id}`}><span>{platformOriginLabel(event.origen)}</span><strong>{platformEventLabel(event.tipo)}</strong><p>{event.tipo === MODULES_EVENT_TYPE ? moduleEventSummary(event, modulosDisponibles) : <>{event.estadoAnterior && `${platformStateLabel(event.estadoAnterior)} → `}{platformStateLabel(event.estadoResultante)}{event.motivo && ` · ${event.motivo}`}</>}</p><time>{date(event.creadoEn)}</time></li>)}</ol> : <div className="platform-empty">Sin eventos registrados.</div>}</section>
    <section className="platform-panel platform-danger-zone"><div><h2>Zona de peligro</h2><p>Esta acción elimina permanentemente la empresa y todos sus datos exclusivos. Los usuarios de Auth no se eliminan.</p></div><Button variant="danger" icon={Trash2} onClick={() => {setDeleteConfirmation(""); setDeleteError(""); deleteRequestRef.current = ""; setDeleteOpen(true);}}>Eliminar empresa permanentemente</Button></section>
    <ResponsiveDialog
      open={deleteOpen}
      title="Eliminar empresa permanentemente"
      description="Esta acción no se puede deshacer. Escribe el nombre comercial exacto para continuar."
      initialFocusRef={deleteInputRef}
      onClose={() => !deleting && setDeleteOpen(false)}
      footer={<><Button variant="secondary" disabled={deleting} onClick={() => setDeleteOpen(false)}>Cancelar</Button><Button variant="danger" icon={Trash2} loading={deleting} disabled={deleteConfirmation !== empresa.nombreComercial} onClick={deleteBusiness}>{deleting ? "Eliminando..." : "Eliminar permanentemente"}</Button></>}
    >
      <div className="platform-delete-confirmation"><p>Nombre comercial: <strong>{empresa.nombreComercial}</strong></p><label>Confirmación<input ref={deleteInputRef} value={deleteConfirmation} autoComplete="off" onChange={(event) => {setDeleteConfirmation(event.target.value); setDeleteError(""); deleteRequestRef.current = "";}} /></label>{deleteError && <div className="platform-delete-error" role="alert">{deleteError}</div>}</div>
    </ResponsiveDialog>
    <VerificationDecisionDialog
      decision={verificationDecision}
      error={decisionState.error}
      working={working}
      summary={verificationDecision === "APROBAR" ? officialLegalName.trim() : rejectionReason.trim()}
      fiscalIdentifier={fiscalIdentifier(solicitudActual?.paisCodigo, solicitudActual?.identificadorFiscalValor)}
      onClose={() => dispatchDecision({type: "close"})}
      onConfirm={() => confirmDecision({
        dispatch: dispatchDecision,
        runAction: ({onError}) => {
          const approving = verificationDecision === "APROBAR";
          return run(approving ? "approve_verification" : "reject_verification", (requestId) => resolvePlatformVerification({businessId, solicitudId: solicitudActual.id, decision: verificationDecision, motivo: approving ? "" : rejectionReason.trim(), razonSocialOficial: approving ? officialLegalName.trim() : "", requestId}), {onError});
        },
      })}
    />
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
  return <><PlatformHeading eyebrow="Clientes de ValoraCloud" title="Usuarios" description="Directorio global de cuentas y membresías." action={<Button variant="secondary" icon={RefreshCw} onClick={() => load()}>Actualizar</Button>} />
    <PlatformListFilters draft={draft} onChange={setDraft} onReset={resetFilters} onSelectorChange={applySelector} onSubmit={applyFilters} type="users" />
    {state.error && <ErrorState error={state.error} retry={() => load()} />}{state.loading && !state.items.length && <Loading />}
    {!state.error && Boolean(state.items.length || !state.loading) && <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Usuario</th><th>Correo</th><th>Empresas</th><th>Estado</th><th>Fecha alta</th><th>Último acceso</th></tr></thead><tbody>{state.items.map((user) => <tr key={user.uid} onClick={() => navigate(`/admin/usuarios/${user.uid}`)}><td><strong>{personIdentity(user.nombre, user.correo)}</strong><CopyIdButton value={user.uid} /></td><td>{user.correo}</td><td>{user.empresas}</td><td><StatusBadge variant={stateVariant(user.estado)}>{platformStateLabel(user.estado)}</StatusBadge></td><td><RecordValue value={date(user.fechaAlta)} /></td><td><RecordValue value={date(user.ultimoAcceso)} /></td></tr>)}</tbody></table></div>}
    {state.cursor && <div className="platform-load-more"><Button variant="secondary" disabled={state.loading} onClick={() => load(state.cursor, true)}>Cargar más</Button></div>}
  </>;
}

export function PlatformUserDetailPage() {
  const {uid} = useParams(); const navigate = useNavigate();
  const {currentUid} = useOutletContext() || {};
  const [state, setState] = React.useState({loading: true, data: null, error: ""});
  const [reason, setReason] = React.useState(""); const [working, setWorking] = React.useState(false); const [notice, setNotice] = React.useState("");
  const requestRef = React.useRef("");
  // Aviso persistente (no se borra al recargar): el superadmin debe verlo hasta cerrarlo o hacer otra acción.
  const [recoveryWarning, setRecoveryWarning] = React.useState(null);
  React.useEffect(() => setRecoveryWarning(null), [uid]);
  const load = React.useCallback(() => { setState((current) => ({...current, loading: true, error: ""})); getPlatformUser(uid).then((data) => setState({loading: false, data, error: ""})).catch((error) => setState({loading: false, data: null, error: message(error, "No pudimos cargar el usuario.")})); }, [uid]);
  React.useEffect(load, [load]);
  const changeStatus = async (estado) => { setWorking(true); setNotice(""); try { if (!requestRef.current) requestRef.current = createPlatformRequestId(`${estado}_user`); await setPlatformUserStatus({uid, estado, motivo: estado === "suspendido" ? reason : "", requestId: requestRef.current}); requestRef.current = ""; setReason(""); setNotice("Estado actualizado correctamente."); load(); } catch (error) { setNotice(message(error, "No pudimos actualizar el usuario.")); } finally { setWorking(false); } };
  const recoveryCompleted = ({text, warning}) => { setNotice(text); setRecoveryWarning(warning); load(); };
  if (state.loading && !state.data) return <Loading />; if (state.error) return <ErrorState error={state.error} retry={load} />;
  const {usuario, membresias, eventos} = state.data;
  const isOwnAccount = Boolean(currentUid) && usuario.uid === currentUid;
  return <><button className="platform-back" type="button" onClick={() => navigate(-1)}><AppIcon icon={ChevronLeft} size={18} />Volver</button><PlatformHeading eyebrow="Usuario" title={personIdentity(usuario.nombre, usuario.correo)} description={usuario.correo} action={<div className="platform-heading-actions"><StatusBadge variant={stateVariant(usuario.estado)}>{platformStateLabel(usuario.estado)}</StatusBadge><Button variant="secondary" icon={Building2} onClick={() => navigate(`/admin/empresas?uid=${encodeURIComponent(usuario.uid)}`)}>Ver empresas</Button></div>} />
    {notice && <div className="platform-notice" role="status">{notice}</div>}
    {recoveryWarning && <Notice variant="warning" title={recoveryWarning.title} className="platform-recovery-notice" actions={<Button variant="secondary" onClick={() => setRecoveryWarning(null)}>Entendido</Button>}>{recoveryWarning.text}</Notice>}
    <div className="platform-detail-columns"><section className="platform-panel"><h2>Cuenta</h2><DetailGrid items={[{label: "UID", value: usuario.uid}, {label: "Correo", value: usuario.correo}, {label: "Estado", value: platformStateLabel(usuario.estado)}, ...(usuario.motivoSuspension ? [{label: "Motivo de suspensión", value: usuario.motivoSuspension}] : []), {label: "Fecha alta", value: date(usuario.fechaAlta)}, {label: "Último acceso", value: date(usuario.ultimoAcceso)}]} /></section>
      <section className="platform-panel"><h2>Control de acceso</h2>{isOwnAccount ? <p className="platform-help platform-help--flush">Tu propia cuenta de plataforma no se suspende desde aquí.</p> : <>{usuario.estado === "activo" ? <div className="platform-action-form"><label>Motivo de suspensión<textarea rows="2" value={reason} onChange={(event) => {setReason(event.target.value); requestRef.current = "";}} /></label><Button variant="danger" disabled={working || !reason.trim()} onClick={() => changeStatus("suspendido")}>Suspender usuario</Button></div> : <Button disabled={working} onClick={() => changeStatus("activo")}>Reactivar usuario</Button>}<p className="platform-help">La suspensión deshabilita Auth y el acceso ERP sin borrar membresías ni históricos.</p></>}</section></div>
    <AccountRecoveryPanel usuario={usuario} isOwnAccount={isOwnAccount} onCompleted={recoveryCompleted} />
    <section className="platform-panel"><h2>Membresías ({membresias.length})</h2>{membresias.length ? <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Empresa</th><th>Perfil</th><th>Estado</th><th>Ingreso</th></tr></thead><tbody>{membresias.map((membership) => <tr key={membership.negocioId} onClick={() => navigate(`/admin/empresas/${membership.negocioId}`)}><td>{membership.empresa}</td><td>{BUSINESS_ROLE_LABELS[membership.rol] || humanizeToken(membership.rol)}</td><td>{platformStateLabel(membership.estado)}</td><td>{date(membership.fechaIncorporacion)}</td></tr>)}</tbody></table></div> : <div className="platform-empty">El usuario no posee membresías.</div>}</section>
    <section className="platform-panel"><h2>Eventos de plataforma</h2>{eventos.length ? <ol className="platform-timeline">{eventos.map((event) => <li key={event.id}><span>Usuario</span><strong>{platformEventLabel(event.tipo)}</strong><p>{userEventSummary(event, platformStateLabel)}</p>{event.motivo && <p>Motivo: {event.motivo}</p>}{["fallido", "no_configurado"].includes(event.avisoCorreoAnterior) && <p>Aviso al correo anterior: no enviado</p>}<time>{date(event.creadoEn)}</time></li>)}</ol> : <div className="platform-empty">Sin eventos registrados.</div>}</section>
  </>;
}

export const platformAdminIcons = {Building2, ShieldCheck, UserRound, Users};
