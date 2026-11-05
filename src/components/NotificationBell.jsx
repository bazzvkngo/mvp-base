import React from "react";
import useMyInvitations from "../hooks/useMyInvitations";
import useNotifications from "../hooks/useNotifications";
import { sendVerificationEmail } from "../services/authService";
import NotificationBellView, {
  canViewBusinessNotifications,
} from "./NotificationBellView";

export { canViewBusinessNotifications };

// Mismos textos y espera que el reenvío de BusinessWaitingPage.
const RESEND_COOLDOWN_SECONDS = 60;
const VERIFICATION_MESSAGES = {
  sent: "Te enviamos el correo de verificación. Revisa tu bandeja y la carpeta de spam.",
  alreadyVerified: "Tu correo ya figura verificado. Si este aviso sigue, vuelve a iniciar sesión.",
  tooMany: "Demasiados intentos. Espera unos minutos e inténtalo nuevamente.",
  sendFailed: "No pudimos enviar el correo. Inténtalo nuevamente en unos minutos.",
};

function NotificationBell({ businessId, role, onInvitationAccepted }) {
  const canSeeNotifications = canViewBusinessNotifications(role);
  const [open, setOpen] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [cooldownLeft, setCooldownLeft] = React.useState(0);
  const [verifyFeedback, setVerifyFeedback] = React.useState("");
  // businessId vacío si el rol no corresponde: useNotifications nunca
  // llama a subscribeToNotifications en ese caso (mismo patrón que
  // useFinancialMovements/DashboardPage con hasBusinessPermission).
  const notificationsState = useNotifications(canSeeNotifications ? businessId : "");
  // Las invitaciones se piden con la Function listarMisInvitaciones, no con
  // la suscripción de arriba: las ve cualquier rol con una empresa activa.
  const invitationsState = useMyInvitations({
    enabled: Boolean(businessId),
    onAccepted: async (result, invitation) => {
      await onInvitationAccepted?.(result, invitation);
      if (!result?.mensaje) setOpen(false);
    },
  });
  const { reload: reloadInvitations } = invitationsState;

  React.useEffect(() => {
    if (cooldownLeft <= 0) return undefined;
    const timerId = window.setTimeout(() => setCooldownLeft((current) => current - 1), 1000);
    return () => window.clearTimeout(timerId);
  }, [cooldownLeft]);

  const handleOpen = React.useCallback(() => {
    setOpen(true);
    reloadInvitations({ silent: true });
  }, [reloadInvitations]);

  const handleResendVerification = React.useCallback(async () => {
    if (resending || cooldownLeft > 0) return;
    setResending(true);
    setVerifyFeedback("");
    try {
      const sent = await sendVerificationEmail();
      if (sent === false) {
        setVerifyFeedback(VERIFICATION_MESSAGES.alreadyVerified);
        reloadInvitations({ silent: true });
        return;
      }
      setVerifyFeedback(VERIFICATION_MESSAGES.sent);
      setCooldownLeft(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      if (error?.code === "auth/too-many-requests") {
        setVerifyFeedback(VERIFICATION_MESSAGES.tooMany);
        setCooldownLeft(RESEND_COOLDOWN_SECONDS);
      } else {
        setVerifyFeedback(VERIFICATION_MESSAGES.sendFailed);
      }
    } finally {
      setResending(false);
    }
  }, [cooldownLeft, reloadInvitations, resending]);

  if (!businessId) return null;

  return (
    <NotificationBellView
      {...notificationsState}
      showNotifications={canSeeNotifications}
      invitations={{
        busyId: invitationsState.busyId,
        feedback: invitationsState.feedback,
        invitations: invitationsState.invitations,
        onAccept: (invitation) => invitationsState.respond(invitation, "aceptar"),
        onClearFeedback: invitationsState.clearFeedback,
        onReject: (invitation, reason) =>
          invitationsState.respond(invitation, "rechazar", reason),
        onRetry: reloadInvitations,
        requiresVerification: invitationsState.requiresVerification,
        status: invitationsState.status,
      }}
      verification={{
        cooldownLeft,
        feedback: verifyFeedback,
        onResend: handleResendVerification,
        resending,
      }}
      open={open}
      onOpen={handleOpen}
      onClose={() => {
        invitationsState.clearFeedback();
        setVerifyFeedback("");
        setOpen(false);
      }}
    />
  );
}

export default NotificationBell;
