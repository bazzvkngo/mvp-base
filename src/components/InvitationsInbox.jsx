import React from "react";
import { RefreshCw } from "lucide-react";
import Button from "./ui/Button";
import Notice from "./ui/Notice";
import { SkeletonCards, SkeletonRegion } from "./ui/Skeleton";
import RejectInvitationDialog from "./RejectInvitationDialog";
import {
  INVITATION_VERIFY_EMAIL_MESSAGE,
  invitationHeadline,
} from "../domain/teamInvitationModel.mjs";
import { formatDate } from "../utils/formatters";

// Invitaciones recibidas, con Aceptar y Rechazar (SPEC 032). Presentacional,
// sin Firebase: lo usan el centro de notificaciones, la pantalla de espera y
// el onboarding con el estado de useMyInvitations. Estados separados: cargando,
// lenta (más de 8 s sin respuesta, con Reintentar), error (a los 15 s, con
// Reintentar), correo sin verificar, vacío y datos.
function InvitationsInbox({
  busyId = "",
  feedback = { text: "", error: false },
  invitations,
  onAccept,
  onClearFeedback,
  onReject,
  onRetry,
  requiresVerification = false,
  status,
}) {
  const [rejecting, setRejecting] = React.useState(null);
  const busy = Boolean(busyId);

  const submitReject = async (reason) => {
    const done = await onReject(rejecting, reason);
    if (done) setRejecting(null);
  };

  let body;
  if (status === "loading") {
    body = (
      <SkeletonRegion label="Cargando invitaciones...">
        <SkeletonCards count={1} />
      </SkeletonRegion>
    );
  } else if (status === "slow") {
    // Advertencia, no error: la consulta sigue en curso. Reintentar la abandona y empieza otra.
    body = (
      <Notice
        variant="warning"
        actions={
          <Button type="button" variant="secondary" icon={RefreshCw} onClick={() => onRetry?.()}>
            Reintentar
          </Button>
        }
      >
        La consulta de invitaciones está tardando. Sigue intentando...
      </Notice>
    );
  } else if (status === "error") {
    body = (
      <div className="client-message client-message--error" role="alert">
        <span>No se pudieron cargar las invitaciones.</span>
        <Button type="button" variant="secondary" icon={RefreshCw} onClick={() => onRetry?.()}>
          Reintentar
        </Button>
      </div>
    );
  } else if (requiresVerification) {
    body = <p className="erp-empty-state">{INVITATION_VERIFY_EMAIL_MESSAGE}</p>;
  } else if (invitations.length === 0) {
    body = <p className="erp-empty-state">No tienes invitaciones pendientes.</p>;
  } else {
    body = (
      <ul className="ui-invitation-list">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="ui-invitation">
            <div className="ui-invitation__body">
              <strong>{invitationHeadline(invitation)}</strong>
              <small>
                {invitation.invitadoPor ? `Te invita ${invitation.invitadoPor}. ` : ""}
                {invitation.expiraEn ? `Vence el ${formatDate(invitation.expiraEn)}.` : ""}
              </small>
            </div>
            <div className="ui-invitation__actions">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  onClearFeedback?.();
                  setRejecting(invitation);
                }}
              >
                Rechazar
              </Button>
              <Button
                type="button"
                loading={busyId === invitation.id && !rejecting}
                disabled={busy}
                onClick={() => onAccept(invitation)}
              >
                Aceptar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="ui-invitations">
      {feedback.text && !(rejecting && feedback.error) && (
        <div
          className={
            feedback.error ? "client-message client-message--error" : "client-message"
          }
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.text}
        </div>
      )}
      {body}
      <RejectInvitationDialog
        invitation={rejecting}
        busy={busy && Boolean(rejecting)}
        error={feedback.error ? feedback.text : ""}
        onClose={() => setRejecting(null)}
        onSubmit={submitReject}
      />
    </div>
  );
}

export default InvitationsInbox;
