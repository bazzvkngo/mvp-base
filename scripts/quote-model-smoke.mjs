import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {
  adaptStoredQuote,
  buildQuoteMutationPayload,
  buildQuotePayload,
  calculateQuoteExpiryDate,
  calculateQuoteLineTotal,
  calculateQuoteTotals,
  canDuplicateQuotes,
  DRAFT_QUOTE_NUMBER_LABEL,
  getQuoteStatusLabel,
  getQuotePdfFileName,
  normalizeQuoteItem,
  normalizeScopeSections,
  resolveQuoteClientSelectionSnapshot,
} from "../src/domain/quoteModel.mjs";
import {filterSelectableClients} from "../src/domain/clientModel.mjs";
import { buildQuotePdfDocument } from "../src/domain/quoteDocument.mjs";

const require = createRequire(import.meta.url);
const {historicalQuoteCopyInput} = require("../functions/quotePersistence.js");

const company = {
  nombreComercial: "BAGNER Servicios Integrales",
  razonSocial: "Bagner Servicios Integrales SpA",
  rut: "77.091.679-8",
  direccion: "Tamarugal 2985",
  ciudad: "Iquique",
  region: "I Región",
  responsable: "Bruno Pairumani Altieri",
  telefono: "+56 9 8247 0752",
  email: "bruno.pairumani@bagner.cl",
  condicionesPago: "50% al inicio y 50% al finalizar el trabajo",
  validezCotizacionDias: 10,
};

function item(index, overrides = {}) {
  return {
    lineaId: `linea-${index}`,
    itemId: `inventario-${index}`,
    codigo: `SRV-${String(index).padStart(4, "0")}`,
    nombre: `Servicio ${index}`,
    descripcionComercial: "Fabricación, instalación y terminaciones según alcance acordado.",
    tipoItem: "servicio",
    unidad: "servicio",
    cantidad: 1,
    precioUnitarioEditable: 1000,
    descuentoPorcentaje: 0,
    inventarioSnapshot: {
      inventarioId: `inventario-${index}`,
      codigoInterno: `SRV-${String(index).padStart(4, "0")}`,
      nombre: `Servicio ${index}`,
      tipoItem: "servicio",
      areaId: "area-servicios",
      categoriaId: "categoria-fabricacion",
      categoria: "Fabricación",
      unidad: "servicio",
      modeloInventarioVersion: 2,
    },
    ...overrides,
  };
}

function quoteFixture(overrides = {}) {
  return buildQuotePayload(
    "test-user",
    {
      numero: "COT-2026-0114",
      fecha: "2026-06-25",
      estado: "emitida",
      validezDias: 10,
      afectaIva: true,
      clienteNombre: "Abastible",
      clienteRut: "76.123.456-7",
      clienteContacto: "Pablo Acuña",
      clienteEmail: "pablo@example.cl",
      clienteTelefono: "+56 9 1111 2222",
      clienteDireccion: "Zona industrial",
      clienteCiudad: "Iquique",
      proyectoNombre: "Escalera zona de estanque",
      empresa: company,
      items: [item(1, { precioUnitarioEditable: 350000 })],
      descuento: 0,
      seccionesAlcance: [
        {
          id: "servicios",
          titulo: "Servicios",
          lineas: [
            "Fabricación de escalera de dos peldaños con estructura de 1,40 m.",
            "Aplicación de anticorrosivo y pintura amarilla.",
          ],
        },
        {
          id: "materiales",
          titulo: "Materiales",
          lineas: ["Perfil 40x40, ángulo 40x40, pintura y anticorrosivo."],
        },
      ],
      condiciones: {
        plazoEntrega: "3 días hábiles",
        formaPago: company.condicionesPago,
        alcanceGeografico: "Iquique y Alto Hospicio",
        garantia: "Garantía de 6 meses por fabricación.",
        observaciones: "Coordinación previa para ingreso a planta.",
        exclusiones: "No incluye obras civiles adicionales.",
        terminosAdicionales: "Los trabajos adicionales requieren aprobación escrita.",
      },
      aceptacion: {
        habilitada: true,
        texto: "Acepto los términos y condiciones de esta cotización.",
      },
      ...overrides,
    },
    { issueDate: "2026-06-25" }
  );
}

assert.equal(quoteFixture().cliente.empresa, "Abastible");
assert.notEqual(quoteFixture().cliente.empresa, "[object Object]");

const registeredClient = {
  clienteId: "cliente-principal",
  negocioId: "negocio-principal",
  estado: "activo",
  tipoCliente: "empresa",
  rut: "12.345.678-5",
  nombreRazonSocial: "Cliente registrado SpA",
  giro: "Servicios",
  email: "contacto@registrado.test",
  telefono: "+56 9 2222 3333",
  direccion: "Avenida Uno 123",
  regionCodigo: "13",
  regionNombre: "Metropolitana de Santiago",
  comunaCodigo: "13101",
  comunaNombre: "Santiago",
  personaContacto: "Ana Pérez",
};
const linkedMutation = buildQuoteMutationPayload("test-user", {
  ...quoteFixture(),
  clienteId: registeredClient.clienteId,
  cliente: registeredClient,
  trabajoId: "work-1",
  trabajoNumero: "TRB-FALSO",
  trabajoTitulo: "Proyecto falso",
});
assert.equal(linkedMutation.clienteId, registeredClient.clienteId);
assert.equal(linkedMutation.trabajoId, "work-1");
assert.equal("trabajoNumero" in linkedMutation, false);
assert.equal("trabajoTitulo" in linkedMutation, false);
assert.equal("clientId" in linkedMutation, false);
assert.equal("cliente" in linkedMutation, false);
assert.equal("empresa" in linkedMutation, false);
assert.equal("empresaSnapshot" in linkedMutation, false);
assert.equal("clienteNombre" in linkedMutation, false);
assert.equal("clienteRut" in linkedMutation, false);
console.log("OK contrato: mutación vinculada envía clienteId sin snapshot autoritativo");

const originalClientASnapshot = {
  ...registeredClient,
  nombreRazonSocial: "Cliente A histórico SpA",
  email: "historico-a@example.test",
  direccion: "Dirección histórica 100",
};
const liveClientA = {
  ...registeredClient,
  nombreRazonSocial: "Cliente A actualizado SpA",
  email: "actual-a@example.test",
  direccion: "Dirección actual 999",
};
const liveClientB = {
  ...registeredClient,
  clienteId: "cliente-b",
  nombreRazonSocial: "Cliente B SpA",
  email: "cliente-b@example.test",
};
const originalSelection = {
  originalClienteId: registeredClient.clienteId,
  originalClientSnapshot: originalClientASnapshot,
};

const selectedB = resolveQuoteClientSelectionSnapshot(
  liveClientB,
  originalSelection
);
assert.equal(selectedB.clienteId, liveClientB.clienteId);
assert.equal(selectedB.nombreRazonSocial, liveClientB.nombreRazonSocial);
assert.equal(selectedB.email, liveClientB.email);

const returnedToA = resolveQuoteClientSelectionSnapshot(
  liveClientA,
  originalSelection
);
assert.equal(returnedToA.clienteId, registeredClient.clienteId);
assert.equal(returnedToA.nombreRazonSocial, originalClientASnapshot.nombreRazonSocial);
assert.equal(returnedToA.email, originalClientASnapshot.email);
assert.equal(returnedToA.direccion, originalClientASnapshot.direccion);

const directlySelectedA = resolveQuoteClientSelectionSnapshot(
  liveClientA,
  originalSelection
);
assert.deepEqual(directlySelectedA, returnedToA);

const newQuoteSelection = resolveQuoteClientSelectionSnapshot(liveClientA);
assert.equal(newQuoteSelection.nombreRazonSocial, liveClientA.nombreRazonSocial);
assert.equal(newQuoteSelection.email, liveClientA.email);

const legacySelection = resolveQuoteClientSelectionSnapshot(liveClientA, {
  originalClienteId: "",
  originalClientSnapshot: {
    nombreRazonSocial: "Cliente histórico sin vínculo",
  },
});
assert.equal(legacySelection.clienteId, liveClientA.clienteId);
assert.equal(legacySelection.nombreRazonSocial, liveClientA.nombreRazonSocial);

const restoredMutation = buildQuoteMutationPayload("test-user", {
  ...quoteFixture(),
  clienteId: returnedToA.clienteId,
  cliente: returnedToA,
});
assert.equal(restoredMutation.clienteId, registeredClient.clienteId);
assert.equal("cliente" in restoredMutation, false);
assert.equal("clienteNombre" in restoredMutation, false);
assert.equal("clienteRut" in restoredMutation, false);
console.log("OK edición: restaura A histórico, muestra B vivo y permite vínculo nuevo/legacy");

const selectableClients = [
  registeredClient,
  {...registeredClient, clienteId: "archivado", estado: "archivado"},
  {...registeredClient, clienteId: "externo", negocioId: "negocio-externo"},
];
assert.deepEqual(
  filterSelectableClients(selectableClients, "negocio-principal", "registrado")
    .map((client) => client.clienteId),
  ["cliente-principal"]
);
assert.equal(
  filterSelectableClients(selectableClients, "negocio-principal", "123456785").length,
  1
);
assert.equal(filterSelectableClients(selectableClients, "negocio-externo").length, 1);
assert.equal(filterSelectableClients(selectableClients, "").length, 0);
console.log("OK selector: busca nombre/RUT, excluye archivados y aísla por negocio");

assert.equal(calculateQuoteLineTotal(item(1, { cantidad: 2, precioUnitarioEditable: 1000 })), 2000);
console.log("OK cálculo: una línea por cantidad y precio");

const multipleTotals = calculateQuoteTotals([
  item(1, { cantidad: 2, precioUnitarioEditable: 1000 }),
  item(2, { cantidad: 3, precioUnitarioEditable: 500 }),
]);
assert.equal(multipleTotals.subtotal, 3500);
assert.equal(multipleTotals.iva, 665);
assert.equal(multipleTotals.total, 4165);
console.log("OK cálculo: varias líneas, subtotal, IVA y total");

const discountTotals = calculateQuoteTotals(
  [item(1, { cantidad: 2, precioUnitarioEditable: 1000, descuentoPorcentaje: 10 })],
  100
);
assert.deepEqual(
  {
    subtotal: discountTotals.subtotal,
    descuentoTotal: discountTotals.descuentoTotal,
    neto: discountTotals.neto,
    iva: discountTotals.iva,
    total: discountTotals.total,
  },
  { subtotal: 2000, descuentoTotal: 300, neto: 1700, iva: 323, total: 2023 }
);
console.log("OK cálculo: descuentos por línea y general");

const exemptTotals = calculateQuoteTotals([item(1)], 0, { afectaIva: false });
assert.equal(exemptTotals.iva, 0);
assert.equal(exemptTotals.total, 1000);
assert.equal(calculateQuoteTotals([item(1, { cantidad: 1.5 })]).total, 1785);
assert.equal(
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(416500),
  "$416.500"
);
console.log("OK cálculo: exenta, decimales y formato CLP");

assert.throws(() => calculateQuoteLineTotal(item(1, { cantidad: -1 })), /no puede|mayor/);
assert.throws(() => calculateQuoteLineTotal(item(1, { cantidad: "NaN" })), /número válido/);
assert.throws(
  () => calculateQuoteLineTotal(item(1, { precioUnitarioEditable: -10 })),
  /no puede/
);
assert.throws(() => calculateQuoteTotals([item(1)], 2000), /no puede superar/);
console.log("OK validación: cantidades, precios, NaN y descuentos inválidos rechazados");

assert.equal(calculateQuoteExpiryDate("2026-06-25", 10), "2026-07-05");
console.log("OK fecha: vencimiento calculado");

const longDescription = "Descripción técnica con áéíóú, ñ y alcance detallado. ".repeat(30);
const normalizedLong = normalizeQuoteItem(
  item(1, { descripcionComercial: longDescription }),
  0,
  { strict: true }
);
assert.equal(normalizedLong.descripcionComercial, longDescription.trim());
assert.deepEqual(normalizeScopeSections([{ titulo: "", lineas: [""] }]), []);
assert.equal(
  normalizeScopeSections([{ id: "x", titulo: "Entregables", lineas: ["Informe"] }])[0]
    .lineas[0],
  "Informe"
);
console.log("OK contenido: descripciones extensas y alcance vacío/poblado");

const inventorySource = item(1);
const snapshotted = normalizeQuoteItem(inventorySource, 0, { strict: true });
inventorySource.nombre = "Nombre modificado después";
inventorySource.inventarioSnapshot.nombre = "Snapshot externo modificado";
assert.equal(snapshotted.nombre, "Servicio 1");
assert.equal(snapshotted.inventarioSnapshot.nombre, "Servicio 1");
console.log("OK persistencia: snapshot histórico independiente del inventario");

const legacy = adaptStoredQuote({
  id: "legacy",
  numeroCotizacion: "026-001",
  fecha: "2025-01-10",
  clienteNombre: "Cliente histórico",
  items: [{ nombre: "Servicio legacy", cantidad: 1, precioUnitario: 350000 }],
  subtotal: 350000,
  descuento: 0,
  total: 350000,
  empresa: company,
});
assert.equal(legacy.legacyIvaNoDefinido, true);
assert.equal(legacy.afectaIva, false);
assert.equal(legacy.total, 350000);
assert.equal(legacy.clienteId, "");
assert.equal(legacy.clienteHistoricoNoVinculado, true);
assert.equal(legacy.trabajoId, "");

const projectQuote = adaptStoredQuote({...legacy, trabajoId: "work-1", trabajoNumero: "TRB-2026-0001", trabajoTitulo: "Diagnóstico"});
assert.equal(projectQuote.trabajoId, "work-1"); assert.equal(projectQuote.trabajoNumero, "TRB-2026-0001"); assert.equal(projectQuote.trabajoTitulo, "Diagnóstico");
console.log("OK compatibilidad: cotización legacy preservada sin inferir IVA");

const legacyClientId = adaptStoredQuote({
  ...legacy,
  clienteId: undefined,
  clientId: "cliente-legado",
});
assert.equal(legacyClientId.clienteId, "cliente-legado");
assert.equal("clientId" in legacyClientId, false);
console.log("OK compatibilidad: clientId legacy se adapta solo a clienteId canónico");

const copyInput = historicalQuoteCopyInput({
  ...quoteFixture(),
  clienteId: "cliente-copy",
  id: "cotizacion-original",
  numero: "COT-2026-0001",
  estado: "rechazada",
  total: 1,
  creadoEn: "histórico",
  cliente: {nombreRazonSocial: "Snapshot histórico"},
});
assert.equal(copyInput.estado, "borrador");
assert.equal(copyInput.clienteId, "cliente-copy");
assert.equal(copyInput.items[0].precioUnitarioEditable, 350000);
assert.equal(copyInput.proyectoNombre, "Escalera zona de estanque");
assert.equal("id" in copyInput, false);
assert.equal("numero" in copyInput, false);
assert.equal("total" in copyInput, false);
assert.equal("creadoEn" in copyInput, false);
assert.equal(canDuplicateQuotes("OWNER"), true);
assert.equal(canDuplicateQuotes("ADMIN"), true);
assert.equal(canDuplicateQuotes("MEMBER"), false);
assert.equal(canDuplicateQuotes("VENTAS"), true);
assert.equal(canDuplicateQuotes("COMPRAS"), false);
assert.equal(DRAFT_QUOTE_NUMBER_LABEL, "Número pendiente");
assert.equal(getQuoteStatusLabel("borrador"), "Pendiente");
assert.equal(getQuoteStatusLabel("emitida"), "Emitida");
console.log("OK duplicación: copia solo datos reutilizables y MEMBER no administra");

const unsafeName = getQuotePdfFileName({
  numero: "026/114:*?",
  clienteNombre: "Compañía / Ñandú Ltda.",
});
assert.match(unsafeName, /^Cotizacion_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+\.pdf$/);
assert.doesNotMatch(unsafeName, /[\\/:*?"<>|]/);
console.log("OK archivo: nombre descriptivo y seguro");

const sourceNewQuote = fs.readFileSync("src/pages/NewQuotePage.jsx", "utf8");
const sourceClientSelector = fs.readFileSync(
  "src/features/clients/ClientSelector.jsx",
  "utf8"
);
const sourceQuoteCatalog = fs.readFileSync(
  "src/features/quotes/QuoteCatalogDialog.jsx",
  "utf8"
);
const sourceQuoteItems = fs.readFileSync(
  "src/features/quotes/QuoteItemsEditor.jsx",
  "utf8"
);
const sourceQuoteSummary = fs.readFileSync(
  "src/features/quotes/QuoteSummaryPanel.jsx",
  "utf8"
);
const sourceCompanyConfig = fs.readFileSync(
  "src/features/company/CompanyConfig.jsx",
  "utf8"
);
const sourceQuoteCollapsible = fs.readFileSync(
  "src/features/quotes/QuoteCollapsibleSection.jsx",
  "utf8"
);
const sourceQuoteWorkspaceCss = fs.readFileSync(
  "src/features/quotes/quote-workspace.css",
  "utf8"
);
const sourcePdf = fs.readFileSync("src/utils/quotePdf.js", "utf8");
const sourceEmail = fs.readFileSync("src/features/quotes/SendQuoteEmailModal.jsx", "utf8");
const sourceHistory = fs.readFileSync("src/pages/QuoteHistoryPage.jsx", "utf8");
const sourceQuoteService = fs.readFileSync("src/services/quoteService.js", "utf8");
const sourceQuotePersistence = fs.readFileSync("functions/quotePersistence.js", "utf8");
const sourceQuoteDocument = fs.readFileSync("src/domain/quoteDocument.mjs", "utf8");
const sourceDashboard = fs.readFileSync("src/pages/DashboardPage.jsx", "utf8");
const sourceCompanyService = fs.readFileSync("src/services/companyService.js", "utf8");
const duplicateServiceSource = sourceQuoteService.slice(
  sourceQuoteService.indexOf("export async function duplicateQuoteAsDraft"),
  sourceQuoteService.indexOf("export async function getQuotes")
);
assert.match(sourceNewQuote, /createManagedInventoryItem/);
assert.doesNotMatch(sourceNewQuote, /\bcreateInventoryItem\b/);
assert.match(sourceNewQuote, /<ClientSelector/);
assert.doesNotMatch(sourceNewQuote, /quote-client-suggestions/);
assert.match(
  sourceNewQuote,
  /if \(client\.clienteId === currentClienteIdRef\.current\) return;/
);
assert.match(sourceClientSelector, /listarClientes\(businessId\)/);
assert.match(sourceClientSelector, /if \(!businessId\)/);
assert.doesNotMatch(sourceClientSelector, /clientRutKeys/);
assert.match(sourceNewQuote, /areaId/);
assert.match(sourceNewQuote, /categoriaId/);
assert.match(sourceNewQuote, /<QuoteSummaryPanel/);
assert.match(sourceNewQuote, /savingRef\.current/);
assert.match(sourceNewQuote, /estado:\s*"borrador"/);
assert.match(sourceNewQuote, /openQuoteId/);
assert.match(sourceNewQuote, /Más condiciones/);
assert.match(sourceNewQuote, /Restaurar valores de Empresa/);
assert.match(sourceNewQuote, /if \(isEditMode\) return;/);
assert.match(sourceNewQuote, /profile\.plazoEntregaCotizacion/);
assert.match(sourceNewQuote, /profile\.garantiaCotizacion/);
assert.match(sourceCompanyService, /plazoEntregaCotizacion/);
assert.match(sourceCompanyService, /garantiaCotizacion/);
assert.match(sourceNewQuote, /\{false && assistantOpen && \(/);
assert.doesNotMatch(sourceQuoteItems, /Usar asistente/);
assert.match(sourceQuoteSummary, /Crear cotización/);
assert.match(sourceQuoteSummary, /Guardar cambios/);
assert.doesNotMatch(sourceQuoteSummary, /Vista previa|Enviar por correo|Descargar PDF/);
assert.match(sourceCompanyConfig, /Valores predeterminados para nuevas cotizaciones/);
assert.doesNotMatch(sourceCompanyConfig, /Aceptación del cliente/);
assert.match(sourceQuoteCatalog, /<ResponsiveDialog/);
assert.match(sourceQuoteCatalog, /initialFocusRef=\{searchRef\}/);
assert.match(sourceQuoteCatalog, /Agregar otra vez/);
assert.doesNotMatch(sourceQuoteItems, /<table/);
assert.match(sourceQuoteItems, /Editar descripción y unidad/);
assert.match(sourceQuoteItems, /Subtotal \$\{formatCLP\(subtotal\)\}/);
assert.match(sourceQuoteItems, /items\.length === 1 \? "" : "s"/);
assert.match(sourceQuoteItems, /Sin ítems agregados/);
assert.match(sourceNewQuote, /subtotal=\{totals\.subtotal\}/);
assert.match(sourceQuoteCollapsible, /aria-expanded=\{open\}/);
assert.match(sourceQuoteWorkspaceCss, /position:\s*sticky/);
assert.match(sourceQuoteWorkspaceCss, /@media \(max-width: 620px\)/);
assert.match(sourceQuoteWorkspaceCss, /position:\s*static/);
assert.match(sourcePdf, /buildQuotePdfBase64/);
assert.match(sourceEmail, /buildQuotePdfAttachment/);
assert.match(sourceHistory, /downloadQuotePdf/);
assert.match(sourceHistory, /shareQuotePdf/);
assert.match(sourceHistory, /Duplicar como pendiente/);
assert.match(sourceHistory, /Marcar como emitida/);
assert.match(sourceHistory, /motivoRechazoCliente/);
assert.match(sourceHistory, /comentarioRechazoCliente/);
assert.match(sourceHistory, /Sin comentario adicional/);
assert.match(sourceHistory, /Preparar venta/);
assert.match(sourceHistory, /title: "Venta preparada"/);
assert.match(sourceHistory, /fue preparada desde/);
assert.match(sourceHistory, /title: "Abrir venta"/);
assert.match(sourceHistory, /onChangeStatus/);
assert.match(sourceHistory, /Ya puedes comenzar a trabajar con ValoraCloud/);
assert.match(sourceHistory, /openCreateClient: true/);
assert.match(sourceHistory, /Agregar productos o servicios/);
assert.match(sourceHistory, /BUSINESS_PERMISSIONS\.INVENTORY_WRITE/);
assert.match(duplicateServiceSource, /sourceId[\s\S]*requestId/);
assert.doesNotMatch(duplicateServiceSource, /quote:\s*payload/);
assert.match(sourceQuotePersistence, /quoteDuplicateRequests/);
assert.match(sourceQuotePersistence, /cotizacionOrigenId/);
assert.match(sourceQuotePersistence, /storedQuote[\s\S]*estado:\s*"borrador"/);
assert.doesNotMatch(sourceQuoteDocument, /borrador:\s*"Borrador"/);
assert.match(sourceQuoteDocument, /getQuoteStatusLabel\(quote\.estado\)/);
assert.match(sourceDashboard, /getQuoteStatusLabel\("borrador"\)/);
console.log("OK integración: inventario v2 y PDF único para descarga, correo y compartir");

const outputDir = path.resolve("output/pdf/quote-validation");
fs.mkdirSync(outputDir, { recursive: true });
const logoPath = path.resolve("tmp/pdfs/reference/bagner-logo.png");
const logoDataUrl = fs.existsSync(logoPath)
  ? `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`
  : "";

const scenarios = [
  [
    "01-simple",
    quoteFixture({
      seccionesAlcance: [],
      condiciones: { formaPago: company.condicionesPago },
      aceptacion: { habilitada: false, texto: "" },
    }),
  ],
  [
    "02-multiple-items",
    quoteFixture({
      items: Array.from({ length: 9 }, (_, index) =>
        item(index + 1, { precioUnitarioEditable: 45000 + index * 12500 })
      ),
    }),
  ],
  [
    "03-multipage",
    quoteFixture({
      items: Array.from({ length: 55 }, (_, index) =>
        item(index + 1, {
          descripcionComercial: `Actividad ${index + 1} con detalle técnico, control de calidad y entrega documentada.`,
          precioUnitarioEditable: 10000 + index * 500,
        })
      ),
      seccionesAlcance: Array.from({ length: 8 }, (_, index) => ({
        id: `seccion-${index}`,
        titulo: `Sección de alcance ${index + 1}`,
        lineas: Array.from({ length: 5 }, (_, line) =>
          `Línea ${line + 1}: descripción extensa del alcance comprometido para la etapa ${index + 1}.`
        ),
      })),
    }),
  ],
  [
    "04-long-descriptions",
    quoteFixture({
      items: Array.from({ length: 6 }, (_, index) =>
        item(index + 1, { descripcionComercial: longDescription })
      ),
    }),
  ],
  [
    "05-empty-optionals",
    quoteFixture({
      empresa: { ...company, condicionesPago: "" },
      clienteRut: "",
      clienteContacto: "",
      clienteEmail: "",
      clienteTelefono: "",
      clienteDireccion: "",
      clienteCiudad: "",
      proyectoNombre: "",
      seccionesAlcance: [],
      condiciones: {},
      aceptacion: { habilitada: false, texto: "" },
    }),
  ],
  [
    "06-pending",
    quoteFixture({
      estado: "borrador",
      seccionesAlcance: [],
      condiciones: { formaPago: company.condicionesPago },
      aceptacion: { habilitada: false, texto: "" },
    }),
  ],
];

for (const [name, quote] of scenarios) {
  const result = buildQuotePdfDocument({ quote, logoDataUrl });
  const file = path.join(outputDir, `${name}.pdf`);
  fs.writeFileSync(file, Buffer.from(result.doc.output("arraybuffer")));
  assert.equal(result.quote.total, quote.total);
  if (name === "03-multipage") assert.ok(result.doc.getNumberOfPages() >= 2);
  console.log(`PDF_VALIDATION ${name} pages=${result.doc.getNumberOfPages()} file=${file}`);
}

console.log("QUOTE_MODEL_SMOKE_OK");
