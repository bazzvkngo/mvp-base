// Estado y mensajes del modal "Confirmar aprobación / rechazo" de la consola de plataforma (SPEC 039, nota
// de la consola). Lógica pura, sin React ni Firebase, para poder probarla sin emuladores.

export const PLATFORM_ACTION_GENERIC_ERROR = "No se pudo completar la acción. Intenta de nuevo.";

// Códigos de las Functions que traen un texto de negocio en español (p. ej. already-exists: "La identidad
// fiscal ya pertenece a otra empresa verificada."). Red, permisos e internos no entran: no tienen texto útil.
const BUSINESS_ERROR_CODES = Object.freeze(["already-exists", "failed-precondition", "invalid-argument", "not-found"]);

const MAX_BUSINESS_MESSAGE_LENGTH = 300;

function normalizedCode(error) {
  return String(error?.code || "").replace(/^functions\//, "").trim();
}

// Un mensaje es legible si es una frase corta de una línea: sin códigos ("functions/..."), sin trazas ni
// nombres de excepción, y con al menos dos palabras (un "INTERNAL" o "internal" suelto no lo es).
function isReadableMessage(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text.length > MAX_BUSINESS_MESSAGE_LENGTH) return false;
  if (/[\r\n]/.test(text)) return false;
  if (/^(functions\/|firebaseerror|error:)/i.test(text)) return false;
  if (/\bat\s+\S+\s*\(|\.(?:js|mjs|jsx|ts):\d+/.test(text)) return false;
  return /\s/.test(text);
}

// Texto que se muestra dentro del modal cuando la Function rechaza la acción. Nunca devuelve códigos ni trazas.
export function platformActionErrorMessage(error) {
  if (BUSINESS_ERROR_CODES.includes(normalizedCode(error)) && isReadableMessage(error?.message)) {
    return error.message.trim();
  }
  return PLATFORM_ACTION_GENERIC_ERROR;
}

export const INITIAL_DECISION_STATE = Object.freeze({decision: "", error: ""});

// decision: "" (cerrado), "APROBAR" o "RECHAZAR". error: aviso de la última acción fallida.
//   open    -> abre el modal sin aviso
//   start   -> al confirmar se limpia el aviso anterior (reintento)
//   fail    -> la Function rechazó: el modal sigue abierto y muestra el motivo
//   close   -> Volver, la X o una acción exitosa: cierra y olvida el aviso
export function decisionReducer(state = INITIAL_DECISION_STATE, action = {}) {
  switch (action.type) {
    case "open":
      return {decision: String(action.decision || ""), error: ""};
    case "start":
      return state.error ? {...state, error: ""} : state;
    case "fail":
      return state.decision ? {...state, error: platformActionErrorMessage(action.error)} : state;
    case "close":
      return INITIAL_DECISION_STATE;
    default:
      return state;
  }
}

// Confirma la decisión: limpia el aviso, ejecuta la acción y, si falla, deja el aviso en el modal; si resulta,
// lo cierra. `runAction({onError})` es el `run` de la página: devuelve true/false y entrega el error a `onError`
// en lugar de mostrarlo como aviso de página (que queda detrás del modal).
export async function confirmDecision({dispatch, runAction}) {
  dispatch({type: "start"});
  const succeeded = await runAction({onError: (error) => dispatch({type: "fail", error})});
  if (succeeded) dispatch({type: "close"});
  return Boolean(succeeded);
}
