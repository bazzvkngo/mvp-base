import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import * as workDomain from "../src/domain/workModel.mjs";
import {adaptStoredWork, adaptWorkExpense, adaptWorkLabor, adaptWorkLink, adaptWorkMaterialMovement, adaptWorkTask, adaptWorkTaskDocumentation, buildQuickWorkCreationPayload, buildWorkDailyCostSummary, buildWorkMutationPayload, canManageWorks, formatWorkNumber as formatFrontendNumber, getEligibleWorkQuoteOptions, getInventoryCurrentCost, getTaskProgress, getWorkCostSummary, getWorkDraftErrors, getWorkHistoricalPersonIdentity, getWorkMemberIdentity, getWorkMemberOptionLabel, getWorkOperationalIndicators, describeWorkTaskDeletionBlockers, getWorkSaleMaterials, getWorkTaskDeletionBlockers, getWorkTaskDeletionState, getWorkTaskProgress, hasAdditionalWorkMembers, humanizeWorkEvent, isWorkOperationalReadOnly, matchesWorkFilters, resolveWorkMaterialScan, WORK_MODEL_VERSION} from "../src/domain/workModel.mjs";

const require = createRequire(import.meta.url);
const {actualizarSubtareaTrabajoHandler, actualizarTrabajoHandler, agregarNotaTrabajoHandler, agregarSubtareaTrabajoHandler, anularGastoTrabajoHandler, anularHorasHombreTrabajoHandler, asignarTareaTrabajoHandler, cambiarEstadoTareaTrabajoV2Handler, cambiarEstadoTrabajoHandler, crearTareaTrabajoV2Handler, crearTrabajoHandler, documentarTareaTrabajoHandler, eliminarSubtareaTrabajoHandler, eliminarTareaTrabajoV2Handler, formatWorkNumber, normalizeWorkInput, registrarDevolucionMaterialTrabajoHandler, registrarGastoTrabajoHandler, registrarHorasHombreTrabajoHandler, registrarSalidaMaterialTrabajoHandler, WORK_EXPENSE_CATEGORIES, writeCommercialLink, writeQuoteResponseEvent, writeSaleConfirmationEvent} = require("../functions/workPersistence.js");

class TestHttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
class Snapshot { constructor(ref, value) { this.id = ref.id; this.exists = value !== undefined; this.value = value; } data() { return this.value; } }
class DocRef { constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); } collection(name) { return new CollectionRef(this.db, `${this.path}/${name}`); } }
// Consultas mínimas (igualdad encadenada + limit) para transaction.get(query): documentos hijos directos de la colección.
class QueryRef {
  constructor(db, path, filters = [], max = Infinity) { this.db = db; this.path = path; this.filters = filters; this.max = max; }
  where(field, operator, value) { assert.equal(operator, "==", "FakeDb solo soporta igualdad"); return new QueryRef(this.db, this.path, [...this.filters, [field, value]], this.max); }
  limit(count) { return new QueryRef(this.db, this.path, this.filters, count); }
}
class CollectionRef extends QueryRef { constructor(db, path) { super(db, path); } doc(id) { return new DocRef(this.db, `${this.path}/${id || `auto_${++this.db.autoId}`}`); } }
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
        get: async (ref) => {
          if (ref instanceof QueryRef) {
            const prefix = `${ref.path}/`;
            const docs = [...working.entries()]
              .filter(([path, value]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/") && ref.filters.every(([field, expected]) => value?.[field] === expected))
              .slice(0, ref.max)
              .map(([path, value]) => new Snapshot(new DocRef(this, path), structuredClone(value)));
            return {docs, empty: docs.length === 0, size: docs.length};
          }
          return new Snapshot(ref, working.has(ref.path) ? structuredClone(working.get(ref.path)) : undefined);
        },
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
assert.equal(getWorkMemberIdentity(null), "Usuario sin identificar");
assert.equal(getWorkMemberIdentity(undefined), "Usuario sin identificar");
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
// Esta tarea ya tiene documentación (avance y cierre): el motivo del bloqueo es ese, no su versión (SPEC 028 §4.2).
await assert.rejects(() => eliminarTareaTrabajoV2Handler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, requestId: "task-delete-v2"}), dependencies), (error) => error.code === "failed-precondition" && error.message === describeWorkTaskDeletionBlockers(["documentación"]));
assert.ok(db.read(`${workPath}/tareas/${task.tareaId}`), "la tarea documentada se conserva");
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

// SPEC 028 §4.2: eliminar tareas. Se bloquea con costos (también anulados) o documentación, y no se elimina una
// tarea completada. Proyecto propio para no alterar los contadores ni el historial del flujo anterior.
{
  const deleteWorkId = "work-task-delete";
  const otherWorkId = "work-task-delete-other";
  const deletePath = `negocios/business-a/trabajos/${deleteWorkId}`;
  const baseWork = {negocioId: "business-a", trabajoId: deleteWorkId, titulo: "Eliminar tareas", estado: "en_progreso", moneda: "USD", responsableUid: "worker-a", participanteUids: [], tareasTotal: 0, tareasCompletadas: 0, progresoAcumulado: 0, progresoPct: 0, materialesSalidasTotal: 0, materialesCostoTotal: 0};
  db.seed(deletePath, baseWork);
  db.seed(`negocios/business-a/trabajos/${otherWorkId}`, {...baseWork, trabajoId: otherWorkId});
  db.seed("negocios/business-a/inventario/product-task-delete", {negocioId: "business-a", itemId: "product-task-delete", tipoItem: "producto", estado: "activo", nombre: "Material de prueba", unidad: "unidad", stock: 20, costoPromedio: 1000, costoBase: 1000});
  db.seed("membresias/business-a__member-x", {negocioId: "business-a", uid: "member-x", rol: "MEMBER", estado: "activo"});
  let sequence = 0;
  const requestId = (label) => `task-del-${label}-${++sequence}`;
  const taskPath = (id) => `${deletePath}/tareas/${id}`;
  const base = {businessId: "business-a", trabajoId: deleteWorkId};
  const createTask = async (title) => (await crearTareaTrabajoV2Handler(request("owner-a", {...base, requestId: requestId("create"), tarea: {titulo: title, descripcion: "", responsableUid: "worker-a"}}), dependencies)).tareaId;
  const removeTask = (uid, taskId, id = requestId("delete"), businessId = "business-a") => eliminarTareaTrabajoV2Handler(request(uid, {...base, businessId, tareaId: taskId, requestId: id}), dependencies);
  const setTaskState = (taskId, estado) => cambiarEstadoTareaTrabajoV2Handler(request("owner-a", {...base, tareaId: taskId, estado, requestId: requestId(`state-${estado}`)}), dependencies);
  const expenseFor = (taskId) => registrarGastoTrabajoHandler(request("owner-a", {...base, requestId: requestId("expense"), gasto: {concepto: "Compra", monto: 1000, categoria: "OTRO", responsableDelGastoUid: "", fecha: "2026-08-14", observacion: "", tareaId: taskId}}), dependencies);
  const laborFor = (taskId) => registrarHorasHombreTrabajoHandler(request("owner-a", {...base, requestId: requestId("labor"), horasHombre: {tecnicoUid: "worker-c", horas: 2, costoHora: 5000, fecha: "2026-08-14", concepto: "Configuración", tareaId: taskId}}), dependencies);
  const materialExitFor = (taskId, cantidad = 1) => registrarSalidaMaterialTrabajoHandler(request("owner-a", {...base, itemId: "product-task-delete", cantidad, fecha: "2026-08-14", tareaId: taskId, requestId: requestId("material")}), dependencies);
  const documentFor = (taskId) => documentarTareaTrabajoHandler(request("owner-a", {...base, tareaId: taskId, requestId: requestId("document"), texto: "Avance registrado."}), dependencies);
  const assertBlocked = async (taskId, blockers) => {
    await assert.rejects(() => removeTask("owner-a", taskId), (error) => error.code === "failed-precondition" && error.message === describeWorkTaskDeletionBlockers(blockers));
    assert.ok(db.read(taskPath(taskId)), `la tarea con ${blockers.join(", ")} se conserva`);
  };
  const deletedEvents = (taskId) => db.matching(`${deletePath}/historial/`).filter(([, value]) => value.tipo === "tarea_eliminada" && value.detalle.tareaId === taskId).length;

  // Tarea limpia: se elimina y el avance del proyecto se recalcula. Idempotencia por requestId.
  const keptTask = await createTask("Tarea que se queda");
  const cleanTask = await createTask("Tarea limpia");
  assert.equal(db.read(deletePath).tareasTotal, 2);
  const cleanRequest = requestId("delete-clean");
  assert.equal((await removeTask("owner-a", cleanTask, cleanRequest)).idempotent, false);
  assert.equal(db.read(taskPath(cleanTask)), undefined); assert.equal(db.read(deletePath).tareasTotal, 1); assert.equal(deletedEvents(cleanTask), 1);
  assert.ok(db.read(`negocios/business-a/workTaskRequests/${cleanRequest}`));
  assert.equal((await removeTask("owner-a", cleanTask, cleanRequest)).idempotent, true);
  assert.equal(db.read(deletePath).tareasTotal, 1); assert.equal(deletedEvents(cleanTask), 1, "el reintento no descuenta ni duplica el evento");
  await assert.rejects(() => removeTask("owner-a", keptTask, cleanRequest), (error) => error.code === "already-exists");
  await assert.rejects(() => removeTask("owner-a", cleanTask), (error) => error.code === "not-found" && error.message === "No se encontró la tarea.");
  assert.ok(db.read(taskPath(keptTask)));

  // En curso con subtareas (una completada): se elimina junto con sus subtareas y revierte su avance.
  const progressTask = await createTask("Tarea con subtareas");
  const wiring = await agregarSubtareaTrabajoHandler(request("owner-a", {...base, tareaId: progressTask, titulo: "Cablear", requestId: requestId("subtask")}), dependencies);
  await agregarSubtareaTrabajoHandler(request("owner-a", {...base, tareaId: progressTask, titulo: "Probar", requestId: requestId("subtask")}), dependencies);
  await actualizarSubtareaTrabajoHandler(request("owner-a", {...base, tareaId: progressTask, subtareaId: wiring.subtareaId, completada: true, requestId: requestId("subtask-check")}), dependencies);
  await setTaskState(progressTask, "en_progreso");
  assert.equal(db.read(deletePath).progresoAcumulado, 50); assert.equal(db.read(deletePath).tareasTotal, 2);
  await removeTask("owner-a", progressTask);
  assert.equal(db.read(taskPath(progressTask)), undefined);
  assert.equal(db.read(deletePath).progresoAcumulado, 0); assert.equal(db.read(deletePath).tareasTotal, 1); assert.equal(db.read(deletePath).progresoPct, 0);

  // Tarea legacy (v1) sin registros: también se elimina.
  const legacyId = "task-del-legacy-v1";
  db.seed(taskPath(legacyId), {tareaId: legacyId, negocioId: "business-a", trabajoId: deleteWorkId, titulo: "Checklist legacy", completada: false});
  db.seed(deletePath, {...db.read(deletePath), tareasTotal: db.read(deletePath).tareasTotal + 1});
  await removeTask("owner-a", legacyId);
  assert.equal(db.read(taskPath(legacyId)), undefined); assert.equal(db.read(deletePath).tareasTotal, 1);

  // Bloqueo por cada tipo de costo; el anulado también cuenta.
  const expenseTask = await createTask("Con gasto");
  const expenseOnTask = await expenseFor(expenseTask);
  await assertBlocked(expenseTask, ["gastos"]);
  await anularGastoTrabajoHandler(request("owner-a", {...base, gastoId: expenseOnTask.gastoId, motivo: "Monto incorrecto", requestId: requestId("annul-expense")}), dependencies);
  assert.equal(db.read(`${deletePath}/gastos/${expenseOnTask.gastoId}`).estado, "anulado");
  await assertBlocked(expenseTask, ["gastos"]);

  const laborTask = await createTask("Con horas hombre");
  const laborOnTask = await laborFor(laborTask);
  await assertBlocked(laborTask, ["horas hombre"]);
  await anularHorasHombreTrabajoHandler(request("owner-a", {...base, horasHombreId: laborOnTask.horasHombreId, motivo: "Registro duplicado", requestId: requestId("annul-labor")}), dependencies);
  assert.equal(db.read(`${deletePath}/horasHombre/${laborOnTask.horasHombreId}`).estado, "anulado");
  await assertBlocked(laborTask, ["horas hombre"]);

  for (const [estado, label] of [["PENDIENTE_COBRO", "pendiente"], ["ANULADO", "anulado"]]) {
    const additionalTask = await createTask(`Con adicional ${label}`);
    db.seed(`${deletePath}/adicionales/additional-${label}`, {negocioId: "business-a", trabajoId: deleteWorkId, adicionalId: `additional-${label}`, tareaId: additionalTask, estado});
    await assertBlocked(additionalTask, ["adicionales"]);
  }

  const materialTask = await createTask("Con material");
  const materialExit = await materialExitFor(materialTask, 2);
  await assertBlocked(materialTask, ["materiales"]);
  await registrarDevolucionMaterialTrabajoHandler(request("owner-a", {...base, movimientoOrigenId: materialExit.movimientoId, cantidad: 2, fecha: "2026-08-14", requestId: requestId("return")}), dependencies);
  await assertBlocked(materialTask, ["materiales"]);
  const returnOnlyTask = await createTask("Con devolución");
  db.seed("negocios/business-a/movimientosInventario/movement-return-only", {negocioId: "business-a", trabajoId: deleteWorkId, tareaId: returnOnlyTask, tipo: "DEVOLUCION_PROYECTO"});
  await assertBlocked(returnOnlyTask, ["materiales"]);

  // Documentación: registro real, contador sin subcolección y subcolección sin contador.
  const documentedTask = await createTask("Con documentación");
  await documentFor(documentedTask);
  await assertBlocked(documentedTask, ["documentación"]);
  const counterOnlyTask = await createTask("Con contador de documentación");
  db.seed(taskPath(counterOnlyTask), {...db.read(taskPath(counterOnlyTask)), documentacionTotal: 1});
  await assertBlocked(counterOnlyTask, ["documentación"]);
  const subcollectionOnlyTask = await createTask("Con documento suelto");
  db.seed(`${taskPath(subcollectionOnlyTask)}/documentacion/documentation-loose`, {negocioId: "business-a", trabajoId: deleteWorkId, tareaId: subcollectionOnlyTask});
  await assertBlocked(subcollectionOnlyTask, ["documentación"]);

  // Varias causas a la vez: un solo mensaje, en orden fijo, igual al del dominio del frontend.
  const multiTask = await createTask("Con varios registros");
  await expenseFor(multiTask); await materialExitFor(multiTask); await documentFor(multiTask);
  await assertBlocked(multiTask, ["gastos", "materiales", "documentación"]);
  assert.equal(describeWorkTaskDeletionBlockers(["gastos", "materiales", "documentación"]), "No se puede eliminar la tarea porque tiene registros de gastos, materiales y documentación. Los registros anulados también cuentan.");
  assert.equal(describeWorkTaskDeletionBlockers(["horas hombre"]), "No se puede eliminar la tarea porque tiene registros de horas hombre. Los registros anulados también cuentan.");
  assert.equal(describeWorkTaskDeletionBlockers([]), "");
  const storedCosts = {
    expenses: db.matching(`${deletePath}/gastos/`).map(([path, value]) => adaptWorkExpense({...value, id: path.split("/").at(-1)})),
    labor: db.matching(`${deletePath}/horasHombre/`).map(([path, value]) => adaptWorkLabor({...value, id: path.split("/").at(-1)})),
    materials: db.matching("negocios/business-a/movimientosInventario/").filter(([, value]) => value.trabajoId === deleteWorkId).map(([path, value]) => adaptWorkMaterialMovement({...value, id: path.split("/").at(-1)})),
    additionals: db.matching(`${deletePath}/adicionales/`).map(([, value]) => value),
  };
  assert.deepEqual(getWorkTaskDeletionBlockers(adaptWorkTask({...db.read(taskPath(multiTask)), id: multiTask}), storedCosts), ["gastos", "materiales", "documentación"], "el dominio del frontend coincide con el backend");
  assert.deepEqual(getWorkTaskDeletionBlockers(adaptWorkTask({...db.read(taskPath(laborTask)), id: laborTask}), storedCosts), ["horas hombre"]);
  assert.deepEqual(getWorkTaskDeletionBlockers({id: "free"}, storedCosts), []);
  assert.deepEqual(getWorkTaskDeletionBlockers({id: "x", documentacion: [{id: "d"}]}), ["documentación"]);
  assert.deepEqual(getWorkTaskDeletionBlockers({}, {expenses: [{tareaId: ""}]}), [], "sin id de tarea no hay causas");
  assert.deepEqual(getWorkTaskDeletionState({id: "x", estado: "completada", completada: true, documentacionTotal: 3}), {canDelete: false, reason: "Reabre la tarea para poder eliminarla."}, "la tarea completada va primero, igual que en el backend");
  assert.deepEqual(getWorkTaskDeletionState({id: "x", estado: "pendiente"}), {canDelete: true, reason: ""});
  assert.equal(getWorkTaskDeletionState({id: "x", estado: "en_progreso"}, {expenses: [{tareaId: "x"}]}).reason, describeWorkTaskDeletionBlockers(["gastos"]));

  // Completada: no se elimina (v2 y legacy); reabierta y limpia, sí.
  const completedTask = await createTask("Completada");
  await setTaskState(completedTask, "completada");
  await assert.rejects(() => removeTask("owner-a", completedTask), (error) => error.code === "failed-precondition" && error.message === "Reabre la tarea antes de eliminarla.");
  const completedLegacyId = "task-del-legacy-completed";
  db.seed(taskPath(completedLegacyId), {tareaId: completedLegacyId, negocioId: "business-a", trabajoId: deleteWorkId, titulo: "Legacy completada", completada: true});
  await assert.rejects(() => removeTask("owner-a", completedLegacyId), (error) => error.code === "failed-precondition" && error.message === "Reabre la tarea antes de eliminarla.");
  assert.ok(db.read(taskPath(completedTask))); assert.ok(db.read(taskPath(completedLegacyId)));
  await setTaskState(completedTask, "pendiente");
  await removeTask("owner-a", completedTask);
  assert.equal(db.read(taskPath(completedTask)), undefined);

  // Proyecto completado o cancelado: las tareas no se modifican.
  const terminalTask = await createTask("En proyecto cerrado");
  for (const estado of ["completado", "cancelado"]) {
    db.seed(deletePath, {...db.read(deletePath), estado});
    await assert.rejects(() => removeTask("owner-a", terminalTask), (error) => error.code === "failed-precondition" && error.message === "Reabre el trabajo antes de modificar sus tareas.");
  }
  db.seed(deletePath, {...db.read(deletePath), estado: "en_progreso"});
  await removeTask("owner-a", terminalTask);
  assert.equal(db.read(taskPath(terminalTask)), undefined);

  // Aislamiento: costos de otro proyecto con el mismo tareaId no bloquean (ni los de otras tareas del mismo proyecto).
  const isolatedTask = await createTask("Aislada");
  db.seed(`negocios/business-a/trabajos/${otherWorkId}/gastos/foreign-expense`, {negocioId: "business-a", trabajoId: otherWorkId, tareaId: isolatedTask, estado: "vigente"});
  db.seed("negocios/business-a/movimientosInventario/foreign-movement", {negocioId: "business-a", trabajoId: otherWorkId, tareaId: isolatedTask, tipo: "SALIDA_PROYECTO"});
  await removeTask("owner-a", isolatedTask);
  assert.equal(db.read(taskPath(isolatedTask)), undefined);

  // Roles: solo OWNER/ADMIN; TECNICO (aun siendo responsable), MEMBER, otro negocio y sin sesión quedan fuera.
  const roleTask = await createTask("Rol");
  await assert.rejects(() => removeTask("worker-a", roleTask), (error) => error.code === "permission-denied");
  await assert.rejects(() => removeTask("member-x", roleTask), (error) => error.code === "permission-denied");
  await assert.rejects(() => removeTask("owner-a", roleTask, requestId("delete-cross"), "business-b"), (error) => error.code === "permission-denied");
  await assert.rejects(() => removeTask("", roleTask), (error) => error.code === "unauthenticated");
  assert.ok(db.read(taskPath(roleTask)));
  await removeTask("worker-b", roleTask);
  assert.equal(db.read(taskPath(roleTask)), undefined);
  console.log("OK eliminar tareas: limpia v2/v1 con avance recalculado, bloqueo por gastos/HH/adicionales/materiales/documentación (también anulados), completada, proyecto cerrado, aislamiento, roles e idempotencia");
}

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

const unitCostRegressionWorkId = "work-material-unit-cost";
const unitCostRegressionWorkPath = `negocios/business-a/trabajos/${unitCostRegressionWorkId}`;
const unitCostRegressionProductPath = "negocios/business-a/inventario/product-unit-cost";
db.seed(unitCostRegressionWorkPath, {negocioId: "business-a", trabajoId: unitCostRegressionWorkId, titulo: "Regresión costo unitario", estado: "en_progreso", moneda: "USD", materialesSalidasTotal: 0, materialesCostoTotal: 0});
db.seed(unitCostRegressionProductPath, {negocioId: "business-a", itemId: "product-unit-cost", tipoItem: "producto", estado: "activo", nombre: "Material unitario", unidad: "unidad", stock: 4, costoPromedio: 24972, costoBase: 999});
const unitCostRegressionProduct = db.read(unitCostRegressionProductPath);
assert.equal(getInventoryCurrentCost(unitCostRegressionProduct), 24972);
assert.equal(getInventoryCurrentCost(unitCostRegressionProduct) * 1, 24972);
const unitCostRegressionExit = await registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: unitCostRegressionWorkId, itemId: "product-unit-cost", cantidad: 1, fecha: "2026-08-14", requestId: "material-unit-cost-regression"}), dependencies);
const unitCostRegressionMovements = db.matching("negocios/business-a/movimientosInventario/").map(([, value]) => value).filter((value) => value.trabajoId === unitCostRegressionWorkId);
assert.equal(db.read(unitCostRegressionProductPath).stock, 3);
assert.equal(unitCostRegressionMovements.length, 1);
assert.equal(unitCostRegressionMovements[0].tipo, "SALIDA_PROYECTO");
assert.equal(unitCostRegressionExit.costoUnitario, 24972);
assert.equal(unitCostRegressionExit.costoTotal, 24972);
assert.equal(unitCostRegressionMovements[0].costoTotal, 24972);
assert.equal(db.read(unitCostRegressionWorkPath).materialesCostoTotal, 24972);
assert.notEqual(db.read(unitCostRegressionWorkPath).materialesCostoTotal, 99888);
console.log("OK regresión materiales: stock 4, costo unitario 24.972 y salida 1 imputan 24.972, no 99.888");

const exactClosureWorkId = "work-material-exact-closure";
const exactClosureWorkPath = `negocios/business-a/trabajos/${exactClosureWorkId}`;
const exactClosureProductPath = "negocios/business-a/inventario/product-exact-closure";
db.seed(exactClosureWorkPath, {negocioId: "business-a", trabajoId: exactClosureWorkId, titulo: "Cierre exacto Q/V", estado: "en_progreso", moneda: "USD", materialesSalidasTotal: 0, materialesDevolucionesTotal: 0, materialesCostoTotal: 0});
db.seed(exactClosureProductPath, {negocioId: "business-a", itemId: "product-exact-closure", tipoItem: "producto", estado: "activo", nombre: "Material de costo fraccionario", unidad: "unidad", stock: 20000, modeloCostoInventarioVersion: 1, valorInventario: 101, valorInventarioMoneda: "USD", costoPromedio: 0.0051, costoPromedioMoneda: "USD"});
const exactClosureExit = await registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: exactClosureWorkId, itemId: "product-exact-closure", cantidad: 20000, fecha: "2026-08-14", requestId: "material-exact-closure-exit"}), dependencies);
const exactClosureAfterExit = db.read(exactClosureProductPath);
assert.deepEqual([exactClosureAfterExit.stock, exactClosureAfterExit.valorInventario, exactClosureAfterExit.costoPromedio], [0, 0, null]);
assert.equal(exactClosureExit.costoTotal, 101);
const exactClosureReturn = await registrarDevolucionMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: exactClosureWorkId, movimientoOrigenId: exactClosureExit.movimientoId, cantidad: 20000, fecha: "2026-08-14", requestId: "material-exact-closure-return"}), dependencies);
const exactClosureAfterReturn = db.read(exactClosureProductPath);
assert.deepEqual([exactClosureAfterReturn.stock, exactClosureAfterReturn.valorInventario, exactClosureAfterReturn.costoPromedio], [20000, 101, 0.0051]);
assert.equal(exactClosureReturn.costoTotal, 101);
const exactClosureMovementsBeforeInvalid = db.matching("negocios/business-a/movimientosInventario/").length;
await assert.rejects(
  registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: exactClosureWorkId, itemId: "product-exact-closure", cantidad: 1.0000004, fecha: "2026-08-14", requestId: "material-noncanonical-quantity"}), dependencies),
  (error) => error.code === "invalid-argument"
);
assert.deepEqual([db.read(exactClosureProductPath).stock, db.read(exactClosureProductPath).valorInventario], [20000, 101]);
assert.equal(db.matching("negocios/business-a/movimientosInventario/").length, exactClosureMovementsBeforeInvalid);
console.log("OK materiales Q/V: salida total, devoluciÃ³n exacta y cantidad no canÃ³nica sin efectos");

const completedGuardWorkId = "work-completed-cost-guard";
const completedGuardWorkPath = `negocios/business-a/trabajos/${completedGuardWorkId}`;
const completedGuardProductPath = "negocios/business-a/inventario/product-completed-guard";
db.seed(completedGuardWorkPath, {
  negocioId: "business-a",
  trabajoId: completedGuardWorkId,
  titulo: "Cierre autoritativo de costos",
  estado: "en_progreso",
  moneda: "USD",
  gastosVigentesTotal: 0,
  gastosMontoTotal: 0,
  gastosMontoDirecto: 0,
  gastosMontoIndirecto: 0,
  gastosMaterialMontoTotal: 0,
  horasHombreVigentesTotal: 0,
  horasHombreCantidadTotal: 0,
  horasHombreCostoTotal: 0,
  materialesSalidasTotal: 0,
  materialesDevolucionesTotal: 0,
  materialesCostoTotal: 0,
});
db.seed(completedGuardProductPath, {negocioId: "business-a", itemId: "product-completed-guard", tipoItem: "producto", estado: "activo", nombre: "Producto protegido", unidad: "unidad", stock: 4, costoPromedio: 1000});
const openGuardExit = await registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, itemId: "product-completed-guard", cantidad: 1, fecha: "2026-08-14", requestId: "completed-guard-material-open"}), dependencies);
const openGuardExpense = await registrarGastoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, requestId: "completed-guard-expense-open", gasto: {concepto: "Gasto previo al cierre", monto: 200, categoria: "OPERATIVO", responsableDelGastoUid: "owner-a", fecha: "2026-08-14"}}), dependencies);
const openGuardLabor = await registrarHorasHombreTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, requestId: "completed-guard-labor-open", horasHombre: {tecnicoUid: "worker-a", horas: 1, costoHora: 300, fecha: "2026-08-14", concepto: "HH previa al cierre"}}), dependencies);
assert.equal(db.read(completedGuardProductPath).stock, 3);
assert.equal(db.read(completedGuardWorkPath).materialesCostoTotal, 1000);
await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, estado: "completado"}), dependencies);
const completedGuardCostInput = () => ({
  expenses: db.matching(`${completedGuardWorkPath}/gastos/`).map(([, value]) => adaptWorkExpense(value)),
  labor: db.matching(`${completedGuardWorkPath}/horasHombre/`).map(([, value]) => adaptWorkLabor(value)),
  materials: db.matching("negocios/business-a/movimientosInventario/").map(([, value]) => adaptWorkMaterialMovement(value)).filter((value) => value.trabajoId === completedGuardWorkId),
});
const completedGuardBalanceBefore = getWorkCostSummary(completedGuardCostInput());
const completedGuardDocumentsBefore = structuredClone([...db.documents.entries()]);
const rejectsCompletedCostMutation = (operation) => assert.rejects(operation, (error) => error.code === "failed-precondition" && /antes de modificar sus costos/.test(error.message));
await rejectsCompletedCostMutation(() => registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, itemId: "product-completed-guard", cantidad: 1, fecha: "2026-08-15", requestId: "completed-guard-material-closed"}), dependencies));
await rejectsCompletedCostMutation(() => registrarDevolucionMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, movimientoOrigenId: openGuardExit.movimientoId, cantidad: 1, fecha: "2026-08-15", requestId: "completed-guard-return-closed"}), dependencies));
await rejectsCompletedCostMutation(() => registrarGastoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, requestId: "completed-guard-expense-closed", gasto: {concepto: "Gasto bloqueado", monto: 50, categoria: "OPERATIVO", responsableDelGastoUid: "owner-a", fecha: "2026-08-15"}}), dependencies));
await rejectsCompletedCostMutation(() => anularGastoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, gastoId: openGuardExpense.gastoId, motivo: "No debe anularse cerrado", requestId: "completed-guard-expense-annul"}), dependencies));
await rejectsCompletedCostMutation(() => registrarHorasHombreTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, requestId: "completed-guard-labor-closed", horasHombre: {tecnicoUid: "worker-a", horas: 1, costoHora: 300, fecha: "2026-08-15", concepto: "HH bloqueada"}}), dependencies));
await rejectsCompletedCostMutation(() => anularHorasHombreTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, horasHombreId: openGuardLabor.horasHombreId, motivo: "No debe anularse cerrado", requestId: "completed-guard-labor-annul"}), dependencies));
assert.equal(db.read(completedGuardProductPath).stock, 3);
assert.equal(db.read(`${completedGuardWorkPath}/gastos/${openGuardExpense.gastoId}`).estado, "vigente");
assert.equal(db.read(`${completedGuardWorkPath}/horasHombre/${openGuardLabor.horasHombreId}`).estado, "vigente");
assert.deepEqual(getWorkCostSummary(completedGuardCostInput()), completedGuardBalanceBefore);
assert.deepEqual([...db.documents.entries()], completedGuardDocumentsBefore);
await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, estado: "en_progreso"}), dependencies);
const reopenedGuardExit = await registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, itemId: "product-completed-guard", cantidad: 1, fecha: "2026-08-16", requestId: "completed-guard-material-reopened"}), dependencies);
assert.equal(reopenedGuardExit.costoTotal, 1000);
assert.equal(db.read(completedGuardProductPath).stock, 2);
console.log("OK cierre autoritativo: costos bloqueados sin escrituras parciales y habilitados tras reapertura");

await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, estado: "cancelado"}), dependencies);
const canceledGuardStockBefore = db.read(completedGuardProductPath).stock;
await rejectsCompletedCostMutation(() => registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, itemId: "product-completed-guard", cantidad: 1, fecha: "2026-08-17", requestId: "canceled-guard-material"}), dependencies));
await rejectsCompletedCostMutation(() => registrarGastoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, requestId: "canceled-guard-expense", gasto: {concepto: "Gasto cancelado", monto: 50, categoria: "OPERATIVO", responsableDelGastoUid: "owner-a", fecha: "2026-08-17"}}), dependencies));
await rejectsCompletedCostMutation(() => registrarHorasHombreTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: completedGuardWorkId, requestId: "canceled-guard-labor", horasHombre: {tecnicoUid: "worker-a", horas: 1, costoHora: 300, fecha: "2026-08-17", concepto: "HH cancelada"}}), dependencies));
assert.equal(db.read(completedGuardProductPath).stock, canceledGuardStockBefore);
console.log("OK cancelación autoritativa: materiales, gastos y HH quedan bloqueados sin alterar stock");

const productPath = "negocios/business-a/inventario/product-a";
db.seed(productPath, {negocioId: "business-a", itemId: "product-a", tipoItem: "producto", estado: "activo", nombre: "Cable THHN", codigoInterno: "MAT-001", unidad: "metro", stock: 10, costoPromedio: 800, costoBase: 1000});
db.seed("negocios/business-a/inventario/service-a", {negocioId: "business-a", itemId: "service-a", tipoItem: "servicio", estado: "activo", nombre: "Instalación", stock: 10, costoBase: 500});
const materialExitRequest = request("worker-a", {businessId: "business-a", trabajoId: created.trabajoId, itemId: "product-a", cantidad: 5, fecha: "2026-08-14", costoTotal: 1, requestId: "material-exit-0001"});
const materialExit = await registrarSalidaMaterialTrabajoHandler(materialExitRequest, dependencies);
const materialExitRetry = await registrarSalidaMaterialTrabajoHandler(materialExitRequest, dependencies);
assert.equal(materialExit.costoUnitario, 800); assert.equal(materialExit.costoTotal, 4000); assert.equal(materialExitRetry.idempotent, true);
assert.equal(db.read(productPath).stock, 5);
assert.equal(db.read(productPath).valorInventario, 4000);
assert.equal(db.read(productPath).costoPromedio, 800);
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
assert.equal(fullReturn.costoUnitario, 800); assert.equal(fullReturn.costoTotal, 2400); assert.equal(fullReturn.cantidadPendiente, 0); assert.equal(db.read(productPath).stock, 10); assert.equal(db.read(productPath).valorInventario, 8000); assert.equal(db.read(productPath).costoPromedio, 800); assert.equal(db.read(workPath).materialesCostoTotal, 0);
materialMovements = db.matching("negocios/business-a/movimientosInventario/").map(([, value]) => value).filter((value) => value.trabajoId === created.trabajoId);
assert.equal(materialMovements.length, 3); assert.equal(materialMovements.filter((value) => value.tipo === "DEVOLUCION_PROYECTO").length, 2);
assert.equal(materialMovements.find((value) => value.movimientoId === materialExit.movimientoId).cantidadDevuelta, undefined);
assert.equal(adaptWorkMaterialMovement(materialMovements[1]).movimientoOrigenId, materialExit.movimientoId);
db.seed("negocios/business-a/inventario/product-base", {negocioId: "business-a", itemId: "product-base", tipoItem: "producto", estado: "activo", nombre: "Conector", unidad: "unidad", stock: 2, costoBase: 250});
const baseCostExit = await registrarSalidaMaterialTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, itemId: "product-base", cantidad: 1, fecha: "2026-08-16", tareaId: task.tareaId, requestId: "material-base-cost"}), dependencies);
assert.equal(baseCostExit.costoUnitario, 250); assert.equal(baseCostExit.costoTotal, 250);
assert.equal(db.read("negocios/business-a/inventario/product-base").valorInventario, 250);
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
assert.equal(humanizeWorkEvent({tipo: "nota_agregada", actorSnapshot: {nombre: "Sin nombre registrado", correo: "persona@example.cl"}}), "persona@example.cl agregó una nota.");
assert.doesNotMatch(humanizeWorkEvent({tipo: "venta_confirmada", actorSnapshot: {nombre: "Mauricio"}, detalle: {numero: "VTA-1", total: 119000, moneda: "USD"}}, {includeAmounts: false}), /119|USD/);
assert.equal(getWorkHistoricalPersonIdentity({nombre: "Nombre histórico", correo: "historico@example.cl"}, "worker-a", [{uid: "worker-a", nombre: "Nombre actual"}]), "Nombre histórico");
assert.equal(getWorkHistoricalPersonIdentity({nombre: "Sin nombre registrado", correo: "historico@example.cl"}, "worker-a", [{uid: "worker-a", nombre: "Nombre actual"}]), "Nombre actual");
assert.equal(getWorkHistoricalPersonIdentity({nombre: "Sin nombre registrado", correo: "historico@example.cl"}, "", []), "historico@example.cl");
assert.equal(getWorkHistoricalPersonIdentity({}, "", [], "Persona histórica"), "Persona histórica");
assert.equal(getWorkHistoricalPersonIdentity(null, "", [], "Sin responsable principal"), "Sin responsable principal");
assert.equal(getWorkHistoricalPersonIdentity(undefined, "", [], "Sin responsable principal"), "Sin responsable principal");
assert.equal(humanizeWorkEvent({tipo: "nota_agregada", actorSnapshot: null}), "Una persona del equipo agregó una nota.");
assert.equal(isWorkOperationalReadOnly({estado: "completado"}), true);
assert.equal(isWorkOperationalReadOnly({estado: "cancelado"}), true);
assert.equal(isWorkOperationalReadOnly({estado: "en_progreso"}), false);
for (const estado of ["pendiente", "en_espera"]) assert.equal(isWorkOperationalReadOnly({estado}), false);
console.log("OK frontend: búsqueda, payload restringido y eventos sin UID crudo");

// SPEC 028 etapa B2: tablero en tres columnas, lista de activos y vista Cerrados (dominio puro).
{
  const {WORK_BOARD_COLUMNS, WORK_CLOSED_BALANCE_LIMIT, getClosedWorks, getWorkClosedAt, getWorkClosedResultKind, getWorkDurationSummary, getWorkPersonShort, groupWorkTasksByBoardColumn, isWorkClosed, matchesWorkFilters, WORK_STATUSES, WORK_TASK_STATUSES, humanizeWorkEvent} = workDomain;
  // Tres columnas sobre los cuatro estados de siempre: el modelo de estados no cambia.
  assert.deepEqual(WORK_BOARD_COLUMNS.map((column) => column.label), ["Por hacer", "En curso", "Hecho"]);
  assert.deepEqual(WORK_TASK_STATUSES.map((entry) => entry.value), ["pendiente", "en_progreso", "en_espera", "completada"], "los estados de tarea no cambian");
  assert.deepEqual(WORK_TASK_STATUSES.map((entry) => [entry.value, entry.label]), [["pendiente", "Por hacer"], ["en_progreso", "En curso"], ["en_espera", "En espera"], ["completada", "Hecho"]], "tabla única de etiquetas de tarea: estado interno -> texto visible");
  assert.deepEqual(WORK_BOARD_COLUMNS.map((column) => [column.states[0], column.label]), [["pendiente", "Por hacer"], ["en_progreso", "En curso"], ["completada", "Hecho"]], "las columnas toman su etiqueta de la tabla de estados de tarea");
  assert.deepEqual(WORK_STATUSES.map((entry) => [entry.value, entry.label]), [["pendiente", "Pendiente"], ["en_progreso", "En progreso"], ["en_espera", "En espera"], ["completado", "Completado"], ["cancelado", "Cancelado"]], "los estados del proyecto son otra escala y no cambian");
  assert.match(humanizeWorkEvent({tipo: "estado_tarea_cambiado", actorSnapshot: {nombre: "Ana"}, detalle: {tareaTitulo: "Cableado", estadoNuevo: "completada"}}), /a Hecho./, "el historial usa la misma tabla");
  assert.deepEqual(WORK_BOARD_COLUMNS.flatMap((column) => column.states).sort(), WORK_TASK_STATUSES.map((entry) => entry.value).sort(), "cada estado cae en exactamente una columna");
  const grouped = groupWorkTasksByBoardColumn([
    {id: "wait", estado: "en_espera"}, {id: "done", estado: "completada"}, {id: "todo", estado: "pendiente"}, {id: "doing-b", estado: "en_progreso"}, {id: "doing-a", estado: "en_progreso"}, {id: "wait-2", estado: "en_espera"},
  ]);
  assert.deepEqual(grouped.map((column) => column.tasks.map((task) => task.id)), [["todo"], ["doing-b", "doing-a", "wait", "wait-2"], ["done"]], "En espera se agrupa en En curso, al final");
  assert.deepEqual(groupWorkTasksByBoardColumn(null).map((column) => column.tasks.length), [0, 0, 0]);
  // Iniciales y nombre corto.
  assert.deepEqual(getWorkPersonShort("Camila Torres Morales"), {initials: "CT", shortName: "Camila T."});
  assert.deepEqual(getWorkPersonShort("ana@dominio.cl"), {initials: "AN", shortName: "ana"});
  assert.deepEqual(getWorkPersonShort("Ana"), {initials: "AN", shortName: "Ana"});
  assert.deepEqual(getWorkPersonShort(""), {initials: "", shortName: ""});
  // Lista: solo activos por defecto; un estado cerrado pedido de forma explícita se respeta.
  const sample = [{id: "a", estado: "pendiente", numero: "TRB-1", titulo: "A"}, {id: "b", estado: "en_progreso", numero: "TRB-2", titulo: "B"}, {id: "c", estado: "en_espera", numero: "TRB-3", titulo: "C"}, {id: "d", estado: "completado", numero: "TRB-4", titulo: "D"}, {id: "e", estado: "cancelado", numero: "TRB-5", titulo: "E"}];
  assert.deepEqual(sample.filter((work) => matchesWorkFilters(work, {incluirCerrados: false})).map((work) => work.id), ["a", "b", "c"], "activos: pendiente, en progreso y en espera");
  assert.deepEqual(sample.filter((work) => matchesWorkFilters(work, {incluirCerrados: true})).map((work) => work.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(sample.filter((work) => matchesWorkFilters(work, {})).map((work) => work.id), ["a", "b", "c", "d", "e"], "sin la opción, el filtro se comporta como siempre");
  assert.deepEqual(sample.filter((work) => matchesWorkFilters(work, {incluirCerrados: false, estado: "completado"})).map((work) => work.id), ["d"]);
  assert.equal(isWorkClosed({estado: "completado"}) && isWorkClosed({estado: "cancelado"}) && !isWorkClosed({estado: "en_espera"}), true);
  // Cerrados: completados y cancelados, el cierre más reciente primero.
  const closedWorks = getClosedWorks([
    {id: "old", estado: "completado", fechaCompletado: "2026-03-01T12:00:00.000Z"},
    {id: "open", estado: "en_progreso"},
    {id: "cancel", estado: "cancelado", actualizadoEn: "2026-09-10T12:00:00.000Z"},
    {id: "new", estado: "completado", fechaCompletado: "2026-10-01T12:00:00.000Z"},
  ]);
  assert.deepEqual(closedWorks.map((work) => work.id), ["new", "cancel", "old"]);
  assert.equal(getWorkClosedAt({estado: "en_progreso", fechaCompletado: "2026-10-01T12:00:00.000Z"}), null);
  assert.equal(getWorkClosedAt({estado: "cancelado", actualizadoEn: "2026-09-10T12:00:00.000Z"}), "2026-09-10T12:00:00.000Z", "Cancelado no guarda fecha propia: usa la última actualización");
  assert.equal(WORK_CLOSED_BALANCE_LIMIT, 20);
  // Duración planificada contra real (días corridos, el día de inicio cuenta).
  assert.deepEqual(getWorkDurationSummary({estado: "completado", fechaInicio: "2026-10-01", fechaPrevista: "2026-10-10", fechaCompletado: "2026-10-13T15:00:00.000Z"}), {plannedDays: 10, actualDays: 13, deltaDays: 3});
  assert.deepEqual(getWorkDurationSummary({estado: "completado", fechaInicio: "2026-10-01", fechaCompletado: "2026-10-03T15:00:00.000Z"}), {plannedDays: null, actualDays: 3, deltaDays: null}, "sin término planificado no se inventa el plan");
  assert.deepEqual(getWorkDurationSummary({estado: "completado", fechaInicio: "2026-10-05", fechaPrevista: "2026-10-04", fechaCompletado: "2026-10-06T15:00:00.000Z"}).plannedDays, null, "un plan inválido no produce duración negativa");
  // Resultado: Ganó / Perdió solo con balance completo; nunca se inventa uno.
  assert.equal(getWorkClosedResultKind({estado: "COMPLETO", resultado: 1500}), "gano");
  assert.equal(getWorkClosedResultKind({estado: "COMPLETO", resultado: -1}), "perdio");
  assert.equal(getWorkClosedResultKind({estado: "COMPLETO", resultado: 0}), "equilibrio");
  assert.equal(getWorkClosedResultKind({estado: "PARCIAL_SIN_VENTA", resultado: null}), "no_disponible");
  assert.equal(getWorkClosedResultKind({estado: "INCONSISTENTE_MONEDA", resultado: 100}), "no_disponible");
  assert.equal(getWorkClosedResultKind(null), "no_disponible");
}
console.log("OK frontend: tres columnas (En espera dentro de En curso), lista de activos, cerrados, duración y resultado");

const rules = fs.readFileSync("firestore.rules", "utf8");
const page = fs.readFileSync("src/pages/WorksPage.jsx", "utf8");
const board = fs.readFileSync("src/features/works/WorkProjectBoard.jsx", "utf8");
const taskPanel = fs.readFileSync("src/features/works/WorkTaskPanel.jsx", "utf8");
const closedView = fs.readFileSync("src/features/works/WorkClosedProjects.jsx", "utf8");
const styles = fs.readFileSync("src/features/works/works.css", "utf8");
const backend = fs.readFileSync("functions/workPersistence.js", "utf8");
assert.match(rules, /match \/trabajos\/\{trabajoId\}/); assert.match(rules, /match \/historial\/\{eventoId\}[\s\S]*allow create, update, delete: if false/); assert.match(rules, /match \/documentacion\/\{documentacionId\}/);
assert.match(backend, /workCounters/); assert.match(backend, /workCreateRequests/); assert.match(backend, /workTaskRequests/); assert.match(backend, /workCostRequests/); assert.match(backend, /requireBusinessAccess/);
assert.match(backend, /runTransaction[\s\S]*transaction\.get\(counterRef\)[\s\S]*transaction\.set\(counterRef/);
assert.match(page, /ResponsiveDialog/); assert.doesNotMatch(page, /window\.confirm|actorUid/); assert.match(page, /<WorkProjectBoard/); assert.doesNotMatch(page, /function WorkBoard\(|<WorkBoard |TaskSection/, "el tablero ya no muestra tarjetas de proyectos ni la sección de tareas de la ficha"); assert.match(page, /Historial del trabajo/); assert.match(page, /FinancialSection/); assert.match(board, /No tienes tareas asignadas/);
assert.match(page, /\+ Nuevo cliente/); assert.match(page, /openCreateClient/); assert.match(page, /No hay otros miembros activos en tu negocio/); assert.doesNotMatch(page, /hasAdditionalMembers|editingWork \|\| hasAdditionalMembers/); assert.match(page, /<legend>Equipo</); assert.match(page, /participanteUids: draft\.participanteUids\.includes\(member\.uid\)|draft\.participanteUids\.includes\(member\.uid\)/);
assert.match(page, /Responsable principal/); assert.match(page, /Equipo adicional/); assert.match(page, /Sin integrantes/); assert.doesNotMatch(page, /<Field[^>]+label="Número"/);
assert.match(page, /member\.uid === currentUserUid && member\.estado === "activo"/); assert.match(page, /responsableUid: currentMember\?\.uid \|\| ""/);
assert.match(page, /label="Cotización asociada" optional/); assert.match(page, /<WorkQuoteSelector/); assert.match(page, /getEligibleWorkQuoteOptions/);
const quoteSelector = fs.readFileSync("src/features/works/WorkQuoteSelector.jsx", "utf8");
assert.match(quoteSelector, /Sin cotización asociada/); assert.doesNotMatch(quoteSelector, /firebase|firestore|getDocs|httpsCallable|onSnapshot/i);
assert.match(page, /label="Descripción" optional/); assert.match(page, /label="Cliente" optional/); assert.match(page, /label="Responsable" optional/); assert.match(page, /label="Inicio planificado" optional/); assert.match(page, /label="Término planificado" optional/); assert.match(page, /Completado el/);
assert.match(page, /Escribe un nombre breve para identificar el proyecto/); assert.match(page, /Describe el requerimiento o lo informado por el cliente/); assert.match(page, /El número TRB y el estado Pendiente se asignarán automáticamente\./);
assert.doesNotMatch(page, /Nueva cotización/); assert.doesNotMatch(page, /fecha de ingreso se asignarán automáticamente/);
assert.match(styles, /works-form-automatic-note/); assert.match(styles, /@media\(min-width:768px\)[\s\S]*works-form-dialog \.responsive-dialog__body/);
assert.match(page, /function DetailDisclosure[\s\S]*<details className="works-detail-disclosure"/); assert.doesNotMatch(page, /className="works-costs-focus"|id="operacion"/, "la ficha ya no trae la pestaña Operación: opera el tablero"); assert.match(page, /title="Notas del proyecto"/); assert.match(page, /title="Historial del trabajo"/);
assert.match(page, /id="datos"[\s\S]*id="comercial"[\s\S]*<CommercialFile[\s\S]*<WorkAdditionalsSection[\s\S]*id="balance"[\s\S]*<WorkBalanceSection[\s\S]*<DailyCostSummary[\s\S]*<SaleMaterialsGroup[\s\S]*id="notas"[\s\S]*title="Notas del proyecto"[\s\S]*title="Historial del trabajo"/);
assert.match(page, /Aún no hay venta confirmada para calcular resultado y margen\./); assert.match(page, /Aún no se han registrado consumos adicionales\./); assert.match(page, /Aún no se han registrado gastos\./); assert.match(page, /Aún no se han registrado horas hombre\./);
assert.match(page, /Materiales incluidos en la venta/); assert.match(page, /Los consumos adicionales del proyecto se registran en el tablero/); assert.match(page, /Costo estimado de esta salida/);
assert.match(page, /Sin actividad reciente/); assert.match(page, /Completar igualmente/); assert.match(page, /Motivo de espera/);
assert.match(page, /TaskCostSelect/); assert.match(page, /Costos por día/); assert.match(taskPanel, /Nueva subtarea/); assert.match(taskPanel, /subtask\.completada/, "las subtareas se marcan y agregan desde el panel de la tarea");
assert.match(page, /const completed = selectedWork\?\.estado === "completado"/);
assert.match(page, /const operationalReadOnly = isWorkOperationalReadOnly\(selectedWork\)/);
assert.match(page, /readOnly=\{operationalReadOnly\}/);
assert.match(page, /canConsume && !readOnly && <form className="works-cost-form works-material-form"/);
assert.match(page, /canRegister && !readOnly && <form className="works-cost-form" onSubmit=\{saveExpense\}/);
assert.match(page, /canRegister && !readOnly && <form className="works-cost-form" onSubmit=\{saveLabor\}/);
assert.match(page, /canManage && !readOnly && entry\.estado !== "anulado"/);
assert.match(page, /canManage && !readOnly && remaining > 0/);
assert.match(page, /!operationalReadOnly && <MoreActionsMenu actions=\{\[\{label: "Cancelar trabajo", onSelect: \(\) => setCancelWork\(selectedWork\)\}\]\}/); assert.doesNotMatch(page, /variant="ghost-danger" onClick=\{\(\) => setCancelWork/);
assert.match(page, /open=\{Boolean\(cancelWork\) && !isWorkOperationalReadOnly\(cancelWork\)\}/);
assert.match(page, /Reabrir proyecto/);
assert.match(page, /visibleExpenses\.map/); assert.match(page, /visibleLabor\.map/); assert.match(page, /exits\.map/); assert.match(page, /saleMaterials\.map/);
assert.match(page, /works-balance-grid works-balance-primary/); assert.match(page, /<dt>Ingresos<\/dt>/); assert.match(page, /<dt>Costos<\/dt>/); assert.match(page, /<dt>Resultado<\/dt>/); assert.match(page, /<dt>Margen<\/dt>/);
assert.doesNotMatch(page, /Costos \/ ingreso|<dt>Rentabilidad<\/dt>|<th>Avance<\/th>|movimiento\(s\)|gasto\(s\) MATERIAL|Inventario es la fuente de materiales/);
assert.match(page, /El costo histórico de/);
assert.match(backend, /agregarSubtareaTrabajoHandler/); assert.match(backend, /actualizarSubtareaTrabajoHandler/); assert.match(backend, /eliminarSubtareaTrabajoHandler/); assert.match(backend, /tareaId: taskId/);
assert.match(styles, /works-detail-disclosure\[open\]/); assert.match(styles, /works-commercial-list[\s\S]*grid-template-columns/);
// Ficha por pestañas: cabecera siempre visible, componente compartido <Tabs>, formulario con "Más detalles" cerrado.
assert.match(page, /import \{TabPanel, Tabs\} from "\.\.\/components\/ui\/Tabs"/); assert.match(page, /Trabajar en el tablero/); assert.match(page, /import MoreActionsMenu from "\.\.\/components\/ui\/MoreActionsMenu"/);
assert.match(page, /const WORK_DETAIL_TABS = Object\.freeze\(\[\s*\{id: "datos", label: "Datos"\},\s*\{id: "comercial", label: "Comercial"\},\s*\{id: "balance", label: "Balance"\},\s*\{id: "notas", label: "Notas e historial"\},\s*\]\)/);
assert.match(page, /const \[detailTab, setDetailTab\] = useState\("datos"\)/); assert.match(page, /setDetailTab\("datos"\);\s*loadDetail\(requestedWork\.id\)/); assert.match(page, /const openDetail = \(work, tab = "datos"\) => \{[^}]*setDetailTab\(tab\)/, "la ficha abre en Datos salvo que se pida otra pestaña (Cerrados abre en Balance)");
assert.ok(page.indexOf('<div className="works-detail-header">') < page.indexOf("<WorkSummary work={selectedWork}") && page.indexOf("<WorkSummary work={selectedWork}") < page.indexOf("<Tabs className="), "la cabecera (estado, acciones y franja) va antes y fuera de las pestañas");
assert.match(page, /<details className="works-more-details" open=\{moreDetailsOpen\}/); assert.match(page, /useState\(false\);\s*const \[detailTab/);
assert.ok(page.indexOf("<summary>Más detalles</summary>") < page.indexOf('label="Descripción" optional') && page.indexOf("<summary>Más detalles</summary>") < page.indexOf('label="Inicio planificado" optional'), "Descripción e Inicio planificado viven dentro de Más detalles");
assert.ok(page.indexOf('label="Término planificado" optional') < page.indexOf("<summary>Más detalles</summary>"), "Término planificado queda visible");
{
  const datos = page.slice(page.indexOf('id="datos" idPrefix'), page.indexOf('id="comercial" idPrefix'));
  assert.doesNotMatch(datos, /Término planificado/, "Datos no repite el término que ya muestra la franja");
  assert.match(datos, /works-empty-line/);
}
assert.match(page, /\{canViewWorkProfitability\(role\) && <WorkBalanceSection balance=\{detail\.balance\} loading=\{detailLoading\} \/>\}/);
const tabsSource = fs.readFileSync("src/components/ui/Tabs.jsx", "utf8");
assert.match(tabsSource, /role="tablist"/); assert.match(tabsSource, /role="tab"/); assert.match(tabsSource, /role="tabpanel"/); assert.match(tabsSource, /aria-selected=/); assert.match(tabsSource, /ArrowRight/); assert.match(tabsSource, /hidden=\{!active\}/);
const componentsCss = fs.readFileSync("src/styles/components.css", "utf8");
assert.match(componentsCss, /\.ui-tabs \{/); assert.match(componentsCss, /\.ui-tab\.is-active \{/); assert.match(componentsCss, /\.ui-tab-panel\[hidden\] \{/);
console.log("OK integración: Rules, autoridad backend, lista/tablero y confirmación segura");

const scanProducts = [{id: "p1", nombre: "Cable", barcode: "0012345678905"}, {id: "p2", nombre: "Switch", codigoBarras: "7801234567890"}];
const scanFound = resolveWorkMaterialScan(scanProducts, "012345678905", {itemId: "", cantidad: ""});
assert.deepEqual([scanFound.status, scanFound.itemId, scanFound.cantidad], ["found", "p1", "1"]);
assert.equal(resolveWorkMaterialScan(scanProducts, "7801234567890", {cantidad: ""}).itemId, "p2");
assert.equal(resolveWorkMaterialScan(scanProducts, "999", {cantidad: ""}).status, "not_available");
assert.equal(resolveWorkMaterialScan(scanProducts, "", {}).status, "not_available");
assert.equal(resolveWorkMaterialScan(scanProducts, "012345678905", {cantidad: "5"}).cantidad, "5");
console.log("OK escáner de salida de material: disponible, no disponible y cantidad conservada");

// Interfaz de Proyectos y Trabajos: un fallo de carga nunca se muestra como vacío.
{
  const mainStart = page.indexOf("export default function WorksPage");
  const mainEnd = page.indexOf("function commercialStatusLabel");
  const main = page.slice(mainStart, mainEnd);
  // Lista: error propio, separado del error de acciones, y la lista/tablero/vacío
  // solo se renderizan en la rama sin error.
  assert.match(main, /const \[loadError, setLoadError\] = useState\(""\)/);
  assert.match(main, /catch \(failure\) \{\s*setLoadError\(/);
  assert.doesNotMatch(main.slice(main.indexOf("const load = useCallback"), main.indexOf("useEffect(() => { load(); }")), /setError\(failure|setError\(loadError/);
  const listBranch = main.indexOf("{loadError ? <LoadFailure message={loadError} onRetry={load} /> : <>");
  assert.ok(listBranch > 0, "la lista tiene una rama de error de carga");
  const beforeListBranch = main.slice(0, listBranch);
  assert.doesNotMatch(beforeListBranch, /<WorkList|<WorkProjectBoard|<WorksEmptyState/);
  const afterListBranch = main.slice(listBranch);
  assert.match(afterListBranch, /<WorkList[\s\S]*<\/>\}\s*<\/section>/);
  assert.match(main, /\{canManage && !loadError && <div className="erp-module-intro">/);
  // Ficha: loadDetail guarda su error aparte y el error reemplaza todas las secciones.
  assert.match(main, /const \[detailError, setDetailError\] = useState\(""\)/);
  assert.match(main, /catch \(failure\) \{ setDetailError\(/);
  const detailBranch = main.indexOf("{detailError ? <LoadFailure message={detailError} onRetry={() => loadDetail(selectedWork.id)} /> : <>");
  assert.ok(detailBranch > 0, "la ficha tiene una rama de error de carga");
  assert.doesNotMatch(main.slice(0, detailBranch), /<CommercialFile|<WorkAdditionalsSection|<DailyCostSummary|Notas del proyecto|Historial del trabajo/);
  const detailRest = main.slice(detailBranch);
  for (const section of ["<CommercialFile", "<DailyCostSummary", "<SaleMaterialsGroup", "<WorkAdditionalsSection", 'title="Notas del proyecto"', 'title="Historial del trabajo"']) {
    assert.ok(detailRest.includes(section), `${section} solo se renderiza sin error de carga`);
  }
  // Los textos de vacío de la ficha viven dentro de esas secciones, nunca fuera de la rama sin error.
  assert.doesNotMatch(main.slice(0, detailBranch), /Aún no hay notas|Aún no hay tareas/);
  // Tablero: "no hay Proyectos" frente a "los filtros no coinciden", con el mismo vacío de la Lista.
  assert.match(main, /view === "board" \? \(works\.length \? <WorkProjectBoard [\s\S]*\/> : <WorksEmptyState hasAnyWork=\{false\}/);
  // Tablero del proyecto: cargando, error, datos (en ese orden) y error propio separado del de acciones.
  assert.match(main, /const \[boardError, setBoardError\] = useState\(""\)/);
  assert.match(board, /loading \? <LoadingState variant="section" label="Cargando tablero\.\.\." \/> : error \? <LoadFailure message=\{error\} onRetry=\{onRetry\} \/> : \(/);
  assert.doesNotMatch(board.slice(0, board.indexOf("error ? <LoadFailure")), /<WorkTaskBoard|<CostCard/);
  const emptyState = page.slice(page.indexOf("function WorksEmptyState"), page.indexOf("function WorkList"));
  assert.match(emptyState, /No hay trabajos coincidentes/);
  assert.match(emptyState, /Aún no hay trabajos/);
  assert.match(page, /function WorkList[\s\S]*?<WorksEmptyState/);
  // Menores.
  assert.doesNotMatch(page, /window\.alert/);
  assert.match(page, /setEvidenceError\("No se pudo abrir el documento\. Intenta nuevamente\."\)/);
  assert.match(page, /<LoadingState variant="section" label="Calculando desde fuentes autoritativas\.\.\." \/>/);
  assert.doesNotMatch(page, /<p>Calculando desde fuentes autoritativas/);
  assert.match(page, /function CommercialFile[\s\S]*?useBusinessFormat\(\)/);
  assert.doesNotMatch(page.slice(page.indexOf("function commercialTotal"), page.indexOf("function CommercialFile")), /es-CL/);
  // Móvil: los tableros se apilan en una columna, sin scroll horizontal.
  assert.match(styles, /@media\(max-width:767px\)\s*\{[^}]*\.works-load-error[^}]*\}\s*\.works-board, \.works-task-board \{ grid-template-columns: minmax\(0, 1fr\); min-width: 0; \}/);
  assert.match(styles, /\.works-panel:has\(\.works-board\), \.works-panel:has\(\.works-task-board\), \.works-detail-section:has\(\.works-task-board\) \{ overflow-x: visible; \}/);
}
// Vista Cerrados (SPEC 028 etapa B2): tercera vista junto a Lista y Tablero, dentro de la rama sin error de carga.
{
  const mainStart = page.indexOf("export default function WorksPage");
  const main = page.slice(mainStart, page.indexOf("function commercialStatusLabel"));
  assert.match(main, /searchParams\.get\("vista"\) === "cerrados" \? "closed"/);
  assert.match(main, /<AppIcon icon=\{Archive\} size=\{17\} \/>Cerrados/);
  assert.ok(main.indexOf("{loadError ? <LoadFailure message={loadError} onRetry={load} /> : <>") < main.indexOf("<WorkClosedProjects"), "un fallo de carga de la lista reemplaza a Cerrados: nunca se muestra como vacío");
  assert.match(main, /canViewProfitability=\{canSeeProfitability\}/);
  assert.match(main, /const canSeeProfitability = canViewWorkProfitability\(role\)/);
  assert.match(main, /closedBalanceIds = useMemo\(\(\) => getClosedWorks\(works\)\.slice\(0, WORK_CLOSED_BALANCE_LIMIT\)/, "balances limitados a los 20 cierres más recientes");
  assert.match(main, /Promise\.allSettled\(ids\.map\(\(id\) => obtenerBalanceTrabajo\(businessId, id\)\)\)/, "balances en paralelo, un fallo no tumba a los demás");
  assert.match(main, /if \(view === "closed" && canSeeProfitability && !loading && !loadError && closedBalanceKey\)/, "sin permiso de ganancias no se pide ningún balance");
  assert.match(main, /openDetail\(work, canSeeProfitability \? "balance" : "datos"\)/, "cada fila abre la ficha en Balance (Datos sin permiso de ganancias)");
  assert.match(main, /matchesWorkFilters\(work, \{\.\.\.filters, estado: \["activos", "todos"\]\.includes\(filters\.estado\) \? "todos" : filters\.estado, incluirCerrados: filters\.estado === "todos"\}\)/, "la Lista muestra solo activos salvo que se pida lo contrario");
  assert.match(main, /estado: "activos", prioridad: "todas"/, "el filtro Estado arranca en Activos");
  assert.match(main, /<option value="activos">Activos<\/option><option value="todos">Todos, incluidos cerrados<\/option>/);
  assert.doesNotMatch(main, /Mostrar también cerrados|showClosed/, "el checkbox se reemplazó por el filtro Estado");
  assert.match(page, /Elige «Todos, incluidos cerrados» en Estado/);
  assert.match(page, /<th>Progreso<\/th>\{canManage && <th>Costo acumulado<\/th>\}/, "la Lista muestra progreso y, solo para gestión, costo acumulado");
  assert.match(main, /costPending=\{detailLoading \|\| Boolean\(detailError\)\}/, "la ficha muestra — en lugar de $0 mientras carga");
  assert.match(main, /onClick=\{\(\) => setDetailTab\("notas"\)\}>Agregar nota/, "la alerta de inactividad lleva a la pestaña de notas");
  assert.match(main, /onClick=\{\(\) => requestStateChange\("completado"\)\}>Marcar como completado/, "el aviso de tareas hechas usa el cambio de estado existente");
  assert.match(page, /No hay proyectos activos/);
  // El componente: condiciona lo monetario al permiso y separa error de vacío.
  assert.doesNotMatch(closedView, /firebase|firestore|httpsCallable|getDocs|obtenerBalanceTrabajo/i, "WorkClosedProjects es presentacional");
  assert.match(closedView, /canViewProfitability && <th>Balance<\/th>/); assert.match(closedView, /\{canViewProfitability && <td>\{balanceCell\(work\)\}<\/td>\}/); assert.match(closedView, /\{canViewProfitability && balanceCell\(work\)\}/);
  assert.match(closedView, /canViewProfitability && balancesError/);
  assert.match(closedView, /Aún no hay proyectos cerrados/);
}
console.log("OK interfaz de trabajos: error de carga separado del vacío (lista y ficha), vacío del tablero, sin window.alert y tableros apilados en móvil");

console.log("WORKS_MODEL_SMOKE_OK");
