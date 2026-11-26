import React, {useState} from "react";
import Button from "../../../components/ui/Button";
import {imageAsJpeg} from "../domain/photoEncoding.mjs";
import VeterinaryField from "../VeterinaryField";
import {patientProfilePhotoUrl} from "./VeterinaryPatientAvatar";

const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
const PROFILE_ENCODING = {maxSide: 512, maxBytes: 192 * 1024, sizeLabel: "192 KiB"};

export default function VeterinaryPatientPhotoField({photo, savedPhoto, disabled, onChange, onPreparingChange}) {
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const source = patientProfilePhotoUrl(photo === undefined ? savedPhoto : photo);

  async function selectPhoto(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || disabled || preparing) return;
    setError("");
    if (!acceptedTypes.includes(file.type)) {
      setError("Selecciona una foto JPEG, PNG o WebP.");
      return;
    }
    if (!file.size || file.size > MAX_ORIGINAL_BYTES) {
      setError("La foto debe tener contenido y pesar como máximo 20 MiB.");
      return;
    }
    setPreparing(true);
    onPreparingChange(true);
    try {
      const imagen = await imageAsJpeg(file, PROFILE_ENCODING);
      onChange({imagen});
    } catch (failure) {
      setError(failure.message || "No se pudo preparar la foto.");
    } finally {
      setPreparing(false);
      onPreparingChange(false);
    }
  }

  return (
    <div className="erp-field">
      <VeterinaryField label="Foto de perfil (opcional)" error={error}>
        <input type="file" className="erp-control" accept={acceptedTypes.join(",")}
          disabled={disabled || preparing} onChange={selectPhoto} />
      </VeterinaryField>
      {preparing && <p role="status">Preparando foto de perfil...</p>}
      {source && (
        <div className="veterinary-patient-photo-actions">
          <img className="veterinary-patient-avatar" src={source} alt="Vista previa de la foto de perfil" />
          <Button type="button" variant="secondary" disabled={disabled || preparing} onClick={() => {
            setError("");
            onChange(null);
          }}>Quitar foto</Button>
        </div>
      )}
    </div>
  );
}
