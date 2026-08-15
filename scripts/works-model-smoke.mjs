import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {adaptStoredWork, buildWorkMutationPayload, canManageWorks, formatWorkNumber as formatFrontendNumber, getWorkDraftErrors, humanizeWorkEvent, matchesWorkFilters} from "../src/domain/workModel.mjs";

const require = createRequire(import.meta.url);
const {actualizarTrabajoHandler, agregarNotaTrabajoHandler, agregarTareaTrabajoHandler, cambiarEstadoTareaTrabajoHandler, cambiarEstadoTrabajoHandler, crearTrabajoHandler, eliminarTareaTrabajoHandler, formatWorkNumber, normalizeWorkInput} = require("../functions/workPersistence.js");

class TestHttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
class Snapshot { constructor(ref, value) { this.id = ref.id; this.exists = value !== undefined; this.value = value; } data() { return this.value; } }
class DocRef { constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); } collection(name) { return new CollectionRef(this.db, `${this.path}/${name}`); } }
class CollectionRef { constructor(db, path) { this.db = db; this.path = path; } doc(id) { return new DocRef(this.db, `${this.path}/${id || `auto_${++this.db.autoId}`}`); } }
class FakeDb {
  constructor() { this.documents = new Map(); this.autoId = 0; }
  collection(name) { return new CollectionRef(this, name); }
  seed(path, value) { this.documents.set(path, structuredClone(value)); }
  read(path) { return this.documents.get(path); }
  matching(prefix) { return [...this.documents.entries()].filter(([path]) => path.startsWith(prefix)); }
  runTransaction(callback) {
    const working = new Map([...this.documents.entries()].map(([path, value]) => [path, structuredClone(value)]));
    const transaction = {
      get: async (ref) => new Snapshot(ref, working.has(ref.path) ? structuredClone(working.get(ref.path)) : undefined),
      create: (ref, value) => { if (working.has(ref.path)) throw new Error("already exists"); working.set(ref.path, structuredClone(value)); },
      set: (ref, value, options = {}) => working.set(ref.path, options.merge ? {...(working.get(ref.path) || {}), ...structuredClone(value)} : structuredClone(value)),
      update: (ref, value) => { if (!working.has(ref.path)) throw new Error("missing"); working.set(ref.path, {...working.get(ref.path), ...structuredClone(value)}); },
      delete: (ref) => working.delete(ref.path),
    };
    return Promise.resolve(callback(transaction)).then((result) => { this.documents = working; return result; });
  }
}

const db = new FakeDb();
const FieldValue = {serverTimestamp: () => "2026-08-14T20:05:00.000Z"};
const profiles = new Map([
  ["owner-a", {uid: "owner-a", nombre: "Mauricio", correo: "owner@example.cl"}],
  ["worker-a", {uid: "worker-a", nombre: "Ana Operaciones", correo: "ana@example.cl"}],
  ["worker-b", {uid: "worker-b", nombre: "Luis Terreno", correo: "luis@example.cl"}],
]);

for (const [uid, role] of [["owner-a", "OWNER"], ["worker-a", "MEMBER"], ["worker-b", "ADMIN"]]) {
  db.seed(`membresias/business-a__${uid}`, {negocioId: "business-a", uid, rol: role, estado: "activo"});
}
db.seed("negocios/business-a/clientes/client-a", {negocioId: "business-a", clienteId: "client-a", estado: "activo", nombreRazonSocial: "Constructora Sur", rut: "12.345.678-5", email: "cliente@example.cl", telefono: "+56911111111", personaContacto: "Paula"});

const requireBusinessAccess = async (request, _deps, options = {}) => {
  if (!request.auth?.uid) throw new TestHttpsError("unauthenticated", "auth");
  const businessId = String(request.data?.businessId || "");
  const membership = db.read(`membresias/${businessId}__${request.auth.uid}`);
  if (!membership || membership.estado !== "activo") throw new TestHttpsError("permission-denied", "membership");
  if (options.roles && !options.roles.includes(membership.rol)) throw new TestHttpsError("permission-denied", "role");
  return {uid: request.auth.uid, businessId, membership, businessRef: db.collection("negocios").doc(businessId)};
};
const dependencies = {db, FieldValue, HttpsError: TestHttpsError, requireBusinessAccess, resolveUserSnapshots: async (uids) => new Map(uids.map((uid) => [uid, profiles.get(uid) || {uid, nombre: "Sin nombre registrado", correo: ""}]))};
const request = (uid, data) => ({auth: uid ? {uid} : null, data});
const input = (overrides = {}) => ({titulo: "Mantención preventiva", descripcion: "Visita programada", clienteId: "client-a", responsableUid: "worker-a", participanteUids: ["worker-b"], estado: "pendiente", prioridad: "alta", fechaInicio: "2026-08-14", fechaPrevista: "2026-08-20", ...overrides});

assert.equal(formatWorkNumber(2026, 1), "TRB-2026-0001");
assert.equal(formatFrontendNumber(2026, 12), "TRB-2026-0012");
assert.throws(() => normalizeWorkInput(input({estado: "inventado"}), TestHttpsError), (error) => error.code === "invalid-argument");
assert.throws(() => normalizeWorkInput(input({prioridad: "media"}), TestHttpsError), (error) => error.code === "invalid-argument");
assert.deepEqual(getWorkDraftErrors(input()), {});
assert.equal(canManageWorks("ADMIN"), true);
assert.equal(canManageWorks("MEMBER"), false);
console.log("OK contrato: estados, prioridades, formato y roles canónicos");

const created = await crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-request-0001", trabajo: input()}), dependencies, new Date("2026-08-14T12:00:00Z"));
assert.equal(created.numero, "TRB-2026-0001");
const workPath = `negocios/business-a/trabajos/${created.trabajoId}`;
let stored = db.read(workPath);
assert.equal(stored.clienteSnapshot.nombreRazonSocial, "Constructora Sur");
assert.equal(stored.responsableSnapshot.nombre, "Ana Operaciones");
assert.equal(stored.participantesSnapshot[0].nombre, "Luis Terreno");
assert.equal(db.matching(`${workPath}/historial/`).some(([, value]) => value.tipo === "trabajo_creado"), true);
console.log("OK creación: correlativo, cliente, responsables e historial autoritativos");

const retry = await crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-request-0001", trabajo: input()}), dependencies, new Date("2026-08-14T12:00:00Z"));
assert.equal(retry.trabajoId, created.trabajoId); assert.equal(retry.sinCambios, true);
const noClient = await crearTrabajoHandler(request("owner-a", {businessId: "business-a", requestId: "work-request-0002", trabajo: input({titulo: "Trabajo interno", clienteId: "", responsableUid: "", participanteUids: []})}), dependencies, new Date("2026-08-14T12:00:00Z"));
assert.equal(noClient.numero, "TRB-2026-0002"); assert.equal(db.read(`negocios/business-a/trabajos/${noClient.trabajoId}`).clienteId, "");
console.log("OK creación: idempotencia y cliente opcional");

await assert.rejects(() => crearTrabajoHandler(request("worker-a", {businessId: "business-a", requestId: "work-request-member", trabajo: input()}), dependencies), (error) => error.code === "permission-denied");
await assert.rejects(() => crearTrabajoHandler(request("owner-a", {businessId: "business-b", requestId: "work-request-cross", trabajo: input()}), dependencies), (error) => error.code === "permission-denied");
await assert.rejects(() => crearTrabajoHandler(request("", {businessId: "business-a", requestId: "work-request-anon", trabajo: input()}), dependencies), (error) => error.code === "unauthenticated");
console.log("OK seguridad: autenticación, rol y aislamiento multiempresa");

await actualizarTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, trabajo: input({responsableUid: "worker-b", participanteUids: ["worker-a"], estado: "en_progreso"})}), dependencies);
stored = db.read(workPath); assert.equal(stored.responsableUid, "worker-b"); assert.deepEqual(stored.participanteUids, ["worker-a"]); assert.equal(stored.estado, "en_progreso");
const updateEvents = db.matching(`${workPath}/historial/`).map(([, value]) => value.tipo);
assert.equal(updateEvents.includes("responsable_cambiado"), true); assert.equal(updateEvents.includes("participante_agregado"), true); assert.equal(updateEvents.includes("participante_retirado"), true); assert.equal(updateEvents.includes("estado_cambiado"), true);
console.log("OK edición: responsable, participantes y estado generan trazabilidad");

const task = await agregarTareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, titulo: "Revisar instalación"}), dependencies);
await cambiarEstadoTareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, completada: true}), dependencies);
assert.equal(db.read(`${workPath}/tareas/${task.tareaId}`).completada, true); assert.equal(db.read(workPath).tareasCompletadas, 1);
await assert.rejects(() => eliminarTareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId}), dependencies), (error) => error.code === "failed-precondition");
await cambiarEstadoTareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId, completada: false}), dependencies);
await eliminarTareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, tareaId: task.tareaId}), dependencies);
assert.equal(db.read(`${workPath}/tareas/${task.tareaId}`), undefined); assert.equal(db.read(workPath).tareasTotal, 0);
console.log("OK checklist: alta, completado, reapertura y eliminación segura");

const note = await agregarNotaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, texto: "Configuración inicial completada."}), dependencies);
assert.equal(db.read(`${workPath}/notas/${note.notaId}`).autorSnapshot.nombre, "Mauricio");
assert.equal(db.matching(`${workPath}/historial/`).some(([, value]) => value.tipo === "nota_agregada" && value.detalle.texto.includes("Configuración")), true);
console.log("OK notas: autor, fecha y evento append-only");

await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, estado: "completado"}), dependencies);
assert.equal(db.read(workPath).estado, "completado"); assert.ok(db.read(workPath).fechaCompletado);
await assert.rejects(() => agregarTareaTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, titulo: "No permitida"}), dependencies), (error) => error.code === "failed-precondition");
await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, estado: "pendiente"}), dependencies);
assert.equal(db.read(workPath).fechaCompletado, null);
await cambiarEstadoTrabajoHandler(request("owner-a", {businessId: "business-a", trabajoId: created.trabajoId, estado: "cancelado"}), dependencies);
const terminalEvents = db.matching(`${workPath}/historial/`).map(([, value]) => value.tipo);
assert.equal(terminalEvents.includes("trabajo_completado"), true); assert.equal(terminalEvents.includes("trabajo_reabierto"), true); assert.equal(terminalEvents.includes("trabajo_cancelado"), true);
console.log("OK transiciones: completado, reapertura, cancelación y fecha de término");

const adapted = adaptStoredWork({...stored, id: created.trabajoId});
assert.equal(matchesWorkFilters(adapted, {query: "constructora sur", estado: "todos", prioridad: "todas", responsableUid: "todos"}), true);
const mutation = buildWorkMutationPayload({...input(), numero: "TRB-FAKE", clienteSnapshot: {nombre: "Falso"}, creadoPorUid: "fake"});
assert.equal("numero" in mutation, false); assert.equal("clienteSnapshot" in mutation, false); assert.equal("creadoPorUid" in mutation, false);
assert.equal(humanizeWorkEvent({tipo: "nota_agregada", actorSnapshot: {nombre: "Mauricio"}}), "Mauricio agregó una nota.");
console.log("OK frontend: búsqueda, payload restringido y eventos sin UID crudo");

const rules = fs.readFileSync("firestore.rules", "utf8");
const page = fs.readFileSync("src/pages/WorksPage.jsx", "utf8");
const backend = fs.readFileSync("functions/workPersistence.js", "utf8");
assert.match(rules, /match \/trabajos\/\{trabajoId\}/); assert.match(rules, /match \/historial\/\{eventoId\}[\s\S]*allow create, update, delete: if false/);
assert.match(backend, /workCounters/); assert.match(backend, /workCreateRequests/); assert.match(backend, /requireBusinessAccess/);
assert.match(page, /ResponsiveDialog/); assert.doesNotMatch(page, /window\.confirm|actorUid/); assert.match(page, /works-board/); assert.match(page, /Historial del trabajo/);
console.log("OK integración: Rules, autoridad backend, lista/tablero y confirmación segura");

console.log("WORKS_MODEL_SMOKE_OK");
