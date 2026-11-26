import React from "react";
import Button from "../components/ui/Button";
import Notice from "../components/ui/Notice";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";

// Modal "Confirmar aprobación / rechazo" de una solicitud de verificación. Presentacional: el estado (decisión,
// aviso de error, acción en curso) vive en la página. Mientras `working` los botones y la X quedan bloqueados;
// con `error` el modal sigue abierto y muestra el motivo dentro (Notice de error, role="alert").
function VerificationDecisionDialog({
  decision,
  error = "",
  fiscalIdentifier = "",
  onClose,
  onConfirm,
  portal = true,
  summary = "",
  working = false,
}) {
  const approving = decision === "APROBAR";
  return (
    <ResponsiveDialog
      open={Boolean(decision)}
      portal={portal}
      title={approving ? "Confirmar aprobación" : "Confirmar rechazo"}
      description={approving ? "Revisa la razón social oficial antes de verificar la empresa." : "Revisa el motivo que quedará registrado en el historial."}
      onClose={() => !working && onClose()}
      footer={<>
        <Button variant="secondary" disabled={working} onClick={onClose}>Volver</Button>
        <Button variant={approving ? "primary" : "danger"} loading={working} onClick={onConfirm}>
          {working ? "Confirmando..." : approving ? "Aprobar empresa" : "Rechazar solicitud"}
        </Button>
      </>}
    >
      {error && <Notice variant="error" className="platform-verification-dialog__error">{error}</Notice>}
      <div className="platform-verification-confirmation">
        <span>{approving ? "Razón social oficial" : "Motivo de rechazo"}</span>
        <strong>{summary}</strong>
        <small>{fiscalIdentifier}</small>
      </div>
    </ResponsiveDialog>
  );
}

export default VerificationDecisionDialog;
