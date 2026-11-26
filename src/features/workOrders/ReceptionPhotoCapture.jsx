import React, {useState} from "react";
import {Camera, Check, RefreshCw, Trash2} from "lucide-react";
import Button from "../../components/ui/Button";
import {getWorkOrderErrorMessage, subirFotoRecepcionOT} from "../../services/workOrderService";
import {receptionImageAsJpeg} from "./receptionPhotoImage";
import CarSilhouette from "./CarSilhouette";
import {getZoneGuideShape} from "./receptionVehicleShapes";

const CORNERS = "M12 36V12H36M284 12H308V36M308 184V208H284M36 208H12V184";

function GuidePart({part}) {
  const className = `work-order-guide work-order-guide--${part.role}`;
  return part.d ? <path className={className} d={part.d} /> : <circle className={className} cx={part.cx} cy={part.cy} r={part.r} />;
}

// Lienzo de encuadre: contorno de la zona (o marco del tablero) y esquinas de la cámara.
function GuideStage({zone}) {
  const shape = getZoneGuideShape(zone.id);
  const parts = shape?.parts.map((part, index) => <GuidePart key={index} part={part} />);
  return <svg className="work-order-capture__stage" viewBox="0 0 320 220" role="img"
    aria-label={shape ? `Guía de encuadre: ${zone.label}` : "Guía de encuadre del tablero"}>
    {shape && (shape.mirror ? <g transform="translate(320,0) scale(-1,1)">{parts}</g> : parts)}
    {!shape && <rect className="work-order-guide work-order-guide--body" x="40" y="50" width="240" height="120" rx="18" />}
    <path className="work-order-capture__corners" d={CORNERS} />
    <text className="work-order-capture__hint" x="160" y="30" textAnchor="middle">
      {shape ? "Alinea el vehículo con el contorno" : "Encuadra el tablero completo"}
    </text>
  </svg>;
}

// Foto con las marcas de daño numeradas. Con onAdd, tocar la foto agrega una marca en ese punto.
export function PhotoWithMarks({alt, marks = [], onAdd, src}) {
  const add = (event) => {
    if (!onAdd) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    onAdd({x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000});
  };
  return <div className="work-order-capture__photo" data-marking={onAdd ? "true" : undefined}>
    <img src={src} alt={alt} onClick={add} draggable={false} />
    {marks.map((mark, index) => <span key={index} className="work-order-capture__pin" aria-hidden="true"
      style={{left: `${mark.x * 100}%`, top: `${mark.y * 100}%`}}>{index + 1}</span>)}
  </div>;
}

// Captura guiada (prototipo «Panel del Taller»): encuadre, revisión, estado de daños y zona guardada.
// El tablero no registra daños: pasa de la revisión a guardar.
// Con `onUpload` se reutiliza para otras fotos selladas (la entrega): sube con esa función y sin estado de daños.
export default function ReceptionPhotoCapture({businessId, otId, zone, zoneNumber, onCancel, onDone, onSaved, onUpload, label}) {
  const isVehicleZone = Boolean(getZoneGuideShape(zone.id)) && !onUpload;
  const hasGuide = Boolean(getZoneGuideShape(zone.id));
  const stepCount = isVehicleZone ? 3 : 2;
  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState(null);
  const [damaged, setDamaged] = useState(null);
  const [marks, setMarks] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const take = async (file) => {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      const base64 = await receptionImageAsJpeg(file);
      setPhoto({base64, src: `data:image/jpeg;base64,${base64}`});
      setStep(1);
    } catch (conversionError) { setError(conversionError.message); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (busy) return;
    if (isVehicleZone) {
      if (damaged === null) { setError("Indica si la zona tiene daños."); return; }
      if (damaged && !marks.length) { setError("Marca al menos un daño sobre la foto."); return; }
      if (damaged && marks.some((mark) => !mark.nota.trim())) { setError("Escribe una nota en cada marca."); return; }
    }
    setBusy(true); setError("");
    try {
      const danos = isVehicleZone ? {conDanos: damaged, marcas: damaged ? marks.map((mark) => ({...mark, nota: mark.nota.trim()})) : []} : undefined;
      if (onUpload) await onUpload(photo.base64);
      else await subirFotoRecepcionOT(businessId, otId, zone.id, photo.base64, danos);
      // Al guardar, se vuelve directo a la selección de zonas (la foto queda sellada con fecha y usuario).
      await onSaved();
      onDone();
    } catch (saveError) { setError(getWorkOrderErrorMessage(saveError)); }
    finally { setBusy(false); }
  };

  const repeat = () => { setPhoto(null); setDamaged(null); setMarks([]); setError(""); setStep(0); };

  return <div className="work-order-capture">
    <div className="work-order-capture__header">
      <strong>{zone.label}</strong>
      <span>{label || (isVehicleZone ? `Zona ${zoneNumber} de 6` : "Foto obligatoria")}</span>
    </div>
    <ol className="work-order-capture__steps" aria-label={`Paso ${Math.min(step, stepCount - 1) + 1} de ${stepCount}`}>
      {Array.from({length: stepCount}, (_, index) => <li key={index} data-on={index <= step ? "true" : undefined} />)}
    </ol>

    {step === 0 && <>
      <GuideStage zone={zone} />
      <div className="work-order-capture__guide">{hasGuide && <CarSilhouette mini activeZoneId={zone.id} />}<span>{zone.guide}</span></div>
      <label className="work-order-capture__take">
        <input type="file" accept="image/*" capture="environment" disabled={busy}
          onChange={(event) => { const [file] = event.target.files || []; event.target.value = ""; take(file); }} />
        <span><Camera size={18} aria-hidden="true" />{busy ? "Preparando foto..." : "Tomar foto"}</span>
      </label>
    </>}

    {step === 1 && photo && <>
      <PhotoWithMarks src={photo.src} alt={`Foto tomada: ${zone.label}`} />
      <p className="erp-secondary-text">¿Se ve completa y nítida la zona?</p>
      <div className="work-order-capture__pair">
        <Button type="button" variant="secondary" icon={RefreshCw} disabled={busy} onClick={repeat}>Repetir</Button>
        <Button type="button" icon={Check} disabled={busy} onClick={() => (isVehicleZone ? setStep(2) : save())}>
          {busy ? "Guardando..." : "Aceptar"}</Button>
      </div>
    </>}

    {step === 2 && isVehicleZone && photo && <>
      <PhotoWithMarks src={photo.src} alt={`Foto tomada: ${zone.label}`} marks={marks}
        onAdd={damaged ? (point) => { setMarks((current) => [...current, {...point, nota: ""}]); setError(""); } : null} />
      <p className="erp-secondary-text">Estado de esta zona</p>
      <div className="work-order-capture__pair">
        <button type="button" className="work-order-capture__choice" data-tone="success" aria-pressed={damaged === false}
          onClick={() => { setDamaged(false); setMarks([]); setError(""); }}>Sin daños</button>
        <button type="button" className="work-order-capture__choice" data-tone="danger" aria-pressed={damaged === true}
          onClick={() => { setDamaged(true); setError(""); }}>Con daños</button>
      </div>
      {damaged && <>
        <p className="erp-secondary-text">Toca la foto para marcar cada daño y escribe una nota.</p>
        {marks.map((mark, index) => <div key={index} className="work-order-capture__mark">
          <b aria-hidden="true">{index + 1}</b>
          <input className="erp-control" aria-label={`Nota del daño ${index + 1}`} placeholder="rayón de 15 cm" maxLength={200}
            onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
            value={mark.nota} onChange={(event) => { const nota = event.target.value; setMarks((current) => current.map((item, position) => position === index ? {...item, nota} : item)); setError(""); }} />
          <Button type="button" variant="secondary" icon={Trash2} aria-label={`Quitar daño ${index + 1}`}
            onClick={() => setMarks((current) => current.filter((_, position) => position !== index))} />
        </div>)}
        <Button type="button" variant="secondary" disabled={marks.length >= 20}
          onClick={() => setMarks((current) => [...current, {x: 0.5, y: 0.5, nota: ""}])}>Marcar daño en el centro</Button>
      </>}
      <Button type="button" disabled={busy} onClick={save}>{busy ? "Guardando..." : "Guardar y volver a la silueta"}</Button>
    </>}

    {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    <div className="work-order-capture__cancel">
      <button type="button" className="work-order-link-button" disabled={busy} onClick={onCancel}>Cancelar captura</button>
    </div>
  </div>;
}
