import React from "react";
import { LogOut, MailCheck, MailWarning, Menu, UserRound, X } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import AdditionalBusinessDrawer from "../components/AdditionalBusinessDrawer";
import BrandLogo from "../components/BrandLogo";
import BusinessSwitcher from "../components/BusinessSwitcher";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import PageHeader from "../components/ui/PageHeader";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import SkipLink from "../components/ui/SkipLink";
import StatusBadge from "../components/ui/StatusBadge";
import { getRouteMeta, navigationSections } from "../app/navigation";
import {
  logout,
  refreshCurrentUser,
  sendVerificationEmail,
} from "../services/authService";

const VERIFICATION_NOTICE_KEY = "valoracloud.verificationNotice";
const RESEND_COOLDOWN_SECONDS = 60;

function PrimaryNavigation({ idPrefix, pathname, onNavigate }) {
  return (
    <nav className="sidebar-nav" aria-label="Navegación principal">
      {navigationSections.map((section, sectionIndex) => {
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
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [emailVerified, setEmailVerified] = React.useState(
    usuario?.emailVerified ?? true
  );
  const [resendMessage, setResendMessage] = React.useState("");
  const [resendError, setResendError] = React.useState("");
  const [checkMessage, setCheckMessage] = React.useState("");
  const [checkError, setCheckError] = React.useState("");
  const [resendingVerification, setResendingVerification] = React.useState(false);
  const [refreshingVerification, setRefreshingVerification] = React.useState(false);
  const [resendCooldown, setResendCooldown] = React.useState(0);
  const [mobileNavigationOpen, setMobileNavigationOpen] = React.useState(false);
  const [mobileAccountOpen, setMobileAccountOpen] = React.useState(false);
  const [businessDrawerOpen, setBusinessDrawerOpen] = React.useState(false);
  const [businessLimitOpen, setBusinessLimitOpen] = React.useState(false);
  const [businessNotice, setBusinessNotice] = React.useState("");
  const menuButtonRef = React.useRef(null);
  const drawerRef = React.useRef(null);
  const closeButtonRef = React.useRef(null);

  React.useEffect(() => {
    setEmailVerified(usuario?.emailVerified ?? true);
    setResendError("");
    setCheckError("");
    setCheckMessage("");
    setResendCooldown(0);

    const storedMessage = window.sessionStorage.getItem(VERIFICATION_NOTICE_KEY);
    if (storedMessage) {
      setResendMessage(storedMessage);
      window.sessionStorage.removeItem(VERIFICATION_NOTICE_KEY);
    } else {
      setResendMessage("");
    }
  }, [usuario?.uid, usuario?.emailVerified]);

  React.useEffect(() => {
    if (resendCooldown <= 0) return undefined;

    const timerId = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timerId);
  }, [resendCooldown]);

  React.useEffect(() => {
    if (!emailVerified || checkMessage !== "Correo verificado correctamente.") {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setCheckMessage("");
    }, 5000);

    return () => window.clearTimeout(timerId);
  }, [checkMessage, emailVerified]);

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

  const logAuthError = (message, error) => {
    if (import.meta.env.DEV) {
      console.error(message, error?.code, error?.message);
    }
  };

  const handleResendVerification = async () => {
    if (resendCooldown > 0) return;

    setCheckMessage("");
    setCheckError("");
    setResendError("");
    setResendMessage("");
    setResendingVerification(true);

    try {
      await sendVerificationEmail();
      setResendMessage(
        "Correo de verificación enviado. Revisa tu bandeja de entrada y la carpeta de spam."
      );
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      logAuthError("Error reenviando correo de verificación:", error);
      if (error.code === "auth/too-many-requests") {
        setResendError(
          "Se realizaron demasiados intentos. Espera unos minutos antes de reenviar."
        );
      } else {
        setResendError(
          "No fue posible enviar el correo de verificación. Revisa tu conexión e inténtalo nuevamente."
        );
      }
    } finally {
      setResendingVerification(false);
    }
  };

  const handleRefreshVerification = async () => {
    setResendMessage("");
    setResendError("");
    setCheckMessage("");
    setCheckError("");
    setRefreshingVerification(true);

    try {
      const refreshedUser = await refreshCurrentUser();
      const isVerified = Boolean(refreshedUser?.emailVerified);
      setEmailVerified(isVerified);

      if (!isVerified) {
        setCheckMessage("Tu correo aún figura pendiente de verificación.");
      } else {
        setCheckMessage("Correo verificado correctamente.");
      }
    } catch (error) {
      logAuthError("Error actualizando estado de verificación:", error);
      setCheckError(
        "No se pudo actualizar el estado de verificación. Inténtalo nuevamente."
      );
    } finally {
      setRefreshingVerification(false);
    }
  };

  const showVerificationBanner = usuario && !emailVerified;
  const showVerifiedNotice =
    usuario && emailVerified && checkMessage === "Correo verificado correctamente.";
  const resendButtonDisabled =
    resendingVerification || refreshingVerification || resendCooldown > 0;
  const resendButtonLabel = resendingVerification
    ? "Enviando..."
    : resendCooldown > 0
    ? `Reenviar en ${resendCooldown} s`
    : "Reenviar verificación";
  const routeMeta = getRouteMeta(location.pathname);
  const ownerBusinessLimit = businessSession?.plan?.ownerBusinessLimit;

  const handleOpenBusinessDrawer = () => {
    if (businessSession?.plan?.canCreateBusiness === false) {
      setBusinessLimitOpen(true);
      return;
    }
    if (mobileNavigationOpen) {
      setMobileNavigationOpen(false);
      window.requestAnimationFrame(() => setBusinessDrawerOpen(true));
      return;
    }
    setBusinessDrawerOpen(true);
  };

  const handleBusinessChanged = async (business) => {
    await onBusinessChanged(business.id);
    setMobileNavigationOpen(false);
    setBusinessNotice(
      `Ahora estás trabajando en ${business.nombreComercial}`
    );
  };

  const handleBusinessCreated = async (business) => {
    await onBusinessCreated();
    navigate("/dashboard");
    setBusinessNotice(`${business.nombreComercial} fue creado correctamente`);
  };

  const businessSwitcher = (
    <BusinessSwitcher
      activeBusiness={negocioActivo}
      businesses={businessSession?.businesses || []}
      onAddBusiness={handleOpenBusinessDrawer}
      onBusinessChanged={handleBusinessChanged}
    />
  );

  return (
    <div className="app-shell">
      <SkipLink />

      <aside className="sidebar sidebar--desktop">
        <BrandLogo variant="sidebar" showText />
        {businessSwitcher}
        <PrimaryNavigation idPrefix="desktop" pathname={location.pathname} />
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

          <PageHeader
            eyebrow={negocioActivo?.nombreComercial || "Módulo activo"}
            title={routeMeta.title}
          />

          <div className="topbar-user topbar-user--desktop">
            <div className="topbar-identity" title={usuario?.email || undefined}>
              <span className="sr-only">Usuario:</span>
              <span className="topbar-user-email">{usuario?.email}</span>
              <StatusBadge
                variant={emailVerified ? "success" : "warning"}
                title={
                  emailVerified
                    ? "Correo electrónico verificado"
                    : "Correo electrónico pendiente de verificación"
                }
              >
                <AppIcon
                  icon={emailVerified ? MailCheck : MailWarning}
                  size={14}
                />
                {emailVerified ? "Verificado" : "Pendiente"}
              </StatusBadge>
            </div>
            <Button
              type="button"
              variant="ghost-danger"
              icon={LogOut}
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

        {showVerifiedNotice && (
          <section
            className="verification-notice no-print"
            role="status"
            aria-live="polite"
          >
            {checkMessage}
          </section>
        )}

        {businessNotice && (
          <div className="business-toast no-print" role="status" aria-live="polite">
            {businessNotice}
          </div>
        )}

        {showVerificationBanner && (
          <section
            className="verification-banner no-print"
            aria-labelledby="verification-banner-title"
          >
            <div className="verification-banner__content">
              <strong
                id="verification-banner-title"
                className="verification-banner__title"
              >
                Correo pendiente de verificación
              </strong>
              <p className="verification-banner__text">
                Tu correo aún no está verificado. Revisa tu correo o reenvía la
                verificación.
              </p>
              {resendMessage && (
                <p
                  className="verification-message verification-message--success"
                  role="status"
                >
                  {resendMessage}
                </p>
              )}
              {resendError && (
                <p
                  className="verification-message verification-message--error"
                  role="alert"
                >
                  {resendError}
                </p>
              )}
              {checkMessage && (
                <p className="verification-message" role="status">
                  {checkMessage}
                </p>
              )}
              {checkError && (
                <p
                  className="verification-message verification-message--error"
                  role="alert"
                >
                  {checkError}
                </p>
              )}
            </div>
            <div className="verification-banner__actions">
              <Button
                type="button"
                variant="secondary"
                onClick={handleRefreshVerification}
                disabled={refreshingVerification || resendingVerification}
              >
                {refreshingVerification ? "Verificando..." : "Ya verifiqué"}
              </Button>
              <Button
                type="button"
                onClick={handleResendVerification}
                disabled={resendButtonDisabled}
              >
                {resendButtonLabel}
              </Button>
            </div>
          </section>
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
          {!businessChanging && <Outlet />}
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
          <div className="account-dialog-status">
            <span className="account-dialog-label">Estado de verificación</span>
            <StatusBadge variant={emailVerified ? "success" : "warning"}>
              <AppIcon
                icon={emailVerified ? MailCheck : MailWarning}
                size={14}
              />
              {emailVerified ? "Verificado" : "Pendiente"}
            </StatusBadge>
          </div>
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
            <PrimaryNavigation
              idPrefix="mobile"
              pathname={location.pathname}
              onNavigate={() => setMobileNavigationOpen(false)}
            />
          </aside>
        </div>
      )}

      <AdditionalBusinessDrawer
        open={businessDrawerOpen}
        usuario={usuario}
        onClose={() => setBusinessDrawerOpen(false)}
        onCreated={handleBusinessCreated}
        onLimitReached={() => setBusinessLimitOpen(true)}
      />

      <ResponsiveDialog
        open={businessLimitOpen}
        onClose={() => setBusinessLimitOpen(false)}
        title="Alcanzaste el límite de negocios"
        size="small"
        footer={
          <Button type="button" onClick={() => setBusinessLimitOpen(false)}>
            Entendido
          </Button>
        }
      >
        <p className="business-limit-message">
          Tu plan actual permite administrar hasta {ownerBusinessLimit} negocios
          como propietario.
        </p>
      </ResponsiveDialog>
    </div>
  );
}

export default AppLayout;
