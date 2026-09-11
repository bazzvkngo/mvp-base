import React, {useCallback, useEffect, useState} from "react";
import {ArrowLeft, RefreshCw, Save} from "lucide-react";
import {useNavigate, useParams} from "react-router-dom";
import Button from "../components/ui/Button";
import StatusBadge from "../components/ui/StatusBadge";
import {
  getWorkOrderApprovalLabel,
  getWorkOrderApprovalVariant,
  getWorkOrderStatusLabel,
  getWorkOrderStatusVariant,
} from "../domain/workOrderModel.mjs";
import {
  buildReceptionMutationPayload,
  getReceptionFieldErrors,
  hasReceptionAnomaly,
  isReceptionChecklistComplete,
  RECEPTION_CHECKLIST_FIELDS,
  RECEPTION_FUEL_LEVELS,
  receptionValuesFromStored,
} from "../domain/workOrderReceptionModel.mjs";
import {listarClientes} from "../services/clientService";
import {obtenerVehiculo} from "../services/vehicleService";
import {
  getWorkOrderErrorMessage,
  obtenerOrdenTrabajo,
  registrarRecepcionOrdenTrabajo,
} from "../services/workOrderService";

const CLIENT_READ_ROLES = new Set(["OWNER", "ADMIN"]);
const RECEPTION_OPERATION_ROLES = new Set(["OWNER", "ADMIN", "TECNICO", "MEMBER"]);

const DETAIL_SECTIONS = Object.freeze([
  {id: "resumen", label: "Resumen"},
  {id: "recepcion", label: "Recepción"},
  {id: "diagnosticos", label: "Diagnósticos"},
  {id: "servicios", label: "Servicios y repuestos"},
  {id: "historial", label: "Historial"},
]);

function DetailItem({label, value}) {
  return <div className="vehicle-detail-item"><dt>{label}</dt><dd>{value}</dd></div>;
}

function PendingSection({title, description}) {
  return <section className="erp-panel" aria-labelledby={`work-order-${title.toLowerCase().replaceAll(" ", "-")}-title`}>
    <div className="erp-panel-header"><div><h2 id={`work-order-${title.toLowerCase().replaceAll(" ", "-")}-title`} className="erp-panel-title">{title}</h2><p className="erp-secondary-text">{description}</p></div></div>
    <div className="erp-empty-state" role="status">Esta sección estará disponible cuando se implemente su etapa funcional.</div>
  </section>;
}

function ReceptionField({children, error, label, required = false}) {
  return <label className="erp-field">
    <span className="erp-field__label">{label}{required ? " *" : ""}</span>
    {children}
    {error && <span className="work-order-field-error" role="alert">{error}</span>}
  </label>;
}

function ReceptionPanel({businessId, onSaved, order, otId, role}) {
  const [values, setValues] = useState(() => receptionValuesFromStored(order.recepcion));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);
  const canOperate = RECEPTION_OPERATION_ROLES.has(String(role || "").toUpperCase());
  const checklistComplete = isReceptionChecklistComplete(values.checklist);
  const hasAnomaly = hasReceptionAnomaly(values.checklist);

  useEffect(() => {
    setValues(receptionValuesFromStored(order.recepcion));
    setErrors({});
    setServerError("");
  }, [order.recepcion]);

  const updateValue = (field, value) => {
    setValues((current) => ({...current, [field]: value}));
    setErrors((current) => ({...current, [field]: undefined}));
    setServerError("");
  };

  const updateChecklist = (field, value) => {
    setValues((current) => {
      const checklist = {...current.checklist, [field]: value};
      const complete = isReceptionChecklistComplete(checklist);
      const anomaly = hasReceptionAnomaly(checklist);
      return {
        ...current,
        checklist,
        danosObservados: complete
          ? anomaly
            ? current.danosObservados === "Ninguno" ? "" : current.danosObservados
            : "Ninguno"
          : current.danosObservados,
      };
    });
    setErrors((current) => ({...current, [field]: undefined, danosObservados: undefined}));
    setServerError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    const nextErrors = getReceptionFieldErrors(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setServerError("");
    try {
      await registrarRecepcionOrdenTrabajo(
        businessId,
        otId,
        buildReceptionMutationPayload(values),
      );
      await onSaved();
    } catch (saveError) {
      setServerError(getWorkOrderErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (!order.recepcion && !canOperate) return <section className="erp-panel" aria-labelledby="work-order-reception-title">
    <div className="erp-panel-header"><div><h2 id="work-order-reception-title" className="erp-panel-title">Recepción</h2><p className="erp-secondary-text">Registra las condiciones observables del vehículo al momento de su ingreso.</p></div></div>
    <div className="erp-empty-state">Aún no hay una recepción registrada.</div>
    <div className="vehicle-message vehicle-message--warning" role="status">No tienes permisos para registrar la recepción de esta OT.</div>
  </section>;

  return <section className="erp-panel" aria-labelledby="work-order-reception-title">
    <div className="erp-panel-header"><div><h2 id="work-order-reception-title" className="erp-panel-title">Recepción</h2><p className="erp-secondary-text">Registra condiciones observables. Esta checklist no reemplaza un diagnóstico mecánico.</p></div></div>
    {!canOperate && <div className="vehicle-message vehicle-message--warning" role="status">Tu perfil tiene acceso de lectura a esta recepción.</div>}
    {canOperate ? <form className="vehicle-form" onSubmit={submit} noValidate>
      <div className="work-order-reception-grid">
        <ReceptionField label="Kilometraje" error={errors.kilometraje} required><input className="erp-control" type="number" min="0" step="1" value={values.kilometraje} onChange={(event) => updateValue("kilometraje", event.target.value)} /></ReceptionField>
        <ReceptionField label="Nivel de combustible" error={errors.nivelCombustible} required><select className="erp-control" value={values.nivelCombustible} onChange={(event) => updateValue("nivelCombustible", event.target.value)}><option value="">Selecciona una opción</option>{RECEPTION_FUEL_LEVELS.map((fuelLevel) => <option key={fuelLevel.value} value={fuelLevel.value}>{fuelLevel.label}</option>)}</select></ReceptionField>
        {RECEPTION_CHECKLIST_FIELDS.map((field) => <ReceptionField key={field.name} label={field.label} error={errors[field.name]} required><select className="erp-control" value={values.checklist[field.name]} onChange={(event) => updateChecklist(field.name, event.target.value)}><option value="">Selecciona una opción</option>{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></ReceptionField>)}
        <ReceptionField label="Daños u observaciones detectados" error={errors.danosObservados} required={checklistComplete && hasAnomaly}><textarea className="erp-control work-order-reception-textarea" disabled={checklistComplete && !hasAnomaly} maxLength={2000} value={values.danosObservados} onChange={(event) => updateValue("danosObservados", event.target.value)} placeholder={hasAnomaly ? "Describe la anomalía observada" : checklistComplete ? "Ninguno" : "Completa la checklist primero"} /></ReceptionField>
        <ReceptionField label="Accesorios entregados"><textarea className="erp-control work-order-reception-textarea" maxLength={6000} value={values.accesoriosTexto} onChange={(event) => updateValue("accesoriosTexto", event.target.value)} placeholder="Un accesorio por línea" /></ReceptionField>
        <ReceptionField label="Observaciones" ><textarea className="erp-control work-order-reception-textarea" maxLength={2000} value={values.observaciones} onChange={(event) => updateValue("observaciones", event.target.value)} /></ReceptionField>
      </div>
      {checklistComplete && <p className="erp-secondary-text">{hasAnomaly ? "Debes describir las anomalías detectadas antes de guardar." : "No se detectaron anomalías visibles: se registrará Ninguno."}</p>}
      {serverError && <div className="vehicle-message vehicle-message--error" role="alert">{serverError}</div>}
      <div className="vehicle-form-actions"><Button type="submit" icon={Save} disabled={saving}>{saving ? "Guardando recepción..." : order.recepcion ? "Actualizar recepción" : "Registrar recepción"}</Button></div>
    </form> : <dl className="vehicle-detail-grid">
      <DetailItem label="Kilometraje" value={order.recepcion.kilometraje} />
      <DetailItem label="Nivel de combustible" value={order.recepcion.nivelCombustible} />
      {RECEPTION_CHECKLIST_FIELDS.map((field) => <DetailItem key={field.name} label={field.label} value={field.options.find(([value]) => value === order.recepcion.checklist?.[field.name])?.[1] || "No informado"} />)}
      <DetailItem label="Daños observados" value={order.recepcion.danosObservados} />
      <DetailItem label="Accesorios entregados" value={order.recepcion.accesorios?.join(", ") || "Ninguno"} />
      <DetailItem label="Observaciones" value={order.recepcion.observaciones || "Sin observaciones"} />
    </dl>}
  </section>;
}

export default function WorkOrderDetailPage({businessId, role}) {
  const {otId} = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState("resumen");
  const canReadClients = CLIENT_READ_ROLES.has(String(role || "").toUpperCase());

  const load = useCallback(async () => {
    if (!businessId || !otId) return;
    setLoading(true);
    setError("");
    try {
      const orderItem = await obtenerOrdenTrabajo(businessId, otId);
      if (!orderItem) {
        setOrder(null);
        setVehicle(null);
        setClient(null);
        return;
      }
      const [vehicleItem, clientItems] = await Promise.all([
        obtenerVehiculo(businessId, orderItem.vehiculoId),
        canReadClients ? listarClientes(businessId) : Promise.resolve([]),
      ]);
      setOrder(orderItem);
      setVehicle(vehicleItem);
      setClient(clientItems.find((item) => item.clienteId === orderItem.clienteId) || null);
    } catch (loadError) {
      setError(getWorkOrderErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [businessId, canReadClients, otId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <main className="erp-page"><div className="erp-empty-state" role="status">Cargando orden de trabajo...</div></main>;
  if (error) return <main className="erp-page"><div className="vehicle-message vehicle-message--error" role="alert"><span>{error}</span><Button type="button" variant="secondary" icon={RefreshCw} onClick={load}>Reintentar</Button></div></main>;
  if (!order) return <main className="erp-page"><div className="erp-empty-state" role="status"><h2>Orden de trabajo no encontrada</h2><p>Puede no existir o no pertenecer al negocio activo.</p><Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate("/taller/ordenes")}>Volver a órdenes</Button></div></main>;

  const vehicleLabel = vehicle ? `${vehicle.marca} ${vehicle.modelo}` : "Vehículo no disponible";
  const clientLabel = client?.nombreRazonSocial || order.clienteId || "Cliente histórico no disponible";
  const plazaLabel = order.plazaId || "Sin asignar";

  return <main className="erp-page work-orders-page">
    <header className="erp-page-header">
      <div className="erp-page-header__content">
        <p className="erp-page-header__eyebrow">Taller · Órdenes de trabajo</p>
        <h1 className="erp-page-header__title">{order.numeroOT || "Orden de trabajo"}</h1>
        <p className="erp-page-header__description">{vehicleLabel} · {vehicle?.patente || "Patente no disponible"}</p>
        <p className="erp-page-header__description">Cliente histórico: {clientLabel}</p>
        <div className="work-order-header-meta" aria-label="Estado actual de la orden">
          <StatusBadge variant={getWorkOrderStatusVariant(order.estado)}>{getWorkOrderStatusLabel(order.estado)}</StatusBadge>
          <StatusBadge variant={getWorkOrderApprovalVariant(order.estadoAprobacion)}>{getWorkOrderApprovalLabel(order.estadoAprobacion)}</StatusBadge>
          <StatusBadge variant="neutral">Plaza: {plazaLabel}</StatusBadge>
        </div>
      </div>
      <div className="erp-module-actions"><Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate("/taller/ordenes")}>Volver</Button></div>
    </header>

    <div className="work-order-tabs" role="tablist" aria-label="Secciones de la orden de trabajo">
      {DETAIL_SECTIONS.map((section) => <button key={section.id} type="button" role="tab" aria-selected={activeSection === section.id} onClick={() => setActiveSection(section.id)}>{section.label}</button>)}
    </div>

    {activeSection === "resumen" && <section className="erp-panel" aria-labelledby="work-order-summary-title">
      <div className="erp-panel-header"><div><h2 id="work-order-summary-title" className="erp-panel-title">Resumen</h2><p className="erp-secondary-text">Información disponible de la orden de trabajo.</p></div></div>
      <dl className="vehicle-detail-grid">
        <DetailItem label="Estado actual" value={<StatusBadge variant={getWorkOrderStatusVariant(order.estado)}>{getWorkOrderStatusLabel(order.estado)}</StatusBadge>} />
        <DetailItem label="Aprobación" value={<StatusBadge variant={getWorkOrderApprovalVariant(order.estadoAprobacion)}>{getWorkOrderApprovalLabel(order.estadoAprobacion)}</StatusBadge>} />
        <DetailItem label="Vehículo" value={vehicleLabel} />
        <DetailItem label="Patente" value={vehicle?.patente || "No disponible"} />
        <DetailItem label="Cliente histórico" value={clientLabel} />
        <DetailItem label="Plaza" value={plazaLabel} />
      </dl>
    </section>}
    {activeSection === "recepcion" && <ReceptionPanel businessId={businessId} onSaved={load} order={order} otId={otId} role={role} />}
    {activeSection === "diagnosticos" && <PendingSection title="Diagnósticos" description="Aquí se visualizarán los diagnósticos asociados a esta OT." />}
    {activeSection === "servicios" && <PendingSection title="Servicios y repuestos" description="Aquí se definirá el alcance de reparación y sus materiales." />}
    {activeSection === "historial" && <PendingSection title="Historial" description="Aquí se mostrarán los eventos registrados para esta OT." />}
  </main>;
}
