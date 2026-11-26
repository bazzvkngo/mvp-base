import React, {useEffect, useState} from "react";
import {Check, Link2Off, Phone, Search} from "lucide-react";
import {useLocation} from "react-router-dom";
import Button from "../components/ui/Button";
import LoadingState from "../components/ui/LoadingState";
import StatusBadge from "../components/ui/StatusBadge";
import {
  formatTrackingRut,
  normalizeTrackingPlate,
  parseTrackingPath,
  TRACKING_WORK_STATUS,
  trackingLookupError,
  trackingProgressLabel,
} from "../domain/workOrderTrackingModel.mjs";
import {buscarSeguimientoTaller, consultarSeguimientoTaller} from "../services/workshopTrackingService";
import "../features/taller/workshop-tracking.css";

// Seguimiento público del vehículo (prototipo «Panel del Taller»): por enlace único o con patente + RUT en
// /seguimiento, una página pública para toda la plataforma. Sin sesión. No muestra montos, técnico, plaza ni fotos.

function formatUpdate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("es-CL", {dateStyle: "medium", timeStyle: "short"});
}

function TrackingView({onExit, view}) {
  const {etapa, avance} = view;
  return <div className="workshop-tracking__body">
    <header className="workshop-tracking__head">
      <h1>{view.taller.nombre}</h1>
      <p>Seguimiento de tu vehículo</p>
    </header>
    <section className="workshop-tracking__vehicle" aria-label="Vehículo">
      <strong>{view.vehiculo.descripcion}</strong>
      {view.vehiculo.patente && <span>Patente {view.vehiculo.patente}</span>}
    </section>
    <ol className="workshop-tracking__steps" aria-label={`Etapa ${etapa.paso + 1} de ${etapa.pasos.length}: ${etapa.pasos[etapa.paso]}`}>
      {etapa.pasos.map((step, index) => <li key={step}
        data-state={index < etapa.paso ? "done" : index === etapa.paso ? "current" : undefined}
        aria-current={index === etapa.paso ? "step" : undefined}>
        <i aria-hidden="true">{index < etapa.paso ? <Check size={14} /> : index + 1}</i>
        <span>{step}</span>
      </li>)}
    </ol>
    <p className={`workshop-tracking__stage${etapa.espera ? " workshop-tracking__stage--wait" : ""}`}>{etapa.texto}</p>

    {etapa.clave === "revision" && <p className="workshop-tracking__muted">Aún estamos definiendo los trabajos.</p>}
    {view.trabajos.length > 0 && <section className="workshop-tracking__section" aria-labelledby="tracking-works">
      <div className="workshop-tracking__progress-label">
        <h2 id="tracking-works">Avance de los trabajos</h2>
        <span>{trackingProgressLabel(avance)}</span>
      </div>
      <div className="workshop-tracking__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={avance?.porcentaje || 0} aria-label="Avance de los trabajos">
        <i style={{inlineSize: `${avance?.porcentaje || 0}%`}} />
      </div>
      <ul className="workshop-tracking__list">
        {view.trabajos.map((work, index) => {
          const status = TRACKING_WORK_STATUS[work.estado] || TRACKING_WORK_STATUS.pendiente;
          return <li key={`${work.nombre}-${index}`}><span>{work.nombre}</span>
            <StatusBadge variant={status.tone}>{status.label}</StatusBadge></li>;
        })}
      </ul>
    </section>}

    {view.hallazgos.length > 0 && <section className="workshop-tracking__section" aria-labelledby="tracking-findings">
      <h2 id="tracking-findings">Observaciones del taller</h2>
      <ul className="workshop-tracking__list">
        {view.hallazgos.map((finding, index) => <li key={index} className="workshop-tracking__finding">
          <div>
            <span>{finding.descripcion}</span>
            <small>El taller se pondrá en contacto contigo para confirmar si deseas realizarlo.</small>
          </div>
          <StatusBadge variant={finding.urgente ? "danger" : "neutral"}>{finding.urgente ? "Urgente" : "Recomendado"}</StatusBadge>
        </li>)}
      </ul>
    </section>}

    <footer className="workshop-tracking__foot">
      {view.actualizadoEn && <span>Última actualización: {formatUpdate(view.actualizadoEn)}</span>}
      {view.taller.telefono
        ? <span>¿Dudas? Contacta al taller: <a href={`tel:${view.taller.telefono.replace(/[^\d+]/g, "")}`}>
          <Phone size={14} aria-hidden="true" />{view.taller.telefono}</a></span>
        : <span>¿Dudas? Contacta al taller.</span>}
      {onExit && <button type="button" className="workshop-tracking__link" onClick={onExit}>Salir</button>}
    </footer>
  </div>;
}

function InactiveLink({message}) {
  return <div className="workshop-tracking__body workshop-tracking__gone" role="alert">
    <Link2Off size={32} aria-hidden="true" />
    <strong>{message}</strong>
    <p className="workshop-tracking__muted">Si tienes dudas, contacta al taller.</p>
  </div>;
}

function LinkTracking({token}) {
  const [state, setState] = useState({loading: true, view: null, error: ""});
  useEffect(() => {
    let active = true;
    setState({loading: true, view: null, error: ""});
    consultarSeguimientoTaller(token)
      .then((view) => { if (active) setState({loading: false, view, error: view ? "" : "Este enlace ya no está activo."}); })
      .catch((error) => { if (active) setState({loading: false, view: null, error: error.message || "Este enlace ya no está activo."}); });
    return () => { active = false; };
  }, [token]);
  if (state.loading) return <LoadingState variant="section" label="Cargando el estado de tu vehículo..." />;
  if (!state.view) return <InactiveLink message={state.error} />;
  return <TrackingView view={state.view} />;
}

function ManualTracking() {
  const [form, setForm] = useState({patente: "", rut: ""});
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || blocked) return;
    const formError = trackingLookupError(form);
    if (formError) { setError(formError); return; }
    setBusy(true); setError("");
    try {
      setView(await buscarSeguimientoTaller(normalizeTrackingPlate(form.patente), form.rut));
    } catch (failure) {
      setError(failure.message);
      if (failure.blocked) setBlocked(true);
    } finally { setBusy(false); }
  };

  if (view) return <TrackingView view={view} onExit={() => { setView(null); setForm({patente: "", rut: ""}); }} />;
  return <form className="workshop-tracking__body" onSubmit={submit} noValidate>
    <header className="workshop-tracking__head">
      <h1>Consulta el estado de tu vehículo</h1>
      <p>Ingresa la patente y el RUT del titular o de quien dejó el vehículo.</p>
    </header>
    <label className="erp-field"><span className="erp-field__label">Patente</span>
      <input className="erp-control" value={form.patente} placeholder="PRGZ63" autoComplete="off" disabled={busy || blocked}
        onChange={(event) => { setForm((current) => ({...current, patente: normalizeTrackingPlate(event.target.value)})); setError(""); }} /></label>
    <label className="erp-field"><span className="erp-field__label">RUT</span>
      <input className="erp-control" value={form.rut} placeholder="12.345.678-5" autoComplete="off" inputMode="text" disabled={busy || blocked}
        onChange={(event) => { setForm((current) => ({...current, rut: formatTrackingRut(event.target.value)})); setError(""); }} /></label>
    <Button type="submit" icon={Search} loading={busy} disabled={busy || blocked}>Ver estado</Button>
    <p className="workshop-tracking__error" role="alert">{error}</p>
    <p className="workshop-tracking__muted">También puedes entrar con el enlace que te envió el taller.</p>
  </form>;
}

export default function PublicWorkshopTrackingPage() {
  const location = useLocation();
  const route = parseTrackingPath(location.pathname);
  return <main className="workshop-tracking">
    <div className="workshop-tracking__card">
      {route?.mode === "link" && route.token && <LinkTracking token={route.token} />}
      {route?.mode === "manual" && <ManualTracking />}
      {(!route || (route.mode === "link" && !route.token)) && <InactiveLink message="Este enlace ya no está activo." />}
    </div>
    <p className="workshop-tracking__powered">Seguimiento ofrecido por ValoraCloud</p>
  </main>;
}
