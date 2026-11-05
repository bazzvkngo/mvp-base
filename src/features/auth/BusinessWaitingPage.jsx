import React from "react";
import { Check, Copy, LogOut } from "lucide-react";
import BrandLogo from "../../components/BrandLogo";
import Button from "../../components/ui/Button";
import InvitationsInbox from "../../components/InvitationsInbox";
import LoadingState from "../../components/ui/LoadingState";
import Notice from "../../components/ui/Notice";
import SkipLink from "../../components/ui/SkipLink";
import useMyInvitations from "../../hooks/useMyInvitations";
import {
  logout,
  refreshCurrentUser,
  sendVerificationEmail,
} from "../../services/authService";
import AuthStage from "./AuthStage";
import "./login.css";

// Consulta periódica de la sesión mientras la persona espera (SPEC 029): cada
// 30 s, con tope de 20 consultas (10 min), y al volver a la pestaña con un
// mínimo de 5 s entre consultas. Pasado el tope solo queda la del foco.
export const WAITING_POLL_INTERVAL_MS = 30000;
export const WAITING_POLL_MAX_CHECKS = 20;
export const WAITING_FOCUS_MIN_GAP_MS = 5000;

export const WAITING_VERIFICATION_COOLDOWN_SECONDS = 60;

const COPY_FEEDBACK_MS = 2500;

const VERIFICATION_MESSAGES = {
  sent: "Te enviamos el correo de verificación. Revisa tu bandeja y la carpeta de spam.",
  tooMany: "Demasiados intentos. Espera unos minutos e inténtalo nuevamente.",
  sendFailed: "No pudimos enviar el correo. Inténtalo nuevamente en unos minutos.",
  notYet: "Aún no vemos tu correo verificado. Abre el enlace del mensaje y vuelve a intentarlo.",
  checkFailed: "No pudimos comprobarlo. Revisa tu conexión e inténtalo nuevamente.",
};

// Pantalla de espera para una cuenta sin empresa que entró como colaborador
// (pista de interfaz, SPEC 029). La sesión se consulta con `onRefresh` (la
// recarga de getBusinessSession de la app) y, cuando la persona ya tiene una
// empresa, la app deja de mostrar esta pantalla. Las invitaciones pendientes
// (SPEC 032) vienen de listarMisInvitaciones y se vuelven a pedir en cada
// consulta periódica; aceptar una recarga la sesión con `onRefresh`.
function BusinessWaitingPage({ usuario, onRefresh, onCreateOwnBusiness }) {
  const email = usuario?.email || "";
  const [copyState, setCopyState] = React.useState("idle");
  const [pollingStopped, setPollingStopped] = React.useState(false);
  // Las cuentas de Google llegan verificadas. El valor vive en estado porque
  // user.reload() actualiza el objeto en sitio y no provoca un nuevo render.
  const [emailVerified, setEmailVerified] = React.useState(
    usuario?.emailVerified === true
  );
  const [verifyFeedback, setVerifyFeedback] = React.useState("");
  const [resending, setResending] = React.useState(false);
  const [checkingVerification, setCheckingVerification] = React.useState(false);
  const [cooldownLeft, setCooldownLeft] = React.useState(0);
  const invitationsState = useMyInvitations({ onAccepted: () => onRefresh() });
  const reloadInvitations = invitationsState.reload;
  const emailVerifiedRef = React.useRef(usuario?.emailVerified === true);
  const wasVerifiedRef = React.useRef(usuario?.emailVerified === true);
  const checkingRef = React.useRef(false);
  const lastCheckRef = React.useRef(0);
  const checksRef = React.useRef(0);
  const copyTimerRef = React.useRef(null);

  const markVerified = React.useCallback(() => {
    emailVerifiedRef.current = true;
    setEmailVerified(true);
  }, []);

  // Recarga al usuario de Auth y devuelve si ya verificó su correo.
  const reloadVerification = React.useCallback(async () => {
    const user = await refreshCurrentUser();
    const verified = user?.emailVerified === true;
    if (verified) markVerified();
    return verified;
  }, [markVerified]);

  const checkSession = React.useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    lastCheckRef.current = Date.now();
    try {
      if (!emailVerifiedRef.current) {
        try {
          await reloadVerification();
        } catch {
          // Si no se puede recargar, igual se consulta la sesión.
        }
      }
      await reloadInvitations({ silent: true });
      await onRefresh();
    } catch {
      // Sin conexión o error momentáneo: se sigue esperando.
    } finally {
      checkingRef.current = false;
    }
  }, [onRefresh, reloadInvitations, reloadVerification]);

  // Al verificar el correo se piden de nuevo las invitaciones (antes la
  // respuesta fue "verifica tu correo").
  React.useEffect(() => {
    if (emailVerified && !wasVerifiedRef.current) reloadInvitations({ silent: true });
    wasVerifiedRef.current = emailVerified;
  }, [emailVerified, reloadInvitations]);

  React.useEffect(() => {
    if (cooldownLeft <= 0) return undefined;
    const timerId = window.setTimeout(
      () => setCooldownLeft((current) => current - 1),
      1000
    );
    return () => window.clearTimeout(timerId);
  }, [cooldownLeft]);

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      checksRef.current += 1;
      checkSession();
      if (checksRef.current >= WAITING_POLL_MAX_CHECKS) {
        window.clearInterval(intervalId);
        setPollingStopped(true);
      }
    }, WAITING_POLL_INTERVAL_MS);

    const checkOnFocus = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastCheckRef.current < WAITING_FOCUS_MIN_GAP_MS) return;
      checkSession();
    };
    window.addEventListener("focus", checkOnFocus);
    document.addEventListener("visibilitychange", checkOnFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkOnFocus);
      document.removeEventListener("visibilitychange", checkOnFocus);
    };
  }, [checkSession]);

  React.useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  const handleCopy = async () => {
    window.clearTimeout(copyTimerRef.current);
    try {
      await navigator.clipboard.writeText(email);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    copyTimerRef.current = window.setTimeout(
      () => setCopyState("idle"),
      COPY_FEEDBACK_MS
    );
  };

  const handleResend = async () => {
    if (resending || cooldownLeft > 0) return;
    setResending(true);
    setVerifyFeedback("");
    try {
      const sent = await sendVerificationEmail();
      if (sent === false) {
        markVerified();
        return;
      }
      setVerifyFeedback(VERIFICATION_MESSAGES.sent);
      setCooldownLeft(WAITING_VERIFICATION_COOLDOWN_SECONDS);
    } catch (error) {
      if (error?.code === "auth/too-many-requests") {
        setVerifyFeedback(VERIFICATION_MESSAGES.tooMany);
        setCooldownLeft(WAITING_VERIFICATION_COOLDOWN_SECONDS);
      } else {
        setVerifyFeedback(VERIFICATION_MESSAGES.sendFailed);
      }
    } finally {
      setResending(false);
    }
  };

  const handleAlreadyVerified = async () => {
    if (checkingVerification) return;
    setCheckingVerification(true);
    setVerifyFeedback("");
    try {
      const verified = await reloadVerification();
      if (verified) await onRefresh();
      else setVerifyFeedback(VERIFICATION_MESSAGES.notYet);
    } catch {
      setVerifyFeedback(VERIFICATION_MESSAGES.checkFailed);
    } finally {
      setCheckingVerification(false);
    }
  };

  // Con el correo sin verificar (según Auth o según el backend) se muestra el
  // aviso de verificación en lugar de la lista de invitaciones.
  const needsVerification =
    (Boolean(email) && !emailVerified) || invitationsState.requiresVerification;

  const copyMessage =
    copyState === "copied"
      ? "Correo copiado."
      : copyState === "failed"
        ? "No se pudo copiar. Selecciona el correo y cópialo manualmente."
        : "";

  return (
    <>
      <SkipLink targetId="auth-wait-main" />
      <main id="auth-wait-main" className="auth-screen" tabIndex="-1">
        <AuthStage />

        <section className="auth-panel" aria-labelledby="auth-wait-title">
          <div className="auth-card auth-wait">
            <header className="auth-card__header">
              <BrandLogo variant="auth" showText iconSize={50} subtitle="" />
            </header>

            <div className="auth-body">
              {needsVerification && (
                // role={null}: el aviso no es una región viva. La única región
                // de estado del aviso es su feedback, y solo existe con texto.
                <Notice
                  variant="warning"
                  role={null}
                  className="auth-wait__notice"
                  actions={
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        className="auth-wait__notice-button"
                        loading={resending}
                        disabled={cooldownLeft > 0}
                        onClick={handleResend}
                      >
                        {cooldownLeft > 0
                          ? `Reenviar en ${cooldownLeft} s`
                          : "Reenviar correo de verificación"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="auth-wait__notice-button"
                        loading={checkingVerification}
                        onClick={handleAlreadyVerified}
                      >
                        Ya lo verifiqué
                      </Button>
                      {verifyFeedback && (
                        <p className="auth-wait__notice-feedback" role="status">
                          {verifyFeedback}
                        </p>
                      )}
                    </>
                  }
                >
                  <p className="auth-wait__notice-text">
                    Primero verifica tu correo. Te enviamos un mensaje; sin eso
                    tu empresa no podrá agregarte.
                  </p>
                </Notice>
              )}

              <div className="auth-body__title">
                <h1 id="auth-wait-title" className="auth-card__title">
                  Esperando a tu empresa
                </h1>
                <p className="auth-card__subtitle">
                  Pide a tu empresa que te invite con este correo. Cuando lo
                  haga, verás la invitación aquí.
                </p>
              </div>

              {email && (
                <div className="auth-wait__email">
                  <span className="auth-field__label">Tu correo</span>
                  <div className="auth-wait__email-row">
                    <span className="auth-wait__email-value">{email}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      icon={copyState === "copied" ? Check : Copy}
                      className="auth-wait__copy"
                      onClick={handleCopy}
                    >
                      {copyState === "copied" ? "Copiado" : "Copiar"}
                    </Button>
                  </div>
                  <span className="auth-wait__copy-feedback" aria-live="polite">
                    {copyMessage}
                  </span>
                </div>
              )}

              {pollingStopped ? (
                <p className="auth-wait__status">
                  Dejamos de consultar por ahora. Vuelve a esta pestaña cuando
                  tu empresa te haya agregado.
                </p>
              ) : (
                <LoadingState
                  variant="inline"
                  label="Esperando una invitación de tu empresa..."
                  className="auth-wait__status"
                />
              )}

              {!needsVerification && (
                <section className="auth-wait__invitations" aria-labelledby="auth-wait-invitations-title">
                  <h2 id="auth-wait-invitations-title" className="auth-field__label">
                    Invitaciones
                  </h2>
                  <InvitationsInbox
                    busyId={invitationsState.busyId}
                    feedback={invitationsState.feedback}
                    invitations={invitationsState.invitations}
                    onAccept={(invitation) => invitationsState.respond(invitation, "aceptar")}
                    onClearFeedback={invitationsState.clearFeedback}
                    onReject={(invitation, reason) =>
                      invitationsState.respond(invitation, "rechazar", reason)
                    }
                    onRetry={reloadInvitations}
                    requiresVerification={false}
                    status={invitationsState.status}
                  />
                </section>
              )}

              <div className="auth-wait__actions">
                <Button
                  type="button"
                  variant="secondary"
                  className="auth-wait__create"
                  onClick={onCreateOwnBusiness}
                >
                  Quiero crear mi propia empresa
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon={LogOut}
                  onClick={logout}
                >
                  Cerrar sesión
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

export default BusinessWaitingPage;
