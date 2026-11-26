import React, {useCallback, useEffect, useState} from "react";
import {Camera, Eye} from "lucide-react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import StatusBadge from "../../components/ui/StatusBadge";
import {
  convertirHallazgoOT, createWorkOrderRequestId, getWorkOrderErrorMessage, leerFotoHallazgoOT,
  listarHallazgosOT, reportarHallazgoOT,
} from "../../services/workOrderService";
import {receptionImageAsJpeg} from "./receptionPhotoImage";

const EMPTY_DRAFT = {descripcion: "", urgente: null, imagen: "", nombreFoto: ""};

// Hallazgos de la ejecución (prototipo): observaciones fuera del motivo de ingreso; la foto es opcional.
// Solo se vuelven trabajo si el cliente decide hacerlo; esa decisión la registra un Owner o Administrador.
export default function ExecutionFindings({
  businessId, canConvert, canReport, onConverted, otId, revision, running, serviceOptions,
}) {
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [requestId, setRequestId] = useState(() => createWorkOrderRequestId());
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState({});
  const [viewer, setViewer] = useState(null);

  const load = useCallback(async () => {
    try { setFindings(await listarHallazgosOT(businessId, otId)); setError(""); }
    catch (failure) { setError(getWorkOrderErrorMessage(failure)); }
    finally { setLoading(false); }
  }, [businessId, otId]);
  useEffect(() => { void load(); }, [load, revision]);

  const takePhoto = async (file) => {
    if (!file || busy) return;
    setError("");
    try {
      const imagen = await receptionImageAsJpeg(file);
      setDraft((current) => ({...current, imagen, nombreFoto: file.name || "Foto tomada"}));
    } catch (photoError) { setError(photoError.message); }
  };

  const save = async () => {
    if (busy) return;
    if (!draft.descripcion.trim() || draft.urgente === null) {
      setError("Completa la descripción y la prioridad del hallazgo.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      await reportarHallazgoOT(businessId, otId, draft, requestId);
      setDraft(EMPTY_DRAFT); setRequestId(createWorkOrderRequestId()); setOpen(false);
      setNotice("Hallazgo reportado.");
      await load();
    } catch (failure) { setError(getWorkOrderErrorMessage(failure)); }
    finally { setBusy(false); }
  };

  const convert = async (finding) => {
    const itemId = choices[finding.hallazgoId];
    if (busy) return;
    if (!itemId) { setError("Elige el servicio del catálogo para el trabajo."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await convertirHallazgoOT(businessId, otId, finding.hallazgoId, itemId, createWorkOrderRequestId());
      setNotice("Hallazgo agregado como trabajo.");
      await Promise.all([load(), onConverted()]);
    } catch (failure) { setError(getWorkOrderErrorMessage(failure)); }
    finally { setBusy(false); }
  };

  const viewPhoto = async (finding) => {
    setViewer({finding, source: "", loading: true, error: ""});
    try {
      const response = await leerFotoHallazgoOT(businessId, otId, finding.hallazgoId);
      setViewer({finding, source: `data:image/jpeg;base64,${response.imagen}`, loading: false, error: "",
        stamp: response.subidaPorNombre});
    } catch (failure) { setViewer({finding, source: "", loading: false, error: getWorkOrderErrorMessage(failure)}); }
  };

  return <section className="erp-panel work-order-reception-card" aria-labelledby="work-order-findings-title">
    <div className="work-order-reception-card__header">
      <h2 id="work-order-findings-title" className="erp-panel-title">Hallazgos</h2>
      {running && canReport && <Button type="button" variant="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "Cerrar" : "Reportar"}</Button>}
    </div>
    {error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    {notice && <div className="vehicle-message" role="status">{notice}</div>}
    {open && <div className="work-order-finding-form">
      <label className="erp-field"><span className="erp-field__label">¿Qué encontraste?</span>
        <textarea className="erp-control" rows={2} maxLength={500} value={draft.descripcion} disabled={busy}
          onChange={(event) => setDraft((current) => ({...current, descripcion: event.target.value}))} /></label>
      <div className="work-order-chip-row">
        <Button type="button" variant={draft.urgente === true ? "primary" : "secondary"} aria-pressed={draft.urgente === true}
          disabled={busy} onClick={() => setDraft((current) => ({...current, urgente: true}))}>Urgente · seguridad</Button>
        <Button type="button" variant={draft.urgente === false ? "primary" : "secondary"} aria-pressed={draft.urgente === false}
          disabled={busy} onClick={() => setDraft((current) => ({...current, urgente: false}))}>Recomendado</Button>
        <label className="work-order-capture__take work-order-work__take">
          <input type="file" accept="image/*" capture="environment" disabled={busy} aria-label="Foto del hallazgo"
            onChange={(event) => { const [file] = event.target.files; event.target.value = ""; takePhoto(file); }} />
          <span><Camera size={16} aria-hidden="true" />{draft.imagen ? "Foto tomada" : "Foto (opcional)"}</span>
        </label>
      </div>
      <div className="vehicle-form-actions">
        <Button type="button" disabled={busy} onClick={save}>{busy ? "Guardando..." : "Guardar hallazgo"}</Button>
      </div>
    </div>}
    {loading && <LoadingState variant="section" label="Cargando hallazgos..." />}
    {!loading && !findings.length && <p className="erp-secondary-text">Aún no hay hallazgos reportados.</p>}
    <ul className="work-order-findings">
      {findings.map((finding) => <li key={finding.hallazgoId} className="work-order-finding">
        <p>{finding.descripcion}</p>
        <div className="work-order-chip-row">
          <StatusBadge variant={finding.urgente ? "danger" : "neutral"}>{finding.urgente ? "Urgente" : "Recomendado"}</StatusBadge>
          <StatusBadge variant={finding.convertido ? "success" : "neutral"}>{finding.convertido ? "Convertido en trabajo" : "Observación"}</StatusBadge>
          {finding.tieneFoto
            ? <Button type="button" variant="secondary" icon={Eye} onClick={() => viewPhoto(finding)}>Evidencia · {finding.reportadoPorNombre}</Button>
            : <span className="erp-secondary-text">Sin foto · {finding.reportadoPorNombre}</span>}
        </div>
        {running && canConvert && !finding.convertido && <div className="work-order-finding__convert">
          <select className="erp-control" aria-label="Servicio para el hallazgo" value={choices[finding.hallazgoId] || ""} disabled={busy}
            onChange={(event) => setChoices((current) => ({...current, [finding.hallazgoId]: event.target.value}))}>
            <option value="">El cliente decide trabajarlo: elige servicio</option>
            {serviceOptions.map((item) => <option key={item.itemId} value={item.itemId}>{item.nombre}</option>)}
          </select>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => convert(finding)}>Agregar como trabajo</Button>
        </div>}
      </li>)}
    </ul>
    <ResponsiveDialog open={Boolean(viewer)} onClose={() => setViewer(null)} size="medium" eyebrow="Hallazgo"
      title="Evidencia del hallazgo" description={viewer?.finding ? `${viewer.finding.reportadoPorNombre} · No editable` : ""}
      footer={<Button type="button" variant="secondary" onClick={() => setViewer(null)}>Cerrar</Button>}>
      {viewer?.loading && <LoadingState variant="section" label="Cargando foto..." />}
      {viewer?.error && <div className="vehicle-message vehicle-message--error" role="alert">{viewer.error}</div>}
      {viewer?.source && <div className="work-order-capture__photo"><img src={viewer.source} alt="Evidencia del hallazgo" draggable={false} /></div>}
    </ResponsiveDialog>
  </section>;
}
