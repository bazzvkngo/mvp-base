import React, { useEffect, useMemo, useRef, useState } from "react";
import { CubeIcon } from "../../components/BrandLogo";
import {
  MAX_COMPANY_LOGO_SIZE_BYTES,
  getCompanyProfile,
  saveCompanyProfile,
  uploadCompanyLogo,
} from "../../services/companyService";

const DEFAULT_FORM = {
  nombreComercial: "",
  razonSocial: "",
  rut: "",
  giro: "",
  email: "",
  telefono: "",
  direccion: "",
  ciudad: "",
  sitioWeb: "",
  logoUrl: "",
  logoPath: "",
  logoNombreOriginal: "",
  condicionesPago: "50% al iniciar y 50% contra entrega",
  validezCotizacionDias: "15",
  notaPieCotizacion:
    "Los valores pueden variar segun alcance final y disponibilidad de insumos.",
};

const COMPANY_PROFILE_FIELDS = [
  "nombreComercial",
  "razonSocial",
  "rut",
  "giro",
  "email",
  "telefono",
  "direccion",
  "ciudad",
  "sitioWeb",
  "logoUrl",
  "logoPath",
  "logoNombreOriginal",
  "condicionesPago",
  "validezCotizacionDias",
  "notaPieCotizacion",
];

function isValidOptionalUrl(value) {
  if (!value.trim()) return true;
  try {
    const parsed = new URL(value.trim());
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function isFirebaseStorageUrl(value) {
  const url = String(value || "").trim();
  return (
    url.includes("firebasestorage.googleapis.com") ||
    url.includes("firebasestorage.app")
  );
}

function normalizeFormSnapshot(form) {
  return COMPANY_PROFILE_FIELDS.reduce((snapshot, field) => {
    snapshot[field] =
      field === "validezCotizacionDias"
        ? String(form[field] || 15)
        : String(form[field] || "");
    return snapshot;
  }, {});
}

function hasFormChanges(form, savedForm) {
  if (!savedForm) return false;
  const current = normalizeFormSnapshot(form);
  return COMPANY_PROFILE_FIELDS.some(
    (field) => current[field] !== savedForm[field]
  );
}

function getMissingProfileRequirements(form) {
  const missing = [];

  if (!String(form.nombreComercial || "").trim()) {
    missing.push("Nombre comercial");
  }

  if (
    !String(form.email || "").trim() &&
    !String(form.telefono || "").trim()
  ) {
    missing.push("Email o teléfono");
  }

  return missing;
}

function validateLogoFile(file) {
  if (!file) return "Selecciona una imagen antes de subir el logo.";
  if (!String(file.type || "").startsWith("image/")) {
    return "Usa una imagen PNG, JPG o WebP.";
  }
  if (file.size > MAX_COMPANY_LOGO_SIZE_BYTES) {
    return "El archivo supera el maximo permitido de 2 MB.";
  }
  return "";
}

function CompanyConfig({ userId }) {
  const logoFileInputRef = useRef(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [savedForm, setSavedForm] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensajeOk, setMensajeOk] = useState("");
  const [mensajeInfo, setMensajeInfo] = useState("");
  const [logoFile, setLogoFile] = useState(null);
  const [logoError, setLogoError] = useState("");
  const [logoInputKey, setLogoInputKey] = useState(0);
  const [logoPreviewLocal, setLogoPreviewLocal] = useState("");
  const [arrastrandoLogo, setArrastrandoLogo] = useState(false);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [mostrarLogoUrlManual, setMostrarLogoUrlManual] = useState(false);

  const logoPreviewValido = useMemo(
    () => isValidOptionalUrl(form.logoUrl) && form.logoUrl.trim(),
    [form.logoUrl]
  );
  const logoPreviewSrc = logoPreviewLocal || logoPreviewValido || "";

  const requisitosPendientes = useMemo(
    () => getMissingProfileRequirements(form),
    [form]
  );
  const perfilConfigurado = requisitosPendientes.length === 0;
  const logoDesdeStorage = useMemo(
    () => Boolean(form.logoPath || isFirebaseStorageUrl(form.logoUrl)),
    [form.logoPath, form.logoUrl]
  );
  const mostrarCampoLogoUrl = mostrarLogoUrlManual;
  const hayCambiosFormulario = useMemo(
    () => hasFormChanges(form, savedForm),
    [form, savedForm]
  );
  const hayAccionLogoPendiente = Boolean(logoFile);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    setCargando(true);
    setError("");
    setMensajeOk("");
    setMensajeInfo("");

    getCompanyProfile(userId)
      .then((profile) => {
        if (!active) return;
        const nextForm = {
          ...DEFAULT_FORM,
          ...profile,
          validezCotizacionDias: String(profile.validezCotizacionDias || 15),
        };
        setForm((prev) => ({
          ...prev,
          ...nextForm,
        }));
        setSavedForm(normalizeFormSnapshot(nextForm));
        setMostrarLogoUrlManual(
          Boolean(
            nextForm.logoUrl &&
              !nextForm.logoPath &&
              !isFirebaseStorageUrl(nextForm.logoUrl)
          )
        );
      })
      .catch((err) => {
        console.error("Error cargando empresa:", err);
        if (active) {
          setSavedForm(normalizeFormSnapshot(DEFAULT_FORM));
          setMensajeInfo(
            "No se pudo confirmar si ya existe un perfil comercial. Puedes completar los datos y guardar nuevamente."
          );
        }
      })
      .finally(() => {
        if (active) setCargando(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewLocal("");
      return undefined;
    }

    const objectUrl = URL.createObjectURL(logoFile);
    setLogoPreviewLocal(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [logoFile]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
      ...(name === "logoUrl"
        ? { logoPath: "", logoNombreOriginal: "" }
        : {}),
    }));
  };

  const processLogoFile = (file) => {
    const validationError = file ? validateLogoFile(file) : "";

    setLogoFile(validationError ? null : file);
    setLogoError(validationError);
    setMensajeOk("");
    setMensajeInfo("");
    if (file && !validationError) {
      setError("");
    }
    return validationError;
  };

  const handleLogoFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    const validationError = processLogoFile(file);

    if (validationError) {
      event.target.value = "";
      setLogoInputKey((prev) => prev + 1);
    }
  };

  const handleLogoDragOver = (event) => {
    event.preventDefault();
    if (!subiendoLogo) setArrastrandoLogo(true);
  };

  const handleLogoDragLeave = (event) => {
    event.preventDefault();
    setArrastrandoLogo(false);
  };

  const handleLogoDrop = (event) => {
    event.preventDefault();
    setArrastrandoLogo(false);
    if (subiendoLogo) return;

    const file = event.dataTransfer.files?.[0] || null;
    processLogoFile(file);
    setLogoInputKey((prev) => prev + 1);
  };

  const handleUploadLogo = async () => {
    const validationError = validateLogoFile(logoFile);
    if (validationError) {
      setLogoError(validationError);
      return;
    }

    setSubiendoLogo(true);
    setLogoError("");
    setError("");
    setMensajeOk("");
    setMensajeInfo("");

    try {
      const uploadedLogo = await uploadCompanyLogo(userId, logoFile);
      const logoPatch = {
        logoUrl: uploadedLogo.logoUrl,
        logoPath: uploadedLogo.logoPath,
        logoNombreOriginal: uploadedLogo.logoNombreOriginal,
      };
      setForm((prev) => ({
        ...prev,
        ...logoPatch,
      }));
      setSavedForm((prev) =>
        prev
          ? {
              ...prev,
              logoUrl: String(logoPatch.logoUrl || ""),
              logoPath: String(logoPatch.logoPath || ""),
              logoNombreOriginal: String(logoPatch.logoNombreOriginal || ""),
            }
          : prev
      );
      setLogoFile(null);
      setLogoInputKey((prev) => prev + 1);
      setMostrarLogoUrlManual(false);
      setMensajeOk("Logo subido correctamente.");
    } catch (err) {
      console.error("Error subiendo logo de empresa:", err);
      setLogoError("No pudimos subir el logo. Intentalo nuevamente.");
    } finally {
      setSubiendoLogo(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!userId) return;

    if (!isValidOptionalUrl(form.logoUrl)) {
      setError("La URL del logo debe comenzar con http:// o https://.");
      setMensajeOk("");
      setMensajeInfo("");
      return;
    }

    if (!isValidOptionalUrl(form.sitioWeb)) {
      setError("La URL del sitio web debe comenzar con http:// o https://.");
      setMensajeOk("");
      setMensajeInfo("");
      return;
    }

    setGuardando(true);
    setError("");
    setMensajeOk("");
    setMensajeInfo("");

    try {
      const payload = {
        nombreComercial: form.nombreComercial,
        razonSocial: form.razonSocial,
        rut: form.rut,
        giro: form.giro,
        email: form.email,
        telefono: form.telefono,
        direccion: form.direccion,
        ciudad: form.ciudad,
        sitioWeb: form.sitioWeb,
        logoUrl: form.logoUrl,
        logoPath: form.logoPath,
        logoNombreOriginal: form.logoNombreOriginal,
        condicionesPago: form.condicionesPago,
        validezCotizacionDias: form.validezCotizacionDias || 15,
        notaPieCotizacion: form.notaPieCotizacion,
      };
      const savedProfile = await saveCompanyProfile(userId, payload);
      const nextForm = {
        ...form,
        ...savedProfile,
        validezCotizacionDias: String(
          savedProfile.validezCotizacionDias || form.validezCotizacionDias || 15
        ),
      };

      setForm(nextForm);
      setSavedForm(normalizeFormSnapshot(nextForm));
      setMensajeOk("Cambios guardados correctamente.");
    } catch (err) {
      console.error("Error guardando empresa:", err);
      setError("No pudimos guardar la informacion de la empresa.");
    } finally {
      setGuardando(false);
    }
  };

  if (!userId) {
    return (
      <section className="page-section">
        <p style={styles.errorText}>Debes iniciar sesion para configurar empresa.</p>
      </section>
    );
  }

  const saveStatusText = guardando
    ? "Guardando cambios..."
    : error
    ? "No se pudieron guardar los cambios. Intentalo nuevamente."
    : hayCambiosFormulario && hayAccionLogoPendiente
    ? "Tienes cambios sin guardar y un logo pendiente de subir."
    : hayCambiosFormulario
    ? "Tienes cambios sin guardar"
    : hayAccionLogoPendiente
    ? "Logo seleccionado. Usa Subir logo para cargarlo."
    : mensajeOk
    ? mensajeOk
    : "Sin cambios pendientes";

  return (
    <section style={styles.wrapper}>
      <style>{companyPageCss}</style>
      <header className="company-profile-header" style={styles.header}>
        <div style={styles.headerCopy}>
          <span className="eyebrow">Empresa</span>
          <h2 style={styles.title}>Perfil comercial</h2>
          <p style={styles.subtitle}>
            Configura la identidad comercial que aparecerá en tus cotizaciones.
          </p>
        </div>
        <div className="company-profile-header-aside" style={styles.headerAside}>
          <div
            className="company-profile-header-badge"
            style={{
              ...styles.headerBadge,
              ...(perfilConfigurado
                ? styles.headerBadgeComplete
                : styles.headerBadgeIncomplete),
            }}
          >
            <span style={styles.headerBadgeLabel}>Estado</span>
            <strong>
              {perfilConfigurado
                ? "Perfil comercial completo"
                : "Perfil incompleto"}
            </strong>
            {perfilConfigurado ? (
              <span style={styles.headerBadgeHint}>
                Tu información está lista para aparecer en las cotizaciones.
              </span>
            ) : (
              <>
                <span style={styles.headerBadgeHint}>
                  Completa estos datos para usar tu información en las
                  cotizaciones:
                </span>
                <ul style={styles.headerBadgeList}>
                  {requisitosPendientes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </header>

      {cargando && <p style={styles.infoText}>Cargando datos de empresa...</p>}
      {!cargando && !mensajeInfo && (
        <p style={styles.infoText}>
          Completa los datos comerciales que aparecerán en las cotizaciones.
          Puedes guardar parcialmente y actualizar esta información cuando lo
          necesites.
        </p>
      )}
      {mensajeInfo && (
        <p style={styles.infoText} role="status" aria-live="polite">
          {mensajeInfo}
        </p>
      )}
      {error && (
        <p style={styles.errorText} role="alert">
          {error}
        </p>
      )}
      {mensajeOk && (
        <p style={styles.successText} role="status" aria-live="polite">
          {mensajeOk}
        </p>
      )}

      <form
        id="company-profile-form"
        onSubmit={handleSubmit}
        style={styles.form}
      >
        <div className="company-profile-main-grid" style={styles.mainGrid}>
          <div style={styles.columnStack}>
            <FormSection
              title="Identidad comercial"
              description="¿Cómo aparecerá tu empresa en la cotización?"
            >
              <Field label="Nombre comercial *">
                <input
                  name="nombreComercial"
                  value={form.nombreComercial}
                  onChange={handleChange}
                  placeholder="Escribe el nombre con el que cotizas"
                  style={styles.input}
                />
              </Field>
              <Field label="Razón social" meta="(opcional)">
                <input
                  name="razonSocial"
                  value={form.razonSocial}
                  onChange={handleChange}
                  placeholder="Escribe la razón social de tu empresa"
                  style={styles.input}
                />
              </Field>
              <Field label="RUT de la empresa" meta="(opcional)">
                <input
                  name="rut"
                  value={form.rut}
                  onChange={handleChange}
                  placeholder="Escribe el RUT con puntos y guion"
                  style={styles.input}
                />
              </Field>
              <Field label="Giro o actividad" meta="(opcional)">
                <input
                  name="giro"
                  value={form.giro}
                  onChange={handleChange}
                  placeholder="Escribe el giro principal de tu empresa"
                  style={styles.input}
                />
              </Field>
            </FormSection>

            <FormSection
              title="Contacto"
              description="¿Cómo puede contactarte el cliente?"
            >
              <p style={styles.requirementText}>
                Ingresa al menos un email o un teléfono. *
              </p>
              <Field
                label="Email"
                helpText="Puedes usar un correo de contacto comercial."
              >
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="Escribe un correo de contacto"
                  style={styles.input}
                />
              </Field>
              <Field
                label="Teléfono"
                helpText="Puedes ingresar un número móvil o fijo."
              >
                <input
                  name="telefono"
                  value={form.telefono}
                  onChange={handleChange}
                  placeholder="Escribe un teléfono de contacto"
                  style={styles.input}
                />
              </Field>
              <Field label="Dirección" meta="(opcional)">
                <input
                  name="direccion"
                  value={form.direccion}
                  onChange={handleChange}
                  placeholder="Escribe la dirección comercial"
                  style={styles.input}
                />
              </Field>
              <Field label="Ciudad" meta="(opcional)">
                <input
                  name="ciudad"
                  value={form.ciudad}
                  onChange={handleChange}
                  placeholder="Escribe la ciudad"
                  style={styles.input}
                />
              </Field>
              <Field label="Sitio web" meta="(opcional)" wide>
                <input
                  name="sitioWeb"
                  value={form.sitioWeb}
                  onChange={handleChange}
                  placeholder="Escribe la dirección de tu sitio web"
                  style={styles.input}
                />
              </Field>
            </FormSection>
          </div>

          <div style={styles.columnStack}>
            <FormSection
              title="Imagen corporativa"
              description="¿Qué logo aparecerá en tus cotizaciones?"
              compact
            >
              <div className="company-profile-logo-panel" style={styles.logoPanel}>
                <div style={styles.logoPreview}>
                  {logoPreviewSrc ? (
                    <img
                      src={logoPreviewSrc}
                      alt="Vista previa del logo de la empresa"
                      style={styles.logoImage}
                    />
                  ) : (
                    <CubeIcon size={42} strokeWidth={1.6} />
                  )}
                </div>
                <div style={styles.logoCopy}>
                  <strong>{form.nombreComercial || "Tu empresa"}</strong>
                  <span>Este encabezado aparecerá en tus cotizaciones.</span>
                </div>
              </div>

              {logoDesdeStorage && (
                <div style={styles.logoLoadedPanel}>
                  <strong>Logo cargado correctamente</strong>
                  <span>Se usará en las cotizaciones formales.</span>
                  {form.logoNombreOriginal && (
                    <span style={styles.fileName}>{form.logoNombreOriginal}</span>
                  )}
                </div>
              )}

              <div
                style={{
                  ...styles.logoUploadPanel,
                  ...(arrastrandoLogo ? styles.logoUploadPanelActive : {}),
                }}
                onDragOver={handleLogoDragOver}
                onDragLeave={handleLogoDragLeave}
                onDrop={handleLogoDrop}
              >
                <div style={styles.logoUploadHeader}>
                  <strong>
                    {logoPreviewSrc ? "Reemplazar logo" : "Subir logo"}
                  </strong>
                  <span style={styles.helpText}>
                    Arrastra tu logo aqui o selecciona un archivo.
                  </span>
                  <span style={styles.helpText}>PNG, JPG o WebP - Maximo 2 MB</span>
                </div>
                <input
                  key={logoInputKey}
                  ref={logoFileInputRef}
                  id="company-logo-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoFileChange}
                  style={styles.fileInput}
                  disabled={subiendoLogo}
                  tabIndex={-1}
                />
                <button
                  type="button"
                  onClick={() => logoFileInputRef.current?.click()}
                  style={styles.logoSelectButton}
                  disabled={subiendoLogo}
                >
                  Seleccionar archivo
                </button>
                {logoFile && (
                  <span style={styles.fileName}>
                    Archivo seleccionado: {logoFile.name}
                  </span>
                )}
                {logoError && (
                  <span style={styles.logoErrorText}>{logoError}</span>
                )}
                <button
                  type="button"
                  onClick={handleUploadLogo}
                  style={styles.logoUploadButton}
                  disabled={!logoFile || subiendoLogo}
                >
                  {subiendoLogo ? "Subiendo..." : "Subir logo"}
                </button>
              </div>

              {!mostrarCampoLogoUrl && (
                <button
                  type="button"
                  onClick={() => setMostrarLogoUrlManual(true)}
                  style={styles.logoAdvancedButton}
                >
                  Usar una URL en su lugar
                </button>
              )}

              {mostrarCampoLogoUrl && (
                <div style={styles.logoUrlPanel}>
                  <Field
                    label="URL del logo"
                    meta="(opcional)"
                    helpText="Usa esta opción solo si tu logo ya está publicado en internet."
                    wide
                  >
                    <input
                      name="logoUrl"
                      value={form.logoUrl}
                      onChange={handleChange}
                      placeholder="Pega aquí la URL pública del logo"
                      style={styles.input}
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => setMostrarLogoUrlManual(false)}
                    style={styles.logoAdvancedButton}
                  >
                    Subir un archivo en su lugar
                  </button>
                </div>
              )}
            </FormSection>

            <FormSection
              title="Configuración de cotización"
              description="¿Cómo se pagará y por cuántos días será válida?"
            >
              <Field
                label="Condiciones de pago"
                badge="Predeterminado"
                helpText="Se usarán al crear nuevas cotizaciones y podrás cambiarlas en cada caso."
                wide
              >
                <textarea
                  name="condicionesPago"
                  value={form.condicionesPago}
                  onChange={handleChange}
                  placeholder="Describe cómo se realizará el pago"
                  rows={2}
                  style={styles.compactTextarea}
                />
              </Field>
              <Field
                label="Validez de la cotización"
                helpText="Después de este plazo, los precios pueden necesitar revisión."
              >
                <input
                  type="number"
                  min="1"
                  name="validezCotizacionDias"
                  value={form.validezCotizacionDias}
                  onChange={handleChange}
                  placeholder="Días de validez"
                  style={styles.input}
                />
              </Field>
              <Field
                label="Nota de pie"
                meta="(opcional)"
                helpText="Este texto aparecerá al final de todas las cotizaciones."
                wide
              >
                <textarea
                  name="notaPieCotizacion"
                  value={form.notaPieCotizacion}
                  onChange={handleChange}
                  placeholder="Escribe un mensaje final para tus cotizaciones"
                  rows={3}
                  style={styles.textarea}
                />
              </Field>
            </FormSection>
          </div>
        </div>

        <div
          className="company-profile-save-bar"
          style={styles.actions}
        >
          <span style={styles.saveStatusText} role="status" aria-live="polite">
            {saveStatusText}
          </span>
          <button
            type="submit"
            style={styles.primaryButton}
            disabled={guardando || cargando || !hayCambiosFormulario}
          >
            {guardando ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>
    </section>
  );
}

function FormSection({ title, description, compact = false, children }) {
  return (
    <section style={{ ...styles.card, ...(compact ? styles.compactCard : {}) }}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}>{title}</h3>
        {description && <p style={styles.cardDescription}>{description}</p>}
      </div>
      <div className="company-profile-form-grid" style={styles.formGrid}>
        {children}
      </div>
    </section>
  );
}

function Field({ label, meta, badge, helpText, wide = false, children }) {
  return (
    <label style={{ ...styles.field, ...(wide ? styles.wideField : {}) }}>
      <span style={styles.labelRow}>
        <span style={styles.label}>{label}</span>
        {meta && <span style={styles.fieldMeta}>{meta}</span>}
        {badge && <span style={styles.fieldBadge}>{badge}</span>}
      </span>
      {children}
      {helpText && <span style={styles.helpText}>{helpText}</span>}
    </label>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "16px",
    maxWidth: "1180px",
  },
  header: {
    alignItems: "flex-start",
    display: "flex",
    gap: "16px",
    justifyContent: "space-between",
  },
  headerCopy: {
    minWidth: 0,
  },
  headerAside: {
    alignItems: "flex-end",
    display: "grid",
    gap: "8px",
  },
  title: {
    fontSize: "24px",
    margin: "4px 0 6px",
  },
  subtitle: {
    color: "#64748b",
    lineHeight: 1.45,
    margin: 0,
  },
  headerBadge: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    color: "#111827",
    display: "grid",
    gap: "2px",
    maxWidth: "320px",
    minWidth: "260px",
    padding: "10px 12px",
    textAlign: "left",
  },
  headerBadgeComplete: {
    background: "#f0fdf4",
    borderColor: "#bbf7d0",
  },
  headerBadgeIncomplete: {
    background: "#ffffff",
  },
  headerBadgeLabel: {
    color: "#64748b",
    fontSize: "12px",
    fontWeight: 700,
    textTransform: "uppercase",
  },
  headerBadgeHint: {
    color: "#64748b",
    fontSize: "12px",
    lineHeight: 1.35,
  },
  headerBadgeList: {
    color: "#475569",
    fontSize: "12px",
    lineHeight: 1.45,
    listStylePosition: "inside",
    margin: "4px 0 0",
    padding: 0,
  },
  form: {
    display: "grid",
    gap: "14px",
    paddingBottom: "120px",
  },
  mainGrid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(340px, 0.8fr)",
    paddingBottom: "104px",
  },
  columnStack: {
    display: "grid",
    gap: "16px",
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "16px",
  },
  compactCard: {
    paddingBottom: "14px",
  },
  cardHeader: {
    marginBottom: "12px",
  },
  cardTitle: {
    color: "#111827",
    fontSize: "16px",
    margin: 0,
  },
  cardDescription: {
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.4,
    margin: "4px 0 0",
  },
  formGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  },
  field: {
    display: "grid",
    gap: "6px",
    minWidth: 0,
  },
  wideField: {
    gridColumn: "1 / -1",
  },
  label: {
    color: "#475569",
    fontSize: "12px",
    fontWeight: 800,
  },
  labelRow: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  fieldMeta: {
    color: "#64748b",
    fontSize: "12px",
    fontWeight: 600,
  },
  fieldBadge: {
    background: "#f0fdfa",
    border: "1px solid #99f6e4",
    borderRadius: "999px",
    color: "#0f766e",
    fontSize: "11px",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "3px 7px",
  },
  requirementText: {
    color: "#475569",
    fontSize: "13px",
    fontWeight: 700,
    gridColumn: "1 / -1",
    lineHeight: 1.4,
    margin: "0 0 2px",
  },
  input: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#111827",
    minHeight: "39px",
    padding: "9px 10px",
    width: "100%",
  },
  textarea: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    minHeight: "86px",
    padding: "10px",
    resize: "vertical",
    width: "100%",
  },
  compactTextarea: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#111827",
    lineHeight: 1.45,
    minHeight: "64px",
    padding: "9px 10px",
    resize: "vertical",
    width: "100%",
  },
  logoPanel: {
    alignItems: "center",
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "grid",
    gap: "12px",
    gridColumn: "1 / -1",
    gridTemplateColumns: "92px minmax(0, 1fr)",
    padding: "12px",
  },
  logoPreview: {
    alignItems: "center",
    aspectRatio: "1",
    background: "linear-gradient(135deg, #ffffff 0%, #eef2f7 100%)",
    border: "1px solid #dbe3ee",
    borderRadius: "8px",
    display: "flex",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImage: {
    maxHeight: "100%",
    maxWidth: "100%",
    objectFit: "contain",
    padding: "8px",
  },
  logoCopy: {
    display: "grid",
    gap: "4px",
    minWidth: 0,
  },
  logoLoadedPanel: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    borderRadius: "8px",
    color: "#166534",
    display: "grid",
    gap: "4px",
    gridColumn: "1 / -1",
    padding: "11px 12px",
  },
  helpText: {
    color: "#64748b",
    fontSize: "12px",
    lineHeight: 1.4,
  },
  logoUploadPanel: {
    alignItems: "center",
    background: "#ffffff",
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    display: "grid",
    gap: "9px",
    gridColumn: "1 / -1",
    justifyItems: "start",
    padding: "12px",
  },
  logoUploadPanelActive: {
    background: "#f0fdfa",
    borderColor: "#0f766e",
  },
  logoUploadHeader: {
    display: "grid",
    gap: "3px",
  },
  fileInput: {
    height: "1px",
    opacity: 0,
    overflow: "hidden",
    position: "absolute",
    width: "1px",
  },
  fileName: {
    color: "#475569",
    fontSize: "12px",
    lineHeight: 1.4,
  },
  logoErrorText: {
    color: "#b91c1c",
    fontSize: "12px",
    lineHeight: 1.4,
  },
  logoUploadButton: {
    background: "#111827",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    justifySelf: "start",
    padding: "9px 12px",
  },
  logoSelectButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#0f766e",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    padding: "9px 12px",
  },
  logoAdvancedButton: {
    background: "none",
    border: 0,
    color: "#0f766e",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 800,
    gridColumn: "1 / -1",
    justifySelf: "start",
    padding: 0,
  },
  logoUrlPanel: {
    display: "grid",
    gap: "8px",
    gridColumn: "1 / -1",
  },
  actions: {
    alignItems: "center",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    bottom: "12px",
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.08)",
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
    marginTop: "4px",
    padding: "12px",
    position: "sticky",
    zIndex: 5,
  },
  primaryButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "11px 16px",
  },
  saveStatusText: {
    color: "#475569",
    fontSize: "13px",
    lineHeight: 1.4,
  },
  infoText: {
    background: "#f8fafc",
    border: "1px solid #dbe3ee",
    borderRadius: "8px",
    color: "#475569",
    margin: 0,
    padding: "11px 13px",
  },
  errorText: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    color: "#b91c1c",
    margin: 0,
    padding: "11px 13px",
  },
  successText: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    borderRadius: "8px",
    color: "#166534",
    margin: 0,
    padding: "11px 13px",
  },
};

const companyPageCss = `
@media (max-width: 920px) {
  .company-profile-main-grid {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 640px) {
  .company-profile-header {
    align-items: stretch !important;
    flex-direction: column !important;
  }

  .company-profile-header-aside {
    align-items: stretch !important;
    width: 100% !important;
  }

  .company-profile-header-badge {
    text-align: left !important;
  }

  .company-profile-form-grid {
    grid-template-columns: 1fr !important;
  }

  .company-profile-save-bar {
    align-items: stretch !important;
    flex-direction: column !important;
  }

  .company-profile-save-bar button {
    width: 100% !important;
  }
}

@media (max-width: 420px) {
  .company-profile-logo-panel {
    grid-template-columns: 1fr !important;
  }
}
`;

export default CompanyConfig;
