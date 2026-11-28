"use strict";

const {createHash} = require("node:crypto");
const {normalizeBusinessVerificationState} = require("./businessOperations");
const {
  PRICING_READ_ROLES,
  TALLER_CREATION_ROLES,
  TALLER_MANAGEMENT_ROLES,
  TALLER_OPERATION_ROLES,
  hasTallerCapability,
  requireTallerAccess,
  assertFreshTallerAccess,
} = require("./tallerAccess");
const {ASSIGNABLE_BUSINESS_ROLES} = require("./rbac");
const {adaptDocumentAmountDecimals, currencyAmountDecimals} = require("./localization");
const {isMoneyAmount, roundMoney} = require("./money");
const {
  automaticAssignmentDetail,
  readFreePlaza,
  readPromotionCandidate,
  writePromotion,
} = require("./workOrderPlazaAssignment");
const {missingReceptionPhotoZones, receptionPhotoDamages} = require("./workOrderReceptionPhotoZones");
const {missingDeliveryZones, normalizeDeliveryInput, normalizePersonDocument} = require("./workOrderDeliveryRules");
const {PLATE_INDEX_COLLECTION, normalizePlate, plateIndexId} = require("./workOrderTrackingRules");
const {buildWorkOrderDraftSale, readWorkOrderSaleContext} = require("./workOrderSale");

function canReadCorePricing(membership) {
  if (!PRICING_READ_ROLES.includes(membership?.rol)) return false;
  if (!membership.profileId) return true;
  return Boolean(membership.rol === "MEMBER" && membership.modules?.includes("cotizaciones"));
}

const WORK_ORDER_INPUT_FIELDS = new Set(["vehiculoId"]);
const RECEPTION_INPUT_FIELDS = new Set([
  "motivoCliente",
  "kilometraje",
  "nivelCombustible",
  "testigosEncendidos",
  "testigos",
  "ingresaNombre",
  "ingresaDocumento",
]);
// Quién deja el vehículo en el taller (puede no ser el titular): nombre y RUT. El RUT se guarda aparte, solo para el servidor.
// Sensores del tablero (prototipo «Panel del Taller»); coinciden con RECEPTION_WARNING_LIGHTS de la UI.
const RECEPTION_WARNING_LIGHTS = Object.freeze([
  "check-engine", "abs", "airbag", "bateria", "aceite", "temperatura", "frenos",
]);
const MAX_RECEPTION_REASON_LENGTH = 1000;
// Campos de la recepción anterior (checklist, daños, accesorios, observaciones): ya no se piden, pero se
// conservan en las OT que los tenían registrados.
const LEGACY_RECEPTION_FIELDS = Object.freeze(["checklist", "danosObservados", "accesorios", "observaciones"]);
const RECEPTION_FUEL_LEVELS = new Set(["Reserva", "1/4", "1/2", "3/4", "Lleno"]);
const MAX_RECEPTION_MILEAGE_KM = 2_000_000;
const DIAGNOSIS_INPUT_FIELDS = new Set(["responsableUid", "descripcion", "observaciones"]);
const SERVICE_INPUT_FIELDS = new Set(["itemId"]);
const REPLACEMENT_PARTS_MODES = new Set(["cliente", "ninguno"]);
const CANCELLABLE_ORDER_STATES = new Set([
  "ingresada",
  "en_cola",
  "en_diagnostico",
  "esperando_aprobacion",
  "esperando_repuestos",
]);

function canApproveWorkOrder(membership) {
  return hasTallerCapability(membership, "approve");
}

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function text(value, label, maxLength, HttpsError, {required = false} = {}) {
  if (value == null) value = "";
  if (typeof value !== "string") {
    fail(HttpsError, "invalid-argument", `${label} debe ser texto.`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (required && !normalized) {
    fail(HttpsError, "invalid-argument", `${label} es obligatorio.`);
  }
  if (normalized.length > maxLength) {
    fail(
      HttpsError,
      "invalid-argument",
      `${label} no puede superar ${maxLength} caracteres.`
    );
  }
  return normalized;
}

function identifier(value, label, HttpsError) {
  const normalized = text(value, label, 160, HttpsError, {required: true});
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    fail(HttpsError, "invalid-argument", `${label} no es válido.`);
  }
  return normalized;
}

function requestIdentifier(value, HttpsError) {
  const normalized = text(
    value,
    "La solicitud de creación",
    120,
    HttpsError,
    {required: true}
  );
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(normalized)) {
    fail(
      HttpsError,
      "invalid-argument",
      "La solicitud de creación no es válida."
    );
  }
  return normalized;
}

function normalizeWorkOrderInput(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(
      HttpsError,
      "invalid-argument",
      "Los datos de la orden de trabajo deben enviarse como un objeto."
    );
  }
  const unknownField = Object.keys(raw).find(
    (field) => !WORK_ORDER_INPUT_FIELDS.has(field)
  );
  if (unknownField) {
    fail(
      HttpsError,
      "invalid-argument",
      `El campo de orden de trabajo ${unknownField} no está admitido.`
    );
  }
  return {
    vehiculoId: identifier(raw.vehiculoId, "El vehículo", HttpsError),
  };
}

function nonNegativeInteger(value, label, HttpsError) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(HttpsError, "invalid-argument", `${label} debe ser un número entero válido.`);
  }
  return value;
}

function receptionMileage(value, HttpsError) {
  const mileage = nonNegativeInteger(value, "El kilometraje", HttpsError);
  if (mileage > MAX_RECEPTION_MILEAGE_KM) {
    fail(
      HttpsError,
      "invalid-argument",
      `El kilometraje no puede superar ${MAX_RECEPTION_MILEAGE_KM} km.`
    );
  }
  return mileage;
}

// Sensores del tablero: «no hay sensores encendidos» (lista vacía) o al menos uno de los conocidos.
function normalizeWarningLights(encendidos, lista, HttpsError) {
  if (typeof encendidos !== "boolean") {
    fail(HttpsError, "invalid-argument", "Indica si hay sensores encendidos en el tablero.");
  }
  if (!Array.isArray(lista) || lista.length > RECEPTION_WARNING_LIGHTS.length ||
      lista.some((light) => !RECEPTION_WARNING_LIGHTS.includes(light)) || new Set(lista).size !== lista.length) {
    fail(HttpsError, "invalid-argument", "Los sensores encendidos no son válidos.");
  }
  if (encendidos && !lista.length) fail(HttpsError, "invalid-argument", "Elige cuáles sensores están encendidos.");
  if (!encendidos && lista.length) fail(HttpsError, "invalid-argument", "Sin sensores encendidos, la lista debe estar vacía.");
  return RECEPTION_WARNING_LIGHTS.filter((light) => lista.includes(light));
}

// `options.countryCode` valida el documento; `options.hasStoredDocument` permite dejarlo en blanco al actualizar.
function normalizeReceptionInput(raw, HttpsError, options = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(HttpsError, "invalid-argument", "Los datos de recepción deben enviarse como un objeto.");
  }
  const unknownField = Object.keys(raw).find((field) => !RECEPTION_INPUT_FIELDS.has(field));
  if (unknownField) {
    fail(HttpsError, "invalid-argument", `El campo de recepción ${unknownField} no está admitido.`);
  }
  const motivoCliente = text(raw.motivoCliente, "El motivo del cliente", MAX_RECEPTION_REASON_LENGTH, HttpsError, {required: true});
  const nivelCombustible = text(raw.nivelCombustible, "El nivel de combustible", 80, HttpsError, {required: true});
  if (!RECEPTION_FUEL_LEVELS.has(nivelCombustible)) {
    fail(HttpsError, "invalid-argument", "Selecciona un nivel de combustible válido.");
  }
  const ingresaNombre = text(raw.ingresaNombre, "El nombre de quien entrega el vehículo", 120, HttpsError, {required: true});
  const blankDocument = typeof raw.ingresaDocumento !== "string" || !raw.ingresaDocumento.trim();
  if (blankDocument && !options.hasStoredDocument) {
    fail(HttpsError, "invalid-argument", "El documento de identidad de quien entrega el vehículo es obligatorio.");
  }
  return {
    motivoCliente,
    kilometraje: receptionMileage(raw.kilometraje, HttpsError),
    nivelCombustible,
    testigosEncendidos: raw.testigosEncendidos,
    testigos: normalizeWarningLights(raw.testigosEncendidos, raw.testigos, HttpsError),
    ingresaNombre,
    ingresaDocumento: blankDocument ? "" : normalizePersonDocument(raw.ingresaDocumento, options.countryCode || "CL", HttpsError),
  };
}

function formatWorkOrderNumber(sequence) {
  return `OT-${String(sequence).padStart(6, "0")}`;
}

function signature(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertVehicle(snapshot, businessId, vehiculoId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "not-found", "No se encontró el vehículo.");
  }
  const stored = snapshot.data() || {};
  if (
    snapshot.id !== vehiculoId ||
    stored.vehiculoId !== vehiculoId ||
    stored.negocioId !== businessId
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "El vehículo no pertenece al negocio seleccionado."
    );
  }
  return stored;
}

function assertClient(snapshot, businessId, clienteId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "failed-precondition", "El propietario actual ya no existe.");
  }
  const stored = snapshot.data() || {};
  if (
    snapshot.id !== clienteId ||
    stored.clienteId !== clienteId ||
    stored.negocioId !== businessId
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "El propietario actual no pertenece al negocio seleccionado."
    );
  }
}

function assertWorkOrder(snapshot, businessId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "failed-precondition", "La orden creada ya no existe.");
  }
  const stored = snapshot.data() || {};
  if (snapshot.id !== stored.otId || stored.negocioId !== businessId) {
    fail(HttpsError, "failed-precondition", "La orden creada es inconsistente.");
  }
  return stored;
}

function nextSequence(counterSnapshot, HttpsError) {
  if (!counterSnapshot.exists) return 1;
  const counter = counterSnapshot.data() || {};
  if (
    !Number.isSafeInteger(counter.lastNumber) ||
    counter.lastNumber < 0
  ) {
    fail(
      HttpsError,
      "failed-precondition",
      "El correlativo de órdenes de trabajo requiere revisión."
    );
  }
  return counter.lastNumber + 1;
}

function businessCurrency(context) {
  const value = String(
    context.businessSnapshot?.data()?.monedaCodigo || ""
  ).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

// SPEC 036: decimales de cálculo de una OT. Una OT que ya tiene moneda usa los de su documento (`montoDecimales`;
// ausente = 0, así una OT anterior sigue entera); sin moneda, o si la moneda cambió, salen del catálogo de la moneda
// con la que se calcula. Nunca del payload del cliente.
function workOrderAmountDecimals(order, currency) {
  if (!currency) return 0;
  return order?.moneda === currency
    ? adaptDocumentAmountDecimals(order, currency)
    : currencyAmountDecimals(currency);
}

async function requireManagementAccess(request, dependencies) {
  return requireTallerAccess(request, dependencies, "manage");
}

async function requireCreationAccess(request, dependencies) {
  return requireTallerAccess(request, dependencies, "create");
}

async function requireReceptionAccess(request, dependencies) {
  return requireTallerAccess(request, dependencies, "operate");
}

function normalizeDiagnosisInput(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(HttpsError, "invalid-argument", "Los datos del diagnóstico deben enviarse como objeto.");
  }
  const unknown = Object.keys(raw).find((field) => !DIAGNOSIS_INPUT_FIELDS.has(field));
  if (unknown) fail(HttpsError, "invalid-argument", `El campo ${unknown} no está admitido en el diagnóstico.`);
  return {
    responsableUid: identifier(raw.responsableUid, "El responsable", HttpsError),
    descripcion: text(raw.descripcion, "La descripción", 5000, HttpsError),
    observaciones: text(raw.observaciones, "Las observaciones", 2000, HttpsError),
  };
}

function normalizeServiceInput(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(HttpsError, "invalid-argument", "Los datos del servicio deben enviarse como objeto.");
  }
  const unknown = Object.keys(raw).find((field) => !SERVICE_INPUT_FIELDS.has(field));
  if (unknown) fail(HttpsError, "invalid-argument", `El campo ${unknown} no está admitido en el servicio.`);
  return {
    itemId: identifier(raw.itemId, "El servicio de Inventario", HttpsError),
  };
}

function plannedQuantity(value, HttpsError) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 ||
      Math.round(value * 1000) !== value * 1000) {
    fail(HttpsError, "invalid-argument", "La cantidad planificada debe ser un número positivo con hasta tres decimales.");
  }
  return value;
}

// Stock de repuestos: Inventario solo se lee (ni se descuenta ni se reserva).
// El taller valida que el total de un repuesto en la OT no supere el stock actual. No considera otras OT:
// la validación y el descuento definitivos quedan en Ventas, cuando se integre con las OT.
// TODO(validar): definir cómo actúa Ventas si al confirmar la venta ya no hay stock suficiente.

// Las cantidades admiten hasta tres decimales: se suman en milésimas para evitar errores de redondeo.
function quantityUnits(value) {
  return Math.round(Number(value) * 1000);
}

function formatQuantityUnits(units) {
  return (units / 1000).toLocaleString("es-CL", {maximumFractionDigits: 3});
}

function orderProductUnits(services, businessId, otId, itemId) {
  return services.reduce((total, service) => {
    if (service.negocioId !== businessId || service.otId !== otId) return total;
    return (Array.isArray(service.productos) ? service.productos : []).reduce((sum, product) =>
      product?.itemId === itemId && typeof product.cantidad === "number" && Number.isFinite(product.cantidad)
        ? sum + quantityUnits(product.cantidad) : sum, total);
  }, 0);
}

function productStockUnits(item, HttpsError) {
  if (typeof item.stock !== "number" || !Number.isFinite(item.stock) || item.stock < 0) {
    fail(HttpsError, "failed-precondition", "El producto no tiene stock válido en Inventario. Revisa el catálogo.");
  }
  return quantityUnits(item.stock);
}

function assertPlanningOrder(order, HttpsError) {
  // Flujo vigente: la aprobación es solo una compuerta y los trabajos se registran en la ejecución.
  if (!order.recepcion || order.estado !== "en_reparacion" || order.estadoAprobacion !== "aprobada") {
    fail(HttpsError, "failed-precondition", "Los trabajos y repuestos se registran durante la ejecución, una vez aprobado el ingreso.");
  }
}

function invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp) {
  // La aprobación es una compuerta de ingreso: agregar o cambiar trabajos no la invalida.
  transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
}

function assertPlanningItem(snapshot, businessId, itemId, type, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró el ítem de Inventario.");
  const item = snapshot.data() || {};
  if (snapshot.id !== itemId || (item.negocioId && item.negocioId !== businessId) ||
      item.tipoItem !== type || (item.estado || "activo") !== "activo") {
    fail(HttpsError, "failed-precondition", `Selecciona un ${type} activo de Inventario del mismo negocio.`);
  }
}

function assertService(snapshot, businessId, otId, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró el servicio de la OT.");
  const service = snapshot.data() || {};
  if (service.servicioOtId !== snapshot.id || service.negocioId !== businessId || service.otId !== otId) {
    fail(HttpsError, "failed-precondition", "El servicio no pertenece a esta orden.");
  }
  return service;
}

function appendPlanningEvent(transaction, orderRef, {businessId, actorUid, actorSnapshot, type, detail, timestamp}) {
  const eventRef = orderRef.collection("historial").doc();
  transaction.create(eventRef, {
    eventoId: eventRef.id, negocioId: businessId, otId: orderRef.id,
    tipo: type, fecha: timestamp, actorUid, actorSnapshot, detalle: detail,
  });
}

async function listarCatalogoTallerHandler(request, dependencies) {
  const context = await requireTallerAccess(request, dependencies, "read");
  const canReadPrices = canReadCorePricing(context.membership);
  // El catálogo es una vista de precios vigentes, no un documento: usa los decimales de la moneda del negocio.
  const decimals = currencyAmountDecimals(businessCurrency(context));
  const snapshot = await context.businessRef.collection("inventario")
    .where("tipoItem", "in", ["servicio", "producto"]).get();
  const items = snapshot.docs.flatMap((document) => {
    const item = document.data() || {};
    if ((item.negocioId && item.negocioId !== context.businessId) ||
        (item.estado || "activo") !== "activo") return [];
    const price = item.precioInterno == null || item.precioInterno === ""
      ? null : Number(item.precioInterno);
    return [{
      itemId: document.id, tipoItem: item.tipoItem, estado: "activo",
      nombre: String(item.nombre || item.descripcionItem || "Ítem sin nombre").trim(),
      codigoInterno: String(item.codigoInterno || item.sku || "").trim(),
      stock: item.tipoItem === "producto" && Number.isFinite(Number(item.stock))
        ? Number(item.stock) : null,
      // Stock mínimo definido en Inventario: el panel del taller avisa cuando un repuesto llega a él (solo lectura).
      stockMinimo: item.tipoItem === "producto" && item.stockMinimo !== null && item.stockMinimo !== "" &&
        Number.isFinite(Number(item.stockMinimo)) && Number(item.stockMinimo) > 0 ? Number(item.stockMinimo) : null,
      precioEfectivo: canReadPrices && price !== null && Number.isFinite(price) && price >= 0
        ? (decimals === 0 ? Math.round(price) : roundMoney(price, decimals)) : null,
    }];
  });
  return {items};
}

function assertDiagnosisOperationAllowed(order, HttpsError) {
  if (!order.recepcion || order.estado === "ingresada") {
    fail(HttpsError, "failed-precondition", "Registra la recepción antes de diagnosticar.");
  }
  if (["pendiente_entrega", "cerrada", "cancelada"].includes(order.estado)) {
    fail(HttpsError, "failed-precondition", "Esta orden ya no admite diagnósticos.");
  }
}

function assertDiagnosis(snapshot, businessId, otId, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró el diagnóstico.");
  const diagnosis = snapshot.data() || {};
  if (diagnosis.diagnosticoId !== snapshot.id || diagnosis.negocioId !== businessId || diagnosis.otId !== otId) {
    fail(HttpsError, "failed-precondition", "El diagnóstico no pertenece a esta orden.");
  }
  return diagnosis;
}

function assertDiagnosisRevision(record, expected, HttpsError, label = "diagnóstico") {
  if (!Number.isSafeInteger(expected) || record.actualizadoEn?.toMillis?.() !== expected) {
    fail(HttpsError, "aborted", `El ${label} cambió en otra sesión. Actualiza la ficha antes de continuar.`);
  }
}

function assertAssignableMember(snapshot, businessId, uid, HttpsError) {
  const member = snapshot.data() || {};
  if (!snapshot.exists || snapshot.id !== `${businessId}__${uid}` || member.negocioId !== businessId ||
      member.uid !== uid || member.estado !== "activo" || !ASSIGNABLE_BUSINESS_ROLES.includes(member.rol)) {
    fail(HttpsError, "failed-precondition", "Selecciona un responsable asignable y activo del negocio.");
  }
}

// Quién opera los trabajos de una OT: el responsable elegido al aprobar, el Administrador o el Owner.
// Las OT anteriores a esta regla no tienen responsable y las puede operar cualquier operador de Taller.
function canOperateWorks(membership, order, uid) {
  return hasTallerCapability(membership, "manage") || !order.responsableUid || order.responsableUid === uid;
}

function assertWorkOperator(membership, order, uid, HttpsError) {
  if (!canOperateWorks(membership, order, uid)) {
    fail(HttpsError, "permission-denied", "Solo el responsable de la OT, el Administrador o el Owner operan los trabajos.");
  }
}

function worksPartsDefined(service) {
  return (Array.isArray(service.productos) && service.productos.length > 0) ||
    REPLACEMENT_PARTS_MODES.has(service.repuestosModo);
}

function profileIdentityName(profile, user) {
  const name = [profile?.nombres, profile?.apellidos]
    .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  return name || String(user?.email || "Usuario no disponible").trim();
}

async function diagnosisActor(dependencies, uid) {
  const [user, profileSnapshot] = await Promise.all([
    dependencies.auth.getUser(uid),
    dependencies.db.collection("usuarios").doc(uid).collection("cuenta").doc("perfil").get(),
  ]);
  return {
    nombre: profileIdentityName(profileSnapshot.data() || {}, user),
    correo: String(user.email || "").trim(),
  };
}

function appendDiagnosisEvent(transaction, orderRef, {businessId, diagnosisId, type, actorUid, actorSnapshot, timestamp}) {
  const eventRef = orderRef.collection("historial").doc();
  transaction.create(eventRef, {
    eventoId: eventRef.id, negocioId: businessId, otId: orderRef.id,
    tipo: type, fecha: timestamp, actorUid, actorSnapshot,
    detalle: {diagnosticoId: diagnosisId},
  });
}

async function listarPersonasAsignablesTallerHandler(request, dependencies) {
  const context = await requireTallerAccess(request, dependencies, "read");
  const snapshot = await dependencies.db.collection("membresias")
    .where("negocioId", "==", context.businessId).get();
  const members = snapshot.docs.filter((item) => {
    const member = item.data() || {};
    return member.estado === "activo" &&
      (ASSIGNABLE_BUSINESS_ROLES.includes(member.rol) || TALLER_OPERATION_ROLES.includes(member.rol)) &&
      item.id === `${context.businessId}__${member.uid}`;
  }).map((item) => item.data());
  const identities = [];
  for (let index = 0; index < members.length; index += 100) {
    const batch = members.slice(index, index + 100);
    const uids = batch.map((member) => member.uid);
    const [users, profiles] = await Promise.all([
      dependencies.auth.getUsers(uids.map((uid) => ({uid}))),
      dependencies.db.getAll(...uids.map((uid) => dependencies.db.collection("usuarios")
        .doc(uid).collection("cuenta").doc("perfil"))),
    ]);
    const authUsers = new Map(users.users.map((user) => [user.uid, user]));
    batch.forEach((member, offset) => {
      const profile = profiles[offset].data() || {};
      const user = authUsers.get(member.uid);
      if (!user || user.disabled) return;
      identities.push({uid: member.uid, rol: member.rol, nombre: profileIdentityName(profile, user)});
    });
  }
  const byName = (left, right) => left.nombre.localeCompare(right.nombre, "es-CL");
  const publicIdentity = ({uid, nombre}) => ({uid, nombre});
  return {
    personas: identities.filter((person) => ASSIGNABLE_BUSINESS_ROLES.includes(person.rol))
      .sort(byName).map(publicIdentity),
    actores: identities.filter((person) => TALLER_OPERATION_ROLES.includes(person.rol))
      .sort(byName).map(publicIdentity),
  };
}

async function crearOrdenTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireCreationAccess(request, dependencies);
  const input = normalizeWorkOrderInput(
    request?.data?.ordenTrabajo,
    HttpsError
  );
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const inputSignature = signature(input);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc();
  const vehicleRef = context.businessRef
    .collection("vehiculos")
    .doc(input.vehiculoId);
  const counterRef = context.businessRef.collection("otCounters").doc("global");
  const requestRef = context.businessRef
    .collection("otCreateRequests")
    .doc(requestId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);

  const result = await db.runTransaction(async (transaction) => {
    await assertFreshTallerAccess(transaction, context, dependencies, "create");
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists) {
      const storedRequest = requestSnapshot.data() || {};
      if (
        storedRequest.negocioId !== context.businessId ||
        storedRequest.creadoPorUid !== context.uid ||
        storedRequest.inputSignature !== inputSignature
      ) {
        fail(
          HttpsError,
          "already-exists",
          "La solicitud de creación ya fue utilizada con otros datos."
        );
      }
      const existingSnapshot = await transaction.get(
        context.businessRef
          .collection("ordenesTrabajo")
          .doc(storedRequest.otId)
      );
      return {
        stored: assertWorkOrder(
          existingSnapshot,
          context.businessId,
          HttpsError
        ),
        sinCambios: true,
      };
    }

    const [vehicleSnapshot, counterSnapshot] = await transaction.getAll(
      vehicleRef,
      counterRef
    );
    const vehicle = assertVehicle(
      vehicleSnapshot,
      context.businessId,
      input.vehiculoId,
      HttpsError
    );
    const clienteId = identifier(
      vehicle.clienteId,
      "El propietario actual",
      HttpsError
    );
    const clientRef = context.businessRef.collection("clientes").doc(clienteId);
    assertClient(
      await transaction.get(clientRef),
      context.businessId,
      clienteId,
      HttpsError
    );

    const sequence = nextSequence(counterSnapshot, HttpsError);
    const numeroOT = formatWorkOrderNumber(sequence);
    const timestamp = FieldValue.serverTimestamp();
    const montoDecimales = currencyAmountDecimals(businessCurrency(context));
    const stored = {
      otId: orderRef.id,
      negocioId: context.businessId,
      numeroOT,
      vehiculoId: input.vehiculoId,
      clienteId,
      estado: "ingresada",
      estadoAprobacion: "pendiente",
      plazaId: null,
      moneda: businessCurrency(context),
      // Solo con decimales: una OT con 0 decimales queda sin el campo, igual que hoy.
      ...(montoDecimales > 0 ? {montoDecimales} : {}),
      recepcion: null,
      creadoPorUid: context.uid,
      creadoEn: timestamp,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    };

    transaction.create(orderRef, stored);
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId,
      actorUid: context.uid,
      actorSnapshot,
      timestamp,
      type: "ot_creada",
      detail: {
        numeroOT,
        estado: stored.estado,
        estadoAprobacion: stored.estadoAprobacion,
      },
    });
    transaction.set(counterRef, {
      negocioId: context.businessId,
      lastNumber: sequence,
      actualizadoEn: timestamp,
    });
    transaction.create(requestRef, {
      requestId,
      negocioId: context.businessId,
      otId: orderRef.id,
      numeroOT,
      inputSignature,
      creadoPorUid: context.uid,
      creadoEn: timestamp,
    });

    return {stored, sinCambios: false};
  });

  return {
    ordenTrabajo: result.sinCambios ? result.stored : {
      otId: orderRef.id,
      negocioId: context.businessId,
      numeroOT: result.stored.numeroOT,
      vehiculoId: result.stored.vehiculoId,
      clienteId: result.stored.clienteId,
      estado: result.stored.estado,
      estadoAprobacion: result.stored.estadoAprobacion,
      plazaId: result.stored.plazaId,
      moneda: result.stored.moneda,
      ...(result.stored.montoDecimales > 0 ? {montoDecimales: result.stored.montoDecimales} : {}),
      recepcion: result.stored.recepcion,
      creadoPorUid: context.uid,
      actualizadoPorUid: context.uid,
    },
    sinCambios: result.sinCambios,
  };
}

function assertStoredWorkOrder(snapshot, businessId, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "not-found", "No se encontró la orden de trabajo.");
  }
  const stored = snapshot.data() || {};
  if (snapshot.id !== stored.otId || stored.negocioId !== businessId) {
    fail(HttpsError, "failed-precondition", "La orden de trabajo no pertenece al negocio seleccionado.");
  }
  return stored;
}

function receptionNextStatus(order) {
  if (order.estado !== "ingresada") return order.estado;
  return order.plazaId ? "en_diagnostico" : "en_cola";
}

function receptionChanges(previous, current) {
  const changes = {};
  for (const field of ["motivoCliente", "kilometraje", "nivelCombustible", "testigosEncendidos", "testigos",
    "ingresaNombre"]) {
    const before = previous?.[field] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(current[field])) {
      changes[field] = {anterior: before, nuevo: current[field]};
    }
  }
  return changes;
}

// Conserva los campos de la recepción anterior que la OT ya tenía registrados.
function legacyReceptionFields(existingReception) {
  return Object.fromEntries(LEGACY_RECEPTION_FIELDS
    .filter((field) => existingReception?.[field] !== undefined)
    .map((field) => [field, existingReception[field]]));
}

async function registrarRecepcionOrdenTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const personRef = orderRef.collection("recepcionActa").doc("persona");
  const countryCode = context.businessSnapshot?.data()?.paisCodigo || "CL";
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  let result;

  await db.runTransaction(async (transaction) => {
    await assertFreshTallerAccess(transaction, context, dependencies, "operate");
    const stored = assertStoredWorkOrder(
      await transaction.get(orderRef),
      context.businessId,
      HttpsError
    );
    const existingReception = stored.recepcion;
    const personSnapshot = await transaction.get(personRef);
    // Patente del vehículo para el índice de la consulta pública (/seguimiento con patente + RUT).
    const trackingVehicle = stored.vehiculoId
      ? await transaction.get(context.businessRef.collection("vehiculos").doc(stored.vehiculoId)) : null;
    const storedPerson = personSnapshot.exists ? personSnapshot.data() : null;
    const {ingresaDocumento, ...input} = normalizeReceptionInput(request?.data?.recepcion, HttpsError,
      {countryCode, hasStoredDocument: Boolean(storedPerson?.documento)});
    if (existingReception != null && (typeof existingReception !== "object" || Array.isArray(existingReception))) {
      fail(HttpsError, "failed-precondition", "La recepción existente requiere revisión antes de actualizarse.");
    }
    if (!existingReception && stored.estado !== "ingresada") {
      fail(HttpsError, "failed-precondition", "La recepción solo puede registrarse desde una OT ingresada.");
    }
    if (["pendiente_entrega", "cerrada", "cancelada"].includes(stored.estado)) {
      fail(HttpsError, "failed-precondition", "Esta OT ya no permite modificar la recepción.");
    }
    // Las seis zonas exteriores y el tablero se fotografían antes de registrar la recepción.
    const missingPhotos = existingReception ? [] : missingReceptionPhotoZones(stored);
    if (missingPhotos.length) {
      fail(HttpsError, "failed-precondition",
        `Faltan fotos de recepción: ${missingPhotos.join(", ")}. Complétalas antes de registrar la recepción.`);
    }
    const changes = receptionChanges(existingReception, input);
    // El documento no viaja a la OT ni al historial; solo se deja constancia de que cambió.
    if (ingresaDocumento && ingresaDocumento !== storedPerson?.documento) changes.ingresaDocumento = {modificado: true};
    const timestamp = FieldValue.serverTimestamp();
    const reception = {
      ...legacyReceptionFields(existingReception),
      ...input,
      ingresaTieneDocumento: true,
      recibidoPorUid: existingReception?.recibidoPorUid || context.uid,
      recibidoEn: existingReception?.recibidoEn || timestamp,
    };
    const estado = receptionNextStatus(stored);
    if (Object.keys(changes).length) {
      const trackingPlate = normalizePlate(trackingVehicle?.data()?.patente);
      if (trackingPlate) {
        transaction.set(db.collection(PLATE_INDEX_COLLECTION).doc(plateIndexId(trackingPlate)),
          {negocios: FieldValue.arrayUnion(context.businessId), actualizadoEn: timestamp}, {merge: true});
      }
      if (ingresaDocumento) {
        transaction.set(personRef, {
          negocioId: context.businessId, otId, nombre: input.ingresaNombre,
          documento: ingresaDocumento, registradoPorUid: context.uid, actualizadoEn: timestamp,
        }, {merge: true});
      } else if (storedPerson) {
        transaction.set(personRef, {nombre: input.ingresaNombre,
          registradoPorUid: context.uid, actualizadoEn: timestamp}, {merge: true});
      }
      transaction.update(orderRef, {
        recepcion: reception,
        estado,
        actualizadoPorUid: context.uid,
        actualizadoEn: timestamp,
      });
      appendPlanningEvent(transaction, orderRef, {
        businessId: context.businessId, actorUid: context.uid, actorSnapshot, timestamp,
        type: existingReception ? "recepcion_actualizada" : "recepcion_registrada",
        detail: {cambios: changes},
      });
    }
    result = {
      otId,
      negocioId: context.businessId,
      numeroOT: stored.numeroOT,
      vehiculoId: stored.vehiculoId,
      clienteId: stored.clienteId,
      estado,
      estadoAprobacion: stored.estadoAprobacion,
      plazaId: stored.plazaId,
      moneda: stored.moneda,
      recepcion: {
        ...input,
        ingresaTieneDocumento: true,
        recibidoPorUid: existingReception?.recibidoPorUid || context.uid,
        recibidoEn: existingReception?.recibidoEn || null,
      },
      sinCambios: !Object.keys(changes).length,
    };
  });
  return {ordenTrabajo: result};
}

async function registrarDiagnosticoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const input = normalizeDiagnosisInput(request?.data?.diagnostico, HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const diagnosisRef = orderRef.collection("diagnosticos").doc(requestId);
  const memberRef = db.collection("membresias").doc(`${context.businessId}__${input.responsableUid}`);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const assignedUser = await dependencies.auth.getUser(input.responsableUid);
  if (assignedUser.disabled) fail(HttpsError, "failed-precondition", "El responsable seleccionado está deshabilitado.");
  return db.runTransaction(async (transaction) => {
    await assertFreshTallerAccess(transaction, context, dependencies, "operate");
    const existing = await transaction.get(diagnosisRef);
    if (existing.exists) {
      const stored = assertDiagnosis(existing, context.businessId, otId, HttpsError);
      if (stored.creadoPorUid !== context.uid ||
          !Object.keys(input).every((key) => stored[key] === input[key])) {
        fail(HttpsError, "already-exists", "Esta solicitud de diagnóstico ya fue utilizada.");
      }
      return {diagnostico: {...stored, diagnosticoId: diagnosisRef.id}, sinCambios: true};
    }
    const [orderSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(memberRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertDiagnosisOperationAllowed(order, HttpsError);
    assertAssignableMember(memberSnapshot, context.businessId, input.responsableUid, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    const stored = {
      diagnosticoId: diagnosisRef.id, negocioId: context.businessId, otId,
      ...input, estado: "borrador", creadoPorUid: context.uid, creadoEn: timestamp,
      actualizadoPorUid: context.uid, actualizadoEn: timestamp,
      completadoPorUid: null, completadoEn: null,
    };
    transaction.create(diagnosisRef, stored);
    transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    appendDiagnosisEvent(transaction, orderRef, {
      businessId: context.businessId, diagnosisId: diagnosisRef.id,
      type: "diagnostico_creado", actorUid: context.uid, actorSnapshot, timestamp,
    });
    return {diagnosticoId: diagnosisRef.id, sinCambios: false};
  });
}

async function actualizarDiagnosticoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const diagnosticoId = identifier(request?.data?.diagnosticoId, "El diagnóstico", HttpsError);
  const input = normalizeDiagnosisInput(request?.data?.diagnostico, HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const diagnosisRef = orderRef.collection("diagnosticos").doc(diagnosticoId);
  const memberRef = db.collection("membresias").doc(`${context.businessId}__${input.responsableUid}`);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const assignedUser = await dependencies.auth.getUser(input.responsableUid);
  if (assignedUser.disabled) fail(HttpsError, "failed-precondition", "El responsable seleccionado está deshabilitado.");
  return db.runTransaction(async (transaction) => {
    await assertFreshTallerAccess(transaction, context, dependencies, "operate");
    const [orderSnapshot, diagnosisSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(diagnosisRef), transaction.get(memberRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertDiagnosisOperationAllowed(order, HttpsError);
    const stored = assertDiagnosis(diagnosisSnapshot, context.businessId, otId, HttpsError);
    if (stored.estado !== "borrador") fail(HttpsError, "failed-precondition", "Un diagnóstico completado es de solo lectura.");
    assertDiagnosisRevision(stored, expected, HttpsError);
    assertAssignableMember(memberSnapshot, context.businessId, input.responsableUid, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(diagnosisRef, {...input, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    appendDiagnosisEvent(transaction, orderRef, {
      businessId: context.businessId, diagnosisId: diagnosticoId,
      type: "diagnostico_actualizado", actorUid: context.uid, actorSnapshot, timestamp,
    });
    return {diagnosticoId};
  });
}

async function completarDiagnosticoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const diagnosticoId = identifier(request?.data?.diagnosticoId, "El diagnóstico", HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const diagnosisRef = orderRef.collection("diagnosticos").doc(diagnosticoId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  return db.runTransaction(async (transaction) => {
    await assertFreshTallerAccess(transaction, context, dependencies, "operate");
    const [orderSnapshot, diagnosisSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(diagnosisRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertDiagnosisOperationAllowed(order, HttpsError);
    const stored = assertDiagnosis(diagnosisSnapshot, context.businessId, otId, HttpsError);
    if (stored.estado !== "borrador") fail(HttpsError, "failed-precondition", "El diagnóstico ya está completado.");
    assertDiagnosisRevision(stored, expected, HttpsError);
    if (!String(stored.descripcion || "").trim()) {
      fail(HttpsError, "failed-precondition", "Describe el diagnóstico antes de completarlo.");
    }
    const memberRef = db.collection("membresias").doc(`${context.businessId}__${stored.responsableUid}`);
    assertAssignableMember(await transaction.get(memberRef), context.businessId, stored.responsableUid, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(diagnosisRef, {
      estado: "completado", completadoPorUid: context.uid, completadoEn: timestamp,
      actualizadoPorUid: context.uid, actualizadoEn: timestamp,
    });
    transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    appendDiagnosisEvent(transaction, orderRef, {
      businessId: context.businessId, diagnosisId: diagnosticoId,
      type: "diagnostico_completado", actorUid: context.uid, actorSnapshot, timestamp,
    });
    return {diagnosticoId};
  });
}

async function crearServicioOTHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = requestIdentifier(request?.data?.requestId, HttpsError);
  const input = normalizeServiceInput(request?.data?.servicio, HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const itemRef = context.businessRef.collection("inventario").doc(input.itemId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  return db.runTransaction(async (transaction) => {
    const membership = await assertFreshTallerAccess(transaction, context, dependencies, "operate");
    const [existing, orderSnapshot, itemSnapshot] = await Promise.all([
      transaction.get(serviceRef), transaction.get(orderRef), transaction.get(itemRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertWorkOperator(membership, order, context.uid, HttpsError);
    if (existing.exists) {
      const stored = assertService(existing, context.businessId, otId, HttpsError);
      if (stored.creadoPorUid !== context.uid || stored.itemId !== input.itemId) {
        fail(HttpsError, "already-exists", "Esta solicitud de servicio ya fue utilizada.");
      }
      return {servicioOtId: serviceId, sinCambios: true};
    }
    assertPlanningOrder(order, HttpsError);
    assertPlanningItem(itemSnapshot, context.businessId, input.itemId, "servicio", HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.create(serviceRef, {
      servicioOtId: serviceId, negocioId: context.businessId, otId,
      ...input, estado: "pendiente", precioUnitario: null, servicioSnapshot: null, productos: [],
      repuestosModo: null, fotos: {},
      creadoPorUid: context.uid, creadoEn: timestamp,
      actualizadoPorUid: context.uid, actualizadoEn: timestamp,
    });
    invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp);
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      type: "servicio_ot_creado", detail: {servicioOtId: serviceId, itemId: input.itemId}, timestamp,
    });
    return {servicioOtId: serviceId, sinCambios: false};
  });
}

async function actualizarServicioOTHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = identifier(request?.data?.servicioOtId, "El servicio de la OT", HttpsError);
  const input = normalizeServiceInput(request?.data?.servicio, HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const itemRef = context.businessRef.collection("inventario").doc(input.itemId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  return db.runTransaction(async (transaction) => {
    const membership = await assertFreshTallerAccess(transaction, context, dependencies, "operate");
    const [orderSnapshot, serviceSnapshot, itemSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(serviceRef), transaction.get(itemRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertWorkOperator(membership, order, context.uid, HttpsError);
    assertPlanningOrder(order, HttpsError);
    const stored = assertService(serviceSnapshot, context.businessId, otId, HttpsError);
    if (stored.estado !== "pendiente") fail(HttpsError, "failed-precondition", "Este servicio ya inició su ejecución.");
    assertDiagnosisRevision(stored, expected, HttpsError, "servicio");
    assertPlanningItem(itemSnapshot, context.businessId, input.itemId, "servicio", HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(serviceRef, {...input, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    if (stored.itemId !== input.itemId) {
      invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp);
    } else {
      transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    }
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      type: "servicio_ot_actualizado", detail: {servicioOtId: serviceId, itemId: input.itemId}, timestamp,
    });
    return {servicioOtId: serviceId};
  });
}

async function eliminarServicioOTHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = identifier(request?.data?.servicioOtId, "El servicio de la OT", HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  return db.runTransaction(async (transaction) => {
    const membership = await assertFreshTallerAccess(transaction, context, dependencies, "operate");
    const [orderSnapshot, serviceSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(serviceRef),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertWorkOperator(membership, order, context.uid, HttpsError);
    assertPlanningOrder(order, HttpsError);
    const stored = assertService(serviceSnapshot, context.businessId, otId, HttpsError);
    if (stored.estado !== "pendiente") {
      fail(HttpsError, "failed-precondition", "Solo se puede eliminar un servicio que aún no ha iniciado.");
    }
    assertDiagnosisRevision(stored, expected, HttpsError, "servicio");
    const timestamp = FieldValue.serverTimestamp();
    transaction.delete(serviceRef);
    invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp);
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      type: "servicio_ot_eliminado", detail: {servicioOtId: serviceId, itemId: stored.itemId}, timestamp,
    });
    return {servicioOtId: serviceId};
  });
}

async function changeProductoOTHandler(request, dependencies, action) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const forbidden = ["precioUnitario", "productoSnapshot", "stock", "estado"].find((field) =>
    Object.prototype.hasOwnProperty.call(request?.data || {}, field));
  if (forbidden) fail(HttpsError, "invalid-argument", `El campo ${forbidden} no está admitido en ProductoOT.`);
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = identifier(request?.data?.servicioOtId, "El servicio de la OT", HttpsError);
  const productId = action === "agregar"
    ? requestIdentifier(request?.data?.requestId, HttpsError)
    : identifier(request?.data?.productoOtId, "El producto planificado", HttpsError);
  const itemId = action === "agregar"
    ? identifier(request?.data?.itemId, "El producto de Inventario", HttpsError)
    : null;
  const quantity = action === "eliminar" ? null : plannedQuantity(request?.data?.cantidad, HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const itemRef = itemId ? context.businessRef.collection("inventario").doc(itemId) : null;
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  return db.runTransaction(async (transaction) => {
    const membership = await assertFreshTallerAccess(transaction, context, dependencies, "operate");
    const [orderSnapshot, serviceSnapshot, itemSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(serviceRef),
      itemRef ? transaction.get(itemRef) : Promise.resolve(null),
    ]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertWorkOperator(membership, order, context.uid, HttpsError);
    const stored = assertService(serviceSnapshot, context.businessId, otId, HttpsError);
    const products = Array.isArray(stored.productos) ? stored.productos : [];
    const existing = products.find((product) => product.productoOtId === productId);
    if (action === "agregar" && existing) {
      if (existing.itemId !== itemId || existing.cantidad !== quantity) {
        fail(HttpsError, "already-exists", "Esta solicitud de producto ya fue utilizada.");
      }
      return {servicioOtId: serviceId, productoOtId: productId, sinCambios: true};
    }
    assertPlanningOrder(order, HttpsError);
    // Los repuestos se pueden ajustar mientras el trabajo está pendiente o en ejecución; uno terminado se reabre primero.
    if (stored.estado === "completado") {
      fail(HttpsError, "failed-precondition", "Este trabajo está terminado. Un Owner o Administrador debe reabrirlo para cambiar sus repuestos.");
    }
    if (action !== "agregar") assertDiagnosisRevision(stored, expected, HttpsError, "servicio");
    if (action === "agregar") assertPlanningItem(itemSnapshot, context.businessId, itemId, "producto", HttpsError);
    if (action !== "agregar" && !existing) fail(HttpsError, "not-found", "No se encontró el producto planificado.");
    let stockSnapshot = itemSnapshot;
    if (action === "actualizar") {
      const existingItemRef = context.businessRef.collection("inventario").doc(existing.itemId);
      stockSnapshot = await transaction.get(existingItemRef);
      assertPlanningItem(stockSnapshot, context.businessId, existing.itemId, "producto", HttpsError);
    }
    const next = action === "agregar"
      ? [...products, {productoOtId: productId, itemId, cantidad: quantity,
        precioUnitario: null, productoSnapshot: null}]
      : action === "eliminar"
        ? products.filter((product) => product.productoOtId !== productId)
        : products.map((product) => product.productoOtId === productId ? {...product, cantidad: quantity} : product);
    // Agregar o aumentar exige que el total del repuesto en esta OT no supere el stock actual;
    // disminuir siempre se permite. Solo se leen el ítem y los servicios de esta OT.
    const increases = action === "agregar" || (action === "actualizar" && quantity > existing.cantidad);
    if (increases) {
      const stockItemId = existing?.itemId || itemId;
      const stockItem = stockSnapshot.data() || {};
      const stockUnits = productStockUnits(stockItem, HttpsError);
      const orderServices = await transaction.get(orderRef.collection("servicios"));
      const ownServices = orderServices.docs.map((document) => document.data() || {})
        .filter((service) => service.servicioOtId !== serviceId)
        .concat([{...stored, productos: next}]);
      const requiredUnits = orderProductUnits(ownServices, context.businessId, otId, stockItemId);
      if (requiredUnits > stockUnits) {
        const nombre = String(stockItem.nombre || stockItem.descripcionItem || "el producto").trim();
        fail(HttpsError, "failed-precondition", stockUnits === 0
          ? `No hay stock de «${nombre}» en Inventario.`
          : `Stock insuficiente de «${nombre}»: stock actual ${formatQuantityUnits(stockUnits)} y esta OT ` +
            `necesita ${formatQuantityUnits(requiredUnits)}. Ajusta la cantidad.`);
      }
    }
    const timestamp = FieldValue.serverTimestamp();
    // Elegir repuestos del inventario reemplaza «repuestos del cliente» y «no requiere repuestos».
    transaction.update(serviceRef, {productos: next, ...(action === "agregar" ? {repuestosModo: null} : {}),
      actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    if (action !== "actualizar" || existing.cantidad !== quantity) {
      invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp);
    } else {
      transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    }
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      type: `producto_ot_${action}`, detail: {servicioOtId: serviceId, productoOtId: productId,
        itemId: existing?.itemId || itemId}, timestamp,
    });
    return {servicioOtId: serviceId, productoOtId: productId, sinCambios: false};
  });
}

const agregarProductoOTHandler = (request, dependencies) => changeProductoOTHandler(request, dependencies, "agregar");
const actualizarProductoOTHandler = (request, dependencies) => changeProductoOTHandler(request, dependencies, "actualizar");
const eliminarProductoOTHandler = (request, dependencies) => changeProductoOTHandler(request, dependencies, "eliminar");

// «Repuestos del cliente» o «No requiere repuestos»: respuesta explícita para poder terminar un trabajo
// que no usa repuestos del inventario.
async function definirRepuestosServicioOTHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const allowed = new Set(["businessId", "otId", "servicioOtId", "modo", "expectedActualizadoEn"]);
  if (Object.keys(request?.data || {}).some((field) => !allowed.has(field))) {
    fail(HttpsError, "invalid-argument", "La solicitud contiene campos no permitidos para definir los repuestos.");
  }
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = identifier(request?.data?.servicioOtId, "El servicio de la OT", HttpsError);
  const mode = request?.data?.modo;
  if (!REPLACEMENT_PARTS_MODES.has(mode)) {
    fail(HttpsError, "invalid-argument", "Indica si los repuestos los trae el cliente o si el trabajo no los requiere.");
  }
  const expected = request?.data?.expectedActualizadoEn;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  return db.runTransaction(async (transaction) => {
    const membership = await assertFreshTallerAccess(transaction, context, dependencies, "operate");
    const [orderSnapshot, serviceSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(serviceRef)]);
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    assertWorkOperator(membership, order, context.uid, HttpsError);
    assertPlanningOrder(order, HttpsError);
    const stored = assertService(serviceSnapshot, context.businessId, otId, HttpsError);
    if (stored.estado === "completado") {
      fail(HttpsError, "failed-precondition", "Este trabajo está terminado. Un Owner o Administrador debe reabrirlo para cambiar sus repuestos.");
    }
    assertDiagnosisRevision(stored, expected, HttpsError, "servicio");
    if (Array.isArray(stored.productos) && stored.productos.length) {
      fail(HttpsError, "failed-precondition", "Quita los repuestos del inventario antes de marcar este trabajo como sin repuestos o con repuestos del cliente.");
    }
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(serviceRef, {repuestosModo: mode, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    appendPlanningEvent(transaction, orderRef, {businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      timestamp, type: "servicio_ot_repuestos_definidos", detail: {servicioOtId: serviceId, modo: mode}});
    return {servicioOtId: serviceId, modo: mode};
  });
}

function scopeFingerprint(services) {
  const scope = services.map((service) => ({
    servicioOtId: service.servicioOtId, itemId: service.itemId,
    productos: (service.productos || []).map(({productoOtId, itemId, cantidad}) =>
      ({productoOtId, itemId, cantidad})).sort((a, b) => a.productoOtId.localeCompare(b.productoOtId)),
  })).sort((a, b) => a.servicioOtId.localeCompare(b.servicioOtId));
  return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

async function transitionServiceOT(request, dependencies, action) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const allowed = new Set(["businessId", "otId", "servicioOtId", "requestId", "expectedActualizadoEn"]);
  if (Object.keys(request?.data || {}).some((field) => !allowed.has(field))) {
    fail(HttpsError, "invalid-argument", "La solicitud contiene campos no permitidos para ejecutar el servicio.");
  }
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const serviceId = identifier(request?.data?.servicioOtId, "El servicio de la OT", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  if (!Number.isSafeInteger(expected)) fail(HttpsError, "invalid-argument", "Actualiza la ficha antes de ejecutar el servicio.");
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  const approvalRef = context.businessRef.collection("otApprovalState").doc(otId);
  const requestRef = context.businessRef.collection("otServiceExecutionRequests").doc(requestId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const fingerprint = createHash("sha256").update(JSON.stringify({otId, serviceId, action, expected, actor: context.uid})).digest("hex");
  return db.runTransaction(async (transaction) => {
    await assertFreshTallerAccess(transaction, context, dependencies, "operate");
    const [requestSnapshot, orderSnapshot, serviceSnapshot, approvalSnapshot, servicesSnapshot, memberSnapshot,
      businessSnapshot] = await Promise.all([
      transaction.get(requestRef), transaction.get(orderRef), transaction.get(serviceRef), transaction.get(approvalRef),
      transaction.get(orderRef.collection("servicios")), transaction.get(context.membershipRef),
      transaction.get(context.businessRef),
    ]);
    const membership = memberSnapshot.data() || {};
    if (!memberSnapshot.exists || membership.uid !== context.uid || membership.negocioId !== context.businessId ||
        membership.estado !== "activo" || !TALLER_OPERATION_ROLES.includes(membership.rol)) {
      fail(HttpsError, "permission-denied", "Tu membresía ya no permite operar esta OT.");
    }
    if (membership.profileId) {
      const profile = await transaction.get(context.businessRef.collection("perfilesEmpleados").doc(membership.profileId));
      const data = profile.data() || {};
      if (data.negocioId !== context.businessId || data.estado !== "activo" || !data.modulos?.includes("taller")) {
        fail(HttpsError, "permission-denied", "Tu perfil ya no permite operar Taller.");
      }
    }
    const business = businessSnapshot.data() || {};
    if (!businessSnapshot.exists || business.estado !== "activo" || business.eliminadoEn ||
        normalizeBusinessVerificationState(business) !== "VERIFICADA") {
      fail(HttpsError, "failed-precondition", "El negocio no está habilitado para operar.");
    }
    if (requestSnapshot.exists) {
      if (requestSnapshot.data().fingerprint !== fingerprint) {
        fail(HttpsError, "already-exists", "La solicitud ya fue utilizada con otros datos.");
      }
      return {...requestSnapshot.data().resultado, sinCambios: true};
    }
    const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
    const service = assertService(serviceSnapshot, context.businessId, otId, HttpsError);
    assertDiagnosisRevision(service, expected, HttpsError, "servicio");
    if (order.estado !== "en_reparacion" || order.estadoAprobacion !== "aprobada") {
      fail(HttpsError, "failed-precondition", "La OT debe estar en ejecución con el ingreso aprobado.");
    }
    const transition = {
      iniciar: {previous: "pendiente", next: "en_progreso", message: "Solo puedes iniciar un trabajo pendiente."},
      completar: {previous: "en_progreso", next: "completado", message: "Solo puedes terminar un trabajo en ejecución."},
      reabrir: {previous: "completado", next: "en_progreso", message: "Solo se puede reabrir un trabajo terminado."},
    }[action];
    const {previous, next} = transition;
    if (action === "reabrir") {
      if (!hasTallerCapability(membership, "manage")) {
        fail(HttpsError, "permission-denied", "Solo el Owner o el Administrador pueden reabrir un trabajo terminado.");
      }
    } else {
      assertWorkOperator(membership, order, context.uid, HttpsError);
    }
    if (service.estado !== previous) fail(HttpsError, "failed-precondition", transition.message);
    if (action === "completar" && !worksPartsDefined(service)) {
      fail(HttpsError, "failed-precondition", "Define los repuestos de este trabajo antes de terminarlo: del inventario, del cliente o sin repuestos.");
    }
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(serviceRef, {estado: next, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot, timestamp,
      type: {iniciar: "servicio_ot_iniciado", completar: "servicio_ot_completado", reabrir: "servicio_ot_reabierto"}[action],
      detail: {servicioOtId: serviceId, itemId: service.itemId, estadoAnterior: previous, estado: next},
    });
    const resultado = {servicioOtId: serviceId, estado: next, sinCambios: false};
    transaction.create(requestRef, {negocioId: context.businessId, otId, servicioOtId: serviceId,
      fingerprint, resultado, creadoEn: timestamp});
    return resultado;
  });
}

const iniciarServicioOTHandler = (request, deps) => transitionServiceOT(request, deps, "iniciar");
const completarServicioOTHandler = (request, deps) => transitionServiceOT(request, deps, "completar");
const reabrirServicioOTHandler = (request, deps) => transitionServiceOT(request, deps, "reabrir");

async function transitionWorkOrderClosure(request, dependencies, action) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const allowed = new Set(["businessId", "otId", "requestId", "expectedActualizadoEn", "motivo", "entrega"]);
  if (Object.keys(request?.data || {}).some((field) => !allowed.has(field))) {
    fail(HttpsError, "invalid-argument", "La solicitud de cierre contiene campos no permitidos.");
  }
  // Solo anular una OT lleva motivo (opcional aquí; la pantalla de aprobación lo exige).
  if (action !== "cancelar" && request?.data?.motivo !== undefined) {
    fail(HttpsError, "invalid-argument", "Solo anular una OT admite un motivo.");
  }
  const motivo = action === "cancelar" ? text(request?.data?.motivo, "El motivo", 2000, HttpsError) : "";
  // La entrega exige los datos de quien retira el vehículo y la conformidad; ninguna otra acción los admite.
  if (action !== "entregar" && request?.data?.entrega !== undefined) {
    fail(HttpsError, "invalid-argument", "Solo registrar la entrega admite los datos de entrega.");
  }
  const delivery = action === "entregar"
    ? normalizeDeliveryInput(request?.data?.entrega, context.businessSnapshot?.data()?.paisCodigo || "CL", HttpsError) : null;
  const otId = identifier(request?.data?.otId, "La orden de trabajo", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const expected = request?.data?.expectedActualizadoEn;
  if (!Number.isSafeInteger(expected)) {
    fail(HttpsError, "invalid-argument", "Actualiza la ficha antes de continuar.");
  }
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const requestRef = context.businessRef.collection("otClosureRequests").doc(requestId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const fingerprint = createHash("sha256").update(JSON.stringify({otId, action, expected, actor: context.uid, ...(motivo ? {motivo} : {}), ...(delivery ? {delivery} : {})})).digest("hex");
  return db.runTransaction(async (transaction) => {
    const [previous, data] = await Promise.all([
      transaction.get(requestRef), readApprovalContext(transaction, context, orderRef, dependencies, action === "finalizar" ? "required" : "skip"),
    ]);
    if (previous.exists) {
      if (previous.data().negocioId !== context.businessId || previous.data().fingerprint !== fingerprint) {
        fail(HttpsError, "already-exists", "La solicitud ya fue utilizada con otros datos.");
      }
      return {...previous.data().resultado, sinCambios: true};
    }
    const {order, services} = data;
    assertDiagnosisRevision(order, expected, HttpsError, "orden de trabajo");
    if (action === "finalizar" && !hasTallerCapability(data.membership, "manage")) {
      fail(HttpsError, "permission-denied", "Solo el Owner o el Administrador pueden finalizar la ejecución.");
    }
    const previousStatus = order.estado;
    let frozenAtFinish = null;
    let closureCurrency = null;
    let closureDecimals = 0;
    if (action === "cancelar" ? !CANCELLABLE_ORDER_STATES.has(order.estado) :
      order.estado !== (action === "finalizar" ? "en_reparacion" : "pendiente_entrega")) {
      const message = action === "finalizar"
        ? "Solo se puede finalizar una OT en reparación."
        : action === "entregar"
          ? "Solo se puede registrar la entrega de una OT pendiente de entrega."
          : "Solo se puede cancelar una OT antes de iniciar la reparación.";
      fail(HttpsError, "failed-precondition", message);
    }
    const actaRef = orderRef.collection("entrega").doc("acta");
    const actaSnapshot = action === "entregar" ? await transaction.get(actaRef) : null;
    // Seguimiento público: al confirmar la entrega (o anular) el enlace del cliente se inactiva en la misma transacción.
    const trackingLinkSnapshot = action === "finalizar" ? null
      : await transaction.get(orderRef.collection("seguimiento").doc("enlace"));
    if (action === "entregar") {
      const missing = missingDeliveryZones(actaSnapshot.exists ? actaSnapshot.data() : {});
      if (missing.length) {
        fail(HttpsError, "failed-precondition", `Faltan fotos de entrega: ${missing.join(", ")}.`);
      }
    }
    if (action === "finalizar") {
      if (!services.length || services.some((service) => service.estado !== "completado")) {
        fail(HttpsError, "failed-precondition", "Termina todos los trabajos antes de finalizar la ejecución.");
      }
      if (order.estadoAprobacion !== "aprobada") {
        fail(HttpsError, "failed-precondition", "El ingreso de la OT no está aprobado.");
      }
      // Los precios se congelan aquí y pasan a la venta en borrador; el taller nunca los muestra.
      closureCurrency = order.moneda || businessCurrency({businessSnapshot: {data: () => data.businessData}});
      if (!closureCurrency) fail(HttpsError, "failed-precondition", "Configura una moneda válida en el negocio antes de finalizar.");
      closureDecimals = workOrderAmountDecimals(order, closureCurrency);
      frozenAtFinish = services.map((service) => {
        const core = freezeCoreItem(data.items.get(service.itemId), context.businessId, service.itemId, "servicio", HttpsError, closureDecimals);
        return {...frozenScope([service])[0], precioUnitario: core.precioUnitario, servicioSnapshot: core.snapshot,
          productos: service.productos.map((product) => {
            const coreProduct = freezeCoreItem(data.items.get(product.itemId), context.businessId, product.itemId, "producto", HttpsError, closureDecimals);
            return {...product, precioUnitario: coreProduct.precioUnitario, productoSnapshot: coreProduct.snapshot};
          })};
      });
    }
    // Finalizar genera la venta en borrador con los precios congelados (todo o nada con la finalización).
    const saleContext = action === "finalizar"
      ? await readWorkOrderSaleContext(transaction, {businessRef: context.businessRef, businessId: context.businessId,
        order, otId, HttpsError})
      : null;
    const estado = action === "finalizar" ? "pendiente_entrega" : action === "entregar" ? "cerrada" : "cancelada";
    // Al finalizar la ejecución la Plaza queda libre (el vehículo espera el retiro fuera de ella). Entregar y cancelar
    // también liberan: cubren las OT antiguas que llegaron a «pendiente de entrega» con la Plaza aún asignada.
    const releasesPlaza = ["finalizar", "entregar", "cancelar"].includes(action);
    const plazaIdLiberada = releasesPlaza ? order.plazaId || null : null;
    const plazaLockRef = plazaIdLiberada
      ? context.businessRef.collection("plazaOccupancyKeys").doc(plazaIdLiberada)
      : null;
    const plazaLockSnapshot = plazaLockRef ? await transaction.get(plazaLockRef) : null;
    const plazaLock = plazaLockSnapshot?.data() || null;
    const ownsPlazaLock = Boolean(plazaLockSnapshot?.exists && plazaLock?.negocioId === context.businessId &&
      plazaLock.plazaId === plazaIdLiberada && plazaLock.otId === otId);
    // La Plaza liberada pasa a la OT aprobada más antigua que espera (lectura antes de escribir).
    const promotion = plazaIdLiberada && (ownsPlazaLock || !plazaLockSnapshot?.exists)
      ? await readPromotionCandidate(transaction, context.businessRef, context.businessId, plazaIdLiberada, otId)
      : null;
    const timestamp = FieldValue.serverTimestamp();
    const draftSale = saleContext ? buildWorkOrderDraftSale({saleContext, businessId: context.businessId,
      businessData: data.businessData, uid: context.uid, order, otId, frozenServices: frozenAtFinish, items: data.items,
      closureCurrency, timestamp, HttpsError}) : null;
    if (ownsPlazaLock && !promotion) transaction.delete(plazaLockRef);
    if (draftSale) {
      transaction.set(draftSale.counterRef, draftSale.counter);
      transaction.create(draftSale.saleRef, draftSale.stored);
    }
    if (frozenAtFinish) {
      frozenAtFinish.forEach((service) => transaction.update(orderRef.collection("servicios").doc(service.servicioOtId), {
        precioUnitario: service.precioUnitario, servicioSnapshot: service.servicioSnapshot, productos: service.productos,
        actualizadoEn: timestamp, actualizadoPorUid: context.uid,
      }));
    }
    transaction.update(orderRef, {
      estado,
      ...(closureCurrency ? {moneda: closureCurrency} : {}),
      ...(closureCurrency && !order.moneda && closureDecimals > 0 ? {montoDecimales: closureDecimals} : {}),
      ...(releasesPlaza ? {plazaId: null} : {}),
      ...(draftSale ? {ventaId: draftSale.saleRef.id, ventaNumero: draftSale.stored.numero} : {}),
      ...(action === "cancelar" && motivo ? {motivoCancelacion: motivo} : {}),
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    const trackingTokenHash = trackingLinkSnapshot?.exists ? trackingLinkSnapshot.data()?.tokenHash : "";
    if (typeof trackingTokenHash === "string" && /^[a-f0-9]{64}$/.test(trackingTokenHash)) {
      transaction.set(db.collection("tallerSeguimientoTokens").doc(trackingTokenHash), {
        estado: "inactivo", inactivadoEn: timestamp, motivoInactivacion: action === "entregar" ? "entregada" : "anulada",
      }, {merge: true});
    }
    if (delivery) {
      // El acta guarda las fotos selladas y quién retira el vehículo (con su documento): solo la lee el Owner/Administrador.
      transaction.set(actaRef, {
        negocioId: context.businessId, otId, ...delivery,
        entregadaPorUid: context.uid, entregadaPorNombre: actorSnapshot.nombre, entregadaEn: timestamp,
      }, {merge: true});
    }
    appendPlanningEvent(transaction, orderRef, {
      businessId: context.businessId, actorUid: context.uid, actorSnapshot, timestamp,
      type: action === "finalizar" ? "reparacion_finalizada" : action === "entregar" ? "vehiculo_entregado" : "ot_cancelada",
      detail: {estadoAnterior: previousStatus, estado, plazaIdLiberada, ...(motivo ? {motivo} : {}),
        ...(draftSale ? {ventaId: draftSale.saleRef.id, ventaNumero: draftSale.stored.numero} : {}),
        ...(delivery ? {receptorNombre: delivery.receptorNombre, conObservaciones: Boolean(delivery.observaciones)} : {})},
    });
    const promoted = writePromotion(transaction, promotion, {appendPlanningEvent, businessId: context.businessId,
      actorUid: context.uid, actorSnapshot, timestamp,
      origen: action === "finalizar" ? "finalizacion" : action === "entregar" ? "entrega" : "cancelacion"});
    const resultado = {otId, estado, estadoAprobacion: order.estadoAprobacion,
      plazaId: releasesPlaza ? null : order.plazaId || null,
      ...(draftSale ? {ventaId: draftSale.saleRef.id, ventaNumero: draftSale.stored.numero} : {}),
      ...(promoted ? {otPromovidaId: promoted.otId} : {})};
    transaction.create(requestRef, {negocioId: context.businessId, otId, fingerprint, resultado, creadoEn: timestamp});
    return resultado;
  });
}

const finalizarReparacionOTHandler = (request, deps) => transitionWorkOrderClosure(request, deps, "finalizar");
const registrarEntregaOTHandler = (request, deps) => transitionWorkOrderClosure(request, deps, "entregar");
const cancelarOTHandler = (request, deps) => transitionWorkOrderClosure(request, deps, "cancelar");

async function obtenerEventosCierreOTHandler(request, dependencies) {
  const context = await requireTallerAccess(request, dependencies, "manage");
  const otId = identifier(request?.data?.otId, "La orden de trabajo", dependencies.HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  assertStoredWorkOrder(await orderRef.get(), context.businessId, dependencies.HttpsError);
  const snapshot = await orderRef.collection("historial")
    .where("tipo", "in", ["reparacion_finalizada", "vehiculo_entregado", "ot_cancelada"]).get();
  return {eventos: snapshot.docs.map((entry) => {
    const event = entry.data();
    if (event.negocioId !== context.businessId || event.otId !== otId) return null;
    return {eventoId: entry.id, tipo: event.tipo, fecha: event.fecha?.toMillis?.() || null,
      actorNombre: event.actorSnapshot?.nombre || event.actorSnapshot?.correo || "Usuario no disponible"};
  }).filter(Boolean).sort((a, b) => (a.fecha || 0) - (b.fecha || 0))};
}

function historyEventDetail(type, detail = {}) {
  const changes = detail.cambios && typeof detail.cambios === "object"
    ? Object.keys(detail.cambios) : [];
  return {
    ...(changes.length ? {camposModificados: changes} : {}),
    ...(typeof detail.estadoAnterior === "string" ? {estadoAnterior: detail.estadoAnterior} : {}),
    ...(typeof detail.estado === "string" ? {estado: detail.estado} : {}),
    ...(typeof detail.aprobacionAnterior === "string" ? {aprobacionAnterior: detail.aprobacionAnterior} : {}),
    ...(typeof detail.estadoAprobacion === "string" ? {estadoAprobacion: detail.estadoAprobacion} : {}),
    ...(typeof detail.motivo === "string" && detail.motivo.trim() ? {motivo: detail.motivo.trim()} : {}),
    // Plaza automática y fotos de recepción: solo marcas y la zona, sin identificadores internos.
    ...(typeof detail.enEsperaDePlaza === "boolean" ? {enEsperaDePlaza: detail.enEsperaDePlaza} : {}),
    ...(typeof detail.responsableNombre === "string" && detail.responsableNombre.trim()
      ? {responsableNombre: detail.responsableNombre.trim().slice(0, 120)} : {}),
    ...(["cliente", "ninguno"].includes(detail.modo) ? {modo: detail.modo} : {}),
    ...(["antes", "despues"].includes(detail.momento) ? {momento: detail.momento} : {}),
    ...(detail.automatica === true ? {automatica: true} : {}),
    ...(typeof detail.urgente === "boolean" ? {urgente: detail.urgente} : {}),
    ...(typeof detail.receptorNombre === "string" && detail.receptorNombre.trim()
      ? {receptorNombre: detail.receptorNombre.trim().slice(0, 120)} : {}),
    ...(typeof detail.conObservaciones === "boolean" ? {conObservaciones: detail.conObservaciones} : {}),
    ...(typeof detail.zona === "string" && /^[a-z-]{1,40}$/.test(detail.zona) ? {zona: detail.zona} : {}),
    ...(typeof detail.conDanos === "boolean" ? {conDanos: detail.conDanos} : {}),
    ...(Number.isSafeInteger(detail.cantidadDanos) && detail.cantidadDanos >= 0 ? {cantidadDanos: detail.cantidadDanos} : {}),
  };
}

async function obtenerHistorialOTHandler(request, dependencies) {
  const context = await requireTallerAccess(request, dependencies, "manage");
  const otId = identifier(request?.data?.otId, "La orden de trabajo", dependencies.HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  assertStoredWorkOrder(await orderRef.get(), context.businessId, dependencies.HttpsError);
  const snapshot = await orderRef.collection("historial").get();
  const events = snapshot.docs.flatMap((entry) => {
    const event = entry.data() || {};
    if (event.negocioId !== context.businessId || event.otId !== otId ||
        typeof event.tipo !== "string" || !event.tipo.trim()) return [];
    return [{
      eventoId: entry.id,
      tipo: event.tipo,
      fecha: event.fecha?.toMillis?.() || null,
      actorNombre: String(event.actorSnapshot?.nombre || event.actorSnapshot?.correo || "Usuario no disponible").trim(),
      detalle: historyEventDetail(event.tipo, event.detalle),
    }];
  });
  events.sort((left, right) => (left.fecha || 0) - (right.fecha || 0) ||
    left.eventoId.localeCompare(right.eventoId));
  return {eventos: events};
}

// `decimals`: decimales de cálculo de la OT (SPEC 036). Con 0 el precio congelado es Math.round, como siempre.
function freezeCoreItem(snapshot, businessId, itemId, type, HttpsError, decimals = 0) {
  assertPlanningItem(snapshot, businessId, itemId, type, HttpsError);
  const item = snapshot.data();
  if (typeof item.precioInterno !== "number" || !Number.isFinite(item.precioInterno) ||
      item.precioInterno < 0 || item.precioInterno > Number.MAX_SAFE_INTEGER) {
    fail(HttpsError, "failed-precondition", "Un ítem no tiene precio de venta vigente válido en Inventario. Revisa el catálogo antes de enviar.");
  }
  const precioUnitario = decimals === 0 ? Math.round(item.precioInterno) : roundMoney(item.precioInterno, decimals);
  if (decimals > 0 && !isMoneyAmount(precioUnitario, decimals)) {
    fail(HttpsError, "failed-precondition", "Un ítem no tiene precio de venta vigente válido en Inventario. Revisa el catálogo antes de enviar.");
  }
  const nombre = text(item.nombre || item.descripcionItem, "El nombre del ítem", 240, HttpsError, {required: true});
  return {
    precioUnitario,
    snapshot: {
      codigoInterno: String(item.codigoInterno || item.sku || ""), nombre,
      unidad: String(item.unidad || "unidad"),
      modeloInventarioVersion: Number(item.modeloInventarioVersion) || null,
    },
  };
}

async function readApprovalContext(transaction, context, orderRef, dependencies, inventoryMode = "required") {
  await assertFreshTallerAccess(transaction, context, dependencies, "read");
  const {db, HttpsError} = dependencies;
  const [orderSnapshot, serviceSnapshot, diagnoses, business, member] = await Promise.all([
    transaction.get(orderRef), transaction.get(orderRef.collection("servicios")),
    transaction.get(orderRef.collection("diagnosticos").where("estado", "==", "completado")),
    transaction.get(context.businessRef), transaction.get(context.membershipRef),
  ]);
  const membership = member.data() || {};
  if (!member.exists || membership.uid !== context.uid || membership.negocioId !== context.businessId ||
      membership.estado !== "activo" || !TALLER_OPERATION_ROLES.includes(membership.rol)) {
    fail(HttpsError, "permission-denied", "Tu membresía ya no permite operar esta OT.");
  }
  if (membership.profileId) {
    const profile = await transaction.get(context.businessRef.collection("perfilesEmpleados").doc(membership.profileId));
    const data = profile.data() || {};
    if (data.negocioId !== context.businessId || data.estado !== "activo" || !data.modulos?.includes("taller")) {
      fail(HttpsError, "permission-denied", "Tu perfil ya no permite operar Taller.");
    }
  }
  const businessData = business.data() || {};
  if (!business.exists || businessData.estado !== "activo" || businessData.eliminadoEn ||
      normalizeBusinessVerificationState(businessData) !== "VERIFICADA") {
    fail(HttpsError, "failed-precondition", "El negocio no está habilitado para operar.");
  }
  const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
  const services = serviceSnapshot.docs.map((doc) => assertService(doc, context.businessId, orderRef.id, HttpsError));
  if (services.reduce((count, service) => count + 1 + (service.productos?.length || 0), 0) > 200) {
    fail(HttpsError, "failed-precondition", "El alcance supera el límite técnico de 200 líneas por envío.");
  }
  const result = {order, services, membership, businessData,
    hasDiagnosis: diagnoses.docs.some((doc) => doc.data().negocioId === context.businessId && doc.data().otId === orderRef.id)};
  // Reading frozen history must not depend on a later catalog edit or archival.
  if (inventoryMode === "skip" || (inventoryMode === "preview" && approvalIsSubmitted(order))) {
    return {...result, items: new Map(), faltantes: null};
  }
  const ids = new Set();
  services.forEach((service) => {
    ids.add(identifier(service.itemId, "El servicio de Inventario", HttpsError));
    (service.productos || []).forEach((product) => {
      ids.add(identifier(product.itemId, "El producto de Inventario", HttpsError));
      plannedQuantity(product.cantidad, HttpsError);
    });
  });
  const itemSnapshots = await Promise.all([...ids].map((id) => transaction.get(context.businessRef.collection("inventario").doc(id))));
  const items = new Map(itemSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  services.forEach((service) => assertPlanningItem(items.get(service.itemId), context.businessId, service.itemId, "servicio", HttpsError));
  const required = new Map();
  services.forEach((service) => (service.productos || []).forEach((product) =>
    required.set(product.itemId, (required.get(product.itemId) || 0) + product.cantidad)));
  const faltantes = [];
  for (const [itemId, cantidad] of required) {
    const snapshot = items.get(itemId);
    assertPlanningItem(snapshot, context.businessId, itemId, "producto", HttpsError);
    const item = snapshot.data();
    if (typeof item.stock !== "number" || !Number.isFinite(item.stock) || item.stock < 0) {
      fail(HttpsError, "failed-precondition", "Un producto no tiene stock válido en Inventario.");
    }
    if (item.stock < cantidad) faltantes.push({itemId, nombre: String(item.nombre || item.descripcionItem || itemId), cantidad, stock: item.stock});
  }
  // A shared OT write serializes scope changes with approval; all reads precede writes.
  return {...result, items, faltantes};
}

function frozenScope(services) {
  return services.map(({servicioOtId, itemId, precioUnitario, servicioSnapshot, productos}) => ({
    servicioOtId, itemId, precioUnitario: precioUnitario ?? null,
    servicioSnapshot: servicioSnapshot || null, productos: productos || [],
  }));
}

function approvalIsSubmitted(order) {
  return ["esperando_aprobacion", "esperando_repuestos", "en_reparacion", "pendiente_entrega", "cerrada"].includes(order.estado);
}

async function obtenerResumenAprobacionOTHandler(request, dependencies) {
  const context = await requireTallerAccess(request, dependencies, "read");
  const otId = identifier(request?.data?.otId, "La OT", dependencies.HttpsError);
  return dependencies.db.runTransaction(async (transaction) => {
    const data = await readApprovalContext(transaction, context, context.businessRef.collection("ordenesTrabajo").doc(otId), dependencies, "preview");
    const {order, services, items, membership, faltantes} = data;
    const submitted = approvalIsSubmitted(order);
    const summaryCurrency = order.moneda || businessCurrency({businessSnapshot: {data: () => data.businessData}});
    const decimals = workOrderAmountDecimals(order, summaryCurrency);
    const scope = frozenScope(services).map((service) => {
      if (submitted) return service;
      const core = freezeCoreItem(items.get(service.itemId), context.businessId, service.itemId, "servicio", dependencies.HttpsError, decimals);
      return {...service, precioUnitario: core.precioUnitario, servicioSnapshot: core.snapshot,
        productos: service.productos.map((product) => {
          const coreProduct = freezeCoreItem(items.get(product.itemId), context.businessId, product.itemId, "producto", dependencies.HttpsError, decimals);
          return {...product, precioUnitario: coreProduct.precioUnitario, productoSnapshot: coreProduct.snapshot};
        })};
    });
    return {alcance: scope, moneda: summaryCurrency,
      ...(decimals > 0 ? {montoDecimales: decimals} : {}),
      congelado: submitted, faltantes, puedeAprobar: canApproveWorkOrder(membership),
      puedeEnviar: false,
      puedeDecidir: Boolean(order.recepcion && ["en_cola", "en_diagnostico"].includes(order.estado) &&
        order.estadoAprobacion !== "aprobada"),
      fotosFaltantes: missingReceptionPhotoZones(order),
      danosPrevios: receptionPhotoDamages(order),
      estado: order.estado, estadoAprobacion: order.estadoAprobacion,
      revision: order.actualizadoEn?.toMillis?.()};
  });
}

async function approvalOperation(request, dependencies, action) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireReceptionAccess(request, dependencies);
  const allowed = new Set(["businessId", "otId", "requestId", "expectedActualizadoEn", "motivo", "responsableUid"]);
  if (Object.keys(request?.data || {}).some((key) => !allowed.has(key))) {
    fail(HttpsError, "invalid-argument", "La solicitud contiene campos no permitidos. El alcance y los precios se resuelven en backend.");
  }
  const otId = identifier(request?.data?.otId, "La OT", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  // Rechazar un alcance exige dejar el motivo; en las demás acciones es opcional.
  const motivo = action === "rechazar"
    ? text(request?.data?.motivo, "El motivo del rechazo", 2000, HttpsError, {required: true})
    : text(request?.data?.motivo, "El motivo", 2000, HttpsError);
  // Solo Owner y Administrador deciden el ingreso; se comprueba antes de validar el resto de los datos.
  if (!canApproveWorkOrder(context.membership)) {
    fail(HttpsError, "permission-denied", "No tienes la capacidad de aprobación de Taller.");
  }
  // Al aprobar se elige quién responde por los trabajos de la OT; al rechazar no se asigna a nadie.
  if (action === "rechazar" && request?.data?.responsableUid !== undefined) {
    fail(HttpsError, "invalid-argument", "Rechazar el ingreso no asigna un responsable.");
  }
  const responsableUid = action === "aprobar"
    ? identifier(request?.data?.responsableUid, "El responsable de la OT", HttpsError) : null;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const requestRef = context.businessRef.collection("otApprovalRequests").doc(requestId);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const fingerprint = createHash("sha256").update(JSON.stringify({otId, action, motivo, actor: context.uid,
    revision: request?.data?.expectedActualizadoEn, ...(responsableUid ? {responsableUid} : {})})).digest("hex");
  if (action === "enviar" || action === "revalidar") {
    fail(HttpsError, "failed-precondition", "El ingreso se aprueba o rechaza directamente; los trabajos se registran en la ejecución.");
  }
  const responsibleUser = responsableUid ? await dependencies.auth.getUser(responsableUid) : null;
  if (responsibleUser?.disabled) fail(HttpsError, "failed-precondition", "El responsable seleccionado está deshabilitado.");
  const responsibleIdentity = responsableUid ? await diagnosisActor(dependencies, responsableUid) : null;
  const responsibleRef = responsableUid ? db.collection("membresias").doc(`${context.businessId}__${responsableUid}`) : null;
  return db.runTransaction(async (transaction) => {
    const previousDecision = await transaction.get(requestRef);
    const gate = await readApprovalContext(transaction, context, orderRef, dependencies, "skip");
    const responsibleSnapshot = responsibleRef ? await transaction.get(responsibleRef) : null;
    if (!canApproveWorkOrder(gate.membership)) {
      fail(HttpsError, "permission-denied", "No tienes la capacidad de aprobación de Taller.");
    }
    if (previousDecision.exists) {
      if (previousDecision.data().fingerprint !== fingerprint) fail(HttpsError, "already-exists", "La solicitud ya fue utilizada con otros datos.");
      return {...previousDecision.data().resultado, sinCambios: true};
    }
    const gateOrder = gate.order;
    assertDiagnosisRevision(gateOrder, request?.data?.expectedActualizadoEn, HttpsError, "orden de trabajo");
    if (!gateOrder.recepcion || !["en_cola", "en_diagnostico"].includes(gateOrder.estado) ||
        gateOrder.estadoAprobacion === "aprobada") {
      fail(HttpsError, "failed-precondition", "La OT debe tener la recepción registrada y estar pendiente de aprobación.");
    }
    if (responsibleSnapshot) assertAssignableMember(responsibleSnapshot, context.businessId, responsableUid, HttpsError);
    // Las fotos se exigen al registrar la recepción; aquí se revalidan (OT anteriores). Rechazar no las exige.
    const missingPhotos = action === "aprobar" ? missingReceptionPhotoZones(gateOrder) : [];
    if (missingPhotos.length) {
      fail(HttpsError, "failed-precondition",
        `Faltan fotos de recepción: ${missingPhotos.join(", ")}. Complétalas antes de aprobar el ingreso.`);
    }
    // Al aprobar sin Plaza se busca la primera libre; si todas están ocupadas, la OT queda en espera.
    // El negocio debe tener al menos una Plaza activa para aprobar ingresos.
    const freePlaza = action === "aprobar" && !gateOrder.plazaId
      ? await readFreePlaza(transaction, context.businessRef, context.businessId)
      : null;
    if (freePlaza && !freePlaza.hasActivePlazas) {
      fail(HttpsError, "failed-precondition", "Crea al menos una Plaza activa en Taller > Plazas antes de aprobar el ingreso.");
    }
    const assignedPlazaId = freePlaza?.plazaId || null;
    const waitsForPlaza = Boolean(freePlaza && !assignedPlazaId);
    const decidedEstado = action === "aprobar" ? (waitsForPlaza ? "en_cola" : "en_reparacion") : gateOrder.estado;
    const decidedAprobacion = action === "aprobar" ? "aprobada" : "rechazada";
    const decidedAt = FieldValue.serverTimestamp();
    transaction.update(orderRef, {estado: decidedEstado, estadoAprobacion: decidedAprobacion,
      ...(action === "aprobar" ? {aprobadaEn: decidedAt, responsableUid, responsableNombre: responsibleIdentity.nombre,
        motivoRechazo: null} : {motivoRechazo: motivo}),
      ...(assignedPlazaId ? {plazaId: assignedPlazaId} : {}),
      actualizadoEn: decidedAt, actualizadoPorUid: context.uid});
    if (assignedPlazaId) {
      transaction.set(freePlaza.lockRef, {negocioId: context.businessId, plazaId: assignedPlazaId, otId});
    }
    appendPlanningEvent(transaction, orderRef, {businessId: context.businessId, actorUid: context.uid, actorSnapshot,
      timestamp: decidedAt, type: action === "aprobar" ? "ot_aprobada" : "ot_rechazada",
      detail: {motivo, estadoAnterior: gateOrder.estado, estado: decidedEstado,
        aprobacionAnterior: gateOrder.estadoAprobacion, estadoAprobacion: decidedAprobacion,
        ...(action === "aprobar" ? {enEsperaDePlaza: waitsForPlaza, responsableNombre: responsibleIdentity.nombre} : {})}});
    if (assignedPlazaId) {
      appendPlanningEvent(transaction, orderRef, {businessId: context.businessId, actorUid: context.uid, actorSnapshot,
        timestamp: decidedAt, type: "plaza_asignada",
        detail: automaticAssignmentDetail(assignedPlazaId, gateOrder.estado, "aprobacion")});
    }
    const decision = {otId, estado: decidedEstado, estadoAprobacion: decidedAprobacion,
      ...(responsableUid ? {responsableUid} : {}),
      plazaId: assignedPlazaId || gateOrder.plazaId || null, enEsperaDePlaza: waitsForPlaza,
      faltantes: [], envioId: null};
    transaction.create(requestRef, {negocioId: context.businessId, otId, fingerprint, resultado: decision, creadoEn: decidedAt});
    return decision;
  });
}

const enviarOTAprobacionHandler = (request, deps) => approvalOperation(request, deps, "enviar");
const aprobarOTHandler = (request, deps) => approvalOperation(request, deps, "aprobar");
const rechazarOTHandler = (request, deps) => approvalOperation(request, deps, "rechazar");
const revalidarDisponibilidadOTHandler = (request, deps) => approvalOperation(request, deps, "revalidar");

module.exports = {
  MAX_RECEPTION_MILEAGE_KM,
  workOrderAmountDecimals,
  appendPlanningEvent,
  diagnosisActor,
  identifier,
  readApprovalContext,
  requestIdentifier,
  requireReceptionAccess,
  iniciarServicioOTHandler, completarServicioOTHandler, reabrirServicioOTHandler, definirRepuestosServicioOTHandler,
  assertWorkOperator, canOperateWorks,
  assertPlanningOrder, assertPlanningItem, invalidateWorkOrderScope, assertStoredWorkOrder, text,
  finalizarReparacionOTHandler, registrarEntregaOTHandler, cancelarOTHandler,
  obtenerEventosCierreOTHandler, obtenerHistorialOTHandler,
  enviarOTAprobacionHandler, aprobarOTHandler, rechazarOTHandler, revalidarDisponibilidadOTHandler,
  obtenerResumenAprobacionOTHandler, scopeFingerprint, canApproveWorkOrder, freezeCoreItem,
  actualizarProductoOTHandler,
  actualizarServicioOTHandler,
  agregarProductoOTHandler,
  actualizarDiagnosticoHandler,
  completarDiagnosticoHandler,
  crearOrdenTrabajoHandler,
  crearServicioOTHandler,
  eliminarServicioOTHandler,
  eliminarProductoOTHandler,
  listarCatalogoTallerHandler,
  formatWorkOrderNumber,
  listarPersonasAsignablesTallerHandler,
  normalizeDiagnosisInput,
  normalizeWorkOrderInput,
  normalizeReceptionInput,
  normalizeServiceInput,
  plannedQuantity,
  profileIdentityName,
  receptionNextStatus,
  registrarRecepcionOrdenTrabajoHandler,
  registrarDiagnosticoHandler,
};
