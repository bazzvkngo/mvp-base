import React from "react";
import { Bell, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import AppIcon from "./ui/AppIcon";
import Button from "./ui/Button";
import Notice from "./ui/Notice";
import InvitationsInbox from "./InvitationsInbox";
import ResponsiveDialog from "./ui/ResponsiveDialog";
import { SkeletonCards, SkeletonRegion } from "./ui/Skeleton";
import { SUBSCRIPTION_STATUS } from "../domain/subscriptionStatus.mjs";
import { INVITATION_VERIFY_EMAIL_MESSAGE } from "../domain/teamInvitationModel.mjs";
import { formatRelativeTimestamp, formatTimestamp } from "../utils/formatters";

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

// Icono por tipo de aviso (campo `tipo` que escribe la Function de verificación).
// Un tipo nuevo o desconocido cae en la campana: nunca queda sin icono.
const NOTIFICATION_TYPE_ICONS = Object.freeze({
  VERIFICACION_APROBADA: ShieldCheck,
  VERIFICACION_RECHAZADA: ShieldAlert,
});

export function notificationIcon(type) {
  return NOTIFICATION_TYPE_ICONS[String(type || "").toUpperCase()] || Bell;
}

// La sección de invitaciones solo ocupa lugar si tiene algo que decir: cargando, un
// error, el aviso de correo sin verificar o invitaciones pendientes. Terminó bien,
// sin invitaciones y con el correo verificado: no se dibuja.
export function shouldShowInvitations(invitations) {
  if (!invitations) return false;
  return (
    invitations.status === "loading" ||
    invitations.status === "error" ||
    invitations.requiresVerification === true ||
    (invitations.invitations?.length || 0) > 0
  );
}

// `invitations` (opcional) trae el estado de useMyInvitations más sus acciones:
// las invitaciones llegan por Function, no por la suscripción de Firestore, así
// que se muestran a cualquier rol. `verification` (opcional) trae el reenvío del
// correo de verificación: { cooldownLeft, feedback, onResend, resending }.
// `showNotifications` es false para quien no puede leer
// negocios/{id}/notificaciones (solo OWNER): esa suscripción no se pide y la
// sección de avisos no se dibuja.
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
  verification = null,
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
  const showInvitations = shouldShowInvitations(invitations);
  // El correo sin verificar se explica con un aviso breve y su reenvío; mientras
  // carga o falla, la lista de invitaciones conserva sus propios estados.
  const showVerificationNotice =
    showInvitations && invitations.requiresVerification === true && invitations.status === "ready";
  const cooldownLeft = verification?.cooldownLeft || 0;

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
        size="small"
      >
        {showInvitations && (
          <section className="notification-section" aria-labelledby="notification-invitations-title">
            <h3 id="notification-invitations-title" className="notification-section__title">
              Invitaciones
            </h3>
            {showVerificationNotice ? (
              // role={null}: el aviso es estático. La única región de estado es el
              // feedback del reenvío, y solo existe cuando hay texto.
              <Notice
                variant="info"
                role={null}
                className="notification-notice"
                actions={
                  verification?.onResend && (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        loading={verification.resending}
                        disabled={cooldownLeft > 0}
                        onClick={verification.onResend}
                      >
                        {cooldownLeft > 0 ? `Reenviar en ${cooldownLeft} s` : "Reenviar correo"}
                      </Button>
                      {verification.feedback && (
                        <p className="notification-notice__feedback" role="status">
                          {verification.feedback}
                        </p>
                      )}
                    </>
                  )
                }
              >
                {INVITATION_VERIFY_EMAIL_MESSAGE}
              </Notice>
            ) : (
              <InvitationsInbox {...invitations} />
            )}
          </section>
        )}
        {showNotifications && (
          <section className="notification-section" aria-label="Avisos">
            {showInvitations && <h3 className="notification-section__title">Avisos</h3>}
            {subscription.status === SUBSCRIPTION_STATUS.LOADING ? (
              <SkeletonRegion label="Cargando notificaciones...">
                <SkeletonCards count={3} />
              </SkeletonRegion>
            ) : subscription.status === SUBSCRIPTION_STATUS.SLOW ||
              subscription.status === SUBSCRIPTION_STATUS.ERROR ? (
              subscription.status === SUBSCRIPTION_STATUS.ERROR ? (
                <div className="client-message client-message--error" role="alert">
                  <span>No se pudieron cargar las notificaciones.</span>
                  <Button type="button" variant="secondary" icon={RefreshCw} onClick={retry}>
                    Reintentar
                  </Button>
                </div>
              ) : (
                <Notice
                  variant="warning"
                  className="client-message--warning"
                  actions={
                    <Button type="button" variant="secondary" icon={RefreshCw} onClick={retry}>
                      Reintentar
                    </Button>
                  }
                >
                  La conexión está lenta o no hay conexión. Sigue intentando...
                </Notice>
              )
            ) : notifications.length === 0 ? (
              <p className="notification-empty">Sin notificaciones</p>
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
                      <span className="notification-list__icon">
                        <AppIcon icon={notificationIcon(notification.tipo)} size={18} />
                      </span>
                      <span className="notification-list__content">
                        <strong>{notification.titulo}</strong>
                        {notification.descripcion && (
                          <span className="notification-list__text">{notification.descripcion}</span>
                        )}
                        <small title={formatTimestamp(notification.creadoEn)}>
                          {formatRelativeTimestamp(notification.creadoEn)}
                        </small>
                      </span>
                      {!notification.leida && (
                        <>
                          <span className="notification-list__dot" aria-hidden="true" />
                          <span className="sr-only">No leída</span>
                        </>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {/* Rol sin permiso de avisos, sin invitaciones y con el correo verificado:
            ninguna sección se dibuja y el cuerpo quedaría vacío. */}
        {!showInvitations && !showNotifications && (
          <p className="notification-empty">Sin notificaciones</p>
        )}
      </ResponsiveDialog>
    </>
  );
}

export default NotificationBellView;
