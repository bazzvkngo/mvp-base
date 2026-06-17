import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  logout,
  refreshCurrentUser,
  sendVerificationEmail,
} from "../services/authService";
import BrandLogo from "../components/BrandLogo";

const VERIFICATION_NOTICE_KEY = "valoracloud.verificationNotice";

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
  const [verificationMessage, setVerificationMessage] = React.useState("");
  const [verificationError, setVerificationError] = React.useState("");
  const [resendingVerification, setResendingVerification] = React.useState(false);
  const [refreshingVerification, setRefreshingVerification] = React.useState(false);

  React.useEffect(() => {
    setEmailVerified(usuario?.emailVerified ?? true);
    setVerificationError("");

    const storedMessage = window.sessionStorage.getItem(VERIFICATION_NOTICE_KEY);
    if (storedMessage) {
      setVerificationMessage(storedMessage);
      window.sessionStorage.removeItem(VERIFICATION_NOTICE_KEY);
    } else {
      setVerificationMessage("");
    }
  }, [usuario?.uid, usuario?.emailVerified]);

  const handleResendVerification = async () => {
    setVerificationError("");
    setVerificationMessage("");
    setResendingVerification(true);

    try {
      const refreshedUser = await refreshCurrentUser();
      if (refreshedUser?.emailVerified) {
        setEmailVerified(true);
        return;
      }

      await sendVerificationEmail(refreshedUser || usuario);
      setVerificationMessage(
        "Te enviamos un nuevo correo de verificación. Revisa tu bandeja de entrada."
      );
    } catch (error) {
      console.error("Error reenviando correo de verificación:", error);
      if (error.code === "auth/too-many-requests") {
        setVerificationError(
          "Demasiados intentos. Espera unos minutos antes de reenviar."
        );
      } else {
        setVerificationError(
          "No se pudo reenviar el correo de verificación. Inténtalo nuevamente."
        );
      }
    } finally {
      setResendingVerification(false);
    }
  };

  const handleRefreshVerification = async () => {
    setVerificationError("");
    setRefreshingVerification(true);

    try {
      const refreshedUser = await refreshCurrentUser();
      const isVerified = Boolean(refreshedUser?.emailVerified);
      setEmailVerified(isVerified);

      if (!isVerified) {
        setVerificationError(
          "Tu correo aún figura pendiente de verificación."
        );
      }
    } catch (error) {
      console.error("Error actualizando estado de verificación:", error);
      setVerificationError(
        "No se pudo actualizar el estado de verificación. Inténtalo nuevamente."
      );
    } finally {
      setRefreshingVerification(false);
    }
  };

  const showVerificationBanner = usuario && !emailVerified;

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
            <span>{usuario?.email}</span>
            <button
              type="button"
              className="button-danger"
              onClick={() => logout()}
            >
              Cerrar sesión
            </button>
          </div>
        </header>

        {showVerificationBanner && (
          <section className="no-print" style={styles.verificationBanner}>
            <div>
              <strong style={styles.verificationTitle}>
                Correo pendiente de verificación
              </strong>
              <p style={styles.verificationText}>
                {verificationMessage ||
                  "Tu correo aún no está verificado. Revisa tu correo o reenvía la verificación."}
              </p>
              {verificationError && (
                <p style={styles.verificationError}>{verificationError}</p>
              )}
            </div>
            <div style={styles.verificationActions}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={handleRefreshVerification}
                disabled={refreshingVerification || resendingVerification}
              >
                {refreshingVerification ? "Verificando..." : "Ya verifiqué"}
              </button>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={handleResendVerification}
                disabled={resendingVerification || refreshingVerification}
              >
                {resendingVerification
                  ? "Reenviando..."
                  : "Reenviar verificación"}
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
};

export default AppLayout;

