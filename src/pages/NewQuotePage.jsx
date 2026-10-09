import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { sileo } from "sileo";
import AiAvailabilityStatus from "../components/ai/AiAvailabilityStatus";
import Spinner from "../components/ui/Spinner";
import { AI_MODELS } from "../config/aiModels";
import {
  createQuoteItemFromValuation,
  normalizeQuoteItems,
} from "../domain/quoteItemFactory";
import {
  calculateQuoteLineAmounts,
  DEFAULT_QUOTE_CONDITIONS,
  isAdvancedQuoteScope,
  isValidQuoteDateRange,
  QUOTE_SIMPLE_SCOPE_TITLE,
  resolveQuoteClientSelectionSnapshot,
  tryCalculateQuoteTotals,
  validateQuoteDraft,
} from "../domain/quoteModel.mjs";
import { getCategoriesForArea } from "../domain/inventoryCatalog.mjs";
import { buildValuationForItem, PRICING_STATUS } from "../domain/pricing";
import useAiRateLimit from "../hooks/useAiRateLimit";
import ClientSelector from "../features/clients/ClientSelector";
import QuoteCatalogDialog from "../features/quotes/QuoteCatalogDialog";
import QuoteCollapsibleSection from "../features/quotes/QuoteCollapsibleSection";
import QuoteItemsEditor from "../features/quotes/QuoteItemsEditor";
import QuoteSummaryPanel from "../features/quotes/QuoteSummaryPanel";
import "../features/quotes/quote-workspace.css";
import { suggestQuoteItems } from "../services/aiQuoteService";
import { getCompanyProfile } from "../services/companyService";
import {
  createManagedInventoryItem,
  findActiveProductByBarcode,
  subscribeToInventoryAreas,
  subscribeToInventoryCategories,
} from "../services/inventoryService";
import {
  createQuote,
  createQuoteRequestId,
  getQuoteById,
  getQuoteDisplayNumber,
  updateQuote,
} from "../services/quoteService";
import { subscribeToValuations } from "../services/valuationService";
import { useBusinessMoney } from "../hooks/useBusinessFormat";
import { formatDate } from "../utils/formatters";

const ASSISTANT_DESCRIPTION_MAX_LENGTH = 1200;
const MANUAL_CATALOG_PAGE_SIZE = 10;
const ITEM_FEEDBACK_HIDE_DELAY = 3500;

const tipoLabels = {
  producto: "Producto",
  servicio: "Servicio",
  actividad: "Actividad",
};

const DEFAULT_MARGIN_BY_TYPE = {
  producto: 30,
  servicio: 45,
  actividad: 40,
};

const DEFAULT_UNIT_BY_TYPE = {
  producto: "unidad",
  servicio: "servicio",
  actividad: "hora",
};

function formatShortEsDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(date)
    .replace(/\./g, "");
}

const PRICE_CONFIDENCE_UNAVAILABLE = "no_disponible";
const DEFAULT_PRICE_JUSTIFICATION =
  "Sin estimación automática. Ingresa un costo base o consulta una referencia de mercado.";

const confidenceLabels = {
  [PRICE_CONFIDENCE_UNAVAILABLE]: "no disponible",
  baja: "baja",
  media: "media",
  alta: "alta",
};

const assistantModeLabels = {
  auto: "automático",
  local: "local forzado",
  gemini: "Gemini forzado",
  "local-forced": "local forzado",
  "gemini-forced": "Gemini forzado",
  "gemini-forced-fallback": "Gemini forzado con fallback local",
};

const ASSISTANT_LOCAL_FALLBACK_WARNING =
  "El servicio inteligente no estaba disponible. Se generaron sugerencias mediante el análisis local para que puedas revisarlas.";

const RELEVANT_ASSISTANT_WARNING_MARKERS = [
  "no hay inventario activo",
  "no se encontraron sugerencias controladas",
];

function normalizeAssistantWarningText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getVisibleAssistantWarning({ source, mode, warning }) {
  const cleanWarning = String(warning || "").trim();
  if (!cleanWarning) return "";

  const normalizedWarning = normalizeAssistantWarningText(cleanWarning);
  const isRelevantWarning = RELEVANT_ASSISTANT_WARNING_MARKERS.some((marker) =>
    normalizedWarning.includes(marker)
  );
  if (isRelevantWarning) return cleanWarning;
  if (mode === "local-forced") return "";
  if (
    source === "local" &&
    ["auto", "gemini-forced-fallback"].includes(mode)
  ) {
    return ASSISTANT_LOCAL_FALLBACK_WARNING;
  }
  return cleanWarning;
}

function getAssistantModeFromQuery() {
  if (typeof window === "undefined") return "auto";
  const mode = new URLSearchParams(window.location.search).get("assistantMode");
  return ["local", "gemini"].includes(mode) ? mode : "auto";
}

function getSuggestedItemPricingDefaults(suggestion) {
  const tipoItem = ["producto", "servicio", "actividad"].includes(suggestion?.tipoItem)
    ? suggestion.tipoItem
    : "actividad";

  return {
    costoBaseSugerido: "",
    precioSugerido: "",
    margenSugerido: DEFAULT_MARGIN_BY_TYPE[tipoItem],
    justificacionPrecio: DEFAULT_PRICE_JUSTIFICATION,
    confianzaPrecio: PRICE_CONFIDENCE_UNAVAILABLE,
  };
}

function parseDraftNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function calculateSuggestedInternalPrice(costoBase, margenDeseado) {
  const costo = parseDraftNumber(costoBase);
  const margen = parseDraftNumber(margenDeseado);

  if (
    costo === null ||
    costo <= 0 ||
    margen === null ||
    margen < 0
  ) {
    return "";
  }

  return Math.round(costo + (costo * margen) / 100);
}

function buildManualPriceJustification(margenDeseado) {
  const margen = parseDraftNumber(margenDeseado);
  if (margen === null || margen < 0) return DEFAULT_PRICE_JUSTIFICATION;

  return `Precio calculado a partir del costo base ingresado por el usuario y un margen de ${margen} %.`;
}

function getSuggestedItemValidation(draft) {
  if (!draft) return { messages: {}, isValid: false };

  const areaId = String(draft.areaId || "").trim();
  const categoriaId = String(draft.categoriaId || "").trim();
  const costoBase = parseDraftNumber(draft.costoBase);
  const cantidadSugerida = parseDraftNumber(draft.cantidadSugerida);
  const margenDeseado = parseDraftNumber(draft.margenDeseado);
  const messages = {};

  if (!areaId) messages.areaId = "Selecciona un área.";
  if (!categoriaId) messages.categoriaId = "Selecciona una categoría válida.";
  if (draft.tipoItem === "producto" && !String(draft.marca || "").trim()) {
    messages.marca = "Ingresa la marca del producto.";
  }
  if (draft.tipoItem === "producto" && !String(draft.modelo || "").trim()) {
    messages.modelo = "Ingresa el modelo del producto.";
  }

  if (costoBase === null || costoBase <= 0) {
    messages.costoBase = "Ingresa un costo mayor a cero.";
  }

  if (cantidadSugerida === null || cantidadSugerida <= 0) {
    messages.cantidadSugerida = "Ingresa una cantidad mayor a cero.";
  }

  if (margenDeseado === null || margenDeseado < 0) {
    messages.margenDeseado = "Ingresa un margen de cero o mayor.";
  }

  return {
    messages,
    isValid: Object.keys(messages).length === 0,
  };
}

function buildSuggestedItemDescription(suggestion, tipoItem) {
  const nombre = String(suggestion?.nombre || "").trim();
  const typeLabel = tipoLabels[tipoItem] || "Ítem";
  return nombre ? `${typeLabel} sugerido: ${nombre}.` : "";
}

function normalizeConfidence(value, fallback = "media") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;

  if (["baja", "media", "alta", PRICE_CONFIDENCE_UNAVAILABLE].includes(normalized)) {
    return normalized;
  }

  const numericConfidence = Number(normalized);
  if (Number.isFinite(numericConfidence)) {
    if (numericConfidence >= 80) return "alta";
    if (numericConfidence >= 50) return "media";
    return "baja";
  }

  return fallback;
}

function hasSameDraftText(first, second) {
  const normalize = (value) =>
    String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  const firstText = normalize(first);
  const secondText = normalize(second);
  return Boolean(firstText && secondText && firstText === secondText);
}

const statusStyles = {
  [PRICING_STATUS.SIN_REFERENCIAS]: {
    background: "var(--color-surface-subtle)",
    color: "var(--color-text-default)",
  },
  [PRICING_STATUS.BAJO_MERCADO]: {
    background: "var(--color-info-50)",
    color: "var(--color-info-700)",
  },
  [PRICING_STATUS.DENTRO_DE_RANGO]: {
    background: "var(--color-success-50)",
    color: "var(--color-success-700)",
  },
  [PRICING_STATUS.SOBRE_MERCADO]: {
    background: "var(--color-danger-50)",
    color: "var(--color-danger-700)",
  },
};

function buildInitialQuote(projectContext = null) {
  const client = projectContext?.clienteSnapshot || null;
  const clienteId = String(projectContext?.clienteId || client?.clienteId || "").trim();
  return {
    numero: "",
    fecha: "",
    clienteId,
    cliente: client ? {...client, clienteId} : null,
    clienteNombre: client?.nombreRazonSocial || "",
    clienteRut: client?.rut || "",
    clienteContacto: client?.personaContacto || "",
    clienteEmail: client?.email || "",
    clienteTelefono: client?.telefono || "",
    clienteDireccion: client?.direccion || "",
    clienteCiudad: client?.comunaNombre || "",
    proyectoNombre: projectContext?.trabajoTitulo || "",
    trabajoId: projectContext?.trabajoId || "",
    trabajoNumero: projectContext?.trabajoNumero || "",
    trabajoTitulo: projectContext?.trabajoTitulo || "",
    condicionesPago: "",
    condiciones: { ...DEFAULT_QUOTE_CONDITIONS },
    validezDias: 15,
    afectaIva: true,
    estado: "borrador",
    items: [],
    seccionesAlcance: [],
    aceptacion: {
      habilitada: false,
      texto: "Acepto los términos y condiciones de esta cotización.",
    },
    descuento: 0,
    observaciones: "",
  };
}

function normalizeStoredQuoteItems(items) {
  return normalizeQuoteItems(
    Array.isArray(items)
      ? items.map((item) => {
          const storedUnitPrice =
            item?.precioUnitarioEditable ??
            item?.precioUnitario ??
            item?.precio ??
            item?.precioSugerido ??
            0;

          return {
            ...item,
            itemId: item?.itemId || item?.productoId || "",
            nombre: item?.nombre || "Ítem sin nombre",
            descripcion: item?.descripcion || "",
            tipoItem: item?.tipoItem || "",
            categoria: item?.categoria || "",
            unidad: item?.unidad || "unidad",
            precioSugerido:
              item?.precioSugerido !== undefined
                ? item.precioSugerido
                : storedUnitPrice,
            precioUnitarioEditable: storedUnitPrice,
          };
        })
      : []
  );
}

// "Qué incluye esta propuesta" empieza cerrado salvo que ya tenga contenido:
// más de un apartado o alguna línea escrita (en modo simple la sección única
// sólo lleva título mientras tiene texto).
function hasScopeContent(sections = []) {
  return sections.length > 1 || sections.some((section) =>
    (section?.lineas || []).some((line) => String(line || "").trim())
  );
}

function buildQuoteFromSavedQuote(savedQuote = {}) {
  return {
    ...buildInitialQuote(),
    ...savedQuote,
    numero:
      savedQuote.numero ||
      savedQuote.numeroCotizacion ||
      savedQuote.quoteNumber ||
      "",
    fecha: savedQuote.fecha || "",
    estado: savedQuote.estado || "borrador",
    clienteId: savedQuote.clienteId || "",
    cliente: savedQuote.cliente || null,
    clienteNombre: savedQuote.clienteNombre || "",
    clienteRut: savedQuote.clienteRut || "",
    clienteContacto: savedQuote.clienteContacto || "",
    clienteEmail: savedQuote.clienteEmail || "",
    clienteTelefono: savedQuote.clienteTelefono || "",
    clienteDireccion: savedQuote.clienteDireccion || "",
    clienteCiudad: savedQuote.clienteCiudad || "",
    proyectoNombre: savedQuote.proyectoNombre || "",
    condicionesPago: savedQuote.condicionesPago || "",
    condiciones: {
      ...DEFAULT_QUOTE_CONDITIONS,
      ...(savedQuote.condiciones || {}),
    },
    validezDias: Number(savedQuote.validezDias || 15),
    afectaIva: savedQuote.afectaIva !== false,
    items: normalizeStoredQuoteItems(savedQuote.items),
    descuento: Number(savedQuote.descuento || 0),
    observaciones: savedQuote.observaciones || "",
    seccionesAlcance: Array.isArray(savedQuote.seccionesAlcance)
      ? savedQuote.seccionesAlcance
      : [],
    aceptacion: savedQuote.aceptacion || {
      habilitada: false,
      texto: "Acepto los términos y condiciones de esta cotización.",
    },
    empresa: savedQuote.empresa || {},
  };
}

function NewQuotePage({ userId }) {
  const formatBusinessAmount = useBusinessMoney();
  const { quoteId: editQuoteId = "" } = useParams();
  const location = useLocation();
  const projectContext = location.state?.projectContext || null;
  const navigate = useNavigate();
  const addedItemsRef = useRef(null);
  const createRequestIdRef = useRef("");
  const savingRef = useRef(false);
  const originalLinkedClientRef = useRef({
    clienteId: String(projectContext?.clienteId || projectContext?.clienteSnapshot?.clienteId || ""),
    snapshot: projectContext?.clienteSnapshot || null,
  });
  const currentClienteIdRef = useRef(String(projectContext?.clienteId || projectContext?.clienteSnapshot?.clienteId || ""));
  const assistantDescriptionRef = useRef("");
  const dictationBaseTextRef = useRef("");
  const dictationFinalTextRef = useRef("");
  const dictationInterimTextRef = useRef("");
  const itemFeedbackTimeoutRef = useRef(null);
  const highlightTimeoutRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const assistantRequestInFlightRef = useRef(false);
  const isEditMode = Boolean(editQuoteId);
  const assistantRequestMode = useMemo(() => getAssistantModeFromQuery(), []);
  const assistantUsesGemini = assistantRequestMode !== "local";
  const aiAvailability = useAiRateLimit(AI_MODELS.quoteSuggestions, {
    enabled: Boolean(userId) && assistantUsesGemini,
  });
  const [quote, setQuote] = useState(() => buildInitialQuote(projectContext));
  const [valuations, setValuations] = useState([]);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editLoading, setEditLoading] = useState(Boolean(editQuoteId));
  const [editLoadError, setEditLoadError] = useState("");
  const [editLockedMessage, setEditLockedMessage] = useState("");
  const [loadedDraftQuote, setLoadedDraftQuote] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingEstado, setSavingEstado] = useState("");
  const [search, setSearch] = useState("");
  const [catalogTypeFilter, setCatalogTypeFilter] = useState("todos");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(() => location.state?.message || "");
  const [itemFeedback, setItemFeedback] = useState("");
  const [savedQuoteId, setSavedQuoteId] = useState(null);
  const [assistantDescription, setAssistantDescription] = useState("");
  const [assistantSuggestions, setAssistantSuggestions] = useState([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const [assistantSource, setAssistantSource] = useState("");
  const [assistantWarning, setAssistantWarning] = useState("");
  const [assistantModeUsed, setAssistantModeUsed] = useState("");
  const [assistantModel, setAssistantModel] = useState("");
  const [dictationListening, setDictationListening] = useState(false);
  const [dictationStatus, setDictationStatus] = useState({
    type: "",
    text: "",
  });
  const [suggestedItemDraft, setSuggestedItemDraft] = useState(null);
  const [suggestedItemTouched, setSuggestedItemTouched] = useState({});
  const [suggestedItemSaving, setSuggestedItemSaving] = useState(false);
  const [suggestedItemError, setSuggestedItemError] = useState("");
  const [highlightedItemId, setHighlightedItemId] = useState("");
  const [manualCatalogOpen, setManualCatalogOpen] = useState(false);
  const [manualCatalogVisibleCount, setManualCatalogVisibleCount] = useState(
    MANUAL_CATALOG_PAGE_SIZE
  );
  const [clientAvailability, setClientAvailability] = useState({
    error: "",
    hasActiveClients: false,
    loading: Boolean(userId),
  });
  const [inventoryAreas, setInventoryAreas] = useState([]);
  const [inventoryCategories, setInventoryCategories] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [itemsInteracted, setItemsInteracted] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [plazoRangeOpen, setPlazoRangeOpen] = useState(false);
  const [plazoRangeDraft, setPlazoRangeDraft] = useState({ desde: "", hasta: "" });

  useEffect(() => {
    currentClienteIdRef.current = quote.clienteId;
  }, [quote.clienteId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError("");

    const unsubscribe = subscribeToValuations(
      userId,
      (items) => {
        setValuations(items);
        setLoading(false);
      },
      (err) => {
        console.error("Error al cargar ítems valorizados:", err);
        setError("No se pudieron cargar los ítems valorizados.");
        setLoading(false);
      }
    );

    getCompanyProfile(userId)
      .then((profile) => {
        setCompanyProfile(profile);
        if (isEditMode) return;
        setQuote((prev) => ({
          ...prev,
          afectaIva: profile.impuestoPredeterminadoId === "IVA_GENERAL",
          condicionesPago:
            prev.condicionesPago || profile.condicionesPago || "",
          validezDias: profile.validezCotizacionDias || 15,
          condiciones: {
            ...prev.condiciones,
            formaPago:
              prev.condiciones?.formaPago || profile.condicionesPago || "",
            plazoEntrega:
              prev.condiciones?.plazoEntrega ||
              profile.plazoEntregaCotizacion ||
              "",
            alcanceGeografico:
              prev.condiciones?.alcanceGeografico ||
              profile.alcanceGeograficoCotizacion ||
              "",
            garantia:
              prev.condiciones?.garantia || profile.garantiaCotizacion || "",
            exclusiones:
              prev.condiciones?.exclusiones ||
              profile.exclusionesCotizacion ||
              "",
            terminosAdicionales:
              prev.condiciones?.terminosAdicionales ||
              profile.terminosCotizacion ||
              "",
            observaciones:
              prev.condiciones?.observaciones ||
              profile.notaFinalCotizacion ||
              "",
          },
          aceptacion: {
            habilitada: false,
            texto:
              profile.textoAceptacionCotizacion ||
              prev.aceptacion?.texto ||
              "Acepto los términos y condiciones de esta cotización.",
          },
        }));
      })
      .catch((err) => {
        console.error("Error al cargar perfil de empresa:", err);
      });

    return () => unsubscribe();
  }, [isEditMode, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const unsubscribeAreas = subscribeToInventoryAreas(
      userId,
      setInventoryAreas,
      (err) => console.warn("No se pudieron cargar las áreas de inventario.", err)
    );
    const unsubscribeCategories = subscribeToInventoryCategories(
      userId,
      setInventoryCategories,
      (err) => console.warn("No se pudieron cargar las categorías de inventario.", err)
    );
    return () => {
      unsubscribeAreas();
      unsubscribeCategories();
    };
  }, [userId]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warnBeforeExit = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeExit);
    return () => window.removeEventListener("beforeunload", warnBeforeExit);
  }, [dirty]);

  useEffect(
    () => () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      if (itemFeedbackTimeoutRef.current) {
        window.clearTimeout(itemFeedbackTimeoutRef.current);
      }
    },
    []
  );

  useEffect(
    () => () => {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.onresult = null;
        speechRecognitionRef.current.onerror = null;
        speechRecognitionRef.current.onend = null;
        try {
          speechRecognitionRef.current.abort();
        } catch (err) {
          console.warn("No se pudo detener el dictado al salir:", err);
        }
        speechRecognitionRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    assistantDescriptionRef.current = assistantDescription;
  }, [assistantDescription]);

  useEffect(() => {
    if (!isEditMode) {
      originalLinkedClientRef.current = {clienteId: "", snapshot: null};
      setEditLoading(false);
      setEditLoadError("");
      setEditLockedMessage("");
      setLoadedDraftQuote(null);
      return;
    }

    if (!userId) {
      setEditLoading(false);
      return;
    }

    let active = true;
    setEditLoading(true);
    setEditLoadError("");
    setEditLockedMessage("");
    setLoadedDraftQuote(null);
    setSavedQuoteId(null);
    originalLinkedClientRef.current = {clienteId: "", snapshot: null};

    getQuoteById(userId, editQuoteId)
      .then((savedQuote) => {
        if (!active) return;

        if (!savedQuote) {
          setEditLoadError("No encontramos la cotización solicitada.");
          return;
        }

        if ((savedQuote.estado || "borrador") !== "borrador") {
          setEditLoadError(
            "Esta cotización ya no puede editarse porque fue emitida o cerrada."
          );
          return;
        }

        const editableQuote = buildQuoteFromSavedQuote(savedQuote);
        originalLinkedClientRef.current = {
          clienteId: editableQuote.clienteId,
          snapshot: editableQuote.cliente,
        };
        currentClienteIdRef.current = editableQuote.clienteId;
        setQuote(editableQuote);
        setScopeOpen(hasScopeContent(editableQuote.seccionesAlcance));
        setLoadedDraftQuote(editableQuote);
        setSavedQuoteId(savedQuote.id);
        setDirty(false);
      })
      .catch((err) => {
        console.error("Error al cargar cotización para edición:", err);
        if (active) {
          setEditLoadError("No se pudo cargar la cotización solicitada.");
        }
      })
      .finally(() => {
        if (active) setEditLoading(false);
      });

    return () => {
      active = false;
    };
  }, [editQuoteId, isEditMode, userId]);

  const normalizedItems = useMemo(
    () =>
      (Array.isArray(quote.items) ? quote.items : []).map((item, index) => {
        try {
          const amounts = calculateQuoteLineAmounts(item, index);
          return {
            ...item,
            precioUnitarioEditable: item.precioUnitarioEditable,
            cantidad: item.cantidad,
            descuentoPorcentaje: item.descuentoPorcentaje ?? 0,
            subtotalLinea: amounts.bruto,
            descuentoLinea: amounts.descuentoLinea,
            totalLinea: amounts.totalLinea,
          };
        } catch {
          return { ...item, totalLinea: 0 };
        }
      }),
    [quote.items]
  );

  const totalsResult = useMemo(
    () =>
      tryCalculateQuoteTotals(quote.items, quote.descuento, {
        afectaIva: quote.afectaIva !== false,
        tasaIva:
          quote.tasaIva ??
          Number(companyProfile?.impuestoPredeterminadoTasa ?? 19) / 100,
      }),
    [companyProfile?.impuestoPredeterminadoTasa, quote.afectaIva, quote.descuento, quote.items, quote.tasaIva]
  );
  const totals = totalsResult.totals;
  const quoteValidation = useMemo(() => validateQuoteDraft(quote), [quote]);

  const itemQuantityById = useMemo(() => {
    const quantities = {};
    normalizedItems.forEach((item) => {
      quantities[item.itemId] = Number(item.cantidad || 0);
    });
    return quantities;
  }, [normalizedItems]);

  const suggestedItemValidation = useMemo(
    () => getSuggestedItemValidation(suggestedItemDraft),
    [suggestedItemDraft]
  );
  const suggestedItemCategories = useMemo(
    () =>
      getCategoriesForArea(
        inventoryCategories,
        suggestedItemDraft?.areaId || ""
      ),
    [inventoryCategories, suggestedItemDraft?.areaId]
  );
  const visibleAssistantWarning = getVisibleAssistantWarning({
    source: assistantSource,
    mode: assistantModeUsed,
    warning: assistantWarning,
  });

  const filteredValuations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return valuations.filter((valuation) => {
      if (catalogTypeFilter !== "todos" && valuation.tipoItem !== catalogTypeFilter) {
        return false;
      }
      if (!query) return true;
      const inventoryItem = valuation.item || {};
      const text = [
        valuation.nombre,
        valuation.categoria,
        valuation.codigoInterno,
        valuation.codigo,
        valuation.sku,
        inventoryItem.codigoInterno,
        inventoryItem.codigo,
        inventoryItem.sku,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(query);
    });
  }, [catalogTypeFilter, search, valuations]);

  const visibleCatalogValuations = filteredValuations.slice(
    0,
    manualCatalogVisibleCount
  );
  const catalogHasMoreItems = manualCatalogVisibleCount < filteredValuations.length;
  const catalogShowingAllItems =
    filteredValuations.length > MANUAL_CATALOG_PAGE_SIZE &&
    manualCatalogVisibleCount >= filteredValuations.length;

  const matchedAssistantSuggestions = useMemo(() => {
    const groupsByItemId = new Map();

    assistantSuggestions.forEach((suggestion) => {
      if (!suggestion.inventarioMatchId) return;

      const valuation = valuations.find(
        (item) => item.itemId === suggestion.inventarioMatchId
      );
      if (!valuation) return;

      const quantity = Math.max(Number(suggestion.cantidadSugerida) || 1, 1);
      const current = groupsByItemId.get(valuation.itemId);

      groupsByItemId.set(valuation.itemId, {
        valuation,
        quantity: (current?.quantity || 0) + quantity,
      });
    });

    return Array.from(groupsByItemId.values());
  }, [assistantSuggestions, valuations]);

  const dictationStateLabel = dictationListening
    ? "Escuchando"
    : dictationStatus.type === "unsupported"
      ? "No compatible"
      : dictationStatus.type === "warning"
        ? "Revisar dictado"
        : dictationStatus.text
          ? "Dictado detenido"
          : "Listo para dictar";

  const updateField = (field, value) => {
    setDirty(true);
    setQuote((prev) => ({
      ...prev,
      [field]: value,
      ...(field === "condicionesPago"
        ? { condiciones: { ...prev.condiciones, formaPago: value } }
        : {}),
    }));
  };

  const updateCondition = (field, value) => {
    setDirty(true);
    setQuote((prev) => ({
      ...prev,
      condiciones: { ...prev.condiciones, [field]: value },
      ...(field === "formaPago" ? { condicionesPago: value } : {}),
      ...(field === "observaciones" ? { observaciones: value } : {}),
    }));
  };

  const restoreDefaultConditions = () => {
    if (!companyProfile) return;
    setDirty(true);
    const defaults = {
      ...DEFAULT_QUOTE_CONDITIONS,
      formaPago: companyProfile.condicionesPago || "",
      plazoEntrega: companyProfile.plazoEntregaCotizacion || "",
      alcanceGeografico: companyProfile.alcanceGeograficoCotizacion || "",
      garantia: companyProfile.garantiaCotizacion || "",
      exclusiones: companyProfile.exclusionesCotizacion || "",
      terminosAdicionales: companyProfile.terminosCotizacion || "",
      observaciones: companyProfile.notaFinalCotizacion || "",
    };
    setQuote((prev) => ({
      ...prev,
      condiciones: defaults,
      condicionesPago: defaults.formaPago,
      observaciones: defaults.observaciones,
    }));
  };

  // V1 mínima: el selector desde/hasta sólo compone el mismo texto libre que
  // ya acepta "condiciones.plazoEntrega" (sin cambiar el contrato ni tocar
  // Functions/PDF). El campo sigue siendo editable a mano, incluida la
  // redacción de plazos relativos ("10 días hábiles desde la orden de
  // compra"), que este selector no cubre todavía.
  const applyPlazoRange = () => {
    // El botón ya se deshabilita si el rango no es válido; esta comprobación
    // es defensiva (por ejemplo, un envío por teclado) y evita persistir un
    // rango invertido aunque cambie la UI que lo invoca.
    if (!isValidQuoteDateRange(plazoRangeDraft.desde, plazoRangeDraft.hasta)) return;
    const desdeLabel = formatShortEsDate(plazoRangeDraft.desde);
    const hastaLabel = formatShortEsDate(plazoRangeDraft.hasta);
    if (!desdeLabel || !hastaLabel) return;
    updateCondition("plazoEntrega", `${desdeLabel} → ${hastaLabel}`);
    setPlazoRangeOpen(false);
    setPlazoRangeDraft({ desde: "", hasta: "" });
  };

  const handleClientChange = useCallback((client) => {
    if (!client) {
      currentClienteIdRef.current = "";
      setDirty(true);
      setQuote((prev) => ({
        ...prev,
        clienteId: "",
        cliente: null,
        clienteNombre: "",
        clienteRut: "",
        clienteContacto: "",
        clienteEmail: "",
        clienteTelefono: "",
        clienteDireccion: "",
        clienteCiudad: "",
      }));
      return;
    }
    if (client.clienteId === currentClienteIdRef.current) return;

    const snapshot = resolveQuoteClientSelectionSnapshot(client, {
      originalClienteId: originalLinkedClientRef.current.clienteId,
      originalClientSnapshot: originalLinkedClientRef.current.snapshot,
    });
    currentClienteIdRef.current = snapshot.clienteId;
    setDirty(true);
    setQuote((prev) => ({
      ...prev,
      clienteId: client.clienteId,
      cliente: snapshot,
      clienteNombre: snapshot.nombreRazonSocial,
      clienteRut: snapshot.rut,
      clienteContacto: snapshot.personaContacto,
      clienteEmail: snapshot.email,
      clienteTelefono: snapshot.telefono,
      clienteDireccion: snapshot.direccion,
      clienteCiudad: snapshot.comunaNombre,
    }));
  }, []);

  const addScopeSection = () => {
    setDirty(true);
    setScopeOpen(true);
    setQuote((prev) => {
      const base = prev.seccionesAlcance.length
        ? prev.seccionesAlcance
        : [{ id: `alcance-${Date.now()}`, titulo: QUOTE_SIMPLE_SCOPE_TITLE, lineas: [] }];
      return {
        ...prev,
        seccionesAlcance: [
          ...base,
          { id: `alcance-${Date.now()}-extra`, titulo: "", lineas: [""] },
        ],
      };
    });
  };

  // El textarea principal (modo simple) edita la primera sección de
  // seccionesAlcance para no crear un campo nuevo: sólo se le asigna un
  // título por defecto mientras tenga contenido, así pasa la validación
  // existente (una sección con líneas requiere título) sin pedírselo al
  // usuario. Si el usuario borra todo el texto, el título vuelve a quedar
  // vacío y la sección se descarta al guardar (normalizeScopeSections).
  const updatePrimaryScopeText = (text) => {
    setDirty(true);
    setScopeOpen(true);
    const lineas = text.split(/\r?\n/);
    const hasContent = lineas.some((line) => line.trim());
    setQuote((prev) => {
      if (prev.seccionesAlcance.length === 0) {
        if (!hasContent) return prev;
        return {
          ...prev,
          seccionesAlcance: [
            { id: `alcance-${Date.now()}`, titulo: QUOTE_SIMPLE_SCOPE_TITLE, lineas },
          ],
        };
      }
      return {
        ...prev,
        seccionesAlcance: prev.seccionesAlcance.map((section, index) =>
          index === 0
            ? { ...section, titulo: hasContent ? (section.titulo || QUOTE_SIMPLE_SCOPE_TITLE) : "", lineas }
            : section
        ),
      };
    });
  };

  const updateScopeSection = (id, patch) => {
    setDirty(true);
    setQuote((prev) => ({
      ...prev,
      seccionesAlcance: prev.seccionesAlcance.map((section) =>
        section.id === id ? { ...section, ...patch } : section
      ),
    }));
  };

  const removeScopeSection = (id) => {
    setDirty(true);
    setQuote((prev) => ({
      ...prev,
      seccionesAlcance: prev.seccionesAlcance.filter((section) => section.id !== id),
    }));
  };

  const moveScopeSection = (index, direction) => {
    setDirty(true);
    setQuote((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.seccionesAlcance.length) return prev;
      const sections = [...prev.seccionesAlcance];
      [sections[index], sections[nextIndex]] = [sections[nextIndex], sections[index]];
      return { ...prev, seccionesAlcance: sections };
    });
  };

  // Modo simple (un solo textarea sin título) vs. modo avanzado (varios
  // apartados con título propio). Se deriva de los datos (isAdvancedQuoteScope
  // en quoteModel.mjs), no de un flag de UI aparte, para que una cotización
  // existente con secciones tituladas o múltiples nunca pierda su edición
  // completa, y para que el round-trip de una cotización guardada en modo
  // simple no reaparezca como avanzada sólo por el título autogenerado.
  const isAdvancedScope = isAdvancedQuoteScope(quote.seccionesAlcance);
  const primaryScopeText = (quote.seccionesAlcance[0]?.lineas || []).join("\n");

  const plazoRangeValid = isValidQuoteDateRange(plazoRangeDraft.desde, plazoRangeDraft.hasta);
  const plazoRangeShowError = Boolean(plazoRangeDraft.desde && plazoRangeDraft.hasta) && !plazoRangeValid;

  const showItemFeedback = (message) => {
    setItemFeedback(message);

    if (itemFeedbackTimeoutRef.current) {
      window.clearTimeout(itemFeedbackTimeoutRef.current);
    }

    itemFeedbackTimeoutRef.current = window.setTimeout(() => {
      setItemFeedback("");
      itemFeedbackTimeoutRef.current = null;
    }, ITEM_FEEDBACK_HIDE_DELAY);
  };

  const showAddFeedback = (itemId, wasExisting) => {
    showItemFeedback(
      wasExisting
        ? "Cantidad actualizada en la cotización."
        : "Ítem agregado a la cotización."
    );
    setHighlightedItemId(itemId);

    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedItemId("");
    }, 1800);

    window.requestAnimationFrame(() => {
      addedItemsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const addItem = (valuation, quantity = 1) => {
    setItemsInteracted(true);
    setDirty(true);
    setSuccess("");
    setError("");
    const wasExisting = quote.items.some((item) => item.itemId === valuation.itemId);
    const quantityToAdd = Math.max(Number(quantity) || 1, 1);

    setQuote((prev) => {
      const existing = prev.items.find((item) => item.itemId === valuation.itemId);
      if (existing) {
        return {
          ...prev,
          items: normalizeQuoteItems(
            prev.items.map((item) =>
              item.itemId === valuation.itemId
                ? { ...item, cantidad: Number(item.cantidad || 0) + quantityToAdd }
                : item
            )
          ),
        };
      }

      return {
        ...prev,
        items: normalizeQuoteItems([
          ...prev.items,
          {
            ...createQuoteItemFromValuation(valuation),
            cantidad: quantityToAdd,
          },
        ]),
      };
    });
    showAddFeedback(valuation.itemId, wasExisting);
  };

  const addScannedProduct = async (barcode) => {
    const product = await findActiveProductByBarcode(userId, barcode);
    if (!product) {
      throw new Error("Producto no encontrado para este código.");
    }
    const valuation = valuations.find((entry) => entry.itemId === product.id) ||
      buildValuationForItem(product, []);
    addItem(valuation, 1);
  };

  const handleCatalogSearchChange = (event) => {
    const nextSearch = event.target.value;
    setSearch(nextSearch);
    setManualCatalogVisibleCount(MANUAL_CATALOG_PAGE_SIZE);
  };

  const showMoreCatalogItems = () => {
    setManualCatalogVisibleCount((current) =>
      Math.min(current + MANUAL_CATALOG_PAGE_SIZE, filteredValuations.length)
    );
  };

  const showLessCatalogItems = () => {
    setManualCatalogVisibleCount(MANUAL_CATALOG_PAGE_SIZE);
  };

  const getMatchedValuation = (suggestion) =>
    valuations.find((valuation) => valuation.itemId === suggestion.inventarioMatchId);

  const buildDictatedDescription = (baseText, finalText, interimText = "") => {
    const cleanBase = String(baseText || "").trimEnd();
    const dictatedText = [finalText, interimText]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ");
    const nextText = `${cleanBase}${cleanBase && dictatedText ? " " : ""}${dictatedText}`;
    return nextText.slice(0, ASSISTANT_DESCRIPTION_MAX_LENGTH);
  };

  const updateAssistantDescription = (value) => {
    const nextValue = String(value || "").slice(0, ASSISTANT_DESCRIPTION_MAX_LENGTH);
    assistantDescriptionRef.current = nextValue;
    setAssistantDescription(nextValue);
  };

  const finalizeDictationText = () => {
    const finalDescription = buildDictatedDescription(
      dictationBaseTextRef.current,
      dictationFinalTextRef.current,
      dictationInterimTextRef.current
    );

    updateAssistantDescription(finalDescription);
    dictationBaseTextRef.current = finalDescription;
    dictationFinalTextRef.current = "";
    dictationInterimTextRef.current = "";
  };

  const handleAssistantDescriptionChange = (event) => {
    updateAssistantDescription(event.target.value);

    if (!dictationListening) return;

    dictationBaseTextRef.current = assistantDescriptionRef.current;
    dictationFinalTextRef.current = "";
    dictationInterimTextRef.current = "";
    setDictationStatus({
      type: "info",
      text: "Dictado detenido para permitir la edición manual del requerimiento.",
    });
    setDictationListening(false);

    try {
      speechRecognitionRef.current?.abort();
    } catch (err) {
      console.warn("No se pudo detener el dictado al editar:", err);
    }
  };

  const getSpeechRecognitionConstructor = () => {
    if (typeof window === "undefined") return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  };

  const getDictationErrorMessage = (errorCode) => {
    if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
      return "No se pudo usar el micrófono. Revisa los permisos del navegador y vuelve a intentar.";
    }

    if (errorCode === "audio-capture") {
      return "No se detectó un micrófono disponible. Puedes escribir el requerimiento manualmente.";
    }

    if (errorCode === "no-speech") {
      return "No se detectó voz. Puedes volver a presionar Dictar o escribir el requerimiento manualmente.";
    }

    return "No se pudo completar el dictado por voz. Puedes escribir el requerimiento manualmente.";
  };

  const startAssistantDictation = (language = "es-CL", allowLanguageFallback = true) => {
    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();

    if (!SpeechRecognitionConstructor) {
      setDictationStatus({
        type: "unsupported",
        text:
          "El dictado por voz no está disponible en este navegador. Puedes escribir el requerimiento manualmente.",
      });
      return;
    }

    const recognition = new SpeechRecognitionConstructor();
    speechRecognitionRef.current = recognition;
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const finalParts = [];
      const interimParts = [];

      for (let index = 0; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || "";
        if (!transcript) continue;

        if (event.results[index].isFinal) {
          finalParts.push(transcript);
        } else {
          interimParts.push(transcript);
        }
      }

      dictationFinalTextRef.current = finalParts.join(" ").trim();
      dictationInterimTextRef.current = interimParts.join(" ").trim();

      updateAssistantDescription(
        buildDictatedDescription(
          dictationBaseTextRef.current,
          dictationFinalTextRef.current,
          dictationInterimTextRef.current
        )
      );
    };

    recognition.onerror = (event) => {
      if (
        event.error === "language-not-supported" &&
        allowLanguageFallback &&
        language !== "es-ES"
      ) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        speechRecognitionRef.current = null;
        try {
          recognition.abort();
        } catch (err) {
          console.warn("No se pudo reiniciar el idioma del dictado:", err);
        }
        startAssistantDictation("es-ES", false);
        return;
      }

      console.error("Error en dictado por voz:", event.error);
      finalizeDictationText();
      setDictationStatus({
        type: "warning",
        text: getDictationErrorMessage(event.error),
      });
      setDictationListening(false);
    };

    recognition.onend = () => {
      finalizeDictationText();

      if (speechRecognitionRef.current === recognition) {
        speechRecognitionRef.current = null;
      }
      setDictationListening(false);
      setDictationStatus((prev) =>
        prev.type === "info" && prev.text.startsWith("Escuchando")
          ? {
              type: "info",
              text: "Dictado finalizado. Puedes editar el requerimiento manualmente.",
            }
          : prev
      );
    };

    try {
      recognition.start();
      setDictationListening(true);
      setDictationStatus({
        type: "info",
        text:
          language === "es-CL"
            ? "Escuchando en español de Chile..."
            : "Escuchando en español...",
      });
    } catch (err) {
      console.error("No se pudo iniciar el dictado por voz:", err);
      speechRecognitionRef.current = null;
      setDictationListening(false);
      setDictationStatus({
        type: "warning",
        text: "No se pudo iniciar el dictado por voz. Puedes escribir el requerimiento manualmente.",
      });
    }
  };

  const toggleAssistantDictation = () => {
    if (dictationListening) {
      setDictationStatus({
        type: "info",
        text: "Dictado detenido. Puedes editar el requerimiento manualmente.",
      });
      setDictationListening(false);
      try {
        speechRecognitionRef.current?.stop();
      } catch (err) {
        console.warn("No se pudo detener el dictado por voz:", err);
        finalizeDictationText();
      }
      return;
    }

    dictationBaseTextRef.current = assistantDescriptionRef.current;
    dictationFinalTextRef.current = "";
    dictationInterimTextRef.current = "";
    setDictationStatus({ type: "", text: "" });
    startAssistantDictation();
  };

  const requestAssistantSuggestions = async () => {
    if (assistantRequestInFlightRef.current) return;
    if (assistantUsesGemini && !aiAvailability.begin()) return;

    assistantRequestInFlightRef.current = true;
    setAssistantError("");
    console.info(
      `ValoraCloud assistant mode: ${
        assistantModeLabels[assistantRequestMode] || "automático"
      }`
    );

    try {
      setAssistantLoading(true);
      const result = await suggestQuoteItems({
        businessId: userId,
        description: assistantDescription,
        valuations,
        assistantMode: assistantRequestMode,
      });
      const suggestions = result.suggestions || [];
      setAssistantSuggestions(suggestions);
      setAssistantSource(result.source || "");
      setAssistantWarning(result.warning || "");
      setAssistantModeUsed(result.mode || assistantRequestMode);
      setAssistantModel(result.model || "");
      aiAvailability.applySuccess(result.aiRateLimit);
      if (suggestions.length === 0) {
        setAssistantError("No se generaron sugerencias para esta descripción.");
      }
    } catch (err) {
      aiAvailability.applyError(err);
      console.error("Error al sugerir ítems de cotización:", err);
      setAssistantError(
        err.message || "No se pudieron generar sugerencias en este momento."
      );
    } finally {
      assistantRequestInFlightRef.current = false;
      setAssistantLoading(false);
    }
  };

  const addSuggestionToQuote = (suggestion) => {
    const matchedValuation = getMatchedValuation(suggestion);
    if (!matchedValuation) return;
    addItem(matchedValuation, Number(suggestion.cantidadSugerida) || 1);
  };

  const openSuggestedItemDraft = (suggestion) => {
    const pricing = getSuggestedItemPricingDefaults(suggestion);
    const tipoItem = ["producto", "servicio", "actividad"].includes(
      suggestion.tipoItem
    )
      ? suggestion.tipoItem
      : "actividad";

    setSuggestedItemError("");
    setSuggestedItemTouched({});
    setSuggestedItemDraft({
      nombre: suggestion.nombre || "",
      tipoItem,
      areaId: "",
      categoriaId: "",
      categoria: "",
      marca: "",
      modelo: "",
      stock: 0,
      stockMinimo: 0,
      descripcion: buildSuggestedItemDescription(suggestion, tipoItem),
      unidad: DEFAULT_UNIT_BY_TYPE[tipoItem],
      cantidadSugerida: Math.max(Number(suggestion.cantidadSugerida) || 1, 1),
      costoBase: pricing.costoBaseSugerido,
      precioInterno: pricing.precioSugerido,
      margenDeseado: pricing.margenSugerido,
      justificacionSugerencia: suggestion.motivo || "",
      confianzaSugerencia: normalizeConfidence(
        suggestion.confianzaSugerencia ?? suggestion.confianza,
        "media"
      ),
      justificacionPrecio: pricing.justificacionPrecio,
      confianzaPrecio: pricing.confianzaPrecio,
    });
  };

  const closeSuggestedItemDraft = () => {
    setSuggestedItemDraft(null);
    setSuggestedItemTouched({});
    setSuggestedItemError("");
  };

  const markSuggestedItemFieldTouched = (field) => {
    setSuggestedItemTouched((current) => ({
      ...current,
      [field]: true,
    }));
  };

  const updateSuggestedItemDraft = (field, value) => {
    setSuggestedItemError("");
    setSuggestedItemDraft((prev) => {
      if (!prev) return prev;

      const next = {
        ...prev,
        [field]: value,
      };

      if (field === "areaId") {
        next.categoriaId = "";
        next.categoria = "";
      }
      if (field === "categoriaId") {
        next.categoria =
          inventoryCategories.find((category) => category.id === value)?.nombre || "";
      }

      if (field === "costoBase" || field === "margenDeseado") {
        const calculatedPrice = calculateSuggestedInternalPrice(
          next.costoBase,
          next.margenDeseado
        );
        next.precioInterno = calculatedPrice;
        next.confianzaPrecio = calculatedPrice
          ? "baja"
          : PRICE_CONFIDENCE_UNAVAILABLE;
        next.justificacionPrecio = calculatedPrice
          ? buildManualPriceJustification(next.margenDeseado)
          : DEFAULT_PRICE_JUSTIFICATION;
      }

      return next;
    });
  };

  const createSuggestedItem = async () => {
    if (!suggestedItemDraft) return;

    const nombre = String(suggestedItemDraft.nombre || "").trim();
    const tipoItem = String(suggestedItemDraft.tipoItem || "").trim();
    const areaId = String(suggestedItemDraft.areaId || "").trim();
    const categoriaId = String(suggestedItemDraft.categoriaId || "").trim();
    const categoria = String(suggestedItemDraft.categoria || "").trim();
    const descripcion = String(suggestedItemDraft.descripcion || "").trim();
    const unidad = String(suggestedItemDraft.unidad || "").trim();
    const justificacionSugerencia = String(
      suggestedItemDraft.justificacionSugerencia || ""
    ).trim();
    const costoBase = parseDraftNumber(suggestedItemDraft.costoBase);
    const margenDeseado = parseDraftNumber(suggestedItemDraft.margenDeseado);
    const precioInterno = calculateSuggestedInternalPrice(
      suggestedItemDraft.costoBase,
      suggestedItemDraft.margenDeseado
    );
    const cantidadSugerida = parseDraftNumber(suggestedItemDraft.cantidadSugerida);
    const validation = getSuggestedItemValidation(suggestedItemDraft);

    if (!nombre) {
      setSuggestedItemError("Ingresa el nombre del ítem sugerido.");
      return;
    }
    if (!["producto", "servicio", "actividad"].includes(tipoItem)) {
      setSuggestedItemError("Selecciona un tipo de ítem válido.");
      return;
    }
    if (!unidad) {
      setSuggestedItemError("Ingresa la unidad del ítem sugerido.");
      return;
    }
    if (hasSameDraftText(descripcion, justificacionSugerencia)) {
      setSuggestedItemError(
        "La descripción y la justificación no deben ser una copia exacta."
      );
      return;
    }
    if (!validation.isValid) {
      setSuggestedItemError("Revisa los campos marcados antes de crear el ítem.");
      return;
    }
    if (!Number.isFinite(precioInterno) || precioInterno <= 0) {
      setSuggestedItemError(
        "El precio interno queda pendiente hasta ingresar costo base y margen válidos."
      );
      return;
    }

    setSuggestedItemSaving(true);
    setSuggestedItemError("");
    setError("");

    try {
      const payload = {
        nombre,
        tipoItem,
        categoria,
        areaId,
        categoriaId,
        descripcion,
        unidad,
        costoBase,
        precioInterno,
        margenDeseado,
        estado: "activo",
        origen: "sugerencia_ia",
        creadoDesdeCotizacion: true,
        justificacionSugerencia,
        justificacionPrecio: buildManualPriceJustification(margenDeseado),
        confianzaSugerencia: suggestedItemDraft.confianzaSugerencia,
        confianzaPrecio: "baja",
        ...(tipoItem === "producto"
          ? {
              marca: String(suggestedItemDraft.marca || "").trim(),
              modelo: String(suggestedItemDraft.modelo || "").trim(),
              stock: Number(suggestedItemDraft.stock || 0),
              stockMinimo: Number(suggestedItemDraft.stockMinimo || 0),
            }
          : {}),
      };
      const requestId = `quote-inventory-${
        globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }`;
      const createdResult = await createManagedInventoryItem(
        userId,
        payload,
        requestId
      );
      const createdItem = {
        id: createdResult.itemId,
        codigoInterno: createdResult.codigoInterno,
        modeloInventarioVersion: 2,
        ...payload,
      };
      const createdValuation = {
        itemId: createdResult.itemId,
        item: createdItem,
        nombre: createdItem.nombre,
        tipoItem: createdItem.tipoItem,
        categoria: createdItem.categoria,
        unidad: createdItem.unidad,
        costoBase: createdItem.costoBase,
        margenDeseado: createdItem.margenDeseado,
        precioInterno: createdItem.precioInterno,
        precioBase: createdItem.precioInterno,
        promedioReferencias: null,
        cantidadReferencias: 0,
        diferenciaPorcentual: null,
        precioSugerido: createdItem.precioInterno,
        estadoValorizacion: PRICING_STATUS.SIN_REFERENCIAS,
        referencias: [],
      };

      setValuations((prev) => [createdValuation, ...prev]);
      closeSuggestedItemDraft();
      addItem(createdValuation, cantidadSugerida);
      showItemFeedback("Ítem sugerido creado en inventario y agregado a la cotización.");
    } catch (err) {
      console.error("Error creando ítem sugerido:", err);
      setSuggestedItemError(
        err.message || "No se pudo crear el ítem sugerido."
      );
    } finally {
      setSuggestedItemSaving(false);
    }
  };

  const addMatchedSuggestionsToQuote = () => {
    if (matchedAssistantSuggestions.length === 0) return;

    setSuccess("");
    setError("");

    const existingCount = matchedAssistantSuggestions.filter(({ valuation }) =>
      quote.items.some((item) => item.itemId === valuation.itemId)
    ).length;
    const firstItemId = matchedAssistantSuggestions[0].valuation.itemId;

    setQuote((prev) => {
      const pendingByItemId = new Map(
        matchedAssistantSuggestions.map((group) => [
          group.valuation.itemId,
          group,
        ])
      );

      const updatedItems = prev.items.map((item) => {
        const group = pendingByItemId.get(item.itemId);
        if (!group) return item;

        pendingByItemId.delete(item.itemId);
        return {
          ...item,
          cantidad: Number(item.cantidad || 0) + group.quantity,
        };
      });

      const newItems = Array.from(pendingByItemId.values()).map(
        ({ valuation, quantity }) => ({
          ...createQuoteItemFromValuation(valuation),
          cantidad: quantity,
        })
      );

      return {
        ...prev,
        items: normalizeQuoteItems([...updatedItems, ...newItems]),
      };
    });

    showItemFeedback(
      existingCount > 0
        ? "Sugerencias con inventario agregadas. Los ítems existentes actualizaron su cantidad."
        : "Sugerencias con inventario agregadas a la cotización."
    );
    setHighlightedItemId(firstItemId);

    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedItemId("");
    }, 1800);

    window.requestAnimationFrame(() => {
      addedItemsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const updateItem = (itemId, field, value) => {
    setItemsInteracted(true);
    setDirty(true);
    setQuote((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        (item.lineaId || item.itemId) === itemId ? { ...item, [field]: value } : item
      ),
    }));

    if (field === "cantidad") {
      showItemFeedback("Cantidad actualizada en la cotización.");
    }
  };

  const removeItem = (itemId) => {
    setItemsInteracted(true);
    setDirty(true);
    setQuote((prev) => ({
      ...prev,
      items: prev.items.filter((item) => (item.lineaId || item.itemId) !== itemId),
    }));
    showItemFeedback("Ítem eliminado de la cotización.");
  };

  const handleCatalogTypeChange = (event) => {
    setCatalogTypeFilter(event.target.value);
    setManualCatalogVisibleCount(MANUAL_CATALOG_PAGE_SIZE);
  };

  const moveItem = (index, direction) => {
    setDirty(true);
    setQuote((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.items.length) return prev;
      const items = [...prev.items];
      [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
      return { ...prev, items };
    });
  };

  const clearQuote = () => {
    if (isEditMode && loadedDraftQuote) {
      setQuote(loadedDraftQuote);
      setSavedQuoteId(editQuoteId);
      setError("");
      setSuccess("");
      setItemFeedback("");
      setHighlightedItemId("");
      setDirty(false);
      return;
    }

    setQuote(buildInitialQuote(projectContext));
    originalLinkedClientRef.current = {
      clienteId: String(projectContext?.clienteId || projectContext?.clienteSnapshot?.clienteId || ""),
      snapshot: projectContext?.clienteSnapshot || null,
    };
    currentClienteIdRef.current = originalLinkedClientRef.current.clienteId;
    setSavedQuoteId(null);
    setError("");
    setSuccess("");
    setItemFeedback("");
    setHighlightedItemId("");
    setItemsInteracted(false);
    setSaveAttempted(false);
    createRequestIdRef.current = "";
    setDirty(false);
  };

  const validateQuote = () => {
    if (!isEditMode && !quote.clienteId) {
      return "Selecciona un cliente activo registrado.";
    }
    if (!quoteValidation.isValid) {
      return Object.values(quoteValidation.fieldErrors)[0];
    }
    return totalsResult.error?.message || "";
  };

  const saveBlockedByClient = !isEditMode && (
    clientAvailability.loading ||
    Boolean(clientAvailability.error) ||
    !clientAvailability.hasActiveClients ||
    !quote.clienteId
  );
  const saveBlockedByItems = quote.items.length === 0;
  const saveBlocked = saveBlockedByClient || saveBlockedByItems;

  // Qué falta para habilitar "Crear cotización" / "Guardar cambios". Los
  // valores mal ingresados (montos, apartados) se siguen informando al pulsar.
  const missingRequirements = [];
  if (!isEditMode && !clientAvailability.loading && !clientAvailability.error) {
    if (!clientAvailability.hasActiveClients) missingRequirements.push("registrar un cliente activo");
    else if (!quote.clienteId) missingRequirements.push("cliente");
  }
  if (saveBlockedByItems) missingRequirements.push("al menos un ítem");
  const saveBlockedReason = !isEditMode && clientAvailability.loading
    ? "Cargando clientes…"
    : !isEditMode && clientAvailability.error
      ? "No se pudieron cargar los clientes."
      : missingRequirements.length
        ? `Falta: ${missingRequirements.join(" · ")}`
        : "";

  const saveQuote = async () => {
    if (savingRef.current) return;
    if (isEditMode && editLockedMessage) {
      setError(editLockedMessage);
      return;
    }

    setSaveAttempted(true);
    const validationError = validateQuote();
    if (validationError) {
      setError(validationError);
      setSuccess("");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSavingEstado("borrador");
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...quote,
        estado: "borrador",
        empresa: quote.empresa || companyProfile || {},
        items: quote.items,
        subtotal: totals.subtotal,
        descuento: totals.descuento,
        descuentoTotal: totals.descuentoTotal,
        neto: totals.neto,
        iva: totals.iva,
        total: totals.total,
      };
      if (!savedQuoteId && !createRequestIdRef.current) {
        createRequestIdRef.current = createQuoteRequestId();
      }
      const saved = savedQuoteId
        ? await updateQuote(userId, savedQuoteId, payload)
        : await createQuote(userId, payload, {
            requestId: createRequestIdRef.current,
          });
      const isNewQuote = !savedQuoteId;
      if (isNewQuote) {
        setSavedQuoteId(saved.id);
      }
      const nextSavedQuote = buildQuoteFromSavedQuote(saved);
      originalLinkedClientRef.current = {
        clienteId: nextSavedQuote.clienteId,
        snapshot: nextSavedQuote.cliente,
      };
      currentClienteIdRef.current = nextSavedQuote.clienteId;
      setQuote(nextSavedQuote);
      setDirty(false);
      if (isEditMode) {
        setLoadedDraftQuote(nextSavedQuote);
      }
      const quoteNumber = getQuoteDisplayNumber(saved, saved.id || "");
      if (isNewQuote) {
        createRequestIdRef.current = "";
        navigate("/cotizaciones", {
          state: {
            createdQuoteNumber: quoteNumber,
            openQuoteId: saved.id,
          },
        });
        return;
      }
      sileo.success({
        title: "Cambios guardados",
        description: `${quoteNumber} continúa pendiente. Aún no ha sido enviada al cliente.`,
      });
    } catch (err) {
      console.error("Error al guardar cotización:", err);
      const message = err.message || "No se pudo guardar la cotización.";
      setError(message);
      sileo.error({
        title: "No se pudo guardar la cotización",
        description: message,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
      setSavingEstado("");
    }
  };

  if (!userId) {
    return (
      <section className="page-section">
        <p style={styles.errorText}>Debes iniciar sesión para crear cotizaciones.</p>
      </section>
    );
  }

  if (isEditMode && editLoading) {
    return (
      <section className="quote-page" style={styles.wrapper}>
        <div className="no-print ui-reveal-delay" style={styles.panel} role="status">
          <div style={styles.loadingSpinner}><Spinner /></div>
          <h3 style={styles.panelTitle}>Cargando cotización pendiente</h3>
          <p style={styles.helpText}>Estamos obteniendo la cotización guardada.</p>
        </div>
      </section>
    );
  }

  if (isEditMode && (editLoadError || editLockedMessage)) {
    return (
      <section className="quote-page" style={styles.wrapper}>
        <div className="no-print" style={styles.panel}>
          <h3 style={styles.panelTitle}>Edición no disponible</h3>
          <p style={styles.errorText}>{editLoadError || editLockedMessage}</p>
          <Link to="/cotizaciones" style={styles.secondaryLinkButton}>
            Volver a Historial
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="quote-page quote-workspace">
      <section className="quote-workspace__panel quote-workspace__client-project no-print">
        <div>
          <span className="quote-workspace__kicker">Cliente</span>
          <ClientSelector businessId={userId} value={quote.clienteId} snapshot={quote.cliente} onChange={handleClientChange} onAvailabilityChange={setClientAvailability} />
        </div>
        <div className="quote-workspace__project">
          <label className="quote-workspace__project-field">
            <span className="quote-workspace__kicker">Asunto</span>
            <input type="text" value={quote.proyectoNombre} onChange={(event) => updateField("proyectoNombre", event.target.value)} placeholder="Ej. Escalera zona de estanque" />
            <small>Resume en pocas palabras qué se cotiza. Aparece como 'Proyecto' en el PDF.</small>
          </label>
          {quote.trabajoId && (
            <Link to="/trabajos" state={{openWorkId: quote.trabajoId}} className="quote-workspace__project-link">
              Proyecto {quote.trabajoNumero || quote.trabajoTitulo || quote.trabajoId}
            </Link>
          )}
        </div>
      </section>

      {error && <p className="no-print" style={styles.errorText}>{error}</p>}
      {success && <p className="no-print" style={styles.successText}>{success}</p>}

      <div className="quote-workspace__layout">
        <main className="quote-workspace__main">
      {false && assistantOpen && (
      <QuoteCollapsibleSection
        title="Usar asistente para sugerir ítems"
        summary="Herramienta opcional de estructura, dictado y sugerencias"
        open={assistantOpen}
        onToggle={() => setAssistantOpen((current) => !current)}
      >
      <div className="quote-workspace__secondary-body">
        <div style={{ ...styles.sectionHeader, ...styles.assistantHeader }}>
          <div>
            <h3 style={{ ...styles.panelTitle, ...styles.assistantTitle }}>
              Asistente de estructura
            </h3>
            <p style={styles.helpText}>
              Describe brevemente el trabajo o servicio que necesitas cotizar.
              ValoraCloud sugerirá posibles ítems, pero tú decides qué agregar
              y el sistema mantendrá el cálculo de precios basado en inventario,
              referencias y valorización.
            </p>
          </div>
        </div>

        <textarea
          value={assistantDescription}
          onChange={handleAssistantDescriptionChange}
          rows={4}
          maxLength={ASSISTANT_DESCRIPTION_MAX_LENGTH}
          placeholder="Describe el trabajo, servicio o solución que necesitas cotizar"
          style={{ ...styles.textarea, ...styles.assistantTextarea }}
        />
        <div style={styles.dictationRow}>
          <div style={styles.dictationControls}>
            <button
              type="button"
              onClick={toggleAssistantDictation}
              aria-pressed={dictationListening}
              style={{
                ...styles.dictationButton,
                ...(dictationListening ? styles.dictationButtonActive : {}),
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  ...styles.micIcon,
                  ...(dictationListening ? styles.micIconActive : {}),
                }}
              />
              {dictationListening ? "Detener dictado" : "Dictar"}
            </button>
            <span
              style={{
                ...styles.dictationStatusBadge,
                ...(dictationListening ? styles.dictationStatusActive : {}),
                ...(dictationStatus.type === "warning" ||
                dictationStatus.type === "unsupported"
                  ? styles.dictationStatusWarning
                  : {}),
              }}
            >
              <span
                style={{
                  ...styles.statusDot,
                  ...(dictationListening ? styles.statusDotActive : {}),
                  ...(dictationStatus.type === "warning" ||
                  dictationStatus.type === "unsupported"
                    ? styles.statusDotWarning
                    : {}),
                }}
              />
              {dictationStateLabel}
            </span>
          </div>
          <span style={styles.assistantNote}>
            Escribe o dicta el requerimiento para obtener sugerencias.
          </span>
        </div>
        {dictationStatus.text && (
          <p
            style={
              dictationStatus.type === "warning" ||
              dictationStatus.type === "unsupported"
                ? styles.warningText
                : styles.infoText
            }
          >
            {dictationStatus.text}
          </p>
        )}
        <div style={styles.assistantActions}>
          <button
            type="button"
            onClick={requestAssistantSuggestions}
            disabled={assistantLoading || aiAvailability.isBlocked}
            style={styles.primaryButton}
          >
            {assistantLoading ? "Sugiriendo..." : "Sugerir ítems"}
          </button>
          <span style={styles.assistantNote}>
            Las sugerencias no modifican precios ni crean la cotización automáticamente.
          </span>
        </div>

        <AiAvailabilityStatus
          status={aiAvailability.status}
          remainingSeconds={aiAvailability.remainingSeconds}
          actionLabel="solicitar nuevas sugerencias"
        />

        {assistantError && <p style={styles.errorText}>{assistantError}</p>}
        {visibleAssistantWarning && (
          <p style={styles.warningText}>{visibleAssistantWarning}</p>
        )}

        {assistantSuggestions.length > 0 && (
          <>
            {matchedAssistantSuggestions.length > 0 && (
              <div style={styles.suggestionToolbar}>
                <button
                  type="button"
                  onClick={addMatchedSuggestionsToQuote}
                  style={styles.primaryButton}
                >
                  Agregar sugerencias con inventario
                </button>
                <span style={styles.assistantNote}>
                  Agrega las coincidencias y actualiza cantidades si ya existen.
                </span>
              </div>
            )}
            <div style={styles.suggestionGrid}>
              {assistantSuggestions.map((suggestion, index) => {
                const matchedValuation = getMatchedValuation(suggestion);
                const quoteQuantity = matchedValuation
                  ? itemQuantityById[matchedValuation.itemId] || 0
                  : 0;
                return (
                  <article
                    key={`${suggestion.nombre}-${index}`}
                    style={styles.suggestionCard}
                  >
                    <div>
                      <strong>{suggestion.nombre}</strong>
                      <span style={styles.itemMeta}>
                        {tipoLabels[suggestion.tipoItem] || suggestion.tipoItem} ·
                        cantidad sugerida: {suggestion.cantidadSugerida}
                      </span>
                    </div>
                    <p style={styles.suggestionReason}>{suggestion.motivo}</p>
                    {Array.isArray(suggestion.palabrasClave) &&
                      suggestion.palabrasClave.length > 0 && (
                        <div style={styles.keywordList}>
                          {suggestion.palabrasClave.map((keyword) => (
                            <span key={keyword} style={styles.keywordBadge}>
                              {keyword}
                            </span>
                          ))}
                        </div>
                      )}
                    <span
                      style={{
                        ...styles.matchBadge,
                        ...(matchedValuation
                          ? styles.matchBadgeFound
                          : styles.matchBadgeMissing),
                      }}
                    >
                      {matchedValuation
                        ? `Coincide con inventario: ${matchedValuation.nombre}`
                        : "No encontrado en inventario"}
                    </span>
                    {matchedValuation && (
                      <>
                        {quoteQuantity > 0 && (
                          <span style={styles.quoteBadge}>
                            En cotización: {quoteQuantity}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => addSuggestionToQuote(suggestion)}
                          style={styles.secondaryButton}
                        >
                          {quoteQuantity > 0
                            ? "Agregar otra vez"
                            : "Agregar ítem valorizado"}
                        </button>
                      </>
                    )}
                    {!matchedValuation && (
                      <button
                        type="button"
                        onClick={() => openSuggestedItemDraft(suggestion)}
                        style={styles.secondaryButton}
                      >
                        Crear ítem sugerido
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
      </QuoteCollapsibleSection>
      )}

      <QuoteCatalogDialog
        open={manualCatalogOpen}
        onClose={() => setManualCatalogOpen(false)}
        loading={loading}
        totalCount={valuations.length}
        filteredCount={filteredValuations.length}
        valuations={visibleCatalogValuations}
        itemQuantityById={itemQuantityById}
        search={search}
        onSearchChange={handleCatalogSearchChange}
        typeFilter={catalogTypeFilter}
        onTypeChange={handleCatalogTypeChange}
        onAdd={addItem}
        catalogHasMoreItems={catalogHasMoreItems}
        catalogShowingAllItems={catalogShowingAllItems}
        onShowMore={showMoreCatalogItems}
        onShowLess={showLessCatalogItems}
      />

      <div ref={addedItemsRef}>
        <QuoteItemsEditor
          items={normalizedItems}
          subtotal={totals.subtotal}
          feedback={itemFeedback}
          highlightedItemId={highlightedItemId}
          onOpenCatalog={() => setManualCatalogOpen(true)}
          onScanProduct={addScannedProduct}
          onUpdate={updateItem}
          onMove={moveItem}
          onRemove={removeItem}
          validationError={saveAttempted || itemsInteracted
            ? quoteValidation.fieldErrors.items || quoteValidation.fieldErrors.numericos
            : ""}
        />
      </div>

      <QuoteCollapsibleSection
        title="Qué incluye esta propuesta"
        summary={quote.seccionesAlcance.length > 1
          ? `${quote.seccionesAlcance.length} apartados`
          : hasScopeContent(quote.seccionesAlcance)
            ? "Con descripción"
            : "Opcional"}
        open={scopeOpen}
        onToggle={() => setScopeOpen((current) => !current)}
      >
        <div className="quote-workspace__secondary-body">
          <div className="quote-workspace__secondary-header">
            <p style={styles.helpText}>Describe brevemente los trabajos, servicios o entregables incluidos en la cotización. Las secciones vacías no aparecerán en el PDF.</p>
            <button type="button" onClick={addScopeSection} className="quote-workspace__button quote-workspace__button--secondary">+ Agregar apartado</button>
          </div>
          {isAdvancedScope ? (
            <div style={styles.scopeList}>
              {quote.seccionesAlcance.map((section, index) => (
                <article key={section.id} style={styles.scopeCard}>
                  <div style={styles.scopeHeader}>
                    <input value={section.titulo} onChange={(event) => updateScopeSection(section.id, { titulo: event.target.value })} placeholder="Título del apartado" style={styles.input} />
                    <div style={styles.scopeActions}>
                      <button type="button" aria-label="Subir apartado" disabled={index === 0} onClick={() => moveScopeSection(index, -1)} style={styles.orderButton}>↑</button>
                      <button type="button" aria-label="Bajar apartado" disabled={index === quote.seccionesAlcance.length - 1} onClick={() => moveScopeSection(index, 1)} style={styles.orderButton}>↓</button>
                      <button type="button" onClick={() => removeScopeSection(section.id)} style={styles.removeButton}>Eliminar</button>
                    </div>
                  </div>
                  <textarea rows={4} value={(section.lineas || []).join("\n")} onChange={(event) => updateScopeSection(section.id, { lineas: event.target.value.split(/\r?\n/) })} placeholder="Una línea descriptiva por renglón" style={styles.textarea} />
                  {(quoteValidation.fieldErrors[`alcance.${index}.titulo`] || quoteValidation.fieldErrors[`alcance.${index}.lineas`]) && (
                    <span style={styles.fieldErrorText}>{quoteValidation.fieldErrors[`alcance.${index}.titulo`] || quoteValidation.fieldErrors[`alcance.${index}.lineas`]}</span>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <textarea
              rows={4}
              value={primaryScopeText}
              onChange={(event) => updatePrimaryScopeText(event.target.value)}
              placeholder="Ej: instalación completa, materiales incluidos, pruebas de funcionamiento..."
              style={styles.textarea}
            />
          )}
        </div>
      </QuoteCollapsibleSection>

      <section className="quote-workspace__panel quote-conditions-primary no-print">
        <header className="quote-workspace__panel-header">
          <div>
            <span className="quote-workspace__kicker">Condiciones comerciales</span>
            <h2>Condiciones principales</h2>
            <p>Los valores de Empresa se copiaron a este documento y puedes ajustarlos sólo para esta cotización.</p>
          </div>
        </header>
        <div className="quote-conditions-primary__grid">
          <Field label="Vigencia (días)"><input type="number" min="1" max="3650" value={quote.validezDias} onChange={(event) => updateField("validezDias", event.target.value)} style={styles.input} /></Field>
          <Field label="Tratamiento tributario"><select value={quote.afectaIva === false ? "exenta" : "afecta"} onChange={(event) => updateField("afectaIva", event.target.value === "afecta")} style={styles.input}><option value="afecta">Afecta IVA 19%</option><option value="exenta">Exenta de IVA</option></select></Field>
          <Field label="Forma de pago"><input value={quote.condiciones.formaPago} onChange={(event) => updateCondition("formaPago", event.target.value)} style={styles.input} /></Field>
          <Field label="Plazo de ejecución o entrega">
            <input value={quote.condiciones.plazoEntrega} onChange={(event) => updateCondition("plazoEntrega", event.target.value)} placeholder="Ej: 10 días hábiles" style={styles.input} />
            {plazoRangeOpen ? (
              <div>
                <div style={styles.plazoRangeRow}>
                  <input type="date" value={plazoRangeDraft.desde} onChange={(event) => setPlazoRangeDraft((current) => ({ ...current, desde: event.target.value }))} style={{ ...styles.input, width: "auto" }} />
                  <span aria-hidden="true">→</span>
                  <input type="date" min={plazoRangeDraft.desde || undefined} value={plazoRangeDraft.hasta} onChange={(event) => setPlazoRangeDraft((current) => ({ ...current, hasta: event.target.value }))} style={{ ...styles.input, width: "auto" }} />
                  <button type="button" disabled={!plazoRangeValid} onClick={applyPlazoRange} className="quote-workspace__button quote-workspace__button--primary">Aceptar</button>
                  <button type="button" onClick={() => setPlazoRangeOpen(false)} className="quote-workspace__button quote-workspace__button--secondary">Cancelar</button>
                </div>
                {plazoRangeShowError && (
                  <span style={styles.fieldErrorText}>La fecha "hasta" no puede ser anterior a "desde".</span>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => setPlazoRangeOpen(true)} className="quote-workspace__link-button">Definir con fecha desde/hasta</button>
            )}
          </Field>
        </div>
      </section>

      <QuoteCollapsibleSection
        title="Más condiciones"
        summary={[quote.condiciones.garantia, quote.condiciones.alcanceGeografico, quote.condiciones.observaciones].filter(Boolean).length ? "Hay condiciones adicionales configuradas" : "Garantía, alcance, observaciones, exclusiones y términos"}
        open={conditionsOpen}
        onToggle={() => setConditionsOpen((current) => !current)}
      >
        <div className="quote-workspace__secondary-body">
          <div className="quote-workspace__secondary-header">
            <p style={styles.helpText}>Estos cambios afectan sólo a este documento.</p>
            <button type="button" onClick={restoreDefaultConditions} className="quote-summary__clear">Restaurar valores de Empresa</button>
          </div>
          <div style={styles.conditionsGrid}>
            <Field label="Garantía"><input value={quote.condiciones.garantia} onChange={(event) => updateCondition("garantia", event.target.value)} style={styles.input} /></Field>
            <Field label="Alcance geográfico"><input value={quote.condiciones.alcanceGeografico} onChange={(event) => updateCondition("alcanceGeografico", event.target.value)} style={styles.input} /></Field>
            <CompactConditionField label="Observaciones" value={quote.condiciones.observaciones} onChange={(value) => updateCondition("observaciones", value)} />
            <CompactConditionField label="Exclusiones" value={quote.condiciones.exclusiones} onChange={(value) => updateCondition("exclusiones", value)} />
            <CompactConditionField label="Otras condiciones" value={quote.condiciones.terminosAdicionales} onChange={(value) => updateCondition("terminosAdicionales", value)} />
          </div>
        </div>
      </QuoteCollapsibleSection>
        </main>

        <QuoteSummaryPanel
          currency={quote.moneda || companyProfile?.monedaCodigo || "CLP"}
          isEditMode={isEditMode}
          locale={quote.locale || companyProfile?.locale || "es-CL"}
          quote={quote}
          totals={totals}
          totalsError={totalsResult.error?.message || ""}
          taxName={quote.impuestoNombre || companyProfile?.impuestoPredeterminadoNombre || "IVA"}
          taxRate={Number(quote.tasaIva ?? Number(companyProfile?.impuestoPredeterminadoTasa ?? 19) / 100) * 100}
          saving={saving}
          savingEstado={savingEstado}
          quoteDate={isEditMode && quote.fecha ? formatDate(quote.fecha) : ""}
          quoteNumber={isEditMode ? getQuoteDisplayNumber(quote) : ""}
          saveBlocked={saveBlocked}
          saveBlockedReason={saveBlocked ? saveBlockedReason : ""}
          onDiscountChange={(event) => updateField("descuento", event.target.value)}
          onSave={saveQuote}
        />
      </div>

      {suggestedItemDraft && (
        <div className="no-print" style={styles.modalOverlay}>
          <div style={styles.modalPanel}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.panelTitle}>Crear ítem sugerido</h3>
                <p style={styles.helpText}>
                  Completa la categoría y el costo base antes de agregarlo a la
                  cotización.
                </p>
              </div>
              <button
                type="button"
                onClick={closeSuggestedItemDraft}
                style={styles.clearButton}
                disabled={suggestedItemSaving}
              >
                Cerrar
              </button>
            </div>

            <div style={styles.modalBody}>
              <section style={styles.modalSection}>
                <h4 style={styles.modalSectionTitle}>Datos del ítem</h4>
                <div style={styles.modalThreeColumnGrid}>
                  <Field label="Nombre">
                    <input
                      type="text"
                      value={suggestedItemDraft.nombre}
                      onChange={(event) =>
                        updateSuggestedItemDraft("nombre", event.target.value)
                      }
                      style={styles.input}
                    />
                  </Field>
                  <Field label="Tipo">
                    <select
                      value={suggestedItemDraft.tipoItem}
                      onChange={(event) =>
                        updateSuggestedItemDraft("tipoItem", event.target.value)
                      }
                      style={styles.input}
                    >
                      <option value="producto">Producto</option>
                      <option value="servicio">Servicio</option>
                      <option value="actividad">Actividad</option>
                    </select>
                  </Field>
                  <Field
                    label="Área"
                    helpText={
                      suggestedItemTouched.areaId
                        ? suggestedItemValidation.messages.areaId
                        : ""
                    }
                    helpTone="error"
                  >
                    <select
                      value={suggestedItemDraft.areaId}
                      onBlur={() => markSuggestedItemFieldTouched("areaId")}
                      onChange={(event) =>
                        updateSuggestedItemDraft("areaId", event.target.value)
                      }
                      style={styles.input}
                    >
                      <option value="">Selecciona un área</option>
                      {inventoryAreas
                        .filter((area) => (area.estado || "activo") === "activo")
                        .map((area) => (
                          <option key={area.id} value={area.id}>{area.nombre}</option>
                        ))}
                    </select>
                  </Field>
                  <Field
                    label="Categoría"
                    helpText={
                      suggestedItemTouched.categoriaId
                        ? suggestedItemValidation.messages.categoriaId
                        : ""
                    }
                    helpTone="error"
                  >
                    <select
                      value={suggestedItemDraft.categoriaId}
                      onBlur={() => markSuggestedItemFieldTouched("categoriaId")}
                      onChange={(event) =>
                        updateSuggestedItemDraft("categoriaId", event.target.value)
                      }
                      disabled={!suggestedItemDraft.areaId}
                      style={styles.input}
                    >
                      <option value="">Selecciona una categoría</option>
                      {suggestedItemCategories.map((category) => (
                        <option key={category.id} value={category.id}>{category.nombre}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                {suggestedItemDraft.tipoItem === "producto" && (
                  <div style={styles.modalThreeColumnGrid}>
                    <Field
                      label="Marca"
                      helpText={suggestedItemTouched.marca ? suggestedItemValidation.messages.marca : ""}
                      helpTone="error"
                    >
                      <input
                        value={suggestedItemDraft.marca}
                        onBlur={() => markSuggestedItemFieldTouched("marca")}
                        onChange={(event) => updateSuggestedItemDraft("marca", event.target.value)}
                        style={styles.input}
                      />
                    </Field>
                    <Field
                      label="Modelo"
                      helpText={suggestedItemTouched.modelo ? suggestedItemValidation.messages.modelo : ""}
                      helpTone="error"
                    >
                      <input
                        value={suggestedItemDraft.modelo}
                        onBlur={() => markSuggestedItemFieldTouched("modelo")}
                        onChange={(event) => updateSuggestedItemDraft("modelo", event.target.value)}
                        style={styles.input}
                      />
                    </Field>
                  </div>
                )}
              </section>

              <section style={styles.modalSection}>
                <h4 style={styles.modalSectionTitle}>Valores para cotización</h4>
                <div style={styles.modalThreeColumnGrid}>
                  <Field label="Unidad">
                    <input
                      type="text"
                      value={suggestedItemDraft.unidad}
                      onChange={(event) =>
                        updateSuggestedItemDraft("unidad", event.target.value)
                      }
                      style={styles.input}
                    />
                  </Field>
                  <Field
                    label="Cantidad sugerida"
                    helpText={
                      suggestedItemTouched.cantidadSugerida
                        ? suggestedItemValidation.messages.cantidadSugerida
                        : ""
                    }
                    helpTone="error"
                  >
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={suggestedItemDraft.cantidadSugerida}
                      onBlur={() =>
                        markSuggestedItemFieldTouched("cantidadSugerida")
                      }
                      onChange={(event) =>
                        updateSuggestedItemDraft(
                          "cantidadSugerida",
                          event.target.value
                        )
                      }
                      style={styles.input}
                    />
                  </Field>
                  <Field
                    label="Costo base"
                    helpText={
                      suggestedItemTouched.costoBase
                        ? suggestedItemValidation.messages.costoBase
                        : ""
                    }
                    helpTone="error"
                  >
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={suggestedItemDraft.costoBase}
                      onBlur={() => markSuggestedItemFieldTouched("costoBase")}
                      onChange={(event) =>
                        updateSuggestedItemDraft("costoBase", event.target.value)
                      }
                      placeholder="Ingresa costo base"
                      style={styles.input}
                    />
                  </Field>
                </div>
                <div style={styles.modalThreeColumnGrid}>
                  <Field
                    label="Margen deseado"
                    helpText={
                      suggestedItemTouched.margenDeseado
                        ? suggestedItemValidation.messages.margenDeseado
                        : ""
                    }
                    helpTone="error"
                  >
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={suggestedItemDraft.margenDeseado}
                      onBlur={() =>
                        markSuggestedItemFieldTouched("margenDeseado")
                      }
                      onChange={(event) =>
                        updateSuggestedItemDraft("margenDeseado", event.target.value)
                      }
                      style={styles.input}
                    />
                  </Field>
                  <Field label="Precio interno calculado">
                    <div style={styles.readOnlyValue}>
                      {suggestedItemDraft.precioInterno
                        ? formatBusinessAmount(suggestedItemDraft.precioInterno)
                        : "Pendiente"}
                    </div>
                  </Field>
                  <Field label="Confianza del precio">
                    <div style={styles.readOnlyValue}>
                      {confidenceLabels[suggestedItemDraft.confianzaPrecio] ||
                        suggestedItemDraft.confianzaPrecio}
                    </div>
                  </Field>
                </div>
              </section>

              <section style={styles.modalSection}>
                <h4 style={styles.modalSectionTitle}>
                  Información de la sugerencia
                </h4>
                <div style={styles.modalThreeColumnGrid}>
                  <Field label="Confianza de la sugerencia">
                    <select
                      value={suggestedItemDraft.confianzaSugerencia}
                      onChange={(event) =>
                        updateSuggestedItemDraft(
                          "confianzaSugerencia",
                          event.target.value
                        )
                      }
                      style={styles.input}
                    >
                      <option value="baja">Baja</option>
                      <option value="media">Media</option>
                      <option value="alta">Alta</option>
                    </select>
                  </Field>
                </div>
                <div style={styles.modalTextGrid}>
                  <Field label="Descripción">
                    <textarea
                      rows={3}
                      value={suggestedItemDraft.descripcion}
                      onChange={(event) =>
                        updateSuggestedItemDraft("descripcion", event.target.value)
                      }
                      style={{ ...styles.textarea, ...styles.compactModalTextarea }}
                    />
                  </Field>
                  <Field label="Justificación de la sugerencia">
                    <textarea
                      rows={3}
                      value={suggestedItemDraft.justificacionSugerencia}
                      onChange={(event) =>
                        updateSuggestedItemDraft(
                          "justificacionSugerencia",
                          event.target.value
                        )
                      }
                      style={{ ...styles.textarea, ...styles.compactModalTextarea }}
                    />
                  </Field>
                </div>
                <Field label="Justificación de precio" wide>
                  <div style={styles.priceTraceBox}>
                    {suggestedItemDraft.justificacionPrecio ||
                      DEFAULT_PRICE_JUSTIFICATION}
                  </div>
                </Field>
              </section>

              {suggestedItemError && (
                <p style={styles.errorText}>{suggestedItemError}</p>
              )}
            </div>

            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={closeSuggestedItemDraft}
                style={styles.clearButton}
                disabled={suggestedItemSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={createSuggestedItem}
                style={styles.primaryButton}
                disabled={suggestedItemSaving || !suggestedItemValidation.isValid}
              >
                {suggestedItemSaving ? "Creando..." : "Crear y agregar"}
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}

function Field({ label, helpText, helpTone = "default", wide = false, children }) {
  return (
    <label style={{ ...styles.field, ...(wide ? styles.wideField : {}) }}>
      <span style={styles.label}>{label}</span>
      {helpText && (
        <span
          style={{
            ...styles.fieldHelpText,
            ...(helpTone === "error" ? styles.fieldErrorText : {}),
          }}
        >
          {helpText}
        </span>
      )}
      {children}
    </label>
  );
}

function CompactConditionField({ label, onChange, value }) {
  const hasContent = Boolean((value || "").trim());
  const [expanded, setExpanded] = React.useState(hasContent);
  const showTextarea = expanded || hasContent;
  const rows = Math.min(8, Math.max(3, (value || "").split(/\r?\n/).length + 1));
  return (
    <Field label={label} wide>
      {showTextarea ? (
        <textarea
          autoFocus={expanded && !hasContent}
          onBlur={() => {
            if (!(value || "").trim()) setExpanded(false);
          }}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          style={styles.compactTextarea}
          value={value || ""}
        />
      ) : (
        <button
          className="quote-workspace__button quote-workspace__button--secondary"
          onClick={() => setExpanded(true)}
          type="button"
        >
          + Agregar {label.toLowerCase()}
        </button>
      )}
    </Field>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "22px",
    minWidth: 0,
  },
  header: {
    alignItems: "flex-start",
    borderBottom: "1px solid var(--color-border-default)",
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "16px",
    paddingBottom: "14px",
  },
  title: {
    margin: "4px 0 6px",
    color: "var(--color-text-strong)",
    fontSize: "28px",
    fontWeight: 900,
  },
  subtitle: {
    margin: 0,
    color: "var(--color-text-muted)",
    lineHeight: 1.5,
    maxWidth: "720px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
    gap: "18px",
  },
  bottomGrid: {
    alignItems: "start",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(310px, 380px)",
    gap: "18px",
  },
  closingSection: {
    display: "grid",
    gap: "12px",
  },
  closingTitle: {
    color: "var(--color-text-strong)",
    fontSize: "20px",
    fontWeight: 900,
    margin: 0,
  },
  panel: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "8px",
    boxShadow: "var(--shadow-sm)",
    padding: "20px",
  },
  panelTitle: {
    color: "var(--color-text-strong)",
    margin: "0 0 12px",
    fontSize: "18px",
    fontWeight: 900,
  },
  compactPanelTitle: {
    marginBottom: "6px",
  },
  loadingSpinner: {
    marginBottom: "12px",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "12px",
  },
  quoteDataGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  },
  field: {
    display: "grid",
    gap: "6px",
  },
  wideField: {
    gridColumn: "1 / -1",
  },
  label: {
    color: "var(--color-text-default)",
    fontSize: "13px",
    fontWeight: 700,
  },
  labelRow: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "7px",
  },
  fieldHeader: {
    alignItems: "center",
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
    minWidth: 0,
  },
  fieldBadge: {
    background: "var(--color-brand-50)",
    border: "1px solid var(--color-brand-200)",
    borderRadius: "999px",
    color: "var(--color-brand-600)",
    fontSize: "11px",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "3px 7px",
    whiteSpace: "nowrap",
  },
  fieldHelpText: {
    color: "var(--color-text-muted)",
    fontSize: "12px",
    lineHeight: 1.4,
  },
  fieldErrorText: {
    color: "var(--color-danger-700)",
    fontWeight: 700,
  },
  input: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-control)",
    borderRadius: "6px",
    color: "var(--color-text-strong)",
    lineHeight: 1.35,
    padding: "10px 11px",
    width: "100%",
  },
  compactTextarea: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-control)",
    borderRadius: "6px",
    color: "var(--color-text-strong)",
    lineHeight: 1.45,
    minHeight: "62px",
    padding: "10px 11px",
    resize: "vertical",
    width: "100%",
  },
  readOnlyValue: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "6px",
    color: "var(--color-text-default)",
    lineHeight: 1.35,
    minHeight: "40px",
    padding: "10px 11px",
    width: "100%",
  },
  textarea: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-control)",
    borderRadius: "6px",
    color: "var(--color-text-strong)",
    lineHeight: 1.5,
    minHeight: "130px",
    padding: "11px",
    resize: "vertical",
    width: "100%",
  },
  compactModalTextarea: {
    minHeight: "84px",
  },
  observationsTextarea: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-control)",
    borderRadius: "6px",
    color: "var(--color-text-strong)",
    height: "130px",
    lineHeight: 1.5,
    padding: "11px",
    resize: "vertical",
    width: "100%",
  },
  assistantPanel: {
    background: "linear-gradient(180deg, var(--color-surface-panel) 0%, var(--color-surface-subtle) 100%)",
    border: "1px solid var(--color-brand-200)",
  },
  assistantHeader: {
    marginBottom: "16px",
  },
  assistantTitle: {
    fontSize: "19px",
  },
  assistantTextarea: {
    fontSize: "14px",
    lineHeight: 1.6,
    minHeight: "170px",
  },
  sectionHeader: {
    alignItems: "flex-start",
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "14px",
  },
  addedHeader: {
    alignItems: "flex-start",
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "14px",
  },
  addedSummary: {
    background: "var(--color-brand-50)",
    border: "1px solid var(--color-brand-200)",
    borderRadius: "8px",
    color: "var(--color-brand-600)",
    display: "grid",
    gap: "3px",
    minWidth: "160px",
    padding: "10px 12px",
    textAlign: "right",
  },
  helpText: {
    color: "var(--color-text-muted)",
    margin: "-6px 0 0",
    fontSize: "14px",
    lineHeight: 1.45,
  },
  catalogActions: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "flex-end",
  },
  catalogHeader: {
    alignItems: "center",
    marginBottom: "12px",
  },
  searchInput: {
    border: "1px solid var(--color-border-control)",
    borderRadius: "6px",
    minWidth: "min(100%, 260px)",
    padding: "10px 11px",
  },
  valuationGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
    gap: "10px",
  },
  valuationCard: {
    border: "1px solid var(--color-border-default)",
    borderRadius: "8px",
    display: "flex",
    flexDirection: "column",
    gap: "9px",
    height: "100%",
    minHeight: "168px",
    padding: "12px",
  },
  valuationFooter: {
    alignItems: "center",
    display: "flex",
    gap: "10px",
    justifyContent: "space-between",
  },
  miniLabel: {
    color: "var(--color-text-muted)",
    display: "block",
    fontSize: "12px",
  },
  itemMeta: {
    color: "var(--color-text-muted)",
    display: "block",
    fontSize: "12px",
    marginTop: "3px",
  },
  catalogPagination: {
    display: "flex",
    justifyContent: "center",
    marginTop: "12px",
  },
  statusBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 800,
    padding: "4px 9px",
    whiteSpace: "nowrap",
  },
  tableWrapper: {
    overflowX: "auto",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
  },
  th: {
    background: "var(--color-surface-subtle)",
    borderBottom: "1px solid var(--color-border-default)",
    color: "var(--color-text-muted)",
    fontSize: "12px",
    padding: "10px",
    textAlign: "left",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  td: {
    borderBottom: "1px solid var(--color-border-subtle)",
    fontSize: "14px",
    padding: "10px",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  highlightedRow: {
    background: "var(--color-brand-50)",
    outline: "2px solid var(--color-brand-200)",
    transition: "background 0.2s ease",
  },
  numberInput: {
    border: "1px solid var(--color-border-control)",
    borderRadius: "6px",
    padding: "8px",
    width: "92px",
  },
  moneyInput: {
    border: "1px solid var(--color-border-control)",
    borderRadius: "6px",
    padding: "8px",
    width: "130px",
  },
  discountRow: {
    alignItems: "center",
    borderBottom: "1px solid var(--color-border-subtle)",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    padding: "11px 0",
  },
  discountInput: {
    border: "1px solid var(--color-border-control)",
    borderRadius: "6px",
    padding: "8px",
    textAlign: "right",
    width: "150px",
  },
  totalRow: {
    alignItems: "center",
    borderBottom: "1px solid var(--color-border-subtle)",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    padding: "11px 0",
  },
  totalLabel: {
    color: "var(--color-text-default)",
    fontWeight: 700,
  },
  totalLabelStrong: {
    color: "var(--color-text-strong)",
    fontSize: "18px",
    fontWeight: 800,
  },
  totalValue: {
    color: "var(--color-text-strong)",
  },
  totalValueStrong: {
    color: "var(--color-brand-600)",
    fontSize: "22px",
  },
  observationsPanel: {
    display: "grid",
    gap: "8px",
  },
  totalsPanel: {
    alignSelf: "start",
    background: "var(--color-surface-panel)",
  },
  totalsHeader: {
    alignItems: "flex-start",
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "12px",
  },
  quoteStatusBadge: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-control)",
    borderRadius: "999px",
    color: "var(--color-text-default)",
    fontSize: "12px",
    fontWeight: 800,
    padding: "6px 10px",
    whiteSpace: "nowrap",
  },
  totalsBox: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "8px",
    padding: "2px 12px",
  },
  actions: {
    display: "grid",
    gap: "9px",
    marginTop: "16px",
  },
  actionHint: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "8px",
    color: "var(--color-text-muted)",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: 0,
    padding: "10px 12px",
  },
  assistantActions: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    marginTop: "12px",
  },
  dictationRow: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    justifyContent: "space-between",
    marginTop: "12px",
  },
  dictationControls: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },
  assistantNote: {
    color: "var(--color-text-muted)",
    fontSize: "13px",
    lineHeight: 1.45,
  },
  modeBadge: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-control)",
    borderRadius: "999px",
    color: "var(--color-text-default)",
    fontSize: "12px",
    fontWeight: 800,
    padding: "6px 10px",
    whiteSpace: "nowrap",
  },
  suggestionToolbar: {
    alignItems: "center",
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "8px",
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    marginTop: "14px",
    padding: "12px",
  },
  suggestionGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
    marginTop: "14px",
  },
  suggestionCard: {
    border: "1px solid var(--color-border-default)",
    borderRadius: "8px",
    display: "grid",
    gap: "10px",
    padding: "14px",
  },
  suggestionReason: {
    color: "var(--color-text-default)",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: 0,
  },
  keywordList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  keywordBadge: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "999px",
    color: "var(--color-text-default)",
    fontSize: "11px",
    fontWeight: 700,
    padding: "4px 8px",
    width: "fit-content",
  },
  matchBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 800,
    padding: "5px 9px",
    width: "fit-content",
  },
  matchBadgeFound: {
    background: "var(--color-success-50)",
    color: "var(--color-success-700)",
  },
  matchBadgeMissing: {
    background: "var(--color-surface-subtle)",
    color: "var(--color-text-default)",
  },
  quoteBadge: {
    background: "var(--color-info-50)",
    borderRadius: "999px",
    color: "var(--color-info-700)",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 800,
    padding: "5px 9px",
    width: "fit-content",
  },
  primaryButton: {
    background: "var(--color-brand-600)",
    border: 0,
    borderRadius: "6px",
    color: "var(--color-text-inverse)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "11px 14px",
  },
  emitButton: {
    background: "var(--color-text-strong)",
    border: 0,
    borderRadius: "6px",
    color: "var(--color-text-inverse)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "11px 14px",
  },
  emailButton: {
    background: "var(--color-brand-600)",
    border: 0,
    borderRadius: "6px",
    color: "var(--color-text-inverse)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "11px 14px",
  },
  disabledButton: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-control)",
    color: "var(--color-text-muted)",
    cursor: "not-allowed",
  },
  secondaryButton: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-brand-600)",
    borderRadius: "6px",
    color: "var(--color-brand-600)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "9px 11px",
  },
  secondaryLinkButton: {
    alignItems: "center",
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-brand-600)",
    borderRadius: "6px",
    color: "var(--color-brand-600)",
    display: "inline-flex",
    fontWeight: 800,
    justifyContent: "center",
    lineHeight: 1.2,
    marginTop: "12px",
    padding: "9px 11px",
    textDecoration: "none",
    width: "fit-content",
  },
  compactItemButton: {
    marginTop: "auto",
    minHeight: "34px",
    padding: "8px 10px",
  },
  restoreDefaultButton: {
    background: "none",
    border: 0,
    color: "var(--color-brand-600)",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 800,
    justifySelf: "start",
    padding: 0,
    whiteSpace: "nowrap",
  },
  dictationButton: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-brand-600)",
    borderRadius: "6px",
    color: "var(--color-brand-600)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "9px 12px",
  },
  dictationButtonActive: {
    background: "var(--color-danger-50)",
    border: "1px solid var(--color-danger-600)",
    color: "var(--color-danger-700)",
  },
  micIcon: {
    background: "var(--color-brand-600)",
    borderRadius: "999px",
    display: "inline-block",
    height: "14px",
    width: "10px",
  },
  micIconActive: {
    background: "var(--color-danger-700)",
  },
  dictationStatusBadge: {
    alignItems: "center",
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-control)",
    borderRadius: "999px",
    color: "var(--color-text-default)",
    display: "inline-flex",
    fontSize: "12px",
    fontWeight: 800,
    gap: "7px",
    padding: "7px 10px",
  },
  dictationStatusActive: {
    background: "var(--color-brand-50)",
    border: "1px solid var(--color-brand-200)",
    color: "var(--color-brand-600)",
  },
  dictationStatusWarning: {
    background: "var(--color-warning-50)",
    border: "1px solid var(--color-warning-200)",
    color: "var(--color-warning-800)",
  },
  statusDot: {
    background: "var(--color-text-muted)",
    borderRadius: "999px",
    display: "inline-block",
    height: "8px",
    width: "8px",
  },
  statusDotActive: {
    background: "var(--color-brand-600)",
  },
  statusDotWarning: {
    background: "var(--color-warning-800)",
  },
  clearButton: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-control)",
    borderRadius: "6px",
    color: "var(--color-text-default)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "11px 14px",
  },
  removeButton: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-danger-200)",
    borderRadius: "6px",
    color: "var(--color-danger-700)",
    cursor: "pointer",
    fontWeight: 800,
    padding: "8px 10px",
  },
  printButton: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-control)",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 12px",
  },
  previewPanel: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "8px",
    boxShadow: "var(--shadow-sm)",
    padding: "20px",
  },
  previewActions: {
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "12px",
  },
  modalOverlay: {
    alignItems: "flex-start",
    background: "rgba(15, 23, 42, 0.45)",
    bottom: 0,
    display: "flex",
    justifyContent: "center",
    left: 0,
    overflowY: "auto",
    padding: "28px 16px",
    position: "fixed",
    right: 0,
    top: 0,
    zIndex: 40,
  },
  modalPanel: {
    background: "var(--color-surface-panel)",
    borderRadius: "8px",
    boxShadow: "var(--shadow-lg)",
    display: "grid",
    gap: "14px",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    maxHeight: "85vh",
    maxWidth: "860px",
    overflow: "hidden",
    padding: "18px",
    width: "100%",
  },
  modalHeader: {
    alignItems: "flex-start",
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
  },
  modalBody: {
    display: "grid",
    gap: "10px",
    minHeight: 0,
    overflowY: "auto",
    paddingRight: "4px",
  },
  modalSection: {
    display: "grid",
    gap: "10px",
  },
  modalSectionTitle: {
    color: "var(--color-text-default)",
    fontSize: "13px",
    fontWeight: 900,
    margin: "0 0 -2px",
  },
  modalThreeColumnGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))",
  },
  modalTextGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
  },
  modalActions: {
    background: "var(--color-surface-panel)",
    borderTop: "1px solid var(--color-border-default)",
    bottom: 0,
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "flex-end",
    margin: "0 -18px -18px",
    padding: "12px 18px",
    position: "sticky",
  },
  priceTraceBox: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "6px",
    color: "var(--color-text-default)",
    fontSize: "13px",
    lineHeight: 1.45,
    padding: "10px 11px",
  },
  printSheet: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-default)",
    color: "var(--color-text-strong)",
    padding: "28px",
  },
  printHeader: {
    alignItems: "flex-start",
    borderBottom: "2px solid var(--color-text-strong)",
    display: "flex",
    justifyContent: "space-between",
    gap: "20px",
    paddingBottom: "16px",
  },
  printBrand: {
    margin: 0,
    fontSize: "26px",
  },
  printMuted: {
    color: "var(--color-text-muted)",
    margin: "4px 0 0",
  },
  printMeta: {
    display: "grid",
    gap: "4px",
    textAlign: "right",
  },
  clientBox: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "8px",
    margin: "18px 0",
    padding: "14px",
  },
  printSectionTitle: {
    fontSize: "15px",
    margin: "0 0 8px",
  },
  printLine: {
    margin: "3px 0",
  },
  printTable: {
    borderCollapse: "collapse",
    width: "100%",
  },
  printTh: {
    background: "var(--color-text-strong)",
    color: "var(--color-text-inverse)",
    fontSize: "12px",
    padding: "10px",
    textAlign: "left",
    textTransform: "uppercase",
  },
  printTd: {
    borderBottom: "1px solid var(--color-border-default)",
    padding: "10px",
    verticalAlign: "top",
  },
  printItemMeta: {
    color: "var(--color-text-muted)",
    display: "block",
    fontSize: "12px",
    marginTop: "3px",
  },
  printTotals: {
    marginLeft: "auto",
    marginTop: "18px",
    maxWidth: "320px",
  },
  observationsBox: {
    borderTop: "1px solid var(--color-border-default)",
    marginTop: "20px",
    paddingTop: "14px",
  },
  emptyState: {
    background: "var(--color-surface-subtle)",
    border: "1px dashed var(--color-border-control)",
    borderRadius: "8px",
    color: "var(--color-text-default)",
    padding: "26px",
    textAlign: "center",
  },
  emptyTitle: {
    color: "var(--color-text-strong)",
    fontSize: "16px",
    margin: "0 0 6px",
  },
  emptyText: {
    color: "var(--color-text-muted)",
    lineHeight: 1.45,
    margin: 0,
  },
  infoText: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "8px",
    color: "var(--color-text-default)",
    margin: "12px 0 0",
    padding: "11px 13px",
  },
  errorText: {
    background: "var(--color-danger-50)",
    border: "1px solid var(--color-danger-200)",
    borderRadius: "8px",
    color: "var(--color-danger-700)",
    margin: 0,
    padding: "11px 13px",
  },
  successText: {
    background: "var(--color-success-50)",
    border: "1px solid var(--color-success-200)",
    borderRadius: "8px",
    color: "var(--color-success-700)",
    margin: 0,
    padding: "11px 13px",
  },
  itemFeedbackText: {
    background: "var(--color-success-50)",
    border: "1px solid var(--color-success-200)",
    borderRadius: "6px",
    color: "var(--color-success-700)",
    fontSize: "13px",
    margin: "0 0 10px",
    padding: "8px 10px",
  },
  warningText: {
    background: "var(--color-warning-50)",
    border: "1px solid var(--color-warning-200)",
    borderRadius: "8px",
    color: "var(--color-warning-800)",
    margin: "12px 0 0",
    padding: "11px 13px",
  },
  lineDescriptionInput: {
    border: "1px solid var(--color-border-control)",
    borderRadius: "5px",
    boxSizing: "border-box",
    font: "inherit",
    minWidth: "220px",
    padding: "8px",
    resize: "vertical",
    width: "100%",
  },
  unitInput: {
    border: "1px solid var(--color-border-control)",
    borderRadius: "5px",
    maxWidth: "90px",
    padding: "8px",
  },
  discountPercentInput: {
    border: "1px solid var(--color-border-control)",
    borderRadius: "5px",
    maxWidth: "76px",
    padding: "8px",
    textAlign: "right",
  },
  orderButton: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-control)",
    borderRadius: "5px",
    color: "var(--color-text-default)",
    cursor: "pointer",
    marginRight: "4px",
    minHeight: "32px",
    minWidth: "32px",
  },
  pdfButton: {
    background: "var(--color-document-navy)",
    border: "1px solid var(--color-document-navy)",
    borderRadius: "6px",
    color: "var(--color-text-inverse)",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 13px",
  },
  compactEmptyState: {
    background: "var(--color-surface-subtle)",
    border: "1px dashed var(--color-border-control)",
    borderRadius: "7px",
    color: "var(--color-text-muted)",
    marginTop: "12px",
    padding: "16px",
  },
  scopeList: {
    display: "grid",
    gap: "12px",
    marginTop: "14px",
  },
  scopeCard: {
    background: "var(--color-surface-subtle)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "7px",
    display: "grid",
    gap: "10px",
    padding: "14px",
  },
  scopeHeader: {
    alignItems: "center",
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "minmax(0, 1fr) auto",
  },
  scopeActions: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
  },
  conditionsGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    marginTop: "14px",
  },
  plazoRangeRow: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "8px",
  },
  acceptanceToggle: {
    alignItems: "center",
    color: "var(--color-text-default)",
    display: "flex",
    fontWeight: 700,
    gap: "9px",
    margin: "16px 0 10px",
  },
  totalErrorText: {
    color: "var(--color-danger-700)",
    fontSize: "12px",
    margin: "8px 0 0",
  },
};

export default NewQuotePage;
