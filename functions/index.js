// functions/index.js

// Import de Firebase Functions v2 (callable)
const {onCall: firebaseOnCall, HttpsError} = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");

// Admin SDK para acceder a Firestore
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldPath, FieldValue, Timestamp } = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");

// Gemini SDK
const { GoogleGenAI } = require("@google/genai");
const { Resend } = require("resend");
const { AI_MODELS } = require("./aiConfig");
const { createAiRateLimiter } = require("./aiRateLimiter");
const {
  classifyGeminiServiceError,
  normalizeInventoryDocumentHandler,
} = require("./inventoryDocumentImport");
const {
  confirmInventoryImportV2Handler,
  createInventoryItemWithCodeHandler,
  initializeInventoryCatalogHandler,
  saveInventoryAreaHandler,
  saveInventoryCategoryHandler,
  updateInventoryItemHandler,
} = require("./inventoryModel");
const {
  createQuoteWithNumberHandler,
  duplicateQuoteAsDraftHandler,
  updateQuoteDraftHandler,
} = require("./quotePersistence");
const {
  actualizarClienteHandler,
  archivarClienteHandler,
  crearClienteHandler,
  reactivarClienteHandler,
} = require("./clientPersistence");
const {
  actualizarProveedorHandler,
  archivarProveedorHandler,
  crearProveedorHandler,
  reactivarProveedorHandler,
} = require("./providerPersistence");
const {
  actualizarOrdenCompraBorradorHandler,
  cancelarOrdenCompraHandler,
  crearOrdenCompraHandler,
  duplicarOrdenCompraComoBorradorHandler,
  emitirOrdenCompraHandler,
  registrarRespuestaProveedorHandler,
} = require("./purchaseOrderPersistence");
const {
  actualizarCompraBorradorHandler,
  cancelarCompraBorradorHandler,
  confirmarCompraHandler,
  crearCompraDesdeOrdenHandler,
  crearCompraDesdeRecepcionHandler,
  crearCompraHandler,
  revertirCompraHandler,
} = require("./purchasePersistence");
const {
  actualizarRecepcionBorradorHandler,
  cancelarRecepcionBorradorHandler,
  confirmarRecepcionHandler,
  crearRecepcionDesdeOrdenHandler,
} = require("./receptionPersistence");
const {
  actualizarVentaBorradorHandler,
  cancelarVentaBorradorHandler,
  confirmarVentaHandler,
  crearVentaDesdeCotizacionHandler,
  crearVentaHandler,
} = require("./salePersistence");
const { sendQuoteEmailHandler } = require("./quoteEmail");
const { sendPurchaseOrderEmailHandler } = require("./purchaseOrderEmail");
const {
  buildAuthoritativeCompanySnapshot,
  getHistoricalCompanySnapshot,
} = require("./companySnapshot");
const {
  buildQuoteEmissionPatch,
  confirmQuoteWhatsAppSentHandler,
  createPublicQuoteToken,
  expirePublicQuoteProposalsHandler,
  getPublicBaseUrl,
  getPublicQuoteProposalHandler,
  isEmulatorEnvironment,
  markQuoteEmittedManuallyHandler,
  prepareQuoteWhatsAppShareHandler,
  reopenQuoteHandler,
  respondPublicQuoteProposalHandler,
} = require("./quotePublicProposal");
const {transitionQuoteStatusHandler} = require("./quoteLifecycle");
const {normalizeBusinessVerificationState} = require("./businessOperations");
const {
  createAdditionalBusinessHandler,
  createFirstBusinessHandler,
  deleteBusinessHandler,
  getBusinessSessionHandler,
  requireBusinessAccess,
  requireOperationalBusinessAccess,
  setActiveBusinessHandler,
  updateBusinessProfileHandler,
  validateBusinessProfileInput,
} = require("./businessOnboarding");
const {
  updateBusinessInformationHandler,
  updateBusinessSettingsHandler,
  updatePersonalProfileHandler,
} = require("./businessSettings");
const {
  resolverVerificacionEmpresaHandler,
  solicitarVerificacionEmpresaHandler,
} = require("./businessVerification");
const {
  cambiarEstadoEmpresaPlataformaHandler,
  cambiarEstadoUsuarioPlataformaHandler,
  eliminarEmpresaPermanentePlataformaHandler,
  listarEmpresasPlataformaHandler,
  listarUsuariosPlataformaHandler,
  obtenerEmpresaPlataformaHandler,
  obtenerDocumentoVerificacionPlataformaHandler,
  obtenerResumenPlataformaHandler,
  obtenerUsuarioPlataformaHandler,
} = require("./platformAdmin");
const {
  actualizarMembresiaNegocioHandler,
  asociarUsuarioExistenteHandler,
  listarMiembrosNegocioHandler,
} = require("./businessMemberships");
const {
  actualizarTrabajoHandler,
  agregarNotaTrabajoHandler,
  anularGastoTrabajoHandler,
  anularHorasHombreTrabajoHandler,
  asignarTareaTrabajoHandler,
  cambiarEstadoTareaTrabajoV2Handler,
  cambiarEstadoTrabajoHandler,
  crearTrabajoHandler,
  crearTareaTrabajoV2Handler,
  documentarTareaTrabajoHandler,
  eliminarTareaTrabajoV2Handler,
  registrarGastoTrabajoHandler,
  registrarHorasHombreTrabajoHandler,
  registrarDevolucionMaterialTrabajoHandler,
  registrarSalidaMaterialTrabajoHandler,
} = require("./workPersistence");
const {obtenerBalanceTrabajoHandler} = require("./workBalance");

// Inicializar Admin SDK (una sola vez)
initializeApp();
const db = getFirestore();
const adminAuth = getAuth();
const adminStorageBucket = getStorage().bucket();

function onCall(optionsOrHandler, maybeHandler) {
  const handler = maybeHandler || optionsOrHandler;
  const guardedHandler = async (request) => {
    if (request?.auth?.uid) {
      const userSnapshot = await db.collection("usuarios")
        .doc(request.auth.uid).get();
      if (userSnapshot.data()?.estadoPlataforma === "suspendido") {
        throw new HttpsError(
          "permission-denied",
          "La cuenta de usuario esta suspendida por la plataforma."
        );
      }
    }
    return handler(request);
  };
  return maybeHandler
    ? firebaseOnCall(optionsOrHandler, guardedHandler)
    : firebaseOnCall(guardedHandler);
}

/**
 * La API key de Gemini no debe guardarse en el repositorio.
 * En Firebase Functions se configura como secret:
 * firebase functions:secrets:set GEMINI_API_KEY
 * Para desarrollo local tambien puede venir desde process.env.GEMINI_API_KEY.
 */
const GEMINI_API_KEY_SECRET = defineSecret("GEMINI_API_KEY");
const RESEND_API_KEY_SECRET = defineSecret("RESEND_API_KEY");
const RESEND_FROM_EMAIL_SECRET = defineSecret("RESEND_FROM_EMAIL");
const ALLOWED_QUOTE_ITEM_TYPES = ["producto", "servicio", "actividad"];
const DEFAULT_FUNCTION_REGION = "us-central1";
const GENERATIVE_AI_ENABLED = false;
const DOCUMENT_GENERATIVE_AI_ENABLED = true;
const REFERENCE_REVIEW_STALE_DAYS = 30;
const PRIMARY_QUOTE_GEMINI_MODEL = AI_MODELS.QUOTE_SUGGESTIONS;
const QUOTE_GEMINI_MODELS = [PRIMARY_QUOTE_GEMINI_MODEL];
const LOCAL_ASSISTANT_WARNING =
  "La IA generativa no está disponible temporalmente. Se generaron sugerencias locales basadas en reglas e inventario.";

const INVENTORY_AI_IMPORT_WARNING =
  "Los valores detectados son estimaciones y deben ser revisados antes de guardar.";
const INVENTORY_LOCAL_FALLBACK_WARNING =
  "El servicio inteligente no se encuentra disponible temporalmente. Se aplicó el análisis local del archivo.";
const DEFAULT_MARGIN_WARNING =
  "Se aplicó el margen predeterminado del sistema. Puedes modificarlo antes de guardar.";
const MAX_INVENTORY_IMPORT_TEXT_LENGTH = 5000;
const MAX_INVENTORY_IMPORT_SHEETS = 8;
const MAX_INVENTORY_IMPORT_ROWS = 500;
const MAX_INVENTORY_IMPORT_COLUMNS = 40;
const MAX_INVENTORY_IMPORT_CELL_LENGTH = 500;
const DEFAULT_INVENTORY_IMPORT_MARGIN = 25;
const MAX_QUOTE_PDF_BYTES = 8 * 1024 * 1024;

let cachedGeminiClient = null;
const aiRateLimiter = createAiRateLimiter({ db });

function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;

  try {
    return GEMINI_API_KEY_SECRET.value();
  } catch (error) {
    console.error("GEMINI_API_KEY no disponible en Secret Manager.");
    return null;
  }
}

function getGeminiClient({ enabled = GENERATIVE_AI_ENABLED } = {}) {
  if (!enabled) return null;
  if (cachedGeminiClient) return cachedGeminiClient;
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    console.warn(
      "GEMINI_API_KEY no configurada. Gemini queda desactivado para esta ejecucion."
    );
    return null;
  }

  cachedGeminiClient = new GoogleGenAI({ apiKey });
  return cachedGeminiClient;
}

function getAiControlMessage(reason) {
  if (reason === "cooldown") {
    return "Espera antes de realizar otra solicitud de IA.";
  }
  if (reason === "in_progress") {
    return "Ya existe una solicitud de IA en curso.";
  }
  if (reason === "daily_limit") {
    return "Se alcanzo el limite protegido de IA por hoy.";
  }
  if (reason === "provider_rate_limit") {
    return "El servicio de IA alcanzo temporalmente un limite del proveedor.";
  }
  return "El servicio de IA no pudo completar la solicitud.";
}

function createAiHttpsError(details) {
  const reason = details?.reason || "provider_error";
  const code = reason === "in_progress"
    ? "aborted"
    : ["cooldown", "daily_limit", "provider_rate_limit"].includes(reason)
      ? "resource-exhausted"
      : "unavailable";
  return new HttpsError(code, details?.message || getAiControlMessage(reason), {
    allowed: false,
    reason,
    retryAt: details?.retryAt || null,
    retryAfterSeconds: Number(details?.retryAfterSeconds || 0),
    model: details?.model || null,
    message: details?.message || getAiControlMessage(reason),
  });
}

async function generateGeminiContent(
  { model, functionName, contents, config },
  { enabled = GENERATIVE_AI_ENABLED } = {}
) {
  const client = getGeminiClient({ enabled });
  if (!client) {
    if (functionName === "normalizeInventoryDocument") {
      console.warn("normalizeInventoryDocument: Gemini documental no disponible", {
        reason: enabled ? "configuration_missing" : "feature_disabled",
      });
    }
    throw createAiHttpsError({
      allowed: false,
      reason: "provider_error",
      retryAt: null,
      model,
      message: "El servicio de IA no esta configurado temporalmente.",
    });
  }

  let reservation;
  try {
    reservation = await aiRateLimiter.reserve(model, functionName);
  } catch (error) {
    console.error("Gemini rate-limit reservation failed", {
      model,
      functionName,
      code: error?.code || "unknown",
    });
    throw createAiHttpsError({
      allowed: false,
      reason: "provider_error",
      retryAt: null,
      model,
      message: "No fue posible comprobar la disponibilidad de IA.",
    });
  }
  if (!reservation.allowed) {
    throw createAiHttpsError(reservation);
  }

  try {
    const response = await client.models.generateContent({
      model,
      contents,
      ...(config ? { config } : {}),
    });
    let completedStatus = reservation;
    try {
      completedStatus = await aiRateLimiter.complete(model, reservation.requestId);
    } catch (completionError) {
      console.error("Gemini rate-limit completion persistence failed", {
        model,
        functionName,
        code: completionError?.code || "unknown",
      });
    }
    return {
      response,
      aiRateLimit: {
        ...completedStatus,
        allowed: false,
        reason: "cooldown",
        retryAt: reservation.retryAt,
        retryAfterSeconds: reservation.retryAfterSeconds,
      },
    };
  } catch (error) {
    if (error instanceof HttpsError && error.details?.reason) throw error;

    const classification = classifyGeminiServiceError(error);
    let details = {
      allowed: false,
      reason: ["daily_quota", "transient_rate_limit"].includes(
        classification.category
      )
        ? "provider_rate_limit"
        : "provider_error",
      retryAt: reservation.retryAt || null,
      retryAfterSeconds: reservation.retryAfterSeconds || 0,
      model,
      message: getAiControlMessage(
        ["daily_quota", "transient_rate_limit"].includes(classification.category)
          ? "provider_rate_limit"
          : "provider_error"
      ),
    };

    try {
      details = await aiRateLimiter.fail(
        model,
        reservation.requestId,
        classification
      );
    } catch (persistenceError) {
      console.error("Gemini rate-limit failure persistence failed", {
        model,
        functionName,
        code: persistenceError?.code || "unknown",
      });
    }

    console.error("Gemini provider request failed", {
      model,
      functionName,
      occurredAt: new Date().toISOString(),
      category: getSafeGeminiLogCategory(classification.category),
      code: classification.originalStatus || "unknown",
    });
    throw createAiHttpsError(details);
  }
}

function extractJsonObject(text) {
  const raw = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return JSON.parse(raw.slice(first, last + 1));
}

function safeText(value, maxLength = 180) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeInventorySummary(items) {
  if (!Array.isArray(items)) return [];

  return items
    .slice(0, 40)
    .map((item) => ({
      id: safeText(item.id, 80),
      nombre: safeText(item.nombre, 120),
      tipoItem: ALLOWED_QUOTE_ITEM_TYPES.includes(item.tipoItem)
        ? item.tipoItem
        : "producto",
      categoria: safeText(item.categoria, 80),
      unidad: safeText(item.unidad, 40),
    }))
    .filter((item) => item.id && item.nombre);
}

function normalizeAssistantMode(value) {
  const mode = safeText(value, 20).toLowerCase();
  return ["local", "gemini"].includes(mode) ? mode : "auto";
}

const INVENTORY_MATCH_STOP_WORDS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "e",
  "el",
  "en",
  "la",
  "las",
  "los",
  "o",
  "para",
  "por",
  "un",
  "una",
  "y",
]);

const INVENTORY_MATCH_GENERIC_WORDS = new Set([
  "actividad",
  "computador",
  "configuracion",
  "equipo",
  "inicial",
  "instalacion",
  "prueba",
  "pruebas",
  "servicio",
  "soporte",
  "tecnico",
]);

const INVENTORY_MATCH_ALIASES = [
  {
    source: "diagnostico tecnico de equipo",
    targets: ["diagnostico tecnico de computador"],
  },
  {
    source: "instalacion de sistema operativo",
    targets: ["formateo e instalacion de windows"],
  },
  {
    source: "instalacion de drivers",
    targets: ["instalacion de drivers"],
  },
  {
    source: "configuracion inicial de equipo",
    targets: ["configuracion inicial de equipo"],
  },
  {
    source: "respaldo de informacion",
    targets: ["respaldo de informacion"],
  },
  {
    source: "configuracion de respaldos",
    targets: ["configuracion de respaldos"],
  },
  {
    source: "limpieza interna de computador",
    targets: ["limpieza interna de computador", "limpieza interna de notebook"],
  },
  {
    source: "diseno de pagina web",
    targets: ["diseno de pagina web one page"],
  },
  {
    source: "desarrollo de sitio web",
    targets: ["desarrollo de sitio web corporativo"],
  },
  {
    source: "configuracion de formulario de contacto",
    targets: ["formulario de contacto"],
  },
  {
    source: "implementacion de carrito de compras",
    targets: ["implementacion de carrito de compras basico"],
  },
  {
    source: "configuracion de firebase",
    targets: ["configuracion basica de firebase"],
  },
];

function normalizeMatchText(value) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenizeMatchText(normalizedText) {
  return normalizedText
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !INVENTORY_MATCH_STOP_WORDS.has(token));
}

function getRelevantMatchTokens(normalizedText) {
  return [
    ...new Set(
      tokenizeMatchText(normalizedText).filter(
        (token) => !INVENTORY_MATCH_GENERIC_WORDS.has(token)
      )
    ),
  ];
}

function isAliasInventoryMatch(normalizedSuggestion, normalizedItemName) {
  return INVENTORY_MATCH_ALIASES.some((alias) => {
    if (normalizeMatchText(alias.source) !== normalizedSuggestion) return false;
    return alias.targets
      .map((target) => normalizeMatchText(target))
      .includes(normalizedItemName);
  });
}

function hasRelevantPhraseMatch(normalizedSuggestion, normalizedItemName) {
  const suggestionTokens = getRelevantMatchTokens(normalizedSuggestion);
  const itemTokens = getRelevantMatchTokens(normalizedItemName);

  if (!suggestionTokens.length || !itemTokens.length) return false;

  return (
    normalizedSuggestion.includes(normalizedItemName) ||
    normalizedItemName.includes(normalizedSuggestion)
  );
}

function scoreRelevantTokenMatch(normalizedSuggestion, normalizedItemName) {
  const suggestionTokens = getRelevantMatchTokens(normalizedSuggestion);
  const itemTokens = getRelevantMatchTokens(normalizedItemName);

  if (suggestionTokens.length < 2 || itemTokens.length < 2) return 0;

  const itemTokenSet = new Set(itemTokens);
  const sharedTokens = suggestionTokens.filter((token) => itemTokenSet.has(token));
  const requiredSharedTokens = suggestionTokens.length >= 4 ? 3 : 2;

  if (sharedTokens.length < requiredSharedTokens) return 0;

  const coverage =
    sharedTokens.length / Math.max(suggestionTokens.length, itemTokens.length);

  if (coverage < 0.5) return 0;

  return 70 + sharedTokens.length * 8 + Math.round(coverage * 10);
}

function scoreInventoryNameMatch(suggestionName, itemName) {
  const normalizedSuggestion = normalizeMatchText(suggestionName);
  const normalizedItemName = normalizeMatchText(itemName);

  if (!normalizedSuggestion || !normalizedItemName) return 0;
  if (normalizedSuggestion === normalizedItemName) return 100;
  if (isAliasInventoryMatch(normalizedSuggestion, normalizedItemName)) return 95;
  if (hasRelevantPhraseMatch(normalizedSuggestion, normalizedItemName)) return 90;

  return scoreRelevantTokenMatch(normalizedSuggestion, normalizedItemName);
}

function sanitizeQuoteSuggestions(payload, inventoryItems) {
  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
  const suggestions = Array.isArray(payload && payload.suggestions)
    ? payload.suggestions
    : [];

  return suggestions
    .slice(0, 8)
    .map((item) => {
      const nombre = safeText(item.nombre || item.nombreSugerido, 120);
      const matchId = safeText(item.inventarioMatchId, 80);
      const matchedInventory = matchId ? inventoryById.get(matchId) : null;
      const tipoItem = ALLOWED_QUOTE_ITEM_TYPES.includes(item.tipoItem)
        ? item.tipoItem
        : "actividad";
      const quantity = Number(item.cantidadSugerida ?? item.cantidad);
      const palabrasClave = Array.isArray(item.palabrasClave)
        ? item.palabrasClave
        : Array.isArray(item.keywords)
          ? item.keywords
          : tokenizeMatchText(normalizeMatchText(nombre)).slice(0, 5);

      return {
        nombre,
        tipoItem,
        cantidadSugerida:
          Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 999) : 1,
        motivo: safeText(item.motivo, 240),
        palabrasClave: palabrasClave
          .map((keyword) => safeText(keyword, 40))
          .filter(Boolean)
          .slice(0, 6),
        inventarioMatchId: matchedInventory ? matchedInventory.id : null,
        inventarioMatchNombre: matchedInventory ? matchedInventory.nombre : null,
      };
    })
    .filter((item) => item.nombre && item.motivo);
}

function findInventoryMatch(suggestionName, inventoryItems) {
  if (!Array.isArray(inventoryItems) || !suggestionName) return null;

  const bestMatch = inventoryItems.reduce(
    (best, item) => {
      const score = scoreInventoryNameMatch(suggestionName, item.nombre);
      return score > best.score ? { item, score } : best;
    },
    { item: null, score: 0 }
  );

  return bestMatch.score >= 80 ? bestMatch.item : null;
}

function buildLocalSuggestion({ nombre, tipoItem, cantidadSugerida, motivo }, inventoryItems) {
  const match = findInventoryMatch(nombre, inventoryItems);
  return {
    nombre,
    tipoItem: ALLOWED_QUOTE_ITEM_TYPES.includes(tipoItem)
      ? tipoItem
      : "actividad",
    cantidadSugerida: Number(cantidadSugerida) > 0 ? Number(cantidadSugerida) : 1,
    motivo,
    palabrasClave: tokenizeMatchText(normalizeMatchText(nombre)).slice(0, 6),
    inventarioMatchId: match ? match.id : null,
    inventarioMatchNombre: match ? match.nombre : null,
  };
}

function getCameraQuantity(normalizedDescription) {
  const match = normalizedDescription.match(/(\d{1,3})\s*(camara|camaras|cctv)/);
  if (!match) return 1;
  const quantity = Number(match[1]);
  return Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 999) : 1;
}

function buildLocalQuoteSuggestions(description, inventoryItems) {
  const text = normalizeSearchText(description);
  const has = (...keywords) =>
    keywords.some((keyword) => text.includes(normalizeSearchText(keyword)));
  const suggestions = [];
  const cameraQuantity = getCameraQuantity(text);

  const add = (suggestion) => {
    if (suggestions.length >= 8) return;
    if (suggestions.some((item) => item.nombre === suggestion.nombre)) return;
    suggestions.push(buildLocalSuggestion(suggestion, inventoryItems));
  };

  const addSupportIfNeeded = () => {
    if (suggestions.length > 0) {
      add({
        nombre: "Soporte inicial",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "Es recomendable considerar soporte inicial posterior a la entrega.",
      });
    }
  };
  const cameraDetected =
    has("camara", "camaras", "cctv") ||
    (has("seguridad") && has("instalacion", "instalar"));

  const hardwareDetected = has(
    "pc",
    "computador",
    "notebook",
    "gabinete",
    "procesador",
    "ram",
    "ssd",
    "disco duro",
    "pasta térmica",
    "pasta termica",
    "limpieza",
    "mantención",
    "mantencion",
    "armado",
    "diagnóstico",
    "diagnostico",
    "fuente de poder",
    "placa madre"
  );

  if (hardwareDetected) {
    add({
      nombre: "Diagnóstico técnico de equipo",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "La descripción menciona revisión o intervención de hardware.",
    });

    if (has("limpieza", "mantención", "mantencion", "pc", "computador", "notebook")) {
      add({
        nombre: "Limpieza interna de computador",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El equipo puede requerir limpieza interna antes de validar su estado.",
      });
    }

    if (has("pasta térmica", "pasta termica", "procesador", "temperatura", "sobrecalentamiento")) {
      add({
        nombre: "Cambio de pasta térmica",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "La intervención de procesador o temperatura puede requerir cambio de pasta térmica.",
      });
    }

    if (has("ram", "ssd", "disco duro", "procesador", "fuente de poder", "placa madre", "componente")) {
      add({
        nombre: "Instalación de componente",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El trabajo menciona componentes físicos que pueden requerir instalación.",
      });
    }

    if (has("gabinete")) {
      add({
        nombre: "Cambio de gabinete",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "La descripción menciona cambio o trabajo sobre gabinete.",
      });
    }

    if (has("armado", "pc gamer", "computador nuevo", "placa madre")) {
      add({
        nombre: "Armado de computador",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El proyecto requiere montaje o armado de equipo.",
      });
    }
  }

  const operatingSystemDetected = has(
    "formateo",
    "windows",
    "linux",
    "sistema operativo",
    "drivers",
    "respaldo",
    "migración de datos",
    "migracion de datos",
    "instalación de programas",
    "instalacion de programas"
  );

  if (operatingSystemDetected) {
    if (has("formateo", "respaldo", "migración", "migracion", "datos")) {
      add({
        nombre: "Respaldo de información",
        tipoItem: "actividad",
        cantidadSugerida: 1,
        motivo: "Antes de intervenir el sistema operativo conviene respaldar la información del usuario.",
      });
    }

    add({
      nombre: "Instalación de sistema operativo",
      tipoItem: "servicio",
      cantidadSugerida: 1,
      motivo: "La descripción menciona formateo, Windows, Linux o sistema operativo.",
    });

    if (has("drivers", "windows", "notebook", "pc", "computador")) {
      add({
        nombre: "Instalación de drivers",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El equipo puede requerir controladores para funcionar correctamente.",
      });
    }

    if (has("programas", "software", "aplicaciones", "base")) {
      add({
        nombre: "Instalación de software base",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El proyecto menciona instalación de programas o software inicial.",
      });
    }

    add({
      nombre: "Configuración inicial de equipo",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "Después de instalar el sistema se requiere configuración inicial del equipo.",
    });
  }

  const networkDetected = has(
    "router",
    "wifi",
    "red",
    "redes",
    "cableado",
    "utp",
    "punto de red",
    "impresora de red",
    "switch",
    "internet",
    "conectividad",
    "ip"
  );

  if (networkDetected) {
    add({
      nombre: "Diagnóstico de red",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "La descripción menciona conectividad, red o acceso a internet.",
    });

    if (has("router", "ip", "internet")) {
      add({
        nombre: "Configuración de router",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El proyecto puede requerir configuración de router o parámetros de red.",
      });
    }

    if (has("wifi", "inalambrica", "inalámbrica")) {
      add({
        nombre: "Configuración de red WiFi",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "La descripción menciona cobertura o configuración WiFi.",
      });
    }

    if (has("punto de red", "cableado", "utp")) {
      add({
        nombre: "Instalación de punto de red",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El trabajo menciona cableado o puntos físicos de red.",
      });
    }

    if (has("cableado", "utp", "punto de red")) {
      add({
        nombre: "Cableado UTP",
        tipoItem: "producto",
        cantidadSugerida: 1,
        motivo: "El proyecto requiere conexión física de red.",
      });
    }

    if (has("impresora de red", "impresora")) {
      add({
        nombre: "Configuración de impresora en red",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "La descripción menciona impresora compartida o conectada a red.",
      });
    }

    add({
      nombre: "Pruebas de conectividad",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "Es necesario validar conexión, alcance y funcionamiento de la red.",
    });
  }

  const webDetected = has(
    "página web",
    "pagina web",
    "sitio web",
    "landing",
    "one page",
    "ecommerce",
    "e-commerce",
    "tienda online",
    "carrito de compras",
    "formulario",
    "sistema web",
    "software",
    "crud",
    "base de datos",
    "login",
    "panel administrativo"
  );

  if (webDetected) {
    add({
      nombre: "Levantamiento de requerimientos",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "El desarrollo requiere definir alcance, funcionalidades y criterios de entrega.",
    });

    if (has("página web", "pagina web", "sitio web", "landing", "one page", "tienda online")) {
      add({
        nombre: "Diseño de página web",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El proyecto menciona una interfaz web visible para usuarios.",
      });
    }

    add({
      nombre: "Desarrollo de sitio web",
      tipoItem: "servicio",
      cantidadSugerida: 1,
      motivo: "La descripción requiere implementación técnica de una solución web.",
    });

    if (has("ecommerce", "e-commerce", "tienda online", "carrito de compras")) {
      add({
        nombre: "Implementación de carrito de compras",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El proyecto menciona comercio electrónico o venta online.",
      });
    }

    if (has("formulario", "contacto")) {
      add({
        nombre: "Configuración de formulario de contacto",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "La descripción menciona captura de datos mediante formulario.",
      });
    }

    if (has("base de datos", "crud", "login", "panel administrativo", "sistema web")) {
      add({
        nombre: "Diseño de base de datos",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El sistema requiere estructurar datos, usuarios o funcionalidades internas.",
      });
    }
  }

  const cloudDetected = has(
    "hosting",
    "dominio",
    "firebase",
    "deploy",
    "nube",
    "cloud",
    "servidor",
    "correo corporativo",
    "ssl"
  );

  if (cloudDetected) {
    if (has("hosting", "servidor", "nube", "cloud")) {
      add({
        nombre: "Configuración de hosting",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "La solución requiere un entorno de publicación o alojamiento.",
      });
    }

    if (has("dominio", "correo corporativo")) {
      add({
        nombre: "Configuración de dominio",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "La descripción menciona dominio o servicios asociados al dominio.",
      });
    }

    if (has("ssl", "certificado")) {
      add({
        nombre: "Configuración de certificado SSL",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El proyecto requiere habilitar conexión segura HTTPS.",
      });
    }

    if (has("deploy", "despliegue", "aplicación web", "aplicacion web", "firebase", "servidor")) {
      add({
        nombre: "Despliegue de aplicación web",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "La descripción menciona publicación o despliegue de una aplicación.",
      });
    }

    if (has("firebase")) {
      add({
        nombre: "Configuración de Firebase",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "El proyecto menciona Firebase como plataforma de backend o despliegue.",
      });
    }

    add({
      nombre: "Pruebas de publicación",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "Es necesario validar que el servicio publicado funcione correctamente.",
    });
  }

  const qualityDetected =
    has(
      "testing",
      "calidad",
      "pruebas funcionales",
      "aseguramiento de la calidad"
    ) || (has("pruebas") && has("software", "sistema", "web", "calidad"));
  const securityDetected =
    has(
      "vulnerabilidad",
      "hacking ético",
      "hacking etico",
      "owasp",
      "respaldo",
      "revisión",
      "revision",
      "auditoría",
      "auditoria"
    ) ||
    qualityDetected ||
    (has("seguridad") && !cameraDetected);

  if (securityDetected) {
    add({
      nombre: "Revisión básica de seguridad",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "La descripción menciona seguridad, revisión o posibles vulnerabilidades.",
    });

    if (has("owasp", "hacking ético", "hacking etico", "vulnerabilidad")) {
      add({
        nombre: "Checklist OWASP básico",
        tipoItem: "actividad",
        cantidadSugerida: 1,
        motivo: "El proyecto menciona revisión de seguridad web o buenas prácticas OWASP.",
      });
    }

    if (has("respaldo", "backup")) {
      add({
        nombre: "Configuración de respaldos",
        tipoItem: "servicio",
        cantidadSugerida: 1,
        motivo: "La descripción menciona respaldo o continuidad de información.",
      });
    }

    if (has("pruebas", "testing", "calidad")) {
      add({
        nombre: "Pruebas funcionales",
        tipoItem: "actividad",
        cantidadSugerida: 1,
        motivo: "El trabajo requiere validar calidad y comportamiento funcional.",
      });
    }

    add({
      nombre: "Informe técnico",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "Una revisión técnica debe cerrar con hallazgos y respaldo documentado.",
    });

    add({
      nombre: "Recomendaciones de mejora",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "El resultado puede incluir acciones sugeridas para mejorar la solución.",
    });
  }

  if (cameraDetected) {
    add({
      nombre: "Cámara IP exterior",
      tipoItem: "producto",
      cantidadSugerida: cameraQuantity,
      motivo: `El proyecto menciona instalación de ${cameraQuantity} cámara${cameraQuantity === 1 ? "" : "s"} de seguridad.`,
    });
  }

  if (has("cableado", "camara", "camaras", "cctv", "terreno", "metros")) {
    add({
      nombre: "Cableado UTP",
      tipoItem: "producto",
      cantidadSugerida: 1,
      motivo: "El proyecto requiere conexión física entre equipos o cobertura en terreno.",
    });
  }

  if (has("canalizacion", "terreno", "metros", "cableado")) {
    add({
      nombre: "Canalización",
      tipoItem: "producto",
      cantidadSugerida: 1,
      motivo: "La descripción menciona terreno, metros o cableado que pueden requerir canalización.",
    });
  }

  if (has("instalacion", "instalar", "camara", "camaras", "cctv")) {
    add({
      nombre: "Mano de obra de instalación",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "El trabajo descrito requiere ejecución técnica en terreno.",
    });
  }

  if (has("app", "aplicacion", "movil", "configuracion", "configurar")) {
    add({
      nombre: "Configuración de app móvil",
      tipoItem: "servicio",
      cantidadSugerida: 1,
      motivo: "El proyecto menciona configuración de aplicación móvil o acceso remoto.",
    });
  }

  if (has("prueba", "pruebas", "funcionamiento")) {
    add({
      nombre: "Pruebas de funcionamiento",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "La descripción considera validar el funcionamiento de la solución.",
    });
  }

  if (hardwareDetected || operatingSystemDetected || networkDetected || webDetected || cloudDetected || securityDetected || has("soporte", "inicial", "postventa")) {
    addSupportIfNeeded();
  }

  if (!suggestions.length) {
    add({
      nombre: "Levantamiento de requerimientos",
      tipoItem: "actividad",
      cantidadSugerida: 1,
      motivo: "La descripción requiere revisión profesional antes de estructurar la cotización.",
    });
  }

  return suggestions.slice(0, 8);
}

function buildLocalQuoteFallback(description, inventoryItems, options = {}) {
  const fallbackOptions =
    typeof options === "string" ? { warning: options } : options || {};
  const warning = fallbackOptions.warning || LOCAL_ASSISTANT_WARNING;
  const mode = fallbackOptions.mode || "auto";

  if (fallbackOptions.logUnavailable !== false) {
    console.warn("suggestQuoteItems: Gemini unavailable, using local fallback");
  }
  const suggestions = buildLocalQuoteSuggestions(description, inventoryItems);

  if (!suggestions.length) {
    console.warn("suggestQuoteItems: controlled empty suggestions");
    return {
      suggestions: [],
      source: "local",
      mode,
      warning:
        warning ||
        "No se encontraron sugerencias controladas para esta descripcion. Revisa el catalogo manual.",
    };
  }

  console.info("suggestQuoteItems: local fallback completed", {
    suggestionsCount: suggestions.length,
    inventoryCount: Array.isArray(inventoryItems) ? inventoryItems.length : 0,
  });

  return {
    suggestions,
    source: "local",
    mode,
    warning:
      Array.isArray(inventoryItems) && inventoryItems.length > 0
        ? warning
        : "No hay inventario activo disponible. Se generaron sugerencias generales para revision manual.",
  };
}

function isGeminiModelFallbackError(error) {
  const message = normalizeSearchText(
    `${error?.message || ""} ${error?.status || ""} ${error?.code || ""}`
  );

  return [
    "503",
    "429",
    "service unavailable",
    "high demand",
    "too many requests",
    "quota",
    "resource exhausted",
    "model not found",
    "model_not_found",
    "not found",
    "not available",
    "unavailable",
    "unsupported model",
  ].some((token) => message.includes(token));
}

function getSafeGeminiLogCategory(category) {
  return [
    "daily_quota",
    "transient_rate_limit",
    "unavailable",
    "validation",
  ].includes(category)
    ? category
    : "unavailable";
}

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string") {
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value instanceof Date) return value;
  return null;
}

function getReferenceDate(reference) {
  return (
    timestampToDate(reference.fechaConsulta) ||
    timestampToDate(reference.actualizadoEn) ||
    timestampToDate(reference.creadoEn)
  );
}

function getSuggestedReferenceQuery(item) {
  const itemName = String(item.nombre || "").replace(/\s+/g, " ").trim();
  const tipoItem = normalizeSearchText(item.tipoItem || "");
  const suffix =
    tipoItem === "servicio" || tipoItem === "actividad" ? " freelance" : "";
  return `precio ${itemName || "servicio informático"} Chile${suffix}`;
}

function getReferenceReviewTaskContent(item, tipoAlerta) {
  const itemNombre = item.nombre || "Ítem sin nombre";
  const isMissingReferences = tipoAlerta === "sin_referencias";

  return {
    itemId: item.id,
    itemNombre,
    tipoItem: item.tipoItem || "",
    categoria: item.categoria || "",
    tipoAlerta,
    motivo: isMissingReferences
      ? "Sin referencias de mercado"
      : "Referencias desactualizadas",
    mensaje: isMissingReferences
      ? `El ítem "${itemNombre}" no tiene referencias activas de mercado.`
      : `El ítem "${itemNombre}" tiene referencias activas con más de ${REFERENCE_REVIEW_STALE_DAYS} días.`,
    consultaSugerida: getSuggestedReferenceQuery(item),
    prioridad: isMissingReferences ? "baja" : "alta",
    accionPrincipal: isMissingReferences
      ? "Agregar referencia"
      : "Actualizar referencias",
  };
}

function buildReferenceReviewTask(item, tipoAlerta) {
  return {
    ...getReferenceReviewTaskContent(item, tipoAlerta),
    estado: "pendiente",
    aplazadaHasta: null,
    creadoEn: FieldValue.serverTimestamp(),
    actualizadoEn: FieldValue.serverTimestamp(),
  };
}

function hasDifferentReferenceTaskContent(task, nextContent) {
  return Object.entries(nextContent).some(([key, value]) => task[key] !== value);
}

function isTaskPostponedUntilFuture(task, now) {
  const postponedUntil = timestampToDate(task.aplazadaHasta);
  return Boolean(postponedUntil && postponedUntil.getTime() > now.getTime());
}

async function upsertReferenceReviewTask(tasksRef, item, tipoAlerta, now) {
  const snapshot = await tasksRef.where("itemId", "==", item.id).limit(20).get();
  const existingDoc = snapshot.docs.find((taskDoc) => {
    const task = taskDoc.data();
    return (
      task.tipoAlerta === tipoAlerta &&
      ["pendiente", "aplazada"].includes(task.estado || "pendiente")
    );
  });

  if (!existingDoc) {
    await tasksRef.add(buildReferenceReviewTask(item, tipoAlerta));
    return { created: true, updated: false };
  }

  const task = existingDoc.data();
  const nextContent = getReferenceReviewTaskContent(item, tipoAlerta);
  const update = {};

  if (hasDifferentReferenceTaskContent(task, nextContent)) {
    Object.assign(update, nextContent);
  }

  if ((task.estado || "pendiente") === "aplazada" && !isTaskPostponedUntilFuture(task, now)) {
    update.estado = "pendiente";
    update.aplazadaHasta = null;
  }

  if (Object.keys(update).length > 0) {
    update.actualizadoEn = FieldValue.serverTimestamp();
    await existingDoc.ref.update(update);
    return { created: false, updated: true };
  }

  return { created: false, updated: false };
}

async function reviewBusinessInventoryReferences(businessDoc) {
  const inventorySnapshot = await businessDoc.ref.collection("inventario").get();
  const referencesSnapshot = await businessDoc.ref.collection("referencias").get();
  const tasksRef = businessDoc.ref.collection("tareasReferencias");
  const referencesByItem = new Map();

  referencesSnapshot.docs.forEach((referenceDoc) => {
    const reference = referenceDoc.data();
    if ((reference.estado || "activa") !== "activa") return;
    const itemId = reference.itemId || "";
    if (!itemId) return;
    if (!referencesByItem.has(itemId)) {
      referencesByItem.set(itemId, []);
    }
    referencesByItem.get(itemId).push(reference);
  });

  let created = 0;
  let updated = 0;
  let checked = 0;
  const now = new Date();
  const staleMs = REFERENCE_REVIEW_STALE_DAYS * 24 * 60 * 60 * 1000;

  for (const itemDoc of inventorySnapshot.docs) {
    const item = { id: itemDoc.id, ...itemDoc.data() };
    if ((item.estado || "activo") !== "activo") continue;
    checked += 1;

    const activeReferences = referencesByItem.get(item.id) || [];
    if (activeReferences.length === 0) {
      const result = await upsertReferenceReviewTask(
        tasksRef,
        item,
        "sin_referencias",
        now
      );
      if (result.created) created += 1;
      if (result.updated) updated += 1;
      continue;
    }

    const latestReferenceDate = activeReferences
      .map(getReferenceDate)
      .filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    if (!latestReferenceDate || now.getTime() - latestReferenceDate.getTime() > staleMs) {
      const result = await upsertReferenceReviewTask(
        tasksRef,
        item,
        "referencias_desactualizadas",
        now
      );
      if (result.created) created += 1;
      if (result.updated) updated += 1;
    }
  }

  return { checked, created, updated };
}

/** Utilidad: parsea el primer número entero razonable desde un texto */
function parseIntegerFromText(text) {
  if (!text) return null;
  const soloNumeros = String(text).replace(/[^\d]/g, "");
  const valor = parseInt(soloNumeros, 10);
  if (!valor || Number.isNaN(valor) || valor <= 0) return null;
  return valor;
}

exports.nightlyInventoryReferenceReview = onSchedule(
  {
    maxInstances: 1,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    schedule: "every day 03:15",
    timeZone: "America/Santiago",
    timeoutSeconds: 540,
  },
  async () => {
    const businessesSnapshot = await db
      .collection("negocios")
      .where("estado", "==", "activo")
      .get();
    let businessesChecked = 0;
    let itemsChecked = 0;
    let tasksCreated = 0;
    let tasksUpdated = 0;
    let businessesFailed = 0;

    for (const businessDoc of businessesSnapshot.docs) {
      if (businessDoc.data()?.eliminadoEn) continue;
      if (normalizeBusinessVerificationState(businessDoc.data()) !== "VERIFICADA") {
        continue;
      }
      try {
        const result = await reviewBusinessInventoryReferences(businessDoc);
        businessesChecked += 1;
        itemsChecked += result.checked;
        tasksCreated += result.created;
        tasksUpdated += result.updated;
      } catch (error) {
        businessesFailed += 1;
        console.error("Error en revision nocturna de referencias:", {
          message: error.message,
          name: error.name,
        });
      }
    }

    console.log("Revision nocturna de referencias completada.", {
      businessesChecked,
      itemsChecked,
      tasksCreated,
      tasksUpdated,
      businessesFailed,
    });
  }
);

/*
 * Funciones legacy no exportadas.
 *
 * Estas funciones pertenecen a una etapa anterior del prototipo: usan campos
 * antiguos del inventario como `precio` y `url`, o la coleccion `proyectos`.
 * El MVP vigente para tesis expone solo:
 * - nightlyInventoryReferenceReview
 * - suggestQuoteItems
 */

/**
 * Usa Gemini para intentar extraer el precio principal desde el HTML.
 * Devuelve un número entero (precio en CLP) o null si no pudo.
 */
async function extraerPrecioConGemini(html) {
  if (!getGeminiClient()) return null;

  const trimmedHtml = html.slice(0, 20000); // recortar por si la página es muy grande

  const prompt =
    "Eres un asistente experto en comercio electrónico. " +
    "Te enviaré el HTML de una página de producto. " +
    "Debes identificar el PRECIO PRINCIPAL del producto, " +
    "expresado en pesos chilenos (CLP) si es posible. " +
    "Responde ÚNICAMENTE con un número entero, sin puntos, sin comas, sin texto adicional.\n\n" +
    "HTML de la página:\n" +
    trimmedHtml;

  try {
    const { response } = await generateGeminiContent({
      model: PRIMARY_QUOTE_GEMINI_MODEL,
      functionName: "legacyExtraerPrecioConGemini",
      contents: prompt,
    });
    const text = (response.text || "").trim();
    return parseIntegerFromText(text);
  } catch (error) {
    console.error("Legacy Gemini HTML extraction failed", {
      model: PRIMARY_QUOTE_GEMINI_MODEL,
      functionName: "legacyExtraerPrecioConGemini",
      code: error?.code || "unknown",
      reason: error?.details?.reason || "unknown",
    });
    return null;
  }
}

/**
 * Estima un precio de mercado (venta sugerida) SOLO en base a la
 * descripción del producto + precio interno actual.
 */
async function estimarPrecioMercadoDesdeDescripcion(producto, precioInterno) {
  if (!getGeminiClient()) return null;

  const nombre = producto.nombre || "producto";
  const categoria = producto.categoria || "";
  const unidad = producto.unidad || ""; // por ejemplo: "unidad", "kit 4 cámaras", "metro", etc.

  const prompt =
    "Eres un experto en precios de mercado de productos y servicios en Chile. " +
    "Te daré la descripción de un producto del inventario de una pyme. " +
    "Debes responder con un PRECIO DE VENTA RECOMENDADO AL CLIENTE FINAL, " +
    "en pesos chilenos (CLP), para el año actual. " +
    "Considera un margen razonable sobre el costo del negocio, " +
    "y un precio competitivo (ni demasiado bajo ni demasiado alto).\n\n" +
    "Responde ÚNICAMENTE con un número entero, sin puntos, sin comas y sin texto adicional.\n\n" +
    `Nombre: ${nombre}\n` +
    (categoria ? `Categoría: ${categoria}\n` : "") +
    (unidad ? `Unidad/presentación: ${unidad}\n` : "") +
    `Precio actual del negocio: ${precioInterno} CLP.\n`;

  try {
    const { response } = await generateGeminiContent({
      model: PRIMARY_QUOTE_GEMINI_MODEL,
      functionName: "legacyEstimarPrecioMercado",
      contents: prompt,
    });
    const text = (response.text || "").trim();
    let precioRecomendado = parseIntegerFromText(text);

    if (!precioRecomendado) return null;

    // Guardrails para que no devuelva locuras (100x la cifra, etc.)
    const maxFactor = 10;
    const minFactor = 0.2;
    const maxAceptable = Math.round(precioInterno * maxFactor);
    const minAceptable = Math.round(precioInterno * minFactor);

    if (precioRecomendado > maxAceptable) {
      precioRecomendado = maxAceptable;
    } else if (precioRecomendado < minAceptable) {
      precioRecomendado = minAceptable;
    }

    return precioRecomendado;
  } catch (error) {
    console.error("Legacy Gemini market estimate failed", {
      model: PRIMARY_QUOTE_GEMINI_MODEL,
      functionName: "legacyEstimarPrecioMercado",
      code: error?.code || "unknown",
      reason: error?.details?.reason || "unknown",
    });
    return null;
  }
}

/** Clasifica el estado según porcentaje de diferencia */
function clasificarEstado(diffPorcentaje) {
  if (diffPorcentaje >= 10) return "precio_alza";
  if (diffPorcentaje <= -10) return "precio_baja";
  return "normal";
}

/**
 * Intenta obtener precio desde una URL:
 *  1) Gemini con HTML
 *  2) patrones típicos (itemprop=price, data-price, "price":)
 *  3) patrón genérico $ 12.990
 */
async function obtenerPrecioDesdeUrl(url, precioInterno) {
  if (!url) return { precioProveedor: null, modo: "sin_url" };

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const html = await res.text();
    let precioProveedor = null;
    let modo = "gemini";

    // 1) Gemini con HTML
    precioProveedor = await extraerPrecioConGemini(html);

    // 2) patrones típicos
    if (!precioProveedor) {
      const match = html.match(
        /(?:itemprop="price"[^>]*content="|data-price="|data-precio="|"price":\s*")([\d.]+)/i
      );
      if (match && match[1]) {
        const valor = parseIntegerFromText(match[1]);
        if (valor) {
          precioProveedor = valor;
          modo = "web";
        }
      }
    }

    // 3) patrón genérico $ 12.990
    if (!precioProveedor) {
      const match2 = html.match(/\$\s*([\d.]{3,})/);
      if (match2 && match2[1]) {
        const valor = parseIntegerFromText(match2[1]);
        if (valor) {
          precioProveedor = valor;
          modo = "web";
        }
      }
    }

    return { precioProveedor, modo };
  } catch (error) {
    console.error("Error al obtener precio desde URL:", error);
    return { precioProveedor: null, modo: "error_url" };
  }
}

/**
 * verificarPrecioProducto
 *
 * Callable Function
 * - Recibe: { productoId }
 * - Usa: request.auth.uid como userId
 *
 * Usa URL + Gemini + patrones HTML para comparar tu precio actual
 * con el precio del proveedor.
 */
const legacyVerificarPrecioProducto = onCall({ secrets: [GEMINI_API_KEY_SECRET] }, async (request) => {
  // 1. Seguridad: debe estar autenticado
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const userId = request.auth.uid;

  // 2. Validar parámetro
  const productoId = request.data && request.data.productoId;
  if (!productoId) {
    throw new HttpsError("invalid-argument", "Falta el campo 'productoId'.");
  }

  // 3. Leer producto desde Firestore
  const productoRef = db
    .collection("usuarios")
    .doc(userId)
    .collection("inventario")
    .doc(productoId);

  const snap = await productoRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Producto no encontrado.");
  }

  const producto = snap.data();
  const precioInterno = Number(producto.precio);

  if (!precioInterno || Number.isNaN(precioInterno)) {
    throw new HttpsError(
      "failed-precondition",
      "El producto no tiene un precio interno válido."
    );
  }

  const url = producto.url;
  if (!url) {
    throw new HttpsError(
      "failed-precondition",
      "El producto no tiene una URL de proveedor configurada."
    );
  }

  // 4. Obtener precio desde la web
  let { precioProveedor, modo } = await obtenerPrecioDesdeUrl(
    url,
    precioInterno
  );

  // 5. Si no pudimos obtener un precio real, usar simulación
  if (!precioProveedor) {
    modo = "simulado";
    const factor = 0.9 + Math.random() * 0.2; // entre 0.9 y 1.1
    precioProveedor = Math.round(precioInterno * factor);
  }

  const diferencia = precioProveedor - precioInterno;
  const diffPorcentaje = (diferencia / precioInterno) * 100;
  const estadoAlerta = clasificarEstado(diffPorcentaje);

  // 6. Actualizar producto en Firestore
  await productoRef.update({
    ultimoPrecioProveedor: precioProveedor,
    diferenciaPrecioProveedor: diferencia,
    diffPorcentaje,
    estadoAlerta,
    ultimaVerificacion: FieldValue.serverTimestamp(),
    fuenteUltimoPrecio: modo, // "gemini", "web" o "simulado"
  });

  // 7. Registrar historial
  await productoRef.collection("historialPrecios").add({
    fecha: FieldValue.serverTimestamp(),
    precioInterno,
    precioProveedor,
    diferencia,
    diffPorcentaje,
    estadoAlerta,
    fuente: modo,
    urlConsultada: url,
  });

  // 8. Respuesta al frontend
  return {
    precioProveedor,
    diferencia,
    diffPorcentaje,
    estadoAlerta,
    modo,
  };
});

/**
 * estimarPrecioMercadoProducto
 *
 * Callable Function
 * - Recibe: { productoId }
 * - Usa: Gemini + descripción del producto.
 *
 * Entrega un precio de venta recomendado de mercado (cliente final),
 * para que el negocio no venda demasiado caro ni demasiado barato.
 */
const legacyEstimarPrecioMercadoProducto = onCall({ secrets: [GEMINI_API_KEY_SECRET] }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const userId = request.auth.uid;
  const productoId = request.data && request.data.productoId;

  if (!productoId) {
    throw new HttpsError("invalid-argument", "Falta el campo 'productoId'.");
  }

  const productoRef = db
    .collection("usuarios")
    .doc(userId)
    .collection("inventario")
    .doc(productoId);

  const snap = await productoRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Producto no encontrado.");
  }

  const producto = snap.data();
  const precioInterno = Number(producto.precio);

  if (!precioInterno || Number.isNaN(precioInterno)) {
    throw new HttpsError(
      "failed-precondition",
      "El producto no tiene un precio interno válido."
    );
  }

  const precioRecomendado = await estimarPrecioMercadoDesdeDescripcion(
    producto,
    precioInterno
  );

  if (!precioRecomendado) {
    throw new HttpsError(
      "failed-precondition",
      "Gemini no esta configurado o no pudo estimar el precio de mercado."
    );
  }

  const diferencia = precioRecomendado - precioInterno;
  const diffPorcentaje = (diferencia / precioInterno) * 100;

  let estadoAlerta = "competitivo";
  if (diffPorcentaje >= 20) {
    estadoAlerta = "muy_caro_recomendado";
  } else if (diffPorcentaje <= -20) {
    estadoAlerta = "muy_barato_recomendado";
  }

  await productoRef.update({
    precioRecomendadoMercado: precioRecomendado,
    diferenciaVsActual: diferencia,
    diffPorcentajeRecomendacion: diffPorcentaje,
    estadoRecomendacion: estadoAlerta,
    ultimaRecomendacion: FieldValue.serverTimestamp(),
    fuenteUltimaRecomendacion: "gemini_descripcion",
  });

  return {
    precioRecomendado,
    diferencia,
    diffPorcentaje,
    estadoAlerta,
  };
});

/**
 * actualizarPreciosInventario
 *
 * Callable Function
 * - No recibe parámetros; usa request.auth.uid
 * - Recorre todo el inventario del usuario
 * - Para cada producto, intenta:
 *     1) URL + Gemini/HTML
 *     2) Descripción + Gemini (mercado)
 *     3) Simulación
 */
const legacyActualizarPreciosInventario = onCall({ secrets: [GEMINI_API_KEY_SECRET] }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const userId = request.auth.uid;

  const inventarioRef = db
    .collection("usuarios")
    .doc(userId)
    .collection("inventario");

  const snapshot = await inventarioRef.get();

  if (snapshot.empty) {
    return {
      totalProductos: 0,
      actualizados: 0,
      resumenEstados: {},
    };
  }

  let actualizados = 0;
  const resumenEstados = {
    precio_alza: 0,
    precio_baja: 0,
    normal: 0,
  };

  for (const docSnap of snapshot.docs) {
    const productoId = docSnap.id;
    const producto = docSnap.data();

    const precioInterno = Number(producto.precio);
    if (!precioInterno || Number.isNaN(precioInterno)) {
      continue; // saltamos productos mal configurados
    }

    let precioProveedor = null;
    let modo = "gemini";
    const url = producto.url;

    // 1) Intentar con URL
    if (url) {
      const resultadoUrl = await obtenerPrecioDesdeUrl(url, precioInterno);
      precioProveedor = resultadoUrl.precioProveedor;
      modo = resultadoUrl.modo;
    }

    // 2) Si no hay URL o falló, estimar por descripción
    if (!precioProveedor) {
      const estimado = await estimarPrecioMercadoDesdeDescripcion(
        producto,
        precioInterno
      );
      if (estimado) {
        precioProveedor = estimado;
        modo = "gemini_descripcion";
      }
    }

    // 3) Simulación si nada resultó
    if (!precioProveedor) {
      modo = "simulado";
      const factor = 0.9 + Math.random() * 0.2;
      precioProveedor = Math.round(precioInterno * factor);
    }

    const diferencia = precioProveedor - precioInterno;
    const diffPorcentaje = (diferencia / precioInterno) * 100;
    const estadoAlerta = clasificarEstado(diffPorcentaje);

    await inventarioRef.doc(productoId).update({
      ultimoPrecioProveedor: precioProveedor,
      diferenciaPrecioProveedor: diferencia,
      diffPorcentaje,
      estadoAlerta,
      ultimaVerificacion: FieldValue.serverTimestamp(),
      fuenteUltimoPrecio: modo,
    });

    await inventarioRef.doc(productoId).collection("historialPrecios").add({
      fecha: FieldValue.serverTimestamp(),
      precioInterno,
      precioProveedor,
      diferencia,
      diffPorcentaje,
      estadoAlerta,
      fuente: modo,
      urlConsultada: url || null,
    });

    actualizados += 1;
    if (resumenEstados[estadoAlerta] !== undefined) {
      resumenEstados[estadoAlerta] += 1;
    }
  }

  return {
    totalProductos: snapshot.size,
    actualizados,
    resumenEstados,
  };
});

function getResendApiKey() {
  if (process.env.QUOTE_EMAIL_RESEND_API_KEY) {
    return process.env.QUOTE_EMAIL_RESEND_API_KEY.trim();
  }
  if (process.env.RESEND_API_KEY) {
    return process.env.RESEND_API_KEY.trim();
  }

  try {
    return RESEND_API_KEY_SECRET.value().trim();
  } catch (error) {
    return null;
  }
}

function getQuoteEmailSender() {
  const envSender = (
    process.env.QUOTE_EMAIL_FROM ||
    process.env.RESEND_FROM_EMAIL ||
    ""
  ).trim();
  if (envSender) return envSender;

  try {
    return RESEND_FROM_EMAIL_SECRET.value().trim();
  } catch (error) {
    return "";
  }
}

function hasCompanyEmailData(company) {
  return Boolean(
    company &&
      [
        "nombreComercial",
        "razonSocial",
        "rut",
        "giro",
        "email",
        "telefono",
        "direccion",
        "ciudad",
        "sitioWeb",
        "condicionesPago",
        "notaPieCotizacion",
      ].some((field) => String(company[field] || "").trim())
  );
}

exports.createQuoteWithNumber = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    createQuoteWithNumberHandler({
      request,
      db,
      FieldValue,
      HttpsError,
      requireBusinessAccess: requireOperationalBusinessAccess,
    })
);

exports.updateQuoteDraft = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    updateQuoteDraftHandler({
      request,
      db,
      FieldValue,
      HttpsError,
      requireBusinessAccess: requireOperationalBusinessAccess,
    })
);

exports.duplicateQuoteAsDraft = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    duplicateQuoteAsDraftHandler({
      request,
      db,
      FieldValue,
      HttpsError,
      requireBusinessAccess: requireOperationalBusinessAccess,
    })
);

const purchaseOrderPersistenceDependencies = {
  db,
  FieldValue,
  HttpsError,
  requireBusinessAccess: requireOperationalBusinessAccess,
};

exports.crearOrdenCompra = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    crearOrdenCompraHandler(request, purchaseOrderPersistenceDependencies)
);

exports.duplicarOrdenCompraComoBorrador = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    duplicarOrdenCompraComoBorradorHandler(
      request,
      purchaseOrderPersistenceDependencies
    )
);

exports.actualizarOrdenCompraBorrador = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    actualizarOrdenCompraBorradorHandler(
      request,
      purchaseOrderPersistenceDependencies
    )
);

exports.emitirOrdenCompra = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    emitirOrdenCompraHandler(request, purchaseOrderPersistenceDependencies)
);

exports.cancelarOrdenCompra = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    cancelarOrdenCompraHandler(request, purchaseOrderPersistenceDependencies)
);

exports.registrarRespuestaProveedorOrdenCompra = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) =>
    registrarRespuestaProveedorHandler(request, purchaseOrderPersistenceDependencies)
);

const receptionPersistenceDependencies = {
  db,
  FieldValue,
  HttpsError,
  requireBusinessAccess: requireOperationalBusinessAccess,
};

exports.crearRecepcionDesdeOrden = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => crearRecepcionDesdeOrdenHandler(request, receptionPersistenceDependencies)
);

exports.actualizarRecepcionBorrador = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => actualizarRecepcionBorradorHandler(request, receptionPersistenceDependencies)
);

exports.confirmarRecepcion = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => confirmarRecepcionHandler(request, receptionPersistenceDependencies)
);

exports.cancelarRecepcionBorrador = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => cancelarRecepcionBorradorHandler(request, receptionPersistenceDependencies)
);

const purchasePersistenceDependencies = {
  db,
  FieldValue,
  HttpsError,
  requireBusinessAccess: requireOperationalBusinessAccess,
};

exports.crearCompra = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => crearCompraHandler(request, purchasePersistenceDependencies)
);

exports.crearCompraDesdeOrden = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => crearCompraDesdeOrdenHandler(request, purchasePersistenceDependencies)
);

exports.actualizarCompraBorrador = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => actualizarCompraBorradorHandler(request, purchasePersistenceDependencies)
);

exports.confirmarCompra = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => confirmarCompraHandler(request, purchasePersistenceDependencies)
);

exports.cancelarCompraBorrador = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => cancelarCompraBorradorHandler(request, purchasePersistenceDependencies)
);

exports.revertirCompra = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => revertirCompraHandler(request, purchasePersistenceDependencies)
);

const salePersistenceDependencies = {
  db,
  FieldValue,
  HttpsError,
  requireBusinessAccess: requireOperationalBusinessAccess,
};

exports.crearVenta = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => crearVentaHandler(request, salePersistenceDependencies)
);

exports.crearVentaDesdeCotizacion = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => crearVentaDesdeCotizacionHandler(request, salePersistenceDependencies)
);

exports.actualizarVentaBorrador = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => actualizarVentaBorradorHandler(request, salePersistenceDependencies)
);

exports.confirmarVenta = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => confirmarVentaHandler(request, salePersistenceDependencies)
);

exports.cancelarVentaBorrador = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => cancelarVentaBorradorHandler(request, salePersistenceDependencies)
);

exports.cancelarVenta = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => cancelarVentaBorradorHandler(request, salePersistenceDependencies)
);

const clientPersistenceDependencies = {
  db,
  HttpsError,
  FieldValue,
  requireBusinessAccess: requireOperationalBusinessAccess,
};

exports.crearCliente = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    crearClienteHandler(request, clientPersistenceDependencies)
);

exports.actualizarCliente = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    actualizarClienteHandler(request, clientPersistenceDependencies)
);

exports.archivarCliente = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    archivarClienteHandler(request, clientPersistenceDependencies)
);

exports.reactivarCliente = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    reactivarClienteHandler(request, clientPersistenceDependencies)
);

const workPersistenceDependencies = {
  db,
  auth: adminAuth,
  HttpsError,
  FieldValue,
  requireBusinessAccess: requireOperationalBusinessAccess,
};

const workCallableOptions = {
  maxInstances: 20,
  memory: "256MiB",
  region: DEFAULT_FUNCTION_REGION,
  timeoutSeconds: 30,
};

exports.crearTrabajo = onCall(workCallableOptions, async (request) =>
  crearTrabajoHandler(request, workPersistenceDependencies)
);

exports.actualizarTrabajo = onCall(workCallableOptions, async (request) =>
  actualizarTrabajoHandler(request, workPersistenceDependencies)
);

exports.cambiarEstadoTrabajo = onCall(workCallableOptions, async (request) =>
  cambiarEstadoTrabajoHandler(request, workPersistenceDependencies)
);

exports.agregarTareaTrabajo = onCall(workCallableOptions, async (request) =>
  crearTareaTrabajoV2Handler(request, workPersistenceDependencies)
);

exports.cambiarEstadoTareaTrabajo = onCall(workCallableOptions, async (request) =>
  cambiarEstadoTareaTrabajoV2Handler(request, workPersistenceDependencies)
);

exports.eliminarTareaTrabajo = onCall(workCallableOptions, async (request) =>
  eliminarTareaTrabajoV2Handler(request, workPersistenceDependencies)
);

exports.asignarTareaTrabajo = onCall(workCallableOptions, async (request) =>
  asignarTareaTrabajoHandler(request, workPersistenceDependencies)
);

exports.documentarTareaTrabajo = onCall(workCallableOptions, async (request) =>
  documentarTareaTrabajoHandler(request, workPersistenceDependencies)
);

exports.registrarGastoTrabajo = onCall(workCallableOptions, async (request) =>
  registrarGastoTrabajoHandler(request, workPersistenceDependencies)
);

exports.anularGastoTrabajo = onCall(workCallableOptions, async (request) =>
  anularGastoTrabajoHandler(request, workPersistenceDependencies)
);

exports.registrarHorasHombreTrabajo = onCall(workCallableOptions, async (request) =>
  registrarHorasHombreTrabajoHandler(request, workPersistenceDependencies)
);

exports.anularHorasHombreTrabajo = onCall(workCallableOptions, async (request) =>
  anularHorasHombreTrabajoHandler(request, workPersistenceDependencies)
);

exports.registrarSalidaMaterialTrabajo = onCall(workCallableOptions, async (request) =>
  registrarSalidaMaterialTrabajoHandler(request, workPersistenceDependencies)
);

exports.registrarDevolucionMaterialTrabajo = onCall(workCallableOptions, async (request) =>
  registrarDevolucionMaterialTrabajoHandler(request, workPersistenceDependencies)
);

exports.obtenerBalanceTrabajo = onCall(workCallableOptions, async (request) =>
  obtenerBalanceTrabajoHandler(request, workPersistenceDependencies)
);

exports.agregarNotaTrabajo = onCall(workCallableOptions, async (request) =>
  agregarNotaTrabajoHandler(request, workPersistenceDependencies)
);

const providerPersistenceDependencies = {
  db,
  HttpsError,
  FieldValue,
  requireBusinessAccess: requireOperationalBusinessAccess,
};

exports.crearProveedor = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    crearProveedorHandler(request, providerPersistenceDependencies)
);

exports.actualizarProveedor = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    actualizarProveedorHandler(request, providerPersistenceDependencies)
);

exports.archivarProveedor = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    archivarProveedorHandler(request, providerPersistenceDependencies)
);

exports.reactivarProveedor = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    reactivarProveedorHandler(request, providerPersistenceDependencies)
);

async function getCompanyProfileForQuote(businessRef, quote) {
  const historical = getHistoricalCompanySnapshot(quote);
  if (hasCompanyEmailData(historical)) {
    return historical;
  }

  const [businessSnapshot, profileSnapshot] = await Promise.all([
    businessRef.get(),
    businessRef.collection("empresa").doc("perfil").get(),
  ]);

  return buildAuthoritativeCompanySnapshot({
    businessId: businessRef.id,
    business: businessSnapshot.data() || {},
    profile: profileSnapshot.data() || {},
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrencyClp(value) {
  return Number(value || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
  });
}

function sanitizeAttachmentFileName(value) {
  const cleaned = safeText(value, 140)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_");
  return cleaned.endsWith(".pdf") ? cleaned : `${cleaned || "Cotizacion"}.pdf`;
}

function normalizePdfAttachment(value) {
  if (!value || typeof value !== "object") return null;

  const nested =
    value.pdfAttachment && typeof value.pdfAttachment === "object"
      ? value.pdfAttachment
      : {};
  const source = {
    ...nested,
    ...value,
  };
  const contentBase64 = String(
    source.pdfBase64 || source.contentBase64 || source.content || ""
  )
    .trim()
    .replace(/^data:application\/pdf;base64,/i, "")
    .replace(/\s+/g, "");
  if (!contentBase64) return null;
  if (contentBase64.length > Math.ceil((MAX_QUOTE_PDF_BYTES * 4) / 3) + 4) {
    throw new HttpsError(
      "resource-exhausted",
      "El PDF adjunto no puede superar 8 MB."
    );
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(contentBase64)) {
    throw new HttpsError("invalid-argument", "El PDF adjunto no tiene un formato valido.");
  }
  const mimeType = safeText(source.pdfMimeType || source.contentType, 80) || "application/pdf";
  if (mimeType !== "application/pdf") {
    throw new HttpsError("invalid-argument", "El PDF adjunto debe ser application/pdf.");
  }

  const contentBuffer = Buffer.from(contentBase64, "base64");
  if (contentBuffer.length > MAX_QUOTE_PDF_BYTES) {
    throw new HttpsError(
      "resource-exhausted",
      "El PDF adjunto no puede superar 8 MB."
    );
  }
  if (!contentBuffer.length || contentBuffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new HttpsError("invalid-argument", "El PDF adjunto no tiene un formato valido.");
  }

  return {
    filename: sanitizeAttachmentFileName(
      source.pdfFilename || source.fileName || source.filename
    ),
    content: contentBase64,
    contentType: "application/pdf",
  };
}

function formatQuoteDate(value) {
  if (!value) return "-";

  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("es-CL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function joinNonEmpty(parts, separator = " / ") {
  return parts.filter((part) => String(part || "").trim()).join(separator);
}

function buildPlainQuoteEmail({ quote, mensaje, proposalUrl }) {
  const company = quote.empresa || {};
  const companyName = company.nombreComercial || company.razonSocial || "Bagner";
  const companyContact = joinNonEmpty([
    company.email,
    company.telefono,
    company.sitioWeb,
  ]);
  const companyAddress = joinNonEmpty([company.direccion, company.ciudad]);
  const validityDays = quote.validezDias || company.validezCotizacionDias || 15;

  const lines = [
    companyName,
    "",
    mensaje,
    "",
    `Cotizacion: ${quote.numero || quote.id || "-"}`,
    `Fecha: ${formatQuoteDate(quote.fecha)}`,
    `Total: ${formatCurrencyClp(quote.total)}`,
    `Validez: ${validityDays} dias`,
    "",
    "El detalle de los productos, servicios, condiciones comerciales y observaciones se encuentra en el documento PDF adjunto.",
    "",
    "Revisa y responde la cotizacion en este enlace:",
    proposalUrl,
    "",
    companyContact || companyAddress ? `Contacto ${companyName}:` : "",
    companyContact,
    companyAddress,
    "",
    "Este correo fue generado desde ValoraCloud.",
  ];

  return lines.filter((line) => line !== "").join("\n");
}

function buildQuoteEmailHtml({ quote, mensaje, proposalUrl }) {
  const company = quote.empresa || {};
  const brand = company.nombreComercial || company.razonSocial || "Bagner";
  const companyContact = joinNonEmpty([
    company.email,
    company.telefono,
    company.sitioWeb,
  ]);
  const companyAddress = joinNonEmpty([company.direccion, company.ciudad]);
  const validityDays = quote.validezDias || company.validezCotizacionDias || 15;

  return `<!doctype html>
  <html>
    <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:640px;margin:0 auto;padding:24px;">
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;">
          <h1 style="margin:0 0 6px;font-size:24px;line-height:1.2;">${escapeHtml(brand)}</h1>
          <h2 style="font-size:20px;line-height:1.3;margin:0 0 18px;color:#111827;">Cotizaci&oacute;n</h2>
          <p style="line-height:1.6;white-space:pre-wrap;margin:0 0 18px;color:#1f2937;">${escapeHtml(mensaje)}</p>
          <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:18px 0;">
            <p style="margin:0 0 8px;font-size:16px;"><strong>Cotizaci&oacute;n ${escapeHtml(
              quote.numero || quote.id || "-"
            )}</strong></p>
            <p style="margin:0 0 6px;color:#475569;">Fecha: ${escapeHtml(formatQuoteDate(quote.fecha))}</p>
            <p style="margin:0 0 6px;color:#475569;">Total: <strong style="color:#111827;">${escapeHtml(
              formatCurrencyClp(quote.total)
            )}</strong></p>
            <p style="margin:0;color:#475569;">Validez: ${escapeHtml(validityDays)} d&iacute;as</p>
          </div>
          <div style="background:#eef6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;margin:18px 0;color:#1e3a8a;">
            El detalle de los productos, servicios, condiciones comerciales y observaciones se encuentra en el documento PDF adjunto.
          </div>
          <div style="margin:22px 0;text-align:center;">
            <a href="${escapeHtml(proposalUrl)}" style="background:#0f766e;border-radius:6px;color:#ffffff;display:inline-block;font-weight:700;padding:12px 18px;text-decoration:none;">
              Revisar y responder cotizaci&oacute;n
            </a>
          </div>
          ${
            companyContact || companyAddress
              ? `<div style="border-top:1px solid #e5e7eb;margin-top:18px;padding-top:14px;color:#475569;">
                  <strong style="color:#334155;">Contacto ${escapeHtml(brand)}</strong>
                  ${companyContact ? `<p style="margin:6px 0 0;">${escapeHtml(companyContact)}</p>` : ""}
                  ${companyAddress ? `<p style="margin:4px 0 0;">${escapeHtml(companyAddress)}</p>` : ""}
                </div>`
              : ""
          }
          <p style="border-top:1px solid #e5e7eb;color:#64748b;font-size:12px;margin:18px 0 0;padding-top:12px;">
            Este correo fue generado desde ValoraCloud.
          </p>
        </div>
      </div>
    </body>
  </html>`;
}

async function sendEmailWithResend({
  apiKey,
  from,
  to,
  subject,
  html,
  text,
  attachments = [],
}) {
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    html,
    text,
    attachments,
  });

  if (error) {
    const message =
      error.message ||
      error.name ||
      "El proveedor de correo rechazo el envio.";
    throw new Error(message);
  }

  return data || {};
}

exports.sendQuoteEmail = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    secrets: [RESEND_API_KEY_SECRET, RESEND_FROM_EMAIL_SECRET],
    timeoutSeconds: 60,
  },
  async (request) =>
    sendQuoteEmailHandler(request, {
      ...businessOnboardingDependencies,
      buildPlainQuoteEmail,
      buildQuoteEmailHtml,
      buildQuoteEmissionPatch,
      createPublicQuoteToken,
      getCompanyProfileForQuote,
      getPublicBaseUrl,
      getQuoteEmailSender,
      getResendApiKey,
      isEmulatorEnvironment,
      normalizePdfAttachment,
      requireBusinessAccess: requireOperationalBusinessAccess,
      safeText,
      sendQuoteEmailWithProvider: sendEmailWithResend,
      Timestamp,
    })
);

exports.crearCompraDesdeRecepcion = onCall(
  {maxInstances: 20, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => crearCompraDesdeRecepcionHandler(request, purchasePersistenceDependencies)
);

exports.sendPurchaseOrderEmail = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    secrets: [RESEND_API_KEY_SECRET, RESEND_FROM_EMAIL_SECRET],
    timeoutSeconds: 60,
  },
  async (request) =>
    sendPurchaseOrderEmailHandler(request, {
      ...businessOnboardingDependencies,
      escapeHtml,
      getCompanyProfile: getCompanyProfileForQuote,
      getEmailSender: getQuoteEmailSender,
      getResendApiKey,
      isEmulatorEnvironment,
      normalizePdfAttachment,
      requireBusinessAccess: requireOperationalBusinessAccess,
      sendEmailWithProvider: sendEmailWithResend,
    })
);

exports.getPublicQuoteProposal = onCall(
  {
    maxInstances: 20,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    getPublicQuoteProposalHandler(request, {
      db,
      FieldValue,
      HttpsError,
      Timestamp,
    })
);

exports.respondPublicQuoteProposal = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    respondPublicQuoteProposalHandler(request, {
      db,
      FieldValue,
      HttpsError,
      Timestamp,
    })
);

exports.prepareQuoteWhatsAppShare = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    prepareQuoteWhatsAppShareHandler(request, {
      ...businessOnboardingDependencies,
      getPublicBaseUrl,
      requireBusinessAccess: requireOperationalBusinessAccess,
      Timestamp,
    })
);

exports.markQuoteEmittedManually = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    markQuoteEmittedManuallyHandler(request, {
      ...businessOnboardingDependencies,
      requireBusinessAccess: requireOperationalBusinessAccess,
    })
);

exports.transitionQuoteStatus = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    transitionQuoteStatusHandler(request, {
      ...businessOnboardingDependencies,
      buildQuoteEmissionPatch,
      requireBusinessAccess: requireOperationalBusinessAccess,
    })
);

exports.reopenQuote = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    reopenQuoteHandler(request, {
      ...businessOnboardingDependencies,
      getPublicBaseUrl,
      requireBusinessAccess: requireOperationalBusinessAccess,
      Timestamp,
    })
);

exports.confirmQuoteWhatsAppSent = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    confirmQuoteWhatsAppSentHandler(request, {
      ...businessOnboardingDependencies,
      requireBusinessAccess: requireOperationalBusinessAccess,
      Timestamp,
    })
);

exports.expirePublicQuoteProposals = onSchedule(
  {
    maxInstances: 1,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    schedule: "every 1 hours",
    timeZone: "America/Santiago",
    timeoutSeconds: 300,
  },
  async () => {
    const result = await expirePublicQuoteProposalsHandler({
      db,
      FieldValue,
      Timestamp,
    });
    console.log("Vencimiento de propuestas públicas completado.", result);
  }
);

function parseChileanMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  let clean = text.replace(/[^\d,.-]/g, "");
  if (!clean || !/\d/.test(clean)) return null;

  const negative = clean.startsWith("-");
  clean = clean.replace(/-/g, "");

  const dotCount = (clean.match(/\./g) || []).length;
  const commaCount = (clean.match(/,/g) || []).length;
  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");
  let normalized = clean;

  if (dotCount && commaCount) {
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    const thousandsSeparator = decimalSeparator === "." ? "," : ".";
    const decimalPart = clean.slice(clean.lastIndexOf(decimalSeparator) + 1);
    normalized = clean.split(thousandsSeparator).join("");
    if (decimalPart.length <= 2) {
      normalized = normalized.replace(decimalSeparator, ".");
    } else {
      normalized = normalized.split(decimalSeparator).join("");
    }
  } else if (dotCount || commaCount) {
    const separator = dotCount ? "." : ",";
    const parts = clean.split(separator);

    if (parts.length > 2) {
      normalized = parts.join("");
    } else {
      const [integerPart, fractionalPart = ""] = parts;
      if (fractionalPart.length === 3 && integerPart.length >= 1) {
        normalized = `${integerPart}${fractionalPart}`;
      } else if (fractionalPart.length > 0 && fractionalPart.length <= 2) {
        normalized = `${integerPart}.${fractionalPart}`;
      } else {
        normalized = parts.join("");
      }
    }
  }

  const parsed = Number(`${negative ? "-" : ""}${normalized}`);

  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function parseOptionalPositiveNumber(value) {
  const parsed = parseChileanMoney(value);
  return parsed === null ? null : parsed;
}

function parseOptionalPositiveDecimal(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? Math.round(value * 100) / 100
      : null;
  }

  const clean = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(clean);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function normalizeImportQuantity(value) {
  const parsed = parseOptionalPositiveDecimal(value);
  return parsed && parsed > 0 ? parsed : 1;
}

function calculateImportMarginFromPrice(costoBase, precioVenta) {
  if (
    !Number.isFinite(costoBase) ||
    costoBase <= 0 ||
    !Number.isFinite(precioVenta) ||
    precioVenta <= 0
  ) {
    return null;
  }
  return Math.round(((precioVenta - costoBase) / costoBase) * 10000) / 100;
}

function normalizeImportConfidence(value) {
  const parsed = parseOptionalPositiveDecimal(value);
  if (parsed === null) return null;
  if (parsed >= 0 && parsed <= 1) return Math.round(parsed * 10000) / 100;
  if (parsed > 1 && parsed <= 100) return parsed;
  return null;
}

function normalizeWarningKey(value) {
  return normalizeSearchText(value).replace(/\s+/g, " ");
}

function dedupeImportWarnings(warnings) {
  const seen = new Set();
  return (Array.isArray(warnings) ? warnings : warnings ? [warnings] : [])
    .map((warning) => safeText(warning, 180))
    .filter(Boolean)
    .filter((warning) => {
      const key = normalizeWarningKey(warning);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeInventoryImportType(value, fallbackText = "") {
  const explicit = normalizeDirectHeaderKey(value);
  if (ALLOWED_QUOTE_ITEM_TYPES.includes(explicit)) return explicit;

  const normalized = normalizeSearchText(`${value || ""} ${fallbackText || ""}`);

  if (
    normalized.includes("instalacion") ||
    normalized.includes("configuracion") ||
    normalized.includes("mantencion") ||
    normalized.includes("soporte") ||
    normalized.includes("servicio")
  ) {
    return "servicio";
  }
  if (
    normalized.includes("hora") ||
    normalized.includes("visita") ||
    normalized.includes("traslado") ||
    normalized.includes("actividad")
  ) {
    return "actividad";
  }
  return "producto";
}

function defaultUnitForInventoryImport(tipoItem, text = "") {
  const normalized = normalizeSearchText(text);
  if (normalized.includes("hora")) return "hora";
  if (normalized.includes("metro")) return "metro";
  if (normalized.includes("visita")) return "visita";
  if (tipoItem === "servicio") return "servicio";
  if (tipoItem === "actividad") return "servicio";
  return "unidad";
}

function calculateInventoryImportPrice(costoBase, margenDeseado) {
  const cost = Number(costoBase || 0);
  const margin = Number(margenDeseado || 0);
  if (!Number.isFinite(cost) || !Number.isFinite(margin)) return 0;
  return Math.round(cost + (cost * margin) / 100);
}

function normalizeInventoryImportItem(rawItem, index = 0) {
  const sourceText = `${rawItem?.nombre || ""} ${rawItem?.descripcion || ""} ${
    rawItem?.observacion || rawItem?.justificacion || ""
  }`;
  const nombre = safeText(rawItem?.nombre || rawItem?.name, 140);
  const tipoItem = normalizeInventoryImportType(
    rawItem?.tipoItem || rawItem?.tipo,
    sourceText
  );
  const costoBase =
    parseOptionalPositiveNumber(
      rawItem?.costoBase ??
        rawItem?.costoEstimado ??
        rawItem?.costoUnitario ??
        rawItem?.precioCompra
    ) ?? 0;
  const precioVentaExplicito = parseOptionalPositiveNumber(
    rawItem?.precioInterno ??
      rawItem?.precioInternoSugerido ??
      rawItem?.precioVenta ??
      rawItem?.precioSugerido
  );
  const margenExplicito = parseOptionalPositiveDecimal(
    rawItem?.margenDeseado ??
      rawItem?.margenSugerido ??
      rawItem?.margenPorDefecto
  );
  let margenDeseado = margenExplicito;
  const advertencias = dedupeImportWarnings(rawItem?.advertencias || rawItem?.warnings);

  if (margenDeseado === null) {
    margenDeseado = calculateImportMarginFromPrice(costoBase, precioVentaExplicito);
  }
  if (margenDeseado === null) {
    margenDeseado = DEFAULT_INVENTORY_IMPORT_MARGIN;
    advertencias.push(DEFAULT_MARGIN_WARNING);
  }

  const cantidadSugerida = normalizeImportQuantity(
    rawItem?.cantidadSugerida ?? rawItem?.cantidad
  );
  const confianzaBase = normalizeImportConfidence(
    rawItem?.confianza ?? rawItem?.nivelConfianza
  );
  const observacion = safeText(
    rawItem?.observacion || rawItem?.justificacion || rawItem?.nota,
    280
  );
  const unidad =
    safeText(rawItem?.unidad, 40) ||
    defaultUnitForInventoryImport(tipoItem, sourceText);

  const hasReliableCost = costoBase > 0;
  const confianza = hasReliableCost
    ? confianzaBase
    : confianzaBase === null
      ? null
      : Math.min(confianzaBase, 45);
  const itemWarnings = dedupeImportWarnings(advertencias);
  const areaPropuesta = safeText(
    rawItem?.areaPropuesta || rawItem?.areaNombre || rawItem?.area,
    90
  );
  const categoriaPropuesta = safeText(
    rawItem?.categoriaPropuesta || rawItem?.categoriaNombre || rawItem?.categoria,
    90
  );
  const productFields =
    tipoItem === "producto"
      ? {
          marca: safeText(rawItem?.marca, 100),
          modelo: safeText(rawItem?.modelo, 100),
          stock: parseOptionalPositiveDecimal(
            rawItem?.stock ?? rawItem?.stockActual ?? rawItem?.cantidadSugerida
          ),
          stockMinimo: parseOptionalPositiveDecimal(
            rawItem?.stockMinimo ?? rawItem?.stockMin
          ),
          codigoBarras: safeText(
            rawItem?.codigoBarras || rawItem?.ean || rawItem?.upc,
            120
          ),
        }
      : {};

  return {
    id: safeText(rawItem?.id, 80) || `normalizado-${index + 1}`,
    nombre,
    sku: safeText(rawItem?.sku || rawItem?.codigo, 80),
    codigo: safeText(rawItem?.codigo || rawItem?.sku, 80),
    tipoItem,
    areaPropuesta,
    categoriaPropuesta,
    descripcion: safeText(rawItem?.descripcion, 300),
    unidad,
    cantidadSugerida,
    costoBase,
    margenDeseado,
    precioInterno: calculateInventoryImportPrice(costoBase, margenDeseado),
    observacion:
      observacion ||
      (hasReliableCost
        ? "Dato normalizado desde el texto ingresado."
        : "No se detecto costo confiable. Revisa este valor antes de guardar."),
    advertencias: itemWarnings,
    confianza,
    ...productFields,
  };
}

function sanitizeInventoryImportPayload(payload) {
  const sourceItems = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.normalizedItems)
      ? payload.normalizedItems
      : [];

  return sourceItems
    .map((item, index) => normalizeInventoryImportItem(item, index))
    .filter((item) => item.nombre);
}

function findCurrencyAmountFromLine(line) {
  const currencyMatches = String(line || "").match(
    /(?:\$|CLP\s*)\s*\d[\d.,]*/gi
  );
  if (currencyMatches && currencyMatches.length) {
    return parseChileanMoney(currencyMatches[currencyMatches.length - 1]);
  }

  const labeledAmount = String(line || "").match(
    /(?:precio|valor|costo|neto|unitario)\s*:?\s*(\d[\d.,]*)/i
  );
  if (labeledAmount) return parseChileanMoney(labeledAmount[1]);

  return null;
}

function findQuantityFromLine(line) {
  const text = String(line || "");
  const explicit = text.match(/(?:cantidad|cant\.?|x)\s*:?\s*(\d+)/i);
  if (explicit) return parseOptionalPositiveNumber(explicit[1]);

  const hours = text.match(/\b(\d+)\s*(?:horas?|hrs?)\b/i);
  if (hours) return parseOptionalPositiveNumber(hours[1]);

  return null;
}

function cleanInventoryImportName(line) {
  const firstPart = String(line || "").split(",")[0] || "";
  return safeText(
    firstPart
      .replace(/^\s*[-*]\s*/, "")
      .replace(/(?:cantidad|cant\.?|x)\s*:?\s*\d+/gi, "")
      .replace(/(?:\$|CLP\s*)\s*\d[\d.,]*/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
    140
  );
}

function normalizeHeaderText(value) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeDirectHeaderKey(value) {
  return normalizeSearchText(value)
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const INVENTORY_DIRECT_HEADER_ALIASES = {
  sku: ["sku", "codigo", "codigo_sku"],
  nombre: ["nombre", "item", "producto", "servicio", "nombre_item"],
  tipo: ["tipo", "tipo_item", "clase"],
  area: ["area", "area_inventario"],
  categoria: ["categoria", "rubro"],
  descripcion: ["descripcion", "detalle"],
  unidad: ["unidad", "unidad_medida", "medida"],
  costo_base: ["costo_base", "costo", "costo_unitario"],
  margen: ["margen", "margen_porcentaje", "margen_%"],
  precio_interno: ["precio_interno", "precio", "precio_venta", "valor"],
  observacion: ["observacion", "notas", "nota"],
  marca: ["marca", "fabricante"],
  modelo: ["modelo", "modelo_producto"],
  stock: ["stock", "stock_actual", "existencia"],
  stock_minimo: ["stock_minimo", "stock_min", "minimo"],
  codigo_barras: ["codigo_barras", "ean", "upc"],
};

const INVENTORY_DIRECT_ALIAS_TO_FIELD = Object.entries(
  INVENTORY_DIRECT_HEADER_ALIASES
).reduce((aliases, [field, values]) => {
  values.forEach((value) => {
    aliases.set(normalizeDirectHeaderKey(value), field);
  });
  return aliases;
}, new Map());

function buildDirectHeaderMap(headers) {
  const headerMap = {};

  headers.forEach((header, index) => {
    const key = normalizeDirectHeaderKey(header);
    const field = INVENTORY_DIRECT_ALIAS_TO_FIELD.get(key);
    if (field && headerMap[field] === undefined) {
      headerMap[field] = index;
    }
  });

  return headerMap;
}

function getMappedCell(cells, headerMap, field) {
  const index = headerMap[field];
  return index === undefined ? "" : getCell(cells, index);
}

function hasDirectInventoryHeaders(headerMap) {
  return Boolean(
    headerMap.nombre !== undefined &&
      [
        "sku",
        "tipo",
        "area",
        "categoria",
        "descripcion",
        "unidad",
        "costo_base",
        "margen",
        "precio_interno",
        "observacion",
        "marca",
        "modelo",
        "stock",
        "stock_minimo",
        "codigo_barras",
      ].some((field) => headerMap[field] !== undefined)
  );
}

function normalizeExplicitInventoryType(value, fallbackText = "") {
  const explicit = normalizeDirectHeaderKey(value);
  if (ALLOWED_QUOTE_ITEM_TYPES.includes(explicit)) return explicit;
  return normalizeInventoryImportType("", fallbackText);
}

function getFileRows(fileData) {
  if (!fileData || !Array.isArray(fileData.hojas)) return [];

  return fileData.hojas.flatMap((sheet) =>
    (Array.isArray(sheet.filas) ? sheet.filas : []).map((row) => ({
      sheetName: safeText(sheet.nombreHoja, 80),
      cells: Array.isArray(row)
        ? row.map((cell) => String(cell ?? "").trim())
        : Object.values(row || {}).map((cell) => String(cell ?? "").trim()),
    }))
  );
}

function validateInventoryFileData(fileData) {
  if (!fileData || !Array.isArray(fileData.hojas)) {
    throw new HttpsError(
      "invalid-argument",
      "El archivo no contiene hojas legibles."
    );
  }
  if (fileData.hojas.length === 0 || fileData.hojas.length > MAX_INVENTORY_IMPORT_SHEETS) {
    throw new HttpsError(
      "invalid-argument",
      "El archivo debe contener entre 1 y 8 hojas."
    );
  }

  let totalRows = 0;
  fileData.hojas.forEach((sheet) => {
    if (!Array.isArray(sheet?.filas)) {
      throw new HttpsError(
        "invalid-argument",
        "El archivo contiene una hoja invalida."
      );
    }
    totalRows += sheet.filas.length;
    sheet.filas.forEach((row) => {
      if (!Array.isArray(row) || row.length > MAX_INVENTORY_IMPORT_COLUMNS) {
        throw new HttpsError(
          "invalid-argument",
          "El archivo contiene una fila invalida o demasiado extensa."
        );
      }
      if (
        row.some(
          (cell) => String(cell ?? "").length > MAX_INVENTORY_IMPORT_CELL_LENGTH
        )
      ) {
        throw new HttpsError(
          "invalid-argument",
          "El archivo contiene celdas demasiado extensas."
        );
      }
    });
  });

  if (totalRows === 0 || totalRows > MAX_INVENTORY_IMPORT_ROWS) {
    throw new HttpsError(
      "invalid-argument",
      "El archivo debe contener entre 1 y 500 filas."
    );
  }
}

function fileDataToText(fileData) {
  const rows = getFileRows(fileData);
  const lines = [
    `Archivo: ${safeText(fileData?.nombreArchivo, 120)}`,
    ...rows.slice(0, 120).map((row) => {
      const content = row.cells.filter(Boolean).join(" | ");
      return row.sheetName ? `[${row.sheetName}] ${content}` : content;
    }),
  ];

  return lines.join("\n").slice(0, MAX_INVENTORY_IMPORT_TEXT_LENGTH);
}

function findHeaderRowIndex(rows) {
  let best = { index: -1, score: 0 };
  rows.slice(0, 12).forEach((row, index) => {
    const directHeaderMap = buildDirectHeaderMap(row.cells);
    const directScore = Object.keys(directHeaderMap).length;
    const text = row.cells.map(normalizeHeaderText).join(" ");
    const score = [
      "tipo",
      "categoria",
      "descripcion",
      "producto",
      "item",
      "cantidad",
      "cant",
      "valor unitario",
      "precio",
      "neto",
      "sku",
      "codigo",
      "unidad",
      "total",
    ].reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), directScore);
    if (score > best.score) best = { index, score };
  });
  return best.score >= 2 ? best.index : -1;
}

function findColumnIndex(headers, candidates) {
  const normalizedHeaders = headers.map(normalizeHeaderText);
  return normalizedHeaders.findIndex((header) =>
    candidates.some((candidate) => header.includes(normalizeHeaderText(candidate)))
  );
}

function isReliablePriceHeader(header) {
  const normalized = normalizeHeaderText(header);
  if (!normalized) return false;

  return [
    "precio",
    "precio unitario",
    "valor",
    "valor unitario",
    "costo",
    "costo base",
    "costo unitario",
    "neto",
    "neto unitario",
    "unitario",
    "total unitario",
  ].some((candidate) => normalized.includes(normalizeHeaderText(candidate)));
}

function getCell(cells, index) {
  return index >= 0 ? String(cells[index] || "").trim() : "";
}

function buildDirectInventoryImportItemsFromFile(fileData) {
  const rows = getFileRows(fileData).filter((row) =>
    row.cells.some((cell) => String(cell || "").trim())
  );
  if (!rows.length) return null;

  const headerIndex = findHeaderRowIndex(rows);
  if (headerIndex < 0) return null;

  const headers = rows[headerIndex].cells;
  const headerMap = buildDirectHeaderMap(headers);
  if (!hasDirectInventoryHeaders(headerMap)) return null;

  const items = rows
    .slice(headerIndex + 1)
    .filter((row) => row.cells.some(Boolean))
    .map((row, index) => {
      const cells = row.cells;
      const nombre = safeText(getMappedCell(cells, headerMap, "nombre"), 140);
      if (!nombre) return null;

      const sourceText = `${nombre} ${getMappedCell(
        cells,
        headerMap,
        "descripcion"
      )} ${getMappedCell(cells, headerMap, "observacion")}`;
      const costoBase =
        parseOptionalPositiveNumber(getMappedCell(cells, headerMap, "costo_base")) ??
        0;
      const precioInternoExplicito = parseOptionalPositiveNumber(
        getMappedCell(cells, headerMap, "precio_interno")
      );
      const margenExplicito = parseOptionalPositiveDecimal(
        getMappedCell(cells, headerMap, "margen")
      );
      let margenDeseado =
        margenExplicito ?? calculateImportMarginFromPrice(costoBase, precioInternoExplicito);
      const advertencias = [];
      if (margenDeseado === null) {
        margenDeseado = DEFAULT_INVENTORY_IMPORT_MARGIN;
        advertencias.push(DEFAULT_MARGIN_WARNING);
      }
      const tipoItem = normalizeExplicitInventoryType(
        getMappedCell(cells, headerMap, "tipo"),
        sourceText
      );
      const categoria = safeText(
        getMappedCell(cells, headerMap, "categoria"),
        90
      );
      const unidad = safeText(getMappedCell(cells, headerMap, "unidad"), 40);
      const observacion = safeText(
        getMappedCell(cells, headerMap, "observacion"),
        500
      );

      return {
        id: `archivo-directo-${index + 1}`,
        nombre,
        sku: safeText(getMappedCell(cells, headerMap, "sku"), 80),
        codigo: safeText(getMappedCell(cells, headerMap, "sku"), 80),
        tipoItem,
        areaPropuesta: safeText(
          getMappedCell(cells, headerMap, "area"),
          90
        ),
        categoriaPropuesta: categoria,
        descripcion: safeText(
          getMappedCell(cells, headerMap, "descripcion"),
          1000
        ),
        unidad: unidad || defaultUnitForInventoryImport(tipoItem, sourceText),
        cantidadSugerida: 1,
        costoBase,
        margenDeseado,
        precioInterno: calculateInventoryImportPrice(costoBase, margenDeseado),
        observacion,
        advertencias,
        confianza: 95,
        ...(tipoItem === "producto"
          ? {
              marca: safeText(getMappedCell(cells, headerMap, "marca"), 100),
              modelo: safeText(getMappedCell(cells, headerMap, "modelo"), 100),
              stock: parseOptionalPositiveDecimal(
                getMappedCell(cells, headerMap, "stock")
              ),
              stockMinimo: parseOptionalPositiveDecimal(
                getMappedCell(cells, headerMap, "stock_minimo")
              ),
              codigoBarras: safeText(
                getMappedCell(cells, headerMap, "codigo_barras"),
                120
              ),
            }
          : {}),
      };
    })
    .filter(Boolean);

  if (!items.length) return null;

  return {
    items,
    source: "local",
    mode: "deterministic-headers",
    warning:
      "Se detectaron encabezados reconocidos. Los datos fueron importados directamente desde el archivo.",
  };
}

function findMatchingInventoryImportItem(items, baseItem, index) {
  const baseSku = normalizeDirectHeaderKey(baseItem.sku || baseItem.codigo);
  const baseName = normalizeDirectHeaderKey(baseItem.nombre);

  if (baseSku) {
    const bySku = items.find(
      (item) => normalizeDirectHeaderKey(item.sku || item.codigo) === baseSku
    );
    if (bySku) return bySku;
  }

  if (baseName) {
    const byName = items.find(
      (item) => normalizeDirectHeaderKey(item.nombre) === baseName
    );
    if (byName) return byName;
  }

  return items[index] || null;
}

function mergeInventoryImportItems(baseItems, suggestedItems) {
  const suggestions = Array.isArray(suggestedItems) ? suggestedItems : [];

  return baseItems.map((baseItem, index) => {
    const suggestion = findMatchingInventoryImportItem(suggestions, baseItem, index);
    if (!suggestion) return baseItem;

    const merged = {
      ...baseItem,
      areaPropuesta:
        baseItem.areaPropuesta || suggestion.areaPropuesta || suggestion.area || "",
      categoriaPropuesta:
        baseItem.categoriaPropuesta ||
        suggestion.categoriaPropuesta ||
        suggestion.categoria ||
        "",
      descripcion: baseItem.descripcion || suggestion.descripcion || "",
      unidad: baseItem.unidad || suggestion.unidad || "",
      observacion: baseItem.observacion || suggestion.observacion || "",
      cantidadSugerida:
        baseItem.cantidadSugerida ?? suggestion.cantidadSugerida ?? null,
      confianza: Math.max(
        Number(baseItem.confianza || 0),
        Number(suggestion.confianza || 0)
      ),
    };

    if (merged.tipoItem === "producto") {
      merged.marca = baseItem.marca || suggestion.marca || "";
      merged.modelo = baseItem.modelo || suggestion.modelo || "";
      merged.stock = baseItem.stock ?? suggestion.stock ?? null;
      merged.stockMinimo =
        baseItem.stockMinimo ?? suggestion.stockMinimo ?? null;
      merged.codigoBarras =
        baseItem.codigoBarras || suggestion.codigoBarras || "";
    } else {
      delete merged.marca;
      delete merged.modelo;
      delete merged.stock;
      delete merged.stockMinimo;
      delete merged.codigoBarras;
    }

    if (!baseItem.tipoItem && suggestion.tipoItem) {
      merged.tipoItem = suggestion.tipoItem;
    }
    if (Number(baseItem.costoBase || 0) <= 0 && Number(suggestion.costoBase || 0) > 0) {
      merged.costoBase = suggestion.costoBase;
    }
    if (
      Number(baseItem.margenDeseado || 0) <= 0 &&
      Number(suggestion.margenDeseado || 0) > 0
    ) {
      merged.margenDeseado = suggestion.margenDeseado;
    }

    merged.precioInterno = calculateInventoryImportPrice(
      merged.costoBase,
      merged.margenDeseado
    );
    return merged;
  });
}

function buildLocalInventoryImportFallbackFromFile(fileData, options = {}) {
  const rows = getFileRows(fileData).filter((row) =>
    row.cells.some((cell) => String(cell || "").trim())
  );
  if (!rows.length) {
    return buildLocalInventoryImportFallback("", options);
  }

  const directResult = buildDirectInventoryImportItemsFromFile(fileData);
  if (directResult) {
    return {
      ...directResult,
      mode: options.mode || directResult.mode,
      warning: options.warning || directResult.warning,
    };
  }

  const headerIndex = findHeaderRowIndex(rows);
  const headers = headerIndex >= 0 ? rows[headerIndex].cells : [];
  const dataRows = rows
    .slice(headerIndex >= 0 ? headerIndex + 1 : 0)
    .filter((row) => row.cells.some(Boolean));

  const nameIndex = findColumnIndex(headers, [
    "descripcion",
    "descripción",
    "producto",
    "item",
    "articulo",
    "artículo",
    "detalle",
    "nombre",
  ]);
  const skuIndex = findColumnIndex(headers, ["sku", "codigo", "código", "cod"]);
  const qtyIndex = findColumnIndex(headers, ["cantidad", "cant", "qty", "unidades"]);
  const unitIndex = findColumnIndex(headers, ["unidad", "u medida", "medida"]);
  const unitPriceIndex = findColumnIndex(headers, [
    "valor unitario",
    "precio unitario",
    "neto unitario",
    "costo unitario",
    "unitario",
    "precio",
    "neto",
  ]);
  const totalIndex = findColumnIndex(headers, [
    "total",
    "subtotal",
    "importe",
    "valor total",
    "neto total",
  ]);

  const items = dataRows
    .map((row, index) => {
      const cells = row.cells;
      const line = cells.filter(Boolean).join(" ");
      const inferredName =
        getCell(cells, nameIndex) ||
        cells.find((cell) => /[A-Za-z]{3,}/.test(cell) && !/^\d/.test(cell)) ||
        "";
      const cantidad = parseOptionalPositiveNumber(getCell(cells, qtyIndex)) || null;
      const hasReliableUnitPrice =
        unitPriceIndex >= 0 && isReliablePriceHeader(headers[unitPriceIndex]);
      const hasReliableTotal =
        totalIndex >= 0 && isReliablePriceHeader(headers[totalIndex]);
      const unitPrice = hasReliableUnitPrice
        ? parseChileanMoney(getCell(cells, unitPriceIndex))
        : null;
      const total = hasReliableTotal
        ? parseChileanMoney(getCell(cells, totalIndex))
        : null;
      const costoBase =
        unitPrice !== null
          ? unitPrice
          : total !== null && cantidad
            ? Math.round(total / cantidad)
            : 0;
      const tipoItem = normalizeInventoryImportType("", inferredName || line);
      const missingReliableCost = costoBase <= 0;

      return normalizeInventoryImportItem(
        {
          id: `archivo-local-${index + 1}`,
          nombre: safeText(inferredName, 140),
          sku: getCell(cells, skuIndex),
          tipoItem,
          areaPropuesta: "",
          categoriaPropuesta: "",
          descripcion: headerIndex >= 0 ? "" : safeText(line, 220),
          unidad: getCell(cells, unitIndex) || defaultUnitForInventoryImport(tipoItem, line),
          cantidadSugerida: cantidad,
          costoBase,
          margenSugerido: DEFAULT_INVENTORY_IMPORT_MARGIN,
          observacion:
            unitPrice !== null
              ? "Costo base detectado desde valor unitario."
              : total !== null && cantidad
                ? "Costo base calculado desde total dividido por cantidad."
                : "No se detecto costo confiable. Revisa este valor antes de guardar.",
          confianza: missingReliableCost ? 35 : headerIndex >= 0 ? 65 : 45,
        },
        index
      );
    })
    .filter((item) => item.nombre);

  return {
    items,
    source: "local",
    mode: options.mode || "local-file-fallback",
    warning:
      options.warning ||
      INVENTORY_LOCAL_FALLBACK_WARNING,
  };
}

function buildLocalInventoryImportFallback(input, options = {}) {
  if (input && typeof input === "object") {
    return buildLocalInventoryImportFallbackFromFile(input, options);
  }

  const text = String(input || "");
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4)
    .filter((line) => !/^factura|^cotizacion|^proveedor|^total\b/i.test(line));

  const items = lines
    .map((line, index) => {
      const nombre = cleanInventoryImportName(line);
      const tipoItem = normalizeInventoryImportType("", line);
      const costoBase = findCurrencyAmountFromLine(line) ?? 0;
      const cantidadSugerida = findQuantityFromLine(line);

      return normalizeInventoryImportItem(
        {
          id: `local-${index + 1}`,
          nombre,
          tipoItem,
          areaPropuesta: "",
          categoriaPropuesta: "",
          descripcion: "",
          unidad: defaultUnitForInventoryImport(tipoItem, line),
          cantidadSugerida,
          costoBase,
          margenSugerido: DEFAULT_INVENTORY_IMPORT_MARGIN,
          observacion:
            costoBase > 0
              ? "Extraido con fallback local; revisar valor detectado."
              : "Fallback local sin costo claro; completar manualmente.",
          confianza: costoBase > 0 ? 45 : 25,
        },
        index
      );
    })
    .filter((item) => item.nombre);

  return {
    items,
    source: "local",
    mode: options.mode || "local-fallback",
    warning:
      options.warning ||
      INVENTORY_LOCAL_FALLBACK_WARNING,
  };
}

function buildInventoryImportPrompt(text, deterministicItems = []) {
  const deterministicBlock = deterministicItems.length
    ? `\n\nBase deterministica ya detectada desde encabezados. Debes conservar la misma cantidad de filas y no modificar SKU, nombre, tipoItem, areaPropuesta, categoriaPropuesta, descripcion, unidad, costoBase, margenDeseado ni campos explícitos de Producto cuando ya tengan valor:\n${JSON.stringify(
        { items: deterministicItems },
        null,
        2
      ).slice(0, 12000)}\n`
    : "";

  return (
    "Eres un asistente para normalizar inventario en ValoraCloud.\n" +
    "Recibiras contenido extraido de archivos Excel/CSV, facturas, cotizaciones de proveedor, listas de precios o inventario desordenado.\n\n" +
    "Reglas estrictas:\n" +
    "- Devuelve todos los items detectados; no elimines filas validas.\n" +
    "- Si recibes una base deterministica, usala como verdad principal y solo completa campos ausentes.\n" +
    "- Usa solo tipoItem: producto, servicio o actividad.\n" +
    "- Si hay cantidad y valor unitario, usa valor unitario como costoBase.\n" +
    "- Si hay total y cantidad, calcula costoBase como total / cantidad.\n" +
    "- Si hay SKU o codigo, devuelvelo en sku.\n" +
    "- Si no existe costo claro, usa 0 y explica en observacion.\n" +
    "- Propón areaPropuesta y categoriaPropuesta solo por nombre cuando estén explícitas o sean claras; nunca inventes IDs persistentes.\n" +
    "- Si Área o Categoría no están claras, usa una cadena vacía para que el usuario las corrija.\n" +
    "- Para Producto incluye marca, modelo, stock y stockMinimo cuando estén disponibles; codigoBarras es opcional.\n" +
    "- Para Servicio o Actividad no devuelvas marca, modelo, stock, stockMinimo ni codigoBarras.\n" +
    "- No reemplaces categorias, tipos, unidades, costos ni margenes que vengan explicitamente en columnas reconocidas.\n" +
    "- No inventes datos con seguridad; deja valores editables y baja confianza.\n" +
    "- margenSugerido debe ser porcentaje y puede tener hasta dos decimales; usa 25 si no hay dato claro.\n" +
    "- precioInternoSugerido debe ser costoBase + margen si hay costo; si no, 0.\n" +
    "- confianza debe ser un numero de 0 a 100.\n" +
    "- Responde solo JSON valido, sin markdown ni explicaciones externas.\n\n" +
    "Formato exacto:\n" +
    "{\n" +
    '  "items": [\n' +
    "    {\n" +
    '      "nombre": "Notebook Lenovo ThinkPad E14",\n' +
    '      "tipoItem": "producto",\n' +
    '      "areaPropuesta": "Informática",\n' +
    '      "categoriaPropuesta": "Hardware",\n' +
    '      "descripcion": "",\n' +
    '      "unidad": "unidad",\n' +
    '      "marca": "Lenovo",\n' +
    '      "modelo": "ThinkPad E14",\n' +
    '      "stock": 2,\n' +
    '      "stockMinimo": 1,\n' +
    '      "codigoBarras": null,\n' +
    '      "cantidadSugerida": 2,\n' +
    '      "costoBase": 650000,\n' +
    '      "margenSugerido": 25,\n' +
    '      "precioInternoSugerido": 812500,\n' +
    '      "observacion": "Valor unitario detectado desde la linea.",\n' +
    '      "confianza": 85\n' +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "Contenido de archivo a normalizar:\n" +
    text +
    deterministicBlock
  );
}

const inventoryModelDependencies = {
  db,
  HttpsError,
  FieldValue,
  requireBusinessAccess: requireOperationalBusinessAccess,
};
const businessOnboardingDependencies = {
  auth: adminAuth,
  db,
  HttpsError,
  FieldValue,
};
const businessSettingsDependencies = {
  db,
  HttpsError,
  FieldValue,
  requireBusinessAccess,
  validateBusinessProfileInput,
};
const operationalBusinessSettingsDependencies = {
  ...businessSettingsDependencies,
  requireBusinessAccess: requireOperationalBusinessAccess,
};
const businessVerificationDependencies = {
  bucket: adminStorageBucket,
  db,
  HttpsError,
  FieldValue,
  requireBusinessAccess,
};
const platformAdminDependencies = {
  auth: adminAuth,
  bucket: adminStorageBucket,
  db,
  FieldPath,
  FieldValue,
  HttpsError,
};
const businessMembershipDependencies = {
  db,
  auth: adminAuth,
  HttpsError,
  FieldValue,
  requireBusinessAccess: requireOperationalBusinessAccess,
};

exports.getBusinessSession = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    getBusinessSessionHandler(request, businessOnboardingDependencies)
);

exports.createFirstBusiness = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    createFirstBusinessHandler(request, businessOnboardingDependencies)
);

exports.createAdditionalBusiness = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    createAdditionalBusinessHandler(request, businessOnboardingDependencies)
);

exports.deleteBusiness = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    deleteBusinessHandler(request, businessOnboardingDependencies)
);

exports.setActiveBusiness = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    setActiveBusinessHandler(request, businessOnboardingDependencies)
);

exports.updateBusinessProfile = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    updateBusinessProfileHandler(request, businessOnboardingDependencies)
);

exports.updateBusinessInformation = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    updateBusinessInformationHandler(request, businessSettingsDependencies)
);

exports.updateBusinessSettings = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    updateBusinessSettingsHandler(request, operationalBusinessSettingsDependencies)
);

exports.updatePersonalProfile = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    updatePersonalProfileHandler(request, businessSettingsDependencies)
);

exports.solicitarVerificacionEmpresa = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    solicitarVerificacionEmpresaHandler(
      request,
      businessVerificationDependencies
    )
);

exports.resolverVerificacionEmpresa = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    resolverVerificacionEmpresaHandler(
      request,
      businessVerificationDependencies
    )
);

exports.obtenerResumenPlataforma = onCall(
  {maxInstances: 10, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => obtenerResumenPlataformaHandler(request, platformAdminDependencies)
);

exports.listarEmpresasPlataforma = onCall(
  {maxInstances: 10, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => listarEmpresasPlataformaHandler(request, platformAdminDependencies)
);

exports.obtenerEmpresaPlataforma = onCall(
  {maxInstances: 10, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => obtenerEmpresaPlataformaHandler(request, platformAdminDependencies)
);

exports.obtenerDocumentoVerificacionPlataforma = onCall(
  {maxInstances: 10, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => obtenerDocumentoVerificacionPlataformaHandler(request, platformAdminDependencies)
);

exports.listarUsuariosPlataforma = onCall(
  {maxInstances: 10, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => listarUsuariosPlataformaHandler(request, platformAdminDependencies)
);

exports.obtenerUsuarioPlataforma = onCall(
  {maxInstances: 10, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => obtenerUsuarioPlataformaHandler(request, platformAdminDependencies)
);

exports.cambiarEstadoEmpresaPlataforma = onCall(
  {maxInstances: 10, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => cambiarEstadoEmpresaPlataformaHandler(request, platformAdminDependencies)
);

exports.cambiarEstadoUsuarioPlataforma = onCall(
  {maxInstances: 10, memory: "256MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 30},
  async (request) => cambiarEstadoUsuarioPlataformaHandler(request, platformAdminDependencies)
);

exports.eliminarEmpresaPermanentePlataforma = onCall(
  {maxInstances: 2, memory: "512MiB", region: DEFAULT_FUNCTION_REGION, timeoutSeconds: 300},
  async (request) => eliminarEmpresaPermanentePlataformaHandler(
    request,
    platformAdminDependencies
  )
);

exports.listarMiembrosNegocio = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    listarMiembrosNegocioHandler(request, businessMembershipDependencies)
);

exports.asociarUsuarioExistente = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    asociarUsuarioExistenteHandler(request, businessMembershipDependencies)
);

exports.actualizarMembresiaNegocio = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    actualizarMembresiaNegocioHandler(request, businessMembershipDependencies)
);

exports.initializeInventoryCatalog = onCall(
  {
    maxInstances: 5,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    initializeInventoryCatalogHandler(request, inventoryModelDependencies)
);

exports.saveInventoryArea = onCall(
  {
    maxInstances: 5,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    saveInventoryAreaHandler(request, inventoryModelDependencies)
);

exports.saveInventoryCategory = onCall(
  {
    maxInstances: 5,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) =>
    saveInventoryCategoryHandler(request, inventoryModelDependencies)
);

exports.createInventoryItemWithCode = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 60,
  },
  async (request) =>
    createInventoryItemWithCodeHandler(request, inventoryModelDependencies)
);

exports.updateInventoryItem = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 60,
  },
  async (request) =>
    updateInventoryItemHandler(request, inventoryModelDependencies)
);

exports.confirmInventoryImportV2 = onCall(
  {
    maxInstances: 10,
    memory: "512MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 120,
  },
  async (request) =>
    confirmInventoryImportV2Handler(request, inventoryModelDependencies)
);

exports.getAiRateLimitStatus = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    timeoutSeconds: 30,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
    }

    const requestedModel = safeText(request.data?.model, 80);
    const allowedModels = Object.values(AI_MODELS);
    if (requestedModel && !allowedModels.includes(requestedModel)) {
      throw new HttpsError("invalid-argument", "Modelo de IA no valido.");
    }

    try {
      if (requestedModel) {
        return await aiRateLimiter.getStatus(requestedModel);
      }
      return { statuses: await aiRateLimiter.getAllStatuses() };
    } catch (error) {
      console.error("Gemini rate-limit status lookup failed", {
        model: requestedModel || "all",
        functionName: "getAiRateLimitStatus",
        code: error?.code || "unknown",
      });
      throw createAiHttpsError({
        allowed: false,
        reason: "provider_error",
        retryAt: null,
        model: requestedModel || null,
        message: "No fue posible comprobar la disponibilidad de IA.",
      });
    }
  }
);

function getInventoryImportRequestRowCount(request) {
  const sheets = Array.isArray(request?.data?.fileData?.hojas)
    ? request.data.fileData.hojas
    : [];
  return sheets.reduce(
    (total, sheet) =>
      total + (Array.isArray(sheet?.filas) ? sheet.filas.length : 0),
    0
  );
}

function withSafeInventoryImportErrors(functionName, handler) {
  return async (request) => {
    const startedAt = Date.now();
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpsError) throw error;

      console.error("Inventory AI callable failed", {
        operation: functionName,
        stage: "handler",
        code: safeText(error?.code || error?.name || "unknown", 80),
        rowCount: getInventoryImportRequestRowCount(request),
        durationMs: Date.now() - startedAt,
        status: "failed",
      });
      throw new HttpsError(
        "internal",
        "No pudimos analizar el archivo por un problema interno del servicio.",
        { internalCode: "inventory_import_internal" }
      );
    }
  };
}

exports.normalizeInventoryItems = onCall(
  {
    maxInstances: 5,
    memory: "512MiB",
    region: DEFAULT_FUNCTION_REGION,
    secrets: [GEMINI_API_KEY_SECRET],
    timeoutSeconds: 120,
  },
  withSafeInventoryImportErrors("normalizeInventoryItems", async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }
    await requireOperationalBusinessAccess(request, {db, HttpsError});

    const data = request.data || {};
    const fileData =
      data.fileData && typeof data.fileData === "object" ? data.fileData : null;
    if (fileData) {
      validateInventoryFileData(fileData);
    }
    const rawText = fileData
      ? fileDataToText(fileData)
      : String(data.text || data.content || "");
    const text = safeText(rawText, MAX_INVENTORY_IMPORT_TEXT_LENGTH);
    const assistantMode = GENERATIVE_AI_ENABLED
      ? normalizeAssistantMode(data.assistantMode)
      : "local";
    const deterministicResult = fileData
      ? buildDirectInventoryImportItemsFromFile(fileData)
      : null;
    const startedAt = Date.now();

    if (!text) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona un archivo de inventario antes de analizar."
      );
    }

    if (!fileData && rawText.length > MAX_INVENTORY_IMPORT_TEXT_LENGTH) {
      throw new HttpsError(
        "invalid-argument",
        "El texto es demasiado largo. Usa un máximo de 5000 caracteres."
      );
    }

    if (assistantMode === "local") {
      if (deterministicResult) {
        return {
          ...deterministicResult,
          mode: "local-forced",
        };
      }

      return buildLocalInventoryImportFallback(fileData || text, {
        mode: "local-forced",
        warning:
          "Análisis local forzado para prueba. Se generaron items con reglas básicas.",
      });
    }

    const useLocalFallback = () =>
      deterministicResult
        ? {
            ...deterministicResult,
            warning: INVENTORY_LOCAL_FALLBACK_WARNING,
          }
        : buildLocalInventoryImportFallback(fileData || text);

    for (let index = 0; index < QUOTE_GEMINI_MODELS.length; index += 1) {
      const modelName = QUOTE_GEMINI_MODELS[index];

      try {
        console.info(`normalizeInventoryItems: using Gemini model ${modelName}`);
        const { response, aiRateLimit } = await generateGeminiContent({
          model: modelName,
          functionName: "normalizeInventoryItems",
          contents: buildInventoryImportPrompt(
            text,
            deterministicResult?.items || []
          ),
        });
        const raw = (response.text || "").trim();
        let parsed = null;

        try {
          parsed = extractJsonObject(raw);
        } catch (parseError) {
          console.error("normalizeInventoryItems: invalid Gemini JSON.", {
            model: modelName,
            message: parseError.message,
          });
          return useLocalFallback();
        }

        const normalizedItems = sanitizeInventoryImportPayload(parsed);
        const items = deterministicResult
          ? mergeInventoryImportItems(deterministicResult.items, normalizedItems)
          : normalizedItems;
        if (!items.length) {
          console.error("normalizeInventoryItems: empty normalized items.", {
            model: modelName,
          });
          return useLocalFallback();
        }

        return {
          items,
          source: "gemini",
          mode: assistantMode === "gemini" ? "gemini-forced" : "auto",
          model: modelName,
          warning: INVENTORY_AI_IMPORT_WARNING,
          aiRateLimit,
        };
      } catch (error) {
        if (error?.details?.reason) throw error;

        const geminiClassification = classifyGeminiServiceError(error);
        console.error("normalizeInventoryItems: Gemini error.", {
          documentFormat: fileData?.extension || "text",
          sizeBytes: Number(fileData?.tamanoBytes || 0),
          statusOriginal: geminiClassification.originalStatus || "unknown",
          category: getSafeGeminiLogCategory(geminiClassification.category),
          attempts: index + 1,
          durationMs: Date.now() - startedAt,
        });

        if (
          index < QUOTE_GEMINI_MODELS.length - 1 &&
          isGeminiModelFallbackError(error)
        ) {
          continue;
        }

        return useLocalFallback();
      }
    }

    return useLocalFallback();
  })
);

function generateInventoryDocumentContent(options) {
  return generateGeminiContent(options, {
    enabled: DOCUMENT_GENERATIVE_AI_ENABLED,
  });
}

exports.normalizeInventoryDocument = onCall(
  {
    maxInstances: 3,
    memory: "1GiB",
    region: DEFAULT_FUNCTION_REGION,
    secrets: [GEMINI_API_KEY_SECRET],
    timeoutSeconds: 180,
  },
  async (request) => {
  await requireOperationalBusinessAccess(request, {db, HttpsError});
  if (!DOCUMENT_GENERATIVE_AI_ENABLED) {
    console.warn("normalizeInventoryDocument: Gemini documental no disponible", {
      reason: "feature_disabled",
    });
    throw new HttpsError(
      "failed-precondition",
      "El análisis inteligente de documentos está temporalmente deshabilitado."
    );
  }

  return normalizeInventoryDocumentHandler(request, {
    generateGeminiContent: generateInventoryDocumentContent,
    HttpsError,
  });
}
);

/**
 * suggestQuoteItems
 *
 * IA minima para sugerir estructura de una cotizacion.
 * No calcula precios, no crea cotizaciones y no modifica inventario.
 */
exports.suggestQuoteItems = onCall(
  {
    maxInstances: 10,
    memory: "256MiB",
    region: DEFAULT_FUNCTION_REGION,
    secrets: [GEMINI_API_KEY_SECRET],
    timeoutSeconds: 60,
  },
  async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }
  await requireOperationalBusinessAccess(request, {db, HttpsError});

  const data = request.data || {};
  const description = safeText(data.description, 1200);
  const inventoryItems = normalizeInventorySummary(data.inventoryItems);
  const assistantMode = GENERATIVE_AI_ENABLED
  ? normalizeAssistantMode(data.assistantMode)
  : "local";
  console.info(`suggestQuoteItems: assistant mode ${assistantMode}`);

  if (!description) {
    console.error("suggestQuoteItems: descripcion vacia.");
    throw new HttpsError(
      "invalid-argument",
      "Describe brevemente el trabajo que necesitas cotizar."
    );
  }

  if (String(data.description || "").length > 1200) {
    console.error("suggestQuoteItems: descripcion excede 1200 caracteres.");
    throw new HttpsError(
      "invalid-argument",
      "La descripción es demasiado larga. Usa un máximo de 1200 caracteres."
    );
  }

  if (assistantMode === "local") {
    console.info("suggestQuoteItems: assistant mode local forced");
    return buildLocalQuoteFallback(description, inventoryItems, {
      mode: "local-forced",
      logUnavailable: false,
      warning:
        "Modo local forzado para prueba comparativa. Se generaron sugerencias con reglas del sistema.",
    });
  }

  if (assistantMode === "gemini") {
    console.info("suggestQuoteItems: assistant mode Gemini forced");
  }

  const geminiFallbackMode =
    assistantMode === "gemini" ? "gemini-forced-fallback" : "auto";
  const useLocalFallback = () =>
    buildLocalQuoteFallback(description, inventoryItems, {
      mode: geminiFallbackMode,
    });

  const inventoryText = inventoryItems.length
    ? inventoryItems
        .map(
          (item) =>
            `- id: ${item.id}; nombre: ${item.nombre}; tipoItem: ${item.tipoItem}; categoria: ${item.categoria}; unidad: ${item.unidad}`
        )
        .join("\n")
    : "Sin inventario activo resumido.";

  const prompt =
    "Eres un asistente acotado para estructurar cotizaciones en ValoraCloud.\n" +
    "Tu tarea es sugerir posibles items, no precios.\n\n" +
    "Reglas estrictas:\n" +
    "- Devuelve maximo 8 sugerencias.\n" +
    "- Usa solo tipoItem: producto, servicio o actividad.\n" +
    "- No incluyas precios, subtotales, totales, descuentos ni rangos monetarios.\n" +
    "- No prometas resultados comerciales.\n" +
    "- No crees cotizaciones.\n" +
    "- Incluye palabrasClave como arreglo de 2 a 6 palabras o frases cortas para buscar coincidencias en inventario.\n" +
    "- Si un item coincide claramente con el inventario, usa su id exacto en inventarioMatchId.\n" +
    "- Si no hay coincidencia clara, usa null en inventarioMatchId e inventarioMatchNombre.\n" +
    "- Responde solo JSON valido, sin markdown ni explicaciones externas.\n\n" +
    "Formato exacto:\n" +
    "{\n" +
    '  "suggestions": [\n' +
    "    {\n" +
    '      "nombre": "Cámara IP exterior",\n' +
    '      "tipoItem": "producto",\n' +
    '      "cantidadSugerida": 4,\n' +
    '      "motivo": "El proyecto menciona instalación de 4 cámaras.",\n' +
    '      "palabrasClave": ["camara ip", "seguridad", "exterior"],\n' +
    '      "inventarioMatchId": null,\n' +
    '      "inventarioMatchNombre": null\n' +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "Descripcion del proyecto:\n" +
    description +
    "\n\nInventario activo disponible:\n" +
    inventoryText;

  for (let index = 0; index < QUOTE_GEMINI_MODELS.length; index += 1) {
    const modelName = QUOTE_GEMINI_MODELS[index];

    try {
      console.info(`suggestQuoteItems: using Gemini model ${modelName}`);
      const { response, aiRateLimit } = await generateGeminiContent({
        model: modelName,
        functionName: "suggestQuoteItems",
        contents: prompt,
      });
      const raw = (response.text || "").trim();
      let parsed = null;

      try {
        parsed = extractJsonObject(raw);
      } catch (parseError) {
        console.error("suggestQuoteItems: error parseando JSON de Gemini.", {
          model: modelName,
          message: parseError.message,
        });
        return useLocalFallback();
      }

      if (!parsed || !Array.isArray(parsed.suggestions)) {
        console.error("suggestQuoteItems: respuesta sin suggestions array.", {
          model: modelName,
        });
        return useLocalFallback();
      }

      const suggestions = sanitizeQuoteSuggestions(parsed, inventoryItems);

      if (!suggestions.length) {
        console.error("suggestQuoteItems: sugerencias vacias tras sanitizar.", {
          model: modelName,
        });
        return useLocalFallback();
      }

      return {
        suggestions,
        source: "gemini",
        mode: assistantMode === "gemini" ? "gemini-forced" : "auto",
        model: modelName,
        aiRateLimit,
      };
    } catch (error) {
      if (error?.details?.reason) throw error;

      console.error("suggestQuoteItems: error llamando a Gemini.", {
        model: modelName,
        message: error.message,
        name: error.name,
      });

      if (
        index < QUOTE_GEMINI_MODELS.length - 1 &&
        isGeminiModelFallbackError(error)
      ) {
        console.warn("suggestQuoteItems: Gemini model failed, trying fallback model", {
          failedModel: modelName,
          fallbackModel: QUOTE_GEMINI_MODELS[index + 1],
        });
        continue;
      }

      return useLocalFallback();
    }
  }

  return useLocalFallback();
  }
);

// Legacy no exportado: simulaba proyectos completos con un modelo anterior.
const legacySimularCotizacionProyecto = onCall({ secrets: [GEMINI_API_KEY_SECRET] }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const userId = request.auth.uid;
  const data = request.data || {};

  const tipoProyecto = data.tipoProyecto || "";
  const descripcion = data.descripcion || "";
  const distanciaKm =
    data.distanciaKm != null ? Number(data.distanciaKm) : null;
  const nivelCalidad = data.nivelCalidad || "";
  const presupuestoReferencia =
    data.presupuestoReferencia != null
      ? Number(data.presupuestoReferencia)
      : null;
  const respuestasCuestionario =
    data.respuestasCuestionario &&
    typeof data.respuestasCuestionario === "object"
      ? data.respuestasCuestionario
      : null;

  if (!tipoProyecto.trim() || !descripcion.trim()) {
    throw new HttpsError(
      "invalid-argument",
      "Debes indicar al menos el tipo de proyecto y la descripción."
    );
  }

  // 1. Leer inventario del usuario (máx 30 productos para no matar a Gemini)
  const invSnap = await db
    .collection("usuarios")
    .doc(userId)
    .collection("inventario")
    .limit(30)
    .get();

  if (invSnap.empty) {
    throw new HttpsError(
      "failed-precondition",
      "No hay productos en el inventario del usuario."
    );
  }

  const productosBase = invSnap.docs
    .map((d) => {
      const dataDoc = d.data();
      const precio = Number(dataDoc.precio) || 0;
      return {
        id: d.id,
        nombre: dataDoc.nombre || "",
        categoria: dataDoc.categoria || "",
        unidad: dataDoc.unidad || "",
        precio,
      };
    })
    .filter((p) => p.nombre && p.precio > 0);

  if (productosBase.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "No hay productos válidos (con nombre y precio) en el inventario."
    );
  }

  const topProductos = productosBase.slice(0, 15);
  const inventarioTexto = topProductos
    .map(
      (p) =>
        `- id: ${p.id}, nombre: ${p.nombre}, categoria: ${p.categoria}, unidad: ${p.unidad}, precioBaseCLP: ${p.precio}`
    )
    .join("\n");

  // 2. Prompt para Gemini
  let prompt =
    "Eres un asistente que ayuda a armar cotizaciones de proyectos de servicios en Chile para una pequeña empresa.\n\n" +
    "Recibirás:\n" +
    "- El tipo de proyecto\n" +
    "- Una descripción del cliente en lenguaje natural\n" +
    "- Algunos parámetros adicionales\n" +
    "- El inventario disponible del negocio (con sus productos y precios base)\n\n" +
    "Con esta información debes proponer una cotización completa y devolverla en formato JSON válido.\n\n" +
    "Reglas:\n" +
    "- Usa solo productos del inventario entregado.\n" +
    "- Ajusta las cantidades de forma razonable según la descripción.\n" +
    "- Considera mano de obra y transporte.\n" +
    "- Devuelve un precio mínimo, recomendado y máximo.\n" +
    "- Respeta el siguiente formato JSON, sin texto extra:\n" +
    "{\n" +
    '  "items": [\n' +
    '    { "productoId": "ID_DEL_PRODUCTO", "cantidad": 4 },\n' +
    "    ...\n" +
    "  ],\n" +
    '  "manoObra": {\n' +
    '    "horasTecnico": 8,\n' +
    '    "valorHora": 15000\n' +
    "  },\n" +
    '  "transporte": {\n' +
    '    "costo": 20000\n' +
    "  },\n" +
    '  "margenSugerido": 0.35,\n' +
    '  "precioMin": 280000,\n' +
    '  "precioRecomendado": 320000,\n' +
    '  "precioMax": 360000,\n' +
    '  "comentarios": "Breve explicación de la propuesta"\n' +
    "}\n\n" +
    "Datos del proyecto:\n" +
    `Tipo de proyecto: ${tipoProyecto}\n` +
    `Nivel de calidad esperado: ${nivelCalidad || "no especificado"}\n` +
    `Distancia estimada (km): ${
      distanciaKm != null ? distanciaKm : "no especificada"
    }\n` +
    `Presupuesto de referencia del cliente (si lo mencionó): ${
      presupuestoReferencia != null ? presupuestoReferencia : "no especificado"
    }\n\n` +
    "Descripción del proyecto proporcionada por el cliente:\n" +
    descripcion +
    "\n\n" +
    "Inventario disponible (productos del negocio):\n" +
    inventarioTexto +
    "\n\n" +
    "Devuelve solo el JSON. Nada de explicaciones en texto.";

  let planGemini = null;
  let fuentePlan = "heuristica_local";

  // 3. Intentar con Gemini
  if (getGeminiClient()) {
    try {
      const { response } = await generateGeminiContent({
        model: PRIMARY_QUOTE_GEMINI_MODEL,
        functionName: "legacySimularCotizacionProyecto",
        contents: prompt,
      });
      const raw = (response.text || "").trim();

      // Intentar extraer JSON del texto
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        const jsonText = raw.slice(first, last + 1);
        planGemini = JSON.parse(jsonText);
        fuentePlan = "gemini_json";
      } else {
        console.warn("No se encontró JSON claro en la respuesta de Gemini.");
      }
    } catch (error) {
      console.error("Legacy Gemini quote simulation failed", {
        model: PRIMARY_QUOTE_GEMINI_MODEL,
        functionName: "legacySimularCotizacionProyecto",
        code: error?.code || "unknown",
        reason: error?.details?.reason || "unknown",
      });
    }
  }

  // 4. Construir un plan base, ya sea desde Gemini o con heurística local
  let itemsPlan = [];
  let manoObra = null;
  let transporte = null;
  let margenSugerido = null;
  let precioMin = null;
  let precioRecomendado = null;
  let precioMax = null;
  let comentarios = "";

  if (planGemini && Array.isArray(planGemini.items)) {
    itemsPlan = planGemini.items
      .map((it) => ({
        productoId: String(it.productoId || "").trim(),
        cantidad: Number(it.cantidad) || 0,
      }))
      .filter((it) => it.productoId && it.cantidad > 0);

    if (planGemini.manoObra) {
      manoObra = {
        horasTecnico: Number(planGemini.manoObra.horasTecnico) || 0,
        valorHora: Number(planGemini.manoObra.valorHora) || 0,
      };
    }

    if (planGemini.transporte) {
      transporte = {
        costo: Number(planGemini.transporte.costo) || 0,
      };
    }

    margenSugerido =
      planGemini.margenSugerido != null
        ? Number(planGemini.margenSugerido)
        : null;
    precioMin =
      planGemini.precioMin != null ? Number(planGemini.precioMin) : null;
    precioRecomendado =
      planGemini.precioRecomendado != null
        ? Number(planGemini.precioRecomendado)
        : null;
    precioMax =
      planGemini.precioMax != null ? Number(planGemini.precioMax) : null;
    comentarios = planGemini.comentarios || "";
  }

  // 4.1 Si Gemini no devolvió algo útil, usar heurística local simple
  if (!itemsPlan.length) {
    fuentePlan = "heuristica_local";
    // Tomamos algunos productos del inventario como base (ej: 3 primeros)
    itemsPlan = topProductos.slice(0, 3).map((p) => ({
      productoId: p.id,
      cantidad: 1,
    }));
  }

  if (!manoObra) {
    manoObra = {
      horasTecnico: 4,
      valorHora: 15000,
    };
  }

  if (!transporte) {
    const dist = distanciaKm != null ? distanciaKm : 10;
    const costoBase = 5000;
    const costoPorKm = 300;
    transporte = {
      costo: Math.round(costoBase + dist * costoPorKm),
    };
  }

  // 5. Calcular costos basados en inventario real
  const productosMap = {};
  for (const p of productosBase) {
    productosMap[p.id] = p;
  }

  const itemsDetallados = itemsPlan
    .map((it) => {
      const prod = productosMap[it.productoId];
      if (!prod) return null;
      const precioUnitario = prod.precio;
      const subtotal = precioUnitario * it.cantidad;
      return {
        productoId: it.productoId,
        nombre: prod.nombre,
        categoria: prod.categoria,
        unidad: prod.unidad,
        cantidad: it.cantidad,
        precioUnitario,
        subtotal,
      };
    })
    .filter(Boolean);

  const costoMateriales = itemsDetallados.reduce(
    (acc, it) => acc + it.subtotal,
    0
  );

  const costoManoObra =
    (manoObra.horasTecnico || 0) * (manoObra.valorHora || 0);
  const costoTransporte = transporte.costo || 0;
  const costoBase = costoMateriales + costoManoObra + costoTransporte;

  // 6. Ajustar precios sugeridos si vienen malos o no vienen
  if (!precioRecomendado || precioRecomendado < costoBase * 1.05) {
    const factor = 1.25;
    precioRecomendado = Math.round(costoBase * factor);
  }
  if (!precioMin || precioMin < costoBase * 1.05) {
    precioMin = Math.round(costoBase * 1.15);
  }
  if (!precioMax || precioMax < precioRecomendado) {
    precioMax = Math.round(precioRecomendado * 1.2);
  }

  margenSugerido = (precioRecomendado - costoBase) / costoBase;
  const margenPorcentaje = margenSugerido * 100;

  const ahora = FieldValue.serverTimestamp();

  // 7. Guardar proyecto en Firestore
  const proyectosRef = db
    .collection("usuarios")
    .doc(userId)
    .collection("proyectos");

  const docRef = await proyectosRef.add({
    tipoProyecto,
    descripcion,
    distanciaKm: distanciaKm != null ? distanciaKm : null,
    nivelCalidad: nivelCalidad || null,
    presupuestoReferencia:
      presupuestoReferencia != null ? presupuestoReferencia : null,

    // Guardamos, si viene, el cuestionario completo respondido por el usuario.
    respuestasCuestionario: respuestasCuestionario,

    creadoEn: ahora,
    items: itemsDetallados,
    manoObra: {
      ...manoObra,
      costoTotal: costoManoObra,
    },
    transporte,
    totales: {
      costoMateriales,
      costoManoObra,
      costoTransporte,
      costoBase,
      precioMin,
      precioRecomendado,
      precioMax,
      margenSugerido,
      margenPorcentaje,
    },
    origen: {
      usoGemini: !!getGeminiApiKey(),
      fuentePlan,
    },
    comentarios,
    estado: "borrador",
  });

  return {
    proyectoId: docRef.id,
    resumen: {
      costoBase,
      precioMin,
      precioRecomendado,
      precioMax,
      margenPorcentaje,
      totalItems: itemsDetallados.length,
    },
    items: itemsDetallados,
    manoObra: {
      ...manoObra,
      costoTotal: costoManoObra,
    },
    transporte,
    comentarios,
    fuentePlan,
  };
});
