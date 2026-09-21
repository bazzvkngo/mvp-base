import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  INITIAL_SUBSCRIPTION_STATE,
  SUBSCRIPTION_STATUS,
  nextSubscriptionStatus,
} from "../src/domain/subscriptionStatus.mjs";

// ETAPA 2 (estados de carga), PASO 6: máquina de estados pura de una
// suscripción onSnapshot (src/domain/subscriptionStatus.mjs). Sin React ni
// Firebase: se prueba importando el módulo directamente, como los demás
// smokes de dominio. Cubre toda la tabla de transiciones.

const S = (status, synced) => ({status, synced});
const LOADING = S("loading", false);
const READY_CACHE = S("ready", false); // ready por documentos de caché, sin confirmar
const READY_SYNCED = S("ready", true);
const SLOW = S("slow", false);
const ERROR = S("error", false);

const snapshot = (fromCache, empty) => ({type: "snapshot", fromCache, empty});
const SERVER_EMPTY = snapshot(false, true);
const SERVER_DOCS = snapshot(false, false);
const CACHE_EMPTY = snapshot(true, true);
const CACHE_DOCS = snapshot(true, false);
const TIMEOUT = {type: "timeout"};
const FAIL = {type: "error"};
const RETRY = {type: "retry"};

const step = (state, event) => nextSubscriptionStatus(state, event);
const assertState = (actual, expected, name) => {
  assert.deepEqual({...actual}, expected, name);
  assert.ok(Object.keys(actual).sort().join() === "status,synced", `${name}: solo status y synced`);
};
const assertValid = (state, name) => {
  assert.ok(state && typeof state === "object", `${name}: es un objeto`);
  assert.ok(Object.values(SUBSCRIPTION_STATUS).includes(state.status), `${name}: status válido (${state.status})`);
  assert.equal(typeof state.synced, "boolean", `${name}: synced booleano`);
  assert.doesNotMatch(String(state.status) + String(state.synced), /undefined|NaN|Infinity/, `${name}: sin undefined`);
};

// --- Tabla completa: estado inicial x evento -> estado esperado ---
const table = [
  // loading
  [LOADING, SERVER_EMPTY, S("ready", true), "loading + servidor vacío -> ready (no slow)"],
  [LOADING, SERVER_DOCS, S("ready", true), "loading + servidor con docs -> ready y synced"],
  [LOADING, CACHE_DOCS, S("ready", false), "loading + caché con docs -> ready sin synced"],
  [LOADING, CACHE_EMPTY, S("slow", false), "loading + caché vacía -> slow (nunca ready)"],
  [LOADING, TIMEOUT, S("slow", false), "loading + timeout -> slow"],
  [LOADING, FAIL, S("error", false), "loading + error -> error"],
  [LOADING, RETRY, S("loading", false), "loading + retry -> loading"],
  // ready por caché (synced=false)
  [READY_CACHE, SERVER_EMPTY, S("ready", true), "ready(caché) + servidor vacío -> ready synced"],
  [READY_CACHE, SERVER_DOCS, S("ready", true), "ready(caché) + servidor con docs -> ready synced"],
  [READY_CACHE, CACHE_DOCS, S("ready", false), "ready(caché) + caché con docs -> se mantiene"],
  [READY_CACHE, CACHE_EMPTY, S("slow", false), "ready(caché) + caché vacía sin synced -> slow (nunca ready)"],
  [READY_CACHE, TIMEOUT, S("ready", false), "ready + timeout -> sin cambio"],
  [READY_CACHE, FAIL, S("error", false), "ready + error -> error"],
  [READY_CACHE, RETRY, S("loading", false), "ready + retry -> loading"],
  // ready confirmado por el servidor
  [READY_SYNCED, SERVER_EMPTY, S("ready", true), "ready synced + servidor vacío -> sigue ready"],
  [READY_SYNCED, SERVER_DOCS, S("ready", true), "ready synced + servidor con docs -> sigue ready"],
  [READY_SYNCED, CACHE_DOCS, S("ready", true), "ready synced + caché con docs -> sigue ready"],
  [READY_SYNCED, CACHE_EMPTY, S("ready", true), "ready synced + caché vacía posterior -> sigue ready (no degradar)"],
  [READY_SYNCED, TIMEOUT, S("ready", true), "timeout ignorado si synced"],
  [READY_SYNCED, FAIL, S("error", true), "ready synced + error -> error"],
  [READY_SYNCED, RETRY, S("loading", false), "ready synced + retry -> loading sin synced"],
  // slow
  [SLOW, SERVER_EMPTY, S("ready", true), "slow + servidor vacío -> ready"],
  [SLOW, SERVER_DOCS, S("ready", true), "slow + servidor con docs -> ready"],
  [SLOW, CACHE_DOCS, S("ready", false), "slow + caché con docs -> ready"],
  [SLOW, CACHE_EMPTY, S("slow", false), "slow + caché vacía -> sigue slow"],
  [SLOW, TIMEOUT, S("slow", false), "slow + timeout -> sin cambio"],
  [SLOW, FAIL, S("error", false), "slow + error -> error"],
  [SLOW, RETRY, S("loading", false), "slow + retry -> loading"],
  // error
  [ERROR, SERVER_EMPTY, S("error", false), "error + snapshot del servidor -> sin cambio"],
  [ERROR, SERVER_DOCS, S("error", false), "error + snapshot con docs -> sin cambio"],
  [ERROR, CACHE_DOCS, S("error", false), "error + caché con docs -> sin cambio"],
  [ERROR, CACHE_EMPTY, S("error", false), "error + caché vacía -> sin cambio"],
  [ERROR, TIMEOUT, S("error", false), "error + timeout -> sin cambio"],
  [ERROR, FAIL, S("error", false), "error + error -> error"],
  [ERROR, RETRY, S("loading", false), "error + retry -> loading"],
];
for (const [from, event, expected, name] of table) {
  assertState(step(from, event), expected, name);
}
console.log(`OK: tabla completa de transiciones — ${table.length} combinaciones`);

// --- Reglas nombradas de la decisión ---
assertState(step(LOADING, SERVER_EMPTY), S("ready", true), "servidor vacío -> ready, no slow");
assertState(step(LOADING, CACHE_EMPTY), S("slow", false), "caché vacía -> slow, no ready");
assertState(step(step(LOADING, SERVER_EMPTY), CACHE_EMPTY), S("ready", true), "ready + caché vacía posterior -> sigue ready");
assertState(step(step(LOADING, CACHE_EMPTY), SERVER_EMPTY), S("ready", true), "slow -> ready al llegar el servidor");
assertState(step(READY_SYNCED, TIMEOUT), S("ready", true), "timeout ignorado si synced");
assert.notEqual(step(LOADING, CACHE_EMPTY).status, "ready", "un snapshot de caché vacío NUNCA produce ready sin synced");
console.log("OK: reglas — servidor vacío es ready, caché vacía es slow, ready no se degrada, slow->ready con servidor, timeout ignorado si synced");

// --- Escenarios completos ---
let state = INITIAL_SUBSCRIPTION_STATE;
assertState(state, LOADING, "estado inicial");
state = step(state, TIMEOUT);
assert.equal(state.status, "slow", "sin respuesta en 10 s -> slow");
state = step(state, CACHE_EMPTY);
assert.equal(state.status, "slow", "el snapshot vacío de caché del SDK no lo saca de slow");
state = step(state, SERVER_DOCS);
assertState(state, READY_SYNCED, "llega el servidor -> ready");
state = step(state, FAIL);
assert.equal(state.status, "error", "error posterior -> error");
state = step(state, SERVER_DOCS);
assert.equal(state.status, "error", "snapshot estando en error: sin cambio");
state = step(state, RETRY);
assertState(state, LOADING, "retry -> loading sin synced");
state = step(state, SERVER_EMPTY);
assertState(state, READY_SYNCED, "tras retry, servidor vacío -> ready");
console.log("OK: escenarios — red lenta, snapshot tardío, error, snapshot ignorado en error y retry");

// --- Referencias: sin cambio devuelve la misma referencia; no muta ---
for (const [from, event, expected, name] of table) {
  const frozen = Object.freeze({...from});
  const result = step(frozen, event);
  assert.deepEqual({...frozen}, from, `${name}: no muta el estado de entrada`);
  if (expected.status === from.status && expected.synced === from.synced) {
    assert.equal(result, frozen, `${name}: sin cambio devuelve la misma referencia (React descarta el re-render)`);
  }
}
const metadataOnly = step(READY_SYNCED, SERVER_DOCS);
assert.equal(metadataOnly, step(metadataOnly, SERVER_DOCS), "notificaciones solo de metadatos no cambian el estado");
console.log("OK: pureza — no muta, y devuelve la misma referencia si nada cambia");

// --- Entradas inválidas o eventos desconocidos: no lanzan ni producen undefined ---
const badStates = [undefined, null, 0, 1, "loading", true, [], {}, {status: "bogus"}, {status: 5, synced: true}, {status: "ready"}, {status: "ready", synced: "yes"}, {synced: true}];
const badEvents = [undefined, null, 0, "snapshot", [], {}, {type: "unknown"}, {type: 5}, {type: "snapshot"}, {type: "snapshot", fromCache: "yes", empty: false}, {type: "snapshot", fromCache: true}, {type: "snapshot", empty: true}, {type: "snapshot", fromCache: null, empty: null}, {type: "TIMEOUT"}];
for (const badState of badStates) {
  for (const event of [...badEvents, SERVER_EMPTY, CACHE_EMPTY, TIMEOUT, FAIL, RETRY]) {
    let result;
    assert.doesNotThrow(() => { result = step(badState, event); }, `no lanza con estado ${JSON.stringify(badState)} y evento ${JSON.stringify(event)}`);
    assertValid(result, `estado inválido ${JSON.stringify(badState)}`);
  }
}
for (const badEvent of badEvents) {
  for (const validState of [LOADING, READY_CACHE, READY_SYNCED, SLOW, ERROR]) {
    const result = step(validState, badEvent);
    assert.equal(result, validState, `un evento inválido (${JSON.stringify(badEvent)}) no cambia un estado válido`);
  }
}
assertState(step(undefined, undefined), LOADING, "todo indefinido -> estado inicial");
assertState(step({status: "ready"}, undefined), S("ready", false), "status válido sin synced se sanea a synced=false");
console.log("OK: entradas inválidas y eventos desconocidos — no lanzan, devuelven un estado válido y no producen undefined");

// --- Pureza del módulo: sin React ni Firebase ---
const source = await readFile(new URL("../src/domain/subscriptionStatus.mjs", import.meta.url), "utf8");
// Sin comentarios: el encabezado del módulo menciona React y Firebase para explicar por qué no los usa.
const code = source.replace(/\/\/.*$/gm, "");
assert.doesNotMatch(code, /^\s*import\s/m, "el módulo no importa nada");
assert.doesNotMatch(code, /react|firebase|firestore|window\.|document\./i, "sin React, Firebase ni DOM");
console.log("OK: el módulo no importa nada ni toca React, Firebase o el DOM");

// --- Servicio: entrega fromCache e includeMetadataChanges (sin Firebase: lectura de fuente) ---
const serviceSource = await readFile(new URL("../src/services/referenceTaskService.js", import.meta.url), "utf8");
const subscribeBody = serviceSource.match(/export function subscribeToReferenceTasks\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || "";
assert.ok(subscribeBody, "existe subscribeToReferenceTasks");
assert.match(subscribeBody, /\{ includeMetadataChanges: true \}/, "onSnapshot con includeMetadataChanges: true");
assert.match(subscribeBody, /onTasks\(sortReferenceTasks\(tasks\), \{\s*fromCache: snapshot\.metadata\.fromCache,?\s*\}\)/, "onTasks(tasks, {fromCache})");
assert.match(subscribeBody, /^\s*onError\s*$/m, "el callback de error se sigue pasando a onSnapshot");
const pendingBody = serviceSource.match(/export function subscribeToPendingReferenceTasks\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || "";
assert.match(pendingBody, /\(tasks\) => onTasks\(tasks\.filter\(/, "subscribeToPendingReferenceTasks (código muerto) no se toca");
console.log("OK: servicio — onSnapshot con includeMetadataChanges, onTasks recibe {fromCache} y el callback de error sigue pasando");

// --- ReferenceTasksPage: usa la máquina, el timeout y el orden de estados (lectura de fuente) ---
const pageSource = await readFile(new URL("../src/pages/ReferenceTasksPage.jsx", import.meta.url), "utf8");
const cssInterior = await readFile(new URL("../src/styles/interior.css", import.meta.url), "utf8");
assert.match(pageSource, /const SLOW_CONNECTION_TIMEOUT_MS = 10000;/, "constante con nombre de 10 s");
assert.match(pageSource, /from "\.\.\/domain\/subscriptionStatus\.mjs"/, "usa la máquina pura");
const timerCallback = pageSource.match(/window\.setTimeout\(\(\) => \{([\s\S]*?)\}, SLOW_CONNECTION_TIMEOUT_MS\)/)?.[1] || "";
assert.match(timerCallback, /SUBSCRIPTION_EVENT\.TIMEOUT/, "el temporizador emite timeout");
assert.doesNotMatch(timerCallback, /unsubscribe/, "al vencer el timeout NO se cancela el listener (un snapshot tardío pasa a ready)");
const cleanup = pageSource.match(/return \(\) => \{\s*clearSlowTimer\(\);\s*unsubscribe\(\);\s*\};/);
assert.ok(cleanup, "el cleanup limpia el temporizador y cancela el listener al desmontar");
assert.match(pageSource, /\}, \[userId, retryCount, dispatchSubscription\]\);/, "el contador de reintento está en las dependencias del efecto");
assert.match(pageSource, /if \(!fromCache\) clearSlowTimer\(\);/, "el temporizador se limpia al recibir un snapshot del servidor");
assert.match(pageSource, /clearSlowTimer\(\);\s*dispatchSubscription\(\{ type: SUBSCRIPTION_EVENT\.ERROR \}\)/, "el error de onSnapshot pasa a la máquina");
assert.match(pageSource, /dispatchSubscription\(\{ type: SUBSCRIPTION_EVENT\.RETRY \}\)/, "cada suscripción arranca con retry (loading)");
assert.doesNotMatch(pageSource, /setError\(/, "sin el error mezclado: los errores de acciones van a actionError");
assert.match(pageSource, /\{actionError && <p role="alert" style=\{styles\.errorText\}>\{actionError\}<\/p>\}/, "actionError con el <p role=alert> inline existente");
const iLoading = pageSource.indexOf("SUBSCRIPTION_STATUS.LOADING ? (");
const iBanner = pageSource.indexOf("SUBSCRIPTION_STATUS.SLOW ||");
const iEmpty = pageSource.indexOf("No hay tareas para este filtro.");
assert.ok(iLoading > -1 && iBanner > iLoading && iEmpty > iBanner, "orden: cargando -> lento/error -> vacío -> lista");
assert.match(pageSource, /<LoadingState variant="section" label="Cargando tareas de referencias\.\.\." \/>/);
assert.match(pageSource, /La conexión está lenta o no hay conexión\. Sigue intentando\.\.\./);
assert.match(pageSource, /No se pudieron cargar las tareas de referencias\./);
assert.match(pageSource, /variant="secondary"\s+icon=\{RefreshCw\}\s+onClick=\{retrySubscription\}/, "Reintentar con el patrón de Clients y Providers");
assert.match(pageSource, /className="client-message client-message--error"/);
assert.match(cssInterior, /^\.client-message \{/m, ".client-message vive en el CSS compartido (interior.css)");
assert.match(cssInterior, /^\.client-message--error \{/m, ".client-message--error vive en el CSS compartido (interior.css)");
assert.doesNotMatch(pageSource, /import "[^"]*\.css"/, "la página no importa CSS de feature");
console.log("OK: ReferenceTasksPage — máquina, timeout de 10 s sin cancelar el listener, limpieza, reintento, actionError separado y orden de estados");

console.log("SUBSCRIPTION_STATUS_SMOKE_OK");
