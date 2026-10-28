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
  canDeleteQuotes,
  canDuplicateQuotes,
  canOfferQuoteDeletion,
  DRAFT_QUOTE_NUMBER_LABEL,
  getQuoteExpiryAlert,
  getQuoteStatusLabel,
  getQuotePdfFileName,
  isAdvancedQuoteScope,
  isQuoteDeleteConfirmed,
  isValidQuoteDateRange,
  matchesQuoteQuickFilter,
  normalizeQuoteItem,
  normalizeScopeSections,
  QUOTE_SIMPLE_SCOPE_TITLE,
  resolveQuoteClientSelectionSnapshot,
} from "../src/domain/quoteModel.mjs";
import {filterSelectableClients} from "../src/domain/clientModel.mjs";
import {stepQuoteQuantity} from "../src/features/quotes/quoteLineStepper.mjs";
import {createQuoteItemFromValuation} from "../src/domain/quoteItemFactory.js";
import { jsPDF } from "jspdf";
import { buildQuotePdfDocument, drawRightLabeledLine } from "../src/domain/quoteDocument.mjs";
import {
  buildQuoteAcceptanceLine,
  buildQuoteClientRows,
  buildQuoteFooterContact,
  buildQuoteTerms,
} from "../src/domain/quoteDocumentLayout.mjs";

const require = createRequire(import.meta.url);
const {historicalQuoteCopyInput} = require("../functions/quotePersistence.js");

const company = {
  nombreComercial: "BAGNER Servicios Integrales",
  razonSocial: "Bagner Servicios Integrales SpA",
  rut: "77.091.679-8",
  direccion: "Calle Ficticia 1234",
  ciudad: "Iquique",
  region: "I Región",
  responsable: "Persona de Prueba",
  telefono: "+56 9 1234 5678",
  email: "persona.prueba@example.test",
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

// Vigencia en el historial: fechaVencimiento es el último día válido y solo
// las emitidas generan aviso (incluidas las emitidas a mano que el job de
// vencimiento no alcanza).
const emitted = (fechaVencimiento) => ({estado: "emitida", fechaVencimiento});
assert.deepEqual(getQuoteExpiryAlert(emitted("2026-10-09"), "2026-10-09"), {kind: "por_vencer", days: 0});
assert.deepEqual(getQuoteExpiryAlert(emitted("2026-10-12"), "2026-10-09"), {kind: "por_vencer", days: 3});
assert.deepEqual(getQuoteExpiryAlert(emitted("2026-10-13"), "2026-10-09"), {kind: "", days: 4});
assert.deepEqual(getQuoteExpiryAlert(emitted("2026-10-08"), "2026-10-09"), {kind: "vencida_sin_marcar", days: -1});
assert.deepEqual(getQuoteExpiryAlert(emitted("2026-11-02"), "2026-10-30"), {kind: "por_vencer", days: 3});
assert.equal(getQuoteExpiryAlert({estado: "borrador", fechaVencimiento: "2026-10-09"}, "2026-10-09").kind, "");
assert.equal(getQuoteExpiryAlert({estado: "aceptada", fechaVencimiento: "2026-10-01"}, "2026-10-09").kind, "");
assert.equal(getQuoteExpiryAlert(emitted(""), "2026-10-09").kind, "");
assert.equal(getQuoteExpiryAlert(emitted("2026-10-09"), "").kind, "");
assert.equal(matchesQuoteQuickFilter({estado: "archivada"}, "todos", "2026-10-09"), false);
assert.equal(matchesQuoteQuickFilter({}, "todos", "2026-10-09"), true);
assert.equal(matchesQuoteQuickFilter({}, "borrador", "2026-10-09"), true);
assert.equal(matchesQuoteQuickFilter({estado: "archivada"}, "archivada", "2026-10-09"), true);
assert.equal(matchesQuoteQuickFilter(emitted("2026-10-01"), "por_vencer", "2026-10-09"), true);
assert.equal(matchesQuoteQuickFilter(emitted("2026-10-30"), "por_vencer", "2026-10-09"), false);
assert.equal(matchesQuoteQuickFilter({estado: "vencida", fechaVencimiento: "2026-10-01"}, "por_vencer", "2026-10-09"), false);
console.log("OK historial: aviso de vigencia y filtros rápidos por estado");
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

assert.equal(isAdvancedQuoteScope([]), false);
assert.equal(isAdvancedQuoteScope([{ titulo: "", lineas: ["Instalación completa"] }]), false);
assert.equal(
  isAdvancedQuoteScope([{ titulo: QUOTE_SIMPLE_SCOPE_TITLE, lineas: ["Instalación completa"] }]),
  false,
  "una cotización guardada en modo simple debe seguir clasificando como simple al recargarla"
);
assert.equal(isAdvancedQuoteScope([{ titulo: "Materiales", lineas: ["Cemento"] }]), true);
assert.equal(
  isAdvancedQuoteScope([
    { titulo: "", lineas: ["a"] },
    { titulo: "", lineas: ["b"] },
  ]),
  true
);
console.log("OK alcance: modo simple sobrevive al round-trip, título editado y múltiples secciones siguen en modo avanzado");

assert.equal(isValidQuoteDateRange("2026-09-15", "2026-09-25"), true);
assert.equal(isValidQuoteDateRange("2026-09-15", "2026-09-15"), true);
assert.equal(isValidQuoteDateRange("2026-09-25", "2026-09-15"), false);
assert.equal(isValidQuoteDateRange("2026-09-15", ""), false);
assert.equal(isValidQuoteDateRange("", "2026-09-15"), false);
console.log("OK plazo: rango desde/hasta exige ambas fechas y rechaza hasta anterior a desde");

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
const sourceQuoteConditions = fs.readFileSync(
  "src/features/quotes/QuoteConditionsPanel.jsx",
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
const sourceInteriorCss = fs.readFileSync("src/styles/interior.css", "utf8");
const sourceQuoteService = fs.readFileSync("src/services/quoteService.js", "utf8");
const sourceQuotePersistence = fs.readFileSync("functions/quotePersistence.js", "utf8");
const sourceQuoteDocument = fs.readFileSync("src/domain/quoteDocument.mjs", "utf8");
const sourceQuoteDocumentLayout = fs.readFileSync("src/domain/quoteDocumentLayout.mjs", "utf8");
const sourceQuotePrintView = fs.readFileSync(
  "src/features/quotes/QuotePrintView.jsx",
  "utf8"
);
const sourceDashboard = fs.readFileSync("src/pages/DashboardPage.jsx", "utf8");
const sourceCompanyService = fs.readFileSync("src/services/companyService.js", "utf8");
const duplicateServiceSource = sourceQuoteService.slice(
  sourceQuoteService.indexOf("export async function duplicateQuoteAsDraft"),
  sourceQuoteService.indexOf("export async function getQuotes")
);
const quoteActionsSource = sourceHistory.slice(
  sourceHistory.indexOf("function QuoteActions"),
  sourceHistory.indexOf("function QuoteDocumentActions")
);
const quoteDocumentActionsSource = sourceHistory.slice(
  sourceHistory.indexOf("function QuoteDocumentActions"),
  sourceHistory.indexOf("function QuoteDetail")
);
const quotePrimaryActionsSource = quoteDocumentActionsSource.slice(
  quoteDocumentActionsSource.indexOf("quote-document-footer__primary"),
  quoteDocumentActionsSource.indexOf("</div>")
);
const quoteDetailSource = sourceHistory.slice(
  sourceHistory.indexOf("function QuoteDetail"),
  sourceHistory.indexOf("function CommercialStatusTimeline")
);
const commercialStatusSource = sourceHistory.slice(
  sourceHistory.indexOf("function CommercialStatusTimeline"),
  sourceHistory.indexOf("const styles")
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
assert.match(sourceNewQuote, /<QuoteConditionsPanel/);
assert.doesNotMatch(sourceNewQuote, /Más condiciones|CompactConditionField/, "las condiciones opcionales son botones + dentro del paso 3");
assert.match(sourceNewQuote, /isAdvancedQuoteScope\(quote\.seccionesAlcance\)/);
assert.match(sourceNewQuote, /isValidQuoteDateRange\(plazoRangeDraft\.desde, plazoRangeDraft\.hasta\)/);
assert.match(sourceQuoteConditions, /Restaurar valores de Empresa/);
assert.match(sourceNewQuote, /onRestore=\{restoreDefaultConditions\}/, "Restaurar conserva su manejador de siempre");
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
// Formulario: sin franja superior (la barra ya muestra el título); el aviso
// del número va bajo el botón y, en edición, número y fecha en el resumen.
assert.doesNotMatch(sourceNewQuote, /quote-workspace__header|quote-workspace__eyebrow/);
assert.doesNotMatch(sourceQuoteWorkspaceCss, /quote-workspace__header|quote-workspace__eyebrow/);
assert.match(sourceQuoteSummary, /\{!isEditMode && <small className="quote-summary__hint">El número se asignará al crear la cotización\.<\/small>\}/);
assert.match(sourceQuoteSummary, /quoteNumber, quoteDate/);
// "Crear cotización" también se deshabilita sin ítems y explica qué falta.
assert.match(sourceNewQuote, /const saveBlocked = saveBlockedByClient \|\| saveBlockedByItems;/);
assert.match(sourceNewQuote, /missingRequirements\.push\("cliente"\)/);
assert.match(sourceNewQuote, /missingRequirements\.push\("al menos un ítem"\)/);
assert.match(sourceNewQuote, /`Falta: \$\{missingRequirements\.join\(" · "\)\}`/);
assert.match(sourceQuoteSummary, /disabled=\{saving \|\| saveBlocked\} aria-describedby=/);
assert.match(sourceQuoteSummary, /id="quote-save-blocked-reason"/);
// Ítems: un solo botón relleno (el del encabezado); el vacío es solo texto.
assert.equal((sourceQuoteItems.match(/quote-workspace__button--primary/g) || []).length, 1);
assert.doesNotMatch(sourceQuoteItems, /Abrir catálogo/);
// "Asunto" sólo en el formulario: sigue guardándose como proyectoNombre y el
// PDF y la vista de impresión conservan "Proyecto".
assert.match(sourceNewQuote, /<span className="quote-workspace__kicker">Asunto<\/span>/);
assert.match(sourceNewQuote, /Aparece como 'Proyecto' en el PDF\./);
assert.doesNotMatch(sourceNewQuote, /Proyecto o trabajo/);
assert.match(sourceQuoteDocument, /buildQuoteClientRows\(client, client\.proyecto \|\| quote\.trabajoTitulo\)/);
assert.match(sourceQuotePrintView, /buildQuoteClientRows\(client, project\)/);
assert.deepEqual(
  buildQuoteClientRows({ empresa: "Cliente SA", contacto: "", email: "a@b.cl" }, "Escalera").map(([label]) => label),
  ["Empresa", "Correo", "Proyecto"]
);
// Condiciones: campos alineados arriba, placeholder corto y "Qué incluye"
// cerrado salvo que tenga contenido.
assert.match(sourceQuoteWorkspaceCss, /\.quote-conditions-primary__grid > \* \{\s*align-self: start;/);
assert.match(sourceQuoteConditions, /placeholder="Ej: 10 días hábiles"/);
assert.match(sourceNewQuote, /const \[scopeOpen, setScopeOpen\] = useState\(false\);/);
assert.match(sourceNewQuote, /setScopeOpen\(hasScopeContent\(editableQuote\.seccionesAlcance\)\);/);
assert.match(sourceCompanyConfig, /Valores predeterminados para nuevas cotizaciones/);
assert.doesNotMatch(sourceCompanyConfig, /Aceptación del cliente/);
assert.match(sourceQuoteCatalog, /<ResponsiveDialog/);
assert.match(sourceQuoteCatalog, /initialFocusRef=\{searchRef\}/);
assert.match(sourceQuoteCatalog, /Agregar otra vez/);
assert.doesNotMatch(sourceQuoteItems, /<table/);
assert.match(sourceQuoteItems, /Descripción y descuento/);
assert.doesNotMatch(sourceQuoteItems, /Descripción, unidad y descuento/);
assert.doesNotMatch(sourceQuoteItems, /Personalizar ítem/);
assert.doesNotMatch(sourceQuoteItems, /Subtotal/, "el encabezado de ítems muestra solo el conteo; el subtotal vive en el resumen");
assert.match(sourceQuoteItems, /items\.length === 1 \? "1 ítem" : `\$\{items\.length\} ítems`/);
assert.match(sourceQuoteItems, /Agrega productos, servicios o actividades para construir la cotización\./);
assert.match(sourceNewQuote, /saveAttempted \|\| itemsInteracted/);
assert.match(sourceNewQuote, /setSaveAttempted\(true\)/);
assert.match(sourceHistory, /Aún no hay cotizaciones/);
assert.match(sourceHistory, />\s*Nueva cotización/);
assert.match(sourceHistory, />\s*Crear cliente/);
assert.match(sourceHistory, />\s*Ir al inventario/);
assert.doesNotMatch(sourceHistory, /Ya puedes comenzar a trabajar con ValoraCloud/);
assert.match(sourceQuoteItems, /Sin ítems agregados/);
assert.match(sourceNewQuote, /subtotal=\{totals\.subtotal\}/);
// Filas de ítems compactas: mismos manejadores y mismos campos que antes; solo cambia la presentación.
assert.match(sourceQuoteItems, /<h2 id="quote-items-title">2 · ¿Qué cotizas\?<\/h2>/);
assert.match(sourceQuoteItems, /onUpdate\(lineId, "cantidad", event\.target\.value\)/);
assert.match(sourceQuoteItems, /onUpdate\(lineId, "cantidad", next\)/, "− y + usan el mismo manejador de cantidad");
assert.match(sourceQuoteItems, /onUpdate\(lineId, "precioUnitarioEditable", event\.target\.value\)/);
assert.match(sourceQuoteItems, /onUpdate\(lineId, "descripcionComercial", event\.target\.value\)/);
assert.doesNotMatch(sourceQuoteItems, /onUpdate\(lineId, "unidad"/, "la unidad ya no se edita en la cotización");
assert.match(sourceQuoteItems, /onUpdate\(lineId, "descuentoPorcentaje", event\.target\.value\)/);
assert.match(sourceQuoteItems, /onMove\(index, -1\)/);
assert.match(sourceQuoteItems, /onMove\(index, 1\)/);
assert.match(sourceQuoteItems, /onRemove\(lineId\)/);
assert.match(sourceQuoteItems, /aria-label=\{`Subir \$\{item\.nombre\}`\}/);
assert.match(sourceQuoteItems, /aria-label=\{`Bajar \$\{item\.nombre\}`\}/);
assert.match(sourceQuoteItems, /aria-label=\{`Quitar \$\{item\.nombre\}`\}/);
assert.match(sourceQuoteItems, /variant="ghost-danger"/, "Quitar usa el Button compartido, sin otra familia de botón");
assert.match(sourceQuoteItems, /aria-label=\{`Disminuir cantidad de \$\{item\.nombre\}`\}/);
assert.match(sourceQuoteItems, /aria-label=\{`Aumentar cantidad de \$\{item\.nombre\}`\}/);
assert.doesNotMatch(sourceQuoteItems, /Unidad de cobro/);
assert.match(sourceQuoteItems, /Solo cambia esta cotización; el inventario no se modifica\./);
assert.match(sourceQuoteItems, /\{item\.unidad \|\| "Sin unidad"\}/, "la unidad se sigue mostrando en la fila, sin editar");
// La unidad la leen el PDF, la vista formal y la propuesta pública de la línea guardada (item.unidad), no de un campo del formulario.
assert.match(sourceQuoteDocument, /unit: item\.unidad \|\| "-"/);
assert.match(sourceQuotePrintView, /\{item\.unidad \|\| "-"\}/);
assert.equal(normalizeQuoteItem({nombre: "Pintura", cantidad: 1, precioUnitarioEditable: 100, unidad: "m2"}).unidad, "m2", "una línea guardada conserva su unidad");
assert.equal(normalizeQuoteItem({nombre: "Pintura", cantidad: 1, precioUnitarioEditable: 100}).unidad, "unidad");
assert.equal(createQuoteItemFromValuation({itemId: "i1", nombre: "Cable", unidad: "metro", item: {id: "i1", unidad: "rollo", precioInterno: 10}}).unidad, "metro", "una línea nueva toma la unidad del inventario");
assert.equal(createQuoteItemFromValuation({itemId: "i2", nombre: "Cable", item: {id: "i2", unidad: "rollo", precioInterno: 10}}).unidad, "rollo");
assert.equal(buildQuotePayload("uid-1", {items: [{nombre: "Pintura", cantidad: 1, precioUnitarioEditable: 100, unidad: "m2"}], clienteId: "c1", cliente: {nombreRazonSocial: "X"}}).items[0].unidad, "m2", "el payload conserva la unidad guardada");
assert.match(sourceQuoteItems, /quote-line__chip/);
assert.match(sourceQuoteItems, /key=\{lineId\}/, "la fila conserva su clave estable: el plegable no se cierra al reordenar");
assert.doesNotMatch(sourceQuoteItems, /features\/sales|\.\.\/sales\//, "Cotización no importa nada de Venta");
assert.doesNotMatch(sourceQuoteWorkspaceCss, /\.quote-item\b|\.quote-item__|\.quote-items__head/, "sin reglas de la fila anterior");
assert.match(sourceQuoteWorkspaceCss, /\.quote-line \.quote-line__icon-button \{[^}]*min-height: 2\.75rem;[^}]*min-width: 2\.75rem;/, "íconos de 44 px");
assert.match(sourceQuoteWorkspaceCss, /@container \(max-width: 38rem\)/);
// Stepper propio de Cotización: devuelve la cantidad siguiente o null; la validación real sigue en calculateQuoteLineAmounts.
assert.equal(stepQuoteQuantity(1, 1), 2);
assert.equal(stepQuoteQuantity("2", 1), 3);
assert.equal(stepQuoteQuantity(2.5, -1), 1.5);
assert.equal(stepQuoteQuantity(2.3, 1), 3.3, "sin deriva de punto flotante");
assert.equal(stepQuoteQuantity(1, -1), null, "1 − 1 sería 0");
assert.equal(stepQuoteQuantity(0.5, -1), null, "0,5 − 1 sería negativo");
assert.equal(stepQuoteQuantity(0.000001, -1), null);
assert.equal(stepQuoteQuantity("", 1), 1, "campo vacío: + parte de 0");
assert.equal(stepQuoteQuantity("", -1), null);
assert.equal(stepQuoteQuantity(7, 1), 8, "sin tope");
assert.equal(calculateQuoteLineTotal({cantidad: stepQuoteQuantity(2, 1), precioUnitarioEditable: 1000, descuentoPorcentaje: 10}), 2700, "el valor del stepper pasa por la fórmula de siempre");
// Ningún .jsx de Cotización escribe tildes ni símbolos como secuencias de escape: en texto JSX y en atributos
// entre comillas se mostrarían literales ("identificaci" + barra + "u00f3n"). Solo se tolera el rango de
// diacríticos de un regex (normalize("NFD")). Las secuencias se arman con código para no escribirlas aquí.
{
  const BS = String.fromCharCode(92);
  const escapeSequence = new RegExp(`${BS}${BS}u[0-9a-fA-F]{4}`);
  const diacriticsRange = `${BS}u0300-${BS}u036f`;
  const quotesDir = new URL("../src/features/quotes/", import.meta.url);
  const jsxFiles = [...fs.readdirSync(quotesDir).filter((name) => name.endsWith(".jsx")).map((name) => new URL(name, quotesDir)), new URL("../src/pages/NewQuotePage.jsx", import.meta.url)];
  const checkedNames = jsxFiles.map((file) => file.pathname.split("/").pop());
  for (const required of ["QuoteItemsEditor.jsx", "QuoteSummaryPanel.jsx", "NewQuotePage.jsx"]) assert.ok(checkedNames.includes(required), `se revisa ${required}`);
  for (const file of jsxFiles) {
    const lines = fs.readFileSync(file, "utf8").split(diacriticsRange).join("").split(/\r?\n/);
    const bad = lines.findIndex((line) => escapeSequence.test(line));
    assert.equal(bad, -1, `${file.pathname.split("/").pop()}:${bad + 1} contiene una secuencia de escape unicode fuera de un regex; escribe el carácter real en UTF-8`);
  }
  assert.ok(escapeSequence.test(`x${BS}u00f3y`), "la aserción detecta una secuencia de escape");
  assert.equal(escapeSequence.test("identificación · línea"), false, "los caracteres reales no se marcan");
}
console.log("OK editor de ítems de cotización: filas compactas, stepper propio, plegable por fila y sin escapes unicode");
// Paso 3: condiciones. Botones "+" de borde punteado; con contenido el apartado queda activo y visible; sin "Quitar" nuevo.
assert.match(sourceQuoteConditions, /<h2 id="quote-conditions-title">3 · Condiciones<\/h2>/);
assert.match(sourceQuoteConditions, /isEditMode \? "" : "Vienen de los valores de Empresa\. "/, "la primera frase solo vale al crear");
assert.match(sourceQuoteConditions, /Cambiarlas solo afecta a esta cotización\./);
assert.doesNotMatch(sourceNewQuote, /se copiaron a este documento/);
assert.match(sourceQuoteConditions, /aria-pressed=\{active\}/);
assert.match(sourceQuoteConditions, /Boolean\(opened\[key\]\) \|\| hasText\(conditions\[key\]\)/, "con contenido el botón aparece activo");
assert.match(sourceQuoteConditions, /if \(!opened\[key\] && !hasText\(conditions\[key\]\)\) return null;/, "con contenido el campo siempre es visible");
assert.doesNotMatch(sourceQuoteConditions, /Quitar/, "sin botón Quitar nuevo");
for (const label of ["Qué incluye", "Garantía", "Alcance geográfico", "Observaciones", "Exclusiones", "Otras condiciones"]) assert.match(sourceQuoteConditions, new RegExp(label), label);
assert.match(sourceQuoteConditions, /placeholder: "Ej: 12 meses por defectos de fabricación"/);
assert.match(sourceQuoteConditions, /placeholder: "Ej: Región de Tarapacá"/);
assert.match(sourceQuoteConditions, /key: "observaciones"[^\n]*placeholder: "Ej: /);
assert.match(sourceQuoteConditions, /key: "exclusiones"[^\n]*placeholder: "Ej: /);
assert.match(sourceQuoteConditions, /hint: "Una condición por línea; cada una sale numerada en el PDF\."/);
assert.match(sourceQuoteConditions, /placeholder="Ej: 50% al iniciar y 50% contra entrega"/);
// El formato de "Otras condiciones" y "Qué incluye" es uno por renglón: así lo imprimen el documento y el modelo.
assert.deepEqual(buildQuoteTerms({terminosAdicionales: "Los materiales se facturan al confirmar\nLa instalación se agenda según disponibilidad"}), ["Los materiales se facturan al confirmar", "La instalación se agenda según disponibilidad"]);
assert.deepEqual(normalizeScopeSections([{titulo: "Qué incluye", lineas: ["Instalación completa", "Materiales incluidos"]}])[0].lineas, ["Instalación completa", "Materiales incluidos"]);
// El ✓ solo significa "tiene contenido": un campo abierto y vacío se ve abierto (flecha, borde de marca), sin ✓.
assert.match(sourceQuoteConditions, /filled \? "✓" : active \? <AppIcon icon=\{ChevronDown\} size=\{14\} \/> : "\+"/);
assert.match(sourceQuoteConditions, /filled=\{scopeHasContent\}/);
assert.match(sourceQuoteConditions, /title=\{locked \? "Tiene contenido; sale en el PDF" : undefined\}/);
assert.doesNotMatch(sourceQuoteConditions, /vacía el campo/, "el aviso no promete que vaciar el campo lo oculte (en edición no persiste)");
assert.match(sourceQuoteConditions, /filled=\{hasText\(conditions\[key\]\)\}/);
assert.match(sourceQuoteWorkspaceCss, /\.quote-chip--filled \{\s*background: var\(--color-surface-brand\);/);
// "Dividir en apartados con título": enlace pequeño, solo con texto en el primer bloque y con el mismo manejador de siempre.
assert.match(sourceQuoteConditions, /hasText\(primaryScopeText\) && \(/);
assert.match(sourceQuoteConditions, /onClick=\{onAddScopeSection\} className="quote-conditions__link">Dividir en apartados con título</);
// "Qué incluye" conserva agregar apartado, orden y eliminar por apartado.
assert.match(sourceQuoteConditions, /\+ Agregar apartado/);
assert.match(sourceQuoteConditions, /aria-label="Subir apartado"/);
assert.match(sourceQuoteConditions, /aria-label="Bajar apartado"/);
assert.match(sourceQuoteConditions, />Eliminar<\/Button>/);
assert.match(sourceQuoteWorkspaceCss, /\.quote-chip \{[^}]*border: 1px dashed var\(--color-border-control\);/, "botones + de borde punteado");
assert.match(sourceQuoteWorkspaceCss, /\.quote-line__discount \{[^}]*width: 6rem;/, "descuento en un campo de 6 rem");
// Selección de cliente en línea: solo los primeros 6 resultados, aviso del total y mensaje claro sin clientes. Mismo filtro y mismo onChange.
assert.match(sourceClientSelector, /const INLINE_RESULTS_LIMIT = 6;/);
assert.match(sourceClientSelector, /visibleClients\.slice\(0, INLINE_RESULTS_LIMIT\)\.map/);
assert.match(sourceClientSelector, /visibleClients\.length > INLINE_RESULTS_LIMIT/);
assert.match(sourceClientSelector, /Mostrando \{INLINE_RESULTS_LIMIT\} de \{visibleClients\.length\} · sigue escribiendo para afinar/);
assert.match(sourceClientSelector, /const searching = search\.trim\(\)\.length > 0;/, "sin escribir no se dibuja ninguna lista");
assert.match(sourceClientSelector, /\{searching && \(visibleClients\.length > 0 \? \(/, "la lista solo existe al escribir");
assert.match(sourceClientSelector, /Tienes \{activeClients\.length === 1 \? "1 cliente activo" : `\$\{activeClients\.length\} clientes activos`\} · escribe un nombre o RUT para buscar/);
assert.match(sourceClientSelector, /<p className="sr-only" aria-live="polite">/, "aviso para lectores de pantalla con la cantidad de resultados");
assert.match(sourceClientSelector, /<strong>Aún no tienes clientes<\/strong>/);
assert.match(sourceClientSelector, /<Link className="client-selector__link" to="\/clientes">Ir a Clientes<\/Link>/);
assert.match(sourceClientSelector, /\{noClients && !picking && \(/, "el aviso general solo se ve cuando no hay selector en línea");
assert.equal((sourceClientSelector.match(/dialogClients\.map\(/g) || []).length, 1, "la ventana conserva su lista completa");
assert.equal((sourceClientSelector.match(/visibleClients\.map\(/g) || []).length, 0, "el selector en línea nunca dibuja la lista completa");
assert.match(sourceClientSelector, /filterSelectableClients\(clients, businessId, dialogSearch\)/, "la ventana usa el mismo filtro, con su propio buscador");
assert.match(sourceClientSelector, /initialFocusRef=\{dialogSearchRef\}/);
// "Ver todos los clientes": enlace junto a "Tienes N…" que abre la ventana de clientes que ya existe.
assert.match(sourceClientSelector, /<button type="button" className="client-selector__all" aria-haspopup="dialog" aria-expanded=\{open\} onClick=\{\(\) => setOpen\(true\)\}>Ver todos los clientes<\/button>/);
assert.match(sourceClientSelector, /<div className="client-selector__count">\s*<p className="client-selector__status">\s*Tienes /, "el enlace va junto a la línea Tienes N clientes activos (solo con clientes y sin escribir)");
assert.match(sourceClientSelector, /onClose=\{\(\) => \{ setOpen\(false\); setDialogSearch\(""\); \}\}/, "Escape y la X cierran sin cambiar nada");
assert.match(sourceClientSelector + fs.readFileSync("src/styles/interior.css", "utf8"), /\.client-selector__all \{[^}]*min-height: 2\.75rem;/, "área táctil de 44 px");
assert.match(sourceQuoteWorkspaceCss + fs.readFileSync("src/styles/interior.css", "utf8"), /\.client-selector--inline \.client-selector__results \{[^}]*max-height: 14rem;/, "alto máximo con scroll");
// Cabecera corta, paso 1 (cliente y asunto en línea) y resumen: solo presentación.
assert.match(sourceNewQuote, /<header className="quote-head no-print">/);
assert.match(sourceNewQuote, /<Link to="\/cotizaciones" className="quote-back-link">← Cotizaciones<\/Link>/);
assert.match(sourceNewQuote, /<p className="quote-head__title">\{isEditMode \? getQuoteDisplayNumber\(quote, "Editar cotización"\) : "Nueva cotización"\}<\/p>/);
assert.doesNotMatch(sourceNewQuote, /<h1/, "el único h1 de la pantalla es el de la barra superior");
assert.match(sourceNewQuote, /<h2 id="quote-client-title">1 · ¿A quién le cotizas\?<\/h2>/);
assert.match(sourceNewQuote, /<ClientSelector inline businessId=\{userId\} value=\{quote\.clienteId\} snapshot=\{quote\.cliente\} onChange=\{handleClientChange\} onAvailabilityChange=\{setClientAvailability\} \/>/, "mismo onChange y misma disponibilidad que antes");
assert.equal((sourceNewQuote.match(/La cotización guarda una copia histórica de los datos del cliente\./g) || []).length, 1, "el texto de guía no se repite");
assert.match(sourceClientSelector, /inline = false/, "la prop inline es opcional: sin ella el selector es el de siempre");
assert.doesNotMatch(sourceClientSelector, /\{!inline && <ResponsiveDialog/, "con inline la ventana también se dibuja (cerrada) y se abre con el enlace");
assert.match(sourceClientSelector, /<ResponsiveDialog\s+open=\{open\}/);
assert.match(sourceClientSelector, /filterSelectableClients\(clients, businessId, search\)/, "mismo filtro");
assert.equal((sourceClientSelector.match(/onChange\?\.\(client\)/g) || []).length, 1, "un solo punto de elección: onChange(client) con el objeto");
assert.match(sourceClientSelector, /placeholder="Buscar cliente por nombre o RUT"/);
assert.match(sourceQuoteSummary, /<h2>Resumen<\/h2>/);
assert.doesNotMatch(sourceQuoteSummary, /Totales|quote-workspace__kicker/, "el resumen ya no repite el rótulo");
assert.match(sourceQuoteWorkspaceCss, /\.quote-summary__row--total strong \{\s*color: var\(--color-text-brand\);\s*font-size: var\(--font-size-2xl\);/, "Total en color de marca, como en Venta");
assert.match(sourceQuoteWorkspaceCss, /\.quote-summary__discount input \{\s*max-width: 8rem;/, "campo de descuento con ancho razonable");
assert.doesNotMatch(sourceQuoteWorkspaceCss, /quote-workspace__client-project/);
assert.match(sourceQuoteCollapsible, /aria-expanded=\{open\}/);
assert.match(sourceQuoteWorkspaceCss, /position:\s*sticky/);
assert.match(sourceQuoteWorkspaceCss, /@media \(max-width: 620px\)/);
assert.match(sourceQuoteWorkspaceCss, /position:\s*static/);
assert.match(sourcePdf, /buildQuotePdfBase64/);
assert.match(sourceEmail, /buildQuotePdfAttachment/);
assert.match(sourceHistory, /downloadQuotePdf/);
assert.match(sourceHistory, /shareQuotePdf/);
assert.match(sourceHistory, /className="quote-document-footer"/);
assert.match(sourceHistory, /className="quote-document-footer__secondary"/);
assert.match(sourceHistory, /quote-document-footer__secondary[\s\S]*<QuoteActions/);
const documentActionPositions = ["Correo", "WhatsApp", "Descargar PDF", "Imprimir"]
  .map((label) => quotePrimaryActionsSource.indexOf(label));
assert.ok(documentActionPositions.every((position) => position >= 0));
assert.deepEqual([...documentActionPositions].sort((a, b) => a - b), documentActionPositions);
assert.equal((quotePrimaryActionsSource.match(/>\s*Correo\s*<\/button>/g) || []).length, 1);
assert.equal((quotePrimaryActionsSource.match(/: "WhatsApp"/g) || []).length, 1);
assert.equal((quotePrimaryActionsSource.match(/: "Descargar PDF"/g) || []).length, 1);
assert.equal((quotePrimaryActionsSource.match(/>\s*Imprimir\s*<\/button>/g) || []).length, 1);
assert.doesNotMatch(quoteActionsSource, /Correo|WhatsApp|Descargar PDF|Imprimir|runPdfAction/);
// Pendiente: Enviar y Editar visibles (en la lista el texto es "Editar"; en el
// detalle, "Editar cotización"); Marcar como emitida, Archivar y Eliminar en
// "Más acciones". Reenviar va en el menú de emitidas y Ver venta cuando hay
// venta vinculada.
assert.match(quoteActionsSource, /onClick=\{\(\) => onSend\(quote\)\}[\s\S]*?>\s*Enviar\s*<\/button>\s*<button[^>]*onClick=\{\(\) => onEditDraft\(quote\.id\)\}[\s\S]*?>\s*Editar\s*<\/button>/);
assert.match(quoteActionsSource, /onClick=\{\(\) => onEditDraft\(quote\.id\)\}[\s\S]*?>\s*Editar cotización\s*<\/button>/);
assert.match(quoteActionsSource, /actions=\{\[emitMenuAction, archiveMenuAction, deleteMenuAction\]\}/);
assert.doesNotMatch(quoteActionsSource, /editMenuAction/);
// Todo el bloque de acciones (incluido Editar) sigue limitado a quienes pueden escribir.
assert.match(sourceHistory, /\{canDuplicate && \(\s*<div className="erp-actions" style=\{styles\.mobileCardActions\}>/);
// Un solo filtro de estado: las pestañas, con "Archivadas" al final y su conteo.
// Ya no hay desplegable "Estado" ni la opción "Todas excepto archivadas".
assert.match(sourceHistory, /\["vencida", "Vencidas"\],\s*\["archivada", "Archivadas"\],\s*\];/);
assert.doesNotMatch(sourceHistory, /Todas excepto archivadas|STATUS_OPTIONS|filterLabels/);
assert.doesNotMatch(sourceHistory, /<span className="erp-field__label">Estado<\/span>/);
assert.doesNotMatch(sourceHistory, /<select/);
assert.match(sourceHistory, /className="erp-filters erp-history-filters quote-history-filters"/);
assert.match(sourceInteriorCss, /\.quote-history-filters \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}/);
assert.match(sourceHistory, /label: `\$\{label\} \(\$\{searchedQuotes\.filter/);
// La celda de vigencia del pendiente es una sola línea; emitidas, aceptadas y vencidas no cambian.
assert.match(sourceHistory, /Sin emitir · creada \{formatDate\(quote\.fecha\)\} · \{validityDays\} \{Number\(validityDays\) === 1 \? "día" : "días"\} de vigencia/);
assert.doesNotMatch(sourceHistory, /días al emitir|Sin emitir · Creada/);
assert.match(quoteActionsSource, /label: "Reenviar"/);
// Filas: acciones en estilo secundario y "Más acciones" solo con ícono
// (aria-label y title); el diálogo de detalle conserva el rótulo con texto.
assert.match(quoteActionsSource, /const mainActionStyle = inRow \? styles\.secondaryButton : styles\.primaryButton;/);
assert.doesNotMatch(quoteActionsSource, /style=\{styles\.primaryButton\}/);
assert.equal((quoteActionsSource.match(/iconOnly=\{inRow\}/g) || []).length, (quoteActionsSource.match(/<MoreActionsMenu/g) || []).length);
// El menú es el componente compartido de components/ui (también lo usa /inventario).
const moreActionsMenuSource = fs.readFileSync("src/components/ui/MoreActionsMenu.jsx", "utf8");
assert.match(sourceHistory, /import MoreActionsMenu from "\.\.\/components\/ui\/MoreActionsMenu";/);
assert.doesNotMatch(sourceHistory, /function MoreActionsMenu|styles\.(moreActions|actionsMenu)/);
assert.equal((quoteActionsSource.match(/menuLabel="Más acciones de cotización"/g) || []).length, (quoteActionsSource.match(/<MoreActionsMenu/g) || []).length);
assert.match(moreActionsMenuSource, /label = "Más acciones"/);
assert.match(moreActionsMenuSource, /aria-label=\{iconOnly \? label : undefined\}/);
assert.match(moreActionsMenuSource, /title=\{iconOnly \? label : undefined\}/);
assert.match(moreActionsMenuSource, /\{!iconOnly && <span>\{label\}<\/span>\}/);
assert.match(moreActionsMenuSource, /role="menu"/);
assert.match(moreActionsMenuSource, /role="menuitem"/);
assert.match(moreActionsMenuSource, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
assert.equal((sourceHistory.match(/<QuoteActions\s+inRow\b/g) || []).length, 2);
// Tabla: mismo criterio que /clientes. Sin anchos fijos ni table-layout:
// fixed (reparto automático), mismo relleno en todas las celdas (sin margen
// extra en Total), Número/Estado/Total/Acciones sin partirse y la columna
// Acciones solo para roles con acciones.
const quoteTableCss = sourceInteriorCss.slice(
  sourceInteriorCss.indexOf(".quote-history-table {"),
  sourceInteriorCss.indexOf(".quote-history-table .quote-history-sale-link")
).replace(/\/\*[\s\S]*?\*\//g, "");
assert.match(quoteTableCss, /\.quote-history-table \{\s*min-width: 920px;\s*\}/);
assert.doesNotMatch(quoteTableCss, /table-layout|(?<!-)\bwidth:|padding-right/);
for (const selector of [
  ".quote-history-table__number",
  ".quote-history-table__status",
  ".quote-history-table__total",
  ".quote-history-table__actions button",
]) {
  const nowrapRule = quoteTableCss.slice(0, quoteTableCss.indexOf("white-space: nowrap"));
  assert.ok(nowrapRule.includes(`${selector},`) || nowrapRule.includes(`${selector} {`), selector);
}
assert.match(sourceHistory, /<td className="quote-history-table__number">/);
assert.match(sourceHistory, /<td className="quote-history-table__status">/);
assert.match(sourceHistory, /\{canDuplicate && <th className="quote-history-table__actions">Acciones<\/th>\}/);
assert.match(sourceHistory, /\{canDuplicate && \(\s*<td className="quote-history-table__actions">/);
assert.match(sourceHistory, /columns=\{canDuplicate \? 6 : 5\}/);
assert.doesNotMatch(sourceHistory, /quote-history-table--readonly|quote-history-table__client-cell/);
// Única excepción a la separación uniforme: más aire entre Total y Válida
// hasta, en cabecera, celdas y esqueleto de carga.
assert.match(
  quoteTableCss,
  /\.quote-history-table \.quote-history-table__validity,\s*\.quote-history-skeleton th:nth-child\(5\),\s*\.quote-history-skeleton td:nth-child\(5\) \{\s*padding-left: var\(--space-8\);\s*\}/
);
assert.match(sourceHistory, /<th className="quote-history-table__validity">Válida hasta<\/th>/);
assert.match(sourceHistory, /<td className="quote-history-table__validity">\s*<QuoteValidity/);
assert.match(sourceHistory, /<SkeletonTable className="erp-desktop-only quote-history-skeleton" columns=\{canDuplicate \? 6 : 5\} \/>/);
assert.match(quoteActionsSource, />\s*Ver venta\s*<\/button>/);
assert.match(sourceHistory, /<SegmentedControl[\s\S]*?options=\{quickFilterOptions\}[\s\S]*?value=\{statusFilter\}/);
assert.match(sourceHistory, /Válida hasta/);
assert.doesNotMatch(sourceHistory, /Actualización<\/th>/);
assert.match(sourceHistory, /getQuoteClientFiscalId\(quote\)/);
// Cierre: solo la aceptación tiene fecha confiable (ventaRegistradaEn);
// rechazadas y vencidas muestran solo la emisión, sin vigencia.
assert.match(sourceHistory, /estado === "aceptada" && quote\.ventaRegistradaEn/);
assert.match(sourceHistory, /Aceptada \{formatDate\(quote\.ventaRegistradaEn\)\}/);
assert.match(sourceHistory, /if \(estado !== "emitida"\) \{[\s\S]*?return <span>\{emissionLabel\}<\/span>;/);
// Sin acciones en la fila: número de venta bajo "Aceptada" (sin duplicar
// el botón "Ver venta" de quienes sí tienen acciones).
assert.match(sourceHistory, /!canDuplicate && quote\.estado === "aceptada" && quote\.ventaId && quote\.ventaNumero/);
assert.match(sourceHistory, /canReadSales \? \(/);
assert.doesNotMatch(sourceHistory, /quote-history-table__sale/);
assert.doesNotMatch(quoteDetailSource, /icon=\{Mail\}|icon=\{MessageCircle\}|icon=\{Download\}|icon=\{Printer\}|runPdfAction/);
assert.match(commercialStatusSource, /label: "Estado actual"/);
assert.match(commercialStatusSource, /getQuoteStatusLabel\(quote\.estado\)/);
assert.match(commercialStatusSource, /estadoEnvioCorreo/);
assert.match(commercialStatusSource, /respuestaCliente/);
assert.match(commercialStatusSource, /Aceptada por cliente/);
assert.match(commercialStatusSource, /Rechazada por cliente/);
assert.match(sourceInteriorCss, /\.quote-document-footer \{[\s\S]*flex-wrap: wrap/);
assert.match(sourceInteriorCss, /@media \(max-width: 767px\)[\s\S]*\.quote-document-footer__primary \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(sourceInteriorCss, /@media \(max-width: 420px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
assert.match(sourceHistory, /Duplicar como pendiente/);
assert.match(sourceHistory, /Marcar como emitida/);
assert.match(sourceHistory, /motivoRechazoCliente/);
assert.match(sourceHistory, /comentarioRechazoCliente/);
assert.match(sourceHistory, /Sin comentario adicional/);
assert.match(sourceHistory, /Aceptar cotización/);
assert.match(sourceHistory, /Registrar aceptación/);
assert.match(sourceHistory, /title: "Ver venta"/);
assert.match(sourceHistory, /acceptanceRequestIdsRef/);
assert.doesNotMatch(sourceHistory, /Aceptar y preparar venta|Crear venta en borrador|Venta preparada|Preparar venta/);
assert.match(sourceHistory, /onChangeStatus/);
assert.match(sourceHistory, /Crea una cotización para registrar una nueva propuesta comercial/);
assert.match(sourceHistory, /openCreateClient: true/);
assert.match(sourceHistory, /Ir al inventario/);
assert.match(sourceHistory, /BUSINESS_PERMISSIONS\.INVENTORY_WRITE/);
assert.match(duplicateServiceSource, /sourceId[\s\S]*requestId/);
assert.doesNotMatch(duplicateServiceSource, /quote:\s*payload/);
assert.match(sourceQuotePersistence, /quoteDuplicateRequests/);
assert.match(sourceQuotePersistence, /cotizacionOrigenId/);
assert.match(sourceQuotePersistence, /storedQuote[\s\S]*estado:\s*"borrador"/);
assert.doesNotMatch(sourceQuoteDocument, /borrador:\s*"Borrador"/);
// El documento formal ya no muestra el estado comercial (queda en el modal).
assert.doesNotMatch(sourceQuoteDocument, /getQuoteStatusLabel|Estado comercial/);
assert.match(sourceQuoteDocument, /showCode/);
assert.match(sourceQuoteDocument, /showUnit/);
assert.match(sourceQuoteDocument, /showDiscount/);
assert.match(sourceQuoteDocument, /buildQuoteTerms\(quote\.condiciones\)/);
assert.match(sourceQuoteDocumentLayout, /Condiciones de pago/);
assert.doesNotMatch(sourceQuoteDocument, /19%/);
assert.match(sourceQuotePrintView, /@page\{size:A4/);
assert.match(sourceQuotePrintView, /showCode/);
assert.match(sourceQuotePrintView, /showUnit/);
assert.match(sourceQuotePrintView, /showDiscount/);
assert.doesNotMatch(sourceQuotePrintView, /Estado comercial|getQuoteStatusLabel/);
// El estado de envío vive solo en el modal, no en la cabecera del documento.
assert.doesNotMatch(sourceQuotePrintView + sourceQuoteDocument, /Aún no ha sido enviada/);
// El número de cotización no se parte en dos líneas.
assert.match(sourceQuotePrintView, /__title strong\{[^}]*white-space:nowrap/);
assert.match(sourceQuotePrintView, /Términos y condiciones/);
assert.match(sourceQuotePrintView, /buildQuoteTerms\(quote\.condiciones\)/);
assert.match(sourceQuotePrintView, /QUOTE_FOOTER_QUESTION/);
// Documento claro y sin colores sueltos: solo tokens --color-document-*.
assert.doesNotMatch(sourceQuotePrintView, /#[0-9a-fA-F]{3,8}|rgba?\(/);
assert.doesNotMatch(sourceQuotePrintView, /var\(--color-(?!document)/);
// Contenido del documento: todo sale de los datos, nada fijo de una empresa.
assert.deepEqual(buildQuoteTerms({}), []);
assert.deepEqual(
  buildQuoteTerms({
    formaPago: " 50% al inicio ",
    garantia: "",
    terminosAdicionales: "1. Valores por unidad\n\n2) Mantenimiento sujeto a evaluación",
  }),
  [
    "Condiciones de pago: 50% al inicio",
    "Valores por unidad",
    "Mantenimiento sujeto a evaluación",
  ]
);
assert.equal(buildQuoteFooterContact({}), "");
assert.equal(
  buildQuoteFooterContact({ responsable: "Ana Pérez", telefono: "", email: "ana@empresa.cl" }),
  "Ana Pérez, ana@empresa.cl"
);
assert.equal(
  buildQuoteAcceptanceLine({ texto: "Acepto los términos y condiciones de esta cotización." }),
  "Acepto los términos y condiciones de esta cotización. (firmar a continuación)"
);
assert.doesNotMatch(sourceQuotePrintView + sourceQuoteDocument + sourceQuoteDocumentLayout, /Bagner|Pairumani/i);
assert.doesNotMatch(sourceQuotePrintView, /19%/);
assert.doesNotMatch(sourceQuotePrintView, /getDoc|getDocs|onSnapshot|listarClientes/);
assert.match(sourceDashboard, /getQuoteStatusLabel\("borrador"\)/);
// Eliminar borradores: solo OWNER/ADMIN, confirmación por palabra y vía Function.
assert.deepEqual(
  ["OWNER", "ADMIN", "VENTAS", "FINANZAS", "MEMBER", "", undefined].map((role) => canDeleteQuotes(role)),
  [true, true, false, false, false, false, false]
);
assert.equal(canDeleteQuotes("admin"), true);
assert.deepEqual(
  ["permanente", "  PERMANENTE ", "Permanente", "perman", "", "permanentemente", null].map(isQuoteDeleteConfirmed),
  [true, true, true, false, false, false, false]
);
assert.match(sourceQuoteService, /"deleteQuoteDraft"/);
assert.doesNotMatch(sourceQuoteService, /deleteDoc|deleteField/);
assert.match(sourceHistory, /label: "Eliminar cotización"/);
assert.match(sourceHistory, /onDelete=\{canDelete \? handleRequestDelete : undefined\}/);
assert.match(sourceHistory, /disabled=\{!isQuoteDeleteConfirmed\(deleteConfirmation\)\}/);
assert.match(sourceHistory, /NO se borran/);
// Solo los borradores ofrecen la opción (el menú de otros estados no la incluye).
const draftMenuSource = quoteActionsSource.slice(
  quoteActionsSource.indexOf('if (estado === "borrador")'),
  quoteActionsSource.indexOf('if (estado === "emitida")')
);
assert.match(draftMenuSource, /deleteMenuAction/);
assert.doesNotMatch(
  quoteActionsSource.slice(quoteActionsSource.indexOf('if (estado === "emitida")')),
  /deleteMenuAction/
);
// La interfaz oculta "Eliminar cotización" donde la Function la rechazaría, con
// los mismos campos de findDeletionBlocker que el cliente sí tiene.
assert.match(sourceHistory, /onDelete && canOfferQuoteDeletion\(quote\)/);
{
  const {findDeletionBlocker} = require("../functions/quoteDeletion.js");
  const noExternal = {envioExists: false, saleExists: false, tokenExists: false};
  const cleanDraft = {estado: "borrador", fechaEmision: "", canalEmision: null, respuestaCliente: "", estadoEnvioCorreo: undefined};
  assert.equal(canOfferQuoteDeletion(cleanDraft), true);
  assert.equal(canOfferQuoteDeletion({}), true, "sin estado se trata como borrador");
  const blockingFields = {
    estado: "emitida",
    fechaEmision: "2026-05-01",
    canalEmision: "whatsapp",
    ventaId: "v1",
    respuestaCliente: "aceptada",
    respuestaClienteEn: {seconds: 1},
    fechaEnvioCorreo: {seconds: 1},
    estadoEnvioCorreo: "enviado",
    tokenPublicoHash: "abc",
    tokenWhatsappHash: "abc",
    propuestaPublicaCreadaEn: {seconds: 1},
    whatsappPreparadoEn: {seconds: 1},
  };
  for (const [field, value] of Object.entries(blockingFields)) {
    const quote = {...cleanDraft, [field]: value};
    assert.equal(canOfferQuoteDeletion(quote), false, `${field} oculta la opción`);
    assert.equal(canOfferQuoteDeletion(quote), findDeletionBlocker(quote, noExternal) === "", `${field}: igual que la Function`);
  }
  assert.equal(canOfferQuoteDeletion(cleanDraft), findDeletionBlocker(cleanDraft, noExternal) === "");
}
// Las reglas siguen denegando cualquier escritura de cotizaciones desde el cliente.
const sourceFirestoreRules = fs.readFileSync("firestore.rules", "utf8");
assert.match(
  sourceFirestoreRules,
  /match \/cotizaciones\/\{quoteId\} \{\s*allow read: if hasBusinessModuleAccess\([^\n]*\);\s*allow create: if false;\s*allow update: if false;\s*allow delete: if false;/
);
// Cabecera del PDF: etiqueta en negrita y valor normal (como el <strong> del
// HTML), y una dirección larga se parte sin desalinear la columna derecha.
assert.match(sourceQuotePrintView, /<strong>\{label\}: <\/strong>/);
assert.match(sourceQuoteDocument, /drawRightLabeledLine\(doc, label, value, right, rightEnd, 82\)/);
{
  const probe = new jsPDF({ unit: "mm", format: "a4" });
  const drawn = [];
  const originalText = probe.text.bind(probe);
  probe.text = (text, x, y, options) => {
    drawn.push({ text, x, y, align: options?.align, style: probe.getFont().fontStyle });
    return originalText(text, x, y, options);
  };
  probe.setFontSize(8);
  const right = 194;
  const maxWidth = 82;
  const longAddress = "Avenida Libertador General Bernardo O'Higgins 1234, Oficina 567, Torre Norte, Edificio Comercial Centro";
  const end = drawRightLabeledLine(probe, "Dirección", longAddress, right, 30, maxWidth);
  const valueCalls = drawn.filter((call) => call.style === "normal");
  const labelCalls = drawn.filter((call) => call.style === "bold");
  assert.ok(valueCalls.length >= 2, "la dirección larga se parte en varias líneas");
  assert.equal(labelCalls.length, 1, "la etiqueta se dibuja una sola vez");
  assert.equal(labelCalls[0].text, "Dirección: ");
  assert.equal(labelCalls[0].y, valueCalls[0].y, "etiqueta en la primera línea del valor");
  assert.deepEqual(valueCalls.map((call) => call.x), valueCalls.map(() => right), "todas las líneas terminan en el margen derecho");
  valueCalls.forEach((call, index) => {
    assert.ok(Math.abs(call.y - (30 + index * 4.2)) < 1e-9, "líneas consecutivas sin saltos");
  });
  assert.ok(Math.abs(end - (30 + valueCalls.length * 4.2)) < 1e-9);
  probe.setFont("helvetica", "bold");
  const labelWidth = probe.getTextWidth("Dirección: ");
  probe.setFont("helvetica", "normal");
  const firstWidth = probe.getTextWidth(valueCalls[0].text);
  assert.ok(Math.abs(labelCalls[0].x - (right - firstWidth)) < 1e-6, "la etiqueta termina donde empieza el valor");
  assert.ok(labelWidth + firstWidth <= maxWidth + 1e-6, "etiqueta y valor caben en el ancho máximo");
  for (const call of valueCalls) assert.ok(probe.getTextWidth(call.text) <= maxWidth - labelWidth + 1e-6, "ninguna línea excede el ancho");
  assert.equal(probe.getFont().fontStyle, "normal", "la fuente queda en normal para lo que sigue");
  // Un valor corto queda en una línea con la etiqueta pegada.
  drawn.length = 0;
  drawRightLabeledLine(probe, "RUT", "77.091.679-8", right, 20, maxWidth);
  assert.equal(drawn.length, 2);
  assert.equal(drawn.find((call) => call.style === "bold").text, "RUT: ");
  // El documento completo se construye con una dirección larga.
  const longAddressPdf = buildQuotePdfDocument({
    quote: {
      ...quoteFixture(),
      empresaSnapshot: { ...company, direccion: longAddress },
    },
  });
  assert.ok(longAddressPdf.doc.getNumberOfPages() >= 1);
}
console.log("OK documento: jerarquía común, columnas condicionales, impuesto dinámico y snapshots históricos");

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
      items: [
        item(1, {
          codigo: "PROD-0001",
          nombre: "Cámara IP 4 MP",
          tipoItem: "producto",
          unidad: "unidad",
          cantidad: 3,
          precioUnitarioEditable: 125000,
          descuentoPorcentaje: 8,
        }),
        item(2, {
          nombre: "Instalación y configuración",
          tipoItem: "servicio",
          unidad: "servicio",
          precioUnitarioEditable: 180000,
        }),
        ...Array.from({ length: 7 }, (_, index) =>
          item(index + 3, { precioUnitarioEditable: 45000 + index * 12500 })
        ),
      ],
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
  [
    "07-multicurrency-tax-snapshot",
    {
      ...quoteFixture({
        items: [item(1, { precioUnitarioEditable: 1250, descuentoPorcentaje: 5 })],
      }),
      moneda: "USD",
      locale: "es-PE",
      impuestoNombre: "IGV",
      tasaIva: 0.18,
      subtotal: 1250,
      descuentoTotal: 62.5,
      neto: 1187.5,
      iva: 213.75,
      total: 1401.25,
    },
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
