import React from "react";
import {
  CalendarDays,
  ClipboardPlus,
  HeartPulse,
  Pencil,
  Stethoscope,
  UserRound,
} from "lucide-react";

import Button from "../../../components/ui/Button";
import StatusBadge from "../../../components/ui/StatusBadge";

import "./patient-detail.css";

const PATIENT_STATUS_LABELS = Object.freeze({
  activo: "Activo",
  inactivo: "Inactivo",
  fallecido: "Fallecido",
});

function formatDate(value) {
  if (!value) return "No registrada";

  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No registrada";
  }

  return date.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function patientStatusVariant(status) {
  if (status === "activo") return "success";
  if (status === "fallecido") return "warning";
  return "neutral";
}

function EmptySection({ children }) {
  return (
    <p className="veterinary-patient-empty">
      {children}
    </p>
  );
}

export default function PatientDetail({
  patient,
  tutor = null,
  appointments = [],
  history = [],
  loading = false,
  error = "",
  canMutate = false,
  onEditPatient,
  onViewTutor,
  onScheduleAppointment,
  onStartAttention,
}) {
  if (loading) {
    return (
      <main className="erp-page veterinary-patient-page">
        <section className="erp-panel">
          <p className="muted">
            Cargando ficha del paciente...
          </p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="erp-page veterinary-patient-page">
        <section
          className="erp-panel veterinary-patient-message veterinary-patient-message--error"
          role="alert"
        >
          {error}
        </section>
      </main>
    );
  }

  if (!patient) {
    return (
      <main className="erp-page veterinary-patient-page">
        <section className="erp-panel">
          <h1>Paciente no encontrado</h1>

          <p className="muted">
            No fue posible encontrar el paciente solicitado.
          </p>
        </section>
      </main>
    );
  }

  const patientStatus =
    PATIENT_STATUS_LABELS[patient.estado] || "Activo";

  return (
    <main className="erp-page veterinary-patient-page">

      <header className="erp-page-header veterinary-patient-header">
        <div className="erp-page-header__content">

          <div className="veterinary-patient-title-row">
            <div>
              <p className="veterinary-patient-eyebrow">
                Ficha integral del paciente
              </p>

              <h1 className="erp-page-header__title">
                {patient.nombre || "Paciente"}
              </h1>

              <p className="erp-page-header__description">
                {[
                  patient.especie,
                  patient.raza,
                  patient.sexo,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Sin información adicional"}
              </p>
            </div>

            <StatusBadge
              variant={patientStatusVariant(patient.estado)}
            >
              {patientStatus}
            </StatusBadge>
          </div>

        </div>

        {canMutate && (
          <Button
            type="button"
            icon={Pencil}
            onClick={onEditPatient}
            disabled={!onEditPatient}
          >
            Editar paciente
          </Button>
        )}
      </header>

      <div className="veterinary-patient-grid">

        {/* Información del paciente */}
        <section className="erp-panel veterinary-patient-card">

          <div className="veterinary-patient-section-title">
            <HeartPulse size={20} />

            <div>
              <h2>Información del paciente</h2>

              <p>
                Datos generales e identificación.
              </p>
            </div>
          </div>

          <dl className="veterinary-patient-data-grid">

            <div>
              <dt>Nombre</dt>
              <dd>{patient.nombre || "—"}</dd>
            </div>

            <div>
              <dt>Especie</dt>
              <dd>{patient.especie || "—"}</dd>
            </div>

            <div>
              <dt>Raza</dt>
              <dd>{patient.raza || "No registrada"}</dd>
            </div>

            <div>
              <dt>Sexo</dt>
              <dd>{patient.sexo || "No registrado"}</dd>
            </div>

            <div>
              <dt>Fecha de nacimiento</dt>
              <dd>{formatDate(patient.fechaNacimiento)}</dd>
            </div>

            <div>
              <dt>Edad estimada</dt>
              <dd>{patient.edadEstimada || "No registrada"}</dd>
            </div>

            <div>
              <dt>Peso</dt>
              <dd>
                {patient.peso
                  ? `${patient.peso} kg`
                  : "No registrado"}
              </dd>
            </div>

            <div>
              <dt>Color</dt>
              <dd>{patient.color || "No registrado"}</dd>
            </div>

            <div>
              <dt>Microchip</dt>
              <dd>{patient.microchip || "No registrado"}</dd>
            </div>

          </dl>
        </section>

        {/* Tutor */}
        <section className="erp-panel veterinary-patient-card">

          <div className="veterinary-patient-section-title">
            <UserRound size={20} />

            <div>
              <h2>Tutor responsable</h2>

              <p>
                Información obtenida desde Clientes Core.
              </p>
            </div>
          </div>

          {tutor ? (
            <>
              <dl className="veterinary-patient-data-grid">

                <div>
                  <dt>Nombre</dt>
                  <dd>
                    {tutor.nombreRazonSocial || "—"}
                  </dd>
                </div>

                <div>
                  <dt>Identificación</dt>
                  <dd>
                    {tutor.identificadorFiscalValor ||
                      tutor.rut ||
                      "No registrada"}
                  </dd>
                </div>

                <div>
                  <dt>Teléfono</dt>
                  <dd>{tutor.telefono || "No registrado"}</dd>
                </div>

                <div>
                  <dt>Correo</dt>
                  <dd>{tutor.email || "No registrado"}</dd>
                </div>

                <div className="veterinary-patient-data-wide">
                  <dt>Dirección</dt>
                  <dd>{tutor.direccion || "No registrada"}</dd>
                </div>

              </dl>

              {onViewTutor && (
                <div className="veterinary-patient-card-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onViewTutor}
                  >
                    Ver tutor
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptySection>
              No fue posible cargar la información del tutor.
            </EmptySection>
          )}

        </section>

        {/* Antecedentes */}
        <section className="erp-panel veterinary-patient-card">

          <div className="veterinary-patient-section-title">
            <Stethoscope size={20} />

            <div>
              <h2>Antecedentes clínicos</h2>

              <p>
                Información clínica relevante del paciente.
              </p>
            </div>
          </div>

          <dl className="veterinary-patient-clinical-list">

            <div>
              <dt>Alergias</dt>
              <dd>
                {patient.alergias ||
                  "No registra alergias."}
              </dd>
            </div>

            <div>
              <dt>Antecedentes</dt>
              <dd>
                {patient.antecedentes ||
                  "Sin antecedentes registrados."}
              </dd>
            </div>

            <div>
              <dt>Observaciones</dt>
              <dd>
                {patient.observaciones ||
                  "Sin observaciones registradas."}
              </dd>
            </div>

          </dl>
        </section>

        {/* Próximas citas */}
        <section className="erp-panel veterinary-patient-card">

          <div className="veterinary-patient-section-title">
            <CalendarDays size={20} />

            <div>
              <h2>Próximas citas</h2>

              <p>
                Agenda asociada al paciente.
              </p>
            </div>
          </div>

          {appointments.length === 0 ? (
            <EmptySection>
              No existen próximas citas registradas para este paciente.
            </EmptySection>
          ) : (
            <div className="veterinary-patient-list">

              {appointments.map((appointment) => (
                <article
                  key={appointment.citaId || appointment.id}
                  className="veterinary-patient-list-item"
                >
                  <div>
                    <strong>
                      {formatDate(appointment.fecha)}
                    </strong>

                    <p>
                      {appointment.hora || ""}
                      {appointment.tipoAtencion
                        ? ` · ${appointment.tipoAtencion}`
                        : ""}
                    </p>
                  </div>

                  <StatusBadge variant="neutral">
                    {appointment.estado || "Agendada"}
                  </StatusBadge>
                </article>
              ))}

            </div>
          )}

        </section>

        {/* Historial */}
        <section className="erp-panel veterinary-patient-card veterinary-patient-card--full">

          <div className="veterinary-patient-section-title">
            <ClipboardPlus size={20} />

            <div>
              <h2>Historial clínico</h2>

              <p>
                Atenciones finalizadas del paciente.
              </p>
            </div>
          </div>

          {history.length === 0 ? (
            <EmptySection>
              Este paciente todavía no registra atenciones veterinarias.
            </EmptySection>
          ) : (
            <div className="veterinary-patient-history">

              {history.map((attention) => (
                <article
                  key={attention.atencionId || attention.id}
                  className="veterinary-patient-history-item"
                >
                  <div className="veterinary-patient-history-date">
                    {formatDate(
                      attention.finalizadaEn ||
                      attention.iniciadaEn
                    )}
                  </div>

                  <div>
                    <h3>
                      {attention.motivoConsulta ||
                        "Atención veterinaria"}
                    </h3>

                    <p>
                      <strong>Diagnóstico:</strong>{" "}
                      {attention.diagnostico ||
                        "Sin diagnóstico registrado"}
                    </p>

                    <p>
                      <strong>Tratamiento:</strong>{" "}
                      {attention.tratamiento ||
                        "Sin tratamiento registrado"}
                    </p>
                  </div>
                </article>
              ))}

            </div>
          )}

        </section>

      </div>

      {canMutate && (
        <section className="erp-panel veterinary-patient-actions">

          <h2>Acciones veterinarias</h2>

          <div className="veterinary-patient-actions__buttons">

            <Button
              type="button"
              icon={CalendarDays}
              onClick={onScheduleAppointment}
              disabled={!onScheduleAppointment}
            >
              Agendar cita
            </Button>

            <Button
              type="button"
              icon={Stethoscope}
              onClick={onStartAttention}
              disabled={!onStartAttention}
            >
              Iniciar atención
            </Button>

          </div>

          {(!onScheduleAppointment || !onStartAttention) && (
            <p className="muted">
              Estas acciones quedarán habilitadas cuando se
              implementen los flujos correspondientes.
            </p>
          )}

        </section>
      )}

    </main>
  );
}