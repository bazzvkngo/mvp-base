import {useEffect, useState} from "react";
import {
  consultarPacientesVeterinariosAsignados,
  subscribeToVeterinaryPatients,
} from "./data/veterinaryDataService";

export default function useVeterinaryPatientDirectory(businessId, professionalUid, assignments) {
  const [patients, setPatients] = useState(null);
  const [error, setError] = useState("");
  const assignmentKey = professionalUid && assignments && [...new Set(assignments
    .filter(({estado, pacienteId}) => estado !== "cancelada" && pacienteId)
    .map(({pacienteId}) => pacienteId))].sort().join(",");

  useEffect(() => {
    if (!businessId) return undefined;
    const fail = () => setError("No se pudieron cargar los pacientes.");
    setError("");
    if (!professionalUid) return subscribeToVeterinaryPatients(businessId, setPatients, fail);
    if (assignmentKey === null || assignmentKey === undefined) return undefined;
    if (!assignmentKey) {
      setPatients([]);
      return undefined;
    }
    let active = true;
    consultarPacientesVeterinariosAsignados(businessId)
      .then(({patients: items}) => { if (active) setPatients(items); })
      .catch(() => { if (active) fail(); });
    return () => { active = false; };
  }, [businessId, professionalUid, assignmentKey]);

  return {patients, error};
}
