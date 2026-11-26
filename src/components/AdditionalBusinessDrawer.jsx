import React from "react";
import { Building2 } from "lucide-react";
import {
  getCountryByCode,
  getCurrencyByCode,
} from "../domain/businessCatalog";
import {
  applyQuickBusinessChange,
  getBusinessCreationErrorMessage,
  INITIAL_ONBOARDING_BUSINESS_VALUES,
  normalizeQuickBusinessPayload,
  ONBOARDING_BUSINESS_FIELD_ORDER,
  shouldValidateOnBlur,
  validateQuickBusiness,
} from "../domain/businessForm";
import {
  clearAdditionalBusinessCreationRequestId,
  createAdditionalBusiness,
  getAdditionalBusinessCreationRequestId,
} from "../services/businessService";
import QuickBusinessFields from "./QuickBusinessFields";
import Button from "./ui/Button";
import ResponsiveDialog from "./ui/ResponsiveDialog";

// Mismas reglas que el alta del primer negocio: país elegible (Chile por defecto) y región o departamento del país.
const VALIDATION_OPTIONS = { requireCountry: true, requireRegion: true };

function AdditionalBusinessDrawer({
  onClose,
  onCreated,
  open,
  usuario,
}) {
  const [values, setValues] = React.useState(INITIAL_ONBOARDING_BUSINESS_VALUES);
  const [errors, setErrors] = React.useState({});
  const [touched, setTouched] = React.useState({});
  const [editedFields, setEditedFields] = React.useState({});
  const [submitted, setSubmitted] = React.useState(false);
  const [submitError, setSubmitError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const requestIdRef = React.useRef(null);
  const fieldRefs = React.useRef({});
  const keepEditingRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    setValues(INITIAL_ONBOARDING_BUSINESS_VALUES);
    setErrors({});
    setTouched({});
    setEditedFields({});
    setSubmitted(false);
    setSubmitError("");
    setIsSubmitting(false);
    setConfirmDiscard(false);
    requestIdRef.current = null;
  }, [open]);

  React.useEffect(() => {
    if (confirmDiscard) {
      window.requestAnimationFrame(() => keepEditingRef.current?.focus());
    }
  }, [confirmDiscard]);

  React.useEffect(() => {
    if (!confirmDiscard) return undefined;
    const handleConfirmKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setConfirmDiscard(false);
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        document.querySelectorAll(
          ".business-discard-confirm button:not([disabled])"
        )
      );
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleConfirmKeyDown, true);
    return () =>
      document.removeEventListener("keydown", handleConfirmKeyDown, true);
  }, [confirmDiscard]);

  const isDirty = ONBOARDING_BUSINESS_FIELD_ORDER.some(
    (field) => values[field] !== INITIAL_ONBOARDING_BUSINESS_VALUES[field]
  );
  const selectedCountry = getCountryByCode(values.paisCodigo);
  const selectedCurrency = getCurrencyByCode(selectedCountry?.defaultCurrencyCode);

  const updateValue = (field, value) => {
    const patch = applyQuickBusinessChange(
      values,
      field && typeof field === "object" ? field : { [field]: value }
    );
    const nextValues = { ...values, ...patch };
    const nextErrors = validateQuickBusiness(nextValues, VALIDATION_OPTIONS);
    // Cambiar el país limpia la región: empieza de cero, sin "editada", sin "tocada" y sin error.
    const regionReset =
      Object.hasOwn(patch, "paisCodigo") && patch.paisCodigo !== values.paisCodigo;
    if (regionReset) delete nextErrors.regionCodigo;
    setValues(nextValues);
    setEditedFields((current) => {
      const next = { ...current };
      for (const changedField of Object.keys(patch)) next[changedField] = true;
      if (regionReset) next.regionCodigo = false;
      return next;
    });
    if (regionReset) {
      setTouched((current) => ({ ...current, regionCodigo: false }));
    }
    setErrors((current) => {
      if (submitted) return nextErrors;
      const next = { ...current };
      if (regionReset) next.regionCodigo = undefined;
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
    if (
      !shouldValidateOnBlur({
        submitted,
        dirty: Boolean(editedFields[field]),
        hasPatch: Object.keys(patch).length > 0,
      })
    ) {
      return;
    }
    const nextErrors = validateQuickBusiness({ ...values, ...patch }, VALIDATION_OPTIONS);
    setTouched((current) => ({ ...current, [field]: true }));
    setErrors((current) => ({ ...current, [field]: nextErrors[field] }));
  };

  // Salir de la región sin elegir equivale a tocarla y dejarla vacía: se valida aunque no se haya editado.
  const handleBlur = (field, patch = {}) =>
    validateField(
      field,
      field === "regionCodigo" ? { regionCodigo: values.regionCodigo, ...patch } : patch
    );

  const requestClose = () => {
    if (isSubmitting) return;
    if (confirmDiscard) {
      setConfirmDiscard(false);
      return;
    }
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const discardAndClose = () => {
    if (usuario?.uid) clearAdditionalBusinessCreationRequestId(usuario.uid);
    requestIdRef.current = null;
    setConfirmDiscard(false);
    onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    const nextErrors = validateQuickBusiness(values, VALIDATION_OPTIONS);
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
        requestIdRef.current = getAdditionalBusinessCreationRequestId(
          usuario.uid
        );
      }
      const result = await createAdditionalBusiness(
        normalizeQuickBusinessPayload(values),
        requestIdRef.current
      );
      await onCreated(result.business);
      clearAdditionalBusinessCreationRequestId(usuario.uid);
      requestIdRef.current = null;
      onClose();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(
          "Error creando un negocio adicional:",
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
    <ResponsiveDialog
      open={open}
      onClose={requestClose}
      title="Crear un nuevo negocio"
      description="Ingresa sus datos principales. Podrás completar la configuración desde la sección Empresa."
      eyebrow="ValoraCloud"
      className="business-create-drawer business-create-drawer--quick"
      layerClassName="business-create-drawer-layer"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={requestClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="additional-business-form"
            className="business-create-drawer__submit"
            icon={Building2}
            loading={isSubmitting}
          >
            {isSubmitting ? "Creando negocio..." : "Crear negocio"}
          </Button>
        </>
      }
    >
      <p className="business-create-drawer__required-note">
        Los campos marcados con asterisco (*) son obligatorios.
      </p>

      <form
        id="additional-business-form"
        className="business-drawer-form business-drawer-form--quick"
        noValidate
        aria-busy={isSubmitting}
        onSubmit={handleSubmit}
      >
        {submitError && (
          <div className="business-drawer-alert" role="alert">
            <strong>No pudimos crear el negocio.</strong>
            <span>{submitError}</span>
          </div>
        )}

        <QuickBusinessFields
          idPrefix="additional-business"
          values={values}
          errors={errors}
          disabled={isSubmitting}
          onChange={updateValue}
          onBlur={handleBlur}
          showCountry
          showRegion
          grouped
          countryHint={
            selectedCountry && selectedCurrency
              ? `${selectedCountry.name} · ${selectedCurrency.code}`
              : ""
          }
          setFieldRef={(field, node) => {
            fieldRefs.current[field] = node;
          }}
        />

        <p className="business-drawer-form__defaults">
          La moneda se asigna según el país elegido. El resto de los datos se
          completa desde Empresa.
        </p>
      </form>

      {confirmDiscard && (
        <div
          className="business-discard-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="business-discard-title"
        >
          <div className="business-discard-confirm__card">
            <h3 id="business-discard-title">
              Hay cambios sin guardar. ¿Seguro que quieres salir?
            </h3>
            <div className="business-discard-confirm__actions">
              <Button
                ref={keepEditingRef}
                type="button"
                variant="secondary"
                onClick={() => setConfirmDiscard(false)}
              >
                Seguir editando
              </Button>
              <Button type="button" variant="ghost-danger" onClick={discardAndClose}>
                Salir sin guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </ResponsiveDialog>
  );
}

export default AdditionalBusinessDrawer;
