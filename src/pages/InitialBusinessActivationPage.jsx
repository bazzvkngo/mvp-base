import React from "react";
import BrandLogo from "../components/BrandLogo";
import Button from "../components/ui/Button";
import SkipLink from "../components/ui/SkipLink";
import {
  canAccessBusinessPath,
  getDefaultBusinessPath,
} from "../domain/rbac.mjs";
import BusinessCompletionCard from "../features/company/BusinessCompletionCard";
import useBusinessCompletionStatus from "../hooks/useBusinessCompletionStatus";

function InitialBusinessActivationPage({ business, ownerEmailVerified, onFinish }) {
  const { loading, status } = useBusinessCompletionStatus({
    businessId: business?.id,
    ownerEmailVerified,
    initialProfile: business || {},
  });
  const landingPath = getDefaultBusinessPath(business?.role);
  const companyPath = canAccessBusinessPath(business?.role, "/empresa")
    ? "/empresa"
    : landingPath;

  const finish = (path) => {
    onFinish?.(path);
  };

  return (
    <>
      <SkipLink targetId="activation-main-content" />
      <main
        id="activation-main-content"
        className="onboarding-screen activation-screen"
        tabIndex="-1"
      >
        <div className="onboarding-shell activation-shell">
          <header className="onboarding-brand-row activation-brand-row">
            <BrandLogo
              variant="auth"
              showText
              iconSize={44}
              subtitle="Gestiona, compara y valora tu negocio"
            />
          </header>

          <section className="onboarding-card activation-card">
            <div className="onboarding-card__intro activation-card__intro">
              <span className="onboarding-step">Primeros pasos</span>
              <h1>Tu negocio ya está creado</h1>
              <p>
                Completa algunos datos para que tus documentos y operaciones
                queden listos.
              </p>
            </div>

            <BusinessCompletionCard
              className="business-completion-card--activation"
              description="Estos son los datos que dejan tu empresa lista para operar."
              loading={loading}
              status={status}
              title="Estado inicial de tu empresa"
            />

            <div className="activation-actions">
              <Button type="button" onClick={() => finish(companyPath)}>
                Completar ahora
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => finish(landingPath)}
              >
                Hacerlo después
              </Button>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

export default InitialBusinessActivationPage;
