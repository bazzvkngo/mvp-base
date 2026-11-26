import React from "react";
import {CalendarDays} from "lucide-react";
import {useNavigate} from "react-router-dom";
import Button from "../../../components/ui/Button";
import LoadingState from "../../../components/ui/LoadingState";
import useBusinessFormat from "../../../hooks/useBusinessFormat";
import {formatDate} from "../../../utils/formatters";
import {veterinaryAppointmentPath} from "../agenda/veterinaryAppointmentPresentation.mjs";
import VeterinaryField from "../VeterinaryField";

export const FOLLOW_UP_ERROR_FIELDS = ["controlFecha", "controlHora", "derivacionTipo", "derivacionProfesionalUid"];

export function followUpPayload({resultadoClinico, control, derivacion}) {
  if (resultadoClinico === "control") {
    return {control: {fecha: control?.fecha ?? "", hora: control?.hora ?? ""}};
  }
  if (resultadoClinico === "derivacion") {
    const tipo = derivacion?.tipo ?? "";
    return {derivacion: {tipo, ...(tipo === "interna" ? {profesionalUid: derivacion?.profesionalUid ?? ""} : {})}};
  }
  return {};
}

export function getFollowUpFieldErrors({resultadoClinico, control, derivacion}, professionals) {
  const errors = {};
  if (resultadoClinico === "control") {
    if (!control?.fecha) errors.controlFecha = "Selecciona la fecha del control.";
    if (!control?.hora) errors.controlHora = "Selecciona la hora del control.";
  }
  if (resultadoClinico === "derivacion") {
    if (!["interna", "externa"].includes(derivacion?.tipo)) {
      errors.derivacionTipo = "Selecciona el destino de la derivación.";
    } else if (derivacion.tipo === "interna" && !professionals?.some(({uid}) => uid === derivacion.profesionalUid)) {
      errors.derivacionProfesionalUid = "Selecciona un profesional veterinario disponible de la clínica.";
    }
  }
  return errors;
}

export function VeterinaryClinicalFollowUpFields({values, professionals, directoryError, onRetry, onChange, fieldErrors}) {
  const {resultadoClinico, control, derivacion} = values;
  if (resultadoClinico === "control") {
    return (
      <section aria-label="Cita de control">
        <h2>Cita de control</h2>
        <p>Al cerrar la atención, la cita de control se agregará a la agenda.</p>
        <div className="erp-form-grid">
          <VeterinaryField label="Fecha del control" required error={fieldErrors.controlFecha}>
            <input className="erp-control" name="controlFecha" type="date" value={control?.fecha ?? ""}
              onChange={({target}) => onChange("control", {...control, fecha: target.value}, "controlFecha", "controlHora")} />
          </VeterinaryField>
          <VeterinaryField label="Hora del control" required error={fieldErrors.controlHora}>
            <input className="erp-control" name="controlHora" type="time" value={control?.hora ?? ""}
              onChange={({target}) => onChange("control", {...control, hora: target.value}, "controlHora")} />
          </VeterinaryField>
        </div>
      </section>
    );
  }
  if (resultadoClinico !== "derivacion") return null;

  const selectedUid = derivacion?.profesionalUid ?? "";
  const selectedAvailable = professionals?.some(({uid}) => uid === selectedUid);
  return (
    <section aria-label="Derivación">
      <h2>Derivación</h2>
      <div className="erp-form-grid">
        <VeterinaryField label="Destino de la derivación" required error={fieldErrors.derivacionTipo}>
          <select className="erp-control" name="derivacionTipo" value={derivacion?.tipo ?? ""}
            onChange={({target}) => onChange("derivacion", {tipo: target.value}, "derivacionTipo", "derivacionProfesionalUid")}>
            <option value="">Selecciona el destino</option>
            <option value="interna">Profesional de la clínica</option>
            <option value="externa">Profesional externo</option>
          </select>
        </VeterinaryField>
        {derivacion?.tipo === "interna" && (
          <>
            {directoryError ? (
              <div>
                <p role="alert">{directoryError}</p>
                <Button type="button" variant="secondary" onClick={onRetry}>Reintentar</Button>
              </div>
            ) : professionals === null ? (
              <LoadingState variant="inline" label="Cargando profesionales veterinarios..." />
            ) : professionals.length === 0 ? (
              <p>No hay profesionales veterinarios activos disponibles.</p>
            ) : (
              <VeterinaryField label="Profesional veterinario" required error={fieldErrors.derivacionProfesionalUid}>
                <select className="erp-control" name="derivacionProfesionalUid" value={selectedAvailable ? selectedUid : ""}
                  onChange={({target}) => onChange("derivacion", {tipo: "interna", profesionalUid: target.value}, "derivacionProfesionalUid")}>
                  <option value="">Selecciona un profesional</option>
                  {professionals.map(({uid, nombre}) => <option key={uid} value={uid}>{nombre}</option>)}
                </select>
              </VeterinaryField>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function VeterinaryClinicalFollowUpSummary({attention, compact = false}) {
  const navigate = useNavigate();
  const {locale} = useBusinessFormat();
  const {control, derivacion} = attention;
  const Heading = compact ? "h4" : "h2";
  if (attention.resultadoClinico === "control" && (control?.fecha || control?.citaId)) {
    return (
      <section aria-label="Cita de control">
        <Heading>Cita de control</Heading>
        {control.fecha && <p>Horario original {formatDate(control.fecha, locale)} · {control.hora}</p>}
        {control.citaId && (
          <Button type="button" variant="secondary" icon={CalendarDays}
            onClick={() => navigate(veterinaryAppointmentPath(control.citaId))}>Ver cita de control</Button>
        )}
      </section>
    );
  }
  if (attention.resultadoClinico === "derivacion" && derivacion?.tipo) {
    return (
      <section aria-label="Derivación">
        <Heading>Derivación</Heading>
        <p>{derivacion.tipo === "externa" ? "Derivación a un profesional externo"
          : derivacion.profesionalNombre || "Profesional de la clínica"}</p>
      </section>
    );
  }
  return null;
}
