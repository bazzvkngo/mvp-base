import React from "react";
import {
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import VeterinaryManager, {VeterinaryProfessionalHome} from "./VeterinaryManager";
import VeterinaryAgenda from "./agenda/VeterinaryAgenda";
import VeterinaryAttention from "./attention/VeterinaryAttention";
import VeterinaryPatients, {AssignedVeterinaryPatient} from "./patients/VeterinaryPatients";
import VeterinaryOrders from "./orders/VeterinaryOrders";


function VeterinaryRoutes({
  businessId,
  countryCode,
  professionalUid,
  role,
}) {
  if (professionalUid) {
    const scopeKey = `${businessId}:${professionalUid}`;
    return (
      <Routes>
        <Route index element={<VeterinaryProfessionalHome key={scopeKey} businessId={businessId} professionalUid={professionalUid} />} />
        <Route path="agenda" element={<VeterinaryAgenda key={scopeKey} businessId={businessId} professionalUid={professionalUid} mode="list" />} />
        <Route path="citas/:citaId" element={<VeterinaryAgenda key={scopeKey} businessId={businessId} professionalUid={professionalUid} mode="detail" />} />
        <Route path="ordenes" element={<VeterinaryOrders key={scopeKey} businessId={businessId} professionalUid={professionalUid} />} />
        <Route path="ordenes/:atencionId" element={<VeterinaryOrders key={scopeKey} businessId={businessId} professionalUid={professionalUid} mode="detail" />} />
        <Route path="ordenes/:atencionId/atencion" element={<VeterinaryAttention key={scopeKey} businessId={businessId} professionalUid={professionalUid} />} />
        <Route path="pacientes" element={<AssignedVeterinaryPatient key={scopeKey} businessId={businessId} professionalUid={professionalUid} />} />
        <Route path="pacientes/:pacienteId" element={<AssignedVeterinaryPatient key={scopeKey} businessId={businessId} professionalUid={professionalUid} />} />
        <Route path="*" element={<Navigate to="/clinica-veterinaria" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route
        index
        element={
          <VeterinaryManager
            key={businessId}
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
      <Route path="ordenes" element={<VeterinaryOrders key={businessId + ":ordenes"} businessId={businessId} />} />
      <Route path="ordenes/recepcion" element={<VeterinaryOrders key={businessId + ":recepcion"} businessId={businessId} mode="reception" />} />
      <Route path="ordenes/emergencia" element={<VeterinaryOrders key={businessId + ":emergencia"} businessId={businessId} mode="emergency" />} />
      <Route path="ordenes/:atencionId" element={<VeterinaryOrders key={businessId + ":orden"} businessId={businessId} mode="detail" />} />
      <Route path="ordenes/:atencionId/atencion" element={<VeterinaryAttention key={businessId} businessId={businessId} />} />
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
