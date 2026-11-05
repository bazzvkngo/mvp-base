import React, {useEffect, useRef, useState} from "react";
import {Save} from "lucide-react";
import ContactTerritoryFields from "../../components/contacts/ContactTerritoryFields";
import Button from "../../components/ui/Button";
import Disclosure from "../../components/ui/Disclosure";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  formatProviderRut,
  getProviderFieldErrors,
} from "../../domain/providerModel.mjs";
import {formatContactPhoneInput} from "../../domain/contactFormatting.mjs";
import {getFiscalIdentifierLabel, getFiscalIdentifierPlaceholder, normalizeCountryCode} from "../../domain/fiscalIdentifier.mjs";
import {
  getCommuneByCode,
  getRegionByCode,
} from "../../domain/businessCatalog";
import {adaptContactTerritoryForCountry} from "../../domain/contactTerritory.mjs";
import {getProviderErrorMessage} from "../../services/providerService";

const EMPTY_PROVIDER = {
  rut: "",
  razonSocial: "",
  nombreFantasia: "",
  giro: "",
  personaContacto: "",
  email: "",
  telefono: "",
  direccion: "",
  regionCodigo: "",
  regionNombre: "",
  comunaCodigo: "",
  comunaNombre: "",
  condicionesPago: "",
  diasCredito: "",
  notas: "",
};

// Campos dentro del plegable "Más datos". Si alguno trae contenido o un error, el plegable se abre solo.
const OPTIONAL_FIELDS = Object.freeze([
  "nombreFantasia",
  "giro",
  "personaContacto",
  "direccion",
  "regionCodigo",
  "regionNombre",
  "comunaCodigo",
  "comunaNombre",
  "condicionesPago",
  "diasCredito",
  "notas",
]);
// Orden visual de los campos: el primer error se enfoca en este orden, no en el de validación.
const FIELD_ORDER = Object.freeze([
  "rut",
  "razonSocial",
  "email",
  "telefono",
  ...OPTIONAL_FIELDS,
]);

const hasOptionalContent = (values) =>
  OPTIONAL_FIELDS.some((field) => String(values[field] || "").trim());

function toFormValues(provider, countryCode = "CL") {
  if (!provider) return {...EMPTY_PROVIDER};
  const values = Object.fromEntries(
    Object.keys(EMPTY_PROVIDER).map((field) => [
      field,
      // Un 0 guardado equivale a "sin plazo": se muestra vacío para no sugerir un dato que nadie ingresó.
      field === "diasCredito" && !(Number(provider[field]) > 0)
        ? ""
        : String(provider[field] ?? EMPTY_PROVIDER[field]),
    ])
  );
  return adaptContactTerritoryForCountry({
    ...values,
    rut: normalizeCountryCode(countryCode) === "CL"
      ? formatProviderRut(values.rut)
      : values.rut,
    telefono: formatContactPhoneInput(values.telefono, countryCode),
  }, countryCode, provider?.paisCodigo || countryCode);
}

function ProviderField({children, error, field, label, required = false, wide}) {
  const errorId = `provider-${field}-error`;
  return (
    <label className={`client-form-field${wide ? " client-form-field--wide" : ""}`}>
      <span className="client-form-field__label">
        {label}
        {required && <span className="client-form-field__required" aria-hidden="true"> *</span>}
      </span>
      {React.cloneElement(children, {
        "aria-describedby": error ? errorId : undefined,
        "aria-invalid": Boolean(error),
        "aria-required": required || undefined,
        required: required || undefined,
      })}
      {error && (
        <span id={errorId} className="client-form-field__error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

function ProviderFormDialog({countryCode = "CL", onClose, onSubmit, open, provider}) {
  const [values, setValues] = useState(() => toFormValues(provider, countryCode));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(() => hasOptionalContent(toFormValues(provider, countryCode)));
  const [pendingFocus, setPendingFocus] = useState("");
  const firstInputRef = useRef(null);
  const fieldRefs = useRef({});
  const isEditing = Boolean(provider?.proveedorId);
  const country = normalizeCountryCode(countryCode);
  const isChile = country === "CL";
  const fiscalLabel = getFiscalIdentifierLabel(country);

  useEffect(() => {
    if (!open) return;
    const nextValues = toFormValues(provider, country);
    setValues(nextValues);
    setOptionalOpen(hasOptionalContent(nextValues));
    setPendingFocus("");
    setErrors({});
    setServerError("");
    setSaving(false);
  }, [country, open, provider]);

  // Un campo plegado solo existe en el DOM con el plegable abierto: el foco se pide una pasada después de abrirlo.
  useEffect(() => {
    if (!pendingFocus) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      fieldRefs.current[pendingFocus]?.focus();
      setPendingFocus("");
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [pendingFocus]);

  const setFieldRef = (field, node) => {
    fieldRefs.current[field] = node;
    if (field === "rut") firstInputRef.current = node;
  };

  const updateField = (field, value) => {
    setValues((current) => ({...current, [field]: value}));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = {...current};
      delete next[field];
      return next;
    });
    setServerError("");
  };

  const updateTerritory = (patch, clearedErrorFields = []) => {
    setValues((current) => ({...current, ...patch}));
    setErrors((current) => {
      const next = {...current};
      clearedErrorFields.forEach((field) => delete next[field]);
      return next;
    });
    setServerError("");
  };

  const validateField = (field, value = values[field]) => {
    let message = "";
    try {
      message = getProviderFieldErrors(
        {...values, [field]: value},
        {getRegionByCode, getCommuneByCode},
        country
      )[field] || "";
    } catch (error) {
      message = error?.fieldErrors?.[field] || error?.message || "";
    }
    setErrors((current) => {
      const next = {...current};
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  };

  const handleRutChange = (event) => {
    const value = isChile ? formatProviderRut(event.target.value) : event.target.value;
    updateField("rut", value);
  };

  const handlePhoneChange = (event) => {
    updateField("telefono", formatContactPhoneInput(event.target.value, country));
  };

  const handlePaymentChange = (event) => {
    const condicionesPago = event.target.value;
    setValues((current) => ({
      ...current,
      condicionesPago,
      diasCredito: condicionesPago === "credito" ? current.diasCredito : "",
    }));
    setErrors((current) => ({...current, condicionesPago: "", diasCredito: ""}));
    setServerError("");
  };

  const closeSafely = () => {
    if (!saving) onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    let nextErrors = {};
    try {
      nextErrors = getProviderFieldErrors(values, {
        getRegionByCode,
        getCommuneByCode,
      }, country);
    } catch (error) {
      nextErrors = error?.fieldErrors || {};
      setServerError(error?.message || "Revisa los datos ingresados.");
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstField = FIELD_ORDER.find((field) => nextErrors[field]) || Object.keys(nextErrors)[0];
      if (OPTIONAL_FIELDS.includes(firstField)) setOptionalOpen(true);
      setPendingFocus(firstField);
      return;
    }

    const region = isChile ? getRegionByCode(values.regionCodigo) : null;
    const commune = isChile ? getCommuneByCode(values.regionCodigo, values.comunaCodigo) : null;
    setSaving(true);
    setServerError("");
    try {
      await onSubmit({
        ...values,
        paisCodigo: country,
        regionNombre: isChile ? region?.name || "" : values.regionNombre,
        comunaNombre: isChile ? commune?.name || "" : values.comunaNombre,
      });
      onClose();
    } catch (error) {
      setServerError(getProviderErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      className="client-form-dialog"
      description={
        isEditing
          ? "Actualiza la ficha viva. Los futuros documentos deberán conservar su propio snapshot histórico."
          : "Registra los datos comerciales, territoriales y de contacto del proveedor."
      }
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={closeSafely} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="provider-form" icon={Save} loading={saving}>
            {saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Crear proveedor"}
          </Button>
        </>
      )}
      initialFocusRef={firstInputRef}
      onClose={closeSafely}
      open={open}
      size="large"
      title={isEditing ? "Editar proveedor" : "Nuevo proveedor"}
    >
      <form id="provider-form" className="client-form" onSubmit={handleSubmit} noValidate>
        {serverError && (
          <div className="client-message client-message--error" role="alert">
            {serverError}
          </div>
        )}

        <div className="client-form-sections">
          <fieldset className="client-form-section" disabled={saving}>
            <p className="client-form-section__help">
              {fiscalLabel} y razón social son los únicos datos requeridos.
            </p>
            <div className="client-form-grid">
              <ProviderField error={errors.rut} field="rut" label={fiscalLabel} required>
                <input
                  ref={(node) => setFieldRef("rut", node)}
                  value={values.rut}
                  onChange={handleRutChange}
                  onBlur={() => validateField("rut")}
                  inputMode="text"
                  maxLength={isChile ? 12 : 20}
                  placeholder={getFiscalIdentifierPlaceholder(country)}
                />
              </ProviderField>

              <ProviderField error={errors.razonSocial} field="razonSocial" label="Razón social" required>
                <input
                  ref={(node) => setFieldRef("razonSocial", node)}
                  value={values.razonSocial}
                  onChange={(event) => updateField("razonSocial", event.target.value)}
                  autoComplete="organization"
                  placeholder="Ej. Servicios técnicos"
                />
              </ProviderField>

              <ProviderField error={errors.email} field="email" label="Correo">
                <input ref={(node) => setFieldRef("email", node)} type="email" value={values.email} onChange={(event) => updateField("email", event.target.value)} onBlur={() => validateField("email")} autoComplete="email" placeholder="Ej. contacto@empresa.cl" />
              </ProviderField>

              <ProviderField error={errors.telefono} field="telefono" label="Teléfono">
                <input ref={(node) => setFieldRef("telefono", node)} type="tel" value={values.telefono} onChange={handlePhoneChange} onBlur={() => validateField("telefono")} autoComplete="tel" inputMode="tel" maxLength={30} placeholder={isChile ? "Ej. +56 9 6123 4587" : "Ej. +1 202 555 0100"} />
              </ProviderField>
            </div>

            <Disclosure
              description="Nombre de fantasía, giro, contacto, ubicación, condiciones comerciales y notas."
              id="provider-optional-information"
              onOpenChange={setOptionalOpen}
              open={optionalOpen}
              title="Más datos del proveedor (opcional)"
            >
              <div className="client-form-grid">
                <ProviderField error={errors.nombreFantasia} field="nombreFantasia" label="Nombre de fantasía">
                  <input ref={(node) => setFieldRef("nombreFantasia", node)} value={values.nombreFantasia} onChange={(event) => updateField("nombreFantasia", event.target.value)} />
                </ProviderField>

                <ProviderField error={errors.giro} field="giro" label="Giro">
                  <input ref={(node) => setFieldRef("giro", node)} value={values.giro} onChange={(event) => updateField("giro", event.target.value)} />
                </ProviderField>

                <ProviderField error={errors.personaContacto} field="personaContacto" label="Persona de contacto">
                  <input ref={(node) => setFieldRef("personaContacto", node)} value={values.personaContacto} onChange={(event) => updateField("personaContacto", event.target.value)} autoComplete="name" />
                </ProviderField>
              </div>

              <fieldset className="provider-form-subsection">
                <legend>Ubicación</legend>
                <div className="client-form-grid">
                  <ProviderField error={errors.direccion} field="direccion" label="Dirección" wide>
                    <input ref={(node) => setFieldRef("direccion", node)} value={values.direccion} onChange={(event) => updateField("direccion", event.target.value)} autoComplete="street-address" />
                  </ProviderField>

                  <ContactTerritoryFields
                    Field={ProviderField}
                    countryCode={country}
                    errors={errors}
                    onChange={updateTerritory}
                    saving={saving}
                    setFieldRef={setFieldRef}
                    values={values}
                  />
                </div>
              </fieldset>

              <fieldset className="provider-form-subsection">
                <legend>Condiciones comerciales</legend>
                <div className="client-form-grid">
                  <ProviderField error={errors.condicionesPago} field="condicionesPago" label="Condiciones de pago">
                    <select ref={(node) => setFieldRef("condicionesPago", node)} value={values.condicionesPago} onChange={handlePaymentChange}>
                      <option value="">Sin especificar</option>
                      <option value="contado">Contado</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="credito">Crédito</option>
                      <option value="otro">Otro</option>
                    </select>
                  </ProviderField>

                  {values.condicionesPago === "credito" && (
                    <ProviderField error={errors.diasCredito} field="diasCredito" label="Días de crédito">
                      <input ref={(node) => setFieldRef("diasCredito", node)} type="number" min="0" step="1" value={values.diasCredito} onChange={(event) => updateField("diasCredito", event.target.value)} />
                    </ProviderField>
                  )}
                </div>
              </fieldset>

              <div className="client-form-grid">
                <ProviderField error={errors.notas} field="notas" label="Notas internas" wide>
                  <textarea ref={(node) => setFieldRef("notas", node)} value={values.notas} onChange={(event) => updateField("notas", event.target.value)} rows="4" />
                </ProviderField>
              </div>
            </Disclosure>
          </fieldset>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

export default ProviderFormDialog;
