import React from "react";
import { Building2, LogOut } from "lucide-react";
import BrandLogo from "../components/BrandLogo";
import Button from "../components/ui/Button";
import SkipLink from "../components/ui/SkipLink";
import { logout } from "../services/authService";

function BusinessUnavailablePage({ usuario, onRetry }) {
  const [retrying, setRetrying] = React.useState(false);
  const [retryError, setRetryError] = React.useState("");

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError("");
    try {
      await onRetry();
    } catch {
      setRetryError(
        "No encontramos un negocio activo todavía. Puedes volver a intentarlo más tarde."
      );
    } finally {
      setRetrying(false);
    }
  };

  return (
    <>
      <SkipLink targetId="business-unavailable-main" />
      <main id="business-unavailable-main" className="onboarding-screen" tabIndex="-1">
        <section className="onboarding-card onboarding-card--message" aria-labelledby="business-unavailable-title">
          <BrandLogo variant="auth" showText />
          <span className="onboarding-icon" aria-hidden="true">
            <Building2 size={24} />
          </span>
          <h1 id="business-unavailable-title">Negocio no disponible</h1>
          <p>
            Tu cuenta ya estuvo asociada a un negocio, pero actualmente no tiene
            acceso a uno activo. Un propietario o administrador debe reactivar el
            negocio o tu membresía.
          </p>
          <div className="onboarding-message-actions">
            <Button type="button" onClick={handleRetry} disabled={retrying}>
              {retrying ? "Comprobando..." : "Reintentar"}
            </Button>
            <Button type="button" variant="secondary" icon={LogOut} onClick={logout}>
              Cerrar sesión
            </Button>
          </div>
          {retryError && <p role="alert">{retryError}</p>}
          <span className="onboarding-message-email">{usuario?.email}</span>
        </section>
      </main>
    </>
  );
}

export default BusinessUnavailablePage;
