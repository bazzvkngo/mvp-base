import React, { useEffect, useMemo, useState } from "react";
import {
  MAX_COMPANY_LOGO_SIZE_BYTES,
  getCompanyConfig,
  getCompanyProfile,
  saveCompanyConfig,
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
  rubroPrincipal: "",
  rubroOtro: "",
  tipoOperacion: "mixto",
  valorHoraBase: "",
  margenEcon: 15,
  margenStd: 25,
  margenPremium: 35,
};

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

function isProfileConfigured(form) {
  const hasName = String(form.nombreComercial || "").trim();
  const hasContact =
    String(form.email || "").trim() || String(form.telefono || "").trim();
  return Boolean(hasName && hasContact);
}

function getInitials(name) {
  const source = String(name || "ValoraCloud").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function validateLogoFile(file) {
  if (!file) return "Selecciona una imagen antes de subir el logo.";
  if (!String(file.type || "").startsWith("image/")) {
    return "El archivo seleccionado debe ser una imagen.";
  }
  if (file.size > MAX_COMPANY_LOGO_SIZE_BYTES) {
    return "El logo no puede pesar más de 2 MB.";
  }
  return "";
}

function CompanyConfig({ userId }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensajeOk, setMensajeOk] = useState("");
  const [mensajeInfo, setMensajeInfo] = useState("");
  const [logoFile, setLogoFile] = useState(null);
  const [logoError, setLogoError] = useState("");
  const [logoInputKey, setLogoInputKey] = useState(0);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [mostrarLogoUrlManual, setMostrarLogoUrlManual] = useState(false);
  const [mostrarParametros, setMostrarParametros] = useState(false);
  const [mostrarMargenesAvanzados, setMostrarMargenesAvanzados] =
    useState(false);

  const logoPreviewValido = useMemo(
    () => isValidOptionalUrl(form.logoUrl) && form.logoUrl.trim(),
    [form.logoUrl]
  );

  const perfilConfigurado = useMemo(() => isProfileConfigured(form), [form]);
  const logoDesdeStorage = useMemo(
    () => Boolean(form.logoPath || isFirebaseStorageUrl(form.logoUrl)),
    [form.logoPath, form.logoUrl]
  );
  const mostrarCampoLogoUrl = !logoDesdeStorage || mostrarLogoUrlManual;
  const logoInitials = useMemo(
    () => getInitials(form.nombreComercial || form.razonSocial),
    [form.nombreComercial, form.razonSocial]
  );

  useEffect(() => {
    if (!userId) return;

    let active = true;
    setCargando(true);
    setError("");
    setMensajeOk("");
    setMensajeInfo("");

    Promise.all([getCompanyProfile(userId), getCompanyConfig(userId)])
      .then(([profile, cfg]) => {
        if (!active) return;
        setForm((prev) => ({
          ...prev,
          ...profile,
          validezCotizacionDias: String(profile.validezCotizacionDias || 15),
          rubroPrincipal: cfg.rubroPrincipal || "",
          rubroOtro: cfg.rubroOtro || "",
          tipoOperacion: cfg.tipoOperacion || "mixto",
          valorHoraBase:
            cfg.valorHoraBase !== undefined && cfg.valorHoraBase !== null
              ? String(cfg.valorHoraBase)
              : "",
          margenEcon:
            cfg.margenEcon !== undefined && cfg.margenEcon !== null
              ? Math.round(cfg.margenEcon * 100)
              : 15,
          margenStd:
            cfg.margenStd !== undefined && cfg.margenStd !== null
              ? Math.round(cfg.margenStd * 100)
              : 25,
          margenPremium:
            cfg.margenPremium !== undefined && cfg.margenPremium !== null
              ? Math.round(cfg.margenPremium * 100)
              : 35,
        }));
      })
      .catch((err) => {
        console.error("Error cargando empresa:", err);
        if (active) {
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

  const handleLogoFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    const validationError = file ? validateLogoFile(file) : "";

    setLogoFile(validationError ? null : file);
    setLogoError(validationError);
    if (validationError) {
      event.target.value = "";
      setLogoInputKey((prev) => prev + 1);
    }
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
      setForm((prev) => ({
        ...prev,
        logoUrl: uploadedLogo.logoUrl,
        logoPath: uploadedLogo.logoPath,
        logoNombreOriginal: uploadedLogo.logoNombreOriginal,
      }));
      setLogoFile(null);
      setLogoInputKey((prev) => prev + 1);
      setMostrarLogoUrlManual(false);
      setMensajeOk("Logo de empresa subido correctamente.");
    } catch (err) {
      console.error("Error subiendo logo de empresa:", err);
      setLogoError(err.message || "No se pudo subir el logo de empresa.");
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
      const rubroFinal =
        form.rubroPrincipal === "Otro / mixto" && form.rubroOtro
          ? form.rubroOtro
          : form.rubroPrincipal;

      await Promise.all([
        saveCompanyProfile(userId, {
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
        }),
        saveCompanyConfig(userId, {
          rubroPrincipal: rubroFinal,
          rubroOtro:
            form.rubroPrincipal === "Otro / mixto" ? form.rubroOtro : "",
          tipoOperacion: form.tipoOperacion,
          valorHoraBase: Number(form.valorHoraBase) || 0,
          margenEcon: (Number(form.margenEcon) || 0) / 100,
          margenStd: (Number(form.margenStd) || 0) / 100,
          margenPremium: (Number(form.margenPremium) || 0) / 100,
        }),
      ]);

      setMensajeOk("Datos de empresa guardados correctamente.");
    } catch (err) {
      console.error("Error guardando empresa:", err);
      setError("Ocurrio un error al guardar los datos de empresa.");
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
          <div className="company-profile-header-badge" style={styles.headerBadge}>
            <span style={styles.headerBadgeLabel}>Estado</span>
            <strong>
              {perfilConfigurado ? "Perfil configurado" : "Perfil incompleto"}
            </strong>
            {!perfilConfigurado && (
              <span style={styles.headerBadgeHint}>
                Faltan datos mínimos: nombre comercial y un medio de contacto.
              </span>
            )}
          </div>
          <button
            type="submit"
            form="company-profile-form"
            style={styles.headerSaveButton}
            disabled={guardando || cargando}
          >
            {guardando ? "Guardando..." : "Guardar cambios"}
          </button>
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
      {mensajeInfo && <p style={styles.infoText}>{mensajeInfo}</p>}
      {error && <p style={styles.errorText}>{error}</p>}
      {mensajeOk && <p style={styles.successText}>{mensajeOk}</p>}

      <form
        id="company-profile-form"
        onSubmit={handleSubmit}
        style={styles.form}
      >
        <div className="company-profile-main-grid" style={styles.mainGrid}>
          <div style={styles.columnStack}>
            <FormSection
              title="Identidad comercial"
              description="Datos base que identifican al emisor de la cotizacion."
            >
              <Field label="Nombre comercial">
                <input
                  name="nombreComercial"
                  value={form.nombreComercial}
                  onChange={handleChange}
                  placeholder="Ej: Servicios TI Iquique"
                  style={styles.input}
                />
              </Field>
              <Field label="Razon social">
                <input
                  name="razonSocial"
                  value={form.razonSocial}
                  onChange={handleChange}
                  placeholder="Ej: Servicios Informáticos SpA"
                  style={styles.input}
                />
              </Field>
              <Field label="RUT o identificador">
                <input
                  name="rut"
                  value={form.rut}
                  onChange={handleChange}
                  placeholder="Ej: 12.345.678-9"
                  style={styles.input}
                />
              </Field>
              <Field label="Giro o actividad">
                <input
                  name="giro"
                  value={form.giro}
                  onChange={handleChange}
                  placeholder="Ej: Servicios informáticos y soporte técnico"
                  style={styles.input}
                />
              </Field>
            </FormSection>

            <FormSection title="Contacto">
              <Field label="Email">
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  style={styles.input}
                />
              </Field>
              <Field label="Telefono">
                <input
                  name="telefono"
                  value={form.telefono}
                  onChange={handleChange}
                  placeholder="Ej: +56 9 1234 5678"
                  style={styles.input}
                />
              </Field>
              <Field label="Direccion">
                <input
                  name="direccion"
                  value={form.direccion}
                  onChange={handleChange}
                  placeholder="Ej: Av. Arturo Prat 1234, Iquique"
                  style={styles.input}
                />
              </Field>
              <Field label="Ciudad">
                <input
                  name="ciudad"
                  value={form.ciudad}
                  onChange={handleChange}
                  placeholder="Ej: Iquique"
                  style={styles.input}
                />
              </Field>
              <Field label="Sitio web" wide>
                <input
                  name="sitioWeb"
                  value={form.sitioWeb}
                  onChange={handleChange}
                  placeholder="Ej: https://miservicioti.cl"
                  style={styles.input}
                />
              </Field>
            </FormSection>
          </div>

          <div style={styles.columnStack}>
            <FormSection
              title="Imagen corporativa"
              description="Se usara como encabezado visual de la cotizacion."
              compact
            >
              <div className="company-profile-logo-panel" style={styles.logoPanel}>
                <div style={styles.logoPreview}>
                  {logoPreviewValido ? (
                    <img
                      src={form.logoUrl}
                      alt="Logo de empresa"
                      style={styles.logoImage}
                    />
                  ) : (
                    <span style={styles.logoPlaceholder}>{logoInitials}</span>
                  )}
                </div>
                <div style={styles.logoCopy}>
                  <strong>{form.nombreComercial || "Tu empresa"}</strong>
                  <span>
                    {logoPreviewValido
                      ? logoDesdeStorage
                        ? "Logo cargado desde archivo. Se usará en tus cotizaciones formales."
                        : "Logo configurado mediante URL externa."
                      : "Sube un logo desde tu equipo para personalizar tus cotizaciones."}
                  </span>
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

              <div style={styles.logoUploadPanel}>
                <div style={styles.logoUploadHeader}>
                  <strong>
                    {logoPreviewValido ? "Reemplazar logo" : "Subir logo desde archivo"}
                  </strong>
                  <span style={styles.helpText}>
                    Imagen JPG, PNG, WebP o similar. Máximo 2 MB.
                  </span>
                </div>
                <input
                  key={logoInputKey}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoFileChange}
                  style={styles.fileInput}
                  disabled={subiendoLogo}
                />
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
                  {subiendoLogo
                    ? "Subiendo..."
                    : logoPreviewValido
                    ? "Reemplazar logo"
                    : "Subir logo"}
                </button>
              </div>

              {logoDesdeStorage && (
                <button
                  type="button"
                  onClick={() => setMostrarLogoUrlManual((prev) => !prev)}
                  style={styles.logoAdvancedButton}
                >
                  {mostrarLogoUrlManual
                    ? "Ocultar URL externa"
                    : "Usar URL externa"}
                </button>
              )}

              {mostrarCampoLogoUrl && (
                <Field label="URL del logo" wide>
                  <input
                    name="logoUrl"
                    value={form.logoUrl}
                    onChange={handleChange}
                    placeholder="https://..."
                    style={styles.input}
                  />
                  <span style={styles.helpText}>
                    Puedes usar una URL pública como alternativa si el logo ya
                    está alojado en otro sitio.
                  </span>
                </Field>
              )}
            </FormSection>

            <FormSection
              title="Configuracion de cotizacion"
              description="Valores por defecto para documentos nuevos."
            >
              <Field label="Condiciones de pago por defecto" wide>
                <input
                  name="condicionesPago"
                  value={form.condicionesPago}
                  onChange={handleChange}
                  style={styles.input}
                />
              </Field>
              <Field label="Validez en dias">
                <input
                  type="number"
                  min="1"
                  name="validezCotizacionDias"
                  value={form.validezCotizacionDias}
                  onChange={handleChange}
                  style={styles.input}
                />
              </Field>
              <Field label="Nota de pie" wide>
                <textarea
                  name="notaPieCotizacion"
                  value={form.notaPieCotizacion}
                  onChange={handleChange}
                  rows={3}
                  style={styles.textarea}
                />
              </Field>
            </FormSection>
          </div>
        </div>

        <section style={styles.advancedCard}>
          <div
            className="company-profile-advanced-summary"
            style={styles.advancedSummary}
          >
            <span style={styles.advancedCopy}>
              <strong>Configuración avanzada de valorización</strong>
              <small>
                Parámetros opcionales usados como referencia interna para
                futuras valorizaciones.
              </small>
            </span>
            <button
              type="button"
              onClick={() => setMostrarParametros((prev) => !prev)}
              style={styles.secondaryButton}
            >
              {mostrarParametros ? "Ocultar" : "Mostrar"}
            </button>
          </div>

          {mostrarParametros && (
            <div
              className="company-profile-advanced-grid"
              style={styles.advancedContent}
            >
              <Field label="Rubro principal">
                <select
                  name="rubroPrincipal"
                  value={form.rubroPrincipal}
                  onChange={handleChange}
                  style={styles.input}
                >
                  <option value="">Selecciona una opción</option>
                  <option value="Servicios TI, soporte e instalaciones">
                    Servicios TI, soporte e instalaciones
                  </option>
                  <option value="Electricidad, CCTV e instalaciones en terreno">
                    Electricidad, CCTV e instalaciones en terreno
                  </option>
                  <option value="Ferreteria / venta de materiales">
                    Ferretería / venta de materiales
                  </option>
                  <option value="Otro / mixto">Otro / mixto</option>
                </select>
              </Field>
              {form.rubroPrincipal === "Otro / mixto" && (
                <Field label="Describe tu rubro">
                  <input
                    name="rubroOtro"
                    value={form.rubroOtro}
                    onChange={handleChange}
                    style={styles.input}
                  />
                </Field>
              )}
              <Field label="Tipo de oferta principal">
                <select
                  name="tipoOperacion"
                  value={form.tipoOperacion}
                  onChange={handleChange}
                  style={styles.input}
                >
                  <option value="productos">Solo productos</option>
                  <option value="servicios">Solo servicios</option>
                  <option value="mixto">Productos y servicios</option>
                </select>
              </Field>
              <Field label="Valor hora en terreno (CLP)">
                <input
                  type="number"
                  min="0"
                  name="valorHoraBase"
                  value={form.valorHoraBase}
                  onChange={handleChange}
                  style={styles.input}
                />
              </Field>

              <div style={styles.marginHeader}>
                <span style={styles.helpText}>
                  Margenes internos para escenarios economico, estandar y
                  premium.
                </span>
                <button
                  type="button"
                  onClick={() => setMostrarMargenesAvanzados((prev) => !prev)}
                  style={styles.linkButton}
                >
                  {mostrarMargenesAvanzados
                    ? "Ocultar margenes"
                    : "Editar margenes"}
                </button>
              </div>

              {mostrarMargenesAvanzados && (
                <>
                  <Field label="Margen economico (%)">
                    <input
                      type="number"
                      min="0"
                      name="margenEcon"
                      value={form.margenEcon}
                      onChange={handleChange}
                      style={styles.input}
                    />
                  </Field>
                  <Field label="Margen estandar (%)">
                    <input
                      type="number"
                      min="0"
                      name="margenStd"
                      value={form.margenStd}
                      onChange={handleChange}
                      style={styles.input}
                    />
                  </Field>
                  <Field label="Margen premium (%)">
                    <input
                      type="number"
                      min="0"
                      name="margenPremium"
                      value={form.margenPremium}
                      onChange={handleChange}
                      style={styles.input}
                    />
                  </Field>
                </>
              )}
            </div>
          )}
        </section>

        <div style={styles.actions}>
          <button type="submit" style={styles.primaryButton} disabled={guardando}>
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

function Field({ label, wide = false, children }) {
  return (
    <label style={{ ...styles.field, ...(wide ? styles.wideField : {}) }}>
      <span style={styles.label}>{label}</span>
      {children}
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
    minWidth: "138px",
    padding: "10px 12px",
    textAlign: "right",
  },
  headerBadgeLabel: {
    color: "#64748b",
    fontSize: "12px",
    fontWeight: 700,
    textTransform: "uppercase",
  },
  headerBadgeHint: {
    color: "#64748b",
    fontSize: "11px",
    lineHeight: 1.35,
  },
  headerSaveButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    padding: "9px 12px",
    width: "100%",
  },
  form: {
    display: "grid",
    gap: "14px",
  },
  mainGrid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(340px, 0.8fr)",
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
  logoPlaceholder: {
    color: "#334155",
    fontSize: "24px",
    fontWeight: 900,
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
    background: "#ffffff",
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    display: "grid",
    gap: "9px",
    gridColumn: "1 / -1",
    padding: "12px",
  },
  logoUploadHeader: {
    display: "grid",
    gap: "3px",
  },
  fileInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    padding: "8px",
    width: "100%",
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
  advancedCard: {
    background: "#fbfdff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    overflow: "hidden",
  },
  advancedSummary: {
    alignItems: "center",
    background: "#f8fafc",
    display: "flex",
    gap: "14px",
    justifyContent: "space-between",
    padding: "14px 16px",
  },
  advancedCopy: {
    color: "#334155",
    display: "grid",
    gap: "3px",
    minWidth: 0,
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#0f766e",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 800,
    minWidth: "78px",
    padding: "8px 10px",
  },
  advancedContent: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    padding: "16px",
  },
  marginHeader: {
    alignItems: "center",
    display: "flex",
    gap: "12px",
    gridColumn: "1 / -1",
    justifyContent: "space-between",
  },
  linkButton: {
    background: "none",
    border: 0,
    color: "#0f766e",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    padding: 0,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
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

  .company-profile-advanced-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
}

@media (max-width: 640px) {
  .company-profile-header,
  .company-profile-advanced-summary {
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

  .company-profile-form-grid,
  .company-profile-advanced-grid {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 420px) {
  .company-profile-logo-panel {
    grid-template-columns: 1fr !important;
  }
}
`;

export default CompanyConfig;
