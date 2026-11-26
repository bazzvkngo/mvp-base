import React, {useEffect, useRef, useState} from "react";
import {Link, useNavigate, useParams} from "react-router-dom";
import Button from "../../../components/ui/Button";
import LoadingState from "../../../components/ui/LoadingState";
import {crearCliente, listarClientes} from "../../../services/clientService";
import ClientFormDialog from "../../clients/ClientFormDialog";
import {guardarPacienteVeterinario, subscribeToVeterinaryAttentions, subscribeToVeterinaryPatients} from "../data/veterinaryDataService";
import {buildVeterinaryPatientMutationPayload, formatVeterinaryPatientAge, getVeterinaryPatientFieldErrors} from "../domain/patientModel.mjs";
import VeterinaryPhotoMap from "../attention/VeterinaryPhotoMap";
import PatientDetail from "./PatientDetail";
import VeterinaryField from "../VeterinaryField";

const patientListPath = "/clinica-veterinaria/pacientes";
const patientPath = (id) => patientListPath + "/" + encodeURIComponent(id);
const textFields = [
  ["nombre", "Nombre", true], ["especie", "Especie", true],
  ["raza", "Raza"], ["sexo", "Sexo"], ["color", "Color"],
  ["fechaNacimiento", "Fecha de nacimiento", false, "date"],
  ["peso", "Peso (kg)"],
  ["microchip", "Microchip"],
];
const notesFields = [["alergias", "Alergias"], ["antecedentes", "Antecedentes"], ["observaciones", "Observaciones"]];

function PatientForm({businessId, countryCode, patient, tutors, onTutorCreated}) {
  const navigate = useNavigate();
  const [form, setForm] = useState(() => patient ?? {});
  const [tutorDialogOpen, setTutorDialogOpen] = useState(false);
  const pendingWrite = useRef(null);
  const [version] = useState(() => patient?.version ?? 0);
  const [newId] = useState(() => crypto.randomUUID());
  // La edad se calcula contra hoy, así que se actualiza con los días.
  const age = formatVeterinaryPatientAge(form.fechaNacimiento, new Date());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const activeTutors = tutors.filter((tutor) => tutor.estado === "activo");
  const selectedTutorAvailable = activeTutors.some((tutor) => tutor.id === form.tutorClienteId);
  const setField = (event) => {
    const {name, value} = event.target;
    setForm((current) => ({...current, [name]: value}));
    setFieldErrors((current) => ({...current, [name]: undefined}));
  };

  async function registerTutor(payload) {
    const client = await crearCliente(businessId, payload);
    const tutor = {...client, id: client.clienteId};
    onTutorCreated(tutor);
    setForm((current) => ({...current, tutorClienteId: tutor.id}));
    setFieldErrors((current) => ({...current, tutorClienteId: undefined}));
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const nextErrors = getVeterinaryPatientFieldErrors({...form, tutorClienteId: selectedTutorAvailable ? form.tutorClienteId : ""});
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setError("");
    try {
      const payload = buildVeterinaryPatientMutationPayload(form);
      const fingerprint = JSON.stringify(payload);
      if (pendingWrite.current?.fingerprint !== fingerprint) {
        pendingWrite.current = {fingerprint, requestId: crypto.randomUUID()};
      }
      const id = await guardarPacienteVeterinario(
        businessId, patient?.id ?? newId, payload, patient ? "editar" : "crear",
        pendingWrite.current.requestId, patient ? version : undefined
      );
      navigate(patientPath(id), {replace: true});
    } catch (failure) {
      const code = String(failure?.code ?? "").replace(/^functions\//, "");
      setError(
        ["veterinary-patient/invalid-data", "invalid-argument", "failed-precondition", "not-found", "already-exists", "aborted"].includes(code)
          ? failure.message
          : code === "permission-denied"
            ? "No tienes permisos para guardar pacientes en esta empresa."
            : "No se pudo guardar el paciente. Puedes volver a intentarlo."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="erp-panel">
      <h1>{patient ? "Editar paciente" : "Nuevo paciente"}</h1>
      {!activeTutors.length && <p>Registra un tutor activo para asociarlo al paciente.</p>}
      <form className="erp-form" onSubmit={save} noValidate>
        <VeterinaryField label="Tutor registrado" required error={fieldErrors.tutorClienteId}>
          <select className="erp-control" name="tutorClienteId" value={selectedTutorAvailable ? form.tutorClienteId : ""} onChange={setField}>
            <option value="">Selecciona un tutor</option>
            {activeTutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.nombreRazonSocial}</option>)}
          </select>
        </VeterinaryField>
        <Button type="button" variant="secondary" disabled={saving} onClick={() => setTutorDialogOpen(true)}>Registrar tutor</Button>
        <div className="erp-form-grid">
          {textFields.map(([name, label, required, type = "text"]) => (
            <VeterinaryField key={name} label={label} required={required} error={fieldErrors[name]}>
              <input className="erp-control" name={name} type={type} inputMode={name === "peso" ? "decimal" : undefined} value={form[name] ?? ""} onChange={setField} />
            </VeterinaryField>
          ))}
          {form.fechaNacimiento ? (
            <div className="erp-field">
              <span>Edad</span>
              <output>{age || "Edad no disponible para esa fecha."}</output>
            </div>
          ) : (
            <label className="erp-field">
              <span>Edad estimada</span>
              <input className="erp-control" name="edadEstimada" value={form.edadEstimada ?? ""} onChange={setField} />
            </label>
          )}
          {notesFields.map(([name, label]) => (
            <VeterinaryField key={name} label={label} error={fieldErrors[name]}>
              <textarea className="erp-control" name={name} value={form[name] ?? ""} onChange={setField} />
            </VeterinaryField>
          ))}
        </div>
        {error && <p className="erp-empty-state" role="alert">{error}</p>}
        <Button type="submit" loading={saving}>Guardar paciente</Button>
      </form>
      <ClientFormDialog open={tutorDialogOpen} countryCode={countryCode}
        onClose={() => setTutorDialogOpen(false)} onSubmit={registerTutor} />
    </section>
  );
}

function HistoryPhotos({attention, businessId}) {
  const [open, setOpen] = useState(false);
  const count = attention.fotosClinicas.length;

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Ver fotos clínicas ({count})</summary>
      {open && <VeterinaryPhotoMap businessId={businessId} attention={attention} />}
    </details>
  );
}

export default function VeterinaryPatients({businessId, countryCode, mode}) {
  const {pacienteId} = useParams();
  const navigate = useNavigate();
  const [patients, setPatients] = useState(null);
  const [tutors, setTutors] = useState(null);
  const [attentions, setAttentions] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!businessId) return undefined;
    let active = true;
    const unsubscribe = subscribeToVeterinaryPatients(businessId, setPatients, () => {
      setError("No se pudieron consultar los pacientes de esta empresa.");
    });
    listarClientes(businessId).then((items) => {
      if (active) setTutors(items);
    }).catch(() => {
      if (active) setError("No se pudieron consultar los tutores de esta empresa.");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [businessId]);

  useEffect(() => {
    if (!businessId || mode !== "detail") return undefined;
    return subscribeToVeterinaryAttentions(businessId, setAttentions, () => {
      setError("No se pudo consultar el historial clínico de esta empresa.");
    });
  }, [businessId, mode]);

  if (!businessId) return <p role="alert">Selecciona una empresa activa.</p>;
  if (error) return <p className="erp-empty-state" role="alert">{error}</p>;
  if (!patients || !tutors || (mode === "detail" && !attentions)) return <LoadingState variant="section" label="Cargando pacientes y tutores..." />;

  function addTutor(tutor) {
    setTutors((current) => [...current.filter((item) => item.id !== tutor.id), tutor]
      .sort((a, b) => a.nombreRazonSocial.localeCompare(b.nombreRazonSocial, "es-CL", {sensitivity: "base"})));
  }

  const patient = patients.find((item) => item.id === pacienteId);
  const tutorById = new Map(tutors.map((tutor) => [tutor.id, tutor]));
  const getTutor = (item) => tutorById.get(item.tutorClienteId);
  const query = search.trim().toLocaleLowerCase("es-CL");
  const visiblePatients = patients
    .filter((item) => [item.nombre, item.especie, item.microchip, getTutor(item)?.nombreRazonSocial].some(
      (value) => String(value ?? "").toLocaleLowerCase("es-CL").includes(query)
    ))
    .sort((a, b) => String(a.nombre ?? "").localeCompare(String(b.nombre ?? ""), "es-CL"));

  return (
    <div className="erp-page">
      <nav aria-label="Clínica Veterinaria">
        <Link to="/clinica-veterinaria">Resumen clínico</Link>
        {" · "}
        <Link to={patientListPath}>Pacientes</Link>
      </nav>
      {mode === "list" && (
        <section className="erp-panel">
          <h1>Pacientes</h1>
          <Link to={patientListPath + "/nuevo"}>Registrar paciente</Link>
          <label className="erp-field">
            <span>Buscar por nombre, especie, tutor o microchip</span>
            <input className="erp-control" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          {visiblePatients.length ? (
            <ul>
              {visiblePatients.map((item) => (
                <li key={item.id}>
                  <Link to={patientPath(item.id)}>{item.nombre || "Paciente"}</Link>
                  {" · "}{item.especie || "Especie sin registrar"}
                  {getTutor(item) && " · " + getTutor(item).nombreRazonSocial}
                </li>
              ))}
            </ul>
          ) : <p className="erp-empty-state">{query ? "No se encontraron coincidencias." : "No hay pacientes registrados."}</p>}
        </section>
      )}
      {mode === "new" && <PatientForm key="nuevo" businessId={businessId} countryCode={countryCode} tutors={tutors} onTutorCreated={addTutor} />}
      {mode === "edit" && patient && <PatientForm key={patient.id} businessId={businessId} countryCode={countryCode} patient={patient} tutors={tutors} onTutorCreated={addTutor} />}
      {mode === "edit" && !patient && <p className="erp-empty-state">Paciente no encontrado.</p>}
      {mode === "detail" && (
        <PatientDetail patient={patient} tutor={patient ? getTutor(patient) : null}
          showClinicalActivity={false} showHistory canMutate={Boolean(patient)}
          renderHistoryPhotos={(attention) => attention.fotosClinicas?.length > 0
            ? <HistoryPhotos businessId={businessId} attention={attention} />
            : null}
          history={(attentions ?? []).filter((item) => item.pacienteId === pacienteId && item.estado === "finalizada")
            .sort((a, b) => (b.finalizadaEn?.toMillis?.() ?? 0) - (a.finalizadaEn?.toMillis?.() ?? 0))}
          onEditPatient={patient ? () => navigate(patientPath(patient.id) + "/editar") : undefined} />
      )}
    </div>
  );
}
