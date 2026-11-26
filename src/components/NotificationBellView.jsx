import React from "react";
import { Bell, ChevronRight, ClipboardList, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import AppIcon from "./ui/AppIcon";
import Button from "./ui/Button";
import Notice from "./ui/Notice";
import InvitationsInbox from "./InvitationsInbox";
import { SkeletonCards, SkeletonRegion } from "./ui/Skeleton";
import { countLoadedInvitations } from "../domain/invitationsLoader.mjs";
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

// Un aviso leído deja de listarse: la lista solo muestra los que no tienen leida === true.
// Se filtra aquí (y no en la consulta) para no exigir un índice nuevo; el aviso sigue en Firestore.
export function filterUnreadNotifications(notifications) {
  return (notifications || []).filter((notification) => notification.leida !== true);
}

// El panel es un desplegable, no un modal. Los diálogos que abren sus hijos (Rechazar invitación)
// son modales que ResponsiveDialog monta en un portal fuera del panel: mientras haya uno abierto, ni un
// clic fuera ni Escape cierran el panel (si no, el panel se desmontaría con el diálogo y su estado).
const CHILD_DIALOG_SELECTOR = ".responsive-dialog-layer";

export function hasOpenChildDialog(doc) {
  return Boolean(doc?.querySelector?.(CHILD_DIALOG_SELECTOR));
}

export function shouldClosePopoverOnPointerDown(target, root, doc) {
  if (!root || hasOpenChildDialog(doc)) return false;
  return !root.contains(target);
}

export function shouldClosePopoverOnEscape(event, doc) {
  return event?.key === "Escape" && !event.defaultPrevented && !hasOpenChildDialog(doc);
}

// La sección de invitaciones solo ocupa lugar si tiene algo que decir: cargando (o
// lenta), un error, el aviso de correo sin verificar o invitaciones pendientes. Terminó bien,
// sin invitaciones y con el correo verificado: no se dibuja.
export function shouldShowInvitations(invitations) {
  if (!invitations) return false;
  return (
    invitations.status === "loading" ||
    invitations.status === "slow" ||
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
  onVeterinaryOrderOpen,
  open,
  pendingVeterinaryOrders = [],
  retry,
  showNotifications = true,
  subscription,
  unreadCount,
  verification = null,
}) {
  // Solo suman las invitaciones cargadas con éxito: cargando, lenta o con error valen 0 (los avisos sin
  // leer siguen contando). Con datos ya cargados, un refresco no cambia el estado y el contador no parpadea.
  const pendingInvitations = countLoadedInvitations(invitations);
  const totalUnread = unreadCount + pendingInvitations;
  const pendingOrderCount = pendingVeterinaryOrders.length;
  const totalBadgeCount = totalUnread + pendingOrderCount;
  const badgeLabel = formatBadgeCount(totalBadgeCount);
  // Si la suscripción de avisos falló, el contador no puede mostrar "0" como si
  // todo estuviera leído: se marca con "!" y se avisa en la etiqueta. Las
  // invitaciones (otra fuente) conservan su propio conteo en la etiqueta.
  const notificationsFailed =
    showNotifications && subscription.status === SUBSCRIPTION_STATUS.ERROR;
  const bellLabel = [
    "Notificaciones",
    notificationsFailed && "no se pudieron cargar los avisos",
    totalUnread > 0 && `${totalUnread} sin leer`,
    pendingOrderCount > 0 && `${pendingOrderCount} ${pendingOrderCount === 1 ? "orden" : "órdenes"} por iniciar`,
  ].filter(Boolean).join(", ");
  const showInvitations = shouldShowInvitations(invitations);
  // El correo sin verificar se explica con un aviso breve y su reenvío; mientras
  // carga o falla, la lista de invitaciones conserva sus propios estados.
  const showVerificationNotice =
    showInvitations && invitations.requiresVerification === true && invitations.status === "ready";
  const cooldownLeft = verification?.cooldownLeft || 0;
  const unreadNotifications = filterUnreadNotifications(notifications);

  const panelId = React.useId();
  const titleId = React.useId();
  const pendingOrdersTitleId = `${panelId}-veterinary-orders`;
  const rootRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // Mismo patrón que BusinessSwitcher: clic fuera y Escape cierran; Escape devuelve el foco al botón.
  // Sin focus-trap ni bloqueo de scroll. Con un diálogo hijo abierto no se cierra nada.
  React.useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (shouldClosePopoverOnPointerDown(event.target, rootRef.current, document)) {
        onCloseRef.current?.();
      }
    };
    const handleKeyDown = (event) => {
      if (!shouldClosePopoverOnEscape(event, document)) return;
      event.preventDefault();
      onCloseRef.current?.();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="topbar-notifications-button no-print"
        aria-label={bellLabel}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={open ? onClose : onOpen}
      >
        <AppIcon icon={Bell} size={20} />
        {(totalBadgeCount > 0 || notificationsFailed) && (
          <span
            className="ui-badge-count topbar-notifications-button__badge"
            aria-hidden="true"
          >
            {notificationsFailed ? "!" : badgeLabel}
          </span>
        )}
      </button>

      {open && (
      <section
        id={panelId}
        className="notification-popover no-print"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="notification-popover__title">
          Notificaciones
        </h2>
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
        {pendingOrderCount > 0 && (
          <section className="notification-section" aria-labelledby={pendingOrdersTitleId}>
            <h3 id={pendingOrdersTitleId} className="notification-section__title">Órdenes asignadas</h3>
            <ul className="notification-list">
              {pendingVeterinaryOrders.map((order) => (
                <li key={order.id}>
                  <button type="button" className="notification-list__item" onClick={() => onVeterinaryOrderOpen(order.id)}>
                    <span className="notification-list__icon">
                      <AppIcon icon={ClipboardList} size={18} />
                    </span>
                    <span className="notification-list__content">
                      <strong>Nueva atención asignada</strong>
                      <span className="notification-list__text">{order.tipoAtencion} · {order.box}</span>
                      {order.asignadoEn && (
                        <small title={formatTimestamp(order.asignadoEn)}>{formatRelativeTimestamp(order.asignadoEn)}</small>
                      )}
                    </span>
                    <span className="notification-list__icon">
                      <AppIcon icon={ChevronRight} size={18} />
                      <span className="sr-only">Ver orden</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {showNotifications && (
          <section className="notification-section" aria-label="Avisos">
            {(showInvitations || pendingOrderCount > 0) && <h3 className="notification-section__title">Avisos</h3>}
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
            ) : unreadNotifications.length === 0 ? (
              <p className="notification-empty">No tienes avisos nuevos</p>
            ) : (
              <ul className="notification-list">
                {unreadNotifications.map((notification) => (
                  <li key={notification.id}>
                    {/* Solo se listan los no leídos: el clic lo marca leído y el aviso sale de la lista. */}
                    <button
                      type="button"
                      className="notification-list__item is-unread"
                      onClick={() => markRead(notification.id)}
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
                      <span className="notification-list__dot" aria-hidden="true" />
                      <span className="sr-only">No leída</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {/* Rol sin permiso de avisos, sin invitaciones y con el correo verificado:
            ninguna sección se dibuja y el cuerpo quedaría vacío. */}
        {!showInvitations && !showNotifications && pendingOrderCount === 0 && (
          <p className="notification-empty">Sin notificaciones</p>
        )}
      </section>
      )}
    </div>
  );
}

export default NotificationBellView;
