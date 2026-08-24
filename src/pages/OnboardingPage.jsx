import React from "react";
import { ArrowRight, LoaderCircle, LogOut } from "lucide-react";
import BrandLogo from "../components/BrandLogo";
import QuickBusinessFields from "../components/QuickBusinessFields";
import Button from "../components/ui/Button";
import SkipLink from "../components/ui/SkipLink";
import {
  getBusinessCreationErrorMessage,
  INITIAL_ONBOARDING_BUSINESS_VALUES,
  normalizeQuickBusinessPayload,
  ONBOARDING_BUSINESS_FIELD_ORDER,
  validateQuickBusiness,
} from "../domain/businessForm";
import {
  getCountryByCode,
  getCurrencyByCode,
} from "../domain/businessCatalog";
import { logout } from "../services/authService";
import {
  clearBusinessCreationRequestId,
  createFirstBusiness,
  getBusinessCreationRequestId,
} from "../services/businessService";

function OnboardingPage({ usuario, onBusinessCreated }) {
  const [values, setValues] = React.useState(
    INITIAL_ONBOARDING_BUSINESS_VALUES
  );
  const [errors, setErrors] = React.useState({});
  const [touched, setTouched] = React.useState({});
  const [submitted, setSubmitted] = React.useState(false);
  const [submitError, setSubmitError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const fieldRefs = React.useRef({});
  const requestIdRef = React.useRef(null);
  const selectedCountry = getCountryByCode(values.paisCodigo);
  const selectedCurrency = getCurrencyByCode(
    selectedCountry?.defaultCurrencyCode
  );

  const updateValue = (field, value) => {
    const patch =
      field && typeof field === "object" ? field : { [field]: value };
    const nextValues = { ...values, ...patch };
    const nextErrors = validateQuickBusiness(nextValues, {
      requireCountry: true,
      requireRegion: false,
    });
    setValues(nextValues);
    setErrors((current) => {
      if (submitted) return nextErrors;
      const next = { ...current };
      for (const changedField of Object.keys(patch)) {
        if (touched[changedField]) next[changedField] = nextErrors[changedField];
      }
      if (patch.rubroOtro !== undefined && touched.rubroCodigo) {
        next.rubroCodigo = nextErrors.rubroCodigo;
      }
      return next;
    });
    setSubmitError("");
  };

  const validateField = (field, patch = {}) => {
    const nextErrors = validateQuickBusiness(
      { ...values, ...patch },
      { requireCountry: true, requireRegion: false }
    );
    setTouched((current) => ({ ...current, [field]: true }));
    setErrors((current) => ({ ...current, [field]: nextErrors[field] }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    const nextErrors = validateQuickBusiness(values, {
      requireCountry: true,
      requireRegion: false,
    });
    setSubmitted(true);
    setTouched(
      ONBOARDING_BUSINESS_FIELD_ORDER.reduce(
        (result, field) => ({ ...result, [field]: true }),
        {}
      )
    );
    setErrors(nextErrors);
    setSubmitError("");

    const firstInvalidField = ONBOARDING_BUSINESS_FIELD_ORDER.find(
      (field) => nextErrors[field]
    );
    if (firstInvalidField) {
      window.requestAnimationFrame(() =>
        fieldRefs.current[firstInvalidField]?.focus()
      );
      return;
    }

    setIsSubmitting(true);
    try {
      if (!requestIdRef.current) {
        requestIdRef.current = getBusinessCreationRequestId(usuario.uid);
      }
      const result = await createFirstBusiness(
        normalizeQuickBusinessPayload(values),
        requestIdRef.current
      );
      clearBusinessCreationRequestId(usuario.uid);
      requestIdRef.current = null;
      await onBusinessCreated(result.business);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(
          "Error creando el primer negocio:",
          error?.code,
          error?.message
        );
      }
      setSubmitError(getBusinessCreationErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <SkipLink targetId="onboarding-main-content" />
      <main
        id="onboarding-main-content"
        className="onboarding-screen onboarding-screen--quick"
        tabIndex="-1"
      >
        <div className="onboarding-shell onboarding-shell--quick">
          <header className="onboarding-brand-row">
            <BrandLogo
              variant="auth"
              showText
              iconSize={44}
              subtitle="Gestiona, compara y valora tu negocio"
            />
            <div className="onboarding-session">
              <span className="onboarding-session__identity">
                Sesión iniciada como <strong>{usuario.email}</strong>
              </span>
              <Button type="button" variant="ghost" icon={LogOut} onClick={logout}>
                Cerrar sesión
              </Button>
            </div>
          </header>

          <section
            className="onboarding-card onboarding-card--quick"
            aria-labelledby="onboarding-title"
          >
            <div className="onboarding-card__intro">
              <span className="onboarding-step">Comencemos</span>
              <h1 id="onboarding-title">Crea tu primer negocio</h1>
              <p>Ingresa lo esencial para comenzar.</p>
            </div>

            <form
              className="onboarding-form onboarding-form--quick"
              onSubmit={handleSubmit}
              noValidate
              aria-busy={isSubmitting}
            >
              {submitError && (
                <div className="onboarding-alert" role="alert">
                  <strong>No se pudo crear el negocio.</strong>
                  <span>{submitError}</span>
                </div>
              )}

              <QuickBusinessFields
                idPrefix="first-business"
                values={values}
                errors={errors}
                disabled={isSubmitting}
                onChange={updateValue}
                onBlur={validateField}
                showCountry
                showRegion={false}
                setFieldRef={(field, node) => {
                  fieldRefs.current[field] = node;
                }}
              />

              <p className="onboarding-form__defaults">
                {selectedCountry && selectedCurrency
                  ? `${selectedCountry.name} · ${selectedCurrency.code}`
                  : "La moneda inicial se asignará según el país."}
              </p>

              <div className="onboarding-form__actions">
                <Button
                  type="submit"
                  className="onboarding-submit"
                  icon={isSubmitting ? LoaderCircle : ArrowRight}
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                >
                  {isSubmitting ? "Creando negocio..." : "Crear mi negocio"}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </>
  );
}

export default OnboardingPage;
