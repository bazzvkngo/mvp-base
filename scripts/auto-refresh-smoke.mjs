import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isSameListState, mergeRefreshedFirstPage } from "../src/domain/listRefresh.mjs";
import { REFRESH_INTERVAL_MS, createVisiblePoller } from "../src/domain/visiblePolling.mjs";

// Refresco automático de Verificaciones (superadmin) e invitaciones de la campana: cada minuto, solo con la
// pestaña visible y al volver a ella, sin consultas solapadas y sin tocar lo que la persona tiene en pantalla.

assert.equal(REFRESH_INTERVAL_MS, 60000);

// --- Reloj, temporizadores y visibilidad simulados ---
function createHarness({ intervalMs = 60000, tick }) {
  let clock = 0;
  let visible = true;
  let nextId = 1;
  const timers = new Map();
  const listeners = new Set();
  const calls = [];
  const poller = createVisiblePoller({
    tick: async () => {
      calls.push(clock);
      await tick?.(calls.length);
    },
    intervalMs,
    isVisible: () => visible,
    subscribeVisibility: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { callback, at: clock + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    calls,
    poller,
    timerCount: () => timers.size,
    listenerCount: () => listeners.size,
    async advance(ms) {
      const target = clock + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        clock = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
        await flush();
        await flush();
      }
      clock = target;
    },
    async setVisible(value) {
      visible = value;
      listeners.forEach((listener) => listener());
      await flush();
      await flush();
    },
  };
}

// 1) Visible: una consulta por minuto; la primera NO es inmediata (la carga inicial es de quien lo usa).
{
  const h = createHarness({});
  h.poller.start();
  assert.deepEqual(h.calls, [], "start no consulta de inmediato");
  await h.advance(59999);
  assert.equal(h.calls.length, 0);
  await h.advance(1);
  assert.equal(h.calls.length, 1);
  await h.advance(60000 * 3);
  assert.equal(h.calls.length, 4, "una consulta por minuto");
  h.poller.stop();
  assert.equal(h.timerCount(), 0, "stop limpia el temporizador");
  assert.equal(h.listenerCount(), 0, "stop quita el oyente de visibilidad");
  await h.advance(600000);
  assert.equal(h.calls.length, 4, "detenido no consulta más");
}

// 2) Pestaña oculta: no hay temporizador ni consultas; al volver consulta en el acto y retoma el ritmo.
{
  const h = createHarness({});
  h.poller.start();
  await h.advance(60000);
  assert.equal(h.calls.length, 1);
  await h.setVisible(false);
  assert.equal(h.timerCount(), 0, "oculta: sin temporizador");
  await h.advance(60000 * 10);
  assert.equal(h.calls.length, 1, "oculta: sin consultas");
  await h.setVisible(true);
  assert.equal(h.calls.length, 2, "al volver consulta en el acto");
  await h.advance(60000);
  assert.equal(h.calls.length, 3, "y retoma el ritmo de un minuto");
  h.poller.stop();
}

// 3) Nunca hay dos consultas a la vez, aunque el servidor tarde más que el intervalo o la pestaña cambie.
{
  let release;
  let concurrent = 0;
  let maxConcurrent = 0;
  const h = createHarness({
    tick: () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return new Promise((resolve) => {
        release = () => {
          concurrent -= 1;
          resolve();
        };
      });
    },
  });
  h.poller.start();
  await h.advance(60000);
  assert.equal(h.calls.length, 1);
  await h.advance(60000 * 5);
  assert.equal(h.calls.length, 1, "con una consulta pendiente no se acumulan otras");
  await h.setVisible(false);
  await h.setVisible(true);
  assert.equal(h.calls.length, 1, "cambiar de pestaña con una consulta pendiente no lanza otra");
  release();
  await h.advance(0);
  await new Promise((resolve) => setImmediate(resolve));
  await h.advance(60000);
  assert.equal(h.calls.length, 2, "al terminar, la siguiente sigue en su hora");
  release?.();
  assert.equal(maxConcurrent, 1);
  h.poller.stop();
}

// 4) Una consulta que falla no rompe el ciclo.
{
  const h = createHarness({
    tick: (n) => {
      if (n === 1) throw new Error("falló");
    },
  });
  h.poller.start();
  await h.advance(60000);
  await h.advance(60000);
  await h.advance(60000);
  assert.equal(h.calls.length, 3, "tras un fallo sigue consultando");
  h.poller.stop();
}

// 5) start dos veces no duplica el ciclo.
{
  const h = createHarness({});
  h.poller.start();
  h.poller.start();
  await h.advance(60000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.listenerCount(), 1);
  h.poller.stop();
}

// --- Mezcla de la lista de Verificaciones ---
const row = (id, extra = {}) => ({ id, nombreComercial: `Empresa ${id}`, ...extra });
// Sin "Cargar más": la primera página nueva reemplaza todo (solicitud nueva arriba, aprobada fuera).
assert.deepEqual(
  mergeRefreshedFirstPage(
    { items: [row("b"), row("c")], cursor: "c", loadedMore: false },
    { items: [row("a"), row("b")], cursor: "b" }
  ),
  { items: [row("a"), row("b")], cursor: "b" }
);
// Con "Cargar más": no se pierde nada y el cursor no se mueve; lo nuevo va arriba y lo conocido se actualiza.
assert.deepEqual(
  mergeRefreshedFirstPage(
    { items: [row("b"), row("c"), row("d")], cursor: "d", loadedMore: true },
    { items: [row("a"), row("b", { estado: "nuevo" })], cursor: "b" }
  ),
  { items: [row("a"), row("b", { estado: "nuevo" }), row("c"), row("d")], cursor: "d" }
);
assert.deepEqual(mergeRefreshedFirstPage({ items: [row("a")], cursor: "a", loadedMore: true }, { items: [], cursor: null }), {
  items: [row("a")],
  cursor: "a",
}, "una respuesta vacía no borra lo cargado cuando hubo \"Cargar más\"");
assert.deepEqual(mergeRefreshedFirstPage({}, {}), { items: [], cursor: null });
// Sin cambios no se actualiza el estado (sin re-render ni parpadeo).
assert.equal(isSameListState({ items: [row("a")], cursor: "a" }, { items: [row("a")], cursor: "a" }), true);
assert.equal(isSameListState({ items: [row("a")], cursor: "a" }, { items: [row("a"), row("b")], cursor: "a" }), false);
assert.equal(isSameListState({ items: [row("a")], cursor: "a" }, { items: [row("a")], cursor: "z" }), false);

// --- Cableado ---
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [hook, myInvitations, bell, layout, pages] = await Promise.all([
  read("src/hooks/useVisiblePolling.js"),
  read("src/hooks/useMyInvitations.js"),
  read("src/components/NotificationBell.jsx"),
  read("src/platform/PlatformAdminLayout.jsx"),
  read("src/platform/PlatformAdminPages.jsx"),
]);
assert.ok(hook.includes("createVisiblePoller"), "el hook usa el controlador");
// (b) Invitaciones: la campana pide el refresco; las otras pantallas siguen sin él (apagado por defecto).
assert.match(myInvitations, /autoRefreshMs = 0/);
assert.ok(myInvitations.includes("loader.load({ silent: true, maxAgeMs: INVITATIONS_LOAD_LIMITS.FRESH_MS })"), "consulta silenciosa y sin repetir datos recientes");
assert.ok(myInvitations.includes("enabled: enabled && autoRefreshMs > 0"));
assert.ok(bell.includes("autoRefreshMs: REFRESH_INTERVAL_MS"));
// (a) Contador y Dashboard: resumen silencioso; Verificaciones: lista silenciosa solo en ese modo.
assert.ok(layout.includes("useVisiblePolling(() => loadSummary(false, {silent: true}), {intervalMs: REFRESH_INTERVAL_MS})"));
assert.ok(layout.includes("if (!silent) setSummary((current) => ({...current, loading: true, error: \"\"}));"), "silencioso no marca cargando");
assert.ok(layout.includes("if (!silent) setSummary((current) => ({loading: false, data: current.data, error:"), "un fallo silencioso no deja error en pantalla");
assert.ok(layout.includes("SUMMARY_MIN_INTERVAL_MS"), "se mantiene el mínimo de 30 s entre consultas del resumen");
assert.ok(pages.includes("useVisiblePolling(refreshSilently, {enabled: verificationOnly, intervalMs: REFRESH_INTERVAL_MS})"), "solo Verificaciones refresca su lista");
assert.ok(pages.includes("if (silentBusyRef.current || current.loading || current.error) return;"));
assert.ok(pages.includes("if (seq !== loadSeqRef.current) return;"), "una respuesta silenciosa tardía tras una carga manual se descarta");
assert.ok(pages.includes("mode: \"VERIFICACIONES\""));
// (c) Primeros pasos (empresa recién creada, a la espera de la verificación): pide la sesión cada minuto, solo con la
// pestaña visible, mientras la empresa no pueda operar; cuando la plataforma la verifica, la persona pasa sola.
const [activation, app] = await Promise.all([read("src/pages/InitialBusinessActivationPage.jsx"), read("src/app/App.jsx")]);
assert.ok(activation.includes('import useVisiblePolling from "../hooks/useVisiblePolling";'), "reutiliza el hook existente");
assert.ok(activation.includes("useVisiblePolling(() => onRefresh?.(), { enabled: !operable && typeof onRefresh === \"function\" })"), "solo mientras no pueda operar");
assert.ok(activation.includes("const operable = canBusinessOperate(business || {});"));
assert.match(activation, /if \(operable && verifiedDestination\) onFinish\?\.\(verifiedDestination\);/, "verificada: abre el destino sin recargar");
assert.doesNotMatch(activation, /setInterval|REFRESH_INTERVAL_MS/, "el intervalo es el del hook (60 s)");
assert.ok(app.includes("onRefresh={onBusinessCreated}"), "usa la recarga de getBusinessSession que ya existe");
assert.ok(app.includes('verifiedDestination={canBusinessOperate(activeBusiness) ? safeLanding : ""}'), "destino solo con la empresa verificada");
// La condición de refresco sigue la regla de verificación de la app: una empresa sin verificar refresca; una verificada, no.
const { canBusinessOperate } = await import("../src/domain/businessOperations.mjs");
assert.equal(canBusinessOperate({ verificacionEmpresa: { estado: "PENDIENTE" } }), false, "pendiente: sigue consultando");
assert.equal(canBusinessOperate({ verificacionEmpresa: { estado: "NO_VERIFICADA" } }), false);
assert.equal(canBusinessOperate({ verificacionEmpresa: { estado: "RECHAZADA" } }), false);
assert.equal(canBusinessOperate({ verificacionEmpresa: { estado: "VERIFICADA" }, puedeOperar: true }), true, "verificada: deja de consultar y pasa");
assert.equal(canBusinessOperate({ verificacionEmpresa: { estado: "VERIFICADA" }, puedeOperar: false }), false, "verificada pero sin poder operar: sigue");
console.log("AUTO_REFRESH_SMOKE_OK");
