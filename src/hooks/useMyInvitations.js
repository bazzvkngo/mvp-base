import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  INVITATIONS_LOAD_LIMITS,
  INVITATIONS_STATUS,
  createInvitationsLoader,
} from "../domain/invitationsLoader.mjs";
import useVisiblePolling from "./useVisiblePolling";
import {
  createRequestId,
  listarMisInvitaciones,
  responderInvitacion,
} from "../services/teamInvitationService";

// "slow" es nuevo: la consulta pasó de 8 s sin respuesta (a los 15 s pasa a "error").
export const MY_INVITATIONS_STATUS = INVITATIONS_STATUS;

const cleanError = (error, fallback) =>
  String(error?.message || "").replace(/^Firebase:\s*/i, "").trim() || fallback;

const logLoadError = (error) => {
  if (import.meta.env.DEV) {
    console.error("Error al cargar invitaciones:", error);
  }
};

// Invitaciones pendientes de la cuenta que inició sesión (SPEC 032). No hay
// colección legible desde el navegador: todo pasa por listarMisInvitaciones.
// Los tiempos (aviso de lentitud, corte con error, una sola consulta en vuelo y
// datos recientes) viven en createInvitationsLoader, que se prueba sin React.
// `onAccepted(resultado, invitacion)` corre tras aceptar (recargar sesión y
// entrar a la empresa).
// `reload(opciones)`: sin opciones es una acción explícita (Reintentar) y
// abandona la consulta pendiente; `{ silent: true }` es una consulta periódica
// que reutiliza la pendiente y no cambia lo que se ve; `{ maxAgeMs }` no
// consulta si los datos son más recientes que ese tiempo (al abrir la campana).
// `autoRefreshMs` (0 = apagado): vuelve a consultar en silencio cada ese tiempo solo con la pestaña
// visible y al volver a ella, para que una invitación nueva aparezca sin recargar. Es una consulta
// silenciosa: no muestra el esqueleto, no mueve la lista abierta y un fallo no tapa lo ya mostrado.
export default function useMyInvitations({ enabled = true, onAccepted, autoRefreshMs = 0 } = {}) {
  const loaderRef = useRef(null);
  if (!loaderRef.current) {
    loaderRef.current = createInvitationsLoader({
      fetchInvitations: listarMisInvitaciones,
      onError: logLoadError,
    });
  }
  const loader = loaderRef.current;
  const state = useSyncExternalStore(loader.subscribe, loader.getState, loader.getState);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState({ text: "", error: false });
  const onAcceptedRef = useRef(onAccepted);
  const mountedRef = useRef(true);
  const requestIdsRef = useRef(new Map());
  onAcceptedRef.current = onAccepted;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(
    (options) => {
      const silent = options?.silent === true;
      return loader.load({
        silent,
        force: options?.force ?? !silent,
        maxAgeMs: options?.maxAgeMs ?? 0,
      });
    },
    [loader]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    loader.load();
    return () => loader.cancel();
  }, [enabled, loader]);

  useVisiblePolling(
    () => loader.load({ silent: true, maxAgeMs: INVITATIONS_LOAD_LIMITS.FRESH_MS }),
    { enabled: enabled && autoRefreshMs > 0, intervalMs: autoRefreshMs }
  );

  // Un reintento del mismo clic reutiliza el requestId; cada intento nuevo,
  // tras un éxito o un cambio de motivo, genera uno distinto.
  const respond = useCallback(async (invitation, accion, motivo = "") => {
    if (busyId) return false;
    const key = `${invitation.id}|${accion}|${motivo}`;
    if (!requestIdsRef.current.has(key)) requestIdsRef.current.set(key, createRequestId());
    setBusyId(invitation.id);
    setFeedback({ text: "", error: false });
    try {
      const result = await responderInvitacion({
        invitacionId: invitation.id,
        accion,
        motivo,
        requestId: requestIdsRef.current.get(key),
      });
      requestIdsRef.current.delete(key);
      if (!mountedRef.current) return true;
      loader.removeInvitation(invitation.id);
      if (accion === "aceptar") {
        try {
          await onAcceptedRef.current?.(result, invitation);
        } catch (error) {
          if (!mountedRef.current) return true;
          setFeedback({
            text: cleanError(error, "Aceptaste la invitación, pero no pudimos abrir la empresa. Recarga la página."),
            error: true,
          });
          return true;
        }
        if (mountedRef.current && result?.mensaje) {
          setFeedback({ text: result.mensaje, error: false });
        }
      } else if (mountedRef.current) {
        setFeedback({ text: "Rechazaste la invitación.", error: false });
      }
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setFeedback({
          text: cleanError(error, "No pudimos responder la invitación."),
          error: true,
        });
      }
      return false;
    } finally {
      if (mountedRef.current) setBusyId("");
    }
  }, [busyId, loader]);

  const clearFeedback = useCallback(() => setFeedback({ text: "", error: false }), []);

  return { ...state, busyId, clearFeedback, feedback, reload, respond };
}
