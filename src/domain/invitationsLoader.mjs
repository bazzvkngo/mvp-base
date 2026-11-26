// Carga de "Mis invitaciones" con tiempos propios. Puro: sin React ni Firebase, con temporizadores y reloj
// inyectables, para probarlo sin esperar de verdad (mismo patrón que createWorkSubmitController).
//
// Reglas:
// - Tope propio de espera: a SLOW_AFTER_MS se avisa de la lentitud ("slow") y a TIMEOUT_MS en total se corta
//   con error. El corte vale para toda la consulta, incluido el reintento con renovación de token que hace
//   el servicio: no depende del SDK (ver teamInvitationService.js).
// - Una sola consulta en vuelo: pedir otra mientras hay una pendiente devuelve la pendiente, sin reiniciar
//   su espera. Solo una acción explícita (`force`, el botón Reintentar) abandona la pendiente y empieza otra.
// - Datos recientes: con `maxAgeMs`, si ya hay datos cargados hace menos de ese tiempo no se vuelve a consultar.
// - Datos anteriores a la vista: con datos cargados, refrescar no vuelve al esqueleto (queda "ready" y la
//   respuesta nueva reemplaza a la anterior). Un fallo del refresco no tapa lo que ya se mostraba.
// - Una respuesta de una consulta abandonada, cortada o cancelada nunca se aplica. Tampoco reaparece una
//   invitación respondida mientras la consulta estaba en vuelo.

export const INVITATIONS_STATUS = Object.freeze({
  LOADING: "loading",
  SLOW: "slow",
  READY: "ready",
  ERROR: "error",
});

export const INVITATIONS_LOAD_LIMITS = Object.freeze({
  SLOW_AFTER_MS: 8000,
  TIMEOUT_MS: 15000,
  FRESH_MS: 30000,
});

export const INVITATIONS_TIMEOUT_CODE = "invitations/timeout";

export function createInvitationsTimeoutError() {
  const error = new Error("La consulta de invitaciones tardó demasiado.");
  error.code = INVITATIONS_TIMEOUT_CODE;
  return error;
}

const INITIAL_STATE = Object.freeze({
  status: INVITATIONS_STATUS.LOADING,
  invitations: [],
  requiresVerification: false,
  fetchedAt: 0,
});

// El contador de la campana solo suma invitaciones cargadas con éxito: en cualquier otro estado vale 0.
export function countLoadedInvitations(invitations) {
  if (!invitations || invitations.status !== INVITATIONS_STATUS.READY) return 0;
  return Array.isArray(invitations.invitations) ? invitations.invitations.length : 0;
}

// `fetchInvitations({signal})` devuelve `{invitations, requiresVerification}`. La señal se aborta al cortar,
// abandonar o cancelar la consulta, para que el servicio no encadene otro intento.
export function createInvitationsLoader({
  fetchInvitations,
  onError = () => {},
  now = () => Date.now(),
  setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
  slowAfterMs = INVITATIONS_LOAD_LIMITS.SLOW_AFTER_MS,
  timeoutMs = INVITATIONS_LOAD_LIMITS.TIMEOUT_MS,
} = {}) {
  let state = INITIAL_STATE;
  let attempt = null;
  let sequence = 0;
  const listeners = new Set();

  const update = (patch) => {
    state = {...state, ...patch};
    listeners.forEach((listener) => listener());
  };

  const closeAttempt = (target) => {
    if (target.slowTimer !== null) clearTimer(target.slowTimer);
    if (target.cutTimer !== null) clearTimer(target.cutTimer);
    target.slowTimer = null;
    target.cutTimer = null;
    target.controller.abort();
    if (attempt === target) attempt = null;
  };

  function start({silent}) {
    const target = {
      id: ++sequence,
      controller: new AbortController(),
      slowTimer: null,
      cutTimer: null,
      removedIds: new Set(),
      promise: null,
    };
    attempt = target;
    // Con datos cargados el refresco es en segundo plano. Sin ellos (primera carga, error, lentitud) y si
    // no es una consulta silenciosa, se muestra el esqueleto.
    if (!silent && state.status !== INVITATIONS_STATUS.READY && state.status !== INVITATIONS_STATUS.LOADING) {
      update({status: INVITATIONS_STATUS.LOADING});
    }
    target.promise = new Promise((resolve) => {
      const finish = (outcome) => {
        // Abandonada, cortada o cancelada: su respuesta ya no cuenta.
        if (attempt !== target) {
          resolve(state);
          return;
        }
        closeAttempt(target);
        if (outcome.error === undefined) {
          const result = outcome.result || {};
          const invitations = (Array.isArray(result.invitations) ? result.invitations : []).filter(
            (item) => !target.removedIds.has(item.id)
          );
          update({
            status: INVITATIONS_STATUS.READY,
            invitations,
            requiresVerification: result.requiresVerification === true,
            fetchedAt: now(),
          });
        } else {
          onError(outcome.error);
          // Un fallo del refresco no tapa los datos que ya se mostraban.
          if (state.status !== INVITATIONS_STATUS.READY) update({status: INVITATIONS_STATUS.ERROR});
        }
        resolve(state);
      };

      if (state.status === INVITATIONS_STATUS.LOADING) {
        target.slowTimer = setTimer(() => {
          target.slowTimer = null;
          if (attempt === target && state.status === INVITATIONS_STATUS.LOADING) {
            update({status: INVITATIONS_STATUS.SLOW});
          }
        }, slowAfterMs);
      }
      target.cutTimer = setTimer(() => {
        target.cutTimer = null;
        finish({error: createInvitationsTimeoutError()});
      }, timeoutMs);
      // La consulta se lanza en el acto (una que lanza de forma síncrona también termina en error).
      let pending;
      try {
        pending = Promise.resolve(fetchInvitations({signal: target.controller.signal}));
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then(
        (result) => finish({result}),
        (error) => finish({error: error ?? new Error("Error desconocido")})
      );
    });
    return target.promise;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Devuelve una promesa que se resuelve (nunca se rechaza) con el estado al terminar esa consulta.
    // - silent: no cambia lo que se ve mientras consulta (consultas periódicas).
    // - force: abandona la consulta pendiente y empieza otra (acción explícita de la persona).
    // - maxAgeMs: con datos cargados hace menos de ese tiempo, no consulta.
    load({silent = false, force = false, maxAgeMs = 0} = {}) {
      if (attempt && !force) return attempt.promise;
      if (
        !force &&
        maxAgeMs > 0 &&
        state.status === INVITATIONS_STATUS.READY &&
        now() - state.fetchedAt < maxAgeMs
      ) {
        return Promise.resolve(state);
      }
      if (attempt) closeAttempt(attempt);
      return start({silent});
    },
    // Quita una invitación ya respondida, también de la respuesta de una consulta en vuelo.
    removeInvitation(id) {
      if (attempt) attempt.removedIds.add(id);
      if (!state.invitations.some((item) => item.id === id)) return;
      update({invitations: state.invitations.filter((item) => item.id !== id)});
    },
    // Detiene la consulta pendiente y sus temporizadores (al desmontar). No destruye el cargador: una
    // nueva `load` vuelve a funcionar (el modo estricto de React monta, limpia y vuelve a montar).
    cancel() {
      if (attempt) closeAttempt(attempt);
    },
  };
}
