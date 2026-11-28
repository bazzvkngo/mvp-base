import React, {useEffect, useRef, useState} from "react";
import {ArrowLeft, PawPrint, Plus, Search} from "lucide-react";
import {Link, useNavigate, useParams} from "react-router-dom";
import AppIcon from "../../../components/ui/AppIcon";
import Button from "../../../components/ui/Button";
import EmptyState from "../../../components/ui/EmptyState";
import LoadingState from "../../../components/ui/LoadingState";
import ModuleHeader from "../../../components/ui/ModuleHeader";
import {crearCliente, listarClientes} from "../../../services/clientService";
import ClientFormDialog from "../../clients/ClientFormDialog";
import {
  consultarPacientesVeterinariosAsignados,
  getVeterinaryPatientProfilePhoto,
  guardarPacienteVeterinario,
  subscribeToVeterinaryAttentions,
  subscribeToVeterinaryPatients,
} from "../data/veterinaryDataService";
import {buildVeterinaryPatientMutationPayload, formatVeterinaryPatientAge, getVeterinaryPatientFieldErrors} from "../domain/patientModel.mjs";
import {matchesRutSearch} from "../../../domain/rut.mjs";
import VeterinaryPhotoMap from "../attention/VeterinaryPhotoMap";
import MicrochipScanner from "./MicrochipScanner";
import PatientDetail from "./PatientDetail";
import PatientSearchField from "./PatientSearchField";
import VeterinaryPatientDirectory from "./VeterinaryPatientDirectory";
import VeterinaryPatientPhotoField from "./VeterinaryPatientPhotoField";
import {getPatientBreedOptions, PATIENT_SEX_OPTIONS, PATIENT_SPECIES_OPTIONS} from "./patientFormOptions.mjs";
import VeterinaryField from "../VeterinaryField";
import "../veterinary-lists.css";
import "./veterinary-patient-progress.css";

const patientListPath = "/clinica-veterinaria/pacientes";
const patientPath = (id) => patientListPath + "/" + encodeURIComponent(id);
const detailFields = [
  ["color", "Color", "Ej. Negro con blanco"],
  ["fechaNacimiento", "Fecha de nacimiento", undefined, "date"],
];
const notesFields = [
  ["alergias", "Alergias", "Indica medicamentos o alimentos que le causan alergia"],
  ["antecedentes", "Antecedentes", "Anota cirugías, enfermedades o tratamientos previos"],
  ["observaciones", "Observaciones", "Agrega información para futuras consultas"],
];
const patientFormSteps = [
  {title: "Tutor e identificación", label: "Tutor y mascota", fields: ["tutorClienteId", "nombre", "especie", "raza", "sexo"]},
  {title: "Características y edad", label: "Edad y peso", fields: ["color", "fechaNacimiento", "edadEstimada", "peso"]},
  {title: "Información clínica", label: "Datos clínicos", fields: notesFields.map(([name]) => name)},
  {title: "Microchip y foto", label: "Microchip y foto", fields: ["microchip"]},
];

function PatientFormProgress({stepIndex}) {
  const remaining = patientFormSteps.length - stepIndex - 1;
  const remainingLabel = remaining === 1 ? "Queda 1 paso después de este" : `Quedan ${remaining} pasos después de este`;
  return (
    <div className="veterinary-patient-progress">
      <ol className="veterinary-patient-progress__steps" role="list" aria-label="Progreso de la ficha del paciente">
        {patientFormSteps.map(({label}, index) => {
          const current = index === stepIndex;
          const complete = index < stepIndex;
          return (
            <li className="veterinary-patient-progress__step" key={label}
              aria-current={current ? "step" : undefined}
              data-status={complete ? "complete" : undefined}>
              <span className="veterinary-patient-progress__paw"><AppIcon icon={PawPrint} /></span>
              <span>{label}{complete && <span className="sr-only">, completado</span>}</span>
            </li>
          );
        })}
      </ol>
      <p className="veterinary-patient-progress__remaining">
        {remaining === 0 ? "Último paso" : remainingLabel}
      </p>
    </div>
  );
}

function PatientSelectField({name, label, value = "", options, placeholder, onChange, disabled, required, error}) {
  // Las fichas antiguas pueden tener un valor escrito a mano. Se conserva al editar.
  const visibleOptions = value && !options.includes(value) ? [...options, value] : options;
  return (
    <VeterinaryField label={label} required={required} error={error}>
      <select className="erp-control" name={name} value={value ?? ""} onChange={onChange} disabled={disabled}>
        <option value="">{placeholder}</option>
        {visibleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </VeterinaryField>
  );
}

function PatientForm({businessId, countryCode, patient, tutors, onTutorCreated}) {
  const navigate = useNavigate();
  const [form, setForm] = useState(() => patient ?? {});
  const [stepIndex, setStepIndex] = useState(0);
  const [photo, setPhoto] = useState(undefined);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [savedPhotoResult, setSavedPhotoResult] = useState(null);
  const [tutorDialogOpen, setTutorDialogOpen] = useState(false);
  const pendingWrite = useRef(null);
  const formRef = useRef(null);
  const stepHeading = useRef(null);
  const focusRequest = useRef(null);
  const [version] = useState(() => patient?.version ?? 0);
  const [newId] = useState(() => crypto.randomUUID());
  // La edad se calcula contra hoy, así que se actualiza con los días.
  const age = formatVeterinaryPatientAge(form.fechaNacimiento, new Date());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const patientId = patient?.id;
  const step = patientFormSteps[stepIndex];
  const finalStep = stepIndex === patientFormSteps.length - 1;
  const loadingSavedPhoto = Boolean(patientId && !savedPhotoResult);
  const activeTutors = tutors.filter((tutor) => tutor.estado === "activo");
  const selectedTutorAvailable = activeTutors.some((tutor) => tutor.id === form.tutorClienteId);
  const breedOptions = getPatientBreedOptions(form.especie);

  useEffect(() => {
    if (!patientId) return undefined;
    let active = true;
    getVeterinaryPatientProfilePhoto(businessId, patientId)
      .then((savedPhoto) => { if (active) setSavedPhotoResult({photo: savedPhoto}); })
      .catch(() => { if (active) setSavedPhotoResult({error: true}); });
    return () => { active = false; };
  }, [businessId, patientId]);

  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    focusRequest.current = null;
    const field = request.field && formRef.current?.elements.namedItem(request.field);
    (field || stepHeading.current)?.focus();
  }, [fieldErrors, stepIndex]);

  function goToStep(index, field) {
    focusRequest.current = {field};
    setStepIndex(index);
  }

  const setPatientValue = (name, value) => {
    const speciesChanged = name === "especie" && form.especie !== value;
    setForm((current) => ({...current, [name]: value, ...(speciesChanged ? {raza: ""} : {})}));
    setFieldErrors((current) => ({...current, [name]: undefined, ...(speciesChanged ? {raza: undefined} : {})}));
  };
  const setField = ({target: {name, value}}) => setPatientValue(name, value);

  async function registerTutor(payload) {
    const client = await crearCliente(businessId, payload);
    const tutor = {...client, id: client.clienteId};
    onTutorCreated(tutor);
    setForm((current) => ({...current, tutorClienteId: tutor.id}));
    setFieldErrors((current) => ({...current, tutorClienteId: undefined}));
  }

  async function submitStep(event) {
    event.preventDefault();
    if (saving || preparingPhoto || (finalStep && loadingSavedPhoto)) return;
    setError("");
    const input = {
      ...form,
      tutorClienteId: selectedTutorAvailable ? form.tutorClienteId : "",
    };
    const errors = getVeterinaryPatientFieldErrors(input);
    const invalidStep = finalStep
      ? patientFormSteps.findIndex(({fields}) => fields.some((name) => errors[name]))
      : step.fields.some((name) => errors[name]) ? stepIndex : -1;
    if (invalidStep !== -1) {
      const invalidFields = patientFormSteps[invalidStep].fields.filter((name) => errors[name]);
      setFieldErrors(Object.fromEntries(invalidFields.map((name) => [name, errors[name]])));
      goToStep(invalidStep, invalidFields[0]);
      return;
    }
    setFieldErrors({});
    if (!finalStep) {
      goToStep(stepIndex + 1);
      return;
    }

    setSaving(true);
    try {
      const payload = buildVeterinaryPatientMutationPayload(input);
      const fotoPerfil = photo === undefined ? undefined : photo?.imagen ?? null;
      const fingerprint = JSON.stringify({payload, fotoPerfil});
      if (pendingWrite.current?.fingerprint !== fingerprint) {
        pendingWrite.current = {fingerprint, requestId: crypto.randomUUID()};
      }
      const id = await guardarPacienteVeterinario(
        businessId, patientId ?? newId, payload, patient ? "editar" : "crear",
        pendingWrite.current.requestId, patient ? version : undefined, fotoPerfil
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
      <form ref={formRef} className="erp-form" onSubmit={submitStep} noValidate>
        <PatientFormProgress stepIndex={stepIndex} />
        <h2 ref={stepHeading} tabIndex={-1}>{step.title}</h2>
        {stepIndex === 0 && (
          <>
            {!activeTutors.length && <p>Registra un tutor activo para asociarlo al paciente.</p>}
            <VeterinaryField label="Tutor registrado" required error={fieldErrors.tutorClienteId}>
              <select className="erp-control" name="tutorClienteId" value={selectedTutorAvailable ? form.tutorClienteId : ""} onChange={setField}>
                <option value="">Selecciona un tutor</option>
                {activeTutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.nombreRazonSocial}</option>)}
              </select>
            </VeterinaryField>
            <Button type="button" variant="secondary" onClick={() => setTutorDialogOpen(true)}>Registrar tutor</Button>
            <div className="erp-form-grid">
              <VeterinaryField label="Nombre" required error={fieldErrors.nombre}>
                <input className="erp-control" name="nombre" placeholder="Ej. Firulais" value={form.nombre ?? ""} onChange={setField} />
              </VeterinaryField>
              <PatientSearchField label="Especie" name="especie" required value={form.especie}
                options={PATIENT_SPECIES_OPTIONS} placeholder="Escribe o selecciona una especie"
                onSelect={setPatientValue} error={fieldErrors.especie} />
              <PatientSearchField label="Raza" name="raza" value={form.raza} options={breedOptions}
                placeholder={breedOptions.length ? "Escribe o selecciona una raza" : "Selecciona primero la especie"}
                disabled={!breedOptions.length} onSelect={setPatientValue} error={fieldErrors.raza} />
              <PatientSelectField label="Sexo" name="sexo" value={form.sexo}
                options={PATIENT_SEX_OPTIONS} placeholder="Selecciona el sexo" onChange={setField} error={fieldErrors.sexo} />
            </div>
          </>
        )}
        {stepIndex === 1 && (
          <div className="erp-form-grid">
            {detailFields.map(([name, label, placeholder, type = "text"]) => (
              <VeterinaryField key={name} label={label} error={fieldErrors[name]}>
                <input className="erp-control" name={name} type={type}
                  placeholder={placeholder} value={form[name] ?? ""} onChange={setField} />
              </VeterinaryField>
            ))}
            {form.fechaNacimiento ? (
              <div className="erp-field">
                <span>Edad</span>
                <output>{age || "Edad no disponible para esa fecha."}</output>
              </div>
            ) : (
              <VeterinaryField label="Edad estimada" error={fieldErrors.edadEstimada}>
                <input className="erp-control" name="edadEstimada" placeholder="Ej. 2 años"
                  value={form.edadEstimada ?? ""} onChange={setField} />
              </VeterinaryField>
            )}
            <VeterinaryField label="Peso (kg)" error={fieldErrors.peso}>
              <input className="erp-control" name="peso" inputMode="decimal" placeholder="Ej. 8"
                value={form.peso ?? ""} onChange={setField} />
            </VeterinaryField>
          </div>
        )}
        {stepIndex === 2 && notesFields.map(([name, label, placeholder]) => (
          <VeterinaryField key={name} label={label} error={fieldErrors[name]}>
            <textarea className="erp-control" name={name} placeholder={placeholder}
              value={form[name] ?? ""} onChange={setField} />
          </VeterinaryField>
        ))}
        {finalStep && (
          <div className="erp-form-grid">
            <div className="erp-field">
              <VeterinaryField label="Microchip" error={fieldErrors.microchip}>
                <input className="erp-control" name="microchip" type="text" value={form.microchip ?? ""}
                  placeholder="Escribe o pega el código" autoComplete="off" spellCheck={false} disabled={saving}
                  onChange={setField} onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault();
                  }} />
              </VeterinaryField>
              <MicrochipScanner disabled={saving || preparingPhoto} value={form.microchip}
                onRead={(code) => setPatientValue("microchip", code)} />
            </div>
            {loadingSavedPhoto ? <LoadingState variant="section" label="Cargando foto de perfil..." />
              : savedPhotoResult?.error ? <p role="alert">No se pudo consultar la foto de perfil. Puedes guardar los demás datos del paciente.</p>
                : <VeterinaryPatientPhotoField photo={photo} savedPhoto={savedPhotoResult?.photo ?? null} disabled={saving}
                  onChange={setPhoto} onPreparingChange={setPreparingPhoto} />}
          </div>
        )}
        {error && <p className="erp-empty-state" role="alert">{error}</p>}
        <div className="erp-actions">
          {stepIndex > 0 && (
            <Button type="button" variant="secondary" disabled={saving || preparingPhoto} onClick={() => {
              setError("");
              goToStep(stepIndex - 1);
            }}>Atrás</Button>
          )}
          <Button type="submit" loading={saving} disabled={finalStep && (loadingSavedPhoto || preparingPhoto)}>
            {finalStep ? "Guardar paciente" : "Siguiente"}
          </Button>
        </div>
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

export function AssignedVeterinaryPatient({businessId, professionalUid}) {
  const {pacienteId} = useParams();
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!businessId || !professionalUid) return undefined;
    let active = true;
    consultarPacientesVeterinariosAsignados(businessId, pacienteId)
      .then((data) => { if (active) setResult({pacienteId, data}); })
      .catch(() => {
        if (active) setResult({pacienteId, error: pacienteId
          ? "No pudimos abrir esta ficha clínica desde tu cuenta."
          : "No pudimos consultar tus pacientes asignados."});
      });
    return () => { active = false; };
  }, [businessId, pacienteId, professionalUid]);

  const current = result?.pacienteId === pacienteId ? result : null;
  if (!pacienteId) {
    const patients = current?.data?.patients ?? [];
    return (
      <section className="erp-page">
        <ModuleHeader className="veterinary-module-header" icon={PawPrint} title="Mis pacientes"
          description="Consulta las fichas vinculadas a tus citas y órdenes." />
        {!current ? <LoadingState variant="section" label="Cargando tus pacientes..." />
          : current.error ? <p className="erp-empty-state" role="alert">{current.error}</p>
            : patients.length === 0 ? <p className="erp-empty-state">Aún no tienes pacientes asignados.</p>
              : <section className="erp-panel">
                <VeterinaryPatientDirectory businessId={businessId} assignedOnly patientPath={patientPath}
                  patients={[...patients].sort((left, right) => left.nombre.localeCompare(right.nombre, "es"))} />
              </section>}
      </section>
    );
  }
  return (
    <div className="erp-page">
      <nav aria-label="Clínica Veterinaria">
        <Link to={patientListPath}>Mis pacientes</Link>
        {" · "}
        <Link to="/clinica-veterinaria/ordenes">Mis órdenes</Link>
        {" · "}<Link to="/clinica-veterinaria/agenda">Mis citas</Link>
      </nav>
      {current ? (
        <PatientDetail businessId={businessId} patient={current.data?.patient} error={current.error}
          showTutor={false} showClinicalActivity={false} showHistory history={current.data?.attentions}
          renderHistoryPhotos={(attention) => attention.fotosClinicas?.length > 0
            ? <HistoryPhotos businessId={businessId} attention={attention} />
            : null} />
      ) : <LoadingState variant="section" label="Cargando ficha clínica..." />}
    </div>
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
    ) || matchesRutSearch(search, getTutor(item)?.identificadorFiscalValor, getTutor(item)?.rut, getTutor(item)?.identificadorFiscalNormalizado))
    .sort((a, b) => String(a.nombre ?? "").localeCompare(String(b.nombre ?? ""), "es-CL"));
  const registerPatient = () => navigate(patientListPath + "/nuevo");

  return (
    <div className="erp-page">
      {mode !== "list" && (
        <nav aria-label="Clínica Veterinaria">
          <Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate(patientListPath)}>
            Volver a Pacientes
          </Button>
        </nav>
      )}
      {mode === "list" && (
        <>
          <ModuleHeader
            className="veterinary-module-header"
            actions={<Button type="button" icon={Plus} onClick={registerPatient}>Registrar paciente</Button>}
            description="Registra y consulta las fichas de los pacientes de tu clínica."
            hasData={patients.length > 0}
            icon={PawPrint}
            title="Pacientes"
          />
          {patients.length === 0 ? (
            <EmptyState
              action={{label: "Registrar paciente", icon: Plus, onClick: registerPatient}}
              description="Crea la ficha del primer paciente y asóciala a su tutor."
              icon={PawPrint}
              title="Aún no hay pacientes"
            />
          ) : (
            <section className="erp-panel veterinary-list-panel">
              <label className="erp-field">
                <span className="erp-field__label">Buscar pacientes</span>
                <span className="veterinary-search-control">
                  <AppIcon icon={Search} />
                  <input
                    className="erp-control"
                    type="search"
                    placeholder="Nombre, especie, tutor o microchip"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </span>
              </label>
              {visiblePatients.length ? (
                <VeterinaryPatientDirectory businessId={businessId} patients={visiblePatients}
                  getTutor={getTutor} patientPath={patientPath} />
              ) : <p className="erp-empty-state">No se encontraron coincidencias.</p>}
            </section>
          )}
        </>
      )}
      {mode === "new" && <PatientForm key="nuevo" businessId={businessId} countryCode={countryCode} tutors={tutors} onTutorCreated={addTutor} />}
      {mode === "edit" && patient && <PatientForm key={patient.id} businessId={businessId} countryCode={countryCode} patient={patient} tutors={tutors} onTutorCreated={addTutor} />}
      {mode === "edit" && !patient && <p className="erp-empty-state">Paciente no encontrado.</p>}
      {mode === "detail" && (
        <PatientDetail businessId={businessId} patient={patient} tutor={patient ? getTutor(patient) : null}
          showClinicalActivity={false} showHistory canMutate={Boolean(patient)}
          renderHistoryPhotos={(attention) => attention.fotosClinicas?.length > 0
            ? <HistoryPhotos businessId={businessId} attention={attention} />
            : null}
          renderHistoryActions={(attention) => {
            const route = attention.origen
              ? "ordenes/" + encodeURIComponent(attention.id)
              : "citas/" + encodeURIComponent(attention.citaId || attention.id);
            return <Link to={"/clinica-veterinaria/" + route + "/atencion"}>Ver atención</Link>;
          }}
          history={(attentions ?? []).filter((item) => item.pacienteId === pacienteId && item.estado === "finalizada")
            .sort((a, b) => (b.finalizadaEn?.toMillis?.() ?? 0) - (a.finalizadaEn?.toMillis?.() ?? 0))}
          onEditPatient={patient ? () => navigate(patientPath(patient.id) + "/editar") : undefined} />
      )}
    </div>
  );
}
