import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  logout,
  refreshCurrentUser,
  sendVerificationEmail,
} from "../services/authService";
import BrandLogo from "../components/BrandLogo";

const VERIFICATION_NOTICE_KEY = "valoracloud.verificationNotice";
const RESEND_COOLDOWN_SECONDS = 60;

const navItems = [
  { to: "/dashboard", label: "Dashboard", end: true },
  { to: "/empresa", label: "Empresa", end: true },
  { to: "/inventario", label: "Inventario", end: true },
  { to: "/referencias", label: "Referencias", end: true },
  { to: "/valorizacion", label: "Valoración", end: true },
  { to: "/cotizaciones/nueva", label: "Nueva cotización", end: true },
  { to: "/cotizaciones", label: "Historial", end: true },
];

function AppLayout({ usuario }) {
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
  const verificationBadge = emailVerified
    ? {
        label: "✓ Verificado",
        title: "Correo electrónico verificado",
        style: styles.verifiedBadge,
      }
    : {
        label: "Pendiente",
        title: "Correo electrónico pendiente de verificación",
        style: styles.pendingBadge,
      };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandLogo variant="sidebar" showText />

        <nav className="sidebar-nav" aria-label="Navegación principal">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? "nav-link nav-link-active" : "nav-link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Sistema de valorización y cotizaciones</span>
            <h1>ValoraCloud</h1>
          </div>
          <div className="topbar-user">
            <div style={styles.userIdentity}>
              <span style={styles.userEmail}>{usuario?.email}</span>
              <span
                aria-label={verificationBadge.title}
                title={verificationBadge.title}
                style={{
                  ...styles.verificationBadge,
                  ...verificationBadge.style,
                }}
              >
                {verificationBadge.label}
              </span>
            </div>
            <button
              type="button"
              className="button-danger"
              onClick={() => logout()}
            >
              Cerrar sesión
            </button>
          </div>
        </header>

        {showVerifiedNotice && (
          <section className="no-print" style={styles.verifiedNotice}>
            {checkMessage}
          </section>
        )}

        {showVerificationBanner && (
          <section className="no-print" style={styles.verificationBanner}>
            <div>
              <strong style={styles.verificationTitle}>
                Correo pendiente de verificación
              </strong>
              <p style={styles.verificationText}>
                Tu correo aún no está verificado. Revisa tu correo o reenvía la verificación.
              </p>
              {resendMessage && (
                <p style={styles.verificationSuccess}>{resendMessage}</p>
              )}
              {resendError && (
                <p style={styles.verificationError}>{resendError}</p>
              )}
              {checkMessage && (
                <p style={styles.verificationWarning}>{checkMessage}</p>
              )}
              {checkError && (
                <p style={styles.verificationError}>{checkError}</p>
              )}
            </div>
            <div style={styles.verificationActions}>
              <button
                type="button"
                style={{
                  ...styles.secondaryButton,
                  ...(refreshingVerification || resendingVerification
                    ? styles.buttonDisabled
                    : {}),
                }}
                onClick={handleRefreshVerification}
                disabled={refreshingVerification || resendingVerification}
              >
                {refreshingVerification ? "Verificando..." : "Ya verifiqué"}
              </button>
              <button
                type="button"
                style={{
                  ...styles.primaryButton,
                  ...(resendButtonDisabled ? styles.buttonDisabled : {}),
                }}
                onClick={handleResendVerification}
                disabled={resendButtonDisabled}
              >
                {resendButtonLabel}
              </button>
            </div>
          </section>
        )}

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const styles = {
  verificationBanner: {
    alignItems: "center",
    background: "#fffbeb",
    borderBottom: "1px solid #fde68a",
    color: "#92400e",
    display: "flex",
    gap: "16px",
    justifyContent: "space-between",
    padding: "12px 28px",
  },
  verificationTitle: {
    display: "block",
    fontSize: "0.92rem",
    marginBottom: "2px",
  },
  verificationText: {
    fontSize: "0.88rem",
    lineHeight: 1.45,
    margin: 0,
  },
  verificationError: {
    color: "#b91c1c",
    fontSize: "0.84rem",
    margin: "4px 0 0",
  },
  verificationSuccess: {
    color: "#047857",
    fontSize: "0.84rem",
    margin: "4px 0 0",
  },
  verificationWarning: {
    color: "#92400e",
    fontSize: "0.84rem",
    fontWeight: 600,
    margin: "4px 0 0",
  },
  verificationActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    justifyContent: "flex-end",
  },
  primaryButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 700,
    padding: "8px 11px",
    whiteSpace: "nowrap",
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #f59e0b",
    borderRadius: "6px",
    color: "#92400e",
    cursor: "pointer",
    fontWeight: 700,
    padding: "8px 11px",
    whiteSpace: "nowrap",
  },
  buttonDisabled: {
    cursor: "not-allowed",
    opacity: 0.68,
  },
  userIdentity: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    minWidth: 0,
  },
  userEmail: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  verificationBadge: {
    borderRadius: "999px",
    display: "inline-flex",
    flexShrink: 0,
    fontSize: "0.72rem",
    fontWeight: 700,
    lineHeight: 1,
    padding: "4px 7px",
    whiteSpace: "nowrap",
  },
  verifiedBadge: {
    background: "#dcfce7",
    border: "1px solid #bbf7d0",
    color: "#166534",
  },
  pendingBadge: {
    background: "#fef3c7",
    border: "1px solid #fde68a",
    color: "#92400e",
  },
  verifiedNotice: {
    background: "#ecfdf5",
    borderBottom: "1px solid #a7f3d0",
    color: "#047857",
    fontSize: "0.88rem",
    fontWeight: 700,
    padding: "10px 28px",
  },
};

export default AppLayout;

