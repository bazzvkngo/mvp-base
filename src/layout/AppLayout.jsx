import React from "react";
import { LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import AdditionalBusinessDrawer from "../components/AdditionalBusinessDrawer";
import BrandLogo from "../components/BrandLogo";
import BusinessSwitcher from "../components/BusinessSwitcher";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import PageHeader from "../components/ui/PageHeader";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import SkipLink from "../components/ui/SkipLink";
import { getRouteMeta, navigationSections } from "../app/navigation";
import {
  filterNavigationSections,
  getDefaultBusinessPath,
} from "../domain/rbac.mjs";
import {
  canBusinessOperate,
  filterNavigationForBusinessVerification,
  normalizeBusinessVerificationState,
} from "../domain/businessOperations.mjs";
import { logout } from "../services/authService";
import useBusinessCompletionStatus from "../hooks/useBusinessCompletionStatus";

function PrimaryNavigation({
  ariaLabel = "Navegación principal",
  businessCompletionStatus,
  idPrefix,
  onNavigate,
  pathname,
  sections = navigationSections,
}) {
  return (
    <nav className="sidebar-nav" aria-label={ariaLabel}>
      {sections.map((section, sectionIndex) => {
        const sectionTitleId = `${idPrefix}-nav-section-${sectionIndex}`;

        return (
          <div
            className="nav-section"
            key={section.label}
            role="group"
            aria-labelledby={sectionTitleId}
          >
            <span id={sectionTitleId} className="nav-section__title">
              {section.label}
            </span>
            {section.items.map((item) => {
              const isActive = item.activeWhen
                ? item.activeWhen(pathname)
                : pathname === item.to;

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  aria-current={isActive ? "page" : undefined}
                  className={isActive ? "nav-link nav-link-active" : "nav-link"}
                  onClick={onNavigate}
                >
                  <AppIcon icon={item.icon} size={18} />
                  <span className="nav-link__label">{item.label}</span>
                  {item.to === "/empresa" && businessCompletionStatus && (
                    <span
                      className="nav-link__completion"
                      aria-label={`Empresa ${businessCompletionStatus.percent}% completa`}
                    >
                      {businessCompletionStatus.percent}%
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function AppLayout({
  usuario,
  businessChanging,
  businessSession,
  negocioActivo,
  onBusinessChanged,
  onBusinessCreated,
  platformSuperadmin,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavigationOpen, setMobileNavigationOpen] = React.useState(false);
  const [mobileAccountOpen, setMobileAccountOpen] = React.useState(false);
  const [businessDrawerOpen, setBusinessDrawerOpen] = React.useState(false);
  const [businessNotice, setBusinessNotice] = React.useState("");
  const menuButtonRef = React.useRef(null);
  const drawerRef = React.useRef(null);
  const closeButtonRef = React.useRef(null);
  const activationRefreshRef = React.useRef("");
  const canManageBusiness = ["OWNER", "ADMIN"].includes(negocioActivo?.role);
  const businessVerified = canBusinessOperate(negocioActivo);
  const ownerEmailVerified = negocioActivo?.ownerEmailVerified === true;
  const {
    profile: observedBusinessProfile,
    status: businessCompletionStatus,
  } = useBusinessCompletionStatus({
    businessId: negocioActivo?.id || "",
    ownerEmailVerified,
    initialProfile: negocioActivo || {},
  });
  const allowedNavigationSections = React.useMemo(
    () => businessVerified
      ? filterNavigationSections(navigationSections, negocioActivo)
      : filterNavigationForBusinessVerification(navigationSections, negocioActivo),
    [negocioActivo]
  );
  const mainNavigationSections = allowedNavigationSections.filter(
    (section) => section.label !== "Cuenta"
  );
  const accountNavigationSections = allowedNavigationSections.filter(
    (section) => section.label === "Cuenta"
  );

  React.useEffect(() => {
    if (!mobileNavigationOpen) return undefined;

    const originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleDrawerKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavigationOpen(false);
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusableElements = Array.from(
        drawerRef.current.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleDrawerKeyDown);

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.removeEventListener("keydown", handleDrawerKeyDown);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
  }, [mobileNavigationOpen]);

  React.useEffect(() => {
    const desktopMediaQuery = window.matchMedia("(min-width: 960px)");
    const closeDrawerOnDesktop = (event) => {
      if (event.matches) setMobileNavigationOpen(false);
    };

    desktopMediaQuery.addEventListener("change", closeDrawerOnDesktop);
    return () =>
      desktopMediaQuery.removeEventListener("change", closeDrawerOnDesktop);
  }, []);

  React.useEffect(() => {
    if (!businessNotice) return undefined;
    const timerId = window.setTimeout(() => setBusinessNotice(""), 4500);
    return () => window.clearTimeout(timerId);
  }, [businessNotice]);

  React.useEffect(() => {
    const businessId = negocioActivo?.id || "";
    const observedBusinessId =
      observedBusinessProfile?.negocioId || observedBusinessProfile?.id || "";
    if (!businessId || observedBusinessId !== businessId) return undefined;

    const sessionState = normalizeBusinessVerificationState(
      negocioActivo?.verificacionEmpresa?.estado
    );
    const observedState = normalizeBusinessVerificationState(
      observedBusinessProfile?.verificacionEmpresa?.estado
    );
    if (sessionState === observedState) {
      activationRefreshRef.current = "";
      return undefined;
    }

    const refreshKey = `${businessId}:${sessionState}:${observedState}`;
    if (activationRefreshRef.current === refreshKey) return undefined;
    activationRefreshRef.current = refreshKey;
    let cancelled = false;
    Promise.resolve(onBusinessCreated())
      .then((session) => {
        if (cancelled) return;
        const nextBusiness = session?.activeBusiness;
        if (canBusinessOperate(nextBusiness)) {
          navigate(getDefaultBusinessPath(nextBusiness), { replace: true });
        }
      })
      .catch(() => {
        if (!cancelled) activationRefreshRef.current = "";
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, negocioActivo, observedBusinessProfile, onBusinessCreated]);

  React.useEffect(() => {
    const expandedTopbarMediaQuery = window.matchMedia("(min-width: 641px)");
    const closeAccountOnExpandedTopbar = (event) => {
      if (event.matches) setMobileAccountOpen(false);
    };

    expandedTopbarMediaQuery.addEventListener(
      "change",
      closeAccountOnExpandedTopbar
    );
    return () =>
      expandedTopbarMediaQuery.removeEventListener(
        "change",
        closeAccountOnExpandedTopbar
      );
  }, []);

  const routeMeta = getRouteMeta(location.pathname);
  const pageProvidesHeading = location.pathname === "/reportes";

  const handleOpenBusinessDrawer = () => {
    if (mobileNavigationOpen) {
      setMobileNavigationOpen(false);
      window.requestAnimationFrame(() => setBusinessDrawerOpen(true));
      return;
    }
    setBusinessDrawerOpen(true);
  };

  const handleBusinessChanged = async (business) => {
    const session = await onBusinessChanged(business.id);
    const nextBusiness = session?.activeBusiness || business;
    navigate(canBusinessOperate(nextBusiness)
      ? getDefaultBusinessPath(nextBusiness)
      : "/empresa?seccion=verificacion");
    setMobileNavigationOpen(false);
    setBusinessNotice(
      `Ahora estás trabajando en ${business.nombreComercial}`
    );
  };

  const handleBusinessCreated = async (business) => {
    const session = await onBusinessCreated();
    const nextBusiness = session?.activeBusiness || business;
    navigate(canBusinessOperate(nextBusiness)
      ? getDefaultBusinessPath(nextBusiness)
      : "/empresa?seccion=verificacion");
    setBusinessNotice(`${business.nombreComercial} fue creado correctamente`);
  };

  const businessSwitcher = (
    <BusinessSwitcher
      activeBusiness={negocioActivo}
      businesses={businessSession?.businesses || []}
      onAddBusiness={businessVerified ? handleOpenBusinessDrawer : null}
      onBusinessChanged={handleBusinessChanged}
    />
  );

  return (
    <div className="app-shell">
      <SkipLink />

      <aside className="sidebar sidebar--desktop">
        <div className="sidebar__top">
          <BrandLogo variant="sidebar" showText />
          {businessSwitcher}
        </div>
        <div className="sidebar__navigation">
          <PrimaryNavigation
            businessCompletionStatus={canManageBusiness ? businessCompletionStatus : null}
            idPrefix="desktop"
            pathname={location.pathname}
            sections={mainNavigationSections}
          />
        </div>
        <div className="sidebar__footer">
          <PrimaryNavigation
            ariaLabel="Navegación de cuenta"
            idPrefix="desktop-account"
            pathname={location.pathname}
            sections={accountNavigationSections}
          />
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button
            ref={menuButtonRef}
            type="button"
            className="topbar-menu-button no-print"
            aria-label="Abrir menú de navegación"
            aria-controls="mobile-navigation"
            aria-expanded={mobileNavigationOpen}
            onClick={() => setMobileNavigationOpen(true)}
          >
            <AppIcon icon={Menu} size={21} />
          </button>

          {pageProvidesHeading ? (
            <div className="topbar-context" aria-label="Negocio activo">
              <span>{negocioActivo?.nombreComercial || "Módulo activo"}</span>
            </div>
          ) : (
            <PageHeader
              eyebrow={negocioActivo?.nombreComercial || "Módulo activo"}
              title={routeMeta.title}
            />
          )}

          <div className="topbar-user topbar-user--desktop">
            {platformSuperadmin && <Button type="button" variant="secondary" icon={ShieldCheck} onClick={() => navigate("/admin/dashboard")}>Consola de Administración</Button>}
            <Button
              type="button"
              variant="ghost-danger"
              icon={LogOut}
              className="topbar-logout-button no-print"
              aria-label="Cerrar sesión"
              title="Salir de ValoraCloud"
              onClick={() => logout()}
            >
              Salir
            </Button>
          </div>

          <button
            type="button"
            className="topbar-account-button no-print"
            aria-label="Abrir cuenta de usuario"
            aria-haspopup="dialog"
            aria-expanded={mobileAccountOpen}
            onClick={() => setMobileAccountOpen(true)}
          >
            <AppIcon icon={UserRound} size={20} />
          </button>
        </header>

        {businessNotice && (
          <div className="business-toast no-print" role="status" aria-live="polite">
            {businessNotice}
          </div>
        )}

        <main
          id="main-content"
          className={businessChanging ? "page-content is-business-changing" : "page-content"}
          tabIndex="-1"
          aria-busy={businessChanging}
        >
          {businessChanging && (
            <div className="business-change-status" role="status">
              Cambiando de negocio...
            </div>
          )}
          {!businessChanging && (
            <Outlet context={{ businessCompletionStatus }} />
          )}
        </main>
      </div>

      <ResponsiveDialog
        open={mobileAccountOpen}
        onClose={() => setMobileAccountOpen(false)}
        title="Cuenta de usuario"
        eyebrow="ValoraCloud"
        size="small"
      >
        <div className="account-dialog-content">
          <div className="account-dialog-identity">
            <span className="account-dialog-label">Correo</span>
            <strong className="account-dialog-email">{usuario?.email}</strong>
          </div>
          {negocioActivo?.nombreComercial && (
            <div className="account-dialog-identity">
              <span className="account-dialog-label">Negocio activo</span>
              <strong className="account-dialog-email">
                {negocioActivo.nombreComercial}
              </strong>
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            icon={UserRound}
            onClick={() => {
              setMobileAccountOpen(false);
              navigate("/cuenta");
            }}
          >
            Editar perfil
          </Button>
          {platformSuperadmin && <Button type="button" variant="secondary" icon={ShieldCheck} onClick={() => { setMobileAccountOpen(false); navigate("/admin/dashboard"); }}>Consola de Administración</Button>}
          <Button
            type="button"
            variant="ghost-danger"
            icon={LogOut}
            onClick={() => {
              setMobileAccountOpen(false);
              logout();
            }}
          >
            Cerrar sesión
          </Button>
        </div>
      </ResponsiveDialog>

      {mobileNavigationOpen && (
        <div className="mobile-nav-layer no-print">
          <div
            className="mobile-nav-overlay"
            aria-hidden="true"
            onClick={() => setMobileNavigationOpen(false)}
          />
          <aside
            ref={drawerRef}
            id="mobile-navigation"
            className="sidebar mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-navigation-title"
          >
            <div className="sidebar__top">
              <div className="mobile-nav-drawer__header">
                <div id="mobile-navigation-title">
                  <BrandLogo variant="sidebar" showText />
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="mobile-nav-close"
                  aria-label="Cerrar menú de navegación"
                  onClick={() => setMobileNavigationOpen(false)}
                >
                  <AppIcon icon={X} size={21} />
                </button>
              </div>
              {businessSwitcher}
            </div>
            <div className="sidebar__navigation">
              <PrimaryNavigation
                businessCompletionStatus={canManageBusiness ? businessCompletionStatus : null}
                idPrefix="mobile"
                pathname={location.pathname}
                sections={mainNavigationSections}
                onNavigate={() => setMobileNavigationOpen(false)}
              />
            </div>
            <div className="sidebar__footer">
              <PrimaryNavigation
                ariaLabel="Navegación de cuenta"
                idPrefix="mobile-account"
                pathname={location.pathname}
                sections={accountNavigationSections}
                onNavigate={() => setMobileNavigationOpen(false)}
              />
            </div>
          </aside>
        </div>
      )}

      <AdditionalBusinessDrawer
        open={businessDrawerOpen}
        usuario={usuario}
        onClose={() => setBusinessDrawerOpen(false)}
        onCreated={handleBusinessCreated}
      />
    </div>
  );
}

export default AppLayout;
