import React, { useEffect, useLayoutEffect, useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import googleLogo from "../../assets/google-g.svg";
import AppFooter from "../../components/AppFooter";
import BrandLogo from "../../components/BrandLogo";
import Button from "../../components/ui/Button";
import SkipLink from "../../components/ui/SkipLink";
import { TabPanel, Tabs } from "../../components/ui/Tabs";
import { GOOGLE_LOGIN_ENABLED } from "../../config/featureFlags.mjs";
import {
  ACCESS_HINT,
  buildLoginLink,
  resolveAccessHint,
} from "../../domain/accessHint.mjs";
import { detectInAppBrowser } from "../../domain/inAppBrowser.mjs";
import { LEGAL_DOCUMENTS } from "../../domain/legalDocuments.mjs";
import {
  readAccessHint,
  setAccessHint,
  useAccessHint,
} from "../../hooks/useAccessHint";
import {
  completeGoogleRedirect,
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  resetPassword,
} from "../../services/authService";
import AuthStage from "./AuthStage";
import "./login.css";

const LEGAL_LINKS = [LEGAL_DOCUMENTS.privacidad, LEGAL_DOCUMENTS.terminos];

const LEGAL_REQUIRED_MESSAGE =
  "Debes aceptar la política de privacidad y los términos de uso para crear tu cuenta.";

const VERIFICATION_NOTICE_KEY = "valoracloud.verificationNotice";

// El selector solo cambia textos y la pantalla de espera (SPEC 029): no se
// envía al backend ni concede permisos.
const ACCESS_TABS = [
  { id: ACCESS_HINT.EMPRESA, label: "Mi empresa" },
  { id: ACCESS_HINT.COLABORADOR, label: "Soy colaborador" },
];

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
    case "auth/popup-closed-by-user":
      return "Cerraste la ventana de Google antes de terminar. Inténtalo nuevamente.";
    case "auth/popup-blocked":
      return "Tu navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo nuevamente.";
    case "auth/account-exists-with-different-credential":
      return "Ya existe una cuenta con ese correo creada con otro método. Ingresa con tu correo y contraseña.";
    case "auth/operation-not-allowed":
      return "El ingreso con Google no está habilitado todavía.";
    case "auth/unauthorized-domain":
      return "Este sitio no está autorizado para ingresar con Google.";
    case "auth/user-disabled":
      return "Esta cuenta está deshabilitada.";
    default:
      return "Error al procesar la solicitud.";
  }
}

function Login() {
  const location = useLocation();
  const accessHint = useAccessHint();
  const accessMode = accessHint || ACCESS_HINT.EMPRESA;
  const isCollaborator = accessMode === ACCESS_HINT.COLABORADOR;
  // Google bloquea el ingreso desde navegadores integrados (WhatsApp,
  // Instagram, WebViews...): ahí se ofrece copiar el enlace en vez del botón.
  const [inAppBrowser] = useState(() =>
    detectInAppBrowser(
      typeof navigator === "undefined" ? "" : navigator.userAgent
    )
  );
  const [linkCopyState, setLinkCopyState] = useState("idle");
  const loginLink = buildLoginLink(window.location.origin, accessMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoginView, setIsLoginView] = useState(true);
  const [isResetView, setIsResetView] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);

  const clearPasswordState = () => {
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setAcceptedLegal(false);
  };

  // ?acceso=colaborador manda sobre lo guardado en la sesión del navegador.
  // Layout effect para no pintar una pestaña y cambiarla enseguida.
  useLayoutEffect(() => {
    setAccessHint(
      resolveAccessHint({ search: location.search, stored: readAccessHint() })
    );
  }, [location.search]);

  // Errores del regreso de Google cuando el popup se resolvió por redirección.
  // Apagado (GOOGLE_LOGIN_ENABLED = false): no se consulta nada.
  useEffect(() => {
    if (!GOOGLE_LOGIN_ENABLED) return;
    completeGoogleRedirect().catch((err) => {
      console.error("Error al volver de Google:", err?.code, err?.message);
      setError(getAuthErrorMessage(err?.code));
    });
  }, []);

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

  const handleAccessChange = (nextMode) => {
    setAccessHint(nextMode);
    setError("");
    setSuccess("");
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(loginLink);
      setLinkCopyState("copied");
    } catch {
      setLinkCopyState("failed");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting || isGoogleLoading) return;

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

      if (!acceptedLegal) {
        setError(LEGAL_REQUIRED_MESSAGE);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      if (isLoginView) {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(email, password, {
          legalTermsAccepted: acceptedLegal,
        });
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

  // Una persona nueva de Google no pasa por la casilla de aceptación: la
  // pantalla de aceptación del guard (SPEC 024, etapa 5) la pide en su primer
  // ingreso, antes del onboarding y de la pantalla de espera.
  const handleGoogle = async () => {
    if (!GOOGLE_LOGIN_ENABLED || isGoogleLoading || isSubmitting) return;

    setError("");
    setSuccess("");
    setIsGoogleLoading(true);

    try {
      await loginWithGoogle();
    } catch (err) {
      // Otra solicitud de popup reemplazó a esta: no es un error para la persona.
      if (err?.code === "auth/cancelled-popup-request") return;
      console.error("Error con Google:", err?.code, err?.message);
      setError(getAuthErrorMessage(err?.code));
    } finally {
      setIsGoogleLoading(false);
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
  const title = isResetView
    ? "Recuperar contraseña"
    : !isLoginView
    ? "Crea tu cuenta"
    : isCollaborator
    ? "Acceso de colaborador"
    : "Bienvenido de vuelta";
  const subtitle = isResetView
    ? "Ingresa tu correo y te enviaremos las instrucciones."
    : isCollaborator
    ? "Tu empresa te agrega con tu correo."
    : "";

  const body = (
    <div className="auth-body">
      <div className="auth-body__title">
        <h1 id="auth-title" className="auth-card__title">
          {title}
        </h1>
        {/* Siempre se renderiza: reserva la altura de una línea (login.css) para
            que cambiar de pestaña no desplace el resto del formulario. */}
        <p className="auth-card__subtitle">{subtitle}</p>
      </div>

      {!isResetView && (
        <>
          {GOOGLE_LOGIN_ENABLED && inAppBrowser.isInAppBrowser ? (
            <div className="auth-inapp">
              <p className="auth-inapp__text">
                Para ingresar con Google, abre esta página en Chrome o Safari.
              </p>
              <Button
                type="button"
                variant="secondary"
                icon={Copy}
                className="auth-inapp__copy"
                onClick={handleCopyLink}
              >
                Copiar enlace
              </Button>
              <span className="auth-inapp__feedback" aria-live="polite">
                {linkCopyState === "copied" && "Enlace copiado."}
                {linkCopyState === "failed" &&
                  `No se pudo copiar. Copia esta dirección: ${loginLink}`}
              </span>
            </div>
          ) : (
            <div className="auth-google-group">
              <Button
                type="button"
                variant="secondary"
                className={
                  GOOGLE_LOGIN_ENABLED
                    ? "auth-google"
                    : "auth-google auth-google--disabled"
                }
                loading={isGoogleLoading}
                disabled={!GOOGLE_LOGIN_ENABLED || isSubmitting}
                aria-describedby={
                  GOOGLE_LOGIN_ENABLED ? undefined : "auth-google-note"
                }
                onClick={handleGoogle}
              >
                <span className="auth-google__label">
                  <img
                    className="auth-google__logo"
                    src={googleLogo}
                    alt=""
                    aria-hidden="true"
                    width="20"
                    height="20"
                  />
                  Continuar con Google
                </span>
              </Button>
              {!GOOGLE_LOGIN_ENABLED && (
                <p id="auth-google-note" className="auth-google__note">
                  Ingreso con Google no conectado por ahora.
                </p>
              )}
            </div>
          )}
          <div className="auth-divider">o</div>
        </>
      )}

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
                  <Eye size={19} aria-hidden="true" />
                ) : (
                  <EyeOff size={19} aria-hidden="true" />
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
                  <Eye size={19} aria-hidden="true" />
                ) : (
                  <EyeOff size={19} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        )}

        {!isLoginView && !isResetView && (
          <div className="auth-field">
            <label className="ui-checkbox" htmlFor="auth-legal">
              <input
                id="auth-legal"
                className="ui-checkbox__input"
                type="checkbox"
                name="accept-legal"
                checked={acceptedLegal}
                onChange={(e) => setAcceptedLegal(e.target.checked)}
                aria-invalid={error === LEGAL_REQUIRED_MESSAGE}
                aria-describedby={feedbackId}
                required
              />
              <span className="ui-checkbox__label">
                Acepto la{" "}
                <Link
                  to={LEGAL_DOCUMENTS.privacidad.path}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {LEGAL_DOCUMENTS.privacidad.title}
                </Link>{" "}
                y los{" "}
                <Link
                  to={LEGAL_DOCUMENTS.terminos.path}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {LEGAL_DOCUMENTS.terminos.title}
                </Link>
                .
              </span>
            </label>
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
          loading={primaryDisabled}
          disabled={isGoogleLoading}
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

      {(isLoginView || isResetView) && (
        <nav className="auth-legal" aria-label="Documentos legales">
          <p className="auth-legal__text">
            {LEGAL_LINKS.map((document, index) => (
              <React.Fragment key={document.key}>
                {index === 0 ? "Al continuar aceptas la " : " y los "}
                <Link
                  className="auth-legal__link"
                  to={document.path}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {document.title}
                </Link>
              </React.Fragment>
            ))}
            .
          </p>
        </nav>
      )}
    </div>
  );

  return (
    <>
      <SkipLink targetId="auth-main-content" />
      <main id="auth-main-content" className="auth-screen" tabIndex="-1">
        <AuthStage />

        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-card">
            <header className="auth-card__header">
              <BrandLogo variant="auth" showText iconSize={50} subtitle="" />
            </header>

            {isResetView ? (
              body
            ) : (
              <>
                <Tabs
                  className="auth-tabs"
                  idPrefix="auth-access"
                  label="Tipo de acceso"
                  tabs={ACCESS_TABS}
                  value={accessMode}
                  onChange={handleAccessChange}
                />
                <TabPanel
                  className="auth-tabpanel"
                  idPrefix="auth-access"
                  id={accessMode}
                >
                  {body}
                </TabPanel>
              </>
            )}

            <AppFooter variant="ingreso" />
          </div>
        </section>
      </main>
    </>
  );
}

export default Login;
