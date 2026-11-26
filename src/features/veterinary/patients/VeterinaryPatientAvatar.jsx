import React, {useState} from "react";
import {PawPrint} from "lucide-react";
import AppIcon from "../../../components/ui/AppIcon";
import "./veterinary-patient-photo.css";

export function patientProfilePhotoUrl(photo) {
  return typeof photo?.imagen === "string" && photo.imagen ? "data:image/jpeg;base64," + photo.imagen : "";
}

export default function VeterinaryPatientAvatar({photo, alt = "", compact = false}) {
  const [failedSource, setFailedSource] = useState("");
  const source = patientProfilePhotoUrl(photo);
  const className = compact ? "veterinary-patient-avatar veterinary-patient-avatar--compact" : "veterinary-patient-avatar";

  if (source && source !== failedSource) {
    return <img className={className} src={source} alt={alt} onError={() => setFailedSource(source)} />;
  }

  return (
    <span className={className + " veterinary-patient-avatar--placeholder"} aria-hidden="true">
      <AppIcon icon={PawPrint} size={compact ? 22 : 30} />
    </span>
  );
}
