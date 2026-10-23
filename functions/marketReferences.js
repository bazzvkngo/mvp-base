const crypto = require("node:crypto");

const SERPER_SHOPPING_URL = "https://google.serper.dev/shopping";
const MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 10000;
const MARKET_REFERENCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_QUERY_WARNING =
  "Estos resultados se buscaron con una consulta anterior; usa Forzar refresco para repetir la búsqueda con el nombre del producto.";
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

// La consulta siempre parte del nombre del producto; marca, modelo y código
// de barras sólo lo afinan. Un código solo (o marca+modelo sin nombre) traía
// productos sin relación. La confianza ya no depende de qué campos existen:
// sale de cuántos resultados coinciden de verdad (assessMarketResults).
function buildInventoryMarketQuery(item = {}) {
  const nombre = safeText(item.nombre, 120);
  const marca = safeText(item.marca, 80);
  const modelo = safeText(item.modelo, 100);
  const codigoBarras = safeText(item.codigoBarras || item.barcode, 80);
  const warnings = [];
  if (!marca && !modelo && !codigoBarras) warnings.push(GENERIC_QUERY_WARNING);

  return {
    query: uniqueParts([nombre, marca, modelo, codigoBarras]).join(" ").slice(0, 160),
    warnings,
  };
}

// --- Relevancia de resultados respecto del artículo -------------------------
// Puro y determinista (sin red). Se aplica tanto a resultados recién
// consultados como a los guardados en caché, siempre con los datos actuales
// del artículo.

const MIN_RELEVANT_FOR_SUMMARY = 3;
const MIN_NAME_COVERAGE = 0.75;
const MIN_MEASURE_SCORE = 0.6;
const HIGH_RELEVANCE_SCORE = 0.85;
const MIN_RESULTS_FOR_OUTLIER_CHECK = 4;
const NAME_STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "y", "e", "o", "u", "con", "sin",
  "para", "por", "en", "a", "al", "un", "una", "x", "mm", "cm", "mt", "mts",
]);
const UNIT_ALIASES = {
  mt: "m", mts: "m", metro: "m", metros: "m",
  kgs: "kg", gr: "g", grs: "g", lt: "l", lts: "l", litro: "l", litros: "l",
  pulg: "in",
};
const NUMBER_PATTERN = "\\d+(?:\\.\\d+)?";
const UNIT_PATTERN = "mm|cm|mts?|metros?|m|kgs?|grs?|g|lts?|litros?|l|ml|w|v|pulg|in";
// Dimensiones tipo "40x40" o "40 x 40 x 2" (las unidades intermedias son
// opcionales: "40mm x 40mm").
const DIMENSION_REGEX = new RegExp(
  `(${NUMBER_PATTERN})(?:\\s*(?:${UNIT_PATTERN}))?(?:\\s*[x*]\\s*(${NUMBER_PATTERN})(?:\\s*(?:${UNIT_PATTERN}))?){1,2}`,
  "g"
);
const UNIT_VALUE_REGEX = new RegExp(`(${NUMBER_PATTERN})\\s*(${UNIT_PATTERN})\\b`, "g");

function foldText(value) {
  return safeText(value, 400)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/×/g, "x");
}

function canonicalNumber(raw) {
  return String(Number(raw));
}

function canonicalUnit(raw) {
  return UNIT_ALIASES[raw] || raw;
}

// Devuelve las medidas de un texto: `dimensions` (los números de cada grupo
// "AxB[xC]") y `values` (número + unidad, ej. 2 mm). El texto restante, sin
// medidas, sirve para extraer las palabras del nombre.
function extractMeasures(text) {
  const folded = foldText(text);
  const dimensions = [];
  const values = [];
  const remainder = folded
    .replace(DIMENSION_REGEX, (match) => {
      const numbers = match.match(new RegExp(NUMBER_PATTERN, "g")) || [];
      dimensions.push(numbers.map(canonicalNumber));
      return " ";
    })
    .replace(UNIT_VALUE_REGEX, (match, number, unit) => {
      values.push({number: canonicalNumber(number), unit: canonicalUnit(unit)});
      return " ";
    });
  return {dimensions, values, remainder};
}

function stemWord(word) {
  let stem = word;
  if (stem.length > 4 && stem.endsWith("es")) stem = stem.slice(0, -2);
  else if (stem.length > 3 && stem.endsWith("s")) stem = stem.slice(0, -1);
  if (stem.length > 5 && /[ao]$/.test(stem)) stem = stem.slice(0, -1);
  return stem;
}

function significantWords(text) {
  return foldText(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !NAME_STOPWORDS.has(word) && !/^\d+$/.test(word))
    .map(stemWord);
}

function buildItemProfile(item = {}) {
  const measures = extractMeasures(item.nombre);
  return {
    nameWords: [...new Set(significantWords(measures.remainder))],
    measures,
    categoryWords: [...new Set(significantWords(item.categoria))].filter((word) => word.length >= 4),
    unitWords: [...new Set(significantWords(item.unidad))].filter((word) => word.length >= 3 && word !== "unidad"),
  };
}

function scoreMarketResult(profile, result) {
  const titleMeasures = extractMeasures(result?.title);
  const titleWords = new Set(significantWords(result?.title));

  const matchedWords = profile.nameWords.filter((word) => titleWords.has(word)).length;
  const coverage = profile.nameWords.length ? matchedWords / profile.nameWords.length : 0;

  // Pool de números que declara el resultado: dimensiones (sin unidad) y valores con unidad.
  const pool = [
    ...titleMeasures.dimensions.flat().map((number) => ({number, unit: null})),
    ...titleMeasures.values,
  ];
  const consume = (number, unit) => {
    const index = pool.findIndex((entry) =>
      entry.number === number && (!unit || !entry.unit || entry.unit === unit)
    );
    if (index < 0) return false;
    pool.splice(index, 1);
    return true;
  };
  let dimensionTotal = 0;
  let dimensionMatched = 0;
  profile.measures.dimensions.flat().forEach((number) => {
    dimensionTotal += 1;
    if (consume(number, null)) dimensionMatched += 1;
  });
  let valueMatched = 0;
  profile.measures.values.forEach(({number, unit}) => {
    if (consume(number, unit)) valueMatched += 1;
  });
  const measureTotal = dimensionTotal + profile.measures.values.length;
  const measureScore = measureTotal ? (dimensionMatched + valueMatched) / measureTotal : 1;
  // El resultado declara otra medida del mismo tipo (ej. 30x30 frente a 40x40): otro producto.
  const dimensionConflict = dimensionTotal > 0
    && titleMeasures.dimensions.length > 0
    && dimensionMatched < dimensionTotal;

  const core = measureTotal ? (coverage + measureScore) / 2 : coverage;
  const folded = foldText(result?.title);
  const bonus = Math.min(
    0.05,
    (profile.categoryWords.some((word) => titleWords.has(word)) ? 0.03 : 0)
      + (profile.unitWords.some((word) => folded.includes(word)) ? 0.02 : 0)
  );
  const relevant = coverage >= MIN_NAME_COVERAGE
    && !dimensionConflict
    && measureScore >= MIN_MEASURE_SCORE;
  return {
    relevant,
    core,
    // Sin tope: desempata el orden cuando varias coincidencias llegan a 1.
    sortScore: core + bonus,
    score: Math.round(Math.min(1, core + bonus) * 100) / 100,
    level: core >= HIGH_RELEVANCE_SCORE ? "ALTA" : "MEDIA",
  };
}

// Quita precios atípicos con las vallas de Tukey (1.5 × IQR). Sólo actúa con
// 4+ precios y nunca deja menos de MIN_RELEVANT_FOR_SUMMARY.
function findPriceOutliers(prices) {
  if (prices.length < MIN_RESULTS_FOR_OUTLIER_CHECK) return {lower: -Infinity, upper: Infinity};
  const sorted = [...prices].sort((left, right) => left - right);
  const quantile = (fraction) => {
    const position = (sorted.length - 1) * fraction;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base] + (sorted[Math.min(base + 1, sorted.length - 1)] - sorted[base]) * rest;
  };
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  const spread = (q3 - q1) * 1.5;
  const lower = q1 - spread;
  const upper = q3 + spread;
  const kept = sorted.filter((price) => price >= lower && price <= upper).length;
  return kept >= MIN_RELEVANT_FOR_SUMMARY ? {lower, upper} : {lower: -Infinity, upper: Infinity};
}

// Evalúa los resultados crudos contra el artículo. `status`:
//  - OK:   3+ coincidencias relevantes → hay resumen de precios.
//  - FEW:  1 o 2 coincidencias → se listan, sin resumen.
//  - NONE: ninguna coincidencia confiable → ni precios ni resumen.
function assessMarketResults(item, rawResults, currency = "CLP") {
  const preferredCurrency = safeText(currency, 8).toUpperCase() || "CLP";
  const all = Array.isArray(rawResults) ? rawResults : [];
  const profile = buildItemProfile(item);
  const relevant = all
    .map((result) => ({result, assessment: scoreMarketResult(profile, result)}))
    .filter(({result, assessment}) =>
      assessment.relevant && result.currency === preferredCurrency && Number.isFinite(Number(result.price))
    )
    .sort((left, right) =>
      right.assessment.sortScore - left.assessment.sortScore
      || (left.result.position || 0) - (right.result.position || 0)
    );

  const fences = relevant.length >= MIN_RELEVANT_FOR_SUMMARY
    ? findPriceOutliers(relevant.map(({result}) => Number(result.price)))
    : {lower: -Infinity, upper: Infinity};
  const results = relevant.map(({result, assessment}) => {
    const price = Number(result.price);
    return {
      provider: result.provider,
      externalId: result.externalId,
      title: result.title,
      merchant: result.merchant,
      priceRaw: result.priceRaw,
      price,
      currency: result.currency,
      url: result.url,
      imageUrl: result.imageUrl || null,
      position: result.position,
      relevance: {level: assessment.level, score: assessment.score},
      outlier: price < fences.lower || price > fences.upper,
    };
  });

  const base = {totalFound: all.length, discardedCount: all.length - results.length, results};
  if (!results.length) {
    return {...base, status: "NONE", confidence: "NONE", summary: null};
  }
  if (results.length < MIN_RELEVANT_FOR_SUMMARY) {
    return {...base, status: "FEW", confidence: "LOW", summary: null};
  }
  const kept = results.filter((result) => !result.outlier);
  const summary = summarizeMarketResults(kept, preferredCurrency);
  const highCount = results.filter((result) => result.relevance.level === "ALTA").length;
  return {
    ...base,
    status: "OK",
    confidence: highCount >= MIN_RELEVANT_FOR_SUMMARY ? "HIGH" : "MEDIUM",
    summary: summary && {...summary, outliersExcluded: results.length - kept.length},
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

function buildMarketResponse({
  item,
  itemInfo,
  query,
  rawResults,
  warnings,
  cached,
  actualizadoEn,
}) {
  const assessment = assessMarketResults(item, rawResults, itemInfo.currency);
  return {
    item: itemInfo,
    query,
    status: assessment.status,
    confidence: assessment.confidence,
    results: assessment.results,
    summary: assessment.summary,
    totalFound: assessment.totalFound,
    discardedCount: assessment.discardedCount,
    warnings,
    cached,
    actualizadoEn,
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
    unit: safeText(item.unidad, 40),
    currency,
  };
  const queryInfo = buildInventoryMarketQuery(item);

  const cacheRef = access.businessRef.collection("referenciasPrecios").doc(itemId);
  if (!forceRefresh) {
    const cacheSnapshot = await cacheRef.get();
    if (cacheSnapshot.exists) {
      const cached = cacheSnapshot.data() || {};
      const cachedAtMillis = cached.actualizadoEn?.toMillis?.() || 0;
      const ageMs = Date.now() - cachedAtMillis;
      if (cachedAtMillis && ageMs >= 0 && ageMs < MARKET_REFERENCE_CACHE_TTL_MS) {
        // Se re-evalúa desde los resultados guardados con los datos actuales
        // del artículo: no cuesta créditos de Serper y corrige cachés viejas.
        const cachedWarnings = Array.isArray(cached.warnings) ? [...cached.warnings] : [];
        if (queryInfo.query && cached.query !== queryInfo.query) {
          cachedWarnings.push(STALE_QUERY_WARNING);
        }
        return buildMarketResponse({
          item,
          itemInfo,
          query: cached.query || "",
          rawResults: cached.results,
          warnings: cachedWarnings,
          cached: true,
          actualizadoEn: new Date(cachedAtMillis).toISOString(),
        });
      }
    }
  }

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
  const response = buildMarketResponse({
    item,
    itemInfo,
    query: queryInfo.query,
    rawResults: results,
    warnings: [...queryInfo.warnings],
    cached: false,
    actualizadoEn: checkedAt,
  });

  // Se guardan los resultados crudos: la relevancia se recalcula al leer.
  await cacheRef.set({
    itemId,
    itemNombre: itemInfo.name,
    query: queryInfo.query,
    confidence: response.confidence,
    results,
    summary: response.summary,
    warnings: response.warnings,
    monedaCodigo: currency,
    actualizadoEn: FieldValue.serverTimestamp(),
  });

  return response;
}

module.exports = {
  GENERIC_QUERY_WARNING,
  MARKET_REFERENCE_CACHE_TTL_MS,
  MIN_RELEVANT_FOR_SUMMARY,
  STALE_QUERY_WARNING,
  assessMarketResults,
  buildInventoryMarketQuery,
  extractMeasures,
  normalizeSerperShoppingResults,
  searchInventoryMarketReferencesHandler,
  summarizeMarketResults,
};
