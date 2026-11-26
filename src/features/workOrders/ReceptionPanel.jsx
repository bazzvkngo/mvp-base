import React, {useEffect, useMemo, useState} from "react";
import {Save} from "lucide-react";
import Button from "../../components/ui/Button";
import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../../domain/rbac.mjs";
import {canRegisterReceptionPhotos} from "../../domain/workOrderReceptionPhotoModel.mjs";
import {
  appendReceptionReason,
  buildReceptionMutationPayload,
  getReceptionFieldErrors,
  getReceptionWarningLightLabel,
  MAX_RECEPTION_MILEAGE_KM,
  MAX_RECEPTION_REASON_LENGTH,
  RECEPTION_FUEL_LEVELS,
  RECEPTION_QUICK_REASONS,
  RECEPTION_WARNING_LIGHTS,
  receptionRequirements,
  receptionValuesFromStored,
} from "../../domain/workOrderReceptionModel.mjs";
import {getWorkOrderErrorMessage, obtenerIngresoRecepcionOT, registrarRecepcionOrdenTrabajo} from "../../services/workOrderService";
import {DashboardPhotoControl, ReceptionPhotoViewer, useReceptionPhotos, VehiclePhotosBody} from "./ReceptionPhotosPanel";

function Chip({children, onClick, pressed}) {
  return <button type="button" className="work-order-chip" aria-pressed={pressed} onClick={onClick}>{children}</button>;
}

function Card({children, hint, title}) {
  return <section className="erp-panel work-order-reception-card">
    <div className="work-order-reception-card__header">
      <h2 className="erp-panel-title">{title}</h2>
      {hint && <span className="erp-secondary-text">{hint}</span>}
    </div>
    {children}
  </section>;
}

function SummaryItem({label, value}) {
  return <div className="vehicle-detail-item"><dt>{label}</dt><dd>{value}</dd></div>;
}

// Recepción del vehículo (prototipo «Panel del Taller»): relato del cliente, fotos por zona, tablero
// (foto, kilometraje, combustible y sensores) y la lista de requisitos para registrarla.
// Las fotos se guardan al tomarlas; el resto de los datos, al registrar la recepción.
export default function ReceptionPanel({businessId, onSaved, order, otId, role}) {
  const stored = order.recepcion || null;
  const storedKey = JSON.stringify(stored && [stored.motivoCliente, stored.kilometraje, stored.nivelCombustible,
    stored.testigosEncendidos, stored.testigos, stored.ingresaNombre, stored.ingresaTieneDocumento]);
  const [values, setValues] = useState(() => receptionValuesFromStored(stored));
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const photos = useReceptionPhotos({businessId, onChanged: onSaved, order, otId, role});
  const editable = hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_OPERATE) && canRegisterReceptionPhotos(order);
  // El RUT de quien entrega solo lo ve el Owner/Administrador (lo entrega el servidor).
  const canSeeBearerDocument = hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_MANAGE);
  const [bearerDocument, setBearerDocument] = useState("");
  useEffect(() => {
    if (!canSeeBearerDocument || !stored?.ingresaTieneDocumento) return undefined;
    let active = true;
    obtenerIngresoRecepcionOT(businessId, otId)
      .then((data) => { if (active) setBearerDocument(data?.documento || ""); })
      .catch(() => { if (active) setBearerDocument(""); });
    return () => { active = false; };
  }, [businessId, otId, canSeeBearerDocument, stored?.ingresaTieneDocumento, storedKey]);

  // Solo se restablece cuando cambia lo guardado: guardar una foto no debe borrar lo que se está escribiendo.
  useEffect(() => {
    setValues(receptionValuesFromStored(stored));
    setServerError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const requirements = useMemo(() => receptionRequirements(values, photos.progress), [values, photos.progress]);
  const pending = requirements.filter((item) => !item.done).length;

  const update = (changes) => {
    setValues((current) => ({...current, ...changes}));
    setServerError("");
    setNotice("");
  };
  const toggleLight = (light) => update({
    testigos: values.testigos.includes(light) ? values.testigos.filter((item) => item !== light) : [...values.testigos, light],
  });

  const submit = async (event) => {
    event.preventDefault();
    if (saving || pending) return;
    const errors = getReceptionFieldErrors(values);
    const firstError = Object.values(errors)[0];
    if (firstError) { setServerError(firstError); return; }
    setSaving(true);
    setServerError("");
    setNotice("");
    try {
      await registrarRecepcionOrdenTrabajo(businessId, otId, buildReceptionMutationPayload(values));
      // onSaved refresca la OT sin desmontar la pantalla, para que el aviso y la posición de scroll se conserven.
      await onSaved();
      setNotice(stored ? "Recepción actualizada correctamente." : "Recepción registrada correctamente.");
    } catch (saveError) {
      setServerError(getWorkOrderErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (!stored && !editable) {
    return <section className="erp-panel work-order-reception-card" aria-labelledby="work-order-reception-title">
      <h2 id="work-order-reception-title" className="erp-panel-title">Recepción</h2>
      <div className="erp-empty-state">Aún no hay una recepción registrada.</div>
      {!hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_OPERATE) &&
        <div className="vehicle-message vehicle-message--warning" role="status">No tienes permisos para registrar la recepción de esta OT.</div>}
    </section>;
  }

  const vehicleCard = <Card title="3. Fotos del vehículo" hint={`${photos.progress.completedVehicle} de ${photos.progress.totalVehicle}`}>
    <VehiclePhotosBody photos={photos} />
  </Card>;

  if (!editable) {
    const lights = stored.testigosEncendidos === true
      ? (stored.testigos || []).map(getReceptionWarningLightLabel).join(", ") || "Sí"
      : stored.testigosEncendidos === false ? "Ninguno" : "No informado";
    return <div className="work-order-reception">
      <Card title="1. Relato del cliente">
        <p>{stored.motivoCliente || "Sin relato registrado"}</p>
      </Card>
      <Card title="2. Quién entrega el vehículo">
        <dl className="vehicle-detail-grid">
          <SummaryItem label="Nombre" value={stored.ingresaNombre || "No informado"} />
          {canSeeBearerDocument && stored.ingresaTieneDocumento && <SummaryItem label="RUT" value={bearerDocument || "Cargando..."} />}
        </dl>
      </Card>
      {vehicleCard}
      <Card title="4. Tablero">
        <DashboardPhotoControl photos={photos} />
        <dl className="vehicle-detail-grid">
          <SummaryItem label="Kilometraje" value={`${Number(stored.kilometraje).toLocaleString("es-CL")} km`} />
          <SummaryItem label="Nivel de combustible" value={stored.nivelCombustible || "No informado"} />
          <SummaryItem label="Sensores encendidos" value={lights} />
          {stored.danosObservados && <SummaryItem label="Daños observados" value={stored.danosObservados} />}
        </dl>
      </Card>
      <ReceptionPhotoViewer photos={photos} />
    </div>;
  }

  return <form className="work-order-reception" onSubmit={submit} noValidate>
    <Card title="1. Relato del cliente">
      <p className="erp-secondary-text">Motivo de ingreso: lo que el cliente indica.</p>
      <textarea className="erp-control work-order-reception-textarea" rows={3} maxLength={MAX_RECEPTION_REASON_LENGTH}
        aria-label="Relato del cliente" placeholder="Ej: ruido al frenar y vibración" value={values.motivoCliente}
        onChange={(event) => update({motivoCliente: event.target.value})} />
      <div className="work-order-chip-row">
        {RECEPTION_QUICK_REASONS.map((reason) => <Chip key={reason}
          onClick={() => update({motivoCliente: appendReceptionReason(values.motivoCliente, reason)})}>{reason}</Chip>)}
      </div>
    </Card>

    <Card title="2. Quién entrega el vehículo" hint="Puede no ser el titular">
      <div className="work-order-delivery__form">
        <label className="erp-field"><span className="erp-field__label">Nombre de quien entrega *</span>
          <input className="erp-control" value={values.ingresaNombre} maxLength={120}
            onChange={(event) => update({ingresaNombre: event.target.value})} /></label>
        <label className="erp-field"><span className="erp-field__label">RUT de quien entrega *</span>
          <input className="erp-control" value={values.ingresaDocumento} maxLength={20}
            placeholder={values.ingresaTieneDocumento ? "Registrado: déjalo vacío para conservarlo" : "12.345.678-5"}
            onChange={(event) => update({ingresaDocumento: event.target.value})} /></label>
      </div>
    </Card>

    {vehicleCard}

    <Card title="4. Tablero" hint="Foto obligatoria">
      <DashboardPhotoControl photos={photos} />
      {!photos.capturingDashboard && <>
        <label className="erp-field">
          <span className="erp-field__label">Kilometraje</span>
          <input className="erp-control" type="number" inputMode="numeric" min="1" max={MAX_RECEPTION_MILEAGE_KM} step="1"
            placeholder="120000" value={values.kilometraje} onChange={(event) => update({kilometraje: event.target.value})} />
        </label>
        <div className="erp-field" role="group" aria-label="Nivel de combustible">
          <span className="erp-field__label">Nivel de combustible</span>
          <div className="work-order-chip-row">
            {RECEPTION_FUEL_LEVELS.map((level) => <Chip key={level.value} pressed={values.nivelCombustible === level.value}
              onClick={() => update({nivelCombustible: level.value})}>{level.label}</Chip>)}
          </div>
        </div>
        <div className="erp-field" role="group" aria-label="Sensores encendidos en el tablero">
          <span className="erp-field__label">¿Sensores encendidos en el tablero?</span>
          <div className="work-order-chip-row">
            <Chip pressed={values.testigosEncendidos === false} onClick={() => update({testigosEncendidos: false, testigos: []})}>No</Chip>
            <Chip pressed={values.testigosEncendidos === true} onClick={() => update({testigosEncendidos: true})}>Sí</Chip>
          </div>
          {values.testigosEncendidos === true && <div className="work-order-chip-row">
            {RECEPTION_WARNING_LIGHTS.map((light) => <Chip key={light.value} pressed={values.testigos.includes(light.value)}
              onClick={() => toggleLight(light.value)}>{light.label}</Chip>)}
          </div>}
        </div>
      </>}
    </Card>

    <Card title="Para registrar la recepción">
      <ul className="work-order-requirements" aria-label="Para registrar la recepción">
        {requirements.map((item) => <li key={item.label} data-done={item.done ? "true" : undefined}>{item.label}</li>)}
      </ul>
      {serverError && <div className="vehicle-message vehicle-message--error" role="alert">{serverError}</div>}
      {notice && <div className="vehicle-message" role="status">{notice}</div>}
      <div className="vehicle-form-actions">
        <Button type="submit" icon={Save} disabled={saving || pending > 0}>
          {saving ? "Guardando recepción..." : pending ? `Faltan ${pending} requisito(s)` : stored ? "Actualizar recepción" : "Registrar recepción"}
        </Button>
      </div>
    </Card>
    <ReceptionPhotoViewer photos={photos} />
  </form>;
}
