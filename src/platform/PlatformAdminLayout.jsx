import React from "react";
import {
  Building2,
  Gauge,
  LogOut,
  Menu,
  RotateCcw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import {NavLink, Outlet, useLocation, useNavigate} from "react-router-dom";
import BrandMark from "../components/brand/BrandMark";
import { RouteErrorBoundary } from "../components/AppErrorBoundary";
import ThemeToggleButton from "../components/ThemeToggleButton";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import {REFRESH_INTERVAL_MS} from "../domain/visiblePolling.mjs";
import useVisiblePolling from "../hooks/useVisiblePolling";
import {logout} from "../services/authService";
import {getPlatformSummary} from "../services/platformAdminService";

const sections = [
  {label: "Resumen", items: [{to: "/admin/dashboard", label: "Dashboard", icon: Gauge}]},
  {
    label: "Clientes de ValoraCloud",
    items: [
      {to: "/admin/empresas", label: "Empresas", icon: Building2},
      {to: "/admin/usuarios", label: "Usuarios", icon: Users},
      {to: "/admin/verificaciones", label: "Verificaciones", icon: ShieldCheck, badge: "pendingVerifications"},
    ],
  },
];

const SUMMARY_MIN_INTERVAL_MS = 30000;

function PlatformNavigation({badges = {}, onNavigate}) {
  return <nav className="platform-nav" aria-label="Administración de plataforma">
    {sections.map((section) => <div className="platform-nav__section" key={section.label}>
      <span>{section.label}</span>
      {section.items.map((item) => <NavLink
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        className={({isActive}) => isActive ? "platform-nav__link is-active" : "platform-nav__link"}
      >
        <AppIcon icon={item.icon} size={18} />
        {item.label}
        {badges[item.badge] > 0 && <span
          className="platform-nav__badge"
          aria-label={`${badges[item.badge]} pendientes`}
        >{badges[item.badge]}</span>}
      </NavLink>)}
    </div>)}
  </nav>;
}

function PlatformAdminLayout({businessSession, onReturnToErp, usuario}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const hasErp = businessSession?.accessState === "active" &&
    Boolean(businessSession?.activeBusiness);
  React.useEffect(() => setMobileOpen(false), [location.pathname]);

  // El resumen lo comparten el menú (insignia) y el Dashboard. Se pide una vez por
  // navegación y no más de una vez cada 30 s, salvo `force`. Además se refresca en silencio cada
  // minuto con la pestaña visible (y al volver a ella): `silent` no marca "cargando" ni deja
  // un error en pantalla, así que la insignia y las tarjetas cambian sin parpadear.
  const [summary, setSummary] = React.useState({loading: true, data: null, error: ""});
  const summaryRef = React.useRef({inFlight: false, lastAt: 0});
  const loadSummary = React.useCallback((force = false, {silent = false} = {}) => {
    const control = summaryRef.current;
    if (control.inFlight) return;
    if (!force && Date.now() - control.lastAt < SUMMARY_MIN_INTERVAL_MS) return;
    control.inFlight = true;
    if (!silent) setSummary((current) => ({...current, loading: true, error: ""}));
    getPlatformSummary()
      .then((data) => setSummary((current) => silent && current.data && !current.error &&
        JSON.stringify(current.data) === JSON.stringify(data) ? current : {loading: false, data, error: ""}))
      .catch(() => {
        if (!silent) setSummary((current) => ({loading: false, data: current.data, error: "No pudimos cargar el resumen."}));
      })
      .finally(() => {
        control.inFlight = false;
        control.lastAt = Date.now();
      });
  }, []);
  React.useEffect(() => loadSummary(), [loadSummary, location.pathname]);
  useVisiblePolling(() => loadSummary(false, {silent: true}), {intervalMs: REFRESH_INTERVAL_MS});
  const badges = {pendingVerifications: summary.data?.empresas?.verificacionesPendientes || 0};

  const returnToErp = async () => {
    await onReturnToErp?.();
    navigate("/cotizaciones");
  };

  return <div className="platform-shell">
    <aside className="platform-sidebar platform-sidebar--desktop">
      <div className="platform-brand">
        <span className="platform-brand__mark"><BrandMark size={28} onDark /></span>
        <div><strong>ValoraCloud</strong><span>Consola de Administración</span></div>
      </div>
      <PlatformNavigation badges={badges} />
      <div className="platform-sidebar__footer">
        {hasErp && <Button variant="secondary" icon={RotateCcw} onClick={returnToErp}>Volver al ERP</Button>}
        <Button variant="ghost-danger" icon={LogOut} onClick={() => logout()}>Cerrar sesión</Button>
      </div>
    </aside>
    <div className="platform-workspace">
      <header className="platform-topbar">
        <button className="platform-menu-button" type="button" aria-label="Abrir navegación" onClick={() => setMobileOpen(true)}>
          <AppIcon icon={Menu} size={21} />
        </button>
        <div><span>Contexto global</span><strong>Administración de plataforma</strong></div>
        <div className="platform-topbar__actions">
          <ThemeToggleButton />
          <div className="platform-topbar__identity"><span>Administrador</span><strong>{usuario?.email}</strong></div>
        </div>
      </header>
      <main id="platform-main" className="platform-content"><RouteErrorBoundary homePath="/admin/dashboard"><Outlet context={{summary, reloadSummary: loadSummary, currentUid: usuario?.uid || ""}} /></RouteErrorBoundary></main>
    </div>
    {mobileOpen && <div className="platform-mobile-layer">
      <button className="platform-mobile-overlay" type="button" aria-label="Cerrar navegación" onClick={() => setMobileOpen(false)} />
      <aside className="platform-sidebar platform-sidebar--mobile" role="dialog" aria-modal="true">
        <div className="platform-mobile-heading"><strong>Consola de Administración</strong><button type="button" aria-label="Cerrar" onClick={() => setMobileOpen(false)}><AppIcon icon={X} size={20} /></button></div>
        <PlatformNavigation badges={badges} onNavigate={() => setMobileOpen(false)} />
        <div className="platform-sidebar__footer">
          {hasErp && <Button variant="secondary" icon={RotateCcw} onClick={returnToErp}>Volver al ERP</Button>}
          <Button variant="ghost-danger" icon={LogOut} onClick={() => logout()}>Cerrar sesión</Button>
        </div>
      </aside>
    </div>}
  </div>;
}

export default PlatformAdminLayout;
