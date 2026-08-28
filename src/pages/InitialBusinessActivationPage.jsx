import React from "react";
import BrandLogo from "../components/BrandLogo";
import Button from "../components/ui/Button";
import SkipLink from "../components/ui/SkipLink";
import BusinessCompletionCard from "../features/company/BusinessCompletionCard";
import useBusinessCompletionStatus from "../hooks/useBusinessCompletionStatus";

function InitialBusinessActivationPage({
  business,
  ownerEmailVerified,
  onFinish,
}) {
  const { loading, status } = useBusinessCompletionStatus({
    businessId: business?.id,
    ownerEmailVerified,
    initialProfile: business || {},
  });

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
                Completa los datos necesarios y solicita la verificación.
                ValoraCloud se activará cuando tu empresa sea aprobada.
              </p>
            </div>

            <BusinessCompletionCard
  className="business-completion-card--activation"
  description="Completa el perfil y solicita la revisión. La activación depende de la aprobación."
  loading={loading}
  showSummary={false}
  status={status}
  title="Estado inicial de tu empresa"
/>

            <div
              className="activation-actions"
              style={{
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <Button
                type="button"
                onClick={() => finish("/empresa?seccion=verificacion")}
              >
                Completar y verificar empresa
              </Button>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

export default InitialBusinessActivationPage;
