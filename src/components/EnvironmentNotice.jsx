import React from "react";
import { useLocation } from "react-router-dom";
import { firebaseEnvironment } from "../config/firebaseEnvironment.mjs";

// Aviso de entorno (solo en desarrollo). Dentro de AppLayout va como insignia
// en la barra superior (`inline`) para no tapar contenido; la versión
// flotante queda para las pantallas sin esa barra (consola de administración,
// propuesta pública, activación) y se oculta cuando la insignia está visible.
function EnvironmentNotice({ inline = false }) {
  const location = useLocation();

  if (
    !firebaseEnvironment.showDevelopmentNotice ||
    !firebaseEnvironment.notice ||
    ["/login", "/onboarding"].includes(location.pathname)
  ) {
    return null;
  }

  const modeClass = `environment-notice--${firebaseEnvironment.mode}`;

  if (inline) {
    return (
      <span
        className={`environment-notice environment-notice--inline ${modeClass}`}
        title={`Entorno Firebase: ${firebaseEnvironment.notice}`}
      >
        {firebaseEnvironment.mode === "emulator" ? "QA local" : firebaseEnvironment.notice}
      </span>
    );
  }

  return (
    <div
      className={`environment-notice environment-notice--floating ${modeClass}`}
      role="status"
      aria-label={`Entorno Firebase: ${firebaseEnvironment.notice}`}
    >
      {firebaseEnvironment.notice}
    </div>
  );
}

export default EnvironmentNotice;
