import React from "react";
import {Navigate, Outlet, useLocation} from "react-router-dom";
import {canAccessBusinessPathForVerification} from "../domain/businessOperations.mjs";

export default function BusinessOperationGate({business}) {
  const location = useLocation();
  if (canAccessBusinessPathForVerification(business, location.pathname)) {
    return <Outlet />;
  }

  return <Navigate to="/empresa?seccion=verificacion" replace />;
}
