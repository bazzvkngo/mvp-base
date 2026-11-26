import assert from "node:assert/strict";
import {
  INVITATIONS_LOAD_LIMITS,
  INVITATIONS_STATUS,
  INVITATIONS_TIMEOUT_CODE,
  countLoadedInvitations,
  createInvitationsLoader,
} from "../src/domain/invitationsLoader.mjs";

// Carga de invitaciones (paso 1 del centro de notificaciones): tope de espera, estado lento, una sola
// consulta en vuelo, datos recientes y respuestas viejas. Puro y sin esperar de verdad: reloj y
// temporizadores inyectados.

const {LOADING, SLOW, READY, ERROR} = INVITATIONS_STATUS;

function createClock() {
  let time = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(callback, ms) {
      const id = nextId++;
      timers.set(id, {at: time + ms, callback});
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    // Avanza el reloj disparando los temporizadores en orden, como ocurriría de verdad.
    advance(ms) {
      const target = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].callback();
      }
      time = target;
    },
  };
}

// Cada llamada del servicio queda pendiente hasta que la prueba la resuelva o la rechace.
function createFetcher() {
  const calls = [];
  const fetchInvitations = ({signal}) =>
    new Promise((resolve, reject) => {
      calls.push({signal, resolve, reject});
    });
  return {calls, fetchInvitations};
}

const invitation = (id) => ({id, negocioNombre: `Negocio ${id}`, rol: "VENTAS"});
const response = (...ids) => ({invitations: ids.map(invitation), requiresVerification: false});
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(options = {}) {
  const clock = createClock();
  const fetcher = createFetcher();
  const errors = [];
  const loader = createInvitationsLoader({
    fetchInvitations: fetcher.fetchInvitations,
    onError: (error) => errors.push(error),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...options,
  });
  const seen = [];
  loader.subscribe(() => seen.push(loader.getState().status));
  return {clock, errors, fetcher, loader, seen};
}

assert.deepEqual(
  {...INVITATIONS_LOAD_LIMITS},
  {SLOW_AFTER_MS: 8000, TIMEOUT_MS: 15000, FRESH_MS: 30000},
  "topes acordados: aviso a los 8 s, corte a los 15 s, datos recientes 30 s"
);

// 1. Carga normal.
{
  const {clock, fetcher, loader, seen} = setup();
  assert.equal(loader.getState().status, LOADING, "estado inicial: cargando");
  const done = loader.load();
  assert.equal(fetcher.calls.length, 1);
  assert.equal(loader.getState().status, LOADING);
  clock.advance(2000);
  fetcher.calls[0].resolve(response("a", "b"));
  const state = await done;
  assert.equal(state.status, READY);
  assert.deepEqual(state.invitations.map((item) => item.id), ["a", "b"]);
  assert.equal(state.requiresVerification, false);
  assert.equal(clock.pending(), 0, "al terminar no quedan temporizadores");
  assert.deepEqual(seen, [READY], "carga normal: pasa de cargando a lista sin pasar por lenta");
  clock.advance(60000);
  assert.equal(loader.getState().status, READY, "los temporizadores cancelados no cambian nada después");
  console.log("OK carga normal: cargando -> ready, sin temporizadores colgados");
}

// 2. Lenta: el aviso aparece a los 8 s, no antes.
{
  const {clock, fetcher, loader, seen} = setup();
  loader.load();
  clock.advance(7999);
  assert.equal(loader.getState().status, LOADING, "a 7,999 s todavía es el esqueleto");
  clock.advance(1);
  assert.equal(loader.getState().status, SLOW, "a los 8 s: lenta");
  assert.equal(fetcher.calls.length, 1, "la lentitud no lanza otra consulta");
  assert.equal(fetcher.calls[0].signal.aborted, false, "y la consulta sigue en curso");
  assert.deepEqual(loader.getState().invitations, []);
  // Si responde estando lenta, pasa a ready sin error.
  fetcher.calls[0].resolve(response("a"));
  await tick();
  assert.equal(loader.getState().status, READY);
  assert.deepEqual(seen, [SLOW, READY]);
  assert.equal(clock.pending(), 0);
  console.log("OK lenta: aviso a los 8 s y una respuesta tardía lleva a ready");
}

// 3. Error a los 15 s en total, aunque el servicio nunca responda.
{
  const {clock, errors, fetcher, loader, seen} = setup();
  const done = loader.load();
  clock.advance(8000);
  assert.equal(loader.getState().status, SLOW);
  clock.advance(6999);
  assert.equal(loader.getState().status, SLOW, "a 14,999 s sigue lenta");
  clock.advance(1);
  const state = await done;
  assert.equal(state.status, ERROR, "a los 15 s: error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, INVITATIONS_TIMEOUT_CODE, "el error del corte se distingue por su código");
  assert.equal(fetcher.calls[0].signal.aborted, true, "el corte aborta la señal para que el servicio no encadene otro intento");
  assert.deepEqual(state.invitations, []);
  assert.equal(clock.pending(), 0);
  assert.deepEqual(seen, [SLOW, ERROR]);
  // Una respuesta que llega después del corte no resucita la consulta ni cambia el error.
  fetcher.calls[0].resolve(response("tarde"));
  await tick();
  assert.equal(loader.getState().status, ERROR, "respuesta posterior al corte: ignorada");
  assert.deepEqual(loader.getState().invitations, []);
  console.log("OK error: corte a los 15 s en total, señal abortada y respuesta tardía ignorada");
}

// 3b. Un error del servicio antes de los 8 s también termina en error (sin pasar por lenta).
{
  const {clock, errors, fetcher, loader, seen} = setup();
  const done = loader.load();
  clock.advance(1000);
  fetcher.calls[0].reject(new Error("Sin conexión"));
  const state = await done;
  assert.equal(state.status, ERROR);
  assert.equal(errors[0].message, "Sin conexión");
  assert.equal(clock.pending(), 0);
  assert.deepEqual(seen, [ERROR]);
  // Un servicio que lanza de forma síncrona tampoco deja la interfaz colgada.
  const sync = createInvitationsLoader({
    fetchInvitations: () => {
      throw new Error("falló al instante");
    },
  });
  assert.equal((await sync.load()).status, ERROR);
  console.log("OK error del servicio: termina en error sin esperar al tope");
}

// 4. Reintento exitoso, desde el error y desde la lentitud.
{
  const {clock, fetcher, loader, seen} = setup();
  loader.load();
  clock.advance(15000);
  assert.equal(loader.getState().status, ERROR);
  const retry = loader.load({force: true});
  assert.equal(loader.getState().status, LOADING, "Reintentar vuelve al esqueleto");
  assert.equal(fetcher.calls.length, 2);
  clock.advance(1000);
  fetcher.calls[1].resolve(response("a"));
  const state = await retry;
  assert.equal(state.status, READY);
  assert.deepEqual(state.invitations.map((item) => item.id), ["a"]);
  assert.equal(clock.pending(), 0);
  assert.deepEqual(seen, [SLOW, ERROR, LOADING, READY]);

  // Desde la lentitud: la consulta lenta se abandona, el nuevo plazo cuenta desde el reintento y la
  // respuesta de la abandonada no se aplica.
  const second = setup();
  second.loader.load();
  second.clock.advance(9000);
  assert.equal(second.loader.getState().status, SLOW);
  const again = second.loader.load({force: true});
  assert.equal(second.loader.getState().status, LOADING, "Reintentar desde lenta vuelve al esqueleto");
  assert.equal(second.fetcher.calls[0].signal.aborted, true, "la consulta lenta se abandona");
  second.clock.advance(7999);
  assert.equal(second.loader.getState().status, LOADING, "el plazo de 8 s se cuenta desde el reintento");
  second.clock.advance(1);
  assert.equal(second.loader.getState().status, SLOW);
  second.fetcher.calls[0].resolve(response("abandonada"));
  second.fetcher.calls[1].resolve(response("nueva"));
  const final = await again;
  assert.deepEqual(final.invitations.map((item) => item.id), ["nueva"]);
  console.log("OK reintento: desde error y desde lenta, con plazos nuevos");
}

// 5. Una sola consulta en vuelo: abrir varias veces reutiliza la pendiente y no reinicia la espera.
{
  const {clock, fetcher, loader, seen} = setup();
  const first = loader.load();
  clock.advance(5000);
  const second = loader.load({silent: false, force: false, maxAgeMs: 30000});
  clock.advance(1000);
  const third = loader.load({silent: true});
  assert.equal(fetcher.calls.length, 1, "una sola consulta en vuelo");
  assert.equal(first, second);
  assert.equal(second, third, "todas las llamadas comparten la misma promesa");
  clock.advance(2000);
  assert.equal(loader.getState().status, SLOW, "los 8 s cuentan desde la primera consulta (en t=8 s), no desde la última apertura");
  clock.advance(6999);
  assert.equal(loader.getState().status, SLOW, "el corte también: 15 s desde la primera");
  fetcher.calls[0].resolve(response("a"));
  await first;
  assert.equal(loader.getState().status, READY);
  assert.deepEqual(loader.getState().invitations.map((item) => item.id), ["a"], "la respuesta buena de la consulta original no se descarta");
  assert.deepEqual(seen, [SLOW, READY]);
  console.log("OK una sola consulta en vuelo: se reutiliza, no reinicia la espera y no descarta la respuesta");
}

// 6. Una respuesta vieja no pisa una nueva.
{
  for (const order of ["la vieja llega después", "la vieja llega antes"]) {
    const {fetcher, loader} = setup();
    const old = loader.load();
    const fresh = loader.load({force: true});
    assert.equal(fetcher.calls.length, 2);
    if (order === "la vieja llega después") {
      fetcher.calls[1].resolve(response("nueva"));
      await fresh;
      fetcher.calls[0].resolve(response("vieja"));
    } else {
      fetcher.calls[0].resolve(response("vieja"));
      await tick();
      assert.equal(loader.getState().status, LOADING, "la abandonada no cambia el estado mientras la nueva espera");
      fetcher.calls[1].resolve(response("nueva"));
      await fresh;
    }
    await old;
    assert.equal(loader.getState().status, READY, order);
    assert.deepEqual(loader.getState().invitations.map((item) => item.id), ["nueva"], `${order}: no pisa la respuesta nueva`);
  }
  console.log("OK respuesta vieja: nunca pisa a la nueva, llegue antes o después");
}

// 7. Datos recientes y refresco en segundo plano.
{
  const {clock, fetcher, loader, seen} = setup();
  const first = loader.load();
  fetcher.calls[0].resolve(response("a"));
  await first;
  assert.equal(loader.getState().status, READY);

  clock.advance(29000);
  const fresh = await loader.load({maxAgeMs: INVITATIONS_LOAD_LIMITS.FRESH_MS});
  assert.equal(fetcher.calls.length, 1, "con datos de 29 s no vuelve a consultar");
  assert.equal(fresh.status, READY);

  clock.advance(2000);
  const seenBefore = seen.length;
  const refresh = loader.load({maxAgeMs: INVITATIONS_LOAD_LIMITS.FRESH_MS});
  assert.equal(fetcher.calls.length, 2, "con datos de 31 s refresca");
  assert.equal(loader.getState().status, READY, "mientras refresca sigue ready: sin volver al esqueleto");
  assert.deepEqual(loader.getState().invitations.map((item) => item.id), ["a"], "muestra los datos anteriores");
  assert.equal(seen.length, seenBefore, "el refresco no notifica cambios de estado hasta tener respuesta");
  clock.advance(9000);
  assert.equal(loader.getState().status, READY, "un refresco lento no pasa a lenta: los datos anteriores siguen a la vista");
  fetcher.calls[1].resolve(response("a", "b"));
  await refresh;
  assert.deepEqual(loader.getState().invitations.map((item) => item.id), ["a", "b"], "la respuesta nueva reemplaza a la anterior");
  assert.ok(!seen.slice(seenBefore).some((status) => status === LOADING || status === SLOW), "ningún paso por esqueleto ni lenta");
  assert.equal(clock.pending(), 0);

  // El refresco que falla o se corta no tapa los datos que ya se mostraban.
  clock.advance(40000);
  const failing = loader.load({maxAgeMs: INVITATIONS_LOAD_LIMITS.FRESH_MS});
  clock.advance(15000);
  await failing;
  assert.equal(loader.getState().status, READY, "refresco cortado: se conserva lo mostrado");
  assert.deepEqual(loader.getState().invitations.map((item) => item.id), ["a", "b"]);
  const failing2 = loader.load();
  fetcher.calls[3].reject(new Error("falló"));
  await failing2;
  assert.equal(loader.getState().status, READY, "refresco fallido: se conserva lo mostrado");
  assert.equal(clock.pending(), 0);
  console.log("OK datos recientes: 30 s sin consultar, refresco en segundo plano sin esqueleto y fallos que no tapan");
}

// 7b. Sin datos cargados, abrir (no silencioso) es una carga visible; una consulta silenciosa no cambia lo visible.
{
  const {clock, fetcher, loader, seen} = setup();
  loader.load();
  clock.advance(15000);
  assert.equal(loader.getState().status, ERROR);
  loader.load({maxAgeMs: 30000});
  assert.equal(loader.getState().status, LOADING, "abrir con un error previo vuelve a intentarlo con esqueleto");
  clock.advance(15000);
  assert.equal(loader.getState().status, ERROR);
  const before = seen.length;
  const silent = loader.load({silent: true});
  assert.equal(loader.getState().status, ERROR, "consulta silenciosa: el error se queda a la vista mientras consulta");
  assert.equal(seen.length, before);
  fetcher.calls[fetcher.calls.length - 1].resolve(response("a"));
  await silent;
  assert.equal(loader.getState().status, READY);
  console.log("OK silenciosa: no cambia lo visible hasta tener respuesta");
}

// 8. Contador: sin invitaciones hasta estar cargadas con éxito.
{
  const {clock, fetcher, loader} = setup();
  const counts = [];
  loader.subscribe(() => counts.push(countLoadedInvitations(loader.getState())));
  assert.equal(countLoadedInvitations(loader.getState()), 0, "inicial: 0");
  const first = loader.load();
  assert.equal(countLoadedInvitations(loader.getState()), 0, "cargando: 0");
  clock.advance(8000);
  assert.equal(countLoadedInvitations(loader.getState()), 0, "lenta: 0");
  clock.advance(7000);
  await first;
  assert.equal(countLoadedInvitations(loader.getState()), 0, "error: 0");
  const retry = loader.load({force: true});
  assert.equal(countLoadedInvitations(loader.getState()), 0);
  fetcher.calls[1].resolve(response("a", "b"));
  await retry;
  assert.equal(countLoadedInvitations(loader.getState()), 2, "cargadas: 2");
  assert.deepEqual(counts, [0, 0, 0, 2], "lenta, error y reintento valen 0; el contador solo cambia al llegar los datos");
  // Refrescar con datos cargados no hace parpadear el contador (nunca baja a 0 en el camino).
  clock.advance(31000);
  const seenCounts = [];
  loader.subscribe(() => seenCounts.push(countLoadedInvitations(loader.getState())));
  const refresh = loader.load({maxAgeMs: 30000});
  fetcher.calls[2].resolve(response("a", "b", "c"));
  await refresh;
  assert.deepEqual(seenCounts, [3], "el refresco pasa de 2 a 3 sin pasar por 0");
  // Estados no listos con datos viejos en el objeto: no se cuentan.
  assert.equal(countLoadedInvitations({status: ERROR, invitations: [invitation("x")]}), 0);
  assert.equal(countLoadedInvitations({status: SLOW, invitations: [invitation("x")]}), 0);
  assert.equal(countLoadedInvitations({status: LOADING, invitations: [invitation("x")]}), 0);
  assert.equal(countLoadedInvitations({status: READY, invitations: [invitation("x")]}), 1);
  assert.equal(countLoadedInvitations(null), 0);
  assert.equal(countLoadedInvitations({status: READY}), 0);
  console.log("OK contador: 0 hasta estar listas y sin parpadeo al refrescar");
}

// 9. Una invitación respondida no reaparece por una respuesta que ya estaba en vuelo.
{
  const {clock, fetcher, loader} = setup();
  const first = loader.load();
  fetcher.calls[0].resolve(response("a", "b"));
  await first;
  clock.advance(31000);
  const refresh = loader.load({maxAgeMs: 30000});
  loader.removeInvitation("a");
  assert.deepEqual(loader.getState().invitations.map((item) => item.id), ["b"], "se quita al instante");
  fetcher.calls[1].resolve(response("a", "b", "c"));
  await refresh;
  assert.deepEqual(loader.getState().invitations.map((item) => item.id), ["b", "c"], "la respuesta vieja no devuelve la respondida");
  console.log("OK respondida: no reaparece por una consulta que ya estaba en vuelo");
}

// 10. Cancelar (desmontar) detiene todo y deja volver a cargar (modo estricto de React).
{
  const {clock, fetcher, loader, seen} = setup();
  loader.load();
  loader.cancel();
  assert.equal(fetcher.calls[0].signal.aborted, true);
  assert.equal(clock.pending(), 0, "cancelar limpia los temporizadores");
  fetcher.calls[0].resolve(response("a"));
  clock.advance(60000);
  await tick();
  assert.equal(loader.getState().status, LOADING, "una respuesta posterior a cancelar no cambia nada");
  assert.deepEqual(seen, []);
  const again = loader.load();
  assert.equal(fetcher.calls.length, 2, "tras cancelar, cargar de nuevo funciona");
  fetcher.calls[1].resolve(response("b"));
  assert.equal((await again).status, READY);
  console.log("OK cancelar: sin efectos tardíos y se puede volver a cargar");
}

// 11. requiresVerification se conserva y los datos mal formados no rompen.
{
  const {fetcher, loader} = setup();
  const done = loader.load();
  fetcher.calls[0].resolve({invitations: [], requiresVerification: true});
  const state = await done;
  assert.equal(state.requiresVerification, true);
  const odd = setup();
  const oddDone = odd.loader.load();
  odd.fetcher.calls[0].resolve(undefined);
  assert.deepEqual((await oddDone).invitations, []);
  console.log("OK respuesta: requiresVerification conservado y respuesta vacía tolerada");
}

console.log("INVITATIONS_LOADER_SMOKE_OK");
