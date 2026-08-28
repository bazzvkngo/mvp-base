import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {adaptStoredWork, adaptWorkExpense, adaptWorkLabor, adaptWorkLink, adaptWorkMaterialMovement, adaptWorkTask, adaptWorkTaskDocumentation, buildQuickWorkCreationPayload, buildWorkDailyCostSummary, buildWorkMutationPayload, canManageWorks, formatWorkNumber as formatFrontendNumber, getEligibleWorkQuoteOptions, getInventoryCurrentCost, getTaskProgress, getWorkCostSummary, getWorkDraftErrors, getWorkMemberIdentity, getWorkMemberOptionLabel, getWorkOperationalIndicators, getWorkSaleMaterials, getWorkTaskProgress, hasAdditionalWorkMembers, humanizeWorkEvent, matchesWorkFilters, WORK_MODEL_VERSION} from "../src/domain/workModel.mjs";

const require = createRequire(import.meta.url);
const {actualizarSubtareaTrabajoHandler, actualizarTrabajoHandler, agregarNotaTrabajoHandler, agregarSubtareaTrabajoHandler, anularGastoTrabajoHandler, anularHorasHombreTrabajoHandler, asignarTareaTrabajoHandler, cambiarEstadoTareaTrabajoV2Handler, cambiarEstadoTrabajoHandler, crearTareaTrabajoV2Handler, crearTrabajoHandler, documentarTareaTrabajoHandler, eliminarSubtareaTrabajoHandler, eliminarTareaTrabajoV2Handler, formatWorkNumber, normalizeWorkInput, registrarDevolucionMaterialTrabajoHandler, registrarGastoTrabajoHandler, registrarHorasHombreTrabajoHandler, registrarSalidaMaterialTrabajoHandler, WORK_EXPENSE_CATEGORIES, writeCommercialLink, writeQuoteResponseEvent, writeSaleConfirmationEvent} = require("../functions/workPersistence.js");

class TestHttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
class Snapshot { constructor(ref, value) { this.id = ref.id; this.exists = value !== undefined; this.value = value; } data() { return this.value; } }
class DocRef { constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); } collection(name) { return new CollectionRef(this.db, `${this.path}/${name}`); } }
class CollectionRef { constructor(db, path) { this.db = db; this.path = path; } doc(id) { return new DocRef(this.db, `${this.path}/${id || `auto_${++this.db.autoId}`}`); } }
class FakeDb {
  constructor() { this.documents = new Map(); this.autoId = 0; this.transactionQueue = Promise.resolve(); }
  collection(name) { return new CollectionRef(this, name); }
  seed(path, value) { this.documents.set(path, structuredClone(value)); }
  read(path) { return this.documents.get(path); }
  matching(prefix) { return [...this.documents.entries()].filter(([path]) => path.startsWith(prefix)); }
  runTransaction(callback) {
    const execute = async () => {
      const working = new Map([...this.documents.entries()].map(([path, value]) => [path, structuredClone(value)]));
      const transaction = {
        get: async (ref) => new Snapshot(ref, working.has(ref.path) ? structuredClone(working.get(ref.path)) : undefined),
        create: (ref, value) => { if (working.has(ref.path)) throw new Error("already exists"); working.set(ref.path, structuredClone(value)); },
        set: (ref, value, options = {}) => working.set(ref.path, options.merge ? {...(working.get(ref.path) || {}), ...structuredClone(value)} : structuredClone(value)),
        update: (ref, value) => { if (!working.has(ref.path)) throw new Error("missing"); working.set(ref.path, {...working.get(ref.path), ...structuredClone(value)}); },
        delete: (ref) => working.delete(ref.path),
      };
      const result = await callback(transaction);
      this.documents = working;
      return result;
    };
    const pending = this.transactionQueue.then(execute, execute);
    this.transactionQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

const db = new FakeDb();
const FieldValue = {serverTimestamp: () => "2026-08-14T20:05:00.000Z"};
const profiles = new Map([
  ["owner-a", {uid: "owner-a", nombre: "Mauricio", correo: "owner@example.cl"}],
  ["worker-a", {uid: "worker-a", nombre: "Ana Operaciones", correo: "ana@example.cl"}],
  ["worker-b", {uid: "worker-b", nombre: "Luis Terreno", correo: "luis@example.cl"}],
  ["worker-c", {uid: "worker-c", nombre: "Camila Técnica", correo: "camila@example.cl"}],
  ["worker-d", {uid: "worker-d", nombre: "Sin nombre registrado", correo: "identidad@example.cl"}],
]);

for (const [uid, role] of [["owner-a", "OWNER"], ["worker-a", "TECNICO"], ["worker-b", "ADMIN"], ["worker-c", "TECNICO"], ["worker-d", "TECNICO"]]) {
  db.seed(`membresias/business-a__${uid}`, {negocioId: "business-a", uid, rol: role, estado: "activo"});
}
db.seed("negocios/business-a", {nombreComercial: "Empresa A", estado: "activo", monedaCodigo: "USD"});
db.seed("negocios/business-a/clientes/client-a", {negocioId: "business-a", clienteId: "client-a", estado: "activo", nombreRazonSocial: "Constructora Sur", rut: "12.345.678-5", email: "cliente@example.cl", telefono: "+56911111111", personaContacto: "Paula"});

function seedCommercialPair(key, {quoteStatus = "aceptada", saleStatus = "confirmada", businessId = "business-a", quoteWorkId = "", saleWorkId = ""} = {}) {
  const quoteId = `quote-${key}`;
  const saleId = `sale-${key}`;
  db.seed(`negocios/business-a/cotizaciones/${quoteId}`, {cotizacionId: quoteId, negocioId: businessId, numero: `COT-2026-${key}`, estado: quoteStatus, clienteId: "client-a", clienteNombre: "Constructora Sur", total: 119000, moneda: "USD", ventaId: saleId, trabajoId: quoteWorkId});
  db.seed(`negocios/business-a/ventas/${saleId}`, {ventaId: saleId, negocioId: businessId, numero: `VTA-2026-${key}`, estado: saleStatus, clienteId: "client-a", clienteSnapshot: {clienteId: "client-a", nombreRazonSocial: "Constructora Sur"}, cotizacionId: quoteId, total: 119000, moneda: "USD", trabajoId: saleWorkId});
  return {quoteId, saleId};
}

const eligiblePair = seedCommercialPair("0101");
const laterPair = seedCommercialPair("0102");
const draftPair = seedCommercialPair("0103", {quoteStatus: "borrador"});
const emittedPair = seedCommercialPair("0104", {quoteStatus: "emitida"});
const canceledPair = seedCommercialPair("0105", {saleStatus: "cancelada"});
const foreignPair = seedCommercialPair("0106", {businessId: "business-b"});

const requireBusinessAccess = async (request, _deps, options = {}) => {
  if (!request.auth?.uid) throw new TestHttpsError("unauthenticated", "auth");
  const businessId = String(request.data?.businessId || "");
  const membership = db.read(`membresias/${businessId}__${request.auth.uid}`);
  if (!membership || membership.estado !== "activo") throw new TestHttpsError("permission-denied", "membership");
  if (options.roles && !options.roles.includes(membership.rol)) throw new TestHttpsError("permission-denied", "role");
  return {uid: request.auth.uid, businessId, membership, businessRef: db.collection("negocios").doc(businessId)};
};
const dependencies = {db, FieldValue, HttpsError: TestHttpsError, now: () => new Date("2026-08-14T20:05:00.000Z"), requireBusinessAccess, resolveUserSnapshots: async (uids) => new Map(uids.map((uid) => [uid, profiles.get(uid) || {uid, nombre: "Sin nombre registrado", correo: ""}]))};
const request = (uid, data) => ({auth: uid ? {uid} : null, data});
const input = (overrides = {}) => ({titulo: "Mantención preventiva", descripcion: "Visita programada", clienteId: "client-a", responsableUid: "worker-a", participanteUids: ["worker-b"], estado: "pendiente", prioridad: "alta", fechaInicio: "2026-08-14", fechaPrevista: "2026-08-20", ...overrides});

assert.equal(formatWorkNumber(2026, 1), "TRB-2026-0001");
assert.equal(formatFrontendNumber(2026, 12), "TRB-2026-0012");
assert.throws(() => normalizeWorkInput(input({estado: "inventado"}), TestHttpsError), (error) => error.code === "invalid-argument");
assert.throws(() => normalizeWorkInput(input({prioridad: "media"}), TestHttpsError), (error) => error.code === "invalid-argument");
assert.deepEqual(getWorkDraftErrors(input()), {});
assert.equal(canManageWorks("ADMIN"), true);
assert.equal(canManageWorks("TECNICO"), false);
assert.equal(canManageWorks("MEMBER"), false);
assert.equal(WORK_EXPENSE_CATEGORIES.has("ADMINISTRATIVO"), true);
const optionQuotes = [eligiblePair, draftPair, emittedPair, canceledPair].map(({quoteId}) => ({id: quoteId, ...db.read(`negocios/business-a/cotizaciones/${quoteId}`)}));
const optionSales = [eligiblePair, draftPair, emittedPair, canceledPair].map(({saleId}) => ({id: saleId, ...db.read(`negocios/business-a/ventas/${saleId}`)}));
assert.deepEqual(getEligibleWorkQuoteOptions(optionQuotes, optionSales).map(({quote}) => quote.id), [eligiblePair.quoteId]);
console.log("OK contrato: estados, prioridades, formato y roles canónicos");

const ownerOnly = [{uid: "owner-a", nombre: "Sin nombre registrado", correo: "owner@example.cl", estado: "activo"}];
assert.equal(getWorkMemberIdentity(ownerOnly[0]), "owner@example.cl");
assert.equal(getWorkMemberOptionLabel(ownerOnly[0], "owner-a"), "Yo (owner@example.cl)");
assert.equal(getWorkMemberIdentity({uid: "unknown", nombre: "", correo: ""}), "Usuario sin identificar");
assert.equal(hasAdditionalWorkMembers(ownerOnly, "owner-a"), false);
assert.equal(hasAdditionalWorkMembers([...ownerOnly, {uid: "worker-a"}], "owner-a"), true);
const quickPayload = buildQuickWorkCreationPayload(input({estado: "en_progreso", fechaInicio: ""}));
assert.equal(quickPayload.estado, "pendiente");
assert.equal(quickPayload.fechaInicio, "");
assert.equal(quickPayload.fechaPrevista, "2026-08-20");
const teamPayload = buildWorkMutationPayload(input({responsableUid: "worker-a", participanteUids: ["worker-a", "worker-b", "worker-c", "worker-b"]}));
assert.deepEqual(teamPayload.participanteUids, ["worker-b", "worker-c"]);
assert.equal(getWorkDraftErrors(input({fechaInicio: "2026-09-02", fechaPrevista: "2026-09-01"})).fechaPrevista, "La fecha de término no puede ser anterior a la fecha de inicio.");
console.log("OK creación: identidad, propietario único, estado fijo y fechas planificadas opcionales");

const created = await crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-request-0001", trabajo: input()}), dependencies, new Date("2026-08-14T12:00:00Z"));
assert.equal(created.numero, "TRB-2026-0001");
const workPath = `negocios/business-a/trabajos/${created.trabajoId}`;
let stored = db.read(workPath);
assert.equal(stored.clienteSnapshot.nombreRazonSocial, "Constructora Sur");
assert.equal(stored.responsableSnapshot.nombre, "Ana Operaciones");
assert.equal(stored.participantesSnapshot[0].nombre, "Luis Terreno");
assert.equal(stored.creadoPorUid, "owner-a");
assert.equal(stored.numero, "TRB-2026-0001");
assert.equal(db.matching(`${workPath}/historial/`).some(([, value]) => value.tipo === "trabajo_creado"), true);
console.log("OK creación: correlativo, cliente, responsables e historial autoritativos");

assert.equal(stored.modeloTrabajoVersion, WORK_MODEL_VERSION);
assert.equal(stored.modeloExpedienteVersion, 1);
const workRef = db.collection("negocios").doc("business-a").collection("trabajos").doc(created.trabajoId);
await db.runTransaction(async (transaction) => writeCommercialLink(transaction, workRef, {actorUid: "owner-a", businessId: "business-a", currentCount: 0, documentId: "quote-a", documentNumber: "COT-2026-0001", documentStatus: "borrador", documentType: "cotizacion", timestamp: FieldValue.serverTimestamp(), total: 119000}));
await db.runTransaction(async (transaction) => writeQuoteResponseEvent(transaction, workRef, {actorUid: "owner-a", businessId: "business-a", eventKey: "response-a", quoteId: "quote-a", quoteNumber: "COT-2026-0001", response: "rechazada", timestamp: FieldValue.serverTimestamp()}));
await db.runTransaction(async (transaction) => writeSaleConfirmationEvent(transaction, workRef, {actor: {nombre: "Mauricio", correo: "owner@example.cl"}, actorUid: "owner-a", businessId: "business-a", currency: "USD", quoteNumber: "COT-2026-0001", saleId: "sale-a", saleNumber: "VTA-2026-0001", timestamp: FieldValue.serverTimestamp(), total: 119000}));
assert.equal(adaptWorkLink({...db.read(`${workPath}/vinculos/cotizacion__quote-a`), id: "cotizacion__quote-a"}).documentoId, "quote-a");
assert.equal(db.read(workPath).cotizacionesVinculadas, 1);
assert.equal(db.matching(`${workPath}/historial/`).some(([, value]) => value.tipo === "cotizacion_respuesta"), true);
assert.equal(db.matching(`${workPath}/historial/`).some(([, value]) => value.tipo === "venta_confirmada" && value.detalle.total === 119000), true);
console.log("OK expediente: vínculo mínimo inmutable y respuesta append-only");

const retry = await crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-request-0001", trabajo: input()}), dependencies, new Date("2026-08-14T12:00:00Z"));
assert.equal(retry.trabajoId, created.trabajoId); assert.equal(retry.sinCambios, true);
const noClient = await crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-request-0002", trabajo: input({titulo: "Trabajo interno", clienteId: "", responsableUid: "", participanteUids: [], fechaInicio: "", fechaPrevista: ""})}), dependencies, new Date("2026-08-14T12:00:00Z"));
assert.equal(noClient.numero, "TRB-2026-0002");
const noClientStored = db.read(`negocios/business-a/trabajos/${noClient.trabajoId}`);
assert.equal(noClientStored.clienteId, ""); assert.equal(noClientStored.fechaInicio, null); assert.equal(noClientStored.fechaPrevista, null); assert.notEqual(noClientStored.creadoEn, noClientStored.fechaInicio);
const emailFallback = await crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-request-0003", trabajo: input({titulo: "Trabajo urgente", clienteId: "", responsableUid: "worker-d", participanteUids: []})}), dependencies, new Date("2026-08-14T12:00:00Z"));
assert.equal(emailFallback.numero, "TRB-2026-0003");
assert.equal(db.read(`negocios/business-a/trabajos/${emailFallback.trabajoId}`).responsableSnapshot.nombre, "identidad@example.cl");
console.log("OK creación: idempotencia, cliente opcional y fallback de identidad autoritativo");

const concurrent = await Promise.all([
  crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-request-0004", trabajo: input({titulo: "Trabajo con equipo", responsableUid: "worker-a", participanteUids: ["worker-a", "worker-b", "worker-c", "worker-b"]})}), dependencies, new Date("2026-08-14T12:00:00Z")),
  crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-request-0005", trabajo: input({titulo: "Trabajo sin responsable", clienteId: "", responsableUid: "", participanteUids: []})}), dependencies, new Date("2026-08-14T12:00:00Z")),
]);
assert.deepEqual(concurrent.map((result) => result.numero).sort(), ["TRB-2026-0004", "TRB-2026-0005"]);
const concurrentTeam = db.read(`negocios/business-a/trabajos/${concurrent[0].trabajoId}`);
assert.equal(concurrentTeam.responsableUid, "worker-a");
assert.deepEqual(concurrentTeam.participanteUids, ["worker-b", "worker-c"]);
assert.equal(concurrentTeam.participantesSnapshot.length, 2);
console.log("OK correlativo: consecutivo y único ante creaciones concurrentes transaccionales");

await assert.rejects(() => crearTrabajoHandler(request("worker-a", {businessId: "business-a", requestId: "work-request-member", trabajo: input()}), dependencies), (error) => error.code === "permission-denied");
await assert.rejects(() => crearTrabajoHandler(request("owner-a", {businessId: "business-b", requestId: "work-request-cross", trabajo: input()}), dependencies), (error) => error.code === "permission-denied");
await assert.rejects(() => crearTrabajoHandler(request("", {businessId: "business-a", requestId: "work-request-anon", trabajo: input()}), dependencies), (error) => error.code === "unauthenticated");
console.log("OK seguridad: autenticación, rol y aislamiento multiempresa");

const quotedRequest = request("owner-a", {businessId: "business-a", requestId: "work-quoted-0001", trabajo: input({titulo: "Proyecto cotizado", clienteId: "", cotizacionId: eligiblePair.quoteId, fechaInicio: "2026-09-10", fechaPrevista: ""})});
const quotedWork = await crearTrabajoHandler(quotedRequest, dependencies, new Date("2026-08-14T12:00:00Z"));
const quotedPath = `negocios/business-a/trabajos/${quotedWork.trabajoId}`;
const storedQuotedWork = db.read(quotedPath);
assert.equal(storedQuotedWork.clienteId, "client-a"); assert.equal(storedQuotedWork.clienteSnapshot.nombreRazonSocial, "Constructora Sur");
assert.equal(storedQuotedWork.cotizacionId, eligiblePair.quoteId); assert.equal(storedQuotedWork.ventaId, eligiblePair.saleId); assert.equal(storedQuotedWork.fechaInicio, "2026-09-10"); assert.equal(storedQuotedWork.fechaPrevista, null);
assert.equal(db.read(`negocios/business-a/cotizaciones/${eligiblePair.quoteId}`).trabajoId, quotedWork.trabajoId);
assert.equal(db.read(`negocios/business-a/ventas/${eligiblePair.saleId}`).trabajoId, quotedWork.trabajoId);
assert.equal(db.matching(`${quotedPath}/vinculos/`).length, 2);
const quotedRetry = await crearTrabajoHandler(quotedRequest, dependencies, new Date("2026-08-14T12:00:00Z"));
assert.equal(quotedRetry.sinCambios, true); assert.equal(db.matching(`${quotedPath}/vinculos/`).length, 2);
await actualizarTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: quotedWork.trabajoId, trabajo: input({titulo: "Proyecto cotizado replanificado", clienteId: "", cotizacionId: "", fechaInicio: "2026-09-12", fechaPrevista: "2026-09-30"})}), dependencies);
assert.equal(db.read(quotedPath).cotizacionId, eligiblePair.quoteId); assert.equal(db.read(quotedPath).clienteId, "client-a"); assert.equal(db.read(quotedPath).fechaInicio, "2026-09-12");
await assert.rejects(() => actualizarTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: quotedWork.trabajoId, trabajo: input({cotizacionId: laterPair.quoteId})}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-quoted-0002", trabajo: input({cotizacionId: eligiblePair.quoteId})}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-draft-0001", trabajo: input({cotizacionId: draftPair.quoteId})}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-emitted-001", trabajo: input({cotizacionId: emittedPair.quoteId})}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-canceled-01", trabajo: input({cotizacionId: canceledPair.quoteId})}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-foreign-001", trabajo: input({cotizacionId: foreignPair.quoteId})}), dependencies), (error) => error.code === "permission-denied");
await assert.rejects(() => crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-client-bad", trabajo: input({clienteId: "client-other", cotizacionId: laterPair.quoteId})}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-dates-bad1", trabajo: input({fechaInicio: "2026-09-02", fechaPrevista: "2026-09-01"})}), dependencies), (error) => error.code === "invalid-argument");
const futureWork = await crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-future-001", trabajo: input({titulo: "Plan futuro", clienteId: "", fechaInicio: "2027-01-10", fechaPrevista: ""})}), dependencies);
assert.equal(db.read(`negocios/business-a/trabajos/${futureWork.trabajoId}`).fechaInicio, "2027-01-10");
await actualizarTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: noClient.trabajoId, trabajo: input({titulo: "Trabajo interno cotizado", clienteId: "", cotizacionId: laterPair.quoteId, responsableUid: "", participanteUids: [], fechaInicio: "", fechaPrevista: "2026-10-30"})}), dependencies);
const laterLinkedWork = db.read(`negocios/business-a/trabajos/${noClient.trabajoId}`);
assert.equal(laterLinkedWork.cotizacionId, laterPair.quoteId); assert.equal(laterLinkedWork.clienteId, "client-a"); assert.equal(laterLinkedWork.fechaInicio, null); assert.equal(laterLinkedWork.fechaPrevista, "2026-10-30");
console.log("OK BRUNO-03: elegibilidad COT/VEN, cliente autoritativo, fechas reales, vínculo doble, retry y unicidad");

await actualizarTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, trabajo: input({responsableUid: "worker-b", participanteUids: ["worker-a"], estado: "en_progreso"})}), dependencies);
stored = db.read(workPath); assert.equal(stored.responsableUid, "worker-b"); assert.deepEqual(stored.participanteUids, ["worker-a"]); assert.equal(stored.estado, "en_progreso"); assert.equal(stored.numero, "TRB-2026-0001");
const updateEvents = db.matching(`${workPath}/historial/`).map(([, value]) => value.tipo);
assert.equal(updateEvents.includes("responsable_cambiado"), true); assert.equal(updateEvents.includes("participante_agregado"), true); assert.equal(updateEvents.includes("participante_retirado"), true); assert.equal(updateEvents.includes("estado_cambiado"), true);
console.log("OK edición: responsable, participantes y estado generan trazabilidad");

const taskRequest = request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "task-create-0001", tarea: {titulo: "Revisar instalación", descripcion: "Validar tablero y protecciones", responsableUid: "worker-a"}});
const task = await crearTareaTrabajoV2Handler(taskRequest, dependencies);
const taskRetry = await crearTareaTrabajoV2Handler(taskRequest, dependencies);
assert.equal(taskRetry.tareaId, task.tareaId); assert.equal(taskRetry.idempotent, true);
let storedTask = db.read(`${workPath}/tareas/${task.tareaId}`);
assert.equal(storedTask.modeloTareaVersion, 2); assert.equal(storedTask.responsableUid, "worker-a"); assert.equal(storedTask.responsableSnapshot.nombre, "Ana Operaciones");
assert.equal(db.matching(`${workPath}/historial/`).filter(([, value]) => value.tipo === "tarea_creada" && value.detalle.tareaId === task.tareaId).length, 1);
await assert.rejects(() => crearTareaTrabajoV2Handler(request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "task-create-member", tarea: {titulo: "Sin permiso", descripcion: "", responsableUid: "worker-a"}}), dependencies), (error) => error.code === "permission-denied");
await assert.rejects(() => crearTareaTrabajoV2Handler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "task-create-invalid", tarea: {titulo: "Inválida", descripcion: "", responsableUid: "ghost-user"}}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => crearTareaTrabajoV2Handler(request("owner-a", {businessId: "business-b", trabajoId: created.trabajoId, requestId: "task-create-cross", tarea: {titulo: "Externa", descripcion: "", responsableUid: ""}}), dependencies), (error) => error.code === "permission-denied");

const documentRequest = request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, requestId: "task-document-0001", texto: "Mediciones registradas y tablero conforme."});
const documented = await documentarTareaTrabajoHandler(documentRequest, dependencies);
const documentedRetry = await documentarTareaTrabajoHandler(documentRequest, dependencies);
assert.equal(documentedRetry.documentacionId, documented.documentacionId); assert.equal(documentedRetry.idempotent, true);
assert.equal(db.matching(`${workPath}/tareas/${task.tareaId}/documentacion/`).length, 1);
await assert.rejects(() => documentarTareaTrabajoHandler(request("worker-c", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, requestId: "task-document-other", texto: "No autorizada"}), dependencies), (error) => error.code === "permission-denied");

const completeRequest = request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, completada: true, documentacionCierre: "Cierre técnico conforme.", requestId: "task-complete-0001"});
await cambiarEstadoTareaTrabajoV2Handler(completeRequest, dependencies);
const completeRetry = await cambiarEstadoTareaTrabajoV2Handler(completeRequest, dependencies);
assert.equal(completeRetry.idempotent, true);
storedTask = db.read(`${workPath}/tareas/${task.tareaId}`);
assert.equal(storedTask.estado, "completada"); assert.equal(storedTask.completadaPorUid, "worker-a"); assert.equal(db.read(workPath).tareasCompletadas, 1);
assert.equal(db.matching(`${workPath}/historial/`).filter(([, value]) => value.tipo === "tarea_completada" && value.detalle.tareaId === task.tareaId).length, 1);
await assert.rejects(() => cambiarEstadoTareaTrabajoV2Handler(request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, completada: false, requestId: "task-member-reopen"}), dependencies), (error) => error.code === "permission-denied");

await asignarTareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, responsableUid: "worker-c", requestId: "task-assign-0001"}), dependencies);
assert.equal(db.read(`${workPath}/tareas/${task.tareaId}`).responsableUid, "worker-c");
await assert.rejects(() => asignarTareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, responsableUid: "ghost-user", requestId: "task-assign-invalid"}), dependencies), (error) => error.code === "failed-precondition");
await cambiarEstadoTareaTrabajoV2Handler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, completada: false, requestId: "task-reopen-0001"}), dependencies);
assert.equal(db.read(`${workPath}/tareas/${task.tareaId}`).estado, "pendiente"); assert.equal(db.read(workPath).tareasCompletadas, 0);
await assert.rejects(() => eliminarTareaTrabajoV2Handler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, requestId: "task-delete-v2"}), dependencies), (error) => error.code === "failed-precondition");
const taskEvents = db.matching(`${workPath}/historial/`).map(([, value]) => value.tipo);
assert.equal(taskEvents.includes("tarea_reasignada"), true); assert.equal(taskEvents.includes("tarea_reabierta"), true); assert.equal(taskEvents.includes("tarea_completada"), true); assert.equal(taskEvents.includes("tarea_documentacion_agregada"), true);

const firstSubtaskRequest = request("worker-c", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, titulo: "Montar cámaras", requestId: "subtask-create-0001"});
const firstSubtask = await agregarSubtareaTrabajoHandler(firstSubtaskRequest, dependencies);
const firstSubtaskRetry = await agregarSubtareaTrabajoHandler(firstSubtaskRequest, dependencies);
assert.equal(firstSubtaskRetry.subtareaId, firstSubtask.subtareaId); assert.equal(firstSubtaskRetry.idempotent, true);
const secondSubtask = await agregarSubtareaTrabajoHandler(request("worker-c", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, titulo: "Conectar red", requestId: "subtask-create-0002"}), dependencies);
const temporarySubtask = await agregarSubtareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, titulo: "Revisar título", requestId: "subtask-create-0003"}), dependencies);
await actualizarSubtareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, subtareaId: temporarySubtask.subtareaId, titulo: "Revisar rotulación", requestId: "subtask-title-0001"}), dependencies);
await actualizarSubtareaTrabajoHandler(request("worker-c", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, subtareaId: firstSubtask.subtareaId, completada: true, requestId: "subtask-check-0001"}), dependencies);
await actualizarSubtareaTrabajoHandler(request("worker-c", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, subtareaId: secondSubtask.subtareaId, completada: true, requestId: "subtask-check-0002"}), dependencies);
storedTask = db.read(`${workPath}/tareas/${task.tareaId}`);
assert.deepEqual(getTaskProgress(adaptWorkTask(storedTask)), {total: 3, completed: 2, percent: 66.67});
assert.equal(getWorkTaskProgress(adaptStoredWork(db.read(workPath))).percent, 66.67);
await actualizarSubtareaTrabajoHandler(request("worker-c", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, subtareaId: secondSubtask.subtareaId, completada: false, requestId: "subtask-uncheck-0001"}), dependencies);
assert.equal(getTaskProgress(adaptWorkTask(db.read(`${workPath}/tareas/${task.tareaId}`))).percent, 33.33);
await eliminarSubtareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, subtareaId: temporarySubtask.subtareaId, requestId: "subtask-delete-0001"}), dependencies);
assert.equal(getTaskProgress(adaptWorkTask(db.read(`${workPath}/tareas/${task.tareaId}`))).percent, 50);
await assert.rejects(() => eliminarSubtareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, subtareaId: firstSubtask.subtareaId, requestId: "subtask-delete-completed"}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => cambiarEstadoTareaTrabajoV2Handler(request("worker-c", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, estado: "en_espera", motivoEspera: "", requestId: "task-wait-no-reason"}), dependencies), (error) => error.code === "invalid-argument");
await cambiarEstadoTareaTrabajoV2Handler(request("worker-c", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, estado: "en_espera", motivoEspera: "Esperando acceso al recinto", requestId: "task-wait-0001"}), dependencies);
assert.equal(db.read(`${workPath}/tareas/${task.tareaId}`).motivoEspera, "Esperando acceso al recinto");
await cambiarEstadoTareaTrabajoV2Handler(request("worker-c", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, estado: "en_progreso", requestId: "task-resume-0001"}), dependencies);
assert.equal(db.matching(`${workPath}/historial/`).some(([, value]) => value.tipo === "tarea_en_espera" && value.detalle.motivoEspera === "Esperando acceso al recinto"), true);
console.log("OK BRUNO-07 tareas: subtareas idempotentes, edición segura, check/uncheck, progreso derivado y espera con historial");

const legacyTaskId = "legacy-task";
db.seed(`${workPath}/tareas/${legacyTaskId}`, {tareaId: legacyTaskId, negocioId: "business-a", trabajoId: created.trabajoId, titulo: "Checklist legacy", completada: false, creadoEn: "2026-08-14T20:05:00.000Z"});
db.seed(workPath, {...db.read(workPath), tareasTotal: 2});
await cambiarEstadoTareaTrabajoV2Handler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: legacyTaskId, completada: true, requestId: "task-legacy-complete"}), dependencies);
assert.equal(db.read(`${workPath}/tareas/${legacyTaskId}`).modeloTareaVersion, 2);
assert.equal(adaptWorkTask({tareaId: "old", titulo: "Antigua", completada: false}).modeloTareaVersion, 1);
assert.equal(adaptWorkTaskDocumentation({documentacionId: "doc", texto: "Informe"}).texto, "Informe");
console.log("OK tareas V2: asignación, documentación, técnico, idempotencia, reapertura, aislamiento y legacy");

const expenseRequest = request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "expense-create-0001", gasto: {concepto: "Material eléctrico", monto: 100000, categoria: "MATERIAL", responsableDelGastoUid: "worker-a", fecha: "2026-08-14", observacion: "Compra en terreno", tareaId: task.tareaId}});
const expense = await registrarGastoTrabajoHandler(expenseRequest, dependencies);
const expenseRetry = await registrarGastoTrabajoHandler(expenseRequest, dependencies);
assert.equal(expenseRetry.gastoId, expense.gastoId); assert.equal(expenseRetry.idempotent, true);
let storedExpense = db.read(`${workPath}/gastos/${expense.gastoId}`);
assert.equal(storedExpense.categoria, "MATERIAL"); assert.equal(storedExpense.clasificacionCosto, "DIRECTO"); assert.equal(storedExpense.moneda, "USD");
assert.equal(db.matching(`${workPath}/gastos/`).length, 1); assert.equal(db.read(workPath).gastosMontoTotal, 100000);
await assert.rejects(() => registrarGastoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "expense-category-bad", gasto: {concepto: "Inválido", monto: 1, categoria: "INVENTADA", fecha: "2026-08-14"}}), dependencies), (error) => error.code === "invalid-argument");
await assert.rejects(() => registrarGastoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "expense-member-bad", gasto: {concepto: "Inválido", monto: 1, categoria: "OTRO", responsableDelGastoUid: "ghost-user", fecha: "2026-08-14"}}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => registrarGastoTrabajoHandler(request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "expense-member-forged", gasto: {concepto: "Ajeno", monto: 1, categoria: "OTRO", responsableDelGastoUid: "worker-c", fecha: "2026-08-14"}}), dependencies), (error) => error.code === "permission-denied");
await assert.rejects(() => registrarGastoTrabajoHandler(request("owner-a", {businessId: "business-b", trabajoId: created.trabajoId, requestId: "expense-cross-work", gasto: {concepto: "Externo", monto: 1, categoria: "OTRO", fecha: "2026-08-14"}}), dependencies), (error) => error.code === "permission-denied");

const annulExpenseRequest = request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, gastoId: expense.gastoId, motivo: "Monto incorrecto", requestId: "expense-annul-0001"});
await anularGastoTrabajoHandler(annulExpenseRequest, dependencies);
const annulExpenseRetry = await anularGastoTrabajoHandler(annulExpenseRequest, dependencies);
assert.equal(annulExpenseRetry.idempotent, true); assert.equal(db.read(`${workPath}/gastos/${expense.gastoId}`).estado, "anulado"); assert.equal(db.read(workPath).gastosMontoTotal, 0);
const correctedExpense = await registrarGastoTrabajoHandler(request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "expense-corrected-01", gasto: {concepto: "Material eléctrico corregido", monto: 120000, categoria: "MATERIAL", responsableDelGastoUid: "", fecha: "2026-08-14", observacion: "Reemplaza registro anulado"}}), dependencies);
assert.notEqual(correctedExpense.gastoId, expense.gastoId); assert.equal(db.read(`${workPath}/gastos/${correctedExpense.gastoId}`).responsableDelGastoUid, "worker-a"); assert.equal(db.matching(`${workPath}/gastos/`).length, 2);
const indirectExpense = await registrarGastoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "expense-indirect-01", gasto: {concepto: "Administración del proyecto", monto: 5000, categoria: "ADMINISTRATIVO", responsableDelGastoUid: "", fecha: "2026-08-14", observacion: "", tareaId: task.tareaId}}), dependencies);
assert.equal(db.read(`${workPath}/gastos/${indirectExpense.gastoId}`).clasificacionCosto, "INDIRECTO"); assert.equal(db.read(workPath).gastosMontoIndirecto, 5000);
await registrarGastoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "expense-project-01", gasto: {concepto: "Traslado general", monto: 3000, categoria: "OPERATIVO", responsableDelGastoUid: "", fecha: "2026-08-14", observacion: ""}}), dependencies);

db.seed("negocios/business-a", {...db.read("negocios/business-a"), monedaCodigo: "CLP"});
const laborRequest = request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "labor-create-0001", horasHombre: {tecnicoUid: "", horas: 4, costoHora: 10000, total: 1, fecha: "2026-08-14", concepto: "Instalación en terreno"}});
const labor = await registrarHorasHombreTrabajoHandler(laborRequest, dependencies);
const laborRetry = await registrarHorasHombreTrabajoHandler(laborRequest, dependencies);
assert.equal(labor.total, 40000); assert.equal(laborRetry.idempotent, true); assert.equal(db.matching(`${workPath}/horasHombre/`).length, 1);
let storedLabor = db.read(`${workPath}/horasHombre/${labor.horasHombreId}`);
assert.equal(storedLabor.total, 40000); assert.equal(storedLabor.moneda, "USD"); assert.equal(storedLabor.tecnicoUid, "worker-a"); assert.equal(db.read(workPath).horasHombreCostoTotal, 40000);
const taskLabor = await registrarHorasHombreTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "labor-task-0001", horasHombre: {tecnicoUid: "worker-c", horas: 2, costoHora: 5000, fecha: "2026-08-15", concepto: "Configuración", tareaId: task.tareaId}}), dependencies);
assert.equal(db.read(`${workPath}/horasHombre/${taskLabor.horasHombreId}`).tareaId, task.tareaId);
await assert.rejects(() => registrarHorasHombreTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "labor-member-invalid", horasHombre: {tecnicoUid: "ghost-user", horas: 1, costoHora: 1000, fecha: "2026-08-14", concepto: "Inválida"}}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => registrarHorasHombreTrabajoHandler(request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "labor-member-forged", horasHombre: {tecnicoUid: "worker-c", horas: 1, costoHora: 1000, fecha: "2026-08-14", concepto: "Ajena"}}), dependencies), (error) => error.code === "permission-denied");
const annulLaborRequest = request("worker-b", {businessId: "business-a", trabajoId: created.trabajoId, horasHombreId: labor.horasHombreId, motivo: "Registro duplicado", requestId: "labor-annul-0001"});
await anularHorasHombreTrabajoHandler(annulLaborRequest, dependencies);
await anularHorasHombreTrabajoHandler(annulLaborRequest, dependencies);
storedLabor = db.read(`${workPath}/horasHombre/${labor.horasHombreId}`); assert.equal(storedLabor.estado, "anulado"); assert.equal(db.read(workPath).horasHombreCostoTotal, 10000);
const costEvents = db.matching(`${workPath}/historial/`).map(([, value]) => value.tipo);
for (const event of ["gasto_registrado", "gasto_anulado", "horas_hombre_registradas", "horas_hombre_anuladas"]) assert.equal(costEvents.includes(event), true);
assert.equal(adaptWorkExpense(storedExpense).monto, 100000); assert.equal(adaptWorkLabor(storedLabor).total, 40000);
console.log("OK costos: gastos, HH autoritativas, moneda, membresías, idempotencia, anulación y corrección append-only");

const productPath = "negocios/business-a/inventario/product-a";
db.seed(productPath, {negocioId: "business-a", itemId: "product-a", tipoItem: "producto", estado: "activo", nombre: "Cable THHN", codigoInterno: "MAT-001", unidad: "metro", stock: 10, costoPromedio: 800, costoBase: 1000});
db.seed("negocios/business-a/inventario/service-a", {negocioId: "business-a", itemId: "service-a", tipoItem: "servicio", estado: "activo", nombre: "Instalación", stock: 10, costoBase: 500});
const materialExitRequest = request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, itemId: "product-a", cantidad: 5, fecha: "2026-08-14", costoTotal: 1, requestId: "material-exit-0001"});
const materialExit = await registrarSalidaMaterialTrabajoHandler(materialExitRequest, dependencies);
const materialExitRetry = await registrarSalidaMaterialTrabajoHandler(materialExitRequest, dependencies);
assert.equal(materialExit.costoUnitario, 800); assert.equal(materialExit.costoTotal, 4000); assert.equal(materialExitRetry.idempotent, true);
assert.equal(db.read(productPath).stock, 5);
let materialMovements = db.matching("negocios/business-a/movimientosInventario/").map(([, value]) => value).filter((value) => value.trabajoId === created.trabajoId);
assert.equal(materialMovements.length, 1); assert.equal(materialMovements[0].tipo, "SALIDA_PROYECTO"); assert.equal(materialMovements[0].productoSnapshot.nombre, "Cable THHN");
assert.equal(db.read(workPath).materialesCostoTotal, 4000);
await assert.rejects(() => registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, itemId: "product-a", cantidad: 6, fecha: "2026-08-14", requestId: "material-no-stock"}), dependencies), (error) => error.code === "failed-precondition");
assert.equal(db.read(productPath).stock, 5); assert.equal(db.matching("negocios/business-a/movimientosInventario/").filter(([, value]) => value.trabajoId === created.trabajoId).length, 1);
await assert.rejects(() => registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, itemId: "service-a", cantidad: 1, fecha: "2026-08-14", requestId: "material-invalid-item"}), dependencies), (error) => error.code === "failed-precondition");
await assert.rejects(() => registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-b", trabajoId: created.trabajoId, itemId: "product-a", cantidad: 1, fecha: "2026-08-14", requestId: "material-cross-business"}), dependencies), (error) => error.code === "permission-denied");

db.seed(productPath, {...db.read(productPath), costoPromedio: 1200, costoBase: 1400});
await assert.rejects(() => registrarDevolucionMaterialTrabajoHandler(request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, movimientoOrigenId: materialExit.movimientoId, cantidad: 1, fecha: "2026-08-15", requestId: "material-return-member"}), dependencies), (error) => error.code === "permission-denied");
const partialReturnRequest = request("worker-b", {businessId: "business-a", trabajoId: created.trabajoId, movimientoOrigenId: materialExit.movimientoId, cantidad: 2, fecha: "2026-08-15", requestId: "material-return-0001"});
const partialReturn = await registrarDevolucionMaterialTrabajoHandler(partialReturnRequest, dependencies);
const partialReturnRetry = await registrarDevolucionMaterialTrabajoHandler(partialReturnRequest, dependencies);
assert.equal(partialReturn.costoUnitario, 800); assert.equal(partialReturn.costoTotal, 1600); assert.equal(partialReturn.cantidadPendiente, 3); assert.equal(partialReturnRetry.idempotent, true); assert.equal(db.read(productPath).stock, 7);
await assert.rejects(() => registrarDevolucionMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, movimientoOrigenId: materialExit.movimientoId, cantidad: 4, fecha: "2026-08-15", requestId: "material-over-return"}), dependencies), (error) => error.code === "failed-precondition");
assert.equal(db.read(productPath).stock, 7);
const fullReturn = await registrarDevolucionMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, movimientoOrigenId: materialExit.movimientoId, cantidad: 3, fecha: "2026-08-15", requestId: "material-return-0002"}), dependencies);
assert.equal(fullReturn.costoUnitario, 800); assert.equal(fullReturn.costoTotal, 2400); assert.equal(fullReturn.cantidadPendiente, 0); assert.equal(db.read(productPath).stock, 10); assert.equal(db.read(workPath).materialesCostoTotal, 0);
materialMovements = db.matching("negocios/business-a/movimientosInventario/").map(([, value]) => value).filter((value) => value.trabajoId === created.trabajoId);
assert.equal(materialMovements.length, 3); assert.equal(materialMovements.filter((value) => value.tipo === "DEVOLUCION_PROYECTO").length, 2);
assert.equal(materialMovements.find((value) => value.movimientoId === materialExit.movimientoId).cantidadDevuelta, undefined);
assert.equal(adaptWorkMaterialMovement(materialMovements[1]).movimientoOrigenId, materialExit.movimientoId);
db.seed("negocios/business-a/inventario/product-base", {negocioId: "business-a", itemId: "product-base", tipoItem: "producto", estado: "activo", nombre: "Conector", unidad: "unidad", stock: 2, costoBase: 250});
const baseCostExit = await registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, itemId: "product-base", cantidad: 1, fecha: "2026-08-16", tareaId: task.tareaId, requestId: "material-base-cost"}), dependencies);
assert.equal(baseCostExit.costoUnitario, 250); assert.equal(baseCostExit.costoTotal, 250);
const costInput = {
  expenses: db.matching(`${workPath}/gastos/`).map(([, value]) => adaptWorkExpense(value)),
  labor: db.matching(`${workPath}/horasHombre/`).map(([, value]) => adaptWorkLabor(value)),
  materials: db.matching("negocios/business-a/movimientosInventario/").map(([, value]) => adaptWorkMaterialMovement(value)).filter((value) => value.trabajoId === created.trabajoId),
};
const taskCosts = getWorkCostSummary({...costInput, taskId: task.tareaId});
const projectCosts = getWorkCostSummary(costInput);
assert.deepEqual(taskCosts, {materials: 250, labor: 10000, expenses: 5000, total: 15250});
assert.equal(projectCosts.total, 18250); assert.equal(projectCosts.total > taskCosts.total, true);
const dailyCosts = buildWorkDailyCostSummary({...costInput, events: db.matching(`${workPath}/historial/`).map(([, value]) => ({...value, fecha: value.fecha}))});
assert.deepEqual(dailyCosts.map(({date, total}) => [date, total]), [["2026-08-16", 250], ["2026-08-15", 6000], ["2026-08-14", 12000]]);
const saleMaterials = getWorkSaleMaterials([{id: "sale-project", numero: "VTA-2026-0200", estado: "confirmada", moneda: "USD", fechaVenta: "2026-08-13", items: [
  {lineaId: "product-line", tipoItem: "producto", nombre: "Conector", unidad: "unidad"},
  {lineaId: "service-line", tipoItem: "servicio", nombre: "Instalación"},
  {lineaId: "activity-line", tipoItem: "actividad", nombre: "Programación"},
], efectosInventario: [{lineaId: "product-line", movimientoId: "sale-stock-once", itemId: "product-base", cantidad: 2, costoUnitario: 300, costoTotal: 600, moneda: "USD", costoHistoricoDisponible: true}]}]);
assert.equal(saleMaterials.length, 1); assert.equal(saleMaterials[0].nombre, "Conector");
assert.equal(getWorkCostSummary({...costInput, saleMaterials}).total, 18850);
assert.equal(getWorkCostSummary({...costInput, saleMaterials, taskId: task.tareaId}).total, 15250);
assert.deepEqual(buildWorkDailyCostSummary({...costInput, saleMaterials}).map(({date, total}) => [date, total]), [["2026-08-16", 250], ["2026-08-15", 6000], ["2026-08-14", 12000], ["2026-08-13", 600]]);
assert.equal(getWorkSaleMaterials([{estado: "cancelada", efectosInventario: [{cantidad: 1, costoUnitario: 300, costoTotal: 300}]}]).length, 0);
assert.equal(getInventoryCurrentCost({costoPromedio: 1200, costoBase: 1400}), 1200); assert.equal(getInventoryCurrentCost({costoBase: 250}), 250);
const materialEvents = db.matching(`${workPath}/historial/`).map(([, value]) => value.tipo);
assert.equal(materialEvents.includes("material_salida_registrada"), true); assert.equal(materialEvents.includes("material_devolucion_registrada"), true);
const legacyWork = adaptStoredWork({trabajoId: "legacy-work", titulo: "Legacy"});
assert.equal(legacyWork.materialesCostoTotal, 0); assert.equal(legacyWork.materialesSalidasTotal, 0);
console.log("OK materiales: salida transaccional, stock, costo congelado, idempotencia, devoluciones netas, permisos, aislamiento y legacy");

const note = await agregarNotaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, texto: "Configuración inicial completada."}), dependencies);
assert.equal(db.read(`${workPath}/notas/${note.notaId}`).autorSnapshot.nombre, "Mauricio");
assert.equal(db.matching(`${workPath}/historial/`).some(([, value]) => value.tipo === "nota_agregada" && value.detalle.texto.includes("Configuración")), true);
console.log("OK notas: autor, fecha y evento append-only");

assert.equal(getWorkOperationalIndicators({estado: "en_progreso", ultimaActividadEn: "2026-08-20T12:00:00.000Z"}, {now: new Date("2026-08-24T12:00:00.000Z")}).noRecentActivity, true);
assert.equal(getWorkOperationalIndicators({estado: "en_espera", ultimaActividadEn: "2026-08-20T12:00:00.000Z"}, {now: new Date("2026-08-24T12:00:00.000Z")}).noRecentActivity, false);
await assert.rejects(() => cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, estado: "en_espera", motivoEspera: ""}), dependencies), (error) => error.code === "invalid-argument");
await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, estado: "en_espera", motivoEspera: "Esperando aprobación del cliente"}), dependencies);
assert.equal(db.read(workPath).motivoEspera, "Esperando aprobación del cliente");
await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, estado: "en_progreso"}), dependencies);
assert.equal(db.read(workPath).motivoEspera, "");
assert.equal(db.matching(`${workPath}/historial/`).some(([, value]) => value.detalle?.motivoEspera === "Esperando aprobación del cliente"), true);
console.log("OK BRUNO-07 operación: espera con motivo/historial e indicador determinista de 3 días");

await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, estado: "completado"}), dependencies);
assert.equal(db.read(workPath).estado, "completado"); assert.ok(db.read(workPath).fechaCompletado);
await assert.rejects(() => crearTareaTrabajoV2Handler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, requestId: "task-terminal-create", tarea: {titulo: "No permitida", descripcion: "", responsableUid: ""}}), dependencies), (error) => error.code === "failed-precondition");
await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, estado: "pendiente"}), dependencies);
assert.equal(db.read(workPath).fechaCompletado, null);
await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, estado: "cancelado"}), dependencies);
const terminalEvents = db.matching(`${workPath}/historial/`).map(([, value]) => value.tipo);
assert.equal(terminalEvents.includes("trabajo_completado"), true); assert.equal(terminalEvents.includes("trabajo_reabierto"), true); assert.equal(terminalEvents.includes("trabajo_cancelado"), true);
console.log("OK transiciones: completado, reapertura, cancelación y fecha de término");

const adapted = adaptStoredWork({...stored, id: created.trabajoId});
const legacyAdapted = adaptStoredWork({id: "legacy-work", titulo: "Legacy", creadoEn: "2025-01-02T12:00:00.000Z"});
assert.equal(legacyAdapted.cotizacionesVinculadas, 0); assert.equal(legacyAdapted.ventasVinculadas, 0); assert.equal(legacyAdapted.modeloExpedienteVersion, 0);
assert.equal(legacyAdapted.gastosMontoTotal, 0); assert.equal(legacyAdapted.horasHombreCantidadTotal, 0); assert.equal(legacyAdapted.horasHombreCostoTotal, 0);
assert.equal(legacyAdapted.fechaInicio, ""); assert.equal(legacyAdapted.creadoEn, "2025-01-02T12:00:00.000Z");
assert.equal(matchesWorkFilters(adapted, {query: "constructora sur", estado: "todos", prioridad: "todas", responsableUid: "todos"}), true);
const mutation = buildWorkMutationPayload({...input(), numero: "TRB-FAKE", clienteSnapshot: {nombre: "Falso"}, creadoPorUid: "fake"});
assert.equal("numero" in mutation, false); assert.equal("clienteSnapshot" in mutation, false); assert.equal("creadoPorUid" in mutation, false);
assert.equal(humanizeWorkEvent({tipo: "nota_agregada", actorSnapshot: {nombre: "Mauricio"}}), "Mauricio agregó una nota.");
assert.doesNotMatch(humanizeWorkEvent({tipo: "venta_confirmada", actorSnapshot: {nombre: "Mauricio"}, detalle: {numero: "VTA-1", total: 119000, moneda: "USD"}}, {includeAmounts: false}), /119|USD/);
console.log("OK frontend: búsqueda, payload restringido y eventos sin UID crudo");

const rules = fs.readFileSync("firestore.rules", "utf8");
const page = fs.readFileSync("src/pages/WorksPage.jsx", "utf8");
const styles = fs.readFileSync("src/features/works/works.css", "utf8");
const backend = fs.readFileSync("functions/workPersistence.js", "utf8");
assert.match(rules, /match \/trabajos\/\{trabajoId\}/); assert.match(rules, /match \/historial\/\{eventoId\}[\s\S]*allow create, update, delete: if false/); assert.match(rules, /match \/documentacion\/\{documentacionId\}/);
assert.match(backend, /workCounters/); assert.match(backend, /workCreateRequests/); assert.match(backend, /workTaskRequests/); assert.match(backend, /workCostRequests/); assert.match(backend, /requireBusinessAccess/);
assert.match(backend, /runTransaction[\s\S]*transaction\.get\(counterRef\)[\s\S]*transaction\.set\(counterRef/);
assert.match(page, /ResponsiveDialog/); assert.doesNotMatch(page, /window\.confirm|actorUid/); assert.match(page, /works-board/); assert.match(page, /Historial del trabajo/); assert.match(page, /TaskSection/); assert.match(page, /FinancialSection/); assert.match(page, /No tienes tareas asignadas/);
assert.match(page, /\+ Nuevo cliente/); assert.match(page, /openCreateClient/); assert.match(page, /editingWork \|\| hasAdditionalMembers/);
assert.match(page, /Responsable principal/); assert.match(page, /Equipo de trabajo/); assert.doesNotMatch(page, /<Field[^>]+label="Número"/);
assert.match(page, /member\.uid === currentUserUid && member\.estado === "activo"/); assert.match(page, /responsableUid: currentMember\?\.uid \|\| ""/);
assert.match(page, /label="Cotización asociada" optional/); assert.match(page, /Sin cotización/); assert.match(page, /getEligibleWorkQuoteOptions/);
assert.match(page, /label="Descripción" optional/); assert.match(page, /label="Cliente" optional/); assert.match(page, /label="Responsable" optional/); assert.match(page, /label="Fecha de inicio" optional/); assert.match(page, /label="Fecha de término" optional/);
assert.match(page, /Escribe un nombre breve para identificar el proyecto/); assert.match(page, /Describe el requerimiento o lo informado por el cliente/); assert.match(page, /El número TRB y el estado Pendiente se asignarán automáticamente\./);
assert.doesNotMatch(page, /Nueva cotización/); assert.doesNotMatch(page, /fecha de ingreso se asignarán automáticamente/);
assert.match(styles, /works-form-automatic-note/); assert.match(styles, /@media\(min-width:768px\)[\s\S]*works-form-dialog \.responsive-dialog__body/);
assert.match(page, /function DetailDisclosure[\s\S]*<details className="works-detail-disclosure">/); assert.match(page, /className="works-costs-focus"/); assert.match(page, /title="Notas y documentación"/); assert.match(page, /title="Historial del trabajo"/);
assert.match(page, /<h3>Resumen<\/h3>[\s\S]*<TaskSection[\s\S]*<h3>Costos<\/h3>[\s\S]*title="Notas y documentación"[\s\S]*title="Historial del trabajo"/);
assert.match(page, /Aún no hay venta confirmada para calcular resultado y rentabilidad\./); assert.match(page, /Aún no se han registrado consumos adicionales\./); assert.match(page, /Aún no se han registrado gastos\./); assert.match(page, /Aún no se han registrado horas hombre\./);
assert.match(page, /Materiales incluidos en la venta/); assert.match(page, /Registra aquí sólo consumos adicionales del proyecto/); assert.match(page, /Costo estimado de esta salida/);
assert.match(page, /Costo acumulado/); assert.match(page, /Último avance/); assert.match(page, /Sin actividad reciente/); assert.match(page, /Completar igualmente/); assert.match(page, /Motivo de espera/);
assert.match(page, /TaskCostSelect/); assert.match(page, /Costos por día/); assert.match(page, /Nueva subtarea/); assert.match(page, /subtask\.completada/);
assert.match(backend, /agregarSubtareaTrabajoHandler/); assert.match(backend, /actualizarSubtareaTrabajoHandler/); assert.match(backend, /eliminarSubtareaTrabajoHandler/); assert.match(backend, /tareaId: taskId/);
assert.match(styles, /works-detail-disclosure\[open\]/); assert.match(styles, /works-commercial-list[\s\S]*grid-template-columns/);
console.log("OK integración: Rules, autoridad backend, lista/tablero y confirmación segura");

console.log("WORKS_MODEL_SMOKE_OK");
