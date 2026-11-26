import React, {useEffect, useId, useMemo, useRef, useState} from "react";
import {ChevronLeft, ChevronRight} from "lucide-react";
import {useNavigate} from "react-router-dom";
import Button from "../../../components/ui/Button";
import StatusBadge from "../../../components/ui/StatusBadge";
import useBusinessFormat from "../../../hooks/useBusinessFormat";
import {formatDate} from "../../../utils/formatters";
import {
  getVeterinaryAppointmentsForDay,
  getVeterinaryAppointmentStatusLabel,
  getVeterinaryScheduleDay,
  veterinaryAppointmentPath,
} from "./veterinaryAppointmentPresentation.mjs";

const badgeVariants = {
  confirmada: "success",
  en_espera: "warning",
  en_atencion: "warning",
};

export default function VeterinaryDailyAppointments({appointments, patients}) {
  const {locale} = useBusinessFormat();
  const navigate = useNavigate();
  const headingId = useId();
  const carouselId = useId();
  const trackRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const day = useMemo(() => getVeterinaryScheduleDay(appointments, now), [appointments, now]);
  const dailyAppointments = useMemo(() => getVeterinaryAppointmentsForDay(appointments, day), [appointments, day]);
  const patientNames = useMemo(() => new Map(patients.map(({id, nombre}) => [id, nombre])), [patients]);

  useEffect(() => {
    const updateDay = () => setNow(new Date());
    const timer = window.setInterval(updateDay, 60_000);
    window.addEventListener("focus", updateDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateDay);
    };
  }, []);

  function updateScrollBounds(track) {
    setCanGoBack(track.scrollLeft > 1);
    setCanGoForward(track.scrollWidth - track.clientWidth - track.scrollLeft > 1);
  }

  const appointmentCount = dailyAppointments.length;
  useEffect(() => {
    const track = trackRef.current;
    if (!track) {
      setCanGoBack(false);
      setCanGoForward(false);
      return undefined;
    }
    updateScrollBounds(track);
    const observer = new ResizeObserver(() => updateScrollBounds(track));
    observer.observe(track);
    return () => observer.disconnect();
  }, [appointmentCount]);

  function move(direction) {
    const track = trackRef.current;
    const [firstCard, secondCard] = track.children;
    track.scrollBy({left: direction * (secondCard.offsetLeft - firstCard.offsetLeft)});
  }

  return (
    <section className="erp-panel veterinary-daily-appointments" aria-labelledby={headingId}>
      <header className="erp-panel-header">
        <div>
          <h2 className="erp-panel-title" id={headingId}>Citas de hoy</h2>
          <time className="erp-secondary-text" dateTime={day}>{formatDate(day, locale)}</time>
        </div>
        {(canGoBack || canGoForward) && (
          <div className="veterinary-daily-appointments__controls">
            <Button type="button" variant="secondary" icon={ChevronLeft} aria-label="Cita anterior"
              aria-controls={carouselId} disabled={!canGoBack} onClick={() => move(-1)} />
            <Button type="button" variant="secondary" icon={ChevronRight} aria-label="Cita siguiente"
              aria-controls={carouselId} disabled={!canGoForward} onClick={() => move(1)} />
          </div>
        )}
      </header>
      {appointmentCount === 0 ? (
        <p className="erp-secondary-text">No hay citas programadas para hoy.</p>
      ) : (
        <ul id={carouselId} ref={trackRef} className="veterinary-daily-appointments__track"
          onScroll={(event) => updateScrollBounds(event.currentTarget)}>
          {dailyAppointments.map(({id, pacienteId, hora, motivo, estado}) => {
            const patientName = patientNames.get(pacienteId) || "Paciente";
            return (
              <li className="erp-card veterinary-daily-appointments__card" key={id}>
                <div className="veterinary-daily-appointments__meta">
                  <time dateTime={hora || undefined}>{hora || "Sin hora"}</time>
                  <StatusBadge variant={badgeVariants[estado]}>{getVeterinaryAppointmentStatusLabel(estado)}</StatusBadge>
                </div>
                <div>
                  <h3 className="erp-panel-title">{patientName}</h3>
                  {motivo && <p className="erp-secondary-text">{motivo}</p>}
                </div>
                <Button type="button" variant="secondary" onClick={() => navigate(veterinaryAppointmentPath(id))}
                  aria-label={hora ? `Ver cita de ${patientName} a las ${hora}` : `Ver cita de ${patientName}`}>
                  Ver cita
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
