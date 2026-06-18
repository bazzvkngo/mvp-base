// functions/index.js

// Import de Firebase Functions v2 (callable)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");

// Admin SDK para acceder a Firestore
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Gemini SDK
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Resend } = require("resend");

// Inicializar Admin SDK (una sola vez)
initializeApp();
const db = getFirestore();

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
const REFERENCE_REVIEW_STALE_DAYS = 30;
const PRIMARY_QUOTE_GEMINI_MODEL = "gemini-2.5-flash-lite";
const FALLBACK_QUOTE_GEMINI_MODEL = "gemini-1.5-flash";
const QUOTE_GEMINI_MODELS = [
  PRIMARY_QUOTE_GEMINI_MODEL,
  FALLBACK_QUOTE_GEMINI_MODEL,
];
const LOCAL_ASSISTANT_WARNING =
  "La IA generativa no está disponible temporalmente. Se generaron sugerencias locales basadas en reglas e inventario.";

const INVENTORY_AI_IMPORT_WARNING =
  "Los valores detectados son estimaciones y deben ser revisados antes de guardar.";
const MAX_INVENTORY_IMPORT_TEXT_LENGTH = 5000;
const DEFAULT_INVENTORY_IMPORT_MARGIN = 25;

const cachedGeminiModels = new Map();

function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;

  try {
    return GEMINI_API_KEY_SECRET.value();
  } catch (error) {
    console.error("GEMINI_API_KEY no disponible en Secret Manager.");
    return null;
  }
}

function getGeminiModel(modelName = PRIMARY_QUOTE_GEMINI_MODEL) {
  if (cachedGeminiModels.has(modelName)) {
    return cachedGeminiModels.get(modelName);
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    console.warn(
      "GEMINI_API_KEY no configurada. Gemini queda desactivado para esta ejecucion."
    );
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  cachedGeminiModels.set(modelName, model);
  return model;
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

async function reviewUserInventoryReferences(userDoc) {
  const inventorySnapshot = await userDoc.ref.collection("inventario").get();
  const referencesSnapshot = await userDoc.ref.collection("referencias").get();
  const tasksRef = userDoc.ref.collection("tareasReferencias");
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
    region: DEFAULT_FUNCTION_REGION,
    schedule: "every day 03:15",
    timeZone: "America/Santiago",
  },
  async () => {
    const usersSnapshot = await db.collection("usuarios").get();
    let usersChecked = 0;
    let itemsChecked = 0;
    let tasksCreated = 0;
    let tasksUpdated = 0;

    for (const userDoc of usersSnapshot.docs) {
      try {
        const result = await reviewUserInventoryReferences(userDoc);
        usersChecked += 1;
        itemsChecked += result.checked;
        tasksCreated += result.created;
        tasksUpdated += result.updated;
      } catch (error) {
        console.error("Error en revision nocturna de referencias:", {
          uid: userDoc.id,
          message: error.message,
          stack: error.stack,
        });
      }
    }

    console.log("Revision nocturna de referencias completada.", {
      usersChecked,
      itemsChecked,
      tasksCreated,
      tasksUpdated,
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
  const geminiModel = getGeminiModel();
  if (!geminiModel) return null;

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
    const result = await geminiModel.generateContent(prompt);
    const text = (result.response.text() || "").trim();
    return parseIntegerFromText(text);
  } catch (error) {
    console.error("Error llamando a Gemini con HTML:", error);
    return null;
  }
}

/**
 * Estima un precio de mercado (venta sugerida) SOLO en base a la
 * descripción del producto + precio interno actual.
 */
async function estimarPrecioMercadoDesdeDescripcion(producto, precioInterno) {
  const geminiModel = getGeminiModel();
  if (!geminiModel) return null;

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
    const result = await geminiModel.generateContent(prompt);
    const text = (result.response.text() || "").trim();
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
    console.error("Error en estimarPrecioMercadoDesdeDescripcion:", error);
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
        /(?:itemprop="price"[^>]*content="|data-price="|data-precio="|\"price\":\s*\")([\d.]+)/i
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

async function getCompanyProfileForQuote(uid, quote) {
  if (hasCompanyEmailData(quote.empresa)) {
    return quote.empresa;
  }

  const snapshot = await db
    .collection("usuarios")
    .doc(uid)
    .collection("empresa")
    .doc("perfil")
    .get();

  return snapshot.exists ? snapshot.data() || {} : {};
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
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
  const contentBase64 = safeText(
    source.pdfBase64 || source.contentBase64 || source.content,
    15000000
  )
    .replace(/^data:application\/pdf;base64,/i, "")
    .replace(/\s+/g, "");
  if (!contentBase64) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(contentBase64)) {
    throw new HttpsError("invalid-argument", "El PDF adjunto no tiene un formato valido.");
  }
  const mimeType = safeText(source.pdfMimeType || source.contentType, 80) || "application/pdf";
  if (mimeType !== "application/pdf") {
    throw new HttpsError("invalid-argument", "El PDF adjunto debe ser application/pdf.");
  }

  const contentBuffer = Buffer.from(contentBase64, "base64");
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

function buildPlainQuoteEmail({ quote, mensaje }) {
  const company = quote.empresa || {};
  const companyName = "Bagner";
  const companyContact = joinNonEmpty([
    company.email,
    company.telefono,
    company.sitioWeb,
  ]);
  const companyAddress = joinNonEmpty([company.direccion, company.ciudad]);
  const validityDays = company.validezCotizacionDias || 15;

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
    companyContact || companyAddress ? "Contacto Bagner:" : "",
    companyContact,
    companyAddress,
    "",
    "Este correo fue generado desde ValoraCloud.",
  ];

  return lines.filter((line) => line !== "").join("\n");
}

function buildQuoteEmailHtml({ quote, mensaje }) {
  const company = quote.empresa || {};
  const brand = "Bagner";
  const companyContact = joinNonEmpty([
    company.email,
    company.telefono,
    company.sitioWeb,
  ]);
  const companyAddress = joinNonEmpty([company.direccion, company.ciudad]);
  const validityDays = company.validezCotizacionDias || 15;

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
          ${
            companyContact || companyAddress
              ? `<div style="border-top:1px solid #e5e7eb;margin-top:18px;padding-top:14px;color:#475569;">
                  <strong style="color:#334155;">Contacto Bagner</strong>
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

async function sendQuoteEmailWithResend({
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
    region: DEFAULT_FUNCTION_REGION,
    secrets: [RESEND_API_KEY_SECRET, RESEND_FROM_EMAIL_SECRET],
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
    }

    const uid = request.auth.uid;
    const data = request.data || {};
    const quoteId = safeText(data.quoteId, 100);
    const emailCliente = safeText(data.emailCliente || data.emailClienteDestino, 180);
    const asunto = safeText(data.asunto, 180);
    const mensaje = safeText(data.mensaje, 2000);
    const pdfAttachment = normalizePdfAttachment(data);

    if (!quoteId) {
      throw new HttpsError("invalid-argument", "quoteId es requerido.");
    }
    if (!isValidEmailAddress(emailCliente)) {
      throw new HttpsError(
        "invalid-argument",
        "Ingresa un correo de cliente valido."
      );
    }
    if (!asunto) {
      throw new HttpsError("invalid-argument", "El asunto es obligatorio.");
    }
    if (!mensaje) {
      throw new HttpsError("invalid-argument", "El mensaje es obligatorio.");
    }
    if (!pdfAttachment) {
      throw new HttpsError("invalid-argument", "El PDF adjunto es obligatorio.");
    }

    const quoteRef = db
      .collection("usuarios")
      .doc(uid)
      .collection("cotizaciones")
      .doc(quoteId);
    const quoteSnapshot = await quoteRef.get();

    if (!quoteSnapshot.exists) {
      throw new HttpsError("not-found", "No se encontro la cotizacion.");
    }

    const quote = {
      id: quoteSnapshot.id,
      ...quoteSnapshot.data(),
    };
    if (quote.uidUsuario && quote.uidUsuario !== uid) {
      throw new HttpsError("permission-denied", "No puedes enviar esta cotizacion.");
    }
    if ((quote.estado || "").toLowerCase() !== "emitida") {
      throw new HttpsError(
        "failed-precondition",
        "Solo se pueden enviar cotizaciones emitidas."
      );
    }

    quote.empresa = await getCompanyProfileForQuote(uid, quote);
    const html = buildQuoteEmailHtml({ quote, asunto, mensaje });
    const text = buildPlainQuoteEmail({ quote, asunto, mensaje });
    const apiKey = getResendApiKey();
    const from = getQuoteEmailSender();
    const attemptedAt = new Date();
    const baseEmailPatch = {
      emailClienteDestino: emailCliente,
      fechaEnvioCorreo: FieldValue.serverTimestamp(),
      asuntoCorreo: asunto,
      mensajeCorreo: mensaje,
      archivoAdjuntoCorreo: pdfAttachment.filename,
      actualizadoEn: FieldValue.serverTimestamp(),
    };

    if (!apiKey || !from) {
      const configurationError =
        "No fue posible enviar la cotizacion. Puedes utilizar el respaldo manual.";
      const patch = {
        ...baseEmailPatch,
        enviadoPorCorreo: false,
        estadoEnvioCorreo: "error",
        proveedorCorreo: "resend",
        ultimoErrorEnvio: configurationError,
      };
      await quoteRef.update(patch);
      return {
        success: false,
        provider: "resend",
        error: configurationError,
        quoteEmailStatus: {
          emailClienteDestino: emailCliente,
          asuntoCorreo: asunto,
          mensajeCorreo: mensaje,
          archivoAdjuntoCorreo: pdfAttachment.filename,
          enviadoPorCorreo: false,
          estadoEnvioCorreo: "error",
          proveedorCorreo: "resend",
          ultimoErrorEnvio: configurationError,
          fechaEnvioCorreo: attemptedAt.toISOString(),
        },
      };
    }

    try {
      const providerResponse = await sendQuoteEmailWithResend({
        apiKey,
        from,
        to: emailCliente,
        subject: asunto,
        html,
        text,
        attachments: [pdfAttachment],
      });
      const patch = {
        ...baseEmailPatch,
        enviadoPorCorreo: true,
        estadoEnvioCorreo: "enviado",
        ultimoErrorEnvio: "",
        proveedorCorreo: "resend",
        idEnvioCorreoProveedor: safeText(providerResponse.id, 120),
        archivoAdjuntoCorreo: pdfAttachment.filename,
      };
      await quoteRef.update(patch);
      return {
        success: true,
        provider: "resend",
        quoteEmailStatus: {
          emailClienteDestino: emailCliente,
          asuntoCorreo: asunto,
          mensajeCorreo: mensaje,
          enviadoPorCorreo: true,
          estadoEnvioCorreo: "enviado",
          ultimoErrorEnvio: "",
          proveedorCorreo: "resend",
          idEnvioCorreoProveedor: safeText(providerResponse.id, 120),
          archivoAdjuntoCorreo: pdfAttachment.filename,
          fechaEnvioCorreo: attemptedAt.toISOString(),
        },
      };
    } catch (error) {
      console.error("sendQuoteEmail: proveedor fallo.", {
        message: error.message,
        name: error.name,
      });
      const providerError =
        "No fue posible enviar la cotizacion. Puedes utilizar el respaldo manual.";
      const patch = {
        ...baseEmailPatch,
        enviadoPorCorreo: false,
        estadoEnvioCorreo: "error",
        ultimoErrorEnvio: providerError,
        proveedorCorreo: "resend",
        archivoAdjuntoCorreo: pdfAttachment.filename,
      };
      await quoteRef.update(patch);
      return {
        success: false,
        provider: "resend",
        error: providerError,
        quoteEmailStatus: {
          emailClienteDestino: emailCliente,
          asuntoCorreo: asunto,
          mensajeCorreo: mensaje,
          enviadoPorCorreo: false,
          estadoEnvioCorreo: "error",
          ultimoErrorEnvio: patch.ultimoErrorEnvio,
          proveedorCorreo: "resend",
          archivoAdjuntoCorreo: pdfAttachment.filename,
          fechaEnvioCorreo: attemptedAt.toISOString(),
        },
      };
    }
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
  if (tipoItem === "actividad") return "hora";
  return "unidad";
}

function inferInventoryImportCategory(text = "") {
  const normalized = normalizeSearchText(text);
  if (
    normalized.includes("notebook") ||
    normalized.includes("mouse") ||
    normalized.includes("teclado") ||
    normalized.includes("monitor") ||
    normalized.includes("equipo")
  ) {
    return "Soporte tecnico y hardware";
  }
  if (
    normalized.includes("cable") ||
    normalized.includes("red") ||
    normalized.includes("cat6") ||
    normalized.includes("router") ||
    normalized.includes("switch")
  ) {
    return "Redes y conectividad";
  }
  if (
    normalized.includes("instalacion") ||
    normalized.includes("configuracion") ||
    normalized.includes("soporte")
  ) {
    return "Servicios TI";
  }
  return "General";
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
  const margenDeseado =
    parseOptionalPositiveNumber(
      rawItem?.margenDeseado ??
        rawItem?.margenSugerido ??
        rawItem?.margenPorDefecto
    ) ?? DEFAULT_INVENTORY_IMPORT_MARGIN;
  const cantidadSugerida = parseOptionalPositiveNumber(
    rawItem?.cantidadSugerida ?? rawItem?.cantidad
  );
  const confianzaRaw = parseOptionalPositiveNumber(
    rawItem?.confianza ?? rawItem?.nivelConfianza
  );
  const confianzaBase =
    confianzaRaw === null ? 60 : Math.max(0, Math.min(100, confianzaRaw));
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
    : Math.min(confianzaBase, 45);

  return {
    id: safeText(rawItem?.id, 80) || `normalizado-${index + 1}`,
    nombre,
    sku: safeText(rawItem?.sku || rawItem?.codigo, 80),
    codigo: safeText(rawItem?.codigo || rawItem?.sku, 80),
    tipoItem,
    categoria: safeText(rawItem?.categoria, 90) || inferInventoryImportCategory(sourceText),
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
    confianza,
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
  categoria: ["categoria", "rubro"],
  descripcion: ["descripcion", "detalle"],
  unidad: ["unidad", "unidad_medida", "medida"],
  costo_base: ["costo_base", "costo", "costo_unitario"],
  margen: ["margen", "margen_porcentaje", "margen_%"],
  precio_interno: ["precio_interno", "precio", "precio_venta", "valor"],
  observacion: ["observacion", "notas", "nota"],
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
        "categoria",
        "descripcion",
        "unidad",
        "costo_base",
        "margen",
        "precio_interno",
        "observacion",
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
      const margenDeseado =
        parseOptionalPositiveNumber(getMappedCell(cells, headerMap, "margen")) ??
        DEFAULT_INVENTORY_IMPORT_MARGIN;
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
        categoria: categoria || inferInventoryImportCategory(sourceText),
        descripcion: safeText(
          getMappedCell(cells, headerMap, "descripcion"),
          1000
        ),
        unidad: unidad || defaultUnitForInventoryImport(tipoItem, sourceText),
        cantidadSugerida: null,
        costoBase,
        margenDeseado,
        precioInterno: calculateInventoryImportPrice(costoBase, margenDeseado),
        observacion,
        confianza: 95,
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
      categoria: baseItem.categoria || suggestion.categoria || "",
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
          categoria: inferInventoryImportCategory(inferredName || line),
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
      "Se uso analisis local del archivo. Revisa valores y posibles duplicados antes de guardar.",
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
          categoria: inferInventoryImportCategory(line),
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
      "Gemini no esta disponible o no devolvio datos validos. Se uso fallback local.",
  };
}

function buildInventoryImportPrompt(text, deterministicItems = []) {
  const deterministicBlock = deterministicItems.length
    ? `\n\nBase deterministica ya detectada desde encabezados. Debes conservar la misma cantidad de filas y no modificar SKU, nombre, tipoItem, categoria, descripcion, unidad, costoBase ni margenDeseado cuando ya tengan valor:\n${JSON.stringify(
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
    "- Si no existe categoria clara, usa General.\n" +
    "- No reemplaces categorias, tipos, unidades, costos ni margenes que vengan explicitamente en columnas reconocidas.\n" +
    "- No inventes datos con seguridad; deja valores editables y baja confianza.\n" +
    "- margenSugerido debe ser porcentaje entero, usa 25 si no hay dato claro.\n" +
    "- precioInternoSugerido debe ser costoBase + margen si hay costo; si no, 0.\n" +
    "- confianza debe ser un numero de 0 a 100.\n" +
    "- Responde solo JSON valido, sin markdown ni explicaciones externas.\n\n" +
    "Formato exacto:\n" +
    "{\n" +
    '  "items": [\n' +
    "    {\n" +
    '      "nombre": "Notebook Lenovo ThinkPad E14",\n' +
    '      "tipoItem": "producto",\n' +
    '      "categoria": "Soporte tecnico y hardware",\n' +
    '      "descripcion": "",\n' +
    '      "unidad": "unidad",\n' +
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

exports.normalizeInventoryItems = onCall(
  { region: DEFAULT_FUNCTION_REGION, secrets: [GEMINI_API_KEY_SECRET] },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
    }

    const data = request.data || {};
    const fileData =
      data.fileData && typeof data.fileData === "object" ? data.fileData : null;
    const rawText = fileData
      ? fileDataToText(fileData)
      : String(data.text || data.content || "");
    const text = safeText(rawText, MAX_INVENTORY_IMPORT_TEXT_LENGTH);
    const assistantMode = normalizeAssistantMode(data.assistantMode);
    const deterministicResult = fileData
      ? buildDirectInventoryImportItemsFromFile(fileData)
      : null;

    if (!text) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona un archivo de inventario antes de analizar."
      );
    }

    if (!fileData && rawText.length > MAX_INVENTORY_IMPORT_TEXT_LENGTH) {
      throw new HttpsError(
        "invalid-argument",
        "El texto es demasiado largo. Usa un maximo de 5000 caracteres."
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
          "Analisis local forzado para prueba. Se generaron items con reglas basicas.",
      });
    }

    const useLocalFallback = () =>
      deterministicResult || buildLocalInventoryImportFallback(fileData || text);

    for (let index = 0; index < QUOTE_GEMINI_MODELS.length; index += 1) {
      const modelName = QUOTE_GEMINI_MODELS[index];
      const geminiModel = getGeminiModel(modelName);

      if (!geminiModel) return useLocalFallback();

      try {
        console.info(`normalizeInventoryItems: using Gemini model ${modelName}`);
        const result = await geminiModel.generateContent(
          buildInventoryImportPrompt(text, deterministicResult?.items || [])
        );
        const raw = (result.response.text() || "").trim();
        let parsed = null;

        try {
          parsed = extractJsonObject(raw);
        } catch (parseError) {
          console.error("normalizeInventoryItems: invalid Gemini JSON.", {
            model: modelName,
            message: parseError.message,
            rawPreview: raw.slice(0, 500),
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
            rawPreview: raw.slice(0, 500),
          });
          return useLocalFallback();
        }

        return {
          items,
          source: "gemini",
          mode: assistantMode === "gemini" ? "gemini-forced" : "auto",
          model: modelName,
          warning: INVENTORY_AI_IMPORT_WARNING,
        };
      } catch (error) {
        console.error("normalizeInventoryItems: Gemini error.", {
          model: modelName,
          message: error.message,
          name: error.name,
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
  }
);

/**
 * suggestQuoteItems
 *
 * IA minima para sugerir estructura de una cotizacion.
 * No calcula precios, no crea cotizaciones y no modifica inventario.
 */
exports.suggestQuoteItems = onCall(
  { region: DEFAULT_FUNCTION_REGION, secrets: [GEMINI_API_KEY_SECRET] },
  async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }

  const data = request.data || {};
  const description = safeText(data.description, 1200);
  const inventoryItems = normalizeInventorySummary(data.inventoryItems);
  const assistantMode = normalizeAssistantMode(data.assistantMode);
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
    let geminiModel = null;

    try {
      geminiModel = getGeminiModel(modelName);
    } catch (error) {
      console.error("suggestQuoteItems: error inicializando Gemini.", {
        model: modelName,
        message: error.message,
        name: error.name,
      });
      return useLocalFallback();
    }

    if (!geminiModel) {
      return useLocalFallback();
    }

    try {
      console.info(`suggestQuoteItems: using Gemini model ${modelName}`);
      const result = await geminiModel.generateContent(prompt);
      const raw = (result.response.text() || "").trim();
      let parsed = null;

      try {
        parsed = extractJsonObject(raw);
      } catch (parseError) {
        console.error("suggestQuoteItems: error parseando JSON de Gemini.", {
          model: modelName,
          message: parseError.message,
          rawPreview: raw.slice(0, 500),
        });
        return useLocalFallback();
      }

      if (!parsed || !Array.isArray(parsed.suggestions)) {
        console.error("suggestQuoteItems: respuesta sin suggestions array.", {
          model: modelName,
          rawPreview: raw.slice(0, 500),
        });
        return useLocalFallback();
      }

      const suggestions = sanitizeQuoteSuggestions(parsed, inventoryItems);

      if (!suggestions.length) {
        console.error("suggestQuoteItems: sugerencias vacias tras sanitizar.", {
          model: modelName,
          rawPreview: raw.slice(0, 500),
        });
        return useLocalFallback();
      }

      return {
        suggestions,
        source: "gemini",
        mode: assistantMode === "gemini" ? "gemini-forced" : "auto",
        model: modelName,
      };
    } catch (error) {
      console.error("suggestQuoteItems: error llamando a Gemini.", {
        model: modelName,
        message: error.message,
        name: error.name,
        stack: error.stack,
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
  const geminiModel = getGeminiModel();
  if (geminiModel) {
    try {
      const result = await geminiModel.generateContent(prompt);
      const raw = (result.response.text() || "").trim();
      console.log("Gemini cotizacion raw:", raw);

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
      console.error("Error llamando a Gemini para cotización:", error);
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
