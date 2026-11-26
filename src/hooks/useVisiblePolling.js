import { useEffect, useRef } from "react";
import { REFRESH_INTERVAL_MS, createVisiblePoller } from "../domain/visiblePolling.mjs";

// Llama a `tick` cada `intervalMs` solo con la pestaña visible, y al volver a ella. No consulta al montar:
// la carga inicial es de quien lo usa. `tick` puede cambiar en cada render sin reiniciar el ciclo.
export default function useVisiblePolling(tick, { enabled = true, intervalMs = REFRESH_INTERVAL_MS } = {}) {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return undefined;
    const poller = createVisiblePoller({ tick: () => tickRef.current?.(), intervalMs });
    poller.start();
    return () => poller.stop();
  }, [enabled, intervalMs]);
}
