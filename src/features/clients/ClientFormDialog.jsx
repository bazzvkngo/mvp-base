import React, { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import ContactTerritoryFields from "../../components/contacts/ContactTerritoryFields";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  formatChileanRut,
  getClientFieldErrors,
} from "../../domain/clientModel.mjs";
import {
  formatContactPhoneInput,
} from "../../domain/contactFormatting.mjs";
import {getFiscalIdentifierLabel, getFiscalIdentifierPlaceholder, normalizeCountryCode} from "../../domain/fiscalIdentifier.mjs";
import {
  getCommuneByCode,
  getRegionByCode,
} from "../../domain/businessCatalog";
import {adaptContactTerritoryForCountry} from "../../domain/contactTerritory.mjs";
import { getClientErrorMessage } from "../../services/clientService";

const EMPTY_CLIENT = {
  tipoCliente: "empresa",
  rut: "",
  nombreRazonSocial: "",
  giro: "",
  email: "",
  telefono: "",
  direccion: "",
  regionCodigo: "",
  regionNombre: "",
  comunaCodigo: "",
  comunaNombre: "",
  personaContacto: "",
  notas: "",
};

function toFormValues(client, countryCode = "CL") {
  if (!client) return {...EMPTY_CLIENT};
  const values = Object.fromEntries(
    Object.keys(EMPTY_CLIENT).map((field) => [
      field,
      String(client[field] ?? EMPTY_CLIENT[field]),
    ])
  );
  return adaptContactTerritoryForCountry({
    ...values,
    rut: normalizeCountryCode(countryCode) === "CL"
      ? formatChileanRut(values.rut)
      : values.rut,
    telefono: formatContactPhoneInput(values.telefono, countryCode),
  }, countryCode, client?.paisCodigo || countryCode);
}

function ClientField({children, error, field, label, required = false, wide}) {
  const errorId = `${field}-error`;
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

function ClientFormDialog({client, countryCode = "CL", onClose, onSubmit, open}) {
  const [values, setValues] = useState(() => toFormValues(client, countryCode));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);
  const firstInputRef = useRef(null);
  const fieldRefs = useRef({});
  const isEditing = Boolean(client?.clienteId);
  const country = normalizeCountryCode(countryCode);
  const isChile = country === "CL";
  const isCompany = values.tipoCliente === "empresa";
  const fiscalLabel = getFiscalIdentifierLabel(country);

  useEffect(() => {
    if (!open) return;
    setValues(toFormValues(client, country));
    setErrors({});
    setServerError("");
    setSaving(false);
  }, [client, country, open]);

  const setFieldRef = (field, node) => {
    fieldRefs.current[field] = node;
    if (field === "tipoCliente") firstInputRef.current = node;
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
      message = getClientFieldErrors({...values, [field]: value}, country)[field] || "";
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

  const handleTypeChange = (event) => {
    const tipoCliente = event.target.value;
    setValues((current) => ({
      ...current,
      tipoCliente,
      ...(tipoCliente === "persona" ? {giro: "", personaContacto: ""} : {}),
    }));
    setErrors((current) => {
      const next = {...current};
      delete next.tipoCliente;
      delete next.giro;
      delete next.personaContacto;
      return next;
    });
    setServerError("");
  };

  const handleRutChange = (event) => {
    const value = isChile ? formatChileanRut(event.target.value) : event.target.value;
    updateField("rut", value);
  };

  const handlePhoneChange = (event) => {
    updateField("telefono", formatContactPhoneInput(event.target.value, country));
  };

  const closeSafely = () => {
    if (!saving) onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    let nextErrors = {};
    try {
      nextErrors = getClientFieldErrors(values, country);
    } catch (error) {
      nextErrors = error?.fieldErrors || {};
      setServerError(error?.message || "Revisa los datos ingresados.");
    }

    if (isChile && values.comunaCodigo && !values.regionCodigo) {
      nextErrors.regionCodigo = "Selecciona una región para la comuna.";
    } else if (
      isChile && values.comunaCodigo &&
      !getCommuneByCode(values.regionCodigo, values.comunaCodigo)
    ) {
      nextErrors.comunaCodigo = "Selecciona una comuna válida.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstField = Object.keys(nextErrors)[0];
      window.requestAnimationFrame(() => fieldRefs.current[firstField]?.focus());
      return;
    }

    const region = isChile ? getRegionByCode(values.regionCodigo) : null;
    const commune = isChile ? getCommuneByCode(
      values.regionCodigo,
      values.comunaCodigo
    ) : null;

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
      setServerError(getClientErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      className="client-form-dialog"
      description={
        isEditing
          ? "Al integrarse con Cotizaciones, las ya guardadas conservarán su copia histórica."
          : "Registra los datos comerciales y de contacto del cliente."
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={closeSafely} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="client-form"
            icon={Save}
            disabled={saving}
          >
            {saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Crear cliente"}
          </Button>
        </>
      }
      initialFocusRef={firstInputRef}
      onClose={closeSafely}
      open={open}
      size="large"
      title={isEditing ? "Editar cliente" : "Nuevo cliente"}
    >
      <form id="client-form" className="client-form" onSubmit={handleSubmit} noValidate>
        {serverError && (
          <div className="client-message client-message--error" role="alert">
            {serverError}
          </div>
        )}

        <div className="client-form-sections">
          <fieldset className="client-form-section" disabled={saving}>
            <legend>Datos del cliente</legend>
            <p className="client-form-section__help">
              Tipo, {fiscalLabel} y {isCompany ? "razón social" : "nombre completo"} son los únicos datos requeridos.
            </p>
            <div className="client-form-grid">

          <ClientField
            error={errors.tipoCliente}
            field="tipoCliente"
            label="Tipo de cliente"
            required
          >
            <select
              ref={(node) => setFieldRef("tipoCliente", node)}
              value={values.tipoCliente}
              onChange={handleTypeChange}
            >
              <option value="empresa">Empresa</option>
              <option value="persona">Persona</option>
            </select>
          </ClientField>

          <ClientField error={errors.rut} field="rut" label={fiscalLabel} required>
            <input
              ref={(node) => setFieldRef("rut", node)}
              value={values.rut}
              onChange={handleRutChange}
              onBlur={() => validateField("rut")}
              inputMode="text"
              maxLength={isChile ? 12 : 20}
              placeholder={getFiscalIdentifierPlaceholder(country)}
            />
          </ClientField>

          <ClientField
            error={errors.nombreRazonSocial}
            field="nombreRazonSocial"
            label={values.tipoCliente === "persona" ? "Nombre completo" : "Razón social"}
            required
            wide
          >
            <input
              ref={(node) => setFieldRef("nombreRazonSocial", node)}
              value={values.nombreRazonSocial}
              onChange={(event) => updateField("nombreRazonSocial", event.target.value)}
              autoComplete={isCompany ? "organization" : "name"}
              placeholder={isCompany ? "Ej. Servicios técnicos" : "Ej. Nombre Apellido"}
            />
          </ClientField>

          {isCompany && (
            <ClientField error={errors.giro} field="giro" label="Giro">
              <input
                ref={(node) => setFieldRef("giro", node)}
                value={values.giro}
                onChange={(event) => updateField("giro", event.target.value)}
              />
            </ClientField>
          )}
            </div>
          </fieldset>

          <fieldset className="client-form-section" disabled={saving}>
            <legend>Contacto <span>(opcional)</span></legend>
            <div className="client-form-grid">
          {isCompany && (
            <ClientField error={errors.personaContacto} field="personaContacto" label="Persona de contacto">
              <input
                ref={(node) => setFieldRef("personaContacto", node)}
                value={values.personaContacto}
                onChange={(event) => updateField("personaContacto", event.target.value)}
                autoComplete="name"
              />
            </ClientField>
          )}

          <ClientField error={errors.email} field="email" label="Correo">
            <input
              ref={(node) => setFieldRef("email", node)}
              type="email"
              value={values.email}
              onChange={(event) => updateField("email", event.target.value)}
              onBlur={() => validateField("email")}
              autoComplete="email"
              placeholder={isCompany ? "Ej. contacto@empresa.cl" : "Ej. nombre@correo.cl"}
            />
          </ClientField>

          <ClientField error={errors.telefono} field="telefono" label="Teléfono">
            <input
              ref={(node) => setFieldRef("telefono", node)}
              type="tel"
              value={values.telefono}
              onChange={handlePhoneChange}
              onBlur={() => validateField("telefono")}
              autoComplete="tel"
              inputMode="tel"
              maxLength={30}
              placeholder={isChile ? "Ej. +56 9 6123 4587" : "Ej. +1 202 555 0100"}
            />
          </ClientField>
            </div>
          </fieldset>

          <fieldset className="client-form-section" disabled={saving}>
            <legend>Ubicación <span>(opcional)</span></legend>
            <div className="client-form-grid">
          <ClientField error={errors.direccion} field="direccion" label="Dirección" wide>
            <input
              ref={(node) => setFieldRef("direccion", node)}
              value={values.direccion}
              onChange={(event) => updateField("direccion", event.target.value)}
              autoComplete="street-address"
            />
          </ClientField>

          <ContactTerritoryFields
            Field={ClientField}
            countryCode={country}
            errors={errors}
            onChange={updateTerritory}
            saving={saving}
            setFieldRef={setFieldRef}
            values={values}
          />
            </div>
          </fieldset>

          <fieldset className="client-form-section" disabled={saving}>
            <legend>Notas <span>(opcional)</span></legend>
            <div className="client-form-grid">
          <ClientField error={errors.notas} field="notas" label="Notas internas" wide>
            <textarea
              ref={(node) => setFieldRef("notas", node)}
              value={values.notas}
              onChange={(event) => updateField("notas", event.target.value)}
              rows="4"
            />
          </ClientField>
            </div>
          </fieldset>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

export default ClientFormDialog;
