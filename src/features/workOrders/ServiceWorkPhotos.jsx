import React, {useState} from "react";
import {Camera, Eye} from "lucide-react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {WORK_PHOTO_MOMENTS} from "../../domain/workOrderExecutionModel.mjs";
import {getWorkOrderErrorMessage, leerFotoServicioOT, subirFotoServicioOT} from "../../services/workOrderService";
import {receptionImageAsJpeg} from "./receptionPhotoImage";

function stampLabel(photo) {
  const date = photo?.subidaEn?.toDate?.();
  const when = date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("es-CL", {dateStyle: "medium", timeStyle: "short"}) : "Fecha no disponible";
  return `${when}${photo?.subidaPorNombre ? ` · ${photo.subidaPorNombre}` : ""} · No editable`;
}

// Fotos «antes» y «después» de un trabajo (opcionales). Cada una queda sellada con fecha y usuario.
export default function ServiceWorkPhotos({businessId, canAdd, onSaved, otId, service}) {
  const [busyMoment, setBusyMoment] = useState("");
  const [error, setError] = useState("");
  const [viewer, setViewer] = useState(null);

  const upload = async (moment, file) => {
    if (!file || busyMoment) return;
    setBusyMoment(moment); setError("");
    try {
      const base64 = await receptionImageAsJpeg(file);
      await subirFotoServicioOT(businessId, otId, service.servicioOtId, moment, base64);
      await onSaved();
    } catch (uploadError) {
      setError(uploadError?.code ? getWorkOrderErrorMessage(uploadError) : uploadError.message);
    } finally { setBusyMoment(""); }
  };

  const open = async (moment) => {
    const photo = service.fotos?.[moment.id];
    setViewer({moment, photo, source: "", loading: true, error: ""});
    try {
      const image = await leerFotoServicioOT(businessId, otId, service.servicioOtId, moment.id);
      setViewer({moment, photo, source: `data:image/jpeg;base64,${image}`, loading: false, error: ""});
    } catch (readError) {
      setViewer({moment, photo, source: "", loading: false, error: getWorkOrderErrorMessage(readError)});
    }
  };

  return <div className="work-order-work__photos">
    <p className="erp-secondary-text">Fotos del trabajo (opcional)</p>
    <div className="work-order-chip-row">
      {WORK_PHOTO_MOMENTS.map((moment) => {
        const photo = service.fotos?.[moment.id];
        if (photo?.hash) {
          return <Button key={moment.id} type="button" variant="secondary" icon={Eye} onClick={() => open(moment)}>
            Ver foto {moment.label.toLowerCase()}
          </Button>;
        }
        if (!canAdd) return <span key={moment.id} className="erp-secondary-text">Sin foto {moment.label.toLowerCase()}</span>;
        return <label key={moment.id} className="work-order-capture__take work-order-work__take">
          <input type="file" accept="image/*" capture="environment" disabled={Boolean(busyMoment)}
            aria-label={`Foto ${moment.label.toLowerCase()} del trabajo`}
            onChange={(event) => { const [file] = event.target.files; event.target.value = ""; upload(moment.id, file); }} />
          <span><Camera size={16} aria-hidden="true" />{busyMoment === moment.id ? "Subiendo..." : `Foto ${moment.label.toLowerCase()}`}</span>
        </label>;
      })}
    </div>
    {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    <ResponsiveDialog open={Boolean(viewer)} onClose={() => setViewer(null)} size="medium" eyebrow="Trabajo"
      title={viewer ? `Foto ${viewer.moment.label.toLowerCase()}` : "Foto"} description={viewer ? stampLabel(viewer.photo) : ""}
      footer={<Button type="button" variant="secondary" onClick={() => setViewer(null)}>Cerrar</Button>}>
      {viewer?.loading && <LoadingState variant="section" label="Cargando foto..." />}
      {viewer?.error && <div className="vehicle-message vehicle-message--error" role="alert">{viewer.error}</div>}
      {viewer?.source && <div className="work-order-capture__photo">
        <img src={viewer.source} alt={`Foto ${viewer.moment.label.toLowerCase()} del trabajo`} draggable={false} />
      </div>}
    </ResponsiveDialog>
  </div>;
}
