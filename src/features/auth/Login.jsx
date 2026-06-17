import React, { useState } from "react";
import {
  loginWithEmail,
  registerWithEmail,
  resetPassword,
} from "../../services/authService";
import BrandLogo from "../../components/BrandLogo";

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
    setConfirmPassword("");
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

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <BrandLogo variant="auth" showText={false} />

        <h2 style={styles.title}>
          {isResetView
            ? "Recuperar contraseña"
            : isLoginView
            ? "Iniciar sesión"
            : "Crear cuenta"}
        </h2>
        <p style={styles.subtitle}>
          {isResetView
            ? "Ingresa tu correo y enviaremos las instrucciones."
            : "ValoraCloud · Valorización y cotizaciones TI"}
        </p>

        <form
          onSubmit={isResetView ? handlePasswordReset : handleSubmit}
          noValidate
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Correo electrónico"
            style={styles.input}
            required
          />
          {showPasswordField && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña (mín. 6 caracteres)"
              style={styles.input}
              minLength="6"
              required
            />
          )}
          {showConfirmPasswordField && (
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repetir contraseña"
              style={styles.input}
              minLength="6"
              required
            />
          )}

          {error && <p style={styles.errorText}>{error}</p>}
          {success && <p style={styles.successText}>{success}</p>}

          <button
            type="submit"
            style={{
              ...styles.buttonPrimary,
              ...(primaryDisabled ? styles.buttonDisabled : {}),
            }}
            disabled={primaryDisabled}
          >
            {primaryLabel}
          </button>
        </form>

        {isLoginView && !isResetView && (
          <button
            type="button"
            onClick={() => {
              setIsResetView(true);
              setError("");
              setSuccess("");
            }}
            style={styles.linkButton}
          >
            ¿Olvidaste tu contraseña?
          </button>
        )}

        {isResetView && (
          <button
            type="button"
            onClick={() => {
              setIsResetView(false);
              setError("");
            }}
            style={styles.linkButton}
          >
            Volver al inicio de sesión
          </button>
        )}

        <button
          type="button"
          onClick={toggleAuthView}
          style={styles.buttonSecondary}
          disabled={isSubmitting || isResetting}
        >
          {isLoginView
            ? "¿No tienes cuenta? Regístrate"
            : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    backgroundColor: "#f3f4f6",
    padding: "1rem",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    padding: "2.5rem 2.25rem",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    maxWidth: "420px",
    width: "100%",
    textAlign: "center",
    border: "1px solid #e5e7eb",
  },
  title: {
    fontSize: "1.6rem",
    fontWeight: 600,
    color: "#111827",
    margin: 0,
  },
  subtitle: {
    fontSize: "0.95rem",
    color: "#6b7280",
    marginTop: "0.35rem",
    marginBottom: "1.5rem",
  },
  input: {
    width: "100%",
    padding: "0.8rem 0.9rem",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    fontSize: "0.95rem",
    marginBottom: "0.9rem",
    outline: "none",
  },
  buttonPrimary: {
    width: "100%",
    backgroundColor: "#0f766e",
    color: "#ffffff",
    border: "none",
    padding: "0.85rem",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "0.98rem",
    fontWeight: 600,
    marginTop: "0.4rem",
  },
  buttonDisabled: {
    cursor: "not-allowed",
    opacity: 0.68,
  },
  buttonSecondary: {
    width: "100%",
    backgroundColor: "transparent",
    color: "#0f766e",
    border: "none",
    padding: "0.7rem",
    cursor: "pointer",
    fontSize: "0.9rem",
    marginTop: "0.5rem",
  },
  linkButton: {
    width: "100%",
    backgroundColor: "transparent",
    color: "#0f766e",
    border: "none",
    padding: "0.45rem",
    cursor: "pointer",
    fontSize: "0.88rem",
    marginTop: "0.35rem",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: "0.88rem",
    marginTop: "0.1rem",
    marginBottom: "0.5rem",
  },
  successText: {
    color: "#047857",
    fontSize: "0.88rem",
    lineHeight: 1.45,
    marginTop: "0.1rem",
    marginBottom: "0.5rem",
  },
};

export default Login;

