// src/App.js
import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "./firebaseConfig";

// Componentes
import Login from "./components/Login";
import Inventario from "./components/Inventario";
import Cotizador from "./components/Cotizador";
import ImportadorInventario from "./components/ImportadorInventario";
import ConfigNegocio from "./components/ConfigNegocio";

const logoUrl =
  "https://reqlut2.s3.sa-east-1.amazonaws.com/reqlut-images/st/logo-original.png?v=78.8";

// Icono salir
const LogoutIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    style={{ width: "1.2em", height: "1.2em", marginRight: "5px" }}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
    />
  </svg>
);

function DashboardInventario({ usuario }) {
  const handleLogout = () => {
    auth.signOut();
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <img src={logoUrl} alt="Logo Santo Tomás" style={styles.logo} />
          <div style={styles.brandBlock}>
            <span style={styles.appName}>CotiFlow</span>
            <span style={styles.appTagline}>
              Gestión de inventario y cotizaciones para servicios tecnológicos
            </span>
          </div>
        </div>

        <div style={styles.userInfo}>
          <span style={styles.userEmail}>{usuario.email}</span>
          <button onClick={handleLogout} style={styles.logoutButton}>
            <LogoutIcon />
            Cerrar sesión
          </button>
        </div>
      </header>

      {/* Contenido principal */}
      <main style={styles.mainContent}>
        {/* 1. Configuración del negocio */}
        <ConfigNegocio userId={usuario.uid} />

        {/* 2. Importar inventario desde Excel/CSV */}
        <ImportadorInventario userId={usuario.uid} />

        {/* 3. CRUD de inventario */}
        <Inventario userId={usuario.uid} />

        {/* 4. Asistente de cotizaciones */}
        <Cotizador userId={usuario.uid} />
      </main>
    </div>
  );
}

function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      setCargando(false);
    });

    return () => unsubscribe();
  }, []);

  if (cargando) {
    return (
      <div style={styles.loadingContainer}>
        <p style={styles.loadingText}>Cargando CotiFlow…</p>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/login"
          element={usuario ? <Navigate to="/" /> : <Login />}
        />
        <Route
          path="/"
          element={
            usuario ? (
              <DashboardInventario usuario={usuario} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </Router>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    backgroundColor: "#f3f4f6",
  },
  header: {
    backgroundColor: "#ffffff",
    borderBottom: "1px solid #e5e7eb",
    padding: "0.75rem 2rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    position: "sticky",
    top: 0,
    zIndex: 10,
    boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
  },
  logo: {
    width: "140px",
    maxHeight: "40px",
    objectFit: "contain",
  },
  brandBlock: {
    display: "flex",
    flexDirection: "column",
  },
  appName: {
    fontSize: "1.2rem",
    fontWeight: 600,
    color: "#111827",
  },
  appTagline: {
    fontSize: "0.85rem",
    color: "#6b7280",
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  userEmail: {
    color: "#4b5563",
    fontSize: "0.9rem",
    display: window.innerWidth < 640 ? "none" : "block",
  },
  logoutButton: {
    display: "flex",
    alignItems: "center",
    backgroundColor: "#ef4444",
    color: "#ffffff",
    border: "none",
    padding: "0.4rem 0.9rem",
    borderRadius: "999px",
    cursor: "pointer",
    fontSize: "0.9rem",
    fontWeight: 600,
  },
  mainContent: {
    padding: "1.5rem 2rem 2.5rem",
    maxWidth: "1200px",
    margin: "0 auto",
  },
  loadingContainer: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  loadingText: {
    color: "#4b5563",
    fontSize: "1.1rem",
  },
};

export default App;
