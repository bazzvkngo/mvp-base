import React from "react";
import { Save, ShieldCheck, UserRound } from "lucide-react";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import {
  DEFAULT_PERSONAL_PROFILE,
  getPersonalProfile,
  savePersonalProfile,
} from "../services/companyService";

function AccountPage({ usuario }) {
  const [form, setForm] = React.useState(DEFAULT_PERSONAL_PROFILE);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");

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

  const change = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setError("");
    setSuccess("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.nombres.trim()) {
      setError("Ingresa tu nombre antes de guardar.");
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

  return (
    <section className="erp-page account-settings-page">
      <div className="settings-page-intro">
        <div>
          <h1>Cuenta</h1>
          <p>Estos datos te identifican a ti y no pertenecen a ninguna empresa.</p>
        </div>
        <span className="settings-role-badge"><AppIcon icon={ShieldCheck} size={14} /> Perfil privado</span>
      </div>
      <div className="settings-layout settings-layout--account">
        <nav className="settings-subnav" aria-label="Secciones de cuenta">
          <span className="settings-subnav__label">Mi cuenta</span>
          <button type="button" className="is-active" aria-current="page">
            <AppIcon icon={UserRound} size={18} />
            <span>Perfil personal</span>
          </button>
        </nav>
        <section className="settings-section" aria-labelledby="personal-profile-title">
          <header className="settings-section__header">
            <h2 id="personal-profile-title">Perfil personal</h2>
            <p>La información se guarda únicamente en tu cuenta de usuario.</p>
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
                    <span className="settings-field__label">Tipo de documento <span className="settings-field__optional">Opcional</span></span>
                    <select name="tipoDocumento" value={form.tipoDocumento} onChange={change}>
                      <option value="">Sin especificar</option>
                      <option value="RUT">RUT</option>
                      <option value="CI">Cédula de identidad</option>
                      <option value="PASAPORTE">Pasaporte</option>
                      <option value="OTRO">Otro</option>
                    </select>
                    <span className="settings-field__support">&nbsp;</span>
                  </label>
                  <label className="settings-field">
                    <span className="settings-field__label">Número de documento <span className="settings-field__optional">Opcional</span></span>
                    <input name="numeroDocumento" value={form.numeroDocumento} onChange={change} />
                    <span className="settings-field__support">&nbsp;</span>
                  </label>
                  <label className="settings-field">
                    <span className="settings-field__label">Teléfono personal <span className="settings-field__optional">Opcional</span></span>
                    <input name="telefonoPersonal" type="tel" value={form.telefonoPersonal} onChange={change} />
                    <span className="settings-field__support">No se comparte entre empresas.</span>
                  </label>
                  <label className="settings-field">
                    <span className="settings-field__label">Correo de acceso</span>
                    <input value={usuario?.email || ""} readOnly aria-readonly="true" />
                    <span className="settings-field__support">Solo lectura. Cambiarlo requiere un flujo seguro de autenticación.</span>
                  </label>
                </div>
              </fieldset>
              {error && <p className="settings-message settings-message--error" role="alert">{error}</p>}
              {success && <p className="settings-message settings-message--success" role="status">{success}</p>}
              <div className="settings-save-row"><Button type="submit" icon={Save} disabled={saving}>{saving ? "Guardando..." : "Guardar perfil"}</Button></div>
            </form>
          )}
        </section>
      </div>
    </section>
  );
}

export default AccountPage;
