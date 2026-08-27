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
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import {logout} from "../services/authService";

const sections = [
  {label: "Resumen", items: [{to: "/admin/dashboard", label: "Dashboard", icon: Gauge}]},
  {
    label: "Clientes de ValoraCloud",
    items: [
      {to: "/admin/empresas", label: "Empresas", icon: Building2},
      {to: "/admin/usuarios", label: "Usuarios", icon: Users},
      {to: "/admin/verificaciones", label: "Verificaciones", icon: ShieldCheck},
    ],
  },
];

function PlatformNavigation({onNavigate}) {
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

  const returnToErp = async () => {
    await onReturnToErp?.();
    navigate("/cotizaciones");
  };

  return <div className="platform-shell">
    <aside className="platform-sidebar platform-sidebar--desktop">
      <div className="platform-brand">
        <span className="platform-brand__mark"><AppIcon icon={ShieldCheck} size={22} /></span>
        <div><strong>ValoraCloud</strong><span>Consola de Administración</span></div>
      </div>
      <PlatformNavigation />
      <div className="platform-sidebar__footer">
        {hasErp && <Button variant="secondary" icon={RotateCcw} onClick={returnToErp}>Volver al ERP</Button>}
        <Button variant="ghost-danger" icon={LogOut} onClick={() => logout()}>Cerrar sesion</Button>
      </div>
    </aside>
    <div className="platform-workspace">
      <header className="platform-topbar">
        <button className="platform-menu-button" type="button" aria-label="Abrir navegacion" onClick={() => setMobileOpen(true)}>
          <AppIcon icon={Menu} size={21} />
        </button>
        <div><span>Contexto global</span><strong>Administración de plataforma</strong></div>
        <div className="platform-topbar__identity"><span>Administrador</span><strong>{usuario?.email}</strong></div>
      </header>
      <main id="platform-main" className="platform-content"><Outlet /></main>
    </div>
    {mobileOpen && <div className="platform-mobile-layer">
      <button className="platform-mobile-overlay" type="button" aria-label="Cerrar navegacion" onClick={() => setMobileOpen(false)} />
      <aside className="platform-sidebar platform-sidebar--mobile" role="dialog" aria-modal="true">
        <div className="platform-mobile-heading"><strong>Consola de Administración</strong><button type="button" aria-label="Cerrar" onClick={() => setMobileOpen(false)}><AppIcon icon={X} size={20} /></button></div>
        <PlatformNavigation onNavigate={() => setMobileOpen(false)} />
        <div className="platform-sidebar__footer">
          {hasErp && <Button variant="secondary" icon={RotateCcw} onClick={returnToErp}>Volver al ERP</Button>}
          <Button variant="ghost-danger" icon={LogOut} onClick={() => logout()}>Cerrar sesion</Button>
        </div>
      </aside>
    </div>}
  </div>;
}

export default PlatformAdminLayout;
