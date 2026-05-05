// functions/index.js

// Import de Firebase Functions v2 (callable)
const { onCall, HttpsError } = require("firebase-functions/v2/https");

// Admin SDK para acceder a Firestore
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Gemini SDK
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inicializar Admin SDK (una sola vez)
initializeApp();
const db = getFirestore();

/**
 * ⚠️ AQUÍ PEGAS TU API KEY DE GEMINI
 *
 * Copia tu key desde Google AI Studio y reemplaza SOLO el texto
 * "PON_AQUI_TU_API_KEY_DE_GEMINI" manteniendo las comillas.
 */
const GEMINI_API_KEY = "AIzaSyBcHXUoZjjl8CqifxuWa3Uq5w5b-0hTFnU";

// Instancia del modelo de Gemini (si hay API key configurada)
let geminiModel = null;

if (!GEMINI_API_KEY || GEMINI_API_KEY === "PON_AQUI_TU_API_KEY_DE_GEMINI") {
  console.warn(
    "⚠️ GEMINI_API_KEY no configurada. La función usará solo precios simulados / regex."
  );
} else {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

/** Utilidad: parsea el primer número entero razonable desde un texto */
function parseIntegerFromText(text) {
  if (!text) return null;
  const soloNumeros = String(text).replace(/[^\d]/g, "");
  const valor = parseInt(soloNumeros, 10);
  if (!valor || Number.isNaN(valor) || valor <= 0) return null;
  return valor;
}

/**
 * Usa Gemini para intentar extraer el precio principal desde el HTML.
 * Devuelve un número entero (precio en CLP) o null si no pudo.
 */
async function extraerPrecioConGemini(html) {
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
exports.verificarPrecioProducto = onCall(async (request) => {
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
exports.estimarPrecioMercadoProducto = onCall(async (request) => {
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
      "internal",
      "No se pudo estimar el precio de mercado."
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
exports.actualizarPreciosInventario = onCall(async (request) => {
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

// Asistente de cotizaciones: simular proyecto completo
exports.simularCotizacionProyecto = onCall(async (request) => {
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
      usoGemini: !!geminiModel,
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
