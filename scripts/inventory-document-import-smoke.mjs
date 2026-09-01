import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const receptionFixture = JSON.parse(readFileSync(
  new URL("./fixtures/reception-document-prodalam.json", import.meta.url),
  "utf8"
));
const inventoryInvoiceFixture = JSON.parse(readFileSync(
  new URL("./fixtures/inventory-document-invoice-qa.json", import.meta.url),
  "utf8"
));

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
assert.equal(normalizedRules.warnings.length, 2);
assert.equal(
  normalizedRules.warnings.filter((warning) => /margen predeterminado/i.test(warning)).length,
  1
);
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
const normalizedReceptionDocument = sanitizeInventoryDocumentResult(
  receptionFixture,
  {context: "reception"}
);
assert.equal(normalizedReceptionDocument.documentType, "factura");
assert.equal(normalizedReceptionDocument.documento.tipo, "FACTURA ELECTRÓNICA");
assert.equal(normalizedReceptionDocument.documento.numero, "06897040");
assert.equal(normalizedReceptionDocument.documento.fechaEmision, "2026-08-24");
assert.equal(normalizedReceptionDocument.documento.fechaVencimiento, "2026-08-24");
assert.equal(normalizedReceptionDocument.documento.condicionPago, "WebPay");
assert.equal(normalizedReceptionDocument.documento.moneda, "CLP");
assert.equal(normalizedReceptionDocument.proveedor.nombre, "Prodalam S.A.");
assert.equal(normalizedReceptionDocument.proveedor.identificadorFiscal, "93.772.000-9");
assert.equal(normalizedReceptionDocument.receptor.nombre, "Servicios Integrales Bagner SPA");
assert.equal(normalizedReceptionDocument.receptor.identificadorFiscal, "77.091.679-8");
assert.notEqual(normalizedReceptionDocument.proveedor.nombre, normalizedReceptionDocument.receptor.nombre);
assert.equal(normalizedReceptionDocument.items.length, 9);
assert.deepEqual(normalizedReceptionDocument.items.map((item) => item.codigoProveedor), [
  "32375", "22378", "22384", "32318", "9447", "32328", "70783", "9467", "9479",
]);
assert.deepEqual(normalizedReceptionDocument.items.map((item) => item.cantidadOrigen), [
  2, 1, 2, 3, 4, 5, 6, 7, 1,
]);
assert.equal(normalizedReceptionDocument.items[0].costoUnitario, 3636);
assert.equal(normalizedReceptionDocument.items[0].totalLinea, 7272);
assert.equal(normalizedReceptionDocument.items.every((item) => item.codigoBarras === ""), true);
assert.equal(normalizedReceptionDocument.items.some((item) => item.codigoProveedor === "987654321"), false);
assert.equal(normalizedReceptionDocument.totales.neto, 337942);
assert.equal(normalizedReceptionDocument.totales.impuestoPorcentaje, 19);
assert.equal(normalizedReceptionDocument.totales.impuestoMonto, 64209);
assert.equal(normalizedReceptionDocument.totales.total, 402151);
assert.equal(normalizedReceptionDocument.coherencia.estado, "coherente");
assert.match(normalizedReceptionDocument.warnings.join(" "), /9 lineas repetidas/i);

const normalizedPurchaseDocument = sanitizeInventoryDocumentResult(
  receptionFixture,
  {context: "purchase"}
);
assert.equal(normalizedPurchaseDocument.documentType, "factura");
assert.equal(normalizedPurchaseDocument.proveedor.identificadorFiscal, "93.772.000-9");
assert.equal(normalizedPurchaseDocument.items.length, 9);
assert.equal(normalizedPurchaseDocument.items[0].cantidadOrigen, 2);
assert.equal(normalizedPurchaseDocument.items[0].costoUnitario, 3636);
assert.equal(normalizedPurchaseDocument.totales.impuestoMonto, 64209);
assert.equal(normalizedPurchaseDocument.inferenciaImpuestoCompra.estado, "no_aplica");
console.log("OK documento de compra: extractor compartido conserva proveedor, líneas y tributos");

const normalizedInventoryInvoice = sanitizeInventoryDocumentResult(
  inventoryInvoiceFixture,
  {
    context: "inventory",
    businessTax: {
      paisCodigo: "CL",
      impuestoPredeterminadoTasa: 19,
      configuracionTributariaBaseCompleta: true,
    },
  }
);
assert.equal(normalizedInventoryInvoice.items.length, 9);
assert.deepEqual(normalizedInventoryInvoice.items.map((item) => item.codigoProveedor), [
  "32375", "22378", "22384", "32318", "9447", "32328", "70783", "9467", "9479",
]);
assert.deepEqual(normalizedInventoryInvoice.items.map((item) => item.cantidadOrigen), [
  2, 4, 8, 2, 2, 3, 2, 4, 3,
]);
assert.deepEqual(normalizedInventoryInvoice.items.map((item) => item.costoBase), [
  3636, 2702, 4220, 6034, 14697, 20985, 21672, 11588, 30663,
]);
assert.equal(
  normalizedInventoryInvoice.items.reduce(
    (sum, item) => sum + item.cantidadOrigen * item.costoBase,
    0
  ),
  337942
);
assert.equal(normalizedInventoryInvoice.totales.neto, 337942);
assert.equal(normalizedInventoryInvoice.totales.impuestoPorcentaje, 19);
assert.equal(normalizedInventoryInvoice.totales.impuestoMonto, 64209);
assert.equal(normalizedInventoryInvoice.totales.total, 402151);
assert.equal(normalizedInventoryInvoice.coherencia.estado, "coherente");
assert.equal(normalizedInventoryInvoice.inferenciaImpuestoCompra.estado, "aplicado");
assert.equal(normalizedInventoryInvoice.items.every((item) => item.tasaImpuestoCompra === 19), true);
assert.equal(normalizedInventoryInvoice.items.every((item) => item.revisionRequerida === false), true);
assert.equal(normalizedInventoryInvoice.warnings.filter((warning) => /margen predeterminado/i.test(warning)).length, 1);
assert.doesNotMatch(normalizedInventoryInvoice.warnings.join(" "), /no se pudo determinar la tasa/i);
assert.match(normalizedInventoryInvoice.warnings.join(" "), /9 lineas repetidas/i);

const taxMismatchInvoice = sanitizeInventoryDocumentResult(
  inventoryInvoiceFixture,
  {
    context: "inventory",
    businessTax: {
      paisCodigo: "PE",
      impuestoPredeterminadoTasa: 18,
      configuracionTributariaBaseCompleta: true,
    },
  }
);
assert.equal(taxMismatchInvoice.inferenciaImpuestoCompra.estado, "requiere_revision");
assert.equal(taxMismatchInvoice.items.some((item) => item.tasaImpuestoCompra === 19), false);
console.log("OK inventario: 9 líneas únicas, costos netos, IVA contextual y advertencias no bloqueantes");

const nonAggressiveDuplicates = sanitizeInventoryDocumentResult({
  documentType: "factura",
  items: [
    {nombre: "Posición repetida real", tipoItem: "producto", codigoProveedor: "A", cantidadOrigen: 1, costoUnitario: 10, totalLinea: 10, pagina: 1, confianza: 90},
    {nombre: "Posición repetida real", tipoItem: "producto", codigoProveedor: "A", cantidadOrigen: 1, costoUnitario: 10, totalLinea: 10, pagina: 1, confianza: 90},
  ],
}, {context: "reception"});
assert.equal(nonAggressiveDuplicates.items.length, 2);

const mixedLocale = sanitizeInventoryDocumentResult({
  documentType: "factura",
  items: [
    {nombre: "Formato europeo", tipoItem: "producto", cantidadOrigen: "1", costoUnitario: "1.234,56", totalLinea: "1.234,56", confianza: 90},
    {nombre: "Formato anglosajón", tipoItem: "producto", cantidadOrigen: "1", costoUnitario: "1,234.56", totalLinea: "1,234.56", confianza: 90},
  ],
}, {context: "reception"});
assert.deepEqual(mixedLocale.items.map((item) => item.costoUnitario), [1235, 1235]);

const inconsistentTotals = sanitizeInventoryDocumentResult({
  documentType: "factura",
  totales: {neto: 100, impuestoMonto: 19, total: 999},
  items: [{nombre: "Producto", tipoItem: "producto", cantidadOrigen: 1, costoUnitario: 100, totalLinea: 80, confianza: 90}],
}, {context: "reception"});
assert.equal(inconsistentTotals.coherencia.estado, "revisar");
assert.match(inconsistentTotals.warnings.join(" "), /Revisar totales/i);
console.log("OK recepción: emisor/receptor, folio, CEDIBLE, códigos, números chilenos y totales");

let receptionPrompt = "";
const receptionHandlerResult = await normalizeInventoryDocumentHandler(
  {
    auth: {uid: "usuario-prueba"},
    data: {
      ...payloadFor(validPdf, "factura.pdf", "application/pdf"),
      context: "reception",
    },
  },
  {
    generateGeminiContent: async (options) => {
      receptionPrompt = options.contents[0].parts[0].text;
      return makeGeminiJsonResult(receptionFixture);
    },
    HttpsError: FakeHttpsError,
  }
);
assert.match(receptionPrompt, /EMISOR\/PROVEEDOR/);
assert.match(receptionPrompt, /ORIGINAL\/CEDIBLE/);
assert.match(receptionPrompt, /codigoProveedor/);
assert.equal(receptionHandlerResult.items.length, 9);
assert.equal(receptionHandlerResult.proveedor.nombre, "Prodalam S.A.");
assert.equal(receptionHandlerResult.totales.total, 402151);

const inventoryHandlerResult = await normalizeInventoryDocumentHandler(
  {
    auth: {uid: "usuario-prueba"},
    data: payloadFor(validPdf, "factura-sintetica.pdf", "application/pdf"),
  },
  {
    businessTax: {
      paisCodigo: "CL",
      impuestoPredeterminadoTasa: 19,
      configuracionTributariaBaseCompleta: true,
    },
    generateGeminiContent: async () => makeGeminiJsonResult(inventoryInvoiceFixture),
    HttpsError: FakeHttpsError,
  }
);
assert.equal(inventoryHandlerResult.items.length, 9);
assert.equal(inventoryHandlerResult.inferenciaImpuestoCompra.estado, "aplicado");
assert.equal(inventoryHandlerResult.items.every((item) => item.tasaImpuestoCompra === 19), true);

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

const functionsSource = readFileSync(
  new URL("../functions/index.js", import.meta.url),
  "utf8"
);
assert.match(functionsSource, /const GENERATIVE_AI_ENABLED = false;/);
assert.match(functionsSource, /const DOCUMENT_GENERATIVE_AI_ENABLED = true;/);
assert.match(
  functionsSource,
  /generateGeminiContent: generateInventoryDocumentContent/
);
assert.match(
  functionsSource,
  /enabled: DOCUMENT_GENERATIVE_AI_ENABLED/
);
assert.match(
  functionsSource,
  /const assistantMode = GENERATIVE_AI_ENABLED\s+\? normalizeAssistantMode\(data\.assistantMode\)\s+: "local";/
);
console.log("OK aislamiento: Gemini se habilita sólo para importación documental");

console.log("INVENTORY_DOCUMENT_IMPORT_SMOKE_OK");
