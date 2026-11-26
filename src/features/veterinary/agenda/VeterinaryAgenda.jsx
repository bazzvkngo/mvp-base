import React, {useEffect, useState} from "react";
import {ArrowLeft, CalendarDays, ClipboardList, Clock3, Plus} from "lucide-react";
import {Link, useNavigate, useParams} from "react-router-dom";
import AppIcon from "../../../components/ui/AppIcon";
import Button from "../../../components/ui/Button";
import EmptyState from "../../../components/ui/EmptyState";
import LoadingState from "../../../components/ui/LoadingState";
import ModuleHeader from "../../../components/ui/ModuleHeader";
import StatusBadge from "../../../components/ui/StatusBadge";
import VeterinaryReceptionForm, {triageLabels} from "./VeterinaryReceptionForm";
import VeterinaryField from "../VeterinaryField";
import {
  getVeterinaryAppointmentStatusLabel,
  veterinaryAppointmentPath as appointmentPath,
} from "./veterinaryAppointmentPresentation.mjs";
import useBusinessFormat from "../../../hooks/useBusinessFormat";
import useVeterinaryPatientDirectory from "../useVeterinaryPatientDirectory";
import {loadAssignableProfessionals, professionalOptionLabel} from "../veterinaryProfessionalOptions";
import {formatDate} from "../../../utils/formatters";
import {getVeterinaryAppointmentFieldErrors} from "../domain/appointmentModel.mjs";
import {
  guardarCitaVeterinaria,
  operarOrdenVeterinaria,
  subscribeToVeterinaryAppointments,
} from "../data/veterinaryDataService";
import "../veterinary-lists.css";
import "./veterinary-agenda-list.css";

const base = "/clinica-veterinaria";
const appointmentFilters = [
  ["todas", "Todas"],
  ["en_atencion", "En atención"],
  ["cancelada", "Canceladas"],
  ["finalizada", "Finalizadas"],
  ["agendada", "Agendadas"],
];

function AgendaAppointmentRow({appointment, patientName, locale, showProfessional, onOpen}) {
  const {fecha, hora, estado, motivo, tipoAtencion, profesionalNombre, triage} = appointment;
  const date = fecha ? formatDate(fecha, locale) : "Sin fecha";
  const priority = estado === "en_espera" && triageLabels[triage?.prioridad];
  const context = [showProfessional && profesionalNombre, priority && ("Prioridad: " + priority)].filter(Boolean);
  return (
    <li className="veterinary-agenda-list__row">
      <div className="veterinary-agenda-list__schedule">
        <time className="veterinary-agenda-list__date" dateTime={fecha || undefined}>
          <AppIcon icon={CalendarDays} size={16} />
          <span className="sr-only">Fecha </span>{date}
        </time>
        <time className="veterinary-agenda-list__hour" dateTime={hora || undefined}>
          <AppIcon icon={Clock3} size={16} />
          <span className="sr-only">Hora </span>{hora || "Sin hora"}
        </time>
      </div>
      <div className="veterinary-agenda-list__patient">
        <strong>{patientName}</strong>
        <StatusBadge>{getVeterinaryAppointmentStatusLabel(estado)}</StatusBadge>
        {context.length > 0 && <small className="erp-secondary-text">{context.join(" · ")}</small>}
      </div>
      <div className="veterinary-agenda-list__visit">
        <div className="veterinary-agenda-list__reason">
          <p>{tipoAtencion ? "Tipo de atención" : "Motivo de consulta"}</p>
          <strong>{tipoAtencion || motivo || "Sin motivo registrado"}</strong>
          {tipoAtencion && motivo && tipoAtencion !== motivo && <small className="erp-secondary-text">{motivo}</small>}
        </div>
        <Button type="button" variant="secondary" onClick={onOpen}
          aria-label={["Ver cita de " + patientName, fecha && date, hora].filter(Boolean).join(" · ")}>
          Ver cita
        </Button>
      </div>
    </li>
  );
}

function AppointmentForm({appointment, businessId, patients, professionals, professionalUid}) {
  const {locale} = useBusinessFormat();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => appointment ?? {});
  const [professionalSelection, setProfessionalSelection] = useState(undefined);
  const selectedProfessional = professionalSelection ?? appointment?.profesionalUid ?? "";
  const [newId] = useState(() => crypto.randomUUID());
  const [newOrderId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const activePatients = patients.filter((patient) => ["activo", undefined].includes(patient.estado));
  const editable = !professionalUid && (!appointment || ["agendada", "confirmada"].includes(appointment.estado));

  const orderPath = appointment?.atencionId && base + "/ordenes/" + encodeURIComponent(appointment.atencionId);
  const hasAttention = appointment && ["en_atencion", "finalizada"].includes(appointment.estado);
  const attentionPath = hasAttention && (orderPath ? orderPath + "/atencion"
    : !professionalUid && appointmentPath(appointment.id) + "/atencion");
  const canReceive = !professionalUid && appointment && !orderPath && ["agendada", "confirmada", "en_espera"].includes(appointment.estado);
  const canCancel = !professionalUid && appointment && !orderPath && (editable || appointment.estado === "en_espera");
  const canCreateOrder = !professionalUid && !orderPath && appointment?.estado === "en_espera" &&
    appointment.recepcion?.horaLlegada && appointment.triage?.prioridad;

  async function createOrder() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const attentionId = await operarOrdenVeterinaria(businessId, newOrderId, "crearOrden", {origen: "cita"}, appointment.id);
      navigate(base + "/ordenes/" + encodeURIComponent(attentionId));
    } catch (failure) {
      const code = String(failure?.code || "").replace(/^functions\//, "");
      setError(["invalid-argument", "already-exists", "failed-precondition", "not-found", "aborted"].includes(code)
        ? failure.message : "No se pudo crear la orden de atención.");
    } finally {
      setSaving(false);
    }
  }

  const change = ({target: {name, value}}) => {
    setForm((current) => ({...current, [name]: value}));
    setFieldErrors((current) => ({...current, [name]: undefined}));
  };

  async function save(operation) {
    if (saving) return;
    if (operation !== "cancelar") {
      // El tutor lo deriva la Function desde el paciente; aquí solo se validan los campos del formulario.
      const nextErrors = getVeterinaryAppointmentFieldErrors({...form, tutorClienteId: "derivado-por-backend"});
      delete nextErrors.tutorClienteId;
      setFieldErrors(nextErrors);
      if (Object.keys(nextErrors).length) return;
    }
    setSaving(true);
    setError("");
    try {
      await guardarCitaVeterinaria(businessId, appointment?.id ?? newId, operation, {
        pacienteId: form.pacienteId,
        fecha: form.fecha,
        hora: form.hora,
        motivo: form.motivo,
        observaciones: form.observaciones ?? "",
        ...(professionalSelection !== undefined && professionalSelection !== (appointment?.profesionalUid ?? "")
          ? {profesionalUid: professionalSelection} : {}),
      });
      navigate(base + "/agenda", {replace: true});
    } catch (failure) {
      const code = String(failure?.code || "").replace(/^functions\//, "");
      setError(["invalid-argument", "already-exists", "failed-precondition", "not-found", "aborted"].includes(code)
        ? failure.message
        : "No se pudo guardar la cita. Revisa tus permisos o inténtalo nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="erp-panel">
        <h1>{appointment ? "Cita veterinaria" : "Nueva cita veterinaria"}</h1>
        {appointment && <p>Fecha y hora: {formatDate(appointment.fecha, locale)} · {appointment.hora || "—"}</p>}
        {appointment && <p>Estado: {getVeterinaryAppointmentStatusLabel(appointment.estado)}</p>}
        {appointment?.triage?.prioridad && <p>Prioridad: {triageLabels[appointment.triage.prioridad]}</p>}
        {!appointment && !activePatients.length && <p>Registra un paciente activo antes de crear una cita.</p>}
        <form className="erp-form" noValidate onSubmit={(event) => {
          event.preventDefault();
          if (editable) save(appointment ? "reprogramar" : "crear");
        }}>
          {appointment ? (
            <div className="erp-field">
              <span className="erp-field__label">Paciente</span>
              {professionalUid && appointment.estado === "cancelada" ? <span>Cita cancelada</span> : (
                <Link to={base + "/pacientes/" + encodeURIComponent(appointment.pacienteId)}>
                  {patients.find((patient) => patient.id === appointment.pacienteId)?.nombre || "Ver paciente"}
                </Link>
              )}
            </div>
          ) : (
            <VeterinaryField label="Paciente" required error={fieldErrors.pacienteId}>
              <select name="pacienteId" className="erp-control" value={form.pacienteId ?? ""} onChange={change}>
                <option value="">Selecciona un paciente</option>
                {activePatients.map((patient) => <option key={patient.id} value={patient.id}>{patient.nombre}</option>)}
              </select>
            </VeterinaryField>
          )}
          <div className="erp-form-grid">
            {editable && (
              <>
                <VeterinaryField label="Fecha" required error={fieldErrors.fecha}><input className="erp-control" name="fecha" type="date" value={form.fecha ?? ""} onChange={change} /></VeterinaryField>
                <VeterinaryField label="Hora" required error={fieldErrors.hora}><input className="erp-control" name="hora" type="time" value={form.hora ?? ""} onChange={change} /></VeterinaryField>
                <VeterinaryField label="Profesional a cargo">
                  <select name="profesionalUid" className="erp-control" value={selectedProfessional}
                    onChange={({target}) => setProfessionalSelection(target.value)}>
                    <option value="">Sin asignar</option>
                    {selectedProfessional && !professionals.some(({uid}) => uid === selectedProfessional) && (
                      <option value={selectedProfessional}>{appointment?.profesionalNombre || "Profesional no disponible"}</option>
                    )}
                    {professionals.map((member) => (
                      <option key={member.uid} value={member.uid}>{professionalOptionLabel(member)}</option>
                    ))}
                  </select>
                </VeterinaryField>
              </>
            )}
            <VeterinaryField label="Motivo" required={editable} error={fieldErrors.motivo}>
              <input className="erp-control" name="motivo" maxLength={500} readOnly={!editable}
                placeholder={editable ? "Ej. Control de vacunación" : undefined}
                value={form.motivo ?? ""} onChange={change} />
            </VeterinaryField>
            <VeterinaryField label="Observaciones" error={fieldErrors.observaciones}>
              <textarea className="erp-control" name="observaciones" maxLength={2000} readOnly={!editable}
                placeholder={editable ? "Anota indicaciones para la cita" : undefined}
                value={form.observaciones ?? ""} onChange={change} />
            </VeterinaryField>
          </div>
          {!editable && appointment?.profesionalNombre && <p>Profesional a cargo: {appointment.profesionalNombre}</p>}
          {error && <p role="alert">{error}</p>}
          {canCreateOrder && !confirmCancel && (
            <Button type="button" icon={ClipboardList} loading={saving} onClick={createOrder}>Crear orden de atención</Button>
          )}
          {orderPath && appointment.estado === "en_espera" && (
            <Button type="button" icon={ClipboardList} onClick={() => navigate(orderPath)}>Ver orden de atención</Button>
          )}
          {attentionPath && (
            <Button type="button" variant="secondary" onClick={() => navigate(attentionPath)}>
              {appointment.estado === "finalizada" ? "Ver atención" : "Continuar atención"}
            </Button>
          )}
          {editable && !confirmCancel && (
            <>
              <Button type="submit" loading={saving} disabled={!appointment && !activePatients.length}>
                {appointment ? "Guardar reprogramación" : "Guardar cita"}
              </Button>
            </>
          )}
          {canCancel && !confirmCancel && <Button type="button" variant="secondary" disabled={saving} onClick={() => setConfirmCancel(true)}>Cancelar cita</Button>}
          {confirmCancel && canCancel && (
            <div>
              <p>¿Confirmas que quieres cancelar esta cita?</p>
              <Button type="button" loading={saving} onClick={() => save("cancelar")}>Confirmar cancelación</Button>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setConfirmCancel(false)}>Volver</Button>
            </div>
          )}
        </form>
      </section>
      {canReceive && !confirmCancel && <VeterinaryReceptionForm appointment={appointment} businessId={businessId} />}
    </>
  );
}

export default function VeterinaryAgenda({businessId, mode, professionalUid}) {
  const {locale} = useBusinessFormat();
  const {citaId} = useParams();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState(null);
  const [statusFilter, setStatusFilter] = useState("todas");
  const [professionals, setProfessionals] = useState(null);
  const [error, setError] = useState("");
  const {patients, error: patientError} = useVeterinaryPatientDirectory(businessId, professionalUid, appointments);
  const appointment = appointments?.find((item) => item.id === citaId);
  const loadProfessionals = !professionalUid && (mode === "new" ||
    (appointment && ["agendada", "confirmada"].includes(appointment.estado)));

  useEffect(() => {
    if (!businessId) return undefined;
    const fail = () => setError("No se pudo consultar la agenda de esta empresa.");
    return subscribeToVeterinaryAppointments(businessId, setAppointments, fail, professionalUid);
  }, [businessId, professionalUid]);

  useEffect(() => {
    if (!businessId || !loadProfessionals) return undefined;
    let active = true;
    loadAssignableProfessionals(businessId)
      .then((members) => { if (active) setProfessionals(members); })
      .catch(() => { if (active) setError("No se pudieron consultar los profesionales de la clínica."); });
    return () => { active = false; };
  }, [businessId, loadProfessionals]);

  if (!businessId) return <p role="alert">Selecciona una empresa activa.</p>;
  if (error || patientError) return <p role="alert">{error || patientError}</p>;
  if (!appointments || !patients || (loadProfessionals && !professionals)) {
    return <LoadingState variant="section" label="Cargando agenda veterinaria..." />;
  }

  const names = new Map(patients.map((patient) => [patient.id, patient.nombre]));
  const visibleAppointments = appointments
    .filter(({estado}) => statusFilter === "todas" || estado === statusFilter)
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  const scheduleAppointment = () => navigate(base + "/agenda/nueva");

  return (
    <div className="erp-page">
      {mode !== "list" && (
        <nav aria-label="Clínica Veterinaria">
          <Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate(base + "/agenda")}>
            Volver a la agenda
          </Button>
        </nav>
      )}
      {mode === "list" && (
        <>
          <ModuleHeader
            className="veterinary-module-header"
            actions={!professionalUid && <Button type="button" icon={Plus} onClick={scheduleAppointment}>Agendar cita</Button>}
            description={professionalUid ? "Consulta las citas asignadas a tu cuenta." : "Agenda consultas y revisa las citas de tu clínica."}
            hasData={appointments.length > 0}
            icon={CalendarDays}
            title={professionalUid ? "Mis citas" : "Agenda"}
          />
          {appointments.length === 0 ? (
            <EmptyState
              action={professionalUid ? undefined : {label: "Agendar cita", icon: Plus, onClick: scheduleAppointment}}
              description={professionalUid ? "Las citas asignadas a tu cuenta aparecerán aquí." : "Agenda la primera cita para un paciente registrado."}
              icon={CalendarDays}
              title="Aún no hay citas"
            />
          ) : (
            <section className="erp-panel veterinary-agenda-list-panel">
              <div className="veterinary-agenda-list__filters" role="group" aria-label="Filtrar citas por estado">
                {appointmentFilters.map(([status, label]) => (
                  <Button key={status} type="button" variant={statusFilter === status ? "primary" : "secondary"}
                    aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>
                    {label}
                  </Button>
                ))}
              </div>
              {visibleAppointments.length > 0 ? (
                <ul className="veterinary-agenda-list" role="list" aria-label="Citas veterinarias">
                  {visibleAppointments.map((item) => (
                    <AgendaAppointmentRow key={item.id} appointment={item} patientName={names.get(item.pacienteId) || "Paciente"}
                      locale={locale} showProfessional={!professionalUid} onOpen={() => navigate(appointmentPath(item.id))} />
                  ))}
                </ul>
              ) : <p className="erp-secondary-text" role="status">No hay citas con este estado.</p>}
            </section>
          )}
        </>
      )}
      {mode === "new" && <AppointmentForm key="nueva" businessId={businessId} patients={patients} professionals={professionals} />}
      {mode === "detail" && (appointment
        ? <AppointmentForm key={appointment.id} businessId={businessId} appointment={appointment} patients={patients}
          professionals={professionals} professionalUid={professionalUid} />
        : <p className="erp-empty-state">Cita no encontrada.</p>)}
    </div>
  );
}
