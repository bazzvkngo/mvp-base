import React, {useEffect, useMemo, useState} from "react";
import {
  AlertTriangle, CalendarCheck, CalendarDays, CheckCircle2, ClipboardList, Clock, PawPrint, Plus, Stethoscope, UserCheck,
} from "lucide-react";
import {Link, useNavigate} from "react-router-dom";
import Button from "../../components/ui/Button";
import {HomeAttentionPanel, HomeHero, HomeSplit, HomeTile, HomeTiles, HomeTimelinePanel} from "../../components/ui/HomeDashboard";
import LoadingState from "../../components/ui/LoadingState";
import useHomeGreeting, {homeDateLabel} from "../../hooks/useHomeGreeting";
import VeterinaryDailyAppointments from "./agenda/VeterinaryDailyAppointments";
import {
  veterinaryAttentionItems,
  veterinaryHomeTiles,
  veterinaryTodayActivity,
} from "./veterinaryHomeModel.mjs";

// Resumen clínico: la misma estructura que el Panel del taller (tarjeta de saludo, cuatro indicadores, «Requiere
// atención» y «Actividad de hoy»), con los datos que la pantalla ya lee. Lo comparten Administración y el perfil de
// atenciones asignadas (`professional`): ese perfil recibe las listas ya filtradas a lo suyo y no ve «Registrar paciente».
// Estados de datos en este orden: `loading` (carga), `error` (mensaje) y, si no, el resumen. Con carga o error se
// conserva la tarjeta de saludo. `children` son paneles propios de quien lo usa, al final del resumen.

const base = "/clinica-veterinaria";
const EMPTY = [];
const ATTENTION_ICONS = {prioridad: AlertTriangle, asignar: UserCheck, cierre: CheckCircle2, cita: CalendarCheck};

function timeLabel(ms) {
  return new Date(ms).toLocaleTimeString("es-CL", {hour: "2-digit", minute: "2-digit"});
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

// La hora se vuelve a leer cada minuto y al volver a la pestaña: «Citas de hoy» y «Actividad de hoy» siguen al día.
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  return now;
}

function Summary({professional, tiles}) {
  const {citasHoy, enEspera, enAtencion} = tiles;
  if (!citasHoy && !enEspera && !enAtencion) {
    return <p>{professional ? "Hoy no tienes citas ni órdenes pendientes." : "Hoy no hay citas ni órdenes pendientes en la clínica."}</p>;
  }
  return <p>{professional ? "Tienes " : "Hoy hay "}<strong>{plural(citasHoy, "cita", "citas")}</strong>,
    {" "}<strong>{plural(enEspera, "orden en espera", "órdenes en espera")}</strong>
    {" "}y <strong>{plural(enAtencion, "orden en atención", "órdenes en atención")}</strong>.</p>;
}

export default function VeterinaryHomeView({
  appointments, attentions, patients, professional = false, loading = false, loadingLabel, error = "", children,
}) {
  const navigate = useNavigate();
  const now = useNow();
  const greeting = useHomeGreeting(now);
  const data = useMemo(() => ({
    appointments: appointments ?? EMPTY, attentions: attentions ?? EMPTY, patients: patients ?? EMPTY, now,
  }), [appointments, attentions, patients, now]);
  const tiles = useMemo(() => veterinaryHomeTiles(data), [data]);
  const attention = useMemo(() => veterinaryAttentionItems(data), [data]);
  const activity = useMemo(() => veterinaryTodayActivity(data), [data]);

  const body = <>
    <HomeTiles label="Indicadores de la clínica">
      <HomeTile icon={CalendarDays} tone="info" value={tiles.citasHoy} label="Citas de hoy" to={`${base}/agenda`} />
      <HomeTile icon={Clock} tone="warning" value={tiles.enEspera} label="En espera" to={`${base}/ordenes`} />
      <HomeTile icon={Stethoscope} tone="info" value={tiles.enAtencion} label="En atención" to={`${base}/ordenes`} />
      <HomeTile icon={PawPrint} tone="success" value={tiles.pacientes} label={professional ? "Mis pacientes" : "Pacientes"} to={`${base}/pacientes`} />
    </HomeTiles>

    <HomeSplit>
      <HomeAttentionPanel id="veterinary-attention-title" title="Requiere atención" icons={ATTENTION_ICONS} items={attention}
        emptyText={professional ? "Todo al día: no tienes pendientes." : "Todo al día: no hay pendientes en la clínica."} />
      <VeterinaryDailyAppointments appointments={data.appointments} patients={data.patients} />
    </HomeSplit>

    <HomeTimelinePanel id="veterinary-activity-title" title="Actividad de hoy" emptyText="Aún no hay movimientos hoy."
      items={activity.map((entry) => ({
        key: entry.id,
        time: timeLabel(entry.at),
        content: <><Link to={entry.to}>{entry.name}</Link>{" · "}{entry.status}{entry.priority ? ` · ${entry.priority}` : ""}</>,
      }))} />
    {children}
  </>;

  return <main className="erp-page ui-home">
    <HomeHero
      kicker={homeDateLabel(now)}
      title={greeting}
      summary={!loading && !error && <Summary professional={professional} tiles={tiles} />}
      actions={professional
        ? <>
          <Button type="button" icon={CalendarDays} onClick={() => navigate(`${base}/agenda`)}>Mis citas</Button>
          <Button type="button" variant="secondary" icon={ClipboardList} onClick={() => navigate(`${base}/ordenes`)}>Mis órdenes</Button>
        </>
        : <>
          <Button type="button" icon={Plus} onClick={() => navigate(`${base}/pacientes/nuevo`)}>Registrar paciente</Button>
          <Button type="button" variant="secondary" icon={CalendarDays} onClick={() => navigate(`${base}/agenda`)}>Ver agenda</Button>
          <Button type="button" variant="secondary" icon={ClipboardList} onClick={() => navigate(`${base}/ordenes`)}>Ver órdenes de atención</Button>
        </>} />
    {loading
      ? <LoadingState variant="section" label={loadingLabel} />
      : error ? <div className="erp-empty-state" role="alert">{error}</div> : body}
  </main>;
}
