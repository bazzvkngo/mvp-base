import React, { useMemo, useRef, useState } from "react";
import AiAvailabilityStatus from "../../components/ai/AiAvailabilityStatus";
import { AI_MODELS } from "../../config/aiModels";
import useAiRateLimit from "../../hooks/useAiRateLimit";
import {
  getInventoryAreas,
  getInventoryCategories,
  getInventoryItems,
} from "../../services/inventoryService";
import {
  ACCEPTED_INVENTORY_FILE_TYPES,
  confirmInventoryImportV2,
  getInventoryImportAiRateLimitStatus,
  normalizeInventorySourceWithAi,
  readInventorySourceFile,
  stripInventoryDocumentPayload,
} from "../../services/inventoryAiImportService";
import {
  createMissingAiRateLimitStatusError,
  getAiAvailabilityErrorStatus,
  getSafeInventoryAiLogDetails,
  runInventoryAnalysisSingleFlight,
  translateInventoryAiError,
} from "../../services/inventoryAiClient.mjs";
import {
  MAX_INVENTORY_IMPORT_BATCH_SIZE,
  getInventoryImportCategoriesForArea,
  keepInventoryImportCategoryForArea,
  normalizeInventoryImportType,
  resolveInventoryImportCatalog,
  stripProductFieldsForInventoryImport,
  validateInventoryImportPreviewRow,
} from "../../domain/inventoryImportV2.mjs";
import { formatCLP } from "../../utils/formatters";

const TYPE_OPTIONS = ["producto", "servicio", "actividad"];
const DEFAULT_MARGIN_PERCENT = 25;
const DEFAULT_MARGIN_WARNING =
  "Se aplicó el margen predeterminado del sistema. Puedes modificarlo antes de guardar.";

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function getSourceRowCount(fileData) {
  if (!Array.isArray(fileData?.hojas)) return 0;
  return fileData.hojas.reduce(
    (total, sheet) => total + (Array.isArray(sheet?.filas) ? sheet.filas.length : 0),
    0
  );
}

function normalizeTypeValue(value) {
  return normalizeInventoryImportType(value);
}

function createImportRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function formatOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return "";
  const parsed = toDecimal(value);
  return parsed === null ? "" : String(parsed);
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

function buildPreviewItem(raw, index, analysisMeta, areas, categories) {
  const isDocument = analysisMeta?.sourceKind === "document" || raw.origenAnalisis === "documento";
  const tipoItem = normalizeTypeValue(raw.tipoItem || raw.tipo);
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
  const catalogResolution = resolveInventoryImportCatalog(raw, areas, categories);
  const rowId = `fila-${Date.now()}-${index + 1}`;
  const productFields =
    tipoItem === "producto"
      ? {
          marca: String(raw.marca || "").trim(),
          modelo: String(raw.modelo || "").trim(),
          stock: formatOptionalNumber(
            raw.stock ?? raw.stockActual ?? raw.cantidadSugerida ?? raw.cantidadOrigen
          ),
          stockMinimo: formatOptionalNumber(
            raw.stockMinimo ?? raw.stockMin
          ),
          codigoBarras: String(
            raw.codigoBarras || raw.ean || raw.upc || ""
          ).trim(),
        }
      : {};

  return {
    id: rowId,
    nombre: raw.nombre || "",
    tipoItem,
    ...catalogResolution,
    descripcion: raw.descripcion || "",
    unidad,
    cantidadSugerida: String(cantidadSugerida),
    costoBase: String(costoBase),
    margenDeseado: formatMarginValue(margenNormalizado),
    precioInterno: precioInterno > 0 ? String(precioInterno) : "",
    precioManual: false,
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
    ...productFields,
  };
}

function shouldAutoSelectItem(item) {
  if (item.itemSourceKind !== "document") return true;
  return !item.revisionRequerida && toNumber(item.confianza) >= 50;
}

function buildPayloadForSave(item) {
  const tipoItem = normalizeTypeValue(item.tipoItem);
  const costoBase = toNumber(item.costoBase);
  const margenDeseado = normalizeMarginPercent(item.margenDeseado) ?? DEFAULT_MARGIN_PERCENT;
  const precioInterno = item.precioInterno
    ? toNumber(item.precioInterno)
    : calculatePrice(costoBase, margenDeseado);
  const payload = {
    nombre: item.nombre.trim(),
    tipoItem,
    areaId: item.areaId,
    categoriaId: item.categoriaId,
    descripcion: item.descripcion.trim(),
    unidad: item.unidad.trim() || defaultUnit(tipoItem),
    costoBase,
    margenDeseado: Number.isFinite(margenDeseado) ? margenDeseado : 0,
    precioInterno,
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
  if (tipoItem === "producto") {
    payload.marca = item.marca.trim();
    payload.modelo = item.modelo.trim();
    payload.stock = Number(item.stock);
    payload.stockMinimo = Number(item.stockMinimo);
    const codigoBarras = item.codigoBarras.trim();
    if (codigoBarras) payload.codigoBarras = codigoBarras;
  }
  return payload;
}

function InventoryAiImporter({ userId, onImported }) {
  const fileInputRef = useRef(null);
  const analysisInFlightRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const saveRequestIdRef = useRef("");
  const latestAnalysisRequestRef = useRef(0);
  const [fileData, setFileData] = useState(null);
  const [fileName, setFileName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [previewItems, setPreviewItems] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [existingItems, setExistingItems] = useState([]);
  const [areas, setAreas] = useState([]);
  const [categories, setCategories] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [analysisMeta, setAnalysisMeta] = useState(null);
  const [readingFile, setReadingFile] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveBackendCompatible, setSaveBackendCompatible] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [processingStatus, setProcessingStatus] = useState("");
  const rateLimitModel =
    fileData?.kind === "spreadsheet"
      ? AI_MODELS.quoteSuggestions
      : AI_MODELS.documentImport;
  const aiAvailability = useAiRateLimit(rateLimitModel, {
    enabled: Boolean(userId),
    getErrorStatus: getAiAvailabilityErrorStatus,
    getStatus: getInventoryImportAiRateLimitStatus,
  });

  const selectedItems = useMemo(
    () => previewItems.filter((item) => selectedIds.has(item.id)),
    [previewItems, selectedIds]
  );
  const analysisWarnings = useMemo(
    () => getAnalysisWarnings(analysisMeta),
    [analysisMeta]
  );
  const rowErrorsById = useMemo(() => {
    const result = new Map();
    previewItems.forEach((item) => {
      const errors = validateInventoryImportPreviewRow(item, areas, categories);
      if (errors.length) result.set(item.id, errors);
    });
    return result;
  }, [areas, categories, previewItems]);
  const invalidSelectedItems = useMemo(
    () => selectedItems.filter((item) => rowErrorsById.has(item.id)),
    [rowErrorsById, selectedItems]
  );
  const activeAreas = useMemo(
    () => areas.filter((area) => (area.estado || "activo") === "activo"),
    [areas]
  );

  const duplicateReasonsById = useMemo(() => {
    const existingNames = new Set(existingItems.map((item) => normalizeKey(item.nombre)));
    const selectedNameCounts = new Map();

    selectedItems.forEach((item) => {
      const nameKey = normalizeKey(item.nombre);
      if (nameKey) selectedNameCounts.set(nameKey, (selectedNameCounts.get(nameKey) || 0) + 1);
    });

    const result = new Map();
    previewItems.forEach((item) => {
      const reasons = [];
      const nameKey = normalizeKey(item.nombre);

      if (nameKey && existingNames.has(nameKey)) reasons.push("nombre ya existe");
      if (selectedIds.has(item.id) && selectedNameCounts.get(nameKey) > 1) {
        reasons.push("nombre repetido en vista previa");
      }
      if (reasons.length) result.set(item.id, reasons.join(", "));
    });

    return result;
  }, [existingItems, previewItems, selectedIds, selectedItems]);

  const hasTemporaryDocumentPayload =
    fileData?.kind !== "document" || Boolean(fileData?.base64);
  const canAnalyze =
    Boolean(fileData) &&
    hasTemporaryDocumentPayload &&
    !readingFile &&
    !loadingAnalysis &&
    !aiAvailability.isBlocked;
  const canSave =
    selectedItems.length > 0 &&
    invalidSelectedItems.length === 0 &&
    selectedItems.length <= MAX_INVENTORY_IMPORT_BATCH_SIZE &&
    !catalogError &&
    saveBackendCompatible &&
    !saving &&
    !loadingAnalysis;

  const resetAnalysis = () => {
    latestAnalysisRequestRef.current += 1;
    analysisInFlightRef.current = false;
    setPreviewItems([]);
    setSelectedIds(new Set());
    setExistingItems([]);
    setAreas([]);
    setCategories([]);
    setCatalogError("");
    setAnalysisMeta(null);
    setError("");
    setSuccess("");
    setProcessingStatus("");
    saveRequestIdRef.current = "";
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

    const startedAt = Date.now();

    try {
      setReadingFile(true);
      setProcessingStatus("Validando documento.");
      setError("");
      const sourceData = await readInventorySourceFile(file);
      setFileData(sourceData);
      setFileName(file.name);
      setProcessingStatus("Archivo seleccionado.");
    } catch (err) {
      console.error(
        "Inventory import file read failed",
        getSafeInventoryAiLogDetails(err, {
          stage: "read_file",
          durationMs: Date.now() - startedAt,
        })
      );
      setFileData(null);
      setFileName("");
      setProcessingStatus("");
      setError(translateInventoryAiError(err).message);
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
    const usesGemini = assistantMode !== "local";
    if (usesGemini && !aiAvailability.begin()) return;

    const requestId = latestAnalysisRequestRef.current + 1;
    latestAnalysisRequestRef.current = requestId;
    const startedAt = Date.now();
    const rowCount = getSourceRowCount(fileData);

    await runInventoryAnalysisSingleFlight(
      analysisInFlightRef,
      async () => {
        try {
          setProcessingStatus("Validando catálogo y sesión.");
          let currentInventory;
          let currentAreas;
          let currentCategories;
          try {
            [currentInventory, currentAreas, currentCategories] = await Promise.all([
              getInventoryItems(userId),
              getInventoryAreas(userId),
              getInventoryCategories(userId),
            ]);
          } catch (catalogLoadError) {
            const catalogUnavailableError = new Error(
              "No fue posible cargar el catálogo de Áreas y Categorías."
            );
            catalogUnavailableError.code = catalogLoadError?.code || "unavailable";
            catalogUnavailableError.details = {
              internalCode: "inventory_import_catalog_unavailable",
            };
            throw catalogUnavailableError;
          }
          if (currentAreas.length === 0 || currentCategories.length === 0) {
            const catalogUnavailableError = new Error(
              "El catálogo de Áreas y Categorías no está disponible. Inicialízalo y agrega al menos una Categoría antes de analizar."
            );
            catalogUnavailableError.code =
              "inventory-import/catalog-unavailable";
            catalogUnavailableError.details = {
              internalCode: "inventory_import_catalog_unavailable",
            };
            throw catalogUnavailableError;
          }
          setCatalogError("");
          setProcessingStatus("Analizando documento...");
          const analysis = await normalizeInventorySourceWithAi({
            fileData,
            assistantMode,
          });
          if (latestAnalysisRequestRef.current !== requestId) return;
          setProcessingStatus("Preparando vista previa.");
          const items = analysis.items.map((item, index) =>
            buildPreviewItem(
              item,
              index,
              analysis,
              currentAreas,
              currentCategories
            )
          );

          setExistingItems(currentInventory);
          setAreas(currentAreas);
          setCategories(currentCategories);
          setPreviewItems(items);
          setSelectedIds(
            new Set(items.filter(shouldAutoSelectItem).map((item) => item.id))
          );
          setAnalysisMeta(analysis);
          if (analysis.aiRateLimit) {
            aiAvailability.applySuccess(analysis.aiRateLimit);
          } else {
            aiAvailability.applyError(createMissingAiRateLimitStatusError());
          }
          if (fileData.kind === "document") {
            setFileData(stripInventoryDocumentPayload(fileData));
          }
          setProcessingStatus(
            items.length
              ? "Documento procesado."
              : "No se identificaron items suficientes."
          );

          if (!items.length) {
            setError(
              "No se detectaron items claros. Revisa el archivo e inténtalo nuevamente."
            );
          }
        } catch (err) {
          if (latestAnalysisRequestRef.current !== requestId) return;
          console.error(
            "Inventory AI analysis failed",
            getSafeInventoryAiLogDetails(err, {
              stage: "analyze_callable",
              rowCount,
              durationMs: Date.now() - startedAt,
            })
          );
          const isCatalogFailure =
            err?.details?.internalCode ===
              "inventory_import_catalog_unavailable" ||
            String(err?.code || "").includes("catalog-unavailable");
          if (!isCatalogFailure) aiAvailability.applyError(err);
          setProcessingStatus("Error de análisis.");
          if (isCatalogFailure) {
            const catalogMessage = err.message;
            setCatalogError(catalogMessage);
            setError(catalogMessage);
          } else {
            setError(translateInventoryAiError(err).message);
          }
        }
      },
      {
        onStart: () => {
          setLoadingAnalysis(true);
          setPreviewItems([]);
          setSelectedIds(new Set());
          setAnalysisMeta(null);
          setAreas([]);
          setCategories([]);
          setCatalogError("");
          saveRequestIdRef.current = "";
          setError("");
          setSuccess("");
          setProcessingStatus("Analizando documento...");
        },
        onFinish: () => {
          if (latestAnalysisRequestRef.current === requestId) {
            setLoadingAnalysis(false);
          }
        },
      }
    );
  };

  const handleItemChange = (id, field, value) => {
    saveRequestIdRef.current = "";
    setPreviewItems((items) =>
      items.map((item) => {
        if (item.id !== id) return item;

        let next = {
          ...item,
          [field]: field === "margenDeseado" ? formatMarginValue(value) : value,
        };
        if (field === "areaId") {
          const area = areas.find((entry) => entry.id === value);
          const compatibleCategoryId = keepInventoryImportCategoryForArea(
            categories,
            value,
            item.categoriaId
          );
          next.areaPropuesta = area?.nombre || "";
          next.areaResolutionStatus = value ? "resolved" : "missing";
          next.categoriaId = compatibleCategoryId;
          next.categoriaPropuesta = compatibleCategoryId
            ? categories.find((entry) => entry.id === compatibleCategoryId)?.nombre || ""
            : "";
          next.categoryResolutionStatus = compatibleCategoryId
            ? "resolved"
            : "missing";
        }
        if (field === "categoriaId") {
          const category = categories.find((entry) => entry.id === value);
          next.categoriaPropuesta = category?.nombre || "";
          next.categoryResolutionStatus = value ? "resolved" : "missing";
        }
        if (field === "tipoItem") {
          if (value === "producto") {
            next = {
              ...next,
              marca: next.marca || "",
              modelo: next.modelo || "",
              stock: next.stock ?? "",
              stockMinimo: next.stockMinimo ?? "",
              codigoBarras: next.codigoBarras || "",
            };
          } else {
            next = stripProductFieldsForInventoryImport(next);
          }
        }
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
    saveRequestIdRef.current = "";
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeItem = (id) => {
    saveRequestIdRef.current = "";
    setPreviewItems((items) => items.filter((item) => item.id !== id));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (saveInFlightRef.current) return;
    if (!userId) {
      setError("Debes iniciar sesión para guardar inventario.");
      return;
    }
    if (!selectedItems.length) {
      setError("Selecciona al menos un item para guardar.");
      return;
    }

    if (selectedItems.length > MAX_INVENTORY_IMPORT_BATCH_SIZE) {
      setError(
        `La confirmación admite un máximo de ${MAX_INVENTORY_IMPORT_BATCH_SIZE} filas por lote. Excluye filas o divídelas en otra importación.`
      );
      return;
    }
    if (invalidSelectedItems.length > 0) {
      setError(
        `Corrige ${invalidSelectedItems.length} fila(s) incompleta(s) antes de guardar.`
      );
      return;
    }

    try {
      saveInFlightRef.current = true;
      setSaving(true);
      setError("");
      setSuccess("");

      if (!saveRequestIdRef.current) {
        saveRequestIdRef.current = createImportRequestId();
      }
      const rows = selectedItems.map((item) => ({
        rowId: item.id,
        item: buildPayloadForSave(item),
      }));
      const result = await confirmInventoryImportV2({
        businessId: userId,
        requestId: saveRequestIdRef.current,
        rows,
      });
      const codes = result.results.map((entry) => entry.codigoInterno);
      setSaveBackendCompatible(true);
      const codeSummary =
        codes.length <= 6
          ? codes.join(", ")
          : `${codes.slice(0, 6).join(", ")} y ${codes.length - 6} más`;
      setSuccess(
        `Se guardaron ${result.total} ítems v2. Códigos asignados: ${codeSummary}.`
      );
      setPreviewItems([]);
      setSelectedIds(new Set());
      setAnalysisMeta(null);
      saveRequestIdRef.current = "";
      if (onImported) onImported();
    } catch (err) {
      console.error(
        "Inventory import confirmation failed",
        getSafeInventoryAiLogDetails(err, {
          operation: "inventory_import_confirmation",
          stage: "confirm_callable",
          rowCount: selectedItems.length,
        })
      );
      const translatedError = translateInventoryAiError(err, {
        operation: "save",
      });
      if (translatedError.kind === "service_mismatch") {
        setSaveBackendCompatible(false);
      }
      setError(translatedError.message);
    } finally {
      saveInFlightRef.current = false;
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

      <AiAvailabilityStatus
        status={aiAvailability.status}
        remainingSeconds={aiAvailability.remainingSeconds}
        actionLabel="analizar otro documento"
      />

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

      {previewItems.length > 0 && invalidSelectedItems.length > 0 && (
        <p style={styles.validationSummary} role="alert">
          Hay {invalidSelectedItems.length} fila(s) incluida(s) con errores
          bloqueantes. Corrígelas o exclúyelas antes de guardar.
        </p>
      )}
      {selectedItems.length > MAX_INVENTORY_IMPORT_BATCH_SIZE && (
        <p style={styles.validationSummary} role="alert">
          El guardado atómico admite hasta {MAX_INVENTORY_IMPORT_BATCH_SIZE}
          filas. Actualmente hay {selectedItems.length} incluidas.
        </p>
      )}
      {!saveBackendCompatible && previewItems.length > 0 && (
        <p style={styles.validationSummary} role="alert">
          La Function compatible para confirmar importaciones v2 no está
          disponible. El guardado permanece deshabilitado y no se utilizará el
          flujo legacy.
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
                Revisa Tipo, Área, Categoría y los campos propios de cada ítem.
                El código interno se asignará únicamente al confirmar.
              </p>
            </div>
            <div style={styles.previewActions}>
              <button
                type="button"
                style={styles.clearButton}
                onClick={resetAnalysis}
                disabled={saving}
              >
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
              const rowErrors = rowErrorsById.get(item.id) || [];
              const availableCategories = getInventoryImportCategoriesForArea(
                categories,
                item.areaId
              );
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
                        disabled={saving}
                      />
                      Incluir
                    </label>
                    <div style={styles.itemTitleBlock}>
                      <strong style={styles.itemTitle}>
                        {item.nombre || "Item sin nombre"}
                      </strong>
                      <span style={styles.itemSku}>
                        Código interno: se asignará al confirmar
                      </span>
                    </div>
                    <span style={styles.typeBadge}>
                      {item.tipoItem || "Tipo pendiente"}
                    </span>
                    <span
                      style={rowErrors.length ? styles.invalidBadge : styles.validBadge}
                    >
                      {rowErrors.length ? "Fila incompleta" : "Lista para guardar"}
                    </span>
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
                      disabled={saving}
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
                        disabled={saving}
                        aria-invalid={rowErrors.some((message) =>
                          message.includes("Nombre")
                        )}
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
                        disabled={saving}
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
                        disabled={saving}
                        aria-invalid={!item.tipoItem}
                      >
                        <option value="">Selecciona un tipo</option>
                        {TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>Área</span>
                      <select
                        value={item.areaId}
                        onChange={(event) =>
                          handleItemChange(item.id, "areaId", event.target.value)
                        }
                        style={styles.tableInput}
                        disabled={saving}
                        aria-invalid={!item.areaId}
                      >
                        <option value="">
                          {item.areaPropuesta
                            ? `Corregir: ${item.areaPropuesta}`
                            : "Selecciona un Área"}
                        </option>
                        {activeAreas.map((area) => (
                          <option key={area.id} value={area.id}>
                            {area.nombre}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>Categoría</span>
                      <select
                        value={item.categoriaId}
                        onChange={(event) =>
                          handleItemChange(
                            item.id,
                            "categoriaId",
                            event.target.value
                          )
                        }
                        style={styles.tableInput}
                        disabled={saving || !item.areaId}
                        aria-invalid={!item.categoriaId}
                      >
                        <option value="">
                          {item.categoriaPropuesta
                            ? `Corregir: ${item.categoriaPropuesta}`
                            : "Selecciona una Categoría"}
                        </option>
                        {availableCategories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.nombre}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>Unidad</span>
                      <input
                        value={item.unidad}
                        onChange={(event) =>
                          handleItemChange(item.id, "unidad", event.target.value)
                        }
                        style={styles.tableInput}
                        disabled={saving}
                      />
                    </label>
                    {item.tipoItem === "producto" && (
                      <>
                        <label style={styles.cardField}>
                          <span style={styles.cardLabel}>Marca</span>
                          <input
                            value={item.marca}
                            onChange={(event) =>
                              handleItemChange(item.id, "marca", event.target.value)
                            }
                            style={styles.tableInput}
                            disabled={saving}
                            aria-invalid={!item.marca.trim()}
                          />
                        </label>
                        <label style={styles.cardField}>
                          <span style={styles.cardLabel}>Modelo</span>
                          <input
                            value={item.modelo}
                            onChange={(event) =>
                              handleItemChange(item.id, "modelo", event.target.value)
                            }
                            style={styles.tableInput}
                            disabled={saving}
                            aria-invalid={!item.modelo.trim()}
                          />
                        </label>
                        <label style={styles.cardField}>
                          <span style={styles.cardLabel}>Stock actual</span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={item.stock}
                            onChange={(event) =>
                              handleItemChange(item.id, "stock", event.target.value)
                            }
                            style={styles.tableInput}
                            disabled={saving}
                          />
                        </label>
                        <label style={styles.cardField}>
                          <span style={styles.cardLabel}>Stock mínimo</span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={item.stockMinimo}
                            onChange={(event) =>
                              handleItemChange(
                                item.id,
                                "stockMinimo",
                                event.target.value
                              )
                            }
                            style={styles.tableInput}
                            disabled={saving}
                          />
                        </label>
                        <label style={styles.cardField}>
                          <span style={styles.cardLabel}>
                            Código de barras (opcional)
                          </span>
                          <input
                            value={item.codigoBarras}
                            onChange={(event) =>
                              handleItemChange(
                                item.id,
                                "codigoBarras",
                                event.target.value
                              )
                            }
                            style={styles.tableInput}
                            disabled={saving}
                          />
                        </label>
                      </>
                    )}
                    <label style={styles.cardField}>
                      <span style={styles.cardLabel}>Costo base</span>
                      <input
                        value={item.costoBase}
                        onChange={(event) =>
                          handleItemChange(item.id, "costoBase", event.target.value)
                        }
                        style={styles.tableInput}
                        disabled={saving}
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
                        disabled={saving}
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
                            disabled={saving}
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
                            disabled={saving}
                          />
                          Ajustar precio manualmente
                        </label>
                      </div>
                    </div>
                  </div>

                  {(rowErrors.length > 0 ||
                    itemMessages.length > 0 ||
                    duplicateReason ||
                    originText) && (
                    <div style={styles.itemNotes}>
                      {rowErrors.map((message) => (
                        <span key={message} style={styles.rowErrorText} role="alert">
                          {message}
                        </span>
                      ))}
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
                        <span style={styles.duplicateText}>
                          Advertencia informativa: {duplicateReason}. No impide
                          guardar esta fila.
                        </span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div style={styles.previewFooterActions}>
            <button
              type="button"
              style={styles.clearButton}
              onClick={resetAnalysis}
              disabled={saving}
            >
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
  validationSummary: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "4px",
    color: "#991b1b",
    fontSize: "13px",
    lineHeight: 1.5,
    margin: "12px 0 0",
    padding: "10px 12px",
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
  invalidBadge: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "4px",
    color: "#991b1b",
    fontSize: "12px",
    fontWeight: 800,
    padding: "5px 8px",
  },
  validBadge: {
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    borderRadius: "4px",
    color: "#047857",
    fontSize: "12px",
    fontWeight: 800,
    padding: "5px 8px",
  },
  cardMainFields: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
  },
  cardFieldsGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
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
    boxSizing: "border-box",
    color: "#111827",
    fontSize: "12px",
    minHeight: "34px",
    minWidth: 0,
    padding: "7px 8px",
    width: "100%",
  },
  tableTextarea: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    boxSizing: "border-box",
    color: "#111827",
    fontSize: "12px",
    padding: "7px 8px",
    resize: "vertical",
    width: "100%",
  },
  duplicateText: {
    color: "#92400e",
    display: "block",
    fontSize: "11px",
    fontWeight: 700,
    marginTop: "4px",
  },
  rowErrorText: {
    color: "#b91c1c",
    display: "block",
    fontSize: "12px",
    minWidth: 0,
    fontWeight: 700,
    lineHeight: 1.4,
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
