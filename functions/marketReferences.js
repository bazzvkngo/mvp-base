const crypto = require("node:crypto");

const SERPER_SHOPPING_URL = "https://google.serper.dev/shopping";
const MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 10000;
const MARKET_REFERENCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GENERIC_QUERY_WARNING =
  "Este producto tiene pocos datos identificadores; revisa los resultados antes de guardar una referencia.";

function safeText(value, maxLength = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function uniqueParts(parts) {
  const seen = new Set();
  return parts.filter((part) => {
    const normalized = safeText(part).toLocaleLowerCase("es");
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildInventoryMarketQuery(item = {}) {
  const nombre = safeText(item.nombre, 120);
  const marca = safeText(item.marca, 80);
  const modelo = safeText(item.modelo, 100);
  const codigoBarras = safeText(item.codigoBarras || item.barcode, 80);
  let parts = [];
  let confidence = "LOW";
  const warnings = [];

  if (marca && modelo) {
    parts = [marca, modelo];
    confidence = "HIGH";
  } else if (modelo && nombre) {
    parts = [modelo, nombre];
    confidence = "HIGH";
  } else if (codigoBarras) {
    parts = [codigoBarras];
    confidence = "HIGH";
  } else if (nombre && marca) {
    parts = [nombre, marca];
    confidence = "MEDIUM";
  } else {
    parts = [nombre];
    warnings.push(GENERIC_QUERY_WARNING);
  }

  return {
    query: uniqueParts(parts).join(" ").slice(0, 160),
    confidence,
    warnings,
  };
}

function parseNumericPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const input = safeText(value, 80);
  if (!input) return null;
  const numeric = input.replace(/[^\d.,-]/g, "");
  if (!numeric) return null;
  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");
  let normalized = numeric;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? /\./g : /,/g;
    normalized = numeric.replace(thousandsSeparator, "")
      .replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    const decimals = numeric.length - lastComma - 1;
    normalized = decimals > 0 && decimals <= 2
      ? numeric.replace(/\./g, "").replace(",", ".")
      : numeric.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const decimals = numeric.length - lastDot - 1;
    normalized = decimals > 0 && decimals <= 2
      ? numeric.replace(/,/g, "")
      : numeric.replace(/\./g, "");
  }

  const result = Number(normalized);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function detectCurrency(result, defaultCurrency) {
  const explicit = safeText(result.currency, 8).toUpperCase();
  if (/^[A-Z]{3}$/.test(explicit)) return explicit;
  const priceText = safeText(result.price, 80).toUpperCase();
  if (/\b(US\$|USD)\b/.test(priceText)) return "USD";
  if (/\bEUR\b|€/.test(priceText)) return "EUR";
  if (/\bGBP\b|£/.test(priceText)) return "GBP";
  return safeText(defaultCurrency, 8).toUpperCase() || "CLP";
}

function validHttpUrl(value) {
  try {
    const url = new URL(safeText(value, 1000));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function sourceFromLink(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "Fuente externa";
  }
}

function stableExternalId(result, link, title) {
  const supplied = safeText(result.productId || result.id, 180);
  if (supplied) return supplied;
  return crypto.createHash("sha256")
    .update(`${link}|${title}`)
    .digest("hex")
    .slice(0, 32);
}

function normalizeSerperShoppingResults(
  payload,
  {defaultCurrency = "CLP", checkedAt = new Date().toISOString(), query = ""} = {}
) {
  const shopping = Array.isArray(payload?.shopping) ? payload.shopping : [];
  return shopping.slice(0, 40).reduce((results, rawResult, index) => {
    if (results.length >= MAX_RESULTS) return results;
    const title = safeText(rawResult?.title, 240);
    const link = validHttpUrl(rawResult?.link);
    const rawPrice = rawResult?.price ?? rawResult?.extractedPrice;
    const price = parseNumericPrice(rawResult?.extractedPrice ?? rawPrice);
    if (!title || !link || price === null) return results;
    const rating = Number(rawResult?.rating);
    const ratingCount = Number(rawResult?.ratingCount);
    const position = Number(rawResult?.position);

    results.push({
      provider: "SERPER",
      externalId: stableExternalId(rawResult || {}, link, title),
      title,
      merchant: safeText(rawResult?.source, 120) || sourceFromLink(link),
      priceRaw: safeText(rawPrice, 80),
      price,
      currency: detectCurrency(rawResult || {}, defaultCurrency),
      url: link,
      imageUrl: validHttpUrl(rawResult?.imageUrl || rawResult?.image) || null,
      rating: Number.isFinite(rating) && rating >= 0 ? rating : null,
      ratingCount: Number.isFinite(ratingCount) && ratingCount >= 0
        ? ratingCount
        : null,
      position: Number.isFinite(position) && position > 0 ? position : index + 1,
      query: safeText(query, 160),
      checkedAt,
    });
    return results;
  }, []);
}

function summarizeMarketResults(results, preferredCurrency = "CLP") {
  const currency = safeText(preferredCurrency, 8).toUpperCase() || "CLP";
  const prices = (Array.isArray(results) ? results : [])
    .filter((result) => result.currency === currency)
    .map((result) => Number(result.price))
    .filter((price) => Number.isFinite(price))
    .sort((left, right) => left - right);
  if (!prices.length) return null;
  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2
    ? prices[middle]
    : (prices[middle - 1] + prices[middle]) / 2;
  return {
    count: prices.length,
    currency,
    min: prices[0],
    median,
    max: prices[prices.length - 1],
  };
}

function normalizeLocale(business = {}) {
  const country = safeText(business.paisCodigo, 2).toLowerCase() || "cl";
  const language = safeText(business.idiomaCodigo || business.idioma, 2)
    .toLowerCase() || "es";
  return {gl: country, hl: language};
}

function buildSimulatedShoppingPayload(query) {
  return {
    shopping: [
      {title: `${query} - Tienda Emulada Uno`, source: "Tienda Emulada Uno", link: "https://emulador.test/uno", price: "$10.000", productId: "emulador-uno"},
      {title: `${query} - Tienda Emulada Dos`, source: "Tienda Emulada Dos", link: "https://emulador.test/dos", extractedPrice: 12000, productId: "emulador-dos"},
      {title: `${query} - Tienda Emulada Tres`, source: "Tienda Emulada Tres", link: "https://emulador.test/tres", price: "$14.000", productId: "emulador-tres"},
    ],
  };
}

async function searchInventoryMarketReferencesHandler(request, dependencies) {
  const {
    FieldValue,
    HttpsError,
    fetchImpl = global.fetch,
    getApiKey,
    isEmulatorEnvironment,
    requireBusinessAccess,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = dependencies;
  // Sin restricción de rol: cualquier miembro activo del negocio puede
  // consultar referencias de mercado; moduleId sólo acota a perfiles
  // personalizados que no incluyan el módulo de inventario.
  const access = await requireBusinessAccess(
    request,
    dependencies,
    {moduleId: "inventario"}
  );
  const itemId = safeText(request?.data?.itemId, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(itemId)) {
    throw new HttpsError("invalid-argument", "Selecciona un producto válido.");
  }
  const forceRefresh = request?.data?.forceRefresh === true;

  const itemSnapshot = await access.businessRef.collection("inventario")
    .doc(itemId).get();
  const item = itemSnapshot.data() || {};
  if (!itemSnapshot.exists || (item.negocioId && item.negocioId !== access.businessId)) {
    throw new HttpsError("not-found", "El producto seleccionado no está disponible.");
  }
  if ((item.estado || "activo") !== "activo") {
    throw new HttpsError("failed-precondition", "El producto debe estar activo para buscar referencias.");
  }
  if ((item.tipoItem || "producto") !== "producto") {
    throw new HttpsError("failed-precondition", "La búsqueda de mercado está disponible sólo para productos.");
  }

  const business = access.businessSnapshot.data() || {};
  const currency = safeText(business.monedaCodigo, 8).toUpperCase() || "CLP";
  const itemInfo = {
    id: itemSnapshot.id,
    name: safeText(item.nombre, 160),
    internalPrice: Number.isFinite(Number(item.precioInterno))
      ? Number(item.precioInterno)
      : null,
    currency,
  };

  const cacheRef = access.businessRef.collection("referenciasPrecios").doc(itemId);
  if (!forceRefresh) {
    const cacheSnapshot = await cacheRef.get();
    if (cacheSnapshot.exists) {
      const cached = cacheSnapshot.data() || {};
      const cachedAtMillis = cached.actualizadoEn?.toMillis?.() || 0;
      const ageMs = Date.now() - cachedAtMillis;
      if (cachedAtMillis && ageMs >= 0 && ageMs < MARKET_REFERENCE_CACHE_TTL_MS) {
        return {
          item: itemInfo,
          query: cached.query || "",
          confidence: cached.confidence || "LOW",
          results: Array.isArray(cached.results) ? cached.results : [],
          summary: cached.summary || null,
          warnings: Array.isArray(cached.warnings) ? cached.warnings : [],
          cached: true,
          actualizadoEn: new Date(cachedAtMillis).toISOString(),
        };
      }
    }
  }

  const queryInfo = buildInventoryMarketQuery(item);
  if (!queryInfo.query) {
    throw new HttpsError(
      "failed-precondition",
      "Completa el nombre del producto antes de buscar referencias."
    );
  }
  const checkedAt = new Date().toISOString();
  const useSimulatedProvider = typeof isEmulatorEnvironment === "function" && isEmulatorEnvironment();
  let payload;

  if (useSimulatedProvider) {
    // En el Emulator Suite nunca se llama a Serper de verdad (evita gastar
    // cuota en cada corrida de tests); se simula una respuesta determinista
    // que atraviesa el mismo pipeline de normalización/cache/TTL.
    payload = buildSimulatedShoppingPayload(queryInfo.query);
  } else {
    const apiKey = safeText(getApiKey?.(), 500);
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        "La búsqueda de referencias no está configurada."
      );
    }
    if (typeof fetchImpl !== "function") {
      throw new HttpsError("unavailable", "La búsqueda de mercado no está disponible temporalmente.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(SERPER_SHOPPING_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({q: queryInfo.query, ...normalizeLocale(business), num: MAX_RESULTS}),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error?.name === "AbortError"
        ? "No pudimos consultar precios en este momento. Intenta nuevamente."
        : "No pudimos consultar precios en este momento. Intenta nuevamente.";
      throw new HttpsError("unavailable", message);
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 429) {
      throw new HttpsError(
        "resource-exhausted",
        "Se alcanzó el límite temporal de búsquedas. Intenta más tarde."
      );
    }
    if (!response.ok) {
      throw new HttpsError(
        "unavailable",
        "No pudimos consultar precios en este momento. Intenta nuevamente."
      );
    }

    try {
      payload = await response.json();
    } catch {
      throw new HttpsError("unavailable", "El proveedor devolvió una respuesta no válida.");
    }
  }

  const results = normalizeSerperShoppingResults(payload, {
    checkedAt,
    defaultCurrency: currency,
    query: queryInfo.query,
  });
  const warnings = [...queryInfo.warnings];
  if (!results.length) {
    warnings.push("No encontramos resultados para este producto.");
  }
  const summary = summarizeMarketResults(results, currency);

  await cacheRef.set({
    itemId,
    itemNombre: itemInfo.name,
    query: queryInfo.query,
    confidence: queryInfo.confidence,
    results,
    summary,
    warnings,
    monedaCodigo: currency,
    actualizadoEn: FieldValue.serverTimestamp(),
  });

  return {
    item: itemInfo,
    query: queryInfo.query,
    confidence: queryInfo.confidence,
    results,
    summary,
    warnings,
    cached: false,
    actualizadoEn: checkedAt,
  };
}

module.exports = {
  GENERIC_QUERY_WARNING,
  MARKET_REFERENCE_CACHE_TTL_MS,
  buildInventoryMarketQuery,
  normalizeSerperShoppingResults,
  searchInventoryMarketReferencesHandler,
  summarizeMarketResults,
};
