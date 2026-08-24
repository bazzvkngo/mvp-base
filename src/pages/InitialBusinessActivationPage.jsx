import React from "react";
import { Check, Circle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import BrandLogo from "../components/BrandLogo";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import SkipLink from "../components/ui/SkipLink";
import {
  canAccessBusinessPath,
  getDefaultBusinessPath,
} from "../domain/rbac.mjs";
import { getCompanyProfile } from "../services/companyService";

function hasText(value) {
  return Boolean(String(value || "").trim());
}

function getActivationItems(profile = {}) {
  return [
    {
      label: "Nombre del negocio",
      done: hasText(profile.nombreComercial),
    },
    {
      label: "Rubro principal",
      done: hasText(profile.rubroCodigo || profile.rubroNombre),
    },
    { label: "País", done: hasText(profile.paisCodigo) },
    {
      label: "Identificación fiscal",
      done: hasText(profile.identificadorFiscalValor || profile.rut),
    },
    {
      label: "Datos de contacto",
      done: hasText(profile.telefono || profile.email),
    },
    {
      label: "Dirección / ubicación",
      done: hasText(
        profile.direccion ||
          profile.regionCodigo ||
          profile.regionEstado ||
          profile.comunaCodigo ||
          profile.ciudad
      ),
    },
    {
      label: "Logo",
      done: hasText(profile.logoUrl || profile.logoPath),
    },
  ];
}

function InitialBusinessActivationPage({ business, onFinish }) {
  const navigate = useNavigate();
  const [profile, setProfile] = React.useState(business || {});

  React.useEffect(() => {
    if (!business?.id) return undefined;
    let active = true;
    getCompanyProfile(business.id)
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [business]);

  const activationItems = getActivationItems(profile);
  const landingPath = getDefaultBusinessPath(business?.role);
  const companyPath = canAccessBusinessPath(business?.role, "/empresa")
    ? "/empresa"
    : landingPath;

  const finish = (path) => {
    navigate(path, { replace: true });
    onFinish?.();
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

            <ul className="activation-checklist" aria-label="Estado de activación">
              {activationItems.map((item) => (
                <li className={item.done ? "is-complete" : ""} key={item.label}>
                  <AppIcon icon={item.done ? Check : Circle} size={18} />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>

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

export { getActivationItems };
export default InitialBusinessActivationPage;
