// src/components/Login.js
import React, { useState } from "react";
import { auth, db } from "../firebaseConfig";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

const BoxIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    style={{ width: "42px", height: "42px", color: "#0f766e" }}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
    />
  </svg>
);

const logoUrl =
  "https://reqlut2.s3.sa-east-1.amazonaws.com/reqlut-images/st/logo-original.png?v=78.8";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [isLoginView, setIsLoginView] = useState(true);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    try {
      if (isLoginView) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const cred = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

        try {
          await setDoc(
            doc(db, "usuarios", cred.user.uid),
            {
              email: cred.user.email,
              creadoEn: new Date(),
            },
            { merge: true }
          );
        } catch (e) {
          console.error("Error creando documento de usuario:", e);
        }
      }
    } catch (err) {
      console.error("Error de autenticación:", err.code, err.message);
      switch (err.code) {
        case "auth/wrong-password":
          setError("Contraseña incorrecta.");
          break;
        case "auth/user-not-found":
          setError("No se encontró un usuario con ese correo.");
          break;
        case "auth/email-already-in-use":
          setError("El correo electrónico ya está en uso.");
          break;
        case "auth/invalid-credential":
          setError("Credenciales inválidas.");
          break;
        default:
          setError("Error al procesar la solicitud.");
      }
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <img src={logoUrl} alt="Logo Santo Tomás" style={styles.logo} />

        <div style={styles.iconContainer}>
          <BoxIcon />
        </div>

        <h2 style={styles.title}>
          {isLoginView ? "Iniciar sesión" : "Crear cuenta"}
        </h2>
        <p style={styles.subtitle}>
          CotiFlow · Gestión de inventario y cotizaciones
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Correo electrónico"
            style={styles.input}
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña (mín. 6 caracteres)"
            style={styles.input}
            minLength="6"
            required
          />

          {error && <p style={styles.errorText}>{error}</p>}

          <button type="submit" style={styles.buttonPrimary}>
            {isLoginView ? "Ingresar" : "Registrarse"}
          </button>
        </form>

        <button
          onClick={() => {
            setIsLoginView(!isLoginView);
            setError(null);
          }}
          style={styles.buttonSecondary}
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
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "2.5rem 2.25rem",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    maxWidth: "420px",
    width: "100%",
    textAlign: "center",
    border: "1px solid #e5e7eb",
  },
  logo: {
    width: "170px",
    marginBottom: "1rem",
  },
  iconContainer: {
    marginBottom: "0.75rem",
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
  errorText: {
    color: "#b91c1c",
    fontSize: "0.88rem",
    marginTop: "0.1rem",
    marginBottom: "0.5rem",
  },
};

export default Login;
