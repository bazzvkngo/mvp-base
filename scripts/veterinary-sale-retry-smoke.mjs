import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const {deliverVeterinarySaleFromEvent, SALE_RETRY_WINDOW_MS} = require("../functions/veterinaryAttentionSale");

const businessId = "negocio-ficticio";
const atencionId = "atencion-ficticia";
const now = Date.parse("2026-11-26T20:00:00Z");
const warnings = [];
console.warn = (...args) => warnings.push(args);

function createFakeDb({failure}) {
  const updates = [];
  const ref = (path) => ({path, collection: (name) => collectionRef(path ? path + "/" + name : name)});
  const collectionRef = (path) => ({path, doc: (id) => ref(path + "/" + id)});
  const attention = {estado: "finalizada", finalizadoPorUid: "uid-ficticio", negocioId: businessId};
  const intent = {estado: "pendiente", cerradoPorUid: "uid-ficticio", negocioId: businessId};
  return {
    updates,
    collection: (name) => collectionRef(name),
    getAll: async () => { throw failure; },
    runTransaction: async (callback) => callback({
      getAll: async () => [
        {exists: true, data: () => intent},
        {exists: true, get: (field) => attention[field]},
      ],
      update: (target, values) => updates.push({path: target.path, values}),
    }),
  };
}

const run = (db, eventTime) => deliverVeterinarySaleFromEvent({
  db, FieldValue: {serverTimestamp: () => "ahora", delete: () => "borrar"}, HttpsError: Error,
  businessId, atencionId, eventTime, now,
});

// Dentro de la ventana el error se propaga para que Functions reintente.
const transient = Object.assign(new Error("Fallo transitorio de prueba"), {code: 14});
let db = createFakeDb({failure: transient});
await assert.rejects(run(db, new Date(now - 60 * 1000).toISOString()), transient);
assert.equal(db.updates.length, 0);

// Una hora de evento inválida no corta los reintentos.
db = createFakeDb({failure: transient});
await assert.rejects(run(db, "no-es-una-fecha"), transient);
assert.equal(db.updates.length, 0);

// Pasada la ventana el trigger deja de reintentar y marca la atención para el reintento manual.
db = createFakeDb({failure: transient});
await run(db, new Date(now - SALE_RETRY_WINDOW_MS - 1000).toISOString());
assert.deepEqual(db.updates.map(({path, values}) => [path, values.estado ?? values.ventaEstado]), [
  ["negocios/" + businessId + "/ventasPendientesVeterinaria/" + atencionId, "error"],
  ["negocios/" + businessId + "/atencionesVeterinarias/" + atencionId, "error"],
]);
assert.match(db.updates[0].values.ventaError, /vuelve a intentar/);
assert.deepEqual(warnings, [["Venta veterinaria sin generar tras reintentos.", 14]]);

console.log("VETERINARY_SALE_RETRY_SMOKE_OK");
