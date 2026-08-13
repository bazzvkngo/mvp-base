import React from "react";
import {
  BellRing,
  Building2,
  FileText,
  ImagePlus,
  Landmark,
  PackageCheck,
  Save,
  Trash2,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import BusinessCategoryPicker from "../../components/BusinessCategoryPicker";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import {
  CHILE_REGIONS,
  getBusinessCategoryDisplayName,
  getCommuneByCode,
  getCommunesForRegion,
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
  DEFAULT_TAX_SETTINGS,
  MAX_COMPANY_LOGO_SIZE_BYTES,
  deleteCompanyLogo,
  getBusinessSettings,
  getCompanyProfile,
  saveBusinessInformation,
  saveBusinessSettings,
  uploadCompanyLogo,
} from "../../services/companyService";

const SECTIONS = [
  { id: "informacion", label: "Información empresa", icon: Building2 },
  { id: "impuestos", label: "Impuestos", icon: Landmark },
  { id: "inventario", label: "Inventario", icon: PackageCheck },
  { id: "cotizaciones", label: "Cotizaciones", icon: FileText },
];

const EMPTY_INFORMATION = {
  nombreComercial: "",
  rubroCodigo: "",
  rubroNombre: "",
  rubroOtro: "",
  regionCodigo: "",
  comunaCodigo: "",
  razonSocial: "",
  rut: "",
  giro: "",
  email: "",
  telefono: "",
  direccion: "",
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
    if (!getRegionByCode(form.regionCodigo)) errors.regionCodigo = "Selecciona una región.";
    if (form.comunaCodigo && !getCommuneByCode(form.regionCodigo, form.comunaCodigo)) {
      errors.comunaCodigo = "La comuna no corresponde a la región seleccionada.";
    }
    if (form.rut.trim() && !isValidChileanRut(form.rut)) {
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
    if (!form.rut.trim()) fields.push("RUT");
    if (!form.comunaCodigo) fields.push("comuna");
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
        paisCodigo: "CL",
        monedaCodigo: "CLP",
        rut: form.rut ? formatRutInput(form.rut) : "",
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
      description="Datos comerciales del negocio activo. Chile y peso chileno (CLP) se aplican automáticamente."
    >
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
              <SettingsField label="RUT" optional error={touched.rut ? fieldErrors.rut : ""}>
                <input name="rut" value={form.rut} placeholder="12.345.678-5" onChange={change} onBlur={() => { setForm((current) => ({ ...current, rut: current.rut ? formatRutInput(current.rut) : "" })); touch("rut"); }} aria-invalid={Boolean(touched.rut && fieldErrors.rut)} />
              </SettingsField>
              <SettingsField label="Razón social" optional>
                <input name="razonSocial" value={form.razonSocial} onChange={change} />
              </SettingsField>
              <SettingsField label="Giro" optional wide>
                <input name="giro" value={form.giro} onChange={change} />
              </SettingsField>
              <SettingsField label="Región" required error={touched.regionCodigo ? fieldErrors.regionCodigo : ""}>
                <select name="regionCodigo" value={form.regionCodigo} onChange={change} onBlur={() => touch("regionCodigo")} aria-invalid={Boolean(touched.regionCodigo && fieldErrors.regionCodigo)}>
                  <option value="">Selecciona una región</option>
                  {CHILE_REGIONS.map((region) => <option key={region.code} value={region.code}>{region.name}</option>)}
                </select>
              </SettingsField>
              <SettingsField label="Comuna" optional hint="Puedes completarla más adelante." error={touched.comunaCodigo ? fieldErrors.comunaCodigo : ""}>
                <select name="comunaCodigo" value={form.comunaCodigo} onChange={change} onBlur={() => touch("comunaCodigo")} disabled={!form.regionCodigo || !canEdit || saving}>
                  <option value="">Sin comuna</option>
                  {communes.map((commune) => <option key={commune.code} value={commune.code}>{commune.name}</option>)}
                </select>
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
          form.regionCodigo &&
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
  const options = [
    { id: "IVA_GENERAL", title: "IVA general", detail: "19%" },
    { id: "IVA_EXENTO", title: "IVA exento", detail: "0%" },
    { id: "SIN_IMPUESTO", title: "Sin impuesto", detail: "0%" },
  ];
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    try {
      setForm(await saveBusinessSettings(businessId, "impuestos", form));
      setSuccess("Configuración tributaria guardada correctamente.");
    } catch (saveError) {
      setError(messageForError(saveError, "No pudimos guardar los impuestos."));
    } finally { setSaving(false); }
  };
  return (
    <SectionFrame title="Impuestos" description="Se aplica a productos sin impuesto específico y a cotizaciones nuevas. No modifica cotizaciones históricas.">
      {loading ? <p className="settings-loading">Cargando impuestos...</p> : (
        <form onSubmit={submit}>
          <fieldset className="settings-fieldset settings-card" disabled={!canEdit || saving}>
            <legend>Impuesto predeterminado</legend>
            <div className="settings-choice-list">
              {options.map((option) => (
                <label className={`settings-choice${form.impuestoPredeterminadoId === option.id ? " is-selected" : ""}`} key={option.id}>
                  <input type="radio" name="impuestoPredeterminadoId" value={option.id} checked={form.impuestoPredeterminadoId === option.id} onChange={(event) => { setForm({ ...form, impuestoPredeterminadoId: event.target.value }); setSuccess(""); }} />
                  <span><strong>{option.title}</strong><small>{option.detail}</small></span>
                </label>
              ))}
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

function CompanyConfig({ onBusinessUpdated, role, userId }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("seccion") || "informacion";
  const activeSection = SECTIONS.some((section) => section.id === requestedSection)
    ? requestedSection
    : "informacion";
  const canEdit = role === "OWNER" || role === "ADMIN";

  if (!userId) return <p className="settings-message settings-message--error">No hay un negocio activo.</p>;

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
          {SECTIONS.map((section) => (
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
          {activeSection === "informacion" && <BusinessInformationSection businessId={userId} canEdit={canEdit} onBusinessUpdated={onBusinessUpdated} />}
          {activeSection === "impuestos" && <TaxSection businessId={userId} canEdit={canEdit} />}
          {activeSection === "inventario" && <InventorySection businessId={userId} canEdit={canEdit} />}
          {activeSection === "cotizaciones" && <QuoteSection businessId={userId} canEdit={canEdit} />}
        </div>
      </div>
    </section>
  );
}

export default CompanyConfig;
