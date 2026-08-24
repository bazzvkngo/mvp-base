const { Type } = require("@google/genai");
const { AI_MODELS } = require("./aiConfig");

const DOCUMENT_GEMINI_MODEL = AI_MODELS.DOCUMENT_IMPORT;
const MAX_DOCUMENT_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_IMPORT_BASE64_LENGTH =
  Math.ceil(MAX_DOCUMENT_IMPORT_BYTES / 3) * 4 + 4;
const DOCUMENT_UNAVAILABLE_MESSAGE =
  "No fue posible analizar el documento mediante el servicio inteligente. El archivo no fue almacenado y ningún registro fue incorporado al inventario. Intenta nuevamente o utiliza una planilla compatible.";
const TEMPORARY_DOCUMENT_UNAVAILABLE_MESSAGE =
  "El servicio inteligente está temporalmente ocupado. Espera unos segundos e intenta nuevamente. El archivo no fue almacenado y ningún registro fue incorporado al inventario.";
const DOCUMENT_USAGE_LIMIT_MESSAGE =
  "El servicio inteligente alcanzó el límite de uso disponible. Intenta nuevamente más tarde. El archivo no fue almacenado y ningún registro fue incorporado al inventario.";
const DEFAULT_DOCUMENT_IMPORT_MARGIN = 25;
const DEFAULT_MARGIN_WARNING =
  "Se aplicó el margen predeterminado del sistema. Puedes modificarlo antes de guardar.";
const MAX_SAFE_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const GEMINI_ERROR_CATEGORIES = {
  DAILY_QUOTA: "daily_quota",
  TRANSIENT_RATE_LIMIT: "transient_rate_limit",
  UNAVAILABLE: "unavailable",
  VALIDATION: "validation",
  UNKNOWN: "unknown",
};

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const EXTENSION_TO_MIME = new Map([
  ["pdf", "application/pdf"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

const INVENTORY_ITEM_TYPES = ["producto", "servicio", "actividad"];
const DOCUMENT_TYPES = ["factura", "cotizacion", "lista_precios", "inventario", "otro"];
const MAX_DOCUMENT_ITEMS = 80;

class DocumentImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DocumentImportError";
    this.code = code;
  }
}

const nullableString = () => ({
  type: Type.STRING,
  nullable: true,
});

const nullableNumber = () => ({
  type: Type.NUMBER,
  nullable: true,
});

const INVENTORY_DOCUMENT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    documentType: {
      type: Type.STRING,
      enum: DOCUMENT_TYPES,
    },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          nombre: nullableString(),
          tipoItem: {
            type: Type.STRING,
            nullable: true,
            enum: INVENTORY_ITEM_TYPES,
          },
          areaPropuesta: nullableString(),
          categoriaPropuesta: nullableString(),
          descripcion: nullableString(),
          unidad: nullableString(),
          sku: nullableString(),
          cantidadOrigen: nullableNumber(),
          precioUnitario: nullableNumber(),
          totalLinea: nullableNumber(),
          costoBase: nullableNumber(),
          tasaImpuestoCompra: nullableNumber(),
          margenDeseado: nullableNumber(),
          marca: nullableString(),
          modelo: nullableString(),
          stock: nullableNumber(),
          stockMinimo: nullableNumber(),
          codigoBarras: nullableString(),
          confianza: nullableNumber(),
          evidenciaOrigen: nullableString(),
          pagina: nullableNumber(),
          valorCalculado: {
            type: Type.BOOLEAN,
            nullable: true,
          },
          advertencias: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
          },
        },
        required: ["nombre", "tipoItem", "confianza"],
      },
    },
    warnings: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
    },
  },
  required: ["documentType", "items", "warnings"],
};

function safeText(value, maxLength = 180) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeMimeType(value) {
  const normalized = safeText(value, 80).toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized;
}

function getExtension(fileName) {
  const match = safeText(fileName, 180).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function startsWithBytes(buffer, bytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function detectMimeFromMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function decodeBase64Strict(value) {
  const base64 = safeText(value, MAX_DOCUMENT_IMPORT_BASE64_LENGTH + 128);

  if (!base64 || base64.length > MAX_DOCUMENT_IMPORT_BASE64_LENGTH) {
    throw new DocumentImportError(
      "invalid-argument",
      "El archivo supera el tamaño permitido para análisis documental."
    );
  }
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new DocumentImportError(
      "invalid-argument",
      "El contenido del archivo no tiene una codificación válida."
    );
  }

  const buffer = Buffer.from(base64, "base64");
  const normalizedInput = base64.replace(/=+$/g, "");
  const normalizedOutput = buffer.toString("base64").replace(/=+$/g, "");
  if (!buffer.length || normalizedInput !== normalizedOutput) {
    throw new DocumentImportError(
      "invalid-argument",
      "El contenido del archivo no tiene una codificación válida."
    );
  }
  return buffer;
}

function validatePdfBuffer(buffer) {
  if (buffer.length < 128) {
    throw new DocumentImportError("invalid-argument", "El PDF está vacío o incompleto.");
  }

  const text = buffer.toString("latin1");
  const tail = text.slice(-2048);
  if (!tail.includes("%%EOF")) {
    throw new DocumentImportError(
      "invalid-argument",
      "El PDF parece estar corrupto o truncado."
    );
  }
  if (/\/Encrypt\b|\/Filter\s*\/Standard\b/i.test(text)) {
    throw new DocumentImportError(
      "invalid-argument",
      "El PDF protegido no puede analizarse."
    );
  }
  if (/\/Count\s+0\b/i.test(text) || !/\/Type\s*\/Page\b/i.test(text)) {
    throw new DocumentImportError(
      "invalid-argument",
      "El PDF no contiene páginas legibles."
    );
  }
}

function validateImageBuffer(buffer, mimeType) {
  const minimumBytes = {
    "image/jpeg": 24,
    "image/png": 33,
    "image/webp": 24,
  };
  if (buffer.length < (minimumBytes[mimeType] || 24)) {
    throw new DocumentImportError(
      "invalid-argument",
      "La imagen está vacía o incompleta."
    );
  }
}

function validateInventoryDocumentPayload(input) {
  const payload = input?.document && typeof input.document === "object"
    ? input.document
    : input;
  const fileName = safeText(payload?.nombreArchivo || payload?.fileName || payload?.name, 180);
  const declaredMime = normalizeMimeType(
    payload?.tipoArchivo || payload?.mimeType || payload?.type
  );
  const declaredSize = Number(payload?.tamanoBytes || payload?.size || payload?.fileSize || 0);
  const extension = getExtension(fileName || `archivo.${safeText(payload?.extension, 12)}`);

  if (!fileName) {
    throw new DocumentImportError("invalid-argument", "Selecciona un documento antes de analizar.");
  }
  if (!EXTENSION_TO_MIME.has(extension)) {
    throw new DocumentImportError(
      "invalid-argument",
      "Usa un archivo PDF, JPG, PNG o WebP para análisis documental."
    );
  }
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(declaredMime)) {
    throw new DocumentImportError(
      "invalid-argument",
      "El tipo MIME del documento no está permitido."
    );
  }
  if (EXTENSION_TO_MIME.get(extension) !== declaredMime) {
    throw new DocumentImportError(
      "invalid-argument",
      "La extensión no coincide con el tipo MIME declarado."
    );
  }
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    throw new DocumentImportError(
      "invalid-argument",
      "El documento está vacío o no informa un tamaño válido."
    );
  }
  if (declaredSize > MAX_DOCUMENT_IMPORT_BYTES) {
    throw new DocumentImportError(
      "invalid-argument",
      "El documento no puede superar 5 MB."
    );
  }

  const buffer = decodeBase64Strict(payload?.base64 || payload?.contentBase64);
  if (buffer.length !== declaredSize) {
    throw new DocumentImportError(
      "invalid-argument",
      "El tamaño declarado del documento no coincide con el contenido recibido."
    );
  }
  if (buffer.length > MAX_DOCUMENT_IMPORT_BYTES) {
    throw new DocumentImportError(
      "invalid-argument",
      "El documento no puede superar 5 MB."
    );
  }

  const detectedMime = detectMimeFromMagic(buffer);
  if (!detectedMime || detectedMime !== declaredMime) {
    throw new DocumentImportError(
      "invalid-argument",
      "La firma real del archivo no coincide con un formato admitido."
    );
  }
  if (detectedMime === "application/pdf") validatePdfBuffer(buffer);
  else validateImageBuffer(buffer, detectedMime);

  return {
    base64: buffer.toString("base64"),
    bytes: buffer.length,
    declaredMime,
    detectedMime,
    extension,
  };
}

function parsePositiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }

  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function parsePositiveDecimal(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? Math.round(value * 100) / 100
      : null;
  }

  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function parsePositiveQuantity(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

function normalizeWarningKey(value) {
  return normalizeSearchText(value).replace(/\s+/g, " ");
}

function dedupeWarnings(warnings) {
  const seen = new Set();
  return (Array.isArray(warnings) ? warnings : warnings ? [warnings] : [])
    .map((warning) => safeText(warning, 180))
    .filter(Boolean)
    .filter((warning) => {
      const key = normalizeWarningKey(warning);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function normalizeWarnings(value) {
  return dedupeWarnings(value);
}

function isGeneralDocumentWarning(value) {
  const normalized = normalizeWarningKey(value);
  if (!normalized) return false;

  return [
    "documento ficticio",
    "no es valido para uso comercial",
    "precios no indican si incluyen impuestos",
    "precio no indica si incluye impuestos",
    "precios unitarios incluyen impuestos",
    "precio unitario incluye impuestos",
    "incluyen impuestos",
    "incluye impuestos",
  ].some((text) => normalized.includes(text));
}

function isAdministrativeLine(name) {
  const normalized = normalizeSearchText(name);
  if (!normalized) return true;

  return [
    /^rut\b/,
    /^folio\b/,
    /^factura\b/,
    /^fecha\b/,
    /^subtotal\b/,
    /^iva\b/,
    /^impuesto\b/,
    /^total\b/,
    /^descuento\b/,
    /^despacho\b/,
    /^recargo\b/,
    /^direccion\b/,
    /^telefono\b/,
    /^correo\b/,
    /^banco\b/,
    /^cuenta\b/,
    /^forma de pago\b/,
    /^observaciones?\b/,
    /^pagina\b/,
  ].some((pattern) => pattern.test(normalized));
}

function normalizeDocumentType(value) {
  const normalized = normalizeSearchText(value).replace(/\s+/g, "_");
  return DOCUMENT_TYPES.includes(normalized) ? normalized : "otro";
}

function defaultUnitForDocumentItem(tipoItem) {
  if (tipoItem === "servicio") return "servicio";
  if (tipoItem === "actividad") return "servicio";
  return "unidad";
}

function calculateDocumentPrice(costoBase, margenDeseado) {
  if (!Number.isFinite(costoBase) || costoBase <= 0) return 0;
  if (!Number.isFinite(margenDeseado) || margenDeseado < 0) return Math.round(costoBase);
  return Math.round(costoBase + (costoBase * margenDeseado) / 100);
}

function calculateMarginFromPrice(costoBase, precioVenta) {
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

function normalizeConfidencePercent(value) {
  const parsed = parsePositiveDecimal(value);
  if (parsed === null) return null;
  if (parsed >= 0 && parsed <= 1) return Math.round(parsed * 10000) / 100;
  if (parsed > 1 && parsed <= 100) return parsed;
  return null;
}

function normalizeInventoryDocumentItem(rawItem, index) {
  const nombre = safeText(
    rawItem?.nombre || rawItem?.name || rawItem?.producto || rawItem?.descripcionProducto,
    140
  );
  if (!nombre || isAdministrativeLine(nombre)) return null;

  const advertencias = normalizeWarnings(rawItem?.advertencias || rawItem?.warnings);
  const rawTipo = normalizeSearchText(rawItem?.tipoItem || rawItem?.tipo);
  const hasExplicitType = INVENTORY_ITEM_TYPES.includes(rawTipo);
  const tipoItem = hasExplicitType ? rawTipo : "producto";
  if (!hasExplicitType) {
    advertencias.push("Tipo de item no determinado; revisar antes de guardar.");
  }

  const cantidadDetectada = parsePositiveQuantity(
    rawItem?.cantidadOrigen ?? rawItem?.cantidad
  );
  const cantidadOrigen = cantidadDetectada && cantidadDetectada > 0 ? cantidadDetectada : 1;
  const precioUnitario = parsePositiveNumber(
    rawItem?.precioUnitario ?? rawItem?.valorUnitario ?? rawItem?.netoUnitario
  );
  const costoDirecto = parsePositiveNumber(
    rawItem?.costoBase ?? rawItem?.costoUnitario ?? rawItem?.precioCompra
  );
  const totalLinea = parsePositiveNumber(
    rawItem?.totalLinea ?? rawItem?.precioTotal ?? rawItem?.importeLinea
  );
  const precioVenta = parsePositiveNumber(
    rawItem?.precioInterno ??
      rawItem?.precioInternoSugerido ??
      rawItem?.precioVenta ??
      rawItem?.precioSugerido
  );
  const margenDetectado = parsePositiveDecimal(rawItem?.margenDeseado ?? rawItem?.margen);

  let costoBase = costoDirecto ?? precioUnitario;
  let valorCalculado = rawItem?.valorCalculado === true;
  if (costoBase === null && totalLinea !== null && cantidadOrigen) {
    costoBase = Math.round(totalLinea / cantidadOrigen);
    valorCalculado = true;
    advertencias.push("Costo unitario calculado desde total de linea dividido por cantidad.");
  }
  if (costoBase === null) {
    costoBase = 0;
    advertencias.push("Costo unitario no detectado; completar manualmente si corresponde.");
  }

  let margenDeseado = margenDetectado;
  if (margenDeseado === null) {
    margenDeseado = calculateMarginFromPrice(costoBase, precioVenta);
  }
  if (margenDeseado === null) {
    margenDeseado = DEFAULT_DOCUMENT_IMPORT_MARGIN;
    advertencias.push(DEFAULT_MARGIN_WARNING);
  }

  const unidad = safeText(rawItem?.unidad, 40) || defaultUnitForDocumentItem(tipoItem);
  const confianza = normalizeConfidencePercent(rawItem?.confianza ?? rawItem?.nivelConfianza);
  const evidenciaOrigen = safeText(rawItem?.evidenciaOrigen || rawItem?.origen, 180);
  const pagina = parsePositiveNumber(rawItem?.pagina);
  const revisionRequerida =
    confianza === null || confianza < 50 || costoBase <= 0 || advertencias.length > 0;
  const itemWarnings = dedupeWarnings(advertencias);
  const detectedPurchaseTaxRate = parsePositiveDecimal(
    rawItem?.tasaImpuestoCompra ?? rawItem?.tasaImpuesto ?? rawItem?.iva
  );
  const purchaseTaxRate =
    detectedPurchaseTaxRate !== null && detectedPurchaseTaxRate <= 100
      ? detectedPurchaseTaxRate
      : null;
  if (detectedPurchaseTaxRate > 100) {
    itemWarnings.push("Tasa de impuesto fuera de rango; revisar manualmente.");
  }
  const productFields =
    tipoItem === "producto"
      ? {
          marca: safeText(rawItem?.marca, 100),
          modelo: safeText(rawItem?.modelo, 100),
          stock: parsePositiveDecimal(
            rawItem?.stock ?? rawItem?.stockActual ?? cantidadOrigen
          ),
          stockMinimo: parsePositiveDecimal(
            rawItem?.stockMinimo ?? rawItem?.stockMin
          ),
          codigoBarras: safeText(
            rawItem?.codigoBarras || rawItem?.ean || rawItem?.upc,
            120
          ),
          ...(purchaseTaxRate === null
            ? {}
            : { tasaImpuestoCompra: purchaseTaxRate }),
        }
      : {};

  return {
    id: `documento-${index + 1}`,
    nombre,
    sku: safeText(rawItem?.sku || rawItem?.codigo, 80) || "",
    codigo: safeText(rawItem?.codigo || rawItem?.sku, 80) || "",
    tipoItem,
    areaPropuesta: safeText(
      rawItem?.areaPropuesta || rawItem?.areaNombre || rawItem?.area,
      90
    ),
    categoriaPropuesta: safeText(
      rawItem?.categoriaPropuesta || rawItem?.categoriaNombre || rawItem?.categoria,
      90
    ),
    descripcion: safeText(rawItem?.descripcion, 300),
    unidad,
    cantidadSugerida: cantidadOrigen,
    cantidadOrigen,
    costoBase,
    margenDeseado,
    precioInterno: calculateDocumentPrice(costoBase, margenDeseado),
    observacion: itemWarnings.join(" "),
    advertencias: itemWarnings,
    evidenciaOrigen,
    pagina,
    valorCalculado,
    confianza,
    origenAnalisis: "documento",
    revisionRequerida,
    ...productFields,
  };
}

function sanitizeInventoryDocumentResult(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems
    .slice(0, MAX_DOCUMENT_ITEMS)
    .map((item, index) => normalizeInventoryDocumentItem(item, index))
    .filter(Boolean);
  const warnings = normalizeWarnings(payload?.warnings);

  items.forEach((item) => {
    const itemWarnings = [];
    item.advertencias.forEach((warning) => {
      if (isGeneralDocumentWarning(warning)) warnings.push(warning);
      else itemWarnings.push(warning);
    });
    item.advertencias = dedupeWarnings(itemWarnings);
    item.observacion = item.advertencias.join(" ");
    item.revisionRequerida =
      item.confianza === null ||
      item.confianza < 50 ||
      item.costoBase <= 0 ||
      item.advertencias.length > 0;
  });

  if (rawItems.length > items.length) {
    warnings.push(
      "Se descartaron lineas administrativas, totales o registros sin nombre comercial."
    );
  }
  if (!items.length) {
    warnings.push("No se identificaron items comerciales suficientes.");
  }

  return {
    documentType: normalizeDocumentType(payload?.documentType),
    items,
    warnings: dedupeWarnings(warnings),
  };
}

function extractJsonObject(text) {
  const raw = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) throw error;
    return JSON.parse(raw.slice(first, last + 1));
  }
}

function buildInventoryDocumentPrompt() {
  return (
    "Eres un asistente de ValoraCloud para normalizar documentos comerciales hacia una vista previa de inventario.\n" +
    "Analiza el documento completo como archivo visual, no solo como texto plano. Considera tablas, columnas, filas, encabezados, paginas repetidas, cantidades, precios unitarios y totales de linea.\n\n" +
    "Debes identificar solo lineas comerciales que puedan ser productos, servicios o actividades. Excluye razon social, RUT, direcciones, telefonos, correos, folios, numeros de factura, fechas, forma de pago, datos bancarios, subtotal, IVA, impuestos, descuentos generales, despacho, recargos, total final, observaciones comerciales, condiciones de venta y numeros de pagina.\n\n" +
    "Reglas estrictas:\n" +
    "- No inventes SKU, costos, margenes, cantidades, tipos ni identificadores persistentes.\n" +
    "- Usa null cuando un dato no este disponible.\n" +
    "- SKU o codigo solo si aparece explicitamente junto al item.\n" +
    "- Distingue precio unitario, cantidad y total de linea.\n" +
    "- Nunca uses subtotal, IVA, descuento general o total final como costo de un item.\n" +
    "- Si hay cantidad y total de linea pero no precio unitario, calcula costoBase como totalLinea / cantidad y marca valorCalculado true.\n" +
    "- Si no sabes si el precio incluye impuestos, agrega advertencia.\n" +
    "- tasaImpuestoCompra solo puede informarse si el documento muestra explícitamente la tasa y deja claro que el costo unitario es neto; en cualquier otro caso usa null y agrega advertencia.\n" +
    "- No asumas margen. margenDeseado debe ser null salvo que exista en el documento.\n" +
    "- areaPropuesta y categoriaPropuesta solo pueden contener nombres; nunca areaId ni categoriaId.\n" +
    "- No asumas Área o Categoría. Usa null salvo que estén explícitas o sean evidentes en la línea.\n" +
    "- Para Producto extrae marca, modelo, stock, stockMinimo y codigoBarras cuando aparezcan.\n" +
    "- Para Servicio o Actividad no devuelvas campos exclusivos de Producto.\n" +
    "- Conserva todas las paginas y evita duplicar encabezados repetidos.\n" +
    "- Mantiene el orden original de las lineas comerciales.\n" +
    "- Trabaja en espanol aunque existan terminos tecnicos en ingles.\n" +
    "- Devuelve exclusivamente JSON valido siguiendo el schema solicitado.\n\n" +
    "Campos esperados por item: nombre, tipoItem, areaPropuesta, categoriaPropuesta, descripcion, unidad, sku, cantidadOrigen, precioUnitario, totalLinea, costoBase, tasaImpuestoCompra, margenDeseado, marca, modelo, stock, stockMinimo, codigoBarras, confianza, evidenciaOrigen, pagina, valorCalculado y advertencias."
  );
}

function toHttpsError(error, HttpsError) {
  if (error instanceof DocumentImportError) {
    return new HttpsError(error.code, error.message);
  }
  return new HttpsError("internal", "No se pudo procesar el documento.");
}

function coerceStatusCode(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 100 && numeric <= 599) {
    return Math.round(numeric);
  }

  const match = String(value).match(/\b(400|401|403|408|409|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : null;
}

function collectErrorSignalEntries(value, depth = 0, seen = new Set(), parentKey = "") {
  if (value === null || value === undefined || depth > 8) return [];

  if (typeof value === "string" || typeof value === "number") {
    return [`${parentKey}:${String(value).slice(0, 1000)}`];
  }
  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      collectErrorSignalEntries(item, depth + 1, seen, parentKey)
    );
  }

  const allowedKeys = new Set([
    "code",
    "status",
    "statuscode",
    "name",
    "message",
    "details",
    "error",
    "cause",
    "response",
    "body",
    "quota",
    "quotafailure",
    "quotametric",
    "quotaid",
    "violations",
    "retryinfo",
    "retrydelay",
  ]);

  return Object.entries(value).flatMap(([key, child]) => {
    const normalizedKey = normalizeSearchText(key).replace(/[^a-z0-9]/g, "");
    const allowed =
      allowedKeys.has(normalizedKey) ||
      ["details", "error", "cause", "response", "body", "violations"].includes(
        parentKey
      );
    if (!allowed) return [];
    return collectErrorSignalEntries(child, depth + 1, seen, normalizedKey);
  });
}

function getErrorSignalText(error) {
  const directEntries = [
    `code:${error?.code || ""}`,
    `status:${error?.status || ""}`,
    `statusCode:${error?.statusCode || ""}`,
    `name:${error?.name || ""}`,
    `message:${error?.message || ""}`,
    `causeCode:${error?.cause?.code || ""}`,
    `causeMessage:${error?.cause?.message || ""}`,
  ];

  return [...directEntries, ...collectErrorSignalEntries(error)]
    .filter(Boolean)
    .join(" ")
    .slice(0, 12000)
    .toLowerCase();
}

function getOriginalStatus(error) {
  const directStatus = [
    error?.statusCode,
    error?.status,
    error?.code,
    error?.response?.status,
    error?.cause?.statusCode,
    error?.cause?.status,
    error?.cause?.code,
  ]
    .map(coerceStatusCode)
    .find((status) => status !== null);

  if (directStatus !== null && directStatus !== undefined) return directStatus;
  return coerceStatusCode(getErrorSignalText(error));
}

function hasDailyQuotaSignal(text) {
  const compact = text.replace(/[^a-z0-9]/g, "");
  return [
    "generaterequestsperdayperprojectpermodel",
    "generatecontentfreetierrequests",
    "requestsperday",
    "perday",
  ].some((token) => compact.includes(token));
}

function extractRetryDelayMs(error) {
  const text = getErrorSignalText(error);
  const match =
    text.match(/retrydelay[^0-9]{0,40}(\d+(?:\.\d+)?)\s*s\b/) ||
    text.match(/retry delay[^0-9]{0,40}(\d+(?:\.\d+)?)\s*s\b/);
  const visited = new Set();
  const findRetryDelay = (value, depth = 0, parentKey = "") => {
    if (value === null || value === undefined || depth > 8) return null;
    if (typeof value !== "object") {
      return parentKey === "retrydelay" ? String(value) : null;
    }
    if (visited.has(value)) return null;
    visited.add(value);

    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizeSearchText(key).replace(/[^a-z0-9]/g, "");
      if (normalizedKey === "retrydelay") {
        if (typeof child === "string" || typeof child === "number") {
          return String(child);
        }
        if (child && typeof child === "object" && child.seconds !== undefined) {
          return `${child.seconds}s`;
        }
      }
      if (
        ["details", "error", "cause", "response", "body"].includes(
          normalizedKey
        ) ||
        ["details", "error", "cause", "response", "body"].includes(parentKey)
      ) {
        const nested = findRetryDelay(child, depth + 1, normalizedKey);
        if (nested !== null) return nested;
      }
    }
    return null;
  };
  const structuredRetryDelay = findRetryDelay(error);
  const structuredMatch = structuredRetryDelay?.match(
    /^(\d+(?:\.\d+)?)\s*s$/i
  );
  const delayValue = match?.[1] || structuredMatch?.[1];
  if (!delayValue) return null;

  const delayMs = Math.round(Number(delayValue) * 1000);
  if (
    !Number.isFinite(delayMs) ||
    delayMs < 0 ||
    delayMs > MAX_SAFE_RETRY_DELAY_MS
  ) {
    return null;
  }
  return delayMs;
}

function classifyGeminiServiceError(error) {
  const text = getErrorSignalText(error);
  const compact = text.replace(/[^a-z0-9]/g, "");
  const originalStatus = getOriginalStatus(error);
  const has429 = originalStatus === 429 || /\b429\b|too many requests/.test(text);
  const hasResourceExhausted =
    compact.includes("resourceexhausted") ||
    text.includes("resource_exhausted") ||
    text.includes("resource exhausted");
  const retryDelayMs = extractRetryDelayMs(error);

  if ((has429 || hasResourceExhausted) && hasDailyQuotaSignal(text)) {
    return {
      category: GEMINI_ERROR_CATEGORIES.DAILY_QUOTA,
      originalStatus: originalStatus || 429,
      retryDelayMs: null,
      retryable: false,
    };
  }

  if (has429 || hasResourceExhausted) {
    return {
      category: GEMINI_ERROR_CATEGORIES.TRANSIENT_RATE_LIMIT,
      originalStatus: originalStatus || 429,
      retryDelayMs,
      retryable: true,
    };
  }

  if (
    originalStatus === 503 ||
    compact.includes("unavailable") ||
    compact.includes("deadlineexceeded") ||
    compact.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("temporarily") ||
    text.includes("fetch failed") ||
    text.includes("socket hang up") ||
    compact.includes("econnreset") ||
    compact.includes("etimedout")
  ) {
    return {
      category: GEMINI_ERROR_CATEGORIES.UNAVAILABLE,
      originalStatus: originalStatus || 503,
      retryDelayMs: null,
      retryable: true,
    };
  }

  if (originalStatus === 400 || compact.includes("invalidargument")) {
    return {
      category: GEMINI_ERROR_CATEGORIES.VALIDATION,
      originalStatus: originalStatus || 400,
      retryDelayMs: null,
      retryable: false,
    };
  }

  return {
    category: GEMINI_ERROR_CATEGORIES.UNKNOWN,
    originalStatus,
    retryDelayMs: null,
    retryable: false,
  };
}

function decorateGeminiError(error, classification, attempts) {
  if (!error || typeof error !== "object") return;
  error.documentImportErrorCategory = classification.category;
  error.documentImportOriginalStatus = classification.originalStatus;
  error.documentImportAttempts = attempts;
}

function getDocumentFormatForLog(documentPayload) {
  return documentPayload?.extension || documentPayload?.detectedMime || "unknown";
}

function getSafeGeminiLogCategory(category) {
  return [
    GEMINI_ERROR_CATEGORIES.DAILY_QUOTA,
    GEMINI_ERROR_CATEGORIES.TRANSIENT_RATE_LIMIT,
    GEMINI_ERROR_CATEGORIES.UNAVAILABLE,
    GEMINI_ERROR_CATEGORIES.VALIDATION,
  ].includes(category)
    ? category
    : GEMINI_ERROR_CATEGORIES.UNAVAILABLE;
}

function logDocumentAnalysisFailure(documentPayload, startedAt, classification, attempts) {
  console.error("normalizeInventoryDocument: analysis failed", {
    documentFormat: getDocumentFormatForLog(documentPayload),
    sizeBytes: Number(documentPayload?.bytes || 0),
    statusOriginal: classification.originalStatus || "unknown",
    category: getSafeGeminiLogCategory(classification.category),
    attempts,
    durationMs: Date.now() - startedAt,
  });
}

async function generateDocumentContent(generateGeminiContent, documentPayload) {
  try {
    return await generateGeminiContent({
      model: DOCUMENT_GEMINI_MODEL,
      functionName: "normalizeInventoryDocument",
      contents: [
        {
          role: "user",
          parts: [
            { text: buildInventoryDocumentPrompt() },
            {
              inlineData: {
                mimeType: documentPayload.detectedMime,
                data: documentPayload.base64,
              },
            },
          ],
        },
      ],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: INVENTORY_DOCUMENT_RESPONSE_SCHEMA,
      },
    });
  } catch (error) {
    const classification = classifyGeminiServiceError(error);
    decorateGeminiError(error, classification, 1);
    throw error;
  }
}

async function normalizeInventoryDocumentHandler(
  request,
  {
    generateGeminiContent,
    HttpsError,
  }
) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  let documentPayload;
  try {
    documentPayload = validateInventoryDocumentPayload(request.data || {});
  } catch (error) {
    throw toHttpsError(error, HttpsError);
  }

  const startedAt = Date.now();
  if (typeof generateGeminiContent !== "function") {
    throw new HttpsError("unavailable", DOCUMENT_UNAVAILABLE_MESSAGE);
  }

  try {
    const { response, aiRateLimit } = await generateDocumentContent(
      generateGeminiContent,
      documentPayload
    );
    const parsed = extractJsonObject(response.text);
    const normalized = sanitizeInventoryDocumentResult(parsed);

    return {
      items: normalized.items,
      source: "gemini-document",
      mode: "document-multimodal",
      model: DOCUMENT_GEMINI_MODEL,
      documentType: normalized.documentType,
      warnings: normalized.warnings,
      aiRateLimit,
      warning:
        normalized.warnings[0] ||
        "Documento procesado. Revisa los candidatos antes de guardar.",
    };
  } catch (error) {
    if (error?.details?.reason) throw error;

    const baseClassification = classifyGeminiServiceError(error);
    const classification = {
      ...baseClassification,
      category:
        error?.documentImportErrorCategory ||
        baseClassification.category,
      originalStatus:
        error?.documentImportOriginalStatus ??
        baseClassification.originalStatus,
    };
    const attempts = Number(error?.documentImportAttempts || 1);
    logDocumentAnalysisFailure(documentPayload, startedAt, classification, attempts);

    if (classification.category === GEMINI_ERROR_CATEGORIES.DAILY_QUOTA) {
      throw new HttpsError(
        "resource-exhausted",
        DOCUMENT_USAGE_LIMIT_MESSAGE,
        { internalCode: GEMINI_ERROR_CATEGORIES.DAILY_QUOTA }
      );
    }

    if (
      classification.category === GEMINI_ERROR_CATEGORIES.TRANSIENT_RATE_LIMIT ||
      classification.category === GEMINI_ERROR_CATEGORIES.UNAVAILABLE
    ) {
      throw new HttpsError("unavailable", TEMPORARY_DOCUMENT_UNAVAILABLE_MESSAGE);
    }

    throw new HttpsError("unavailable", DOCUMENT_UNAVAILABLE_MESSAGE);
  }
}

module.exports = {
  ALLOWED_DOCUMENT_MIME_TYPES,
  DOCUMENT_GEMINI_MODEL,
  DOCUMENT_USAGE_LIMIT_MESSAGE,
  DOCUMENT_UNAVAILABLE_MESSAGE,
  EXTENSION_TO_MIME,
  MAX_DOCUMENT_IMPORT_BYTES,
  TEMPORARY_DOCUMENT_UNAVAILABLE_MESSAGE,
  classifyGeminiServiceError,
  detectMimeFromMagic,
  generateDocumentContent,
  normalizeInventoryDocumentHandler,
  sanitizeInventoryDocumentResult,
  validateInventoryDocumentPayload,
};
