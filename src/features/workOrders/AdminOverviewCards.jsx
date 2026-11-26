import React, {useEffect, useMemo, useState} from "react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import StatusBadge from "../../components/ui/StatusBadge";
import {workProgress} from "../../domain/workOrderExecutionModel.mjs";
import {
  formatWorkOrderHistoryDate, getWorkOrderHistoryDetail, getWorkOrderHistoryEventLabel,
} from "../../domain/workOrderHistoryModel.mjs";
import {deriveWorkshopPlazaOccupancy} from "../../domain/workshopPlazaModel.mjs";
import {
  getWorkOrderErrorMessage, listarOrdenesTrabajo, listarServiciosOT, obtenerHistorialOT,
} from "../../services/workOrderService";

function Card({children, hint, title, titleId}) {
  return <section className="erp-panel work-order-reception-card" aria-labelledby={titleId}>
    <div className="work-order-reception-card__header">
      <h2 id={titleId} className="erp-panel-title">{title}</h2>
      {hint && <span className="erp-secondary-text">{hint}</span>}
    </div>
    {children}
  </section>;
}

// «Ocupación del taller»: cada plaza con su OT y el avance de sus trabajos (sin cifras de dinero).
function OccupancyCard({businessId, otId, plazas, revision}) {
  const [orders, setOrders] = useState([]);
  const [progressByOrder, setProgressByOrder] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const list = await listarOrdenesTrabajo(businessId);
      const occupied = [...deriveWorkshopPlazaOccupancy(plazas, list).values()].map((entry) => entry.order);
      const progress = {};
      await Promise.all(occupied.map(async (order) => {
        try { progress[order.otId] = workProgress(await listarServiciosOT(businessId, order.otId)); }
        catch { progress[order.otId] = null; }
      }));
      if (active) { setOrders(list); setProgressByOrder(progress); setError(""); }
    })()
      .catch((failure) => { if (active) setError(getWorkOrderErrorMessage(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, plazas, revision]);

  const occupancy = useMemo(() => deriveWorkshopPlazaOccupancy(plazas, orders), [plazas, orders]);
  const activePlazas = plazas.filter((plaza) => plaza.estado === "activa");
  return <Card title="Ocupación del taller" titleId="work-order-occupancy-title">
    {loading && <LoadingState variant="section" label="Cargando ocupación..." />}
    {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    {!loading && !error && (activePlazas.length
      ? <ul className="work-order-occupancy">{activePlazas.map((plaza) => {
        const entry = occupancy.get(plaza.plazaId);
        const progress = entry ? progressByOrder[entry.order.otId] : null;
        const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
        return <li key={plaza.plazaId} className="work-order-occupancy__item" data-current={entry?.order.otId === otId ? "true" : undefined}>
          <strong>{plaza.nombre}</strong>
          {entry
            ? <span>{entry.order.numeroOT || "OT"}{progress ? ` · ${percent}% de avance` : ""}</span>
            : <StatusBadge variant="success">Libre</StatusBadge>}
        </li>;
      })}</ul>
      : <p className="erp-secondary-text">No hay plazas activas configuradas.</p>)}
  </Card>;
}

// «Auditoría»: eventos de la OT con su autor (el servidor ya entrega solo datos permitidos).
function AuditCard({businessId, otId, revision}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);

  // Se consulta solo al desplegar: nadie está obligado a ver la auditoría.
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true); setError("");
    obtenerHistorialOT(businessId, otId)
      .then((list) => { if (active) setEvents(list); })
      .catch((failure) => { if (active) setError(getWorkOrderErrorMessage(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, otId, revision, reload, open]);

  return <Card title="Auditoría" titleId="work-order-audit-title">
    <div className="vehicle-form-actions">
      <Button type="button" variant="secondary" aria-expanded={open} aria-controls="work-order-audit-body"
        onClick={() => setOpen((value) => !value)}>{open ? "Ocultar auditoría" : "Ver auditoría"}</Button>
    </div>
    {open && <div id="work-order-audit-body">
    {loading && <LoadingState variant="section" label="Cargando auditoría..." />}
    {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}
      <Button type="button" variant="secondary" onClick={() => setReload((value) => value + 1)}>Reintentar</Button></div>}
    {!loading && !error && (events.length
      ? <ol className="work-order-history-list">{events.map((event) => {
        const detail = getWorkOrderHistoryDetail(event);
        return <li key={event.eventoId} className="work-order-history-event">
          <time>{formatWorkOrderHistoryDate(event.fecha)}</time>
          <div><h3>{getWorkOrderHistoryEventLabel(event.tipo)}</h3>
            <p>{event.actorNombre || "Usuario no disponible"}</p>
            {detail && <p className="erp-secondary-text">{detail}</p>}</div>
        </li>;
      })}</ol>
      : <div className="erp-empty-state">Aún no hay eventos registrados para esta OT.</div>)}
    </div>}
  </Card>;
}

export default function AdminOverviewCards({businessId, otId, plazas, revision}) {
  return <div className="work-order-admin-cards">
    <OccupancyCard businessId={businessId} otId={otId} plazas={plazas} revision={revision} />
    <AuditCard businessId={businessId} otId={otId} revision={revision} />
  </div>;
}
