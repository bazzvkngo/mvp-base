import React, {useState} from "react";
import {Camera, CircleCheck} from "lucide-react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../../domain/rbac.mjs";
import {canRegisterReceptionPhotos, receptionPhotoProgress} from "../../domain/workOrderReceptionPhotoModel.mjs";
import {getWorkOrderErrorMessage, leerFotoRecepcionOT} from "../../services/workOrderService";
import CarSilhouette from "./CarSilhouette";
import ReceptionPhotoCapture, {PhotoWithMarks} from "./ReceptionPhotoCapture";

function stampLabel(photo) {
  const date = photo?.subidaEn?.toDate?.();
  const when = date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("es-CL", {dateStyle: "medium", timeStyle: "short"}) : "Fecha no disponible";
  return `${when}${photo?.subidaPorNombre ? ` · ${photo.subidaPorNombre}` : ""} · No editable`;
}

// Estado compartido de las fotos de recepción: progreso, captura en curso y visor de una foto sellada.
// Lo usa ReceptionPanel para las tarjetas «Fotos del vehículo» y «Tablero».
export function useReceptionPhotos({businessId, onChanged, order, otId, role}) {
  const canCapture = hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_OPERATE) && canRegisterReceptionPhotos(order);
  const progress = receptionPhotoProgress(order);
  const [capture, setCapture] = useState(null);
  const [viewer, setViewer] = useState(null);

  const openZone = async (zone) => {
    if (!zone.completed) {
      if (canCapture) setCapture(zone);
      return;
    }
    setViewer({zone, source: "", loading: true, error: ""});
    try {
      const imagen = await leerFotoRecepcionOT(businessId, otId, zone.id);
      setViewer({zone, source: `data:image/jpeg;base64,${imagen}`, loading: false, error: ""});
    } catch (readError) {
      setViewer({zone, source: "", loading: false, error: getWorkOrderErrorMessage(readError)});
    }
  };

  const captureProps = (zone) => ({
    businessId, otId, zone,
    zoneNumber: progress.zones.findIndex((item) => item.id === zone.id) + 1,
    onCancel: () => setCapture(null),
    onDone: () => setCapture(null),
    onSaved: onChanged,
  });

  return {
    canCapture, capture, captureProps, closeViewer: () => setViewer(null), openZone, order, progress, viewer,
    capturingDashboard: Boolean(capture && capture.id === progress.dashboard.id),
    capturingVehicle: Boolean(capture && capture.id !== progress.dashboard.id),
  };
}

// Silueta del auto con las seis zonas y su lista; la captura guiada reemplaza la silueta mientras dura.
export function VehiclePhotosBody({photos}) {
  const {canCapture, capture, captureProps, capturingVehicle, openZone, progress} = photos;
  if (capturingVehicle) {
    return <>
      <p className="erp-secondary-text">Zona {captureProps(capture).zoneNumber} de 6. La foto queda sellada con fecha y usuario, y no se puede editar.</p>
      <ReceptionPhotoCapture key={capture.id} {...captureProps(capture)} />
    </>;
  }
  return <>
    <p className="erp-secondary-text">{canCapture
      ? "Toca una zona para abrir la cámara con la guía de encuadre de esa parte del vehículo."
      : "Fotos registradas en la recepción. Toca una zona fotografiada para verla."}</p>
    <div className="work-order-reception-card__photos">
      <CarSilhouette zones={progress.zones} onSelect={openZone} />
      <ul className="work-order-zone-list">
        {progress.zones.map((zone, index) => <li key={zone.id}>
          <button type="button" data-completed={zone.completed ? "true" : undefined}
            disabled={!zone.completed && !canCapture} onClick={() => openZone(zone)}>
            <span className="work-order-zone-list__dot" aria-hidden="true" />
            <span>{index + 1}. {zone.label}
              {zone.completed && (zone.withDamages
                ? <span className="work-order-zone-list__damage"> · con daños</span>
                : <span className="work-order-zone-list__ok"> · sin daños</span>)}</span>
          </button>
        </li>)}
      </ul>
    </div>
  </>;
}

// Botón de la foto del tablero; la captura guiada lo reemplaza mientras dura.
export function DashboardPhotoControl({photos}) {
  const {canCapture, capture, captureProps, capturingDashboard, openZone, progress} = photos;
  if (capturingDashboard) return <ReceptionPhotoCapture key={capture.id} {...captureProps(capture)} />;
  return <Button type="button" variant={progress.dashboard.completed ? "secondary" : "primary"}
    icon={progress.dashboard.completed ? CircleCheck : Camera}
    disabled={!progress.dashboard.completed && !canCapture} onClick={() => openZone(progress.dashboard)}>
    {progress.dashboard.completed ? "Foto del tablero tomada" : "Fotografiar tablero"}
  </Button>;
}

// Visor de una foto sellada, con sus marcas de daño y las notas.
export function ReceptionPhotoViewer({photos}) {
  const {closeViewer, order, viewer} = photos;
  const marks = viewer?.zone.photo?.conDanos ? viewer.zone.photo.marcas || [] : [];
  return <ResponsiveDialog open={Boolean(viewer)} onClose={closeViewer} size="medium" eyebrow={order.numeroOT || "Recepción"}
    title={viewer ? `Foto: ${viewer.zone.label}` : "Foto"} description={viewer ? stampLabel(viewer.zone.photo) : ""}
    footer={<Button type="button" variant="secondary" onClick={closeViewer}>Cerrar</Button>}>
    {viewer?.loading && <LoadingState variant="section" label="Cargando foto..." />}
    {viewer?.error && <div className="vehicle-message vehicle-message--error" role="alert">{viewer.error}</div>}
    {viewer?.source && <PhotoWithMarks src={viewer.source} alt={`Foto de recepción: ${viewer.zone.label}`} marks={marks} />}
    {viewer?.source && viewer.zone.photo?.conDanos === false && <p className="erp-secondary-text">Sin daños visibles.</p>}
    {marks.length > 0 && <ol className="work-order-damage-notes">
      {marks.map((mark, index) => <li key={index}>{mark.nota}</li>)}
    </ol>}
  </ResponsiveDialog>;
}
