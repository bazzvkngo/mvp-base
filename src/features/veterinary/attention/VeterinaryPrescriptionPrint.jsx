import React, {useEffect, useState} from "react";
import {Printer} from "lucide-react";
import Button from "../../../components/ui/Button";
import LoadingState from "../../../components/ui/LoadingState";
import ResponsiveDialog from "../../../components/ui/ResponsiveDialog";
import useBusinessFormat from "../../../hooks/useBusinessFormat";
import {formatTimestamp} from "../../../utils/formatters";
import {
  consultarPacientesVeterinariosAsignados,
  getVeterinaryBusinessName,
  getVeterinaryPatient,
} from "../data/veterinaryDataService";
import "./veterinary-prescription-print.css";

function PrescriptionSheet({recipe, businessName, patient, tutorName, locale}) {
  return (
    <article className="veterinary-prescription-sheet" aria-label="Receta veterinaria">
      <header className="veterinary-prescription-sheet__heading">
        <div>
          <p>{businessName}</p>
          <h3>Receta veterinaria</h3>
        </div>
        <p><strong>Fecha y hora de emisión</strong><br />{formatTimestamp(recipe.emitidaEn, locale)}</p>
      </header>

      <dl className="veterinary-prescription-sheet__details">
        <div><dt>Paciente</dt><dd>{patient?.nombre || "________________"}</dd></div>
        <div><dt>Especie</dt><dd>{patient?.especie || "________________"}</dd></div>
        <div><dt>Tutor o responsable</dt><dd>{tutorName || "________________"}</dd></div>
        <div><dt>Profesional tratante</dt><dd>{recipe.profesionalNombre || "________________"}</dd></div>
      </dl>

      <section aria-label="Prescripción">
        <h4>Prescripción</h4>
        <ol className="veterinary-prescription-sheet__medications">
          {recipe.medicamentos.map((medication, index) => (
            <li key={index}>
              <h5>{medication.nombre}</h5>
              <dl className="veterinary-prescription-sheet__details">
                <div><dt>Dosis</dt><dd>{medication.dosis}</dd></div>
                <div><dt>Frecuencia</dt><dd>{medication.frecuencia}</dd></div>
                <div><dt>Duración</dt><dd>{medication.duracion}</dd></div>
              </dl>
              <p><strong>Instrucciones</strong><br />{medication.instrucciones || "—"}</p>
            </li>
          ))}
        </ol>
      </section>

      {recipe.indicaciones && (
        <section className="veterinary-prescription-sheet__instructions">
          <h4>Indicaciones generales</h4>
          <p>{recipe.indicaciones}</p>
        </section>
      )}

      <footer className="veterinary-prescription-sheet__signature">
        <p>{recipe.profesionalNombre}</p>
        <p>Firma y timbre del médico veterinario</p>
        <p>Identificación ____________________</p>
        <p>Domicilio ________________________</p>
      </footer>
    </article>
  );
}

export default function VeterinaryPrescriptionPrint({
  recipe, businessId, patient, patientId, assignedOnly, tutorName, onClose,
}) {
  const {locale} = useBusinessFormat();
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let active = true;
    const patientRequest = patient || !patientId ? Promise.resolve(patient)
      : assignedOnly
        ? consultarPacientesVeterinariosAsignados(businessId, patientId).then((result) => result.patient)
        : getVeterinaryPatient(businessId, patientId);
    Promise.all([getVeterinaryBusinessName(businessId), patientRequest])
      .then(([businessName, patientData]) => {
        if (!businessName) throw new Error("El negocio no tiene nombre registrado.");
        if (active) setPreview({businessName, patient: patientData});
      })
      .catch(() => {
        if (active) setPreview({error: "No se pudieron cargar los datos de la receta. Vuelve a abrir la vista previa."});
      });
    return () => { active = false; };
  }, [assignedOnly, businessId, patient, patientId]);

  const ready = Boolean(preview?.businessName);
  return (
    <ResponsiveDialog
      open
      title="Vista previa de la receta"
      onClose={onClose}
      layerClassName={ready ? "veterinary-prescription-print-layer" : ""}
      className="veterinary-prescription-print-dialog"
      footer={(
        <Button type="button" icon={Printer} disabled={!ready} onClick={() => window.print()}>
          Imprimir
        </Button>
      )}
    >
      {preview?.error ? <p role="alert">{preview.error}</p> : ready ? (
        <PrescriptionSheet recipe={recipe} businessName={preview.businessName}
          patient={preview.patient} tutorName={tutorName} locale={locale} />
      ) : <LoadingState variant="section" label="Preparando la receta..." />}
    </ResponsiveDialog>
  );
}
