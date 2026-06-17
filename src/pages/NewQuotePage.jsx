import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateQuoteTotals,
  createQuoteItemFromValuation,
  normalizeQuoteItems,
} from "../domain/quoteItemFactory";
import { PRICING_STATUS } from "../domain/pricing";
import QuotePrintView from "../features/quotes/QuotePrintView";
import SendQuoteEmailModal from "../features/quotes/SendQuoteEmailModal";
import { suggestQuoteItems } from "../services/aiQuoteService";
import { getCompanyProfile } from "../services/companyService";
import { createInventoryItem } from "../services/inventoryService";
import {
  createQuote,
  getQuoteDisplayNumber,
  updateQuote,
} from "../services/quoteService";
import { subscribeToValuations } from "../services/valuationService";
import { formatCLP, formatDate } from "../utils/formatters";

const ASSISTANT_DESCRIPTION_MAX_LENGTH = 1200;

const estadoLabels = {
  borrador: "Borrador",
  emitida: "Emitida",
};

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

const confidenceLabels = {
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

function getAssistantModeFromQuery() {
  if (typeof window === "undefined") return "auto";
  const mode = new URLSearchParams(window.location.search).get("assistantMode");
  return ["local", "gemini"].includes(mode) ? mode : "auto";
}

function normalizeMatchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getSuggestionTokens(suggestion) {
  const fromKeywords = Array.isArray(suggestion?.palabrasClave)
    ? suggestion.palabrasClave.join(" ")
    : "";
  return [
    ...new Set(
      normalizeMatchText(`${suggestion?.nombre || ""} ${fromKeywords}`)
        .split(" ")
        .filter((token) => token.length >= 3)
    ),
  ];
}

function getValuationTokens(valuation) {
  return normalizeMatchText(
    `${valuation?.nombre || ""} ${valuation?.categoria || ""} ${
      valuation?.tipoItem || ""
    }`
  ).split(" ");
}

function findSimilarValuations(suggestion, valuations) {
  const suggestionTokens = getSuggestionTokens(suggestion);
  if (!suggestionTokens.length) return [];

  return (Array.isArray(valuations) ? valuations : [])
    .map((valuation) => {
      const valuationTokens = new Set(getValuationTokens(valuation));
      const shared = suggestionTokens.filter((token) =>
        valuationTokens.has(token)
      ).length;
      const sameType = valuation.tipoItem === suggestion.tipoItem ? 2 : 0;
      return {
        valuation,
        score: shared + sameType,
      };
    })
    .filter(({ valuation, score }) => score > 0 && Number(valuation.precioSugerido || valuation.precioInterno) > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ valuation }) => valuation);
}

function average(numbers) {
  const values = numbers.filter((number) => Number.isFinite(number) && number > 0);
  if (!values.length) return 0;
  return values.reduce((sum, number) => sum + number, 0) / values.length;
}

function estimateSuggestedItemPricing(suggestion, valuations, description) {
  const similar = findSimilarValuations(suggestion, valuations);
  const tipoItem = ["producto", "servicio", "actividad"].includes(suggestion?.tipoItem)
    ? suggestion.tipoItem
    : "actividad";
  const margenSugerido =
    Math.round(
      average(similar.map((item) => Number(item.margenDeseado || 0)))
    ) || DEFAULT_MARGIN_BY_TYPE[tipoItem];

  if (!similar.length) {
    return {
      costoBaseSugerido: "",
      precioSugerido: "",
      margenSugerido,
      justificacionPrecio:
        "No hay datos suficientes para sugerir precio. Ingrese valor manualmente.",
      confianzaPrecio: "baja",
    };
  }

  const basePrice = average(
    similar.map((item) => Number(item.precioSugerido || item.precioInterno || 0))
  );
  const complexityText = normalizeMatchText(description);
  const complexityFactor =
    complexityText.length > 280 ||
    ["urgente", "terreno", "integracion", "integración", "complejo"].some((token) =>
      complexityText.includes(normalizeMatchText(token))
    )
      ? 1.12
      : 1;
  const precioSugerido = Math.round(basePrice * complexityFactor);
  const costoBaseSugerido = Math.round(
    precioSugerido / (1 + margenSugerido / 100)
  );

  return {
    costoBaseSugerido,
    precioSugerido,
    margenSugerido,
    justificacionPrecio: `Estimación local basada en ${similar.length} ítem${
      similar.length === 1 ? "" : "s"
    } similar${similar.length === 1 ? "" : "es"} del inventario y complejidad del requerimiento.`,
    confianzaPrecio: similar.length >= 3 ? "alta" : "media",
  };
}

const statusStyles = {
  [PRICING_STATUS.SIN_REFERENCIAS]: {
    background: "#f1f5f9",
    color: "#475569",
  },
  [PRICING_STATUS.BAJO_MERCADO]: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },
  [PRICING_STATUS.DENTRO_DE_RANGO]: {
    background: "#dcfce7",
    color: "#166534",
  },
  [PRICING_STATUS.SOBRE_MERCADO]: {
    background: "#fee2e2",
    color: "#991b1b",
  },
};

function buildInitialQuote() {
  return {
    numero: "",
    fecha: "",
    clienteNombre: "",
    clienteRut: "",
    clienteEmail: "",
    clienteTelefono: "",
    clienteDireccion: "",
    condicionesPago: "",
    estado: "borrador",
    items: [],
    descuento: 0,
    observaciones: "",
  };
}

function NewQuotePage({ userId }) {
  const addedItemsRef = useRef(null);
  const assistantDescriptionRef = useRef("");
  const dictationBaseTextRef = useRef("");
  const dictationFinalTextRef = useRef("");
  const dictationInterimTextRef = useRef("");
  const highlightTimeoutRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const assistantRequestMode = useMemo(() => getAssistantModeFromQuery(), []);
  const [quote, setQuote] = useState(() => buildInitialQuote());
  const [valuations, setValuations] = useState([]);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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
  const [suggestedItemSaving, setSuggestedItemSaving] = useState(false);
  const [suggestedItemError, setSuggestedItemError] = useState("");
  const [highlightedItemId, setHighlightedItemId] = useState("");
  const [manualCatalogOpen, setManualCatalogOpen] = useState(true);
  const [emailModalOpen, setEmailModalOpen] = useState(false);

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
        setQuote((prev) => ({
          ...prev,
          condicionesPago:
            prev.condicionesPago || profile.condicionesPago || "",
        }));
      })
      .catch((err) => {
        console.error("Error al cargar perfil de empresa:", err);
      });

    return () => unsubscribe();
  }, [userId]);

  useEffect(
    () => () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
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

  const normalizedItems = useMemo(
    () => normalizeQuoteItems(quote.items),
    [quote.items]
  );

  const totals = useMemo(
    () => calculateQuoteTotals(normalizedItems, quote.descuento),
    [normalizedItems, quote.descuento]
  );

  const currentSavedQuote = useMemo(
    () => ({
      id: savedQuoteId,
      ...quote,
      empresa: companyProfile || {},
      items: normalizedItems,
      subtotal: totals.subtotal,
      descuento: totals.descuento,
      total: totals.total,
    }),
    [companyProfile, normalizedItems, quote, savedQuoteId, totals]
  );

  const itemQuantityById = useMemo(() => {
    const quantities = {};
    normalizedItems.forEach((item) => {
      quantities[item.itemId] = Number(item.cantidad || 0);
    });
    return quantities;
  }, [normalizedItems]);

  const filteredValuations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return valuations;

    return valuations.filter((valuation) => {
      const text = `${valuation.nombre || ""} ${valuation.categoria || ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [search, valuations]);

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

  useEffect(() => {
    if (assistantSuggestions.length > 0) {
      setManualCatalogOpen(false);
    } else {
      setManualCatalogOpen(true);
    }
  }, [assistantSuggestions]);

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
    setQuote((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const showAddFeedback = (itemId, wasExisting) => {
    setSuccess(
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
    setAssistantError("");
    setAssistantSuggestions([]);
    setAssistantSource("");
    setAssistantWarning("");
    setAssistantModeUsed("");
    setAssistantModel("");
    console.info(
      `ValoraCloud assistant mode: ${
        assistantModeLabels[assistantRequestMode] || "automático"
      }`
    );

    try {
      setAssistantLoading(true);
      const result = await suggestQuoteItems({
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
      if (suggestions.length === 0) {
        setAssistantError("No se generaron sugerencias para esta descripción.");
      }
    } catch (err) {
      console.error("Error al sugerir ítems de cotización:", err);
      setAssistantError(
        err.message || "No se pudieron generar sugerencias en este momento."
      );
    } finally {
      setAssistantLoading(false);
    }
  };

  const addSuggestionToQuote = (suggestion) => {
    const matchedValuation = getMatchedValuation(suggestion);
    if (!matchedValuation) return;
    addItem(matchedValuation, Number(suggestion.cantidadSugerida) || 1);
  };

  const openSuggestedItemDraft = (suggestion) => {
    const pricing = estimateSuggestedItemPricing(
      suggestion,
      valuations,
      assistantDescription
    );
    const tipoItem = ["producto", "servicio", "actividad"].includes(
      suggestion.tipoItem
    )
      ? suggestion.tipoItem
      : "actividad";

    setSuggestedItemError("");
    setSuggestedItemDraft({
      nombre: suggestion.nombre || "",
      tipoItem,
      categoria: "",
      descripcion: suggestion.motivo || "",
      unidad: DEFAULT_UNIT_BY_TYPE[tipoItem],
      cantidadSugerida: Math.max(Number(suggestion.cantidadSugerida) || 1, 1),
      costoBase: pricing.costoBaseSugerido,
      precioInterno: pricing.precioSugerido,
      margenDeseado: pricing.margenSugerido,
      justificacionSugerencia: suggestion.motivo || "",
      justificacionPrecio: pricing.justificacionPrecio,
      confianzaPrecio: pricing.confianzaPrecio,
    });
  };

  const updateSuggestedItemDraft = (field, value) => {
    setSuggestedItemDraft((prev) =>
      prev
        ? {
            ...prev,
            [field]: value,
          }
        : prev
    );
  };

  const createSuggestedItem = async () => {
    if (!suggestedItemDraft) return;

    const nombre = String(suggestedItemDraft.nombre || "").trim();
    const tipoItem = String(suggestedItemDraft.tipoItem || "").trim();
    const precioInterno = Number(suggestedItemDraft.precioInterno);
    const margenDeseado =
      Number(suggestedItemDraft.margenDeseado) ||
      DEFAULT_MARGIN_BY_TYPE[tipoItem] ||
      30;
    const costoBase =
      Number(suggestedItemDraft.costoBase) ||
      Math.round(precioInterno / (1 + margenDeseado / 100));

    if (!nombre) {
      setSuggestedItemError("Ingresa el nombre del ítem sugerido.");
      return;
    }
    if (!["producto", "servicio", "actividad"].includes(tipoItem)) {
      setSuggestedItemError("Selecciona un tipo de ítem válido.");
      return;
    }
    if (!Number.isFinite(precioInterno) || precioInterno <= 0) {
      setSuggestedItemError("Ingresa un precio interno mayor a cero.");
      return;
    }
    if (!Number.isFinite(costoBase) || costoBase <= 0) {
      setSuggestedItemError("Ingresa un costo base mayor a cero.");
      return;
    }

    setSuggestedItemSaving(true);
    setSuggestedItemError("");
    setError("");

    try {
      const payload = {
        nombre,
        tipoItem,
        categoria: suggestedItemDraft.categoria,
        descripcion: suggestedItemDraft.descripcion,
        unidad: suggestedItemDraft.unidad || DEFAULT_UNIT_BY_TYPE[tipoItem],
        costoBase,
        precioInterno,
        margenDeseado,
        estado: "activo",
        origen: "sugerencia_ia",
        creadoDesdeCotizacion: true,
        justificacionSugerencia: suggestedItemDraft.justificacionSugerencia,
        justificacionPrecio: suggestedItemDraft.justificacionPrecio,
        confianzaPrecio: suggestedItemDraft.confianzaPrecio,
      };
      const createdRef = await createInventoryItem(userId, payload);
      const createdItem = {
        id: createdRef.id,
        ...payload,
      };
      const createdValuation = {
        itemId: createdRef.id,
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
      setSuggestedItemDraft(null);
      addItem(createdValuation, suggestedItemDraft.cantidadSugerida);
      setSuccess("Ítem sugerido creado en inventario y agregado a la cotización.");
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

    setSuccess(
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
    setQuote((prev) => ({
      ...prev,
      items: normalizeQuoteItems(
        prev.items.map((item) =>
          item.itemId === itemId ? { ...item, [field]: value } : item
        )
      ),
    }));
  };

  const removeItem = (itemId) => {
    setQuote((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.itemId !== itemId),
    }));
  };

  const clearQuote = () => {
    setQuote(buildInitialQuote());
    setSavedQuoteId(null);
    setError("");
    setSuccess("");
    setHighlightedItemId("");
  };

  const validateQuote = () => {
    if (!quote.clienteNombre.trim()) {
      return "Ingresa el nombre del cliente antes de guardar.";
    }
    if (normalizedItems.length === 0) {
      return "Agrega al menos un ítem valorizado a la cotización.";
    }
    return "";
  };

  const saveQuote = async (estado) => {
    const validationError = validateQuote();
    if (validationError) {
      setError(validationError);
      setSuccess("");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...quote,
        estado,
        empresa: companyProfile || {},
        items: normalizedItems,
        subtotal: totals.subtotal,
        descuento: totals.descuento,
        total: totals.total,
      };
      const saved = savedQuoteId
        ? await updateQuote(userId, savedQuoteId, payload)
        : await createQuote(userId, payload);
      if (!savedQuoteId) {
        setSavedQuoteId(saved.id);
      }
      setQuote((prev) => ({
        ...prev,
        numero: saved.numero,
        fecha: saved.fecha,
        estado,
      }));
      setSuccess(
        `Cotización ${getQuoteDisplayNumber(saved)} guardada como ${estadoLabels[
          estado
        ].toLowerCase()}.`
      );
    } catch (err) {
      console.error("Error al guardar cotización:", err);
      setError(err.message || "No se pudo guardar la cotización.");
    } finally {
      setSaving(false);
    }
  };

  const handleEmailSent = (emailPatch, result) => {
    setQuote((prev) => ({
      ...prev,
      ...emailPatch,
    }));

    if (result?.success) {
      setSuccess("Cotizacion enviada correctamente al correo del cliente.");
    } else {
      setError(
        result?.error ||
          "No se pudo enviar automaticamente. Puedes usar el respaldo manual."
      );
    }
  };

  if (!userId) {
    return (
      <section className="page-section">
        <p style={styles.errorText}>Debes iniciar sesión para crear cotizaciones.</p>
      </section>
    );
  }

  const defaultPaymentTerms = String(companyProfile?.condicionesPago || "");
  const showRestorePaymentTerms =
    Boolean(defaultPaymentTerms) && quote.condicionesPago !== defaultPaymentTerms;

  return (
    <section className="quote-page" style={styles.wrapper}>
      <style>{quotePageCss}</style>
      <div className="no-print" style={styles.header}>
        <div>
          <span className="eyebrow">Cotizaciones</span>
          <h2 style={styles.title}>Nueva cotización formal</h2>
          <p style={styles.subtitle}>
            Arma una cotización editable desde ítems valorizados, ajusta precios
            y genera un documento formal.
          </p>
        </div>
      </div>

      <div className="no-print" style={styles.grid}>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Datos de la cotización</h3>
          <div className="quote-data-grid" style={styles.quoteDataGrid}>
            <Field label="Fecha">
              <div style={styles.readOnlyValue}>
                {quote.fecha ? formatDate(quote.fecha) : "Se asigna al guardar"}
              </div>
            </Field>
            <Field label="Número">
              <div style={styles.readOnlyValue}>
                {getQuoteDisplayNumber(quote)}
              </div>
            </Field>
            <Field label="Estado">
              <select
                value={quote.estado}
                onChange={(event) => updateField("estado", event.target.value)}
                style={styles.input}
              >
                <option value="borrador">Borrador</option>
                <option value="emitida">Emitida</option>
              </select>
            </Field>
            <div style={{ ...styles.field, ...styles.wideField }}>
              <div className="quote-payment-header" style={styles.fieldHeader}>
                <span style={styles.labelRow}>
                  <label htmlFor="quote-payment-terms" style={styles.label}>
                    Condiciones de pago
                  </label>
                  <span style={styles.fieldBadge}>Esta cotización</span>
                </span>
                {showRestorePaymentTerms && (
                  <button
                    type="button"
                    onClick={() =>
                      updateField("condicionesPago", defaultPaymentTerms)
                    }
                    style={styles.restoreDefaultButton}
                  >
                    Usar valor predeterminado
                  </button>
                )}
              </div>
              <textarea
                id="quote-payment-terms"
                value={quote.condicionesPago}
                onChange={(event) =>
                  updateField("condicionesPago", event.target.value)
                }
                rows={2}
                style={styles.compactTextarea}
              />
              <span style={styles.fieldHelpText}>
                Puedes modificarlas sin cambiar la configuración de Empresa.
              </span>
            </div>
          </div>
        </div>

        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Datos del cliente</h3>
          <div style={styles.formGrid}>
            <Field label="Nombre cliente">
              <input
                type="text"
                value={quote.clienteNombre}
                onChange={(event) =>
                  updateField("clienteNombre", event.target.value)
                }
                placeholder="Ej: Maria Gonzalez"
                style={styles.input}
              />
            </Field>
            <Field label="RUT/DNI opcional">
              <input
                type="text"
                value={quote.clienteRut}
                onChange={(event) => updateField("clienteRut", event.target.value)}
                style={styles.input}
              />
            </Field>
            <Field label="Email opcional">
              <input
                type="email"
                value={quote.clienteEmail}
                onChange={(event) =>
                  updateField("clienteEmail", event.target.value)
                }
                style={styles.input}
              />
            </Field>
            <Field label="Teléfono opcional">
              <input
                type="text"
                value={quote.clienteTelefono}
                onChange={(event) =>
                  updateField("clienteTelefono", event.target.value)
                }
                style={styles.input}
              />
            </Field>
            <Field label="Dirección opcional" wide>
              <input
                type="text"
                value={quote.clienteDireccion}
                onChange={(event) =>
                  updateField("clienteDireccion", event.target.value)
                }
                style={styles.input}
              />
            </Field>
          </div>
        </div>
      </div>

      {error && <p className="no-print" style={styles.errorText}>{error}</p>}
      {success && <p className="no-print" style={styles.successText}>{success}</p>}

      <div className="no-print" style={{ ...styles.panel, ...styles.assistantPanel }}>
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
          <span style={styles.modeBadge}>
            Modo: {assistantModeLabels[assistantRequestMode] || "automático"}
          </span>
        </div>

        <textarea
          value={assistantDescription}
          onChange={handleAssistantDescriptionChange}
          rows={4}
          maxLength={ASSISTANT_DESCRIPTION_MAX_LENGTH}
          placeholder="Ej: Necesito cotizar instalación de 4 cámaras en terreno de 40 x 40 metros"
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
            Puedes escribir o dictar el requerimiento antes de sugerir ítems.
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
            disabled={assistantLoading}
            style={styles.primaryButton}
          >
            {assistantLoading ? "Sugiriendo..." : "Sugerir ítems"}
          </button>
          <span style={styles.assistantNote}>
            No calcula precios ni crea cotizaciones automáticamente.
          </span>
        </div>

        {assistantError && <p style={styles.errorText}>{assistantError}</p>}
        {assistantSource && (
          <p style={styles.infoText}>
            {assistantSource === "gemini"
              ? `Sugerencias generadas con IA generativa${
                  assistantModel ? ` (${assistantModel})` : ""
                }. Modo usado: ${
                  assistantModeLabels[assistantModeUsed] || "automático"
                }.`
              : `Modo asistente local activo. Modo usado: ${
                  assistantModeLabels[assistantModeUsed] || "automático"
                }. Las sugerencias fueron generadas con reglas e inventario del sistema.`}
          </p>
        )}
        {assistantWarning && (
          <p style={styles.warningText}>{assistantWarning}</p>
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

      <div className="no-print" style={styles.panel} ref={addedItemsRef}>
        <div style={styles.addedHeader}>
          <div>
            <h3 style={styles.panelTitle}>Ítems agregados</h3>
            <p style={styles.helpText}>
              Resumen editable de la cotización actual.
            </p>
          </div>
          <div style={styles.addedSummary}>
            <span>{normalizedItems.length} ítem(s)</span>
            <strong>{formatCLP(totals.total)}</strong>
          </div>
        </div>
        {normalizedItems.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>Todavía no hay ítems en la cotización</h3>
            <p style={styles.emptyText}>
              Agrega productos o servicios desde el asistente o el catálogo manual.
            </p>
          </div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Nombre</th>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>Cantidad</th>
                  <th style={styles.th}>Precio sugerido</th>
                  <th style={styles.th}>Precio unitario</th>
                  <th style={styles.th}>Total línea</th>
                  <th style={styles.th}>Quitar</th>
                </tr>
              </thead>
              <tbody>
                {normalizedItems.map((item) => (
                  <tr
                    key={item.itemId}
                    style={
                      highlightedItemId === item.itemId
                        ? styles.highlightedRow
                        : undefined
                    }
                  >
                    <td style={styles.td}>
                      <strong>{item.nombre}</strong>
                      <span style={styles.itemMeta}>{item.unidad || "-"}</span>
                    </td>
                    <td style={styles.td}>
                      {tipoLabels[item.tipoItem] || item.tipoItem || "-"}
                    </td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.cantidad}
                        onChange={(event) =>
                          updateItem(item.itemId, "cantidad", event.target.value)
                        }
                        style={styles.numberInput}
                      />
                    </td>
                    <td style={styles.td}>{formatCLP(item.precioSugerido)}</td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        min="0"
                        value={item.precioUnitarioEditable}
                        onChange={(event) =>
                          updateItem(
                            item.itemId,
                            "precioUnitarioEditable",
                            event.target.value
                          )
                        }
                        style={styles.moneyInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <strong>{formatCLP(item.totalLinea)}</strong>
                    </td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        onClick={() => removeItem(item.itemId)}
                        style={styles.removeButton}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="no-print" style={styles.panel}>
        <div style={styles.sectionHeader}>
          <div>
            <h3 style={styles.panelTitle}>Catálogo manual de ítems valorizados</h3>
            <p style={styles.helpText}>
              Solo se muestran ítems activos del inventario. El precio inicial
              corresponde al precio sugerido.
            </p>
          </div>
          <div style={styles.catalogActions}>
            {assistantSuggestions.length > 0 && (
              <button
                type="button"
                onClick={() => setManualCatalogOpen((current) => !current)}
                style={styles.secondaryButton}
              >
                {manualCatalogOpen ? "Ocultar catálogo" : "Mostrar catálogo"}
              </button>
            )}
            {manualCatalogOpen && (
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre o categoría"
                style={styles.searchInput}
              />
            )}
          </div>
        </div>

        {manualCatalogOpen ? (
          loading ? (
            <div style={styles.emptyState}>
              <h3 style={styles.emptyTitle}>Cargando inventario valorizado</h3>
              <p style={styles.emptyText}>
                Estamos preparando los ítems activos para agregarlos a la cotización.
              </p>
            </div>
          ) : valuations.length === 0 ? (
            <div style={styles.emptyState}>
              <h3 style={styles.emptyTitle}>No hay inventario activo valorizado</h3>
              <p style={styles.emptyText}>
                Agrega ítems activos al inventario para comenzar una cotización.
              </p>
            </div>
          ) : filteredValuations.length === 0 ? (
            <div style={styles.emptyState}>
              <h3 style={styles.emptyTitle}>No hay resultados para esa búsqueda</h3>
              <p style={styles.emptyText}>
                Ajusta el texto de búsqueda o agrega el ítem desde el asistente.
              </p>
            </div>
          ) : (
            <div style={styles.valuationGrid}>
              {filteredValuations.map((valuation) => {
                const quoteQuantity = itemQuantityById[valuation.itemId] || 0;
                return (
                  <div key={valuation.itemId} style={styles.valuationCard}>
                    <div>
                      <strong>{valuation.nombre}</strong>
                      <span style={styles.itemMeta}>
                        {valuation.categoria || "Sin categoría"} ·{" "}
                        {tipoLabels[valuation.tipoItem] || valuation.tipoItem || "-"}
                      </span>
                    </div>
                    <div style={styles.valuationFooter}>
                      <div>
                        <span style={styles.miniLabel}>Precio sugerido</span>
                        <strong>{formatCLP(valuation.precioSugerido)}</strong>
                      </div>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...statusStyles[valuation.estadoValorizacion],
                        }}
                      >
                        {valuation.estadoValorizacion}
                      </span>
                    </div>
                    {quoteQuantity > 0 && (
                      <span style={styles.quoteBadge}>
                        En cotización: {quoteQuantity}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => addItem(valuation)}
                      style={styles.secondaryButton}
                    >
                      {quoteQuantity > 0 ? "Agregar otra vez" : "Agregar a cotización"}
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>Catálogo oculto temporalmente</h3>
            <p style={styles.emptyText}>
              Se priorizan las sugerencias del asistente. Puedes volver a mostrarlo cuando quieras.
            </p>
          </div>
        )}
      </div>

      <div className="quote-bottom-grid no-print" style={styles.bottomGrid}>
        <div style={{ ...styles.panel, ...styles.observationsPanel }}>
          <h3 style={styles.panelTitle}>Observaciones</h3>
          <p style={styles.helpText}>
            Agrega notas visibles para el cliente en el documento formal.
          </p>
          <textarea
            value={quote.observaciones}
            onChange={(event) => updateField("observaciones", event.target.value)}
            rows={5}
            placeholder="Notas públicas para el cliente"
            style={styles.textarea}
          />
        </div>

        <div style={{ ...styles.panel, ...styles.totalsPanel }}>
          <div style={styles.totalsHeader}>
            <div>
              <h3 style={styles.panelTitle}>Totales</h3>
              <p style={styles.helpText}>Revisa montos antes de guardar o enviar.</p>
            </div>
            <span style={styles.quoteStatusBadge}>
              {estadoLabels[quote.estado] || quote.estado}
            </span>
          </div>
          <div style={styles.totalsBox}>
            <TotalRow label="Subtotal" value={formatCLP(totals.subtotal)} />
            <div style={styles.discountRow}>
              <label style={styles.totalLabel}>Descuento</label>
              <input
                type="number"
                min="0"
                value={quote.descuento}
                onChange={(event) => updateField("descuento", event.target.value)}
                style={styles.discountInput}
              />
            </div>
            <TotalRow label="Total" value={formatCLP(totals.total)} strong />
          </div>

          <div style={styles.actions}>
            <button
              type="button"
              onClick={() => saveQuote("borrador")}
              disabled={saving}
              style={styles.primaryButton}
            >
              {saving ? "Guardando..." : "Guardar borrador"}
            </button>
            <button
              type="button"
              onClick={() => saveQuote("emitida")}
              disabled={saving}
              style={styles.emitButton}
            >
              Guardar como emitida
            </button>
            <button
              type="button"
              onClick={() => setEmailModalOpen(true)}
              disabled={!savedQuoteId || saving}
              style={{
                ...styles.emailButton,
                ...(!savedQuoteId || saving ? styles.disabledButton : {}),
              }}
            >
              Enviar por correo
            </button>
            {!savedQuoteId && (
              <p style={styles.actionHint}>
                Guarda la cotización antes de enviarla al cliente.
              </p>
            )}
            <button type="button" onClick={clearQuote} style={styles.clearButton}>
              Limpiar cotización
            </button>
          </div>
        </div>
      </div>

      {suggestedItemDraft && (
        <div className="no-print" style={styles.modalOverlay}>
          <div style={styles.modalPanel}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.panelTitle}>Crear ítem sugerido</h3>
                <p style={styles.helpText}>
                  Precio sugerido experimental. Debe ser validado por el usuario
                  antes de cotizar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSuggestedItemDraft(null)}
                style={styles.clearButton}
                disabled={suggestedItemSaving}
              >
                Cerrar
              </button>
            </div>

            <div style={styles.warningText}>
              Precio sugerido experimental. Debe ser validado por el usuario
              antes de cotizar.
            </div>

            <div style={styles.formGrid}>
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
              <Field label="Categoría">
                <input
                  type="text"
                  value={suggestedItemDraft.categoria}
                  onChange={(event) =>
                    updateSuggestedItemDraft("categoria", event.target.value)
                  }
                  style={styles.input}
                />
              </Field>
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
              <Field label="Cantidad sugerida">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={suggestedItemDraft.cantidadSugerida}
                  onChange={(event) =>
                    updateSuggestedItemDraft(
                      "cantidadSugerida",
                      event.target.value
                    )
                  }
                  style={styles.input}
                />
              </Field>
              <Field label="Costo base sugerido">
                <input
                  type="number"
                  min="0"
                  value={suggestedItemDraft.costoBase}
                  onChange={(event) =>
                    updateSuggestedItemDraft("costoBase", event.target.value)
                  }
                  placeholder="Ingrese costo base"
                  style={styles.input}
                />
              </Field>
              <Field label="Precio interno sugerido">
                <input
                  type="number"
                  min="0"
                  value={suggestedItemDraft.precioInterno}
                  onChange={(event) =>
                    updateSuggestedItemDraft("precioInterno", event.target.value)
                  }
                  placeholder="Ingrese precio interno"
                  style={styles.input}
                />
              </Field>
              <Field label="Margen deseado sugerido">
                <input
                  type="number"
                  min="0"
                  value={suggestedItemDraft.margenDeseado}
                  onChange={(event) =>
                    updateSuggestedItemDraft("margenDeseado", event.target.value)
                  }
                  style={styles.input}
                />
              </Field>
              <Field label="Nivel de confianza">
                <select
                  value={suggestedItemDraft.confianzaPrecio}
                  onChange={(event) =>
                    updateSuggestedItemDraft("confianzaPrecio", event.target.value)
                  }
                  style={styles.input}
                >
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                </select>
              </Field>
              <Field label="Descripción" wide>
                <textarea
                  rows={3}
                  value={suggestedItemDraft.descripcion}
                  onChange={(event) =>
                    updateSuggestedItemDraft("descripcion", event.target.value)
                  }
                  style={styles.textarea}
                />
              </Field>
              <Field label="Justificación de la sugerencia" wide>
                <textarea
                  rows={3}
                  value={suggestedItemDraft.justificacionSugerencia}
                  onChange={(event) =>
                    updateSuggestedItemDraft(
                      "justificacionSugerencia",
                      event.target.value
                    )
                  }
                  style={styles.textarea}
                />
              </Field>
              <Field label="Justificación de precio" wide>
                <textarea
                  rows={3}
                  value={suggestedItemDraft.justificacionPrecio}
                  onChange={(event) =>
                    updateSuggestedItemDraft(
                      "justificacionPrecio",
                      event.target.value
                    )
                  }
                  style={styles.textarea}
                />
              </Field>
            </div>

            <p style={styles.helpText}>
              Confianza de precio:{" "}
              <strong>
                {confidenceLabels[suggestedItemDraft.confianzaPrecio] ||
                  suggestedItemDraft.confianzaPrecio}
              </strong>
            </p>

            {suggestedItemError && (
              <p style={styles.errorText}>{suggestedItemError}</p>
            )}

            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={() => setSuggestedItemDraft(null)}
                style={styles.clearButton}
                disabled={suggestedItemSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={createSuggestedItem}
                style={styles.primaryButton}
                disabled={suggestedItemSaving}
              >
                {suggestedItemSaving ? "Creando..." : "Crear y agregar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <SendQuoteEmailModal
        open={emailModalOpen}
        quote={currentSavedQuote}
        quoteId={savedQuoteId}
        companyProfile={companyProfile}
        onClose={() => setEmailModalOpen(false)}
        onSent={handleEmailSent}
      />

      <QuotePreview
        quote={{ ...quote, items: normalizedItems, ...totals }}
        companyProfile={companyProfile}
      />
    </section>
  );
}

function Field({ label, helpText, wide = false, children }) {
  return (
    <label style={{ ...styles.field, ...(wide ? styles.wideField : {}) }}>
      <span style={styles.label}>{label}</span>
      {helpText && <span style={styles.fieldHelpText}>{helpText}</span>}
      {children}
    </label>
  );
}

function TotalRow({ label, value, strong = false }) {
  return (
    <div style={styles.totalRow}>
      <span style={strong ? styles.totalLabelStrong : styles.totalLabel}>
        {label}
      </span>
      <strong style={strong ? styles.totalValueStrong : styles.totalValue}>
        {value}
      </strong>
    </div>
  );
}

function QuotePreview({ quote, companyProfile }) {
  return (
    <div style={styles.previewPanel}>
      <div className="no-print" style={styles.previewActions}>
        <h3 style={styles.panelTitle}>Vista formal imprimible</h3>
        <button type="button" onClick={() => window.print()} style={styles.printButton}>
          Imprimir cotización
        </button>
      </div>

      <QuotePrintView quote={quote} companyProfile={companyProfile} />
    </div>
  );
}

const quotePageCss = `
@media (max-width: 720px) {
  .quote-data-grid {
    grid-template-columns: 1fr !important;
  }

  .quote-payment-header {
    align-items: flex-start !important;
    flex-direction: column !important;
  }
}
`;

const styles = {
  wrapper: {
    display: "grid",
    gap: "22px",
  },
  header: {
    alignItems: "flex-start",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    paddingBottom: "14px",
  },
  title: {
    margin: "4px 0 6px",
    color: "#0f172a",
    fontSize: "28px",
    fontWeight: 900,
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.5,
    maxWidth: "720px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
  },
  bottomGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(310px, 380px)",
    gap: "18px",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
    padding: "20px",
  },
  panelTitle: {
    color: "#0f172a",
    margin: "0 0 12px",
    fontSize: "18px",
    fontWeight: 900,
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
    color: "#475569",
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
    background: "#f0fdfa",
    border: "1px solid #99f6e4",
    borderRadius: "999px",
    color: "#0f766e",
    fontSize: "11px",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "3px 7px",
    whiteSpace: "nowrap",
  },
  fieldHelpText: {
    color: "#64748b",
    fontSize: "12px",
    lineHeight: 1.4,
  },
  input: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#0f172a",
    lineHeight: 1.35,
    padding: "10px 11px",
    width: "100%",
  },
  compactTextarea: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#0f172a",
    lineHeight: 1.45,
    minHeight: "62px",
    padding: "10px 11px",
    resize: "vertical",
    width: "100%",
  },
  readOnlyValue: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    color: "#334155",
    lineHeight: 1.35,
    minHeight: "40px",
    padding: "10px 11px",
    width: "100%",
  },
  textarea: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#0f172a",
    lineHeight: 1.5,
    minHeight: "130px",
    padding: "11px",
    resize: "vertical",
    width: "100%",
  },
  assistantPanel: {
    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
    border: "1px solid #b6e4df",
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
    background: "#ecfdf5",
    border: "1px solid #99f6e4",
    borderRadius: "8px",
    color: "#0f766e",
    display: "grid",
    gap: "3px",
    minWidth: "160px",
    padding: "10px 12px",
    textAlign: "right",
  },
  helpText: {
    color: "#64748b",
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
  searchInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    minWidth: "260px",
    padding: "10px 11px",
  },
  valuationGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "12px",
  },
  valuationCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "grid",
    gap: "12px",
    padding: "14px",
  },
  valuationFooter: {
    alignItems: "center",
    display: "flex",
    gap: "10px",
    justifyContent: "space-between",
  },
  miniLabel: {
    color: "#64748b",
    display: "block",
    fontSize: "12px",
  },
  itemMeta: {
    color: "#64748b",
    display: "block",
    fontSize: "12px",
    marginTop: "3px",
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
    background: "#f8fafc",
    borderBottom: "1px solid #e5e7eb",
    color: "#64748b",
    fontSize: "12px",
    padding: "10px",
    textAlign: "left",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  td: {
    borderBottom: "1px solid #eef2f7",
    fontSize: "14px",
    padding: "10px",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  highlightedRow: {
    background: "#ecfdf5",
    outline: "2px solid #99f6e4",
    transition: "background 0.2s ease",
  },
  numberInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "8px",
    width: "92px",
  },
  moneyInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "8px",
    width: "130px",
  },
  discountRow: {
    alignItems: "center",
    borderBottom: "1px solid #eef2f7",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    padding: "11px 0",
  },
  discountInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "8px",
    textAlign: "right",
    width: "150px",
  },
  totalRow: {
    alignItems: "center",
    borderBottom: "1px solid #eef2f7",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    padding: "11px 0",
  },
  totalLabel: {
    color: "#475569",
    fontWeight: 700,
  },
  totalLabelStrong: {
    color: "#111827",
    fontSize: "18px",
    fontWeight: 800,
  },
  totalValue: {
    color: "#111827",
  },
  totalValueStrong: {
    color: "#0f766e",
    fontSize: "22px",
  },
  observationsPanel: {
    display: "grid",
    gap: "12px",
  },
  totalsPanel: {
    alignSelf: "start",
    background: "#ffffff",
  },
  totalsHeader: {
    alignItems: "flex-start",
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "12px",
  },
  quoteStatusBadge: {
    background: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    color: "#334155",
    fontSize: "12px",
    fontWeight: 800,
    padding: "6px 10px",
    whiteSpace: "nowrap",
  },
  totalsBox: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "2px 12px",
  },
  actions: {
    display: "grid",
    gap: "9px",
    marginTop: "16px",
  },
  actionHint: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    color: "#64748b",
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
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.45,
  },
  modeBadge: {
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    color: "#334155",
    fontSize: "12px",
    fontWeight: 800,
    padding: "6px 10px",
    whiteSpace: "nowrap",
  },
  suggestionToolbar: {
    alignItems: "center",
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
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
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    marginTop: "14px",
  },
  suggestionCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "grid",
    gap: "10px",
    padding: "14px",
  },
  suggestionReason: {
    color: "#475569",
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
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: "999px",
    color: "#475569",
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
    background: "#dcfce7",
    color: "#166534",
  },
  matchBadgeMissing: {
    background: "#f1f5f9",
    color: "#475569",
  },
  quoteBadge: {
    background: "#e0f2fe",
    borderRadius: "999px",
    color: "#0369a1",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 800,
    padding: "5px 9px",
    width: "fit-content",
  },
  primaryButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "11px 14px",
  },
  emitButton: {
    background: "#111827",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "11px 14px",
  },
  emailButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "11px 14px",
  },
  disabledButton: {
    background: "#f1f5f9",
    border: "1px solid #cbd5e1",
    color: "#64748b",
    cursor: "not-allowed",
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #0f766e",
    borderRadius: "6px",
    color: "#0f766e",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "9px 11px",
  },
  restoreDefaultButton: {
    background: "none",
    border: 0,
    color: "#0f766e",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 800,
    justifySelf: "start",
    padding: 0,
    whiteSpace: "nowrap",
  },
  dictationButton: {
    background: "#ffffff",
    border: "1px solid #0f766e",
    borderRadius: "6px",
    color: "#0f766e",
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
    background: "#fef2f2",
    border: "1px solid #ef4444",
    color: "#b91c1c",
  },
  micIcon: {
    background: "#0f766e",
    borderRadius: "999px",
    display: "inline-block",
    height: "14px",
    width: "10px",
  },
  micIconActive: {
    background: "#b91c1c",
  },
  dictationStatusBadge: {
    alignItems: "center",
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    color: "#475569",
    display: "inline-flex",
    fontSize: "12px",
    fontWeight: 800,
    gap: "7px",
    padding: "7px 10px",
  },
  dictationStatusActive: {
    background: "#ecfdf5",
    border: "1px solid #99f6e4",
    color: "#0f766e",
  },
  dictationStatusWarning: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
  },
  statusDot: {
    background: "#94a3b8",
    borderRadius: "999px",
    display: "inline-block",
    height: "8px",
    width: "8px",
  },
  statusDotActive: {
    background: "#0f766e",
  },
  statusDotWarning: {
    background: "#d97706",
  },
  clearButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "11px 14px",
  },
  removeButton: {
    background: "#ffffff",
    border: "1px solid #fecaca",
    borderRadius: "6px",
    color: "#b91c1c",
    cursor: "pointer",
    fontWeight: 800,
    padding: "8px 10px",
  },
  printButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 12px",
  },
  previewPanel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
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
    background: "#ffffff",
    borderRadius: "8px",
    boxShadow: "0 20px 50px rgba(15, 23, 42, 0.22)",
    display: "grid",
    gap: "14px",
    maxWidth: "860px",
    padding: "18px",
    width: "100%",
  },
  modalHeader: {
    alignItems: "flex-start",
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
  },
  modalActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "flex-end",
  },
  printSheet: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    color: "#111827",
    padding: "28px",
  },
  printHeader: {
    alignItems: "flex-start",
    borderBottom: "2px solid #111827",
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
    color: "#64748b",
    margin: "4px 0 0",
  },
  printMeta: {
    display: "grid",
    gap: "4px",
    textAlign: "right",
  },
  clientBox: {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
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
    background: "#111827",
    color: "#ffffff",
    fontSize: "12px",
    padding: "10px",
    textAlign: "left",
    textTransform: "uppercase",
  },
  printTd: {
    borderBottom: "1px solid #e5e7eb",
    padding: "10px",
    verticalAlign: "top",
  },
  printItemMeta: {
    color: "#64748b",
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
    borderTop: "1px solid #e5e7eb",
    marginTop: "20px",
    paddingTop: "14px",
  },
  emptyState: {
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    color: "#334155",
    padding: "26px",
    textAlign: "center",
  },
  emptyTitle: {
    color: "#0f172a",
    fontSize: "16px",
    margin: "0 0 6px",
  },
  emptyText: {
    color: "#64748b",
    lineHeight: 1.45,
    margin: 0,
  },
  infoText: {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    color: "#475569",
    margin: "12px 0 0",
    padding: "11px 13px",
  },
  errorText: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    color: "#b91c1c",
    margin: 0,
    padding: "11px 13px",
  },
  successText: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    borderRadius: "8px",
    color: "#166534",
    margin: 0,
    padding: "11px 13px",
  },
  warningText: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "8px",
    color: "#92400e",
    margin: "12px 0 0",
    padding: "11px 13px",
  },
};

export default NewQuotePage;
