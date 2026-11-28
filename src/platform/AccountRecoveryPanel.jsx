import React from "react";
import {Mail, PencilLine, RotateCcw} from "lucide-react";
import Button from "../components/ui/Button";
import Notice from "../components/ui/Notice";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {
  changePlatformUserEmail,
  createPlatformRequestId,
  editPlatformUser,
  sendPlatformUserPasswordReset,
} from "../services/platformAdminService";
import {
  accountRecoveryBlock,
  previousEmailNotice,
  profileChanges,
  recoveryErrorMessage,
} from "./accountRecovery.mjs";

const DIALOGS = {
  reset: {
    title: "Enviar enlace de restablecimiento",
    description: "El enlace llega solo al correo del usuario. No se muestra aquí ni se fija ninguna contraseña.",
    confirm: "Enviar enlace",
    working: "Enviando...",
  },
  email: {
    title: "Cambiar correo de acceso",
    description: "Úsalo cuando la persona perdió el acceso a su correo. El cambio queda registrado con el correo anterior y el nuevo.",
    confirm: "Cambiar correo",
    working: "Cambiando...",
  },
  profile: {
    title: "Editar datos del usuario",
    description: "Solo se pueden editar los nombres, los apellidos y el teléfono.",
    confirm: "Guardar cambios",
    working: "Guardando...",
  },
};

function profileDraft(usuario) {
  return {
    nombres: usuario.nombres || "",
    apellidos: usuario.apellidos || "",
    telefonoPersonal: usuario.telefonoPersonal || "",
  };
}

// Tarjeta "Recuperación de cuenta" de la ficha del usuario. La confirmación y el
// motivo viven en un diálogo; los bloqueos de la interfaz solo explican, el
// servidor es quien los aplica.
function AccountRecoveryPanel({usuario, isOwnAccount = false, onCompleted}) {
  const [action, setAction] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [draft, setDraft] = React.useState(() => profileDraft(usuario));
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState("");
  const requestRef = React.useRef("");
  const firstFieldRef = React.useRef(null);
  const block = accountRecoveryBlock({usuario, isOwnAccount});
  const changes = profileChanges(usuario, draft);
  const dialog = DIALOGS[action];

  const open = (kind) => {
    requestRef.current = "";
    setReason("");
    setNewEmail("");
    setDraft(profileDraft(usuario));
    setError("");
    setAction(kind);
  };
  const close = () => { if (!working) setAction(""); };
  const edited = (setter) => (event) => { setter(event.target.value); setError(""); requestRef.current = ""; };

  const canConfirm = Boolean(reason.trim()) && (
    action === "reset" ||
    (action === "email" && Boolean(newEmail.trim())) ||
    (action === "profile" && Object.keys(changes).length > 0)
  );

  const confirm = async () => {
    const motivo = reason.trim();
    if (!requestRef.current) requestRef.current = createPlatformRequestId(`recovery_${action}`);
    const requestId = requestRef.current;
    setWorking(true);
    setError("");
    try {
      let result;
      let success;
      if (action === "reset") {
        result = await sendPlatformUserPasswordReset({uid: usuario.uid, motivo, requestId});
        success = `Enlace de restablecimiento enviado a ${usuario.correo}.`;
      } else if (action === "email") {
        result = await changePlatformUserEmail({uid: usuario.uid, correoNuevo: newEmail.trim(), motivo, requestId});
        success = `Correo cambiado a ${result?.correo || newEmail.trim()}. Quedó sin verificar y se cerró la sesión del usuario.`;
      } else {
        result = await editPlatformUser({uid: usuario.uid, cambios: changes, motivo, requestId});
        success = "Datos del usuario actualizados.";
      }
      requestRef.current = "";
      setAction("");
      onCompleted({
        text: success,
        warning: action === "email" ? previousEmailNotice(result, usuario.correo) : null,
      });
    } catch (caught) {
      setError(recoveryErrorMessage(caught, "No pudimos completar la acción. Intenta nuevamente."));
    } finally {
      setWorking(false);
    }
  };

  return <section className="platform-panel">
    <h2>Recuperación de cuenta</h2>
    {block ? <p className="platform-help platform-help--flush">{block}</p> : <>
      <div className="platform-recovery-actions">
        <Button variant="secondary" icon={RotateCcw} onClick={() => open("reset")}>Enviar enlace de restablecimiento</Button>
        <Button variant="secondary" icon={Mail} onClick={() => open("email")}>Cambiar correo</Button>
        <Button variant="secondary" icon={PencilLine} onClick={() => open("profile")}>Editar datos</Button>
      </div>
      <p className="platform-help">Cada acción pide un motivo y queda en el historial del usuario. Si cambias el correo, el nuevo queda sin verificar y se avisa al correo anterior.</p>
    </>}
    <ResponsiveDialog
      open={Boolean(action)}
      title={dialog?.title || ""}
      description={dialog?.description || ""}
      initialFocusRef={firstFieldRef}
      onClose={close}
      footer={<>
        <Button variant="secondary" disabled={working} onClick={close}>Cancelar</Button>
        <Button loading={working} disabled={!canConfirm} onClick={confirm}>{working ? dialog?.working : dialog?.confirm}</Button>
      </>}
    >
      <div className="platform-recovery-form">
        {error && <Notice variant="error">{error}</Notice>}
        {action === "reset" && <p>Se enviará un enlace de restablecimiento a <strong>{usuario.correo}</strong>.</p>}
        {action === "email" && <>
          <p>Correo actual: <strong>{usuario.correo}</strong></p>
          <label>Correo nuevo<input ref={firstFieldRef} type="email" autoComplete="off" value={newEmail} onChange={edited(setNewEmail)} /></label>
        </>}
        {action === "profile" && <>
          <label>Nombres<input ref={firstFieldRef} maxLength={120} value={draft.nombres} onChange={edited((value) => setDraft((current) => ({...current, nombres: value})))} /></label>
          <label>Apellidos<input maxLength={160} value={draft.apellidos} onChange={edited((value) => setDraft((current) => ({...current, apellidos: value})))} /></label>
          <label>Teléfono<input maxLength={40} value={draft.telefonoPersonal} onChange={edited((value) => setDraft((current) => ({...current, telefonoPersonal: value})))} /></label>
        </>}
        <label>Motivo<textarea ref={action === "reset" ? firstFieldRef : undefined} rows="2" maxLength={1000} value={reason} onChange={edited(setReason)} /></label>
      </div>
    </ResponsiveDialog>
  </section>;
}

export default AccountRecoveryPanel;
