import React, {useRef, useState} from "react";
import {Camera, Paperclip} from "lucide-react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import Notice from "../../components/ui/Notice";
import {fitEvidenceImageToLimit} from "../../utils/evidenceImage.mjs";
import {MAX_WORK_EXPENSE_EVIDENCE_BYTES, WORK_EXPENSE_DOCUMENT_TYPES, WORK_EXPENSE_EVIDENCE_TYPES, buildWorkExpenseEvidenceFileName, validateWorkExpenseEvidenceSelection} from "../../domain/workModel.mjs";
import {CostField, CostMoneyInput, WorkFormError} from "./WorkCostParts.jsx";
import useWorkFormSubmit from "./useWorkFormSubmit.js";

// Compra al paso (pestaña Materiales, bajo "Nueva salida de material"): material comprado directo para la obra
// que nunca pasó por bodega. Registra UN gasto de categoría MATERIAL con su documento (boleta o factura) y su
// archivo adjunto OBLIGATORIO; no crea ningún producto ni mueve inventario.
//
// Va en dos pasos, porque así funciona hoy la evidencia de gastos (SPEC 020 §8/§9): el gasto se crea en el
// servidor y luego el archivo se sube a Storage y se registra con adjuntarEvidenciaGastoTrabajo. Si el gasto se
// crea y el archivo falla, el gasto queda registrado: el formulario lo dice con un aviso propio, bloquea los campos
// del gasto y ofrece reintentar SOLO el adjunto (mismo requestId y mismo nombre de archivo mientras no cambie el
// archivo), así un reintento nunca duplica el gasto ni el adjunto. Que el adjunto sea obligatorio lo exige esta
// interfaz; el servidor no puede exigirlo porque el gasto existe antes de que se suba el archivo.
//
// Presentacional: no importa servicios ni Firebase. `onRegister(payload, {requestId, onError})` devuelve una
// promesa con el id del gasto creado ("" si falló) y `onUpload(expenseId, file, {requestId, fileName, onError})`
// una con true si el adjunto quedó registrado; los resuelve la página (WorksPage.jsx).

export const WORK_QUICK_PURCHASE_TOGGLE_LABEL = "¿No está en inventario? Registrar compra al paso";
export const WORK_QUICK_PURCHASE_DOCUMENT_LABELS = Object.freeze({boleta: "Boleta", factura: "Factura"});
const MAX_AMOUNT = 999999999999.99;
// Ayuda bajo el monto. El texto con la lógica tributaria (neto sin IVA en factura; IVA de la boleta no recuperable) es de
// Chile (SPEC 023 §9.2): solo se muestra si la empresa es de Chile (`paisCodigo` "CL", que App.jsx entrega como
// `countryCode`, igual que a Veterinaria). Con otro país, o sin país informado, el texto es neutro.
export const WORK_QUICK_PURCHASE_NEUTRAL_AMOUNT_HINT = "Ingresa el monto del documento.";
const CHILE_DOCUMENT_HINTS = Object.freeze({
  factura: "Ingresa el neto de la factura, sin IVA.",
  boleta: "Ingresa lo que pagaste. En boleta el IVA no se recupera.",
});

export function getQuickPurchaseAmountHint(documentType, countryCode) {
  const isChile = String(countryCode || "").trim().toUpperCase() === "CL";
  return (isChile && CHILE_DOCUMENT_HINTS[documentType]) || WORK_QUICK_PURCHASE_NEUTRAL_AMOUNT_HINT;
}

// Errores por campo del borrador (vacío = válido). El archivo se valida aparte (validateWorkExpenseEvidenceSelection).
export function getQuickPurchaseDraftErrors(draft = {}) {
  const errors = {};
  if (!String(draft.concepto || "").trim()) errors.concepto = "Escribe qué compraste.";
  const amount = String(draft.monto ?? "").trim() === "" ? NaN : Number(draft.monto);
  if (!(Number.isFinite(amount) && amount > 0)) errors.monto = "Ingresa un monto mayor que cero.";
  else if (amount > MAX_AMOUNT) errors.monto = "El monto es demasiado alto.";
  if (!String(draft.fecha || "").trim()) errors.fecha = "Indica la fecha de la compra.";
  if (!WORK_EXPENSE_DOCUMENT_TYPES.includes(draft.tipoDocumento)) errors.tipoDocumento = "Elige boleta o factura.";
  return errors;
}

// El gasto que recibe registrarGastoTrabajo: categoría MATERIAL, con su documento.
export function buildQuickPurchaseExpense(draft = {}, {responsableDelGastoUid = ""} = {}) {
  return {
    concepto: String(draft.concepto || "").trim(),
    monto: draft.monto,
    categoria: "MATERIAL",
    responsableDelGastoUid,
    fecha: draft.fecha,
    observacion: "",
    tareaId: draft.tareaId || "",
    tipoDocumento: draft.tipoDocumento,
    numeroDocumento: String(draft.numeroDocumento || "").trim(),
  };
}

// Los dos pasos de la compra al paso, sin React (se prueba solo). `createSubmit` y `uploadSubmit` son el `submit` de
// useWorkFormSubmit de cada paso (requestId estable y error dentro del formulario). Con `createdExpenseId` el gasto ya
// existe y solo se reintenta el adjunto. Devuelve {status, expenseId}: "registro-fallido" (nada se creó),
// "adjunto-fallido" (el gasto quedó; reintentar solo el adjunto) o "listo".
export async function submitQuickPurchase({createdExpenseId = "", file, fileName, onRegister, onUpload, payload, createSubmit, uploadSubmit}) {
  let expenseId = createdExpenseId;
  if (!expenseId) {
    const registered = await createSubmit(payload, (requestId, onError) => onRegister(payload, {onError, requestId}).then((id) => { expenseId = id || ""; return Boolean(id); }));
    if (!registered) return {status: "registro-fallido", expenseId: ""};
  }
  const uploaded = await uploadSubmit({expenseId, fileName, size: file.size, type: file.type}, (requestId, onError) => onUpload(expenseId, file, {fileName, onError, requestId}));
  return {status: uploaded ? "listo" : "adjunto-fallido", expenseId};
}

const fileSizeLabel = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export default function WorkQuickPurchase({countryCode, currency, defaultOpen = false, fixedTaskId = "", locale, onRegister, onUpload, processing = "", responsableDelGastoUid = "", renderTaskSelect, today}) {
  const emptyDraft = () => ({concepto: "", monto: "", fecha: today, tipoDocumento: "", numeroDocumento: "", tareaId: fixedTaskId});
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState(emptyDraft);
  const [errors, setErrors] = useState({});
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [preparing, setPreparing] = useState(false);
  // Id del gasto ya creado: mientras exista, el formulario solo reintenta el adjunto.
  const [createdExpenseId, setCreatedExpenseId] = useState("");
  const fileNameRef = useRef("");
  const cameraRef = useRef(null);
  const pickerRef = useRef(null);
  const conceptRef = useRef(null);
  const createForm = useWorkFormSubmit({prefix: "quick-purchase"});
  const uploadForm = useWorkFormSubmit({prefix: "quick-purchase-evidence"});
  const creating = processing === "quick-purchase";
  const uploading = processing === "quick-purchase-evidence";
  const busy = Boolean(processing) || preparing;
  const locked = Boolean(createdExpenseId);

  const edit = (change) => {
    setDraft((current) => ({...current, ...change}));
    setErrors((current) => (Object.keys(current).length ? {} : current));
    createForm.clearError();
  };
  const reset = () => {
    setDraft(emptyDraft()); setErrors({}); setFile(null); setFileError(""); setCreatedExpenseId(""); fileNameRef.current = "";
    createForm.clearError(); uploadForm.clearError(); setOpen(false);
  };
  const chooseFile = async (event) => {
    const picked = event.target.files?.[0] || null;
    event.target.value = "";
    if (!picked) return;
    // Una foto de cámara que pasa del límite se reduce a JPEG antes de rechazarla por tamaño (el PDF no se toca).
    setPreparing(true); setFileError("");
    let selected = picked;
    try {
      selected = (await fitEvidenceImageToLimit(picked, {maxBytes: MAX_WORK_EXPENSE_EVIDENCE_BYTES})).file;
    } catch (failure) {
      setFileError(failure.message); setPreparing(false); return;
    }
    setPreparing(false);
    const validation = validateWorkExpenseEvidenceSelection(selected, 0);
    if (!validation.ok) { setFileError(validation.reason); return; }
    // El nombre se fija una vez por archivo elegido: así un reintento del adjunto reutiliza ruta y requestId.
    fileNameRef.current = buildWorkExpenseEvidenceFileName(selected.name, selected.type);
    setFile(selected);
    uploadForm.clearError();
  };
  const removeFile = () => { setFile(null); fileNameRef.current = ""; };

  const submit = async (event) => {
    event.preventDefault();
    // Con el gasto ya creado solo se reintenta el adjunto: no se vuelven a validar ni a enviar los datos del gasto.
    const found = createdExpenseId ? {} : getQuickPurchaseDraftErrors(draft);
    if (Object.keys(found).length) { setErrors(found); if (found.concepto) conceptRef.current?.focus(); }
    if (!file) setFileError("Adjunta la boleta o la factura: es obligatoria.");
    if (Object.keys(found).length || !file) return;
    const result = await submitQuickPurchase({createdExpenseId, file, fileName: fileNameRef.current, onRegister, onUpload, payload: buildQuickPurchaseExpense(draft, {responsableDelGastoUid}), createSubmit: createForm.submit, uploadSubmit: uploadForm.submit});
    if (result.expenseId) setCreatedExpenseId(result.expenseId);
    if (result.status === "listo") reset();
  };

  if (!open) {
    return <div className="works-quick-purchase__toggle"><Button type="button" variant="ghost" aria-expanded="false" disabled={busy} onClick={() => setOpen(true)}>{WORK_QUICK_PURCHASE_TOGGLE_LABEL}</Button></div>;
  }

  return <form className="works-cost-form works-quick-purchase" noValidate onSubmit={submit}>
    <h5 className="works-cost-form__title">Compra al paso</h5>
    <p className="works-cost-hint works-cost-field--wide">Se registra como gasto de tipo Material, con su documento. No crea ningún producto ni mueve inventario.</p>
    <CostField className="works-cost-field--wide" label="Concepto">
      <input aria-describedby={errors.concepto ? "quick-purchase-concepto-error" : undefined} aria-invalid={errors.concepto ? "true" : undefined} className="erp-control" disabled={locked} maxLength="240" ref={conceptRef} value={draft.concepto} onChange={(event) => edit({concepto: event.target.value})} placeholder="Ej.: tubo PVC y abrazaderas" />
      {errors.concepto && <small className="works-field-error" id="quick-purchase-concepto-error">{errors.concepto}</small>}
    </CostField>
    <CostField label="Monto">
      <CostMoneyInput aria-invalid={errors.monto ? "true" : undefined} currency={currency} disabled={locked} locale={locale} min="0.01" max={MAX_AMOUNT} step="0.01" value={draft.monto} onChange={(event) => edit({monto: event.target.value})} placeholder="0" />
      {errors.monto && <small className="works-field-error">{errors.monto}</small>}
      {!errors.monto && <small className="works-cost-hint">{getQuickPurchaseAmountHint(draft.tipoDocumento, countryCode)}</small>}
    </CostField>
    <CostField label="Fecha">
      <input aria-invalid={errors.fecha ? "true" : undefined} className="erp-control" disabled={locked} type="date" value={draft.fecha} onChange={(event) => edit({fecha: event.target.value})} />
      {errors.fecha && <small className="works-field-error">{errors.fecha}</small>}
    </CostField>
    <CostField label="Tipo de documento">
      <select aria-invalid={errors.tipoDocumento ? "true" : undefined} className="erp-control" disabled={locked} value={draft.tipoDocumento} onChange={(event) => edit({tipoDocumento: event.target.value})}>
        <option value="">Selecciona</option>
        {["boleta", "factura"].map((type) => <option key={type} value={type}>{WORK_QUICK_PURCHASE_DOCUMENT_LABELS[type]}</option>)}
      </select>
      {errors.tipoDocumento && <small className="works-field-error">{errors.tipoDocumento}</small>}
    </CostField>
    <CostField label="Número de documento" optional>
      <input className="erp-control" disabled={locked} maxLength="40" value={draft.numeroDocumento} onChange={(event) => edit({numeroDocumento: event.target.value})} />
    </CostField>
    {renderTaskSelect && !locked && renderTaskSelect(draft.tareaId, (tareaId) => edit({tareaId}))}

    <div className="works-quick-purchase__attach works-cost-field--wide">
      <span className="erp-field__label">Documento adjunto</span>
      <div className="works-quick-purchase__attach-actions">
        <input accept="image/*" aria-label="Tomar foto del documento" capture="environment" hidden onChange={chooseFile} ref={cameraRef} type="file" />
        <input accept={WORK_EXPENSE_EVIDENCE_TYPES.join(",")} aria-label="Elegir archivo del documento" hidden onChange={chooseFile} ref={pickerRef} type="file" />
        <Button type="button" variant="secondary" icon={Camera} iconSize={16} disabled={busy} onClick={() => cameraRef.current?.click()}>Tomar foto</Button>
        <Button type="button" variant="secondary" icon={Paperclip} iconSize={16} disabled={busy} onClick={() => pickerRef.current?.click()}>Elegir archivo</Button>
      </div>
      {preparing && <LoadingState variant="inline" label="Preparando la foto..." />}
      {!preparing && (file
        ? <p className="works-quick-purchase__file">{file.name} · {fileSizeLabel(file.size)} <Button type="button" variant="ghost" disabled={busy} onClick={removeFile}>Quitar</Button></p>
        : <small className="works-cost-hint">Obligatorio. PDF, JPG o PNG, hasta {Math.round(MAX_WORK_EXPENSE_EVIDENCE_BYTES / (1024 * 1024))} MB. Las fotos grandes se reducen solas.</small>)}
      {fileError && <small className="works-field-error">{fileError}</small>}
    </div>

    <WorkFormError error={createForm.error} noticeRef={createForm.noticeRef} title="No se pudo registrar la compra" />
    {locked && <Notice variant="info" className="works-cost-field--wide" title="El gasto ya quedó registrado">Falta el documento. Reintenta el adjunto: no se vuelve a crear el gasto. Si prefieres hacerlo después, lo puedes adjuntar desde la pestaña Gastos.</Notice>}
    <WorkFormError error={uploadForm.error} noticeRef={uploadForm.noticeRef} title="No se pudo subir el documento" />
    <div className="works-quick-purchase__actions works-cost-field--wide">
      <Button type="submit" loading={creating || uploading} disabled={busy && !creating && !uploading}>{locked ? "Reintentar adjunto" : "Registrar compra"}</Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={reset}>{locked ? "Adjuntar después" : "Cancelar"}</Button>
    </div>
  </form>;
}
