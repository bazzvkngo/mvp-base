import React from "react";
import {
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import VeterinaryManager from "./VeterinaryManager";


function VeterinaryRoutes({
  businessId,
  role,
}) {
  return (
    <Routes>
      <Route
        index
        element={
          <VeterinaryManager
            businessId={businessId}
            role={role}
          />
        }
      />

      <Route
        path="pacientes"
        element={
          <VeterinaryManager
            businessId={businessId}
            role={role}
          />
        }
      />

      <Route
        path="pacientes/nuevo"
        element={
          <VeterinaryManager
            businessId={businessId}
            role={role}
          />
        }
      />

      <Route
        path="pacientes/:pacienteId"
        element={
          <VeterinaryManager
            businessId={businessId}
            role={role}
          />
        }
      />

      <Route
        path="agenda"
        element={
          <VeterinaryManager
            businessId={businessId}
            role={role}
          />
        }
      />

      <Route
        path="agenda/nueva"
        element={
          <VeterinaryManager
            businessId={businessId}
            role={role}
          />
        }
      />

      <Route
        path="citas/:citaId"
        element={
          <VeterinaryManager
            businessId={businessId}
            role={role}
          />
        }
      />

      <Route
        path="*"
        element={
          <Navigate
            to="/clinica-veterinaria"
            replace
          />
        }
      />
    </Routes>
  );
}


export default VeterinaryRoutes;
