import React, { useMemo, useRef, useState } from "react";
import { getInventoryItems } from "../../services/inventoryService";
import {
  normalizeInventoryItemsWithAi,
  readInventoryWorkbook,
} from "../../services/inventoryAiImportService";
import { importarInventarioEnFirestore } from "../../services/inventoryImportService";
import { formatCLP } from "../../utils/formatters";

const TYPE_OPTIONS = ["producto", "servicio", "actividad"];

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeTypeValue(value) {
  const normalized = normalizeKey(value);
  return TYPE_OPTIONS.includes(normalized) ? normalized : "";
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function calculatePrice(costoBase, margenDeseado) {
  const cost = toNumber(costoBase);
  const margin = normalizeMarginPercent(margenDeseado);
  if (!Number.isFinite(margin)) return cost;
  return Math.round(cost + (cost * margin) / 100);
}

function normalizeMarginPercent(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed > 1000 && parsed % 100 === 0) return parsed / 100;
  if (parsed > 1000) return Math.round(parsed / 100);
  return Math.max(0, parsed);
}

function formatMarginValue(value) {
  const margin = normalizeMarginPercent(value);
  return Number.isInteger(margin) ? String(margin) : String(Math.round(margin * 100) / 100);
}

function getConfidenceLevel(value) {
  const confidence = toNumber(value);
  if (confidence >= 80) return { label: "Alta", styleKey: "confidenceHigh" };
  if (confidence >= 50) return { label: "Media", styleKey: "confidenceMedium" };
  return { label: "Baja", styleKey: "confidenceLow" };
}

function defaultUnit(tipoItem) {
  if (tipoItem === "servicio") return "servicio";
  if (tipoItem === "actividad") return "hora";
  return "unidad";
}

function buildPreviewItem(raw, index) {
  const tipoItem = normalizeTypeValue(raw.tipoItem || raw.tipo) || "producto";
  const costoBase = toNumber(raw.costoBase);
  const margenDeseado =
    raw.margenDeseado ?? raw.margen ?? raw.margenSugerido ?? 25;
  const margenNormalizado = normalizeMarginPercent(margenDeseado);
  const precioInterno = calculatePrice(costoBase, margenNormalizado);

  return {
    id: `${raw.id || "archivo"}-${index}-${Date.now()}`,
    nombre: raw.nombre || "",
    tipoItem,
    categoria: raw.categoria || "General",
    descripcion: raw.descripcion || "",
    unidad: raw.unidad || defaultUnit(tipoItem),
    cantidadSugerida:
      raw.cantidadSugerida === null || raw.cantidadSugerida === undefined
        ? ""
        : String(raw.cantidadSugerida),
    costoBase: String(costoBase),
    margenDeseado: formatMarginValue(margenNormalizado || 25),
    precioInterno: String(precioInterno),
    precioManual: false,
    sku: raw.sku || raw.codigo || "",
    observacion: raw.observacion || raw.justificacion || "",
    confianza:
      raw.confianza === null || raw.confianza === undefined
        ? ""
        : String(raw.confianza),
  };
}

function buildPayloadForSave(item) {
  const tipoItem = normalizeTypeValue(item.tipoItem) || "producto";
  const costoBase = toNumber(item.costoBase);
  const margenDeseado = normalizeMarginPercent(item.margenDeseado);
  const precioInterno = item.precioInterno
    ? toNumber(item.precioInterno)
    : calculatePrice(costoBase, margenDeseado);
  const cantidad = toNumber(item.cantidadSugerida);

  return {
    nombre: item.nombre.trim(),
    tipoItem,
    categoria: item.categoria.trim() || "General",
    descripcion: item.descripcion.trim(),
    unidad: item.unidad.trim() || defaultUnit(tipoItem),
    costoBase,
    margenDeseado: Number.isFinite(margenDeseado) ? margenDeseado : 0,
    precioInterno,
    sku: item.sku.trim() || null,
    stock: cantidad > 0 ? cantidad : null,
    estado: "activo",
    origen: "importacion_inteligente_archivo",
    justificacionSugerencia: item.observacion,
    confianzaPrecio: item.confianza,
  };
}

function InventoryAiImporter({ userId, onImported }) {
  const fileInputRef = useRef(null);
  const [fileData, setFileData] = useState(null);
  const [fileName, setFileName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [previewItems, setPreviewItems] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [existingItems, setExistingItems] = useState([]);
  const [analysisMeta, setAnalysisMeta] = useState(null);
  const [readingFile, setReadingFile] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedItems = useMemo(
    () => previewItems.filter((item) => selectedIds.has(item.id)),
    [previewItems, selectedIds]
  );

  const duplicateReasonsById = useMemo(() => {
    const existingNames = new Set(existingItems.map((item) => normalizeKey(item.nombre)));
    const existingSkus = new Set(
      existingItems.map((item) => normalizeKey(item.sku)).filter(Boolean)
    );
    const selectedNameCounts = new Map();
    const selectedSkuCounts = new Map();

    selectedItems.forEach((item) => {
      const nameKey = normalizeKey(item.nombre);
      const skuKey = normalizeKey(item.sku);
      if (nameKey) selectedNameCounts.set(nameKey, (selectedNameCounts.get(nameKey) || 0) + 1);
      if (skuKey) selectedSkuCounts.set(skuKey, (selectedSkuCounts.get(skuKey) || 0) + 1);
    });

    const result = new Map();
    previewItems.forEach((item) => {
      const reasons = [];
      const nameKey = normalizeKey(item.nombre);
      const skuKey = normalizeKey(item.sku);

      if (nameKey && existingNames.has(nameKey)) reasons.push("nombre ya existe");
      if (skuKey && existingSkus.has(skuKey)) reasons.push("SKU/codigo ya existe");
      if (selectedIds.has(item.id) && selectedNameCounts.get(nameKey) > 1) {
        reasons.push("nombre repetido en vista previa");
      }
      if (selectedIds.has(item.id) && skuKey && selectedSkuCounts.get(skuKey) > 1) {
        reasons.push("SKU/codigo repetido en vista previa");
      }
      if (reasons.length) result.set(item.id, reasons.join(", "));
    });

    return result;
  }, [existingItems, previewItems, selectedIds, selectedItems]);

  const canAnalyze = Boolean(fileData) && !readingFile && !loadingAnalysis;
  const canSave = selectedItems.length > 0 && !saving && !loadingAnalysis;

  const resetAnalysis = () => {
    setPreviewItems([]);
    setSelectedIds(new Set());
    setExistingItems([]);
    setAnalysisMeta(null);
    setError("");
    setSuccess("");
  };

  const resetFile = () => {
    setFileData(null);
    setFileName("");
    resetAnalysis();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFile = async (file) => {
    resetAnalysis();
    if (!file) return;

    try {
      setReadingFile(true);
      setError("");
      const workbookData = await readInventoryWorkbook(file);
      setFileData(workbookData);
      setFileName(file.name);
    } catch (err) {
      console.error("Error leyendo archivo de inventario:", err);
      setFileData(null);
      setFileName("");
      setError(err.message || "No se pudo leer el archivo.");
    } finally {
      setReadingFile(false);
    }
  };

  const handleAnalyze = async (assistantMode = "auto") => {
    if (!userId) {
      setError("Debes iniciar sesion para importar inventario.");
      return;
    }
    if (!fileData) {
      setError("Selecciona un archivo antes de analizar.");
      return;
    }

    setLoadingAnalysis(true);
    setError("");
    setSuccess("");
    setAnalysisMeta(null);
    setPreviewItems([]);
    setSelectedIds(new Set());

    try {
      const [analysis, currentInventory] = await Promise.all([
        normalizeInventoryItemsWithAi({ fileData, assistantMode }),
        getInventoryItems(userId),
      ]);
      const items = analysis.items.map(buildPreviewItem);

      setExistingItems(currentInventory);
      setPreviewItems(items);
      setSelectedIds(new Set(items.map((item) => item.id)));
      setAnalysisMeta(analysis);

      if (!items.length) {
        setError("No se detectaron items claros. Revisa el archivo e intentalo nuevamente.");
      }
    } catch (err) {
      console.error("Error normalizando inventario desde archivo:", err);
      setError(err.message || "No se pudo analizar el archivo.");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const handleItemChange = (id, field, value) => {
    setPreviewItems((items) =>
      items.map((item) => {
        if (item.id !== id) return item;

        const next = {
          ...item,
          [field]: field === "margenDeseado" ? formatMarginValue(value) : value,
        };
        if (field === "tipoItem" && !next.unidad) {
          next.unidad = defaultUnit(value);
        }
        if (
          (field === "costoBase" || field === "margenDeseado") &&
          !next.precioManual
        ) {
          next.precioInterno = String(calculatePrice(next.costoBase, next.margenDeseado));
        }
        if (field === "precioManual" && !value) {
          next.precioInterno = String(calculatePrice(next.costoBase, next.margenDeseado));
        }
        return next;
      })
    );
  };

  const toggleSelected = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeItem = (id) => {
    setPreviewItems((items) => items.filter((item) => item.id !== id));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!userId) {
      setError("Debes iniciar sesion para guardar inventario.");
      return;
    }
    if (!selectedItems.length) {
      setError("Selecciona al menos un item para guardar.");
      return;
    }

    const unnamed = selectedItems.find((item) => !item.nombre.trim());
    if (unnamed) {
      setError("No se pueden guardar items sin nombre.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const payload = selectedItems.map(buildPayloadForSave);
      const result = await importarInventarioEnFirestore(userId, payload);

      if (result.total > 0 && result.verifiedCount < result.total) {
        throw new Error(
          `Se confirmo la importacion de ${result.verifiedCount} de ${result.total} items.`
        );
      }

      setSuccess(`Se guardaron ${result.total} items normalizados en inventario.`);
      setPreviewItems([]);
      setSelectedIds(new Set());
      setAnalysisMeta(null);
      if (onImported) onImported();
    } catch (err) {
      console.error("Error guardando importacion inteligente:", err);
      setError(err.message || "No se pudieron guardar los items.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <span style={styles.eyebrow}>Importacion inteligente</span>
          <h2 style={styles.title}>Importador inteligente de inventario</h2>
          <p style={styles.subtitle}>
            Carga una factura, cotizacion de proveedor, lista de precios o
            inventario en Excel/CSV. ValoraCloud analizara el archivo,
            normalizara los items y te permitira revisarlos antes de guardarlos.
          </p>
        </div>
      </div>

      <div
        style={{
          ...styles.dropzone,
          ...(dragActive ? styles.dropzoneActive : {}),
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          handleFile(event.dataTransfer.files?.[0]);
        }}
      >
        <div>
          <strong>Selecciona o arrastra un archivo</strong>
          <p style={styles.dropzoneText}>
            Formatos aceptados: .xlsx, .xls, .csv. No necesita usar plantilla.
          </p>
          {fileName && (
            <p style={styles.fileName}>
              Archivo cargado: <strong>{fileName}</strong>
            </p>
          )}
          {fileData && (
            <p style={styles.fileMeta}>
              {fileData.hojas.length} hoja(s) legible(s),{" "}
              {fileData.hojas.reduce((total, sheet) => total + sheet.filas.length, 0)} filas.
            </p>
          )}
        </div>
        <div style={styles.uploadActions}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(event) => handleFile(event.target.files?.[0])}
            style={styles.hiddenInput}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={styles.secondaryButton}
          >
            Seleccionar archivo
          </button>
        </div>
      </div>

      <p style={styles.warningText}>
        Los valores detectados son estimaciones y deben ser revisados antes de guardar.
      </p>

      <div style={styles.actions}>
        <button
          type="button"
          style={{
            ...styles.primaryButton,
            ...(!canAnalyze ? styles.disabledButton : {}),
          }}
          onClick={() => handleAnalyze("auto")}
          disabled={!canAnalyze}
        >
          {loadingAnalysis ? "Analizando..." : "Analizar con IA"}
        </button>
        <button
          type="button"
          style={styles.secondaryButton}
          onClick={() => handleAnalyze("local")}
          disabled={!fileData || loadingAnalysis}
        >
          Analizar sin IA externa
        </button>
        {(fileData || previewItems.length > 0) && (
          <button type="button" style={styles.clearButton} onClick={resetFile}>
            Cambiar archivo
          </button>
        )}
      </div>

      {readingFile && <p style={styles.infoText}>Leyendo archivo...</p>}

      {analysisMeta && (
        <div style={styles.analysisMeta}>
          <strong>
            Fuente: {analysisMeta.source === "gemini" ? "Gemini" : "analisis local"}
          </strong>
          {analysisMeta.model && <span>Modelo: {analysisMeta.model}</span>}
          {analysisMeta.warning && <span>{analysisMeta.warning}</span>}
        </div>
      )}

      {error && <p style={styles.errorText}>{error}</p>}
      {success && <p style={styles.successText}>{success}</p>}

      {previewItems.length > 0 && (
        <div style={styles.previewBlock}>
          <div style={styles.previewHeader}>
            <div>
              <h3 style={styles.previewTitle}>Vista previa editable</h3>
              <p style={styles.previewSubtitle}>
                Revisa los items detectados antes de guardarlos. Puedes editar
                los datos, desmarcar los que no quieras importar o quitarlos de
                la vista previa.
              </p>
              <p style={styles.previewNote}>
                Los costos y margenes fueron detectados automaticamente. El
                precio interno se calcula desde el costo base y el margen.
              </p>
            </div>
            <div style={styles.previewActions}>
              <button type="button" style={styles.clearButton} onClick={resetAnalysis}>
                Cancelar
              </button>
              <button
                type="button"
                style={{
                  ...styles.primaryButton,
                  ...(!canSave ? styles.disabledButton : {}),
                }}
                onClick={handleSave}
                disabled={!canSave}
              >
                {saving ? "Guardando..." : `Guardar items incluidos (${selectedItems.length})`}
              </button>
            </div>
          </div>

          <div style={styles.previewCards}>
            {previewItems.map((item) => {
              const duplicateReason = duplicateReasonsById.get(item.id);
              const confidence = getConfidenceLevel(item.confianza);
              const costWarning = toNumber(item.costoBase) <= 0 ? item.observacion : "";
              return (
                <article key={item.id} style={styles.previewCard}>
                  <div style={styles.itemCardHeader}>
                    <label style={styles.saveToggle}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                      />
                      Incluir
                    </label>
                    <div style={styles.itemTitleBlock}>
                      <strong style={styles.itemTitle}>
                        {item.nombre || "Item sin nombre"}
                      </strong>
                      {item.sku && <span style={styles.itemSku}>SKU: {item.sku}</span>}
                    </div>
                    <span style={styles.typeBadge}>{item.tipoItem}</span>
                    <span
                      style={{
                        ...styles.confidenceBadge,
                        ...styles[confidence.styleKey],
                      }}
                    >
                      {confidence.label} · {toNumber(item.confianza)}%
                    </span>
                    <button
                      type="button"
                      style={styles.removeButton}
                      onClick={() => removeItem(item.id)}
                    >
                      Quitar
                    </button>
                  </div>

                  <div style={styles.cardMainFields}>
                    <label style={styles.cardFieldWide}>
                      <span style={styles.cardLabel}>Nombre</span>
                      <input
                        value={item.nombre}
                        onChange={(event) =>
                          handleItemChange(item.id, "nombre", event.target.value)
                        }
                        style={styles.tableInput}
                      />
                    </label>
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>SKU / codigo opcional</span>
                      <input
                        value={item.sku}
                        onChange={(event) =>
                          handleItemChange(item.id, "sku", event.target.value)
                        }
                        style={styles.tableInput}
                      />
                    </label>
                    <label style={styles.cardFieldFull}>
                      <span style={styles.cardLabel}>Descripcion</span>
                      <textarea
                        value={item.descripcion}
                        onChange={(event) =>
                          handleItemChange(item.id, "descripcion", event.target.value)
                        }
                        rows={2}
                        style={styles.tableTextarea}
                      />
                    </label>
                  </div>

                  <div style={styles.cardFieldsGrid}>
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>Tipo</span>
                      <select
                        value={item.tipoItem}
                        onChange={(event) =>
                          handleItemChange(item.id, "tipoItem", event.target.value)
                        }
                        style={styles.tableInput}
                      >
                        {TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>Categoria</span>
                      <input
                        value={item.categoria}
                        onChange={(event) =>
                          handleItemChange(item.id, "categoria", event.target.value)
                        }
                        style={styles.tableInput}
                      />
                    </label>
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>Unidad</span>
                      <input
                        value={item.unidad}
                        onChange={(event) =>
                          handleItemChange(item.id, "unidad", event.target.value)
                        }
                        style={styles.tableInput}
                      />
                    </label>
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>Cantidad</span>
                      <input
                        value={item.cantidadSugerida}
                        onChange={(event) =>
                          handleItemChange(item.id, "cantidadSugerida", event.target.value)
                        }
                        style={styles.tableInput}
                      />
                    </label>
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>Costo base</span>
                      <input
                        value={item.costoBase}
                        onChange={(event) =>
                          handleItemChange(item.id, "costoBase", event.target.value)
                        }
                        style={styles.tableInput}
                      />
                    </label>
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>Margen %</span>
                      <input
                        value={item.margenDeseado}
                        onChange={(event) =>
                          handleItemChange(item.id, "margenDeseado", event.target.value)
                        }
                        style={styles.tableInput}
                      />
                    </label>
                    <div style={styles.cardField}>
                      <span style={styles.cardLabel}>Precio interno calculado</span>
                      <div style={styles.calculatedPriceBox}>
                        {item.precioManual ? (
                          <input
                            value={item.precioInterno}
                            onChange={(event) =>
                              handleItemChange(
                                item.id,
                                "precioInterno",
                                event.target.value
                              )
                            }
                            style={styles.tableInput}
                          />
                        ) : (
                          <strong style={styles.calculatedPriceValue}>
                            {formatCLP(item.precioInterno)}
                          </strong>
                        )}
                        <span style={styles.priceHint}>
                          {item.precioManual
                            ? "Ajuste manual activo"
                            : "Calculado automaticamente"}
                        </span>
                        <label style={styles.manualPriceToggle}>
                          <input
                            type="checkbox"
                            checked={item.precioManual}
                            onChange={(event) =>
                              handleItemChange(
                                item.id,
                                "precioManual",
                                event.target.checked
                              )
                            }
                          />
                          Ajustar precio manualmente
                        </label>
                      </div>
                    </div>
                  </div>

                  {(costWarning || duplicateReason) && (
                    <div style={styles.itemNotes}>
                      {costWarning && (
                        <span style={styles.observationText}>{costWarning}</span>
                      )}
                      {duplicateReason && (
                        <span style={styles.duplicateText}>{duplicateReason}</span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div style={styles.previewFooterActions}>
            <button type="button" style={styles.clearButton} onClick={resetAnalysis}>
              Cancelar
            </button>
            <button
              type="button"
              style={{
                ...styles.primaryButton,
                ...(!canSave ? styles.disabledButton : {}),
              }}
              onClick={handleSave}
              disabled={!canSave}
            >
              {saving ? "Guardando..." : `Guardar items incluidos (${selectedItems.length})`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const styles = {
  card: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    color: "#111827",
    marginBottom: "18px",
    padding: "20px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    marginBottom: "16px",
  },
  eyebrow: {
    color: "#0f766e",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    margin: "0 0 6px",
  },
  subtitle: {
    color: "#64748b",
    fontSize: "14px",
    lineHeight: 1.5,
    margin: 0,
    maxWidth: "860px",
  },
  dropzone: {
    alignItems: "center",
    background: "#f8fafc",
    border: "1px dashed #94a3b8",
    borderRadius: "8px",
    display: "flex",
    flexWrap: "wrap",
    gap: "14px",
    justifyContent: "space-between",
    padding: "18px",
  },
  dropzoneActive: {
    background: "#ecfdf5",
    borderColor: "#0f766e",
  },
  dropzoneText: {
    color: "#64748b",
    fontSize: "13px",
    margin: "4px 0 0",
  },
  fileName: {
    color: "#0f172a",
    fontSize: "13px",
    margin: "10px 0 0",
  },
  fileMeta: {
    color: "#64748b",
    fontSize: "12px",
    margin: "4px 0 0",
  },
  uploadActions: {
    display: "flex",
    gap: "10px",
  },
  hiddenInput: {
    display: "none",
  },
  warningText: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "8px",
    color: "#92400e",
    fontSize: "13px",
    margin: "12px 0 0",
    padding: "10px 12px",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "12px",
  },
  primaryButton: {
    backgroundColor: "#0f766e",
    border: "1px solid #0f766e",
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    padding: "9px 12px",
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    padding: "9px 12px",
  },
  clearButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    padding: "9px 12px",
  },
  disabledButton: {
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    color: "#64748b",
    cursor: "not-allowed",
  },
  infoText: {
    color: "#64748b",
    fontSize: "14px",
    margin: "10px 0 0",
  },
  analysisMeta: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    color: "#475569",
    display: "grid",
    fontSize: "13px",
    gap: "3px",
    marginTop: "12px",
    padding: "10px 12px",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: "14px",
    margin: "10px 0 0",
  },
  successText: {
    color: "#047857",
    fontSize: "14px",
    margin: "10px 0 0",
  },
  previewBlock: {
    display: "grid",
    gap: "12px",
    marginTop: "18px",
  },
  previewHeader: {
    alignItems: "flex-start",
    display: "flex",
    flexWrap: "wrap",
    gap: "14px",
    justifyContent: "space-between",
  },
  previewActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "flex-end",
  },
  previewTitle: {
    fontSize: "16px",
    fontWeight: 800,
    margin: "0 0 4px",
  },
  previewSubtitle: {
    color: "#64748b",
    fontSize: "13px",
    margin: 0,
  },
  previewNote: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    color: "#475569",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: "10px 0 0",
    padding: "9px 11px",
  },
  previewCards: {
    display: "grid",
    gap: "12px",
  },
  previewCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    display: "grid",
    gap: "14px",
    padding: "14px",
  },
  itemCardHeader: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },
  saveToggle: {
    alignItems: "center",
    color: "#334155",
    display: "inline-flex",
    fontSize: "13px",
    fontWeight: 800,
    gap: "7px",
  },
  itemTitleBlock: {
    display: "grid",
    flex: "1 1 240px",
    gap: "2px",
    minWidth: 0,
  },
  itemTitle: {
    color: "#0f172a",
    fontSize: "15px",
    lineHeight: 1.35,
  },
  itemSku: {
    color: "#64748b",
    fontSize: "12px",
  },
  typeBadge: {
    background: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    color: "#334155",
    fontSize: "12px",
    fontWeight: 800,
    padding: "5px 9px",
  },
  cardMainFields: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "minmax(220px, 2fr) minmax(180px, 1fr)",
  },
  cardFieldsGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  },
  cardField: {
    display: "grid",
    gap: "5px",
    minWidth: 0,
  },
  cardFieldWide: {
    display: "grid",
    gap: "5px",
    minWidth: 0,
  },
  cardFieldFull: {
    display: "grid",
    gap: "5px",
    gridColumn: "1 / -1",
    minWidth: 0,
  },
  cardLabel: {
    color: "#475569",
    fontSize: "12px",
    fontWeight: 800,
  },
  itemNotes: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    display: "grid",
    gap: "4px",
    padding: "9px 10px",
  },
  previewFooterActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "flex-end",
  },
  tableInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#111827",
    fontSize: "12px",
    minHeight: "34px",
    padding: "7px 8px",
    width: "100%",
  },
  tableTextarea: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#111827",
    fontSize: "12px",
    padding: "7px 8px",
    resize: "vertical",
    width: "100%",
  },
  duplicateText: {
    color: "#b91c1c",
    display: "block",
    fontSize: "11px",
    fontWeight: 700,
    marginTop: "4px",
  },
  observationText: {
    color: "#64748b",
    display: "block",
    fontSize: "11px",
    lineHeight: 1.35,
    marginTop: "4px",
  },
  priceHint: {
    color: "#64748b",
    display: "block",
    fontSize: "11px",
    marginTop: "4px",
    whiteSpace: "nowrap",
  },
  calculatedPriceBox: {
    display: "grid",
    gap: "4px",
    minWidth: "150px",
  },
  calculatedPriceValue: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    color: "#0f172a",
    display: "block",
    minHeight: "34px",
    padding: "8px",
    whiteSpace: "nowrap",
  },
  manualPriceToggle: {
    alignItems: "flex-start",
    color: "#475569",
    display: "flex",
    fontSize: "11px",
    gap: "5px",
    lineHeight: 1.25,
    marginTop: "2px",
  },
  confidenceBadge: {
    borderRadius: "999px",
    display: "inline-flex",
    fontSize: "12px",
    fontWeight: 800,
    padding: "5px 9px",
    width: "fit-content",
  },
  confidenceHigh: {
    background: "#dcfce7",
    color: "#166534",
  },
  confidenceMedium: {
    background: "#fef3c7",
    color: "#92400e",
  },
  confidenceLow: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  confidencePercent: {
    color: "#64748b",
    display: "block",
    fontSize: "11px",
    marginTop: "5px",
  },
  removeButton: {
    background: "#fffafa",
    border: "1px solid #fecaca",
    borderRadius: "6px",
    color: "#991b1b",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
    padding: "7px 9px",
  },
};

export default InventoryAiImporter;
