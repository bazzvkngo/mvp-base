import React from "react";

function TallerPlaceholderPage({ description, title }) {
  return (
    <main className="erp-page">
      <header className="erp-page-header">
        <div className="erp-page-header__content">
          <span className="erp-page-header__eyebrow">Taller</span>
          <h1 className="erp-page-header__title">{title}</h1>
          <p className="erp-page-header__description">{description}</p>
        </div>
      </header>
      <section className="erp-empty-state" role="status">
        Esta sección estará disponible en una próxima etapa del módulo Taller.
      </section>
    </main>
  );
}

export default TallerPlaceholderPage;
