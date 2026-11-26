import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {
  formatTrackingRut, isTrackingPath, isValidTrackingRut, normalizeTrackingPlate, parseTrackingPath,
  TRACKING_TOKEN_PATTERN, trackingLookupError, trackingProgressLabel,
} from "../src/domain/workOrderTrackingModel.mjs";

// Seguimiento público del Taller (sin emuladores): etapas, vista pública sin datos internos, tokens,
// código de taller, límite de intentos y validaciones del formulario.
// Ejecutar: node scripts/work-order-tracking-model-smoke.mjs
const require = createRequire(import.meta.url);
const rules = require("../functions/workOrderTrackingRules.js");

// Etapas públicas según el estado de la OT.
const stage = (order) => rules.publicStage({recepcion: {}, ...order});
assert.deepEqual(stage({estado: "en_cola", estadoAprobacion: "pendiente"}), {paso: 0, clave: "recibido", espera: false});
assert.deepEqual(stage({estado: "en_diagnostico", estadoAprobacion: "pendiente"}), {paso: 1, clave: "revision", espera: false});
assert.deepEqual(stage({estado: "en_diagnostico", estadoAprobacion: "rechazada"}), {paso: 1, clave: "espera", espera: true});
assert.deepEqual(stage({estado: "en_cola", estadoAprobacion: "aprobada"}), {paso: 2, clave: "plaza", espera: true});
assert.deepEqual(stage({estado: "en_reparacion", estadoAprobacion: "aprobada"}), {paso: 2, clave: "reparacion", espera: false});
assert.deepEqual(stage({estado: "pendiente_entrega", estadoAprobacion: "aprobada"}), {paso: 3, clave: "listo", espera: false});
for (const estado of ["ingresada", "cerrada", "cancelada"]) {
  assert.equal(rules.isVisibleOrder({estado, recepcion: {}}), false, `${estado} no es visible`);
}
assert.equal(rules.isVisibleOrder({estado: "en_cola"}), false, "sin recepción no es visible");
// El enlace solo se comparte con el ingreso aprobado y el vehículo en el taller.
assert.equal(rules.canShareTrackingLink({estado: "en_diagnostico", estadoAprobacion: "pendiente", recepcion: {}}), false);
assert.equal(rules.canShareTrackingLink({estado: "en_cola", estadoAprobacion: "aprobada", recepcion: {}}), false,
  "aprobada pero esperando plaza: la ejecución aún no comienza");
assert.equal(rules.canShareTrackingLink({estado: "en_reparacion", estadoAprobacion: "aprobada", recepcion: {}}), true);
assert.equal(rules.canShareTrackingLink({estado: "pendiente_entrega", estadoAprobacion: "aprobada", recepcion: {}}), true);
assert.equal(rules.canShareTrackingLink({estado: "cerrada", estadoAprobacion: "aprobada", recepcion: {}}), false);
console.log("OK seguimiento: etapas públicas y cuándo se comparte el enlace");

// La vista pública solo trae campos permitidos: sin montos, técnico, plaza, fotos ni datos personales.
const view = rules.buildPublicView({
  business: {nombreComercial: "Taller Bagner", rut: "76.000.000-0", email: "x@y.cl"},
  profile: {telefono: "+56 9 1111 2222"},
  order: {estado: "en_reparacion", estadoAprobacion: "aprobada", recepcion: {motivoCliente: "Ruido", ingresaNombre: "Marta"},
    responsableNombre: "Técnico Uno", plazaId: "plaza-1", totalNeto: 99000, clienteId: "cliente-1", actualizadoEn: 1000},
  vehicle: {marca: "Ssangyong", modelo: "Actyon", patente: "PRGZ63", vin: "VIN123", clienteId: "cliente-1"},
  services: [
    {estado: "completado", nombre: "Cambio de pastillas", precioUnitario: 5000, actualizadoEn: 3000, fotos: {antes: {}}},
    {estado: "en_progreso", nombre: "Suspensión delantera"},
    {estado: "pendiente", nombre: ""},
  ],
  findings: [
    {descripcion: "Bujes con grietas", urgente: true, reportadoPorNombre: "Técnico Uno", foto: {hash: "x"}},
    {descripcion: "Líquido de frenos", urgente: false},
    {descripcion: "Ya convertido", urgente: true, servicioOtId: "s-1"},
  ],
});
assert.deepEqual(Object.keys(view).sort(), ["actualizadoEn", "avance", "etapa", "hallazgos", "taller", "trabajos", "vehiculo"]);
assert.deepEqual(view.taller, {nombre: "Taller Bagner", telefono: "+56 9 1111 2222"});
assert.deepEqual(view.vehiculo, {descripcion: "Ssangyong Actyon", patente: "PRGZ63"});
assert.deepEqual(view.trabajos, [
  {nombre: "Cambio de pastillas", estado: "terminado"}, {nombre: "Suspensión delantera", estado: "en_curso"},
  {nombre: "Trabajo", estado: "pendiente"}]);
assert.deepEqual(view.avance, {terminados: 1, total: 3, porcentaje: 33});
assert.deepEqual(view.hallazgos, [{descripcion: "Bujes con grietas", urgente: true}, {descripcion: "Líquido de frenos", urgente: false}]);
assert.equal(view.actualizadoEn, 3000);
const serialized = JSON.stringify(view);
for (const leak of ["Técnico Uno", "plaza-1", "99000", "5000", "cliente-1", "VIN123", "Marta", "Ruido", "76.000.000-0", "x@y.cl", "hash"]) {
  assert.ok(!serialized.includes(leak), `la vista pública no debe incluir «${leak}»`);
}
// Antes de la ejecución no se listan trabajos; en revisión ya se informan hallazgos.
const reviewing = rules.buildPublicView({order: {estado: "en_diagnostico", estadoAprobacion: "pendiente", recepcion: {}},
  services: [{estado: "pendiente", nombre: "X"}], findings: [{descripcion: "Fuga", urgente: false}]});
assert.deepEqual(reviewing.trabajos, []);
assert.equal(reviewing.avance, null);
assert.equal(reviewing.hallazgos.length, 1);
assert.equal(rules.buildPublicView({order: {estado: "en_cola", recepcion: {}}, findings: [{descripcion: "Fuga"}]}).hallazgos.length, 0);
console.log("OK seguimiento: vista pública acotada (sin montos, técnico, plaza, fotos ni datos personales)");

// Tokens: 256 bits, se guarda solo el hash; formatos inválidos no se consultan.
const material = rules.createTokenMaterial();
assert.match(material.token, TRACKING_TOKEN_PATTERN);
assert.equal(rules.validTokenHash(material.token), material.tokenHash);
assert.match(material.tokenHash, rules.TOKEN_HASH_PATTERN);
assert.notEqual(material.token, material.tokenHash);
for (const bad of ["", "abc", `${material.token}x`, "../etc/passwd", null, 42]) assert.equal(rules.validTokenHash(bad), "");
// Índice de patentes de la consulta pública: id por hash, sin la patente en claro, igual con cualquier formato.
assert.match(rules.plateIndexId("PRGZ63"), /^[a-f0-9]{64}$/);
assert.equal(rules.plateIndexId(rules.normalizePlate("prgz-63")), rules.plateIndexId("PRGZ63"));
assert.ok(!rules.plateIndexId("PRGZ63").includes("PRGZ63"));
assert.equal(rules.PLATE_INDEX_COLLECTION, "tallerSeguimientoPatentes");
assert.equal(rules.createWorkshopCode, undefined, "ya no hay código por taller: la consulta es de toda la plataforma");
console.log("OK seguimiento: token de 256 bits guardado como hash e índice de patentes");

// Límite por IP: 3 fallos en 15 minutos con la misma patente bloquean 15 minutos; 10 fallos con cualquier patente
// bloquean la IP. Fuera de la ventana se reinicia el conteo. Nunca se bloquea una patente para todos.
let attempts = {};
for (let index = 0; index < 2; index += 1) attempts = rules.registerFailure(attempts, 1_000);
assert.equal(attempts.bloqueado, false);
assert.equal(attempts.fallos, 2);
const third = rules.registerFailure(attempts, 2_000);
assert.equal(third.bloqueado, true);
assert.equal(rules.isBlocked(third, 2_000 + rules.BLOCK_MS - 1), true);
assert.equal(rules.isBlocked(third, 2_000 + rules.BLOCK_MS + 1), false);
assert.equal(rules.registerFailure({fallos: 2, ventanaDesde: 1_000}, 1_000 + rules.ATTEMPT_WINDOW_MS + 1).fallos, 1);
assert.equal(rules.MAX_FAILED_ATTEMPTS, 3);
assert.equal(rules.MAX_FAILED_ATTEMPTS_PER_IP, 10);
let ipAttempts = {};
for (let index = 0; index < 9; index += 1) ipAttempts = rules.registerFailure(ipAttempts, 1_000, rules.MAX_FAILED_ATTEMPTS_PER_IP);
assert.equal(ipAttempts.bloqueado, false, "9 fallos en la IP aún no la bloquean");
assert.equal(rules.registerFailure(ipAttempts, 2_000, rules.MAX_FAILED_ATTEMPTS_PER_IP).bloqueado, true, "el décimo la bloquea");
assert.equal(attempts.expiraEn, 1_000 + rules.ATTEMPT_WINDOW_MS + rules.BLOCK_MS, "el contador trae su fecha de expiración");
assert.ok(third.expiraEn > 2_000 + rules.BLOCK_MS, "el contador bloqueado expira después del bloqueo");
// Las claves son por IP y por IP + patente; no hay clave solo de patente y no guardan datos en claro.
assert.notEqual(rules.attemptKey("ip", "1.2.3.4"), rules.attemptKey("ip", "1.2.3.5"));
assert.notEqual(rules.attemptKey("ip-patente", "1.2.3.4", "PRGZ63"), rules.attemptKey("ip-patente", "1.2.3.5", "PRGZ63"),
  "la misma patente desde otra IP tiene su propio contador");
assert.notEqual(rules.attemptKey("ip-patente", "1.2.3.4", "PRGZ63"), rules.attemptKey("ip-patente", "1.2.3.4", "PRGZ64"));
assert.ok(!rules.attemptKey("ip-patente", "1.2.3.4", "PRGZ63").includes("PRGZ63"), "la clave del contador no guarda la patente");
assert.ok(!rules.attemptKey("ip-patente", "1.2.3.4", "PRGZ63").includes("1.2.3.4"), "ni la IP");
// La consulta pública está apagada salvo que se encienda explícitamente.
assert.equal(rules.isPublicLookupEnabled({}), false);
assert.equal(rules.isPublicLookupEnabled({SEGUIMIENTO_CONSULTA_PUBLICA: "false"}), false);
assert.equal(rules.isPublicLookupEnabled({SEGUIMIENTO_CONSULTA_PUBLICA: "true"}), true);
console.log("OK seguimiento: límite de intentos por IP e IP + patente, expiración y consulta apagada por defecto");

// Documento y patente comparables; formulario del cliente.
assert.equal(rules.normalizeDocument("12.345.678-5"), "123456785");
assert.equal(rules.normalizeDocument("12345678-5"), rules.normalizeDocument("123456785"));
assert.equal(rules.normalizePlate("prgz-63"), "PRGZ63");
assert.equal(rules.normalizePlate("ab"), "");
assert.equal(normalizeTrackingPlate("prgz 63"), "PRGZ63");
assert.equal(formatTrackingRut("123456785"), "12.345.678-5");
assert.equal(isValidTrackingRut("12.345.678-5"), true);
assert.equal(isValidTrackingRut("12.345.678-9"), false);
assert.equal(trackingLookupError({patente: "PRG", rut: "12.345.678-5"}), "Completa la patente y el RUT.");
assert.equal(trackingLookupError({patente: "PRGZ63", rut: "12.345.678-9"}), "El RUT no es válido. Revísalo.");
assert.equal(trackingLookupError({patente: "PRGZ63", rut: "12.345.678-5"}), "");
assert.equal(trackingProgressLabel({terminados: 1, total: 3, porcentaje: 33}), "1 de 3 · 33%");
// Rutas públicas.
assert.deepEqual(parseTrackingPath(`/seguimiento/${material.token}`), {mode: "link", token: material.token});
assert.deepEqual(parseTrackingPath("/seguimiento"), {mode: "manual"}, "consulta pública de toda la plataforma");
assert.deepEqual(parseTrackingPath("/seguimiento/"), {mode: "manual"});
assert.deepEqual(parseTrackingPath("/seguimiento/taller/ab12cd34ef"), {mode: "manual"}, "las direcciones antiguas por taller siguen abriendo la consulta");
assert.deepEqual(parseTrackingPath("/seguimiento/abc"), {mode: "link", token: ""});
assert.deepEqual(parseTrackingPath("/seguimiento/taller"), {mode: "manual"});
assert.equal(isTrackingPath("/seguimiento"), true);
assert.equal(isTrackingPath(`/seguimiento/${material.token}`), true);
assert.equal(isTrackingPath("/ordenes-trabajo"), false);
// El patrón del token coincide en cliente y servidor.
assert.equal(String(TRACKING_TOKEN_PATTERN), String(/^[A-Za-z0-9_-]{43}$/));
console.log("OK seguimiento: RUT, patente, formulario y rutas públicas");
console.log("WORK_ORDER_TRACKING_MODEL_SMOKE_OK");
