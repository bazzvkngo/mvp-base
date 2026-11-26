import React from "react";
import {Navigate, Outlet, useLocation, useOutletContext} from "react-router-dom";
import {canAccessBusinessPathForVerification} from "../domain/businessOperations.mjs";

export default function BusinessOperationGate({business}) {
  const location = useLocation();
  // Un Outlet sin context pisa el del layout con undefined: se reenvía para que las rutas hijas lo reciban.
  const outletContext = useOutletContext();
  if (canAccessBusinessPathForVerification(business, location.pathname)) {
    return <Outlet context={outletContext} />;
  }

  return <Navigate to="/empresa?seccion=verificacion" replace />;
}
