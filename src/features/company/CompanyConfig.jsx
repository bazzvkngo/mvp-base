import React from "react";
import {
  BellRing,
  Building2,
  FileUp,
  FileText,
  ImagePlus,
  Landmark,
  Lock,
  PackageCheck,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import BusinessCategoryPicker from "../../components/BusinessCategoryPicker";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  CHILE_REGIONS,
  getBusinessCategoryDisplayName,
  getCommuneByCode,
  getCommunesForRegion,
  getCountryByCode,
  getRegionByCode,
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
  MAX_COMPANY_LOGO_SIZE_BYTES,
  deleteCompanyLogo,
  getBusinessSettings,
  getCompanyProfile,
  getPersonalProfile,
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
import BusinessCompletionCard from "./BusinessCompletionCard";

const SECTIONS = [
  { id: "informacion", label: "Información empresa", icon: Building2 },
  { id: "verificacion", label: "Verificación", icon: ShieldCheck },
  { id: "impuestos", label: "Impuestos", icon: Landmark },
  { id: "inventario", label: "Inventario", icon: PackageCheck },
  { id: "cotizaciones", label: "Cotizaciones", icon: FileText },
  { id: "eliminacion", label: "Eliminar empresa", icon: Trash2, ownerOnly: true },
];
const ACTIVATION_SECTION_IDS = new Set(["informacion", "verificacion"]);

const COMPLETION_TARGETS = Object.freeze({
  identity: "identidad",
  commercialConfiguration: "configuracion",
  fiscalIdentity: "fiscal",
  contact: "contacto",
  address: "direccion",
  logo: "logo",
});

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
    return "No tienes permisos para acceder a esta sección.";
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

function verificationMessageForError(error) {
  const code = String(error?.code || "").toLowerCase();
  if (error?.verificationStage === "document-upload") {
    return "No pudimos subir el documento. Intenta nuevamente.";
  }
  if (code.includes("permission-denied") || code.includes("unauthenticated")) {
    return "No tienes permisos para acceder a esta sección.";
  }
  if (code.includes("invalid-argument")) {
    return "Revisa la identificación fiscal y los datos del solicitante.";
  }
  if (code.includes("already-exists")) {
    return "Esta solicitud ya fue utilizada. Recarga la página e intenta nuevamente.";
  }
  if (code.includes("failed-precondition")) {
    return "La empresa no está disponible para esta solicitud o ya tiene una revisión en curso.";
  }
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return "No pudimos conectar con el servicio. Intenta nuevamente.";
  }
  return "No pudimos enviar la solicitud. Revisa los datos e intenta nuevamente.";
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
  targetId,
  wide = false,
}) {
  return (
    <label id={targetId} className={`settings-field${wide ? " settings-field--wide" : ""}`}>
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

function LockedSetting({label, value, targetId, trailing}) {
  return (
    <div id={targetId} className="settings-field settings-locked-field">
      <span className="settings-field__label">{label}</span>
      <div className="settings-locked-field__value">
        <span>{value || "—"}</span>
        {trailing || <AppIcon icon={Lock} size={16} />}
      </div>
    </div>
  );
}

function SectionFrame({ children, description, title }) {
  return (
    <section className="settings-section" aria-labelledby={`settings-${title.replaceAll(" ", "-")}`}>
      <header className="settings-section__header">
        <h2 id={`settings-${title.replaceAll(" ", "-")}`} tabIndex="-1">{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function focusCompanyTarget(target) {
  const container = document.getElementById(`empresa-${target}`);
  if (!container) return;
  container.scrollIntoView({ behavior: "smooth", block: "center" });
  const control = container.matches("input, select, textarea, button")
    ? container
    : container.querySelector("input, select, textarea, button");
  control?.focus({ preventScroll: true });
}

function BusinessInformationSection({ businessId, canEdit, focusTarget, onBusinessUpdated }) {
  const navigate = useNavigate();
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
    if (loading || !focusTarget) return undefined;
    const frameId = window.requestAnimationFrame(() => focusCompanyTarget(focusTarget));
    return () => window.cancelAnimationFrame(frameId);
  }, [focusTarget, loading]);

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
    if (!form.rubroCodigo && !form.rubroNombre) errors.rubroCodigo = "Selecciona un rubro.";
    if (form.rubroCodigo === "OTRO" && form.rubroOtro.trim().length < 2) {
      errors.rubroCodigo = "Describe el rubro del negocio.";
    }
    if (form.paisCodigo === "CL" && !getRegionByCode(form.regionCodigo)) errors.regionCodigo = "Selecciona una región.";
    if (form.paisCodigo !== "CL" && !form.regionEstado.trim()) errors.regionEstado = "Ingresa la región o estado.";
    if (form.paisCodigo === "CL" && form.comunaCodigo && !getCommuneByCode(form.regionCodigo, form.comunaCodigo)) {
      errors.comunaCodigo = "La comuna no corresponde a la región seleccionada.";
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
      const profile = await saveBusinessInformation(businessId, form);
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
      description="Identidad, ubicación y datos necesarios para la activación."
    >
      {[BUSINESS_VERIFICATION_STATES.PENDING, BUSINESS_VERIFICATION_STATES.VERIFIED]
        .includes(form.verificacionEmpresa?.estado) && (
        <p className="settings-message settings-message--warning" role="status">
          Cambiar la razón social invalidará la verificación actual y requerirá una nueva solicitud.
        </p>
      )}
      <form onSubmit={save} noValidate>
        <fieldset className="settings-fieldset" disabled={!canEdit || saving}>
          <legend className="sr-only">Datos comerciales y logo</legend>
          <div className="settings-card company-information-card">
            <div className="company-information-card__header">
              <h3>Jurisdicción fiscal registrada</h3>
              <p>Datos definidos al crear la empresa.</p>
            </div>
            <div className="settings-form-grid">
              <LockedSetting
                label="País"
                targetId="empresa-configuracion"
                value={form.paisNombre || getCountryByCode(form.paisCodigo)?.name || form.paisCodigo}
              />
              <LockedSetting
                label="Moneda nacional"
                value={`${form.monedaNombre || form.monedaCodigo} (${form.monedaCodigo})`}
              />
              <LockedSetting label="Formato regional" value={form.locale} />
              <LockedSetting
                label="Identificación fiscal"
                value={form.identificadorFiscalTipo}
              />
              <div id="empresa-fiscal" className="settings-field settings-locked-field settings-field--wide">
                <span className="settings-field__label">
                  Estado del {form.identificadorFiscalTipo || "identificador fiscal"}
                </span>
                {form.verificacionEmpresa?.estado === BUSINESS_VERIFICATION_STATES.VERIFIED ? (
                  <div className="settings-locked-field__value is-verified">
                    <strong>{form.identificadorFiscalValor || "—"}</strong>
                    <span>✓ Verificado</span>
                  </div>
                ) : (
                  <div className="settings-fiscal-pending">
                    <span className={`settings-verification-pill is-${(form.verificacionEmpresa?.estado || BUSINESS_VERIFICATION_STATES.NOT_VERIFIED).toLowerCase()}`}>
                      {(form.verificacionEmpresa?.estado || BUSINESS_VERIFICATION_STATES.NOT_VERIFIED) === BUSINESS_VERIFICATION_STATES.NOT_VERIFIED
                        ? `${form.identificadorFiscalTipo || "Identificador fiscal"} no verificado`
                        : BUSINESS_VERIFICATION_STATUS_LABELS[
                          form.verificacionEmpresa?.estado || BUSINESS_VERIFICATION_STATES.NOT_VERIFIED
                        ]}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      icon={ShieldCheck}
                      onClick={() => navigate("/empresa?seccion=verificacion")}
                    >
                      Ir a verificación
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="settings-card company-information-card">
            <div className="company-information-card__header">
              <h3>Identidad comercial</h3>
            </div>
            <div className="settings-form-grid">
              <SettingsField label="Nombre comercial" required error={touched.nombreComercial ? fieldErrors.nombreComercial : ""} targetId="empresa-identidad">
                <input name="nombreComercial" value={form.nombreComercial} onChange={change} onBlur={() => touch("nombreComercial")} aria-invalid={Boolean(touched.nombreComercial && fieldErrors.nombreComercial)} />
              </SettingsField>
              <div className="settings-field">
                <span className="settings-field__label">Rubro principal <span aria-hidden="true">*</span></span>
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
                  ) : "Selecciona la actividad que mejor representa los servicios de tu empresa."}
                </span>
              </div>
              <LockedSetting
                label="Razón social oficial"
                value={form.razonSocial || "Aún no registrada"}
              />
              <SettingsField label="Giro" wide>
                <input name="giro" value={form.giro} onChange={change} />
              </SettingsField>
            </div>
            <div id="empresa-logo" className="settings-logo-card settings-logo-card--embedded">
              <div className="settings-logo-preview">
                {logoPreview || form.logoUrl ? (
                  <img src={logoPreview || form.logoUrl} alt="Vista previa del logo de la empresa" />
                ) : (
                  <AppIcon icon={ImagePlus} size={28} />
                )}
              </div>
              <div className="settings-logo-copy">
                <strong>Logo de la empresa</strong>
                <p>PNG, JPG o WebP · máximo 2 MB.</p>
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
          </div>

          <div className="settings-card company-information-card">
            <div className="company-information-card__header">
              <h3>Ubicación y contacto</h3>
            </div>
            <div className="settings-form-grid">
              {form.paisCodigo === "CL" ? (
                <>
                  <SettingsField label="Región" required error={touched.regionCodigo ? fieldErrors.regionCodigo : ""}>
                    <select name="regionCodigo" value={form.regionCodigo} onChange={change} onBlur={() => touch("regionCodigo")}>
                      <option value="">Selecciona una región</option>
                      {CHILE_REGIONS.map((region) => <option key={region.code} value={region.code}>{region.name}</option>)}
                    </select>
                  </SettingsField>
                  <SettingsField label="Comuna / ciudad" error={touched.comunaCodigo ? fieldErrors.comunaCodigo : ""}>
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
                  <SettingsField label="Ciudad">
                    <input name="ciudad" value={form.ciudad} onChange={change} />
                  </SettingsField>
                </>
              )}
              <SettingsField label="Código postal">
                <input name="codigoPostal" value={form.codigoPostal} onChange={change} />
              </SettingsField>
              <SettingsField label="Dirección comercial" targetId="empresa-direccion" wide>
                <input name="direccion" value={form.direccion} onChange={change} />
              </SettingsField>
              <SettingsField label="Teléfono comercial" targetId="empresa-contacto">
                <input name="telefono" type="tel" value={form.telefono} onChange={change} />
              </SettingsField>
              <SettingsField label="Correo comercial" error={touched.email ? fieldErrors.email : ""}>
                <input name="email" type="email" value={form.email} onChange={change} onBlur={() => touch("email")} aria-invalid={Boolean(touched.email && fieldErrors.email)} />
              </SettingsField>
              <SettingsField label="Sitio web" wide error={touched.sitioWeb ? fieldErrors.sitioWeb : ""}>
                <input name="sitioWeb" type="url" placeholder="https://www.empresa.com" value={form.sitioWeb} onChange={change} onBlur={() => touch("sitioWeb")} aria-invalid={Boolean(touched.sitioWeb && fieldErrors.sitioWeb)} />
              </SettingsField>
            </div>
          </div>
        </fieldset>
        {form.nombreComercial.trim() &&
          (form.rubroCodigo || form.rubroNombre) &&
          (form.regionCodigo || form.regionEstado) &&
          recommendedPending.length > 0 && (
          <p className="settings-message settings-message--warning" role="status">
            Pendiente por completar: {recommendedPending.join(", ")}.
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

function BusinessVerificationSection({
  businessId,
  currentUserEmail,
  currentUserPhone,
  currentUserUid,
  role,
}) {
  const [profile, setProfile] = React.useState(null);
  const [form, setForm] = React.useState({
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
  const fileInputRef = React.useRef(null);
  const submittingRef = React.useRef(false);

  React.useEffect(() => {
    requestRef.current = "";
    setFile(null);
    setDialogOpen(false);
    setError("");
    setSuccess("");
    setForm({
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
    const [value, personalProfile] = await Promise.all([
      getCompanyProfile(businessId),
      currentUserUid
        ? getPersonalProfile(currentUserUid).catch(() => null)
        : Promise.resolve(null),
    ]);
    setProfile(value);
    setForm((current) => ({
      ...current,
      paisCodigo: value.paisCodigo || "CL",
      identificadorFiscalTipo: value.identificadorFiscalTipo || "Identificación fiscal",
      identificadorFiscalValor:
        value.verificacionEmpresa?.identificadorFiscalDeclaradoValor ||
        value.verificacionEmpresa?.identificadorFiscalValor ||
        value.identificadorFiscalValor || "",
      correoSolicitante: current.correoSolicitante ||
        currentUserEmail || value.email || "",
      telefonoSolicitante: current.telefonoSolicitante ||
        personalProfile?.telefonoPersonal || currentUserPhone ||
        value.telefono || "",
    }));
    return value;
  }, [businessId, currentUserEmail, currentUserPhone, currentUserUid]);

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
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (!VERIFICATION_EVIDENCE_TYPES.includes(selected.type) ||
      selected.size <= 0 || selected.size > MAX_VERIFICATION_EVIDENCE_BYTES) {
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setError("Selecciona un archivo PDF, JPG o PNG de hasta 5 MB.");
      return;
    }
    setFile(selected);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!form.identificadorFiscalValor.trim()) {
      setError("Ingresa el identificador fiscal de la empresa.");
      return;
    }
    if (form.paisCodigo === "CL" &&
      !isValidChileanRut(form.identificadorFiscalValor)) {
      setError("Ingresa un RUT válido.");
      return;
    }
    if (form.relacionSolicitante.trim().length < 2) {
      setError("Indica tu relación o cargo en la empresa.");
      return;
    }
    if (!isValidBusinessEmail(form.correoSolicitante)) {
      setError("Ingresa un correo del solicitante válido.");
      return;
    }
    if (form.telefonoSolicitante.trim().length < 6) {
      setError("Ingresa un teléfono del solicitante válido.");
      return;
    }
    submittingRef.current = true;
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
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSuccess("Solicitud enviada. La empresa quedó pendiente de revisión.");
    } catch (submitError) {
      setError(verificationMessageForError(submitError));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) return <p className="settings-loading">Cargando verificación...</p>;

  return <SectionFrame title="Verificación empresarial" description="Solicita la revisión para activar los módulos operativos de ValoraCloud.">
    <div className={`settings-card settings-verification-card is-${verification.estado.toLowerCase()}`}>
      <div className="settings-verification-heading">
        <AppIcon icon={ShieldCheck} size={24} />
        <div><span>Estado actual</span><strong>{BUSINESS_VERIFICATION_STATUS_LABELS[verification.estado]}</strong></div>
      </div>
      {verification.estado === BUSINESS_VERIFICATION_STATES.NOT_VERIFIED && <p>Aún no se ha enviado una solicitud. Completa los datos y solicita la revisión.</p>}
      {verification.estado === BUSINESS_VERIFICATION_STATES.PENDING && <p>La solicitud está en revisión. Podrás comenzar a operar cuando sea aprobada.</p>}
      {verification.estado === BUSINESS_VERIFICATION_STATES.VERIFIED && <p><strong>{verification.identificadorFiscalTipo || form.identificadorFiscalTipo}: {verification.identificadorFiscalValor || form.identificadorFiscalValor}</strong> · ✓ Verificado</p>}
      {verification.estado === BUSINESS_VERIFICATION_STATES.REJECTED && <p><strong>Motivo:</strong> {verification.motivoRechazo || "La plataforma rechazó la solicitud."}</p>}
      {!canRequest && <p className="settings-verification-help">Sólo el propietario puede solicitar verificación. Otros perfiles autorizados pueden consultar el estado.</p>}
      {canRequest && !requestBlocked && <Button type="button" icon={ShieldCheck} onClick={() => { setDialogOpen(true); setError(""); }}>Solicitar verificación</Button>}
    </div>
    <SectionStatus error={!dialogOpen ? error : ""} success={success} />
    <ResponsiveDialog
  open={dialogOpen}
  onClose={() => !submitting && setDialogOpen(false)}
  size="large"
  title="Solicitar verificación empresarial"
  description="Confirma los datos de la empresa y del solicitante."
  className="verification-request-dialog"
  footer={
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={submitting}
        onClick={() => setDialogOpen(false)}
      >
        Cancelar
      </Button>

      <Button
        type="submit"
        form="business-verification-form"
        disabled={submitting}
      >
        {submitting ? "Enviando..." : "Solicitar verificación"}
      </Button>
    </>
  }
>
  <form
    id="business-verification-form"
    className="settings-verification-form"
    onSubmit={submit}
  >
    <div className="settings-form-grid">

      <LockedSetting
        label="País"
        value={getCountryByCode(form.paisCodigo)?.name || form.paisCodigo}
      />

      <LockedSetting
        label="Tipo de identificación fiscal"
        value={form.identificadorFiscalTipo}
      />

      <SettingsField
        label="Identificador fiscal declarado"
        required
        hint={`Ingresa el ${
          form.identificadorFiscalTipo || "identificador"
        } que será revisado.`}
        wide
      >
        <input
          value={form.identificadorFiscalValor}
          onChange={(event) =>
            update("identificadorFiscalValor", event.target.value)
          }
          onBlur={() =>
            form.paisCodigo === "CL" &&
            update(
              "identificadorFiscalValor",
              formatRutInput(form.identificadorFiscalValor)
            )
          }
        />
      </SettingsField>

      <SettingsField label="Relación o cargo" required>
        <input
          value={form.relacionSolicitante}
          onChange={(event) =>
            update("relacionSolicitante", event.target.value)
          }
          placeholder="Ej. Representante legal"
        />
      </SettingsField>

      <SettingsField label="Correo del solicitante" required>
        <input
          type="email"
          value={form.correoSolicitante}
          onChange={(event) =>
            update("correoSolicitante", event.target.value)
          }
        />
      </SettingsField>

      <SettingsField label="Teléfono del solicitante" required>
        <input
          type="tel"
          value={form.telefonoSolicitante}
          onChange={(event) =>
            update("telefonoSolicitante", event.target.value)
          }
        />
      </SettingsField>

      <div className="settings-field settings-field--wide">
        <span id="verification-evidence-label" className="settings-field__label">
          Documento de respaldo
        </span>
        <p className="verification-evidence-helper">
          Adjunta un documento que permita acreditar la empresa o tu relación con ella.
        </p>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          aria-labelledby="verification-evidence-label"
          onChange={(event) =>
            chooseEvidence(event.target.files?.[0] || null)
          }
        />
        <div className={`verification-evidence-uploader${file ? " has-file" : ""}`}>
          <span className="verification-evidence-uploader__icon" aria-hidden="true">
            <AppIcon icon={FileUp} size={22} />
          </span>
          <div className="verification-evidence-uploader__copy">
            <strong>{file ? file.name : "PDF, JPG o PNG · máximo 5 MB"}</strong>
            <span>{file ? "Listo para enviar" : "El documento es opcional"}</span>
          </div>
          <div className="verification-evidence-uploader__actions">
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => fileInputRef.current?.click()}
            >
              {file ? "Cambiar" : "Seleccionar archivo"}
            </Button>
            {file && (
              <Button
                type="button"
                variant="ghost-danger"
                disabled={submitting}
                onClick={() => chooseEvidence(null)}
              >
                Eliminar
              </Button>
            )}
          </div>
        </div>
        <span className="settings-field__support">&nbsp;</span>
      </div>

      <SettingsField label="Observaciones" wide>
        <textarea
          rows="4"
          maxLength="4000"
          value={form.observaciones}
          onChange={(event) =>
            update("observaciones", event.target.value)
          }
        />
      </SettingsField>

    </div>

    <SectionStatus error={error} />
  </form>
</ResponsiveDialog>
  </SectionFrame>;
}

function TaxSection({ businessId }) {
  const [profile, setProfile] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let active = true;
    getCompanyProfile(businessId)
      .then((value) => active && setProfile(value))
      .catch((loadError) => active && setError(messageForError(loadError, "No pudimos cargar los impuestos.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [businessId]);
  return (
    <SectionFrame title="Configuración tributaria" description="Perfil fiscal base derivado del país registrado. Los documentos históricos conservan su snapshot original.">
      {loading ? <p className="settings-loading">Cargando impuestos...</p> : (
        <div className="settings-card">
          <div className="settings-form-grid">
            <LockedSetting
              label="País fiscal"
              value={profile?.paisNombre || getCountryByCode(profile?.paisCodigo)?.name || profile?.paisCodigo}
            />
            <LockedSetting
              label="Impuesto predeterminado"
              value={profile?.impuestoPredeterminadoNombre}
            />
            <LockedSetting
              label="Tasa general"
              value={profile?.impuestoPredeterminadoTasa == null
                ? "Revisión tributaria requerida"
                : `${profile.impuestoPredeterminadoTasa}%`}
            />
          </div>
          <p className="settings-card__description">
            Configurado automáticamente según el país registrado. Futuras exenciones o tasas especiales se administrarán por separado.
          </p>
          {profile?.configuracionTributariaBaseCompleta === false && (
            <p className="settings-message settings-message--warning" role="status">
              Este país requiere una configuración tributaria específica de plataforma antes de operar.
            </p>
          )}
        </div>
      )}
      <SectionStatus error={error} />
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
  businessCompletionStatus,
  businessName,
  businessVerified,
  currentUserEmail,
  currentUserPhone,
  currentUserUid,
  onBusinessDeleted,
  onBusinessUpdated,
  role,
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const settingsContentRef = React.useRef(null);
  const requestedSection = searchParams.get("seccion") || "informacion";
  const availableSections = SECTIONS.filter(
    (section) =>
      (!section.ownerOnly || role === "OWNER") &&
      (businessVerified || ACTIVATION_SECTION_IDS.has(section.id))
  );
  const requestedSectionAllowed = availableSections.some(
    (section) => section.id === requestedSection
  );
  const activeSection = requestedSectionAllowed
    ? requestedSection
    : businessVerified
      ? "informacion"
      : "verificacion";
  const focusTarget = searchParams.get("objetivo") || "";
  const canEdit = role === "OWNER" || role === "ADMIN";
  const activationStatus = businessCompletionStatus?.verificationStatus ||
    BUSINESS_VERIFICATION_STATES.NOT_VERIFIED;
  const canActOnCompletionItem = (item) =>
    item.id !== "ownerEmail" || role === "OWNER";
  const focusActiveSection = React.useCallback(() => {
    const content = settingsContentRef.current;
    if (!content) return;
    content.scrollIntoView({ behavior: "smooth", block: "start" });
    content.querySelector("h2")?.focus({ preventScroll: true });
  }, []);

  React.useEffect(() => {
    if (!businessVerified && !requestedSectionAllowed && searchParams.has("seccion")) {
      setSearchParams({ seccion: "verificacion" }, { replace: true });
    }
  }, [businessVerified, requestedSectionAllowed, searchParams, setSearchParams]);

  React.useEffect(() => {
    if (!searchParams.has("seccion") || (activeSection === "informacion" && focusTarget)) {
      return undefined;
    }
    const frameId = window.requestAnimationFrame(focusActiveSection);
    return () => window.cancelAnimationFrame(frameId);
  }, [activeSection, focusActiveSection, focusTarget, searchParams]);

  const handleCompletionAction = (item) => {
    if (item.path) {
      if (!canActOnCompletionItem(item)) return;
      navigate(item.path);
      return;
    }
    if (item.section) {
      const target = COMPLETION_TARGETS[item.id];
      setSearchParams({
        seccion: item.section,
        ...(target ? { objetivo: target } : {}),
      });
      if (item.section === activeSection && target) {
        window.requestAnimationFrame(() => focusCompanyTarget(target));
      } else if (item.section === activeSection) {
        window.requestAnimationFrame(focusActiveSection);
      }
    }
  };

  if (!businessId) return <p className="settings-message settings-message--error">No hay un negocio activo.</p>;

  return (
    <section className="erp-page company-settings-page">
      <div className="settings-page-intro">
        <div>
          <h1>Empresa</h1>
          <p>Datos de identificación, ubicación y verificación del negocio.</p>
        </div>
      </div>
      {!businessVerified && activeSection !== "verificacion" && (
        <p className="settings-activation-notice" role="status">
          {activationStatus === BUSINESS_VERIFICATION_STATES.PENDING
            ? "La solicitud de verificación está en revisión."
            : activationStatus === BUSINESS_VERIFICATION_STATES.REJECTED
              ? "La verificación fue rechazada. Revisa el motivo y envía una nueva solicitud."
              : "Empresa no verificada. Envía una solicitud para activar los módulos operativos."}
        </p>
      )}
      {canEdit && businessCompletionStatus && (
        <BusinessCompletionCard
          status={businessCompletionStatus}
          canActOnItem={canActOnCompletionItem}
          onAction={handleCompletionAction}
        />
      )}
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
        <div ref={settingsContentRef} className="settings-content">
          {activeSection === "informacion" && <BusinessInformationSection businessId={businessId} canEdit={canEdit} focusTarget={focusTarget} onBusinessUpdated={onBusinessUpdated} />}
          {activeSection === "verificacion" && (
            <BusinessVerificationSection
              businessId={businessId}
              currentUserEmail={currentUserEmail}
              currentUserPhone={currentUserPhone}
              currentUserUid={currentUserUid}
              role={role}
            />
          )}
          {activeSection === "impuestos" && <TaxSection businessId={businessId} />}
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
