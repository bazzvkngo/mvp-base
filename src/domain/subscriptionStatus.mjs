// Estado de carga de una suscripción en tiempo real (onSnapshot). Puro: sin
// React ni Firebase, para poder probarlo con un smoke sin emuladores.
//
// Por qué existe: sin conexión, Firestore emite por sí mismo un snapshot VACÍO
// con fromCache=true (la caché es en memoria y arranca vacía), que no
// significa "no hay datos" sino "no sé". Ese snapshot nunca debe llevar a
// "ready". `synced` recuerda si ya llegó una respuesta del servidor, para no
// degradar un ready confirmado cuando después llegue otro snapshot de caché.

export const SUBSCRIPTION_STATUS = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  SLOW: "slow",
  ERROR: "error",
});

export const SUBSCRIPTION_EVENT = Object.freeze({
  SNAPSHOT: "snapshot",
  TIMEOUT: "timeout",
  ERROR: "error",
  RETRY: "retry",
});

export const INITIAL_SUBSCRIPTION_STATE = Object.freeze({
  status: SUBSCRIPTION_STATUS.LOADING,
  synced: false,
});

const STATUSES = new Set(Object.values(SUBSCRIPTION_STATUS));

const isValidState = (state) =>
  Boolean(state) &&
  typeof state === "object" &&
  STATUSES.has(state.status) &&
  typeof state.synced === "boolean";

// Estado saneado: uno inválido vuelve al inicial; uno válido se devuelve tal
// cual (misma referencia), lo que permite a React descartar el re-render.
function normalizeState(state) {
  if (isValidState(state)) return state;
  if (
    state &&
    typeof state === "object" &&
    STATUSES.has(state.status)
  ) {
    return Object.freeze({ status: state.status, synced: state.synced === true });
  }
  return INITIAL_SUBSCRIPTION_STATE;
}

const build = (status, synced) => Object.freeze({ status, synced });

// Devuelve siempre un estado válido: nunca lanza ante estados o eventos
// inválidos (los ignora) y devuelve la MISMA referencia si nada cambia.
export function nextSubscriptionStatus(state, event) {
  const current = normalizeState(state);
  const type = event && typeof event === "object" ? event.type : undefined;

  switch (type) {
    case SUBSCRIPTION_EVENT.SNAPSHOT: {
      if (
        typeof event.fromCache !== "boolean" ||
        typeof event.empty !== "boolean"
      ) {
        return current;
      }
      if (current.status === SUBSCRIPTION_STATUS.ERROR) return current;

      if (!event.fromCache) {
        // Respuesta del servidor: ready, aunque venga vacía.
        if (
          current.status === SUBSCRIPTION_STATUS.READY &&
          current.synced
        ) {
          return current;
        }
        return build(SUBSCRIPTION_STATUS.READY, true);
      }

      if (!event.empty) {
        // Caché con documentos: hay algo que mostrar.
        if (current.status === SUBSCRIPTION_STATUS.READY) return current;
        return build(SUBSCRIPTION_STATUS.READY, current.synced);
      }

      // Caché vacía: solo un ready ya confirmado por el servidor se conserva.
      if (current.synced) return current;
      if (current.status === SUBSCRIPTION_STATUS.SLOW) return current;
      return build(SUBSCRIPTION_STATUS.SLOW, false);
    }

    case SUBSCRIPTION_EVENT.TIMEOUT:
      return current.status === SUBSCRIPTION_STATUS.LOADING
        ? build(SUBSCRIPTION_STATUS.SLOW, current.synced)
        : current;

    case SUBSCRIPTION_EVENT.ERROR:
      return current.status === SUBSCRIPTION_STATUS.ERROR
        ? current
        : build(SUBSCRIPTION_STATUS.ERROR, current.synced);

    case SUBSCRIPTION_EVENT.RETRY:
      return current.status === SUBSCRIPTION_STATUS.LOADING && !current.synced
        ? current
        : INITIAL_SUBSCRIPTION_STATE;

    default:
      return current;
  }
}
