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
const ALLOWED_QUOTE_ITEM_TYPES = ["producto", "servicio", "actividad"];
const DEFAULT_FUNCTION_REGION = "us-central1";
const REFERENCE_REVIEW_STALE_DAYS = 30;
const LOCAL_ASSISTANT_WARNING =
  "La IA generativa no está disponible temporalmente. Se generaron sugerencias locales basadas en reglas e inventario.";

let cachedGeminiModel = null;

function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;

  try {
    return GEMINI_API_KEY_SECRET.value();
  } catch (error) {
    console.error("GEMINI_API_KEY no disponible en Secret Manager.");
    return null;
  }
}

function getGeminiModel() {
  if (cachedGeminiModel) return cachedGeminiModel;

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    console.warn(
      "GEMINI_API_KEY no configurada. Gemini queda desactivado para esta ejecucion."
    );
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  cachedGeminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  return cachedGeminiModel;
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

function sanitizeQuoteSuggestions(payload, inventoryItems) {
  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
  const suggestions = Array.isArray(payload && payload.suggestions)
    ? payload.suggestions
    : [];

  return suggestions
    .slice(0, 8)
    .map((item) => {
      const matchId = safeText(item.inventarioMatchId, 80);
      const matchedInventory = matchId ? inventoryById.get(matchId) : null;
      const tipoItem = ALLOWED_QUOTE_ITEM_TYPES.includes(item.tipoItem)
        ? item.tipoItem
        : "actividad";
      const quantity = Number(item.cantidadSugerida);

      return {
        nombre: safeText(item.nombre, 120),
        tipoItem,
        cantidadSugerida:
          Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 999) : 1,
        motivo: safeText(item.motivo, 240),
        inventarioMatchId: matchedInventory ? matchedInventory.id : null,
        inventarioMatchNombre: matchedInventory ? matchedInventory.nombre : null,
      };
    })
    .filter((item) => item.nombre && item.motivo);
}

function findInventoryMatch(suggestionName, inventoryItems) {
  const normalizedSuggestion = normalizeSearchText(suggestionName);
  const suggestionTokens = normalizedSuggestion
    .split(/\s+/)
    .filter((token) => token.length >= 4);

  if (!suggestionTokens.length) return null;

  return (
    inventoryItems.find((item) => {
      const text = normalizeSearchText(
        `${item.nombre || ""} ${item.categoria || ""} ${item.tipoItem || ""}`
      );
      return suggestionTokens.some((token) => text.includes(token));
    }) || null
  );
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

function isGeminiFallbackError(error) {
  const message = normalizeSearchText(
    `${error?.message || ""} ${error?.status || ""} ${error?.code || ""}`
  );
  return [
    "429",
    "too many requests",
    "quota",
    "credits",
    "prepayment credits are depleted",
    "unavailable",
    "timeout",
    "deadline",
    "resource exhausted",
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
  const text = normalizeSearchText(
    `${item.nombre || ""} ${item.categoria || ""} ${item.tipoItem || ""}`
  );
  const has = (...keywords) =>
    keywords.some((keyword) => text.includes(normalizeSearchText(keyword)));

  if (has("limpieza", "mantencion", "computador", "pc", "notebook")) {
    return "precio limpieza interna computador Chile servicio técnico";
  }
  if (has("sistema operativo", "windows", "formateo", "drivers")) {
    return "precio instalación sistema operativo Windows Chile";
  }
  if (has("router", "wifi", "red", "redes", "conectividad")) {
    return "precio configuración router wifi Chile";
  }
  if (has("pagina web", "página web", "landing", "one page", "sitio web")) {
    return "precio diseño página web one page Chile freelance";
  }
  if (has("carrito", "ecommerce", "e-commerce", "tienda online")) {
    return "precio desarrollo carrito de compras web Chile";
  }
  if (has("base de datos", "software", "sistema web", "crud")) {
    return "precio desarrollo sistema web base de datos Chile freelance";
  }
  if (has("hosting", "dominio", "firebase", "deploy", "cloud", "nube")) {
    return "precio despliegue aplicación web hosting dominio Chile";
  }
  if (has("seguridad", "owasp", "vulnerabilidad", "auditoria", "auditoría")) {
    return "precio revisión seguridad web OWASP Chile freelance";
  }
  if (has("cableado", "utp", "punto de red", "switch")) {
    return "precio instalación punto de red cableado UTP Chile";
  }
  return `precio ${item.nombre || "servicio informático"} Chile freelance`;
}

function buildReferenceReviewTask(item, tipoAlerta) {
  const itemNombre = item.nombre || "Ítem sin nombre";
  const isMissingReferences = tipoAlerta === "sin_referencias";

  return {
    itemId: item.id,
    itemNombre,
    tipoItem: item.tipoItem || "",
    categoria: item.categoria || "",
    tipoAlerta,
    mensaje: isMissingReferences
      ? `El ítem "${itemNombre}" no tiene referencias activas de mercado.`
      : `El ítem "${itemNombre}" tiene referencias activas con más de ${REFERENCE_REVIEW_STALE_DAYS} días.`,
    consultaSugerida: getSuggestedReferenceQuery(item),
    prioridad: isMissingReferences ? "alta" : "media",
    estado: "pendiente",
    creadoEn: FieldValue.serverTimestamp(),
    actualizadoEn: FieldValue.serverTimestamp(),
  };
}

async function hasPendingReferenceTask(tasksRef, itemId, tipoAlerta) {
  const snapshot = await tasksRef.where("itemId", "==", itemId).limit(10).get();
  return snapshot.docs.some((taskDoc) => {
    const task = taskDoc.data();
    return task.tipoAlerta === tipoAlerta && task.estado === "pendiente";
  });
}

async function createReferenceReviewTaskIfNeeded(tasksRef, item, tipoAlerta) {
  const exists = await hasPendingReferenceTask(tasksRef, item.id, tipoAlerta);
  if (exists) return false;
  await tasksRef.add(buildReferenceReviewTask(item, tipoAlerta));
  return true;
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
  let checked = 0;
  const now = new Date();
  const staleMs = REFERENCE_REVIEW_STALE_DAYS * 24 * 60 * 60 * 1000;

  for (const itemDoc of inventorySnapshot.docs) {
    const item = { id: itemDoc.id, ...itemDoc.data() };
    if ((item.estado || "activo") !== "activo") continue;
    checked += 1;

    const activeReferences = referencesByItem.get(item.id) || [];
    if (activeReferences.length === 0) {
      const wasCreated = await createReferenceReviewTaskIfNeeded(
        tasksRef,
        item,
        "sin_referencias"
      );
      if (wasCreated) created += 1;
      continue;
    }

    const latestReferenceDate = activeReferences
      .map(getReferenceDate)
      .filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    if (!latestReferenceDate || now.getTime() - latestReferenceDate.getTime() > staleMs) {
      const wasCreated = await createReferenceReviewTaskIfNeeded(
        tasksRef,
        item,
        "referencias_desactualizadas"
      );
      if (wasCreated) created += 1;
    }
  }

  return { checked, created };
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

    for (const userDoc of usersSnapshot.docs) {
      try {
        const result = await reviewUserInventoryReferences(userDoc);
        usersChecked += 1;
        itemsChecked += result.checked;
        tasksCreated += result.created;
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
    });
  }
);

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
exports.verificarPrecioProducto = onCall({ secrets: [GEMINI_API_KEY_SECRET] }, async (request) => {
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
exports.estimarPrecioMercadoProducto = onCall({ secrets: [GEMINI_API_KEY_SECRET] }, async (request) => {
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
exports.actualizarPreciosInventario = onCall({ secrets: [GEMINI_API_KEY_SECRET] }, async (request) => {
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

  const geminiModel = getGeminiModel();
  if (!geminiModel) {
    console.error("suggestQuoteItems: GEMINI_API_KEY no configurada. Usando asistente local.");
    return {
      suggestions: buildLocalQuoteSuggestions(description, inventoryItems),
      source: "local",
      warning: LOCAL_ASSISTANT_WARNING,
    };
  }

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
    '      "inventarioMatchId": null,\n' +
    '      "inventarioMatchNombre": null\n' +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "Descripcion del proyecto:\n" +
    description +
    "\n\nInventario activo disponible:\n" +
    inventoryText;

  try {
    const result = await geminiModel.generateContent(prompt);
    const raw = (result.response.text() || "").trim();
    let parsed = null;

    try {
      parsed = extractJsonObject(raw);
    } catch (parseError) {
      console.error("suggestQuoteItems: error parseando JSON de Gemini.", {
        message: parseError.message,
        rawPreview: raw.slice(0, 500),
      });
      return {
        suggestions: buildLocalQuoteSuggestions(description, inventoryItems),
        source: "local",
        warning: LOCAL_ASSISTANT_WARNING,
      };
    }

    if (!parsed || !Array.isArray(parsed.suggestions)) {
      console.error("suggestQuoteItems: respuesta sin suggestions array.", {
        rawPreview: raw.slice(0, 500),
      });
      return {
        suggestions: buildLocalQuoteSuggestions(description, inventoryItems),
        source: "local",
        warning: LOCAL_ASSISTANT_WARNING,
      };
    }

    const suggestions = sanitizeQuoteSuggestions(parsed, inventoryItems);

    if (!suggestions.length) {
      console.error("suggestQuoteItems: sugerencias vacias tras sanitizar.", {
        rawPreview: raw.slice(0, 500),
      });
      return {
        suggestions: buildLocalQuoteSuggestions(description, inventoryItems),
        source: "local",
        warning: LOCAL_ASSISTANT_WARNING,
      };
    }

    return { suggestions, source: "gemini" };
  } catch (error) {
    console.error("suggestQuoteItems: error llamando a Gemini.", {
      message: error.message,
      name: error.name,
      stack: error.stack,
    });

    if (isGeminiFallbackError(error)) {
      return {
        suggestions: buildLocalQuoteSuggestions(description, inventoryItems),
        source: "local",
        warning: LOCAL_ASSISTANT_WARNING,
      };
    }

    throw new HttpsError(
      "unavailable",
      "No se pudieron generar sugerencias en este momento."
    );
  }
  }
);

// Asistente de cotizaciones: simular proyecto completo
exports.simularCotizacionProyecto = onCall({ secrets: [GEMINI_API_KEY_SECRET] }, async (request) => {
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
