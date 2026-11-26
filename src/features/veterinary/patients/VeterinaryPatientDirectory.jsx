import React, {useEffect, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import Button from "../../../components/ui/Button";
import {getVeterinaryPatientProfilePhoto} from "../data/veterinaryDataService";
import VeterinaryPatientAvatar from "./VeterinaryPatientAvatar";
import "./veterinary-patient-directory.css";

function PatientRow({businessId, assignedOnly, patient, subtitle, onOpen}) {
  const row = useRef(null);
  const [photo, setPhoto] = useState(null);
  const {id, version} = patient;
  const name = patient.nombre || "Paciente";

  useEffect(() => {
    let active = true;
    function loadPhoto() {
      getVeterinaryPatientProfilePhoto(businessId, id, {assignedOnly})
        .then((currentPhoto) => { if (active) setPhoto(currentPhoto); })
        .catch(() => { if (active) setPhoto(null); });
    }

    if (typeof IntersectionObserver === "undefined") {
      loadPhoto();
      return () => { active = false; };
    }

    const observer = new IntersectionObserver((entries) => {
      if (!active || !entries.some(({isIntersecting}) => isIntersecting)) return;
      observer.disconnect();
      loadPhoto();
    });
    observer.observe(row.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [assignedOnly, businessId, id, version]);

  return (
    <li className="veterinary-patient-directory__row" ref={row}>
      <VeterinaryPatientAvatar compact photo={photo} />
      <div className="veterinary-patient-directory__details">
        <strong>{name}</strong>
        {subtitle && <span className="erp-secondary-text">{subtitle}</span>}
      </div>
      <Button type="button" variant="secondary" aria-label={"Ver ficha de " + name} onClick={onOpen}>
        Ver ficha
      </Button>
    </li>
  );
}

export default function VeterinaryPatientDirectory({businessId, patients, getTutor, patientPath, assignedOnly = false}) {
  const navigate = useNavigate();
  return (
    <ul className="veterinary-patient-directory" role="list">
      {patients.map((patient) => (
        <PatientRow key={patient.id} businessId={businessId} assignedOnly={assignedOnly} patient={patient}
          subtitle={[patient.especie, patient.raza, getTutor?.(patient)?.nombreRazonSocial].filter(Boolean).join(" · ")}
          onOpen={() => navigate(patientPath(patient.id))} />
      ))}
    </ul>
  );
}
