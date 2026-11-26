import React from "react";
import {House, SearchX} from "lucide-react";
import {useNavigate} from "react-router-dom";
import AppStatusPage from "./AppStatusPage";

// Ruta inexistente. `homePath`/`homeLabel` los decide quien la monta según haya
// o no sesión (con sesión: el inicio del rol; sin sesión: el ingreso).
function NotFoundPage({homeLabel = "Ir al inicio", homePath = "/", variant = "content"}) {
  const navigate = useNavigate();
  return (
    <AppStatusPage
      variant={variant}
      icon={SearchX}
      illustration="no-results"
      titleId="not-found-title"
      title="No encontramos esta página"
      description="La dirección que abriste no existe o cambió de lugar. Revisa que esté bien escrita o vuelve al inicio."
      actions={[{label: homeLabel, icon: House, onClick: () => navigate(homePath, {replace: true})}]}
    />
  );
}

export default NotFoundPage;
