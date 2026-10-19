import React from "react";
import { Bell, RefreshCw } from "lucide-react";
import AppIcon from "./ui/AppIcon";
import Button from "./ui/Button";
import InvitationsInbox from "./InvitationsInbox";
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

// `invitations` (opcional) trae el estado de useMyInvitations más sus acciones:
// las invitaciones llegan por Function, no por la suscripción de Firestore, así
// que se muestran a cualquier rol. `showNotifications` es false para quien no
// puede leer negocios/{id}/notificaciones (solo OWNER): esa suscripción no se
// pide y la sección de avisos no se dibuja.
function NotificationBellView({
  invitations = null,
  markRead,
  notifications,
  onClose,
  onOpen,
  open,
  retry,
  showNotifications = true,
  subscription,
  unreadCount,
}) {
  const pendingInvitations = invitations?.invitations?.length || 0;
  const totalUnread = unreadCount + pendingInvitations;
  const badgeLabel = formatBadgeCount(totalUnread);
  // Si la suscripción de avisos falló, el contador no puede mostrar "0" como si
  // todo estuviera leído: se marca con "!" y se avisa en la etiqueta. Las
  // invitaciones (otra fuente) conservan su propio conteo en la etiqueta.
  const notificationsFailed =
    showNotifications && subscription.status === SUBSCRIPTION_STATUS.ERROR;
  const unreadLabel = totalUnread > 0 ? `${totalUnread} sin leer` : "";
  const bellLabel = notificationsFailed
    ? `Notificaciones, no se pudieron cargar los avisos${unreadLabel ? `, ${unreadLabel}` : ""}`
    : totalUnread > 0
      ? `Notificaciones, ${unreadLabel}`
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
        {(totalUnread > 0 || notificationsFailed) && (
          <span
            className="ui-badge-count topbar-notifications-button__badge"
            aria-hidden="true"
          >
            {notificationsFailed ? "!" : badgeLabel}
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
        {invitations && (
          <section className="notification-section" aria-labelledby="notification-invitations-title">
            <h3 id="notification-invitations-title" className="notification-section__title">
              Invitaciones
            </h3>
            <InvitationsInbox {...invitations} />
          </section>
        )}
        {showNotifications && (
          <section className="notification-section" aria-label="Avisos">
            {invitations && <h3 className="notification-section__title">Avisos</h3>}
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
          </section>
        )}
      </ResponsiveDialog>
    </>
  );
}

export default NotificationBellView;
