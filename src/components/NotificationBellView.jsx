import React from "react";
import { Bell, RefreshCw } from "lucide-react";
import AppIcon from "./ui/AppIcon";
import Button from "./ui/Button";
import ResponsiveDialog from "./ui/ResponsiveDialog";
import { SkeletonCards, SkeletonRegion } from "./ui/Skeleton";
import { SUBSCRIPTION_STATUS } from "../domain/subscriptionStatus.mjs";
import { formatTimestamp } from "../utils/formatters";

// Presentacional, sin Firebase: separado de NotificationBell.jsx (que sí
// importa el hook y por lo tanto firebaseConfig) para poder cargarlo y
// probar cada estado de subscriptionStatus y el badge con distintos
// conteos vía Vite ssrLoadModule, sin que la carga del módulo falle por
// resolveFirebaseEnvironment (que exige un --mode que este smoke no usa).

// Solo OWNER: mismo alcance que negocios/{businessId}/notificaciones en
// firestore.rules (hasSetupBusinessRole(businessId, ["OWNER"])). Sin
// permiso nuevo en BUSINESS_PERMISSIONS a propósito — la Rule real es de
// rol, no de permiso, y así lo refleja el guard del cliente.
export function canViewBusinessNotifications(role) {
  return String(role || "").trim().toUpperCase() === "OWNER";
}

// Etiqueta del badge: nunca crece sin límite en el ícono.
export function formatBadgeCount(unreadCount) {
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

function NotificationBellView({
  markRead,
  notifications,
  onClose,
  onOpen,
  open,
  retry,
  subscription,
  unreadCount,
}) {
  const badgeLabel = formatBadgeCount(unreadCount);
  const bellLabel = unreadCount > 0
    ? `Notificaciones, ${unreadCount} sin leer`
    : "Notificaciones";

  return (
    <>
      <button
        type="button"
        className="topbar-notifications-button no-print"
        aria-label={bellLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onOpen}
      >
        <AppIcon icon={Bell} size={20} />
        {unreadCount > 0 && (
          <span
            className="ui-badge-count topbar-notifications-button__badge"
            aria-hidden="true"
          >
            {badgeLabel}
          </span>
        )}
      </button>

      <ResponsiveDialog
        open={open}
        onClose={onClose}
        title="Notificaciones"
        eyebrow="ValoraCloud"
        size="small"
      >
        {subscription.status === SUBSCRIPTION_STATUS.LOADING ? (
          <SkeletonRegion label="Cargando notificaciones...">
            <SkeletonCards count={3} />
          </SkeletonRegion>
        ) : subscription.status === SUBSCRIPTION_STATUS.SLOW ||
          subscription.status === SUBSCRIPTION_STATUS.ERROR ? (
          <div
            className={
              subscription.status === SUBSCRIPTION_STATUS.ERROR
                ? "client-message client-message--error"
                : "client-message client-message--warning"
            }
            role={subscription.status === SUBSCRIPTION_STATUS.ERROR ? "alert" : "status"}
          >
            <span>
              {subscription.status === SUBSCRIPTION_STATUS.ERROR
                ? "No se pudieron cargar las notificaciones."
                : "La conexión está lenta o no hay conexión. Sigue intentando..."}
            </span>
            <Button type="button" variant="secondary" icon={RefreshCw} onClick={retry}>
              Reintentar
            </Button>
          </div>
        ) : notifications.length === 0 ? (
          <p className="erp-empty-state">Sin notificaciones</p>
        ) : (
          <ul className="notification-list">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  className={
                    notification.leida
                      ? "notification-list__item"
                      : "notification-list__item is-unread"
                  }
                  onClick={() => {
                    if (!notification.leida) markRead(notification.id);
                  }}
                >
                  <strong>{notification.titulo}</strong>
                  {notification.descripcion && <span>{notification.descripcion}</span>}
                  <small>{formatTimestamp(notification.creadoEn)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ResponsiveDialog>
    </>
  );
}

export default NotificationBellView;
