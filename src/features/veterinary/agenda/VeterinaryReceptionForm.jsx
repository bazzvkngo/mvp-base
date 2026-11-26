import React, {useState} from "react";
import Button from "../../../components/ui/Button";
import {guardarRecepcionVeterinaria} from "../data/veterinaryDataService";
import VeterinaryField from "../VeterinaryField";
import {
  getVeterinaryReceptionFieldErrors,
  getVeterinaryTriageFieldErrors,
  VETERINARY_TRIAGE_LIMITS,
  VETERINARY_TRIAGE_PRIORITIES,
} from "../domain/receptionTriageModel.mjs";

export const triageLabels = {normal: "Normal", prioritaria: "Prioritaria", urgente: "Urgente"};

// Los límites (min/max) salen de VETERINARY_TRIAGE_LIMITS, el mismo modelo que valida el backend.
const vitalFields = [
  ["pesoKg", "Peso (kg)", "any"],
  ["temperaturaC", "Temperatura (°C)", "any"],
  ["frecuenciaCardiaca", "Frecuencia cardíaca (lat/min)", "1"],
  ["frecuenciaRespiratoria", "Frecuencia respiratoria (resp/min)", "1"],
];

export default function VeterinaryReceptionForm({appointment, businessId}) {
  const [form, setForm] = useState(() => ({...appointment.recepcion, ...appointment.triage}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const change = ({target: {name, value}}) => {
    setSaved(false);
    setForm((current) => ({...current, [name]: value}));
    setFieldErrors((current) => ({...current, [name]: undefined}));
  };
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const names = ["horaLlegada", "prioridad", "observacionesRecepcion", "observacionesTriage", ...vitalFields.map(([name]) => name)];
    const reception = Object.fromEntries(names.map((name) => [name, form[name] ?? ""]));
    // El paciente y el tutor los resuelve la Function desde la cita; aquí solo se validan los campos del formulario.
    const context = {citaId: appointment.id, pacienteId: appointment.pacienteId || "-", tutorClienteId: "-"};
    const nextErrors = {
      ...getVeterinaryReceptionFieldErrors({...reception, ...context}),
      ...getVeterinaryTriageFieldErrors({...reception, ...context}),
    };
    for (const key of Object.keys(context)) delete nextErrors[key];
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await guardarRecepcionVeterinaria(businessId, appointment.id, reception);
      setSaved(true);
    } catch (failure) {
      const code = String(failure?.code || "").replace(/^functions\//, "");
      setError(["invalid-argument", "failed-precondition", "not-found"].includes(code) ? failure.message : "No se pudo guardar la recepción.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="erp-panel">
      <h2>Recepción y triage</h2>
      <form className="erp-form" onSubmit={save} noValidate>
        <div className="erp-form-grid">
          <VeterinaryField label="Hora de llegada" required error={fieldErrors.horaLlegada}>
            <input className="erp-control" type="time" name="horaLlegada" value={form.horaLlegada ?? ""} onChange={change} />
          </VeterinaryField>
          <VeterinaryField label="Prioridad" required error={fieldErrors.prioridad}>
            <select className="erp-control" name="prioridad" value={form.prioridad ?? ""} onChange={change}>
              <option value="">Selecciona la prioridad</option>
              {VETERINARY_TRIAGE_PRIORITIES.map((priority) => <option value={priority} key={priority}>{triageLabels[priority]}</option>)}
            </select>
          </VeterinaryField>
          {vitalFields.map(([name, label, step]) => (
            <VeterinaryField label={label} key={name} error={fieldErrors[name]}>
              <input className="erp-control" type="number" min={VETERINARY_TRIAGE_LIMITS[name].min} max={VETERINARY_TRIAGE_LIMITS[name].max} step={step} name={name} value={form[name] ?? ""} onChange={change} />
            </VeterinaryField>
          ))}
          <VeterinaryField label="Observaciones de recepción" error={fieldErrors.observacionesRecepcion}>
            <textarea className="erp-control" name="observacionesRecepcion" maxLength={1000} value={form.observacionesRecepcion ?? ""} onChange={change} />
          </VeterinaryField>
          <VeterinaryField label="Observaciones de triage" error={fieldErrors.observacionesTriage}>
            <textarea className="erp-control" name="observacionesTriage" maxLength={2000} value={form.observacionesTriage ?? ""} onChange={change} />
          </VeterinaryField>
        </div>
        {error && <p role="alert">{error}</p>}
        {saved && <p role="status">Recepción y triage guardados.</p>}
        <Button type="submit" loading={saving}>Guardar recepción y triage</Button>
      </form>
    </section>
  );
}
