import React from "react";
import {
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import VeterinaryManager from "./VeterinaryManager";
import VeterinaryAgenda from "./agenda/VeterinaryAgenda";
import VeterinaryAttention from "./attention/VeterinaryAttention";
import VeterinaryPatients from "./patients/VeterinaryPatients";


function VeterinaryRoutes({
  businessId,
  countryCode,
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

      <Route path="pacientes" element={<VeterinaryPatients key={businessId} businessId={businessId} countryCode={countryCode} mode="list" />} />
      <Route path="pacientes/nuevo" element={<VeterinaryPatients key={businessId} businessId={businessId} countryCode={countryCode} mode="new" />} />
      <Route path="pacientes/:pacienteId" element={<VeterinaryPatients key={businessId} businessId={businessId} countryCode={countryCode} mode="detail" />} />
      <Route path="pacientes/:pacienteId/editar" element={<VeterinaryPatients key={businessId} businessId={businessId} countryCode={countryCode} mode="edit" />} />

      <Route path="agenda" element={<VeterinaryAgenda key={businessId} businessId={businessId} mode="list" />} />
      <Route path="agenda/nueva" element={<VeterinaryAgenda key={businessId} businessId={businessId} mode="new" />} />
      <Route path="citas/:citaId/atencion" element={<VeterinaryAttention key={businessId} businessId={businessId} />} />
      <Route path="citas/:citaId" element={<VeterinaryAgenda key={businessId} businessId={businessId} mode="detail" />} />

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
