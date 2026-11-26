import React, {useId, useState} from "react";
import {Printer} from "lucide-react";
import Button from "../../../components/ui/Button";
import useBusinessFormat from "../../../hooks/useBusinessFormat";
import {formatTimestamp} from "../../../utils/formatters";
import {operarOrdenVeterinaria} from "../data/veterinaryDataService";
import VeterinaryPrescriptionPrint from "./VeterinaryPrescriptionPrint";

const fields = [
  {name: "nombre", label: "Medicamento", max: 120, guide: "Escribe el nombre y la presentación"},
  {name: "dosis", label: "Dosis", max: 80, guide: "Escribe la dosis y su unidad"},
  {name: "frecuencia", label: "Frecuencia", max: 80, guide: "Escribe cada cuánto se administra"},
  {name: "duracion", label: "Duración", max: 80, guide: "Escribe cuánto dura el tratamiento"},
  {name: "instrucciones", label: "Instrucciones", max: 300, guide: "Anota la vía o las indicaciones adicionales"},
];

function createMedication() {
  return {key: crypto.randomUUID(), ...Object.fromEntries(fields.map(({name}) => [name, ""]))};
}

export function VeterinaryPrescriptionList({prescriptions = [], businessId, patient, patientId, assignedOnly, tutorName}) {
  const {locale} = useBusinessFormat();
  const [printRecipe, setPrintRecipe] = useState(null);
  if (!prescriptions.length) return null;
  return (
    <>
      <ul className="veterinary-record-list">
        {prescriptions.map((recipe) => (
          <li key={recipe.recetaId}>
            <p><strong>Emitida por {recipe.profesionalNombre}</strong>{" · "}{formatTimestamp(recipe.emitidaEn, locale)}</p>
            <ul>
              {recipe.medicamentos.map((medication, index) => (
                <li key={index}>
                  <strong>{medication.nombre}</strong>
                  {" · "}{medication.dosis}{" · "}{medication.frecuencia}{" · "}{medication.duracion}
                  {medication.instrucciones && <p>{medication.instrucciones}</p>}
                </li>
              ))}
            </ul>
            {recipe.indicaciones && <p><strong>Indicaciones:</strong> {recipe.indicaciones}</p>}
            <Button type="button" variant="secondary" icon={Printer} onClick={() => setPrintRecipe(recipe)}>
              Imprimir receta
            </Button>
          </li>
        ))}
      </ul>
      {printRecipe && (
        <VeterinaryPrescriptionPrint recipe={printRecipe} businessId={businessId}
          patient={patient} patientId={patientId} assignedOnly={assignedOnly} tutorName={tutorName}
          onClose={() => setPrintRecipe(null)} />
      )}
    </>
  );
}

export default function VeterinaryPrescriptions({attention, businessId, assignedOnly, canIssue, onSavingChange}) {
  const headingId = useId();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const prescriptions = attention.recetas ?? [];

  function openDraft() {
    setError("");
    setNotice("");
    setDraft({id: crypto.randomUUID(), medications: [createMedication()], instructions: ""});
  }

  function setMedication(key, name, value) {
    setDraft((current) => ({
      ...current,
      medications: current.medications.map((med) => med.key === key ? {...med, [name]: value} : med),
    }));
  }

  async function emit(event) {
    event.preventDefault();
    if (!canIssue || !draft || saving) return;
    setSaving(true);
    onSavingChange(true);
    setError("");
    try {
      await operarOrdenVeterinaria(businessId, attention.id, "emitirReceta", {
        recetaId: draft.id,
        medicamentos: draft.medications.map(({key, ...medication}) => medication),
        indicaciones: draft.instructions,
      });
      setDraft(null);
      setNotice("Receta emitida y guardada en la atención.");
    } catch (failure) {
      const code = String(failure?.code ?? "").replace(/^functions\//, "");
      setError(["invalid-argument", "failed-precondition", "permission-denied", "already-exists"].includes(code)
        ? failure.message : "No se pudo guardar la receta. Inténtalo nuevamente.");
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  return (
    <section className="erp-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>Recetas veterinarias</h2>
      {prescriptions.length > 0
        ? <VeterinaryPrescriptionList prescriptions={prescriptions} businessId={businessId}
          patientId={attention.pacienteId} assignedOnly={assignedOnly} />
        : <p className="erp-secondary-text">Esta orden aún no tiene recetas emitidas.</p>}
      {notice && <p role="status">{notice}</p>}
      {canIssue && !draft && prescriptions.length < 5 && (
        <Button type="button" variant="secondary" onClick={openDraft}>Nueva receta</Button>
      )}
      {canIssue && draft && (
        <form className="erp-form" onSubmit={emit}>
          {draft.medications.map((medication, index) => (
            <fieldset key={medication.key} className="erp-panel">
              <legend>Medicamento {index + 1}</legend>
              <div className="erp-form-grid">
                {fields.map(({name, label, max, guide}) => (
                  <label key={name} className="erp-field">
                    <span>{label}{name === "instrucciones" ? "" : " *"}</span>
                    <input className="erp-control" type="text" value={medication[name]} maxLength={max}
                      placeholder={guide} required={name !== "instrucciones"} disabled={saving}
                      onChange={(event) => setMedication(medication.key, name, event.target.value)} />
                  </label>
                ))}
              </div>
              {draft.medications.length > 1 && (
                <Button type="button" variant="secondary" disabled={saving}
                  onClick={() => setDraft((current) => ({
                    ...current,
                    medications: current.medications.filter((item) => item.key !== medication.key),
                  }))}>Quitar medicamento {index + 1}</Button>
              )}
            </fieldset>
          ))}
          <Button type="button" variant="secondary" disabled={saving || draft.medications.length >= 10}
            onClick={() => setDraft((current) => ({
              ...current,
              medications: [...current.medications, createMedication()],
            }))}>Añadir medicamento</Button>
          <label className="erp-field">
            <span>Indicaciones generales</span>
            <textarea className="erp-control" value={draft.instructions} maxLength={1000} disabled={saving}
              placeholder="Anota las indicaciones que debe seguir el tutor"
              onChange={(event) => setDraft((current) => ({...current, instructions: event.target.value}))} />
          </label>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" loading={saving}>Emitir receta</Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={() => setDraft(null)}>Cancelar receta</Button>
        </form>
      )}
    </section>
  );
}
