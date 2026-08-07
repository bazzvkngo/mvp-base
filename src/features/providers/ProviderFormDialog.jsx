import React, {useEffect, useMemo, useRef, useState} from "react";
import {Save} from "lucide-react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  formatProviderRut,
  getProviderFieldErrors,
} from "../../domain/providerModel.mjs";
import {
  CHILE_REGIONS,
  getCommuneByCode,
  getCommunesForRegion,
  getRegionByCode,
} from "../../domain/businessCatalog";
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
  diasCredito: "0",
  notas: "",
};

function toFormValues(provider) {
  if (!provider) return {...EMPTY_PROVIDER};
  return Object.fromEntries(
    Object.keys(EMPTY_PROVIDER).map((field) => [
      field,
      String(provider[field] ?? EMPTY_PROVIDER[field]),
    ])
  );
}

function ProviderField({children, error, field, label, optional = true, wide}) {
  const errorId = `provider-${field}-error`;
  return (
    <label className={`client-form-field${wide ? " client-form-field--wide" : ""}`}>
      <span className="client-form-field__label">
        {label}
        {optional && <span className="client-form-field__optional">Opcional</span>}
      </span>
      {React.cloneElement(children, {
        "aria-describedby": error ? errorId : undefined,
        "aria-invalid": Boolean(error),
      })}
      {error && (
        <span id={errorId} className="client-form-field__error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

function ProviderFormDialog({onClose, onSubmit, open, provider}) {
  const [values, setValues] = useState(() => toFormValues(provider));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);
  const firstInputRef = useRef(null);
  const fieldRefs = useRef({});
  const isEditing = Boolean(provider?.proveedorId);
  const communes = useMemo(
    () => getCommunesForRegion(values.regionCodigo),
    [values.regionCodigo]
  );

  useEffect(() => {
    if (!open) return;
    setValues(toFormValues(provider));
    setErrors({});
    setServerError("");
    setSaving(false);
  }, [open, provider]);

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

  const handleRegionChange = (event) => {
    const regionCodigo = event.target.value;
    const region = getRegionByCode(regionCodigo);
    setValues((current) => ({
      ...current,
      regionCodigo,
      regionNombre: region?.name || "",
      comunaCodigo: "",
      comunaNombre: "",
    }));
    setErrors((current) => ({...current, regionCodigo: "", comunaCodigo: ""}));
    setServerError("");
  };

  const handleCommuneChange = (event) => {
    const comunaCodigo = event.target.value;
    const commune = getCommuneByCode(values.regionCodigo, comunaCodigo);
    setValues((current) => ({
      ...current,
      comunaCodigo,
      comunaNombre: commune?.name || "",
    }));
    setErrors((current) => ({...current, comunaCodigo: ""}));
    setServerError("");
  };

  const handlePaymentChange = (event) => {
    const condicionesPago = event.target.value;
    setValues((current) => ({
      ...current,
      condicionesPago,
      diasCredito: condicionesPago === "credito" ? current.diasCredito : "0",
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
      });
    } catch (error) {
      nextErrors = error?.fieldErrors || {};
      setServerError(error?.message || "Revisa los datos ingresados.");
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstField = Object.keys(nextErrors)[0];
      window.requestAnimationFrame(() => fieldRefs.current[firstField]?.focus());
      return;
    }

    const region = getRegionByCode(values.regionCodigo);
    const commune = getCommuneByCode(values.regionCodigo, values.comunaCodigo);
    setSaving(true);
    setServerError("");
    try {
      await onSubmit({
        ...values,
        regionNombre: region?.name || "",
        comunaNombre: commune?.name || "",
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
          <Button type="submit" form="provider-form" icon={Save} disabled={saving}>
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

        <fieldset className="client-form-grid" disabled={saving}>
          <legend className="sr-only">Datos del proveedor</legend>

          <ProviderField error={errors.rut} field="rut" label="RUT" optional={false}>
            <input
              ref={(node) => setFieldRef("rut", node)}
              value={values.rut}
              onChange={(event) => updateField("rut", event.target.value)}
              onBlur={() => updateField("rut", formatProviderRut(values.rut))}
              placeholder="12.345.678-5"
            />
          </ProviderField>

          <ProviderField error={errors.razonSocial} field="razonSocial" label="Razón social" optional={false}>
            <input
              ref={(node) => setFieldRef("razonSocial", node)}
              value={values.razonSocial}
              onChange={(event) => updateField("razonSocial", event.target.value)}
              autoComplete="organization"
            />
          </ProviderField>

          <ProviderField error={errors.nombreFantasia} field="nombreFantasia" label="Nombre de fantasía">
            <input ref={(node) => setFieldRef("nombreFantasia", node)} value={values.nombreFantasia} onChange={(event) => updateField("nombreFantasia", event.target.value)} />
          </ProviderField>

          <ProviderField error={errors.giro} field="giro" label="Giro">
            <input ref={(node) => setFieldRef("giro", node)} value={values.giro} onChange={(event) => updateField("giro", event.target.value)} />
          </ProviderField>

          <ProviderField error={errors.personaContacto} field="personaContacto" label="Persona de contacto">
            <input ref={(node) => setFieldRef("personaContacto", node)} value={values.personaContacto} onChange={(event) => updateField("personaContacto", event.target.value)} autoComplete="name" />
          </ProviderField>

          <ProviderField error={errors.email} field="email" label="Correo">
            <input ref={(node) => setFieldRef("email", node)} type="email" value={values.email} onChange={(event) => updateField("email", event.target.value)} autoComplete="email" placeholder="contacto@proveedor.cl" />
          </ProviderField>

          <ProviderField error={errors.telefono} field="telefono" label="Teléfono">
            <input ref={(node) => setFieldRef("telefono", node)} type="tel" value={values.telefono} onChange={(event) => updateField("telefono", event.target.value)} autoComplete="tel" />
          </ProviderField>

          <ProviderField error={errors.direccion} field="direccion" label="Dirección" wide>
            <input ref={(node) => setFieldRef("direccion", node)} value={values.direccion} onChange={(event) => updateField("direccion", event.target.value)} autoComplete="street-address" />
          </ProviderField>

          <ProviderField error={errors.regionCodigo} field="regionCodigo" label="Región">
            <select ref={(node) => setFieldRef("regionCodigo", node)} value={values.regionCodigo} onChange={handleRegionChange}>
              <option value="">Sin especificar</option>
              {CHILE_REGIONS.map((region) => <option key={region.code} value={region.code}>{region.name}</option>)}
            </select>
          </ProviderField>

          <ProviderField error={errors.comunaCodigo} field="comunaCodigo" label="Comuna">
            <select ref={(node) => setFieldRef("comunaCodigo", node)} value={values.comunaCodigo} onChange={handleCommuneChange} disabled={!values.regionCodigo || saving}>
              <option value="">Sin especificar</option>
              {communes.map((commune) => <option key={commune.code} value={commune.code}>{commune.name}</option>)}
            </select>
          </ProviderField>

          <ProviderField error={errors.condicionesPago} field="condicionesPago" label="Condiciones de pago">
            <select ref={(node) => setFieldRef("condicionesPago", node)} value={values.condicionesPago} onChange={handlePaymentChange}>
              <option value="">Sin especificar</option>
              <option value="contado">Contado</option>
              <option value="transferencia">Transferencia</option>
              <option value="credito">Crédito</option>
              <option value="otro">Otro</option>
            </select>
          </ProviderField>

          <ProviderField error={errors.diasCredito} field="diasCredito" label="Días de crédito">
            <input ref={(node) => setFieldRef("diasCredito", node)} type="number" min="0" step="1" value={values.diasCredito} onChange={(event) => updateField("diasCredito", event.target.value)} disabled={values.condicionesPago !== "credito" || saving} />
          </ProviderField>

          <ProviderField error={errors.notas} field="notas" label="Notas" wide>
            <textarea ref={(node) => setFieldRef("notas", node)} value={values.notas} onChange={(event) => updateField("notas", event.target.value)} rows="4" />
          </ProviderField>
        </fieldset>
      </form>
    </ResponsiveDialog>
  );
}

export default ProviderFormDialog;
