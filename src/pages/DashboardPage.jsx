import React from "react";

function DashboardPage({ usuario }) {
  return (
    <section className="page-section">
      <div className="section-header">
        <span className="eyebrow">Inicio</span>
        <h2>Dashboard</h2>
        <p>
          Base inicial del MVP. Desde aqui se accede al flujo inventario,
          valorizacion y cotizaciones.
        </p>
      </div>
      <div className="summary-grid">
        <article className="summary-card">
          <span>Usuario</span>
          <strong>{usuario?.email || "Sesion activa"}</strong>
        </article>
        <article className="summary-card">
          <span>Estado</span>
          <strong>Preparado para MVP</strong>
        </article>
        <article className="summary-card">
          <span>Siguiente foco</span>
          <strong>Valorizacion previa</strong>
        </article>
      </div>
    </section>
  );
}

export default DashboardPage;
