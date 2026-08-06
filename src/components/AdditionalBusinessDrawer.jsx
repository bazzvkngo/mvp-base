import React from "react";
import { Building2, LoaderCircle } from "lucide-react";
import {
  getBusinessCreationErrorMessage,
  INITIAL_QUICK_BUSINESS_VALUES,
  normalizeQuickBusinessPayload,
  QUICK_BUSINESS_FIELD_ORDER,
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

function AdditionalBusinessDrawer({
  onClose,
  onCreated,
  onLimitReached,
  open,
  usuario,
}) {
  const [values, setValues] = React.useState(INITIAL_QUICK_BUSINESS_VALUES);
  const [errors, setErrors] = React.useState({});
  const [touched, setTouched] = React.useState({});
  const [submitted, setSubmitted] = React.useState(false);
  const [submitError, setSubmitError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const requestIdRef = React.useRef(null);
  const fieldRefs = React.useRef({});
  const keepEditingRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    setValues(INITIAL_QUICK_BUSINESS_VALUES);
    setErrors({});
    setTouched({});
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

  const isDirty = QUICK_BUSINESS_FIELD_ORDER.some(
    (field) => values[field] !== INITIAL_QUICK_BUSINESS_VALUES[field]
  );

  const updateValue = (field, value) => {
    const patch =
      field && typeof field === "object" ? field : { [field]: value };
    const nextValues = { ...values, ...patch };
    const nextErrors = validateQuickBusiness(nextValues);
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
    const nextErrors = validateQuickBusiness({ ...values, ...patch });
    setTouched((current) => ({ ...current, [field]: true }));
    setErrors((current) => ({ ...current, [field]: nextErrors[field] }));
  };

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

    const nextErrors = validateQuickBusiness(values);
    setSubmitted(true);
    setTouched(
      QUICK_BUSINESS_FIELD_ORDER.reduce(
        (result, field) => ({ ...result, [field]: true }),
        {}
      )
    );
    setErrors(nextErrors);
    setSubmitError("");
    const firstInvalidField = QUICK_BUSINESS_FIELD_ORDER.find(
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
      if (String(error?.code || "").includes("resource-exhausted")) {
        onLimitReached?.(error?.details?.ownerBusinessLimit);
      }
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
        <Button
          type="submit"
          form="additional-business-form"
          className="business-create-drawer__submit"
          icon={isSubmitting ? LoaderCircle : Building2}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? "Creando negocio..." : "Crear negocio"}
        </Button>
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
          onBlur={validateField}
          setFieldRef={(field, node) => {
            fieldRefs.current[field] = node;
          }}
        />

        <p className="business-drawer-form__defaults">
          Se asignarán automáticamente Chile y CLP. El resto de los datos se
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
