import {useRef, useState} from "react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  applyReceptionImportRows,
  buildReceptionDocumentSource,
  buildReceptionImportPreview,
  getReceptionImportedProviderStatus,
  getReceptionImportSummary,
  updateReceptionImportRow,
} from "../../domain/receptionDocumentImport.mjs";
import {
  ACCEPTED_INVENTORY_FILE_TYPES,
  normalizeInventorySourceWithAi,
  readInventorySourceFile,
  stripInventoryDocumentPayload,
} from "../../services/inventoryAiImportService";

const EMPTY_FIELDS = {
  tipoDocumento: "otro",
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

const STATUS_LABELS = {
  coincidencia: "Coincidencia",
  revisar: "Revisar",
  sin_asociar: "Sin asociar",
};

export default function ReceptionDocumentImportDialog({
  businessId,
  onApply,
  onClose,
  open,
  providerSnapshot,
  receptionItems,
}) {
  const inputRef = useRef(null);
  const [fileData, setFileData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [rows, setRows] = useState([]);
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const summary = getReceptionImportSummary(rows);
  const providerStatus = getReceptionImportedProviderStatus(analysis, providerSnapshot);

  const reset = () => {
    setFileData(null);
    setAnalysis(null);
    setRows([]);
    setFields(EMPTY_FIELDS);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    if (loading || analyzing) return;
    reset();
    onClose();
  };

  const loadFile = async (file) => {
    if (!file) return;
    setLoading(true);
    setError("");
    setAnalysis(null);
    setRows([]);
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
    if (!fileData) return;
    setAnalyzing(true);
    setError("");
    try {
      const result = await normalizeInventorySourceWithAi({
        businessId,
        fileData,
        assistantMode: fileData.kind === "spreadsheet" ? "local" : "auto",
        context: "reception",
      });
      const preview = buildReceptionImportPreview(result.items, receptionItems);
      setAnalysis(result);
      setRows(preview);
      setFields((current) => ({
        ...current,
        tipoDocumento: ["factura", "boleta"].includes(result.documentType)
          ? result.documentType
          : "otro",
        numeroDocumento: result.documento?.numero || "",
        fechaDocumento: result.documento?.fechaEmision || "",
        fechaVencimiento: result.documento?.fechaVencimiento || "",
        condicionesPago: result.documento?.condicionPago || "",
        moneda: result.documento?.moneda || "",
        neto: result.totales?.neto ?? "",
        impuestoPorcentaje: result.totales?.impuestoPorcentaje ?? "",
        impuestoMonto: result.totales?.impuestoMonto ?? "",
        total: result.totales?.total ?? "",
      }));
      setFileData(stripInventoryDocumentPayload(fileData));
      if (!preview.length) setError("No se detectaron líneas comerciales para reconciliar.");
    } catch (analysisError) {
      setError(
        `${analysisError.message || "No se pudo analizar el documento."} ` +
        "Puedes cerrar esta ventana y continuar la recepción manualmente."
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const apply = () => {
    setError("");
    try {
      const result = applyReceptionImportRows(receptionItems, rows);
      const documentoOrigen = buildReceptionDocumentSource(fileData, analysis, fields, rows);
      onApply({...result, documentoOrigen});
      close();
    } catch (applyError) {
      setError(applyError.message || "No se pudo aplicar la propuesta a la recepción.");
    }
  };

  const footer = rows.length ? <>
    <Button type="button" variant="secondary" disabled={analyzing} onClick={close}>Cancelar</Button>
    <Button type="button" disabled={analyzing || summary.asociadas === 0} onClick={apply}>
      Aplicar a recepción
    </Button>
  </> : null;

  return <ResponsiveDialog
    open={open}
    onClose={close}
    eyebrow="Recepción"
    title="Importar factura o documento"
    description="El documento generará una propuesta editable. El inventario sólo cambia al confirmar la recepción."
    size="large"
    footer={footer}
  >
    <div className="reception-import">
      <section className="reception-import__source">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_INVENTORY_FILE_TYPES}
          disabled={loading || analyzing}
          onChange={(event) => loadFile(event.target.files?.[0])}
        />
        {fileData && <div>
          <strong>{fileData.nombreArchivo}</strong>
          <small>{fileData.extension?.toUpperCase()} · {Math.max(1, Math.round(Number(fileData.tamanoBytes || 0) / 1024))} KB</small>
        </div>}
        {fileData && !rows.length && <Button type="button" disabled={loading || analyzing} onClick={analyze}>
          {analyzing ? "Analizando..." : "Previsualizar y reconciliar"}
        </Button>}
      </section>

      {error && <p className="po-message po-message--error" role="alert">{error}</p>}

      {rows.length > 0 && <>
        <section className="reception-import__document">
          <div><span>Proveedor de la OC</span><strong>{providerSnapshot?.razonSocial || "Proveedor seleccionado"}</strong></div>
          <div><span>Proveedor detectado</span><strong>{analysis?.proveedor?.nombre || "Sin nombre detectado"}</strong><small>{analysis?.proveedor?.identificadorFiscal || "Sin identificación fiscal"}</small></div>
          <div><span>Receptor detectado</span><strong>{analysis?.receptor?.nombre || "Sin receptor detectado"}</strong><small>{analysis?.receptor?.identificadorFiscal || "Sin identificación fiscal"}</small></div>
          <p className={`reception-import__provider-status reception-import__provider-status--${providerStatus.estado}`}>{providerStatus.mensaje}</p>
          <label>Tipo de documento<select value={fields.tipoDocumento} onChange={(event) => setFields({...fields, tipoDocumento: event.target.value})}><option value="factura">Factura</option><option value="boleta">Boleta</option><option value="otro">Otro documento</option><option value="sin_documento">Sin documento tributario</option></select></label>
          <label>Número<input value={fields.numeroDocumento} onChange={(event) => setFields({...fields, numeroDocumento: event.target.value})} placeholder="Ej. 12345" /></label>
          <label>Fecha de emisión<input type="date" value={fields.fechaDocumento} onChange={(event) => setFields({...fields, fechaDocumento: event.target.value})} /></label>
          <label>Vencimiento<input type="date" value={fields.fechaVencimiento} onChange={(event) => setFields({...fields, fechaVencimiento: event.target.value})} /></label>
          <label className="reception-import__wide">Condición de pago<input value={fields.condicionesPago} onChange={(event) => setFields({...fields, condicionesPago: event.target.value})} /></label>
          <label>Moneda<input value={fields.moneda} maxLength={12} onChange={(event) => setFields({...fields, moneda: event.target.value.toUpperCase()})} /></label>
          <label>Neto<input type="number" min="0" step="any" value={fields.neto} onChange={(event) => setFields({...fields, neto: event.target.value})} /></label>
          <label>Impuesto %<input type="number" min="0" max="100" step="any" value={fields.impuestoPorcentaje} onChange={(event) => setFields({...fields, impuestoPorcentaje: event.target.value})} /></label>
          <label>Impuesto<input type="number" min="0" step="any" value={fields.impuestoMonto} onChange={(event) => setFields({...fields, impuestoMonto: event.target.value})} /></label>
          <label>Total<input type="number" min="0" step="any" value={fields.total} onChange={(event) => setFields({...fields, total: event.target.value})} /></label>
        </section>

        <div className="reception-import__summary" role="status">
          <span>{summary.asociadas} asociadas</span>
          <span>{summary.revisar} por revisar</span>
          <span>{summary.sinAsociar} sin asociar</span>
          {analysis?.coherencia?.estado === "revisar" && <span className="reception-import__review-totals">Revisar totales</span>}
        </div>

        <div className="erp-table-region">
          <table className="erp-table reception-import__table">
            <thead><tr><th>Ítem documento</th><th>Ítem OC</th><th>Cant.</th><th>Costo</th><th>Desc. %</th><th>Total línea</th><th>Estado</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.rowId}>
              <td><strong>{row.nombreOrigen}</strong><small>{row.codigoOrigen || "Sin código"} · {row.unidadOrigen}</small>{row.advertencias.length > 0 && <small>{row.advertencias[0]}</small>}</td>
              <td><select value={row.selectedLineId} onChange={(event) => setRows(updateReceptionImportRow(rows, row.rowId, "selectedLineId", event.target.value))}><option value="">Seleccionar...</option>{receptionItems.map((line) => <option key={line.lineaId} value={line.lineaId}>{line.codigo ? `${line.codigo} · ` : ""}{line.nombre}</option>)}</select></td>
              <td><input type="number" min="0" step="any" value={row.cantidad} onChange={(event) => setRows(updateReceptionImportRow(rows, row.rowId, "cantidad", event.target.value))} /></td>
              <td><input type="number" min="0" step="any" value={row.costoUnitario} onChange={(event) => setRows(updateReceptionImportRow(rows, row.rowId, "costoUnitario", event.target.value))} /></td>
              <td><input type="number" min="0" max="100" step="any" value={row.descuentoPct} onChange={(event) => setRows(updateReceptionImportRow(rows, row.rowId, "descuentoPct", event.target.value))} /></td>
              <td>{row.totalLinea || "—"}</td>
              <td><span className={`reception-import-status reception-import-status--${row.estado}`}>{STATUS_LABELS[row.estado]}</span></td>
            </tr>)}</tbody>
          </table>
        </div>
        {summary.sinAsociar > 0 && <p className="reception-import__notice">Las líneas sin asociar quedarán fuera de la recepción y no modificarán stock.</p>}
      </>}
    </div>
  </ResponsiveDialog>;
}
