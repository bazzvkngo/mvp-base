import {useEffect, useRef, useState} from "react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  applyReceptionImportRows,
  buildReceptionDocumentSource,
  buildReceptionImportPreview,
  getReceptionImportedProviderStatus,
  getReceptionImportRowReason,
  getReceptionImportSummary,
  getReceptionOrderImportSummary,
  updateReceptionImportRow,
} from "../../domain/receptionDocumentImport.mjs";
import {
  ACCEPTED_INVENTORY_FILE_TYPES,
  normalizeInventorySourceWithAi,
  readInventorySourceFile,
  stripInventoryDocumentPayload,
} from "../../services/inventoryAiImportService";
import {formatMoney} from "../../utils/formatters";

const EMPTY_FIELDS = {
  tipoDocumento: "otro", numeroDocumento: "", fechaDocumento: "", fechaVencimiento: "",
  condicionesPago: "", moneda: "", neto: "", impuestoPorcentaje: "", impuestoMonto: "", total: "",
};
const IMPORT_PHASES = ["Subir", "Analizar", "Revisar", "Aplicar"];
const ANALYSIS_MESSAGES = [
  "Leyendo documento…",
  "Identificando proveedor e ítems…",
  "Comparando con la orden…",
  "Preparando conciliación…",
];
const STATUS_LABELS = {coincidencia: "Asociado", revisar: "Revisar", sin_asociar: "Sin asociación"};
const hasDocumentValue = (value) => value !== "" && value !== null && value !== undefined;
const providerFiscalId = (provider = {}) => provider.identificadorFiscalValor ||
  provider.identificadorFiscalNormalizado || provider.rut || provider.rutNormalizado || "Sin identificación fiscal";

export default function ReceptionDocumentImportDialog({businessId, onApply, onClose, open, providerSnapshot, receptionItems}) {
  const inputRef = useRef(null);
  const applyGuard = useRef(false);
  const [fileData, setFileData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [rows, setRows] = useState([]);
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [analysisMessageIndex, setAnalysisMessageIndex] = useState(0);
  const [providerReviewAccepted, setProviderReviewAccepted] = useState(false);
  const [error, setError] = useState("");
  const summary = getReceptionImportSummary(rows);
  const orderSummary = getReceptionOrderImportSummary(rows, receptionItems);
  const providerStatus = getReceptionImportedProviderStatus(analysis, providerSnapshot);
  const providerMismatch = providerStatus.estado === "otro_proveedor";
  const activePhase = applying ? 3 : rows.length ? 2 : fileData ? 1 : 0;
  const currency = fields.moneda || analysis?.documento?.moneda || "CLP";

  useEffect(() => {
    if (!analyzing) { setAnalysisMessageIndex(0); return undefined; }
    const timer = window.setInterval(() => setAnalysisMessageIndex((current) =>
      (current + 1) % ANALYSIS_MESSAGES.length), 1800);
    return () => window.clearInterval(timer);
  }, [analyzing]);

  const reset = () => {
    setFileData(null); setAnalysis(null); setRows([]); setFields(EMPTY_FIELDS);
    setProviderReviewAccepted(false); setApplying(false); applyGuard.current = false; setError("");
    if (inputRef.current) inputRef.current.value = "";
  };
  const close = () => { if (loading || analyzing || applying) return; reset(); onClose(); };
  const chooseAnotherFile = () => {
    if (loading || analyzing || applying) return;
    reset();
    window.requestAnimationFrame(() => inputRef.current?.click());
  };
  const loadFile = async (file) => {
    if (!file || loading || analyzing || applying) return;
    setLoading(true); setError(""); setAnalysis(null); setRows([]); setFields(EMPTY_FIELDS); setProviderReviewAccepted(false);
    try { setFileData(await readInventorySourceFile(file)); }
    catch (loadError) { setFileData(null); setError(loadError.message || "No se pudo leer el archivo."); }
    finally { setLoading(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  const analyze = async () => {
    if (!fileData || analyzing) return;
    setAnalyzing(true); setError(""); setProviderReviewAccepted(false);
    try {
      const result = await normalizeInventorySourceWithAi({
        businessId, fileData, assistantMode: fileData.kind === "spreadsheet" ? "local" : "auto", context: "reception",
      });
      const preview = buildReceptionImportPreview(result.items, receptionItems);
      setAnalysis(result); setRows(preview);
      setFields((current) => ({...current,
        tipoDocumento: ["factura", "boleta"].includes(result.documentType) ? result.documentType : "otro",
        numeroDocumento: result.documento?.numero || "", fechaDocumento: result.documento?.fechaEmision || "",
        fechaVencimiento: result.documento?.fechaVencimiento || "", condicionesPago: result.documento?.condicionPago || "",
        moneda: result.documento?.moneda || "", neto: result.totales?.neto ?? "",
        impuestoPorcentaje: result.totales?.impuestoPorcentaje ?? "", impuestoMonto: result.totales?.impuestoMonto ?? "",
        total: result.totales?.total ?? "",
      }));
      setFileData(stripInventoryDocumentPayload(fileData));
      if (!preview.length) setError("No se detectaron líneas comerciales para reconciliar.");
    } catch (analysisError) {
      setError(`${analysisError.message || "No se pudo analizar el documento."} Puedes cerrar esta ventana y continuar la recepción manualmente.`);
    } finally { setAnalyzing(false); }
  };
  const apply = async () => {
    if (applyGuard.current || applying) return;
    applyGuard.current = true; setApplying(true); setError("");
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    try {
      const result = applyReceptionImportRows(receptionItems, rows);
      const documentoOrigen = buildReceptionDocumentSource(fileData, analysis, fields, rows);
      onApply({...result, documentoOrigen}); reset(); onClose();
    } catch (applyError) {
      setError(applyError.message || "No se pudo aplicar la propuesta a la recepción.");
      setApplying(false); applyGuard.current = false;
    }
  };
  const footer = rows.length ? <>
    <Button type="button" variant="secondary" disabled={analyzing || applying} onClick={close}>Cancelar</Button>
    <Button type="button" aria-busy={applying} disabled={analyzing || applying || summary.asociadas === 0 || (providerMismatch && !providerReviewAccepted)} onClick={apply}>
      {applying ? "Aplicando conciliación…" : `Aplicar ${summary.asociadas} ${summary.asociadas === 1 ? "línea" : "líneas"}`}
    </Button>
  </> : null;

  return <ResponsiveDialog open={open} onClose={close} eyebrow="Recepción" title="Importar factura o documento" description="El documento genera una propuesta editable. El inventario sólo cambia al confirmar la recepción." size="large" footer={footer}>
    <div className="reception-import">
      <ol className="reception-import__steps" aria-label="Progreso de importación">
        {IMPORT_PHASES.map((phase, index) => <li key={phase} className={`${index < activePhase ? "is-complete" : ""}${index === activePhase ? " is-current" : ""}`} aria-current={index === activePhase ? "step" : undefined}><span>{index + 1}</span><strong>{phase}</strong></li>)}
      </ol>
      <input ref={inputRef} className="reception-visually-hidden" type="file" accept={ACCEPTED_INVENTORY_FILE_TYPES} disabled={loading || analyzing || applying} onChange={(event) => loadFile(event.target.files?.[0])} />

      {!fileData && <section className="reception-import__dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); loadFile(event.dataTransfer.files?.[0]); }}>
        <strong>{loading ? "Leyendo archivo…" : "Arrastra una factura o documento"}</strong>
        <span>PDF, JPG, PNG, WEBP o planilla · máximo 5 MB.</span>
        <Button type="button" disabled={loading} onClick={() => inputRef.current?.click()}>Seleccionar archivo</Button>
      </section>}
      {fileData && <section className="reception-import__file-card" aria-label="Archivo seleccionado">
        <span className="reception-import__file-type">{fileData.kind === "document" ? "Documento" : "Planilla"}</span>
        <div><strong>{fileData.nombreArchivo}</strong><span>{fileData.extension?.toUpperCase()} · {Math.max(1, Math.round(Number(fileData.tamanoBytes || 0) / 1024))} KB</span></div>
        <div className="reception-import__file-actions"><button type="button" disabled={loading || analyzing || applying} onClick={chooseAnotherFile}>Cambiar</button><button type="button" disabled={loading || analyzing || applying} onClick={reset}>Eliminar</button></div>
      </section>}
      {fileData && !rows.length && <section className="reception-import__analysis">
        {analyzing ? <div className="reception-import__processing" role="status" aria-live="polite"><span className="reception-import__spinner" aria-hidden="true" /><div><strong>{ANALYSIS_MESSAGES[analysisMessageIndex]}</strong><span>El archivo se procesa temporalmente; todavía no se aplica ningún cambio.</span></div></div> : <><strong>Documento listo para analizar</strong><span>Validaremos proveedor, líneas y totales antes de proponer cambios.</span></>}
        <Button type="button" disabled={loading || analyzing || (fileData.kind === "document" && !fileData.base64)} onClick={analyze}>{analyzing ? "Analizando documento…" : "Analizar y conciliar"}</Button>
      </section>}
      {error && <p className="po-message po-message--error" role="alert">{error}</p>}

      {rows.length > 0 && <>
        {providerMismatch ? <section className="reception-import__provider-alert" role="alert">
          <div><span>Revisión de proveedor</span><h3>{providerStatus.mensaje}</h3><p>La orden y el documento tienen identificaciones fiscales distintas. ValoraCloud no cambiará el proveedor ni asociará todo automáticamente.</p></div>
          <div className="reception-import__provider-compare">
            <article><span>Proveedor de la orden</span><strong>{providerSnapshot?.razonSocial || "Proveedor seleccionado"}</strong><small>{providerFiscalId(providerSnapshot)}</small></article>
            <article><span>Proveedor del documento</span><strong>{analysis?.proveedor?.nombre || "Sin nombre detectado"}</strong><small>{analysis?.proveedor?.identificadorFiscal || "Sin identificación fiscal"}</small></article>
          </div>
          <div className="reception-import__provider-actions"><Button type="button" variant="secondary" onClick={chooseAnotherFile}>Cambiar archivo</Button><Button type="button" variant={providerReviewAccepted ? "secondary" : "primary"} onClick={() => setProviderReviewAccepted(true)}>{providerReviewAccepted ? "Revisión manual habilitada" : "Continuar con revisión manual"}</Button></div>
        </section> : <p className={`reception-import__provider-status reception-import__provider-status--${providerStatus.estado}`} role="status">{providerStatus.mensaje}</p>}

        <section className="reception-import__document-summary" aria-label="Resumen del documento">
          <div><span>Folio</span><strong>{fields.numeroDocumento || "Sin folio"}</strong></div><div><span>Fecha</span><strong>{fields.fechaDocumento || "Sin fecha"}</strong></div><div><span>Proveedor</span><strong>{analysis?.proveedor?.nombre || "No identificado"}</strong></div>
          <div><span>Neto</span><strong>{hasDocumentValue(fields.neto) ? formatMoney(fields.neto, currency) : "—"}</strong></div><div><span>{hasDocumentValue(fields.impuestoPorcentaje) ? `IVA (${fields.impuestoPorcentaje}%)` : "IVA"}</span><strong>{hasDocumentValue(fields.impuestoMonto) ? formatMoney(fields.impuestoMonto, currency) : "—"}</strong></div><div><span>Total</span><strong>{hasDocumentValue(fields.total) ? formatMoney(fields.total, currency) : "—"}</strong></div><div><span>Líneas</span><strong>{summary.total}</strong></div>
        </section>
        <details className="reception-import__document-details">
          <summary>Revisar datos del documento</summary>
          <div className="reception-import__document-fields">
            <div><span>Receptor detectado</span><strong>{analysis?.receptor?.nombre || "Sin receptor detectado"}</strong><small>{analysis?.receptor?.identificadorFiscal || "Sin identificación fiscal"}</small></div>
            <label>Tipo de documento<select value={fields.tipoDocumento} onChange={(event) => setFields({...fields, tipoDocumento: event.target.value})}><option value="factura">Factura</option><option value="boleta">Boleta</option><option value="otro">Otro documento</option><option value="sin_documento">Sin documento tributario</option></select></label>
            <label>Número<input value={fields.numeroDocumento} onChange={(event) => setFields({...fields, numeroDocumento: event.target.value})} placeholder="Ej. 12345" /></label><label>Fecha de emisión<input type="date" value={fields.fechaDocumento} onChange={(event) => setFields({...fields, fechaDocumento: event.target.value})} /></label><label>Vencimiento<input type="date" value={fields.fechaVencimiento} onChange={(event) => setFields({...fields, fechaVencimiento: event.target.value})} /></label>
            <label className="reception-import__wide">Condición de pago<input value={fields.condicionesPago} onChange={(event) => setFields({...fields, condicionesPago: event.target.value})} /></label><label>Moneda<input value={fields.moneda} maxLength={12} onChange={(event) => setFields({...fields, moneda: event.target.value.toUpperCase()})} /></label>
            <label>Neto<input type="number" min="0" step="any" value={fields.neto} onChange={(event) => setFields({...fields, neto: event.target.value})} /></label><label>Impuesto %<input type="number" min="0" max="100" step="any" value={fields.impuestoPorcentaje} onChange={(event) => setFields({...fields, impuestoPorcentaje: event.target.value})} /></label><label>Impuesto<input type="number" min="0" step="any" value={fields.impuestoMonto} onChange={(event) => setFields({...fields, impuestoMonto: event.target.value})} /></label><label>Total<input type="number" min="0" step="any" value={fields.total} onChange={(event) => setFields({...fields, total: event.target.value})} /></label>
          </div>
        </details>

        <section className="reception-import__reconciliation" aria-label="Resumen de conciliación">
          <article><span>Documento</span><strong>{summary.total} líneas detectadas</strong><p>{summary.asociadas} coinciden con la orden · {summary.sinAsociar} no pertenecen</p></article>
          <article><span>Orden</span><strong>{orderSummary.solicitados} ítems solicitados</strong><p>{orderSummary.identificados} identificados · {orderSummary.pendientes} pendientes de revisión</p></article>
          {analysis?.coherencia?.estado === "revisar" && <span className="reception-import__review-totals">Revisar totales</span>}
        </section>
        <section className="reception-import__rows" aria-label="Líneas conciliadas">
          {rows.map((row) => {
            const reason = getReceptionImportRowReason(row, receptionItems);
            const target = receptionItems.find((line) => line.lineaId === row.selectedLineId);
            return <details className={`reception-import__row reception-import__row--${row.estado}`} key={row.rowId}>
              <summary><div><strong>{row.nombreOrigen}</strong><small>{row.codigoOrigen || "Sin código de origen"} · {row.unidadOrigen}</small></div><div className="reception-import__row-match"><span>{target ? target.nombre : "Sin ítem de la orden"}</span><small>{reason}</small></div><span className={`reception-import-status reception-import-status--${row.estado}`}>{STATUS_LABELS[row.estado]}</span></summary>
              <div className="reception-import__row-fields">
                <label><span>Ítem de la orden</span><select value={row.selectedLineId} onChange={(event) => setRows(updateReceptionImportRow(rows, row.rowId, "selectedLineId", event.target.value, receptionItems))}><option value="">No asociar</option>{receptionItems.map((line) => <option key={line.lineaId} value={line.lineaId}>{line.codigo ? `${line.codigo} · ` : ""}{line.nombre}</option>)}</select></label>
                <label><span>Cantidad</span><input type="number" min="0" step="any" value={row.cantidad} onChange={(event) => setRows(updateReceptionImportRow(rows, row.rowId, "cantidad", event.target.value, receptionItems))} /></label><label><span>Costo unitario</span><input type="number" min="0" step="any" value={row.costoUnitario} onChange={(event) => setRows(updateReceptionImportRow(rows, row.rowId, "costoUnitario", event.target.value, receptionItems))} /></label><label><span>Descuento %</span><input type="number" min="0" max="100" step="any" value={row.descuentoPct} onChange={(event) => setRows(updateReceptionImportRow(rows, row.rowId, "descuentoPct", event.target.value, receptionItems))} /></label><div><span>Total del documento</span><strong>{row.totalLinea ? formatMoney(row.totalLinea, currency) : "—"}</strong></div>
              </div>
            </details>;
          })}
        </section>
        {summary.sinAsociar > 0 && <p className="reception-import__notice">Las líneas sin asociación quedarán fuera de la recepción y no modificarán stock ni la compra.</p>}
        {applying && <div className="reception-import__applying" role="status" aria-live="polite"><span className="reception-import__spinner" aria-hidden="true" /><div><strong>Aplicando conciliación…</strong><span>Estamos trasladando únicamente las líneas asociadas a la recepción.</span></div></div>}
      </>}
    </div>
  </ResponsiveDialog>;
}
