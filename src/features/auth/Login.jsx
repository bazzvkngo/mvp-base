import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import loginBackground from "../../assets/valoracloud-login-background.png";
import BrandLogo from "../../components/BrandLogo";
import Button from "../../components/ui/Button";
import SkipLink from "../../components/ui/SkipLink";
import {
  loginWithEmail,
  registerWithEmail,
  resetPassword,
} from "../../services/authService";

const VERIFICATION_NOTICE_KEY = "valoracloud.verificationNotice";

function getAuthErrorMessage(code) {
  switch (code) {
    case "auth/wrong-password":
      return "Contraseña incorrecta.";
    case "auth/user-not-found":
      return "No se encontró un usuario con ese correo.";
    case "auth/email-already-in-use":
      return "El correo electrónico ya está en uso.";
    case "auth/invalid-email":
      return "Ingresa un correo electrónico válido.";
    case "auth/weak-password":
      return "La contraseña debe tener al menos 6 caracteres.";
    case "auth/invalid-credential":
      return "Credenciales inválidas.";
    case "auth/too-many-requests":
      return "Demasiados intentos. Espera unos minutos e inténtalo nuevamente.";
    case "auth/network-request-failed":
      return "No se pudo conectar con Firebase. Revisa tu conexión.";
    default:
      return "Error al procesar la solicitud.";
  }
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoginView, setIsLoginView] = useState(true);
  const [isResetView, setIsResetView] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const clearPasswordState = () => {
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const openResetView = () => {
    clearPasswordState();
    setIsResetView(true);
    setError("");
    setSuccess("");
  };

  const returnToLoginView = () => {
    clearPasswordState();
    setIsResetView(false);
    setIsLoginView(true);
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError("");
    setSuccess("");

    if (!email.trim()) {
      setError("Ingresa un correo electrónico.");
      return;
    }

    if (!password) {
      setError("Ingresa una contraseña.");
      return;
    }

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    if (!isLoginView) {
      if (!confirmPassword) {
        setError("Repite la contraseña.");
        return;
      }

      if (password !== confirmPassword) {
        setError("Las contraseñas no coinciden.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      if (isLoginView) {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(email, password);
        const message =
          "Cuenta creada. Te enviamos un correo de verificación. Revisa tu bandeja de entrada antes de continuar.";
        setSuccess(message);
        window.sessionStorage.setItem(VERIFICATION_NOTICE_KEY, message);
      }
    } catch (err) {
      console.error("Error de autenticación:", err.code, err.message);
      setError(getAuthErrorMessage(err.code));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async (e) => {
    e.preventDefault();
    if (isResetting) return;

    setError("");
    setSuccess("");

    if (!email.trim()) {
      setError("Ingresa tu correo electrónico para restablecer la contraseña.");
      return;
    }

    setIsResetting(true);

    try {
      await resetPassword(email);
      clearPasswordState();
      setSuccess(
        "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña."
      );
      setIsResetView(false);
    } catch (err) {
      if (err.code !== "auth/user-not-found") {
        console.error(
          "Error al solicitar recuperación de contraseña:",
          err.code,
          err.message
        );
      }

      if (err.code === "auth/user-not-found") {
        clearPasswordState();
        setSuccess(
          "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña."
        );
        setIsResetView(false);
      } else if (err.code === "auth/invalid-email") {
        setError("Ingresa un correo electrónico válido.");
      } else if (err.message === "auth/email-required") {
        setError("Ingresa tu correo electrónico para restablecer la contraseña.");
      } else if (err.code === "auth/too-many-requests") {
        setError("Demasiados intentos. Espera unos minutos e inténtalo nuevamente.");
      } else {
        setError("No se pudo enviar el enlace. Inténtalo nuevamente en unos minutos.");
      }
    } finally {
      setIsResetting(false);
    }
  };

  const toggleAuthView = () => {
    setIsLoginView((current) => !current);
    setIsResetView(false);
    clearPasswordState();
    setError("");
    setSuccess("");
  };

  const showPasswordField = !isResetView;
  const showConfirmPasswordField = !isResetView && !isLoginView;
  const primaryDisabled = isResetView ? isResetting : isSubmitting;
  const primaryLabel = isResetView
    ? isResetting
      ? "Enviando enlace..."
      : "Enviar enlace"
    : isSubmitting
    ? "Procesando..."
    : isLoginView
    ? "Ingresar"
    : "Registrarse";
  const feedbackId = error || success ? "auth-feedback" : undefined;

  return (
    <>
      <SkipLink targetId="auth-main-content" />
      <main id="auth-main-content" className="auth-screen" tabIndex="-1">
        <section className="auth-visual" aria-label="ValoraCloud para tu negocio">
          <img
            className="auth-visual__image"
            src={loginBackground}
            alt=""
            aria-hidden="true"
            width="1706"
            height="922"
          />
          <div className="auth-visual__overlay" aria-hidden="true" />
          <p className="auth-visual__message">
            Gestiona, compara y valora tu negocio en un solo lugar.
          </p>
        </section>

        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-card">
            <header className="auth-card__header">
              <BrandLogo
                variant="auth"
                showText
                iconSize={50}
                subtitle="Gestiona, compara y valora tu negocio"
              />
              <h1 id="auth-title" className="auth-card__title">
                {isResetView
                  ? "Recuperar contraseña"
                  : isLoginView
                  ? "Bienvenido de vuelta"
                  : "Crea tu cuenta"}
              </h1>
              <p className="auth-card__subtitle">
                {isResetView
                  ? "Ingresa tu correo y te enviaremos las instrucciones."
                  : isLoginView
                  ? "Accede y continúa gestionando tu negocio en un solo lugar."
                  : "Regístrate para comenzar a gestionar tu negocio."}
              </p>
            </header>

            <form
              className="auth-form"
              onSubmit={isResetView ? handlePasswordReset : handleSubmit}
              noValidate
              aria-busy={primaryDisabled}
            >
              <div className="auth-field">
                <label className="auth-field__label" htmlFor="auth-email">
                  Correo electrónico
                </label>
                <input
                  className="auth-input"
                  id="auth-email"
                  type="email"
                  name={isResetView ? "email" : "username"}
                  autoComplete={isResetView ? "email" : "username"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@empresa.cl"
                  aria-invalid={Boolean(error)}
                  aria-describedby={feedbackId}
                  required
                />
              </div>

              {showPasswordField && (
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="auth-password">
                    Contraseña
                  </label>
                  <div className="auth-password-control">
                    <input
                      key={isLoginView ? "login-password" : "register-password"}
                      id="auth-password"
                      className="auth-input auth-input--password"
                      type={showPassword ? "text" : "password"}
                      name={isLoginView ? "password" : "new-password"}
                      autoComplete={
                        isLoginView ? "current-password" : "new-password"
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={Boolean(error)}
                      aria-describedby={
                        [!isLoginView && "auth-password-hint", feedbackId]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                      minLength="6"
                      required
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={
                        showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                      }
                      aria-pressed={showPassword}
                    >
                      {showPassword ? (
                        <EyeOff size={19} aria-hidden="true" />
                      ) : (
                        <Eye size={19} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {!isLoginView && (
                    <p id="auth-password-hint" className="auth-field__hint">
                      Mínimo 6 caracteres.
                    </p>
                  )}
                </div>
              )}

              {showConfirmPasswordField && (
                <div className="auth-field">
                  <label
                    className="auth-field__label"
                    htmlFor="auth-confirm-password"
                  >
                    Repetir contraseña
                  </label>
                  <div className="auth-password-control">
                    <input
                      id="auth-confirm-password"
                      className="auth-input auth-input--password"
                      type={showConfirmPassword ? "text" : "password"}
                      name="confirm-password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      aria-invalid={Boolean(error)}
                      aria-describedby={feedbackId}
                      minLength="6"
                      required
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() =>
                        setShowConfirmPassword((current) => !current)
                      }
                      aria-label={
                        showConfirmPassword
                          ? "Ocultar confirmación de contraseña"
                          : "Mostrar confirmación de contraseña"
                      }
                      aria-pressed={showConfirmPassword}
                    >
                      {showConfirmPassword ? (
                        <EyeOff size={19} aria-hidden="true" />
                      ) : (
                        <Eye size={19} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {isLoginView && !isResetView && (
                <div className="auth-form__utility">
                  <Button
                    type="button"
                    variant="ghost"
                    className="auth-link"
                    onClick={openResetView}
                  >
                    ¿Olvidaste tu contraseña?
                  </Button>
                </div>
              )}

              {error && (
                <p
                  id="auth-feedback"
                  className="auth-feedback auth-feedback--error"
                  role="alert"
                >
                  {error}
                </p>
              )}
              {success && (
                <p
                  id="auth-feedback"
                  className="auth-feedback auth-feedback--success"
                  role="status"
                >
                  {success}
                </p>
              )}

              <Button
                type="submit"
                className="auth-submit"
                disabled={primaryDisabled}
                aria-busy={primaryDisabled}
              >
                {primaryLabel}
              </Button>
            </form>

            <div className="auth-actions">
              {isResetView && (
                <Button
                  type="button"
                  variant="ghost"
                  className="auth-link"
                  onClick={returnToLoginView}
                >
                  Volver al inicio de sesión
                </Button>
              )}

              {!isResetView && (
                <p className="auth-actions__prompt">
                  {isLoginView
                    ? "¿No tienes una cuenta?"
                    : "¿Ya tienes una cuenta?"}
                </p>
              )}

              <Button
                type="button"
                variant="ghost"
                className="auth-link"
                onClick={toggleAuthView}
                disabled={isSubmitting || isResetting}
              >
                {isLoginView ? "Crear una cuenta" : "Iniciar sesión"}
              </Button>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

export default Login;
