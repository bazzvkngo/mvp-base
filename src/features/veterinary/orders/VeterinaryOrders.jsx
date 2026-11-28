import React, {useEffect, useRef, useState} from "react";
import {ArrowLeft, ClipboardList, Plus, ShoppingBasket, Siren} from "lucide-react";
import {Link, useNavigate, useParams} from "react-router-dom";
import Button from "../../../components/ui/Button";
import EmptyState from "../../../components/ui/EmptyState";
import LoadingState from "../../../components/ui/LoadingState";
import ModuleHeader from "../../../components/ui/ModuleHeader";
import StatusBadge from "../../../components/ui/StatusBadge";
import {auth} from "../../../firebase/firebaseConfig";
import useBusinessFormat from "../../../hooks/useBusinessFormat";
import {formatDate} from "../../../utils/formatters";
import {triageLabels} from "../agenda/VeterinaryReceptionForm";
import {
  operarOrdenVeterinaria,
  subscribeToVeterinaryAttentions,
  subscribeToVeterinaryBoxes,
} from "../data/veterinaryDataService";
import {buildVeterinaryBoxBoard, veterinaryBoxKey} from "../domain/boxModel.mjs";
import {VETERINARY_TRIAGE_PRIORITIES} from "../domain/receptionTriageModel.mjs";
import useVeterinaryPatientDirectory from "../useVeterinaryPatientDirectory";
import {loadAssignableProfessionals, professionalOptionLabel} from "../veterinaryProfessionalOptions";
import VeterinaryField from "../VeterinaryField";
import VeterinaryBoxes, {veterinaryBoxStatuses} from "./VeterinaryBoxes";
import "../veterinary-lists.css";
import "./veterinary-orders.css";

const base = "/clinica-veterinaria";
const ordersPath = base + "/ordenes";
const orderPath = (id) => ordersPath + "/" + encodeURIComponent(id);
const orderDetailPath = (order) => orderPath(order.id) + (order.estado === "en_espera" ? "" : "/atencion");
const originLabels = {cita: "Con cita", directa: "Sin cita", emergencia: "Emergencia"};
const priorityRank = {urgente: 0, prioritaria: 1, normal: 2};
const priorityVariants = {urgente: "danger", prioritaria: "warning", normal: "neutral"};

function receivedTimestamp(order) {
  return order.recepcion?.recibidaEn ?? order.recibidoEn ?? order.creadoEn;
}

function sortQueue(left, right) {
  const priority = (priorityRank[left.triage?.prioridad] ?? 3) -
    (priorityRank[right.triage?.prioridad] ?? 3);
  if (priority) return priority;
  const leftDate = receivedTimestamp(left)?.toDate?.();
  const rightDate = receivedTimestamp(right)?.toDate?.();
  if (leftDate && rightDate && leftDate.toDateString() === rightDate.toDateString()) {
    const arrival = (left.recepcion?.horaLlegada || "").localeCompare(right.recepcion?.horaLlegada || "");
    if (arrival) return arrival;
  }
  return (leftDate?.getTime() ?? Number.MAX_SAFE_INTEGER) -
    (rightDate?.getTime() ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id);
}

function orderError(failure, fallback) {
  const code = String(failure?.code || "").replace(/^functions\//, "");
  return [
    "invalid-argument", "already-exists", "failed-precondition", "not-found", "permission-denied", "aborted",
  ].includes(code) ? failure.message : fallback;
}

function OrderList({businessId, orders, names, professionalUid, boxes, boxError}) {
  const navigate = useNavigate();
  const {locale} = useBusinessFormat();
  const waiting = orders.filter((order) => order.estado === "en_espera").sort(sortQueue);
  const active = orders.filter((order) => order.estado === "en_atencion");
  const closed = professionalUid ? orders.filter((order) => order.estado === "finalizada")
    .sort((left, right) => (right.finalizadaEn?.toMillis?.() ?? 0) - (left.finalizadaEn?.toMillis?.() ?? 0)) : [];

  function renderOrder(order) {
    const priority = order.triage?.prioridad;
    const arrivalTime = order.recepcion?.horaLlegada;
    const reception = receivedTimestamp(order);
    return (
      <li key={order.id}>
        <p>
          <Link to={orderDetailPath(order)}>
            {names.get(order.pacienteId) || "Paciente"}
          </Link>
          {triageLabels[priority] && <>{" "}<StatusBadge variant={priorityVariants[priority]}>{triageLabels[priority]}</StatusBadge></>}
        </p>
        <span className="erp-secondary-text">
          {originLabels[order.origen] || "Con cita"}
          {reception && " · " + formatDate(reception, locale)}
          {arrivalTime && " · " + arrivalTime}
          {" · "}{order.box ? `Box: ${order.box}` : "Sin box"}
          {order.tipoAtencion && " · " + order.tipoAtencion}
          {" · "}{order.profesionalNombre || (order.profesionalUid ? "Profesional asignado" : "Sin profesional asignado")}
        </span>
        {order.motivoConsulta && <span>{order.motivoConsulta}</span>}
      </li>
    );
  }

  return (
    <>
      <ModuleHeader
        className="veterinary-module-header"
        icon={ClipboardList}
        title={professionalUid ? "Mis órdenes" : "Órdenes de atención"}
        description={professionalUid ? "Consulta las órdenes asignadas a tu cuenta." : "Atiende según la prioridad registrada y la hora de llegada."}
        actions={!professionalUid && (
          <>
            <Button type="button" icon={Plus} onClick={() => navigate(ordersPath + "/recepcion")}>Recibir sin cita</Button>
            <Button type="button" icon={Siren} variant="secondary" onClick={() => navigate(ordersPath + "/emergencia")}>Nueva emergencia</Button>
            <Button type="button" icon={ShoppingBasket} variant="secondary" onClick={() => navigate("/ventas/nueva")}>Venta directa</Button>
          </>
        )}
      />
      {!professionalUid && <VeterinaryBoxes businessId={businessId} boxes={boxes} error={boxError}
        names={names} onOpenOrder={(order) => navigate(orderDetailPath(order))} />}
      {waiting.length === 0 && active.length === 0 && closed.length === 0 ? (
        <EmptyState icon={ClipboardList} title={professionalUid ? "No hay órdenes asignadas" : "No hay órdenes activas"}
          description={professionalUid ? "Las órdenes asignadas a tu cuenta aparecerán aquí." : "Recibe a un paciente desde su cita o registra su llegada sin cita."} />
      ) : (
        <>
          {waiting.length > 0 && (
            <section className="erp-panel">
              <h2 className="erp-panel-title">En espera</h2>
              <ul className="veterinary-record-list">{waiting.map(renderOrder)}</ul>
            </section>
          )}
          {active.length > 0 && (
            <section className="erp-panel">
              <h2 className="erp-panel-title">En atención</h2>
              <ul className="veterinary-record-list">{active.map(renderOrder)}</ul>
            </section>
          )}
          {closed.length > 0 && (
            <section className="erp-panel">
              <h2 className="erp-panel-title">Finalizadas</h2>
              <ul className="veterinary-record-list">{closed.map(renderOrder)}</ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function ReceiveOrder({businessId, patients, emergency}) {
  const navigate = useNavigate();
  const activePatients = patients.filter((patient) => ["activo", undefined].includes(patient.estado));
  const id = useRef(null);
  const [form, setForm] = useState(() => ({
    pacienteId: "",
    horaLlegada: "",
    prioridad: emergency ? "urgente" : "",
    motivoConsulta: "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const change = ({target: {name, value}}) => {
    setForm((previous) => ({...previous, [name]: value}));
    setError("");
  };

  async function createOrder(event) {
    event.preventDefault();
    if (saving) return;
    if (!form.motivoConsulta.trim()) {
      setError("Indica el motivo de la atención.");
      return;
    }
    const arrivalTime = new FormData(event.currentTarget).get("horaLlegada");
    if (!id.current) id.current = crypto.randomUUID();
    setSaving(true);
    setError("");
    try {
      const attentionId = await operarOrdenVeterinaria(businessId, id.current, "crearOrden", {
        ...form,
        horaLlegada: arrivalTime,
        origen: emergency ? "emergencia" : "directa",
        motivoConsulta: form.motivoConsulta.trim(),
      });
      navigate(orderPath(attentionId));
    } catch (failure) {
      setError(orderError(failure, "No se pudo crear la orden de atención."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="erp-panel">
      <h1>{emergency ? "Nueva emergencia" : "Recepción sin cita"}</h1>
      {activePatients.length === 0 ? (
        <EmptyState title="No hay pacientes activos" description="Registra al paciente antes de recibirlo."
          action={{label: "Registrar paciente", onClick: () => navigate(base + "/pacientes/nuevo")}} />
      ) : (
        <form className="erp-form" onSubmit={createOrder}>
          <div className="erp-form-grid">
            <VeterinaryField label="Paciente" required>
              <select className="erp-control" name="pacienteId" value={form.pacienteId} onChange={change} required>
                <option value="">Selecciona al paciente recibido</option>
                {activePatients.map((patient) => <option key={patient.id} value={patient.id}>{patient.nombre}</option>)}
              </select>
            </VeterinaryField>
            <VeterinaryField label="Hora de llegada" required>
              <input className="erp-control" type="time" name="horaLlegada" value={form.horaLlegada} onChange={change} required />
            </VeterinaryField>
            <VeterinaryField label="Prioridad" required>
              <select className="erp-control" name="prioridad" value={form.prioridad} onChange={change} required disabled={emergency}>
                <option value="">Selecciona la prioridad registrada</option>
                {VETERINARY_TRIAGE_PRIORITIES.map((value) => <option key={value} value={value}>{triageLabels[value]}</option>)}
              </select>
            </VeterinaryField>
            <VeterinaryField label="Motivo de atención" required>
              <input className="erp-control" name="motivoConsulta" placeholder="Anota lo que informa el tutor" maxLength={1000}
                value={form.motivoConsulta} onChange={change} required />
            </VeterinaryField>
          </div>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" loading={saving}>Recibir y crear orden</Button>
        </form>
      )}
    </section>
  );
}

function AssignOrder({businessId, order, name, professionals = [], professionalUid, boxes, boxError}) {
  const navigate = useNavigate();
  const [form, setForm] = useState(() => ({
    box: order.box ?? "",
    tipoAtencion: order.tipoAtencion ?? "",
    profesionalUid: order.profesionalUid ?? "",
  }));
  const [operation, setOperation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const selectedProfessional = professionals.find((member) => member.uid === form.profesionalUid);
  const selectedBoxKey = veterinaryBoxKey(form.box);
  const selectedBox = boxes?.find(({nombre}) => veterinaryBoxKey(nombre) === selectedBoxKey);
  const boxAvailable = (box) => !box.order || box.order.id === order.id;
  const selectedBoxAvailable = selectedBox && boxAvailable(selectedBox);
  const assignedToCurrentUser = order.profesionalUid && order.profesionalUid === auth.currentUser?.uid;
  const canStart = assignedToCurrentUser && order.box && order.tipoAtencion && (professionalUid ||
    (selectedBoxKey === veterinaryBoxKey(order.box) && form.tipoAtencion.trim() === order.tipoAtencion &&
      form.profesionalUid === order.profesionalUid));
  const boxPlaceholder = boxError ? "Boxes no disponibles" : boxes ? "Selecciona el box" : "Cargando boxes...";
  const change = ({target: {name, value}}) => {
    setForm((previous) => ({...previous, [name]: value}));
    setError("");
    setNotice("");
  };
  async function save(event) {
    event.preventDefault();
    if (operation || confirmCancel) return;
    if (boxError || !selectedBoxAvailable || !form.tipoAtencion.trim() || !selectedProfessional) {
      setError("Selecciona un box disponible y completa el tipo de atención y el profesional responsable.");
      return;
    }
    setOperation("assign");
    setError("");
    setNotice("");
    try {
      await operarOrdenVeterinaria(businessId, order.id, "asignarOrden", {
        ...form, box: selectedBox.nombre, tipoAtencion: form.tipoAtencion.trim(),
      });
      setNotice("Asignación guardada.");
    } catch (failure) {
      setError(orderError(failure, "No se pudo guardar la asignación."));
    } finally {
      setOperation("");
    }
  }
  async function start() {
    if (!canStart || operation) return;
    setOperation("start");
    setError("");
    setNotice("");
    try {
      await operarOrdenVeterinaria(businessId, order.id, "iniciar");
      navigate(orderPath(order.id) + "/atencion");
    } catch (failure) {
      setError(orderError(failure, "No se pudo iniciar la atención."));
    } finally {
      setOperation("");
    }
  }
  async function cancel() {
    if (operation) return;
    setOperation("cancel");
    setError("");
    setNotice("");
    try {
      await operarOrdenVeterinaria(businessId, order.id, "cancelarOrden");
      navigate(ordersPath);
    } catch (failure) {
      setError(orderError(failure, "No se pudo cancelar la orden."));
    } finally {
      setOperation("");
    }
  }
  if (order.estado !== "en_espera") {
    return (
      <section className="erp-panel">
        <h1>Orden de atención</h1>
        <p>{name}</p>
        {order.estado === "cancelada" ? <p>Orden cancelada.</p>
          : <Button type="button" onClick={() => navigate(orderPath(order.id) + "/atencion")}>Ver atención</Button>}
      </section>
    );
  }

  const summary = (
    <>
      <p><strong>{name}</strong>{" · "}{originLabels[order.origen] || "Con cita"}</p>
      {order.motivoConsulta && <p>{order.motivoConsulta}</p>}
      <p>
        Llegada: {order.recepcion?.horaLlegada || "Sin registrar"}
        {" · "}Prioridad: {triageLabels[order.triage?.prioridad] || "Sin registrar"}
      </p>
    </>
  );

  if (professionalUid) {
    return (
      <section className="erp-panel">
        <h1>Orden de atención</h1>
        {summary}
        <dl>
          <dt>Box de atención</dt>
          <dd>{order.box || "Sin asignar"}</dd>
          <dt>Tipo de atención</dt>
          <dd>{order.tipoAtencion || "Sin asignar"}</dd>
        </dl>
        {!canStart && <p>La orden estará lista cuando se asignen el box y el tipo de atención.</p>}
        {error && <p role="alert">{error}</p>}
        <div className="veterinary-order-actions">
          <Button type="button" onClick={start} loading={operation === "start"} disabled={!canStart}>Iniciar atención</Button>
          <Button type="button" variant="secondary" onClick={() => navigate(base + "/pacientes/" + encodeURIComponent(order.pacienteId))}>
            Ver ficha del paciente
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="erp-panel">
      <h1>Asignar orden de atención</h1>
      {summary}
      <form className="erp-form" onSubmit={save}>
        <div className="erp-form-grid">
          <VeterinaryField label="Box de atención" required>
            <select className="erp-control" name="box" value={selectedBox?.nombre ?? ""} onChange={change}
              required disabled={Boolean(boxError) || !boxes?.length}>
              <option value="">{boxPlaceholder}</option>
              {boxes?.map((box) => (
                <option key={box.id} value={box.nombre} disabled={!boxAvailable(box)}>
                  {box.nombre}{boxAvailable(box) ? "" : ` · ${veterinaryBoxStatuses[box.state].label}`}
                </option>
              ))}
            </select>
          </VeterinaryField>
          <VeterinaryField label="Tipo de atención" required>
            <input className="erp-control" name="tipoAtencion" value={form.tipoAtencion} placeholder="Ej. Consulta o control"
              maxLength={100} onChange={change} required />
          </VeterinaryField>
          <VeterinaryField label="Profesional a cargo" required>
            <select className="erp-control" name="profesionalUid" value={selectedProfessional ? form.profesionalUid : ""} onChange={change} required>
              <option value="">Selecciona al responsable</option>
              {professionals.map((member) => (
                <option key={member.uid} value={member.uid}>
                  {professionalOptionLabel(member)}
                </option>
              ))}
            </select>
          </VeterinaryField>
        </div>
        {boxError ? <p role="alert">{boxError}</p> : boxes?.length === 0 ? (
          <p className="erp-secondary-text">Agrega un box en Órdenes de atención para poder asignarlo.</p>
        ) : boxes && !boxes.some(boxAvailable) ? (
          <p className="erp-secondary-text">En este momento no hay boxes disponibles.</p>
        ) : null}
        {professionals.length === 0 && <p>No hay profesionales disponibles para asignar.</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!confirmCancel && (
          <div className="veterinary-order-actions">
            <Button type="submit" loading={operation === "assign"}
              disabled={operation === "start" || professionals.length === 0 || Boolean(boxError) || !selectedBoxAvailable}>
              Guardar asignación
            </Button>
            {assignedToCurrentUser && (
              <Button type="button" variant="secondary" loading={operation === "start"}
                onClick={start} disabled={!canStart || operation === "assign"}>Iniciar atención</Button>
            )}
            <Button type="button" variant="secondary" disabled={Boolean(operation)} onClick={() => setConfirmCancel(true)}>
              Cancelar orden
            </Button>
          </div>
        )}
        {confirmCancel && (
          <div>
            <p>¿Confirmas que quieres cancelar esta orden de atención?</p>
            <div className="veterinary-order-actions">
              <Button type="button" loading={operation === "cancel"} onClick={cancel}>Confirmar cancelación</Button>
              <Button type="button" variant="secondary" disabled={Boolean(operation)} onClick={() => setConfirmCancel(false)}>Volver</Button>
            </div>
          </div>
        )}
        {order.profesionalUid && !assignedToCurrentUser && (
          <p>El profesional asignado debe iniciar la atención desde su cuenta.</p>
        )}
      </form>
    </section>
  );
}

export default function VeterinaryOrders({businessId, mode = "list", professionalUid}) {
  const {atencionId} = useParams();
  const navigate = useNavigate();
  const reception = mode === "reception" || mode === "emergency";
  const details = mode === "detail";
  const [orders, setOrders] = useState(null);
  const [boxCatalog, setBoxCatalog] = useState(null);
  const [boxError, setBoxError] = useState("");
  const [professionals, setProfessionals] = useState(null);
  const [error, setError] = useState("");
  const {patients, error: patientError} = useVeterinaryPatientDirectory(businessId, professionalUid, orders);
  useEffect(() => {
    if (!businessId) return undefined;
    const stopOrders = reception ? null
      : subscribeToVeterinaryAttentions(businessId, setOrders, () => setError("No se pudieron cargar las órdenes."), professionalUid);
    const stopBoxes = !reception && !professionalUid ? subscribeToVeterinaryBoxes(businessId, (items) => {
      setBoxCatalog(items);
      setBoxError("");
    }, () => setBoxError("No se pudieron consultar los boxes de atención.")) : null;
    let active = true;
    if (details && !professionalUid) {
      loadAssignableProfessionals(businessId)
        .then((items) => {
          if (active) setProfessionals(items);
        })
        .catch(() => {
          if (active) setError("No se pudieron consultar los profesionales de la clínica.");
        });
    }
    return () => {
      active = false;
      stopOrders?.();
      stopBoxes?.();
    };
  }, [businessId, reception, details, professionalUid]);

  if (!businessId) return <p role="alert">Selecciona una empresa activa.</p>;
  if (error || patientError) return <p role="alert">{error || patientError}</p>;
  if (!patients || (!reception && !orders) || (details && !professionalUid && !professionals)) {
    return <LoadingState variant="section" label="Cargando órdenes de atención..." />;
  }

  const names = new Map(patients.map((patient) => [patient.id, patient.nombre]));
  const order = details ? orders.find((item) => item.id === atencionId) : null;
  const boxes = boxCatalog && buildVeterinaryBoxBoard(boxCatalog, orders);
  return (
    <div className="erp-page">
      {mode !== "list" && (
        <nav aria-label="Órdenes de atención">
          <Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate(ordersPath)}>
            Volver a las órdenes
          </Button>
        </nav>
      )}
      {mode === "list" && <OrderList businessId={businessId} orders={orders} names={names} professionalUid={professionalUid}
        boxes={boxes} boxError={boxError} />}
      {reception && <ReceiveOrder businessId={businessId} patients={patients} emergency={mode === "emergency"} />}
      {details && (order
        ? <AssignOrder key={order.id} businessId={businessId} order={order}
          name={names.get(order.pacienteId) || "Paciente"} professionals={professionals ?? []} professionalUid={professionalUid}
          boxes={boxes} boxError={boxError} />
        : <p className="erp-empty-state">Orden de atención no encontrada.</p>)}
    </div>
  );
}
