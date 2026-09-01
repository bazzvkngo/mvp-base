import {useEffect, useMemo, useRef, useState} from "react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  applyPurchaseDocumentImport,
  buildPurchaseDocumentPreview,
  getPurchaseDocumentImportSummary,
  matchPurchaseDocumentProvider,
  updatePurchaseDocumentRow,
} from "../../domain/purchaseDocumentImport.mjs";
import {
  normalizeInventorySourceWithAi,
  readInventorySourceFile,
  stripInventoryDocumentPayload,
} from "../../services/inventoryAiImportService";
import {formatMoney} from "../../utils/formatters";
import "../receptions/receptions.css";

const EMPTY_FIELDS = {
  tipoDocumento: "factura",
  numeroDocumento: "",
  fechaDocumento: "",
  fechaVencimiento: "",
  condicionesPago: "",
  moneda: "",
  neto: "",
  impuestoPorcentaje: "",
  impuestoMonto: "",
  total: "",
};
const IMPORT_PHASES = ["Subir", "Analizar", "Revisar", "Aplicar"];
const PURCHASE_DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";
const PURCHASE_DOCUMENT_EXTENSION = /\.(pdf|jpe?g|png|webp)$/i;
const ANALYSIS_MESSAGES = [
  "Leyendo factura…",
  "Identificando proveedor e ítems…",
  "Comparando con Inventario…",
  "Preparando revisión…",
];
const STATUS_LABELS = {
  vinculada: "Vinculada",
  revisar: "Requiere revisión",
  sin_coincidencia: "Sin coincidencia",
};
const hasValue = (value) => value !== "" && value !== null && value !== undefined;
const itemId = (item) => String(item?.id || item?.itemId || item?.inventarioId || "");
const providerId = (provider) => String(provider?.proveedorId || provider?.id || "");

export default function PurchaseDocumentImportDialog({
  businessId,
  inventory,
  onApply,
  onClose,
  open,
  providers,
  taxName = "Impuesto",
}) {
  const inputRef = useRef(null);
  const applyGuard = useRef(false);
  const [fileData, setFileData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [rows, setRows] = useState([]);
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [analysisMessageIndex, setAnalysisMessageIndex] = useState(0);
  const [error, setError] = useState("");
  const providerMatch = useMemo(
    () => matchPurchaseDocumentProvider(analysis || {}, providers),
    [analysis, providers]
  );
  const summary = getPurchaseDocumentImportSummary(rows);
  const activePhase = applying ? 3 : rows.length ? 2 : fileData ? 1 : 0;
  const currency = fields.moneda || analysis?.documento?.moneda || "CLP";
  const taxLabel = String(taxName || "").trim() || "Impuesto";

  useEffect(() => {
    if (!analyzing) {
      setAnalysisMessageIndex(0);
      return undefined;
    }
    const timer = window.setInterval(() => setAnalysisMessageIndex((current) =>
      (current + 1) % ANALYSIS_MESSAGES.length), 1800);
    return () => window.clearInterval(timer);
  }, [analyzing]);

  useEffect(() => {
    if (!analysis) return;
    setSelectedProviderId(providerMatch.proveedorId || "");
  }, [analysis, providerMatch.proveedorId]);

  const reset = () => {
    setFileData(null);
    setAnalysis(null);
    setRows([]);
    setFields(EMPTY_FIELDS);
    setSelectedProviderId("");
    setApplying(false);
    setError("");
    applyGuard.current = false;
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    if (loading || analyzing || applying) return;
    reset();
    onClose();
  };

  const chooseAnotherFile = () => {
    if (loading || analyzing || applying) return;
    reset();
    window.requestAnimationFrame(() => inputRef.current?.click());
  };

  const loadFile = async (file) => {
    if (!file || loading || analyzing || applying) return;
    if (!PURCHASE_DOCUMENT_EXTENSION.test(String(file.name || ""))) {
      setFileData(null);
      setError("Usa un archivo PDF, JPG, JPEG, PNG o WebP.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setLoading(true);
    setError("");
    setAnalysis(null);
    setRows([]);
    setFields(EMPTY_FIELDS);
    setSelectedProviderId("");
    try {
      setFileData(await readInventorySourceFile(file));
    } catch (loadError) {
      setFileData(null);
      setError(loadError.message || "No se pudo leer el archivo.");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const analyze = async () => {
    if (!fileData || analyzing) return;
    setAnalyzing(true);
    setError("");
    try {
      const result = await normalizeInventorySourceWithAi({
        businessId,
        fileData,
        assistantMode: "auto",
        context: "purchase",
      });
      const preview = buildPurchaseDocumentPreview(result.items, inventory);
      setAnalysis(result);
      setRows(preview);
      setFields({
        tipoDocumento: ["factura", "boleta"].includes(result.documentType)
          ? result.documentType : "otro",
        numeroDocumento: result.documento?.numero || "",
        fechaDocumento: result.documento?.fechaEmision || "",
        fechaVencimiento: result.documento?.fechaVencimiento || "",
        condicionesPago: result.documento?.condicionPago || "",
        moneda: result.documento?.moneda || "",
        neto: result.totales?.neto ?? "",
        impuestoPorcentaje: result.totales?.impuestoPorcentaje ?? "",
        impuestoMonto: result.totales?.impuestoMonto ?? "",
        total: result.totales?.total ?? "",
      });
      setFileData(stripInventoryDocumentPayload(fileData));
      if (!preview.length) {
        setError("No se detectaron líneas comerciales para vincular con Inventario.");
      }
    } catch (analysisError) {
      setError(`${analysisError.message || "No se pudo analizar la factura."} La compra no fue creada ni confirmada.`);
    } finally {
      setAnalyzing(false);
    }
  };

  const apply = async () => {
    if (applyGuard.current || applying) return;
    applyGuard.current = true;
    setApplying(true);
    setError("");
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    try {
      const effectiveProviderMatch = selectedProviderId === providerMatch.proveedorId
        ? providerMatch
        : {criterio: "seleccion_manual"};
      const result = applyPurchaseDocumentImport({
        analysis,
        fields,
        fileData,
        inventory,
        providerMatch: effectiveProviderMatch,
        rows,
        selectedProviderId,
      });
      onApply(result);
      reset();
      onClose();
    } catch (applyError) {
      setError(applyError.message || "No se pudo aplicar la factura a la compra.");
      setApplying(false);
      applyGuard.current = false;
    }
  };

  const footer = rows.length ? <>
    <Button type="button" variant="secondary" disabled={analyzing || applying} onClick={close}>Cancelar</Button>
    <Button type="button" aria-busy={applying} disabled={analyzing || applying || !summary.lista || !selectedProviderId} onClick={apply}>
      {applying ? "Aplicando factura…" : "Aplicar a Nueva compra"}
    </Button>
  </> : null;

  return <ResponsiveDialog
    open={open}
    onClose={close}
    eyebrow="Nueva compra"
    title="Importar factura"
    description="El documento prepara un borrador editable. El stock sólo cambia al confirmar la compra."
    size="large"
    footer={footer}
  >
    <div className="reception-import purchase-document-import">
      <ol className="reception-import__steps" aria-label="Progreso de importación">
        {IMPORT_PHASES.map((phase, index) => <li key={phase} className={`${index < activePhase ? "is-complete" : ""}${index === activePhase ? " is-current" : ""}`} aria-current={index === activePhase ? "step" : undefined}><span>{index + 1}</span><strong>{phase}</strong></li>)}
      </ol>
      <input ref={inputRef} className="reception-visually-hidden" type="file" accept={PURCHASE_DOCUMENT_ACCEPT} disabled={loading || analyzing || applying} onChange={(event) => loadFile(event.target.files?.[0])} />

      {!fileData && <section className="reception-import__dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); loadFile(event.dataTransfer.files?.[0]); }}>
        <strong>{loading ? "Leyendo archivo…" : "Arrastra una factura o documento"}</strong>
        <span>PDF, JPG, JPEG, PNG o WEBP · máximo 5 MB.</span>
        <Button type="button" disabled={loading} onClick={() => inputRef.current?.click()}>Seleccionar archivo</Button>
      </section>}
      {fileData && <section className="reception-import__file-card" aria-label="Archivo seleccionado">
        <span className="reception-import__file-type">Documento</span>
        <div><strong>{fileData.nombreArchivo}</strong><span>{fileData.extension?.toUpperCase()} · {Math.max(1, Math.round(Number(fileData.tamanoBytes || 0) / 1024))} KB</span></div>
        <div className="reception-import__file-actions"><button type="button" disabled={loading || analyzing || applying} onClick={chooseAnotherFile}>Cambiar</button><button type="button" disabled={loading || analyzing || applying} onClick={reset}>Eliminar</button></div>
      </section>}
      {fileData && !rows.length && <section className="reception-import__analysis">
        {analyzing ? <div className="reception-import__processing" role="status" aria-live="polite"><span className="reception-import__spinner" aria-hidden="true" /><div><strong>{ANALYSIS_MESSAGES[analysisMessageIndex]}</strong><span>Todavía no se guarda ni confirma ninguna compra.</span></div></div> : <><strong>Factura lista para analizar</strong><span>Propondremos proveedor, líneas y totales para revisión humana.</span></>}
        <Button type="button" disabled={loading || analyzing || !fileData.base64} onClick={analyze}>{analyzing ? "Analizando factura…" : "Analizar y vincular"}</Button>
      </section>}
      {error && <p className="po-message po-message--error" role="alert">{error}</p>}

      {rows.length > 0 && <>
        <section className={`reception-import__provider-alert purchase-document-provider purchase-document-provider--${providerMatch.estado}`}>
          <div><span>Proveedor detectado</span><h3>{analysis?.proveedor?.nombre || "No identificado"}</h3><p>{providerMatch.mensaje} ValoraCloud nunca crea proveedores automáticamente desde el documento.</p></div>
          <label>Proveedor existente
            <select value={selectedProviderId} onChange={(event) => setSelectedProviderId(event.target.value)}>
              <option value="">Selecciona un proveedor</option>
              {providers.filter((provider) => (provider.estado || "activo") === "activo").map((provider) => <option key={providerId(provider)} value={providerId(provider)}>{provider.razonSocial || provider.nombreFantasia || "Proveedor"}</option>)}
            </select>
          </label>
        </section>

        <section className="reception-import__document-summary" aria-label="Resumen de la factura">
          <div><span>Folio</span><strong>{fields.numeroDocumento || "Sin folio"}</strong></div>
          <div><span>Fecha</span><strong>{fields.fechaDocumento || "Sin fecha"}</strong></div>
          <div><span>Neto</span><strong>{hasValue(fields.neto) ? formatMoney(fields.neto, currency) : "—"}</strong></div>
          <div><span>{hasValue(fields.impuestoPorcentaje) ? `${taxLabel} (${fields.impuestoPorcentaje}%)` : taxLabel}</span><strong>{hasValue(fields.impuestoMonto) ? formatMoney(fields.impuestoMonto, currency) : "—"}</strong></div>
          <div><span>Total</span><strong>{hasValue(fields.total) ? formatMoney(fields.total, currency) : "—"}</strong></div>
          <div><span>Líneas</span><strong>{summary.vinculadas} de {summary.total} listas</strong></div>
        </section>
        <details className="reception-import__document-details">
          <summary>Revisar datos tributarios y comerciales</summary>
          <div className="reception-import__document-fields">
            <label>Tipo<select value={fields.tipoDocumento} onChange={(event) => setFields({...fields, tipoDocumento: event.target.value})}><option value="factura">Factura</option><option value="boleta">Boleta</option><option value="otro">Otro documento</option><option value="sin_documento">Sin documento</option></select></label>
            <label>Número<input value={fields.numeroDocumento} onChange={(event) => setFields({...fields, numeroDocumento: event.target.value})} /></label>
            <label>Fecha<input type="date" value={fields.fechaDocumento} onChange={(event) => setFields({...fields, fechaDocumento: event.target.value})} /></label>
            <label>Vencimiento<input type="date" value={fields.fechaVencimiento} onChange={(event) => setFields({...fields, fechaVencimiento: event.target.value})} /></label>
            <label className="reception-import__wide">Condición de pago<input value={fields.condicionesPago} onChange={(event) => setFields({...fields, condicionesPago: event.target.value})} /></label>
            <label>Moneda<input value={fields.moneda} maxLength={12} onChange={(event) => setFields({...fields, moneda: event.target.value.toUpperCase()})} /></label>
            <label>Neto<input type="number" min="0" step="any" value={fields.neto} onChange={(event) => setFields({...fields, neto: event.target.value})} /></label>
            <label>Impuesto %<input type="number" min="0" max="100" step="any" value={fields.impuestoPorcentaje} onChange={(event) => setFields({...fields, impuestoPorcentaje: event.target.value})} /></label>
            <label>Impuesto<input type="number" min="0" step="any" value={fields.impuestoMonto} onChange={(event) => setFields({...fields, impuestoMonto: event.target.value})} /></label>
            <label>Total<input type="number" min="0" step="any" value={fields.total} onChange={(event) => setFields({...fields, total: event.target.value})} /></label>
          </div>
        </details>

        <section className="reception-import__reconciliation" aria-label="Estado de vínculos">
          <article><span>Factura</span><strong>{summary.total} líneas detectadas</strong><p>{summary.vinculadas} vinculadas · {summary.revisar} por revisar · {summary.sinCoincidencia} sin coincidencia</p></article>
          <article><span>Autoridad</span><strong>Revisión humana obligatoria</strong><p>Una propuesta de IA nunca crea ni autoriza ítems.</p></article>
          {analysis?.coherencia?.estado === "revisar" && <span className="reception-import__review-totals">Revisar totales</span>}
        </section>
        <section className="reception-import__rows" aria-label="Líneas de la factura">
          {rows.map((row) => {
            const target = inventory.find((item) => itemId(item) === row.selectedItemId);
            return <details className={`reception-import__row reception-import__row--${row.estado}`} key={row.rowId} open={row.estado !== "vinculada"}>
              <summary><div><strong>{row.nombreOrigen}</strong><small>{row.codigoOrigen || "Sin código detectado"} · {row.unidadOrigen}</small></div><div className="reception-import__row-match"><span>{target?.nombre || "Sin ítem vinculado"}</span><small>{row.matchKind === "barcode" ? "Código de barras" : row.matchKind === "codigo_interno" ? "Código interno" : row.matchKind === "seleccion_manual" ? "Selección manual" : "Nombre o descripción"}</small></div><span className={`reception-import-status reception-import-status--${row.estado}`}>{STATUS_LABELS[row.estado]}</span></summary>
              <div className="reception-import__row-fields">
                <label><span>Ítem de Inventario</span><select value={row.selectedItemId} onChange={(event) => setRows(updatePurchaseDocumentRow(rows, row.rowId, "selectedItemId", event.target.value, inventory))}><option value="">Selecciona un ítem</option>{inventory.filter((item) => (item.estado || "activo") === "activo").map((item) => <option key={itemId(item)} value={itemId(item)}>{item.codigoInterno ? `${item.codigoInterno} · ` : ""}{item.nombre}</option>)}</select></label>
                <label><span>Cantidad</span><input type="number" min="0" step="any" value={row.cantidad} onChange={(event) => setRows(updatePurchaseDocumentRow(rows, row.rowId, "cantidad", event.target.value, inventory))} /></label>
                <label><span>Costo unitario</span><input type="number" min="0" step="any" value={row.costoUnitario} onChange={(event) => setRows(updatePurchaseDocumentRow(rows, row.rowId, "costoUnitario", event.target.value, inventory))} /></label>
                <label><span>Descuento %</span><input type="number" min="0" max="100" step="any" value={row.descuentoPct} onChange={(event) => setRows(updatePurchaseDocumentRow(rows, row.rowId, "descuentoPct", event.target.value, inventory))} /></label>
                {row.estado === "revisar" && row.selectedItemId && <Button type="button" variant="secondary" onClick={() => setRows(updatePurchaseDocumentRow(rows, row.rowId, "revisionAceptada", true, inventory))}>Aceptar vínculo revisado</Button>}
              </div>
              {row.advertencias.length > 0 && <ul className="inventory-row-warnings">{row.advertencias.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
            </details>;
          })}
        </section>
        {!summary.lista && <p className="reception-import__notice">Todas las líneas deben quedar vinculadas y revisadas antes de aplicar. Ninguna línea sin resolver podrá entrar a stock.</p>}
      </>}
    </div>
  </ResponsiveDialog>;
}
