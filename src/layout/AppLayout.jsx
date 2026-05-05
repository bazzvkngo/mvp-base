import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { logout } from "../services/authService";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/empresa", label: "Empresa" },
  { to: "/inventario", label: "Inventario" },
  { to: "/referencias", label: "Referencias" },
  { to: "/valoración", label: "Valoración" },
  { to: "/cotizaciones/nueva", label: "Nueva cotización" },
  { to: "/cotizaciones", label: "Historial" },
];

function AppLayout({ usuario }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">VC</span>
          <div>
            <strong>ValoraCloud</strong>
            <span>Valoración y cotizaciones</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Navegación principal">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "nav-link nav-link-active" : "nav-link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">MVP de tesis</span>
            <h1>ValoraCloud</h1>
          </div>
          <div className="topbar-user">
            <span>{usuario?.email}</span>
            <button
              type="button"
              className="button-danger"
              onClick={() => logout()}
            >
              Cerrar sesión
            </button>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AppLayout;

