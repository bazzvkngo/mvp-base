const {createHash} = require("node:crypto");

const WORK_MODEL_VERSION = 2;
const WORK_FILE_MODEL_VERSION = 1;
const WORK_TASK_MODEL_VERSION = 2;
const WORK_EXPENSE_MODEL_VERSION = 1;
const WORK_LABOR_MODEL_VERSION = 1;
const WORK_MATERIAL_MODEL_VERSION = 1;
const WRITE_ROLES = ["OWNER", "ADMIN"];
const WORK_STATUSES = new Set(["pendiente", "en_progreso", "en_espera", "completado", "cancelado"]);
const WORK_PRIORITIES = new Set(["baja", "normal", "alta", "urgente"]);
const WORK_EXPENSE_CATEGORIES = new Set(["MATERIAL", "MANO_DE_OBRA", "OPERATIVO", "SERVICIO_EXTERNO", "ADMINISTRATIVO", "OTRO"]);
const WORK_INPUT_FIELDS = new Set(["titulo", "descripcion", "clienteId", "responsableUid", "participanteUids", "estado", "prioridad", "fechaInicio", "fechaPrevista"]);

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function text(value, label, maxLength, HttpsError, {required = false} = {}) {
  if (value == null) value = "";
  if (typeof value !== "string") fail(HttpsError, "invalid-argument", `${label} debe ser texto.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (required && !normalized) fail(HttpsError, "invalid-argument", `${label} es obligatorio.`);
  if (normalized.length > maxLength) fail(HttpsError, "invalid-argument", `${label} no puede superar ${maxLength} caracteres.`);
  return normalized;
}

function identifier(value, label, HttpsError, {optional = false} = {}) {
  const normalized = text(value, label, 160, HttpsError);
  if (optional && !normalized) return "";
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) fail(HttpsError, "invalid-argument", `${label} no es válido.`);
  return normalized;
}

function requestIdentifier(value, HttpsError) {
  const normalized = text(value, "La solicitud", 120, HttpsError);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(normalized)) fail(HttpsError, "invalid-argument", "No se pudo validar la solicitud.");
  return normalized;
}

function optionalDate(value, label, HttpsError) {
  const normalized = text(value, label, 10, HttpsError);
  if (!normalized) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T12:00:00Z`).getTime())) {
    fail(HttpsError, "invalid-argument", `${label} no es válida.`);
  }
  return normalized;
}

function normalizeWorkInput(raw = {}, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(HttpsError, "invalid-argument", "Los datos del trabajo deben enviarse como objeto.");
  const unknown = Object.keys(raw).find((field) => !WORK_INPUT_FIELDS.has(field));
  if (unknown) fail(HttpsError, "invalid-argument", `El campo ${unknown} no está admitido.`);
  const estado = text(raw.estado || "pendiente", "El estado", 30, HttpsError).toLowerCase();
  const prioridad = text(raw.prioridad || "normal", "La prioridad", 20, HttpsError).toLowerCase();
  if (!WORK_STATUSES.has(estado)) fail(HttpsError, "invalid-argument", "Selecciona un estado válido.");
  if (!WORK_PRIORITIES.has(prioridad)) fail(HttpsError, "invalid-argument", "Selecciona una prioridad válida.");
  const responsableUid = identifier(raw.responsableUid, "El responsable", HttpsError, {optional: true});
  if (raw.participanteUids != null && !Array.isArray(raw.participanteUids)) fail(HttpsError, "invalid-argument", "Los participantes deben enviarse como una lista.");
  const participanteUids = [...new Set((raw.participanteUids || []).map((uid) => identifier(uid, "El participante", HttpsError)))].filter((uid) => uid !== responsableUid);
  if (participanteUids.length > 30) fail(HttpsError, "invalid-argument", "Un trabajo admite hasta 30 participantes.");
  return {
    titulo: text(raw.titulo, "El título", 180, HttpsError, {required: true}),
    descripcion: text(raw.descripcion, "La descripción", 5000, HttpsError),
    clienteId: identifier(raw.clienteId, "El cliente", HttpsError, {optional: true}),
    responsableUid,
    participanteUids,
    estado,
    prioridad,
    fechaInicio: optionalDate(raw.fechaInicio, "La fecha de inicio", HttpsError),
    fechaPrevista: optionalDate(raw.fechaPrevista, "La fecha prevista", HttpsError),
  };
}

function chileYear(date) {
  return Number(new Intl.DateTimeFormat("en-CA", {timeZone: "America/Santiago", year: "numeric"}).format(date));
}

function formatWorkNumber(year, sequence) {
  return `TRB-${year}-${String(sequence).padStart(4, "0")}`;
}

function membershipId(businessId, uid) {
  return `${businessId}__${uid}`;
}

function assertActiveMember(snapshot, businessId, uid, HttpsError) {
  const member = snapshot.data() || {};
  if (!snapshot.exists || snapshot.id !== membershipId(businessId, uid) || member.negocioId !== businessId || member.uid !== uid || member.estado !== "activo") {
    fail(HttpsError, "failed-precondition", "Una persona asignada ya no tiene acceso activo al negocio.");
  }
}

function assertWork(snapshot, businessId, HttpsError) {
  const stored = snapshot.data() || {};
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró el trabajo.");
  if (stored.negocioId !== businessId) fail(HttpsError, "permission-denied", "El trabajo no pertenece al negocio.");
  return stored;
}

function linkedWorkFields(snapshot, businessId, HttpsError) {
  const work = assertWork(snapshot, businessId, HttpsError);
  return {
    trabajoId: snapshot.id,
    trabajoNumero: text(work.numero, "El número del trabajo", 120, HttpsError),
    trabajoTitulo: text(work.titulo, "El título del trabajo", 180, HttpsError),
  };
}

function assertTaskMutable(work, HttpsError) {
  if (["completado", "cancelado"].includes(work.estado)) fail(HttpsError, "failed-precondition", "Reabre el trabajo antes de modificar sus tareas.");
}

function normalizeTaskInput(raw = {}, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(HttpsError, "invalid-argument", "Los datos de la tarea deben enviarse como objeto.");
  return {
    titulo: text(raw.titulo, "El título de la tarea", 240, HttpsError, {required: true}),
    descripcion: text(raw.descripcion, "La descripción de la tarea", 4000, HttpsError),
    responsableUid: identifier(raw.responsableUid, "El responsable de la tarea", HttpsError, {optional: true}),
  };
}

function assertTask(snapshot, businessId, workId, HttpsError) {
  const task = snapshot.data() || {};
  if (!snapshot.exists || task.negocioId !== businessId || task.trabajoId !== workId) fail(HttpsError, "not-found", "No se encontró la tarea.");
  return task;
}

function taskIsCompleted(task) {
  return task.estado === "completada" || task.completada === true;
}

function assertTaskOperator(task, context, HttpsError) {
  if (WRITE_ROLES.includes(context.membership?.rol)) return;
  if (context.membership?.rol !== "MEMBER" || String(task.responsableUid || "") !== context.uid) {
    fail(HttpsError, "permission-denied", "Sólo la persona asignada puede actualizar esta tarea.");
  }
}

function previousTaskRequest(snapshot, {fingerprint: expectedFingerprint, operation, uid}, HttpsError) {
  if (!snapshot.exists) return null;
  const stored = snapshot.data() || {};
  if (stored.uidUsuario !== uid || stored.operacion !== operation || stored.fingerprint !== expectedFingerprint) {
    fail(HttpsError, "already-exists", "La solicitud ya fue utilizada para otra operación.");
  }
  return {...(stored.resultado || {}), idempotent: true};
}

function taskRequestPayload({businessId, fingerprint: value, operation, result, timestamp, uid, workId, taskId}) {
  return {negocioId: businessId, trabajoId: workId, tareaId: taskId, operacion: operation, fingerprint: value, uidUsuario: uid, resultado: result, creadoEn: timestamp};
}

function positiveDecimal(value, label, max, HttpsError) {
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
  if ((typeof normalized !== "string" && typeof normalized !== "number") || !/^\d+(\.\d{1,2})?$/.test(String(normalized))) {
    fail(HttpsError, "invalid-argument", `${label} debe ser un número positivo con hasta dos decimales.`);
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0 || number > max) fail(HttpsError, "invalid-argument", `${label} está fuera del rango permitido.`);
  return Math.round(number * 100) / 100;
}

function requiredDate(value, label, HttpsError) {
  const normalized = optionalDate(value, label, HttpsError);
  if (!normalized) fail(HttpsError, "invalid-argument", `${label} es obligatoria.`);
  return normalized;
}

function normalizeExpenseInput(raw = {}, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(HttpsError, "invalid-argument", "Los datos del gasto deben enviarse como objeto.");
  const categoria = text(raw.categoria, "La categoría", 40, HttpsError, {required: true}).toUpperCase();
  if (!WORK_EXPENSE_CATEGORIES.has(categoria)) fail(HttpsError, "invalid-argument", "Selecciona una categoría de gasto válida.");
  return {
    concepto: text(raw.concepto, "El concepto", 240, HttpsError, {required: true}),
    monto: positiveDecimal(raw.monto, "El monto", 999999999999.99, HttpsError),
    categoria,
    responsableDelGastoUid: identifier(raw.responsableDelGastoUid, "El responsable del gasto", HttpsError, {optional: true}),
    fecha: requiredDate(raw.fecha, "La fecha", HttpsError),
    observacion: text(raw.observacion, "La observación", 4000, HttpsError),
  };
}

function normalizeLaborInput(raw = {}, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(HttpsError, "invalid-argument", "Los datos de HH deben enviarse como objeto.");
  return {
    tecnicoUid: identifier(raw.tecnicoUid, "El técnico", HttpsError, {optional: true}),
    horas: positiveDecimal(raw.horas, "Las horas", 1000, HttpsError),
    costoHora: positiveDecimal(raw.costoHora, "El costo por hora", 999999999999.99, HttpsError),
    fecha: requiredDate(raw.fecha, "La fecha", HttpsError),
    concepto: text(raw.concepto, "El concepto", 240, HttpsError, {required: true}),
  };
}

function expenseClassification(category) {
  return category === "ADMINISTRATIVO" ? "INDIRECTO" : "DIRECTO";
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function authoritativeInventoryCost(item, HttpsError) {
  const candidates = [
    ["costoPromedio", item.costoPromedio],
    ["costoBase", item.costoBase],
    ["costo", item.costo],
    ["precioCompra", item.precioCompra],
  ];
  const selected = candidates.find(([, value]) => value !== "" && value != null && Number.isFinite(Number(value)) && Number(value) >= 0);
  if (!selected) fail(HttpsError, "failed-precondition", "El producto no tiene un costo vigente v\u00e1lido.");
  return {costoUnitario: roundMoney(Number(selected[1])), costoFuente: selected[0]};
}

function assertInventoryProduct(snapshot, businessId, HttpsError, {requireActive = false} = {}) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontr\u00f3 el producto de inventario.");
  const item = snapshot.data() || {};
  if (item.negocioId !== businessId) fail(HttpsError, "permission-denied", "El producto no pertenece al negocio.");
  if (String(item.tipoItem || "").toLowerCase() !== "producto") fail(HttpsError, "failed-precondition", "S\u00f3lo los productos pueden mover stock.");
  if (requireActive && item.estado !== "activo") fail(HttpsError, "failed-precondition", "Selecciona un producto activo.");
  const stock = Number(item.stock);
  if (!Number.isFinite(stock) || stock < 0) fail(HttpsError, "failed-precondition", "El producto no tiene stock v\u00e1lido.");
  return {...item, stock};
}

function productSnapshot(item, itemId) {
  return {
    itemId,
    codigoInterno: String(item.codigoInterno || "").trim(),
    nombre: String(item.nombre || "Producto sin nombre").trim(),
    unidad: String(item.unidad || item.unidadStock || "unidad").trim(),
  };
}

function memberLinkedUid(context, proposedUid, label, HttpsError, {required = false} = {}) {
  if (context.membership?.rol === "MEMBER") {
    if (proposedUid && proposedUid !== context.uid) fail(HttpsError, "permission-denied", `${label} debe corresponder a tu propia membresía.`);
    return context.uid;
  }
  if (required && !proposedUid) fail(HttpsError, "invalid-argument", `${label} es obligatorio.`);
  return proposedUid;
}

function workCurrency(work, business, HttpsError) {
  const currency = String(work.moneda || business.monedaCodigo || business.moneda || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail(HttpsError, "failed-precondition", "El negocio no tiene una moneda válida configurada.");
  return currency;
}

function previousCostRequest(snapshot, {fingerprint: expectedFingerprint, operation, uid}, HttpsError) {
  if (!snapshot.exists) return null;
  const stored = snapshot.data() || {};
  if (stored.uidUsuario !== uid || stored.operacion !== operation || stored.fingerprint !== expectedFingerprint) fail(HttpsError, "already-exists", "La solicitud ya fue utilizada para otra operación.");
  return {...(stored.resultado || {}), idempotent: true};
}

function costRequestPayload({businessId, fingerprint: value, operation, result, timestamp, uid, workId, recordId}) {
  return {negocioId: businessId, trabajoId: workId, registroId: recordId, operacion: operation, fingerprint: value, uidUsuario: uid, resultado: result, creadoEn: timestamp};
}

function clientSnapshot(snapshot, businessId, HttpsError) {
  if (!snapshot?.exists) fail(HttpsError, "not-found", "No se encontró el cliente seleccionado.");
  const client = snapshot.data() || {};
  if (client.negocioId !== businessId || client.estado !== "activo") fail(HttpsError, "failed-precondition", "Selecciona un cliente activo del negocio.");
  return {
    nombreRazonSocial: text(client.nombreRazonSocial, "El nombre del cliente", 240, HttpsError, {required: true}),
    rut: text(client.rut, "El identificador del cliente", 30, HttpsError),
    email: text(client.email, "El correo del cliente", 240, HttpsError),
    telefono: text(client.telefono, "El teléfono del cliente", 100, HttpsError),
    personaContacto: text(client.personaContacto, "El contacto del cliente", 200, HttpsError),
  };
}

function profileName(profile, authUser) {
  return [profile?.nombres, profile?.apellidos].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || String(authUser?.displayName || "").trim() || "Sin nombre registrado";
}

async function defaultResolveUserSnapshots(db, auth, uids) {
  const unique = [...new Set(uids.filter(Boolean))];
  if (!unique.length) return new Map();
  const authResult = await auth.getUsers(unique.map((uid) => ({uid})));
  const users = new Map(authResult.users.map((user) => [user.uid, user]));
  const refs = unique.map((uid) => db.collection("usuarios").doc(uid).collection("cuenta").doc("perfil"));
  const profiles = await db.getAll(...refs);
  return new Map(unique.map((uid, index) => [uid, {uid, nombre: profileName(profiles[index]?.data() || {}, users.get(uid)), correo: String(users.get(uid)?.email || "").trim()}]));
}

async function userSnapshots(dependencies, uids) {
  return dependencies.resolveUserSnapshots
    ? dependencies.resolveUserSnapshots([...new Set(uids.filter(Boolean))])
    : defaultResolveUserSnapshots(dependencies.db, dependencies.auth, uids);
}

function publicPerson(snapshot, uid) {
  const value = snapshot.get(uid) || {};
  return {uid, nombre: String(value.nombre || "Sin nombre registrado"), correo: String(value.correo || "")};
}

function eventPayload({eventRef, businessId, workId, type, actorUid, actor, detail, timestamp}) {
  return {eventoId: eventRef.id, negocioId: businessId, trabajoId: workId, tipo: type, fecha: timestamp, actorUid, actorSnapshot: {nombre: actor.nombre, correo: actor.correo}, detalle: detail || {}};
}

function writeEvent(transaction, workRef, data) {
  const eventRef = workRef.collection("historial").doc();
  transaction.set(eventRef, eventPayload({...data, eventRef, workId: workRef.id}));
}

function commercialActor(actor = {}) {
  return {
    nombre: String(actor.nombre || "Persona del equipo").trim(),
    correo: String(actor.correo || "").trim(),
  };
}

function writeCommercialLink(transaction, workRef, {
  actor = {},
  actorUid = "",
  businessId,
  currentCount = 0,
  documentId,
  documentNumber = "",
  documentStatus = "borrador",
  documentType,
  extra = {},
  timestamp,
  total = 0,
}) {
  const isQuote = documentType === "cotizacion";
  const prefix = isQuote ? "cotizacion" : "venta";
  const counterField = isQuote ? "cotizacionesVinculadas" : "ventasVinculadas";
  const linkRef = workRef.collection("vinculos").doc(`${prefix}__${documentId}`);
  const eventRef = workRef.collection("historial")
    .doc(`${prefix}_vinculada__${documentId}`);
  const workId = workRef.id;
  const common = {
    negocioId: businessId,
    trabajoId: workId,
    tipoDocumento: documentType,
    documentoId: documentId,
    numero: String(documentNumber || "").trim(),
    estadoAlVincular: String(documentStatus || "").trim(),
    total: Number(total || 0),
    creadoPorUid: String(actorUid || "").trim(),
    creadoEn: timestamp,
  };
  transaction.create(linkRef, {
    vinculoId: linkRef.id,
    ...common,
    ...(isQuote
      ? {cotizacionId: documentId, cotizacionNumero: common.numero}
      : {ventaId: documentId, ventaNumero: common.numero}),
    ...extra,
  });
  transaction.create(eventRef, eventPayload({
    eventRef,
    businessId,
    workId,
    type: `${prefix}_vinculada`,
    actorUid: String(actorUid || "").trim(),
    actor: commercialActor(actor),
    detail: {
      documentoId: documentId,
      numero: common.numero,
      estado: common.estadoAlVincular,
      total: common.total,
      ...extra,
    },
    timestamp,
  }));
  transaction.update(workRef, {
    modeloTrabajoVersion: WORK_MODEL_VERSION,
    modeloExpedienteVersion: WORK_FILE_MODEL_VERSION,
    [counterField]: Number(currentCount || 0) + 1,
    actualizadoEn: timestamp,
  });
}

function writeQuoteResponseEvent(transaction, workRef, {
  actor = {},
  actorUid = "",
  businessId,
  eventKey,
  quoteId,
  quoteNumber = "",
  response,
  detail = {},
  timestamp,
}) {
  const eventRef = workRef.collection("historial")
    .doc(`cotizacion_respuesta__${quoteId}__${eventKey}`);
  transaction.create(eventRef, eventPayload({
    eventRef,
    businessId,
    workId: workRef.id,
    type: "cotizacion_respuesta",
    actorUid: String(actorUid || "").trim(),
    actor: commercialActor(actor),
    detail: {
      cotizacionId: quoteId,
      cotizacionNumero: String(quoteNumber || "").trim(),
      respuesta: String(response || "").trim(),
      ...detail,
    },
    timestamp,
  }));
  transaction.update(workRef, {
    modeloTrabajoVersion: WORK_MODEL_VERSION,
    modeloExpedienteVersion: WORK_FILE_MODEL_VERSION,
    actualizadoEn: timestamp,
  });
}

function writeSaleConfirmationEvent(transaction, workRef, {
  actor = {},
  actorUid = "",
  businessId,
  currency = "",
  quoteNumber = "",
  saleId,
  saleNumber = "",
  timestamp,
  total = 0,
}) {
  const eventRef = workRef.collection("historial").doc(`venta_confirmada__${saleId}`);
  transaction.create(eventRef, eventPayload({
    eventRef,
    businessId,
    workId: workRef.id,
    type: "venta_confirmada",
    actorUid: String(actorUid || "").trim(),
    actor: commercialActor(actor),
    detail: {
      ventaId: saleId,
      numero: String(saleNumber || "").trim(),
      cotizacionNumero: String(quoteNumber || "").trim(),
      total: Number(total || 0),
      moneda: String(currency || "").trim().toUpperCase(),
    },
    timestamp,
  }));
  transaction.update(workRef, {modeloTrabajoVersion: WORK_MODEL_VERSION, actualizadoEn: timestamp});
}

async function requireWriteAccess(request, dependencies) {
  return dependencies.requireBusinessAccess(request, {db: dependencies.db, HttpsError: dependencies.HttpsError}, {roles: WRITE_ROLES});
}

function fingerprint(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function readAssignments(transaction, db, businessId, uids, HttpsError) {
  const refs = [...new Set(uids.filter(Boolean))].map((uid) => db.collection("membresias").doc(membershipId(businessId, uid)));
  const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
  snapshots.forEach((snapshot, index) => assertActiveMember(snapshot, businessId, refs[index].id.slice(businessId.length + 2), HttpsError));
}

async function crearTrabajoHandler(request, dependencies, now = new Date()) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const input = normalizeWorkInput(request?.data?.trabajo || {}, HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const people = await userSnapshots(dependencies, [context.uid, input.responsableUid, ...input.participanteUids]);
  const actor = publicPerson(people, context.uid);
  const year = chileYear(now);
  const workRef = context.businessRef.collection("trabajos").doc();
  const counterRef = context.businessRef.collection("workCounters").doc(String(year));
  const requestRef = context.businessRef.collection("workCreateRequests").doc(requestId);
  const clientRef = input.clienteId ? context.businessRef.collection("clientes").doc(input.clienteId) : null;
  const inputFingerprint = fingerprint(input);

  return db.runTransaction(async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists) {
      const existing = requestSnapshot.data() || {};
      if (existing.creadoPorUid !== context.uid || existing.fingerprint !== inputFingerprint) fail(HttpsError, "already-exists", "La solicitud ya fue usada con otros datos.");
      return {trabajoId: existing.trabajoId, numero: existing.numero, sinCambios: true};
    }
    const counterSnapshot = await transaction.get(counterRef);
    const selectedClient = clientRef ? clientSnapshot(await transaction.get(clientRef), context.businessId, HttpsError) : null;
    await readAssignments(transaction, db, context.businessId, [input.responsableUid, ...input.participanteUids], HttpsError);
    const current = Number(counterSnapshot.data()?.ultimoNumero || 0);
    const sequence = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatWorkNumber(year, sequence);
    const timestamp = FieldValue.serverTimestamp();
    const stored = {
      modeloTrabajoVersion: WORK_MODEL_VERSION,
      trabajoId: workRef.id,
      negocioId: context.businessId,
      numero,
      anio: year,
      correlativo: sequence,
      ...input,
      ...(input.clienteId ? {clienteSnapshot: selectedClient} : {}),
      ...(input.responsableUid ? {responsableSnapshot: publicPerson(people, input.responsableUid)} : {}),
      participantesSnapshot: input.participanteUids.map((uid) => publicPerson(people, uid)),
      fechaCompletado: input.estado === "completado" ? timestamp : null,
      tareasTotal: 0,
      tareasCompletadas: 0,
      modeloExpedienteVersion: WORK_FILE_MODEL_VERSION,
      cotizacionesVinculadas: 0,
      ventasVinculadas: 0,
      gastosVigentesTotal: 0,
      gastosMontoTotal: 0,
      gastosMontoDirecto: 0,
      gastosMontoIndirecto: 0,
      horasHombreVigentesTotal: 0,
      horasHombreCantidadTotal: 0,
      horasHombreCostoTotal: 0,
      materialesSalidasTotal: 0,
      materialesDevolucionesTotal: 0,
      materialesCostoTotal: 0,
      creadoPorUid: context.uid,
      actualizadoPorUid: context.uid,
      creadoEn: timestamp,
      actualizadoEn: timestamp,
    };
    transaction.create(workRef, stored);
    transaction.set(counterRef, {negocioId: context.businessId, anio: year, ultimoNumero: sequence, actualizadoEn: timestamp}, {merge: true});
    transaction.create(requestRef, {negocioId: context.businessId, trabajoId: workRef.id, numero, fingerprint: inputFingerprint, creadoPorUid: context.uid, creadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "trabajo_creado", actorUid: context.uid, actor, detail: {numero, estado: input.estado}, timestamp});
    if (input.estado === "completado") writeEvent(transaction, workRef, {businessId: context.businessId, type: "trabajo_completado", actorUid: context.uid, actor, timestamp});
    if (input.estado === "cancelado") writeEvent(transaction, workRef, {businessId: context.businessId, type: "trabajo_cancelado", actorUid: context.uid, actor, timestamp});
    return {trabajoId: workRef.id, numero, sinCambios: false};
  });
}

function stateEvent(previous, next) {
  if (next === "completado") return "trabajo_completado";
  if (next === "cancelado") return "trabajo_cancelado";
  if (["completado", "cancelado"].includes(previous)) return "trabajo_reabierto";
  return "estado_cambiado";
}

async function actualizarTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const input = normalizeWorkInput(request?.data?.trabajo || {}, HttpsError);
  const people = await userSnapshots(dependencies, [context.uid, input.responsableUid, ...input.participanteUids]);
  const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId);
  const clientRef = input.clienteId ? context.businessRef.collection("clientes").doc(input.clienteId) : null;

  await db.runTransaction(async (transaction) => {
    const stored = assertWork(await transaction.get(workRef), context.businessId, HttpsError);
    let selectedClient = stored.clienteSnapshot || null;
    if (input.clienteId !== String(stored.clienteId || "")) selectedClient = clientRef ? clientSnapshot(await transaction.get(clientRef), context.businessId, HttpsError) : null;
    await readAssignments(transaction, db, context.businessId, [input.responsableUid, ...input.participanteUids], HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    const next = {
      ...input,
      clienteSnapshot: selectedClient,
      responsableSnapshot: input.responsableUid ? publicPerson(people, input.responsableUid) : null,
      participantesSnapshot: input.participanteUids.map((uid) => publicPerson(people, uid)),
      fechaCompletado: input.estado === "completado" ? stored.fechaCompletado || timestamp : null,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    };
    transaction.update(workRef, next);
    if (stored.estado !== input.estado) writeEvent(transaction, workRef, {businessId: context.businessId, type: stateEvent(stored.estado, input.estado), actorUid: context.uid, actor, detail: {estadoAnterior: stored.estado, estadoNuevo: input.estado}, timestamp});
    if (String(stored.responsableUid || "") !== input.responsableUid) writeEvent(transaction, workRef, {businessId: context.businessId, type: "responsable_cambiado", actorUid: context.uid, actor, detail: {responsableNombre: next.responsableSnapshot?.nombre || "Sin responsable"}, timestamp});
    const previousParticipants = new Map((stored.participantesSnapshot || []).map((person) => [person.uid, person]));
    const nextParticipants = new Map(next.participantesSnapshot.map((person) => [person.uid, person]));
    input.participanteUids.filter((uid) => !previousParticipants.has(uid)).forEach((uid) => writeEvent(transaction, workRef, {businessId: context.businessId, type: "participante_agregado", actorUid: context.uid, actor, detail: {participanteNombre: nextParticipants.get(uid)?.nombre}, timestamp}));
    [...previousParticipants.keys()].filter((uid) => !nextParticipants.has(uid)).forEach((uid) => writeEvent(transaction, workRef, {businessId: context.businessId, type: "participante_retirado", actorUid: context.uid, actor, detail: {participanteNombre: previousParticipants.get(uid)?.nombre}, timestamp}));
  });
  return {trabajoId: workId};
}

async function cambiarEstadoTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const estado = text(request?.data?.estado, "El estado", 30, HttpsError).toLowerCase();
  if (!WORK_STATUSES.has(estado)) fail(HttpsError, "invalid-argument", "Selecciona un estado válido.");
  const people = await userSnapshots(dependencies, [context.uid]);
  const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId);
  await db.runTransaction(async (transaction) => {
    const stored = assertWork(await transaction.get(workRef), context.businessId, HttpsError);
    if (stored.estado === estado) return;
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(workRef, {estado, fechaCompletado: estado === "completado" ? stored.fechaCompletado || timestamp : null, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: stateEvent(stored.estado, estado), actorUid: context.uid, actor, detail: {estadoAnterior: stored.estado, estadoNuevo: estado}, timestamp});
  });
  return {trabajoId: workId, estado};
}

async function crearTareaTrabajoV2Handler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const input = normalizeTaskInput(request?.data?.tarea || {titulo: request?.data?.titulo}, HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const requestFingerprint = fingerprint({workId, input});
  const people = await userSnapshots(dependencies, [context.uid, input.responsableUid]);
  const actor = publicPerson(people, context.uid);
  const assignedPerson = input.responsableUid ? publicPerson(people, input.responsableUid) : null;
  const workRef = context.businessRef.collection("trabajos").doc(workId);
  const taskRef = workRef.collection("tareas").doc();
  const requestRef = context.businessRef.collection("workTaskRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousTaskRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation: "crear", uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const work = assertWork(await transaction.get(workRef), context.businessId, HttpsError); assertTaskMutable(work, HttpsError);
    if (input.responsableUid) assertActiveMember(await transaction.get(db.collection("membresias").doc(membershipId(context.businessId, input.responsableUid))), context.businessId, input.responsableUid, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.create(taskRef, {
      modeloTareaVersion: WORK_TASK_MODEL_VERSION,
      tareaId: taskRef.id,
      negocioId: context.businessId,
      trabajoId: workId,
      titulo: input.titulo,
      descripcion: input.descripcion,
      responsableUid: input.responsableUid,
      responsableSnapshot: assignedPerson,
      estado: "pendiente",
      completada: false,
      completadaEn: null,
      completadaPorUid: null,
      completadaPorSnapshot: null,
      documentacionTotal: 0,
      creadoPorUid: context.uid,
      creadoEn: timestamp,
      actualizadoEn: timestamp,
    });
    transaction.update(workRef, {tareasTotal: Number(work.tareasTotal || 0) + 1, modeloTrabajoVersion: WORK_MODEL_VERSION, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "tarea_creada", actorUid: context.uid, actor, detail: {tareaId: taskRef.id, tareaTitulo: input.titulo}, timestamp});
    if (assignedPerson) writeEvent(transaction, workRef, {businessId: context.businessId, type: "tarea_asignada", actorUid: context.uid, actor, detail: {tareaId: taskRef.id, tareaTitulo: input.titulo, responsableNombre: assignedPerson.nombre}, timestamp});
    result = {tareaId: taskRef.id, idempotent: false};
    transaction.create(requestRef, taskRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "crear", result, timestamp, uid: context.uid, workId, taskId: taskRef.id}));
  });
  return result;
}

async function cambiarEstadoTareaTrabajoV2Handler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await dependencies.requireBusinessAccess(request, {db, HttpsError});
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError); const taskId = identifier(request?.data?.tareaId, "La tarea", HttpsError);
  if (typeof request?.data?.completada !== "boolean") fail(HttpsError, "invalid-argument", "El estado de la tarea no es válido.");
  const completed = request.data.completada;
  if (!completed && !WRITE_ROLES.includes(context.membership?.rol)) fail(HttpsError, "permission-denied", "Sólo OWNER o ADMIN puede reabrir tareas.");
  const documentation = text(request?.data?.documentacionCierre, "La documentación de cierre", 8000, HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const operation = completed ? "completar" : "reabrir";
  const requestFingerprint = fingerprint({workId, taskId, completed, documentation});
  const people = await userSnapshots(dependencies, [context.uid]); const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId); const taskRef = workRef.collection("tareas").doc(taskId);
  const documentationRef = documentation ? taskRef.collection("documentacion").doc() : null;
  const requestRef = context.businessRef.collection("workTaskRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousTaskRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation, uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const work = assertWork(await transaction.get(workRef), context.businessId, HttpsError); assertTaskMutable(work, HttpsError);
    const task = assertTask(await transaction.get(taskRef), context.businessId, workId, HttpsError); assertTaskOperator(task, context, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    if (taskIsCompleted(task) === completed) {
      result = {tareaId: taskId, completada: completed, sinCambios: true, idempotent: false};
      transaction.create(requestRef, taskRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation, result, timestamp, uid: context.uid, workId, taskId}));
      return;
    }
    if (documentationRef) {
      transaction.create(documentationRef, {documentacionId: documentationRef.id, negocioId: context.businessId, trabajoId: workId, tareaId: taskId, tipo: "cierre", texto: documentation, autorUid: context.uid, autorSnapshot: {nombre: actor.nombre, correo: actor.correo}, creadoEn: timestamp});
      writeEvent(transaction, workRef, {businessId: context.businessId, type: "tarea_documentacion_agregada", actorUid: context.uid, actor, detail: {tareaId: taskId, tareaTitulo: task.titulo, documentacionId: documentationRef.id, resumen: documentation.slice(0, 500)}, timestamp});
    }
    transaction.update(taskRef, {
      modeloTareaVersion: WORK_TASK_MODEL_VERSION,
      estado: completed ? "completada" : "pendiente",
      completada: completed,
      completadaEn: completed ? timestamp : null,
      completadaPorUid: completed ? context.uid : null,
      completadaPorSnapshot: completed ? {nombre: actor.nombre, correo: actor.correo} : null,
      ...(documentationRef ? {documentacionTotal: Number(task.documentacionTotal || 0) + 1, ultimaDocumentacionEn: timestamp} : {}),
      actualizadoEn: timestamp,
    });
    const count = Math.max(0, Number(work.tareasCompletadas || 0) + (completed ? 1 : -1));
    transaction.update(workRef, {tareasCompletadas: Math.min(Number(work.tareasTotal || 0), count), modeloTrabajoVersion: WORK_MODEL_VERSION, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: completed ? "tarea_completada" : "tarea_reabierta", actorUid: context.uid, actor, detail: {tareaId: taskId, tareaTitulo: task.titulo}, timestamp});
    result = {tareaId: taskId, completada: completed, idempotent: false};
    transaction.create(requestRef, taskRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation, result, timestamp, uid: context.uid, workId, taskId}));
  });
  return result;
}

async function asignarTareaTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError); const taskId = identifier(request?.data?.tareaId, "La tarea", HttpsError);
  const responsableUid = identifier(request?.data?.responsableUid, "El responsable de la tarea", HttpsError, {optional: true});
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const requestFingerprint = fingerprint({workId, taskId, responsableUid});
  const people = await userSnapshots(dependencies, [context.uid, responsableUid]); const actor = publicPerson(people, context.uid);
  const assignedPerson = responsableUid ? publicPerson(people, responsableUid) : null;
  const workRef = context.businessRef.collection("trabajos").doc(workId); const taskRef = workRef.collection("tareas").doc(taskId);
  const requestRef = context.businessRef.collection("workTaskRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousTaskRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation: "asignar", uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const work = assertWork(await transaction.get(workRef), context.businessId, HttpsError); assertTaskMutable(work, HttpsError);
    const task = assertTask(await transaction.get(taskRef), context.businessId, workId, HttpsError);
    if (responsableUid) assertActiveMember(await transaction.get(db.collection("membresias").doc(membershipId(context.businessId, responsableUid))), context.businessId, responsableUid, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    const previousUid = String(task.responsableUid || "");
    if (previousUid === responsableUid) {
      result = {tareaId: taskId, responsableUid, sinCambios: true, idempotent: false};
      transaction.create(requestRef, taskRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "asignar", result, timestamp, uid: context.uid, workId, taskId}));
      return;
    }
    transaction.update(taskRef, {modeloTareaVersion: WORK_TASK_MODEL_VERSION, estado: taskIsCompleted(task) ? "completada" : "pendiente", descripcion: String(task.descripcion || ""), responsableUid, responsableSnapshot: assignedPerson, actualizadoEn: timestamp});
    transaction.update(workRef, {modeloTrabajoVersion: WORK_MODEL_VERSION, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: previousUid ? "tarea_reasignada" : "tarea_asignada", actorUid: context.uid, actor, detail: {tareaId: taskId, tareaTitulo: task.titulo, responsableAnteriorNombre: task.responsableSnapshot?.nombre || "Sin responsable", responsableNombre: assignedPerson?.nombre || "Sin responsable"}, timestamp});
    result = {tareaId: taskId, responsableUid, idempotent: false};
    transaction.create(requestRef, taskRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "asignar", result, timestamp, uid: context.uid, workId, taskId}));
  });
  return result;
}

async function documentarTareaTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await dependencies.requireBusinessAccess(request, {db, HttpsError});
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError); const taskId = identifier(request?.data?.tareaId, "La tarea", HttpsError);
  const documentation = text(request?.data?.texto, "La documentación", 8000, HttpsError, {required: true});
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const requestFingerprint = fingerprint({workId, taskId, documentation});
  const people = await userSnapshots(dependencies, [context.uid]); const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId); const taskRef = workRef.collection("tareas").doc(taskId); const documentationRef = taskRef.collection("documentacion").doc();
  const requestRef = context.businessRef.collection("workTaskRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousTaskRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation: "documentar", uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const work = assertWork(await transaction.get(workRef), context.businessId, HttpsError); assertTaskMutable(work, HttpsError);
    const task = assertTask(await transaction.get(taskRef), context.businessId, workId, HttpsError); assertTaskOperator(task, context, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.create(documentationRef, {documentacionId: documentationRef.id, negocioId: context.businessId, trabajoId: workId, tareaId: taskId, tipo: "avance", texto: documentation, autorUid: context.uid, autorSnapshot: {nombre: actor.nombre, correo: actor.correo}, creadoEn: timestamp});
    transaction.update(taskRef, {modeloTareaVersion: WORK_TASK_MODEL_VERSION, estado: taskIsCompleted(task) ? "completada" : "pendiente", descripcion: String(task.descripcion || ""), documentacionTotal: Number(task.documentacionTotal || 0) + 1, ultimaDocumentacionEn: timestamp, actualizadoEn: timestamp});
    transaction.update(workRef, {modeloTrabajoVersion: WORK_MODEL_VERSION, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "tarea_documentacion_agregada", actorUid: context.uid, actor, detail: {tareaId: taskId, tareaTitulo: task.titulo, documentacionId: documentationRef.id, resumen: documentation.slice(0, 500)}, timestamp});
    result = {tareaId: taskId, documentacionId: documentationRef.id, idempotent: false};
    transaction.create(requestRef, taskRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "documentar", result, timestamp, uid: context.uid, workId, taskId}));
  });
  return result;
}

async function eliminarTareaTrabajoV2Handler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError); const taskId = identifier(request?.data?.tareaId, "La tarea", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const requestFingerprint = fingerprint({workId, taskId});
  const people = await userSnapshots(dependencies, [context.uid]); const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId); const taskRef = workRef.collection("tareas").doc(taskId);
  const requestRef = context.businessRef.collection("workTaskRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousTaskRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation: "eliminar", uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const work = assertWork(await transaction.get(workRef), context.businessId, HttpsError); assertTaskMutable(work, HttpsError);
    const task = assertTask(await transaction.get(taskRef), context.businessId, workId, HttpsError);
    if (Number(task.modeloTareaVersion || 1) >= WORK_TASK_MODEL_VERSION) fail(HttpsError, "failed-precondition", "Las tareas operativas se conservan para mantener su trazabilidad.");
    if (taskIsCompleted(task)) fail(HttpsError, "failed-precondition", "Reabre la tarea antes de eliminarla.");
    const timestamp = FieldValue.serverTimestamp(); transaction.delete(taskRef);
    transaction.update(workRef, {tareasTotal: Math.max(0, Number(work.tareasTotal || 0) - 1), actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "tarea_eliminada", actorUid: context.uid, actor, detail: {tareaId: taskId, tareaTitulo: task.titulo}, timestamp});
    result = {tareaId: taskId, idempotent: false};
    transaction.create(requestRef, taskRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "eliminar", result, timestamp, uid: context.uid, workId, taskId}));
  });
  return result;
}

async function registrarGastoTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await dependencies.requireBusinessAccess(request, {db, HttpsError});
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const input = normalizeExpenseInput(request?.data?.gasto || {}, HttpsError);
  input.responsableDelGastoUid = memberLinkedUid(context, input.responsableDelGastoUid, "El responsable del gasto", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const requestFingerprint = fingerprint({workId, input});
  const people = await userSnapshots(dependencies, [context.uid, input.responsableDelGastoUid]);
  const actor = publicPerson(people, context.uid);
  const responsible = input.responsableDelGastoUid ? publicPerson(people, input.responsableDelGastoUid) : null;
  const workRef = context.businessRef.collection("trabajos").doc(workId);
  const expenseRef = workRef.collection("gastos").doc();
  const requestRef = context.businessRef.collection("workCostRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousCostRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation: "registrar_gasto", uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const [workSnapshot, businessSnapshot] = await Promise.all([transaction.get(workRef), transaction.get(context.businessRef)]);
    const work = assertWork(workSnapshot, context.businessId, HttpsError);
    const business = businessSnapshot.data() || {};
    if (!businessSnapshot.exists) fail(HttpsError, "failed-precondition", "El negocio seleccionado no está disponible.");
    if (input.responsableDelGastoUid) assertActiveMember(await transaction.get(db.collection("membresias").doc(membershipId(context.businessId, input.responsableDelGastoUid))), context.businessId, input.responsableDelGastoUid, HttpsError);
    const moneda = workCurrency(work, business, HttpsError);
    const clasificacionCosto = expenseClassification(input.categoria);
    const timestamp = FieldValue.serverTimestamp();
    transaction.create(expenseRef, {
      modeloGastoVersion: WORK_EXPENSE_MODEL_VERSION,
      gastoId: expenseRef.id,
      negocioId: context.businessId,
      trabajoId: workId,
      ...input,
      clasificacionCosto,
      moneda,
      estado: "vigente",
      registradoPorUid: context.uid,
      registradoPorSnapshot: {nombre: actor.nombre, correo: actor.correo},
      responsableDelGastoSnapshot: responsible,
      anuladoEn: null,
      anuladoPorUid: null,
      anuladoPorSnapshot: null,
      motivoAnulacion: "",
      creadoEn: timestamp,
      actualizadoEn: timestamp,
    });
    const directAmount = clasificacionCosto === "DIRECTO" ? input.monto : 0;
    const indirectAmount = clasificacionCosto === "INDIRECTO" ? input.monto : 0;
    transaction.update(workRef, {
      moneda,
      gastosVigentesTotal: Number(work.gastosVigentesTotal || 0) + 1,
      gastosMontoTotal: roundMoney(Number(work.gastosMontoTotal || 0) + input.monto),
      gastosMontoDirecto: roundMoney(Number(work.gastosMontoDirecto || 0) + directAmount),
      gastosMontoIndirecto: roundMoney(Number(work.gastosMontoIndirecto || 0) + indirectAmount),
      modeloTrabajoVersion: WORK_MODEL_VERSION,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "gasto_registrado", actorUid: context.uid, actor, detail: {gastoId: expenseRef.id, concepto: input.concepto, monto: input.monto, categoria: input.categoria, clasificacionCosto, moneda}, timestamp});
    result = {gastoId: expenseRef.id, moneda, idempotent: false};
    transaction.create(requestRef, costRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "registrar_gasto", result, timestamp, uid: context.uid, workId, recordId: expenseRef.id}));
  });
  return result;
}

async function registrarHorasHombreTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await dependencies.requireBusinessAccess(request, {db, HttpsError});
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const input = normalizeLaborInput(request?.data?.horasHombre || {}, HttpsError);
  input.tecnicoUid = memberLinkedUid(context, input.tecnicoUid, "El técnico", HttpsError, {required: true});
  const total = roundMoney(input.horas * input.costoHora);
  if (!Number.isFinite(total) || total > 999999999999.99) fail(HttpsError, "invalid-argument", "El total de HH está fuera del rango permitido.");
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const requestFingerprint = fingerprint({workId, input, total});
  const people = await userSnapshots(dependencies, [context.uid, input.tecnicoUid]);
  const actor = publicPerson(people, context.uid);
  const technician = publicPerson(people, input.tecnicoUid);
  const workRef = context.businessRef.collection("trabajos").doc(workId);
  const laborRef = workRef.collection("horasHombre").doc();
  const requestRef = context.businessRef.collection("workCostRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousCostRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation: "registrar_hh", uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const [workSnapshot, businessSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(workRef),
      transaction.get(context.businessRef),
      transaction.get(db.collection("membresias").doc(membershipId(context.businessId, input.tecnicoUid))),
    ]);
    const work = assertWork(workSnapshot, context.businessId, HttpsError);
    const business = businessSnapshot.data() || {};
    if (!businessSnapshot.exists) fail(HttpsError, "failed-precondition", "El negocio seleccionado no está disponible.");
    assertActiveMember(memberSnapshot, context.businessId, input.tecnicoUid, HttpsError);
    const moneda = workCurrency(work, business, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.create(laborRef, {
      modeloHorasHombreVersion: WORK_LABOR_MODEL_VERSION,
      horasHombreId: laborRef.id,
      negocioId: context.businessId,
      trabajoId: workId,
      ...input,
      tecnicoSnapshot: technician,
      total,
      moneda,
      estado: "vigente",
      registradoPorUid: context.uid,
      registradoPorSnapshot: {nombre: actor.nombre, correo: actor.correo},
      anuladoEn: null,
      anuladoPorUid: null,
      anuladoPorSnapshot: null,
      motivoAnulacion: "",
      creadoEn: timestamp,
      actualizadoEn: timestamp,
    });
    transaction.update(workRef, {
      moneda,
      horasHombreVigentesTotal: Number(work.horasHombreVigentesTotal || 0) + 1,
      horasHombreCantidadTotal: roundMoney(Number(work.horasHombreCantidadTotal || 0) + input.horas),
      horasHombreCostoTotal: roundMoney(Number(work.horasHombreCostoTotal || 0) + total),
      modeloTrabajoVersion: WORK_MODEL_VERSION,
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "horas_hombre_registradas", actorUid: context.uid, actor, detail: {horasHombreId: laborRef.id, concepto: input.concepto, tecnicoNombre: technician.nombre, horas: input.horas, costoHora: input.costoHora, total, moneda}, timestamp});
    result = {horasHombreId: laborRef.id, total, moneda, idempotent: false};
    transaction.create(requestRef, costRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "registrar_hh", result, timestamp, uid: context.uid, workId, recordId: laborRef.id}));
  });
  return result;
}

async function anularGastoTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const expenseId = identifier(request?.data?.gastoId, "El gasto", HttpsError);
  const reason = text(request?.data?.motivo, "El motivo de anulación", 1000, HttpsError, {required: true});
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const requestFingerprint = fingerprint({workId, expenseId, reason});
  const people = await userSnapshots(dependencies, [context.uid]); const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId);
  const expenseRef = workRef.collection("gastos").doc(expenseId);
  const requestRef = context.businessRef.collection("workCostRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousCostRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation: "anular_gasto", uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const work = assertWork(await transaction.get(workRef), context.businessId, HttpsError);
    const expenseSnapshot = await transaction.get(expenseRef); const expense = expenseSnapshot.data() || {};
    if (!expenseSnapshot.exists || expense.negocioId !== context.businessId || expense.trabajoId !== workId) fail(HttpsError, "not-found", "No se encontró el gasto.");
    const timestamp = FieldValue.serverTimestamp();
    if (expense.estado === "anulado") {
      result = {gastoId: expenseId, sinCambios: true, idempotent: false};
      transaction.create(requestRef, costRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "anular_gasto", result, timestamp, uid: context.uid, workId, recordId: expenseId}));
      return;
    }
    const amount = Number(expense.monto || 0);
    const directAmount = expense.clasificacionCosto === "INDIRECTO" ? 0 : amount;
    const indirectAmount = expense.clasificacionCosto === "INDIRECTO" ? amount : 0;
    transaction.update(expenseRef, {estado: "anulado", anuladoEn: timestamp, anuladoPorUid: context.uid, anuladoPorSnapshot: {nombre: actor.nombre, correo: actor.correo}, motivoAnulacion: reason, actualizadoEn: timestamp});
    transaction.update(workRef, {
      gastosVigentesTotal: Math.max(0, Number(work.gastosVigentesTotal || 0) - 1),
      gastosMontoTotal: Math.max(0, roundMoney(Number(work.gastosMontoTotal || 0) - amount)),
      gastosMontoDirecto: Math.max(0, roundMoney(Number(work.gastosMontoDirecto || 0) - directAmount)),
      gastosMontoIndirecto: Math.max(0, roundMoney(Number(work.gastosMontoIndirecto || 0) - indirectAmount)),
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "gasto_anulado", actorUid: context.uid, actor, detail: {gastoId: expenseId, concepto: expense.concepto, monto: amount, moneda: expense.moneda, motivo: reason}, timestamp});
    result = {gastoId: expenseId, idempotent: false};
    transaction.create(requestRef, costRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "anular_gasto", result, timestamp, uid: context.uid, workId, recordId: expenseId}));
  });
  return result;
}

async function anularHorasHombreTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const laborId = identifier(request?.data?.horasHombreId, "El registro de HH", HttpsError);
  const reason = text(request?.data?.motivo, "El motivo de anulación", 1000, HttpsError, {required: true});
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const requestFingerprint = fingerprint({workId, laborId, reason});
  const people = await userSnapshots(dependencies, [context.uid]); const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId);
  const laborRef = workRef.collection("horasHombre").doc(laborId);
  const requestRef = context.businessRef.collection("workCostRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousCostRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation: "anular_hh", uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const work = assertWork(await transaction.get(workRef), context.businessId, HttpsError);
    const laborSnapshot = await transaction.get(laborRef); const labor = laborSnapshot.data() || {};
    if (!laborSnapshot.exists || labor.negocioId !== context.businessId || labor.trabajoId !== workId) fail(HttpsError, "not-found", "No se encontró el registro de HH.");
    const timestamp = FieldValue.serverTimestamp();
    if (labor.estado === "anulado") {
      result = {horasHombreId: laborId, sinCambios: true, idempotent: false};
      transaction.create(requestRef, costRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "anular_hh", result, timestamp, uid: context.uid, workId, recordId: laborId}));
      return;
    }
    const hours = Number(labor.horas || 0); const total = Number(labor.total || 0);
    transaction.update(laborRef, {estado: "anulado", anuladoEn: timestamp, anuladoPorUid: context.uid, anuladoPorSnapshot: {nombre: actor.nombre, correo: actor.correo}, motivoAnulacion: reason, actualizadoEn: timestamp});
    transaction.update(workRef, {
      horasHombreVigentesTotal: Math.max(0, Number(work.horasHombreVigentesTotal || 0) - 1),
      horasHombreCantidadTotal: Math.max(0, roundMoney(Number(work.horasHombreCantidadTotal || 0) - hours)),
      horasHombreCostoTotal: Math.max(0, roundMoney(Number(work.horasHombreCostoTotal || 0) - total)),
      actualizadoPorUid: context.uid,
      actualizadoEn: timestamp,
    });
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "horas_hombre_anuladas", actorUid: context.uid, actor, detail: {horasHombreId: laborId, concepto: labor.concepto, horas: hours, total, moneda: labor.moneda, motivo: reason}, timestamp});
    result = {horasHombreId: laborId, idempotent: false};
    transaction.create(requestRef, costRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "anular_hh", result, timestamp, uid: context.uid, workId, recordId: laborId}));
  });
  return result;
}

async function agregarNotaTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError); const noteText = text(request?.data?.texto, "La nota", 4000, HttpsError, {required: true});
  const people = await userSnapshots(dependencies, [context.uid]); const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId); const noteRef = workRef.collection("notas").doc();
  await db.runTransaction(async (transaction) => {
    assertWork(await transaction.get(workRef), context.businessId, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.create(noteRef, {notaId: noteRef.id, negocioId: context.businessId, trabajoId: workId, texto: noteText, autorUid: context.uid, autorSnapshot: {nombre: actor.nombre, correo: actor.correo}, creadoEn: timestamp});
    transaction.update(workRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "nota_agregada", actorUid: context.uid, actor, detail: {notaId: noteRef.id, texto: noteText}, timestamp});
  });
  return {notaId: noteRef.id};
}

async function registrarSalidaMaterialTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await dependencies.requireBusinessAccess(request, {db, HttpsError});
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const itemId = identifier(request?.data?.itemId, "El producto", HttpsError);
  const cantidad = positiveDecimal(request?.data?.cantidad, "La cantidad", 999999999.99, HttpsError);
  const fecha = requiredDate(request?.data?.fecha, "La fecha", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const requestFingerprint = fingerprint({workId, itemId, cantidad, fecha});
  const people = await userSnapshots(dependencies, [context.uid]);
  const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId);
  const itemRef = context.businessRef.collection("inventario").doc(itemId);
  const movementRef = context.businessRef.collection("movimientosInventario").doc();
  const balanceRef = context.businessRef.collection("workMaterialBalances").doc(movementRef.id);
  const requestRef = context.businessRef.collection("workMaterialRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousCostRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation: "salida_material", uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const [workSnapshot, businessSnapshot, itemSnapshot] = await Promise.all([
      transaction.get(workRef), transaction.get(context.businessRef), transaction.get(itemRef),
    ]);
    const work = assertWork(workSnapshot, context.businessId, HttpsError);
    if (!businessSnapshot.exists) fail(HttpsError, "failed-precondition", "El negocio seleccionado no est\u00e1 disponible.");
    const item = assertInventoryProduct(itemSnapshot, context.businessId, HttpsError, {requireActive: true});
    if (item.stock < cantidad) fail(HttpsError, "failed-precondition", "No hay stock suficiente para registrar la salida.");
    const {costoUnitario, costoFuente} = authoritativeInventoryCost(item, HttpsError);
    const costoTotal = roundMoney(cantidad * costoUnitario);
    if (!Number.isFinite(costoTotal) || costoTotal > 999999999999.99) fail(HttpsError, "invalid-argument", "El costo total del material est\u00e1 fuera del rango permitido.");
    const moneda = workCurrency(work, businessSnapshot.data() || {}, HttpsError);
    const stockPosterior = roundMoney(item.stock - cantidad);
    const timestamp = FieldValue.serverTimestamp();
    const snapshot = productSnapshot(item, itemId);
    transaction.update(itemRef, {stock: stockPosterior, actualizadoEn: timestamp, actualizadoPorUid: context.uid});
    transaction.create(movementRef, {
      modeloMovimientoProyectoVersion: WORK_MATERIAL_MODEL_VERSION,
      movimientoId: movementRef.id,
      negocioId: context.businessId,
      trabajoId: workId,
      tipo: "SALIDA_PROYECTO",
      itemId,
      cantidad,
      costoUnitario,
      costoTotal,
      costoFuente,
      moneda,
      stockAnterior: item.stock,
      stockPosterior,
      movimientoOrigenId: null,
      productoSnapshot: snapshot,
      usuarioUid: context.uid,
      usuarioSnapshot: {nombre: actor.nombre, correo: actor.correo},
      fecha,
      creadoEn: timestamp,
    });
    transaction.create(balanceRef, {negocioId: context.businessId, trabajoId: workId, movimientoOrigenId: movementRef.id, itemId, cantidadSalida: cantidad, cantidadDevuelta: 0, costoSalida: costoTotal, costoDevuelto: 0, actualizadoEn: timestamp});
    transaction.update(workRef, {moneda, materialesSalidasTotal: Number(work.materialesSalidasTotal || 0) + 1, materialesCostoTotal: roundMoney(Number(work.materialesCostoTotal || 0) + costoTotal), modeloTrabajoVersion: WORK_MODEL_VERSION, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "material_salida_registrada", actorUid: context.uid, actor, detail: {movimientoId: movementRef.id, itemId, productoNombre: snapshot.nombre, cantidad, costoUnitario, costoTotal, moneda}, timestamp});
    result = {movimientoId: movementRef.id, costoUnitario, costoTotal, moneda, stockPosterior, idempotent: false};
    transaction.create(requestRef, costRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "salida_material", result, timestamp, uid: context.uid, workId, recordId: movementRef.id}));
  });
  return result;
}

async function registrarDevolucionMaterialTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const originMovementId = identifier(request?.data?.movimientoOrigenId, "La salida de origen", HttpsError);
  const cantidad = positiveDecimal(request?.data?.cantidad, "La cantidad", 999999999.99, HttpsError);
  const fecha = requiredDate(request?.data?.fecha, "La fecha", HttpsError);
  const requestId = requestIdentifier(request?.data?.requestId, HttpsError);
  const requestFingerprint = fingerprint({workId, originMovementId, cantidad, fecha});
  const people = await userSnapshots(dependencies, [context.uid]);
  const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId);
  const originRef = context.businessRef.collection("movimientosInventario").doc(originMovementId);
  const balanceRef = context.businessRef.collection("workMaterialBalances").doc(originMovementId);
  const movementRef = context.businessRef.collection("movimientosInventario").doc();
  const requestRef = context.businessRef.collection("workMaterialRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const previous = previousCostRequest(await transaction.get(requestRef), {fingerprint: requestFingerprint, operation: "devolucion_material", uid: context.uid}, HttpsError);
    if (previous) { result = previous; return; }
    const [workSnapshot, originSnapshot, balanceSnapshot] = await Promise.all([transaction.get(workRef), transaction.get(originRef), transaction.get(balanceRef)]);
    const work = assertWork(workSnapshot, context.businessId, HttpsError);
    if (!originSnapshot.exists) fail(HttpsError, "not-found", "No se encontr\u00f3 la salida de material.");
    const origin = originSnapshot.data() || {};
    if (origin.negocioId !== context.businessId || origin.trabajoId !== workId || origin.tipo !== "SALIDA_PROYECTO") fail(HttpsError, "failed-precondition", "La salida no corresponde a este proyecto.");
    if (!balanceSnapshot.exists) fail(HttpsError, "failed-precondition", "La salida no tiene un saldo de devoluci\u00f3n v\u00e1lido.");
    const balance = balanceSnapshot.data() || {};
    if (balance.negocioId !== context.businessId || balance.trabajoId !== workId || balance.itemId !== origin.itemId) fail(HttpsError, "failed-precondition", "El saldo de la salida no es v\u00e1lido.");
    const returnedQuantity = Number(balance.cantidadDevuelta || 0);
    const exitQuantity = Number(balance.cantidadSalida);
    const remainingQuantity = roundMoney(exitQuantity - returnedQuantity);
    if (!Number.isFinite(remainingQuantity) || cantidad > remainingQuantity) fail(HttpsError, "failed-precondition", "La devoluci\u00f3n supera el consumo neto pendiente.");
    const itemRef = context.businessRef.collection("inventario").doc(origin.itemId);
    const itemSnapshot = await transaction.get(itemRef);
    const item = assertInventoryProduct(itemSnapshot, context.businessId, HttpsError);
    const costoUnitario = Number(origin.costoUnitario);
    const originCost = Number(balance.costoSalida);
    const returnedCost = Number(balance.costoDevuelto || 0);
    if (!Number.isFinite(costoUnitario) || costoUnitario < 0 || !Number.isFinite(originCost) || originCost < 0 || !Number.isFinite(returnedCost) || returnedCost < 0) fail(HttpsError, "failed-precondition", "La salida no tiene un costo congelado v\u00e1lido.");
    const isFinalReturn = Math.abs(cantidad - remainingQuantity) < 0.001;
    const costoTotal = isFinalReturn ? roundMoney(originCost - returnedCost) : roundMoney(cantidad * costoUnitario);
    const stockPosterior = roundMoney(item.stock + cantidad);
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(itemRef, {stock: stockPosterior, actualizadoEn: timestamp, actualizadoPorUid: context.uid});
    transaction.create(movementRef, {
      modeloMovimientoProyectoVersion: WORK_MATERIAL_MODEL_VERSION,
      movimientoId: movementRef.id,
      negocioId: context.businessId,
      trabajoId: workId,
      tipo: "DEVOLUCION_PROYECTO",
      itemId: origin.itemId,
      cantidad,
      costoUnitario,
      costoTotal,
      costoFuente: String(origin.costoFuente || "salida_congelada"),
      moneda: String(origin.moneda || work.moneda || "").trim().toUpperCase(),
      stockAnterior: item.stock,
      stockPosterior,
      movimientoOrigenId: originMovementId,
      productoSnapshot: origin.productoSnapshot || productSnapshot(item, origin.itemId),
      usuarioUid: context.uid,
      usuarioSnapshot: {nombre: actor.nombre, correo: actor.correo},
      fecha,
      creadoEn: timestamp,
    });
    transaction.update(balanceRef, {cantidadDevuelta: roundMoney(returnedQuantity + cantidad), costoDevuelto: roundMoney(returnedCost + costoTotal), actualizadoEn: timestamp});
    transaction.update(workRef, {materialesDevolucionesTotal: Number(work.materialesDevolucionesTotal || 0) + 1, materialesCostoTotal: Math.max(0, roundMoney(Number(work.materialesCostoTotal || 0) - costoTotal)), modeloTrabajoVersion: WORK_MODEL_VERSION, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "material_devolucion_registrada", actorUid: context.uid, actor, detail: {movimientoId: movementRef.id, movimientoOrigenId: originMovementId, itemId: origin.itemId, productoNombre: origin.productoSnapshot?.nombre || item.nombre, cantidad, costoUnitario, costoTotal, moneda: origin.moneda}, timestamp});
    result = {movimientoId: movementRef.id, movimientoOrigenId: originMovementId, costoUnitario, costoTotal, moneda: origin.moneda, stockPosterior, cantidadPendiente: roundMoney(remainingQuantity - cantidad), idempotent: false};
    transaction.create(requestRef, costRequestPayload({businessId: context.businessId, fingerprint: requestFingerprint, operation: "devolucion_material", result, timestamp, uid: context.uid, workId, recordId: movementRef.id}));
  });
  return result;
}

module.exports = {
  WORK_EXPENSE_CATEGORIES,
  WORK_EXPENSE_MODEL_VERSION,
  WORK_MODEL_VERSION,
  WORK_FILE_MODEL_VERSION,
  WORK_LABOR_MODEL_VERSION,
  WORK_MATERIAL_MODEL_VERSION,
  WORK_TASK_MODEL_VERSION,
  WORK_PRIORITIES,
  WORK_STATUSES,
  actualizarTrabajoHandler,
  agregarNotaTrabajoHandler,
  anularGastoTrabajoHandler,
  anularHorasHombreTrabajoHandler,
  asignarTareaTrabajoHandler,
  cambiarEstadoTareaTrabajoV2Handler,
  cambiarEstadoTrabajoHandler,
  crearTrabajoHandler,
  crearTareaTrabajoV2Handler,
  documentarTareaTrabajoHandler,
  eliminarTareaTrabajoV2Handler,
  formatWorkNumber,
  linkedWorkFields,
  normalizeWorkInput,
  registrarGastoTrabajoHandler,
  registrarHorasHombreTrabajoHandler,
  registrarDevolucionMaterialTrabajoHandler,
  registrarSalidaMaterialTrabajoHandler,
  writeCommercialLink,
  writeQuoteResponseEvent,
  writeSaleConfirmationEvent,
};
