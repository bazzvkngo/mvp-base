import React from "react";
import {
  KeyRound,
  MailCheck,
  MailWarning,
  RefreshCw,
  Save,
  Send,
  UserRound,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import StatusBadge from "../components/ui/StatusBadge";
import { formatChileanRut, isValidChileanRut } from "../domain/fiscalIdentifier.mjs";
import {
  refreshCurrentUser,
  resetPassword,
  sendVerificationEmail,
} from "../services/authService";
import {
  DEFAULT_PERSONAL_PROFILE,
  getPersonalProfile,
  savePersonalProfile,
} from "../services/companyService";

const ACCOUNT_SECTIONS = [
  { id: "perfil", label: "Perfil personal", icon: UserRound },
  { id: "acceso", label: "Acceso y seguridad", icon: KeyRound },
];
const RESEND_COOLDOWN_SECONDS = 60;
const PERSONAL_DOCUMENT_CONTEXT = Object.freeze({
  RUT: { placeholder: "Ej. 12.345.678-5", label: "RUT personal" },
  CI: { placeholder: "Ej. Número de cédula", label: "Cédula de identidad" },
  PASAPORTE: { placeholder: "Ej. Número de pasaporte", label: "Pasaporte" },
  OTRO: { placeholder: "Ingresa el número del documento", label: "Documento personal" },
});

function authErrorMessage(error, fallback) {
  if (error?.code === "auth/too-many-requests") {
    return "Se realizaron demasiados intentos. Espera unos minutos antes de volver a intentarlo.";
  }
  if (error?.code === "auth/user-token-expired") {
    return "Tu sesión expiró. Inicia sesión nuevamente para continuar.";
  }
  return fallback;
}

function AccountPage({ onSessionRefresh, usuario }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("seccion") || "perfil";
  const activeSection = ACCOUNT_SECTIONS.some(({ id }) => id === requestedSection)
    ? requestedSection
    : "perfil";
  const [form, setForm] = React.useState(DEFAULT_PERSONAL_PROFILE);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [documentTouched, setDocumentTouched] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [emailVerified, setEmailVerified] = React.useState(
    usuario?.emailVerified === true
  );
  const [securityError, setSecurityError] = React.useState("");
  const [securityMessage, setSecurityMessage] = React.useState("");
  const [resending, setResending] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [resettingPassword, setResettingPassword] = React.useState(false);
  const [resendCooldown, setResendCooldown] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    getPersonalProfile(usuario?.uid)
      .then((profile) => {
        if (!active) return;
        setForm({
          ...DEFAULT_PERSONAL_PROFILE,
          ...profile,
          nombres: profile.nombres || usuario?.displayName || "",
        });
      })
      .catch(() => active && setError("No pudimos cargar tu perfil personal."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [usuario?.displayName, usuario?.uid]);

  React.useEffect(() => {
    setEmailVerified(usuario?.emailVerified === true);
    setSecurityError("");
    setSecurityMessage("");
    setResendCooldown(0);
  }, [usuario?.emailVerified, usuario?.uid]);

  React.useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timerId = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(current - 1, 0));
    }, 1000);
    return () => window.clearTimeout(timerId);
  }, [resendCooldown]);

  React.useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const section = document.getElementById(`cuenta-${activeSection}`);
      section?.scrollIntoView({ block: "start" });
      section?.querySelector("h2")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeSection]);

  const documentContext = PERSONAL_DOCUMENT_CONTEXT[form.tipoDocumento] || null;
  const documentError = React.useMemo(() => {
    if (!form.numeroDocumento.trim()) return "";
    if (!form.tipoDocumento) return "Selecciona el tipo de documento.";
    if (form.tipoDocumento === "RUT" && !isValidChileanRut(form.numeroDocumento)) {
      return "Revisa el RUT personal y su dígito verificador.";
    }
    return "";
  }, [form.numeroDocumento, form.tipoDocumento]);

  const change = (event) => {
    const { name, value } = event.target;
    setForm((current) => {
      if (name === "tipoDocumento") {
        return {
          ...current,
          tipoDocumento: value,
          numeroDocumento: value
            ? value === "RUT"
              ? formatChileanRut(current.numeroDocumento)
              : current.numeroDocumento
            : "",
        };
      }
      if (name === "numeroDocumento" && current.tipoDocumento === "RUT") {
        return { ...current, numeroDocumento: formatChileanRut(value) };
      }
      return { ...current, [name]: value };
    });
    if (name === "tipoDocumento") setDocumentTouched(false);
    setError("");
    setSuccess("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.nombres.trim()) {
      setError("Ingresa tu nombre antes de guardar.");
      return;
    }
    setDocumentTouched(true);
    if (documentError) {
      setError("Revisa el documento personal antes de guardar.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      setForm(await savePersonalProfile(usuario.uid, form));
      setSuccess("Perfil personal guardado correctamente.");
    } catch (saveError) {
      const denied = String(saveError?.code || "").includes("permission-denied");
      setError(denied ? "No tienes permiso para modificar este perfil." : "No pudimos guardar tu perfil. Tus datos siguen en pantalla.");
    } finally {
      setSaving(false);
    }
  };

  const resendVerification = async () => {
    if (resendCooldown > 0) return;
    setResending(true);
    setSecurityError("");
    setSecurityMessage("");
    try {
      await sendVerificationEmail();
      setSecurityMessage("Correo de verificación enviado. Revisa tu bandeja de entrada y spam.");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (sendError) {
      setSecurityError(authErrorMessage(
        sendError,
        "No pudimos enviar el correo de verificación. Inténtalo nuevamente."
      ));
    } finally {
      setResending(false);
    }
  };

  const refreshVerification = async () => {
    setRefreshing(true);
    setSecurityError("");
    setSecurityMessage("");
    try {
      const refreshedUser = await refreshCurrentUser();
      const verified = refreshedUser?.emailVerified === true;
      setEmailVerified(verified);
      setSecurityMessage(
        verified
          ? "Correo verificado correctamente."
          : "Tu correo aún figura pendiente de verificación."
      );
      if (verified) await onSessionRefresh?.();
    } catch (refreshError) {
      setSecurityError(authErrorMessage(
        refreshError,
        "No pudimos actualizar el estado del correo. Inténtalo nuevamente."
      ));
    } finally {
      setRefreshing(false);
    }
  };

  const changePassword = async () => {
    setResettingPassword(true);
    setSecurityError("");
    setSecurityMessage("");
    try {
      await resetPassword(usuario?.email);
      setSecurityMessage("Te enviamos un enlace para cambiar tu contraseña.");
    } catch (resetError) {
      setSecurityError(authErrorMessage(
        resetError,
        "No pudimos enviar el enlace para cambiar tu contraseña."
      ));
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <section className="erp-page account-settings-page">
      <div className="settings-page-intro">
        <div>
          <h1>Mi cuenta</h1>
          <p>Estos datos te identifican a ti y no pertenecen a ninguna empresa.</p>
        </div>
      </div>
      <div className="settings-layout settings-layout--account">
        <nav className="settings-subnav" aria-label="Secciones de cuenta">
          <span className="settings-subnav__label">Mi cuenta</span>
          {ACCOUNT_SECTIONS.map((section) => (
            <button
              type="button"
              key={section.id}
              className={activeSection === section.id ? "is-active" : ""}
              aria-current={activeSection === section.id ? "page" : undefined}
              onClick={() => setSearchParams({ seccion: section.id })}
            >
              <AppIcon icon={section.icon} size={18} />
              <span>{section.label}</span>
            </button>
          ))}
        </nav>

        {activeSection === "perfil" && (
          <section id="cuenta-perfil" className="settings-section" aria-labelledby="personal-profile-title">
            <header className="settings-section__header">
              <h2 id="personal-profile-title" tabIndex="-1">Perfil personal</h2>
              <p>La información se guarda únicamente en tu cuenta personal y no modifica los datos de ninguna empresa.</p>
            </header>
            {loading ? <p className="settings-loading">Cargando perfil...</p> : (
              <form onSubmit={submit} noValidate>
                <fieldset className="settings-fieldset settings-card" disabled={saving}>
                  <legend className="sr-only">Datos personales</legend>
                  <div className="settings-form-grid">
                    <label className="settings-field">
                      <span className="settings-field__label">Nombres *</span>
                      <input name="nombres" value={form.nombres} onChange={change} required />
                      <span className="settings-field__support">Nombre con el que aparecerás en ValoraCloud.</span>
                    </label>
                    <label className="settings-field">
                      <span className="settings-field__label">Apellidos <span className="settings-field__optional">Opcional</span></span>
                      <input name="apellidos" value={form.apellidos} onChange={change} />
                      <span className="settings-field__support">&nbsp;</span>
                    </label>
                    <label className="settings-field">
                      <span className="settings-field__label">Tipo de documento personal <span className="settings-field__optional">Opcional</span></span>
                      <select name="tipoDocumento" value={form.tipoDocumento} onChange={change}>
                        <option value="">Sin especificar</option>
                        <option value="RUT">RUT</option>
                        <option value="CI">Cédula de identidad</option>
                        <option value="PASAPORTE">Pasaporte</option>
                        <option value="OTRO">Otro</option>
                      </select>
                      <span className="settings-field__support">No corresponde al RUT fiscal de una empresa.</span>
                    </label>
                    <label className="settings-field">
                      <span className="settings-field__label">Número de documento <span className="settings-field__optional">Opcional</span></span>
                      <input name="numeroDocumento" value={form.numeroDocumento} onChange={change} onBlur={() => setDocumentTouched(true)} disabled={!form.tipoDocumento} placeholder={documentContext?.placeholder || "Primero selecciona el tipo"} maxLength="60" aria-invalid={Boolean(documentTouched && documentError)} />
                      <span className="settings-field__support">{documentTouched && documentError ? <span className="settings-field__error">{documentError}</span> : documentContext ? `${documentContext.label} de la persona titular de esta cuenta.` : "Elige un tipo para habilitar este campo."}</span>
                    </label>
                    <label className="settings-field">
                      <span className="settings-field__label">Teléfono personal <span className="settings-field__optional">Opcional</span></span>
                      <input name="telefonoPersonal" type="tel" value={form.telefonoPersonal} onChange={change} />
                      <span className="settings-field__support">No se comparte entre empresas.</span>
                    </label>
                  </div>
                </fieldset>
                {error && <p className="settings-message settings-message--error" role="alert">{error}</p>}
                {success && <p className="settings-message settings-message--success" role="status">{success}</p>}
                <div className="settings-save-row"><Button type="submit" icon={Save} disabled={saving}>{saving ? "Guardando..." : "Guardar perfil"}</Button></div>
              </form>
            )}
          </section>
        )}

        {activeSection === "acceso" && (
          <section id="cuenta-acceso" className="settings-section" aria-labelledby="account-access-title">
            <header className="settings-section__header">
              <h2 id="account-access-title" tabIndex="-1">Acceso y seguridad</h2>
              <p>Administra el acceso de tu usuario, independiente del negocio activo.</p>
            </header>
            <div className="settings-card account-security-card">
              <div className="account-security-row">
                <div className="account-security-row__icon" aria-hidden="true">
                  <AppIcon icon={emailVerified ? MailCheck : MailWarning} size={20} />
                </div>
                <div className="account-security-row__copy">
                  <span>Correo de acceso</span>
                  <strong>{usuario?.email || "Correo no disponible"}</strong>
                  <small>Este correo pertenece a tu cuenta de usuario.</small>
                </div>
                <StatusBadge variant={emailVerified ? "success" : "warning"}>
                  {emailVerified ? "✓ Correo verificado" : "Correo sin verificar"}
                </StatusBadge>
              </div>
              {!emailVerified && (
                <div className="account-security-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    icon={RefreshCw}
                    disabled={refreshing || resending}
                    onClick={refreshVerification}
                  >
                    {refreshing ? "Comprobando..." : "Comprobar verificación"}
                  </Button>
                  <Button
                    type="button"
                    icon={Send}
                    disabled={resending || refreshing || resendCooldown > 0}
                    onClick={resendVerification}
                  >
                    {resending
                      ? "Enviando..."
                      : resendCooldown > 0
                        ? `Reenviar en ${resendCooldown} s`
                        : "Reenviar verificación"}
                  </Button>
                </div>
              )}
              {!emailVerified && resendCooldown > 0 && (
                <p className="account-security-cooldown" role="status">Podrás solicitar otro correo en {resendCooldown} s.</p>
              )}
              <div className="account-security-row account-security-row--password">
                <div className="account-security-row__icon" aria-hidden="true">
                  <AppIcon icon={KeyRound} size={20} />
                </div>
                <div className="account-security-row__copy">
                  <span>Contraseña</span>
                  <strong>Acceso con contraseña</strong>
                  <small>Recibirás un enlace seguro en tu correo de acceso.</small>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={resettingPassword}
                  onClick={changePassword}
                >
                  {resettingPassword ? "Enviando..." : "Enviar enlace para cambiar contraseña"}
                </Button>
              </div>
              {securityError && <p className="settings-message settings-message--error" role="alert">{securityError}</p>}
              {securityMessage && <p className="settings-message settings-message--success" role="status">{securityMessage}</p>}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

export default AccountPage;
