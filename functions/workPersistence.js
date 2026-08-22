const {createHash} = require("node:crypto");

const WORK_MODEL_VERSION = 2;
const WORK_FILE_MODEL_VERSION = 1;
const WRITE_ROLES = ["OWNER", "ADMIN"];
const WORK_STATUSES = new Set(["pendiente", "en_progreso", "en_espera", "completado", "cancelado"]);
const WORK_PRIORITIES = new Set(["baja", "normal", "alta", "urgente"]);
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

async function agregarTareaTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const titulo = text(request?.data?.titulo, "El título de la tarea", 240, HttpsError, {required: true});
  const people = await userSnapshots(dependencies, [context.uid]); const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId); const taskRef = workRef.collection("tareas").doc();
  await db.runTransaction(async (transaction) => {
    const work = assertWork(await transaction.get(workRef), context.businessId, HttpsError); assertTaskMutable(work, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.create(taskRef, {tareaId: taskRef.id, negocioId: context.businessId, trabajoId: workId, titulo, completada: false, completadaEn: null, completadaPorUid: null, creadoPorUid: context.uid, creadoEn: timestamp, actualizadoEn: timestamp});
    transaction.update(workRef, {tareasTotal: Number(work.tareasTotal || 0) + 1, actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "tarea_creada", actorUid: context.uid, actor, detail: {tareaId: taskRef.id, tareaTitulo: titulo}, timestamp});
  });
  return {tareaId: taskRef.id};
}

async function cambiarEstadoTareaTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError); const taskId = identifier(request?.data?.tareaId, "La tarea", HttpsError);
  if (typeof request?.data?.completada !== "boolean") fail(HttpsError, "invalid-argument", "El estado de la tarea no es válido.");
  const completed = request.data.completada; const people = await userSnapshots(dependencies, [context.uid]); const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId); const taskRef = workRef.collection("tareas").doc(taskId);
  await db.runTransaction(async (transaction) => {
    const work = assertWork(await transaction.get(workRef), context.businessId, HttpsError); assertTaskMutable(work, HttpsError);
    const taskSnapshot = await transaction.get(taskRef); const task = taskSnapshot.data() || {};
    if (!taskSnapshot.exists || task.negocioId !== context.businessId || task.trabajoId !== workId) fail(HttpsError, "not-found", "No se encontró la tarea.");
    if (task.completada === completed) return;
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(taskRef, {completada: completed, completadaEn: completed ? timestamp : null, completadaPorUid: completed ? context.uid : null, actualizadoEn: timestamp});
    const count = Math.max(0, Number(work.tareasCompletadas || 0) + (completed ? 1 : -1));
    transaction.update(workRef, {tareasCompletadas: Math.min(Number(work.tareasTotal || 0), count), actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: completed ? "tarea_completada" : "tarea_reabierta", actorUid: context.uid, actor, detail: {tareaId: taskId, tareaTitulo: task.titulo}, timestamp});
  });
  return {tareaId: taskId, completada: completed};
}

async function eliminarTareaTrabajoHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const context = await requireWriteAccess(request, dependencies);
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError); const taskId = identifier(request?.data?.tareaId, "La tarea", HttpsError);
  const people = await userSnapshots(dependencies, [context.uid]); const actor = publicPerson(people, context.uid);
  const workRef = context.businessRef.collection("trabajos").doc(workId); const taskRef = workRef.collection("tareas").doc(taskId);
  await db.runTransaction(async (transaction) => {
    const work = assertWork(await transaction.get(workRef), context.businessId, HttpsError); assertTaskMutable(work, HttpsError);
    const taskSnapshot = await transaction.get(taskRef); const task = taskSnapshot.data() || {};
    if (!taskSnapshot.exists || task.negocioId !== context.businessId || task.trabajoId !== workId) fail(HttpsError, "not-found", "No se encontró la tarea.");
    if (task.completada) fail(HttpsError, "failed-precondition", "Reabre la tarea antes de eliminarla.");
    const timestamp = FieldValue.serverTimestamp(); transaction.delete(taskRef);
    transaction.update(workRef, {tareasTotal: Math.max(0, Number(work.tareasTotal || 0) - 1), actualizadoPorUid: context.uid, actualizadoEn: timestamp});
    writeEvent(transaction, workRef, {businessId: context.businessId, type: "tarea_eliminada", actorUid: context.uid, actor, detail: {tareaId: taskId, tareaTitulo: task.titulo}, timestamp});
  });
  return {tareaId: taskId};
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

module.exports = {
  WORK_MODEL_VERSION,
  WORK_FILE_MODEL_VERSION,
  WORK_PRIORITIES,
  WORK_STATUSES,
  actualizarTrabajoHandler,
  agregarNotaTrabajoHandler,
  agregarTareaTrabajoHandler,
  cambiarEstadoTareaTrabajoHandler,
  cambiarEstadoTrabajoHandler,
  crearTrabajoHandler,
  eliminarTareaTrabajoHandler,
  formatWorkNumber,
  linkedWorkFields,
  normalizeWorkInput,
  writeCommercialLink,
  writeQuoteResponseEvent,
};
