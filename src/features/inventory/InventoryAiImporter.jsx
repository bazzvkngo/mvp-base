import React, { useMemo, useRef, useState } from "react";
import { getInventoryItems } from "../../services/inventoryService";
import {
  ACCEPTED_INVENTORY_FILE_TYPES,
  normalizeInventorySourceWithAi,
  readInventorySourceFile,
  stripInventoryDocumentPayload,
} from "../../services/inventoryAiImportService";
import { importarInventarioEnFirestore } from "../../services/inventoryImportService";
import { formatCLP } from "../../utils/formatters";

const TYPE_OPTIONS = ["producto", "servicio", "actividad"];
const DEFAULT_MARGIN_PERCENT = 25;
const DEFAULT_MARGIN_WARNING =
  "Se aplicó el margen predeterminado del sistema. Puedes modificarlo antes de guardar.";
const DOCUMENT_USAGE_LIMIT_MESSAGE =
  "El servicio inteligente alcanzó el límite de uso disponible. Intenta nuevamente más tarde. El archivo no fue almacenado y ningún registro fue incorporado al inventario.";
const TEMPORARY_DOCUMENT_UNAVAILABLE_MESSAGE =
  "El servicio inteligente está temporalmente ocupado. Espera unos segundos e intenta nuevamente. El archivo no fue almacenado y ningún registro fue incorporado al inventario.";

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeErrorCode(value) {
  return normalizeKey(value).replace(/[^a-z0-9_-]/g, "-");
}

function getCallableErrorCode(error) {
  return normalizeErrorCode(
    [
      error?.code,
      error?.details?.code,
      error?.details?.internalCode,
      error?.customData?.code,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function getSafeAnalysisErrorMessage(error) {
  const code = getCallableErrorCode(error);
  const message = String(error?.message || "").trim();

  if (code.includes("resource-exhausted") || code.includes("daily_quota")) {
    return DOCUMENT_USAGE_LIMIT_MESSAGE;
  }

  if (code.includes("unavailable") && normalizeKey(message).includes("temporalmente ocupado")) {
    return TEMPORARY_DOCUMENT_UNAVAILABLE_MESSAGE;
  }

  if (code.includes("invalid-argument")) {
    return message || "El archivo no pudo validarse.";
  }

  return message || "No se pudo analizar el archivo.";
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

function toDecimal(value) {
  if (value === "" || value === null || value === undefined) return null;
  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function calculatePrice(costoBase, margenDeseado) {
  const cost = toNumber(costoBase);
  const margin = normalizeMarginPercent(margenDeseado);
  if (margin === null) return cost;
  return Math.round(cost + (cost * margin) / 100);
}

function normalizeMarginPercent(value) {
  const parsed = toDecimal(value);
  if (parsed === null) return null;
  if (parsed > 1000 && parsed % 100 === 0) return parsed / 100;
  if (parsed > 1000) return Math.round((parsed / 100) * 100) / 100;
  return Math.round(parsed * 100) / 100;
}

function formatMarginValue(value) {
  const margin = normalizeMarginPercent(value);
  if (margin === null) return "";
  return Number.isInteger(margin) ? String(margin) : String(Math.round(margin * 100) / 100);
}

function calculateMarginFromPrice(costoBase, precioVenta) {
  const cost = toNumber(costoBase);
  const price = toNumber(precioVenta);
  if (cost <= 0 || price <= 0) return null;
  return Math.round(((price - cost) / cost) * 10000) / 100;
}

function normalizeQuantity(value) {
  const parsed = toDecimal(value);
  return parsed && parsed > 0 ? Math.round(parsed * 100) / 100 : 1;
}

function normalizeConfidencePercent(value) {
  const parsed = toDecimal(value);
  if (parsed === null) return null;
  if (parsed >= 0 && parsed <= 1) return Math.round(parsed * 10000) / 100;
  if (parsed > 1 && parsed <= 100) return Math.round(parsed * 100) / 100;
  return null;
}

function formatPercentValue(value) {
  if (value === null || value === undefined) return "";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function normalizeWarningKey(value) {
  return normalizeKey(value).replace(/\s+/g, " ");
}

function dedupeWarnings(warnings) {
  const seen = new Set();
  return (Array.isArray(warnings) ? warnings : warnings ? [warnings] : [])
    .map((warning) => String(warning || "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((warning) => {
      const key = normalizeWarningKey(warning);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size >= 1024 * 1024) return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function getFileFormatLabel(fileData) {
  const extension = String(fileData?.extension || "").toUpperCase();
  if (extension) return extension;
  return fileData?.kind === "document" ? "Documento" : "Planilla";
}

function getAnalysisTypeLabel(fileData) {
  if (fileData?.kind === "document") return "Documental multimodal";
  return "Planilla tabular";
}

function getConfidenceLevel(value) {
  const confidence = normalizeConfidencePercent(value);
  if (confidence === null) {
    return {
      label: "Requiere revisión",
      styleKey: "confidenceLow",
      text: "Requiere revisión",
      value: null,
    };
  }
  if (confidence >= 80) {
    return {
      label: "Alta",
      styleKey: "confidenceHigh",
      text: `Alta - ${formatPercentValue(confidence)}%`,
      value: confidence,
    };
  }
  if (confidence >= 50) {
    return {
      label: "Media",
      styleKey: "confidenceMedium",
      text: `Media - ${formatPercentValue(confidence)}%`,
      value: confidence,
    };
  }
  return {
    label: "Baja",
    styleKey: "confidenceLow",
    text: `Baja - ${formatPercentValue(confidence)}%`,
    value: confidence,
  };
}

function defaultUnit(tipoItem) {
  if (tipoItem === "servicio") return "servicio";
  if (tipoItem === "actividad") return "servicio";
  return "unidad";
}

function getConfidenceText(confidence) {
  if (confidence.text) return confidence.text;
  return `${confidence.label} - ${formatPercentValue(confidence.value)}%`;
}

function getAnalysisWarnings(analysisMeta) {
  if (!analysisMeta) return [];
  return dedupeWarnings([
    analysisMeta.warning,
    ...(Array.isArray(analysisMeta.warnings) ? analysisMeta.warnings : []),
  ]);
}

function getItemDisplayMessages(item) {
  return dedupeWarnings([
    item.observacion,
    ...(Array.isArray(item.advertencias) ? item.advertencias : []),
  ]);
}

function getReviewBadgeText(item, confidence, itemMessages) {
  if (!item.revisionRequerida) return "";
  const confidenceValue = confidence.value;
  const onlyCommercialDefaults =
    confidenceValue !== null &&
    confidenceValue >= 50 &&
    itemMessages.length > 0 &&
    itemMessages.every(
      (message) => normalizeWarningKey(message) === normalizeWarningKey(DEFAULT_MARGIN_WARNING)
    );

  return onlyCommercialDefaults ? "Revisión comercial" : "Requiere revisión";
}

function buildPreviewItem(raw, index, analysisMeta) {
  const isDocument = analysisMeta?.sourceKind === "document" || raw.origenAnalisis === "documento";
  const tipoItem = normalizeTypeValue(raw.tipoItem || raw.tipo) || "producto";
  const costoBase = toNumber(raw.costoBase);
  const rawMargin = raw.margenDeseado ?? raw.margen ?? raw.margenSugerido;
  const rawInternalPrice = raw.precioInterno ?? raw.precioInternoSugerido;
  let margenNormalizado = hasValue(rawMargin)
    ? normalizeMarginPercent(rawMargin)
    : null;
  if (margenNormalizado === null && hasValue(rawInternalPrice)) {
    margenNormalizado = calculateMarginFromPrice(costoBase, rawInternalPrice);
  }
  const appliedDefaultMargin = margenNormalizado === null;
  if (appliedDefaultMargin) {
    margenNormalizado = DEFAULT_MARGIN_PERCENT;
  }
  const precioInterno = calculatePrice(costoBase, margenNormalizado);
  const advertencias = dedupeWarnings([
    ...(Array.isArray(raw.advertencias) ? raw.advertencias : []),
    ...(appliedDefaultMargin ? [DEFAULT_MARGIN_WARNING] : []),
  ]);
  const confidence = normalizeConfidencePercent(raw.confianza ?? raw.nivelConfianza);
  const observacion = String(raw.observacion || raw.justificacion || "").trim();
  const unidad = String(raw.unidad || "").trim() || defaultUnit(tipoItem);
  const cantidadSugerida = normalizeQuantity(
    raw.cantidadSugerida ?? raw.cantidadOrigen ?? raw.cantidad
  );

  return {
    id: `${raw.id || "archivo"}-${index}-${Date.now()}`,
    nombre: raw.nombre || "",
    tipoItem,
    categoria: raw.categoria || (isDocument ? "" : "General"),
    descripcion: raw.descripcion || "",
    unidad,
    cantidadSugerida: String(cantidadSugerida),
    costoBase: String(costoBase),
    margenDeseado: formatMarginValue(margenNormalizado),
    precioInterno: precioInterno > 0 ? String(precioInterno) : "",
    precioManual: false,
    sku: raw.sku || raw.codigo || "",
    observacion,
    advertencias,
    evidenciaOrigen: raw.evidenciaOrigen || "",
    pagina: raw.pagina === null || raw.pagina === undefined ? "" : String(raw.pagina),
    itemSourceKind: isDocument ? "document" : "spreadsheet",
    revisionRequerida:
      raw.revisionRequerida === true ||
      confidence === null ||
      confidence < 50 ||
      costoBase <= 0 ||
      advertencias.length > 0,
    confianza: confidence === null ? "" : String(confidence),
  };
}

function shouldAutoSelectItem(item) {
  if (item.itemSourceKind !== "document") return true;
  return !item.revisionRequerida && toNumber(item.confianza) >= 50;
}

function buildPayloadForSave(item) {
  const tipoItem = normalizeTypeValue(item.tipoItem) || "producto";
  const costoBase = toNumber(item.costoBase);
  const margenDeseado = normalizeMarginPercent(item.margenDeseado) ?? DEFAULT_MARGIN_PERCENT;
  const precioInterno = item.precioInterno
    ? toNumber(item.precioInterno)
    : calculatePrice(costoBase, margenDeseado);
  const cantidad = toNumber(item.cantidadSugerida);

  return {
    nombre: item.nombre.trim(),
    tipoItem,
    categoria: item.categoria.trim() || (item.itemSourceKind === "document" ? "" : "General"),
    descripcion: item.descripcion.trim(),
    unidad: item.unidad.trim() || defaultUnit(tipoItem),
    costoBase,
    margenDeseado: Number.isFinite(margenDeseado) ? margenDeseado : 0,
    precioInterno,
    sku: item.sku.trim() || null,
    stock: item.itemSourceKind === "document" ? null : cantidad > 0 ? cantidad : 1,
    estado: "activo",
    origen:
      item.itemSourceKind === "document"
        ? "importacion_documental_multiformato"
        : "importacion_inteligente_archivo",
    justificacionSugerencia:
      item.itemSourceKind === "document"
        ? "Normalizado desde documento comercial y confirmado en vista previa."
        : item.observacion,
    confianzaPrecio: item.confianza,
  };
}

function InventoryAiImporter({ userId, onImported }) {
  const fileInputRef = useRef(null);
  const analysisInFlightRef = useRef(false);
  const latestAnalysisRequestRef = useRef(0);
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
  const [processingStatus, setProcessingStatus] = useState("");

  const selectedItems = useMemo(
    () => previewItems.filter((item) => selectedIds.has(item.id)),
    [previewItems, selectedIds]
  );
  const analysisWarnings = useMemo(
    () => getAnalysisWarnings(analysisMeta),
    [analysisMeta]
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
      if (skuKey && existingSkus.has(skuKey)) reasons.push("SKU/código ya existe");
      if (selectedIds.has(item.id) && selectedNameCounts.get(nameKey) > 1) {
        reasons.push("nombre repetido en vista previa");
      }
      if (selectedIds.has(item.id) && skuKey && selectedSkuCounts.get(skuKey) > 1) {
        reasons.push("SKU/código repetido en vista previa");
      }
      if (reasons.length) result.set(item.id, reasons.join(", "));
    });

    return result;
  }, [existingItems, previewItems, selectedIds, selectedItems]);

  const hasTemporaryDocumentPayload =
    fileData?.kind !== "document" || Boolean(fileData?.base64);
  const canAnalyze =
    Boolean(fileData) && hasTemporaryDocumentPayload && !readingFile && !loadingAnalysis;
  const canSave = selectedItems.length > 0 && !saving && !loadingAnalysis;

  const resetAnalysis = () => {
    latestAnalysisRequestRef.current += 1;
    analysisInFlightRef.current = false;
    setPreviewItems([]);
    setSelectedIds(new Set());
    setExistingItems([]);
    setAnalysisMeta(null);
    setError("");
    setSuccess("");
    setProcessingStatus("");
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
    if (analysisInFlightRef.current) return;
    resetAnalysis();
    if (!file) return;

    try {
      setReadingFile(true);
      setProcessingStatus("Validando documento.");
      setError("");
      const sourceData = await readInventorySourceFile(file);
      setFileData(sourceData);
      setFileName(file.name);
      setProcessingStatus("Archivo seleccionado.");
    } catch (err) {
      console.error("Error leyendo archivo de inventario:", err);
      setFileData(null);
      setFileName("");
      setProcessingStatus("");
      setError(err.message || "No se pudo leer el archivo.");
    } finally {
      setReadingFile(false);
    }
  };

  const handleAnalyze = async (assistantMode = "auto") => {
    if (analysisInFlightRef.current) return;
    if (!userId) {
      setError("Debes iniciar sesión para importar inventario.");
      return;
    }
    if (!fileData) {
      setError("Selecciona un archivo antes de analizar.");
      return;
    }

    analysisInFlightRef.current = true;
    const requestId = latestAnalysisRequestRef.current + 1;
    latestAnalysisRequestRef.current = requestId;
    setLoadingAnalysis(true);
    setError("");
    setSuccess("");
    setAnalysisMeta(null);
    setPreviewItems([]);
    setSelectedIds(new Set());
    setProcessingStatus("Analizando documento...");

    try {
      const [analysis, currentInventory] = await Promise.all([
        normalizeInventorySourceWithAi({ fileData, assistantMode }),
        getInventoryItems(userId),
      ]);
      if (latestAnalysisRequestRef.current !== requestId) return;
      setProcessingStatus("Preparando vista previa.");
      const items = analysis.items.map((item, index) =>
        buildPreviewItem(item, index, analysis)
      );

      setExistingItems(currentInventory);
      setPreviewItems(items);
      setSelectedIds(new Set(items.filter(shouldAutoSelectItem).map((item) => item.id)));
      setAnalysisMeta(analysis);
      if (fileData.kind === "document") {
        setFileData(stripInventoryDocumentPayload(fileData));
      }
      setProcessingStatus(
        items.length ? "Documento procesado." : "No se identificaron items suficientes."
      );

      if (!items.length) {
        setError("No se detectaron items claros. Revisa el archivo e inténtalo nuevamente.");
      }
    } catch (err) {
      if (latestAnalysisRequestRef.current !== requestId) return;
      console.error("Error normalizando inventario desde archivo:", err);
      setProcessingStatus("Error de análisis.");
      setError(getSafeAnalysisErrorMessage(err));
    } finally {
      if (latestAnalysisRequestRef.current === requestId) {
        analysisInFlightRef.current = false;
        setLoadingAnalysis(false);
      }
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
      setError("Debes iniciar sesión para guardar inventario.");
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
    const missingUnit = selectedItems.find((item) => !item.unidad.trim());
    if (missingUnit) {
      setError("Completa la unidad de los items seleccionados antes de guardar.");
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
            Carga facturas, cotizaciones, listas de precios o inventarios con
            estructuras diferentes. Los resultados deben revisarse antes de
            guardar.
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
            Formatos admitidos: CSV, XLS, XLSX, PDF, JPG, PNG y WebP.
          </p>
          <p style={styles.dropzoneText}>
            El sistema puede analizar facturas, cotizaciones, listas de precios
            e inventarios con estructuras diferentes. Los resultados deben
            revisarse antes de guardar.
          </p>
          {fileName && (
            <p style={styles.fileName}>
              Archivo cargado: <strong>{fileName}</strong>
            </p>
          )}
          {fileData && (
            <p style={styles.fileMeta}>
              Formato: {getFileFormatLabel(fileData)} - Tamaño:{" "}
              {formatFileSize(fileData.tamanoBytes)} - Análisis:{" "}
              {getAnalysisTypeLabel(fileData)}
              {fileData.kind === "spreadsheet" &&
                ` - ${fileData.hojas.length} hoja(s), ${fileData.hojas.reduce(
                  (total, sheet) => total + sheet.filas.length,
                  0
                )} filas.`}
            </p>
          )}
        </div>
        <div style={styles.uploadActions}>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_INVENTORY_FILE_TYPES}
            onChange={(event) => handleFile(event.target.files?.[0])}
            disabled={loadingAnalysis}
            style={styles.hiddenInput}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              ...styles.secondaryButton,
              ...(loadingAnalysis ? styles.disabledButton : {}),
            }}
            disabled={loadingAnalysis}
          >
            Seleccionar archivo
          </button>
        </div>
      </div>

      <p style={styles.warningText}>
        El documento se procesa temporalmente para generar una vista previa y no
        se incorpora al inventario hasta que el usuario confirma los registros.
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
          {loadingAnalysis ? "Analizando..." : "Analizar documento"}
        </button>
        {(fileData || previewItems.length > 0) && (
          <button
            type="button"
            style={{
              ...styles.clearButton,
              ...(loadingAnalysis ? styles.disabledButton : {}),
            }}
            onClick={resetFile}
            disabled={loadingAnalysis}
          >
            Cambiar archivo
          </button>
        )}
      </div>

      {readingFile && <p style={styles.infoText}>Leyendo archivo...</p>}
      {processingStatus && (
        <p style={styles.infoText} aria-live="polite">
          Estado: {processingStatus}
        </p>
      )}

      {analysisMeta && (
        <div style={styles.analysisMeta}>
          <strong>
            Tipo de análisis:{" "}
            {analysisMeta.sourceKind === "document"
              ? "documental multimodal"
              : analysisMeta.source === "gemini"
                ? "planilla asistida"
                : "Análisis local"}
          </strong>
          {analysisMeta.documentType && (
            <span>Tipo de documento: {analysisMeta.documentType}</span>
          )}
          <span>Items detectados: {previewItems.length}</span>
          {analysisWarnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}

      {error && (
        <p style={styles.errorText} aria-live="assertive">
          {error}
        </p>
      )}
      {success && (
        <p style={styles.successText} aria-live="polite">
          {success}
        </p>
      )}

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
                Revisa nombre, unidad, costo, margen y advertencias antes de
                confirmar. Los candidatos con baja confianza no quedan incluidos
                automáticamente.
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
              const itemMessages = getItemDisplayMessages(item);
              const reviewBadgeText = getReviewBadgeText(item, confidence, itemMessages);
              const originText = [
                item.pagina ? `Página ${item.pagina}` : "",
                item.evidenciaOrigen ? item.evidenciaOrigen : "",
              ]
                .filter(Boolean)
                .join(" - ");
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
                      {getConfidenceText(confidence)}
                    </span>
                    {reviewBadgeText && (
                      <span style={styles.reviewBadge}>{reviewBadgeText}</span>
                    )}
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
                      <span style={styles.cardLabel}>SKU / código opcional</span>
                      <input
                        value={item.sku}
                        onChange={(event) =>
                          handleItemChange(item.id, "sku", event.target.value)
                        }
                        style={styles.tableInput}
                      />
                    </label>
                    <label style={styles.cardFieldFull}>
                      <span style={styles.cardLabel}>Descripción</span>
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
                      <span style={styles.cardLabel}>Categoría</span>
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
                            : "Calculado automáticamente"}
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

                  {(itemMessages.length > 0 || duplicateReason || originText) && (
                    <div style={styles.itemNotes}>
                      {itemMessages.map((message) => (
                        <span key={message} style={styles.observationText}>
                          {message}
                        </span>
                      ))}
                      {originText && (
                        <span style={styles.observationText}>
                          Información detectada en el documento: {originText}
                        </span>
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
  reviewBadge: {
    background: "#fef3c7",
    border: "1px solid #f59e0b",
    borderRadius: "999px",
    color: "#92400e",
    display: "inline-flex",
    fontSize: "12px",
    fontWeight: 800,
    padding: "5px 9px",
    width: "fit-content",
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
