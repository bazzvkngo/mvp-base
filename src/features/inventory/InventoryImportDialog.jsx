import React, { useRef, useState } from "react";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  applyInventoryImportPurchaseTax,
  confirmLocalInventoryImport,
  createInventoryImportRequestIdBase,
  downloadInventoryTemplate,
  getInventoryImportSummary,
  readLocalInventoryWorkbook,
  revalidateInventoryImportCodes,
  updateInventoryImportRow,
} from "../../services/inventoryImportService";

const SPREADSHEET_EXTENSION = /\.(csv|xls|xlsx)$/i;
const SPREADSHEET_ACCEPT = ".csv,.xls,.xlsx";
const IMPORT_PHASES = [
  { id: "upload", label: "Subir archivo" },
  { id: "analyze", label: "Analizar" },
  { id: "review", label: "Revisar" },
  { id: "import", label: "Importar" },
];

function formatDocumentNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-CL") : "";
}

function getRowStatus(row) {
  if (!row.included) return {label: "Excluida", tone: "excluded"};
  if (Object.keys(row.fieldErrors || {}).length || row.warnings?.length) {
    return {label: "Revisar", tone: "warning"};
  }
  return {label: "Lista", tone: "valid"};
}

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
  const savingInFlightRef = useRef(false);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [sourceKind, setSourceKind] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const summary = getInventoryImportSummary(rows);
  const activePhase = result || saving
    ? "import"
    : rows.length
      ? "review"
      : "upload";
  const activePhaseIndex = IMPORT_PHASES.findIndex((phase) => phase.id === activePhase);

  const reset = () => {
    savingInFlightRef.current = false;
    setRows([]);
    setFileName("");
    setSheetName("");
    setSourceKind("");
    setError("");
    setResult(null);
    requestIdBaseRef.current = "";
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const loadFile = async (file) => {
    if (!file || loading) return;
    setLoading(true);
    setRows([]);
    setError("");
    setResult(null);
    setSheetName("");
    try {
      if (!SPREADSHEET_EXTENSION.test(String(file.name || ""))) {
        throw new Error("Selecciona un archivo Excel o CSV para la carga maestra.");
      }
      requestIdBaseRef.current = createInventoryImportRequestIdBase();
      const parsed = await readLocalInventoryWorkbook(file, {
        areas,
        categories,
        existingItems,
      });
      setRows(parsed.rows);
      setSheetName(parsed.sheetName);
      setSourceKind("spreadsheet");
      setFileName(file.name);
    } catch (loadError) {
      setSourceKind("");
      setFileName("");
      requestIdBaseRef.current = "";
      setError(loadError.message || "No se pudo leer el archivo.");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
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

  const setAllRowsIncluded = (included) => {
    setRows((current) => revalidateInventoryImportCodes(
      current.map((row) => ({ ...row, included })),
      existingItems
    ));
  };

  const applyPurchaseTax = (rate) => {
    setRows((current) => revalidateInventoryImportCodes(
      applyInventoryImportPurchaseTax(current, rate, {areas, categories}),
      existingItems
    ));
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
    if (savingInFlightRef.current) return;
    savingInFlightRef.current = true;
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
      savingInFlightRef.current = false;
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
        disabled={saving || summary.importable === 0}
        onClick={confirm}
      >
        {saving
          ? "Importando…"
          : `Importar ${summary.importable} ${summary.importable === 1 ? "ítem" : "ítems"}`}
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
      description="Carga el catálogo maestro desde una planilla Excel o CSV."
      footer={footer}
    >
      <div className="inventory-import-dialog">
        <ol className="inventory-import-steps" aria-label="Progreso de importación">
          {IMPORT_PHASES.map((phase, index) => (
            <li
              key={phase.id}
              className={`${index < activePhaseIndex ? "is-complete" : ""}${index === activePhaseIndex ? " is-current" : ""}`}
              aria-current={index === activePhaseIndex ? "step" : undefined}
            >
              <span>{index + 1}</span>
              <strong>{phase.label}</strong>
            </li>
          ))}
        </ol>
        <input
          ref={inputRef}
          className="inventory-visually-hidden"
          type="file"
          accept={SPREADSHEET_ACCEPT}
          onChange={(event) => loadFile(event.target.files?.[0])}
        />

        {!sourceKind && !rows.length && !result && (
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
                  : "Arrastra una planilla Excel o CSV"}
              </strong>
              <span>CSV, XLS o XLSX.</span>
              <button
                type="button"
                className="inventory-button inventory-button--primary"
                disabled={loading}
                onClick={() => inputRef.current?.click()}
              >
                Seleccionar archivo
              </button>
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

        {sourceKind && !rows.length && !result && (
          <section className="inventory-import-file-card" aria-label="Archivo seleccionado">
            <span className="inventory-import-file-card__type">Planilla</span>
            <div>
              <strong>{fileName}</strong>
              <span>{loading ? "Leyendo archivo…" : "Lista para revisar"}</span>
            </div>
            <div className="inventory-import-file-card__actions">
              <button type="button" className="inventory-link-button" disabled={loading} onClick={() => inputRef.current?.click()}>Cambiar</button>
              <button type="button" className="inventory-link-button" disabled={loading} onClick={reset}>Eliminar</button>
            </div>
          </section>
        )}

        {error && (
          <p className="inventory-feedback inventory-feedback--error" role="alert">
            {error}
          </p>
        )}

        {saving && (
          <div className="inventory-import-saving" role="status" aria-live="polite">
            <span className="inventory-import-spinner" aria-hidden="true" />
            <div>
              <strong>Importando inventario…</strong>
              <span>Estamos guardando los ítems seleccionados. Mantén esta ventana abierta.</span>
            </div>
          </div>
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
                <span>Hoja: {sheetName} · procesamiento local sin IA</span>
              </div>
              <div><strong>{summary.detected}</strong><span>detectadas</span></div>
              <div><strong>{summary.ready}</strong><span>listas para importar</span></div>
              <div><strong>{summary.review}</strong><span>requieren revisión</span></div>
              <div><strong>{summary.excluded}</strong><span>excluidas</span></div>
            </div>
            <div className="inventory-import-bulk-actions" aria-label="Acciones para las filas">
              <span>{summary.included} seleccionadas · {summary.importable} importables</span>
              <button type="button" className="inventory-link-button" disabled={saving || summary.included === rows.length} onClick={() => setAllRowsIncluded(true)}>Seleccionar todas</button>
              <button type="button" className="inventory-link-button" disabled={saving || summary.included === 0} onClick={() => setAllRowsIncluded(false)}>Excluir todas</button>
              {rows.some((row) => row.draft.tipoItem === "producto") && (
                <button type="button" className="inventory-button inventory-button--secondary" disabled={saving || summary.included === 0} onClick={() => applyPurchaseTax(0)}>
                  Sin IVA / Exento
                </button>
              )}
            </div>
            <p className="inventory-import-help">
              Las advertencias permiten importar; los errores de campo bloquean sólo esa fila. Nada se guarda hasta confirmar la importación.
            </p>
            <div className="inventory-import-preview">
              {rows.map((row) => {
                const errors = row.fieldErrors || {};
                const areaCategories = categories.filter((category) => category.areaId === row.draft.areaId && (category.estado || "activo") === "activo");
                const hasWarnings = row.warnings?.length > 0;
                const rowStatus = getRowStatus(row);
                const firstIssue = Object.values(errors)[0] || row.warnings?.[0] || "";
                return (
                  <details key={row.rowId} className={`inventory-import-row${row.included ? "" : " is-excluded"}`} defaultOpen={Object.keys(errors).length > 0}>
                    <summary>
                      <label onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={row.included} onChange={(event) => toggleRow(row.rowId, event.target.checked)} />
                        <span className="inventory-import-row__identity">
                          <strong>{row.draft.nombre || `Fila ${row.sourceRow}`}</strong>
                          <small>{row.sourceCode ? `Código proveedor ${row.sourceCode}` : row.draft.codigoSolicitado || "Código interno automático"} · {row.draft.unidad || "Unidad por revisar"} · {formatDocumentNumber(row.draft.costoBase) || "Costo por revisar"}</small>
                          {firstIssue && <small className="inventory-import-row__issue">{firstIssue}</small>}
                        </span>
                      </label>
                      <span className={`inventory-row-status is-${rowStatus.tone}`}>{rowStatus.label}</span>
                    </summary>
                    <div className="inventory-import-row__detail">
                      <div className="inventory-import-fields">
                        <ImportField label="Tipo" error={errors.tipoItem}><select value={row.draft.tipoItem} onChange={(event) => updateRow(row.rowId, "tipoItem", event.target.value)}><option value="">Revisar tipo</option><option value="producto">Producto</option><option value="servicio">Servicio</option><option value="actividad">Actividad</option></select></ImportField>
                        <ImportField label="Nombre" error={errors.nombre}><input value={row.draft.nombre} placeholder="Ej. Cámara IP modelo X100" onChange={(event) => updateRow(row.rowId, "nombre", event.target.value)} /></ImportField>
                        <ImportField label="Código interno" error={errors.codigoSolicitado}><input value={row.draft.codigoSolicitado} placeholder="Automático si queda vacío" onChange={(event) => updateRow(row.rowId, "codigoSolicitado", event.target.value.toUpperCase())} /></ImportField>
                        <ImportField label="Área" error={errors.areaId}><select value={row.draft.areaId} onChange={(event) => updateRow(row.rowId, "areaId", event.target.value)}><option value="">Sin área</option>{areas.filter((area) => (area.estado || "activo") === "activo").map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}</select></ImportField>
                        <ImportField label="Categoría" error={errors.categoriaId}><select value={row.draft.categoriaId} disabled={!row.draft.areaId} onChange={(event) => updateRow(row.rowId, "categoriaId", event.target.value)}><option value="">Sin categoría</option>{areaCategories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}</select></ImportField>
                        <ImportField label="Unidad" error={errors.unidad}><input value={row.draft.unidad} placeholder="Ej. unidad" onChange={(event) => updateRow(row.rowId, "unidad", event.target.value)} /></ImportField>
                        <ImportField label="Costo base" error={errors.costoBase}><input inputMode="decimal" value={row.draft.costoBase} onChange={(event) => updateRow(row.rowId, "costoBase", event.target.value)} /></ImportField>
                        <ImportField label="Recargo %" error={errors.margenDeseado}><input inputMode="decimal" value={row.draft.margenDeseado} onChange={(event) => updateRow(row.rowId, "margenDeseado", event.target.value)} /></ImportField>
                        <ImportField label="Precio de venta" error={errors.precioManual}><input inputMode="decimal" value={row.draft.precioManual} placeholder="Calculado si queda vacío" onChange={(event) => updateRow(row.rowId, "precioManual", event.target.value)} /></ImportField>
                        {row.draft.tipoItem === "producto" && <><ImportField label="Marca" error={errors.marca}><input value={row.draft.marca || ""} placeholder="Ej. Marca" onChange={(event) => updateRow(row.rowId, "marca", event.target.value)} /></ImportField><ImportField label="Modelo" error={errors.modelo}><input value={row.draft.modelo || ""} placeholder="Ej. X100" onChange={(event) => updateRow(row.rowId, "modelo", event.target.value)} /></ImportField><ImportField label="Código de barras" error={errors.codigoBarras}><input value={row.draft.codigoBarras || ""} onChange={(event) => updateRow(row.rowId, "codigoBarras", event.target.value)} /></ImportField><ImportField label="IVA compra %" error={errors.tasaImpuestoCompra}><input type="number" inputMode="decimal" min="0" max="100" value={row.draft.tasaImpuestoCompra} placeholder="Revisar" onChange={(event) => updateRow(row.rowId, "tasaImpuestoCompra", event.target.value)} /></ImportField><ImportField label="Stock" error={errors.stock}><input inputMode="decimal" value={row.draft.stock} onChange={(event) => updateRow(row.rowId, "stock", event.target.value)} /></ImportField><ImportField label="Stock mínimo" error={errors.stockMinimo}><input inputMode="decimal" value={row.draft.stockMinimo} onChange={(event) => updateRow(row.rowId, "stockMinimo", event.target.value)} /></ImportField></>}
                        <ImportField label="Descripción" error={errors.descripcion} wide><textarea rows="2" value={row.draft.descripcion || ""} onChange={(event) => updateRow(row.rowId, "descripcion", event.target.value)} /></ImportField>
                      </div>
                      {hasWarnings && <ul className="inventory-row-warnings">{row.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                      <div className="inventory-import-row-actions">
                        <button type="button" className="inventory-link-button" onClick={() => removeRow(row.rowId)}>Eliminar fila</button>
                      </div>
                    </div>
                  </details>
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
