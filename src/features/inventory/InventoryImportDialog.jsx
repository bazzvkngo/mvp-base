import React, { useRef, useState } from "react";
import AiAvailabilityStatus from "../../components/ai/AiAvailabilityStatus";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import { AI_MODELS } from "../../config/aiModels";
import useAiRateLimit from "../../hooks/useAiRateLimit";
import {
  createMissingAiRateLimitStatusError,
  getAiAvailabilityErrorStatus,
  translateInventoryAiError,
} from "../../services/inventoryAiClient.mjs";
import {
  ACCEPTED_INVENTORY_FILE_TYPES,
  getInventoryImportAiRateLimitStatus,
  normalizeInventoryDocumentWithAi,
  readInventorySourceFile,
  stripInventoryDocumentPayload,
} from "../../services/inventoryAiImportService";
import {
  confirmLocalInventoryImport,
  createInventoryImportRequestIdBase,
  downloadInventoryTemplate,
  getInventoryImportSummary,
  readLocalInventoryWorkbook,
  revalidateInventoryImportCodes,
  transformInventoryDocumentCandidates,
  updateInventoryImportRow,
} from "../../services/inventoryImportService";

const SPREADSHEET_EXTENSION = /\.(csv|xls|xlsx)$/i;

function InventoryImportDialog({
  areas,
  businessId,
  categories,
  existingItems,
  onClose,
  onImported,
  open,
}) {
  const inputRef = useRef(null);
  const requestIdBaseRef = useRef("");
  const analysisInFlightRef = useRef(false);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [sourceKind, setSourceKind] = useState("");
  const [documentData, setDocumentData] = useState(null);
  const [analysisWarnings, setAnalysisWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const summary = getInventoryImportSummary(rows);
  const aiAvailability = useAiRateLimit(AI_MODELS.documentImport, {
    enabled: open && sourceKind === "document",
    getErrorStatus: getAiAvailabilityErrorStatus,
    getStatus: getInventoryImportAiRateLimitStatus,
  });

  const reset = () => {
    analysisInFlightRef.current = false;
    setRows([]);
    setFileName("");
    setSheetName("");
    setSourceKind("");
    setDocumentData(null);
    setAnalysisWarnings([]);
    setError("");
    setResult(null);
    requestIdBaseRef.current = "";
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    if (saving || analyzing) return;
    reset();
    onClose();
  };

  const loadFile = async (file) => {
    if (!file || loading || analyzing) return;
    setLoading(true);
    setRows([]);
    setError("");
    setResult(null);
    setAnalysisWarnings([]);
    setDocumentData(null);
    setSheetName("");
    try {
      requestIdBaseRef.current = createInventoryImportRequestIdBase();
      if (SPREADSHEET_EXTENSION.test(String(file.name || ""))) {
        const parsed = await readLocalInventoryWorkbook(file, {
          areas,
          categories,
          existingItems,
        });
        setRows(parsed.rows);
        setSheetName(parsed.sheetName);
        setSourceKind("spreadsheet");
      } else {
        const parsed = await readInventorySourceFile(file);
        if (parsed.kind !== "document") {
          throw new Error("Selecciona un PDF o una imagen compatible.");
        }
        setDocumentData(parsed);
        setSourceKind("document");
      }
      setFileName(file.name);
    } catch (loadError) {
      setSourceKind("");
      setFileName("");
      requestIdBaseRef.current = "";
      setError(
        translateInventoryAiError(loadError).message ||
          "No se pudo leer el archivo."
      );
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const analyzeDocument = async () => {
    if (!documentData?.base64 || analysisInFlightRef.current) return;
    if (!aiAvailability.begin()) return;
    analysisInFlightRef.current = true;
    setAnalyzing(true);
    setError("");
    try {
      const analysis = await normalizeInventoryDocumentWithAi({
        fileData: documentData,
      });
      const previewRows = transformInventoryDocumentCandidates(analysis.items, {
        areas,
        categories,
        existingItems,
      });
      setRows(previewRows);
      setAnalysisWarnings([
        ...(analysis.warning ? [analysis.warning] : []),
        ...(Array.isArray(analysis.warnings) ? analysis.warnings : []),
      ]);
      setDocumentData(stripInventoryDocumentPayload(documentData));
      if (analysis.aiRateLimit) {
        aiAvailability.applySuccess(analysis.aiRateLimit);
      } else {
        aiAvailability.applyError(createMissingAiRateLimitStatusError());
      }
      if (!previewRows.length) {
        setError(
          "No se detectaron productos claros. Puedes reintentar con otro documento."
        );
      }
    } catch (analysisError) {
      aiAvailability.applyError(analysisError);
      const translated = translateInventoryAiError(analysisError);
      setError(
        `No pudimos analizar este documento con IA. ${translated.message}`
      );
    } finally {
      analysisInFlightRef.current = false;
      setAnalyzing(false);
    }
  };

  const updateRow = (rowId, field, value) => {
    setRows((current) =>
      revalidateInventoryImportCodes(
        current.map((row) =>
          row.rowId === rowId
            ? updateInventoryImportRow(row, field, value, { areas, categories })
            : row
        ),
        existingItems
      )
    );
  };

  const toggleRow = (rowId, included) => {
    setRows((current) =>
      revalidateInventoryImportCodes(
        current.map((row) =>
          row.rowId === rowId ? { ...row, included } : row
        ),
        existingItems
      )
    );
  };

  const removeRow = (rowId) => {
    setRows((current) =>
      revalidateInventoryImportCodes(
        current.filter((row) => row.rowId !== rowId),
        existingItems
      )
    );
  };

  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      const confirmation = await confirmLocalInventoryImport({
        businessId,
        rows,
        categories,
        requestIdBase: requestIdBaseRef.current,
      });
      setResult(confirmation);
      await onImported?.(confirmation);
    } catch (saveError) {
      if (saveError.partialCreated > 0) {
        const partialResult = {
          created: saveError.partialCreated,
          skipped: rows.length - saveError.partialCreated,
          remaining: saveError.remaining,
          partial: true,
          error: saveError.message || "No se pudieron guardar todos los lotes.",
        };
        setResult(partialResult);
        await onImported?.(partialResult);
      } else {
        setError(saveError.message || "No se pudo confirmar la importación.");
      }
    } finally {
      setSaving(false);
    }
  };

  const footer = rows.length && !result ? (
    <>
      <button
        type="button"
        className="inventory-button inventory-button--secondary"
        onClick={close}
      >
        Cancelar
      </button>
      <button
        type="button"
        className="inventory-button inventory-button--primary"
        disabled={saving || summary.valid === 0 || summary.invalid > 0}
        onClick={confirm}
      >
        {saving
          ? "Guardando…"
          : `Confirmar importación (${summary.valid})`}
      </button>
    </>
  ) : null;

  return (
    <ResponsiveDialog
      open={open}
      onClose={close}
      size="large"
      eyebrow="Inventario"
      title="Importar inventario"
      description="Sube una planilla, PDF o imagen. Revisarás los productos antes de agregarlos."
      footer={footer}
    >
      <div className="inventory-import-dialog">
        {!rows.length && !result && (
          <>
            <div
              className="inventory-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                loadFile(event.dataTransfer.files?.[0]);
              }}
            >
              <strong>
                {loading
                  ? "Leyendo archivo…"
                  : "Arrastra una planilla, PDF o imagen"}
              </strong>
              <span>CSV, XLS, XLSX, PDF, JPG, JPEG, PNG o WEBP · máximo 5 MB.</span>
              <button
                type="button"
                className="inventory-button inventory-button--primary"
                disabled={loading || analyzing}
                onClick={() => inputRef.current?.click()}
              >
                Seleccionar archivo
              </button>
              <input
                ref={inputRef}
                className="inventory-visually-hidden"
                type="file"
                accept={ACCEPTED_INVENTORY_FILE_TYPES}
                onChange={(event) => loadFile(event.target.files?.[0])}
              />
            </div>
            <p className="inventory-template-option">
              ¿Prefieres usar una plantilla?{" "}
              <button
                type="button"
                className="inventory-link-button"
                onClick={downloadInventoryTemplate}
              >
                Descargar plantilla
              </button>
            </p>
          </>
        )}

        {sourceKind === "document" && documentData && !rows.length && !result && (
          <section className="inventory-import-ai-panel" aria-label="Análisis con IA">
            <div>
              <strong>{fileName}</strong>
              <span>El documento se analizará con IA y no se guardará automáticamente.</span>
            </div>
            {aiAvailability.status.reason === "available" ? (
              <p className="ai-availability ai-availability--available" role="status">
                Análisis con IA disponible.
              </p>
            ) : (
              <AiAvailabilityStatus
                status={aiAvailability.status}
                remainingSeconds={aiAvailability.remainingSeconds}
                actionLabel="volver a analizar"
              />
            )}
            <button
              type="button"
              className="inventory-button inventory-button--primary"
              disabled={
                analyzing || aiAvailability.isBlocked || !documentData.base64
              }
              onClick={analyzeDocument}
            >
              {analyzing ? "Analizando…" : "Analizar con IA"}
            </button>
          </section>
        )}

        {error && (
          <p className="inventory-feedback inventory-feedback--error" role="alert">
            {error}
          </p>
        )}

        {result && (
          <div className="inventory-import-result" role="status">
            <h3>{result.partial ? "Importación parcial" : "Importación terminada"}</h3>
            {result.partial ? (
              <p><strong>{result.created}</strong> guardados · <strong>{result.remaining}</strong> pendientes.</p>
            ) : (
              <p><strong>{result.created}</strong> creados · <strong>{result.skipped}</strong> omitidos o inválidos.</p>
            )}
            {result.partial ? (
              <>
                <p>{result.error}</p>
                <p className="inventory-feedback inventory-feedback--error">
                  No vuelvas a importar el archivo completo con una solicitud nueva,
                  porque parte de sus registros ya fue guardada.
                </p>
                <div className="inventory-dialog-actions">
                  <button type="button" className="inventory-button inventory-button--secondary" disabled={saving} onClick={close}>Cerrar</button>
                  <button type="button" className="inventory-button inventory-button--primary" disabled={saving} onClick={confirm}>
                    {saving ? "Reintentando…" : "Reintentar importación"}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="inventory-button inventory-button--primary" onClick={close}>Volver al inventario</button>
            )}
          </div>
        )}

        {rows.length > 0 && !result && (
          <>
            <div className="inventory-import-summary">
              <div>
                <strong>{fileName}</strong>
                <span>{sourceKind === "document" ? "Vista previa generada con IA" : `Hoja: ${sheetName} · procesamiento local sin IA`}</span>
              </div>
              <div><strong>{summary.valid}</strong><span>válidas</span></div>
              <div><strong>{summary.invalid}</strong><span>con errores</span></div>
              <div><strong>{summary.excluded}</strong><span>excluidas</span></div>
            </div>
            {analysisWarnings.length > 0 && (
              <ul className="inventory-row-warnings inventory-import-analysis-warnings">
                {[...new Set(analysisWarnings)].map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
            <p className="inventory-import-help">
              Corrige cada campo marcado o excluye la fila. Nada se guarda hasta Confirmar importación.
            </p>
            <div className="inventory-import-preview">
              {rows.map((row) => {
                const errors = row.fieldErrors || {};
                const areaCategories = categories.filter((category) => category.areaId === row.draft.areaId && (category.estado || "activo") === "activo");
                const hasWarnings = row.warnings?.length > 0;
                return (
                  <article key={row.rowId} className={`inventory-import-row${row.included ? "" : " is-excluded"}`}>
                    <header>
                      <label><input type="checkbox" checked={row.included} onChange={(event) => toggleRow(row.rowId, event.target.checked)} />Fila {row.sourceRow}</label>
                      <div className="inventory-import-row-actions">
                        {Object.keys(errors).length ? <span className="inventory-row-status is-error">Requiere corrección</span> : hasWarnings ? <span className="inventory-row-status is-warning">Con advertencias</span> : <span className="inventory-row-status is-valid">Lista para importar</span>}
                        <button type="button" className="inventory-link-button" onClick={() => removeRow(row.rowId)}>Eliminar fila</button>
                      </div>
                    </header>
                    <div className="inventory-import-fields">
                      <ImportField label="Tipo" error={errors.tipoItem}><select value={row.draft.tipoItem} onChange={(event) => updateRow(row.rowId, "tipoItem", event.target.value)}><option value="">Revisar tipo</option><option value="producto">Producto</option><option value="servicio">Servicio</option><option value="actividad">Actividad</option></select></ImportField>
                      <ImportField label="Nombre" error={errors.nombre}><input value={row.draft.nombre} onChange={(event) => updateRow(row.rowId, "nombre", event.target.value)} /></ImportField>
                      <ImportField label="Código" error={errors.codigoSolicitado}><input value={row.draft.codigoSolicitado} placeholder="Automático si queda vacío" onChange={(event) => updateRow(row.rowId, "codigoSolicitado", event.target.value.toUpperCase())} /></ImportField>
                      <ImportField label="Área" error={errors.areaId}><select value={row.draft.areaId} onChange={(event) => updateRow(row.rowId, "areaId", event.target.value)}><option value="">Sin área</option>{areas.filter((area) => (area.estado || "activo") === "activo").map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}</select></ImportField>
                      <ImportField label="Categoría" error={errors.categoriaId}><select value={row.draft.categoriaId} disabled={!row.draft.areaId} onChange={(event) => updateRow(row.rowId, "categoriaId", event.target.value)}><option value="">Sin categoría</option>{areaCategories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}</select></ImportField>
                      <ImportField label="Unidad" error={errors.unidad}><input value={row.draft.unidad} onChange={(event) => updateRow(row.rowId, "unidad", event.target.value)} /></ImportField>
                      <ImportField label="Costo base" error={errors.costoBase}><input inputMode="decimal" value={row.draft.costoBase} onChange={(event) => updateRow(row.rowId, "costoBase", event.target.value)} /></ImportField>
                      <ImportField label="Recargo %" error={errors.margenDeseado}><input inputMode="decimal" value={row.draft.margenDeseado} onChange={(event) => updateRow(row.rowId, "margenDeseado", event.target.value)} /></ImportField>
                      <ImportField label="Precio de venta" error={errors.precioManual}><input inputMode="decimal" value={row.draft.precioManual} placeholder="Calculado si queda vacío" onChange={(event) => updateRow(row.rowId, "precioManual", event.target.value)} /></ImportField>
                      {row.draft.tipoItem === "producto" && <><ImportField label="Marca" error={errors.marca}><input value={row.draft.marca || ""} onChange={(event) => updateRow(row.rowId, "marca", event.target.value)} /></ImportField><ImportField label="Modelo" error={errors.modelo}><input value={row.draft.modelo || ""} onChange={(event) => updateRow(row.rowId, "modelo", event.target.value)} /></ImportField><ImportField label="Código de barras" error={errors.codigoBarras}><input value={row.draft.codigoBarras || ""} onChange={(event) => updateRow(row.rowId, "codigoBarras", event.target.value)} /></ImportField>{Number(row.draft.formacionPrecioVersion) === 2 && <ImportField label="IVA compra %" error={errors.tasaImpuestoCompra}><input inputMode="decimal" value={row.draft.tasaImpuestoCompra} onChange={(event) => updateRow(row.rowId, "tasaImpuestoCompra", event.target.value)} /></ImportField>}<ImportField label="Stock" error={errors.stock}><input inputMode="decimal" value={row.draft.stock} onChange={(event) => updateRow(row.rowId, "stock", event.target.value)} /></ImportField><ImportField label="Stock mínimo" error={errors.stockMinimo}><input inputMode="decimal" value={row.draft.stockMinimo} onChange={(event) => updateRow(row.rowId, "stockMinimo", event.target.value)} /></ImportField></>}
                      <ImportField label="Descripción" error={errors.descripcion} wide><textarea rows="2" value={row.draft.descripcion || ""} onChange={(event) => updateRow(row.rowId, "descripcion", event.target.value)} /></ImportField>
                    </div>
                    {hasWarnings && <ul className="inventory-row-warnings">{row.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    </ResponsiveDialog>
  );
}

function ImportField({ children, error, label, wide = false }) {
  return <label className={`${error ? "has-error" : ""}${wide ? " is-wide" : ""}`}><span>{label}</span>{children}{error && <small>{error}</small>}</label>;
}

export default InventoryImportDialog;
