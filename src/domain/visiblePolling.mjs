// Refresco periódico solo con la pestaña visible. Puro: sin React y con reloj, temporizadores y visibilidad
// inyectables, para probarlo sin esperar de verdad (mismo patrón que createInvitationsLoader).
//
// Reglas:
// - Con la pestaña visible llama a `tick` cada `intervalMs`. El siguiente aviso se programa al TERMINAR el
//   anterior: nunca hay dos `tick` a la vez ni se acumulan si el servidor tarda.
// - Con la pestaña oculta no hay temporizador ni consultas.
// - Al volver a la pestaña llama a `tick` en el acto (el `tick` decide si los datos ya son recientes).
// - Un `tick` que falla no rompe el ciclo: el siguiente sigue en su hora.
// - `start` no llama a `tick` de inmediato: la carga inicial es de quien lo usa.

// Un minuto: lo bastante rápido para que un aviso nuevo aparezca sin recargar y lo bastante lento para no
// sumar invocaciones de Functions (cada pestaña visible hace como máximo una consulta por minuto).
export const REFRESH_INTERVAL_MS = 60000;

export function createVisiblePoller({
  tick,
  intervalMs = REFRESH_INTERVAL_MS,
  isVisible = () => globalThis.document?.visibilityState !== "hidden",
  subscribeVisibility = (listener) => {
    globalThis.document?.addEventListener("visibilitychange", listener);
    return () => globalThis.document?.removeEventListener("visibilitychange", listener);
  },
  setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
} = {}) {
  let timer = null;
  let stopped = true;
  let ticking = false;
  let unsubscribe = null;

  const clear = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const schedule = () => {
    clear();
    if (stopped || !isVisible()) return;
    timer = setTimer(run, intervalMs);
  };

  async function run() {
    timer = null;
    if (stopped || ticking || !isVisible()) return;
    ticking = true;
    try {
      await tick();
    } catch {
      // Un fallo del refresco no detiene el ciclo.
    } finally {
      ticking = false;
    }
    schedule();
  }

  const onVisibilityChange = () => {
    if (stopped) return;
    clear();
    if (isVisible()) run();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      unsubscribe = subscribeVisibility(onVisibilityChange);
      schedule();
    },
    stop() {
      stopped = true;
      clear();
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
