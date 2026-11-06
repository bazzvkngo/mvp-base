import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {
  DELETE_CONFIRMATION_WORD,
  DELETE_FALLBACK_MESSAGE,
  adaptStoredPurchaseOrder,
  buildPurchaseOrderMutationPayload,
  calculatePurchaseOrderLine,
  calculatePurchaseOrderTotals,
  canDeletePurchaseOrder,
  canManagePurchaseOrders,
  canOfferPurchaseOrderDeletion,
  getPurchaseOrderDeleteErrorMessage,
  hasPurchaseOrderEmissionTrace,
  isDeleteConfirmed as isFrontendDeleteConfirmed,
  getProviderPurchaseOrderPaymentTerms,
  getSupplierResponseLabel,
  getSupplierResponseState,
  matchesPurchaseOrderSearch,
  resolvePurchaseOrderProviderPreview,
} from "../src/domain/purchaseOrderModel.mjs";
import {buildPurchaseOrderPdfDocument} from "../src/domain/purchaseOrderDocument.mjs";
import {
  buildPurchaseOrderWhatsAppMessage,
  getPurchaseOrderWhatsAppAvailability,
  normalizePurchaseOrderWhatsAppPhone,
} from "../src/utils/purchaseOrderPdf.js";

const require = createRequire(import.meta.url);
const {
  duplicarOrdenCompraComoBorradorHandler,
  historicalPurchaseOrderCopyInput,
  registrarRespuestaProveedorHandler,
} = require(
  "../functions/purchaseOrderPersistence.js"
);

const item = (overrides = {}) => ({
  lineaId: "linea-1",
  itemId: "item-1",
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  ...overrides,
});

const companySnapshot = {
  nombreComercial: "Valora Ingeniería",
  razonSocial: "Valora Ingeniería SpA",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: "77.091.679-8",
  giro: "Servicios de ingeniería",
  direccion: "Avenida Industrial 2450",
  ciudad: "Iquique",
  region: "Tarapacá",
  responsable: "María Soto",
  telefono: "+56 9 5555 1212",
  email: "compras@valora.test",
};

const providerSnapshot = {
  proveedorId: "provider-document",
  razonSocial: "Suministros del Norte SpA",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: "76.345.678-9",
  personaContacto: "Carlos Muñoz",
  email: "ventas@suministros.test",
  telefono: "+56 9 4444 2323",
  direccion: "Ruta A-16 1800",
  comunaNombre: "Alto Hospicio",
  regionNombre: "Tarapacá",
  condicionesPago: "Transferencia a 30 días",
  diasCredito: 30,
};

const documentItem = (index, overrides = {}) => ({
  lineaId: `linea-documento-${index}`,
  itemId: `item-documento-${index}`,
  codigo: `PROD-${String(index).padStart(4, "0")}`,
  nombre: `Producto industrial ${index}`,
  descripcion: "Suministro según especificación técnica acordada.",
  tipoItem: "producto",
  unidad: "unidad",
  cantidad: 2,
  costoUnitario: 45000,
  descuentoPct: 0,
  ...overrides,
});

const orderFixture = (overrides = {}) => ({
  id: "order-document",
  numero: "OC-2026-0142",
  estado: "emitida",
  fechaEmision: "2026-08-27",
  fechaEntregaEstimada: "2026-09-05",
  direccionEntrega: "Bodega central, Avenida Industrial 2450, Iquique",
  condicionesPago: "Transferencia a 30 días",
  observaciones: "Coordinar horario de descarga con el área de operaciones.",
  moneda: "CLP",
  locale: "es-CL",
  impuestoNombre: "IVA",
  tasaIva: 0.19,
  empresaSnapshot: companySnapshot,
  proveedorId: providerSnapshot.proveedorId,
  proveedorSnapshot: providerSnapshot,
  items: [documentItem(1)],
  ...overrides,
});

assert.deepEqual(calculatePurchaseOrderLine(item()), {
  cantidad: 2,
  costoUnitario: 1000,
  descuentoPct: 10,
  subtotalLinea: 2000,
  descuentoLinea: 200,
  totalLinea: 1800,
});
assert.deepEqual(calculatePurchaseOrderTotals([
  item(),
  item({lineaId: "linea-2", itemId: "item-2", cantidad: 1, costoUnitario: 500, descuentoPct: 0}),
]), {subtotal: 2500, descuentoTotal: 200, neto: 2300, iva: 437, total: 2737});
assert.throws(() => calculatePurchaseOrderLine(item({cantidad: 0})), /entre|mayor/);
assert.throws(() => calculatePurchaseOrderLine(item({cantidad: Infinity})), /numérico|número/);
assert.throws(() => calculatePurchaseOrderLine(item({cantidad: NaN})), /numérico|número/);
assert.throws(() => calculatePurchaseOrderLine(item({costoUnitario: -1})), /entre|mayor/);
assert.throws(() => calculatePurchaseOrderLine(item({descuentoPct: 101})), /superar|entre/);
assert.throws(
  () => calculatePurchaseOrderLine(item({costoUnitario: Number.MAX_VALUE})),
  /El monto de la orden supera el máximo permitido\./
);
assert.throws(
  () => calculatePurchaseOrderLine(item({cantidad: Number.MAX_VALUE, costoUnitario: 1})),
  /El monto de la orden supera el máximo permitido\./
);
assert.throws(
  () => calculatePurchaseOrderLine(item({cantidad: 2, costoUnitario: Number.MAX_VALUE})),
  /El monto de la orden supera el máximo permitido\./
);
assert.throws(
  () => calculatePurchaseOrderTotals([item({cantidad: 1, costoUnitario: Number.MAX_SAFE_INTEGER, descuentoPct: 0})]),
  /El monto de la orden supera el máximo permitido\./
);
console.log("OK modelo: cantidades, costos, descuentos, IVA y totales");

const historicalProviderA = {
  proveedorId: "provider-a",
  estado: "activo",
  razonSocial: "Proveedor A histórico",
};
const liveProviderA = {
  proveedorId: "provider-a",
  estado: "activo",
  razonSocial: "Proveedor A vivo modificado",
};
const liveProviderB = {
  proveedorId: "provider-b",
  estado: "activo",
  razonSocial: "Proveedor B actual",
};
const orderWithProviderA = {
  proveedorId: "provider-a",
  proveedorSnapshot: historicalProviderA,
};
assert.strictEqual(
  resolvePurchaseOrderProviderPreview(
    orderWithProviderA,
    "provider-a",
    [liveProviderA, liveProviderB]
  ),
  historicalProviderA
);
assert.strictEqual(
  resolvePurchaseOrderProviderPreview(
    orderWithProviderA,
    "provider-b",
    [liveProviderA, liveProviderB]
  ),
  liveProviderB
);
assert.strictEqual(
  resolvePurchaseOrderProviderPreview(
    orderWithProviderA,
    "provider-a",
    [liveProviderA, liveProviderB]
  ),
  historicalProviderA
);
console.log("OK preview proveedor: A→A histórico, A→B vivo y A→B→A histórico");
assert.equal(getProviderPurchaseOrderPaymentTerms({condicionesPago: "credito", diasCredito: 30}), "Crédito a 30 días");
assert.equal(getProviderPurchaseOrderPaymentTerms({condicionesPago: "transferencia", diasCredito: 0}), "Transferencia");
assert.equal(getProviderPurchaseOrderPaymentTerms({condicionesPago: "", diasCredito: 30}), "");
assert.equal(buildPurchaseOrderMutationPayload({proveedorId: "provider-a", condicionesPago: "", items: [item()]}).condicionesPago, "");
assert.equal(buildPurchaseOrderMutationPayload({proveedorId: "provider-a", condicionesPago: "Pago contra entrega", items: [item()]}).condicionesPago, "Pago contra entrega");
console.log("OK condiciones proveedor: precarga visible y editable para la OC");

const mutation = buildPurchaseOrderMutationPayload({
  proveedorId: "proveedor-1",
  items: [{
    ...item(),
    nombre: "Nombre manipulado",
    codigo: "FAKE",
    inventarioSnapshot: {nombre: "Snapshot manipulado"},
    totalLinea: 1,
  }],
  proveedorSnapshot: {razonSocial: "Proveedor manipulado"},
  numero: "OC-FAKE",
  estado: "emitida",
  total: 1,
});
assert.deepEqual(Object.keys(mutation.items[0]).sort(), [
  "cantidad", "costoUnitario", "descuentoPct", "itemId", "lineaId",
].sort());
assert.equal("proveedorSnapshot" in mutation, false);
assert.equal("numero" in mutation, false);
assert.equal("estado" in mutation, false);
assert.equal("total" in mutation, false);
console.log("OK contrato: frontend solo envía IDs y valores editables");

const stored = adaptStoredPurchaseOrder({
  id: "oc-legacy",
  numeroOrdenCompra: "OC-2025-0002",
  proveedorNombre: "Proveedor histórico",
  proveedorRut: "12.345.678-5",
  estado: "emitida",
  items: [{
    inventarioId: "legacy-1",
    nombre: "Ítem legacy",
    tipo: "servicio",
    cantidad: 1,
    costo: 10000,
  }],
});
assert.equal(stored.ordenCompraId, "oc-legacy");
assert.equal(stored.numero, "OC-2025-0002");
assert.equal(stored.proveedorSnapshot.razonSocial, "Proveedor histórico");
assert.equal(stored.items[0].tipoItem, "servicio");
assert.equal(stored.total, 11900);
assert.equal("purchaseOrderId" in stored, false);
assert.equal(matchesPurchaseOrderSearch(stored, "historico"), true);
assert.equal(canManagePurchaseOrders("ADMIN"), true);
assert.equal(canManagePurchaseOrders("COMPRAS"), true);
assert.equal(canManagePurchaseOrders("VENTAS"), false);
assert.equal(canManagePurchaseOrders("MEMBER"), false);
console.log("OK compatibilidad: adapter legacy y roles");

for (const [state, label] of [
  ["pendiente", "Pendiente"],
  ["confirmada", "Confirmada"],
  ["rechazada", "Rechazada"],
  ["confirmada_con_observaciones", "Confirmada con observaciones"],
]) {
  const responseOrder = {respuestaProveedor: {estado: state}};
  assert.equal(getSupplierResponseState(responseOrder), state);
  assert.equal(getSupplierResponseLabel(responseOrder), label);
}
assert.equal(normalizePurchaseOrderWhatsAppPhone("+56 9 6123 4587"), "56961234587");
assert.equal(normalizePurchaseOrderWhatsAppPhone("9 6123 4587"), "56961234587");
assert.equal(getPurchaseOrderWhatsAppAvailability({proveedorSnapshot: {telefono: ""}}).enabled, false);
assert.match(
  buildPurchaseOrderWhatsAppMessage({order: orderFixture(), companyProfile: companySnapshot}),
  /confirma su recepción o indícanos cualquier observación/
);
console.log("OK confirmación proveedor y WhatsApp: cuatro estados, teléfono internacional y mensaje seguro");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function registerSupplierResponse(estado, comentario = "") {
  let storedUpdate;
  const orderRef = {};
  const businessRef = {collection: () => ({doc: () => orderRef})};
  const result = await registrarRespuestaProveedorHandler({
    auth: {uid: "owner-a", token: {name: "Usuario QA", email: "usuario@qa.test"}},
    data: {ordenCompraId: "order-a", estado, comentario},
  }, {
    db: {runTransaction: async (operation) => operation({
      get: async () => ({exists: true, data: () => ({negocioId: "business-a", estado: "emitida"})}),
      update: (_ref, update) => { storedUpdate = update; },
    })},
    FieldValue: {serverTimestamp: () => "SERVER_TIMESTAMP"},
    HttpsError: FakeHttpsError,
    requireBusinessAccess: async () => ({uid: "owner-a", businessId: "business-a", businessRef}),
  });
  return {result, storedUpdate};
}

const observedResponse = await registerSupplierResponse(
  "confirmada_con_observaciones",
  "Ajustar fecha de entrega"
);
assert.equal(observedResponse.storedUpdate.respuestaProveedor.estado, "confirmada_con_observaciones");
assert.equal(observedResponse.storedUpdate.respuestaProveedor.fecha, "SERVER_TIMESTAMP");
assert.equal(observedResponse.storedUpdate.respuestaProveedor.registradaPorUid, "owner-a");
assert.equal(observedResponse.result.ordenCompra.respuestaProveedor.comentario, "Ajustar fecha de entrega");
await assert.rejects(
  () => registerSupplierResponse("confirmada_con_observaciones"),
  /Agrega la observacion/
);

const copyInput = historicalPurchaseOrderCopyInput({
  ...stored,
  id: "orden-original",
  ordenCompraId: "orden-original",
  numero: "OC-2026-0001",
  estado: "cancelada",
  proveedorId: "proveedor-1",
  total: 1,
  items: [{
    lineaId: "linea-copy",
    itemId: "item-copy",
    cantidad: 3,
    costoUnitario: 12500,
    descuentoPct: 5,
    inventarioSnapshot: {nombre: "Histórico"},
  }],
});
assert.equal(copyInput.proveedorId, "proveedor-1");
assert.deepEqual(copyInput.items[0], {
  lineaId: "linea-copy",
  itemId: "item-copy",
  cantidad: 3,
  costoUnitario: 12500,
  descuentoPct: 5,
});
assert.equal("id" in copyInput, false);
assert.equal("numero" in copyInput, false);
assert.equal("estado" in copyInput, false);
assert.equal("total" in copyInput, false);
console.log("OK duplicación: copia datos editables sin autoridad histórica");

async function duplicateOrderPaymentTerms(condicionesPago) {
  const sourceId = "order-source";
  const generatedId = `order-copy-${condicionesPago ? "informed" : "empty"}`;
  const reference = (collectionName, id) => ({collectionName, id});
  const businessRef = {
    collection: (collectionName) => ({
      doc: (id) => reference(collectionName, id || generatedId),
    }),
  };
  const source = {
    negocioId: "business-a",
    estado: "emitida",
    numero: "OC-2026-0001",
    proveedorId: "provider-a",
    condicionesPago,
    fechaEntregaEstimada: "",
    direccionEntrega: "",
    observaciones: "",
    items: [{
      lineaId: "linea-1",
      itemId: "item-1",
      cantidad: 1,
      costoUnitario: 1000,
      descuentoPct: 0,
    }],
  };
  let storedOrder;
  const snapshot = (id, data, exists = true) => ({id, exists, data: () => data});
  const result = await duplicarOrdenCompraComoBorradorHandler({
    auth: {uid: "owner-a"},
    data: {sourceId, requestId: `duplicate-${condicionesPago ? "informed" : "empty"}`},
  }, {
    db: {runTransaction: async (operation) => operation({
      get: async (ref) => {
        if (ref.collectionName === "purchaseOrderDuplicateRequests") {
          return snapshot(ref.id, {}, false);
        }
        if (ref.collectionName === "ordenesCompra" && ref.id === sourceId) {
          return snapshot(sourceId, source);
        }
        throw new Error(`Lectura inesperada ${ref.collectionName}/${ref.id}`);
      },
      getAll: async (...refs) => refs.map((ref) => {
        if (ref.collectionName === "proveedores") {
          return snapshot(ref.id, {
            negocioId: "business-a",
            proveedorId: "provider-a",
            estado: "activo",
            razonSocial: "Proveedor vigente",
            condicionesPago: "credito",
          });
        }
        if (ref.collectionName === "purchaseOrderCounters") {
          return snapshot(ref.id, {lastNumber: 1});
        }
        if (ref === businessRef) return snapshot("business-a", {nombreComercial: "Valora"});
        if (ref.collectionName === "empresa") return snapshot(ref.id, {});
        if (ref.collectionName === "inventario") {
          return snapshot(ref.id, {
            negocioId: "business-a",
            estado: "activo",
            nombre: "Producto vigente",
            tipoItem: "producto",
            unidad: "unidad",
          });
        }
        throw new Error(`Lectura agrupada inesperada ${ref.collectionName}/${ref.id}`);
      }),
      set: (ref, value) => {
        if (ref.collectionName === "ordenesCompra" && ref.id === generatedId) storedOrder = value;
      },
    })},
    FieldValue: {serverTimestamp: () => "SERVER_TIMESTAMP"},
    HttpsError: FakeHttpsError,
    requireBusinessAccess: async () => ({uid: "owner-a", businessId: "business-a", businessRef}),
  }, new Date("2026-08-29T12:00:00Z"));
  assert.equal(result.ordenCompra.condicionesPago, condicionesPago);
  assert.equal(storedOrder.condicionesPago, condicionesPago);
  return storedOrder;
}

assert.equal((await duplicateOrderPaymentTerms("")).condicionesPago, "");
assert.equal(
  (await duplicateOrderPaymentTerms("Pago contra entrega")).condicionesPago,
  "Pago contra entrega"
);
console.log("OK duplicación handler: condiciones explícitas preservadas sin fallback del proveedor");

const backendSource = fs.readFileSync("functions/purchaseOrderPersistence.js", "utf8");
const rulesSource = fs.readFileSync("firestore.rules", "utf8");
const pageSource = fs.readFileSync("src/pages/NewPurchaseOrderPage.jsx", "utf8");
const providerSelectorSource = fs.readFileSync(
  "src/features/purchaseOrders/ProviderSelector.jsx",
  "utf8"
);
const historySource = fs.readFileSync("src/pages/PurchaseOrdersPage.jsx", "utf8");
const printViewSource = fs.readFileSync("src/features/purchaseOrders/PurchaseOrderPrintView.jsx", "utf8");
const documentSource = fs.readFileSync("src/domain/purchaseOrderDocument.mjs", "utf8");
const pdfSource = fs.readFileSync("src/utils/purchaseOrderPdf.js", "utf8");
const purchaseOrderCssSource = fs.readFileSync(
  "src/features/purchaseOrders/purchase-orders.css",
  "utf8"
);
assert.match(backendSource, /transaction\.getAll/);
assert.match(backendSource, /purchaseOrderCreateRequests/);
assert.match(backendSource, /purchaseOrderDuplicateRequests/);
assert.match(backendSource, /ordenCompraOrigenId/);
assert.match(backendSource, /purchaseOrderCounters/);
assert.match(backendSource, /providerSnapshotFromDocument/);
assert.match(backendSource, /inventorySnapshotFromDocument/);
assert.doesNotMatch(backendSource, /condicionesPago:\s*input\.condicionesPago\s*\|\|/);
assert.match(rulesSource, /match \/ordenesCompra\/\{ordenCompraId\}/);
assert.match(rulesSource, /allow create, update, delete: if false/);
// Eliminación permanente (SPEC 005, enmienda 2026-11-06): Function propia, solo OWNER/ADMIN, sin tocar reglas ni contador.
const deletionSource = fs.readFileSync("functions/purchaseOrderDeletion.js", "utf8");
const functionsIndexSource = fs.readFileSync("functions/index.js", "utf8");
const functionsPackageSource = fs.readFileSync("functions/package.json", "utf8");
const rootPackageSource = fs.readFileSync("package.json", "utf8");
assert.match(functionsIndexSource, /exports\.eliminarOrdenCompra = onCall\([\s\S]{0,260}eliminarOrdenCompraHandler\(request, purchaseOrderPersistenceDependencies\)/);
assert.match(functionsPackageSource, /purchaseOrderDeletion\.js/);
assert.match(rootPackageSource, /"test:purchase-order-delete"/);
assert.match(deletionSource, /roles: BUSINESS_MANAGEMENT_ROLES, requiresVerifiedBusiness: true/);
assert.match(deletionSource, /DELETE_CONFIRMATION_WORD = "permanente"/);
assert.match(deletionSource, /db\.runTransaction/);
for (const collectionName of [
  "recepciones", "compras", "adquisicionesInventario", "movimientosInventario",
  "receptionCreateRequests", "purchaseOrderConversionRequests",
  "purchaseOrderDuplicateRequests", "purchaseOrderCreateRequests", "purchaseOrderEmailAttempts",
]) assert.match(deletionSource, new RegExp(`"${collectionName}"`), `la eliminación debe considerar ${collectionName}`);
for (const field of [
  "emitidaEn", "emitidaPorUid", "canalEmision", "destinatarioEmision", "cantidadEnvios",
  "ultimoEnvioEn", "reenviadaEn", "respuestaProveedor", "enviadoPorCorreo", "estadoEnvioCorreo",
  "compraId", "comprasDesdeRecepciones", "estadoRecepcion", "recepcionResumen",
  "ordenCompraOrigenId",
]) assert.match(deletionSource, new RegExp(`\\b${field}\\b`), `la eliminación debe revisar ${field}`);
assert.match(deletionSource, /"enviando"/);
assert.match(deletionSource, /"enviado"/);
// El contador de numeración no se toca: el número eliminado no se reutiliza.
assert.doesNotMatch(deletionSource, /collection\("purchaseOrderCounters"\)/);
assert.match(rulesSource, /match \/purchaseOrderEmailAttempts\/\{attemptId\}\s*\{\s*allow read, create, update, delete: if false;/);
assert.match(rulesSource, /match \/ordenesCompra\/\{ordenCompraId\}\s*\{[^}]*allow create, update, delete: if false;/);
const {findEmissionTrace, hasOrderLinks, isDeleteConfirmed} = require("../functions/purchaseOrderDeletion.js");
assert.equal(isDeleteConfirmed("  Permanente "), true);
assert.equal(isDeleteConfirmed("borrar"), false);
assert.equal(findEmissionTrace({estado: "borrador"}), false);
assert.equal(findEmissionTrace({estado: "cancelada"}), false);
assert.equal(findEmissionTrace({estado: "borrador", estadoEnvioCorreo: "simulado", fechaEnvioCorreo: "x", enviadoPorCorreo: false}), false, "un envío simulado no bloquea");
assert.equal(findEmissionTrace({estado: "borrador", estadoEnvioCorreo: "error", fechaEnvioCorreo: "x"}), false, "un envío fallido no bloquea");
assert.equal(findEmissionTrace({estado: "emitida"}), true);
assert.equal(findEmissionTrace({estado: "cancelada", emitidaEn: "x"}), true, "una cancelada que se emitió no se elimina");
assert.equal(findEmissionTrace({estado: "borrador", cantidadEnvios: 1}), true);
assert.equal(findEmissionTrace({estado: "borrador", respuestaProveedor: {estado: "rechazada"}}), true);
assert.equal(findEmissionTrace({estado: "borrador", respuestaProveedor: {estado: "pendiente"}}), false);
assert.equal(findEmissionTrace({estado: "borrador", enviadoPorCorreo: true}), true);
assert.equal(hasOrderLinks({estado: "borrador"}), false);
assert.equal(hasOrderLinks({compraId: "c1"}), true);
assert.equal(hasOrderLinks({comprasDesdeRecepciones: []}), false);
assert.equal(hasOrderLinks({comprasDesdeRecepciones: [{compraId: "c1"}]}), true);
console.log("OK eliminación de OC: Function solo OWNER/ADMIN, bloqueos, contador intacto y reglas sin cambios");

// Frontend de la eliminación (SPEC 005, enmienda 2026-11-06): solo orienta la interfaz.
const orderServiceSource = fs.readFileSync("src/services/purchaseOrderService.js", "utf8");
assert.match(orderServiceSource, /export async function eliminarOrdenCompra\(businessId, ordenCompraId, confirmacion\)/);
assert.match(orderServiceSource, /httpsCallable\(functions, "eliminarOrdenCompra"\)/);
assert.match(orderServiceSource, /assertCloudFunctionAllowed\("eliminar órdenes de compra"\)/);
assert.match(orderServiceSource, /ordenCompraId: requireOrderId\(ordenCompraId\),\s*confirmacion,/);
assert.doesNotMatch(
  orderServiceSource.slice(orderServiceSource.indexOf("export async function eliminarOrdenCompra")).split("export function actualizarOrdenCompraBorrador")[0],
  /callPurchaseOrder|errorMessage/,
  "los mensajes del backend se muestran tal cual"
);
assert.equal(DELETE_CONFIRMATION_WORD, "permanente");
for (const value of ["permanente", "  PERMANENTE ", "Permanente"]) {
  assert.equal(isFrontendDeleteConfirmed(value), true, value);
  assert.equal(isFrontendDeleteConfirmed(value), isDeleteConfirmed(value), "igual que el backend");
}
for (const value of ["", "borrar", "permanent", null, undefined, "permanente!"]) {
  assert.equal(isFrontendDeleteConfirmed(value), false, String(value));
  assert.equal(isFrontendDeleteConfirmed(value), isDeleteConfirmed(value), "igual que el backend");
}
// Roles: solo OWNER y ADMIN eliminan (COMPRAS crea y cancela, pero no elimina).
for (const role of ["OWNER", "ADMIN", "owner", " admin".trim()]) assert.equal(canDeletePurchaseOrder(role), true, role);
for (const role of ["COMPRAS", "MEMBER", "VENTAS", "TECNICO", "FINANZAS", "", null, undefined]) {
  assert.equal(canDeletePurchaseOrder(role), false, String(role));
}
const cleanDraft = {estado: "borrador"};
const cleanCancelled = {estado: "cancelada", canceladaEn: "t", canceladaPorUid: "u"};
const offerCases = [
  ["borrador", cleanDraft, true],
  ["cancelada sin rastro de emisión", cleanCancelled, true],
  ["envío simulado", {estado: "borrador", estadoEnvioCorreo: "simulado", fechaEnvioCorreo: "t", enviadoPorCorreo: false}, true],
  ["envío fallido", {estado: "borrador", estadoEnvioCorreo: "error", fechaEnvioCorreo: "t", ultimoErrorEnvio: "x"}, true],
  ["cancelada con envío fallido", {estado: "cancelada", estadoEnvioCorreo: "error"}, true],
  ["respuesta del proveedor pendiente", {estado: "borrador", respuestaProveedor: {estado: "pendiente"}}, true],
  ["emitida", {estado: "emitida", emitidaEn: "t"}, false],
  ["cancelada tras emitirse (emitidaEn)", {...cleanCancelled, emitidaEn: "t"}, false],
  ["cancelada tras emitirse (canal)", {...cleanCancelled, canalEmision: "manual"}, false],
  ["cancelada con envíos", {...cleanCancelled, cantidadEnvios: 2}, false],
  ["borrador con emitidaPorUid", {estado: "borrador", emitidaPorUid: "u"}, false],
  ["borrador con destinatario de emisión", {estado: "borrador", destinatarioEmision: "a@b.test"}, false],
  ["borrador con ultimoEnvioEn", {estado: "borrador", ultimoEnvioEn: "t"}, false],
  ["borrador con reenviadaEn", {estado: "borrador", reenviadaEn: "t"}, false],
  ["respuesta del proveedor registrada", {estado: "borrador", respuestaProveedor: {estado: "confirmada"}}, false],
  ["respuesta del proveedor con fecha", {estado: "borrador", respuestaProveedor: {estado: "pendiente", fecha: "t"}}, false],
  ["correo enviado", {estado: "borrador", enviadoPorCorreo: true, estadoEnvioCorreo: "enviado"}, false],
  ["correo en curso", {estado: "borrador", estadoEnvioCorreo: "enviando"}, false],
  ["con compraId", {estado: "borrador", compraId: "c1"}, false],
  ["con compras desde recepciones", {estado: "borrador", comprasDesdeRecepciones: [{compraId: "c1"}]}, false],
  ["con estado de recepción", {estado: "borrador", estadoRecepcion: "recibida_parcial"}, false],
  ["con resumen de recepción", {estado: "borrador", recepcionResumen: {estado: "recibida_parcial"}}, false],
  ["sin orden", null, false],
];
for (const [label, order, expected] of offerCases) {
  assert.equal(canOfferPurchaseOrderDeletion(order, "OWNER"), expected, `OWNER: ${label}`);
  assert.equal(canOfferPurchaseOrderDeletion(order, "ADMIN"), expected, `ADMIN: ${label}`);
  assert.equal(canOfferPurchaseOrderDeletion(order, "COMPRAS"), false, `COMPRAS nunca: ${label}`);
  assert.equal(canOfferPurchaseOrderDeletion(order, "MEMBER"), false, `MEMBER nunca: ${label}`);
}
// El rastro de emisión del cliente coincide con el del backend en todos los casos.
for (const [label, order] of offerCases) {
  if (!order) continue;
  assert.equal(hasPurchaseOrderEmissionTrace(order), findEmissionTrace(order), `rastro igual que el backend: ${label}`);
}
// Una orden adaptada conserva los campos de emisión que decide el botón.
assert.equal(
  canOfferPurchaseOrderDeletion(adaptStoredPurchaseOrder({id: "oc-1", estado: "cancelada", emitidaEn: "t", items: []}), "OWNER"),
  false
);
assert.equal(canOfferPurchaseOrderDeletion(adaptStoredPurchaseOrder({id: "oc-2", estado: "borrador", items: []}), "OWNER"), true);
console.log("OK eliminación de OC (frontend): servicio, roles y casos de la orden alineados con la Function");

// Interfaz de la eliminación (etapa 4): borrador, menú "Más" de la cancelada y diálogo de confirmación.
const deleteCssSource = fs.readFileSync("src/features/purchaseOrders/purchase-order-delete.css", "utf8");
const deleteViewSource = fs.readFileSync("src/features/purchaseOrders/PurchaseOrderDetailView.jsx", "utf8");
// 1. Borrador: "Eliminar" junto a "Cancelar", solo con canOfferPurchaseOrderDeletion y con la diferencia explicada.
assert.match(pageSource, /canDeleteOrder = canOfferPurchaseOrderDeletion\(order, role\) && receptions\.length === 0/);
assert.match(pageSource, />Cancelar<\/button>\}\s*\{canDeleteOrder && order\.estado === "borrador" && <button[^>]*onClick=\{openDelete\}>Eliminar<\/button>\}/);
assert.match(pageSource, /Cancelar conserva la orden en el historial; eliminar la quita para siempre\./);
// 2. Cancelada: "Eliminar" en el menú "Más", con la misma condición y sin aparecer en emitidas.
assert.match(pageSource, /canDelete=\{canDeleteOrder\}[\s\S]*?onDelete=\{openDelete\}/);
assert.match(deleteViewSource, /canDelete && \{label: "Eliminar", onSelect: onDelete, disabled: saving\}/);
assert.doesNotMatch(deleteViewSource, /issued && \{label: "Eliminar"/);
// 3. Diálogo: palabra «permanente», botón rojo deshabilitado hasta que coincida, carga, sin doble envío y avisos.
assert.match(pageSource, /import "\.\.\/features\/purchaseOrders\/purchase-order-delete\.css"/);
// Etapa 5: el diálogo se extrajo a PurchaseOrderDeleteDialog (compartido con la lista); estas aserciones
// de la etapa 4 apuntan ahora al componente. Cambian solo los nombres internos (confirmation/error/guard).
const deleteDialogSource = fs.readFileSync("src/features/purchaseOrders/PurchaseOrderDeleteDialog.jsx", "utf8");
assert.match(deleteDialogSource, /eliminarOrdenCompra\(businessId, order\.id, confirmation\)/);
assert.match(deleteDialogSource, /guard\.current \|\| deleting \|\| !isDeleteConfirmed\(confirmation\)/);
assert.match(deleteDialogSource, /variant="danger" loading=\{deleting\} disabled=\{!isDeleteConfirmed\(confirmation\)\} onClick=\{confirm\}/);
assert.match(deleteDialogSource, /Para confirmar, escribe <strong>\{DELETE_CONFIRMATION_WORD\}<\/strong>/);
// Pulido del diálogo: tres piezas cortas (frase con el número, línea del hueco, campo «permanente»).
assert.match(deleteDialogSource, /Se eliminará la orden \{order\?\.numero\} con sus ítems e historial\. No se puede deshacer\./);
assert.match(deleteDialogSource, /El número no se reutiliza: quedará un hueco en la numeración\./);
assert.doesNotMatch(deleteDialogSource, /Se perderán|purchase-order-delete__list|purchase-order-delete__note|Solo se eliminan órdenes|cancélala/);
assert.match(deleteDialogSource, /onClose=\{close\}/);
assert.match(deleteDialogSource, /if \(deleting\) return;/);
// 4. Éxito: aviso y vuelta al listado; rechazo: mensaje del backend tal cual, con la orden intacta.
assert.match(deleteDialogSource, /title: `Orden \$\{order\.numero\} eliminada`/);
assert.match(pageSource, /onDeleted=\{\(\) => navigate\("\/ordenes-compra", \{replace: true\}\)\}/);
assert.match(deleteDialogSource, /setError\(getPurchaseOrderDeleteErrorMessage\(failure\)\)/);
assert.match(deleteDialogSource, /error && <div className="po-message po-message--error" role="alert">\{error\}<\/div>/);
// Las acciones existentes no cambian de lógica.
assert.match(pageSource, /cancelarOrdenCompra\(businessId, order\.id\)/);
assert.match(pageSource, /emitirOrdenCompra\(businessId, order\.id, \{canalEmision: "manual"\}\)|emitirOrdenCompra\(businessId, saved\.id, \{canalEmision: "manual"\}\)/);
// 5. Estilos propios, solo con tokens.
assert.doesNotMatch(deleteCssSource, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
assert.match(deleteCssSource, /\.purchase-order-delete__note[\s\S]*?var\(--color-surface-subtle\)/);
console.log("OK eliminación de OC (interfaz): botón del borrador, menú Más de la cancelada y diálogo con «permanente»");

// ---- Etapa 5: papelera en la lista y diálogo compartido ----
// 1. Papelera en tabla y tarjeta móvil, solo si canOfferPurchaseOrderDeletion y sin recepciones en la lista.
assert.equal(
  historySource.split("canDelete={canOfferPurchaseOrderDeletion(order, role) && relatedReceptions.length === 0}").length - 1,
  2,
  "la papelera debe decidirse igual en la tabla y en la tarjeta móvil",
);
assert.match(historySource, /function OrderRowActions\(\{canDelete, onDelete, \.\.\.actionProps\}\)/);
assert.match(historySource, /if \(!canDelete\) return <OrderActions \{\.\.\.actionProps\} \/>/);
assert.match(historySource, /aria-label=\{`Eliminar orden \$\{actionProps\.order\.numero\}`\} title="Eliminar"/);
assert.match(historySource, /<AppIcon icon=\{Trash2\} size=\{17\} \/>/);
assert.match(historySource, /className="client-row-actions purchase-order-delete__row-icon"/);
assert.doesNotMatch(historySource, /canManage && canOfferPurchaseOrderDeletion|canDelete=\{canManage/, "la papelera no depende de canManage (COMPRAS no elimina)");
assert.match(deleteCssSource, /@media \(pointer: coarse\)[\s\S]*?\.purchase-order-delete__row-icon button[\s\S]*?height: 44px;[\s\S]*?width: 44px;/);
// 5. Filtro «Activas» (borrador y emitida): la papelera nunca aparece en emitidas ni para OWNER/ADMIN.
assert.match(historySource, /const ACTIVE_ORDER_STATES = \["borrador", "emitida"\]/);
{
  const rowRoles = ["OWNER", "ADMIN", "COMPRAS", "MEMBER", "VENTAS", "TECNICO", "FINANZAS"];
  const showTrash = (order, role, receptions = []) =>
    canOfferPurchaseOrderDeletion(order, role) && receptions.filter((entry) => entry.ordenCompraId === order.id).length === 0;
  for (const role of rowRoles) {
    const manager = role === "OWNER" || role === "ADMIN";
    assert.equal(showTrash({id: "a", estado: "borrador"}, role), manager, `borrador ${role}`);
    assert.equal(showTrash({id: "b", estado: "cancelada"}, role), manager, `cancelada limpia ${role}`);
    assert.equal(showTrash({id: "c", estado: "emitida"}, role), false, `emitida ${role}`);
    assert.equal(showTrash({id: "d", estado: "emitida", emitidaEn: "2026-01-01"}, role), false, `emitida con rastro ${role}`);
    assert.equal(showTrash({id: "e", estado: "cancelada", emitidaEn: "2026-01-01"}, role), false, `cancelada tras emitirse ${role}`);
    // Con una recepción (aunque sea borrador) la fila no ofrece eliminar.
    assert.equal(showTrash({id: "f", estado: "borrador"}, role, [{ordenCompraId: "f", estado: "borrador"}]), false, `con recepción ${role}`);
  }
}
// 2. Un solo diálogo: la página de detalle y la lista usan el componente compartido y ninguna duplica su contenido.
assert.match(pageSource, /import PurchaseOrderDeleteDialog from "\.\.\/features\/purchaseOrders\/PurchaseOrderDeleteDialog"/);
assert.match(historySource, /import PurchaseOrderDeleteDialog from "\.\.\/features\/purchaseOrders\/PurchaseOrderDeleteDialog"/);
assert.equal(pageSource.split("<PurchaseOrderDeleteDialog").length - 1, 1);
assert.equal(historySource.split("<PurchaseOrderDeleteDialog").length - 1, 1);
for (const [name, source] of [["detalle", pageSource], ["lista", historySource]]) {
  assert.doesNotMatch(source, /Para confirmar, escribe|Se eliminará la orden|eliminarOrdenCompra\(|isDeleteConfirmed/, `${name} no debe duplicar el diálogo`);
}
assert.match(deleteDialogSource, /import "\.\/purchase-order-delete\.css"/);
assert.match(deleteDialogSource, /const guard = useRef\(false\)/);
// 3. Éxito: la fila desaparece sin recargar; el aviso lo muestra el diálogo. Rechazo: el diálogo sigue abierto.
assert.match(historySource, /onDeleted=\{handleDeleted\}/);
{
  const handler = historySource.match(/const handleDeleted = \(deleted\) => \{[\s\S]*?\n {2}\};/)?.[0] || "";
  assert.match(handler, /setOrders\(\(current\) => current\.filter\(\(order\) => order\.id !== deleted\.id\)\)/);
  assert.match(handler, /setDeleteOrder\(null\)/);
  assert.doesNotMatch(handler, /load\(|listarOrdenesCompra/, "eliminar no debe recargar la lista");
}
assert.ok(
  deleteDialogSource.indexOf("sileo.success") < deleteDialogSource.indexOf("onDeleted(order)"),
  "el aviso de éxito se muestra antes de entregar el control a quien usa el diálogo",
);
assert.match(deleteDialogSource, /catch \(failure\) \{[\s\S]*?setError\([\s\S]*?setDeleting\(false\);/);
// 4. Mensaje legible: errores técnicos o de red -> mensaje genérico; mensajes reales del backend, tal cual.
assert.equal(DELETE_FALLBACK_MESSAGE, "No pudimos eliminar la orden de compra. Inténtalo de nuevo.");
for (const technical of [
  {code: "functions/internal", message: "internal"},
  {code: "functions/internal", message: "INTERNAL"},
  {code: "functions/unavailable", message: "unavailable"},
  {code: "functions/not-found", message: "NOT_FOUND"},
  {code: "functions/unknown", message: "unknown"},
  {message: "Failed to fetch"},
  {message: "Load failed"},
  {message: "NetworkError when attempting to fetch resource."},
  {message: "Network request failed"},
  {message: ""},
  {message: "   "},
  {},
  new Error("internal"),
  null,
  undefined,
]) {
  assert.equal(getPurchaseOrderDeleteErrorMessage(technical), DELETE_FALLBACK_MESSAGE, JSON.stringify(technical));
}
for (const real of [
  "No se encontró la orden de compra.",
  "No puedes eliminar esta orden de compra.",
  "No se puede eliminar: la orden ya fue enviada al proveedor.",
  "La orden tiene recepciones asociadas y no se puede eliminar.",
  "Escribe «permanente» para confirmar la eliminación.",
]) {
  assert.equal(getPurchaseOrderDeleteErrorMessage({code: "functions/failed-precondition", message: real}), real);
}
assert.doesNotMatch(deleteDialogSource, /setError\(failure\.message/);
assert.match(deleteDialogSource, /getPurchaseOrderDeleteErrorMessage/);
console.log("OK eliminación de OC (lista): papelera en filas, diálogo compartido, fila sin recarga y mensaje legible");
assert.match(pageSource, /PurchaseOrderPrintView/);
assert.doesNotMatch(pageSource, /Quote[A-Z]/);
assert.match(pageSource, /navigate\("\/ordenes-compra", \{[\s\S]*createdOrder: saved[\s\S]*openOrderId: saved\.id/);
assert.match(providerSelectorSource, /isHistorical \? originalSnapshot : selected/);
assert.match(historySource, /po-history__cards/);
assert.match(historySource, /<OrderActions/);
assert.doesNotMatch(historySource, /Duplicar como pendiente|Más acciones/);
assert.match(pageSource, /Duplicar como nueva orden/);
assert.match(historySource, /Actualizar confirmación/);
assert.match(historySource, /Continuar recepción/);
assert.match(historySource, /Recepción completada/);
assert.match(
  historySource,
  /receptionStatus === "recibida_total"[\s\S]*?Recepción completada[\s\S]*?getSupplierResponseState\(order\) === "rechazada"/
);
assert.match(
  historySource,
  /order\.estado !== "cancelada" && receptionStatus !== "recibida_total"[\s\S]*?>Cancelar<\//
);
assert.match(
  pageSource,
  /supplierResponseState === "rechazada" && !receptionCompleted[\s\S]*?>Actualizar confirmación<\//
);
assert.match(
  pageSource,
  /supplierResponseState !== "rechazada" && !receptionCompleted[\s\S]*?>Registrar confirmación<\//
);
assert.match(
  pageSource,
  /order\.estado !== "cancelada" && !receptionCompleted[\s\S]*?>Cancelar<\//
);
console.log("OK OC recibida total: recepción dominante sin confirmación ni cancelación operativa");
assert.doesNotMatch(historySource, />Ver<|"Ver"/);
assert.match(pageSource, /getProviderPurchaseOrderPaymentTerms/);
assert.match(pageSource, /SupplyTrace/);
// OC emitida o cancelada: detalle de solo lectura en PurchaseOrderDetailView; el borrador conserva el formulario.
const detailViewSource = fs.readFileSync("src/features/purchaseOrders/PurchaseOrderDetailView.jsx", "utf8");
assert.match(pageSource, /showDetailView \? <PurchaseOrderDetailView/);
assert.match(detailViewSource, />Reenviar correo</);
assert.match(detailViewSource, />Descargar PDF</);
assert.match(detailViewSource, /label="Más"/);
assert.match(detailViewSource, /Duplicar como nueva orden/);
assert.match(detailViewSource, /canCancel = canManage && !cancelled && !receptionCompleted/);
assert.match(detailViewSource, /cancelled \? "—" : getOrderReceptionStatusLabel/);
assert.doesNotMatch(detailViewSource, /Snapshot hist[oó]rico|"Nombre no informado"|Sin contacto|"Sin correo"|Sin teléfono|Sin dirección|<input|<textarea|<select/);
assert.match(historySource, /po-history__danger/);
assert.match(historySource, /PurchaseOrderPreviewBoundary/);
assert.match(historySource, /className="po-order-preview-dialog"/);
assert.match(historySource, /PurchaseOrderPrintView company=\{company\} order=\{selectedOrder\}/);
assert.match(historySource, /Correo<\/Button>[\s\S]*WhatsApp<\/Button>[\s\S]*Descargar PDF<\/Button>[\s\S]*Imprimir<\/Button>/);
assert.match(historySource, /onClick=\{\(\) => setSelectedOrder\(null\)\}>Volver al listado/);
assert.match(historySource, /createdOrder\?\.negocioId === businessId/);
assert.match(printViewSource, /Orden de compra/);
assert.match(printViewSource, /proveedorSnapshot/);
assert.match(printViewSource, /items\.map/);
assert.match(printViewSource, /order\.neto/);
assert.match(printViewSource, /order\.iva/);
assert.match(printViewSource, /order\.total/);
assert.match(printViewSource, /showCode/);
assert.match(printViewSource, /showUnit/);
assert.match(printViewSource, /showDiscount/);
assert.match(printViewSource, /Condiciones de pago/);
assert.doesNotMatch(printViewSource, /19%/);
assert.doesNotMatch(printViewSource, /getDoc|getDocs|onSnapshot|listarProveedores/);
assert.match(documentSource, /ORDEN DE COMPRA/);
assert.match(documentSource, /showCode/);
assert.match(documentSource, /showUnit/);
assert.match(documentSource, /showDiscount/);
assert.match(documentSource, /taxLabel\(order\)/);
assert.doesNotMatch(documentSource, /19%/);
assert.match(pdfSource, /buildPurchaseOrderPdfBase64/);
assert.match(pdfSource, /sharePurchaseOrderWhatsApp/);
assert.match(pdfSource, /https:\/\/wa\.me\/\$\{availability\.phone\}/);
assert.match(purchaseOrderCssSource, /@media\(max-width:767px\)/);
assert.match(purchaseOrderCssSource, /size:\s*A4/);
assert.match(purchaseOrderCssSource, /po-order-preview-dialog/);
assert.match(purchaseOrderCssSource, /po-history__recent/);
assert.match(purchaseOrderCssSource, /po-header__action-stack/);
assert.match(purchaseOrderCssSource, /po-history__danger/);
assert.doesNotMatch(purchaseOrderCssSource, /po-history__table\{min-width:800px\}/);
console.log("OK documento: snapshots, columnas condicionales, impuesto dinámico y acciones externas");

const outputDir = path.resolve("output/pdf/purchase-order-validation");
fs.mkdirSync(outputDir, {recursive: true});
const logoPath = path.resolve("tmp/pdfs/reference/bagner-logo.png");
const logoDataUrl = fs.existsSync(logoPath)
  ? `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`
  : "";

const scenarios = [
  ["01-short", orderFixture()],
  [
    "02-mixed-items-discount",
    orderFixture({
      items: [
        documentItem(1, {cantidad: 4, costoUnitario: 125000, descuentoPct: 8}),
        documentItem(2, {
          codigo: "SRV-0002",
          nombre: "Instalación y puesta en marcha",
          tipoItem: "servicio",
          unidad: "servicio",
          cantidad: 1,
          costoUnitario: 180000,
        }),
        ...Array.from({length: 7}, (_, index) =>
          documentItem(index + 3, {costoUnitario: 35000 + index * 7500})
        ),
      ],
    }),
  ],
  [
    "03-multipage",
    orderFixture({
      items: Array.from({length: 60}, (_, index) =>
        documentItem(index + 1, {
          descripcion: `Componente ${index + 1} con embalaje, control de calidad y entrega documentada.`,
          costoUnitario: 10000 + index * 500,
        })
      ),
    }),
  ],
  [
    "04-empty-optionals",
    orderFixture({
      fechaEntregaEstimada: "",
      direccionEntrega: "",
      condicionesPago: "",
      observaciones: "",
      proveedorSnapshot: {...providerSnapshot, condicionesPago: "", diasCredito: 0},
    }),
  ],
  [
    "05-multicurrency-tax-snapshot",
    orderFixture({
      moneda: "USD",
      locale: "es-PE",
      impuestoNombre: "IGV",
      tasaIva: 0.18,
      items: [documentItem(1, {cantidad: 3, costoUnitario: 1250, descuentoPct: 5})],
    }),
  ],
];

for (const [name, order] of scenarios) {
  const result = buildPurchaseOrderPdfDocument({order, logoDataUrl});
  const file = path.join(outputDir, `${name}.pdf`);
  fs.writeFileSync(file, Buffer.from(result.doc.output("arraybuffer")));
  assert.equal(result.order.proveedorSnapshot.razonSocial, providerSnapshot.razonSocial);
  assert.equal(result.order.empresaSnapshot.razonSocial, companySnapshot.razonSocial);
  if (name === "03-multipage") assert.ok(result.doc.getNumberOfPages() >= 2);
  console.log(`PDF_VALIDATION ${name} pages=${result.doc.getNumberOfPages()} file=${file}`);
}

console.log("PURCHASE_ORDERS_MODEL_SMOKE_OK");
