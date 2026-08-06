import React, { useRef, useState } from "react";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  INVENTORY_IMPORT_ACCEPT,
  confirmLocalInventoryImport,
  createInventoryImportRequestIdBase,
  downloadInventoryTemplate,
  getInventoryImportSummary,
  readLocalInventoryWorkbook,
  revalidateInventoryImportCodes,
  updateInventoryImportRow,
} from "../../services/inventoryImportService";

function InventoryImportDialog({ areas, businessId, categories, existingItems, onClose, onImported, open }) {
  const inputRef = useRef(null);
  const requestIdBaseRef = useRef("");
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const summary = getInventoryImportSummary(rows);

  const reset = () => {
    setRows([]);
    setFileName("");
    setSheetName("");
    setError("");
    setResult(null);
    requestIdBaseRef.current = "";
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const loadFile = async (file) => {
    if (!file) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const parsed = await readLocalInventoryWorkbook(file, { areas, categories, existingItems });
      requestIdBaseRef.current = createInventoryImportRequestIdBase();
      setRows(parsed.rows);
      setFileName(file.name);
      setSheetName(parsed.sheetName);
    } catch (loadError) {
      setRows([]);
      setError(loadError.message || "No se pudo leer el archivo.");
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (rowId, field, value) => {
    setRows((current) => revalidateInventoryImportCodes(current.map((row) =>
      row.rowId === rowId
        ? updateInventoryImportRow(row, field, value, { areas, categories })
        : row
    ), existingItems));
  };

  const toggleRow = (rowId, included) => {
    setRows((current) => revalidateInventoryImportCodes(current.map((row) =>
      row.rowId === rowId ? { ...row, included } : row
    ), existingItems));
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
      await onImported?.();
    } catch (saveError) {
      if (saveError.partialCreated > 0) {
        setResult({
          created: saveError.partialCreated,
          skipped: rows.length - saveError.partialCreated,
          remaining: saveError.remaining,
          partial: true,
          error: saveError.message || "No se pudieron guardar todos los lotes.",
        });
        await onImported?.({ partial: true });
      } else {
        setError(saveError.message || "No se pudo confirmar la importación.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={close}
      size="large"
      eyebrow="Inventario"
      title="Importar desde Excel"
      description="El archivo se procesa localmente. Nada se guarda hasta tu confirmación."
      footer={rows.length && !result ? (
        <>
          <button type="button" className="inventory-button inventory-button--secondary" onClick={close}>Cancelar</button>
          <button
            type="button"
            className="inventory-button inventory-button--primary"
            disabled={saving || summary.valid === 0 || summary.invalid > 0}
            onClick={confirm}
          >
            {saving ? "Guardando…" : `Confirmar ${summary.valid} fila${summary.valid === 1 ? "" : "s"}`}
          </button>
        </>
      ) : null}
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
              <strong>{loading ? "Leyendo archivo…" : "Arrastra aquí tu XLSX, XLS o CSV"}</strong>
              <span>Máximo 500 filas y 5 MB. Se utilizará la primera hoja con datos.</span>
              <button type="button" className="inventory-button inventory-button--primary" disabled={loading} onClick={() => inputRef.current?.click()}>
                Seleccionar archivo
              </button>
              <input
                ref={inputRef}
                className="inventory-visually-hidden"
                type="file"
                accept={INVENTORY_IMPORT_ACCEPT}
                onChange={(event) => loadFile(event.target.files?.[0])}
              />
            </div>
            <button type="button" className="inventory-link-button" onClick={downloadInventoryTemplate}>Descargar plantilla</button>
          </>
        )}

        {error && <p className="inventory-feedback inventory-feedback--error" role="alert">{error}</p>}

        {result && (
          <div className="inventory-import-result" role="status">
            <h3>{result.partial ? "Importación parcial" : "Importación terminada"}</h3>
            {result.partial
              ? <p><strong>{result.created}</strong> guardados · <strong>{result.remaining}</strong> pendientes.</p>
              : <p><strong>{result.created}</strong> creados · <strong>{result.skipped}</strong> omitidos o inválidos.</p>}
            {result.partial ? (
              <>
                <p>{result.error}</p>
                <p className="inventory-feedback inventory-feedback--error">
                  No vuelvas a importar el archivo completo con una solicitud nueva, porque parte de sus registros ya fue guardada.
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
              <div><strong>{fileName}</strong><span>Hoja: {sheetName}</span></div>
              <div><strong>{summary.valid}</strong><span>válidas</span></div>
              <div><strong>{summary.invalid}</strong><span>con errores</span></div>
              <div><strong>{summary.excluded}</strong><span>excluidas</span></div>
            </div>
            <p className="inventory-import-help">Corrige cada celda marcada o excluye la fila. Las clasificaciones desconocidas son opcionales y no se crean automáticamente.</p>
            <div className="inventory-import-preview">
              {rows.map((row) => {
                const errors = row.fieldErrors || {};
                const areaCategories = categories.filter((category) => category.areaId === row.draft.areaId && (category.estado || "activo") === "activo");
                return (
                  <article key={row.rowId} className={`inventory-import-row${row.included ? "" : " is-excluded"}`}>
                    <header>
                      <label>
                        <input type="checkbox" checked={row.included} onChange={(event) => toggleRow(row.rowId, event.target.checked)} />
                        Fila {row.sourceRow}
                      </label>
                      {Object.keys(errors).length ? <span className="inventory-row-status is-error">Requiere corrección</span> : <span className="inventory-row-status is-valid">Lista para importar</span>}
                    </header>
                    <div className="inventory-import-fields">
                      <ImportField label="Tipo" error={errors.tipoItem}>
                        <select value={row.draft.tipoItem} onChange={(event) => updateRow(row.rowId, "tipoItem", event.target.value)}>
                          <option value="">Revisar tipo</option><option value="producto">Producto</option><option value="servicio">Servicio</option><option value="actividad">Actividad</option>
                        </select>
                      </ImportField>
                      <ImportField label="Nombre" error={errors.nombre}><input value={row.draft.nombre} onChange={(event) => updateRow(row.rowId, "nombre", event.target.value)} /></ImportField>
                      <ImportField label="Código" error={errors.codigoSolicitado}><input value={row.draft.codigoSolicitado} placeholder="Automático si queda vacío" onChange={(event) => updateRow(row.rowId, "codigoSolicitado", event.target.value.toUpperCase())} /></ImportField>
                      <ImportField label="Área" error={errors.areaId}>
                        <select value={row.draft.areaId} onChange={(event) => updateRow(row.rowId, "areaId", event.target.value)}><option value="">Sin área</option>{areas.filter((area) => (area.estado || "activo") === "activo").map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}</select>
                      </ImportField>
                      <ImportField label="Categoría" error={errors.categoriaId}>
                        <select value={row.draft.categoriaId} disabled={!row.draft.areaId} onChange={(event) => updateRow(row.rowId, "categoriaId", event.target.value)}><option value="">Sin categoría</option>{areaCategories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}</select>
                      </ImportField>
                      <ImportField label="Unidad" error={errors.unidad}><input value={row.draft.unidad} onChange={(event) => updateRow(row.rowId, "unidad", event.target.value)} /></ImportField>
                      <ImportField label="Costo base" error={errors.costoBase}><input inputMode="decimal" value={row.draft.costoBase} onChange={(event) => updateRow(row.rowId, "costoBase", event.target.value)} /></ImportField>
                      <ImportField label="Margen %" error={errors.margenDeseado}><input inputMode="decimal" value={row.draft.margenDeseado} onChange={(event) => updateRow(row.rowId, "margenDeseado", event.target.value)} /></ImportField>
                      <ImportField label="Precio manual" error={errors.precioManual}><input inputMode="decimal" value={row.draft.precioManual} onChange={(event) => updateRow(row.rowId, "precioManual", event.target.value)} /></ImportField>
                      {row.draft.tipoItem === "producto" && <><ImportField label="Stock" error={errors.stock}><input inputMode="decimal" value={row.draft.stock} onChange={(event) => updateRow(row.rowId, "stock", event.target.value)} /></ImportField><ImportField label="Stock mínimo" error={errors.stockMinimo}><input inputMode="decimal" value={row.draft.stockMinimo} onChange={(event) => updateRow(row.rowId, "stockMinimo", event.target.value)} /></ImportField></>}
                    </div>
                    {row.warnings?.length > 0 && <ul className="inventory-row-warnings">{row.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
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

function ImportField({ children, error, label }) {
  return <label className={error ? "has-error" : ""}><span>{label}</span>{children}{error && <small>{error}</small>}</label>;
}

export default InventoryImportDialog;
