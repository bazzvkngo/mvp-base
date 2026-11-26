import React from "react";
import PageHeader from "../components/ui/PageHeader";
import { getRouteMeta, routeProvidesPageHeading } from "../app/navigation";

// Título de la barra superior. Si la página de la ruta dibuja su propio h1
// (PAGE_HEADING_ROUTES: /reportes hoy), la barra muestra solo el negocio activo; si no,
// el eyebrow + título de siempre. Así nunca hay dos h1 en la misma pantalla.
function TopbarHeading({ businessName, pathname }) {
  const name = businessName || "Módulo activo";
  if (routeProvidesPageHeading(pathname)) {
    return (
      <div className="topbar-context" aria-label="Negocio activo">
        <span>{name}</span>
      </div>
    );
  }
  return <PageHeader eyebrow={name} title={getRouteMeta(pathname).title} />;
}

export default TopbarHeading;
