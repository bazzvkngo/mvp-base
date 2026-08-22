import React from "react";
import {
  BellRing,
  Building2,
  FileText,
  ImagePlus,
  Landmark,
  PackageCheck,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import BusinessCategoryPicker from "../../components/BusinessCategoryPicker";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  CHILE_REGIONS,
  COUNTRIES,
  CURRENCIES,
  getBusinessCategoryDisplayName,
  getCommuneByCode,
  getCommunesForRegion,
  getRegionByCode,
  getDefaultFiscalIdentifierLabel,
  getDefaultLocaleForCountry,
} from "../../domain/businessCatalog";
import {
  isValidBusinessEmail,
  isValidChileanRut,
  normalizeChileanRut,
} from "../../domain/businessForm";
import {
  ALLOWED_COMPANY_LOGO_TYPES,
  DEFAULT_INVENTORY_SETTINGS,
  DEFAULT_QUOTE_SETTINGS,
  DEFAULT_TAX_SETTINGS,
  MAX_COMPANY_LOGO_SIZE_BYTES,
  deleteCompanyLogo,
  getBusinessSettings,
  getCompanyProfile,
  saveBusinessInformation,
  saveBusinessSettings,
  uploadCompanyLogo,
} from "../../services/companyService";
import {
  deleteBusiness,
  getBusinessDeletionRequestId,
} from "../../services/businessService";
import {
  BUSINESS_VERIFICATION_STATES,
  BUSINESS_VERIFICATION_STATUS_LABELS,
  MAX_VERIFICATION_EVIDENCE_BYTES,
  VERIFICATION_EVIDENCE_TYPES,
  createBusinessVerificationRequestId,
  requestBusinessVerification,
} from "../../services/businessVerificationService";

const SECTIONS = [
  { id: "informacion", label: "Información empresa", icon: Building2 },
  { id: "verificacion", label: "Verificación", icon: ShieldCheck },
  { id: "impuestos", label: "Impuestos", icon: Landmark },
  { id: "inventario", label: "Inventario", icon: PackageCheck },
  { id: "cotizaciones", label: "Cotizaciones", icon: FileText },
  { id: "eliminacion", label: "Eliminar empresa", icon: Trash2, ownerOnly: true },
];

const EMPTY_INFORMATION = {
  nombreComercial: "",
  rubroCodigo: "",
  rubroNombre: "",
  rubroOtro: "",
  paisCodigo: "CL",
  monedaCodigo: "CLP",
  locale: "es-CL",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: "",
  regionCodigo: "",
  comunaCodigo: "",
  razonSocial: "",
  rut: "",
  giro: "",
  email: "",
  telefono: "",
  direccion: "",
  ciudad: "",
  regionEstado: "",
  codigoPostal: "",
  sitioWeb: "",
  logoUrl: "",
  logoPath: "",
  logoNombreOriginal: "",
};

function messageForError(error, fallback) {
  const code = String(error?.code || "");
  if (code.includes("permission-denied")) {
    return "Tu rol no permite modificar esta configuración.";
  }
  if (code.includes("invalid-argument")) return error?.message || fallback;
  if (code.includes("failed-precondition") || code.includes("already-exists")) {
    return error?.message || fallback;
  }
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return "No pudimos conectar con el servicio. Tus cambios siguen en pantalla.";
  }
  return fallback;
}

function isValidOptionalUrl(value) {
  if (!String(value || "").trim()) return true;
  try {
    return ["http:", "https:"].includes(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}

function formatRutInput(value) {
  const normalized = normalizeChileanRut(value).replace(/-/g, "");
  if (normalized.length < 2) return normalized;
  return `${normalized.slice(0, -1)}-${normalized.slice(-1)}`;
}

function validateLogo(file) {
  if (!file) return "Selecciona una imagen.";
  if (!ALLOWED_COMPANY_LOGO_TYPES.includes(file.type)) {
    return "Usa un archivo PNG, JPG o WebP.";
  }
  if (file.size > MAX_COMPANY_LOGO_SIZE_BYTES) {
    return "El logo no puede superar 2 MB.";
  }
  return "";
}

function SectionStatus({ error, success }) {
  if (error) {
    return <p className="settings-message settings-message--error" role="alert">{error}</p>;
  }
  if (success) {
    return (
      <p className="settings-message settings-message--success" role="status" aria-live="polite">
        {success}
      </p>
    );
  }
  return null;
}

function SettingsField({
  children,
  error,
  hint,
  label,
  optional = false,
  required = false,
  wide = false,
}) {
  return (
    <label className={`settings-field${wide ? " settings-field--wide" : ""}`}>
      <span className="settings-field__label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {optional && <span className="settings-field__optional">Opcional</span>}
      </span>
      {children}
      <span className="settings-field__support">
        {error ? <span className="settings-field__error">{error}</span> : hint || "\u00a0"}
      </span>
    </label>
  );
}

function SectionFrame({ children, description, title }) {
  return (
    <section className="settings-section" aria-labelledby={`settings-${title.replaceAll(" ", "-")}`}>
      <header className="settings-section__header">
        <h2 id={`settings-${title.replaceAll(" ", "-")}`}>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function BusinessInformationSection({ businessId, canEdit, onBusinessUpdated }) {
  const fileInputRef = React.useRef(null);
  const [form, setForm] = React.useState(EMPTY_INFORMATION);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [deletingLogo, setDeletingLogo] = React.useState(false);
  const [logoFile, setLogoFile] = React.useState(null);
  const [logoPreview, setLogoPreview] = React.useState("");
  const [touched, setTouched] = React.useState({});
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [logoError, setLogoError] = React.useState("");
  const communes = React.useMemo(
    () => getCommunesForRegion(form.regionCodigo),
    [form.regionCodigo]
  );

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getCompanyProfile(businessId)
      .then((profile) => {
        if (!active) return;
        setForm({ ...EMPTY_INFORMATION, ...profile });
      })
      .catch((loadError) => {
        if (active) {
          setError(messageForError(loadError, "No pudimos cargar la información de la empresa."));
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [businessId]);

  React.useEffect(() => {
    if (!logoFile) {
      setLogoPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const fieldErrors = React.useMemo(() => {
    const errors = {};
    if (!form.nombreComercial.trim()) errors.nombreComercial = "Ingresa el nombre comercial.";
    if (!form.rubroCodigo && !form.rubroNombre) errors.rubroCodigo = "Selecciona una categoría.";
    if (form.rubroCodigo === "OTRO" && form.rubroOtro.trim().length < 2) {
      errors.rubroCodigo = "Describe la categoría del negocio.";
    }
    if (form.paisCodigo === "CL" && !getRegionByCode(form.regionCodigo)) errors.regionCodigo = "Selecciona una región.";
    if (form.paisCodigo !== "CL" && !form.regionEstado.trim()) errors.regionEstado = "Ingresa la región o estado.";
    if (form.paisCodigo === "CL" && form.comunaCodigo && !getCommuneByCode(form.regionCodigo, form.comunaCodigo)) {
      errors.comunaCodigo = "La comuna no corresponde a la región seleccionada.";
    }
    if (form.paisCodigo === "CL" && form.identificadorFiscalValor.trim() && !isValidChileanRut(form.identificadorFiscalValor)) {
      errors.rut = "Ingresa un RUT válido, por ejemplo 12.345.678-5.";
    }
    if (form.email.trim() && !isValidBusinessEmail(form.email)) {
      errors.email = "Ingresa un correo comercial válido.";
    }
    if (!isValidOptionalUrl(form.sitioWeb)) {
      errors.sitioWeb = "Incluye http:// o https:// en la dirección web.";
    }
    return errors;
  }, [form]);
  const recommendedPending = React.useMemo(() => {
    const fields = [];
    if (!form.identificadorFiscalValor.trim()) fields.push("identificación fiscal");
    if (form.paisCodigo === "CL" && !form.comunaCodigo) fields.push("comuna");
    if (!form.direccion.trim()) fields.push("dirección");
    if (!form.telefono.trim() && !form.email.trim()) fields.push("contacto comercial");
    return fields;
  }, [form]);

  const change = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "regionCodigo" && !getCommuneByCode(value, current.comunaCodigo)
        ? { comunaCodigo: "" }
        : {}),
      ...(name === "paisCodigo"
        ? {
            locale: getDefaultLocaleForCountry(value),
            identificadorFiscalTipo: getDefaultFiscalIdentifierLabel(value),
            regionCodigo: "",
            comunaCodigo: "",
            regionEstado: "",
            ciudad: "",
            rut: "",
            identificadorFiscalValor: "",
          }
        : {}),
    }));
    setError("");
    setSuccess("");
  };

  const touch = (name) => setTouched((current) => ({ ...current, [name]: true }));

  const save = async (event) => {
    event.preventDefault();
    setTouched({
      nombreComercial: true,
      rubroCodigo: true,
      regionCodigo: true,
      comunaCodigo: true,
      rut: true,
      email: true,
      sitioWeb: true,
    });
    if (Object.keys(fieldErrors).length) {
      setError("Revisa los campos indicados antes de guardar.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const profile = await saveBusinessInformation(businessId, {
        ...form,
        rut:
          form.paisCodigo === "CL" && form.identificadorFiscalValor
            ? formatRutInput(form.identificadorFiscalValor)
            : form.rut,
        identificadorFiscalValor:
          form.paisCodigo === "CL" && form.identificadorFiscalValor
            ? formatRutInput(form.identificadorFiscalValor)
            : form.identificadorFiscalValor,
      });
      setForm((current) => ({ ...current, ...profile }));
      await onBusinessUpdated?.();
      setSuccess("Información de la empresa guardada correctamente.");
    } catch (saveError) {
      setError(messageForError(saveError, "No pudimos guardar. Tus datos siguen en pantalla."));
    } finally {
      setSaving(false);
    }
  };

  const chooseLogo = (file) => {
    const validationError = validateLogo(file);
    setLogoError(validationError);
    setLogoFile(validationError ? null : file);
    setSuccess("");
  };

  const uploadLogo = async () => {
    const validationError = validateLogo(logoFile);
    if (validationError) {
      setLogoError(validationError);
      return;
    }
    setUploading(true);
    setLogoError("");
    try {
      const logo = await uploadCompanyLogo(businessId, logoFile);
      setForm((current) => ({ ...current, ...logo }));
      setLogoFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSuccess("Logo actualizado correctamente.");
    } catch (uploadError) {
      setLogoError(messageForError(uploadError, "No pudimos subir el logo."));
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    setDeletingLogo(true);
    setLogoError("");
    try {
      await deleteCompanyLogo(businessId, form.logoPath);
      setForm((current) => ({
        ...current,
        logoUrl: "",
        logoPath: "",
        logoNombreOriginal: "",
      }));
      setLogoFile(null);
      setSuccess("Logo eliminado correctamente.");
    } catch (removeError) {
      setLogoError(messageForError(removeError, "No pudimos eliminar el logo."));
    } finally {
      setDeletingLogo(false);
    }
  };

  if (loading) return <p className="settings-loading" role="status">Cargando información...</p>;

  return (
    <SectionFrame
      title="Información de la empresa"
      description="Datos comerciales, localización y formato de los nuevos documentos del negocio activo."
    >
      {[BUSINESS_VERIFICATION_STATES.PENDING, BUSINESS_VERIFICATION_STATES.VERIFIED]
        .includes(form.verificacionEmpresa?.estado) && (
        <p className="settings-message settings-message--warning" role="status">
          Cambiar razón social, país, tipo o identificación fiscal invalidará la verificación actual y requerirá una nueva solicitud.
        </p>
      )}
      <form onSubmit={save} noValidate>
        <fieldset className="settings-fieldset" disabled={!canEdit || saving}>
          <legend className="sr-only">Datos comerciales y logo</legend>
          <div className="settings-card settings-logo-card">
            <div className="settings-logo-preview">
              {logoPreview || form.logoUrl ? (
                <img src={logoPreview || form.logoUrl} alt="Vista previa del logo de la empresa" />
              ) : (
                <AppIcon icon={ImagePlus} size={28} />
              )}
            </div>
            <div className="settings-logo-copy">
              <strong>Logo de la empresa</strong>
              <p>PNG, JPG o WebP. Máximo 2 MB. Se usa en documentos y cotizaciones.</p>
              {form.logoNombreOriginal && <small>{form.logoNombreOriginal}</small>}
            </div>
            {canEdit && (
              <div className="settings-logo-actions">
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => chooseLogo(event.target.files?.[0] || null)}
                />
                <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading || deletingLogo}>
                  {form.logoUrl ? "Reemplazar" : "Seleccionar"}
                </Button>
                {logoFile && (
                  <Button type="button" onClick={uploadLogo} disabled={uploading}>
                    {uploading ? "Subiendo..." : "Subir logo"}
                  </Button>
                )}
                {form.logoUrl && (
                  <Button type="button" variant="ghost-danger" icon={Trash2} onClick={removeLogo} disabled={deletingLogo || uploading}>
                    {deletingLogo ? "Eliminando..." : "Eliminar"}
                  </Button>
                )}
              </div>
            )}
            {logoFile && <p className="settings-logo-file">Seleccionado: {logoFile.name}</p>}
            {logoError && <p className="settings-field__error" role="alert">{logoError}</p>}
          </div>

          <div className="settings-card">
            <h3>Localización y configuración comercial</h3>
            <div className="settings-form-grid">
              <SettingsField label="País" required>
                <select name="paisCodigo" value={form.paisCodigo} onChange={change}>
                  {COUNTRIES.filter((country) => country.active !== false).map((country) => (
                    <option key={country.code} value={country.code}>{country.name}</option>
                  ))}
                </select>
              </SettingsField>
              <SettingsField label="Moneda predeterminada" required hint="Se aplica sólo a documentos nuevos.">
                <select name="monedaCodigo" value={form.monedaCodigo} onChange={change}>
                  {CURRENCIES.filter((currency) => currency.active !== false).map((currency) => (
                    <option key={currency.code} value={currency.code}>{currency.name} ({currency.code})</option>
                  ))}
                </select>
              </SettingsField>
              <SettingsField label="Formato regional" required hint="Controla números, monedas y fechas.">
                <input name="locale" value={form.locale} onChange={change} placeholder="es-CL" />
              </SettingsField>
              <SettingsField label="Tipo / etiqueta fiscal" optional hint={form.paisCodigo === "BR" ? "Puedes usar CNPJ o CPF." : "Configurable según el país."}>
                <input name="identificadorFiscalTipo" value={form.identificadorFiscalTipo} onChange={change} />
              </SettingsField>
              <SettingsField label={form.identificadorFiscalTipo || "Identificación fiscal"} optional error={touched.rut ? fieldErrors.rut : ""}>
                <input name="identificadorFiscalValor" value={form.identificadorFiscalValor} onChange={change} onBlur={() => touch("rut")} />
              </SettingsField>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-form-grid">
              <SettingsField label="Nombre comercial" required error={touched.nombreComercial ? fieldErrors.nombreComercial : ""}>
                <input name="nombreComercial" value={form.nombreComercial} onChange={change} onBlur={() => touch("nombreComercial")} aria-invalid={Boolean(touched.nombreComercial && fieldErrors.nombreComercial)} />
              </SettingsField>
              <div className="settings-field">
                <span className="settings-field__label">Categoría del negocio <span aria-hidden="true">*</span></span>
                <BusinessCategoryPicker
                  id="company-category"
                  value={form.rubroCodigo}
                  customValue={form.rubroOtro}
                  fallbackName={form.rubroNombre}
                  disabled={!canEdit || saving}
                  error={touched.rubroCodigo ? fieldErrors.rubroCodigo : ""}
                  errorId="company-category-error"
                  onTouched={() => touch("rubroCodigo")}
                  onChange={({ code, customName }) => {
                    setForm((current) => ({ ...current, rubroCodigo: code, rubroOtro: customName, rubroNombre: getBusinessCategoryDisplayName(code, customName) }));
                    setTouched((current) => ({ ...current, rubroCodigo: true }));
                  }}
                />
                <span className="settings-field__support">
                  {touched.rubroCodigo && fieldErrors.rubroCodigo ? (
                    <span id="company-category-error" className="settings-field__error">{fieldErrors.rubroCodigo}</span>
                  ) : "\u00a0"}
                </span>
              </div>
              <SettingsField label="Razón social" optional>
                <input name="razonSocial" value={form.razonSocial} onChange={change} />
              </SettingsField>
              <SettingsField label="Giro" optional wide>
                <input name="giro" value={form.giro} onChange={change} />
              </SettingsField>
              {form.paisCodigo === "CL" ? (
                <>
                  <SettingsField label="Región" required error={touched.regionCodigo ? fieldErrors.regionCodigo : ""}>
                    <select name="regionCodigo" value={form.regionCodigo} onChange={change} onBlur={() => touch("regionCodigo")}>
                      <option value="">Selecciona una región</option>
                      {CHILE_REGIONS.map((region) => <option key={region.code} value={region.code}>{region.name}</option>)}
                    </select>
                  </SettingsField>
                  <SettingsField label="Comuna / ciudad" optional error={touched.comunaCodigo ? fieldErrors.comunaCodigo : ""}>
                    <select name="comunaCodigo" value={form.comunaCodigo} onChange={change} onBlur={() => touch("comunaCodigo")} disabled={!form.regionCodigo || !canEdit || saving}>
                      <option value="">Sin comuna</option>
                      {communes.map((commune) => <option key={commune.code} value={commune.code}>{commune.name}</option>)}
                    </select>
                  </SettingsField>
                </>
              ) : (
                <>
                  <SettingsField label="Región / Estado" required error={fieldErrors.regionEstado}>
                    <input name="regionEstado" value={form.regionEstado} onChange={change} />
                  </SettingsField>
                  <SettingsField label="Ciudad" optional>
                    <input name="ciudad" value={form.ciudad} onChange={change} />
                  </SettingsField>
                </>
              )}
              <SettingsField label="Código postal" optional>
                <input name="codigoPostal" value={form.codigoPostal} onChange={change} />
              </SettingsField>
              <SettingsField label="Dirección comercial" optional wide>
                <input name="direccion" value={form.direccion} onChange={change} />
              </SettingsField>
              <SettingsField label="Teléfono comercial" optional>
                <input name="telefono" type="tel" value={form.telefono} onChange={change} />
              </SettingsField>
              <SettingsField label="Correo comercial" optional error={touched.email ? fieldErrors.email : ""}>
                <input name="email" type="email" value={form.email} onChange={change} onBlur={() => touch("email")} aria-invalid={Boolean(touched.email && fieldErrors.email)} />
              </SettingsField>
              <SettingsField label="Sitio web" optional wide error={touched.sitioWeb ? fieldErrors.sitioWeb : ""}>
                <input name="sitioWeb" type="url" placeholder="https://empresa.cl" value={form.sitioWeb} onChange={change} onBlur={() => touch("sitioWeb")} aria-invalid={Boolean(touched.sitioWeb && fieldErrors.sitioWeb)} />
              </SettingsField>
            </div>
          </div>
        </fieldset>
        {form.nombreComercial.trim() &&
          (form.rubroCodigo || form.rubroNombre) &&
          (form.regionCodigo || form.regionEstado) &&
          recommendedPending.length > 0 && (
          <p className="settings-message settings-message--warning" role="status">
            La configuración básica está completa. Recomendado por completar: {recommendedPending.join(", ")}.
          </p>
        )}
        <SectionStatus error={error} success={success} />
        <div className="settings-save-row">
          {!canEdit && <p>Tu rol permite consultar estos datos, pero no editarlos.</p>}
          {canEdit && <Button type="submit" icon={Save} disabled={saving}>{saving ? "Guardando..." : "Guardar información"}</Button>}
        </div>
      </form>
    </SectionFrame>
  );
}

function BusinessVerificationSection({businessId, currentUserUid, role}) {
  const [profile, setProfile] = React.useState(null);
  const [form, setForm] = React.useState({
    razonSocial: "",
    paisCodigo: "CL",
    identificadorFiscalTipo: "RUT",
    identificadorFiscalValor: "",
    relacionSolicitante: "",
    correoSolicitante: "",
    telefonoSolicitante: "",
    observaciones: "",
  });
  const [file, setFile] = React.useState(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const requestRef = React.useRef("");

  React.useEffect(() => {
    requestRef.current = "";
    setFile(null);
    setDialogOpen(false);
    setError("");
    setSuccess("");
    setForm({
      razonSocial: "",
      paisCodigo: "CL",
      identificadorFiscalTipo: "RUT",
      identificadorFiscalValor: "",
      relacionSolicitante: "",
      correoSolicitante: "",
      telefonoSolicitante: "",
      observaciones: "",
    });
  }, [businessId]);

  const load = React.useCallback(async () => {
    const value = await getCompanyProfile(businessId);
    setProfile(value);
    setForm((current) => ({
      ...current,
      razonSocial: value.razonSocial || "",
      paisCodigo: value.paisCodigo || "CL",
      identificadorFiscalTipo: value.identificadorFiscalTipo || "Identificación fiscal",
      identificadorFiscalValor: value.identificadorFiscalValor || "",
      correoSolicitante: value.email || "",
      telefonoSolicitante: value.telefono || "",
    }));
    return value;
  }, [businessId]);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .catch((loadError) => {
        if (active) setError(messageForError(loadError, "No pudimos cargar el estado de verificación."));
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [load]);

  const verification = profile?.verificacionEmpresa || {
    estado: BUSINESS_VERIFICATION_STATES.NOT_VERIFIED,
  };
  const canRequest = role === "OWNER";
  const requestBlocked = [
    BUSINESS_VERIFICATION_STATES.PENDING,
    BUSINESS_VERIFICATION_STATES.VERIFIED,
  ].includes(verification.estado);
  const update = (field, value) => {
    setForm((current) => ({...current, [field]: value}));
    requestRef.current = "";
    setError("");
  };
  const chooseEvidence = (selected) => {
    setError("");
    requestRef.current = "";
    if (!selected) {
      setFile(null);
      return;
    }
    if (!VERIFICATION_EVIDENCE_TYPES.includes(selected.type) ||
      selected.size <= 0 || selected.size > MAX_VERIFICATION_EVIDENCE_BYTES) {
      setFile(null);
      setError("El documento debe ser PDF, JPG o PNG y pesar hasta 5 MB.");
      return;
    }
    setFile(selected);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!form.razonSocial.trim() || !form.identificadorFiscalValor.trim() ||
      form.relacionSolicitante.trim().length < 2 ||
      !isValidBusinessEmail(form.correoSolicitante) ||
      form.telefonoSolicitante.trim().length < 6) {
      setError("Completa razón social, identificación fiscal, cargo, correo y teléfono válidos.");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      if (!requestRef.current) {
        requestRef.current = createBusinessVerificationRequestId();
      }
      await requestBusinessVerification({
        businessId,
        file,
        requestId: requestRef.current,
        solicitud: form,
        uid: currentUserUid,
      });
      await load();
      setDialogOpen(false);
      setFile(null);
      setSuccess("Solicitud enviada. La empresa quedó pendiente de revisión.");
    } catch (submitError) {
      setError(messageForError(submitError, "No pudimos enviar la solicitud de verificación."));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="settings-loading">Cargando verificación...</p>;

  return <SectionFrame title="Verificación empresarial" description="La revisión es realizada por la plataforma y es independiente de los roles del negocio.">
    <div className={`settings-card settings-verification-card is-${verification.estado.toLowerCase()}`}>
      <div className="settings-verification-heading">
        <AppIcon icon={ShieldCheck} size={24} />
        <div><span>Estado actual</span><strong>{BUSINESS_VERIFICATION_STATUS_LABELS[verification.estado]}</strong></div>
      </div>
      {verification.estado === BUSINESS_VERIFICATION_STATES.NOT_VERIFIED && <p>La identidad fiscal de esta empresa aún no ha sido revisada por ValoraCloud.</p>}
      {verification.estado === BUSINESS_VERIFICATION_STATES.PENDING && <p>La solicitud está en revisión. No es necesario volver a enviarla.</p>}
      {verification.estado === BUSINESS_VERIFICATION_STATES.VERIFIED && <p>La razón social y la identidad fiscal fueron verificadas. Los cambios fiscales reiniciarán este estado.</p>}
      {verification.estado === BUSINESS_VERIFICATION_STATES.REJECTED && <p><strong>Motivo:</strong> {verification.motivoRechazo || "La plataforma rechazó la solicitud."}</p>}
      {!canRequest && <p className="settings-verification-help">Sólo el OWNER puede solicitar verificación. ADMIN y MEMBER pueden consultar el estado.</p>}
      {canRequest && !requestBlocked && <Button type="button" icon={ShieldCheck} onClick={() => { setDialogOpen(true); setError(""); }}>Solicitar verificación</Button>}
    </div>
    <SectionStatus error={!dialogOpen ? error : ""} success={success} />
    <ResponsiveDialog open={dialogOpen} onClose={() => !submitting && setDialogOpen(false)} size="large" eyebrow="Acción reservada al OWNER" title="Solicitar verificación empresarial" description="Los datos fiscales deben coincidir con la información guardada de la empresa." footer={<><Button type="button" variant="secondary" disabled={submitting} onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" form="business-verification-form" disabled={submitting}>{submitting ? "Enviando..." : "Enviar solicitud"}</Button></>}>
      <form id="business-verification-form" className="settings-verification-form" onSubmit={submit}>
        <div className="settings-form-grid">
          <SettingsField label="Razón social" required hint="Se verifica contra la empresa guardada."><input value={form.razonSocial} readOnly /></SettingsField>
          <SettingsField label="País" required><input value={form.paisCodigo} readOnly /></SettingsField>
          <SettingsField label={form.identificadorFiscalTipo || "Identificación fiscal"} required><input value={form.identificadorFiscalValor} readOnly /></SettingsField>
          <SettingsField label="Relación o cargo" required><input value={form.relacionSolicitante} onChange={(event) => update("relacionSolicitante", event.target.value)} placeholder="Ej. Representante legal" /></SettingsField>
          <SettingsField label="Correo del solicitante" required><input type="email" value={form.correoSolicitante} onChange={(event) => update("correoSolicitante", event.target.value)} /></SettingsField>
          <SettingsField label="Teléfono del solicitante" required><input type="tel" value={form.telefonoSolicitante} onChange={(event) => update("telefonoSolicitante", event.target.value)} /></SettingsField>
          <SettingsField label="Documento acreditativo" optional wide hint="PDF, JPG o PNG; máximo 5 MB."><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => chooseEvidence(event.target.files?.[0] || null)} />{file && <small>{file.name}</small>}</SettingsField>
          <SettingsField label="Observaciones" optional wide><textarea rows="4" maxLength="4000" value={form.observaciones} onChange={(event) => update("observaciones", event.target.value)} /></SettingsField>
        </div>
        <SectionStatus error={error} />
      </form>
    </ResponsiveDialog>
  </SectionFrame>;
}

function TaxSection({ businessId, canEdit }) {
  const [form, setForm] = React.useState(DEFAULT_TAX_SETTINGS);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  React.useEffect(() => {
    let active = true;
    getBusinessSettings(businessId, "impuestos")
      .then((settings) => active && setForm(settings))
      .catch((loadError) => active && setError(messageForError(loadError, "No pudimos cargar los impuestos.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [businessId]);
  const submit = async (event) => {
    event.preventDefault();
    const rate = Number(form.impuestoPredeterminadoTasa);
    if (!form.impuestoPredeterminadoNombre.trim() || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      setError("Ingresa un nombre y una tasa entre 0 y 100.");
      return;
    }
    setSaving(true); setError(""); setSuccess("");
    try {
      setForm(await saveBusinessSettings(businessId, "impuestos", { ...form, impuestoPredeterminadoTasa: rate }));
      setSuccess("Configuración tributaria guardada correctamente.");
    } catch (saveError) {
      setError(messageForError(saveError, "No pudimos guardar los impuestos."));
    } finally { setSaving(false); }
  };
  return (
    <SectionFrame title="Impuestos" description="Valor predeterminado configurable para documentos nuevos. No define tasas legales ni modifica históricos.">
      {loading ? <p className="settings-loading">Cargando impuestos...</p> : (
        <form onSubmit={submit}>
          <fieldset className="settings-fieldset settings-card" disabled={!canEdit || saving}>
            <legend>Impuesto predeterminado</legend>
            <div className="settings-form-grid">
              <SettingsField label="Nombre" required hint="Ej.: IVA, IGV o Impuesto.">
                <input value={form.impuestoPredeterminadoNombre} onChange={(event) => setForm({ ...form, impuestoPredeterminadoNombre: event.target.value })} />
              </SettingsField>
              <SettingsField label="Tasa (%)" required hint="Se guarda como default del negocio.">
                <input type="number" min="0" max="100" step="0.01" value={form.impuestoPredeterminadoTasa} onChange={(event) => setForm({ ...form, impuestoPredeterminadoTasa: event.target.value })} />
              </SettingsField>
            </div>
          </fieldset>
          <SectionStatus error={error} success={success} />
          <div className="settings-save-row">{canEdit ? <Button type="submit" icon={Save} disabled={saving}>{saving ? "Guardando..." : "Guardar impuestos"}</Button> : <p>Configuración de solo lectura para tu rol.</p>}</div>
        </form>
      )}
    </SectionFrame>
  );
}

function InventorySection({ businessId, canEdit }) {
  const [form, setForm] = React.useState(DEFAULT_INVENTORY_SETTINGS);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  React.useEffect(() => {
    let active = true;
    getBusinessSettings(businessId, "inventario")
      .then((settings) => active && setForm(settings))
      .catch((loadError) => active && setError(messageForError(loadError, "No pudimos cargar el inventario.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [businessId]);
  const submit = async (event) => {
    event.preventDefault();
    if (!Number.isInteger(Number(form.umbralStockBajo)) || Number(form.umbralStockBajo) < 0) {
      setError("Ingresa un umbral entero mayor o igual a cero."); return;
    }
    setSaving(true); setError(""); setSuccess("");
    try {
      setForm(await saveBusinessSettings(businessId, "inventario", { ...form, umbralStockBajo: Number(form.umbralStockBajo) }));
      setSuccess("Preferencias de inventario guardadas correctamente.");
    } catch (saveError) { setError(messageForError(saveError, "No pudimos guardar el inventario.")); }
    finally { setSaving(false); }
  };
  return (
    <SectionFrame title="Inventario" description="Controla alertas y el comportamiento del stock del negocio activo.">
      {loading ? <p className="settings-loading">Cargando preferencias...</p> : (
        <form onSubmit={submit}>
          <fieldset className="settings-fieldset settings-card settings-toggle-list" disabled={!canEdit || saving}>
            <legend className="sr-only">Preferencias de inventario</legend>
            <label className="settings-toggle-row">
              <span><AppIcon icon={BellRing} size={20} /><span><strong>Alertas de stock bajo</strong><small>Avisa cuando un producto alcanza el umbral configurado.</small></span></span>
              <input type="checkbox" role="switch" checked={form.alertasStockBajo} onChange={(event) => setForm({ ...form, alertasStockBajo: event.target.checked })} />
            </label>
            <SettingsField label="Umbral general de stock bajo" hint="Los productos pueden conservar además su mínimo individual.">
              <input type="number" min="0" step="1" value={form.umbralStockBajo} disabled={!form.alertasStockBajo || !canEdit || saving} onChange={(event) => setForm({ ...form, umbralStockBajo: event.target.value })} />
            </SettingsField>
            <label className="settings-toggle-row">
              <span><AppIcon icon={PackageCheck} size={20} /><span><strong>Permitir stock negativo</strong><small>Si se desactiva, ValoraCloud impedirá guardar existencias bajo cero.</small></span></span>
              <input type="checkbox" role="switch" checked={form.permitirStockNegativo} onChange={(event) => setForm({ ...form, permitirStockNegativo: event.target.checked })} />
            </label>
          </fieldset>
          <SectionStatus error={error} success={success} />
          <div className="settings-save-row">{canEdit ? <Button type="submit" icon={Save} disabled={saving}>{saving ? "Guardando..." : "Guardar inventario"}</Button> : <p>Configuración de solo lectura para tu rol.</p>}</div>
        </form>
      )}
    </SectionFrame>
  );
}

function QuoteSection({ businessId, canEdit }) {
  const [form, setForm] = React.useState(DEFAULT_QUOTE_SETTINGS);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  React.useEffect(() => {
    let active = true;
    getBusinessSettings(businessId, "cotizaciones")
      .then((settings) => active && setForm(settings))
      .catch((loadError) => active && setError(messageForError(loadError, "No pudimos cargar las cotizaciones.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [businessId]);
  const change = (event) => {
    const { name, value, checked, type } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
    setSuccess("");
  };
  const submit = async (event) => {
    event.preventDefault();
    const days = Number(form.validezCotizacionDias);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError("La validez debe estar entre 1 y 365 días."); return;
    }
    setSaving(true); setError(""); setSuccess("");
    try {
      setForm(await saveBusinessSettings(businessId, "cotizaciones", { ...form, validezCotizacionDias: days }));
      setSuccess("Valores predeterminados de cotización guardados.");
    } catch (saveError) { setError(messageForError(saveError, "No pudimos guardar las cotizaciones.")); }
    finally { setSaving(false); }
  };
  return (
    <SectionFrame title="Valores predeterminados para nuevas cotizaciones" description="Se aplican al crear una cotización. Los cambios realizados dentro de una cotización afectan sólo a ese documento y no modifican estos valores de Empresa.">
      {loading ? <p className="settings-loading">Cargando valores predeterminados...</p> : (
        <form onSubmit={submit}>
          <fieldset className="settings-fieldset settings-card" disabled={!canEdit || saving}>
            <legend className="sr-only">Valores predeterminados de cotización</legend>
            <div className="settings-form-grid">
              <SettingsField label="Condiciones de pago predeterminadas" wide><textarea name="condicionesPago" rows="3" value={form.condicionesPago} onChange={change} /></SettingsField>
              <SettingsField label="Validez predeterminada (días)"><input name="validezCotizacionDias" type="number" min="1" max="365" value={form.validezCotizacionDias} onChange={change} /></SettingsField>
              <SettingsField label="Plazo de ejecución o entrega" wide optional><textarea name="plazoEntregaCotizacion" rows="2" value={form.plazoEntregaCotizacion} onChange={change} /></SettingsField>
              <SettingsField label="Garantía predeterminada" wide optional><textarea name="garantiaCotizacion" rows="2" value={form.garantiaCotizacion} onChange={change} /></SettingsField>
              <SettingsField label="Alcance geográfico predeterminado" wide optional><textarea name="alcanceGeograficoCotizacion" rows="2" value={form.alcanceGeograficoCotizacion} onChange={change} /></SettingsField>
              <SettingsField label="Exclusiones predeterminadas" wide optional><textarea name="exclusionesCotizacion" rows="3" value={form.exclusionesCotizacion} onChange={change} /></SettingsField>
              <SettingsField label="Nota final predeterminada" wide optional><textarea name="notaFinalCotizacion" rows="3" value={form.notaFinalCotizacion} onChange={change} /></SettingsField>
              <SettingsField label="Términos y condiciones predeterminados" wide optional><textarea name="terminosCotizacion" rows="4" value={form.terminosCotizacion} onChange={change} /></SettingsField>
              <SettingsField label="Pie de documento" wide optional><textarea name="notaPieCotizacion" rows="2" value={form.notaPieCotizacion} onChange={change} /></SettingsField>
            </div>
          </fieldset>
          <SectionStatus error={error} success={success} />
          <div className="settings-save-row">{canEdit ? <Button type="submit" icon={Save} disabled={saving}>{saving ? "Guardando..." : "Guardar cotizaciones"}</Button> : <p>Configuración de solo lectura para tu rol.</p>}</div>
        </form>
      )}
    </SectionFrame>
  );
}

function BusinessDeletionSection({
  businessId,
  businessName,
  currentUserUid,
  onBusinessDeleted,
}) {
  const confirmationInputRef = React.useRef(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState("");
  const expectedName = String(businessName || "").trim();
  const confirmationMatches = Boolean(expectedName) &&
    confirmation.trim() === expectedName;

  const closeDialog = () => {
    if (deleting) return;
    setDialogOpen(false);
    setConfirmation("");
    setError("");
  };

  const confirmDeletion = async () => {
    if (!confirmationMatches || !currentUserUid) return;
    setDeleting(true);
    setError("");
    try {
      const requestId = getBusinessDeletionRequestId(
        currentUserUid,
        businessId
      );
      const result = await deleteBusiness(businessId, requestId);
      await onBusinessDeleted?.(result);
    } catch (deleteError) {
      setError(
        messageForError(
          deleteError,
          "No pudimos eliminar la empresa. Inténtalo nuevamente."
        )
      );
      setDeleting(false);
    }
  };

  return (
    <SectionFrame
      title="Eliminar empresa"
      description="Esta acción retira la empresa del uso normal sin borrar su historial."
    >
      <div className="settings-card settings-danger-zone">
        <div>
          <h3>Eliminación lógica</h3>
          <p>
            La empresa desaparecerá del selector y sus miembros no podrán seguir
            operando. Clientes, documentos, inventario y demás datos históricos
            se conservarán.
          </p>
        </div>
        <Button
          type="button"
          variant="danger"
          icon={Trash2}
          onClick={() => setDialogOpen(true)}
        >
          Eliminar empresa
        </Button>
      </div>

      <ResponsiveDialog
        open={dialogOpen}
        onClose={closeDialog}
        initialFocusRef={confirmationInputRef}
        eyebrow="Acción reservada al OWNER"
        title="Confirma la eliminación de la empresa"
        description="No se borrará ningún dato histórico, pero la empresa dejará de estar disponible para todos sus miembros."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeDialog} disabled={deleting}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              icon={Trash2}
              onClick={confirmDeletion}
              disabled={!confirmationMatches || deleting}
            >
              {deleting ? "Eliminando..." : "Eliminar definitivamente"}
            </Button>
          </>
        }
      >
        <div className="settings-deletion-confirmation">
          <p>
            Escribe <strong>{expectedName}</strong> para confirmar.
          </p>
          <SettingsField
            label="Nombre de la empresa"
            error={confirmation && !confirmationMatches ? "El nombre no coincide." : ""}
          >
            <input
              ref={confirmationInputRef}
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setError("");
              }}
              autoComplete="off"
              aria-invalid={Boolean(confirmation && !confirmationMatches)}
            />
          </SettingsField>
          <SectionStatus error={error} />
        </div>
      </ResponsiveDialog>
    </SectionFrame>
  );
}

function CompanyConfig({
  businessId,
  businessName,
  currentUserUid,
  onBusinessDeleted,
  onBusinessUpdated,
  role,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("seccion") || "informacion";
  const availableSections = SECTIONS.filter(
    (section) => !section.ownerOnly || role === "OWNER"
  );
  const activeSection = availableSections.some((section) => section.id === requestedSection)
    ? requestedSection
    : "informacion";
  const canEdit = role === "OWNER" || role === "ADMIN";

  if (!businessId) return <p className="settings-message settings-message--error">No hay un negocio activo.</p>;

  return (
    <section className="erp-page company-settings-page">
      <div className="settings-page-intro">
        <div>
          <h1>Configuración de empresa</h1>
          <p>Administra por separado la identidad y las reglas del negocio activo.</p>
        </div>
        <span className={`settings-role-badge${canEdit ? "" : " is-readonly"}`}>
          {canEdit ? `${role} · Puede editar` : "MEMBER · Solo lectura"}
        </span>
      </div>
      <div className="settings-layout">
        <nav className="settings-subnav" aria-label="Secciones de empresa">
          <span className="settings-subnav__label">Empresa</span>
          {availableSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={activeSection === section.id ? "is-active" : ""}
              aria-current={activeSection === section.id ? "page" : undefined}
              onClick={() => setSearchParams({ seccion: section.id })}
            >
              <AppIcon icon={section.icon} size={18} />
              <span>{section.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {activeSection === "informacion" && <BusinessInformationSection businessId={businessId} canEdit={canEdit} onBusinessUpdated={onBusinessUpdated} />}
          {activeSection === "verificacion" && <BusinessVerificationSection businessId={businessId} currentUserUid={currentUserUid} role={role} />}
          {activeSection === "impuestos" && <TaxSection businessId={businessId} canEdit={canEdit} />}
          {activeSection === "inventario" && <InventorySection businessId={businessId} canEdit={canEdit} />}
          {activeSection === "cotizaciones" && <QuoteSection businessId={businessId} canEdit={canEdit} />}
          {activeSection === "eliminacion" && role === "OWNER" && (
            <BusinessDeletionSection
              businessId={businessId}
              businessName={businessName}
              currentUserUid={currentUserUid}
              onBusinessDeleted={onBusinessDeleted}
            />
          )}
        </div>
      </div>
    </section>
  );
}

export default CompanyConfig;
