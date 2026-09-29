import { useCallback, useEffect, useState } from "react";
import {
  INITIAL_SUBSCRIPTION_STATE,
  SUBSCRIPTION_EVENT,
  nextSubscriptionStatus,
} from "../domain/subscriptionStatus.mjs";
import {
  markNotificationRead,
  subscribeToNotifications,
} from "../services/notificationService";

// Sin respuesta del servidor en este tiempo, el panel pasa a "lenta o sin
// conexión". El listener NO se cancela: un snapshot tardío lo lleva a ready.
// Mismo umbral que ya usaba ReferenceTasksPage (recuperable de 720a7a1~1).
const SLOW_CONNECTION_TIMEOUT_MS = 10000;

// businessId ya viene resuelto por quien llama (cadena vacía si no
// corresponde suscribirse): mismo patrón que useFinancialMovements, el
// guard de rol vive en el llamador, no acá. Con businessId vacío, este
// hook nunca llama a subscribeToNotifications ni toca Firestore.
export default function useNotifications(businessId) {
  const [notifications, setNotifications] = useState([]);
  const [subscription, setSubscription] = useState(INITIAL_SUBSCRIPTION_STATE);
  const [retryCount, setRetryCount] = useState(0);

  const dispatch = useCallback((event) => {
    setSubscription((current) => nextSubscriptionStatus(current, event));
  }, []);

  useEffect(() => {
    setNotifications([]);
    setSubscription(INITIAL_SUBSCRIPTION_STATE);
    if (!businessId) return undefined;

    dispatch({ type: SUBSCRIPTION_EVENT.RETRY });

    let timeoutId = window.setTimeout(() => {
      timeoutId = null;
      dispatch({ type: SUBSCRIPTION_EVENT.TIMEOUT });
    }, SLOW_CONNECTION_TIMEOUT_MS);
    const clearSlowTimer = () => {
      if (timeoutId === null) return;
      window.clearTimeout(timeoutId);
      timeoutId = null;
    };

    const unsubscribe = subscribeToNotifications(
      businessId,
      (items, meta) => {
        const fromCache = meta?.fromCache === true;
        setNotifications(items);
        if (!fromCache) clearSlowTimer();
        dispatch({
          type: SUBSCRIPTION_EVENT.SNAPSHOT,
          fromCache,
          empty: items.length === 0,
        });
      },
      (error) => {
        if (import.meta.env.DEV) {
          console.error("Error al cargar notificaciones:", error);
        }
        clearSlowTimer();
        dispatch({ type: SUBSCRIPTION_EVENT.ERROR });
      }
    );

    return () => {
      clearSlowTimer();
      unsubscribe();
    };
  }, [businessId, retryCount, dispatch]);

  const retry = useCallback(() => setRetryCount((count) => count + 1), []);
  const markRead = useCallback(
    (notificacionId) => markNotificationRead(businessId, notificacionId),
    [businessId]
  );
  const unreadCount = notifications.reduce(
    (count, notification) => (notification.leida ? count : count + 1),
    0
  );

  return { markRead, notifications, retry, subscription, unreadCount };
}
