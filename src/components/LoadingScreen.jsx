import React from "react";
import BrandLogo from "./BrandLogo";
import LoadingState from "./ui/LoadingState";

// Pantalla de arranque de la app (auth y sesión de negocio). El retraso de
// aparición se aplica al contenido y no al fondo, para que el canvas sea
// constante. BrandLogo va como hermano de LoadingState y NUNCA dentro de su
// role="status", para que el lector no anuncie el nombre de la marca junto al
// texto de carga.
function LoadingScreen({ label = "Cargando ValoraCloud..." }) {
  return (
    <main className="brand-loader">
      <div className="brand-loader__content ui-reveal-delay">
        <BrandLogo variant="auth" />
        <LoadingState variant="page" label={label} />
      </div>
    </main>
  );
}

export default LoadingScreen;
