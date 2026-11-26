import React, {useEffect, useId, useRef, useState} from "react";
import Button from "../../../components/ui/Button";
import LoadingState from "../../../components/ui/LoadingState";
import "./veterinary-photo-map.css";
import {operarFotoVeterinaria} from "../data/veterinaryDataService";

const views = {
  general: "General", frontal: "Frontal", "lateral-izquierda": "Lateral izquierda",
  "lateral-derecha": "Lateral derecha", trasera: "Trasera", superior: "Superior",
  inferior: "Inferior", detalle: "Detalle",
};

const acceptedImageTypes = ["image/jpeg", "image/png", "image/webp"];
// La foto original puede pesar hasta 20 MiB: el navegador la convierte a JPEG y la reduce hasta que cabe en
// 2 MiB. El límite de 2 MiB se aplica a la imagen que se guarda (la Function también lo comprueba).
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
const MAX_STORED_BYTES = 2 * 1024 * 1024;

function formatMiB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",") + " MiB";
}
const bodyViewOrder = Object.keys(views).filter((key) => key !== "detalle");

function fileProblem(file) {
  if (!acceptedImageTypes.includes(file.type)) {
    return "Archivo incompatible. Selecciona una imagen JPEG, PNG o WebP.";
  }
  if (!file.size || file.size > MAX_ORIGINAL_BYTES) {
    return "La foto debe tener contenido y pesar como máximo 20 MiB. Se guarda reducida a un JPEG de hasta 2 MiB.";
  }
  return "";
}

async function imageAsJpeg(file) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("No se pudo leer la imagen. Comprueba que sea un JPEG, PNG o WebP válido.");
  });
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", {alpha: false});
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.45]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob || blob.type !== "image/jpeg" || !blob.size) {
        throw new Error("No se pudo convertir la foto a JPEG. Prueba con otra imagen o navegador.");
      }
      if (blob.size <= 2 * 1024 * 1024) {
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("No se pudo preparar la foto para subirla."));
          reader.readAsDataURL(blob);
        });
      }
    }
    throw new Error("El JPEG convertido supera los 2 MiB. Reduce el tamaño de la imagen o elige otra foto.");
  } finally {
    bitmap.close();
  }
}

function PhotoMapper({businessId, attentionId, photo, closed}) {
  const [source, setSource] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const turn = photo.giro ?? 0;
  const [revision, setRevision] = useState(photo.revision ?? 0);
  const [zoom, setZoom] = useState(1);
  const [marks, setMarks] = useState(photo.marcas ?? []);
  const [focus, setFocus] = useState(null);
  const [point, setPoint] = useState(null);
  const [region, setRegion] = useState("");
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const imageGroup = useRef(null);

  useEffect(() => {
    let active = true;
    let url;
    async function load() {
      try {
        const {imagen} = await operarFotoVeterinaria(businessId, attentionId, photo.fotoId, "leer");
        if (!active) return;
        const bytes = Uint8Array.from(atob(imagen), (char) => char.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], {type: "image/jpeg"}));
        const img = new Image();
        img.src = url;
        await img.decode();
        if (active) setSource({url, width: img.naturalWidth, height: img.naturalHeight});
      } catch {
        if (active) setLoadError("No se pudo abrir esta foto clínica.");
      }
    }
    load();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [businessId, attentionId, photo.fotoId]);

  if (loadError) return <p role="alert">{loadError}</p>;
  if (!source) return <LoadingState variant="section" label="Cargando foto clínica..." />;

  const {width, height, url} = source;
  const vertical = turn % 180 !== 0;
  const frameWidth = vertical ? height : width;
  const frameHeight = vertical ? width : height;
  const radians = turn * Math.PI / 180;
  const pointInFrame = (mark) => {
    const x = (mark.x - 0.5) * width;
    const y = (mark.y - 0.5) * height;
    return {x: frameWidth / 2 + x * Math.cos(radians) - y * Math.sin(radians), y: frameHeight / 2 + x * Math.sin(radians) + y * Math.cos(radians)};
  };
  const center = focus ? pointInFrame(focus) : {x: frameWidth / 2, y: frameHeight / 2};
  const viewWidth = frameWidth / zoom;
  const viewHeight = frameHeight / zoom;
  const left = Math.max(0, Math.min(frameWidth - viewWidth, center.x - viewWidth / 2));
  const top = Math.max(0, Math.min(frameHeight - viewHeight, center.y - viewHeight / 2));
  const radius = Math.max(width, height) / (85 * zoom);
  const place = (event) => {
    if (closed || !placing) return;
    const matrix = imageGroup.current?.getScreenCTM();
    if (!matrix) return;
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    if (position.x < 0 || position.x > width || position.y < 0 || position.y > height) return;
    setPoint({x: position.x / width, y: position.y / height});
    setPlacing(false);
  };
  const selectMark = (mark) => {
    setFocus(mark);
    setZoom(3);
  };
  const addMark = () => {
    if (!point || !region.trim() || marks.length >= 20) return;
    const mark = {...point, zona: region.trim(), nota: note.trim()};
    setMarks((current) => [...current, mark]);
    setPoint(null);
    setRegion("");
    setNote("");
    setDirty(true);
    setSaved(false);
    selectMark(mark);
  };
  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const result = await operarFotoVeterinaria(businessId, attentionId, photo.fotoId, "mapear", {marcas: marks, giro: turn, revision});
      setRevision(result.revision);
      setDirty(false);
      setSaved(true);
    } catch (failure) {
      setError(String(failure?.code).endsWith("failed-precondition") ? failure.message : "No se pudieron guardar las marcas de esta foto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="erp-panel">
      <h3>{views[photo.vista] ?? "Foto clínica"}</h3>
      <div className="veterinary-photo-tools">
        <Button type="button" variant="secondary" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - 0.5))}>Reducir</Button>
        <Button type="button" variant="secondary" disabled={zoom >= 5} onClick={() => setZoom(Math.min(5, zoom + 0.5))}>Ampliar</Button>
        <Button type="button" variant="secondary" onClick={() => {setFocus(null); setZoom(1);}}>Vista completa</Button>
        {!closed && <Button type="button" variant="secondary" disabled={saving || marks.length >= 20}
          onClick={() => {setPoint(null); setPlacing(true);}}>Marcar lesión</Button>}
      </div>
      {placing && <p role="status">Haz clic en la zona de la lesión sobre la foto.</p>}
      <svg className="veterinary-photo-view" data-body-view={photo.vista} aria-label={"Foto " + (views[photo.vista] ?? "clínica")} role="img"
        viewBox={[left, top, viewWidth, viewHeight].join(" ")} onClick={place}>
        <g ref={imageGroup} transform={`translate(${frameWidth / 2} ${frameHeight / 2}) rotate(${turn}) translate(${-width / 2} ${-height / 2})`}>
          <image href={url} width={width} height={height} />
          {[...marks, ...(point ? [point] : [])].map((mark, index) => (
            <circle className="veterinary-photo-mark" key={index} cx={mark.x * width} cy={mark.y * height} r={radius} strokeWidth={radius / 3} />
          ))}
        </g>
      </svg>
      {!closed && point && (
        <div className="erp-form-grid">
          <label className="erp-field"><span>Zona del cuerpo</span>
            <input className="erp-control" maxLength={100} value={region} onChange={({target}) => setRegion(target.value)} placeholder="Pata trasera izquierda" />
          </label>
          <label className="erp-field"><span>Observación de la lesión</span>
            <textarea className="erp-control" maxLength={500} value={note} onChange={({target}) => setNote(target.value)} />
          </label>
          <Button type="button" disabled={!region.trim() || saving} onClick={addMark}>Añadir marca</Button>
        </div>
      )}
      {marks.length > 0 && <ul>{marks.map((mark, index) => (
        <li key={index}>
          <Button type="button" variant="secondary" onClick={() => selectMark(mark)}>Enfocar {mark.zona}</Button>
          {mark.nota && <span> {mark.nota}</span>}
          {!closed && <Button type="button" variant="secondary" disabled={saving} aria-label={"Quitar marca de " + mark.zona}
            onClick={() => {setMarks(marks.filter((_, item) => item !== index)); setDirty(true); setSaved(false);}}>Quitar marca</Button>}
        </li>
      ))}</ul>}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">Mapa de la foto guardado.</p>}
      {!closed && <Button type="button" loading={saving} disabled={!dirty} onClick={save}>Guardar mapa de la foto</Button>}
    </div>
  );
}

export default function VeterinaryPhotoMap({businessId, attention, onPendingChange}) {
  const [selected, setSelected] = useState("");
  const [view, setView] = useState(() =>
    bodyViewOrder.find((key) => !attention.fotosClinicas?.some((item) => item.vista === key)) ?? "general"
  );
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [removeId, setRemoveId] = useState("");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadResult, setUploadResult] = useState(null);
  const fileErrorId = useId();

  const photos = attention.fotosClinicas ?? [];
  const photo = photos.find((item) => item.fotoId === selected) ?? photos[0];
  const photosByView = new Map();
  for (const item of photos) {
    const group = photosByView.get(item.vista) ?? [];
    group.push(item);
    photosByView.set(item.vista, group);
  }
  const alternatives = photosByView.get(photo?.vista) ?? [];
  const closed = attention.estado !== "en_atencion";
  const photoCount = new Set([...photos, ...pendingPhotos].map((item) => item.fotoId)).size;
  const hasPending = pendingPhotos.length > 0;
  const pendingViews = new Set(pendingPhotos.map((item) => item.vista));
  const missingViews = bodyViewOrder.filter((key) => !photosByView.has(key));
  const missingLabels = missingViews.map((key) =>
    views[key] + (pendingViews.has(key) ? " (en lista, pendiente de subir)" : "")
  );

  const clearStatus = () => {
    setUploadStatus("");
    setUploadResult(null);
  };

  useEffect(() => {
    onPendingChange?.(hasPending);
  }, [hasPending, onPendingChange]);

  function selectFile(event) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file || closed || uploading || removing) return;

    clearStatus();
    const problem = fileProblem(file);
    if (problem || photoCount >= 12) {
      setError(problem || "Puedes guardar hasta 12 fotos por atención.");
      return;
    }

    setError("");
    setPendingPhotos((current) => [...current, {file, vista: view, fotoId: crypto.randomUUID()}]);
    const nextView = view === "detalle" ? undefined
      : bodyViewOrder.slice(bodyViewOrder.indexOf(view) + 1).find((key) =>
        !photosByView.has(key) && !pendingPhotos.some((item) => item.vista === key)
      );
    if (nextView) setView(nextView);
  }

  function removePending(photo) {
    setPendingPhotos((current) => current.filter((item) => item.fotoId !== photo.fotoId));
    setView(photo.vista);
    setError("");
    clearStatus();
  }

  async function removeSavedPhoto() {
    if (closed || removing || uploading || removeId !== photo?.fotoId) return;
    setRemoving(true);
    setError("");
    clearStatus();
    try {
      await operarFotoVeterinaria(businessId, attention.id, photo.fotoId, "quitar");
      setView(photo.vista);
      setRemoveId("");
      setUploadStatus("Foto retirada de la atención.");
    } catch {
      setError("No se pudo quitar la foto. Intenta nuevamente.");
    } finally {
      setRemoving(false);
    }
  }

  async function upload(event) {
    event.preventDefault();
    if (closed || !hasPending || uploading || removing) return;
    setUploading(true);
    setError("");
    clearStatus();

    let uploaded = 0;
    const reductions = [];
    const failures = [];
    try {
      for (const item of pendingPhotos) {
        try {
          const imagen = await imageAsJpeg(item.file);
          const storedBytes = Math.floor(imagen.length * 3 / 4);
          if (item.file.size > MAX_STORED_BYTES) {
            reductions.push(item.file.name + " pesaba " + formatMiB(item.file.size) + " y se redujo a " +
              formatMiB(storedBytes) + " para cumplir el límite de 2 MiB.");
          }
          await operarFotoVeterinaria(businessId, attention.id, item.fotoId, "subir", {vista: item.vista, imagen});
          setPendingPhotos((current) => current.filter((entry) => entry.fotoId !== item.fotoId));
          setSelected(item.fotoId);
          uploaded += 1;
        } catch (failure) {
          const code = String(failure?.code ?? "");
          const message = !code || code.endsWith("failed-precondition") || code.endsWith("invalid-argument")
            ? failure.message : "No se pudo subir. Intenta nuevamente.";
          failures.push(views[item.vista] + " (" + item.file.name + "): " + message);
        }
      }
      if (uploaded) setUploadResult({count: uploaded, reductions});
      if (failures.length) setError("Quedaron fotos pendientes. " + failures.join(" "));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="erp-panel">
      <h2>{closed ? "Fotos clínicas" : "Fotos y mapa corporal de la mascota"}</h2>
      {!closed && (
        <>
          <p>Agrega fotos de esta mascota desde distintos ángulos. Elige un lado para cambiar de vista y marca la lesión sobre la foto correspondiente.</p>
          <p role="status">
            {missingLabels.length
              ? "Vistas que faltan por subir: " + missingLabels.join(", ") + "."
              : <strong>TODAS LAS IMÁGENES DISPONIBLES</strong>}
          </p>
        </>
      )}
      {!closed && (photos.length < 12 || hasPending) && (
        <form className="erp-form" onSubmit={upload}>
          <div className="erp-form-grid">
            <label className="erp-field"><span>Vista del cuerpo</span>
              <select className="erp-control" value={view} disabled={uploading} onChange={({target}) => {setView(target.value); clearStatus();}}>
                {Object.entries(views).map(([value, label]) => <option key={value} value={value}>{value === "detalle" ? "Detalle (opcional)" : label}</option>)}
              </select>
            </label>
            <label className="erp-field"><span>Foto de la mascota</span>
              <input className="erp-control" type="file" accept={acceptedImageTypes.join(",")}
                aria-describedby={error ? fileErrorId : undefined}
                disabled={uploading || removing || photoCount >= 12} onChange={selectFile} />
              <small>JPEG, PNG o WebP. Se guarda como JPEG de hasta 2 MiB: si pesa más, se reduce automáticamente.</small>
            </label>
          </div>
          {hasPending && (
            <div>
              <h3>Fotos pendientes de subir</h3>
              <ul>
                {pendingPhotos.map((item) => (
                  <li key={item.fotoId}>
                    {views[item.vista]} · {item.file.name}{" "}
                    <Button type="button" variant="secondary" disabled={uploading}
                      aria-label={"Quitar foto de " + views[item.vista]} onClick={() => removePending(item)}>Quitar</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button type="submit" loading={uploading} disabled={!hasPending || removing}>Subir todas las fotos</Button>
        </form>
      )}
      {error && <p id={fileErrorId} role="alert">{error}</p>}
      {uploadStatus && <p role="status">{uploadStatus}</p>}
      {uploadResult && (
        <p role="status">
          {uploadResult.count === 1 ? "1 foto subida." : uploadResult.count + " fotos subidas."}
          {" "}Fotos guardadas en la atención: {photos.length} de 12.
          {uploadResult.reductions.map((message) => " " + message).join("")}
        </p>
      )}
      {!photos.length && <p>{closed ? "Esta atención no tiene fotos clínicas." : "Esta atención aún no tiene fotos clínicas."}</p>}
      {photo && (
        <>
          <div className="veterinary-photo-tools" role="group" aria-label="Vistas del cuerpo">
            {Object.entries(views).filter(([key]) => !closed || photosByView.has(key)).map(([key, label]) => {
              const group = photosByView.get(key);
              const active = photo.vista === key;
              return (
                <Button key={key} type="button" variant={active ? "primary" : "secondary"}
                  aria-pressed={active} disabled={!group?.length}
                  title={group?.length || closed ? undefined : "Agrega una foto de esta vista"}
                  onClick={() => {if (!active && group?.length) setSelected(group[0].fotoId);}}>
                  {label}
                </Button>
              );
            })}
          </div>
          {alternatives.length > 1 && (
            <label className="erp-field"><span>Foto de esta vista</span>
              <select className="erp-control" value={photo.fotoId} onChange={({target}) => setSelected(target.value)}>
                {alternatives.map((item, index) => <option key={item.fotoId} value={item.fotoId}>Foto {index + 1}</option>)}
              </select>
            </label>
          )}
          {!closed && (removeId === photo.fotoId ? (
            <div>
              <p>¿Quitar esta foto y sus marcas del mapa corporal?</p>
              <Button type="button" loading={removing} onClick={removeSavedPhoto}>Confirmar retiro</Button>
              <Button type="button" variant="secondary" disabled={removing} onClick={() => setRemoveId("")}>Conservar foto</Button>
            </div>
          ) : (
            <Button type="button" variant="secondary" disabled={uploading || removing}
              onClick={() => setRemoveId(photo.fotoId)}>Quitar foto guardada</Button>
          ))}
          <PhotoMapper key={photo.fotoId} businessId={businessId} attentionId={attention.id} photo={photo} closed={closed} />
        </>
      )}
    </section>
  );
}
