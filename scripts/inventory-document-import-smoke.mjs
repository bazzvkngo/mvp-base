import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DOCUMENT_USAGE_LIMIT_MESSAGE,
  MAX_DOCUMENT_IMPORT_BYTES,
  TEMPORARY_DOCUMENT_UNAVAILABLE_MESSAGE,
  classifyGeminiServiceError,
  normalizeInventoryDocumentHandler,
  sanitizeInventoryDocumentResult,
  validateInventoryDocumentPayload,
} = require("../functions/inventoryDocumentImport.js");

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function makeGeminiJsonResult(payload) {
  return {
    response: {
      text: JSON.stringify(payload),
    },
    aiRateLimit: {
      allowed: false,
      reason: "cooldown",
      retryAt: new Date(Date.now() + 20000).toISOString(),
    },
  };
}

function makeTemporaryError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  error.status = code;
  return error;
}

function makeGeminiServiceError({
  code = 429,
  status = "RESOURCE_EXHAUSTED",
  message = "synthetic service error",
  quotaMetric = "",
  quotaId = "",
  retryDelay = "",
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.statusCode = Number.isFinite(Number(code)) ? Number(code) : undefined;
  error.error = {
    code,
    status,
    message,
    details: [],
  };

  if (quotaMetric || quotaId) {
    error.error.details.push({
      "@type": "type.googleapis.com/google.rpc.QuotaFailure",
      violations: [
        {
          quotaMetric,
          quotaId,
        },
      ],
    });
  }
  if (retryDelay) {
    error.error.details.push({
      "@type": "type.googleapis.com/google.rpc.RetryInfo",
      retryDelay,
    });
  }

  return error;
}

function makePdf({ encrypted = false, pageCount = 1 } = {}) {
  const encryption = encrypted ? "\n5 0 obj << /Filter /Standard >> endobj\n" : "";
  const trailer = encrypted ? "trailer << /Root 1 0 R /Encrypt 5 0 R >>" : "trailer << /Root 1 0 R >>";
  const pageObject =
    pageCount > 0
      ? "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >> endobj\n"
      : "";

  return Buffer.from(
    `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count ${pageCount} /Kids [3 0 R] >> endobj
${pageObject}4 0 obj << /Length 96 >> stream
BT /F1 12 Tf 10 180 Td (Factura sintetica de prueba sin datos reales) Tj ET
endstream endobj
${encryption}${trailer}
%%EOF`,
    "latin1"
  );
}

function makePng() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 0),
  ]);
}

function payloadFor(buffer, name, mime) {
  return {
    document: {
      nombreArchivo: name,
      tipoArchivo: mime,
      tamanoBytes: buffer.length,
      base64: buffer.toString("base64"),
    },
  };
}

function expectInvalid(label, operation) {
  try {
    operation();
  } catch (error) {
    assert.equal(error.name, "DocumentImportError", label);
    console.log(`OK rechazo controlado: ${label}`);
    return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

const validPdf = makePdf();
const validPng = makePng();

const pdfResult = validateInventoryDocumentPayload(
  payloadFor(validPdf, "factura-sintetica.pdf", "application/pdf")
);
assert.equal(pdfResult.detectedMime, "application/pdf");
console.log("OK permitido: PDF sintético válido");

const pngResult = validateInventoryDocumentPayload(
  payloadFor(validPng, "lista-precios-sintetica.png", "image/png")
);
assert.equal(pngResult.detectedMime, "image/png");
console.log("OK permitido: PNG sintético válido");

expectInvalid("archivo HTML renombrado como PDF", () =>
  validateInventoryDocumentPayload(
    payloadFor(Buffer.from("<html>prueba</html>"), "factura.pdf", "application/pdf")
  )
);

expectInvalid("MIME falso", () =>
  validateInventoryDocumentPayload(
    payloadFor(validPdf, "factura.pdf", "image/png")
  )
);

expectInvalid("Base64 inválido", () =>
  validateInventoryDocumentPayload({
    document: {
      nombreArchivo: "factura.pdf",
      tipoArchivo: "application/pdf",
      tamanoBytes: validPdf.length,
      base64: "%%%=",
    },
  })
);

expectInvalid("PDF protegido", () =>
  validateInventoryDocumentPayload(
    payloadFor(makePdf({ encrypted: true }), "factura-protegida.pdf", "application/pdf")
  )
);

expectInvalid("PDF sin páginas", () =>
  validateInventoryDocumentPayload(
    payloadFor(makePdf({ pageCount: 0 }), "factura-sin-paginas.pdf", "application/pdf")
  )
);

expectInvalid("archivo superior a 5 MB", () =>
  validateInventoryDocumentPayload({
    document: {
      nombreArchivo: "factura-grande.pdf",
      tipoArchivo: "application/pdf",
      tamanoBytes: MAX_DOCUMENT_IMPORT_BYTES + 1,
      base64: validPdf.toString("base64"),
    },
  })
);

const sanitized = sanitizeInventoryDocumentResult({
  documentType: "factura",
  items: [
    {
      nombre: "Servicio de instalacion red oficina",
      tipoItem: "servicio",
      cantidadOrigen: 2,
      totalLinea: 50000,
      confianza: 82,
      unidad: "servicio",
      marca: "No debe persistir",
      modelo: "No debe persistir",
      stock: 2,
    },
    { nombre: "IVA 19%", costoBase: 9500, confianza: 90 },
    { nombre: "Subtotal", costoBase: 50000, confianza: 90 },
    { nombre: "Total final", costoBase: 59500, confianza: 90 },
    {
      nombre: "Cable Cat6 20x10",
      tipoItem: "producto",
      confianza: 42,
      unidad: "metro",
      areaPropuesta: "Informática",
      categoriaPropuesta: "Redes",
      marca: "Furukawa",
      modelo: "Cat6",
      stock: 20,
      stockMinimo: 5,
      codigoBarras: "780000000123",
      tasaImpuestoCompra: 19,
    },
  ],
  warnings: [],
});

assert.equal(sanitized.documentType, "factura");
assert.equal(sanitized.items.length, 2);
assert.equal(sanitized.items[0].costoBase, 25000);
assert.equal(sanitized.items[0].valorCalculado, true);
assert.equal(sanitized.items[1].costoBase, 0);
assert.equal(sanitized.items[1].revisionRequerida, true);
assert.equal("marca" in sanitized.items[0], false);
assert.equal("stock" in sanitized.items[0], false);
assert.equal(sanitized.items[1].areaPropuesta, "Informática");
assert.equal(sanitized.items[1].categoriaPropuesta, "Redes");
assert.equal(sanitized.items[1].marca, "Furukawa");
assert.equal(sanitized.items[1].stockMinimo, 5);
assert.equal(sanitized.items[1].tasaImpuestoCompra, 19);
assert.ok(!sanitized.items.some((item) => /iva|subtotal|total/i.test(item.nombre)));
console.log("OK sanitización: IVA, subtotal y total no se importan como items");

const normalizedRules = sanitizeInventoryDocumentResult({
  documentType: "cotizacion",
  warnings: [
    "Los precios no indican si incluyen impuestos.",
    " los precios no indican si incluyen impuestos. ",
  ],
  items: [
    {
      nombre: "Producto margen decimal coma",
      tipoItem: "producto",
      costoBase: 10000,
      margenDeseado: "40,6",
      cantidadOrigen: 0,
      confianza: 0.9,
      advertencias: [
        "Advertencia duplicada",
        " advertencia   duplicada ",
        "Los precios no indican si incluyen impuestos.",
      ],
    },
    {
      nombre: "Servicio margen decimal punto",
      tipoItem: "servicio",
      costoBase: 20000,
      margenDeseado: "33.45",
      confianza: 90,
    },
    {
      nombre: "Producto sin margen",
      tipoItem: "producto",
      costoBase: 1000,
      confianza: null,
    },
  ],
});

assert.equal(normalizedRules.items[0].margenDeseado, 40.6);
assert.equal(normalizedRules.items[1].margenDeseado, 33.45);
assert.equal(normalizedRules.items[2].margenDeseado, 25);
assert.equal(normalizedRules.items[2].precioInterno, 1250);
assert.equal(normalizedRules.items[0].cantidadSugerida, 1);
assert.equal(normalizedRules.items[0].unidad, "unidad");
assert.equal(normalizedRules.items[1].unidad, "servicio");
assert.equal(normalizedRules.items[0].advertencias.length, 1);
assert.equal(
  normalizedRules.items[0].advertencias.includes(
    "Los precios no indican si incluyen impuestos."
  ),
  false
);
assert.equal(normalizedRules.warnings.length, 1);
assert.equal(normalizedRules.items[0].confianza, 90);
assert.equal(normalizedRules.items[1].confianza, 90);
assert.equal(normalizedRules.items[2].confianza, null);
console.log("OK reglas: margen decimal, margen por defecto, unidad, cantidad, confianza y deduplicación");

try {
  await normalizeInventoryDocumentHandler(
    { auth: null, data: payloadFor(validPdf, "factura.pdf", "application/pdf") },
    { generateGeminiContent: async () => null, HttpsError: FakeHttpsError }
  );
  throw new Error("Se esperaba rechazo por usuario no autenticado.");
} catch (error) {
  assert.equal(error.code, "unauthenticated");
  console.log("OK seguridad: usuario no autenticado rechazado");
}

const dailyQuotaError = makeGeminiServiceError({
  code: 429,
  status: "RESOURCE_EXHAUSTED",
  message: "synthetic daily quota error",
  quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
  quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
  retryDelay: "8s",
});
assert.equal(classifyGeminiServiceError(dailyQuotaError).category, "daily_quota");

let dailyQuotaAttempts = 0;
try {
  await normalizeInventoryDocumentHandler(
    {
      auth: { uid: "usuario-prueba" },
      data: payloadFor(validPdf, "factura.pdf", "application/pdf"),
    },
    {
      generateGeminiContent: async () => {
        dailyQuotaAttempts += 1;
        throw dailyQuotaError;
      },
      HttpsError: FakeHttpsError,
    }
  );
  throw new Error("Se esperaba error de cuota diaria.");
} catch (error) {
  assert.equal(error.code, "resource-exhausted");
  assert.equal(error.message, DOCUMENT_USAGE_LIMIT_MESSAGE);
  assert.deepEqual(error.details, { internalCode: "daily_quota" });
  assert.equal(dailyQuotaAttempts, 1);
  console.log("OK cuota diaria: 429 PerDay no reintenta y devuelve resource-exhausted");
}

let retryAttempts429 = 0;
try {
  await normalizeInventoryDocumentHandler(
    {
      auth: { uid: "usuario-prueba" },
      data: payloadFor(validPdf, "factura.pdf", "application/pdf"),
    },
    {
      generateGeminiContent: async () => {
        retryAttempts429 += 1;
        throw makeGeminiServiceError({
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "synthetic transient rate limit",
          retryDelay: "2s",
        });
      },
      HttpsError: FakeHttpsError,
    }
  );
  throw new Error("Se esperaba error temporal de Gemini.");
} catch (error) {
  assert.equal(error.code, "unavailable");
  assert.equal(retryAttempts429, 1);
  console.log("OK protección: 429 temporal no ejecuta reintentos automáticos");
}

let retryAttempts503 = 0;
try {
  await normalizeInventoryDocumentHandler(
    {
      auth: { uid: "usuario-prueba" },
      data: payloadFor(validPdf, "factura.pdf", "application/pdf"),
    },
    {
      generateGeminiContent: async () => {
        retryAttempts503 += 1;
        throw makeTemporaryError(503, "UNAVAILABLE");
      },
      HttpsError: FakeHttpsError,
    }
  );
  throw new Error("Se esperaba error temporal del proveedor.");
} catch (error) {
  assert.equal(error.code, "unavailable");
  assert.equal(retryAttempts503, 1);
  console.log("OK protección: 503 no ejecuta reintentos automáticos");
}

const migratedSdkResult = await normalizeInventoryDocumentHandler(
  {
    auth: { uid: "usuario-prueba" },
    data: payloadFor(validPdf, "factura.pdf", "application/pdf"),
  },
  {
    generateGeminiContent: async () =>
      makeGeminiJsonResult({
        items: [
          {
            nombre: "Producto de prueba",
            tipoItem: "producto",
            cantidadOrigen: 2,
            unidad: "unidad",
            costoBase: 1500,
            confianza: 90,
            areaPropuesta: "Informática",
            categoriaPropuesta: "Hardware",
            marca: "Marca prueba",
            modelo: "Modelo prueba",
            stock: 2,
            stockMinimo: 0,
          },
        ],
      }),
    HttpsError: FakeHttpsError,
  }
);
assert.equal(migratedSdkResult.items.length, 1);
assert.equal(migratedSdkResult.items[0].nombre, "Producto de prueba");
assert.equal(migratedSdkResult.items[0].areaPropuesta, "Informática");
assert.equal(migratedSdkResult.items[0].marca, "Marca prueba");
assert.equal(migratedSdkResult.aiRateLimit.reason, "cooldown");
console.log("OK SDK migrado: consume response.text y conserva metadatos del limitador");

let validationGeminiCalls = 0;
try {
  await normalizeInventoryDocumentHandler(
    {
      auth: { uid: "usuario-prueba" },
      data: {
        document: {
          nombreArchivo: "factura.pdf",
          tipoArchivo: "application/pdf",
          tamanoBytes: validPdf.length,
          base64: "%%%=",
        },
      },
    },
    {
      generateGeminiContent: async () => {
        validationGeminiCalls += 1;
        return null;
      },
      HttpsError: FakeHttpsError,
    }
  );
  throw new Error("Se esperaba error de validación.");
} catch (error) {
  assert.equal(error.code, "invalid-argument");
  assert.equal(validationGeminiCalls, 0);
  console.log("OK validación: una entrada inválida no invoca Gemini");
}

console.log("INVENTORY_DOCUMENT_IMPORT_SMOKE_OK");
